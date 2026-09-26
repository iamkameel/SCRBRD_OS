/**
 * SCRBRD — the pad's resume credential, on the server (SCRBRD-078 option B).
 *
 * The API token lives in the page's memory and lasts thirty minutes
 * (apps/web/src/lib/api.js, auth.mjs), and a production sign-in is a
 * one-time code from the school office. So a scorer whose pad reloads, or
 * whose match runs past half an hour, could not go on sending balls. This is
 * the narrow fix the product owner chose (Kameel, 2026-09-26): a credential
 * for ONE match on ONE device, held with a key the device cannot give away.
 *
 * WHAT A REQUEST CARRIES
 * ──────────────────────
 *   Authorization: ScrbrdPad <proof>
 *
 * where <proof> is a compact JWS, ES256 (ECDSA P-256, SHA-256, the signature
 * as raw r‖s — WebCrypto's own output), signed by the device's
 * non-extractable private key:
 *
 *   header   {"alg":"ES256","typ":"scrbrd-pad+jwt"}
 *   payload  {"cid": <the credential id, as issued>,
 *             "htm": <the method>,          "htu": <the path and query>,
 *             "iat": <seconds, the device's clock corrected by the server's>,
 *             "jti": <16+ random base64url characters, once>,
 *             "bh":  <base64url SHA-256 of the body's exact bytes; of "" for none>}
 *
 * The server looks the credential up by an HMAC of `cid` (it never stores the
 * id), verifies the signature with the PUBLIC key stored at issue, checks the
 * proof names this method, this path and this body, that `iat` is within two
 * minutes of its own clock, and spends the jti — once, ever — before the
 * request runs. Every step refuses with a 401 and a code; a stale `iat` is
 * answered with the server's time so the device can correct its offset.
 *
 * WHAT IT IS GOOD FOR — five routes, and nothing else. PAD_ROUTES below is
 * the whole list; the dispatcher in server.mjs checks it before any other
 * routing, so a signed request to any other path — a pupil, a medical record,
 * another match, /api/session, /api/health — is 403 `pad_scope` without being
 * looked at. tools/smoke-pad-resume.mjs sends one to every route to prove it.
 * The principal it builds runs as the person, on the device, with
 * app.scope = 'pad' and app.match_id set, and the database narrows it to that
 * match (db/50): app_can() admits fixture.read and scoring.edit there and
 * nothing else, and a restrictive policy on every table closes the rest.
 *
 * Issuing and revoking are ordinary signed-in routes (padCredentialRoutes):
 * a credential is issued only to a device that holds the match's token right
 * now, and nothing a credential can do mints another.
 */
import { createHmac, createHash, createPublicKey, verify as verifySignature, randomBytes } from "node:crypto";
import { runAsPrincipal } from "./auth-db.mjs";
/** @import { Principal } from "./auth.mjs" */
/** @import { Pool, Db, IdHandler } from "../api-types.mjs" */

export const PAD = Object.freeze({
  scheme: "ScrbrdPad",
  typ: "scrbrd-pad+jwt",
  alg: "ES256",
  /** Seconds either side of the server's clock a proof's iat may be. */
  windowSec: 120,
});

/**
 * The five routes a credential may reach, and the handler key each maps to in
 * server.mjs. The match in the path must be the credential's own.
 * @type {ReadonlyArray<readonly [string, RegExp, string]>}
 */
export const PAD_ROUTES = Object.freeze([
  ["POST", /^\/api\/matches\/([^/]+)\/session\/heartbeat$/, "heartbeat"],
  ["POST", /^\/api\/matches\/([^/]+)\/session\/claim$/, "claim"],
  ["POST", /^\/api\/matches\/([^/]+)\/events$/, "append"],
  ["GET",  /^\/api\/matches\/([^/]+)\/events$/, "list"],
  ["GET",  /^\/api\/matches\/([^/]+)\/toss$/, "toss"],
]);

/**
 * Which pad route this is, and its match — or null: the request is refused.
 * @param {string | undefined} method @param {string} path  the pathname, no query
 * @returns {{ name: string, matchId: string } | null}
 */
export function padRoute(method, path) {
  for (const [m, re, name] of PAD_ROUTES) {
    const hit = method === m && re.exec(path);
    if (hit) return { name, matchId: decodeURIComponent(hit[1]) };
  }
  return null;
}

/** Does this Authorization header carry a resume credential? @param {unknown} h */
export const isPadAuthorization = (h) => typeof h === "string" && h.startsWith(`${PAD.scheme} `);

/** A refusal with an HTTP status, a code, and what the device needs to act on it. */
export class PadError extends Error {
  /** @param {string} code @param {number} [status] @param {{ detail?: string | null, serverTime?: number }} [extra] */
  constructor(code, status = 401, extra = {}) {
    super(code);
    this.name = "PadError";
    this.code = code;
    this.status = status;
    this.detail = extra.detail ?? null;
    this.serverTime = extra.serverTime;
  }
}

