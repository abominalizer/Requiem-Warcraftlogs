"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtTime, progressColor } from "@/lib/format";

export interface PullCard {
  id: number;
  pullNo: number;
  pct: number;
  kill: boolean;
  phase: number | null;
  durationMs: number;
}

export interface BossGroup {
  key: string;
  name: string;
  difficultyName: string;
  encounterId: number;
  difficulty: number | null;
  best: number;
  killed: boolean;
  pulls: PullCard[];
}

export function PullSelector({ code, groups, maxPulls }: { code: string; groups: BossGroup[]; maxPulls: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const all = groups.flatMap((g) => g.pulls.map((p) => p.id));

  const toggle = (ids: number[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // keep the report's pull order
  const ordered = all.filter((id) => selected.has(id));
  const tooMany = ordered.length > maxPulls;

  return (
    <div className="pb-24">
      {all.length > 1 && (
        <div className="mb-3 flex items-center gap-3 text-sm text-muted">
          <span>Tick pulls to analyze them together.</span>
          <button className="text-info hover:underline" onClick={() => toggle(all, true)}>
            Select all
          </button>
          {selected.size > 0 && (
            <button className="text-info hover:underline" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          )}
        </div>
      )}

      <div className="space-y-6">
        {groups.map((g) => {
          const ids = g.pulls.map((p) => p.id);
          const allOn = ids.every((id) => selected.has(id));
          return (
            <section key={g.key} className="panel p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    {g.name} <span className="text-sm text-muted">{g.difficultyName}</span>
                  </h2>
                  <p className="text-xs text-muted">
                    {g.pulls.length} pull{g.pulls.length > 1 ? "s" : ""} ·{" "}
                    {g.killed ? (
                      <span style={{ color: progressColor(0, true) }}>Killed</span>
                    ) : (
                      <>
                        Best: <span style={{ color: progressColor(g.best) }}>{g.best.toFixed(1)}%</span>
                      </>
                    )}{" "}
                    ·{" "}
                    <button className="text-info hover:underline" onClick={() => toggle(ids, !allOn)}>
                      {allOn ? "Unselect all" : "Select all"}
                    </button>
                  </p>
                </div>
                <Link
                  href={`/report/${code}/boss/${g.encounterId}?difficulty=${g.difficulty ?? ""}`}
                  className="rounded-lg border border-accent/60 px-3 py-1.5 text-sm text-accent hover:bg-accent/10"
                >
                  Progression analysis →
                </Link>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.pulls.map((f) => {
                  const on = selected.has(f.id);
                  const color = progressColor(f.pct, f.kill);
                  return (
                    <div
                      key={f.id}
                      className={`flex items-stretch rounded-lg border bg-panel-2 ${on ? "border-accent" : "border-line hover:border-accent/60"}`}
                    >
                      <label className="flex cursor-pointer items-center pl-3" title="Select for combined analysis">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => toggle([f.id], e.target.checked)}
                          className="h-4 w-4 accent-[var(--color-accent)]"
                        />
                      </label>
                      <Link href={`/report/${code}/fight/${f.id}`} className="flex-1 px-3 py-2">
                        <div className="flex justify-between text-sm">
                          <span>
                            Pull {f.pullNo}{" "}
                            <span className="font-semibold" style={{ color }}>
                              {f.kill ? "Kill" : `${f.pct.toFixed(1)}%`}
                            </span>
                          </span>
                          <span className="text-muted tabular-nums">
                            {f.phase ? `P${f.phase} · ` : ""}
                            {fmtTime(f.durationMs)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded bg-bg">
                          <div className="h-1.5 rounded" style={{ width: `${100 - f.pct}%`, background: color }} />
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-panel/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
            <span className="text-sm">
              <b>{selected.size}</b> pull{selected.size > 1 ? "s" : ""} selected
              {tooMany && <span className="ml-2 text-bad">(max {maxPulls} at once)</span>}
            </span>
            <div className="flex gap-2">
              <button className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button
                disabled={tooMany}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
                onClick={() => router.push(`/report/${code}/analyze?fights=${ordered.join(",")}`)}
              >
                Analyze {selected.size} pull{selected.size > 1 ? "s" : ""} →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
