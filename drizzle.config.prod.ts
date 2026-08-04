import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

/**
 * Production migrations only — `npm run db:migrate:prod`.
 *
 * Deliberately a separate config so that running `npm run db:migrate` during
 * development can never touch the live database by accident. That's the whole
 * point of the dev/prod split; making it a flag on one config would put the two
 * one typo apart.
 */
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_PROD_UNPOOLED ?? "",
  },
});
