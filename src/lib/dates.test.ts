import { describe, expect, it } from "vitest";
import { comingSaturday, SESSION_START_HOUR, toLocalInput } from "./dates";

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
