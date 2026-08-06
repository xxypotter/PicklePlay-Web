"use client";

import { useState } from "react";
import LocalDateTime from "@/components/LocalDateTime";
import { useT } from "@/lib/i18n/client";

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
  const t = useT();
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
      setResult({ error: e instanceof Error ? e.message : t("admin.requestFailed") });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="card mt-5">
      <h2 className="text-sm font-medium text-[var(--muted)]">{t("admin.backup")}</h2>

      <p className="hint">
        {configured ? t("admin.backupOn") : t("admin.backupOff")}
      </p>

      <p className="mt-2 text-sm">
        {lastBackup ? (
          <>
            <span className="text-[var(--muted)]">{t("admin.lastBackup")}</span>
            <span className="font-medium">
              <LocalDateTime iso={lastBackup.iso} />
            </span>
            <span className="text-[var(--muted)]">
              {lastBackup.automatic
                ? t("admin.lastBackupAuto")
                : t("admin.lastBackupManual")}
            </span>
          </>
        ) : (
          <span className="text-[var(--muted)]">{t("admin.neverBackedUp")}</span>
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
          {running ? "…" : t("admin.checkSetup")}
        </button>
        <button
          type="button"
          onClick={() => run(false)}
          disabled={running}
          className="flex-1 rounded-xl border border-[var(--border)] px-4 py-3 text-sm
            font-semibold disabled:opacity-50"
        >
          {running ? "…" : t("admin.backupNow")}
        </button>
      </div>

      {result ? (
        <div className="mt-3 text-sm">
          {result.stored ? (
            <p className="font-medium text-[var(--success)]">
              {t("admin.savedTo", { repo: result.repo ?? "", path: result.path ?? "" })}
            </p>
          ) : result.checkOnly ? (
            <>
              <p className="font-medium text-[var(--success)]">
                {t("admin.checkOk", { repo: result.repo ?? "" })}
              </p>
              {/* "Nothing was written" read as a failure. Say what a check is. */}
              <p className="hint">{t("admin.checkOnlyNote")}</p>
            </>
          ) : (
            <>
              <p className="font-medium text-[var(--danger)]">
                {result.hint ?? result.warning ?? result.error ?? t("admin.nothingUploaded")}
              </p>
              {result.detail ? (
                <p className="hint break-all">
                  {t("admin.githubSaid", { detail: result.detail })}
                </p>
              ) : null}
            </>
          )}
          {result.counts ? (
            <p className="hint">
              {Object.entries(result.counts)
                .map(([k, v]) => t("admin.countEntry", { count: v, name: k }))
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="hint mt-3">{t("admin.pinNote")}</p>
    </section>
  );
}
