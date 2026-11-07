// Bot client library for the 2009Scape bot API (127.0.0.1:8899).
import { recordDeath } from './phobias.mjs';
import fs from 'fs';
import path from 'path';

const API = process.env.BOT_API ?? 'http://127.0.0.1:8899';
export const LOG_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const TICK = 600;
export const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export const SKILLS = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving', 'slayer', 'farming', 'runecrafting', 'hunter', 'construction', 'summoning'];
// bank booths on the ground floor (where to stand)
export const GROUND_BANKS = [{ x: 3094, y: 3492, name: 'Edgeville' }, { x: 3185, y: 3440, name: 'Varrock West' }, { x: 3253, y: 3420, name: 'Varrock East' }, { x: 3013, y: 3356, name: 'Falador East' }, { x: 3270, y: 3167, name: 'Al Kharid' }];
export const FOOD = ['Shrimps', 'Anchovies', 'Bread', 'Cooked chicken', 'Cooked meat', 'Sardine', 'Herring', 'Trout', 'Salmon', 'Pike', 'Tuna', 'Lobster', 'Cake', 'Meat pie', 'Swordfish', 'Kebab'];
// Random event types the server may give bots: the ones with a proven solver (wave 1).
// Sent to the server on every login, so it survives server restarts. Override: BOT_EVENTS=GENIE,ZOMBIE or BOT_EVENTS=none
// ---- danger memory: places a bot (or a friend who warned it) died, avoided on long trips for a while ----
const DANGER_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'market', 'dangers.json');
const loadDangers = () => { try { return JSON.parse(fs.readFileSync(DANGER_FILE, 'utf8')); } catch { return {}; } };
export function rememberDanger(name, x, y, from = null) {
    const all = loadDangers();
    const mine = (all[name] ??= []).filter(d => Date.now() < d.until);
    const near = mine.find(d => Math.max(Math.abs(d.x - x), Math.abs(d.y - y)) <= 6);
    // twice in the same place: a lesson that lasts a day; otherwise six hours
    if (near) { near.until = Date.now() + 24 * 3600_000; near.times = (near.times ?? 1) + 1; }
    else mine.push({ x, y, from, until: Date.now() + 6 * 3600_000, times: 1 });
    all[name] = mine;
    fs.mkdirSync(path.dirname(DANGER_FILE), { recursive: true });
    fs.writeFileSync(DANGER_FILE, JSON.stringify(all, null, 2));
}
export function dangersFor(name) {
    // Lumbridge itself (the respawn point) never counts: there's nowhere safer to go
    return (loadDangers()[name] ?? []).filter(d => Date.now() < d.until && Math.max(Math.abs(d.x - 3222), Math.abs(d.y - 3218)) > 15).map(d => ({ x: d.x, y: d.y, r: 6 }));
}
export const STUCK_MINUTES = Number(process.env.STUCK_MINUTES ?? 10), HARD_STUCK_MINUTES = Number(process.env.HARD_STUCK_MINUTES ?? 25);
// Runner-side watchdog (hard): a bot still stuck after HARD_STUCK_MINUTES is logged out; its runner logs it back in.
export function watchdog(bots, log = console.log) {
    return setInterval(async () => {
        for (const b of bots) {
            if (!b.s?.online || b.stuckFor() < HARD_STUCK_MINUTES) continue;
            log(`[watchdog] ${b.name} stuck ${Math.round(b.stuckFor())} min at ${b.s.x},${b.s.y},${b.s.z}: logging it out to restart`);
            b.lastProgress = Date.now();
            await b.logout().catch(() => {});
        }
    }, 2 * 60_000);
}
export const RANDOM_EVENTS = process.env.BOT_EVENTS != null
    ? process.env.BOT_EVENTS.split(',').map(e => e.trim().toUpperCase()).filter(e => e && e !== 'NONE')
    : ['GENIE', 'DRUNKEN_DWARF', 'RICK_TURPENTINE', 'STRANGE_PLANT', 'SANDWICH_LADY', 'CERTER', 'DRILL_DEMON', 'FREAKY_FORESTER', 'MAZE', 'QUIZ_MASTER', 'PILLORY', 'SURPRISE_EXAM',
       'EVIL_CHICKEN', 'RIVER_TROLL', 'ROCK_GOLEM', 'SHADE', 'SWARM', 'TREE_SPIRIT', 'ZOMBIE'];
