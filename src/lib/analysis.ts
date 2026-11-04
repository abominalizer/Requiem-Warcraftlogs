import { CLASS_DEFENSIVES, USED_WINDOW_S } from "@/config/defensives";
import { ENCOUNTERS, GLOBAL_IGNORE } from "@/config/encounters";
import { fmtNum, fmtTime } from "./format";
import type { Ability, FightDetail, Player } from "./types";

export type AvoidableKind = "configured" | "heuristic" | null;

export interface AbilityDamage {
  ability: Ability;
  total: number;
  hits: number;
  playersHit: number;
  avoidable: AvoidableKind;
  perPlayer: { playerId: number; hits: number; total: number }[];
}

export interface DeathView {
  player: Player;
  t: number; // ms into the fight
  ability: Ability | null;
  inWipe: boolean; // part of the end-of-pull cascade: not blamed
  first: boolean;
  phase: string | null;
  phaseId: number | null;
  lastHits: { t: number; ability: Ability; amount: number }[];
  /** Defensive check (null when no defensive data was loaded). */
  defensives: DefensiveCheck | null;
}

export type DefensiveStatus = "used" | "cooldown" | "ready" | "unknown";

export interface DefensiveCheck {
  /** the player's defensives and consumables at the moment of death */
  spells: {
    key: string;
    kind: "personal" | "consumable";
    status: DefensiveStatus;
    agoS?: number;
    /** seconds until off cooldown (undefined for once-per-pull consumables) */
    readyInS?: number;
    /** what put it on cooldown, when it wasn't the spell itself (e.g. "Potion of Recklessness") */
    via?: string;
  }[];
  /** externals cast on the player shortly before death */
  externals: { key: string; from: Player | null; agoS: number }[];
  /** defensives they had ready but didn't press */
  readyUnused: string[];
  /** pressed nothing (no defensive in the last seconds, no external received) while something was ready */
  pressedNothing: boolean;
}

export interface PlayerStats {
  player: Player;
  damage: number;
  dps: number;
  healing: number;
  hps: number;
  /** All of this player's deaths in the pull, in order (more than one after a battle res). */
  deaths: DeathView[];
  avoidableHits: number;
  avoidableDamage: number;
  interrupts: number;
}

export interface Insight {
  severity: "bad" | "warn" | "info" | "good";
  title: string;
  detail?: string;
}

export interface FightAnalysis {
  detail: FightDetail;
  durationMs: number;
  players: PlayerStats[];
  abilities: AbilityDamage[];
  deaths: DeathView[];
  insights: Insight[];
  phases: { id: number; name: string; isIntermission: boolean; start: number; end: number }[];
  raidDps: number;
  raidHps: number;
}

const ab = (d: FightDetail, id: number): Ability => d.abilities[id] ?? { id, name: `Spell ${id}` };

function phaseSegments(d: FightDetail) {
  const dur = d.fight.endTime - d.fight.startTime;
  const tr = [...d.fight.phaseTransitions].sort((a, b) => a.startTime - b.startTime);
  return tr.map((p, i) => ({
    id: p.id,
    name: d.phases.find((x) => x.id === p.id)?.name ?? `Phase ${p.id}`,
    isIntermission: d.phases.find((x) => x.id === p.id)?.isIntermission ?? false,
    start: Math.max(0, p.startTime - d.fight.startTime),
    end: i + 1 < tr.length ? tr[i + 1].startTime - d.fight.startTime : dur,
  }));
}

/**
 * At the moment `player` died (report time `at`): for each defensive / consumable they used at least once tonight,
 * was it pressed just before, on cooldown from earlier in this pull, or ready and not pressed?
 * Cooldowns only count within the pull (long cooldowns reset when a pull starts).
 */
