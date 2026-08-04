import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
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
        {/* Profile header: name, role, then the numbers in orange. */}
        <section className="card">
          <div className="flex items-center gap-3">
            <Avatar username={me.username} avatar={profile?.avatar} size={56} />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{me.displayName ?? me.username}</p>
              {me.role !== "player" ? (
                <span className="mt-0.5 inline-block rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                  {ROLE_LABELS[me.role]}
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-[var(--border)] pt-4 text-center">
            <Stat label="Rating" value={stats ? stats.rating.toFixed(3) : "—"} />
            <Stat label="Played" value={String(careerMatches)} />
            <Stat label="Won" value={String(careerWins)} />
            <Stat label="Win rate" value={careerMatches > 0 ? `${winRate}%` : "—"} />
          </div>

          {profile && profile.importedMatches > 0 ? (
            <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
              Includes {profile.importedMatches} imported · {stats?.localMatches ?? 0} played here
            </p>
          ) : null}

          {stats ? (
            <p className="mt-3 text-center text-xs text-[var(--muted)]">
              {stats.provisional
                ? "Provisional — a few more games and this settles."
                : `${Math.round(stats.reliability * 100)}% reliable`}
              {stats.selfDeclared ? " · self-declared" : ""}
            </p>
          ) : null}
        </section>

        {/* Shortcut grid, as in the mini-program's profile tab. */}
        <section className="card mt-3">
          <div className="grid grid-cols-3 gap-y-5">
            <Shortcut href={`/p/${me.username}`} icon="📈" label="My record" />
            <Shortcut href="/sessions" icon="📅" label="My sessions" />
            <Shortcut href="/leaderboard" icon="🏆" label="Rankings" />
          </div>
        </section>

        <section className="card-tight mt-3 overflow-hidden">
          <RowLink
            href={`/p/${me.username}`}
            icon="⭐"
            label="Update my DUPR"
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
