// Phase 4.2: quests as scripts of steps (walk, talk with dialog choices, gather, hand in).
// Each quest lists the items it needs, and how to get each one, so a party can split the gathering
// (see party.mjs). Quest progress comes from the bot API's `quests` state (stage 100 = done).
import { sleep, dist } from './lib.mjs';
import { SHOPS } from './tasks.mjs';

// A bucket or pot to fill: buy one at the Lumbridge general store if the bot has none.
export async function ensureContainer(bot, name, n = 1) {
    if (count(bot, name) >= n) return true;
    const shop = await bot.openShop(SHOPS.general);
    if (shop) await bot.buy(name, n - count(bot, name));
    await bot.closeInterfaces();
    await bot.state(5);
    if (count(bot, name) < n) bot.log(`quest: couldn't get ${n} ${name} (have ${count(bot, name)}, ${bot.s.coins}gp)`);
    return count(bot, name) > 0;
}

const COOK = { x: 3208, y: 3214 };
const MILL = { door: { x: 3166, y: 3301 }, ladder: { x: 3164, y: 3307 }, hopper: { x: 3166, y: 3307 }, controls: { x: 3166, y: 3305 }, bin: { x: 3166, y: 3306, id: 36880 } };
const WHEAT = { x: 3156, y: 3299 };
const EGGS = [{ x: 3229, y: 3299 }, { x: 3226, y: 3301 }, { x: 3191, y: 3276 }];
const COWS = [{ x: 3252, y: 3275 }, { x: 3254, y: 3272 }];

export const stageOf = (bot, quest) => bot.s?.quests?.[quest] ?? 0;
const count = (bot, name) => bot.s.inv.filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

async function climb(bot, op, z) {
    for (let i = 0; i < 4 && bot.s.z !== z; i++) {
        const lad = bot.nearestScenery(l => /ladder/i.test(l.name) && l.ops.includes(op));
        if (!lad) { bot.log(`quest: no ladder to ${op}`); return false; }
        await bot.act({ type: 'scenery', x: lad.x, y: lad.y, id: lad.id, op });
        await bot.waitIdle({ timeout: 10, cond: s => s.z === z });
        await bot.state(10);
    }
    return bot.s.z === z;
}

// Romeo & Juliet (Varrock): Romeo in the square, Juliet upstairs in her house to the west, Father Lawrence in
// the north-east church, the Apothecary south-west; cadava berries from the bushes south-east of Varrock
const RJ = { romeo: { x: 3210, y: 3424 }, julietStairs: { x: 3156, y: 3434 }, juliet: { x: 3157, y: 3427 }, lawrence: { x: 3254, y: 3484 }, apothecary: { x: 3196, y: 3404 }, bushes: { x: 3269, y: 3369 } };
const RJ_ANSWERS = /perhaps i could help to find her|yes okay, i'll let her know|i guess i could look for him|yes i've met him|heard anything from juliet|potion that makes it seem like i'm dead/i;
async function talkWait(bot, name, at, z = 0) {
    if (bot.s.z !== z || dist(bot.s, at) > 6) await bot.travel(at.x, at.y, { tol: 3 });
    await bot.talkTo(name, { answer: RJ_ANSWERS, maxSteps: 60 });
    // cutscenes: wait until we can move again
    for (let i = 0; i < 30 && (await bot.state(10)).locked; i++) { await bot.handleInterrupts({ answer: RJ_ANSWERS }); await bot.wait(3); }
    await bot.state(5);
}
async function toJuliet(bot) {
    if (bot.s.z !== 1) {
        await bot.travel(RJ.julietStairs.x, RJ.julietStairs.y + 1, { tol: 2 });
        await bot.state(8);
        const st = bot.nearestScenery(l => /staircase/i.test(l.name) && l.ops.includes('Climb-up'));
        if (!st) { bot.log('quest: no staircase to Juliet'); return false; }
        await bot.act({ type: 'scenery', x: st.x, y: st.y, id: st.id, op: 'Climb-up' });
        await bot.waitIdle({ timeout: 12, cond: x => x.z === 1 });
    }
    if ((await bot.state(10)).z !== 1) return false;
    await bot.walkTo(RJ.juliet.x, RJ.juliet.y, { tol: 2, timeout: 60, direct: true });
    await bot.talkTo('Juliet', { answer: RJ_ANSWERS, maxSteps: 60 });
    for (let i = 0; i < 30 && (await bot.state(10)).locked; i++) { await bot.handleInterrupts({ answer: RJ_ANSWERS }); await bot.wait(3); }
    // back downstairs
    const down = bot.nearestScenery(l => /staircase/i.test(l.name) && l.ops.includes('Climb-down'));
    if (down) { await bot.act({ type: 'scenery', x: down.x, y: down.y, id: down.id, op: 'Climb-down' }); await bot.waitIdle({ timeout: 12, cond: x => x.z === 0 }); }
    await bot.state(5);
    return true;
}

