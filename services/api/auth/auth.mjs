/**
 * SCRBRD — Auth & request context
 * Framework-agnostic core (no external deps; HMAC-SHA256 via node:crypto).
 *
 * Job: turn an authenticated request into the Postgres session variables that
 * rls_policies.sql reads (app.role, app.school_id, app.user_id, app.player_id,
 * app.child_ids, app.teams).
 *
 * Two hard rules encoded here:
 *   1. TRUST BOUNDARY — role/school/identity come from a SIGNED token minted
 *      after a DB check at login, NEVER from request headers or the client.
 *   2. NO CONTEXT BLEED — session vars are set TRANSACTION-LOCAL (set_config
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
// Stable identity only. Volatile scope (teams, children) is resolved fresh per
// request so a mid-session squad change is reflected without re-issuing tokens.
export const TOKEN = { iss: "scrbrd", aud: "scrbrd-api", ttlSec: 30 * 60 };

/** Mint a JWT after a successful login/DB check. `secret` is server-only. */
export function signToken({ userId, role, schoolId }, secret, now = Date.now) {
  if (!userId || !role || !schoolId) throw new Error("signToken: userId, role, schoolId required");
  const iat = Math.floor(now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: TOKEN.iss, aud: TOKEN.aud, sub: userId, role, school_id: schoolId, iat, exp: iat + TOKEN.ttlSec };
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
  if (!payload.sub || !payload.role || !payload.school_id) throw new AuthError("incomplete_claims");
  return payload;
}

export class AuthError extends Error {
  constructor(code) { super(code); this.name = "AuthError"; this.code = code; this.status = 401; }
}

// ── Principal resolution ──
/**
 * Build the full request principal from trusted token claims + fresh linkage
 * lookups. `data` is an injectable accessor (real: SQL; tests: in-memory):
 *   data.playerIdForUser(userId)  → uuid | null   (the user's own player row)
 *   data.childPlayerIds(userId)   → uuid[]         (a parent's children)
 *   data.teamCodesForUser(userId) → string[]       (coach/assistant teams)
 */
export async function resolvePrincipal(claims, data) {
  const { sub: userId, role, school_id: schoolId } = claims;
  // Only resolve what each scope actually needs — avoids pointless lookups.
  const needsOwn  = role === "player" || role === "parent";
  const needsTeam = role === "coach" || role === "assistant" || role === "scorer";
  const [playerId, childIds, teams] = await Promise.all([
    (role === "player") ? data.playerIdForUser(userId) : Promise.resolve(null),
    (role === "parent") ? data.childPlayerIds(userId)  : Promise.resolve([]),
    needsTeam           ? data.teamCodesForUser(userId): Promise.resolve([]),
  ]);
  return {
    userId, role, schoolId,
    playerId: playerId || null,
    childIds: childIds || [],
    teams: teams || [],
  };
}

/** The anonymous principal — RLS denies everything for it. Safe default. */
export const ANON = { userId: null, role: "anonymous", schoolId: null, playerId: null, childIds: [], teams: [] };

// ── Session config (what RLS reads) ──
/**
 * Parameterised statements that set the app.* vars TRANSACTION-LOCAL.
 * The `true` third arg to set_config is the whole ballgame — see file header.
 */
export function sessionConfigStatements(principal) {
  const p = principal || ANON;
  const csv = a => (a && a.length ? a.join(",") : "");
  return [
    { text: "select set_config('app.role',      $1, true)", params: [p.role || "anonymous"] },
    { text: "select set_config('app.user_id',   $1, true)", params: [p.userId || ""] },
    { text: "select set_config('app.school_id', $1, true)", params: [p.schoolId || ""] },
    { text: "select set_config('app.player_id', $1, true)", params: [p.playerId || ""] },
    { text: "select set_config('app.child_ids', $1, true)", params: [csv(p.childIds)] },
    { text: "select set_config('app.teams',     $1, true)", params: [csv(p.teams)] },
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
 * Extracts the bearer token, verifies it, resolves the principal and stashes it
 * on the request. Does NOT set DB context here — that happens per-query inside
 * withPrincipal, so it is always txn-local. Missing/invalid token → ANON (route
 * guards / RLS decide what anon may do; most reads are school-scoped and will
 * simply return nothing).
 */
export function authMiddleware({ secret, data, now = Date.now, requireAuth = true }) {
  return async (req, res, next) => {
    const hdr = req.headers?.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    if (!token) {
      if (requireAuth) return res.status(401).json({ error: "missing_token" });
      req.principal = ANON; return next();
    }
    try {
      const claims = verifyToken(token, secret, now);
      req.principal = await resolvePrincipal(claims, data);
      req.claims = claims;
      return next();
    } catch (e) {
      const code = e instanceof AuthError ? e.code : "auth_failed";
      return res.status(401).json({ error: code });
    }
  };
}

// ── Magic-link login helpers (schools: no passwords) ──
/** One-time login code. Store the HASH; email the raw code/link to the user. */
export function newMagicCode() {
  const raw = randomBytes(24).toString("base64url");
  const hash = createHmac("sha256", "magic-code-pepper").update(raw).digest("base64url");
  return { raw, hash, expiresInSec: 15 * 60 };
}
export function magicHash(raw) {
  return createHmac("sha256", "magic-code-pepper").update(raw).digest("base64url");
}
