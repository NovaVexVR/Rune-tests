import fs from 'fs';
// Skill-training tasks shared by scripted bots and Claude-directed bots (2009Scape).
// Each task: { id, skills, canRun(bot) -> true | reason, run(bot, untilMs) }
import { fearOf } from './phobias.mjs';
import { readBoard } from './noticeboard.mjs';
import { note } from './diary.mjs';
import { doRitual, luckyOf } from './superstition.mjs';
import { dist, rand, sleep, FOOD, gearInfo, GE } from './lib.mjs';
import { faction, TASK_NEEDS } from './market.mjs';
import { getShears, shear, spin } from './quests.mjs';

export const PLACES = {
    lumbridge: { x: 3222, y: 3219 },
    lumbridgeTrees: { x: 3196, y: 3232 },
    lumbridgeOaks: { x: 3197, y: 3255 }, // between the oaks at 3188,3247 and 3206,3263,
    lumbridgeKitchen: { x: 3209, y: 3214 },
    chickens: { x: 3187, y: 3279 },
    cows: { x: 3257, y: 3263 },
    goblins: { x: 3246, y: 3241 },
    draynorFish: { x: 3087, y: 3229 },
    draynorWillows: { x: 3087, y: 3236 },
    lumbridgeWillows: { x: 3233, y: 3238 }, // willows at 3232,3245 and 3234,3231 by the river: no dark wizards
    lumbridgeRiver: { x: 3239, y: 3246 }, // fly fishing (Lure) spots: trout and salmon
    draynorTrees: { x: 3087, y: 3244 },
    swampFish: { x: 3243, y: 3151 },
    swampMine: { x: 3229, y: 3148 },
    furnace: { x: 3226, y: 3254 },
    varrockAnvils: { x: 3187, y: 3423, anvil: { x: 3188, y: 3424 } },
    varrockIron: { x: 3178, y: 3369 },
    barbarianCoal: { x: 3081, y: 3423 }, // Barbarian Village mine: coal rocks 11930-11932 (and tin) // Varrock south-west mine: iron rocks (11954-11956), west of the dark wizards
    farmers: { x: 3228, y: 3293 }
};

// bronze pieces a smith can make (smithing level, bars, the anvil menu's 'make 1' button), best first
export const BRONZE_PIECES = [
    { name: 'Bronze platebody', lvl: 18, bars: 5, button: 248 },
    { name: 'Bronze platelegs', lvl: 16, bars: 3, button: 240 },
    { name: 'Bronze kiteshield', lvl: 12, bars: 3, button: 208 },
    { name: 'Bronze chainbody', lvl: 11, bars: 3, button: 200 },
    { name: 'Bronze sq shield', lvl: 8, bars: 2, button: 160 },
    { name: 'Bronze full helm', lvl: 7, bars: 2, button: 152 },
    { name: 'Bronze med helm', lvl: 3, bars: 1, button: 48 },
    { name: 'Bronze dagger', lvl: 1, bars: 1, button: 24 }
];

// what a bot keeps on it when it banks: its tools and some food
const KEEP = name => /pickaxe$|(^| )axe$|^Hammer$|^Tinderbox$|^Small fishing net$|^Knife$|^Chisel$|^Shears$|^Fly fishing rod$|^Lobster pot$|^Feather$|^Needle$|^Thread$|^Air talisman$|^(Red|Yellow|Black|White) bead$|^Enchanted (beef|rat meat|bear meat|chicken)$|^Cadava (berries|potion)$|^Coins$/.test(name) || FOOD.includes(name);

// ---- bank clear-outs ----
// Bots bank everything. Goods normally leave the bank through trades and market days (marketday.mjs takes surplus
// from the bank before the trip). A bot only sells to a shop when its bank is running out of space (FULL_AT of its
// slots in use): then it sells whole stacks of things it can spare, smallest stacks first (they free a slot fastest),
// until the bank is back under ROOMY_AT. Tools, food, coins, runes, arrows, quest items and gear are never sold.
export const BANK_SLOTS = 496, FULL_AT = 0.85, ROOMY_AT = 0.75;
const NEVER_SELL = /^Coins$|rune$|arrow|^Feather$|bones$|^Bucket|^Empty pot$|^Pot of flour$|^Egg$|^Shears$|^Ball of wool$/i;
export const bankNearlyFull = bot => (bot.s.bank?.length ?? 0) >= BANK_SLOTS * FULL_AT;
export function surplusInBank(bot) {
    if (!bankNearlyFull(bot)) return [];
    const spare = (bot.s.bank ?? []).filter(i => !KEEP(i.name) && !NEVER_SELL.test(i.name) && !FOOD.includes(i.name) && !gearInfo(i.name) && i.name !== luckyOf(bot.name)); // never the lucky charm
    const free = Math.ceil((bot.s.bank?.length ?? 0) - BANK_SLOTS * ROOMY_AT); // slots to free
    return spare.sort((a, b) => a.count - b.count || a.count * (a.value ?? 1) - b.count * (b.value ?? 1)).slice(0, free).map(i => ({ name: i.name, count: i.count }));
}
export async function clearOut(bot) {
    await bot.state(5);
    let todo = surplusInBank(bot); // withdrawn as notes: any stack takes one slot
    if (!todo.length) return 0;
    let sold = 0;
    for (let round = 0; round < 6 && todo.length; round++) {
        if (!(await bot.openBank())) break;
        await bot.depositAll(i => !KEEP(i.name));
        const taken = [];
        for (const it of todo) {
            if (bot.s.invFree < 2) continue; // no room this trip
            await bot.withdraw(it.name, 'all', { noted: true });
            taken.push(it);
        }
        await bot.leaveBank();
        if (!(await bot.openShop(SHOPS.general))) break;
        for (const it of bot.s.inv.filter(i => taken.some(t => t.name === i.name))) { await bot.sell(it.name, it.count); sold += it.count; }
        await bot.closeInterfaces();
        todo = todo.filter(t => !taken.includes(t));
    }
    await bot.state(5);
    bot.log(`clear-out: bank nearly full, sold ${sold} things at the general store`);
    return sold;
}

// Before any task: wear the best gear carried (no melee weapon swap for ranged/magic), and fighters
// and thieves carry some food from the bank.
export async function prepare(bot, taskId) {
    bot._lastTask = taskId;
    await doRitual(bot, taskId).catch(() => {}); // a superstition (38)
    // the task's tools: if one is banked but not carried, fetch it
    const missing = (TASK_NEEDS[taskId] ?? []).filter(g => !g.some(n => bot.s.inv.some(i => i.name === n) || bot.s.worn.some(i => i.name === n)))
        .map(g => g.find(n => bot.s.bank?.some(i => i.name === n))).filter(Boolean);
    if (missing.length && (await bot.openBank().catch(() => false))) {
        for (const t of missing) await bot.withdraw(t, 1).catch(() => {});
        await bot.leaveBank();
        bot.log(`tools: took ${missing.join(', ')} out of the bank`);
    }
    if (taskId === 'fish_cook') await flyKit(bot).catch(e => bot.log(`fly fishing kit: ${e.message}`));
    await bot.gearUp({ weapon: !['ranged', 'magic'].includes(taskId) }).catch(() => {});
    if (taskId === 'melee') await buyArmour(bot).catch(e => bot.log(`armour: ${e.message}`));
    if (['melee', 'ranged', 'magic', 'thieving'].includes(taskId)) {
        const food = await bot.ensureFood(4).catch(() => 0);
        if (food < 2) await catchFood(bot, 6).catch(e => bot.log(`food: ${e.message}`)); // nothing banked: catch and cook some
    }
}

