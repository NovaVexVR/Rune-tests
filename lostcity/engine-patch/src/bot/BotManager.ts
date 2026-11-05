// In-process bot support for the LostCity engine.
//
// Bots are ordinary NetworkPlayers whose "socket" is a BotSocket. Instead of reading
// encoded packets, each tick the bot's queued actions are turned into the same client
// message objects a real client would send and passed to the real packet handlers,
// so bots obey every game rule (pathing, delays, level requirements, scripts).
//
// A small HTTP API (127.0.0.1:8899) lets external controllers (scripted bots, or
// Claude via a CLI) log bots in/out, read their state, and queue actions.

import fs from 'fs';
import http from 'http';

import Component from '#/cache/config/Component.js';
import IdkType from '#/cache/config/IdkType.js';
import InvType from '#/cache/config/InvType.js';
import LocType from '#/cache/config/LocType.js';
import NpcType from '#/cache/config/NpcType.js';
import ObjType from '#/cache/config/ObjType.js';
import { findPath, findPathToEntity, findPathToLoc } from '#/engine/GameMap.js';
import Loc from '#/engine/entity/Loc.js';
import Obj from '#/engine/entity/Obj.js';
import { NetworkPlayer } from '#/engine/entity/NetworkPlayer.js';
import Player from '#/engine/entity/Player.js';
import { PlayerLoading } from '#/engine/entity/PlayerLoading.js';
import World from '#/engine/World.js';
import Packet from '#/io/Packet.js';
import ClientGameMessage from '#/network/game/client/ClientGameMessage.js';
import CloseModalHandler from '#/network/game/client/handler/CloseModalHandler.js';
import IdkSaveDesignHandler from '#/network/game/client/handler/IdkSaveDesignHandler.js';
import IfButtonHandler from '#/network/game/client/handler/IfButtonHandler.js';
import InvButtonHandler from '#/network/game/client/handler/InvButtonHandler.js';
import MessagePublicHandler from '#/network/game/client/handler/MessagePublicHandler.js';
import OpHeldHandler from '#/network/game/client/handler/OpHeldHandler.js';
import OpHeldUHandler from '#/network/game/client/handler/OpHeldUHandler.js';
import OpLocHandler from '#/network/game/client/handler/OpLocHandler.js';
import OpLocUHandler from '#/network/game/client/handler/OpLocUHandler.js';
import OpNpcHandler from '#/network/game/client/handler/OpNpcHandler.js';
import OpNpcTHandler from '#/network/game/client/handler/OpNpcTHandler.js';
import OpNpcUHandler from '#/network/game/client/handler/OpNpcUHandler.js';
import OpObjHandler from '#/network/game/client/handler/OpObjHandler.js';
import ResumePauseButtonHandler from '#/network/game/client/handler/ResumePauseButtonHandler.js';
import ResumePCountDialogHandler from '#/network/game/client/handler/ResumePCountDialogHandler.js';
import CloseModal from '#/network/game/client/model/CloseModal.js';
import IdkSaveDesign from '#/network/game/client/model/IdkSaveDesign.js';
import IfButton from '#/network/game/client/model/IfButton.js';
import InvButton from '#/network/game/client/model/InvButton.js';
import MessagePublic from '#/network/game/client/model/MessagePublic.js';
import OpHeld from '#/network/game/client/model/OpHeld.js';
import OpHeldU from '#/network/game/client/model/OpHeldU.js';
import OpLoc from '#/network/game/client/model/OpLoc.js';
import OpLocU from '#/network/game/client/model/OpLocU.js';
import OpNpc from '#/network/game/client/model/OpNpc.js';
import OpNpcT from '#/network/game/client/model/OpNpcT.js';
import OpNpcU from '#/network/game/client/model/OpNpcU.js';
import OpObj from '#/network/game/client/model/OpObj.js';
import ResumePauseButton from '#/network/game/client/model/ResumePauseButton.js';
import ResumePCountDialog from '#/network/game/client/model/ResumePCountDialog.js';
import ServerGameMessage from '#/network/game/server/ServerGameMessage.js';
import IfSetText from '#/network/game/server/model/IfSetText.js';
import MessageGame from '#/network/game/server/model/MessageGame.js';
import PCountDialog from '#/network/game/server/model/PCountDialog.js';
import ClientSocket from '#/server/ClientSocket.js';
import Environment from '#/util/Environment.js';
import { printInfo } from '#/util/Logger.js';
import WordPack from '#/wordenc/WordPack.js';

