import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Cloudflare KV (binding WCL_CACHE in wrangler.jsonc). When not running on Cloudflare
// (e.g. `npm run dev`) an in-memory map stands in, so everything still works locally.

type KV = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

// shared via globalThis: Next.js can load this module more than once (pages vs. server actions)
const g = globalThis as unknown as { __kvLocal?: Map<string, string> };
const local = (g.__kvLocal ??= new Map<string, string>());

function cloudflare(): { kv: KV | null; waitUntil: (p: Promise<unknown>) => void } {
  try {
    const ctx = getCloudflareContext();
    const kv = (ctx.env as unknown as { WCL_CACHE?: KV }).WCL_CACHE ?? null;
    return { kv, waitUntil: (p) => ctx.ctx.waitUntil(p) };
  } catch {
    return { kv: null, waitUntil: () => {} };
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const { kv } = cloudflare();
  try {
    if (!kv) return local.has(key) ? (JSON.parse(local.get(key)!) as T) : null;
    return (await kv.get(key, "json")) as T | null;
  } catch {
    return null;
  }
}

/** Fire-and-forget write (cache). `ttlMs` undefined = keep forever. */
export function kvPut(key: string, value: unknown, ttlMs?: number) {
  const { kv, waitUntil } = cloudflare();
  const body = JSON.stringify(value);
  if (process.env.KV_DEBUG) console.log("[kv] put", key.slice(0, 50), (body.length / 1024).toFixed(0) + "KB");
  if (!kv) {
    local.set(key, body);
    return;
  }
  const opts = ttlMs ? { expirationTtl: Math.max(60, Math.round(ttlMs / 1000)) } : undefined;
  // don't make the visitor wait; ignore failures (e.g. the free plan's daily write limit)
  waitUntil(kv.put(key, body, opts).catch(() => {}));
}

/** Write and wait for it, throwing on failure (for data people save on purpose). */
export async function kvPutNow(key: string, value: unknown) {
  const { kv } = cloudflare();
  const body = JSON.stringify(value);
  if (!kv) {
    local.set(key, body);
    return;
  }
  await kv.put(key, body);
}
