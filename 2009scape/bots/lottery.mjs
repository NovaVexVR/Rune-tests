// The gambler's lottery (roadmap 45). Weekly: a gambler bot sells 5gp tickets to bots that like a flutter (real
// coin trades), then draws a winner and pays out the pot. A greedy, disloyal organizer may run off with it
// instead: that's recorded as an IOU to the winner, due in a day, so the court hears it when it defaults.
// market/lottery.json; hourly from the runner.
import fs from 'fs';
import path from 'path';
import { note } from './diary.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FILE = path.join(ROOT, 'market', 'lottery.json');
const EVERY = Number(process.env.LOTTERY_EVERY_HOURS ?? 168) * 3600_000, SELL = 6 * 3600_000, PRICE = 5;
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { next: Date.now() + 3600_000, current: null, history: [] }; } };

export function lottery(market, log = () => {}) {
    const st = read(), s = market.social, now = Date.now();
    const online = n => market.bots.get(n)?.bot.s?.online;
    const say = (n, t) => market.bots.get(n)?.bot.act({ type: 'say', text: t.slice(0, 80) }).catch(() => {});
    const coins = n => { const b = market.bots.get(n)?.bot.s; return (b?.coins ?? 0) + (b?.bank ?? []).filter(i => i.name === 'Coins').reduce((t, i) => t + i.count, 0); };
    if (!st.current && now >= st.next) {
        const org = [...market.bots.keys()].filter(n => online(n) && s.p(n).archetype === 'gambler').sort(() => Math.random() - 0.5)[0];
        if (!org) { st.next = now + 6 * 3600_000; }
        else {
            st.current = { org, start: now, draw: now + SELL, tickets: [] };
            say(org, `Lottery! ${PRICE}gp a ticket, draw in six hours. Feeling lucky?`);
            note(org, 'Started a lottery.');
            log(`[lottery] ${org} opens the lottery`);
        }
    }
    const c = st.current;
    if (c && now < c.draw) {
        // sell a few tickets each hour to bots who like a bet and can spare the coins
        for (const n of [...market.bots.keys()].filter(n => n !== c.org && online(n) && !c.tickets.includes(n) && coins(n) >= 30 && Math.random() < 0.15 + 0.5 * (1 - s.p(n).caution) * (s.trust(n, c.org) >= 0 ? 1 : 0.2)).slice(0, 4)) {
            market.open({ buyer: c.org, seller: n, item: 'Coins', amount: PRICE, price: 0, kind: 'gift' }); // the ticket money
            c.tickets.push(n);
            log(`[lottery] ${n} buys a ticket from ${c.org}`);
        }
    } else if (c) {
        const pot = c.tickets.length * PRICE;
        const winner = c.tickets[Math.floor(Math.random() * c.tickets.length)];
        if (!winner) { say(c.org, 'No takers this week. Cowards, the lot of you.'); }
        else {
            const p = s.p(c.org);
            const bolts = Math.random() < 0.25 * p.greed * (1 - p.loyalty) * 2; // greedy and disloyal: off with the pot
            say(c.org, `The lottery winner is ${winner}! ${pot}gp!`);
            note(winner, `Won ${c.org}'s lottery: ${pot}gp!`);
            if (bolts) {
                const iou = s.createIou(c.org, winner, 'Coins', pot / (1 + s.interest(winner)), 24 * 60);
                iou.owed = pot; s.saveIous?.();
                note(c.org, `Kept the lottery pot (${pot}gp) instead of paying ${winner}. They'll get over it.`);
                market.dm?.(winner, c.org, `Where's my ${pot}gp?`);
                log(`[lottery] ${c.org} runs off with the ${pot}gp pot; ${winner} is owed it (IOU #${iou.id})`);
            } else {
                market.open({ buyer: winner, seller: c.org, item: 'Coins', amount: pot, price: 0, kind: 'gift' });
                for (const n of c.tickets) s.adjustTrust(n, c.org, 0.02);
                log(`[lottery] ${winner} wins ${pot}gp from ${c.org}'s lottery`);
            }
            st.history.push({ org: c.org, winner, pot, tickets: c.tickets.length, bolted: bolts, t: new Date().toISOString() });
            st.history = st.history.slice(-20);
        }
        st.current = null;
        st.next = now + EVERY;
        s.save?.();
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st, null, 1));
}
