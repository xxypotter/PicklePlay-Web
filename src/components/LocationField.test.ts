import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zhHans } from "@/lib/i18n/dictionaries/zh-Hans";
import { noteForVenue, VENUES } from "./LocationField";

const KATY_NOTE = en["form.locationKatyNote"];

describe("the Katy booking note", () => {
  it("fills an empty notes box when Katy is picked", () => {
    expect(noteForVenue("Pickleball Katy", "", KATY_NOTE)).toBe(KATY_NOTE);
    expect(noteForVenue("Pickleball Katy", "   ", KATY_NOTE)).toBe(KATY_NOTE);
  });

  it("clears itself again when the venue changes", () => {
    expect(noteForVenue("ERA", KATY_NOTE, KATY_NOTE)).toBe("");
    expect(noteForVenue("", KATY_NOTE, KATY_NOTE)).toBe("");
  });

  it("never overwrites something the organizer wrote", () => {
    // The whole risk of automating this field: silently losing a real note.
    const mine = "Gate code 1234, bring a yellow ball";
    expect(noteForVenue("Pickleball Katy", mine, KATY_NOTE)).toBe(mine);
    expect(noteForVenue("ERA", mine, KATY_NOTE)).toBe(mine);
  });

  it("leaves a note that merely mentions Katy alone", () => {
    const mine = `${KATY_NOTE} — and park at the back`;
    expect(noteForVenue("ERA", mine, KATY_NOTE)).toBe(mine);
  });

  it("doesn't duplicate the note when Katy is re-picked", () => {
    expect(noteForVenue("Pickleball Katy", KATY_NOTE, KATY_NOTE)).toBe(KATY_NOTE);
  });

  it("belongs to Katy alone, not to every venue on the list", () => {
    for (const venue of VENUES.filter((v) => v !== "Pickleball Katy")) {
      expect(noteForVenue(venue, "", KATY_NOTE), venue).toBe("");
    }
  });

  /*
   * The one that only matters because the app has languages now: someone sets
   * up a session at Katy in Chinese, switches to English, then changes venue.
   * Matching only the English wording would strand the Chinese note on a
   * session that is no longer at Katy.
   */
  it("clears a note left behind in another language", () => {
    const chinese = zhHans["form.locationKatyNote"];
    expect(chinese).not.toBe(KATY_NOTE);
    expect(noteForVenue("ERA", chinese, KATY_NOTE)).toBe("");
  });
});
