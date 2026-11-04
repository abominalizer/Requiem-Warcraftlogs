import { AvoidableEditor } from "@/components/AvoidableEditor";
import { ErrorBox } from "@/components/ui";
import { ENCOUNTERS } from "@/config/encounters";
import { getSaved } from "@/lib/avoidable";
import { DIFFICULTY } from "@/lib/format";
import type { GuildHome, RaidBoss } from "@/lib/types";
import { fetchGuildHome, fetchRaidSpells } from "@/lib/wcl";

export const metadata = { title: "Raid · Requiem Logs" };

// Always render on request: the page reads live data (and must never be pre-built at deploy time).
export const dynamic = "force-dynamic";

export default async function RaidPage() {
  let home: GuildHome;
  let bosses: RaidBoss[];
  let saved: Record<string, number[]>;
  let savedUnsurvivable: Record<string, number[]>;
  try {
    home = await fetchGuildHome();
    [bosses, saved, savedUnsurvivable] = await Promise.all([fetchRaidSpells(home), getSaved("avoidable"), getSaved("unsurvivable")]);
  } catch (e) {
    return <ErrorBox message={(e as Error).message} />;
  }
  const fromCode = Object.fromEntries(Object.entries(ENCOUNTERS).map(([k, v]) => [k, v.avoidable ?? []]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{home.zone?.name ?? "Raid"}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Every boss of the current raid and the enemy spells that hit us. Mark the ones nobody should get hit by (frontals, pools,
          swirls…). Marked spells count as <b>avoidable damage</b> on every pull, combined analysis and progression page, and
          replace the site&apos;s guesses for that boss. Tick <b>can&apos;t be survived</b> for executes and one-shots that no defensive
          prevents: deaths to them aren&apos;t counted as &quot;died pressing nothing&quot;.
        </p>
      </div>
      {bosses.length === 0 ? (
        <p className="text-muted">No raid logs yet.</p>
      ) : (
        <AvoidableEditor
          bosses={bosses}
          saved={saved}
          savedUnsurvivable={savedUnsurvivable}
          fromCode={fromCode}
          canEdit={Boolean(process.env.ADMIN_PASSWORD)}
          difficultyNames={Object.fromEntries(Object.entries(DIFFICULTY))}
        />
      )}
    </div>
  );
}
