// Gossip and rumours (roadmap 40). Fresh diary events (defaults, grudges, wins, deaths, riches) become rumours
// about a bot. Every 15 minutes chatty bots pass rumours on to bots they trust; each retelling may make it worse
// ("owes 5gp" -> "never pays back" -> "is a thief"). Hearers' trust in the subject moves with what they hear
// (more for the worse versions). A subject who hears a grown rumour about itself denies it in public; friends
// who trust it then believe it less, and the rumour stops spreading. market/rumours.json; the recap prints them.
//   gossipTick(market, log)   the runner calls it every 15 min
import fs from 'fs';
import path from 'path';
import { readDiaries, note } from './diary.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'rumours.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { seq: 0, last: Date.now(), rumours: [] }; } };
const write = v => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(v, null, 1)); };

// each kind: three versions, mildest (true) first; tone: how hearing it moves trust in the subject
const KINDS = {
    default: { tone: -1, v: ['{s} owes {o} {n}gp and never paid', '{s} never pays back what they owe', '{s} is a thief'] },
    grudge: { tone: -1, v: ['{o} and {s} have fallen out', '{s} cheated {o}', '{s} cheats everyone'] },
    death: { tone: 0, v: ['{s} died out near {where}', '{s} keeps dying', '{s} is cursed'] },
    win: { tone: 1, v: ['{s} {what}', '{s} {what}, easily', "{s} can't be beaten"] },
    rich: { tone: 0, v: ['{s} has quite a few coins', '{s} is sitting on a fortune', '{s} must be stealing to be that rich'] }
};
const fill = (t, r) => t.replace('{s}', r.about).replace('{o}', r.other ?? 'someone').replace('{n}', r.n ?? 'some').replace('{where}', r.where ?? 'Lumbridge').replace('{what}', r.what ?? 'won something');

// new rumours from the diaries since the last tick
function harvest(st) {
    const since = st.last ?? Date.now() - 15 * 60_000;
    const add = r => { if (!st.rumours.some(x => x.about === r.about && x.kind === r.kind && Date.now() - x.t < 6 * 3600_000)) st.rumours.push({ id: ++st.seq, t: Date.now(), level: 0, knowers: [r.source ?? r.about], denied: false, ...r }); };
    for (const e of readDiaries(since)) {
        let m;
        if ((m = /^(\w+) never paid back the (\d+)gp/.exec(e.text))) add({ kind: 'default', about: m[1], other: e.bot, n: m[2], source: e.bot });
        else if ((m = /^Holding a grudge against (\w+)/.exec(e.text))) add({ kind: 'grudge', about: m[1], other: e.bot, source: e.bot });
        else if ((m = /^Died (?:for the first time|again), at (\d+),(\d+)/.exec(e.text))) add({ kind: 'death', about: e.bot, where: Number(m[2]) > 3400 ? 'Varrock' : Number(m[1]) < 3150 ? 'Draynor' : 'Lumbridge', source: e.bot });
        else if ((m = /^(Won the [\w ]+?)(?: \(|!)/.exec(e.text))) add({ kind: 'win', about: e.bot, what: m[1].toLowerCase().replace(/^won/, 'won'), source: e.bot });
        else if (/^Beat \w+ in a duel/.test(e.text)) add({ kind: 'win', about: e.bot, what: `beat ${/^Beat (\w+)/.exec(e.text)[1]} in a duel`, source: e.bot });
    }
    st.last = Date.now();
}

export function gossipTick(market, log = () => {}, richest = null) {
    const st = read();
    harvest(st);
    if (richest && !st.rumours.some(r => r.kind === 'rich' && r.about === richest && Date.now() - r.t < 24 * 3600_000)) st.rumours.push({ id: ++st.seq, t: Date.now(), kind: 'rich', about: richest, level: 0, knowers: [richest], denied: false });
    const s = market.social, online = n => market.bots.get(n)?.bot.s?.online;
    let told = 0;
    for (const r of st.rumours.filter(r => !r.denied && Date.now() - r.t < 2 * 86400_000)) {
        // the subject heard it, and it has grown: a public denial
        if (r.level > 0 && r.knowers.includes(r.about) && !r.denied && online(r.about)) {
            r.denied = true;
            market.bots.get(r.about).bot.act({ type: 'say', text: `Whoever says "${fill(KINDS[r.kind].v[r.level], r).replace(r.about + ' ', '')}" is lying!`.slice(0, 80) }).catch(() => {});
            for (const k of r.knowers) if (k !== r.about && s.trust(k, r.about) > 0.1) s.adjustTrust(k, r.about, 0.03);
            note(r.about, `Heard people saying "${fill(KINDS[r.kind].v[r.level], r)}". Set the record straight.`);
            log(`[gossip] ${r.about} denies: "${fill(KINDS[r.kind].v[r.level], r)}"`);
            continue;
        }
        // spread: a chatty knower tells someone it trusts (at most 3 retellings a tick overall)
        if (told >= 3) continue;
        const teller = r.knowers.filter(k => online(k) && k !== r.about && Math.random() < s.p(k).sociability * 0.6)[0] ?? (r.knowers.length === 1 && online(r.knowers[0]) ? r.knowers[0] : null);
        if (!teller) continue;
        const hearer = [...market.bots.keys()].filter(n => n !== teller && n !== r.about && !r.knowers.includes(n) && online(n) && s.trust(teller, n) >= 0).sort(() => Math.random() - 0.5)[0]
            ?? (r.level > 0 && !r.knowers.includes(r.about) && online(r.about) ? r.about : null);
        if (!hearer) continue;
        // retelling can make it worse: gossipy tellers more so
        if (r.level < 2 && Math.random() < 0.15 + 0.3 * s.p(teller).sociability) r.level++;
        const text = fill(KINDS[r.kind].v[r.level], r);
        r.knowers.push(hearer);
        told++;
        if (hearer !== r.about) s.adjustTrust(hearer, r.about, 0.02 * (r.level + 1) * KINDS[r.kind].tone || 0);
        market.dm?.(teller, hearer, `Did you hear? ${text}.`.slice(0, 80));
        log(`[gossip] ${teller} -> ${hearer}: "${text}"`);
    }
    st.rumours = st.rumours.filter(r => Date.now() - r.t < 7 * 86400_000);
    s.save?.();
    write(st);
    return told;
}

// for the recap: rumours that spread in the window, by reach
export function rumourMarkdown(since) {
    const top = read().rumours.filter(r => r.t >= since && r.knowers.length > 2).sort((a, b) => b.knowers.length - a.knowers.length).slice(0, 5);
    if (!top.length) return [];
    return ['## The rumour mill', '', ...top.map(r => `- "${fill(KINDS[r.kind].v[r.level], r)}" (heard by ${r.knowers.length}${r.level ? `; it started as "${fill(KINDS[r.kind].v[0], r)}"` : ''}${r.denied ? `; ${r.about} denies it` : ''})`), ''];
}
