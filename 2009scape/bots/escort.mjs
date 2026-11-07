// Escorts (roadmap C12): a bot too weak for a dangerous place (muggers at the iron mine, later quest dungeons)
// asks its team for an escort. A stronger idle teammate takes the job, comes over, follows the ward and fights
// whatever attacks it until the ward is done. Both get a diary line and trust grows between them.
//   const job = escorts.request(bot, 'mine_iron')   -> waits for an escort (or null after a few minutes)
//   escorts.finish(bot.name)                        -> the job ends; the escort goes back to its own plan
//   bot.hook: if (escorts.jobFor(b.name)) { await escorts.guard(b); return true; }
import { dist, sleep, FOOD } from './lib.mjs';
import { relationOf } from './politics.mjs';

const WAIT_FOR_ESCORT = 4 * 60_000; // how long a ward waits for someone to take the job and arrive
const MAX_JOB = 40 * 60_000;

export class Escorts {
    constructor(market, log = console.log, note = () => {}) {
        this.market = market;
        this.log = log;
        this.note = note;
        this.jobs = new Map(); // ward -> { ward, task, escort, state: open|taken|done, created, until }
    }

    // a teammate strong enough: combat 20+ and well above the ward's, not the ward, not busy or away
    canEscort(name, job) {
        const m = this.market, e = m.bots.get(name)?.bot, w = m.bots.get(job.ward)?.bot;
        if (!e?.s || !w?.s || name === job.ward) return false;
        const [te, tw] = [m.social.teamOf(name), m.social.teamOf(job.ward)];
        if (te === 'individual' || (te !== tw && relationOf(te, tw) !== 'allied')) return false; // teammates, or an allied team
        if (m.isBusy?.(name) || m.away?.has?.(name) || e.waiting) return false;
        if ([...this.jobs.values()].some(j => j.escort === name && j.state !== 'done')) return false;
        return (e.s.combat ?? 3) >= Math.max(20, (w.s.combat ?? 3) + 8) && e.s.hp > e.s.maxHp * 0.6;
    }

    // ward side: post the job and wait until an escort has arrived. Returns the escort's name, or null.
    async request(bot, task) {
        const name = bot.name;
        const job = { ward: name, task, escort: null, state: 'open', created: Date.now(), until: Date.now() + MAX_JOB };
        this.jobs.set(name, job);
        this.log(`[escort] ${name} asks its team for an escort to ${task}`);
        bot.waiting = 'escort';
        try {
            const end = Date.now() + WAIT_FOR_ESCORT;
            while (Date.now() < end) {
                await bot.state(1).catch(() => {});
                const e = job.escort && this.market.bots.get(job.escort)?.bot;
                if (e?.s && dist(e.s, bot.s) <= 8 && e.s.z === bot.s.z) {
                    this.log(`[escort] ${job.escort} is escorting ${name} (${task})`);
                    bot.escort = job.escort;
                    return job.escort;
                }
                await sleep(5000);
            }
        } finally { bot.waiting = null; }
        this.log(`[escort] nobody came for ${name}`);
        job.state = 'done';
        this.jobs.delete(name);
        return null;
    }

    finish(ward, outcome = 'done') {
        const job = this.jobs.get(ward);
        if (!job) return;
        job.state = 'done';
        this.jobs.delete(ward);
        const w = this.market.bots.get(ward)?.bot;
        if (w) w.escort = null;
        if (job.escort && outcome === 'done') {
            this.log(`[escort] ${job.escort} saw ${ward} safely through ${job.task}`);
            this.market.social.adjustTrust?.(ward, job.escort, 0.1);
            this.market.social.adjustTrust?.(job.escort, ward, 0.05);
            this.note(ward, `${job.escort} escorted me while I did ${job.task}.`);
            this.note(job.escort, `Escorted ${ward} while it did ${job.task}.`);
        }
    }

    // escort side: an open job from a teammate it can take (taking it), or the job it already has
    jobFor(name) {
        for (const job of this.jobs.values()) {
            if (job.state === 'taken' && job.escort === name) return job;
        }
        for (const job of this.jobs.values()) {
            if (job.state === 'open' && this.canEscort(name, job)) { job.state = 'taken'; job.escort = name; this.log(`[escort] ${name} takes the job: escort ${job.ward}`); return job; }
        }
        return null;
    }

    // escort side: go to the ward, follow it, fight what attacks it
    async guard(bot) {
        const job = this.jobFor(bot.name);
        if (!job) return false;
        bot.waiting = 'escorting';
        try {
            while (job.state === 'taken' && Date.now() < job.until) {
                const w = this.market.bots.get(job.ward)?.bot;
                if (!w?.s?.online) break;
                const s = await bot.state(12);
                if (s.hp < s.maxHp * 0.4) {
                    const food = s.inv.find(i => FOOD.includes(i.name) && i.ops.includes('Eat'));
                    if (food) { await bot.act({ type: 'item', slot: food.slot, op: 'Eat' }); await bot.wait(2); continue; }
                    this.log(`[escort] ${bot.name} is too hurt to keep escorting ${job.ward}`);
                    break;
                }
                const d = dist(s, w.s);
                if (d > 30 || s.z !== w.s.z) { await bot.travel(w.s.x, w.s.y, { tol: 3, timeout: 300 }); continue; }
                // attack whatever is attacking the ward (or us)
                // what the ward sees counts too: an attacker may be outside our own view
                const wardName = job.ward.toLowerCase(), me = bot.name.toLowerCase();
                const isFoe = n => [wardName, me].includes(String(n.target ?? '').toLowerCase()) && (n.ops ?? []).includes('Attack');
                const foe = s.npcs.find(isFoe) ?? (w.s.npcs ?? []).find(isFoe);
                if (foe && !s.attacking) {
                    if (foe.target === job.ward) this.log(`[escort] ${bot.name} fights the ${foe.name} attacking ${job.ward}`);
                    await bot.act({ type: 'npc', npc: foe.npc, op: 'Attack' });
                    await bot.wait(3);
                    continue;
                }
                if (s.attacking || s.inCombat) { await bot.wait(2); continue; }
                if (d > 3) { await bot.walkTo(w.s.x, w.s.y, { tol: 2, timeout: 12, direct: true }); continue; } // short hops: the ward keeps moving
                await bot.wait(3);
            }
        } finally { bot.waiting = null; }
        if (job.state === 'taken') { // we left early: the ward is on its own
            job.state = 'done';
            this.jobs.delete(job.ward);
            const w = this.market.bots.get(job.ward)?.bot;
            if (w) w.escort = null;
        }
        return true;
    }
}
