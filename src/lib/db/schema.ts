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

/**
 * Role hierarchy (SPEC.md §3):
 *   superadmin — exactly one (Jason). Sole authority to promote/demote admins.
 *   admin      — creates sessions, manages the invite code, edits matches.
 *   player     — RSVPs and records their own matches.
 *
 * "organizer" was folded into "admin": the group is small enough that a second
 * tier of session-runner earned nothing and just made permission checks lie.
 */
/**
 * Play is always mixed — gender exists only so the rankings can be split into
 * a men's and a women's table, which is how this group reads results.
 */
export const genderEnum = pgEnum("gender", ["male", "female", "unspecified"]);

export const roleEnum = pgEnum("role", ["player", "admin", "superadmin"]);
export const signupStateEnum = pgEnum("signup_state", ["in", "waitlist", "out"]);
export const sessionStatusEnum = pgEnum("session_status", ["draft", "open", "live", "closed"]);
export const roundStateEnum = pgEnum("round_state", ["pending", "active", "done"]);
export const matchStatusEnum = pgEnum("match_status", ["scheduled", "completed", "void"]);
export const seedSourceEnum = pgEnum("seed_source", ["dupr", "picker", "admin"]);
/**
 * "king", "social" and "manual" are retired but kept in the type: removing an
 * enum value means recreating the type, and old sessions still reference them.
 * Only the four the form offers are reachable for new sessions.
 */
export const formatEnum = pgEnum("session_format", [
  "balanced",
  "fixed",
  "king",
  "social",
  "manual",
  "regular",
  "custom",
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
    gender: genderEnum("gender").notNull().default("unspecified"),
    /**
     * Either `preset:N` for one of the built-in tiles or a small data URL from
     * an upload. Null means fall back to a colour derived from the username, so
     * everyone has a distinct avatar without anyone having to choose one.
     */
    avatar: text("avatar"),
    /**
     * Chosen language, so it follows the player to a new phone. Nullable
     * because "never chose" is different from "chose English" — only the first
     * lets the browser's own preference decide.
     */
    locale: text("locale"),
    /**
     * Record carried over from wherever they played before. Display only — it
     * never touches the rating engine, which knows about matches played here
     * and nothing else. Losses are derived as matches minus wins.
     */
    importedMatches: integer("imported_matches").notNull().default(0),
    importedWins: integer("imported_wins").notNull().default(0),
    /** Set the first time a record is imported; its presence closes the door. */
    importedAt: timestamp("imported_at", { withTimezone: true }),
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
    /**
     * The actual court names or numbers, e.g. ["3","4"] or ["Center","North"].
     * Knowing you're on court 7 is what a player needs; a bare count leaves the
     * organizer shouting "which court?" all night. Length is the court count.
     */
    courtNames: text("court_names").array().notNull().default(["1", "2"]),
    /** Always courtNames.length; kept as a column so queries can filter on it. */
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
    /**
     * True when an organizer put them on the roster rather than them RSVPing.
     * Drives a clearer prompt — "you've been added, tap here if you can't make
     * it" reads very differently from "you're in" when you never signed up.
     */
    addedByOrganizer: boolean("added_by_organizer").notNull().default(false),
    /**
     * Set on game day — RSVP'd is not the same as showed up. Defaults to true
     * so the organizer only has to uncheck no-shows, rather than tick twelve
     * boxes for a group that mostly turns up.
     */
    attended: boolean("attended").notNull().default(true),
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

/**
 * Small key/value store for things an admin changes at runtime — currently the
 * group invite code. Lives in the database rather than an env var so rotating
 * it doesn't need a redeploy.
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => players.id, { onDelete: "set null" }),
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
