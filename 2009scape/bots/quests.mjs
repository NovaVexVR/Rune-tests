// Phase 4.2: quests as scripts of steps (walk, talk with dialog choices, gather, hand in).
// Each quest lists the items it needs, and how to get each one, so a party can split the gathering
// (see party.mjs). Quest progress comes from the bot API's `quests` state (stage 100 = done).
import { sleep, dist, DANGER, FOOD } from './lib.mjs';
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
const RJ = { romeo: { x: 3210, y: 3424 }, julietStairs: { x: 3157, y: 3433 } /* the staircase (3156,3435) is reached from the south room, door 3160,3432 */, juliet: { x: 3157, y: 3427 }, lawrence: { x: 3254, y: 3484 }, apothecary: { x: 3196, y: 3404 }, bushes: { x: 3269, y: 3369 } };
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
        await bot.travel(RJ.julietStairs.x, RJ.julietStairs.y, { tol: 3 });
        await bot.walkTo(RJ.julietStairs.x, RJ.julietStairs.y, { tol: 0, timeout: 60, direct: true }); // into the stair room, through its doors
        await bot.state(8);
        const st = bot.nearestScenery(l => /staircase/i.test(l.name) && l.ops.includes('Climb-up'));
        if (!st) { bot.log('quest: no staircase to Juliet'); return false; }
        await bot.act({ type: 'scenery', x: st.x, y: st.y, id: st.id, op: 'Climb-up' });
        await bot.waitIdle({ timeout: 12, cond: x => x.z === 1 });
    }
    if ((await bot.state(10)).z !== 1) { bot.log(`quest: couldn't climb to Juliet (at ${bot.s.x},${bot.s.y}: ${bot.msgs.slice(-1)})`); return false; }
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
// east and north of Lumbridge only: the Draynor imps share their ground with the dark wizards
const IMP_GROUNDS = [{ x: 3212, y: 3226 }, { x: 3240, y: 3250 }, { x: 3190, y: 3260 }, { x: 3230, y: 3290 }, { x: 3250, y: 3205 }];
const IC_ANSWERS = /give me a quest please|i'll try/i;
async function upTower(bot, z) {
    await bot.travel(3109, 3163, { tol: 2 });
    await bot.act({ type: 'scenery', x: 3107, y: 3162, id: 11993, op: 'Open' }).catch(() => {}); // the auto-walk door
    await bot.wait(6);
    for (let i = 0; i < 6 && (await bot.state(12)).z < z; i++) {
        const st = bot.nearestScenery(l => /stair|ladder/i.test(l.name) && l.ops.some(o => /^climb(-up)?$/i.test(o)) && l.y < 9000);
        if (!st) { bot.log(`quest: no way up the tower (in view: ${bot.s.scenery.filter(l => /stair|ladder/i.test(l.name)).map(l => `${l.name}@${l.x},${l.y} ${l.ops}`).join('; ')})`); return false; }
        const op = st.ops.find(o => /^climb-up$/i.test(o)) ?? st.ops.find(o => /^climb$/i.test(o));
        const z0 = bot.s.z;
        await bot.act({ type: 'scenery', x: st.x, y: st.y, id: st.id, op });
        await bot.waitIdle({ timeout: 12, cond: x => x.z > z0 });
        await bot.handleInterrupts({ answer: /climb up/i });
    }
    return bot.s.z >= z;
}
async function downTower(bot) {
    for (let i = 0; i < 6 && (await bot.state(12)).z > 0; i++) {
        const st = bot.nearestScenery(l => /stair|ladder/i.test(l.name) && l.ops.some(o => /^climb(-down)?$/i.test(o)));
        if (!st) break;
        const op = st.ops.find(o => /^climb-down$/i.test(o)) ?? st.ops.find(o => /^climb$/i.test(o));
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
async function huntBeads(bot, minutes = Number(process.env.IMP_MINUTES ?? 25)) {
    const end = Date.now() + minutes * 60_000;
    let fights = 0;
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
        if (!imp) {
            // imps wander and are few: look for the nearest one around (outside the danger zones) and go there
            const found = await fetch(`http://127.0.0.1:8899/find?name=Imp&x=${s.x}&y=${s.y}&z=0&r=80`).then(r => r.json()).catch(() => null);
            const safe = (found?.npcs ?? []).filter(n => n.name === 'Imp' && !DANGER.some(d => dist(n, d) <= d.r + 4) && n.x > 3120).sort((a, b) => dist(s, a) - dist(s, b))[0];
            at = safe ?? IMP_GROUNDS[Math.floor(Math.random() * IMP_GROUNDS.length)];
            await bot.travel(at.x, at.y, { tol: 3 });
            continue;
        }
        await bot.act({ type: 'npc', npc: imp.npc, op: 'Attack' });
        fights++;
        await bot.wait(3); // let the fight start before waiting for it to end
        await bot.waitIdle({ timeout: 25, quiet: 3, cond: st => !st.attacking && !st.inCombat });
        await bot.wait(2); // the drop lands a tick later
    }
    bot.log(`quest: beads ${BEADS.filter(b => count(bot, b)).join(', ') || 'none'} after ${fights} imp fights`);
    return BEADS.every(b => count(bot, b));
}

// Druidic Ritual (Taverley): Kaqemeex at the stone circle, Sanfew upstairs in the village (ladder 2898,3428), four
// raw meats dipped in the Cauldron of Thunder deep in Taverley Dungeon, behind a gate two suits of armour (level 19)
// guard. For bots with combat 25+.
const DR = { kaqemeex: { x: 2925, y: 3486 }, sanfewLadder: { x: 2898, y: 3427 }, dungeonLadder: { x: 2884, y: 3398 }, gate: { x: 2888, y: 9830 }, cauldron: { x: 2893, y: 9831 } };
const DR_ANSWERS = /in search of a quest|ok, i will try and help|sent to help purify the varrock stone circle/i;
const MEATS = { 'Raw beef': ['Cow', { x: 3257, y: 3263 }], 'Raw rat meat': ['Giant rat', { x: 3180, y: 3190 }], 'Raw chicken': ['Chicken', { x: 3187, y: 3279 }], 'Raw bear meat': ['Black bear', { x: 2960, y: 3450 }] };
async function killFor(bot, npcName, item, at, n = 1) {
    if (!(await bot.travel(at.x, at.y, { tol: 5 }))) bot.log(`quest: couldn't reach the ${npcName}s at ${at.x},${at.y} (at ${bot.s.x},${bot.s.y})`);
    const until = Date.now() + 6 * 60_000; // by time, not tries: a weak bot's fight takes many waits
    while (Date.now() < until && count(bot, item) < n) {
        const s = await bot.state(12);
        if (await bot.handleInterrupts()) continue;
        const drop = s.ground.find(g => g.name === item && g.dist <= 8);
        if (drop && s.invFree > 0) { await bot.act({ type: 'ground', x: drop.x, y: drop.y, id: drop.id }); await bot.waitIdle({ timeout: 10 }); continue; }
        if (s.attacking || s.inCombat) { await bot.wait(2); continue; }
        const t = bot.nearestNpc(x => x.name === npcName && x.ops.includes('Attack') && !x.inCombat);
        if (!t) { await bot.walkTo(at.x + Math.floor(Math.random() * 9) - 4, at.y + Math.floor(Math.random() * 9) - 4, { tol: 2 }); continue; }
        await bot.act({ type: 'npc', npc: t.npc, op: 'Attack' });
        await bot.waitIdle({ timeout: 40, quiet: 3, cond: st => !st.attacking && !st.inCombat });
        await bot.wait(2); // the drop lands a tick later
    }
    if (count(bot, item) < n) bot.log(`quest: no ${item} from ${npcName} (at ${bot.s.x},${bot.s.y}; in view: ${bot.s.npcs.filter(x => x.name === npcName).map(x => `${x.x},${x.y}${x.inCombat ? ' busy' : ''}`).join(' ') || 'none'})`);
    return count(bot, item) >= n;
}
async function toSanfew(bot) {
    if (bot.s.z !== 1) {
        await bot.travel(DR.sanfewLadder.x, DR.sanfewLadder.y, { tol: 2 });
        await bot.state(8);
        await climb(bot, 'Climb-up', 1);
    }
    if (bot.s.z !== 1) { bot.log('quest: could not get up to Sanfew'); return false; }
    await bot.talkTo('Sanfew', { answer: DR_ANSWERS, maxSteps: 60 });
    await bot.state(8);
    await climb(bot, 'Climb-down', 0);
    return true;
}
async function cauldronRun(bot) {
    bot.standGround = true; // skeletons and spiders on the way: fight them, don't run deeper in
    try { return await cauldronRunInner(bot); } finally { bot.standGround = false; }
}
async function cauldronRunInner(bot) {
    // down the ladder, north to the gate, deal with the armour, dip the meats, come back up
    await bot.travel(DR.dungeonLadder.x, DR.dungeonLadder.y, { tol: 2 });
    await bot.state(8);
    const lad = bot.nearestScenery(l => /ladder/i.test(l.name) && l.ops.includes('Climb-down'));
    if (!lad) { bot.log('quest: no ladder into Taverley Dungeon'); return false; }
    await bot.act({ type: 'scenery', x: lad.x, y: lad.y, id: lad.id, op: 'Climb-down' });
    await bot.waitIdle({ timeout: 12, cond: x => x.y > 9000 });
    if ((await bot.state(10)).y < 9000) return false;
    await bot.walkTo(DR.gate.x - 1, DR.gate.y, { tol: 1, timeout: 240, direct: true });
    for (let i = 0; i < 12 && (await bot.state(12)).x < DR.gate.x + 1; i++) {
        if (await bot.handleInterrupts()) continue;
        const suit = bot.s.npcs.find(n => /suit of armour/i.test(n.name) && n.ops.includes('Attack') && n.dist <= 8);
        if (suit) { await bot.act({ type: 'npc', npc: suit.npc, op: 'Attack' }); await bot.waitIdle({ timeout: 60, quiet: 3, cond: st => !st.attacking && !st.inCombat }); continue; }
        const near = l => /gate|door/i.test(l.name) && Math.abs(l.x - DR.gate.x) <= 1 && Math.abs(l.y - DR.gate.y) <= 1; // a pair of doors (31841/31844) here
        if (bot.s.scenery.some(l => near(l) && l.ops.includes('Close'))) { await bot.walkTo(DR.gate.x + 2, DR.gate.y, { tol: 0, timeout: 20, direct: true }); continue; } // open: walk through
        const gate = bot.nearestScenery(l => near(l) && l.ops.includes('Open'));
        if (!gate) { await bot.walkTo(DR.gate.x - 1, DR.gate.y, { tol: 1, timeout: 30, direct: true }); continue; }
        await bot.act({ type: 'scenery', x: gate.x, y: gate.y, id: gate.id, op: 'Open' });
        await bot.waitIdle({ timeout: 8, quiet: 2 });
    }
    if (bot.s.x < DR.gate.x + 1) { bot.log(`quest: could not get through to the cauldron (at ${bot.s.x},${bot.s.y}; ${bot.s.scenery.filter(l => /gate|door/i.test(l.name) && l.dist <= 4).map(l => `${l.name}@${l.x},${l.y} ${l.ops}`).join('; ')})`); return false; }
    await bot.walkTo(DR.cauldron.x - 1, DR.cauldron.y, { tol: 1, timeout: 30, direct: true });
    for (const meat of Object.keys(MEATS)) {
        // the Cauldron of Thunder (2142) has no options, so older servers leave it out of the state: try where it stands
        const c = (await bot.state(8), bot.nearestScenery(l => /cauldron/i.test(l.name))) ?? { name: 'Cauldron of Thunder', id: 2142, ...DR.cauldron };
        if (!count(bot, meat)) continue;
        const m0 = bot.msgs.length;
        let r = await bot.act({ type: 'useitem', item: meat, x: c.x, y: c.y, id: c.id }).catch(e => `error ${e.message}`);
        if (/error/.test(r)) for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, 1]]) { // not quite where we thought
            r = await bot.act({ type: 'useitem', item: meat, x: c.x + dx, y: c.y + dy, id: 2142 }).catch(e => `error ${e.message}`);
            if (!/error/.test(r)) { DR.cauldron = { x: c.x + dx, y: c.y + dy }; break; }
        }
        await bot.waitIdle({ timeout: 8, quiet: 2 });
        bot.log(`quest: ${meat} on the ${c.name} (${c.x},${c.y}): ${r} ${bot.msgs.slice(m0).join(' | ')}`);
    }
    const enchanted = (await bot.state(3)).inv.filter(i => /^Enchanted/.test(i.name)).length;
    bot.log(`quest: ${enchanted} enchanted meats`);
    // back out the way we came (the gate opens from this side without a fight)
    for (let i = 0; i < 4 && (await bot.state(10)).x > DR.gate.x; i++) {
        const gate = bot.nearestScenery(l => /gate|door/i.test(l.name) && l.ops.includes('Open') && Math.abs(l.x - DR.gate.x) <= 1 && Math.abs(l.y - DR.gate.y) <= 1);
        if (gate) { await bot.act({ type: 'scenery', x: gate.x, y: gate.y, id: gate.id, op: 'Open' }); await bot.waitIdle({ timeout: 8, quiet: 2 }); }
    }
    await bot.walkTo(DR.dungeonLadder.x, DR.dungeonLadder.y + 6400, { tol: 2, timeout: 240, direct: true });
    const up = (await bot.state(8), bot.nearestScenery(l => /ladder/i.test(l.name) && l.ops.includes('Climb-up')));
    if (up) { await bot.act({ type: 'scenery', x: up.x, y: up.y, id: up.id, op: 'Climb-up' }); await bot.waitIdle({ timeout: 12, cond: x => x.y < 9000 }); }
    return enchanted >= 4;
}

