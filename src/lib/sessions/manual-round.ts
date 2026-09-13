/**
 * Checking a hand-built round.
 *
 * Pure and separate from the action, because this is the part worth testing
 * exhaustively: it is the boundary between what a client claims and what goes
 * into the database. The action supplies the court count and the roster — both
 * read server-side — and this decides whether the request is a round.
 *
 * Returns the problem rather than throwing, so the caller owns the translation
 * and the tests can assert on a key instead of a sentence.
 */
import type { DictKey } from "@/lib/i18n/dictionaries/en";

export type Pairing = [string, string, string, string];

export type ManualRoundCheck =
  | { ok: true; pairings: Pairing[] }
  | { ok: false; error: DictKey; values?: Record<string, string | number> };

/**
 * `pairings` is untrusted input — anything at all may arrive here, including
 * shapes TypeScript promised were impossible, so the runtime checks stay even
 * where the type says they cannot fire.
 */
export function checkManualRound(
  pairings: unknown,
  courtCount: number,
  present: ReadonlySet<string>,
): ManualRoundCheck {
  if (!Array.isArray(pairings) || pairings.length === 0) {
    return { ok: false, error: "err.manualNeedsCourt" };
  }

  if (pairings.length > courtCount) {
    return { ok: false, error: "err.manualTooManyCourts", values: { courts: courtCount } };
  }

  // Four people or it is not a court.
  for (const match of pairings) {
    if (
      !Array.isArray(match) ||
      match.length !== 4 ||
      match.some((id) => typeof id !== "string" || id.length === 0)
    ) {
      return { ok: false, error: "err.manualIncomplete" };
    }
  }

  const flat = (pairings as Pairing[]).flat();

  // Nobody can be on two courts at once, or on both sides of one.
  if (new Set(flat).size !== flat.length) {
    return { ok: false, error: "err.manualDuplicatePlayer" };
  }

  /*
   * Every name must be on tonight's roster. A well-formed list of four ids can
   * still refer to somebody who never signed up, was marked out, or belongs to
   * another session — which is exactly the case a shape check cannot catch.
   */
  if (flat.some((id) => !present.has(id))) {
    return { ok: false, error: "err.manualNotAttending" };
  }

  return { ok: true, pairings: pairings as Pairing[] };
}
