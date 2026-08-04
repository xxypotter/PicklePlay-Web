import { asc, desc, eq, or } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import RatingChart from "@/components/RatingChart";
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
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const db = getDb();

  const found = await db
    .select({
      id: players.id,
      username: players.username,
      displayName: players.displayName,
      role: players.role,
      createdAt: players.createdAt,
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

  // Names for every opponent and partner in one query rather than N.
  const involved = new Set<string>();
  for (const h of history) for (const id of [h.a1, h.a2, h.b1, h.b2]) involved.add(id);

  const nameRows = involved.size
    ? await db
        .select({ id: players.id, username: players.username })
        .from(players)
        .where(or(...[...involved].map((id) => eq(players.id, id))))
    : [];
  const nameOf = new Map(nameRows.map((n) => [n.id, n.username]));

  const chartPoints = history.map((h) => h.ratingAfter);
  if (stats && chartPoints.length > 0) chartPoints.unshift(chartPoints[0] - history[0].delta);

  const lastSelfSeed = seeds.find((s) => s.createdBy === player.id);
  const daysUntilAllowed = reseedDaysRemaining(lastSelfSeed?.effectiveAt);

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="truncate text-2xl font-bold">
          {player.displayName ?? player.username}
        </h1>
        <Link href="/leaderboard" className="shrink-0 text-sm font-medium text-[var(--accent)] underline">
          Leaderboard
        </Link>
      </div>

      <section className="card">
        <p className="text-sm font-medium text-[var(--muted)]">PicklePlay Rating</p>
        <p className="mt-1 font-mono text-4xl font-bold tabular-nums">
          {stats ? stats.rating.toFixed(3) : "—"}
        </p>

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
          {!stats ? (
            <Badge>Not rated yet</Badge>
          ) : stats.provisional ? (
            <Badge>Provisional</Badge>
          ) : (
            <Badge>{Math.round(stats.reliability * 100)}% reliable</Badge>
          )}
          {stats?.selfDeclared ? <Badge>Self-declared</Badge> : null}
          {player.role !== "player" ? <Badge>{ROLE_LABELS[player.role as Role]}</Badge> : null}
        </div>

        <div className="mt-4">
          <RatingChart points={chartPoints} />
        </div>

        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          <Stat label="Played" value={stats?.localMatches ?? 0} />
          <Stat label="Won" value={stats?.wins ?? 0} />
          <Stat label="Lost" value={stats?.losses ?? 0} />
          <Stat
            label="Peak"
            value={stats ? stats.peakRating.toFixed(2) : "—"}
            mono
          />
        </dl>

        {stats && stats.localMatches > 0 ? (
          <p className="hint mt-3">
            {stats.streak > 0
              ? `On a ${stats.streak}-match win streak.`
              : stats.streak < 0
                ? `Lost the last ${-stats.streak}.`
                : ""}{" "}
            Point differential {stats.pointsFor - stats.pointsAgainst >= 0 ? "+" : ""}
            {stats.pointsFor - stats.pointsAgainst}.
          </p>
        ) : null}
      </section>

      {isMe && stats ? (
        <ReseedCard
          currentRating={stats.rating}
          currentReliability={stats.reliability}
          daysUntilAllowed={daysUntilAllowed}
        />
      ) : null}

      <section className="card mt-5">
        <h2 className="text-sm font-medium text-[var(--muted)]">
          Matches ({history.length})
        </h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No matches yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {[...history].reverse().map((h) => {
              const onA = h.a1 === player.id || h.a2 === player.id;
              const partner = onA
                ? h.a1 === player.id
                  ? h.a2
                  : h.a1
                : h.b1 === player.id
                  ? h.b2
                  : h.b1;
              const opponents = onA ? [h.b1, h.b2] : [h.a1, h.a2];
              const mine = onA ? h.scoreA : h.scoreB;
              const theirs = onA ? h.scoreB : h.scoreA;
              const won = (mine ?? 0) > (theirs ?? 0);

              return (
                <li key={h.matchId} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm">
                      <span className={won ? "font-semibold" : ""}>
                        {mine}–{theirs}
                      </span>{" "}
                      <span className="text-[var(--muted)]">
                        with {nameOf.get(partner) ?? "?"} v{" "}
                        {opponents.map((o) => nameOf.get(o) ?? "?").join(" & ")}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-mono text-sm tabular-nums ${
                        h.delta >= 0 ? "text-[var(--accent)]" : "text-[var(--danger)]"
                      }`}
                    >
                      {h.delta >= 0 ? "+" : ""}
                      {h.delta.toFixed(3)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    <LocalDateTime iso={h.playedAt.toISOString()} withWeekday={false} /> ·{" "}
                    {h.ratingAfter.toFixed(3)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

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
