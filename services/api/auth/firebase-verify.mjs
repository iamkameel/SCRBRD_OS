/**
 * SCRBRD — verifying a Firebase ID token, with no firebase-admin (SCRBRD-140 D2).
 *
 * A Firebase ID token is Google's signed statement that this browser is
 * signed into Google account <sub>, whose email <email> Google verified. The
 * exchange (signin-api.mjs) believes that and nothing more: who <sub> is on
 * SCRBRD is auth_identity (db/81), and what they may do is role_assignment.
 * The token is used once, at the exchange, and is never our session.
 *
 * Every check in the design's §2.3 table is one refusal here, by name, and
 * firebase-verify.test.mjs signs a token that fails each one:
 *
 *   malformed_token        not three base64url parts of JSON
 *   bad_algorithm          header alg is not exactly RS256 — refused before
 *                          any key is chosen, so `none` and HS256-with-the-
 *                          public-key never reach a verifier
 *   missing_kid            no key id in the header
 *   unknown_kid            not one of Google's current keys, after one refetch
 *   keys_unavailable (503) no key set could be fetched and none is cached:
 *                          fail closed, never "skip the signature"
 *   bad_signature          RS256 over header.payload does not verify
 *   bad_issuer             iss is not https://securetoken.google.com/<project>
 *   bad_audience           aud is not <project>
 *   token_expired          exp <= now
 *   issued_in_future       iat > now + 60 s
 *   bad_auth_time          auth_time missing, or > now + 60 s
 *   missing_subject        sub empty, not a string, or over 128 characters
 *   missing_email          no email
 *   email_unverified       email_verified is not exactly true — an unverified
 *                          address matches nothing and creates nothing
 *   provider_not_allowed   firebase.sign_in_provider not on the allow-list
 *                          (google.com in phase 1)
 *   stale_sign_in          asked for a fresh sign-in (a link or a claim, §3.4)
 *                          and auth_time is older than that
 *
 * The sixty seconds of skew on iat and auth_time are the one allowance: a
 * server clock a little behind Google's would otherwise refuse every fresh
 * sign-in. exp gets none.
 *
 * KEYS. Google's current public keys, as JWKs, from the securetoken service
 * account; cached for the response's Cache-Control max-age. A token naming a
 * key id the cache does not hold refetches once and then refuses — and a
 * refetch is not done more than once a minute, so a stream of invented key
 * ids cannot turn this server into a stream of requests to Google. The
 * fetcher is injected: tests never touch the network, and the walk
 * (tools/smoke-signup.mjs) hands the server a key of its own through
 * FIREBASE_TEST_KEYS, which server.mjs accepts only outside production and
 * only for a project that is not the real one.
 */
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { AuthError } from "./auth.mjs";
/** @import { KeyObject } from "node:crypto" */

/** The one project firebase.js names (A1). */
export const FIREBASE_PROJECT = "scrbrd-os";
/** Phase 1 (D8: Microsoft, then email-link, in phase 3). */
export const ALLOWED_PROVIDERS = Object.freeze(["google.com"]);
/** A link or a claim needs a sign-in this recent (§2.3). */
export const FRESH_SEC = 5 * 60;
export const SKEW_SEC = 60;
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MIN_REFETCH_MS = 60_000;
const DEFAULT_MAX_AGE_SEC = 3600;

/**
 * What a key fetch answers: the keys by kid, and how long they may be kept.
 * @typedef {{ keys: Map<string, KeyObject>, maxAgeSec: number }} KeySet
 */

/**
 * What a verified token tells us, and all we keep (§7.4): never the picture,
 * never `firebase.identities`.
 * @typedef {{ uid: string, email: string, name: string | null, provider: string, authTime: number }} FirebaseIdentity
 */

export class FirebaseAuthError extends AuthError {
  /** @param {string} code @param {number} [status] */
  constructor(code, status = 401) { super(code); this.name = "FirebaseAuthError"; this.status = status; }
}

const fromB64url = (/** @type {string} */ s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const B64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Google's keys, over HTTPS, as a KeySet. Throws on anything but a 200 with
 * a usable key in it.
 * @param {string} [url]
 * @returns {Promise<KeySet>}
 */
export async function fetchGoogleKeys(url = GOOGLE_JWKS_URL) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`key fetch answered ${res.status}`);
  const body = /** @type {{ keys?: any[] }} */ (await res.json());
  const keys = keysFromJwks(body);
  const m = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  return { keys, maxAgeSec: m ? Number(m[1]) : DEFAULT_MAX_AGE_SEC };
}

/**
 * A JWK set → kid → KeyObject, RSA signing keys only.
 * @param {{ keys?: any[] }} jwks
 * @returns {Map<string, KeyObject>}
 */
