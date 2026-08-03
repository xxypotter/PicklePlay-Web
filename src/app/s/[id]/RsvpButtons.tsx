"use client";

import { useTransition } from "react";
import { rsvpAction } from "@/lib/sessions/actions";

export type MyState = "in" | "waitlist" | "out";

export default function RsvpButtons({
  sessionId,
  state,
  full,
}: {
  sessionId: string;
  state: MyState;
  full: boolean;
}) {
  const [pending, start] = useTransition();
  const go = (going: boolean) => start(() => void rsvpAction(sessionId, going));

  if (state === "out") {
    return (
      <button
        type="button"
        onClick={() => go(true)}
        disabled={pending}
        className="btn-primary"
      >
        {pending ? "…" : full ? "Join the waitlist" : "I'm in"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`rounded-xl px-4 py-3.5 text-center text-base font-semibold ${
          state === "in"
            ? "bg-[var(--accent)]/10 text-[var(--accent)]"
            : "border border-[var(--border)]"
        }`}
      >
        {state === "in" ? "You're in" : "You're on the waitlist"}
      </div>
      <button
        type="button"
        onClick={() => go(false)}
        disabled={pending}
        className="w-full rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-medium
          text-[var(--muted)] disabled:opacity-50"
      >
        {pending ? "…" : "Can't make it"}
      </button>
    </div>
  );
}
