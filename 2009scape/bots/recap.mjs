// Phase 4.3: a short news-style recap of the last day (or HOURS=n) from the bots' diaries, the trade
// ledger, team politics and market days. Prints Markdown and saves it to bots/recaps/<date>.md.
//   node recap.mjs            last 24 hours
//   HOURS=6 node recap.mjs    last 6 hours
// (When Claude is in a session it can write the recap itself, in each bot's voice, from the same files.)
import fs from 'fs';
import path from 'path';
import { readDiaries } from './diary.mjs';
import { buildBoard, boardMarkdown } from './noticeboard.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const MKT = path.join(ROOT, 'market');
const HOURS = Number(process.env.HOURS ?? 24);
const since = Date.now() - HOURS * 3600_000;
const jsonl = f => (fs.existsSync(path.join(MKT, f)) ? fs.readFileSync(path.join(MKT, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const json = (f, d) => (fs.existsSync(path.join(MKT, f)) ? JSON.parse(fs.readFileSync(path.join(MKT, f), 'utf8')) : d);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const list = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

const entries = readDiaries(since);
const ledger = jsonl('ledger.jsonl').filter(r => Date.parse(r.t) >= since);
const done = ledger.filter(r => r.outcome === 'completed');
const by = re => entries.filter(e => re.test(e.text));
const out = [];
const date = new Date().toISOString().slice(0, 10);
out.push(`# The Lumbridge Ledger: ${date}`, '', `_The last ${HOURS} hours in the bot world._`, '');

// headlines, most dramatic first
const head = [];
const betrayals = by(/never paid back/);
for (const e of betrayals) head.push(`**${e.bot} cries betrayal**: ${e.text.replace(/\. Betrayed\.$/, '')}.`);
const politics = json('teams.json', { history: [] }).history.filter(h => Date.parse(h.t) >= since && !/^scoreboard/.test(h.text));
for (const h of politics) head.push(`**Team politics**: ${h.text}.`);
const deaths = by(/^Died/);
if (deaths.length) head.push(`**${plural(deaths.length, 'death')}**: ${list([...new Set(deaths.map(e => e.bot))])}${deaths.some(e => /first time/.test(e.text)) ? ` (a first for ${list(deaths.filter(e => /first time/.test(e.text)).map(e => e.bot))})` : ''}.`);
const days = json('marketday.json', { days: [] }).days.filter(d => d.end >= since && d.end <= Date.now());
for (const d of days) {
    const md = done.filter(r => r.venue === 'market day' && Date.parse(r.t) >= d.start && Date.parse(r.t) <= d.end + 180_000);
    head.push(`**Market day at the Grand Exchange**: ${plural(d.arrived.length, 'bot')} made the trip${d.deaths.length ? `, ${d.deaths.length} died on the way` : ' safely'}; ${plural(md.length, 'deal')} haggled face to face${md.length ? ` (${md.map(r => `${r.item} ${r.price}gp`).join(', ')})` : ''} and ${plural(d.geOffers, 'GE offer')} posted.`);
}
const questsDone = by(/^Completed (?!my ).*\. Quest points/);
const byQuest = {};
for (const e of questsDone) (byQuest[/^Completed (.+?)( with |\.)/.exec(e.text)?.[1] ?? 'a quest'] ??= []).push(e.bot);
for (const [qn, who] of Object.entries(byQuest)) head.push(`**Quest done: ${qn}** by ${list(who)}.`);
const collections = by(/^Completed my .* collection/);
for (const e of collections) head.push(`**${e.bot}** ${e.text.replace(/^Completed my/, 'completed its').replace(/!$/, '')}.`);
if (head.length) out.push('## Headlines', '', ...head.map(h => `- ${h}`), '');

// the economy
const sales = done.filter(r => r.kind === 'sale').sort((a, b) => b.price - a.price);
const econ = [];
if (sales.length) econ.push(`${plural(sales.length, 'sale')} for ${sales.reduce((t, r) => t + r.price, 0)}gp in total. Biggest: ${sales.slice(0, 3).map(r => `${r.seller} sold ${r.amount > 1 ? r.amount + ' ' : ''}${r.item} to ${r.buyer} for ${r.price}gp`).join('; ')}.`);
const kinds = k => done.filter(r => r.kind === k);
if (kinds('favor').length) econ.push(`${plural(kinds('favor').length, 'favor')} done on credit; ${plural(kinds('repay').length, 'debt')} repaid.`);
if (kinds('debtsale').length) econ.push(`Debt collectors bought ${plural(kinds('debtsale').length, 'IOU')}: ${kinds('debtsale').map(r => `${r.buyer} from ${r.seller} for ${r.price}gp`).join('; ')}.`);
if (kinds('bounty').length) econ.push(`${plural(kinds('bounty').length, 'bounty')} delivered.`);
if (kinds('wager').length) econ.push(`Coin flips: ${kinds('wager').map(r => `${r.buyer} took ${r.amount}gp off ${r.seller}`).join('; ')}.`);
const failed = ledger.filter(r => /^rejected/.test(r.outcome));
if (failed.length) econ.push(`${plural(failed.length, 'trade')} fell through over price.`);
if (econ.length) out.push('## Trade', '', ...econ.map(e => `- ${e}`), '');

// grudges and the social scene
const social = [];
const grudges = by(/^Holding a grudge/);
if (grudges.length) social.push(`New grudges: ${grudges.map(e => `${e.bot} vs ${/against (\w+)/.exec(e.text)?.[1]}`).join(', ')}.`);
const events = by(/^Random event/);
if (events.length) {
    const count = {};
    for (const e of events) { const t = e.text.replace(/^Random event: |\.$/g, ''); count[t] = (count[t] ?? 0) + 1; }
    social.push(`Random events: ${Object.entries(count).map(([t, n]) => `${t} x${n}`).join(', ')}.`);
}
if (social.length) out.push('## Around town', '', ...social.map(e => `- ${e}`), '');

// progress
const levels = by(/^Reached /);
if (levels.length) {
    const top = levels.map(e => ({ e, lv: Number(/level (\d+)/.exec(e.text)?.[1] ?? 0) })).sort((a, b) => b.lv - a.lv).slice(0, 5);
    out.push('## Milestones', '', `- ${plural(levels.length, 'level milestone')}. Highest: ${top.map(({ e }) => `${e.bot} (${e.text.replace(/^Reached |\.$/g, '')})`).join(', ')}.`, '');
}
const scores = jsonl('scores.jsonl').at(-1);
if (scores?.scores) out.push('## Team standings', '', ...Object.entries(scores.scores).sort((a, b) => b[1].perMember - a[1].perMember).map(([t, s], i) => `- ${i + 1}. ${t}: score ${s.perMember} per member, ${s.quests ?? 0} quest points, wealth ${s.wealth}gp (${s.members} members)`), '');

const evs = json('events.json', { past: [] }).past.filter(e => e.end >= since);
if (evs.length) out.push('## Town events', '', ...evs.map(e => `- **${e.kind === 'fishing' ? 'Fishing contest' : 'Smithing fair'}**: ${e.results.length ? e.results.map((r, i) => `${i + 1}. ${r.bot} (${r.xp} xp)`).join(', ') : 'nobody entered'}.`), '');
out.push(...boardMarkdown(buildBoard()));
if (out.length <= 4) out.push('A quiet day. Nothing worth printing.');
const text = out.join('\n');
console.log(text);
fs.mkdirSync(path.join(ROOT, 'recaps'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'recaps', `${date}.md`), text + '\n');
