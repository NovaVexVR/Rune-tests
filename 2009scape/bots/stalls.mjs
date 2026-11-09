// Bot-run stalls (roadmap 56). Every 2 hours, if no stall is open, a merchant (merchant career or merchant personality)
// that is online and has tradeable goods in its bank opens one: it takes up to six kinds of goods out as notes, stands
// in Varrock square for 40 minutes and shouts its prices every couple of minutes, like players do. The market's usual
// need-matching then finds it (the goods are in its bag), so bots that need food, tools or bars come and trade. When it
// closes, the stall-keeper banks what's left and writes how it went. Runners call join(bot) between plan steps.
import fs from 'fs';
import path from 'path';
import { note } from './diary.mjs';
import { sleep } from './lib.mjs';
import { TRADEABLE } from './market.mjs';
import { personalityOf } from './social.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'stalls.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { open: null, last: 0, history: [] }; } };
const write = st => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st, null, 1)); };
const SQUARE = { x: 3212, y: 3424 }, MINUTES = 40, EVERY_HOURS = 2;
const CAREERS = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'careers.json');
const isMerchant = name => { try { if (JSON.parse(fs.readFileSync(CAREERS, 'utf8'))[name]?.career === 'merchant') return true; } catch {} return personalityOf(name).archetype === 'merchant'; };
const goodsOf = s => (s?.bank ?? []).filter(i => TRADEABLE.has(i.name) && i.count >= 3 && i.name !== 'Coins');

export class Stalls {
    constructor(market, log = () => {}) { this.market = market; this.log = log; }
    tick() {
        const st = read(), now = Date.now(), m = this.market;
        if (st.open && st.open.until < now) st.open = null;
        if (st.open || now - st.last < EVERY_HOURS * 3600_000) return write(st);
        const keeper = [...m.bots.keys()].filter(n => isMerchant(n) && m.bots.get(n).bot.s?.online && !m.isBusy(n) && !m.away?.has(n))
            .sort((a, b) => goodsOf(m.bots.get(b).bot.s).length - goodsOf(m.bots.get(a).bot.s).length)[0];
        if (!keeper || !goodsOf(m.bots.get(keeper).bot.s).length) return write(st);
        st.open = { keeper, until: now + (MINUTES + 10) * 60_000, started: false };
        st.last = now;
        this.log(`[stall] ${keeper} will open a stall in Varrock square`);
        write(st);
    }
    async join(bot) {
        const st = read();
        if (st.open?.keeper !== bot.name || st.open.started) return false;
        st.open.started = true; write(st);
        const m = this.market;
        const goods = goodsOf(bot.s).slice(0, 6);
        if (!goods.length || !(await bot.openBank())) return false;
        for (const g of goods) if (bot.s.invFree > 2) await bot.withdrawN(g.name, Math.min(g.count - 1, 30), { noted: true });
        await bot.leaveBank();
        await bot.travel(SQUARE.x, SQUARE.y, { tol: 3, timeout: 600 }).catch(() => {});
        const c0 = bot.s.coins ?? 0, end = Date.now() + MINUTES * 60_000;
        const carried = () => bot.s.inv.filter(i => goods.some(g => g.name === i.name));
        bot.log(`stall: open in Varrock square with ${carried().map(i => `${i.count} ${i.name}`).join(', ')}`);
        note(bot.name, `Opened a stall in Varrock square: ${goods.map(g => g.name).join(', ')}.`);
        while (Date.now() < end && carried().length) {
            const ad = carried().slice(0, 3).map(i => `${i.name} ${Math.max(1, Math.round(m.perceived(bot.name, i.name) * 1.1))}gp`).join(', ');
            await bot.act({ type: 'say', text: `Selling ${ad}! Trade me!`.slice(0, 80) }).catch(() => {});
            for (let i = 0; i < 12 && Date.now() < end; i++) { // ~2 minutes between shouts; trades happen through the market meanwhile
                await sleep(10_000);
                await bot.state(4).catch(() => {});
                if (!m.isBusy(bot.name)) await bot.handleInterrupts().catch(() => {});
            }
        }
        const earned = (bot.s.coins ?? 0) - c0;
        bot.log(`stall: closing, ${earned >= 0 ? '+' : ''}${earned}gp`);
        note(bot.name, `Closed my stall in Varrock square${earned > 0 ? ` with ${earned}gp more than I opened with` : ''}.`);
        st.history = [...(read().history ?? []), { keeper: bot.name, t: new Date().toISOString(), earned }].slice(-30);
        st.open = null; write(st);
        await bot.bankItems(i => goods.some(g => g.name === i.name) || i.name === 'Coins').catch(() => {});
        return true;
    }
}
