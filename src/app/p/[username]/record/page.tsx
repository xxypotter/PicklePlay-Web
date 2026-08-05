import { and, asc, eq, inArray, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import MarginChart from "@/components/MarginChart";
import TopBar, { safeFrom } from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { matches, players } from "@/lib/db/schema";
import {
  bestPartner,
  favouriteOpponent,
  mostPlayedWith,
  nemesis,
  summariseRecord,
  type HeadToHead,
} from "@/lib/profile/record";

export const metadata = { title: "Record · PicklePlay" };

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
    fact("Best with", bestPartner(record.partners), nameOf, "won"),
    fact("Owns the head-to-head", favouriteOpponent(record.opponents), nameOf, "beaten"),
    fact("Has their number", nemesis(record.opponents), nameOf, "lost to"),
    fact("Most court time", mostPlayedWith(record.partners), nameOf, "together"),
  ].filter(Boolean) as { label: string; name: string; detail: string }[];

  return (
    <>
      <TopBar
        title={isMe ? "My record" : `${player.displayName ?? player.username}'s record`}
        back={safeFrom(from, `/p/${player.username}`)}
      />
      <main className="screen pt-4">
        {/* Deliberately no rating on this screen — that lives on My rating. */}
        <section className="card">
          <dl className="grid grid-cols-4 gap-2 text-center">
            <Stat label="Played" value={String(careerPlayed)} />
            <Stat label="Won" value={String(careerWon)} />
            <Stat label="Lost" value={String(careerPlayed - careerWon)} />
            <Stat label="Win rate" value={careerRate === null ? "—" : `${careerRate}%`} />
          </dl>

          {player.importedMatches > 0 ? (
            <p className="hint mt-3">
              Includes <strong>{player.importedMatches}</strong> brought in from
              before PicklePlay. <strong>{record.played}</strong> played here.
            </p>
          ) : null}

          <div className="mt-4">
            <MarginChart margins={record.matches.map((m) => m.margin)} />
          </div>
          <p className="hint">
            How the results were won and lost, oldest first — tall bars are
            comfortable, short ones went to the wire.
          </p>
        </section>

        {record.played > 0 ? (
          <section className="card mt-5">
            <h2 className="text-sm font-medium text-[var(--muted)]">Points</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Stat label="Scored" value={String(record.pointsFor)} />
              <Stat label="Conceded" value={String(record.pointsAgainst)} />
              <Stat
                label="Difference"
                value={`${record.pointsFor - record.pointsAgainst >= 0 ? "+" : ""}${
                  record.pointsFor - record.pointsAgainst
                }`}
              />
            </dl>
            <p className="hint mt-3">
              Best win {record.biggestWin ? `by ${record.biggestWin.margin}` : "—"} ·
              heaviest loss{" "}
              {record.heaviestLoss ? `by ${-record.heaviestLoss.margin}` : "—"} ·
              longest winning run {record.longestWinStreak}
            </p>
          </section>
        ) : null}

        {facts.length > 0 ? (
          <section className="card mt-5">
            <h2 className="text-sm font-medium text-[var(--muted)]">
              Who {isMe ? "you play" : "they play"}
            </h2>
            <ul className="mt-3 flex flex-col gap-3">
              {facts.map((f) => (
                <li key={f.label} className="flex items-baseline justify-between gap-3">
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
            <p className="hint mt-3">
              From {MIN_TOGETHER_TEXT} or more games together, so one lucky night
              doesn&apos;t decide it.
            </p>
          </section>
        ) : null}

        <section className="card-tight mt-5 overflow-hidden">
          <h2 className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
            Matches ({record.matches.length})
          </h2>
          {record.matches.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">
              Nothing played here yet.
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
                    {m.won ? "W" : "L"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      with {nameOf.get(m.partnerId) ?? "—"}{" "}
                      <span className="text-[var(--muted)]">v</span>{" "}
                      {m.opponentIds.map((o) => nameOf.get(o) ?? "—").join(" & ")}
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

const MIN_TOGETHER_TEXT = "three";

function fact(
  label: string,
  h: HeadToHead | null,
  nameOf: Map<string, string>,
  verb: string,
) {
  if (!h) return null;
  const name = nameOf.get(h.playerId);
  if (!name) return null;
  const detail =
    verb === "together"
      ? `${h.games} game${h.games === 1 ? "" : "s"}`
      : `${h.wins}/${h.games} ${verb}`;
  return { label, name, detail };
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
