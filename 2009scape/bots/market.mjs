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

import { dist, sleep, FOOD } from './lib.mjs';
import { Social, COLLECTIONS, personalityOf } from './social.mjs';
import { note, record } from './diary.mjs';
import { teamOf, treasurerOfTeam, onContribution, onHelped } from './politics.mjs';

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'market');
const VALUES_DIR = path.join(DIR, 'values');
fs.mkdirSync(VALUES_DIR, { recursive: true });
const LEDGER = path.join(DIR, 'ledger.jsonl');
const DMS = path.join(DIR, 'dms.jsonl');

// Teams: every bot name maps to a team; individualists (and scripted bots) are 'individual'.
export const TEAMS = {
    guild: { prefix: 'guildbot', size: 5, treasurer: 'guildbot5' },
    wolf: { prefix: 'wolfbot', size: 5, treasurer: 'wolfbot5' },
    hawk: { prefix: 'hawkbot', size: 5, treasurer: 'hawkbot5' },
    bear: { prefix: 'bearbot', size: 5, treasurer: 'bearbot5' },
    legion: { prefix: 'legion', size: 20, treasurer: 'legion1' }
};
// membership is dynamic (politics.mjs: market/teams.json); TEAMS above only seeds it
export const faction = name => teamOf(name);
const sameGuild = (a, b) => faction(a) !== 'individual' && faction(a) === faction(b);
export const treasurerOf = name => treasurerOfTeam(faction(name));
export const TREASURER = 'guildbot5'; // legacy name, prefer treasurerOf()
const COIN_FLOAT = 40; // coins a guild member keeps; the rest goes to the treasurer

export const TASK_NEEDS = {
    woodcut_fire: [['Bronze axe', 'Iron axe', 'Steel axe'], ['Tinderbox']],
    fish_cook: [['Small fishing net'], ['Tinderbox']],
    mine: [['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe']],
    smelt: [['Bronze pickaxe', 'Iron pickaxe', 'Steel pickaxe']],
    smith: [['Hammer']],
    // fighters want armour (any helm, body, shield of metal; the first is what they ask for)
    melee: [['Bronze med helm', 'Bronze full helm', 'Iron med helm', 'Iron full helm', 'Steel med helm', 'Steel full helm'],
        ['Bronze chainbody', 'Bronze platebody', 'Iron chainbody', 'Iron platebody', 'Steel chainbody', 'Steel platebody'],
        ['Bronze sq shield', 'Bronze kiteshield', 'Iron sq shield', 'Iron kiteshield', 'Steel sq shield', 'Steel kiteshield']],
    ranged: [['Shortbow'], ['Bronze arrow']],
    magic: [['Air rune'], ['Mind rune']],
    fletch: [['Knife'], ['Bronze axe', 'Iron axe', 'Steel axe']]
};
export const TRADEABLE = new Set(['Hammer', 'Sardine', 'Herring', 'Trout', 'Bread', 'Cooked chicken', 'Cooked meat', ...Object.values(COLLECTIONS).flat(), ...Object.values(TASK_NEEDS).flat(2), 'Copper ore', 'Tin ore', 'Iron ore', 'Bronze bar', 'Bronze dagger', 'Bronze med helm', 'Bronze full helm', 'Bronze sq shield', 'Bronze chainbody', 'Bronze kiteshield', 'Bronze platelegs', 'Bronze platebody', 'Logs', 'Oak logs', 'Willow logs', 'Shrimps', 'Anchovies', 'Bones', 'Feather', 'Cowhide']);
const STORE_FALLBACK = { 'Small fishing net': 5, 'Bronze axe': 16, 'Bronze pickaxe': 1, Tinderbox: 1, Shortbow: 50, 'Bronze arrow': 1, 'Air rune': 4, 'Mind rune': 3, 'Copper ore': 3, 'Tin ore': 3, 'Iron ore': 17, 'Bronze bar': 8, 'Bronze dagger': 10, 'Bronze med helm': 24, 'Bronze full helm': 44, 'Bronze sq shield': 48, 'Bronze chainbody': 60, 'Bronze kiteshield': 68, 'Bronze platelegs': 80, 'Bronze platebody': 160, Logs: 4, 'Oak logs': 20, 'Willow logs': 32, Shrimps: 5, Anchovies: 15, Bones: 1, Feather: 2, Cowhide: 1 };

