import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import Link from "next/link";
import SessionCard, { type SessionCardData } from "@/components/SessionCard";
import Tabs from "@/components/Tabs";
import TopBar from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, sessions, signups } from "@/lib/db/schema";
import { getAllRounds } from "@/lib/sessions/queries";

/**
 * Split by time, not by kind.
 *
 * The tabs used to be Matches and Events, meaning rated and casual. That's a
 * real distinction in the data but not the question anyone opens the app with —
 * which is "what's next" and occasionally "what happened". Casual sessions now
 * appear in both lists, marked on the card.
 */
type TabKey = "upcoming" | "history";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = await getCurrentPlayer();

  if (!me) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <div className="mb-10 text-center">
          <p className="text-5xl">🏓</p>
          <h1 className="mt-4 text-3xl font-bold">PicklePlay</h1>
          <p className="mt-2 text-[var(--muted)]">
            Organize your sessions, auto-build the matchups, and track everyone&apos;s
            rating.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Link href="/register" className="btn-primary text-center">
            Create an account
          </Link>
          <Link href="/login" className="btn-ghost text-center">
            Log in
          </Link>
        </div>
      </main>
    );
  }

  const { tab } = await searchParams;
  const active: TabKey = tab === "history" ? "history" : "upcoming";

  const db = getDb();

  // Upcoming reads soonest-first; history reads most-recent-first.
  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      location: sessions.location,
      startsAt: sessions.startsAt,
      status: sessions.status,
      rated: sessions.rated,
      courtNames: sessions.courtNames,
      maxPlayers: sessions.maxPlayers,
      format: sessions.format,
      organizer: players.username,
    })
    .from(sessions)
    .leftJoin(players, eq(players.id, sessions.createdBy))
    .where(
      active === "history"
        ? eq(sessions.status, "closed")
        : ne(sessions.status, "closed"),
    )
    .orderBy(active === "history" ? desc(sessions.startsAt) : asc(sessions.startsAt))
    .limit(40);

  const ids = rows.map((r) => r.id);

  const [counts, mine] = ids.length
    ? await Promise.all([
        db
          .select({ sessionId: signups.sessionId, n: sql<number>`count(*)::int` })
          .from(signups)
          .where(and(inArray(signups.sessionId, ids), eq(signups.state, "in")))
          .groupBy(signups.sessionId),
        db
          .select({ sessionId: signups.sessionId, state: signups.state })
          .from(signups)
          .where(and(inArray(signups.sessionId, ids), eq(signups.playerId, me.id))),
      ])
    : [[], []];

  const countBy = new Map(counts.map((c) => [c.sessionId, c.n]));
  const stateBy = new Map(mine.map((m) => [m.sessionId, m.state]));

  const cards: SessionCardData[] = rows.map((r) => ({
    ...r,
    signedUp: countBy.get(r.id) ?? 0,
    myState: stateBy.get(r.id),
  }));

  // Mid-session the only thing anyone wants is which court they're on.
  const playingNow = cards.find((c) => c.status === "live" && c.myState === "in");
  const liveRounds = playingNow ? await getAllRounds(playingNow.id, playingNow.courtNames) : [];
  const mineInRounds = liveRounds
    .map((r) => ({
      index: r.index,
      match: r.matches.find((m) => [...m.teamA, ...m.teamB].some((p) => p.id === me.id)),
    }))
    .filter((x): x is { index: number; match: NonNullable<typeof x.match> } => !!x.match);
  const upNext = mineInRounds.find((x) => !x.match.completed) ?? mineInRounds.at(-1);

  return (
    <>
      <TopBar />
      <Tabs
        active={active}
        items={[
          { key: "upcoming", label: "Upcoming", href: "/" },
          { key: "history", label: "History", href: "/?tab=history" },
        ]}
      />

      <main className="screen pt-4">
        {upNext && playingNow ? (
          <Link
            href={`/s/${playingNow.id}`}
            className="mb-4 block rounded-2xl bg-[var(--accent)] p-5 text-white active:opacity-80"
          >
            <p className="text-sm font-semibold opacity-90">
              You&apos;re up · Round {upNext.index}
            </p>
            <p className="mt-1 text-2xl font-bold">{upNext.match.courtLabel}</p>
            <p className="mt-1 text-sm opacity-90">
              {[...upNext.match.teamA, ...upNext.match.teamB]
                .map((p) => (p.id === me.id ? "you" : p.username))
                .join(", ")}
            </p>
            <p className="mt-3 text-sm font-semibold">
              {upNext.match.completed ? "Score recorded — tap to change" : "Tap to enter the score"}
            </p>
          </Link>
        ) : null}

        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-sm text-[var(--muted)]">
            {cards.length}{" "}
            {active === "upcoming"
              ? `session${cards.length === 1 ? "" : "s"} coming up`
              : `finished session${cards.length === 1 ? "" : "s"}`}
          </h2>
          <Link href="/leaderboard" className="text-sm text-[var(--muted)]">
            Rankings ›
          </Link>
        </div>

        {cards.length === 0 ? (
          <div className="card py-14 text-center">
            {active === "upcoming" ? (
              <>
                <p className="text-[var(--muted)]">Nothing scheduled.</p>
                <p className="hint">Tap + below to set one up.</p>
              </>
            ) : (
              <>
                <p className="text-[var(--muted)]">No finished sessions yet.</p>
                <p className="hint">
                  Sessions move here once the organizer closes them, with their
                  results kept.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {cards.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
