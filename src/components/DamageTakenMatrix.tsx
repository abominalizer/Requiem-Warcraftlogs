"use client";

import { useMemo, useState } from "react";
import { SpellTip } from "@/components/SpellTip";
import { PlayerName } from "@/components/ui";
import { abilityIconUrl, fmtNum } from "@/lib/format";
import type { Ability, Player } from "@/lib/types";

const COLUMNS = 8;
const CHIPS_COLLAPSED = 16;

export interface MatrixSpell {
  ability: Ability;
  total: number;
}

export interface MatrixRow {
  player: Player;
  abilities: Record<number, number>;
}

/** Player x spell damage-taken table where spells can be switched off; totals and order follow the selection. */
export function DamageTakenMatrix({ spells, rows }: { spells: MatrixSpell[]; rows: MatrixRow[] }) {
  const [off, setOff] = useState<Set<number>>(new Set());
  const [sortBy, setSortBy] = useState<number | null>(null); // spell id, or null = total
  const [showAll, setShowAll] = useState(false);

  const enabled = useMemo(() => spells.filter((s) => !off.has(s.ability.id)), [spells, off]);
  const columns = enabled.slice(0, COLUMNS);

  const table = useMemo(() => {
    const withTotals = rows.map((r) => ({
      ...r,
      total: enabled.reduce((sum, s) => sum + (r.abilities[s.ability.id] ?? 0), 0),
    }));
    const key = (r: (typeof withTotals)[number]) => (sortBy != null ? (r.abilities[sortBy] ?? 0) : r.total);
    return withTotals.sort((a, b) => key(b) - key(a) || b.total - a.total);
  }, [rows, enabled, sortBy]);

  const maxTotal = Math.max(1, ...table.map((r) => r.total));
  const colMax = new Map(columns.map((c) => [c.ability.id, Math.max(1, ...rows.map((r) => r.abilities[c.ability.id] ?? 0))]));

  const toggle = (id: number) => {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (sortBy === id) setSortBy(null);
  };

  const chips = showAll ? spells : spells.slice(0, CHIPS_COLLAPSED);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted">Spells:</span>
        {chips.map((s) => {
          const on = !off.has(s.ability.id);
          const icon = abilityIconUrl(s.ability.icon);
          return (
            <button
              key={s.ability.id}
              onClick={() => toggle(s.ability.id)}
              aria-label={`${on ? "Hide" : "Show"} ${s.ability.name} (${fmtNum(s.total)})`}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                on ? "border-accent/60 bg-accent/15 text-fg" : "border-line text-muted line-through opacity-60"
              }`}
            >
              {icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={icon} alt="" width={14} height={14} className="rounded-sm" />
              )}
              <SpellTip id={s.ability.id}>{s.ability.name}</SpellTip>
            </button>
          );
        })}
        {spells.length > CHIPS_COLLAPSED && (
          <button className="px-1 text-xs text-info hover:underline" onClick={() => setShowAll(!showAll)}>
            {showAll ? "fewer" : `+${spells.length - CHIPS_COLLAPSED} more`}
          </button>
        )}
        <span className="mx-1 text-line">|</span>
        <button className="text-xs text-info hover:underline" onClick={() => setOff(new Set())}>
          All
        </button>
        <button
          className="text-xs text-info hover:underline"
          onClick={() => {
            setOff(new Set(spells.map((s) => s.ability.id)));
            setSortBy(null);
          }}
        >
          None
        </button>
      </div>

      {enabled.length === 0 ? (
        <p className="text-sm text-muted">No spells selected.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th className="align-bottom">Player</th>
                <th className="align-bottom">
                  <button
                    onClick={() => setSortBy(null)}
                    className={`uppercase ${sortBy == null ? "text-accent" : "hover:text-fg"}`}
                    title="Sort by total of the selected spells"
                  >
                    Total{sortBy == null && " ▼"}
                  </button>
                </th>
                {columns.map((c) => (
                  <th key={c.ability.id} className="num max-w-28 align-bottom !normal-case">
                    <div className="flex items-end justify-end gap-1">
                      <button
                        onClick={() => setSortBy(sortBy === c.ability.id ? null : c.ability.id)}
                        className={`line-clamp-2 text-right text-[11px] leading-tight ${sortBy === c.ability.id ? "text-accent" : "hover:text-fg"}`}
                        aria-label={`Sort by ${c.ability.name}`}
                      >
                        <SpellTip id={c.ability.id}>{c.ability.name}</SpellTip>
                        {sortBy === c.ability.id && " ▼"}
                      </button>
                      <button
                        onClick={() => toggle(c.ability.id)}
                        className="text-[11px] leading-tight text-muted hover:text-bad"
                        title={`Hide ${c.ability.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.player.id}>
                  <td className="whitespace-nowrap">
                    <PlayerName player={r.player} />{" "}
                    {r.player.role !== "dps" && <span className="text-[10px] text-muted uppercase">{r.player.role}</span>}
                  </td>
                  <td className="min-w-32">
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-right tabular-nums">{fmtNum(r.total)}</span>
                      <div className="h-2 flex-1 rounded bg-panel-2">
                        <div className="h-2 rounded bg-accent" style={{ width: `${(r.total / maxTotal) * 100}%` }} />
                      </div>
                    </div>
                  </td>
                  {columns.map((c) => {
                    const v = r.abilities[c.ability.id] ?? 0;
                    const a = v > 0 ? 0.12 + 0.6 * (v / colMax.get(c.ability.id)!) : 0;
                    return (
                      <td key={c.ability.id} className="num" style={{ background: a ? `rgba(245,165,36,${a.toFixed(2)})` : undefined }}>
                        {v > 0 ? fmtNum(v) : <span className="text-muted/40">·</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {enabled.length > COLUMNS && (
            <p className="mt-2 text-xs text-muted">
              Showing the {COLUMNS} biggest of {enabled.length} selected spells as columns; the total counts all {enabled.length}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
