# PicklePlay v2.0 — independent iOS app handoff

Read PORT.md (updated in place: §2 players, §3.6, §3.9, §3.10, §5, §7, §8, §10)
and PORT-v1.9.md for the prior behavior. v2.0 is a quality release after a
full code review; nothing new in the formats.

- Rating: a declared reliability (signup, admin correction, or a self re-seed
  that supplies one) fades with a 90-day half-life from the day typed. Dated
  epoch 2026-10-23; matches before it replay with the permanent floor, so stored
  ratings and events are bit-identical. Expect displayed reliability to drop for
  players whose confidence rested on a typed number: in production, 98 of 125
  change at the first post-epoch game, 14 from reliable to provisional.
- Self re-seed takes an optional DUPR reliability, counted up to 60%; blank keeps
  the old "back to provisional" behaviour. Admin corrections keep the full range.
- Career counts (played, won, win rate) are every scored game played here,
  rated or casual, identical on every screen; only the rating ignores casual
  nights. The imported-record feature and its three player columns are gone.
- Every server refusal is shown under the button that caused it; a page error
  shows a retry screen. Raising a session's limit promotes the waitlist. Fixed
  partners refuses to build rounds with fewer than two pairs. Discard is
  live-only. Swiss shows a locked notice after round 1. Create validates the
  invited player ids.
- Backups include the two Swiss tables (schema 3). Weekly cron also deletes
  expired login tokens and login attempts older than seven days.

Release notes are v2.0 in English, Simplified Chinese and Traditional Chinese.
