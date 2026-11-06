// Personalities, trust and favors (IOUs) for the Claude-directed bots.
//
// Personality: traits in [0,1] stored in orders/<bot>.json under "personality" (generated once from
// the bot's name so it is stable; edit the file to change it).
//   greed       - marks up asking prices, wants more on the trade window, charges interest on favors
//   generosity  - discounts, accepts slightly uneven deals
//   caution     - needs more trust before extending a favor; avoids risky spending
//   loyalty     - how reliably it repays its debts (low loyalty = may let IOUs lapse)
//   patience    - willingness to give goods now for payment later
//   sociability - how chatty it is in-game
//
// Trust: trust[a][b] in [-1,1] is how much a trusts b (starts at 0). On-time repayment raises it,
// defaulting drops it sharply for the creditor and a little for everyone else (reputation).
//
// IOUs: market/ious.json  { id, debtor, creditor, item, owed, due, status: open|repaid|defaulted }
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIR = path.join(ROOT, 'market');
const ORDERS = path.join(ROOT, 'orders');
fs.mkdirSync(DIR, { recursive: true });
const IOU_FILE = path.join(DIR, 'ious.json');
const TRUST_FILE = path.join(DIR, 'trust.json');
const REL_FILE = path.join(DIR, 'relations.json');
const BOUNTY_FILE = path.join(DIR, 'bounties.json');
const MOOD_FILE = path.join(DIR, 'mood.json');
const GRUDGE_HOURS = 3;

// ---------- habits & collections (Phase 3) ----------
export const SPOTS = {
    courtyard: { x: 3222, y: 3218, label: 'the castle courtyard' },
    chapel: { x: 3243, y: 3208, label: 'the Lumbridge chapel' },
    riverbank: { x: 3239, y: 3245, label: 'the river bank' },
    farm: { x: 3190, y: 3272, label: 'the farm' },
    store: { x: 3212, y: 3247, label: 'the general store' }
};
export const COLLECTIONS = {
    fish: ['Shrimps', 'Anchovies', 'Sardine', 'Herring', 'Trout'],
    tools: ['Bronze axe', 'Bronze pickaxe', 'Tinderbox', 'Knife', 'Small fishing net', 'Hammer'],
    logs: ['Logs', 'Oak logs', 'Willow logs']
};
const FAV_FOODS = ['Shrimps', 'Anchovies', 'Bread', 'Cooked chicken', 'Cooked meat', 'Trout']; // rivalries fade after this long unless renewed

const ARCHETYPES = {
    merchant: { greed: 0.75, generosity: 0.2, caution: 0.5, loyalty: 0.7, patience: 0.6, sociability: 0.7 },
    philanthropist: { greed: 0.1, generosity: 0.85, caution: 0.3, loyalty: 0.8, patience: 0.8, sociability: 0.8 },
    miser: { greed: 0.8, generosity: 0.05, caution: 0.85, loyalty: 0.6, patience: 0.2, sociability: 0.2 },
    gambler: { greed: 0.5, generosity: 0.4, caution: 0.1, loyalty: 0.35, patience: 0.7, sociability: 0.8 },
    loyalist: { greed: 0.3, generosity: 0.5, caution: 0.5, loyalty: 0.95, patience: 0.6, sociability: 0.5 },
    opportunist: { greed: 0.7, generosity: 0.2, caution: 0.3, loyalty: 0.25, patience: 0.5, sociability: 0.6 }
};

// small deterministic PRNG from the bot's name
function seeded(name) {
    let h = 2166136261;
    for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return () => {
        h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
        return ((h >>> 0) % 10000) / 10000;
    };
}

export function personalityOf(name) {
    const f = path.join(ORDERS, `${name}.json`);
    const o = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    if (o.personality) {
        if (!o.personality.habits && fs.existsSync(f)) {
            o.personality.habits = makeHabits(name, o.personality);
            fs.writeFileSync(f, JSON.stringify(o, null, 2));
        }
        return o.personality;
    }
    const rnd = seeded(name);
    const keys = Object.keys(ARCHETYPES);
    const archetype = keys[Math.floor(rnd() * keys.length)];
    const p = { archetype };
    for (const [k, v] of Object.entries(ARCHETYPES[archetype])) p[k] = Math.round(Math.min(1, Math.max(0, v + (rnd() - 0.5) * 0.3)) * 100) / 100;
    p.habits = makeHabits(name, p);
    if (fs.existsSync(f)) {
        o.personality = p;
        fs.writeFileSync(f, JSON.stringify(o, null, 2));
    }
    return p;
}

