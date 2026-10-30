import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import Tabs from "@/components/Tabs";
import LiveRefresh from "@/components/LiveRefresh";
import TopBar, { safeFrom } from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";
import { careerOf } from "@/lib/profile/queries";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translate";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("rank.title");

type TabKey = "all" | "male" | "female";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string }>;
}) {
  const { tab, from } = await searchParams;
  const active: TabKey = tab === "male" ? "male" : tab === "female" ? "female" : "all";

  const [me, all] = await Promise.all([
    getCurrentPlayer(),
    getDb()
      .select({
        id: players.id,
        username: players.username,
        avatar: players.avatar,
        gender: players.gender,
        rating: playerStats.rating,
        reliability: playerStats.reliability,
        provisional: playerStats.provisional,
        selfDeclared: playerStats.selfDeclared,
        localMatches: playerStats.localMatches,
      })
      .from(playerStats)
      .innerJoin(players, eq(players.id, playerStats.playerId))
      .where(eq(players.active, true))
      .orderBy(desc(playerStats.rating))
      .limit(300),
  ]);

  /*
   * "Not listed" means exactly that — including on the All tab. Anyone who
   * picked it stays out of every ranking table, which is the promise the
   * signup and profile copy makes.
   */
  const t = await getT(me?.locale);

  // Played and won count every scored game here, rated or casual (v2.0).
  const career = await careerOf(all.map((r) => r.id));
  const withCareer = all.map((r) => ({ ...r, played: career.get(r.id)?.played ?? 0, won: career.get(r.id)?.won ?? 0 }));

  const listed = withCareer.filter((r) => r.gender !== "unspecified");
  const inTab = (r: { gender: string }) => active === "all" || r.gender === active;

  /*
   * Established ratings only (v2.1).
   *
   * Until v2.0 a `?` on the number was the compromise: one list, everyone in
   * it, provisional ratings marked rather than split off into a second table
   * that read like a waiting room. Now that a typed reliability fades, the `?`
   * is a verdict rather than a label — the group has not yet seen enough of
   * this player for the number to mean anything — and ranking numbers nobody
   * can lean on next to ones they can is the wrong comparison. So the table
   * lists ratings that have reached "reliable" (§3.6) and says how many are
   * still on their way, so an absence has an explanation instead of a gap.
   */
  const rows = listed.filter((r) => !r.provisional && inTab(r));
  const settling = listed.filter((r) => r.provisional && inTab(r)).length;
  const meRow = me ? all.find((r) => r.id === me.id) : undefined;
  const meOptedOut = !!meRow && meRow.gender === "unspecified";
  const meSettling = !!meRow && !meOptedOut && meRow.provisional;

  const base = "/leaderboard";
  // Rankings hangs off both Home and Me, so where back goes depends on which
  // one you came through. Default to Home for a cold link.
  const backTo = safeFrom(from, "/");

  /**
   * Every link that stays on this page has to carry `from` forward, or
   * switching tabs would quietly strip it and send back to the wrong place.
   */
  const here = (key: TabKey) => {
    const q = new URLSearchParams();
    if (key !== "all") q.set("tab", key);
    if (backTo !== "/") q.set("from", backTo);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const backHere = here(active);

  return (
    <>
      {/* No polling here — just pick up changes on returning to the app. */}
      <LiveRefresh />
      <TopBar title={t("rank.title")} back={backTo} />
      <Tabs
        active={active}
        items={[
          { key: "all", label: t("rank.tab.all"), href: here("all") },
          { key: "male", label: t("rank.tab.male"), href: here("male") },
          { key: "female", label: t("rank.tab.female"), href: here("female") },
        ]}
      />

      <main className="screen pt-4">
        {/* Explain the absence rather than letting them wonder where they went. */}
        {meOptedOut ? (
          <p className="card mb-3 text-sm text-[var(--muted)]">{t("rank.optedOut")}</p>
        ) : null}
        {/* Same courtesy for the other absence: say where they stand and how to get in. */}
        {meSettling ? (
          <p className="card mb-3 text-sm text-[var(--muted)]">
            {t("rank.meSettling", { reliability: Math.round(meRow!.reliability * 100) })}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-[var(--muted)]">{t("rank.empty")}</p>
            <p className="hint">
              {settling > 0 ? t.plural("rank.settling", settling, { count: settling }) : t("rank.emptyHint")}
            </p>
          </div>
        ) : (
          <>
            <Table rows={rows} meId={me?.id} startRank={1} backHere={backHere} t={t} />

            {settling > 0 ? (
              <p className="mt-3 px-1 text-xs text-[var(--muted)]">
                {t.plural("rank.settling", settling, { count: settling })}
              </p>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}

interface Row {
  id: string;
  username: string;
  avatar: string | null;
  rating: number;
  provisional: boolean;
  selfDeclared: boolean;
  localMatches: number;
  played: number;
  won: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function Table({
  rows,
  meId,
  startRank,
  backHere,
  t,
}: {
  rows: Row[];
  meId?: string;
  startRank?: number;
  backHere: string;
  t: T;
}) {
  if (rows.length === 0) {
    return (
      <div className="card py-8 text-center text-sm text-[var(--muted)]">{t("rank.empty")}</div>
    );
  }

  return (
    <ul className="card-tight overflow-hidden">
      {rows.map((r, i) => {
        const matches = r.played;
        const wins = r.won;
        const rate = matches > 0 ? Math.round((wins / matches) * 100) : null;

        return (
          /*
            The whole row is the link. It used to be just the name — a 161x24
            target in a stack of twelve, which is a mis-tap waiting to happen on
            a phone. Same look, a target you can actually hit.
          */
          <li key={r.id}>
          <Link
            href={`/p/${r.username}?from=${encodeURIComponent(backHere)}`}
            className={`flex items-center gap-3 border-b border-[var(--border)] px-4 py-3
              last:border-0 active:bg-[var(--surface-2)] ${r.id === meId ? "bg-[var(--accent-soft)]" : ""}`}
          >
            {startRank !== undefined ? (
              <span className="w-6 shrink-0 text-center text-sm tabular-nums">
                {MEDALS[i] ?? startRank + i}
              </span>
            ) : null}

            <Avatar username={r.username} avatar={r.avatar} size={36} />

            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.username}</span>
              <p className="text-xs text-[var(--muted)]">
                {matches === 0
                  ? t("rank.noMatches")
                  : t("rank.summary", { played: matches, rate: rate ?? 0 })}
              </p>
            </div>

            <span className="shrink-0 font-mono text-lg font-semibold tabular-nums text-[var(--accent)]">
              {r.rating.toFixed(3)}
            </span>
          </Link>
          </li>
        );
      })}
    </ul>
  );
}
