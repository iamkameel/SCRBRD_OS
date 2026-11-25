#!/usr/bin/env node
/**
 * The family list, over HTTP (SCRBRD-140 honesty model, Migration C, db/174).
 *
 * The server is started with FIREBASE_TEST_KEYS, a JWK set this walk
 * generates (smoke-signup.mjs's arrangement), so a fixture Google account can
 * sign in without touching Google. Every boy and every address is the
 * walk's own, invented. What the walk proves, through the server the app
 * talks to:
 *
 *   1. the office checks rows with problems: each in words, nothing written;
 *      then lists clean ones; the list is the office's, a coach reads none of it
 *   2. with the school's switch on, a Google account at a listed address that
 *      types his date of birth is linked at once ("linked"): her link
 *      verified, consent pending; the office sees the row claimed and is told
 *   3. a wrong date answers exactly as no row does ("sent"), uses the row up,
 *      and marks her request for the office ("The details did not agree"),
 *      never for her; the right date after it links nothing
 *   4. with the switch off, a full match links nothing and is marked
 *   5. a departed uploader's row links nobody
 *   6. the date she typed is in no table; End role on the linked row ends it
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-family-register.mjs
 */
import { spawn } from "node:child_process";
import { generateKeyPairSync, createSign } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(9174);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const PROJECT = "scrbrd-os-test";
const RUN = Date.now().toString(36);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);
const inWords = (s) => typeof s === "string" && /\s/.test(s) && !/_/.test(s);

// ── The walk's own "Google" ──
const dir = mkdtempSync(join(tmpdir(), "scrbrd-family-"));
const keyFile = join(dir, "keys.json");
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
writeFileSync(keyFile, JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "walk-1", alg: "RS256", use: "sig" }] }));
const b64 = (s) => Buffer.from(s).toString("base64url");
const idToken = (uid, email) => {
  const t = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, email, email_verified: true,
                    name: "Walk Parent", iat: t - 5, exp: t + 3600, auth_time: t - 5, firebase: { sign_in_provider: "google.com" } };
  const input = `${b64(JSON.stringify({ alg: "RS256", kid: "walk-1", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const s = createSign("RSA-SHA256"); s.update(input);
  return `${input}.${s.sign(privateKey).toString("base64url")}`;
};

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-family-register-secret", FIREBASE_TEST_KEYS: keyFile,
         PUBLIC_TRUST_PROXY_HOPS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

let addr = 0;
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.174.0.${(addr++ % 250) + 1}`,
               ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-family" } })).body?.token;
const google = async (uid, email) => {
  const r = await api("/api/auth/firebase", { method: "POST", body: { idToken: idToken(uid, email), deviceId: "device-family" } });
  return r.status === 200 ? r.body.token : null;
};
const list = (token, body) => api(`/api/family-list/${HIL}`, { method: "POST", token, body });
const ask = (token, born) => api("/api/requests", { method: "POST", token,
  body: { role: "guardian", schoolId: HIL, note: "Child: Walk Onesevenfour · Relationship: Mother", ...(born ? { born } : {}) } });
const addr_ = (k) => `walk.family.${k}.${RUN}@example.invalid`;

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
const iso = (d) => d.toISOString().slice(0, 10);
const boy = async (tag, years) => (await q(
  `insert into player (school_id, team_code, full_name, surname, squad_no, playing_role, born)
   values ($1, 'U15A', $2, 'Onesevenfour', 174, 'batter', (sa_today() - make_interval(years => $3, days => 40))::date)
   returning id, born::text as born`, [HIL, `Walk Onesevenfour ${tag} ${RUN}`, years]))[0];
