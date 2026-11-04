import Link from "next/link";
import { Breadcrumbs, ErrorBox } from "@/components/ui";
import { getReport } from "@/lib/data";
import { diffName, fmtDate, fmtTime, progressColor } from "@/lib/format";
import type { Fight, ReportSummary } from "@/lib/types";

export default async function ReportPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let report: ReportSummary;
  try {
    report = await getReport(code);
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }

  const groups = new Map<string, Fight[]>();
  for (const f of report.fights) {
    const k = `${f.encounterId}:${f.difficulty}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: report.guild?.name ?? "Home", href: "/" },
          { label: report.title },
        ]}
      />
      <h1 className="text-2xl font-bold">{report.title}</h1>
      <p className="mb-6 text-sm text-muted">
        {report.zone} · {fmtDate(report.startTime)} · {report.fights.length} boss pulls
        {code !== "demo" && (
          <>
            {" · "}
            <a className="text-info" href={`https://www.warcraftlogs.com/reports/${code}`} target="_blank" rel="noreferrer">
              View on Warcraft Logs
            </a>
          </>
        )}
      </p>

      {groups.size === 0 && <p className="text-muted">No boss encounters in this report.</p>}

      <div className="space-y-6">
        {[...groups.values()].map((fights) => {
          const f0 = fights[0];
          const kill = fights.find((f) => f.kill);
          const best = Math.min(...fights.map((f) => f.fightPercentage ?? f.bossPercentage ?? 100));
          return (
            <section key={`${f0.encounterId}:${f0.difficulty}`} className="panel p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    {f0.name} <span className="text-sm text-muted">{diffName(f0.difficulty)}</span>
                  </h2>
                  <p className="text-xs text-muted">
                    {fights.length} pull{fights.length > 1 ? "s" : ""} ·{" "}
                    {kill ? <span style={{ color: progressColor(0, true) }}>Killed</span> : <>Best: <span style={{ color: progressColor(best) }}>{best.toFixed(1)}%</span></>}
                  </p>
                </div>
                <Link
                  href={`/report/${code}/boss/${f0.encounterId}?difficulty=${f0.difficulty ?? ""}`}
                  className="rounded-lg border border-accent/60 px-3 py-1.5 text-sm text-accent hover:bg-accent/10"
                >
                  Progression analysis →
                </Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {fights.map((f, i) => {
                  const pct = f.kill ? 0 : (f.fightPercentage ?? f.bossPercentage ?? 100);
                  return (
                    <Link
                      key={f.id}
                      href={`/report/${code}/fight/${f.id}`}
                      className="rounded-lg border border-line bg-panel-2 px-3 py-2 hover:border-accent/60"
                    >
                      <div className="flex justify-between text-sm">
                        <span>
                          Pull {i + 1}{" "}
                          <span className="font-semibold" style={{ color: progressColor(pct, f.kill) }}>{f.kill ? "Kill" : `${pct.toFixed(1)}%`}</span>
                        </span>
                        <span className="text-muted tabular-nums">
                          {f.lastPhase ? `P${f.lastPhase} · ` : ""}
                          {fmtTime(f.endTime - f.startTime)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded bg-bg">
                        <div
                          className="h-1.5 rounded"
                          style={{ width: `${100 - pct}%`, background: progressColor(pct, f.kill) }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
