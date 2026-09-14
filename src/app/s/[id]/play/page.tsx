import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import LiveRefresh from "@/components/LiveRefresh";
import TopBar, { safeFrom } from "@/components/TopBar";
import { canOrganizeSession, canVoidMatch } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, sessions, signups } from "@/lib/db/schema";
import { getAttending } from "@/lib/matchmaking/service";
import { sortByUsername } from "@/lib/players/sort";
import { getT } from "@/lib/i18n/server";
import { getAllRounds, getSessionStandings } from "@/lib/sessions/queries";
import { teamStandings, type PlayedMatch } from "@/lib/sessions/medal";
import { bracketFrom, teamRowsFrom } from "@/lib/sessions/team-view";
import ManualRound, { type ManualPlayer } from "./ManualRound";
import MedalRoundCustom, { type MedalTeam } from "./MedalRoundCustom";
import MedalBracket from "../MedalBracket";
import TeamStandings from "../TeamStandings";
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
  MedalRoundButton,
  RebuildMatchupsButton,
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
  // A voided match isn't waiting for a score; it has been taken out.
  const unscored = allRounds
    .flatMap((r) => r.matches)
    .filter((m) => !m.completed && !m.voided).length;

  /*
   * A round is settled once anything has happened in it. Rebuilding keeps those
   * and replaces the rest, so this is what the organizer is told will survive.
   */
  const playedRounds = allRounds.filter((r) =>
    r.matches.some((m) => m.completed || m.voided),
  ).length;

  // Where the bracket has got to. Only fixed-partner nights have one.
  const semis = allRounds.find((r) => r.stage === "semifinal");
  const medalStage = allRounds.some((r) => r.stage === "final")
    ? "done"
    : semis
      ? "final"
      : "semifinal";
  const medalReady =
    medalStage === "final"
      ? !!semis && semis.matches.every((m) => m.completed)
      : allRounds.length > 0 && unscored === 0;

  // Pairs among the people actually here — the bracket needs four of them.
  const teamCount = Math.floor(
    roster.filter((r) => r.attended && r.partnerId).length / 2,
  );

  /*
   * The roster for hand-picking a round, in the order that makes the common
   * case a straight run down the list.
   *
   * The request that prompted this was "let me put the first team against the
   * second", so the ordering is the feature as much as the builder is: sorted
   * by standing, with a fixed-partner night sorted by *team* standing and
   * partners kept adjacent. Alphabetical would make the same job a hunt.
   */
  const avatarRows = attending.length
    ? await db
        .select({ id: players.id, avatar: players.avatar })
        .from(players)
        .where(inArray(players.id, attending.map((p) => p.id)))
    : [];
  const avatarOf = new Map(avatarRows.map((r) => [r.id, r.avatar]));

  // Games already assigned tonight, voided ones excluded — they were taken out.
  const gamesOf = new Map<string, number>();
  for (const round of allRounds) {
    for (const m of round.matches) {
      if (m.voided) continue;
      for (const p of [...m.teamA, ...m.teamB]) {
        gamesOf.set(p.id, (gamesOf.get(p.id) ?? 0) + 1);
      }
    }
  }

  const playedRobin: PlayedMatch[] = allRounds
    .filter((r) => r.stage === "robin")
    .flatMap((r) => r.matches)
    .filter((m) => m.completed && !m.voided && m.scoreA !== null && m.scoreB !== null)
    .map((m) => ({
      a1: m.teamA[0].id,
      a2: m.teamA[1].id,
      b1: m.teamB[0].id,
      b2: m.teamB[1].id,
      scoreA: m.scoreA as number,
      scoreB: m.scoreB as number,
    }));

  const partnerOf = new Map(roster.map((r) => [r.playerId, r.partnerId]));
  const byTeam = session.format === "fixed" && teamCount >= 2 && playedRobin.length > 0;

  /** Where each attending player sits in the ordering, and the rank to show. */
  const orderOf = new Map<string, { seq: number; rank: number | null }>();

  if (byTeam) {
    // Team standing, partners adjacent, so two consecutive taps are two teams.
    teamStandings(playedRobin).forEach((row, i) => {
      const [x, y] = row.team.split("|");
      orderOf.set(x, { seq: i * 2, rank: i + 1 });
      orderOf.set(y, { seq: i * 2 + 1, rank: i + 1 });
    });
  } else {
    standings.forEach((row, i) => orderOf.set(row.playerId, { seq: i, rank: i + 1 }));
  }

  /*
   * A fixed-partner night is read as teams: the pair is the competitor, and the
   * medal belongs to both halves of it. Built from rounds already loaded, so it
   * costs no extra query.
   */
  const isFixed = session.format === "fixed";
  const deltaOf = new Map(standings.map((r) => [r.playerId, r.ratingDelta]));
  const teamRows = isFixed ? teamRowsFrom(allRounds, deltaOf) : [];
  const bracket = isFixed ? bracketFrom(allRounds) : null;

  const medalTeams: MedalTeam[] = isFixed
    ? teamRows.map((r, i) => ({
        key: r.team,
        players: r.players,
        rank: r.placement ?? i + 1,
      }))
    : [];

  const manualPlayers: ManualPlayer[] = attending
    .map((p) => ({
      id: p.id,
      username: p.username,
      avatar: avatarOf.get(p.id) ?? null,
      games: gamesOf.get(p.id) ?? 0,
      rank: orderOf.get(p.id)?.rank ?? null,
      // Anyone with no result yet goes after everyone who has one. A fixed
      // partner with no games still sits beside their partner.
      seq:
        orderOf.get(p.id)?.seq ??
        (byTeam ? orderOf.get(partnerOf.get(p.id) ?? "")?.seq : undefined) ??
        Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.seq - b.seq || a.username.localeCompare(b.username))
    .map((p): ManualPlayer => ({
      id: p.id,
      username: p.username,
      avatar: p.avatar,
      games: p.games,
      rank: p.rank,
    }));

  return (
    <>
      <LiveRefresh active={session.status === "live"} />
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
        /*
          Editable while the night is live, not only before it starts. Two
          latecomers who want to play as a pair have to be paired *after* the
          session began, and changing a pairing only affects rounds built from
          here on — matches already played store their four players outright.
        */
        <PartnerPicker
          sessionId={id}
          players={roster.filter((r) => r.attended)}
          locked={session.status === "closed"}
        />
      ) : null}

      <section className="card mt-3">

        {/*
          Three phases, not two. Testing "is it open?" put closed sessions down
          the same branch as live ones, so a finished night still offered to
          build matches — and the server, correctly, refused with "Start the
          session before creating matches", which is a baffling thing to be told
          about a session that already happened.

          A session can close on its own (48h after its start time), so this is
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

            {/*
              Only once a schedule exists — before that "Create all matches"
              above already is the rebuild, and offering both would be two
              buttons for one job.
            */}
            {allRounds.length > 0 && medalStage === "semifinal" ? (
              <RebuildMatchupsButton
                sessionId={id}
                attendingCount={attendingCount}
                courtCount={session.courtNames.length}
                playedRounds={playedRounds}
                format={session.format}
              />
            ) : null}

            {/*
              Available whenever the session is live, including before the
              scheduled rounds are finished — the whole point is that the
              organizer may want a particular matchup at any moment.
            */}
            <ManualRound
              sessionId={id}
              courtNames={session.courtNames}
              players={manualPlayers}
              nextRoundIndex={allRounds.length + 1}
              orderedBy={byTeam ? "teams" : standings.length > 0 ? "standings" : "none"}
            />

            {session.format === "fixed" && allRounds.length > 0 ? (
              <>
                <MedalRoundButton
                  sessionId={id}
                  stage={medalStage}
                  ready={medalReady}
                  teamCount={teamCount}
                />
                {/*
                  The same two stages, drawn by hand. Offered only when the
                  automatic one would also be allowed, so the two never disagree
                  about whether the night is ready for a bracket.
                */}
                {medalStage !== "done" && medalReady ? (
                  <MedalRoundCustom
                    sessionId={id}
                    stage={medalStage}
                    teams={medalTeams}
                  />
                ) : null}
              </>
            ) : null}

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
              round.matches
                .filter((m) => !m.voided)
                .flatMap((m) => [...m.teamA, ...m.teamB].map((p) => p.id)),
            );
            const sittingOut = attending.filter((p) => !playingIds.has(p.id));
            const unplayed = round.matches.every((m) => !m.completed);

            return (
              <div key={round.id}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-lg font-semibold">
                    {round.stage === "robin"
                      ? t("play.roundHeading", { index: round.index })
                      : t(`schedule.stage.${round.stage}`)}
                  </h2>
                  {unplayed && round.index === allRounds.length ? (
                    <DiscardRoundButton sessionId={id} roundId={round.id} />
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  {round.matches.map((m) => (
                    <MatchCard key={m.id} match={m} meId={me.id} canVoid={canVoidMatch(me)} />
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

      {bracket ? (
        <MedalBracket bracket={bracket} meId={me.id} locale={me.locale} />
      ) : null}

      {isFixed ? (
        <TeamStandings rows={teamRows} meId={me.id} locale={me.locale} />
      ) : (
        <Standings rows={standings} meId={me.id} backHere={here} locale={me.locale} />
      )}

      {session.status === "live" ? (
        <EndSessionButton sessionId={id} unscored={unscored} />
      ) : null}
      <DeleteSessionButton sessionId={id} />
      </main>
    </>
  );
}
