"use client";

import { useState } from "react";
import LocalDateTime from "@/components/LocalDateTime";

interface BackupResult {
  ok?: boolean;
  stored?: boolean;
  path?: string;
  repo?: string;
  warning?: string;
  hint?: string;
  checkOnly?: boolean;
  detail?: string;
  status?: number;
  counts?: Record<string, number>;
  error?: string;
}

/**
 * Runs the same route Vercel Cron calls weekly.
 *
 * Worth having a button: a backup you've never seen succeed isn't a backup, and
 * discovering the token is wrong on the Monday you actually need the data is
 * the worst possible time.
 */
export default function BackupCard({
  configured,
  lastBackup,
}: {
  configured: boolean;
  /** Most recent successful run, or null if it has never completed. */
  lastBackup: { iso: string; automatic: boolean } | null;
}) {
  const [result, setResult] = useState<BackupResult | null>(null);
  const [running, setRunning] = useState(false);

  async function run(checkOnly = false) {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/cron/backup${checkOnly ? "?check=1" : ""}`, {
        cache: "no-store",
      });
      setResult((await res.json()) as BackupResult);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Request failed." });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="card mt-5">
      <h2 className="text-sm font-medium text-[var(--muted)]">Backup</h2>

      <p className="hint">
        {configured
          ? "Runs automatically every Monday, and commits players, matches, and rating history to your private repo."
          : "Not switched on yet. Add BACKUP_GITHUB_REPO and BACKUP_GITHUB_TOKEN in Vercel, then redeploy."}
      </p>

      <p className="mt-2 text-sm">
        {lastBackup ? (
          <>
            <span className="text-[var(--muted)]">Last backup </span>
            <span className="font-medium">
              <LocalDateTime iso={lastBackup.iso} />
            </span>
            <span className="text-[var(--muted)]">
              {lastBackup.automatic ? " · automatic" : " · run by hand"}
            </span>
          </>
        ) : (
          <span className="text-[var(--muted)]">
            No backup has completed yet.
          </span>
        )}
      </p>

      <div className="mt-3 flex gap-2">
        {/* Check first: confirms the repo and token without writing a commit. */}
        <button
          type="button"
          onClick={() => run(true)}
          disabled={running}
          className="flex-1 rounded-xl border border-[var(--border)] px-4 py-3 text-sm
            font-semibold disabled:opacity-50"
        >
          {running ? "…" : "Check setup"}
        </button>
        <button
          type="button"
          onClick={() => run(false)}
          disabled={running}
          className="flex-1 rounded-xl border border-[var(--border)] px-4 py-3 text-sm
            font-semibold disabled:opacity-50"
        >
          {running ? "…" : "Back up now"}
        </button>
      </div>

      {result ? (
        <div className="mt-3 text-sm">
          {result.stored ? (
            <p className="font-medium text-[var(--success)]">
              Saved to {result.repo} · {result.path}
            </p>
          ) : result.checkOnly ? (
            <>
              <p className="font-medium text-[var(--success)]">
                {result.repo} is reachable and private.
              </p>
              {/* "Nothing was written" read as a failure. Say what a check is. */}
              <p className="hint">
                That was a check, not a backup — it confirms the repo and token
                work without saving anything. Use <strong>Back up now</strong> to
                actually save a copy.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-[var(--danger)]">
                {result.hint ?? result.warning ?? result.error ?? "Nothing was uploaded."}
              </p>
              {result.detail ? (
                <p className="hint break-all">GitHub said: {result.detail}</p>
              ) : null}
            </>
          )}
          {result.counts ? (
            <p className="hint">
              {Object.entries(result.counts)
                .map(([k, v]) => `${v} ${k}`)
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="hint mt-3">
        PIN hashes are never exported. A 4–6 digit PIN is trivially crackable
        offline, so restoring means admins reset PINs — ratings and match history
        are the irreplaceable part.
      </p>
    </section>
  );
}
