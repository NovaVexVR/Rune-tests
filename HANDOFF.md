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
5. Optional viewer: `rt4-client` from GitLab (`./gradlew :client:build`; Maven Central may rate-limit, just retry), run with **Java 21** under `Xvfb :99` (JDK 11 here is headless), `xdotool` for input, `viewer/snap.sh <bot>` screenshots. The spectator account must skip the tutorial via Skippy, then admin `::tele x y z` works.

## Layout
- `2009scape/server-patch/content/botapi/BotApi.kt`: HTTP bot API on `127.0.0.1:8899` (login/logout/state/act, `/events`, `/bots`, `/route`). Actions: walk, scenery, npc, ground, item, useitem, spellnpc, button, style, continue, choose, skillmenu, input, close, say, dm, player, tradeoffer/accept/decline, buy/sell, deposit/withdraw, geitem, rescue, forceevent. State includes `randomEvent`, `ge` (offer slots) and `geScreen` (offer being set up). `GET /route?from=x,y&to=x,y&avoid=x,y,r;...` plans a walk over the real collision map (BFS, doors/gates passable) and returns waypoints.
- `server-patch/core-changes.patch`: PacketRepository (capture game messages, interface text, PMs for bots), AntiMacro (random events gated per type for API bots), `default.conf` (built-in bots off).
- `2009scape/bots/`:
  - `lib.mjs`: Bot client (walking with door/gate handling, `travel()` for long trips on a planned route around `DANGER` zones, dialogs, onboarding via Skippy, shops, Lumbridge bank via castle stairs, Grand Exchange `geOpen/geOffer/geCollect/geAbort`, random events wave 1 incl. XP lamps, `RANDOM_EVENTS` enabled on every login).
  - `tasks.mjs`: skill tasks (woodcut_fire, fish_cook, mine, melee, ranged, magic, thieving, fletch, resupply, treasury).
  - `scripted.mjs`: 10 autonomous bots, task rotation every 50–70 min.
  - `claude_runner.mjs`: 50 Claude-directed bots following `orders/<bot>.json` plans; runs market, council (`POLITICS_MINUTES`), mood drift, market days, diaries.
  - `marketday.mjs`: daily market at the Grand Exchange (`MARKET_EVERY_MINUTES`, `MARKET_MINUTES`, `MARKET_LEAD_MINUTES`): travel, shouted offers, haggling, GE offers, trip home.
  - `diary.mjs` (`bots/diaries/<bot>.md`, milestones in `diaries/.marks.json`) and `recap.mjs` (news-style recap of the last day to `bots/recaps/<date>.md`).
  - `market.mjs`: perceived values, deals (sale, gift, favor, repay, debtsale, bounty, wager), trade-window flow, collections, call-outs, debt collection, bounty posting/claiming, DMs.
  - `social.mjs`: personalities + habits, trust, IOUs, rivalries, bounties state, mood, chat lines.
  - `politics.mjs`: dynamic teams (`market/teams.json`), scoreboard, taxes/mutiny, leaving/recruiting, scaling caps (`capFor`).
  - `status.mjs`, `social_report.mjs`, `export_dashboard.mjs` (dashboard snapshot JSON), `test_task.mjs`.
  - In-game tests with staged setups (`setup` edits saves while bots are logged out, then `run`): `test_events.mjs` (random events), `test_social.mjs` (collector, hounding, repayment, wager, collection, call-out, death mood), `test_ge.mjs` (GE buy/sell/collect), `test_marketday.mjs` (compressed market day).
- Runtime state (not in git): `bots/market/*.json(l)` (incl. `marketday.json`), `bots/logs/`, `bots/diaries/`, `bots/recaps/`, server saves in `Server/data/players/`.

## Status
**Done and seen working in-game:** shops, banking, fletching, trading at perceived values, team gifts and treasurer pooling, favors/IOUs, bounties, grudges, mutiny, leaving, recruitment, DMs, habits/collectors/gamblers, and (via `test_social.mjs`) debt-collector purchase, hounding, repayment to the collector, wagers, collection completion, call-outs with bystander trust drops, and mood after a death.

**Random events wave 1: done and enabled for bots.** Genie (XP lamp rubbed), Drunken Dwarf, Rick Turpentine, Strange Plant, and the seven hostile events (fight while healthy, flee when hurt) all resolved in-game on a level-3 bot. The earlier failure was the AntiMacro gate also blocking *forced* events while the enabled list was empty. `RANDOM_EVENTS` in lib.mjs is posted to `/events` on every login, so it survives server restarts.

**Phase 4.1 market days: built and checked** (`test_marketday.mjs`, compressed): 6 level-3 bots travelled Lumbridge→GE→home on the planned safe route with no damage, shouted offers, haggled 2 knife sales at prices between bid and ask (through the normal trade window), posted 7 GE offers, and went home. In the live runner the first market day opens ~50 min after start, then every 24 h (`MARKET_EVERY_MINUTES`). Not yet seen with the full 50-bot runner.

**Grand Exchange API: done** (`test_ge.mjs`): offers placed through the GE screen, matched bot-to-bot, collected.

**Phase 4.3 diaries/recaps: built** (diary lines verified from the market-day test; `recap.mjs` prints the day's headlines, trade, grudges, milestones, standings).

Wave 2–3 random events remain disabled for bots (they never get them).

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
1. Phase 4.2 quest parties: Cook's Assistant first (egg, bucket of milk, pot of flour via the windmill), then The Knight's Sword and Druidic Ritual. `travel()` and `/route` now handle the walking.
2. Watch one real market day with the full runner (are attendance odds and the 50-min lead right at 50 bots?).
3. Random events waves 2–3, bounded PvP (Phase 5), more training methods from `guides/`, a cross-platform local launcher.
4. Reset all bots to level 1 and start the real run: clear `Server/data/players/`, `bots/market/`, `bots/diaries/`, `bots/recaps/`, and remove test bots (`testbot`, `gebot*`, `mbot*`).

## Usage rules (from the user)
- **Keep usage low.** Don't spend tokens on anything not asked for: no unrequested status checks, polling loops, screenshots or dashboard refreshes.
- **Dashboard snapshots only when the user asks for one.** Never refresh it on your own initiative or as part of other work.
- Prefer one larger batch of work with a short summary over many small check-ins.

Dashboard (snapshot, refreshed only on request): https://claude.ai/artifact/6HWG1Z966j6BatW3LoV6aS (refresh = run `export_dashboard.mjs`, upload the five JSON files as assets, update each `datasets/<id>` source url).
