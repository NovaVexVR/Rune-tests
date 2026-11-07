// Group combat outings (roadmap 32). Once a day per team, when 3+ members are online, the team heads out together to
// a fighting ground that suits its weakest member, with roles: the strongest leads (attacks first), the one with the
// most food hands some to everyone before leaving, the weakest loots (picks up coins, herbs, runes). They fight there
// for 20 minutes and come home. Runners call join(bot) between plan steps; tick() plans outings (hourly).
import { note } from './diary.mjs';
import { FOOD, sleep } from './lib.mjs';
import { fightLoop } from './tasks.mjs';

const GROUNDS = [ // [min combat of the weakest member, place, monsters, label]
    // (the Varrock sewers' moss giants would need the manhole route underground: later)
    [28, { x: 3228, y: 3368 }, ['Dark wizard'], "the dark wizards' circle"],
    [14, { x: 3293, y: 3172 }, ['Al-Kharid warrior'], 'the Al Kharid warriors'],
    [10, { x: 3080, y: 3418 }, ['Barbarian'], 'the Barbarian Village longhall']
];
const MINUTES = 20;
export class Outings {
    constructor(market, log = () => {}) { this.market = market; this.log = log; this.active = []; this.last = {}; }
    outingOf(name) { return this.active.find(o => o.members.includes(name)); }
    tick() {
        const m = this.market, s = m.social, now = Date.now();
        const teams = {};
        for (const [n, { bot }] of m.bots) { const t = s.teamOf(n); if (t !== 'individual' && bot.s?.online && !m.isBusy(n) && !bot.waiting && !this.outingOf(n)) (teams[t] ??= []).push(n); }
        for (const [team, members] of Object.entries(teams)) {
            if (members.length < 3 || now - (this.last[team] ?? 0) < 86400_000) continue;
            const group = members.sort((a, b) => (m.bots.get(b).bot.s.combat ?? 0) - (m.bots.get(a).bot.s.combat ?? 0)).slice(0, 5);
            const weakest = m.bots.get(group.at(-1)).bot.s.combat ?? 3;
            const ground = GROUNDS.find(([min]) => weakest >= min);
            if (!ground) continue;
            const food = n => [...(m.bots.get(n).bot.s.bank ?? []), ...m.bots.get(n).bot.s.inv].filter(i => FOOD.includes(i.name)).reduce((t, i) => t + i.count, 0);
            const carrier = [...group].sort((a, b) => food(b) - food(a))[0];
            this.last[team] = now;
            const o = { team, members: group, leader: group[0], looter: group.at(-1), carrier, place: ground[1], names: ground[2], label: ground[3], created: now, arrived: new Set(), start: null };
            this.active.push(o);
            m.bots.get(o.leader).bot.act({ type: 'say', text: `${team}, with me! We're going to ${o.label}.`.slice(0, 80) }).catch(() => {});
            if (o.carrier !== o.leader) for (const n of group) if (n !== o.carrier) { const dish = [...(m.bots.get(o.carrier).bot.s.bank ?? []), ...m.bots.get(o.carrier).bot.s.inv].find(i => FOOD.includes(i.name))?.name; if (dish) m.open({ buyer: n, seller: o.carrier, item: dish, amount: 2, price: 0, kind: 'gift' }); }
            this.log(`[outing] ${team} heads to ${o.label}: ${group.join(', ')} (leader ${o.leader}, food ${o.carrier}, loot ${o.looter})`);
        }
    }
    async join(bot) {
        const o = this.outingOf(bot.name);
        if (!o) return false;
        const m = this.market;
        if (Date.now() - o.created > 90 * 60_000) { this.active = this.active.filter(x => x !== o); return false; }
        bot.waiting = 'outing';
        try {
            await bot.travel(o.place.x, o.place.y, { tol: 5, timeout: 900 });
            o.arrived.add(bot.name);
            const end = Date.now() + 6 * 60_000;
            while (o.arrived.size < Math.min(3, o.members.length) && Date.now() < end) { await bot.state(1); await sleep(4000); }
            o.start ??= Date.now();
            const role = bot.name === o.leader ? 'leading' : bot.name === o.looter ? 'looting' : 'fighting';
            bot.log(`[outing] ${role} at ${o.label} with ${o.members.filter(n => n !== bot.name).join(', ')}`);
            bot.waiting = null; // fighting is progress: let the watchdog see it as such
            await fightLoop(bot, o.start + MINUTES * 60_000, o.place, o.names, { pickup: bot.name === o.looter ? ['Coins', 'Air rune', 'Mind rune', 'Water rune', 'Earth rune', 'Fire rune', 'Body rune', 'Nature rune', 'Law rune', 'Chaos rune', 'Big bones'] : ['Big bones'] });
            note(bot.name, `Went with ${o.team} to ${o.label} (${role}).`);
            for (const n of o.members) if (n !== bot.name) m.social.adjustTrust(bot.name, n, 0.02);
            m.social.bumpMood?.(bot.name, 0.05, `a team outing to ${o.label}`);
            await bot.travel(3222, 3218, { tol: 4, timeout: 900 });
        } finally {
            bot.waiting = null;
            o.members = o.members.filter(n => n !== bot.name);
            if (!o.members.length) { this.active = this.active.filter(x => x !== o); this.log(`[outing] ${o.team} is back from ${o.label}`); }
        }
        return true;
    }
}
