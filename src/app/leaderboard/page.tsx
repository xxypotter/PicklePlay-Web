import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import Tabs from "@/components/Tabs";
import TopBar from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";

export const metadata = { title: "Rankings · PicklePlay" };

type TabKey = "all" | "male" | "female";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: TabKey = tab === "male" ? "male" : tab === "female" ? "female" : "all";

  const [me, all] = await Promise.all([
    getCurrentPlayer(),
    getDb()
      .select({
        id: players.id,
        username: players.username,
        avatar: players.avatar,
        gender: players.gender,
        rating: playerStats.rating,
        reliability: playerStats.reliability,
        provisional: playerStats.provisional,
        selfDeclared: playerStats.selfDeclared,
        localMatches: playerStats.localMatches,
        wins: playerStats.wins,
        losses: playerStats.losses,
        importedMatches: players.importedMatches,
        importedWins: players.importedWins,
      })
      .from(playerStats)
      .innerJoin(players, eq(players.id, playerStats.playerId))
      .where(eq(players.active, true))
      .orderBy(desc(playerStats.rating))
      .limit(300),
  ]);

  const rows = active === "all" ? all : all.filter((r) => r.gender === active);

  // Established players rank first. A provisional 4.8 hasn't earned a spot
  // above someone who has actually played here, so they're listed separately.
  const ranked = rows.filter((r) => !r.provisional);
  const provisional = rows.filter((r) => r.provisional);

  const base = "/leaderboard";

  return (
    <>
      <TopBar title="Rankings" back="/" />
      <Tabs
        active={active}
        items={[
          { key: "all", label: "All", href: base },
          { key: "male", label: "Men", href: `${base}?tab=male` },
          { key: "female", label: "Women", href: `${base}?tab=female` },
        ]}
      />

      <main className="screen pt-4">
        {rows.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-[var(--muted)]">Nobody in this list yet.</p>
            <p className="hint">
              Players choose their list under Me, or when they sign up.
            </p>
          </div>
        ) : (
          <>
            <Table rows={ranked} meId={me?.id} startRank={1} />

            {provisional.length > 0 ? (
              <>
                <h2 className="mt-6 mb-1 px-1 text-sm text-[var(--muted)]">Still settling</h2>
                <p className="mb-2 px-1 text-xs text-[var(--muted)]">
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
  avatar: string | null;
  rating: number;
  provisional: boolean;
  selfDeclared: boolean;
  localMatches: number;
  wins: number;
  losses: number;
  importedMatches: number;
  importedWins: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Table({ rows, meId, startRank }: { rows: Row[]; meId?: string; startRank?: number }) {
  if (rows.length === 0) {
    return (
      <div className="card py-8 text-center text-sm text-[var(--muted)]">Nobody here yet.</div>
    );
  }

  return (
    <ul className="card-tight overflow-hidden">
      {rows.map((r, i) => {
        // Career totals: what they brought with them plus what they've done here.
        const matches = r.importedMatches + r.wins + r.losses;
        const wins = r.importedWins + r.wins;
        const rate = matches > 0 ? Math.round((wins / matches) * 100) : null;

        return (
          <li
            key={r.id}
            className={`flex items-center gap-3 border-b border-[var(--border)] px-4 py-3
              last:border-0 ${r.id === meId ? "bg-[var(--accent-soft)]" : ""}`}
          >
            {startRank !== undefined ? (
              <span className="w-6 shrink-0 text-center text-sm tabular-nums">
                {MEDALS[i] ?? startRank + i}
              </span>
            ) : null}

            <Avatar username={r.username} avatar={r.avatar} size={36} />

            <div className="min-w-0 flex-1">
              <Link href={`/p/${r.username}`} className="block truncate font-medium">
                {r.username}
              </Link>
              <p className="text-xs text-[var(--muted)]">
                {matches === 0
                  ? "No matches yet"
                  : `${matches} played · ${rate}% won`}
                {r.importedMatches > 0 ? ` · ${r.importedMatches} imported` : ""}
              </p>
            </div>

            <span className="shrink-0 font-mono text-lg font-semibold tabular-nums text-[var(--accent)]">
              {r.rating.toFixed(3)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
