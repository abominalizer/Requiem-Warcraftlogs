import Link from "next/link";
import { ErrorBox } from "@/components/ui";
import { GUILD_ID } from "@/config/guild";
import { fmtDate, fmtHours, progressColor } from "@/lib/format";
import type { GuildHome, GuildReportSummary } from "@/lib/types";
import { fetchGuildHome } from "@/lib/wcl";

const DIFF_SHORT: Record<number, string> = { 1: "LFR", 3: "N", 4: "H", 5: "M" };
const diffShort = (d: number | null) => (d != null ? (DIFF_SHORT[d] ?? `D${d}`) : "");

interface BossProgress {
  id: number;
  name: string;
  difficulty: number | null;
  killed: boolean;
  firstKill: number | null;
  best: number;
  pulls: number;
  /** first kill's pull page if killed, otherwise the list of all pulls */
  link: string | null;
  pullsLink: string | null;
}

/** Progress per boss at the highest difficulty the guild has pulled it on, over every log of the raid. */
function bossProgress(home: GuildHome): BossProgress[] {
  if (!home.zone) return [];
  return home.zone.encounters.map((enc) => {
    const pulls = home.zoneReports
      .flatMap((r) => r.fights.filter((f) => f.encounterId === enc.id).map((f) => ({ ...f, report: r })))
      .sort((a, b) => a.report.startTime + a.startTime - (b.report.startTime + b.startTime)); // oldest first
    const top = Math.max(-1, ...pulls.map((p) => p.difficulty ?? 0));
    const atTop = pulls.filter((p) => (p.difficulty ?? 0) === top);
    const firstKill = atTop.find((p) => p.kill);
    const pullsLink = atTop.length ? `/boss/${enc.id}?difficulty=${top}` : null;
    return {
      id: enc.id,
      name: enc.name,
      difficulty: atTop.length ? top : null,
      killed: Boolean(firstKill),
      firstKill: firstKill ? firstKill.report.startTime + firstKill.startTime : null,
      best: atTop.length ? Math.min(...atTop.map((p) => p.percent)) : 100,
      pulls: atTop.length,
      link: firstKill ? `/report/${firstKill.report.code}/fight/${firstKill.id}` : pullsLink,
      pullsLink,
    };
  });
}

