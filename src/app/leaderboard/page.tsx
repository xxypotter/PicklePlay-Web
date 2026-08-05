import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import Tabs from "@/components/Tabs";
import TopBar, { safeFrom } from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";

export const metadata = { title: "Rankings · PicklePlay" };

type TabKey = "all" | "male" | "female";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string }>;
}) {
  const { tab, from } = await searchParams;
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

  /*
   * "Not listed" means exactly that — including on the All tab. Anyone who
   * picked it stays out of every ranking table, which is the promise the
   * signup and profile copy makes.
   */
  const listed = all.filter((r) => r.gender !== "unspecified");
  const rows = active === "all" ? listed : listed.filter((r) => r.gender === active);
  const meOptedOut = !!me && all.some((r) => r.id === me.id && r.gender === "unspecified");

  /*
   * One list, everyone in it.
   *
   * Splitting settled players from provisional ones answered a real worry — a
   * self-declared 4.8 outranking people who have actually played — but it cost
   * more than it fixed: half the group sat under a second heading that read
   * like a waiting room, and on a young group the main table was empty. A `?`
   * on the number says the same thing without breaking the list in two.
   */

  const base = "/leaderboard";
  // Rankings hangs off both Home and Me, so where back goes depends on which
  // one you came through. Default to Home for a cold link.
  const backTo = safeFrom(from, "/");

  /**
   * Every link that stays on this page has to carry `from` forward, or
   * switching tabs would quietly strip it and send back to the wrong place.
   */
  const here = (key: TabKey) => {
    const q = new URLSearchParams();
    if (key !== "all") q.set("tab", key);
    if (backTo !== "/") q.set("from", backTo);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const backHere = here(active);

  return (
    <>
      <TopBar title="Rankings" back={backTo} />
      <Tabs
        active={active}
        items={[
          { key: "all", label: "All", href: here("all") },
          { key: "male", label: "Boy", href: here("male") },
          { key: "female", label: "Girl", href: here("female") },
        ]}
      />

      <main className="screen pt-4">
        {/* Explain the absence rather than letting them wonder where they went. */}
        {meOptedOut ? (
          <p className="card mb-3 text-sm text-[var(--muted)]">
            You&apos;ve chosen <span className="font-medium">Not listed</span>, so you
            don&apos;t appear in these tables. Change it under Me.
          </p>
        ) : null}

        {rows.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-[var(--muted)]">Nobody in this list yet.</p>
            <p className="hint">
              Players choose their list under Me, or when they sign up.
            </p>
          </div>
        ) : (
          <>
            <Table rows={rows} meId={me?.id} startRank={1} backHere={backHere} />

            {rows.some((r) => r.provisional) ? (
              <p className="mt-3 px-1 text-xs text-[var(--muted)]">
                <span className="font-mono font-semibold">?</span> means the
                rating is still settling — not enough matches here yet for it to
                be dependable. It clears after a full session or two.
              </p>
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

function Table({
  rows,
  meId,
  startRank,
  backHere,
}: {
  rows: Row[];
  meId?: string;
  startRank?: number;
  backHere: string;
}) {
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
              <Link
                href={`/p/${r.username}?from=${encodeURIComponent(backHere)}`}
                className="block truncate font-medium"
              >
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
              {r.provisional ? (
                <span className="text-[var(--muted)]">?</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