// Imp Catcher: Wizard Mizgog on the Wizards' Tower's second floor wants a red, yellow, black and white bead.
// Imps (level 2-7) roam around Lumbridge and Draynor; each kill drops a given bead 1 time in 16.
const BEADS = ['Red bead', 'Yellow bead', 'Black bead', 'White bead'];
const IMP_GROUNDS = [{ x: 3212, y: 3226 }, { x: 3240, y: 3250 }, { x: 3190, y: 3260 }, { x: 3067, y: 3254 }, { x: 3110, y: 3280 }];
const IC_ANSWERS = /give me a quest please|i'll try/i;
async function upTower(bot, z) {
    await bot.travel(3109, 3163, { tol: 2 });
    await bot.act({ type: 'scenery', x: 3107, y: 3162, id: 11993, op: 'Open' }).catch(() => {}); // the auto-walk door
    await bot.wait(6);
    for (let i = 0; i < 6 && (await bot.state(12)).z < z; i++) {
        const st = bot.nearestScenery(l => /stair|ladder/i.test(l.name) && l.ops.some(o => /climb-up|climb/i.test(o)) && l.y < 9000);
        if (!st) { bot.log('quest: no way up the tower'); return false; }
        const op = st.ops.find(o => /^climb-up$/i.test(o)) ?? st.ops.find(o => /climb/i.test(o));
        const z0 = bot.s.z;
        await bot.act({ type: 'scenery', x: st.x, y: st.y, id: st.id, op });
        await bot.waitIdle({ timeout: 12, cond: x => x.z > z0 });
        await bot.handleInterrupts({ answer: /climb up/i });
    }
    return bot.s.z >= z;
}
async function downTower(bot) {
    for (let i = 0; i < 6 && (await bot.state(12)).z > 0; i++) {
        const st = bot.nearestScenery(l => /stair|ladder/i.test(l.name) && l.ops.some(o => /climb-down|climb/i.test(o)));
        if (!st) break;
        const op = st.ops.find(o => /^climb-down$/i.test(o)) ?? st.ops.find(o => /climb/i.test(o));
        const z0 = bot.s.z;
        await bot.act({ type: 'scenery', x: st.x, y: st.y, id: st.id, op });
        await bot.waitIdle({ timeout: 12, cond: x => x.z < z0 });
        await bot.handleInterrupts({ answer: /climb down/i });
    }
}
async function talkMizgog(bot) {
    if (!(await upTower(bot, 2))) return false;
    await bot.walkTo(3103, 3163, { tol: 2, timeout: 40, direct: true });
    await bot.talkTo('Wizard Mizgog', { answer: IC_ANSWERS, maxSteps: 60 });
    await bot.state(5);
    await downTower(bot);
    return true;
}
async function huntBeads(bot, minutes = 25) {
    const end = Date.now() + minutes * 60_000;
    let at = IMP_GROUNDS[Math.floor(Math.random() * IMP_GROUNDS.length)];
    await bot.travel(at.x, at.y, { tol: 4 });
    while (Date.now() < end && BEADS.some(b => !count(bot, b))) {
        const s = await bot.state(14);
        if (await bot.handleInterrupts()) continue;
        const bead = s.ground.find(g => BEADS.includes(g.name) && !count(bot, g.name) && g.dist <= 8);
        if (bead && s.invFree > 0) { await bot.act({ type: 'ground', x: bead.x, y: bead.y, id: bead.id }); await bot.waitIdle({ timeout: 10 }); continue; }
        if (s.attacking || s.inCombat) { await bot.wait(2); continue; }
        if (s.hp < s.maxHp * 0.4) { const f = s.inv.find(i => i.ops.includes('Eat')); if (f) { await bot.act({ type: 'item', slot: f.slot, op: 'Eat' }); await bot.wait(2); continue; } }
        const imp = bot.nearestNpc(n => n.name === 'Imp' && n.ops.includes('Attack') && !n.inCombat);
        if (!imp) { at = IMP_GROUNDS[Math.floor(Math.random() * IMP_GROUNDS.length)]; await bot.travel(at.x, at.y, { tol: 4 }); continue; }
        await bot.act({ type: 'npc', npc: imp.npc, op: 'Attack' });
        await bot.waitIdle({ timeout: 25, quiet: 3, cond: st => !st.attacking && !st.inCombat });
    }
    bot.log(`quest: beads ${BEADS.filter(b => count(bot, b)).join(', ') || 'none'}`);
    return BEADS.every(b => count(bot, b));
}