const PILLORY_CAGES = [[3226, 3407], [3228, 3407], [3230, 3407], [2681, 3489], [2683, 3489], [2685, 3489], [2604, 3105], [2606, 3105], [2608, 3105]].map(([x, y]) => ({ x, y }));
// ---- gear: which slot an item goes in, and how good it is (metal tier x 10 + the piece's rank within its slot) ----
const TIERS = ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune', 'dragon'];
const GEAR_SLOTS = [
    ['weapon', /(2h sword|scimitar|longsword|battleaxe|warhammer|sword|mace|dagger)$/i, ['dagger', 'mace', 'sword', 'warhammer', 'battleaxe', 'longsword', 'scimitar', '2h sword']],
    ['head', /(full helm|med helm|helmet|helm|coif|hat)$/i, ['hat', 'helmet', 'coif', 'med helm', 'full helm']],
    ['body', /(platebody|chainbody|body|top)$/i, ['top', 'body', 'chainbody', 'platebody']],
    ['legs', /(platelegs|plateskirt|chaps|legs|bottoms)$/i, ['bottoms', 'chaps', 'legs', 'plateskirt', 'platelegs']],
    ['shield', /(kiteshield|sq shield|shield)$/i, ['shield', 'sq shield', 'kiteshield']],
    ['hands', /(gloves|vambraces)$/i, ['gloves', 'vambraces']],
    ['feet', /boots$/i, ['boots']]
];
export function gearInfo(name) {
    const n = name.toLowerCase();
    for (const [slot, re, ranks] of GEAR_SLOTS) {
        if (!re.test(n)) continue;
        if (/pickaxe|hatchet|^.* axe$/.test(n) && slot === 'weapon') return null; // tools, not weapons
        const tier = TIERS.findIndex(t => n.startsWith(t)) + 1; // 0: leather, wood, cloth, event rewards
        const rank = ranks.reduce((best, r, i) => (n.endsWith(r) ? i : best), 0); // the most specific match (platebody over body)
        return { slot, score: tier * 10 + rank };
    }
    return null;
}
// random events: the Sandwich Lady's tray (interface 297) and the Certer's decoy captions (interface 184)
const SANDWICH_BUTTON = { baguette: 7, 'triangle sandwich': 8, 'square sandwich': 9, sandwich: 9, roll: 10, 'meat pie': 11, kebab: 12, 'chocolate bar': 13 };
const CERTER_DECOYS = ['an axe', 'an arrow', 'a pair of boots', 'a pair of gloves', 'a staff', 'a bow', 'a feather', 'the disenfr'];
// experience-lamp interface (134) skill buttons
const LAMP_BUTTON = { attack: 29, strength: 30, defence: 31, ranged: 32, prayer: 33, hitpoints: 34, magic: 35, agility: 36, herblore: 37, thieving: 38, crafting: 39, fletching: 40, mining: 41, smithing: 42, fishing: 43, firemaking: 44, cooking: 45, woodcutting: 46, runecrafting: 47, slayer: 48, hunter: 49, farming: 50, construction: 51, summoning: 52 };
// Places low-level bots keep away from on long trips: the dark wizards' circle south of Varrock, the Draynor wizards
export const DANGER = [{ x: 3227, y: 3369, r: 18 }, { x: 3095, y: 3232, r: 14 }];
// Grand Exchange: centre of the building, and interface 105 buttons per offer slot (0-5)
export const GE = { x: 3165, y: 3487 };
const GE_BUY = [30, 46, 62, 81, 100, 119], GE_SELL = [31, 47, 63, 82, 101, 120], GE_BOX = [18, 34, 50, 69, 88, 107];
const DEBUG_MSG = /^(\[|-{3,}|ID:|Option:|SpawnLoc|Wrapper|RCM|Iface|Slot:|Loc:|Index:|Your debug mode)/;

async function http(method, url, body) {
    const res = await fetch(API + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
}

export class Bot {
    constructor(name, { quiet = false } = {}) {
        this.name = name.toLowerCase();
        this.s = null;
        this.since = 0;
        this.msgs = [];
        this.pms = []; // private messages received: {from, text}
        this.quiet = quiet;
        this.logFile = path.join(LOG_DIR, `${this.name}.log`);
    }

    log(...a) {
        const line = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} [${this.name}] ${a.join(' ')}`;
        if (!this.quiet) console.log(line);
        fs.appendFileSync(this.logFile, line + '\n');
    }

    async login() {
        // messages from before this login (replayed history) mustn't count as fresh deaths
        try { const h = await http('GET', `/bot/${this.name}/state?r=1&since=0`); this._msgFloor = Math.max(0, ...(h.messages ?? []).map(m => m.id)); } catch {}
        await http('POST', '/events', RANDOM_EVENTS).catch(() => {});
        await http('POST', `/bot/${this.name}/login`);
        for (let i = 0; i < 30; i++) {
            await sleep(600);
            const s = await this.state(5);
            if (s.online && s.iface === 378) { await this.act({ type: 'button', iface: 378, child: 140 }); continue; } // welcome screen: Play
            if (s.online) return s;
        }
        throw new Error('login timed out');
    }

    async logout() {
        await http('POST', `/bot/${this.name}/logout`);
    }

    async state(r = 15) {
        const s = await http('GET', `/bot/${this.name}/state?r=${r}&since=${this.since}`);
        for (const m of s.messages ?? []) {
            this.since = Math.max(this.since, m.id);
            if (!DEBUG_MSG.test(m.text)) { this.msgs.push(m.text); if (m.id > (this._msgFloor ?? 0)) this.noteDeathMessages(m.text, s); this.onMsg?.(m.text); }
        }
        if (this.msgs.length > 150) this.msgs.splice(0, this.msgs.length - 150);
        for (const pm of s.pms ?? []) {
            this.since = Math.max(this.since, pm.id);
            this.pms.push({ from: pm.from, text: pm.text, t: Date.now() });
            this.onPm?.(pm);
        }
        if (this.pms.length > 100) this.pms.splice(0, this.pms.length - 100);
        // watchdog: any change of place, xp or hp counts as progress
        if (s.online && s.stats) {
            const key = `${s.x},${s.y},${s.z},${Object.values(s.stats).reduce((t, k) => t + k.xp, 0)},${s.hp}`;
            if (key !== this._progressKey) { this._progressKey = key; this.lastProgress = Date.now(); }
        }
        // who's been hitting us (for phobias: what killed us)
        const hitter = (s.npcs ?? []).find(n => String(n.target ?? '').toLowerCase() === this.name.toLowerCase());
        if (hitter) this._lastAttacker = { name: hitter.name, level: hitter.level, t: Date.now() };
        this.s = s;
        return s;
    }

    async act(a) {
        try {
            const r = await http('POST', `/bot/${this.name}/act`, a);
            return r.results[0];
        } catch (e) {
            this.log(`act ${a.type} failed: ${e.message}`);
            return null;
        }
    }

    inv(name, s = this.s) {
        return s.inv.filter(i => (typeof name === 'function' ? name(i) : i.name === name));
    }
    count(name, s = this.s) {
        return this.inv(name, s).reduce((t, i) => t + i.count, 0);
    }
    has(name, s = this.s) {
        return this.count(name, s) > 0 || s.worn.some(i => i.name === name);
    }
    lvl(skill) {
        return this.s.stats[skill].level;
    }

    isIdle(s = this.s) {
        return !s.moving && !s.busy && !s.attacking && !s.locked;
    }

    async wait(ticks = 1) {
        await sleep(TICK * ticks);
    }

    async waitIdle({ timeout = 60, quiet = 2, cond = null, r = 15 } = {}) {
        let idle = 0;
        const end = Date.now() + timeout * 1000;
        while (Date.now() < end) {
            await this.wait(1);
            const s = await this.state(r);
            if (await this.handleInterrupts()) continue;
            if (cond && cond(s)) return true;
            idle = this.isIdle(s) ? idle + 1 : 0;
            if (idle >= quiet) return true;
        }
        return false;
    }

    // After "I can't reach that", open the closest closed gate/door near us or the target.
    async openNearbyGate(target = null) {
        const s = await this.state(10);
        const ref = target ?? s;
        const g = s.scenery
            .filter(l => l.ops.includes('Open') && /gate|door/i.test(l.name) && l.dist <= 10)
            .sort((a, b) => dist(a, ref) + a.dist - (dist(b, ref) + b.dist))[0];
        if (!g) return false;
        this.log(`opening ${g.name} at ${g.x},${g.y}`);
        await this.act({ type: 'scenery', x: g.x, y: g.y, id: g.id, op: 'Open' });
        await this.waitIdle({ timeout: 12 });
        return true;
    }

    // ---- RuneScape random events (wave 1: talkers, the strange plant, hostile spawns) ----
    async handleRandomEvent() {
        const ev = this.s.randomEvent;
        if (!ev) return false;
        const TALK = ['GENIE', 'DRUNKEN_DWARF', 'RICK_TURPENTINE', 'SANDWICH_LADY', 'CERTER'];
        const HOSTILE = ['EVIL_CHICKEN', 'RIVER_TROLL', 'ROCK_GOLEM', 'SHADE', 'SWARM', 'TREE_SPIRIT', 'ZOMBIE'];
        if (this._lastEvent !== ev.type + ev.npc) { this._lastEvent = ev.type + ev.npc; this.log(`random event: ${ev.type} (${ev.name})`); this.onRandomEvent?.(ev.type); }
        // Sandwich Lady: remember what she offers ("Have a kebab, dear."), then pick it on her tray (interface 297)
        const offer = this.s.dialog?.text?.join(' ').match(/Have an? (.+?), dear/i);
        if (offer) this._sandwich = offer[1].toLowerCase();
        if (this.s.iface === 297) {
            const child = SANDWICH_BUTTON[this._sandwich] ?? 7;
            this.log(`random event: sandwich lady offers ${this._sandwich}, taking button ${child}`);
            await this.act({ type: 'button', iface: 297, child });
            await this.wait(2);
            return true;
        }
        // Certer: three captions under a picture; the wrong ones are never things in the picture set (axes, bows, boots...)
        if (this.s.iface === 184) {
            const t = this.s.ifaceText ?? {};
            const opts = [1, 2, 3].map(c => t[c] ?? '');
            let pick = opts.findIndex(o => o && !CERTER_DECOYS.some(d => o.toLowerCase().startsWith(d)));
            if (pick < 0) pick = 0;
            this.log(`random event: certer options ${JSON.stringify(opts)}, answering "${opts[pick]}"`);
            await this.act({ type: 'button', iface: 184, child: 8 + pick });
            await this.wait(2);
            return true;
        }
        if (this.s.dialog) return false; // let the dialog handler click through what the NPC says
        if (TALK.includes(ev.type)) {
            if (Date.now() - (this._reTalk ?? 0) < 6000) return false;
            this._reTalk = Date.now();
            const npc = this.s.npcs.find(n => n.npc === ev.npc);
            const op = npc?.ops.find(o => /talk/i.test(o)) ?? 'Talk-to';
            await this.act({ type: 'npc', npc: ev.npc, op });
            await this.wait(3);
            return true;
        }
        if (ev.type === 'STRANGE_PLANT') {
            if (Date.now() - (this._rePick ?? 0) < 5000) return false;
            this._rePick = Date.now();
            await this.act({ type: 'npc', npc: ev.npc, op: 'Pick' });
            await this.wait(2);
            return true;
        }
        if (HOSTILE.includes(ev.type)) {
            const healthy = this.s.hp > this.s.maxHp * 0.6;
            if (healthy && !this.s.attacking) {
                await this.act({ type: 'npc', npc: ev.npc, op: 'Attack' });
                await this.wait(2);
                return true;
            }
            if (!healthy && Date.now() - (this._reFlee ?? 0) > 8000) {
                // too hurt to fight it: put distance between us until it gives up
                this._reFlee = Date.now();
                const dx = Math.sign(this.s.x - ev.x) || 1, dy = Math.sign(this.s.y - ev.y) || 1;
                this.log(`random event: fleeing ${ev.type} at hp ${this.s.hp}`);
                await this.act({ type: 'walk', x: this.s.x + dx * 15, y: this.s.y + dy * 15, run: true });
                await this.wait(6);
                return true;
            }
        }
        return false;
    }

    // ---- random events wave 3: puzzles in places the bot is kidnapped to ----
    async solveKidnap() {
        const s = this.s;
        const inBox = (x0, y0, x1, y1) => s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1;
        if (inBox(3155, 4812, 3171, 4828)) return this.drillDemon();
        if (inBox(2587, 4758, 2616, 4788)) return this.freakyForester();
        if (inBox(2880, 4544, 2943, 4607)) return this.maze();
        if (inBox(1920, 4736, 1983, 4799)) return this.quizMaster();
        if (PILLORY_CAGES.some(c => c.x === s.x && c.y === s.y)) return this.pillory();
        if (inBox(1860, 5000, 1915, 5050)) return this.surpriseExam();
        return false;
    }

    // Surprise Exam (Mr. Mordaut): interface 103 shows three items of one set (children 6-8) and four options
    // (10-13), one from the same set; that's the answer (button = its child). Three right, then he names the exit door.
    async surpriseExam() {
        const s = this.s;
        const SETS = [[5325, 5329, 5343, 5341], [329, 385, 333, 315], [1277, 1171, 1139, 1371], [309, 11323, 303, 311]];
        const DOORS = { 'red cross': 2188, 'blue star': 2189, 'purple circle': 2192, 'green square': 2193 };
        const m = s.ifaceModels?.['103'];
        if (s.iface === 103 && m?.[6]) {
            const id = c => Number(String(m[c] ?? '').split(':')[1]);
            const set = SETS.find(st => st.includes(id(6)));
            const pick = [10, 11, 12, 13].find(c => set?.includes(id(c))) ?? 10;
            this.log(`random event: surprise exam, the pattern is ${set ? ['garden tools', 'fish', 'armour and weapons', 'fishing gear'][SETS.indexOf(set)] : '?'}; answering slot ${pick - 9}`);
            await this.act({ type: 'button', iface: 103, child: pick });
            await this.wait(3);
            return true;
        }
        const said = (s.dialog?.text ?? []).join(' ');
        const door = /exit through the ([a-z ]+) door/i.exec(said)?.[1]?.toLowerCase();
        if (door && DOORS[door]) this._seDoor = DOORS[door];
        if (s.dialog) { await this.handleInterrupts(); return true; }
        if (this._seDoor) {
            const d = this.nearestScenery(l => l.id === this._seDoor && l.ops.includes('Open'));
            if (d) { this.log(`random event: surprise exam done, leaving by the ${Object.keys(DOORS).find(k => DOORS[k] === this._seDoor)} door`); await this.act({ type: 'scenery', x: d.x, y: d.y, id: d.id, op: 'Open' }); await this.wait(4); if (this.s.y < 5000) this._seDoor = null; return true; }
        }
        if (Date.now() - (this._seTalk ?? 0) < 8000) return false;
        this._seTalk = Date.now();
        const mord = this.nearestNpc(n => /mordaut/i.test(n.name));
        if (mord) { await this.act({ type: 'npc', npc: mord.npc, op: mord.ops.find(o => /talk/i.test(o)) ?? 'Talk-to' }); await this.wait(3); return true; }
        return false;
    }

    // Pillory: locked in a cage (Varrock, Seers', Yanille). Unlock opens interface 189: the lock's model (child 4) is
    // 9753 + n, the three keys (children 5-7) are 9749 + k; the key with k == n opens it (button = child + 3). 3 right.
    async pillory() {
        const s = this.s;
        const m = s.ifaceModels?.['189'];
        if (s.iface === 189 && m?.[4]) {
            const id = c => Number(String(m[c] ?? '').split(':')[1]);
            const lock = id(4) - 9753;
            const key = [5, 6, 7].find(c => id(c) - 9749 === lock) ?? 5;
            this.log(`random event: pillory lock ${lock}, trying the key in slot ${key - 4}`);
            await this.act({ type: 'button', iface: 189, child: key + 3 });
            await this.wait(3);
            return true;
        }
        if (s.dialog) { await this.handleInterrupts(); return true; }
        if (Date.now() - (this._plTry ?? 0) < 6000) return false;
        this._plTry = Date.now();
        const cage = this.nearestScenery(l => /cage/i.test(l.name) && l.ops.some(o => /unlock/i.test(o)));
        if (cage) { await this.act({ type: 'scenery', x: cage.x, y: cage.y, id: cage.id, op: cage.ops.find(o => /unlock/i.test(o)) }); await this.wait(3); return true; }
        return false;
    }

    // Quiz Master: three item models on the quiz box (chatbox 191, children 6-8); the odd one out is the one whose
    // category the other two don't share. Its button is child - 4. Four right answers win: take the 1000 coins.
    async quizMaster() {
        const s = this.s;
        const models = s.ifaceModels?.['191'];
        if (s.chatbox === 191 && models) {
            const KIND = { 8828: 'weapon', 8836: 'weapon', 8829: 'fish', 8830: 'fish', 8831: 'jewellery', 8834: 'jewellery', 8832: 'armour', 8833: 'armour', 8835: 'tool', 8837: 'tool' };
            const shown = [6, 7, 8].map(c => ({ c, kind: KIND[Number(String(models[c] ?? '').split(':')[1])] ?? `?${c}` }));
            const odd = shown.find(x => shown.filter(y => y.kind === x.kind).length === 1) ?? shown[0];
            this.log(`random event: quiz master shows ${shown.map(x => x.kind).join(', ')}; the odd one is the ${odd.kind}`);
            await this.act({ type: 'button', iface: 191, child: odd.c - 4 });
            await this.wait(3);
            return true;
        }
        if (s.dialog) { await this.handleInterrupts({ answer: /1000 coins/i }); return true; }
        if (Date.now() - (this._qmTalk ?? 0) < 8000) return false;
        this._qmTalk = Date.now();
        const qm = this.nearestNpc(n => /quiz master/i.test(n.name));
        if (qm) { await this.act({ type: 'npc', npc: qm.npc, op: qm.ops.find(o => /talk/i.test(o)) ?? 'Talk-to' }); await this.wait(3); return true; }
        return false;
    }

    // Drill Demon: Sergeant Damien barks an exercise; do it on the mat whose sign shows it (4 right in a row).
    async drillDemon() {
        const said = this.s.dialog?.text?.join(' ') ?? '';
        const m = /\b(jog|star ?jumps?|push ?ups?|sit ?ups?)\b/i.exec(said);
        if (m) this._drill = { jog: 0, sit: 1, pus: 2, sta: 3 }[m[1].toLowerCase().slice(0, 3)];
        if (this.s.dialog || this.s.locked) return false;
        if (this._drill == null) {
            if (Date.now() - (this._ddTalk ?? 0) < 8000) return false;
            this._ddTalk = Date.now();
            const sarge = this.nearestNpc(n => /sergeant damien/i.test(n.name));
            if (sarge) await this.act({ type: 'npc', npc: sarge.npc, op: 'Talk-to' });
            await this.wait(2);
            return true;
        }
        const mats = (await http('GET', `/find?name=mat&x=3163&y=4820&r=6&bot=${this.name}`)).scenery.filter(o => o.ops.includes('Use'));
        // the exercise signs are drawn by the client from player variables, so a bot can't read them: if no mat
        // tells us, take a random one (a wrong one only earns abuse; 4 right ones end the drill)
        const mat = mats.find(o => o.variant === this._drill) ?? mats[Math.floor(Math.random() * mats.length)];
        this.log(`random event: drill demon wants ${['jogging', 'sit ups', 'push ups', 'star jumps'][this._drill]}, trying the mat at ${mat?.x},${mat?.y}`);
        this._drill = null;
        if (!mat) return false;
        await this.act({ type: 'scenery', x: mat.x, y: mat.y, id: mat.id, op: 'Use' });
        await this.wait(12); // walk over and exercise
        return true;
    }

    // Freaky Forester: kill the pheasant with the number of tails he asks for, bring it to him, leave by the portal.
    async freakyForester() {
        const s = this.s;
        const said = s.dialog?.text?.join(' ') ?? '';
        const m = /kill the (one|two|three|four) tailed pheasant/i.exec(said);
        if (m) { this._tails = ['one', 'two', 'three', 'four'].indexOf(m[1].toLowerCase()) + 1; this._freakGave = false; }
        if (s.dialog) return false;
        if (s.attacking || s.moving) return false;
        if (Date.now() - (this._ffAct ?? 0) < 4000) return false;
        this._ffAct = Date.now();
        const forester = this.nearestNpc(n => /freaky forester/i.test(n.name));
        const raw = s.inv.find(i => /raw pheasant/i.test(i.name));
        if (this._freakGave && !raw) { // handed it over: out through the portal
            const portal = this.nearestScenery(l => /portal/i.test(l.name) && l.ops.includes('Enter'));
            if (s.messages?.some(x => /supernatural force/i.test(x.text))) { this._freakGave = false; this._tails = null; }
            else if (portal) { this.log('random event: freaky forester done, taking the portal'); await this.act({ type: 'scenery', x: portal.x, y: portal.y, id: portal.id, op: 'Enter' }); await this.wait(4); return true; }
        }
        if (raw || this._tails == null) {
            if (forester) { await this.act({ type: 'npc', npc: forester.npc, op: 'Talk-to' }); if (raw) this._freakGave = true; }
            await this.wait(3);
            return true;
        }
        const drop = s.ground?.find(g => /raw pheasant/i.test(g.name));
        if (drop) { await this.act({ type: 'ground', x: drop.x, y: drop.y, id: drop.id }); await this.wait(3); return true; }
        const bird = this.nearestNpc(n => n.id === 2458 + this._tails && n.ops.includes('Attack'));
        if (!bird) { await this.walkTo(2600 + rand(-6, 6), 4773 + rand(-6, 6), { tol: 2, direct: true }); return true; }
        this.log(`random event: freaky forester wants the ${this._tails}-tailed pheasant`);
        await this.act({ type: 'npc', npc: bird.npc, op: 'Attack' });
        await this.wait(4);
        return true;
    }

    // Maze: plan a way to the shrine on the collision map (its doors are walls that open; the plain walls, id 3626,
    // only look like it), walk it opening each door, touch the shrine. One-way doors that refuse get avoided next time.
    async maze() {
        if (this._mazeBusy) return false;
        this._mazeBusy = true;
        try {
            const shrine = (await http('GET', '/find?name=shrine&x=2911&y=4576&r=34')).scenery[0];
            if (!shrine) return false;
            const refused = [];
            const reached = () => this._mazeAtShrine;
            for (let attempt = 0; attempt < 8 && !reached(); attempt++) {
                const s = await this.state(10);
                // next to the shrine's room: open its door (a real one, not the plain walls) and touch the shrine
                if (dist(s, shrine) <= 3) {
                    const door = s.scenery.filter(l => l.id !== 3626 && l.ops.includes('Open') && dist(l, shrine) <= 2).sort((a, b) => a.dist - b.dist)[0];
                    if (door) { await this.act({ type: 'scenery', x: door.x, y: door.y, id: door.id, op: 'Open' }); await this.waitIdle({ timeout: 8, quiet: 2 }); }
                    await this.act({ type: 'scenery', x: shrine.x, y: shrine.y, id: shrine.id, op: 'Touch' });
                    await this.wait(5);
                    const after = await this.state(4);
                    if (!after.messages?.some(m => /can't reach/i.test(m.text))) { this._mazeAtShrine = true; break; }
                }
                const avoid = refused.map(([x, y]) => `${x},${y},0`).join(';');
                // aim for a tile beside the shrine that a route really ends on (the shrine sits in its own walled room)
                let r = null;
                for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
                    const tx = shrine.x + dx, ty = shrine.y + dy;
                    const c = await http('GET', `/route?from=${s.x},${s.y}&to=${tx},${ty}&solid=3626&step=4${avoid ? '&avoid=' + avoid : ''}`).catch(() => ({ ok: false }));
                    const endp = c.ok && c.path.at(-1);
                    if (endp && endp[0] === tx && endp[1] === ty && (!r || c.length < r.length)) r = c;
                }
                if (!r) { this.log('random event: no way through the maze'); break; }
                this.log(`random event: maze route ${r.length} steps through ${r.doors.length} doors`);
                if (await this.followRoute(r)) continue;
                if (this.lastDoorFail) refused.push(this.lastDoorFail);
            }
            if (this._mazeAtShrine) { this.log('random event: touched the maze shrine'); this._mazeAtShrine = false; await this.wait(10); }
            return true;
        } finally { this._mazeBusy = false; }
    }

    // Experience lamps (the Genie's reward): rub, pick a skill on interface 134, confirm (button 2).
    // Skill: this.lampSkill (set by a runner) or else the highest-level skill, since the genie lamp gives level x 10 xp.
    async useLamp() {
        const s = this.s;
        if (s.iface === 134) {
            const ok = SKILLS.filter(k => !['herblore', 'runecrafting', 'summoning'].includes(k) && LAMP_BUTTON[k]);
            const skill = (typeof this.lampSkill === 'function' ? this.lampSkill(s) : this.lampSkill)
                ?? ok.sort((a, b) => (s.stats[b]?.level ?? 1) - (s.stats[a]?.level ?? 1))[0];
            this.log(`rubbing lamp: ${skill}`);
            await this.act({ type: 'button', iface: 134, child: LAMP_BUTTON[skill] });
            await this.wait(1);
            await this.act({ type: 'button', iface: 134, child: 2 });
            await this.wait(2);
            return true;
        }
        const lamp = s.inv?.find(i => /lamp/i.test(i.name) && i.ops.includes('Rub'));
        if (!lamp || s.dialog || s.attacking || s.inCombat || Date.now() - (this._lampAt ?? 0) < 10000) return false;
        this._lampAt = Date.now();
        await this.act({ type: 'item', slot: lamp.slot, op: 'Rub' });
        await this.wait(2);
        return true;
    }

    // Wear the best gear the bot carries, slot by slot (weapons too unless `weapon: false`, e.g. for ranged).
    // Items it isn't high enough level to wear are remembered and not tried again.
    async gearUp({ weapon = true } = {}) {
        this._cantWear ??= new Map(); // item -> total level when it was too high-level; tried again once the bot levels up
        let s = await this.state(1);
        if (!s?.worn || !s.inv) return 0; // offline or a failed state read
        for (const [name, lvl] of this._cantWear) if (s.totalLevel > lvl) this._cantWear.delete(name);
        let changed = 0;
        for (let pass = 0; pass < 7; pass++) {
            const worn = Object.fromEntries(s.worn.map(i => [gearInfo(i.name)?.slot, gearInfo(i.name)?.score ?? -1]));
            const best = s.inv
                .filter(i => i.ops.some(o => /^(wield|wear)$/i.test(o)) && !this._cantWear.has(i.name))
                .map(i => ({ i, g: gearInfo(i.name) }))
                .filter(({ g }) => g && (weapon || g.slot !== 'weapon') && g.score > (worn[g.slot] ?? -1))
                .sort((a, b) => b.g.score - a.g.score)[0];
            if (!best) break;
            const op = best.i.ops.find(o => /^(wield|wear)$/i.test(o));
            await this.act({ type: 'item', slot: best.i.slot, op });
            await this.wait(2);
            s = await this.state(1);
            if (s.inv.some(i => i.slot === best.i.slot && i.name === best.i.name)) { this._cantWear.set(best.i.name, s.totalLevel); continue; } // too low a level, for now
            this.log(`gear: now wearing ${best.i.name}`);
            changed++;
        }
        return changed;
    }

    // Bank what matches `pred` (bots bank their resources rather than dropping them). Returns false if the bank
    // couldn't be reached, in which case the caller keeps the items and tries again later.
    async bankItems(pred, { back = null } = {}) {
        if (!(await this.openBank())) return false;
        await this.depositAll(pred);
        await this.leaveBank();
        if (back) await this.walkTo(back.x, back.y, { tol: 5 });
        return true;
    }

    // Carry some food: top up from the bank when there's food banked. Returns how much food the bot has.
    async ensureFood(n = 4) {
        let s = await this.state(1);
        const have = () => this.s.inv.filter(i => FOOD.includes(i.name) && !i.noted).reduce((t, i) => t + i.count, 0);
        if (have() >= n) return have();
        const banked = (s.bank ?? []).filter(i => FOOD.includes(i.name) && i.name !== this.favoriteFood);
        if (!banked.length || s.invFree < 2) return have();
        if (!(await this.openBank())) return have();
        for (const f of banked) {
            if (have() >= n) break;
            const want = Math.min(n - have(), f.count, this.s.invFree);
            await this.withdraw(f.name, want >= 5 ? 5 : 1);
            if (want > 1 && want < 5) for (let k = 1; k < want; k++) await this.withdraw(f.name, 1);
        }
        await this.leaveBank();
        this.log(`food: carrying ${have()}`);
        return have();
    }

    // ---- death recovery: the gravestone keeps a bot's items where it died for a few minutes ----
    noteDeathMessages(text, s) {
        if (/Oh dear, you are dead/i.test(text)) {
            // by the time the message arrives the bot is already back at the respawn point: the last state before it
            // (this.s, not yet replaced) is where it fell
            const at = this.s?.online ? this.s : s;
            recordDeath(this.name, this._lastAttacker, (...m) => this.log(...m));
            if (at.y >= 6000) return;
            const again = this._deathAt && Date.now() - this._deathAt.t < 10 * 60_000; // died again soon: don't go back a second time
            this._deathAt = { x: at.x, y: at.y, z: at.z, t: Date.now() };
            s = at;
            this.recovery = null;
            this._noRecovery = again || DANGER.some(d => Math.max(Math.abs(d.x - s.x), Math.abs(d.y - s.y)) <= d.r);
        }
        const g = /you have (\d+) minutes? to get your items back/i.exec(text);
        if (g && this._deathAt && !this._noRecovery) this.recovery = { ...this._deathAt, until: Date.now() + Number(g[1]) * 60_000 - 30_000 };
    }
    async recoverItems() {
        const r = this.recovery;
        if (!r || this._recovering || this.s?.hp <= 0) return false;
        if (Date.now() > r.until) { this.recovery = null; return false; }
        if (dist(this.s, r) <= 3 && this.s.z === r.z) { this.recovery = null; return false; } // died here and never left: nothing to walk to
        this._recovering = true;
        try {
            this.log(`death: going back for my things at ${r.x},${r.y} (${Math.round((r.until - Date.now()) / 1000)}s left)`);
            await this.travel(r.x, r.y, { tol: 2, timeout: Math.max(30, (r.until - Date.now()) / 1000) });
            let got = 0;
            for (let i = 0; i < 30 && Date.now() < r.until + 30_000; i++) {
                const s = await this.state(6);
                const it = s.ground?.filter(g => dist(g, r) <= 4).sort((a, b) => a.dist - b.dist)[0];
                if (!it || s.invFree === 0) break;
                await this.act({ type: 'ground', x: it.x, y: it.y, id: it.id }).catch(() => {});
                await this.waitIdle({ timeout: 8 });
                got++;
            }
            this.log(`death: picked up ${got} things from my grave`);
            this.onRecovered?.(got);
            await this.gearUp().catch(() => {});
        } finally { this.recovery = null; this._recovering = false; }
        return true;
    }

    // Watchdog (soft): no progress for STUCK_MINUTES and not deliberately waiting (this.waiting) -> close whatever is
    // open, come down to the ground floor and walk back to Lumbridge. The runners log a bot out and back in if it's
    // still stuck after HARD_STUCK_MINUTES.
    stuckFor() { return this.lastProgress && !this.waiting ? (Date.now() - this.lastProgress) / 60_000 : 0; }
    async unstickIfStuck() {
        if (this._unsticking || this.stuckFor() < STUCK_MINUTES) return false;
        this._unsticking = true;
        try {
            const s = this.s;
            this.log(`watchdog: no progress for ${Math.round(this.stuckFor())} min at ${s.x},${s.y},${s.z}; heading back to Lumbridge`);
            this.stuckCount = (this.stuckCount ?? 0) + 1;
            this.onStuck?.(s);
            await this.closeInterfaces().catch(() => {});
            await this.travel(3222, 3218, { tol: 4, timeout: 300 }).catch(() => {});
            this.lastProgress = Date.now();
        } finally { this._unsticking = false; }
        return true;
    }

    // Level-ups, dialogs, random events, low HP. Returns true if it did something.
    async handleInterrupts({ answer = null } = {}) {
        // market/trading hook (set by the runner); guarded against re-entry while it walks
        if (this.hook && !this._inHook) {
            this._inHook = true;
            try { if (await this.hook(this)) return true; } finally { this._inHook = false; }
        }
        const s = this.s;
        if (await this.unstickIfStuck()) return true;
        if (await this.recoverItems()) return true;
        if (await this.handleRandomEvent()) return true;
        if (await this.useLamp()) return true;
        if (await this.solveKidnap()) return true;
        // safety net: stuck in a kidnap area we have no solver for (shouldn't happen while only wave 1 is enabled)
        if (s.kidnapped) {
            this._kidnappedAt ??= Date.now();
            // the Drill Demon takes a while when the bot can't read the signs; elsewhere 6 minutes is plenty
            const limit = s.x >= 3155 && s.x <= 3171 && s.y >= 4812 && s.y <= 4828 ? 15 : 10;
            if (Date.now() - this._kidnappedAt > limit * 60_000) {
                this.log(`random event: stuck in a kidnap area for ${limit} min at ${s.x},${s.y}, rescued`);
                this.onRandomEvent?.('RESCUED');
                await this.act({ type: 'rescue' });
                this._kidnappedAt = null;
                await this.wait(4);
                return true;
            }
        } else this._kidnappedAt = null;
        const unreachable = s.messages?.some(m => /can't reach that/i.test(m.text));
        if (unreachable && !this._gateCooldown) {
            this._gateCooldown = true;
            setTimeout(() => (this._gateCooldown = false), 8000);
            if (await this.openNearbyGate()) return true;
        }
        if (s.iface === 378) {
            await this.act({ type: 'button', iface: 378, child: 140 });
            await this.wait(2);
            return true;
        }
        if (s.iface === 771) {
            await this.act({ type: 'button', iface: 771, child: 321 });
            await this.act({ type: 'button', iface: 771, child: 362 });
            await this.wait(2);
            return true;
        }
        // cooking's "how many?" menu (chatbox 307): cook all (button 2; the dialogue system adds 1 to the child)
        if (s.chatbox === 307) { await this.act({ type: 'continue', child: 3 }); await this.wait(2); return true; }
        if (s.dialog && ![372, 311, 191].includes(s.chatbox)) { // 191: the Quiz Master's box, left to quizMaster() // 311: the furnace bar menu, left to the smelting task
            if (s.dialog.options.length) {
                const want = answer ? s.dialog.options.find(o => answer.test(o)) : null;
                const o = want ?? s.dialog.options.find(o => /^(yes|okay|ok|sure|i'll|continue)/i.test(o)) ?? s.dialog.options[0];
                await this.act({ type: 'choose', option: o });
            } else {
                await this.act({ type: 'continue' });
            }
            await this.wait(1);
            return true;
        }
        // Something we didn't pick a fight with is hurting us. Fight back if it's much weaker than us, if we're
        // underground (running blind down there gets you cornered), or if the task said to stand our ground;
        // else run toward Lumbridge. Eat first if it's getting low.
        const attacker = s.inCombat && !s.attacking ? (s.npcs ?? []).find(n => String(n.target ?? '').toLowerCase() === this.name.toLowerCase() && (n.ops ?? []).includes('Attack')) : null;
        if (attacker && !this.dueling && (s.y > 6000 || this.standGround || (attacker.level ?? 99) * 1.5 < (s.combat ?? 3))) {
            const food = s.inv.find(i => FOOD.includes(i.name) && i.ops.includes('Eat'));
            if (s.hp <= s.maxHp * 0.4 && food) { await this.act({ type: 'item', slot: food.slot, op: 'Eat' }); await this.wait(2); return true; }
            this.log(`fighting back: ${attacker.name} (level ${attacker.level}) at ${s.x},${s.y}`);
            await this.act({ type: 'npc', npc: attacker.npc, op: 'Attack' });
            await this.wait(3);
            return true;
        }
        if (s.inCombat && !s.attacking && s.hp < s.maxHp * 0.7 && !this._fleeing && !this.dueling && s.y < 6000) {
            this._fleeing = true;
            this.log(`under attack at ${s.x},${s.y} (hp ${s.hp}), fleeing`);
            const dx = Math.sign(3222 - s.x) * 14, dy = Math.sign(3218 - s.y) * 14;
            await this.act({ type: 'walk', x: s.x + dx, y: s.y + dy, run: true });
            await this.wait(8);
            this._fleeing = false;
            return true;
        }
        // Eat when low
        if (s.hp <= Math.max(4, Math.floor(s.maxHp * 0.4))) {
            const food = s.inv.find(i => FOOD.includes(i.name) && i.ops.includes('Eat'));
            if (food) {
                await this.act({ type: 'item', slot: food.slot, op: 'Eat' });
                await this.wait(2);
                return true;
            }
        }
        return false;
    }

    // Talk to an NPC and click through its dialogue (optionally steering options with a regex).
    async talkTo(name, { answer = null, maxSteps = 40 } = {}) {
        let s = await this.state(15);
        const npc = this.nearestNpc(n => n.name.toLowerCase() === name.toLowerCase() && n.ops.some(o => /talk/i.test(o)));
        if (!npc) return false;
        const op = npc.ops.find(o => /talk/i.test(o));
        await this.act({ type: 'npc', npc: npc.npc, op });
        let quiet = 0;
        for (let i = 0; i < maxSteps && quiet < 4; i++) {
            await this.wait(2);
            s = await this.state(10);
            if (s.dialog && s.chatbox !== 372) {
                quiet = 0;
                await this.handleInterrupts({ answer });
            } else quiet++;
        }
        return true;
    }

    // Long-distance walking in hops, opening doors/gates when stuck.
    async walkTo(x, y, { tol = 2, timeout = 300, direct = false } = {}) {
        // long walks go by a planned route around the DANGER zones (a straight line can cross Draynor)
        if (!direct && this.s && this.s.y < 6000 && y < 6000 && dist(this.s, { x, y }) > 60) return this.travel(x, y, { tol: Math.max(tol, 2), timeout });
        const end = Date.now() + timeout * 1000;
        let stuck = 0;
        let last = null;
        while (Date.now() < end) {
            const s = await this.state(10);
            if (await this.handleInterrupts()) continue;
            if (dist(s, { x, y }) <= tol) return true;
            // somehow underground (y > 6000) while heading for the surface: take the nearest way up
            if (s.y > 6000 && y < 6000) {
                const up = this.nearestScenery(l => l.ops.some(o => /^climb-up$/i.test(o)), s) ?? this.nearestScenery(l => /ladder|stair/i.test(l.name), s);
                if (up) {
                    this.log(`underground at ${s.x},${s.y}; climbing ${up.name}`);
                    await this.act({ type: 'scenery', x: up.x, y: up.y, id: up.id, op: up.ops.find(o => /climb-up/i.test(o)) ?? up.ops[0] });
                    await this.waitIdle({ timeout: 15 });
                    continue;
                }
            }
            if (last && dist(last, s) === 0) stuck++;
            else stuck = 0;
            last = { x: s.x, y: s.y };
            if (stuck >= 2) {
                const door = s.scenery
                    .filter(l => l.ops.includes('Open') && l.dist <= 5 && /door|gate/i.test(l.name) && !/trapdoor|trap door/i.test(l.name))
                    .sort((a, b) => dist(a, { x, y }) - dist(b, { x, y }))[0];
                if (door && stuck < 5) {
                    this.log(`opening ${door.name} at ${door.x},${door.y}`);
                    await this.act({ type: 'scenery', x: door.x, y: door.y, id: door.id, op: 'Open' });
                    await this.waitIdle({ timeout: 10 });
                } else {
                    await this.act({ type: 'walk', x: s.x + rand(-8, 8), y: s.y + rand(-8, 8) });
                    await this.waitIdle({ timeout: 10 });
                }
                if (stuck > 8) {
                    this.log(`walkTo ${x},${y} gave up (stuck at ${s.x},${s.y})`);
                    return false;
                }
                continue;
            }
            const d = dist(s, { x, y });
            const k = Math.min(1, 25 / d);
            await this.act({ type: 'walk', x: Math.round(s.x + (x - s.x) * k), y: Math.round(s.y + (y - s.y) * k), run: s.runEnergy > 30 });
            await this.waitIdle({ timeout: 25, quiet: 1 });
        }
        return false;
    }

    // Long trip: plan a route on the server's collision map (around DANGER zones), then walk it waypoint by waypoint.
    async travel(x, y, { avoid = [...DANGER, ...dangersFor(this.name)], tol = 3, timeout = 900 } = {}) {
        let s = await this.state(8);
        if (dist(s, { x, y }) <= tol && s.z === 0) return true;
        // routes are planned on the ground floor: come down first
        if (s.z > 0 && s.y < 6000) {
            if (s.x > 3190 && s.x < 3220 && s.y > 3200 && s.y < 3235) await this.lumbridgeFloor(0);
            else for (let i = 0; i < 3 && this.s.z > 0; i++) {
                const down = this.nearestScenery(l => l.ops.some(o => /climb-down/i.test(o)));
                if (!down) break;
                await this.act({ type: 'scenery', x: down.x, y: down.y, id: down.id, op: down.ops.find(o => /climb-down/i.test(o)) });
                await this.waitIdle({ timeout: 12 });
                await this.state(8);
            }
            s = await this.state(1);
        }
        // a danger zone around where we are or where we're going can't be avoided: skip it for this trip
        const inside = (a, p) => Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) <= a.r;
        avoid = avoid.filter(a => !inside(a, s) && !inside(a, { x, y }));
        const q = `/route?from=${s.x},${s.y}&to=${x},${y}&z=${s.z}` + (avoid.length ? `&avoid=${avoid.map(a => `${a.x},${a.y},${a.r}`).join(';')}` : '');
        const r = await http('GET', q).catch(e => ({ ok: false, error: e.message }));
        if (!r.ok) { this.log(`travel to ${x},${y}: ${r.error}; walking straight`); return this.walkTo(x, y, { tol, timeout, direct: true }); }
        const end = Date.now() + timeout * 1000;
        const ok = await this.followRoute(r, end);
        if (!ok) {
            // knocked off the path (a fight, a random event, a door that wouldn't open): re-plan from here once
            if (this._replanned) { this._replanned = false; return false; }
            this._replanned = true;
            const again = await this.travel(x, y, { avoid, tol, timeout: Math.max(30, (end - Date.now()) / 1000) });
            this._replanned = false;
            return again;
        }
        return dist(await this.state(1), { x, y }) <= tol || this.walkTo(x, y, { tol, timeout: 60, direct: true });
    }

    // Walk a planned route: open the door the planner names before each waypoint, then walk to it.
    // Returns false if a waypoint couldn't be reached (the caller re-plans); `this.lastDoorFail` is the door that refused.
    async followRoute(r, end = Date.now() + 600_000) {
        this.lastDoorFail = null;
        for (let i = 0; i < r.path.length; i++) {
            const [wx, wy] = r.path[i];
            const door = r.opens?.[i];
            const prevDoor = r.opens?.[i - 1];
            // the same door twice in a row: we're already through it (auto-walk doors carry you across)
            if (door && !(prevDoor && prevDoor[0] === door[0] && prevDoor[1] === door[1])) {
                const st = await this.state(4);
                const d = st.scenery.find(l => l.x === door[0] && l.y === door[1] && l.ops.includes('Open'));
                if (d) {
                    const before = { x: st.x, y: st.y };
                    // the Al Kharid toll gate: pay the 10gp toll (it walks you through) rather than "Open" (a dialogue)
                    const toll = d.ops.find(o => /^pay-toll/i.test(o));
                    if (toll && st.coins < 10) { this.log('route: no 10gp for the Al Kharid toll'); return false; }
                    await this.act({ type: 'scenery', x: d.x, y: d.y, id: d.id, op: toll ?? 'Open' }).catch(() => {});
                    await this.waitIdle({ timeout: 8, quiet: 2 });
                    const after = await this.state(4);
                    // a refusal comes as a game message or a dialogue box ("I don't think that's the right way.")
                    const said = [...(after.messages ?? []).map(m => m.text), ...(after.dialog?.text ?? [])].join(' | ');
                    if (/doesn't open|right way|locked/i.test(said) && dist(after, before) === 0) {
                        this.lastDoorFail = door;
                        this.log(`route: door at ${door} won't open from here (${said.slice(-60)})`);
                        if (after.dialog) await this.act({ type: 'continue' }).catch(() => {});
                        return false;
                    }
                } else if (this.debugRoute) this.log(`route: no door to open at ${door} (from ${st.x},${st.y})`);
            }
            const left = Math.max(30, (end - Date.now()) / 1000);
            if (!(await this.walkTo(wx, wy, { tol: door ? 1 : 2, timeout: Math.min(door ? 20 : 120, left), direct: true }))) { this.log(`route: couldn't reach waypoint ${wx},${wy} (at ${this.s.x},${this.s.y})`); return false; }
            if (Date.now() > end) return false;
        }
        return true;
    }

    async route(points, opts) {
        for (const [x, y] of points) if (!(await this.walkTo(x, y, opts))) return false;
        return true;
    }

    // New characters: design, skip tutorial via Skippy, then Terrova sends us to Lumbridge.
    async onboard() {
        let s = await this.state(10);
        const onTutorial = () => s.x >= 3050 && s.x <= 3160 && s.y >= 3050 && s.y <= 3140;
        for (let tries = 0; tries < 25 && onTutorial(); tries++) {
            if (await this.handleInterrupts({ answer: /skip|yes/i })) { s = await this.state(10); continue; }
            if (this.nearestNpc(n => n.name === 'Skippy')) await this.talkTo('Skippy', { answer: /skip/i });
            else if (this.nearestNpc(n => n.name === 'Magic instructor')) await this.talkTo('Magic instructor', { answer: /yes|mainland|ready|inauthentic|no/i });
            else await this.wait(2);
            s = await this.state(10);
        }
        if (onTutorial()) throw new Error(`could not leave tutorial island (at ${s.x},${s.y})`);
        this.log(`onboarded at ${s.x},${s.y}`);
    }

    // ---- shops ----
    async openShop(shop) {
        await this.walkTo(shop.x, shop.y, { tol: 3 });
        for (let i = 0; i < 4; i++) {
            const s = await this.state(10);
            if (s.shop) return s.shop;
            const npc = this.nearestNpc(n => shop.npcs.includes(n.name) && n.ops.includes('Trade'));
            if (!npc) { await this.walkTo(shop.x, shop.y, { tol: 1 }); continue; }
            await this.act({ type: 'npc', npc: npc.npc, op: 'Trade' });
            await this.waitIdle({ timeout: 15, cond: st => !!st.shop });
        }
        return this.s.shop ?? null;
    }

    async buy(item, amount = 1) {
        let s = await this.state(3);
        const entry = s.shop?.items.find(i => i.name === item);
        if (!entry || entry.count < 1) return false;
        const before = this.count(item);
        for (let left = amount; left > 0; ) {
            const n = left >= 10 ? 10 : left >= 5 ? 5 : 1;
            await this.act({ type: 'buy', item, amount: n });
            left -= n;
            await this.wait(1);
        }
        s = await this.state(3);
        const got = this.count(item) - before;
        this.log(`bought ${got}x ${item} at ${s.shop?.title ?? 'shop'} (${entry.price}gp each)`);
        return got > 0;
    }

    async sell(item, amount = 1) {
        for (let left = amount; left > 0; ) {
            const it = this.s.inv.find(i => i.name === item);
            if (!it) break;
            const n = left >= 10 ? 10 : left >= 5 ? 5 : 1;
            await this.act({ type: 'sell', slot: it.slot, amount: n });
            left -= n;
            await this.wait(1);
            await this.state(3);
        }
    }

    // ---- Grand Exchange (Varrock) ----
    // Open the GE screen (interface 105) through a clerk.
    async geOpen() {
        for (let i = 0; i < 4; i++) {
            const s = await this.state(15);
            if (s.iface === 105) return true;
            if (s.dialog) { await this.handleInterrupts(); continue; }
            const clerk = this.nearestNpc(n => /grand exchange clerk/i.test(n.name) && n.ops.includes('Exchange'));
            if (!clerk) { await this.walkTo(GE.x, GE.y, { tol: 2 }); continue; }
            await this.act({ type: 'npc', npc: clerk.npc, op: 'Exchange' });
            await this.waitIdle({ timeout: 15, cond: st => st.iface === 105 });
        }
        return this.s.iface === 105;
    }

    // Place an offer the way a player does: pick a free slot, choose the item (search box for buys,
    // inventory click for sells), type the amount and price, confirm. Returns the slot or -1.
    async geOffer({ item, sell, amount = 1, price }) {
        if (!(await this.geOpen())) return -1;
        let s = await this.state(1);
        const used = new Set((s.ge ?? []).map(o => o.slot));
        const slot = [0, 1, 2, 3, 4, 5].find(i => !used.has(i));
        if (slot == null) return -1;
        if (sell) {
            const it = s.inv.find(i => i.name === item);
            if (!it) return -1;
            await this.act({ type: 'button', iface: 105, child: GE_SELL[slot] });
            await this.wait(1);
            await this.act({ type: 'button', iface: 107, child: 18, slot: it.slot });
        } else {
            await this.act({ type: 'button', iface: 105, child: GE_BUY[slot] });
            await this.wait(1);
            await this.act({ type: 'geitem', item });
        }
        await this.wait(2);
        s = await this.state(1);
        if (!s.geScreen?.id) { this.log(`GE: could not choose ${item}`); return -1; }
        if (s.geScreen.amount !== amount) { await this.act({ type: 'button', iface: 105, child: 170 }); await this.wait(1); await this.act({ type: 'input', value: String(amount) }); await this.wait(1); }
        if (price && s.geScreen.price !== price) { await this.act({ type: 'button', iface: 105, child: 185 }); await this.wait(1); await this.act({ type: 'input', value: price }); await this.wait(1); }
        s = await this.state(1);
        const { guide } = s.geScreen ?? {};
        await this.act({ type: 'button', iface: 105, child: 190 });
        await this.wait(2);
        s = await this.state(5);
        const placed = s.ge?.find(o => o.slot === slot);
        this.log(placed ? `GE: ${sell ? 'selling' : 'buying'} ${placed.amount}x ${placed.name} at ${placed.price}gp (guide ${guide})` : `GE: offer for ${item} not placed (${s.messages?.map(m => m.text).slice(-1)})`);
        return placed ? slot : -1;
    }

    // Take everything waiting in the GE collection boxes (finished items/coins, refunds).
    async geCollect() {
        if (!(await this.geOpen())) return 0;
        let n = 0;
        for (const off of (await this.state(1)).ge ?? []) {
            if (!off.collect.length) continue;
            await this.act({ type: 'button', iface: 105, child: GE_BOX[off.slot] });
            await this.wait(1);
            for (const c of off.collect) {
                // stackables and small amounts as items, big piles of unstackables as notes
                const notes = c.name !== 'Coins' && c.count > this.s.invFree;
                await this.act({ type: 'button', iface: 105, child: 209 + 2 * c.box, op: notes ? 0 : 1 });
                await this.wait(1);
                n++;
            }
            await this.state(1);
        }
        return n;
    }

    // Cancel an offer that hasn't filled; what's left comes back to the collection box.
    async geAbort(slot) {
        if (!(await this.geOpen())) return false;
        await this.act({ type: 'button', iface: 105, child: GE_BOX[slot] });
        await this.wait(1);
        await this.act({ type: 'button', iface: 105, child: 203 });
        await this.wait(2);
        return true;
    }

    // Climb the Lumbridge castle staircase to floor `target` (0-2).
    async lumbridgeFloor(target) {
        for (let i = 0; i < 8; i++) {
            const s = await this.state(8);
            if (s.z === target) return true;
            if (s.dialog && s.dialog.options.length) { await this.act({ type: 'choose', option: s.z < target ? 'up' : 'down' }); await this.wait(3); continue; }
            await this.walkTo(3206, 3210, { tol: 1, direct: true }); // right up to the stairs: on the upper floors a door can be in the way
            await this.state(15);
            const st = this.nearestScenery(l => /staircase/i.test(l.name));
            if (!st) { await this.wait(2); continue; }
            const op = st.ops.find(o => (s.z < target ? /climb-up/i : /climb-down/i).test(o)) ?? st.ops.find(o => /^climb$/i.test(o)) ?? st.ops[0];
            await this.act({ type: 'scenery', x: st.x, y: st.y, id: st.id, op });
            await this.wait(4);
        }
        return this.s.z === target;
    }

    // ---- bank: Lumbridge castle top floor (safe for low levels) ----
    async openBank() {
        // the nearest bank: Lumbridge castle's top floor, or a ground-floor bank (Varrock West by the anvils and
        // the iron mine, Varrock East by Aubury, Falador East, Al Kharid from inside its toll gate; Draynor is skipped: dark wizards)
        const s0 = await this.state(1);
        const varrock = s0.z === 0 && s0.y < 6000 ? GROUND_BANKS.filter(b => b.name !== 'Al Kharid' || s0.x >= 3268).reduce((a, b) => dist(s0, a) <= dist(s0, b) ? a : b) : GROUND_BANKS[0];
        if (s0.z === 0 && s0.y < 6000 && dist(s0, varrock) < dist(s0, { x: 3208, y: 3220 })) {
            await this.travel(varrock.x, varrock.y, { tol: 3 });
            for (let i = 0; i < 4; i++) {
                const s = await this.state(8);
                if (s.iface === 762) return true;
                const booth = this.nearestScenery(l => /bank booth/i.test(l.name) && l.ops.some(o => /bank|use/i.test(o)));
                const op = booth?.ops.find(o => /^use-quickly$/i.test(o)) ?? booth?.ops.find(o => /^bank$/i.test(o)) ?? booth?.ops.find(o => /use/i.test(o));
                if (!booth) { await this.walkTo(varrock.x, varrock.y, { tol: 1, direct: true }); continue; }
                await this.act({ type: 'scenery', x: booth.x, y: booth.y, id: booth.id, op });
                await this.waitIdle({ timeout: 15, cond: st => st.iface === 762 });
                await this.handleInterrupts();
            }
            return this.s.iface === 762;
        }
        if (!(await this.lumbridgeFloor(2))) return false;
        await this.walkTo(3208, 3220, { tol: 2 });
        for (let i = 0; i < 4; i++) {
            const s = await this.state(8);
            if (s.iface === 762) return true;
            const booth = this.nearestScenery(l => /bank booth/i.test(l.name) && l.ops.some(o => /bank|use/i.test(o)));
            const op = booth?.ops.find(o => /^use-quickly$/i.test(o)) ?? booth?.ops.find(o => /^bank$/i.test(o)) ?? booth?.ops.find(o => /use/i.test(o));
            if (!booth) { await this.walkTo(3208, 3220, { tol: 1 }); continue; }
            await this.act({ type: 'scenery', x: booth.x, y: booth.y, id: booth.id, op });
            await this.waitIdle({ timeout: 15, cond: st => st.iface === 762 });
            await this.handleInterrupts();
        }
        return this.s.iface === 762;
    }

    async depositAll(pred = () => true) {
        for (let i = 0; i < 28; i++) {
            const s = await this.state(2);
            const it = s.inv.find(pred);
            if (!it) break;
            await this.act({ type: 'deposit', slot: it.slot, amount: 'all' });
            await this.wait(1);
        }
    }

    async withdraw(item, amount = 'all', { noted = false } = {}) {
        await this.act({ type: 'withdraw', item, amount, noted });
        await this.wait(1);
        await this.state(2);
    }

    // take exactly n of an item (as 10s, 5s and 1s); noted: as bank notes, one bag slot however many
    async withdrawN(item, n, { noted = false } = {}) {
        const banked = () => (this.s.bank ?? []).filter(i => i.name === item).reduce((t, i) => t + i.count, 0);
        if (n >= banked()) return this.withdraw(item, 'all', { noted });
        for (let left = n; left > 0 && banked() > 0 && (noted || this.s.invFree > 0); ) {
            const k = left >= 10 ? 10 : left >= 5 ? 5 : 1;
            await this.withdraw(item, k, { noted });
            left -= k;
        }
    }
    // for trading and selling
    withdrawNoted(item, n) { return this.withdrawN(item, n, { noted: true }); }

    async leaveBank() {
        await this.closeInterfaces();
        if (this.s.z > 0 && this.s.x > 3190 && this.s.x < 3220 && this.s.y > 3200 && this.s.y < 3230) await this.lumbridgeFloor(0);
    }

    async closeInterfaces() {
        await this.act({ type: 'close' });
        await this.wait(1);
    }

    nearestScenery(pred, s = this.s) {
        return s.scenery.filter(pred).sort((a, b) => a.dist - b.dist)[0] ?? null;
    }
    nearestNpc(pred, s = this.s) {
        return s.npcs.filter(pred).sort((a, b) => a.dist - b.dist)[0] ?? null;
    }

    async dropAll(pred) {
        for (const it of this.s.inv.filter(pred)) {
            await this.act({ type: 'item', slot: it.slot, op: 'Drop' });
            await this.wait(1);
        }
        await this.state();
    }

    async equip(name) {
        const it = this.s.inv.find(i => i.name === name);
        if (!it) return false;
        const op = it.ops.find(o => /^(Wield|Wear|Equip)$/i.test(o));
        if (!op) return false;
        await this.act({ type: 'item', slot: it.slot, op });
        await this.wait(2);
        await this.state();
        return true;
    }
}

export function summary(s) {
    const lv = SKILLS.map(k => `${k.slice(0, 3)}:${s.stats[k].level}`).join(' ');
    return `total ${s.totalLevel} cb ${s.combat} @${s.x},${s.y} | ${lv}`;
}
