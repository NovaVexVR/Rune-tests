// Skill-training tasks shared by scripted bots and Claude-directed bots.
// Each task: { id, skills, canRun(bot) -> bool|string, run(bot, untilMs) }
import { dist, rand, pick, FOOD } from './lib.mjs';

export const PLACES = {
    lumbridge: { x: 3222, z: 3219 },
    lumbridgeTrees: { x: 3222, z: 3236 },
    lumbridgeOaks: { x: 3205, z: 3243 },
    lumbridgeKitchen: { x: 3209, z: 3215 },
    lumbridgeFurnace: { x: 3227, z: 3254 },
    chickens: { x: 3230, z: 3297 },
    cows: { x: 3256, z: 3266 },
    goblins: { x: 3245, z: 3242 },
    draynorFish: { x: 3087, z: 3229 },
    draynorWillows: { x: 3087, z: 3235 },
    eastMine: { x: 3298, z: 3315 }
};

const now = () => Date.now();
const LOGS = ['Logs', 'Oak logs', 'Willow logs'];
const FM_REQ = { Logs: 1, 'Oak logs': 15, 'Willow logs': 30 };

function treeFor(bot) {
    const wc = bot.lvl('woodcutting');
    if (wc >= 30) return { place: PLACES.draynorWillows, names: ['Willow'] };
    if (wc >= 15) return { place: PLACES.lumbridgeOaks, names: ['Oak'] };
    return { place: PLACES.lumbridgeTrees, names: ['Tree'] };
}

// Interact with a loc/npc and wait until the action finishes or inventory changes.
async function gatherOnce(bot, target, op, kind = 'loc', maxSecs = 40) {
    const before = bot.s.invFree;
    const mark = bot.msgs.length;
    if (kind === 'loc') await bot.act({ type: 'oploc', x: target.x, z: target.z, id: target.id, op });
    else await bot.act({ type: 'opnpc', npc: target.npc, op });
    await bot.waitIdle({ timeout: maxSecs, quiet: 3, cond: s => s.invFree < before - 2 });
    return bot.newMessages(mark);
}

async function lightFires(bot) {
    let fails = 0;
    while (fails < 4) {
        const s = await bot.state(6);
        const log = s.inv.find(i => LOGS.includes(i.name) && bot.lvl('firemaking') >= FM_REQ[i.name]);
        if (!log || !bot.has('Tinderbox')) break;
        const mark = bot.msgs.length;
        await bot.act({ type: 'useheld', item: 'Tinderbox', onSlot: log.slot });
        await bot.waitIdle({ timeout: 20, quiet: 2 });
        const m = bot.newMessages(mark).join(' ');
        if (/can't light a fire here|already a fire/i.test(m)) {
            fails++;
            await bot.act({ type: 'walk', x: s.x + rand(-4, 4), z: s.z + rand(-4, 4) });
            await bot.waitIdle({ timeout: 10 });
        }
    }
    await bot.state();
    // drop logs we can't burn
    await bot.dropAll(i => LOGS.includes(i.name));
}

