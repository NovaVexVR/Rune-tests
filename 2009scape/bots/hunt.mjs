// Treasure hunts (roadmap 46). Every few days the town crier reads a riddle naming a safe landmark. Each hour a few
// bots work it out (sociable, curious ones more often; teammates share the answer); those who did race there
// between their tasks (join(bot) in the runner loop). The first to arrive wins the prize: coins from the mayor when
// there is one (a gift trade), and in any case the glory. market/hunt.json.
import fs from 'fs';
import path from 'path';
import { note } from './diary.mjs';
import { mayorOf } from './mayor.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'hunt.json');
const EVERY = Number(process.env.HUNT_EVERY_HOURS ?? 72) * 3600_000, LENGTH = 4 * 3600_000;
const SPOTS = [
    { x: 3166, y: 3302, clue: 'Where the miller grinds and the wheat bows low' },
    { x: 3189, y: 3274, clue: 'Where a farmer counts his sheep and frets about his wool' },
    { x: 3240, y: 3226, clue: "Where the river runs under the castle's eastern road" },
    { x: 3243, y: 3196, clue: 'Where Lumbridge remembers its dead in stone' },
    { x: 3110, y: 3168, clue: 'Where wizards keep their secrets in a tall round house' },
    { x: 3190, y: 3360, clue: 'Where only champions may enter' }
];
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { next: Date.now() + 2 * 3600_000, current: null, history: [] }; } };
const save = v => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(v, null, 1)); };
const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class Hunts {
    constructor(market, log = () => {}) { this.market = market; this.log = log; }
    tick() {
        const st = read(), m = this.market, s = m.social, now = Date.now();
        const say = (n, t) => m.bots.get(n)?.bot.act({ type: 'say', text: t.slice(0, 80) }).catch(() => {});
        const online = [...m.bots.keys()].filter(n => m.bots.get(n).bot.s?.online);
        if (!st.current && now >= st.next) {
            const spot = SPOTS[Math.floor(Math.random() * SPOTS.length)];
            const crier = online.sort((a, b) => s.p(b).sociability - s.p(a).sociability)[0];
            st.current = { ...spot, start: now, end: now + LENGTH, solvers: [], winner: null, sponsor: mayorOf() };
            if (crier) say(crier, `Treasure hunt! "${spot.clue}." First one there wins!`);
            this.log(`[hunt] a treasure hunt begins: "${spot.clue}" (${spot.x},${spot.y})`);
        }
        const c = st.current;
        if (c && !c.winner && now < c.end) {
            for (const n of online) {
                if (c.solvers.includes(n) || Math.random() > 0.08 + 0.15 * s.p(n).sociability) continue;
                c.solvers.push(n);
                // teammates hear the answer
                for (const t of online) if (t !== n && s.teamOf(t) === s.teamOf(n) && s.teamOf(n) !== 'individual' && !c.solvers.includes(t) && Math.random() < 0.5) c.solvers.push(t);
                this.log(`[hunt] ${n} has worked out the clue`);
            }
        } else if (c && (c.winner || now >= c.end)) {
            st.history.push({ clue: c.clue, winner: c.winner, solvers: c.solvers.length, t: new Date().toISOString() });
            st.history = st.history.slice(-20);
            st.current = null; st.next = now + EVERY;
        }
        save(st);
    }
    // runner side: a bot that worked out the clue goes there; first to arrive wins
    async join(bot) {
        const st = read(), c = st.current;
        if (!c || c.winner || !c.solvers.includes(bot.name) || Date.now() > c.end || (c.went ?? []).includes(bot.name)) return false;
        c.went = [...(c.went ?? []), bot.name]; save(st);
        bot.log(`[hunt] off to solve the treasure hunt: "${c.clue}"`);
        await bot.travel(c.x, c.y, { tol: 2, timeout: 600 });
        const now = read();
        if (now.current && !now.current.winner && dist(bot.s, c) <= 3) {
            now.current.winner = bot.name; save(now);
            const m = this.market, prize = c.sponsor && c.sponsor !== bot.name ? 30 : 0;
            await bot.act({ type: 'say', text: 'Found it! The treasure is mine!' }).catch(() => {});
            if (prize) m.open({ buyer: bot.name, seller: c.sponsor, item: 'Coins', amount: prize, price: 0, kind: 'gift' });
            for (const [o] of m.bots) if (o !== bot.name) m.social.adjustTrust(o, bot.name, 0.01);
            note(bot.name, `Won the treasure hunt ("${c.clue}")${prize ? `: ${prize}gp from the mayor, ${c.sponsor}` : ''}!`);
            this.log(`[hunt] ${bot.name} wins the treasure hunt${prize ? ` (${prize}gp from ${c.sponsor})` : ''}`);
        } else if (now.current?.winner && now.current.winner !== bot.name) {
            note(bot.name, `Got to the treasure hunt spot too late: ${now.current.winner} beat me to it.`);
        }
        return true;
    }
}
