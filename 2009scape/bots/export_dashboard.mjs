// Snapshot the bot world into JSON files for the "Rune Bots Live" dashboard.
// usage: node export_dashboard.mjs <outdir>
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.argv[2] ?? path.join(HERE, 'dashboard');
fs.mkdirSync(OUT, { recursive: true });
const API = 'http://127.0.0.1:8899';
const now = new Date().toISOString();

const groupOf = n =>
    n.startsWith('script') ? 'Scripted' : n.startsWith('claude') ? 'Individualist' : n.startsWith('guild') ? 'Guild team' : n.startsWith('wolf') ? 'Wolf team' : n.startsWith('hawk') ? 'Hawk team' : n.startsWith('bear') ? 'Bear team' : n.startsWith('legion') ? 'Legion' : 'Other';
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const lastTask = name => {
    const f = path.join(HERE, 'logs', `${name}.log`);
    if (!fs.existsSync(f)) return '';
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').reverse();
    const t = lines.find(l => /task ->|\[plan step/.test(l));
    return t ? (t.match(/task -> (\w+)/)?.[1] ?? t.match(/\] (\w+) for/)?.[1] ?? '') : '';
};

const list = await (await fetch(`${API}/bots`)).json();
const bots = [];
for (const b of list) {
    if (!/^(scriptbot|claudebot|guildbot|wolfbot|hawkbot|bearbot|legion)\d+$/.test(b.name)) continue;
    const s = await (await fetch(`${API}/bot/${b.name}/state?r=0`)).json();
    if (!s.online) { bots.push({ bot: b.name, group: groupOf(b.name), online: false }); continue; }
    const o = readJson(path.join(HERE, 'orders', `${b.name}.json`), {});
    const lv = k => s.stats[k]?.level ?? 1;
    const bank = (s.bank ?? []).reduce((t, i) => t + (i.name === 'Coins' ? i.count : 0), 0);
    bots.push({
        bot: b.name, group: groupOf(b.name), online: true, task: lastTask(b.name), personality: o.personality?.archetype ?? (b.name.startsWith('script') ? 'scripted' : ''),
        total: s.totalLevel, combat: s.combat, coins: s.coins + bank,
        attack: lv('attack'), strength: lv('strength'), defence: lv('defence'), hitpoints: lv('hitpoints'), ranged: lv('ranged'), magic: lv('magic'), prayer: lv('prayer'),
        woodcutting: lv('woodcutting'), firemaking: lv('firemaking'), fletching: lv('fletching'), fishing: lv('fishing'), cooking: lv('cooking'), mining: lv('mining'), thieving: lv('thieving'),
        x: s.x, y: s.y
    });
}
const ledger = fs.existsSync(path.join(HERE, 'market/ledger.jsonl'))
    ? fs.readFileSync(path.join(HERE, 'market/ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
const deals = ledger.slice(-150).reverse().map(r => ({ time: r.t, id: r.id, kind: r.kind, seller: r.seller, buyer: r.buyer, item: r.item, amount: r.amount, price: r.price, outcome: r.outcome }));
const debts = readJson(path.join(HERE, 'market/ious.json'), []).filter(i => !i.test).map(i => ({ id: i.id, debtor: i.debtor, creditor: i.creditor, item: i.item, owed: i.owed, status: i.status, due: new Date(i.due).toISOString(), collected: !!i.collected }));
const bounties = readJson(path.join(HERE, 'market/bounties.json'), []).filter(b => !b.test).map(b => ({ id: b.id, poster: b.poster, item: b.item, qty: b.qty, reward: b.reward, status: b.status, claimant: b.claimant ?? '', posted: new Date(b.posted).toISOString() }));
const log = fs.existsSync(path.join(HERE, 'logs/claude_runner.out')) ? fs.readFileSync(path.join(HERE, 'logs/claude_runner.out'), 'utf8').trim().split('\n') : [];
const events = log.filter(l => /\[social\]|\[market\] deal #\d+:/.test(l)).slice(-80).reverse().map(l => {
    const m = l.match(/^(\S+) \[(\w+)\] (.*)$/);
    return m ? { time: m[1], kind: m[2], text: m[3].slice(0, 160) } : null;
}).filter(Boolean);

const write = (name, rows) => fs.writeFileSync(path.join(OUT, name), JSON.stringify({ updated: now, rows }));
write('bots.json', bots);
write('deals.json', deals);
write('debts.json', debts);
write('bounties.json', bounties);
write('events.json', events);
console.log(`exported ${bots.length} bots, ${deals.length} deals, ${debts.length} debts, ${bounties.length} bounties, ${events.length} events -> ${OUT} at ${now}`);