export const TASKS = [
    {
        id: 'woodcut_fire',
        skills: ['woodcutting', 'firemaking'],
        canRun: bot => bot.has('Bronze axe') || bot.has('Iron axe') || bot.has('Steel axe') || 'need an axe',
        async run(bot, until) {
            let t = treeFor(bot);
            await bot.walkTo(t.place.x, t.place.z, { tol: 6 });
            while (now() < until) {
                const s = await bot.state(16);
                if (await bot.handleInterrupts()) continue;
                if (s.invFree === 0) {
                    await lightFires(bot);
                    t = treeFor(bot);
                    if (dist(s, t.place) > 18) await bot.walkTo(t.place.x, t.place.z, { tol: 6 });
                    continue;
                }
                const tree = bot.nearestLoc(l => t.names.includes(l.name) && l.ops.includes('Chop down'));
                if (!tree) {
                    await bot.walkTo(t.place.x + rand(-6, 6), t.place.z + rand(-6, 6), { tol: 3 });
                    continue;
                }
                await gatherOnce(bot, tree, 'Chop down', 'loc', 45);
            }
            await lightFires(bot);
        }
    },
    {
        id: 'fish_cook',
        skills: ['fishing', 'cooking'],
        canRun: bot => bot.has('Small fishing net') || 'need a small fishing net',
        async run(bot, until) {
            await bot.walkTo(PLACES.draynorFish.x, PLACES.draynorFish.z, { tol: 5 });
            while (now() < until) {
                const s = await bot.state(16);
                if (await bot.handleInterrupts()) continue;
                if (s.invFree === 0) {
                    await cookAll(bot);
                    // keep some food, drop the rest
                    const food = bot.inv(i => FOOD.includes(i.name));
                    for (const f of food.slice(6)) {
                        await bot.act({ type: 'opheld', slot: f.slot, op: 'Drop' });
                        await bot.wait(1);
                    }
                    await bot.state();
                    await bot.dropAll(i => /^(Burnt|Raw)/.test(i.name));
                    await bot.walkTo(PLACES.draynorFish.x, PLACES.draynorFish.z, { tol: 5 });
                    continue;
                }
                const spot = bot.nearestNpc(n => n.name === 'Fishing spot' && n.ops?.includes('Net'));
                if (!spot) {
                    await bot.walkTo(PLACES.draynorFish.x + rand(-4, 4), PLACES.draynorFish.z + rand(-4, 4), { tol: 2 });
                    continue;
                }
                await gatherOnce(bot, spot, 'Net', 'npc', 60);
            }
        }
    },
    {
        id: 'mine',
        skills: ['mining'],
        canRun: bot => bot.has('Bronze pickaxe') || bot.has('Iron pickaxe') || 'need a pickaxe',
        async run(bot, until) {
            await bot.walkTo(PLACES.eastMine.x, PLACES.eastMine.z, { tol: 6 });
            while (now() < until) {
                const s = await bot.state(14);
                if (await bot.handleInterrupts()) continue;
                if (s.invFree <= 1) {
                    await bot.dropAll(i => /ore$|^Clay$/.test(i.name));
                    continue;
                }
                const want = bot.lvl('mining') >= 15 ? /Rocks/ : /Rocks/;
                const rocks = s.nearby.locs.filter(l => want.test(l.name ?? '') && l.ops.includes('Mine') && /copper|tin|iron/.test(l.debug ?? ''));
                const rock = rocks.filter(r => !/iron/.test(r.debug) || bot.lvl('mining') >= 15).sort((a, b) => a.dist - b.dist)[0];
                if (!rock) {
                    await bot.walkTo(PLACES.eastMine.x + rand(-5, 5), PLACES.eastMine.z + rand(-5, 5), { tol: 2 });
                    continue;
                }
                await gatherOnce(bot, rock, 'Mine', 'loc', 30);
            }
        }
    },
    {
        id: 'melee',
        skills: ['attack', 'strength', 'defence', 'hitpoints', 'prayer'],
        canRun: () => true,
        async run(bot, until) {
            await bot.state();
            // gear up
            for (const g of ['Bronze sword', 'Wooden shield']) if (bot.inv(g).length) await bot.equip(g);
            const atk = bot.lvl('attack'), str = bot.lvl('strength'), def = bot.lvl('defence');
            const low = Math.min(atk, str, def);
            const style = low === atk ? 0 : low === str ? 1 : 3;
            await bot.act({ type: 'style', n: style });
            const cb = bot.s.combat;
            const area = cb < 10 ? PLACES.chickens : cb < 20 ? PLACES.cows : PLACES.goblins;
            const targets = cb < 10 ? ['Chicken'] : cb < 20 ? ['Cow', 'Chicken'] : ['Goblin', 'Cow'];
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
            await bot.act({ type: 'style', n: 0 });
            await fightLoop(bot, until, PLACES.chickens, ['Chicken'], { pickup: ['Bronze arrow'] });
            await bot.equip('Bronze sword');
        }
    },
    {
        id: 'magic',
        skills: ['magic', 'hitpoints'],
        canRun: bot => (bot.count('Air rune') >= 1 && bot.count('Mind rune') >= 1) || 'need air+mind runes',
        async run(bot, until) {
            await bot.walkTo(PLACES.chickens.x, PLACES.chickens.z, { tol: 6 });
            while (now() < until && bot.count('Air rune') >= 1 && bot.count('Mind rune') >= 1) {
                const s = await bot.state(12);
                if (await bot.handleInterrupts()) continue;
                const t = bot.nearestNpc(n => n.name === 'Chicken' && !n.busy);
                if (!t) { await bot.walkTo(PLACES.chickens.x + rand(-4, 4), PLACES.chickens.z + rand(-4, 4)); continue; }
                await bot.act({ type: 'spellnpc', npc: t.npc, spell: 'magic:wind_strike' });
                await bot.waitIdle({ timeout: 20, quiet: 3 });
            }
        }
    },
    {
        id: 'thieving',
        skills: ['thieving'],
        canRun: () => true,
        async run(bot, until) {
            await bot.walkTo(PLACES.lumbridge.x, PLACES.lumbridge.z, { tol: 6 });
            while (now() < until) {
                const s = await bot.state(14);
                if (await bot.handleInterrupts()) continue;
                const t = bot.nearestNpc(n => /^(Man|Woman)$/.test(n.name) && n.ops?.includes('Pickpocket'));
                if (!t) { await bot.walkTo(PLACES.lumbridge.x + rand(-6, 6), PLACES.lumbridge.z + rand(-6, 6)); continue; }
                await bot.act({ type: 'opnpc', npc: t.npc, op: 'Pickpocket' });
                await bot.waitIdle({ timeout: 15, quiet: 2 });
            }
        }
    }
];