// ---- Doric's Quest (north of Falador): 6 clay, 4 copper ore, 2 iron ore (Mining 15 for the iron). Rimmington mine has
// all three and nothing aggressive; whatever is banked already is taken from the bank first.
const DORIC = { x: 2952, y: 3449 }, RIMMINGTON = { x: 2981, y: 3238 };
const DORIC_ANSWERS = /^I wanted to use your anvils\.?$|^Yes,? I will get you the materials|^Certainly,? I'll be right back/i;
const DORIC_WANTS = { Clay: 6, 'Copper ore': 4, 'Iron ore': 2 };
const ORE_ROCKS = { Clay: [9711, 9712, 9713, 15503, 15504, 15505, 11189, 11190, 11191], 'Copper ore': [9708, 9709, 9710, 11936, 11937, 11938], 'Iron ore': [9717, 9718, 9719, 11954, 11955, 11956] };
const PICKAXES = ['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe', 'Mithril pickaxe', 'Adamant pickaxe', 'Rune pickaxe'];
async function gatherForDoric(bot) {
    const short = () => Object.entries(DORIC_WANTS).filter(([item, n]) => count(bot, item) < n);
    if (!short().length) return true;
    if (await bot.openBank()) {
        // room for the ores, and anything already banked
        await bot.depositAll(i => !PICKAXES.includes(i.name) && !FOOD.includes(i.name) && !(i.name in DORIC_WANTS) && i.name !== 'Coins');
        for (const [item, n] of short()) if ((bot.s.bank ?? []).some(b => b.name === item)) await bot.withdrawN(item, n - count(bot, item));
        if (!PICKAXES.some(p => bot.has(p))) { const p = PICKAXES.find(p => (bot.s.bank ?? []).some(b => b.name === p)); if (p) await bot.withdraw(p, 1); }
        await bot.leaveBank();
    }
    if (!short().length) return true;
    if (!PICKAXES.some(p => bot.has(p))) { bot.log("quest: no pickaxe for Doric's ores"); return false; }
    bot.log(`quest: mining for Doric at Rimmington: ${short().map(([i, n]) => `${n - count(bot, i)} ${i}`).join(', ')}`);
    if (!(await bot.travel(RIMMINGTON.x, RIMMINGTON.y, { tol: 4 }))) return false;
    const until = Date.now() + 20 * 60_000;
    while (Date.now() < until && short().length) {
        const st = await bot.state(12);
        if (await bot.handleInterrupts()) continue;
        if (st.invFree < 1) { bot.log('quest: bag full before the ores were in'); return false; }
        const ids = short().flatMap(([item]) => item === 'Iron ore' && bot.lvl('mining') < 15 ? [] : ORE_ROCKS[item]);
        const rock = bot.nearestScenery(l => l.ops.includes('Mine') && ids.includes(l.id));
        if (!rock) { await bot.wait(5); continue; } // mined out: they grow back
        const before = st.inv.length;
        await bot.act({ type: 'scenery', x: rock.x, y: rock.y, id: rock.id, op: 'Mine' }).catch(() => {});
        await bot.waitIdle({ timeout: 40, quiet: 4, cond: x => x.inv.length > before });
    }
    return !short().length;
}

