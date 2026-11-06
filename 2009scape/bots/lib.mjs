// Bot client library for the 2009Scape bot API (127.0.0.1:8899).
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
export const FOOD = ['Shrimps', 'Anchovies', 'Bread', 'Cooked chicken', 'Cooked meat', 'Sardine', 'Herring', 'Trout', 'Salmon', 'Pike', 'Tuna', 'Lobster', 'Cake', 'Meat pie', 'Swordfish'];
export const GE = { x: 3165, y: 3487 };
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
        // the first poll returns the server's message backlog (e.g. from before a runner restart): keep it, but don't react to it
        const fresh = this._polled; this._polled = true;
        for (const m of s.messages ?? []) {
            this.since = Math.max(this.since, m.id);
            if (!DEBUG_MSG.test(m.text)) { this.msgs.push(m.text); if (fresh) this.onMsg?.(m.text); }
        }
        if (this.msgs.length > 150) this.msgs.splice(0, this.msgs.length - 150);
        for (const pm of s.pms ?? []) {
            this.since = Math.max(this.since, pm.id);
            this.pms.push({ from: pm.from, text: pm.text, t: Date.now() });
            if (fresh) this.onPm?.(pm);
        }
        if (this.pms.length > 100) this.pms.splice(0, this.pms.length - 100);
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
            .filter(l => l.ops.includes('Open') && /gate|door/i.test(l.name) && !/trapdoor/i.test(l.name) && l.dist <= 10) // a trapdoor leads into a cellar
            .sort((a, b) => dist(a, ref) + a.dist - (dist(b, ref) + b.dist))[0];
        if (!g) return false;
        this.log(`opening ${g.name} at ${g.x},${g.y}`);
        await this.act({ type: 'scenery', x: g.x, y: g.y, id: g.id, op: 'Open' });
        await this.waitIdle({ timeout: 12 });
        return true;
    }

    // ---- RuneScape random events (wave 1: talkers, the strange plant, hostile spawns) ----
    async handleRandomEvent() {
        // Genie's reward: rub the lamp and spend the XP on the weakest of the bot's main skills
        const LAMP_BTN = { attack: 29, strength: 30, defence: 31, ranged: 32, prayer: 33, hitpoints: 34, magic: 35, woodcutting: 46, fishing: 43, mining: 41, cooking: 45, firemaking: 44, fletching: 40, thieving: 38 };
        if (this.s.iface === 134) {
            const skill = Object.keys(LAMP_BTN).sort((a, b) => this.lvl(a) - this.lvl(b))[0];
            this.log(`random event: lamp xp to ${skill}`);
            await this.act({ type: 'button', iface: 134, child: LAMP_BTN[skill] });
            await this.act({ type: 'button', iface: 134, child: 2 });
            await this.wait(2);
            return true;
        }
        const lamp = !this.s.dialog && this.s.inv.find(i => i.id === 2528);
        if (lamp && !this.s.randomEvent) {
            await this.act({ type: 'item', slot: lamp.slot, op: 'Rub' });
            await this.wait(2);
            return true;
        }
        // Evil Chicken drops a pile of feathers when killed (useful for fletching)
        const feathers = !this.s.randomEvent && this._chickenAt && Date.now() - this._chickenAt < 60_000 && this.s.invFree > 0 && this.s.ground?.find(g => g.id === 314 && g.dist <= 6);
        if (feathers) {
            this._chickenAt = 0;
            await this.act({ type: 'ground', x: feathers.x, y: feathers.y, id: 314 });
            await this.wait(3);
            return true;
        }
        // Sandwich Lady (wave 2): she says what we may have, then shows a tray of seven pictures (always in this order)
        if (this.s.iface === 297) {
            const TRAY = { baguette: 7, 'triangle sandwich': 8, 'square sandwich': 9, roll: 10, 'meat pie': 11, kebab: 12, 'chocolate bar': 13 };
            const want = this._sandwich;
            this.log(`random event: the sandwich lady offered ${want ?? '?'}`);
            await this.act({ type: 'button', iface: 297, child: TRAY[want] ?? 7 });
            this._sandwich = null;
            await this.wait(2);
            return true;
        }
        // Certer (wave 2): a picture and three descriptions; pick the one that says what the picture shows
        if (this.s.iface === 184) {
            const seen = Object.values(this.s.ifaceModels ?? {})[0]?.seen ?? '';
            const opts = [1, 2, 3].map(c => (this.s.ifaceText?.[c] ?? '').toLowerCase());
            let pick = opts.findIndex(t => seen && t.includes(seen));
            if (pick < 0) pick = Math.floor(Math.random() * 3);
            this.log(`random event: the certer's picture looks like ${seen || '?'}; answering "${opts[pick]}"`);
            await this.act({ type: 'button', iface: 184, child: 8 + pick });
            await this.wait(2);
            return true;
        }
        const ev = this.s.randomEvent;
        if (!ev) return false;
        if (ev.type === 'SANDWICH_LADY') {
            const said = (this.s.dialog?.text ?? []).join(' ').match(/Have an? (.+?), dear/i);
            if (said) this._sandwich = said[1].toLowerCase();
        }
        if (ev.type === 'EVIL_CHICKEN') this._chickenAt = Date.now();
        const TALK = ['GENIE', 'DRUNKEN_DWARF', 'RICK_TURPENTINE', 'SANDWICH_LADY', 'CERTER'];
        const HOSTILE = ['EVIL_CHICKEN', 'RIVER_TROLL', 'ROCK_GOLEM', 'SHADE', 'SWARM', 'TREE_SPIRIT', 'ZOMBIE'];
        if (this._lastEvent !== ev.type + ev.npc) { this._lastEvent = ev.type + ev.npc; this.log(`random event: ${ev.type} (${ev.name})`); this.onRandomEvent?.(ev.type); }
        if (this.s.dialog) return false; // let the dialog handler click through what the NPC says
        if (TALK.includes(ev.type)) {
            if (Date.now() - (this._reTalk ?? 0) < 6000) return false;
            this._reTalk = Date.now();
            // couldn't get to it last time (crowded spot, a wall): step right next to it first
            if (this.msgs.slice(-3).some(t => /can't reach/i.test(t))) {
                await this.act({ type: 'walk', x: ev.x + rand(-1, 1), y: ev.y + rand(-1, 1) });
                await this.waitIdle({ timeout: 8 });
                this.msgs.push('(stepped closer)');
            }
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
            // the swarm can't be fought off: just outrun it
            const healthy = ev.type !== 'SWARM' && (this.s.combat ?? 3) >= 10 && this.s.hp > this.s.maxHp * 0.6;
            if (healthy && !this.s.attacking) {
                await this.act({ type: 'npc', npc: ev.npc, op: 'Attack' });
                await this.wait(2);
                return true;
            }
            if (!healthy && Date.now() - (this._reFlee ?? 0) > 8000) {
                // too hurt to fight it: put distance between us until it gives up
                this._reFlee = Date.now();
                const dx = Math.sign(this.s.x - ev.x) || 1, dy = Math.sign(this.s.y - ev.y) || 1;
                this.log(`random event: fleeing ${ev.type} at hp ${this.s.hp} (combat ${this.s.combat})`);
                await this.act({ type: 'walk', x: this.s.x + dx * 15, y: this.s.y + dy * 15, run: true });
                await this.wait(6);
                return true;
            }
        }
        return false;
    }

    // Level-ups, dialogs, random events, low HP. Returns true if it did something.
    async handleInterrupts({ answer = null } = {}) {
        // market/trading hook (set by the runner); guarded against re-entry while it walks
        if (this.hook && !this._inHook) {
            this._inHook = true;
            try { if (await this.hook(this)) return true; } finally { this._inHook = false; }
        }
        const s = this.s;
        if (await this.handleRandomEvent()) return true;
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
        if (s.dialog && s.chatbox !== 372) {
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
        // Something we didn't pick a fight with is hurting us: run toward Lumbridge
        if (s.inCombat && !s.attacking && s.hp < s.maxHp * 0.7 && !this._fleeing) {
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
    async walkTo(x, y, { tol = 2, timeout = 300 } = {}) {
        // trips between Varrock and Lumbridge go east of the dark wizards' stone circle (~3225,3370)
        if (!this._corridor) {
            const s0 = await this.state(5);
            const crosses = s0.y < 6000 && ((s0.y > 3340 && y < 3330) || (s0.y < 3330 && y > 3340)) && x > 3120 && x < 3330 && s0.x > 3120 && s0.x < 3330;
            if (crosses) {
                const south = [[3240, 3300], [3255, 3335], [3290, 3375], [3290, 3415]];
                const pts = s0.y > 3340 ? [...south].reverse() : south;
                this._corridor = true;
                try { for (const [px, py] of pts) if (Math.abs(this.s.y - py) > 3 || Math.abs(this.s.x - px) > 3) await this.walkTo(px, py, { tol: 4, timeout: 180 }); }
                finally { this._corridor = false; }
            }
        }
        const end = Date.now() + timeout * 1000;
        let stuck = 0;
        let last = null;
        while (Date.now() < end) {
            const s = await this.state(10);
            if (await this.handleInterrupts()) continue;
            if (dist(s, { x, y }) <= tol) return true;
            // somehow underground (y > 6000) while heading for the surface: take the nearest way up
            if (s.y > 6000) this._wasUnder = true;
            else if (this._wasUnder) {
                // just came up (ladder or teleport): plan the rest of the trip from here (it may need the safe corridor)
                this._wasUnder = false; this._undergroundSince = null;
                return this.walkTo(x, y, { tol, timeout: Math.max(30, (end - Date.now()) / 1000) });
            }
            if (s.y > 6000 && y < 6000) {
                // stuck down here (some cellars have no working way out): Lumbridge Home Teleport
                this._undergroundSince ??= Date.now();
                if (Date.now() - this._undergroundSince > 90_000) {
                    this.log(`stuck underground at ${s.x},${s.y}: casting Home Teleport`);
                    this._undergroundSince = null;
                    // the cast takes ~10s and any movement cancels it: hold off the market hook and just wait
                    const held = this._inHook; this._inHook = true;
                    try {
                        await this.act({ type: 'button', iface: 192, child: 0 });
                        for (let i = 0; i < 10 && (await this.state(1)).y > 6000; i++) await sleep(2000);
                    } finally { this._inHook = held; }
                    if (this.s.y > 6000) { this.log('Home Teleport did not work (cooldown?)'); this._undergroundSince = Date.now() - 60_000; }
                    continue;
                }
                this._deadLadders ??= new Set(); // ladders that "don't seem to lead anywhere"
                const ok = l => !this._deadLadders.has(`${l.x},${l.y}`);
                const up = this.nearestScenery(l => ok(l) && l.ops.some(o => /^climb-up$/i.test(o)), s) ?? this.nearestScenery(l => ok(l) && /ladder|stair/i.test(l.name), s);
                if (this.msgs.slice(-3).some(t => /doesn't seem to lead anywhere/i.test(t)) && this._lastUp) { this._deadLadders.add(this._lastUp); this.msgs.push('(dead ladder noted)'); continue; }
                if (!up) {
                    // no usable way up in sight: wander to find another one
                    await this.act({ type: 'walk', x: s.x + rand(-12, 12), y: s.y + rand(-12, 12) });
                    await this.waitIdle({ timeout: 12 });
                    continue;
                }
                this._lastUp = `${up.x},${up.y}`;
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

    // Climb the Lumbridge castle staircase to floor `target` (0-2).
    async lumbridgeFloor(target) {
        for (let i = 0; i < 8; i++) {
            const s = await this.state(8);
            if (s.z === target) return true;
            if (s.dialog && s.dialog.options.length) { await this.act({ type: 'choose', option: s.z < target ? 'up' : 'down' }); await this.wait(3); continue; }
            await this.walkTo(3206, 3210, { tol: 3 });
            await this.state(15);
            const st = this.nearestScenery(l => /staircase/i.test(l.name));
            if (!st) { await this.wait(2); continue; }
            const op = st.ops.find(o => (s.z < target ? /climb-up/i : /climb-down/i).test(o)) ?? st.ops.find(o => /^climb$/i.test(o)) ?? st.ops[0];
            await this.act({ type: 'scenery', x: st.x, y: st.y, id: st.id, op });
            await this.wait(4);
        }
        return this.s.z === target;
    }

    // ---- Grand Exchange (Varrock) ----
    // Lumbridge -> GE going east of the dark wizards' stone circle south of Varrock (they kill low levels)
    async walkToGE() {
        let s = await this.state(5);
        if (s.y > 6000) { await this.walkTo(3222, 3218, { tol: 6 }); s = await this.state(5); } // out of any cellar first
        if (dist(s, GE) <= 12) return true;
        const route = s.y < 3400 ? [[3240, 3300], [3255, 3335], [3290, 3375], [3290, 3415], [3270, 3428], [3212, 3428], [3175, 3455], [GE.x, GE.y - 8]] : [[GE.x, GE.y - 8]];
        return this.route(route, { tol: 4, timeout: 240 });
    }

    async walkFromGE() {
        return this.route([[3175, 3455], [3212, 3428], [3270, 3428], [3290, 3415], [3290, 3375], [3255, 3335], [3240, 3300], [3222, 3218]], { tol: 4, timeout: 240 });
    }

    async openGE() {
        if (this.s?.iface === 105) return true;
        if (!(await this.walkToGE())) return false;
        await this.state(12);
        const clerk = this.nearestNpc(n => /grand exchange clerk/i.test(n.name) && n.ops.includes('Exchange'));
        if (!clerk) return false;
        await this.act({ type: 'npc', npc: clerk.npc, op: 'Exchange' });
        await this.waitIdle({ timeout: 20, cond: st => st.iface === 105 });
        return (await this.state(5)).iface === 105;
    }

    // price: coins each. Returns the slot's offer once it shows up in the state, or null.
    async geOffer(kind, item, amount, price) {
        if (!(await this.openGE())) return null;
        await this.act({ type: kind === 'buy' ? 'gebuy' : 'gesell', item, amount, price });
        await this.wait(3);
        const s = await this.state(3);
        return s.ge?.find(o => o.item === item && o.sell === (kind === 'sell')) ?? null;
    }

    async geCollect() {
        if (!(await this.openGE())) return 0;
        const n = (this.s.ge ?? []).reduce((t, o) => t + o.collect, 0);
        if (n) { await this.act({ type: 'gecollect' }); await this.wait(3); await this.state(3); }
        return n;
    }

    // ---- bank: Lumbridge castle top floor (safe for low levels) ----
    async openBank() {
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

    async withdraw(item, amount = 'all') {
        await this.act({ type: 'withdraw', item, amount });
        await this.wait(1);
        await this.state(2);
    }

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
