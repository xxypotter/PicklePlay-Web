# PicklePlay — Pickleball Session Organizer + Mock DUPR

> **PicklePlay.** A mobile-first web app for organizing recurring pickleball
> sessions within a small private group, with auto-generated matchups and a
> simulated DUPR-style rating — the **PicklePlay Rating (PPR)** — that tracks every
> player's match record.

**Status:** Spec / pre-build
**Last updated:** 2026-08-03

---

## 1. Why this exists

We previously built this as a native iOS app. App Store review turned every change
into a multi-week wait. This version is a **web app** — no store, no review, no
install gate. Users open a link, and can optionally add it to their phone home
screen (PWA) where it looks and behaves like a native app.

Reference point for the general shape: `raliera.com/m/12` (ERA Pickleball's public
per-session page). We're building the same *session-organizing* core, plus the part
they don't have — **a mock DUPR** and a persistent per-player match record.

### What makes this different from the reference
- Every match feeds a **simulated DUPR rating** (2.000–8.000, 3 decimals).
- Persistent **player profiles**: total matches, W/L, win %, point differential,
  rating history chart, peak rating, current streak.
- **Auto-matchmaking**: the app builds every round — balanced teams, partner
  rotation, court assignment, fair sit-outs.
- **No email, no real DUPR linkage, no OAuth.** Username + PIN only.

