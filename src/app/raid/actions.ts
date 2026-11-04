"use server";

import { saveSpellList } from "@/lib/avoidable";

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const validIds = (ids: unknown): ids is number[] =>
  Array.isArray(ids) && ids.length <= 500 && ids.every((n) => Number.isInteger(n) && n > 0);

/** Save a boss's avoidable and can't-be-survived spell lists. */
export async function saveBossSpellsAction(
  encounterId: number,
  avoidable: number[],
  unsurvivable: number[],
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, error: "Editing is turned off: no ADMIN_PASSWORD is set in Cloudflare." };
  // compare hashes so the comparison takes the same time whatever was typed
  if ((await sha256(password ?? "")) !== (await sha256(expected))) return { ok: false, error: "Wrong password." };
  if (!Number.isInteger(encounterId) || encounterId <= 0) return { ok: false, error: "Unknown boss." };
  if (!validIds(avoidable) || !validIds(unsurvivable)) return { ok: false, error: "Invalid spell list." };
  try {
    await saveSpellList("avoidable", encounterId, avoidable);
    await saveSpellList("unsurvivable", encounterId, unsurvivable);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Couldn't save: ${(e as Error).message}` };
  }
}
