// In-game check of gear shopping (roadmap 54): the bot spends up to 30% of its coins on the best pieces it can wear.
//   node stage.mjs gbot1 attack=40 defence=40 bank=Coins*300000 quests=all at=3222,3218,0   (quests done: the Champions' Guild lets it in)
//   node test_gear.mjs gbot1
import { Bot, summary } from './lib.mjs';
import { buyArmour } from './tasks.mjs';

const bot = new Bot(process.argv[2] ?? 'gbot1');
await bot.login(); await bot.onboard(); await bot.state();
bot.log('start', summary(bot.s), `| quest points ${bot.s.questPoints} | coins ${bot.s.coins} + ${(bot.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0} banked`);
const n = await buyArmour(bot);
await bot.state();
bot.log(`bought ${n} pieces; wearing: ${bot.s.worn.map(i => i.name).join(', ') || 'nothing'}; carrying: ${bot.s.inv.map(i => i.name).join(', ')}; coins ${bot.s.coins} + ${(bot.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0} banked`);
process.exit(0);
