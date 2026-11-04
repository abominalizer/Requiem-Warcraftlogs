import { type BossGroup, PullSelector } from "@/components/PullSelector";
import { Breadcrumbs, ErrorBox } from "@/components/ui";
import { getReport, MAX_PULLS } from "@/lib/data";
import { diffName, fmtDate } from "@/lib/format";
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

  const bossGroups: BossGroup[] = [...groups.values()].map((fights) => {
    const f0 = fights[0];
    const pct = (f: Fight) => (f.kill ? 0 : (f.fightPercentage ?? f.bossPercentage ?? 100));
    return {
      key: `${f0.encounterId}:${f0.difficulty}`,
      name: f0.name,
      difficultyName: diffName(f0.difficulty),
      encounterId: f0.encounterId,
      difficulty: f0.difficulty,
      killed: fights.some((f) => f.kill),
      best: Math.min(...fights.map(pct)),
      pulls: fights.map((f, i) => ({
        id: f.id,
        pullNo: i + 1,
        pct: pct(f),
        kill: f.kill,
        phase: f.lastPhase,
        durationMs: f.endTime - f.startTime,
      })),
    };
  });

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

      <PullSelector code={code} groups={bossGroups} maxPulls={MAX_PULLS} />
    </div>
  );
}