const SKILLS = ['attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting', 'smithing', 'mining', 'herblore', 'agility', 'thieving', 'stat18', 'stat19', 'runecraft'];

class BotSocket extends ClientSocket {
    closed = false;
    constructor() {
        super();
        this.remoteAddress = '127.0.0.1';
        this.state = 1;
    }
    send(_src: Uint8Array): void {}
    close(): void {
        this.closed = true;
    }
    terminate(): void {
        this.closed = true;
    }
}

type Handler = { handle(message: ClientGameMessage, player: NetworkPlayer): boolean };

interface BotData {
    name: string;
    player: NetworkPlayer;
    socket: BotSocket;
    queue: { msg: ClientGameMessage; handler: Handler }[];
    messages: { id: number; tick: number; text: string }[];
    msgSeq: number;
    texts: Map<number, string>;
    countDialog: boolean;
    lastActionTick: number;
}

const H = {
    oploc: new OpLocHandler() as unknown as Handler,
    oplocu: new OpLocUHandler() as unknown as Handler,
    opnpc: new OpNpcHandler() as unknown as Handler,
    opnpct: new OpNpcTHandler() as unknown as Handler,
    opnpcu: new OpNpcUHandler() as unknown as Handler,
    opobj: new OpObjHandler() as unknown as Handler,
    opheld: new OpHeldHandler() as unknown as Handler,
    opheldu: new OpHeldUHandler() as unknown as Handler,
    ifbutton: new IfButtonHandler() as unknown as Handler,
    invbutton: new InvButtonHandler() as unknown as Handler,
    resume: new ResumePauseButtonHandler() as unknown as Handler,
    count: new ResumePCountDialogHandler() as unknown as Handler,
    close: new CloseModalHandler() as unknown as Handler,
    idk: new IdkSaveDesignHandler() as unknown as Handler,
    say: new MessagePublicHandler() as unknown as Handler
};

const PATHING_HANDLERS = new Set<Handler>([H.oploc, H.oplocu, H.opnpc, H.opnpcu, H.opnpct, H.opobj]);

let STYLE_COMS: number[] | null = null;

class BotError extends Error {}

// What the real client's routefinder does when you click an entity.
function smartPathToTarget(p: NetworkPlayer) {
    const t: any = p.target;
    if (!t) return;
    if (t instanceof Loc) {
        const forceapproach = LocType.get(t.type).forceapproach;
        p.queueWaypoints(findPathToLoc(p.level, p.x, p.z, t.x, t.z, p.width, t.width, t.length, t.angle, t.shape, forceapproach));
    } else if (t instanceof Obj) {
        if (p.x === t.x && p.z === t.z) p.queueWaypoint(t.x, t.z);
        else p.queueWaypoints(findPath(p.level, p.x, p.z, t.x, t.z));
    } else {
        p.queueWaypoints(findPathToEntity(p.level, p.x, p.z, t.x, t.z, p.width, t.width, t.length));
    }
}

function opIndex(ops: (string | null)[] | null | undefined, op: unknown): number {
    if (typeof op === 'number') return op;
    if (!ops) throw new BotError('entity has no options');
    const want = String(op).toLowerCase();
    const idx = ops.findIndex(o => o !== null && o.toLowerCase() === want);
    if (idx === -1) throw new BotError(`option '${op}' not found (have: ${ops.filter(Boolean).join(', ')})`);
    return idx + 1;
}

function comId(com: unknown): number {
    if (typeof com === 'number') return com;
    const id = Component.getId(String(com));
    if (id === -1) throw new BotError(`unknown component ${com}`);
    return id;
}

function ifaceName(id: number): string | null {
    if (id === -1) return null;
    return Component.get(id)?.comName ?? String(id);
}

class BotManager {
    bots = new Map<string, BotData>();

