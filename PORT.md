# PicklePlay — port specification

Everything the web app does, written for someone rebuilding it natively. This
is a description of behaviour, not of the TypeScript: where an algorithm matters
the constants and the formula are given so the result can be reproduced exactly.

The reference implementation is a Next.js web app backed by Postgres. Anything
tied to that stack — server components, Drizzle, Vercel — is an implementation
detail and is called out as such.

**Deliberately out of scope here:** sign-in (the web app uses a username + PIN
with an invite code; the native app will use email or phone), payment, and
anything about the App Store. Those are noted in §12 as gaps, not specified.

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
`session_id`, `index` (1-based), `state`. Unique on `(session_id, index)`.

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
D_POINTS = 1.33      // the expected point share
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
CAL_MATCHES = 5     CAL_MULT = 1.25
SEED_FLOOR_MATCHES = 5   K_SEED_FLOOR = 0.15
```

Two regimes, crossing at about **89% reliability**:

- **Below it**, reliability decides. `k ≈ 1 − reliability`, measured directly.
- **Above it**, reliability has saturated — it can't tell twenty logged matches
  from a thousand — so the *depth of the record* takes over as a floor.
  `halfLife` is the decayed match count (§3.6).

The floor matters: the power law reaches exactly zero at 100%, which would
freeze a fully established player forever. DUPR does not do that.

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

Every delta in a match is computed from the **pre-match** ratings and applied
afterwards, so the order you walk the four players cannot change the result.

### 3.6 Reliability — how trustworthy the number is, not how good the player

Counts **distinct partners** and **distinct opposing pairs**, each remembered
once with the time last seen and a weight. Not raw match count: ten games with
the same three people teach less than six against six different pairs.

```
waypoint(x, at60, at100):
    if x <= 0:      0
    if x <= at60:   0.6 * (x / at60)
    else:           0.6 + 0.4 * min(1, (x - at60) / (at100 - at60))

reliability = max(declaredFloor, min(waypoint(partners), waypoint(teams)))

PARTNERS_AT_60 = 2   PARTNERS_AT_100 = 4
TEAMS_AT_60    = 6   TEAMS_AT_100    = 12
RELIABILITY_PASS = 0.6      // below this the rating shows a "?"
```

Both conditions must hold, so take the **lower** of the two.

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

Four formats offered: **regular**, **balanced**, **fixed**, **custom**.
(`king`, `social`, `manual` exist in the enum for old rows; don't offer them.)

Common shape: a round holds one match per court in use;
`seats = min(courtCount, floor(players / 4)) * 4`. Anyone spare sits out, and
sit-outs are shared as evenly as the numbers allow.

### 4.1 Regular round robin — partner everyone once

The promise is a property of the **whole schedule**, not of any single round, so
it is solved as one problem. Nine players over nine rounds need exactly the 36
partnerships that exist, which makes it a decomposition of the complete graph.

Algorithm, per attempt (≈60 randomized restarts):

1. Choose who rests: most games played rests next; among equals, whoever has
   rested least often.
2. Find a perfect matching on the seated players using **only partnerships
   nobody has had yet** (backtracking, shuffled candidate order).
3. Group those pairs into matches, choosing the grouping that minimises repeated
   opponents (exhaustive — there are few groupings at ≤4 courts).
4. If a round can't be matched, retry with different rest choices (8 tries),
   then abandon the attempt.

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
regular   { balance:   0, partner: 50, opponent: 3, spread: 0 }
balanced  { balance: 100, partner:  6, opponent: 2, spread: 4 }
fixed     { balance: 100, partner: -8, opponent: 2, spread: 4 }
```

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

A negative `partner` weight is how fixed-partner play is expressed through the
same machinery when no explicit pairs are set.

### 4.3 Fixed partners

Pairs are **chosen by the organizer before the session starts**, not inferred.
Once they exist the problem changes shape: partners stop being something to
solve for and what remains is a round robin between *teams*.

- Store the partner on each signup row; both rows point at each other.
- Editable only while `status = 'open'`.
- Anyone left unpaired **does not play**. Pairing is the point of the format;
  inventing a partner is the worse surprise. Show the unpaired count.
- Scheduling: each round seats `min(courts, floor(pairs/2))` matches. Pick the
  pair with fewest games, then the opponent it has met least often (ties broken
  by fewest games). Unlike the regular planner this never gives up — a long
  night simply replays opponents.
- Result for 4 pairs over 6 rounds: a complete double round robin, every pair
  meeting every other exactly twice, six games each.

### 4.4 Custom
Rounds are still generated (balanced weights), but the organizer expects to
rearrange courts by hand.

### 4.5 Suggested round count

For a regular round robin there is an exact right length; offer it and warn when
the chosen number splits unevenly.

```
seats        = min(courts, floor(players/4)) * 4
splitsEvenly = (rounds * seats) % players == 0
gamesEach    = rounds * seats / players
```

Nine players on two courts → 9 rounds, 8 games each, one sitting out per round,
and you partner everyone exactly once.

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

A session auto-closes 24 hours after its start time, so a night nobody ended
doesn't linger in Upcoming. The sweep runs lazily on page loads plus in the
weekly cron.

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
| Enter a score, session closed | organizer only — it's a record now |
| Void a match | organizer / admin (never on "I played in it" alone) |
| Adjust another player's rating | admin, but only players and themselves |
| Adjust an admin's or the superadmin's rating | superadmin only |
| Reset a PIN | admin for players; superadmin for admins |
| Invite code, recompute, backup, delete account, private sessions | superadmin |

Being an admin is not permission to rewrite a peer's rating: that turns every
disagreement into an edit war with no referee.

**Enforce every one of these server-side.** Hiding a button is not a permission
check.

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

---

## 14. Test coverage worth porting

212 tests. The ones that earn their keep:

- **17 DUPR forecast readings** as a regression fixture (§3.7). If a retune
  breaks the signs, this fails.
- **Perfect round robin** — 36 partnerships from 9 players, verified across 40
  seeds so a real session isn't a coin flip.
- **Fixed-partner scheduling** — even court time, no pair twice in a round,
  fresh matchups spent before repeats.
- **Balanced mode** — mean team gap under 0.05 across a whole session.
- **Dated tuning** — an old match replays to a hardcoded constant, not to
  whatever the engine does today.
- **Permission matrix** — every row of §6.