function makeHabits(name, p) {
    const rnd = seeded(name + '#habits');
    const spots = Object.keys(SPOTS);
    const h = { spot: spots[Math.floor(rnd() * spots.length)], food: FAV_FOODS[Math.floor(rnd() * FAV_FOODS.length)] };
    // hoarding types sometimes fixate on a collection
    const collectorOdds = { miser: 0.6, merchant: 0.4, loyalist: 0.2 }[p.archetype] ?? 0.15;
    if (rnd() < collectorOdds) {
        const sets = Object.keys(COLLECTIONS);
        h.collection = sets[Math.floor(rnd() * sets.length)];
    }
    if (p.archetype === 'gambler' || rnd() < 0.1) h.gambles = true;
    return h;
}

const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const save = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

export class Social {
    constructor(log = console.log, teamOf = () => 'individual') {
        this.log = log;
        this.teamOf = teamOf;
        this.ious = load(IOU_FILE, []);
        this.trustMap = load(TRUST_FILE, {});
        this.rel = load(REL_FILE, {}); // rel[a][b] = { strikes, rival, since, reason }
        this.bounties = load(BOUNTY_FILE, []);
        this.moodMap = load(MOOD_FILE, {});
        this.seq = this.ious.reduce((m, i) => Math.max(m, i.id), 0);
        this.bseq = this.bounties.reduce((m, b) => Math.max(m, b.id), 0);
    }

    // ---------- rivalries (1.1) ----------
    isRival(a, b) {
        const r = this.rel[a]?.[b];
        if (!r?.rival) return false;
        if (Date.now() - r.since > GRUDGE_HOURS * 3600_000) { r.rival = false; r.strikes = 0; save(REL_FILE, this.rel); return false; }
        return true;
    }

    rivalsOf(a) {
        return Object.keys(this.rel[a] ?? {}).filter(b => this.isRival(a, b));
    }

    markRival(a, b, reason) {
        this.rel[a] ??= {};
        const was = this.isRival(a, b);
        this.rel[a][b] = { ...(this.rel[a][b] ?? {}), rival: true, since: Date.now(), reason, strikes: this.rel[a][b]?.strikes ?? 2 };
        save(REL_FILE, this.rel);
        if (!was) {
            this.log(`[social] ${a} now holds a grudge against ${b} (${reason})`);
            this.onGrudge?.(a, b, reason);
        }
    }

    // a strike for a lopsided offer; two strikes make a rival
    strike(a, b, reason) {
        this.rel[a] ??= {};
        const r = (this.rel[a][b] ??= { strikes: 0, rival: false });
        r.strikes = (r.strikes ?? 0) + 1;
        save(REL_FILE, this.rel);
        if (r.strikes >= 2) this.markRival(a, b, reason);
    }

    clearRival(a, b) {
        if (this.rel[a]?.[b]) { this.rel[a][b] = { strikes: 0, rival: false }; save(REL_FILE, this.rel); this.log(`[social] ${a} forgives ${b}`); }
    }

    // does `name` hold a grudge against anyone on `other`'s team?
    rivalTeam(name, other) {
        const team = this.teamOf(other);
        if (team === 'individual') return false;
        return this.rivalsOf(name).some(r => this.teamOf(r) === team);
    }

    // ---------- debt collection (1.2) ----------
    // Creditor sells an overdue IOU to a collector? Impatient creditors and long-overdue debts sell.
    willSellDebt(creditor, iou, price) {
        const overdueMin = (Date.now() - iou.due) / 60_000;
        const p = this.p(creditor);
        return price >= iou.owed * 0.4 && (overdueMin > 10 || Math.random() > p.patience);
    }

    transferIou(iou, collector, price) {
        this.log(`[social] ${collector} bought IOU #${iou.id} (${iou.debtor} owes ${iou.owed}) from ${iou.creditor} for ${price} coins`);
        iou.history = [...(iou.history ?? []), { from: iou.creditor, to: collector, price, t: Date.now() }];
        iou.creditor = collector;
        iou.collected = true;
        iou.due = Math.max(iou.due, Date.now() + 15 * 60_000); // a fresh grace period before default
        save(IOU_FILE, this.ious);
    }

    // ---------- bounty board (1.3) ----------
    openBounties() {
        return this.bounties.filter(b => b.status === 'open');
    }

    postBounty(poster, item, qty, reward, minutes = 60) {
        if (this.bounties.some(b => b.poster === poster && b.item === item && ['open', 'claimed'].includes(b.status))) return null;
        const b = { id: ++this.bseq, poster, item, qty, reward, status: 'open', posted: Date.now(), deadline: Date.now() + minutes * 60_000 };
        this.bounties.push(b);
        save(BOUNTY_FILE, this.bounties);
        this.log(`[social] bounty #${b.id}: ${poster} wants ${qty} ${item}, pays ${reward} coins`);
        return b;
    }

