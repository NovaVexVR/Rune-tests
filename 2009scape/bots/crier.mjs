// Town crier and the tabloid (roadmap 42).
//  - crier(market): hourly, the most sociable bot near Lumbridge square shouts the freshest news (diaries, politics).
//  - tabloid(): a second daily paper, "The Lumbridge Whisper", by a journalist bot (the most sociable one) with
//    favourites (whom it trusts most) and enemies (least): the same news, spun. bots/recaps/<date>-whisper.md.
import fs from 'fs';
import path from 'path';
import { readDiaries } from './diary.mjs';
import { personalityOf } from './social.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const SQUARE = { x: 3222, y: 3218 };
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'market', f), 'utf8')); } catch { return d; } };

// newsworthy diary lines, freshest first, as short headlines
function news(sinceMs) {
    const out = [];
    for (const e of readDiaries(sinceMs).reverse()) {
        const t = e.text;
        let h = null;
        if (/^Won the /.test(t)) h = `${e.bot} ${t.replace(/^Won/, 'won').replace(/\s*\(.*$|!$/g, '')}`;
        else if (/^Beat \w+ in a duel/.test(t)) h = `${e.bot} ${t.replace(/^Beat/, 'beat').replace(/\. That settles it\.$/, '').replace(/ at the arena/, '')}`;
        else if (/^Completed .* Quest points/.test(t)) h = `${e.bot} finished ${/^Completed (.+?)( with|\.)/.exec(t)?.[1]}`;
        else if (/never paid back/.test(t)) h = `${/^(\w+)/.exec(t)[1]} stiffed ${e.bot}`;
        else if (/^They've started calling me/.test(t)) h = `${e.bot} is now known as "${/"([^"]+)"/.exec(t)?.[1]}"`;
        else if (/^Decided to make a living as/.test(t)) h = `${e.bot} becomes ${/as (an? [\w ]+)\./.exec(t)?.[1]}`;
        else if (/^Cooked a feast for/.test(t)) h = `${e.bot} ${t.replace(/^Cooked/, 'cooked').replace(/\.$/, '')}`;
        else if (/^Won \w+'s lottery/.test(t)) h = `${e.bot} ${t.replace(/^Won/, 'won').replace(/!$/, '')}`;
        else if (/^Kept the lottery pot/.test(t)) h = `${e.bot} ran off with the lottery pot`;
        else if (/^Won the treasure hunt/.test(t)) h = `${e.bot} won the treasure hunt`;
        else if (/^Elected mayor/.test(t)) h = `${e.bot} elected mayor of Lumbridge`;
        else if (/^Pardoned /.test(t)) h = `Mayor ${e.bot} ${t.replace(/^Pardoned/, 'pardons').replace(/\.$/, '')}`;
        else if (/^Reached my goal/.test(t)) h = `${e.bot} reached a goal: ${/goal: ([^!]+)!/.exec(t)?.[1]}`;
        if (h) out.push({ bot: e.bot, h, t: e.t });
    }
    // team politics and the court: at most three, newest first (the court can be busy)
    const pol = read('teams.json', { history: [] }).history.filter(x => Date.parse(x.t) >= sinceMs && /MUTINY|ALLIANCE|FEUD|LEFT|COURT/.test(x.text)).slice(-3).reverse();
    for (const x of pol) out.unshift({ bot: null, h: x.text.replace(/\s*\(.*?\)/g, '').replace(/^COURT: /, 'In court, '), t: x.t });
    return out;
}

export function crier(market, log = () => {}) {
    const items = news(Date.now() - 2 * 3600_000);
    if (!items.length) return null;
    const near = [...market.bots.keys()].filter(n => { const s = market.bots.get(n).bot.s; return s?.online && s.z === 0 && Math.abs(s.x - SQUARE.x) + Math.abs(s.y - SQUARE.y) < 25; });
    const crierBot = near.sort((a, b) => market.social.p(b).sociability - market.social.p(a).sociability)[0];
    if (!crierBot) return null;
    const item = items[0];
    market.bots.get(crierBot).bot.act({ type: 'say', text: `Hear ye! ${item.h}!`.slice(0, 80) }).catch(() => {});
    log(`[crier] ${crierBot}: ${item.h}`);
    return item.h;
}

export function tabloid(hours = 24) {
    const trust = read('trust.json', {});
    const names = Object.keys(trust);
    if (!names.length) return null;
    const journo = names.sort((a, b) => personalityOf(b).sociability - personalityOf(a).sociability)[0];
    const opinions = Object.entries(trust[journo] ?? {}).sort((a, b) => b[1] - a[1]);
    const fav = new Set(opinions.slice(0, 3).filter(([, v]) => v > 0).map(([n]) => n)), foe = new Set(opinions.slice(-3).filter(([, v]) => v < 0).map(([n]) => n));
    const spin = it => {
        if (!it.bot) return `${it.h}. Our sources say there's more to it.`;
        if (fav.has(it.bot)) return /stiffed/.test(it.h) ? `${it.h}? Surely a misunderstanding. ${it.bot} is good for it.` : `${it.h}, and frankly it's about time. A credit to Lumbridge.`;
        if (foe.has(it.bot)) return /stiffed/.test(it.h) ? `${it.h}. Shocking? Not to this paper.` : `${it.h}. Luck, mostly. We're watching ${it.bot}.`;
        return `${it.h}.`;
    };
    const items = news(Date.now() - hours * 3600_000).slice(0, 12);
    const date = new Date().toISOString().slice(0, 10);
    const text = [`# The Lumbridge Whisper: ${date}`, '', `_All the news that fits, by ${journo}. Friends of the paper: ${[...fav].join(', ') || 'none'}. Not friends: ${[...foe].join(', ') || 'nobody, yet'}._`, '',
        ...(items.length ? items.map(i => `- ${spin(i)}`) : ['A slow day. Even the chickens are bored.'])].join('\n');
    fs.mkdirSync(path.join(ROOT, 'recaps'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'recaps', `${date}-whisper.md`), text + '\n');
    return text;
}

if (process.argv[1]?.endsWith('crier.mjs')) console.log(tabloid());
