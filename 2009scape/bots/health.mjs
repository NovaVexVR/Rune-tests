// Quick health check of every bot: who's stuck underground, far from home, out of food, or not moving.
// usage: node health.mjs            (read-only: it only reads /bots and each bot's state)
import fs from 'fs';
import path from 'path';

const API = process.env.BOT_API ?? 'http://127.0.0.1:8899';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const get = async u => (await fetch(API + u)).json();
const FOOD = /Shrimps|Anchovies|Bread|Cooked|Sardine|Herring|Trout|Salmon|Meat|Cake|Kebab/;
const LUMBRIDGE = { x: 3222, y: 3218 };
const GE = { x: 3165, y: 3487 };
const d = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const bots = await get('/bots');
const md = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'market', 'marketday.json'), 'utf8')).active; } catch { return null; } })();
const rows = [];
for (const b of bots) {
    if (!b.online) { rows.push([b.name, 'OFFLINE']); continue; }
    const s = await get(`/bot/${b.name}/state?r=1`);
    const flags = [];
    if (s.y > 6000) flags.push(`underground ${s.x},${s.y}`);
    else if ((s.z ?? 0) > 0 && d(s, LUMBRIDGE) > 25) flags.push(`upstairs z${s.z} at ${s.x},${s.y}`);
    const far = d(s, LUMBRIDGE);
    const atMarket = md?.attendees?.includes(b.name) || d(s, GE) < 20; // market-day travellers are meant to be away
    if (s.y < 6000 && far > 120 && !atMarket) flags.push(`far from home (${s.x},${s.y})`);
    if (s.y < 6000 && s.y > 3330 && s.y < 3400 && s.x > 3190 && s.x < 3250) flags.push('near the dark wizards');
    if (s.hp <= 3) flags.push(`hp ${s.hp}`);
    if (!s.inv.some(i => FOOD.test(i.name))) flags.push('no food');
    if (s.randomEvent) flags.push(`random event ${s.randomEvent.type}`);
    if (s.kidnapped) flags.push('KIDNAPPED');
    if (flags.length) rows.push([b.name, flags.join('; ')]);
}
const serious = rows.filter(([, f]) => !/^no food$/.test(f));
console.log(`${bots.length} bots, ${bots.filter(b => b.online).length} online; ${serious.length} need a look${md ? ` (market day #${md.id} on)` : ''}`);
for (const [n, f] of serious) console.log(`  ${n.padEnd(12)} ${f}`);
const hungry = rows.filter(([, f]) => /^no food$/.test(f)).map(([n]) => n);
if (hungry.length) console.log(`  no food (only): ${hungry.join(', ')}`);
