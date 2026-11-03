import process from "node:process";

import { createIncortaClient, type IncortaClient } from "@incorta/sdk";
import pg from "pg";
import { parseIntoClientConfig } from "pg-connection-string";

import { getServerSession } from "./auth";

/**
 * The SQL Interface: SQL access to the signed-in user's Incorta data.
 *
 * This app has TWO sources for Incorta, and they are not interchangeable.
 * The SQL Interface (here) queries PHYSICAL and BUSINESS schemas. The Incorta
 * APIs (`incorta`, below) see the whole catalog but query BUSINESS SCHEMAS
 * ONLY. Ask which source to use before building on either.
 *
 * Server-only — this module must never be imported by a component. Call it
 * from inside a `createServerFn` handler (or a loader), where you can get the
 * request:
 *
 *   export const getCountries = createServerFn({ method: "GET" }).handler(
 *     async () => {
 *       const request = getRequest();
 *       return sqlQuery<{ country_name: string; sales: number }>(
 *         request,
 *         'SELECT country_name, sales FROM "SALES"."COUNTRIES" LIMIT 100',
 *       );
 *     },
 *   );
 *
 * The connection is made AS the signed-in user (tenant = database, their
 * loginname = user, their access token = password), so Incorta row security
 * applies — the same query can legitimately return different rows for
 * different callers. Never cache results across users.
 *
 * Two things to get right in the SQL:
 *
 * - Quote schema and table names EXACTLY as Incorta shows them
 *   (`FROM "SALES"."COUNTRIES"`). Unquoted identifiers fold to lowercase and
 *   will not match. Column names are lowercase.
 * - Aggregate in SQL rather than post-processing in JS — these tables get
 *   large, and the database does `GROUP BY` far better.
 * - CAST AGGREGATES TO `::float8`: `SUM(qty)::float8`, `COUNT(*)::float8`.
 *   `COUNT()`/`SUM()` over an integer column return `int8`, and
 *   `numeric`/`decimal` columns return `numeric` — node-postgres delivers
 *   BOTH as strings rather than risk precision loss past 2^53. Nothing
 *   throws; `a + b` just quietly becomes `"1" + "2" === "12"` and charts
 *   plot nothing. `AVG()` and `double precision` columns are already
 *   numbers. Do NOT cast ids or keys — precision loss is real there, so
 *   leave them as the strings they arrive as.
 *
 * Pass values as `$1`, `$2` params, never interpolated into the string:
 *
 *   sqlQuery(request, 'SELECT * FROM "SALES"."ORDERS" WHERE region = $1', ["EMEA"]);
 *
 * (The Incorta endpoint cannot bind parameters server-side, so the helper
 * merges them into the SQL client-side with proper escaping — see
 * bindParams. Your contract is unchanged: values ALWAYS go in `params`.)
 *
 * Statements are capped at 30 seconds server-side, so one runaway query
 * cannot hang a server function — it surfaces as a "statement timeout"
 * error; tighten the query (aggregate, filter) rather than raising the cap.
 *
 * Throws when the deployment has no SQL endpoint or the request has no
 * session; if that is possible for your app, catch it and fall back to the
 * Incorta REST APIs.
 */
export async function sqlQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  request: Request,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const endpoint = (process.env.INCORTA_PG_URL ?? "").trim();
  if (!endpoint) {
    throw new Error(
      "INCORTA_PG_URL is not set — this deployment has no Incorta SQL " +
        "endpoint. Use the Incorta REST APIs instead.",
    );
  }
  const session = await getServerSession(request);
  if (!session) throw new Error("No Incorta session on this request");

  const url = new URL(endpoint);
  // Host and port are taken APART from the URL rather than passed as
  // `connectionString`, because node-postgres merges a connection string OVER
  // its sibling fields. INCORTA_PG_URL carries no user, password or database,
  // so passing it alongside them silently replaces all three with libpq's
  // defaults (the OS username) and every connection is rejected. Keep these
  // discrete.
  const client = new pg.Client({
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: session.user.tenant,
    user: session.user.sub,
    // A short-lived token, which is why this opens a client per call and
    // never a module-level pool — a pool would bake in an expiring
    // credential (and would belong to the wrong user anyway).
    password: session.accessToken,
    connectionTimeoutMillis: 10_000,
    ssl: sslFor(url),
  });

  await client.connect();
  try {
    // Best-effort server-side cap so a runaway query cannot hang a server
    // function; an engine that rejects the SET must not fail the real query.
    await client.query("SET statement_timeout = 30000").catch(() => {});
    const result = await client.query<T>(
      params?.length ? bindParams(sql, params) : sql,
    );
    return result.rows;
  } finally {
    await client.end().catch(() => {});
  }
}

