import "server-only";
import { CLASS_DEFENSIVES, CONSUMABLES, EXTERNALS } from "@/config/defensives";
import { kvGet, kvPut } from "./kv";
import type {
  Ability,
  AmountEntry,
  DamageEvent,
  DeathRecord,
  Fight,
  FightDetail,
  DamageTakenSummary,
  DefensiveCast,
  DefensiveKind,
  GuildHome,
  MultiPull,
  GuildReportSummary,
  RaidBoss,
  RaidSpell,
  InterruptEvent,
  PhaseInfo,
  Player,
  ReportSummary,
  Role,
} from "./types";
import { GUILD_ID } from "@/config/guild";

const API_URL = "https://www.warcraftlogs.com/api/v2/client";
const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";

export class WclError extends Error {}

/** Error message for reports from another guild (the error page turns it into the "nice try" page). */
export const NOT_OUR_LOG = "NOT_A_REQUIEM_LOG";

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

const REPORT_FIGHTS = `fights(killType: Encounters){ id startTime endTime encounterID name kill difficulty fightPercentage bossPercentage lastPhase }`;

const GUILD_QUERY = `query($id:Int!){
  guildData{ guild(id:$id){ id name faction{ name } server{ name region{ slug } } } }
  reportData{ reports(guildID:$id, limit:25){
    data{ code title startTime endTime zone{ id name encounters{ id name } } ${REPORT_FIGHTS} }
  }}}`;

// Every log of the current raid (for progression, first kills and the list of all pulls on a boss).
// Pages of 25: Warcraft Logs rejects bigger pages of reports-with-fights as too complex.
const ZONE_HISTORY_QUERY = `query($id:Int!,$zone:Int!,$page:Int!){
  reportData{ reports(guildID:$id, zoneID:$zone, limit:25, page:$page){
    has_more_pages
    data{ code title startTime endTime zone{ id name } ${REPORT_FIGHTS} }
  }}}`;

type RawGuildReport = {
  code: string;
  title: string;
  startTime: number;
  endTime: number;
  zone: { id: number; name: string; encounters?: { id: number; name: string }[] } | null;
  fights:
    | {
        id: number;
        startTime: number;
        endTime: number;
        encounterID: number;
        name: string;
        kill: boolean | null;
        difficulty: number | null;
        fightPercentage: number | null;
        bossPercentage: number | null;
        lastPhase: number | null;
      }[]
    | null;
};

const toSummary = (r: RawGuildReport): GuildReportSummary => ({
  code: r.code,
  title: r.title,
  startTime: r.startTime,
  endTime: r.endTime,
  zone: r.zone ? { id: r.zone.id, name: r.zone.name } : null,
  fights: (r.fights ?? [])
    .filter((f) => f.encounterID > 0)
    .map((f) => ({
      id: f.id,
      startTime: f.startTime,
      endTime: f.endTime,
      encounterId: f.encounterID,
      name: f.name,
      kill: Boolean(f.kill),
      difficulty: f.difficulty,
      percent: f.kill ? 0 : (f.fightPercentage ?? f.bossPercentage ?? 100),
      lastPhase: f.lastPhase,
    })),
});

