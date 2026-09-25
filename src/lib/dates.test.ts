import { describe, expect, it } from "vitest";
import { comingSaturday, nextWeekly, SESSION_START_HOUR, toLocalInput } from "./dates";

/** Local-time construction, so these read the same in any timezone. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 34);

describe("comingSaturday", () => {
  it("always lands on a Saturday at 6pm", () => {
    // Walk a fortnight from a Sunday so every weekday is covered.
    for (let i = 0; i < 14; i++) {
      const result = comingSaturday(at(2026, 8, 2 + i));
      expect(result.getDay(), `day ${i}`).toBe(6);
      expect(result.getHours(), `day ${i}`).toBe(SESSION_START_HOUR);
      expect(result.getMinutes()).toBe(0);
    }
  });

  it("picks the nearest Saturday from midweek", () => {
    // Wed 5 Aug 2026 -> Sat 8 Aug.
    expect(toLocalInput(comingSaturday(at(2026, 8, 5)))).toBe("2026-08-08T18:00");
    // Fri 7 Aug -> the very next day.
    expect(toLocalInput(comingSaturday(at(2026, 8, 7)))).toBe("2026-08-08T18:00");
  });

  it("means today when it is Saturday and the slot hasn't started", () => {
    // Setting up on Saturday morning means tonight, not next week.
    expect(toLocalInput(comingSaturday(at(2026, 8, 8, 9)))).toBe("2026-08-08T18:00");
    expect(toLocalInput(comingSaturday(at(2026, 8, 8, 17)))).toBe("2026-08-08T18:00");
  });

  it("rolls to next week once Saturday's slot has started", () => {
    // 6pm exactly is already gone; there's nothing left to organize today.
    expect(toLocalInput(comingSaturday(at(2026, 8, 8, 18)))).toBe("2026-08-15T18:00");
    expect(toLocalInput(comingSaturday(at(2026, 8, 8, 22)))).toBe("2026-08-15T18:00");
  });

  it("crosses a month and a year boundary", () => {
    // Mon 28 Dec 2026 -> Sat 2 Jan 2027.
    expect(toLocalInput(comingSaturday(at(2026, 12, 28)))).toBe("2027-01-02T18:00");
  });
});

describe("toLocalInput", () => {
  it("pads every part to the shape datetime-local expects", () => {
    expect(toLocalInput(new Date(2026, 0, 3, 7, 5))).toBe("2026-01-03T07:05");
  });
});

describe("nextWeekly — copying a past session", () => {
  const SAT_6PM = at(2026, 9, 5, 18); // Saturday 5 September, 6pm

  it("lands on the coming occurrence of the same weekday and time", () => {
    // Copied on the following Tuesday: the coming Saturday, 6pm.
    const next = nextWeekly(SAT_6PM, at(2026, 9, 8, 10));
    expect(next.getDay()).toBe(6);
    expect(next.getHours()).toBe(18);
    expect(next.getMinutes()).toBe(SAT_6PM.getMinutes());
    expect(toLocalInput(next).slice(0, 10)).toBe("2026-09-12");
  });

  it("skips as many weeks as it takes, however old the session is", () => {
    // Three weeks later, a Wednesday: still just the coming Saturday.
    const next = nextWeekly(SAT_6PM, at(2026, 9, 23, 9));
    expect(toLocalInput(next).slice(0, 10)).toBe("2026-09-26");
    expect(next.getHours()).toBe(18);
  });

  it("means today when it's that weekday and the time hasn't come yet", () => {
    // Saturday morning: tonight's slot is still ahead.
    const next = nextWeekly(SAT_6PM, at(2026, 9, 12, 10));
    expect(toLocalInput(next).slice(0, 10)).toBe("2026-09-12");
  });

  it("rolls to next week once today's slot has passed", () => {
    // Saturday 8pm, after tonight's 6pm session ended.
    const next = nextWeekly(SAT_6PM, at(2026, 9, 12, 20));
    expect(toLocalInput(next).slice(0, 10)).toBe("2026-09-19");
  });

  it("is never the same slot as the session it copies", () => {
    // A session ended early, before its own start: the copy is the week after,
    // not a second session at the same time.
    const future = at(2026, 12, 5, 18);
    const next = nextWeekly(future, at(2026, 11, 1, 9));
    expect(toLocalInput(next).slice(0, 10)).toBe("2026-12-12");
  });

  it("keeps 6pm at 6pm across the end of daylight saving", () => {
    /*
     * The bug this guards: a week is 169 hours across the November change, so
     * adding seven days of milliseconds turns 6pm into 5pm. Run in the group's
     * own timezone, where the change falls on 1 November 2026.
     */
    const original = process.env.TZ;
    process.env.TZ = "America/Chicago";
    try {
      const before = new Date(2026, 9, 31, 18, 0); // Sat 31 Oct, 6pm CDT
      const next = nextWeekly(before, new Date(2026, 10, 2, 9, 0));

      // Prove the test really crosses the change, or it proves nothing.
      expect(next.getTimezoneOffset()).not.toBe(before.getTimezoneOffset());
      expect(next.getTime() - before.getTime()).toBe(169 * 3_600_000);

      expect(next.getDay()).toBe(6);
      expect(next.getHours()).toBe(18);
      expect(toLocalInput(next)).toBe("2026-11-07T18:00");
    } finally {
      process.env.TZ = original;
    }
  });
});
