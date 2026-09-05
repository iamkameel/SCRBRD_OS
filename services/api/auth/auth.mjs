/**
 * SCRBRD — Auth & request context
 * Framework-agnostic core (no external deps; HMAC-SHA256 via node:crypto).
 *
 * Job: turn an authenticated request into the two Postgres session variables
 * the database reads — app.user_id and app.device_id — and nothing else.
 *
 * WHY ONLY TWO
 * ────────────
 * This module used to mint a token carrying role and school, and set six
 * app.* variables: role, school_id, player_id, child_ids, teams, user_id.
 * Every one of those except user_id was a fact the session asserted about
 * itself, and every policy that read one was trusting the client's own
 * account of its authority.
 *
 * ADR 0001 moved authority to role_assignment rows the database looks up for
 * app_user_id(). So the token no longer says what you are, only WHO you are.
 * A person's roles, schools, teams and children are resolved inside app_can()
 * at decision time, which also means a revoked assignment takes effect on the
 * next query rather than at the next token refresh — the property that
 * matters on a platform holding minors' records.
 *
 * Three hard rules encoded here:
 *
 *   1. TRUST BOUNDARY — identity comes from a SIGNED token minted after a DB
 *      check at login, NEVER from a request header or the client.
 *
 *   2. THE DEVICE IS PART OF IDENTITY — the ball_event INSERT policy compares
 *      device_id = app_device_id() against the live scoring lease. If the
 *      device came from a header, a second device holding the same bearer
 *      token could write under the first one's lease and both would look
 *      legitimate. So the device is bound into the token at login and cannot
 *      be restated per request.
 *
 *   3. NO CONTEXT BLEED — session vars are set TRANSACTION-LOCAL (set_config
 *      ..., true) inside the same txn as the query. With a connection pool,
 *      session-level config would leak one user's context onto the next
 *      request on that pooled connection. This is the classic RLS footgun.
 */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

// ── base64url ──
const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = obj => b64url(JSON.stringify(obj));
const fromB64url = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// ── Token claims contract ──
// Identity only: who (sub) and on what device (did). Authority is not in here
// and never should be — see the header. The short TTL is what bounds a stolen
// token, since there is no longer any scope in it to narrow.
export const TOKEN = { iss: "scrbrd", aud: "scrbrd-api", ttlSec: 30 * 60 };

/**
 * Mint a token after a successful login/DB check. `secret` is server-only.
 *
 * deviceId is required, not optional: an unbound token is one that any device
 * can score with. Callers that genuinely have no device (a server-side job)
 * should say so explicitly by passing one.
 */
