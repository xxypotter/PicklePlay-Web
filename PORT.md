# PicklePlay — port specification

Everything the web app does, written for someone rebuilding it natively. This
is a description of behaviour, not of the TypeScript: where an algorithm matters
the constants and the formula are given so the result can be reproduced exactly.

The reference implementation is a Next.js web app backed by Postgres. Anything
tied to that stack — server components, Drizzle, Vercel — is an implementation
detail and is called out as such.

**The two apps are independent** — separate databases, separate players,
separate ratings. Nothing here has to match the web app bit-for-bit at runtime;
this is a description of behaviour to rebuild, not a contract to interoperate
with. Where exactness still matters it is for the native app's *own* sake, and
said so explicitly (§3.9 is the one to read twice).

**Deliberately out of scope here:** sign-in (the web app uses a username + PIN
with an invite code; the native app will use email or phone), payment, and
anything about the App Store. Those are noted in §12 as gaps, not specified.

**Reflects web app v1.7 (2026-09-26).** See §16 for the v1.5–v1.7 handoff. §15 lists behaviour that has been
audited and deliberately left alone — read it before "fixing" anything in §3.

---

## 1. What the app is

A private club app for organising doubles pickleball and keeping a rating. One
group, everybody knows everybody, roughly 40 members with 8–20 at any session.

Three things it does, in order of how much they matter:

1. **Rates players** on a 2.000–8.000 scale calibrated against DUPR.
2. **Builds the matchups** for a session automatically.
3. **Keeps the record** — who played whom, who won, how ratings moved.

Mobile-first. Almost all use is one-handed, on a phone, courtside.

---

## 2. Data model

Postgres. UUID primary keys throughout. The load-bearing rule:

> **`matches` and `rating_seeds` are the only source of truth.** `rating_events`
> and `player_stats` are caches, rebuilt by replaying history through the rating
> engine. Never hand-edit them; never read a rating from anywhere else.

### players
| column | type | notes |
|---|---|---|
| `id` | uuid | |
| `username` | text | as typed, for display |
| `username_lower` | text | uniqueness is enforced on this |
| `display_name` | text? | |
| `pin_hash` | text | **replace with your auth** |
| `role` | enum | `player` \| `admin` \| `superadmin` |
| `gender` | enum | `male` \| `female` \| `unspecified` — only decides which ranking table you appear in |
| `avatar` | text? | `preset:N`, a small data URL, or null → colour derived from the name |
| `locale` | text? | null means "never chose", which is different from "chose English" |
| `imported_matches` / `imported_wins` | int | a record carried in from before; display only, never touches the rating |
| `imported_at` | ts? | its presence closes the one-time import |
| `active` | bool | |

### rating_seeds — append-only
`player_id`, `rating`, `declared_reliability` (0–100), `source`
(`dupr` \| `picker` \| `admin`), `effective_at`, `created_by`, `note`.

One row at signup, plus any later self re-seed or admin correction.

### sessions
`title`, `location?`, `starts_at`, `court_names` (text array — the *names*, e.g.
`["3","4"]`, length is the court count), `court_count`, `max_players`, `format`,
`rated` (false = casual, no rating change), `is_private`, `status`
(`draft`\|`open`\|`live`\|`closed`), `notes?`, `created_by`.

### signups
`session_id`, `player_id`, `state` (`in`\|`waitlist`\|`out`), `waitlist_pos?`,
`added_by_organizer`, `attended` (default **true** — organizers only un-tick
no-shows), `partner_id?` (fixed-partner pairing; both rows point at each other).
Unique on `(session_id, player_id)`.

### rounds
`session_id`, `index` (1-based), `state`, `stage`
(`robin`\|`semifinal`\|`final`, default `robin`). Unique on
`(session_id, index)`. `stage` is what keeps a medal round (§4.7) apart from the
round robin that seeded it — seeding reads `robin` results only.

### matches
`session_id?`, `round_id?`, `court_no?`, `a1 a2 b1 b2` (player ids — **always
exactly four**), `score_a?`, `score_b?`, `status`
(`scheduled`\|`completed`\|`void`), `entered_by?`, `played_at`, `edited_at?`.

Voided matches are kept, not deleted, so history stays auditable; the recompute
skips anything that isn't `completed`.

> The four player columns have **no cascade delete**. That is intentional: the
> database refuses to delete a player who has played, which is what makes
> "delete duplicate account" safe.

### rating_events — cache
`match_id`, `player_id`, `rating_before`, `rating_after`, `delta`, `k`,
`surprise`, `reliability_at_time`. Unique on `(match_id, player_id)`.

### player_stats — cache
`player_id` (PK), `rating`, `peak_rating`, `reliability`, `half_life`,
`local_matches`, `wins`, `losses`, `points_for`, `points_against`, `streak`,
`provisional`, `self_declared`, `last_played_at`, `recomputed_at`.

---

## 3. The rating engine

The most valuable part of this app, and the part most worth porting exactly.
It is a simulation of DUPR's *observable behaviour*, calibrated against 17
readings taken from DUPR's own Forecast tool.

Pure function of the event timeline: no clock reads, no database, no randomness.

### 3.1 Scale
`MIN = 2.0`, `MAX = 8.0`, three decimal places in display.

### 3.2 Expected score

```
expectedShare(teamRating, oppRating, d) = 1 / (1 + 10^((oppRating - teamRating) / d))
```

Team rating is the **plain average** of its two players.

```
D_POINTS = 2.05      // the expected point share
D_WIN    = 1.0       // retained but unused while ALPHA = 1
```

### 3.3 Surprise — how the match went versus expectation

```
expected = ALPHA * eP + (1 - ALPHA) * eW
actual   = ALPHA * share + (1 - ALPHA) * won
surprise = actual - expected

share = scoreA / (scoreA + scoreB)
won   = scoreA > scoreB ? 1 : 0
ALPHA = 1.0
```

**`ALPHA = 1.0` means winning, by itself, is worth nothing.** Only the score
matters. This is measured, not assumed — see §3.7. Team B's surprise is exactly
the negation of team A's.

### 3.4 K-factor — how far you move

