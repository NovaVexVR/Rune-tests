// Diaries (Phase 4.3): each bot keeps bots/diaries/<bot>.md with the notable things that happened to it.
// Fed from two places, so the rest of the code doesn't need to know about diaries:
//   - fromLog(line): the runner's structured log lines ([market] / [social] / [character] / [politics] / [mood])
//   - fromGame(bot, text): the bot's own game messages (deaths, level-ups, quests)
import fs from 'fs';
import path from 'path';

export const DIARY_DIR = process.env.DIARY_DIR ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'diaries');
const STATE_DIR = path.join(DIARY_DIR, '.state'); // per-bot records; one file per bot so both runner processes can write safely
const MILESTONES = new Set([5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 99]);
const BIG_TRADE = 10; // coins: smaller deals don't make the diary unless they're a personal record

fs.mkdirSync(STATE_DIR, { recursive: true });
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

export class Diary {
    constructor() {
        this.states = new Map(); // bot -> { day, deaths, bestTrade, first:<key> }
        this.deals = new Map();          // open deal id -> details, until it completes
    }

    note(name, text, kind = 'event') {
        if (!name) return;
        const d = new Date();
        const day = d.toISOString().slice(0, 10);
        const f = path.join(DIARY_DIR, `${name}.md`);
        let head = '';
        if (!fs.existsSync(f)) head = `# ${name}'s diary\n`;
        if (this.st(name).day !== day) { head += `\n## ${day}\n`; this.st(name).day = day; this.save(name); }
        fs.appendFileSync(f, `${head}- ${d.toISOString().slice(11, 16)} [${kind}] ${text}\n`);
    }

    // true the first time (bot, key) is seen
    first(name, key) {
        const st = this.st(name);
        if (st['first:' + key]) return false;
        st['first:' + key] = new Date().toISOString();
        this.save(name);
        return true;
    }

    st(name) {
        if (!this.states.has(name)) this.states.set(name, load(path.join(STATE_DIR, `${name}.json`), {}));
        return this.states.get(name);
    }

    save(name) { fs.writeFileSync(path.join(STATE_DIR, `${name}.json`), JSON.stringify(this.st(name))); }

    fromGame(name, text) {
        let m;
        if (/Oh dear, you are dead/i.test(text)) {
            const n = (this.st(name).deaths ?? 0) + 1;
            this.st(name).deaths = n; this.save(name);
            this.note(name, n === 1 ? 'Died for the first time.' : `Died again (${n} deaths so far).`, 'death');
        } else if ((m = text.match(/advanced an? (\w+) level! You have reached level (\d+)/i))) {
            const lvl = Number(m[2]);
            if (MILESTONES.has(lvl)) this.note(name, `Reached ${m[1]} level ${lvl}.`, 'level');
        } else if (/Congratulations! Quest complete/i.test(text)) {
            this.note(name, 'Completed a quest!', 'quest');
        }
    }

