#!/usr/bin/env node
/**
 * SCRBRD — API server.
 *
 * Small, dependency-light, and deliberately dumb about authorization: not one
 * route in this file decides who may see or write anything. Every handler opens
 * a transaction, sets the caller's identity, and runs a query — Postgres decides
 * the rest from the caller's assignments. If a route looks like it is making a
 * security decision, it is a bug.
 *
 * What is mounted:
 *   GET  /api/health
 *   POST /api/auth/dev-login                      (development only)
 *   GET  /api/session                             who am I, what am I assigned to
 *   GET  /api/read/:resource                      the governed read path
 *   POST /api/matches/:id/session/claim           take the scoring token
 *   POST /api/matches/:id/session/heartbeat       keep the lease alive
 *   POST /api/matches/:id/session/handover/arm    offer the token (needs a synced log)
 *   POST /api/matches/:id/session/handover/claim  the incoming device, with the code
 *   POST /api/matches/:id/session/handover/verify confirm the score, then take over
 *   POST /api/matches/:id/session/force-release   recover a dead device (supervisory)
 *   POST /api/matches/:id/events                  append balls (the write path)
 *   POST /api/players/:id/assessment              record a coach's skill assessment
 *   POST /api/players/:id/access-request          ask that player's coach for access
 *   POST /api/access-requests/:id/decide          answer such a request
 *   GET  /api/matches/:id/events?since=           incremental sync
 *   POST /api/ai/statguru, /api/ai/commentary
 *
 *   node services/api/server.mjs        # PORT=8787 by default
 */

import { createServer } from "node:http";
import pg from "pg";
import { askStatGuru, describeDelivery, aiConfigured } from "./ai/ai-service.mjs";
import { sessionProfile, runAsPrincipal, issueLoginCode, redeemMagicLink } from "./auth/auth-db.mjs";
import { signToken, AuthError } from "./auth/auth.mjs";
import { readRoute, liveResources } from "./read/read-api.mjs";
import { eventRoutes, amendmentRoutes, squadRoutes, tossRoutes, conditionsRoutes, officialRoutes } from "./write/events-api.mjs";
import { scoutingRoutes, featureRoutes, drsRoutes } from "./write/scouting-api.mjs";
import { assessmentRoutes, accessRequestRoutes, developmentNoteRoutes, guardianLinkRoutes } from "./write/assessment-api.mjs";
import { sessionRoutes } from "./realtime/session-routes.mjs";
import { MatchHub } from "./realtime/realtime.mjs";

const PORT = Number(process.env.PORT || 8787);
const ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const MAX_BODY = 256 * 1024;   // a batch of an over's balls is a few KB
const DEV = process.env.NODE_ENV !== "production";

// The application connects as scrbrd_app, NOT as the schema owner. Row-level
// security does not apply to a table's owner, so an owner connection runs with
// every policy in db/ silently inert. assertRlsApplies() below refuses to start
// on such a connection; see db/05_app_role.sql for how this was found.
const DATABASE_URL = process.env.DATABASE_URL || "postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd";
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

/**
 * Refuse to serve on a connection that row-level security cannot restrain.
 *
 * Three ways a connection escapes RLS: the role is a superuser, the role has
 * BYPASSRLS, or the role owns the table being queried. All three fail open —
 * every query succeeds, every policy is ignored, and nothing anywhere reports
 * a problem. The unit suites cannot see it (they run against fakes) and the
 * live verifier cannot see it (it deliberately drops to an unprivileged role).
 * A misread DATABASE_URL is all it takes.
 *
 * So the server asks the database what it is, and stops if the answer is wrong.
 */
