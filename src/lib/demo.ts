// Deterministic fake data so the UI can be explored without API keys: open /report/demo
import type { Ability, DamageEvent, DeathRecord, Fight, FightDetail, InterruptEvent, Player, ReportSummary } from "./types";

const ROSTER: [string, string, string, Player["role"]][] = [
  ["Ironhide", "Warrior", "Protection", "tank"],
  ["Bramblepaw", "Druid", "Guardian", "tank"],
  ["Lumisha", "Priest", "Holy", "healer"],
  ["Tidewhisper", "Shaman", "Restoration", "healer"],
  ["Mistvale", "Monk", "Mistweaver", "healer"],
  ["Emberwing", "Evoker", "Preservation", "healer"],
  ["Frostnail", "DeathKnight", "Frost", "dps"],
  ["Kaelstrom", "Mage", "Fire", "dps"],
  ["Vexthorn", "Warlock", "Destruction", "dps"],
  ["Shadeglint", "Rogue", "Outlaw", "dps"],
  ["Arrowfen", "Hunter", "Marksmanship", "dps"],
  ["Bolthorn", "Shaman", "Elemental", "dps"],
  ["Dawnhammer", "Paladin", "Retribution", "dps"],
  ["Felrazor", "DemonHunter", "Havoc", "dps"],
  ["Moonquill", "Druid", "Balance", "dps"],
  ["Gravemoss", "DeathKnight", "Unholy", "dps"],
  ["Pyrelle", "Mage", "Frost", "dps"],
  ["Stormfist", "Monk", "Windwalker", "dps"],
  ["Hexley", "Priest", "Shadow", "dps"],
  ["Scaleshot", "Evoker", "Devastation", "dps"],
];
const PLAYERS: Player[] = ROSTER.map(([name, className, spec, role], i) => ({ id: i + 1, name, className, spec, role }));
// how often a player fails mechanics (0..1)
const CARELESS: Record<number, number> = { 8: 0.5, 13: 0.45, 17: 0.35, 11: 0.2 };

const AB = {
  melee: { id: 1, name: "Melee" },
  slam: { id: 900001, name: "Shattering Slam" },
  pool: { id: 900002, name: "Molten Pool" },
  pulse: { id: 900003, name: "Searing Pulse" },
  crush: { id: 900004, name: "Crushing Blow" },
  bolt: { id: 900005, name: "Void Bolt" },
  brand: { id: 900006, name: "Ember Brand" },
  kick: { id: 900010, name: "Interrupt" },
} satisfies Record<string, Ability>;

const BOSS_A = 990001;
const BOSS_B = 990002;
const PULLS: { enc: number; name: string; dur: number; pct: number; kill?: boolean; phase: number }[] = [
  { enc: BOSS_A, name: "Gloomforged Colossus", dur: 95, pct: 78.4, phase: 1 },
  { enc: BOSS_A, name: "Gloomforged Colossus", dur: 162, pct: 55.1, phase: 1 },
  { enc: BOSS_A, name: "Gloomforged Colossus", dur: 61, pct: 88.9, phase: 1 },
  { enc: BOSS_A, name: "Gloomforged Colossus", dur: 241, pct: 31.7, phase: 2 },
  { enc: BOSS_A, name: "Gloomforged Colossus", dur: 288, pct: 12.3, phase: 2 },
  { enc: BOSS_A, name: "Gloomforged Colossus", dur: 334, pct: 0, kill: true, phase: 2 },
  { enc: BOSS_B, name: "Queen Veyzira", dur: 140, pct: 64.0, phase: 1 },
  { enc: BOSS_B, name: "Queen Veyzira", dur: 205, pct: 41.2, phase: 2 },
  { enc: BOSS_B, name: "Queen Veyzira", dur: 260, pct: 22.8, phase: 2 },
];

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0xffffff) / 0x1000000;
  };
}

function buildFights(): Fight[] {
  let t = 60_000;
  return PULLS.map((p, i) => {
    const f: Fight = {
      id: i + 1,
      encounterId: p.enc,
      name: p.name,
      kill: Boolean(p.kill),
      startTime: t,
      endTime: t + p.dur * 1000,
      difficulty: 5,
      size: 20,
      bossPercentage: p.pct,
      fightPercentage: p.kill ? 0 : p.phase === 2 ? p.pct / 2 : 50 + p.pct / 2,
      lastPhase: p.phase,
      lastPhaseIsIntermission: false,
      phaseTransitions: p.phase === 2 ? [{ id: 1, startTime: t }, { id: 2, startTime: t + 150_000 }] : [{ id: 1, startTime: t }],
    };
    t = f.endTime + 90_000;
    return f;
  });
}

export function demoReport(): ReportSummary {
  return {
    code: "demo",
    title: "Demo raid night (sample data)",
    startTime: Date.UTC(2026, 9, 28, 19, 0),
    endTime: Date.UTC(2026, 9, 28, 22, 0),
    zone: "Demo Raid",
    owner: "demo",
    guild: { name: "Example Guild", server: "Demo Realm", region: "eu" },
    phases: {
      [BOSS_A]: [
        { id: 1, name: "Stage One: Awakening", isIntermission: false },
        { id: 2, name: "Stage Two: Meltdown", isIntermission: false },
      ],
      [BOSS_B]: [
        { id: 1, name: "Stage One: Court", isIntermission: false },
        { id: 2, name: "Stage Two: Void", isIntermission: false },
      ],
    },
    fights: buildFights(),
  };
}