// ── Ids and hashes ──
/** A new credential id: 256 bits, base64url. Returned to the device once. */
export const newPadCredentialId = () => randomBytes(32).toString("base64url");

/**
 * What the database stores instead of the id. Keyed with the server secret,
 * like a login code's (auth.mjs magicHash), and domain-separated from it, so
 * the table cannot be used to test a guess and a code's hash is never a
 * credential's.
 * @param {string} raw @param {string} secret
 */
export function padIdHash(raw, secret) {
  if (!secret) throw new PadError("missing_secret", 500);
  return createHmac("sha256", secret).update(`scrbrd-pad-resume:${raw}`).digest("hex");
}

/** base64url SHA-256 of a body's exact bytes. @param {Buffer | Uint8Array | string} body */
export const padBodyHash = (body) => createHash("sha256").update(body).digest("base64url");

// ── Keys ──
const B64U = /^[A-Za-z0-9_-]+$/;

/**
 * The device's public key, as it will be stored: exactly kty, crv, x and y
 * of a P-256 point that is on the curve (createPublicKey refuses one that is
 * not), and nothing private. Null for anything else.
 * @param {unknown} jwk
 * @returns {{ kty: "EC", crv: "P-256", x: string, y: string } | null}
 */
export function publicJwkOf(jwk) {
  if (!jwk || typeof jwk !== "object") return null;
  const k = /** @type {Record<string, unknown>} */ (jwk);
  if ("d" in k || k.kty !== "EC" || k.crv !== "P-256") return null;
  if (typeof k.x !== "string" || typeof k.y !== "string" || k.x.length !== 43 || k.y.length !== 43
      || !B64U.test(k.x) || !B64U.test(k.y)) return null;
  const out = { kty: /** @type {"EC"} */ ("EC"), crv: /** @type {"P-256"} */ ("P-256"), x: k.x, y: k.y };
  try { createPublicKey({ key: out, format: "jwk" }); } catch { return null; }
  return out;
}

// ── The proof ──
/**
 * The parts of a proof, or a 401. Only the shape is checked here.
 * @param {string} authorization
 */
export function parsePadProof(authorization) {
  const jws = authorization.slice(PAD.scheme.length + 1).trim();
  const parts = jws.split(".");
  if (parts.length !== 3 || parts.some((p) => !p || !B64U.test(p))) throw new PadError("pad_malformed");
  /** @type {any} */ let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { throw new PadError("pad_malformed"); }
  if (header?.alg !== PAD.alg || header?.typ !== PAD.typ) throw new PadError("pad_malformed");
  if (!payload || typeof payload !== "object" || typeof payload.cid !== "string" || !payload.cid
      || typeof payload.htm !== "string" || typeof payload.htu !== "string"
      || !Number.isInteger(payload.iat) || typeof payload.jti !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.jti)
      || typeof payload.bh !== "string") throw new PadError("pad_malformed");
  return {
    input: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url"),
    /** @type {{ cid: string, htm: string, htu: string, iat: number, jti: string, bh: string }} */
    payload,
  };
}

/**
 * The checks that need no database: the signature against the stored key,
 * then that the proof is for THIS request, now. Returns the refusal code, or
 * null when the proof holds.
 * @param {object} a
 * @param {ReturnType<typeof parsePadProof>} a.proof
 * @param {object} a.jwk          the stored public key
 * @param {string} a.method
 * @param {string} a.target       the path and query, as the server received them
 * @param {string} a.bodyHash     padBodyHash() of the body's bytes
 * @param {number} a.nowSec
 * @returns {"pad_bad_signature" | "pad_wrong_request" | "pad_stale" | null}
 */
export function checkPadProof({ proof, jwk, method, target, bodyHash, nowSec }) {
  let good = false;
  try {
    const key = createPublicKey({ key: /** @type {any} */ (jwk), format: "jwk" });
    good = proof.signature.length === 64
      && verifySignature("sha256", Buffer.from(proof.input), { key, dsaEncoding: "ieee-p1363" }, proof.signature);
  } catch { good = false; }
  if (!good) return "pad_bad_signature";
  const p = proof.payload;
  if (p.htm !== method || p.htu !== target || p.bh !== bodyHash) return "pad_wrong_request";
  if (Math.abs(nowSec - p.iat) > PAD.windowSec) return "pad_stale";
  return null;
}

/**
 * The principal a signed request runs as — or a PadError.
 *
 * The order: shape; the credential by the hash of its id; the signature
 * (before anything is said about the credential's state, so the answer
 * "revoked" or "expired" goes only to the holder of the key); that the proof
 * is for this request, now; that it is for the credential's own match; that
 * the credential still works; and last, the jti, spent in its own statement
 * so it is spent whatever the request then does.
 *
 * Runs on the pool with NO identity (like login_code_redeem): the functions
 * it calls, pad_resume_lookup() and pad_resume_spend(), are how the identity
 * is established.
 * @param {object} a
 * @param {Db} a.pool
 * @param {string} a.secret
 * @param {string} a.authorization
 * @param {string} a.method
 * @param {string} a.target          the request-target as received: path and query
 * @param {Buffer | Uint8Array | string} a.rawBody
 * @param {string} a.matchId         the match the route names
 * @param {() => number} [a.now]
 * @returns {Promise<Principal>}
 */
