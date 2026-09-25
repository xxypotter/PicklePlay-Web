import { describe, expect, it } from "vitest";
import { copySourceFrom, type CopyableSession } from "./copy";

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
