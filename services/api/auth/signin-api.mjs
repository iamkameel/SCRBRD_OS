/**
 * SCRBRD — signing in with Google, and the ways a person signs in (SCRBRD-140 phase 1).
 *
 * POST /api/auth/firebase { idToken, deviceId } is the exchange (§2.2): the
 * route verifies Google's signed statement (firebase-verify.mjs), asks
 * auth_identity_sign_in() (db/81) who that is here, and ends in signToken()
 * — the same thirty-minute, device-bound token { sub, did } a login code
 * ends in, unchanged. It is the third unauthenticated route after
 * /api/onboard and /api/schools, and like them it runs one narrow function.
 * Rate-limited per address (before anything is verified) and per Google
 * account (after), with the public pages' token bucket.
 *
 *   200 { token, outcome }   outcome: signed_in | new_account | linked
 *   409 claim_required       the address matches an account the office
 *                            enrolled: the office confirms, or issues a code
 *                            (then POST /api/auth/sign-ins with a fresh token)
 *   401 identity_revoked · 403 account_inactive · 401 missing_device
 *   401 <the verifier's refusal> · 503 keys_unavailable · 429 rate_limited
 *
 * The rest are signed in, and every decision is the database's:
 *   POST /api/auth/sign-ins { idToken }          add a way to sign in (fresh auth_time)
 *   POST /api/auth/sign-ins/:id/revoke           end one of your own
 *   GET  /api/auth/users/:id/sign-ins            the office: one account's
 *   POST /api/auth/office/sign-ins/:id/revoke    the office ends one
 *   POST /api/auth/claims/:id/confirm            the office confirms a claim
 *   POST /api/auth/claims/:id/decline            the office declines one
 *   POST /api/auth/sign-out-everywhere           every session you hold ends (GA-I03)
 *   POST /api/auth/users/:id/disable · /enable { reason }   the office or the owner (GA-I03,
 *                                                account lifecycle slice 2, db/90)
 *   GET  /api/auth/users/:id/preview             what disabling would cut (db/90)
 * and two reads on the governed read path: my_sign_ins, sign_in_claims.
 *
 * ENDING A SESSION (GA-I03, db/85). Removing a way to sign in — yours, or the
 * office removing one of an account's — signing out everywhere, and the
 * office disabling an account each bump the account's session epoch, and
 * every token minted before it is refused on its next request. Removing one
 * of your own answers with a fresh token for this device, so the person who
 * removed it stays signed in here and nowhere else.
 *
 * A REFUSAL ON THESE IS { error, detail }: a code and the sentence a screen
 * shows (SIGN_IN_REFUSALS). None says more about an account than the caller
 * may already know.
 */
import { readFileSync } from "node:fs";
import { AuthError } from "./auth.mjs";
import { runAsPrincipal, mintToken } from "./auth-db.mjs";
import { firebaseVerifier, keysFromJwks, FIREBASE_PROJECT, FRESH_SEC } from "./firebase-verify.mjs";
import { RateLimit, clientAddress } from "../public/public-api.mjs";
/** @import { Pool, Handler, ApiRequest, ApiResponse, ExactHandler } from "../api-types.mjs" */
/** @import { FirebaseVerifier } from "./firebase-verify.mjs" */

/** The project the walk signs for. Never the real one. */
export const TEST_PROJECT = "scrbrd-os-test";

/**
 * Per address, before a token is even parsed; per Google account, after.
 *
 * THE ADDRESS LIMIT IS A SCHOOL'S, NOT A PERSON'S. A school's staff room,
 * labs and Wi-Fi reach us through one NAT address, so the bucket is sized
 * for the whole school (as SCRBRD-133 A4 sized the public pages' for a
 * ground). The arithmetic, for ~80 staff plus the pupils of 13 and over who
 * use Google rather than a code (say 100; most pupils are on codes, which
 * never touch this route):
 *   steady state — every signed-in client re-exchanges once per thirty-minute
 *     token: 180 / 30 min = 6 a minute, 5% of 120;
 *   Monday 07:30 — the staff briefing, everybody opening the app in the same
 *     minute: a burst of 40 is served at once and the rest at 2 a second, so
 *     all 80 staff are in within twenty seconds (each 429 carries no penalty
 *     beyond a retry); at the old 20/min with a burst of 10, seventy would
 *     have waited up to three and a half minutes;
 *   a period change, 30 pupils in a lab — inside the burst.
 * What it still stops: one address hammering the exchange. A forged token
 * costs one RSA verification (tens of microseconds) and never reaches the
 * database; a real one is limited again per Google account below, so no
 * single account re-mints more than six tokens a minute from anywhere.
 */