function checkDefensives(d: FightDetail, player: Player, at: number): DefensiveCheck | null {
  const def = d.defensives;
  if (!def) return null;
  const known = new Set(def.known[player.id] ?? []);
  const classSpells = (CLASS_DEFENSIVES[player.className] ?? []).map((s) => s.name);
  const keys = [
    ...new Set([...classSpells.filter((k) => def.spells[k]), ...[...known].filter((k) => def.spells[k]?.kind === "consumable")]),
  ];
  const byPlayer = def.casts.filter((c) => c.sourceId === player.id && c.t <= at);
  const spells: DefensiveCheck["spells"] = [];
  for (const key of keys) {
    const info = def.spells[key];
    if (!info || info.kind === "external") continue;
    // casts that put this on cooldown: the spell itself, or anything sharing its cooldown (all potions)
    const last = byPlayer.filter((c) => c.key === key || (info.group && c.group === info.group)).at(-1);
    const sinceS = last ? (at - last.t) / 1000 : null;
    let status: DefensiveStatus;
    if (sinceS != null && sinceS <= USED_WINDOW_S && last!.key === key) status = "used";
    else if (sinceS != null && (info.oncePerPull || sinceS < info.cd)) status = "cooldown";
    else if (known.has(key)) status = "ready";
    else status = "unknown"; // never cast tonight: maybe not talented / no stone
    spells.push({
      key,
      kind: info.kind,
      status,
      agoS: sinceS != null ? Math.round(sinceS) : undefined,
      readyInS: status === "cooldown" && !info.oncePerPull ? Math.round(info.cd - sinceS!) : undefined,
      via: status === "cooldown" && last && last.key !== key ? last.spell : undefined,
    });
  }
  const byId = new Map(d.players.map((p) => [p.id, p]));
  const externals = def.casts
    .filter((c) => def.spells[c.key]?.kind === "external" && c.targetId === player.id && c.t <= at && at - c.t <= USED_WINDOW_S * 1000)
    .map((c) => ({ key: c.key, from: byId.get(c.sourceId) ?? null, agoS: Math.round((at - c.t) / 1000) }));
  const order: Record<DefensiveStatus, number> = { ready: 0, used: 1, cooldown: 2, unknown: 3 };
  spells.sort((a, b) => order[a.status] - order[b.status]);
  const readyUnused = spells.filter((s) => s.status === "ready").map((s) => s.key);
  const pressedNothing = readyUnused.length > 0 && !spells.some((s) => s.status === "used") && externals.length === 0;
  return { spells, externals, readyUnused, pressedNothing };
}

