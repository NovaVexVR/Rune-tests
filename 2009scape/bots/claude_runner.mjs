// Claude-directed bots. Each bot follows the plan Claude writes in orders/<name>.json:
//   { "plan": [ { "task": "melee", "minutes": 20, "why": "..." }, ... ], "loop": true, "paused": false }
// The file is re-read after every step, so Claude can change plans at any time. While "paused"
// is true the runner leaves the bot alone so Claude can drive it directly through the API
// (quests, shopping, banking, exploring).
//
// usage: node claude_runner.mjs [count=5]
import fs from 'fs';
import path from 'path';

import { Bot, LOG_DIR, sleep, summary, watchdog, rememberDanger } from './lib.mjs';
import { getStep, setStep } from './steps.mjs';
import { taskById, RESUPPLY, prepare, clearOut, surplusInBank } from './tasks.mjs';
import { Market, TEAMS, TRADEABLE } from './market.mjs';
import { personalityOf, SPOTS } from './social.mjs';
import { council, STATE as POLITICS } from './politics.mjs';
import { MarketDay } from './marketday.mjs';
import { Parties } from './party.mjs';
import { note, noteLevel } from './diary.mjs';
import { Escorts } from './escort.mjs';
import { buildBoard } from './noticeboard.mjs';
import { careerTask, checkGoal, apprenticeships } from './careers.mjs';
import { TownEvents } from './events.mjs';
import { sampleEconomy } from './economy.mjs';

const ALL_BOTS = [];
const market = new Market((...a) => console.log(new Date().toISOString(), ...a));
const escorts = new Escorts(market, (...a) => console.log(new Date().toISOString(), ...a), note);
const townEvents = new TownEvents(market, (...a) => console.log(new Date().toISOString(), ...a));
const marketDay = new MarketDay(market, (...a) => console.log(new Date().toISOString(), ...a));
const parties = new Parties(market, (...a) => console.log(new Date().toISOString(), ...a));

const COUNT = Number(process.argv[2] ?? 5);
const ORDERS = path.join(path.dirname(new URL(import.meta.url).pathname), 'orders');
const PROGRESS = path.join(LOG_DIR, 'progress.jsonl');
fs.mkdirSync(ORDERS, { recursive: true });

function readOrders(name) {
    const f = path.join(ORDERS, `${name}.json`);
    if (!fs.existsSync(f)) {
        fs.writeFileSync(f, JSON.stringify({ plan: [{ task: 'melee', minutes: 15, why: 'default start' }], loop: true, paused: false }, null, 2));
    }
    return JSON.parse(fs.readFileSync(f, 'utf8'));
}

const writeStep = setStep; // progress lives in market/steps.json, not in the orders file

