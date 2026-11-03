import process from "node:process";

import { createIncortaAuth, type IncortaAuth } from "@incorta/auth";

// PLATFORM-OWNED FILE — do not edit or delete. Every route and server
// function in this app is protected by Incorta authentication enforced in
// src/server.ts through handleAuthRequest() below. Build user-aware UI with
// the @incorta/auth/react hooks (useUser, useAuth) and read the server-side
// session with getServerSession() from this module.

const BASE_PATH = "/auth";

/**
 * Env contract the Incorta Apps platform injects into the runtime env. No
 * INCORTA_CLIENT_SECRET: Incorta registers this app as a public OAuth client
 * and the SDK protects the code flow with PKCE instead.
 */
const REQUIRED_ENV = [
  "INCORTA_URL",
  "INCORTA_TENANT",
  "INCORTA_CLIENT_ID",
  "INCORTA_AUTH_SECRET",
] as const;

export function isAuthConfigured(): boolean {
  return REQUIRED_ENV.every((name) => (process.env[name] ?? "").trim() !== "");
}

let instance: IncortaAuth | undefined;

/**
 * Cookie behavior defaults to embedded mode — SameSite=None + Partitioned
 * (CHIPS) — because this app is previewed inside the Incorta builder's
 * CROSS-SITE iframe, where Lax cookies are never sent and the login flow
 * would loop forever. The same setting works top-level. INCORTA_COOKIE_*
 * env vars override; partitioned is clamped off unless sameSite is "none"
 * (browsers only partition cross-site cookies, and the SDK refuses the
 * combination).
 */
function cookieConfig(): { sameSite: "lax" | "none"; partitioned: boolean } {
  const rawSameSite = process.env.INCORTA_COOKIE_SAMESITE?.toLowerCase();
  const sameSite = rawSameSite === "lax" ? "lax" : "none";
  const rawPartitioned = process.env.INCORTA_COOKIE_PARTITIONED?.toLowerCase();
  const partitioned =
    sameSite === "none" &&
    (rawPartitioned === undefined ||
      rawPartitioned === "1" ||
      rawPartitioned === "true");
  return { sameSite, partitioned };
}

function getAuth(): IncortaAuth {
  // Lazy on purpose: reads env at first request, never at module load
  // (config is per-process; see src/lib/config.server.ts for the pattern).
  instance ??= createIncortaAuth({
    basePath: BASE_PATH,
    cookies: cookieConfig(),
    // The gate redirects into Incorta login in place. Showing the signed-in
    // app inside the cross-site preview iframe requires iframe inclusion
    // enabled on the Incorta cluster (see src/auth/README.md in the api). If a
    // cluster can't enable it, @incorta/auth supports `embeddedSignIn:
    // "new-tab"` as a fallback (sign in via a new top-level tab) — not on here.
  });
  return instance;
}

/** The signed-in user's session for server code (server functions, loaders).
 *  Null when unauthenticated — which gated requests only ever are in a
 *  PUBLIC app (anonymous visitors); private apps never reach app code
 *  without a session. */
export async function getServerSession(request: Request) {
  if (!isAuthConfigured()) return null;
  return getAuth().getSession(request);
}

/**
 * The auth gate, called by src/server.ts for EVERY incoming request before
 * the app handler runs. It enforces the platform-stamped access policy
 * (INCORTA_APP_ACCESS) via the SDK's whole-app gate:
 *
 * - `/auth/*` is always served by the SDK handler (login, callback, session,
 *   logout) — signing in stays possible even for public apps;
 * - PUBLIC apps let every other request through, signed in or not
 *   (getServerSession() returns null for anonymous visitors — handle it);
 * - private apps refuse sessionless requests — browser navigations are
 *   redirected into the Incorta login flow (and return to the original page
 *   after sign-in), data requests get a 401 — and when catalog access
 *   control applies, signed-in users additionally need at least VIEW access
 *   to THIS app (the SDK renders the access-denied/unavailable pages);
 * - a `null` return means "continue to the app".
 *
 * When the platform has not (yet) injected the INCORTA_* secrets, every
 * request gets an honest "authentication not configured" answer instead of a
 * crash — the platform retries provisioning on the next dev-server start.
 */
export async function handleAuthRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (!isAuthConfigured()) {
    return notConfiguredResponse(request);
  }

  const auth = getAuth();
  // SDK ≥ 1.7 ships the policy-aware whole-app gate — delegate outright.
  // The fallback below keeps this file working against older installs
  // (their behavior equals the "authenticated" policy).
  const gate = (
    auth as { gate?: (request: Request) => Promise<Response | null> }
  ).gate;
  if (typeof gate === "function") {
    return gate.call(auth, request);
  }

  if (url.pathname === BASE_PATH || url.pathname.startsWith(`${BASE_PATH}/`)) {
    return auth.handler(request);
  }

  const session = await auth.getSession(request);
  if (session) return null;

  const wantsHtml =
    request.method === "GET" &&
    (request.headers.get("accept") ?? "").includes("text/html");
  if (wantsHtml) {
    const redirectTo = `${url.pathname}${url.search}`;
    // Relative Location on purpose: this server sits behind a Host-rewriting
    // proxy, so the request's own origin is an internal loopback address —
    // only the BROWSER knows the public origin, and it resolves a relative
    // redirect against it.
    return new Response(null, {
      status: 302,
      headers: {
        location: `${BASE_PATH}/login?redirect_to=${encodeURIComponent(redirectTo)}`,
      },
    });
  }
  return new Response(JSON.stringify({ error: "unauthenticated" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function notConfiguredResponse(request: Request): Response {
  const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
  if (!wantsHtml) {
    return new Response(JSON.stringify({ error: "auth_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authentication not configured</title>
    <style>
      body { margin: 0; display: grid; place-items: center; min-height: 100vh;
             background: #fafafa; color: #18181b;
             font-family: ui-sans-serif, system-ui, sans-serif; }
      main { max-width: 28rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
      p { color: #52525b; font-size: .9rem; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authentication is not configured yet</h1>
      <p>
        This app signs users in through Incorta, but its credentials have not
        been provisioned. They are injected automatically — restarting the
        app's dev server usually completes the setup.
      </p>
    </main>
  </body>
</html>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
