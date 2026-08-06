"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

export default function ShareLink({ url, title }: { url: string; title: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function share() {
    // Native share sheet on a phone drops it straight into the group chat;
    // clipboard is the desktop fallback.
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User dismissed the sheet — fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked on insecure origins; the URL is visible anyway.
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-medium"
    >
      {copied ? t("session.linkCopied") : t("session.share")}
    </button>
  );
}
