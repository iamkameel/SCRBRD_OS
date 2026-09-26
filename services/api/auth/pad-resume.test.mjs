/**
 * The pad's resume credential: signing (packages/sync pad-proof.mjs, the
 * device's half, run here on node's WebCrypto) against verification
 * (pad-resume.mjs, the server's half), with a fake database behind it.
 *
 * Every refusal the credential has is named once, with the request that
 * earns it: a replayed jti, a stale timestamp either side, the wrong key, the
 * wrong match, the wrong device, an expired or revoked credential, a request
 * the proof does not describe, a malformed one — and the scope escape, as a
 * signed request to every route server.mjs mounts (tools/mounted-routes.mjs
 * reads them out of the dispatcher, so a route added later is walked too).
 * tools/smoke-pad-resume.mjs proves the same against Postgres and the real
 * server; db/99 §28 proves the database's half.
 */
import { readFileSync } from "node:fs";
import {
  PAD, PAD_ROUTES, padRoute, isPadAuthorization, padIdHash, padBodyHash, publicJwkOf,
  parsePadProof, checkPadProof, padPrincipal, padRefusal, newPadCredentialId,
} from "./pad-resume.mjs";
import { newPadKeyPair, padPublicJwk, padProof, padAuthorization, newJti } from "@scrbrd/sync";
import { sessionConfigStatements, withPrincipal, magicHash } from "./auth.mjs";
import { runAsPrincipal } from "./auth-db.mjs";
import { appendEvents } from "../write/events-api.mjs";
import { mountedRoutes } from "../../../tools/mounted-routes.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 200)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SECRET = "pad-resume-test-secret";
const MATCH = "77777777-0000-0000-0000-000000000002";
const OTHER = "77777777-0000-0000-0000-000000000003";
const CID = newPadCredentialId();
const DEVICE = "dev-pad-a";
const pair = await newPadKeyPair();
const jwk = await padPublicJwk(pair);
const thief = await newPadKeyPair();          // another device's key

/**
 * A database with one credential in it. `ended` is what pad_resume_ended()
 * would say; spend() remembers every jti it has been given.
 * @param {{ ended?: string | null, spendEnded?: string | null }} [o]
 */
function fakePool({ ended = null, spendEnded = null } = {}) {
  const seen = new Set();
  /** @type {{ text: string, params: any[] }[]} */
  const log = [];
  return {
    log, seen,
    /** @param {string} text @param {any[]} params */
    query: async (text, params) => {
      log.push({ text, params });
      if (/pad_resume_lookup/.test(text)) {
        if (params[0] !== padIdHash(CID, SECRET)) return { rows: [] };
        return { rows: [{ credential: "c-1", user_id: "u-scorer", device_id: DEVICE, match_id: MATCH,
                          public_jwk: jwk, expires_at: new Date(Date.now() + 3600e3), ended }] };
      }
      if (/pad_resume_spend/.test(text)) {
        if (spendEnded) return { rows: [{ ok: false, reason: spendEnded }] };
        if (seen.has(params[1])) return { rows: [{ ok: false, reason: "replay" }] };
        seen.add(params[1]);
        return { rows: [{ ok: true, reason: null }] };
      }
      return { rows: [] };
    },
  };
}

/**
 * A signed request, as the dispatcher would hand it to padPrincipal().
 * @param {object} [o]
 * @param {string} [o.method] @param {string} [o.path] @param {string} [o.body]
 * @param {number} [o.now] @param {CryptoKey} [o.key] @param {string} [o.cid] @param {string} [o.jti]
 * @param {string} [o.sentMethod] @param {string} [o.sentPath] @param {string} [o.sentBody] @param {string} [o.matchId]
 */
