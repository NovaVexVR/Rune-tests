// Director pass (roadmap E22): Claude reads a briefing about the bot world and rewrites some bots' plans
// (orders/<bot>.json). This file prepares the briefing and decides when a pass is due; the pass itself is a
// Claude run following ../DIRECTOR.md, started by a local scheduler (see README: run_director.sh / .cmd).
//   node director.mjs brief    write bots/director/brief.md (recap, per-bot table, alerts, valid tasks)
//   node director.mjs due      exit 0 if a pass is due (24 h since the last, or an open alert), else 1
//   node director.mjs done     record that a pass just ran (clears alerts)
//   node director.mjs alerts   check for trouble now and print it (the runner also does this every 30 min)
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { readDiaries } from './diary.mjs';
import { flowSummary } from './economy.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(HERE, 'director');
const STATE = path.join(HERE, 'market', 'director.json');
const API = process.env.BOT_API ?? 'http://127.0.0.1:8899';
const EVERY_HOURS = Number(process.env.DIRECTOR_EVERY_HOURS ?? 24);
const TASKS = ['woodcut_fire', 'fish_cook', 'mine', 'smelt', 'smith', 'mine_iron', 'spin', 'melee', 'ranged', 'magic', 'thieving', 'fletch', 'leather', 'runecraft', 'herblore', 'merchant', 'lobsters', 'wild_mine', 'pottery', 'treasury', 'resupply'];
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const state = () => read(STATE, { lastPass: 0, alerts: [] });
const saveState = s => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); };

const topFlows = k => Object.entries(flowSummary(24).byTask).sort((a, b) => b[1][k] - a[1][k]).slice(0, 3).map(([t, v]) => `${t} ${v[k]}gp`).join(', ');

