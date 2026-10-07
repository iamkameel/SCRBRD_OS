#!/usr/bin/env node
/**
 * Signing in with Google, over HTTP (SCRBRD-140 phase 1, db/81; the design's
 * §9 proof 2, without the register, which is phase 2).
 *
 * The server is started with FIREBASE_TEST_KEYS: a JWK set this walk
 * generates, for the project scrbrd-os-test, which server.mjs accepts only
 * outside production (and the walk proves it refuses to start with it in
 * production). Every ID token here is signed with that key, so nothing
 * touches Google. What the walk proves, through the server the app talks to:
 *
 *   1. the exchange refuses what the verifier refuses (a token for the real
 *      project, an unverified email, no device) and a new Google account
 *      gets the ordinary thirty-minute token, for an account with no school
 *   2. that account reads nothing: every read resource answers empty or
 *      refuses, but its own sign-ins and requests
 *   3. it asks to coach at Hilton; the office sees who asked and grants; on
 *      its very next read — the same token — the squad is there
 *   4. an address the office enrolled is claim_required, never linked; the
 *      office's Claims list confirms it with one tap, and the next sign-in
 *      is that account
 *   5. the code path: an enrolled teacher's claim, the office's code, then
 *      the Google account added in the same session links as `code`
 *   6. adding a second Google account needs a fresh sign-in; a uid is one
 *      account's; removing one's own, and the office removing one, and either
 *      way the exchange refuses it after — and every session issued before
 *      the removal is refused (GA-I03, db/85), the remover's own answered
 *      with a fresh token for its device
 *   7. the limits: per address, and per Google account
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-signup.mjs
 */
import { spawn } from "node:child_process";
import { generateKeyPairSync, createSign } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { READ_QUERIES } from "../services/api/read/read-api.mjs";
import { appUrl, port } from "./db-url.mjs";

const PORT = port(8981);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const PROJECT = "scrbrd-os-test";
const RUN = Date.now().toString(36);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

// ── The walk's own "Google": one RSA key, served to the server as a JWK set ──
const dir = mkdtempSync(join(tmpdir(), "scrbrd-signup-"));
const keyFile = join(dir, "keys.json");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
writeFileSync(keyFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "walk-1", alg: "RS256", use: "sig" }] }));

const b64 = (s) => Buffer.from(s).toString("base64url");
/** A Firebase ID token for `uid`/`email`, fresh unless told otherwise. */
const idToken = (uid, email, over = {}) => {
  const t = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email, email_verified: true,
    name: "Walk Person", iat: t - 5, exp: t + 3600, auth_time: t - 5,
    firebase: { sign_in_provider: "google.com" }, ...over,
  };
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-1", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
};

const env = { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
              ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-signup-secret", FIREBASE_TEST_KEYS: keyFile,
              // One proxy in front: the walk names its own address per request,
              // so the per-address limit is exercised without exhausting it.
              PUBLIC_TRUST_PROXY_HOPS: "1" };