// Ways to get one quest item (each returns true once the bot holds it). `n`: how many to get.
export const GATHER = {
    async 'Cadava berries'(bot, n = 1) {
        await bot.travel(RJ.bushes.x, RJ.bushes.y, { tol: 3 });
        for (let i = 0; i < 12 && count(bot, 'Cadava berries') < n; i++) {
            await bot.state(10);
            const bush = bot.nearestScenery(l => /cadava bush/i.test(l.name) && l.ops.includes('Pick-from'));
            if (!bush) { await bot.wait(10); continue; } // picked clean: they grow back
            await bot.act({ type: 'scenery', x: bush.x, y: bush.y, id: bush.id, op: 'Pick-from' });
            await bot.waitIdle({ timeout: 10, quiet: 2 });
        }
        return count(bot, 'Cadava berries') >= n;
    },
    async Egg(bot, n = 1) {
        for (let tries = 0; tries < 12 && count(bot, 'Egg') < n; tries++) {
            const spot = EGGS[tries % EGGS.length];
            await bot.travel(spot.x, spot.y, { tol: 4 });
            const s = await bot.state(12);
            const egg = s.ground?.find(g => g.name === 'Egg');
            if (!egg) { await sleep(8000); continue; } // eggs respawn
            await bot.act({ type: 'ground', x: egg.x, y: egg.y, id: egg.id });
            await bot.waitIdle({ timeout: 15 });
            await bot.state(5);
        }
        return count(bot, 'Egg') >= n;
    },
    async 'Bucket of milk'(bot, n = 1) {
        await ensureContainer(bot, 'Bucket', n - count(bot, 'Bucket of milk'));
        for (let tries = 0; tries < 8 && count(bot, 'Bucket of milk') < n; tries++) {
            if (!count(bot, 'Bucket')) { bot.log(`quest: out of buckets with ${count(bot, 'Bucket of milk')}/${n} milk`); return false; }
            const cow = COWS[tries % COWS.length];
            await bot.travel(cow.x - 1, cow.y, { tol: 3 });
            await bot.state(10);
            await bot.act({ type: 'scenery', x: cow.x, y: cow.y, id: 8689, op: 'Milk' }).catch(e => bot.log(`quest: ${e.message}`));
            await bot.waitIdle({ timeout: 15, quiet: 3 });
            await bot.state(5);
            bot.log(`quest: milking, ${count(bot, 'Bucket of milk')}/${n} (${bot.s.messages?.map(m => m.text).slice(-1)})`);
        }
        return count(bot, 'Bucket of milk') >= n;
    },
    async 'Pot of flour'(bot, n = 1) {
        await ensureContainer(bot, 'Empty pot', n - count(bot, 'Pot of flour'));
        for (let round = 0; round < 3 && count(bot, 'Pot of flour') < n; round++) {
            const want = Math.min(n - count(bot, 'Pot of flour'), count(bot, 'Empty pot'));
            if (!want) { bot.log('quest: no empty pot for the flour'); return false; }
            // wheat -> grain, one per pot
            if (count(bot, 'Grain') < want) {
                await bot.travel(WHEAT.x, WHEAT.y, { tol: 3 });
                for (let i = 0; i < want * 4 && count(bot, 'Grain') < want; i++) {
                    const s = await bot.state(8);
                    const w = bot.nearestScenery(l => l.name === 'Wheat' && l.ops.includes('Pick'), s);
                    if (!w) { await sleep(5000); continue; }
                    await bot.act({ type: 'scenery', x: w.x, y: w.y, id: w.id, op: 'Pick' });
                    await bot.waitIdle({ timeout: 10 });
                    await bot.state(5);
                }
                if (!count(bot, 'Grain')) return false;
            }
            // up the mill: each grain into the hopper and through the controls, then down to the flour bin
            await bot.travel(MILL.ladder.x + 1, MILL.ladder.y - 1, { tol: 2 });
            await bot.state(8);
            if (!(await climb(bot, 'Climb-up', 1)) || !(await climb(bot, 'Climb-up', 2))) return false;
            for (let i = 0; i < want && count(bot, 'Grain'); i++) {
                const grain = bot.s.inv.find(it => it.name === 'Grain');
                await bot.act({ type: 'useitem', slot: grain.slot, x: MILL.hopper.x, y: MILL.hopper.y });
                await bot.waitIdle({ timeout: 10 });
                await bot.act({ type: 'scenery', x: MILL.controls.x, y: MILL.controls.y, op: 'Operate' });
                await bot.waitIdle({ timeout: 10 });
                await bot.state(5);
            }
            if (!(await climb(bot, 'Climb-down', 1)) || !(await climb(bot, 'Climb-down', 0))) { bot.log('quest: stuck on the mill ladders'); return false; }
            for (let i = 0; i < want; i++) {
                await bot.act({ type: 'scenery', x: MILL.bin.x, y: MILL.bin.y, id: MILL.bin.id, op: 'Empty' }).catch(e => bot.log(`quest: ${e.message}`));
                await bot.waitIdle({ timeout: 8 });
                await bot.state(5);
            }
        }
        bot.log(`quest: milled ${count(bot, 'Pot of flour')}/${n} flour`);
        return count(bot, 'Pot of flour') >= n;
    }
};