export function analyzeFight(d: FightDetail): FightAnalysis {
  const { fight } = d;
  const dur = Math.max(1, fight.endTime - fight.startTime);
  const secs = dur / 1000;
  const byId = new Map(d.players.map((p) => [p.id, p]));
  const cfg = ENCOUNTERS[fight.encounterId] ?? {};
  const configured = new Set(d.avoidableIds ?? cfg.avoidable ?? []);
  const ignored = new Set([...(cfg.ignore ?? []), ...GLOBAL_IGNORE]);
  const phases = phaseSegments(d);
  const phaseAt = (t: number) => phases.findLast((p) => p.start <= t) ?? null;

  // ---- damage taken by ability
  const abilityMap = new Map<number, Map<number, { hits: number; total: number }>>();
  for (const e of d.damageTaken) {
    let m = abilityMap.get(e.abilityId);
    if (!m) abilityMap.set(e.abilityId, (m = new Map()));
    const pp = m.get(e.targetId) ?? { hits: 0, total: 0 };
    pp.hits++;
    pp.total += e.amount;
    m.set(e.targetId, pp);
  }
  const nonTanks = d.players.filter((p) => p.role !== "tank");
  const abilities: AbilityDamage[] = [...abilityMap].map(([id, m]) => {
    const perPlayer = [...m].map(([playerId, v]) => ({ playerId, ...v })).sort((a, b) => b.hits - a.hits);
    const hits = perPlayer.reduce((s, p) => s + p.hits, 0);
    const nonTankHit = perPlayer.filter((p) => byId.get(p.playerId)?.role !== "tank");
    let avoidable: AvoidableKind = null;
    if (d.knownAvoidable) avoidable = d.knownAvoidable[id] ?? null;
    else if (configured.has(id)) avoidable = "configured";
    else if (configured.size === 0 && !ignored.has(id) && nonTanks.length >= 5) {
      // only guess for bosses nobody has marked avoidable spells for yet
      // Heuristic: damage that only some of the raid takes, and some of them more than once,
      // tends to be "stood in it" damage. Shown as "possibly avoidable".
      const share = nonTankHit.length / nonTanks.length;
      const repeat = nonTankHit.some((p) => p.hits >= 2);
      const nonTankHits = nonTankHit.reduce((s, p) => s + p.hits, 0);
      if (share > 0 && share <= 0.4 && repeat && nonTankHits >= 3) avoidable = "heuristic";
    }
    return {
      ability: ab(d, id),
      total: perPlayer.reduce((s, p) => s + p.total, 0),
      hits,
      playersHit: perPlayer.length,
      avoidable,
      perPlayer,
    };
  });
  abilities.sort((a, b) => b.total - a.total);
  const avoidableIds = new Set(abilities.filter((a) => a.avoidable).map((a) => a.ability.id));

  // ---- deaths
  const sortedDeaths = [...d.deaths].sort((a, b) => a.t - b.t);
  const raidSize = d.players.length || 1;
  const deaths: DeathView[] = sortedDeaths.flatMap((x, i) => {
    const player = byId.get(x.playerId);
    if (!player) return [];
    const t = x.t - fight.startTime;
    const hitsBefore = d.damageTaken.filter((e) => e.targetId === x.playerId && e.t <= x.t + 50 && e.t >= x.t - 5000);
    const killing = x.killingAbilityId ?? hitsBefore.at(-1)?.abilityId ?? null;
    const inWipe = !fight.kill && (t > dur - 20_000 || i >= Math.ceil(raidSize * 0.5));
    return [
      {
        player,
        t,
        ability: killing != null ? ab(d, killing) : null,
        inWipe,
        first: i === 0,
        phase: phaseAt(t)?.name ?? null,
        phaseId: phaseAt(t)?.id ?? null,
        defensives: checkDefensives(d, player, x.t),
        lastHits: hitsBefore.slice(-4).map((e) => ({ t: e.t - fight.startTime, ability: ab(d, e.abilityId), amount: e.amount })),
      },
    ];
  });
  const deathsOf = new Map<number, DeathView[]>();
  for (const x of deaths) deathsOf.set(x.player.id, [...(deathsOf.get(x.player.id) ?? []), x]);

  // ---- players
  const sum = (arr: { playerId: number; total: number }[]) => new Map(arr.map((x) => [x.playerId, x.total]));
  const dmg = sum(d.damageDone);
  const heal = sum(d.healing);
  const kicks = new Map<number, number>();
  for (const i of d.interrupts) kicks.set(i.sourceId, (kicks.get(i.sourceId) ?? 0) + 1);

  const players: PlayerStats[] = d.players.map((p) => {
    let avoidableHits = 0;
    let avoidableDamage = 0;
    for (const a of abilities) {
      if (!a.avoidable) continue;
      // guesses don't count against tanks: they take a lot of targeted damage by design
      if (a.avoidable === "heuristic" && p.role === "tank") continue;
      const pp = a.perPlayer.find((x) => x.playerId === p.id);
      if (pp) {
        avoidableHits += pp.hits;
        avoidableDamage += pp.total;
      }
    }
    const playerDeaths = deathsOf.get(p.id) ?? [];
    return {
      player: p,
      damage: dmg.get(p.id) ?? 0,
      dps: (dmg.get(p.id) ?? 0) / secs,
      healing: heal.get(p.id) ?? 0,
      hps: (heal.get(p.id) ?? 0) / secs,
      deaths: playerDeaths,
      avoidableHits,
      avoidableDamage,
      interrupts: kicks.get(p.id) ?? 0,
    };
  });

  const raidDps = players.reduce((s, p) => s + p.dps, 0);
  const raidHps = players.reduce((s, p) => s + p.hps, 0);

  return {
    detail: d,
    durationMs: dur,
    players,
    abilities,
    deaths,
    phases,
    raidDps,
    raidHps,
    insights: buildInsights(d, players, abilities, deaths, avoidableIds),
  };
}

