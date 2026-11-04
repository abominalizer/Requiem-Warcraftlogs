import "server-only";
import { getAvoidableMap } from "./avoidable";
import { demoFight, demoReport } from "./demo";
import { fetchFightDetail, fetchMultiPull, fetchNightDefensives, fetchReport, type NightDefensives } from "./wcl";
import type { DamageTakenSummary, FightDetail, MultiPull, ReportSummary } from "./types";

export const isDemo = (code: string) => code === "demo";

export function getReport(code: string): Promise<ReportSummary> {
  return isDemo(code) ? Promise.resolve(demoReport()) : fetchReport(code);
}

/** Defensive casts for the whole night (one request, cached). Never fails a page: no data = no check. */
async function nightDefensives(code: string): Promise<NightDefensives | null> {
  if (isDemo(code)) return null;
  try {
    return await fetchNightDefensives(code);
  } catch {
    return null;
  }
}

function withDefensives(detail: FightDetail, night: NightDefensives | null): FightDetail {
  if (!night) return detail;
  return { ...detail, defensives: { casts: night.byFight[detail.fight.id] ?? [], known: night.known, spells: night.spells } };
}

export async function getFight(code: string, fightId: number): Promise<FightDetail> {
  const [detail, avoidable, night] = await Promise.all([
    isDemo(code) ? demoFight(fightId) : fetchFightDetail(code, fightId),
    getAvoidableMap(),
    nightDefensives(code),
  ]);
  const ids = avoidable[detail.fight.encounterId];
  return withDefensives(ids?.length ? { ...detail, avoidableIds: ids } : detail, night);
}

export const MAX_PULLS = 40;

/** Load several pulls in a handful of batched requests (Cloudflare allows 50 per page view). */
export async function getMultiPull(code: string, ids: number[], opts: { damageTaken?: boolean } = {}): Promise<MultiPull> {
  if (!isDemo(code)) {
    const [multi, night] = await Promise.all([
      getAvoidableMap().then((avoidable) => fetchMultiPull(code, ids.slice(0, MAX_PULLS), { ...opts, avoidable })),
      nightDefensives(code),
    ]);
    return { ...multi, details: multi.details.map((d) => withDefensives(d, night)) };
  }
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
