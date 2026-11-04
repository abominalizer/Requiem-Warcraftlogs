import Link from "next/link";
import { DamageTakenMatrix } from "@/components/DamageTakenMatrix";
import { AbilityName, Breadcrumbs, ErrorBox, PlayerName, Stat } from "@/components/ui";
import { PhaseBreakdown } from "@/components/PhaseBreakdown";
import { analyzeFight, analyzeProgression, phaseBreakdown, type FightAnalysis, type ProgressionAnalysis } from "@/lib/analysis";
import { getMultiPull, getReport, MAX_PULLS } from "@/lib/data";
import { diffName, fmtNum, fmtTime, progressColor } from "@/lib/format";
import type { Ability, DamageTakenSummary, Player, ReportSummary } from "@/lib/types";

const TOP_SPELLS = 8;

/** Table cell shaded by value relative to the max (a small heat map). */
function Heat({ value, max, rgb, children }: { value: number; max: number; rgb: string; children: React.ReactNode }) {
  const a = value > 0 && max > 0 ? 0.12 + 0.6 * (value / max) : 0;
  return (
    <td className="num" style={{ background: a ? `rgba(${rgb},${a.toFixed(2)})` : undefined }}>
      {value > 0 ? children : <span className="text-muted/40">·</span>}
    </td>
  );
}

function SpellHeader({ ability }: { ability: Ability }) {
  return (
    <th className="num max-w-28 align-bottom !normal-case">
      <span className="line-clamp-2 text-[11px] leading-tight">
        {ability.id > 1 ? (
          <a href={`https://www.wowhead.com/spell=${ability.id}`} target="_blank" rel="noreferrer" className="hover:underline">
            {ability.name}
          </a>
        ) : (
          ability.name
        )}
      </span>
    </th>
  );
}

