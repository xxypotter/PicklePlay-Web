import { describe, expect, it } from "vitest";
import { byUsername, sortByUsername } from "./sort";

/** The real production roster, which is what made the old ordering unusable. */
const REAL = [
  "18birdies", "Chuck", "Daniel", "HUI", "Hao", "HappyX", "Helen", "Jason", "Sam",
  "SummerX", "Yang", "zhaoqian123", "ikun", "Rain", "Bryant", "Dong", "Rongdou",
  "fish", "robin", "heyang", "Zeng", "LyuYK", "ProfWu", "Nathan", "JudyH",
];

describe("player ordering", () => {
  it("puts numbers before letters", () => {
    expect(byUsername("18birdies", "Chuck")).toBeLessThan(0);
    expect(byUsername("7up", "aaron")).toBeLessThan(0);
  });

  it("ignores case, so a lowercase name isn't exiled to the end", () => {
    // The old byte-order sort put every capital ahead of every lowercase, so
    // Zeng came before fish and ikun sat after Vivian.
    expect(byUsername("fish", "Hao")).toBeLessThan(0);
    expect(byUsername("Zeng", "fish")).toBeGreaterThan(0);
    expect(byUsername("ikun", "Jason")).toBeLessThan(0);
  });

  it("orders the real roster the way a person would read it", () => {
    const sorted = sortByUsername(REAL.map((username) => ({ username }))).map(
      (p) => p.username,
    );
    expect(sorted.slice(0, 8)).toEqual([
      "18birdies", "Bryant", "Chuck", "Daniel", "Dong", "fish", "Hao", "HappyX",
    ]);
    // The three that byte order got wrong, now filed where you'd look.
    expect(sorted.indexOf("heyang")).toBeGreaterThan(sorted.indexOf("Helen"));
    expect(sorted.indexOf("heyang")).toBeLessThan(sorted.indexOf("HUI"));
    expect(sorted.indexOf("zhaoqian123")).toBe(sorted.length - 1);
  });

  it("sorts digit runs numerically rather than as text", () => {
    const sorted = sortByUsername(
      ["player10", "player2", "player1"].map((username) => ({ username })),
    ).map((p) => p.username);
    expect(sorted).toEqual(["player1", "player2", "player10"]);
  });

  it("does not mutate the caller's array", () => {
    const input = [{ username: "Zed" }, { username: "Amy" }];
    const copy = [...input];
    sortByUsername(input);
    expect(input).toEqual(copy);
  });
});