async function signed({ method = "POST", path = `/api/matches/${MATCH}/events`, body = '{"events":[]}', now = Date.now(),
                        key = pair.privateKey, cid = CID, jti, sentMethod, sentPath, sentBody, matchId = MATCH } = {}) {
  const proof = await padProof({ credentialId: cid, privateKey: key, method, path, bodyText: body, now, ...(jti ? { jti } : {}) });
  return {
    authorization: padAuthorization(proof), method: sentMethod ?? method, target: sentPath ?? path,
    rawBody: Buffer.from(sentBody ?? body), matchId,
  };
}
/** What padPrincipal() refused with, or "ok". @param {any} pool @param {any} req */
const outcome = async (pool, req) => {
  try { await padPrincipal({ pool, secret: SECRET, ...req }); return "ok"; }
  catch (/** @type {any} */ e) { return `${e.status} ${e.code}${e.detail ? ` ${e.detail}` : ""}`; }
};

// ── The format ──
group("A. The device signs, the server verifies: one credential, one match, one device");
{
  const pool = fakePool();
  const req = await signed();
  const p = await padPrincipal({ pool, secret: SECRET, ...req });
  ok("a proof from the device's key is accepted", p.userId === "u-scorer" && p.deviceId === DEVICE);
  ok("...as a pad-scoped principal for its match", p.scope === "pad" && p.matchId === MATCH && p.credentialId === "c-1");
  ok("the scheme is recognised", isPadAuthorization(req.authorization) && !isPadAuthorization("Bearer x.y.z"));
  ok("the id is looked up by its keyed hash, never sent to the database",
     pool.log.every((l) => !JSON.stringify(l.params).includes(CID)));
  const parsed = parsePadProof(req.authorization);
  ok("the proof carries method, path, body hash, time and a one-time id",
     parsed.payload.htm === "POST" && parsed.payload.htu === `/api/matches/${MATCH}/events`
     && parsed.payload.bh === padBodyHash('{"events":[]}') && Number.isInteger(parsed.payload.iat)
     && /^[A-Za-z0-9_-]{16,64}$/.test(parsed.payload.jti));
  ok("ES256 with a raw 64-byte signature (WebCrypto's own form)", parsed.signature.length === 64);
  let exported = true;
  try { await globalThis.crypto.subtle.exportKey("jwk", pair.privateKey); } catch { exported = false; }
  ok("the private key cannot be exported", !exported && pair.privateKey.extractable === false);
  ok("the public key sent at issue is exactly kty, crv, x, y", Object.keys(jwk).sort().join(",") === "crv,kty,x,y");
}

group("B. A replayed jti is refused");
{
  const pool = fakePool();
  const req = await signed();
  ok("the first use is accepted", (await outcome(pool, req)) === "ok");
  const second = await outcome(pool, req);
  ok("the same request again is pad_replay", second === "401 pad_replay", second);
  const again = await signed({ jti: parsePadProof(req.authorization).payload.jti });
  ok("a fresh signature over a spent jti is pad_replay too", (await outcome(pool, again)) === "401 pad_replay");
  ok("a new jti is fine", (await outcome(pool, await signed())) === "ok");
}

group("C. A stale timestamp is refused, with the server's time to correct by");
{
  const pool = fakePool();
  let err = /** @type {any} */ (null);
  const stale = await signed({ now: Date.now() - 5 * 60e3 });
  try { await padPrincipal({ pool, secret: SECRET, ...stale }); } catch (e) { err = e; }
  ok("five minutes behind: pad_stale", err?.code === "pad_stale" && err?.status === 401);
  ok("...answered with the server's clock", typeof padRefusal(err).body.serverTime === "number"
     && Math.abs(padRefusal(err).body.serverTime - Date.now()) < 5000);
  ok("five minutes ahead: pad_stale", (await outcome(pool, await signed({ now: Date.now() + 5 * 60e3 }))) === "401 pad_stale");
  ok(`within ${PAD.windowSec} s either way: accepted`,
     (await outcome(pool, await signed({ now: Date.now() - 90e3 }))) === "ok"
     && (await outcome(pool, await signed({ now: Date.now() + 90e3 }))) === "ok");
  ok("a stale proof spends no jti", !pool.seen.has(parsePadProof(stale.authorization).payload.jti));
}

