"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/lib/auth/actions";
import type { FormState } from "@/lib/auth/types";
import { useT } from "@/lib/i18n/client";

const initial: FormState = {};

export default function LoginForm({ next = "" }: { next?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label className="label" htmlFor="username">
          {t("auth.usernameLogin")}
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
          {t("auth.pin")}
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
        {pending ? t("auth.checking") : t("auth.login")}
      </button>

      <p className="text-center text-sm text-[var(--muted)]">
        {t("auth.needAccount")}{" "}
        <Link
          href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-[var(--accent)] underline"
        >
          {t("auth.register")}
        </Link>
      </p>
    </form>
  );
}