```
k = max( K_BASE * (1 - reliability)^K_EXPONENT ,
         K_SETTLED / (1 + halfLife / HALF_LIFE_SCALE) )

if localMatches < CAL_MATCHES:        k *= CAL_MULT
if localMatches < SEED_FLOOR_MATCHES: k  = max(k, K_SEED_FLOOR)

K_BASE = 0.98    K_EXPONENT = 1.06
K_SETTLED = 0.188   HALF_LIFE_SCALE = 40
CAL_MATCHES = 5     CAL_MULT = 1.0
SEED_FLOOR_MATCHES = 5   K_SEED_FLOOR = 0.15
```

Two regimes, crossing at about **89% reliability**:

- **Below it**, reliability decides. `k ≈ 1 − reliability`, measured directly.
- **Above it**, reliability has saturated — it can't tell twenty logged matches
  from a thousand — so the *depth of the record* takes over as a floor.
  `halfLife` is the decayed match count (§3.6).

The floor matters: the power law reaches exactly zero at 100%, which would
freeze a fully established player forever. DUPR does not do that.

**`CAL_MULT` is 1.0 — do not reintroduce a first-matches boost.** It was 1.25,
which made `K = 1.23` for a player's first five games: the largest number in the
whole system, sitting exactly where the evidence is thinnest. Nothing in the
DUPR data supports it — the account it was calibrated against was eighteen
matches in — and across 160 real matches every single outlier lived inside that
window. It eventually produced a **+1.269 move in one evening**, a player going
2.50 → 3.77 in eight games. `K_BASE` alone already finds someone's level in a
night or two and *is* anchored to measured forecasts. The constant is kept in
the tuning only so old matches can still replay under it.

### 3.5 Applying it

```
compression(rating, gaining) = sqrt(clamp(room / COMPRESS_BAND, 0, 1))
    room = gaining ? MAX - rating : rating - MIN
    COMPRESS_BAND = 1.5

delta = clamp(k * surprise * compression, -cap, +cap)
    cap = provisional ? CAP_PROVISIONAL : CAP_RELIABLE
    CAP_PROVISIONAL = 0.6    CAP_RELIABLE = 0.5
```

The caps are backstops against nonsense (a score typed as 99–0), **not** working
limits. DUPR itself forecasts +0.411 for a single match, so a tight cap would
contradict the data.

A provisional rating is additionally floored:

```
floor = provisional && PROVISIONAL_FLOOR !== undefined
          ? min(max(MIN, PROVISIONAL_FLOOR), ratingBefore)
          : MIN
after = clamp(before + delta, floor, MAX)

PROVISIONAL_FLOOR = 2.5
```

`MIN` is the bottom of the scale, not a plausible skill level — essentially
nobody real plays below 2.5, and the lowest option the skill picker offers *is*
2.5. Without this a player who had a bad first night landed at **2.063**, six
hundredths off the absolute floor, on eight games of evidence: nothing left
below them, and a first impression of the app that reads as a verdict.

Note the inner `min(..., ratingBefore)`. It is a floor, never a lift: someone
already under it stays where they are rather than being handed points, which
matters because a settled player who fell to 2.2 and then re-seeds themselves
goes provisional again. Once reliability passes, the whole scale is available.

Every delta in a match is computed from the **pre-match** ratings and applied
afterwards, so the order you walk the four players cannot change the result.

### 3.6 Reliability — how trustworthy the number is, not how good the player

Three conditions: **distinct partners**, **distinct opposing pairs**, and
**how much has been played**. The first two are remembered once each with the
time last seen and a weight — diversity, not raw match count, because ten games
with the same three people teach less than six against six different pairs. The
third is there because in a closed group diversity alone saturates almost
immediately; see below.

```
waypoint(x, at60, at100):
    if x <= 0:      0
    if x <= at60:   0.6 * (x / at60)
    else:           0.6 + 0.4 * min(1, (x - at60) / (at100 - at60))

reliability = max(declaredFloor,
                  min(waypoint(partners), waypoint(teams), waypoint(volume)))

PARTNERS_AT_60 =  4   PARTNERS_AT_100 =  8
TEAMS_AT_60    = 12   TEAMS_AT_100    = 24
VOLUME_AT_60   = 24   VOLUME_AT_100   = 72
RELIABILITY_PASS = 0.6      // below this the rating shows a "?"
```

All three conditions must hold, so take the **lowest**. `volume` is the decayed
match count (`halfLife`), the same figure §3.4 uses.

**Why volume is there at all.** Diversity alone is far too easy to satisfy in a
closed group: one nine-player round robin hands you eight partners and eight
opposing pairs, which under diversity-only waypoints was a **70% reliability
from a single night**. DUPR asks for vastly more — the player we calibrated
against sits at 10% after eighteen matches. You cannot reproduce DUPR's numbers
directly, because its reliability reflects a large open pool while yours is
capped by roster size: with nine regulars there are only ever eight distinct
partners to be had. Volume is the one term group size doesn't cap, so it carries
the tail. At eight games a session, production currently shows ~18–20% after one
session, ~38% after two and ~56% after three, reaching settled at around nine —
against a single night before.

If you build a fresh app, **start with these values, not the diversity-only
ones.** The earlier numbers are recorded in §3.9 only because our history has to
keep replaying under them.

Each remembered encounter decays: `weight * 0.5^(daysAgo / 90)`. Same decay
gives `halfLife` = the decayed count of matches played here.

A partner or opponent is worth `UNKNOWN_WEIGHT + (1 - UNKNOWN_WEIGHT) *
min(1, theirReliability / 0.6)` with `UNKNOWN_WEIGHT = 0.5` — a reliable
opponent is better evidence, but an unknown one still counts for something, or a
brand-new group could never bootstrap.

`declaredFloor` is the reliability copied from a real DUPR profile at signup,
trusted at face value in a small group. An admin correction can set it; a
**self** re-seed clears it and wipes the partner/team books, because changing
your own number reopens the question of whether it's right.

> Two caveats on `declaredFloor` that we have chosen to live with and you may
> not want to inherit unexamined — it is unverified, and it never decays. §15.1
> and §15.3.

### 3.7 Why ALPHA = 1 — the calibration

DUPR's Forecast, one match, three accounts at different reliabilities. Xiayu Xu
3.813 (10% reliable) + Sam Yang 3.884 (60%) vs Dezhi Zheng 4.220 (40%) + Alec
Liang 4.369 (100%). DUPR predicted 5.5–11.

