import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import Link from "next/link";
import LocalDateTime from "@/components/LocalDateTime";
import { logoutAction } from "@/lib/auth/actions";
import { isAtLeast } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { playerStats, sessions, signups } from "@/lib/db/schema";

/**
 * Sessions stay listed until a few hours after they start, so the page is still
 * useful mid-night rather than going blank the moment play begins.
 *
 * Lives outside the component because reading the clock is impure, and the
 * React Compiler is right to refuse it inside a render.
 */
function listingCutoff(): Date {
  return new Date(Date.now() - 6 * 60 * 60 * 1000);
}

export default async function HomePage() {
  const me = await getCurrentPlayer();

  if (!me) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <h1 className="text-3xl font-bold">PicklePlay</h1>
        <p className="mt-3 text-[var(--muted)]">
          Organize your sessions, auto-build the matchups, and track everyone&apos;s
          rating. No email, no App Store.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link href="/register" className="btn-primary text-center">
            Create an account
          </Link>
          <Link
            href="/login"
            className="w-full rounded-xl border border-[var(--border)] px-4 py-3.5 text-center
              text-base font-semibold"
          >
            Log in
          </Link>
        </div>
      </main>
    );
  }

  const db = getDb();

  const cutoff = listingCutoff();

  const [statsRow, upcoming] = await Promise.all([
    db.select().from(playerStats).where(eq(playerStats.playerId, me.id)).limit(1),
    db
      .select({
        id: sessions.id,
        title: sessions.title,
        location: sessions.location,
        startsAt: sessions.startsAt,
        maxPlayers: sessions.maxPlayers,
        status: sessions.status,
      })
      .from(sessions)
      .where(and(gte(sessions.startsAt, cutoff), ne(sessions.status, "closed")))
      .orderBy(asc(sessions.startsAt))
      .limit(10),
  ]);

  const stats = statsRow[0];
  const ids = upcoming.map((s) => s.id);

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

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <p className="text-sm text-[var(--muted)]">Signed in as</p>
          <h1 className="text-2xl font-bold">{me.displayName ?? me.username}</h1>
        </div>
        {me.role !== "player" ? (
          <span className="rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-semibold uppercase text-[var(--accent)]">
            {ROLE_LABELS[me.role]}
          </span>
        ) : null}
      </header>

      <section className="card">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-[var(--muted)]">Your PicklePlay Rating</p>
          <Link
            href={`/p/${me.username}`}
            className="text-xs font-semibold text-[var(--accent)] underline"
          >
            Your profile
          </Link>
        </div>
        <p className="mt-1 font-mono text-4xl font-bold tabular-nums">
          {stats ? stats.rating.toFixed(3) : "—"}
        </p>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          {stats?.provisional ? (
            <Badge>Provisional</Badge>
          ) : (
            <Badge>{Math.round((stats?.reliability ?? 0) * 100)}% reliable</Badge>
          )}
          {stats?.selfDeclared ? <Badge>Self-declared</Badge> : null}
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
          <Stat label="Matches" value={stats?.localMatches ?? 0} />
          <Stat label="Won" value={stats?.wins ?? 0} />
          <Stat label="Lost" value={stats?.losses ?? 0} />
        </dl>

        {stats && stats.localMatches === 0 ? (
          <p className="hint mt-4">
            That&apos;s your starting number. It moves fastest over your first five games
            here, then settles.
          </p>
        ) : null}
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Upcoming</h2>
          {isAtLeast(me.role, "admin") ? (
            <Link
              href="/sessions/new"
              className="text-sm font-semibold text-[var(--accent)] underline"
            >
              + New session
            </Link>
          ) : null}
        </div>

        {upcoming.length === 0 ? (
          <p className="card text-sm text-[var(--muted)]">
            Nothing scheduled.
            {isAtLeast(me.role, "admin") ? " Create one to get the group going." : ""}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((s) => {
              const n = countBy.get(s.id) ?? 0;
              const state = stateBy.get(s.id);
              return (
                <li key={s.id}>
                  <Link href={`/s/${s.id}`} className="card block active:opacity-70">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold">{s.title}</span>
                      {state ? (
                        <span className="shrink-0 text-xs font-semibold text-[var(--accent)]">
                          {state === "in" ? "You're in" : "Waitlist"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      <LocalDateTime iso={s.startsAt.toISOString()} />
                      {s.location ? ` · ${s.location}` : ""}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {n}/{s.maxPlayers} in
                      {s.status === "live" ? " · in progress" : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Link
        href="/leaderboard"
        className="mt-6 block w-full rounded-xl border border-[var(--border)] px-4 py-3.5
          text-center text-base font-semibold"
      >
        Leaderboard
      </Link>

      {isAtLeast(me.role, "admin") ? (
        <Link
          href="/admin"
          className="mt-5 block w-full rounded-xl border border-[var(--border)] px-4 py-3.5
            text-center text-base font-semibold"
        >
          Admin — invite code &amp; players
        </Link>
      ) : null}

      <form action={logoutAction} className="mt-8">
        <button
          type="submit"
          className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-medium
            text-[var(--muted)]"
        >
          Log out
        </button>
      </form>
    </main>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{children}</span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] py-3">
      <dd className="font-mono text-xl font-semibold tabular-nums">{value}</dd>
      <dt className="mt-0.5 text-xs text-[var(--muted)]">{label}</dt>
    </div>
  );
}
