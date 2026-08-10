import TopBar, { safeFrom } from "@/components/TopBar";
import { getCurrentPlayer } from "@/lib/auth/session";
import { titleFor } from "@/lib/i18n/metadata";
import { getT } from "@/lib/i18n/server";
import { CURRENT_VERSION, RELEASES } from "@/lib/release-notes";

export const generateMetadata = titleFor("notes.title");

export default async function ReleaseNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const me = await getCurrentPlayer();
  const t = await getT(me?.locale);

  return (
    <>
      <TopBar title={t("notes.title")} back={safeFrom(from, "/me")} />
      <main className="screen pt-4">
        {RELEASES.map((release) => (
          <section key={release.version} className="card mb-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-bold">
                {t("me.version", { version: release.version })}
              </h2>
              <span className="shrink-0 text-xs text-[var(--muted)]">{release.date}</span>
            </div>

            {release.version === CURRENT_VERSION ? (
              <span className="mt-1 inline-block rounded-full bg-[var(--accent-soft)] px-2 py-0.5
                text-[11px] font-semibold text-[var(--accent)]">
                {t("notes.current")}
              </span>
            ) : null}

            <ul className="mt-3 flex flex-col gap-2.5">
              {release.notes.map((key) => (
                <li key={key} className="flex gap-2 text-sm">
                  <span className="shrink-0 text-[var(--accent)]">•</span>
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
