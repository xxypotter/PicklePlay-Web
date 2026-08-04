import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import { canManageRoles } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { players, playerStats } from "@/lib/db/schema";
import { getInviteCode } from "@/lib/invite";
import BackupCard from "./BackupCard";
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
        importedMatches: players.importedMatches,
        importedWins: players.importedWins,
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
    <>
      <TopBar title="Admin" back="/me" />
      <main className="screen pt-4">
      <InviteCard code={code} origin={`${proto}://${host}`} />

      {/* Super admin only: it exposes whether the deploy is holding credentials. */}
      {me.role === "superadmin" ? (
        <BackupCard
          configured={!!process.env.BACKUP_GITHUB_REPO && !!process.env.BACKUP_GITHUB_TOKEN}
        />
      ) : null}

      <RosterCard
        roster={roster.map((p) => ({ ...p, role: p.role as Role }))}
        canManageRoles={canManageRoles(me.role)}
        meRole={me.role}
        meId={me.id}
      />
      </main>
    </>
  );
}