group("D. The wrong key is refused — a copied credential is useless off the device");
{
  const pool = fakePool();
  ok("the right id signed by another device's key: pad_bad_signature",
     (await outcome(pool, await signed({ key: thief.privateKey }))) === "401 pad_bad_signature");
  const revoked = fakePool({ ended: "token_moved" });
  ok("...and it learns nothing about the credential's state (signature first)",
     (await outcome(revoked, await signed({ key: thief.privateKey }))) === "401 pad_bad_signature");
  ok("an id nobody issued: pad_unknown", (await outcome(pool, await signed({ cid: newPadCredentialId() }))) === "401 pad_unknown");
  ok("nothing was spent for either", !pool.log.some((l) => /pad_resume_spend/.test(l.text)));
}

group("E. The wrong match is refused");
{
  const pool = fakePool();
  ok("a proof for another match's events, from the right key: 403 pad_scope",
     (await outcome(pool, await signed({ path: `/api/matches/${OTHER}/events`, matchId: OTHER }))) === "403 pad_scope");
  ok("...and nothing was spent", !pool.log.some((l) => /pad_resume_spend/.test(l.text)));
}

group("F. The wrong device: the device is the credential's, and a batch naming another is refused");
{
  const p = await padPrincipal({ pool: fakePool(), secret: SECRET, ...(await signed()) });
  ok("the principal's device comes from the credential, not the request", p.deviceId === DEVICE);
  /** @type {string[]} */
  const seen = [];
  const client = { query: async (/** @type {string} */ t) => { seen.push(t); return { rows: [] }; }, release() {} };
  const pool = /** @type {any} */ ({ connect: async () => client });
  const ev = (/** @type {string} */ dev) => ({ epoch: 1, deviceId: dev, clientSeq: 1, idempotencyKey: `${dev}:1:1`, payload: { kind: "ball", type: "run", value: 1 } });
  /** @type {any} */ let err = null;
  try { await appendEvents(pool, SECRET, p, MATCH, [ev("dev-other")]); } catch (e) { err = e; }
  ok("a batch naming another device, sent with the credential: 403 device_mismatch", err?.status === 403 && err?.message === "device_mismatch");
  ok("...before the lease is asked about", !seen.some((t) => /scoring_lease_check/.test(t)));
  ok("...and the transaction ran as the pad principal, then rolled back",
     seen.some((t) => /app\.scope/.test(t)) && seen.includes("ROLLBACK"));
}

group("G. An expired or revoked credential is refused, and says why");
{
  ok("expired (the match day is over): pad_expired",
     (await outcome(fakePool({ ended: "expired" }), await signed())) === "401 pad_expired expired");
  for (const why of ["token_moved", "released", "match_complete", "signed_out", "office", "reissued"])
    ok(`revoked (${why}): pad_revoked ${why}`, (await outcome(fakePool({ ended: why }), await signed())) === `401 pad_revoked ${why}`);
  ok("revoked between the lookup and the spend: pad_revoked",
     (await outcome(fakePool({ spendEnded: "office" }), await signed())) === "401 pad_revoked office");
  ok("expired between the lookup and the spend: pad_expired",
     (await outcome(fakePool({ spendEnded: "expired" }), await signed())) === "401 pad_expired expired");
}

