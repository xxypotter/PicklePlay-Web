import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import TopBar from "@/components/TopBar";
import {
  canManageRoles,
  canRecomputeRatings,
  canRotateInviteCode,
  canRunBackup,
  isAtLeast,
} from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import type { Role } from "@/lib/auth/types";
import { getDb } from "@/lib/db";
import { auditLog, players, playerStats } from "@/lib/db/schema";
import { getT } from "@/lib/i18n/server";
import { getInviteCode } from "@/lib/invite";
import BackupCard from "./BackupCard";
import InviteCard from "./InviteCard";
import RosterCard from "./RosterCard";

import { titleFor } from "@/lib/i18n/metadata";

export const generateMetadata = titleFor("admin.title");

export default async function AdminPage() {
  const me = await getCurrentPlayer();
  // 404 rather than 403: don't confirm the page exists to someone who can't use it.
  if (!me || (me.role !== "admin" && me.role !== "superadmin")) notFound();

  const t = await getT(me.locale);
  const db = getDb();
  const [code, roster, headerList, lastBackupRow] = await Promise.all([
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
    // A backup nobody can confirm ran is barely a backup. actorId is null when
    // the weekly cron did it, set when someone pressed the button.
    db
      .select({ at: auditLog.createdAt, actorId: auditLog.actorId })
      .from(auditLog)
      .where(eq(auditLog.action, "backup.run"))
      .orderBy(desc(auditLog.createdAt))
      .limit(1),
  ]);

  const lastBackup = lastBackupRow[0]
    ? {
        iso: lastBackupRow[0].at.toISOString(),
        automatic: lastBackupRow[0].actorId === null,
      }
    : null;

  const host = headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return (
    <>
      <TopBar title={t("admin.title")} back="/me" />
      <main className="screen pt-4">
      <InviteCard
        code={code}
        origin={`${proto}://${host}`}
        canRotate={canRotateInviteCode(me.role)}
      />

      {/*
        The controls are the owner's: the response reveals whether the deploy
        holds a working token and which repo it writes to. Everyone else gets
        the one thing they'd actually want to know — that it happens, and that
        it happened recently.
      */}
      {canRunBackup(me.role) ? (
        <BackupCard
          configured={!!process.env.BACKUP_GITHUB_REPO && !!process.env.BACKUP_GITHUB_TOKEN}
          lastBackup={lastBackup}
        />
      ) : (
        <section className="card mt-5">
          <h2 className="text-sm font-medium text-[var(--muted)]">{t("admin.backup")}</h2>
          <p className="hint">{t("admin.backupPlayerNote")}</p>
        </section>
      )}

      <RosterCard
        roster={roster.map((p) => ({ ...p, role: p.role as Role }))}
        canManageRoles={canManageRoles(me.role)}
        canRecompute={canRecomputeRatings(me.role)}
        canDelete={isAtLeast(me.role, "superadmin")}
        meRole={me.role}
        meId={me.id}
      />
      </main>
    </>
  );
}
