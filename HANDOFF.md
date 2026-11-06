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
3. Node 24: download from nodejs.org (`node-v24.x-linux-x64.tar.xz`); the bots use `fetch` and ESM.
4. `cd 2009scape && JAVA11_HOME=/usr/lib/jvm/java-11-openjdk-amd64 ./setup.sh` (clones to `../../2009scape-server`, `git lfs pull` for the cache, applies `server-patch/`, builds with Maven).
   If Maven Central rate-limits (HTTP 429), it caches the error page as .pom/.jar files: delete those (`grep -rl "exceeded rate limits" ~/.m2/repository`, also check jars) and add a `~/.m2/settings.xml` mirror of `central` to `https://maven-central.storage-download.googleapis.com/maven2/`.
   Then `./restart.sh` (server; waits for "started in"), then `bots/start-bots.sh` (10 scripted + 50 Claude-directed bots).
5. Optional viewer: `rt4-client` from GitLab (`./gradlew :client:build`; Maven Central may rate-limit, just retry), run with **Java 21** under `Xvfb :99` (JDK 11 here is headless), `xdotool` for input, `viewer/snap.sh <bot>` screenshots. The spectator account must skip the tutorial via Skippy, then admin `::tele x y z` works.

## Layout
- `2009scape/server-patch/content/botapi/BotApi.kt`: HTTP bot API on `127.0.0.1:8899` (login/logout/state/act, `/events`, `/bots`). Actions: walk, scenery, npc, ground, item, useitem, spellnpc, button, style, continue, choose, skillmenu, input, close, say, dm, player, tradeoffer/accept/decline, buy/sell, deposit/withdraw, rescue, forceevent.
- `server-patch/core-changes.patch`: PacketRepository (capture game messages, interface text, PMs for bots), AntiMacro (random events gated per type for API bots), `default.conf` (built-in bots off).
- `2009scape/bots/`:
  - `lib.mjs`: Bot client (walking with door/gate handling, dialogs, onboarding via Skippy, shops, Lumbridge bank via castle stairs, random-event handler wave 1).
  - `tasks.mjs`: skill tasks (woodcut_fire, fish_cook, mine, melee, ranged, magic, thieving, fletch, resupply, treasury).
  - `scripted.mjs`: 10 autonomous bots, task rotation every 50–70 min.
  - `claude_runner.mjs`: 50 Claude-directed bots following `orders/<bot>.json` plans; runs market, council (`POLITICS_MINUTES`), mood drift.
  - `market.mjs`: perceived values, deals (sale, gift, favor, repay, debtsale, bounty, wager), trade-window flow, collections, call-outs, debt collection, bounty posting/claiming, DMs.
  - `social.mjs`: personalities + habits, trust, IOUs, rivalries, bounties state, mood, chat lines.
  - `politics.mjs`: dynamic teams (`market/teams.json`), scoreboard, taxes/mutiny, leaving/recruiting, scaling caps (`capFor`).
  - `status.mjs`, `social_report.mjs`, `export_dashboard.mjs` (dashboard snapshot JSON), `test_task.mjs`, `test_events.mjs`.
- Runtime state (not in git): `bots/market/*.json(l)`, `bots/logs/`, server saves in `Server/data/players/`.

## Status
**Done and seen working in-game:** shops, banking, fletching, trading at perceived values, team gifts and treasurer pooling, favors/IOUs (organic), bounties (claimed and delivered), grudges from defaults, mutiny, a member leaving, recruitment, DMs (verified delivery), habits/collectors/gamblers assigned.

**Observed in-game (Nov 6):** wagers (coin flip paid via trade), debt-collector purchase -> hounding (walk + DMs) -> repayment to the collector, call-outs with bystander trust drops, mood shifts (deaths/level-ups).
**Collection completion observed** (legion20, tools set, 03:25).
**Fixed Nov 6:** the first state poll replayed the server's message backlog into onMsg/onPm (fake deaths/level-ups in mood after every runner restart); cookAll sent low-level bots to Draynor trees (dark wizards) when no tree was near.

**Random events wave 1: done and verified** (`node bots/test_events.mjs testbot <EVENTS...>`, all resolved, no deaths).
- Root cause of the first failed test: `forceevent` was blocked by the per-type allowlist (which was empty). Forced events now bypass it; the state's `randomEvent.type` comes from a `re-type` attribute (hostile NPCs transform their id by combat level, so id matching failed).
- Enabled by default for bots (server-side `WAVE1_EVENTS`, survives restarts; `POST /events` overrides): GENIE, DRUNKEN_DWARF, RICK_TURPENTINE, STRANGE_PLANT, EVIL_CHICKEN, RIVER_TROLL, ROCK_GOLEM, SHADE, SWARM, TREE_SPIRIT, ZOMBIE.
- Handler: talkers are talked to; Genie's lamp is rubbed (XP to the bot's lowest combat/gathering skill); strange plant is picked once grown; hostile events are fought only if combat >= 10 and HP > 60%, otherwise (and always for SWARM) the bot runs until it despawns. Evil Chicken feathers are picked up after a kill (kill path not yet seen in-game; test bots were level 3).
- Wave 2 needs bots to "see" interface item models (Sandwich Lady, Certer), wave 3 the kidnap puzzles (Surprise Exam, Drill Demon, Freaky Forester, Maze, Mime, Pillory, Quiz Master, Evil Bob, Candlelight). The `rescue` action pulls a bot out of a kidnap area.