export function keysFromJwks(jwks) {
  /** @type {Map<string, KeyObject>} */
  const out = new Map();
  for (const k of jwks?.keys ?? []) {
    if (!k || k.kty !== "RSA" || typeof k.kid !== "string" || (k.alg && k.alg !== "RS256") || (k.use && k.use !== "sig")) continue;
    try { out.set(k.kid, createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" })); } catch { /* not a key */ }
  }
  if (!out.size) throw new Error("no usable key in the set");
  return out;
}

/**
 * A verifier for one project.
 * @param {{
 *   projectId?: string,
 *   fetchKeys?: () => Promise<KeySet>,
 *   now?: () => number,
 *   providers?: readonly string[],
 * }} [opts]
 */
export function firebaseVerifier({ projectId = FIREBASE_PROJECT, fetchKeys = fetchGoogleKeys, now = Date.now, providers = ALLOWED_PROVIDERS } = {}) {
  if (!projectId) throw new Error("firebaseVerifier: a project id is required");
  const issuer = `https://securetoken.google.com/${projectId}`;
  /** @type {{ keys: Map<string, KeyObject>, until: number } | null} */
  let cache = null;
  let lastFetch = -Infinity;
  /** @type {Promise<void> | null} */
  let inflight = null;

  const refresh = async () => {
    if (inflight) return inflight;
    inflight = (async () => {
      lastFetch = now();
      try {
        const set = await fetchKeys();
        cache = { keys: set.keys, until: now() + Math.max(0, set.maxAgeSec) * 1000 };
      } finally { inflight = null; }
    })();
    return inflight;
  };

  /** @param {string} kid @returns {Promise<KeyObject>} */
  const keyFor = async (kid) => {
    let fetched = false;
    if (!cache || cache.until <= now()) {
      try { await refresh(); fetched = true; } catch { /* a stale cache still answers below; none at all is a 503 */ }
      if (!cache) throw new FirebaseAuthError("keys_unavailable", 503);
    }
    const c1 = /** @type {{ keys: Map<string, KeyObject> }} */ (cache);
    const hit = c1.keys.get(kid);
    if (hit) return hit;
    // An unknown kid: Google may have rotated. Once, and not more than once a minute.
    if (!fetched && now() - lastFetch >= MIN_REFETCH_MS) {
      try { await refresh(); } catch { /* fall through to the refusal */ }
      const again = /** @type {{ keys: Map<string, KeyObject> }} */ (cache).keys.get(kid);
      if (again) return again;
    }
    throw new FirebaseAuthError("unknown_kid");
  };

  return {
    projectId,
    /**
     * Verify one ID token. `freshSec` asks that the sign-in itself be that
     * recent (a link or a claim). Throws a FirebaseAuthError naming the check.
     * @param {unknown} token
     * @param {{ freshSec?: number }} [opts]
     * @returns {Promise<FirebaseIdentity>}
     */
    async verify(token, { freshSec } = {}) {
      if (typeof token !== "string" || token.length > 8192) throw new FirebaseAuthError("malformed_token");
      const parts = token.split(".");
      if (parts.length !== 3 || !parts.every((p) => B64URL.test(p))) throw new FirebaseAuthError("malformed_token");
      /** @type {any} */ let header;
      /** @type {any} */ let claims;
      try {
        header = JSON.parse(fromB64url(parts[0]).toString("utf8"));
        claims = JSON.parse(fromB64url(parts[1]).toString("utf8"));
      } catch { throw new FirebaseAuthError("malformed_token"); }
      if (!header || typeof header !== "object" || !claims || typeof claims !== "object") throw new FirebaseAuthError("malformed_token");
      if (header.alg !== "RS256") throw new FirebaseAuthError("bad_algorithm");
      if (typeof header.kid !== "string" || !header.kid) throw new FirebaseAuthError("missing_kid");

      const key = await keyFor(header.kid);
      const good = verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, fromB64url(parts[2]));
      if (!good) throw new FirebaseAuthError("bad_signature");

      const t = Math.floor(now() / 1000);
      if (claims.iss !== issuer) throw new FirebaseAuthError("bad_issuer");
      if (claims.aud !== projectId) throw new FirebaseAuthError("bad_audience");
      if (typeof claims.exp !== "number" || claims.exp <= t) throw new FirebaseAuthError("token_expired");
      if (typeof claims.iat !== "number" || claims.iat > t + SKEW_SEC) throw new FirebaseAuthError("issued_in_future");
      if (typeof claims.auth_time !== "number" || claims.auth_time > t + SKEW_SEC) throw new FirebaseAuthError("bad_auth_time");
      if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) throw new FirebaseAuthError("missing_subject");
      if (typeof claims.email !== "string" || !claims.email) throw new FirebaseAuthError("missing_email");
      if (claims.email_verified !== true) throw new FirebaseAuthError("email_unverified");
      const provider = claims.firebase?.sign_in_provider;
      if (typeof provider !== "string" || !providers.includes(provider)) throw new FirebaseAuthError("provider_not_allowed");
      if (freshSec !== undefined && t - claims.auth_time > freshSec) throw new FirebaseAuthError("stale_sign_in");

      return {
        uid: claims.sub,
        email: claims.email,
        name: typeof claims.name === "string" ? claims.name : null,
        provider,
        authTime: claims.auth_time,
      };
    },
  };
}

/** @typedef {ReturnType<typeof firebaseVerifier>} FirebaseVerifier */
