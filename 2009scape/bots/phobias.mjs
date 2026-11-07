// Phobias (roadmap 39): killed by something embarrassing (level 5 or lower: a chicken, an imp, a rat...), a bot is
// afraid of it for 3 days: it won't pick fights with it, and other bots tease it about it now and then.
// market/phobias.json: { bot: { creature, until, since } }
import fs from 'fs';
import path from 'path';
import { note } from './diary.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'phobias.json');
const DAYS = 3;
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const write = v => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(v, null, 1)); };

export function fearOf(name) {
    const p = read()[name];
    return p && p.until > Date.now() ? p.creature : null;
}

// called on a death with the last NPC that was attacking the bot
export function recordDeath(name, attacker, log = () => {}) {
    if (!attacker || (attacker.level ?? 99) > 5 || Date.now() - attacker.t > 60_000) return null;
    const all = read();
    all[name] = { creature: attacker.name, until: Date.now() + DAYS * 86400_000, since: new Date().toISOString() };
    write(all);
    note(name, `Killed by a ${attacker.name.toLowerCase()}. I'm not going near another one for a while.`);
    log(`[phobia] ${name} is now afraid of ${attacker.name}s`);
    return attacker.name;
}

// now and then a sociable bot nearby teases a frightened one (the runner calls it hourly)
export function tease(market, log = () => {}) {
    const all = read(), now = Date.now();
    for (const [name, p] of Object.entries(all)) {
        if (p.until < now || Math.random() > 0.3) continue;
        const me = market.bots.get(name)?.bot;
        if (!me?.s?.online) continue;
        const near = [...market.bots.keys()].filter(o => o !== name && market.bots.get(o).bot.s?.online && Math.abs(market.bots.get(o).bot.s.x - me.s.x) + Math.abs(market.bots.get(o).bot.s.y - me.s.y) < 30);
        const joker = near.sort((a, b) => market.social.p(b).sociability - market.social.p(a).sociability)[0];
        if (!joker) continue;
        const c = p.creature.toLowerCase();
        const lines = [`Careful ${name}, a ${c} behind you!`, `${name}, want me to fight the ${c}s for you?`, `Heard a ${c} got the better of ${name}.`];
        market.bots.get(joker).bot.act({ type: 'say', text: lines[Math.floor(Math.random() * lines.length)].slice(0, 80) }).catch(() => {});
        if (Math.random() < 0.5) me.act({ type: 'say', text: `It was a very big ${c}.` }).catch(() => {});
        log(`[phobia] ${joker} teases ${name} about the ${c}`);
    }
}