    login(name: string): BotData {
        name = name.toLowerCase().replace(/[^a-z0-9_ ]/g, '').slice(0, 12);
        if (!name) throw new BotError('bad name');
        const existing = this.bots.get(name);
        if (existing && !existing.socket.closed) return existing;
        for (const p of World.players) {
            if (p && p.username === name) throw new BotError('a player with that name is already online');
        }

        const profile = Environment.node.profile;
        const path = `data/players/${profile}/${name}.sav`;
        const save = fs.existsSync(path) ? fs.readFileSync(path) : new Uint8Array();

        const socket = new BotSocket();
        const player = PlayerLoading.load(name, new Packet(save), socket) as NetworkPlayer;
        player.members = Environment.node.members;
        player.lowMemory = false;

        const bot: BotData = { name, player, socket, queue: [], messages: [], msgSeq: 0, texts: new Map(), countDialog: false, lastActionTick: 0 };
        this.attach(bot);
        this.bots.set(name, bot);
        World.newPlayers.add(player);
        printInfo(`[bot] ${name} logging in`);
        return bot;
    }

    logout(name: string) {
        const bot = this.get(name);
        bot.player.requestLogout = true;
    }

    get(name: string): BotData {
        const bot = this.bots.get(name.toLowerCase());
        if (!bot) throw new BotError(`no bot named ${name}`);
        return bot;
    }

    private attach(bot: BotData) {
        const player = bot.player;
        // Feed queued actions into the real handlers instead of reading a socket.
        player.decodeIn = function (this: NetworkPlayer) {
            this.userPath = [];
            this.opcalled = false;
            if (bot.socket.closed) return false;
            this.lastConnected = World.currentTick;
            this.lastResponse = World.currentTick;
            // one user event per tick, like a human clicking
            const item = bot.queue.shift();
            if (item) {
                try {
                    const ok = item.handler.handle(item.msg, this);
                    // A real client sends its own route along with an op click
                    // (client-side routefinding); do the equivalent here.
                    if (ok && this.target && PATHING_HANDLERS.has(item.handler)) {
                        smartPathToTarget(this);
                        this.userPath = [1];
                    }
                    if (!ok) bot.messages.push({ id: ++bot.msgSeq, tick: World.currentTick, text: `[bot] action rejected: ${item.msg.constructor.name}` });
                } catch (err) {
                    bot.messages.push({ id: ++bot.msgSeq, tick: World.currentTick, text: `[bot] action error: ${(err as Error).message}` });
                }
                bot.lastActionTick = World.currentTick;
            }
            return true;
        };
        // Capture the bits of server output a bot needs; drop the rest.
        player.writeInner = function (message: ServerGameMessage) {
            if (message instanceof MessageGame) {
                bot.messages.push({ id: ++bot.msgSeq, tick: World.currentTick, text: message.msg });
                if (bot.messages.length > 200) bot.messages.splice(0, bot.messages.length - 200);
            } else if (message instanceof IfSetText) {
                bot.texts.set(message.component, message.text);
            } else if (message instanceof PCountDialog) {
                bot.countDialog = true;
            }
        };
    }

    enqueue(bot: BotData, msg: ClientGameMessage, handler: Handler) {
        if (bot.queue.length > 20) throw new BotError('action queue full');
        bot.queue.push({ msg, handler });
    }

    invSlotFor(bot: BotData, a: { slot?: number; item?: string | number }): { slot: number; id: number } {
        const inv = bot.player.getInventory(InvType.INV)!;
        if (a.slot !== undefined) {
            const it = inv.get(a.slot);
            if (!it) throw new BotError(`inventory slot ${a.slot} empty`);
            return { slot: a.slot, id: it.id };
        }
        if (a.item !== undefined) {
            const id = typeof a.item === 'number' ? a.item : ObjType.getId(String(a.item));
            for (let i = 0; i < inv.capacity; i++) {
                const it = inv.get(i);
                if (it && (it.id === id || (typeof a.item === 'string' && ObjType.get(it.id).name?.toLowerCase() === a.item.toLowerCase()))) return { slot: i, id: it.id };
            }
            throw new BotError(`item ${a.item} not in inventory`);
        }
        throw new BotError('need slot or item');
    }

