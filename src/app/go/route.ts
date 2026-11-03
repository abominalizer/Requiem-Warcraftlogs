import { NextRequest, NextResponse } from "next/server";
import { parseReportInput } from "@/lib/format";

const slug = (s: string) => s.trim().toLowerCase().replace(/'/g, "").replace(/\s+/g, "-");

export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));

  if (p.has("guild")) {
    const name = p.get("guild")?.trim();
    const server = p.get("server");
    const region = p.get("region") ?? "eu";
    if (!name || !server) return to("/?error=guild");
    return to(`/guild/${encodeURIComponent(region)}/${encodeURIComponent(slug(server))}/${encodeURIComponent(name)}`);
  }

  const parsed = parseReportInput(p.get("q") ?? "");
  if (!parsed) return to("/?error=report");
  return to(parsed.fight ? `/report/${parsed.code}/fight/${parsed.fight}` : `/report/${parsed.code}`);
}
