ALTER TABLE "mlp_ties" ADD COLUMN "mixed_crossed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mlp_random_mixed" boolean DEFAULT false NOT NULL;