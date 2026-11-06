// In-game check of a friendly duel at the Duel Arena between two staged test bots.
//   node test_duel.mjs setup   create dbot1/dbot2 and put them in the Duel Arena's challenge area (saves)
//   node test_duel.mjs run     fight the duel
import fs from 'fs';
import path from 'path';
import { Bot, sleep } from './lib.mjs';
import { fightDuel, ARENA } from './duel.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SAVES = process.env.SAVES ?? path.resolve(ROOT, '../../../2009scape-server/Server/data/players');
if (process.argv[2] === 'setup') {
    for (const [i, name] of ['dbot1', 'dbot2'].entries()) {
        const b = new Bot(name, { quiet: true });
        await b.login(); await b.onboard(); await b.logout(); await sleep(3000);
        const f = path.join(SAVES, `${name}.json`), d = JSON.parse(fs.readFileSync(f, 'utf8'));
        d.core_data.location = `${ARENA.x + i * 2},${ARENA.y},0`;
        fs.writeFileSync(f, JSON.stringify(d));
        console.log(`${name} staged at the Duel Arena`);
    }
    process.exit(0);
}
const [a, b] = [new Bot('dbot1'), new Bot('dbot2')];
await a.login(); await b.login();
const winner = await fightDuel(a, b);
const [sa, sb] = [await a.state(3), await b.state(3)];
console.log(`RESULT winner ${winner}; dbot1 at ${sa.x},${sa.y} hp ${sa.hp}, dbot2 at ${sb.x},${sb.y} hp ${sb.hp}; items kept: ${sa.inv.length}/${sb.inv.length}`);
process.exit(0);
