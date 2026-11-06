# Handoff: where the project stands

For a new Claude Code session picking this up. Read this first, then `ROADMAP.md` and `README.md`.

## What this is
Bots playing a private **2009Scape** server (RuneScape ~Jan 2009). The game server isn't in this repo:
`2009scape/setup.sh` clones it from GitLab and applies our patch. All bots start as fresh level-1
characters and progress through normal gameplay (real client packets through the server's own
packet processor; no admin rights). **The bots will be reset to scratch once systems are developed**,
so forcing test scenarios (editing trust/IOU/team files, forcing events) is fine.

## Rebuilding the environment (cloud containers are temporary)
Last session's container had everything under `/home/user`; a new one starts empty.
1. Use the `rune-tests` cloud environment (allows `cdn.2009scape.org`; package registries allowed).
2. JDK 11: `apt-get install -y openjdk-11-jdk-headless` (adoptium.net is blocked). Build/run the server with JDK 11.
3. Node: the container's preinstalled Node 22 is enough (the bots use `fetch` and ESM); Node 24 from nodejs.org also works.
4. `cd 2009scape && JAVA11_HOME=/usr/lib/jvm/java-11-openjdk-amd64 ./setup.sh` (clones to `../../2009scape-server`, `git lfs pull` for the cache, applies `server-patch/`, builds with Maven).
   Maven Central rate-limits the proxy's IP (429s get saved as broken `.pom` files, and a dropped connection can hang the build). Fix: a mirror in `~/.m2/settings.xml` pointing `central,maven_central` at `https://maven-central.storage-download.googleapis.com/maven2/`, delete files containing "exceeded rate limits" from `~/.m2`, then `sh mvnw -B package -DskipTests -Dmaven.wagon.rto=60000` in `Server/`. Rebuilds after editing `BotApi.kt`: copy it into the server tree and `sh mvnw -o -q -B package -DskipTests` (~25 s), then `./restart.sh`.
   Then `./restart.sh` (server; waits for "started in"), then `bots/start-bots.sh` (10 scripted + 50 Claude-directed bots).
   Or all in one: `JAVA11_HOME=/usr/lib/jvm/java-11-openjdk-amd64 node launch.mjs` (cross-platform launcher; Ctrl+C / SIGINT stops server and bots).
5. Optional viewer: `rt4-client` from GitLab (`./gradlew :client:build`; Maven Central may rate-limit, just retry), run with **Java 21** under `Xvfb :99` (JDK 11 here is headless), `xdotool` for input, `viewer/snap.sh <bot>` screenshots. The spectator account must skip the tutorial via Skippy, then admin `::tele x y z` works.