export default async function AnalyzePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ fights?: string; wipe?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const includeWipe = sp.wipe === "1";
  const ids = [...new Set((sp.fights ?? "").split(",").map(Number).filter((n) => n > 0))];

  let report: ReportSummary;
  let pulls: FightAnalysis[];
  let prog: ProgressionAnalysis;
  let dt: DamageTakenSummary;
  try {
    if (!ids.length) throw new Error("No pulls selected. Go back to the report and tick some pulls.");
    if (ids.length > MAX_PULLS) throw new Error(`Select at most ${MAX_PULLS} pulls at once.`);
    report = await getReport(code);
    const multi = await getMultiPull(code, ids, { damageTaken: true });
    pulls = multi.details.map(analyzeFight);
    prog = analyzeProgression(pulls);
    dt = multi.damageTaken;
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }

  // Pull numbers per boss, as on the report page.
  const pullNo = new Map<number, number>();
  const counters = new Map<string, number>();
  for (const f of report.fights) {
    const k = `${f.encounterId}:${f.difficulty}`;
    counters.set(k, (counters.get(k) ?? 0) + 1);
    pullNo.set(f.id, counters.get(k)!);
  }
  const pctOf = (p: FightAnalysis) =>
    p.detail.fight.kill ? 0 : (p.detail.fight.fightPercentage ?? p.detail.fight.bossPercentage ?? 100);
  const bosses = [...new Set(pulls.map((p) => `${p.detail.fight.name} ${diffName(p.detail.fight.difficulty)}`))];

  const players = new Map<number, Player>();
  for (const p of pulls) for (const pl of p.detail.players) players.set(pl.id, pl);

  // ---- deaths: player x killing spell
  const deaths = pulls.flatMap((p) => p.deaths).filter((d) => includeWipe || !d.inWipe);
  const spellCount = new Map<number, { ability: Ability; n: number }>();
  for (const d of deaths) {
    const a = d.ability ?? { id: 0, name: "Unknown" };
    const c = spellCount.get(a.id) ?? { ability: a, n: 0 };
    c.n++;
    spellCount.set(a.id, c);
  }
  const deathCols = [...spellCount.values()].sort((a, b) => b.n - a.n).slice(0, TOP_SPELLS);
  const deathColIds = new Set(deathCols.map((c) => c.ability.id));
  const deathRows = [...players.values()]
    .map((pl) => {
      const mine = deaths.filter((d) => d.player.id === pl.id);
      const by = new Map<number, number>();
      for (const d of mine) by.set(d.ability?.id ?? 0, (by.get(d.ability?.id ?? 0) ?? 0) + 1);
      return {
        player: pl,
        total: mine.length,
        first: mine.filter((d) => d.first).length,
        by,
        other: mine.filter((d) => !deathColIds.has(d.ability?.id ?? 0)).length,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || b.first - a.first);
  const maxDeathCell = Math.max(1, ...deathRows.flatMap((r) => [...r.by.values()]));
  const hasOtherDeaths = deathRows.some((r) => r.other > 0);

  // ---- damage taken: player x spell
  const dmgRows = dt.byPlayer
    .filter((r) => players.has(r.playerId))
    .map((r) => ({ ...r, player: players.get(r.playerId)! }))
    .sort((a, b) => b.total - a.total);
  const topTakers = (abilityId: number) =>
    dmgRows
      .filter((r) => r.abilities[abilityId])
      .sort((a, b) => (b.abilities[abilityId] ?? 0) - (a.abilities[abilityId] ?? 0))
      .slice(0, 3);

  const totalTime = pulls.reduce((s, p) => s + p.durationMs, 0);
  const totalKicks = pulls.reduce((s, p) => s + p.detail.interrupts.length, 0);
  const allDeaths = pulls.reduce((s, p) => s + p.deaths.length, 0);
  const blamed = pulls.reduce((s, p) => s + p.deaths.filter((d) => !d.inWipe).length, 0);
  const selfUrl = (wipe: boolean) => `/report/${code}/analyze?fights=${ids.join(",")}${wipe ? "&wipe=1" : ""}`;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: report.title, href: `/report/${code}` }, { label: `Combined analysis (${pulls.length} pulls)` }]} />
      <div>
        <h1 className="text-2xl font-bold">Combined analysis · {pulls.length} pulls</h1>
        <p className="text-sm text-muted">{bosses.join(", ")}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {pulls.map((p) => {
            const f = p.detail.fight;
            return (
              <Link prefetch={false}
                key={f.id}
                href={`/report/${code}/fight/${f.id}`}
                className="rounded bg-panel-2 px-2 py-0.5 text-xs hover:brightness-125"
                style={{ boxShadow: `inset 0 -2px 0 ${progressColor(pctOf(p), f.kill)}` }}
              >
                {bosses.length > 1 ? `${f.name} ` : ""}#{pullNo.get(f.id)}{" "}
                <span style={{ color: progressColor(pctOf(p), f.kill) }}>{f.kill ? "kill" : `${pctOf(p).toFixed(1)}%`}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Time" value={fmtTime(totalTime)} sub={`avg ${fmtTime(totalTime / pulls.length)} per pull`} />
        <Stat label="Deaths" value={allDeaths} sub={`${blamed} before the wipe`} />
        <Stat label="Damage taken" value={fmtNum(dmgRows.reduce((s, r) => s + r.total, 0))} sub="from enemies" />
        <Stat label="Interrupts" value={totalKicks} />
      </div>

      {/* ---------------- deaths */}
      <section className="panel p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="h2 !mb-0">Deaths by player and spell</h2>
          <span className="text-xs text-muted">
            {includeWipe ? (
              <>
                Including deaths during wipes ·{" "}
                <Link prefetch={false} className="text-info hover:underline" href={selfUrl(false)}>
                  only count deaths before the wipe
                </Link>
              </>
            ) : (
              <>
                Deaths before the wipe only ·{" "}
                <Link prefetch={false} className="text-info hover:underline" href={selfUrl(true)}>
                  include deaths during wipes
                </Link>
              </>
            )}
          </span>
        </div>
        {deathRows.length === 0 ? (
          <p className="text-sm text-muted">No deaths.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th className="align-bottom">Player</th>
                  <th className="num align-bottom">Deaths</th>
                  <th className="num align-bottom" title="Times this player was the first to die in a pull">
                    First
                  </th>
                  {deathCols.map((c) => (
                    <SpellHeader key={c.ability.id} ability={c.ability} />
                  ))}
                  {hasOtherDeaths && <th className="num align-bottom">Other</th>}
                </tr>
              </thead>
              <tbody>
                {deathRows.map((r) => (
                  <tr key={r.player.id}>
                    <td>
                      <PlayerName player={r.player} />
                    </td>
                    <td className="num font-semibold text-bad">{r.total}</td>
                    <td className={`num ${r.first ? "text-bad" : "text-muted"}`}>{r.first || "—"}</td>
                    {deathCols.map((c) => (
                      <Heat key={c.ability.id} value={r.by.get(c.ability.id) ?? 0} max={maxDeathCell} rgb="242,84,91">
                        {r.by.get(c.ability.id)}
                      </Heat>
                    ))}
                    {hasOtherDeaths && <td className="num text-muted">{r.other || "·"}</td>}
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td>Total</td>
                  <td className="num">{deaths.length}</td>
                  <td className="num">{deathRows.reduce((s, r) => s + r.first, 0)}</td>
                  {deathCols.map((c) => (
                    <td key={c.ability.id} className="num">
                      {c.n}
                    </td>
                  ))}
                  {hasOtherDeaths && <td className="num">{deathRows.reduce((s, r) => s + r.other, 0)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------- phases */}
      {(() => {
        const bossPhases = phaseBreakdown(pulls);
        return bossPhases.map((b) => (
          <PhaseBreakdown key={b.encounterId} boss={b} code={code} pullNo={Object.fromEntries(pullNo)} showBossName={bossPhases.length > 1} />
        ));
      })()}

      {/* ---------------- damage taken */}
      <section className="panel p-4">
        <h2 className="h2">Damage taken by player and spell</h2>
        <p className="mb-3 text-xs text-muted">
          Damage from enemies only, summed over the selected pulls. Click a spell to leave it out: totals and order update. Click a column
          header to sort by that spell. Cells are shaded relative to the player who took the most of that spell, so outliers stand out.
        </p>
        {dmgRows.length === 0 ? (
          <p className="text-sm text-muted">No damage taken data.</p>
        ) : (
          <DamageTakenMatrix
            spells={dt.abilities.map((a) => ({ ability: a.ability, total: a.total }))}
            rows={dmgRows.map((r) => ({ player: r.player, abilities: r.abilities }))}
          />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-4">
          <h2 className="h2">Damage taken by spell</h2>
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Spell</th>
                  <th className="num">Damage</th>
                  <th className="num">Hits</th>
                  <th>Took the most</th>
                </tr>
              </thead>
              <tbody>
                {dt.abilities.slice(0, 25).map((a) => (
                  <tr key={a.ability.id}>
                    <td>
                      <AbilityName ability={a.ability} />
                    </td>
                    <td className="num">{fmtNum(a.total)}</td>
                    <td className="num text-muted">{a.hits || "—"}</td>
                    <td className="text-xs">
                      {topTakers(a.ability.id).map((r, i) => (
                        <span key={r.playerId}>
                          {i > 0 && ", "}
                          <PlayerName player={r.player} /> <span className="text-muted">{fmtNum(r.abilities[a.ability.id] ?? 0)}</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="h2">What kills you</h2>
          {prog.deathCauses.length === 0 ? (
            <p className="text-sm text-muted">No deaths before the wipe.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Spell</th>
                  <th className="num">Deaths before wipe</th>
                  <th className="num">First death of pull</th>
                </tr>
              </thead>
              <tbody>
                {prog.deathCauses.slice(0, 15).map((c) => (
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
      </div>

      <section className="panel p-4">
        <h2 className="h2">Players across the selected pulls</h2>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Player</th>
                <th className="num">Pulls</th>
                <th className="num">Deaths before wipe</th>
                <th className="num">First deaths</th>
                <th className="num">Avoidable hits</th>
                <th className="num" title="Deaths before the wipe where the player pressed no defensive (and got no external) while one was off cooldown">
                  Died pressing nothing
                </th>
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
                  <td className="num">{p.pulls}</td>
                  <td className={`num ${p.deaths ? "text-bad" : "text-muted"}`}>{p.deaths}</td>
                  <td className={`num ${p.firstDeaths ? "text-bad" : "text-muted"}`}>{p.firstDeaths}</td>
                  <td className={`num ${p.avoidableHits ? "text-warn" : "text-muted"}`}>{p.avoidableHits}</td>
                  <td className={`num ${p.readyDeaths ? "font-semibold text-bad" : "text-muted"}`}>
                    {p.readyDeaths == null ? "—" : p.readyDeaths}
                  </td>
                  <td className="num">{p.interrupts}</td>
                  <td className="num">{fmtNum(p.avgDps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="h2">Selected pulls</h2>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Pull</th>
                <th>Result</th>
                <th className="num">Duration</th>
                <th>First death</th>
                <th className="num">Deaths before wipe</th>
              </tr>
            </thead>
            <tbody>
              {pulls.map((p) => {
                const f = p.detail.fight;
                const first = p.deaths[0];
                return (
                  <tr key={f.id}>
                    <td>
                      <Link prefetch={false} className="text-info" href={`/report/${code}/fight/${f.id}`}>
                        {f.name} #{pullNo.get(f.id)}
                      </Link>
                    </td>
                    <td className="font-semibold" style={{ color: progressColor(pctOf(p), f.kill) }}>
                      {f.kill ? "Kill" : `${pctOf(p).toFixed(1)}%`}
                    </td>
                    <td className="num">{fmtTime(p.durationMs)}</td>
                    <td>
                      {first ? (
                        <>
                          <PlayerName player={first.player} />{" "}
                          <span className="text-xs text-muted">
                            {fmtTime(first.t)} · {first.ability?.name ?? "?"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="num">{p.deaths.filter((d) => !d.inWipe).length}</td>
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
