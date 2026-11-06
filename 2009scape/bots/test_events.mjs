// Force random events on a test bot and check each resolves: node test_events.mjs <bot> EVENT1 EVENT2 ...
import { Bot, sleep } from './lib.mjs';
const [name, ...events] = process.argv.slice(2);
const bot = new Bot(name);
await bot.login(); await bot.onboard?.();
for (const ev of events) {
    let s = await bot.state(8);
    const start = { x: s.x, y: s.y };
    const noted0 = s.inv.length;
    console.log(`\n== ${ev}: forcing at ${s.x},${s.y} hp ${s.hp}`);
    console.log(await bot.act({ type: 'forceevent', event: ev }));
    let seen = false, t0 = Date.now();
    while (Date.now() - t0 < 150_000) {
        await sleep(1200);
        s = await bot.state(10);
        if (s.randomEvent) seen = true;
        await bot.handleInterrupts();
        if (seen && !s.randomEvent && !s.dialog) break;
    }
    s = await bot.state(5);
    const moved = Math.max(Math.abs(s.x - start.x), Math.abs(s.y - start.y));
    console.log(`${ev}: ${s.randomEvent ? 'STILL ACTIVE' : 'resolved'} after ${Math.round((Date.now() - t0) / 1000)}s; moved ${moved} tiles; hp ${s.hp}; new items: ${s.inv.slice(-2).map(i => i.name).join(', ')}; last msgs: ${bot.msgs.slice(-2).join(' | ')}`);
    await sleep(3000);
}
process.exit(0);
