// Mayor of Lumbridge (roadmap 43). Every 7 days the five most trusted bots stand; every bot votes for the candidate it
// trusts most. The mayor: picks the next festival (from its career: fisher -> fishing contest, smith -> smithing
// fair, fighter -> duel tournament), pardons one open debt of someone it trusts, and gets the blame for a bad week
// (many deaths, or a director alert): town trust in it drops and the grumbling is heard. market/mayor.json.
//   mayorTick(market, log)   hourly from the runner
import fs from 'fs';
import path from 'path';
import { note, readDiaries } from './diary.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const FILE = path.join(ROOT, 'market', 'mayor.json');
const TERM = Number(process.env.MAYOR_TERM_HOURS ?? 168) * 3600_000;
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const save = v => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(v, null, 1)); };
const FESTIVAL = { fisher: 'fishing', smith: 'smithing', fighter: 'duels' };

export const mayorOf = () => read(FILE, {}).mayor ?? null;

export function mayorTick(market, log = () => {}) {
    const st = read(FILE, { mayor: null, since: 0, history: [] }), s = market.social, now = Date.now();
    const say = (n, t) => market.bots.get(n)?.bot.act({ type: 'say', text: t.slice(0, 80) }).catch(() => {});
    // blame: a bad day under this mayor (6+ deaths in the last 24 h, checked once a day)
    if (st.mayor && now - (st.lastBlame ?? st.since) > 86400_000) {
        st.lastBlame = now;
        const deaths = readDiaries(now - 86400_000).filter(e => /^Died/.test(e.text)).length;
        const alerts = read(path.join(ROOT, 'market', 'director.json'), { alerts: [] }).alerts.length;
        if (deaths >= 6 || alerts) {
            for (const [o] of market.bots) if (o !== st.mayor) s.adjustTrust(o, st.mayor, -0.02);
            const grumbler = [...market.bots.keys()].find(o => o !== st.mayor && market.bots.get(o).bot.s?.online && s.trust(o, st.mayor) < 0.1);
            if (grumbler) say(grumbler, deaths >= 6 ? `${deaths} dead in a day. Some mayor ${st.mayor} is.` : `What is ${st.mayor} doing about this mess?`);
            log(`[mayor] ${st.mayor} takes the blame (${deaths} deaths, ${alerts} alerts)`);
        }
    }
    if (now - st.since < TERM && st.mayor) { save(st); return st.mayor; }
    // election
    const held = {};
    for (const [a, row] of Object.entries(s.trustMap)) for (const [b, v] of Object.entries(row ?? {})) (held[b] ??= []).push(v);
    const candidates = Object.entries(held).filter(([b, v]) => v.length >= 5 && market.bots.has(b)).map(([b, v]) => [b, v.reduce((x, y) => x + y, 0) / v.length]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b]) => b);
    if (candidates.length < 2) return null;
    const votes = Object.fromEntries(candidates.map(c => [c, 0]));
    for (const [voter] of market.bots) { const pick = [...candidates].sort((a, b) => s.trust(voter, b) - s.trust(voter, a))[0]; if (pick) votes[pick]++; }
    const [winner, n] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    const old = st.mayor;
    st.history.push({ mayor: winner, votes, t: new Date().toISOString() });
    st.history = st.history.slice(-20);
    Object.assign(st, { mayor: winner, since: now, lastBlame: now });
    log(`[mayor] ELECTION: ${winner} is mayor of Lumbridge (${Object.entries(votes).map(([c, v]) => `${c} ${v}`).join(', ')})`);
    note(winner, `Elected mayor of Lumbridge with ${n} votes!`);
    if (old && old !== winner) note(old, `Lost the mayoralty to ${winner}.`);
    say(winner, old === winner ? 'Re-elected! Thank you, Lumbridge.' : 'I am your new mayor. Lumbridge will prosper!');
    // first acts: choose the next festival, pardon a friend's debt
    const career = read(path.join(ROOT, 'market', 'careers.json'), {})[winner]?.career;
    const ev = read(path.join(ROOT, 'market', 'events.json'), null);
    if (ev && !ev.current && FESTIVAL[career]) { ev.kind = FESTIVAL[career]; fs.writeFileSync(path.join(ROOT, 'market', 'events.json'), JSON.stringify(ev, null, 1)); log(`[mayor] ${winner} declares the next festival: ${ev.kind}`); note(winner, `Declared the next festival: the ${ev.kind === 'duels' ? 'duel tournament' : ev.kind === 'fishing' ? 'fishing contest' : 'smithing fair'}.`); }
    const debt = s.ious.filter(i => i.status === 'open' && s.trust(winner, i.debtor) > 0.1 && i.debtor !== winner).sort((a, b) => b.owed - a.owed)[0];
    if (debt) {
        debt.status = 'pardoned'; debt.settled = now;
        s.saveIous?.();
        s.adjustTrust(debt.creditor, winner, -0.1); s.adjustTrust(debt.debtor, winner, 0.15);
        note(winner, `Pardoned ${debt.debtor}'s ${debt.owed}gp debt to ${debt.creditor}.`);
        note(debt.creditor, `The mayor, ${winner}, wiped out the ${debt.owed}gp ${debt.debtor} owed me. Outrageous.`);
        say(winner, `By order of the mayor, ${debt.debtor}'s debt is forgiven.`);
        log(`[mayor] ${winner} pardons ${debt.debtor}'s ${debt.owed}gp debt to ${debt.creditor}`);
    }
    s.save?.();
    save(st);
    return winner;
}