function nightSummary(r: GuildReportSummary) {
  const bosses = new Map<string, { name: string; difficulty: number | null; pulls: number; kill: boolean; best: number; encounterId: number }>();
  for (const f of r.fights) {
    const k = `${f.encounterId}:${f.difficulty}`;
    const b = bosses.get(k) ?? { name: f.name, difficulty: f.difficulty, pulls: 0, kill: false, best: 100, encounterId: f.encounterId };
    b.pulls++;
    b.kill ||= f.kill;
    b.best = Math.min(b.best, f.percent);
    bosses.set(k, b);
  }
  return [...bosses.values()];
}

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  let home: GuildHome;
  try {
    home = await fetchGuildHome();
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }
  const { guild } = home;
  const progress = bossProgress(home);
  const kills = (d: number) => progress.filter((p) => p.difficulty != null && p.difficulty >= d && (p.difficulty > d || p.killed)).length;
  const counts = [5, 4, 3]
    .map((d) => ({ d, n: kills(d) }))
    .filter((x) => x.n > 0);
  const raidNights = home.reports.filter((r) => r.fights.length > 0).slice(0, 12);
  const factionColor = guild.faction === "Horde" ? "#e0453a" : guild.faction === "Alliance" ? "#3b82f6" : "var(--color-muted)";

  return (
    <div className="space-y-6">
      <section className="panel relative overflow-hidden p-6">
        <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: factionColor }} />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">{guild.name}</h1>
            <p className="mt-1 text-muted">
              <span style={{ color: factionColor }}>{guild.faction}</span> guild · {guild.server} ({guild.region.toUpperCase()})
            </p>
          </div>
          <div className="text-right">
            {home.zone && <div className="text-xs text-muted uppercase">{home.zone.name}</div>}
            <div className="text-3xl font-bold tabular-nums">
              {counts.length
                ? counts.map((c, i) => (
                    <span key={c.d} className={i > 0 ? "ml-3 text-xl text-muted" : ""}>
                      {c.n}/{progress.length} {diffShort(c.d)}
                    </span>
                  ))
                : `0/${progress.length}`}
            </div>
            <a
              href={`https://www.warcraftlogs.com/guild/id/${GUILD_ID}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-info hover:underline"
            >
              Warcraft Logs page ↗
            </a>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <section className="panel p-4">
          <h2 className="h2">Progression{home.zone ? ` · ${home.zone.name}` : ""}</h2>
          {progress.length === 0 ? (
            <p className="text-sm text-muted">No raid logs yet.</p>
          ) : (
            <ul className="divide-y divide-line/50">
              {progress.map((b) => {
                const main = (
                  <>
                    <span className="w-7 text-center text-xs font-semibold text-muted">{diffShort(b.difficulty)}</span>
                    <span className="flex-1">
                      <span className={b.pulls ? "" : "text-muted"}>{b.name}</span>
                      <div className="mt-1 h-1.5 rounded bg-bg">
                        <div
                          className="h-1.5 rounded"
                          style={{
                            width: `${b.killed ? 100 : b.pulls ? 100 - b.best : 0}%`,
                            background: progressColor(b.best, b.killed),
                          }}
                        />
                      </div>
                    </span>
                    <span className="w-28 text-right text-sm tabular-nums">
                      {b.killed ? (
                        <span className="text-good">
                          Killed {b.firstKill && new Date(b.firstKill).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                      ) : b.pulls ? (
                        <span>
                          Best <span style={{ color: progressColor(b.best) }}>{b.best.toFixed(1)}%</span>
                        </span>
                      ) : (
                        <span className="text-muted">Not pulled</span>
                      )}
                    </span>
                  </>
                );
                return (
                  <li key={b.id} className="flex items-center gap-1">
                    {b.link ? (
                      <Link
                        prefetch={false}
                        href={b.link}
                        title={b.killed ? "Open the first kill" : "Show all pulls"}
                        className="flex flex-1 items-center gap-3 rounded px-1 py-2 hover:bg-panel-2/60"
                      >
                        {main}
                      </Link>
                    ) : (
                      <div className="flex flex-1 items-center gap-3 px-1 py-2">{main}</div>
                    )}
                    <span className="w-16 text-right text-xs">
                      {b.pullsLink && (
                        <Link prefetch={false} href={b.pullsLink} className="text-muted hover:text-info hover:underline" title="Show all pulls">
                          {b.pulls} pulls
                        </Link>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Based on all {home.zoneReports.length} logs of this raid. Click a boss to open its first kill (or all pulls if not killed yet).{" "}
            <Link prefetch={false} href="/raid" className="text-info hover:underline">
              Mark avoidable spells →
            </Link></p>
        </section>

        <div className="space-y-6">
          <form action="/go" className="panel p-4">
            <h2 className="h2">Open a log</h2>
            <div className="flex gap-2">
              <input
                name="q"
                required
                placeholder="Warcraft Logs report link or code"
                className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:brightness-110">Go</button>
            </div>
            {error === "report" && <p className="mt-2 text-sm text-bad">That doesn&apos;t look like a report link or code.</p>}
          </form>

          <section className="panel p-4">
            <h2 className="h2">Raid nights</h2>
            {raidNights.length === 0 ? (
              <p className="text-sm text-muted">No raid nights logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {raidNights.map((r) => (
                  <li key={r.code}>
                    <Link prefetch={false} href={`/report/${r.code}`} className="block rounded-lg border border-line bg-panel-2 px-3 py-2 hover:border-accent/60">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="font-medium">{fmtDate(r.startTime)}</span>
                        <span className="text-muted tabular-nums">{fmtHours(r.endTime - r.startTime)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {nightSummary(r).map((b) => (
                          <span
                            key={`${b.encounterId}:${b.difficulty}`}
                            className="rounded bg-bg px-1.5 py-0.5 text-[11px] text-muted"
                            style={{ boxShadow: `inset 0 -2px 0 ${progressColor(b.best, b.kill)}` }}
                          >
                            {diffShort(b.difficulty)} {b.name} ·{" "}
                            <span style={{ color: progressColor(b.best, b.kill) }}>{b.kill ? "kill" : `${b.best.toFixed(1)}%`}</span> ({b.pulls})
                          </span>
                        ))}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
