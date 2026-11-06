import { FOOD } from './lib.mjs';
// Quests (Phase 4.2). Each quest is a task like the skill tasks: { id, canRun(bot), run(bot, untilMs) }.
// The steps only use normal player actions: walking, picking things up, talking, using items on scenery.
const COOK = { x: 3209, y: 3214 };
const FARM = { x: 3227, y: 3297 };      // farm north of Lumbridge: a bucket spawns in the dairy (its eggs are in pens bots can't get into)
// fenced areas are entered through their gates (straight-line hops get stuck on the fences)
const FARM_ROUTE = [[3240, 3290], [3238, 3296], [3229, 3298]];
const WHEAT_ROUTE = [[3165, 3291], [3165, 3296], [3161, 3297]];
const FRED = { x: 3187, y: 3278 };     // Fred the Farmer's chicken pen west of Lumbridge: an egg spawns at 3191,3276
const DAIRY = { x: 3253, y: 3271 };     // Gillie Groats' dairy cows, east of the river
const WHEAT = { x: 3160, y: 3296 };
const MILL = { x: 3166, y: 3305 };
const HOPPER = { x: 3166, y: 3307, id: 36881 }; // top floor; has no options, so it isn't listed in the state
const ANSWERS = /what's wrong|always happy to help|know where to find|all the information/i;

const has = (bot, name) => bot.s.inv.some(i => i.name === name);

