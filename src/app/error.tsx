"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";

/**
 * The page that shows when a render or an un-caught action fails.
 *
 * Without this Next shows its own blank "Application error" screen, which
 * reads as the app being broken when it is usually one tap that went wrong.
 * Nothing on the server is lost in either case; this one just says so and
 * offers the two things that help — try the same thing again, or go home.
 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <main className="screen flex flex-1 flex-col items-center justify-center py-16 text-center">
      <p className="text-4xl">🏓</p>
      <h1 className="mt-4 text-xl font-bold">{t("error.title")}</h1>
      <p className="hint mt-2 max-w-xs">{t("error.body")}</p>
      <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
        <button type="button" onClick={reset} className="btn-primary">{t("error.retry")}</button>
        <Link href="/" className="btn-ghost text-center">{t("nav.home")}</Link>
      </div>
    </main>
  );
}
