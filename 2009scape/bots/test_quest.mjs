// Run one quest solo on a (staged) bot: start, then finish.   node test_quest.mjs <bot> <quest id from QUESTS>
import { Bot } from './lib.mjs';
import { QUESTS, stageOf } from './quests.mjs';
const [name, id] = process.argv.slice(2);
const bot = new Bot(name), q = QUESTS[id];
await bot.login(); await bot.onboard(); await bot.state();
bot.log(`quest test: ${q.name}, stage ${stageOf(bot, q.name)}, ${bot.s.questPoints} quest points, combat ${bot.s.combat}`);
const started = await q.start(bot);
bot.log(`started: ${started} (stage ${stageOf(bot, q.name)})`);
const done = started && (await q.finish(bot));
await bot.state();
bot.log(`done: ${done} (stage ${stageOf(bot, q.name)}, ${bot.s.questPoints} quest points, coins ${bot.s.coins}) at ${bot.s.x},${bot.s.y},${bot.s.z}`);
process.exit(0);
