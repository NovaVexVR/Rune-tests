// usage: node test_task.mjs <botname> <taskid> <seconds>
import { Bot, summary } from './lib.mjs';
import { taskById, prepare } from './tasks.mjs';

const [name, task, secs] = process.argv.slice(2);
const bot = new Bot(name);
await bot.login();
await bot.onboard();
await bot.state();
bot.log('start', summary(bot.s));
const iv = setInterval(async () => {
    try {
        const s = await bot.state(3);
        bot.log('progress', summary(s), '|', bot.msgs.slice(-2).join(' / '));
    } catch {}
}, 20000);
await prepare(bot, task); // as the runners do: tools out of the bank, gear on
await taskById(task).run(bot, Date.now() + Number(secs) * 1000);
clearInterval(iv);
await bot.state();
bot.log('end', summary(bot.s), '| recent:', bot.msgs.slice(-6).join(' | '));
process.exit(0);
