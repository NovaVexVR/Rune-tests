// Phase 4.1: market days at the Grand Exchange.
//
// Once a day (MARKET_EVERY_MINUTES, default 1440) a 20-minute market (MARKET_MINUTES) is held at the
// Grand Exchange in Varrock. Claude-directed bots with spare goods, or with needs and coins, cut their
// current task short, travel there on the safe route (lib.travel avoids the dark wizards), and trade:
//   - sellers shout their asking price for what they can spare;
//   - a buyer who needs a shouted item opens below the ask, the seller counters between the two, and the
//     buyer takes it if the counter is within what it will pay. The deal then goes through the normal
//     trade window, where each side re-checks it against its own perceived values;
//   - halfway through, goods nobody bought go up as GE sell offers, and unmet needs as GE buy offers;
//   - at closing time bots collect from the GE, cancel what didn't fill, and travel home.
// State: market/marketday.json (schedule, attendance, results). Chat and deals go to the market log/ledger.
import fs from 'fs';
import path from 'path';
import { rand, sleep } from './lib.mjs';
import { personalityOf, SPOTS } from './social.mjs';
import { note } from './diary.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'marketday.json');
const EVERY = Number(process.env.MARKET_EVERY_MINUTES ?? 24 * 60) * 60_000;
const LENGTH = Number(process.env.MARKET_MINUTES ?? 20) * 60_000;
const LEAD = Number(process.env.MARKET_LEAD_MINUTES ?? 50) * 60_000; // announced this long before opening, so bots can wrap up their current task and travel
const CROWD = { x: 3165, y: 3476 }; // the GE hall, south of the clerks' booths
const SHOUT_EVERY = 75_000;

export class MarketDay {
    constructor(market, log = console.log) {
        this.market = market;
        this.log = log;
        this.state = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { next: Date.now() + LEAD, days: [] };
        this.shouts = new Map(); // seller -> { item, amount, ask, t }
        this.onTrip = new Set(); // bots on the way, at the market, or on the way home
        this.offers = new Map(); // `${buyer}>${seller}>${item}` -> time of last haggle (one per pair and item per few minutes)
        this.save();
    }

    save() { fs.writeFileSync(FILE, JSON.stringify(this.state, null, 2)); }
    get day() { return this.state.days.at(-1); }
    get open() { const d = this.day; return !!d && Date.now() >= d.start && Date.now() < d.end; }
    upcoming() { const d = this.day; return !!d && Date.now() < d.end; }

    // called every minute by the runner
    tick() {
        if (!this.upcoming() && Date.now() >= this.state.next - LEAD) {
            const start = Math.max(Date.now() + LEAD, this.state.next);
            this.state.days.push({ start, end: start + LENGTH, attending: [], arrived: [], deals: 0, geOffers: 0, deaths: [] });
            this.state.next = start + EVERY;
            this.save();
            this.log(`[marketday] market day at the Grand Exchange opens ${new Date(start).toISOString().slice(11, 16)} UTC for ${LENGTH / 60_000} minutes`);
            // the most sociable online bot spreads the word
            const herald = [...this.market.bots.keys()].filter(n => this.market.bots.get(n).bot.s?.online).sort((a, b) => personalityOf(b).sociability - personalityOf(a).sociability)[0];
            if (herald) this.market.bots.get(herald).bot.act({ type: 'say', text: 'Market day at the Grand Exchange soon! Bring your spares.' }).catch(() => {});
        }
    }

    // Does this bot go? Decided once per market day: something to sell, or needs and coins; sociable bots go more readily.
    wants(name) {
        const d = this.day;
        if (!d || Date.now() >= d.end - 5 * 60_000) return false;
        d.decided ??= {};
        if (name in d.decided) return d.decided[name];
        const m = this.market, p = m.social.p(name);
        const goods = m.surplusOf(name).length > 0;
        const shopping = m.needsOf(name).length > 0 && m.coins(name) >= 10;
        const go = (goods || shopping) && p.mood > -0.6 && Math.random() < 0.45 + 0.5 * p.sociability;
        d.decided[name] = go;
        if (go) { d.attending.push(name); this.save(); }
        return go;
    }

    noteDeath(name) {
        const d = this.day;
        if (d && this.onTrip.has(name)) { d.deaths.push(name); this.save(); this.log(`[marketday] ${name} died on market day`); }
    }

