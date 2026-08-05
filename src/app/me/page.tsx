import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import ReliabilityRing from "@/components/ReliabilityRing";
import TopBar from "@/components/TopBar";
import { logoutAction } from "@/lib/auth/actions";
import { isAtLeast } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";
import { AvatarCard, GenderCard, ImportRecordCard } from "./ProfileCards";

export const metadata = { title: "Me · PicklePlay" };

export default async function MePage() {
  const me = await getCurrentPlayer();
  if (!me) redirect("/login");

  const db = getDb();
  const [statsRow, profileRow] = await Promise.all([
    db.select().from(playerStats).where(eq(playerStats.playerId, me.id)).limit(1),
    db
      .select({
        avatar: players.avatar,
        gender: players.gender,
        importedMatches: players.importedMatches,
        importedWins: players.importedWins,
        importedAt: players.importedAt,
      })
      .from(players)
      .where(eq(players.id, me.id))
      .limit(1),
  ]);

  const stats = statsRow[0];
  const profile = profileRow[0];

  // Career = what they brought with them plus what they've done here.
  const localWins = stats?.wins ?? 0;
  const localDecided = localWins + (stats?.losses ?? 0);
  const careerMatches = (profile?.importedMatches ?? 0) + localDecided;
  const careerWins = (profile?.importedWins ?? 0) + localWins;
  const winRate = careerMatches > 0 ? Math.round((careerWins / careerMatches) * 100) : 0;

  return (
    <>
      <TopBar title="PicklePlay" />

      <main className="screen pt-4">
        {/*
          Name and rating on one line, then the four numbers. Everything that
          needs a sentence to explain it — imported counts, what provisional
          means, where the rating came from — lives on My rating instead. This
          screen is the one you glance at.
        */}
        <section className="card">
          <div className="flex items-center gap-3">
            <Avatar username={me.username} avatar={profile?.avatar} size={56} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold">{me.displayName ?? me.username}</p>
              <span className="mt-0.5 inline-block rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                {ROLE_LABELS[me.role]}
              </span>
            </div>
            {/* A bare number beside a name doesn't say what it is. */}
            <div className="shrink-0 text-right">
              <p className="font-mono text-3xl font-bold tabular-nums text-[var(--accent)]">
                {stats ? stats.rating.toFixed(3) : "—"}
                {stats?.provisional ? <span className="text-xl">?</span> : null}
              </p>
              <p className="text-[11px] text-[var(--muted)]">PicklePlay Rating</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 items-end gap-2 border-t border-[var(--border)] pt-4 text-center">
            <div className="flex flex-col items-center gap-1">
              <ReliabilityRing value={stats?.reliability ?? 0} size={44} />
              <p className="text-[11px] text-[var(--muted)]">Reliability</p>
            </div>
            <Stat label="Played" value={String(careerMatches)} />
            <Stat label="Won" value={String(careerWins)} />
            <Stat label="Win rate" value={careerMatches > 0 ? `${winRate}%` : "—"} />
          </div>
        </section>

        {/* Shortcut grid, as in the mini-program's profile tab. */}
        <section className="card mt-3">
          <div className="grid grid-cols-3 gap-y-5">
            <Shortcut href={`/p/${me.username}/record?from=/me`} icon="📈" label="My record" />
            <Shortcut href="/sessions" icon="📅" label="My sessions" />
            <Shortcut href="/leaderboard?from=/me" icon="🏆" label="Rankings" />
          </div>
        </section>

        <section className="card-tight mt-3 overflow-hidden">
          <RowLink
            href={`/p/${me.username}?from=/me`}
            icon="⭐"
            label="My rating"
            hint="Details, history, update"
            last={!isAtLeast(me.role, "admin")}
          />
          {isAtLeast(me.role, "admin") ? (
            <RowLink href="/admin" icon="🛠" label="Admin" hint="Invite code, players" last />
          ) : null}
        </section>

        <AvatarCard username={me.username} avatar={profile?.avatar ?? null} />
        <GenderCard gender={profile?.gender ?? "unspecified"} />
        <ImportRecordCard
          importedMatches={profile?.importedMatches ?? 0}
          importedWins={profile?.importedWins ?? 0}
          locked={!!profile?.importedAt}
          playedHere={stats?.localMatches ?? 0}
        />

        <form action={logoutAction} className="mt-6">
          <button type="submit" className="btn-ghost text-[var(--muted)]">
            Log out
          </button>
        </form>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-lg font-bold tabular-nums text-[var(--accent)]">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">{label}</p>
    </div>
  );
}

function Shortcut({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5 active:opacity-60">
      <span className="text-2xl">{icon}</span>
      <span className="text-xs">{label}</span>
    </Link>
  );
}

function RowLink({
  href,
  icon,
  label,
  hint,
  last = false,
}: {
  href: string;
  icon: string;
  label: string;
  hint?: string;
  last?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-3.5 active:bg-[var(--surface-2)] ${
        last ? "" : "border-b border-[var(--border)]"
      }`}
    >
      <span className="text-lg">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      {hint ? <span className="text-sm text-[var(--muted)]">{hint}</span> : null}
      <span className="text-[var(--muted)]">›</span>
    </Link>
  );
}
