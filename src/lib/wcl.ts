import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type {
  Ability,
  AmountEntry,
  DamageEvent,
  DeathRecord,
  Fight,
  FightDetail,
  DamageTakenSummary,
  GuildHome,
  MultiPull,
  GuildReportSummary,
  InterruptEvent,
  PhaseInfo,
  Player,
  ReportSummary,
  Role,
} from "./types";
import { GUILD_ID } from "@/config/guild";
import { ENCOUNTERS } from "@/config/encounters";

const API_URL = "https://www.warcraftlogs.com/api/v2/client";
const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";

export class WclError extends Error {}

export function hasCredentials() {
  return Boolean(process.env.WCL_CLIENT_ID && process.env.WCL_CLIENT_SECRET);
}

// ---------------------------------------------------------------- caching
//
// Two levels: memory (lost whenever Cloudflare recycles the Worker) and Cloudflare KV (shared and
// persistent). A finished report never changes, so everything about it is kept for 30 days and each
// pull is downloaded from Warcraft Logs only once.

const MINUTE = 60_000;
const FOREVER = 30 * 24 * 60 * MINUTE;

type KV = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

function cloudflare(): { kv: KV | null; waitUntil: (p: Promise<unknown>) => void } {
  try {
    const ctx = getCloudflareContext();
    const kv = (ctx.env as unknown as { WCL_CACHE?: KV }).WCL_CACHE ?? null;
    return { kv, waitUntil: (p) => ctx.ctx.waitUntil(p) };
  } catch {
    return { kv: null, waitUntil: () => {} }; // not running on Cloudflare (e.g. `npm run dev`)
  }
}

async function kvGet<T>(key: string): Promise<T | null> {
  const { kv } = cloudflare();
  if (!kv) return null;
  try {
    return (await kv.get(key, "json")) as T | null;
  } catch {
    return null;
  }
}

function kvPut(key: string, value: unknown, ttlMs: number) {
  const { kv, waitUntil } = cloudflare();
  if (!kv) return;
  // don't make the visitor wait for the write; ignore failures (e.g. the free plan's daily write limit)
  waitUntil(kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, Math.round(ttlMs / 1000)) }).catch(() => {}));
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A report still being logged (or just finished) may change; anything older is final. */
const isFinished = (reportEndTime: number) => reportEndTime < Date.now() - 60 * MINUTE;

// ---------------------------------------------------------------- auth + transport

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + MINUTE) return token.value;
  const cached = await kvGet<{ value: string; expiresAt: number }>("wcl-token");
  if (cached && cached.expiresAt > Date.now() + 60 * MINUTE) return (token = cached).value;

  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new WclError("Warcraft Logs API credentials are missing (WCL_CLIENT_ID / WCL_CLIENT_SECRET).");
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${id}:${secret}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new WclError(`Warcraft Logs auth failed (${res.status}). Check your client ID/secret.`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  kvPut("wcl-token", token, Math.min(FOREVER, json.expires_in * 1000 - 24 * 60 * MINUTE));
  return token.value;
}

const memory = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();
const MAX_MEMORY = 300;

/**
 * Run a GraphQL query, cached in memory and in KV.
 * `ttl` may depend on the result (e.g. a report is cached for longer once it has finished).
 */
