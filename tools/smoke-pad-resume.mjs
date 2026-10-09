#!/usr/bin/env node
/**
 * The pad's resume credential against the real server and Postgres
 * (SCRBRD-078 option B, SCRBRD-087, db/50).
 *
 *   A. Issued on a claim, to the device holding the token — and only then;
 *      the database keeps the public key and a hash, never the id.
 *   B. Good for its match's heartbeat, re-claim, events both ways and toss.
 *   C. Refused, live: a replayed jti, a stale time, the wrong key, another
 *      match, another device's batch, a body changed on the way.
 *   D. The scope escape: a validly signed request to EVERY route the server
 *      mounts (read out of server.mjs, tools/mounted-routes.mjs) and every
 *      read resource — pupils, medical, contacts, discipline — is 403
 *      pad_scope, and nothing was read or written by any of them.
 *   E. SCRBRD-087 with an ordinary token: a second device of the same person
 *      cannot keep the first device's lease alive.
 *   F. Every way it ends: a handover, a force-release, a sign-out, the
 *      office (and nobody else), the day, a revoked scorer, the match.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-pad-resume.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { newPadKeyPair, padPublicJwk, padProof, padAuthorization } from "@scrbrd/sync";
import { inningsStart, batters, bowler, ball, BALL_TYPE, newEventId } from "@scrbrd/scoring";
import { mountedRoutes } from "./mounted-routes.mjs";
import { PAD_ROUTES } from "../services/api/auth/pad-resume.mjs";
import { liveResources } from "../services/api/read/read-api.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8813);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const MATCH = "77777777-0000-0000-0000-000000000002";   // Hilton 1st XI v Michaelhouse: nothing scored
const OTHER = "77777777-0000-0000-0000-000000000003";   // another Hilton fixture the scorer may score
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002", "aaaaaaaa-0000-0000-0000-000000000003"];
const DEV_A = "pad-resume-phone-a", DEV_B = "pad-resume-phone-b", DEV_C = "pad-resume-phone-c";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-pad-resume-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const pool = new pg.Pool({ connectionString: DB });
const q = async (text, params) => (await pool.query(text, params)).rows;

/** An ordinary request, with a bearer token or none. */
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email, deviceId) =>
  (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;

/**
 * A device holding a credential: its id and its key. `send` signs a request
 * exactly as apps/web/src/lib/padKey.js does; the options let a test sign one
 * thing and send another.
 */
const padDevice = (credential, key) => ({
  credential, key,
  async send(path, { method = "GET", body, now, jti, signKey, signPath, signBody } = {}) {
    const text = body === undefined ? "" : JSON.stringify(body);
    const proof = await padProof({ credentialId: credential, privateKey: signKey ?? key, method, path: signPath ?? path,
                                   bodyText: signBody ?? text, ...(now ? { now } : {}), ...(jti ? { jti } : {}) });
    const res = await fetch(BASE + path, {
      method, headers: { "content-type": "application/json", authorization: padAuthorization(proof) },
      body: body === undefined ? undefined : text,
    });
    return { status: res.status, body: await res.json().catch(() => null), proof };
  },
});

/** Issue a credential to a signed-in device that holds the token. */
const issue = async (token, match = MATCH, jwkOverride) => {
  const pair = await newPadKeyPair();
  const jwk = jwkOverride ?? await padPublicJwk(pair);
  const r = await api(`/api/matches/${match}/session/pad-credential`, { method: "POST", token, body: { jwk } });
  return { r, dev: r.body?.ok ? padDevice(r.body.credential, pair.privateKey) : null };
};
const claim = (token, device, match = MATCH) =>
  api(`/api/matches/${match}/session/claim`, { method: "POST", token, body: { device } });
const lapse = (match = MATCH) => q(`update scoring_session set lease_until = now() - interval '5 minutes' where match_id = $1`, [match]);
const row = async (credential) => (await q(`select * from pad_resume_credential where id = $1`, [credential]))[0];
const credOf = async (userEmail, device, match = MATCH) => (await q(
  `select c.* from pad_resume_credential c join app_user u on u.id = c.user_id
    where u.email = $1 and c.device_id = $2 and c.match_id = $3 order by c.issued_at desc limit 1`, [userEmail, device, match]))[0];

/** An outbox envelope, as packages/sync makes one. */
let seq = 0;
const envelope = (payload, epoch, deviceId = DEV_A) => {
  seq += 1;
  const withId = { ...payload, id: payload.id ?? newEventId(deviceId) };
  return { epoch, deviceId, clientSeq: seq, clientTs: Date.now(), innings: 0, idempotencyKey: withId.id, payload: withId };
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── A ──────────────────────────────────────────────────────────
  group("A. Issued on a claim, to the device holding the token — and only then");
  let scorerA = await login("scorer@example.invalid", DEV_A);
  const scorerB = await login("scorer@example.invalid", DEV_B);
  const medic = await login("medical@example.invalid", "pad-resume-medic");
  ok("the scorer signs in on two phones", !!scorerA && !!scorerB && !!medic);

  const before = await issue(scorerA);
  ok("before any claim: refused, not_token_holder", before.r.body?.ok === false && before.r.body?.reason === "not_token_holder", JSON.stringify(before.r.body));
  const c1 = await claim(scorerA, DEV_A);
  ok("phone A claims the match", c1.body?.ok === true, JSON.stringify(c1.body));
  let epoch = c1.body?.epoch;

  const withD = await issue(scorerA, MATCH, { kty: "EC", crv: "P-256", x: "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4",
    y: "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM", d: "870MB6gfuTJ4HtUnUvYMyJpr5eUZNP4Bk43bVdj3eAE" });
  ok("a key sent with its private part is refused, 400 bad_key", withD.r.status === 400 && withD.r.body?.error === "bad_key");
  const offCurve = await issue(scorerA, MATCH, { kty: "EC", crv: "P-256", x: "A".repeat(43), y: "B".repeat(43) });
  ok("a point that is not on the curve is refused", offCurve.r.status === 400);
  const fromB = await issue(scorerB);
  ok("the same person on phone B, which does not hold the token: not_token_holder", fromB.r.body?.reason === "not_token_holder");
  const fromMedic = await issue(medic);
  ok("the medical officer: no_capability", fromMedic.r.body?.reason === "no_capability");

  const first = await issue(scorerA);
  ok("phone A, holding the token, is issued one", first.r.body?.ok === true && typeof first.r.body?.credential === "string", JSON.stringify(first.r.body));
  const { dev: A1 } = await issue(scorerA);
  ok("a second issue to the same phone and match: a new one", !!A1);
  const expect = await q(`select (date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') + interval '1 day') AT TIME ZONE 'Africa/Johannesburg' as t`);
  const rA1 = await credOf("scorer@example.invalid", DEV_A);
  ok("...ending at midnight in Johannesburg tonight", new Date(rA1?.expires_at).getTime() === new Date(expect[0].t).getTime(), `${rA1?.expires_at} v ${expect[0].t}`);
  const all = await q(`select id, revoked_reason, id_hash, public_jwk, jkt from pad_resume_credential where match_id = $1 order by issued_at`, [MATCH]);
  ok("...and the first is ended as 'reissued': one live credential per phone and match",
     all.length === 2 && all[0].revoked_reason === "reissued" && all[1].revoked_reason === null);
  ok("the database holds a hash of the id, never the id", all.every((r) => /^[0-9a-f]{64}$/.test(r.id_hash))
     && !JSON.stringify(all).includes(first.r.body.credential) && !JSON.stringify(all).includes(A1.credential));
  ok("...and the public key: kty, crv, x, y, nothing private", all.every((r) => Object.keys(r.public_jwk).sort().join(",") === "crv,kty,x,y"));
  ok("...with its RFC 7638 thumbprint", all.every((r) => /^[A-Za-z0-9_-]{43}$/.test(r.jkt)));
  const audit = await q(`select count(*)::int n from scoring_audit where match_id = $1 and event = 'pad_resume_issued'`, [MATCH]);
  ok("each issue is in the scoring audit", audit[0].n === 2);
  const oldDev = padDevice(first.r.body.credential, (await newPadKeyPair()).privateKey);
  ok("the reissued one no longer works", (await oldDev.send(`/api/matches/${MATCH}/events`)).status === 401);

  // ── B ──────────────────────────────────────────────────────────
  group("B. Good for its match's heartbeat, re-claim, events and toss");
  const hb = await A1.send(`/api/matches/${MATCH}/session/heartbeat`, { method: "POST", body: { device: DEV_A, epoch } });
  ok("the heartbeat", hb.status === 200 && hb.body?.ok === true && hb.body?.epoch === epoch, JSON.stringify(hb.body));
  const tossNone = await A1.send(`/api/matches/${MATCH}/toss`);
  ok("the toss, before one is recorded: none", tossNone.status === 200 && tossNone.body?.toss === null, JSON.stringify(tossNone.body));
  const tossPost = await A1.send(`/api/matches/${MATCH}/toss`, { method: "POST", body: { wonBy: "home", decision: "bat" } });
  ok("recording a toss with the credential: 403 pad_scope (read only)", tossPost.status === 403 && tossPost.body?.error === "pad_scope");
  ok("...nothing recorded", (await q(`select 1 from match_toss where match_id = $1`, [MATCH])).length === 0);
  await api(`/api/matches/${MATCH}/toss`, { method: "POST", token: scorerA, body: { wonBy: "home", decision: "bat" } });
  const toss = await A1.send(`/api/matches/${MATCH}/toss`);
  ok("the toss the scorer recorded signed in, read with the credential",
     toss.body?.toss?.toss_won_by === "home" && toss.body?.toss?.toss_decision === "bat" && toss.body?.toss?.bats_first === "home", JSON.stringify(toss.body));

  const squad = P.map((id, i) => ({ id, name: `Player ${i + 1}` }));
  const opening = [
    envelope(inningsStart({ battingTeam: "Hilton 1st XI", bowlingTeam: "Michaelhouse", squad, overs: 20 }), epoch),
    envelope(batters({ striker: P[0], nonStriker: P[1] }), epoch),
    envelope(bowler({ bowler: P[2] }), epoch),
    envelope(ball({ type: BALL_TYPE.RUN, value: 4 }), epoch),
  ];
  const sent = await A1.send(`/api/matches/${MATCH}/events`, { method: "POST", body: { events: opening } });
  ok("four events appended with the credential", sent.status === 200 && sent.body?.accepted?.length === 4, JSON.stringify(sent.body));
  const stored = await q(`select b.device_id, u.email from ball_event b join app_user u on u.id = b.scorer_user_id where b.match_id = $1`, [MATCH]);
  ok("...stored as the scorer, on phone A", stored.length === 4 && stored.every((r) => r.device_id === DEV_A && r.email === "scorer@example.invalid"));
  const log = await A1.send(`/api/matches/${MATCH}/events?since=0`);
  ok("the log read back with the credential", log.status === 200 && log.body?.events?.length === 4);

  await lapse();
  const re = await A1.send(`/api/matches/${MATCH}/session/claim`, { method: "POST", body: { device: DEV_A } });
  ok("a lapsed lease, still this phone's: re-claimed with the credential", re.body?.ok === true && re.body?.epoch === epoch + 1, JSON.stringify(re.body));
  epoch = re.body?.epoch;
  const after = await A1.send(`/api/matches/${MATCH}/events`, { method: "POST", body: { events: [envelope(ball({ type: BALL_TYPE.RUN, value: 1 }), epoch)] } });
  ok("...and the next ball goes into the log under it", after.body?.accepted?.length === 1, JSON.stringify(after.body));
  // SCRBRD-089: "For review N" survives a reload. The events read says how
  // many of THIS device's events the server holds for review — through the
  // pad-scoped route, with the credential, nothing widened.
  const noneYet = await A1.send(`/api/matches/${MATCH}/events?since=0`);
  ok("the events read says nothing is held for review yet (quarantined 0)", noneYet.body?.quarantined === 0, JSON.stringify(noneYet.body?.quarantined));
  const staleBall = await A1.send(`/api/matches/${MATCH}/events`, { method: "POST", body: { events: [envelope(ball({ type: BALL_TYPE.RUN, value: 2 }), epoch - 1)] } });
  ok("a ball sent under the old generation is held for review", staleBall.body?.quarantined?.length === 1, JSON.stringify(staleBall.body));
  const review = await A1.send(`/api/matches/${MATCH}/events?since=0`);
  ok("...and the events read, with the credential, says so: quarantined 1", review.status === 200 && review.body?.quarantined === 1,
     JSON.stringify(review.body?.quarantined));
  const reviewTok = await api(`/api/matches/${MATCH}/events?since=0`, { token: scorerA });
  ok("...and the same read, signed in on phone A, says the same", reviewTok.body?.quarantined === 1, JSON.stringify(reviewTok.body?.quarantined));
  const reviewB = await api(`/api/matches/${MATCH}/events?since=0`, { token: scorerB });
  ok("...but on phone B, the same scorer: 0 — the count is this device's", reviewB.body?.quarantined === 0, JSON.stringify(reviewB.body?.quarantined));
  ok("the credential still holds after its own re-claim", (await row(rA1.id)).revoked_at === null);

  // ── C ──────────────────────────────────────────────────────────
  group("C. Refused, live");
  const once = await A1.send(`/api/matches/${MATCH}/events?since=0`);
  const replay = await fetch(`${BASE}/api/matches/${MATCH}/events?since=0`, { headers: { authorization: padAuthorization(once.proof) } });
  ok("the same signed request twice: 401 pad_replay", replay.status === 401 && (await replay.json())?.error === "pad_replay");
  const stale = await A1.send(`/api/matches/${MATCH}/events`, { now: Date.now() - 10 * 60e3 });
  ok("ten minutes stale: 401 pad_stale, with the server's time", stale.status === 401 && stale.body?.error === "pad_stale"
     && Math.abs(stale.body?.serverTime - Date.now()) < 10e3, JSON.stringify(stale.body));
  const thief = await A1.send(`/api/matches/${MATCH}/events`, { signKey: (await newPadKeyPair()).privateKey });
  ok("the id, signed with another key: 401 pad_bad_signature", thief.status === 401 && thief.body?.error === "pad_bad_signature");
  const other = await A1.send(`/api/matches/${OTHER}/events`);
  ok("another match's log: 403 pad_scope", other.status === 403 && other.body?.error === "pad_scope");
  const otherHb = await A1.send(`/api/matches/${OTHER}/session/heartbeat`, { method: "POST", body: { device: DEV_A, epoch: 1 } });
  ok("another match's heartbeat: 403 pad_scope", otherHb.status === 403);
  const wrongDev = await A1.send(`/api/matches/${MATCH}/events`, { method: "POST", body: { events: [envelope(ball({ type: BALL_TYPE.RUN, value: 2 }), epoch, DEV_B)] } });
  ok("a batch naming another phone: 403 device_mismatch", wrongDev.status === 403 && wrongDev.body?.error === "device_mismatch", JSON.stringify(wrongDev.body));
  const tamper = await A1.send(`/api/matches/${MATCH}/events`, { method: "POST", body: { events: [] }, signBody: JSON.stringify({ events: [1] }) });
  ok("a body other than the one signed: 401 pad_wrong_request", tamper.status === 401 && tamper.body?.error === "pad_wrong_request");
  const moved = await A1.send(`/api/matches/${MATCH}/events?since=3`, { signPath: `/api/matches/${MATCH}/events?since=0` });
  ok("a query other than the one signed: 401 pad_wrong_request", moved.status === 401 && moved.body?.error === "pad_wrong_request");
  ok("none of those wrote anything", (await q(`select count(*)::int n from ball_event where match_id = $1`, [MATCH]))[0].n === 5);

  // ── D ──────────────────────────────────────────────────────────
  group("D. The scope escape: every route the server mounts, signed, refuses the credential");
  const routes = [
    ...mountedRoutes({ id: MATCH, resources: liveResources() }),
    ...mountedRoutes({ id: OTHER, resources: [] }).filter((r) => r.path.includes(OTHER)),
  ];
  const five = (r) => PAD_ROUTES.some(([m, re]) => m === r.method && re.test(r.path)) && r.path.includes(MATCH);
  const counts0 = await q(`select (select count(*) from ball_event)::int be, (select count(*) from match_toss)::int mt,
                                  (select count(*) from scoring_audit)::int sa, (select count(*) from request_replay)::int rr,
                                  (select count(*) from access_log)::int al`);
  const escaped = [];
  let walked = 0;
  for (const r of routes.filter((x) => !five(x))) {
    const res = await A1.send(r.path, { method: r.method, ...(r.method === "GET" ? {} : { body: {} }) });
    walked += 1;
    if (!(res.status === 403 && res.body?.error === "pad_scope")) escaped.push(`${r.method} ${r.path} → ${res.status} ${JSON.stringify(res.body).slice(0, 60)}`);
  }
  ok(`${walked} routes and read resources, signed with a live credential: every one 403 pad_scope`, escaped.length === 0 && walked > 150, escaped.slice(0, 5).join(" | "));
  ok("...pupils, medical, contacts and discipline among them",
     ["players", "injuries", "emergency_contacts", "disciplinary_records", "trip_contacts"].every((x) => routes.some((r) => r.path === `/api/read/${x}`)));
  ok("...another match's five routes among them", routes.filter((r) => r.path.includes(OTHER)).length >= 5);
  const counts1 = await q(`select (select count(*) from ball_event)::int be, (select count(*) from match_toss)::int mt,
                                  (select count(*) from scoring_audit)::int sa, (select count(*) from request_replay)::int rr,
                                  (select count(*) from access_log)::int al`);
  ok("...and not one row was written or logged by any of them", JSON.stringify(counts0) === JSON.stringify(counts1), `${JSON.stringify(counts0)} v ${JSON.stringify(counts1)}`);
  ok("the credential still works afterwards (nothing about the walk revoked it)",
     (await A1.send(`/api/matches/${MATCH}/session/heartbeat`, { method: "POST", body: { device: DEV_A, epoch } })).body?.ok === true);

  // ── E ──────────────────────────────────────────────────────────
  group("E. SCRBRD-087 with an ordinary token: phone B cannot keep phone A's lease alive");
  const lease0 = (await q(`select lease_until from scoring_session where match_id = $1`, [MATCH]))[0].lease_until;
  const batchB = await api(`/api/matches/${MATCH}/events`, { method: "POST", token: scorerB, body: { events: [envelope(ball({ type: BALL_TYPE.RUN, value: 1 }), epoch, DEV_A)] } });
  ok("phone B's token, a batch naming phone A: 403 device_mismatch", batchB.status === 403 && batchB.body?.error === "device_mismatch", JSON.stringify(batchB.body));
  const hbB = await api(`/api/matches/${MATCH}/session/heartbeat`, { method: "POST", token: scorerB, body: { device: DEV_A, epoch } });
  ok("phone B's token, a heartbeat naming phone A: refused, device_mismatch", hbB.body?.ok === false && hbB.body?.reason === "device_mismatch", JSON.stringify(hbB.body));
  const hbB2 = await api(`/api/matches/${MATCH}/session/heartbeat`, { method: "POST", token: scorerB, body: { epoch } });
  ok("phone B's own heartbeat: B does not hold it", hbB2.body?.ok === false);
  ok("...and phone A's lease was not extended by any of them",
     new Date((await q(`select lease_until from scoring_session where match_id = $1`, [MATCH]))[0].lease_until).getTime() === new Date(lease0).getTime());
  const claimB = await claim(scorerB, DEV_A);
  ok("phone B's token claiming as phone A: refused, device_mismatch", claimB.body?.ok === false && claimB.body?.reason === "device_mismatch");

  // ── F ──────────────────────────────────────────────────────────
  group("F1. The token moves by handover: the credential ends");
  const coachC = await login("coach@example.invalid", DEV_C);
  const arm = await api(`/api/matches/${MATCH}/session/handover/arm`, { method: "POST", token: scorerA, body: { device: DEV_A, pending: 0 } });
  ok("phone A arms a handover, signed in", arm.body?.ok === true, JSON.stringify(arm.body));
  const armPad = await A1.send(`/api/matches/${MATCH}/session/handover/arm`, { method: "POST", body: { device: DEV_A, pending: 0 } });
  ok("(arming with the credential is refused: 403 pad_scope)", armPad.status === 403);
  ok("while it is only armed, the credential stands", (await row(rA1.id)).revoked_at === null);
  const hc = await api(`/api/matches/${MATCH}/session/handover/claim`, { method: "POST", token: coachC, body: { device: DEV_C, code: arm.body?.code } });
  ok("the coach claims it on phone C", hc.body?.ok === true, JSON.stringify(hc.body));
  const v = await api(`/api/matches/${MATCH}/session/handover/verify`, { method: "POST", token: coachC, body: { device: DEV_C, runs: 5, wickets: 0, balls: 2 } });
  ok("...and takes over", v.body?.ok === true, JSON.stringify(v.body));
  ok("phone A's credential: revoked, token_moved", (await row(rA1.id)).revoked_reason === "token_moved");
  const afterHandover = await A1.send(`/api/matches/${MATCH}/session/heartbeat`, { method: "POST", body: { device: DEV_A, epoch } });
  ok("...and says so: 401 pad_revoked token_moved", afterHandover.status === 401 && afterHandover.body?.error === "pad_revoked"
     && afterHandover.body?.detail === "token_moved", JSON.stringify(afterHandover.body));

  group("F2. Force-released: the credential ends");
  const { dev: C1 } = await issue(coachC);
  ok("the coach's phone is issued one", !!C1);
  await lapse();
  const sarah = await login("sarah@example.invalid", "pad-resume-sarah");
  const fr = await api(`/api/matches/${MATCH}/session/force-release`, { method: "POST", token: sarah });
  ok("the director of sport force-releases the dead phone", fr.body?.ok === true, JSON.stringify(fr.body));
  const rC1 = await credOf("coach@example.invalid", DEV_C);
  ok("the coach's credential: revoked, released", rC1?.revoked_reason === "released");
  const afterRelease = await C1.send(`/api/matches/${MATCH}/session/claim`, { method: "POST", body: { device: DEV_C } });
  ok("...its re-claim: 401 pad_revoked released", afterRelease.status === 401 && afterRelease.body?.detail === "released");
  ok("...and the match stays released", (await q(`select state from scoring_session where match_id = $1`, [MATCH]))[0].state === "idle");

  group("F3. The phone signs out: the credential ends");
  ok("phone A claims again", (await claim(scorerA, DEV_A)).body?.ok === true);
  const { dev: A2 } = await issue(scorerA);
  const so = await api("/api/auth/sign-out", { method: "POST", token: scorerA });
  ok("sign-out ends this phone's credentials", so.status === 200 && so.body?.revoked === 1, JSON.stringify(so.body));
  const afterSignOut = await A2.send(`/api/matches/${MATCH}/events?since=0`);
  ok("...401 pad_revoked signed_out", afterSignOut.status === 401 && afterSignOut.body?.detail === "signed_out");
  const signOutPad = await A2.send("/api/auth/sign-out", { method: "POST", body: {} });
  ok("(a credential cannot call sign-out, or anything else: 403 pad_scope)", signOutPad.status === 403);
  // GA-I03 (db/85): the phone's bearer token ends with it.
  const tokenAfter = await api("/api/session", { token: scorerA });
  ok("...and the phone's token is refused too: 401 session_revoked", tokenAfter.status === 401 && tokenAfter.body?.error === "session_revoked", JSON.stringify(tokenAfter.body));
  scorerA = await login("scorer@example.invalid", DEV_A);
  ok("...until the scorer signs in again", (await api("/api/session", { token: scorerA })).status === 200);

  group("F4. The school office revokes it — and nobody else can");
  const { dev: A3 } = await issue(scorerA);
  ok("phone A is issued another", !!A3);
  const coach2 = await login("coach2@example.invalid", "pad-resume-coach2");
  const wesAdmin = await login("registrar.wes@example.invalid", "pad-resume-wes");
  const registrar = await login("registrar@example.invalid", "pad-resume-registrar");
  ok("the 2XI coach (no user.invite): 403", (await api(`/api/matches/${MATCH}/pad-credentials/revoke`, { method: "POST", token: coach2, body: {} })).status === 403);
  ok("Westville's office: 403", (await api(`/api/matches/${MATCH}/pad-credentials/revoke`, { method: "POST", token: wesAdmin, body: {} })).status === 403);
  ok("the scorer himself: 403", (await api(`/api/matches/${MATCH}/pad-credentials/revoke`, { method: "POST", token: scorerA, body: {} })).status === 403);
  ok("...and it still works", (await A3.send(`/api/matches/${MATCH}/events?since=0`)).status === 200);
  const off = await api(`/api/matches/${MATCH}/pad-credentials/revoke`, { method: "POST", token: registrar, body: {} });
  ok("Hilton's office revokes it", off.status === 200 && off.body?.revoked === 1, JSON.stringify(off.body));
  const afterOffice = await A3.send(`/api/matches/${MATCH}/events?since=0`);
  ok("...401 pad_revoked office", afterOffice.status === 401 && afterOffice.body?.detail === "office");
  const offAudit = await q(`select detail from scoring_audit where match_id = $1 and event = 'pad_resume_revoked' order by at desc limit 1`, [MATCH]);
  ok("...on the scoring audit", offAudit[0]?.detail?.reason === "office");

  group("F4b. The office disables the scorer's account: the credential ends (GA-I03)");
  const SCORER = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  /** Phone A holds the match: claimed again, after a lapse when another device holds it. */
  const holdA = async () => {
    if ((await claim(scorerA, DEV_A)).body?.ok === true) return true;
    await lapse();
    return (await claim(scorerA, DEV_A)).body?.ok === true;
  };
  ok("phone A holds the match", await holdA());
  const { dev: AD } = await issue(scorerA);
  ok("phone A is issued another, and it works for an active account",
     !!AD && (await AD.send(`/api/matches/${MATCH}/events?since=0`)).status === 200);
  const dis = await api(`/api/auth/users/${SCORER}/disable`, { method: "POST", token: registrar,
                                                                     body: { reason: "Pad walk: the phone was lost" } });
  ok("Hilton's office disables the scorer's account", dis.status === 200 && dis.body?.active === false, JSON.stringify(dis.body));
  const afterDisable = await AD.send(`/api/matches/${MATCH}/events?since=0`);
  ok("...the credential: 401 pad_revoked account_disabled", afterDisable.status === 401 && afterDisable.body?.error === "pad_revoked"
     && afterDisable.body?.detail === "account_disabled", JSON.stringify(afterDisable.body));
  ok("...and the row says so", (await credOf("scorer@example.invalid", DEV_A))?.revoked_reason === "account_disabled");
  ok("...and the phone's token is refused", (await api("/api/session", { token: scorerA })).status === 401);
  const en = await api(`/api/auth/users/${SCORER}/enable`, { method: "POST", token: registrar,
                                                                   body: { reason: "Pad walk: the phone was found" } });
  ok("the office enables the account again", en.status === 200 && en.body?.active === true, JSON.stringify(en.body));
  ok("...and the revoked credential stays revoked", (await AD.send(`/api/matches/${MATCH}/events?since=0`)).status === 401);
  scorerA = await login("scorer@example.invalid", DEV_A);
  ok("the scorer signs in again and holds the match", await holdA());
  const { dev: AE } = await issue(scorerA);
  ok("...and a fresh credential works", !!AE && (await AE.send(`/api/matches/${MATCH}/events?since=0`)).status === 200);
  // A plain UPDATE (the owner, in the SQL editor: since db/90 the
  // application cannot write app_user.active) ends it too: the rule is a
  // trigger on app_user, not a step in the route.
  await q(`update app_user set active = false where id = $1`, [SCORER]);
  const afterUpdate = await AE.send(`/api/matches/${MATCH}/events?since=0`);
  ok("an account disabled by a plain UPDATE: 401 pad_revoked account_disabled", afterUpdate.status === 401
     && afterUpdate.body?.detail === "account_disabled", JSON.stringify(afterUpdate.body));
  await q(`update app_user set active = true where id = $1`, [SCORER]);

  group("F4c. Sign out everywhere ends the phone's credential too (GA-I03)");
  scorerA = await login("scorer@example.invalid", DEV_A);
  ok("phone A holds the match again", await holdA());
  const { dev: AF } = await issue(scorerA);
  const scorerElsewhere = await login("scorer@example.invalid", "pad-resume-laptop");
  ok("a credential, and the scorer signed in on a laptop", !!AF && (await AF.send(`/api/matches/${MATCH}/events?since=0`)).status === 200);
  const everywhere = await api("/api/auth/sign-out-everywhere", { method: "POST", token: scorerElsewhere });
  ok("the scorer signs out everywhere, from the laptop", everywhere.status === 200, JSON.stringify(everywhere.body));
  const afterEverywhere = await AF.send(`/api/matches/${MATCH}/events?since=0`);
  ok("...the phone's credential: 401 pad_revoked signed_out_everywhere", afterEverywhere.status === 401
     && afterEverywhere.body?.detail === "signed_out_everywhere", JSON.stringify(afterEverywhere.body));
  ok("...and the phone's token", (await api("/api/session", { token: scorerA })).status === 401);
  scorerA = await login("scorer@example.invalid", DEV_A);
  ok("the scorer signs in again and holds the match", await holdA());

  group("F5. The match day ends");
  const { dev: A4 } = await issue(scorerA);
  const rA4 = await credOf("scorer@example.invalid", DEV_A);
  await q(`update pad_resume_credential set issued_at = now() - interval '2 days', expires_at = now() - interval '1 second' where id = $1`, [rA4.id]);
  const afterDay = await A4.send(`/api/matches/${MATCH}/events?since=0`);
  ok("past midnight: 401 pad_expired", afterDay.status === 401 && afterDay.body?.error === "pad_expired", JSON.stringify(afterDay.body));

  group("F6. A revoked scorer: the credential carries no authority of its own");
  const { dev: A5 } = await issue(scorerA);
  ok("phone A is issued another", !!A5);
  await q(`update role_assignment set active = false
            where person_id = (select id from app_user where email = 'scorer@example.invalid')`);
  const hbRevoked = await A5.send(`/api/matches/${MATCH}/session/heartbeat`, { method: "POST", body: { device: DEV_A, epoch: 0 } });
  ok("the heartbeat: no_capability, on the next request", hbRevoked.body?.ok === false && hbRevoked.body?.reason === "no_capability", JSON.stringify(hbRevoked.body));
  const evRevoked = await A5.send(`/api/matches/${MATCH}/events`, { method: "POST", body: { events: [envelope(ball({ type: BALL_TYPE.RUN, value: 1 }), 99)] } });
  ok("a ball: 403 not_permitted", evRevoked.status === 403 && evRevoked.body?.error === "not_permitted", JSON.stringify(evRevoked.body));
  const logRevoked = await A5.send(`/api/matches/${MATCH}/events?since=0`);
  ok("the log: nothing", logRevoked.status === 200 && logRevoked.body?.events?.length === 0);

  group("F7. The match completes: the credential ends");
  await lapse();
  const cc = await claim(coachC, DEV_C);
  ok("the coach claims on phone C", cc.body?.ok === true, JSON.stringify(cc.body));
  const { dev: C2 } = await issue(coachC);
  ok("...and is issued one", !!C2);
  const done = await api(`/api/fixtures/${MATCH}`, { method: "POST", token: sarah, body: { status: "complete" } });
  ok("the director of sport marks the match complete", done.status === 200 && done.body?.status === "complete", JSON.stringify(done.body));
  const afterDone = await C2.send(`/api/matches/${MATCH}/events?since=0`);
  ok("...401 pad_revoked match_complete", afterDone.status === 401 && afterDone.body?.detail === "match_complete", JSON.stringify(afterDone.body));
  const lateIssue = await issue(coachC);
  ok("...and none is issued on a complete match", lateIssue.r.body?.ok === false);
} catch (e) {
  fail++;
  console.log("\n  ✗ threw:", e.message, e.stack?.split("\n").slice(1, 3).join(" "));
} finally {
  server.kill();
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) console.log("\nserver stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
console.log(`\n${"─".repeat(52)}\nPAD RESUME SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
