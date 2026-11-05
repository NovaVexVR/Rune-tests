# Rune-tests

Bots that play a private RuneScape server and level up through normal gameplay.

- **`2009scape/`** (current): bots for the [2009Scape](https://gitlab.com/2009scape/2009scape) server, which emulates the game around January 2009.
- **`lostcity/`** (earlier): the first prototype, for the [Lost City](https://github.com/LostCityRS/Server) 2004 server (revision 274).

The game server itself is not in this repo. `setup.sh` clones 2009Scape next to this repo and adds the bot API to it.

## How it works

`server-patch/content/botapi/BotApi.kt` adds a local HTTP API on `127.0.0.1:8899`. Bots log in as normal players (no client, no admin rights) and every action is sent as the same decoded packet a real client would send, so bots follow all game rules: pathing, level requirements, shops, banking, trading, dying.

| Group | Bots | Behavior |
|---|---|---|
| Scripted | `scriptbot1-10` | Autonomous. About every hour each picks the task that trains its lowest skills; buys missing tools from Lumbridge shops or picks up free ones. |
| Individualists | `claudebot1-10` | Follow a plan in `bots/orders/<bot>.json` (set by Claude). Each has its own goal and trades only at near-equal value by its *own* perceived prices. |
| 4 teams of 5 | `guildbot1-5`, `wolfbot1-5`, `hawkbot1-5`, `bearbot1-5` | Members gift each other freely; outsiders get equal-value trades. Member 5 of each team is its treasurer: pools spare coins, buys missing tools for members, banks the pool. |
| 1 team of 20 | `legion1-20` | Same rules as the teams, at a larger scale; `legion1` is treasurer. |

Teams are defined in `TEAMS` in `bots/market.mjs`; add or resize teams there.

Perceived values (`bots/market.mjs`): each bot starts from store price and adjusts for its own need and stock, market demand and supply, and recent trade prices. Sales happen at the midpoint of the seller's ask and the buyer's bid, and each side re-checks the trade window against its own values before accepting. Every deal is logged to `bots/market/ledger.jsonl`; current price lists are in `bots/market/values/`.

## Setup

Requirements: git + git-lfs, **JDK 11** (the server targets Java 11), **Node.js 22+**.

### Linux (e.g. CachyOS/Arch)
```bash
sudo pacman -S --needed git git-lfs jdk11-openjdk nodejs
```
```bash
cd 2009scape && ./setup.sh
```
```bash
./restart.sh            # starts the server (and the bot API)
```
```bash
cd bots && ./start-bots.sh
```

### Windows
Install Git for Windows (includes git-lfs), Temurin JDK 11 and Node.js. Run `setup.sh` from Git Bash, start the server with `restart.sh` (Git Bash) or `java -jar Server/target/server-1.0.0-jar-with-dependencies.jar` from the `Server` folder, then double-click `bots/start-bots.bat`.

### Watching / playing
Use the 2009Scape client ([rt4-client](https://gitlab.com/2009scape/rt4-client)) with `client/config.json` pointing `ip_address`/`ip_management` to `127.0.0.1`. Dev-server logins are admins, so `::tele x y z` works to jump to any bot.

### Useful commands
- `node bots/status.mjs`: level table for every bot
- edit `bots/orders/<bot>.json`: change a Claude-directed bot's plan (re-read live)
- `bots/GUIDE.md`: the leveling plan the bots follow, built from the 2009Scape wiki guides in `guides/`

`saves/` holds the bots' character saves so they keep their progress; `setup.sh` copies them into the server.
