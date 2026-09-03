#!/usr/bin/env node
/**
 * Gate 4 from the backend's "Honest status": a LIVE TWO-DEVICE HANDOVER.
 *
 * A scorer's phone dies at the drinks break and someone else picks the match
 * up. That is the ordinary case, and it is the one where an event-sourced
 * design either pays for itself or quietly loses an over.
 *
 * The protocol, and why each step exists:
 *
 *   ARM     the outgoing device offers the token, and states how many balls it
 *           has NOT yet sent. A handover with unsynced work is refused: those
 *           balls exist on one phone, and once the token moves they can never
 *           be merged without a conflict nobody can adjudicate.
 *
 *   CLAIM   the incoming device presents a code shown on the outgoing screen.
 *           This is a human confirming they are standing next to each other,
 *           not a security boundary — the capability check is separate and
 *           comes first. Scoring stays LOCKED at this point.
 *
 *   VERIFY  the incoming device replays the log it was handed and states the
 *           score it computed. The server checks that against its OWN replay
 *           of ball_event, never against a stored total. Agreement is what
 *           proves both devices are looking at the same match; disagreement
 *           stops the handover and is written to the audit trail.
 *
 * Only then does the epoch bump, which is what makes the old device's in-flight
 * balls quarantine rather than merge.
 *
 * Runs against a real Postgres and a real HTTP server.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-handover.mjs
 */
import { spawn } from "node:child_process";
import {
  deriveInnings, fromRow, inningsStart, batters, bowler, ball, BALL_TYPE,
  newEventId, undoLast,
} from "@scrbrd/scoring";

const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;
const MATCH = "77777777-0000-0000-0000-000000000002";
const SCORER = "scorer@example.invalid";   // device A — starts the match
const COACH  = "coach@example.invalid";    // device B — takes it over
const MEDIC  = "medical@example.invalid";  // holds no scoring capability
const DEV_A = "device-pavilion-01";
const DEV_B = "device-boundary-02";

const P = [
  "aaaaaaaa-0000-0000-0000-000000000001",
  "aaaaaaaa-0000-0000-0000-000000000002",
  "aaaaaaaa-0000-0000-0000-000000000003",
];

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-handover-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const waitForHealth = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") return r.body; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};

const login = async (email, device) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: device },
})).body?.token;

/** Post events as a device, the way the sync engine would. */
const post = (token, device, epoch, evs, from = 1) => api(`/api/matches/${MATCH}/events`, {
  method: "POST", token,
  body: {
    events: evs.map((payload, i) => ({
      epoch, deviceId: device, idempotencyKey: `${device}:${epoch}:${from + i}`,
      clientSeq: from + i, clientTs: Date.now(), innings: 0, payload,
    })),
  },
});

const readLog = async (token) =>
  ((await api(`/api/matches/${MATCH}/events?since=0`, { token })).body?.events) || [];