async function pickUp(bot, name, at, route = null) {
    const unreachable = new Set(); // spawns we couldn't get to (e.g. inside a coop): try another one
    for (let tries = 0; tries < 8 && !has(bot, name); tries++) {
        if (route && tries === 0) await bot.route(route, { tol: 2 });
        else await bot.walkTo(at.x, at.y, { tol: 4 });
        const s = await bot.state(12);
        const g = s.ground.filter(o => o.name === name && !unreachable.has(`${o.x},${o.y}`)).sort((a, b) => a.dist - b.dist)[0];
        if (!g) { unreachable.clear(); await bot.wait(10); continue; } // wait for it to respawn
        const n0 = bot.msgs.length;
        await bot.act({ type: 'ground', x: g.x, y: g.y, id: g.id });
        await bot.waitIdle({ timeout: 15 });
        await bot.state(5);
        if (!has(bot, name) && bot.msgs.slice(n0).some(t => /can't reach/i.test(t))) unreachable.add(`${g.x},${g.y}`);
    }
    return has(bot, name);
}

// bank whatever isn't a tool, food or a quest item when the bag is too full for the job
const KEEP = /axe|pickaxe|tinderbox|net|knife|hammer|shears|coins|bucket|pot|egg|wool|flour|milk|grain|rune|arrow|bow|sword|shield|dagger/i;
async function makeRoom(bot, free) {
    if ((await bot.state(3)).invFree >= free) return true;
    bot.log(`quest: making room in the bank (need ${free} free slots)`);
    if (!(await bot.openBank())) return false;
    await bot.depositAll(i => !KEEP.test(i.name) && !FOOD.includes(i.name));
    await bot.leaveBank();
    return (await bot.state(3)).invFree >= free;
}

async function climb(bot, dir) {
    const z0 = (await bot.state(8)).z;
    const re = dir === 'up' ? /^climb-up$/i : /^climb-down$/i;
    const l = bot.nearestScenery(o => /ladder/i.test(o.name) && o.ops.some(op => re.test(op)));
    if (!l) return false;
    await bot.act({ type: 'scenery', x: l.x, y: l.y, id: l.id, op: l.ops.find(op => re.test(op)) });
    await bot.waitIdle({ timeout: 15 });
    await bot.wait(2);
    return (await bot.state(8)).z !== z0;
}

// back to ground level: ladders where there are some, else the Lumbridge castle stairs
async function toGround(bot) {
    for (let i = 0; i < 4 && (await bot.state(10)).z > 0; i++) if (!(await climb(bot, 'down'))) await bot.lumbridgeFloor(0);
    return bot.s.z === 0;
}

async function talkCook(bot) {
    await bot.walkTo(COOK.x, COOK.y, { tol: 2 });
    await bot.talkTo('Cook', { answer: ANSWERS });
    await bot.state(5);
}

async function getMilk(bot) {
    if (has(bot, 'Bucket of milk')) return true;
    if (!has(bot, 'Bucket') && !(await pickUp(bot, 'Bucket', FARM, FARM_ROUTE))) return false;
    await bot.walkTo(DAIRY.x, DAIRY.y, { tol: 3 });
    for (let tries = 0; tries < 4 && !has(bot, 'Bucket of milk'); tries++) {
        await bot.state(10);
        const cow = bot.nearestScenery(o => o.name === 'Dairy cow' && o.ops.includes('Milk'));
        if (!cow) return false;
        await bot.act({ type: 'scenery', x: cow.x, y: cow.y, id: cow.id, op: 'Milk' });
        await bot.waitIdle({ timeout: 15 });
        await bot.state(5);
    }
    return has(bot, 'Bucket of milk');
}

async function getFlour(bot) {
    if (has(bot, 'Pot of flour')) return true;
    if (!has(bot, 'Empty pot') && !(await pickUp(bot, 'Empty pot', { x: 3209, y: 3214 }))) return false;
    if (!has(bot, 'Grain')) {
        await bot.route(WHEAT_ROUTE, { tol: 2 });
        for (let tries = 0; tries < 5 && !has(bot, 'Grain'); tries++) {
            await bot.state(10);
            const w = bot.nearestScenery(o => o.name === 'Wheat' && o.ops.includes('Pick'));
            if (!w) { await bot.wait(5); continue; }
            await bot.act({ type: 'scenery', x: w.x, y: w.y, id: w.id, op: 'Pick' });
            await bot.waitIdle({ timeout: 10 });
            await bot.state(5);
            await bot.handleInterrupts();
        }
        if (!has(bot, 'Grain')) return false;
    }
    // grain goes in the hopper on the top floor, then the controls send it down to the bin on the ground floor
    await bot.walkTo(MILL.x, MILL.y, { tol: 2 });
    for (let i = 0; i < 4 && bot.s.z < 2; i++) await climb(bot, 'up');
    if (bot.s.z !== 2) return false;
    await bot.act({ type: 'useitem', item: 'Grain', x: HOPPER.x, y: HOPPER.y, id: HOPPER.id });
    await bot.waitIdle({ timeout: 10 });
    const ctl = bot.nearestScenery(o => /hopper controls/i.test(o.name));
    if (ctl) { await bot.act({ type: 'scenery', x: ctl.x, y: ctl.y, id: ctl.id, op: ctl.ops[0] }); await bot.waitIdle({ timeout: 10 }); }
    for (let i = 0; i < 4 && bot.s.z > 0; i++) await climb(bot, 'down');
    await bot.walkTo(MILL.x, MILL.y, { tol: 2 }); // a trade may have walked us off meanwhile; the flour waits in the bin
    await bot.state(10);
    const bin = bot.nearestScenery(o => /flour bin/i.test(o.name));
    if (!bin) { bot.log('quest: no flour bin in sight'); return false; }
    await bot.act({ type: 'useitem', item: 'Empty pot', x: bin.x, y: bin.y, id: bin.id });
    await bot.waitIdle({ timeout: 10 });
    await bot.state(5);
    return has(bot, 'Pot of flour');
}

export const COOKS_ASSISTANT = {
    id: 'cooks_assistant',
    skills: ['cooking'],
    canRun: bot => (bot.s.quests?.COOKS_ASSISTANT ?? 0) >= 100 ? 'already done' : true, // banks clutter itself if the bag is full
    async run(bot, until, step = {}) {
        bot._questing = true; // market day leaves questing bots alone
        try { await this.steps(bot, until, step); } finally { bot._questing = false; }
    },
    async steps(bot, until, step) {
        const stage = () => bot.s.quests?.COOKS_ASSISTANT ?? 0;
        await toGround(bot);
        await makeRoom(bot, 5);
        if (stage() === 0) { bot.log('quest: starting Cook\'s Assistant'); await talkCook(bot); }
        if (stage() === 0) { bot.log('quest: the cook did not give us the quest'); return; }
        const given = k => !!bot.s.questFlags?.[k + '_submitted'] || !!bot.s.questFlags?.all_submitted; // already handed to the cook
        // party: helpers fetch some ingredients and trade them over; the leader does the rest
        const party = step.party ?? {}; // e.g. { "Egg": "claudebot4", "Bucket of milk": "claudebot5" }
        const mine = n => !party[n];
        if (mine('Egg') && !given('egg') && !has(bot, 'Egg')) await pickUp(bot, 'Egg', FRED);
        if (mine('Bucket of milk') && !given('milk') && Date.now() < until) await getMilk(bot);
        if (mine('Pot of flour') && !given('flour') && Date.now() < until) await getFlour(bot);
        if (Object.keys(party).length) {
            await bot.walkTo(COOK.x, COOK.y, { tol: 3 });
            const waitUntil = Math.min(until, Date.now() + 10 * 60_000);
            const missing = () => Object.keys(party).filter(n => !has(bot, n) && !given(KEY[n]));
            if (missing().length) bot.log(`quest: waiting for my party to bring ${missing().join(', ')}`);
            while (missing().length && Date.now() < waitUntil) { await bot.state(8); await bot.handleInterrupts(); await bot.wait(3); }
            // whatever didn't arrive, fetch it ourselves
            for (const n of missing()) { bot.log(`quest: ${party[n]} never brought ${n}; getting it myself`); await GET[n](bot); }
        }
        const got = ['Egg', 'Bucket of milk', 'Pot of flour'].filter(n => has(bot, n));
        bot.log(`quest: Cook's Assistant items: ${got.join(', ') || 'none'}`);
        if (got.length) await talkCook(bot); // the cook takes whatever we bring, and finishes the quest when all three are in
        await bot.state(5);
        bot.log(`quest: Cook's Assistant stage ${stage()}${stage() >= 100 ? ' (complete!)' : ''}, quest points ${bot.s.questPoints}`);
    }
};

const KEY = { Egg: 'egg', 'Bucket of milk': 'milk', 'Pot of flour': 'flour' };
const GET = { Egg: bot => pickUp(bot, 'Egg', FRED), 'Bucket of milk': getMilk, 'Pot of flour': getFlour };

// Party member: fetch one quest item and trade it to the party leader.
// plan step: { "task": "quest_fetch", "item": "Egg", "for": "claudebot1", "minutes": 30 }
export const QUEST_FETCH = {
    id: 'quest_fetch',
    skills: [],
    canRun: () => true,
    async run(bot, until, step = {}) {
        bot._questing = true;
        try { await this.steps(bot, until, step); } finally { bot._questing = false; }
    },
    async steps(bot, until, step) {
        const item = step.item, leader = step.for;
        if (!GET[item] || !leader) { bot.log(`quest_fetch: bad step ${JSON.stringify(step)}`); return; }
        await toGround(bot);
        await makeRoom(bot, 3);
        if (!has(bot, item)) await GET[item](bot);
        if (!has(bot, item)) { bot.log(`quest_fetch: couldn't get ${item}`); return; }
        bot.log(`quest_fetch: bringing ${item} to ${leader}`);
        const m = bot.market;
        while (Date.now() < until && has(bot, item)) {
            if (m && !m.dealFor(bot.name) && !m.busy.has(leader) && m.bots.get(leader)?.bot.s?.online)
                m.open({ buyer: leader, seller: bot.name, item, amount: 1, price: 0, kind: 'quest' });
            await bot.state(8);
            await bot.handleInterrupts(); // the market hook walks over and runs the trade
            await bot.wait(3);
        }
        bot.log(`quest_fetch: ${has(bot, item) ? 'gave up delivering' : 'delivered'} ${item}`);
    }
};

// ---------- Sheep Shearer: 20 balls of wool for Fred the Farmer (delivered in batches) ----------
const FRED_HOUSE = { x: 3189, y: 3273 };
const SHEEP_FIELD = { x: 3203, y: 3266 };
const SPIN_WHEEL_FLOOR = 1; // Lumbridge castle first floor

async function shearSheep(bot, want, until) {
    bot._notSheep ??= new Set(); // "sheep" that turned out not to be (The Thing)
    await bot.walkTo(SHEEP_FIELD.x, SHEEP_FIELD.y, { tol: 4 });
    while (Date.now() < until && bot.count('Wool') < want && bot.s.invFree > 0) {
        const s = await bot.state(12);
        if (await bot.handleInterrupts()) continue;
        const sheep = bot.nearestNpc(n => n.name === 'Sheep' && n.ops.includes('Shear') && !bot._notSheep.has(n.id));
        if (!sheep) { await bot.walkTo(SHEEP_FIELD.x + Math.round(Math.random() * 8 - 4), SHEEP_FIELD.y + Math.round(Math.random() * 8 - 4), { tol: 2 }); continue; }
        const before = bot.count('Wool');
        await bot.act({ type: 'npc', npc: sheep.npc, op: 'Shear' });
        await bot.waitIdle({ timeout: 12, quiet: 3 });
        await bot.state(5);
        if (bot.count('Wool') === before && bot.msgs.slice(-3).some(t => /escape|penguin|not a sheep|run/i.test(t))) {
            bot.log(`quest: that wasn't a sheep (npc ${sheep.id}); leaving it alone`);
            bot._notSheep.add(sheep.id);
        }
    }
    return bot.count('Wool');
}

async function spinWool(bot) {
    if (!bot.count('Wool')) return 0;
    await bot.lumbridgeFloor(SPIN_WHEEL_FLOOR);
    for (let tries = 0; tries < 6 && bot.count('Wool') > 0; tries++) {
        await bot.state(10);
        if (bot.s.iface === 459) { // spinning screen: wool is button 19; option 3 spins all of it
            await bot.act({ type: 'button', iface: 459, child: 19, op: 2 });
            await bot.waitIdle({ timeout: 90, quiet: 5 });
            continue;
        }
        if (await bot.handleInterrupts({ answer: /ball of wool/i })) continue;
        const wheel = bot.nearestScenery(l => /spinning wheel/i.test(l.name) && l.ops.includes('Spin'));
        if (!wheel) { await bot.walkTo(3209, 3213, { tol: 2 }); continue; }
        await bot.act({ type: 'scenery', x: wheel.x, y: wheel.y, id: wheel.id, op: 'Spin' });
        await bot.waitIdle({ timeout: 10, cond: st => st.iface === 459 });
    }
    await bot.lumbridgeFloor(0);
    return bot.count('Ball of wool');
}

async function talkFred(bot) {
    await bot.walkTo(FRED_HOUSE.x, FRED_HOUSE.y, { tol: 3 });
    await bot.talkTo('Fred the Farmer', { answer: /looking for a quest|yes okay|i can do that|i have some/i });
    await bot.state(5);
}

export const SHEEP_SHEARER = {
    id: 'sheep_shearer',
    skills: ['crafting'],
    canRun: bot => (bot.s.quests?.SHEEP_SHEARER ?? 0) >= 100 ? 'already done' : true,
    async run(bot, until, step = {}) {
        bot._questing = true;
        try { await this.steps(bot, until, step); } finally { bot._questing = false; }
    },
    async steps(bot, until) {
        const stage = () => bot.s.quests?.SHEEP_SHEARER ?? 0;
        const delivered = () => Number(bot.s.questFlags?.['num-balls-of-wool-delivered'] ?? 0);
        await toGround(bot);
        if (stage() === 0) { bot.log('quest: starting Sheep Shearer'); await talkFred(bot); }
        if (stage() === 0) { bot.log('quest: Fred did not give us the quest'); return; }
        await makeRoom(bot, 12);
        while (Date.now() < until && stage() < 90) {
            if (!bot.has('Shears')) await pickUp(bot, 'Shears', { x: 3192, y: 3272 });
            if (!bot.has('Shears')) { bot.log('quest: no shears'); return; }
            const need = 20 - delivered() - bot.count('Ball of wool');
            const batch = Math.min(need, bot.s.invFree + bot.count('Wool'));
            if (batch <= 0 && !bot.count('Ball of wool')) { bot.log('quest: no room for wool; bank or drop something first'); return; }
            if (batch > 0) await shearSheep(bot, batch, until);
            await spinWool(bot);
            if (bot.count('Ball of wool')) { await talkFred(bot); bot.log(`quest: Sheep Shearer: ${delivered()}/20 balls delivered`); }
        }
        if (stage() >= 90 && stage() < 100) await talkFred(bot); // get paid
        await bot.state(5);
        bot.log(`quest: Sheep Shearer stage ${stage()}${stage() >= 100 ? ' (complete!)' : ''}, quest points ${bot.s.questPoints}`);
    }
};

export const QUESTS = [COOKS_ASSISTANT, QUEST_FETCH, SHEEP_SHEARER];
