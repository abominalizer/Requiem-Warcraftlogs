import "server-only";
import { getAvoidableMap } from "./avoidable";
import { demoFight, demoReport } from "./demo";
import { fetchFightDetail, fetchMultiPull, fetchReport } from "./wcl";
import type { DamageTakenSummary, FightDetail, MultiPull, ReportSummary } from "./types";

export const isDemo = (code: string) => code === "demo";

export function getReport(code: string): Promise<ReportSummary> {
  return isDemo(code) ? Promise.resolve(demoReport()) : fetchReport(code);
}

export async function getFight(code: string, fightId: number): Promise<FightDetail> {
  const [detail, avoidable] = await Promise.all([
    isDemo(code) ? demoFight(fightId) : fetchFightDetail(code, fightId),
    getAvoidableMap(),
  ]);
  const ids = avoidable[detail.fight.encounterId];
  return ids?.length ? { ...detail, avoidableIds: ids } : detail;
}

export const MAX_PULLS = 40;

/** Load several pulls in a handful of batched requests (Cloudflare allows 50 per page view). */
export async function getMultiPull(code: string, ids: number[], opts: { damageTaken?: boolean } = {}): Promise<MultiPull> {
  if (!isDemo(code)) return fetchMultiPull(code, ids.slice(0, MAX_PULLS), { ...opts, avoidable: await getAvoidableMap() });
  const details = ids.map(demoFight);
  const abilities = new Map<number, DamageTakenSummary["abilities"][number]>();
  const players = new Map<number, DamageTakenSummary["byPlayer"][number]>();
  for (const d of details)
    for (const e of d.damageTaken) {
      const a = abilities.get(e.abilityId) ?? { ability: d.abilities[e.abilityId], total: 0, hits: 0 };
      a.total += e.amount;
      a.hits++;
      abilities.set(e.abilityId, a);
      const p = players.get(e.targetId) ?? { playerId: e.targetId, total: 0, abilities: {} };
      p.total += e.amount;
      p.abilities[e.abilityId] = (p.abilities[e.abilityId] ?? 0) + e.amount;
      players.set(e.targetId, p);
    }
  return {
    details,
    damageTaken: { abilities: [...abilities.values()].sort((a, b) => b.total - a.total), byPlayer: [...players.values()] },
  };
}
