// In-game check of the Phase 1-3 social mechanics that need a staged setup:
// debt-collector purchase -> hounding -> repayment to the collector, a coin-flip wager, a collection
// completed by trade, a public call-out (bystander trust drop), and mood after a death.
//
//   node test_social.mjs setup   log the cast in once (creates/onboards them), then out, and put the
//                                coins/items each role needs into their saves (server must be running)
//   node test_social.mjs run     write the staged IOU and grudge, gather the cast in the courtyard and
//                                run the real market (seek/step/hound) until every check passes
//
// Bots are reset to level 1 before the real run, so editing saves and market files here is fine.
import fs from 'fs';
import path from 'path';
import { Bot, sleep } from './lib.mjs';
import { Market } from './market.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SAVES = process.env.SAVES ?? path.resolve(ROOT, '../../../2009scape-server/Server/data/players');
const MKT = path.join(ROOT, 'market');
const COINS = 995, KNIFE = 946, HAMMER = 2347;

// role -> items put in the inventory (id: amount); the market only ever sees an empty plan,
// so the only "needs" are collection pieces and nothing else starts trades.
const CAST = {
    claudebot1: { [COINS]: 80 },              // philanthropist: later lends the debtor a hand
    claudebot2: { [COINS]: 60 },              // merchant: buys the overdue IOU and collects it
    claudebot3: { [COINS]: 50 },              // gambler
    legion19: { [COINS]: 50 },                // gambler (team member, under the treasury float)
    claudebot4: { [HAMMER]: 1 },              // has a spare Hammer
    claudebot5: {},                           // creditor of the staged IOU (patient philanthropist)
    claudebot6: {},                           // debtor, no coins
    claudebot7: {},                           // the one being called out
    claudebot8: {},                           // holds the grudge, calls claudebot7 out
    claudebot10: { [COINS]: 30, [KNIFE]: 1 }  // tools collector: has every piece but the Hammer
};
const DEATH = 'testbot'; // walks into the dark wizards' stone circle for the mood check

function editSave(name, give, take = []) {
    const f = path.join(SAVES, `${name}.json`);
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    let inv = (d.core_data.inventory ??= []);
    inv = d.core_data.inventory = inv.filter(i => !take.includes(Number(i.id)));
    for (const [id, amount] of Object.entries(give)) {
        const have = inv.find(i => i.id === String(id));
        if (have && Number(id) === COINS) { have.amount = String(Math.max(Number(have.amount), amount)); continue; }
        if (have) continue;
        const used = new Set(inv.map(i => Number(i.slot)));
        const slot = [...Array(28).keys()].find(i => !used.has(i));
        inv.push({ amount: String(amount), charge: '1000', slot: String(slot), id: String(id) });
    }
    fs.writeFileSync(f, JSON.stringify(d));
}

async function setup() {
    for (const name of [...Object.keys(CAST), DEATH]) {
        const bot = new Bot(name, { quiet: true });
        await bot.login();
        await bot.onboard();
        await bot.logout();
        await sleep(3000);
        if (Object.keys(CAST[name] ?? {}).length) editSave(name, CAST[name], name === 'claudebot10' ? [HAMMER] : []);
        if (name === 'claudebot10') { // a fresh collection to complete
            const f = path.join(ROOT, 'orders', `${name}.json`), o = JSON.parse(fs.readFileSync(f, 'utf8'));
            delete o.personality?.habits?.collectionDone;
            fs.writeFileSync(f, JSON.stringify(o, null, 2));
        }
        console.log(`${name}: ready`, JSON.stringify(CAST[name] ?? {}));
    }
}

