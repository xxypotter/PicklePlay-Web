"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/types";

const initial: FormState = {};

export default function LoginForm({ next = "" }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="username">
          Your name
        </label>
        <input
          id="username"
          name="username"
          className="field"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
          spellCheck={false}
          required
          autoFocus
        />
      </div>

      <div>
        <label className="label" htmlFor="pin">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          className="field"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          autoComplete="current-password"
          minLength={4}
          maxLength={6}
          required
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Checking…" : "Log in"}
      </button>

      <p className="text-center text-sm text-[var(--muted)]">
        New here?{" "}
        <Link
          href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-[var(--accent)] underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
