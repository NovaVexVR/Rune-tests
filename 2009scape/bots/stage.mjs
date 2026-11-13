// Stage a test bot: create it if needed (login + onboard), log it out, then edit its save: skills, bag, bank, place.
// For trying a task that needs levels or goods a fresh character doesn't have (the bot must be logged out: the
// server overwrites the save on logout).
//   node stage.mjs fbot1 fletching=40 woodcutting=35 crafting=10 item=Knife item="Bronze axe" item=Coins*3000 bank="Oak longbow (u)*20" at=3222,3218,0
// item=/bank= take a name (or an id) and an optional *amount; unstackable bag items take one slot each.
import fs from 'fs';
import path from 'path';
import { Bot, sleep, SKILLS } from './lib.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SRV = process.env.SERVER_DIR ?? path.resolve(ROOT, '../../../2009scape-server');
const SAVES = process.env.SAVES ?? path.join(SRV, 'Server/data/players');
const [name, ...args] = process.argv.slice(2);
if (!name || !args.length) { console.log('usage: node stage.mjs <bot> [skill=level ...] [item=Name*n ...] [bank=Name*n ...] [at=x,y,z] [quests=all]'); process.exit(1); }

const xpFor = lvl => { let pts = 0; for (let l = 1; l < lvl; l++) pts += Math.floor(l + 300 * 2 ** (l / 7)); return Math.floor(pts / 4); };
const defs = JSON.parse(fs.readFileSync(path.join(SRV, 'Server/data/configs/item_configs.json'), 'utf8'));
const byName = new Map();
for (const d of defs) if (d.name && !byName.has(d.name.toLowerCase())) byName.set(d.name.toLowerCase(), d); // the first id is the real item, the next its note
function item(spec) {
    const [what, n] = spec.split('*');
    const d = /^\d+$/.test(what) ? defs.find(x => String(x.id) === what) : what.toLowerCase() === 'coins' ? { id: 995, name: 'Coins' } : byName.get(what.toLowerCase());
    if (!d) throw new Error(`no item called ${what}`);
    // the configs don't say what stacks (the cache does): the usual stackables by name
    return { id: String(d.id), amount: Number(n ?? 1), stacks: /^Coins$|rune$|arrow|bolts$|^Feather$|^Fishing bait$/i.test(d.name) };
}

const bot = new Bot(name, { quiet: true });
await bot.login(); await bot.onboard(); await bot.logout();
for (let i = 0; i < 40; i++) { await sleep(1500); const s = await bot.state(1).catch(() => null); if (!s?.online) break; }
await sleep(1500);

const file = path.join(SAVES, `${name}.json`), d = JSON.parse(fs.readFileSync(file, 'utf8'));
const inv = [], bank = d.core_data.bank ?? [];
for (const a of args) {
    const [k, v] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    if (k === 'at') d.core_data.location = v;
    else if (k === 'quest') { const [id, st] = v.split(':'); const q = d.quests.questStages.find(x => x.questId === id); if (q) q.questStage = st; else d.quests.questStages.push({ questId: id, questStage: st }); } // quest=<index>:<stage>, after quests=all to leave one open
    else if (k === 'quests' && v === 'all') for (const q of d.quests.questStages) q.questStage = '100'; // every quest done (the server counts the points at login), e.g. for the Champions' Guild door
    else if (k === 'item') {
        const it = item(v);
        for (let n = it.stacks ? 1 : it.amount; n > 0 && inv.length < 28; n--) inv.push({ amount: String(it.stacks ? it.amount : 1), charge: '1000', slot: String(inv.length), id: it.id });
    } else if (k === 'bank') {
        const it = item(v), have = bank.find(b => b.id === it.id);
        if (have) have.amount = String(it.amount);
        else bank.push({ amount: String(it.amount), charge: '1000', slot: String(bank.reduce((m, b) => Math.max(m, Number(b.slot) + 1), 0)), id: it.id });
    } else if (SKILLS.includes(k)) {
        const sk = d.skills.find(x => Number(x.id) === SKILLS.indexOf(k)), lv = Number(v);
        sk.static = sk.dynamic = String(lv);
        sk.experience = `${xpFor(lv)}.0`;
        if ('lifepoints' in sk) sk.lifepoints = String(lv);
    } else throw new Error(`don't know what to do with ${a}`);
}
if (inv.length) d.core_data.inventory = inv; // a staged bag replaces the old one
d.core_data.bank = bank;
fs.writeFileSync(file, JSON.stringify(d));
console.log(`${name} staged: ${args.join(' ')}`);
process.exit(0);
