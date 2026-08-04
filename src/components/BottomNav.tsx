"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import PaddleIcon from "@/components/PaddleIcon";

/**
 * Three-slot bottom bar with an elevated centre button, lifted straight from
 * the mini-program. Home and Me are plain links; the middle is the one action
 * the app is really about.
 */
export default function BottomNav({ canCreate }: { canCreate: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [denied, setDenied] = useState(false);

  const onHome = pathname === "/";
  const onMe = pathname === "/me";

  function create() {
    if (canCreate) {
      router.push("/sessions/new");
      return;
    }
    // Players get told why rather than finding a dead button, and it clears
    // itself so there's nothing to dismiss.
    setDenied(true);
    setTimeout(() => setDenied(false), 3200);
  }

  return (
    <>
      {denied ? (
        <div
          role="status"
          className="fixed inset-x-0 z-40 mx-auto max-w-md px-6"
          style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
        >
          <p className="rounded-xl bg-black/85 px-4 py-3 text-center text-sm text-white shadow-lg">
            Only an admin can create an event. Ask your organizer to set one up.
          </p>
        </div>
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid h-16 w-full max-w-md grid-cols-3 items-center">
          <Link href="/" className="flex flex-col items-center gap-0.5">
            <PaddleIcon
              size={22}
              className={onHome ? "text-[var(--accent)]" : "text-[var(--muted)]"}
            />
            <span className={`text-[11px] ${onHome ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>
              Home
            </span>
          </Link>

          <div className="flex flex-col items-center gap-0.5">
            <button
              type="button"
              onClick={create}
              aria-label="Create event"
              className={`-mt-7 flex size-14 items-center justify-center rounded-full text-3xl
                font-light text-white shadow-lg transition active:scale-95 ${
                  canCreate ? "bg-[var(--amber)]" : "bg-[var(--muted)]"
                }`}
            >
              +
            </button>
            <span className="text-[11px] text-[var(--muted)]">Create</span>
          </div>

          <Link href="/me" className="flex flex-col items-center gap-0.5">
            <span className={`text-[19px] leading-none ${onMe ? "" : "opacity-40 grayscale"}`}>
              👤
            </span>
            <span className={`text-[11px] ${onMe ? "font-semibold text-[var(--accent)]" : "text-[var(--muted)]"}`}>
              Me
            </span>
          </Link>
        </div>
      </nav>
    </>
  );
}
