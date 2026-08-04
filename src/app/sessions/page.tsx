import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import TopBar from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { matches, sessions, signups } from "@/lib/db/schema";
import { closeStaleSessions } from "@/lib/sessions/auto-close";

export const metadata = { title: "Sessions · PicklePlay" };

export default async function SessionsPage() {
  const me = await getCurrentPlayer();
  if (!me) redirect("/login");

  const db = getDb();
  await closeStaleSessions();

  const all = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      location: sessions.location,
      startsAt: sessions.startsAt,
      status: sessions.status,
      rated: sessions.rated,
    })
    .from(sessions)
    .orderBy(desc(sessions.startsAt))
    .limit(80);

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

  /*
   * Yours first, then everyone else's.
   *
   * This page is reached from "My sessions", so a flat list of every session in
   * the group buried the two or three that are actually yours. Each session
   * appears once — your past nights aren't repeated in the archive below.
   */
  const mineUpcoming = all
    .filter((s) => s.status !== "closed" && mineBy.has(s.id))
    .reverse(); // soonest first
  const minePast = all.filter((s) => s.status === "closed" && mineBy.has(s.id));
  const otherPast = all.filter((s) => s.status === "closed" && !mineBy.has(s.id));
  const otherUpcoming = all.filter((s) => s.status !== "closed" && !mineBy.has(s.id)).length;

  return (
    <>
      <TopBar title="My sessions" back="/me" />
      <main className="screen pt-4">
        <Group title="Upcoming & in progress" rows={mineUpcoming} matchesBy={matchesBy} mine>
          {otherUpcoming > 0 ? (
            <p className="card text-sm text-[var(--muted)]">
              You&apos;re not in any upcoming session.{" "}
              <Link href="/" className="font-medium text-[var(--accent)] underline">
                {otherUpcoming} open on Home
              </Link>
              .
            </p>
          ) : (
            <p className="card text-sm text-[var(--muted)]">Nothing scheduled.</p>
          )}
        </Group>

        <Group title="My past sessions" rows={minePast} matchesBy={matchesBy} mine>
          <p className="card text-sm text-[var(--muted)]">
            None yet. Sessions you played land here once they finish.
          </p>
        </Group>

        <Group title="Other past sessions" rows={otherPast} matchesBy={matchesBy}>
          <p className="card text-sm text-[var(--muted)]">Nothing else in the archive.</p>
        </Group>
      </main>
    </>
  );
}

interface Row {
  id: string;
  title: string;
  location: string | null;
  startsAt: Date;
  status: string;
  rated: boolean;
}

function Group({
  title,
  rows,
  matchesBy,
  mine = false,
  children,
}: {
  title: string;
  rows: Row[];
  matchesBy: Map<string | null, number>;
  mine?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 px-1 text-sm text-[var(--muted)]">
        {title}
        {rows.length > 0 ? ` (${rows.length})` : ""}
      </h2>

      {rows.length === 0 ? (
        children
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((s) => {
            const played = matchesBy.get(s.id) ?? 0;
            return (
              <li key={s.id}>
                <Link href={`/s/${s.id}`} className="card block active:opacity-70">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold">{s.title}</span>
                    {mine ? (
                      <span className="shrink-0 text-xs font-semibold text-[var(--accent)]">
                        {s.status === "closed" ? "Played" : "You're in"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    <LocalDateTime iso={s.startsAt.toISOString()} />
                    {s.location ? ` · ${s.location}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {played > 0 ? `${played} match${played === 1 ? "" : "es"}` : "No matches"}
                    {s.status === "live" ? " · in progress" : ""}
                    {!s.rated ? " · casual" : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
