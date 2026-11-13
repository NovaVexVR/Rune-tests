// In-game check of selling made goods (roadmap 53): banked goods go to the shop that pays most for them.
//   node stage.mjs fbot1 at=3222,3218,0 bank="Willow longbow*20"      (or whatever SELL_ROUTES covers)
//   node test_sell.mjs fbot1
import { Bot } from './lib.mjs';
import { sellGoods, goodsToSell } from './tasks.mjs';

const bot = new Bot(process.argv[2] ?? 'fbot1');
await bot.login(); await bot.onboard(); await bot.state();
const coins = () => (bot.s.coins ?? 0) + ((bot.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0);
const before = coins();
bot.log(`start at ${bot.s.x},${bot.s.y}; to sell: ${goodsToSell(bot).map(g => `${g.count} ${g.name} -> ${g.route.shop.npcs[0]}`).join(', ') || 'nothing'}`);
const got = await sellGoods(bot);
await bot.state();
bot.log(`sold for ${got}gp (coins ${before} -> ${coins()}); now at ${bot.s.x},${bot.s.y}`);
process.exit(0);
