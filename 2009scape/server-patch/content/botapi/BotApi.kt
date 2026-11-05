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
    private val jobs = ConcurrentLinkedQueue<() -> Unit>()
    private val IF_OPCODES = intArrayOf(155, 196, 124, 199, 234, 168, 166, 64, 53, 9)

    fun isBot(p: Player?): Boolean = p != null && bots[p.username.lowercase()]?.player === p

    @JvmStatic fun onMessage(p: Player, msg: String) {
        bots[p.username.lowercase()]?.let { if (it.player === p) it.addMessage(msg) }
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
                val opc = when (val amt = a["amount"]) { 1 -> 155; 5 -> 196; 10 -> 124; else -> 168 }
                PacketProcessor.enqueue(Packet.IfAction(p, opc, IF_OPCODES.indexOf(opc), 763, 0, slot))
                "deposit ${p.inventory.get(slot)?.name}"
            }
            "withdraw" -> {
                if (p.interfaceManager.opened?.id != 762) throw BotError("bank not open")
                val want = a["item"].toString()
                val slot = (0 until p.bank.capacity()).firstOrNull { p.bank.get(it)?.name.equals(want, true) } ?: throw BotError("$want not in bank")
                val opc = when (val amt = a["amount"]) { 1 -> 155; 5 -> 196; 10 -> 124; else -> 168 }
                PacketProcessor.enqueue(Packet.IfAction(p, opc, IF_OPCODES.indexOf(opc), 762, 73, slot))
                "withdraw $want"
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
        o["coins"] = p.inventory.getAmount(995)
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
        o["chatbox"] = chat
        if (chat != null && chat != 137) {
            val d = JSONObject()
            val strs = synchronized(bot) { bot.strings[chat]?.toMap() ?: emptyMap() }
            d["iface"] = chat
            d["text"] = JSONArray().apply { strs.toSortedMap().values.map { strip(it) }.filter { it.isNotBlank() }.forEach { add(it) } }
            d["options"] = JSONArray().apply { dialogOptions(name, chat).forEach { add(it.second) } }
            o["dialog"] = d
        }
        // messages
        synchronized(bot) {
            o["messages"] = JSONArray().apply { bot.messages.filter { it.first > since }.forEach { add(JSONObject().apply { this["id"] = it.first; this["text"] = strip(it.second) }) } }
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
            j["ops"] = JSONArray().apply { shown.interaction.options.filterNotNull().forEach { add(it.name) } }
            npcs.add(j)
        }
        val scen = ArrayList<JSONObject>()
        for (dx in -radius..radius) for (dy in -radius..radius) {
            val obj = RegionManager.getObject(loc.x + dx, loc.y + dy, loc.z) ?: continue
            val shown = obj.getChild(p) ?: continue
            val ops = shown.interaction.options.filterNotNull().map { it.name }.filter { it.isNotBlank() && !it.equals("Examine", true) }
            if (ops.isEmpty() || shown.name == "null") continue
            val j = JSONObject()
            j["id"] = obj.id; j["name"] = shown.name; j["x"] = obj.location.x; j["y"] = obj.location.y
            j["dist"] = obj.location.getDistance(loc).toInt()
            j["ops"] = JSONArray().apply { addAll(ops) }
            scen.add(j)
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
