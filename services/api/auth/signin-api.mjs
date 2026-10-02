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
 * and two reads on the governed read path: my_sign_ins, sign_in_claims.
 *
 * A REFUSAL ON THESE IS { error, detail }: a code and the sentence a screen
 * shows (SIGN_IN_REFUSALS). None says more about an account than the caller
 * may already know.
 */
import { readFileSync } from "node:fs";
import { signToken, AuthError } from "./auth.mjs";
import { runAsPrincipal } from "./auth-db.mjs";
import { firebaseVerifier, keysFromJwks, FIREBASE_PROJECT, FRESH_SEC } from "./firebase-verify.mjs";
import { RateLimit, clientAddress } from "../public/public-api.mjs";
/** @import { Pool, Handler, ApiRequest, ApiResponse, ExactHandler } from "../api-types.mjs" */
/** @import { FirebaseVerifier } from "./firebase-verify.mjs" */

/** The project the walk signs for. Never the real one. */
export const TEST_PROJECT = "scrbrd-os-test";

/** Per address, before a token is even parsed; per Google account, after. */
export const EXCHANGE_RATE = Object.freeze({ perMinute: 20, burst: 10 });
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
  stale_sign_in:          [401, "For your security, sign in with Google again, then add it."],
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
   * @param {(req: ApiRequest, client: import("../api-types.mjs").Db) => Promise<{ ok: boolean, reason?: string | null } & Record<string, unknown>>} fn
   * @returns {Handler}
   */
  const signedIn = (fn) => async (req, res) => {
    try {
      const out = await runAsPrincipal(pool, secret, req.headers?.authorization, (client) => fn(req, client));
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
        return { token: signToken({ userId: r.user_id, deviceId }, secret), outcome: r.outcome };
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

    // POST /api/auth/sign-ins/:id/revoke — one of your own (§3.7).
    revokeOwn: signedIn(async (req, client) => {
      const { rows: [r] } = await client.query(`select * from auth_identity_revoke_self($1)`, [idOf(req)]);
      return r?.ok ? { ok: true, revoked: true } : { ok: false, reason: r?.reason };
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
  };
}
