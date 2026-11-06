// In-game check of the Grand Exchange bot API: one bot sells logs, another buys them, both collect.
//   node test_ge.mjs setup   create gebot1/gebot2, put them at the GE (saves), give logs / coins
//   node test_ge.mjs run     place the offers through the GE screen and collect the results
import fs from 'fs';
import path from 'path';
import { Bot, GE, sleep } from './lib.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SAVES = process.env.SAVES ?? path.resolve(ROOT, '../../../2009scape-server/Server/data/players');
const LOGS = 1511, COINS = 995;
const PRICE = 6, QTY = 10;

function stage(name, items) {
    const f = path.join(SAVES, `${name}.json`);
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    d.core_data.location = `${GE.x + (name === 'gebot1' ? -2 : 2)},${GE.y - 6},0`;
    let inv = (d.core_data.inventory ??= []).filter(i => !Object.keys(items).includes(i.id));
    // room for the staged items: a test bot's bag fills up over many runs
    const needed = Object.entries(items).reduce((t, [id, n]) => t + (Number(id) === COINS ? 1 : n), 0);
    while (inv.length > 28 - needed) inv.pop();
    const free = () => [...Array(28).keys()].find(k => !inv.some(i => Number(i.slot) === k));
    for (const [id, amount] of Object.entries(items)) {
        if (Number(id) === COINS) { { const sl = free(); if (sl !== undefined) inv.push({ amount: String(amount), charge: '1000', slot: String(sl), id }); }; continue; }
        for (let k = 0; k < amount; k++) { const sl = free(); if (sl !== undefined) inv.push({ amount: '1', charge: '1000', slot: String(sl), id }); };
    }
    d.core_data.inventory = inv;
    fs.writeFileSync(f, JSON.stringify(d));
}

if (process.argv[2] === 'setup') {
    for (const [name, items] of [['gebot1', { [LOGS]: QTY }], ['gebot2', { [COINS]: 200 }]]) {
        const b = new Bot(name, { quiet: true });
        await b.login(); await b.onboard(); await b.logout(); await sleep(3000);
        stage(name, items);
        console.log(`${name} staged at the GE`);
    }
    process.exit(0);
}

const seller = new Bot('gebot1'), buyer = new Bot('gebot2');
await seller.login(); await buyer.login();
// leftover offers from an earlier run: cancel and collect them first
for (const b of [seller, buyer]) {
    for (const o of (await b.state(1)).ge ?? []) if (o.done < o.amount) await b.geAbort(o.slot);
    if ((await b.state(1)).ge?.length) await b.geCollect();
    await b.closeInterfaces(); await b.state(1);
}
const logs = b => b.s.inv.filter(i => /^Logs$/.test(i.name)).reduce((n, i) => n + i.count, 0);
await seller.state(); await buyer.state();
console.log(`before: seller ${logs(seller)} logs ${seller.s.coins}gp; buyer ${logs(buyer)} logs ${buyer.s.coins}gp`);
const sSlot = await seller.geOffer({ item: 'Logs', sell: true, amount: QTY, price: PRICE });
const bSlot = await buyer.geOffer({ item: 'Logs', sell: false, amount: QTY, price: PRICE + 1 });
console.log(`offers: seller slot ${sSlot}, buyer slot ${bSlot}`);
for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const [a, b] = [await seller.state(1), await buyer.state(1)];
    const so = a.ge?.find(o => o.slot === sSlot), bo = b.ge?.find(o => o.slot === bSlot);
    if (i % 5 === 0 || (so?.done === QTY && bo?.done === QTY)) console.log(`seller ${so?.state} ${so?.done}/${so?.amount} collect ${JSON.stringify(so?.collect)} | buyer ${bo?.state} ${bo?.done}/${bo?.amount} collect ${JSON.stringify(bo?.collect)}`);
    if (so?.done === QTY && bo?.done === QTY) break;
}
console.log(`collected: seller ${await seller.geCollect()}, buyer ${await buyer.geCollect()}`);
await seller.closeInterfaces(); await buyer.closeInterfaces();
await seller.state(); await buyer.state();
console.log(`after: seller ${logs(seller)} logs ${seller.s.coins}gp, offers ${JSON.stringify(seller.s.ge ?? [])}; buyer ${logs(buyer)} logs (inv: ${buyer.s.inv.map(i => `${i.name}x${i.count}`).join(', ')}) ${buyer.s.coins}gp, offers ${JSON.stringify(buyer.s.ge ?? [])}`);
process.exit(0);
