"use client";

import { useState } from "react";
import { rotateInviteCodeAction } from "./actions";

export default function InviteCard({
  code,
  origin,
  canRotate,
}: {
  code: string | null;
  origin: string;
  /** Rotating locks out anyone mid-signup, so it belongs to the owner. */
  canRotate: boolean;
}) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const link = code ? `${origin}/register?code=${code}` : "";

  async function copy(text: string, what: "link" | "code") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard is blocked on insecure origins; the value is on screen anyway.
    }
  }

  return (
    <section className="card">
      <h2 className="text-sm font-medium text-[var(--muted)]">Group invite code</h2>

      {code ? (
        <>
          <p className="mt-2 font-mono text-4xl font-bold tracking-[0.15em] tabular-nums">
            {code}
          </p>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => copy(link, "link")}
              className="btn-primary"
            >
              {copied === "link" ? "Copied!" : "Copy invite link"}
            </button>
            <button
              type="button"
              onClick={() => copy(code, "code")}
              className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-medium"
            >
              {copied === "code" ? "Copied!" : "Copy just the code"}
            </button>
          </div>

          <p className="hint mt-4 break-all">{link}</p>
          <p className="hint">
            Paste the link into your group chat — it fills the code in for them. Anyone
            without it can&apos;t register.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[var(--danger)]">
          No code set, so registration is closed. Generate one below.
        </p>
      )}

      {canRotate ? (
      <form action={rotateInviteCodeAction} className="mt-6 border-t border-[var(--border)] pt-5">
        <button
          type="submit"
          className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-medium
            text-[var(--muted)]"
        >
          {code ? "Generate a new code" : "Generate a code"}
        </button>
        {code ? (
          <p className="hint">
            Rotating stops all new signups immediately. Existing accounts are unaffected.
          </p>
        ) : null}
      </form>
      ) : null}
    </section>
  );
}