async function run() {
    fs.mkdirSync(path.join(MKT, 'values'), { recursive: true });
    const load = (f, d) => (fs.existsSync(path.join(MKT, f)) ? JSON.parse(fs.readFileSync(path.join(MKT, f), 'utf8')) : d);
    const save = (f, v) => fs.writeFileSync(path.join(MKT, f), JSON.stringify(v, null, 2));
    // staged state: an overdue IOU (claudebot6 owes claudebot5) and a grudge (claudebot8 vs claudebot7)
    const ious = load('ious.json', []).filter(i => !(i.debtor === 'claudebot6' && i.status === 'open'));
    const iouId = ious.reduce((m, i) => Math.max(m, i.id), 0) + 1;
    ious.push({ id: iouId, debtor: 'claudebot6', creditor: 'claudebot5', item: 'Trout', owed: 30, created: Date.now() - 72 * 60_000, due: Date.now() - 12 * 60_000, status: 'open' });
    save('ious.json', ious);
    const rel = load('relations.json', {});
    (rel.claudebot8 ??= {}).claudebot7 = { rival: true, strikes: 2, since: Date.now(), reason: 'test: an old swindle' };
    save('relations.json', rel);
    const mood = load('mood.json', {});
    for (const n of [...Object.keys(CAST), DEATH]) delete mood[n];
    save('mood.json', mood);

    const lines = [];
    const market = new Market((...a) => { const l = a.join(' '); lines.push(l); console.log(new Date().toISOString().slice(11, 19), l); });
    const t0 = Date.now();
    const ledger = () => (fs.existsSync(path.join(MKT, 'ledger.jsonl')) ? fs.readFileSync(path.join(MKT, 'ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r => Date.parse(r.t) >= t0) : []);
    const done = (kind, extra = () => true) => ledger().some(r => r.kind === kind && r.outcome === 'completed' && extra(r));
    const iou = () => market.social.ious.find(i => i.id === iouId);
    const before = market.social.p(DEATH);

    const checks = {
        'collector bought the overdue IOU': () => done('debtsale') && iou()?.creditor === 'claudebot2' && iou()?.collected,
        'collector hounded the debtor': () => lines.some(l => /claudebot2 goes to collect from claudebot6/.test(l)),
        'debtor repaid the collector': () => done('repay', r => r.buyer === 'claudebot2') && iou()?.status === 'repaid',
        'gamblers settled a coin flip': () => done('wager'),
        'collector completed its set by trade': () => lines.some(l => /claudebot10 completed its tools collection/.test(l)),
        'call-out lowered bystander trust': () => lines.some(l => /claudebot8 called out claudebot7/.test(l)) && Object.keys(CAST).some(n => market.social.trust(n, 'claudebot7') < 0),
        'death shook the bot\'s mood': () => market.social.mood(DEATH) <= -0.4
    };
    const passed = () => Object.entries(checks).filter(([, f]) => f()).map(([k]) => k);

    const bots = [];
    for (const name of Object.keys(CAST)) {
        const bot = new Bot(name, { quiet: true });
        market.register(bot, () => []);
        bot.onPm = pm => market.onPm(name, pm);
        let lastSeek = 0;
        bot.hook = async b => { // same as claude_runner, with a faster seek
            if (market.dealFor(b.name)) { while (await market.step(b)) {} return true; }
            if (Date.now() - lastSeek > 20_000) {
                lastSeek = Date.now();
                await market.seek(b.name);
                if (!market.dealFor(b.name) && (await market.hound(b))) return true;
            }
            return false;
        };
        bots.push(bot);
    }
    let stop = false, bailedOut = false;
    // each bot runs on its own, like in claude_runner (a bot that waits for the others can't answer a trade)
    const loops = bots.map(async (b, i) => {
        await sleep(i * 1500);
        await b.login(); await b.onboard();
        await b.walkTo(3218 + (i % 5) * 2, 3216 + Math.floor(i / 5) * 3, { tol: 2, timeout: 180 }).catch(() => {});
        while (!stop) {
            try { await b.state(15); await b.handleInterrupts(); } catch (e) { b.log(`error ${e.message}`); }
            await sleep(1500);
        }
    });

    // the death: walk straight into the dark wizards (no fleeing, no eating)
    const victim = new Bot(DEATH, { quiet: true });
    victim.onMsg = text => { if (/Oh dear, you are dead/i.test(text)) market.social.bumpMood(DEATH, -0.4, 'dying'); };
    const death = (async () => {
        await victim.login(); await victim.onboard();
        for (let i = 0; i < 120 && market.social.mood(DEATH) > -0.4; i++) {
            const s = await victim.state(5);
            if (s.dialog) await victim.act({ type: 'continue' });
            else if (!s.moving && !s.inCombat) await victim.act({ type: 'walk', x: s.x + Math.sign(3227 - s.x) * Math.min(12, Math.abs(3227 - s.x)), y: s.y + Math.sign(3369 - s.y) * Math.min(12, Math.abs(3369 - s.y)), run: true });
            await sleep(2500);
        }
    })();

    const end = Date.now() + Number(process.env.MINUTES ?? 30) * 60_000;
    let shown = '';
    while (Date.now() < end) {
        await sleep(5000);
        // once the collector has been to see the debtor, the debtor borrows from a friend (a favor, i.e. a new IOU) to pay
        if (!bailedOut && checks['collector hounded the debtor']() && !market.dealFor('claudebot1') && !market.dealFor('claudebot6')) {
            bailedOut = true;
            market.open({ buyer: 'claudebot6', seller: 'claudebot1', item: 'Coins', amount: 40, price: 0, kind: 'favor', value: 40 });
        }
        const ok = passed();
        if (ok.join() !== shown) { shown = ok.join(); console.log(`== ${ok.length}/${Object.keys(checks).length} passed`); }
        if (ok.length === Object.keys(checks).length) break;
    }
    stop = true;
    await Promise.all(loops);
    await death;
    const after = market.social.p(DEATH);
    console.log('\n==== results');
    for (const [k, f] of Object.entries(checks)) console.log(`${f() ? 'PASS' : 'FAIL'}  ${k}`);
    console.log(`IOU #${iouId}: ${JSON.stringify(iou())}`);
    console.log(`bystander trust in claudebot7: ${Object.keys(CAST).map(n => `${n}=${market.social.trust(n, 'claudebot7')}`).join(' ')}`);
    console.log(`${DEATH} mood ${after.mood}: caution ${before.caution} -> ${after.caution}, sociability ${before.sociability} -> ${after.sociability}, ask factor ${market.social.askFactor(DEATH, 'x').toFixed(2)} (neutral ${(1 + 0.4 * before.greed - 0.25 * before.generosity).toFixed(2)})`);
    for (const r of ledger()) console.log('ledger', JSON.stringify(r));
    process.exit(0);
}

const cmd = process.argv[2];
if (cmd === 'setup') await setup().then(() => process.exit(0));
else if (cmd === 'run') await run();
else console.log('usage: node test_social.mjs setup|run');
