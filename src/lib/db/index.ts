/**
 * Database client.
 *
 * Uses Neon's HTTP driver, which opens no long-lived connections — the failure
 * mode SPEC.md §2.1 warns about (serverless functions exhausting Postgres
 * connections) simply cannot happen with it. Point DATABASE_URL at the *pooled*
 * Neon connection string anyway; it costs nothing and keeps the option open.
 *
 * The client is created lazily so that `next build` succeeds in environments
 * without DATABASE_URL set. Anything that actually touches the database at
 * request time will get a clear error instead of a silent undefined.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export { schema };

let client: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (client) return client;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and paste your " +
        "Neon pooled connection string.",
    );
  }

  client = drizzle(neon(url), { schema });
  return client;
}
