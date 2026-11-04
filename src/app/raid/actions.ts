"use server";

import { saveAvoidable } from "@/lib/avoidable";

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function saveAvoidableAction(
  encounterId: number,
  ids: number[],
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, error: "Editing is turned off: no ADMIN_PASSWORD is set in Cloudflare." };
  // compare hashes so the comparison takes the same time whatever was typed
  if ((await sha256(password ?? "")) !== (await sha256(expected))) return { ok: false, error: "Wrong password." };
  if (!Number.isInteger(encounterId) || encounterId <= 0) return { ok: false, error: "Unknown boss." };
  if (!Array.isArray(ids) || ids.length > 500 || !ids.every((n) => Number.isInteger(n) && n > 0))
    return { ok: false, error: "Invalid spell list." };
  try {
    await saveAvoidable(encounterId, ids);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Couldn't save: ${(e as Error).message}` };
  }
}
