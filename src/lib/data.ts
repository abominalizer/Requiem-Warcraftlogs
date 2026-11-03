import "server-only";
import { demoFight, demoReport } from "./demo";
import { fetchFightDetail, fetchReport } from "./wcl";
import type { FightDetail, ReportSummary } from "./types";

export const isDemo = (code: string) => code === "demo";

export function getReport(code: string): Promise<ReportSummary> {
  return isDemo(code) ? Promise.resolve(demoReport()) : fetchReport(code);
}

export function getFight(code: string, fightId: number): Promise<FightDetail> {
  return isDemo(code) ? Promise.resolve(demoFight(fightId)) : fetchFightDetail(code, fightId);
}

/** Load many fights with limited concurrency (be nice to the API rate limit). */
export async function getFights(code: string, ids: number[], concurrency = 3): Promise<FightDetail[]> {
  const out: FightDetail[] = new Array(ids.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (next < ids.length) {
        const i = next++;
        out[i] = await getFight(code, ids[i]);
      }
    }),
  );
  return out;
}
