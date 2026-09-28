/**
 * Narrow a player list to the names an organizer is typing.
 *
 * With a hundred-odd players the pickers became a long scroll to find one
 * name. Matching is on any part of the name, ignoring case, accents and
 * full-width letters (what a Chinese keyboard produces in full-width mode),
 * so "hui", "HUI" and "ＨＵＩ" all find HUI. Names that start with what was
 * typed come first; otherwise the list keeps its own order, so results read
 * in the same alphabetical order as the full list.
 */
const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function matchPlayers<T extends { username: string }>(people: readonly T[], query: string): T[] {
  const q = fold(query.trim());
  if (!q) return [...people];
  const starts: T[] = [], contains: T[] = [];
  for (const p of people) {
    const name = fold(p.username);
    if (name.startsWith(q)) starts.push(p);
    else if (name.includes(q)) contains.push(p);
  }
  return [...starts, ...contains];
}
