# PicklePlay v1.9 — independent iOS app handoff

Read PORT.md (now including §4.8) and PORT-v1.8.md for the prior behavior.
v1.9 adds one format, Swiss; nothing else changes.

- Format list: Regular, Balanced, Gender, Fixed partners, **Swiss**, Mini MLP,
  Custom. Swiss allows 4–6 courts and 12–24 players (6–12 fixed pairs).
- Pairs are fixed partners (mutual), set before round 1; everyone present must
  be paired. Roster, attendance, partners and RSVPs lock once round 1 is drawn.
- Round 1: organizer chooses seeded (pair = mean player rating; top half v
  bottom half, 1 v 5 …) or random. Later rounds pair equal records, highest v
  lowest inside a group, never a rematch, preferring draws that leave another
  round possible. Every pair plays every round; an odd count gives one bye per
  round (lowest-ranked without one; counts as a win; never twice).
- Standings: wins, Buchholz (opponents' wins), point difference, points scored,
  pair key. The organizer decides the number of rounds (suggest 3 for 6–8 pairs,
  4 for 9–12; at least 2 before playoffs).
- Playoffs in two waves; nobody sits out except one pair per wave on an odd
  night: groups of four (semis, then the group's first and third place games),
  a remaining two play twice (games, then total points, then higher seed), a
  remaining three play a ladder. Store each playoff game's role.
- Results lock once a later stage is drawn from them; discarding the unplayed
  later round unlocks. Swiss-round corrections are allowed before playoffs.
- Rounds with more games than courts label the extra games "Next free court".
- Port the engine's tests: no rematch, one game or bye each, no second bye,
  8 pairs × 3 rounds → 3/2/2/2/1/1/1/0, look-ahead reach (6–10 full round
  robin), playoff shape for 6–12, every place filled, series tie-break, ladder.

Release notes are v1.9 in English, Simplified Chinese and Traditional Chinese.
No rating equation changes; Swiss games rate like any other.