// Trouble worth an early pass: many deaths, bots stuck again and again, a team running out of coins.
export function checkAlerts() {
    const since = Date.now() - 2 * 3600_000;
    const entries = readDiaries(since);
    const alerts = [];
    const deaths = entries.filter(e => /^Died/.test(e.text));
    if (deaths.length >= 6) alerts.push(`${deaths.length} deaths in 2 hours (${[...new Set(deaths.map(e => e.bot))].slice(0, 8).join(', ')})`);
    const stuck = {};
    for (const e of entries.filter(e => /^Got stuck/.test(e.text))) stuck[e.bot] = (stuck[e.bot] ?? 0) + 1;
    const often = Object.entries(stuck).filter(([, n]) => n >= 3);
    if (often.length) alerts.push(`stuck again and again: ${often.map(([b, n]) => `${b} x${n}`).join(', ')}`);
    const econ = (() => { try { return fs.readFileSync(path.join(HERE, 'market', 'economy.jsonl'), 'utf8').trim().split('\n').slice(-12).map(l => JSON.parse(l)); } catch { return []; } })();
    if (econ.length >= 2) {
        const [a, b] = [econ[0], econ.at(-1)];
        for (const g of Object.keys(b.groups ?? {})) {
            const was = a.groups?.[g], now = b.groups[g];
            if (was && was.coins > 200 && now.coins < was.coins * 0.4) alerts.push(`${g} coins fell from ${was.coins} to ${now.coins} in ~6 hours`);
        }
    }
    // runaway inflation or deflation: total coins (all bots, carried + banked) up 50% or down 30% in a day
    try {
        const all = fs.readFileSync(path.join(HERE, 'market', 'economy.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
        const now = all.at(-1), dayAgo = all.findLast(r => Date.parse(r.t) <= Date.now() - 22 * 3600_000);
        if (now && dayAgo?.coins > 1000) {
            const ratio = now.coins / dayAgo.coins;
            // fast growth is normal while bots are poor (100k coins is an ordinary fortune in the real game): only flag
            // inflation once the average bot carries more than that
            if (ratio > 1.5 && now.coins / Math.max(1, now.bots ?? 1) > 100_000) alerts.push(`inflation: coins ${dayAgo.coins} -> ${now.coins} in a day (sources: ${topFlows('in')})`);
            if (ratio < 0.7) alerts.push(`deflation: coins ${dayAgo.coins} -> ${now.coins} in a day (sinks: ${topFlows('out')})`);
        }
    } catch {}
    const s = state();
    const fresh = alerts.filter(a => !s.alerts.some(x => x.text === a));
    if (fresh.length) { s.alerts.push(...fresh.map(text => ({ text, t: new Date().toISOString() }))); saveState(s); }
    return alerts;
}

async function brief() {
    fs.mkdirSync(DIR, { recursive: true });
    const recap = spawnSync(process.execPath, ['recap.mjs'], { cwd: HERE, encoding: 'utf8', env: { ...process.env, HOURS: '24' } }).stdout ?? '';
    const careers = read(path.join(HERE, 'market', 'careers.json'), {});
    const teams = read(path.join(HERE, 'market', 'teams.json'), { teams: {} }).teams;
    const teamOf = n => Object.entries(teams).find(([, d]) => d.members.includes(n))?.[0] ?? 'individual';
    const day = readDiaries(Date.now() - 86400_000);
    // total-level gain per bot over the last day (logs/progress.jsonl), to spot bots that stopped growing
    const gain = {};
    try {
        const since = Date.now() - 86400_000;
        for (const l of fs.readFileSync(path.join(HERE, 'logs', 'progress.jsonl'), 'utf8').trim().split('\n')) {
            let r; try { r = JSON.parse(l); } catch { continue; }
            if (r.t < since) continue;
            const g = (gain[r.bot] ??= { first: r.total, last: r.total }); g.last = r.total;
        }
    } catch {}
    const grew = n => (gain[n] ? gain[n].last - gain[n].first : null);
    const rows = [];
    const list = await fetch(`${API}/bots`).then(r => r.json()).catch(() => []);
    for (const f of fs.readdirSync(path.join(HERE, 'orders')).filter(f => f.endsWith('.json')).sort()) {
        const name = f.replace(/\.json$/, ''), o = read(path.join(HERE, 'orders', f), {});
        const s = list.some(b => b.name === name && b.online) ? await fetch(`${API}/bot/${name}/state?r=0`).then(r => r.json()).catch(() => null) : null;
        const coins = s ? (s.coins ?? 0) + (s.bank ?? []).filter(i => i.name === 'Coins').reduce((t, i) => t + i.count, 0) : '?';
        const top = s?.stats ? Object.entries(s.stats).sort((a, b) => b[1].level - a[1].level).slice(0, 3).map(([k, v]) => `${k} ${v.level}`).join(', ') : '';
        const c = careers[name];
        const deaths = day.filter(e => e.bot === name && /^Died/.test(e.text)).length;
        rows.push(`| ${name} | ${teamOf(name)} | ${s ? s.combat : 'offline'} | ${s?.totalLevel ?? ''} (${grew(name) === null ? '?' : '+' + grew(name)}) | ${top} | ${coins} | ${c ? `${c.career}: ${c.goal.text}` : ''} | ${deaths || ''} | ${o.paused ? 'PAUSED ' : ''}${(o.plan ?? []).map(p => `${p.task} ${p.minutes}m`).join(', ')} |`);
    }
    const s = state();
    const text = [
        `# Director briefing ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '',
        `Last pass: ${s.lastPass ? new Date(s.lastPass).toISOString().slice(0, 16).replace('T', ' ') : 'never'}. Open alerts: ${s.alerts.length ? '' : 'none'}`,
        ...s.alerts.map(a => `- ${a.text} (${a.t.slice(0, 16)})`), '',
        `Valid tasks: ${TASKS.join(', ')}.`, '',
        `Coin flows, last 24 h (task: in / out): ${(() => { const f = flowSummary(24); return Object.entries(f.byTask).sort((a, b) => (b[1].in - b[1].out) - (a[1].in - a[1].out)).map(([t, v]) => `${t} +${v.in}/-${v.out}`).join(', ') + ` (net ${f.net >= 0 ? '+' : ''}${f.net}gp)`; })()}`, '',
        `Not growing (no total-level gain in a day): ${Object.keys(gain).filter(n => grew(n) === 0).join(', ') || 'none'}.`, '',
        '## Bots', '', '| bot | team | combat | total (24 h gain) | best skills | coins | career / goal | deaths 24h | plan |', '|---|---|---|---|---|---|---|---|---|', ...rows, '',
        '## The last 24 hours', '', recap.trim()
    ].join('\n');
    fs.writeFileSync(path.join(DIR, 'brief.md'), text + '\n');
    console.log(`wrote ${path.join(DIR, 'brief.md')} (${rows.length} bots, ${s.alerts.length} alerts)`);
}

const cmd = process.argv[2];
if (cmd === 'brief') await brief();
else if (cmd === 'due') { const s = state(); checkAlerts(); const st = state(); process.exit(Date.now() - s.lastPass > EVERY_HOURS * 3600_000 || st.alerts.length ? 0 : 1); }
else if (cmd === 'done') { saveState({ lastPass: Date.now(), alerts: [] }); console.log('director pass recorded'); }
else if (cmd === 'alerts') console.log(checkAlerts().join('\n') || 'no alerts');
else if (process.argv[1]?.endsWith('director.mjs')) console.log('usage: node director.mjs brief|due|done|alerts');