// ---- The Restless Ghost (Lumbridge): Father Aereck (church) -> Father Urhney (swamp) for the Ghostspeak amulet ->
// wear it, open the coffin in the graveyard and talk to the ghost -> the skull from the altar in the Wizards' Tower
// basement (a level-13 skeleton wakes up) -> the skull into the coffin. 1,125 Prayer xp.
const RG = { aereck: { x: 3243, y: 3207 }, urhney: { x: 3147, y: 3174 }, coffin: { x: 3249, y: 3193 }, towerLadder: { x: 3105, y: 3162 }, altar: { x: 3120, y: 9566 } };
const RG_ANSWERS = /^I'm looking for a quest\.?$|^Ok, let me help then\.?$|^Father Aereck sent me to talk to you\.?$/i;
async function rgOpenCoffin(bot) {
    await bot.travel(RG.coffin.x, RG.coffin.y + 1, { tol: 2 });
    await bot.state(8);
    const closed = bot.nearestScenery(l => l.id === 2145 && l.ops.includes('Open'));
    if (closed) { await bot.act({ type: 'scenery', x: closed.x, y: closed.y, id: closed.id, op: 'Open' }); await bot.wait(3); await bot.state(8); }
    return bot.nearestScenery(l => /coffin/i.test(l.name) && l.id !== 2145) ?? { x: 3249, y: 3192, id: 15061 };
}
async function rgLeaveBasement(bot) {
    for (let t = 0; t < 3 && bot.s.y > 9000; t++) { // back to the ladder (3104,9576), through the basement's doors, and up
        await bot.walkTo(3105, 9575, { tol: 2, timeout: 90 });
        const up = (await bot.state(10), bot.nearestScenery(l => /ladder/i.test(l.name) && l.ops.some(o => /climb-up/i.test(o))));
        if (up) { await bot.act({ type: 'scenery', x: up.x, y: up.y, id: up.id, op: 'Climb-up' }).catch(() => {}); await bot.waitIdle({ timeout: 15, cond: x => x.y < 9000 }); }
    }
}
async function rgSkull(bot) {
    if (count(bot, 'Skull')) return true;
    const inBasement = () => bot.s.y > 9000 && Math.abs(bot.s.x - RG.altar.x) < 30;
    for (let t = 0; t < 3 && !inBasement(); t++) { // the tower's doors can get in the way of the first try
        await bot.travel(RG.towerLadder.x + 1, RG.towerLadder.y, { tol: 2 });
        await bot.state(8);
        const down = bot.nearestScenery(l => /ladder/i.test(l.name) && l.ops.some(o => /climb-down/i.test(o)));
        if (!down) { bot.log("quest: can't find the Wizards' Tower ladder down"); continue; }
        await bot.act({ type: 'scenery', x: down.x, y: down.y, id: down.id, op: 'Climb-down' }).catch(() => {});
        await bot.waitIdle({ timeout: 15, cond: x => x.y > 9000 });
        await bot.state(8);
    }
    if (!inBasement()) { bot.log("quest: couldn't get down to the Wizards' Tower basement"); return false; }
    bot.standGround = true; // the skeleton that wakes up: fight it rather than run in a basement
    try {
        await bot.walkTo(RG.altar.x, RG.altar.y + 1, { tol: 2, timeout: 60 });
        await bot.state(10);
        const altar = bot.nearestScenery(l => [15050, 15051].includes(l.id) || (/altar/i.test(l.name) && l.ops.some(o => /search/i.test(o))));
        if (!altar) { bot.log('quest: no altar in the basement'); return false; }
        await bot.act({ type: 'scenery', x: altar.x, y: altar.y, id: altar.id, op: altar.ops.find(o => /search/i.test(o)) ?? 'Search' });
        await bot.waitIdle({ timeout: 10, cond: x => x.inv.some(i => i.name === 'Skull') });
        for (let i = 0; i < 20 && (await bot.state(8)).inCombat; i++) await bot.handleInterrupts(); // deal with the skeleton
        await rgLeaveBasement(bot);
    } finally { bot.standGround = false; }
    return count(bot, 'Skull') > 0;
}

