package content.botapi

import core.ServerConstants
import core.api.StartupListener
import core.api.TickListener
import core.game.node.entity.npc.NPC
import core.game.node.entity.player.Player
import core.game.node.entity.player.info.ClientInfo
import core.game.node.entity.player.info.PlayerDetails
import core.game.node.entity.player.info.login.LoginParser
import core.game.node.entity.skill.Skills
import core.game.node.item.GroundItemManager
import core.game.node.scenery.Scenery
import core.game.world.GameWorld
import core.game.world.map.Location
import core.game.world.map.RegionManager
import core.game.world.repository.Repository
import core.net.IoSession
import core.net.packet.PacketProcessor
import core.net.packet.`in`.Packet
import com.sun.net.httpserver.HttpServer
import org.json.simple.JSONArray
import org.json.simple.JSONObject
import org.json.simple.parser.JSONParser
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit

/**
 * Bot control API (127.0.0.1:8899).
 *
 * Bots are ordinary (non-artificial) players logged in through the normal LoginParser with a
 * session that has no socket. They load/save like any account and start as fresh characters.
 * Every action is turned into the same decoded Packet a real client would send and fed to the
 * real PacketProcessor, so bots follow all game rules.
 */
class BotSession : IoSession(null, null) {
    override fun getRemoteAddress(): String = "127.0.0.1"
    override fun write(context: Any?, instant: Boolean) {}
    override fun queue(buffer: ByteBuffer?) {}
    override fun write() {}
    override fun getLastPing(): Long = System.currentTimeMillis()
}

class BotData(val name: String, val session: BotSession) {
    var player: Player? = null
    val messages = ArrayList<Pair<Int, String>>()
    val pms = ArrayList<Triple<Int, String, String>>() // (seq, from, text)
    var seq = 0
    // interface id -> (child -> text), captured from outgoing string packets
    val strings = HashMap<Int, HashMap<Int, String>>()
    @Synchronized fun addMessage(m: String) {
        messages.add(Pair(++seq, m))
        if (messages.size > 200) messages.removeAt(0)
    }
}

