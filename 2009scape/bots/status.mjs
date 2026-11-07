// Print a status table for all bots: node status.mjs
import fs from 'fs';
process.chdir(new URL('.', import.meta.url).pathname);
const API = 'http://127.0.0.1:8899';
const bots = (await (await fetch(`${API}/bots`)).json()).filter(b => /^(scriptbot|claudebot|guildbot|wolfbot|hawkbot|bearbot|legion|newbie)/.test(b.name)).sort((a, b) => a.name.localeCompare(b.name));
const lastTask = {};
for (const f of fs.readdirSync('logs').filter(f => /^(scriptbot|claudebot|guildbot|wolfbot|hawkbot|bearbot|legion|newbie)\d+\.log$/.test(f))) {
    const lines = fs.readFileSync(`logs/${f}`, 'utf8').trim().split('\n');
    const t = [...lines].reverse().find(l => /task ->|\[plan step/.test(l));
    lastTask[f.replace('.log', '')] = t ? (t.match(/task -> (\w+)/)?.[1] ?? t.match(/\] (\w+) for/)?.[1]) : '-';
}
const short = { attack: 'Att', strength: 'Str', defence: 'Def', hitpoints: 'HP', ranged: 'Rng', prayer: 'Pra', magic: 'Mag', woodcutting: 'WC', firemaking: 'FM', fishing: 'Fish', cooking: 'Cook', mining: 'Mine', thieving: 'Thv' };
console.log('bot          kind     task          total cb  pos          ' + Object.values(short).join(' '));
for (const b of bots) {
    const s = await (await fetch(`${API}/bot/${b.name}/state?r=0`)).json();
    if (!s.online) { console.log(`${b.name.padEnd(12)} offline`); continue; }
    const lv = Object.keys(short).map(k => String(s.stats[k].level).padStart(short[k].length)).join(' ');
    console.log(`${b.name.padEnd(12)} ${(b.name.startsWith("claude") ? "indiv" : b.name.startsWith("script") ? "script" : b.name.replace(/bot\d+$|\d+$/, "")).padEnd(8)} ${(lastTask[b.name] ?? '-').padEnd(13)} ${String(s.totalLevel).padStart(5)} ${String(s.combat).padStart(3)}  ${(s.x + ',' + s.y).padEnd(12)} ${lv}`);
}
