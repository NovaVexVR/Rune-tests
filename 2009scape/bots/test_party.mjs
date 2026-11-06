// In-game check of a quest party: three fresh bots do Cook's Assistant together, splitting the gathering.
//   node test_party.mjs [bot1 bot2 bot3]   (default pbot1-3; new characters are created and onboarded)
import fs from 'fs';
import path from 'path';
import { Bot } from './lib.mjs';
import { Market } from './market.mjs';
import { Parties } from './party.mjs';
import { stageOf } from './quests.mjs';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['pbot1', 'pbot2', 'pbot3'];
const lines = [];
const log = (...a) => { const l = a.join(' '); lines.push(l); console.log(new Date().toISOString().slice(11, 19), l); };
const market = new Market(log);
const parties = new Parties(market, log);
const t0 = Date.now();
const bots = names.map(n => {
    const b = new Bot(n, { quiet: true });
    market.register(b, () => []);
    b.hook = async x => { if (market.dealFor(x.name)) { while (await market.step(x)) {} return true; } return false; };
    return b;
});
for (const b of bots) { await b.login(); await b.onboard(); await b.state(5); }
const before = Object.fromEntries(bots.map(b => [b.name, { qp: b.s.questPoints, cook: b.s.stats.cooking.xp }]));
parties.form('cooks_assistant', names);
await Promise.all(bots.map(b => parties.join(b)));
const ledger = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.kind === 'party' && Date.parse(r.t) >= t0);
console.log('\n==== results');
for (const b of bots) {
    const s = await b.state(1);
    console.log(`${stageOf(b, "Cook's Assistant") >= 100 ? 'PASS' : 'FAIL'}  ${b.name}: stage ${stageOf(b, "Cook's Assistant")}, quest points ${before[b.name].qp} -> ${s.questPoints}, cooking xp ${before[b.name].cook} -> ${s.stats.cooking.xp}`);
}
console.log(`party trades: ${ledger.map(r => `${r.seller}->${r.buyer} ${r.item} ${r.outcome}`).join('; ')}`);
console.log(`took ${Math.round((Date.now() - t0) / 60000)} min`);
process.exit(0);
