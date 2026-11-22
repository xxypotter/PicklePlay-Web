"use client";

import { useEffect } from "react";
import { renewSessionAction } from "@/lib/auth/actions";

/**
 * Renews the sign-in once, in the background, when the layout says it's due.
 *
 * A Server Component can't set a cookie, so the layout renders this instead
 * and the renewal happens in a Server Action. Renders nothing; a failure just
 * means the old expiry stands and the next visit tries again.
 */
export default function SessionRenewer() {
  useEffect(() => {
    renewSessionAction().catch(() => {});
  }, []);
  return null;
}
