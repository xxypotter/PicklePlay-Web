import { describe, expect, it } from "vitest";
import { copyRoster, copySourceFrom, pairsCarryOver, teamsCarryOver, type CopiedTeam, type CopyableSession } from "./copy";

const base: CopyableSession = {
  title: "Sunday Round Robin",
  location: "ERA",
  startsAt: new Date("2026-09-20T23:00:00.000Z"),
  courtNames: ["3", "7"],
  maxPlayers: 9,
  format: "regular",
  notes: "Bring water",
  rated: true,
  isPrivate: false,
};

describe("copySourceFrom", () => {
  it("carries Mini MLP mixed-opponent mode while legacy/new settings default to aligned",()=>{
    expect(copySourceFrom({...base,format:"mlp",mlpRandomMixed:true},false).mlpRandomMixed).toBe(true);
    expect(copySourceFrom({...base,format:"mlp"},false).mlpRandomMixed).toBe(false);
    expect(copySourceFrom({...base,mlpRandomMixed:true},false).mlpRandomMixed).toBeUndefined();
  });
  it.each([5,6])("preserves %i Mini MLP courts while other formats retain their four-court cap", count => {
    const courtNames=Array.from({length:count},(_,i)=>String(i+1));
    expect(copySourceFrom({...base,format:"mlp",courtNames,maxPlayers:24},false).courts).toBe(courtNames.join(", "));
    expect(copySourceFrom({...base,courtNames},false).courts).toBe("1, 2, 3, 4");
  });
  it("carries over the setup exactly", () => {
    expect(copySourceFrom(base, false)).toEqual({
      title: "Sunday Round Robin",
      location: "ERA",
      startsAt: "2026-09-20T23:00:00.000Z",
      courts: "3, 7",
      maxPlayers: 9,
      format: "regular",
      notes: "Bring water",
      rated: true,
      isPrivate: false,
    });
  });

  it("has nowhere to put players — a copy never carries the sign-ups", () => {
    // The type is the guarantee; this pins it so nobody adds them back.
    expect(Object.keys(copySourceFrom(base, true))).not.toContain("invited");
    expect(Object.keys(copySourceFrom(base, true))).not.toContain("signups");
  });

  it("keeps a one-off location and a casual night as they were", () => {
    const got = copySourceFrom(
      { ...base, location: "Dan's backyard", rated: false, notes: null },
      false,
    );
    expect(got.location).toBe("Dan's backyard");
    expect(got.rated).toBe(false);
    expect(got.notes).toBe("");
  });

  it("clamps a capacity that was raised past what the courts allow", () => {
    // Two courts take twelve. A latecomer pushed this night to thirteen.
    expect(copySourceFrom({ ...base, maxPlayers: 13 }, false).maxPlayers).toBe(12);
    expect(copySourceFrom({ ...base, maxPlayers: 12 }, false).maxPlayers).toBe(12);
    expect(copySourceFrom({ ...base, maxPlayers: 2 }, false).maxPlayers).toBe(4);
  });

  it("falls back to the regular round robin for a format no longer offered", () => {
    expect(copySourceFrom({ ...base, format: "king" }, false).format).toBe("regular");
    expect(copySourceFrom({ ...base, format: "fixed" }, false).format).toBe("fixed");
    expect(copySourceFrom({ ...base, format: "gender" }, false).format).toBe("gender");
  });

  it("copies 'private' only for someone allowed to make one", () => {
    const secret = { ...base, isPrivate: true };
    expect(copySourceFrom(secret, true).isPrivate).toBe(true);
    expect(copySourceFrom(secret, false).isPrivate).toBe(false);
  });
});

describe("copy with players", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 20, 23, minute));

  it("copies everyone signed up: confirmed by join time, then the waitlist in queue order", () => {
    expect(copyRoster([
      { playerId: "w2", state: "waitlist", waitlistPos: 2, createdAt: at(1) },
      { playerId: "late", state: "in", waitlistPos: null, createdAt: at(9) },
      { playerId: "gone", state: "out", waitlistPos: null, createdAt: at(0) },
      { playerId: "early", state: "in", waitlistPos: null, createdAt: at(2) },
      { playerId: "w1", state: "waitlist", waitlistPos: 1, createdAt: at(8) },
    ])).toEqual(["early", "late", "w1", "w2"]);
  });

  // Four teams of four; team i is players i0..i3.
  const teams: CopiedTeam[] = Array.from({ length: 4 }, (_, i) => ({
    name: `Team ${i + 1}`,
    m1: `${i}a`, w1: `${i}b`, m2: `${i}c`, w2: `${i}d`,
    women1: `${i}b`, women2: `${i}d`, men1: `${i}a`, men2: `${i}c`,
  }));
  const everyone = teams.flatMap((t) => [t.m1, t.w1, t.m2, t.w2]);

  it("keeps Mini MLP teams only when every team is whole among the confirmed players", () => {
    expect(teamsCarryOver(teams, "mlp", 16, everyone)).toBe(true);
    // Order doesn't matter, and extra people beyond capacity only queue.
    expect(teamsCarryOver(teams, "mlp", 16, [...everyone].reverse())).toBe(true);
    expect(teamsCarryOver(teams, "mlp", 16, [...everyone, "extra"])).toBe(true);
    // One player unticked: nothing is kept, because a draw needs every team whole.
    expect(teamsCarryOver(teams, "mlp", 16, everyone.slice(1))).toBe(false);
    // A team member pushed to the waitlist by someone new ahead of them.
    expect(teamsCarryOver(teams, "mlp", 16, ["new", ...everyone])).toBe(false);
    // Format or team count changed.
    expect(teamsCarryOver(teams, "regular", 16, everyone)).toBe(false);
    expect(teamsCarryOver(teams, "mlp", 20, everyone)).toBe(false);
    expect(teamsCarryOver(undefined, "mlp", 16, everyone)).toBe(false);
  });

  it("keeps each fixed pair whose two players are both confirmed", () => {
    const pairs: Array<[string, string]> = [["a", "b"], ["c", "d"], ["e", "f"]];
    expect(pairsCarryOver(pairs, "fixed", 8, ["a", "b", "c", "d", "e", "f"])).toEqual(pairs);
    expect(pairsCarryOver(pairs, "fixed", 8, ["a", "b", "c", "e", "f"])).toEqual([["a", "b"], ["e", "f"]]);
    // f is sixth, past a capacity of five, so on the waitlist and unpaired.
    expect(pairsCarryOver(pairs, "fixed", 5, ["a", "b", "c", "d", "e", "f"])).toEqual([["a", "b"], ["c", "d"]]);
    expect(pairsCarryOver(pairs, "regular", 8, ["a", "b"])).toEqual([]);
    // Never the same player in two pairs, nor paired with themselves.
    expect(pairsCarryOver([["a", "b"], ["b", "c"], ["d", "d"]], "fixed", 8, ["a", "b", "c", "d"])).toEqual([["a", "b"]]);
  });
});
