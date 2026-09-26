/**
 * SCRBRD — the pad's resume credential, kept on this device (SCRBRD-078 option B).
 *
 * WHY IT EXISTS
 * ─────────────
 * The API token lives in memory (api.js says why) and lasts thirty minutes,
 * and a production sign-in is a one-time code from the school office. So a
 * pad that reloaded, or a match that ran past half an hour, stopped sending
 * until somebody fetched a new code. The product owner's answer (Kameel,
 * 2026-09-26): a reloaded — or unlocked and lost — phone keeps scoring its
 * match without the scorer re-entering anything, until the credential ends.
 *
 * WHAT IS KEPT, AND WHERE
 * ───────────────────────
 * One record per match, in IndexedDB (`scrbrd-pad` → `credentials`, keyed by
 * match): the credential id the server issued, this device's id, when it
 * ends, the offset between this phone's clock and the server's, and the
 * PRIVATE KEY — as a CryptoKey made with extractable = false. IndexedDB keeps
 * a CryptoKey as a handle the browser will use to sign and will never hand
 * back as bytes: not to this page, not to an injected script, not to a copy
 * of the profile. The id alone signs nothing (services/api/auth/pad-resume.mjs
 * verifies every request against the public key it was given at issue).
 *
 * What an injected script CAN do, while the page is open, is ask the browser
 * to sign with it — the honest limit of a non-extractable key. It can reach
 * this match's heartbeat, claim, events and toss until midnight, and nothing
 * else; the in-memory token it could already use reaches more.
 *
 * WHAT IT IS GOOD FOR: this match's five routes (PAD_ROUTES on the server),
 * and nothing else — every other request the app makes still needs a sign-in.
 * It is issued right after a claim made signed in, and it ends at midnight,
 * when the token moves, when the match ends, when this device signs out
 * (signOut() also forgets every key here), or when the school office revokes
 * it. It is never renewed by itself.
 *
 * Without WebCrypto — a page served over plain http, which is not a secure
 * context — there is no credential: the pad signs in as it always has, and
 * says so (padResumeSupported()).
 */
import { api } from "./api.js";
import { deviceId } from "./device.js";
// The subpath, not the package: the package's index re-exports the whole
// outbox (and through it the scoring engine), and session.js, which is in the
// entry chunk, imports this file. The signing module stands alone.
import { padCryptoAvailable, newPadKeyPair, padPublicJwk, padProof, padAuthorization } from "@scrbrd/sync/pad-proof";

const DB = "scrbrd-pad";
const STORE = "credentials";

/** Can this page hold a credential at all: a secure context with WebCrypto, and IndexedDB. */
export function padResumeSupported() {
  return typeof indexedDB !== "undefined" && padCryptoAvailable();
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** One transaction on the store; resolves with the request's result. */
async function inStore(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * This match's credential on this device, if there is one that has not ended
 * by the clock. (The server decides every other way it ends.)
 * @param {string} matchId
 */
export async function loadPadCredential(matchId) {
  if (!padResumeSupported()) return null;
  try {
    const rec = await inStore("readonly", (s) => s.get(matchId));
    if (!rec || rec.deviceId !== deviceId() || !(Date.parse(rec.expiresAt) > Date.now()) || !rec.privateKey) return null;
    return rec;
  } catch {
    return null;
  }
}

/**
 * Ask for a credential for this match, signed in, right after a claim: a new
 * key pair (the private half non-extractable), the public half sent once.
 * Null when the server says no (this device does not hold the token) or the
 * page cannot hold one.
 * @param {string} matchId
 */
export async function mintPadCredential(matchId) {
  if (!padResumeSupported()) return null;
  const pair = await newPadKeyPair();
  const jwk = await padPublicJwk(pair);
  const r = await api(`/api/matches/${matchId}/session/pad-credential`, { method: "POST", body: { jwk } });
  if (!r?.ok || !r.credential) return null;
  const rec = {
    matchId, deviceId: deviceId(), credential: r.credential, privateKey: pair.privateKey,
    expiresAt: r.expiresAt, offset: typeof r.serverTime === "number" ? r.serverTime - Date.now() : 0,
  };
  await inStore("readwrite", (s) => s.put(rec, matchId));
  return rec;
}

/** Forget this match's credential here: without the key, nothing can use it. @param {string} matchId */
export async function forgetPadCredential(matchId) {
  if (typeof indexedDB === "undefined") return;
  try { await inStore("readwrite", (s) => s.delete(matchId)); } catch { /* nothing kept */ }
}

/** Forget every credential on this device (signing out). */
export async function forgetAllPadCredentials() {
  if (typeof indexedDB === "undefined") return;
  try { await inStore("readwrite", (s) => s.clear()); } catch { /* nothing kept */ }
}

/**
 * Has the server said this credential no longer works? (Revoked, expired,
 * unknown, or a key it does not recognise.) A stale clock is not an ending:
 * padApi() corrects it and signs again.
 * @param {any} e
 */
export const padEnded = (e) => e?.name === "ApiError" && e.status === 401 && /^pad_/.test(e.code ?? "") && e.code !== "pad_stale";

/**
 * One request to this match's pad routes, signed with the credential over
 * exactly what is sent. A proof the server finds stale is answered with its
 * clock; the offset is kept and the request signed again, once.
 * @param {any} rec  loadPadCredential()'s or mintPadCredential()'s record
 * @param {string} path
 * @param {{method?: string, body?: any, timeoutMs?: number}} [opts]
 */
export async function padApi(rec, path, { method = "GET", body, timeoutMs } = {}) {
  const authorize = async (text) => padAuthorization(await padProof({
    credentialId: rec.credential, privateKey: rec.privateKey, method, path, bodyText: text,
    now: Date.now() + (rec.offset || 0),
  }));
  try {
    return await api(path, { method, body, timeoutMs, authorize });
  } catch (e) {
    if (e?.status === 401 && e.code === "pad_stale" && typeof e.serverTime === "number") {
      rec.offset = e.serverTime - Date.now();
      inStore("readwrite", (s) => s.put(rec, rec.matchId)).catch(() => {});
      return api(path, { method, body, timeoutMs, authorize });
    }
    throw e;
  }
}
