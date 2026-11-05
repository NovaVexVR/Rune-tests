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
    if (o.personality) return o.personality;
    const rnd = seeded(name);
    const keys = Object.keys(ARCHETYPES);
    const archetype = keys[Math.floor(rnd() * keys.length)];
    const p = { archetype };
    for (const [k, v] of Object.entries(ARCHETYPES[archetype])) p[k] = Math.round(Math.min(1, Math.max(0, v + (rnd() - 0.5) * 0.3)) * 100) / 100;
    if (fs.existsSync(f)) {
        o.personality = p;
        fs.writeFileSync(f, JSON.stringify(o, null, 2));
    }
    return p;
}

const load = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const save = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

export class Social {
    constructor(log = console.log) {
        this.log = log;
        this.ious = load(IOU_FILE, []);
        this.trustMap = load(TRUST_FILE, {});
        this.seq = this.ious.reduce((m, i) => Math.max(m, i.id), 0);
    }

    p(name) {
        return personalityOf(name);
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
        return (1 + 0.4 * p.greed - 0.25 * p.generosity) * (1 + 0.25 * Math.max(0, -this.trust(name, other)));
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
        return p.loyalty > 0.5 || overdue || Math.random() < p.loyalty;
    }

    settle(iou, repaid) {
        iou.status = repaid ? 'repaid' : 'defaulted';
        iou.settled = Date.now();
        if (repaid) {
            const onTime = iou.settled <= iou.due;
            this.adjustTrust(iou.creditor, iou.debtor, onTime ? 0.15 : 0.05);
            this.adjustTrust(iou.debtor, iou.creditor, 0.05);
        } else {
            this.adjustTrust(iou.creditor, iou.debtor, -0.5);
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

    // A short in-character chat line (or null if this bot doesn't feel like talking).
    line(name, event, other) {
        const p = this.p(name);
        if (Math.random() > p.sociability) return null;
        const L = {
            sale: { merchant: `Pleasure doing business, ${other}.`, miser: `Don't spend it all at once.`, philanthropist: `Enjoy it, ${other}!`, default: `Deal.` },
            favor: { philanthropist: `Pay me back whenever, ${other}.`, merchant: `Interest is fair, ${other}. Don't be late.`, gambler: `I'm betting on you, ${other}.`, default: `You owe me one.` },
            repaid: { loyalist: `Paid in full, as promised.`, default: `We're square, ${other}.` },
            defaulted: { miser: `${other} is a thief.`, loyalist: `I trusted you, ${other}.`, default: `Never again, ${other}.` },
            refuse: { miser: `No credit. Coins first.`, default: `Not on credit, sorry.` }
        }[event];
        if (!L) return null;
        return (L[p.archetype] ?? L.default).slice(0, 80);
    }
}
