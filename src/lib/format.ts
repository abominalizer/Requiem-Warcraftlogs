export function fmtNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return Math.round(n).toString();
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const DIFFICULTY: Record<number, string> = { 1: "LFR", 3: "Normal", 4: "Heroic", 5: "Mythic", 10: "M+" };
export const diffName = (d: number | null) => (d != null ? (DIFFICULTY[d] ?? `Diff ${d}`) : "");

export const CLASS_COLORS: Record<string, string> = {
  DeathKnight: "#C41E3A",
  DemonHunter: "#A330C9",
  Druid: "#FF7C0A",
  Evoker: "#33937F",
  Hunter: "#AAD372",
  Mage: "#3FC7EB",
  Monk: "#00FF98",
  Paladin: "#F48CBA",
  Priest: "#FFFFFF",
  Rogue: "#FFF468",
  Shaman: "#0070DD",
  Warlock: "#8788EE",
  Warrior: "#C69B6D",
};
export const classColor = (c: string) => CLASS_COLORS[c.replace(/\s/g, "")] ?? "#9ca3af";

export const abilityIconUrl = (icon?: string) =>
  icon ? `https://assets.rpglogs.com/img/warcraft/abilities/${icon}` : null;

/** Accepts a WCL report URL (any form) or a bare report code; returns { code, fight }. */
export function parseReportInput(input: string): { code: string; fight?: number } | null {
  const s = input.trim();
  const m = s.match(/reports\/(?:a:)?([A-Za-z0-9]{8,})/);
  const code = m?.[1] ?? (/^[A-Za-z0-9]{8,}$/.test(s) || s === "demo" ? s : null);
  if (!code) return null;
  const f = s.match(/fight=(\d+|last)/);
  return { code, fight: f && f[1] !== "last" ? Number(f[1]) : undefined };
}