async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  ttl: number | ((data: T) => number) = 10 * MINUTE,
): Promise<T> {
  const raw = query + JSON.stringify(variables);
  const hit = memory.get(raw);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T>;

  const p = (async () => {
    const key = "q:" + (await sha256(raw));
    const stored = await kvGet<{ data: T }>(key);
    if (stored) return { data: stored.data, ttl: typeof ttl === "number" ? ttl : ttl(stored.data) };

    if (process.env.WCL_DEBUG) console.log("[wcl] request", query.slice(0, 60).replace(/\s+/g, " "));
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (res.status === 429) throw new WclError("Warcraft Logs rate limit reached. Try again in a few minutes.");
    if (!res.ok) throw new WclError(`Warcraft Logs API error ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new WclError(json.errors.map((e) => e.message).join("; "));
    const data = json.data as T;
    const ms = typeof ttl === "number" ? ttl : ttl(data);
    kvPut(key, { data }, ms);
    return { data, ttl: ms };
  })();

  const value = p.then((r) => r.data);
  memory.set(raw, { at: Date.now(), ttl: 10 * MINUTE, value });
  p.then((r) => {
    const m = memory.get(raw);
    if (m) m.ttl = Math.min(r.ttl, 60 * MINUTE);
  }).catch(() => memory.delete(raw));
  if (memory.size > MAX_MEMORY) memory.delete(memory.keys().next().value!);
  return value;
}

// ---------------------------------------------------------------- guild

const GUILD_QUERY = `query($id:Int!){
  guildData{ guild(id:$id){ id name faction{ name } server{ name region{ slug } } } }
  reportData{ reports(guildID:$id, limit:25){
    data{ code title startTime endTime zone{ id name encounters{ id name } }
      fights(killType: Encounters){ encounterID name kill difficulty fightPercentage bossPercentage } }
  }}}`;


export async function fetchGuildHome(): Promise<GuildHome> {
  type R = {
    guildData: {
      guild: { id: number; name: string; faction: { name: string } | null; server: { name: string; region: { slug: string } } } | null;
    };
    reportData: {
      reports: {
        data: {
          code: string;
          title: string;
          startTime: number;
          endTime: number;
          zone: { id: number; name: string; encounters: { id: number; name: string }[] } | null;
          fights: { encounterID: number; name: string; kill: boolean | null; difficulty: number | null; fightPercentage: number | null; bossPercentage: number | null }[] | null;
        }[];
      };
    };
  };
  const d = await gql<R>(GUILD_QUERY, { id: GUILD_ID }, 10 * MINUTE);
  const g = d.guildData.guild;
  if (!g) throw new WclError(`Guild ${GUILD_ID} not found on Warcraft Logs.`);
  const reports: GuildReportSummary[] = d.reportData.reports.data.map((r) => ({
    code: r.code,
    title: r.title,
    startTime: r.startTime,
    endTime: r.endTime,
    zone: r.zone ? { id: r.zone.id, name: r.zone.name } : null,
    fights: (r.fights ?? [])
      .filter((f) => f.encounterID > 0)
      .map((f) => ({
        encounterId: f.encounterID,
        name: f.name,
        kill: Boolean(f.kill),
        difficulty: f.difficulty,
        percent: f.kill ? 0 : (f.fightPercentage ?? f.bossPercentage ?? 100),
      })),
  }));

  // Current raid = zone of the most recent report that has boss pulls.
  const latest = d.reportData.reports.data.find((r) => r.zone && (r.fights ?? []).some((f) => f.encounterID > 0));
  const zone: GuildHome["zone"] = latest?.zone ?? null;
  return {
    guild: { id: g.id, name: g.name, faction: g.faction?.name ?? null, server: g.server.name, region: g.server.region.slug },
    reports,
    zone,
  };
}

// ---------------------------------------------------------------- report

const REPORT_QUERY = `query($code:String!){
  reportData{ report(code:$code){
    code title startTime endTime
    zone{ name }
    owner{ name }
    guild{ id name server{ name region{ slug } } }
    phases{ encounterID phases{ id name isIntermission } }
    fights(killType: Encounters){
      id encounterID name kill startTime endTime difficulty size
      bossPercentage fightPercentage lastPhase lastPhaseIsIntermission
      phaseTransitions{ id startTime }
    }
    masterData{
      actors{ id name type subType petOwner }
      abilities{ gameID name icon }
    }
  }}}`;

type RawActor = { id: number; name: string; type: string; subType: string; petOwner: number | null };
type RawReport = {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  zone: { name: string } | null;
  owner: { name: string } | null;
  guild: { id: number; name: string; server: { name: string; region: { slug: string } } } | null;
  phases: { encounterID: number; phases: PhaseInfo[] }[] | null;
  fights: {
    id: number;
    encounterID: number;
    name: string;
    kill: boolean | null;
    startTime: number;
    endTime: number;
    difficulty: number | null;
    size: number | null;
    bossPercentage: number | null;
    fightPercentage: number | null;
    lastPhase: number | null;
    lastPhaseIsIntermission: boolean | null;
    phaseTransitions: { id: number; startTime: number }[] | null;
  }[];
  masterData: { actors: RawActor[]; abilities: { gameID: number; name: string; icon: string }[] };
};

/** How long pull data can be cached: forever once the report is finished, briefly while logging live. */
const pullTtl = (raw: RawReport) => (isFinished(raw.endTime) ? FOREVER : 5 * MINUTE);

async function fetchRawReport(code: string): Promise<RawReport> {
  const d = await gql<{ reportData: { report: RawReport | null } }>(REPORT_QUERY, { code }, (x) =>
    x.reportData.report && isFinished(x.reportData.report.endTime) ? FOREVER : 2 * MINUTE,
  );
  const r = d.reportData.report;
  if (!r) throw new WclError(`Report "${code}" not found (or it is private).`);
  if (r.guild?.id !== GUILD_ID) throw new WclError("This site only analyzes our guild's logs, and this report belongs to someone else.");
  return r;
}

export async function fetchReport(code: string): Promise<ReportSummary> {
  const r = await fetchRawReport(code);
  const phases: Record<number, PhaseInfo[]> = {};
  for (const p of r.phases ?? []) phases[p.encounterID] = p.phases;
  return {
    code: r.code,
    title: r.title,
    startTime: r.startTime,
    endTime: r.endTime,
    zone: r.zone?.name ?? null,
    owner: r.owner?.name ?? null,
    guild: r.guild ? { name: r.guild.name, server: r.guild.server.name, region: r.guild.server.region.slug } : null,
    phases,
    fights: r.fights.filter((f) => f.encounterID > 0).map(normalizeFight),
  };
}

function normalizeFight(f: RawReport["fights"][number]): Fight {
  return {
    id: f.id,
    encounterId: f.encounterID,
    name: f.name,
    kill: Boolean(f.kill),
    startTime: f.startTime,
    endTime: f.endTime,
    difficulty: f.difficulty,
    size: f.size,
    bossPercentage: f.bossPercentage,
    fightPercentage: f.fightPercentage,
    lastPhase: f.lastPhase,
    lastPhaseIsIntermission: Boolean(f.lastPhaseIsIntermission),
    phaseTransitions: f.phaseTransitions ?? [],
  };
}

// ---------------------------------------------------------------- fight detail

type Page = { data: RawEvent[]; nextPageTimestamp: number | null };

// One request per pull: tables, roles, deaths, interrupts and the first page of damage taken.
const FIGHT_QUERY = `query($code:String!,$f:[Int]!,$s:Float!,$e:Float!){
  reportData{ report(code:$code){
    dd: table(fightIDs:$f, dataType:DamageDone, startTime:$s, endTime:$e)
    hd: table(fightIDs:$f, dataType:Healing, startTime:$s, endTime:$e)
    pd: playerDetails(fightIDs:$f, startTime:$s, endTime:$e)
    deaths: events(fightIDs:$f, dataType:Deaths, startTime:$s, endTime:$e, limit:10000){ data nextPageTimestamp }
    ints: events(fightIDs:$f, dataType:Interrupts, startTime:$s, endTime:$e, limit:10000){ data nextPageTimestamp }
    dt: events(fightIDs:$f, dataType:DamageTaken, startTime:$s, endTime:$e, limit:10000){ data nextPageTimestamp }
  }}}`;

type RawEvent = Record<string, unknown> & { timestamp: number; type: string };

/** Append the remaining pages of an events query that came back with a nextPageTimestamp. */
async function withRest(
  code: string,
  fightIds: number[],
  first: Page | undefined,
  e: number,
  type: string,
  ttl: number,
): Promise<RawEvent[]> {
  const out = [...(first?.data ?? [])];
  const next = first?.nextPageTimestamp;
  if (next && next < e) out.push(...(await fetchEventsMulti(code, fightIds, next, e, type, ttl)));
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function tableEntries(table: any): any[] {
  const data = table?.data ?? table;
  return Array.isArray(data?.entries) ? data.entries : [];
}

export async function fetchFightDetail(code: string, fightId: number): Promise<FightDetail> {
  const raw = await fetchRawReport(code);
  const rf = raw.fights.find((f) => f.id === fightId);
  if (!rf) throw new WclError(`Fight ${fightId} not found in report ${code}.`);
  const fight = normalizeFight(rf);
  const vars = { code, f: [fightId], s: fight.startTime, e: fight.endTime };

  const ttl = pullTtl(raw);
  const tables = await gql<{ reportData: { report: { dd: any; hd: any; pd: any; deaths: Page; ints: Page; dt: Page } } }>(
    FIGHT_QUERY,
    vars,
    ttl,
  );
  const [dmgTaken, interrupts, deathEvents] = await Promise.all([
    withRest(code, [fightId], tables.reportData.report.dt, fight.endTime, "DamageTaken", ttl),
    withRest(code, [fightId], tables.reportData.report.ints, fight.endTime, "Interrupts", ttl),
    withRest(code, [fightId], tables.reportData.report.deaths, fight.endTime, "Deaths", ttl),
  ]);
  const t = tables.reportData.report;

  // Players + roles
  const actors = new Map(raw.masterData.actors.map((a) => [a.id, a]));
  const pd = t.pd?.data?.playerDetails ?? t.pd?.playerDetails ?? {};
  const players: Player[] = [];
  const addRole = (list: any[] | undefined, role: Role) => {
    for (const p of list ?? []) {
      const actor = actors.get(p.id);
      players.push({
        id: p.id,
        name: p.name ?? actor?.name ?? `#${p.id}`,
        className: p.type ?? actor?.subType ?? "Unknown",
        spec: p.specs?.[0]?.spec ?? p.specs?.[0],
        role,
      });
    }
  };
  addRole(pd.tanks, "tank");
  addRole(pd.healers, "healer");
  addRole(pd.dps, "dps");
  const playerIds = new Set(players.map((p) => p.id));

  const owner = (id: number) => {
    const a = actors.get(id);
    return a?.petOwner && playerIds.has(a.petOwner) ? a.petOwner : id;
  };

  const amounts = (table: any): AmountEntry[] => {
    const totals = new Map<number, number>();
    for (const e of tableEntries(table)) {
      const id = owner(e.id);
      if (!playerIds.has(id)) continue;
      totals.set(id, (totals.get(id) ?? 0) + (e.total ?? 0));
    }
    return [...totals].map(([playerId, total]) => ({ playerId, total }));
  };

  // Damage from players/pets (self-damage talents, friendly fire, trinkets) isn't a boss mechanic.
  const isFriendly = (id: number) => {
    const a = actors.get(id);
    return Boolean(a && (a.type === "Player" || a.type === "Pet" || a.petOwner));
  };
  const damageTaken: DamageEvent[] = dmgTaken
    .filter((e) => e.type === "damage" && playerIds.has(e.targetID as number) && !isFriendly(e.sourceID as number))
    .map((e) => ({
      t: e.timestamp,
      targetId: e.targetID as number,
      sourceId: (e.sourceID as number) ?? -1,
      abilityId: (e.abilityGameID as number) ?? 0,
      amount: ((e.amount as number) ?? 0) + ((e.absorbed as number) ?? 0),
      overkill: (e.overkill as number) ?? 0,
    }));

  const deaths: DeathRecord[] = deathEvents
    .filter((d) => d.type === "death" && playerIds.has(d.targetID as number))
    .map((d) => ({
      playerId: d.targetID as number,
      t: d.timestamp,
      killingAbilityId: (d.killingAbilityGameID as number) || null,
    }));

  const ints: InterruptEvent[] = interrupts
    .filter((e) => e.type === "interrupt")
    .map((e) => ({
      t: e.timestamp,
      sourceId: owner(e.sourceID as number),
      abilityId: (e.abilityGameID as number) ?? 0,
      interruptedId: (e.extraAbilityGameID as number) ?? 0,
    }))
    .filter((e) => playerIds.has(e.sourceId));

  const abilities: Record<number, Ability> = {};
  for (const a of raw.masterData.abilities) abilities[a.gameID] = { id: a.gameID, name: a.name, icon: a.icon };

  return {
    report: { code: raw.code, title: raw.title },
    fight,
    players,
    abilities,
    damageDone: amounts(t.dd),
    healing: amounts(t.hd),
    deaths,
    damageTaken,
    interrupts: ints,
    phases: raw.phases?.find((p) => p.encounterID === fight.encounterId)?.phases ?? [],
  };
}