const server = spawn(process.execPath, ["services/api/server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

let addr = 0;
const api = async (path, { method = "GET", token, body, from } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": from ?? `10.81.0.${(addr++ % 250) + 1}`,
               ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const exchange = (tok, extra = {}) => api("/api/auth/firebase", { method: "POST", body: { idToken: tok, deviceId: "device-signup", ...extra } });
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-signup" } })).body?.token;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const office = await login("registrar@example.invalid");   // schooladmin, Hilton
  ok("the office signs in", !!office);

  group("1. The exchange: what the verifier refuses, and a new account");
  const NEW_EMAIL = `walk.newcomer.${RUN}@example.invalid`;
  const NEW_UID = `walk-new-${RUN}`;
  {
    const real = idToken(NEW_UID, NEW_EMAIL, { iss: "https://securetoken.google.com/scrbrd-os", aud: "scrbrd-os" });
    let r = await exchange(real);
    ok("a token for the real project is refused by a test server", r.status === 401 && r.body?.error === "bad_issuer", r);
    r = await exchange(idToken(NEW_UID, NEW_EMAIL, { email_verified: false }));
    ok("an unverified email is refused", r.status === 401 && r.body?.error === "email_unverified", r);
    r = await api("/api/auth/firebase", { method: "POST", body: { idToken: idToken(NEW_UID, NEW_EMAIL) } });
    ok("no device, no token", r.status === 401 && r.body?.error === "missing_device", r);
    r = await exchange("not.a.token");
    ok("garbage is malformed_token", r.status === 401 && r.body?.error === "malformed_token", r);
  }
  const first = await exchange(idToken(NEW_UID, NEW_EMAIL));
  ok("a new Google account is a new account", first.status === 200 && first.body?.outcome === "new_account" && !!first.body?.token, first);
  const newcomer = first.body?.token;
  const claims = JSON.parse(Buffer.from(String(newcomer).split(".")[1] ?? "", "base64url").toString() || "{}");
  ok("...with the ordinary token: who and which device, thirty minutes, nothing else",
     claims.iss === "scrbrd" && claims.did === "device-signup" && claims.exp - claims.iat === 1800
       && JSON.stringify(Object.keys(claims).sort()) === JSON.stringify(["aud", "did", "exp", "iat", "iss", "sep", "sid", "sub"])
       // sid and sep (db/85, GA-I03): which session, and the epoch it was issued under. Identity still, never authority.
       && typeof claims.sid === "string" && Number.isInteger(claims.sep), claims);
  const again = await exchange(idToken(NEW_UID, NEW_EMAIL));
  ok("the same Google account again is the same account", again.status === 200 && again.body?.outcome === "signed_in", again);
  let session = await api("/api/session", { token: newcomer });
  ok("its session: the person, no assignment", session.status === 200 && session.body?.user?.email === NEW_EMAIL
     && Array.isArray(session.body?.assignments) && session.body.assignments.length === 0, session.body);

  group("2. An account with no school reads nothing but its own");
  {
    const leaks = [];
    for (const resource of Object.keys(READ_QUERIES)) {
      const r = await api(`/api/read/${resource}`, { token: newcomer });
      if (r.status >= 500) leaks.push(`${resource}: ${r.status} ${r.body?.error}`);
      else if (r.status === 200 && r.body?.rows?.length && resource !== "my_sign_ins") {
        const rows = r.body.rows;
        // Its own account row (users reads app_user, which is the self-read
        // §4.2 allows), and an aggregate over nothing (one row of zeros and
        // nulls — the summary, a coverage count) are not data.
        const own = resource === "users" && rows.length === 1 && rows[0].email === NEW_EMAIL;
        const nothing = rows.every((x) => Object.values(x).every((v) => v === null || v === 0 || v === false || v === ""
                                                                    || (Array.isArray(v) && v.length === 0)));
        if (!own && !nothing) leaks.push(`${resource}: ${JSON.stringify(rows).slice(0, 200)}`);
      }
    }
    ok(`every read resource (${Object.keys(READ_QUERIES).length}) answers it empty or refuses`, leaks.length === 0, leaks);
    const mine = await api("/api/read/my_sign_ins", { token: newcomer });
    ok("its own sign-ins: one, Google, never the uid", mine.status === 200 && mine.body?.rows?.length === 1
       && mine.body.rows[0].provider === "google.com" && !JSON.stringify(mine.body).includes(NEW_UID), mine.body);
    const sports = await api("/api/read/sports", { token: newcomer });
    ok("the sports catalogue, readable by anybody signed in until D14, is empty", sports.status === 200 && sports.body?.rows?.length === 0, sports.body);
  }

  group("3. It asks; the office answers; the next read sees the side");
  const asked = await api("/api/requests", { method: "POST", token: newcomer,
    body: { role: "coach", schoolId: HIL, teamCode: "U15A", note: "I coach the under-15s on Saturdays." } });
  ok("it asks to coach at Hilton", asked.status === 200 && !!asked.body?.id, asked);
  const reqs = await api("/api/read/role_requests", { token: office });
  const row = reqs.body?.rows?.find((x) => x.id === asked.body?.id);
  ok("the office sees the request, and who asked, though the account has no school",
     !!row && row.email === NEW_EMAIL && row.name === "Walk Person" && row.decidable === true, row ?? reqs.body);
  ok("...asked signed in, so not marked as asked before the email was verified (db/84)",
     row?.asked_unverified === false, row);
  const decided = await api(`/api/requests/${asked.body?.id}/decide`, { method: "POST", token: office, body: { grant: true, note: "Known to the sportsmaster." } });
  ok("the office grants it", decided.status === 200 && decided.body?.state === "granted", decided);
  const squad = await api("/api/read/players", { token: newcomer });
  ok("on its very next read, with the same token, the squad is there", squad.status === 200 && squad.body?.rows?.length > 0, squad.status);
  session = await api("/api/session", { token: newcomer });
  ok("...and its session lists the role at Hilton",
     session.body?.assignments?.some((a) => a.role === "coach" && a.school === HIL && a.team === "U15A"), session.body);
  const sportsNow = await api("/api/read/sports", { token: newcomer });
  ok("...and the reference data the narrowing hid", sportsNow.body?.rows?.length > 0, sportsNow.body);

  group("3b. A request filed for an address, then Google: still marked as asked unverified (db/84)");
  // POST /api/onboard is unauthenticated: anybody may file a request in an
  // address's name. When the address's owner later signs in with Google, the
  // stub is linked to him — and the request must not start to look like his.
  const STUB_EMAIL = `walk.stub.${RUN}@example.invalid`;
  const filed = await api("/api/onboard", { method: "POST",
    body: { email: STUB_EMAIL, name: "Somebody Typed This", role: "guardian", schoolId: HIL, note: "the boy in the U13A side" } });
  ok("a request is filed for an address, signed out", filed.status === 200 && filed.body?.requested === true, filed);
  const linkedIn = await exchange(idToken(`walk-stub-${RUN}`, STUB_EMAIL));
  ok("the address's Google sign-in links the stub", linkedIn.status === 200 && linkedIn.body?.outcome === "linked", linkedIn);
  const officeList = await api("/api/read/role_requests", { token: office });
  const stubRow = officeList.body?.rows?.find((x) => x.email === STUB_EMAIL && x.role === "guardian");
  ok("the office still sees it marked: asked before the email was verified",
     !!stubRow && stubRow.state === "pending" && stubRow.asked_unverified === true, stubRow ?? officeList.body);

  group("4. An address the office enrolled is a claim, never a link");
  const PARENT_UID = `walk-parent-${RUN}`;
  let r = await exchange(idToken(PARENT_UID, "Parent@Example.invalid"));
  let r2;
  ok("a parent's address answers claim_required, no token", r.status === 409 && r.body?.error === "claim_required" && !r.body?.token, r);
  r = await exchange(idToken(PARENT_UID, "parent@example.invalid"));
  ok("...and asking again, the same", r.status === 409 && r.body?.error === "claim_required", r);
  let list = await api("/api/read/sign_in_claims", { token: office });
  const claim = list.body?.rows?.filter((x) => x.account_email === "parent@example.invalid");
  ok("the office's Claims list shows it once, enrolled address beside Google's, no uid",
     claim?.length === 1 && claim[0].presented_email === "parent@example.invalid" && !JSON.stringify(list.body).includes(PARENT_UID), list.body);
  ok("the account with no office of its own sees no claims", (await api("/api/read/sign_in_claims", { token: newcomer })).body?.rows?.length === 0);
  r = await api(`/api/auth/claims/${claim?.[0]?.id}/confirm`, { method: "POST", token: newcomer });
  ok("a coach cannot confirm it, and is told in words", r.status === 403 && r.body?.error === "not_permitted" && /\s/.test(r.body?.detail ?? ""), r);
  r = await api(`/api/auth/claims/${claim?.[0]?.id}/confirm`, { method: "POST", token: office });
  ok("the office confirms it with one tap", r.status === 200 && r.body?.confirmed === true, r);
  r = await api(`/api/auth/claims/${claim?.[0]?.id}/confirm`, { method: "POST", token: office });
  ok("...once", r.status === 409 && r.body?.error === "already_resolved", r);
  const parentIn = await exchange(idToken(PARENT_UID, "parent@example.invalid"));
  ok("the parent's next Google sign-in is the parent's account", parentIn.status === 200 && parentIn.body?.outcome === "signed_in", parentIn);
  const parentSession = await api("/api/session", { token: parentIn.body?.token });
  ok("...whose session is the parent's", parentSession.body?.user?.email === "parent@example.invalid"
     && parentSession.body?.assignments?.some((a) => a.role === "guardian"), parentSession.body?.user);

  group("5. The code path: the office's code, then Google in the same session");
  const COACH2_UID = `walk-coach2-${RUN}`;
  r = await exchange(idToken(COACH2_UID, "coach2@example.invalid"));
  ok("an enrolled coach's address is a claim", r.status === 409, r);
  const code = await api("/api/auth/invite", { method: "POST", token: office, body: { email: "coach2@example.invalid" } });
  ok("the office issues a code as today", code.status === 200 && !!code.body?.code, code);
  const redeemed = await api("/api/auth/redeem", { method: "POST", body: { email: "coach2@example.invalid", code: code.body?.code, deviceId: "device-signup" } });
  ok("the code is redeemed", redeemed.status === 200 && !!redeemed.body?.token, redeemed);
  r = await api("/api/auth/sign-ins", { method: "POST", token: redeemed.body?.token, body: { idToken: idToken(COACH2_UID, "coach2@example.invalid") } });
  ok("adding the Google account links it as `code`", r.status === 200 && r.body?.linkedHow === "code", r);
  r = await exchange(idToken(COACH2_UID, "coach2@example.invalid"));
  ok("...and from now on Google is enough", r.status === 200 && r.body?.outcome === "signed_in", r);
  list = await api("/api/read/sign_in_claims", { token: office });
  ok("...and the claim is off the office's list", !list.body?.rows?.some((x) => x.account_email === "coach2@example.invalid"), list.body);

  group("6. A second Google account, and taking one away");
  const ALT_UID = `walk-alt-${RUN}`;
  r = await api("/api/auth/sign-ins", { method: "POST", token: newcomer,
    body: { idToken: idToken(ALT_UID, `walk.alt.${RUN}@example.invalid`, { auth_time: Math.floor(Date.now() / 1000) - 600 }) } });
  ok("a Google sign-in ten minutes old is not fresh enough to add", r.status === 401 && r.body?.error === "stale_sign_in" && /\s/.test(r.body?.detail ?? ""), r);
  r = await api("/api/auth/sign-ins", { method: "POST", body: { idToken: idToken(ALT_UID, `walk.alt.${RUN}@example.invalid`) } });
  ok("no session, no adding", r.status === 401, r);
  r = await api("/api/auth/sign-ins", { method: "POST", token: newcomer, body: { idToken: idToken(ALT_UID, `walk.alt.${RUN}@example.invalid`) } });
  ok("a fresh one is added", r.status === 200 && r.body?.linkedHow === "self_added", r);
  const altId = r.body?.id;
  r = await api("/api/auth/sign-ins", { method: "POST", token: newcomer, body: { idToken: idToken(PARENT_UID, "parent@example.invalid") } });
  ok("the parent's Google account cannot be added to another account", r.status === 409 && r.body?.error === "identity_in_use", r);
  r = await exchange(idToken(ALT_UID, `walk.alt.${RUN}@example.invalid`));
  ok("the added one signs in to the same account", r.status === 200 && r.body?.outcome === "signed_in"
     && JSON.parse(Buffer.from(r.body.token.split(".")[1], "base64url").toString()).sub === claims.sub, r.body?.outcome);
  const altToken = r.body?.token;
  ok("(and the newcomer is signed in with it)", (await api("/api/session", { token: altToken })).status === 200);
  r = await api(`/api/auth/sign-ins/${altId}/revoke`, { method: "POST", token: parentIn.body?.token });
  ok("the parent cannot remove the newcomer's", r.status === 404 && r.body?.error === "no_such_sign_in", r);
  r = await api(`/api/auth/sign-ins/${altId}/revoke`, { method: "POST", token: newcomer });
  ok("the newcomer removes his own", r.status === 200 && r.body?.revoked === true, r);
  r2 = r;
  r = await exchange(idToken(ALT_UID, `walk.alt.${RUN}@example.invalid`));
  ok("...and it signs in to nothing", r.status === 401 && r.body?.error === "identity_revoked", r);
  // GA-I03 (db/85): removing a way to sign in ends every session issued
  // before it — the one that removed it included. That one is answered with
  // a fresh token for its own device, so the person stays signed in here.
  ok("the session it signed in with is refused from now on",
     (await api("/api/session", { token: altToken })).status === 401);
  ok("...and so is every older token of the account", (await api("/api/session", { token: newcomer })).status === 401
     && (await api("/api/session", { token: again.body?.token })).status === 401);
  ok("the removal answers with a fresh token for this device, which works",
     typeof r2.body?.token === "string" && (await api("/api/session", { token: r2.body.token })).body?.user?.email === NEW_EMAIL, r2.body);
  const newcomerNow = r2.body?.token;
  const viaGoogle = await exchange(idToken(NEW_UID, NEW_EMAIL));
  ok("a fresh sign-in with the Google account that is left works", viaGoogle.status === 200
     && (await api("/api/session", { token: viaGoogle.body?.token })).status === 200, viaGoogle);
  const parentId = parentSession.body?.user?.id;
  const theirs = await api(`/api/auth/users/${parentId}/sign-ins`, { token: office });
  ok("the office reads the parent's sign-ins, without the uid", theirs.status === 200 && theirs.body?.rows?.length === 1
     && !JSON.stringify(theirs.body).includes(PARENT_UID), theirs);
  r = await api(`/api/auth/users/${parentId}/sign-ins`, { token: newcomerNow });
  ok("a coach does not", r.status === 403 || (r.status === 200 && r.body?.rows?.length === 0), r);
  r = await api(`/api/auth/office/sign-ins/${theirs.body?.rows?.[0]?.id}/revoke`, { method: "POST", token: office });
  ok("the office removes it", r.status === 200 && r.body?.revoked === true, r);
  r = await exchange(idToken(PARENT_UID, "parent@example.invalid"));
  ok("...and the parent's Google account signs in to nothing", r.status === 401 && r.body?.error === "identity_revoked", r);
  ok("...and the parent's session from it is refused (GA-I03)",
     (await api("/api/session", { token: parentIn.body?.token })).status === 401);
  ok("...but the office's own is not", (await api("/api/session", { token: office })).status === 200);
  {
    const c = await api("/api/auth/invite", { method: "POST", token: office, body: { email: "parent@example.invalid" } });
    const back = await api("/api/auth/redeem", { method: "POST", body: { email: "parent@example.invalid", code: c.body?.code, deviceId: "device-signup" } });
    ok("a fresh sign-in by the office's code works", back.status === 200
       && (await api("/api/session", { token: back.body?.token })).body?.user?.email === "parent@example.invalid", back);
  }

  group("7. The limits");
  {
    const statuses = [];
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) statuses.push((await api("/api/auth/firebase", { method: "POST", from: "10.81.9.9", body: { idToken: "x.y.z", deviceId: "d" } })).status);
    // A school behind one address: a burst of forty (EXCHANGE_RATE), then
    // two a second — so beyond forty, only what the walk's own time refilled.
    const served = statuses.filter((s) => s === 401).length;
    ok("one address: forty at once, then 429", statuses.slice(0, 40).every((s) => s === 401) && statuses.includes(429)
       && served <= 40 + Math.ceil((Date.now() - t0) / 500) + 1, statuses);
    const LIMIT_UID = `walk-limit-${RUN}`;
    const byUid = [];
    for (let i = 0; i < 8; i++) byUid.push((await exchange(idToken(LIMIT_UID, `walk.limit.${RUN}@example.invalid`))).status);
    ok("one Google account from many addresses: six, then 429", byUid.slice(0, 6).every((s) => s === 200) && byUid.slice(6).every((s) => s === 429), byUid);
  }

  group("8. The test key is never the default");
  {
    const prod = spawn(process.execPath, ["services/api/server.mjs"], {
      env: { ...env, NODE_ENV: "production", PORT: String(port(8982)), SESSION_SECRET: "x".repeat(40), WEB_ORIGIN: "http://127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    prod.stderr.on("data", (d) => { out += d.toString(); });
    prod.stdout.on("data", (d) => { out += d.toString(); });
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => { prod.kill(); resolve("still running"); }, 15_000);
      prod.on("exit", (c) => { clearTimeout(t); resolve(c); });
    });
    ok("a production server with FIREBASE_TEST_KEYS refuses to start", code !== 0 && code !== "still running"
       && /FIREBASE_TEST_KEYS is set with NODE_ENV=production/.test(out), { code, out: out.slice(0, 300) });
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e);
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
}

if (fail && serverErr.length) console.log("\nserver stderr:\n" + serverErr.join("").slice(-2000));
console.log(`\n${"─".repeat(52)}\nSIGN-UP WALK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
