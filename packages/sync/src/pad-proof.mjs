/**
 * SCRBRD — the pad's resume credential, on the device (SCRBRD-078 option B).
 *
 * A reloaded pad, or one whose thirty-minute sign-in has run out, keeps
 * scoring its match and sending by itself: it signs each request to its
 * match's five routes with a key only this device has. The server's half —
 * the format, what each field binds, and what the credential may reach — is
 * services/api/auth/pad-resume.mjs; this is the other side of the same
 * format, and the two are held to each other by
 * services/api/auth/pad-resume.test.mjs, which signs here and verifies there.
 *
 * THE KEY. An ECDSA P-256 pair made by WebCrypto with extractable = false:
 * the private key can sign, in this origin, and can never be read out — not
 * by the page, not by an injected script, not by a copy of the browser's
 * storage (a CryptoKey is stored in IndexedDB as a handle, not as bytes). Its
 * public half is sent once, when the credential is issued.
 *
 * WebCrypto needs a secure context (https, or localhost). Where there is none
 * — a laptop serving the app over plain http at a ground — padCryptoAvailable()
 * says so and the pad signs in as it always has, and says that too.
 *
 * Pure over globalThis.crypto: it runs in the browser and in node (22+), and
 * holds nothing. Where the key is kept is apps/web/src/lib/padKey.js.
 */

export const PAD_SCHEME = "ScrbrdPad";
export const PAD_TYP = "scrbrd-pad+jwt";
const KEY_ALG = /** @type {EcKeyGenParams} */ ({ name: "ECDSA", namedCurve: "P-256" });
const SIGN_ALG = /** @type {EcdsaParams} */ ({ name: "ECDSA", hash: "SHA-256" });

/** The WebCrypto this pad would sign with, or null. */
function subtle() {
  const c = globalThis.crypto;
  return c && c.subtle && typeof c.getRandomValues === "function" ? c.subtle : null;
}

/**
 * Can this page hold a resume credential? WebCrypto is only exposed to a
 * secure context, and IndexedDB has to be there to keep the key.
 * @returns {boolean}
 */
export function padCryptoAvailable() {
  const g = /** @type {any} */ (globalThis);
  if (g.isSecureContext === false) return false;
  return subtle() != null;
}

/** @param {Uint8Array} bytes */
function b64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const utf8 = (/** @type {string} */ s) => new TextEncoder().encode(s);

/**
 * A new key pair: the private key can sign and can never be exported.
 * @returns {Promise<CryptoKeyPair>}
 */
export async function newPadKeyPair() {
  const s = subtle();
  if (!s) throw new Error("pad_crypto_unavailable");
  return /** @type {CryptoKeyPair} */ (await s.generateKey(KEY_ALG, false, ["sign", "verify"]));
}

/**
 * The public key as the server stores it: exactly kty, crv, x and y.
 * @param {CryptoKeyPair} pair
 * @returns {Promise<{kty: string, crv: string, x: string, y: string}>}
 */
export async function padPublicJwk(pair) {
  const s = subtle();
  if (!s) throw new Error("pad_crypto_unavailable");
  const j = await s.exportKey("jwk", pair.publicKey);
  return { kty: String(j.kty), crv: String(j.crv), x: String(j.x), y: String(j.y) };
}

/** 16 random bytes, base64url: a proof's one-time id. */
export function newJti() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return b64url(b);
}

/**
 * base64url SHA-256 of a body's exact text ("" for none): what `bh` binds.
 * @param {string} [text]
 */
export async function padBodyHash(text = "") {
  const s = subtle();
  if (!s) throw new Error("pad_crypto_unavailable");
  return b64url(new Uint8Array(await s.digest("SHA-256", utf8(text))));
}

/**
 * The proof for one request: a compact JWS over method, path and query, the
 * body's hash, a time and a one-time id, signed by the device's key.
 * @param {object} a
 * @param {string} a.credentialId   the id the server issued, as it issued it
 * @param {CryptoKey} a.privateKey
 * @param {string} a.method
 * @param {string} a.path           the path and query exactly as requested (no origin)
 * @param {string} [a.bodyText]     the exact body text sent, if any
 * @param {number} [a.now]          ms, already corrected by the server's clock offset
 * @param {string} [a.jti]
 * @returns {Promise<string>}
 */
export async function padProof({ credentialId, privateKey, method, path, bodyText = "", now = Date.now(), jti = newJti() }) {
  const s = subtle();
  if (!s) throw new Error("pad_crypto_unavailable");
  const header = { alg: "ES256", typ: PAD_TYP };
  const payload = {
    cid: credentialId, htm: method.toUpperCase(), htu: path,
    iat: Math.floor(now / 1000), jti, bh: await padBodyHash(bodyText),
  };
  const input = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await s.sign(SIGN_ALG, privateKey, utf8(input)));
  return `${input}.${b64url(sig)}`;
}

/** The Authorization header a proof travels in. @param {string} proof */
export const padAuthorization = (proof) => `${PAD_SCHEME} ${proof}`;
