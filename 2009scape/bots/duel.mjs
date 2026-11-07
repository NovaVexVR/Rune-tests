// Phase 5 (bounded PvP): duels at the Duel Arena in Al Kharid settle grudges.
// fightDuel(a, b) drives two bots through a friendly duel the way players do it: a challenges b
// (interface 640: friendly, send), b challenges back to accept, both accept the rules (637 friendly / 631 staked) and confirm (639 / 626),
// they're taken into an arena and fight ("Fight" option) until one is beaten.
import { sleep, dist } from './lib.mjs';
import fs from 'fs';
import { note } from './diary.mjs';

export const ARENA = { x: 3360, y: 3268 }; // the challenge area outside the arenas
// the six arenas: two columns (x 3332-3357, 3364-3388) by three rows (y 3205-3259)
const inArena = s => ((s.x >= 3332 && s.x <= 3357) || (s.x >= 3364 && s.x <= 3388)) && s.y >= 3205 && s.y <= 3259;

export async function fightDuel(a, b, log = console.log) {
    a.dueling = b.dueling = true; // no fleeing or eating mid-duel tactics from the interrupt handler
    try {
        // get within reach of each other
        const sa = await a.state(10);
        await b.walkTo(sa.x + 1, sa.y, { tol: 1, direct: true });
        // challenge, pick a friendly duel, send it; the other answers by challenging back
        for (let tries = 0; tries < 6; tries++) {
            const s1 = await a.state(10), s2 = await b.state(10);
            if ([631, 637, 639, 626].includes(s1.iface) || inArena(s1)) break;
            if (s1.iface === 640) {
                await a.act({ type: 'button', iface: 640, child: 18 }); // friendly
                await a.wait(1);
                await a.act({ type: 'button', iface: 640, child: 20 }); // send
                await a.wait(3);
                await b.act({ type: 'player', name: a.name, op: 'Challenge' }).catch(() => {});
                await b.wait(4);
                continue;
            }
            await a.act({ type: 'player', name: b.name, op: 'Challenge' }).catch(e => log(`[duel] ${e.message}`));
            await a.wait(3);
        }
        // both accept the rules and the confirmation screen
        for (let i = 0; i < 20; i++) {
            const [s1, s2] = [await a.state(5), await b.state(5)];
            if (inArena(s1) && inArena(s2)) break;
            for (const [bot, s] of [[a, s1], [b, s2]]) {
                if (s.iface === 637) await bot.act({ type: 'button', iface: 637, child: 83 }); // friendly rules: accept
                else if (s.iface === 631) await bot.act({ type: 'button', iface: 631, child: 102 }); // staked: accept
                else if (s.iface === 639) await bot.act({ type: 'button', iface: 639, child: 35 });
                else if (s.iface === 626) await bot.act({ type: 'button', iface: 626, child: 53 });
            }
            await sleep(1500);
        }
        if (!inArena(a.s) || !inArena(b.s)) { log(`[duel] ${a.name} vs ${b.name}: never got into the arena`); return null; }
        log(`[duel] ${a.name} vs ${b.name}: fight!`);
        await sleep(4000); // the 3-2-1 countdown
        // fight until someone is beaten
        const t0 = Date.now();
        let winner = null;
        while (Date.now() - t0 < 6 * 60_000 && !winner) {
            for (const [me, other] of [[a, b], [b, a]]) {
                const s = await me.state(10);
                if (s.messages?.some(m => /you have defeated/i.test(m.text))) { winner = me.name; break; }
                if (!inArena(s)) continue;
                if (!s.attacking) {
                    const r = await me.act({ type: 'player', name: other.name, op: 'Fight' }).catch(e => `error ${e.message}`);
                    if (process.env.DUEL_DEBUG && (me._dbg = (me._dbg ?? 0) + 1) <= 3) log(`[duel] ${me.name} fight -> ${JSON.stringify(r)} | ${s.x},${s.y} vs ${other.s?.x},${other.s?.y} | locked ${s.locked} attacking ${s.attacking} duel ${JSON.stringify(s.duel)} zones ${JSON.stringify(s.zones)} | msgs ${JSON.stringify(me.msgs.slice(-4))}`);
                }
            }
            await sleep(2000);
        }
        if (!winner) { // fell out without a message: whoever has more hp left
            const [s1, s2] = [await a.state(3), await b.state(3)];
            winner = s1.hp >= s2.hp ? a.name : b.name;
        }
        log(`[duel] ${a.name} vs ${b.name}: ${winner} wins`);
        await sleep(5000);
        return winner;
    } finally {
        a.dueling = b.dueling = false;
    }
}

