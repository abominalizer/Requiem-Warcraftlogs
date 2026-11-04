# Requiem Logs

Raid log analysis for **Requiem** (Horde, Tarren Mill EU).

The site reads our raid logs from Warcraft Logs and breaks every pull down, so we can see why we wiped and what to fix.
It only works with Requiem's logs. Reports from other guilds are rejected.

## Home page

- **Progression**: every boss in the current raid at the highest difficulty we've pulled it, with its kill date or our best % and number of pulls. Click a boss to open its progression analysis.
- **Raid nights**: the most recent raid nights, with their length and each boss pulled that night (kill or best %, number of pulls).
- **Open a log**: paste any Requiem Warcraft Logs link to jump straight to it.

## Raid night

All boss pulls of the night, grouped by boss and difficulty. Each pull shows how far we got, the phase reached and how long it lasted.

Tick pulls (from any bosses) and press **Analyze** to look at them together. See *Combined analysis* below.

## Pull

Everything about a single pull:

- **What went wrong**: who died first and to what, deaths before the wipe, deaths caused by avoidable damage, the avoidable abilities that hit the most people, how interrupts were spread, and DPS players well below the raid median.
- **Timeline**: the fight's phases, with a marker for every death.
- **Deaths**: time, player, killing blow and the last hits each player took before dying.
- **Players**: score, DPS, HPS, avoidable hits, interrupts and time of death for every player.
- **Damage taken by ability**: every spell that hit the raid, with hits, players hit and damage. Click a spell to see who got hit.

## Combined analysis

Any selection of pulls, analyzed as one:

- **Deaths by player and spell**: a grid of who died to what, plus how often each player was the first to die. It counts deaths before the wipe, or all deaths if you switch it.
- **Damage taken by player and spell**: how much of each boss spell every player took, shaded so the people taking far more than everyone else stand out.
- **Damage taken by spell**: the boss spells that hurt the most, and who took the most of each.
- **What kills you**: the spells behind deaths before the wipe, and how often each one caused the first death of a pull.
- **Players**: deaths, first deaths, avoidable hits, interrupts, DPS and average score across the selected pulls.

## Boss progression

All pulls on one boss in a night: a chart of how far each pull got, what kills us, avoidable damage, a ranking of players by average score, and the first death of every pull.

## How to read it

- **Pull colours** show how close we were to a kill, the same way Warcraft Logs colours them: grey (under 25% through the fight), green (25%+), blue (50%+), purple (75%+), orange (90%+) and gold for kills.
- **Deaths before the wipe** are the ones that matter. Deaths in the last 20 seconds of a wipe, or after half the raid is already dead, are greyed out and not held against anyone.
- **Avoidable damage** is damage nobody should take (frontals, pools, swirls). The avoidable spells are listed per boss. On a single pull the site also points out damage that looks avoidable, meaning it only hit part of the raid and some players repeatedly. That is marked "possibly avoidable".
- **Score** starts at 100 per pull. A death before the wipe costs 30 points (40 if it was the first death). Each hit from an avoidable spell costs 5 points, up to 40. Each "possibly avoidable" hit costs 1 point, up to 10, and never counts against tanks.
- **Damage taken** only counts damage from enemies. Self-damage, trinkets and friendly fire are left out.

Data comes from the Warcraft Logs API. The site is not affiliated with Warcraft Logs or Blizzard Entertainment.