async function talkToCook(bot) {
    await bot.travel(COOK.x, COOK.y, { tol: 2 });
    await bot.state(10);
    await bot.talkTo('Cook', { answer: /what.s wrong|always happy to help|know where to find|all the information|get right on it/i, maxSteps: 60 });
    await bot.state(5);
}

// Wizards' Tower basement (Sedridor) and the Varrock rune shop (Aubury)
const TOWER = { outside: { x: 3109, y: 3163 }, door: { x: 3107, y: 3162, id: 11993 }, ladder: { x: 3104, y: 3162 }, sedridor: { x: 3105, y: 9570 } };
const AUBURY = { x: 3253, y: 3402 };
const RM_ANSWERS = /any quests for me|sure, no problem|looking for the head wizard|ok, here you are|yes, certainly|sent here with a package/i;

async function toSedridor(bot) {
    if (bot.s.y < 9000) {
        // the inner room has an auto-walk door (it shuts behind you): stand outside it, open it, then take the ladder
        await bot.travel(TOWER.outside.x, TOWER.outside.y, { tol: 1 });
        await bot.act({ type: 'scenery', x: TOWER.door.x, y: TOWER.door.y, id: TOWER.door.id, op: 'Open' }).catch(e => bot.log(`quest: ${e.message}`));
        await bot.wait(6);
        await bot.state(10);
        const lad = bot.nearestScenery(l => /ladder/i.test(l.name) && l.ops.includes('Climb-down'));
        if (!lad) { bot.log('quest: no ladder down at the Wizards\' Tower'); return false; }
        await bot.act({ type: 'scenery', x: lad.x, y: lad.y, id: lad.id, op: 'Climb-down' });
        await bot.waitIdle({ timeout: 12, cond: s => s.y > 9000 });
    }
    await bot.walkTo(TOWER.sedridor.x, TOWER.sedridor.y, { tol: 2, timeout: 90 });
    await bot.talkTo('Sedridor', { answer: RM_ANSWERS, maxSteps: 60 });
    await bot.state(5);
    return true;
}

async function leaveBasement(bot) {
    for (let i = 0; i < 5 && bot.s.y > 9000; i++) {
        await bot.walkTo(3104, 9575, { tol: 2, timeout: 60 }); // out through Sedridor's large door to the ladder
        await bot.state(10);
        const lad = bot.nearestScenery(l => /ladder/i.test(l.name) && l.ops.includes('Climb-up'));
        if (!lad) continue;
        await bot.act({ type: 'scenery', x: lad.x, y: lad.y, id: lad.id, op: 'Climb-up' });
        await bot.waitIdle({ timeout: 12, cond: s => s.y < 9000 });
        await bot.state(10);
    }
}

