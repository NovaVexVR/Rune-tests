// Claude-directed bots. Each bot follows the plan Claude writes in orders/<name>.json:
//   { "plan": [ { "task": "melee", "minutes": 20, "why": "..." }, ... ], "loop": true, "paused": false }
// The file is re-read after every step, so Claude can change plans at any time. While "paused"
// is true the runner leaves the bot alone so Claude can drive it directly through the API
// (quests, shopping, banking, exploring).
//
// usage: node claude_runner.mjs [count=5]
import fs from 'fs';
import path from 'path';

import { Bot, LOG_DIR, sleep, summary } from './lib.mjs';
import { taskById, RESUPPLY } from './tasks.mjs';
import { Market, TEAMS } from './market.mjs';
import { personalityOf, SPOTS } from './social.mjs';
import { council, STATE as POLITICS } from './politics.mjs';

import { Diary } from './diary.mjs';
import { MarketDay } from './marketday.mjs';
import { planQuests } from './questplanner.mjs';

const diary = new Diary();
const market = new Market((...a) => { console.log(new Date().toISOString(), ...a); try { diary.fromLog(a.join(' ')); } catch (e) { console.log('diary error', e.message); } });

market.marketDay = new MarketDay(market);
const COUNT = Number(process.argv[2] ?? 5);
const ORDERS = path.join(path.dirname(new URL(import.meta.url).pathname), 'orders');
const PROGRESS = path.join(LOG_DIR, 'progress.jsonl');
fs.mkdirSync(ORDERS, { recursive: true });

