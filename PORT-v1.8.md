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

No rating equation, historical result, or web database schema changes. Keep
release notes at 1.8 in English, Simplified Chinese, and Traditional Chinese.
