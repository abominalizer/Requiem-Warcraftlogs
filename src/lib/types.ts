export type Role = "tank" | "healer" | "dps";

export interface Player {
  id: number;
  name: string;
  className: string; // e.g. "DeathKnight"
  spec?: string;
  role: Role;
}

export interface Ability {
  id: number;
  name: string;
  icon?: string;
}

export interface Fight {
  id: number;
  encounterId: number;
  name: string;
  kill: boolean;
  startTime: number; // ms, relative to report start
  endTime: number;
  difficulty: number | null;
  bossPercentage: number | null; // 0-100, boss HP left
  fightPercentage: number | null; // 0-100, overall encounter progress left
  lastPhase: number | null;
  lastPhaseIsIntermission: boolean;
  phaseTransitions: { id: number; startTime: number }[];
  size: number | null;
}

export interface PhaseInfo {
  id: number;
  name: string;
  isIntermission: boolean;
}

export interface ReportSummary {
  code: string;
  title: string;
  startTime: number; // unix ms
  endTime: number;
  zone: string | null;
  guild: { name: string; server: string; region: string } | null;
  owner: string | null;
  fights: Fight[];
  phases: Record<number, PhaseInfo[]>; // by encounterId
}

export interface AmountEntry {
  playerId: number;
  total: number;
}

export interface DamageEvent {
  t: number; // ms relative to report start
  targetId: number;
  sourceId: number;
  abilityId: number;
  amount: number; // includes absorbed
  overkill: number;
}

export interface DeathRecord {
  playerId: number;
  t: number; // ms relative to report start
  killingAbilityId: number | null;
}

export interface InterruptEvent {
  t: number;
  sourceId: number; // owner-resolved player id
  abilityId: number; // the interrupt spell
  interruptedId: number; // the spell that got interrupted
}

export interface FightDetail {
  report: { code: string; title: string };
  fight: Fight;
  players: Player[];
  abilities: Record<number, Ability>;
  damageDone: AmountEntry[];
  healing: AmountEntry[];
  deaths: DeathRecord[];
  damageTaken: DamageEvent[];
  interrupts: InterruptEvent[];
  phases: PhaseInfo[];
  /**
   * Set by the progression loader: damageTaken then only holds these abilities' hits,
   * already classified across all pulls.
   */
  knownAvoidable?: Record<number, "configured" | "heuristic">;
  /** Avoidable spell ids for this boss (marked on the Raid page). When set, nothing is guessed. */
  avoidableIds?: number[];
  /** Spells whose deaths no defensive could prevent (marked on the Raid page). */
  unsurvivableIds?: number[];
  /** Defensive casts in this pull + which defensives each player used tonight. */
  defensives?: PullDefensives;
}

export type DefensiveKind = "personal" | "consumable" | "external";

export interface DefensiveCast {
  t: number; // ms, report time
  sourceId: number;
  targetId: number;
  key: string; // spell name, or consumable label
  /** shared-cooldown group (e.g. any potion) */
  group?: string;
  /** the actual spell, when it differs from key (e.g. "Potion of Recklessness") */
  spell?: string;
}

export interface PullDefensives {
  casts: DefensiveCast[];
  /** playerId -> defensive keys they cast at least once tonight */
  known: Record<number, string[]>;
  spells: Record<string, { kind: DefensiveKind; cd: number; oncePerPull?: boolean; group?: string }>;
}

export interface GuildReport {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  zone: string | null;
}

export interface GuildInfo {
  id: number;
  name: string;
  faction: string | null;
  server: string;
  region: string;
}

export interface GuildFight {
  id: number;
  startTime: number;
  endTime: number;
  encounterId: number;
  name: string;
  kill: boolean;
  difficulty: number | null;
  percent: number; // encounter progress remaining, 0 for kills
  lastPhase: number | null;
}

export interface GuildReportSummary {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  zone: { id: number; name: string } | null;
  fights: GuildFight[];
}

export interface GuildHome {
  guild: GuildInfo;
  reports: GuildReportSummary[];
  zone: { id: number; name: string; encounters: { id: number; name: string }[] } | null;
  /** every log of the current raid, newest first */
  zoneReports: GuildReportSummary[];
}

/** Damage taken from enemies, summed over a set of pulls. */
export interface DamageTakenSummary {
  abilities: { ability: Ability; total: number; hits: number }[];
  byPlayer: { playerId: number; total: number; abilities: Record<number, number> }[];
}

export interface MultiPull {
  details: FightDetail[];
  damageTaken: DamageTakenSummary;
}

export interface RaidSpell {
  /** all spell ids sharing this name */
  ids: number[];
  name: string;
  icon?: string;
  total: number;
  hits: number;
}

export interface RaidBoss {
  encounterId: number;
  name: string;
  difficulty: number | null;
  /** the pull the spell list was taken from */
  source: { code: string; fightId: number; kill: boolean; percent: number; date: number } | null;
  spells: RaidSpell[];
}
