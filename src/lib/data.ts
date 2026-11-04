import "server-only";
import { demoFight, demoReport } from "./demo";
import { fetchFightDetail, fetchProgressionDetails, fetchReport } from "./wcl";
import type { FightDetail, ReportSummary } from "./types";

export const isDemo = (code: string) => code === "demo";

export function getReport(code: string): Promise<ReportSummary> {
  return isDemo(code) ? Promise.resolve(demoReport()) : fetchReport(code);
}

export function getFight(code: string, fightId: number): Promise<FightDetail> {
  return isDemo(code) ? Promise.resolve(demoFight(fightId)) : fetchFightDetail(code, fightId);
}

/** Load all pulls of a boss in a handful of batched requests (Cloudflare allows 50 per page view). */
export async function getFights(code: string, ids: number[]): Promise<FightDetail[]> {
  return isDemo(code) ? ids.map(demoFight) : fetchProgressionDetails(code, ids);
}
