// Economy sampler (roadmap E23): every 30 minutes, how much the bot world owns. Coins in circulation (carried +
// banked), the store value of everything else banked or carried, wealth per bot (coins + goods), per group,
// inequality (Gini), richest and poorest, and the notice board's going prices. One row per sample in
// bots/market/economy.jsonl; export_dashboard.mjs turns it into economy.json for the dashboard's charts.
// This is how "bots slowly accumulate wealth in gold and resources" is checked over time.
//   node economy.mjs        take one sample now and print it
import fs from 'fs';
import path from 'path';
import { readBoard } from './noticeboard.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FILE = path.join(HERE, 'market', 'economy.jsonl');
const API = process.env.BOT_API ?? 'http://127.0.0.1:8899';
const BOT_RE = /^(scriptbot|claudebot|guildbot|wolfbot|hawkbot|bearbot|legion|newbie)\d+$/;

const gini = xs => {
    const a = [...xs].sort((x, y) => x - y), n = a.length, sum = a.reduce((t, x) => t + x, 0);
    if (!n || !sum) return 0;
    return Math.round((a.reduce((t, x, i) => t + (2 * (i + 1) - n - 1) * x, 0) / (n * sum)) * 1000) / 1000;
};
const groupOf = (name, teams) => {
    for (const [t, d] of Object.entries(teams ?? {})) if (d.members.includes(name)) return t;
    return name.startsWith('script') ? 'scripted' : name.startsWith('newbie') ? 'newcomers' : 'individual';
};

export async function sampleEconomy() {
    const list = (await (await fetch(`${API}/bots`)).json()).filter(b => BOT_RE.test(b.name));
    let teams = {};
    try { teams = JSON.parse(fs.readFileSync(path.join(HERE, 'market', 'teams.json'), 'utf8')).teams; } catch {}
    const per = [];
    for (const b of list) {
        // offline bots still own their saves, but the API only reports online ones: count those we can see
        const s = await (await fetch(`${API}/bot/${b.name}/state?r=0`)).json().catch(() => null);
        if (!s?.online) continue;
        const all = [...(s.inv ?? []), ...(s.bank ?? []), ...(s.worn ?? [])];
        const coins = all.filter(i => i.name === 'Coins').reduce((t, i) => t + i.count, 0);
        const goods = all.filter(i => i.name !== 'Coins').reduce((t, i) => t + (i.value ?? 1) * i.count, 0);
        per.push({ bot: b.name, group: groupOf(b.name, teams), coins, goods, wealth: coins + goods, bankSlots: (s.bank ?? []).length });
    }
    const groups = {};
    for (const p of per) { const g = (groups[p.group] ??= { bots: 0, coins: 0, goods: 0 }); g.bots++; g.coins += p.coins; g.goods += p.goods; }
    const byWealth = [...per].sort((a, b) => b.wealth - a.wealth);
    const row = {
        t: new Date().toISOString(),
        bots: per.length,
        coins: per.reduce((t, p) => t + p.coins, 0),
        goods: per.reduce((t, p) => t + p.goods, 0),
        medianWealth: byWealth.length ? byWealth[Math.floor(byWealth.length / 2)].wealth : 0,
        gini: gini(per.map(p => p.wealth)),
        richest: byWealth.slice(0, 5).map(p => ({ bot: p.bot, wealth: p.wealth })),
        poorest: byWealth.slice(-5).reverse().map(p => ({ bot: p.bot, wealth: p.wealth })),
        groups,
        prices: Object.fromEntries(Object.entries(readBoard()?.prices ?? {}).map(([k, v]) => [k, v.price])),
        perBot: Object.fromEntries(per.map(p => [p.bot, [p.coins, p.goods]]))
    };
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(row) + '\n');
    return row;
}

export function readEconomy() {
    try { return fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
}

if (process.argv[1]?.endsWith('economy.mjs')) {
    const r = await sampleEconomy();
    console.log(JSON.stringify({ ...r, perBot: `(${Object.keys(r.perBot).length} bots)` }, null, 1));
}

// ---- coin flows (roadmap 27): each task step's change in a bot's coins (carried + banked) -> market/flows.jsonl.
// Positive tasks are coin sources (thieving, selling), negative ones sinks (tolls, shops, tanning, fines).
const FLOWS = path.join(HERE, 'market', 'flows.jsonl');
export const coinsOf = s => (s?.coins ?? 0) + (s?.bank ?? []).filter(i => i.name === 'Coins').reduce((t, i) => t + i.count, 0);
export function recordFlow(bot, task, before, after) {
    if (before === null || after === null || before === after) return;
    fs.appendFileSync(FLOWS, JSON.stringify({ t: Date.now(), bot, task, delta: after - before }) + '\n');
}
export function flowSummary(hours = 24) {
    const since = Date.now() - hours * 3600_000, by = {};
    let rows = [];
    try { rows = fs.readFileSync(FLOWS, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.t >= since); } catch {}
    for (const r of rows) { const b = (by[r.task] ??= { in: 0, out: 0, steps: 0 }); b.steps++; if (r.delta > 0) b.in += r.delta; else b.out -= r.delta; }
    return { hours, net: rows.reduce((t, r) => t + r.delta, 0), byTask: by };
}

