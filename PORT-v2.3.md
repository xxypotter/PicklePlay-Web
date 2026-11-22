# PicklePlay v2.3 — independent iOS app handoff

Read PORT.md (updated in place: layout notes on "Your own name"). One display
change; no data, rating or permission changes.

- Matchups no longer prints "You (username)". The signed-in player's username
  is shown as is, bold in the accent colour, on score cards, voided rows and
  read-only rows alike. The player filter chip shows the name in bold instead
  of "You", and Standings drops its "me" badge (the row tint and an accent
  name remain).
- Score cards list each player on a line of their own with a 20px avatar,
  instead of one "A & B" line beside the steppers. Each name truncates alone,
  so the partner's name is no longer cut off on a phone. The score box's
  accessible name stays "A & B".
- Since 2026-11-07 (no release note): any 4–6 digit PIN is accepted, and an
  admin reset clears the player's failed sign-in attempts.

## Also in v2.3 (shipped the same day; briefly numbered 2.4, then folded in)

Coed rule (PORT.md §4.1 and §4.4):

- The regular round robin now applies the gender-balanced matchup rule: never
  two men (both stated male) against two women (both stated female); anyone
  with an unspecified gender makes their team neutral.
- Whole-session draw: pass a gender per seat to the partner-unique planner,
  but no ratings (the format stays rating-blind). Keep the plan even when the
  rule can't reach zero — that only happens when exactly two women must
  partner once in a full rotation — so "partner everyone once" still holds.
  Gender-balanced instead discards such a plan and draws round by round.
- Adding a round, rebuilding, and shapes with no perfect plan: the per-round
  generator treats MM v FF as forbidden for the regular format, as it already
  did for gender-balanced. A violation-free seating always exists.
- Format descriptions updated in three languages.

Sign-in and PINs (PORT.md §auth note):

- Sign-ins slide: a visit more than a day after the last renewal extends the
  sign-in to a fresh 90 days. A native app with its own auth can ignore this;
  the point is that nobody should be signed out while still playing.
- Change PIN on Me: current PIN, new PIN twice; a wrong current PIN counts
  against the same 5-per-15-minutes limit; other devices are signed out.
- Group-wide cap: 30 failed sign-ins across all names in 15 minutes pauses all
  sign-ins until the window clears.
- Login copy: "Username", and a forgotten-PIN hint pointing to an organizer.

Rankings (PORT.md §10):

- Listed by reliability earned here (min of the partner, team and volume
  terms), never the typed DUPR floor; evaluated when the page is viewed from
  evidence totals the recompute stores (decay is one factor for all three);
  enter at 60%, stay until 50%. Display only; ratings unchanged.

Release notes: v2.3 in English, Simplified Chinese and Traditional Chinese
(names, coed rule, sign-in, PIN, Rankings).
