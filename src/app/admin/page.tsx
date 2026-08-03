import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageRoles } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";
import { getInviteCode } from "@/lib/invite";
import InviteCard from "./InviteCard";
import RosterCard from "./RosterCard";

export const metadata = { title: "Admin · PicklePlay" };

export default async function AdminPage() {
  const me = await getCurrentPlayer();
  // 404 rather than 403: don't confirm the page exists to someone who can't use it.
  if (!me || (me.role !== "admin" && me.role !== "superadmin")) notFound();

  const db = getDb();
  const [code, roster, headerList] = await Promise.all([
    getInviteCode(),
    db
      .select({
        id: players.id,
        username: players.username,
        role: players.role,
        rating: playerStats.rating,
        reliability: playerStats.reliability,
        provisional: playerStats.provisional,
        selfDeclared: playerStats.selfDeclared,
        localMatches: playerStats.localMatches,
      })
      .from(players)
      .leftJoin(playerStats, eq(playerStats.playerId, players.id))
      .orderBy(desc(players.createdAt))
      .limit(200),
    headers(),
  ]);

  const host = headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return (
    <main className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Link href="/" className="text-sm font-medium text-[var(--accent)] underline">
          Back
        </Link>
      </div>

      <InviteCard code={code} origin={`${proto}://${host}`} />

      <RosterCard
        roster={roster.map((p) => ({ ...p, role: p.role as Role }))}
        canManageRoles={canManageRoles(me.role)}
        meRole={me.role}
        meId={me.id}
      />
    </main>
  );
}
