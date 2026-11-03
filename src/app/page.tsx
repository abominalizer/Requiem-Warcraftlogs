import Link from "next/link";
import { hasCredentials } from "@/lib/wcl";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const input = "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent";
  const btn = "rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:brightness-110";
  return (
    <div className="mx-auto max-w-3xl py-8">
      <h1 className="text-3xl font-bold">Find out why you wiped.</h1>
      <p className="mt-2 text-muted">
        Paste a Warcraft Logs report or look up your guild. Every pull gets broken down into deaths, avoidable damage,
        interrupts and performance, plus a progression view across all pulls on a boss.
      </p>

      {!hasCredentials() && (
        <div className="mt-6 rounded-lg border border-warn/60 bg-warn/10 p-4 text-sm">
          <b>API keys not configured.</b> Create a client at{" "}
          <a className="underline" href="https://www.warcraftlogs.com/api/clients/" target="_blank" rel="noreferrer">
            warcraftlogs.com/api/clients
          </a>{" "}
          and add <code>WCL_CLIENT_ID</code> and <code>WCL_CLIENT_SECRET</code> to <code>.env.local</code>. Meanwhile you
          can explore the{" "}
          <Link href="/report/demo" className="underline">
            demo report
          </Link>
          .
        </div>
      )}

      <form action="/go" className="panel mt-8 p-5">
        <h2 className="h2">Analyze a report</h2>
        <div className="flex gap-2">
          <input name="q" required placeholder="https://www.warcraftlogs.com/reports/AbC123xYz...  or report code" className={input} />
          <button className={btn}>Analyze</button>
        </div>
        {error === "report" && <p className="mt-2 text-sm text-bad">That doesn&apos;t look like a report URL or code.</p>}
      </form>

      <form action="/go" className="panel mt-4 p-5">
        <h2 className="h2">Guild reports</h2>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_90px_auto]">
          <input name="guild" required placeholder="Guild name" className={input} />
          <input name="server" required placeholder="Realm (e.g. Tarren Mill)" className={input} />
          <select name="region" className={input} defaultValue="eu">
            {["eu", "us", "kr", "tw", "cn"].map((r) => (
              <option key={r} value={r}>
                {r.toUpperCase()}
              </option>
            ))}
          </select>
          <button className={btn}>Search</button>
        </div>
        {error === "guild" && <p className="mt-2 text-sm text-bad">Enter a guild name and realm.</p>}
      </form>
    </div>
  );
}
