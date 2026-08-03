ALTER TABLE "players" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "role" SET DEFAULT 'player'::text;--> statement-breakpoint
DROP TYPE "public"."role";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('player', 'admin', 'superadmin');--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "role" SET DEFAULT 'player'::"public"."role";--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";--> statement-breakpoint
-- Data migration: the first account ever registered becomes the super admin.
-- Matches the bootstrap rule in registerAction, and promotes the existing owner
-- in place rather than requiring a manual database edit.
UPDATE "players" SET "role" = 'superadmin'
WHERE "id" = (SELECT "id" FROM "players" ORDER BY "created_at" ASC LIMIT 1);