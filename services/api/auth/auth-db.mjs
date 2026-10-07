/**
 * SCRBRD — identity against Postgres.
 *
 * The narrow layer between a signed token and a query that runs under RLS.
 * Everything about a person's AUTHORITY is deliberately missing from this
 * file: authority is role_assignment rows the database reads for itself inside
 * app_can(). What is here is login (proving who someone is) and connection
 * handling (running their query with their identity set, transaction-locally).
 *
 * The lookups in the login path run WITHOUT RLS context — they resolve
 * identity before context exists — so they are scoped by hand, read only the
 * columns they need, and are the shortest queries in the codebase on purpose.
 */
import {
  signToken, verifyToken, principalFromClaims, withPrincipal,
  newMagicCode, magicHash, AuthError, CODE_TTL_SEC, TOKEN,
} from "./auth.mjs";
/** @import { Db, Pool } from "../api-types.mjs" */
/** @import { Principal } from "./auth.mjs" */

// ── A token, with a session behind it (GA-I03, db/85) ──
//
// THE ONE WAY A ROUTE GETS A TOKEN. auth_session_open() records the session
// and answers the account's current epoch, or nothing for an account that is
// not active; the token names both, and app_session_begin() checks them on
// every request. A redeemed code, the Google exchange and the development
// sign-in call it with no identity (`db` is the pool); a signed-in person
// may call it for himself inside his own transaction (the fresh token a
// removed sign-in is answered with), and the function refuses anybody else.
/**
 * @param {Db} db
 * @param {string} secret
 * @param {{ userId: string, deviceId: unknown }} who
 * @returns {Promise<string>}
 */
export async function mintToken(db, secret, { userId, deviceId }) {
  // The same bounds as auth_session.device_id and the pad's credential.
  if (typeof deviceId !== "string" || !deviceId.trim() || deviceId.length > 200) throw new AuthError("missing_device");
  const { rows } = await db.query(`select * from auth_session_open($1, $2, $3)`, [userId, deviceId, TOKEN.ttlSec]);
  const s = rows[0];
  if (!s?.session_id) throw new AuthError("account_inactive");
  return signToken({ userId, deviceId, sessionId: s.session_id, epoch: s.epoch }, secret);
}

// ── Login: issue a code, at the office ──
//
// SCRBRD sends no email and no SMS, so a code is issued BY somebody who already
// holds `user.invite` at the recipient's school, and handed over the way a
// school already hands things over. That is not a workaround for missing
// infrastructure; for a platform holding children's data it is a stronger
// enrolment story than a link emailed to whatever address was typed into a
// form, because a person looked at the recipient first.
//
// The raw code is returned to the ISSUER and never stored. This is the only
// moment it exists in readable form anywhere.
//
// POST /api/auth/invite { email }   (authenticated)
/**
 * @param {Db} db  the issuer's own transaction, identity already set
 * @param {string} secret
 * @param {{ email?: string }} args
 * @param {number} [ttlSec]
 */
export async function issueLoginCode(db, secret, { email }, ttlSec = CODE_TTL_SEC) {
  if (!email) throw new AuthError("missing_email");
  const { raw, hash, expiresInSec } = newMagicCode(secret, ttlSec);
  const { rows } = await db.query(
    `select * from login_code_issue($1, $2, $3)`, [email, hash, expiresInSec]);
  const r = rows[0];
  if (!r?.ok) throw new AuthError(r?.reason || "not_permitted");
  return { ok: true, code: raw, expiresAt: r.expires_at };
}

// ── Login: request a magic link ──
//
// KEPT AND DELIBERATELY NOT WIRED. It is the same table and the same redeem
// path as the office route, waiting only for a delivery channel — the day
// SCRBRD can send an email, this is the self-service half and nothing else has
// to change. Its no-enumeration property (identical answer whether or not the
// address exists) is the reason to keep it written down rather than rebuild it
// later under time pressure.
//
// POST /api/auth/request-link { email }
/**
 * @param {Db} db
 * @param {string} secret
 * @param {(email: string, raw: string) => unknown} sendEmail
 * @param {{ email: string }} args
 */
export async function requestMagicLink(db, secret, sendEmail, { email }) {
  const { rows } = await db.query(`select auth_account_for_email($1) as id`, [email]);
  const userId = rows[0]?.id || null;
  // Always return 200 with no user enumeration — only send if the account exists & is active.
  if (userId) {
    const { raw, hash, expiresInSec } = newMagicCode(secret, 15 * 60);
    await db.query(
      `insert into login_code (user_id, code_hash, expires_at)
       values ($1, $2, now() + ($3 || ' seconds')::interval)`, [userId, hash, expiresInSec]);
    await sendEmail(email, raw);   // email a link like https://scrbrd.co.za/login?c=<raw>
  }
  return { ok: true };            // identical response whether or not the email exists
}

// ── Login: redeem the code → issue a token ──
//
// Runs with NO identity, which is what a login is. The spend and the lookup are
// one statement inside login_code_redeem(), so two devices racing on the same
// code cannot both be given a session — the second UPDATE matches nothing.
//
// POST /api/auth/redeem { email, code, deviceId }
/**
 * @param {Db} db
 * @param {string} secret
 * @param {{ email?: string, code?: string, deviceId?: string }} args
 */
export async function redeemMagicLink(db, secret, { email, code, deviceId }) {
  if (!deviceId) throw new AuthError("missing_device");
  if (!email || !code) throw new AuthError("invalid_or_expired_code");
  const { rows } = await db.query(
    `select login_code_redeem($1, $2) as user_id`, [email, magicHash(code, secret)]);
  const userId = rows[0]?.user_id || null;
  if (!userId) throw new AuthError("invalid_or_expired_code");
  return { token: await mintToken(db, secret, { userId, deviceId }) };
}

