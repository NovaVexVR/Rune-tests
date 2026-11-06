// Daily recap (Phase 4.3): turns the last day of bot diaries and the team scoreboard into a short
// news-style summary. usage: node recap.mjs [hours=24]   (also written to logs/recap-<date>.md)
import fs from 'fs';
import path from 'path';
import { DIARY_DIR } from './diary.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const hours = Number(process.argv[2] ?? 24);
const since = Date.now() - hours * 3600_000;

// entries: { bot, t, kind, text }
const entries = [];
for (const f of fs.existsSync(DIARY_DIR) ? fs.readdirSync(DIARY_DIR) : []) {
    if (!f.endsWith('.md')) continue;
    const bot = f.slice(0, -3);
    let day = null;
    for (const line of fs.readFileSync(path.join(DIARY_DIR, f), 'utf8').split('\n')) {
        const d = line.match(/^## (\d{4}-\d{2}-\d{2})/);
        if (d) { day = d[1]; continue; }
        const e = line.match(/^- (\d\d:\d\d) \[(\w+)\] (.*)/);
        if (!e || !day) continue;
        const t = Date.parse(`${day}T${e[1]}:00Z`);
        if (t >= since) entries.push({ bot, t, kind: e[2], text: e[3] });
    }
}
entries.sort((a, b) => a.t - b.t);
const of = kind => entries.filter(e => e.kind === kind);
const out = [];
const date = new Date().toISOString().slice(0, 10);
out.push(`# The Lumbridge Ledger: ${date}`, '', `*${entries.length} diary entries from ${new Set(entries.map(e => e.bot)).size} bots over the last ${hours} hours.*`, '');

const section = (title, list, fmt = e => `**${e.bot}**: ${e.text}`, max = 8) => {
    if (!list.length) return;
    out.push(`## ${title}`, ...list.slice(-max).map(e => `- ${fmt(e)}`));
    if (list.length > max) out.push(`- …and ${list.length - max} more`);
    out.push('');
};

// headline: the single most dramatic thing that happened
const headline = of('quest')[0] ?? of('betrayal')[0] ?? of('team')[0] ?? of('collection')[0] ?? of('death')[0];
if (headline) out.push(`> **Headline:** ${headline.bot} — ${headline.text}`, '');

const scoresFile = path.join(HERE, 'market', 'scores.jsonl');
if (fs.existsSync(scoresFile)) {
    const last = fs.readFileSync(scoresFile, 'utf8').trim().split('\n').pop();
    if (last) {
        const { scores } = JSON.parse(last);
        const ranked = Object.entries(scores).sort((a, b) => b[1].perMember - a[1].perMember);
        out.push('## Team standings', '| Team | Members | Avg total level | Wealth | Quest points |', '|---|---|---|---|---|',
            ...ranked.map(([t, s]) => `| ${t} | ${s.members} | ${s.perMember} | ${s.wealth} | ${s.quests ?? 0} |`), '');
    }
}
section('Quests', of('quest'));
section('Market day', of('market'), undefined, 6);
section('Team politics', of('team'));
section('Grudges and betrayals', of('betrayal'));
section('Collections', of('collection'));
const trades = of('trade').map(e => ({ ...e, price: Number(e.text.match(/(\d+) coins/)?.[1] ?? 0) })).sort((a, b) => a.price - b.price);
section('Biggest trades', trades, undefined, 5);
section('Debts', of('debt'), undefined, 6);
section('Wagers', of('wager'), undefined, 5);
section('Bounties', of('bounty'), undefined, 5);
const deaths = of('death');
if (deaths.length) out.push(`## Obituaries`, `${deaths.length} deaths: ${[...new Set(deaths.map(e => e.bot))].join(', ')}.`, '');
const levels = of('level');
if (levels.length) section('Milestones', levels, undefined, 6);
const randoms = of('random');
if (randoms.length) out.push(`## Strange happenings`, `${randoms.length} random events: ${Object.entries(randoms.reduce((m, e) => ((m[e.text] = (m[e.text] ?? 0) + 1), m), {})).map(([t, n]) => `${t.replace(/^A random event found me: |\.$/g, '')} ×${n}`).join(', ')}.`, '');

const text = out.join('\n');
fs.mkdirSync(path.join(HERE, 'logs'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'logs', `recap-${date}.md`), text + '\n');
console.log(text);