    fromLog(line) {
        let m;
        if ((m = line.match(/\[market\] deal #(\d+): (\S+) -> (\S+): (\d+) (.+?) for (\d+) coins \((\w+)\)/))) {
            this.deals.set(m[1], { seller: m[2], buyer: m[3], amount: Number(m[4]), item: m[5], price: Number(m[6]), kind: m[7] });
        } else if ((m = line.match(/\[market\] deal #(\d+) (\w+)/))) {
            const d = this.deals.get(m[1]);
            this.deals.delete(m[1]);
            if (d && m[2] === 'completed') this.deal(d);
        } else if ((m = line.match(/\[social\] (\S+) now holds a grudge against (\S+) \((.*)\)/))) {
            this.note(m[1], `I hold a grudge against ${m[2]} now (${m[3]}).`, 'betrayal');
            this.note(m[2], `${m[1]} turned against me (${m[3]}).`, 'betrayal');
        } else if ((m = line.match(/\[social\] (\S+) forgives (\S+)/))) {
            this.note(m[1], `Forgave ${m[2]}.`, 'social');
        } else if ((m = line.match(/\[social\] IOU #(\d+): (\S+) owes (\S+) (\d+) coins for (.+?) \(/))) {
            this.note(m[2], `Got ${m[5]} from ${m[3]} on credit: I owe ${m[4]} coins (IOU #${m[1]}).`, 'debt');
            this.note(m[3], `Gave ${m[2]} ${m[5]} on credit for ${m[4]} coins (IOU #${m[1]}).`, 'debt');
        } else if ((m = line.match(/\[social\] IOU #(\d+) (\w+) \((\S+) -> (\S+), (\d+) coins\)/))) {
            const [, id, status, debtor, creditor, owed] = m;
            if (status === 'repaid') { this.note(debtor, `Paid off IOU #${id} to ${creditor} (${owed} coins).`, 'debt'); this.note(creditor, `${debtor} repaid IOU #${id}.`, 'debt'); }
            else { this.note(debtor, `Defaulted on IOU #${id} to ${creditor} (${owed} coins).`, 'debt'); this.note(creditor, `${debtor} never paid IOU #${id} (${owed} coins).`, 'betrayal'); }
        } else if ((m = line.match(/\[social\] (\S+) bought IOU #(\d+) \((\S+) owes (\d+)\) from (\S+) for (\d+) coins/))) {
            this.note(m[1], `Bought ${m[3]}'s debt (IOU #${m[2]}, ${m[4]} coins) from ${m[5]} for ${m[6]}.`, 'debt');
            this.note(m[5], `Sold ${m[3]}'s IOU #${m[2]} to ${m[1]} for ${m[6]} coins.`, 'debt');
            this.note(m[3], `${m[1]} bought my debt to ${m[5]}. Now I owe ${m[1]}.`, 'debt');
        } else if ((m = line.match(/\[social\] (\S+) called out (\S+) in public/))) {
            if (!this.first(m[1], `callout:${m[2]}:${new Date().toISOString().slice(0, 10)}`)) return; // once a day per rival
            this.note(m[1], `Called out ${m[2]} in public.`, 'social');
            this.note(m[2], `${m[1]} called me out in public.`, 'social');
        } else if ((m = line.match(/\[social\] bounty #(\d+): (\S+) wants (\d+) (.+), pays (\d+) coins/))) {
            this.note(m[2], `Posted a bounty: ${m[3]} ${m[4]} for ${m[5]} coins.`, 'bounty');
        } else if ((m = line.match(/\[social\] bounty #(\d+) done \((\S+)\)/))) {
            this.note(m[2], `Delivered bounty #${m[1]}.`, 'bounty');
        } else if ((m = line.match(/\[character\] (\S+) completed its (\w+) collection/))) {
            this.note(m[1], `Completed my ${m[2]} collection!`, 'collection');
        } else if ((m = line.match(/\[character\] (\S+) and (\S+) flip a coin for (\d+)gp: (\S+) wins/))) {
            const loser = m[4] === m[1] ? m[2] : m[1];
            this.note(m[4], `Won ${m[3]}gp from ${loser} on a coin flip.`, 'wager');
            this.note(loser, `Lost ${m[3]}gp to ${m[4]} on a coin flip.`, 'wager');
        } else if ((m = line.match(/\[quest\] (\w+) party: (\S+) leads(?: with (.+))?/))) {
            const helpers = m[3] ? m[3].split(', ') : [];
            this.note(m[2], `Leading a ${m[1]} quest party for Cook's Assistant${helpers.length ? ` with ${helpers.join(' and ')}` : ''}.`, 'quest');
            for (const h of helpers) this.note(h, `Joined ${m[2]}'s quest party for Cook's Assistant.`, 'quest');
        } else if ((m = line.match(/\[quest\] (\S+) takes on (.+)/))) {
            this.note(m[1], `Took on a quest: ${m[2]}.`, 'quest');
        } else if ((m = line.match(/\[marketday\] (\S+) sets off for market day #(\d+)/))) {
            this.note(m[1], `Set off for market day #${m[2]} at the Grand Exchange.`, 'market');
        } else if ((m = line.match(/\[marketday\] (\S+) put 1 (.+) on the GE for (\d+)gp/))) {
            this.note(m[1], `Put ${m[2]} up on the Grand Exchange for ${m[3]}gp.`, 'market');
        } else if ((m = line.match(/\[politics\] MUTINY in (\w+): .* voted out (\S+); (\S+) is the new treasurer/))) {
            this.note(m[2], `My team (${m[1]}) voted me out as treasurer.`, 'team');
            this.note(m[3], `Became treasurer of ${m[1]} after a mutiny.`, 'team');
        } else if ((m = line.match(/\[politics\] (\S+) LEFT (\w+)/))) {
            this.note(m[1], `Left the ${m[2]} team.`, 'team');
        } else if ((m = line.match(/\[politics\] (\w+) invited (\S+) .*: accepted/))) {
            this.note(m[2], `Joined the ${m[1]} team.`, 'team');
        }
    }

    deal({ seller, buyer, amount, item, price, kind }) {
        const what = `${amount} ${item}`;
        const text = {
            sale: [`Sold ${what} to ${buyer} for ${price} coins.`, `Bought ${what} from ${seller} for ${price} coins.`],
            gift: [`Gave ${buyer} ${what}.`, `${seller} gave me ${what}.`],
            debtsale: [null, null], // covered by the IOU transfer line
            repay: [null, null],    // covered by the IOU repaid line
            wager: [null, null],    // covered by the coin-flip line
            favor: [`Gave ${buyer} ${what} as a favor.`, `${seller} did me a favor: ${what}.`],
            quest: [`Brought ${buyer} the ${item} for our quest.`, `${seller} brought me the ${item} for our quest.`],
            bounty: [`Delivered ${what} to ${buyer} for a bounty (${price} coins).`, `${seller} delivered my bounty: ${what}.`]
        }[kind] ?? [`Traded ${what} to ${buyer} (${kind}).`, `Got ${what} from ${seller} (${kind}).`];
        // personal records: a bot's biggest trade so far always makes the diary
        for (const [who, line] of [[seller, text[0]], [buyer, text[1]]]) {
            if (!line) continue;
            const best = this.st(who).bestTrade ?? 0;
            const record = price > best && price > 0;
            if (record) { this.st(who).bestTrade = price; this.save(who); }
            if (record || price >= BIG_TRADE || kind === 'bounty' || kind === 'quest') this.note(who, line + (record && best > 0 ? ' My biggest trade yet.' : ''), 'trade');
        }
    }
}