export function demoFight(fightId: number): FightDetail {
  const report = demoReport();
  const fight = report.fights.find((f) => f.id === fightId);
  if (!fight) throw new Error(`Fight ${fightId} not found in demo report.`);
  const r = rng(fightId * 7 + 3);
  const dur = fight.endTime - fight.startTime;
  const dmg: DamageEvent[] = [];
  const hit = (t: number, p: Player, ab: Ability, amount: number) =>
    dmg.push({ t: fight.startTime + t, targetId: p.id, sourceId: 100, abilityId: ab.id, amount: Math.round(amount), overkill: 0 });

  const dps = PLAYERS.filter((p) => p.role !== "tank");
  for (let t = 0; t < dur; t += 1000) {
    // tanks get meleed, crushed occasionally
    for (const tank of PLAYERS.filter((p) => p.role === "tank")) {
      if (r() < 0.6) hit(t, tank, AB.melee, 180_000 + r() * 60_000);
      if (t % 20_000 === 0 && r() < 0.6) hit(t, tank, AB.crush, 900_000 + r() * 200_000);
    }
    // raid-wide pulse every 25s
    if (t % 25_000 === 12_000) for (const p of PLAYERS) hit(t, p, AB.pulse, 350_000 + r() * 50_000);
    // avoidable: slam every 30s, pools every 15s -- careless players get hit
    if (t % 30_000 === 20_000)
      for (const p of dps) if (r() < (CARELESS[p.id] ?? 0.04)) hit(t, p, AB.slam, 1_100_000 + r() * 200_000);
    if (t % 15_000 === 7_000)
      for (const p of dps) if (r() < (CARELESS[p.id] ?? 0.03) * 0.8) hit(t, p, AB.pool, 420_000 + r() * 100_000);
    // targeted debuff on 3 random players every 40s (not avoidable)
    if (t % 40_000 === 33_000) for (let k = 0; k < 3; k++) hit(t, dps[Math.floor(r() * dps.length)], AB.brand, 500_000);
  }

  // deaths: a few mechanic deaths, then a wipe cascade for wipes
  const deaths: DeathRecord[] = [];
  const dead = new Set<number>();
  const slamHits = dmg.filter((e) => e.abilityId === AB.slam.id);
  for (const e of slamHits) {
    if (!dead.has(e.targetId) && r() < 0.45) {
      dead.add(e.targetId);
      deaths.push({ playerId: e.targetId, t: e.t + 200, killingAbilityId: AB.slam.id });
    }
  }
  if (!fight.kill) {
    const order = [...PLAYERS].sort(() => r() - 0.5);
    let t = dur - 12_000;
    for (const p of order) {
      if (dead.has(p.id)) continue;
      dead.add(p.id);
      deaths.push({ playerId: p.id, t: fight.startTime + t, killingAbilityId: r() < 0.6 ? AB.pulse.id : AB.melee.id });
      t += 500 + r() * 400;
      if (t > dur) break;
    }
  }
  const deathAt = new Map(deaths.map((d) => [d.playerId, d.t]));
  const alive = (id: number, t: number) => (deathAt.get(id) ?? Infinity) > t;
  const filteredDmg = dmg.filter((e) => alive(e.targetId, e.t));

  const interrupts: InterruptEvent[] = [];
  const kickers = [7, 10, 14, 18, 1, 9];
  for (let t = 10_000; t < dur; t += 8_000) {
    const who = kickers[Math.floor(r() * (r() < 0.7 ? 4 : kickers.length))];
    if (alive(who, fight.startTime + t) && r() < 0.85)
      interrupts.push({ t: fight.startTime + t, sourceId: who, abilityId: AB.kick.id, interruptedId: AB.bolt.id });
  }

  const activeShare = (id: number) => Math.min(1, ((deathAt.get(id) ?? fight.endTime) - fight.startTime) / dur);
  const baseDps = (p: Player) => (p.role === "dps" ? 1_100_000 : p.role === "tank" ? 450_000 : 180_000);
  const damageDone = PLAYERS.map((p) => ({
    playerId: p.id,
    total: Math.round(baseDps(p) * (0.75 + r() * 0.5) * (dur / 1000) * activeShare(p.id)),
  }));
  const healing = PLAYERS.map((p) => ({
    playerId: p.id,
    total: Math.round((p.role === "healer" ? 950_000 : 60_000) * (0.7 + r() * 0.6) * (dur / 1000) * activeShare(p.id)),
  }));

  const abilities: Record<number, Ability> = {};
  for (const a of Object.values(AB)) abilities[a.id] = a;
  return {
    report: { code: "demo", title: report.title },
    fight,
    players: PLAYERS,
    abilities,
    damageDone,
    healing,
    deaths: deaths.sort((a, b) => a.t - b.t),
    damageTaken: filteredDmg,
    interrupts,
    phases: report.phases[fight.encounterId] ?? [],
  };
}

export const DEMO_AVOIDABLE: Record<number, number[]> = {
  [BOSS_A]: [AB.slam.id, AB.pool.id],
  [BOSS_B]: [AB.slam.id, AB.pool.id],
};
