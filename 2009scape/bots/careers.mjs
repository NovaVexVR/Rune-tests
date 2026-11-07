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
    fisher: { skill: 'fishing', tasks: ['fish_cook', 'lobsters'], title: 'a fisher' },
    crafter: { skill: 'crafting', tasks: ['leather', 'spin'], title: 'a crafter' },
    fletcher: { skill: 'fletching', tasks: ['fletch', 'woodcut_fire'], title: 'a fletcher' },
    fighter: { skill: 'attack', tasks: ['melee', 'ranged'], title: 'a fighter', gear: true },
    thief: { skill: 'thieving', tasks: ['thieving'], title: 'a thief' },
    mystic: { skill: 'runecrafting', tasks: ['runecraft', 'magic'], title: 'a runecrafter' },
    herbalist: { skill: 'herblore', tasks: ['herblore', 'melee'], title: 'a herbalist' },
    merchant: { skill: 'thieving', tasks: ['merchant', 'thieving'], title: 'a merchant' }
};
// personality leanings (added to the skill level when choosing)
const LEAN = {
    merchant: { merchant: 8, crafter: 4, smith: 3, fletcher: 2 },
    miser: { fighter: -5, smith: 2, fisher: 3 },
    gambler: { fighter: 4, thief: 3 },
    opportunist: { thief: 5, fighter: 1 },
    philanthropist: { fisher: 3, crafter: 2 },
    loyalist: { fighter: 3, smith: 2 }
};
const CAREER_AT = 60; // total level before a bot settles on a career
const ARMOUR = ['head', 'body', 'legs', 'shield'];

// how suited a bot is to a career: its skill, counting the skills that feed it (a miner is half a smith already,
// a woodcutter half a fletcher, a strong fighter a fighter)
const FEEDS = { herbalist: ['herblore', 1], smith: ['mining', 0.8], fletcher: ['woodcutting', 0.6], fighter: ['strength', 1], crafter: ['firemaking', 0], fisher: ['cooking', 0.6], thief: ['thieving', 1], mystic: ['magic', 0.6] };
function aptitude(bot, k) {
    const [feed, w] = FEEDS[k] ?? [null, 0];
    return Math.max(bot.lvl(CAREERS[k].skill), feed ? bot.lvl(feed) * w : 0);
}

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
    const taught = taughtCareers(bot.name); // an apprentice leans toward what it was taught
    const scored = Object.entries(CAREERS).map(([k, c]) => [k, aptitude(bot, k) + (lean[k] ?? 0) + (taught.has(k) ? 4 : 0) + Math.random() * 2]).sort((a, b) => b[1] - a[1]);
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

// ---- Apprenticeships (roadmap C12): once a day per mentor, a bot with a career and 20+ in its skill takes on a
// weaker teammate (no career yet, or the same career 10+ levels behind) and gives it the trade's starter goods
// from its own stock, through the market's gift trade. The apprentice leans toward the mentor's career.
const STARTER = {
    smith: [['Bronze bar', 5], ['Hammer', 1]], fisher: [['Fly fishing rod', 1], ['Feather', 20], ['Small fishing net', 1]],
    crafter: [['Needle', 1], ['Thread', 5], ['Cowhide', 5]], fletcher: [['Knife', 1], ['Logs', 10]],
    fighter: [['Bronze sq shield', 1], ['Bronze med helm', 1], ['Shrimps', 5]], thief: [['Shrimps', 5]], mystic: [['Air rune', 30], ['Mind rune', 30]]
};
export function apprenticeships(market, teamOf, log = console.log) {
    const all = read(), now = Date.now();
    const has = (name, item) => { const s = market.bots.get(name)?.bot.s; return [...(s?.inv ?? []), ...(s?.bank ?? [])].filter(i => i.name === item).reduce((t, i) => t + i.count, 0); };
    for (const [mentor, rec] of Object.entries(all)) {
        const mb = market.bots.get(mentor)?.bot;
        if (!mb?.s?.online || market.isBusy(mentor) || now - (rec.lastApprentice ?? 0) < 86400_000) continue;
        const c = CAREERS[rec.career], lv = mb.lvl(c.skill);
        if (lv < 20 || teamOf(mentor) === 'individual') continue;
        const pupil = [...market.bots.keys()].filter(n => n !== mentor && teamOf(n) === teamOf(mentor) && market.bots.get(n).bot.s?.online && !market.isBusy(n))
            .filter(n => { const r = all[n]; return (!r || r.career === rec.career) && market.bots.get(n).bot.lvl(c.skill) <= lv - 10; })
            .sort((a, b) => market.bots.get(a).bot.lvl(c.skill) - market.bots.get(b).bot.lvl(c.skill))[0];
        if (!pupil) continue;
        const gift = STARTER[rec.career].find(([item, n]) => has(mentor, item) >= n && has(pupil, item) < n);
        rec.lastApprentice = now;
        rec.apprentices = [...new Set([...(rec.apprentices ?? []), pupil])];
        const lean = (mentorsOf[pupil] ??= new Set()); lean.add(rec.career);
        if (gift) market.open({ buyer: pupil, seller: mentor, item: gift[0], amount: gift[1], price: 0, kind: 'gift' });
        market.social.adjustTrust(pupil, mentor, 0.1);
        market.social.adjustTrust(mentor, pupil, 0.05);
        note(mentor, `Took ${pupil} on as an apprentice ${c.title.replace(/^an? /, '')}${gift ? `, and gave it ${gift[1]} ${gift[0]}` : ''}.`);
        note(pupil, `${mentor} is teaching me to be ${c.title}${gift ? ` (gave me ${gift[1]} ${gift[0]})` : ''}.`);
        log(`[career] ${mentor} (${rec.career}, ${c.skill} ${lv}) takes on ${pupil} as an apprentice${gift ? `: ${gift[1]} ${gift[0]}` : ''}`);
    }
    write(all);
}
// careers the bot has been taught (in this process): a lean toward them when it chooses its own
const mentorsOf = {};
export const taughtCareers = name => mentorsOf[name] ?? new Set();
