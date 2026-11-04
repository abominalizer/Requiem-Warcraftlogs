import { NextRequest, NextResponse } from "next/server";
import { parseReportInput } from "@/lib/format";

export function GET(req: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url));
  const parsed = parseReportInput(req.nextUrl.searchParams.get("q") ?? "");
  if (!parsed) return to("/?error=report");
  return to(parsed.fight ? `/report/${parsed.code}/fight/${parsed.fight}` : `/report/${parsed.code}`);
}
