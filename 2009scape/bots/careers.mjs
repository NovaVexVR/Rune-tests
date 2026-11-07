// Careers and life goals (roadmap C14). Once a bot has found its feet (total level 60+) it settles on a career:
// what it is already best at, nudged by its personality (cautious misers avoid fighting, sociable merchants like
// crafts they can sell, gamblers fight). Its plan then bends toward the career's tasks, and it keeps a long-term
// goal (the career skill to the next 10, or for fighters a full set of armour); reaching a goal is a diary line
// and the next goal follows. Kept in bots/market/careers.json (runtime: cleared on a reset, so careers emerge).
//   careerOf(bot) -> { career, goal, since } (assigning one when due); careerTask(bot, canRun) -> a task id or null
//   checkGoal(bot) -> the goal reached, if any
import fs from 'fs';
import path from 'path';
import { personalityOf } from './social.mjs';
import { gearInfo } from './lib.mjs';
import { note } from './diary.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'careers.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const write = all => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(all, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };

export const CAREERS = {
    smith: { skill: 'smithing', tasks: ['smith', 'smelt', 'mine', 'mine_iron'], title: 'a smith' },
    fisher: { skill: 'fishing', tasks: ['fish_cook'], title: 'a fisher' },
    crafter: { skill: 'crafting', tasks: ['leather', 'spin'], title: 'a crafter' },
    fletcher: { skill: 'fletching', tasks: ['fletch', 'woodcut_fire'], title: 'a fletcher' },
    fighter: { skill: 'attack', tasks: ['melee', 'ranged'], title: 'a fighter', gear: true },
    thief: { skill: 'thieving', tasks: ['thieving'], title: 'a thief' },
    mystic: { skill: 'runecrafting', tasks: ['runecraft', 'magic'], title: 'a runecrafter' }
};
// personality leanings (added to the skill level when choosing)
const LEAN = {
    merchant: { crafter: 4, smith: 3, fletcher: 2 },
    miser: { fighter: -5, smith: 2, fisher: 3 },
    gambler: { fighter: 4, thief: 3 },
    opportunist: { thief: 5, fighter: 1 },
    philanthropist: { fisher: 3, crafter: 2 },
    loyalist: { fighter: 3, smith: 2 }
};
const CAREER_AT = 60; // total level before a bot settles on a career
const ARMOUR = ['head', 'body', 'legs', 'shield'];

function nextGoal(bot, career) {
    const c = CAREERS[career];
    if (c.gear) {
        // a full set: the best metal it wears anywhere, in all four armour slots, then the next metal
        const tiers = ARMOUR.map(slot => Math.floor((Math.max(-1, ...bot.s.worn.map(i => gearInfo(i.name)).filter(g => g?.slot === slot).map(g => g.score)) + 1) / 10));
        const tier = Math.min(...tiers) + 1;
        const metal = ['bronze', 'iron', 'steel', 'black', 'mithril'][tier - 1] ?? 'mithril';
        return { kind: 'gear', tier, text: `wear a full set of ${metal} armour (helm, body, legs, shield)` };
    }
    const lv = bot.lvl(c.skill);
    const target = Math.max(10, Math.ceil((lv + 1) / 10) * 10);
    return { kind: 'skill', skill: c.skill, level: target, text: `reach ${c.skill[0].toUpperCase() + c.skill.slice(1)} ${target}` };
}

export function careerOf(bot) {
    const all = read();
    if (all[bot.name]) return all[bot.name];
    if (!bot.s?.stats || (bot.s.totalLevel ?? 0) < CAREER_AT) return null;
    const lean = LEAN[personalityOf(bot.name).archetype] ?? {};
    const scored = Object.entries(CAREERS).map(([k, c]) => [k, bot.lvl(c.skill) + (lean[k] ?? 0) + Math.random() * 2]).sort((a, b) => b[1] - a[1]);
    const career = scored[0][0];
    const rec = { career, goal: nextGoal(bot, career), since: new Date().toISOString(), goalsReached: 0 };
    all[bot.name] = rec;
    write(all);
    note(bot.name, `Decided to make a living as ${CAREERS[career].title}. Goal: ${rec.goal.text}.`);
    bot.log?.(`[career] ${CAREERS[career].title}; goal: ${rec.goal.text}`);
    return rec;
}

// the goal reached (and the next one set), or null
export function checkGoal(bot) {
    const all = read(), rec = all[bot.name];
    if (!rec || !bot.s?.stats) return null;
    const g = rec.goal;
    const done = g.kind === 'skill' ? bot.lvl(g.skill) >= g.level
        : ARMOUR.every(slot => bot.s.worn.some(i => { const gi = gearInfo(i.name); return gi?.slot === slot && Math.floor(gi.score / 10) >= g.tier; }));
    if (!done) return null;
    rec.goalsReached = (rec.goalsReached ?? 0) + 1;
    rec.goal = nextGoal(bot, rec.career);
    all[bot.name] = rec;
    write(all);
    note(bot.name, `Reached my goal: ${g.text}! Next: ${rec.goal.text}.`);
    bot.log?.(`[career] goal reached: ${g.text}; next: ${rec.goal.text}`);
    return g;
}

// a career task to do instead of the planned one, some of the time (share grows with the career's age, up to 40%)
export function careerTask(bot, canRun, share = 0.4) {
    const rec = careerOf(bot);
    if (!rec) return null;
    const days = (Date.now() - Date.parse(rec.since)) / 86400_000;
    if (Math.random() > Math.min(share, 0.15 + 0.1 * days)) return null;
    const options = CAREERS[rec.career].tasks.filter(t => canRun(t) === true);
    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
}

// for scripted bots' task scoring: how much to favour a task (lower score wins)
export function careerBonus(bot, taskId) {
    const rec = read()[bot.name];
    return rec && CAREERS[rec.career].tasks.includes(taskId) ? -6 : 0;
}
