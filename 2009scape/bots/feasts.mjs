// Feasts (roadmap 44): when a team member wins something (a contest, a duel, a quest), the team's best-stocked
// cook calls a feast: it hands food to each teammate online (real gift trades), everyone's mood lifts and they
// trust each other a little more. At most one feast per team a day. Hourly from the runner; market/feasts.json.
import fs from 'fs';
import path from 'path';
import { readDiaries, note } from './diary.mjs';
import { FOOD } from './lib.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'feasts.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { last: Date.now(), byTeam: {} }; } };

export function feasts(market, log = () => {}) {
    const st = read(), s = market.social, now = Date.now();
    const wins = readDiaries(st.last).filter(e => /^(Won the |Beat \w+ in a duel|Completed (?!my ).*Quest points|Elected mayor)/.test(e.text));
    st.last = now;
    for (const w of wins) {
        const team = s.teamOf(w.bot);
        if (team === 'individual' || now - (st.byTeam[team] ?? 0) < 86400_000) continue;
        const members = [...market.bots.keys()].filter(n => s.teamOf(n) === team && market.bots.get(n).bot.s?.online);
        const food = n => { const b = market.bots.get(n).bot.s; return [...(b.inv ?? []), ...(b.bank ?? [])].filter(i => FOOD.includes(i.name)).reduce((t, i) => t + i.count, 0); };
        const cook = members.sort((a, b) => food(b) - food(a))[0];
        if (!cook || food(cook) < members.length) continue;
        st.byTeam[team] = now;
        const dish = [...(market.bots.get(cook).bot.s.bank ?? []), ...market.bots.get(cook).bot.s.inv].find(i => FOOD.includes(i.name))?.name;
        market.bots.get(cook).bot.act({ type: 'say', text: `Feast for ${w.bot}! ${dish ?? 'Food'} for everyone in ${team}!`.slice(0, 80) }).catch(() => {});
        for (const m of members) {
            if (m !== cook && dish) market.open({ buyer: m, seller: cook, item: dish, amount: 2, price: 0, kind: 'gift' });
            s.bumpMood?.(m, 0.15, `the feast for ${w.bot}`);
            for (const o of members) if (o !== m) s.adjustTrust(m, o, 0.03);
            note(m, m === cook ? `Cooked a feast for ${team} to celebrate ${w.bot}.` : `${team} feasted to celebrate ${w.bot}.`);
        }
        s.save?.();
        log(`[feast] ${team} feasts for ${w.bot} (${w.text.slice(0, 40)}); ${cook} cooks ${dish}`);
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st, null, 1));
}
