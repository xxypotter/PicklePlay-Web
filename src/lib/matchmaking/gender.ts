/**
 * Gender-balanced play — keeping two men off the other side of the net from
 * two women.
 *
 * The rule is about the *matchup*, not the team: MM against MM is fine, FF
 * against FF is fine, anything with a mixed team is fine. Only MM facing FF is
 * out, because that is the one arrangement that turns a social round robin into
 * a battle of the sexes.
 *
 * Where it gets enforced matters. By the time a round's teams are decided the
 * rule is not yet lost — a round holding both an all-male and an all-female
 * pair is fine so long as they aren't put across the net from each other. So
 * the constraint lives in the step that chooses who faces whom, and partner
 * rotation is never spent on it. That is what lets both of this format's
 * priorities hold at once rather than trading against each other.
 *
 * Pure and index-based like the rest of the planner: no database, no players.
 */
import type { PlannedRound } from "./schedule";

export type Gender = "male" | "female" | "unspecified";

/**
 * The gender of a *team*, or null if it doesn't have one.
 *
 * A team only counts as men or women when both players are that gender and
 * have said so. Anyone who left it unspecified makes their team neutral, which
 * is what we want: an unrecorded gender should never be guessed at, and a
 * neutral team can be put anywhere without breaking the rule.
 */
const teamGender = (x: Gender, y: Gender): Gender | null =>
  x === y && x !== "unspecified" ? x : null;

/** Two men against two women — the one arrangement this format exists to stop. */
export function matchViolates(a1: Gender, a2: Gender, b1: Gender, b2: Gender): boolean {
  const a = teamGender(a1, a2);
  const b = teamGender(b1, b2);
  return a !== null && b !== null && a !== b;
}

/**
 * How many courts in this schedule break the rule.
 *
 * `genders` is indexed by seat, which is how the planner sees the world.
 *
 * Zero is not always reachable, and the planner reports what it managed rather
 * than pretending. Ten men and two women who each partner everyone once must
 * eventually pair the two women, and their opponents can then only be two men —
 * the rule and a complete partner rotation genuinely cannot both hold. The
 * organizer is told, rather than being given a draw that quietly breaks the
 * promise the format makes.
 */
export function countViolations(
  schedule: PlannedRound[],
  genders: readonly Gender[],
): number {
  let n = 0;
  for (const round of schedule) {
    for (const [a1, a2, b1, b2] of round) {
      if (matchViolates(genders[a1], genders[a2], genders[b1], genders[b2])) n++;
    }
  }
  return n;
}