// ---- Grudge duels (roadmap D19): a bold bot with a grudge challenges its rival to a friendly duel at the arena.
// tick() proposes duels (every 30 min from the runner); each runner calls join(bot) between plan steps: the bot
// walks to the arena (paying the Al Kharid toll), waits for its rival, the challenger runs the fight, and both
// go home. The winner's grudge is settled; the result goes in diaries, moods and the town's opinion.
const HOME = { x: 3222, y: 3218 };
// revenge plots (roadmap 47): the loser of a grudge duel trains for a rematch (bots/market/revenge.json)
const REVENGE = new URL('./market/revenge.json', import.meta.url).pathname;
const readRevenge = () => { try { return JSON.parse(fs.readFileSync(REVENGE, 'utf8')); } catch { return {}; } };
const saveRevenge = v => fs.writeFileSync(REVENGE, JSON.stringify(v, null, 1));
export const revengeOf = name => readRevenge()[name] ?? null;
// the runner swaps in melee training this often while a bot is plotting revenge
export const revengeTask = name => (revengeOf(name) && Math.random() < 0.35 ? 'melee' : null);
export class GrudgeDuels {
    constructor(market, log = console.log) { this.market = market; this.log = log; this.pending = []; this.last = new Map(); }
    duelOf(name) { return this.pending.find(d => d.a === name || d.b === name); }
    tick() {
        const m = this.market, s = m.social, now = Date.now();
        if (this.pending.length >= 2) return;
        const free = n => { const b = m.bots.get(n)?.bot; return b?.s?.online && !m.isBusy(n) && !b.waiting && !b.dueling && !this.duelOf(n) && (b.s.coins ?? 0) + ((b.s.bank ?? []).find(i => i.name === 'Coins')?.count ?? 0) >= 30; };
        const plots = readRevenge();
        for (const [a] of m.bots) {
            const plot = plots[a];
            const ready = plot && (m.bots.get(a).bot.s?.combat ?? 0) > (m.bots.get(plot.rival)?.bot.s?.combat ?? 99);
            if (!free(a) || (s.p(a).caution > 0.6 && !ready)) continue;
            for (const b of ready ? [plot.rival] : s.rivalsOf(a)) {
                const key = [a, b].sort().join('|');
                if (!free(b) || now - (this.last.get(key) ?? 0) < 12 * 3600_000) continue;
                const [ca, cb] = [m.bots.get(a).bot.s.combat ?? 3, m.bots.get(b).bot.s.combat ?? 3];
                if (Math.abs(ca - cb) > 10) continue;
                this.last.set(key, now);
                const accepts = s.p(b).caution < 0.8 || s.mood(b) < -0.3 || ready; // nobody ducks a rematch
                m.bots.get(a).bot.act({ type: 'say', text: ready ? `${b}! I've been training. Rematch, at the arena.` : `${b}! Settle this at the Duel Arena.` }).catch(() => {});
                m.dm(a, b, 'Duel Arena. You and me. Friendly rules, but you will lose.');
                if (!accepts) {
                    m.dm(b, a, "Not worth my time.");
                    for (const [o] of m.bots) if (o !== b && o !== a) s.adjustTrust(o, b, -0.01); // ducking a challenge looks bad
                    note(a, `Challenged ${b} to a duel. ${b} wouldn't fight.`);
                    note(b, `Turned down ${a}'s duel challenge.`);
                    this.log(`[duel] ${b} declines ${a}'s challenge`);
                    continue;
                }
                m.dm(b, a, "See you there.");
                this.pending.push({ a, b, arrived: new Set(), state: 'gathering', created: now });
                this.log(`[duel] ${a} challenges ${b} (combat ${ca} vs ${cb}); accepted`);
                return; // one new duel per tick
            }
        }
    }
    // a duel set up by someone else (the tournament): both bots fetch it with join()
    arrange(a, b, extra = {}) {
        const d = { a, b, arrived: new Set(), state: 'gathering', created: Date.now(), ...extra };
        this.pending.push(d);
        return d;
    }
    // runner side: if this bot has a duel, go and fight it (returns true if it did something)
    async join(bot) {
        const d = this.duelOf(bot.name);
        if (!d) return false;
        const m = this.market;
        m.busy.add(bot.name);
        bot.waiting = 'duel';
        try {
            if (Date.now() - d.created > 30 * 60_000) { this.drop(d, 'took too long to gather'); return true; }
            if (!bot.s.coins || bot.s.coins < 20) { if (await bot.openBank()) { await bot.withdrawN('Coins', 30); await bot.leaveBank(); } }
            if (!(await bot.travel(ARENA.x + (bot.name === d.a ? -1 : 1), ARENA.y, { tol: 3, timeout: 900 }))) { this.drop(d, `${bot.name} couldn't get to the arena`); return true; }
            d.arrived.add(bot.name);
            const end = Date.now() + 10 * 60_000;
            while (d.arrived.size < 2 && d.state === 'gathering' && Date.now() < end) { await bot.state(1); await sleep(3000); }
            if (d.arrived.size < 2) { this.drop(d, 'the rival never showed'); return true; }
            if (bot.name === d.a) {
                d.state = 'fighting';
                const [ba, bb] = [m.bots.get(d.a).bot, m.bots.get(d.b).bot];
                const winner = await fightDuel(ba, bb, this.log).catch(() => null);
                this.settle(d, winner);
            } else {
                const end2 = Date.now() + 15 * 60_000;
                while (!['done', 'dropped'].includes(d.state) && Date.now() < end2) await sleep(3000);
            }
            await bot.travel(HOME.x, HOME.y, { tol: 4, timeout: 900 });
        } finally { m.busy.delete(bot.name); bot.waiting = null; }
        return true;
    }
    drop(d, why) { d.state = 'dropped'; this.pending = this.pending.filter(x => x !== d); this.log(`[duel] ${d.a} vs ${d.b} called off: ${why}`); }
    settle(d, winner) {
        const s = this.market.social;
        d.state = 'done';
        this.pending = this.pending.filter(x => x !== d);
        d.winner = winner;
        if (!winner) { this.log(`[duel] ${d.a} vs ${d.b}: no result`); return; }
        const loser = winner === d.a ? d.b : d.a;
        if (d.tournament) { // a tournament bout: no grudges involved
            note(winner, `Beat ${loser} in the duel tournament.`); note(loser, `Knocked out of the duel tournament by ${winner}.`);
            this.log(`[duel] tournament: ${winner} beat ${loser}`);
            return;
        }
        s.clearRival(winner, loser); // honour satisfied
        // revenge: the loser vows a rematch (unless that was the rematch and it lost again twice over)
        const plots = readRevenge();
        if (plots[winner]?.rival === loser) { delete plots[winner]; note(winner, `Got my revenge on ${loser}.`); this.log(`[duel] ${winner} has its revenge on ${loser}`); }
        if (!d.tournament && !(plots[loser]?.rival === winner && plots[loser].tries >= 2)) {
            plots[loser] = { rival: winner, since: new Date().toISOString(), combat: this.market.bots.get(loser)?.bot.s?.combat ?? 0, tries: (plots[loser]?.tries ?? 0) + 1 };
            note(loser, `I'll train and beat ${winner} next time.`);
        } else if (plots[loser]?.rival === winner) { delete plots[loser]; note(loser, `Lost to ${winner} again. Some fights aren't worth it.`); }
        saveRevenge(plots);
        s.bumpMood(winner, 0.2, `beating ${loser} in a duel`);
        s.bumpMood(loser, -0.2, `losing a duel to ${winner}`);
        for (const [o] of this.market.bots) if (o !== winner && o !== loser) s.adjustTrust(o, winner, 0.01);
        s.save();
        note(winner, `Beat ${loser} in a duel at the arena. That settles it.`);
        note(loser, `Lost a duel to ${winner} at the arena.`);
        this.log(`[duel] GRUDGE DUEL: ${winner} beat ${loser}`);
    }
}
