import "server-only";
import { ENCOUNTERS } from "@/config/encounters";
import { kvGet, kvPutNow } from "./kv";

// Per-boss spell lists marked by officers on the Raid page, stored in KV:
//  - avoidable:     damage nobody should take (spells in src/config/encounters.ts are added on top)
//  - unsurvivable:  deaths to these can't be prevented with a defensive (executes, "ceases to exist"…)

export type SpellList = "avoidable" | "unsurvivable";
const KEYS: Record<SpellList, string> = { avoidable: "avoidable:v1", unsurvivable: "unsurvivable:v1" };
type Stored = Record<string, number[]>; // encounterId -> spell ids

// shared via globalThis so a save is seen at once by pages in the same Worker instance
const g = globalThis as unknown as { __spellLists?: Partial<Record<SpellList, { at: number; value: Stored } | null>> };
const mem = (g.__spellLists ??= {});

async function readStored(list: SpellList): Promise<Stored> {
  const m = mem[list];
  if (m && Date.now() - m.at < 60_000) return m.value;
  const value = (await kvGet<Stored>(KEYS[list])) ?? {};
  mem[list] = { at: Date.now(), value };
  return value;
}

const toMap = (stored: Stored) => Object.fromEntries(Object.entries(stored).map(([k, v]) => [Number(k), [...v]])) as Record<number, number[]>;

/** Avoidable spell ids per encounter: saved on the site + set in code. */
export async function getAvoidableMap(): Promise<Record<number, number[]>> {
  const out = toMap(await readStored("avoidable"));
  for (const [enc, cfg] of Object.entries(ENCOUNTERS))
    out[Number(enc)] = [...new Set([...(out[Number(enc)] ?? []), ...(cfg.avoidable ?? [])])];
  return out;
}

/** Spells whose deaths can't be prevented by a defensive, per encounter. */
export async function getUnsurvivableMap(): Promise<Record<number, number[]>> {
  return toMap(await readStored("unsurvivable"));
}

export async function getSaved(list: SpellList): Promise<Stored> {
  return readStored(list);
}

export async function saveSpellList(list: SpellList, encounterId: number, ids: number[]) {
  mem[list] = null;
  const stored = { ...(await readStored(list)) };
  if (ids.length) stored[String(encounterId)] = [...new Set(ids)].sort((a, b) => a - b);
  else delete stored[String(encounterId)];
  await kvPutNow(KEYS[list], stored);
  mem[list] = { at: Date.now(), value: stored };
}
