import "server-only";
import type {
  Ability,
  AmountEntry,
  DamageEvent,
  DeathRecord,
  Fight,
  FightDetail,
  GuildHome,
  GuildReportSummary,
  InterruptEvent,
  PhaseInfo,
  Player,
  ReportSummary,
  Role,
} from "./types";
import { GUILD_ID } from "@/config/guild";
import { pickAvoidable } from "./analysis";

const API_URL = "https://www.warcraftlogs.com/api/v2/client";
const TOKEN_URL = "https://www.warcraftlogs.com/oauth/token";

export class WclError extends Error {}

export function hasCredentials() {
  return Boolean(process.env.WCL_CLIENT_ID && process.env.WCL_CLIENT_SECRET);
}

// ---------------------------------------------------------------- auth + transport

let token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const id = process.env.WCL_CLIENT_ID;
  const secret = process.env.WCL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new WclError(
      "Warcraft Logs API credentials are missing. Set WCL_CLIENT_ID and WCL_CLIENT_SECRET in .env.local.",
    );
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
  return token.value;
}

// Small in-memory cache: finished reports never change, so this saves a lot of API points.
const cache = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();
const MAX_CACHE = 500;

async function gql<T>(query: string, variables: Record<string, unknown>, ttlMs = 10 * 60_000): Promise<T> {
  const key = query + JSON.stringify(variables);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as Promise<T>;

  const p = (async () => {
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
    return json.data as T;
  })();

  cache.set(key, { at: Date.now(), ttl: ttlMs, value: p });
  p.catch(() => cache.delete(key));
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return p;
}

// ---------------------------------------------------------------- guild

const GUILD_QUERY = `query($id:Int!){
  guildData{ guild(id:$id){ id name faction{ name } server{ name region{ slug } } } }
  reportData{ reports(guildID:$id, limit:25){
    data{ code title startTime endTime zone{ id name }
      fights(killType: Encounters){ encounterID name kill difficulty fightPercentage bossPercentage } }
  }}}`;

