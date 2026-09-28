import { describe, expect, it } from "vitest";
import { matchPlayers } from "./search";
import { sortByUsername } from "./sort";

const roster = sortByUsername(
  ["18birdies", "Chuck", "HUI", "Hao", "HappyX", "Helen", "SummerX", "heyang", "José", "张伟", "ikun"]
    .map((username) => ({ username })),
);
const names = (q: string) => matchPlayers(roster, q).map((p) => p.username);

describe("player search", () => {
  it("returns everyone, in order, when nothing is typed", () => {
    expect(names("")).toEqual(roster.map((p) => p.username));
    expect(names("   ")).toEqual(roster.map((p) => p.username));
  });

  it("ignores case and surrounding spaces", () => {
    expect(names("hui")).toEqual(["HUI"]);
    expect(names(" HUI ")).toEqual(["HUI"]);
  });

  it("puts names that start with the letters first, then any other match", () => {
    expect(names("h")).toEqual(["Hao", "HappyX", "Helen", "heyang", "HUI", "Chuck"]);
    expect(names("x")).toEqual(["HappyX", "SummerX"]);
  });

  it("matches accents, full-width letters, digits and Chinese names", () => {
    expect(names("jose")).toEqual(["José"]);
    expect(names("ＨＵＩ")).toEqual(["HUI"]);
    expect(names("18")).toEqual(["18birdies"]);
    expect(names("伟")).toEqual(["张伟"]);
  });

  it("finds nobody for a name that isn't there, without touching the input", () => {
    expect(names("zz")).toEqual([]);
    expect(roster).toHaveLength(11);
  });
});
