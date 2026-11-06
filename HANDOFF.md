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

**Built but not yet observed in-game:** debt-collector purchase completing (last attempt interrupted by a restart), hounding, call-outs, wagers, collection completion, mood effects.

**In progress (unverified): RuneScape random events, wave 1** (`lib.mjs` `handleRandomEvent`, server `forceevent`, state `randomEvent`).
- Bots currently get **no** random events: `GET/POST /events` controls the enabled types for API bots, and it is empty.
- The first test (`node bots/test_events.mjs testbot GENIE DRUNKEN_DWARF RICK_TURPENTINE`) **failed**: no event ever appeared in the bot's state. Debug first: does `AntiMacro.forceEvent` spawn for an API bot (check `server.log` / `getEventNpc`), and is `randomEvent` read correctly in `BotApi.state`?
- Then hostile events (EVIL_CHICKEN, RIVER_TROLL, ROCK_GOLEM, SHADE, SWARM, TREE_SPIRIT, ZOMBIE) and STRANGE_PLANT, then enable them via `POST /events`.
- Wave 2 needs bots to "see" interface item models (Sandwich Lady, Certer), wave 3 the kidnap puzzles (Surprise Exam, Drill Demon, Freaky Forester, Maze, Mime, Pillory, Quiz Master, Evil Bob, Candlelight). The `rescue` action pulls a bot out of a kidnap area.

## Known gotchas
- After any server restart, the bot runners log bots back in automatically, but deals in flight time out.
- Dialogue: the interpreter passes `child - 1` to plugins (skill menus send `best + 1`; dialog options use child `idx + 2`).
- Welcome screen: interface 378, Play button child 140. Character designer: 771, buttons 321 (randomize) and 362 (accept).
- Draynor has aggressive dark wizards: low-level bots avoid it (fishing uses Lumbridge Swamp until combat 20).
- `RegionManager.getObject(x, y, z)` argument order (an early bug).
- Kill runners with `pkill -f "node claude_runner.mjs"` (a broader pattern can kill the calling shell).

## Next steps (in order)
1. Fix and verify random events wave 1; enable those types for bots.
2. Confirm the unobserved Phase 1–3 mechanics in-game (collector purchase, wagers, mood).
3. Phase 4: market days at the Grand Exchange (needs GE API), quest parties (Cook's Assistant, The Knight's Sword, Druidic Ritual), diaries and recaps.
4. Random events waves 2–3, bounded PvP (Phase 5), more training methods from `guides/`, a cross-platform local launcher.
5. Reset all bots to level 1 and start the real run.

Dashboard (snapshot, refreshed by Claude): https://claude.ai/artifact/6HWG1Z966j6BatW3LoV6aS (refresh = run `export_dashboard.mjs`, upload the five JSON files as assets, update each `datasets/<id>` source url).
