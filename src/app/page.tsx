import { eq } from "drizzle-orm";
import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { playerStats } from "@/lib/db/schema";

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

  const stats = (
    await getDb().select().from(playerStats).where(eq(playerStats.playerId, me.id)).limit(1)
  )[0];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <p className="text-sm text-[var(--muted)]">Signed in as</p>
          <h1 className="text-2xl font-bold">{me.displayName ?? me.username}</h1>
        </div>
        {me.role !== "player" ? (
          <span className="rounded-full bg-[var(--accent)]/10 px-3 py-1 text-xs font-semibold uppercase text-[var(--accent)]">
            {me.role}
          </span>
        ) : null}
      </header>

      <section className="card">
        <p className="text-sm font-medium text-[var(--muted)]">Your PicklePlay Rating</p>
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

      {me.role === "admin" ? (
        <Link
          href="/admin"
          className="mt-5 block w-full rounded-xl border border-[var(--border)] px-4 py-3.5
            text-center text-base font-semibold"
        >
          Admin — invite code &amp; players
        </Link>
      ) : null}

      <p className="mt-6 text-sm text-[var(--muted)]">
        Sessions, matchups, and the leaderboard land next.
      </p>

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
