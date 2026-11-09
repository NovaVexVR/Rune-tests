// Weekly report (roadmap 59): node bots/weekly.mjs [days=7] writes bots/reports/week-<date>.html and latest.html, a
// self-contained page to share: how much the bots grew, the top growers, quests completed, deaths and the unluckiest,
// new records, the economy, and the week's stories (politics, duels, celebrations, stalls). The director pass publishes
// latest.html as the weekly artifact (DIRECTOR.md). Reads logs/progress.jsonl, the diaries and market/economy.jsonl.
import fs from 'fs';
import path from 'path';
import { readDiaries } from './diary.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DAYS = Number(process.argv[2] ?? 7);
const since = Date.now() - DAYS * 86400_000;
const lines = f => { try { return fs.readFileSync(path.join(HERE, f), 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-GB');

// growth: first and last total level per bot inside the window
const grow = {};
for (const r of lines('logs/progress.jsonl')) {
    if (r.t < since) continue;
    const g = (grow[r.bot] ??= { first: r.total, last: r.total, combat0: r.combat, combat: r.combat });
    g.last = r.total; g.combat = r.combat;
}
let growth = Object.entries(grow).map(([bot, g]) => ({ bot, gain: g.last - g.first, total: g.last, combat: g.combat })).sort((a, b) => b.gain - a.gain);
let gained = growth.reduce((t, g) => t + g.gain, 0);

// fleet bots only (orders files, plus the scripted bots): test bots' diaries stay out
const FLEET = new Set([...fs.readdirSync(path.join(HERE, 'orders')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)), ...Array.from({ length: 10 }, (_, i) => `scriptbot${i + 1}`)]);
for (const b of Object.keys(grow)) if (!FLEET.has(b)) delete grow[b];
const diary = readDiaries(since).filter(e => FLEET.has(e.bot));
growth = growth.filter(g => FLEET.has(g.bot));
gained = growth.reduce((t, g) => t + g.gain, 0);
const quests = diary.filter(e => /^Completed (?!my ).*?(Quest points|!$)/.test(e.text) && !/collection/.test(e.text));
const deaths = diary.filter(e => /^Died/.test(e.text));
const deathBy = {}; for (const d of deaths) deathBy[d.bot] = (deathBy[d.bot] ?? 0) + 1;
const unlucky = Object.entries(deathBy).sort((a, b) => b[1] - a[1]).slice(0, 3);
const records = diary.filter(e => /^Set a record/.test(e.text));
const stories = diary.filter(e => /^(Won the |Beat \w+ in a duel|Elected mayor|Opened a stall|Went to cheer|Reached \w+(?: \w+)? level (50|60|70|80|90|99)\.|Holding a grudge|Took \w+ on as an apprentice|Trained .* with my friend)/.test(e.text));
const eco = lines('market/economy.jsonl').filter(e => Date.parse(e.t) >= since);
const e0 = eco[0], e1 = eco.at(-1);

const title = `Rune Bots Weekly`;
const range = `${new Date(since).toISOString().slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`;
const li = arr => arr.length ? `<ul>${arr.join('')}</ul>` : '<p class="none">Nothing this week.</p>';
const html = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root{--bg:#f2f4ef;--sheet:#fcfdfa;--ink:#1f2a24;--muted:#5b6a61;--rule:#d5ddd6;--accent:#2f5d46;--gold:#9a6b12}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141a17;--sheet:#1b231f;--ink:#e4ebe6;--muted:#9db0a4;--rule:#2e3a33;--accent:#7fc29f;--gold:#e0b35a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141a17;--sheet:#1b231f;--ink:#e4ebe6;--muted:#9db0a4;--rule:#2e3a33;--accent:#7fc29f;--gold:#e0b35a;color-scheme:dark}
*{box-sizing:border-box}body{background:var(--bg);color:var(--ink);font:15px/1.55 Georgia,"Times New Roman",serif;padding-block:24px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.sheet{max-width:860px;margin:0 auto;background:var(--sheet);border:1px solid var(--rule);border-radius:6px;padding:26px 28px}
h1{font-size:30px;margin:0;color:var(--accent);text-wrap:balance}.sub{color:var(--muted);margin:2px 0 18px;font-family:system-ui,sans-serif;font-size:13px}
.stats{display:flex;flex-wrap:wrap;gap:10px 28px;margin:0 0 18px;font-family:system-ui,sans-serif;font-variant-numeric:tabular-nums}
.stats b{display:block;font-size:24px;color:var(--gold)}.stats span{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
h2{font-size:17px;border-top:1px solid var(--rule);padding-top:12px;margin:18px 0 6px}
ul{margin:0;padding-left:20px}li{margin:2px 0}.none{color:var(--muted);margin:0}
table{border-collapse:collapse;font-family:system-ui,sans-serif;font-size:13px;font-variant-numeric:tabular-nums}td,th{padding:3px 12px 3px 0;text-align:left;border-bottom:1px solid var(--rule)}th{color:var(--muted);font-weight:600}
.wrap{overflow-x:auto}
</style>
<div class="sheet">
<h1>${title}</h1>
<p class="sub">${range} · ${growth.length} bots</p>
<div class="stats">
 <div><b>+${fmt(gained)}</b><span>levels gained</span></div>
 <div><b>${quests.length}</b><span>quests completed</span></div>
 <div><b>${deaths.length}</b><span>deaths</span></div>
 <div><b>${records.length}</b><span>records set</span></div>
 ${e1 ? `<div><b>${fmt(e1.coins)}gp</b><span>coins in circulation${e0 ? ` (${e1.coins >= e0.coins ? '+' : ''}${fmt(e1.coins - e0.coins)})` : ''}</span></div>` : ''}
</div>
<h2>Top growers</h2>
<div class="wrap"><table><tr><th>Bot</th><th>Levels gained</th><th>Total level</th><th>Combat</th></tr>
${growth.slice(0, 10).map(g => `<tr><td>${esc(g.bot)}</td><td>+${g.gain}</td><td>${g.total}</td><td>${g.combat}</td></tr>`).join('')}</table></div>
<h2>Quests completed</h2>
${li(Object.entries(quests.reduce((m, q) => { const n = /^Completed (.+?)(?: with |\.|!)/.exec(q.text)?.[1] ?? q.text; (m[n] ??= new Set()).add(q.bot); return m; }, {})).map(([n, who]) => `<li><b>${esc(n)}</b>: ${who.size} bot${who.size > 1 ? 's' : ''} (${esc([...who].slice(0, 8).join(', '))}${who.size > 8 ? ', …' : ''})</li>`))}
<h2>Records</h2>
${li(records.slice(-12).map(r => `<li><b>${esc(r.bot)}</b>: ${esc(r.text.replace(/^Set a record: /, ''))}</li>`))}
<h2>Deaths</h2>
<p>${deaths.length} deaths this week.${unlucky.length ? ` Unluckiest: ${unlucky.map(([b, n]) => `${esc(b)} (${n})`).join(', ')}.` : ''}</p>
<h2>The week's stories</h2>
${li(stories.slice(-20).map(s => `<li><b>${esc(s.bot)}</b>: ${esc(s.text)}</li>`))}
${e1 ? `<h2>Economy</h2><p>${fmt(e1.coins)}gp in circulation; median bot wealth ${fmt(e1.medianWealth)}gp; inequality (Gini) ${e1.gini}.${e1.richest?.[0] ? ` Richest: ${esc(e1.richest[0].bot)} (${fmt(e1.richest[0].wealth)}gp).` : ''}</p>` : ''}
</div>
`;
const dir = path.join(HERE, 'reports');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `week-${new Date().toISOString().slice(0, 10)}.html`);
fs.writeFileSync(file, html);
fs.writeFileSync(path.join(dir, 'latest.html'), html);
console.log(`wrote ${file} (and reports/latest.html): ${growth.length} bots, +${gained} levels, ${quests.length} quests, ${deaths.length} deaths`);
