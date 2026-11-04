# Requiem Logs

Raid log analysis for **Requiem** (Horde, Tarren Mill EU).

The site reads our raid logs from Warcraft Logs and breaks every pull down, so we can see why we wiped and what to fix.
It only works with Requiem's logs. Reports from other guilds are rejected.

## Home page

- **Progression**: every boss in the current raid at the highest difficulty we've pulled it, with its kill date or our best % and number of pulls. Click a boss to open its progression analysis.
- **Raid nights**: the most recent raid nights, with their length and each boss pulled that night (kill or best %, number of pulls).
- **Open a log**: paste any Requiem Warcraft Logs link to jump straight to it.

## Raid

Every boss of the current raid with the enemy spells that hit us, taken from our best pull of each boss. Officers tick the spells nobody should get hit by (frontals, pools, swirls) and save them with the officer password. Those spells then count as avoidable damage everywhere on the site.

## Raid night

All boss pulls of the night, grouped by boss and difficulty. Each pull shows how far we got, the phase reached and how long it lasted.

Tick pulls (from any bosses) and press **Analyze** to look at them together. See *Combined analysis* below.

## Pull

Everything about a single pull:

- **What went wrong**: who died first and to what, deaths before the wipe, deaths caused by avoidable damage, the avoidable abilities that hit the most people, how interrupts were spread, and DPS players well below the raid median.
- **Timeline**: the fight's phases, with a marker for every death.
- **Deaths**: time, player, killing blow and the last hits each player took before dying.
- **Players**: DPS, HPS, avoidable hits, interrupts and time of death for every player.
- **Damage taken by ability**: every spell that hit the raid, with hits, players hit and damage. Click a spell to see who got hit.

## Combined analysis

Any selection of pulls, analyzed as one:

- **Deaths by player and spell**: a grid of who died to what, plus how often each player was the first to die. It counts deaths before the wipe, or all deaths if you switch it.
- **Damage taken by player and spell**: how much of each boss spell every player took, shaded so the people taking far more than everyone else stand out.
- **Damage taken by spell**: the boss spells that hurt the most, and who took the most of each.
- **What kills you**: the spells behind deaths before the wipe, and how often each one caused the first death of a pull.
- **Players**: deaths, first deaths, avoidable hits, interrupts and DPS across the selected pulls.

## Boss progression

All pulls on one boss in a night: a chart of how far each pull got, what kills us, avoidable damage, a ranking of players by deaths, and the first death of every pull.

## How to read it

- **Pull colours** show how close we were to a kill, the same way Warcraft Logs colours them: grey (under 25% through the fight), green (25%+), blue (50%+), purple (75%+), orange (90%+) and gold for kills.
- **Deaths before the wipe** are the ones that matter. Deaths in the last 20 seconds of a wipe, or after half the raid is already dead, are greyed out and not held against anyone.
- **Avoidable damage** is damage nobody should take (frontals, pools, swirls), as marked per boss on the Raid page. For bosses with nothing marked yet, a single pull also points out damage that looks avoidable, meaning it only hit part of the raid and some players repeatedly. That is marked "possibly avoidable".
- **Damage taken** only counts damage from enemies. Self-damage, trinkets and friendly fire are left out.

Data comes from the Warcraft Logs API. The site is not affiliated with Warcraft Logs or Blizzard Entertainment.
