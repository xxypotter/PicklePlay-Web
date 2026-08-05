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
import { auditLog, matches, players, ratingSeeds, sessions, signups } from "@/lib/db/schema";
import { closeStaleSessions } from "@/lib/sessions/auto-close";

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
  /*
   * Vercel Cron presents the secret; the owner can also trigger it by hand to
   * confirm the whole path works rather than waiting a week to find out.
   *
   * Superadmin rather than any admin: the response says whether the deploy is
   * holding a working GitHub token and which private repo it writes to, and
   * the manual run publishes the group's data on demand.
   */
  const byCron = secretMatches(request.headers.get("authorization"));
  const me = byCron ? null : await getCurrentPlayer();
  const authorized = byCron || (!!me && isAtLeast(me.role, "superadmin"));

  if (!authorized) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const db = getDb();

  // Backstop for the lazy sweep on page loads: if nobody opens the app for a
  // few days, stale sessions still get closed.
  const autoClosed = await closeStaleSessions();

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
    autoClosedSessions: autoClosed,
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

  // Serialize before the configuration check, so a value that can't be encoded
  // fails loudly on every run rather than only once credentials are added.
  const path = `backups/${payload.takenAt.slice(0, 10)}.json`;
  const json = JSON.stringify(payload, null, 2);
  const content = Buffer.from(json).toString("base64");

  const repo = process.env.BACKUP_GITHUB_REPO;
  const token = process.env.BACKUP_GITHUB_TOKEN;

  // Not configured yet? Report success with a warning rather than failing the
  // cron, so a half-finished setup doesn't look like an outage every week.
  if (!repo || !token) {
    return NextResponse.json({
      ok: true,
      stored: false,
      warning: "BACKUP_GITHUB_REPO / BACKUP_GITHUB_TOKEN not set; nothing was uploaded.",
      bytes: json.length,
      counts: payload.counts,
    });
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  /*
   * Look the repository up before writing anything.
   *
   * Two reasons. It separates a wrong repo name from a token that can't see the
   * repo — GitHub returns 404 for both on the contents API, which makes the
   * failure impossible to diagnose. And it reveals whether the destination is
   * public.
   *
   * A backup carries every player's name and full match history. Committing it
   * to a public repository would publish that permanently, since deleting the
   * file later doesn't remove it from git history. So a public destination is
   * refused outright rather than assumed to be deliberate.
   */
  const meta = await fetch(`https://api.github.com/repos/${repo}`, {
    headers,
    cache: "no-store",
  });

  if (!meta.ok) {
    return NextResponse.json(
      {
        ok: false,
        stored: false,
        repo,
        status: meta.status,
        hint:
          meta.status === 404
            ? `The token can't see ${repo}. Either the name is wrong or the token's ` +
              `repository access doesn't list it — GitHub returns 404 for both.`
            : `GitHub refused to read ${repo} (${meta.status}).`,
      },
      { status: 502 },
    );
  }

  const info = (await meta.json()) as { private?: boolean; full_name?: string };
  const fullName = info.full_name ?? repo;

  if (!info.private) {
    return NextResponse.json(
      {
        ok: false,
        stored: false,
        repo: fullName,
        hint:
          `${fullName} is a PUBLIC repository. Backups contain every player's name ` +
          `and match history, so nothing was uploaded. Point BACKUP_GITHUB_REPO at ` +
          `a private repo.`,
      },
      { status: 409 },
    );
  }

  // Read-only probe: confirms the setup without producing a commit.
  if (new URL(request.url).searchParams.get("check")) {
    return NextResponse.json({
      ok: true,
      stored: false,
      checkOnly: true,
      repo: fullName,
      private: true,
      wouldWrite: path,
      counts: payload.counts,
    });
  }

  const api = `https://api.github.com/repos/${repo}/contents/${path}`;

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

    /*
     * GitHub answers 404 rather than 403 when a token can't see a repository,
     * so "Not Found" can't be told apart from "no access" by the status alone.
     * Echo the repo and path we tried — a typo in BACKUP_GITHUB_REPO looks
     * identical to a permissions problem until you can see the string.
     * The token itself is never included.
     */
    const hint =
      upload.status === 404
        ? `Could not reach ${repo}. Either the name is wrong, or the token has no ` +
          `access to it — check the token lists this repository and has ` +
          `Contents: Read and write.`
        : upload.status === 403
          ? `${repo} refused the write. The token likely has Contents: Read-only.`
          : undefined;

    return NextResponse.json(
      {
        ok: false,
        stored: false,
        status: upload.status,
        repo,
        path,
        hint,
        detail: detail.slice(0, 300),
      },
      { status: 502 },
    );
  }

  /*
   * Record the run. A backup you can't confirm ran is barely a backup — this
   * is what lets the admin page answer "when did this last work?" rather than
   * leaving the weekly cron to fail silently for a month.
   *
   * actorId is null for the cron, which is also how we tell the two apart.
   */
  await db.insert(auditLog).values({
    actorId: me?.id ?? null,
    action: "backup.run",
    detail: Object.entries(payload.counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(" · "),
  });

  return NextResponse.json({ ok: true, stored: true, path, counts: payload.counts });
}
