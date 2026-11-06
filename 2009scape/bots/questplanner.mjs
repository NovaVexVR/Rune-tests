// Quest planner (Phase 4.2): bots take on quests by themselves.
// Every QUEST_PLAN_MINUTES it looks for bots that haven't done the starter quests and slots a one-off quest step
// into their plan, right after what they're doing now:
//   - teams form a party for Cook's Assistant: a leader who takes the quest and makes the flour, and two
//     members who fetch the egg and the milk and trade them over
//   - individualists do Cook's Assistant and Sheep Shearer on their own
// Only a few quests run at once so the farm, the mill and Fred's field don't get crowded.
import fs from 'fs';
import path from 'path';
import { STATE as POLITICS } from './politics.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const ORDERS = path.join(ROOT, 'orders');
const FILE = path.join(ROOT, 'market', 'questplans.json');
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_QUESTS ?? 3);
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { active: [] }; } };

function insertStep(name, step) {
    const f = path.join(ORDERS, `${name}.json`);
    if (!fs.existsSync(f)) return false;
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    o.plan ??= [];
    if (o.plan.some(p => p.task === step.task && p.once)) return false; // already queued
    o.plan.splice(Math.min((o.step ?? 0) + 1, o.plan.length), 0, { ...step, once: true });
    fs.writeFileSync(f, JSON.stringify(o, null, 2));
    return true;
}

export function planQuests(market) {
    const st = load();
    const now = Date.now();
    const s = n => market.bots.get(n)?.bot.s;
    const done = (n, q) => (s(n)?.quests?.[q] ?? 0) >= 100;
    // forget quests that are finished or have run too long
    st.active = st.active.filter(a => now - a.t < 75 * 60_000 && !a.members.every(m => done(m, a.quest) || a.role?.[m] === 'fetch'));
    const busy = new Set(st.active.flatMap(a => a.members));
    const free = n => s(n)?.online && !busy.has(n) && !market.busy.has(n) && s(n).y < 6000;
    const started = [];

    // team parties for Cook's Assistant
    for (const [team, d] of Object.entries(POLITICS.teams)) {
        if (st.active.length >= MAX_ACTIVE) break;
        const leader = d.members.filter(free).find(m => !done(m, 'COOKS_ASSISTANT'));
        if (!leader) continue;
        const helpers = d.members.filter(m => m !== leader && free(m)).slice(0, 2);
        const party = {};
        if (helpers[0]) party.Egg = helpers[0];
        if (helpers[1]) party['Bucket of milk'] = helpers[1];
        if (!insertStep(leader, { task: 'cooks_assistant', minutes: 40, party, why: `quest party leader (${team})` })) continue;
        const role = { [leader]: 'leader' };
        for (const [item, h] of Object.entries(party)) if (insertStep(h, { task: 'quest_fetch', item, for: leader, minutes: 25, why: `quest party: ${item} for ${leader}` })) role[h] = 'fetch';
        st.active.push({ quest: 'COOKS_ASSISTANT', members: Object.keys(role), role, t: now, team });
        Object.keys(role).forEach(m => busy.add(m));
        started.push(`${team} party: ${leader} leads${helpers.length ? ` with ${helpers.join(', ')}` : ''}`);
    }
    // individualists go solo
    const solo = [...market.bots.keys()].filter(n => (market.social.teamOf?.(n) ?? 'individual') === 'individual' && free(n));
    for (const n of solo.sort(() => Math.random() - 0.5)) {
        if (st.active.length >= MAX_ACTIVE) break;
        const quest = !done(n, 'COOKS_ASSISTANT') ? ['cooks_assistant', 'COOKS_ASSISTANT'] : !done(n, 'SHEEP_SHEARER') ? ['sheep_shearer', 'SHEEP_SHEARER'] : null;
        if (!quest) continue;
        if (!insertStep(n, { task: quest[0], minutes: 40, why: 'a quest of my own' })) continue;
        st.active.push({ quest: quest[1], members: [n], role: { [n]: 'leader' }, t: now });
        busy.add(n);
        started.push(`${n} takes on ${quest[1].toLowerCase().replace('_', ' ')}`);
    }
    fs.writeFileSync(FILE, JSON.stringify(st, null, 2));
    for (const t of started) market.log(`[quest] ${t}`);
}
