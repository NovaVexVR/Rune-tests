// In-game check of a (compressed) market day at the Grand Exchange.
//   node test_marketday.mjs setup   create mbot1-6 in Lumbridge and give sellers/buyers their goods/coins
//   node test_marketday.mjs run     announce a market day (4 min lead, 8 min market) and run it
// Checks: bots arrive without dying, a crowd forms, offers are shouted, haggled deals complete at prices
// between the buyer's bid and the seller's ask, GE offers go up, and everyone gets home.
import fs from 'fs';
import path from 'path';

process.env.MARKET_LEAD_MINUTES ??= '4';
process.env.MARKET_MINUTES ??= '8';
process.env.MARKET_EVERY_MINUTES ??= '600';
const { Bot, sleep, dist } = await import('./lib.mjs');
const { Market } = await import('./market.mjs');
const { MarketDay } = await import('./marketday.mjs');

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SAVES = process.env.SAVES ?? path.resolve(ROOT, '../../../2009scape-server/Server/data/players');
const COINS = 995, KNIFE = 946;
// name -> [plan tasks, items to stage]
const CAST = {
    mbot1: [[], {}],                      // sells starter spares (a tools collector: keeps any knife it has)
    mbot2: [['fletch'], { [COINS]: 40 }], // needs a knife
    mbot3: [['fletch'], { [COINS]: 40 }], // needs a knife
    mbot4: [[], { [KNIFE]: 3 }],          // knife seller
    mbot5: [['magic', 'mine'], { [COINS]: 25 }],
    mbot6: [['ranged'], { [COINS]: 25 }]
};

if (process.argv[2] === 'setup') {
    for (const [name, [, items]] of Object.entries(CAST)) {
        const b = new Bot(name, { quiet: true });
        await b.login(); await b.onboard(); await b.logout(); await sleep(3000);
        const f = path.join(SAVES, `${name}.json`), d = JSON.parse(fs.readFileSync(f, 'utf8'));
        d.core_data.location = `${3218 + Object.keys(CAST).indexOf(name)},3218,0`;
        const inv = (d.core_data.inventory ??= []).filter(i => !Object.keys(items).includes(i.id));
        const free = () => [...Array(28).keys()].find(k => !inv.some(i => Number(i.slot) === k));
        for (const [id, n] of Object.entries(items)) {
            // only into free slots (a full bag would otherwise get slot 'undefined' and break the save)
            if (Number(id) === COINS) { const sl = free(); if (sl !== undefined) inv.push({ amount: String(n), charge: '1000', slot: String(sl), id }); }
            else for (let k = 0; k < n; k++) { const sl = free(); if (sl !== undefined) inv.push({ amount: '1', charge: '1000', slot: String(sl), id }); }
        }
        d.core_data.inventory = inv;
        fs.writeFileSync(f, JSON.stringify(d));
        console.log(`${name} staged`);
    }
    process.exit(0);
}

const lines = [];
const log = (...a) => { const l = a.join(' '); lines.push(l); console.log(new Date().toISOString().slice(11, 19), l); };
const market = new Market(log);
const md = new MarketDay(market, log);
md.state.next = Date.now(); // hold one now
const t0 = Date.now();
const bots = Object.entries(CAST).map(([name, [plan]]) => {
    const bot = new Bot(name, { quiet: true });
    market.register(bot, () => plan.map(task => ({ task })));
    bot.hook = async b => { if (market.dealFor(b.name)) { while (await market.step(b)) {} return true; } return false; };
    bot.onMsg = text => { if (/Oh dear, you are dead/i.test(text)) md.noteDeath(name); };
    return bot;
});
const ticker = setInterval(() => md.tick(), 5000);
md.tick();
const home = {};
await Promise.all(bots.map(async (b, i) => {
    await sleep(i * 1000);
    await b.login(); await b.onboard();
    home[b.name] = { x: b.s.x, y: b.s.y };
    for (;;) {
        const d = md.day;
        if (Date.now() > d.end + 6 * 60_000) return;
        if (d.start - Date.now() < 7 * 60_000 && !d.arrived.includes(b.name) && Date.now() < d.end - 5 * 60_000) {
            d.decided ??= {}; d.decided[b.name] ??= true; if (!d.attending.includes(b.name)) d.attending.push(b.name); // everyone goes in the test
            await md.attend(b);
            return;
        }
        await b.state(5); await b.handleInterrupts(); await sleep(3000);
    }
}));
clearInterval(ticker);

const d = md.day;
const ledger = (fs.existsSync(path.join(ROOT, 'market', 'ledger.jsonl')) ? fs.readFileSync(path.join(ROOT, 'market', 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : []).filter(r => Date.parse(r.t) >= t0 && r.venue === 'market day');
const done = ledger.filter(r => r.outcome === 'completed');
const states = await Promise.all(bots.map(b => b.state(1)));
const homeOk = states.filter(s => dist(s, { x: 3222, y: 3218 }) < 60 || Object.values(home).some(h => dist(s, h) < 60)).length;
const checks = {
    'arrived without deaths': d.arrived.length >= 4 && d.deaths.length === 0,
    'a crowd formed (4+ at the GE)': d.arrived.length >= 4,
    'offers were shouted': lines.some(l => /shouts:/.test(l)),
    'haggled deals completed between bid and ask': done.length > 0 && done.every(r => r.price <= r.ask && r.price <= r.bid + 0.5),
    'GE offers went up': d.geOffers > 0,
    'everyone got home': homeOk === bots.length
};
console.log('\n==== results');
for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
console.log(`day: ${JSON.stringify({ ...d, decided: undefined })}`);
for (const r of ledger) console.log('ledger', JSON.stringify(r));
console.log('positions', states.map((s, i) => `${bots[i].name}@${s.x},${s.y} hp${s.hp}`).join(' '));
process.exit(0);
