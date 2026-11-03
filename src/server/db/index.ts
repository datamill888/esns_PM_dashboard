/**
 * App-owned Postgres (platform-managed, DATABASE_URL). Holds only data the app
 * itself creates — the Cost Tracker inputs and PM notes. Never Incorta rows.
 *
 * One small process-wide pool (max 2). Note: drizzle(pool) WITHOUT the schema
 * import — passing `{ schema }` triggers a known appkit TanStack bundling crash.
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

let pool: pg.Pool | null = null;

export function appDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return drizzle(pool);
}
