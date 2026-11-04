import Link from "next/link";
import { AbilityName, Breadcrumbs, ErrorBox, PlayerName, Stat } from "@/components/ui";
import { analyzeFight, type FightAnalysis } from "@/lib/analysis";
import { getFight, getReport } from "@/lib/data";
import { abilityIconUrl, classColor, diffName, fmtDate, fmtNum, fmtTime, progressColor } from "@/lib/format";
import { fetchForeignKill, fetchGuildHome, fetchKillTargets, fetchPhaseDamage, type ForeignKill, type KillTargets, type PhaseDamage } from "@/lib/wcl";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; fightId: string }>;
  searchParams: Promise<{ guild?: string }>;
}) {
  const { code, fightId } = await params;
  const wantedGuild = Number((await searchParams).guild) || null;

  let a: FightAnalysis;
  let targets: KillTargets;
  let them: ForeignKill | null = null;
  let ourPD: PhaseDamage | null = null;
  let theirPD: PhaseDamage | null = null;
  let pullNo = 0;
  try {
    const [detail, report, home] = await Promise.all([getFight(code, Number(fightId)), getReport(code), fetchGuildHome()]);
    a = analyzeFight(detail);
    const f = detail.fight;
    pullNo = report.fights.filter((x) => x.encounterId === f.encounterId && x.difficulty === f.difficulty).findIndex((x) => x.id === f.id) + 1;
    if (!home.zone) throw new Error("No current raid found.");
    // our first kill of this boss, if any: compare with guilds that killed it just before us
    const ourKills = home.zoneReports
      .flatMap((r) => r.fights.filter((x) => x.encounterId === f.encounterId && x.difficulty === f.difficulty && x.kill).map((x) => r.startTime + x.startTime))
      .sort((x, y) => x - y);
    targets = await fetchKillTargets(f.encounterId, f.difficulty ?? 5, home.zone.id, home.guild.region.toUpperCase(), ourKills[0] ?? null);
    // the chosen guild first, then the closest ones; skip guilds whose logs are private
    const order = [
      ...targets.candidates.filter((c) => c.guildId === wantedGuild),
      ...targets.candidates.filter((c) => c.guildId !== wantedGuild),
    ].slice(0, 4);
    const ourLast = f.kill ? null : (a.phases.at(-1)?.id ?? null);
    for (const pick of order) {
      them = await fetchForeignKill(pick, f.encounterId, f.difficulty ?? 5, ourLast);
      if (them) break;
    }
    if (them) {
      [ourPD, theirPD] = await Promise.all([
        fetchPhaseDamage(code, f.id, null),
        fetchPhaseDamage(them.code, them.fightId, them.windowMs, { anyGuild: true }),
      ]);
    }
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }

  const f = a.detail.fight;
  const pct = f.kill ? 0 : (f.fightPercentage ?? f.bossPercentage ?? 100);
  const crumbs = [
    { label: a.detail.report.title, href: `/report/${code}` },
    { label: `${f.name} ${diffName(f.difficulty)}`, href: `/report/${code}/boss/${f.encounterId}?difficulty=${f.difficulty ?? ""}` },
    { label: `Pull ${pullNo}`, href: `/report/${code}/fight/${f.id}` },
    { label: "Compare with a kill" },
  ];
  if (!them) {
    return (
      <div>
        <Breadcrumbs items={crumbs} />
        <p className="text-muted">
          No public kill log of {f.name} on this difficulty found for guilds near our rank yet. Rankings refresh weekly.
        </p>
      </div>
    );
  }
  const c = them.candidate;
  const ourMin = a.durationMs / 60000;
  const theirMin = them.windowMs / 60000;
  const blamed = a.deaths.filter((d) => !d.inWipe);

  // ---- phases side by side: when reached, time spent, damage and DPS
  const agg = (pd: PhaseDamage | null) => {
    const m = new Map<number, { reached: number; ms: number; damage: number }>();
    for (const g of pd?.segments ?? []) {
      const e = m.get(g.id) ?? { reached: g.startMs, ms: 0, damage: 0 };
      e.ms += g.endMs - g.startMs;
      e.damage += g.damage;
      m.set(g.id, e);
    }
    return m;
  };
  const ours = agg(ourPD);
  const theirs = agg(theirPD);
  const phaseIds = [...new Set([...ours.keys(), ...theirs.keys(), ...a.phases.map((p) => p.id), ...them.phases.map((p) => p.id)])];
  const phaseRows = phaseIds
    .map((id) => ({
      id,
      name: a.phases.find((p) => p.id === id)?.name ?? them!.phases.find((p) => p.id === id)?.name ?? `Phase ${id}`,
      intermission: them!.phases.find((p) => p.id === id)?.isIntermission ?? a.phases.find((p) => p.id === id)?.isIntermission ?? false,
      ours: ours.get(id) ?? null,
      theirs: theirs.get(id) ?? null,
    }))
    .sort((x, y) => (x.theirs?.reached ?? x.ours?.reached ?? 0) - (y.theirs?.reached ?? y.ours?.reached ?? 0));
  const total = (m: Map<number, { ms: number; damage: number }>) => {
    const t = [...m.values()].reduce((acc, v) => ({ ms: acc.ms + v.ms, damage: acc.damage + v.damage }), { ms: 0, damage: 0 });
    return { ...t, dps: t.damage / Math.max(1, t.ms / 1000) };
  };
  const ourTotal = total(ours);
  const theirTotal = total(theirs);
  const phaseOf = (pd: PhaseDamage | null, t: number) => {
    const g = (pd?.segments ?? []).findLast((x) => x.startMs <= t);
    return g ? (phaseRows.find((p) => p.id === g.id)?.name ?? null) : null;
  };
  const pctDiff = (us: number, them: number) => (them > 0 ? Math.round((us / them - 1) * 100) : 0);

  // ---- damage taken per minute, matched by spell name
  const spells = new Map<string, { name: string; icon?: string; id: number; ours: number; oursHits: number; theirs: number; theirsHits: number }>();
  for (const s of a.abilities) {
    const e = spells.get(s.ability.name) ?? { name: s.ability.name, icon: s.ability.icon, id: s.ability.id, ours: 0, oursHits: 0, theirs: 0, theirsHits: 0 };
    e.ours += s.total;
    e.oursHits += s.hits;
    spells.set(s.ability.name, e);
  }
  for (const s of them.damageTaken) {
    const e = spells.get(s.name) ?? { name: s.name, icon: s.icon, id: s.id, ours: 0, oursHits: 0, theirs: 0, theirsHits: 0 };
    e.theirs += s.total;
    e.theirsHits += s.hits;
    spells.set(s.name, e);
  }
  const rows = [...spells.values()]
    .map((s) => ({ ...s, oursPm: s.ours / ourMin, theirsPm: s.theirs / theirMin, oursHpm: s.oursHits / ourMin, theirsHpm: s.theirsHits / theirMin }))
    .filter((s) => s.oursPm + s.theirsPm > 0)
    .sort((x, y) => y.oursPm - y.theirsPm - (x.oursPm - x.theirsPm));
  const maxPm = Math.max(1, ...rows.map((r) => Math.max(r.oursPm, r.theirsPm)));
  const ourTotalPm = rows.reduce((s, r) => s + r.oursPm, 0);
  const theirTotalPm = rows.reduce((s, r) => s + r.theirsPm, 0);

  const ourDeathSpells = new Map<string, number>();
  for (const d of blamed) ourDeathSpells.set(d.ability?.name ?? "Unknown", (ourDeathSpells.get(d.ability?.name ?? "Unknown") ?? 0) + 1);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={crumbs} />
      <div>
        <h1 className="text-2xl font-bold">
          {f.name} — our pull {pullNo} vs a kill by {c.guildName}
        </h1>
        <p className="text-sm text-muted">
          {them.windowMs < them.durationMs
            ? `Their kill is cut at ${fmtTime(them.windowMs)}, the end of the phase our pull reached, so both sides cover the same part of the fight.`
            : "Both sides cover the whole fight."}{" "}
          Damage is compared per minute.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-4">
          <div className="text-xs text-muted uppercase">Us · Requiem{targets.ourRank ? ` · world #${targets.ourRank}` : ""}</div>
          <div className="mt-1 text-xl font-semibold">
            Pull {pullNo}{" "}
            <span style={{ color: progressColor(pct, f.kill) }}>{f.kill ? "Kill" : `${pct.toFixed(1)}%`}</span>
          </div>
          <div className="mt-1 text-sm text-muted">
            {fmtTime(a.durationMs)} · {blamed.length} deaths before the wipe · raid DPS {fmtNum(a.raidDps)}
          </div>
        </div>
        <div className="panel p-4">
          <div className="text-xs text-muted uppercase">
            Them · {c.guildName} ({c.server} {c.region}){c.worldRank ? ` · world #${c.worldRank}` : ""}
          </div>
          <div className="mt-1 text-xl font-semibold">
            <span style={{ color: progressColor(0, true) }}>Kill</span> on {fmtDate(c.killTime)}
          </div>
          <div className="mt-1 text-sm text-muted">
            {fmtTime(them.durationMs)} · {c.deaths} deaths in the kill · raid DPS {fmtNum(them.raidDps)}
            {them.windowMs < them.durationMs && " (in the compared part)"} · {c.comp.tanks} tanks, {c.comp.healers} healers, {c.comp.melee} melee,{" "}
            {c.comp.ranged} ranged ·{" "}
            <a className="text-info hover:underline" href={`https://www.warcraftlogs.com/reports/${them.code}#fight=${them.fightId}`} target="_blank" rel="noreferrer">
              their log ↗
            </a>
          </div>
        </div>
      </div>

      {targets.candidates.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Other {targets.candidates[0]?.region} guilds close to our rank:</span>
          {targets.candidates.map((x) => (
            <Link
              prefetch={false}
              key={x.guildId}
              href={`/report/${code}/fight/${f.id}/compare?guild=${x.guildId}`}
              className={`rounded border px-2 py-0.5 ${x.guildId === c.guildId ? "border-accent text-accent" : "border-line text-muted hover:text-fg"}`}
            >
              {x.guildName} <span className="opacity-70">{x.region}{x.worldRank ? ` #${x.worldRank}` : ""}</span>
            </Link>
          ))}
          <span className="text-muted/70">· rankings refresh weekly</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Damage taken / min" value={fmtNum(ourTotalPm)} sub={`them ${fmtNum(theirTotalPm)} (${theirTotalPm ? Math.round((ourTotalPm / theirTotalPm - 1) * 100) : 0}% ${ourTotalPm >= theirTotalPm ? "more" : "less"})`} />
        <Stat label="Raid DPS" value={fmtNum(ourTotal.dps)} sub={`them ${fmtNum(theirTotal.dps)} (${pctDiff(ourTotal.dps, theirTotal.dps)}%)`} />
        <Stat label="Deaths before wipe" value={blamed.length} sub={`them ${them.deaths.length} in the compared part`} />
        <Stat label="Duration" value={fmtTime(a.durationMs)} sub={`their kill ${fmtTime(them.durationMs)}`} />
      </div>

      <section className="panel p-4">
        <h2 className="h2">Phases: timing, damage and DPS</h2>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th rowSpan={2} className="align-bottom">Phase</th>
                <th colSpan={3} className="text-center">Reached at</th>
                <th colSpan={2} className="text-center">Time in phase</th>
                <th colSpan={3} className="text-center">Raid DPS</th>
                <th colSpan={2} className="text-center">Damage done</th>
              </tr>
              <tr>
                <th className="num">Us</th>
                <th className="num">Them</th>
                <th className="num">Diff</th>
                <th className="num">Us</th>
                <th className="num">Them</th>
                <th className="num">Us</th>
                <th className="num">Them</th>
                <th className="num">Diff</th>
                <th className="num">Us</th>
                <th className="num">Them</th>
              </tr>
            </thead>
            <tbody>
              {phaseRows.map((p) => {
                const diff = p.ours && p.theirs ? p.ours.reached - p.theirs.reached : null;
                const ourDps = p.ours ? p.ours.damage / Math.max(1, p.ours.ms / 1000) : null;
                const theirDps = p.theirs ? p.theirs.damage / Math.max(1, p.theirs.ms / 1000) : null;
                const dd = ourDps != null && theirDps != null ? pctDiff(ourDps, theirDps) : null;
                return (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      {p.intermission && <span className="ml-2 text-xs text-muted">intermission</span>}
                    </td>
                    <td className="num">{p.ours ? fmtTime(p.ours.reached) : <span className="text-muted">not reached</span>}</td>
                    <td className="num">{p.theirs ? fmtTime(p.theirs.reached) : "—"}</td>
                    <td className={`num ${diff == null ? "text-muted" : diff > 5000 ? "text-bad" : diff < -5000 ? "text-good" : ""}`}>
                      {diff == null ? "—" : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${fmtTime(Math.abs(diff))}`}
                    </td>
                    <td className="num">{p.ours ? fmtTime(p.ours.ms) : "—"}</td>
                    <td className="num">{p.theirs ? fmtTime(p.theirs.ms) : "—"}</td>
                    <td className="num">{ourDps != null ? fmtNum(ourDps) : "—"}</td>
                    <td className="num">{theirDps != null ? fmtNum(theirDps) : "—"}</td>
                    <td className={`num ${dd == null ? "text-muted" : dd <= -5 ? "text-bad" : dd >= 5 ? "text-good" : ""}`}>
                      {dd == null ? "—" : `${dd > 0 ? "+" : ""}${dd}%`}
                    </td>
                    <td className="num">{p.ours ? fmtNum(p.ours.damage) : "—"}</td>
                    <td className="num">{p.theirs ? fmtNum(p.theirs.damage) : "—"}</td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <td>Total{them.windowMs < them.durationMs ? " (compared part)" : ""}</td>
                <td className="num" colSpan={3} />
                <td className="num">{fmtTime(ourTotal.ms)}</td>
                <td className="num">{fmtTime(theirTotal.ms)}</td>
                <td className="num">{fmtNum(ourTotal.dps)}</td>
                <td className="num">{fmtNum(theirTotal.dps)}</td>
                <td className={`num ${pctDiff(ourTotal.dps, theirTotal.dps) <= -5 ? "text-bad" : pctDiff(ourTotal.dps, theirTotal.dps) >= 5 ? "text-good" : ""}`}>
                  {pctDiff(ourTotal.dps, theirTotal.dps) > 0 ? "+" : ""}
                  {pctDiff(ourTotal.dps, theirTotal.dps)}%
                </td>
                <td className="num">{fmtNum(ourTotal.damage)}</td>
                <td className="num">{fmtNum(theirTotal.damage)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Damage done to everything (boss and adds), by the whole raid including pets.</p>
      </section>

      <section className="panel p-4">
        <h2 className="h2">Bloodlust / Heroism / Time Warp</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { label: "Us", pd: ourPD },
            { label: `Them (${c.guildName})`, pd: theirPD },
          ].map(({ label, pd }) => (
            <div key={label}>
              <div className="mb-1 text-xs text-muted uppercase">{label}</div>
              {!pd?.lust.length ? (
                <p className="text-sm text-muted">No Bloodlust cast{label === "Us" ? " in this pull" : " in the compared part"}.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {pd.lust.map((l, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="w-12 font-semibold tabular-nums text-accent">{fmtTime(l.t)}</span>
                      <span>{l.spell}</span>
                      <span className="text-muted">
                        by <span style={{ color: classColor(l.className) }}>{l.caster}</span>
                        {phaseOf(pd, l.t) ? ` · ${phaseOf(pd, l.t)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="h2">Damage taken per minute, by spell</h2>
        <p className="mb-3 text-xs text-muted">
          Raid-wide damage from enemies per minute of fight. Sorted by how much more we take than them: the top rows are the mechanics we handle
          worse. <span className="font-semibold text-bad">They took none</span> usually means a mechanic they avoided completely.
        </p>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Spell</th>
                <th className="w-1/4">Us / min</th>
                <th className="w-1/4">Them / min</th>
                <th className="num">Hits / min (us · them)</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((r) => {
                const ratio = r.theirsPm > 0 ? r.oursPm / r.theirsPm : null;
                const icon = abilityIconUrl(r.icon);
                return (
                  <tr key={r.name}>
                    <td>
                      <span className="inline-flex items-center gap-1.5">
                        {icon && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={icon} alt="" width={16} height={16} className="rounded-sm" />
                        )}
                        {r.id > 1 ? (
                          <a href={`https://www.wowhead.com/spell=${r.id}`} target="_blank" rel="noreferrer" className="hover:underline">
                            {r.name}
                          </a>
                        ) : (
                          r.name
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="w-14 text-right tabular-nums">{fmtNum(r.oursPm)}</span>
                        <div className="h-2 flex-1 rounded bg-panel-2">
                          <div className="h-2 rounded bg-accent" style={{ width: `${(r.oursPm / maxPm) * 100}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="w-14 text-right tabular-nums">{fmtNum(r.theirsPm)}</span>
                        <div className="h-2 flex-1 rounded bg-panel-2">
                          <div className="h-2 rounded bg-info" style={{ width: `${(r.theirsPm / maxPm) * 100}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="num text-muted">
                      {r.oursHpm.toFixed(1)} · {r.theirsHpm.toFixed(1)}
                    </td>
                    <td className="num">
                      {r.theirsPm === 0 ? (
                        <span className="rounded bg-bad/85 px-1.5 py-0.5 text-[11px] font-semibold text-white">they took none</span>
                      ) : r.oursPm === 0 ? (
                        <span className="text-xs text-muted">we took none</span>
                      ) : (
                        <span className={ratio! >= 1.5 ? "font-semibold text-bad" : ratio! <= 0.67 ? "text-good" : "text-muted"}>×{ratio!.toFixed(1)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-4">
          <h2 className="h2">Our deaths before the wipe</h2>
          {blamed.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <table className="data">
              <tbody>
                {blamed.map((d, i) => (
                  <tr key={i}>
                    <td className="tabular-nums">{fmtTime(d.t)}</td>
                    <td>
                      <PlayerName player={d.player} />
                    </td>
                    <td>
                      <AbilityName ability={d.ability} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel p-4">
          <h2 className="h2">Their deaths{them.windowMs < them.durationMs ? " (compared part)" : ""}</h2>
          {them.deaths.length === 0 ? (
            <p className="text-sm text-good">Nobody died.</p>
          ) : (
            <table className="data">
              <tbody>
                {them.deaths.map((d, i) => (
                  <tr key={i}>
                    <td className="tabular-nums">{fmtTime(d.t)}</td>
                    <td style={{ color: classColor(d.className) }}>{d.player}</td>
                    <td className={ourDeathSpells.has(d.ability ?? "Unknown") ? "text-warn" : ""}>{d.ability ?? "Unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
