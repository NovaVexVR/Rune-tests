# Roadmap

What's planned for the bot world, in priority order, plus how the built systems work.

**Note:** bots will be reset to fresh level-1 characters for the real run (milestone just before human players join, after everything else on this list is built); until then, test scenarios are set up by hand to prove each mechanic.

## Done
- **Core:** bot API (real client packets, no admin), 60 bots (10 scripted, 10 individualists, four 5-bot teams, a 20-bot legion), shops, banking, cross-platform launcher (`launch.mjs`; tested on Linux, not yet on Windows).
- **Economy:** per-bot perceived prices, team treasurers, trade-window deals, favors/IOUs, debt collectors, bounties, wagers, collections, Grand Exchange API, market days at the GE.
- **Society:** personalities, trust, grudges and call-outs, scoreboard, taxes and mutiny, leaving and recruiting, private messages, habits, mood, diaries and recaps.
- **Getting around:** server-side route planner (`/route`) that avoids danger zones and opens doors; `travel()` for long trips.
- **Quests:** Cook's Assistant (solo and as a party), Rune Mysteries, Sheep Shearer; quest parties with roles; quest points in the team score.
- **Random events:** waves 1 and 2, and Freaky Forester, Drill Demon and Maze from wave 3, all enabled for bots; kidnap safety net.
- **Training and gear:** smelting and smithing (bronze bars, daggers, armour by level); bots wear the best gear they carry, carry food from the bank, and bank their resources instead of dropping them.

## Planned, in priority order

### A. Keep the bots alive and running
1. *(done)* **Stuck-bot watchdog:** flag bots that haven't moved or gained xp in a while, and unstick them (walk home, relog, rescue).
2. *(done: shop sales only when a bank is nearly full; surplus goes to market days)* **Bank management:** banks fill now that bots keep everything. Periodic clear-outs: sell junk to shops, post surplus on the GE, give teammates what they need, keep a reserve of food and tools.
3. *(done: a quick catch-and-cook run before fights/thieving; cooking itself fixed)* **Food for bots with an empty bank:** buy it, fish it, or ask a teammate, instead of going out without any.
4. *(done)* **Danger memory:** each bot remembers where it died, avoids that area for a while, and warns friends by PM, so the list of dangerous places grows by itself.
5. *(done)* **Death recovery:** after a death, go back for the dropped items while they're still there (with an escort if it was a fight).
6. *(done: `node bots/run_tests.mjs`, report in `bots/tests/last-run.md`)* **Regular test runs** of the staged tests (`test_events`, `test_social`, `test_party`, `test_ge`, `test_marketday`, `test_duel`), so server changes can't silently break mechanics.

