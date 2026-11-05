// Scripted bots: each bot slowly rotates through skill-training scripts,
// favouring whatever skills are currently lowest, so over time it levels everything.
//
// usage: node scripted.mjs [count=5] [prefix=scriptbot]
import fs from 'fs';
import path from 'path';

import { Bot, LOG_DIR, rand, sleep, summary } from './lib.mjs';
import { TASKS, RESUPPLY, shopFor } from './tasks.mjs';
import { TASK_NEEDS } from './market.mjs';

const COUNT = Number(process.argv[2] ?? 5);
const PREFIX = process.argv[3] ?? 'scriptbot';
const PROGRESS = path.join(LOG_DIR, 'progress.jsonl');

// Tools a task needs that the bot lacks but could buy in Lumbridge with the coins it has.
function buyableNeeds(bot, task) {
    const missing = (TASK_NEEDS[task.id] ?? []).filter(g => !g.some(n => bot.has(n))).map(g => g[0]);
    if (!missing.length || !missing.every(n => shopFor(n))) return null;
    const cost = missing.reduce((t, n) => t + shopFor(n).sells[n], 0);
    const banked = bot.s.bank?.find(i => i.name === 'Coins')?.count ?? 0;
    return bot.s.coins + banked >= cost ? missing : null;
}

function chooseTask(bot, lastId) {
    const runnable = TASKS.filter(t => t.id !== lastId && (t.canRun(bot) === true || buyableNeeds(bot, t)));
    // score = average level of the task's skills (lower is better) + noise for variety
    const scored = runnable.map(t => {
        const avg = t.skills.reduce((a, k) => a + bot.lvl(k), 0) / t.skills.length;
        return { t, score: avg + Math.random() * 4 };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored[0]?.t ?? TASKS.find(t => t.id === 'melee');
}

async function runBot(name, startDelay) {
    await sleep(startDelay);
    const bot = new Bot(name, { quiet: true });
    let lastId = null;
    for (;;) {
        try {
            const s = await bot.state(1).catch(() => null);
            if (!s || !s.online) {
                await bot.login();
                await bot.onboard();
            }
            await bot.state();
            const task = chooseTask(bot, lastId);
            const minutes = rand(50, 70); // roughly hourly task changes
            bot.log(`task -> ${task.id} for ${minutes}m | ${summary(bot.s)}`);
            const shopping = task.canRun(bot) === true ? null : buyableNeeds(bot, task);
            if (shopping) { bot.log(`buying ${shopping.join(', ')} for ${task.id}`); await RESUPPLY.run(bot, Date.now() + 10 * 60_000, shopping); }
            if (task.canRun(bot) === true) await task.run(bot, Date.now() + minutes * 60_000);
            lastId = task.id;
            await bot.state(1);
            fs.appendFileSync(PROGRESS, JSON.stringify({ t: Date.now(), bot: name, kind: 'scripted', task: task.id, total: bot.s.totalLevel, combat: bot.s.combat, x: bot.s.x, y: bot.s.y, stats: Object.fromEntries(Object.entries(bot.s.stats).map(([k, v]) => [k, v.level])) }) + '\n');
        } catch (e) {
            bot.log(`error: ${e.stack ?? e}`);
            await sleep(15_000);
        }
    }
}

const names = Array.from({ length: COUNT }, (_, i) => `${PREFIX}${i + 1}`);
console.log(`starting scripted bots: ${names.join(', ')}`);
await Promise.all(names.map((n, i) => runBot(n, i * 4000)));
