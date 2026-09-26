ALTER TYPE "public"."session_format" ADD VALUE 'mlp';--> statement-breakpoint
CREATE TABLE "mlp_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"name" text NOT NULL,
	"m1" uuid NOT NULL,
	"m2" uuid NOT NULL,
	"w1" uuid NOT NULL,
	"w2" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mlp_ties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"stage" "round_stage" DEFAULT 'robin' NOT NULL,
	"index" integer NOT NULL,
	"block" integer NOT NULL,
	"team_a_id" uuid NOT NULL,
	"team_b_id" uuid NOT NULL,
	"tiebreak_winner" uuid
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "mlp_tie_id" uuid;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "mlp_game" text;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_m1_players_id_fk" FOREIGN KEY ("m1") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_m2_players_id_fk" FOREIGN KEY ("m2") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_w1_players_id_fk" FOREIGN KEY ("w1") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_w2_players_id_fk" FOREIGN KEY ("w2") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_ties" ADD CONSTRAINT "mlp_ties_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_ties" ADD CONSTRAINT "mlp_ties_team_a_id_mlp_teams_id_fk" FOREIGN KEY ("team_a_id") REFERENCES "public"."mlp_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_ties" ADD CONSTRAINT "mlp_ties_team_b_id_mlp_teams_id_fk" FOREIGN KEY ("team_b_id") REFERENCES "public"."mlp_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_ties" ADD CONSTRAINT "mlp_ties_tiebreak_winner_mlp_teams_id_fk" FOREIGN KEY ("tiebreak_winner") REFERENCES "public"."mlp_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mlp_teams_session_slot_idx" ON "mlp_teams" USING btree ("session_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "mlp_ties_session_index_idx" ON "mlp_ties" USING btree ("session_id","index");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_mlp_tie_id_mlp_ties_id_fk" FOREIGN KEY ("mlp_tie_id") REFERENCES "public"."mlp_ties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_mlp_game_idx" ON "matches" USING btree ("mlp_tie_id","mlp_game");