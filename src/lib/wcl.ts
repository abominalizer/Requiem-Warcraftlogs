import "server-only";
import type {
  Ability,
  AmountEntry,
  DamageEvent,
  DeathRecord,
  Fight,
  FightDetail,
  GuildReport,
  InterruptEvent,
  PhaseInfo,
  Player,
  ReportSummary,
  Role,
} from "./types";

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
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
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

export async function fetchGuildReports(
  name: string,
  server: string,
  region: string,
  page = 1,
): Promise<{ reports: GuildReport[]; hasMore: boolean }> {
  const q = `query($n:String!,$s:String!,$r:String!,$p:Int!){
    reportData{ reports(guildName:$n, guildServerSlug:$s, guildServerRegion:$r, limit:25, page:$p){
      has_more_pages
      data{ code title startTime endTime zone{ name } }
    }}}`;
  type R = {
    reportData: {
      reports: {
        has_more_pages: boolean;
        data: { code: string; title: string; startTime: number; endTime: number; zone: { name: string } | null }[];
      };
    };
  };
  const d = await gql<R>(q, { n: name, s: server, r: region, p: page }, 5 * 60_000);
  return {
    hasMore: d.reportData.reports.has_more_pages,
    reports: d.reportData.reports.data.map((r) => ({
      code: r.code,
      title: r.title,
      startTime: r.startTime,
      endTime: r.endTime,
      zone: r.zone?.name ?? null,
    })),
  };
}

// ---------------------------------------------------------------- report

const REPORT_QUERY = `query($code:String!){
  reportData{ report(code:$code){
    code title startTime endTime
    zone{ name }
    owner{ name }
    guild{ name server{ name region{ slug } } }
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
  guild: { name: string; server: { name: string; region: { slug: string } } } | null;
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
  if (!d.reportData.report) throw new WclError(`Report "${code}" not found (or it is private).`);
  return d.reportData.report;
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
    deaths: table(fightIDs:$f, dataType:Deaths, startTime:$s, endTime:$e)
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

  const damageTaken: DamageEvent[] = dmgTaken
    .filter((e) => e.type === "damage" && playerIds.has(e.targetID as number))
    .map((e) => ({
      t: e.timestamp,
      targetId: e.targetID as number,
      sourceId: (e.sourceID as number) ?? -1,
      abilityId: (e.abilityGameID as number) ?? 0,
      amount: ((e.amount as number) ?? 0) + ((e.absorbed as number) ?? 0),
      overkill: (e.overkill as number) ?? 0,
    }));

  const deaths: DeathRecord[] = tableEntries(t.deaths)
    .filter((d) => playerIds.has(d.id))
    .map((d) => {
      let time: number = d.deathTime ?? d.timestamp ?? 0;
      if (time < fight.startTime) time += fight.startTime; // some versions report fight-relative
      const kb = d.killingBlow ?? d.ability;
      return { playerId: d.id, t: time, killingAbilityId: kb?.guid ?? null };
    });

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