const switchOn = async (on) => {
  await q(`delete from feature_grant where key = 'family_list_links' and school_id = $1`, [HIL]);
  if (on) await q(`insert into feature_grant (key, school_id, granted, note) values ('family_list_links', $1, true, 'smoke-family-register')`, [HIL]);
};
const lineOf = async (token, id) => ((await api("/api/read/role_requests", { token })).body?.rows ?? []).find((r) => r.id === id);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const office = await login("registrar@example.invalid");     // schooladmin, Hilton
  const head = await login("principal@example.invalid");       // principal, Hilton
  const coach = await login("coach@example.invalid");          // coach, Hilton 1XI
  ok("the office, the principal and a coach sign in", !!(office && head && coach));
  const A = await boy("A", 14), B = await boy("B", 13), C = await boy("C", 12), D = await boy("D", 15);

  group("1. Check, then list: every problem in words, all or nothing; the office's alone");
  {
    const bad = await list(office, { commit: true, rows: [
      { playerId: A.id, email: addr_("mum"), kind: "guardian", relationship: "mother" },
      { playerId: A.id, email: "not an address", kind: "guardian", relationship: "parent" },
      { playerId: "00000000-0000-0000-0000-00000000dead", email: addr_("x"), kind: "guardian", relationship: "parent" },
      { playerId: A.id, email: addr_("p"), kind: "pupil", relationship: "parent" },
    ] });
    const at = (line) => bad.body?.rows?.find((x) => x.line === line);
    ok("a list with bad rows answers 200, not ok, nothing committed", bad.status === 200 && bad.body?.ok === false && bad.body?.committed === false, bad.body);
    ok("the good row is fine", at(1)?.ok === true && at(1)?.words === null, at(1));
    ok("each bad row is said in words",
       [2, 3, 4].every((l) => inWords(at(l)?.words) && /^Row \d: /.test(at(l)?.words)) && at(3)?.problem === "player_unknown", bad.body?.rows);
    const none = (await q(`select count(*)::int n from family_register where email = $1`, [addr_("mum")]))[0].n;
    ok("nothing was written", none === 0, none);
    const good = await list(office, { commit: true, rows: [
      { playerId: A.id, email: addr_("mum"), kind: "guardian", relationship: "mother" },
      { playerId: B.id, email: addr_("wrong"), kind: "guardian", relationship: "father" },
      { playerId: C.id, email: addr_("wrong"), kind: "guardian", relationship: "father" },
      { playerId: D.id, email: addr_("off"), kind: "guardian", relationship: "parent" },
    ] });
    ok("a clean list commits, a row id each", good.status === 200 && good.body?.committed && good.body.rows.every((x) => x.ok && x.rowId), good.body);
    const read = await api(`/api/family-list/${HIL}?state=open`, { token: office });
    ok("the office reads the rows open, the child by his roster name, and the switch",
       read.status === 200 && read.body.rows.filter((r) => [addr_("mum"), addr_("wrong"), addr_("off")].includes(r.email)).length === 4
       && read.body.rows.some((r) => r.player_id === A.id && /Walk Onesevenfour A/.test(r.player_name)) && typeof read.body.linksAtOnce === "boolean", read.body);
    const byHead = await api(`/api/family-list/${HIL}`, { token: head });
    ok("...and so does the principal", byHead.status === 200 && byHead.body.rows.length >= 4, byHead.status);
    const byCoach = await api(`/api/family-list/${HIL}`, { token: coach });
    ok("a coach reads none of it", byCoach.status === 403 && inWords(byCoach.body?.detail), byCoach.body);
    const coachUp = await list(coach, { rows: [{ playerId: A.id, email: addr_("c"), kind: "guardian", relationship: "parent" }] });
    ok("...and may not list", coachUp.status === 403, coachUp.body);
  }

  group("2. Switched on: a full match links at once, the office is told");
  let mumAssignment = null;
  {
    await switchOn(true);
    const mum = await google(`walk-mum-${RUN}`, addr_("mum"));
    ok("a Google account at the listed address signs in", !!mum);
    const r = await ask(mum, A.born);
    ok("her request with his date of birth answers linked", r.status === 200 && r.body?.family === "linked" && r.body?.state === "granted", r.body);
    const link = (await q(
      `select g.verification_state, g.consent_state, g.verified_by, a.id from role_assignment a join assignment_subject g on g.assignment_id = a.id
        join app_user u on u.id = a.person_id
        where u.email = $1 and a.role = 'guardian' and a.active and g.player_id = $2`, [addr_("mum"), A.id]))[0];
    ok("...her link verified, consent pending (the terms come first)", link?.verification_state === "verified" && link?.consent_state === "pending", link);
    mumAssignment = link?.id ?? null;
    const read = await api(`/api/family-list/${HIL}?state=claimed`, { token: office });
    const row = read.body?.rows?.find((x) => x.email === addr_("mum"));
    ok("the office sees the row claimed, linked, with the link to end", row?.outcome === "granted" && row?.live_assignment === mumAssignment, row);
    const notices = await api("/api/read/notifications", { token: office });
    ok("the office is told", (notices.body?.rows ?? []).some((n) => n.title === "Linked from the family list"), notices.body?.rows?.map((n) => n.title));
    const coachNotices = await api("/api/read/notifications", { token: coach });
    ok("...and a coach is not", !(coachNotices.body?.rows ?? []).some((n) => n.title === "Linked from the family list"), coachNotices.status);
  }

  group("3. A wrong date: the no-match answer, the rows used up, the office's line");
  {
    const dad = await google(`walk-dad-${RUN}`, addr_("wrong"));
    const wrongDay = iso(new Date(new Date(`${B.born}T12:00:00Z`).getTime() + 86400000));
    const r = await ask(dad, wrongDay);
    ok("a wrong date answers sent, as no row does", r.status === 200 && r.body?.family === "sent" && r.body?.state === "pending", r.body);
    const stranger = await google(`walk-stranger-${RUN}`, addr_("stranger"));
    const s = await ask(stranger, B.born);
    ok("...exactly as a stranger with no row is answered", s.status === 200 && s.body?.family === "sent" && s.body?.state === "pending"
       && JSON.stringify(Object.keys(s.body).sort()) === JSON.stringify(Object.keys(r.body).sort()), s.body);
    const used = await q(`select outcome, outcome_reason from family_register where email = $1`, [addr_("wrong")]);
    ok("every open row for his address is used up", used.length === 2 && used.every((x) => x.outcome === "requested" && x.outcome_reason === "details_disagree"), used);
    const officeLine = await lineOf(office, r.body?.id);
    ok("the office's Requests line: the details did not agree", officeLine?.familyLine === "details_disagree" || officeLine?.family_line === "details_disagree", officeLine);
    const own = await lineOf(dad, r.body?.id);
    ok("...which he never reads", own && (own.family_line ?? own.familyLine ?? null) === null, own);
    const strangerLine = await lineOf(office, s.body?.id);
    ok("a stranger's request carries no line", strangerLine && (strangerLine.family_line ?? null) === null, strangerLine);
    const d = await api(`/api/requests/${r.body?.id}/decide`, { method: "POST", token: office, body: { grant: false } });
    ok("the office declines it", d.status === 200, d.body);
    const again = await ask(dad, B.born);
    ok("the right date after it links nothing: one go", again.status === 200 && again.body?.family === "sent", again.body);
  }

  group("4. Switched off: a full match links nothing, and is marked");
  {
    await switchOn(false);
    const p = await google(`walk-off-${RUN}`, addr_("off"));
    const r = await ask(p, D.born);
    ok("a full match answers sent", r.status === 200 && r.body?.family === "sent" && r.body?.state === "pending", r.body);
    const link = await q(`select 1 from role_assignment a join app_user u on u.id = a.person_id where u.email = $1 and a.role = 'guardian'`, [addr_("off")]);
    ok("...and nothing is linked", link.length === 0, link);
    const line = await lineOf(office, r.body?.id);
    ok("the office's line says the details agree", line?.family_line === "details_agree" || line?.familyLine === "details_agree", line);
    const read = await api(`/api/family-list/${HIL}`, { token: office });
    ok("the office reads the switch off", read.body?.linksAtOnce === false, read.body?.linksAtOnce);
  }

  group("5. A departed uploader's row links nobody");
  {
    await switchOn(true);
    const email = `walk.family.office.${RUN}@example.invalid`;
    const [u] = await q(`insert into app_user (school_id, email, name, role) values ($1, $2, 'Walk Office', 'schooladmin') returning id`, [HIL, email]);
    await q(`insert into role_assignment (person_id, role, school_id, valid_from) values ($1, 'schooladmin', $2, sa_today() - 30)`, [u.id, HIL]);
    const temp = await login(email);
    const E = await boy("E", 14);
    const up = await list(temp, { commit: true, rows: [{ playerId: E.id, email: addr_("gone"), kind: "guardian", relationship: "parent" }] });
    ok("the office person lists a row", up.status === 200 && up.body?.committed, up.body);
    await q(`update role_assignment set active = false where person_id = $1`, [u.id]);
    const p = await google(`walk-gone-${RUN}`, addr_("gone"));
    const r = await ask(p, E.born);
    ok("after he leaves, a full match on his row answers sent", r.status === 200 && r.body?.family === "sent" && r.body?.state === "pending", r.body);
    const line = await lineOf(office, r.body?.id);
    ok("the office's line says who listed it can no longer link", line?.family_line === "uploader_lapsed" || line?.familyLine === "uploader_lapsed", line);
  }

  group("6. The typed date is kept nowhere; End role on the linked row");
  {
    const wrongDay = iso(new Date(new Date(`${B.born}T12:00:00Z`).getTime() + 86400000));
    const hits = (await q(
      `select (select count(*) from family_register r where r::text like '%' || $1 || '%')
            + (select count(*) from role_request r where r::text like '%' || $1 || '%')
            + (select count(*) from access_log l where l::text like '%' || $1 || '%')
            + (select count(*) from notification n where n::text like '%' || $1 || '%') as n`, [wrongDay]))[0].n;
    ok("the date he typed is in no row", Number(hits) === 0, hits);
    const end = await api(`/api/assignments/${mumAssignment}/end`, { method: "POST", token: office, body: { reason: "Listed in error by the office; checked with the family." } });
    ok("the office ends the link the list made", end.status === 200 && end.body?.ended === true, end.body);
    const read = await api(`/api/family-list/${HIL}?state=claimed`, { token: office });
    ok("...and the row has no link to end any more", (read.body?.rows ?? []).find((x) => x.email === addr_("mum"))?.live_assignment === null, read.body?.rows);
    const coachEnd = await api(`/api/family-list/rows/${read.body?.rows?.[0]?.id}/withdraw`, { method: "POST", token: coach });
    ok("a coach may not withdraw a row", coachEnd.status === 403, coachEnd.body);
  }
} catch (e) {
  fail++; console.log("\n  ✗ the walk threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await switchOn(false).catch(() => {});
  await pool.end().catch(() => {});
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  console.log("\n" + "─".repeat(52));
  console.log(`FAMILY-REGISTER SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
