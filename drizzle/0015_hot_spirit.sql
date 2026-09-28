ALTER TABLE "mlp_teams" ADD COLUMN "women1" uuid;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD COLUMN "women2" uuid;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD COLUMN "men1" uuid;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD COLUMN "men2" uuid;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_women1_players_id_fk" FOREIGN KEY ("women1") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_women2_players_id_fk" FOREIGN KEY ("women2") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_men1_players_id_fk" FOREIGN KEY ("men1") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mlp_teams" ADD CONSTRAINT "mlp_teams_men2_players_id_fk" FOREIGN KEY ("men2") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;