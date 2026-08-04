import { describe, expect, it } from "vitest";
import { KATY_NOTE, noteForVenue, VENUES } from "./LocationField";

describe("the Katy booking note", () => {
  it("fills an empty notes box when Katy is picked", () => {
    expect(noteForVenue("Pickleball Katy", "")).toBe(KATY_NOTE);
    expect(noteForVenue("Pickleball Katy", "   ")).toBe(KATY_NOTE);
  });

  it("clears itself again when the venue changes", () => {
    expect(noteForVenue("ERA", KATY_NOTE)).toBe("");
    expect(noteForVenue("", KATY_NOTE)).toBe("");
  });

  it("never overwrites something the organizer wrote", () => {
    // The whole risk of automating this field: silently losing a real note.
    const mine = "Gate code 1234, bring a yellow ball";
    expect(noteForVenue("Pickleball Katy", mine)).toBe(mine);
    expect(noteForVenue("ERA", mine)).toBe(mine);
  });

  it("leaves a note that merely mentions Katy alone", () => {
    const mine = `${KATY_NOTE} — and park at the back`;
    expect(noteForVenue("ERA", mine)).toBe(mine);
  });

  it("doesn't duplicate the note when Katy is re-picked", () => {
    expect(noteForVenue("Pickleball Katy", KATY_NOTE)).toBe(KATY_NOTE);
  });

  it("belongs to Katy alone, not to every venue on the list", () => {
    for (const venue of VENUES.filter((v) => v !== "Pickleball Katy")) {
      expect(noteForVenue(venue, ""), venue).toBe("");
    }
  });
});
