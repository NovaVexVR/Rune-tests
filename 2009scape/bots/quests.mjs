// Phase 4.2: quests as scripts of steps (walk, talk with dialog choices, gather, hand in).
// Each quest lists the items it needs, and how to get each one, so a party can split the gathering
// (see party.mjs). Quest progress comes from the bot API's `quests` state (stage 100 = done).
import { sleep, dist } from './lib.mjs';

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

// Ways to get one quest item (each returns true once the bot holds it). `n`: how many to get.
export const GATHER = {
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
        for (let tries = 0; tries < 8 && count(bot, 'Bucket of milk') < n; tries++) {
            if (!count(bot, 'Bucket')) { bot.log('quest: no empty bucket to milk into'); return false; }
            const cow = COWS[tries % COWS.length];
            await bot.travel(cow.x - 1, cow.y, { tol: 3 });
            await bot.state(10);
            await bot.act({ type: 'scenery', x: cow.x, y: cow.y, id: 8689, op: 'Milk' }).catch(e => bot.log(`quest: ${e.message}`));
            await bot.waitIdle({ timeout: 15, quiet: 3 });
            await bot.state(5);
        }
        return count(bot, 'Bucket of milk') >= n;
    },
    async 'Pot of flour'(bot, n = 1) {
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
            if (!(await climb(bot, 'Climb-down', 1)) || !(await climb(bot, 'Climb-down', 0))) return false;
            for (let i = 0; i < want; i++) {
                await bot.act({ type: 'scenery', x: MILL.bin.x, y: MILL.bin.y, id: MILL.bin.id, op: 'Empty' }).catch(e => bot.log(`quest: ${e.message}`));
                await bot.waitIdle({ timeout: 8 });
                await bot.state(5);
            }
        }
        return count(bot, 'Pot of flour') >= n;
    }
};

async function talkToCook(bot) {
    await bot.travel(COOK.x, COOK.y, { tol: 2 });
    await bot.state(10);
    await bot.talkTo('Cook', { answer: /what.s wrong|always happy to help|know where to find|all the information|get right on it/i, maxSteps: 60 });
    await bot.state(5);
}

export const QUESTS = {
    cooks_assistant: {
        name: "Cook's Assistant",
        containers: { 'Bucket of milk': 'Bucket', 'Pot of flour': 'Empty pot' }, // item -> what you need to make it
        items: ['Egg', 'Bucket of milk', 'Pot of flour'],
        async start(bot) { if (stageOf(bot, this.name) === 0) await talkToCook(bot); return stageOf(bot, this.name) > 0; },
        async finish(bot) { await talkToCook(bot); return stageOf(bot, this.name) >= 100; }
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