group("H. The proof is for exactly one request");
{
  const pool = fakePool();
  ok("signed for GET, sent as POST: pad_wrong_request",
     (await outcome(pool, await signed({ method: "GET", body: "", sentMethod: "POST" }))) === "401 pad_wrong_request");
  ok("signed for one path, sent to another: pad_wrong_request",
     (await outcome(pool, await signed({ sentPath: `/api/matches/${MATCH}/events?since=4` }))) === "401 pad_wrong_request");
  ok("the body changed on the way: pad_wrong_request",
     (await outcome(pool, await signed({ sentBody: '{"events":[{"x":1}]}' }))) === "401 pad_wrong_request");
  ok("not a JWS: pad_malformed", (await outcome(pool, { authorization: "ScrbrdPad not-a-proof", method: "GET",
     target: `/api/matches/${MATCH}/events`, rawBody: Buffer.alloc(0), matchId: MATCH })) === "401 pad_malformed");
  const req = await signed();
  const [h, pl, s] = req.authorization.slice(10).split(".");
  const none = Buffer.from(JSON.stringify({ alg: "none", typ: PAD.typ })).toString("base64url");
  ok("alg none: pad_malformed", (await outcome(pool, { ...req, authorization: `ScrbrdPad ${none}.${pl}.${s}` })) === "401 pad_malformed");
  const hs = Buffer.from(JSON.stringify({ alg: "HS256", typ: PAD.typ })).toString("base64url");
  ok("alg HS256 (a key the attacker picks): pad_malformed", (await outcome(pool, { ...req, authorization: `ScrbrdPad ${hs}.${pl}.${s}` })) === "401 pad_malformed");
  ok("a short jti: pad_malformed", (await outcome(pool, await signed({ jti: "short" }))) === "401 pad_malformed");
  ok("the header as signed verifies (control)", (await outcome(pool, { ...req, authorization: `ScrbrdPad ${h}.${pl}.${s}` })) === "ok");
  ok("checkPadProof alone: the wrong body hash is caught without the database",
     checkPadProof({ proof: parsePadProof(req.authorization), jwk, method: "POST", target: `/api/matches/${MATCH}/events`,
                     bodyHash: padBodyHash("{}"), nowSec: Math.floor(Date.now() / 1000) }) === "pad_wrong_request");
  ok("newJti() is 22 base64url characters of randomness", /^[A-Za-z0-9_-]{22}$/.test(newJti()) && newJti() !== newJti());
}

group("I. The scope escape: a signed request reaches five routes, on its own match, and nothing else");
{
  const routes = mountedRoutes({ id: MATCH, resources: ["players", "injuries", "matches", "notes", "emergency_contacts",
                                                        "disciplinary_records", "users", "assignments", "trip_contacts"] });
  const allowed = new Set(PAD_ROUTES.map(([m, re]) => `${m} ${re.source}`));
  const reached = routes.filter((r) => padRoute(r.method, r.path));
  ok(`the dispatcher mounts ${routes.length} routes (read from server.mjs)`, routes.length >= 90);
  ok("exactly five of them admit a credential",
     reached.length === 5 && reached.every((r) => [...allowed].some((a) => a.startsWith(`${r.method} `))), reached.map((r) => `${r.method} ${r.path}`).join(", "));
  ok("...the heartbeat, the claim, the events both ways and the toss",
     ["POST /session/heartbeat", "POST /session/claim", "POST /events", "GET /events", "GET /toss"]
       .every((w) => reached.some((r) => `${r.method} ${r.path}`.endsWith(w.split(" ")[1]) && r.method === w.split(" ")[0])));
  for (const r of routes.filter((x) => !padRoute(x.method, x.path)))
    ok(`${r.method} ${r.path} refuses a credential`, padRoute(r.method, r.path) === null);
  ok("pupils (/api/read/players), medical (/api/read/injuries): refused",
     padRoute("GET", "/api/read/players") === null && padRoute("GET", "/api/read/injuries") === null);
  ok("another match's log reaches the gate, and the gate says it is not the credential's",
     padRoute("GET", `/api/matches/${OTHER}/events`)?.matchId === OTHER);
  ok("the toss may be read and not written", padRoute("GET", `/api/matches/${MATCH}/toss`) != null && padRoute("POST", `/api/matches/${MATCH}/toss`) === null);
  ok("a handover, a force-release, a quarantine, a squad: refused",
     ["session/handover/arm", "session/handover/claim", "session/handover/verify", "session/force-release", "squad", "amendments"]
       .every((p) => padRoute("POST", `/api/matches/${MATCH}/${p}`) === null) && padRoute("GET", `/api/matches/${MATCH}/quarantine`) === null);
  ok("a credential cannot mint another (the issue route refuses it)", padRoute("POST", `/api/matches/${MATCH}/session/pad-credential`) === null);

  // The dispatcher asks first: the scheme is checked before /api/health and
  // every table, and a refused route is answered before a body is read.
  const src = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("const server = createServer("));
  ok("server.mjs sends a credential to servePad() before any other route is matched",
     body.indexOf("isPadAuthorization(req.headers.authorization)") > 0
     && body.indexOf("isPadAuthorization(req.headers.authorization)") < body.indexOf('"/api/health"'));
  const serve = src.slice(src.indexOf("async function servePad("), src.indexOf("const server = createServer("));
  ok("servePad() refuses an unlisted route before reading the body or looking anything up",
     serve.indexOf('{ error: "pad_scope" }') > 0 && serve.indexOf('{ error: "pad_scope" }') < serve.indexOf("readRaw(")
     && serve.indexOf('{ error: "pad_scope" }') < serve.indexOf("padPrincipal("));
  ok("...and hands the handler no Authorization header", /authorization: undefined/.test(serve));
}

