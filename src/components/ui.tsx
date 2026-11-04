import Link from "next/link";
import { abilityIconUrl, classColor, fmtNum, fmtTime } from "@/lib/format";
import type { Ability, Player } from "@/lib/types";
import type { Insight } from "@/lib/analysis";

export function PlayerName({ player }: { player: Player }) {
  return (
    <span style={{ color: classColor(player.className) }} className="font-medium" title={`${player.spec ?? ""} ${player.className}`}>
      {player.name}
    </span>
  );
}

export function AbilityName({ ability }: { ability: Ability | null }) {
  if (!ability) return <span className="text-muted">Unknown</span>;
  const url = abilityIconUrl(ability.icon);
  return (
    <span className="inline-flex items-center gap-1.5">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={16} height={16} className="rounded-sm" />
      )}
      {ability.id > 1 ? (
        <a href={`https://www.wowhead.com/spell=${ability.id}`} target="_blank" rel="noreferrer" className="hover:underline">
          {ability.name}
        </a>
      ) : (
        ability.name
      )}
    </span>
  );
}

export function Bar({ value, max, color = "var(--color-accent)" }: { value: number; max: number; color?: string }) {
  return (
    <div className="h-2 w-full rounded bg-panel-2">
      <div className="h-2 rounded" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color }} />
    </div>
  );
}

const SEV: Record<Insight["severity"], string> = {
  bad: "border-bad/60 bg-bad/10",
  warn: "border-warn/60 bg-warn/10",
  info: "border-info/50 bg-info/10",
  good: "border-good/60 bg-good/10",
};
const DOT: Record<Insight["severity"], string> = { bad: "bg-bad", warn: "bg-warn", info: "bg-info", good: "bg-good" };

