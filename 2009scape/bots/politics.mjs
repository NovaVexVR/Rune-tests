// Team politics (roadmap Phase 2): scoreboard, taxes & mutiny, leaving & recruiting.
// Team membership lives in market/teams.json and is the source of truth for factions.
import { setStep } from './steps.mjs';
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FILE = path.join(ROOT, 'market', 'teams.json');
const SCORES = path.join(ROOT, 'market', 'scores.jsonl');
const ORDERS = path.join(ROOT, 'orders');

export const DEFAULT_TEAMS = {
    guild: { prefix: 'guildbot', size: 5, treasurer: 'guildbot5' },
    wolf: { prefix: 'wolfbot', size: 5, treasurer: 'wolfbot5' },
    hawk: { prefix: 'hawkbot', size: 5, treasurer: 'hawkbot5' },
    bear: { prefix: 'bearbot', size: 5, treasurer: 'bearbot5' },
    legion: { prefix: 'legion', size: 20, treasurer: 'legion1' }
};

function initialState() {
    const teams = {};
    for (const [t, d] of Object.entries(DEFAULT_TEAMS)) {
        teams[t] = { members: Array.from({ length: d.size }, (_, i) => `${d.prefix}${i + 1}`), treasurer: d.treasurer, maxSize: d.size, focus: null };
    }
    return { teams, sat: {}, cooldown: {}, history: [] };
}

export const STATE = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : initialState();
export const saveState = () => fs.writeFileSync(FILE, JSON.stringify(STATE, null, 2));
if (!fs.existsSync(FILE)) saveState();

export function teamOf(name) {
    for (const [t, d] of Object.entries(STATE.teams)) if (d.members.includes(name)) return t;
    return 'individual';
}
// team diplomacy (D16): 'allied', 'feud' or 'neutral' between two teams
const relKey = (a, b) => [a, b].sort().join('|');
export function relationOf(ta, tb) {
    if (!ta || !tb || ta === tb || ta === 'individual' || tb === 'individual') return 'neutral';
    return STATE.relations?.[relKey(ta, tb)]?.status ?? 'neutral';
}
export const treasurerOfTeam = team => STATE.teams[team]?.treasurer ?? null;

// treasurers keep a cut of what members pay in, set by their greed
export const taxRate = (social, team) => {
    const tre = treasurerOfTeam(team);
    return tre ? Math.round((0.05 + 0.25 * social.p(tre).greed) * 100) / 100 : 0;
};

import { note } from './diary.mjs';

function event(log, text) {
    STATE.history.push({ t: new Date().toISOString(), text });
    if (STATE.history.length > 300) STATE.history.splice(0, STATE.history.length - 300);
    log(`[politics] ${text}`);
}

// Called when a member hands coins to its treasurer: the tax makes it a little less trusting.
export function onContribution(social, member, amount) {
    const team = teamOf(member);
    const tre = treasurerOfTeam(team);
    if (!tre || tre === member) return;
    const rate = taxRate(social, team);
    social.adjustTrust(member, tre, -Math.min(0.15, rate * 0.3 + amount / 2000));
    (STATE.sat[member] ??= { given: 0, got: 0 }).given += amount;
}

// Called when a member receives help (items or coins) from a teammate.
export function onHelped(social, member, from, value) {
    social.adjustTrust(member, from, 0.05);
    (STATE.sat[member] ??= { given: 0, got: 0 }).got += value;
}

function satisfaction(social, name) {
    const team = teamOf(name);
    if (team === 'individual') return 0;
    const mates = STATE.teams[team].members.filter(m => m !== name);
    const avgTrust = mates.length ? mates.reduce((t, m) => t + social.trust(name, m), 0) / mates.length : 0;
    const tre = treasurerOfTeam(team);
    const treTrust = tre && tre !== name ? social.trust(name, tre) : 0;
    const s = STATE.sat[name] ?? { given: 0, got: 0 };
    const balance = Math.max(-0.5, Math.min(0.5, (s.got - s.given * 0.5) / 200));
    return Math.round((avgTrust + treTrust + balance) * 100) / 100;
}

function rewritePlansForSwap(a, b) {
    // the new treasurer takes the treasurer's plan; the old one takes the new one's plan
    const fa = path.join(ORDERS, `${a}.json`), fb = path.join(ORDERS, `${b}.json`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) return;
    const oa = JSON.parse(fs.readFileSync(fa, 'utf8')), ob = JSON.parse(fs.readFileSync(fb, 'utf8'));
    [oa.plan, ob.plan] = [ob.plan, oa.plan];
    [oa.role, ob.role] = [ob.role, oa.role];
    delete oa.step; delete ob.step; setStep(a, 0); setStep(b, 0);
    fs.writeFileSync(fa, JSON.stringify(oa, null, 2));
    fs.writeFileSync(fb, JSON.stringify(ob, null, 2));
}

