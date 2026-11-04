import Link from "next/link";
import { AbilityName, PlayerName } from "@/components/ui";
import type { BossPhaseBreakdown } from "@/lib/analysis";
import { fmtTime, progressColor } from "@/lib/format";

/** "Where we wipe": pulls grouped by the phase they ended in, deaths per phase, and the deaths that started each wipe. */
export function PhaseBreakdown({
  boss,
  code,
  pullNo,
  showBossName,
}: {
  boss: BossPhaseBreakdown;
  code: string;
  pullNo: Record<number, number>;
  showBossName?: boolean;
}) {
  const total = boss.pulls.length;
  const pct = (p: BossPhaseBreakdown["pulls"][number]) =>
    p.detail.fight.kill ? 0 : (p.detail.fight.fightPercentage ?? p.detail.fight.bossPercentage ?? 100);
  const ws = boss.wipeStarters;

  return (
    <div className="space-y-6">
      <section className="panel p-4">
        <h2 className="h2">Where we wipe{showBossName ? ` · ${boss.name}` : ""}</h2>
        <div className="space-y-3">
          {boss.phases.map((ph) => (
            <div key={ph.id} className="rounded-lg border border-line bg-panel-2/40 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">
                  {ph.name}
                  {ph.isIntermission && <span className="ml-2 text-xs font-normal text-muted">intermission</span>}
                </h3>
                <span className="text-xs text-muted tabular-nums">
                  reached in {ph.reached}/{total} pulls
                  {ph.avgReachMs != null && (
                    <>
                      {" "}
                      · at {fmtTime(ph.avgReachMs)} on average (fastest {fmtTime(ph.fastestReachMs!)})
                    </>
                  )}
                </span>
              </div>

              <div className="mt-2 grid gap-3 md:grid-cols-3">
                <div>
                  <div className="text-xs text-muted uppercase">
                    {ph.wipes.length} wipe{ph.wipes.length === 1 ? "" : "s"} ended here
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ph.wipes.map((p) => (
                      <Link
                        prefetch={false}
                        key={p.detail.fight.id}
                        href={`/report/${code}/fight/${p.detail.fight.id}`}
                        className="rounded bg-bg px-1.5 py-0.5 text-[11px] tabular-nums hover:brightness-125"
                        style={{ boxShadow: `inset 0 -2px 0 ${progressColor(pct(p))}` }}
                        title={`Pull ${pullNo[p.detail.fight.id]} · ${fmtTime(p.durationMs)}`}
                      >
                        #{pullNo[p.detail.fight.id]} <span style={{ color: progressColor(pct(p)) }}>{pct(p).toFixed(1)}%</span>
                      </Link>
                    ))}
                    {ph.wipes.length === 0 && <span className="text-xs text-muted">—</span>}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted uppercase">{ph.deaths} deaths before the wipe, killed by</div>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {ph.topSpells.map((s) => (
                      <li key={s.ability.id} className="flex justify-between gap-2">
                        <AbilityName ability={s.ability} />
                        <span className="text-bad tabular-nums">{s.count}</span>
                      </li>
                    ))}
                    {ph.topSpells.length === 0 && <li className="text-xs text-muted">—</li>}
                  </ul>
                </div>
                <div>
                  <div className="text-xs text-muted uppercase">Who dies here</div>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {ph.topPlayers.map((s) => (
                      <li key={s.player.id} className="flex justify-between gap-2">
                        <PlayerName player={s.player} />
                        <span className="text-bad tabular-nums">{s.count}</span>
                      </li>
                    ))}
                    {ph.topPlayers.length === 0 && <li className="text-xs text-muted">—</li>}
                  </ul>
                </div>
              </div>
            </div>
          ))}
          {boss.kills.length > 0 && (
            <p className="text-sm">
              <span style={{ color: progressColor(0, true) }}>
                {boss.kills.length} kill{boss.kills.length > 1 ? "s" : ""}
              </span>{" "}
              {boss.kills.map((k) => (
                <Link prefetch={false} key={k.detail.fight.id} href={`/report/${code}/fight/${k.detail.fight.id}`} className="ml-1 text-info hover:underline">
                  #{pullNo[k.detail.fight.id]}
                </Link>
              ))}
            </p>
          )}
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="h2">What started the wipe{showBossName ? ` · ${boss.name}` : ""}</h2>
        <p className="mb-3 text-xs text-muted">
          The first two deaths of every wipe (ignoring deaths during the wipe itself). Fix these and the pull keeps going.
        </p>
        {ws.pulls.length === 0 ? (
          <p className="text-sm text-muted">No wipes with deaths before the wipe.</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <table className="data">
              <thead>
                <tr>
                  <th>Spell</th>
                  <th className="num">Wipes started</th>
                  <th className="num" title="Times it was the very first death">
                    1st death
                  </th>
                </tr>
              </thead>
              <tbody>
                {ws.spells.slice(0, 10).map((s) => (
                  <tr key={s.ability.id}>
                    <td>
                      <AbilityName ability={s.ability} />
                    </td>
                    <td className="num font-semibold text-bad">{s.count}</td>
                    <td className="num">{s.firsts || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="data">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Wipes started</th>
                  <th className="num">1st death</th>
                </tr>
              </thead>
              <tbody>
                {ws.players.slice(0, 10).map((s) => (
                  <tr key={s.player.id}>
                    <td>
                      <PlayerName player={s.player} />
                    </td>
                    <td className="num font-semibold text-bad">{s.count}</td>
                    <td className="num">{s.firsts || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="max-h-96 overflow-y-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Pull</th>
                    <th>First deaths</th>
                  </tr>
                </thead>
                <tbody>
                  {ws.pulls.map(({ pull, deaths }) => (
                    <tr key={pull.detail.fight.id}>
                      <td className="whitespace-nowrap">
                        <Link prefetch={false} href={`/report/${code}/fight/${pull.detail.fight.id}`} className="text-info hover:underline">
                          #{pullNo[pull.detail.fight.id]}
                        </Link>{" "}
                        <span className="text-xs" style={{ color: progressColor(pct(pull)) }}>
                          {pct(pull).toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-xs">
                        {deaths.map((d, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-muted"> → </span>}
                            <PlayerName player={d.player} />{" "}
                            <span className="text-muted">
                              {fmtTime(d.t)} {d.ability?.name ?? "?"}
                            </span>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
