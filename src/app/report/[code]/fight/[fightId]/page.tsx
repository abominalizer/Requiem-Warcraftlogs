import Link from "next/link";
import { AbilityName, Bar, Breadcrumbs, ErrorBox, InsightList, PlayerName, Score, Stat, Timeline } from "@/components/ui";
import { analyzeFight, type FightAnalysis } from "@/lib/analysis";
import { getFight, getReport } from "@/lib/data";
import { classColor, diffName, fmtNum, fmtTime } from "@/lib/format";

const ROLE_ORDER = { tank: 0, healer: 1, dps: 2 } as const;

export default async function FightPage({ params }: { params: Promise<{ code: string; fightId: string }> }) {
  const { code, fightId } = await params;
  let a: FightAnalysis;
  let siblings: number[];
  try {
    const [report, detail] = await Promise.all([getReport(code), getFight(code, Number(fightId))]);
    a = analyzeFight(detail);
    siblings = report.fights
      .filter((f) => f.encounterId === detail.fight.encounterId && f.difficulty === detail.fight.difficulty)
      .map((f) => f.id);
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }
  const { fight, report } = a.detail;
  const idx = siblings.indexOf(fight.id);
  const pct = fight.fightPercentage ?? fight.bossPercentage ?? 0;
  const maxDps = Math.max(...a.players.map((p) => p.dps), 1);
  const maxHps = Math.max(...a.players.map((p) => p.hps), 1);
  const players = [...a.players].sort((x, y) => ROLE_ORDER[x.player.role] - ROLE_ORDER[y.player.role] || y.dps - x.dps);
  const blamed = a.deaths.filter((d) => !d.inWipe).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: report.title, href: `/report/${code}` },
          { label: `${fight.name} ${diffName(fight.difficulty)}`, href: `/report/${code}/boss/${fight.encounterId}?difficulty=${fight.difficulty ?? ""}` },
          { label: `Pull ${idx + 1}` },
        ]}
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {fight.name} — Pull {idx + 1}{" "}
            {fight.kill ? <span className="text-good">Kill</span> : <span className="text-bad">Wipe at {pct.toFixed(1)}%</span>}
          </h1>
          <p className="text-sm text-muted">Encounter ID {fight.encounterId} · Fight {fight.id}</p>
        </div>
        <div className="flex gap-2 text-sm">
          {idx > 0 && (
            <Link className="rounded-lg border border-line px-3 py-1.5 hover:border-accent" href={`/report/${code}/fight/${siblings[idx - 1]}`}>
              ← Previous pull
            </Link>
          )}
          {idx < siblings.length - 1 && (
            <Link className="rounded-lg border border-line px-3 py-1.5 hover:border-accent" href={`/report/${code}/fight/${siblings[idx + 1]}`}>
              Next pull →
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Duration" value={fmtTime(a.durationMs)} sub={fight.lastPhase ? `Reached phase ${fight.lastPhase}` : undefined} />
        <Stat label="Boss HP" value={fight.kill ? "0%" : `${(fight.bossPercentage ?? pct).toFixed(1)}%`} />
        <Stat label="Deaths" value={a.deaths.length} sub={`${blamed} before wipe`} />
        <Stat label="Raid DPS" value={fmtNum(a.raidDps)} />
        <Stat label="Raid HPS" value={fmtNum(a.raidHps)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <section className="panel p-4">
          <h2 className="h2">What went wrong</h2>
          <InsightList insights={a.insights} />
        </section>

        <section className="panel p-4">
          <h2 className="h2">Timeline</h2>
          <Timeline
            duration={a.durationMs}
            phases={a.phases}
            deaths={a.deaths.map((d) => ({ t: d.t, player: d.player, label: d.ability?.name ?? "?", muted: d.inWipe }))}
          />
          <h2 className="h2 mt-5">Deaths</h2>
          {a.deaths.length === 0 ? (
            <p className="text-sm text-muted">Nobody died.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Player</th>
                    <th>Killing blow</th>
                    <th>Last hits taken</th>
                  </tr>
                </thead>
                <tbody>
                  {a.deaths.map((d, i) => (
                    <tr key={i} className={d.inWipe ? "opacity-50" : ""}>
                      <td className="tabular-nums">
                        {fmtTime(d.t)}
                        {d.first && <span className="ml-1 rounded bg-bad/20 px-1 text-[10px] text-bad">FIRST</span>}
                      </td>
                      <td>
                        <PlayerName player={d.player} />
                      </td>
                      <td>
                        <AbilityName ability={d.ability} />
                      </td>
                      <td className="text-xs text-muted">
                        {d.lastHits.map((h) => `${h.ability.name} ${fmtNum(h.amount)}`).join(" → ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted">Greyed-out deaths happened during the wipe and aren&apos;t counted against players.</p>
            </div>
          )}
        </section>
      </div>

      <section className="panel p-4">
        <h2 className="h2">Players</h2>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Player</th>
                <th title="100 minus penalties for deaths and avoidable damage">Score</th>
                <th className="w-1/4">DPS</th>
                <th className="w-1/6">HPS</th>
                <th className="num">Avoidable hits</th>
                <th className="num">Interrupts</th>
                <th className="num">Died</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.player.id}>
                  <td>
                    <PlayerName player={p.player} /> <span className="text-xs text-muted">{p.player.spec}</span>
                  </td>
                  <td title={p.scoreNotes.join("\n") || "Clean"}>
                    <Score value={p.score} />
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-right tabular-nums">{fmtNum(p.dps)}</span>
                      <Bar value={p.dps} max={maxDps} color={classColor(p.player.className)} />
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-right tabular-nums">{fmtNum(p.hps)}</span>
                      <Bar value={p.hps} max={maxHps} color="var(--color-good)" />
                    </div>
                  </td>
                  <td className={`num ${p.avoidableHits ? "text-bad" : "text-muted"}`}>{p.avoidableHits || "—"}</td>
                  <td className="num">{p.interrupts || <span className="text-muted">—</span>}</td>
                  <td className={`num ${p.death && !p.death.inWipe ? "text-bad" : "text-muted"}`}>
                    {p.death ? fmtTime(p.death.t) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="h2">Damage taken by ability</h2>
        <p className="mb-3 text-xs text-muted">
          <span className="text-bad">Avoidable</span> = configured in <code>src/config/encounters.ts</code>.{" "}
          <span className="text-warn">Possibly avoidable</span> = only part of the raid got hit, some players repeatedly. Click a
          row to see who got hit.
        </p>
        <div className="divide-y divide-line/50 text-sm">
          {a.abilities.slice(0, 40).map((ab) => (
            <details key={ab.ability.id} className="group">
              <summary className="flex cursor-pointer items-center gap-3 px-2 py-1.5 hover:bg-panel-2/60">
                <span className="flex-1">
                  <AbilityName ability={ab.ability} />{" "}
                  {ab.avoidable === "configured" && <span className="ml-1 rounded bg-bad/20 px-1.5 text-[10px] text-bad">AVOIDABLE</span>}
                  {ab.avoidable === "heuristic" && <span className="ml-1 rounded bg-warn/20 px-1.5 text-[10px] text-warn">POSSIBLY AVOIDABLE</span>}
                  <span className="ml-2 text-[10px] text-muted">#{ab.ability.id}</span>
                </span>
                <span className="w-28 text-right text-muted tabular-nums">{ab.hits} hits</span>
                <span className="w-28 text-right text-muted tabular-nums">{ab.playersHit} players</span>
                <span className="w-24 text-right tabular-nums">{fmtNum(ab.total)}</span>
              </summary>
              <div className="flex flex-wrap gap-x-4 gap-y-1 bg-panel-2/40 px-4 py-2 text-xs">
                {ab.perPlayer.map((pp) => {
                  const pl = a.detail.players.find((x) => x.id === pp.playerId)!;
                  return (
                    <span key={pp.playerId}>
                      <PlayerName player={pl} /> ×{pp.hits} <span className="text-muted">({fmtNum(pp.total)})</span>
                    </span>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
