import LocalDateTime from "@/components/LocalDateTime";
import type { DictKey } from "@/lib/i18n/dictionaries/en";
import type { T } from "@/lib/i18n/translate";

export interface DeletionEntry {
  id: string;
  at: Date;
  actor: string | null;
  /** The audit row's `detail`, as stored — JSON, or null for older rows. */
  detail: string | null;
}

interface Detail {
  title: string;
  startsAt: string;
  format: string;
  played: number;
}

/** Older deletions were logged with nothing but an id; say so, don't guess. */
function parse(detail: string | null): Detail | null {
  if (!detail) return null;
  try {
    const d = JSON.parse(detail) as Partial<Detail>;
    return typeof d.title === "string" && typeof d.startsAt === "string"
      ? { title: d.title, startsAt: d.startsAt, format: d.format ?? "", played: d.played ?? 0 }
      : null;
  } catch {
    return null;
  }
}

/**
 * Which sessions were deleted, by whom, and what was in them.
 *
 * Super admin only — the page renders this for nobody else. A deleted session
 * leaves nothing behind to look at, so this is the only record that it existed:
 * the answer to "where did last Saturday go?", and to whether a session that
 * had real results in it was thrown away.
 */
export default function DeletedSessions({ entries, t }: { entries: DeletionEntry[]; t: T }) {
  return (
    <section className="card mt-5">
      <h2 className="text-sm font-medium text-[var(--muted)]">{t("admin.deletedTitle")}</h2>

      {entries.length === 0 ? (
        <p className="hint">{t("admin.deletedEmpty")}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-[var(--border)]">
          {entries.map((e) => {
            const d = parse(e.detail);
            return (
              <li key={e.id} className="py-2">
                {d ? (
                  <>
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="text-xs text-[var(--muted)]">
                      <LocalDateTime iso={d.startsAt} withWeekday={false} />
                      {d.format ? ` · ${t(`format.short.${d.format}` as DictKey)}` : ""}
                      {" · "}
                      <span className={d.played > 0 ? "font-semibold text-[var(--danger)]" : ""}>
                        {t("admin.deletedPlayed", { count: d.played })}
                      </span>
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-[var(--muted)]">{t("admin.deletedUnknown")}</p>
                )}
                <p className="text-[11px] text-[var(--muted)]">
                  {t("admin.deletedBy", { name: e.actor ?? t("common.none") })}
                  {" · "}
                  <LocalDateTime iso={e.at.toISOString()} withWeekday={false} />
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="hint mt-2">{t("admin.deletedHint")}</p>
    </section>
  );
}
