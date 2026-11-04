import Link from "next/link";
import { Breadcrumbs, ErrorBox, Stat } from "@/components/ui";
import { diffName, fmtDate, fmtHours, fmtTime, progressColor } from "@/lib/format";
import type { GuildHome } from "@/lib/types";
import { fetchGuildHome } from "@/lib/wcl";

export const dynamic = "force-dynamic";

/** Every pull of one boss across all logs of the current raid, grouped by raid night. */
export default async function BossPullsPage({
  params,
  searchParams,
}: {
  params: Promise<{ encounterId: string }>;
  searchParams: Promise<{ difficulty?: string }>;
}) {
  const encounterId = Number((await params).encounterId);
  const wanted = (await searchParams).difficulty;
  let home: GuildHome;
  try {
    home = await fetchGuildHome();
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }

  const all = home.zoneReports.flatMap((r) => r.fights.filter((f) => f.encounterId === encounterId).map((f) => ({ ...f, report: r })));
  const difficulties = [...new Set(all.map((p) => p.difficulty ?? 0))].sort((a, b) => b - a);
  const difficulty = wanted && difficulties.includes(Number(wanted)) ? Number(wanted) : difficulties[0];
  const pulls = all.filter((p) => (p.difficulty ?? 0) === difficulty);
  const name = home.zone?.encounters.find((e) => e.id === encounterId)?.name ?? pulls[0]?.name ?? `Boss ${encounterId}`;

  if (!pulls.length) return <ErrorBox message={`No pulls of ${name} in this raid's logs.`} />;

  const chronological = [...pulls].sort((a, b) => a.report.startTime + a.startTime - (b.report.startTime + b.startTime));
  const firstKill = chronological.find((p) => p.kill);
  const best = Math.min(...pulls.map((p) => p.percent));
  const time = pulls.reduce((s, p) => s + (p.endTime - p.startTime), 0);

  // raid nights, newest first; pulls numbered within each night like on the report page
  const nights = home.zoneReports
    .map((r) => ({ report: r, pulls: r.fights.filter((f) => f.encounterId === encounterId && (f.difficulty ?? 0) === difficulty) }))
    .filter((n) => n.pulls.length > 0);
  const overall = new Map(chronological.map((p, i) => [`${p.report.code}:${p.id}`, i + 1]));

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: `${name} ${diffName(difficulty)}` }]} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {name} <span className="text-base text-muted">{diffName(difficulty)} · all pulls</span>
          </h1>
          <p className="text-sm text-muted">{home.zone?.name}</p>
        </div>
        {difficulties.length > 1 && (
          <div className="flex gap-1 text-sm">
            {difficulties.map((d) => (
              <Link
                prefetch={false}
                key={d}
                href={`/boss/${encounterId}?difficulty=${d}`}
                className={`rounded-lg border px-3 py-1 ${d === difficulty ? "border-accent text-accent" : "border-line text-muted hover:text-fg"}`}
              >
                {diffName(d)}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Pulls" value={pulls.length} sub={`over ${nights.length} raid night${nights.length > 1 ? "s" : ""}`} />
        <Stat
          label="Result"
          value={
            firstKill ? (
              <span style={{ color: progressColor(0, true) }}>Killed</span>
            ) : (
              <span style={{ color: progressColor(best) }}>Best {best.toFixed(1)}%</span>
            )
          }
          sub={firstKill ? `first kill ${fmtDate(firstKill.report.startTime + firstKill.startTime)}, pull ${chronological.indexOf(firstKill) + 1}` : undefined}
        />
        <Stat label="Time on boss" value={fmtHours(time)} />
        <Stat label="Avg pull" value={fmtTime(time / pulls.length)} />
      </div>

      {nights.map(({ report, pulls: np }) => {
        const nightBest = Math.min(...np.map((p) => p.percent));
        const killed = np.some((p) => p.kill);
        return (
          <section key={report.code} className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">
                  <Link prefetch={false} href={`/report/${report.code}`} className="hover:text-accent">
                    {fmtDate(report.startTime)}
                  </Link>
                </h2>
                <p className="text-xs text-muted">
                  {np.length} pull{np.length > 1 ? "s" : ""} ·{" "}
                  {killed ? (
                    <span style={{ color: progressColor(0, true) }}>Killed</span>
                  ) : (
                    <>
                      best <span style={{ color: progressColor(nightBest) }}>{nightBest.toFixed(1)}%</span>
                    </>
                  )}
                </p>
              </div>
              <Link
                prefetch={false}
                href={`/report/${report.code}/boss/${encounterId}?difficulty=${difficulty}`}
                className="rounded-lg border border-accent/60 px-3 py-1.5 text-sm text-accent hover:bg-accent/10"
              >
                Progression analysis →
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {np.map((f, i) => {
                const color = progressColor(f.percent, f.kill);
                return (
                  <Link
                    prefetch={false}
                    key={f.id}
                    href={`/report/${report.code}/fight/${f.id}`}
                    className="rounded-lg border border-line bg-panel-2 px-3 py-2 hover:border-accent/60"
                    title={`Pull ${overall.get(`${report.code}:${f.id}`)} overall`}
                  >
                    <div className="flex justify-between text-sm">
                      <span>
                        Pull {i + 1}{" "}
                        <span className="font-semibold" style={{ color }}>
                          {f.kill ? "Kill" : `${f.percent.toFixed(1)}%`}
                        </span>
                      </span>
                      <span className="text-muted tabular-nums">
                        {f.lastPhase ? `P${f.lastPhase} · ` : ""}
                        {fmtTime(f.endTime - f.startTime)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded bg-bg">
                      <div className="h-1.5 rounded" style={{ width: `${100 - f.percent}%`, background: color }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
