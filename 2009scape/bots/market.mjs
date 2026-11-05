// Market / trading layer for the Claude-directed bots.
//
// Factions:
//   individualists (claudebot1-5): each works for its own goal; trades must be close to
//     equivalent exchange *by its own perceived values* (receive >= 90% of what it gives).
//   guild (guildbot1-5): one group; members give each other items/coins freely. Trades with
//     outsiders follow the same equivalent-exchange rule. guildbot5 is the treasurer: it pools
//     spare coins from members, buys what members need and hands it out.
//
// Perceived value: every bot keeps its own price list (market/values/<bot>.json). It starts from
// the shop/store price and moves with that bot's situation and what it sees in the market:
//   - need: item required by its own plan and missing        -> worth more to it
//   - stock: it holds a spare it doesn't need                 -> worth less to it
//   - demand: other bots currently looking for the item       -> worth more
//   - supply: other bots holding it as surplus                -> worth less
//   - memory: prices of trades it has done or seen            -> pulls toward recent prices
// Sale price = midpoint of the seller's ask and the buyer's bid, only if bid >= ask.
import fs from 'fs';
import path from 'path';

import { dist, sleep } from './lib.mjs';

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'market');
const VALUES_DIR = path.join(DIR, 'values');
fs.mkdirSync(VALUES_DIR, { recursive: true });
const LEDGER = path.join(DIR, 'ledger.jsonl');

// Teams: every bot name maps to a team; individualists (and scripted bots) are 'individual'.
export const TEAMS = {
    guild: { prefix: 'guildbot', size: 5, treasurer: 'guildbot5' },
    wolf: { prefix: 'wolfbot', size: 5, treasurer: 'wolfbot5' },
    hawk: { prefix: 'hawkbot', size: 5, treasurer: 'hawkbot5' },
    bear: { prefix: 'bearbot', size: 5, treasurer: 'bearbot5' },
    legion: { prefix: 'legion', size: 20, treasurer: 'legion1' }
};
export const faction = name => {
    for (const [team, t] of Object.entries(TEAMS)) if (new RegExp(`^${t.prefix}\\d+$`).test(name)) return team;
    return 'individual';
};
const sameGuild = (a, b) => faction(a) !== 'individual' && faction(a) === faction(b);
export const treasurerOf = name => TEAMS[faction(name)]?.treasurer ?? null;
export const TREASURER = 'guildbot5'; // legacy name, prefer treasurerOf()
const COIN_FLOAT = 40; // coins a guild member keeps; the rest goes to the treasurer

export const TASK_NEEDS = {
    woodcut_fire: [['Bronze axe', 'Iron axe', 'Steel axe'], ['Tinderbox']],
    fish_cook: [['Small fishing net'], ['Tinderbox']],
    mine: [['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe']],
    ranged: [['Shortbow'], ['Bronze arrow']],
    magic: [['Air rune'], ['Mind rune']],
    fletch: [['Knife'], ['Bronze axe', 'Iron axe', 'Steel axe']]
};
const TRADEABLE = new Set([...Object.values(TASK_NEEDS).flat(2), 'Copper ore', 'Tin ore', 'Iron ore', 'Logs', 'Oak logs', 'Willow logs', 'Shrimps', 'Anchovies', 'Bones', 'Feather', 'Cowhide']);
const STORE_FALLBACK = { 'Small fishing net': 5, 'Bronze axe': 16, 'Bronze pickaxe': 1, Tinderbox: 1, Shortbow: 50, 'Bronze arrow': 1, 'Air rune': 4, 'Mind rune': 3, 'Copper ore': 3, 'Tin ore': 3, 'Iron ore': 17, Logs: 4, 'Oak logs': 20, 'Willow logs': 32, Shrimps: 5, Anchovies: 15, Bones: 1, Feather: 2, Cowhide: 1 };