    setBounty(b, status, claimant = b.claimant) {
        b.status = status;
        b.claimant = claimant;
        if (status === 'done') b.done = Date.now();
        save(BOUNTY_FILE, this.bounties);
        this.log(`[social] bounty #${b.id} ${status}${claimant ? ` (${claimant})` : ''}`);
    }

    expireBounties() {
        for (const b of this.bounties) if (['open', 'claimed'].includes(b.status) && Date.now() > b.deadline) this.setBounty(b, 'expired');
    }

    // personality as it acts right now: mood shifts caution, chattiness and generosity
    p(name) {
        const base = personalityOf(name);
        const m = this.mood(name);
        const c = v => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
        return { ...base, caution: c(base.caution - 0.3 * m), sociability: c(base.sociability + 0.3 * m), generosity: c(base.generosity + 0.2 * m), mood: m };
    }

    mood(name) {
        return this.moodMap[name] ?? 0;
    }

    bumpMood(name, delta, why) {
        const before = this.mood(name);
        const after = Math.round(Math.max(-1, Math.min(1, before + delta)) * 100) / 100;
        this.moodMap[name] = after;
        save(MOOD_FILE, this.moodMap);
        if (Math.abs(delta) >= 0.2) this.log(`[mood] ${name} ${delta > 0 ? 'cheered' : 'shaken'} by ${why} (${before} -> ${after})`);
        this.onMood?.(name, delta, why);
    }

    // moods drift back toward neutral
    driftMoods(factor = 0.97) {
        for (const k of Object.keys(this.moodMap)) this.moodMap[k] = Math.round(this.moodMap[k] * factor * 100) / 100;
        save(MOOD_FILE, this.moodMap);
    }

    trust(a, b) {
        return this.trustMap[a]?.[b] ?? 0;
    }

    adjustTrust(a, b, delta) {
        this.trustMap[a] ??= {};
        this.trustMap[a][b] = Math.max(-1, Math.min(1, Math.round((this.trust(a, b) + delta) * 100) / 100));
    }

    // Price multiplier for `name` when selling to / buying from `other`.
    askFactor(name, other) {
        const p = this.p(name);
        // personality markup, plus up to +25% for partners it distrusts
        return (1 + 0.4 * p.greed - 0.25 * p.generosity) * (1 + 0.25 * Math.max(0, -this.trust(name, other))) * (this.rivalTeam(name, other) ? 1.3 : 1);
    }

    bidFactor(name, other) {
        const p = this.p(name);
        return (1 + 0.3 * p.generosity - 0.2 * p.greed) * (1 + 0.1 * this.trust(name, other));
    }

    // Minimum fraction of what it gives that it must receive (by its own values) to accept a trade.
    acceptRatio(name, other) {
        const p = this.p(name);
        return Math.max(0.6, 0.9 - 0.15 * p.generosity + 0.1 * p.greed - 0.1 * this.trust(name, other));
    }

    // Will `creditor` hand over goods now for an IOU from `debtor`?
    willExtendFavor(creditor, debtor) {
        const c = this.p(creditor);
        if (this.openDebts(debtor).some(i => i.creditor === creditor)) return false; // one at a time per pair
        if (this.openDebts(debtor).length >= 2) return false; // already stretched thin: nobody extends more credit
        if (this.ious.some(i => i.debtor === debtor && i.status === 'defaulted' && i.creditor === creditor)) return false; // burned before
        const needed = -0.2 + 0.6 * c.caution; // cautious bots need positive trust
        return c.patience > 0.35 && this.trust(creditor, debtor) >= needed;
    }

    interest(creditor) {
        return Math.round((0.05 + 0.35 * this.p(creditor).greed) * 100) / 100;
    }

    createIou(debtor, creditor, item, value, minutes = 60) {
        const owed = Math.max(1, Math.round(value * (1 + this.interest(creditor))));
        const iou = { id: ++this.seq, debtor, creditor, item, owed, created: Date.now(), due: Date.now() + minutes * 60_000, status: 'open' };
        this.ious.push(iou);
        save(IOU_FILE, this.ious);
        this.log(`[social] IOU #${iou.id}: ${debtor} owes ${creditor} ${owed} coins for ${item} (due in ${minutes}m)`);
        return iou;
    }

    openDebts(debtor) {
        return this.ious.filter(i => i.debtor === debtor && i.status === 'open');
    }

