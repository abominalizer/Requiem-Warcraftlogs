import Link from "next/link";
import { ErrorBox } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { fetchGuildReports } from "@/lib/wcl";

export default async function GuildPage({
  params,
  searchParams,
}: {
  params: Promise<{ region: string; server: string; name: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { region, server, name } = await params;
  const page = Math.max(1, Number((await searchParams).page ?? 1));
  const guild = decodeURIComponent(name);
  let data;
  try {
    data = await fetchGuildReports(guild, server, region, page);
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }
  const base = `/guild/${region}/${server}/${name}`;
  return (
    <div>
      <h1 className="text-2xl font-bold">{guild}</h1>
      <p className="mb-6 text-sm text-muted">
        {server} ({region.toUpperCase()})
      </p>
      {data.reports.length === 0 ? (
        <p className="text-muted">No public reports found. Check the guild name and realm spelling.</p>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Report</th>
                <th>Zone</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.code}>
                  <td>
                    <Link href={`/report/${r.code}`} className="font-medium hover:text-accent">
                      {r.title}
                    </Link>
                  </td>
                  <td className="text-muted">{r.zone ?? "—"}</td>
                  <td className="text-muted">{fmtDate(r.startTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex gap-4 text-sm">
        {page > 1 && <Link href={`${base}?page=${page - 1}`} className="text-info">← Newer</Link>}
        {data.hasMore && <Link href={`${base}?page=${page + 1}`} className="text-info">Older →</Link>}
      </div>
    </div>
  );
}
