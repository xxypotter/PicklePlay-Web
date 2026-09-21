import { describe, expect, it } from "vitest";
import {
  byFormat,
  closeGames,
  form,
  lineOf,
  MIN_GROUP,
  strengthSplit,
  verdict,
  type InsightMatch,
} from "./insights";

let day = 0;
/** One game from the player's side. Ratings are team averages before it. */
const g = (
  scoreFor: number,
  scoreAgainst: number,
  ours: number | null = 3.5,
  theirs: number | null = 3.5,
  format: string | null = "regular",
): InsightMatch => ({
  playedAt: new Date(Date.UTC(2026, 7, 1) + day++ * 86_400_000),
  won: scoreFor > scoreAgainst,
  scoreFor,
  scoreAgainst,
  format,
  ours,
  theirs,
});

const times = (n: number, make: () => InsightMatch) => Array.from({ length: n }, make);

describe("lineOf", () => {
  it("compares actual and expected share over the same rated games", () => {
    const line = lineOf([g(11, 9), g(9, 11), g(11, 9, null, null)]);
    expect(line.games).toBe(3);
    expect(line.wins).toBe(2);
    // The casual game counts toward W–L but not toward the expectation.
    expect(line.rated?.games).toBe(2);
    expect(line.rated?.expected).toBeCloseTo(0.5, 10);
    expect(line.rated?.actual).toBeCloseTo(0.5, 10);
  });

  it("has no expectation for a group of casual games only", () => {
    expect(lineOf([g(11, 5, null, null)]).rated).toBeNull();
  });
});

describe("verdict", () => {
  it("calls a result above, below or about its expectation", () => {
    // Even teams: expected 50% of the points.
    expect(verdict(lineOf(times(5, () => g(11, 7))))).toBe("above");
    expect(verdict(lineOf(times(5, () => g(7, 11))))).toBe("below");
    expect(verdict(lineOf([g(11, 10), g(10, 11)]))).toBe("about");
  });

  it("does not call losing to a much stronger team bad play", () => {
    /*
     * The reason the page measures against expectation at all. Losing 7-11 to
     * a team rated a full point higher is better than the ratings predicted,
     * and the verdict has to say so even though every game was a loss.
     */
    const line = lineOf(times(5, () => g(7, 11, 3.0, 4.0)));
    expect(line.wins).toBe(0);
    expect(verdict(line)).toBe("above");
  });
});

describe("strengthSplit", () => {
  it("groups by whose team was rated higher", () => {
    const split = strengthSplit([
      ...times(5, () => g(8, 11, 3.0, 3.6)), // opponents stronger
      ...times(5, () => g(11, 9, 3.5, 3.5)), // even
      ...times(5, () => g(11, 4, 3.8, 3.2)), // opponents weaker
    ])!;
    expect(split.stronger?.games).toBe(5);
    expect(split.even?.games).toBe(5);
    expect(split.weaker?.games).toBe(5);
    expect(split.stronger?.wins).toBe(0);
    expect(split.weaker?.wins).toBe(5);
  });

  it("hides a group with too few games rather than showing noise", () => {
    const split = strengthSplit([
      ...times(MIN_GROUP, () => g(11, 9)),
      ...times(MIN_GROUP - 1, () => g(8, 11, 3.0, 3.6)),
    ])!;
    expect(split.even).not.toBeNull();
    expect(split.stronger).toBeNull();
  });

  it("is null when nothing qualifies", () => {
    expect(strengthSplit(times(3, () => g(11, 9)))).toBeNull();
  });

  it("ignores casual games, which have no ratings to compare", () => {
    expect(strengthSplit(times(10, () => g(11, 9, null, null)))).toBeNull();
  });
});

describe("form", () => {
  it("needs enough games for both halves to mean something", () => {
    expect(form(times(11, () => g(11, 9)))).toBeNull();
    expect(form(times(12, () => g(11, 9)))).not.toBeNull();
  });

  it("compares the last ten with everything before", () => {
    const f = form([...times(20, () => g(5, 11)), ...times(10, () => g(11, 5))])!;
    expect(f.recent.games).toBe(10);
    expect(f.earlier.games).toBe(20);
    expect(f.recent.wins).toBe(10);
    expect(f.trend).toBe("up");
  });

  it("uses halves when the record is short", () => {
    const f = form(times(12, () => g(11, 9)))!;
    expect(f.recent.games).toBe(6);
    expect(f.earlier.games).toBe(6);
    expect(f.trend).toBe("flat");
  });

  it("reads the order from the dates, not the order it was given", () => {
    const early = times(10, () => g(11, 5));
    const late = times(10, () => g(5, 11));
    expect(form([...late, ...early])!.trend).toBe("down");
  });
});

describe("byFormat", () => {
  it("shows formats only where there is a comparison to make", () => {
    // One format alone is just the overall record again.
    expect(byFormat(times(10, () => g(11, 9, 3.5, 3.5, "regular")))).toBeNull();

    const rows = byFormat([
      ...times(8, () => g(11, 9, 3.5, 3.5, "regular")),
      ...times(5, () => g(7, 11, 3.5, 3.5, "fixed")),
      ...times(3, () => g(11, 2, 3.5, 3.5, "gender")), // too few to show
    ])!;
    expect(rows.map((r) => r.format)).toEqual(["regular", "fixed"]);
  });
});

describe("closeGames", () => {
  it("counts games decided by two points or fewer, against the whole record", () => {
    const c = closeGames([g(11, 9), g(9, 11), g(12, 10), g(10, 12), g(11, 3), g(11, 2)])!;
    expect(c.games).toBe(4);
    expect(c.wins).toBe(2);
    expect(c.overall).toBeCloseTo(4 / 6, 10);
  });

  it("is null with too few close games to say anything", () => {
    expect(closeGames([g(11, 9), g(11, 3), g(11, 2)])).toBeNull();
  });
});