// Sheep Shearer: Fred's farm, his sheep pen, and the spinning wheel on the castle's first floor
const FRED = { x: 3189, y: 3273 };
const PEN = { x: 3203, y: 3264 };
const SHEARS = [{ x: 3192, y: 3272 }, { x: 3152, y: 3306 }];
const WHEEL = { x: 3209, y: 3212 };
const FRED_ANSWERS = /yes okay|of course|something of an expert|i have some/i;

export async function getShears(bot) {
    for (const spot of SHEARS) {
        if (count(bot, 'Shears')) return true;
        await bot.travel(spot.x, spot.y, { tol: 2 });
        for (let i = 0; i < 6 && !count(bot, 'Shears'); i++) {
            const s = await bot.state(6);
            const g = s.ground?.find(x => x.name === 'Shears');
            if (!g) { await sleep(10_000); continue; } // respawns
            await bot.act({ type: 'ground', x: g.x, y: g.y, id: g.id });
            await bot.waitIdle({ timeout: 10 });
            await bot.state(5);
        }
    }
    return count(bot, 'Shears') > 0;
}

export async function shear(bot, n) {
    if (count(bot, 'Wool') >= n) return count(bot, 'Wool');
    await bot.travel(PEN.x, PEN.y, { tol: 4 });
    for (let tries = 0; tries < n * 4 && count(bot, 'Wool') < n && bot.s.invFree > 0; tries++) {
        const s = await bot.state(12);
        // never the penguin in disguise (id 3579); sheared sheep (5153) have nothing to give
        const sheep = bot.nearestNpc(x => x.name === 'Sheep' && x.ops.includes('Shear') && x.id !== 3579 && x.id !== 5153, s);
        if (!sheep) { await bot.walkTo(PEN.x + Math.round(Math.random() * 10 - 5), PEN.y + Math.round(Math.random() * 8 - 4), { tol: 1, direct: true }); continue; }
        await bot.act({ type: 'npc', npc: sheep.npc, op: 'Shear' });
        await bot.waitIdle({ timeout: 8 });
    }
    await bot.state(5);
    return count(bot, 'Wool');
}

export async function spin(bot) {
    await bot.travel(3206, 3210, { tol: 3 });
    await bot.lumbridgeFloor(1);
    await bot.walkTo(WHEEL.x + 1, WHEEL.y + 1, { tol: 2, direct: true });
    for (let i = 0; i < 6 && count(bot, 'Wool'); i++) {
        const s = await bot.state(6);
        if (s.iface === 459) { // spinning menu: wool is button 19, the third option spins all of it
            await bot.act({ type: 'button', iface: 459, child: 19, op: 2 });
            await bot.waitIdle({ timeout: 90, quiet: 4, cond: st => !st.inv.some(x => x.name === 'Wool') });
            continue;
        }
        const wheel = bot.nearestScenery(l => /spinning wheel/i.test(l.name) && l.ops.includes('Spin'), s);
        if (!wheel) { await bot.walkTo(WHEEL.x + 1, WHEEL.y + 1, { tol: 1, direct: true }); continue; }
        await bot.act({ type: 'scenery', x: wheel.x, y: wheel.y, id: wheel.id, op: 'Spin' });
        await bot.waitIdle({ timeout: 10, cond: st => st.iface === 459 });
    }
    await bot.closeInterfaces();
    await bot.state(5);
    await bot.lumbridgeFloor(0);
    return count(bot, 'Ball of wool');
}