export async function fetchGuildHome(): Promise<GuildHome> {
  type R = {
    guildData: {
      guild: { id: number; name: string; faction: { name: string } | null; server: { name: string; region: { slug: string } } } | null;
    };
    reportData: { reports: { data: RawGuildReport[] } };
  };
  const d = await gql<R>(GUILD_QUERY, { id: GUILD_ID }, 10 * MINUTE);
  const g = d.guildData.guild;
  if (!g) throw new WclError(`Guild ${GUILD_ID} not found on Warcraft Logs.`);
  const reports = d.reportData.reports.data.map(toSummary);

  // Current raid = zone of the most recent report that has boss pulls.
  const latest = d.reportData.reports.data.find((r) => r.zone && (r.fights ?? []).some((f) => f.encounterID > 0));
  const zone: GuildHome["zone"] = latest?.zone ? { id: latest.zone.id, name: latest.zone.name, encounters: latest.zone.encounters ?? [] } : null;

  // All logs of that raid, newest first (up to 200).
  const zoneReports: GuildReportSummary[] = [];
  if (zone) {
    for (let page = 1; page <= 8; page++) {
      const z = await gql<{ reportData: { reports: { has_more_pages: boolean; data: RawGuildReport[] } } }>(
        ZONE_HISTORY_QUERY,
        { id: GUILD_ID, zone: zone.id, page },
        10 * MINUTE,
      );
      zoneReports.push(...z.reportData.reports.data.map(toSummary));
      if (!z.reportData.reports.has_more_pages) break;
    }
  }
  return {
    guild: { id: g.id, name: g.name, faction: g.faction?.name ?? null, server: g.server.name, region: g.server.region.slug },
    reports,
    zone,
    zoneReports,
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
  if (r.guild?.id !== GUILD_ID) throw new WclError(NOT_OUR_LOG);
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

export async function fetchMultiPull(
  code: string,
  fightIds: number[],
  opts: { damageTaken?: boolean; avoidable?: Record<number, number[]> } = {},
): Promise<MultiPull> {
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
      ${opts.damageTaken ? "dt: table(fightIDs:$f, dataType:DamageTaken, viewBy:Ability, startTime:$s, endTime:$e)" : ""}
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

  const damageTaken = opts.damageTaken
    ? await fetchDamageTakenSummary(code, fightIds, s, e, ttl, tableEntries(rep.dt), roster, ab)
    : { abilities: [], byPlayer: [] };

  // Avoidable = what you configured per boss in src/config/encounters.ts. Fetch only those hits.
  // a spell often has several IDs: a marked spell covers every spell in this report with the same name
  const sameName = (ids: number[]) => {
    const names = new Set(ids.map((id) => abilities[id]?.name).filter(Boolean));
    return [...new Set([...ids, ...Object.values(abilities).filter((a) => names.has(a.name)).map((a) => a.id)])];
  };
  const avoidableFor = (encounterId: number): Record<number, "configured"> =>
    Object.fromEntries(sameName(opts.avoidable?.[encounterId] ?? []).map((id) => [id, "configured" as const]));
  const avoidIds = [...new Set(fights.flatMap((f) => sameName(opts.avoidable?.[f.encounterId] ?? [])))];
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
    damageTaken,
  };
}

/**
 * Damage taken from enemies over a set of pulls, per spell and per player.
 *
 * Warcraft Logs' per-player damage-taken summary only lists each player's top 5 spells, so a spell like
 * Axegrinder showed 0 for half the raid. Instead we ask for one "damage taken by spell" table per player
 * (all in one request), which lists every spell. Spells sharing a name (several spell IDs) are merged.
 */
async function fetchDamageTakenSummary(
  code: string,
  fightIds: number[],
  s: number,
  e: number,
  ttl: number,
  allSpells: any[],
  roster: Player[],
  ab: (id: number, name?: string, icon?: string) => Ability,
): Promise<DamageTakenSummary> {
  // Which spells come from enemies (not self-damage, trinkets, friendly fire), and one key per spell name.
  const keyOf = new Map<number, number>(); // spell id -> id of the first spell with that name
  const byName = new Map<string, number>();
  const byAbility = new Map<number, DamageTakenSummary["abilities"][number]>();
  for (const a of allSpells) {
    const sources: { type?: string }[] = a.sources ?? [];
    const hostile =
      a.actorType === "Boss" || a.actorType === "NPC" || (sources.length > 0 && sources.every((x) => x.type === "Boss" || x.type === "NPC"));
    if (!hostile || !a.total) continue;
    const key = byName.get(a.name) ?? a.guid;
    byName.set(a.name, key);
    keyOf.set(a.guid, key);
    const cur = byAbility.get(key) ?? { ability: ab(key, a.name, a.abilityIcon), total: 0, hits: 0 };
    cur.total += a.total;
    cur.hits += (a.hitCount ?? 0) + (a.tickCount ?? 0);
    byAbility.set(key, cur);
  }

  const aliases = roster
    .map((p) => `p${p.id}: table(fightIDs:$f, dataType:DamageTaken, viewBy:Ability, sourceID:${p.id}, startTime:$s, endTime:$e)`)
    .join("\n");
  const q = `query($code:String!,$f:[Int]!,$s:Float!,$e:Float!){ reportData{ report(code:$code){ ${aliases} }}}`;
  const d = roster.length ? await gql<{ reportData: { report: Record<string, any> } }>(q, { code, f: fightIds, s, e }, ttl) : null;

  const byPlayer: DamageTakenSummary["byPlayer"] = [];
  for (const p of roster) {
    const per: Record<number, number> = {};
    let total = 0;
    for (const a of tableEntries(d?.reportData.report[`p${p.id}`])) {
      const key = keyOf.get(a.guid);
      if (key == null || !a.total) continue;
      per[key] = (per[key] ?? 0) + a.total;
      total += a.total;
    }
    if (total > 0) byPlayer.push({ playerId: p.id, total, abilities: per });
  }
  return { abilities: [...byAbility.values()].sort((a, b) => b.total - a.total), byPlayer };
}

// ---------------------------------------------------------------- raid page: the spells of every boss

/**
 * For every boss of the current raid, the enemy spells that damaged the raid, taken from the guild's best
 * pull of that boss (the kill, or the attempt that got furthest) at the highest difficulty pulled.
 * One request for all bosses; cached forever per pull.
 */
export async function fetchRaidSpells(home: GuildHome): Promise<RaidBoss[]> {
  if (!home.zone) return [];
  const zoneReports = home.zoneReports;
  const picks = home.zone.encounters.map((enc) => {
    const pulls = zoneReports.flatMap((r) => r.fights.filter((f) => f.encounterId === enc.id).map((f) => ({ f, r })));
    const top = Math.max(-1, ...pulls.map((p) => p.f.difficulty ?? 0));
    const best = pulls
      .filter((p) => (p.f.difficulty ?? 0) === top)
      .sort((a, b) => a.f.percent - b.f.percent || b.r.startTime - a.r.startTime)[0];
    return { enc, best, top };
  });

  const byReport = new Map<string, string[]>();
  for (const { enc, best } of picks) {
    if (!best) continue;
    const alias = `b${enc.id}: table(fightIDs:[${best.f.id}], dataType:DamageTaken, viewBy:Ability, startTime:${best.f.startTime}, endTime:${best.f.endTime})`;
    byReport.set(best.r.code, [...(byReport.get(best.r.code) ?? []), alias]);
  }
  const reportAliases = [...byReport].map(([code, tables]) => `r_${code}: report(code:"${code}"){ ${tables.join(" ")} }`);
  const d = reportAliases.length
    ? await gql<{ reportData: Record<string, Record<string, any>> }>(`{ reportData{ ${reportAliases.join(" ")} } }`, {}, FOREVER)
    : null;

  return picks.map(({ enc, best, top }) => {
    const spells = new Map<string, RaidSpell>();
    if (best) {
      for (const a of tableEntries(d?.reportData[`r_${best.r.code}`]?.[`b${enc.id}`])) {
        const sources: { type?: string }[] = a.sources ?? [];
        const hostile =
          a.actorType === "Boss" || a.actorType === "NPC" || (sources.length > 0 && sources.every((x) => x.type === "Boss" || x.type === "NPC"));
        if (!hostile || !a.total || a.guid <= 1) continue;
        const cur: RaidSpell = spells.get(a.name) ?? { ids: [] as number[], name: a.name, icon: a.abilityIcon, total: 0, hits: 0 };
        if (!cur.ids.includes(a.guid)) cur.ids.push(a.guid);
        cur.total += a.total;
        cur.hits += (a.hitCount ?? 0) + (a.tickCount ?? 0);
        spells.set(a.name, cur);
      }
    }
    return {
      encounterId: enc.id,
      name: enc.name,
      difficulty: best ? top : null,
      source: best
        ? { code: best.r.code, fightId: best.f.id, kill: best.f.kill, percent: best.f.percent, date: best.r.startTime }
        : null,
      spells: [...spells.values()].sort((a, b) => b.total - a.total),
    };
  });
}

// ---------------------------------------------------------------- defensives (one request per raid night)

export interface NightDefensives {
  byFight: Record<number, DefensiveCast[]>;
  known: Record<number, string[]>;
  spells: Record<string, { kind: DefensiveKind; cd: number; oncePerPull?: boolean; group?: string }>;
}

/**
 * Every cast of a defensive / consumable / external in the night's boss pulls. Spells are found by name in the
 * report's spell list (see src/config/defensives.ts), then only those casts are downloaded.
 */
export async function fetchNightDefensives(code: string): Promise<NightDefensives> {
  const raw = await fetchRawReport(code);
  const spells: NightDefensives["spells"] = {};
  const keyById = new Map<number, string>();
  const personal = new Map<string, number>(); // lower-case name -> cd
  for (const list of Object.values(CLASS_DEFENSIVES)) for (const s of list) personal.set(s.name.toLowerCase(), s.cd);
  const externals = new Set(EXTERNALS.map((n) => n.toLowerCase()));

  const groupById = new Map<number, string>(); // spells that only put a shared cooldown on something (other potions)
  for (const a of raw.masterData.abilities) {
    const n = a.name.toLowerCase();
    const cons = CONSUMABLES.find((c) => c.match.test(a.name));
    if (cons) {
      keyById.set(a.gameID, cons.label);
      spells[cons.label] = { kind: "consumable", cd: cons.cd, oncePerPull: cons.oncePerPull, group: cons.group?.source };
    } else if (personal.has(n)) {
      keyById.set(a.gameID, a.name);
      spells[a.name] = { kind: "personal", cd: personal.get(n)! };
    } else if (externals.has(n)) {
      keyById.set(a.gameID, a.name);
      spells[a.name] = { kind: "external", cd: 0 };
    }
  }
  // e.g. Potion of Recklessness: not a defensive, but it starts the shared potion cooldown
  for (const c of CONSUMABLES)
    if (c.group)
      for (const a of raw.masterData.abilities)
        if (c.group.test(a.name) && !keyById.has(a.gameID)) groupById.set(a.gameID, c.group.source);

  const fights = raw.fights.map(normalizeFight).filter((f) => f.encounterId > 0);
  const ids = [...keyById.keys(), ...groupById.keys()];
  const events =
    ids.length && fights.length
      ? await fetchEventsPerFight(code, fights, "Casts", `ability.id in (${ids.join(",")})`, pullTtl(raw))
      : [];

  const abilityName = new Map(raw.masterData.abilities.map((a) => [a.gameID, a.name]));
  const actors = new Map(raw.masterData.actors.map((a) => [a.id, a]));
  const owner = (id: number) => actors.get(id)?.petOwner ?? id;
  const byFight: NightDefensives["byFight"] = {};
  const known = new Map<number, Set<string>>();
  for (const e of events) {
    if (e.type !== "cast") continue;
    const id = e.abilityGameID as number;
    const key = keyById.get(id);
    const group = key ? spells[key].group : groupById.get(id);
    if (!key && !group) continue;
    const cast: DefensiveCast = {
      t: e.timestamp,
      sourceId: owner(e.sourceID as number),
      // self-cast defensives often have no target
      targetId: (e.targetID as number) > 0 ? (e.targetID as number) : owner(e.sourceID as number),
      key: key ?? "",
      group,
      spell: abilityName.get(id),
    };
    (byFight[e.fight as number] ??= []).push(cast);
    if (key && spells[key].kind !== "external") {
      if (!known.has(cast.sourceId)) known.set(cast.sourceId, new Set());
      known.get(cast.sourceId)!.add(key);
    }
  }
  return { byFight, known: Object.fromEntries([...known].map(([k, v]) => [k, [...v]])), spells };
}
