// Tall tales (roadmap 41): now and then a bot boasts about its best skill, and the boast grows each time it's told
// (level 31 becomes "practically 40", a trout becomes "as long as my arm"). A bot nearby that knows better (higher
// in that skill) calls it out, and the boaster loses a little face. Hourly from the runner; counts in market/tales.json.
import fs from 'fs';
import path from 'path';
import { note } from './diary.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'tales.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const BRAG = {
    fishing: [n => `Caught a fish as long as my arm today.`, n => `Fishing ${n}? Feels more like ${n + 10}.`, n => `I once caught a shark with a small net.`],
    woodcutting: [n => `Felled a whole grove before lunch.`, n => `Woodcutting ${n}, give or take ten.`, n => `Trees fall when they see me coming.`],
    mining: [n => `Mined so much ore my arms are iron now.`, n => `Mining ${n + 5}, near enough.`, n => `I can hear the ore singing to me.`],
    strength: [n => `Knocked out a cow with one punch.`, n => `Strength ${n}? Feels like ${n + 15}.`, n => `Goblins run when I walk by.`],
    thieving: [n => `Nobody in Lumbridge has ever caught me.`, n => `Thieving ${n + 8}, but who's counting.`, n => `I could lift the Duke's crown.`]
};
export function tallTales(market, log = () => {}) {
    const tales = read(), online = n => market.bots.get(n)?.bot.s?.online;
    let told = 0;
    for (const [name, { bot }] of market.bots) {
        if (told >= 2 || !online(name) || Math.random() > 0.15 * market.social.p(name).sociability) continue;
        const best = Object.entries(bot.s.stats ?? {}).filter(([k]) => BRAG[k]).sort((a, b) => b[1].level - a[1].level)[0];
        if (!best || best[1].level < 10) continue;
        const [skill, { level }] = best;
        const n = (tales[name] = (tales[name] ?? 0) + 1); // each telling, a bigger story
        const line = BRAG[skill][Math.min(BRAG[skill].length - 1, Math.floor((n - 1) / 2))](level + Math.min(20, n));
        bot.act({ type: 'say', text: line.slice(0, 80) }).catch(() => {});
        told++;
        log(`[tale] ${name}: "${line}"`);
        // someone nearby who's better at it calls it out
        const critic = [...market.bots.keys()].filter(o => o !== name && online(o) && (market.bots.get(o).bot.s.stats?.[skill]?.level ?? 0) > level
            && Math.abs(market.bots.get(o).bot.s.x - bot.s.x) + Math.abs(market.bots.get(o).bot.s.y - bot.s.y) < 30)[0];
        if (critic && n > 1) {
            const lv = market.bots.get(critic).bot.s.stats[skill].level;
            market.bots.get(critic).bot.act({ type: 'say', text: `Come off it, ${name}. I'm ${skill} ${lv} and I've never seen that.`.slice(0, 80) }).catch(() => {});
            for (const [o] of market.bots) if (o !== name && o !== critic) market.social.adjustTrust(o, name, -0.005);
            note(name, `${critic} called out one of my stories in front of everyone.`);
            log(`[tale] ${critic} calls out ${name}`);
        }
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(tales));
    return told;
}