// Armour from the Varrock shops for fighters who can afford it: at most once every 6 hours, spending no more than
// 30% of its coins (bank + carried) and only once it has 200+, so wealth still grows. Body, legs and shield
// (helms come from smiths and the market). Steel needs Defence 5.
export const HORVIK = { x: 3229, y: 3436, npcs: ['Horvik'], sells: { 'Bronze sq shield': 48, 'Bronze chainbody': 60, 'Bronze platelegs': 80, 'Bronze platebody': 160, 'Iron sq shield': 168, 'Iron chainbody': 210, 'Iron platelegs': 280, 'Iron platebody': 560, 'Steel platebody': 2000 } };
export async function buyArmour(bot) {
    if (Date.now() < (bot._armourTry ?? 0)) return 0;
    bot._armourTry = Date.now() + 6 * 3600_000;
    const banked = (bot.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0;
    const wealth = bot.s.coins + banked;
    if (wealth < 200) return 0;
    let budget = Math.floor(wealth * 0.3);
    const best = slot => Math.max(-1, ...[...bot.s.worn, ...bot.s.inv, ...(bot.s.bank ?? [])].map(i => gearInfo(i.name)).filter(g => g?.slot === slot).map(g => g.score));
    const want = [];
    for (const slot of ['body', 'legs', 'shield']) {
        const pick = Object.entries(HORVIK.sells)
            .filter(([name, price]) => gearInfo(name).slot === slot && gearInfo(name).score > best(slot) && price <= budget && (!/^Steel/.test(name) || bot.lvl('defence') >= 5))
            .sort((a, b) => gearInfo(b[0]).score - gearInfo(a[0]).score)[0];
        if (pick) { want.push(pick); budget -= pick[1]; }
    }
    if (!want.length) return 0;
    const cost = want.reduce((t, [, p]) => t + p, 0);
    bot.log(`armour: shopping at Horvik's for ${want.map(w => w[0]).join(', ')} (${cost}gp of ${wealth}gp)`);
    if (bot.s.coins < cost && (await bot.openBank())) { await bot.withdrawN('Coins', cost - bot.s.coins); await bot.leaveBank(); }
    let bought = 0;
    if (await bot.openShop(HORVIK)) {
        for (const [name, price] of want) if (bot.s.coins >= price && (await bot.buy(name, 1))) bought++;
        await bot.closeInterfaces();
    }
    await bot.gearUp().catch(() => {});
    if (bot.s.coins > 50) await bot.bankItems(i => i.name === 'Coins'); // don't walk around with savings
    return bought;
}

// Fly fishing from Fishing 20: carry the rod and the banked feathers (chicken fighters bank them);
// a fisher with no rod and 30+ coins buys one at Gerrant's in Port Sarim (at most once a day if it fails).
export const FEATHERS_MIN = 10;
async function flyKit(bot) {
    if (bot.lvl('fishing') < 20) return;
    const banked = n => (bot.s.bank ?? []).filter(i => i.name === n).reduce((t, i) => t + i.count, 0);
    const take = [];
    if (!bot.has('Fly fishing rod') && banked('Fly fishing rod')) take.push(['Fly fishing rod', 1]);
    if (banked('Feather')) take.push(['Feather', 'all']);
    if (take.length && (await bot.openBank())) { for (const [n, k] of take) await bot.withdraw(n, k).catch(() => {}); await bot.leaveBank(); }
    const coins = bot.s.coins + banked('Coins');
    if (!bot.has('Fly fishing rod') && coins >= 30 && Date.now() > (bot._rodTry ?? 0)) {
        bot._rodTry = Date.now() + 24 * 3600_000;
        bot.log('fly fishing: buying a rod (and feathers) at Port Sarim');
        await RESUPPLY.run(bot, Date.now() + 15 * 60_000, ['Fly fishing rod']);
        // a few feathers to start with if none were banked (6gp each: keep most of the coins)
        if (bot.has('Fly fishing rod') && bot.count('Feather') < FEATHERS_MIN && bot.s.coins >= 60 && (await bot.openShop(SHOPS.gerrant))) { await bot.buy('Feather', 10); await bot.closeInterfaces(); }
    }
}

// A quick food run: net shrimps/anchovies at the swamp and cook them (up to 8 minutes).
export async function catchFood(bot, n = 6) {
    if (!bot.has('Small fishing net') || !bot.has('Tinderbox')) return false;
    const cooked = () => bot.s.inv.filter(i => FOOD.includes(i.name)).length;
    const raw = () => bot.s.inv.filter(i => /^Raw /.test(i.name)).length;
    bot.log('food: none carried or banked, catching some first');
    if (bot.s.invFree < n + 1) await bot.bankItems(i => !KEEP(i.name)); // make room: bank the clutter, keep tools
    const spot = PLACES.swampFish;
    await bot.walkTo(spot.x, spot.y, { tol: 5 });
    const end = now() + 8 * 60_000;
    while (now() < end) {
        const s = await bot.state(14);
        if (await bot.handleInterrupts()) continue;
        if (cooked() + raw() >= n || s.invFree <= 1) break;
        const fs = bot.nearestNpc(x => x.name === 'Fishing spot' && x.ops.includes('Net'));
        if (!fs) { await bot.walkTo(spot.x + rand(-4, 4), spot.y + rand(-4, 4), { tol: 2 }); continue; }
        await gatherOnce(bot, fs, 'Net', 'npc', 60);
    }
    await cookAll(bot);
    await bot.dropAll(i => /^Burnt/.test(i.name));
    await bot.state(5);
    bot.log(`food: caught and cooked, carrying ${cooked()}`);
    return cooked() > 0;
}

export const IRON_PIECES = [
    { name: 'Iron platebody', lvl: 33, bars: 5, button: 248 },
    { name: 'Iron platelegs', lvl: 31, bars: 3, button: 240 },
    { name: 'Iron kiteshield', lvl: 27, bars: 3, button: 208 },
    { name: 'Iron chainbody', lvl: 26, bars: 3, button: 200 },
    { name: 'Iron sq shield', lvl: 23, bars: 2, button: 160 },
    { name: 'Iron full helm', lvl: 22, bars: 2, button: 152 },
    { name: 'Iron med helm', lvl: 18, bars: 1, button: 48 },
    { name: 'Iron dagger', lvl: 15, bars: 1, button: 24 }
];

export const STEEL_PIECES = [
    { name: 'Steel platebody', lvl: 48, bars: 5, button: 248 },
    { name: 'Steel platelegs', lvl: 46, bars: 3, button: 240 },
    { name: 'Steel kiteshield', lvl: 42, bars: 3, button: 208 },
    { name: 'Steel chainbody', lvl: 41, bars: 3, button: 200 },
    { name: 'Steel sq shield', lvl: 38, bars: 2, button: 160 },
    { name: 'Steel full helm', lvl: 37, bars: 2, button: 152 },
    { name: 'Steel med helm', lvl: 33, bars: 1, button: 48 },
    { name: 'Steel dagger', lvl: 30, bars: 1, button: 24 }
];

export const SHOPS = {
    bob: { x: 3229, y: 3203, npcs: ['Bob'], sells: { 'Bronze axe': 16, 'Bronze pickaxe': 1, 'Iron axe': 56, 'Steel axe': 200 } },
    general: { x: 3216, y: 3241, npcs: ['Shopkeeper', 'Shop assistant'], sells: { Tinderbox: 1, Hammer: 1, Chisel: 1, Bucket: 2, 'Empty pot': 1 } },
    // Port Sarim fishing shop (shops.json "Gerrant's Fishy Business"): rods and feathers for fly fishing
    gerrant: { x: 3013, y: 3224, npcs: ['Gerrant'], sells: { 'Fly fishing rod': 5, Feather: 6, 'Small fishing net': 5, 'Lobster pot': 20 } }
    // runes are only sold in Varrock: bots trade for those
};
// Free respawning ground items near Lumbridge (wiki guides; coordinates from the server's ground spawns)
export const FREE_SPAWNS = {
    'Small fishing net': [{ x: 3245, y: 3155 }, { x: 3244, y: 3159 }], // Lumbridge Swamp, by the fishing tutor
    Knife: [{ x: 3205, y: 3212 }, { x: 3224, y: 3202 }],
    'Empty pot': [{ x: 3209, y: 3214 }],
    Bucket: [{ x: 3225, y: 3294 }],
    Egg: [{ x: 3229, y: 3299 }, { x: 3191, y: 3276 }]
};
export async function pickupFree(bot, item) {
    for (const spot of FREE_SPAWNS[item] ?? []) {
        await bot.walkTo(spot.x, spot.y, { tol: 3 });
        const s = await bot.state(6);
        const g = s.ground.find(o => o.name === item);
        if (!g) continue;
        await bot.act({ type: 'ground', x: g.x, y: g.y, id: g.id });
        await bot.waitIdle({ timeout: 15 });
        if (bot.has(item)) { bot.log(`picked up a free ${item}`); return true; }
    }
    return false;
}
export function shopFor(item) {
    return Object.values(SHOPS).find(sh => item in sh.sells) ?? null;
}

const now = () => Date.now();
const LOGS = ['Logs', 'Oak logs', 'Willow logs'];
const FM_REQ = { Logs: 1, 'Oak logs': 15, 'Willow logs': 30 };

function treeFor(bot) {
    const wc = bot.lvl('woodcutting');
    if (wc >= 30) return { place: PLACES.lumbridgeWillows, names: ['Willow'] };
    if (wc >= 20) return { place: PLACES.lumbridgeOaks, names: ['Oak'] };
    return { place: PLACES.lumbridgeTrees, names: ['Tree'] };
}

// Interact and wait until the action finishes or the inventory fills a bit.
async function gatherOnce(bot, target, op, kind = 'scenery', maxSecs = 40) {
    const before = bot.s.invFree;
    if (kind === 'scenery') await bot.act({ type: 'scenery', x: target.x, y: target.y, id: target.id, op });
    else await bot.act({ type: 'npc', npc: target.npc, op });
    await bot.waitIdle({ timeout: maxSecs, quiet: 3, cond: s => s.invFree < before - 3 });
}

async function lightFires(bot) {
    let fails = 0;
    while (fails < 4) {
        const s = await bot.state(6);
        const log = s.inv.find(i => LOGS.includes(i.name) && bot.lvl('firemaking') >= FM_REQ[i.name]);
        if (!log || !bot.has('Tinderbox')) break;
        const mark = bot.msgs.length;
        await bot.act({ type: 'useitem', item: 'Tinderbox', onSlot: log.slot });
        await bot.waitIdle({ timeout: 20, quiet: 2 });
        const m = bot.msgs.slice(mark).join(' ');
        if (/can't light a fire here|already a fire/i.test(m)) {
            fails++;
            await bot.act({ type: 'walk', x: s.x + rand(-4, 4), y: s.y + rand(-4, 4) });
            await bot.waitIdle({ timeout: 10 });
        }
    }
    await bot.state();
    // logs it can't burn (yet) are a resource: bank them once the bag is filling up
    if (bot.s.invFree <= 4) await bot.bankItems(i => LOGS.includes(i.name));
}

async function cookAll(bot) {
    await cookOnFire(bot);
    // still raw (no fire would light, no tree nearby): the range in Lumbridge castle's kitchen, which the Cook only
    // lets you use after Cook's Assistant
    if (bot.s.inv.some(i => /^Raw /.test(i.name)) && (bot.s.quests?.["Cook's Assistant"] ?? 0) >= 100) {
        await bot.travel(3209, 3214, { tol: 2 });
        for (let i = 0; i < 6 && (await bot.state(8)).inv.some(x => /^Raw /.test(x.name)); i++) {
            const range = bot.nearestScenery(l => /range/i.test(l.name)) ?? { x: 3212, y: 3215, id: 114 }; // no options, so not always listed
            const item = bot.s.inv.find(x => /^Raw /.test(x.name));
            if (!item) break;
            await bot.act({ type: 'useitem', slot: item.slot, x: range.x, y: range.y, id: range.id }).catch(() => {});
            await bot.wait(2);
            await cookMenu(bot);
            await bot.waitIdle({ timeout: 60, quiet: 4 });
        }
    }
}

async function cookOnFire(bot) {
    for (let attempts = 0; attempts < 12; attempts++) {
        let s = await bot.state(8);
        const raw = s.inv.filter(i => /^Raw /.test(i.name));
        if (!raw.length) return;
        let fire = bot.nearestScenery(l => l.name === 'Fire' && l.dist <= 6);
        if (!fire) {
            if (!bot.has('Tinderbox')) return;
            if (!s.inv.some(i => i.name === 'Logs')) {
                // bag full and no firewood: bank the cooked food (or, if none, the raw fish) to make room, rather than dropping any
                if (s.invFree === 0) { const cooked = s.inv.some(i => FOOD.includes(i.name)); await bot.bankItems(i => (cooked ? FOOD.includes(i.name) : /^Raw /.test(i.name)), { back: { x: s.x, y: s.y } }); continue; }
                const tree = bot.nearestScenery(l => l.name === 'Tree' && l.ops.includes('Chop down'));
                // firewood: the Lumbridge trees (never Draynor's, next to the dark wizards, at low combat)
                const wood = bot.s.combat >= 20 ? PLACES.draynorTrees : PLACES.lumbridgeTrees;
                if (!tree) { await bot.walkTo(wood.x, wood.y, { tol: 3 }); continue; }
                await gatherOnce(bot, tree, 'Chop down');
                continue;
            }
            await bot.act({ type: 'useitem', item: 'Tinderbox', onItem: 'Logs' });
            await bot.waitIdle({ timeout: 20 });
            continue;
        }
        // use raw fish on the fire; 2009 opens a "how many" menu which handleInterrupts answers
        const item = s.inv.find(i => /^Raw /.test(i.name));
        await bot.act({ type: 'useitem', slot: item.slot, x: fire.x, y: fire.y, id: fire.id });
        await bot.wait(2);
        await cookMenu(bot);
        await bot.waitIdle({ timeout: 60, quiet: 4 });
    }
}

// Skill "make X" menus: press the "make all" style option if one is open.
async function cookMenu(bot) {
    for (let i = 0; i < 4; i++) { // the menu shows once the bot has walked up to the fire or range
        const s = await bot.state(3);
        if (s.chatbox === 307) { await bot.act({ type: 'continue', child: 3 }); return true; } // cook all
        if (s.dialog?.skillMenu) { await bot.act({ type: 'skillmenu', index: 0 }); return true; }
        await bot.wait(2);
    }
    return false;
}

export const TASKS = [
    {
        id: 'woodcut_fire',
        skills: ['woodcutting', 'firemaking'],
        canRun: bot => ['Bronze axe', 'Iron axe', 'Steel axe', 'Mithril axe'].some(a => bot.has(a)) || 'need an axe',
        async run(bot, until) {
            let t = treeFor(bot);
            await bot.walkTo(t.place.x, t.place.y, { tol: 6 });
            while (now() < until) {
                const s = await bot.state(14);
                if (await bot.handleInterrupts()) continue;
                if (s.invFree === 0) {
                    await lightFires(bot);
                    t = treeFor(bot);
                    if (dist(s, t.place) > 16) await bot.walkTo(t.place.x, t.place.y, { tol: 6 });
                    continue;
                }
                const tree = bot.nearestScenery(l => t.names.includes(l.name) && l.ops.includes('Chop down'));
                if (!tree) { await bot.walkTo(t.place.x + rand(-6, 6), t.place.y + rand(-6, 6), { tol: 3 }); continue; }
                await gatherOnce(bot, tree, 'Chop down', 'scenery', 45);
            }
            await lightFires(bot);
        }
    },
    {
        id: 'fish_cook',
        skills: ['fishing', 'cooking'],
        canRun: bot => bot.has('Small fishing net') || (bot.has('Fly fishing rod') && bot.count('Feather') > 0) || 'need a small fishing net',
        async run(bot, until) {
            // Draynor has aggressive dark wizards: only go there once combat can handle them
            // fly fishing (trout from 20, salmon from 30) while there are feathers; otherwise the net
            const fly = () => bot.lvl('fishing') >= 20 && bot.has('Fly fishing rod') && bot.count('Feather') > 0;
            const flying = fly();
            const spot = flying ? PLACES.lumbridgeRiver : bot.s.combat >= 20 && Math.random() < 0.5 ? PLACES.draynorFish : PLACES.swampFish;
            const OP = flying ? 'Lure' : 'Net';
            if (flying) bot.log(`fly fishing with ${bot.count('Feather')} feathers`);
            await bot.walkTo(spot.x, spot.y, { tol: 5 });
            while (now() < until) {
                const s = await bot.state(14);
                if (await bot.handleInterrupts()) continue;
                if (s.invFree === 0) {
                    await cookAll(bot);
                    const food = bot.inv(i => FOOD.includes(i.name));
                    // keep extra cooked food when someone has posted a food bounty we could fill
                    const wantedFood = bot.market ? bot.market.social.openBounties().filter(b => FOOD.includes(b.item) && b.poster !== bot.name).reduce((t, b) => t + b.qty, 0) : 0;
                    // keep 6 (plus any wanted for a bounty); bank the rest as a reserve for fights and for teammates
                    await bot.dropAll(i => /^Burnt/.test(i.name)); // burnt fish is the only thing worth binning
                    if (food.length > 6 + wantedFood && (await bot.openBank())) {
                        const keep = new Set(food.slice(0, 6 + wantedFood).map(f => f.slot));
                        for (const f of food.filter(f => !keep.has(f.slot))) { await bot.act({ type: 'deposit', slot: f.slot, amount: 1 }).catch(() => {}); await bot.wait(1); }
                        await bot.depositAll(i => /^Raw /.test(i.name)); // couldn't cook it now: cook it another day, or trade it
                        await bot.leaveBank();
                        await bot.walkTo(spot.x, spot.y, { tol: 5 });
                    } else if (bot.s.inv.some(i => /^Raw /.test(i.name))) await bot.bankItems(i => /^Raw /.test(i.name), { back: spot });
                    await bot.state();
                    await bot.walkTo(spot.x, spot.y, { tol: 5 });
                    continue;
                }
                if (flying && !fly()) { bot.log('out of feathers: back to the net'); return; }
                const fs = bot.nearestNpc(n => n.name === 'Fishing spot' && n.ops.includes(OP));
                if (!fs) { await bot.walkTo(spot.x + rand(-4, 4), spot.y + rand(-4, 4), { tol: 2 }); continue; }
                await gatherOnce(bot, fs, OP, 'npc', 60);
            }
        }
    },
    {
        id: 'mine',
        skills: ['mining'],
        canRun: bot => ['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe'].some(a => bot.has(a)) || 'need a pickaxe',
        async run(bot, until) {
            await bot.walkTo(PLACES.swampMine.x, PLACES.swampMine.y, { tol: 6 });
            while (now() < until) {
                const s = await bot.state(12);
                if (await bot.handleInterrupts()) continue;
                if (s.invFree <= 1) {
                    // ore has trade value (smithing later / other bots): bank it at Lumbridge
                    if (!(await bot.bankItems(i => /ore$|^Clay$|^Coal$|^Uncut/.test(i.name)))) { await bot.wait(10); continue; } // never drop ore: try the bank again
                    await bot.walkTo(PLACES.swampMine.x, PLACES.swampMine.y, { tol: 6 });
                    continue;
                }
                // keep copper and tin even (counting the bank): bronze needs one of each, and banks were filling with copper
                const have = x => s.inv.filter(i => i.name === x).length + (s.bank?.find(i => i.name === x)?.count ?? 0);
                const want = have('Copper ore') <= have('Tin ore') ? [11936, 11937, 11938] : [11933, 11934, 11935];
                const rock = bot.nearestScenery(l => l.ops.includes('Mine') && want.includes(l.id)) ?? bot.nearestScenery(l => l.ops.includes('Mine') && /rocks/i.test(l.name));
                if (!rock) { await bot.walkTo(PLACES.swampMine.x + rand(-5, 5), PLACES.swampMine.y + rand(-5, 5), { tol: 2 }); continue; }
                await gatherOnce(bot, rock, 'Mine', 'scenery', 30);
            }
        }
    },
    {
        // mine copper and tin in pairs at the swamp, smelt bronze bars at the Lumbridge furnace, bank the bars
        id: 'smelt',
        skills: ['smithing', 'mining'],
        canRun: bot => ['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe'].some(a => bot.has(a)) || 'need a pickaxe',
        async run(bot, until) {
            const COPPER = [11936, 11937, 11938], TIN = [11933, 11934, 11935]; // the rocks' ore shows in their colour
            const n = name => bot.s.inv.filter(i => i.name === name).reduce((t, i) => t + i.count, 0);
            await bot.state(5);
            const bankOre = x => bot.s.bank?.find(i => i.name === x)?.count ?? 0;
            // steel at Smithing 30: 1 iron ore + 2 coal per bar, up to 9 bars a trip (all 27 slots)
            const steel = Math.min(9, bankOre('Iron ore'), Math.floor(bankOre('Coal') / 2));
            if (bot.lvl('smithing') >= 30 && steel >= 2 && (await bot.openBank())) {
                await bot.depositAll(i => !KEEP(i.name));
                await bot.withdrawN('Iron ore', steel);
                await bot.withdrawN('Coal', steel * 2);
                await bot.leaveBank();
                await bot.walkTo(PLACES.furnace.x, PLACES.furnace.y, { tol: 2 });
                for (let i = 0; i < 30 && n('Iron ore') > 0 && n('Coal') >= 2 && now() < until; i++) {
                    const st = await bot.state(6);
                    if (st.iface === 311 || st.chatbox === 311) { await bot.act({ type: 'button', iface: 311, child: 32 }); await bot.wait(5); continue; } // steel, make 1
                    const f = bot.nearestScenery(l => l.name === 'Furnace' && l.ops.includes('Smelt'));
                    if (!f) break;
                    await bot.act({ type: 'scenery', x: f.x, y: f.y, id: f.id, op: 'Smelt' });
                    await bot.waitIdle({ timeout: 10, cond: x => x.iface === 311 || x.chatbox === 311 });
                }
                await bot.closeInterfaces();
                bot.log(`smelted: ${n('Steel bar')} steel bars`);
                await bot.bankItems(i => /^(Steel bar|Iron ore|Coal)$/.test(i.name));
                await bot.state(5);
            }
            // iron ore in the bank and Smithing 15: smelt iron bars first (iron fails about half the time, as in the game)
            if (bot.lvl('smithing') >= 15 && bankOre('Iron ore') >= 3 && (await bot.openBank())) {
                await bot.depositAll(i => !KEEP(i.name));
                await bot.withdraw('Iron ore', 'all');
                await bot.leaveBank();
                await bot.walkTo(PLACES.furnace.x, PLACES.furnace.y, { tol: 2 });
                for (let i = 0; i < 40 && n('Iron ore') > 0 && now() < until; i++) {
                    const st = await bot.state(6);
                    if (st.iface === 311 || st.chatbox === 311) { await bot.act({ type: 'button', iface: 311, child: 24 }); await bot.wait(5); continue; } // iron, make 1
                    const f = bot.nearestScenery(l => l.name === 'Furnace' && l.ops.includes('Smelt'));
                    if (!f) break;
                    await bot.act({ type: 'scenery', x: f.x, y: f.y, id: f.id, op: 'Smelt' });
                    await bot.waitIdle({ timeout: 10, cond: x => x.iface === 311 || x.chatbox === 311 });
                }
                await bot.closeInterfaces();
                bot.log(`smelted: ${n('Iron bar')} iron bars`);
                await bot.bankItems(i => /^Iron (bar|ore)$/.test(i.name));
            }
            // bronze: ore already in the bank comes first
            if (Math.min(bankOre('Copper ore'), bankOre('Tin ore')) >= 3 && (await bot.openBank())) {
                await bot.depositAll(i => /^Bronze bar$|ore$/.test(i.name));
                await bot.withdraw('Copper ore', 10);
                await bot.withdraw('Tin ore', 10);
                await bot.leaveBank();
            }
            while (now() < until) {
                const s = await bot.state(12);
                if (await bot.handleInterrupts()) continue;
                const cu = n('Copper ore'), sn = n('Tin ore');
                if (s.invFree <= 1 || (cu >= 6 && sn >= 6)) {
                    if (Math.min(cu, sn) > 0) {
                        await bot.walkTo(PLACES.furnace.x, PLACES.furnace.y, { tol: 2 });
                        // the bar menu opens in the chatbox (311); "make 1" (button 16) is the one that works here, so repeat it
                        for (let i = 0; i < 40 && Math.min(n('Copper ore'), n('Tin ore')) > 0; i++) {
                            const st = await bot.state(6);
                            if (st.iface === 311 || st.chatbox === 311) { await bot.act({ type: 'button', iface: 311, child: 16 }); await bot.wait(5); continue; }
                            const f = bot.nearestScenery(l => l.name === 'Furnace' && l.ops.includes('Smelt'));
                            if (!f) break;
                            await bot.act({ type: 'scenery', x: f.x, y: f.y, id: f.id, op: 'Smelt' });
                            await bot.waitIdle({ timeout: 10, cond: x => x.iface === 311 || x.chatbox === 311 });
                        }
                        await bot.closeInterfaces();
                        bot.log(`smelted: ${n('Bronze bar')} bronze bars`);
                    }
                    await bot.state(5);
                    if (n('Bronze bar') >= 10 || bot.s.invFree <= 2) {
                        if (await bot.openBank()) { await bot.depositAll(i => /^Bronze bar$|ore$/.test(i.name)); await bot.leaveBank(); }
                    }
                    await bot.walkTo(PLACES.swampMine.x, PLACES.swampMine.y, { tol: 6 });
                    continue;
                }
                const want = cu <= sn ? COPPER : TIN;
                let rock = bot.nearestScenery(l => l.ops.includes('Mine') && want.includes(l.id));
                // the ore we're short of is mined out: wait for it to respawn rather than pile up the other one
                if (!rock && Math.abs(cu - sn) >= 2) { await bot.wait(4); continue; }
                rock ??= bot.nearestScenery(l => l.ops.includes('Mine') && [...COPPER, ...TIN].includes(l.id));
                if (!rock) { await bot.walkTo(PLACES.swampMine.x + rand(-5, 5), PLACES.swampMine.y + rand(-5, 5), { tol: 2 }); continue; }
                await gatherOnce(bot, rock, 'Mine', 'scenery', 30);
            }
        }
    },
    {
        // take bronze bars from the bank to the Varrock west anvils, smith daggers, bring them home to the bank
        id: 'smith',
        skills: ['smithing'],
        canRun: bot => !bot.has('Hammer') ? 'need a hammer' : (['Bronze bar', 'Iron bar', 'Steel bar'].some(b => bot.has(b) || bot.s.bank?.some(i => i.name === b)) ? true : 'need bars'),
        async run(bot, until) {
            const n = name => bot.s.inv.filter(i => i.name === name).reduce((t, i) => t + i.count, 0);
            // iron once it can (Smithing 15) and has iron bars, else bronze
            const hasBars = b => n(b) > 0 || bot.s.bank?.some(i => i.name === b);
            const sm = bot.lvl('smithing');
            const BAR = sm >= 30 && hasBars('Steel bar') ? 'Steel bar' : sm >= 15 && hasBars('Iron bar') ? 'Iron bar' : 'Bronze bar';
            const PIECES = { 'Steel bar': STEEL_PIECES, 'Iron bar': IRON_PIECES, 'Bronze bar': BRONZE_PIECES }[BAR];
            while (now() < until) {
                await bot.state(10);
                if (!n(BAR)) {
                    if (!(await bot.openBank())) return;
                    await bot.depositAll(i => !KEEP(i.name));
                    if (!bot.s.bank?.some(i => i.name === BAR)) { await bot.leaveBank(); return; }
                    await bot.withdraw(BAR, 'all');
                    await bot.leaveBank();
                    if (!n(BAR)) return;
                }
                const A = PLACES.varrockAnvils;
                if (!(await bot.travel(A.x, A.y, { tol: 2 }))) return;
                // what to make: the best armour piece its level and bars allow that it doesn't own yet (it wears its own,
                // the rest go to the bank as goods for fighters), else daggers for the practice
                const owned = name => bot.has(name) || bot.s.bank?.some(i => i.name === name);
                const lvl = bot.lvl('smithing');
                const pick = () => PIECES.find(p => lvl >= p.lvl && n(BAR) >= p.bars && (!owned(p.name) || p.name === PIECES.at(-1).name)) ?? PIECES.at(-1);
                for (let i = 0; i < 60 && n(BAR) && now() < until + 5 * 60_000; i++) {
                    const st = await bot.state(6);
                    if (await bot.handleInterrupts()) continue;
                    if (st.iface === 300) { const p = pick(); await bot.act({ type: 'button', iface: 300, child: p.button }); await bot.wait(4 + 2 * p.bars); await bot.gearUp(); continue; } // make 1
                    const bar = st.inv.find(x => x.name === BAR);
                    if (!bar) break; // all smithed
                    await bot.act({ type: 'useitem', slot: bar.slot, x: A.anvil.x, y: A.anvil.y }).catch(e => bot.log(`smith: ${e.message}`));
                    await bot.waitIdle({ timeout: 10, cond: x => x.iface === 300 });
                }
                await bot.closeInterfaces();
                bot.log(`smithed: ${bot.s.inv.filter(i => /^(Bronze|Iron|Steel) (?!bar)/.test(i.name)).map(i => i.name).join(', ')}; banking them`);
                if (await bot.openBank()) { await bot.depositAll(i => !KEEP(i.name)); await bot.leaveBank(); }
            }
        }
    },
    {
        // iron at the Varrock south-west mine (Mining 20), banked at Varrock West next door
        id: 'mine_iron',
        skills: ['mining'],
        // at Mining 15 a bronze pickaxe hardly ever gets iron; and a Mugger (level 6) roams this mine
        canRun: bot => !['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe'].some(a => bot.has(a)) ? 'need a pickaxe' : bot.lvl('mining') < 20 ? 'need Mining 20' : (bot.s.combat ?? 3) >= 10 || !!bot.escort || 'need combat 10 (muggers) or an escort',
        async run(bot, until) {
            // from Mining 40 (below that coal hardly ever comes: ~1 swing in 76 at 30, 1 in 7 at 40), coal (Barbarian Village) whenever the bank has less than 2 coal per iron ore: steel needs both
            const banked = x => bot.s.bank?.find(i => i.name === x)?.count ?? 0;
            const coal = bot.lvl('mining') >= 40 && banked('Coal') < 2 * Math.max(5, banked('Iron ore'));
            const IRON = coal ? [11930, 11931, 11932] : [11954, 11955, 11956];
            const M = coal ? PLACES.barbarianCoal : PLACES.varrockIron;
            if (coal) bot.log(`mining coal at Barbarian Village (bank: ${banked('Coal')} coal, ${banked('Iron ore')} iron ore)`);
            if (!(await bot.travel(M.x, M.y, { tol: 4 }))) return;
            while (now() < until) {
                const s = await bot.state(12);
                if (await bot.handleInterrupts()) continue;
                if (s.invFree <= 1) {
                    if (!(await bot.bankItems(i => /ore$|^Coal$|^Uncut/.test(i.name)))) { await bot.wait(10); continue; }
                    await bot.travel(M.x, M.y, { tol: 4 });
                    continue;
                }
                const rock = bot.nearestScenery(l => l.ops.includes('Mine') && IRON.includes(l.id));
                if (!rock) { await bot.wait(4); continue; } // mined out: wait for the respawn
                await gatherOnce(bot, rock, 'Mine', 'scenery', 30);
            }
            await bot.bankItems(i => /ore$|^Coal$|^Uncut/.test(i.name)); // end of the shift: bank it, don't walk home loaded
        }
    },
    {
        // shear Fred's sheep, spin the wool on the castle wheel, bank the balls of wool (a good others want:
        // 20 of them finish Sheep Shearer)
        id: 'spin',
        skills: ['crafting'],
        canRun: () => true,
        async run(bot, until) {
            if (!(await getShears(bot))) { bot.log('spin: no shears to be found'); return; }
            while (now() < until) {
                await bot.state(5);
                if (bot.s.invFree < 6) await bot.bankItems(i => !KEEP(i.name)); // room for wool
                await shear(bot, Math.min(20, bot.s.invFree - 1));
                await spin(bot);
                const balls = bot.s.inv.filter(i => i.name === 'Ball of wool').length;
                bot.log(`spin: ${balls} balls of wool, banking them`);
                await bot.bankItems(i => i.name === 'Ball of wool' || i.name === 'Wool');
            }
        }
    },
    {
        id: 'melee',
        skills: ['attack', 'strength', 'defence', 'hitpoints', 'prayer'],
        canRun: () => true,
        async run(bot, until) {
            await bot.state();
            await bot.gearUp(); // best weapon, shield and armour it carries
            const atk = bot.lvl('attack'), str = bot.lvl('strength'), def = bot.lvl('defence');
            // melee guide: prioritise Strength, keep Attack within ~5 levels, Defence last
            const style = str <= atk + 4 && str < def + 15 ? 1 : atk < str - 4 ? 0 : def + 10 < Math.min(atk, str) ? 3 : 1;
            await bot.act({ type: 'style', n: style });
            const avg = (atk + str + def) / 3;
            const [area, targets] = avg < 20 ? [PLACES.chickens, ['Chicken']] : [PLACES.cows, ['Cow', 'Cow calf']];
            await fightLoop(bot, until, area, targets);
        }
    },
    {
        id: 'ranged',
        skills: ['ranged', 'hitpoints'],
        canRun: bot => (bot.count('Bronze arrow') >= 5 || bot.s.worn.some(w => w.name === 'Bronze arrow' && w.count >= 5)) || 'need bronze arrows',
        async run(bot, until) {
            await bot.state();
            await bot.equip('Shortbow');
            await bot.equip('Bronze arrow');
            await bot.act({ type: 'style', n: 1 }); // ranged guide: Rapid for fastest xp
            await fightLoop(bot, until, PLACES.chickens, ['Chicken'], { pickup: ['Bronze arrow'], stopIf: b => !b.s.worn.some(w => w.name === 'Bronze arrow') });
            await bot.equip('Bronze sword');
            await bot.equip('Wooden shield');
        }
    },
    {
        id: 'magic',
        skills: ['magic', 'hitpoints'],
        canRun: bot => (bot.count('Air rune') >= 1 && bot.count('Mind rune') >= 1) || 'need air+mind runes',
        async run(bot, until) {
            await bot.walkTo(PLACES.chickens.x, PLACES.chickens.y, { tol: 6 });
            while (now() < until && bot.count('Air rune') >= 1 && bot.count('Mind rune') >= 1) {
                await bot.state(12);
                if (await bot.handleInterrupts()) continue;
                const t = bot.nearestNpc(n => n.name === 'Chicken' && !n.inCombat);
                if (!t) { await bot.walkTo(PLACES.chickens.x + rand(-4, 4), PLACES.chickens.y + rand(-4, 4)); continue; }
                await bot.act({ type: 'spellnpc', npc: t.npc, spell: 1 }); // Wind Strike
                await bot.waitIdle({ timeout: 20, quiet: 3 });
            }
        }
    },
    {
        id: 'thieving',
        skills: ['thieving'],
        canRun: () => true,
        async run(bot, until) {
            const start = bot.lvl('thieving') >= 10 ? PLACES.farmers : PLACES.lumbridge;
            await bot.walkTo(start.x, start.y, { tol: 6 });
            while (now() < until) {
                const s = await bot.state(14);
                if (await bot.handleInterrupts()) continue;
                // a failed pickpocket gets you hit: at half health eat, or (no food) step away and rest until healed
                if (s.hp <= Math.ceil(s.maxHp * 0.5)) {
                    const food = s.inv.find(i => FOOD.includes(i.name) && i.ops.includes('Eat'));
                    if (food) { await bot.act({ type: 'item', slot: food.slot, op: 'Eat' }); await bot.wait(2); continue; }
                    bot.log(`thieving: hp ${s.hp}/${s.maxHp} and no food, resting`);
                    await bot.walkTo(PLACES.lumbridge.x + rand(-3, 3), PLACES.lumbridge.y + rand(-3, 3), { tol: 2 });
                    bot.waiting = 'resting';
                    try { while (now() < until && (await bot.state(5)).hp < Math.ceil(bot.s.maxHp * 0.9)) { await bot.handleInterrupts(); await sleep(20_000); } } finally { bot.waiting = null; }
                    continue;
                }
                const farmerLvl = bot.lvl('thieving') >= 10;
                const t = bot.nearestNpc(n => (farmerLvl ? /^Farmer$/ : /^(Man|Woman)$/).test(n.name) && n.ops.includes('Pickpocket'));
                const home = farmerLvl ? PLACES.farmers : PLACES.lumbridge;
                if (!t) { await bot.walkTo(home.x + rand(-6, 6), home.y + rand(-6, 6)); continue; }
                await bot.act({ type: 'npc', npc: t.npc, op: 'Pickpocket' });
                await bot.waitIdle({ timeout: 15, quiet: 2 });
            }
        }
    }
];

export const FLETCH = {
    id: 'fletch',
    skills: ['fletching', 'woodcutting'],
    canRun: bot => (bot.has('Knife') || !!FREE_SPAWNS.Knife) && ['Bronze axe', 'Iron axe', 'Steel axe'].some(a => bot.has(a)) || 'need an axe (and a knife)',
    async run(bot, until) {
        if (!bot.has('Knife') && !(await pickupFree(bot, 'Knife'))) return;
        // oaks once it can (Fletching 20, Woodcutting 15): oak shortbows, oak longbows from 25
        // willows once it can (Fletching 35, Woodcutting 30): willow shortbows, willow longbows from 40
        const fl0 = bot.lvl('fletching'), wc = bot.lvl('woodcutting');
        const tier = fl0 >= 35 && wc >= 30 ? 'willow' : fl0 >= 20 && wc >= 15 ? 'oak' : 'normal';
        const oak = tier === 'oak';
        const LOG = { willow: 'Willow logs', oak: 'Oak logs', normal: 'Logs' }[tier];
        const TREE = { willow: 'Willow', oak: 'Oak', normal: 'Tree' }[tier];
        const AT = { willow: PLACES.lumbridgeWillows, oak: PLACES.lumbridgeOaks, normal: PLACES.lumbridgeTrees }[tier];
        await bot.walkTo(AT.x, AT.y, { tol: 6 });
        while (now() < until) {
            const s = await bot.state(14);
            if (await bot.handleInterrupts()) continue;
            const logs = s.inv.filter(i => i.name === LOG);
            if (s.invFree === 0 || (logs.length >= 10)) {
                // fletching guide: arrow shafts to 10, then shortbows (u) / longbows (u); oak: shortbows, longbows from 25
                const fl = bot.lvl('fletching');
                const want = tier === 'willow' ? (fl >= 40 ? /willow longbow/i : /willow shortbow/i) : oak ? (fl >= 25 ? /oak longbow/i : /oak shortbow/i) : (fl >= 10 ? /longbow/i : fl >= 5 ? /shortbow/i : /shaft/i);
                await bot.act({ type: 'useitem', item: 'Knife', onItem: LOG });
                await bot.wait(2);
                await bot.state(3);
                const menu = bot.s.dialog?.skillMenu;
                if (menu) await bot.act({ type: 'skillmenu', index: Math.max(0, menu.findIndex(n => want.test(n))) });
                await bot.waitIdle({ timeout: 90, quiet: 4 });
                await bot.state();
                // unstrung bows and spare logs are goods: bank them (arrow shafts stack, so they stay in the bag)
                if (bot.s.invFree <= 4) await bot.bankItems(i => /^(Logs|Oak logs|Willow logs|((Oak|Willow) )?[Ss]hortbow \(u\)|((Oak|Willow) )?[Ll]ongbow \(u\))$/.test(i.name));
                continue;
            }
            const tree = bot.nearestScenery(l => l.name === TREE && l.ops.includes('Chop down'));
            if (!tree) { await bot.walkTo(AT.x + rand(-6, 6), AT.y + rand(-6, 6), { tol: 3 }); continue; }
            await gatherOnce(bot, tree, 'Chop down', 'scenery', 45);
        }
    }
};

export async function fightLoop(bot, until, area, names, { pickup = [], stopIf = null } = {}) {
    const feared = fearOf(bot.name); // a phobia (killed by one recently): leave those alone
    if (feared && names.includes(feared)) { names = names.filter(n => n !== feared); bot.log(`not fighting ${feared}s (still shaken)`); if (!names.length) return; }
    await bot.walkTo(area.x, area.y, { tol: 6 });
    while (now() < until) {
        const s = await bot.state(12);
        if (await bot.handleInterrupts()) continue;
        if (stopIf && stopIf(bot)) return;
        if (s.hp <= 3 && !s.inv.some(i => FOOD.includes(i.name))) {
            bot.log('low hp and no food, resting');
            await bot.walkTo(area.x + 10, area.y + 10);
            bot.waiting = 'resting'; try { await bot.wait(60); } finally { bot.waiting = null; }
            continue;
        }
        if (s.attacking || s.inCombat) { await bot.wait(2); continue; }
        const loot = s.ground.find(o => o.dist <= 5 && (['Bones', 'Feather', ...pickup].includes(o.name) || /^Grimy /.test(o.name)) && s.invFree > 1); // herbs: for herblore (31)
        if (loot) { await bot.act({ type: 'ground', x: loot.x, y: loot.y, id: loot.id }); await bot.waitIdle({ timeout: 8 }); continue; }
        const bones = s.inv.find(i => i.name === 'Bones');
        if (bones) { await bot.act({ type: 'item', slot: bones.slot, op: 'Bury' }); await bot.wait(2); continue; }
        if (s.invFree <= 2) { await bot.bankItems(i => /^(Raw chicken|Raw beef|Cowhide|Goblin mail|Chef's hat|Feather)$|^Grimy /.test(i.name) || (/^(Bronze|Iron)/.test(i.name) && !i.ops.some(o => /wield|wear/i.test(o))), { back: area }); continue; }
        const t = bot.nearestNpc(n => names.includes(n.name) && !n.inCombat && n.ops.includes('Attack'));
        if (!t) { await bot.walkTo(area.x + rand(-5, 5), area.y + rand(-5, 5), { tol: 2 }); continue; }
        const xpBefore = combatXp(bot.s);
        await bot.act({ type: 'npc', npc: t.npc, op: 'Attack' });
        await bot.waitIdle({ timeout: 25, quiet: 3, cond: st => combatXp(st) > xpBefore && !st.attacking });
        if (combatXp(bot.s) === xpBefore) {
            // couldn't get to it (fences): open a gate toward it, else try elsewhere
            if (!(await bot.openNearbyGate(t))) await bot.walkTo(area.x + rand(-5, 5), area.y + rand(-5, 5), { tol: 2 });
        }
    }
}

// Buy missing tools for our own plan from Lumbridge shops; bank coins we don't need to carry.
export const RESUPPLY = {
    id: 'resupply',
    skills: [],
    canRun: () => true,
    async run(bot, until, needs = []) {
        // anything we already own in the bank comes out first
        const inBank = needs.filter(n => !bot.has(n) && bot.s.bank?.some(i => i.name === n));
        if (inBank.length && (await bot.openBank())) { for (const n of inBank) await bot.withdraw(n, 1); await bot.leaveBank(); }
        for (const item of needs) {
            if (!bot.has(item) && FREE_SPAWNS[item] && (await pickupFree(bot, item))) continue;
            const shop = shopFor(item);
            if (!shop || bot.has(item)) continue;
            if (bot.s.coins < shop.sells[item]) {
                // fetch coins from the bank if we have them there
                const banked = bot.s.bank.find(i => i.name === 'Coins')?.count ?? 0;
                if (banked + bot.s.coins < shop.sells[item]) continue;
                if (await bot.openBank()) { await bot.withdraw('Coins', 'all'); await bot.leaveBank(); }
            }
            if (await bot.openShop(shop)) { await bot.buy(item, 1); await bot.closeInterfaces(); }
        }
    }
};

// Guild treasurer: keeps the guild equipped and its coins safe.
//  1. buys tools guildmates are missing from Lumbridge shops (the market then hands them out as gifts)
//  2. banks the coin pool above a working float so a death can't lose it
//  3. otherwise earns coins by thieving
export const TREASURY = {
    id: 'treasury',
    skills: ['thieving'],
    canRun: bot => !!bot.market || 'treasury needs the market',
    async run(bot, until) {
        const m = bot.market;
        while (Date.now() < until) {
            await bot.state();
            const guildNeeds = new Set();
            for (const [other] of m.bots) if (other !== bot.name && faction(other) === faction(bot.name)) for (const n of m.needsOf(other)) guildNeeds.add(n);
            const buyable = [...guildNeeds].filter(n => shopFor(n) && !bot.inv(n).length);
            if (buyable.length) {
                bot.log(`treasury: buying for the guild: ${buyable.join(', ')}`);
                for (const n of buyable) {
                    const shop = shopFor(n);
                    if (bot.s.coins < shop.sells[n]) {
                        if (await bot.openBank()) { await bot.withdraw('Coins', 'all'); await bot.leaveBank(); }
                    }
                    if (bot.s.coins >= shop.sells[n] && (await bot.openShop(shop))) { await bot.buy(n, 1); await bot.closeInterfaces(); }
                }
                continue;
            }
            if (bot.s.coins > 250) {
                bot.log(`treasury: banking ${bot.s.coins - 100} coins of the guild pool`);
                if (await bot.openBank()) {
                    const c = bot.s.inv.find(i => i.name === 'Coins');
                    if (c) { await bot.act({ type: 'deposit', slot: c.slot, amount: 'all' }); await bot.wait(1); await bot.withdraw('Coins', 10); await bot.withdraw('Coins', 10); }
                    await bot.leaveBank();
                }
                continue;
            }
            // earn: a few minutes of pickpocketing, then re-check needs
            await taskById('thieving').run(bot, Math.min(until, Date.now() + 4 * 60_000));
        }
    }
};

export function taskById(id) {
    if (id === 'treasury') return TREASURY;
    if (id === 'fletch') return FLETCH;
    if (id === 'resupply') return RESUPPLY;
    return TASKS.find(t => t.id === id);
}

function combatXp(s) {
    return ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'].reduce((t, k) => t + s.stats[k].xp, 0);
}
TASKS.push(FLETCH);

// ---- Leather crafting (Al Kharid): cowhides (banked by cow fighters) -> Ellis tans them (1gp each) ->
// needle and thread (Dommik) -> leather gloves/boots/cowls/vambraces/bodies by Crafting level -> bank at home.
// The toll gate costs 10gp each way.
const TOLL = { west: { x: 3267, y: 3227 }, east: { x: 3269, y: 3227 } };
const ELLIS = { x: 3274, y: 3192 }, DOMMIK = { x: 3321, y: 3194 };
// soft leather items (iface 154 child, Crafting level), best first
const LEATHER_ITEMS = [['Leather body', 28, 14], ['Leather vambraces', 31, 11], ['Leather cowl', 34, 9], ['Leather boots', 30, 7], ['Leather gloves', 29, 1]];
const LEATHER_GOODS = /^(Leather( gloves| boots| cowl| vambraces| body)?|Cowhide)$/;
async function crossToll(bot, toEast) {
    const from = toEast ? TOLL.west : TOLL.east;
    await bot.travel(from.x, from.y, { tol: 1 });
    for (let i = 0; i < 3; i++) {
        const s = await bot.state(4);
        if (toEast ? s.x >= 3268 : s.x <= 3267) return true;
        if (s.coins < 10) { bot.log('leather: no coins for the toll'); return false; }
        const gate = s.scenery.find(o => o.name === 'Gate' && o.x === 3268 && o.ops.some(op => /pay-toll/i.test(op)));
        if (!gate) { await bot.walkTo(from.x, from.y, { tol: 0 }); continue; }
        await bot.act({ type: 'scenery', x: gate.x, y: gate.y, id: gate.id, op: gate.ops.find(op => /pay-toll/i.test(op)) });
        await bot.waitIdle({ timeout: 10, quiet: 2 });
    }
    const s = await bot.state(1);
    return toEast ? s.x >= 3268 : s.x <= 3267;
}
export const LEATHER = {
    id: 'leather',
    skills: ['crafting'],
    canRun: bot => {
        const n = name => bot.count(name) + (bot.s.bank ?? []).filter(i => i.name === name).reduce((t, i) => t + i.count, 0);
        if (n('Cowhide') + n('Leather') < 5) return 'need cowhides (5+)';
        if (n('Coins') < 30) return 'need 30 coins for the toll and tanning';
        return true;
    },
    async run(bot, until) {
        if (!(await bot.openBank())) return;
        await bot.depositAll(i => !KEEP(i.name) && !LEATHER_GOODS.test(i.name) && !/^(Needle|Thread)$/.test(i.name));
        for (const n of ['Coins', 'Needle', 'Thread', 'Leather', 'Cowhide']) if (bot.s.bank?.some(i => i.name === n) && bot.s.invFree > 0) await bot.withdraw(n, 'all');
        await bot.leaveBank();
        await bot.state(2);
        const hides = bot.count('Cowhide');
        if (bot.s.coins < 20 + hides) { bot.log('leather: not enough coins for the trip'); return; }
        bot.log(`leather: taking ${hides} cowhides to Al Kharid`);
        if (!(await crossToll(bot, true))) return;
        try {
            // tan everything at Ellis
            if (hides) {
                await bot.walkTo(ELLIS.x, ELLIS.y, { tol: 3 });
                for (let i = 0; i < 3 && (await bot.state(6)).inv.some(x => x.name === 'Cowhide'); i++) {
                    const e = bot.nearestNpc(n => n.name === 'Ellis');
                    if (!e) { await bot.walkTo(ELLIS.x, ELLIS.y, { tol: 1 }); continue; }
                    await bot.act({ type: 'npc', npc: e.npc, op: 'Trade' });
                    await bot.waitIdle({ timeout: 15, cond: st => st.iface === 324 });
                    if (bot.s.iface !== 324) { bot.log(`leather: Ellis's tanning screen didn't open (ops ${e.ops})`); continue; }
                    await bot.act({ type: 'button', iface: 324, child: 1, op: 4 }).catch(() => {}); // soft leather, all
                    await bot.wait(3);
                    await bot.closeInterfaces();
                }
                await bot.state(1);
                bot.log(`leather: tanned, now ${bot.count('Leather')} leather`);
            }
            // needle and thread
            if (!bot.has('Needle') || !bot.has('Thread')) {
                if (await bot.openShop({ x: DOMMIK.x, y: DOMMIK.y, npcs: ['Dommik'] })) {
                    if (!bot.has('Needle')) await bot.buy('Needle', 1);
                    if (bot.count('Thread') < 5) await bot.buy('Thread', 5);
                    await bot.closeInterfaces();
                }
            }
            // craft: the best piece for our level, all the leather
            const cr = bot.lvl('crafting');
            const [piece, child] = LEATHER_ITEMS.find(([, , lv]) => cr >= lv);
            for (let i = 0; i < 4 && bot.count('Leather') > 0 && bot.has('Needle') && bot.has('Thread') && now() < until + 10 * 60_000; i++) {
                await bot.act({ type: 'useitem', item: 'Needle', onItem: 'Leather' });
                await bot.wait(2);
                await bot.act({ type: 'button', iface: 154, child, op: 2 }).catch(() => {}); // make all
                await bot.waitIdle({ timeout: 90, quiet: 5 });
                await bot.state(1);
            }
            bot.log(`leather: made ${bot.count(piece)} ${piece}`);
        } finally {
            await crossToll(bot, false);
        }
        await bot.bankItems(i => LEATHER_GOODS.test(i.name));
    }
};
TASKS.push(LEATHER);

// ---- Runecrafting (after Rune Mysteries): Aubury teleports us to the essence mine (bank at Varrock East),
// then air runes at the air altar south of Falador with the quest's air talisman. Air runes feed magic training.
const AUBURY = { x: 3253, y: 3401 }, AIR_RUINS = { x: 2985, y: 3294 };
const inEssenceMine = s => s.x > 2880 && s.x < 2960 && s.y > 4780 && s.y < 4860;
const inAirAltar = s => s.x > 2820 && s.x < 2860 && s.y > 4810 && s.y < 4850;
async function mineEssence(bot, until) {
    await bot.travel(AUBURY.x, AUBURY.y, { tol: 3 });
    for (let i = 0; i < 4 && !inEssenceMine(await bot.state(8)); i++) {
        const a = bot.nearestNpc(n => n.name === 'Aubury');
        const op = a?.ops.find(o => /teleport/i.test(o));
        if (!a || !op) { await bot.walkTo(AUBURY.x, AUBURY.y, { tol: 1 }); continue; }
        await bot.act({ type: 'npc', npc: a.npc, op });
        await bot.waitIdle({ timeout: 15, cond: inEssenceMine });
    }
    if (!inEssenceMine(bot.s)) { bot.log('runecraft: Aubury would not teleport us'); return false; }
    while ((await bot.state(14)).invFree > 0 && now() < until) {
        if (await bot.handleInterrupts()) continue;
        const rock = bot.nearestScenery(l => /rune essence/i.test(l.name) && l.ops.includes('Mine'));
        if (!rock) { bot.log('runecraft: no essence rock in view'); break; }
        const before = bot.s.invFree;
        await bot.act({ type: 'scenery', x: rock.x, y: rock.y, id: rock.id, op: 'Mine' });
        await bot.waitIdle({ timeout: 90, quiet: 6, cond: st => st.invFree === 0 });
        if (bot.s.invFree === before) await bot.wait(3);
    }
    // out through the nearest portal
    for (let i = 0; i < 4 && inEssenceMine(await bot.state(14)); i++) {
        const p = bot.nearestScenery(l => /portal/i.test(l.name) && l.ops.length) ?? bot.nearestNpc(n => /portal/i.test(n.name));
        if (!p) { bot.log('runecraft: no portal in view'); break; }
        if (p.npc !== undefined) await bot.act({ type: 'npc', npc: p.npc, op: p.ops[0] });
        else await bot.act({ type: 'scenery', x: p.x, y: p.y, id: p.id, op: p.ops[0] });
        await bot.waitIdle({ timeout: 20, cond: st => !inEssenceMine(st) });
    }
    return !inEssenceMine(bot.s);
}
async function craftAir(bot) {
    await bot.travel(AIR_RUINS.x, AIR_RUINS.y, { tol: 3 });
    for (let i = 0; i < 3 && !inAirAltar(await bot.state(8)); i++) {
        const ruins = bot.nearestScenery(l => /mysterious ruins/i.test(l.name));
        if (!ruins) { await bot.walkTo(AIR_RUINS.x, AIR_RUINS.y, { tol: 1 }); continue; }
        await bot.act({ type: 'useitem', item: 'Air talisman', x: ruins.x, y: ruins.y, id: ruins.id });
        await bot.waitIdle({ timeout: 15, cond: inAirAltar });
    }
    if (!inAirAltar(bot.s)) { bot.log('runecraft: could not enter the air altar'); return 0; }
    const before = bot.count('Air rune');
    const altar = bot.nearestScenery(l => l.name === 'Altar' && l.ops.some(o => /craft/i.test(o)));
    if (altar) { await bot.act({ type: 'scenery', x: altar.x, y: altar.y, id: altar.id, op: altar.ops.find(o => /craft/i.test(o)) }); await bot.waitIdle({ timeout: 20, quiet: 3 }); }
    const made = (await bot.state(14), bot.count('Air rune')) - before;
    for (let i = 0; i < 3 && inAirAltar(bot.s); i++) {
        const p = bot.nearestScenery(l => /portal/i.test(l.name) && l.ops.length);
        if (!p) break;
        await bot.act({ type: 'scenery', x: p.x, y: p.y, id: p.id, op: p.ops[0] });
        await bot.waitIdle({ timeout: 15, cond: st => !inAirAltar(st) });
        await bot.state(8);
    }
    bot.log(`runecraft: crafted ${made} air runes`);
    return made;
}
export const RUNECRAFT = {
    id: 'runecraft',
    skills: ['runecrafting'],
    canRun: bot => {
        if ((bot.s.quests?.['Rune Mysteries'] ?? 0) < 100) return 'needs Rune Mysteries';
        if (!bot.has('Air talisman') && !bot.s.bank?.some(i => i.name === 'Air talisman')) return 'needs an air talisman';
        if (!['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe'].some(p => bot.has(p) || bot.s.bank?.some(i => i.name === p))) return 'needs a pickaxe';
        return true;
    },
    async run(bot, until) {
        if (!(await bot.openBank())) return;
        await bot.depositAll(i => !KEEP(i.name) && i.name !== 'Air talisman' && !/essence/i.test(i.name));
        for (const n of ['Air talisman', 'Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe']) if (!bot.has(n) && bot.s.bank?.some(i => i.name === n)) { await bot.withdraw(n, 1); if (/pickaxe/.test(n)) break; }
        await bot.leaveBank();
        while (now() < until) {
            if (bot.s.invFree > 0 && !(await mineEssence(bot, until))) return;
            if (!bot.s.inv.some(i => /essence/i.test(i.name))) return;
            await craftAir(bot);
            if (bot.s.inv.some(i => /essence/i.test(i.name))) return; // couldn't craft: stop rather than loop
            await bot.bankItems(i => i.name === 'Air rune');
        }
    }
};
TASKS.push(RUNECRAFT);

// ---- Herblore (roadmap 31), after Druidic Ritual: grimy herbs (fighters pick them up from drops and bank them) ->
// clean them -> vials from Jatix in Taverley (5gp) filled at the village fountain -> unfinished potions; guams with
// an eye of newt (3gp, also Jatix) become attack potions. Potions are banked as goods.
const JATIX = { x: 2897, y: 3429, npcs: ['Jatix'] }, TAV_FOUNTAIN = { x: 2892, y: 3437 };
// level to clean (by the grimy herb's name) and to make the unfinished potion (by the clean herb's name)
const HERB_LEVEL = { 'Grimy guam': 3, 'Grimy marrentill': 5, 'Grimy tarromin': 11, 'Grimy harralander': 20, 'Grimy ranarr': 25 };
const UNF_LEVEL = { 'Clean guam': 3, 'Clean marrentill': 5, 'Clean tarromin': 12, 'Clean harralander': 22, 'Clean ranarr': 30 };
export const HERBLORE = {
    id: 'herblore',
    skills: ['herblore'],
    canRun: bot => {
        if ((bot.s.quests?.['Druidic Ritual'] ?? 0) < 100) return 'needs Druidic Ritual';
        const herbs = [...bot.s.inv, ...(bot.s.bank ?? [])].filter(i => bot.lvl('herblore') >= (HERB_LEVEL[i.name] ?? UNF_LEVEL[i.name] ?? 99)).reduce((t, i) => t + i.count, 0);
        if (herbs < 3) return 'needs 3+ herbs it can use';
        return bot.s.coins + ((bot.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0) >= 30 || 'needs 30 coins for vials';
    },
    async run(bot, until) {
        if (!(await bot.openBank())) return;
        await bot.depositAll(i => !KEEP(i.name));
        for (const it of (bot.s.bank ?? []).filter(i => /^(Grimy|Clean) /.test(i.name))) if (bot.s.invFree > 13) await bot.withdrawN(it.name, Math.min(it.count, 9));
        if (bot.s.coins < 60) await bot.withdrawN('Coins', 60 - bot.s.coins);
        await bot.leaveBank();
        // clean what we can
        for (let i = 0; i < 20; i++) {
            const g = (await bot.state(2)).inv.find(x => /^Grimy /.test(x.name) && x.ops.includes('Clean'));
            if (!g) break;
            await bot.act({ type: 'item', slot: g.slot, op: 'Clean' });
            await bot.wait(2);
            if ((await bot.state(1)).inv.some(x => x.slot === g.slot && x.name === g.name)) break; // too low a level for it
        }
        const herbs = bot.s.inv.filter(x => UNF_LEVEL[x.name] && bot.lvl('herblore') >= UNF_LEVEL[x.name]);
        if (!herbs.length) { bot.log('herblore: no herbs I can use yet'); await bot.bankItems(i => /^(Grimy|Clean) /.test(i.name)); return; }
        const guams = herbs.filter(h => h.name === 'Clean guam').length;
        if (await bot.openShop(JATIX)) {
            await bot.buy('Vial', herbs.length);
            if (guams) await bot.buy('Eye of newt', guams);
            await bot.closeInterfaces();
        }
        // fill the vials at the fountain
        await bot.walkTo(TAV_FOUNTAIN.x, TAV_FOUNTAIN.y, { tol: 2 });
        for (let i = 0; i < 4 && bot.count('Vial'); i++) {
            const f = (await bot.state(8), bot.nearestScenery(l => /fountain/i.test(l.name)));
            if (!f) break;
            await bot.act({ type: 'useitem', item: 'Vial', x: f.x, y: f.y, id: f.id });
            await bot.waitIdle({ timeout: 20, quiet: 3 });
        }
        // herb + vial of water -> unfinished potion; guam (unf) + eye of newt -> attack potion
        for (let i = 0; i < 30 && now() < until + 10 * 60_000; i++) {
            const s = await bot.state(2);
            const herb = s.inv.find(x => UNF_LEVEL[x.name] && bot.lvl('herblore') >= UNF_LEVEL[x.name]);
            const unfGuam = s.inv.find(x => /^Guam potion ?\(unf\)$/.test(x.name));
            if (herb && bot.has('Vial of water')) { await bot.act({ type: 'useitem', item: herb.name, onItem: 'Vial of water' }); }
            else if (unfGuam && bot.has('Eye of newt')) { await bot.act({ type: 'useitem', item: 'Eye of newt', onItem: unfGuam.name }); }
            else break;
            await bot.wait(3);
            const menu = (await bot.state(2)).dialog?.skillMenu;
            if (menu) await bot.act({ type: 'skillmenu', index: 0 });
            await bot.waitIdle({ timeout: 30, quiet: 3 });
        }
        const made = bot.s.inv.filter(x => /potion/i.test(x.name)).map(x => x.name);
        bot.log(`herblore: made ${made.length} (${[...new Set(made)].join(', ')})`);
        await bot.bankItems(i => /potion|^(Grimy|Clean) |^Vial|^Eye of newt$/.test(i.name));
    }
};
TASKS.push(HERBLORE);

// ---- Merchants (roadmap 35): buy low, sell high at the Grand Exchange, guided by the notice board's going prices.
// Collect last time's offers, bid ~80% of the going price on popular goods, list own stock at ~120%, spending at
// most a third of its coins. A merchant career (merchant personalities lean to it).
export const MERCHANT = {
    id: 'merchant',
    skills: [],
    canRun: bot => (bot.s.coins + ((bot.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0) >= 150) || 'needs 150 coins to trade with',
    async run(bot, until) {
        const board = readBoard()?.prices ?? {};
        const goods = Object.entries(board).filter(([item, p]) => p.sales >= 3 && TRADE_OK(item)).sort((a, b) => b[1].sales - a[1].sales);
        if (!goods.length) { bot.log('merchant: no going prices on the board yet'); return; }
        const banked = name => (bot.s.bank ?? []).filter(i => i.name === name).reduce((t, i) => t + i.count, 0);
        // stock to sell: banked goods with a going price, taken as notes
        const stock = goods.filter(([item]) => banked(item) > 0).slice(0, 2);
        const budget = Math.floor((bot.s.coins + banked('Coins')) / 3);
        if (await bot.openBank()) {
            await bot.depositAll(i => !KEEP(i.name));
            if (bot.s.coins < budget) await bot.withdrawN('Coins', budget - bot.s.coins);
            for (const [item] of stock) await bot.withdrawNoted(item, Math.min(banked(item), 20));
            await bot.leaveBank();
        }
        await bot.travel(GE.x, GE.y + 5, { tol: 3 });
        // last time's offers: collect what filled, cancel what didn't
        for (const o of (await bot.state(1)).ge ?? []) if (o.done < o.amount) await bot.geAbort(o.slot);
        if ((await bot.state(1)).ge?.length) await bot.geCollect();
        let spent = 0, listed = 0, bids = 0;
        for (const [item, p] of stock) {
            const n = bot.count(item);
            if (n && (await bot.geOffer({ item, sell: true, amount: n, price: Math.max(1, Math.round(p.price * 1.2)) })) >= 0) listed++;
        }
        for (const [item, p] of goods.filter(([item]) => !stock.some(([s]) => s === item)).slice(0, 2)) {
            const price = Math.max(1, Math.floor(p.price * 0.8)), qty = Math.min(10, Math.floor((budget - spent) / price));
            if (qty < 1) break;
            if ((await bot.geOffer({ item, sell: false, amount: qty, price })) >= 0) { bids++; spent += qty * price; }
        }
        await bot.closeInterfaces();
        bot.log(`merchant: ${listed} lots listed at +20%, ${bids} bids at -20% (${spent}gp committed); back next time to collect`);
        note(bot.name, `Traded at the Grand Exchange: ${listed} lots up for sale, ${bids} bids in.`);
    }
};
const TRADE_OK = item => !/^(Coins|Bones)$/.test(item);
TASKS.push(MERCHANT);

// ---- Karamja trips (roadmap 34): Fishing 40+, a lobster pot (Gerrant's, 20gp) and 60 coins for the two fares.
// Port Sarim (a seaman, 30gp) -> Musa Point -> the lobster spots (Cage) until the bag is full -> the customs officer
// (30gp, a search for rum) -> Port Sarim -> bank the raw lobsters (cooked later by fish_cook's cookAll, or traded).
const SARIM_DOCK = { x: 3028, y: 3219 }, MUSA_DOCK = { x: 2954, y: 3148 }, LOBSTERS = { x: 2924, y: 3179 };
async function offBoat(bot) {
    const plank = (await bot.state(8), bot.nearestScenery(l => /gangplank/i.test(l.name) && l.ops.some(o => /cross/i.test(o))));
    if (plank && bot.s.z === 1) { await bot.act({ type: 'scenery', x: plank.x, y: plank.y, id: plank.id, op: plank.ops.find(o => /cross/i.test(o)) }); await bot.waitIdle({ timeout: 10, cond: st => st.z === 0 }); }
}
const BOAT_ANSWERS = /^yes, please\.?$|can i journey on this ship|search away|^ok\.?$/i;
const onKaramja = s => s.x < 2990 && s.y < 3200 && s.x > 2750;
async function sail(bot, toKaramja) {
    const at = toKaramja ? SARIM_DOCK : MUSA_DOCK, who = toKaramja ? /^Seaman (Lorris|Thresnor)$|^Captain Tobias$/ : /^Customs officer$/;
    await bot.travel(at.x, at.y, { tol: 3 });
    const arrived = st => onKaramja(st) === toKaramja && st.z === 0; // and off the ship's deck (z 1)
    for (let i = 0; i < 4 && !arrived(await bot.state(8)); i++) {
        if (onKaramja(bot.s) === toKaramja) { await offBoat(bot); continue; } // docked: just the gangplank left
        const npc = bot.nearestNpc(n => who.test(n.name) && n.ops.some(o => /talk/i.test(o)));
        if (!npc) { await bot.walkTo(at.x, at.y, { tol: 1 }); continue; }
        await bot.talkTo(npc.name, { answer: BOAT_ANSWERS, maxSteps: 40 });
        await bot.waitIdle({ timeout: 30, quiet: 4, cond: s => onKaramja(s) === toKaramja });
        // the crossing is a short cutscene: wait it out, then step off the gangplank
        for (let k = 0; k < 10 && (await bot.state(6)).locked; k++) await bot.wait(3);
        await offBoat(bot);
    }
    return arrived(bot.s);
}
export const LOBSTER = {
    id: 'lobsters',
    skills: ['fishing', 'cooking'],
    canRun: bot => {
        if (bot.lvl('fishing') < 40) return 'needs Fishing 40';
        const coins = bot.s.coins + ((bot.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0);
        if (!bot.has('Lobster pot') && !bot.s.bank?.some(i => i.name === 'Lobster pot') && coins < 80) return 'needs a lobster pot (20gp) and 60gp for fares';
        return coins >= 60 || 'needs 60gp for the boat fares';
    },
    async run(bot, until) {
        if (await bot.openBank()) {
            await bot.depositAll(i => !KEEP(i.name) && i.name !== 'Lobster pot');
            if (!bot.has('Lobster pot') && bot.s.bank?.some(i => i.name === 'Lobster pot')) await bot.withdraw('Lobster pot', 1);
            if (bot.s.coins < 80) await bot.withdrawN('Coins', 80 - bot.s.coins);
            await bot.leaveBank();
        }
        if (!bot.has('Lobster pot')) {
            if (await bot.openShop(SHOPS.gerrant)) { await bot.buy('Lobster pot', 1); await bot.closeInterfaces(); }
            if (!bot.has('Lobster pot')) { bot.log('lobsters: no lobster pot'); return; }
        }
        if (!(await sail(bot, true))) { bot.log('lobsters: could not get a boat to Karamja'); return; }
        bot.log('lobsters: on Karamja');
        await bot.walkTo(LOBSTERS.x, LOBSTERS.y, { tol: 4 });
        while (now() < until && (await bot.state(12)).invFree > 0) {
            if (await bot.handleInterrupts()) continue;
            const fs = bot.nearestNpc(n => n.name === 'Fishing spot' && n.ops.includes('Cage'));
            if (!fs) { await bot.walkTo(LOBSTERS.x + rand(-3, 3), LOBSTERS.y + rand(-3, 3), { tol: 2 }); continue; }
            await gatherOnce(bot, fs, 'Cage', 'npc', 60);
        }
        bot.log(`lobsters: caught ${bot.count('Raw lobster')}`);
        if (!(await sail(bot, false))) { bot.log('lobsters: stuck on Karamja (no fare?)'); return; }
        await bot.bankItems(i => /^Raw (lobster|tuna|swordfish)$/.test(i.name));
    }
};
TASKS.push(LOBSTER);

// ---- Wilderness mining (roadmap 33): risk for reward. Bold bots only (caution under 0.5).
//  - the shallow mine north of Edgeville (3103,3567, wilderness level 2): coal and iron, no crowd (Mining 40, combat 20)
//  - the deep mine (3020,3800, wilderness level ~30): mithril from Mining 55, adamantite from 70 (combat 40)
// Dying in the wilderness loses the bag, so it banks after every load. Wilderness PvP is on: other players can attack.
const WILD_SHALLOW = { x: 3103, y: 3568, rocks: [14850, 14851, 14852, 14856, 14857, 14858] };
const WILD_DEEP = { x: 3020, y: 3800, rocks: [14853, 14854, 14855, 14862, 14863, 14864, 14850, 14851, 14852] };
export const WILD_MINE = {
    id: 'wild_mine',
    skills: ['mining'],
    canRun: bot => {
        if (!['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe', 'Mithril pickaxe'].some(p => bot.has(p))) return 'need a pickaxe';
        if (bot.lvl('mining') < 40 || (bot.s.combat ?? 3) < 20) return 'needs Mining 40 and combat 20';
        return (bot.market?.social?.p?.(bot.name)?.caution ?? personalityCaution(bot.name)) < 0.5 || 'too cautious for the wilderness';
    },
    async run(bot, until) {
        const deep = bot.lvl('mining') >= 55 && (bot.s.combat ?? 3) >= 40;
        const M = deep ? WILD_DEEP : WILD_SHALLOW;
        const lvl = bot.lvl('mining');
        const ok = id => (id >= 14862 && id <= 14864 ? lvl >= 70 : id >= 14853 && id <= 14855 ? lvl >= 55 : true);
        bot.log(`wild mine: heading for the ${deep ? 'deep' : 'shallow'} wilderness mine`);
        bot.standGround = true; // in the wilderness: fight what attacks, running blind is worse
        try {
            while (now() < until) {
                if (!(await crossDitch(bot, true))) { bot.log('wild mine: could not cross the wilderness ditch'); return; }
                if (!(await bot.travel(M.x, M.y, { tol: 4, timeout: 600 }))) return;
                while (now() < until && (await bot.state(12)).invFree > 1) {
                    if (await bot.handleInterrupts()) continue;
                    // a rival (or a feuding team's bot) in the wilderness, close in strength: settle it here (19)
                    const foe = wildFoe(bot);
                    if (foe && !bot.s.attacking) {
                        bot.log(`wild mine: ${foe.name} is here. This is the wilderness.`);
                        await bot.act({ type: 'say', text: `${foe.name}! No arena rules out here.` }).catch(() => {});
                        await bot.act({ type: 'player', name: foe.name, op: 'Attack' }).catch(e => bot.log(`wild mine: ${e.message}`));
                        await bot.waitIdle({ timeout: 60, quiet: 4, cond: st => !st.attacking && !st.inCombat });
                        continue;
                    }
                    const rock = bot.nearestScenery(l => l.ops.includes('Mine') && M.rocks.includes(l.id) && ok(l.id));
                    if (!rock) { await bot.wait(4); continue; }
                    await gatherOnce(bot, rock, 'Mine', 'scenery', 30);
                }
                // never carry a load around the wilderness: back over the ditch and bank it at Edgeville
                await bot.travel(3101, 3525, { tol: 3, timeout: 600 });
                await crossDitch(bot, false);
                if (!(await bot.bankItems(i => /ore$|^Coal$|^Uncut/.test(i.name)))) return;
            }
        } finally { bot.standGround = false; }
    }
};
function wildFoe(bot) {
    const social = bot.market?.social;
    if (!social) return null;
    for (const p of bot.s.players ?? []) {
        const o = bot.market.bots?.get(p.name.toLowerCase())?.bot ?? bot.market.bots?.get(p.name)?.bot;
        if (!o?.s || Math.abs((o.s.combat ?? 3) - (bot.s.combat ?? 3)) > 8) continue;
        const name = o.name;
        const feud = social.diplomacy?.(bot.name, name, 'allied', 'feud') === 'feud'; // their teams are feuding
        if (social.isRival(bot.name, name) || feud) return { name };
    }
    return null;
}
// the wilderness ditch north of Edgeville: "Cross", then confirm the warning (interface 382, button 18)
async function crossDitch(bot, north) {
    const side = north ? { x: 3101, y: 3519 } : { x: 3101, y: 3524 };
    if (north ? bot.s.y > 3521 : bot.s.y < 3521) return true;
    await bot.travel(side.x, side.y, { tol: 2 });
    for (let i = 0; i < 4 && (north ? (await bot.state(6)).y < 3522 : (await bot.state(6)).y > 3520); i++) {
        if (bot.s.iface === 382) { await bot.act({ type: 'button', iface: 382, child: 18 }); await bot.waitIdle({ timeout: 8, quiet: 2 }); continue; }
        const d = bot.nearestScenery(l => /wilderness ditch/i.test(l.name) && l.ops.includes('Cross'));
        if (!d) { await bot.walkTo(side.x, side.y, { tol: 1 }); continue; }
        await bot.act({ type: 'scenery', x: d.x, y: d.y, id: d.id, op: 'Cross' });
        await bot.waitIdle({ timeout: 8, quiet: 2 });
    }
    return north ? bot.s.y > 3521 : bot.s.y < 3521;
}
const personalityCaution = name => { try { return JSON.parse(fs.readFileSync(new URL(`./orders/${name}.json`, import.meta.url), 'utf8')).personality?.caution ?? 1; } catch { return 1; } };
TASKS.push(WILD_MINE);