### B. A real economy
7. *(done)* **Team stash:** the treasurer keeps shared goods (food, armour, tools) as well as coins, and hands them out to members who need them.
8. *(done: wool to balls of wool (`spin`), cowhide to leather to leather armour (`leather`, Al Kharid), ore to bars to armour, bank notes for trading; arrows: smiths make bronze/iron arrowtips, fletchers turn shafts + feathers + tips into arrows for the rangers (verified: 20 arrows))* **Reasons to trade:** crafting chains and selling surplus, so market days have real supply and demand.
9. *(done and verified: iron; steel (coal at Barbarian Village from Mining 40, steel bars from Smithing 30, steel armour); fighters buy armour at Horvik's with 30% of their savings)* **Iron and steel.**
10. *(done: oak bows (willow bows verified 2026-11-08: Lumbridge willows, about 23 willow longbows (u) and +954 Fletching xp in 15 minutes), fly fishing (rod from Port Sarim, feathers from chickens), leather crafting; agility verified 2026-11-08: a combat-45 bot walks in legs over White Wolf Mountain (each leg re-planned after wolf fights), through the Stronghold gate, 9 laps in 8 minutes (+732 xp), then home by teleport)* **More training methods.**
11. *(done: the castle range after Cook's Assistant, Runecrafting after Rune Mysteries (essence via Aubury, air runes at the air altar; verified: 63 runes in 3 trips), prayer from buried bones)* **Use what quests unlock.**

### C. Progression
12. *(written: escorts (`bots/escort.mjs`, `test_escort.mjs`, used for the iron mine's muggers; verified in-game) and apprenticeships (`careers.mjs`: hourly, a career bot with 20+ takes on a weaker teammate once a day and gives it the trade's starter goods))* **Escorts and apprenticeships:** stronger teammates escort or train weaker ones; needed for the next quests.
13. *(Romeo & Juliet and Druidic Ritual done and verified in-game (Herblore unlocked); Imp Catcher verified in-game (all four beads after 18 imp fights, Amulet of accuracy). The Knight's Sword verified in-game 2026-11-09 with a combat-45 bot (Smithing 1 -> 29, 1 quest point): after the server took the real game's rule (auto-retaliate off: attacks no longer stop a player's skilling; core patch in `CombatPulse.kt`), the bot mines the blurite among the ice warriors with retaliation off, eating as it goes and Cooking 32 (the redberry pie from Romily in the Cooks' Guild): stages squire 10 -> Reldo 20 -> Thurgo with a pie 30-40 -> the portrait from Sir Vyvin's cupboard 50 -> Thurgo with blurite and 2 iron bars 60-70 -> squire 100)* **More quests:** The Knight's Sword and Druidic Ritual (both need escorts past ice warriors / Taverley dungeon), Romeo & Juliet, Imp Catcher.
14. *(done: `bots/careers.mjs`: a career from total level 60 (best skill + personality), plans bend toward it (up to 40% of steps), skill-to-next-10 or full-armour-set goals with diary lines; `market/careers.json`)* **Careers and life goals:** each bot picks a career (smith, fisher, crafter, fighter) and a long-term goal from its personality (full steel armour, a skill to 50, a quest list), and its plan bends toward it. Diaries and recaps follow the goal.

### D. Society
15. *(done: `bots/noticeboard.mjs` -> `market/noticeboard.json` every 10 min; in the recap; going prices pull bots' own prices toward them)* **Public notice board** for bounties, prices and reputations, readable in the recaps.
16. *(done: council diplomacy in `politics.mjs`: allied above +0.08 team trust twice running, feud below -0.08 or 3+ grudges; allies trade 10% cheaper and escort each other, feuds mark up 20%)* **Team alliances and feuds** that go beyond single-bot grudges, with team-level trust.
17. *(done: `bots/justice.mjs` in the council: the most trusted bot hears recent defaults; warning first, then a court-ordered fine (debt + 50%, due in a day) for 2+ defaults a week, the treasurer is told; judges gain respect)* **Disputes and justice:** a respected bot (or the most trusted per team) arbitrates defaults and fines repeat offenders.
18. *(done: `claude_runner.mjs`: a fresh `newbie<n>` every 6 h, up to 10, on a starter plan; a team's most generous member welcomes it with a gift and the trust lets the council recruit it; `market/newcomers.json`)* **Newcomers:** new bots join over time as fresh characters; teams recruit and mentor them.
19. *(duel blocker fixed: duels flag both players as "wilderness" and the server's wild-PvP switch is off, so every hit was refused; core patch lets duel areas follow the duel's own rules. `test_duel.mjs` now ends with a real winner. Grudge duels done: `GrudgeDuels` in `duel.mjs`, bold bots challenge rivals, both walk to the arena (paying the toll), the winner's grudge is settled; verified in-game)* **PvP (Phase 5):** wilderness PvP switched on (`wild_pvp_enabled = true` in the server config, kept in `core-changes.patch`); bots in the wilderness mines attack a rival or a feuding team's bot within 8 combat levels (`wildFoe` in `tasks.mjs`), a real death with dropped items (details below).
20. *(done: `bots/events.mjs` rotates a fishing contest, a smithing fair and a duel tournament (knockout rounds at the arena through `GrudgeDuels.arrange`) every 84 h, announced an hour ahead, in the recap)* **Events:** weekly fishing contests, smithing fairs, and duel tournaments once duels work, announced in chat and covered in the recap.
21. *(Quiz Master, Pillory, Surprise Exam, Evil Bob and Mime verified in-game (interface models and NPC animations now reach the bots); Candlelight solver written but left untested: the server marks Candlelight as not in the real 2009 game (`INAUTHENTIC_CANDLELIGHT_RANDOM`, off), so it stays off)* **Rest of random events wave 3:** Surprise Exam, Mime, Pillory, Quiz Master, Evil Bob, Candlelight (need item models or animations).

### E. Operations and outreach
22. *(done: `bots/director.mjs` (brief / due / done / alerts), `DIRECTOR.md` (the pass's instructions), `run_director.sh` / `.cmd` for a local hourly schedule that runs `claude -p` only when a pass is due (daily, or sooner on an alert); the runner checks alerts every 30 min; first pass done 2026-11-07)* **Daily director pass:** Claude reads the recap and rewrites some bots' plans (`orders/`).
23. *(data done: `bots/economy.mjs` samples every 30 min into `market/economy.jsonl` (coins, goods, median wealth, Gini, per-group wealth, prices, richest/poorest); `export_dashboard.mjs` writes `economy.json` and `wealth_latest.json`; the charts go on the dashboard at the next snapshot)* **Economy charts:** coins in circulation, prices over time, who's rich and who's poor, on the dashboard.
24. **Test the launcher on Windows.**

### F. Before the real run (planned)
26. *(done: `bots/backup.mjs` -> `2009scape/backups/world-<time>-<label>.tar.gz`, at every launch and daily from the runner, 14 days kept; `node bots/backup.mjs list`)* **Automatic backups:** daily snapshots of the player saves, `bots/market/`, diaries and recaps, plus one before every reset or restart; keep the last 14 days. Weeks of history shouldn't be one broken save or full disk away.
27. *(done: runners record each task step's coin change in `market/flows.jsonl` (`economy.mjs` recordFlow / flowSummary); the director briefing shows coin sources and sinks per task; alerts on total coins +50% or -30% in a day)* **Economy balance watch:** track where coins enter (thieving, shop sales, quest rewards) and leave (tolls, shops, tanning, fines); a director alert on runaway inflation or deflation, so wealth keeps growing slowly.
28. *(done 2026-11-07: 59 bots online on 4 cores: the server ~40% of one core and 3.6 GB (Java's default heap), the bot runners ~11% CPU and 240 MB together, the machine 95% idle. A 4-core, 8 GB computer is plenty; the heap can be capped with -Xmx2g if memory is tight)* **Performance check for running locally:** CPU and memory of the server and 60+ bots with every feature on; tune polling and bot count to the user's machine before the switch.

### Milestone: reset to level 1 and start the real run
Clear `Server/data/players/`, `bots/market/`, `bots/diaries/`, `bots/recaps/`, remove the test bots (`testbot`, `qbot*`, `pbot*`, `mbot*`, `gebot*`, `dbot*`, `lbot*`, `sbot*`, `abot*`, `ebot*`, `rjbot*`, `icbot*`, `drbot*`, `ksbot*`) and the newcomers' orders (`orders/newbie*.json`), and start the fleet with `launch.mjs`. Human players join the fresh world.

25. **Human players** joining the server and trading or chatting with bots.

### G. With human players (planned)
29. **Talk to the bots:** a human's chat or private message to a bot is answered by Claude in that bot's personality (its diary, grudges, career, mood), rate-limited to keep usage low.
30. **Bots trade with humans:** accept human trade requests at the bot's own perceived prices; humans can post bounties on the notice board and bots fill them.

### H. Deeper gameplay and story (planned)
31. *(done and verified: `herblore` task after Druidic Ritual: grimy herbs picked up by fighters, cleaned, vials and eyes of newt from Jatix (Taverley), filled at the village fountain, unfinished potions and attack potions (6 made, +150 xp); a herbalist career)* **Herblore:** unlocked by Druidic Ritual: clean herbs from drops, attack potions (guam + eye of newt), a herbalist career; potions become goods to trade.
32. *(done in code: `bots/outings.mjs`: once a day per team with 3+ online, a ground for the weakest member (barbarians from combat 10, Al Kharid warriors 14, dark wizards 28), roles (leader, food carrier who shares food first, looter), 20 minutes together; moss giants wait for an underground route)* **Group combat outings:** teams go together to the Varrock sewers or the moss giants, with roles (front fighter, food carrier, looter), building on escorts.
33. *(done in code: `wild_mine` task for bold miners: the shallow mine north of Edgeville (coal, iron) and the deep one (mithril 55, adamantite 70, combat 40); bank at Edgeville after each load; rivals fight there; tested 2026-11-09 at combat 30: it got there and back alive but spent 10 trout on skeletons for +250 xp in 13 minutes, so it now needs combat 40)* **Wilderness risk and reward:** wilderness mines and resources that bold bots visit for better pay, with a real risk of being attacked (wilderness PvP is on).
34. *(done and verified: `lobsters` task from Fishing 40: lobster pot from Gerrant, the Port Sarim boat (30gp), cage fishing at Musa Point, back by boat and banked at Falador; a 20-minute round trip caught 26)* **Karamja trips:** the boat from Port Sarim for lobsters and better food at higher fishing levels.
35. *(done and verified: `merchant` task and career: at the GE it collects last time's offers, bids ~80% of the board's going price on popular goods and lists its stock at ~120%, using at most a third of its coins)* **Merchants:** a trading career that buys low and sells high on the Grand Exchange and at market days (the merchant personality exists, no career uses it yet).
36. *(done: `bots/records.mjs`: hourly firsts (10/20/.../50 per skill) and all-time bests (richest, total level, quest points, duel wins); diary lines, the crier, a "Hall of fame" in the recap; `market/records.json`)* **Records and hall of fame:** firsts and milestones (first to Smithing 50, richest bot, most duels won) kept in `market/records.json`, shown in the recap and on the dashboard.

### I. Fun and quirks (planned)
37. *(done: `bots/nicknames.mjs`, hourly from diaries, skills and the richest bot; used in chat lines and a recap section; `market/nicknames.json`)* **Nicknames:** bots earn them from deeds ("Chickenslayer", "Old Ironfist", "the Unlucky"); others use them in chat and the recap uses them in headlines.
38. *(done: `bots/superstition.mjs`: a good streak gives a lucky charm (never sold, priced 5x, a fuss if lost) or a ritual (a bone buried at the chapel before that task); hourly)* **Superstitions and lucky charms:** a bot on a good streak decides an item is lucky, won't sell it and frets if it dies with it; little rituals (burying a bone at the chapel before mining).
39. *(done: `bots/phobias.mjs`: the last attacker is remembered from the state; a death to a level-5-or-lower creature gives a 3-day phobia (no fights with it, a diary line), and sociable bots nearby tease it hourly)* **Phobias:** a bot killed by something embarrassing (a chicken, an imp) avoids that creature for days and gets teased about it.
40. *(done: `bots/gossip.mjs`: rumours from diary events (defaults, grudges, deaths, wins, the richest bot) spread by DM every 15 min, worsening as they go; hearers' trust moves; the subject denies grown rumours; "The rumour mill" in the recap)* **Gossip and rumours:** news passes bot to bot and drifts as it spreads ("owes 5gp" becomes "is a thief"); rumours move trust, and the target can clear its name.
41. *(done: `bots/talltales.mjs`, hourly boasts about the best skill that grow with each telling; a better bot nearby calls them out)* **Tall tales:** fishers and fighters boast in chat, the boasts grow with each telling, and bots who know better call them out.
42. *(done: `bots/crier.mjs`: an hourly crier in Lumbridge square shouting the freshest news; "The Lumbridge Whisper", a daily spun paper by the most sociable bot, in `bots/recaps/<date>-whisper.md`)* **Town crier and the tabloid:** a sociable bot shouts the news in Lumbridge square; a second recap written as a biased gossip rag by a journalist bot with favourites and enemies.
43. *(done: `bots/mayor.mjs`: a vote by trust every 7 days among the five most trusted; the mayor picks the next festival from its career, pardons a friend's debt, and takes the blame for a bad day; `market/mayor.json`)* **Mayor elections:** a weekly vote by trust for mayor of Lumbridge; the mayor picks the next festival, can pardon a debt, and gets blamed when things go wrong.
44. *(done: `bots/feasts.mjs`: a team member's win (contest, duel, quest, mayoralty) makes the best-stocked cook hand food to each teammate online by gift trade; mood and team trust up; once a day per team)* **Feasts:** after a team wins something its cook feeds everyone in the courtyard: mood and loyalty up.
45. *(done: `bots/lottery.mjs`: weekly, a gambler sells 5gp tickets by coin trade for 6 hours and draws a winner; a greedy, disloyal one may keep the pot as an IOU the court will hear)* **The gambler's lottery:** a gambler bot sells tickets and draws a weekly winner; sometimes it runs off with the pot and the court gets involved.
46. *(done: `bots/hunt.mjs`: every 3 days a riddle to a safe landmark; bots work it out hourly (teammates share), race there between tasks, the first wins 30gp from the mayor and the glory)* **Treasure hunts:** the director hides a prize (a bounty with a riddle clue to a place); bots follow the clues and teams race each other.
47. *(done: in `duel.mjs`: the loser of a grudge duel vows a rematch (`market/revenge.json`), trains melee in 35% of its steps, and challenges again once its combat passes the rival's; two failed rematches and it lets it go)* **Revenge plots:** a bot that loses a grudge duel trains for a rematch, says so in its diary, and challenges again when it's ready.

### J. Growth, economy and life (added 2026-11-09)

48. *(in progress: Doric's Quest verified (Rimmington mine, +1,470 Mining xp), The Restless Ghost verified (+1,125 Prayer xp), Witch's Potion verified (combat 10+, +325 Magic xp), Vampire Slayer verified (combat 30+: garlic from Morgan's cupboard, a beer for Dr Harlow, the Count in the manor basement; +4,825 Attack xp); Goblin Diplomacy verified (combat 10+, 60gp: goblin mails from the village crates, dyes from Aggie with redberries, onions and Wyson's woad leaves; +200 Crafting xp, 5 quest points); next: Ernest the Chicken)* **More quests:** Doric's Quest, Witch's Potion, The Restless Ghost, Ernest the Chicken, Goblin Diplomacy, Vampire Slayer (Sheep Shearer is in already), solo and in parties.
49. *(melee done and verified: `MELEE_LADDER` in tasks.mjs moves bots chickens -> cows -> Barbarian Village -> Al Kharid warriors -> Varrock guards by their melee stats and combat; a combat-46 bot got +712 Strength in a few minutes at the guards; mining already moves copper/tin -> iron -> coal)* **Training spots by level:** combat moves chickens -> cows -> Al Kharid warriors -> hill giants; mining tin/copper -> iron -> coal; and so on, instead of one spot per task.
50. *(done for free-to-play: fights pick up and bury big bones as well as bones (3x the xp), and The Restless Ghost gives 1,125 Prayer xp; bones on an altar give xp only at a player-owned house's gilded altar, which is members-only in 2009)* **Prayer:** keep burying bones from fights, collect big bones from tougher monsters, and later use the bones on an altar.
51. *(pottery done and verified: `pottery` task, clay mined at the Varrock south-west mine or taken from the bank, softened with a bucket at the Varrock fountain, the wheel and oven at Barbarian Village, banked at Edgeville: 18 pots and +226 Crafting xp in 25 minutes; jewellery and glassblowing next)* **Crafting beyond leather:** pottery (soft clay at Barbarian Village), jewellery (gold bars and the gems bots find), then glassblowing.
52. *(done for free-to-play: the Lumbridge castle range first when it's close (burns less), raw beef cooked as meat not sinew, fly fishing for trout and salmon and Karamja lobsters already in; Catherby is members-only)* **Cooking and fishing upgrades:** the Lumbridge castle range, trout and salmon, Catherby later.
53. *(done and verified: `sellGoods` / `SELL_ROUTES` in tasks.mjs, every 6 hours from both runners: bank piles of made goods go to the shop that stocks them (Cassie, Brian, Wydin, Horvik, Peksa, Gerrant, Lowe, Thessalia, Grum), which pays the item's alchemy value (high alchemy at Cassie's, Brian's and Wydin's) instead of the general store's overstocked low price; one of each piece of gear kept; fish it can cook is kept for cooking; 20 raw lobsters fetched 1,045gp. Note: this server's GE has no NPC buyers, so GE sales only fill against other bots' bids)* **High-value goods:** bots sell the bows, armour and lobsters they make at the Grand Exchange and to each other at real prices, so wealth climbs through work (100k is an ordinary fortune in the real game).
54. *(done in code: `GEAR_SHOPS` in tasks.mjs: every 6 hours a fighter with 200gp+ spends up to 30% of its wealth on the best upgrade it can wear, now up to black and mithril platebodies at Horvik's and bronze to mithril scimitars at Zeke's in Al Kharid, within each metal's Defence or Attack level; runes for Magic already come from RESUPPLY (Aubury) and Betty's shop is known; adamant and rune need shops outside free-to-play)* **Spending sinks:** armour and weapon upgrades as bots get richer, runes for Magic, adamant and rune purchases.
55. *(done in code: `bots/meetups.mjs`: hourly, up to 3 pairs of online bots that trust each other 0.3+ both ways (16 such pairs today; sociable ones first, each pair at most twice a day) meet up: the guest walks to its friend and trains the friend's current task beside it for ~25 minutes, chatting about it; trust and mood rise, diary lines for both)* **Friends and meetups:** bots that trust each other train side by side and chat about what they're doing.
56. *(done in code: `bots/stalls.mjs`: every 2 hours a merchant (career or personality) with tradeable goods banked opens a 40-minute stall in Varrock square: takes up to six kinds of goods out as notes, shouts its prices every 2 minutes, and the market's need-matching brings buyers to it; leftovers banked, takings in its diary and `market/stalls.json`)* **Bot-run stalls:** a merchant bot sets up in Varrock square and advertises in chat, like real players.
57. *(done in code: `bots/celebrations.mjs`: a skill to 50/60/70/80/90/99, a town first, or 10/20/30 quest points starts a 15-minute celebration; online teammates and friends (trust 0.2+) within 120 tiles walk over between tasks, cheer, clap, wave or jump for joy (emote tab buttons), congratulate the bot in chat, moods and trust lift; feasts now also fire for the big level milestones)* **Milestone celebrations:** a level 99 or a first rune item draws a crowd, gets the crier's attention and a feast.
58. *(done: `bots/dashboard.mjs`, started by `launch.mjs` (skip with `--no-dashboard`): http://127.0.0.1:8090 refreshes every 30 s: every bot on a map of the free-to-play world in its team colour, a table (team, career, combat, total level, task, last seen), the average total level over time and the coins in circulation with median wealth and Gini; reads the logs, market files and the bot API, writes nothing)* **Live web dashboard:** bots on a map, levels over time, the economy charts (item 23).
59. *(done: `node bots/weekly.mjs [days]` writes `bots/reports/week-<date>.html` and `latest.html`: levels gained, top growers, quests by name, records, deaths and the unluckiest, the week's stories (duels, mayor, apprentices, stalls, celebrations, meetups), the economy; fleet bots only; the Monday director pass publishes it as the "Rune Bots Weekly" artifact)* **Weekly report:** a shareable page with the week's growth, deaths, richest bots, quests and drama.

---

# Reference: how the built systems work

## Phase 1: Reputation and conflict
Builds directly on trust and IOUs.

### 1.1 Rivalries and grudges
- A bot that is defaulted on (or loses a trade it judged unfair twice) marks the other bot as a **rival** in `market/relations.json`.
- Rivals: the bot refuses trades with them, asks rival teams for a markup, and publicly calls them out in chat now and then.
- Calling out lowers the rival's trust with bots nearby (`Social.adjustTrust` for every bot within 15 tiles).
- Grudges fade: a rival entry decays after a few in-game days, or immediately if the debt is repaid.
- **Check:** force a default between two test bots; confirm refusal, call-out chat, and bystander trust drops.

### 1.2 Debt collectors
- Merchant/opportunist bots offer to **buy overdue IOUs** at a discount (e.g. 60% of what's owed, adjusted by the debtor's reputation).
- The IOU's creditor changes to the collector, and the original creditor gets coins now.
- Collectors "hound" the debtor: they walk to it on their breaks and post reminder chat. Repayment goes to the collector.
- **Check:** IOU ownership transfers, the debtor repays the collector, and the ledger records both steps.

### 1.3 Bounty board
- Any bot can post a job: "deliver N of item X, reward Y coins (or an IOU)" in `market/bounties.json`, with a deadline.
- Bots that have the item spare, or a task that produces it, can claim a job. Claimed jobs are reserved so two bots don't race.
- Delivery uses the normal trade flow, and the reward is paid by the poster (treasurer pays for team jobs).
- Personality: generous bots post higher rewards, greedy bots chase the best reward per minute, cautious bots only claim from trusted posters.
- **Check:** post a cooked-fish bounty; a fisher bot claims, cooks, delivers, gets paid; the ledger shows it.

## Phase 2: Teams with politics

### 2.1 Team scoreboard and rivalry
- Hourly snapshot of each team's total level, total wealth (inventory + bank at perceived values) and quests done, in `market/scores.jsonl`.
- Announced in chat by each team's most sociable member; the leading team gets a small trust bonus with outsiders (prestige).
- Teams adapt: a team behind on wealth shifts members toward money-making tasks for the next cycle.
- **Check:** scores file grows each hour; a lagging team's plans change.

### 2.2 Taxes, hoarding and mutiny
- Treasurers keep a **tax rate** (share of pooled coins they may keep for themselves), set by their greed.
- Members track how much they paid in versus received. If a treasurer keeps too much, members' trust in it drops.
- When average member trust in the treasurer falls below a threshold, the team **votes** (highest-trust member wins) and the treasurer role moves; plans for both bots are rewritten (`TEAMS[*].treasurer` becomes dynamic in `market/teams.json`).
- **Check:** give a test treasurer a high tax rate, watch trust fall and a new treasurer get elected.

### 2.3 Leaving and joining teams
Teams start pre-made, but membership changes with how the bots get along (needs the dynamic `market/teams.json` from 2.2).
- **Satisfaction:** each team member tracks how the team treats it: gifts received vs. coins/items given, how often its needs were met, its average trust in teammates and the treasurer, and taxes paid.
- **Leaving (extreme cases only):** if satisfaction stays very low for a sustained period (e.g. several hours) *and* its trust in the treasurer or team has gone negative, the bot quits and becomes an individualist. It keeps its own items, announces it in chat, and its old teammates' trust in it drops (they see it as a deserter). A short cooldown stops it from rejoining immediately.
- **Recruiting:** an individualist that has built high trust *with* a team (fair trades, repaid IOUs, completed bounties), where the team's members also trust it highly, gets an invitation. Both sides must clear a trust threshold; the bot's personality decides whether it accepts (loyal/sociable bots join readily; misers and opportunists weigh the tax rate and what the team can offer).
- On joining, it switches to team rules (free giving inside, coins pooled to the treasurer) and gets a team role based on its skills.
- Team size limits keep the 20-man legion and the 5-bot teams from absorbing everyone; full teams can still recruit by inviting a replacement for a low-satisfaction member.
- **Check:** push a test bot's satisfaction down and confirm it leaves; build mutual trust between an individualist and a team and confirm the invite, acceptance, and switch to team rules.

## Phase 3: Bots with character

### 3.1 Habits
- Each bot gets a few stable quirks in its personality: a favorite spot it idles at between tasks, a home bank, a favorite food it never sells, and (for gamblers) a habit of wagering coins with other gamblers on a coin flip.
- Wagers go through the normal trade flow; both sides must agree, and the result is logged.
- **Check:** idle bots walk to their spot; favorite food never appears in sales; a gamble pays out correctly.

### 3.2 Collectors and hoarders
- Some bots pick a **collection** (one of every fish, all bronze tools, all log types) and value the missing pieces far above normal.
- Completing a collection is a diary milestone and earns a chat celebration.
- **Check:** a collector's perceived value of a missing piece is several times store price; it pays it.

### 3.3 Mood
- A mood score per bot moves with events: deaths, defaults and losses push it down; level-ups, good deals and repaid debts push it up; it drifts back to neutral over time.
- Low mood means more caution and less chat; high mood means more generosity and more risk.
- **Check:** after a death, the bot's caution and prices shift, then recover.

## RuneScape random events
Bots handle random events as players do; each type is enabled for bots once its solver is proven (`RANDOM_EVENTS` in lib.mjs, sent to the server on login).
- **Wave 1 (done, enabled):** Genie (XP lamp rubbed on the bot's best skill), Drunken Dwarf, Rick Turpentine, Strange Plant, and the hostile Evil Chicken, River Troll, Rock Golem, Shade, Swarm, Tree Spirit and Zombie (fight while healthy, flee when hurt). Verified with `test_events.mjs`.
- **Wave 2 (done, enabled):** Sandwich Lady (the food she names in dialogue -> its button on her tray) and Certer (rule out the decoy captions). Neither needed item models after all.
- **Wave 3 (partly done, enabled):** Freaky Forester, Drill Demon (random mats: the signs are client-side), Maze (route planner through its doors). Left: Surprise Exam, Mime, Pillory, Quiz Master, Evil Bob, Candlelight (need item models or animations).
- **Fight-or-flee** (Evil Chicken, River Troll, Rock Golem, Shade, Swarm, Tree Spirit, Zombie): fight if combat allows, otherwise move away from the spot until it despawns.
- **Puzzles and kidnappings** (Surprise Exam, Drill Demon, Freaky Forester, Maze, Mime, Pillory, Quiz Master, Evil Bob, Strange Plant, Candlelight): one solver per event, reading the event's interface or dialog from the bot API and answering it.
- **Safety net:** if a bot is somewhere it can't solve for too long, it uses the event's exit or is rescued, and the incident goes in its diary.
- Re-enable random events for bots one event type at a time as each solver is proven.
- **Check:** trigger each event on a test bot; it completes or exits without help.

## Phase 4: Gatherings and stories

### 4.1 Market days at the Grand Exchange (built: `marketday.mjs`, checked with `test_marketday.mjs`)
- Once per in-game day, bots with spare goods travel to the **Grand Exchange in Varrock** for a 20-minute market.
- Getting there safely: the Lumbridge–Varrock road passes the dark wizards' stone circle south of Varrock, which kills low-level bots. Bots take a route around it, travel in groups with a fighter escort, or skip market day until their combat level can handle it. *(Built: the server plans the route on the collision map around `DANGER` zones; a level-3 bot makes the round trip unhurt in about 5 minutes. Escorts not needed so far.)*
- Bots can also post GE buy/sell offers while they're there (needs the Grand Exchange API work below), so market day mixes face-to-face haggling with GE offers.
- Sellers "shout" offers in chat at their asking prices; buyers make counter-offers; deals still use the normal trade flow and personality-based acceptance, so haggling is real.
- **Check:** at market time, bots arrive at the GE without deaths on the way, a crowd forms, offers appear in chat, and trades complete at prices between ask and bid.

### 4.2 Quest parties
- Bots form small parties for quests, with roles: the fighter escorts and kills, others gather items.
- First quests (all near Lumbridge, from the wiki guides):
  - **Cook's Assistant:** egg, bucket of milk, pot of flour. Unlocks the Lumbridge range.
  - **The Knight's Sword:** Smithing 1 → 29.
  - **Druidic Ritual:** unlocks Herblore.
- Each quest is a script of steps (walk, talk with dialog choices, gather, hand in); quest rewards count toward the team scoreboard.
- **Check:** a party completes Cook's Assistant and the bots' quest points and Cooking XP update.

### 4.3 Diaries and recaps (built: `diary.mjs`, `recap.mjs`)
- Each bot appends notable events to `bots/diaries/<bot>.md`: first death, level milestones, biggest trade, debts, betrayals, quests.
- `node bots/recap.mjs` turns the last day of diaries, ledger and scores into a short news-style recap; when I'm in a session I write the recap myself, in each bot's voice.
- **Check:** diaries fill in as events happen; the recap covers the day's highlights.

---

## Phase 5: PvP (bounded) *(planned, item 19)*
- Duels at the Duel Arena are the main outlet for rivalries, with optional near-equal stakes; the loser settles the grudge.
- Wilderness fights only for aggressive personalities, only against rivals or willing bots, within ~10 combat levels.
- A kill costs the killer trust with everyone and may get it expelled from its team; friends of the victim post a bounty on the killer.
- Global cap on wilderness fights per in-game day, and a cooldown per bot.
