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
}

export interface GuildReport {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  zone: string | null;
}
