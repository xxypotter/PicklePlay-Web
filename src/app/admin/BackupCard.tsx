"use client";

import { useState } from "react";

interface BackupResult {
  ok?: boolean;
  stored?: boolean;
  path?: string;
  repo?: string;
  warning?: string;
  hint?: string;
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
export default function BackupCard({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<BackupResult | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/cron/backup", { cache: "no-store" });
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

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="mt-3 w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm
          font-semibold disabled:opacity-50"
      >
        {running ? "Backing up…" : "Back up now"}
      </button>

      {result ? (
        <div className="mt-3 text-sm">
          {result.stored ? (
            <p className="font-medium text-[var(--success)]">
              Saved to {result.repo} · {result.path}
            </p>
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
