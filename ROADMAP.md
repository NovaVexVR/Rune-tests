# Roadmap

What's planned for the bot world, in build order. Each item lists what it does, how it fits the
existing code, and how it's checked in-game before it counts as done.

**Already built:** bot API, 60 bots (10 scripted, 10 individualists, four 5-bot teams, one 20-bot
legion), shops and banking, per-bot perceived prices, team treasurers, personalities, trust, and
favors/IOUs (`bots/social.mjs`, report with `node bots/social_report.mjs`).

---

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

## Phase 4: Gatherings and stories

### 4.1 Market days
- Once per in-game day, bots with spare goods walk to the Lumbridge courtyard for a 20-minute market.
- Sellers "shout" offers in chat at their asking prices; buyers make counter-offers; deals still use the normal trade flow and personality-based acceptance, so haggling is real.
- **Check:** at market time, a crowd forms, offers appear in chat, trades complete at prices between ask and bid.

### 4.2 Quest parties
- Bots form small parties for quests, with roles: the fighter escorts and kills, others gather items.
- First quests (all near Lumbridge, from the wiki guides):
  - **Cook's Assistant:** egg, bucket of milk, pot of flour. Unlocks the Lumbridge range.
  - **The Knight's Sword:** Smithing 1 → 29.
  - **Druidic Ritual:** unlocks Herblore.
- Each quest is a script of steps (walk, talk with dialog choices, gather, hand in); quest rewards count toward the team scoreboard.
- **Check:** a party completes Cook's Assistant and the bots' quest points and Cooking XP update.

### 4.3 Diaries and recaps
- Each bot appends notable events to `bots/diaries/<bot>.md`: first death, level milestones, biggest trade, debts, betrayals, quests.
- `node bots/recap.mjs` turns the last day of diaries, ledger and scores into a short news-style recap; when I'm in a session I write the recap myself, in each bot's voice.
- **Check:** diaries fill in as events happen; the recap covers the day's highlights.

---

## Also planned (from earlier)
- **Grand Exchange:** bot API support for the GE offer screen, so bots can buy and sell there; prices form from bot offers.
- **More training:** fly fishing, iron mining, smithing, leather crafting, oak/willow bows, agility, as the guides recommend.
- **Run locally:** single cross-platform launcher (Windows and CachyOS).
