import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import { isAtLeast } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { matches, sessions, signups } from "@/lib/db/schema";

export const metadata = { title: "Sessions · PicklePlay" };

export default async function SessionsPage() {
  const me = await getCurrentPlayer();
  if (!me) redirect("/login");

  const db = getDb();

  const all = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      location: sessions.location,
      startsAt: sessions.startsAt,
      status: sessions.status,
      courtNames: sessions.courtNames,
      rated: sessions.rated,
    })
    .from(sessions)
    .orderBy(desc(sessions.startsAt))
    .limit(60);

  const ids = all.map((s) => s.id);

  const [playedCounts, mySignups] = ids.length
    ? await Promise.all([
        db
          .select({ sessionId: matches.sessionId, n: sql<number>`count(*)::int` })
          .from(matches)
          .where(and(inArray(matches.sessionId, ids), eq(matches.status, "completed")))
          .groupBy(matches.sessionId),
        db
          .select({ sessionId: signups.sessionId, state: signups.state })
          .from(signups)
          .where(and(inArray(signups.sessionId, ids), eq(signups.playerId, me.id))),
      ])
    : [[], []];

  const matchesBy = new Map(playedCounts.map((c) => [c.sessionId, c.n]));
  const mineBy = new Map(mySignups.map((s) => [s.sessionId, s.state]));

  const past = all.filter((s) => s.status === "closed");
  const current = all.filter((s) => s.status !== "closed");

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <Link href="/" className="text-sm font-medium text-[var(--accent)] underline">
          Home
        </Link>
      </div>

      {isAtLeast(me.role, "admin") ? (
        <Link href="/sessions/new" className="btn-primary mb-6 block text-center">
          New session
        </Link>
      ) : null}

      <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">
        Upcoming &amp; in progress
      </h2>
      {current.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">Nothing scheduled.</p>
      ) : (
        <List rows={current} matchesBy={matchesBy} mineBy={mineBy} />
      )}

      <h2 className="mt-8 mb-2 text-sm font-medium text-[var(--muted)]">Past sessions</h2>
      {past.length === 0 ? (
        <p className="card text-sm text-[var(--muted)]">
          Nothing finished yet. Closed sessions stay here with their full results.
        </p>
      ) : (
        <List rows={past} matchesBy={matchesBy} mineBy={mineBy} />
      )}
    </main>
  );
}

interface Row {
  id: string;
  title: string;
  location: string | null;
  startsAt: Date;
  status: string;
  courtNames: string[];
  rated: boolean;
}

function List({
  rows,
  matchesBy,
  mineBy,
}: {
  rows: Row[];
  matchesBy: Map<string | null, number>;
  mineBy: Map<string, string>;
}) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((s) => {
        const played = matchesBy.get(s.id) ?? 0;
        const mine = mineBy.get(s.id);
        return (
          <li key={s.id}>
            <Link href={`/s/${s.id}`} className="card block active:opacity-70">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-semibold">{s.title}</span>
                {mine ? (
                  <span className="shrink-0 text-xs font-semibold text-[var(--accent)]">
                    {mine === "in" ? "You played" : "Waitlist"}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">
                <LocalDateTime iso={s.startsAt.toISOString()} />
                {s.location ? ` · ${s.location}` : ""}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {played > 0 ? `${played} match${played === 1 ? "" : "es"}` : "No matches yet"}
                {s.status === "live" ? " · in progress" : ""}
                {!s.rated ? " · unrated" : ""}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
