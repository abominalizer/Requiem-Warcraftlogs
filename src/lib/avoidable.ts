import "server-only";
import { ENCOUNTERS } from "@/config/encounters";
import { kvGet, kvPutNow } from "./kv";

// The avoidable spells per boss, marked by officers on the Raid page and stored in KV.
// Spells listed in src/config/encounters.ts are added on top.

const KEY = "avoidable:v1";
type Stored = Record<string, number[]>; // encounterId -> spell ids

// shared via globalThis so a save is seen at once by pages in the same Worker instance
const g = globalThis as unknown as { __avoidable?: { at: number; value: Stored } | null };

async function readStored(): Promise<Stored> {
  if (g.__avoidable && Date.now() - g.__avoidable.at < 60_000) return g.__avoidable.value;
  const value = (await kvGet<Stored>(KEY)) ?? {};
  g.__avoidable = { at: Date.now(), value };
  return value;
}

/** Avoidable spell ids per encounter: saved on the site + set in code. */
export async function getAvoidableMap(): Promise<Record<number, number[]>> {
  const stored = await readStored();
  const out: Record<number, number[]> = {};
  for (const [enc, ids] of Object.entries(stored)) out[Number(enc)] = [...ids];
  for (const [enc, cfg] of Object.entries(ENCOUNTERS))
    out[Number(enc)] = [...new Set([...(out[Number(enc)] ?? []), ...(cfg.avoidable ?? [])])];
  return out;
}

export async function getSavedAvoidable(): Promise<Stored> {
  return readStored();
}

export async function saveAvoidable(encounterId: number, ids: number[]) {
  g.__avoidable = null;
  const stored = { ...(await readStored()) };
  if (ids.length) stored[String(encounterId)] = [...new Set(ids)].sort((a, b) => a - b);
  else delete stored[String(encounterId)];
  await kvPutNow(KEY, stored);
  g.__avoidable = { at: Date.now(), value: stored };
}