| Score (Xiayu's side) | DUPR delta for Xiayu |
|---|---|
| 3–11 | −0.090 |
| 6–11 | **+0.033** |
| 9–11 | **+0.119** |
| 11–9 | +0.206 |
| 11–8 | +0.232 |
| 11–6 | +0.291 |
| 11–3 | +0.411 |

Every one of those is linear in point share (two independent slopes agreed to
0.8871 and 0.8861), **with no step at the win boundary** — 9–11 and 11–9 sit on
the same line. Hence ALPHA = 1.

The same match from the other two accounts gives K at three reliabilities:
`k(0.10) = 0.877`, `k(0.60) = 0.371`, `k(1.00, halfLife 40) = 0.094`. A straight
line through the first two predicts a *negative* K at 100%, which is why the law
is a power with a floor rather than an interpolation.

The current constants reproduce all 17 forecasts to a **mean error of 0.0006,
worst 0.0016**. Keep the regression test.

An independent check fell out of it: break-even point shares measured from
opposite ends of the court (0.3155 and 0.6849) sum to 1.0004.

### 3.8 Recompute from scratch

Every rating is rebuilt by replaying the whole timeline in one chronological
pass — seeds and matches, sorted by time, seeds first on ties. This runs after
every score, edit, void or deletion.

Do **not** iterate the replay. An earlier version ran several passes, feeding
each the previous pass's final ratings, on the theory that late information
should re-score early matches. It doesn't converge on a better estimate; it
drifts toward the degenerate fixed point where the season's net movement is
zero, erasing exactly the improvement the rating exists to show. (4 passes vs 8
diverged by 0.11 over a 20-match season.) Doing that properly needs
Whole-History Rating, which fits a rating *curve* per player — a real upgrade,
not a constant to tweak.

### 3.9 Dated tuning — do not skip this

Because ratings rebuild from history, changing a constant would silently
re-score every match ever played. **Results already shown to players are
theirs.** So the movement constants are versioned by date: a match replays under
whichever tuning was in force the day it was played.

Keep a table of `{ effectiveFrom, constants }` and pick by `match.playedAt`.
Editing an old score must keep its original date (update an `editedAt` field
instead), so a correction stays on the old tuning.

Verify after any change that replaying real history reproduces stored ratings
**bit-identically**. That check has caught real mistakes.

> **Do not copy our epoch table.** It carries three historical entries — the
> original constants superseded on 2026-08-10, diversity-only reliability
> superseded on 2026-08-16, and the first-matches K boost superseded on
> 2026-08-31 — which describe *this* app's past, not yours. A fresh install has no history to protect, so ship with the
> constants in §3.2–§3.6 as your v1.0 and a single open-ended epoch. Add a
> second entry the first time you retune, and from then on the guarantee is
> yours to keep. The machinery matters; our dates do not.

### 3.10 Starting rating

A real DUPR if they have one. Otherwise a five-step picker:

| Rung | Rating |
|---|---|
| Brand new / first time | 2.5 |
| Beginner — knows the rules | 2.75 |
| Intermediate — consistent rallies | 3.0 |
| Advanced — comfortable at the kitchen | 3.5 |
| Competitive — plays tournaments | 4.0 |

`DEFAULT_RATING = 3.0` for anyone appearing in a match with no seed at all.
The ladder is centred on where this group actually plays; most people honestly
pick the middle rung, so putting it too high starts newcomers above established
members.

Self re-seed is allowed **once every 30 days** and is recorded publicly in the
player's history.

---

## 4. Match formats and the generators

Six formats offered: **regular**, **balanced**, **gender**, **fixed**,
**custom**, **Mini MLP** — in that order in the picker. Mini MLP uses the dedicated team model in §16.
(`king`, `social`, `manual` exist in the enum for old rows; don't offer them.)

Common shape: a round holds one match per court in use;
`seats = min(courtCount, floor(players / 4)) * 4`. Anyone spare sits out, and
sit-outs are shared as evenly as the numbers allow.

### 4.1 Regular round robin — partner everyone once

The promise is a property of the **whole schedule**, not of any single round, so
it is solved as one problem. Nine players over nine rounds need exactly the 36
partnerships that exist, which makes it a decomposition of the complete graph.

Algorithm, per attempt (500 randomized restarts):

1. Choose who rests: most games played rests next; among equals, whoever has
   rested least often.
2. Find a perfect matching on the seated players using **only partnerships
   nobody has had yet** (backtracking, shuffled candidate order).
3. Group those pairs into matches, choosing the grouping that minimises repeated
   opponents (exhaustive — there are few groupings at ≤4 courts).
4. If a round can't be matched, retry with different rest choices (8 tries),
   then abandon the attempt.

**Score every valid schedule and keep the best, rather than returning the first
that works.** Partnership uniqueness holds either way; what the extra restarts
buy is *opponent* spread, which is not a hard constraint and quietly goes wrong.
Nine players over nine rounds fill 72 opponent slots across 36 pairs — exactly
two each is available, and a first-fit draw gave one pair four meetings and ten
pairs three or more. Score by squared error against that ideal, counting pairs
who never met as if they were two short (otherwise a schedule hides its gaps by
never creating the encounter). Over 50 draws this takes the worst "faced N
times" from 4 down to 3 in 48 of them, and costs ~60ms — paid once at layout,
not per round.

Return null when no perfect schedule exists — `rounds * seats/2 > C(n,2)` —
and fall back to the per-round generator. **Never silently ship a flawed draw:**
the bug this replaced gave 9 players 34 distinct partnerships instead of 36.

Only from a clean slate. Adding a round mid-session uses the per-round path.

### 4.2 Balanced — even team ratings

Per-round randomized-restart hill climbing (200 restarts, pairwise-swap descent)
over a cost function, lower is better:

```
cost = Σ over courts:
    balance  * |avg(teamA) - avg(teamB)|
  + partner  * (partnerCount[a1,a2] + partnerCount[b1,b2])
  + opponent * (the four cross-pair counts)
  + spread   * (max rating on court - min rating on court)
```

```
regular   { balance:   0, partner: 50, opponent: 3, spread: 0, gender:    0 }
balanced  { balance: 100, partner:  6, opponent: 2, spread: 4, gender:    0 }
gender    { balance:  20, partner: 50, opponent: 3, spread: 0, gender: 1000 }
fixed     { balance: 100, partner: -8, opponent: 2, spread: 4, gender:    0 }
```

In v1.7 a gender violation gives infinite cost. The weight is retained for
compatibility but is no longer a finite trade-off. Other ordinary formats do
not read gender. Mini MLP requires explicit male/female team membership.

**The balance weight has to be large.** At 10 a repeated partnership cost 6
while a rating gap of 0.1 cost 1, so the search gave away half a rating point to
avoid pairing two people twice, and "balanced" produced a mean team gap of 0.13
where 0.001 was available. At 100 a repeat is worth 0.06 of gap: even teams
first, variety as the tie-breaker. Measured over 12 players and 8 rounds the
mean gap is **0.040**, worst **0.130**.

Known trade-off: chasing an even *average* can put a 4.8 and a 3.2 against a 3.8
and a 4.5 — balanced on paper, lopsided to play. `spread` tempers it. If that
proves unpopular, the better answer is tiered courts (strongest four together,
next four together), which gets both.

The old negative fixed-partner weight is a legacy constant. v1.7 uses only
explicit mutual pairs in fixed draws, including added and rebuilt rounds.

### 4.3 Fixed partners

Pairs are **chosen by the organizer before the session starts**, not inferred.
Once they exist the problem changes shape: partners stop being something to
solve for and what remains is a round robin between *teams*.

- Store the partner on each signup row; both rows point at each other.
- Editable while open or live, before a medal bracket exists. Writes are atomic and symmetric; existing matches retain their stored players.
- Anyone left unpaired **does not play**. Pairing is the point of the format;
  inventing a partner is the worse surprise. Show the unpaired count.
- Initial schedule: circle-method round robin between pairs, packed into courts
  without booking a team twice in a round. Eight teams on four courts need seven
  rounds for all 28 distinct opponents; longer schedules repeat complete cycles.
- Added rounds and partial rebuilds: select complete pairs by games played,
  then exhaustively match seated pairs to minimize squared opponent repeats.
  Unpaired/absent members never get an invented partner. New pair assignments
  affect newly generated matches only, never change existing stored matches.

### 4.4 Gender balanced — never two men against two women

Three priorities, and the order is the whole design:

1. **Never MM against FF.** A hard rule, not a preference.
2. **Rotate partners as widely as a regular round robin.**
3. **Then even up the two teams by rating.**

The rule is about the **matchup, not the team**. MM vs MM is fine, FF vs FF is
fine, anything with a mixed team is fine. Only MM facing FF is out.

```
teamGender(x, y) = (x == y and x != unspecified) ? x : null
violates(a1,a2,b1,b2):
    A = teamGender(a1,a2);  B = teamGender(b1,b2)
    return A != null and B != null and A != B
```

A player who left gender unspecified makes their team neutral and can never
trigger a violation. That is deliberate: "unspecified" is also how someone opts
out of the gendered rankings, so it is a real choice and must not be guessed at.

Try the whole-session partner-unique planner first. If its plan has any
MM-versus-FF games, discard that plan and generate rounds with a hard gender
constraint. A valid initial draw is always possible by exchanging one player
on each violating court; hill climbing then rejects any invalid candidate.
Rest fairness is unchanged. With 10 men and 2 women, complete partner coverage
would eventually pair the two women against men; v1.7 sacrifices that partnership
instead. Never display or persist the planner's best-but-invalid intermediate
result as an acceptable draw.

**Balance is third, and it costs the first two nothing.** The first real
gender-balanced night produced seven blowouts in twenty — worse than any other
session — for a structural reason worth understanding before you copy the
design. With only two women present the rule *correctly* refuses to pair them
(that would force a violation), so instead of one weak team you get one weaker
player spread across fourteen of the twenty matches. Combined with inheriting
`balance: 0` from the regular round robin, that is a lot of one-sided games.

So the planner takes an optional rating per seat and adds
`BALANCE_WEIGHT * |avg(teamA) − avg(teamB)|` to the same grouping cost the
gender rule uses, plus the schedule total to the restart ranking. Partner
rotation is untouched — it is a hard constraint settled before that step — and
the gender rule outranks everything at 1e6. The only thing balance actually
trades against is opponent variety. Measured over 30 draws of that real 8M/2F
roster (mean team gap / matches over 0.5 / pairs who never meet, of 45):

```
   0  →  0.372 / 5.7 / 0.6      the night that prompted this
   4  →  0.301 / 4.1 / 1.6
  10  →  0.246 / 2.7 / 2.6      chosen
  25  →  0.196 / 1.5 / 5.5      too far
```

Partnership coverage was 40 of 40 and violations zero at *every* weight. At 25
the worst pair meets four times and five pairs never meet at all, which is
exactly the opponent clustering §4.1 exists to prevent. **`BALANCE_WEIGHT = 10`.**

Pass ratings for this format only. The regular round robin is deliberately
rating-blind and handing it ratings would quietly turn it into something else.

### 4.5 Custom
Rounds are still generated (balanced weights), but the organizer expects to
rearrange courts by hand.

### 4.6 Suggested round count

For a regular round robin there is an exact right length; offer it and warn when
the chosen number splits unevenly.

```
seats        = min(courts, floor(players/4)) * 4
splitsEvenly = (rounds * seats) % players == 0
gamesEach    = rounds * seats / players
```

Nine players on two courts → 9 rounds, 8 games each, one sitting out per round,
and you partner everyone exactly once.

### 4.7 Medal round — how a fixed-partner night finishes

Fixed partners only. It is the one format where a team survives the whole night,
and a bracket between teams that dissolve every round would mean nothing.

- **Semi-finals**: seed 1 v seed 4, seed 2 v seed 3, in that court order.
- **Finals**: the two semi-final winners play for gold, the two losers for
  bronze. Playing the losers off is the point — otherwise they share third.

Two separate actions, not one, because who is in the final *is* the result of
the semi-finals.

**Seeding rules that matter:**

- Seed from **round-robin results only**, so a semi-final cannot reorder the
  seeds that produced it. This is what the `rounds.stage` column
  (`robin | semifinal | final`) is for.
- Seed from **matches actually played**, never from the roster's stored pairs.
  Pairs can be edited between rounds; the bracket must reflect the night that
  happened.
- Order by wins, then point difference, then points scored, then a stable key.
  The last one is not decoration: without it two organizers seeding the same
  night can get two different brackets.
- **Refuse while any match is unscored.** A partial table ranks teams on how
  many games they got round to playing.
- Teams ranked fifth and below are done. A placement match for them is a
  different feature.

Court order carries the bracket, so the labels players see ("Semi-final 1",
"Gold final") are derived from stage plus court, not stored.

Medal matches rate exactly like any other game.

---

## 5. Session lifecycle

```
open  ──start──▶  live  ──end──▶  closed
  ▲                 │
  └─── reopen ──────┘   (only while no rounds exist)
```

- **open** — people sign up; the organizer edits details and sets fixed pairs.
- **live** — details lock, matches get built, scores get entered.
- **closed** — a record. Scores can still be corrected by the organizer.

A session auto-closes **48 hours** after its start time, so a night nobody ended
doesn't linger in Upcoming. It was 24, which was too tight: closing narrows
scoring to the organizer, so an early auto-close takes the pen out of the hands
of everyone who was actually on court. A Saturday that runs late now has until
Monday. The sweep runs lazily on page loads plus in the
weekly cron.

### Letting a latecomer in

Ten players, all the matchups built, and an eleventh walks in. Two separate
things block this, and the first is invisible — get both.

**The roster.** If the organizer's add shares the capacity rule with self-RSVP,
the eleventh player is filed on the waitlist, never reaches the draw, and the
button gives no sign that is what happened. The same shape of trap as counting
signups instead of attendees, one layer up. A person standing on the court is a
fact and the cap is a plan, so **an organizer's add is never waitlisted** and
raises `max_players` to fit. Self-RSVP still respects the limit — the difference
is that this path only runs when someone was deliberately picked by name. Use
`on conflict do update`, not `do nothing`: the organizer may be reaching for
somebody already waitlisted or marked out, and "add" should mean the same thing
whichever row exists.

**The schedule.** A separate, explicit "rebuild matchups" action, because
throwing away a draw people may already be standing on court for is not
something to do as a side effect of adding a player.

- A round is **settled** once any of its matches has a score *or a void* —
  voiding records something that happened, it is not an eraser. Settled rounds
  are never touched.
- Delete the unsettled rounds, **matches first** if your schema nulls the round
  reference on delete rather than cascading.
- **Nothing played yet** → discard everything and re-run the whole-session
  planner from a clean slate, so a regular or gender draw keeps its
  partner-once promise.
- **Some rounds played** → the planner cannot help; it solves a whole session
  and this one is half spent. Generate a round at a time instead, reading the
  history the played rounds created, so partner and sit-out fairness carry
  across the join.
- Refuse once a medal round exists: round-robin rounds cannot follow a final.

For fixed partners the pairs must also be editable **while the session is
live** — two latecomers who want to play together have to be paired after the
night began. Safe because played matches store their four players outright, so a
pairing change only affects rounds built from then on.

### Capacity — count who is *playing*, not who signed up

`attended` defaults to true, so before the night the two are the same set. They
diverge the moment an organizer marks a no-show, and at that point the place is
genuinely free.

```
occupied = count(signups where state='in' and attended=true)
joining player goes 'in' if occupied < max_players, else 'waitlist'
```

Use that one definition for self-RSVP, organizer adds, **and** waitlist
promotion, or they drift apart. Marking someone absent should also promote the
first person waiting.

Marking someone back in is **not** capped — if ten people are standing on the
court, refusing the tenth because the sheet said nine helps nobody, and the
round builder already rotates byes.

The insert must decide `in` vs `waitlist` **inside a single statement** so the
database resolves two people claiming the last place at once, rather than a
read-then-write that both requests win.

---

## 6. Permissions

Three roles: `player` < `admin` < `superadmin`. Exactly one superadmin.

| Action | Who |
|---|---|
| Create a session | admin+ |
| Edit / run / delete a session | its **organizer** (creator), or superadmin |
| Enter a score, session live | anyone who played in it, or any admin |
| Enter a score, session closed | the organizing admin, or superadmin — it's a record now |
| Void a match | **superadmin only** |
| Restore a voided match | **superadmin only** |
| Adjust another player's rating | admin, but only players and themselves |
| Adjust an admin's or the superadmin's rating | superadmin only |
| Reset a PIN | admin for players; superadmin for admins |
| Invite code, recompute, backup, delete account, private sessions | superadmin |

Being an admin is not permission to rewrite a peer's rating: that turns every
disagreement into an edit war with no referee.

**Enforce every one of these server-side.** Hiding a button is not a permission
check.

### Voiding is not scoring

They look alike and are different in kind. A wrong score is a correction anyone
on court can make; voiding says the game *did not happen* — it leaves four
people's records and moves everyone's rating. So it is the superadmin's alone,
checked in the action before it touches the database.

**A voided match stays visible.** The row was always kept, but filtering it out
of the query made it indistinguishable from a match that never existed — to the
four people who remember playing it most of all. It stays on the matchups list,
struck through, score intact, with a note saying it counts for nobody, and one
tap restores it. Void and restore should be the *same function called twice*;
splitting them is how the two ends up with different permissions.

Everything else still excludes it: standings, personal records, the "N matches
still have no score" warning, the sitting-out list, and the history the
matchmaker learns from all read `completed` only.

### Private sessions
Superadmin-only flag. The session appears in Upcoming and History **only** for
the superadmin and the people playing in it, and a direct link 404s for anyone
else — otherwise "hidden" would just mean "unlisted".

It hides the *event*, not its consequences: matches still rate, players still
see them in their own record, rankings still move. Anything wider would be a way
to play games that quietly counted.

---

## 7. Screens

Bottom tab bar: **Home**, a centre **+** (create), **Me**. Hidden when logged
out. A player tapping + is told an admin has to create sessions, rather than
being shown a button that refuses them.

| Route | Purpose |
|---|---|
| `/` | Home. Tabs: **Upcoming** / **History**. Yours first ("You're in"), then "Open to join". |
| `/s/[id]` | Session. Tabs: **Session** / **Standings** / **Matchups**. |
| `/s/[id]/play` | Play console — organizer only. |
| `/s/[id]/edit` | Edit details and roster, before start. |
| `/sessions` | My sessions. Upcoming, my past, other past. |
| `/sessions/new` | Create. |
| `/leaderboard` | Rankings. Tabs: **All** / **Boy** / **Girl**. |
| `/p/[username]` | My rating — the number, history chart, how it works. |
| `/p/[username]/record` | My record — match stats only, no rating. |
| `/me` | Profile, shortcuts, language, version. |
| `/admin` | Roster, invite code, backup, recompute. |
| `/notes` | Release notes. |

### Layout notes worth keeping

- **Session card**: title, then icon-led rows — 🕐 when, 📍 where, 🏟 courts +
  format, 👥 N/M signed up. A diagonal ribbon in the corner reads "Finished" or
  "Playing".
- **Standings**: rank (medal for top three), avatar, name, W–L with the wins in
  the accent colour, point diff, rating change. Your own row is tinted.
- **Matchups** is the only place scores are entered. Rounds don't get played in
  the order generated — courts free up out of sequence — so there is no "your
  next match" to pin. You find the match you played and enter it.
- **Score entry**: your team always renders on top whichever side you're on. A
  fixed A/B order is how people put numbers in the wrong row. Steppers **and** a
  typeable box: eleven taps to record an 11 is absurd. Scores held as text, not
  numbers — coercing on every keystroke makes the box impossible to clear.
- **Matchup filter**: tap two players' avatars to see only the games they share,
  split into "together" and "against". Intersection, not union — "when are we on
  court together" is the actual question.
- **Play console** order: who's here → fixed pairs (if that format) → start →
  rounds. Destructive and near-destructive actions are **two-tap** (add a round,
  end session, delete session, drop a player).
- **My rating** carries the explanation of the method; **My record** carries no
  rating at all, deliberately.

### Everyone's screen has to keep up

A score entered on one phone must reach the others. The web app had this wrong
in a way worth naming, because the native version will meet it differently:
**your own edits looked fine, so nothing seemed broken** — the bug was only ever
visible to the person who *didn't* type the score.

Three separate things were needed, and all three matter:

1. **Invalidate everything a score touches**, not just the page you are on. A
   score moves standings, the leaderboard, both players' profiles and records,
   and the admin roster. Missing one leaves a screen that is confidently stale.
2. **Refresh on returning to the app** — on `visibilitychange` and `focus`.
   Courtside, a phone spends most of its life in a pocket; the moment it comes
   out is exactly when the screen is oldest.
3. **Poll while a session is live**, and only then. Every 20s, skipped entirely
   when the document is hidden, and guarded so a slow response can't stack up
   requests behind it.

Reconcile in place rather than remounting — a full reload courtside loses scroll
position and any half-entered score.

### Two-tap confirmation
Used instead of modal dialogs. First tap arms and relabels the button
("Tap again to delete X"), second acts, and it **disarms after acting** — else
the next stray tap is unguarded again.

---

## 8. Record and stats

Read from `matches`, **not** from rating events: rating events only exist for
rated sessions, so reading history from them silently drops every casual night.
If it was played and scored, it counts here.

Career totals = imported + played here. Shown: played, won, lost, win rate.

**Fun facts**, each needing **at least 3 games together** so one lucky night
doesn't decide it: best partner (highest win rate with), owns the head-to-head
(who you beat most), has their number (who beats you most), most court time.

Also: biggest win, heaviest loss, longest winning streak, point differential, a
margin chart (tall bars comfortable, short ones went to the wire), and **what
each match did to your rating** — with casual games labelled as such rather than
showing a misleading 0.000.

---

## 9. Scoring rules

- Games to 11 by convention, but any whole numbers accepted.
- **No ties** — pickleball has none; reject equal scores.
- Both scores required; 0–0 is a fresh card, not a tie.
- Max 99 per side (a guard against typos).
- Saving a score triggers a full rating recompute.
- Voiding keeps the row with `status = 'void'`; the recompute skips it.

---

## 10. Rankings

One list, sorted by rating descending. Tabs All / Boy / Girl — gender only
decides which table you appear in; "Not listed" keeps you out entirely.

Shows career played and win rate. **Not** the imported breakdown — a ranking
table is for comparing players, and a provenance note beside one name and not
the next invites the wrong comparison. That belongs on the record page.

A `?` after the rating means still settling (reliability < 60%), with a footnote
explaining it. It returns on every self re-seed.

---

## 11. Localisation

Three languages: English, Simplified Chinese, Traditional Chinese. Traditional
is a genuine translation, not a character conversion (儲存/保存, 登入/登录,
設定/设置).

The choice is stored in **two** places: a cookie (what every render reads —
instant, and works before sign-in) and the account row (carries to a new
device). Resolution order: explicit choice → account → device language →
English. Never let a guess override an explicit choice.

Every user-facing string comes from a typed dictionary, including server-side
validation errors — a form that reverts to English on failure is exactly where
it hurts most. Sentences with values use `{braces}`, kept whole: Chinese word
order differs enough that concatenating fragments produces nonsense.

Player lists sort with a locale collator, numbers first, case-insensitive.
Byte order puts every capital before every lowercase, which files `Zeng` before
`fish` and makes a 40-name roster unscannable.

---

## 12. Gaps for the native version

Listed so nothing is assumed, not specified.

1. **Authentication.** Web uses username + 4–6 digit PIN with a group invite
   code, scrypt-hashed, rate-limited to 5 attempts per 15 minutes. Native will
   use email or phone — replace wholesale. Keep `players.role` and the
   permission table.
2. **Admin as in-app purchase.** No equivalent here; admin is granted by the
   superadmin. Decide how that interacts with the role hierarchy — particularly
   whether a purchased admin can run sessions they didn't create (here: no).
3. **Invite codes** become irrelevant if sign-up is open; the registration gate
   is currently the only thing keeping the group private.
4. **Push notifications** — none here. Obvious candidates: session posted, you
   were added, scores in, rating moved.
5. **Offline scoring.** The web app assumes connectivity. A native app courtside
   should probably queue scores. Note the recompute must then run server-side on
   sync, not on device.
6. **Backup.** Weekly cron writes a JSON export of players, matches, sessions,
   signups and rating seeds to a private GitHub repo. PIN hashes deliberately
   excluded. Whatever replaces it, keep the principle: matches and seeds are the
   only irreplaceable data, and they are small.
7. **Share links.** Open Graph tags plus a generated card image give a rich
   preview in group chats. Native equivalent is a share sheet with the same
   summary: when, where, spots left.

---

## 13. Things that were wrong, so you don't repeat them

Each of these was a real bug found in production.

1. **Multi-pass recompute drifts.** See §3.8.
2. **Self-declared reliability made unproven players immovable.** A player who
   had never played could be 88% reliable and therefore hard to correct — the
   least verified number was the hardest to fix. Only matches count as evidence;
   a declaration sets a floor, not a score.
3. **Greedy round generation can't keep a whole-schedule promise.** §4.1.
4. **Weighting variety above balance makes "balanced" a lie.** §4.2.
5. **Capacity counted signups, not attendees**, so a no-show held a seat and
   adding a walk-in silently waitlisted them — the button looked like it worked.
6. **`ALPHA` too low inverted the sign** for an underdog losing narrowly: we
   took rating away from a performance DUPR rewards.
7. **A linear K between two endpoints cannot fit DUPR** — it implies a negative
   K for established players. §3.4.
8. **Timezones.** Render dates identically on server and client for the first
   paint or hydration will leave the server's text in place forever. The web fix
   was to pin the pre-hydration pass to UTC and let the client correct it.
9. **A cap that binds on ordinary results stops being a guard** and becomes the
   answer, flattening the signal it was protecting.
10. **Tightening reliability silently changed how fast ratings move.** K is a
    function of reliability (§3.4), so slowing the reliability curve left
    everyone at a high K for far longer — a change to one thing that was really
    a change to two. When you retune either, measure the other. §15.
11. **Filtering a voided match out of the query deleted it in the eyes of the
    people who played it.** Keeping the row is not the same as keeping the
    record. §6.
12. **A refresh bug can be invisible to whoever is testing it**, because the
    person entering a score always sees their own result. Test with two
    sessions, not one.
13. **Enforcing a constraint at the wrong stage makes it fight everything
    else.** The gender rule looked like it had to be traded against partner
    rotation until it moved from the pairing step to the grouping step, where
    it costs nothing. Before assuming two goals conflict, check whether they are
    even being decided at the same moment. §4.4.
14. **The largest constant in a system belongs where the evidence is
    thickest, not thinnest.** A 1.25 multiplier on a new player's first five
    matches made K larger than anywhere else in the engine, on the least data.
    Every outlier in 160 matches lived inside it. §3.4.
15. **A scale minimum is not a plausible value.** Letting an unsettled rating
    reach the floor put a first-time player 0.06 off the bottom of the whole
    scale after one evening. §3.5.
16. **A capacity rule that is right for a player is wrong for the organizer.**
    Sharing it silently waitlisted the walk-in standing on the court. §5.
17. **Removing a constraint can make the *inputs* worse.** Correctly refusing
    to pair the only two women meant their weakness was spread across fourteen
    of twenty matches instead of concentrated in a few, which is why the first
    gender-balanced night was also the most one-sided. Check what a rule does
    to the distribution, not just to the rule. §4.4.

---

## 14. Test coverage worth porting

261 tests. The ones that earn their keep:

- **17 DUPR forecast readings** as a regression fixture (§3.7). If a retune
  breaks the signs, this fails.
- **Perfect round robin** — 36 partnerships from 9 players, verified across 40
  seeds so a real session isn't a coin flip.
- **Fixed-partner scheduling** — even court time, no pair twice in a round,
  fresh matchups spent before repeats.
- **Balanced mode** — mean team gap under 0.05 across a whole session.
- **Dated tuning** — an old match replays to a hardcoded constant, not to
  whatever the engine does today.
- **Gender balance** — zero violations across eight roster shapes, *and* that
  partner coverage is unchanged versus the plain round robin, *and* that the
  impossible case (10M/2F over a full round robin) returns exactly its floor of
  1 rather than throwing or giving up.
- **Medal bracket** — 1 v 4 and 2 v 3 from the table; gold provably the two
  semi-final *winners* and bronze the two *losers*; an upset carried through
  rather than the seeding being replayed; and a dead tie ordered the same way
  twice, so two organizers cannot get two brackets.
- **Dated tuning, both directions** — that the first-matches boost is gone
  under the current tuning *and* still applies under the previous one, so an
  old match keeps what it was played under.
- **The provisional floor is a floor** — it catches a fall, and never lifts
  somebody who was already below it.
- **Full-history replay** — every stored rating reproduces bit-identically
  after any engine change. This is the one that catches real mistakes; run it
  against production data, not a fixture.
- **Permission matrix** — every row of §6.

---

## 15. Audit findings — two fixed, two open

An audit of the rating engine against real play (now 160 matches, 592 rating
events, 65 rated players) turned up four things. **Two have since been fixed and
two are open on purpose.** Recorded so you inherit the reasoning rather than the
surprise, and so you don't "fix" an open one and silently diverge from a rating
the group has already accepted.

Anything you do change here goes in as a **new epoch** (§3.9), never as an edit.

### Fixed in v1.4

**1. The first five matches ran hotter than any evidence supported.**
`CAL_MULT 1.25 × K_BASE 0.98` gave **K = 1.23** — the largest number in the
system, where the evidence is thinnest. Events inside that window averaged a
0.229 move against 0.080 everywhere else, and every outlier lived there. It
finally produced **+1.269 in one evening** (2.50 → 3.77 in eight games), half
again as large as anything the system had ever done. `CAL_MULT` is now 1.0. Do
not put it back; see §3.4.

**2. A provisional rating could be driven to the bottom of the scale.**
A player's *first ever* session left them at **2.063** against a `MIN` of 2.000,
on eight games of evidence. `PROVISIONAL_FLOOR = 2.5` now catches that; see
§3.5. Replaying the same night under the new tuning puts them at 2.500 instead.

### Still open — leave them alone unless asked

**3. An admin rating correction can also grant 100% reliability, permanently.**
One form does two very different things: correcting someone's number, and
declaring them fully settled. Three players were re-seeded to 100% this way.
Because `declaredFloor` never decays, their K drops to ~0.157 and results can
barely move them again; in one case a re-seed also superseded eight matches of
contrary evidence. Consider separating the two fields, or capping an
admin-granted floor below 100% so results always retain some pull.

**4. A declared reliability can never be earned back down.** It is a free-text
field at signup, unverified, and `max(declaredFloor, …)` makes it permanent.
Nine players sit at 100%. Even DUPR decays reliability when you stop playing.

### The one that was never a bug

**`regular` sets `balance: 0` deliberately.** Across real sessions it produces a
mean team gap of **0.27–0.46** and a worst of **1.44**, against **0.06–0.13**
for fixed partners. That is the direct cause of the largest rating swings — the
engine reacting faithfully to genuinely lopsided input. If ratings look
volatile, this is why, and the answer is the organizer choosing a format that
balances, not a change to the engine. The gender format *did* get a balance term
in v1.4 (§4.4) because its structure made the problem materially worse; the
plain round robin keeps its rating-blind draw.

Two further observations, no action wanted:

- **About 1 result in 10 moves against the scoreline** (5% won-but-lost-rating,
  5% lost-but-gained). This is *correct* — DUPR's own forecast has an underdog
  gaining +0.119 for a 9–11 loss — and follows directly from `ALPHA = 1`. It is
  also the single biggest credibility risk with players, so explain it in the
  UI rather than tuning it away.
- **Reliability reads lower across an epoch boundary** for the same player, when
  old matches replay under old constants. Cosmetic, and the unavoidable price of
  never moving a result someone has already seen.


## 16. Updates through v1.7 (2026-09-26)

Use PORT-v1.7.md as the native implementation checklist. This section supersedes
older descriptions of initial-only pairing, soft gender penalties or D_POINTS.

### v1.5: custom rounds and fixed-team results

Ordinary live sessions offer **Add another round (random)** and **Add another
round (custom)**, even before existing rounds finish. A custom court has exactly
four distinct attending players; nobody may appear twice in the same round.
The fixed-partner medal workflow remains separate: auto 1v4 / 2v3 semifinals,
winners for gold and losers for bronze; custom bracket selection at both stages.
Custom medal teams must be actual fixed pairs. Fixed standings show both partners
on each team, both receive its medal, and the standings page includes the bracket.
Do not relabel a surviving bronze game as gold when another game is voided.
The initial fixed draw uses complete team round-robin cycles; 8 teams / 4 courts /
7 rounds means 28 unique team matchups, with no opponent repeats.

### v1.6: record insights, calibration and repeat sessions

The record page adds How you play: stronger/even/weaker opposition, recent form,
format splits, close games. Use pre-game average ratings but the current
expectation curve for these *display-only* comparisons. EVEN_BAND=0.15,
MIN_GROUP=5, FORM_MIN=12, FORM_RECENT=10, CLOSE_MARGIN=2, MIN_CLOSE=4,
ABOUT=0.03. Casual games count in ordinary totals but not rating expectations.
Implementation: src/lib/profile/insights.ts and its tests.

Current expected point-share spread D_POINTS=2.05 (previously 1.33). The web
app adopted it at 2026-09-21T12:00Z. K, caps, reliability rules were unchanged.
Do not rewrite past native results: use the native app's own adoption boundary.
New registration requires an explicit starting-level choice.

Copy a finished session prepopulates title, location, courts, capacity, format,
notes and rated setting; move date to the next occurrence of that weekday/time.
Do not copy players or matches. Only permitted actors copy private visibility.
Nothing is created until the organizer reviews the form and submits.

### v1.7: Mini MLP

Six squads, each 2 men + 2 women, exactly 4 courts and 24 players. Persist six
named squad rows plus separate encounter rows. Each squad defines its two fixed
mixed pairs before generation: m1+w1 and m2+w2. The app creates opposing matchups.
Once the draw exists, team membership, attendance and mixed pairings lock for
the entire session, including playoffs. No per-encounter lineup editor.

Each encounter contains four ordinary doubles games: women, men, mixed1,
mixed2. Women/men share a wave on two courts, followed by both mixed games on
those same courts. The following zero-indexed team blocks cover all 15 opponents
exactly once, at most two disjoint encounters per four-court block:

```
[(0,5),(1,4)], [(2,3),(0,4)], [(5,3),(1,2)], [(0,3),(4,2)],
[(5,1),(0,2)], [(3,1),(4,5)], [(0,1),(2,5)], [(3,4)]
```

Each block takes two waves. That is 60 round-robin games / 16 waves / 10 games
per player. After all 15 encounters resolve, seed 1v4 and 2v3; then their
winners contest one final. Each playoff encounter also has four games. No
DreamBreaker or bronze match. Total: 72 games / 20 waves; no promise of a
particular duration because individual game scoring is organizer-dependent.

Encounter winner: most games won; at 2–2, greater sum of points; equal sums
require the organizer to record a winner. All four games must have valid,
non-tied integer scores (0–99). A void leaves an encounter unresolved until
restored. Round-robin standings order by team wins, game difference, point
difference, points scored, then setup slot. This final tie rule is displayed.
Playoffs never change the round-robin seeding table. Team cards display both
mixed pairs; aggregate cards and the bracket show team results.

Keep each underlying game in the player's normal record and rating history;
there is no second rating event for an encounter win. Reuse score permissions:
live participants/admins can score; closed sessions require organizer/superadmin.
Clear an organizer tie decision after any score change. Once a downstream
stage exists, protect its source results. Removing the last completely unplayed
stage allows correction and regeneration; stages with scores/voids stay intact.

### v1.7: integrity and recovery

Fixed pairs are now structural in incremental/rebuilt draws; edit live pairs
atomically and symmetrically before medal play. Existing stored matches retain
original players. Gender generation rejects MM-versus-FF outright; fallback
sacrifices partner coverage when needed. No past sessions are regenerated.

Discard only the last unplayed round in the caller's authorized session; a void
also protects it. Ordinary score entry never restores a void. Private sessions
publish generic preview metadata and images, even to authenticated link crawlers.

Rating caches publish together in one transaction with a global advisory lock
acquired before reading history; concurrent replays queue. A failed rebuild
leaves both previous caches available. No v1.7 rating retuning.

Backup schema 2 includes sanitized full player profiles, rating seeds, sessions,
signups, rounds/stages, MLP squads/encounters and matches in one consistent
snapshot. It omits PIN hashes, auth tokens, settings/invite secrets, login attempts
and audit details. Restore players with fresh PINs, then seeds/sessions/signups,
rounds/teams/encounters/matches in dependency order; recompute derived caches.
Reissue invite/auth settings separately. Existing web auth remains unchanged.

The web runtime is now Next.js 16.3.6 to include official security fixes; the
native app does not need to copy this dependency. Shared agent instructions are
in AGENTS.md, PROJECT.md and WORKLOG.md. They are part of the handoff workflow.
