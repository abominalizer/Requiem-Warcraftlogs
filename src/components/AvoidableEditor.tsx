"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { saveBossSpellsAction } from "@/app/raid/actions";
import { abilityIconUrl, fmtNum, progressColor } from "@/lib/format";
import type { RaidBoss } from "@/lib/types";

const PW_KEY = "requiem-officer-password";

export function AvoidableEditor({
  bosses,
  saved,
  savedUnsurvivable,
  fromCode,
  canEdit,
  difficultyNames,
}: {
  bosses: RaidBoss[];
  saved: Record<string, number[]>;
  savedUnsurvivable: Record<string, number[]>;
  fromCode: Record<string, number[]>;
  canEdit: boolean;
  difficultyNames: Record<string, string>;
}) {
  const [password, setPassword] = useState("");
  useEffect(() => {
    try {
      setPassword(localStorage.getItem(PW_KEY) ?? "");
    } catch {}
  }, []);
  const rememberPassword = (v: string) => {
    setPassword(v);
    try {
      localStorage.setItem(PW_KEY, v);
    } catch {}
  };

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <label className="text-sm text-muted" htmlFor="pw">
            Officer password
          </label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => rememberPassword(e.target.value)}
            placeholder="needed to save"
            className="w-56 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm outline-none focus:border-accent"
          />
          <span className="text-xs text-muted">Remembered in this browser. Anyone can view; saving needs the password.</span>
        </div>
      ) : (
        <div className="rounded-lg border border-warn/60 bg-warn/10 p-3 text-sm">
          Read-only: set an <code>ADMIN_PASSWORD</code> secret on the Worker in Cloudflare to allow marking spells.
        </div>
      )}

      {bosses.map((b) => (
        <BossEditor
          key={b.encounterId}
          boss={b}
          initial={saved[b.encounterId] ?? []}
          initialUnsurvivable={savedUnsurvivable[b.encounterId] ?? []}
          locked={fromCode[b.encounterId] ?? []}
          canEdit={canEdit}
          password={password}
          difficultyName={b.difficulty != null ? (difficultyNames[b.difficulty] ?? "") : ""}
        />
      ))}
    </div>
  );
}

