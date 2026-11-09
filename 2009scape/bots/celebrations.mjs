// Milestone celebrations (roadmap 57). A big moment (a skill to 50, 60, 70, 80, 90 or 99, a 10th or 20th quest point
// total, the town's first to a level) draws a crowd: for 15 minutes, online teammates and friends (trust 0.2+) within
// 120 tiles walk over between their tasks, cheer, clap or jump for joy, and congratulate the bot in chat. The bot thanks
// them; everyone's mood lifts a little and the diary lines feed the crier. Hourly tick from the runner; runners call
// join(bot) between plan steps. market/celebrations.json.
import fs from 'fs';
import path from 'path';
import { readDiaries, note } from './diary.mjs';
import { dist, sleep } from './lib.mjs';

const FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'celebrations.json');
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { last: Date.now(), active: [] }; } };
const write = st => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st, null, 1)); };
const MINUTES = 15, REACH = 120;
const EMOTES = [9, 22, 11, 7]; // emote tab (464) buttons: cheer, clap, jump for joy, wave
const CHEERS = ['Congrats {b} on {what}!', 'Well done {b}! {what}!', 'gz {b}!!', '{what}? Nice one {b}!', 'Three cheers for {b}!'];

// what counts as a big moment, from the diary line
function milestone(text) {
    let m;
    if ((m = /^Reached (\w+(?: \w+)?) level (\d+)\./.exec(text)) && [50, 60, 70, 80, 90, 99].includes(Number(m[2]))) return `${m[1]} ${m[2]}`;
    // only the records module's own line: cheer and celebration lines repeat the phrase, and matching them set off a cascade
    if ((m = /^Set a record: first in town to (.+?)[.!]/.exec(text))) return `first in town to ${m[1]}`;
    if ((m = /Completed .*?(\d+) Quest points/.exec(text)) && [10, 20, 30].includes(Number(m[1]))) return `${m[1]} quest points`;
    return null;
}

export class Celebrations {
    constructor(market, log = () => {}) { this.market = market; this.log = log; }
    tick() {
        const st = read(), now = Date.now();
        for (const e of readDiaries(st.last)) {
            const what = milestone(e.text);
            const b = this.market.bots.get(e.bot)?.bot;
            if (!what || !b?.s?.online || st.active.some(c => c.bot === e.bot)) continue;
            st.active.push({ bot: e.bot, what, at: { x: b.s.x, y: b.s.y, z: b.s.z }, until: now + MINUTES * 60_000, came: [] });
            note(e.bot, `Reached ${what}! A few friends came by to celebrate.`);
            this.log(`[celebration] ${e.bot}: ${what} at ${b.s.x},${b.s.y}`);
        }
        st.last = now;
        st.active = st.active.filter(c => c.until > now);
        write(st);
    }
    // between plan steps: go and cheer, if there's a celebration for a friend nearby
    async join(bot) {
        const st = read(), s = this.market.social, now = Date.now();
        const c = st.active.find(c => c.until > now && c.bot !== bot.name && !c.came.includes(bot.name) && bot.s?.z === c.at.z
            && dist(bot.s, c.at) < REACH && (s.teamOf(c.bot) === s.teamOf(bot.name) && s.teamOf(bot.name) !== 'individual' || s.trust(bot.name, c.bot) >= 0.2));
        if (!c) return false;
        c.came.push(bot.name); write(st);
        bot.log(`celebration: off to cheer ${c.bot} (${c.what})`);
        await bot.travel(c.at.x, c.at.y, { tol: 4, timeout: 300 }).catch(() => {});
        await bot.act({ type: 'button', iface: 464, child: EMOTES[Math.floor(Math.random() * EMOTES.length)] }).catch(() => {});
        await sleep(2000);
        const line = CHEERS[Math.floor(Math.random() * CHEERS.length)].replace('{b}', c.bot).replace('{what}', c.what);
        await bot.act({ type: 'say', text: line.slice(0, 80) }).catch(() => {});
        const hero = this.market.bots.get(c.bot)?.bot;
        if (hero?.s?.online && c.came.length === 1) hero.act({ type: 'say', text: `Thanks everyone!` }).catch(() => {});
        s.bumpMood?.(bot.name, 0.05, `cheering ${c.bot}`);
        s.bumpMood?.(c.bot, 0.05, `${bot.name} came to cheer`);
        s.adjustTrust(c.bot, bot.name, 0.03);
        note(bot.name, `Went to cheer ${c.bot}: ${c.what}.`);
        await sleep(3000);
        return true;
    }
}
