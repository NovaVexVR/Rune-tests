// Nicknames (roadmap 37): bots earn a nickname from what they've done; other bots use it in chat and the recap
// prints it in headlines. One nickname per bot, kept in bots/market/nicknames.json; a stronger deed replaces a
// weaker one. Awarded hourly from the diaries, skills and the economy samples.
//   awardNicknames(market)   check every bot (the runner calls it hourly)
//   nickOf(name)             'the Unlucky' or null;  display(name) -> 'claudebot5 "the Unlucky"'
//   callName(name)           what another bot calls it in chat: the nickname about half the time
import fs from 'fs';
import path from 'path';
import { readDiaries, note } from './diary.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'nicknames.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
let cache = null, cachedAt = 0;
const all = () => { if (Date.now() - cachedAt > 60_000) { cache = read(); cachedAt = Date.now(); } return cache; };

export const nickOf = name => all()[name]?.nick ?? null;
export const display = name => (nickOf(name) ? `${name} "${nickOf(name)}"` : name);
export const callName = name => (nickOf(name) && Math.random() < 0.5 ? nickOf(name).replace(/^the /, '') : name);

// [nickname, rank (higher wins), test(diary entries of the last week, state, extras)]
const SKILL_NICKS = { woodcutting: 'Timber', fishing: 'Fishbones', mining: 'Rockjaw', smithing: 'Hammerhand', thieving: 'Light-fingers', firemaking: 'Sparks', cooking: 'Cookie', crafting: 'Needles', fletching: 'Feathers', runecrafting: 'Runeseer', strength: 'Ironfist' };
function deeds(name, week, s, richest) {
    const has = re => week.filter(e => re.test(e.text)).length;
    const out = [];
    if (has(/^Won the duel tournament/)) out.push(['the Champion', 90, 'won the duel tournament']);
    if (has(/^Won the fishing contest/)) out.push(['the Angler', 80, 'won the fishing contest']);
    if (has(/^Won the smithing fair/)) out.push(['Hammerhand', 80, 'won the smithing fair']);
    if (has(/^Beat \w+ in a duel/) >= 3) out.push(['Ironfist', 75, 'three duels won']);
    if (has(/^Judged /) >= 3) out.push(['the Fair', 70, 'judged three disputes']);
    if (richest === name) out.push(['Moneybags', 65, 'the richest bot in town']);
    if (has(/^Defaulted on/) >= 2) out.push(['the Deadbeat', 60, 'two defaults in a week']);
    if (has(/^Died/) >= 5) out.push(['the Unlucky', 55, `died ${has(/^Died/)} times in a week`]);
    if (has(/^Completed (?!my ).*Quest points/) >= 2) out.push(['the Adventurer', 50, 'two quests done']);
    const best = s?.stats ? Object.entries(s.stats).filter(([k]) => SKILL_NICKS[k]).sort((a, b) => b[1].level - a[1].level)[0] : null;
    if (best && best[1].level >= 40) out.push([SKILL_NICKS[best[0]], 30 + best[1].level / 10, `${best[0]} ${best[1].level}`]);
    return out.sort((a, b) => b[1] - a[1]);
}

export function awardNicknames(market, log = console.log, richest = null) {
    const week = readDiaries(Date.now() - 7 * 86400_000);
    const nicks = read();
    let changed = 0;
    for (const [name, { bot }] of market.bots) {
        const [top] = deeds(name, week.filter(e => e.bot === name), bot.s, richest);
        const cur = nicks[name];
        if (!top || (cur && (cur.nick === top[0] || cur.rank > top[1]))) continue;
        nicks[name] = { nick: top[0], rank: top[1], why: top[2], since: new Date().toISOString() };
        changed++;
        note(name, `They've started calling me "${top[0]}" (${top[2]}).`);
        log(`[nickname] ${name} is now "${top[0]}" (${top[2]})`);
        // the town hears it: a sociable friend says it out loud
        const friend = [...market.bots.keys()].filter(o => o !== name && market.bots.get(o).bot.s?.online && market.social.trust(o, name) > 0).sort((a, b) => market.social.p(b).sociability - market.social.p(a).sociability)[0];
        if (friend) market.bots.get(friend).bot.act({ type: 'say', text: `Ha! ${name}, or should I say ${top[0]}?`.slice(0, 80) }).catch(() => {});
    }
    if (changed) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(nicks, null, 1)); cachedAt = 0; }
    return changed;
}