### Explicitly out of scope
- **Doubles only.** No singles matches, no singles ratings, anywhere.
- No payments, no court booking/reservations, no public discovery.
- No *live* connection to real DUPR. A player types in their real DUPR once as a
  starting point (§5.7), but nothing syncs and we never scrape DUPR. Our number is
  labeled **"PicklePlay Rating (PPR)"** and is never presented as an official DUPR.
  (DUPR is a trademark — we simulate the *idea*, we don't claim to be it.)
- Not designed for thousands of users. Target: **10–150 players**, one community.

---

## 2. Decisions locked in

| Area | Decision |
|---|---|
| Stack | Next.js (App Router) + TypeScript, hosted on Vercel |
| Database | **Neon Postgres** (free tier), accessed via Drizzle ORM — see §2.1 |
| Auth | Username + 4–6 digit PIN. No email, no reset link — admin resets PINs. Custom, hand-rolled. |
| Format | **Doubles only.** |
| Ratings | Seeded from the player's real DUPR + reliability at signup. **Public to everyone.** Player may re-seed once per 30 days (§5.8). |
| Matchmaking | **Full auto** from day one — app generates rounds, teams, courts |
| Score entry | Any player in the match can submit. No confirmation step. Admin can edit or void anything afterward. |
| Delivery | Responsive mobile-first web + PWA manifest (add to home screen) |

### Why these
- **Vercel + Next.js**: free tier covers this easily, deploys in ~60s, gives a real
  HTTPS URL immediately, and server components keep rating math on the server where
  it can't be tampered with.
- **Username + PIN**: works on a new phone, survives clearing browser data, and
  still requires zero personal information. Device-only auth was rejected because
  losing your browser storage would orphan your entire rating history.
- **No score confirmation**: in a small trusted group, pending-confirmation queues
  just rot. Admin edit + full recompute (§5.6) makes any mistake cheap to fix.

### 2.1 Why Neon

Neon and Supabase are both Postgres, so this is a hosting choice, not an
architecture choice — either way, Next.js server code talks to a connection string
through Drizzle. (The option worth avoiding was never Supabase; it was the *static
site + browser-side database client* pattern, where rating math runs in the browser
and row-level security is the only thing between a player and their own rating.
We're not doing that under any vendor.)

**Neon wins on the one thing that matters most here: it never pauses.**

| | Neon Free | Supabase Free |
|---|---|---|
| Inactivity pause | **None.** Compute scales to zero after 5 min, wakes in a few hundred ms | **Pauses after 7 days** of low activity; manual restore; permanently deleted if left paused |
| Keep-alive cron | **Not needed** | Required, forever |
| Storage | 0.5 GB / project | 0.5 GB |
| Compute | 100 CU-hours / project / month | — |
| Instant restore | 6 hours | — |

Dropping the keep-alive requirement removes a permanent, silent failure mode: a
cron that breaks without anyone noticing eventually takes the whole database with
it. Here there's nothing to break.

#### The two Neon constraints we design around

**1. 100 CU-hours per month.** Minimum compute is 0.25 CU, so that's roughly 400
hours of *awake* database per month out of ~730. Realistic usage — two 3-hour
sessions a week plus casual browsing — is about 26 hours awake, call it 7 CU-hours.
Enormous headroom.

There is exactly one way to blow it: **anything that polls.** A live-scores page
refreshing every 5 seconds keeps compute awake 24/7 and would burn the monthly
quota in under two weeks. So, as a standing rule for this codebase:

> **No client-side polling loops.** Refresh on user action, on navigation, or on
> explicit pull-to-refresh. If we ever add live score updates to the session page,
> the interval must be ≥60s and must run only while session status is `live`.

**2. A 6-hour instant-restore window.** Shorter than it sounds. If a bad admin edit
or a bug corrupts data on Friday and nobody notices until Sunday, Neon cannot
rewind that far.

So we still build the **weekly JSON backup** (M1): a cron dumps `players`,
`matches`, and `rating_seeds` and commits them to a private GitHub repo. Because
matches are the only source of truth and ratings are always recomputed (§5.6), that
dump is a **complete, restorable backup of the entire product** — a few hundred KB.
It also means we're never locked in: restoring it into Supabase or anywhere else is
a single script.

#### Dev and production are separate databases

Local development runs against a **`pickleplay_dev`** database on the same Neon
project; production uses `neondb`. Before this split, every test run wrote to
live player data — which is exactly how a dozen `dev_*` accounts once ended up
on the real leaderboard.

- `.env.local` points at `pickleplay_dev`. `npm run db:migrate` only ever
  touches dev.
- `DATABASE_URL_PROD_UNPOOLED` in `.env.local` points at `neondb`, and is used
  **only** by `npm run db:migrate:prod`, which has its own drizzle config. Two
  separate configs rather than one flag, so the destructive one can't be reached
  by a typo.
- `npm run db:seed` creates twelve `dev_*` test players; `npm run db:seed purge`
  removes them. The purge only ever matches the `dev_` prefix, so it cannot
  touch a real account even if pointed at the wrong database.

A Neon *branch* would be marginally better (copy-on-write, so you can test
against a copy of real data), but a separate database on the same project needs
no console trip and gives the isolation that actually mattered.

#### Two setup details that bite

- **Use Neon's pooled connection string** (the `-pooler` hostname), not the direct
  one. Vercel functions are serverless and will exhaust Postgres connections
  otherwise. This is the single most common way this setup breaks.
- **Cold starts:** after 5 idle minutes, the first query pays a few hundred extra
  ms. Acceptable, and hidden behind a loading state.

---

## 3. Users and roles

| Role | Can do |
|---|---|
| **Player** | Register, RSVP to sessions, join waitlist, view roster, submit scores for matches they played in, view all profiles and the leaderboard |
| **Admin** | Everything a player can, plus: create sessions, run **their own** sessions end to end (details, roster, rounds, start/end, delete), enter scores for any match in a session that is still running, share and rotate the invite code, reset a player's PIN, seed starting ratings, trigger a recompute |
| **Super admin** | Everything, on **anyone's** session, plus the **sole** authority to grant or remove admin |

### 3.1 Session ownership

Being an admin says nothing about *whose* night you may touch. Creating a
session makes you its **organizer**, and organizing is what grants control over
it:

| Action | Who |
|---|---|
| Edit details, add/remove players, start, generate rounds, end, delete | Organizer, or super admin |
| Enter or change a score, **session still running** | Anyone who played in the match, or any admin on hand |
| Enter or change a score, **session closed** | Organizer, or super admin |
| Void a match | Any admin while running; organizer once closed |

With two admins a blanket "admins manage sessions" rule was merely untidy. With
ten it means anyone can restart someone else's night, rebuild their schedule, or
delete it out from under them — so control is scoped to the person actually
running the game.

Scoring is deliberately the loose one *while the night is live*: whoever is on
court needs to enter the number, and waiting for the organizer to walk over is
how scores get lost. Once the session closes the result stops being a scoreboard
and becomes a record, so amending it narrows back to the organizer.

A session whose creator was deleted (`created_by` goes null) falls to the super
admin rather than to everyone.

**There is exactly one super admin** — the first account ever registered. No UI
creates a second, so the group always has one unambiguous owner.

Admins deliberately **cannot** grant admin. If they could, the first person you
promote could promote everyone else, and "one person decides who runs the group"
would stop being true after a single hop.

Two guardrails on role changes:
- You can't change your own role, so the last super admin can't demote themselves
  and orphan the group.
- Demoting an admin **revokes all their sessions immediately**, rather than
  leaving admin powers live on an open phone until a 90-day cookie expires.

> "Organizer" was folded into Admin. In a group of 8–16 a separate session-runner
> tier earned nothing and made permission checks harder to reason about.

**Enforcement:** the pure policy lives in `lib/auth/policy.ts` (importable from
client components and unit tests); `lib/auth/permissions.ts` holds the
`requireRole` helpers that read the session, and `lib/sessions/guards.ts` holds
the session-scoped `requireOrganizer` / `requireScorer`. Every server action
calls one as its first statement — a hidden button is not a permission check,
because a server action is a public HTTP endpoint. Verified by replaying a
captured score submission as a non-owner admin: rejected, and nothing written.

---

## 4. Core flows

### 4.1 Registration
1. User opens the app, taps **Create account**.
2. Enters a **username** — 3–20 chars, letters/numbers/underscore/hyphen.
   - Uniqueness is **case-insensitive**. `MikeD` and `miked` are the same name.
   - First to register a name owns it. Later attempts fail with:
     *"That name is taken. Try another."* — no hint about who owns it.
   - A small reserved list (`admin`, `root`, `system`, `rr`) is blocked.
3. Sets a **4–6 digit PIN**, entered twice. Stored as an Argon2id hash.
4. Enters their **current real DUPR and reliability %** to seed their PPR
   (§5.7). Both optional — there's a plain-language skill picker as a fallback for
   players who don't have a DUPR.
5. Done — logged in, session cookie lasts 90 days.

Optional display name (e.g. "Mike D.") can be set later; username is immutable and
is the URL slug (`/p/miked`).

### 4.2 Session lifecycle
1. Organizer creates a session: title, date/time, location, **court count**,
   **max players**, format (§6), and whether results count toward ratings.
2. Session gets a **public shareable link** (`/s/<id>`) — anyone with the link sees
   the roster and scores; RSVP requires login. This is how it gets shared to the
   group chat.
3. Players RSVP **In** / **Out**. Once `max_players` is reached, further RSVPs go to
   a **waitlist** with visible position. If someone drops, the top of the waitlist is
   promoted automatically.
4. On game day, organizer opens the **Play console**, marks who actually showed up,
   and taps **Generate Round 1**.
5. App displays each court's matchup. Anyone can tap a court and enter the score.
6. When all courts report, organizer taps **Generate Next Round** — the generator
   accounts for who has already partnered, who has already played whom, and who has
   sat out.
7. Organizer **closes** the session. Ratings are recomputed and the leaderboard
   updates.

### 4.3 Score entry
- Tap a court → big number steppers for each team's score → **Save**.
- Default target 11, win by 2 — validated but **overridable** (games to 15/21,
  or timed games ending 8-6, are allowed).
- Rejects: negative scores, tie scores, and a score where the loser exceeds the
  winner.
- Every submission records `entered_by` and a timestamp. Edits are logged.

---

## 5. The rating engine (the important part)

DUPR's exact formula is proprietary and unpublished. What *is* publicly known and
consistently reported is its observable behavior, and that's what we reproduce.

### 5.1 Behaviors we must reproduce
These are the signature DUPR characteristics, and our model is validated against
each one in §5.5:

1. **Who you play matters far more than whether you win.** Opponent strength is the
   dominant factor.
2. **You can go up in a loss** — losing 9–11 to a much stronger team raises you.
3. **You can go down in a win** — beating a much weaker team 11–9 lowers you.
4. **Score margin matters, but only a little.** Winning 11–0 instead of 11–9 is a
   small bonus, not a large one.
5. **New players move fast, established players move slowly.**
6. **Ratings compress at the extremes** — it gets progressively harder to move as
   you approach the ceiling or floor.
7. **Recent matches count more than old ones** (exponential decay / "half-life").
8. **Doubles uses the team average**, but partners don't move by identical amounts.

### 5.2 Notation

```
r_i          player i's current rating (2.000 – 8.000)
T_a          team A rating  = (r_a1 + r_a2) / 2
T_b          team B rating  = (r_b1 + r_b2) / 2
p_a, p_b     points scored by team A, team B
S            team A's actual point share = p_a / (p_a + p_b)
W            1 if team A won, 0 if lost
```

### 5.3 The formula

**Step 1 — Two expectations.** One for point share, one for win probability. The
win-probability curve is deliberately steeper.

```
E_points = 1 / (1 + 10^((T_b - T_a) / D_POINTS))     D_POINTS = 1.75
E_win    = 1 / (1 + 10^((T_b - T_a) / D_WIN))        D_WIN    = 1.00
```

*Calibration:* `D_POINTS = 1.75` means a 1.00 rating gap predicts roughly an 11–3
result (78.6% point share); a 0.50 gap predicts about 11–6. `D_WIN = 1.00` means a
1.00 rating gap predicts a ~90% win probability, a 0.50 gap ~76%.

**Step 2 — Blend margin against pure win/loss.**

```
Expected = ALPHA * E_points + (1 - ALPHA) * E_win     ALPHA = 0.35
Actual   = ALPHA * S        + (1 - ALPHA) * W
Surprise = Actual - Expected
```

`ALPHA = 1.0` puts the whole signal on the score and nothing on the bare fact of
winning. This is measured, not assumed: DUPR's own Forecast (screenshots in
`dupr forecast/`) gives three outcomes of one match as −0.090 at 3–11, **+0.033**
at 6–11 and **+0.119** at 9–11. All three are losses, so the entire 0.209 swing
is margin, and DUPR's wording is "score at least 6 points to see your rating
rise". At the old 0.35 we returned the wrong sign for an underdog losing
narrowly. Kept as a parameter because every forecast we have is a loss, which
pins `ALPHA × K` but cannot rule out a win bonus.

**Step 3 — Per-player K factor.** Each player has their own K, derived from their
own reliability (§5.4), which is why partners move by different amounts.

```
K_i = K_RELIABLE + (K_NEW - K_RELIABLE) * (1 - reliability_i)

K_NEW       = 0.98     # reliability 0 — brand new
K_RELIABLE  = 0.017    # reliability 1 — fully established
```

During a player's first `CAL_MATCHES = 5` matches, K is multiplied by
`CAL_MULT = 1.25` so new players converge on their true level quickly.

**Seed floor.** Until a player has played 5 real matches *in this group*, K is
floored at `K_SEED_FLOOR = 0.043` regardless of the reliability they declared at
signup. Without this, someone could type "4.5, 100% reliable" and be nearly
immovable on the strength of a number nobody verified (§5.7).

**Step 4 — Edge compression.** Shrink moves that push toward the floor or ceiling.

```
if delta > 0:  compress = clamp((RATING_MAX - r_i) / 1.5, 0, 1) ^ 0.5
if delta < 0:  compress = clamp((r_i - RATING_MIN) / 1.5, 0, 1) ^ 0.5

RATING_MIN = 2.000    RATING_MAX = 8.000
```

**Step 5 — Apply, with a cap.**

```
delta_i  = K_i * Surprise_i * compress_i      # Surprise negated for team B
delta_i  = clamp(delta_i, -CAP, +CAP)
r_i_new  = clamp(r_i + delta_i, RATING_MIN, RATING_MAX)

CAP = 0.25 if provisional else 0.10
```

Doubles only — there is no singles path anywhere in this formula or the product.

### 5.4 Reliability

Reliability answers "can this number be trusted?", never "is this player any
good". A beginner who plays every week is fully reliable; a 5.0 who has played
twice is not.

It follows DUPR's published doubles waypoints rather than a formula of our own:

| | Unique partners | Unique opposing teams |
|---|---|---|
| **60% — reliable** | 2+ | 6+ |
| **100%** | 4+ | 12+ |

```
partners = Σ over distinct partners of  weight(them) × 0.5^(days_ago / 90)
teams    = Σ over distinct opposing pairs of weight(pair) × 0.5^(days_ago / 90)

reliability = max(declared_floor, min(scale(partners, 2, 4), scale(teams, 6, 12)))
```

`scale` is linear to 60% at the first waypoint, then linear to 100% at the
second — two segments because DUPR publishes both points and the second half of
the journey costs three times the first.

**Distinct is the point.** Ten games with the same partner teach the system what
one game does. Counting raw matches rewarded turning up; counting distinct
partners and opposing pairs rewards *mixing*, which is what actually pins a
rating down. A 9-player round robin produces 8 partners and 8 opposing pairs in
one night, which is why a single session settles a newcomer.

**`min`, not an average.** Both conditions must hold. Twelve different pairs
while always partnering the same person still leaves that pairing unmeasured.

**Weighting by who you played.**

```
weight(them) = 0.5 + 0.5 × min(1, their_reliability / 0.60)
```

DUPR weights results by the reliability of the people involved. Taken literally
that never starts: a new group is all zeroes, so nobody can lift anybody. The
floor fixes it without penalising anyone — someone already at 60% counts a full
1.0, exactly as a head-count would, so an established group is unaffected and
only a group of strangers takes longer. Measured:

| | One night | Two nights |
|---|---|---|
| Joining established players | **71% — reliable** | 100% |
| Everyone starting cold | 53% | **88% — reliable** |

**Decay.** Each encounter fades on the same 90-day half-life as match evidence,
measured against the most recent event in the *whole* timeline. An inactive
player therefore fades only relative to a group that keeps playing, which is
what makes a stale number honest: after a year away while the group carried on,
90% falls to 5% and the `?` returns.

A player is **provisional** — shown with a `?` after their rating — while
reliability is under 60%.

> **Deviation from real DUPR, on purpose.** Real DUPR includes *connectivity to the
> global player pool*. In a closed group of 20 people that term is meaningless, so
> we substitute **opponent variety within the group** — it measures the same thing
> (is this rating anchored, or built on one repeated matchup?) at our scale.

### 5.5 Worked examples — validating the behaviors

All examples use an established player (`K = 0.017`), game to 11.

| Scenario | Surprise | Δ rating | Behavior shown |
|---|---|---|---|
| Even teams, win 11–9 | +0.343 | **+0.0058** | Normal win |
| Even teams, win 11–0 | +0.500 | **+0.0085** | Margin adds only ~0.003 → #4 |
| Underdog by 1.00, win 11–9 | +0.709 | **+0.0121** | Upset richly rewarded → #1 |
| Favorite by 1.00, win 11–2 | +0.079 | **+0.0013** | Expected win barely counts |
| **Favorite by 1.00, win 11–9** | **−0.024** | **−0.0004** | **Down in a win → #3** |
| **Underdog by 1.00, lose 9–11** | **+0.024** | **+0.0004** | **Up in a loss → #2** |
| Same as row 1, but brand-new player (K=0.25) | +0.343 | **+0.0856** | New players move fast → #5 |

The last two rows are the tell that the model is right — they're the exact DUPR
quirks players notice and talk about.

### 5.6 Recompute-from-scratch architecture

**Matches are the only source of truth. Ratings are always derived, never stored as
authoritative state.**

On any change — a score edit, a voided match, a constant retune — we replay the
entire history in chronological order and rebuild every rating. For our scale
(<150 players, <20k matches) this runs in well under a second.

The replay walks a **merged timeline of two event types**: completed matches, and
**seed events** (§5.7, §5.8). Hitting a seed event sets that player's rating to the
declared value and restarts their imported-evidence clock; hitting a match applies
§5.3. This is what makes monthly re-seeding safe to support — a re-seed is just
another dated event in history, not a destructive overwrite.

**The replay is a single chronological pass.**

An earlier version of this spec called for running it 4 times, each pass seeded
from the previous pass's final ratings, so that late information could flow
backward and re-score your first match once we knew how strong that opponent
really was. **The convergence test disproved it.** Iterating an Elo-style online
updater doesn't settle on a better estimate — it drifts toward the degenerate
fixed point where the season's net movement is zero, which erases exactly the
within-season improvement the rating exists to show. Measured drift was 0.11
between 4 passes and 8 on a 20-match season.

Getting that benefit properly requires **Whole-History Rating**, which fits a
rating *curve* per player rather than iterating point estimates. That's a genuine
future upgrade, not a constant to tweak. One pass is correct today, converges by
definition, and the multi-pass knob has been removed from the code so nobody
re-introduces the drift by turning it up.

This gives us for free:
- Admin edits and voids are trivially safe.
- Constants (`ALPHA`, `D_POINTS`, `K_NEW`, …) live in one config file and can be
  retuned against real history to see what *would* have happened.
- No possibility of accumulated drift or corrupted state.

A `rating_events` table stores the per-match before/after for display (rating
history charts, "+0.006" next to each match), but it's a rebuildable cache.

#### 5.6.1 Dated tuning

Rebuilding from history means a change to the K-factors would re-score matches
players have already seen. Results that have been shown are theirs, so the
movement constants are versioned by date rather than edited in place: a match
replays under whichever tuning was in force the day it was played
(`TUNING_V1_0` before `RECALIBRATED_FROM`, the current values after).

v1.1 recalibrated after a player compared a session against DUPR's forecast and
found PicklePlay moving roughly three times as far. Measured over the 54
matches on record, a settled player's mean move went from 0.043 to 0.014 — the
3x the comparison called for — while every match already played came out
bit-identical. Only the movement knobs are versioned; the curves, the
reliability waypoints and the scale describe what a rating *is*, and correcting
one of those genuinely should replay history.

### 5.7 Seeding from a real DUPR

At signup a player enters **their current real DUPR** (2.000–8.000) and,
optionally, **the reliability % from the same profile**. One-time typed-in
starting points — nothing syncs, and we never contact DUPR.

```
seed_rating    = declared DUPR
declared_floor = declared reliability / 100      # 0 when left blank
```

**The declaration is taken at face value.** A player who copies 85% off their
DUPR profile starts reliable, with no `?`. This is a deliberate call for a group
where everyone knows everyone: making an established player prove themselves
again costs more than the risk of someone inflating a number their friends can
see. Leaving it blank is not a penalty — it simply means starting unproven, and
one session fixes it.

The floor does not decay. Taking a claim at face value means still taking it at
face value a year later; only reliability *earned* by playing fades (§5.4).

K still starts fast for the first five local matches regardless (§5.3), so trust
decides the badge, not how quickly a wrong number can correct itself.

**Changing your own rating later brings the `?` back** (§5.8). A new
self-declared figure is unverified again whatever stood behind the old one, so
the floor resets to zero and the partner and opponent evidence is cleared. The
match record is untouched — those games happened; only the evidence for *this
number* restarts. An **admin** correction does not do this, because someone
other than the player vouched for it, and it is also how an existing player gets
a reliability they never entered at signup.

**Fallback for players with no DUPR** — the plain-language picker, seeded at
reliability 0:

| Choice | Seeds |
|---|---|
| Brand new / first time | 2.500 |
| Beginner — know the rules, still learning | 3.000 |
| Intermediate — consistent rallies, some strategy | 3.500 |
| Advanced — comfortable at the kitchen, place shots | 4.000 |
| Competitive — play tournaments | 4.500 |

**Guardrails**, since every one of these numbers is unverified:

- `K_SEED_FLOOR = 0.15` applies until 5 real local matches (§5.3), so a declared
  100% reliability can't make someone immovable.
- Profiles carry a **"Self-declared"** badge until 5 local matches are played.
- Declared values are shown publicly on the profile. In a small group where
  everyone can see everyone's claim, that's the strongest correction available.
- Admin can override any seed.

### 5.8 Monthly re-seed

A player may re-enter their DUPR and reliability **at most once every 30 days**,
from their own profile.

This exists because players also play outside this group, and their real DUPR keeps
moving. Without it, our number drifts away from reality for the most active players
— exactly the people who care most.

Mechanically a re-seed is a **dated seed event** in the §5.6 timeline: it sets the
rating at that point in history, restarts the imported-evidence decay clock, and
re-applies `K_SEED_FLOOR` for the next 5 matches.

Every re-seed is:
- **Logged** in `rating_seeds` — old value, new value, timestamp, source.
- **Public** on the player's profile: *"Re-seeded 2026-08-03: 3.850 → 4.100."*
- **Reversible** by an admin, which just deletes the event and recomputes.

> **Worth knowing going in:** this is a self-service rating reset, so a player on a
> bad streak can wipe it out once a month. That's a real hole in rating integrity —
> but ratings are public, re-seeds are public and logged, admins can revert, and
> the group is small enough that social pressure handles it. Flagging it so it's a
> choice rather than a surprise; the 30-day cooldown plus the public log is the
> mitigation. If it does get abused, the cheapest fix is requiring admin approval
> on any re-seed that raises a rating by more than ~0.25.

---

## 6. Auto-matchmaking

### 6.1 Formats

| Format | Behavior |
|---|---|
| **Balanced Round Robin** *(default)* | Every round, teams are formed to make each court as close to an even matchup as possible. Partners rotate. |
| **Fixed Partners** | Pairs chosen once, stay together all session; opponents rotate. |
| **King of the Court** | Winners move up a court, losers move down. Court 1 is the top. |
| **Social / Random** | Pure random partner rotation, no rating balancing. |
| **Manual** | Organizer builds every matchup by hand (always available as an override). |

### 6.2 The generator

For `N` present players and `C` courts, each round seats `4C` players; the rest sit
out.

**Sit-out selection (hard priority):** players with the fewest games played this
session are seated first. Ties broken by who sat out most recently. Nobody sits
twice before everyone has sat once.

**Assignment:** randomized restart hill-climbing. Generate ~200 candidate
assignments, score each with the cost function below, keep the best, then try pairwise
player swaps until no swap improves it. Fast, simple, and produces good rounds.

```
cost =  W_BALANCE  * Σ over courts |T_a - T_b|
      + W_PARTNER  * (# partner pairings already used this session)
      + W_OPPONENT * (# opponent pairings already used this session)
      + W_SPREAD   * Σ over courts (max r - min r on that court)

W_BALANCE = 10.0    W_PARTNER = 6.0    W_OPPONENT = 2.0    W_SPREAD = 1.0
```

**Tuned for this group: 8–16 players on 2–3 courts.** At that size 8–12 players
fill every court, so sit-outs are rare and partner repeats become unavoidable
within a long session — with 8 players on 2 courts there are only 3 distinct ways
to split the group, so by round 4 someone *must* repeat. The generator therefore
prefers repeating a **partner** over repeating an **opponent** (`W_PARTNER` drops
to 3.0 when `players < 12`), because playing the same four people against each
other all night is the thing that actually feels stale.

`W_SPREAD` keeps a 4.5 and a 2.5 off the same court where possible — balanced-on-
paper but miserable to play. Organizers can switch to **tiered courts** (court 1 =
strongest four, etc.) with a toggle, which sets `W_SPREAD` high and `W_BALANCE` low.

**Every generated round is editable.** The organizer can drag a player between
courts or regenerate before starting.

---

## 7. Data model

```
players
  id, username (unique, case-insensitive), display_name, pin_hash,
  role (player|organizer|admin), active, created_at

rating_seeds             -- signup seed + every monthly re-seed (§5.7, §5.8)
  id, player_id, rating, declared_reliability, source (dupr|picker|admin),
  effective_at, created_by, note

sessions
  id, title, location, starts_at, duration_min, court_count, max_players,
  format, rated (bool), status (draft|open|live|closed), created_by, notes

signups
  session_id, player_id, state (in|waitlist|out), waitlist_pos,
  attended (bool), created_at

rounds
  id, session_id, index, state (pending|active|done), created_at

matches
  id, session_id, round_id, court_no,
  a1, a2, b1, b2,            -- player ids, always four (doubles only)
  score_a, score_b, status (scheduled|completed|void),
  entered_by, played_at, edited_at

rating_events            -- derived cache, rebuilt by recompute
  match_id, player_id, rating_before, rating_after, delta,
  k_used, surprise, reliability_at_time

player_stats             -- derived cache
  player_id, rating, peak_rating, reliability, half_life, local_matches,
  matches, wins, losses, points_for, points_against, streak, last_played
```

Audit: an `audit_log` table records every admin edit, void, PIN reset, and
recompute trigger.

---

## 8. Screens

| Route | Purpose |
|---|---|
| `/` | Next session card + your rating + quick RSVP |
| `/register`, `/login` | Username + PIN |
| `/s/[id]` | **Session page** — public link. Roster, waitlist, rounds, live scores, RSVP button |
| `/s/[id]/play` | Organizer game-day console — attendance, generate round, enter scores |
| `/leaderboard` | Public. Sorted by rating; provisional and self-declared players badged, filterable |
| `/p/[username]` | Player profile — rating chart over time, full match history with per-match deltas, W/L, streaks, seed history (§5.8), and the **Re-seed** button when eligible |
| `/admin` | Players, sessions, match editing, PIN resets, rating constants, recompute |

**Mobile-first.** Thumb-reachable controls, large tap targets, score entry usable
one-handed on a court in the sun. PWA manifest + icons so it installs to the home
screen and opens without browser chrome.

---

## 9. Security posture

For a small private group, but not naive:

- PINs hashed with **scrypt** (`node:crypto`, N=16384). Never logged, never
  returned by an API. Argon2id would be marginally preferable, but it needs a
  native module, and native modules are the most common way a Vercel deploy
  breaks at runtime rather than at build time. scrypt is memory-hard, built into
  Node, and has zero deploy risk. The hash is stored as `scrypt$N$r$p$salt$key`
  so the parameters can be raised later without a migration.
- **Rate limiting** on login: 5 attempts per username per 15 min, then a cooldown.
  A 4-digit PIN is only 10,000 combinations — rate limiting is what makes it safe.
- Sessions are signed, HTTP-only, Secure cookies.
- **All rating math runs server-side.** The client never submits a rating.
- Score submission is authorized: you must be in the match, or an organizer.
- The 30-day re-seed cooldown (§5.8) is enforced **server-side** against
  `rating_seeds.effective_at`, never by hiding the button.
- The Neon connection string lives only in Vercel env vars, never in client code —
  the browser never talks to the database directly.
- Session pages are readable by link but every write requires auth.
- No personal data is collected, so there is very little to leak — that's a feature.

---

## 10. Build plan

**M1 — Foundations**
Next.js scaffold, Neon Postgres + Drizzle schema (pooled connection string),
register/login with username+PIN, DUPR/reliability seeding at signup, session
cookie, deploy to Vercel with a live URL.
Plus the **weekly JSON backup cron** to a private GitHub repo (§2.1) — cheap now,
painful to retrofit after the first bad edit.

**M2 — Sessions & RSVP**
Create session, public session page, RSVP in/out, waitlist with auto-promotion,
attendance marking. *At this point the group can actually use it.*

**M3 — Rating engine**
Pure, dependency-free rating module with the §5 formula. Unit tests asserting every
row of the §5.5 table. Full-history recompute with 4 passes over the merged
match + seed-event timeline. Monthly re-seed flow with its 30-day cooldown.

**M4 — Matchmaking & scores**
Round generator with the cost function, play console, score entry, ratings applied,
leaderboard, player profiles with rating charts.

**M5 — Polish**
PWA manifest and icons, admin tools, audit log, rating-constant tuning UI,
empty/loading/error states.

---

## 11. Open questions

Answer these whenever — none block starting M1.

1. **Recurring sessions.** Do you play a fixed weekly slot that should auto-create
   (e.g. every Tuesday 7pm), or is each session created ad hoc?
2. **Guests.** Someone shows up who isn't registered — do you want a quick "add
   guest" that creates an unrated placeholder who can be slotted into rounds, or
   must everyone register first?
