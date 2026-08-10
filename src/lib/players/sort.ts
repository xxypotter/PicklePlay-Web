/**
 * One ordering for every list of people in the app.
 *
 * `order by username` in Postgres sorts by byte value, which puts every
 * capital letter ahead of every lowercase one — so Zeng landed before fish and
 * ikun sat after Vivian. With a dozen players nobody noticed; with thirty it
 * makes a roster unscannable, because the name you're looking for is filed
 * under a rule you don't know.
 *
 * A collator gives what people actually expect: digits first, then letters
 * case-insensitively, so 18birdies leads and heyang sits between Helen and HUI.
 * Sorted in JS rather than SQL so every screen agrees regardless of the
 * database's own collation, and because these lists are dozens of rows, not
 * thousands.
 */
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Compare two usernames for display. */
export const byUsername = (a: string, b: string): number => collator.compare(a, b);

/** Sort any list of people that has a `username`, without mutating the input. */
export function sortByUsername<T extends { username: string }>(people: readonly T[]): T[] {
  return [...people].sort((a, b) => byUsername(a.username, b.username));
}
