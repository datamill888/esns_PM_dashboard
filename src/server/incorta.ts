/**
 * Incorta SQL Interface helper (server-only).
 *
 * Rules (appkit incorta-data-discovery §1.2):
 *  - connect AS the signed-in user: database = tenant, user = sub, password = access token
 *  - discrete fields only — never mix connectionString with overrides
 *  - one client per call, closed in finally; no pools, no cross-user caching
 *  - simple query protocol only, so $n params are bound client-side with escaping
 *  - Incorta is READ-ONLY: never send writes
 */
import pg from "pg";
import { getServerSession } from "./auth";

export type SqlParam = string | number | bigint | boolean | Date | null | undefined | SqlParam[];

export class IncortaUnavailableError extends Error {}

export function escapeLiteral(s: string): string {
  let hasBackslash = false;
  let out = "'";
  for (const c of s) {
    if (c === "'") out += "''";
    else if (c === "\\") {
      out += "\\\\";
      hasBackslash = true;
    } else out += c;
  }
  out += "'";
  return hasBackslash ? ` E${out}` : out;
}

function literal(v: SqlParam): string {
  if (v === null || v === undefined) return "NULL";
  if (Array.isArray(v)) return `ARRAY[${v.map(literal).join(", ")}]`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number in SQL params");
    return String(v);
  }
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return escapeLiteral(v.toISOString());
  if (typeof v === "string") return escapeLiteral(v);
  throw new Error(`unsupported SQL param type: ${typeof v}`);
}

/**
 * Substitute $1..$n with escaped literals in a single pass, so a bound value
 * that itself contains "$2" is never re-substituted.
 */
export function bindParams(sql: string, params: SqlParam[] = []): string {
  return sql.replace(/\$(\d+)/g, (m, n: string) => {
    const i = Number(n);
    if (i < 1 || i > params.length) return m;
    return literal(params[i - 1]);
  });
}

export function incortaConfigured(): boolean {
  return Boolean(process.env.INCORTA_PG_URL);
}

export async function sqlQuery<T = Record<string, unknown>>(
  request: Request,
  sql: string,
  params: SqlParam[] = [],
): Promise<T[]> {
  const raw = process.env.INCORTA_PG_URL;
  if (!raw) {
    throw new IncortaUnavailableError(
      "INCORTA_PG_URL is not set — this deployment has no Incorta SQL endpoint.",
    );
  }
  const session = await getServerSession(request);
  if (!session) throw new IncortaUnavailableError("Not signed in to Incorta.");
  const url = new URL(raw);
  const client = new pg.Client({
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: session.user.tenant,
    user: session.user.sub,
    password: session.accessToken,
    ssl: false,
  });
  await client.connect();
  try {
    try {
      await client.query("SET statement_timeout = 30000");
    } catch {
      /* best effort */
    }
    const res = await client.query(bindParams(sql, params));
    return res.rows as T[];
  } finally {
    await client.end().catch(() => {});
  }
}