function buildInsights(
  d: FightDetail,
  players: PlayerStats[],
  abilities: AbilityDamage[],
  deaths: DeathView[],
  avoidableIds: Set<number>,
): Insight[] {
  const out: Insight[] = [];
  const blamed = deaths.filter((x) => !x.inWipe);

  if (deaths.length === 0) out.push({ severity: "good", title: "No deaths this pull." });
  if (deaths[0]) {
    const f = deaths[0];
    out.push({
      severity: f.inWipe ? "info" : "bad",
      title: `${f.player.name} died first at ${fmtTime(f.t)}${f.ability ? ` to ${f.ability.name}` : ""}.`,
      detail: f.phase ?? undefined,
    });
  }
  if (blamed.length > 1)
    out.push({
      severity: "bad",
      title: `${blamed.length} deaths before the wipe/kill.`,
      detail: blamed.map((x) => `${x.player.name} (${fmtTime(x.t)}, ${x.ability?.name ?? "?"})`).join(", "),
    });
  const toAvoidable = blamed.filter((x) => x.ability && avoidableIds.has(x.ability.id));
  if (toAvoidable.length)
    out.push({
      severity: "bad",
      title: `${toAvoidable.length} death${toAvoidable.length > 1 ? "s" : ""} caused by avoidable damage.`,
      detail: toAvoidable.map((x) => `${x.player.name}: ${x.ability!.name}`).join(", "),
    });

  const withReady = blamed.filter((x) => x.defensives?.pressedNothing);
  if (withReady.length)
    out.push({
      severity: "bad",
      title: `${withReady.length} death${withReady.length > 1 ? "s" : ""} without pressing anything while a defensive was ready.`,
      detail: withReady.map((x) => `${x.player.name} (${fmtTime(x.t)}): ${x.defensives!.readyUnused.join(", ")}`).join("; "),
    });

  for (const a of abilities.filter((x) => x.avoidable).slice(0, 3)) {
    const worst = a.perPlayer
      .slice(0, 3)
      .map((p) => `${players.find((x) => x.player.id === p.playerId)?.player.name ?? p.playerId} ×${p.hits}`)
      .join(", ");
    out.push({
      severity: a.avoidable === "configured" ? "warn" : "info",
      title: `${a.ability.name} hit ${a.playersHit} player${a.playersHit > 1 ? "s" : ""} ${a.hits} times (${fmtNum(a.total)} damage)${a.avoidable === "heuristic" ? " — possibly avoidable" : ""}.`,
      detail: `Most hits: ${worst}`,
    });
  }

  const totalKicks = players.reduce((s, p) => s + p.interrupts, 0);
  if (totalKicks > 0) {
    const kickers = players.filter((p) => p.interrupts > 0).sort((a, b) => b.interrupts - a.interrupts);
    const top = kickers[0];
    out.push({
      severity: kickers.length <= 2 && totalKicks >= 6 ? "warn" : "info",
      title: `${totalKicks} interrupts by ${kickers.length} player${kickers.length > 1 ? "s" : ""}; ${top.player.name} did ${top.interrupts}.`,
      detail: kickers.length <= 2 && totalKicks >= 6 ? "Interrupt duty rests on very few players." : undefined,
    });
  }

  // Under-performing DPS (ignoring people who died)
  const alive = players.filter((p) => p.player.role === "dps" && p.deaths.every((x) => x.inWipe));
  if (alive.length >= 4) {
    const sorted = alive.map((p) => p.dps).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const low = alive.filter((p) => p.dps < median * 0.65);
    if (low.length)
      out.push({
        severity: "info",
        title: `${low.length} DPS player${low.length > 1 ? "s" : ""} well below the raid median (${fmtNum(median)} DPS).`,
        detail: low.map((p) => `${p.player.name}: ${fmtNum(p.dps)}`).join(", "),
      });
  }
  return out;
}

// ---------------------------------------------------------------- progression (all pulls of a boss)

export interface ProgressionAnalysis {
  pulls: FightAnalysis[];
  players: {
    player: Player;
    pulls: number;
    deaths: number;
    firstDeaths: number;
    avoidableHits: number;
    interrupts: number;
    avgDps: number;
    /** deaths before the wipe where nothing was pressed while a defensive was ready (null = no defensive data) */
    readyDeaths: number | null;
  }[];
  deathCauses: { ability: Ability; count: number; first: number }[];
  avoidable: { ability: Ability; hits: number; damage: number; pulls: number; kind: AvoidableKind }[];
}