export function signToken({ userId, deviceId }, secret, now = Date.now) {
  if (!userId || !deviceId) throw new Error("signToken: userId and deviceId required");
  const iat = Math.floor(now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: TOKEN.iss, aud: TOKEN.aud, sub: userId, did: deviceId, iat, exp: iat + TOKEN.ttlSec };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = b64url(createHmac("sha256", secret).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

/** Verify signature, issuer, audience and expiry. Throws on any failure. */
export function verifyToken(token, secret, now = Date.now) {
  if (typeof token !== "string" || token.split(".").length !== 3) throw new AuthError("malformed_token");
  const [h, p, sig] = token.split(".");
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = fromB64url(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new AuthError("bad_signature");
  let payload;
  try { payload = JSON.parse(fromB64url(p).toString("utf8")); } catch { throw new AuthError("bad_payload"); }
  if (payload.iss !== TOKEN.iss) throw new AuthError("bad_issuer");
  if (payload.aud !== TOKEN.aud) throw new AuthError("bad_audience");
  const nowSec = Math.floor(now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) throw new AuthError("token_expired");
  if (!payload.sub || !payload.did) throw new AuthError("incomplete_claims");
  return payload;
}

export class AuthError extends Error {
  constructor(code) { super(code); this.name = "AuthError"; this.code = code; this.status = 401; }
}

// ── Principal resolution ──
/**
 * The request principal, straight from verified claims.
 *
 * There is nothing to look up. That is the point: the old version made three
 * linkage queries per request to assemble a scope the database then trusted,
 * and each of those was a chance for the API's idea of someone's authority to
 * drift from the database's. Now the database asks itself.
 *
 * Kept as a function rather than inlined because it is the one place that
 * decides what a principal IS, and callers should not be reaching into claims.
 */
export function principalFromClaims(claims) {
  if (!claims?.sub) return ANON;
  return { userId: claims.sub, deviceId: claims.did || null };
}

/** The anonymous principal — app_can() finds no assignments, so RLS denies everything. */
export const ANON = Object.freeze({ userId: null, deviceId: null });

// ── Session config (what RLS reads) ──
/**
 * Parameterised statements that set the app.* vars TRANSACTION-LOCAL.
 * The `true` third arg to set_config is the whole ballgame — see file header.
 *
 * An anonymous principal sets both to the empty string, which app_user_id()
 * turns into NULL, which matches no role_assignment row. Default deny falls
 * out of the data model rather than out of a branch someone has to remember.
 */
export function sessionConfigStatements(principal) {
  const p = principal || ANON;
  return [
    { text: "select set_config('app.user_id',   $1, true)", params: [p.userId || ""] },
    { text: "select set_config('app.device_id', $1, true)", params: [p.deviceId || ""] },
  ];
}

/**
 * Run `fn(client)` with the principal's RLS context, correctly scoped.
 * Opens a transaction, sets LOCAL config, runs the callback, commits — or
 * rolls back on error. `client` must be a single dedicated connection
 * (checked out of the pool), not the pool itself.
 */
export async function withPrincipal(client, principal, fn) {
  await client.query("BEGIN");
  try {
    for (const s of sessionConfigStatements(principal)) await client.query(s.text, s.params);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already broken */ }
    throw e;
  }
}

// ── Express/Fastify-style middleware (thin) ──
/**
 * Extracts the bearer token, verifies it, and stashes the principal on the
 * request. Does NOT set DB context here — that happens per-query inside
 * withPrincipal, so it is always txn-local. Missing/invalid token → ANON
 * (RLS decides what anon may do, which is nothing).
 */
export function authMiddleware({ secret, now = Date.now, requireAuth = true }) {
  return (req, res, next) => {
    const h = req.headers?.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) {
      if (requireAuth) return res.status(401).json({ error: "missing_token" });
      req.principal = ANON;
      return next();
    }
    try {
      req.principal = principalFromClaims(verifyToken(token, secret, now));
      return next();
    } catch (e) {
      if (requireAuth) return res.status(e.status || 401).json({ error: e.code || "unauthorized" });
      req.principal = ANON;
      return next();
    }
  };
}

// ── Magic-link codes ──
/** A single-use login code: long, opaque, and stored only as a hash. */
/**
 * How long an OFFICE-ISSUED code lives.
 *
 * Three days, not the fifteen minutes an emailed link would get. The two are
 * different objects: an emailed link is clicked within a minute or it was not
 * the person, while a code written on an enrolment letter is set up that
 * evening, or on the weekend, by a parent who has to find their phone. Fifteen
 * minutes would mean every code failing and the office re-issuing by hand.
 *
 * What keeps that safe is not the window. It is that the code is 192 bits of
 * randomness, single-use, spent atomically on redemption, invalidated by the
 * next issue, and handed to somebody an administrator has already identified.
 */
export const CODE_TTL_SEC = 3 * 24 * 60 * 60;

export function newMagicCode(secret, ttlSec = CODE_TTL_SEC) {
  const raw = randomBytes(24).toString("base64url");
  return { raw, hash: magicHash(raw, secret), expiresInSec: ttlSec };
}

/**
 * Keyed with the SERVER SECRET, not a constant in the source.
 *
 * It used to be HMAC'd with the literal "scrbrd-magic-link", which is a public
 * value in a public function and therefore no key at all — the "hash" was a
 * pure function anybody could compute. With 192-bit codes that was not
 * exploitable, and it was still the wrong shape: a stolen copy of login_code
 * plus this file is enough to check a guess, and there is no reason to allow
 * that when the secret is already in hand at every call site.
 */
export function magicHash(raw, secret) {
  if (!secret) throw new AuthError("missing_secret");
  return createHmac("sha256", secret).update(String(raw)).digest("hex");
}