    findLoc(bot: BotData, a: { x: number; z: number; id?: number | string }) {
        const p = bot.player;
        const zone = World.gameMap.getZone(a.x, a.z, p.level);
        for (const loc of zone.getAllLocsSafe()) {
            if (loc.x !== a.x || loc.z !== a.z) continue;
            if (a.id === undefined) return loc;
            const t = LocType.get(loc.type);
            if (loc.type === a.id || t.debugname === a.id || t.name?.toLowerCase() === String(a.id).toLowerCase()) return loc;
        }
        throw new BotError(`no loc ${a.id ?? ''} at ${a.x},${a.z}`);
    }

    act(name: string, a: Record<string, any>): string {
        const bot = this.get(name);
        const p = bot.player;
        switch (a.type) {
            case 'walk': {
                const path = findPath(p.level, p.x, p.z, a.x, a.z);
                if (path.length === 0) throw new BotError('no path');
                // A walk is a "move click": apply on the next tick like a client packet.
                const handler: Handler = {
                    handle: (_m, pl) => {
                        if (pl.delayed) return false;
                        pl.clearPendingAction();
                        pl.tempRun = 0;
                        pl.queueWaypoints(findPath(pl.level, pl.x, pl.z, a.x, a.z));
                        pl.userPath = [1];
                        return true;
                    }
                };
                this.enqueue(bot, new CloseModal(), handler);
                return `walking to ${a.x},${a.z}`;
            }
            case 'oploc': {
                const loc = this.findLoc(bot, a as any);
                const t = LocType.get(loc.type);
                const op = opIndex(t.op, a.op ?? 1);
                this.enqueue(bot, new OpLoc(op, loc.x, loc.z, loc.type), H.oploc);
                return `${t.op?.[op - 1]} ${t.name}`;
            }
            case 'opnpc': {
                const npc = World.getNpc(a.npc);
                if (!npc) throw new BotError(`no npc slot ${a.npc}`);
                const t = NpcType.get(npc.type);
                const op = opIndex(t.op, a.op ?? 1);
                this.enqueue(bot, new OpNpc(op, npc.nid), H.opnpc);
                return `${t.op?.[op - 1]} ${t.name}`;
            }
            case 'opobj': {
                const id = typeof a.id === 'number' ? a.id : ObjType.getId(a.id);
                this.enqueue(bot, new OpObj(a.op ?? 3, a.x, a.z, id), H.opobj);
                return `take ${ObjType.get(id).name}`;
            }
            case 'opheld': {
                const { slot, id } = this.invSlotFor(bot, a);
                const t = ObjType.get(id);
                const op = opIndex(t.iop, a.op ?? 1);
                this.enqueue(bot, new OpHeld(op, id, slot, comId('inventory:inv')), H.opheld);
                return `${t.iop?.[op - 1]} ${t.name}`;
            }
            case 'useheld': {
                // use item on: another held item (onSlot/onItem), loc (x,z,id), or npc (npc)
                const src = this.invSlotFor(bot, a);
                const inv = comId('inventory:inv');
                if (a.onSlot !== undefined || a.onItem !== undefined) {
                    const dst = this.invSlotFor(bot, { slot: a.onSlot, item: a.onItem });
                    this.enqueue(bot, new OpHeldU(dst.id, dst.slot, inv, src.id, src.slot, inv), H.opheldu);
                    return 'use item on item';
                } else if (a.npc !== undefined) {
                    this.enqueue(bot, new OpNpcU(a.npc, src.id, src.slot, inv), H.opnpcu);
                    return 'use item on npc';
                } else {
                    const loc = this.findLoc(bot, a.on);
                    this.enqueue(bot, new OpLocU(loc.x, loc.z, loc.type, src.id, src.slot, inv), H.oplocu);
                    return `use item on ${LocType.get(loc.type).name}`;
                }
            }
            case 'spellnpc': {
                this.enqueue(bot, new OpNpcT(a.npc, comId(a.spell)), H.opnpct);
                return `cast ${a.spell}`;
            }
            case 'button': {
                this.enqueue(bot, new IfButton(comId(a.com)), H.ifbutton);
                return `click ${a.com}`;
            }
            case 'invbutton': {
                // e.g. bank deposit: com 'bank_side:inv', withdraw: 'bank_main:inv', shops etc.
                const cid = comId(a.com);
                const listener = p.invListeners.find(l => l.com === cid);
                const inv = listener ? p.getInventoryFromListener(listener) : null;
                if (!inv) throw new BotError(`inventory for ${a.com} not open`);
                let slot = a.slot;
                if (slot === undefined) {
                    const id = typeof a.item === 'number' ? a.item : ObjType.getId(a.item);
                    slot = inv.items.findIndex(it => it && it.id === id);
                    if (slot === -1) throw new BotError(`${a.item} not in ${a.com}`);
                }
                const it = inv.get(slot);
                if (!it) throw new BotError('empty slot');
                this.enqueue(bot, new InvButton(a.op ?? 1, it.id, slot, cid), H.invbutton);
                return `invbutton ${a.op ?? 1} on ${ObjType.get(it.id).name}`;
            }
            case 'continue': {
                this.enqueue(bot, new ResumePauseButton(), H.resume);
                return 'continue';
            }
            case 'choose': {
                // choose a dialog option by its text (or 1-based index)
                const opts = this.dialogOptions(bot);
                const want = typeof a.option === 'number' ? opts[a.option - 1] : opts.find(o => o.text.toLowerCase().includes(String(a.option).toLowerCase()));
                if (!want) throw new BotError(`option not found: ${a.option} (have: ${opts.map(o => o.text).join(' | ')})`);
                this.enqueue(bot, new IfButton(want.com), H.ifbutton);
                return `choose '${want.text}'`;
            }
            case 'count': {
                bot.countDialog = false;
                this.enqueue(bot, new ResumePCountDialog(a.n), H.count);
                return `enter ${a.n}`;
            }
            case 'close': {
                this.enqueue(bot, new CloseModal(), H.close);
                return 'close';
            }
            case 'design': {
                const male = a.gender === undefined ? (Math.random() < 0.5 ? 0 : 1) : a.gender;
                const kits: number[] = [];
                for (let part = 0; part < 7; part++) {
                    const type = part + (male === 1 ? 7 : 0);
                    const options: number[] = [];
                    for (let i = 0; i < IdkType.count; i++) {
                        const k = IdkType.get(i);
                        if (k && !k.disable && k.type === type) options.push(i);
                    }
                    kits.push(options.length ? options[Math.floor(Math.random() * options.length)] : -1);
                }
                const cols = Player.DESIGN_BODY_COLORS.map(c => Math.floor(Math.random() * c.length));
                this.enqueue(bot, new IdkSaveDesign(male, kits, cols), H.idk);
                this.enqueue(bot, new IfButton(comId('player_kit:accept')), H.ifbutton);
                return 'save design';
            }
            case 'say': {
                const buf = Packet.alloc(0);
                WordPack.pack(buf, String(a.text).slice(0, 80));
                const bytes = buf.data.slice(0, buf.pos);
                buf.release();
                this.enqueue(bot, new MessagePublic(bytes, 0, 0), H.say);
                return `say ${a.text}`;
            }
            case 'style': {
                // attack style button N on whichever combat tab is showing (0=accurate, 1=aggressive, last=defensive)
                if (!STYLE_COMS) {
                    STYLE_COMS = [];
                    for (let i = 0; i < 20000; i++) {
                        const c = Component.get(i);
                        if (c && c.comName && /^combat_[a-z_]+:[a-z]+[0-9]$/.test(c.comName)) STYLE_COMS.push(i);
                    }
                }
                const visible = STYLE_COMS.filter(id => p.isComponentVisible(Component.get(id)));
                const n = Math.min(a.n, Math.max(...visible.map(id => Number(Component.get(id).comName!.slice(-1)))));
                const id = visible.find(id => Component.get(id).comName!.endsWith(String(n)));
                if (id === undefined) throw new BotError('no combat style buttons visible');
                this.enqueue(bot, new IfButton(id), H.ifbutton);
                return `style ${Component.get(id).comName}`;
            }
            case 'clear': {
                bot.queue.length = 0;
                return 'cleared';
            }
            default:
                throw new BotError(`unknown action type ${a.type}`);
        }
    }