async function assertRlsApplies() {
  const { rows } = await pool.query(`
    SELECT r.rolname, r.rolsuper, r.rolbypassrls,
           (SELECT count(*) FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r'
               AND c.relrowsecurity AND NOT c.relforcerowsecurity
               AND pg_has_role(r.oid, c.relowner, 'USAGE')) AS owned_governed_tables
      FROM pg_roles r WHERE r.rolname = current_user`);
  const me = rows[0];
  const problems = [];
  if (me.rolsuper) problems.push("it is a SUPERUSER");
  if (me.rolbypassrls) problems.push("it has BYPASSRLS");
  if (Number(me.owned_governed_tables) > 0)
    problems.push(`it owns ${me.owned_governed_tables} of the tables it would query`);
  if (problems.length) {
    console.error(
      `\nRefusing to start: row-level security would not apply to this connection.\n` +
      `  connected as: ${me.rolname}\n` +
      problems.map((p) => `  problem:      ${p}`).join("\n") +
      `\n\nEvery policy in db/ would be inert and every request would be answered in\n` +
      `full, with nothing reporting a fault. Point DATABASE_URL at scrbrd_app\n` +
      `(see db/05_app_role.sql) rather than at the schema owner.\n`);
    process.exit(1);
  }
}

// A signing secret has no safe default. In development one is generated per
// boot, which invalidates every token on restart — annoying, and far better
// than a well-known constant that quietly ships.
const SECRET = process.env.SESSION_SECRET || (() => {
  if (!DEV) {
    console.error("SESSION_SECRET is required outside development. Refusing to start.");
    process.exit(1);
  }
  return `dev-only-${Math.random().toString(36).slice(2)}`;
})();

const hub = new MatchHub();

// ── Tiny Express-shaped adapter ──────────────────────────────────
// The route modules were written against (req, res) with req.params/body/query
// and res.status().json(). Rather than rewrite them for node:http, this maps
// one onto the other — the routes stay framework-agnostic and testable.
const json = (res, status, body) => {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": ORIGIN,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "vary": "origin",
  });
  res.end(JSON.stringify(body));
};

const shim = (res) => ({
  _status: 200,
  status(code) { this._status = code; return this; },
  json(body) { json(res, this._status, body); return this; },
});

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error("payload_too_large"), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

// ── Routes ───────────────────────────────────────────────────────
const events  = eventRoutes({ pool, secret: SECRET });
const session = sessionRoutes({ pool, secret: SECRET, hub });
const read    = readRoute({ pool, secret: SECRET });
const assess  = assessmentRoutes({ pool, secret: SECRET });
const access  = accessRequestRoutes({ pool, secret: SECRET });
const notes   = developmentNoteRoutes({ pool, secret: SECRET });
const amend   = amendmentRoutes({ pool, secret: SECRET });
const guard   = guardianLinkRoutes({ pool, secret: SECRET });
const squad   = squadRoutes({ pool, secret: SECRET });
const toss    = tossRoutes({ pool, secret: SECRET });
const officials = officialRoutes({ pool, secret: SECRET });
const cond    = conditionsRoutes({ pool, secret: SECRET });
const scouting = scoutingRoutes({ pool, secret: SECRET });
const features = featureRoutes({ pool, secret: SECRET });
const drs      = drsRoutes({ pool, secret: SECRET });

/**
 * Development sign-in.
 *
 * Issues a token for a seeded address with no code exchange, because the pilot
 * has no mail sender yet. It is gated three ways — not production, an explicit
 * opt-in, and the account must exist and be active — and it is the ONLY place
 * in the codebase that mints a token without proving possession of an inbox.
 * The real path is requestMagicLink/redeemMagicLink in auth/auth-db.mjs, which
 * needs the login_code table before it can be turned on.
 */
async function devLogin(body) {
  if (!DEV || process.env.ALLOW_DEV_LOGIN !== "1")
    throw Object.assign(new AuthError("dev_login_disabled"), { status: 403 });
  const { email, deviceId } = body;
  if (!email || !deviceId) throw new AuthError("email_and_device_required");
  // Same narrow lookup the real login path uses — the application role cannot
  // read app_user without an identity, and this route is not an exception.
  const { rows } = await pool.query(`select auth_account_for_email($1) as id`, [email]);
  if (!rows[0]?.id) throw new AuthError("no_such_user");
  return { token: signToken({ userId: rows[0].id, deviceId }, SECRET) };
}

