# Early-2009 leveling plan (bots)

Era-typical training routes as of RuneScape ~January 2009 (the build 2009Scape emulates).
The archived fan-site guides of the time (Tip.It, RuneHQ, Sal's Realm) aren't reachable from
this environment, so this is written from knowledge of that era's standard methods and checked
against what 2009Scape implements. No Grand Exchange flipping, no post-2009 methods.

Rules for all bots: start at level 1 with the tutorial starter kit, earn everything in-game,
power-train (drop) while banking routes aren't scripted yet, rotate skills so nothing lags behind.

## Tier 1: Lumbridge/Draynor starter loop (all skills < 15)

| Skill | Method (2009-era standard) | Where |
|---|---|---|
| Attack/Strength/Defence/HP | Chickens → cows; bury bones | Lumbridge chicken pen, east cow field |
| Prayer | Bury bones from combat | — |
| Ranged | Shortbow + bronze arrows on chickens, pick arrows back up | Chicken pen |
| Magic | Wind Strike on chickens (starter runes) | Chicken pen |
| Woodcutting / Firemaking | Normal trees, burn the logs in place | West of Lumbridge castle |
| Fishing / Cooking | Net shrimp/anchovies, cook on a fire | Draynor or Lumbridge Swamp |
| Mining | Copper/tin, drop ore | Lumbridge Swamp east mine |
| Thieving | Pickpocket men/women (gives coins for later skills) | Lumbridge |

## Tier 2: 15-30

| Skill | Method | Where |
|---|---|---|
| Woodcutting/FM | Oaks (15+), willows (30+) | Lumbridge oaks, Draynor willows |
| Fishing/Cooking | Fly fishing trout/salmon (20+, needs rod + feathers from chickens) | Lumbridge river / Barbarian Village |
| Combat | Cows → goblins/Al-Kharid warriors (toll 10gp) / Barbarians | Lumbridge, Al-Kharid, Barbarian Village |
| Mining/Smithing | Iron (15+) for xp; smelt bronze then iron at Lumbridge/Al-Kharid furnace | Swamp mine, Al-Kharid |
| Crafting | Leather (cowhide → tan at Al-Kharid → gloves/boots/bodies) | Cow field + Ellis in Al-Kharid |
| Fletching | Knife on logs → arrow shafts, later longbows | Anywhere |
| Thieving | Men → farmers (10) → H.A.M. members/master farmers | Lumbridge → Draynor |
| Agility | Gnome Stronghold course (members) | Tree Gnome Stronghold |
| Runecrafting | Rune Mysteries quest → air runes from essence | Falador air altar |

## Tier 3: 30+ (members; mostly for Claude-directed bots)

Barbarian Outpost agility, Draynor/Seers willows→maples, Catherby lobsters,
Ardougne cakes/master farmers, Slayer from Turael/Mazchna, quests for xp rewards
(Waterfall Quest for 1→30 Attack/Strength, Fight Arena, Tree Gnome Village), Herblore after Druidic Ritual.

## How the scripted bots use this

`scripted.mjs` scores each available task by the average level of the skills it trains and runs
the lowest-scoring one for 8-20 minutes before re-picking, so all trainable skills creep up
together. Tasks unlock automatically as the plan above allows (e.g. oaks at 15 Woodcutting,
willows at 30, cows/goblins as combat rises).