    dialogOptions(bot: BotData) {
        return bot.player.resumeButtons.map(com => ({ com, text: (bot.texts.get(com) ?? '').replace(/@...@/g, '') }));
    }

    state(name: string, radius = 15, since = 0) {
        const bot = this.get(name);
        const p = bot.player;
        const inv = p.getInventory(InvType.INV);
        const worn = p.getInventory(InvType.WORN);
        const items = (i: typeof inv) => (i ? i.items.map((it, slot) => (it ? { slot, id: it.id, name: ObjType.get(it.id).name, debug: ObjType.get(it.id).debugname, count: it.count, ops: ObjType.get(it.id).iop?.filter(Boolean) } : null)).filter(Boolean) : []);
        const dist = (x: number, z: number) => Math.max(Math.abs(x - p.x), Math.abs(z - p.z));

        const npcs: any[] = [];
        const locs: any[] = [];
        const objs: any[] = [];
        const players: any[] = [];
        const seenZone = new Set<number>();
        for (let dx = -radius; dx <= radius + 8; dx += 8) {
            for (let dz = -radius; dz <= radius + 8; dz += 8) {
                const x = p.x + Math.max(-radius, Math.min(radius, dx));
                const z = p.z + Math.max(-radius, Math.min(radius, dz));
                const zone = World.gameMap.getZone(x, z, p.level);
                const key = ((x >> 3) << 16) | (z >> 3);
                if (seenZone.has(key)) continue;
                seenZone.add(key);
                for (const n of zone.getAllNpcsSafe()) {
                    if (dist(n.x, n.z) > radius) continue;
                    const t = NpcType.get(n.type);
                    npcs.push({ npc: n.nid, name: t.name, debug: t.debugname, x: n.x, z: n.z, dist: dist(n.x, n.z), level: t.vislevel, ops: t.op?.filter(Boolean), hp: n.levels[3], busy: n.target !== null && n.target !== p });
                }
                for (const l of zone.getAllLocsSafe()) {
                    if (dist(l.x, l.z) > radius) continue;
                    const t = LocType.get(l.type);
                    if (!t.op || !t.op.some(o => o && o !== 'hidden')) continue;
                    locs.push({ id: l.type, name: t.name, debug: t.debugname, x: l.x, z: l.z, dist: dist(l.x, l.z), ops: t.op.filter(o => o && o !== 'hidden') });
                }
                for (const o of zone.getAllObjsSafe()) {
                    if (dist(o.x, o.z) > radius || !o.isValid(p.hash64)) continue;
                    const t = ObjType.get(o.type);
                    objs.push({ id: o.type, name: t.name, debug: t.debugname, x: o.x, z: o.z, count: o.count, dist: dist(o.x, o.z) });
                }
                for (const o of zone.getAllPlayersSafe()) {
                    if (o === p || dist(o.x, o.z) > radius) continue;
                    players.push({ name: o.username, x: o.x, z: o.z, combat: o.combatLevel });
                }
            }
        }
        npcs.sort((a, b) => a.dist - b.dist);
        locs.sort((a, b) => a.dist - b.dist);
        objs.sort((a, b) => a.dist - b.dist);

        const chatTexts: Record<string, string> = {};
        if (p.modalChat !== -1) {
            for (const [com, text] of bot.texts) {
                const c = Component.get(com);
                if (c && c.rootLayer === p.modalChat && text) chatTexts[c.comName ?? String(com)] = text.replace(/@...@/g, '');
            }
        }

        let target: string | null = null;
        if (p.target) {
            const t: any = p.target;
            target = t.nid !== undefined ? `npc ${NpcType.get(t.type).name}` : t.username ? `player ${t.username}` : 'loc/obj';
        }

        return {
            name: bot.name,
            online: !bot.socket.closed && World.players.includes(p),
            tick: World.currentTick,
            x: p.x,
            z: p.z,
            level: p.level,
            combat: p.combatLevel,
            hp: p.levels[3],
            maxHp: p.baseLevels[3],
            runEnergy: Math.floor(p.runenergy / 100),
            moving: p.hasWaypoints(),
            debug: { moveSpeed: p.moveSpeed, walkDir: p.walkDir, wp: Array.from((p as any).waypoints.slice(0, (p as any).waypointIndex + 1)).map((c: any) => [(c >> 14) & 0x3fff, c & 0x3fff]) },
            delayed: p.delayed,
            busy: p.busy(),
            target,
            queued: bot.queue.length,
            idleTicks: World.currentTick - bot.lastActionTick,
            stats: Object.fromEntries(SKILLS.map((s, i) => [s, { level: p.baseLevels[i], cur: p.levels[i], xp: Math.floor(p.stats[i] / 10) }]).filter(([s]) => !String(s).startsWith('stat'))),
            totalLevel: SKILLS.reduce((t, s, i) => (s.startsWith('stat') ? t : t + p.baseLevels[i]), 0),
            inv: items(inv),
            invFree: inv ? inv.items.filter(i => !i).length : 0,
            worn: items(worn),
            modal: { main: ifaceName(p.modalMain), chat: ifaceName(p.modalChat), side: ifaceName(p.modalSide) },
            dialog: p.modalChat !== -1 ? { texts: chatTexts, options: this.dialogOptions(bot) } : null,
            countDialog: bot.countDialog,
            messages: bot.messages.filter(m => m.id > since),
            nearby: { npcs: npcs.slice(0, 25), locs: locs.slice(0, 40), objs: objs.slice(0, 20), players }
        };
    }