// ---------------------------------------------------------------- progression (many pulls, few requests)
//
// Cloudflare's free plan allows only 50 outgoing requests per page view, and downloading every
// damage event for 20+ pulls is far too much data. So for a boss's progression we:
//  1. sum damage taken per ability over all pulls in ONE table request, and pick the avoidable abilities,
//  2. download individual hits only for those abilities (tiny),
//  3. get deaths + interrupts for all pulls in one events request and DPS per pull in one batched request.


async function fetchEventsMulti(code: string, fightIds: number[], s: number, e: number, type: string, ttl: number, filter?: string) {
  const q = `query($code:String!,$f:[Int]!,$s:Float!,$e:Float!${filter ? ",$x:String!" : ""}){
    reportData{ report(code:$code){
      events(fightIDs:$f, dataType:${type}, startTime:$s, endTime:$e, limit:10000${filter ? ", filterExpression:$x" : ""}){ data nextPageTimestamp }
    }}}`;
  const out: RawEvent[] = [];
  let start = s;
  for (let i = 0; i < 20; i++) {
    const d = await gql<{ reportData: { report: { events: { data: RawEvent[]; nextPageTimestamp: number | null } } } }>(
      q,
      { code, f: fightIds, s: start, e, ...(filter ? { x: filter } : {}) },
      ttl,
    );
    const ev = d.reportData.report.events;
    out.push(...(ev.data ?? []));
    if (!ev.nextPageTimestamp || ev.nextPageTimestamp >= e) break;
    start = ev.nextPageTimestamp;
  }
  return out;
}

