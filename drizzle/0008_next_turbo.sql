CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'unspecified');--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "gender" "gender" DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "imported_matches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "imported_wins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
-- Existing roster: Helen plays in the women's rankings, everyone else the
-- men's. New signups choose for themselves, and anyone can change it under Me.
UPDATE "players" SET "gender" = 'female' WHERE lower("username") = 'helen';--> statement-breakpoint
UPDATE "players" SET "gender" = 'male' WHERE lower("username") <> 'helen';--> statement-breakpoint
-- Jason's record carried over from the WeChat mini-program: 162 matches at a
-- 59% win rate, so round(162 x 0.59) = 96 wins and 66 losses.
UPDATE "players"
SET "imported_matches" = 162, "imported_wins" = 96, "imported_at" = now()
WHERE lower("username") = 'jason';