**Phase 4 (Nov 6):**
- **4.3 diaries + recap: running.** `bots/diary.mjs` writes `bots/diaries/<bot>.md` from the runner's log lines and each bot's game messages (deaths, level milestones, trades/records, debts, grudges, wagers, team changes, quests, random events). `node bots/recap.mjs [hours]` prints a news-style recap (also `logs/recap-<date>.md`).
- **4.2 quests: Cook's Assistant verified solo** (`quests.mjs`, task `cooks_assistant`): egg from Fred's pen (the north farm's eggs are in pens bots can't enter), bucket from the north farm dairy, milk from Gillie's dairy cow, wheat field via its gate, mill hopper on the top floor, flour bin. Party version: leader step `{task:'cooks_assistant', party:{Egg:'<bot>', 'Bucket of milk':'<bot>'}}`, helpers `{task:'quest_fetch', item, for:'<leader>'}`, delivered with deal kind `quest`.
- **Grand Exchange API verified:** actions `gebuy`/`gesell` {item|slot, amount, price}, `gecollect`, `geabort` {slot}; state `ge` (offers). lib: `walkToGE()` (route east of the dark wizards' circle), `openGE()`, `geOffer()`, `geCollect()`. A bot-to-bot buy/sell matched and both sides collected.
- **Market days (4.1) working:** `bots/marketday.mjs`, every `MARKET_DAY_HOURS` (default 6). Day #2 (with haggling): 14 bots, 115 deals completed in ~10 minutes, all got home. Bots don't buy back what they sold or resell what they bought at the same market; max 8 purchases per bot per market.
- **Random events wave 2 verified and enabled:** Sandwich Lady (reads "Have a X, dear", clicks the fixed tray button) and Certer (state `ifaceModels[..].seen` describes the picture; picks the matching option). State also has `ifaceText` for the open interface.
- **Random events wave 3 (kidnaps):** solved and enabled: Quiz Master (odd one out by kind), Freaky Forester (pheasant by tail count), Drill Demon (exercise by mat sign), Mime (copy the emote), Surprise Exam (same-kind item, then the named door), Candlelight (sweep the candle row lighting each). Not yet: Maze (needs exploration memory; doors oscillate), Evil Bob (fish spot shown only in a cutscene). Pillory is broken server-side (kidnap teleport into the cage zone is blocked). Safety net: kidnapped > 8 min → `rescue`. 19 event types enabled in total.
- Perception added to the state: `ifaceText`/`ifaceModels` (with `seen` descriptions), `dialog.models`, npc `anim`, every object on a tile, `shownId` for varying scenery, `sign` for Drill Demon mats and exam doors, `kidnapped`/`kidnapType`.
- `node bots/health.mjs`: quick check for bots underground / far from home / near the dark wizards / low HP.
- State now has `questPoints`, `quests` (stage per started quest, 100 = done), `questFlags`; scoreboard counts quest points.

## Known gotchas
- After any server restart, the bot runners log bots back in automatically, but deals in flight time out.
- Dialogue: the interpreter passes `child - 1` to plugins (skill menus send `best + 1`; dialog options use child `idx + 2`).
- Welcome screen: interface 378, Play button child 140. Character designer: 771, buttons 321 (randomize) and 362 (accept).
- Draynor has aggressive dark wizards: low-level bots avoid it (fishing uses Lumbridge Swamp until combat 20).
- `RegionManager.getObject(x, y, z)` argument order (an early bug).
- Farm cellar at 3230,3286 (trapdoor) has no working exit: bots skip trapdoors, and a bot stuck underground >90s casts Home Teleport (button 192:0).
- `restart.sh` runs a copy of the jar (`target/server-running.jar`), so rebuilding while the server runs is safe.
- Kill runners with `pkill -f "node claude_runner.mjs"` (a broader pattern can kill the calling shell).

## Next steps (in order)
1. ~~Random events wave 1~~ (done).
2. ~~Confirm Phase 1–3 mechanics~~ (all observed, incl. collection completion by legion20).
3. Phase 4: market days at the GE (GE API done), verify quest parties, then The Knight's Sword and Druidic Ritual (both pass dangerous areas: need escorts/levels).
4. Random events: Maze, Candlelight, Evil Bob; bounded PvP (Phase 5), more training methods from `guides/`, a cross-platform local launcher.
5. Reset all bots to level 1 and start the real run.

## Usage rules (from the user)
- **Keep usage low.** Don't spend tokens on anything not asked for: no unrequested status checks, polling loops, screenshots or dashboard refreshes.
- **Dashboard snapshots only when the user asks for one.** Never refresh it on your own initiative or as part of other work.
- Prefer one larger batch of work with a short summary over many small check-ins.

Dashboard (snapshot, refreshed only on request): https://claude.ai/artifact/6HWG1Z966j6BatW3LoV6aS (refresh = run `export_dashboard.mjs`, upload the five JSON files as assets, update each `datasets/<id>` source url).
