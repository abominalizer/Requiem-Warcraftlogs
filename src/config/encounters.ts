// Per-boss configuration, like Wipefest's hand-written "insights".
// Add your raid's encounter IDs (shown on every boss page) and spell IDs (shown in the damage-taken table).
//
//  avoidable: damage that a player should never take (frontals, pools, swirls...)
//  ignore:    abilities to never flag as avoidable (random debuffs, soak mechanics...)
import { DEMO_AVOIDABLE } from "@/lib/demo";

export interface EncounterConfig {
  avoidable?: number[];
  ignore?: number[];
}

export const ENCOUNTERS: Record<number, EncounterConfig> = {
  // Example:
  // 3009: { avoidable: [434803, 435136], ignore: [439789] },
  ...Object.fromEntries(Object.entries(DEMO_AVOIDABLE).map(([k, v]) => [k, { avoidable: v }])),
};

// Abilities never counted as avoidable on any boss.
export const GLOBAL_IGNORE = new Set<number>([
  1, // melee
  0,
]);