// node-postgres reads `sslmode` only out of a connection string, and the
// client above is built from discrete fields — so the URL's TLS parameters
// go through the driver's OWN parser and only its `ssl` verdict is taken.
// `uselibpqcompat=true` makes the driver read `sslmode` the way libpq does
// (`require` = encrypt without verifying the peer, `verify-full` = verify,
// no mode = plaintext); it is added unless the URL already settles that
// itself (its own `uselibpqcompat`, or the driver-only `no-verify`). The
// mapping — and any relaxation of verification — is the driver's, chosen
// by the platform's URL; this file never overrides TLS verification.
function sslFor(url: URL): pg.ClientConfig["ssl"] {
  const conninfo = new URL(url);
  if (
    !conninfo.searchParams.has("uselibpqcompat") &&
    conninfo.searchParams.get("sslmode") !== "no-verify"
  ) {
    conninfo.searchParams.set("uselibpqcompat", "true");
  }
  return parseIntoClientConfig(conninfo.toString()).ssl ?? false;
}

/**
 * The Incorta endpoint speaks only the SIMPLE query protocol — sending
 * values separately, as `client.query(sql, params)` does, uses the extended
 * protocol and is rejected with "parameterized data queries via extended
 * protocol are not yet supported". So `$1`/`$2` placeholders are bound HERE,
 * client-side, with proper literal escaping, and the merged SQL travels as
 * one plain statement. Do not "simplify" this back to passing `params`
 * through to `client.query` — that breaks every filtered query.
 *
 * Supported value types: string, number, bigint, boolean, Date, null,
 * undefined (→ NULL), and arrays of those (→ ARRAY[…], for `= ANY($1)`).
 * Anything else throws — stringify JSON yourself if you mean to send text.
 * One caveat of client-side binding: a `$n` sequence inside a SQL string
 * constant would be substituted too — keep every value in `params` and this
 * never comes up.
 */
function bindParams(sql: string, params: unknown[]): string {
  return sql.replace(/\$(\d+)/g, (_, digits: string) => {
    const index = Number(digits);
    if (index < 1 || index > params.length) {
      throw new Error(
        `SQL references $${digits} but ${params.length} parameter(s) were given`,
      );
    }
    return toLiteral(params[index - 1]);
  });
}

function toLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return pg.escapeLiteral(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot bind non-finite number ${value}`);
    }
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return pg.escapeLiteral(value.toISOString());
  if (Array.isArray(value)) {
    return `ARRAY[${value.map(toLiteral).join(", ")}]`;
  }
  throw new Error(
    `Cannot bind a ${typeof value} parameter — pass a string, number, ` +
      "boolean, Date, null, or an array of those",
  );
}

// --- Incorta metadata: the `incorta` object ---------------------------------

/**
 * The Incorta APIs — the app-level client, one per process, built on first use.
 *
 * Sees the whole catalog (physical and business schemas, their tables, views,
 * and columns) but can QUERY BUSINESS SCHEMAS ONLY: there is no Incorta APIs
 * path to the rows of a physical table. Use `sqlQuery()` above — the SQL
 * Interface — when you need rows from a physical schema.
 *
 * Both act as the signed-in user, so both are already scoped to that user's
 * Incorta permissions.
 *
 * Server-only, exactly like the rest of this module: never import it from a
 * component. Call it inside a `createServerFn` handler or a loader, where you
 * can get the request:
 *
 *   export const listSchemas = createServerFn({ method: "GET" }).handler(
 *     async () => {
 *       const client = await incorta.forRequest(getRequest());
 *       return (await client.schemas.physical()).map((s) => s.name);
 *     },
 *   );
 *
 * Or, when you already hold the session:
 *
 *   const session = await getServerSession(request);
 *   const client = incorta.forSession(session);
 *
 * What a scoped client gives you:
 *
 *   client.schemas.physical()             // list physical schemas
 *   client.schemas.business()             // list business schemas
 *   client.schemas.get("SALES")           // one schema, with its tables
 *   client.tables.list("SALES")           // tables + views in a schema
 *   client.tables.columns("SALES", "ORDERS")
 *   client.data.query(["SALES.ORDERS.amount"])
 *   client.user                           // who this is reading as
 *
 * Every read is live — nothing is cached. Build a scoped client per request
 * and let it go: it carries that caller's token and that caller's
 * permissions, so caching one across requests would serve one user's catalog
 * to another, and the token would expire under it anyway.
 *
 * Lazy on purpose: the underlying client reads INCORTA_* at first use, never
 * at module load, because the platform may inject those vars after the
 * process starts. It builds its own auth instance rather than sharing the
 * gate's in ./auth — safe because nothing here drives the LOGIN flow (the
 * gate stays the only thing serving `/auth/*`), and every call goes through
 * `forRequest`/`forSession`, which just carry a token the gate refreshed.
 */
export const incorta: IncortaClient = new Proxy({} as IncortaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getIncortaClient(), property, receiver);
  },
});

let incortaClient: IncortaClient | undefined;

function getIncortaClient(): IncortaClient {
  incortaClient ??= createIncortaClient();
  return incortaClient;
}