const ZONE_QUERY = `query($id:Int!){ worldData{ zone(id:$id){ id name encounters{ id name } } } }`;

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
          zone: { id: number; name: string } | null;
          fights: { encounterID: number; name: string; kill: boolean | null; difficulty: number | null; fightPercentage: number | null; bossPercentage: number | null }[] | null;
        }[];
      };
    };
  };
  const d = await gql<R>(GUILD_QUERY, { id: GUILD_ID }, 5 * 60_000);
  const g = d.guildData.guild;
  if (!g) throw new WclError(`Guild ${GUILD_ID} not found on Warcraft Logs.`);
  const reports: GuildReportSummary[] = d.reportData.reports.data.map((r) => ({
    code: r.code,
    title: r.title,
    startTime: r.startTime,
    endTime: r.endTime,
    zone: r.zone,
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
  const latestZone = reports.find((r) => r.zone && r.fights.length)?.zone;
  let zone: GuildHome["zone"] = null;
  if (latestZone) {
    const z = await gql<{ worldData: { zone: { id: number; name: string; encounters: { id: number; name: string }[] } | null } }>(
      ZONE_QUERY,
      { id: latestZone.id },
      24 * 60 * 60_000,
    );
    zone = z.worldData.zone;
  }
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

async function fetchRawReport(code: string): Promise<RawReport> {
  const d = await gql<{ reportData: { report: RawReport | null } }>(REPORT_QUERY, { code }, 2 * 60_000);
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

const FIGHT_TABLES = `query($code:String!,$f:[Int]!,$s:Float!,$e:Float!){
  reportData{ report(code:$code){
    dd: table(fightIDs:$f, dataType:DamageDone, startTime:$s, endTime:$e)
    hd: table(fightIDs:$f, dataType:Healing, startTime:$s, endTime:$e)
    deaths: events(fightIDs:$f, dataType:Deaths, startTime:$s, endTime:$e, limit:1000){ data }
    pd: playerDetails(fightIDs:$f, startTime:$s, endTime:$e)
  }}}`;

const EVENTS = (type: string) => `query($code:String!,$f:[Int]!,$s:Float!,$e:Float!){
  reportData{ report(code:$code){
    events(fightIDs:$f, dataType:${type}, startTime:$s, endTime:$e, limit:10000){ data nextPageTimestamp }
  }}}`;

type RawEvent = Record<string, unknown> & { timestamp: number; type: string };

async function fetchAllEvents(code: string, fightId: number, s: number, e: number, type: string) {
  const out: RawEvent[] = [];
  let start = s;
  for (let i = 0; i < 30; i++) {
    const d = await gql<{
      reportData: { report: { events: { data: RawEvent[]; nextPageTimestamp: number | null } } };
    }>(EVENTS(type), { code, f: [fightId], s: start, e }, 60 * 60_000);
    const ev = d.reportData.report.events;
    out.push(...(ev.data ?? []));
    if (!ev.nextPageTimestamp || ev.nextPageTimestamp >= e) break;
    start = ev.nextPageTimestamp;
  }
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

  const [tables, dmgTaken, interrupts] = await Promise.all([
    gql<{ reportData: { report: { dd: any; hd: any; deaths: any; pd: any } } }>(FIGHT_TABLES, vars, 60 * 60_000),
    fetchAllEvents(code, fightId, fight.startTime, fight.endTime, "DamageTaken"),
    fetchAllEvents(code, fightId, fight.startTime, fight.endTime, "Interrupts"),
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

  const deaths: DeathRecord[] = ((t.deaths?.data ?? []) as RawEvent[])
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


async function fetchEventsMulti(code: string, fightIds: number[], s: number, e: number, type: string, filter?: string) {
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
      60 * 60_000,
    );
    const ev = d.reportData.report.events;
    out.push(...(ev.data ?? []));
    if (!ev.nextPageTimestamp || ev.nextPageTimestamp >= e) break;
    start = ev.nextPageTimestamp;
  }
  return out;
}

/** Events for many fights at once: one GraphQL request per round, one alias per fight still paging. */
async function fetchEventsPerFight(code: string, fights: Fight[], type: string, filter: string) {
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
      60 * 60_000,
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

export async function fetchProgressionDetails(code: string, fightIds: number[]): Promise<FightDetail[]> {
  const raw = await fetchRawReport(code);
  const rfs = fightIds.map((id) => {
    const f = raw.fights.find((x) => x.id === id);
    if (!f) throw new WclError(`Fight ${id} not found in report ${code}.`);
    return f;
  });
  const fights = rfs.map(normalizeFight);
  const s = Math.min(...fights.map((f) => f.startTime));
  const e = Math.max(...fights.map((f) => f.endTime));
  const encounterId = fights[0].encounterId;

  // DPS per pull + roles + damage-taken totals per ability, all in one request.
  const ddAliases = fights
    .map((f) => `dd${f.id}: table(fightIDs:[${f.id}], dataType:DamageDone, startTime:${f.startTime}, endTime:${f.endTime})`)
    .join("\n");
  const batch = `query($code:String!,$f:[Int]!,$s:Float!,$e:Float!){
    reportData{ report(code:$code){
      pd: playerDetails(fightIDs:$f, startTime:$s, endTime:$e)
      dt: table(fightIDs:$f, dataType:DamageTaken, viewBy:Ability, startTime:$s, endTime:$e)
      dtt: table(fightIDs:$f, dataType:DamageTaken, viewBy:Target, startTime:$s, endTime:$e)
      ${ddAliases}
    }}}`;
  const vars = { code, f: fightIds, s, e };
  const [b, deathEvents, kickEvents] = await Promise.all([
    gql<{ reportData: { report: Record<string, any> } }>(batch, vars, 60 * 60_000),
    fetchEventsMulti(code, fightIds, s, e, "Deaths"),
    fetchEventsMulti(code, fightIds, s, e, "Interrupts"),
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

  // Pick avoidable abilities from the summed table, then fetch only their hits.
  const dtEntries = tableEntries(rep.dt);
  // The by-ability table only lists each ability's top 5 targets, so count who got hit from the by-player table.
  const hitBy = new Map<number, string[]>();
  for (const p of tableEntries(rep.dtt))
    for (const a of p.abilities ?? []) hitBy.set(a.guid, [...(hitBy.get(a.guid) ?? []), p.name]);
  const knownAvoidable = pickAvoidable(
    encounterId,
    dtEntries.map((a) => ({
      id: a.guid,
      hostile: a.actorType === "Boss" || a.actorType === "NPC",
      hits: (a.hitCount ?? 0) + (a.tickCount ?? 0),
      targets: hitBy.get(a.guid) ?? [],
    })),
    new Set(roster.filter((p) => p.role !== "tank").map((p) => p.name)),
  );
  const avoidIds = Object.keys(knownAvoidable).map(Number);
  const hits = avoidIds.length
    ? await fetchEventsPerFight(code, fights, "DamageTaken", `ability.id in (${avoidIds.join(",")})`)
    : [];

  const abilities: Record<number, Ability> = {};
  for (const a of raw.masterData.abilities) abilities[a.gameID] = { id: a.gameID, name: a.name, icon: a.icon };
  const phases = raw.phases?.find((p) => p.encounterID === encounterId)?.phases ?? [];

  return fights.map((fight) => {
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
      phases,
      knownAvoidable,
    };
  });
}