/** Events for many fights at once: one GraphQL request per round, one alias per fight still paging. */
async function fetchEventsPerFight(code: string, fights: Fight[], type: string, filter: string, ttl: number) {
  const out: RawEvent[] = [];
  let pending = fights.map((f) => ({ id: f.id, start: f.startTime, end: f.endTime }));
  for (let round = 0; round < 8 && pending.length; round++) {
    const aliases = pending
      .map((p) => `e${p.id}: events(fightIDs:[${p.id}], dataType:${type}, startTime:${p.start}, endTime:${p.end}, limit:10000, filterExpression:$x){ data nextPageTimestamp }`)
      .join("\n");
    const q = `query($code:String!,$x:String!){ reportData{ report(code:$code){ ${aliases} }}}`;
    const d = await gql<{ reportData: { report: Record<string, { data: RawEvent[]; nextPageTimestamp: number | null }> } }>(
      q,
      { code, x: filter },
      ttl,
    );
    const next: typeof pending = [];
    for (const p of pending) {
      const ev = d.reportData.report[`e${p.id}`];
      out.push(...(ev?.data ?? []));
      if (ev?.nextPageTimestamp && ev.nextPageTimestamp < p.end) next.push({ ...p, start: ev.nextPageTimestamp });
    }
    pending = next;
  }
  return out;
}