/**
 * What the signed-in person may see, for the client to lay out a workspace.
 *
 * This is NOT an authorization answer and must never be used as one. It is the
 * assignment list, returned so the browser can decide which navigation entries
 * to draw and which cards to fetch. Every one of those fetches is authorised
 * again, server-side, against the same assignments. The widget is presentation;
 * the API is security.
 *
 * Read under the person's own RLS context, so it can only ever return their
 * own rows: role_assignment's policy scopes SELECT to person_id = app_user_id()
 * plus whoever holds user.role.assign over the same school.
 * @param {Pool} pool
 * @param {string} secret
 * @param {string | undefined} bearer  the Authorization header, as sent
 */
export async function sessionProfile(pool, secret, bearer) {
  return runAsPrincipal(pool, secret, bearer, async (client, principal) => {
    const { rows: me } = await client.query(
      `select id, name, email from app_user where id = $1`, [principal.userId]);
    const { rows: assignments } = await client.query(
      `select a.id, a.role, a.school_id, s.name as school_name, a.team_code,
              a.season, a.fixture_id, a.valid_from, a.valid_until, a.expires_at,
              -- WHO this assignment is about: a guardian's children, or, for a
              -- self-access assignment, the holder's own player row. It was
              -- called children, back when the table was named for guardians,
              -- which made the second case look like a guardian of themselves.
              coalesce(array_agg(g.player_id) filter (where g.player_id is not null), '{}') as subjects
         from role_assignment a
         left join school s on s.id = a.school_id
         left join assignment_subject g on g.assignment_id = a.id
        where a.person_id = $1 and a.active
          and (a.valid_from  is null or a.valid_from  <= current_date)
          and (a.valid_until is null or a.valid_until >  current_date)
          -- The support session's hour hand (db/22), the third clause of the
          -- liveness rule app_can() applies (db/23). Without it a session
          -- past its hour stayed on the workspace as if it were live —
          -- display only, since every read is refused regardless, but a
          -- screen that says "you are at Hilton" when you are not is wrong.
          and (a.expires_at  is null or a.expires_at  >  now())
        group by a.id, s.name
        order by a.role`, [principal.userId]);
    return {
      user: me[0] ? { id: me[0].id, name: me[0].name, email: me[0].email } : null,
      deviceId: principal.deviceId,
      assignments: assignments.map(a => ({
        id: a.id, role: a.role,
        school: a.school_id, schoolName: a.school_name,
        team: a.team_code, season: a.season, fixture: a.fixture_id,
        from: a.valid_from, until: a.valid_until,
        // Non-null only for a support session: when it stops by itself.
        expiresAt: a.expires_at ?? null,
        subjects: a.subjects,
        // Kept while the demo vocabulary still says children. Both name the
        // same rows; subjects is the one to read.
        children: a.subjects,
      })),
    };
  });
}

// ── Per-request: verify token, run the query under the person's identity ──
/**
 * Use this from route handlers instead of touching the pool directly.
 *
 * `fn` receives (client, principal). The connection is dedicated for the
 * duration and returned to the pool with no lingering context, because
 * withPrincipal sets everything transaction-locally and commits.
 *
 * `bearer` is the Authorization header as sent — or, for the five routes a
 * pad resume credential may use, the principal the dispatcher already built
 * from its signed request (pad-resume.mjs; `who(req)` below picks it). Only
 * a principal carrying scope "pad" is accepted that way: anything else must
 * come through a verified token.
 * @template T
 * @param {Pool} pool
 * @param {string} secret
 * @param {string | Principal | undefined} bearer
 * @param {(client: Db, principal: Principal) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function runAsPrincipal(pool, secret, bearer, fn) {
  /** @type {Principal} */
  let principal;
  if (typeof bearer === "object" && bearer !== null) {
    if (bearer.scope !== "pad" || !bearer.userId || !bearer.deviceId || !bearer.matchId || !bearer.credentialId) throw new AuthError("unauthorized");
    principal = bearer;
  } else {
    // startsWith() on (bearer || "") was true, so bearer is a string here.
    const token = (bearer || "").startsWith("Bearer ") ? /** @type {string} */ (bearer).slice(7) : null;
    if (!token) throw new AuthError("missing_token");
    // verifyToken() refuses a token with no session, so this principal always
    // carries one for app_session_begin() to check.
    principal = principalFromClaims(verifyToken(token, secret));
  }
  const client = await pool.connect();          // one dedicated connection
  try {
    return await withPrincipal(client, principal, (c) => fn(c, principal));
  } finally {
    client.release();
  }
}

// login_code, and the two functions that read and write it, now live in
// db/05_auth.sql where the rest of the login lookup does. They were SQL inside
// this comment for the whole life of the project, which meant the redeem path
// above was written, correct, unit-tested — and could not run, because the
// table it selects from was never created.

/**
 * Who a request to one of the pad's routes runs as: the principal the
 * dispatcher built from a signed resume credential, when there is one, else
 * the Authorization header for runAsPrincipal() to verify. The five handlers
 * a credential reaches pass this; every other handler passes the header, and
 * never sees a credential (the dispatcher refuses it first).
 * @param {{ principal?: Principal, headers?: { authorization?: string } }} req
 * @returns {string | Principal | undefined}
 */
export function who(req) {
  return req.principal ?? req.headers?.authorization;
}
