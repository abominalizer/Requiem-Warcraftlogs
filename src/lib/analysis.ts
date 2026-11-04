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
  lastHits: { t: number; ability: Ability; amount: number }[];
}

export interface PlayerStats {
  player: Player;
  damage: number;
  dps: number;
  healing: number;
  hps: number;
  death: DeathView | null;
  avoidableHits: number;
  avoidableDamage: number;
  interrupts: number;
  score: number;
  scoreNotes: string[];
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
  phases: { name: string; start: number; end: number }[];
  raidDps: number;
  raidHps: number;
}

const ab = (d: FightDetail, id: number): Ability => d.abilities[id] ?? { id, name: `Spell ${id}` };

function phaseSegments(d: FightDetail) {
  const dur = d.fight.endTime - d.fight.startTime;
  const tr = [...d.fight.phaseTransitions].sort((a, b) => a.startTime - b.startTime);
  return tr.map((p, i) => ({
    name: d.phases.find((x) => x.id === p.id)?.name ?? `Phase ${p.id}`,
    start: Math.max(0, p.startTime - d.fight.startTime),
    end: i + 1 < tr.length ? tr[i + 1].startTime - d.fight.startTime : dur,
  }));
}

export function analyzeFight(d: FightDetail): FightAnalysis {
  const { fight } = d;
  const dur = Math.max(1, fight.endTime - fight.startTime);
  const secs = dur / 1000;
  const byId = new Map(d.players.map((p) => [p.id, p]));
  const cfg = ENCOUNTERS[fight.encounterId] ?? {};
  const configured = new Set(cfg.avoidable ?? []);
  const ignored = new Set([...(cfg.ignore ?? []), ...GLOBAL_IGNORE]);
  const phases = phaseSegments(d);
  const phaseAt = (t: number) => phases.findLast((p) => p.start <= t)?.name ?? null;

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
    else if (!ignored.has(id) && nonTanks.length >= 5) {
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
        phase: phaseAt(t),
        lastHits: hitsBefore.slice(-4).map((e) => ({ t: e.t - fight.startTime, ability: ab(d, e.abilityId), amount: e.amount })),
      },
    ];
  });
  const deathOf = new Map(deaths.map((x) => [x.player.id, x]));

  // ---- players
  const sum = (arr: { playerId: number; total: number }[]) => new Map(arr.map((x) => [x.playerId, x.total]));
  const dmg = sum(d.damageDone);
  const heal = sum(d.healing);
  const kicks = new Map<number, number>();
  for (const i of d.interrupts) kicks.set(i.sourceId, (kicks.get(i.sourceId) ?? 0) + 1);

  const players: PlayerStats[] = d.players.map((p) => {
    let avoidableHits = 0;
    let avoidableDamage = 0;
    let configuredHits = 0;
    for (const a of abilities) {
      if (!a.avoidable) continue;
      // guesses don't count against tanks: they take a lot of targeted damage by design
      if (a.avoidable === "heuristic" && p.role === "tank") continue;
      const pp = a.perPlayer.find((x) => x.playerId === p.id);
      if (pp) {
        avoidableHits += pp.hits;
        avoidableDamage += pp.total;
        if (a.avoidable === "configured") configuredHits += pp.hits;
      }
    }
    const death = deathOf.get(p.id) ?? null;
    const notes: string[] = [];
    let score = 100;
    if (death && !death.inWipe) {
      const pen = death.first ? 40 : 30;
      score -= pen;
      notes.push(`-${pen} died at ${fmtTime(death.t)}${death.first ? " (first death)" : ""}`);
    }
    // Hits on abilities you configured as avoidable cost 5 each; heuristic guesses only 1 each.
    if (configuredHits) {
      const pen = Math.min(40, configuredHits * 5);
      score -= pen;
      notes.push(`-${pen} ${configuredHits} avoidable hit${configuredHits > 1 ? "s" : ""}`);
    }
    const guessHits = avoidableHits - configuredHits;
    if (guessHits) {
      const pen = Math.min(10, guessHits);
      score -= pen;
      notes.push(`-${pen} ${guessHits} possibly-avoidable hit${guessHits > 1 ? "s" : ""}`);
    }
    return {
      player: p,
      damage: dmg.get(p.id) ?? 0,
      dps: (dmg.get(p.id) ?? 0) / secs,
      healing: heal.get(p.id) ?? 0,
      hps: (heal.get(p.id) ?? 0) / secs,
      death,
      avoidableHits,
      avoidableDamage,
      interrupts: kicks.get(p.id) ?? 0,
      score: Math.max(0, score),
      scoreNotes: notes,
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
  const alive = players.filter((p) => p.player.role === "dps" && (!p.death || p.death.inWipe));
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
    avgScore: number;
  }[];
  deathCauses: { ability: Ability; count: number; first: number }[];
  avoidable: { ability: Ability; hits: number; damage: number; pulls: number; kind: AvoidableKind }[];
}

export function analyzeProgression(pulls: FightAnalysis[]): ProgressionAnalysis {
  const players = new Map<number, ProgressionAnalysis["players"][number] & { dpsSum: number; scoreSum: number }>();
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
        avgScore: 0,
        dpsSum: 0,
        scoreSum: 0,
      };
      e.pulls++;
      if (s.death && !s.death.inWipe) e.deaths++;
      if (s.death?.first) e.firstDeaths++;
      e.avoidableHits += s.avoidableHits;
      e.interrupts += s.interrupts;
      e.dpsSum += s.dps;
      e.scoreSum += s.score;
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
      .map(({ dpsSum, scoreSum, ...e }) => ({ ...e, avgDps: dpsSum / e.pulls, avgScore: scoreSum / e.pulls }))
      .sort((a, b) => a.avgScore - b.avgScore),
    deathCauses: [...causes.values()].sort((a, b) => b.count - a.count),
    avoidable: [...avoid.values()].sort((a, b) => b.hits - a.hits),
  };
}

