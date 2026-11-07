// Town events (roadmap D20): a fishing contest and a smithing fair, taking turns every EVENT_EVERY_HOURS (default
// 84: each twice a week). Announced in chat an hour ahead; during the EVENT_MINUTES window (default 60) entrants
// who can do the skill switch to it; whoever gains the most xp wins: a public cheer, a diary line, respect from
// the town (and the runner-up a mention). Kept in bots/market/events.json; the recap reads it.
//   const ev = new TownEvents(market, log); setInterval(() => ev.tick(), 60_000)
//   ev.taskFor(bot) -> the event's task id while an event is on and the bot is entered, else null
import fs from 'fs';
import path from 'path';
import { note } from './diary.mjs';
import { careerOf } from './careers.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'events.json');
const EVERY = Number(process.env.EVENT_EVERY_HOURS ?? 84) * 3600_000;
const LEAD = Number(process.env.EVENT_LEAD_MINUTES ?? 60) * 60_000;
const LENGTH = Number(process.env.EVENT_MINUTES ?? 60) * 60_000;
export const KINDS = {
    fishing: { title: 'fishing contest', skill: 'fishing', task: 'fish_cook', career: 'fisher' },
    smithing: { title: 'smithing fair', skill: 'smithing', task: 'smith', career: 'smith', alt: 'smelt' }
};

export class TownEvents {
    constructor(market, log = console.log) {
        this.market = market;
        this.log = log;
        try { this.state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { this.state = { next: Date.now() + EVERY / 2, kind: 'fishing', past: [] }; }
    }
    save() { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(this.state, null, 1)); }
    get current() { return this.state.current ?? null; }
    say(text) {
        const online = [...this.market.bots.keys()].filter(n => this.market.bots.get(n).bot.s?.online);
        const herald = online.sort((a, b) => this.market.social.p(b).sociability - this.market.social.p(a).sociability)[0];
        if (herald) this.market.bots.get(herald).bot.act({ type: 'say', text: text.slice(0, 80) }).catch(() => {});
    }
    xp(name, skill) { return this.market.bots.get(name)?.bot.s?.stats?.[skill]?.xp ?? null; }

    tick() {
        const now = Date.now(), st = this.state;
        if (!st.current && now >= st.next - LEAD && !st.announced) {
            st.announced = true;
            this.say(`${KINDS[st.kind].title[0].toUpperCase() + KINDS[st.kind].title.slice(1)} in an hour! Most ${KINDS[st.kind].skill} wins.`);
            this.log(`[event] ${KINDS[st.kind].title} announced`);
            this.save();
        }
        if (!st.current && now >= st.next) {
            const k = KINDS[st.kind];
            const start = {};
            for (const [n] of this.market.bots) { const x = this.xp(n, k.skill); if (x !== null) start[n] = x; }
            st.current = { kind: st.kind, start: now, end: now + LENGTH, xp0: start, entrants: [] };
            this.say(`The ${k.title} has begun!`);
            this.log(`[event] ${k.title} begins`);
            this.save();
        }
        const c = st.current;
        if (c && now >= c.end) {
            const k = KINDS[c.kind];
            const gains = c.entrants.map(n => [n, (this.xp(n, k.skill) ?? c.xp0[n] ?? 0) - (c.xp0[n] ?? 0)]).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1]);
            const [win, second] = gains;
            if (win) {
                this.say(`${win[0]} wins the ${k.title} with ${Math.round(win[1])} xp!${second ? ` ${second[0]} close behind.` : ''}`);
                note(win[0], `Won the ${k.title} (${Math.round(win[1])} ${k.skill} xp in an hour)!`);
                if (second) note(second[0], `Came second in the ${k.title}, behind ${win[0]}.`);
                for (const [other] of this.market.bots) if (other !== win[0]) this.market.social.adjustTrust(other, win[0], 0.03);
                this.market.social.save();
            } else this.say(`Nobody entered the ${k.title}. Maybe next time.`);
            this.log(`[event] ${k.title} over: ${gains.slice(0, 3).map(([n, g]) => `${n} ${Math.round(g)}xp`).join(', ') || 'no entrants'}`);
            st.past.push({ kind: c.kind, start: c.start, end: c.end, results: gains.slice(0, 5).map(([n, g]) => ({ bot: n, xp: Math.round(g) })) });
            st.past = st.past.slice(-20);
            delete st.current;
            st.announced = false;
            st.kind = c.kind === 'fishing' ? 'smithing' : 'fishing';
            st.next = now + EVERY;
            this.save();
        }
    }

    // while an event is on: the event's task for bots that would enter (its career, or a coin flip by sociability)
    taskFor(bot, canRun) {
        const c = this.current;
        if (!c || Date.now() >= c.end) return null;
        const k = KINDS[c.kind];
        const t = [k.task, k.alt].find(id => id && canRun(id) === true);
        if (!t) return null;
        if (!c.entrants.includes(bot.name)) {
            const keen = careerOf(bot)?.career === k.career || Math.random() < 0.6 * this.market.social.p(bot.name).sociability + 0.2;
            if (!keen) return null;
            c.entrants.push(bot.name);
            if (c.xp0[bot.name] === undefined) c.xp0[bot.name] = this.xp(bot.name, k.skill) ?? 0;
            this.save();
            note(bot.name, `Entered the ${k.title}.`);
        }
        return t;
    }
}
