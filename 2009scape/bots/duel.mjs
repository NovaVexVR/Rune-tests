// Phase 5 (bounded PvP): duels at the Duel Arena in Al Kharid settle grudges.
// fightDuel(a, b) drives two bots through a friendly duel the way players do it: a challenges b
// (interface 640: friendly, send), b challenges back to accept, both accept the rules (637 friendly / 631 staked) and confirm (639 / 626),
// they're taken into an arena and fight ("Fight" option) until one is beaten.
import { sleep, dist } from './lib.mjs';

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
