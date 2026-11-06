// Phase 4.2: quest parties. Teammates (or individualists who trust each other) who haven't done a quest
// team up and split the work: each item the quest needs gets one gatherer, who collects enough for the
// whole party. Containers (buckets, pots) are pooled to the gatherer first, and the results handed out
// afterwards, all through the normal trade window (deal kind 'party'). Then everyone hands in.
// The fighter of the party (highest combat) takes the item furthest out, as escort and look-out.
//
// The runner calls parties.tick() every few minutes to form parties, and parties.join(bot) between plan
// steps: a bot in a forming party waits for the others (up to JOIN_MINUTES), then the party runs.
import { sleep } from './lib.mjs';
import { QUESTS, GATHER, stageOf, count } from './quests.mjs';
import { note } from './diary.mjs';

const JOIN_MINUTES = Number(process.env.PARTY_JOIN_MINUTES ?? 45);
const SIZE = 3;
const MAX_ACTIVE = Number(process.env.PARTY_MAX ?? 2); // parties forming or questing at once, so the Cook isn't mobbed

export class Parties {
    constructor(market, log = console.log) {
        this.market = market;
        this.log = log;
        this.parties = []; // { id, quest, members, joined: Map(name -> bot), formed, running }
        this.seq = 0;
    }

    partyOf(name) { return this.parties.find(p => p.members.includes(name)); }

    // Form parties among online bots that haven't done a quest: teammates first, then trusted individualists.
    tick() {
        const m = this.market;
        for (const [id, q] of Object.entries(QUESTS)) {
            if (this.parties.length >= MAX_ACTIVE) break;
            const free = [...m.bots.keys()].filter(n => {
                const b = m.bots.get(n).bot;
                return b.s?.online && !this.partyOf(n) && !m.away.has(n) && stageOf(b, q.name) < 100;
            });
            const groups = {};
            for (const n of free) (groups[m.social.teamOf(n)] ??= []).push(n);
            for (const [team, names] of Object.entries(groups)) {
                let pool = names;
                while (pool.length >= 2 && this.parties.length < MAX_ACTIVE) {
                    let members;
                    if (team === 'individual') {
                        // individualists only party with bots they trust
                        const a = pool[0];
                        members = [a, ...pool.slice(1).filter(o => m.social.trust(a, o) >= 0.1 && m.social.trust(o, a) >= 0.1)].slice(0, SIZE);
                        if (members.length < 2) { pool = pool.slice(1); continue; }
                    } else members = pool.slice(0, SIZE);
                    pool = pool.filter(n => !members.includes(n));
                    this.form(id, members);
                }
            }
        }
        // parties whose members never all showed up go ahead with whoever came (or disband)
        for (const p of this.parties) {
            if (!p.running && Date.now() - p.formed > JOIN_MINUTES * 60_000) {
                p.members = p.members.filter(n => p.joined.has(n));
                if (p.members.length) this.start(p);
                else this.parties = this.parties.filter(x => x !== p);
            }
        }
    }

    form(quest, members) {
        const p = { id: ++this.seq, quest, members, joined: new Map(), formed: Date.now(), running: null };
        this.parties.push(p);
        this.log(`[party] #${p.id} forms for ${QUESTS[quest].name}: ${members.join(', ')}`);
        return p;
    }

    // A bot between plan steps: if it's in a party, wait for it to run and take part. Returns true if it did.
    async join(bot) {
        const p = this.partyOf(bot.name);
        if (!p) return false;
        p.joined.set(bot.name, bot);
        bot.log(`[party] joined party #${p.id} (${QUESTS[p.quest].name}), waiting for ${p.members.filter(n => !p.joined.has(n)).join(', ') || 'nobody'}`);
        if (p.joined.size === p.members.length) this.start(p);
        while (!p.running) { await bot.state(5); await bot.handleInterrupts(); await sleep(3000); if (!this.parties.includes(p)) return false; }
        await p.running;
        return true;
    }

    start(p) {
        if (p.running) return;
        p.running = this.run(p).catch(e => this.log(`[party] #${p.id} error: ${e.stack ?? e}`)).finally(() => {
            for (const n of p.members) this.market.away.delete(n);
            this.parties = this.parties.filter(x => x !== p);
        });
    }

    // One deal through the trade window between two party members; both keep handling interrupts until it closes.
    async give(from, to, item, amount = 1) {
        const m = this.market;
        if (!amount) return true;
        while (m.dealFor(from.name) || m.dealFor(to.name)) await sleep(1000);
        m.open({ buyer: to.name, seller: from.name, item, amount, price: 0, kind: 'party' });
        const deal = m.dealFor(to.name);
        const end = Date.now() + 6 * 60_000;
        while (m.deals.has(deal.id) && Date.now() < end) {
            await Promise.all([from, to].map(async b => { await b.state(5); await b.handleInterrupts(); }));
            await sleep(500);
        }
        return !m.deals.has(deal.id);
    }

    async run(p) {
        const q = QUESTS[p.quest], m = this.market;
        const bots = p.members.map(n => p.joined.get(n)).filter(Boolean);
        for (const b of bots) m.away.add(b.name); // no outside deals while questing
        this.log(`[party] #${p.id} sets out on ${q.name}: ${bots.map(b => b.name).join(', ')}`);
        for (const b of bots) await b.state(5);
        // everyone takes the quest (in parallel)
        await Promise.all(bots.map(b => q.start(b)));
        // roles: the fighter takes the first item (furthest out), the rest are shared round-robin
        const byCombat = [...bots].sort((a, b) => (b.s.combat ?? 0) - (a.s.combat ?? 0));
        const role = {};
        q.items.forEach((item, i) => (role[item] = byCombat[i % byCombat.length]));
        this.log(`[party] #${p.id} roles: ${q.items.map(i => `${role[i].name} gets ${i}`).join(', ')}`);
        // pool the containers to whoever fills them
        for (const [item, container] of Object.entries(q.containers ?? {})) {
            const g = role[item];
            for (const b of bots) if (b !== g && count(b, container) && count(g, container) < bots.length) await this.give(b, g, container);
        }
        // gather enough for everyone (in parallel)
        const got = await Promise.all(q.items.map(async item => {
            const g = role[item];
            return GATHER[item](g, 1 + bots.filter(b => b !== g && !count(b, item)).length); // one each for whoever lacks it
        }));
        if (!got.every(Boolean)) this.log(`[party] #${p.id} came back short: ${q.items.filter((_, i) => !got[i]).join(', ')}`);
        // hand out
        for (const item of q.items) {
            const g = role[item];
            for (const b of bots) if (b !== g && !count(b, item) && count(g, item) > 1) await this.give(g, b, item);
        }
        // everyone hands in
        const finished = await Promise.all(bots.map(b => q.finish(b)));
        const done = bots.filter((_, i) => finished[i]).map(b => b.name);
        this.log(`[party] #${p.id} ${q.name}: ${done.length}/${bots.length} completed (${done.join(', ')})`);
        for (const b of bots) {
            const others = bots.filter(o => o !== b).map(o => o.name);
            if (done.includes(b.name)) note(b.name, `Completed ${q.name}${others.length ? ` with ${others.join(' and ')}` : ''}. Quest points: ${b.s.questPoints}.`);
            for (const o of others) m.social.adjustTrust(b.name, o, done.includes(o) ? 0.1 : 0);
            if (done.includes(b.name)) m.social.bumpMood(b.name, 0.15, `finishing ${q.name}`);
        }
        m.social.save();
        return done;
    }
}
