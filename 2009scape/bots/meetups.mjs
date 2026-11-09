// Friends and meetups (roadmap 55). Hourly, a few pairs of online bots that trust each other (0.3+ both ways, sociable
// ones first) meet up: the guest walks over to where its friend is training and trains the same thing beside it for
// ~25 minutes, chatting now and then about what they're doing. Trust and mood rise a little; diary lines for both.
// The host just carries on with its plan. Runners call join(bot) between plan steps. market/meetups.json.
import fs from 'fs';
import path from 'path';
import { note } from './diary.mjs';
import { dist, sleep } from './lib.mjs';
import { taskById } from './tasks.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'meetups.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { active: [], last: {} }; } };
const write = st => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st, null, 1)); };
const MINUTES = 25, MAX_ACTIVE = 3, REACH = 250;
const TALK = {
    woodcut_fire: ['These trees never run out, do they?', 'Race you to the next log!'],
    fish_cook: ['Anything biting?', "Don't burn mine this time!"],
    mine: ['Plenty of ore today.', 'My arms are going to fall off.'],
    melee: ['Watch my back!', "That one's mine!"],
    thieving: ['Keep an eye out for guards.', 'Easy money.'],
    fletch: ['How many bows is that now?', 'Feathers everywhere.'],
    default: ['Good to see you!', 'Nice day for it.', "How's the training going?"]
};
const line = task => { const l = TALK[task] ?? TALK.default; return l[Math.floor(Math.random() * l.length)]; };

export class Meetups {
    constructor(market, log = () => {}) { this.market = market; this.log = log; }
    tick() {
        const st = read(), now = Date.now(), m = this.market, s = m.social;
        st.active = st.active.filter(x => x.until > now);
        const online = [...m.bots.keys()].filter(n => m.bots.get(n).bot.s?.online && !m.away?.has(n));
        const busy = n => st.active.some(x => x.host === n || x.guest === n);
        const pairs = [];
        for (const a of online) for (const b of online) {
            if (a >= b || busy(a) || busy(b) || now - (st.last[`${a}|${b}`] ?? 0) < 12 * 3600_000) continue;
            if (s.trust(a, b) < 0.3 || s.trust(b, a) < 0.3) continue;
            pairs.push([a, b, s.p(a).sociability + s.p(b).sociability + Math.random() * 0.3]);
        }
        for (const [a, b] of pairs.sort((x, y) => y[2] - x[2])) {
            if (st.active.length >= MAX_ACTIVE) break;
            if (busy(a) || busy(b)) continue;
            // the host is the one on a task the other can also do
            const [host, guest] = [[a, b], [b, a]].find(([h, g]) => {
                const t = taskById(m.bots.get(h).bot._lastTask);
                return t && t.canRun(m.bots.get(g).bot) === true;
            }) ?? [];
            if (!host) continue;
            const hb = m.bots.get(host).bot;
            if (dist(hb.s, m.bots.get(guest).bot.s) > REACH) continue;
            st.active.push({ host, guest, task: hb._lastTask, at: { x: hb.s.x, y: hb.s.y }, until: now + MINUTES * 60_000 });
            st.last[`${a}|${b}`] = now;
            this.log(`[meetup] ${guest} goes to train ${hb._lastTask} with ${host} at ${hb.s.x},${hb.s.y}`);
        }
        write(st);
    }
    async join(bot) {
        const st = read(), now = Date.now();
        const x = st.active.find(x => x.guest === bot.name && x.until > now && !x.started);
        if (!x) return false;
        x.started = true; write(st);
        const task = taskById(x.task), host = this.market.bots.get(x.host)?.bot;
        if (!task || task.canRun(bot) !== true || !host?.s?.online) return false;
        const at = host.s ?? x.at;
        bot.log(`meetup: training ${x.task} with ${x.host}`);
        await bot.travel(at.x, at.y, { tol: 6, timeout: 400 }).catch(() => {});
        await bot.act({ type: 'say', text: `Hey ${x.host}! Mind if I join you?`.slice(0, 80) }).catch(() => {});
        await sleep(2500);
        host.act({ type: 'say', text: `Sure ${bot.name}! ${line(x.task)}`.slice(0, 80) }).catch(() => {});
        const end = Math.min(x.until, now + MINUTES * 60_000);
        const chat = setInterval(() => { if (Math.random() < 0.5) bot.act({ type: 'say', text: line(x.task) }).catch(() => {}); }, 6 * 60_000);
        try { await task.run(bot, end); } finally { clearInterval(chat); }
        const s = this.market.social;
        s.adjustTrust(bot.name, x.host, 0.04); s.adjustTrust(x.host, bot.name, 0.04);
        s.bumpMood?.(bot.name, 0.05, `training with ${x.host}`); s.bumpMood?.(x.host, 0.05, `training with ${bot.name}`);
        note(bot.name, `Trained ${x.task.replace('_', ' and ')} with my friend ${x.host}.`);
        note(x.host, `${bot.name} came to train ${x.task.replace('_', ' and ')} with me.`);
        return true;
    }
}