export function InsightList({ insights }: { insights: Insight[] }) {
  if (!insights.length) return <p className="text-sm text-muted">Nothing notable.</p>;
  return (
    <ul className="space-y-2">
      {insights.map((i, k) => (
        <li key={k} className={`rounded-lg border px-3 py-2 ${SEV[i.severity]}`}>
          <div className="flex items-start gap-2">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[i.severity]}`} />
            <div>
              <div className="text-sm">{i.title}</div>
              {i.detail && <div className="mt-0.5 text-xs text-muted">{i.detail}</div>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs text-muted uppercase">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span>/</span>}
          {it.href ? (
            <Link prefetch={false} href={it.href} className="hover:text-fg">
              {it.label}
            </Link>
          ) : (
            <span className="text-fg">{it.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/** Horizontal fight timeline with phase bands and death markers. */
const PHASE_TINTS = ["#5aa9ff", "#a78bfa", "#f5a524", "#3ccf7e", "#f472b6"];

export function Timeline({
  duration,
  phases,
  deaths,
}: {
  duration: number;
  phases: { name: string; start: number; end: number }[];
  deaths: { t: number; player: Player; label: string; muted: boolean }[];
}) {
  const pct = (t: number) => `${Math.min(100, (t / duration) * 100)}%`;
  const ticks = Array.from({ length: Math.floor(duration / 30_000) + 1 }, (_, i) => i * 30_000);
  return (
    <div>
      <div className="relative h-10 overflow-hidden rounded-md bg-panel-2">
        {phases.map((p, i) => {
          const hue = PHASE_TINTS[i % PHASE_TINTS.length];
          return (
            <div
              key={i}
              className="absolute top-0 h-full border-l-2"
              style={{ left: pct(p.start), width: pct(p.end - p.start), background: `${hue}22`, borderColor: `${hue}aa` }}
            >
              <span className="absolute top-0.5 left-1 truncate text-[10px] font-medium" style={{ color: hue }}>
                {p.name}
              </span>
            </div>
          );
        })}
        {deaths.map((d, i) => (
          <div
            key={i}
            className="absolute bottom-1 h-4 w-2 -translate-x-1/2 rounded-sm ring-1"
            style={{
              left: pct(d.t),
              background: classColor(d.player.className),
              opacity: d.muted ? 0.45 : 1,
              ["--tw-ring-color" as string]: d.muted ? "transparent" : "var(--color-bad)",
            }}
            title={`${fmtTime(d.t)} ${d.player.name} — ${d.label}`}
          />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-muted">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: pct(t) }}>
            {fmtTime(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  if (message === "NOT_A_REQUIEM_LOG") return <NiceTry />;
  return (
    <div className="panel border-bad/50 p-6">
      <h2 className="mb-2 font-semibold text-bad">Couldn&apos;t load data</h2>
      <p className="text-sm">{message}</p>
      <p className="mt-3 text-sm text-muted">
        <Link prefetch={false} className="text-info underline" href="/">
          Back to the guild page
        </Link>
      </p>
    </div>
  );
}

function ChipIcon({ icon }: { icon?: string }) {
  const url = abilityIconUrl(icon);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" width={14} height={14} className="rounded-sm" />;
}

const chip = "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5";

/** What the player had at the moment of death: ready-but-unused defensives first. */
export function DefensiveChips({ check }: { check: import("@/lib/analysis").DefensiveCheck | null }) {
  if (!check) return <span className="text-xs text-muted">—</span>;
  const unknown = check.spells.filter((s) => s.status === "unknown");
  return (
    <div className="flex flex-wrap gap-1 text-[11px] leading-tight">
      {check.unsurvivable && (
        <span className={`${chip} border-info/60 bg-info/20 font-semibold text-info`} title="Killed by a spell marked as unsurvivable on the Raid page">
          ☠ can&apos;t be survived
        </span>
      )}
      {check.spells
        .filter((s) => s.status !== "unknown")
        .map((s) =>
          s.status === "ready" && check.unsurvivable ? (
            <span key={s.key} className={`${chip} border-line bg-panel-2 text-muted`} title="Ready, but this death couldn't be prevented">
              <ChipIcon icon={s.icon} />
              ready: {s.key}
            </span>
          ) : s.status === "ready" ? (
            <span key={s.key} className={`${chip} border-bad bg-bad/85 font-semibold text-white`} title="Used earlier tonight, off cooldown, not pressed">
              <ChipIcon icon={s.icon} />
              READY: {s.key}
            </span>
          ) : s.status === "used" ? (
            <span key={s.key} className={`${chip} border-good/70 bg-good/20 text-good`} title="Pressed shortly before dying">
              <ChipIcon icon={s.icon} />✓ {s.key} {s.agoS}s before
            </span>
          ) : (
            <span key={s.key} className={`${chip} border-warn/40 bg-warn/10 text-warn/90`} title={`${s.via ?? s.key} used ${s.agoS}s before dying`}>
              <ChipIcon icon={s.icon} />
              {s.readyInS == null ? `${s.key} already used this pull` : `${s.key} on CD ${s.readyInS}s${s.via ? ` (${s.via})` : ""}`}
            </span>
          ),
        )}
      {check.externals.map((x, i) => (
        <span key={`x${i}`} className={`${chip} border-info/60 bg-info/20 text-info`} title="External cast on them shortly before dying">
          <ChipIcon icon={x.icon} />
          {x.key}
          {x.from ? (
            <>
              {" "}
              from <span style={{ color: classColor(x.from.className) }}>{x.from.name}</span>
            </>
          ) : null}{" "}
          {x.agoS}s before
        </span>
      ))}
      {unknown.length > 0 && (
        <span className="px-0.5 py-0.5 text-muted/70 italic" title="Never cast tonight: maybe not talented, or no healthstone/potions">
          not used tonight: {unknown.map((s) => s.key).join(", ")}
        </span>
      )}
    </div>
  );
}

/** Damage taken just before a death: icons + amounts, killing hit in red. */
export function LastHits({ hits }: { hits: { ability: Ability; amount: number }[] }) {
  if (!hits.length) return <span className="text-xs text-muted">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px] leading-tight">
      {hits.map((h, i) => {
        const last = i === hits.length - 1;
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {i > 0 && <span className="text-muted/60">›</span>}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 ${last ? "bg-bad/20 font-semibold text-bad" : "bg-panel-2 text-fg/80"}`}
            >
              <ChipIcon icon={h.ability.icon} />
              {h.ability.id > 1 ? (
                <a href={`https://www.wowhead.com/spell=${h.ability.id}`} target="_blank" rel="noreferrer" className="hover:underline">
                  {h.ability.name}
                </a>
              ) : (
                h.ability.name
              )}
              <span className={last ? "" : "text-accent"}>{fmtNum(h.amount)}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Shown when someone tries to analyze a log that isn't Requiem's. */
function NiceTry() {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <style>{`
        @keyframes nt-wobble { 0%,100% { transform: rotate(-8deg) } 50% { transform: rotate(8deg) } }
        @keyframes nt-pop { 0% { transform: scale(.6); opacity: 0 } 70% { transform: scale(1.08) } 100% { transform: scale(1); opacity: 1 } }
      `}</style>
      <div className="text-8xl select-none" style={{ animation: "nt-wobble 1.2s ease-in-out infinite" }} aria-hidden>
        🤨
      </div>
      <div style={{ animation: "nt-pop .5s ease-out both" }}>
        <p className="mt-6 text-sm tracking-widest text-muted uppercase">This doesn&apos;t appear to be a Requiem log</p>
        <h1 className="mt-2 text-5xl font-black tracking-tight sm:text-6xl">
          Nice try, you <span className="text-accent">dofus</span>.
        </h1>
      </div>
      <div className="panel mt-8 max-w-xl p-5 text-left text-sm">
        <p className="font-semibold text-bad">Log rejected. Reasons may include:</p>
        <ul className="mt-2 space-y-1 text-muted">
          <li>☠ Too many deaths to Melee</li>
          <li>🪑 Healers were the top DPS</li>
          <li>🧯 Standing in fire was listed as a raid strategy</li>
          <li>🔍 We searched for a Requiem raider in it and found none</li>
        </ul>
        <p className="mt-3 text-muted">
          This analyzer only parses <span className="text-accent">greatness</span>. Upload your own logs somewhere else, or apply to Requiem and come back
          with a real one.
        </p>
      </div>
      <Link
        prefetch={false}
        href="/"
        className="mt-8 rounded-lg bg-accent px-5 py-2 font-semibold text-black hover:brightness-110"
      >
        Take me back to the good logs
      </Link>
    </div>
  );
}
