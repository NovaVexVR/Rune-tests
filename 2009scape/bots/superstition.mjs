// Superstitions and lucky charms (roadmap 38). A good streak (two level-ups or a win within 6 hours) makes a bot
// superstitious about what it had on it or was doing:
//  - a lucky charm: something it carries or wears; it won't sell it (prices it 5x) and frets if it's ever gone
//  - a ritual: before the task it was doing, it buries a bone at the Lumbridge chapel (if it has one)
// market/superstitions.json; checked hourly by the runner.
import fs from 'fs';
import path from 'path';
import { readDiaries, note } from './diary.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'superstitions.json');
const CHAPEL = { x: 3243, y: 3207 };
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const save = v => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(v, null, 1)); };
let cache = null, at = 0;
const all = () => { if (Date.now() - at > 60_000) { cache = read(); at = Date.now(); } return cache; };
export const luckyOf = name => all()[name]?.charm ?? null;
export const ritualFor = (name, task) => (all()[name]?.ritualTask === task ? all()[name] : null);

export function superstitions(market, log = () => {}) {
    const st = read(), recent = readDiaries(Date.now() - 6 * 3600_000);
    for (const [name, { bot }] of market.bots) {
        const s = bot.s;
        if (!s?.online) continue;
        const rec = st[name] ?? {};
        // a charm that's gone
        if (rec.charm && ![...s.inv, ...s.worn, ...(s.bank ?? [])].some(i => i.name === rec.charm)) {
            note(name, `Lost my lucky ${rec.charm.toLowerCase()}. This can't end well.`);
            market.social.bumpMood?.(name, -0.2, `losing its lucky ${rec.charm.toLowerCase()}`);
            bot.act({ type: 'say', text: `Has anyone seen my lucky ${rec.charm.toLowerCase()}?` }).catch(() => {});
            log(`[superstition] ${name} lost its lucky ${rec.charm}`);
            delete rec.charm;
        }
        const mine = recent.filter(e => e.bot === name);
        const streak = mine.filter(e => /^Reached /.test(e.text)).length >= 2 || mine.some(e => /^(Won the |Beat \w+ in a duel)/.test(e.text));
        if (!streak || Date.now() - (rec.since ?? 0) < 48 * 3600_000 || Math.random() > 0.5) { st[name] = rec; continue; }
        rec.since = Date.now();
        if (!rec.charm && Math.random() < 0.6) {
            const pick = [...s.worn, ...s.inv].filter(i => !/^Coins$/.test(i.name))[Math.floor(Math.random() * (s.worn.length + s.inv.length))];
            if (pick) {
                rec.charm = pick.name;
                note(name, `Things go my way when I've got my ${pick.name.toLowerCase()}. It's lucky. Not selling it.`);
                log(`[superstition] ${name}'s ${pick.name} is now lucky`);
            }
        } else if (!rec.ritualTask && bot._lastTask) {
            rec.ritualTask = bot._lastTask;
            note(name, `Buried a bone at the chapel before ${bot._lastTask.replace(/_/g, ' ')} and it went great. Doing that every time now.`);
            log(`[superstition] ${name} has a ritual before ${bot._lastTask}`);
        }
        st[name] = rec;
    }
    save(st); at = 0;
}

// the ritual itself, before the task (called from prepare): bury a bone at the chapel, if there's a bone to bury
export async function doRitual(bot, task) {
    if (!ritualFor(bot.name, task)) return false;
    const bone = bot.s.inv.find(i => i.name === 'Bones') ?? null;
    if (!bone) return false;
    await bot.travel(CHAPEL.x, CHAPEL.y, { tol: 3 });
    const b = bot.s.inv.find(i => i.name === 'Bones');
    if (b) { await bot.act({ type: 'item', slot: b.slot, op: 'Bury' }); await bot.wait(2); bot.log('ritual: buried a bone at the chapel for luck'); }
    return true;
}
