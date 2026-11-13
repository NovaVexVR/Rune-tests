// Claude-directed bots. Each bot follows the plan Claude writes in orders/<name>.json:
//   { "plan": [ { "task": "melee", "minutes": 20, "why": "..." }, ... ], "loop": true, "paused": false }
// The file is re-read after every step, so Claude can change plans at any time. While "paused"
// is true the runner leaves the bot alone so Claude can drive it directly through the API
// (quests, shopping, banking, exploring).
//
// usage: node claude_runner.mjs [count=5]
import { coinsOf, recordFlow } from './economy.mjs';
import fs from 'fs';
import path from 'path';

import { Bot, LOG_DIR, sleep, summary, watchdog, rememberDanger, inWest } from './lib.mjs';
import { getStep, setStep } from './steps.mjs';
import { taskById, RESUPPLY, prepare, clearOut, surplusInBank, sellGoods, goodsToSell, westStay, WEST_TASKS } from './tasks.mjs';
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
import { GrudgeDuels, revengeTask } from './duel.mjs';
import { checkAlerts } from './director.mjs';
import { backup } from './backup.mjs';
import { awardNicknames } from './nicknames.mjs';
import { tease } from './phobias.mjs';
import { gossipTick } from './gossip.mjs';
import { tallTales } from './talltales.mjs';
import { crier, tabloid } from './crier.mjs';
import { mayorTick } from './mayor.mjs';
import { feasts } from './feasts.mjs';
import { lottery } from './lottery.mjs';
import { Hunts } from './hunt.mjs';
import { superstitions } from './superstition.mjs';
import { updateRecords } from './records.mjs';
import { Outings } from './outings.mjs';
import { Celebrations } from './celebrations.mjs';
import { Meetups } from './meetups.mjs';
import { Stalls } from './stalls.mjs';
import { readEconomy } from './economy.mjs';