    startApi(port = 8899) {
        const server = http.createServer((req, res) => {
            let body = '';
            req.on('data', c => (body += c));
            req.on('end', () => {
                const reply = (code: number, v: unknown) => {
                    res.writeHead(code, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(v));
                };
                try {
                    const url = new URL(req.url ?? '/', 'http://x');
                    const parts = url.pathname.split('/').filter(Boolean);
                    const json = body ? JSON.parse(body) : {};
                    if (parts[0] === 'bots' && parts.length === 1) {
                        return reply(200, [...this.bots.values()].map(b => ({ name: b.name, online: !b.socket.closed && World.players.includes(b.player), x: b.player.x, z: b.player.z, total: this.state(b.name, 0).totalLevel })));
                    }
                    if (parts[0] === 'bot' && parts[1]) {
                        const name = decodeURIComponent(parts[1]);
                        const what = parts[2] ?? 'state';
                        if (what === 'login') return reply(200, { ok: true, name: this.login(name).name });
                        if (what === 'logout') {
                            this.logout(name);
                            return reply(200, { ok: true });
                        }
                        if (what === 'state') return reply(200, this.state(name, Number(url.searchParams.get('r') ?? 15), Number(url.searchParams.get('since') ?? 0)));
                        if (what === 'act') {
                            const acts = Array.isArray(json) ? json : [json];
                            return reply(200, { ok: true, results: acts.map(a => this.act(name, a)) });
                        }
                    }
                    if (parts[0] === 'lookup') {
                        // find type ids by name: /lookup?kind=loc|npc|obj|com&q=tree
                        const kind = url.searchParams.get('kind');
                        const q = (url.searchParams.get('q') ?? '').toLowerCase();
                        const out: any[] = [];
                        const T: any = kind === 'loc' ? LocType : kind === 'npc' ? NpcType : kind === 'obj' ? ObjType : null;
                        if (T) {
                            for (let i = 0; i < T.count && out.length < 50; i++) {
                                const t = T.get(i);
                                if ((t.name ?? '').toLowerCase().includes(q) || (t.debugname ?? '').includes(q)) out.push({ id: i, name: t.name, debug: t.debugname, ops: t.op ?? t.iop });
                            }
                        }
                        return reply(200, out);
                    }
                    reply(404, { error: 'not found' });
                } catch (err) {
                    reply(err instanceof BotError ? 400 : 500, { error: (err as Error).message });
                }
            });
        });
        server.listen(port, '127.0.0.1', () => printInfo(`[bot] control API on http://127.0.0.1:${port}`));
    }
}

export default new BotManager();