export function analyzeProgression(pulls: FightAnalysis[]): ProgressionAnalysis {
  const players = new Map<number, ProgressionAnalysis["players"][number] & { dpsSum: number }>();
  const causes = new Map<number, { ability: Ability; count: number; first: number }>();
  const avoid = new Map<number, ProgressionAnalysis["avoidable"][number]>();

  for (const pull of pulls) {
    for (const s of pull.players) {
      const e = players.get(s.player.id) ?? {
        player: s.player,
        pulls: 0,
        deaths: 0,
        firstDeaths: 0,
        avoidableHits: 0,
        interrupts: 0,
        avgDps: 0,
        readyDeaths: pull.detail.defensives ? 0 : null,
        dpsSum: 0,
      };
      e.pulls++;
      if (pull.detail.defensives) {
        e.readyDeaths = (e.readyDeaths ?? 0) + s.deaths.filter((x) => !x.inWipe && x.defensives?.pressedNothing).length;
      }
      e.deaths += s.deaths.filter((x) => !x.inWipe).length;
      if (s.deaths.some((x) => x.first)) e.firstDeaths++;
      e.avoidableHits += s.avoidableHits;
      e.interrupts += s.interrupts;
      e.dpsSum += s.dps;
      players.set(s.player.id, e);
    }
    for (const dth of pull.deaths) {
      if (dth.inWipe || !dth.ability) continue;
      const c = causes.get(dth.ability.id) ?? { ability: dth.ability, count: 0, first: 0 };
      c.count++;
      if (dth.first) c.first++;
      causes.set(dth.ability.id, c);
    }
    for (const a of pull.abilities) {
      if (!a.avoidable) continue;
      const v = avoid.get(a.ability.id) ?? { ability: a.ability, hits: 0, damage: 0, pulls: 0, kind: a.avoidable };
      v.hits += a.hits;
      v.damage += a.total;
      v.pulls++;
      if (a.avoidable === "configured") v.kind = "configured";
      avoid.set(a.ability.id, v);
    }
  }

  return {
    pulls,
    players: [...players.values()]
      .map(({ dpsSum, ...e }) => ({ ...e, avgDps: dpsSum / e.pulls }))
      .sort((a, b) => b.deaths - a.deaths || b.firstDeaths - a.firstDeaths || b.avoidableHits - a.avoidableHits),
    deathCauses: [...causes.values()].sort((a, b) => b.count - a.count),
    avoidable: [...avoid.values()].sort((a, b) => b.hits - a.hits),
  };
}

// ---------------------------------------------------------------- phase breakdown

export interface PhaseRow {
  id: number;
  name: string;
  isIntermission: boolean;
  /** pulls that got to this phase */
  reached: number;
  /** wipes that ended in this phase */
  wipes: FightAnalysis[];
  avgReachMs: number | null;
  fastestReachMs: number | null;
  /** deaths before the wipe that happened in this phase */
  deaths: number;
  topSpells: { ability: Ability; count: number }[];
  topPlayers: { player: Player; count: number }[];
}

export interface BossPhaseBreakdown {
  encounterId: number;
  name: string;
  pulls: FightAnalysis[];
  kills: FightAnalysis[];
  phases: PhaseRow[];
  /** the first two deaths (outside the wipe) of every wiped pull */
  wipeStarters: {
    spells: { ability: Ability; count: number; firsts: number }[];
    players: { player: Player; count: number; firsts: number }[];
    pulls: { pull: FightAnalysis; deaths: DeathView[] }[];
  };
}

const top = <K, V extends { count: number }>(m: Map<K, V>, n: number) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);