// Caps grow with the population: limits were tuned for 50 Claude-directed bots.
export const BASE_POPULATION = 50;
export const scale = market => Math.max(1, market.bots.size / BASE_POPULATION);
export const capFor = (market, base) => Math.ceil(base * scale(market));

// One "council" pass: scoreboard, mutinies, departures, recruitment.
export function council(market) {
    const social = market.social;
    const log = market.log;
    const say = (name, text) => market.bots.get(name)?.bot.act({ type: 'say', text: text.slice(0, 80) });
    const online = n => market.bots.get(n)?.bot.s?.online;

    // ---- 2.1 scoreboard ----
    const scores = {};
    for (const [team, d] of Object.entries(STATE.teams)) {
        let total = 0, wealth = 0, quests = 0;
        for (const m of d.members) {
            const s = market.bots.get(m)?.bot.s;
            if (!s?.stats) continue;
            total += s.totalLevel;
            quests += s.questPoints ?? 0;
            wealth += (s.coins ?? 0) + (s.bank ?? []).reduce((t, i) => t + (i.name === 'Coins' ? i.count : 0), 0);
            wealth += (s.inv ?? []).filter(i => i.name !== 'Coins').reduce((t, i) => t + market.perceived(m, i.name) * i.count, 0);
        }
        // quest points count toward the score: each is worth 5 total levels
        scores[team] = { members: d.members.length, total, wealth: Math.round(wealth), quests, perMember: Math.round((total + 5 * quests) / Math.max(1, d.members.length)) };
    }
    fs.appendFileSync(SCORES, JSON.stringify({ t: new Date().toISOString(), scores }) + '\n');
    const ranked = Object.entries(scores).sort((a, b) => b[1].perMember - a[1].perMember);
    if (ranked.length) {
        const [leader] = ranked[0];
        for (const [t, d] of Object.entries(STATE.teams)) {
            const herald = [...d.members].filter(online).sort((a, b) => social.p(b).sociability - social.p(a).sociability)[0];
            if (herald) say(herald, `${t}: score ${scores[t].perMember}, ${scores[t].quests} quest pts, ${scores[t].wealth}gp${t === leader ? ' - we lead!' : ''}`);
        }
        // prestige: outsiders think a little better of the leading team
        for (const [other] of market.bots) if (teamOf(other) !== leader) for (const m of STATE.teams[leader].members) social.adjustTrust(other, m, 0.02);
        // the poorest team (per member) focuses on money next cycle
        const poorest = Object.entries(scores).sort((a, b) => a[1].wealth / a[1].members - b[1].wealth / b[1].members)[0]?.[0];
        for (const [t, d] of Object.entries(STATE.teams)) d.focus = t === poorest ? 'money' : null;
        event(log, `scoreboard: ${ranked.map(([t, s]) => `${t} ${s.perMember}`).join(', ')}; ${leader} leads, ${poorest} focuses on money`);
    }

    // ---- 2.2 mutiny ----
    for (const [team, d] of Object.entries(STATE.teams)) {
        const tre = d.treasurer;
        const others = d.members.filter(m => m !== tre);
        if (!others.length) continue;
        const avg = others.reduce((t, m) => t + social.trust(m, tre), 0) / others.length;
        if (avg < -0.3) {
            // vote: the member the others trust most
            const cand = others.map(c => ({ c, v: others.filter(o => o !== c).reduce((t, o) => t + social.trust(o, c), 0) })).sort((a, b) => b.v - a.v)[0].c;
            d.treasurer = cand;
            rewritePlansForSwap(cand, tre);
            for (const m of others) social.adjustTrust(m, cand, 0.1);
            event(log, `MUTINY in ${team}: members (avg trust ${avg.toFixed(2)}) voted out ${tre}; ${cand} is the new treasurer`);
            note(tre, `Voted out as ${team}'s treasurer. ${cand} takes over.`);
            note(cand, `Elected treasurer of ${team} after the vote against ${tre}.`);
            if (online(cand)) say(cand, `The ${team} treasury is mine now. No more skimming.`);
        }
    }

    // ---- 2.3 leaving ----
    const now = Date.now();
    for (const [team, d] of Object.entries(STATE.teams)) {
        for (const m of [...d.members]) {
            const sat = satisfaction(social, m);
            const rec = (STATE.sat[m] ??= { given: 0, got: 0 });
            if (sat < -0.5) rec.lowSince ??= now; else delete rec.lowSince;
            const tre = d.treasurer;
            if (rec.lowSince && now - rec.lowSince > 2 * 3600_000 && tre !== m && social.trust(m, tre) < 0) {
                d.members = d.members.filter(x => x !== m);
                STATE.cooldown[m] = now + 6 * 3600_000;
                delete rec.lowSince;
                for (const mate of d.members) social.adjustTrust(mate, m, -0.3);
                event(log, `${m} LEFT ${team} (satisfaction ${sat}); now an individualist`);
                note(m, `Quit ${team}. Going my own way.`);
                if (tre && online(tre)) market.dm(m, tre, `I quit ${team}. You took too much.`);
                if (online(m)) say(m, `I'm done with ${team}. Going my own way.`);
            }
        }
    }

    // ---- 2.3 recruiting ----
    for (const [team, d] of Object.entries(STATE.teams)) {
        if (d.members.length >= capFor(market, d.maxSize)) continue;
        const candidates = [...market.bots.keys()].filter(n => teamOf(n) === 'individual' && !(STATE.cooldown[n] > now) && online(n));
        for (const c of candidates) {
            const theirTrust = d.members.reduce((t, m) => t + social.trust(m, c), 0) / Math.max(1, d.members.length);
            const myTrust = d.members.reduce((t, m) => t + social.trust(c, m), 0) / Math.max(1, d.members.length);
            if (theirTrust < 0.3 || myTrust < 0.3) continue;
            const p = social.p(c);
            const accepts = p.loyalty > 0.5 || p.sociability > 0.6 || (p.greed > 0.6 && taxRate(social, team) < 0.15);
            const inviter = d.treasurer && online(d.treasurer) ? d.treasurer : d.members.find(online);
            if (inviter) market.dm(inviter, c, `${team} wants you. Join us?`);
            event(log, `${team} invited ${c} (trust ${theirTrust.toFixed(2)}/${myTrust.toFixed(2)}): ${accepts ? 'accepted' : 'declined'}`);
            note(c, accepts ? `Joined ${team}.` : `Turned down an invitation to join ${team}.`);
            if (inviter) market.dm(c, inviter, accepts ? `Count me in.` : `Thanks, but I work alone.`);
            if (!accepts) { STATE.cooldown[c] = now + 2 * 3600_000; continue; }
            d.members.push(c);
            if (online(c)) say(c, `Proud to join ${team}!`);
            break;
        }
    }
    // ---- D16 diplomacy: alliances and feuds between teams ----
    // team trust = the average trust every member of one team holds in every member of the other, both ways.
    // Allied after two councils in a row above +0.08 with no grudges between them; a feud below -0.08 or with
    // three or more cross-team grudges. Alliances break below 0; feuds end above -0.05 (once 6 hours old).
    STATE.relations ??= {};
    const names = Object.keys(STATE.teams);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        const [ta, tb] = [names[i], names[j]], A = STATE.teams[ta].members, B = STATE.teams[tb].members;
        if (!A.length || !B.length) continue;
        let sum = 0, n = 0, grudges = 0;
        for (const a of A) for (const b of B) { sum += social.trust(a, b) + social.trust(b, a); n += 2; if (social.isRival?.(a, b) || social.isRival?.(b, a)) grudges++; }
        const t = sum / n, key = relKey(ta, tb);
        const r = (STATE.relations[key] ??= { status: 'neutral', since: now, streak: 0 });
        r.trust = Math.round(t * 100) / 100;
        const herald = team => STATE.teams[team].members.filter(online).sort((x, y) => social.p(y).sociability - social.p(x).sociability)[0];
        if (r.status === 'neutral') {
            if (t < -0.08 || grudges >= 3) {
                Object.assign(r, { status: 'feud', since: now, streak: 0 });
                event(log, `FEUD: ${ta} and ${tb} are at odds (team trust ${r.trust}, ${grudges} grudges)`);
                for (const m of [...A, ...B]) note(m, `Our team is now feuding with ${A.includes(m) ? tb : ta}.`);
                const h = herald(ta); if (h) say(h, `${tb} can't be trusted. Don't trade with them.`);
            } else if (t > 0.08 && !grudges) {
                if (++r.streak >= 2) {
                    Object.assign(r, { status: 'allied', since: now, streak: 0 });
                    event(log, `ALLIANCE: ${ta} and ${tb} are now allies (team trust ${r.trust})`);
                    for (const m of [...A, ...B]) note(m, `Our team allied with ${A.includes(m) ? tb : ta}.`);
                    const h = herald(ta); if (h) say(h, `${ta} and ${tb} stand together now.`);
                }
            } else r.streak = 0;
        } else if (r.status === 'allied' && (t < 0 || grudges >= 2)) {
            Object.assign(r, { status: 'neutral', since: now, streak: 0 });
            event(log, `the ${ta}-${tb} alliance has broken (team trust ${r.trust})`);
            for (const m of [...A, ...B]) note(m, `Our alliance with ${A.includes(m) ? tb : ta} is over.`);
        } else if (r.status === 'feud' && t > -0.05 && grudges < 3 && now - r.since > 6 * 3600_000) {
            Object.assign(r, { status: 'neutral', since: now, streak: 0 });
            event(log, `${ta} and ${tb} have buried the hatchet (team trust ${r.trust})`);
        }
    }
    social.save();
    saveState();
    return scores;
}
