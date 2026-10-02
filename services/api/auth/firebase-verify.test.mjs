/**
 * The Firebase ID token verifier (SCRBRD-140 §2.3, D2): every refusal by
 * name, against tokens signed with a fixture RSA key. No test touches the
 * network — the key fetcher is a function handed in, and it counts its calls.
 *
 * The classic JWT mistakes each get a token: `none`, HS256 signed with the
 * public key as the secret, a key Google never published, another project's
 * token, an unverified email, a provider nobody allowed.
 */
import { generateKeyPairSync, createSign, createHmac } from "node:crypto";
import { firebaseVerifier, keysFromJwks, FRESH_SEC, FirebaseAuthError } from "./firebase-verify.mjs";
/** @import { KeySet } from "./firebase-verify.mjs" */

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const PROJECT = "scrbrd-os";
const T0 = 1_790_000_000;   // seconds; the verifier's clock starts here
let clock = T0 * 1000;
const now = () => clock;

const b64 = (/** @type {string | Buffer} */ s) => Buffer.from(s).toString("base64url");
const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkOf = (/** @type {import("node:crypto").KeyObject} */ k, /** @type {string} */ kid) =>
  ({ ...k.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" });

/** The fixture key set the fetcher serves; mutable, so a rotation can be staged. */
let served = { keys: [jwkOf(google.publicKey, "k1")] };
let fetches = 0;
let fetchFails = false;
/** @returns {Promise<KeySet>} */
const fetchKeys = async () => {
  fetches++;
  if (fetchFails) throw new Error("network down");
  return { keys: keysFromJwks(served), maxAgeSec: 600 };
};

/** Standard claims for a fresh Google sign-in, any of which a test overrides. */
const claims = (/** @type {Record<string, unknown>} */ over = {}) => ({
  iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT,
  sub: "uid-fixture-1", email: "parent@example.invalid", email_verified: true, name: "A Parent",
  picture: "https://example.invalid/photo.jpg",
  iat: T0 - 10, exp: T0 + 3600, auth_time: T0 - 10,
  firebase: { sign_in_provider: "google.com", identities: { "google.com": ["123"] } },
  ...over,
});
/** RS256 over header.payload with the key given. */
const sign = (/** @type {Record<string, unknown>} */ payload, { kid = "k1", key = google.privateKey, alg = "RS256" } = {}) => {
  const input = `${b64(JSON.stringify({ alg, kid, typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(key).toString("base64url")}`;
};

/** The refusal's code, or "accepted". */
const outcome = async (/** @type {ReturnType<typeof firebaseVerifier>} */ v, /** @type {unknown} */ token, /** @type {{ freshSec?: number }} */ opts = {}) => {
  try { await v.verify(token, opts); return "accepted"; }
  catch (/** @type {any} */ e) { return e instanceof FirebaseAuthError ? e.code : `threw:${e?.message}`; }
};
const fresh = () => firebaseVerifier({ projectId: PROJECT, fetchKeys, now });

group("A good token");
{
  const v = fresh();
  const id = await v.verify(sign(claims()));
  ok("is accepted", id.uid === "uid-fixture-1" && id.email === "parent@example.invalid" && id.provider === "google.com");
  ok("carries the uid, the email, the name and the auth time — and nothing else",
     JSON.stringify(Object.keys(id).sort()) === JSON.stringify(["authTime", "email", "name", "provider", "uid"]));
  ok("the picture is never kept", !JSON.stringify(id).includes("photo"));
  ok("a fresh sign-in passes the five-minute rule", (await outcome(v, sign(claims()), { freshSec: FRESH_SEC })) === "accepted");
}

group("Every refusal, by name");
{
  const v = fresh();
  ok("malformed_token: two parts", (await outcome(v, "a.b")) === "malformed_token");
  ok("malformed_token: not a string", (await outcome(v, 42)) === "malformed_token");
  ok("malformed_token: not JSON", (await outcome(v, `${b64("{")}.${b64("x")}.${b64("y")}`)) === "malformed_token");
  // alg none, unsigned: refused before any key is looked at.
  const none = `${b64(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64(JSON.stringify(claims()))}.`;
  ok("bad_algorithm: none (empty signature part)", ["bad_algorithm", "malformed_token"].includes(await outcome(v, none)));
  ok("bad_algorithm: none (signature part present)", (await outcome(v, none + "AA")) === "bad_algorithm");
  // HS256 keyed with the public key's PEM: the confusion attack.
  const pem = /** @type {string} */ (google.publicKey.export({ type: "spki", format: "pem" }));
  const hsInput = `${b64(JSON.stringify({ alg: "HS256", kid: "k1" }))}.${b64(JSON.stringify(claims()))}`;
  const hs = `${hsInput}.${createHmac("sha256", pem).update(hsInput).digest("base64url")}`;
  ok("bad_algorithm: HS256 with the public key as the secret", (await outcome(v, hs)) === "bad_algorithm");
  ok("bad_algorithm: RS512", (await outcome(v, sign(claims(), { alg: "RS512" }))) === "bad_algorithm");
  const noKid = `${b64(JSON.stringify({ alg: "RS256" }))}.${b64(JSON.stringify(claims()))}.AA`;
  ok("missing_kid", (await outcome(v, noKid)) === "missing_kid");
  ok("unknown_kid: a key Google never published", (await outcome(v, sign(claims(), { kid: "nope", key: stranger.privateKey }))) === "unknown_kid");
  ok("bad_signature: a stranger's key under Google's kid", (await outcome(v, sign(claims(), { key: stranger.privateKey }))) === "bad_signature");
  const good = sign(claims());
  const [h, , s] = good.split(".");
  ok("bad_signature: the payload changed after signing",
     (await outcome(v, `${h}.${b64(JSON.stringify(claims({ sub: "someone-else" })))}.${s}`)) === "bad_signature");
  ok("bad_issuer: another project's issuer", (await outcome(v, sign(claims({ iss: "https://securetoken.google.com/elsewhere" })))) === "bad_issuer");
  ok("bad_issuer: Google accounts, not securetoken", (await outcome(v, sign(claims({ iss: "https://accounts.google.com" })))) === "bad_issuer");
  ok("bad_audience: a token for another project", (await outcome(v, sign(claims({ aud: "elsewhere" })))) === "bad_audience");
  ok("bad_audience: an array is not the project", (await outcome(v, sign(claims({ aud: [PROJECT] })))) === "bad_audience");
  ok("token_expired: exp now", (await outcome(v, sign(claims({ exp: T0 })))) === "token_expired");
  ok("token_expired: no exp", (await outcome(v, sign(claims({ exp: undefined })))) === "token_expired");
  ok("issued_in_future: iat two minutes ahead", (await outcome(v, sign(claims({ iat: T0 + 120 })))) === "issued_in_future");
  ok("...but a clock thirty seconds behind Google's is allowed", (await outcome(v, sign(claims({ iat: T0 + 30, auth_time: T0 + 30 })))) === "accepted");
  ok("bad_auth_time: in the future", (await outcome(v, sign(claims({ auth_time: T0 + 120 })))) === "bad_auth_time");
  ok("bad_auth_time: missing", (await outcome(v, sign(claims({ auth_time: undefined })))) === "bad_auth_time");
  ok("missing_subject: empty", (await outcome(v, sign(claims({ sub: "" })))) === "missing_subject");
  ok("missing_subject: over 128 characters", (await outcome(v, sign(claims({ sub: "x".repeat(129) })))) === "missing_subject");
  ok("missing_email", (await outcome(v, sign(claims({ email: undefined })))) === "missing_email");
  ok("email_unverified: false", (await outcome(v, sign(claims({ email_verified: false })))) === "email_unverified");
  ok("email_unverified: the string \"true\" is not true", (await outcome(v, sign(claims({ email_verified: "true" })))) === "email_unverified");
  ok("provider_not_allowed: password", (await outcome(v, sign(claims({ firebase: { sign_in_provider: "password" } })))) === "provider_not_allowed");
  ok("provider_not_allowed: anonymous", (await outcome(v, sign(claims({ firebase: { sign_in_provider: "anonymous" } })))) === "provider_not_allowed");
  ok("provider_not_allowed: microsoft.com is phase 3", (await outcome(v, sign(claims({ firebase: { sign_in_provider: "microsoft.com" } })))) === "provider_not_allowed");
  ok("provider_not_allowed: none stated", (await outcome(v, sign(claims({ firebase: undefined })))) === "provider_not_allowed");
  ok("stale_sign_in: six minutes old, for a link", (await outcome(v, sign(claims({ auth_time: T0 - 360 })), { freshSec: FRESH_SEC })) === "stale_sign_in");
  ok("...the same token is good for a plain sign-in", (await outcome(v, sign(claims({ auth_time: T0 - 360 })))) === "accepted");
  // Another project's verifier refuses this project's token: the env switch is the project, not a flag.
  const other = firebaseVerifier({ projectId: "scrbrd-os-test", fetchKeys, now });
  ok("a verifier for the test project refuses the real project's token", (await outcome(other, sign(claims()))) === "bad_issuer");
  ok("a microsoft provider is accepted only where it is allowed",
     (await outcome(firebaseVerifier({ projectId: PROJECT, fetchKeys, now, providers: ["google.com", "microsoft.com"] }),
                    sign(claims({ firebase: { sign_in_provider: "microsoft.com" } })))) === "accepted");
}

group("The keys: cached, refetched once for an unknown kid, closed without them");
{
  fetches = 0; served = { keys: [jwkOf(google.publicKey, "k1")] };
  const v = fresh();
  await v.verify(sign(claims()));
  await v.verify(sign(claims()));
  ok("two tokens, one fetch: the set is cached", fetches === 1);
  clock += 601_000;
  await v.verify(sign(claims({ iat: T0 + 590, auth_time: T0 + 590, exp: T0 + 4000 })));
  ok("past its max-age the set is fetched again", fetches === 2);

  // Google rotates: k2 appears. A token under k2 refetches once and is accepted.
  served = { keys: [jwkOf(google.publicKey, "k1"), jwkOf(rotated.publicKey, "k2")] };
  clock += 61_000;
  const tNow = Math.floor(clock / 1000);
  const late = (/** @type {Record<string, unknown>} */ o = {}) => claims({ iat: tNow - 5, auth_time: tNow - 5, exp: tNow + 3600, ...o });
  ok("a rotated key is found by one refetch", (await outcome(v, sign(late(), { kid: "k2", key: rotated.privateKey }))) === "accepted" && fetches === 3);
  ok("an unknown kid refetches once and then refuses",
     (await outcome(v, sign(late(), { kid: "k9", key: stranger.privateKey }))) === "unknown_kid" && fetches === 3);
  clock += 61_000;
  const t2 = Math.floor(clock / 1000);
  const before = fetches;
  ok("a minute later an unknown kid refetches once more, no more",
     (await outcome(v, sign(claims({ iat: t2 - 5, auth_time: t2 - 5, exp: t2 + 3600 }), { kid: "k9", key: stranger.privateKey }))) === "unknown_kid"
       && fetches === before + 1);

  // No keys at all and no cache: 503, and the signature is never skipped.
  fetchFails = true;
  const cold = fresh();
  /** @type {any} */ let caught = null;
  try { await cold.verify(sign(claims({ iat: t2 - 5, auth_time: t2 - 5, exp: t2 + 3600 }))); } catch (e) { caught = e; }
  ok("keys_unavailable, as a 503, when nothing could be fetched", caught?.code === "keys_unavailable" && caught?.status === 503);
  fetchFails = false;
  ok("a refusal is an AuthError carrying a 401", await (async () => {
    try { await cold.verify("a.b"); return false; } catch (/** @type {any} */ e) { return e.status === 401 && e.name === "FirebaseAuthError"; }
  })());
}

group("keysFromJwks");
{
  ok("an empty set is refused", (() => { try { keysFromJwks({ keys: [] }); return false; } catch { return true; } })());
  ok("a non-RSA key is skipped", (() => {
    try { keysFromJwks({ keys: [{ kty: "EC", kid: "e1", crv: "P-256", x: "AA", y: "AA" }] }); return false; } catch { return true; }
  })());
  ok("an RS256 signing key is kept by kid", keysFromJwks({ keys: [jwkOf(google.publicKey, "k1")] }).has("k1"));
}

console.log(`\n${"─".repeat(52)}\nFIREBASE VERIFY SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