// ---- Witch's Potion (Rimmington): Hetty wants an onion (the field north of Rimmington), an eye of newt (Betty, Port
// Sarim), burnt meat (cook raw beef (cows south of Falador) on the range next door, then cook it again: the server burns cooked meat on purpose) and
// a rat's tail (the rats round her house drop them once the quest is started); then drink from her cauldron.
const WP = { hetty: { x: 2968, y: 3207 }, onions: { x: 2948, y: 3251 }, rats: { x: 2960, y: 3205 }, cows: { x: 3032, y: 3305 }, range: { x: 2970, y: 3209 } };
const WP_ANSWERS = /^I am in search of a quest\.?$|^Yes,? help me become one with my darker side\.?$/i;
async function wpCookAtRange(bot, item) {
    const it = bot.s.inv.find(i => i.name === item);
    if (!it) return;
    await bot.travel(WP.range.x - 1, WP.range.y, { tol: 2 });
    await bot.act({ type: 'useitem', slot: it.slot, x: WP.range.x, y: WP.range.y }).catch(() => {});
    for (let i = 0; i < 6; i++) { const st = await bot.state(4); if (st.dialog?.skillMenu) { await bot.act({ type: 'skillmenu', index: 0 }); break; } if (st.dialog) { await bot.answerDialog(/^Cook the meat/i); /* raw beef also offers 'Dry the meat into sinew' */ } await bot.wait(1); }
    await bot.waitIdle({ timeout: 10, quiet: 3 });
}
async function wpIngredients(bot) {
    await bot.ensureFood(4).catch(() => {}); // something else to eat, so the quest meat doesn't get eaten
    if (await bot.openBank()) {
        for (const item of ['Onion', 'Eye of newt', 'Burnt meat', "Rat's tail", 'Cooked meat', 'Raw beef', 'Raw rat meat'])
            if (!count(bot, item) && (bot.s.bank ?? []).some(b => b.name === item) && !(['Cooked meat', 'Raw beef', 'Raw rat meat'].includes(item) && (count(bot, 'Burnt meat') || count(bot, 'Cooked meat') || count(bot, 'Raw beef') || count(bot, 'Raw rat meat'))))
                await bot.withdraw(item, 1);
        if (!count(bot, 'Eye of newt') && (bot.s.coins ?? 0) < 10 && (bot.s.bank ?? []).some(b => b.name === 'Coins')) await bot.withdrawN('Coins', 50);
        await bot.leaveBank();
    }
    if (!count(bot, 'Eye of newt')) { if (await bot.openShop(SHOPS.betty)) { await bot.buy('Eye of newt', 1); await bot.closeInterfaces(); } }
    if (!count(bot, 'Onion')) {
        await bot.travel(WP.onions.x, WP.onions.y, { tol: 3 });
        for (let i = 0; i < 4 && !count(bot, 'Onion'); i++) {
            await bot.state(8);
            const onion = bot.nearestScenery(l => l.name === 'Onion' && l.ops.includes('Pick'));
            if (!onion) { await bot.wait(5); continue; }
            await bot.act({ type: 'scenery', x: onion.x, y: onion.y, id: onion.id, op: 'Pick' });
            await bot.waitIdle({ timeout: 8, cond: x => x.inv.some(i => i.name === 'Onion') });
        }
    }
    if (!count(bot, 'Burnt meat')) {
        if (!count(bot, 'Cooked meat') && !count(bot, 'Raw beef') && !count(bot, 'Raw rat meat')) await killFor(bot, 'Cow', 'Raw beef', WP.cows, 1); // the cows south of Falador: giant rats killed a combat-3 bot
        for (let i = 0; i < 4 && !count(bot, 'Burnt meat'); i++) {
            const meat = ['Raw rat meat', 'Raw beef', 'Cooked meat'].find(m => count(bot, m));
            if (!meat) break;
            await wpCookAtRange(bot, meat); // raw -> cooked (or burnt), cooked -> burnt
        }
    }
    if (!count(bot, "Rat's tail")) await killFor(bot, 'Rat', "Rat's tail", WP.rats, 1);
    const missing = ['Onion', 'Eye of newt', 'Burnt meat', "Rat's tail"].filter(i => !count(bot, i));
    if (missing.length) bot.log(`quest: Witch's Potion still needs ${missing.join(', ')}`);
    return !missing.length;
}

