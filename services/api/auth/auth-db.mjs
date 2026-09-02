/**
 * SCRBRD — Auth data access + login endpoints (adapter layer)
 *
 * Wires auth.mjs to Postgres. `db.query(text, params)` is a thin pg pool wrapper.
 * These lookups run WITHOUT RLS context (they resolve identity before context
 * exists), so they must be scoped by hand and read only the columns they need.
 * Keep them minimal and audited.
 */
import {
  signToken, resolvePrincipal, verifyToken, withPrincipal,
  newMagicCode, magicHash, AuthError,
} from "./auth.mjs";

// ── Linkage accessor injected into resolvePrincipal ──
export function makeAuthData(db) {
  return {
    // The user's own player row (players link to a user via player.user_id).
    async playerIdForUser(userId) {
      const { rows } = await db.query(
        `select id from player where user_id = $1 limit 1`, [userId]);
      return rows[0]?.id || null;
    },
    // A parent's children (guardianship join).
    async childPlayerIds(userId) {
      const { rows } = await db.query(
        `select player_id from guardian_of where guardian_user_id = $1`, [userId]);
      return rows.map(r => r.player_id);
    },
    // Teams a coach/assistant is assigned to (coach_team join).
    async teamCodesForUser(userId) {
      const { rows } = await db.query(
        `select team_code from coach_team where coach_user_id = $1`, [userId]);
      return rows.map(r => r.team_code);
    },
  };
}

// ── Login: request a magic link ──
// POST /auth/request-link { email }
export async function requestMagicLink(db, sendEmail, { email }) {
  const { rows } = await db.query(
    `select id, role, school_id, status from app_user where lower(email) = lower($1) limit 1`, [email]);
  const user = rows[0];
  // Always return 200 with no user enumeration — only send if the account exists & is active.
  if (user && user.status === "active") {
    const { raw, hash, expiresInSec } = newMagicCode();
    await db.query(
      `insert into login_code (user_id, code_hash, expires_at)
       values ($1, $2, now() + ($3 || ' seconds')::interval)`, [user.id, hash, expiresInSec]);
    await sendEmail(email, raw);   // email a link like https://scrbrd.co.za/login?c=<raw>
  }
  return { ok: true };            // identical response whether or not the email exists
}

// ── Login: redeem the code → issue a token ──
// POST /auth/redeem { email, code }
export async function redeemMagicLink(db, secret, { email, code }) {
  const { rows } = await db.query(
    `select u.id, u.role, u.school_id, c.id as code_id
       from app_user u
       join login_code c on c.user_id = u.id
      where lower(u.email) = lower($1)
        and c.code_hash = $2
        and c.used_at is null
        and c.expires_at > now()
      order by c.expires_at desc
      limit 1`, [email, magicHash(code)]);
  const row = rows[0];
  if (!row) throw new AuthError("invalid_or_expired_code");
  await db.query(`update login_code set used_at = now() where id = $1`, [row.code_id]);
  // role + school are captured at issue time from the DB → the trust boundary.
  const token = signToken({ userId: row.id, role: row.role, schoolId: row.school_id }, secret);
  return { token, role: row.role };
}

// ── Per-request: verify token, resolve principal, run query under RLS ──
// Use this from route handlers instead of touching the pool directly.
export async function runAsPrincipal(pool, authData, secret, bearer, fn) {
  const token = (bearer || "").startsWith("Bearer ") ? bearer.slice(7) : null;
  if (!token) throw new AuthError("missing_token");
  const claims = verifyToken(token, secret);
  const principal = await resolvePrincipal(claims, authData);
  const client = await pool.connect();          // one dedicated connection
  try {
    return await withPrincipal(client, principal, fn);  // BEGIN → set LOCAL → fn → COMMIT
  } finally {
    client.release();                            // returned to pool with no lingering context
  }
}

/*
-- ── Supporting tables (add to the schema) ──
CREATE TABLE app_user (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      citext UNIQUE NOT NULL,
  role       text NOT NULL,
  school_id  uuid NOT NULL REFERENCES school(id),
  status     text NOT NULL DEFAULT 'active',   -- active | suspended
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE login_code (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz
);
CREATE INDEX ON login_code (user_id) WHERE used_at IS NULL;
-- Linkage tables read by the accessor:
--   player.user_id                      (a player's login)
--   guardian_of(guardian_user_id, player_id)
--   coach_team(coach_user_id, team_code)
*/
