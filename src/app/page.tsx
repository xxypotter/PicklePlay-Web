import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import Link from "next/link";
import SessionCard, { type SessionCardData } from "@/components/SessionCard";
import Tabs from "@/components/Tabs";
import TopBar from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, sessions, signups } from "@/lib/db/schema";
import { closeStaleSessions } from "@/lib/sessions/auto-close";

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

  // Sessions nobody remembered to end shouldn't linger in Upcoming.
  await closeStaleSessions();

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

  const myCards = cards.filter((c) => c.myState);
  const otherCards = cards.filter((c) => !c.myState);

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
        <div className="mb-3 flex items-baseline justify-between px-1">
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
          <>
            {/* Yours first — the ones you need to act on shouldn't be hunted for. */}
            {myCards.length > 0 ? (
              <section className="mb-6">
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                  {active === "upcoming" ? "You're in" : "You played"}
                </h3>
                <div className="flex flex-col gap-3">
                  {myCards.map((s) => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              </section>
            ) : null}

            {otherCards.length > 0 ? (
              <section>
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {active === "upcoming"
                    ? myCards.length > 0
                      ? "Also open"
                      : "Open to join"
                    : "Other sessions"}
                </h3>
                <div className="flex flex-col gap-3">
                  {otherCards.map((s) => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