export const QUESTS = {
    cooks_assistant: {
        name: "Cook's Assistant",
        containers: { 'Bucket of milk': 'Bucket', 'Pot of flour': 'Empty pot' }, // item -> what you need to make it
        items: ['Egg', 'Bucket of milk', 'Pot of flour'],
        async start(bot) { if (stageOf(bot, this.name) === 0) await talkToCook(bot); return stageOf(bot, this.name) > 0; },
        async finish(bot) { await talkToCook(bot); return stageOf(bot, this.name) >= 100; }
    },
    sheep_shearer: {
        name: 'Sheep Shearer',
        items: [], // 20 balls of wool, done in batches as bag space allows (Fred takes partial deliveries)
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            await bot.travel(FRED.x + 1, FRED.y, { tol: 2 });
            await bot.talkTo('Fred the Farmer', { answer: FRED_ANSWERS, maxSteps: 40 });
            await bot.state(5);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            if (!(await getShears(bot))) { bot.log('quest: no shears to be found'); return false; }
            for (let batch = 0; batch < 8 && stageOf(bot, this.name) < 100; batch++) {
                await bot.state(5);
                const room = bot.s.invFree + count(bot, 'Wool') + count(bot, 'Ball of wool');
                if (room < 3) { bot.log('quest: bag too full to shear'); return false; }
                if (!count(bot, 'Ball of wool') || count(bot, 'Wool')) {
                    await shear(bot, Math.min(20, room) - count(bot, 'Ball of wool'));
                    await spin(bot);
                }
                bot.log(`quest: taking ${count(bot, 'Ball of wool')} balls of wool to Fred`);
                await bot.travel(FRED.x + 1, FRED.y, { tol: 2 });
                await bot.talkTo('Fred the Farmer', { answer: FRED_ANSWERS, maxSteps: 40 });
                await bot.state(5);
            }
            return stageOf(bot, this.name) >= 100;
        }
    },
    imp_catcher: {
        name: 'Imp Catcher',
        items: [], // the beads are hunted in finish (several sessions if need be: what's found is kept)
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            await talkMizgog(bot);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            if (!(await huntBeads(bot))) return false;
            await talkMizgog(bot);
            return stageOf(bot, this.name) >= 100;
        }
    },
    romeo_juliet: {
        name: 'Romeo & Juliet',
        items: ['Cadava berries'],
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            await talkWait(bot, 'Romeo', RJ.romeo);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 12 && stageOf(bot, this.name) < 100; i++) {
                const st = stageOf(bot, this.name);
                if (st === 10 || st === 60) await toJuliet(bot); // her message; then the cadava potion
                else if (st === 20 || st === 70) await talkWait(bot, 'Romeo', RJ.romeo);
                else if (st === 30) await talkWait(bot, 'Father Lawrence', RJ.lawrence);
                else if (st === 40 || st === 50) {
                    if (!count(bot, 'Cadava berries') && !count(bot, 'Cadava potion') && !(await GATHER['Cadava berries'](bot, 1))) return false;
                    await talkWait(bot, 'Apothecary', RJ.apothecary);
                } else break;
                bot.log(`quest: Romeo & Juliet stage ${st} -> ${stageOf(bot, this.name)}`);
            }
            return stageOf(bot, this.name) >= 100;
        }
    },
    rune_mysteries: {
        name: 'Rune Mysteries',
        items: [], // nothing to gather: a delivery run between the Duke, the head wizard and Aubury
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            await bot.travel(3206, 3210, { tol: 3 });
            await bot.lumbridgeFloor(1);
            await bot.walkTo(3210, 3222, { tol: 2 });
            await bot.talkTo('Duke Horacio', { answer: RM_ANSWERS, maxSteps: 40 });
            await bot.state(5);
            await bot.lumbridgeFloor(0);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 8 && stageOf(bot, this.name) < 100; i++) {
                const st = stageOf(bot, this.name);
                if (st === 10 || st === 20 || st === 50) await toSedridor(bot); // the talisman, then the notes
                else if (st === 30 || st === 40) {
                    await leaveBasement(bot);
                    await bot.travel(AUBURY.x, AUBURY.y, { tol: 2 });
                    await bot.talkTo('Aubury', { answer: RM_ANSWERS, maxSteps: 40 });
                    await bot.state(5);
                } else break;
                if (stageOf(bot, this.name) === st) await bot.talkTo(st === 30 || st === 40 ? 'Aubury' : 'Sedridor', { answer: RM_ANSWERS, maxSteps: 40 }); // some stages take a second chat
                await bot.state(5);
            }
            await leaveBasement(bot);
            return stageOf(bot, this.name) >= 100;
        }
    }
};

// Do a whole quest alone: start, gather everything, hand in.
export async function soloQuest(bot, id) {
    const q = QUESTS[id];
    await bot.state(5);
    if (stageOf(bot, q.name) >= 100) return true;
    if (!(await q.start(bot))) { bot.log(`quest: could not start ${q.name}`); return false; }
    for (const item of q.items) if (!count(bot, item) && !(await GATHER[item](bot, 1))) { bot.log(`quest: could not get ${item}`); return false; }
    const ok = await q.finish(bot);
    bot.log(ok ? `quest: completed ${q.name}!` : `quest: ${q.name} not finished (stage ${stageOf(bot, q.name)})`);
    return ok;
}

export { count, dist };
