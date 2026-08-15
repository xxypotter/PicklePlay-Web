/**
 * What changed, in the players' words.
 *
 * Written for the group, not for us: each line says what someone will notice,
 * not which module moved. Newest first, and the top entry's `version` is what
 * the Me screen shows.
 *
 * Entries are dictionary keys rather than text so the notes read in whatever
 * language the player chose — a changelog nobody in the group can read is
 * worse than none.
 */
import type { DictKey } from "@/lib/i18n/dictionaries/en";

export interface Release {
  version: string;
  /** ISO date, for display only. */
  date: string;
  notes: DictKey[];
}

export const RELEASES: Release[] = [
  {
    version: "1.2",
    date: "2026-08-15",
    notes: ["notes.v12.fixedPartners", "notes.v12.balanced"],
  },
  {
    version: "1.1",
    date: "2026-08-10",
    notes: [
      "notes.v11.share",
      "notes.v11.filter",
      "notes.v11.roundRobin",
      "notes.v11.rating",
      "notes.v11.startingRating",
      "notes.v11.perMatch",
      "notes.v11.roster",
      "notes.v11.sorting",
      "notes.v11.halfLife",
      "notes.v11.howItWorks",
    ],
  },
  {
    version: "1.0",
    date: "2026-08-01",
    notes: ["notes.v10.initial"],
  },
];

export const CURRENT_VERSION = RELEASES[0].version;
