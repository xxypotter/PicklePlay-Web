import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import TopBar, { safeFrom } from "@/components/TopBar";
import { canOrganizeSession } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, sessions, signups } from "@/lib/db/schema";
import { getAttending } from "@/lib/matchmaking/service";
import { sortByUsername } from "@/lib/players/sort";
import { getT } from "@/lib/i18n/server";
import { getAllRounds, getSessionStandings } from "@/lib/sessions/queries";
import MatchCard from "../MatchCard";
import Standings from "../Standings";
import {
  AddPlayers,
  AttendanceToggle,
  PartnerPicker,
  DeleteSessionButton,
  DiscardRoundButton,
  EndSessionButton,
  GenerateRoundButton,
  ReopenSessionButton,
  StartSessionButton,
} from "./PlayControls";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("play.title");

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  const me = await getCurrentPlayer();
  if (!me) notFound();

  const t = await getT(me.locale);
  const db = getDb();
  const found = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  const session = found[0];
  if (!session) notFound();

  // Another organizer's console is not yours to open, whatever your role.
  // Ownership can only be judged once the session is loaded, so this check
  // comes after the lookup rather than before it.
  if (!canOrganizeSession(me, session)) notFound();

  const [rosterRows, allRounds, standings, attending] = await Promise.all([
    db
      .select({
        playerId: signups.playerId,
        username: players.username,
        attended: signups.attended,
        partnerId: signups.partnerId,
      })
      .from(signups)
      .innerJoin(players, eq(players.id, signups.playerId))
      .where(and(eq(signups.sessionId, id), eq(signups.state, "in"))),
    getAllRounds(id, session.courtNames, me.locale),
    getSessionStandings(id),
    getAttending(id),
  ]);

  const roster = sortByUsername(rosterRows);

  const signedUpIds = new Set(roster.map((r) => r.playerId));
  const notSignedUp = sortByUsername(
    (
      await db
        .select({ id: players.id, username: players.username })
        .from(players)
        .where(eq(players.active, true))
    ).filter((p) => !signedUpIds.has(p.id)),
  );

  // Keep the chain intact: an admin who arrived from My sessions should walk
  // back out the same way rather than being dumped on the session page.
  const backTo = safeFrom(from, `/s/${id}`);
  const here = from ? `/s/${id}/play?from=${encodeURIComponent(backTo)}` : `/s/${id}/play`;

  const attendingCount = attending.length;
  const unscored = allRounds
    .flatMap((r) => r.matches)
    .filter((m) => !m.completed).length;

  return (
    <>
      <TopBar
        title={t("play.title")}
        back={backTo}
        action={
          <Link
            href={`/s/${id}?from=${encodeURIComponent(here)}`}
            className="text-sm text-[var(--link)]"
          >
            {t("play.playerView")}
          </Link>
        }
      />
      <main className="screen pt-4">
      <section className="card">
        <h2 className="text-sm font-medium text-[var(--muted)]">
          {t("play.whosHere", { here: attendingCount, total: roster.length })}
        </h2>
        <p className="hint">{t("play.whosHereHint")}</p>
        {/* Say what marking someone out now buys you, or nobody will find it. */}
        <p className="hint">{t("play.outFreesPlace")}</p>
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
      </section>

      {session.format === "fixed" ? (
        <PartnerPicker
          sessionId={id}
          players={roster.filter((r) => r.attended)}
          locked={session.status !== "open"}
        />
      ) : null}

      <section className="card mt-3">

        {/*
          Three phases, not two. Testing "is it open?" put closed sessions down
          the same branch as live ones, so a finished night still offered to
          build matches — and the server, correctly, refused with "Start the
          session before creating matches", which is a baffling thing to be told
          about a session that already happened.

          A session can close on its own (24h after its start time), so this is
          reachable without anyone pressing anything.
        */}
        {session.status === "open" ? (
          <>
            <StartSessionButton sessionId={id} attendingCount={attendingCount} />
            <Link
              href={`/s/${id}/edit?from=${encodeURIComponent(here)}`}
              className="btn-ghost mt-2 block text-center text-sm"
            >
              {t("play.editDetails")}
            </Link>
          </>
        ) : session.status === "live" ? (
          <>
            <GenerateRoundButton
              sessionId={id}
              attendingCount={attendingCount}
              courtCount={session.courtNames.length}
              roundsSoFar={allRounds.length}
              format={session.format}
            />
            {allRounds.length === 0 ? <ReopenSessionButton sessionId={id} /> : null}
          </>
        ) : (
          <p className="hint mt-4">{t("play.closedNote")}</p>
        )}

        <p className="hint">
          {t("play.seats", {
            names: session.courtNames.join(", "),
            seats: session.courtNames.length * 4,
          })}
          {attendingCount > session.courtNames.length * 4
            ? t("play.sitOut", {
                count: attendingCount - session.courtNames.length * 4,
              })
            : ""}
        </p>
      </section>

      {allRounds.length === 0 ? (
        <p className="mt-6 text-center text-sm text-[var(--muted)]">
          {t("play.noMatchesYet")}
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
                  <h2 className="text-lg font-semibold">
                    {t("play.roundHeading", { index: round.index })}
                  </h2>
                  {unplayed && round.index === allRounds.length ? (
                    <DiscardRoundButton sessionId={id} roundId={round.id} />
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  {round.matches.map((m) => (
                    <MatchCard key={m.id} match={m} meId={me.id} canVoid />
                  ))}
                </div>

                {sittingOut.length > 0 ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {t("schedule.sittingOut", {
                      names: sittingOut.map((p) => p.username).join(", "),
                    })}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      )}

      <Standings rows={standings} meId={me.id} backHere={here} locale={me.locale} />

      {session.status === "live" ? (
        <EndSessionButton sessionId={id} unscored={unscored} />
      ) : null}
      <DeleteSessionButton sessionId={id} />
      </main>
    </>
  );
}
