/**
 * Dev-only test players: `npm run db:seed` / `npm run db:seed purge`.
 *
 * Every account it creates is prefixed `dev_`, and purge only ever deletes
 * accounts with that prefix — so this can never touch a real player, even
 * while dev and production still share one database.
 *
 * All seeded accounts use PIN 4729.
 */
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);
const PREFIX = "dev_";

// Mirrors lib/auth/pin.ts — duplicated so this script stays dependency-free.
async function hashPin(pin) {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${key.toString("base64")}`;
}

const NAMES = [
  ["ana", 4.2, 85],
  ["ben", 3.6, 60],
  ["cara", 3.9, 70],
  ["dev", 3.1, 30],
  ["eli", 4.5, 95],
  ["fay", 2.9, 20],
  ["gus", 3.4, 50],
  ["hana", 4.0, 75],
  ["ivan", 3.7, 65],
  ["jo", 3.2, 40],
  ["kit", 4.8, 90],
  ["lena", 3.0, 15],
];

if (process.argv[2] === "purge") {
  const gone = await sql`
    delete from players where username_lower like ${PREFIX + "%"} returning username
  `;
  await sql`delete from login_attempts where username_lower like ${PREFIX + "%"}`;
  console.log(`purged ${gone.length} dev accounts`);
} else {
  const count = Number(process.argv[2]) || NAMES.length;
  const hash = await hashPin("4729");
  let made = 0;

  for (const [name, rating, reliability] of NAMES.slice(0, count)) {
    const username = PREFIX + name;
    const rows = await sql`
      insert into players (username, username_lower, pin_hash, role)
      values (${username}, ${username}, ${hash}, 'player')
      on conflict (username_lower) do nothing
      returning id
    `;
    if (!rows.length) continue;
    await sql`
      insert into rating_seeds (player_id, rating, declared_reliability, source, created_by)
      values (${rows[0].id}, ${rating}, ${reliability}, 'dupr', ${rows[0].id})
    `;
    made++;
  }

  // All three roles present, so the permission boundaries between them are
  // actually testable rather than assumed.
  await sql`update players set role = 'superadmin' where username_lower = ${PREFIX + "ana"}`;
  await sql`update players set role = 'admin' where username_lower = ${PREFIX + "ben"}`;

  console.log(
    `seeded ${made} dev accounts (PIN 4729); dev_ana=superadmin, dev_ben=admin, rest players`,
  );
}

const all = await sql`select count(*)::int as n from players`;
console.log("total players:", all[0].n);