    // Debtor decides whether to repay now (loyal bots repay as soon as they can).
    wantsToRepay(debtor, iou, coins) {
        if (coins < iou.owed) return false;
        const p = this.p(debtor);
        const overdue = Date.now() > iou.due;
        const reminded = iou.reminded && Date.now() - iou.reminded < 30 * 60_000; // a PM from the creditor nudges it
        return p.loyalty > 0.5 || overdue || Math.random() < p.loyalty + (reminded ? 0.3 : 0);
    }

    settle(iou, repaid) {
        iou.status = repaid ? 'repaid' : 'defaulted';
        iou.settled = Date.now();
        if (repaid) {
            const onTime = iou.settled <= iou.due;
            this.adjustTrust(iou.creditor, iou.debtor, onTime ? 0.15 : 0.05);
            this.adjustTrust(iou.debtor, iou.creditor, 0.05);
            if (this.rel[iou.creditor]?.[iou.debtor]?.rival) this.clearRival(iou.creditor, iou.debtor);
            this.bumpMood(iou.creditor, 0.1, 'being repaid');
            this.bumpMood(iou.debtor, 0.05, 'clearing a debt');
        } else {
            this.adjustTrust(iou.creditor, iou.debtor, -0.5);
            this.markRival(iou.creditor, iou.debtor, `defaulted on IOU #${iou.id}`);
            this.bumpMood(iou.creditor, -0.3, `${iou.debtor} defaulting`);
            // reputation: everyone who has dealt in IOUs hears about it
            const known = new Set([...Object.keys(this.trustMap), ...this.ious.flatMap(i => [i.debtor, i.creditor])]);
            for (const other of known) if (other !== iou.creditor && other !== iou.debtor) this.adjustTrust(other, iou.debtor, -0.1);
        }
        save(IOU_FILE, this.ious);
        save(TRUST_FILE, this.trustMap);
        this.log(`[social] IOU #${iou.id} ${iou.status} (${iou.debtor} -> ${iou.creditor}, ${iou.owed} coins)`);
    }

    // IOUs left unpaid well past their due date are written off as defaults.
    sweepDefaults(graceMinutes = 30) {
        for (const iou of this.ious) if (iou.status === 'open' && Date.now() > iou.due + graceMinutes * 60_000) this.settle(iou, false);
    }

    save() {
        save(TRUST_FILE, this.trustMap);
    }

    saveIous() {
        save(IOU_FILE, this.ious);
    }

    // A short in-character chat line (or null if this bot doesn't feel like talking).
    line(name, event, other) {
        const p = this.p(name);
        if (Math.random() > p.sociability) return null;
        const L = {
            sale: { merchant: `Pleasure doing business, ${other}.`, miser: `Don't spend it all at once.`, philanthropist: `Enjoy it, ${other}!`, default: `Deal.` },
            favor: { philanthropist: `Pay me back whenever, ${other}.`, merchant: `Interest is fair, ${other}. Don't be late.`, gambler: `I'm betting on you, ${other}.`, default: `You owe me one.` },
            repaid: { loyalist: `Paid in full, as promised.`, default: `We're square, ${other}.` },
            defaulted: { miser: `${other} is a thief.`, loyalist: `I trusted you, ${other}.`, default: `Never again, ${other}.` },
            refuse: { miser: `No credit. Coins first.`, default: `Not on credit, sorry.` },
            callout: { miser: `Watch your coins around ${other}. Thief.`, loyalist: `${other} broke their word to me.`, merchant: `Don't do business with ${other}.`, default: `${other} can't be trusted!` },
            collect: { merchant: `${other}, I own your debt now. Pay up.`, opportunist: `Tick tock, ${other}. You owe me.`, default: `${other}, time to pay what you owe.` },
            bounty: { philanthropist: `Paying well for some help!`, miser: `Paying fair. Not a coin more.`, default: `Bounty posted. Anyone?` },
            bountyDone: { default: `Job done for ${other}.` },
            wagerWin: { gambler: `Heads! Lady luck loves me.`, default: `Ha, I win the flip!` },
            collection: { miser: `My collection is complete. Mine, all mine.`, default: `Finally completed my collection!` },
            idle: { philanthropist: `Lovely day at ${other}.`, miser: `Nobody touch my stuff.`, gambler: `Anyone up for a coin flip?`, merchant: `Buying and selling, best prices!`, loyalist: `Good to be back at ${other}.`, opportunist: `Just passing through ${other}...`, default: `Nice spot, ${other}.` }
        }[event];
        if (!L) return null;
        return (L[p.archetype] ?? L.default).slice(0, 80);
    }
}
