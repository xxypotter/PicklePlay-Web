# PicklePlay v1.8 — independent iOS app handoff

Read PORT.md and PORT-v1.7.md for the prior behavior. This amendment supersedes
v1.7's four-court-only Mini MLP requirement; the apps keep independent data.

- Mini MLP accepts 4, 5 or 6 named courts with 4, 5 or 6 four-player teams.
  Ordinary formats retain their four-court cap. Extra courts do not add teams.
- Six-team round robin: 60 games, 15 distinct team encounters, ten games/player.
  Four courts: existing rest-balanced 16 waves. Five courts: 12 full waves,
  ten games and two rest waves/player. Six courts: ten full waves.
- Five courts: one different pair of squads per four-wave block plays its
  encounter sequentially on court 5. The other four squads play two opponents
  across courts 1–4. Every squad gets exactly one single-court encounter. See
  PORT.md's v1.8 court extension for all pairings and src/lib/mlp/schedule.ts.
- Four/five squads keep their original schedule and first four active courts;
  any extra courts stay free. Never send one squad against two opponents in
  the same wave. Explain spare courts in setup rather than implying full use.
- All four organizer-selected category pairs remain fixed through playoffs.
  Opening games precede mixed games. A block is no longer always two waves.
- Top-four semifinals remain 1v4 and 2v3 on courts 1–4, followed by concurrent
  gold and bronze on courts 1–4. Each stage is two waves, even with extra courts.
- Create, edit, Copy, and Copy with players must preserve all selected courts.
  An edit racing Start must not change courts after play starts. Back to setup
  keeps teams/lineups and allows court editing only after unscored games are removed.
- Test all nine team/court combinations: opponent coverage, court/player
  collisions, lineup preservation, games/player, wave ordering, tie resolution,
  playoff seeding, gold/bronze, copying, invalid court counts, and stale edits.
- Other v1.8 UI changes from Claude: Mini MLP appears before Custom in format
  pickers; Matchups displays the signed-in player as "You (username)".

## October 3 amendment: draws and result notes

- RR exact ties (four scored games, 2–2, equal total points) automatically count
  as draws. Standings show W–L–D and points: win 2, draw 1, loss 0. Then use
  existing game/point difference, points scored and team-slot tiebreakers.
  Explain the scoring and override path directly on standings.
- Under Manage matches & players, organizer/superadmin may choose either team
  after an off-app DreamBreaker or retain/revert to Draw, with a 500-character
  optional result note. Show the note to all readers. Exact playoff ties still
  need a winner. No DreamBreaker game is created or separately rated.
- Web migration 0016 adds nullable mlp_ties.decision_note. Keep existing
  tiebreak_winner; automatic draws are derived, without a persisted draw flag.
  Existing sessions work immediately without result backfills or regeneration.
- Protect any outcome already used by a downstream playoff stage, while
  allowing note-only edits. Score edits/clear/void/restore clear both override
  and note. Enforce this atomically with session locks and audit decision edits.
- All formats: Matchups gets Hide scored matches below the player filter.
  Default unchecked; checked hides scored/voided cards and empty round sections,
  preserving original numbering and intersecting selected players. Update as
  scores refresh. Uncheck to restore the full schedule.
- Test draw readiness/seeding, W+L+D equal played, permissions, note validation,
  reversal, score corrections and downstream locking. See PORT.md for details.

No rating equation or individual game records change. Keep release notes at
1.8 in English, Simplified Chinese, and Traditional Chinese. This amendment
supersedes the earlier requirement to manually decide every exact RR tie.

## October 4 amendment: optional random mixed opponents

- Team/lineup setup offers Same pair number (default) and Random for each team
  matchup. Default matches A1–B1 and A2–B2. Random independently chooses that
  mapping or A1–B2 and A2–B1 with 50/50 probability for each encounter.
- Choose once per encounter, for both mixed games together, when generating
  round robin or playoffs. Save actual participants; never reroll on refresh.
  All four saved partner pairs, team opponents, courts and wave order stay fixed.
- Save the choice with teams before creating the draw; lock after rounds exist.
  Copy and Copy with players preserve it. Back to setup keeps it, then allows
  editing it before a fresh draw under the existing unscored-session rules.
- Web migration 0017 adds sessions.mlp_random_mixed and mlp_ties.mixed_crossed,
  default false. Historical assignments stay unchanged. Crossed mixed labels
  read 1 vs 2 / 2 vs 1; mlp_game identifies team A's slot. Use independent native
  storage/migrations. This remains v1.8 in all three dictionaries.
- Tests cover default/aligned/crossed assignments across all nine team/court
  combinations, saved pairs through semifinals/finals, court/player conflicts,
  persistence, permissions, copying and returning to setup.