// Exact paths, then one pattern for the per-match routes. Kept as a table so
// the mounted surface is readable at a glance.
const EXACT = {
  "POST /api/auth/dev-login": async (body) => devLogin(body),

  // ── The real login, in two halves ──
  //
  // ISSUE is authenticated and authorised: login_code_issue() refuses anybody
  // who does not hold user.invite at the recipient's school, and refuses a code
  // issued to yourself. The raw code comes back to the ISSUER, once, and is
  // never stored — this is the only moment it exists in readable form.
  //
  // REDEEM is unauthenticated by definition. It runs with no identity, spends
  // the code atomically, and returns a session token for the named device.
  "POST /api/auth/invite": async (body, req) => runAsPrincipal(
    pool, SECRET, req.headers?.authorization,
    (client) => issueLoginCode(client, SECRET, { email: body?.email })),
  "POST /api/auth/redeem": async (body) => redeemMagicLink(
    pool, SECRET, { email: body?.email, code: body?.code, deviceId: body?.deviceId }),
  "POST /api/ai/statguru":   async (body) => ({ answer: await askStatGuru({ question: body.question, context: body.context }) }),
  "POST /api/ai/commentary": async (body) => ({ line: await describeDelivery({ situation: body.situation }) }),
};

const MATCH_ROUTES = [
  [/^\/api\/matches\/([^/]+)\/session\/claim$/,     "POST", session.claim],
  [/^\/api\/matches\/([^/]+)\/session\/heartbeat$/, "POST", session.heartbeat],
  // Handover: arm → claim → verify, plus force-release for a dead device.
  // Every transition is a SECURITY DEFINER function in the database; these
  // handlers run it under the caller's identity and broadcast the new state.
  [/^\/api\/matches\/([^/]+)\/session\/handover\/arm$/,     "POST", session.armHandover],
  [/^\/api\/matches\/([^/]+)\/session\/handover\/claim$/,   "POST", session.claimHandover],
  [/^\/api\/matches\/([^/]+)\/session\/handover\/verify$/,  "POST", session.verifyTakeover],
  [/^\/api\/matches\/([^/]+)\/session\/force-release$/,      "POST", session.forceRelease],
  [/^\/api\/matches\/([^/]+)\/events$/,             "POST", events.append],
  [/^\/api\/matches\/([^/]+)\/events$/,             "GET",  events.list],
  [/^\/api\/matches\/([^/]+)\/amendments$/,        "POST", amend.request],
  // Naming the side. The two safeguarding triggers on match_squad fire here,
  // and had no way to fire at all before this route existed.
  [/^\/api\/matches\/([^/]+)\/squad$/,             "POST", squad.select],
  // The toss. Frozen by the database once a delivery exists.
  [/^\/api\/matches\/([^/]+)\/toss$/,              "POST", toss.record],
  // Conditions. Unlike the toss, these stay writable during play — weather
  // changes, and that is the reason for recording it.
  [/^\/api\/matches\/([^/]+)\/weather$/,           "POST", cond.weather],
  [/^\/api\/matches\/([^/]+)\/pitch$/,             "POST", cond.pitch],
  // The groundsman's standing record of a ground — the same capability as the
  // pitch report, keyed on the ground rather than the fixture.
  [/^\/api\/grounds\/([^/]+)\/condition$/,          "POST", cond.ground],
  // The DRS review, and the platform switch that decides whether it may be
  // recorded at all. The switch is enforced by a trigger on the table, not
  // here — see db/08_schema_programme.sql.
  [/^\/api\/matches\/([^/]+)\/drs$/,               "POST", drs.record],
  [/^\/api\/admin\/features\/([^/]+)$/,            "POST", features.set],
  // Appointing the officials. officiating.assign, which until now had nothing
  // it could be exercised on.
  [/^\/api\/matches\/([^/]+)\/officials$/,         "POST", officials.appoint],
];