async function runBot(name, delay) {
    await sleep(delay);
    const bot = new Bot(name, { quiet: true });
    ALL_BOTS.push(bot);
    bot.onStuck = s => note(name, `Got stuck at ${s.x},${s.y} and had to find my way back to Lumbridge.`);
    readOrders(name);
    const pers = personalityOf(name);
    bot.log(`personality: ${pers.archetype} ${JSON.stringify(pers)}`);
    market.register(bot, () => readOrders(name).plan ?? []);
    bot.market = market;
    bot.onPm = pm => market.onPm(name, pm);
    // mood reacts to what happens in-game
    bot.onMsg = text => {
        if (/Oh dear, you are dead/i.test(text)) {
            market.social.bumpMood(name, -0.4, 'dying');
            marketDay.noteDeath(name);
            note(name, `Died for the first time, at ${bot.s?.x},${bot.s?.y}.`, { once: 'first-death' }) || note(name, `Died again, at ${bot.s?.x},${bot.s?.y}.`);
            // danger memory: avoid the spot on long trips, and warn the bots it trusts most
            if (bot.s && bot.s.y < 6000) {
                const { x, y } = bot.s;
                rememberDanger(name, x, y);
                const friends = [...market.bots.keys()].filter(o => o !== name && market.social.trust(name, o) > 0.1).sort((a, b) => market.social.trust(name, b) - market.social.trust(name, a)).slice(0, 3);
                for (const f of friends) { rememberDanger(f, x, y, name); market.dm(name, f, `Careful around ${x},${y}. I just died there.`); }
            }
        } else if (/advanced .* level|reached level/i.test(text)) { market.social.bumpMood(name, 0.1, 'a level-up'); noteLevel(name, text); }
    };
    // random events: gifts cheer a bot up, ambushes and kidnappings shake it
    bot.onRandomEvent = type => {
        note(name, type === 'RESCUED' ? 'Got stuck in a random event and had to be pulled out.' : `Random event: ${type.toLowerCase().replace(/_/g, ' ')}.`);
        if (['GENIE', 'DRUNKEN_DWARF', 'RICK_TURPENTINE', 'STRANGE_PLANT'].includes(type)) market.social.bumpMood(name, 0.05, `a ${type.toLowerCase().replace('_', ' ')} visit`);
        else market.social.bumpMood(name, type === 'RESCUED' ? -0.2 : -0.05, type === 'RESCUED' ? 'being stuck in a random event' : `a ${type.toLowerCase().replace('_', ' ')} ambush`);
    };
    let lastSeek = 0;
    bot.hook = async b => {
        if (market.dealFor(b.name)) {
            while (await market.step(b)) {}
            return true;
        }
        if (escorts.jobFor(b.name)) { await escorts.guard(b); return true; } // a teammate asked for an escort
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
            let step = getStep(name) ?? o.step ?? 0; // o.step: from orders written before steps.json
            if (step >= plan.length) {
                if (o.loop && plan.length) step = 0;
                else { await sleep(10000); continue; }
            }
            // market day at the Grand Exchange: go if it's about to open (and the bot wants to)
            const day = marketDay.day;
            if (day && marketDay.upcoming() && day.start - Date.now() < 7 * 60_000 && marketDay.wants(name) && !day.arrived.includes(name)) {
                await marketDay.attend(bot);
                continue;
            }
            // bank running out of space: sell spare stacks at the general store (at most once an hour)
            if (Date.now() - (bot._lastClearOut ?? 0) > 3600_000 && surplusInBank(bot).length) {
                bot._lastClearOut = Date.now();
                const sold = await clearOut(bot);
                if (sold) note(name, `Cleared out the bank: sold ${sold} things at the general store.`);
            }
            // quest party: wait for the rest of the party, then quest together
            if (await parties.join(bot)) continue;
            let item = plan[step];
            // politics: the poorest team spends some of its time making money
            const team = POLITICS.teams[market.social.teamOf(name)];
            if (team?.focus === 'money' && team.treasurer !== name && item.task !== 'thieving' && Math.random() < 0.5) {
                item = { task: 'thieving', minutes: 20, why: 'team is poorest: making money' };
            }
            // career: some of the time, a task from the bot's chosen career instead (once it has one)
            const ct = item.task !== 'treasury' && careerTask(bot, id => taskById(id)?.canRun(bot));
            if (ct && ct !== item.task) item = { task: ct, minutes: item.minutes ?? 20, why: 'career' };
            // a town event (fishing contest, smithing fair) is on: entrants do the event's skill until it ends
            const et = item.task !== 'treasury' && townEvents.taskFor(bot, id => taskById(id)?.canRun(bot));
            if (et) item = { task: et, minutes: Math.max(5, Math.ceil((townEvents.current.end - Date.now()) / 60_000)), why: `the ${townEvents.current.kind} event` };
            const task = taskById(item.task);
            if (!task) { bot.log(`unknown task ${item.task}, skipping`); writeStep(name, step + 1); continue; }
            let ok = task.canRun(bot);
            // too weak for the place (e.g. muggers at the iron mine): ask the team for an escort
            if (ok !== true && /combat|escort/i.test(ok) && (await escorts.request(bot, item.task))) ok = task.canRun(bot);
            if (ok !== true) {
                escorts.finish(name, 'none');
                bot.log(`cannot run ${item.task}: ${ok} (trading or shopping for it)`);
                await market.seek(name);
                if (market.dealFor(name)) { await bot.handleInterrupts(); continue; }
                const needs = market.needsOf(name);
                if (needs.length) await RESUPPLY.run(bot, Date.now() + 10 * 60_000, needs);
                if (task.canRun(bot) !== true) writeStep(name, step + 1);
                continue;
            }
            bot.log(`[plan step ${step}] ${item.task} for ${item.minutes}m — ${item.why ?? ''} | ${summary(bot.s)}`);
            await prepare(bot, item.task);
            try { await task.run(bot, marketDay.deadline(name, Date.now() + (item.minutes ?? 15) * 60_000)); }
            finally { if (bot.escort) escorts.finish(name); }
            checkGoal(bot);
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
setInterval(() => { try { apprenticeships(market, n => market.social.teamOf(n), (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('apprenticeship error', e); } }, 60 * 60_000);
setInterval(() => market.social.driftMoods(), 10 * 60_000);
setInterval(() => { try { buildBoard(); } catch (e) { console.log('notice board:', e.message); } }, 10 * 60_000); // the public notice board
watchdog(ALL_BOTS, (...a) => console.log(new Date().toISOString(), ...a));
setInterval(() => sampleEconomy().catch(e => console.log('economy sample:', e.message)), 30 * 60_000); // wealth over time (E23)
setInterval(() => { try { townEvents.tick(); } catch (e) { console.log('town event error', e); } }, 60_000);
setInterval(() => { try { marketDay.tick(); } catch (e) { console.log('market day error', e); } }, 60_000);
setInterval(() => { try { if (!marketDay.upcoming()) parties.tick(); } catch (e) { console.log('party error', e); } }, 5 * 60_000);
// ---- D18 newcomers: a fresh level-1 bot joins every NEWCOMER_HOURS (up to MAX_NEWCOMERS). A team with room
// sends its most generous member to welcome it with a starter gift; the trust that builds lets the council
// recruit it. Kept in market/newcomers.json (cleared on a reset); their orders files are written on arrival.
const NEWCOMER_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'newcomers.json');
const NEWCOMER_HOURS = Number(process.env.NEWCOMER_HOURS ?? 6), MAX_NEWCOMERS = Number(process.env.MAX_NEWCOMERS ?? 10);
const newcomers = (() => { try { return JSON.parse(fs.readFileSync(NEWCOMER_FILE, 'utf8')); } catch { return { joined: [], last: Date.now() }; } })();
const saveNewcomers = () => fs.writeFileSync(NEWCOMER_FILE, JSON.stringify(newcomers, null, 1));
const STARTER_PLAN = [{ task: 'woodcut_fire', minutes: 20, why: 'newcomer: learning the basics' }, { task: 'fish_cook', minutes: 20, why: 'newcomer: food' }, { task: 'mine', minutes: 15, why: 'newcomer' }, { task: 'melee', minutes: 20, why: 'newcomer: getting tougher' }];
async function welcome(name) {
    await sleep(5 * 60_000); // let it find its feet first
    const teams = Object.entries(POLITICS.teams).filter(([, d]) => d.members.length < Math.max(d.maxSize, 5) * 1.5);
    const [team, d] = teams[Math.floor(Math.random() * teams.length)] ?? [];
    if (!team) return;
    const mentor = d.members.filter(m => market.bots.get(m)?.bot.s?.online).sort((a, b) => market.social.p(b).generosity - market.social.p(a).generosity)[0];
    if (!mentor) return;
    market.dm(mentor, name, `Welcome to Lumbridge, ${name}. ${team} looks after its own. Here's something to start with.`);
    const spare = market.surplusOf(mentor).find(i => TRADEABLE.has(i.name));
    market.open(spare ? { buyer: name, seller: mentor, item: spare.name, amount: 1, price: 0, kind: 'gift' } : { buyer: name, seller: mentor, item: 'Coins', amount: 20, price: 0, kind: 'gift' });
    market.social.adjustTrust(name, mentor, 0.3);
    market.social.adjustTrust(mentor, name, 0.2);
    for (const m of d.members) if (m !== mentor) market.social.adjustTrust(m, name, 0.15);
    market.social.save();
    note(name, `${mentor} of ${team} welcomed me to town with a gift.`);
    note(mentor, `Welcomed the newcomer ${name} on behalf of ${team}.`);
    console.log(new Date().toISOString(), `[newcomer] ${mentor} (${team}) welcomes ${name}`);
}
function addNewcomer() {
    if (newcomers.joined.length >= MAX_NEWCOMERS) return;
    const name = `newbie${newcomers.joined.length + 1}`;
    const f = path.join(ORDERS, `${name}.json`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ plan: STARTER_PLAN, loop: true, paused: false }, null, 2));
    newcomers.joined.push({ name, t: new Date().toISOString() });
    newcomers.last = Date.now();
    saveNewcomers();
    console.log(new Date().toISOString(), `[newcomer] ${name} arrives in Lumbridge`);
    note(name, 'Arrived in Lumbridge with nothing but the starter kit.');
    runBot(name, 0).catch(e => console.log(`newcomer ${name}:`, e));
    welcome(name).catch(() => {});
}
setInterval(() => { if (Date.now() - newcomers.last > NEWCOMER_HOURS * 3600_000) addNewcomer(); }, 10 * 60_000);
await Promise.all([...names, ...newcomers.joined.map(n => n.name)].map((n, i) => runBot(n, i * 3000)));