    // Cut a task short so the bot leaves in time to make the opening.
    deadline(name, planned) {
        const d = this.day;
        if (!d || !this.wants(name)) return planned;
        return Math.min(planned, d.start - 6 * 60_000);
    }

    async attend(bot) {
        const m = this.market, name = bot.name, d = this.day;
        bot.log(`[marketday] heading to the Grand Exchange`);
        const home = SPOTS[personalityOf(name).habits?.spot] ?? SPOTS.courtyard;
        const startHp = bot.s?.hp;
        this.onTrip.add(name);
        try {
            const spot = { x: CROWD.x + rand(-5, 5), y: CROWD.y + rand(-3, 3) };
            if (!(await bot.travel(spot.x, spot.y, { timeout: 600 }))) { bot.log('[marketday] could not reach the GE, going home'); await bot.travel(home.x, home.y, { timeout: 600 }); this.onTrip.delete(name); return; }
            m.away.add(name);
            d.arrived.push(name); this.save();
            this.log(`[marketday] ${name} arrived at the GE (hp ${bot.s.hp}/${startHp})`);
            note(name, 'Went to market day at the Grand Exchange.', { once: 'first-market-day' }) || note(name, 'Market day at the Grand Exchange.');
            while (Date.now() < d.start) { await bot.state(5); await bot.handleInterrupts(); await sleep(3000); }
            let geDone = false;
            while (Date.now() < d.end) {
                await bot.state(15);
                if (await bot.handleInterrupts()) continue; // includes stepping through its deals
                if (!m.dealFor(name)) {
                    await this.shout(bot);
                    await this.haggle(bot);
                    if (!geDone && Date.now() > d.start + LENGTH / 2) { geDone = true; await this.postGeOffers(bot); }
                }
                await sleep(2500);
            }
            // closing time: settle with the GE
            while (m.dealFor(name)) { await bot.handleInterrupts(); await sleep(1500); }
            await this.closeGeOffers(bot);
        } finally {
            m.away.delete(name);
            this.shouts.delete(name);
        }
        bot.log(`[marketday] going home to ${home.label}`);
        await bot.travel(home.x, home.y, { timeout: 600 });
        this.onTrip.delete(name);
    }

    // Sellers call out their asking price for one of their spare goods.
    async shout(bot) {
        const m = this.market, name = bot.name;
        const last = this.shouts.get(name);
        if (last && Date.now() - last.t < SHOUT_EVERY) return;
        const spare = m.surplusOf(name);
        if (!spare.length) { this.shouts.delete(name); await this.callForNeeds(bot); return; }
        // read the crowd: what the other bots at the market need goes first, otherwise any spare
        const wanted = new Set(this.day.arrived.filter(o => o !== name).flatMap(o => m.needsOf(o)));
        const hot = spare.filter(i => wanted.has(i.name));
        const pool = hot.length ? hot : spare;
        const it = pool[Math.floor(Math.random() * pool.length)];
        if (!hot.length && Math.random() < 0.4 && (await this.callForNeeds(bot))) return;
        const amount = spare.filter(i => i.name === it.name).reduce((n, i) => n + i.count, 0);
        const ask = Math.max(1, Math.round(m.perceived(name, it.name) * m.social.askFactor(name, 'market')));
        this.shouts.set(name, { item: it.name, amount, ask, t: Date.now() });
        await bot.act({ type: 'say', text: `Selling ${amount > 1 ? amount + ' ' : ''}${it.name}, ${ask}gp${amount > 1 ? ' each' : ''}!` });
        this.log(`[marketday] ${name} shouts: ${amount} ${it.name} at ${ask}gp`);
    }

    // Buyers call out what they're after, so sellers who have it put it up.
    async callForNeeds(bot) {
        const m = this.market, name = bot.name;
        const need = m.needsOf(name)[0];
        if (!need || m.coins(name) < 2 || Date.now() - (this.calls?.[name] ?? 0) < SHOUT_EVERY) return false;
        (this.calls ??= {})[name] = Date.now();
        await bot.act({ type: 'say', text: `Buying ${need}! Anyone?` });
        this.log(`[marketday] ${name} calls for ${need}`);
        return true;
    }