// Routes keyed on a player rather than a match. Same shape, same shim.
const PLAYER_ROUTES = [
  [/^\/api\/players\/([^/]+)\/assessment$/,     "POST", assess.record],
  [/^\/api\/players\/([^/]+)\/access-request$/, "POST", access.ask],
  [/^\/api\/access-requests\/([^/]+)\/decide$/, "POST", access.decide],
  [/^\/api\/players\/([^/]+)\/notes$/,          "POST", notes.write],
  // Scouting: a guardian's own decision about their own child, and nobody
  // else's — no administrative override exists in scouting_consent_set().
  [/^\/api\/players\/([^/]+)\/scouting-consent$/,  "POST", scouting.consent],
  // The guardian link, which had no route at all until now.
  [/^\/api\/players\/([^/]+)\/guardians$/,             "POST", guard.establish],
  [/^\/api\/players\/([^/]+)\/guardians\/verify$/,     "POST", guard.verify],
  [/^\/api\/players\/([^/]+)\/guardians\/revoke$/,     "POST", guard.revoke],
  [/^\/api\/players\/([^/]+)\/guardians\/consent$/,    "POST", guard.consent],
  [/^\/api\/players\/([^/]+)\/guardians\/withdraw$/,   "POST", guard.withdraw],
  [/^\/api\/notes\/([^/]+)$/,                    "PATCH", notes.revise],
  [/^\/api\/amendments\/([^/]+)\/decide$/,       "POST", amend.decide],
];

// Scouting: keyed on the scout, not on a match or a child. Registration takes
// no id at all — it always means "me" — so its capture group is simply
// absent; the dispatcher's params.id comes back undefined and the handler
// never looks at it.
const SCOUT_ROUTES = [
  [/^\/api\/scouts\/accreditation$/,                      "POST", scouting.registerAccreditation],
  [/^\/api\/scouts\/([^/]+)\/accreditation\/decide$/,   "POST", scouting.decideAccreditation],
];

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/health") {
    let db = "unreachable";
    try { await pool.query("select 1"); db = "ok"; } catch { /* reported as unreachable */ }
    return json(res, 200, {
      ok: db === "ok",
      db,
      ai: aiConfigured() ? "configured" : "no_credentials",
      auth: DEV && process.env.ALLOW_DEV_LOGIN === "1" ? "dev_login_enabled" : "token_only",
      read: liveResources(),
      write: "mounted",
      handover: "mounted",
    });
  }

  try {
    if (req.method === "GET" && path === "/api/session")
      return json(res, 200, await sessionProfile(pool, SECRET, req.headers.authorization));

    if (req.method === "GET" && path.startsWith("/api/read/")) {
      const shimmed = shim(res);
      return read({
        params: { resource: decodeURIComponent(path.slice("/api/read/".length)) },
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
      }, shimmed);
    }

    for (const [pattern, method, handler] of [...MATCH_ROUTES, ...PLAYER_ROUTES, ...SCOUT_ROUTES]) {
      const m = req.method === method && pattern.exec(path);
      if (!m) continue;
      const body = (req.method === "POST" || req.method === "PATCH") ? await readJson(req) : {};
      return handler({
        params: { id: m[1] },
        query: Object.fromEntries(url.searchParams),
        body,
        headers: req.headers,
      }, shim(res));
    }

    const exact = EXACT[`${req.method} ${path}`];
    // The request is passed as well as the body: /api/auth/invite is an
    // AUTHENTICATED route and needs the caller's identity to check that they
    // may issue a code for the address they named.
    if (exact) return json(res, 200, await exact(await readJson(req), req));

    return json(res, 404, { error: "not_found" });
  } catch (err) {
    // A bare SQLSTATE in a response is unhelpful and a stack trace in one is
    // unsafe; the detail goes to the log, the code goes to the client.
    if (!err.status) console.error(`${req.method} ${path} →`, err.code || "", err.message, err.detail || "");
    return json(res, err.status || 500, { error: err.code || err.message || "internal_error" });
  }
});

await assertRlsApplies();

server.listen(PORT, () => {
  console.log(`SCRBRD API on http://localhost:${PORT}`);
  console.log(`  db:   ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")} (row-level security applies)`);
  console.log(`  ai:   ${aiConfigured() ? "configured" : "NO CREDENTIALS — StatGuru and commentary return null"}`);
  if (!process.env.SESSION_SECRET) console.log("  auth: EPHEMERAL dev secret — tokens die on restart");
  if (DEV && process.env.ALLOW_DEV_LOGIN === "1") console.log("  auth: DEV LOGIN ENABLED — /api/auth/dev-login mints tokens without a code");
});

export { server, pool };
