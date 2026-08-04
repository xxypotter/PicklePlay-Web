import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats, sessions, signups } from "@/lib/db/schema";
import { getCurrentRound } from "@/lib/sessions/queries";
import MatchCard from "./MatchCard";
import RsvpButtons, { type MyState } from "./RsvpButtons";
import ShareLink from "./ShareLink";

export const metadata = { title: "Session · PicklePlay" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const found = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const session = found[0];
  if (!session) notFound();

  const [me, roster, round, headerList] = await Promise.all([
    getCurrentPlayer(),
    db
      .select({
        playerId: signups.playerId,
        username: players.username,
        state: signups.state,
        waitlistPos: signups.waitlistPos,
        attended: signups.attended,
        rating: playerStats.rating,
        provisional: playerStats.provisional,
      })
      .from(signups)
      .innerJoin(players, eq(players.id, signups.playerId))
      .leftJoin(playerStats, eq(playerStats.playerId, signups.playerId))
      .where(eq(signups.sessionId, id))
      .orderBy(asc(signups.createdAt)),
    getCurrentRound(id, session.courtNames),
    headers(),
  ]);

  const confirmed = roster.filter((r) => r.state === "in");
  const waiting = roster.filter((r) => r.state === "waitlist");
  const mine = me ? roster.find((r) => r.playerId === me.id) : undefined;
  const myState: MyState = (mine?.state as MyState) ?? "out";

  const host = headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  const isAdmin = !!me && canManageSessions(me.role);
  const spotsLeft = Math.max(0, session.maxPlayers - confirmed.length);

  const myMatch = me
    ? round?.matches.find((m) =>
        [...m.teamA, ...m.teamB].some((p) => p.id === me.id),
      )
    : undefined;

  const otherMatches = round?.matches.filter((m) => m.id !== myMatch?.id) ?? [];

  const playingIds = new Set(round?.matches.flatMap((m) => [...m.teamA, ...m.teamB].map((p) => p.id)) ?? []);
  const sittingOut = round
    ? confirmed.filter((r) => r.attended && !playingIds.has(r.playerId))
    : [];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="truncate text-2xl font-bold">{session.title}</h1>
        <Link href="/" className="shrink-0 text-sm font-medium text-[var(--accent)] underline">
          Home
        </Link>
      </div>

      {/* During play, your own court is the only thing you're looking for. */}
      {myMatch ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-[var(--accent)]">
            Your match · Round {round!.index}
          </h2>
          <MatchCard match={myMatch} meId={me!.id} canEnterScore highlight />
        </section>
      ) : null}

      {round && !myMatch && sittingOut.some((s) => s.playerId === me?.id) ? (
        <p className="card mb-6 text-center text-sm">
          You&apos;re sitting out round {round.index}. You&apos;re up next.
        </p>
      ) : null}

      {round && otherMatches.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">
            {myMatch ? "Other courts" : `Round ${round.index}`}
          </h2>
          <div className="flex flex-col gap-3">
            {otherMatches.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                meId={me?.id}
                canEnterScore={isAdmin && !myMatch}
              />
            ))}
          </div>
          {sittingOut.length > 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              Sitting out: {sittingOut.map((s) => s.username).join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mb-6 flex gap-3">
        <Link
          href="/leaderboard"
          className="flex-1 rounded-xl border border-[var(--border)] px-4 py-3 text-center
            text-sm font-semibold"
        >
          Rankings
        </Link>
        {isAdmin ? (
          <Link
            href={`/s/${id}/play`}
            className="flex-1 rounded-xl bg-[var(--accent)] px-4 py-3 text-center text-sm
              font-semibold text-[var(--accent-fg)]"
          >
            Run the session
          </Link>
        ) : null}
      </div>

      <section className="card">
        <p className="font-semibold">
          <LocalDateTime iso={session.startsAt.toISOString()} />
        </p>
        {session.location ? (
          <p className="mt-1 text-[var(--muted)]">{session.location}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <Badge>
            Court{session.courtNames.length === 1 ? "" : "s"} {session.courtNames.join(", ")}
          </Badge>
          <Badge>
            {confirmed.length}/{session.maxPlayers} in
          </Badge>
          {!session.rated ? <Badge>Unrated</Badge> : null}
          {session.status === "closed" ? <Badge>Closed</Badge> : null}
        </div>

        {session.notes ? (
          <p className="mt-3 whitespace-pre-line text-sm text-[var(--muted)]">{session.notes}</p>
        ) : null}

        <div className="mt-4">
          {me ? (
            session.status === "closed" ? (
              <p className="text-sm text-[var(--muted)]">This session is closed.</p>
            ) : (
              <RsvpButtons sessionId={id} state={myState} full={spotsLeft === 0} />
            )
          ) : (
            <Link href="/login" className="btn-primary block text-center">
              Log in to RSVP
            </Link>
          )}
        </div>

        <div className="mt-3">
          <ShareLink url={`${proto}://${host}/s/${id}`} title={session.title} />
        </div>
      </section>

      <Roster
        title={`Playing (${confirmed.length})`}
        rows={confirmed}
        empty="Nobody yet — be first."
      />

      {waiting.length > 0 ? (
        <Roster title={`Waitlist (${waiting.length})`} rows={waiting} empty="" showPosition />
      ) : null}
    </main>
  );
}

interface Row {
  playerId: string;
  username: string;
  waitlistPos: number | null;
  rating: number | null;
  provisional: boolean | null;
}

function Roster({
  title,
  rows,
  empty,
  showPosition = false,
}: {
  title: string;
  rows: Row[];
  empty: string;
  showPosition?: boolean;
}) {
  return (
    <section className="card mt-5">
      <h2 className="text-sm font-medium text-[var(--muted)]">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <li key={r.playerId} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 items-baseline gap-2">
                {showPosition ? (
                  <span className="w-5 shrink-0 text-sm text-[var(--muted)] tabular-nums">
                    {r.waitlistPos}.
                  </span>
                ) : null}
                <Link href={`/p/${r.username}`} className="truncate font-medium">
                  {r.username}
                </Link>
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums text-[var(--muted)]">
                {r.rating === null ? "—" : r.rating.toFixed(3)}
                {r.provisional ? "?" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{children}</span>
  );
}