export class Market {
    constructor(log = console.log) {
        this.bots = new Map(); // name -> { bot, plan() }
        this.deals = new Map();
        this.busy = new Set();
        this.seq = 0;
        this.log = log;
        this.memory = {}; // item -> recent trade prices seen by everyone (public ledger)
        if (fs.existsSync(LEDGER)) {
            for (const line of fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean)) {
                const r = JSON.parse(line);
                if (r.outcome === 'completed' && r.kind === 'sale' && r.amount) (this.memory[r.item] ??= []).push(r.price / r.amount);
            }
        }
    }

    register(bot, planFn) {
        this.bots.set(bot.name, { bot, plan: planFn });
    }

    has(s, n) {
        return s.inv.some(i => i.name === n) || s.worn.some(i => i.name === n) || s.bank?.some(i => i.name === n);
    }

    needsOf(name) {
        const { bot, plan } = this.bots.get(name);
        const s = bot.s;
        if (!s?.inv) return [];
        const needs = [];
        for (const task of new Set(plan().map(p => p.task))) {
            for (const group of TASK_NEEDS[task] ?? []) if (!group.some(n => this.has(s, n))) needs.push(group[0]);
        }
        return [...new Set(needs)];
    }

    wantedBy(name) {
        const { plan } = this.bots.get(name);
        return new Set(plan().flatMap(p => (TASK_NEEDS[p.task] ?? []).flat()));
    }

    surplusOf(name) {
        const s = this.bots.get(name).bot.s;
        if (!s?.inv) return [];
        const wanted = this.wantedBy(name);
        return s.inv.filter(i => TRADEABLE.has(i.name) && (!wanted.has(i.name) || s.inv.filter(j => j.name === i.name).length > 1 && !/rune|arrow/i.test(i.name)));
    }

    coins(name) {
        return this.bots.get(name).bot.s?.coins ?? 0;
    }

    storeValue(item) {
        if (item === 'Coins') return 1;
        for (const [, { bot }] of this.bots) {
            const it = bot.s?.inv?.find(i => i.name === item) ?? bot.s?.bank?.find(i => i.name === item);
            if (it?.value) return it.value;
        }
        return STORE_FALLBACK[item] ?? 1;
    }

    // This bot's own perceived value for one unit of `item` right now.
    perceived(name, item) {
        if (item === 'Coins') return 1;
        const base = Math.max(1, this.storeValue(item));
        const s = this.bots.get(name).bot.s;
        let f = 1;
        const owned = s?.inv ? s.inv.filter(i => i.name === item).reduce((t, i) => t + i.count, 0) : 0;
        const needs = this.needsOf(name);
        if (needs.includes(item)) f *= 1.6; // I need this to do my job
        else if (this.wantedBy(name).has(item)) f *= owned > 1 ? 0.9 : 1.3; // I use it; reluctant to part with my only one
        else f *= 0.7; // spare to me
        let demand = 0, supply = 0;
        for (const [other] of this.bots) {
            if (other === name) continue;
            if (this.needsOf(other).includes(item)) demand++;
            if (this.surplusOf(other).some(i => i.name === item)) supply++;
        }
        f *= 1 + 0.15 * demand;
        f *= Math.max(0.5, 1 - 0.08 * supply);
        let v = base * f;
        const seen = this.memory[item]?.slice(-5);
        if (seen?.length) v = 0.7 * v + 0.3 * (seen.reduce((a, b) => a + b, 0) / seen.length);
        return Math.max(1, Math.round(v * 10) / 10);
    }

    saveValues(name) {
        const s = this.bots.get(name).bot.s;
        if (!s?.inv) return;
        const items = new Set([...this.needsOf(name), ...s.inv.filter(i => TRADEABLE.has(i.name)).map(i => i.name), ...Object.keys(STORE_FALLBACK)]);
        const out = { bot: name, faction: faction(name), updated: new Date().toISOString(), needs: this.needsOf(name), values: {} };
        for (const it of items) out.values[it] = { perceived: this.perceived(name, it), store: this.storeValue(it) };
        fs.writeFileSync(path.join(VALUES_DIR, `${name}.json`), JSON.stringify(out, null, 2));
    }

    // Look for a deal that fills one of this bot's needs (and, for the guild, pool coins).
    async seek(name) {
        if (this.busy.has(name)) return;
        const me = this.bots.get(name).bot.s;
        if (!me?.online || (me.x >= 3050 && me.x <= 3160 && me.y >= 3050 && me.y <= 3140)) return;
        this.saveValues(name);

        // guild members send spare coins to the treasurer
        const tre = treasurerOf(name);
        if (tre && name !== tre && this.coins(name) > COIN_FLOAT + 20 && this.bots.get(tre)?.bot.s?.online && !this.busy.has(tre)) {
            this.open({ buyer: tre, seller: name, item: 'Coins', amount: this.coins(name) - COIN_FLOAT, price: 0, kind: 'gift' });
            return;
        }

        for (const need of this.needsOf(name)) {
            // guildmates first (free), then anyone
            const others = [...this.bots.keys()].filter(o => o !== name && !this.busy.has(o) && this.bots.get(o).bot.s?.online)
                .sort((a, b) => Number(sameGuild(name, b)) - Number(sameGuild(name, a)));
            for (const other of others) {
                if (!this.surplusOf(other).some(i => i.name === need)) continue;
                if (sameGuild(name, other)) {
                    this.open({ buyer: name, seller: other, item: need, amount: 1, price: 0, kind: 'gift' });
                    return;
                }
                const ask = this.perceived(other, need);
                const bid = this.perceived(name, need);
                if (bid < ask) { this.log(`[market] ${name} won't pay ${other}'s ask of ${ask} for ${need} (values it at ${bid})`); continue; }
                const price = Math.max(1, Math.round((ask + bid) / 2));
                // guild buyers draw on the treasury
                const payer = tre && this.coins(name) < price ? null : name;
                if (!payer) {
                    if (this.bots.has(tre) && this.coins(tre) >= price && !this.busy.has(tre) && name !== tre) {
                        this.open({ buyer: name, seller: tre, item: 'Coins', amount: price, price: 0, kind: 'gift' });
                        return;
                    }
                    continue;
                }
                if (this.coins(name) < price) continue;
                this.open({ buyer: name, seller: other, item: need, amount: 1, price, kind: 'sale', ask, bid });
                return;
            }
        }
    }

    open(d) {
        const deal = { id: ++this.seq, ...d, state: 'meeting', started: Date.now() };
        this.deals.set(deal.id, deal);
        this.busy.add(d.buyer);
        this.busy.add(d.seller);
        const why = d.kind === 'sale' ? ` (seller asks ${d.ask}, buyer values at ${d.bid})` : '';
        this.log(`[market] deal #${deal.id}: ${d.seller} -> ${d.buyer}: ${d.amount ?? 1} ${d.item} for ${d.price} coins (${d.kind})${why}`);
    }

    dealFor(name) {
        for (const d of this.deals.values()) if (d.buyer === name || d.seller === name) return d;
        return null;
    }

    close(deal, outcome) {
        if (!this.deals.has(deal.id)) return;
        this.deals.delete(deal.id);
        this.busy.delete(deal.buyer);
        this.busy.delete(deal.seller);
        if (outcome === 'completed' && deal.kind === 'sale') (this.memory[deal.item] ??= []).push(deal.price / (deal.amount ?? 1));
        const rec = { t: new Date().toISOString(), id: deal.id, buyer: deal.buyer, seller: deal.seller, item: deal.item, amount: deal.amount ?? 1, price: deal.price, kind: deal.kind, ask: deal.ask, bid: deal.bid, outcome };
        fs.appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
        this.log(`[market] deal #${deal.id} ${outcome}`);
    }

    // Each side judges the open trade window with its OWN perceived values.
    acceptable(name, trade, deal) {
        const partner = name === deal.buyer ? deal.seller : deal.buyer;
        if (sameGuild(name, partner)) return true;
        const val = list => list.reduce((t, i) => t + this.perceived(name, i.name) * i.count, 0);
        const give = val(trade.mine), get = val(trade.theirs);
        if (give === 0) return true;
        const ok = get >= give * 0.9;
        if (!ok) this.log(`[market] ${name} sees deal #${deal.id} as unfair: gives ${give.toFixed(1)}, gets ${get.toFixed(1)}`);
        return ok;
    }

    async step(bot) {
        const deal = this.dealFor(bot.name);
        if (!deal) return false;
        if (Date.now() - deal.started > 5 * 60_000) {
            if (bot.s.trade) await bot.act({ type: 'tradedecline' });
            this.close(deal, 'timed out');
            return false;
        }
        const isBuyer = bot.name === deal.buyer;
        const partner = this.bots.get(isBuyer ? deal.seller : deal.buyer).bot;
        const s = await bot.state(5);
        const ps = partner.s;
        if (!ps) { await sleep(1000); return true; }

        if (!s.trade) {
            if (deal.state === 'traded') { this.close(deal, 'completed'); return false; }
            if (s.z !== 0 || ps.z !== 0) { // get out of the bank tower first
                if (s.z !== 0) await bot.leaveBank();
                else await bot.wait(3);
                return true;
            }
            if (isBuyer && dist(s, ps) > 2) { await bot.walkTo(ps.x, ps.y, { tol: 2, timeout: 60 }); return true; }
            if (dist(s, ps) <= 3) { await bot.act({ type: 'player', name: partner.name, op: 'Trade with' }); await bot.wait(3); }
            else await bot.wait(2);
            return true;
        }

        deal.state = 'trading';
        const t = s.trade;
        const myItem = isBuyer ? (deal.price > 0 ? 'Coins' : null) : deal.item;
        const myAmount = isBuyer ? deal.price : deal.amount ?? 1;
        const offered = t.mine.reduce((n, i) => n + (i.name === myItem ? i.count : 0), 0);
        if (myItem && offered < myAmount && !t.myAccepted) {
            const inv = s.inv.find(i => i.name === myItem);
            if (!inv) { await bot.act({ type: 'tradedecline' }); this.close(deal, `${bot.name} lacks ${myItem}`); return false; }
            const left = myAmount - offered;
            await bot.act({ type: 'tradeoffer', slot: inv.slot, amount: left >= inv.count ? 'all' : left >= 10 ? 10 : left >= 5 ? 5 : 1 });
            await bot.wait(1);
            return true;
        }
        const theirsReady = isBuyer ? t.theirs.some(i => i.name === deal.item) : deal.price === 0 || t.theirs.some(i => i.name === 'Coins' && i.count >= deal.price);
        if (!theirsReady) { await bot.wait(1); return true; }
        if (!this.acceptable(bot.name, t, deal)) {
            await bot.act({ type: 'tradedecline' });
            this.close(deal, `rejected by ${bot.name}`);
            return false;
        }
        if (!t.myAccepted) await bot.act({ type: 'tradeaccept' });
        await bot.wait(2);
        const after = await bot.state(1);
        if (!after.trade) { deal.state = 'traded'; this.close(deal, 'completed'); }
        return true;
    }
}
