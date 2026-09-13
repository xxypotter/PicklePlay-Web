import { describe, expect, it } from "vitest";
import { checkManualRound, type Pairing } from "./manual-round";

/** Eight people who turned up, and one who didn't. */
const HERE = new Set(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
const court = (a: string, b: string, c: string, d: string): Pairing => [a, b, c, d];

describe("checkManualRound", () => {
  it("accepts a single court", () => {
    const got = checkManualRound([court("p1", "p2", "p3", "p4")], 2, HERE);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.pairings).toEqual([["p1", "p2", "p3", "p4"]]);
  });

  it("accepts the placement round this feature exists for", () => {
    // First team against second, third against fourth — the request itself.
    const got = checkManualRound(
      [court("p1", "p2", "p3", "p4"), court("p5", "p6", "p7", "p8")],
      2,
      HERE,
    );
    expect(got.ok).toBe(true);
  });

  it("rejects an empty round", () => {
    expect(checkManualRound([], 2, HERE)).toMatchObject({
      ok: false,
      error: "err.manualNeedsCourt",
    });
  });

  it("rejects more matches than there are courts", () => {
    const got = checkManualRound(
      [court("p1", "p2", "p3", "p4"), court("p5", "p6", "p7", "p8")],
      1,
      HERE,
    );
    expect(got).toMatchObject({ ok: false, error: "err.manualTooManyCourts" });
    if (!got.ok) expect(got.values).toEqual({ courts: 1 });
  });

  it("rejects a court that isn't four people", () => {
    for (const bad of [
      ["p1", "p2", "p3"],
      ["p1", "p2", "p3", "p4", "p5"],
      ["p1", "p2", "p3", ""],
      [],
    ]) {
      expect(checkManualRound([bad], 2, HERE)).toMatchObject({
        ok: false,
        error: "err.manualIncomplete",
      });
    }
  });

  it("rejects the same player twice on one court", () => {
    expect(checkManualRound([court("p1", "p1", "p2", "p3")], 2, HERE)).toMatchObject({
      ok: false,
      error: "err.manualDuplicatePlayer",
    });
  });

  it("rejects the same player on two courts", () => {
    // Easy to do by hand and impossible to play, so it has to be caught.
    const got = checkManualRound(
      [court("p1", "p2", "p3", "p4"), court("p1", "p5", "p6", "p7")],
      2,
      HERE,
    );
    expect(got).toMatchObject({ ok: false, error: "err.manualDuplicatePlayer" });
  });

  it("rejects anyone not on tonight's roster", () => {
    /*
     * The check the client cannot be trusted to make. A perfectly shaped round
     * naming somebody who was marked out, or who belongs to another session, is
     * the case that matters — so the roster is passed in from the server.
     */
    expect(checkManualRound([court("p1", "p2", "p3", "stranger")], 2, HERE)).toMatchObject({
      ok: false,
      error: "err.manualNotAttending",
    });
  });

  it("rejects shapes the type system said were impossible", () => {
    // It is a POST endpoint; the types are a hint, not a guarantee.
    for (const junk of [null, undefined, "p1", 7, {}, [null], [[1, 2, 3, 4]]]) {
      expect(checkManualRound(junk, 2, HERE).ok).toBe(false);
    }
  });

  it("allows an empty roster to reject everything rather than throwing", () => {
    expect(checkManualRound([court("p1", "p2", "p3", "p4")], 2, new Set())).toMatchObject({
      ok: false,
      error: "err.manualNotAttending",
    });
  });
});
