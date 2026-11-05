// Print personalities, open debts and notable trust relationships: node social_report.mjs
import fs from 'fs';
process.chdir(new URL('.', import.meta.url).pathname);
const ious = fs.existsSync('market/ious.json') ? JSON.parse(fs.readFileSync('market/ious.json', 'utf8')) : [];
const trust = fs.existsSync('market/trust.json') ? JSON.parse(fs.readFileSync('market/trust.json', 'utf8')) : {};
console.log('== personalities');
for (const f of fs.readdirSync('orders').sort()) {
    const o = JSON.parse(fs.readFileSync(`orders/${f}`, 'utf8'));
    const p = o.personality;
    if (!p) continue;
    console.log(`${f.replace('.json', '').padEnd(12)} ${p.archetype.padEnd(15)} greed ${p.greed} gen ${p.generosity} caution ${p.caution} loyal ${p.loyalty} patience ${p.patience} social ${p.sociability}`);
}
console.log('\n== IOUs');
for (const i of ious) console.log(`#${i.id} ${i.debtor} owes ${i.creditor} ${i.owed}gp for ${i.item} [${i.status}]${i.status === 'open' ? ` due ${new Date(i.due).toISOString().slice(11, 16)}` : ''}`);
console.log('\n== trust (non-zero)');
for (const [a, m] of Object.entries(trust)) for (const [b, v] of Object.entries(m)) if (v) console.log(`${a} -> ${b}: ${v}`);
