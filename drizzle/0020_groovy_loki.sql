ALTER TABLE "player_stats" ADD COLUMN "evidence_partners" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stats" ADD COLUMN "evidence_teams" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stats" ADD COLUMN "evidence_volume" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_stats" ADD COLUMN "evidence_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_stats" ADD COLUMN "rank_hold" boolean DEFAULT false NOT NULL;