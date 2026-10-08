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
 *   POST /api/auth/firebase                       sign in with Google (SCRBRD-140, auth/signin-api.mjs)
 *   POST /api/auth/sign-ins, …/claims/:id/confirm the ways a person signs in, and the office's claims
 *   GET  /api/session                             who am I, what am I assigned to
 *   GET  /api/read/:resource                      the governed read path
 *   POST /api/matches/:id/session/claim           take the scoring token
 *   POST /api/matches/:id/session/heartbeat       keep the lease alive
 *   POST /api/matches/:id/session/handover/arm    offer the token (needs a synced log)
 *   POST /api/matches/:id/session/handover/claim  the incoming device, with the code
 *   POST /api/matches/:id/session/handover/verify confirm the score, then take over
 *   POST /api/matches/:id/session/force-release   recover a dead device (supervisory)
 *   POST /api/matches/:id/events                  append balls (the write path)
 *   GET  /api/matches/:id/toss                    one match's toss
 *   POST /api/matches/:id/session/pad-credential  the pad's resume credential, on a claim (SCRBRD-078)
 *   POST /api/matches/:id/pad-credentials/revoke  the school office ends them
 *   POST /api/auth/sign-out                       this device's sessions and credentials end
 *   POST /api/auth/sign-out-everywhere            every session and credential ends (db/85)
 *   POST /api/auth/users/:id/disable · /enable { reason }   the office ends an account's sessions, saying why (db/85, db/90)
 *   GET  /api/auth/users/:id/preview              what disabling an account would cut (db/90)
 *   POST /api/players/:id/assessment              record a coach's skill assessment
 *   POST /api/players/:id/access-request          ask that player's coach for access
 *   POST /api/access-requests/:id/decide          answer such a request
 *   POST /api/assignments/:id/end { reason }      end one role (db/77), the row withdrawn, never deleted
 *   GET  /api/matches/:id/events?since=           incremental sync
 *   POST /api/ai/stats-magic, /api/ai/commentary
 *   GET/POST /api/matches/:id/publication      a side of a fixture on the public pages
 *   GET/POST /api/schools/:id/listing          a school's matches on the public home page
 *   POST /api/news/:id/public/{request,approve,withdraw}  a notice on the public home page (db/83)
 *   GET/POST /api/players/:id/public-name      a child's public-name consent (and …/never-public, the mark)
 *   GET/POST /api/schools/:id/public-names     a school's names-off switch per age group
 *   GET  /api/public/…, /live/:id, /scorecard/:id  the signed-out pages (off unless
 *                                         PUBLIC_PAGES=on — public/public-api.mjs)
 *
 *   node services/api/server.mjs        # PORT=8787 by default
 *
 * A request signed with the pad's resume credential (Authorization:
 * ScrbrdPad …) is answered by servePad() below and nowhere else: five routes,
 * its own match, and a 403 for every other path before anything is read.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve, sep } from "node:path";
import pg from "pg";
import { askStatsMagic, describeDelivery, statsMagicContext, aiConfigured } from "./ai/ai-service.mjs";
import { readerConfig } from "./ai/scorebook-reader.mjs";
import { sessionProfile, runAsPrincipal, issueLoginCode, redeemMagicLink, mintToken, afterCommit } from "./auth/auth-db.mjs";
import { keyedWrite, fingerprint } from "./write/replay.mjs";
import { AuthError } from "./auth/auth.mjs";
import { isPadAuthorization, padRoute, padPrincipal, padRefusal, padCredentialRoutes } from "./auth/pad-resume.mjs";
import { signInRoutes, verifierFromEnv } from "./auth/signin-api.mjs";
import { readRoute, exportRoute, liveResources } from "./read/read-api.mjs";
import { importRoutes } from "./io/import-api.mjs";
import { eventRoutes, amendmentRoutes, quarantineRoutes, correctionRoutes, squadRoutes, tossRoutes, conditionsRoutes, officialRoutes, availabilityRoutes, transportRoutes } from "./write/events-api.mjs";
import { scoutingRoutes, featureRoutes, drsRoutes, broadcastRoutes, sponsorRoutes, moduleAdminRoutes } from "./write/scouting-api.mjs";
import { assessmentRoutes, accessRequestRoutes, developmentNoteRoutes, guardianLinkRoutes } from "./write/assessment-api.mjs";
import { disciplineRoutes } from "./write/discipline-api.mjs";
import { sessionRoutes } from "./realtime/session-routes.mjs";
import { deviceRoutes, notificationRoutes, transportFor } from "./notify/push-api.mjs";
import { receiptRoutes } from "./notify/receipts-api.mjs";
import { rewardWeightRoutes } from "./rewards/weights-api.mjs";
import { fixtureRoutes } from "./write/fixture-api.mjs";
import { ownerRecoveryRoutes } from "./write/owner-recovery-api.mjs";
import { rosterRoutes } from "./write/roster-api.mjs";
import { dobCaptureRoutes } from "./write/dob-capture-api.mjs";
import { supportAccessRoutes } from "./write/support-access-api.mjs";
import { dutyAuthorityRoutes } from "./write/duty-authority-api.mjs";
import { contactRoutes } from "./write/contacts-api.mjs";
import { clearanceRoutes } from "./write/clearance-api.mjs";
import { safeguardingRoutes } from "./write/safeguarding-api.mjs";
import { recognitionRoutes } from "./write/recognition-api.mjs";
import { competitionRoutes } from "./write/competitions-api.mjs";
import { playingConditionsRoutes } from "./write/playing-conditions-api.mjs";
import { plannerRoutes } from "./write/planner-api.mjs";
import { leagueRoutes } from "./write/league-api.mjs";
// SCRBRD-114 phase 3a (db/69): match results and the league table.
import { resultsRoutes } from "./write/results-api.mjs";
// SCRBRD-130 (db/73–75): the rain rule's reads — venue par, the DLS proposal.
import { rainRoutes } from "./read/rain-api.mjs";
import { requestRoutes } from "./write/requests-api.mjs";
import { newsRoutes } from "./write/news-api.mjs";
import { kitRoutes } from "./write/kit-api.mjs";
import { workloadRoutes } from "./write/workload-api.mjs";
import { loadRoutes } from "./write/load-api.mjs";
import { rosterAddRoutes } from "./write/roster-add-api.mjs";
import { trainingRoutes } from "./write/training-api.mjs";
import { officialRegisterRoutes } from "./write/officials-register-api.mjs";
import { publicationRoutes } from "./write/publication-api.mjs";
import { listingRoutes } from "./write/listing-api.mjs";
import { publicNameRoutes } from "./write/public-name-api.mjs";
import { scorebookRoutes, scorebookFileRoutes } from "./write/scorebook-api.mjs";
// SCRBRD-124 phase 1: parent lift clubs (db/70).
import { liftRoutes } from "./write/lift-api.mjs";
// Practice Match's live weather hint, from Google (2026-10-02): a hint, never
// the match's record; nothing stored (weather/weather-api.mjs).
import { weatherRoutes, weatherConfig } from "./weather/weather-api.mjs";
import { objectStoreFromEnv } from "./io/object-store.mjs";
import { PAGE_MAX_BYTES } from "./io/page-image.mjs";
import { publicPages } from "./public/public-api.mjs";
import { MatchHub } from "./realtime/realtime.mjs";
import { schemaRefusal } from "./schema-guard.mjs";
import { revisionFromEnv } from "./revision.mjs";
import { appUrl, port } from "../../tools/db-url.mjs";
/** @import { IncomingMessage, ServerResponse } from "node:http" */
/** @import { Handler, IdHandler, ExactHandler } from "./api-types.mjs" */

// Every deployment and every walk that spawns this server sets PORT and
// WEB_ORIGIN explicitly, so these two defaults are only ever read from a bare
// `pnpm dev:api` in a worktree — port(...) keeps that default offset-aware
// (SCRBRD_PORT_OFFSET) without changing it when the offset is 0, which it is
// everywhere else, including production (Cloud Run always supplies PORT).
const PORT = Number(process.env.PORT || port(8787));
const ORIGIN = process.env.WEB_ORIGIN || `http://localhost:${port(5173)}`;
// A batch of an over's balls is a few KB. A CSV roster is the biggest thing
// that arrives here: four hundred boys with ten columns is about 40 KB, so
// 256 KB carries a large school with room to spare — and a school sending
// something ten times that size has sent the wrong file, which is worth
// refusing rather than parsing.
const MAX_BODY = 256 * 1024;
const DEV = process.env.NODE_ENV !== "production";

// The application connects as scrbrd_app, NOT as the schema owner. Row-level
// security does not apply to a table's owner, so an owner connection runs with
// every policy in db/ silently inert. assertRlsApplies() below refuses to start
// on such a connection; see db/06_app_role.sql for how this was found.
// DATABASE_URL first: it is how every deployment names the application role
// (DEPLOYING.md, Cloud Run). appUrl() is only the local default — this
// worktree's database when SCRBRD_DB is set, the plain local one otherwise.
const DATABASE_URL = process.env.DATABASE_URL || appUrl();
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
      `(see db/06_app_role.sql) rather than at the schema owner.\n`);
    process.exit(1);
  }
}

/**
 * Refuse to serve code the database has not caught up with (SCRBRD-066).
 *
 * The same shape as assertRlsApplies(), for the other way a deploy fails
 * silently: this code expects a migration the database does not have, and
 * every screen that needs it answers 42P01/42883. A revision that does not
 * start never takes traffic on Cloud Run or Render, so the previous one keeps
 * serving until the schema is applied. The list and the reasoning are in
 * schema-guard.mjs; a database AHEAD of the code (schema first) starts fine.
 */
