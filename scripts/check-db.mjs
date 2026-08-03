/**
 * Quick connectivity + schema sanity check: `npm run db:check`.
 *
 * Prints what actually exists in the database. Deliberately never prints the
 * connection string, which carries the password.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  process.exit(1);
}

console.log("host:", new URL(url).hostname);

const sql = neon(url);

const tables = await sql`
  select table_name from information_schema.tables
  where table_schema = 'public' order by table_name
`;
console.log(`tables (${tables.length}):`, tables.map((t) => t.table_name).join(", "));

const enums = await sql`
  select typname from pg_type where typtype = 'e' order by typname
`;
console.log(`enums  (${enums.length}):`, enums.map((e) => e.typname).join(", "));

const roster = await sql`select username, role from players order by created_at`;
console.log(`players (${roster.length}):`, roster.map((p) => `${p.username}=${p.role}`).join(", ") || "(none)");
