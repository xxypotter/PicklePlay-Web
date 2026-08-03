/**
 * Weekly JSON backup — SPEC.md §2.1.
 *
 * Neon's free plan keeps only a 6-hour instant-restore window, which is much
 * shorter than it sounds: a bad edit on Friday that nobody notices until Sunday
 * is already unrecoverable. This is the real protection.
 *
 * Because matches and rating seeds are the only source of truth and ratings are
 * always recomputed (§5.6), this dump is a complete, restorable copy of the
 * entire product — a few hundred KB.
 *
 * PIN hashes are deliberately NOT exported. A 4-6 digit PIN is only ~10^6
 * candidates, so a leaked hash is crackable offline in seconds; a second copy
 * of them in a different trust domain is a bad trade. Ratings and match history
 * are irreplaceable, PINs are one admin reset away.
 */
import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCurrentPlayer } from "@/lib/auth/session";
import { isAtLeast } from "@/lib/auth/policy";
import { getDb } from "@/lib/db";
import { matches, players, ratingSeeds, sessions, signups } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretMatches(header: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !header) return false;

  const provided = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  // Vercel Cron presents the secret; an admin can also trigger it by hand to
  // confirm the whole path works rather than waiting a week to find out.
  const authorized =
    secretMatches(request.headers.get("authorization")) ||
    (await getCurrentPlayer().then((me) => !!me && isAtLeast(me.role, "admin")));

  if (!authorized) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const db = getDb();

  const [playerRows, seedRows, matchRows, sessionRows, signupRows] = await Promise.all([
    db
      .select({
        id: players.id,
        username: players.username,
        displayName: players.displayName,
        role: players.role,
        active: players.active,
        createdAt: players.createdAt,
      })
      .from(players)
      .orderBy(asc(players.createdAt)),
    db.select().from(ratingSeeds).orderBy(asc(ratingSeeds.effectiveAt)),
    db.select().from(matches).orderBy(asc(matches.playedAt)),
    db.select().from(sessions).orderBy(asc(sessions.startsAt)),
    db.select().from(signups).orderBy(asc(signups.createdAt)),
  ]);

  const payload = {
    schema: 1,
    takenAt: new Date().toISOString(),
    note: "PIN hashes intentionally excluded; restore requires admins to reset PINs.",
    counts: {
      players: playerRows.length,
      ratingSeeds: seedRows.length,
      matches: matchRows.length,
      sessions: sessionRows.length,
      signups: signupRows.length,
    },
    players: playerRows,
    ratingSeeds: seedRows,
    matches: matchRows,
    sessions: sessionRows,
    signups: signupRows,
  };

  const repo = process.env.BACKUP_GITHUB_REPO;
  const token = process.env.BACKUP_GITHUB_TOKEN;

  // Not configured yet? Report success with a warning rather than failing the
  // cron, so a half-finished setup doesn't look like an outage every week.
  if (!repo || !token) {
    return NextResponse.json({
      ok: true,
      stored: false,
      warning: "BACKUP_GITHUB_REPO / BACKUP_GITHUB_TOKEN not set; nothing was uploaded.",
      counts: payload.counts,
    });
  }

  const path = `backups/${payload.takenAt.slice(0, 10)}.json`;
  const content = Buffer.from(JSON.stringify(payload, null, 2)).toString("base64");

  const api = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Overwriting an existing same-day file needs its blob sha.
  let sha: string | undefined;
  const existing = await fetch(api, { headers, cache: "no-store" });
  if (existing.ok) sha = ((await existing.json()) as { sha?: string }).sha;

  const upload = await fetch(api, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Backup ${payload.takenAt}`,
      content,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!upload.ok) {
    const detail = await upload.text();
    return NextResponse.json(
      { ok: false, stored: false, status: upload.status, detail: detail.slice(0, 400) },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, stored: true, path, counts: payload.counts });
}
