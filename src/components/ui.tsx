import Link from "next/link";
import { abilityIconUrl, classColor, fmtTime } from "@/lib/format";
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
    <span className="inline-flex items-center gap-1.5" title={`Spell ID ${ability.id}`}>
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
        {phases.map((p, i) => (
          <div
            key={i}
            className="absolute top-0 h-full border-l border-line"
            style={{ left: pct(p.start), width: pct(p.end - p.start), background: i % 2 ? "#ffffff06" : "transparent" }}
          >
            <span className="absolute top-0.5 left-1 truncate text-[10px] text-muted">{p.name}</span>
          </div>
        ))}
        {deaths.map((d, i) => (
          <div
            key={i}
            className="absolute bottom-1 h-4 w-1.5 -translate-x-1/2 rounded-sm"
            style={{ left: pct(d.t), background: d.muted ? "#6b7280" : "var(--color-bad)" }}
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