object BotRegistry {
    val bots = HashMap<String, BotData>()
    // random event types enabled for API bots (others are skipped); change via POST /events
    @JvmField val allowedEvents: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet<String>())
    private val jobs = ConcurrentLinkedQueue<() -> Unit>()
    private val IF_OPCODES = intArrayOf(155, 196, 124, 199, 234, 168, 166, 64, 53, 9)

    fun isBot(p: Player?): Boolean = p != null && bots[p.username.lowercase()]?.player === p

    @JvmStatic fun onMessage(p: Player, msg: String) {
        bots[p.username.lowercase()]?.let { if (it.player === p) it.addMessage(msg) }
    }

    @JvmStatic fun onPm(p: Player, from: String, text: String) {
        bots[p.username.lowercase()]?.let { if (it.player === p) synchronized(it) { it.pms.add(Triple(++it.seq, from.lowercase(), text)); if (it.pms.size > 100) it.pms.removeAt(0) } }
    }

    @JvmStatic fun onString(p: Player, iface: Int, child: Int, text: String) {
        bots[p.username.lowercase()]?.let { if (it.player === p) synchronized(it) { it.strings.getOrPut(iface) { HashMap() }[child] = text } }
    }

    fun runJobs() {
        while (true) {
            val j = jobs.poll() ?: break
            try { j() } catch (e: Throwable) { e.printStackTrace() }
        }
    }

    /** Run on the game thread and wait for the result. */
    fun <T> onGame(block: () -> T): T {
        val f = CompletableFuture<T>()
        jobs.add { try { f.complete(block()) } catch (e: Throwable) { f.completeExceptionally(e) } }
        return f.get(10, TimeUnit.SECONDS)
    }

    class BotError(msg: String) : Exception(msg)

    fun login(rawName: String): String {
        val name = rawName.lowercase().replace(Regex("[^a-z0-9_ ]"), "").take(12)
        if (name.isEmpty()) throw BotError("bad name")
        val existing = bots[name]
        if (existing?.player != null && existing.player!!.isActive) return name
        if (Repository.getPlayerByName(name) != null) throw BotError("$name is already online")

        val (resp, info) = GameWorld.authenticator.checkLogin(name, "botpassword")
        if (info == null) throw BotError("auth failed: $resp")
        info.rights = 0 // bots are plain players, never admins
        val session = BotSession()
        session.clientInfo = ClientInfo(0, 0, 765, 503)
        val seed = IntArray(4) { (Math.random() * Int.MAX_VALUE).toInt() }
        session.isaacPair = core.cache.crypto.ISAACPair(core.cache.crypto.ISAACCipher(seed), core.cache.crypto.ISAACCipher(seed.map { it + 50 }.toIntArray()))
        val details = PlayerDetails(name)
        details.accountInfo = info
        details.session = session
        val bot = BotData(name, session)
        bots[name] = bot
        val player = Player(details)
        bot.player = player
        Repository.addPlayer(player)
        LoginParser(details).initialize(player, false)
        return name
    }

    /**
     * Breadth-first search (8 directions) over the server's clipping flags, using the same masks as
     * SmartPathfinder. A move blocked only by a wall counts as passable where a door or gate stands,
     * since bots open those on the way. Tiles inside `avoid` circles (x, y, radius) are off limits.
     * Returns waypoints about 14 tiles apart and the doors on the way.
     */
    fun planRoute(fx: Int, fy: Int, tx: Int, ty: Int, z: Int, avoid: List<List<Int>>, solid: Set<Int> = emptySet(), step: Int = 14): JSONObject {
        val margin = 60
        val x0 = minOf(fx, tx) - margin; val y0 = minOf(fy, ty) - margin
        val w = maxOf(fx, tx) + margin - x0 + 1; val h = maxOf(fy, ty) + margin - y0 + 1
        if (w * h > 700 * 700) throw BotError("route too long")
        val flags = IntArray(w * h) { i -> RegionManager.getClippingFlag(z, x0 + i % w, y0 + i / w) }
        val banned = BooleanArray(w * h) { i -> val x = x0 + i % w; val y = y0 + i / w; avoid.any { (ax, ay, r) -> maxOf(Math.abs(x - ax), Math.abs(y - ay)) <= r } }
        val doorCache = HashMap<Int, Boolean>()
        // doors: openable straight-wall objects (doors, gates, the maze's real doors), by tile and the edge they sit on
        // (rotation 0 west, 1 north, 2 east, 3 south). `door(x, y)` = any door on the tile; `doorOn(x, y, side)` = one on that edge.
        fun doorsAt(x: Int, y: Int): List<core.game.node.scenery.Scenery> {
            val loc = core.game.world.map.Location(x, y, z)
            val here = RegionManager.getRegionChunk(loc).objects?.getOrNull(loc.chunkOffsetX)?.getOrNull(loc.chunkOffsetY) ?: return emptyList()
            return here.filterNotNull().filter { o -> o.isRenderable && o.id !in solid && o.type == 0 && o.definition.options?.any { it != null && it.equals("Open", true) } == true }
        }
        fun door(x: Int, y: Int): Boolean = doorCache.getOrPut(x * 65536 + y) { doorsAt(x, y).isNotEmpty() }
        fun doorOn(x: Int, y: Int, side: Int): Boolean = door(x, y) && doorsAt(x, y).any { it.rotation == side }
        fun f(x: Int, y: Int) = if (x < x0 || y < y0 || x >= x0 + w || y >= y0 + h) -1 else flags[(y - y0) * w + (x - x0)]
        val dirs = arrayOf(intArrayOf(0, -1, 0x12c0102), intArrayOf(-1, 0, 0x12c0108), intArrayOf(0, 1, 0x12c0120), intArrayOf(1, 0, 0x12c0180),
            intArrayOf(-1, -1, 0x12c010e), intArrayOf(-1, 1, 0x12c0138), intArrayOf(1, -1, 0x12c0183), intArrayOf(1, 1, 0x12c01e0))
        val prev = IntArray(w * h) { -1 }
        val viaDoor = BooleanArray(w * h) // reached by opening a door
        val start = (fy - y0) * w + (fx - x0); val goal = (ty - y0) * w + (tx - x0)
        prev[start] = start
        val queue = java.util.ArrayDeque<Int>(); queue.add(start)
        var doorsUsed = 0
        while (queue.isNotEmpty()) {
            val cur = queue.poll()
            if (cur == goal) break
            val cx = x0 + cur % w; val cy = y0 + cur / w
            for (d in dirs) {
                val nx = cx + d[0]; val ny = cy + d[1]
                if (nx < x0 || ny < y0 || nx >= x0 + w || ny >= y0 + h) continue
                val ni = (ny - y0) * w + (nx - x0)
                if (prev[ni] != -1 || banned[ni]) continue
                val fl = f(nx, ny)
                if (fl == -1) continue
                var ok = fl and d[2] == 0
                if (ok && d[0] != 0 && d[1] != 0) ok = f(nx, cy) and dirs[if (d[0] < 0) 1 else 3][2] == 0 && f(cx, ny) and dirs[if (d[1] < 0) 0 else 2][2] == 0
                // a wall with a door/gate in it (orthogonal steps only; solid objects stay blocked)
                var opened = false
                if (!ok && (d[0] == 0 || d[1] == 0) && fl and 0x100 == 0 && fl and 0x200000 == 0) {
                    val side = if (d[0] < 0) 0 else if (d[1] > 0) 1 else if (d[0] > 0) 2 else 3 // the edge we cross, seen from the current tile
                    if (doorOn(cx, cy, side) || doorOn(nx, ny, (side + 2) % 4)) { ok = true; opened = true; doorsUsed++ }
                }
                if (!ok) continue
                prev[ni] = cur
                viaDoor[ni] = opened
                queue.add(ni)
            }
        }
        // the exact target may be a solid tile (a booth, a tree): settle for the closest reachable tile within 6
        var end = goal
        if (prev[goal] == -1) {
            var best = Int.MAX_VALUE
            for (i in prev.indices) if (prev[i] != -1) {
                val d = maxOf(Math.abs(x0 + i % w - tx), Math.abs(y0 + i / w - ty))
                if (d < best) { best = d; end = i }
            }
            if (best > 6) return JSONObject().apply { this["ok"] = false; this["error"] = "no route" }
        }
        val tiles = ArrayList<Int>()
        var c = end
        while (c != start) { tiles.add(c); c = prev[c] }
        tiles.reverse()
        // waypoints ~14 tiles apart; a door on the way gets a waypoint on each side, and `opens[i]` names the door
        // to open before walking to waypoint i (null when there's none)
        val way = JSONArray(); val opens = JSONArray(); val doors = JSONArray()
        var last = start
        fun emit(t: Int, door: JSONArray?) { way.add(JSONArray().apply { add(x0 + t % w); add(y0 + t / w) }); opens.add(door); last = t }
        for ((k, t) in tiles.withIndex()) {
            val x = x0 + t % w; val y = y0 + t / w
            val lx = x0 + last % w; val ly = y0 + last / w
            if (viaDoor[t]) {
                val from = if (k == 0) start else tiles[k - 1]
                val fx2 = x0 + from % w; val fy2 = y0 + from / w
                if (from != last) emit(from, null)
                val side = if (x < fx2) 0 else if (y > fy2) 1 else if (x > fx2) 2 else 3
                val d = if (doorOn(x, y, (side + 2) % 4)) JSONArray().apply { add(x); add(y) } else JSONArray().apply { add(fx2); add(fy2) }
                doors.add(d)
                emit(t, d)
            } else if (k == tiles.lastIndex || maxOf(Math.abs(x - lx), Math.abs(y - ly)) >= step) emit(t, null)
        }
        return JSONObject().apply { this["ok"] = true; this["length"] = tiles.size; this["path"] = way; this["opens"] = opens; this["doors"] = doors }
    }

    fun logout(name: String) {
        val p = get(name).player ?: return
        p.details.session.disconnect()
    }

    fun get(name: String): BotData = bots[name.lowercase()] ?: throw BotError("no bot named $name")

    private fun player(name: String): Player {
        val p = get(name).player ?: throw BotError("$name not logged in")
        if (!p.isActive) throw BotError("$name not active")
        return p
    }

    private fun optIndex(options: Array<core.game.interaction.Option?>, op: Any?): Int {
        if (op is Number) return op.toInt()
        val want = (op ?: "").toString()
        val idx = options.indexOfFirst { it != null && it.name.equals(want, true) }
        if (idx == -1) throw BotError("option '$want' not found (have: ${options.filterNotNull().joinToString { it.name }})")
        return idx
    }

    private fun invSlot(p: Player, a: JSONObject, slotKey: String = "slot", itemKey: String = "item"): Int {
        a[slotKey]?.let { return (it as Number).toInt() }
        val want = a[itemKey] ?: throw BotError("need $slotKey or $itemKey")
        for (i in 0 until 28) {
            val it = p.inventory.get(i) ?: continue
            if ((want is Number && it.id == want.toInt()) || (want is String && it.name.equals(want, true))) return i
        }
        throw BotError("item $want not in inventory")
    }

    /** Resolve scenery at x,y (optionally by id/name) to the node the client would see. */
    private fun scenery(p: Player, a: JSONObject): Scenery {
        val x = (a["x"] as Number).toInt(); val y = (a["y"] as Number).toInt()
        val idWant = a["id"]
        val obj = RegionManager.getObject(x, y, p.location.z) ?: throw BotError("no scenery at $x,$y")
        if (idWant is Number && obj.id != idWant.toInt() && obj.getChild(p).id != idWant.toInt()) throw BotError("scenery at $x,$y is ${obj.id}")
        return obj
    }

    fun act(name: String, a: JSONObject): String = onGame {
        val p = player(name)
        p.setAttribute("debug", false)
        val type = a["type"] as String
        when (type) {
            "walk" -> {
                val x = (a["x"] as Number).toInt(); val y = (a["y"] as Number).toInt()
                PacketProcessor.enqueue(Packet.WorldspaceWalk(p, x, y, a["run"] == true))
                "walk to $x,$y"
            }
            "scenery" -> {
                val obj = scenery(p, a)
                val shown = obj.getChild(p)
                val idx = optIndex(shown.interaction.options, a["op"] ?: 0)
                PacketProcessor.enqueue(Packet.SceneryAction(p, idx, obj.id, obj.location.x, obj.location.y))
                "${shown.interaction.options[idx]?.name} ${shown.name}"
            }
            "npc" -> {
                val idx0 = (a["npc"] as Number).toInt()
                val npc = Repository.npcs[idx0] ?: throw BotError("no npc $idx0")
                val shown = npc.getShownNPC(p)
                val idx = optIndex(shown.interaction.options, a["op"] ?: 0)
                PacketProcessor.enqueue(Packet.NpcAction(p, idx, npc.index))
                "${shown.interaction.options[idx]?.name} ${shown.name}"
            }
            "ground" -> {
                val x = (a["x"] as Number).toInt(); val y = (a["y"] as Number).toInt(); val id = (a["id"] as Number).toInt()
                val gi = GroundItemManager.get(id, Location(x, y, p.location.z), p) ?: throw BotError("no ground item $id at $x,$y")
                val idx = optIndex(gi.interaction.options, a["op"] ?: "Take")
                PacketProcessor.enqueue(Packet.GroundItemAction(p, idx, id, x, y))
                "take ${gi.name}"
            }
            "item" -> {
                val slot = invSlot(p, a)
                val item = p.inventory.get(slot) ?: throw BotError("slot $slot empty")
                val idx = optIndex(item.interaction.options, a["op"] ?: 0)
                PacketProcessor.enqueue(Packet.ItemAction(p, idx, item.id, slot, 149, 0))
                "${item.interaction.options[idx]?.name} ${item.name}"
            }
            "useitem" -> {
                val slot = invSlot(p, a)
                val item = p.inventory.get(slot) ?: throw BotError("slot $slot empty")
                when {
                    a.containsKey("onSlot") || a.containsKey("onItem") -> {
                        val s2 = invSlot(p, a, "onSlot", "onItem")
                        val other = p.inventory.get(s2) ?: throw BotError("slot $s2 empty")
                        PacketProcessor.enqueue(Packet.UseWithItem(p, item.id, other.id, slot, s2, 149, 149, 0, 0))
                        "use ${item.name} on ${other.name}"
                    }
                    a.containsKey("npc") -> {
                        val npc = Repository.npcs[(a["npc"] as Number).toInt()] ?: throw BotError("no such npc")
                        PacketProcessor.enqueue(Packet.UseWithNpc(p, item.id, npc.index, 149, slot))
                        "use ${item.name} on ${npc.name}"
                    }
                    else -> {
                        val obj = scenery(p, a)
                        PacketProcessor.enqueue(Packet.UseWithScenery(p, item.id, slot, obj.id, obj.location.x, obj.location.y))
                        "use ${item.name} on ${obj.getChild(p).name}"
                    }
                }
            }
            "spellnpc" -> {
                val npc = Repository.npcs[(a["npc"] as Number).toInt()] ?: throw BotError("no such npc")
                val book = (a["book"] as? Number)?.toInt() ?: 192
                PacketProcessor.enqueue(Packet.ComponentNpcAction(p, book, (a["spell"] as Number).toInt(), npc.index))
                "cast spell ${a["spell"]} on ${npc.name}"
            }
            "button" -> {
                val iface = (a["iface"] as Number).toInt(); val child = (a["child"] as Number).toInt()
                val op = (a["op"] as? Number)?.toInt() ?: 0
                val slot = (a["slot"] as? Number)?.toInt() ?: -1
                PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[op], op, iface, child, slot))
                "button $iface:$child op$op"
            }
            "style" -> {
                // click attack style N (0=accurate/attack, 1=aggressive/strength, last=defensive) on the weapon tab
                val w = p.getExtension<core.game.node.entity.combat.equipment.WeaponInterface>(core.game.node.entity.combat.equipment.WeaponInterface::class.java)
                    ?: throw BotError("no weapon interface")
                val wi = w.weaponInterface
                val n = minOf((a["n"] as Number).toInt(), wi.attackStyles.size - 1)
                val child = if (wi == core.game.node.entity.combat.equipment.WeaponInterface.WeaponInterfaces.STAFF) n + 1 else n + 2
                PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[0], 0, wi.interfaceId, child, -1))
                "style $n (${wi.name} ${wi.attackStyles[n].style})"
            }
            "continue" -> {
                val iface = p.interfaceManager.chatbox?.id ?: throw BotError("no dialog open")
                val child = (a["child"] as? Number)?.toInt() ?: continueChild(iface)
                PacketProcessor.enqueue(Packet.ContinueOption(p, iface, child, -1, 0))
                "continue $iface:$child"
            }
            "choose" -> {
                val iface = p.interfaceManager.chatbox?.id ?: throw BotError("no dialog open")
                val opts = dialogOptions(name, iface)
                val want = a["option"]
                val hit = if (want is Number) opts.getOrNull(want.toInt() - 1) else opts.firstOrNull { it.second.contains(want.toString(), true) }
                hit ?: throw BotError("option $want not found (have: ${opts.joinToString { it.second }})")
                PacketProcessor.enqueue(Packet.ContinueOption(p, iface, hit.first, -1, 0))
                "choose '${hit.second}'"
            }
            "input" -> {
                val v = a["value"]
                PacketProcessor.enqueue(Packet.InputPromptResponse(p, if (v is Number) v.toInt() else v.toString()))
                "input $v"
            }
            "close" -> { PacketProcessor.enqueue(Packet.CloseIface(p)); "close" }
            "buy", "sell" -> {
                // shop must be open. amount 1/5/10. buy uses the shop stock slot, sell the inventory slot.
                val shop = p.getAttribute<core.game.shops.Shop?>("shop", null) ?: throw BotError("no shop open")
                val amt = (a["amount"] as? Number)?.toInt() ?: 1
                val op = when { amt >= 10 -> 3; amt >= 5 -> 2; else -> 1 }
                if (type == "buy") {
                    val cont = p.getAttribute<core.game.container.Container?>("shop-cont", null) ?: throw BotError("no shop stock")
                    val want = a["item"].toString()
                    val slot = (0 until cont.capacity()).firstOrNull { cont.get(it)?.name.equals(want, true) } ?: throw BotError("shop doesn't sell $want")
                    PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[op], op, 620, 23, slot))
                    "buy $amt $want"
                } else {
                    val slot = invSlot(p, a)
                    PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[op], op, 621, 0, slot))
                    "sell $amt ${p.inventory.get(slot)?.name}"
                }
            }
            "deposit" -> {
                if (p.interfaceManager.opened?.id != 762) throw BotError("bank not open")
                val slot = invSlot(p, a)
                val opc = when ((a["amount"] as? Number)?.toInt()) { 1 -> 155; 5 -> 196; 10 -> 124; else -> 168 } // JSON numbers arrive as Long: compare as Int (else everything was "all")
                PacketProcessor.enqueue(Packet.IfAction(p, opc, IF_OPCODES.indexOf(opc), 763, 0, slot))
                "deposit ${p.inventory.get(slot)?.name}"
            }
            "withdraw" -> {
                if (p.interfaceManager.opened?.id != 762) throw BotError("bank not open")
                val want = a["item"].toString()
                val slot = (0 until p.bank.capacity()).firstOrNull { p.bank.get(it)?.name.equals(want, true) } ?: throw BotError("$want not in bank")
                // noted withdrawals (bank "note" mode): a whole stack takes one bag slot, for trading and selling
                p.bank.isNoteItems = a["noted"] == true
                val opc = when ((a["amount"] as? Number)?.toInt()) { 1 -> 155; 5 -> 196; 10 -> 124; else -> 168 } // JSON numbers arrive as Long: compare as Int (else everything was "all")
                PacketProcessor.enqueue(Packet.IfAction(p, opc, IF_OPCODES.indexOf(opc), 762, 73, slot))
                "withdraw $want"
            }
            "skillmenu" -> {
                // "make X" skill menus (fletching, cooking, smelting...): pick option `index` (0-based), as many as possible
                val plugin = p.dialogueInterpreter.dialogue as? core.game.dialogue.SkillDialoguePlugin ?: throw BotError("no skill menu open")
                val f = core.game.dialogue.SkillDialoguePlugin::class.java.getDeclaredField("handler"); f.isAccessible = true
                val handler = f.get(plugin) as core.game.dialogue.SkillDialogueHandler
                val type = handler.type ?: throw BotError("skill menu has no type")
                val want = (a["index"] as? Number)?.toInt() ?: 0
                var best = -1; var bestAmt = Int.MIN_VALUE
                for (b in 0..60) {
                    val idx = try { type.getIndex(handler, b) } catch (e: Exception) { continue }
                    val amt = try { type.getAmount(handler, b) } catch (e: Exception) { continue }
                    if (idx == want && amt > bestAmt) { best = b; bestAmt = amt }
                }
                if (best == -1) throw BotError("option $want not in menu")
                PacketProcessor.enqueue(Packet.ContinueOption(p, type.interfaceId, best + 1, -1, 0)) // interpreter passes child-1 to the plugin
                if (bestAmt < 0) PacketProcessor.enqueue(Packet.InputPromptResponse(p, 28))
                "skill menu option $want x${if (bestAmt < 0) 28 else bestAmt}"
            }
            "rescue" -> {
                // operator fix: pull a bot out of a random-event area it was kidnapped into (bots are exempt from new ones)
                core.game.system.timer.impl.AntiMacro.terminateEventNpc(p)
                content.global.ame.returnPlayer(p)
                "rescued to ${p.getAttribute("/save:original-loc", ServerConstants.HOME_LOCATION)}"
            }
            "dm" -> {
                // private message, the way a player does it: add them as a friend, then message
                val to = a["to"].toString().lowercase()
                val text = a["text"].toString().take(80)
                PacketProcessor.enqueue(Packet.AddFriend(p, to))
                PacketProcessor.enqueue(Packet.PrivateMessage(p, to, text))
                "dm $to: $text"
            }
            "geitem" -> {
                // Grand Exchange buy screen: pick the item to buy (what the client's item search sends), after clicking a buy slot
                val want = a["item"]
                val id = if (want is Number) want.toInt() else core.cache.def.impl.ItemDefinition.getDefinitions().values
                    .filter { it.name.equals(want.toString(), true) && it.isUnnoted && core.game.ge.PriceIndex.canTrade(it.id) }
                    .minByOrNull { it.id }?.id ?: throw BotError("no GE-tradeable item named $want")
                PacketProcessor.enqueue(Packet.GESetOfferItem(p, id))
                "ge item $id"
            }
            "forceevent" -> {
                // testing: spawn a specific random event on this bot
                val ev = content.global.ame.RandomEvents.valueOf(a["event"].toString().uppercase())
                core.game.system.timer.impl.AntiMacro.forceEvent(p, ev)
                "forced ${ev.name}"
            }
            "player" -> {
                // e.g. {"type":"player","name":"claudebot2","op":"Trade with"}
                val other = Repository.getPlayerByName(a["name"].toString()) ?: throw BotError("${a["name"]} not online")
                val idx = optIndex(other.interaction.options, a["op"] ?: "Trade with")
                PacketProcessor.enqueue(Packet.PlayerAction(p, idx, other.index))
                "${other.interaction.options[idx]?.name} ${other.username}"
            }
            "tradeoffer" -> {
                val slot = invSlot(p, a)
                val item = p.inventory.get(slot) ?: throw BotError("slot $slot empty")
                // op0 = offer 1, op1 = 5, op2 = 10, op3 = all
                val op = when (val amt = a["amount"]) { "all" -> 3; is Number -> when { amt.toInt() >= 10 -> 2; amt.toInt() >= 5 -> 1; else -> 0 }; else -> 0 }
                PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[op], op, 336, 0, slot))
                "offer ${item.name}"
            }
            "tradeaccept" -> {
                val m = core.game.node.entity.player.link.request.trade.TradeModule.getExtension(p) ?: throw BotError("not trading")
                if (m.stage == 0) PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[0], 0, 335, 16, -1))
                else PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[0], 0, 334, 20, -1))
                "accept trade (stage ${m.stage})"
            }
            "tradedecline" -> {
                val m = core.game.node.entity.player.link.request.trade.TradeModule.getExtension(p) ?: throw BotError("not trading")
                if (m.stage == 0) PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[0], 0, 335, 18, -1))
                else PacketProcessor.enqueue(Packet.IfAction(p, IF_OPCODES[0], 0, 334, 21, -1))
                "decline trade"
            }
            "say" -> { PacketProcessor.enqueue(Packet.ChatMessage(p, 0, a["text"].toString().take(80))); "say ${a["text"]}" }
            else -> throw BotError("unknown action type $type")
        }
    }

    // Chat-box "click here to continue" child for the common dialogue interfaces.
    private fun continueChild(iface: Int): Int = when (iface) {
        in 241..244 -> iface - 236   // npc chat 1-4 lines
        in 64..67 -> iface - 59      // player chat 1-4 lines
        in 210..214 -> iface - 207   // plain message 1-5 lines
        519 -> 3
        else -> 2
    }

    private fun dialogOptions(name: String, iface: Int): List<Pair<Int, String>> {
        if (iface !in listOf(228, 230, 232, 234)) return emptyList()
        val n = (iface - 224) / 2
        val strs = synchronized(get(name)) { get(name).strings[iface]?.toMap() ?: emptyMap() }
        return (0 until n).map { Pair(it + 2, strip(strs[it + 2] ?: "")) }
    }

    private fun strip(s: String) = s.replace(Regex("<[^>]*>"), "")

    fun state(name: String, radius: Int, since: Int): JSONObject = onGame {
        val bot = get(name)
        val p = bot.player
        val o = JSONObject()
        o["name"] = bot.name
        o["online"] = p != null && p.isActive
        if (p == null || !p.isActive) return@onGame o
        val loc = p.location
        o["x"] = loc.x; o["y"] = loc.y; o["z"] = loc.z
        o["tick"] = GameWorld.ticks
        o["combat"] = p.properties.currentCombatLevel
        o["hp"] = p.skills.lifepoints
        o["maxHp"] = p.skills.maximumLifepoints
        o["runEnergy"] = p.settings.runEnergy.toInt()
        o["moving"] = p.walkingQueue.isMoving
        o["busy"] = p.pulseManager.hasPulseRunning()
        o["inCombat"] = p.inCombat()
        o["attacking"] = p.properties.combatPulse.isAttacking
        o["locked"] = p.locks.isInteractionLocked || p.locks.isMovementLocked
        val stats = JSONObject()
        var total = 0
        for (i in 0 until Skills.NUM_SKILLS) {
            val s = JSONObject()
            s["level"] = p.skills.getStaticLevel(i)
            s["cur"] = p.skills.getLevel(i)
            s["xp"] = p.skills.getExperience(i).toInt()
            stats[Skills.SKILL_NAME[i].lowercase()] = s
            total += p.skills.getStaticLevel(i)
        }
        o["stats"] = stats
        o["totalLevel"] = total
        fun items(c: core.game.container.Container): JSONArray {
            val arr = JSONArray()
            for (i in 0 until c.capacity()) {
                val it = c.get(i) ?: continue
                val j = JSONObject()
                j["slot"] = i; j["id"] = it.id; j["name"] = it.name; j["count"] = it.amount
                if (!it.definition.isUnnoted) j["noted"] = true
                j["value"] = if (it.id == 995) 1 else it.definition.value
                j["ops"] = JSONArray().apply { it.interaction.options.filterNotNull().forEach { op -> add(op.name) } }
                arr.add(j)
            }
            return arr
        }
        o["inv"] = items(p.inventory)
        o["invFree"] = p.inventory.freeSlots()
        o["worn"] = items(p.equipment)
        o["bankCount"] = p.bank.itemCount()
        // quests: points, and the stage of every quest started (100 = done)
        val qr = p.questRepository
        o["questPoints"] = qr.points
        o["quests"] = JSONObject().apply {
            for (q in core.game.node.entity.player.link.quest.QuestRepository.getQuests().keys) { val st = qr.getStage(q); if (st > 0) this[q.questName] = st }
        }
        // Grand Exchange: the bot's offer slots, and the offer being set up while the GE screen is open
        val geRecs = core.game.ge.GrandExchangeRecords.getInstance(p)
        val ge = JSONArray()
        for (i in 0 until 6) {
            val off = geRecs.getOffer(i) ?: continue
            ge.add(JSONObject().apply {
                this["slot"] = i; this["id"] = off.itemID; this["name"] = core.cache.def.impl.ItemDefinition.forId(off.itemID).name
                this["sell"] = off.sell; this["amount"] = off.amount; this["done"] = off.completedAmount; this["price"] = off.offeredValue
                this["state"] = off.offerState.name; this["coins"] = off.totalCoinExchange
                this["collect"] = JSONArray().apply { off.withdraw.forEachIndexed { wi, w -> if (w != null) add(JSONObject().apply { this["box"] = wi; this["id"] = w.id; this["name"] = w.name; this["count"] = w.amount }) } }
            })
        }
        if (ge.isNotEmpty()) o["ge"] = ge
        if (p.interfaceManager.opened?.id == 105) {
            val t = p.getAttribute<core.game.ge.GrandExchangeOffer?>("ge-temp", null)
            o["geScreen"] = JSONObject().apply {
                this["slot"] = p.getAttribute("ge-index", -1)
                if (t != null && t.itemID > 0) { this["id"] = t.itemID; this["name"] = core.cache.def.impl.ItemDefinition.forId(t.itemID).name; this["sell"] = t.sell; this["amount"] = t.amount; this["price"] = t.offeredValue; this["guide"] = core.game.ge.GrandExchange.getRecommendedPrice(t.itemID) }
            }
        }
        o["coins"] = p.inventory.getAmount(995)
        val re = core.game.system.timer.impl.AntiMacro.getEventNpc(p)
        if (re != null && re.isActive) {
            val type = content.global.ame.RandomEvents.values().firstOrNull { it.npc::class == re::class }?.name ?: "UNKNOWN" // by class: hostile events transform to a combat-level id
            o["randomEvent"] = JSONObject().apply { this["type"] = type; this["npc"] = re.index; this["name"] = re.name; this["x"] = re.location.x; this["y"] = re.location.y; this["ticksLeft"] = re.ticksLeft }
        }
        // kidnapped into a random event area: the game keeps the bot's original location until it returns it
        if (p.getAttribute<Any?>("kidnapped-by-random", null) != null || p.getAttribute<Any?>("/save:original-loc", null) != null) o["kidnapped"] = true
        o["bank"] = items(p.bank)
        val shop = p.getAttribute<core.game.shops.Shop?>("shop", null)
        val shopCont = p.getAttribute<core.game.container.Container?>("shop-cont", null)
        if (shop != null && shopCont != null && p.interfaceManager.opened?.id == 620) {
            o["shop"] = JSONObject().apply {
                this["title"] = shop.title
                this["items"] = JSONArray().apply {
                    for (i in 0 until shopCont.capacity()) { val it = shopCont.get(i) ?: continue
                        val price = try { shop.getBuyPrice(p, i).amount } catch (e: Exception) { -1 }
                        add(JSONObject().apply { this["slot"] = i; this["name"] = it.name; this["count"] = it.amount; this["price"] = price }) }
                }
            }
        }
        val tm = core.game.node.entity.player.link.request.trade.TradeModule.getExtension(p)
        if (tm != null && tm.target != null) {
            val other = core.game.node.entity.player.link.request.trade.TradeModule.getExtension(tm.target)
            fun offer(c: core.game.container.Container?): JSONArray = JSONArray().apply {
                if (c != null) for (i in 0 until c.capacity()) { val it = c.get(i) ?: continue
                    add(JSONObject().apply { this["name"] = it.name; this["id"] = it.id; this["count"] = it.amount; this["value"] = if (it.id == 995) 1 else it.definition.value }) }
            }
            o["trade"] = JSONObject().apply {
                this["with"] = tm.target!!.username
                this["stage"] = tm.stage
                this["mine"] = offer(tm.container)
                this["theirs"] = offer(other?.container)
                this["myAccepted"] = tm.isAccepted
                this["theirAccepted"] = other?.isAccepted ?: false
            }
        }
        // interfaces / dialog
        val chat = p.interfaceManager.chatbox?.id
        o["iface"] = p.interfaceManager.opened?.id
        // duels: the session's fight state (0 waiting, 1 fighting, 2 over) and the zones we're in, to see why "Fight" does nothing
        runCatching {
            val ds = p.getExtension<content.minigame.duel.DuelSession>(content.minigame.duel.DuelSession::class.java)
            if (ds != null) o["duel"] = JSONObject().apply { this["fightState"] = ds.fightState; this["opponent"] = ds.getOpposite(p)?.username }
            o["zones"] = JSONArray().apply { p.zoneMonitor.zones.forEach { add(it.zone.name) } }
        }
        // text on the open main interface (child -> text), e.g. the Certer's three answers
        p.interfaceManager.opened?.id?.let { oid -> val t = synchronized(bot) { bot.strings[oid]?.toMap() }; if (!t.isNullOrEmpty()) o["ifaceText"] = JSONObject().apply { t.forEach { (k, v) -> this[k.toString()] = strip(v) } } }
        o["chatbox"] = chat
        if (chat != null && chat != 137) {
            val d = JSONObject()
            val strs = synchronized(bot) { bot.strings[chat]?.toMap() ?: emptyMap() }
            d["iface"] = chat
            d["text"] = JSONArray().apply { strs.toSortedMap().values.map { strip(it) }.filter { it.isNotBlank() }.forEach { add(it) } }
            d["options"] = JSONArray().apply { dialogOptions(name, chat).forEach { add(it.second) } }
            val sk = p.dialogueInterpreter.dialogue as? core.game.dialogue.SkillDialoguePlugin
            if (sk != null) {
                val f = core.game.dialogue.SkillDialoguePlugin::class.java.getDeclaredField("handler"); f.isAccessible = true
                val h = f.get(sk) as core.game.dialogue.SkillDialogueHandler
                d["skillMenu"] = JSONArray().apply { h.items.forEach { add(it.name) } }
            }
            o["dialog"] = d
        }
        // messages
        synchronized(bot) {
            o["messages"] = JSONArray().apply { bot.messages.filter { it.first > since }.forEach { add(JSONObject().apply { this["id"] = it.first; this["text"] = strip(it.second) }) } }
            o["pms"] = JSONArray().apply { bot.pms.filter { it.first > since }.forEach { add(JSONObject().apply { this["id"] = it.first; this["from"] = it.second; this["text"] = strip(it.third) }) } }
        }
        // nearby
        val npcs = JSONArray()
        for (n in RegionManager.getLocalNPCs(loc, radius).sortedBy { it.location.getDistance(loc) }.take(30)) {
            val shown = n.getShownNPC(p)
            if (!n.isActive || n.isInvisible) continue
            val j = JSONObject()
            j["npc"] = n.index; j["id"] = shown.id; j["name"] = shown.name
            j["x"] = n.location.x; j["y"] = n.location.y
            j["dist"] = n.location.getDistance(loc).toInt()
            j["level"] = shown.definition.combatLevel
            j["inCombat"] = n.inCombat()
            (n.properties.combatPulse.getVictim() as? Player)?.let { j["target"] = it.username } // who it is attacking (escorts guard their ward)
            j["ops"] = JSONArray().apply { shown.interaction.options.filterNotNull().forEach { add(it.name) } }
            npcs.add(j)
        }
        val scen = ArrayList<JSONObject>()
        // every object on each tile (a lit fire sits on top of whatever was there); objects with no options are kept
        // when they're things you use items on (fires, ranges, anvils, hoppers...), since those are what tasks need
        val useTargets = Regex("fire|range|anvil|hopper|furnace|altar|ruins|well|fountain|sink|spinning|loom|pottery|oven|churn|stove", RegexOption.IGNORE_CASE)
        for (dx in -radius..radius) for (dy in -radius..radius) {
            val tl = Location(loc.x + dx, loc.y + dy, loc.z)
            val here = RegionManager.getRegionChunk(tl).objects?.getOrNull(tl.chunkOffsetX)?.getOrNull(tl.chunkOffsetY) ?: continue
            for (obj in here) {
            if (obj == null || !obj.isRenderable) continue
            val shown = obj.getChild(p) ?: continue
            val ops = shown.interaction.options.filterNotNull().map { it.name }.filter { it.isNotBlank() && !it.equals("Examine", true) }
            if (shown.name == "null" || (ops.isEmpty() && !useTargets.containsMatchIn(shown.name))) continue
            val j = JSONObject()
            j["id"] = obj.id; j["name"] = shown.name; j["x"] = obj.location.x; j["y"] = obj.location.y
            j["dist"] = obj.location.getDistance(loc).toInt()
            j["ops"] = JSONArray().apply { addAll(ops) }
            scen.add(j)
            }
        }
        val ground = JSONArray()
        for (g in GroundItemManager.getItems()) {
            if (!g.isActive || g.location.z != loc.z || !g.location.withinDistance(loc, radius)) continue
            if (g.isPrivate && !g.droppedBy(p)) continue
            val j = JSONObject()
            j["id"] = g.id; j["name"] = g.name; j["count"] = g.amount; j["x"] = g.location.x; j["y"] = g.location.y
            j["dist"] = g.location.getDistance(loc).toInt()
            ground.add(j)
        }
        val players = JSONArray()
        for (o2 in RegionManager.getLocalPlayers(loc, radius)) if (o2 !== p) players.add(JSONObject().apply { this["name"] = o2.username; this["x"] = o2.location.x; this["y"] = o2.location.y })
        o["npcs"] = npcs
        o["scenery"] = JSONArray().apply { scen.sortedBy { it["dist"] as Int }.take(60).forEach { add(it) } }
        o["ground"] = ground
        o["players"] = players
        o
    }

    fun startHttp() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 8899), 0)
        server.executor = java.util.concurrent.Executors.newFixedThreadPool(8)
        server.createContext("/") { ex ->
            var code = 200
            val out: Any = try {
                val parts = ex.requestURI.path.split("/").filter { it.isNotEmpty() }
                val q = (ex.requestURI.query ?: "").split("&").filter { it.contains("=") }.associate { it.substringBefore("=") to it.substringAfter("=") }
                val body = ex.requestBody.readBytes().toString(Charsets.UTF_8)
                when {
                    parts == listOf("events") -> {
                        if (ex.requestMethod == "POST") {
                            val arr = JSONParser().parse(body) as JSONArray
                            allowedEvents.clear(); arr.forEach { allowedEvents.add(it.toString().uppercase()) }
                        }
                        JSONObject().apply {
                            this["enabled"] = JSONArray().apply { addAll(allowedEvents.sorted()) }
                            this["all"] = JSONArray().apply { content.global.ame.RandomEvents.values().forEach { add(it.name) } }
                        }
                    }
                    // long-distance route planning over the real collision map: /route?from=x,y&to=x,y[&z=0][&avoid=x,y,r;x,y,r]
                    parts == listOf("route") -> {
                        fun xy(v: String?) = (v ?: throw BotError("need from= and to=")).split(",").map { it.trim().toInt() }
                        val (fx, fy) = xy(q["from"]); val (tx, ty) = xy(q["to"])
                        val z = q["z"]?.toInt() ?: 0
                        val avoid = (q["avoid"] ?: "").split(";").filter { it.isNotBlank() }.map { it.split(",").map { n -> n.trim().toInt() } }
                        val solid = (q["solid"] ?: "").split(",").mapNotNull { it.trim().toIntOrNull() }.toSet() // object ids that look like doors but never open
                        val step = (q["step"]?.toIntOrNull() ?: 14).coerceIn(1, 30) // waypoint spacing (short in mazes)
                        onGame { planRoute(fx, fy, tx, ty, z, avoid, solid, step) }
                    }
                    // what's around a place: /find?name=dairy cow&x=3250&y=3275[&z=0][&r=30] (scenery and NPCs whose name contains `name`)
                    parts == listOf("find") -> {
                        val want = java.net.URLDecoder.decode(q["name"] ?: "", "UTF-8").lowercase()
                        val cx = q["x"]?.toInt() ?: throw BotError("need x"); val cy = q["y"]?.toInt() ?: throw BotError("need y")
                        val z = q["z"]?.toInt() ?: 0; val r = minOf(q["r"]?.toInt() ?: 30, 64)
                        onGame {
                            val sc = JSONArray(); val np = JSONArray()
                            // every object on each tile (walls, wall decorations like signs, ground decoration); with &bot=<name>
                            // varbit-driven objects are resolved to what that bot sees (e.g. which exercise a sign shows)
                            val viewer = q["bot"]?.let { bots[it.lowercase()]?.player }
                            for (x in cx - r..cx + r) for (y in cy - r..cy + r) {
                                val loc = core.game.world.map.Location(x, y, z)
                                val chunk = RegionManager.getRegionChunk(loc)
                                val here = chunk.objects?.getOrNull(loc.chunkOffsetX)?.getOrNull(loc.chunkOffsetY) ?: continue
                                for (obj in here) {
                                    if (obj == null || !obj.isRenderable) continue
                                    val shown = if (viewer != null) obj.getChild(viewer) else obj
                                    if (!shown.name.lowercase().contains(want) && !obj.name.lowercase().contains(want)) continue
                                    sc.add(JSONObject().apply { this["name"] = shown.name; this["id"] = obj.id; this["shownId"] = shown.id; this["type"] = obj.type
                                        this["variant"] = obj.definition.childrenIds?.indexOf(shown.id) ?: -1 // which picture a varbit-driven object shows (-1: not one)
                                        this["x"] = x; this["y"] = y; this["ops"] = JSONArray().apply { shown.definition.options?.filterNotNull()?.forEach { add(it) } } })
                                }
                            }
                            for (n in Repository.npcs) {
                                if (n == null || !n.isActive || n.location.z != z || maxOf(Math.abs(n.location.x - cx), Math.abs(n.location.y - cy)) > r) continue
                                if (!n.name.lowercase().contains(want)) continue
                                np.add(JSONObject().apply { this["name"] = n.name; this["npc"] = n.index; this["x"] = n.location.x; this["y"] = n.location.y })
                            }
                            JSONObject().apply { this["scenery"] = sc; this["npcs"] = np }
                        }
                    }
                    parts == listOf("bots") -> JSONArray().apply {
                        bots.values.forEach { b -> add(JSONObject().apply { this["name"] = b.name; this["online"] = b.player?.isActive == true }) }
                    }
                    parts.size >= 2 && parts[0] == "bot" -> {
                        val name = java.net.URLDecoder.decode(parts[1], "UTF-8")
                        when (parts.getOrNull(2) ?: "state") {
                            "login" -> JSONObject().apply { this["ok"] = true; this["name"] = onGame { login(name) } }
                            "logout" -> { onGame { logout(name) }; JSONObject().apply { this["ok"] = true } }
                            "state" -> state(name, q["r"]?.toIntOrNull() ?: 15, q["since"]?.toIntOrNull() ?: 0)
                            "act" -> {
                                val parsed = JSONParser().parse(body)
                                val acts = if (parsed is JSONArray) parsed.map { it as JSONObject } else listOf(parsed as JSONObject)
                                JSONObject().apply { this["ok"] = true; this["results"] = JSONArray().apply { acts.forEach { add(act(name, it)) } } }
                            }
                            else -> { code = 404; JSONObject().apply { this["error"] = "not found" } }
                        }
                    }
                    else -> { code = 404; JSONObject().apply { this["error"] = "not found" } }
                }
            } catch (e: Throwable) {
                val cause = (e as? java.util.concurrent.ExecutionException)?.cause ?: e
                code = if (cause is BotError) 400 else 500
                if (code == 500) cause.printStackTrace()
                JSONObject().apply { this["error"] = cause.message ?: cause.toString() }
            }
            val bytes = (if (out is JSONObject) out.toJSONString() else (out as JSONArray).toJSONString()).toByteArray()
            ex.responseHeaders.add("Content-Type", "application/json")
            ex.sendResponseHeaders(code, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
        println("[BotApi] control API on http://127.0.0.1:8899")
    }
}

class BotApiPlugin : StartupListener, TickListener {
    override fun startup() {
        BotRegistry.startHttp()
    }

    override fun tick() {
        BotRegistry.runJobs()
    }
}
