import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats, sessions, signups } from "@/lib/db/schema";
import { getAllRounds, getSessionStandings } from "@/lib/sessions/queries";
import MatchCard from "./MatchCard";
import RsvpButtons, { type MyState } from "./RsvpButtons";
import ShareLink from "./ShareLink";
import Standings from "./Standings";
import { DeleteSessionButton } from "./play/PlayControls";

export const metadata = { title: "Session · PicklePlay" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const found = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const session = found[0];
  if (!session) notFound();

  const [me, roster, allRounds, standings, headerList] = await Promise.all([
    getCurrentPlayer(),
    db
      .select({
        playerId: signups.playerId,
        username: players.username,
        state: signups.state,
        waitlistPos: signups.waitlistPos,
        attended: signups.attended,
        addedByOrganizer: signups.addedByOrganizer,
        rating: playerStats.rating,
        provisional: playerStats.provisional,
      })
      .from(signups)
      .innerJoin(players, eq(players.id, signups.playerId))
      .leftJoin(playerStats, eq(playerStats.playerId, signups.playerId))
      .where(eq(signups.sessionId, id))
      .orderBy(asc(signups.createdAt)),
    getAllRounds(id, session.courtNames),
    getSessionStandings(id),
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
  // Mirrors deleteSessionAction: your own sessions, or anything if super admin.
  const canDelete =
    !!me && (me.role === "superadmin" || (isAdmin && session.createdBy === me.id));
  const spotsLeft = Math.max(0, session.maxPlayers - confirmed.length);

  const isMine = (m: { teamA: { id: string }[]; teamB: { id: string }[] }) =>
    !!me && [...m.teamA, ...m.teamB].some((p) => p.id === me.id);

  // Every match this player has in the whole schedule, so they can see what's
  // coming as well as what's on right now.
  const myMatches = allRounds
    .map((r) => ({ round: r.index, match: r.matches.find(isMine) }))
    .filter((x): x is { round: number; match: NonNullable<typeof x.match> } => !!x.match);

  const nextUnplayed = myMatches.find((x) => !x.match.completed) ?? myMatches[myMatches.length - 1];

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="truncate text-2xl font-bold">{session.title}</h1>
        <Link href="/" className="shrink-0 text-sm font-medium text-[var(--accent)] underline">
          Home
        </Link>
      </div>

      {/* Your next court is the only thing anyone is looking for mid-session. */}
      {nextUnplayed ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-[var(--accent)]">
            {nextUnplayed.match.completed ? "Your last match" : "Your match"} · Round{" "}
            {nextUnplayed.round}
          </h2>
          <MatchCard match={nextUnplayed.match} meId={me!.id} canEnterScore highlight />
        </section>
      ) : null}

      {myMatches.length > 1 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">
            All your matches ({myMatches.length})
          </h2>
          <ul className="card flex flex-col gap-2 text-sm">
            {myMatches.map(({ round, match }) => {
              const onA = match.teamA.some((p) => p.id === me!.id);
              const partner = (onA ? match.teamA : match.teamB).find((p) => p.id !== me!.id);
              const opponents = onA ? match.teamB : match.teamA;
              const mineScore = onA ? match.scoreA : match.scoreB;
              const theirScore = onA ? match.scoreB : match.scoreA;
              return (
                <li key={match.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    <span className="text-[var(--muted)]">R{round} · {match.courtLabel}: </span>
                    with {partner?.username ?? "?"} v{" "}
                    {opponents.map((o) => o.username).join(" & ")}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {match.completed ? `${mineScore}–${theirScore}` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {allRounds.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">
            Full schedule ({allRounds.length} round{allRounds.length === 1 ? "" : "s"})
          </h2>
          <div className="flex flex-col gap-3">
            {allRounds.map((r) => (
              <div key={r.id} className="card">
                <h3 className="text-sm font-semibold text-[var(--muted)]">Round {r.index}</h3>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {r.matches.map((m) => (
                    <li
                      key={m.id}
                      className={`flex items-baseline justify-between gap-2 ${
                        isMine(m) ? "font-semibold" : ""
                      }`}
                    >
                      <span className="min-w-0 truncate">
                        <span className="text-[var(--muted)]">{m.courtLabel}: </span>
                        {m.teamA.map((p) => p.username).join(" & ")} v{" "}
                        {m.teamB.map((p) => p.username).join(" & ")}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {m.completed ? `${m.scoreA}–${m.scoreB}` : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Standings rows={standings} meId={me?.id} />

      {isAdmin ? (
        <Link
          href={`/s/${id}/play`}
          className="mt-6 block rounded-xl bg-[var(--accent)] px-4 py-3.5 text-center text-base
            font-semibold text-[var(--accent-fg)]"
        >
          {session.status === "closed" ? "Manage session" : "Run the session"}
        </Link>
      ) : null}

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
              <RsvpButtons
                sessionId={id}
                state={myState}
                full={spotsLeft === 0}
                addedByOrganizer={mine?.addedByOrganizer ?? false}
              />
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

      {/*
        Deleting a finished session is the most likely reason an admin comes
        back to an old page, so it lives here rather than only inside the play
        console. Authorization is enforced in the action regardless.
      */}
      {canDelete ? <DeleteSessionButton sessionId={id} /> : null}
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
