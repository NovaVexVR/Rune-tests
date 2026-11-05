// Shared bot client library: talks to the in-engine bot API (127.0.0.1:8899).
import fs from 'fs';
import path from 'path';

const API = process.env.BOT_API ?? 'http://127.0.0.1:8899';
export const LOG_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const TICK = 600;
export const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
export const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export const SKILLS = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'];

export const FOOD = ['Shrimps', 'Anchovies', 'Bread', 'Cooked chicken', 'Cooked meat', 'Sardine', 'Herring', 'Trout', 'Salmon', 'Pike', 'Tuna', 'Lobster', 'Cake', 'Meat pie'];

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
        this.quiet = quiet;
        this.logFile = path.join(LOG_DIR, `${this.name}.log`);
    }

    log(...a) {
        const line = `${new Date().toISOString().slice(11, 19)} [${this.name}] ${a.join(' ')}`;
        if (!this.quiet) console.log(line);
        fs.appendFileSync(this.logFile, line + '\n');
    }

    async login() {
        await http('POST', `/bot/${this.name}/login`);
        for (let i = 0; i < 30; i++) {
            await sleep(500);
            const s = await this.state(5);
            if (s.online) return s;
        }
        throw new Error('login timed out');
    }

    async logout() {
        await http('POST', `/bot/${this.name}/logout`);
    }

    async state(r = 15) {
        const s = await http('GET', `/bot/${this.name}/state?r=${r}&since=${this.since}`);
        for (const m of s.messages) {
            this.since = Math.max(this.since, m.id);
            this.msgs.push(m.text);
        }
        if (this.msgs.length > 100) this.msgs.splice(0, this.msgs.length - 100);
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

    // Message text since `mark` (use this.msgs.length as a mark).
    newMessages(mark) {
        return this.msgs.slice(mark);
    }

    isIdle(s = this.s) {
        return !s.moving && !s.target && !s.delayed && s.queued === 0 && !s.busy;
    }

    inv(name, s = this.s) {
        return s.inv.filter(i => (typeof name === 'function' ? name(i) : i.name === name || i.debug === name));
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

    async wait(ticks = 1) {
        await sleep(TICK * ticks);
    }

    // Wait until the bot has been idle for `quiet` consecutive polls, or until cond() is true.
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

    // Dialogs, level-ups, random events, low health. Returns true if it did something.
    async handleInterrupts() {
        const s = this.s;
        if (s.modal.main === 'player_kit') {
            await this.act({ type: 'design' });
            await this.wait(2);
            return true;
        }
        if (s.countDialog) {
            await this.act({ type: 'count', n: 28 });
            return true;
        }
        if (s.dialog) {
            if (s.dialog.options.length > 0) {
                // random-event style prompts: pick the first sensible option
                const o = s.dialog.options.find(o => /yes|okay|ok|sure|thanks|continue/i.test(o.text)) ?? s.dialog.options[0];
                await this.act({ type: 'choose', option: o.text });
            } else {
                await this.act({ type: 'continue' });
            }
            await this.wait(1);
            return true;
        }
        if (s.modal.main && s.modal.main !== 'player_kit') {
            await this.act({ type: 'close' });
            return true;
        }
        // Random event NPCs that want to talk to us
        const macro = s.nearby.npcs.find(n => /^macro_(geni|dwarf|mage|triffidseed|.*)/.test(n.debug ?? '') && n.dist <= 3 && n.ops?.includes('Talk-to'));
        if (macro && !this._talkedMacro?.has(macro.npc)) {
            this._talkedMacro ??= new Set();
            this._talkedMacro.add(macro.npc);
            this.log(`random event: talking to ${macro.name}`);
            await this.act({ type: 'opnpc', npc: macro.npc, op: 'Talk-to' });
            await this.wait(3);
            return true;
        }
        // Eat when low
        if (s.hp <= Math.max(4, Math.floor(s.maxHp * 0.45))) {
            const food = s.inv.find(i => FOOD.includes(i.name) && i.ops?.includes('Eat'));
            if (food) {
                await this.act({ type: 'opheld', slot: food.slot, op: 'Eat' });
                await this.wait(2);
                return true;
            }
        }
        return false;
    }

    // Walk to (x,z) in hops, opening doors/gates when stuck.
    async walkTo(x, z, { tol = 2, timeout = 300 } = {}) {
        const end = Date.now() + timeout * 1000;
        let stuck = 0;
        let last = null;
        while (Date.now() < end) {
            const s = await this.state(12);
            if (await this.handleInterrupts()) continue;
            if (dist(s, { x, z }) <= tol) return true;
            if (last && dist(last, s) === 0) stuck++;
            else stuck = 0;
            last = { x: s.x, z: s.z };
            if (stuck >= 2) {
                // try a door/gate in the way (prefer ones toward the goal)
                const door = s.nearby.locs
                    .filter(l => l.ops.includes('Open') && l.dist <= 6 && !/drawer|wardrobe|cupboard|chest|coffin|bank/i.test(l.name ?? ''))
                    .sort((a, b) => dist(a, { x, z }) - dist(b, { x, z }))[0];
                if (door && stuck < 5) {
                    this.log(`opening ${door.name} at ${door.x},${door.z}`);
                    await this.act({ type: 'oploc', x: door.x, z: door.z, id: door.id, op: 'Open' });
                    await this.waitIdle({ timeout: 10 });
                } else {
                    // sidestep randomly
                    await this.act({ type: 'walk', x: s.x + rand(-8, 8), z: s.z + rand(-8, 8) });
                    await this.waitIdle({ timeout: 10 });
                }
                if (stuck > 8) {
                    this.log(`walkTo ${x},${z} gave up (stuck at ${s.x},${s.z})`);
                    return false;
                }
                continue;
            }
            // hop up to 30 tiles toward target
            const d = dist(s, { x, z });
            const k = Math.min(1, 30 / d);
            const hx = Math.round(s.x + (x - s.x) * k);
            const hz = Math.round(s.z + (z - s.z) * k);
            const r = await this.act({ type: 'walk', x: hx, z: hz });
            if (r === null) stuck++;
            await this.waitIdle({ timeout: 25, quiet: 1 });
        }
        return false;
    }

    // Walk through a list of waypoints.
    async route(points, opts) {
        for (const [x, z] of points) {
            if (!(await this.walkTo(x, z, opts))) return false;
        }
        return true;
    }

    // New characters: design appearance and take the guide's "skip tutorial" offer.
    async onboard() {
        let s = await this.state(10);
        for (let tries = 0; tries < 30 && s.x < 3150 && s.z < 3130; tries++) {
            // on Tutorial Island
            if (s.modal.main === 'player_kit') {
                await this.act({ type: 'design' });
                await this.wait(2);
            } else if (s.dialog) {
                if (s.dialog.options.some(o => /yes please/i.test(o.text))) await this.act({ type: 'choose', option: 'Yes please' });
                else await this.act({ type: 'continue' });
                await this.wait(2);
            } else {
                const guide = s.nearby.npcs.find(n => n.name === 'RuneScape Guide');
                if (guide) await this.act({ type: 'opnpc', npc: guide.npc, op: 'Talk-to' });
                await this.wait(4);
            }
            s = await this.state(10);
        }
        if (s.x < 3150 && s.z < 3130) throw new Error('could not leave tutorial island');
        this.log(`onboarded at ${s.x},${s.z}`);
    }

    nearestLoc(pred, s = this.s) {
        return s.nearby.locs.filter(pred).sort((a, b) => a.dist - b.dist)[0] ?? null;
    }

    nearestNpc(pred, s = this.s) {
        return s.nearby.npcs.filter(pred).sort((a, b) => a.dist - b.dist)[0] ?? null;
    }

    async dropAll(pred) {
        for (const it of this.s.inv.filter(pred)) {
            await this.act({ type: 'opheld', slot: it.slot, op: 'Drop' });
            await this.wait(1);
        }
        await this.state();
    }

    async equip(name) {
        const it = this.s.inv.find(i => i.name === name);
        if (!it) return false;
        const op = it.ops.find(o => /^(Wield|Wear)$/.test(o));
        if (!op) return false;
        await this.act({ type: 'opheld', slot: it.slot, op });
        await this.wait(2);
        await this.state();
        return true;
    }
}

export function summary(s) {
    const lv = SKILLS.map(k => `${k.slice(0, 3)}:${s.stats[k].level}`).join(' ');
    return `total ${s.totalLevel} cb ${s.combat} @${s.x},${s.z} | ${lv}`;
}
