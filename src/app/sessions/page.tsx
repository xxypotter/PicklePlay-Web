import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import LocalDateTime from "@/components/LocalDateTime";
import TopBar from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { matches, sessions, signups } from "@/lib/db/schema";
import { canSeeSession } from "@/lib/auth/policy";
import { closeStaleSessions } from "@/lib/sessions/auto-close";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translate";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("sessions.title");

export default async function SessionsPage() {
  const me = await getCurrentPlayer();
  if (!me) redirect("/login");

  const t = await getT(me.locale);
  const db = getDb();
  await closeStaleSessions();

  const all = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      location: sessions.location,
      startsAt: sessions.startsAt,
      status: sessions.status,
      rated: sessions.rated,
      isPrivate: sessions.isPrivate,
      createdBy: sessions.createdBy,
    })
    .from(sessions)
    .orderBy(desc(sessions.startsAt))
    .limit(80);

  const ids = all.map((s) => s.id);

  const [playedCounts, mySignups] = ids.length
    ? await Promise.all([
        db
          .select({ sessionId: matches.sessionId, n: sql<number>`count(*)::int` })
          .from(matches)
          .where(and(inArray(matches.sessionId, ids), eq(matches.status, "completed")))
          .groupBy(matches.sessionId),
        db
          .select({ sessionId: signups.sessionId, state: signups.state })
          .from(signups)
          .where(and(inArray(signups.sessionId, ids), eq(signups.playerId, me.id))),
      ])
    : [[], []];

  const matchesBy = new Map(playedCounts.map((c) => [c.sessionId, c.n]));
  const mineBy = new Map(mySignups.map((s) => [s.sessionId, s.state]));

  // Same rule as Home: a private night belongs to the people in it.
  const visible = all.filter((s) => canSeeSession(me, s, mineBy.has(s.id)));

  /*
   * Yours first, then everyone else's.
   *
   * This page is reached from "My sessions", so a flat list of every session in
   * the group buried the two or three that are actually yours. Each session
   * appears once — your past nights aren't repeated in the archive below.
   */
  const mineUpcoming = visible
    .filter((s) => s.status !== "closed" && mineBy.has(s.id))
    .reverse(); // soonest first
  const minePast = visible.filter((s) => s.status === "closed" && mineBy.has(s.id));
  const otherPast = visible.filter((s) => s.status === "closed" && !mineBy.has(s.id));
  const otherUpcoming = visible.filter((s) => s.status !== "closed" && !mineBy.has(s.id)).length;

  return (
    <>
      <TopBar title={t("sessions.title")} back="/me" />
      <main className="screen pt-4">
        <Group
          title={
            mineUpcoming.length > 0
              ? t("sessions.count", {
                  title: t("sessions.upcoming"),
                  count: mineUpcoming.length,
                })
              : t("sessions.upcoming")
          }
          rows={mineUpcoming}
          matchesBy={matchesBy}
          t={t}
          mine
        >
          {otherUpcoming > 0 ? (
            <p className="card text-sm text-[var(--muted)]">
              {t("sessions.notIn")}{" "}
              <Link href="/" className="font-medium text-[var(--accent)] underline">
                {t("sessions.openOnHome", { count: otherUpcoming })}
              </Link>
            </p>
          ) : (
            <p className="card text-sm text-[var(--muted)]">{t("home.empty.upcoming")}</p>
          )}
        </Group>

        <Group
          title={t("sessions.mine", { count: minePast.length })}
          rows={minePast}
          matchesBy={matchesBy}
          t={t}
          mine
        >
          <p className="card text-sm text-[var(--muted)]">{t("sessions.noneYet")}</p>
        </Group>

        <Group
          title={t("sessions.others", { count: otherPast.length })}
          rows={otherPast}
          matchesBy={matchesBy}
          t={t}
        >
          <p className="card text-sm text-[var(--muted)]">{t("sessions.archiveEmpty")}</p>
        </Group>
      </main>
    </>
  );
}

interface Row {
  id: string;
  title: string;
  location: string | null;
  startsAt: Date;
  status: string;
  rated: boolean;
}

function Group({
  title,
  rows,
  matchesBy,
  t,
  mine = false,
  children,
}: {
  title: string;
  rows: Row[];
  matchesBy: Map<string | null, number>;
  t: T;
  mine?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 px-1 text-sm text-[var(--muted)]">{title}</h2>

      {rows.length === 0 ? (
        children
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((s) => {
            const played = matchesBy.get(s.id) ?? 0;
            return (
              <li key={s.id}>
                <Link
                  href={`/s/${s.id}?from=/sessions`}
                  className="card block active:opacity-70"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold">{s.title}</span>
                    {mine ? (
                      <span className="shrink-0 text-xs font-semibold text-[var(--accent)]">
                        {s.status === "closed" ? t("card.played") : t("card.youreIn")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    <LocalDateTime iso={s.startsAt.toISOString()} />
                    {s.location ? ` · ${s.location}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {played > 0
                      ? t.plural("card.matches", played, { count: played })
                      : t("card.noMatches")}
                    {s.status === "live" ? ` · ${t("card.inProgress")}` : ""}
                    {!s.rated ? t("card.casual") : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
