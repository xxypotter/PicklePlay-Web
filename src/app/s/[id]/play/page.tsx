import { and, asc, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { matches, players, rounds, sessions, signups } from "@/lib/db/schema";
import { getAttending } from "@/lib/matchmaking/service";
import { courtLabel, getCurrentRound } from "@/lib/sessions/queries";
import MatchCard from "../MatchCard";
import {
  AttendanceToggle,
  CloseSessionButton,
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

  const [roster, roundRows, pastMatches, attending, round] = await Promise.all([
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
    db
      .select({ id: rounds.id, index: rounds.index })
      .from(rounds)
      .where(eq(rounds.sessionId, id))
      .orderBy(desc(rounds.index)),
    db
      .select({
        id: matches.id,
        roundId: matches.roundId,
        courtNo: matches.courtNo,
        a1: matches.a1,
        a2: matches.a2,
        b1: matches.b1,
        b2: matches.b2,
        scoreA: matches.scoreA,
        scoreB: matches.scoreB,
        status: matches.status,
      })
      .from(matches)
      .where(and(eq(matches.sessionId, id), ne(matches.status, "void")))
      .orderBy(asc(matches.courtNo)),
    getAttending(id),
    getCurrentRound(id, session.courtNames),
  ]);

  const nameOf = new Map(roster.map((r) => [r.playerId, r.username]));
  const attendingCount = attending.length;

  const roundUnplayed = round?.matches.every((m) => !m.completed) ?? false;
  const playingIds = new Set(
    round?.matches.flatMap((m) => [...m.teamA, ...m.teamB].map((p) => p.id)) ?? [],
  );
  const sittingOut = attending.filter((p) => !playingIds.has(p.id));
  const earlierRounds = roundRows.slice(1);

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

        <GenerateRoundButton
          sessionId={id}
          attendingCount={attendingCount}
          hasOpenRound={roundRows.length > 0}
        />
        <p className="hint">
          Court{session.courtNames.length === 1 ? "" : "s"} {session.courtNames.join(", ")} ·
          seats {session.courtNames.length * 4}
          {attendingCount > session.courtNames.length * 4
            ? ` · ${attendingCount - session.courtNames.length * 4} sit out each round`
            : ""}
        </p>
      </section>

      {round ? (
        <section className="mt-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Round {round.index}</h2>
            {roundUnplayed ? <DiscardRoundButton sessionId={id} roundId={round.id} /> : null}
          </div>

          <div className="flex flex-col gap-3">
            {round.matches.map((m) => (
              <MatchCard key={m.id} match={m} meId={me.id} canEnterScore canVoid />
            ))}
          </div>

          {sittingOut.length > 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Sitting out: {sittingOut.map((p) => p.username).join(", ")}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          No rounds yet. Confirm who&apos;s here, then generate round 1.
        </p>
      )}

      {earlierRounds.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">Earlier rounds</h2>
          <div className="flex flex-col gap-3">
            {earlierRounds.map((r) => (
              <div key={r.id} className="card">
                <h3 className="text-sm font-semibold text-[var(--muted)]">Round {r.index}</h3>
                <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                  {pastMatches
                    .filter((m) => m.roundId === r.id)
                    .map((m) => (
                      <li key={m.id} className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate">
                          <span className="text-[var(--muted)]">
                            {courtLabel(session.courtNames, m.courtNo)}:{" "}
                          </span>
                          {[m.a1, m.a2].map((p) => nameOf.get(p) ?? "?").join(" & ")} v{" "}
                          {[m.b1, m.b2].map((p) => nameOf.get(p) ?? "?").join(" & ")}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums">
                          {m.status === "completed" ? `${m.scoreA}–${m.scoreB}` : "—"}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {session.status !== "closed" ? <CloseSessionButton sessionId={id} /> : null}
    </main>
  );
}