// Raw fish -> fire (chop a nearby tree for logs if needed).
async function cookAll(bot) {
    for (let attempts = 0; attempts < 6; attempts++) {
        let s = await bot.state(8);
        const raw = s.inv.filter(i => /^Raw /.test(i.name));
        if (!raw.length) return;
        let fire = bot.nearestLoc(l => l.name === 'Fire' && l.dist <= 6);
        if (!fire) {
            if (!bot.has('Tinderbox')) return;
            if (!s.inv.some(i => i.name === 'Logs')) {
                // make space for a log
                if (s.invFree === 0) {
                    await bot.act({ type: 'opheld', slot: raw[raw.length - 1].slot, op: 'Drop' });
                    await bot.wait(1);
                }
                const tree = bot.nearestLoc(l => l.name === 'Tree' && l.ops.includes('Chop down'));
                if (!tree) { await bot.walkTo(3086, 3243, { tol: 3 }); continue; }
                await gatherOnce(bot, tree, 'Chop down', 'loc', 40);
                continue;
            }
            const log = bot.inv('Logs')[0];
            await bot.act({ type: 'useheld', item: 'Tinderbox', onSlot: log.slot });
            await bot.waitIdle({ timeout: 20 });
            continue;
        }
        for (const r of raw) {
            s = await bot.state(8);
            fire = bot.nearestLoc(l => l.name === 'Fire' && l.dist <= 6);
            if (!fire) break;
            const item = s.inv.find(i => i.slot === r.slot && /^Raw /.test(i.name));
            if (!item) continue;
            await bot.act({ type: 'useheld', slot: item.slot, on: { x: fire.x, z: fire.z, id: fire.id } });
            await bot.waitIdle({ timeout: 12, quiet: 2 });
        }
    }
}

async function fightLoop(bot, until, area, names, { pickup = [] } = {}) {
    await bot.walkTo(area.x, area.z, { tol: 6 });
    while (now() < until) {
        const s = await bot.state(12);
        if (await bot.handleInterrupts()) continue;
        if (s.hp <= 3 && !s.inv.some(i => FOOD.includes(i.name))) {
            bot.log('low hp and no food, resting');
            await bot.walkTo(area.x + 10, area.z + 10);
            await bot.wait(60);
            continue;
        }
        if (s.target) { await bot.wait(2); continue; }
        // loot: bones (bury), feathers, arrows
        const loot = s.nearby.objs.find(o => o.dist <= 4 && (['Bones', 'Feather', ...pickup].includes(o.name)) && s.invFree > 1);
        if (loot) {
            await bot.act({ type: 'opobj', x: loot.x, z: loot.z, id: loot.id });
            await bot.waitIdle({ timeout: 8 });
            continue;
        }
        const bones = s.inv.find(i => i.name === 'Bones');
        if (bones) {
            await bot.act({ type: 'opheld', slot: bones.slot, op: 'Bury' });
            await bot.wait(2);
            continue;
        }
        if (s.invFree <= 2) await bot.dropAll(i => /^(Raw chicken|Raw beef|Cowhide|Goblin mail|Chef's hat)$/.test(i.name));
        const t = bot.nearestNpc(n => names.includes(n.name) && !n.busy && n.ops?.includes('Attack'));
        if (!t) { await bot.walkTo(area.x + rand(-5, 5), area.z + rand(-5, 5), { tol: 2 }); continue; }
        await bot.act({ type: 'opnpc', npc: t.npc, op: 'Attack' });
        await bot.waitIdle({ timeout: 40, quiet: 3 });
    }
}

export function taskById(id) {
    return TASKS.find(t => t.id === id);
}