export async function fetchMultiPull(code: string, fightIds: number[]): Promise<MultiPull> {
  const raw = await fetchRawReport(code);
  const rfs = fightIds.map((id) => {
    const f = raw.fights.find((x) => x.id === id);
    if (!f) throw new WclError(`Fight ${id} not found in report ${code}.`);
    return f;
  });
  const fights = rfs.map(normalizeFight);
  const s = Math.min(...fights.map((f) => f.startTime));
  const e = Math.max(...fights.map((f) => f.endTime));

  // DPS per pull + roles + damage-taken totals per ability, all in one request.
  const ddAliases = fights
    .map((f) => `dd${f.id}: table(fightIDs:[${f.id}], dataType:DamageDone, startTime:${f.startTime}, endTime:${f.endTime})`)
    .join("\n");
  const batch = `query($code:String!,$f:[Int]!,$s:Float!,$e:Float!){
    reportData{ report(code:$code){
      pd: playerDetails(fightIDs:$f, startTime:$s, endTime:$e)
      dt: table(fightIDs:$f, dataType:DamageTaken, viewBy:Ability, startTime:$s, endTime:$e)
      dtt: table(fightIDs:$f, dataType:DamageTaken, viewBy:Source, startTime:$s, endTime:$e)
      deaths: events(fightIDs:$f, dataType:Deaths, startTime:$s, endTime:$e, limit:10000){ data nextPageTimestamp }
      ints: events(fightIDs:$f, dataType:Interrupts, startTime:$s, endTime:$e, limit:10000){ data nextPageTimestamp }
      ${ddAliases}
    }}}`;
  const vars = { code, f: fightIds, s, e };
  const ttl = pullTtl(raw);
  const b = await gql<{ reportData: { report: Record<string, any> } }>(batch, vars, ttl);
  const [deathEvents, kickEvents] = await Promise.all([
    withRest(code, fightIds, b.reportData.report.deaths, e, "Deaths", ttl),
    withRest(code, fightIds, b.reportData.report.ints, e, "Interrupts", ttl),
  ]);
  const deathsAndKicks = [...deathEvents, ...kickEvents];
  const rep = b.reportData.report;

  const actors = new Map(raw.masterData.actors.map((a) => [a.id, a]));
  const pd = rep.pd?.data?.playerDetails ?? rep.pd?.playerDetails ?? {};
  const roster: Player[] = [];
  const addRole = (list: any[] | undefined, role: Role) => {
    for (const p of list ?? [])
      roster.push({
        id: p.id,
        name: p.name ?? actors.get(p.id)?.name ?? `#${p.id}`,
        className: p.type ?? actors.get(p.id)?.subType ?? "Unknown",
        spec: p.specs?.[0]?.spec ?? p.specs?.[0],
        role,
      });
  };
  addRole(pd.tanks, "tank");
  addRole(pd.healers, "healer");
  addRole(pd.dps, "dps");
  const rosterIds = new Set(roster.map((p) => p.id));
  const owner = (id: number) => {
    const a = actors.get(id);
    return a?.petOwner && rosterIds.has(a.petOwner) ? a.petOwner : id;
  };

  const abilities: Record<number, Ability> = {};
  for (const a of raw.masterData.abilities) abilities[a.gameID] = { id: a.gameID, name: a.name, icon: a.icon };
  const ab = (id: number, name?: string, icon?: string): Ability => abilities[id] ?? { id, name: name ?? `Spell ${id}`, icon };

  // Damage taken summed over the selected pulls, from enemies only (not self-damage, trinkets, friendly fire).
  const hostile = new Set<number>();
  const byAbility = new Map<number, DamageTakenSummary["abilities"][number]>();
  for (const a of tableEntries(rep.dt)) {
    const sources: { type?: string }[] = a.sources ?? [];
    const isHostile =
      a.actorType === "Boss" || a.actorType === "NPC" || (sources.length > 0 && sources.every((x) => x.type === "Boss" || x.type === "NPC"));
    if (!isHostile || !a.total) continue;
    hostile.add(a.guid);
    const cur = byAbility.get(a.guid) ?? { ability: ab(a.guid, a.name, a.abilityIcon), total: 0, hits: 0 };
    cur.total += a.total;
    cur.hits += (a.hitCount ?? 0) + (a.tickCount ?? 0);
    byAbility.set(a.guid, cur);
  }
  // For damage taken, "viewBy: Source" lists each player who took damage, with the abilities that hit them.
  const rosterById = new Map(roster.map((p) => [p.id, p]));
  const byPlayer: DamageTakenSummary["byPlayer"] = [];
  for (const p of tableEntries(rep.dtt)) {
    const pl = rosterById.get(p.id);
    if (!pl) continue;
    const per: Record<number, number> = {};
    let total = 0;
    for (const a of p.abilities ?? []) {
      if (!hostile.has(a.guid)) continue;
      per[a.guid] = (per[a.guid] ?? 0) + (a.total ?? 0);
      total += a.total ?? 0;
    }
    byPlayer.push({ playerId: pl.id, total, abilities: per });
  }

  // Avoidable = what you configured per boss in src/config/encounters.ts. Fetch only those hits.
  const avoidableFor = (encounterId: number): Record<number, "configured"> =>
    Object.fromEntries((ENCOUNTERS[encounterId]?.avoidable ?? []).map((id) => [id, "configured" as const]));
  const avoidIds = [...new Set(fights.flatMap((f) => ENCOUNTERS[f.encounterId]?.avoidable ?? []))];
  const hits = avoidIds.length
    ? await fetchEventsPerFight(code, fights, "DamageTaken", `ability.id in (${avoidIds.join(",")})`, ttl)
    : [];

  const details: FightDetail[] = fights.map((fight) => {
    const inFight = (ev: RawEvent) => ev.fight === fight.id;
    const damageDone: AmountEntry[] = [];
    const totals = new Map<number, number>();
    for (const x of tableEntries(rep[`dd${fight.id}`])) {
      const id = owner(x.id);
      if (rosterIds.has(id)) totals.set(id, (totals.get(id) ?? 0) + (x.total ?? 0));
    }
    for (const [playerId, total] of totals) damageDone.push({ playerId, total });
    const players = roster.filter((p) => totals.has(p.id));
    const present = new Set(players.map((p) => p.id));

    return {
      report: { code: raw.code, title: raw.title },
      fight,
      players,
      abilities,
      damageDone,
      healing: [],
      deaths: deathsAndKicks
        .filter((d) => inFight(d) && d.type === "death" && present.has(d.targetID as number))
        .map((d) => ({ playerId: d.targetID as number, t: d.timestamp, killingAbilityId: (d.killingAbilityGameID as number) || null })),
      damageTaken: hits
        .filter((h) => {
          const src = actors.get(h.sourceID as number);
          const friendly = src && (src.type === "Player" || src.type === "Pet" || src.petOwner);
          return inFight(h) && h.type === "damage" && present.has(h.targetID as number) && !friendly;
        })
        .map((h) => ({
          t: h.timestamp,
          targetId: h.targetID as number,
          sourceId: (h.sourceID as number) ?? -1,
          abilityId: (h.abilityGameID as number) ?? 0,
          amount: ((h.amount as number) ?? 0) + ((h.absorbed as number) ?? 0),
          overkill: (h.overkill as number) ?? 0,
        })),
      interrupts: deathsAndKicks
        .filter((k) => inFight(k) && k.type === "interrupt")
        .map((k) => ({
          t: k.timestamp,
          sourceId: owner(k.sourceID as number),
          abilityId: (k.abilityGameID as number) ?? 0,
          interruptedId: (k.extraAbilityGameID as number) ?? 0,
        }))
        .filter((k) => present.has(k.sourceId)),
      phases: raw.phases?.find((p) => p.encounterID === fight.encounterId)?.phases ?? [],
      knownAvoidable: avoidableFor(fight.encounterId),
    };
  });

  return {
    details,
    damageTaken: { abilities: [...byAbility.values()].sort((a, b) => b.total - a.total), byPlayer },
  };
}
