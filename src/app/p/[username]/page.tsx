import { asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import RatingChart from "@/components/RatingChart";
import ReliabilityRing from "@/components/ReliabilityRing";
import TopBar, { safeFrom } from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { matches, players, playerStats, ratingEvents, ratingSeeds } from "@/lib/db/schema";
import { RESEED_COOLDOWN_DAYS } from "@/lib/rating/constants";
import ReseedCard from "./ReseedCard";

export const metadata = { title: "Player · PicklePlay" };

/**
 * Lives outside the component because reading the clock is impure, and the
 * React Compiler is right to refuse it inside a render.
 */
function reseedDaysRemaining(lastSelfSeedAt: Date | undefined): number {
  if (!lastSelfSeedAt) return 0;
  const days = (Date.now() - lastSelfSeedAt.getTime()) / 86_400_000;
  return Math.max(0, Math.ceil(RESEED_COOLDOWN_DAYS - days));
}

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { username } = await params;
  // Profiles are reachable from Me, the rankings and any session, so the
  // linking page says where back should go. Rankings is the sane default for a
  // link opened cold.
  const { from } = await searchParams;
  const backTo = safeFrom(from, "/leaderboard");
  // Where the record screen should come back to: here, with our own origin
  // preserved so the chain keeps unwinding.
  const backHere =
    backTo === "/leaderboard"
      ? `/p/${decodeURIComponent(username)}`
      : `/p/${decodeURIComponent(username)}?from=${encodeURIComponent(backTo)}`;
  const db = getDb();

  const found = await db
    .select({
      id: players.id,
      username: players.username,
      displayName: players.displayName,
      role: players.role,
      createdAt: players.createdAt,
      importedMatches: players.importedMatches,
      importedWins: players.importedWins,
    })
    .from(players)
    .where(eq(players.usernameLower, decodeURIComponent(username).toLowerCase()))
    .limit(1);

  const player = found[0];
  if (!player) notFound();

  const [me, statsRow, history, seeds] = await Promise.all([
    getCurrentPlayer(),
    db.select().from(playerStats).where(eq(playerStats.playerId, player.id)).limit(1),
    db
      .select({
        matchId: ratingEvents.matchId,
        delta: ratingEvents.delta,
        ratingAfter: ratingEvents.ratingAfter,
        playedAt: matches.playedAt,
        a1: matches.a1,
        a2: matches.a2,
        b1: matches.b1,
        b2: matches.b2,
        scoreA: matches.scoreA,
        scoreB: matches.scoreB,
      })
      .from(ratingEvents)
      .innerJoin(matches, eq(matches.id, ratingEvents.matchId))
      .where(eq(ratingEvents.playerId, player.id))
      .orderBy(asc(matches.playedAt)),
    db
      .select({
        rating: ratingSeeds.rating,
        declaredReliability: ratingSeeds.declaredReliability,
        source: ratingSeeds.source,
        effectiveAt: ratingSeeds.effectiveAt,
        note: ratingSeeds.note,
        createdBy: ratingSeeds.createdBy,
      })
      .from(ratingSeeds)
      .where(eq(ratingSeeds.playerId, player.id))
      .orderBy(desc(ratingSeeds.effectiveAt)),
  ]);

  const stats = statsRow[0];
  const isMe = me?.id === player.id;

  const chartPoints = history.map((h) => h.ratingAfter);
  if (stats && chartPoints.length > 0) chartPoints.unshift(chartPoints[0] - history[0].delta);

  // Who they've actually been playing with and against. Uses each participant's
  // rating *at the time of that match*, not today's — otherwise a partner's
  // later improvement would rewrite the past.
  const matchIds = history.map((h) => h.matchId);
  const allEvents = matchIds.length
    ? await db
        .select({
          matchId: ratingEvents.matchId,
          playerId: ratingEvents.playerId,
          ratingBefore: ratingEvents.ratingBefore,
        })
        .from(ratingEvents)
        .where(inArray(ratingEvents.matchId, matchIds))
    : [];

  const ratingAt = new Map(allEvents.map((e) => [`${e.matchId}:${e.playerId}`, e.ratingBefore]));
  const partnerRatings: number[] = [];
  const opponentRatings: number[] = [];

  for (const h of history) {
    const onA = h.a1 === player.id || h.a2 === player.id;
    const partner = onA ? (h.a1 === player.id ? h.a2 : h.a1) : h.b1 === player.id ? h.b2 : h.b1;
    const opponents = onA ? [h.b1, h.b2] : [h.a1, h.a2];

    const pr = ratingAt.get(`${h.matchId}:${partner}`);
    if (pr !== undefined) partnerRatings.push(pr);
    for (const o of opponents) {
      const or = ratingAt.get(`${h.matchId}:${o}`);
      if (or !== undefined) opponentRatings.push(or);
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const avgPartner = mean(partnerRatings);
  const avgOpponent = mean(opponentRatings);
  // Career = what they brought with them plus what they've done here, matching
  // how the leaderboard and Me both count it.
  const careerMatches =
    player.importedMatches + (stats?.wins ?? 0) + (stats?.losses ?? 0);
  const careerWins = player.importedWins + (stats?.wins ?? 0);
  const careerRate =
    careerMatches > 0 ? Math.round((careerWins / careerMatches) * 100) : null;

  const lastSelfSeed = seeds.find((s) => s.createdBy === player.id);
  const daysUntilAllowed = reseedDaysRemaining(lastSelfSeed?.effectiveAt);

  return (
    <>
      <TopBar title={player.displayName ?? player.username} back={backTo} />
      <main className="screen pt-4">
      <section className="card">
        {/* Current rating leads; the peak it has reached sits beside it. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--muted)]">PicklePlay Rating</p>
            <p className="mt-1 font-mono text-4xl font-bold tabular-nums">
              {stats ? stats.rating.toFixed(3) : "—"}
              {stats?.provisional ? (
                <span className="text-2xl text-[var(--muted)]">?</span>
              ) : null}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-medium text-[var(--muted)]">Career peak</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--muted)]">
              {stats ? stats.peakRating.toFixed(3) : "—"}
            </p>
          </div>
        </div>

        {/* Role only. The rest of what used to be badged is explained below. */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <Badge>{ROLE_LABELS[player.role as Role]}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-4 items-end gap-2 text-center">
          <div className="flex flex-col items-center gap-1">
            <ReliabilityRing value={stats?.reliability ?? 0} size={48} />
            <dt className="text-[11px] text-[var(--muted)]">Reliability</dt>
          </div>
          <Stat label="Played" value={careerMatches} />
          <Stat label="Won" value={careerWins} />
          <Stat label="Win rate" value={careerRate === null ? "—" : `${careerRate}%`} />
        </dl>

        <div className="mt-4">
          <RatingChart points={chartPoints} />
        </div>

        {/*
          Everything that needs a sentence lives here rather than on Me, which
          is the glanceable screen. The win-rate caveat matters most: people
          read the two numbers as if one should follow the other.
        */}
        <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          {stats?.provisional ? (
            <p className="hint">
              The <strong>?</strong> means this rating is still settling — there
              aren&apos;t enough matches here yet for it to be dependable. It
              clears once {isMe ? "you have" : "they have"} played a full session
              or two.
            </p>
          ) : stats ? (
            <p className="hint">
              This rating is <strong>reliable</strong> — enough recent matches
              against enough different people for the number to mean something.
            </p>
          ) : null}

          {player.importedMatches > 0 ? (
            <p className="hint">
              <strong>{player.importedMatches}</strong> of those matches were
              brought in from before PicklePlay, with{" "}
              <strong>{player.importedWins}</strong> won.{" "}
              <strong>{stats?.localMatches ?? 0}</strong> were played here. Only
              the ones played here move the rating.
            </p>
          ) : null}

          {/*
            Reliability needs saying in words somewhere, and this is the screen
            that owns it. The ring alone reads as a fourth performance stat, and
            a low one reads as a weak player — which is the opposite of true.
          */}
          <p className="hint">
            <strong>Reliability</strong> is how well-established the rating is,
            not how good {isMe ? "you are" : "they are"}. It climbs by playing
            different partners and opponents rather than by playing a lot, so
            the fastest way to fill the ring is a mixed session — and a beginner
            who turns up every week is more reliable than a strong player who
            came twice.
          </p>

          <p className="hint">
            Win rate and rating don&apos;t track each other, and they aren&apos;t
            meant to. Imported matches count toward the record but not the
            rating, casual sessions count toward neither, and beating stronger
            opponents moves the rating far more than beating weaker ones — so a
            modest win rate against tough opposition can outrank a high one.
          </p>

          {stats && stats.localMatches > 0 ? (
            <p className="hint">
              {stats.streak > 0
                ? `On a ${stats.streak}-match win streak.`
                : stats.streak < 0
                  ? `Lost the last ${-stats.streak}.`
                  : ""}{" "}
              Point differential {stats.pointsFor - stats.pointsAgainst >= 0 ? "+" : ""}
              {stats.pointsFor - stats.pointsAgainst}.
            </p>
          ) : null}
        </div>
      </section>

      {history.length > 0 ? (
        <section className="card mt-5">
          <h2 className="text-sm font-medium text-[var(--muted)]">Who they play</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
            <Stat
              label="Avg partner"
              value={avgPartner === null ? "—" : avgPartner.toFixed(3)}
              mono
            />
            <Stat
              label="Avg opponent"
              value={avgOpponent === null ? "—" : avgOpponent.toFixed(3)}
              mono
            />
          </dl>
          {avgOpponent !== null && stats ? (
            <p className="hint mt-3">
              {avgOpponent > stats.rating + 0.05
                ? "Playing up — opponents average above your rating, so wins count for more."
                : avgOpponent < stats.rating - 0.05
                  ? "Playing down — opponents average below your rating, so wins move you less."
                  : "Well matched — opponents average about your own level."}
            </p>
          ) : null}
        </section>
      ) : null}

      {isMe && stats ? (
        <ReseedCard currentRating={stats.rating} daysUntilAllowed={daysUntilAllowed} />
      ) : null}

      {/*
        Match history moved to the record screen. Two lists of the same matches,
        one annotated with rating deltas and one not, was the same information
        asking to be read twice.
      */}
      <Link
        href={`/p/${player.username}/record?from=${encodeURIComponent(backHere)}`}
        className="card mt-5 flex items-center gap-3 active:bg-[var(--surface-2)]"
      >
        <span className="text-lg">📈</span>
        <span className="flex-1 font-medium">
          {isMe ? "My record" : `${player.username}'s record`}
        </span>
        <span className="text-sm text-[var(--muted)]">
          {history.length} match{history.length === 1 ? "" : "es"}
        </span>
        <span className="text-[var(--muted)]">›</span>
      </Link>

      {seeds.length > 0 ? (
        <section className="card mt-5">
          <h2 className="text-sm font-medium text-[var(--muted)]">Rating history</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {seeds.map((s, i) => (
              <li key={i} className="py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    {s.source === "admin"
                      ? "Adjusted by an admin"
                      : i === seeds.length - 1
                        ? "Starting rating"
                        : "Updated from DUPR"}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {s.rating.toFixed(3)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  <LocalDateTime iso={s.effectiveAt.toISOString()} withWeekday={false} /> ·{" "}
                  declared {Math.round(s.declaredReliability)}% reliable
                  {s.note ? ` · ${s.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      </main>
    </>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--border)] px-2.5 py-1">{children}</span>
  );
}

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] py-2.5">
      <dd className={`text-lg font-semibold tabular-nums ${mono ? "font-mono text-base" : ""}`}>
        {value}
      </dd>
      <dt className="mt-0.5 text-xs text-[var(--muted)]">{label}</dt>
    </div>
  );
}