// ---- Vampire Slayer: Morgan (Draynor) -> Dr Harlow in the Blue Moon Inn (Varrock) wants a beer (2gp from its bartender)
// and gives a stake -> a hammer (general store) -> Draynor Manor: the stairs down by the east room (3115,3357), open the
// coffin and kill Count Draynor (level 34) with the stake and hammer in the bag. Combat 30+, with food. 4,825 Attack xp.
const VS = { morgan: { x: 3099, y: 3267 }, harlow: { x: 3222, y: 3397 }, bar: { x: 3225, y: 3399 }, manorDoor: { x: 3108, y: 3352 }, stairs: { x: 3115, y: 3357 } };
const VS_ANSWERS = /^Ok, I'm up for an adventure\.?$|^Morgan needs your help!?$|^Yes please!?$|^A glass of your finest ale please\.?$/i;
// garlic from the cupboard upstairs in Morgan's house: without it the Count heals up to 12 at a time and a combat-46
// bot can't out-damage him (2026-11-09: five minutes, no kill)
async function vsGarlic(bot) {
    if (count(bot, 'Garlic')) return true;
    await bot.travel(3099, 3267, { tol: 1 });
    await bot.state(8);
    const up = bot.nearestScenery(l => /staircase/i.test(l.name) && l.ops.includes('Climb-up'));
    if (up) { await bot.act({ type: 'scenery', x: up.x, y: up.y, id: up.id, op: 'Climb-up' }); await bot.waitIdle({ timeout: 10, cond: x => x.z === 1 }); }
    if ((await bot.state(8)).z === 1) {
        const c = bot.nearestScenery(l => l.id === 33502 || (/cupboard/i.test(l.name) && l.ops.includes('Open')));
        if (c) { await bot.act({ type: 'scenery', x: c.x, y: c.y, id: c.id, op: c.ops.find(o => /open|search/i.test(o)) ?? 'Open' }); await bot.waitIdle({ timeout: 10, cond: x => x.inv.some(i => i.name === 'Garlic') }); }
        const down = (await bot.state(8), bot.nearestScenery(l => /staircase/i.test(l.name) && l.ops.includes('Climb-down')));
        if (down) { await bot.act({ type: 'scenery', x: down.x, y: down.y, id: down.id, op: 'Climb-down' }); await bot.waitIdle({ timeout: 10, cond: x => x.z === 0 }); }
    }
    return count(bot, 'Garlic') > 0;
}
async function vsKillCount(bot) {
    await bot.ensureFood(10).catch(() => {});
    if (!bot.has('Hammer')) { if (await bot.openShop(SHOPS.general)) { await bot.buy('Hammer', 1); await bot.closeInterfaces(); } }
    if (!bot.has('Hammer') || !count(bot, 'Stake')) { bot.log('quest: Vampire Slayer needs a stake and a hammer'); return false; }
    // inside the manor or its basement without garlic: the front doors don't open from inside, so teleport out
    const inManor = b => (b.s.y > 9000 && Math.abs(b.s.x - 3077) < 20) || (b.s.x >= 3091 && b.s.x <= 3126 && b.s.y >= 3350 && b.s.y <= 3375);
    if (!count(bot, 'Garlic') && inManor(bot)) await bot.homeTeleport();
    if (bot.s.y < 9000 && !(await vsGarlic(bot))) bot.log("quest: no garlic from Morgan's cupboard; trying the Count anyway");
    if (bot.s.y < 9000) {
        await bot.travel(VS.manorDoor.x, VS.manorDoor.y - 2, { tol: 2 });
        for (let t = 0; t < 3 && bot.s.y < 9000; t++) {
            await bot.travel(VS.stairs.x, VS.stairs.y - 1, { tol: 1, timeout: 180 }); // the stairs room is reached round the north side: a planned route
            await bot.state(10);
            const st = bot.nearestScenery(l => l.id === 32835 || (/stairs/i.test(l.name) && l.ops.includes('Walk-down')));
            if (!st) { bot.log("quest: can't find the manor's stairs down"); continue; }
            await bot.act({ type: 'scenery', x: st.x, y: st.y, id: st.id, op: 'Walk-down' }).catch(() => {});
            await bot.waitIdle({ timeout: 15, cond: x => x.y > 9000 });
            await bot.state(8);
        }
        if (bot.s.y < 9000) { bot.log("quest: couldn't get down to the manor basement"); return false; }
    }
    bot.standGround = true;
    try {
        const coffin = (await bot.state(14), bot.nearestScenery(l => l.id === 2614 || /coffin/i.test(l.name))); // fresh view: the basement was just entered
        if (!coffin) { bot.log('quest: no coffin in the manor basement'); return false; }
        const before = new Set(bot.s.npcs.filter(n => /count draynor/i.test(n.name)).map(n => n.npc));
        await bot.act({ type: 'scenery', x: coffin.x, y: coffin.y, id: coffin.id, op: 'Open' });
        await bot.wait(3);
        let mine = (await bot.state(14)).npcs.find(n => /count draynor/i.test(n.name) && !before.has(n.npc))?.npc; // the one this coffin opening woke
        if (mine === undefined) { // the coffin woke nobody new (this session's Count is already up): find the one that takes our attack
            for (const n of bot.s.npcs.filter(n => /count draynor/i.test(n.name))) {
                await bot.act({ type: 'npc', npc: n.npc, op: 'Attack' }).catch(() => {});
                await bot.wait(4);
                if ((await bot.state(10)).attacking) { mine = n.npc; break; }
            }
        }
        const until = Date.now() + 5 * 60_000;
        while (Date.now() < until && stageOf(bot, 'Vampire Slayer') < 100) {
            const s = await bot.state(8);
            if (!s?.online) { bot.log('quest: went offline in the manor basement'); return false; }
            const food = s.inv.find(i => FOOD.includes(i.name) && i.ops.includes('Eat'));
            if (s.hp <= s.maxHp * 0.45 && food) { await bot.act({ type: 'item', slot: food.slot, op: 'Eat' }); await sleep(1500); continue; }
            if (s.hp < s.maxHp * 0.3 && !food) { bot.log('quest: out of food against the Count, backing off'); break; }
            // the Count this coffin opening woke: Counts left from earlier sessions still name this bot as their target but
            // only take hits from the session that summoned them (and NPC indices get reused, so "newest" can't be told by index)
            const count_ = s.npcs.find(n => n.npc === mine) ?? s.npcs.find(n => /count draynor/i.test(n.name) && !before.has(n.npc));
            if (count_) mine = count_.npc;
            if (count_ && !s.attacking) await bot.act({ type: 'npc', npc: count_.npc, op: 'Attack' }).catch(() => {});
            await sleep(1500);
        }
    } finally { bot.standGround = false; }
    // out of the manor: its front doors don't open from inside, so teleport home from the basement once the fight is over
    if (!(await bot.homeTeleport())) {
        const up = bot.nearestScenery(l => /stairs/i.test(l.name) && l.ops.some(o => /walk-up/i.test(o)));
        if (up) { await bot.act({ type: 'scenery', x: up.x, y: up.y, id: up.id, op: up.ops.find(o => /walk-up/i.test(o)) }); await bot.waitIdle({ timeout: 12, cond: x => x.y < 9000 }); }
    }
    return stageOf(bot, 'Vampire Slayer') >= 100;
}

// ---- Goblin Diplomacy (Goblin Village, north of Falador): three goblin mails from the village crates (each refills after
// ~5 minutes), one dyed orange (red dye from 3 redberries + yellow from 2 onions, mixed), one blue (2 woad leaves from
// Wyson in Falador park, 15gp each), one left brown. Aggie in Draynor makes each dye for 5gp. Shown to the generals in turn.
const GD = { generals: { x: 2956, y: 3511 }, aggie: { x: 3085, y: 3260 }, wyson: { x: 3021, y: 3375 }, redberries: { x: 3274, y: 3373 }, onions: { x: 2948, y: 3251 } };
const GD_ANSWERS = /^Do you want me to pick an armour colour for you\?$|^I have some \w+ armour here\.?$/i;
async function pickN(bot, at, name, op, item, n) {
    await bot.travel(at.x, at.y, { tol: 3 });
    for (let i = 0; i < 12 && count(bot, item) < n; i++) {
        await bot.state(8);
        const t = bot.nearestScenery(l => l.name === name && l.ops.includes(op));
        if (!t) { await bot.wait(8); continue; } // picked clean: they grow back
        await bot.act({ type: 'scenery', x: t.x, y: t.y, id: t.id, op });
        await bot.waitIdle({ timeout: 8, quiet: 2 });
    }
    return count(bot, item) >= n;
}
async function aggieDye(bot, colour) {
    await bot.travel(GD.aggie.x, GD.aggie.y, { tol: 2 });
    await bot.talkTo('Aggie', { answer: new RegExp(`^Can you make dyes for me please\\?$|^What do you need to make (a )?${colour} dye\\?$`, 'i'), maxSteps: 20 });
    await bot.state(4);
}
async function gdDyes(bot) {
    const has = n => count(bot, n) > 0;
    if (!has('Orange goblin mail') && !has('Orange dye')) {
        if (!has('Red dye')) { if (count(bot, 'Redberries') < 3) await pickN(bot, GD.redberries, 'Redberry bush', 'Pick-from', 'Redberries', 3); await aggieDye(bot, 'red'); }
        if (!has('Yellow dye')) { if (count(bot, 'Onion') < 2) await pickN(bot, GD.onions, 'Onion', 'Pick', 'Onion', 2); await aggieDye(bot, 'yellow'); }
        const red = bot.s.inv.find(i => i.name === 'Red dye'), yellow = bot.s.inv.find(i => i.name === 'Yellow dye');
        if (red && yellow) { await bot.act({ type: 'useitem', slot: red.slot, onSlot: yellow.slot }); await bot.wait(2); await bot.state(4); }
    }
    if (!has('Blue goblin mail') && !has('Blue dye')) {
        for (let i = 0; i < 3 && count(bot, 'Woad leaf') < 2; i++) {
            await bot.travel(GD.wyson.x, GD.wyson.y, { tol: 3 });
            await bot.talkTo('Wyson the gardener', { answer: /^Yes please, I need woad leaves\.?$|^How about 15 coins\?$/i, maxSteps: 20 });
            await bot.state(4);
        }
        await aggieDye(bot, 'blue');
    }
    const missing = [!has('Orange goblin mail') && !has('Orange dye') && 'orange dye', !has('Blue goblin mail') && !has('Blue dye') && 'blue dye'].filter(Boolean);
    if (missing.length) bot.log(`quest: Goblin Diplomacy still needs ${missing.join(' and ')}`);
    return !missing.length;
}
async function gdMails(bot) {
    const mails = () => count(bot, 'Goblin mail') + count(bot, 'Orange goblin mail') + count(bot, 'Blue goblin mail');
    const until = Date.now() + 12 * 60_000;
    while (mails() < 3 && Date.now() < until) {
        await bot.travel(GD.generals.x, GD.generals.y - 3, { tol: 3 });
        for (const id of [16560, 16559, 16557, 16561]) {
            if (mails() >= 3) break;
            const c = (await bot.state(14), bot.nearestScenery(l => l.id === id && l.ops.includes('Search')));
            if (!c) continue;
            await bot.act({ type: 'scenery', x: c.x, y: c.y, id: c.id, op: 'Search' });
            await bot.waitIdle({ timeout: 8, quiet: 2 });
            await bot.answerDialog();
        }
        if (mails() < 3) { bot.log(`quest: ${mails()} goblin mails; the crates refill in a few minutes`); await bot.wait(60); }
    }
    return mails() >= 3;
}
async function gdDyeMail(bot, dye) {
    const d = bot.s.inv.find(i => i.name === dye), m = bot.s.inv.find(i => i.name === 'Goblin mail');
    if (d && m) { await bot.act({ type: 'useitem', slot: d.slot, onSlot: m.slot }); await bot.wait(2); await bot.state(4); }
}

