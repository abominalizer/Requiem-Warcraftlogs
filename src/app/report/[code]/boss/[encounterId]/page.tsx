import Link from "next/link";
import { AbilityName, Breadcrumbs, ErrorBox, PlayerName, Score, Stat } from "@/components/ui";
import { analyzeFight, analyzeProgression, type ProgressionAnalysis } from "@/lib/analysis";
import { getFights, getReport } from "@/lib/data";
import { diffName, fmtNum, fmtTime, progressColor } from "@/lib/format";
import type { ReportSummary } from "@/lib/types";

export default async function BossPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; encounterId: string }>;
  searchParams: Promise<{ difficulty?: string }>;
}) {
  const { code, encounterId } = await params;
  const { difficulty } = await searchParams;
  let report: ReportSummary;
  let prog: ProgressionAnalysis;
  try {
    report = await getReport(code);
    const fights = report.fights.filter(
      (f) => f.encounterId === Number(encounterId) && (!difficulty || String(f.difficulty) === difficulty),
    );
    if (!fights.length) throw new Error("No pulls for this boss in the report.");
    const details = await getFights(code, fights.map((f) => f.id));
    prog = analyzeProgression(details.map(analyzeFight));
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }

  const pulls = prog.pulls;
  const f0 = pulls[0].detail.fight;
  const kill = pulls.find((p) => p.detail.fight.kill);
  const pctOf = (p: (typeof pulls)[number]) =>
    p.detail.fight.kill ? 0 : (p.detail.fight.fightPercentage ?? p.detail.fight.bossPercentage ?? 100);
  const best = Math.min(...pulls.map(pctOf));
  const totalTime = pulls.reduce((s, p) => s + p.durationMs, 0);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: report.title, href: `/report/${code}` }, { label: `${f0.name} ${diffName(f0.difficulty)}` }]} />
      <div>
        <h1 className="text-2xl font-bold">
          {f0.name} <span className="text-base text-muted">{diffName(f0.difficulty)} progression</span>
        </h1>
        <p className="text-sm text-muted">Encounter ID {f0.encounterId}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pulls" value={pulls.length} />
        <Stat label="Result" value={kill ? <span className="text-good">Killed</span> : `Best ${best.toFixed(1)}%`} />
        <Stat label="Time on boss" value={fmtTime(totalTime)} />
        <Stat label="Avg pull" value={fmtTime(totalTime / pulls.length)} />
      </div>

      <section className="panel p-4">
        <h2 className="h2">Progress per pull (boss % remaining)</h2>
        <div className="flex h-40 items-end gap-1">
          {pulls.map((p, i) => {
            const pct = pctOf(p);
            return (
              <Link
                key={p.detail.fight.id}
                href={`/report/${code}/fight/${p.detail.fight.id}`}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`Pull ${i + 1}: ${p.detail.fight.kill ? "Kill" : pct.toFixed(1) + "%"} · ${fmtTime(p.durationMs)}`}
              >
                <div
                  className="w-full rounded-t group-hover:brightness-125"
                  style={{
                    height: `${Math.max(3, p.detail.fight.kill ? 100 : 100 - pct)}%`,
                    background: progressColor(pct, p.detail.fight.kill),
                  }}
                />
                <span className="mt-1 text-center text-[10px] text-muted">{i + 1}</span>
              </Link>
            );
          })}
        </div>
        <p className="mt-1 text-xs text-muted">Taller = further into the fight. Click a bar to open the pull.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-4">
          <h2 className="h2">What kills you (deaths before the wipe)</h2>
          {prog.deathCauses.length === 0 ? (
            <p className="text-sm text-muted">No deaths outside of wipes.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Ability</th>
                  <th className="num">Deaths</th>
                  <th className="num">First death of pull</th>
                </tr>
              </thead>
              <tbody>
                {prog.deathCauses.slice(0, 10).map((c) => (
                  <tr key={c.ability.id}>
                    <td>
                      <AbilityName ability={c.ability} />
                    </td>
                    <td className="num">{c.count}</td>
                    <td className="num">{c.first || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel p-4">
          <h2 className="h2">Avoidable damage across pulls</h2>
          {prog.avoidable.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing flagged. Over a whole night every boss ability ends up hitting most of the raid, so avoidable damage
              can&apos;t be guessed here. List this boss&apos;s avoidable spell IDs under encounter {f0.encounterId} in{" "}
              <code>src/config/encounters.ts</code> (spell IDs are shown on each pull&apos;s damage-taken table).
            </p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Ability</th>
                  <th className="num">Hits</th>
                  <th className="num">Damage</th>
                  <th className="num">Pulls</th>
                </tr>
              </thead>
              <tbody>
                {prog.avoidable.slice(0, 10).map((a) => (
                  <tr key={a.ability.id}>
                    <td>
                      <AbilityName ability={a.ability} />
                      {a.kind === "heuristic" && <span className="ml-1 text-[10px] text-warn">possibly</span>}
                    </td>
                    <td className="num">{a.hits}</td>
                    <td className="num">{fmtNum(a.damage)}</td>
                    <td className="num">{a.pulls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel p-4">
        <h2 className="h2">Players across all pulls</h2>
        <p className="mb-2 text-xs text-muted">Sorted by average execution score (lowest first).</p>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Avg score</th>
                <th className="num">Pulls</th>
                <th className="num">Deaths</th>
                <th className="num">First deaths</th>
                <th className="num">Avoidable hits</th>
                <th className="num">Interrupts</th>
                <th className="num">Avg DPS</th>
              </tr>
            </thead>
            <tbody>
              {prog.players.map((p) => (
                <tr key={p.player.id}>
                  <td>
                    <PlayerName player={p.player} />
                  </td>
                  <td className="num">
                    <Score value={p.avgScore} />
                  </td>
                  <td className="num">{p.pulls}</td>
                  <td className={`num ${p.deaths ? "text-bad" : "text-muted"}`}>{p.deaths}</td>
                  <td className={`num ${p.firstDeaths ? "text-bad" : "text-muted"}`}>{p.firstDeaths}</td>
                  <td className={`num ${p.avoidableHits ? "text-warn" : "text-muted"}`}>{p.avoidableHits}</td>
                  <td className="num">{p.interrupts}</td>
                  <td className="num">{fmtNum(p.avgDps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="h2">Pulls</h2>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Result</th>
                <th className="num">Duration</th>
                <th>First death</th>
                <th className="num">Deaths before wipe</th>
                <th className="num">Avoidable hits</th>
              </tr>
            </thead>
            <tbody>
              {pulls.map((p, i) => {
                const first = p.deaths[0];
                return (
                  <tr key={p.detail.fight.id}>
                    <td>
                      <Link className="text-info" href={`/report/${code}/fight/${p.detail.fight.id}`}>
                        Pull {i + 1}
                      </Link>
                    </td>
                    <td className="font-semibold" style={{ color: progressColor(pctOf(p), p.detail.fight.kill) }}>{p.detail.fight.kill ? "Kill" : `${pctOf(p).toFixed(1)}%`}</td>
                    <td className="num">{fmtTime(p.durationMs)}</td>
                    <td>
                      {first ? (
                        <>
                          <PlayerName player={first.player} /> <span className="text-xs text-muted">{fmtTime(first.t)} · {first.ability?.name ?? "?"}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="num">{p.deaths.filter((d) => !d.inWipe).length}</td>
                    <td className="num">{p.players.reduce((s, x) => s + x.avoidableHits, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
