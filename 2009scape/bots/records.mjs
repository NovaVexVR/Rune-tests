// Records and the hall of fame (roadmap 36). Hourly: the first bot to reach 10/20/30/40/50 in each skill (from the
// diaries' level milestones, earliest wins), and all-time bests (richest, highest total level, most quest points,
// most duel wins). New records get a diary line (the crier picks it up); the recap prints the board.
// market/records.json.
import fs from 'fs';
import path from 'path';
import { readDiaries, note } from './diary.mjs';
import { readEconomy } from './economy.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'records.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { firsts: {}, bests: {} }; } };

export function updateRecords(market, log = () => {}) {
    const r = read();
    const fresh = [];
    // firsts: the earliest diary milestone per skill and level
    for (const e of readDiaries(0).filter(e => !market.bots.size || market.bots.has(e.bot))) {
        const m = /^Reached (\w+(?: \w+)?) level (\d+)\./.exec(e.text);
        if (!m || Number(m[2]) % 10 !== 0) continue;
        const key = `${m[1]} ${m[2]}`;
        if (!r.firsts[key] || e.t < Date.parse(r.firsts[key].t)) {
            const isNew = !r.firsts[key];
            r.firsts[key] = { bot: e.bot, t: new Date(e.t).toISOString() };
            if (isNew && Date.now() - e.t < 2 * 3600_000) fresh.push([e.bot, `first in town to ${key.replace(/ (\d+)$/, ' level $1')}`]);
        }
    }
    // all-time bests
    const best = (key, bot, value, text) => {
        if (!bot || !(value > (r.bests[key]?.value ?? 0))) return;
        const prev = r.bests[key]?.bot;
        r.bests[key] = { bot, value, t: new Date().toISOString() };
        if (prev !== bot) fresh.push([bot, text(value)]);
    };
    const econ = readEconomy().at(-1);
    if (econ?.richest?.[0]) best('richest', econ.richest[0].bot, econ.richest[0].wealth, v => `the richest bot ever seen in Lumbridge (${v}gp in coins and goods)`);
    const states = [...market.bots.entries()].map(([n, { bot }]) => [n, bot.s]).filter(([, s]) => s?.stats);
    const top = (f) => states.map(([n, s]) => [n, f(s)]).sort((a, b) => b[1] - a[1])[0] ?? [];
    const [tn, tv] = top(s => s.totalLevel ?? 0); best('totalLevel', tn, tv, v => `the highest total level in town (${v})`);
    const [qn, qv] = top(s => s.questPoints ?? 0); best('questPoints', qn, qv, v => `the most quest points in town (${v})`);
    const duels = {};
    for (const e of readDiaries(0)) if (/^Beat \w+ in a duel/.test(e.text) && market.bots.has(e.bot)) duels[e.bot] = (duels[e.bot] ?? 0) + 1; // fleet bots only
    const [dn, dv] = Object.entries(duels).sort((a, b) => b[1] - a[1])[0] ?? [];
    best('duelWins', dn, dv, v => `the most duels won (${v})`);
    for (const [bot, text] of fresh) { note(bot, `Set a record: ${text}!`); log(`[record] ${bot}: ${text}`); }
    fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(r, null, 1));
    return fresh.length;
}

export function recordsMarkdown() {
    const r = read();
    const bests = { richest: 'Richest ever', totalLevel: 'Highest total level', questPoints: 'Most quest points', duelWins: 'Most duels won' };
    const lines = Object.entries(bests).filter(([k]) => r.bests[k]).map(([k, label]) => `- **${label}:** ${r.bests[k].bot} (${r.bests[k].value})`);
    const firsts = Object.entries(r.firsts).filter(([k]) => Number(k.split(' ').at(-1)) >= 30).sort((a, b) => Number(b[0].split(' ').at(-1)) - Number(a[0].split(' ').at(-1))).slice(0, 8);
    if (firsts.length) lines.push(`- **Firsts:** ${firsts.map(([k, v]) => `${v.bot} to ${k}`).join(', ')}`);
    return lines.length ? ['## Hall of fame', '', ...lines, ''] : [];
}