// The Knight's Sword (Falador): the Squire, Reldo in Varrock's library, a redberry pie from Romily in the Cooks'
// Guild (Cooking 32 and a chef's hat worn) for Thurgo south of Port Sarim, the portrait in Sir Vyvin's cupboard
// (Falador castle, top floor), and blurite from the Asgarnian Ice Dungeon (ice warriors) plus 2 iron bars.
// For bots with combat 45+.
const KS = { squire: { x: 2974, y: 3342 }, reldo: { x: 3209, y: 3494 }, guild: { x: 3143, y: 3445 }, romily: { x: 3139, y: 3446 }, thurgo: { x: 3001, y: 3145 },
    castle: { x: 2965, y: 3340 }, cupboard: { x: 2984, y: 3336 }, trapdoor: { x: 3008, y: 3151 } };
const KS_ANSWERS = /^something else\.?$|life as a squire|i can make a new sword|would these dwarves make another|ok, i'll give it a go|imcando dwarves\?|would you like some redberry pie|can you make me a special sword|^yes, please/i;
async function ksTalk(bot, name, at) {
    if (bot.s.z !== 0 || dist(bot.s, at) > 6) await bot.travel(at.x, at.y, { tol: 3 });
    await bot.talkTo(name, { answer: KS_ANSWERS, maxSteps: 60 });
    await bot.state(5);
}
async function buyRedberryPie(bot) {
    if (count(bot, 'Redberry pie')) return true;
    // the guild wants a chef's hat on the head: swap it in for the helmet, and back after
    const hat = bot.s.inv.find(i => i.name === "Chef's hat");
    if (!hat && !bot.s.worn.some(i => i.name === "Chef's hat")) { bot.log("quest: no chef's hat for the Cooks' Guild"); return false; }
    if (hat) { await bot.act({ type: 'item', slot: hat.slot, op: hat.ops.find(o => /wear/i.test(o)) ?? 'Wear' }); await bot.wait(2); }
    await bot.travel(KS.guild.x, KS.guild.y + 4, { tol: 2 });
    const shop = await bot.openShop({ x: KS.romily.x, y: KS.romily.y, npcs: ['Romily Weaklax'] });
    if (shop) { await bot.buy('Redberry pie', 1); await bot.closeInterfaces(); }
    await bot.walkTo(KS.guild.x, KS.guild.y + 6, { tol: 2 });
    await bot.gearUp().catch(() => {});
    return count(bot, 'Redberry pie') > 0;
}
async function getPortrait(bot) {
    if (count(bot, 'Portrait')) return true;
    await bot.travel(KS.castle.x, KS.castle.y, { tol: 3 });
    for (let i = 0; i < 8 && (await bot.state(14)).z < 2; i++) {
        // stairs up on this floor (within 20 tiles), the one the shortest planned walk away (the castle's doors)
        const found = await fetch(`http://127.0.0.1:8899/find?name=Staircase&x=${bot.s.x}&y=${bot.s.y}&z=${bot.s.z}&r=20&bot=${bot.name}`).then(r => r.json()).catch(() => ({ scenery: [] }));
        let best = null;
        for (const st of found.scenery.filter(l => l.ops.some(o => /^climb(-up)?$/i.test(o)))) {
            const r = await fetch(`http://127.0.0.1:8899/route?from=${bot.s.x},${bot.s.y}&to=${st.x},${st.y}&z=${bot.s.z}`).then(r => r.json()).catch(() => null);
            if (r?.ok && (!best || r.length < best.r.length)) best = { st, r };
        }
        if (!best) { bot.log('quest: no way up Falador castle'); return false; }
        if (best.r.length > 2) { await bot.followRoute(best.r); await bot.state(10); }
        const up = bot.nearestScenery(l => l.x === best.st.x && l.y === best.st.y) ?? best.st;
        const z0 = bot.s.z;
        await bot.act({ type: 'scenery', x: up.x, y: up.y, id: up.id, op: up.ops.find(o => /^climb-up$/i.test(o)) ?? up.ops.find(o => /^climb$/i.test(o)) });
        await bot.waitIdle({ timeout: 12, cond: x => x.z > z0 });
        await bot.handleInterrupts({ answer: /climb up/i });
    }
    if (bot.s.z !== 2) return false;
    await bot.walkTo(KS.cupboard.x, KS.cupboard.y + 1, { tol: 1, timeout: 60, direct: true });
    for (let i = 0; i < 4 && !count(bot, 'Portrait'); i++) {
        const c = (await bot.state(6), bot.nearestScenery(l => /cupboard/i.test(l.name)));
        if (!c) break;
        const op = c.ops.find(o => /search/i.test(o)) ?? c.ops.find(o => /open/i.test(o));
        await bot.act({ type: 'scenery', x: c.x, y: c.y, id: c.id, op });
        await bot.wait(3);
        if (bot.s.dialog) await bot.act({ type: 'continue' }).catch(() => {});
        await bot.state(3);
    }
    await downTower(bot); // down the castle stairs, same as the tower's
    return count(bot, 'Portrait') > 0;
}
async function mineBlurite(bot) {
    if (count(bot, 'Blurite ore')) return true;
    const inDungeon = () => bot.s.y > 9000 && bot.s.x > 2980 && bot.s.x < 3080; // already in the ice dungeon: skip the trapdoor
    if (!inDungeon()) {
    await bot.ensureFood(12).catch(() => {}); // ice warriors and giants hit while it mines
    await bot.travel(KS.trapdoor.x, KS.trapdoor.y, { tol: 2 });
    const td = (await bot.state(8), bot.nearestScenery(l => /trapdoor/i.test(l.name)));
    if (!td) { bot.log('quest: no ice dungeon trapdoor'); return false; }
    await bot.act({ type: 'scenery', x: td.x, y: td.y, id: td.id, op: td.ops.find(o => /climb-down|open/i.test(o)) });
    await bot.waitIdle({ timeout: 12, cond: x => x.y > 9000 });
    if ((await bot.state(8)).y < 9000) { const t2 = bot.nearestScenery(l => /trapdoor/i.test(l.name) && l.ops.some(o => /climb-down/i.test(o))); if (t2) { await bot.act({ type: 'scenery', x: t2.x, y: t2.y, id: t2.id, op: 'Climb-down' }); await bot.waitIdle({ timeout: 12, cond: x => x.y > 9000 }); } }
    if (bot.s.y < 9000) return false;
    }
    bot.pressOn = true; // past the hobgoblins without stopping
    await bot.act({ type: 'retaliate', on: false }).catch(() => {}); // so their swings don't stop the mining
    try {
        // the blurite (3049,9566, more at 3059,9564) is round the long way through the cave: a planned route
        const r = await fetch(`http://127.0.0.1:8899/route?from=${bot.s.x},${bot.s.y}&to=3048,9567&z=0`).then(x => x.json()).catch(() => null);
        if (r?.ok) await bot.followRoute(r);
        else await bot.walkTo(3048, 9567, { tol: 2, timeout: 180, direct: true });
        await bot.state(12);
        // ice warriors and giants crowd the rock: with auto-retaliate off the bot keeps mining while they swing (as in
        // the real game; the server's CombatPulse was patched for it), so just mine, eat, and swing again if it stops
        const until = Date.now() + 8 * 60_000;
        let lastSwing = 0;
        while (Date.now() < until && !count(bot, 'Blurite ore')) {
            const st = await bot.state(12);
            if (st.dialog || st.randomEvent) { await bot.handleInterrupts(); continue; }
            const food = st.inv.find(i => FOOD.includes(i.name) && i.ops.includes('Eat'));
            if (st.hp <= st.maxHp * 0.5 && food) { await bot.act({ type: 'item', slot: food.slot, op: 'Eat' }); lastSwing = 0; await sleep(1200); continue; } // eating stops the swing
            if (st.hp < st.maxHp * 0.4 && !food) { bot.log('quest: out of food at the blurite, backing off'); break; }
            // mining runs as a script, which `busy` (pulses) doesn't show, and every click starts the swing over before its
            // first roll (4 ticks): swing once, then again only after 12 s or after eating
            if (st.moving || Date.now() - lastSwing < 12_000) { await sleep(600); continue; }
            const rock = bot.nearestScenery(l => [33220, 33221].includes(l.id) && l.ops.includes('Mine'));
            if (!rock) { await sleep(2000); continue; }
            await bot.act({ type: 'scenery', x: rock.x, y: rock.y, id: rock.id, op: 'Mine' }).catch(() => {});
            lastSwing = Date.now();
            await sleep(900);
        }
        if (count(bot, 'Blurite ore')) bot.log('quest: got the blurite');
        await bot.walkTo(3008, 9550, { tol: 3, timeout: 120, direct: true }); // back to the ladder (walkTo climbs out)
        await bot.walkTo(KS.trapdoor.x, KS.trapdoor.y, { tol: 3, timeout: 120 });
    } finally { bot.pressOn = false; await bot.act({ type: 'retaliate', on: true }).catch(() => {}); }
    return count(bot, 'Blurite ore') > 0;
}