function BossEditor({
  boss,
  initial,
  initialUnsurvivable,
  locked,
  canEdit,
  password,
  difficultyName,
}: {
  boss: RaidBoss;
  initial: number[];
  initialUnsurvivable: number[];
  locked: number[];
  canEdit: boolean;
  password: string;
  difficultyName: string;
}) {
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set(initial));
  const [ids, setIds] = useState<Set<number>>(new Set(initial));
  const [savedUns, setSavedUns] = useState<Set<number>>(new Set(initialUnsurvivable));
  const [uns, setUns] = useState<Set<number>>(new Set(initialUnsurvivable));
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "busy"; text: string } | null>(null);
  const lockedSet = new Set(locked);

  const isOn = (spellIds: number[]) => spellIds.some((id) => ids.has(id) || lockedSet.has(id));
  const isUns = (spellIds: number[]) => spellIds.some((id) => uns.has(id));
  const setter =
    (set: typeof setIds) =>
    (spellIds: number[], on: boolean) =>
      set((prev) => {
        const next = new Set(prev);
        for (const id of spellIds) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      });
  const toggle = setter(setIds);
  const toggleUns = setter(setUns);

  // spells saved earlier that didn't show up in the reference pull
  const shownIds = new Set(boss.spells.flatMap((s) => s.ids));
  const missing = [...new Set([...ids, ...uns])].filter((id) => !shownIds.has(id));

  const differs = (a: Set<number>, b: Set<number>) => a.size !== b.size || [...a].some((id) => !b.has(id));
  const dirty = differs(ids, savedIds) || differs(uns, savedUns);
  const count = boss.spells.filter((s) => isOn(s.ids)).length + missing.filter((id) => ids.has(id)).length;
  const unsCount = boss.spells.filter((s) => isUns(s.ids)).length + missing.filter((id) => uns.has(id)).length;

  const save = async () => {
    setStatus({ kind: "busy", text: "Saving…" });
    const res = await saveBossSpellsAction(boss.encounterId, [...ids], [...uns], password);
    if (res.ok) {
      setSavedIds(new Set(ids));
      setSavedUns(new Set(uns));
      setStatus({ kind: "ok", text: "Saved" });
    } else setStatus({ kind: "error", text: res.error });
  };

  return (
    <details className="panel group">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4">
        <span className="flex items-baseline gap-2">
          <span className="text-muted transition group-open:rotate-90">▸</span>
          <span className="text-lg font-semibold">{boss.name}</span>
          {difficultyName && <span className="text-sm text-muted">{difficultyName}</span>}
        </span>
        <span className={`text-sm ${count ? "text-accent" : "text-muted"}`}>
          {count || unsCount
            ? [count && `${count} avoidable`, unsCount && `${unsCount} can't be survived`].filter(Boolean).join(" · ")
            : "nothing marked yet"}
          {dirty && <span className="ml-2 text-warn">· unsaved changes</span>}
        </span>
      </summary>

      <div className="border-t border-line px-4 pt-3 pb-4">
        {!boss.source ? (
          <p className="text-sm text-muted">Not pulled yet: the spell list comes from your logs once you&apos;ve pulled this boss.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">
              Spells from your{" "}
              <Link prefetch={false} className="text-info hover:underline" href={`/report/${boss.source.code}/fight/${boss.source.fightId}`}>
                best pull
              </Link>{" "}
              (
              <span style={{ color: progressColor(boss.source.percent, boss.source.kill) }}>
                {boss.source.kill ? "kill" : `${boss.source.percent.toFixed(1)}%`}
              </span>
              , {new Date(boss.source.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}). Damage and hits are from that pull, to help
              tell spells apart. Tick what players should never get hit by, and spells whose deaths no defensive could prevent.
            </p>
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th className="w-10">Avoidable</th>
                    <th className="w-10" title="Executes and one-shots: deaths to these don't count as 'died pressing nothing'">
                      Can&apos;t be survived
                    </th>
                    <th>Spell</th>
                    <th className="num">Damage</th>
                    <th className="num">Hits</th>
                  </tr>
                </thead>
                <tbody>
                  {boss.spells.map((s) => {
                    const on = isOn(s.ids);
                    const fixed = s.ids.some((id) => lockedSet.has(id));
                    const icon = abilityIconUrl(s.icon);
                    return (
                      <tr key={s.name} className={on ? "bg-accent/10" : isUns(s.ids) ? "bg-info/10" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!canEdit || fixed}
                            onChange={(e) => toggle(s.ids, e.target.checked)}
                            title={fixed ? "Set in the code (src/config/encounters.ts)" : undefined}
                            className="h-4 w-4 accent-[var(--color-accent)]"
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={isUns(s.ids)}
                            disabled={!canEdit}
                            onChange={(e) => toggleUns(s.ids, e.target.checked)}
                            className="h-4 w-4 accent-[var(--color-info)]"
                          />
                        </td>
                        <td>
                          <span className="inline-flex items-center gap-1.5">
                            {icon && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={icon} alt="" width={16} height={16} className="rounded-sm" />
                            )}
                            <a href={`https://www.wowhead.com/spell=${s.ids[0]}`} target="_blank" rel="noreferrer" className="hover:underline">
                              {s.name}
                            </a>
                            <span className="text-[10px] text-muted">{s.ids.map((id) => `#${id}`).join(" ")}</span>
                          </span>
                        </td>
                        <td className="num">{fmtNum(s.total)}</td>
                        <td className="num text-muted">{s.hits || "—"}</td>
                      </tr>
                    );
                  })}
                  {missing.map((id) => (
                    <tr key={id} className="bg-accent/10">
                      <td>
                        <input
                          type="checkbox"
                          checked={ids.has(id)}
                          disabled={!canEdit}
                          onChange={(e) => toggle([id], e.target.checked)}
                          className="h-4 w-4 accent-[var(--color-accent)]"
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={uns.has(id)}
                          disabled={!canEdit}
                          onChange={(e) => toggleUns([id], e.target.checked)}
                          className="h-4 w-4 accent-[var(--color-info)]"
                        />
                      </td>
                      <td className="text-muted" colSpan={3}>
                        Spell #{id} (marked earlier, didn&apos;t hit anyone in this pull)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {canEdit && boss.source && (
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={save}
              disabled={!dirty || status?.kind === "busy"}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-40"
            >
              Save {boss.name}
            </button>
            {dirty && (
              <button
                className="text-sm text-muted hover:text-fg"
                onClick={() => {
                  setIds(new Set(savedIds));
                  setUns(new Set(savedUns));
                }}
              >
                Undo changes
              </button>
            )}
            {status && (
              <span className={`text-sm ${status.kind === "ok" ? "text-good" : status.kind === "error" ? "text-bad" : "text-muted"}`}>
                {status.text}
              </span>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
