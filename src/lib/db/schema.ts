/**
 * PicklePlay database schema — SPEC.md §7.
 *
 * The load-bearing idea: `matches` and `ratingSeeds` are the ONLY source of
 * truth. `ratingEvents` and `playerStats` are caches, rebuilt by replaying the
 * timeline through the rating engine (§5.6). Never hand-edit them, and never
 * read a rating from anywhere else.
 *
 * Doubles only — every match has exactly four players.
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["player", "organizer", "admin"]);
export const signupStateEnum = pgEnum("signup_state", ["in", "waitlist", "out"]);
export const sessionStatusEnum = pgEnum("session_status", ["draft", "open", "live", "closed"]);
export const roundStateEnum = pgEnum("round_state", ["pending", "active", "done"]);
export const matchStatusEnum = pgEnum("match_status", ["scheduled", "completed", "void"]);
export const seedSourceEnum = pgEnum("seed_source", ["dupr", "picker", "admin"]);
export const formatEnum = pgEnum("session_format", [
  "balanced",
  "fixed",
  "king",
  "social",
  "manual",
]);

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const players = pgTable(
  "players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** As typed at registration — preserved for display. */
    username: text("username").notNull(),
    /** Lowercased form; this is what uniqueness is enforced on (§4.1). */
    usernameLower: text("username_lower").notNull(),
    displayName: text("display_name"),
    /** scrypt hash, see lib/auth/pin.ts. Never leaves the server. */
    pinHash: text("pin_hash").notNull(),
    role: roleEnum("role").notNull().default("player"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("players_username_lower_idx").on(t.usernameLower)],
);

/** Login sessions. Opaque random token in an HttpOnly cookie; revocable. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 of the cookie value, so a database leak yields no live sessions. */
    tokenHash: text("token_hash").notNull(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_idx").on(t.tokenHash),
    index("auth_tokens_player_idx").on(t.playerId),
  ],
);

/** Login attempt log, backing the rate limit that makes a 4-digit PIN safe (§9). */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    usernameLower: text("username_lower").notNull(),
    succeeded: boolean("succeeded").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_lookup_idx").on(t.usernameLower, t.attemptedAt)],
);

// ---------------------------------------------------------------------------
// Ratings — source of truth
// ---------------------------------------------------------------------------

/** The signup seed and every monthly re-seed (§5.7, §5.8). Append-only. */
export const ratingSeeds = pgTable(
  "rating_seeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    rating: doublePrecision("rating").notNull(),
    /** Declared reliability 0-100. Converts to imported evidence (§5.7). */
    declaredReliability: doublePrecision("declared_reliability").notNull().default(0),
    source: seedSourceEnum("source").notNull(),
    /** Where this seed sits in history — drives the 30-day cooldown. */
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => players.id, { onDelete: "set null" }),
    note: text("note"),
  },
  (t) => [index("rating_seeds_player_idx").on(t.playerId, t.effectiveAt)],
);

// ---------------------------------------------------------------------------
// Play sessions
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull().default(120),
    courtCount: integer("court_count").notNull().default(2),
    maxPlayers: integer("max_players").notNull().default(16),
    format: formatEnum("format").notNull().default("balanced"),
    /** False for a casual night that shouldn't touch anyone's rating. */
    rated: boolean("rated").notNull().default(true),
    status: sessionStatusEnum("status").notNull().default("open"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => players.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_starts_at_idx").on(t.startsAt)],
);

export const signups = pgTable(
  "signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    state: signupStateEnum("state").notNull().default("in"),
    /** Position in the waitlist queue; null when state is not 'waitlist'. */
    waitlistPos: integer("waitlist_pos"),
    /** Set on game day — RSVP'd is not the same as showed up. */
    attended: boolean("attended").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("signups_session_player_idx").on(t.sessionId, t.playerId)],
);

export const rounds = pgTable(
  "rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    state: roundStateEnum("state").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rounds_session_index_idx").on(t.sessionId, t.index)],
);

/**
 * A doubles match. Source of truth for every rating in the system.
 *
 * Voided matches are kept, not deleted, so the history stays auditable — the
 * recompute simply skips anything that isn't 'completed'.
 */
export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    roundId: uuid("round_id").references(() => rounds.id, { onDelete: "set null" }),
    courtNo: integer("court_no"),

    a1: uuid("a1").notNull().references(() => players.id),
    a2: uuid("a2").notNull().references(() => players.id),
    b1: uuid("b1").notNull().references(() => players.id),
    b2: uuid("b2").notNull().references(() => players.id),

    scoreA: integer("score_a"),
    scoreB: integer("score_b"),
    status: matchStatusEnum("status").notNull().default("scheduled"),

    enteredBy: uuid("entered_by").references(() => players.id, { onDelete: "set null" }),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [
    index("matches_played_at_idx").on(t.playedAt),
    index("matches_session_idx").on(t.sessionId),
  ],
);

// ---------------------------------------------------------------------------
// Derived caches — rebuilt wholesale by the recompute. Do not hand-edit.
// ---------------------------------------------------------------------------

export const ratingEvents = pgTable(
  "rating_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    ratingBefore: doublePrecision("rating_before").notNull(),
    ratingAfter: doublePrecision("rating_after").notNull(),
    delta: doublePrecision("delta").notNull(),
    k: doublePrecision("k").notNull(),
    surprise: doublePrecision("surprise").notNull(),
    reliabilityAtTime: doublePrecision("reliability_at_time").notNull(),
  },
  (t) => [
    uniqueIndex("rating_events_match_player_idx").on(t.matchId, t.playerId),
    index("rating_events_player_idx").on(t.playerId),
  ],
);

export const playerStats = pgTable("player_stats", {
  playerId: uuid("player_id")
    .primaryKey()
    .references(() => players.id, { onDelete: "cascade" }),
  rating: doublePrecision("rating").notNull(),
  peakRating: doublePrecision("peak_rating").notNull(),
  reliability: doublePrecision("reliability").notNull(),
  halfLife: doublePrecision("half_life").notNull(),
  localMatches: integer("local_matches").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  pointsFor: integer("points_for").notNull().default(0),
  pointsAgainst: integer("points_against").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  provisional: boolean("provisional").notNull().default(true),
  selfDeclared: boolean("self_declared").notNull().default(true),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
  recomputedAt: timestamp("recomputed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every admin edit, void, PIN reset, and recompute trigger (§7). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => players.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);