function readOrders(name) {
    const f = path.join(ORDERS, `${name}.json`);
    if (!fs.existsSync(f)) {
        fs.writeFileSync(f, JSON.stringify({ plan: [{ task: 'melee', minutes: 15, why: 'default start' }], loop: true, paused: false, step: 0 }, null, 2));
    }
    return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function writeStep(name, step) {
    const f = path.join(ORDERS, `${name}.json`);
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    // one-off steps (quests the planner slotted in) leave the plan once they've run; the next step slides into place
    if (o.plan?.[step - 1]?.once) { o.plan.splice(step - 1, 1); step -= 1; }
    o.step = step;
    fs.writeFileSync(f, JSON.stringify(o, null, 2));
}

async function runBot(name, delay) {
    await sleep(delay);
    const bot = new Bot(name, { quiet: true });
    readOrders(name);
    const pers = personalityOf(name);
    bot.log(`personality: ${pers.archetype} ${JSON.stringify(pers)}`);
    market.register(bot, () => readOrders(name).plan ?? []);
    bot.market = market;
    bot.onPm = pm => market.onPm(name, pm);
    // mood reacts to what happens in-game
    bot.onRandomEvent = type => diary.note(name, `A random event found me: ${type.toLowerCase().replace(/_/g, ' ')}.`, 'random');
    bot.onMsg = text => {
        diary.fromGame(name, text);
        if (/Oh dear, you are dead/i.test(text)) market.social.bumpMood(name, -0.4, 'dying');
        else if (/advanced .* level|reached level/i.test(text)) market.social.bumpMood(name, 0.1 * (1 - Math.max(0, market.social.mood(name))), 'a level-up'); // diminishing: low levels come fast
    };
    let lastSeek = 0;
    bot.hook = async b => {
        if (market.dealFor(b.name)) {
            while (await market.step(b)) {}
            return true;
        }
        // the quest planner can ask a bot to drop its current task (orders.preempt): stop the task here
        if (Date.now() - (b._preemptCheck ?? 0) > 60_000) {
            b._preemptCheck = Date.now();
            const o = readOrders(name);
            if (o.preempt) {
                o.preempt = false;
                fs.writeFileSync(path.join(ORDERS, `${name}.json`), JSON.stringify(o, null, 2));
                if (b._currentTask && b._currentTask !== o.plan?.[o.step ?? 0]?.task) throw new Error('PREEMPT'); // already on it? carry on
            }
        }
        if (await market.marketDay.attend(b)) return true; // market day at the Grand Exchange
        if (Date.now() - lastSeek > 60_000) {
            lastSeek = Date.now();
            await market.seek(b.name);
            if (!market.dealFor(b.name) && (await market.hound(b))) return true; // debt collectors pay debtors a visit
        }
        return false;
    };
    for (;;) {
        try {
            const o = readOrders(name);
            if (o.paused) { await sleep(5000); continue; }
            const s = await bot.state(1).catch(() => null);
            if (!s || !s.online) { await bot.login(); await bot.onboard(); }
            await bot.state();
            const plan = o.plan ?? [];
            let step = o.step ?? 0;
            if (step >= plan.length) {
                if (o.loop && plan.length) step = 0;
                else { await sleep(10000); continue; }
            }
            let item = plan[step];
            // politics: the poorest team spends some of its time making money
            const team = POLITICS.teams[market.social.teamOf(name)];
            if (team?.focus === 'money' && team.treasurer !== name && item.task !== 'thieving' && Math.random() < 0.5) {
                item = { task: 'thieving', minutes: 20, why: 'team is poorest: making money' };
            }
            const task = taskById(item.task);
            if (!task) { bot.log(`unknown task ${item.task}, skipping`); writeStep(name, step + 1); continue; }
            const ok = task.canRun(bot);
            if (ok !== true) {
                bot.log(`cannot run ${item.task}: ${ok} (trading or shopping for it)`);
                await market.seek(name);
                if (market.dealFor(name)) { await bot.handleInterrupts(); continue; }
                const needs = market.needsOf(name);
                if (needs.length) await RESUPPLY.run(bot, Date.now() + 10 * 60_000, needs);
                if (task.canRun(bot) !== true) writeStep(name, step + 1);
                continue;
            }
            bot.log(`[plan step ${step}] ${item.task} for ${item.minutes}m — ${item.why ?? ''} | ${summary(bot.s)}`);
            bot._currentTask = item.task;
            await task.run(bot, Date.now() + (item.minutes ?? 15) * 60_000, item); // quests read their step (party, item to fetch)
            writeStep(name, step + 1);
            // habit: now and then, drift to a favorite spot between tasks
            const habits = personalityOf(name).habits;
            if (habits?.spot && Math.random() < 0.2 && market.social.mood(name) > -0.5) {
                const spot = SPOTS[habits.spot];
                bot.log(`habit: wandering to ${spot.label}`);
                await bot.walkTo(spot.x, spot.y, { tol: 3, timeout: 120 });
                const text = market.social.line(name, 'idle', spot.label);
                if (text) await bot.act({ type: 'say', text });
                await bot.wait(30);
            }
            await bot.state(1);
            fs.appendFileSync(PROGRESS, JSON.stringify({ t: Date.now(), bot: name, kind: 'claude', task: item.task, total: bot.s.totalLevel, combat: bot.s.combat, x: bot.s.x, y: bot.s.y, stats: Object.fromEntries(Object.entries(bot.s.stats).map(([k, v]) => [k, v.level])) }) + '\n');
        } catch (e) {
            if (e.message === 'PREEMPT') { bot.log('dropping what I was doing for a quest'); continue; }
            bot.log(`error: ${e.stack ?? e}`);
            await sleep(15_000);
        }
    }
}

// individualists + every team member (see TEAMS in market.mjs)
const INDIVIDUALS = Number(process.env.INDIVIDUALS ?? 10);
const names = [
    ...Array.from({ length: INDIVIDUALS }, (_, i) => `claudebot${i + 1}`),
    ...Object.values(TEAMS).flatMap(t => Array.from({ length: t.size }, (_, i) => `${t.prefix}${i + 1}`))
];
console.log(`starting Claude-directed bots: ${names.join(', ')}`);
// team council (scoreboard, mutiny, leaving, recruiting) every POLITICS_MINUTES
const POLITICS_MINUTES = Number(process.env.POLITICS_MINUTES ?? 60);
setInterval(() => { try { council(market); } catch (e) { console.log('council error', e); } }, POLITICS_MINUTES * 60_000);
// quests: the planner slots quest steps into plans every QUEST_PLAN_MINUTES (first pass 5 minutes after start)
const QUEST_PLAN_MINUTES = Number(process.env.QUEST_PLAN_MINUTES ?? 20);
setTimeout(() => { try { planQuests(market); } catch (e) { console.log('quest planner error', e); } }, 5 * 60_000);
setInterval(() => { try { planQuests(market); } catch (e) { console.log('quest planner error', e); } }, QUEST_PLAN_MINUTES * 60_000);
setInterval(() => market.social.driftMoods(), 10 * 60_000);
await Promise.all(names.map((n, i) => runBot(n, i * 3000)));