export const EXCHANGE_RATE = Object.freeze({ perMinute: 120, burst: 40 });
export const UID_RATE = Object.freeze({ perMinute: 6, burst: 6 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (/** @type {string} */ code, /** @type {number} */ status) => Object.assign(new Error(code), { code, status });

/**
 * The verifier this server runs with. Google's keys for scrbrd-os, always —
 * unless FIREBASE_TEST_KEYS names a JWK set on disk, which is the walk's
 * door: refused outright in production, and then only for a project that
 * is not scrbrd-os, so a real Google token is refused by a test server and a
 * test token by a real one (bad_issuer either way).
 * @param {{ env?: NodeJS.ProcessEnv, dev: boolean }} opts
 * @returns {{ verifier: FirebaseVerifier, test: boolean }}
 */
export function verifierFromEnv({ env = process.env, dev }) {
  const file = env.FIREBASE_TEST_KEYS;
  if (!file) return { verifier: firebaseVerifier({ projectId: FIREBASE_PROJECT }), test: false };
  if (!dev) throw new Error("FIREBASE_TEST_KEYS is set with NODE_ENV=production. Refusing to start.");
  const projectId = env.FIREBASE_TEST_PROJECT_ID || TEST_PROJECT;
  if (projectId === FIREBASE_PROJECT) throw new Error("FIREBASE_TEST_PROJECT_ID may not be the real project. Refusing to start.");
  const keys = keysFromJwks(JSON.parse(readFileSync(file, "utf8")));
  return { verifier: firebaseVerifier({ projectId, fetchKeys: async () => ({ keys, maxAgeSec: 3600 }) }), test: true };
}

/**
 * Each refusal on the signed-in routes: its status and the sentence the
 * screen shows. Never the provider's uid; never whether an account exists.
 * @type {Record<string, [number, string]>}
 */
export const SIGN_IN_REFUSALS = {
  not_signed_in:          [401, "Sign in again first."],
  not_permitted:          [403, "You cannot do this for that account. The school office that enrolled them can."],
  superadmin_only:        [403, "This account holds the owner's key. Only another holder of it may change how it signs in."],
  bad_arguments:          [422, "That sign-in could not be read. Try again."],
  account_inactive:       [403, "This account is not active. Ask the school office."],
  identity_in_use:        [409, "That Google account is already used to sign in to SCRBRD. Use a different one."],
  pupil_consent_required: [403, "A pupil's Google account is linked only once the school has the family's consent on record, or he is eighteen. Ask the school office."],
  no_such_sign_in:        [404, "That way of signing in is not on your account."],
  already_revoked:        [409, "That way of signing in has already been removed."],
  no_such_claim:          [404, "That request is not on the list."],
  already_resolved:       [409, "Somebody has already answered that request."],
  cannot_confirm_your_own:[403, "You cannot confirm a sign-in to your own account. Ask a colleague."],
  cannot_disable_yourself:[403, "You cannot disable or enable your own account. Ask a colleague at the office."],
  stale_sign_in:          [401, "For your security, sign in with Google again, then add it."],
  // Account lifecycle slice 2 (db/90): disable and enable carry a reason; the
  // preview says, before the tap, the one refusal it can name.
  reason_required:        [422, "Say why, in at least ten characters. It goes on the school's record, not to the person."],
  reason_too_long:        [422, "Keep the reason under 2,000 characters."],
  other_school:           [403, "Also holds roles at another school. This account cannot be disabled from here."],
  // D21: a dead token's holder is told the same for every reason (db/85).
  session_revoked:        [401, "You were signed out. Sign in again."],
  refused:                [409, "The database refused this."],
};

/**
 * @param {string} code
 * @param {ApiResponse} res
 */
const refuse = (code, res) => {
  const [status, detail] = SIGN_IN_REFUSALS[code] ?? SIGN_IN_REFUSALS.refused;
  return res.status(status).json({ error: code, detail });
};

/**
 * @param {{ pool: Pool, secret: string, verifier: FirebaseVerifier, trustProxyHops?: number, now?: () => number }} deps
 */
export function signInRoutes({ pool, secret, verifier, trustProxyHops = 0, now = Date.now }) {
  const byAddress = new RateLimit(now, EXCHANGE_RATE);
  const byUid = new RateLimit(now, UID_RATE);

  /**
   * A signed-in route: run `fn` under the caller's identity, and turn a
   * function's (ok, reason) into an answer.
   * @param {(req: ApiRequest, client: import("../api-types.mjs").Db, principal: import("./auth.mjs").Principal) => Promise<{ ok: boolean, reason?: string | null } & Record<string, unknown>>} fn
   * @returns {Handler}
   */
  const signedIn = (fn) => async (req, res) => {
    try {
      const out = await runAsPrincipal(pool, secret, req.headers?.authorization, (client, principal) => fn(req, client, principal));
      if (!out.ok) return refuse(out.reason || "refused", res);
      const { ok: _ok, reason: _r, ...rest } = out;
      return res.json(rest);
    } catch (/** @type {any} */ e) {
      if (e instanceof AuthError) {
        if (e.code in SIGN_IN_REFUSALS) return refuse(e.code, res);
        return res.status(e.status || 401).json({ error: e.code });
      }
      if (e.code === "42501") return refuse("not_permitted", res);
      if (e.status && typeof e.code === "string") return res.status(e.status).json({ error: e.code });
      console.error("sign-in route →", e.code || "", e.message);
      return res.status(500).json({ error: "internal_error" });
    }
  };
  /**
   * account_set_active() (db/90), as an answer.
   * @param {import("../api-types.mjs").Db} client @param {string} id @param {boolean} active @param {unknown} reason
   */
  const setActive = async (client, id, active, reason) => {
    const { rows: [r] } = await client.query(`select * from account_set_active($1, $2, $3)`,
                                             [id, active, typeof reason === "string" ? reason : null]);
    return r?.ok ? { ok: true, active: r.active } : { ok: false, reason: r?.reason };
  };
  const idOf = (/** @type {ApiRequest} */ req) => {
    const id = String(req.params?.id ?? "");
    if (!UUID.test(id)) throw err("not_found", 404);
    return id;
  };

  /** @type {ExactHandler} */
  const exchange = async (body, req) => {
    if (byAddress.take(clientAddress(/** @type {any} */ (req), trustProxyHops))) throw err("rate_limited", 429);
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
    if (!deviceId || deviceId.length > 200) throw new AuthError("missing_device");
    const id = await verifier.verify(body?.idToken);
    if (byUid.take(`${id.provider}:${id.uid}`)) throw err("rate_limited", 429);
    const { rows } = await pool.query(`select * from auth_identity_sign_in($1, $2, $3, $4)`,
                                      [id.provider, id.uid, id.email, id.name]);
    const r = rows[0] ?? { outcome: "refused" };
    switch (r.outcome) {
      case "signed_in": case "new_account": case "linked":
        return { token: await mintToken(pool, secret, { userId: r.user_id, deviceId }), outcome: r.outcome };
      case "claim_required": throw err("claim_required", 409);
      case "revoked": throw err("identity_revoked", 401);
      case "account_inactive": throw err("account_inactive", 403);
      default: throw err("refused", 400);
    }
  };

  return {
    exchange,

    // POST /api/auth/sign-ins { idToken } — add a way to sign in (§3.4). The
    // Google sign-in must be fresh: a stale browser session is not proof.
    link: signedIn(async (req, client) => {
      /** @type {import("./firebase-verify.mjs").FirebaseIdentity} */
      let id;
      try { id = await verifier.verify(req.body?.idToken, { freshSec: FRESH_SEC }); }
      catch (/** @type {any} */ e) {
        if (e.code === "stale_sign_in") return { ok: false, reason: "stale_sign_in" };
        throw e;
      }
      const { rows: [r] } = await client.query(`select * from auth_identity_link_self($1, $2, $3)`, [id.provider, id.uid, id.email]);
      return r?.ok ? { ok: true, id: r.identity_id, linkedHow: r.linked_how, already: r.reason === "already_linked" }
                   : { ok: false, reason: r?.reason };
    }),

    // POST /api/auth/sign-ins/:id/revoke — one of your own (§3.7). The
    // removal bumps the epoch (db/85), which ends this session with the
    // rest; the answer carries a fresh one for this device, minted in the
    // same transaction under the new epoch, so the person stays signed in
    // here. The client adopts it (apps/web/src/views/signins.jsx).
    revokeOwn: signedIn(async (req, client, principal) => {
      const { rows: [r] } = await client.query(`select * from auth_identity_revoke_self($1)`, [idOf(req)]);
      if (!r?.ok) return { ok: false, reason: r?.reason };
      const token = await mintToken(client, secret, { userId: /** @type {string} */ (principal.userId), deviceId: principal.deviceId });
      return { ok: true, revoked: true, token };
    }),

    // GET /api/auth/users/:id/sign-ins — the office's view of one account.
    accountSignIns: signedIn(async (req, client) => {
      const { rows } = await client.query(`select * from account_sign_ins($1)`, [idOf(req)]);
      return { ok: true, rows };
    }),

    // POST /api/auth/office/sign-ins/:id/revoke — the office ends one.
    revokeOffice: signedIn(async (req, client) => {
      const { rows: [r] } = await client.query(`select * from auth_identity_revoke($1)`, [idOf(req)]);
      return r?.ok ? { ok: true, revoked: true } : { ok: false, reason: r?.reason };
    }),

    // POST /api/auth/claims/:id/confirm — one tap (§3.3).
    confirmClaim: signedIn(async (req, client) => {
      const { rows: [r] } = await client.query(`select * from pending_claim_confirm($1)`, [idOf(req)]);
      return r?.ok ? { ok: true, confirmed: true } : { ok: false, reason: r?.reason };
    }),

    // POST /api/auth/claims/:id/decline
    declineClaim: signedIn(async (req, client) => {
      const { rows: [r] } = await client.query(`select * from pending_claim_decline($1)`, [idOf(req)]);
      return r?.ok ? { ok: true, declined: true } : { ok: false, reason: r?.reason };
    }),

    // POST /api/auth/sign-out-everywhere — every token and pad credential
    // this person holds ends, this one included (db/85). An API route; no
    // screen calls it yet.
    signOutEverywhere: signedIn(async (_req, client) => {
      const { rows: [r] } = await client.query(`select * from auth_sign_out_everywhere()`);
      return r?.ok ? { ok: true, signedOut: true } : { ok: false, reason: r?.reason };
    }),

    // POST /api/auth/users/:id/disable · /enable { reason } — the office or
    // the owner, under db/81's rule for acting on somebody else's account,
    // saying why (ten characters or more: reason_required). Disabling ends
    // every session and pad credential the account holds; enabling brings
    // none back, and tells the person, never why (db/85, db/90). The reason
    // goes to the database as it came; the database trims and checks it.
    disable: signedIn(async (req, client) => setActive(client, idOf(req), false, req.body?.reason)),
    enable: signedIn(async (req, client) => setActive(client, idOf(req), true, req.body?.reason)),

    // GET /api/auth/users/:id/preview — what disabling the account would cut
    // (db/90 account_offboard_preview()): counts, and the fixtures of the
    // scoring tokens it holds; never a child's name. Refused by the same rule
    // as the act, first, so a stranger learns nothing.
    preview: signedIn(async (req, client) => {
      const { rows: [r] } = await client.query(`select * from account_offboard_preview($1)`, [idOf(req)]);
      if (!r?.ok) return { ok: false, reason: r?.reason };
      return { ok: true, active: r.active, sessions: r.sessions, padCredentials: r.pad_credentials,
               scoringTokens: r.scoring_tokens ?? [], duties: r.duties, lifts: r.lifts, children: r.children };
    }),
  };
}
