import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, sessions, signups } from "@/lib/db/schema";
import { getAttending } from "@/lib/matchmaking/service";
import { getAllRounds, getSessionStandings } from "@/lib/sessions/queries";
import MatchCard from "../MatchCard";
import Standings from "../Standings";
import {
  AddPlayers,
  AttendanceToggle,
  CloseSessionButton,
  DeleteSessionButton,
  DiscardRoundButton,
  GenerateRoundButton,
} from "./PlayControls";

export const metadata = { title: "Run session · PicklePlay" };

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const me = await getCurrentPlayer();
  if (!me || !canManageSessions(me.role)) notFound();

  const db = getDb();
  const found = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const session = found[0];
  if (!session) notFound();

  const [roster, allRounds, standings, attending] = await Promise.all([
    db
      .select({
        playerId: signups.playerId,
        username: players.username,
        attended: signups.attended,
      })
      .from(signups)
      .innerJoin(players, eq(players.id, signups.playerId))
      .where(and(eq(signups.sessionId, id), eq(signups.state, "in")))
      .orderBy(asc(players.username)),
    getAllRounds(id, session.courtNames),
    getSessionStandings(id),
    getAttending(id),
  ]);

  const signedUpIds = new Set(roster.map((r) => r.playerId));
  const notSignedUp = (
    await db
      .select({ id: players.id, username: players.username })
      .from(players)
      .where(eq(players.active, true))
      .orderBy(asc(players.username))
  ).filter((p) => !signedUpIds.has(p.id));

  const attendingCount = attending.length;
  const canDelete = me.role === "superadmin" || session.createdBy === me.id;

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="truncate text-2xl font-bold">{session.title}</h1>
        <Link href={`/s/${id}`} className="shrink-0 text-sm font-medium text-[var(--accent)] underline">
          Player view
        </Link>
      </div>

      <section className="card">
        <h2 className="text-sm font-medium text-[var(--muted)]">
          Who&apos;s here ({attendingCount}/{roster.length})
        </h2>
        <p className="hint">Tap anyone who didn&apos;t show up.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {roster.map((r) => (
            <AttendanceToggle
              key={r.playerId}
              sessionId={id}
              playerId={r.playerId}
              username={r.username}
              attended={r.attended}
            />
          ))}
        </div>

        <AddPlayers sessionId={id} candidates={notSignedUp} />

        <GenerateRoundButton
          sessionId={id}
          attendingCount={attendingCount}
          courtCount={session.courtNames.length}
          roundsSoFar={allRounds.length}
        />
        <p className="hint">
          Court{session.courtNames.length === 1 ? "" : "s"} {session.courtNames.join(", ")} ·
          seats {session.courtNames.length * 4}
          {attendingCount > session.courtNames.length * 4
            ? ` · ${attendingCount - session.courtNames.length * 4} sit out each round`
            : ""}
        </p>
      </section>

      {allRounds.length === 0 ? (
        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          No matches yet. Confirm who&apos;s here, then create them all at once.
        </p>
      ) : (
        <section className="mt-6 flex flex-col gap-6">
          {/* Round 1 first: the schedule reads in the order it's played. */}
          {allRounds.map((round) => {
            const playingIds = new Set(
              round.matches.flatMap((m) => [...m.teamA, ...m.teamB].map((p) => p.id)),
            );
            const sittingOut = attending.filter((p) => !playingIds.has(p.id));
            const unplayed = round.matches.every((m) => !m.completed);

            return (
              <div key={round.id}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-lg font-semibold">Round {round.index}</h2>
                  {unplayed && round.index === allRounds.length ? (
                    <DiscardRoundButton sessionId={id} roundId={round.id} />
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  {round.matches.map((m) => (
                    <MatchCard key={m.id} match={m} meId={me.id} canEnterScore canVoid />
                  ))}
                </div>

                {sittingOut.length > 0 ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Sitting out: {sittingOut.map((p) => p.username).join(", ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      )}

      <Standings rows={standings} meId={me.id} />

      {session.status !== "closed" ? <CloseSessionButton sessionId={id} /> : null}
      {canDelete ? <DeleteSessionButton sessionId={id} /> : null}
    </main>
  );
}
