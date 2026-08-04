import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { logoutAction } from "@/lib/auth/actions";
import { isAtLeast } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { playerStats } from "@/lib/db/schema";

export const metadata = { title: "Me · PicklePlay" };

export default async function MePage() {
  const me = await getCurrentPlayer();
  if (!me) redirect("/login");

  const stats = (
    await getDb().select().from(playerStats).where(eq(playerStats.playerId, me.id)).limit(1)
  )[0];

  const decided = (stats?.wins ?? 0) + (stats?.losses ?? 0);
  const winRate = decided > 0 ? Math.round(((stats?.wins ?? 0) / decided) * 100) : 0;

  return (
    <>
      <TopBar title="PicklePlay" />

      <main className="screen pt-4">
        {/* Profile header: name, role, then the numbers in orange. */}
        <section className="card">
          <div className="flex items-center gap-3">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-2xl">
              🏓
            </span>
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
            <Stat label="Played" value={String(stats?.localMatches ?? 0)} />
            <Stat label="Won" value={String(stats?.wins ?? 0)} />
            <Stat label="Win rate" value={decided > 0 ? `${winRate}%` : "—"} />
          </div>

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
          <RowLink href={`/p/${me.username}`} icon="⭐" label="Update my DUPR" />
          {isAtLeast(me.role, "admin") ? (
            <RowLink href="/admin" icon="🛠" label="Admin" hint="Invite code, players" />
          ) : null}
          <RowLink href="/sessions" icon="🗂" label="All sessions" last />
        </section>

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