async function assertSchemaCurrent() {
  const refusal = await schemaRefusal(pool);
  if (refusal) {
    console.error(refusal);
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

// ── The signed-out pages (SCRBRD-083 phase 1) ────────────────────
// OFF unless PUBLIC_PAGES=on. Going live waits on the information officer's
// written confirmation of docs/policy/PUBLIC_DATA.md (the design's phase 1
// "before live"), so a deployment that says nothing serves none of them:
// every public path is the same 404 an unknown fixture gets.
//
// PUBLIC_PSEUDONYM_SECRET keys the per-match pseudonyms that stand in for
// every player id on a public page (public/redact.mjs). It has no safe
// default either: outside development the server refuses to start with the
// pages on and no secret, or with the session's secret reused for it (one
// leak would then be two). In development one is generated per boot, which
// only changes the pseudonyms at the next restart.
const PUBLIC_ON = process.env.PUBLIC_PAGES === "on";
const PUBLIC_SECRET = PUBLIC_ON ? (process.env.PUBLIC_PSEUDONYM_SECRET || (() => {
  if (!DEV) {
    console.error("PUBLIC_PAGES=on needs PUBLIC_PSEUDONYM_SECRET outside development. Refusing to start.");
    process.exit(1);
  }
  return `dev-only-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
})()) : null;
if (PUBLIC_ON && !DEV && (String(PUBLIC_SECRET).length < 32 || PUBLIC_SECRET === SECRET)) {
  console.error("PUBLIC_PSEUDONYM_SECRET must be 32+ characters and not SESSION_SECRET. Refusing to start.");
  process.exit(1);
}
const publicSite = publicPages({
  pool, enabled: PUBLIC_ON, secret: PUBLIC_SECRET,
  trustProxyHops: Number(process.env.PUBLIC_TRUST_PROXY_HOPS || 0),
  listenUrl: PUBLIC_ON ? DATABASE_URL : null,
});

// ── Tiny Express-shaped adapter ──────────────────────────────────
// The route modules were written against (req, res) with req.params/body/query
// and res.status().json(). Rather than rewrite them for node:http, this maps
// one onto the other — the routes stay framework-agnostic and testable.
// Named once, because a file response needs the same set and a second copy
// would be the one that goes stale — a download that works in development and
// is blocked by the browser in production.
const CORS = {
  "access-control-allow-origin": ORIGIN,
  "access-control-allow-headers": "content-type, authorization",
  // DELETE: a scorebook page taken off its import (SCRBRD-120).
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  // The row count and the filename have to be readable by the page that asked
  // for the download, and a cross-origin response exposes no custom header
  // unless it says so.
  "access-control-expose-headers": "content-disposition, x-scrbrd-rows",
  "vary": "origin",
};

/** @param {ServerResponse} res @param {number} status @param {unknown} body */
const json = (res, status, body) => {
  if (res.writableEnded) return;
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
};

/**
 * The response shim: Express-shaped status()/json() over a bare ServerResponse.
 *
 * IT RECORDS; THE DISPATCHER SENDS. Every write handler answers from inside
 * its transaction — res.json() is called in the runAsPrincipal callback, and
 * withPrincipal() only issues COMMIT once that callback returns. When json()
 * wrote to the socket directly, the 200 could reach the client a few
 * milliseconds before the row was committed: a walk that read the database
 * on the very next line missed it now and then (roster-add, intermittently,
 * on CI), and — the part that matters — a client could be told "saved" for
 * a write whose COMMIT then refused. So json() stores the answer, and the
 * dispatcher flushes it after the handler's promise has resolved, which for
 * a write is after COMMIT. No handler changed; the meaning of their 200 did.
 *
 * THE LAST WORD WINS. A handler that recorded 200 and then, when COMMIT
 * threw, recorded 500 in its catch has answered 500 — the first answer was
 * never sent. rawRes() below overrides json() to write immediately, for the
 * two file responses that end with bytes of their own; both are reads.
 *
 * @typedef {{ status: number, body: unknown }} Sent
 * @typedef {object} Shim
 * @property {number} _status
 * @property {Sent | null} _pending
 * @property {(code: number) => Shim} status
 * @property {(body: unknown) => Shim} json
 * @property {() => Sent | null} flush
 *
 * @param {ServerResponse} res
 * @returns {Shim}
 */
const shim = (res) => ({
  _status: 200,
  _pending: null,
  status(code) { this._status = code; return this; },
  json(body) { this._pending = { status: this._status, body }; return this; },
  /** Send what was recorded, if anything. Returns it, so a caller can act on the status. */
  flush() {
    const sent = this._pending;
    this._pending = null;
    if (sent) json(res, sent.status, sent.body);
    return sent;
  },
});

/**
 * The shim, plus the two methods a file response needs.
 *
 * The CSV routes set their own content-type and content-disposition and end
 * with bytes rather than JSON, so they cannot use the plain shim — it has
 * status() and json() and nothing else. Handed the plain one they throw on
 * writeHead, which is exactly how this was found.
 *
 * @typedef {object} RawShim
 * @property {number} _status
 * @property {Sent | null} _pending
 * @property {(code: number) => RawShim} status
 * @property {(body: unknown) => RawShim} json
 * @property {() => Sent | null} flush
 * @property {(code: number, headers: Record<string, string | number>) => RawShim} writeHead
 * @property {(body?: string | Buffer) => RawShim} end
 *
 * @param {ServerResponse} res
 * @returns {RawShim}
 */
const rawRes = (res) => ({
  ...shim(res),
  _status: 200,
  status(code) { this._status = code; return this; },
  json(body) { json(res, this._status, body); return this; },
  writeHead(code, headers) { res.writeHead(code, { ...CORS, ...headers }); return this; },
  end(body) { res.end(body); return this; },
});

/**
 * The body's exact bytes. A pad resume credential signs their hash, so the
 * bytes are kept rather than only the parse of them.
 * A scorebook page's photo reads up to its own, larger cap (SCRBRD-120).
 * @param {IncomingMessage} req
 * @param {number} [cap]  bytes; MAX_BODY for every JSON body
 * @returns {Promise<Buffer>}
 */
async function readRaw(req, cap = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > cap) throw Object.assign(new Error("payload_too_large"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {Buffer} raw
 * @returns {any}  parsed JSON from the wire: every handler validates what it reads
 */
function parseJson(raw) {
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString("utf8")); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

/**
 * @param {IncomingMessage} req
 * @returns {Promise<any>}  parsed JSON from the wire: every handler validates what it reads
 */
async function readJson(req) {
  return parseJson(await readRaw(req));
}

// ── Routes ───────────────────────────────────────────────────────
const events  = eventRoutes({ pool, secret: SECRET });
// The session hub, told only once a keyed write has committed (afterCommit,
// auth-db.mjs); outside one, at once, as before.
const session = sessionRoutes({ pool, secret: SECRET, hub: Object.assign(Object.create(hub), {
  /** @param {string} matchId @param {any} s */
  broadcastSession: (matchId, s) => afterCommit(() => hub.broadcastSession(matchId, s)) }) });
const read    = readRoute({ pool, secret: SECRET });
const assess  = assessmentRoutes({ pool, secret: SECRET });
const access  = accessRequestRoutes({ pool, secret: SECRET });
const notes   = developmentNoteRoutes({ pool, secret: SECRET });
const conduct = disciplineRoutes({ pool, secret: SECRET });
// GA-I36 N2: an approved amendment's void and a released held ball drop the
// fixture's public cache once committed (afterCommit, as the publication
// route's), so the public log answers the new head at once. No hub: nothing
// subscribes to it, and every screen polls (Kameel, 8 Oct).
const amend   = amendmentRoutes({ pool, secret: SECRET, onChange: (note) => afterCommit(() => publicSite.changed(note)) });
const quarantine = quarantineRoutes({ pool, secret: SECRET, onChange: (note) => afterCommit(() => publicSite.changed(note)) });
// GA-I36 N1: the corrections waiting on a match, and across the reader's matches.
const corrections = correctionRoutes({ pool, secret: SECRET });
const guard   = guardianLinkRoutes({ pool, secret: SECRET });
const squad   = squadRoutes({ pool, secret: SECRET });
const toss    = tossRoutes({ pool, secret: SECRET });
const officials = officialRoutes({ pool, secret: SECRET });
const ownerRecovery = ownerRecoveryRoutes({ pool, secret: SECRET });
const register  = officialRegisterRoutes({ pool, secret: SECRET });
const avail    = availabilityRoutes({ pool, secret: SECRET });
const trips    = transportRoutes({ pool, secret: SECRET });
const bulk     = importRoutes({ pool, secret: SECRET });
const exporter = exportRoute({ pool, secret: SECRET });
const cond    = conditionsRoutes({ pool, secret: SECRET });
const scouting = scoutingRoutes({ pool, secret: SECRET });
const features = featureRoutes({ pool, secret: SECRET });
const drs      = drsRoutes({ pool, secret: SECRET });
const bcast    = broadcastRoutes({ pool, secret: SECRET });
const sponsors = sponsorRoutes({ pool, secret: SECRET });
const modAdmin = moduleAdminRoutes({ pool, secret: SECRET });
// The pad's resume credential (SCRBRD-078): issued on a claim, revoked by the
// office or a sign-out. Signed-in routes; a credential reaches none of them.
const padCreds = padCredentialRoutes({ pool, secret: SECRET });
// Push delivery. The transport is resolved once at boot so an unconfigured
// deployment answers "not configured" on the fan-out rather than discovering
// it per request — and so a walk can read back what a dev transport sent.
const pushOut  = transportFor();
const devices  = deviceRoutes({ pool, secret: SECRET });
const notices  = notificationRoutes({ pool, secret: SECRET, transport: pushOut });
// Opening a notice and marking notices read (NOTIFICATIONS.md D17).
const receipts = receiptRoutes({ pool, secret: SECRET });
// The rewards algorithm's coefficients. Write-only by design — see
// services/api/rewards/weights-api.mjs for why there is no matching read.
const rewards  = rewardWeightRoutes({ pool, secret: SECRET });
// Arranging a fixture, which had no route at all — fixture.update was a
// capability in five roles with nothing it could act on.
const fixtures = fixtureRoutes({ pool, secret: SECRET });
// Moving a boy between sides, dated. The history row is the trigger's.
const roster   = rosterRoutes({ pool, secret: SECRET });
const dobCapture = dobCaptureRoutes({ pool, secret: SECRET });
const support = supportAccessRoutes({ pool, secret: SECRET });
// SCRBRD-034: a duty linked to the assignment it rests on, and the pause.
const duties = dutyAuthorityRoutes({ pool, secret: SECRET });
// Who to ring for a child. Kept by the family and the office; the driver
// reaches the manifest through the trip, see trip_contacts() in db/08.
const contacts = contactRoutes({ pool, secret: SECRET });
const clearances = clearanceRoutes({ pool, secret: SECRET });
// Safeguarding, phase 1 (db/57): raising a concern, and the DSO's record.
const safeguarding = safeguardingRoutes({ pool, secret: SECRET });
const recognition = recognitionRoutes({ pool, secret: SECRET });
const competitions = competitionRoutes({ pool, secret: SECRET });
const requests = requestRoutes({ pool, secret: SECRET });
// Sign-up with Google (SCRBRD-140 phase 1, db/81). Google's keys for
// scrbrd-os; FIREBASE_TEST_KEYS (the walk's own key) is refused in
// production and verifies only a project that is not scrbrd-os.
const firebase = (() => {
  try { return verifierFromEnv({ dev: DEV }); }
  catch (/** @type {any} */ e) { console.error(e.message); process.exit(1); }
})();
const signIn = signInRoutes({ pool, secret: SECRET, verifier: firebase.verifier,
                              trustProxyHops: Number(process.env.PUBLIC_TRUST_PROXY_HOPS || 0) });
// A notice's public request, approval or withdrawal — and the author's own
// withdrawal of a notice — drops the public news before it answers (db/83).
const news = newsRoutes({ pool, secret: SECRET, onChange: (note) => afterCommit(() => publicSite.changed(note)) });
const kit = kitRoutes({ pool, secret: SECRET });
const workload = workloadRoutes({ pool, secret: SECRET });
const load = loadRoutes({ pool, secret: SECRET });
const rosterAdd = rosterAddRoutes({ pool, secret: SECRET });
const training = trainingRoutes({ pool, secret: SECRET });
// A publish or withdrawal drops the public cache's entry before it answers,
// not when db/59's notification arrives (publication-api.mjs).
const publication = publicationRoutes({ pool, secret: SECRET, onChange: (note) => afterCommit(() => publicSite.changed(note)) });
const listing = listingRoutes({ pool, secret: SECRET, onChange: (note) => afterCommit(() => publicSite.changed(note)) });
const publicName = publicNameRoutes({ pool, secret: SECRET, onChange: (note) => afterCommit(() => publicSite.changed(note)) });
const playing = playingConditionsRoutes({ pool, secret: SECRET });
// The fixture planner, phase 2 (SCRBRD-123, db/67).
const planner = plannerRoutes({ pool, secret: SECRET });
const league = leagueRoutes({ pool, secret: SECRET });
// SCRBRD-114 phase 3a (db/69): match results and the league table.
const results = resultsRoutes({ pool, secret: SECRET });
// SCRBRD-130: the rain rule's reads.
const rain = rainRoutes({ pool, secret: SECRET });
// The scorebook importer (SCRBRD-120, db/63). Its photos go to the private
// store (io/object-store.mjs): Supabase Storage when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set, a local directory in development, and
// nothing at all in production without them (uploads answer 503).
const pageStore = objectStoreFromEnv();
const scorebook = scorebookRoutes({ pool, secret: SECRET, store: pageStore });
const scorebookFiles = scorebookFileRoutes({ pool, secret: SECRET, store: pageStore });
// SCRBRD-124 phase 1: parent lift clubs (db/70).
const lifts = liftRoutes({ pool, secret: SECRET });
// The key is read once, here, and goes nowhere but Google's header. Unset,
// the hint answers 503 weather_unavailable and the scorer picks by hand.
// Only an enrolled account may spend the quota (db/81's app_enrolled()): a
// Google account that signed up and holds nothing is answered 403.
const weather = weatherRoutes({ secret: SECRET, ...weatherConfig(process.env),
  enrolled: (authorization) => runAsPrincipal(pool, SECRET, authorization,
    async (c) => (await c.query("select app_enrolled() as ok")).rows[0]?.ok === true) });

/**
 * Development sign-in.
 *
 * Issues a token for a seeded address with no code exchange, because the pilot
 * has no mail sender yet. It is gated three ways — not production, an explicit
 * opt-in, and the account must exist and be active — and it is the ONLY place
 * in the codebase that mints a token without proving possession of an inbox.
 * The real path is requestMagicLink/redeemMagicLink in auth/auth-db.mjs, which
 * needs the login_code table before it can be turned on.
 * @param {any} body  the request body as sent
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
  return { token: await mintToken(pool, SECRET, { userId: rows[0].id, deviceId }) };
}

// Exact paths, then one pattern for the per-match routes. Kept as a table so
// the mounted surface is readable at a glance.
/** @type {Record<string, ExactHandler>} */
const EXACT = {
  "POST /api/auth/dev-login": async (body) => devLogin(body),

  // The owner's own way back in — see owner-recovery-api.mjs. Off by
  // default (501) until OWNER_RECOVERY_SECRET is set on this server.
  "POST /api/auth/owner/recover": ownerRecovery.recover,


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
  // Sign-in with Google (SCRBRD-140): Google's signed statement, verified
  // here, exchanged for the same token a code ends in. Unauthenticated, rate
  // limited per address and per Google account; auth_identity_sign_in()
  // (db/81) decides — and never links on an email alone where there is
  // anything to protect (claim_required).
  "POST /api/auth/firebase": signIn.exchange,
  // Signing out ends this person's sessions on this device (db/85: the token
  // is refused from its next request) and their pad resume credentials here
  // (db/50). The client also forgets the keys, which ends them there even
  // when this cannot reach the server.
  "POST /api/auth/sign-out": padCreds.signOut,
  // Stats-Magic's data is built server-side from the read path under the
  // caller's identity — no session, no answer — and every pupil's name is
  // swapped for a token before the model sees it. Commentary stays open (the
  // demo scorer has no session) but sends the names it is given the same
  // masked way. See services/api/ai/ai-service.mjs.
  "POST /api/ai/stats-magic":   async (body, req) => {
    const ctx = await statsMagicContext(pool, SECRET, req.headers?.authorization);
    return { answer: await askStatsMagic({ question: body.question, ...ctx }) };
  },
  "POST /api/ai/commentary": async (body) => ({ line: await describeDelivery({ situation: body.situation, names: body.names }) }),
};

/**
 * pattern, method, handler, and — for a route a module owns — that module's key.
 * A pattern with no capture group hands its handler `id: undefined`; only the
 * session routes, all /matches/:id/…, are typed as always having one.
 * @typedef {[RegExp, string, Handler | IdHandler, string?]} Route
 */
/** @type {Route[]} */
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
  // The way out of quarantine: list what is waiting, then accept or reject.
  [/^\/api\/matches\/([^/]+)\/quarantine$/,         "GET",  quarantine.list],
  // GA-I36 N1: the amendments and held balls on a match, under their own policies.
  [/^\/api\/matches\/([^/]+)\/corrections$/,        "GET",  corrections.forMatch],
  // Naming the side. The two safeguarding triggers on match_squad fire here,
  // and had no way to fire at all before this route existed.
  [/^\/api\/matches\/([^/]+)\/squad$/,             "POST", squad.select],
  // Whether a boy can play, said by his family or recorded by his coach.
  // NOT module-gated: a side is picked from availability, and a school that
  // could not collect it would be picking blind.
  [/^\/api\/matches\/([^/]+)\/availability$/,     "POST", avail.declare],
  // Getting the side there. Module-gated on logistics: a school that does not
  // run its transport through SCRBRD should not be asked to.
  [/^\/api\/matches\/([^/]+)\/trip$/,             "POST", trips.trip, "logistics"],
  [/^\/api\/trips\/([^/]+)\/mark$/,               "POST", trips.mark, "logistics"],
  // The toss. Frozen by the database once a delivery exists.
  [/^\/api\/matches\/([^/]+)\/toss$/,              "POST", toss.record],
  // One match's toss, which is what the pad reads (not every fixture's).
  [/^\/api\/matches\/([^/]+)\/toss$/,              "GET",  toss.read],
  // The pad's resume credential (SCRBRD-078, db/50): issued to the device
  // that holds the token, with an ordinary token; ended by the office.
  [/^\/api\/matches\/([^/]+)\/session\/pad-credential$/, "POST", padCreds.issue],
  [/^\/api\/matches\/([^/]+)\/pad-credentials\/revoke$/,  "POST", padCreds.revoke],
  // Conditions. Unlike the toss, these stay writable during play — weather
  // changes, and that is the reason for recording it.
  [/^\/api\/matches\/([^/]+)\/weather$/,           "POST", cond.weather],
  [/^\/api\/matches\/([^/]+)\/pitch$/,             "POST", cond.pitch,    "fields"],
  // The groundsman's standing record of a ground — the same capability as the
  // pitch report, keyed on the ground rather than the fixture.
  [/^\/api\/grounds\/([^/]+)\/condition$/,          "POST", cond.ground,   "fields"],
  // A FOURTH ELEMENT, on the routes a module owns: the switch that must be on
  // for the route to be reachable at all. Checked once in the dispatcher, so
  // no handler has to remember — and so the read gate and the write gate ask
  // the same function about the same key.
  //
  // Routes with no module here are deliberately ungated. Scoring a match,
  // recording an amendment and naming a squad are the product, not a module
  // somebody may switch off, and a fixture that could not be scored because a
  // menu setting was wrong is a Saturday afternoon nobody recovers.
  //
  // A feature whose writes are already gated in the DATABASE is deliberately
  // not tagged here — see the DRS route below.
  // NOT tagged, though DRS is a switchable feature. Its write is gated by the
  // trigger on drs_review instead, which is strictly stronger — it catches a
  // queued offline write and a direct SQL insert, neither of which reaches
  // this dispatcher — and which raises a message naming the flag and who can
  // move it. Tagging it here as well would only mean the dispatcher's generic
  // "module_disabled" arrived first and replaced the useful sentence with a
  // useless one. Where a feature's writes already have a database gate, this
  // table stays out of the way.
  [/^\/api\/matches\/([^/]+)\/drs$/,               "POST", drs.record],
  [/^\/api\/admin\/features\/([^/]+)$/,            "POST", features.set],
  // The two levels below the platform switch. NEVER module-gated themselves —
  // a switch you can turn off and then cannot reach is a switch nobody can
  // turn back on.
  [/^\/api\/admin\/modules\/([^/]+)\/grant$/,     "POST", modAdmin.grant],
  [/^\/api\/admin\/modules\/([^/]+)\/suppress$/,  "POST", modAdmin.suppress],
  // Setting a rewards coefficient. Platform-only through the table's own
  // policy, and never module-gated: the algorithm is the platform's and is not
  // a thing a school switches off.
  [/^\/api\/admin\/reward-weights\/([^/]+)$/,   "POST", rewards.set],
  // Putting a fixture on a public screen, and saying how much of a child's
  // name may go on it.
  [/^\/api\/matches\/([^/]+)\/broadcast$/,          "POST", bcast.publish, "broadcast"],
  // Appointing the officials. officiating.assign, which until now had nothing
  // it could be exercised on.
  [/^\/api\/matches\/([^/]+)\/officials$/,         "POST", officials.appoint, "officials"],
  // The register itself: platform- and competition-level, not a school
  // module, so no module gate — the policies on official/official_accreditation
  // decide (officiating.registry.manage).
  [/^\/api\/officials$/,                             "POST", register.add],
  [/^\/api\/officials\/([^/]+)\/accredit$/,          "POST", register.accredit],
  [/^\/api\/officials\/([^/]+)\/retire$/,            "POST", register.retire],
  // Putting a published notice in front of people. Keyed on the notice, so it
  // rides the id-bearing table rather than SCOUT_ROUTES.
  [/^\/api\/notifications\/([^/]+)\/push$/,       "POST", notices.push],
  // Opening a notice: its body (a tiered one's open is logged) and its
  // receipt, as the reader. NOT module-gated: a person's own notices are not
  // a module (modules.mjs).
  [/^\/api\/notifications\/([^/]+)\/read$/,       "POST", receipts.open],
  [/^\/api\/fixtures\/([^/]+)$/,                  "POST", fixtures.amend],
  // A side of the fixture on the public pages (SCRBRD-083). fixture_publish()
  // (db/47) decides who: broadcast.publish at THAT side's school and team.
  // Not module-gated, like the fixture itself: publishing is off by default
  // and taking a side off must never depend on a menu setting.
  [/^\/api\/matches\/([^/]+)\/publication$/,        "GET",  publication.read],
  [/^\/api\/matches\/([^/]+)\/publication$/,        "POST", publication.set],
  // A school's matches on the public home page (SCRBRD-142, db/82):
  // public_listing_set() decides who — broadcast.publish at the school, no
  // team. Not module-gated, as publication is not: taking a school off the
  // front page must never depend on a menu setting.
  [/^\/api\/schools\/([0-9a-f-]{36})\/listing$/,      "GET",  listing.read],
  [/^\/api\/schools\/([0-9a-f-]{36})\/listing$/,      "POST", listing.set],
  // A child's name on the public pages (SCRBRD-083 C1-C5, db/47): the
  // family's consent, the never-public mark, a school's names-off switch per
  // age group. Each door checks its own authority (public-name-api.mjs). Not
  // module-gated: a "no" that a menu setting could hide is not a "no".
  [/^\/api\/players\/([^/]+)\/public-name$/,          "GET",  publicName.read],
  [/^\/api\/players\/([^/]+)\/public-name$/,          "POST", publicName.consent],
  [/^\/api\/players\/([^/]+)\/never-public$/,         "POST", publicName.mark],
  [/^\/api\/players\/([^/]+)\/never-public\/end$/,    "POST", publicName.unmark],
  [/^\/api\/schools\/([0-9a-f-]{36})\/public-names$/, "GET",  publicName.namesOff],
  [/^\/api\/schools\/([0-9a-f-]{36})\/public-names$/, "POST", publicName.setNamesOff],
];

// Routes keyed on a player rather than a match. Same shape, same shim.
/** @type {Route[]} */
const PLAYER_ROUTES = [
  // Which side he is in, from a date. Writes only player.team_code; the
  // membership history is recorded by the trigger on that column.
  [/^\/api\/players\/([^/]+)\/team$/,           "POST", roster.move],
  // The one door back from a NULL date of birth. Refuses whenever born is
  // already set — see dob-capture-api.mjs for why that is the WHERE clause
  // rather than a check here.
  [/^\/api\/players\/([^/]+)\/date-of-birth$/,  "POST", dobCapture.capture],
  // SCRBRD-012. One role at one school for an hour, on the record — see
  // support-access-api.mjs. In this table rather than the fixed one so a
  // retried "begin" with an Idempotency-Key answers from its receipt.
  [/^\/api\/support\/access$/,                    "POST", support.begin],
  [/^\/api\/support\/access\/([^/]+)\/end$/,       "POST", support.end],
  // SCRBRD-034. The school office links a match duty to the fixture-scoped
  // assignment it rests on, and suspends or lifts it with a reason — see
  // duty-authority-api.mjs. NOT module-gated: taking authority away must not
  // depend on a menu setting.
  [/^\/api\/duties\/([^/]+)\/link$/,              "POST", duties.link],
  [/^\/api\/duties\/([^/]+)\/suspend$/,           "POST", duties.suspend],
  [/^\/api\/duties\/([^/]+)\/lift$/,              "POST", duties.lift],
  [/^\/api\/players\/([^/]+)\/emergency-contacts$/, "POST", contacts.add],
  [/^\/api\/emergency-contacts\/([^/]+)\/retire$/,   "POST", contacts.retire],
  [/^\/api\/clearances$/,                           "POST", clearances.record],
  [/^\/api\/clearances\/([^/]+)\/revoke$/,          "POST", clearances.revoke],
  // Honours are awarded and withdrawn, never edited; a cap baseline is where
  // a side's ledger starts. recognition.manage, through the tables' policies.
  [/^\/api\/honours$/,                              "POST", recognition.award],
  [/^\/api\/honours\/([^/]+)\/withdraw$/,           "POST", recognition.withdraw],
  [/^\/api\/honours\/([^/]+)\/public$/,             "POST", recognition.setPublic],
  [/^\/api\/cap-baselines$/,                        "POST", recognition.baseline],
  // The rewards figure. A GET on the id-bearing table, keyed on nothing: the
  // rows are whoever the principal may read, narrowed by ?teamCode.
  [/^\/api\/rewards$/,                              "GET",  rewards.figures],
  // Asking for a role, and answering. /api/onboard and /api/schools carry no
  // principal: a stranger gets an account with nothing in it and a request.
  [/^\/api\/schools$/,                              "GET",  requests.schools],
  // The ways a person signs in (SCRBRD-140, db/81): their own, and the
  // office's claims list and revocations. Every decision is a db/81 function.
  [/^\/api\/auth\/sign-ins$/,                        "POST", signIn.link],
  [/^\/api\/auth\/sign-ins\/([^/]+)\/revoke$/,       "POST", signIn.revokeOwn],
  [/^\/api\/auth\/users\/([^/]+)\/sign-ins$/,        "GET",  signIn.accountSignIns],
  [/^\/api\/auth\/office\/sign-ins\/([^/]+)\/revoke$/, "POST", signIn.revokeOffice],
  // GA-I03 (db/85): every session ends — yours, or, by the office or the
  // owner, an account's. An API route each; no screen calls them yet.
  [/^\/api\/auth\/sign-out-everywhere$/,          "POST", signIn.signOutEverywhere],
  [/^\/api\/auth\/users\/([^/]+)\/disable$/,        "POST", signIn.disable],
  [/^\/api\/auth\/users\/([^/]+)\/enable$/,         "POST", signIn.enable],
  // Account lifecycle slice 2 (db/90): what disabling would cut, before the tap.
  [/^\/api\/auth\/users\/([^/]+)\/preview$/,        "GET",  signIn.preview],
  [/^\/api\/auth\/claims\/([^/]+)\/confirm$/,        "POST", signIn.confirmClaim],
  [/^\/api\/auth\/claims\/([^/]+)\/decline$/,        "POST", signIn.declineClaim],
  [/^\/api\/onboard$/,                              "POST", requests.onboard],
  [/^\/api\/requests$/,                             "POST", requests.request],
  [/^\/api\/requests\/([^/]+)\/withdraw$/,           "POST", requests.withdraw],
  [/^\/api\/requests\/([^/]+)\/decide$/,             "POST", requests.decide],
  // The office opening an account for somebody already on the roster — the
  // push half of onboarding. Authenticated: enrol_person() checks
  // user.role.assign and the granter table under the caller's identity.
  [/^\/api\/users$/,                                "POST", requests.enrol],
  // Ending one role (db/77). role_assignment_end() decides who may, and
  // answers every refusal with a code the route turns into words.
  [/^\/api\/assignments\/([^/]+)\/end$/,           "POST", requests.endAssignment],
  // The newsfeed. Which tier a post needs is decided by its ANCHOR, inside the
  // INSERT policy — see db/12 — so these routes carry no capability checks.
  [/^\/api\/news$/,                                 "POST", news.publish],
  [/^\/api\/news\/([^/]+)\/publish$/,               "POST", news.send],
  [/^\/api\/news\/([^/]+)\/withdraw$/,              "POST", news.withdraw],
  // The public home page (SCRBRD-142 §3, db/83). The three functions decide
  // who: the author asks; a school-wide publisher who is not the author
  // approves; the author or any publisher at the school takes it down.
  [/^\/api\/news\/([^/]+)\/public\/request$/,       "POST", news.public_request],
  [/^\/api\/news\/([^/]+)\/public\/approve$/,       "POST", news.public_approve],
  [/^\/api\/news\/([^/]+)\/public\/withdraw$/,      "POST", news.public_withdraw],
  [/^\/api\/drills$/,                               "POST", kit.drill],
  [/^\/api\/equipment$/,                            "POST", kit.equipment],
  [/^\/api\/equipment\/([^/]+)\/issue$/,             "POST", kit.issue],
  [/^\/api\/equipment-issues\/([^/]+)\/return$/,     "POST", kit.giveBack],
  [/^\/api\/passport\/consent$/,                     "POST", kit.consent],
  [/^\/api\/passport\/consent\/([^/]+)\/withdraw$/,   "POST", kit.withdrawConsent],
  // A high school's own ceiling on an Open-band bowler's overs. Refused
  // outright for anything that is not kind = 'school' — see the trigger.
  [/^\/api\/bowling-ceiling$/,                       "POST", workload.ceiling],
  // A nets or training session's load, as a band (SCRBRD-110 phase 1): the
  // coach for his group, the boy for himself. load_entry's policy and stamp
  // decide everything; the module gate is here and in the stamp.
  [/^\/api\/load-entry$/,                           "POST", load.entry, "workload_monitoring"],
  // Health monitoring's own consent, for one child: his guardian, the office
  // from its forms, or he himself from eighteen. NOT module-gated, as the
  // scouting consent below is not: a withdrawal a school could switch off by
  // hiding a module is not a withdrawal. Where the module is off, the
  // screens (the toggle, the one-time prompt, the eighteen card) simply do
  // not draw — the `consents` read's `module_on` (SCRBRD-110 §9.1, Decided
  // 2), not this route — so no family is asked to answer through the UI;
  // this route still answers a direct POST, and its record counts again the
  // day the school switches the module on.
  [/^\/api\/players\/([^/]+)\/consents\/health$/,    "POST", load.healthConsent],
  // A boy joins the roster one at a time, under the same authority as the
  // bulk CSV import (player.profile.manage).
  [/^\/api\/players$/,                               "POST", rosterAdd.add],
  // A session on the training calendar, under team.manage — the same
  // capability that already keeps the drill library and the kit register.
  // Tagged with the module that owns training_session. It was not, so a
  // school that switched Training off was refused the read of a session it
  // could still schedule — the half-working setting smoke-modules.mjs
  // describes, found by making that walk try every module's write.
  [/^\/api\/training$/,                              "POST", training.schedule, "training"],
  // A competition's tiers, and who sits in which. competition.manage at the
  // organiser, which for a shared league is a platform-wide administrator.
  [/^\/api\/competitions\/([^/]+)\/divisions$/,      "POST", competitions.division],
  [/^\/api\/competition-entrants\/([^/]+)\/division$/, "POST", competitions.place],
  // A competition's playing conditions (SCRBRD-114, db/61): dated versions,
  // each figure with its source, published for matches to come; a match's
  // frozen document and its departures before play. Not module-gated, like
  // the fixture: the pad folds every match by them. Every decision is a
  // db/61 definer function's (playing-conditions-api.mjs).
  [/^\/api\/playing-conditions\/catalogue$/,                   "GET",  playing.catalogue],
  [/^\/api\/competitions\/entered$/,                           "GET",  playing.entered],
  [/^\/api\/competitions\/([^/]+)\/playing-conditions$/,        "GET",  playing.list],
  [/^\/api\/competitions\/([^/]+)\/playing-conditions$/,        "POST", playing.draft],
  [/^\/api\/competitions\/([^/]+)\/playing-conditions\/preview$/, "GET", playing.preview],
  [/^\/api\/condition-sets\/([^/]+)$/,                          "POST", playing.amend],
  [/^\/api\/condition-sets\/([^/]+)\/new-version$/,             "POST", playing.newVersion],
  [/^\/api\/condition-sets\/([^/]+)\/values$/,                  "POST", playing.enter],
  [/^\/api\/condition-sets\/([^/]+)\/values\/clear$/,           "POST", playing.clear],
  [/^\/api\/condition-sets\/([^/]+)\/publish$/,                 "POST", playing.publish],
  [/^\/api\/condition-sets\/([^/]+)\/withdraw$/,                "POST", playing.withdraw],
  [/^\/api\/matches\/([^/]+)\/playing-conditions$/,             "GET",  playing.match],
  [/^\/api\/matches\/([^/]+)\/playing-conditions\/override$/,   "POST", playing.override],
  // The fixture planner, phase 2 (SCRBRD-123, db/67): the inputs read for a
  // competition's manager, versioned drafts the server computes, locks, and
  // publishing through the fixture route's own insert. The ground owner's
  // windows and closures, a pitch on its field, and blackout days. Not
  // module-gated, like the fixture itself. planner-api.mjs.
  [/^\/api\/competitions\/([^/]+)\/planner\/inputs$/,           "GET",  planner.inputs],
  [/^\/api\/competitions\/([^/]+)\/plans$/,                     "GET",  planner.list],
  [/^\/api\/competitions\/([^/]+)\/plans$/,                     "POST", planner.create],
  [/^\/api\/competitions\/([^/]+)\/plans\/([^/]+)$/,            "GET",  planner.get],
  [/^\/api\/competitions\/([^/]+)\/plans\/([^/]+)\/locks$/,     "POST", planner.locks],
  [/^\/api\/competitions\/([^/]+)\/plans\/([^/]+)\/publish$/,   "POST", planner.publish],
  [/^\/api\/competitions\/([^/]+)\/blackouts$/,                 "GET",  planner.blackouts],
  [/^\/api\/competitions\/([^/]+)\/blackouts$/,                 "POST", planner.blackoutAdd],
  [/^\/api\/competition-blackouts\/([^/]+)\/remove$/,           "POST", planner.blackoutRemove],
  [/^\/api\/grounds\/([^/]+)\/windows$/,                        "GET",  planner.windows],
  [/^\/api\/grounds\/([^/]+)\/windows$/,                        "POST", planner.windowAdd],
  [/^\/api\/ground-windows\/([^/]+)\/remove$/,                  "POST", planner.windowRemove],
  [/^\/api\/grounds\/([^/]+)\/closures$/,                       "GET",  planner.closures],
  [/^\/api\/grounds\/([^/]+)\/closures$/,                       "POST", planner.closureAdd],
  [/^\/api\/ground-closures\/([^/]+)\/remove$/,                 "POST", planner.closureRemove],
  // A ground made (PILOT_LOAD.md gap 4): facility.manage at the school, the
  // table's own insert policy. Read back with GET /api/read/grounds.
  [/^\/api\/grounds$/,                                         "POST", planner.groundCreate],
  [/^\/api\/grounds\/([^/]+)\/parent$/,                         "POST", planner.parent],
  [/^\/api\/grounds\/([^/]+)\/ends$/,                           "POST", planner.ends],
  // Making a league (SCRBRD-123, db/67 §8a–8c): the competition, its
  // entrants invited by the organiser and answered by the school, and its
  // first conditions from a starting point. league-api.mjs.
  [/^\/api\/competitions$/,                                     "POST", league.create],
  [/^\/api\/competitions\/([^/]+)$/,                            "POST", league.amend],
  [/^\/api\/competitions\/([^/]+)\/entrants$/,                  "GET",  league.entrants],
  [/^\/api\/competitions\/([^/]+)\/entrants$/,                  "POST", league.invite],
  [/^\/api\/competitions\/([^/]+)\/schools$/,                   "GET",  league.schools],
  [/^\/api\/competition-invitations$/,                          "GET",  league.invitations],
  [/^\/api\/competition-entrants\/([^/]+)\/accept$/,            "POST", league.accept],
  [/^\/api\/competition-entrants\/([^/]+)\/decline$/,           "POST", league.decline],
  [/^\/api\/competitions\/([^/]+)\/playing-conditions\/start$/, "POST", league.startConditions],
  // ── SCRBRD-114 phase 3a (db/69): match results and the league table ──
  // A result read from the log as its reader may read it; a decision taken
  // off the field (competition.manage at the organiser, a friendly's
  // fixture.update); the table computed on every read; points adjustments
  // and a played match's table figures (competition.conditions.manage). Not
  // module-gated, like the fixture: every decision is a db/69 definer
  // function's (results-api.mjs).
  [/^\/api\/matches\/([^/]+)\/result$/,                        "GET",  results.result],
  [/^\/api\/matches\/([^/]+)\/result-decision$/,               "POST", results.decide],
  [/^\/api\/result-decisions\/([^/]+)\/withdraw$/,             "POST", results.withdrawDecision],
  [/^\/api\/competitions\/([^/]+)\/standings$/,                "GET",  results.standings],
  [/^\/api\/competitions\/([^/]+)\/adjustments$/,              "POST", results.adjust],
  [/^\/api\/points-adjustments\/([^/]+)\/withdraw$/,           "POST", results.withdrawAdjustment],
  [/^\/api\/matches\/([^/]+)\/playing-conditions\/refix-table$/, "POST", results.refixTable],
  // ── SCRBRD-130 R3 (db/74): venue par, at a ground and at a match ──
  [/^\/api\/grounds\/([^/]+)\/venue-par$/,                     "GET",  rain.groundVenuePar],
  [/^\/api\/matches\/([^/]+)\/venue-par$/,                     "GET",  rain.matchVenuePar],
  // ── SCRBRD-130 R2 (db/75): the DLS proposal; the operator's table routes ──
  [/^\/api\/matches\/([^/]+)\/dls$/,                           "GET",  rain.matchDls],
  [/^\/api\/matches\/([^/]+)\/par$/,                           "GET",  rain.matchPar],   // SCRBRD-133 G2
  [/^\/api\/admin\/dls-tables$/,                               "GET",  rain.dlsTables],
  [/^\/api\/admin\/dls-tables$/,                               "POST", rain.dlsLoad],
  [/^\/api\/admin\/dls-tables\/([^/]+)\/publish$/,             "POST", rain.dlsPublish],
  [/^\/api\/admin\/dls-tables\/([^/]+)\/withdraw$/,            "POST", rain.dlsWithdraw],
  // ── end SCRBRD-114 phase 3a ──
  // ── SCRBRD-114 phase 3c (db/72): knockout progression ──
  // Where each knockout side came from, and the organiser clearing a flag a
  // corrected result raised (competition.manage at the organiser).
  [/^\/api\/competitions\/([^/]+)\/progression$/,             "GET",  results.progression],
  [/^\/api\/matches\/([^/]+)\/progression\/clear$/,          "POST", results.clearProgression],
  // ── end SCRBRD-114 phase 3c ──
  // Importing a paper scorebook (SCRBRD-120, db/63): photos of the book, a
  // card typed and ticked beside them, a second person's confirmation, and
  // then three events per innings in the log. NOT tagged with the module,
  // though it is one (off until granted, D13): every definer function behind
  // these asks feature_enabled() for the fixture's own school, and the two
  // reads ask it too — strictly stronger than this table's per-caller gate,
  // which would refuse a director of sport who is also a parent at another
  // school (the DRS reasoning below). The photos' own two routes and the
  // purge are dispatched below the table, because a photo is not JSON
  // (scorebook-api.mjs scorebookFileRoutes).
  [/^\/api\/matches\/([^/]+)\/scorebook$/,          "POST", scorebook.open],
  [/^\/api\/matches\/([^/]+)\/scorebook$/,          "GET",  scorebook.list],
  [/^\/api\/scorebook\/([0-9a-f-]{36})$/,           "GET",  scorebook.get],
  [/^\/api\/scorebook\/([0-9a-f-]{36})\/save$/,     "POST", scorebook.save],
  [/^\/api\/scorebook\/([0-9a-f-]{36})\/submit$/,   "POST", scorebook.submit],
  [/^\/api\/scorebook\/([0-9a-f-]{36})\/return$/,   "POST", scorebook.return],
  [/^\/api\/scorebook\/([0-9a-f-]{36})\/confirm$/,  "POST", scorebook.confirm],
  // Not gated: a school that switched the module off can still give up an
  // import, and its photos go at once.
  [/^\/api\/scorebook\/([0-9a-f-]{36})\/abandon$/,  "POST", scorebook.abandon],
  // The reader (SCRBRD-120 phase 4, db/66): the page photos to a vision
  // model to pre-fill the card. Its own switch, `scorebook_reader`, is asked
  // in the database per school (a platform grant for the school, D8); not
  // tagged here for the module's reason above.
  [/^\/api\/scorebook\/([0-9a-f-]{36})\/read$/,     "POST", scorebook.read],
  // Skills owns player_skill and its read; the write was untagged. Same
  // finding as /api/training above.
  [/^\/api\/players\/([^/]+)\/assessment$/,     "POST", assess.record, "skills"],
  [/^\/api\/players\/([^/]+)\/access-request$/, "POST", access.ask],
  [/^\/api\/access-requests\/([^/]+)\/decide$/, "POST", access.decide],
  [/^\/api\/players\/([^/]+)\/notes$/,          "POST", notes.write],
  // A disciplinary matter (SCRBRD-053). No module tag: a school cannot switch
  // off a safeguarding record the way it switches off Analytics, and the
  // module gate can only ever refuse — so tagging this would be a setting
  // that makes an umpire unable to file an incident.
  [/^\/api\/players\/([^/]+)\/discipline$/,     "POST", conduct.file],
  // Scouting: a guardian's own decision about their own child, and nobody
  // else's — no administrative override exists in scouting_consent_set().
  // NOT gated by the scouting module, deliberately, though everything else
  // about scouting is. This route is where a guardian GRANTS AND WITHDRAWS
  // consent for their own child, and a withdrawal that a school could disable
  // by switching off a module is not a withdrawal. Consent is the parent's,
  // not the product's; the module decides whether scouts may look, never
  // whether a family may say no.
  [/^\/api\/players\/([^/]+)\/scouting-consent$/,  "POST", scouting.consent],
  // The guardian link, which had no route at all until now.
  [/^\/api\/players\/([^/]+)\/guardians$/,             "POST", guard.establish],
  [/^\/api\/players\/([^/]+)\/guardians\/verify$/,     "POST", guard.verify],
  [/^\/api\/players\/([^/]+)\/guardians\/revoke$/,     "POST", guard.revoke],
  [/^\/api\/players\/([^/]+)\/guardians\/consent$/,    "POST", guard.consent],
  [/^\/api\/players\/([^/]+)\/guardians\/withdraw$/,   "POST", guard.withdraw],
  [/^\/api\/notes\/([^/]+)$/,                    "PATCH", notes.revise],
  [/^\/api\/discipline\/([^/]+)$/,               "PATCH", conduct.progress],
  [/^\/api\/amendments\/([^/]+)\/decide$/,       "POST", amend.decide],
  [/^\/api\/quarantine\/([^/]+)\/resolve$/,       "POST", quarantine.resolve],
  // GA-I36 N1: every match with a correction open that the reader may see (O7).
  [/^\/api\/corrections$/,                       "GET",  corrections.open],
];

// Scouting: keyed on the scout, not on a match or a child. Registration takes
// no id at all — it always means "me" — so its capture group is simply
// absent; the dispatcher's params.id comes back undefined and the handler
// never looks at it.
/**
 * Safeguarding (db/57, docs/design/SAFEGUARDING_DSO.md). Every route calls
 * one SECURITY DEFINER function under the caller's identity; the function
 * decides who may, and logs every read of the record under the institution
 * that holds it. NEVER module-gated: a school cannot switch off a child's way
 * to tell somebody. Raising takes an Idempotency-Key like any write, so a
 * retry on a bad connection raises once.
 * @type {Route[]}
 */
const SAFEGUARDING_ROUTES = [
  [/^\/api\/safeguarding\/contacts$/,                    "GET",  safeguarding.contacts],
  [/^\/api\/safeguarding\/concerns$/,                    "POST", safeguarding.raise],
  [/^\/api\/safeguarding\/receipts$/,                    "GET",  safeguarding.receipts],
  [/^\/api\/safeguarding\/inbox$/,                       "GET",  safeguarding.inbox],
  [/^\/api\/safeguarding\/concerns\/([^/]+)$/,           "GET",  safeguarding.open],
  [/^\/api\/safeguarding\/concerns\/([^/]+)\/family$/,   "GET",  safeguarding.family],
  [/^\/api\/safeguarding\/concerns\/([^/]+)\/notes$/,    "POST", safeguarding.note],
  [/^\/api\/safeguarding\/concerns\/([^/]+)\/assign$/,   "POST", safeguarding.assign],
  [/^\/api\/safeguarding\/concerns\/([^/]+)\/shares$/,   "POST", safeguarding.share],
  [/^\/api\/safeguarding\/concerns\/([^/]+)\/close$/,    "POST", safeguarding.close],
  [/^\/api\/safeguarding\/shares$/,                      "GET",  safeguarding.shares],
  [/^\/api\/safeguarding\/shares\/([^/]+)$/,             "GET",  safeguarding.shareOpen],
  [/^\/api\/safeguarding\/shares\/([^/]+)\/revoke$/,     "POST", safeguarding.shareRevoke],
  [/^\/api\/safeguarding\/appointments\/([^/]+)\/end$/,  "POST", safeguarding.endAppointment],
];

// ── SCRBRD-124 phase 1: parent lift clubs (db/70) ─────────────────────
/**
 * Every route calls one SECURITY DEFINER function under the caller's identity
 * (services/api/write/lift-api.mjs); db/70 decides who and logs every read of
 * a name or a number. Tagged `lift_club` where the route makes or reads an
 * arrangement; NOT tagged where it ends one — a family's "no", a cancel, a
 * declaration or the policy withdrawn — because switching the module off must
 * never stop anybody stopping. Ids are UUIDs in the pattern, so the fixed
 * paths (/policy, /declaration) cannot be read as an id.
 * @type {Route[]}
 */
const LIFT_ROUTES = [
  [/^\/api\/lifts\/standing$/,                          "GET",  lifts.standing, "lift_club"],
  [/^\/api\/lifts\/policy$/,                            "GET",  lifts.policy],
  [/^\/api\/lifts\/policy$/,                            "POST", lifts.signPolicy, "lift_club"],
  [/^\/api\/lifts\/policy\/withdraw$/,                  "POST", lifts.withdrawPolicy],
  [/^\/api\/lifts\/declaration$/,                       "POST", lifts.declare, "lift_club"],
  [/^\/api\/lifts\/declaration\/withdraw$/,             "POST", lifts.withdrawDeclaration],
  [/^\/api\/matches\/([0-9a-f-]{36})\/lifts$/,          "GET",  lifts.offers, "lift_club"],
  [/^\/api\/matches\/([0-9a-f-]{36})\/lifts$/,          "POST", lifts.offer, "lift_club"],
  [/^\/api\/matches\/([0-9a-f-]{36})\/lifts\/summary$/, "GET",  lifts.summary, "lift_club"],
  [/^\/api\/lifts\/([0-9a-f-]{36})$/,                   "POST", lifts.update, "lift_club"],
  [/^\/api\/lifts\/([0-9a-f-]{36})\/reaffirm$/,         "POST", lifts.reaffirm, "lift_club"],
  [/^\/api\/lifts\/([0-9a-f-]{36})\/close$/,            "POST", lifts.close, "lift_club"],
  [/^\/api\/lifts\/([0-9a-f-]{36})\/cancel$/,           "POST", lifts.cancel],
  [/^\/api\/lifts\/([0-9a-f-]{36})\/passengers$/,       "GET",  lifts.passengers, "lift_club"],
  [/^\/api\/lifts\/([0-9a-f-]{36})\/contacts$/,         "GET",  lifts.contacts, "lift_club"],
  [/^\/api\/lifts\/([0-9a-f-]{36})\/seats$/,            "POST", lifts.request, "lift_club"],
  [/^\/api\/lifts\/([0-9a-f-]{36})\/accept$/,           "POST", lifts.accept, "lift_club"],
  [/^\/api\/lift-seats\/([0-9a-f-]{36})\/decline$/,     "POST", lifts.decline, "lift_club"],
  [/^\/api\/lift-seats\/([0-9a-f-]{36})\/withdraw$/,    "POST", lifts.withdraw],
  [/^\/api\/lift-seats\/([0-9a-f-]{36})\/reconfirm$/,   "POST", lifts.reconfirm, "lift_club"],
  // Phase 2, the day (db/76): never module-gated — a lift on the road is
  // seen through, and the platform's watch belongs to no school.
  [/^\/api\/lifts\/([0-9a-f-]{36})\/mark$/,             "POST", lifts.mark],
  [/^\/api\/lift-seats\/([0-9a-f-]{36})\/mark$/,        "POST", lifts.seatMark],
  [/^\/api\/lift-seats\/([0-9a-f-]{36})\/receive$/,     "POST", lifts.receive],
  [/^\/api\/lift-seats\/([0-9a-f-]{36})\/resolve$/,     "POST", lifts.resolve],
  [/^\/api\/matches\/([0-9a-f-]{36})\/lifts\/day$/,     "GET",  lifts.day],
  [/^\/api\/matches\/([0-9a-f-]{36})\/lifts\/expected$/, "GET", lifts.expected],
  [/^\/api\/lifts\/exceptions$/,                      "GET",  lifts.exceptions],
  [/^\/api\/lifts\/mine$/,                            "GET",  lifts.mine],
  // GA-I20 A1 (N3): her own open lifts' requests, counted; no name. Gated:
  // it reads an arrangement, and a module switched off is no row, not a fault.
  [/^\/api\/lifts\/requests-mine$/,                   "GET",  lifts.requestsMine, "lift_club"],
  [/^\/api\/lifts\/watch$/,                           "POST", lifts.watch],
  [/^\/api\/lifts\/purge$/,                           "GET",  lifts.purgeDue],
  [/^\/api\/lifts\/([0-9a-f-]{36})\/purge$/,            "POST", lifts.purge],
  [/^\/api\/lift-declarations\/([0-9a-f-]{36})\/purge$/, "POST", lifts.purgeDeclaration],
];
// ── end SCRBRD-124 ──

/** @type {Route[]} */
const SCOUT_ROUTES = [
  [/^\/api\/scouts\/accreditation$/,                      "POST", scouting.registerAccreditation, "scouting"],
  [/^\/api\/scouts\/([^/]+)\/accreditation\/decide$/,   "POST", scouting.decideAccreditation, "scouting"],
  // Commercial. Neither takes an id: a sponsor is created under a school named
  // in the body, and a placement under a sponsor named in the body, so both
  // capture groups are absent exactly as registration's is above.
  // Bulk import. NOT module-gated: getting four hundred boys into the system
  // is how a school starts, and a school cannot switch off the thing it needs
  // before it has any data to switch anything off with.
  [/^\/api\/import\/([^/]+)$/,                             "POST", bulk.run],
  [/^\/api\/vehicles$/,                                    "POST", trips.vehicle, "logistics"],
  // A person's own phone. No id: it always means "me", so the capture group
  // is absent exactly as scout registration's is. NOT module-gated — a
  // notice about a child in hospital is not a module somebody may switch off.
  [/^\/api\/devices$/,                                     "POST", devices.register],
  [/^\/api\/devices\/retire$/,                             "POST", devices.retire],
  // Publishing a notice, which until now had a policy and no route at all.
  [/^\/api\/notifications$/,                               "POST", notices.publish],
  // Every notice in the reader's list, marked read: his own receipts only.
  [/^\/api\/notifications\/read-all$/,                      "POST", receipts.readAll],
  // The fixture itself. NOT module-gated: arranging a match is the product,
  // not a module somebody may switch off — and the sport it is in is gated in
  // the database, which catches a seed and an import too.
  [/^\/api\/fixtures$/,                                    "POST", fixtures.create],
  [/^\/api\/sponsors$/,                                    "POST", sponsors.create, "sponsors"],
  [/^\/api\/sponsorships$/,                                "POST", sponsors.place,  "sponsors"],
];

/**
 * Is this module on for the caller?
 *
 * Asked under the caller's own identity, through the same SECURITY DEFINER
 * function the read path uses, so the write gate and the read gate can never
 * disagree about a module. An unauthenticated caller gets false — but that is
 * not what refuses them: the handler's own authorization does, immediately
 * afterwards and for the right reason. This only ever narrows.
 * @param {string | undefined} bearer @param {string} key
 */
async function moduleOn(bearer, key) {
  try {
    return await runAsPrincipal(pool, SECRET, bearer, async (client) => {
      const { rows } = await client.query(`select my_feature_enabled($1) as on`, [key]);
      return rows[0]?.on === true;
    });
  } catch {
    // A principal that cannot be established is not a switched-off module.
    // Returning false here would answer "module_disabled" to somebody whose
    // real problem is an expired token, and send them to a school
    // administrator to fix a sign-in.
    return true;
  }
}

/*
 * THE CLIENT, FROM THE SAME PROCESS — optional, and off unless SERVE_CLIENT
 * names a directory.
 *
 * One origin is the simplest correct deployment: no CORS, no second host, no
 * build-time API address to get wrong. Firebase Hosting achieves the same
 * thing with a rewrite (firebase.json); this is the version for a single
 * container, and the two are alternatives rather than layers.
 *
 * /api is matched BEFORE any of this, so no file can ever shadow a route.
 */
const CLIENT_DIR = process.env.SERVE_CLIENT
  ? resolve(process.env.SERVE_CLIENT)
  : null;
/** @type {Record<string, string>} */
const MEDIA = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".ico": "image/x-icon", ".webp": "image/webp", ".woff2": "font/woff2", ".map": "application/json",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};

/** The paths the public home page answers (firebase.json rewrites the same two). */
const HOME_PATHS = new Set(["/", "/privacy", "/privacy/"]);

/**
 * Serve one file out of CLIENT_DIR, or the app's index for a route the client
 * owns. Returns true when it answered.
 *
 * The traversal check is the load-bearing line. A request for
 * `/../../etc/passwd` resolves OUTSIDE the directory, and a static server that
 * only string-matches the prefix will happily read it — so the resolved path
 * is compared against the directory plus a separator, which "/srv/dist-evil"
 * cannot satisfy for "/srv/dist". Anything outside is a 404, not a 403: a
 * different answer for a file that exists is itself a disclosure.
 * @param {IncomingMessage} req @param {ServerResponse} res @param {string} path
 */
async function serveClient(req, res, path) {
  if (!CLIENT_DIR || (req.method !== "GET" && req.method !== "HEAD")) return false;
  const wanted = resolve(join(CLIENT_DIR, decodeURIComponent(path)));
  const inside = wanted === CLIENT_DIR || wanted.startsWith(CLIENT_DIR + sep);
  let file = inside ? wanted : null;
  // The public home page (SCRBRD-142 §6.2): / and /privacy are home.html, the
  // signed-out page with no app in it; the app is at /app (and every other
  // client route), as before. A build without home.html falls through to the
  // app's index rather than to nothing, so / is never a blank page.
  if (HOME_PATHS.has(path) && (await stat(join(CLIENT_DIR, "home.html")).catch(() => null))) {
    file = join(CLIENT_DIR, "home.html");
  } else if (file) {
    const found = await stat(file).then((st) => (st.isDirectory() ? null : st)).catch(() => null);
    // A path the client routes rather than a file on disk: the app's own
    // index answers it and React reads the address. Never for /api, which
    // returned above, so a mistyped route cannot arrive here as HTML.
    if (!found) file = join(CLIENT_DIR, "index.html");
  } else {
    file = join(CLIENT_DIR, "index.html");
  }
  const body = await readFile(file).catch(() => null);
  if (!body) return false;
  const type = MEDIA[extname(file).toLowerCase()] ?? "application/octet-stream";
  // The index must never be cached: it names the hashed asset files, and a
  // stale one points a returning browser at bundles that no longer exist.
  const cache = file.endsWith(".html")
    ? "no-cache"
    : (path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

/**
 * The five handlers a pad resume credential reaches (pad-resume.mjs
 * PAD_ROUTES names them). Each runs as who(req): the principal built here.
 * @type {Record<string, IdHandler>}
 */
const PAD_HANDLERS = {
  heartbeat: session.heartbeat, claim: session.claim,
  append: events.append, list: events.list, toss: toss.read,
};

/**
 * A request signed with a resume credential, answered here and nowhere else.
 *
 * FIRST the route: a credential is good for five, on its own match, and any
 * other path — every read, every write, /api/session, /api/health, a static
 * file — is 403 pad_scope before its body is read or a credential looked up.
 * Then the proof (padPrincipal: the credential, the signature, this request,
 * now, its match, once). Then the handler, with the Authorization header
 * taken away, so a handler that reached for it instead of who(req) would
 * find no identity at all rather than a credential it does not understand.
 * No module gate (none of the five has one) and no Idempotency-Key receipts
 * (the events carry their own keys; the heartbeat and claim are not retried
 * blind).
 * @param {IncomingMessage} req @param {ServerResponse} res
 */
async function servePad(req, res) {
  const target = /** @type {string} */ (req.url);
  const url = new URL(target, `http://${req.headers.host}`);
  const route = padRoute(req.method, url.pathname);
  if (!route) return json(res, 403, { error: "pad_scope" });
  try {
    const raw = req.method === "POST" ? await readRaw(req) : Buffer.alloc(0);
    const principal = await padPrincipal({
      pool, secret: SECRET, authorization: String(req.headers.authorization), method: String(req.method),
      target, rawBody: raw, matchId: route.matchId });
    const out = shim(res);
    await PAD_HANDLERS[route.name]({
      params: { id: route.matchId }, query: Object.fromEntries(url.searchParams), body: parseJson(raw),
      headers: { ...req.headers, authorization: undefined }, principal }, out);
    out.flush();
  } catch (/** @type {any} */ err) {
    const r = padRefusal(err);
    if (r.status >= 500) console.error(`${req.method} ${url.pathname} (pad) →`, err.code || "", err.message);
    json(res, r.status, r.body);
  }
}

/**
 * The write routes that keep their own once-only rule and stand outside the
 * Idempotency-Key unit (see the dispatcher): ball events, keyed per event in
 * the batch; and the push fan-out, a delivery row per device, sent once.
 * @type {Set<unknown>}
 */
const OWN_DEDUP = new Set([events.append, notices.push]);

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") return json(res, 204, {});

  // The signed-out pages, before anything reads a credential: they run as
  // nobody whatever the request carries (public/public-api.mjs).
  if (await publicSite.handle(req, res)) return;

  // A resume credential goes no further than servePad(): see there.
  if (isPadAuthorization(req.headers.authorization)) return servePad(req, res);

  // An http.Server request always carries its url; the type allows undefined
  // only for an IncomingMessage read on the client side of a connection.
  const url = new URL(/** @type {string} */ (req.url), `http://${req.headers.host}`);
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
      public: PUBLIC_ON ? (publicSite.listening() ? "on" : "on_without_notifications") : "off",
      // Where scorebook photos go (SCRBRD-120): supabase | local | unconfigured.
      pages: pageStore.kind,
      // The scorebook reader's provider (SCRBRD-120 phase 4): anthropic, a
      // recorded replay (development only), or none. Whether a school may use
      // it is its grant, in the database.
      reader: readerConfig().mode,
      // The weather hint (Practice Match): configured | unconfigured. Never the key.
      weather: weather.configured() ? "configured" : "unconfigured",
      // The commit this process was built from (RENDER_GIT_COMMIT, else
      // GIT_COMMIT), or null: how a running revision is tied to a reviewed
      // commit (DEPLOYING.md, "The deployed revision"). A commit id only.
      revision: revisionFromEnv(process.env),
    });
  }

  try {
    if (req.method === "GET" && path === "/api/session")
      return json(res, 200, await sessionProfile(pool, SECRET, req.headers.authorization));

    // The weather hint: any enrolled person, 30 a minute each; no-store,
    // because it is Google's and briefly true (weather/weather-api.mjs).
    if (req.method === "GET" && path === "/api/weather/hint") {
      const r = await weather.hint({ query: Object.fromEntries(url.searchParams), authorization: req.headers.authorization });
      res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...(r.headers ?? {}) });
      res.end(JSON.stringify(r.body));
      return;
    }

    // A file, from the same read. Every guarantee — row-level security, the
    // masking views, the module gate, the access_log entry — comes from
    // readResource() inside exportResource(); this only sets the headers.
    // The template a school fills in, given rather than documented: a school
    // told to send "full_name, team_code, born" will send "Name, Team, DOB".
    {
      const m = req.method === "GET" && /^\/api\/import\/([^/]+)\/template$/.exec(path);
      // The RAW response, not the JSON shim: these two write their own
      // content-type and content-disposition and end with bytes. Handed the
      // shim they would throw on writeHead, which is how this was found.
      if (m) return bulk.template({ params: { id: m[1] } }, rawRes(res));
    }

    // A scorebook page's photo (SCRBRD-120): up, as its own bytes (never
    // JSON, and larger than any JSON body), and down, proxied — no URL to a
    // photo ever leaves this process; and off the import (DELETE), because
    // the store's object goes with the row. The module is the definer functions'
    // to ask, per school, as for the import's other routes; they decide who.
    // The purge is the platform's (scorebook_import_purge_due() names nothing
    // due to anybody else): photos go on the clock, switch or none.
    {
      const up = req.method === "POST" && /^\/api\/scorebook\/([0-9a-f-]{36})\/pages$/.exec(path);
      const down = req.method === "GET" && /^\/api\/scorebook\/([0-9a-f-]{36})\/pages\/([1-9]\d?)$/.exec(path);
      const gone = req.method === "DELETE" && /^\/api\/scorebook\/([0-9a-f-]{36})\/pages\/([1-9]\d?)$/.exec(path);
      if (up) {
        // No token, no 8 MB read: refuse before the body is taken.
        if (!req.headers.authorization) return rawRes(res).status(401).json({ error: "missing_token" });
        const bytes = await readRaw(req, PAGE_MAX_BYTES + 1);
        return scorebookFiles.upload({ id: up[1], bytes, authorization: req.headers.authorization }, rawRes(res));
      }
      if (down) return scorebookFiles.read({ id: down[1], pageNo: Number(down[2]), authorization: req.headers.authorization }, rawRes(res));
      if (gone) return scorebookFiles.remove({ id: gone[1], pageNo: Number(gone[2]), authorization: req.headers.authorization }, rawRes(res));
      if (req.method === "POST" && path === "/api/scorebook/purge") {
        return scorebookFiles.purge({ authorization: req.headers.authorization }, rawRes(res));
      }
    }

    if (req.method === "GET" && path.startsWith("/api/export/")) {
      return exporter({
        params: { resource: decodeURIComponent(path.slice("/api/export/".length)) },
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
      }, rawRes(res));
    }

    if (req.method === "GET" && path.startsWith("/api/read/")) {
      const shimmed = shim(res);
      await read({
        params: { resource: decodeURIComponent(path.slice("/api/read/".length)) },
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
      }, shimmed);
      shimmed.flush();
      return;
    }

    for (const [pattern, method, handler, module] of [...MATCH_ROUTES, ...PLAYER_ROUTES, ...SCOUT_ROUTES, ...SAFEGUARDING_ROUTES, ...LIFT_ROUTES]) {
      const m = req.method === method && pattern.exec(path);
      if (!m) continue;
      // The write side of the module gate, in the one place every write route
      // is dispatched.
      //
      // The read path closes the door on the way out; this closes it on the
      // way in. Without it a school that switched off Officials would stop
      // being able to READ appointments while still being able to make them,
      // which is a setting that half works — the worst kind, because the half
      // that works is the half nobody checks.
      //
      // A refusal only. my_feature_enabled() resolves the caller's own
      // schools, and the handler's own authorization runs afterwards exactly
      // as before: nothing here lets anybody write anything they could not
      // already write.
      if (module && !(await moduleOn(req.headers?.authorization, module))) {
        return json(res, 403, { error: "module_disabled", module });
      }
      const body = (req.method === "POST" || req.method === "PATCH") ? await readJson(req) : {};
      // A second capture group (/competitions/:id/plans/:planId, SCRBRD-123)
      // is `sub`; every other route has one group, or none.
      const request = { params: { id: m[1], ...(m[2] !== undefined ? { sub: m[2] } : {}) },
                        query: Object.fromEntries(url.searchParams), body, headers: req.headers };

      // THE ANSWER LEAVES AFTER THE HANDLER RESOLVES — see shim(). For a
      // write, that is after withPrincipal() has committed, so a 200 on the
      // wire means a row in the database, and a client that reads the moment
      // it hears back finds what it was told about.
      const out = shim(res);

      // A RETRY WRITES ONCE. A write that carries an Idempotency-Key header
      // is answered from its receipt (db/15_request_replay.sql) when the same
      // person sends the same request with the same key again, and the
      // handler does not run. Done here, in the one place every write is
      // dispatched, rather than in each handler.
      //
      // ONE TRANSACTION, KEY TO RECEIPT (GA-I01, write/replay.mjs): the key is
      // claimed under a lock, so a second copy waits for the first and then
      // replays it; the handler's own writes join that transaction; the
      // receipt is written beside them and both commit together, before the
      // answer leaves. A changed body under a used key is refused (422), not
      // answered from the first. Only an answer the handler stood behind
      // (not a 5xx) is kept; a 5xx keeps nothing, rows included, and the
      // retry runs afresh. All under the person's own session — the table's
      // policy lets nobody read or write another's receipts.
      //
      // Two routes stand aside, each because it already writes once on its
      // own and must not run inside one long transaction: ball events (a key
      // per event inside the batch, db/36 — the scoring append path is not
      // this layer's) and the push fan-out (a delivery row per device that
      // is never sent twice, written as each recipient, with the network in
      // between). With a key they run exactly as without one.
      const idem = (req.method === "POST" || req.method === "PATCH") ? String(req.headers["idempotency-key"] ?? "").trim() : "";
      const keyed = Boolean(idem && req.headers.authorization) && !OWN_DEDUP.has(handler);
      if (keyed) {
        const route = `${req.method} ${pattern.source.replace(/\\\//g, "/").replace(/\(\[\^\/\]\+\)/g, ":id").replace(/[\^$]/g, "")}${m[1] ? ` ${m[1]}` : ""}${m[2] ? ` ${m[2]}` : ""}`;
        const outcome = await keyedWrite({
          pool, secret: SECRET, bearer: /** @type {string} */ (req.headers.authorization), key: idem, route,
          fp: fingerprint({ route, query: request.query, body }),
          run: async () => { await handler(request, out); return out._pending; },
        });
        if (outcome.kind === "ran") return void (out.flush() ?? json(res, 500, { error: "no_answer" }));
        // Replayed or refused: the handler did not run, or its answer was not
        // kept; either way, what goes back is the receipt's or the refusal.
        out._pending = null;
        if (outcome.kind === "replayed") res.setHeader("idempotent-replayed", "true");
        return json(res, outcome.answer.status, outcome.answer.body);
      }

      await handler(request, out);
      out.flush();
      return;
    }

    const exact = EXACT[`${req.method} ${path}`];
    // The request is passed as well as the body: /api/auth/invite is an
    // AUTHENTICATED route and needs the caller's identity to check that they
    // may issue a code for the address they named.
    if (exact) return json(res, 200, await exact(await readJson(req), req));

    // Only now, after every route has had its turn: the client, if this
    // process was asked to serve it. An /api path that reached here is a
    // genuine 404 and stays one.
    if (!path.startsWith("/api/") && await serveClient(req, res, path)) return;

    return json(res, 404, { error: "not_found" });
  } catch (/** @type {any} */ err) {   // CaughtError in api-types.mjs
    // A bare SQLSTATE in a response is unhelpful and a stack trace in one is
    // unsafe; the detail goes to the log, the code goes to the client.
    if (!err.status) console.error(`${req.method} ${path} →`, err.code || "", err.message, err.detail || "");
    return json(res, err.status || 500, { error: err.code || err.message || "internal_error" });
  }
});

