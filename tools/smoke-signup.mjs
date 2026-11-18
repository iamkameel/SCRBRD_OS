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
 *   9. "I am a pupil here" (db/163, the honesty model's Migration A): a boy
 *      under 18 sends his claim (and the date of birth he types is in no
 *      log the server writes); his account still reads nothing, asks for
 *      nothing (a role, a school added, the register), and may follow; the
 *      office lists his claim with his address, a coach does not; the office
 *      recognises him, which opens nothing but his school's safeguarding
 *      card and the door to raise a concern there; a declined claim tells
 *      the DSO with no name; the 30-day keep, by the office's button and by
 *      his own "Remove this account"; "I just want to follow matches"
 *      follows by the school's id
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
import pg from "pg";
import { appUrl, ownerUrl, port } from "./db-url.mjs";

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
// Everything the server writes, for "the typed date of birth is in no log" (9).
const serverOut = [];
server.stdout.on("data", (d) => serverOut.push(d.toString()));

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
/**
 * Every read resource, as this account: what it answers that is not empty.
 * Its own account row (users and accounts read app_user, which is the
 * self-read §4.2 allows), its own sign-ins, and an aggregate over nothing
 * (one row of zeros and nulls — the summary, a coverage count) are not data.
 */
const sweep = async (token, email) => {
  const leaks = [];
  for (const resource of Object.keys(READ_QUERIES)) {
    const r = await api(`/api/read/${resource}`, { token });
    if (r.status >= 500) leaks.push(`${resource}: ${r.status} ${r.body?.error}`);
    else if (r.status === 200 && r.body?.rows?.length && resource !== "my_sign_ins") {
      const rows = r.body.rows;
      const own = ((resource === "users" || resource === "accounts") && rows.length === 1 && rows[0].email === email)
        // His own notice settings: a pupil's account (db/163's third case of
        // person_is_pupil()) has quiet hours on, about no child (db/120).
        || (resource === "my_notification_prefs" && rows.every((x) => x.subject_player_id === null && x.player_name === null));
      const nothing = rows.every((x) => Object.values(x).every((v) => v === null || v === 0 || v === false || v === ""
                                                                  || (Array.isArray(v) && v.length === 0)));
      if (!own && !nothing) leaks.push(`${resource}: ${JSON.stringify(rows).slice(0, 200)}`);
    }
  }
  return leaks;
};
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
    const leaks = await sweep(newcomer, NEW_EMAIL);
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
  // The unauthenticated POST /api/onboard let anybody file a request in an
  // address's name. It is retired (EXPERIENCE_PASS Q13, slice 3a), but its
  // stubs exist in databases that ran it, so the stub is made here by owner
  // SQL, as the route made it: onboard_request() (db/08) with no app.user_id.
  // When the address's owner later signs in with Google, the stub is linked
  // to him, and the request must not start to look like his.
  const STUB_EMAIL = `walk.stub.${RUN}@example.invalid`;
  const owner = new pg.Pool({ connectionString: ownerUrl() });
  const filed = await owner.query(`select onboard_request($1, $2, 'guardian', $3, null, 'the boy in the U13A side') as id`, [STUB_EMAIL, "Somebody Typed This", HIL])
    .then((x) => x.rows[0]?.id ?? null, (e) => { console.log("   ", e.message); return null; });
  await owner.end().catch(() => {});
  ok("a request is filed for an address, signed out (the retired route's stub)", !!filed, filed);
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

  group("9. \"I am a pupil here\" (db/163): a claim asks for nothing and opens nothing");
  {
    const KID_UID = `walk-kid-${RUN}`, KID_EMAIL = `walk.kid.${RUN}@example.invalid`;
    const BORN = `${new Date().getUTCFullYear() - 14}-07-19`;
    const BORN_FORMS = [BORN, BORN.split("-").reverse().join("/"), BORN.replace(/-/g, "")];
    const kidIn = await exchange(idToken(KID_UID, KID_EMAIL));
    const kid = kidIn.body?.token;
    ok("a boy signs in with Google: a new account", kidIn.status === 200 && kidIn.body?.outcome === "new_account", kidIn);
    let s = await api("/api/pupil/state", { token: kid });
    ok("before he says anything, he has no claim", s.status === 200 && s.body?.claim === null, s);
    // A pupil of fifteen on Hilton's roster, with no account: the owner makes him, as the office's import would.
    const own = new pg.Pool({ connectionString: ownerUrl() });
    const boy = (await own.query(`insert into player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
      values ($1, 'U15A', 'Walk Rosterboy', 'Rosterboy', 99, 'batter', (current_date - interval '15 years')::date) returning id`, [HIL])).rows[0].id;
    let r = await api("/api/pupil/claim", { method: "POST", token: kid, body: { schoolId: HIL, name: "  Sipho   Walker ", year: "Grade 9", born: BORN } });
    ok("he sends his claim: one answer, whatever he typed", r.status === 200 && r.body?.ok === true && JSON.stringify(Object.keys(r.body)) === '["ok"]', r);
    r = await api("/api/pupil/claim", { method: "POST", token: kid, body: { schoolId: HIL, name: "Sipho Walker", born: "2012-02-30" } });
    ok("...an impossible date of birth is refused", r.status === 422 && r.body?.error === "born_invalid", r);
    s = await api("/api/pupil/state", { token: kid });
    const c = s.body?.claim;
    const plus30 = new Date(Date.parse(`${c?.sentOn}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
    ok("his state: with the office, what he typed, kept 30 days, no card", c?.state === "with_office" && c?.schoolName === "Hilton College" && c?.name === "Sipho Walker"
       && c?.year === "Grade 9" && c?.keepUntil === plus30 && c?.safeguarding === false, s.body);
    ok("...and never a team, a player id or a birthday", !/playerId|team|born|U15A|Rosterboy/.test(JSON.stringify(s.body)), s.body);
    let leaks = await sweep(kid, KID_EMAIL);
    ok(`with the office, every read resource (${Object.keys(READ_QUERIES).length}) answers him empty or refuses`, leaks.length === 0, leaks);
    r = await api("/api/requests", { method: "POST", token: kid, body: { role: "spectator", schoolId: HIL } });
    ok("he cannot ask for a role, and is told whom to ask", r.status === 403 && r.body?.error === "ask_your_school_office" && /school office/.test(r.body?.detail ?? ""), r);
    r = await api("/api/school-requests", { method: "POST", token: kid, body: { schoolName: "Northfield College", town: "Pietermaritzburg", job: "other" } });
    ok("...nor ask SCRBRD to add a school (Ask a teacher)", r.status === 403 && r.body?.error === "ask_a_teacher", r);
    r = await api("/api/join/register-claim", { method: "POST", token: kid, body: { schoolId: HIL } });
    ok("...and the staff register grants him nothing", !(r.body?.granted?.length > 0) && (r.status === 200 || r.status === 403), r);
    r = await api("/api/follows", { method: "POST", token: kid, body: { schoolId: HIL } });
    ok("he may follow his school's public matches (by its id, Q10)", r.status === 200 && r.body?.school?.name === "Hilton College", r);
    r = await api("/api/safeguarding/contacts", { token: kid });
    ok("not yet recognised: no school's safeguarding card", r.status === 200 && r.body?.rows?.length === 0, r.body);

    // The office's list: his address, what he typed. A coach lists nothing and answers nothing.
    let list = await api(`/api/pupil-claims?schoolId=${HIL}`, { token: office });
    const row = list.body?.rows?.find((x) => x.address === KID_EMAIL);
    ok("the office lists his claim, with his address and what he typed", !!row && row.name === "Sipho Walker" && row.state === "with_office" && row.keepUntil === plus30, list.body);
    const coach = await login("coach@example.invalid");
    r = await api(`/api/pupil-claims?schoolId=${HIL}`, { token: coach });
    ok("a coach lists nothing", r.status === 200 && r.body?.rows?.length === 0, r.body);
    r = await api(`/api/pupil-claims/${row?.id}/recognise`, { method: "POST", token: coach, body: { playerId: boy } });
    ok("...and cannot recognise him", r.status === 403 && r.body?.error === "not_permitted", r);
    r = await api(`/api/pupil-claims/${row?.id}/recognise`, { method: "POST", token: office, body: { playerId: boy } });
    ok("the office recognises him", r.status === 200 && r.body?.ok === true, r);
    s = await api("/api/pupil/state", { token: kid });
    ok("recognised: his state, and his school's card is his (Q8)", s.body?.claim?.state === "recognised" && s.body?.claim?.safeguarding === true, s.body);
    ok("...still never the roster's name for him", !/Rosterboy|U15A/.test(JSON.stringify(s.body)), s.body);
    leaks = await sweep(kid, KID_EMAIL);
    ok("recognised and waiting, every read resource answers him empty or refuses", leaks.length === 0, leaks);
    ok("...and his session holds no role", (await api("/api/session", { token: kid })).body?.assignments?.length === 0);
    r = await api("/api/safeguarding/contacts", { token: kid });
    ok("he reads Hilton's safeguarding officers by name", r.status === 200 && r.body?.rows?.length > 0 && r.body.rows.every((x) => x.schoolId === HIL) && r.body.rows.some((x) => x.name), r.body);
    r = await api("/api/safeguarding/concerns", { method: "POST", token: kid, body: { schoolId: HIL, aboutKind: "adult", nature: ["bullying"],
      certainty: "suspicion", account: "Somebody at nets keeps shouting at me and pushing me.", howLearned: "victim" } });
    ok("...and raises a concern there: a reference, and nothing else", r.status === 200 && /^SG-/.test(r.body?.reference ?? "") && JSON.stringify(Object.keys(r.body).sort()) === '["raisedAt","reference","unheld"]', r);
    ok("the date of birth he typed is in nothing the server wrote", !BORN_FORMS.some((f) => (serverOut.join("") + serverErr.join("")).includes(f)));
    const stored = (await own.query(`select count(*)::int as n from access_log where resource::text like '%' || $1 || '%'`, [BORN])).rows[0].n;
    ok("...nor in the access log", stored === 0, stored);

    // A second boy, whom nobody knows: declined. The DSO is told, with no name.
    const K2_UID = `walk-kid2-${RUN}`, K2_EMAIL = `walk.kid2.${RUN}@example.invalid`;
    const k2 = (await exchange(idToken(K2_UID, K2_EMAIL))).body?.token;
    await api("/api/pupil/claim", { method: "POST", token: k2, body: { schoolId: HIL, name: "Zebedee Walkerson" } });
    list = await api(`/api/pupil-claims?schoolId=${HIL}`, { token: office });
    const row2 = list.body?.rows?.find((x) => x.address === K2_EMAIL);
    r = await api(`/api/pupil-claims/${row2?.id}/decline`, { method: "POST", token: office });
    ok("the office declines the second", r.status === 200 && r.body?.ok === true, r);
    const dso = await login("dso@example.invalid");
    const notes = (await api("/api/read/notifications", { token: dso })).body?.rows ?? [];
    const told = notes.filter((n) => n.title === "A pupil claim was declined");
    ok("the DSO is told a pupil claim was declined", told.length >= 1, notes.map((n) => n.title));
    ok("...naming nobody", told.every((n) => !/Zebedee|Walkerson|walk\.kid2|Sipho/.test(JSON.stringify(n))), told);
    s = await api("/api/pupil/state", { token: k2 });
    ok("he reads that the school has answered (declined), never why", s.body?.claim?.state === "declined", s.body);
    r = await api("/api/pupil/claim", { method: "POST", token: k2, body: { schoolId: HIL, name: "Zebedee Walkerson" } });
    ok("...and cannot send it again", r.status === 409 && r.body?.error === "already_answered", r);

    // Q9: 30 days past its claim and its decline (db/163 S1), the office removes it; his Google account then makes a new account.
    await own.query(`update pupil_claim set last_claim_at = now() - interval '31 days', decided_at = now() - interval '31 days' where user_id = (select id from app_user where email = $1)`, [K2_EMAIL]);
    r = await api("/api/pupil-claims/clear", { method: "POST", token: coach, body: { schoolId: HIL } });
    ok("a coach removes nothing", r.status === 200 && r.body?.removed === 0, r);
    r = await api("/api/pupil-claims/clear", { method: "POST", token: office, body: { schoolId: HIL } });
    ok("past its 30 days, the office removes it", r.status === 200 && r.body?.removed === 1, r);
    r = await exchange(idToken(K2_UID, K2_EMAIL));
    ok("...and his Google account is a stranger again: a new account", r.status === 200 && r.body?.outcome === "new_account", r);

    // His own way out, now.
    const K3_UID = `walk-kid3-${RUN}`, K3_EMAIL = `walk.kid3.${RUN}@example.invalid`;
    const k3 = (await exchange(idToken(K3_UID, K3_EMAIL))).body?.token;
    await api("/api/pupil/claim", { method: "POST", token: k3, body: { schoolId: HIL, name: "Lungi Walker" } });
    r = await api("/api/pupil/remove", { method: "POST", token: k3 });
    ok("he removes his account himself", r.status === 200 && r.body?.removed === true, r);
    r = await exchange(idToken(K3_UID, K3_EMAIL));
    ok("...and his Google account makes a new one", r.status === 200 && r.body?.outcome === "new_account", r);
    r = await api("/api/pupil/remove", { method: "POST", token: coach });
    ok("an account that is not a claim cannot be removed from here", r.status === 409 && r.body?.error === "not_a_claim", r);
    await own.end().catch(() => {});
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
