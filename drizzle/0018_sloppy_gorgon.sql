ALTER TYPE "public"."session_format" ADD VALUE 'swiss';--> statement-breakpoint
CREATE TABLE "swiss_byes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"player1" uuid NOT NULL,
	"player2" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swiss_playoff_games" (
	"match_id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"place" integer NOT NULL,
	"leg" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "swiss_seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "swiss_byes" ADD CONSTRAINT "swiss_byes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_byes" ADD CONSTRAINT "swiss_byes_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_byes" ADD CONSTRAINT "swiss_byes_player1_players_id_fk" FOREIGN KEY ("player1") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_byes" ADD CONSTRAINT "swiss_byes_player2_players_id_fk" FOREIGN KEY ("player2") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_playoff_games" ADD CONSTRAINT "swiss_playoff_games_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swiss_playoff_games" ADD CONSTRAINT "swiss_playoff_games_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swiss_byes_round_idx" ON "swiss_byes" USING btree ("round_id");