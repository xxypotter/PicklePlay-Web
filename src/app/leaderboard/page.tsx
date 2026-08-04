import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";

export const metadata = { title: "Leaderboard · PicklePlay" };

export default async function LeaderboardPage() {
  const [me, rows] = await Promise.all([
    getCurrentPlayer(),
    getDb()
      .select({
        id: players.id,
        username: players.username,
        rating: playerStats.rating,
        reliability: playerStats.reliability,
        provisional: playerStats.provisional,
        selfDeclared: playerStats.selfDeclared,
        localMatches: playerStats.localMatches,
        wins: playerStats.wins,
        losses: playerStats.losses,
      })
      .from(playerStats)
      .innerJoin(players, eq(players.id, playerStats.playerId))
      .where(eq(players.active, true))
      .orderBy(desc(playerStats.rating))
      .limit(200),
  ]);

  // Established players rank first. A provisional 4.8 hasn't earned a spot
  // above someone who has actually played here, so they're listed separately
  // rather than mixed in.
  const ranked = rows.filter((r) => !r.provisional);
  const provisional = rows.filter((r) => r.provisional);

  return (
    <>
      <TopBar title="Rankings" back="/" />
      <main className="screen pt-4">
      {rows.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">Nobody has a rating yet.</p>
      ) : (
        <>
          <Table rows={ranked} meId={me?.id} startRank={1} />

          {provisional.length > 0 ? (
            <>
              <h2 className="mt-8 mb-2 text-sm font-medium text-[var(--muted)]">
                Still settling
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                Not enough recent matches here for a reliable number yet.
              </p>
              <Table rows={provisional} meId={me?.id} />
            </>
          ) : null}
        </>
      )}
      </main>
    </>
  );
}

interface Row {
  id: string;
  username: string;
  rating: number;
  reliability: number;
  provisional: boolean;
  selfDeclared: boolean;
  localMatches: number;
  wins: number;
  losses: number;
}

function Table({
  rows,
  meId,
  startRank,
}: {
  rows: Row[];
  meId?: string;
  startRank?: number;
}) {
  if (rows.length === 0) {
    return <p className="card text-sm text-[var(--muted)]">Nobody here yet.</p>;
  }

  return (
    <ul className="card-tight divide-y divide-[var(--border)] overflow-hidden">
      {rows.map((r, i) => (
        <li
          key={r.id}
          className={`flex items-center gap-3 px-4 py-3 ${
            r.id === meId ? "bg-[var(--accent-soft)]" : ""
          }`}
        >
          {startRank !== undefined ? (
            <span className="w-5 shrink-0 text-sm text-[var(--muted)] tabular-nums">
              {startRank + i}
            </span>
          ) : null}

          <div className="min-w-0 flex-1">
            <Link href={`/p/${r.username}`} className="truncate font-medium underline-offset-2 hover:underline">
              {r.username}
            </Link>
            <p className="text-xs text-[var(--muted)]">
              {r.localMatches === 0
                ? "No matches yet"
                : `${r.wins}W–${r.losses}L · ${Math.round((r.wins / Math.max(1, r.wins + r.losses)) * 100)}%`}
              {r.selfDeclared ? " · self-declared" : ""}
            </p>
          </div>

          <span className="shrink-0 font-mono text-lg font-semibold tabular-nums">
            {r.rating.toFixed(3)}
          </span>
        </li>
      ))}
    </ul>
  );
}
