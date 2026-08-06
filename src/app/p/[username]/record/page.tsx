import { and, asc, eq, inArray, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import MarginChart from "@/components/MarginChart";
import TopBar, { safeFrom } from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { matches, players } from "@/lib/db/schema";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translate";
import {
  bestPartner,
  favouriteOpponent,
  mostPlayedWith,
  nemesis,
  summariseRecord,
  type HeadToHead,
} from "@/lib/profile/record";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("record.title");

export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { username } = await params;
  const { from } = await searchParams;

  const db = getDb();
  const found = await db
    .select({
      id: players.id,
      username: players.username,
      displayName: players.displayName,
      importedMatches: players.importedMatches,
      importedWins: players.importedWins,
    })
    .from(players)
    .where(eq(players.usernameLower, decodeURIComponent(username).toLowerCase()))
    .limit(1);

  const player = found[0];
  if (!player) notFound();

  /*
   * Straight from `matches`, not from rating events.
   *
   * Rating events only exist for rated sessions, so reading history from them
   * would silently drop every casual night. A record is a record: if it was
   * played and scored, it counts here, whether or not it moved anyone's number.
   */
  const [me, played] = await Promise.all([
    getCurrentPlayer(),
    db
      .select({
        matchId: matches.id,
        playedAt: matches.playedAt,
        a1: matches.a1,
        a2: matches.a2,
        b1: matches.b1,
        b2: matches.b2,
        scoreA: matches.scoreA,
        scoreB: matches.scoreB,
      })
      .from(matches)
      .where(
        and(
          eq(matches.status, "completed"),
          or(
            eq(matches.a1, player.id),
            eq(matches.a2, player.id),
            eq(matches.b1, player.id),
            eq(matches.b2, player.id),
          ),
        ),
      )
      .orderBy(asc(matches.playedAt)),
  ]);

  const t = await getT(me?.locale);
  const record = summariseRecord(player.id, played);
  const isMe = me?.id === player.id;

  // Every partner and opponent named in one query rather than N.
  const involved = new Set<string>();
  for (const m of record.matches) {
    involved.add(m.partnerId);
    for (const o of m.opponentIds) involved.add(o);
  }
  const nameRows = involved.size
    ? await db
        .select({ id: players.id, username: players.username })
        .from(players)
        .where(inArray(players.id, [...involved]))
    : [];
  const nameOf = new Map(nameRows.map((n) => [n.id, n.username]));

  // Career = brought with them plus played here, matching Me and the rankings.
  const careerPlayed = player.importedMatches + record.played;
  const careerWon = player.importedWins + record.won;
  const careerRate = careerPlayed > 0 ? Math.round((careerWon / careerPlayed) * 100) : null;

  const facts = [
    fact(t, "record.bestWith", bestPartner(record.partners), nameOf, "record.verb.won"),
    fact(t, "record.ownsHeadToHead", favouriteOpponent(record.opponents), nameOf, "record.verb.beaten"),
    fact(t, "record.hasTheirNumber", nemesis(record.opponents), nameOf, "record.verb.lostTo"),
    fact(t, "record.mostCourtTime", mostPlayedWith(record.partners), nameOf, null),
  ].filter(Boolean) as { key: string; label: string; name: string; detail: string }[];

  return (
    <>
      <TopBar
        title={
          isMe
            ? t("record.title")
            : t("record.titleOther", { name: player.displayName ?? player.username })
        }
        back={safeFrom(from, `/p/${player.username}`)}
      />
      <main className="screen pt-4">
        {/* Deliberately no rating on this screen — that lives on My rating. */}
        <section className="card">
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Stat label={t("common.played")} value={String(careerPlayed)} />
            <Stat label={t("common.won")} value={String(careerWon)} />
            <Stat label={t("common.lost")} value={String(careerPlayed - careerWon)} />
            <Stat
              label={t("common.winRate")}
              value={careerRate === null ? t("common.none") : `${careerRate}%`}
            />
          </dl>

          {player.importedMatches > 0 ? (
            <p className="hint mt-3">
              {t("record.importedNote", {
                imported: player.importedMatches,
                here: record.played,
              })}
            </p>
          ) : null}

          <div className="mt-4">
            <MarginChart margins={record.matches.map((m) => m.margin)} locale={me?.locale} />
          </div>
          <p className="hint">{t("record.marginHint")}</p>
        </section>

        {record.played > 0 ? (
          <section className="card mt-5">
            <h2 className="text-sm font-medium text-[var(--muted)]">{t("record.points")}</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label={t("record.scored")} value={String(record.pointsFor)} />
              <Stat label={t("record.conceded")} value={String(record.pointsAgainst)} />
              <Stat
                label={t("record.difference")}
                value={`${record.pointsFor - record.pointsAgainst >= 0 ? "+" : ""}${
                  record.pointsFor - record.pointsAgainst
                }`}
              />
            </dl>
            <p className="hint mt-3">
              {t("record.bests", {
                best: record.biggestWin
                  ? t("record.by", { margin: record.biggestWin.margin })
                  : t("common.none"),
                worst: record.heaviestLoss
                  ? t("record.by", { margin: -record.heaviestLoss.margin })
                  : t("common.none"),
                streak: record.longestWinStreak,
              })}
            </p>
          </section>
        ) : null}

        {facts.length > 0 ? (
          <section className="card mt-5">
            <h2 className="text-sm font-medium text-[var(--muted)]">
              {isMe ? t("record.whoYouPlay") : t("record.whoTheyPlay")}
            </h2>
            <ul className="mt-3 flex flex-col gap-3">
              {facts.map((f) => (
                <li key={f.key} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-[var(--muted)]">{f.label}</span>
                  <span className="min-w-0 flex-1 truncate text-right font-medium">
                    {f.name}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted)] tabular-nums">
                    {f.detail}
                  </span>
                </li>
              ))}
            </ul>
            <p className="hint mt-3">{t("record.factsHint")}</p>
          </section>
        ) : null}

        <section className="card-tight mt-5 overflow-hidden">
          <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
            {t("record.matches", { count: record.matches.length })}
          </h2>
          {record.matches.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">
              {t("record.matchesEmpty")}
            </p>
          ) : (
            <ul>
              {[...record.matches].reverse().map((m) => (
                <li
                  key={m.matchId}
                  className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-0"
                >
                  <span
                    className={`w-6 shrink-0 text-center text-xs font-bold ${
                      m.won ? "text-[var(--success)]" : "text-[var(--danger)]"
                    }`}
                  >
                    {m.won ? t("record.win") : t("record.loss")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {t("record.with", {
                        partner: nameOf.get(m.partnerId) ?? t("common.none"),
                      })}{" "}
                      <span className="text-[var(--muted)]">{t("record.versus")}</span>{" "}
                      {m.opponentIds
                        .map((o) => nameOf.get(o) ?? t("common.none"))
                        .join(" & ")}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      <LocalDateTime iso={m.playedAt.toISOString()} withWeekday={false} />
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-sm tabular-nums">
                    {m.scoreFor}–{m.scoreAgainst}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

/**
 * One "fun fact" row, or nothing if there isn't enough history for it.
 *
 * `verbKey` is null for the most-played row, which counts games rather than
 * results and so takes a different sentence entirely rather than a swapped-out
 * word.
 *
 * The count is always the one the verb is about. `wins` on a head-to-head is
 * the subject's wins, so the nemesis row — which says "lost to" — has to
 * count the other side, or it reports three defeats to someone it just
 * counted three wins against.
 */
function fact(
  t: T,
  labelKey: DictKey,
  h: HeadToHead | null,
  nameOf: Map<string, string>,
  verbKey: DictKey | null,
) {
  if (!h) return null;
  const name = nameOf.get(h.playerId);
  if (!name) return null;
  const count = verbKey === "record.verb.lostTo" ? h.games - h.wins : h.wins;
  const detail = verbKey
    ? t("record.factRatio", { wins: count, games: h.games, verb: t(verbKey) })
    : t.plural("record.factGames", h.games, { count: h.games });
  return { key: labelKey, label: t(labelKey), name, detail };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dd className="font-mono text-lg font-bold tabular-nums text-[var(--accent)]">
        {value}
      </dd>
      <dt className="mt-0.5 text-[11px] text-[var(--muted)]">{label}</dt>
    </div>
  );
}
