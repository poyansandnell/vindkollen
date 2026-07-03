import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Idle clients in the pool can be dropped by the database server (e.g. admin
// restarts, managed-Postgres autoscaling/hibernation, network blips). Without
// this listener, `pg` re-throws such errors as an unhandled 'error' event on
// the pool, which crashes the whole Node process. Logging and swallowing it
// here lets the pool transparently create a fresh connection on next use.
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected error on idle Postgres client (pool recovering):", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