export async function padPrincipal({ pool, secret, authorization, method, target, rawBody, matchId, now = Date.now }) {
  const proof = parsePadProof(authorization);
  const { rows } = await pool.query(`select * from pad_resume_lookup($1)`, [padIdHash(proof.payload.cid, secret)]);
  const c = rows[0];
  if (!c) throw new PadError("pad_unknown");
  const t = now();
  const why = checkPadProof({ proof, jwk: c.public_jwk, method, target, bodyHash: padBodyHash(rawBody), nowSec: Math.floor(t / 1000) });
  if (why) throw new PadError(why, 401, why === "pad_stale" ? { serverTime: t } : {});
  if (String(c.match_id).toLowerCase() !== String(matchId).toLowerCase()) throw new PadError("pad_scope", 403);
  if (c.ended) throw new PadError(c.ended === "expired" ? "pad_expired" : "pad_revoked", 401, { detail: c.ended });
  const spent = (await pool.query(`select * from pad_resume_spend($1, $2)`, [c.credential, proof.payload.jti])).rows[0];
  if (!spent?.ok) {
    const r = spent?.reason ?? "unknown";
    throw new PadError(r === "replay" ? "pad_replay" : r === "expired" ? "pad_expired" : r === "bad_jti" ? "pad_malformed"
                       : r === "unknown" ? "pad_unknown" : "pad_revoked", 401, { detail: r });
  }
  return { userId: c.user_id, deviceId: c.device_id, scope: "pad", matchId: c.match_id, credentialId: c.credential };
}

// ── Issuing and revoking: ordinary signed-in routes ──
/**
 * @param {{ pool: Pool, secret: string, now?: () => number }} deps
 * @returns {{ issue: IdHandler, revoke: IdHandler, signOut: (body: any, req: { headers?: import("node:http").IncomingHttpHeaders }) => Promise<unknown> }}
 */
export function padCredentialRoutes({ pool, secret, now = Date.now }) {
  return {
    // POST /matches/:id/session/pad-credential { jwk }  (a bearer token; never a credential)
    //
    // Called by the pad just after a claim succeeds. The raw id goes back to
    // the device once, with when it ends and the server's clock (the device
    // signs with its offset from that). pad_resume_issue() decides: this
    // person, this device, the token, now, and scoring.edit over the match.
    issue: async (req, res) => {
      try {
        const jwk = publicJwkOf(req.body?.jwk);
        if (!jwk) { res.status(400).json({ error: "bad_key" }); return; }
        const raw = newPadCredentialId();
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) =>
          (await client.query(`select * from pad_resume_issue($1, $2, $3)`,
                              [req.params.id, padIdHash(raw, secret), JSON.stringify(jwk)])).rows[0]);
        if (!r?.ok) { res.json({ ok: false, reason: r?.reason ?? "refused" }); return; }
        res.json({ ok: true, credential: raw, expiresAt: r.expires_at, serverTime: now() });
      } catch (/** @type {any} */ e) {
        if (e.code === "22P02") { res.status(404).json({ error: "no_such_match" }); return; }
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },

    // POST /matches/:id/pad-credentials/revoke { userId? }  — the school office
    revoke: async (req, res) => {
      try {
        const userId = req.body?.userId ?? null;
        const r = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) =>
          (await client.query(`select * from pad_resume_revoke($1, $2)`, [req.params.id, userId])).rows[0]);
        if (!r?.ok) { res.status(403).json({ error: r?.reason ?? "not_permitted" }); return; }
        res.json({ ok: true, revoked: r.revoked });
      } catch (/** @type {any} */ e) {
        if (e.code === "22P02") { res.status(404).json({ error: "no_such_match" }); return; }
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },

    // POST /api/auth/sign-out — this person's credentials on this device end.
    // The client also forgets its keys, which ends them on the device even
    // when this request cannot reach the server.
    signOut: async (_body, req) => {
      const n = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) =>
        (await client.query(`select pad_resume_sign_out() as n`)).rows[0]?.n ?? 0);
      return { ok: true, revoked: n };
    },
  };
}

/**
 * The answer to a refused pad request: the code, why (a revocation's reason),
 * and — for a stale proof — the server's clock.
 * @param {any} e
 */
export function padRefusal(e) {
  return {
    status: e?.status || 500,
    body: { error: e?.code || e?.message || "internal_error",
            ...(e?.detail != null ? { detail: e.detail } : {}),
            ...(e?.serverTime != null ? { serverTime: e.serverTime } : {}) },
  };
}