await assertRlsApplies();
await assertSchemaCurrent();

server.listen(PORT, () => {
  console.log(`SCRBRD API on http://localhost:${PORT}`);
  console.log(`  db:   ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")} (row-level security applies)`);
  console.log(`  ai:   ${aiConfigured() ? "configured" : "NO CREDENTIALS — Stats-Magic and commentary return null"}`);
  console.log(`  scorebook reader: ${readerConfig().mode}${readerConfig().mode === "replay" ? " (a recorded answer, never a real read)" : ""}`);
  console.log(`  weather hint: ${weather.configured() ? "configured" : "unconfigured (GOOGLE_WEATHER_API_KEY unset: 503, the scorer picks)"}`);
  if (CLIENT_DIR) console.log(`  web:  serving the client from ${CLIENT_DIR}`);
  if (!process.env.SESSION_SECRET) console.log("  auth: EPHEMERAL dev secret — tokens die on restart");
  if (firebase.test) console.log("  auth: FIREBASE TEST KEYS — Google sign-in verifies the walk's own key, for a test project only");
  if (DEV && process.env.ALLOW_DEV_LOGIN === "1") console.log("  auth: DEV LOGIN ENABLED — /api/auth/dev-login mints tokens without a code");
  console.log(`  public pages: ${PUBLIC_ON ? "ON (PUBLIC_PAGES=on)" : "off (set PUBLIC_PAGES=on once the information officer has confirmed PUBLIC_DATA.md)"}`);
  if (PUBLIC_ON && !process.env.PUBLIC_PSEUDONYM_SECRET) console.log("  public: EPHEMERAL dev pseudonym secret — pseudonyms change on restart");
});

export { server, pool };
