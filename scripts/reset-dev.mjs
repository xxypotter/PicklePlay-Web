/**
 * Wipe the dev database back to a known state: `npm run db:reset`.
 *
 * Refuses to run against anything but pickleplay_dev, because the one thing
 * this must never do is clear production.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL ?? "";
const dbName = url ? new URL(url).pathname.slice(1) : "";

if (dbName !== "pickleplay_dev") {
  console.error(`Refusing to reset "${dbName}" — this only ever runs against pickleplay_dev.`);
  process.exit(1);
}

const sql = neon(url);

// Dependency order: match history references players, so it goes first.
await sql`delete from rating_events`;
await sql`delete from matches`;
await sql`delete from rounds`;
await sql`delete from signups`;
await sql`delete from sessions`;
await sql`delete from player_stats`;
await sql`delete from audit_log`;
await sql`delete from auth_tokens`;
await sql`delete from login_attempts`;
await sql`delete from rating_seeds`;
await sql`delete from players`;
await sql`delete from settings`;

console.log("dev database reset. Run `npm run db:seed` to repopulate.");