export class Market {
    constructor(log = console.log) {
        this.bots = new Map(); // name -> { bot, plan() }
        this.deals = new Map();
        this.busy = new Set();
        this.away = new Set(); // bots at a market day: only the market-day haggling trades with them
        // deal ids continue from the ledger so they stay unique across restarts
        this.seq = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean).reduce((m, l) => Math.max(m, JSON.parse(l).id ?? 0), 0) : 0;
        this.log = log;
        this.social = new Social(log, faction);
        // when a bot starts a grudge, it warns the bots it trusts most by PM
        this.social.onGrudge = (a, b, reason) => {
            const friends = [...this.bots.keys()].filter(o => o !== a && o !== b && this.social.trust(a, o) > 0.2).sort((x, y) => this.social.trust(a, y) - this.social.trust(a, x)).slice(0, 3);
            for (const f of friends) this.dm(a, f, `Watch out for ${b}. ${reason}.`);
        };
        this.lastCallout = {};
        this.lastHound = {};
        this.memory = {}; // item -> recent trade prices seen by everyone (public ledger)
        if (fs.existsSync(LEDGER)) {
            for (const line of fs.readFileSync(LEDGER, 'utf8').trim().split('\n').filter(Boolean)) {
                const r = JSON.parse(line);
                if (r.outcome === 'completed' && r.kind === 'sale' && r.amount) (this.memory[r.item] ??= []).push(r.price / r.amount);
            }
        }
    }

    // private message between bots (real in-game PM); logged for the dashboard
    dm(from, to, text) {
        const b = this.bots.get(from)?.bot;
        if (!b?.s?.online || !this.bots.get(to)?.bot.s?.online) return;
        text = String(text).slice(0, 80);
        b.act({ type: 'dm', to, text });
        fs.appendFileSync(DMS, JSON.stringify({ t: new Date().toISOString(), from, to, text }) + '\n');
        this.log(`[dm] ${from} -> ${to}: ${text}`);
    }

    // a bot reacts to a PM it received
    onPm(name, pm) {
        for (const iou of this.social.openDebts(name)) {
            if (iou.creditor === pm.from) { iou.reminded = Date.now(); this.social.saveIous?.(); }
        }
    }

    // in a deal, or away at a market day (where only market-day haggling trades with it)
    isBusy(name) {
        return this.busy.has(name) || this.away.has(name);
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
        // fighters and thieves with no food carried or banked need some (teammates supply it from the stash)
        const plans = new Set(plan().map(p => p.task));
        if (['melee', 'ranged', 'thieving'].some(t => plans.has(t)) && !s.inv.some(i => FOOD.includes(i.name)) && !s.bank?.some(i => FOOD.includes(i.name))) needs.push('Shrimps');
        // collectors also "need" the missing pieces of their set
        const col = this.collectionOf(name);
        if (col) for (const piece of col.missing) needs.push(piece);
        return [...new Set(needs)];
    }

    collectionOf(name) {
        const h = personalityOf(name).habits;
        if (!h?.collection) return null;
        const s = this.bots.get(name)?.bot.s;
        const set = COLLECTIONS[h.collection];
        const missing = set.filter(n => !(s?.inv?.some(i => i.name === n) || s?.bank?.some(i => i.name === n)));
        return { name: h.collection, set, missing, done: !!h.collectionDone };
    }

    wantedBy(name) {
        const { plan } = this.bots.get(name);
        return new Set(plan().flatMap(p => (TASK_NEEDS[p.task] ?? []).flat()));
    }

    // team stash: a teammate (above all the treasurer) can give from its bank, not just its bag
    stashHas(name, item) {
        const s = this.bots.get(name)?.bot.s;
        const n = s?.bank?.find(i => i.name === item)?.count ?? 0;
        return n > (this.wantedBy(name).has(item) || FOOD.includes(item) ? 2 : 0);
    }

    surplusOf(name) {
        const s = this.bots.get(name).bot.s;
        if (!s?.inv) return [];
        const wanted = this.wantedBy(name);
        const h = personalityOf(name).habits ?? {};
        const keep = new Set([h.food, ...(h.collection ? COLLECTIONS[h.collection] : [])]);
        return s.inv.filter(i => !keep.has(i.name)).filter(i => TRADEABLE.has(i.name) && (!wanted.has(i.name) || s.inv.filter(j => j.name === i.name).length > 1 && !/rune|arrow/i.test(i.name)));
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
        const h = personalityOf(name).habits ?? {};
        if (h.food === item) f *= 3; // its favorite food: hardly for sale
        const col = h.collection ? COLLECTIONS[h.collection] : null;
        if (col?.includes(item)) f *= owned > 0 ? 2 : 4; // collectors overpay for missing pieces and cling to the rest
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
        if (this.isBusy(name)) return;
        const me = this.bots.get(name).bot.s;
        if (!me?.online || (me.x >= 3050 && me.x <= 3160 && me.y >= 3050 && me.y <= 3140)) return;
        this.saveValues(name);
        this.social.sweepDefaults();
        this.social.expireBounties();
        this.maybeCallOut(name);

        // creditors chase overdue debts by PM
        for (const iou of this.social.ious) {
            if (iou.status !== 'open' || iou.creditor !== name || Date.now() < iou.due) continue;
            if (Date.now() - (iou.lastReminder ?? 0) < 20 * 60_000) continue;
            iou.lastReminder = Date.now();
            this.dm(name, iou.debtor, `Your IOU #${iou.id} is overdue: ${iou.owed} coins. Pay up.`);
        }

        // pay debts first (loyal bots promptly; others when overdue or on a whim)
        for (const iou of this.social.openDebts(name)) {
            const cred = this.bots.get(iou.creditor);
            if (!cred?.bot.s?.online || this.isBusy(iou.creditor)) continue;
            if (this.social.wantsToRepay(name, iou, this.coins(name))) {
                this.open({ buyer: iou.creditor, seller: name, item: 'Coins', amount: iou.owed, price: 0, kind: 'repay', iouId: iou.id });
                return;
            }
        }

        // guild members send spare coins to the treasurer
        const tre = treasurerOf(name);
        if (tre && name !== tre && this.coins(name) > COIN_FLOAT + 20 && this.bots.get(tre)?.bot.s?.online && !this.isBusy(tre)) {
            this.open({ buyer: tre, seller: name, item: 'Coins', amount: this.coins(name) - COIN_FLOAT, price: 0, kind: 'gift' });
            return;
        }
        // ...and now and then their spare goods, which the treasurer banks: the team stash
        if (tre && name !== tre && Date.now() - (this.lastDonation?.[name] ?? 0) > 60 * 60_000 && this.bots.get(tre)?.bot.s?.online && !this.isBusy(tre)) {
            const spare = this.surplusOf(name).find(i => !FOOD.includes(i.name) || this.bots.get(name).bot.s.inv.filter(j => FOOD.includes(j.name)).length > 6);
            if (spare) {
                (this.lastDonation ??= {})[name] = Date.now();
                const have = this.bots.get(name).bot.s.inv.filter(i => i.name === spare.name).reduce((t, i) => t + i.count, 0);
                const room = (this.bots.get(tre).bot.s.invFree ?? 0) - 2; // the treasurer has to have room in its bag
                const amount = Math.min(have, Math.max(0, room));
                if (amount < 1) return;
                this.open({ buyer: tre, seller: name, item: spare.name, amount, price: 0, kind: 'gift' });
                this.log(`[market] ${name} gives ${amount} ${spare.name} to the ${faction(name)} stash (deal #${this.seq})`);
                return;
            }
        }

        this.checkCollection(name);
        if (this.seekWager(name)) return;
        if (this.seekBounty(name)) return;
        if (this.seekDebtPurchase(name)) return;

        for (const need of this.needsOf(name)) {
            // guildmates first (free), then anyone it isn't feuding with
            const others = [...this.bots.keys()].filter(o => o !== name && !this.isBusy(o) && this.bots.get(o).bot.s?.online && !this.social.isRival(name, o) && !this.social.isRival(o, name))
                .sort((a, b) => Number(sameGuild(name, b)) - Number(sameGuild(name, a)));
            for (const other of others) {
                if (!this.surplusOf(other).some(i => i.name === need) && !(sameGuild(name, other) && this.stashHas(other, need))) continue;
                if (sameGuild(name, other)) {
                    this.open({ buyer: name, seller: other, item: need, amount: 1, price: 0, kind: 'gift' });
                    return;
                }
                // personality + trust shape the ask/bid around each side's perceived value
                const ask = Math.round(this.perceived(other, need) * this.social.askFactor(other, name) * 10) / 10;
                const bid = Math.round(this.perceived(name, need) * this.social.bidFactor(name, other) * 10) / 10;
                if (bid < ask) { this.log(`[market] ${name} won't pay ${other}'s ask of ${ask} for ${need} (values it at ${bid})`); continue; }
                const price = Math.max(1, Math.round((ask + bid) / 2));
                // can't pay now: ask for it as a favor (IOU), if the seller trusts us enough
                if (this.coins(name) < price && !tre) {
                    if (this.social.willExtendFavor(other, name)) {
                        this.open({ buyer: name, seller: other, item: need, amount: 1, price: 0, kind: 'favor', value: price, ask, bid });
                        return;
                    }
                    continue;
                }
                // guild buyers draw on the treasury
                const payer = tre && this.coins(name) < price ? null : name;
                if (!payer) {
                    if (this.bots.has(tre) && this.coins(tre) >= price && !this.isBusy(tre) && name !== tre) {
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
        this.maybePostBounties(name);
    }

    // ---------- 3.2 collections ----------
    checkCollection(name) {
        const col = this.collectionOf(name);
        if (!col || col.done || col.missing.length) return;
        const f = path.join(path.dirname(new URL(import.meta.url).pathname), 'orders', `${name}.json`);
        const o = JSON.parse(fs.readFileSync(f, 'utf8'));
        o.personality.habits.collectionDone = new Date().toISOString();
        fs.writeFileSync(f, JSON.stringify(o, null, 2));
        this.log(`[character] ${name} completed its ${col.name} collection!`);
        note(name, `Completed my ${col.name} collection!`);
        this.social.bumpMood(name, 0.3, 'completing a collection');
        const text = this.social.line(name, 'collection', '');
        if (text) this.bots.get(name).bot.act({ type: 'say', text });
    }

    // ---------- 3.1 gambling ----------
    seekWager(name) {
        const h = personalityOf(name).habits ?? {};
        if (!h.gambles || this.coins(name) < 20 || Date.now() - (this.lastWager?.[name] ?? 0) < 30 * 60_000) return false;
        const me = this.bots.get(name).bot.s;
        const other = [...this.bots.keys()].find(o => o !== name && !this.isBusy(o) && personalityOf(o).habits?.gambles && this.coins(o) >= 20
            && this.bots.get(o).bot.s?.online && dist(me, this.bots.get(o).bot.s) <= 25 && !this.social.isRival(name, o) && !this.social.isRival(o, name));
        if (!other) return false;
        (this.lastWager ??= {})[name] = Date.now();
        this.lastWager[other] = Date.now();
        const stake = Math.min(20, Math.floor(Math.min(this.coins(name), this.coins(other)) / 3));
        const [winner, loser] = Math.random() < 0.5 ? [name, other] : [other, name]; // the coin is flipped now; the loser pays up
        this.log(`[character] ${name} and ${other} flip a coin for ${stake}gp: ${winner} wins`);
        this.open({ buyer: winner, seller: loser, item: 'Coins', amount: stake, price: 0, kind: 'wager' });
        return true;
    }

    // ---------- 1.1 call-outs ----------
    maybeCallOut(name) {
        if (Date.now() - (this.lastCallout[name] ?? 0) < 10 * 60_000) return;
        const me = this.bots.get(name).bot.s;
        for (const rival of this.social.rivalsOf(name)) {
            const rs = this.bots.get(rival)?.bot.s;
            if (!rs?.online || dist(me, rs) > 15) continue;
            this.lastCallout[name] = Date.now();
            const text = this.social.line(name, 'callout', rival);
            if (text) this.bots.get(name).bot.act({ type: 'say', text });
            // bystanders who hear it trust the rival a little less
            for (const [other, o] of this.bots) {
                if (other === name || other === rival || !o.bot.s?.online || dist(me, o.bot.s) > 15) continue;
                this.social.adjustTrust(other, rival, -0.05);
            }
            this.social.save();
            this.log(`[social] ${name} called out ${rival} in public`);
            return;
        }
    }

    // ---------- 1.2 debt collectors ----------
    seekDebtPurchase(name) {
        const p = this.social.p(name);
        if (!['merchant', 'opportunist'].includes(p.archetype) || faction(name) !== 'individual') return false;
        for (const iou of this.social.ious) {
            if (iou.status !== 'open' || Date.now() < iou.due || iou.creditor === name || iou.debtor === name) continue;
            const cred = this.bots.get(iou.creditor);
            if (!cred?.bot.s?.online || this.isBusy(iou.creditor)) continue;
            const price = Math.max(1, Math.min(Math.round(iou.owed * 0.8), Math.round(iou.owed * 0.6 * (1 + 0.3 * this.social.trust(name, iou.debtor)))));
            if (this.coins(name) < price) continue;
            if (!this.social.willSellDebt(iou.creditor, iou, price)) continue;
            this.open({ buyer: name, seller: iou.creditor, item: `IOU #${iou.id}`, amount: 1, price, kind: 'debtsale', iouId: iou.id });
            return true;
        }
        return false;
    }

    // Collectors walk over to overdue debtors and remind them, every 15 minutes or so.
    async hound(bot) {
        const name = bot.name;
        if (Date.now() - (this.lastHound[name] ?? 0) < 15 * 60_000) return false;
        const iou = this.social.ious.find(i => i.status === 'open' && i.collected && i.creditor === name && Date.now() > i.due - 10 * 60_000);
        if (!iou) return false;
        const ds = this.bots.get(iou.debtor)?.bot.s;
        if (!ds?.online || ds.z !== 0 || this.away.has(iou.debtor) || this.away.has(name)) return false;
        this.lastHound[name] = Date.now();
        this.log(`[social] ${name} goes to collect from ${iou.debtor} (IOU #${iou.id})`);
        await bot.walkTo(ds.x, ds.y, { tol: 3, timeout: 120 });
        const text = this.social.line(name, 'collect', iou.debtor) ?? `${iou.debtor}, you owe me ${iou.owed}.`;
        await bot.act({ type: 'say', text });
        this.dm(name, iou.debtor, `I bought your IOU #${iou.id}. ${iou.owed} coins, now.`);
        return true;
    }

    // ---------- 1.3 bounty board ----------
    // Claim an open bounty this bot can fill from what it already carries.
    seekBounty(name) {
        const p = this.social.p(name);
        const me = this.bots.get(name).bot.s;
        const wanted = this.wantedBy(name);
        const options = this.social.openBounties().filter(b => {
            if (b.poster === name || this.isBusy(b.poster) || !this.bots.get(b.poster)?.bot.s?.online) return false;
            if (this.social.isRival(name, b.poster) || this.social.isRival(b.poster, name)) return false;
            if (this.social.trust(name, b.poster) < -0.2 + 0.4 * p.caution - 0.2) return false; // cautious bots only work for people they trust
            const have = me.inv.filter(i => i.name === b.item).reduce((t, i) => t + i.count, 0);
            const spare = wanted.has(b.item) ? have - 1 : have;
            return spare >= b.qty && this.coins(b.poster) >= b.reward;
        });
        if (!options.length) return false;
        // greedy bots chase the best pay; others take the oldest job
        options.sort((a, b) => (p.greed > 0.5 ? b.reward / b.qty - a.reward / a.qty : a.posted - b.posted));
        const b = options[0];
        this.social.setBounty(b, 'claimed', name);
        this.dm(name, b.poster, `I'll take bounty #${b.id}: ${b.qty} ${b.item} for ${b.reward}gp. Coming to you.`);
        this.open({ buyer: b.poster, seller: name, item: b.item, amount: b.qty, price: b.reward, kind: 'bounty', bountyId: b.id });
        return true;
    }

    maybePostBounties(name) {
        const p = this.social.p(name);
        const s = this.bots.get(name).bot.s;
        const plan = this.bots.get(name).plan().map(x => x.task);
        const post = (item, qty) => {
            const reward = Math.max(qty, Math.round(this.perceived(name, item) * qty * (1 + 0.3 * p.generosity - 0.1 * p.greed)));
            if (this.coins(name) < reward + 5) return;
            if (this.social.postBounty(name, item, qty, reward)) {
                const text = this.social.line(name, 'bounty', '');
                if (text) this.bots.get(name).bot.act({ type: 'say', text: `${text} ${qty} ${item}, ${reward}gp` });
            }
        };
        // fighters want food
        if (plan.some(t => ['melee', 'ranged'].includes(t)) && faction(name) === 'individual') {
            const food = s.inv.filter(i => ['Shrimps', 'Anchovies', 'Trout', 'Salmon'].includes(i.name)).length;
            if (food < 3) post('Shrimps', 5);
        }
        // tools nobody is selling and no shop/free source nearby (e.g. a bow, runes)
        for (const need of this.needsOf(name)) if (['Shortbow', 'Bronze arrow', 'Air rune', 'Mind rune'].includes(need)) post(need, need.includes('rune') || need.includes('arrow') ? 20 : 1);
    }

    open(d) {
        const deal = { id: ++this.seq, ...d, state: 'meeting', started: Date.now() };
        // freeze each side's valuation of the traded item now: once it moves onto the trade window
        // the owner's inventory changes and its perceived value would jump mid-trade
        deal.snap = {};
        for (const who of [d.buyer, d.seller]) deal.snap[who] = { [d.item]: this.perceived(who, d.item), Coins: 1 };
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
        if (outcome === 'completed' && deal.kind === 'sale') {
            (this.memory[deal.item] ??= []).push(deal.price / (deal.amount ?? 1));
            this.social.bumpMood(deal.buyer, 0.05, 'a good deal');
            this.social.bumpMood(deal.seller, 0.05, 'a good deal');
        }
        if (outcome === 'completed' && deal.kind === 'wager') {
            this.social.bumpMood(deal.buyer, 0.15, 'winning a coin flip');
            this.social.bumpMood(deal.seller, -0.15, 'losing a coin flip');
        }
        if (outcome === 'completed' && deal.kind === 'favor') {
            const iou = this.social.createIou(deal.buyer, deal.seller, deal.item, deal.value);
            this.dm(deal.seller, deal.buyer, `You owe me ${iou.owed} coins for the ${deal.item}. Due in an hour.`);
        }
        if (outcome === 'completed' && deal.kind === 'gift' && sameGuild(deal.buyer, deal.seller)) {
            // politics: paying into the treasury is taxed; receiving help builds goodwill
            if (deal.item === 'Coins' && deal.buyer === treasurerOf(deal.buyer)) onContribution(this.social, deal.seller, deal.amount ?? 0);
            else onHelped(this.social, deal.buyer, deal.seller, deal.item === 'Coins' ? deal.amount ?? 0 : this.storeValue(deal.item));
            this.social.save();
        }
        if (deal.kind === 'debtsale' && outcome === 'completed') {
            const iou = this.social.ious.find(i => i.id === deal.iouId);
            if (iou && iou.status === 'open') this.social.transferIou(iou, deal.buyer, deal.price);
        }
        if (deal.kind === 'bounty') {
            const b = this.social.bounties.find(x => x.id === deal.bountyId);
            if (b) this.social.setBounty(b, outcome === 'completed' ? 'done' : 'open', outcome === 'completed' ? deal.seller : null);
            if (outcome === 'completed') { this.social.adjustTrust(deal.buyer, deal.seller, 0.1); this.social.adjustTrust(deal.seller, deal.buyer, 0.05); this.social.save(); }
        }
        // a rejected lopsided offer is a strike; two strikes and the rejecting bot holds a grudge
        const rej = /^rejected by (\w+)/.exec(outcome);
        if (rej && ['sale'].includes(deal.kind)) this.social.strike(rej[1], rej[1] === deal.buyer ? deal.seller : deal.buyer, 'repeated unfair offers');
        if (outcome === 'completed' && deal.kind === 'repay') {
            const iou = this.social.ious.find(i => i.id === deal.iouId);
            if (iou && iou.status === 'open') this.social.settle(iou, true);
        }
        if (outcome === 'completed') this.diary(deal);
        if (outcome === 'completed') {
            const event = { sale: 'sale', favor: 'favor', repay: 'repaid', bounty: 'bountyDone', wager: 'wagerWin' }[deal.kind];
            const speaker = deal.kind === 'repay' || deal.kind === 'wager' ? deal.buyer : deal.seller;
            const other = speaker === deal.buyer ? deal.seller : deal.buyer;
            const text = event && this.social.line(speaker, event, other);
            if (text) this.bots.get(speaker)?.bot.act({ type: 'say', text }).catch?.(() => {});
        }
        const rec = { t: new Date().toISOString(), id: deal.id, buyer: deal.buyer, seller: deal.seller, item: deal.item, amount: deal.amount ?? 1, price: deal.price, kind: deal.kind, ask: deal.ask, bid: deal.bid, venue: deal.venue, outcome };
        fs.appendFileSync(LEDGER, JSON.stringify(rec) + '\n');
        this.log(`[market] deal #${deal.id} ${outcome}`);
    }

    // diary lines for a completed deal
    diary(d) {
        const n = d.amount ?? 1, what = `${n > 1 ? n + ' ' : ''}${d.item}`, where = d.venue ? ` at the ${d.venue}` : '';
        if (d.kind === 'sale') {
            if (record(d.buyer, 'biggest-buy', d.price)) note(d.buyer, `Biggest purchase yet: ${what} from ${d.seller} for ${d.price}gp${where}.`);
            if (record(d.seller, 'biggest-sale', d.price)) note(d.seller, `Biggest sale yet: ${what} to ${d.buyer} for ${d.price}gp${where}.`);
        } else if (d.kind === 'favor') {
            note(d.buyer, `Borrowed ${what} from ${d.seller} on an IOU.`);
            note(d.seller, `Lent ${what} to ${d.buyer} on an IOU.`);
        } else if (d.kind === 'repay') {
            note(d.seller, `Paid off my ${n}gp debt to ${d.buyer}.`);
            note(d.buyer, `${d.seller} paid me back ${n}gp.`);
        } else if (d.kind === 'debtsale') {
            const iou = this.social.ious.find(i => i.id === d.iouId);
            note(d.buyer, `Bought ${d.seller}'s claim on ${iou?.debtor ?? 'a debtor'} for ${d.price}gp. Time to collect.`);
            note(d.seller, `Sold my claim on ${iou?.debtor ?? 'a debtor'} to ${d.buyer} for ${d.price}gp.`);
        } else if (d.kind === 'bounty') {
            note(d.seller, `Delivered ${what} to ${d.buyer} for a ${d.price}gp bounty.`);
        } else if (d.kind === 'wager') {
            note(d.buyer, `Won ${n}gp from ${d.seller} on a coin flip.`);
            note(d.seller, `Lost ${n}gp to ${d.buyer} on a coin flip.`);
        }
    }

    // Each side judges the open trade window with its OWN perceived values.
    acceptable(name, trade, deal) {
        const partner = name === deal.buyer ? deal.seller : deal.buyer;
        if (sameGuild(name, partner)) return true;
        if (['favor', 'repay', 'debtsale', 'bounty', 'wager', 'party'].includes(deal.kind)) return true; // agreed contract (IOU / posted bounty / quest party)
        const val = list => list.reduce((t, i) => t + (deal.snap?.[name]?.[i.name] ?? this.perceived(name, i.name)) * i.count, 0);
        const give = val(trade.mine), get = val(trade.theirs);
        if (give === 0) return true;
        const ok = get >= give * this.social.acceptRatio(name, partner);
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
            // a seller (e.g. a treasurer giving from the team stash) fetches the goods from its bank first
            const want = deal.amount ?? 1;
            const carried = s.inv.filter(i => i.name === deal.item).reduce((t, i) => t + i.count, 0);
            if (!isBuyer && !['debtsale', 'repay', 'wager'].includes(deal.kind) && deal.item !== 'Coins' && carried < want && s.bank?.some(i => i.name === deal.item) && !deal.fetched) {
                deal.fetched = true;
                if (await bot.openBank()) {
                    for (let k = carried; k < want && bot.s.invFree > 0; k++) await bot.withdraw(deal.item, 1);
                    await bot.leaveBank();
                }
                return true;
            }
            if (s.z !== 0 || ps.z !== 0) { // get out of the bank tower first
                if (s.z !== 0) await bot.leaveBank();
                else await bot.wait(3);
                return true;
            }
            if (isBuyer && dist(s, ps) > 2) { await (dist(s, ps) > 40 ? bot.travel(ps.x, ps.y, { tol: 2, timeout: 240 }) : bot.walkTo(ps.x, ps.y, { tol: 2, timeout: 60 })); return true; }
            if (dist(s, ps) <= 3) { await bot.act({ type: 'player', name: partner.name, op: 'Trade with' }); await bot.wait(3); }
            else await bot.wait(2);
            return true;
        }

        deal.state = 'trading';
        const t = s.trade;
        const myItem = isBuyer ? (deal.price > 0 ? 'Coins' : null) : deal.kind === 'debtsale' ? null : deal.item;
        const myAmount = isBuyer ? deal.price : deal.amount ?? 1;
        const offered = t.mine.reduce((n, i) => n + (i.name === myItem ? i.count : 0), 0);
        if (myItem && offered < myAmount && !t.myAccepted) {
            const inv = s.inv.find(i => i.name === myItem);
            if (!inv) { await bot.act({ type: 'tradedecline' }); this.close(deal, `${bot.name} lacks ${myItem}`); return false; }
            const left = myAmount - offered;
            // "offer all" puts every unit of this item on the window, so only use it when we mean to give all of them
            const total = s.inv.filter(i => i.name === myItem).reduce((n, i) => n + i.count, 0);
            await bot.act({ type: 'tradeoffer', slot: inv.slot, amount: left >= total ? 'all' : left >= 10 && inv.count >= 10 ? 10 : left >= 5 && inv.count >= 5 ? 5 : 1 });
            await bot.wait(1);
            return true;
        }
        const theirCount = n => t.theirs.filter(i => i.name === n).reduce((c, i) => c + i.count, 0);
        const theirsReady = isBuyer
            ? deal.kind === 'debtsale' || theirCount(deal.item) >= (deal.kind === 'bounty' ? deal.amount : 1)
            : deal.price === 0 || theirCount('Coins') >= deal.price;
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