try {
  const health = await waitForHealth();
  ok("server comes up and reaches the database", !!health);
  ok("handover routes are mounted", health?.handover === "mounted");

  // ── Device A opens the match ───────────────────────────────────
  group("Device A scores the first over");
  const tokenA = await login(SCORER, DEV_A);
  const meA = (await api("/api/session", { token: tokenA })).body;
  const claimA = await api(`/api/matches/${MATCH}/session/claim`, {
    method: "POST", token: tokenA, body: { device: DEV_A },
  });
  ok("device A claims the match", claimA.body?.ok === true);
  const epochA = claimA.body.epoch;

  const squad = P.map((id, i) => ({ id, name: `Player ${i + 1}` }));
  const opening = [
    inningsStart({ battingTeam: "Hilton U19A", bowlingTeam: "Michaelhouse", squad, overs: 20 }),
    batters({ striker: P[0], nonStriker: P[1] }),
    bowler({ bowler: P[2] }),
    ...[1, 4, 0, 2, 0, 6].map((v) => ball({ type: BALL_TYPE.RUN, value: v })),
  ];
  const wrote = await post(tokenA, DEV_A, epochA, opening);
  ok("device A's over reaches the server", wrote.body?.accepted?.length === 9);

  const logA = await readLog(tokenA);
  const scoreA = deriveInnings(logA.map(fromRow), {});
  ok(`device A shows ${scoreA.runs}/${scoreA.wickets} off ${scoreA.balls}`,
     scoreA.runs === 13 && scoreA.wickets === 0 && scoreA.balls === 6);

  // ── A correction, before the handover ──────────────────────────
  group("An over with a correction in it");
  // The case that makes a handover impossible if anything counts the log
  // differently. Undo on a SYNCED ball appends a `void` naming it — the log is
  // append-only, so the ball is still there — and every party that folds the
  // log has to agree to skip it: the outgoing device, the incoming device, and
  // the SQL that checks the confirmation. Miss it in one place and a corrected
  // over can never be handed over, with both sides certain they are right.
  const mistake = ball({ type: BALL_TYPE.RUN, value: 4 });
  await post(tokenA, DEV_A, epochA, [mistake], 10);
  const withMistake = deriveInnings((await readLog(tokenA)).map(fromRow), {});
  ok("a wrong ball goes in like any other", withMistake.runs === 17);

  const corrected = undoLast(
    (await readLog(tokenA)).map(fromRow), { isSynced: () => true });
  ok("undoing it produces a void, not a deletion", corrected.action === "void");
  await post(tokenA, DEV_A, epochA, [corrected.events.at(-1)], 11);

  const afterVoid = deriveInnings((await readLog(tokenA)).map(fromRow), {});
  ok("the correction takes the runs back off", afterVoid.runs === 13);
  ok("...without removing anything from the log", (await readLog(tokenA)).length === 11);

  // ── Arming: the unsynced gate ──────────────────────────────────
  group("Arming the handover");
  // The gate that matters. Those balls exist on one phone; once the token
  // moves there is no way to merge them that anyone could adjudicate.
  const armBusy = await api(`/api/matches/${MATCH}/session/handover/arm`, {
    method: "POST", token: tokenA, body: { device: DEV_A, pending: 3, ballInFlight: false },
  });
  ok("a handover with unsynced balls is refused",
     armBusy.body?.ok === false && armBusy.body?.reason === "unsynced_work");

  const armMidBall = await api(`/api/matches/${MATCH}/session/handover/arm`, {
    method: "POST", token: tokenA, body: { device: DEV_A, pending: 0, ballInFlight: true },
  });
  ok("a handover mid-delivery is refused",
     armMidBall.body?.ok === false && armMidBall.body?.reason === "ball_in_flight");

  // Not the token holder → refused, even holding the capability.
  const tokenB = await login(COACH, DEV_B);
  const armWrong = await api(`/api/matches/${MATCH}/session/handover/arm`, {
    method: "POST", token: tokenB, body: { device: DEV_B, pending: 0, ballInFlight: false },
  });
  ok("a device that does not hold the token cannot arm",
     armWrong.body?.ok === false && armWrong.body?.reason === "not_token_holder");

  const arm = await api(`/api/matches/${MATCH}/session/handover/arm`, {
    method: "POST", token: tokenA, body: { device: DEV_A, pending: 0, ballInFlight: false },
  });
  ok("a synced device arms the handover", arm.body?.ok === true);
  ok("...and gets a code to read out", /^\d{6}$/.test(arm.body?.code || ""));

  // ── Claiming ───────────────────────────────────────────────────
  group("Device B claims it");
  const wrongCode = await api(`/api/matches/${MATCH}/session/handover/claim`, {
    method: "POST", token: tokenB, body: { device: DEV_B, code: "000000" },
  });
  ok("the wrong code is refused",
     wrongCode.body?.ok === false && wrongCode.body?.reason === "verify_mismatch");

  // The code is a human confirming they are standing there. Capability is
  // checked separately and first — someone with no scoring rights is refused
  // even holding the right code.
  const tokenM = await login(MEDIC, "device-physio");
  const medicClaim = await api(`/api/matches/${MATCH}/session/handover/claim`, {
    method: "POST", token: tokenM, body: { device: "device-physio", code: arm.body.code },
  });
  ok("the right code does not help someone with no scoring capability",
     medicClaim.body?.ok === false && medicClaim.body?.reason === "no_capability");

  const claimB = await api(`/api/matches/${MATCH}/session/handover/claim`, {
    method: "POST", token: tokenB, body: { device: DEV_B, code: arm.body.code },
  });
  ok("device B claims with the code", claimB.body?.ok === true);
  ok("...and is handed the whole log to rebuild from", (claimB.body?.events || []).length === 11);
  ok("...including the correction, so it derives the same score",
     deriveInnings((claimB.body.events || []).map(fromRow), {}).runs === 13);

  // Scoring is LOCKED between claim and verify: neither device may write.
  const lockedA = await post(tokenA, DEV_A, epochA, [ball({ type: BALL_TYPE.RUN, value: 4 })], 20);
  ok("the outgoing device cannot score while verification is pending",
     lockedA.body?.quarantined?.length === 1);

  // ── Verifying ──────────────────────────────────────────────────
  group("Device B verifies what it is taking on");
  // The server checks these against its own replay of ball_event, never
  // against a stored total — that is what makes agreement mean something.
  const bad = await api(`/api/matches/${MATCH}/session/handover/verify`, {
    method: "POST", token: tokenB, body: { device: DEV_B, runs: 99, wickets: 0, balls: 6 },
  });
  ok("a disagreement about the score stops the handover",
     bad.body?.ok === false && bad.body?.reason === "verify_mismatch");
  // The proof the SQL honours the void too: it expects 13, not the 17 it would
  // report if it counted the ball that was taken back.
  ok("the server's own count excludes the voided ball", bad.body?.exp_runs === 13);

  // Device B replays the log it was handed and states what it computed.
  const rebuilt = deriveInnings((claimB.body.events || []).map(fromRow), {});
  const verify = await api(`/api/matches/${MATCH}/session/handover/verify`, {
    method: "POST", token: tokenB,
    body: { device: DEV_B, runs: rebuilt.runs, wickets: rebuilt.wickets, balls: rebuilt.balls },
  });
  ok("device B's own replay matches the server's", verify.body?.ok === true);
  const epochB = verify.body.epoch;
  ok("the epoch advanced on takeover", epochB === epochA + 1);

  // ── After the handover ─────────────────────────────────────────
  group("After the handover");
  // The whole point of bumping the epoch: the old device's in-flight balls
  // land in quarantine for a human to look at, rather than merging into a
  // match it is no longer scoring.
  const staleA = await post(tokenA, DEV_A, epochA, [ball({ type: BALL_TYPE.RUN, value: 4 })], 30);
  ok("the old device's next ball is quarantined",
     staleA.body?.quarantined?.length === 1 &&
     staleA.body.quarantined[0].reason === "stale_epoch_or_lease");

  const contB = await post(tokenB, DEV_B, epochB, [
    ball({ type: BALL_TYPE.RUN, value: 4 }),
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }),
  ]);
  ok("device B scores on", contB.body?.accepted?.length === 2);

  const finalLog = await readLog(tokenB);
  ok("one continuous log, not two", finalLog.length === 13);
  ok("seq stayed contiguous across the handover", finalLog.every((r, i) => r.seq === i + 1));
  ok("the log records which device entered each ball",
     finalLog.filter((r) => r.device_id === DEV_A).length === 11 &&
     finalLog.filter((r) => r.device_id === DEV_B).length === 2);
  ok("...and which epoch it was entered under",
     finalLog.filter((r) => r.epoch === epochA).length === 11 &&
     finalLog.filter((r) => r.epoch === epochB).length === 2);

  const final = deriveInnings(finalLog.map(fromRow), {});
  ok(`the match reads ${final.runs}/${final.wickets} off ${final.balls} — one innings`,
     final.runs === 17 && final.wickets === 1 && final.balls === 8);
  // The continuity that matters: an opener device A put in faced one ball
  // before the handover and four runs plus their dismissal after it, and the
  // scorecard is one line, not two. Nothing about the change of device is
  // visible in the cricket.
  const opener = final.batsmen.find((b) => b.id === P[0]);
  ok("an opener's figures span both devices", opener?.runs === 5 && opener?.balls === 3);
  ok("...and a wicket taken by the incoming device is theirs", opener?.status === "out");

  // Device A reading the match still sees everything — losing the token is
  // not losing access to the fixture.
  const aStillReads = await readLog(tokenA);
  ok("the outgoing scorer can still follow the match", aStillReads.length === 13);
} catch (e) {
  ok(`the handover threw: ${e.message?.slice(0, 100)}`, false);
  console.log(e.stack?.split("\n").slice(0, 4).join("\n"));
} finally {
  server.kill("SIGTERM");
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nHANDOVER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
