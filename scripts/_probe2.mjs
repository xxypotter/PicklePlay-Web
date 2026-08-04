import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL_PROD_UNPOOLED);
const p = await sql`
  select p.username, p.role, p.imported_matches, p.imported_wins, p.imported_at,
         s.rating, s.local_matches, s.wins, s.losses, s.reliability, s.provisional
  from players p left join player_stats s on s.player_id = p.id
  order by p.created_at`;
console.log("username      role        rating  played  W-L  imported  reliab");
for (const r of p) console.log(
  `${r.username.padEnd(13)} ${String(r.role).padEnd(11)} ${r.rating ? Number(r.rating).toFixed(3) : '  -  '}  ${String(r.local_matches ?? 0).padStart(5)}  ${r.wins ?? 0}-${r.losses ?? 0}  ${String(r.imported_matches ?? 0).padStart(6)}  ${r.reliability != null ? (Number(r.reliability)*100).toFixed(0)+'%' : '-'}`);
const [{ m }] = await sql`select count(*)::int m from matches`;
const [{ se }] = await sql`select count(*)::int se from sessions`;
const [{ sg }] = await sql`select count(*)::int sg from signups`;
console.log(`\nmatches=${m} sessions=${se} signups=${sg}`);
