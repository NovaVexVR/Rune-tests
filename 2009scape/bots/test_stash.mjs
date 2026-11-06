// In-game check of the team stash: a teammate gets a tool out of the treasurer's bank, and donates spare goods.
//   node test_stash.mjs setup   create sbot1 (member) and sbot2 (treasurer); a Knife and 5 shrimps in sbot2's bank,
//                               5 logs in sbot1's bag (saves)
//   node test_stash.mjs run     the team only exists in this process (not in market/teams.json)
import fs from 'fs';
import path from 'path';
import { Bot, sleep } from './lib.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SAVES = process.env.SAVES ?? path.resolve(ROOT, '../../../2009scape-server/Server/data/players');
if (process.argv[2] === 'setup') {
    for (const name of ['sbot1', 'sbot2']) {
        const b = new Bot(name, { quiet: true });
        await b.login(); await b.onboard(); await b.logout(); await sleep(3000);
        const f = path.join(SAVES, `${name}.json`), d = JSON.parse(fs.readFileSync(f, 'utf8'));
        d.core_data.location = name === 'sbot1' ? '3222,3219,0' : '3223,3219,0';
        if (name === 'sbot2') { // a Knife in the bag; the run banks it (hand-edited bank slots don't survive loading)
            const inv = d.core_data.inventory ??= [];
            const free = () => [...Array(28).keys()].find(k => !inv.some(i => Number(i.slot) === k));
            if (!inv.some(i => i.id === '946') && free() !== undefined) inv.push({ amount: '1', charge: '1000', slot: String(free()), id: '946' });
        } else {
            const inv = d.core_data.inventory ??= [];
            const free = () => [...Array(28).keys()].find(k => !inv.some(i => Number(i.slot) === k));
            for (let k = 0; k < 5; k++) { const sl = free(); if (sl !== undefined) inv.push({ amount: '1', charge: '1000', slot: String(sl), id: '1511' }); }
        }
        fs.writeFileSync(f, JSON.stringify(d));
        console.log(`${name} staged`);
    }
    process.exit(0);
}
const { STATE } = await import('./politics.mjs');
STATE.teams.stashtest = { members: ['sbot1', 'sbot2'], treasurer: 'sbot2', maxSize: 2, focus: null };
const { Market } = await import('./market.mjs');
const lines = [];
const market = new Market((...a) => { const l = a.join(' '); lines.push(l); console.log(l); });
const bots = ['sbot1', 'sbot2'].map(n => { const b = new Bot(n, { quiet: true }); market.register(b, () => (n === 'sbot1' ? [{ task: 'fletch' }] : [])); b.hook = async x => { if (market.dealFor(x.name)) { while (await market.step(x)) {} return true; } return false; }; return b; });
for (const b of bots) { await b.login(); await b.state(10); }
if (bots[1].s.inv.some(i => i.name === 'Knife')) await bots[1].bankItems(i => i.name === 'Knife', { back: { x: 3223, y: 3219 } });
await bots[1].state(5);
console.log(`treasurer's bank has a Knife: ${bots[1].s.bank?.some(i => i.name === 'Knife')}`);
const end = Date.now() + 8 * 60_000;
let seeks = 0;
while (Date.now() < end) {
    if (!market.dealFor('sbot1') && seeks++ < 12) await market.seek('sbot1');
    await Promise.all(bots.map(async b => { await b.state(10); await b.handleInterrupts(); }));
    if (bots[0].s.inv.some(i => i.name === 'Knife') && lines.some(l => /stash \(deal #\d+\)/.test(l)) && !market.dealFor('sbot1') && !market.dealFor('sbot2')) break;
    await sleep(1500);
}
const [s1, s2] = [await bots[0].state(5), await bots[1].state(5)];
const knife = s1.inv.some(i => i.name === 'Knife');
const don = lines.map(l => /to the stashtest stash \(deal #(\d+)\)/.exec(l)?.[1]).filter(Boolean);
const donated = don.some(id => lines.some(l => l.includes(`deal #${id} completed`)));
console.log(`\n${knife ? 'PASS' : 'FAIL'}  member got the Knife out of the treasurer's bank`);
console.log(`${donated ? 'PASS' : 'FAIL'}  member donated spare goods to the stash`);
process.exit(0);