/** Where pulls wipe, what kills people in each phase, and which deaths start the wipes. One entry per boss. */
export function phaseBreakdown(pulls: FightAnalysis[]): BossPhaseBreakdown[] {
  const byBoss = new Map<number, FightAnalysis[]>();
  for (const p of pulls) byBoss.set(p.detail.fight.encounterId, [...(byBoss.get(p.detail.fight.encounterId) ?? []), p]);

  return [...byBoss.values()].map((bp) => {
    const meta = bp.find((p) => p.detail.phases.length)?.detail.phases ?? [];
    const rows = new Map<number, PhaseRow>();
    const row = (id: number, name?: string, isIntermission = false) => {
      if (!rows.has(id)) {
        const m = meta.find((x) => x.id === id);
        rows.set(id, {
          id,
          name: m?.name ?? name ?? `Phase ${id}`,
          isIntermission: m?.isIntermission ?? isIntermission,
          reached: 0,
          wipes: [],
          avgReachMs: null,
          fastestReachMs: null,
          deaths: 0,
          topSpells: [],
          topPlayers: [],
        });
      }
      return rows.get(id)!;
    };
    const reach = new Map<number, number[]>();
    const spellCount = new Map<number, Map<number, { ability: Ability; count: number }>>();
    const playerCount = new Map<number, Map<number, { player: Player; count: number }>>();

    for (const p of bp) {
      const segs = p.phases.length ? p.phases : [{ id: p.detail.fight.lastPhase ?? 1, name: "", isIntermission: false, start: 0, end: p.durationMs }];
      const seen = new Set<number>();
      for (const sg of segs) {
        if (seen.has(sg.id)) continue; // phases that repeat count once per pull
        seen.add(sg.id);
        const r = row(sg.id, sg.name || undefined, sg.isIntermission);
        r.reached++;
        reach.set(sg.id, [...(reach.get(sg.id) ?? []), sg.start]);
      }
      if (!p.detail.fight.kill) row(segs[segs.length - 1].id).wipes.push(p);
      for (const dth of p.deaths) {
        if (dth.inWipe || dth.phaseId == null) continue;
        row(dth.phaseId).deaths++;
        const sc = spellCount.get(dth.phaseId) ?? new Map();
        const a = dth.ability ?? { id: 0, name: "Unknown" };
        sc.set(a.id, { ability: a, count: (sc.get(a.id)?.count ?? 0) + 1 });
        spellCount.set(dth.phaseId, sc);
        const pc = playerCount.get(dth.phaseId) ?? new Map();
        pc.set(dth.player.id, { player: dth.player, count: (pc.get(dth.player.id)?.count ?? 0) + 1 });
        playerCount.set(dth.phaseId, pc);
      }
    }
    for (const r of rows.values()) {
      const times = (reach.get(r.id) ?? []).filter((t) => t > 0);
      r.avgReachMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
      r.fastestReachMs = times.length ? Math.min(...times) : null;
      r.topSpells = top(spellCount.get(r.id) ?? new Map(), 3);
      r.topPlayers = top(playerCount.get(r.id) ?? new Map(), 3);
    }
    const order = (id: number) => {
      const i = meta.findIndex((m) => m.id === id);
      return i >= 0 ? i : 100 + id;
    };

    // wipe starters
    const ss = new Map<number, { ability: Ability; count: number; firsts: number }>();
    const ps = new Map<number, { player: Player; count: number; firsts: number }>();
    const starterPulls: BossPhaseBreakdown["wipeStarters"]["pulls"] = [];
    for (const p of bp) {
      if (p.detail.fight.kill) continue;
      const starters = p.deaths.filter((x) => !x.inWipe).slice(0, 2);
      if (!starters.length) continue;
      starterPulls.push({ pull: p, deaths: starters });
      starters.forEach((x, i) => {
        const a = x.ability ?? { id: 0, name: "Unknown" };
        const s1 = ss.get(a.id) ?? { ability: a, count: 0, firsts: 0 };
        s1.count++;
        if (i === 0) s1.firsts++;
        ss.set(a.id, s1);
        const p1 = ps.get(x.player.id) ?? { player: x.player, count: 0, firsts: 0 };
        p1.count++;
        if (i === 0) p1.firsts++;
        ps.set(x.player.id, p1);
      });
    }

    return {
      encounterId: bp[0].detail.fight.encounterId,
      name: bp[0].detail.fight.name,
      pulls: bp,
      kills: bp.filter((p) => p.detail.fight.kill),
      phases: [...rows.values()].sort((a, b) => order(a.id) - order(b.id)),
      wipeStarters: {
        spells: [...ss.values()].sort((a, b) => b.count - a.count || b.firsts - a.firsts),
        players: [...ps.values()].sort((a, b) => b.count - a.count || b.firsts - a.firsts),
        pulls: starterPulls,
      },
    };
  });
}
