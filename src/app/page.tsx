import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import Link from "next/link";
import SessionCard, { type SessionCardData } from "@/components/SessionCard";
import Tabs from "@/components/Tabs";
import TopBar from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, sessions, signups } from "@/lib/db/schema";
import { closeStaleSessions } from "@/lib/sessions/auto-close";
import { canManageSessions } from "@/lib/auth/policy";
import { getT } from "@/lib/i18n/server";

/**
 * Split by time, not by kind.
 *
 * The tabs used to be Matches and Events, meaning rated and casual. That's a
 * real distinction in the data but not the question anyone opens the app with —
 * which is "what's next" and occasionally "what happened". Casual sessions now
 * appear in both lists, marked on the card.
 */
type TabKey = "upcoming" | "history";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = await getCurrentPlayer();
  const t = await getT(me?.locale);

  if (!me) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <div className="mb-10 text-center">
          <p className="text-5xl">🏓</p>
          <h1 className="mt-4 text-3xl font-bold">{t("app.name")}</h1>
          <p className="mt-2 text-[var(--muted)]">{t("home.tagline")}</p>
        </div>
        <div className="flex flex-col gap-3">
          <Link href="/register" className="btn-primary text-center">
            {t("auth.register")}
          </Link>
          <Link href="/login" className="btn-ghost text-center">
            {t("auth.login")}
          </Link>
        </div>
      </main>
    );
  }

  const { tab } = await searchParams;
  const active: TabKey = tab === "history" ? "history" : "upcoming";

  const db = getDb();

  // Sessions nobody remembered to end shouldn't linger in Upcoming.
  await closeStaleSessions();

  // Upcoming reads soonest-first; history reads most-recent-first.
  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      location: sessions.location,
      startsAt: sessions.startsAt,
      status: sessions.status,
      rated: sessions.rated,
      courtNames: sessions.courtNames,
      maxPlayers: sessions.maxPlayers,
      format: sessions.format,
      organizer: players.username,
    })
    .from(sessions)
    .leftJoin(players, eq(players.id, sessions.createdBy))
    .where(
      active === "history"
        ? eq(sessions.status, "closed")
        : ne(sessions.status, "closed"),
    )
    .orderBy(active === "history" ? desc(sessions.startsAt) : asc(sessions.startsAt))
    .limit(40);

  const ids = rows.map((r) => r.id);

  const [counts, mine] = ids.length
    ? await Promise.all([
        db
          .select({ sessionId: signups.sessionId, n: sql<number>`count(*)::int` })
          .from(signups)
          .where(and(inArray(signups.sessionId, ids), eq(signups.state, "in")))
          .groupBy(signups.sessionId),
        db
          .select({ sessionId: signups.sessionId, state: signups.state })
          .from(signups)
          .where(and(inArray(signups.sessionId, ids), eq(signups.playerId, me.id))),
      ])
    : [[], []];

  const countBy = new Map(counts.map((c) => [c.sessionId, c.n]));
  const stateBy = new Map(mine.map((m) => [m.sessionId, m.state]));

  const canCreate = !!me && canManageSessions(me.role);

  const cards: SessionCardData[] = rows.map((r) => ({
    ...r,
    signedUp: countBy.get(r.id) ?? 0,
    myState: stateBy.get(r.id),
  }));

  const myCards = cards.filter((c) => c.myState);
  const otherCards = cards.filter((c) => !c.myState);

  // Home has tabs, so "back to home" isn't one place. Tapping a finished
  // session from History and coming back to Upcoming loses your place.
  const backHere = active === "upcoming" ? "/" : "/?tab=history";

  return (
    <>
      <TopBar />
      <Tabs
        active={active}
        items={[
          { key: "upcoming", label: t("home.tab.upcoming"), href: "/" },
          { key: "history", label: t("home.tab.history"), href: "/?tab=history" },
        ]}
      />

      <main className="screen pt-4">
        <div className="mb-3 flex items-baseline justify-between px-1">
          <h2 className="text-sm text-[var(--muted)]">
            {t.plural(
              active === "upcoming" ? "home.comingUp" : "home.finished",
              cards.length,
              { count: cards.length },
            )}
          </h2>
          <Link
            href={`/leaderboard?from=${encodeURIComponent(backHere)}`}
            className="text-sm text-[var(--muted)]"
          >
            {t("home.rankings")}
          </Link>
        </div>

        {cards.length === 0 ? (
          <div className="card py-14 text-center">
            {active === "upcoming" ? (
              <>
                <p className="text-[var(--muted)]">{t("home.empty.upcoming")}</p>
                {/*
                  This is the screen most of the group sees most of the time,
                  and it used to tell every player to tap a + that refuses them.
                  Only say it to someone who can actually do it.
                */}
                <p className="hint">
                  {canCreate
                    ? t("home.empty.upcoming.admin")
                    : t("home.empty.upcoming.player")}
                </p>
              </>
            ) : (
              <>
                <p className="text-[var(--muted)]">{t("home.empty.history")}</p>
                <p className="hint">{t("home.empty.history.hint")}</p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Yours first — the ones you need to act on shouldn't be hunted for. */}
            {myCards.length > 0 ? (
              <section className="mb-6">
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                  {active === "upcoming"
                    ? t("home.group.yourein")
                    : t("home.group.youplayed")}
                </h3>
                <div className="flex flex-col gap-3">
                  {myCards.map((s) => (
                    <SessionCard key={s.id} session={s} from={backHere} locale={me.locale} />
                  ))}
                </div>
              </section>
            ) : null}

            {otherCards.length > 0 ? (
              <section>
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {active === "upcoming"
                    ? myCards.length > 0
                      ? t("home.group.alsoOpen")
                      : t("home.group.openToJoin")
                    : t("home.group.other")}
                </h3>
                <div className="flex flex-col gap-3">
                  {otherCards.map((s) => (
                    <SessionCard key={s.id} session={s} from={backHere} locale={me.locale} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
