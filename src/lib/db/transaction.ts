/** Interactive transactions are request-scoped; ordinary reads keep neon-http. */
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;
const makeDb = (pool: Pool) => drizzle(pool, { schema });
export type Transaction = Parameters<Parameters<ReturnType<typeof makeDb>["transaction"]>[0]>[0];

export async function inTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    return await makeDb(pool).transaction(work);
  } finally {
    await pool.end();
  }
}

/** All cooperating writers for a session take this lock before checking state. */
export async function lockSession(tx: Transaction, sessionId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))`);
}