group("J. The principal the database is given");
{
  const s = sessionConfigStatements({ userId: "u-scorer", deviceId: DEVICE, scope: "pad", matchId: MATCH });
  const vars = s.map((x) => x.text.match(/'app\.\w+'/)?.[0]);
  ok("a pad principal sets four app.* vars: user, device, scope, match",
     vars.join(",") === "'app.user_id','app.device_id','app.scope','app.match_id'" && s[2].params[0] === "pad" && s[3].params[0] === MATCH);
  ok("...every one transaction-local", s.every((x) => /, true\)$/.test(x.text)));
  let threw = false;
  try { sessionConfigStatements({ userId: "u", deviceId: "d", scope: "pad" }); } catch { threw = true; }
  ok("a pad scope with no match is refused, not sent empty", threw);
  ok("an ordinary principal sets no scope", sessionConfigStatements({ userId: "u", deviceId: "d" }).length === 2);

  // One connection, a pad request then an ordinary one: the second carries
  // no scope, because the first's was local to its transaction.
  /** @type {{ text: string, params?: any[] }[]} */
  const log = [];
  const client = { query: async (/** @type {string} */ text, /** @type {any[]} */ params) => { log.push({ text, params }); return { rows: [] }; } };
  await withPrincipal(client, { userId: "u", deviceId: "d", scope: "pad", matchId: MATCH }, async () => {});
  const second = log.length;
  await withPrincipal(client, { userId: "u2", deviceId: "d2" }, async () => {});
  ok("a request after a pad one on the same connection sets no scope",
     !log.slice(second).some((l) => /app\.scope|app\.match_id/.test(l.text)) && log.slice(0, second).some((l) => /app\.scope/.test(l.text)));

  // runAsPrincipal takes an object only when it is a pad principal: nothing
  // else may skip the token.
  const pool = /** @type {any} */ ({ connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) });
  /** @type {any[]} */ const refused = [];
  for (const p of [{ userId: "u", deviceId: "d" }, { userId: "u", deviceId: "d", scope: "pad" },
                   { userId: null, deviceId: "d", scope: "pad", matchId: MATCH }, { scope: "admin", userId: "u", deviceId: "d", matchId: MATCH }]) {
    try { await runAsPrincipal(pool, SECRET, /** @type {any} */ (p), async () => {}); refused.push(false); } catch { refused.push(true); }
  }
  ok("runAsPrincipal refuses an object that is not a whole pad principal", refused.every(Boolean), JSON.stringify(refused));
}

group("K. Keys and ids");
{
  ok("the device's public key is accepted", publicJwkOf(jwk) != null);
  ok("...with its private part: refused", publicJwkOf({ ...jwk, d: "870MB6gfuTJ4HtUnUvYMyJpr5eUZNP4Bk43bVdj3eAE" }) === null);
  ok("...on another curve: refused", publicJwkOf({ ...jwk, crv: "P-384" }) === null);
  ok("...a point that is not on the curve: refused",
     publicJwkOf({ kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) }) === null);
  ok("...extra members are dropped, not stored", Object.keys(publicJwkOf({ ...jwk, ext: true, key_ops: ["verify"] }) ?? {}).length === 4);
  ok("the stored hash is keyed: another secret gives another hash", padIdHash(CID, SECRET) !== padIdHash(CID, "other"));
  ok("...and domain-separated from a login code's", padIdHash(CID, SECRET) !== magicHash(CID, SECRET));
  ok("ids are 256 bits of randomness", Buffer.from(newPadCredentialId(), "base64url").length === 32 && newPadCredentialId() !== newPadCredentialId());
}

console.log(`\n${"─".repeat(52)}\nPAD RESUME SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