// Ways to get one quest item (each returns true once the bot holds it). `n`: how many to get.
export const GATHER = {
    ...Object.fromEntries(Object.entries(MEATS).map(([item, [npc, at]]) => [item, (bot, n = 1) => killFor(bot, npc, item, at, n)])),
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
    dorics_quest: {
        name: "Doric's Quest",
        items: [],
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            if (bot.lvl('mining') < 15) { bot.log("quest: Doric's Quest waits for Mining 15 (the iron ore)"); return false; }
            await bot.travel(DORIC.x, DORIC.y + 1, { tol: 2 });
            await bot.talkTo('Doric', { answer: DORIC_ANSWERS, maxSteps: 30 });
            await bot.state(5);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 3 && stageOf(bot, this.name) < 100; i++) {
                if (!(await gatherForDoric(bot))) return false;
                await bot.travel(DORIC.x, DORIC.y + 1, { tol: 2 });
                await bot.talkTo('Doric', { answer: DORIC_ANSWERS, maxSteps: 30 });
                await bot.state(5);
            }
            return stageOf(bot, this.name) >= 100;
        }
    },
    restless_ghost: {
        name: 'The Restless Ghost',
        items: [],
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            await bot.travel(RG.aereck.x, RG.aereck.y, { tol: 3 });
            await bot.talkTo('Father Aereck', { answer: RG_ANSWERS, maxSteps: 30 });
            await bot.state(5);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 8 && stageOf(bot, this.name) < 100; i++) {
                const st = stageOf(bot, this.name);
                if (st === 10 || (st >= 20 && !count(bot, 'Ghostspeak amulet') && !bot.s.worn.some(w => w.name === 'Ghostspeak amulet'))) {
                    await bot.travel(RG.urhney.x, RG.urhney.y + 1, { tol: 2 });
                    await bot.talkTo('Father Urhney', { answer: RG_ANSWERS, maxSteps: 40 });
                } else if (st === 20) {
                    const am = bot.s.inv.find(i => i.name === 'Ghostspeak amulet');
                    if (am) { await bot.act({ type: 'item', slot: am.slot, op: 'Wear' }); await bot.wait(2); }
                    await rgOpenCoffin(bot);
                    await bot.wait(2);
                    await bot.talkTo('Restless ghost', { answer: RG_ANSWERS, maxSteps: 40 });
                } else if (st === 30) {
                    if (!(await rgSkull(bot))) return false;
                } else if (st === 40) {
                    if (!count(bot, 'Skull') && !(await rgSkull(bot))) return false;
                    if (bot.s.y > 9000) await rgLeaveBasement(bot);
                    const coffin = await rgOpenCoffin(bot);
                    const skull = bot.s.inv.find(i => i.name === 'Skull');
                    if (skull) { await bot.act({ type: 'useitem', slot: skull.slot, x: coffin.x, y: coffin.y }); await bot.wait(3); }
                } else break;
                await bot.state(5);
                bot.log(`quest: The Restless Ghost stage ${st} -> ${stageOf(bot, this.name)}`);
            }
            return stageOf(bot, this.name) >= 100;
        }
    },
    witchs_potion: {
        name: "Witch's Potion",
        items: [],
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            if ((bot.s.combat ?? 3) < 10) { bot.log("quest: Witch's Potion waits for combat 10 (the meat comes from a cow, and a combat-3 bot died to one)"); return false; }
            await bot.travel(WP.hetty.x, WP.hetty.y, { tol: 3 });
            await bot.talkTo('Hetty', { answer: WP_ANSWERS, maxSteps: 30 });
            await bot.state(5);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 4 && stageOf(bot, this.name) < 100; i++) {
                const st = stageOf(bot, this.name);
                if (st < 40) {
                    if (!(await wpIngredients(bot))) return false;
                    await bot.travel(WP.hetty.x, WP.hetty.y, { tol: 3 });
                    await bot.talkTo('Hetty', { answer: WP_ANSWERS, maxSteps: 30 });
                } else {
                    await bot.travel(WP.hetty.x, WP.hetty.y, { tol: 3 });
                    await bot.state(8);
                    const c = bot.nearestScenery(l => l.name === 'Cauldron' && l.ops.some(o => /drink/i.test(o)));
                    if (c) { await bot.act({ type: 'scenery', x: c.x, y: c.y, id: c.id, op: c.ops.find(o => /drink/i.test(o)) }); await bot.wait(4); await bot.answerDialog?.(); }
                }
                await bot.state(5);
                bot.log(`quest: Witch's Potion stage ${st} -> ${stageOf(bot, this.name)}`);
            }
            return stageOf(bot, this.name) >= 100;
        }
    },
    vampire_slayer: {
        name: 'Vampire Slayer',
        items: [],
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            if ((bot.s.combat ?? 3) < 30) { bot.log('quest: Vampire Slayer waits for combat 30 (Count Draynor is level 34)'); return false; }
            await bot.travel(VS.morgan.x, VS.morgan.y, { tol: 3 });
            await bot.talkTo('Morgan', { answer: VS_ANSWERS, maxSteps: 30 });
            await bot.state(5);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 5 && stageOf(bot, this.name) < 100; i++) {
                const st = stageOf(bot, this.name);
                if (st < 30) {
                    if (!count(bot, 'Beer')) {
                        await bot.travel(VS.bar.x, VS.bar.y, { tol: 2 });
                        await bot.talkTo('Bartender', { answer: VS_ANSWERS, maxSteps: 12 });
                    }
                    await bot.travel(VS.harlow.x, VS.harlow.y, { tol: 2 });
                    await bot.talkTo('Dr Harlow', { answer: VS_ANSWERS, maxSteps: 40 });
                } else if (!(await vsKillCount(bot))) return false;
                await bot.state(5);
                bot.log(`quest: Vampire Slayer stage ${st} -> ${stageOf(bot, this.name)}`);
            }
            return stageOf(bot, this.name) >= 100;
        }
    },
    goblin_diplomacy: {
        name: 'Goblin Diplomacy',
        items: [],
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            if ((bot.s.combat ?? 3) < 10) { bot.log('quest: Goblin Diplomacy waits for combat 10 (the goblins round the village)'); return false; }
            if ((bot.s.coins ?? 0) + ((bot.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0) < 60) { bot.log('quest: Goblin Diplomacy needs 60gp (woad leaves and dyes)'); return false; }
            await bot.travel(GD.generals.x, GD.generals.y - 1, { tol: 2 });
            await bot.talkTo('General Wartface', { answer: GD_ANSWERS, maxSteps: 60 });
            await bot.state(5);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 6 && stageOf(bot, this.name) < 100; i++) {
                const st = stageOf(bot, this.name);
                if ((bot.s.coins ?? 0) < 50 && (await bot.openBank())) { await bot.withdrawN('Coins', 100); await bot.leaveBank(); }
                if (!(await gdMails(bot))) return false;
                if (!(await gdDyes(bot))) return false;
                await gdDyeMail(bot, 'Orange dye');
                await gdDyeMail(bot, 'Blue dye');
                await bot.travel(GD.generals.x, GD.generals.y - 1, { tol: 2 });
                await bot.talkTo('General Wartface', { answer: GD_ANSWERS, maxSteps: 80 });
                await bot.state(5);
                bot.log(`quest: Goblin Diplomacy stage ${st} -> ${stageOf(bot, this.name)}`);
            }
            return stageOf(bot, this.name) >= 100;
        }
    },
    knights_sword: {
        name: "The Knight's Sword",
        items: [],
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            if ((bot.s.combat ?? 3) < 45 || bot.lvl('cooking') < 32 || bot.lvl('mining') < 10) { bot.log("quest: The Knight's Sword waits for combat 45, Cooking 32 and Mining 10"); return false; }
            await ksTalk(bot, 'Squire', KS.squire);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 14 && stageOf(bot, this.name) < 100; i++) {
                const st = stageOf(bot, this.name);
                if (st === 10) await ksTalk(bot, 'Reldo', KS.reldo);
                else if (st === 20 || st === 30) { if (st === 20 && !(await buyRedberryPie(bot))) return false; await ksTalk(bot, 'Thurgo', KS.thurgo); }
                else if (st === 40) await ksTalk(bot, 'Squire', KS.squire);
                else if (st === 50) { if (!(await getPortrait(bot))) return false; await ksTalk(bot, 'Thurgo', KS.thurgo); }
                else if (st === 60 && count(bot, 'Blurite sword')) await ksTalk(bot, 'Squire', KS.squire); // Thurgo made it: take it back (the stage stays 60 until then)
                else if (st === 60) {
                    if (!count(bot, 'Blurite ore') && !(await mineBlurite(bot))) return false;
                    if (count(bot, 'Iron bar') < 2 && (await bot.openBank())) { await bot.withdrawN('Iron bar', 2 - count(bot, 'Iron bar')); await bot.leaveBank(); }
                    if (count(bot, 'Iron bar') < 2) { bot.log('quest: needs 2 iron bars for Thurgo'); return false; }
                    await ksTalk(bot, 'Thurgo', KS.thurgo);
                } else if (st === 70) await ksTalk(bot, 'Squire', KS.squire);
                else break;
                bot.log(`quest: The Knight's Sword stage ${st} -> ${stageOf(bot, this.name)}`);
            }
            return stageOf(bot, this.name) >= 100;
        }
    },
    druidic_ritual: {
        name: 'Druidic Ritual',
        items: Object.keys(MEATS),
        async start(bot) {
            if (stageOf(bot, this.name) > 0) return true;
            if ((bot.s.combat ?? 3) < 25) { bot.log('quest: Druidic Ritual waits until combat 25 (the armour guarding the cauldron)'); return false; }
            await bot.travel(DR.kaqemeex.x, DR.kaqemeex.y, { tol: 3 });
            await bot.talkTo('Kaqemeex', { answer: DR_ANSWERS, maxSteps: 60 });
            await bot.state(5);
            return stageOf(bot, this.name) > 0;
        },
        async finish(bot) {
            for (let i = 0; i < 8 && stageOf(bot, this.name) < 100; i++) {
                const st = stageOf(bot, this.name);
                if (st === 10) await toSanfew(bot);
                else if (st === 20) {
                    if (!bot.s.inv.some(x => /^Enchanted/.test(x.name)) || bot.s.inv.filter(x => /^Enchanted/.test(x.name)).length < 4) {
                        for (const m of Object.keys(MEATS)) if (!count(bot, m)) await GATHER[m](bot, 1);
                        if (!(await cauldronRun(bot))) return false;
                    }
                    await toSanfew(bot);
                } else if (st === 99) {
                    await bot.travel(DR.kaqemeex.x, DR.kaqemeex.y, { tol: 3 });
                    await bot.talkTo('Kaqemeex', { answer: DR_ANSWERS, maxSteps: 60 });
                    await bot.state(5);
                } else break;
                bot.log(`quest: Druidic Ritual stage ${st} -> ${stageOf(bot, this.name)}`);
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
            if ((bot.s.combat ?? 3) < 10) { bot.log('quest: Imp Catcher waits until combat 10 (imps hit back)'); return false; }
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
            for (let i = 0; i < 20 && stageOf(bot, this.name) < 100; i++) {
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