    // A buyer who needs a shouted item haggles: opens low, the seller counters, the buyer takes it or walks away.
    async haggle(bot) {
        const m = this.market, buyer = bot.name, d = this.day;
        const needs = new Set(m.needsOf(buyer));
        for (const [seller, sh] of this.shouts) {
            if (seller === buyer || !needs.has(sh.item) || m.busy.has(seller) || m.dealFor(seller)) continue;
            const team = m.social.teamOf(buyer);
            if (team !== 'individual' && team === m.social.teamOf(seller)) continue; // teammates just give each other things
            if (m.social.isRival(buyer, seller) || m.social.isRival(seller, buyer)) continue;
            const key = `${buyer}>${seller}>${sh.item}`;
            if (Date.now() - (this.offers.get(key) ?? 0) < 4 * 60_000) continue;
            this.offers.set(key, Date.now());
            const pb = m.social.p(buyer);
            const max = m.perceived(buyer, sh.item) * m.social.bidFactor(buyer, seller); // the most it will pay
            const open = Math.max(1, Math.round(Math.min(max, sh.ask) * (0.9 - 0.2 * pb.greed)));
            const floor = m.perceived(seller, sh.item) * m.social.acceptRatio(seller, buyer); // the least the seller takes
            await bot.act({ type: 'say', text: `${seller}, ${open}gp for ${sh.item === 'Coins' ? 'it' : 'a ' + sh.item}?` });
            await bot.wait(2);
            const counter = Math.max(open, Math.ceil(Math.max(floor, (sh.ask + open) / 2)));
            const sb = m.bots.get(seller).bot;
            if (counter > sh.ask) { this.log(`[marketday] ${seller} won't go near ${open}gp for ${sh.item}`); await sb.act({ type: 'say', text: `No chance, ${buyer}.` }).catch(() => {}); continue; }
            await sb.act({ type: 'say', text: counter === open ? `Deal, ${buyer}.` : `${counter}gp and it's yours.` }).catch(() => {});
            if (counter > max || counter * 1 > m.coins(buyer)) {
                this.log(`[marketday] ${buyer} walks away from ${seller}'s ${counter}gp for ${sh.item} (would pay ${max.toFixed(1)})`);
                await bot.act({ type: 'say', text: `Too rich for me.` });
                continue;
            }
            if (m.dealFor(seller) || m.dealFor(buyer)) { await bot.act({ type: 'say', text: `Beaten to it.` }); continue; } // someone closed with them while we haggled
            if (counter !== open) await bot.act({ type: 'say', text: `Done.` });
            this.log(`[marketday] haggle: ${seller} asked ${sh.ask}, ${buyer} opened ${open}, settled at ${counter} for ${sh.item}`);
            m.open({ buyer, seller, item: sh.item, amount: 1, price: counter, kind: 'sale', ask: sh.ask, bid: Math.round(max * 10) / 10, venue: 'market day' });
            d.deals++; this.save();
            return;
        }
    }

    // Halfway through: put unsold spares and unmet needs on the Grand Exchange.
    async postGeOffers(bot) {
        const m = this.market, name = bot.name, d = this.day;
        const spare = m.surplusOf(name)[0];
        if (spare) {
            const price = Math.max(1, Math.round(m.perceived(name, spare.name) * m.social.askFactor(name, 'ge')));
            if ((await bot.geOffer({ item: spare.name, sell: true, amount: 1, price })) >= 0) { d.geOffers++; this.save(); }
        }
        const need = m.needsOf(name).find(n => !this.shouts.size || ![...this.shouts.values()].some(s => s.item === n));
        if (need) {
            const price = Math.max(1, Math.round(m.perceived(name, need) * m.social.bidFactor(name, 'ge')));
            if (m.coins(name) >= price && (await bot.geOffer({ item: need, sell: false, amount: 1, price })) >= 0) { d.geOffers++; this.save(); }
        }
        await bot.closeInterfaces();
    }

    // Closing time: take what filled, cancel the rest and take the refund.
    async closeGeOffers(bot) {
        let s = await bot.state(1);
        if (!s.ge?.length) return;
        for (const o of s.ge) {
            if (o.done < o.amount) await bot.geAbort(o.slot);
            if (o.done > 0) this.log(`[marketday] ${bot.name}'s GE offer filled: ${o.sell ? 'sold' : 'bought'} ${o.done} ${o.name} at ${o.price}gp`);
        }
        await sleep(2000);
        await bot.geCollect();
        await bot.closeInterfaces();
    }
}
