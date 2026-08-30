CREATE TYPE "public"."round_stage" AS ENUM('robin', 'semifinal', 'final');--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "stage" "round_stage" DEFAULT 'robin' NOT NULL;