const ALL_BOTS = [];
const market = new Market((...a) => console.log(new Date().toISOString(), ...a));
const escorts = new Escorts(market, (...a) => console.log(new Date().toISOString(), ...a), note);
const townEvents = new TownEvents(market, (...a) => console.log(new Date().toISOString(), ...a));
const duels = new GrudgeDuels(market, (...a) => console.log(new Date().toISOString(), ...a));
townEvents.duels = duels; // the duel tournament uses the arena machinery
const hunts = new Hunts(market, (...a) => console.log(new Date().toISOString(), ...a));
const outings = new Outings(market, (...a) => console.log(new Date().toISOString(), ...a));
const celebrations = new Celebrations(market, (...a) => console.log(new Date().toISOString(), ...a));
const meetups = new Meetups(market, (...a) => console.log(new Date().toISOString(), ...a));
const stalls = new Stalls(market, (...a) => console.log(new Date().toISOString(), ...a));
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
            // out west (Catherby, Seers' Village) the east's market, duels and gatherings are a ship and 1,000gp away: it stays at its work
            const west = inWest(bot.s);
            if (!west && day && marketDay.upcoming() && day.start - Date.now() < 7 * 60_000 && marketDay.wants(name) && !day.arrived.includes(name)) {
                await marketDay.attend(bot);
                continue;
            }
            // bank running out of space: sell spare stacks at the general store (at most once an hour)
            if (Date.now() - (bot._lastClearOut ?? 0) > 3600_000 && surplusInBank(bot).length) {
                bot._lastClearOut = Date.now();
                const sold = await clearOut(bot);
                if (sold) note(name, `Cleared out the bank: sold ${sold} things at the general store.`);
            }
            // made goods to the shops that pay most for them (roadmap 53), every 6 hours
            if (Date.now() - (bot._lastSell ?? 0) > 6 * 3600_000 && goodsToSell(bot).length) {
                bot._lastSell = Date.now();
                const c0 = coinsOf(bot.s);
                const got = await sellGoods(bot).catch(() => 0);
                if (got > 0) { note(name, `Sold my goods at the shops for ${got}gp.`); recordFlow(name, 'selling', c0, coinsOf(await bot.state(1).catch(() => null))); }
            }
            // quest party: wait for the rest of the party, then quest together
            if (!west) {
                if (await duels.join(bot)) continue; // a grudge duel at the arena
                if (await hunts.join(bot)) continue; // a treasure hunt it has worked out
                if (await celebrations.join(bot)) continue; // cheer a friend's milestone (57)
                if (await stalls.join(bot)) continue; // keep a stall in Varrock square (56)
                if (await meetups.join(bot)) continue; // train beside a friend (55)
                if (await outings.join(bot)) continue; // a team outing (32)
                if (await parties.join(bot)) continue;
            }
            let item = plan[step];
            // politics: the poorest team spends some of its time making money
            const team = POLITICS.teams[market.social.teamOf(name)];
            if (team?.focus === 'money' && team.treasurer !== name && item.task !== 'thieving' && Math.random() < 0.5) {
                item = { task: 'thieving', minutes: 20, why: 'team is poorest: making money' };
            }
            // career: some of the time, a task from the bot's chosen career instead (once it has one)
            const rt = item.task !== 'treasury' && revengeTask(name); // training for a rematch (47)
            if (rt && rt !== item.task && taskById(rt)?.canRun(bot) === true) item = { task: rt, minutes: item.minutes ?? 20, why: 'training for a rematch' };
            const ct = item.task !== 'treasury' && careerTask(bot, id => taskById(id)?.canRun(bot));
            if (ct && ct !== item.task) item = { task: ct, minutes: item.minutes ?? 20, why: 'career' };
            // a town event (fishing contest, smithing fair) is on: entrants do the event's skill until it ends
            const et = item.task !== 'treasury' && townEvents.taskFor(bot, id => taskById(id)?.canRun(bot));
            if (et) item = { task: et, minutes: Math.max(5, Math.ceil((townEvents.current.end - Date.now()) / 60_000)), why: `the ${townEvents.current.kind} event` };
            // out west it stays a while (the ship costs 1,000gp): eastern steps wait, it keeps to its western trade
            const ws = item.task !== 'treasury' && westStay(bot);
            if (ws && !WEST_TASKS.includes(item.task)) item = { task: ws, minutes: item.minutes ?? 20, why: 'staying out west a while' };
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
                if (task.canRun(bot) !== true) {
                    // still can't: don't waste the step, do something useful it can do instead (keeps it levelling)
                    const alt = ['melee', 'fish_cook', 'woodcut_fire', 'mine', 'thieving', 'spin'].map(id => taskById(id)).filter(t => t && t.id !== item.task && t.canRun(bot) === true).sort(() => Math.random() - 0.5)[0];
                    if (alt) {
                        bot.log(`[plan step ${step}] instead of ${item.task}: ${alt.id} for ${item.minutes ?? 15}m`);
                        await prepare(bot, alt.id);
                        await alt.run(bot, marketDay.deadline(name, Date.now() + (item.minutes ?? 15) * 60_000)).catch(e => bot.log(`${alt.id}: ${e.message}`));
                    }
                    writeStep(name, step + 1);
                }
                continue;
            }
            bot.log(`[plan step ${step}] ${item.task} for ${item.minutes}m — ${item.why ?? ''} | ${summary(bot.s)}`);
            const coins0 = coinsOf(await bot.state(1).catch(() => null));
            await prepare(bot, item.task);
            try { await task.run(bot, marketDay.deadline(name, Date.now() + (item.minutes ?? 15) * 60_000)); }
            finally { if (bot.escort) escorts.finish(name); }
            recordFlow(name, item.task, coins0, coinsOf(await bot.state(1).catch(() => null))); // coin sources and sinks (27)
            checkGoal(bot);
            writeStep(name, step + 1);
            // habit: now and then, drift to a favorite spot between tasks
            const habits = personalityOf(name).habits;
            if (habits?.spot && Math.random() < 0.2 && market.social.mood(name) > -0.5 && !inWest(bot.s)) {
                const spot = SPOTS[habits.spot];
                bot.log(`habit: wandering to ${spot.label}`);
                await bot.walkTo(spot.x, spot.y, { tol: 3, timeout: 120 });
                const text = market.social.line(name, 'idle', spot.label);
                if (text) await bot.act({ type: 'say', text });
                await bot.wait(30);
            }
            await bot.state(1);
            fs.appendFileSync(PROGRESS, JSON.stringify({ t: Date.now(), bot: name, kind: 'claude', task: item.task, total: bot.s.totalLevel, combat: bot.s.combat, x: bot.s.x, y: bot.s.y, stats: Object.fromEntries(Object.entries(bot.s.stats ?? {}).map(([k, v]) => [k, v.level])) }) + '\n');
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
setInterval(() => { try { if (!marketDay.upcoming()) duels.tick(); } catch (e) { console.log('duel error', e); } }, 30 * 60_000);
setInterval(() => { try { const a = checkAlerts(); if (a.length) console.log(new Date().toISOString(), `[director] alert: ${a.join('; ')}`); } catch (e) { console.log('director alerts:', e.message); } }, 30 * 60_000); // trouble that calls for an early director pass
setInterval(() => { try { awardNicknames(market, (...a) => console.log(new Date().toISOString(), ...a), readEconomy().at(-1)?.richest?.[0]?.bot); } catch (e) { console.log('nicknames:', e.message); } }, 60 * 60_000); // nicknames (37)
setInterval(() => { try { tease(market, (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('phobias:', e.message); } }, 60 * 60_000); // phobias (39)
setInterval(() => { try { gossipTick(market, (...a) => console.log(new Date().toISOString(), ...a), readEconomy().at(-1)?.richest?.[0]?.bot); } catch (e) { console.log('gossip:', e.message); } }, 15 * 60_000); // gossip (40)
setInterval(() => { try { tallTales(market, (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('tales:', e.message); } }, 60 * 60_000); // tall tales (41)
setInterval(() => { try { crier(market, (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('crier:', e.message); } }, 60 * 60_000); // town crier (42)
setInterval(() => { try { tabloid(); } catch (e) { console.log('tabloid:', e.message); } }, 24 * 3600_000); // the Lumbridge Whisper (42)
setInterval(() => { try { mayorTick(market, (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('mayor:', e.message); } }, 60 * 60_000); // mayor of Lumbridge (43)
setInterval(() => { try { feasts(market, (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('feasts:', e.message); } }, 60 * 60_000); // feasts (44)
setInterval(() => { try { lottery(market, (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('lottery:', e.message); } }, 60 * 60_000); // the gambler's lottery (45)
setInterval(() => { try { hunts.tick(); } catch (e) { console.log('hunt:', e.message); } }, 60 * 60_000); // treasure hunts (46)
setInterval(() => { try { superstitions(market, (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('superstitions:', e.message); } }, 60 * 60_000); // superstitions and lucky charms (38)
setInterval(() => { try { updateRecords(market, (...a) => console.log(new Date().toISOString(), ...a)); } catch (e) { console.log('records:', e.message); } }, 60 * 60_000); // records and the hall of fame (36)
setInterval(() => { try { if (!marketDay.upcoming()) stalls.tick(); } catch (e) { console.log('stalls:', e.message); } }, 15 * 60_000); // bot-run stalls (56)
setInterval(() => { try { if (!marketDay.upcoming()) meetups.tick(); } catch (e) { console.log('meetups:', e.message); } }, 60 * 60_000); // friends and meetups (55)
setInterval(() => { try { celebrations.tick(); } catch (e) { console.log('celebrations:', e.message); } }, 10 * 60_000); // milestone celebrations (57)
setInterval(() => { try { if (!marketDay.upcoming()) outings.tick(); } catch (e) { console.log('outings:', e.message); } }, 60 * 60_000); // group combat outings (32)
setInterval(() => backup('daily', (...a) => console.log(new Date().toISOString(), ...a)), 24 * 3600_000); // daily world backup (also one at every launch)
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