## Layout
- `2009scape/server-patch/content/botapi/BotApi.kt`: HTTP bot API on `127.0.0.1:8899` (login/logout/state/act, `/events`, `/bots`, `/route`, `/find`). Actions: walk, scenery, npc, ground, item, useitem, spellnpc, button, style, continue, choose, skillmenu, input, close, say, dm, player, tradeoffer/accept/decline, buy/sell, deposit/withdraw, geitem, rescue, forceevent. State includes `randomEvent`, `ge` (offer slots), `geScreen` (offer being set up), `quests` (stage per started quest, 100 = done), `questPoints`, and `ifaceText` (text on the open interface). `GET /find?name=&x=&y=&z=&r=` lists scenery/NPCs by name around a point. `GET /route?from=x,y&to=x,y&avoid=x,y,r;...` plans a walk over the real collision map (BFS, doors/gates passable) and returns waypoints.
- `server-patch/core-changes.patch`: PacketRepository (capture game messages, interface text, PMs for bots), AntiMacro (random events gated per type for API bots), `default.conf` (built-in bots off).
- `2009scape/bots/`:
  - `lib.mjs`: Bot client (walking with door/gate handling, `travel()` for long trips on a planned route around `DANGER` zones, dialogs, onboarding via Skippy, shops, Lumbridge bank via castle stairs, Grand Exchange `geOpen/geOffer/geCollect/geAbort`, random events wave 1 incl. XP lamps, `RANDOM_EVENTS` enabled on every login).
  - `tasks.mjs`: skill tasks (woodcut_fire, fish_cook, mine, melee, ranged, magic, thieving, fletch, resupply, treasury).
  - `scripted.mjs`: 10 autonomous bots, task rotation every 50–70 min.
  - `claude_runner.mjs`: 50 Claude-directed bots following `orders/<bot>.json` plans; runs market, council (`POLITICS_MINUTES`), mood drift, market days, diaries.
  - `marketday.mjs`: daily market at the Grand Exchange (`MARKET_EVERY_MINUTES`, `MARKET_MINUTES`, `MARKET_LEAD_MINUTES`): travel, shouted offers, haggling, GE offers, trip home.
  - `quests.mjs` (quest scripts: Cook's Assistant, Rune Mysteries; per-item gatherers) and `party.mjs` (quest parties: roles, pooled containers, gather for all, hand out through the trade window, everyone hands in; formed by the runner every 5 min, `PARTY_MAX` at once).
  - `diary.mjs` (`bots/diaries/<bot>.md`, milestones in `diaries/.marks.json`) and `recap.mjs` (news-style recap of the last day to `bots/recaps/<date>.md`).
  - `market.mjs`: perceived values, deals (sale, gift, favor, repay, debtsale, bounty, wager), trade-window flow, collections, call-outs, debt collection, bounty posting/claiming, DMs.
  - `social.mjs`: personalities + habits, trust, IOUs, rivalries, bounties state, mood, chat lines.
  - `politics.mjs`: dynamic teams (`market/teams.json`), scoreboard, taxes/mutiny, leaving/recruiting, scaling caps (`capFor`).
  - `status.mjs`, `social_report.mjs`, `export_dashboard.mjs` (dashboard snapshot JSON), `test_task.mjs`.
  - In-game tests with staged setups (`setup` edits saves while bots are logged out, then `run`): `test_events.mjs` (random events), `test_social.mjs` (collector, hounding, repayment, wager, collection, call-out, death mood), `test_ge.mjs` (GE buy/sell/collect), `test_marketday.mjs` (compressed market day), `test_party.mjs` (3-bot Cook's Assistant party).
- Runtime state (not in git): `bots/market/*.json(l)` (incl. `marketday.json`), `bots/logs/`, `bots/diaries/`, `bots/recaps/`, server saves in `Server/data/players/`.

## Status
**Done and seen working in-game:** shops, banking, fletching, trading at perceived values, team gifts and treasurer pooling, favors/IOUs, bounties, grudges, mutiny, leaving, recruitment, DMs, habits/collectors/gamblers, and (via `test_social.mjs`) debt-collector purchase, hounding, repayment to the collector, wagers, collection completion, call-outs with bystander trust drops, and mood after a death.

**Random events wave 1: done and enabled for bots.** Genie (XP lamp rubbed), Drunken Dwarf, Rick Turpentine, Strange Plant, and the seven hostile events (fight while healthy, flee when hurt) all resolved in-game on a level-3 bot. The earlier failure was the AntiMacro gate also blocking *forced* events while the enabled list was empty. `RANDOM_EVENTS` in lib.mjs is posted to `/events` on every login, so it survives server restarts.

**Phase 4.1 market days: built and checked** (`test_marketday.mjs`, compressed): 6 level-3 bots travelled Lumbridge→GE→home on the planned safe route with no damage, shouted offers, haggled 2 knife sales at prices between bid and ask (through the normal trade window), posted 7 GE offers, and went home. In the live runner the first market day opens ~50 min after start, then every 24 h (`MARKET_EVERY_MINUTES`). Not yet seen with the full 50-bot runner.

**Grand Exchange API: done** (`test_ge.mjs`): offers placed through the GE screen, matched bot-to-bot, collected.

**Phase 4.2 quest parties: done.** Cook's Assistant solo (~10 min) and as a 3-bot party (`test_party.mjs`: 3/3 completed, 1 QP and 300 Cooking xp each, 10 party trades). Rune Mysteries solo (16 min, unlocks Runecrafting). Sheep Shearer (shears from Fred's house, shear his sheep but never "The Thing" (NPC 3579), spin on the castle wheel (interface 459, button 19), deliver in batches as bag space allows). Quest points count in the team score (5 levels each). The Knight's Sword and Druidic Ritual are not scripted yet: both need trips through places that kill level-3 bots (ice warriors under Asgarnia, Taverley dungeon), so they wait until combat is higher.

**Fleet parties:** with the runner left alone, guildbot4+5 and guildbot1+2 each completed Cook's Assistant as parties on their own (17:00, 17:04).

**Fixed (17:xx):** thieving bots kept dying to farmers (a failed pickpocket hits back) with no food; they now eat at half health or rest until healed.

**Live 50-bot market day (12:55):** 31 bots travelled to the GE, shouted and called for wants; no haggled deals because everyone wanted knives/tinderboxes and nobody had spares. Expected with fresh characters.

**New training task `smelt`:** mine copper and tin in pairs at the Lumbridge swamp (rock ids tell the ore: copper 11936-11938, tin 11933-11935; wait for the scarce one to respawn), smelt bronze bars at the Lumbridge furnace (the bar menu is chatbox 311; only "make 1", button 16, works here), bank the bars. Bronze bars are tradeable goods now. **`smith`:** takes the bars from the Lumbridge bank to the Varrock west anvils (planned safe route), smiths bronze daggers (anvil menu 300, button 24 = make 1), banks them at home. Verified: 8 daggers, Smithing 1 -> 2, all banked.

**Fixed:** fish_cook bots fetched firewood from the Draynor trees, next to the dark wizards (most fleet deaths). Every walk over 60 tiles now goes by the danger-avoiding route planner.

**Phase 4.3 diaries/recaps: built** (diary lines verified from the market-day test; `recap.mjs` prints the day's headlines, trade, grudges, milestones, standings).

**Random events wave 2 (partly): done and enabled.** Sandwich Lady (bot remembers the food she names, picks it on interface 297) and Certer (the two wrong captions are always from a fixed decoy list, so the bot picks the other one). Both verified twice in-game. **Wave 3 (partly): done and enabled.** Freaky Forester (pheasant with the asked tail count = NPC id 2459-2462, hand in, portal; 41 s), Drill Demon (the exercise signs are drawn client-side, so the bot tries random mats; wrong ones cost nothing; 1-4 min), Maze (planned route through the maze's real doors, `solid=3626` for the fake walls, `step=4` waypoints, one-way doors avoided after a refusal; ~4 min). Still disabled: Surprise Exam, Mime, Pillory, Quiz Master, Evil Bob, Candlelight. Safety net: rescued after 10 min in a kidnap area (15 for the Drill Demon), keyed on the game's saved original location.

**Phase 5 duels: work in progress (`duel.mjs`, `test_duel.mjs`, not wired into grudges yet).** Two bots get through the whole Duel Arena setup in-game: challenge from the lobby (3360,3268; the gaps between arenas are enclosed), friendly duel on interface 640 (18, then 20 to send), the other challenges back to accept, friendly rules 637 (accept = 83), confirm 639 (35), teleport into an arena (bounds in `duel.mjs`). **Blocker:** the "Fight" player option is accepted by the API but no combat starts and no "can't attack yet" message appears; debug `DuelArea.FIGHT_OPTION` / `continueAttack` for API bots next.

## Known gotchas
- After any server restart, the bot runners log bots back in automatically, but deals in flight time out.
- Dialogue: the interpreter passes `child - 1` to plugins (skill menus send `best + 1`; dialog options use child `idx + 2`).
- Welcome screen: interface 378, Play button child 140. Character designer: 771, buttons 321 (randomize) and 362 (accept).
- Draynor has aggressive dark wizards: low-level bots avoid it (fishing uses Lumbridge Swamp until combat 20).
- `RegionManager.getObject(x, y, z)` argument order (an early bug).
- Kill runners with `pkill -f "node claude_runner.mjs"` (a broader pattern can kill the calling shell).
- Staged tests edit `Server/data/players/<bot>.json` only while that bot is logged out (the server overwrites the save on logout). Items go in `core_data.inventory` (`{amount, charge, slot, id}` strings), position in `core_data.location` (`"x,y,z"`).
- Personalities live in `orders/<bot>.json`; bots without an orders file (test bots) get a seeded one. A tools collector won't sell a Knife or Hammer, which can make a staged trade test look broken.

## Next steps (in order)
1. Check the fleet's first quest parties (runner forms up to `PARTY_MAX`=2 at a time) and the next market day.
2. Rest of random events wave 3 (Mime, Pillory, Quiz Master, Evil Bob, Candlelight, Surprise Exam), bounded PvP (Phase 5), more training methods from `guides/`, more quests (Sheep Shearer, Romeo & Juliet, Imp Catcher; Knight's Sword/Druidic Ritual once combat allows). The launcher (`2009scape/launch.mjs`) is done; untested on Windows itself.
4. Reset all bots to level 1 and start the real run: clear `Server/data/players/`, `bots/market/`, `bots/diaries/`, `bots/recaps/`, and remove test bots (`testbot`, `gebot*`, `mbot*`).

## Usage rules (from the user)
- **Keep usage low.** Don't spend tokens on anything not asked for: no unrequested status checks, polling loops, screenshots or dashboard refreshes.
- **Dashboard snapshots only when the user asks for one.** Never refresh it on your own initiative or as part of other work.
- Prefer one larger batch of work with a short summary over many small check-ins.

Dashboard (snapshot, refreshed only on request): https://claude.ai/artifact/6HWG1Z966j6BatW3LoV6aS (refresh = run `export_dashboard.mjs`, upload the five JSON files as assets, update each `datasets/<id>` source url).
