import { asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import RatingChart from "@/components/RatingChart";
import ReliabilityRing from "@/components/ReliabilityRing";
import TopBar, { safeFrom } from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { matches, players, playerStats, ratingEvents, ratingSeeds } from "@/lib/db/schema";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { getT } from "@/lib/i18n/server";
import { RESEED_COOLDOWN_DAYS } from "@/lib/rating/constants";
import ReseedCard from "./ReseedCard";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("player.title");

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

  const t = await getT(me?.locale);
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
            <p className="text-sm font-medium text-[var(--muted)]">{t("common.rating")}</p>
            <p className="mt-1 font-mono text-4xl font-bold tabular-nums">
              {stats ? stats.rating.toFixed(3) : "—"}
              {stats?.provisional ? (
                <span className="text-2xl text-[var(--muted)]">?</span>
              ) : null}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-medium text-[var(--muted)]">{t("rating.peak")}</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--muted)]">
              {stats ? stats.peakRating.toFixed(3) : "—"}
            </p>
          </div>
        </div>

        {/* Role only. The rest of what used to be badged is explained below. */}
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          <Badge>{t(`role.${player.role}` as DictKey)}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-4 items-end gap-2 text-center">
          <div className="flex flex-col items-center gap-1">
            <ReliabilityRing value={stats?.reliability ?? 0} size={48} locale={me?.locale} />
            <dt className="text-[11px] text-[var(--muted)]">{t("common.reliability")}</dt>
          </div>
          <Stat label={t("common.played")} value={careerMatches} />
          <Stat label={t("common.won")} value={careerWins} />
          <Stat
            label={t("common.winRate")}
            value={careerRate === null ? t("common.none") : `${careerRate}%`}
          />
        </dl>

        <div className="mt-4">
          <RatingChart points={chartPoints} locale={me?.locale} />
        </div>

        {/*
          Everything that needs a sentence lives here rather than on Me, which
          is the glanceable screen. The win-rate caveat matters most: people
          read the two numbers as if one should follow the other.
        */}
        <div className="mt-4 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          {stats?.provisional ? (
            <p className="hint">
              {t("rating.provisional", {
                who: t(isMe ? "rating.whoYouHave" : "rating.whoTheyHave"),
              })}
            </p>
          ) : stats ? (
            <p className="hint">{t("rating.reliable")}</p>
          ) : null}

          {player.importedMatches > 0 ? (
            <p className="hint">
              {t("rating.importedNote", {
                imported: player.importedMatches,
                wins: player.importedWins,
                here: stats?.localMatches ?? 0,
              })}
            </p>
          ) : null}

          {/*
            Reliability needs saying in words somewhere, and this is the screen
            that owns it. The ring alone reads as a fourth performance stat, and
            a low one reads as a weak player — which is the opposite of true.
          */}
          <p className="hint">
            {t("rating.reliabilityExplained", {
              who: t(isMe ? "rating.whoYouAre" : "rating.whoTheyAre"),
            })}
          </p>

          <p className="hint">{t("rating.winRateCaveat")}</p>

          {stats && stats.localMatches > 0 ? (
            <p className="hint">
              {stats.streak > 0
                ? t("rating.streakWin", { count: stats.streak })
                : stats.streak < 0
                  ? t("rating.streakLoss", { count: -stats.streak })
                  : ""}{" "}
              {t("rating.pointDiff", {
                diff: `${stats.pointsFor - stats.pointsAgainst >= 0 ? "+" : ""}${
                  stats.pointsFor - stats.pointsAgainst
                }`,
              })}
            </p>
          ) : null}
        </div>
      </section>

      {/*
        A short account of the method, on the screen that shows the number.
        People ask how it works, and a rating nobody can explain is one nobody
        trusts — particularly one that can fall after a win.
      */}
      <section className="card mt-5">
        <h2 className="text-sm font-medium text-[var(--muted)]">{t("rating.howTitle")}</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {(
            [
              "rating.howScore",
              "rating.howReliability",
              "rating.howVolume",
              "rating.howCalibrated",
            ] as const
          ).map((key) => (
            <li key={key} className="flex gap-2 text-sm text-[var(--muted)]">
              <span className="shrink-0 text-[var(--accent)]">•</span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </section>

      {history.length > 0 ? (
        <section className="card mt-5">
          <h2 className="text-sm font-medium text-[var(--muted)]">{t("rating.whoTheyPlay")}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-center">
            <Stat
              label={t("rating.avgPartner")}
              value={avgPartner === null ? t("common.none") : avgPartner.toFixed(3)}
              mono
            />
            <Stat
              label={t("rating.avgOpponent")}
              value={avgOpponent === null ? t("common.none") : avgOpponent.toFixed(3)}
              mono
            />
          </dl>
          {avgOpponent !== null && stats ? (
            <p className="hint mt-3">
              {avgOpponent > stats.rating + 0.05
                ? t("rating.playingUp")
                : avgOpponent < stats.rating - 0.05
                  ? t("rating.playingDown")
                  : t("rating.wellMatched")}
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
          {isMe
            ? t("rating.recordLink")
            : t("rating.recordLinkOther", { name: player.username })}
        </span>
        <span className="text-sm text-[var(--muted)]">
          {t.plural("rating.matchCount", history.length, { count: history.length })}
        </span>
        <span className="text-[var(--muted)]">›</span>
      </Link>

      {seeds.length > 0 ? (
        <section className="card mt-5">
          <h2 className="text-sm font-medium text-[var(--muted)]">{t("rating.history")}</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {seeds.map((s, i) => (
              <li key={i} className="py-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span>
                    {s.source === "admin"
                      ? t("rating.seedAdmin")
                      : i === seeds.length - 1
                        ? t("rating.startingRating")
                        : t("rating.seedDupr")}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {s.rating.toFixed(3)}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  <LocalDateTime iso={s.effectiveAt.toISOString()} withWeekday={false} /> ·{" "}
                  {t("rating.declaredReliable", {
                    percent: Math.round(s.declaredReliability),
                  })}
                  {s.note ? t("rating.seedNote", { note: s.note }) : ""}
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
