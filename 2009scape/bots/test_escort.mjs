// In-game check of escorts (roadmap C12): a weak bot (combat 3) is asked to mine iron, where muggers roam; it
// asks its team for an escort, a strong teammate (combat 25+) takes the job, comes over and follows it.
//   node test_escort.mjs setup   create ebot1 (ward: Mining 20, pickaxe) and ebot2 (escort: melee 25, food)
//   node test_escort.mjs run     the ward requests an escort, mines for 6 minutes, and finishes the job
import fs from 'fs';
import path from 'path';
import { Bot, sleep, dist } from './lib.mjs';
import { Market } from './market.mjs';
import { Escorts } from './escort.mjs';
import { taskById } from './tasks.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SAVES = process.env.SAVES ?? path.resolve(ROOT, '../../../2009scape-server/Server/data/players');
const XP = { 20: 4470, 25: 7842, 30: 13363 };
const CAST = {
    ebot1: { skills: { 14: 20 }, items: ['1265'] },                                                         // bronze pickaxe
    ebot2: { skills: { 0: 25, 1: 25, 2: 25, 3: 25 }, items: ['1277', '1171', '333', '333', '333', '333'] }  // sword, shield, trout
};
if (process.argv[2] === 'setup') {
    for (const [name, c] of Object.entries(CAST)) {
        const b = new Bot(name, { quiet: true });
        await b.login(); await b.onboard(); await b.logout(); await sleep(3000);
        const f = path.join(SAVES, `${name}.json`), d = JSON.parse(fs.readFileSync(f, 'utf8'));
        d.core_data.location = name === 'ebot1' ? '3222,3218,0' : '3226,3220,0';
        for (const sk of d.skills) if (c.skills[sk.id]) { const lv = c.skills[sk.id]; sk.static = sk.dynamic = String(lv); sk.experience = `${XP[lv]}.0`; }
        const inv = (d.core_data.inventory ??= []).filter(i => !c.items.includes(i.id)).slice(0, 28 - c.items.length);
        const free = () => [...Array(28).keys()].find(k => !inv.some(i => Number(i.slot) === k));
        for (const id of c.items) { const sl = free(); if (sl !== undefined) inv.push({ amount: '1', charge: '1000', slot: String(sl), id }); }
        d.core_data.inventory = inv;
        fs.writeFileSync(f, JSON.stringify(d));
        console.log(`${name} staged`);
    }
    process.exit(0);
}

const lines = [];
const log = (...a) => { const l = a.join(' '); lines.push(l); console.log(new Date().toISOString().slice(11, 19), l); };
const market = new Market(log);
market.social.teamOf = n => (n in CAST ? 'escort-test' : 'individual');
const escorts = new Escorts(market, log);
const [ward, guard] = ['ebot1', 'ebot2'].map(n => new Bot(n));
for (const b of [ward, guard]) market.register(b, () => []);
guard.hook = async b => (escorts.jobFor(b.name) ? (await escorts.guard(b), true) : false);
await ward.login(); await guard.login(); await ward.onboard(); await guard.onboard();
const task = taskById('mine_iron');
const before = task.canRun(ward);
console.log(`ward combat ${ward.s.combat}, canRun before: ${before}`);
// the escort idles, checking its hook, like a runner between steps
let stop = false, maxGap = 0;
const idle = (async () => { while (!stop) { await guard.handleInterrupts(); await sleep(2000); } })();
const got = await escorts.request(ward, 'mine_iron');
const after = task.canRun(ward);
let xp0 = ward.s.stats.mining.xp;
if (got) {
    const watch = setInterval(() => { if (ward.s && guard.s) maxGap = Math.max(maxGap, dist(ward.s, guard.s)); }, 5000);
    try { await task.run(ward, Date.now() + 6 * 60_000); } finally { escorts.finish(ward.name); clearInterval(watch); }
}
stop = true; await idle;
const xp1 = (await ward.state(1)).stats.mining.xp;
const checks = {
    'an escort took the job and arrived': got === 'ebot2',
    'the ward could then do the task': before !== true && after === true,
    'the ward mined (xp gained)': xp1 > xp0,
    'the escort stayed close (within 15 tiles)': got && maxGap <= 15,
    'the job ended': !escorts.jobs.size
};
console.log('\n==== results');
for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
console.log(`max gap ${maxGap}; fights: ${lines.filter(l => /fights the/.test(l)).length}`);
await ward.logout(); await guard.logout();
process.exit(0);
