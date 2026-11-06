// Skill-training tasks shared by scripted bots and Claude-directed bots (2009Scape).
// Each task: { id, skills, canRun(bot) -> true | reason, run(bot, untilMs) }
import { dist, rand, sleep, FOOD, gearInfo } from './lib.mjs';
import { faction } from './market.mjs';

export const PLACES = {
    lumbridge: { x: 3222, y: 3219 },
    lumbridgeTrees: { x: 3196, y: 3232 },
    lumbridgeOaks: { x: 3205, y: 3243 },
    lumbridgeKitchen: { x: 3209, y: 3214 },
    chickens: { x: 3187, y: 3279 },
    cows: { x: 3257, y: 3263 },
    goblins: { x: 3246, y: 3241 },
    draynorFish: { x: 3087, y: 3229 },
    draynorWillows: { x: 3087, y: 3236 },
    draynorTrees: { x: 3087, y: 3244 },
    swampFish: { x: 3243, y: 3151 },
    swampMine: { x: 3229, y: 3148 },
    furnace: { x: 3226, y: 3254 },
    varrockAnvils: { x: 3187, y: 3423, anvil: { x: 3188, y: 3424 } },
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
const KEEP = name => /pickaxe$|(^| )axe$|^Hammer$|^Tinderbox$|^Small fishing net$|^Knife$|^Chisel$|^Shears$|^Coins$/.test(name) || FOOD.includes(name);

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
    const spare = (bot.s.bank ?? []).filter(i => !KEEP(i.name) && !NEVER_SELL.test(i.name) && !FOOD.includes(i.name) && !gearInfo(i.name));
    const free = Math.ceil((bot.s.bank?.length ?? 0) - BANK_SLOTS * ROOMY_AT); // slots to free
    return spare.sort((a, b) => a.count - b.count || a.count * (a.value ?? 1) - b.count * (b.value ?? 1)).slice(0, free).map(i => ({ name: i.name, count: i.count }));
}
export async function clearOut(bot) {
    await bot.state(5);
    let todo = surplusInBank(bot).filter(t => t.count <= 26); // a whole stack has to fit in the bag (stackables count as 1)
    if (!todo.length) return 0;
    let sold = 0;
    for (let round = 0; round < 6 && todo.length; round++) {
        if (!(await bot.openBank())) break;
        await bot.depositAll(i => !KEEP(i.name));
        const taken = [];
        for (const it of todo) {
            if (it.count > bot.s.invFree - 1) continue; // not enough room for this stack this trip
            await bot.withdraw(it.name, 'all');
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
    await bot.gearUp({ weapon: !['ranged', 'magic'].includes(taskId) }).catch(() => {});
    if (['melee', 'ranged', 'magic', 'thieving'].includes(taskId)) await bot.ensureFood(4).catch(() => {});
}

export const SHOPS = {
    bob: { x: 3229, y: 3203, npcs: ['Bob'], sells: { 'Bronze axe': 16, 'Bronze pickaxe': 1, 'Iron axe': 56, 'Steel axe': 200 } },
    general: { x: 3216, y: 3241, npcs: ['Shopkeeper', 'Shop assistant'], sells: { Tinderbox: 1, Hammer: 1, Chisel: 1, Bucket: 2, 'Empty pot': 1 } }
    // Small fishing net / runes are only sold in Port Sarim / Varrock: bots trade for those
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
    if (wc >= 30 && bot.s.combat >= 20) return { place: PLACES.draynorWillows, names: ['Willow'] };
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
    for (let attempts = 0; attempts < 6; attempts++) {
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
    const s = await bot.state(3);
    if (s.dialog?.skillMenu) { await bot.act({ type: 'skillmenu', index: 0 }); return true; }
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
        canRun: bot => bot.has('Small fishing net') || 'need a small fishing net',
        async run(bot, until) {
            // Draynor has aggressive dark wizards: only go there once combat can handle them
            const spot = bot.s.combat >= 20 && Math.random() < 0.5 ? PLACES.draynorFish : PLACES.swampFish;
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
                const fs = bot.nearestNpc(n => n.name === 'Fishing spot' && n.ops.includes('Net'));
                if (!fs) { await bot.walkTo(spot.x + rand(-4, 4), spot.y + rand(-4, 4), { tol: 2 }); continue; }
                await gatherOnce(bot, fs, 'Net', 'npc', 60);
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
            // ore already in the bank comes first
            await bot.state(5);
            const bankOre = x => bot.s.bank?.find(i => i.name === x)?.count ?? 0;
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
        canRun: bot => !bot.has('Hammer') ? 'need a hammer' : (bot.has('Bronze bar') || bot.s.bank?.some(i => i.name === 'Bronze bar') ? true : 'need bronze bars'),
        async run(bot, until) {
            const n = name => bot.s.inv.filter(i => i.name === name).reduce((t, i) => t + i.count, 0);
            while (now() < until) {
                await bot.state(10);
                if (!n('Bronze bar')) {
                    if (!(await bot.openBank())) return;
                    await bot.depositAll(i => !KEEP(i.name));
                    if (!bot.s.bank?.some(i => i.name === 'Bronze bar')) { await bot.leaveBank(); return; }
                    await bot.withdraw('Bronze bar', 26);
                    await bot.leaveBank();
                    if (!n('Bronze bar')) return;
                }
                const A = PLACES.varrockAnvils;
                if (!(await bot.travel(A.x, A.y, { tol: 2 }))) return;
                // what to make: the best armour piece its level and bars allow that it doesn't own yet (it wears its own,
                // the rest go to the bank as goods for fighters), else daggers for the practice
                const owned = name => bot.has(name) || bot.s.bank?.some(i => i.name === name);
                const lvl = bot.lvl('smithing');
                const pick = () => BRONZE_PIECES.find(p => lvl >= p.lvl && n('Bronze bar') >= p.bars && (!owned(p.name) || p.name === 'Bronze dagger')) ?? BRONZE_PIECES.at(-1);
                for (let i = 0; i < 60 && n('Bronze bar') && now() < until + 5 * 60_000; i++) {
                    const st = await bot.state(6);
                    if (await bot.handleInterrupts()) continue;
                    if (st.iface === 300) { const p = pick(); await bot.act({ type: 'button', iface: 300, child: p.button }); await bot.wait(4 + 2 * p.bars); await bot.gearUp(); continue; } // make 1
                    const bar = st.inv.find(x => x.name === 'Bronze bar');
                    if (!bar) break; // all smithed
                    await bot.act({ type: 'useitem', slot: bar.slot, x: A.anvil.x, y: A.anvil.y }).catch(e => bot.log(`smith: ${e.message}`));
                    await bot.waitIdle({ timeout: 10, cond: x => x.iface === 300 });
                }
                await bot.closeInterfaces();
                bot.log(`smithed: ${bot.s.inv.filter(i => /^Bronze (?!bar)/.test(i.name)).map(i => i.name).join(', ')}; heading home to bank them`);
                if (await bot.openBank()) { await bot.depositAll(i => !KEEP(i.name)); await bot.leaveBank(); }
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
        await bot.walkTo(PLACES.lumbridgeTrees.x, PLACES.lumbridgeTrees.y, { tol: 6 });
        while (now() < until) {
            const s = await bot.state(14);
            if (await bot.handleInterrupts()) continue;
            const logs = s.inv.filter(i => i.name === 'Logs');
            if (s.invFree === 0 || (logs.length >= 10)) {
                // fletching guide: arrow shafts to 10, then shortbows (u) / longbows (u)
                const fl = bot.lvl('fletching');
                const option = fl >= 10 ? 2 : fl >= 5 ? 1 : 0; // menu order for normal logs: shafts, shortbow, longbow
                await bot.act({ type: 'useitem', item: 'Knife', onItem: 'Logs' });
                await bot.wait(2);
                await bot.state(3);
                if (bot.s.dialog?.skillMenu) await bot.act({ type: 'skillmenu', index: Math.min(option, bot.s.dialog.skillMenu.length - 1) });
                await bot.waitIdle({ timeout: 90, quiet: 4 });
                await bot.state();
                // unstrung bows and spare logs are goods: bank them (arrow shafts stack, so they stay in the bag)
                if (bot.s.invFree <= 4) await bot.bankItems(i => /^(Logs|Oak logs|Shortbow \(u\)|Longbow \(u\))$/.test(i.name));
                continue;
            }
            const tree = bot.nearestScenery(l => l.name === 'Tree' && l.ops.includes('Chop down'));
            if (!tree) { await bot.walkTo(PLACES.lumbridgeTrees.x + rand(-6, 6), PLACES.lumbridgeTrees.y + rand(-6, 6), { tol: 3 }); continue; }
            await gatherOnce(bot, tree, 'Chop down', 'scenery', 45);
        }
    }
};

async function fightLoop(bot, until, area, names, { pickup = [], stopIf = null } = {}) {
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
        const loot = s.ground.find(o => o.dist <= 5 && ['Bones', 'Feather', ...pickup].includes(o.name) && s.invFree > 1);
        if (loot) { await bot.act({ type: 'ground', x: loot.x, y: loot.y, id: loot.id }); await bot.waitIdle({ timeout: 8 }); continue; }
        const bones = s.inv.find(i => i.name === 'Bones');
        if (bones) { await bot.act({ type: 'item', slot: bones.slot, op: 'Bury' }); await bot.wait(2); continue; }
        if (s.invFree <= 2) { await bot.bankItems(i => /^(Raw chicken|Raw beef|Cowhide|Goblin mail|Chef's hat|Feather)$/.test(i.name) || (/^(Bronze|Iron)/.test(i.name) && !i.ops.some(o => /wield|wear/i.test(o))), { back: area }); continue; }
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
