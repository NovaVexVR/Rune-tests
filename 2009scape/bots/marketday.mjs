// Market days at the Grand Exchange (Phase 4.1).
// Every MARKET_DAY_HOURS a 20-minute market opens at the GE. Bots with spare goods (or coins to spend)
// walk there on the safe route, shout their asking prices, trade face to face with the other bots at the
// market (normal deal flow, personality-based acceptance), post one GE sell offer, collect, and go home.
// Attending runs from the runner's hook, like debt-collector hounding.
import fs from 'fs';
import path from 'path';
import { GE } from './lib.mjs';
import { capFor } from './politics.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'marketday.json');
const EVERY_H = Number(process.env.MARKET_DAY_HOURS ?? 6);
const MINUTES = Number(process.env.MARKET_DAY_MINUTES ?? 20);
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const near = (s, r = 15) => s?.online && Math.abs(s.x - GE.x) <= r && Math.abs(s.y - GE.y) <= r;

export class MarketDay {
    constructor(market) {
        this.market = market;
        this.st = load(); // { next, active: { id, opens, closes, attendees: [] }, count }
        this.st.next ??= Date.now() + 15 * 60_000; // first market shortly after start
        this.save();
    }

    save() { fs.writeFileSync(FILE, JSON.stringify(this.st, null, 2)); }
    log(t) { this.market.log(`[marketday] ${t}`); }

    // called often (from every bot's hook): opens and closes markets
    tick() {
        const now = Date.now(), a = this.st.active;
        if (a && now > a.closes + 10 * 60_000) { this.log(`market day #${a.id} is over`); this.st.active = null; this.save(); }
        if (!this.st.active && now >= this.st.next) this.open();
    }

    open() {
        const m = this.market;
        const cands = [...m.bots.keys()].filter(n => m.bots.get(n).bot.s?.online && (m.surplusOf(n).length > 0 || m.coins(n) >= 30));
        cands.sort(() => Math.random() - 0.5);
        const cap = capFor(m, 16);
        const attendees = cands.slice(0, Math.min(cap, Math.ceil(m.bots.size / 3)));
        const id = (this.st.count = (this.st.count ?? 0) + 1);
        // travel time is part of the day: the market itself starts once the first bots can be there
        this.st.active = { id, opens: Date.now(), closes: Date.now() + (MINUTES + 15) * 60_000, attendees };
        this.st.next = Date.now() + EVERY_H * 3600_000;
        this.save();
        this.log(`market day #${id} at the Grand Exchange: ${attendees.length} bots heading there (${attendees.join(', ')})`);
    }

    // bots trade with each other only while both are at the market
    atMarket(name) {
        const a = this.st.active;
        return !!a && a.attendees.includes(name) && near(this.market.bots.get(name)?.bot.s);
    }

    // market haggling: buy another stall's spare item when our bid meets their ask (prices meet in the middle)
    async browse(bot) {
        const m = this.market, name = bot.name;
        if (m.busy.has(name) || Math.random() < 0.5) return;
        // no flipping the same goods back and forth: don't buy back what you sold here, don't resell what you bought here
        const a = this.st.active;
        a.bought ??= {}; a.sold ??= {};
        if ((a.bought[name] ?? []).length >= 8) return; // up to 8 purchases per market, not the whole purse
        const stalls = this.st.active.attendees.filter(o => o !== name && !m.busy.has(o) && this.atMarket(o)
            && !m.social.isRival(name, o) && !m.social.isRival(o, name));
        const offers = [];
        for (const o of stalls) for (const it of m.surplusOf(o)) {
            if (it.name === 'Coins' || (a.sold[name] ?? []).includes(it.name) || (a.bought[o] ?? []).includes(it.name)) continue;
            const ask = Math.round(m.perceived(o, it.name) * m.social.askFactor(o, name) * 10) / 10;
            const bid = Math.round(m.perceived(name, it.name) * m.social.bidFactor(name, o) * 10) / 10;
            const price = Math.max(1, Math.round((ask + bid) / 2));
            if (bid >= ask && m.coins(name) >= price && price >= 2) offers.push({ o, item: it.name, ask, bid, price, gain: bid - ask });
        }
        if (!offers.length) return;
        const d = offers.sort((x, y) => y.gain - x.gain)[0];
        await bot.act({ type: 'say', text: `${d.o}, I'll give you ${d.price}gp for your ${d.item}.` });
        m.open({ buyer: name, seller: d.o, item: d.item, amount: 1, price: d.price, kind: 'sale', ask: d.ask, bid: d.bid });
        (a.bought[name] ??= []).push(d.item); (a.sold[d.o] ??= []).push(d.item); this.save();
        this.log(`${name} haggles with ${d.o} over ${d.item}: ${d.price}gp (ask ${d.ask}, bid ${d.bid})`);
    }

    // the bot's turn at the market; returns true if it went
    async attend(bot) {
        this.tick();
        const a = this.st.active, name = bot.name, m = this.market;
        if (!a) return false;
        a.went ??= [];
        if (!a.attendees.includes(name) || a.went.includes(name) || Date.now() > a.closes || bot._questing) return false;
        if (m.dealFor(name)) return false; // finish what it's doing first
        a.went.push(name); this.save(); // remembered across runner restarts
        this.log(`${name} sets off for market day #${a.id}`);
        if (!(await bot.walkToGE())) { this.log(`${name} couldn't get to the market`); return true; }
        const until = Math.min(a.closes, Date.now() + MINUTES * 60_000);
        let lastShout = 0, posted = false;
        while (Date.now() < until) {
            await bot.state(10);
            if (m.dealFor(name)) { while (await m.step(bot)) {} continue; }
            await bot.handleInterrupts();
            // sellers shout their asking prices now and then
            const spare = m.surplusOf(name);
            if (spare.length && Date.now() - lastShout > 90_000 + Math.random() * 60_000) {
                lastShout = Date.now();
                const it = spare[Math.floor(Math.random() * spare.length)];
                const ask = Math.max(1, Math.round(m.perceived(name, it.name) * m.social.askFactor(name, null)));
                await bot.act({ type: 'say', text: `Selling ${it.name}, ${ask}gp!` });
            }
            // one GE sell offer for its most valuable spare item, at its own asking price
            if (!posted && spare.length && Math.random() < 0.3) {
                posted = true;
                const it = [...spare].sort((x, y) => m.perceived(name, y.name) - m.perceived(name, x.name))[0];
                const ask = Math.max(1, Math.round(m.perceived(name, it.name) * m.social.askFactor(name, null)));
                const o = await bot.geOffer('sell', it.name, 1, ask);
                if (o) this.log(`${name} put 1 ${it.name} on the GE for ${ask}gp (${o.state})`);
                await bot.act({ type: 'close' }).catch(() => {});
            }
            await m.seek(name); // face-to-face deals for what it needs (limited to bots at the market, see Market.seek)
            if (!m.dealFor(name)) await this.browse(bot);
            if (!m.dealFor(name)) await bot.wait(8);
        }
        if (posted) {
            const n = await bot.geCollect();
            if (n) this.log(`${name} collected ${n} GE stacks`);
            await bot.act({ type: 'close' }).catch(() => {});
        }
        this.log(`${name} heads home from market day #${a.id}`);
        await bot.walkFromGE();
        return true;
    }
}
