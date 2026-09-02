#!/usr/bin/env node
/**
 * Gate 3 from the backend's "Honest status": an AIRPLANE-MODE OVER.
 *
 * Six balls scored with no connection, then a reconnect, then the log
 * reconciles and the scorecard is correct. This is the claim that separates
 * "works offline" from "works offline and is still one match afterwards", and
 * it is the last thing that has to be true before two devices can score
 * together.
 *
 * Unlike the other suites this runs against a REAL Postgres and a REAL HTTP
 * server. The fakes in write.test.mjs prove the logic; only this proves that
 * Postgres accepts the insert, that RLS lets the scorer through and stops
 * everyone else, and that a log which made the round trip replays to the same
 * numbers it left with.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-sync.mjs
 */
import { spawn } from "node:child_process";
import { SyncEngine, memoryStorage } from "../services/api/write/sync-engine.mjs";
import {
  deriveInnings, fromRow, inningsStart, batters, bowler, ball, BALL_TYPE,
  undoLast, newEventId, KIND,
} from "@scrbrd/scoring";

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const MATCH = "77777777-0000-0000-0000-000000000002";   // Hilton U19A v Michaelhouse, scheduled
const SCORER = "scorer@example.invalid";
const COACH  = "coach@example.invalid";
const MEDIC  = "medical@example.invalid";
const DEVICE = "device-pavilion-01";

// Seeded U19A players, so the FKs on striker/bowler resolve.
const P = [
  "aaaaaaaa-0000-0000-0000-000000000001",
  "aaaaaaaa-0000-0000-0000-000000000002",
  "aaaaaaaa-0000-0000-0000-000000000003",
];

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

// ── Boot the real server ─────────────────────────────────────────
const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-sync-secret" },
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
    try { const r = await api("/api/health"); if (r.body?.db === "ok") return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: DEVICE },
})).body?.token;

try {
  ok("server comes up and reaches the database", await waitForHealth());

  // ── Identity ───────────────────────────────────────────────────
  group("Signing in");
  const scorerToken = await login(SCORER);
  ok("scorer signs in", typeof scorerToken === "string");

  const profile = await api("/api/session", { token: scorerToken });
  ok("session profile returns the person", profile.body?.user?.email === SCORER);
  ok("profile lists their assignments", (profile.body?.assignments || []).some(a => a.role === "scorer"));
  // The profile is presentation input, not an authorization answer — it must
  // never contain someone else's assignments.
  ok("profile carries only their own assignments",
     (profile.body?.assignments || []).length === 1);

  const noToken = await api("/api/session");
  ok("no token → refused", noToken.status === 401);

  // ── Claim the scoring token ────────────────────────────────────
  group("Claiming the match");
  const claim = await api(`/api/matches/${MATCH}/session/claim`, {
    method: "POST", token: scorerToken, body: { device: DEVICE },
  });
  ok("scorer claims the match", claim.body?.ok === true);
  const epoch = claim.body?.epoch;
  ok("claim returns an epoch", typeof epoch === "number" && epoch >= 1);

  // Negative control: the medical officer holds no scoring capability, and the
  // refusal comes from the database rather than from a check in a handler.
  const medicToken = await login(MEDIC);
  const medicClaim = await api(`/api/matches/${MATCH}/session/claim`, {
    method: "POST", token: medicToken, body: { device: "device-physio" },
  });
  ok("medical officer cannot claim the match",
     medicClaim.body?.ok === false && medicClaim.body?.reason === "no_capability");

  // ── The over, with the network down ────────────────────────────
  group("Six balls with no signal");
  let online = false;
  const sent = [];
  const engine = new SyncEngine({
    matchId: MATCH, deviceId: DEVICE, scorerId: profile.body.user.id, epoch, innings: 0,
    storage: memoryStorage(),
    isOnline: () => online,
    transport: async (matchId, batch) => {
      sent.push(batch.length);
      const r = await api(`/api/matches/${matchId}/events`, {
        method: "POST", token: scorerToken, body: { events: batch },
      });
      if (r.status !== 200) throw new Error(`${r.status}: ${JSON.stringify(r.body)}`);
      return r.body;
    },
  });
  await engine.init();

  // The innings has to open with its context: who is batting, who is bowling,
  // and the squads names resolve from. Without these the log cannot stand
  // alone, which is the whole reason those event kinds exist.
  const squad = P.map((id, i) => ({ id, name: `Player ${i + 1}` }));
  await engine.record(inningsStart({ battingTeam: "Hilton U19A", bowlingTeam: "Michaelhouse", squad, overs: 20 }));
  await engine.record(batters({ striker: P[0], nonStriker: P[1] }));
  await engine.record(bowler({ bowler: P[2] }));

  // 1 · 4 · 0 · 2 · 0 · 6  = 13 off the over.
  const OVER = [1, 4, 0, 2, 0, 6];
  for (const runs of OVER) await engine.record(ball({ type: BALL_TYPE.RUN, value: runs }));

  ok("nothing was sent while offline", sent.length === 0);
  ok("every event is queued locally", engine.pendingCount === 3 + OVER.length);
  ok("handover is refused while balls are unsynced", engine.safeToHandOver === false);

  const localScore = deriveInnings(
    [...engine.pending].map((e) => e.payload), {});
  ok(`the device shows ${localScore.runs}/${localScore.wickets} off ${localScore.balls} balls`,
     localScore.runs === 13 && localScore.wickets === 0 && localScore.balls === 6);

  // ── Reconnect ──────────────────────────────────────────────────
  group("Reconnecting");
  online = true;
  const flush = await engine.sync();
  if (engine.lastError) console.log("  [sync error]", engine.lastError);
  ok("the whole over flushed in one batch", sent.length === 1 && sent[0] === 9);
  ok("every event was accepted", flush.flushed === 9 && flush.remaining === 0);
  ok("nothing was quarantined", engine.rejected.length === 0);
  ok("handover is safe again", engine.safeToHandOver === true);

  // A retry of an already-sent batch must not double-count. This is what the
  // idempotency key is for, and it is not hypothetical: a response lost on a
  // flaky connection looks exactly like a failure to the device.
  const replayPost = await api(`/api/matches/${MATCH}/events`, {
    method: "POST", token: scorerToken, body: { events: engine.acked.map(({ seq, ...e }) => e) },
  });
  ok("a retried batch is recognised, not appended",
     replayPost.body?.duplicates?.length === 9 && replayPost.body?.accepted?.length === 0);

  // ── The server's log is the same match ─────────────────────────
  group("Reconciling");
  const listed = await api(`/api/matches/${MATCH}/events?since=0`, { token: scorerToken });
  const rows = listed.body?.events || [];
  ok("the server holds all nine events", rows.length === 9);
  ok("seq is contiguous from 1", rows.every((r, i) => r.seq === i + 1));
  ok("every event carries the claiming epoch", rows.every((r) => r.epoch === epoch));
  ok("provenance is recorded on every ball",
     rows.every((r) => r.device_id === DEVICE && r.scorer_user_id === profile.body.user.id));

  const rebuilt = deriveInnings(rows.map(fromRow), {});
  ok(`replaying the server log gives ${rebuilt.runs}/${rebuilt.wickets} off ${rebuilt.balls}`,
     rebuilt.runs === localScore.runs && rebuilt.wickets === localScore.wickets && rebuilt.balls === localScore.balls);
  ok("the over is complete and the strike rotated correctly",
     rebuilt.overLog.length === 1 && rebuilt.striker === P[0]);
  // 1 · 4 · 0 · 2 · 0 · 6: the single off the first ball rotates the strike, so
  // the opener faces one ball and the partner scores the other twelve. Asserting
  // the split rather than the total is what catches a replay that loses strike
  // rotation — a bug an aggregate score hides completely.
  ok("strike rotation survived the round trip",
     rebuilt.batsmen.find((b) => b.id === P[0])?.runs === 1 &&
     rebuilt.batsmen.find((b) => b.id === P[1])?.runs === 12);
  ok("the bowler's figures survived the round trip",
     rebuilt.bowlers.find((b) => b.id === P[2])?.runs === 13);

  // ── A stale device is quarantined, not merged ──────────────────
  group("A device on a revoked epoch");
  const stale = await api(`/api/matches/${MATCH}/events`, {
    method: "POST", token: scorerToken,
    body: { events: [{ epoch: epoch - 1, deviceId: DEVICE, idempotencyKey: `${DEVICE}:stale:1`,
                       clientSeq: 99, clientTs: Date.now(), innings: 0,
                       payload: ball({ type: BALL_TYPE.RUN, value: 4 }) }] },
  });
  ok("a ball from an old epoch is quarantined", stale.body?.quarantined?.length === 1);
  ok("...with the reason recorded", stale.body?.quarantined?.[0]?.reason === "stale_epoch_or_lease");
  const after = await api(`/api/matches/${MATCH}/events?since=0`, { token: scorerToken });
  ok("...and never reaches the log", (after.body?.events || []).length === 9);

  // ── Undoing a ball the server already has ──────────────
  group("Undo, after the ball has synced");
  {
    // Everything in the log has been acked, so undo cannot truncate: the
    // server's copy is append-only and a second device may already have
    // replayed it. The correction has to be an event of its own.
    const local = engine.acked.map((e) => ({ ...e.payload, id: e.idempotencyKey }));
    const scoreBefore = deriveInnings(local, {});
    const u = undoLast(local, { isSynced: () => true });
    ok("a synced ball is voided rather than dropped", u.action === "void");
    ok("...and the void names the ball", u.events.at(-1).target === local.at(-1).id);

    // Send the void the same way a ball goes.
    const voidEv = u.events.at(-1);
    const posted = await api(`/api/matches/${MATCH}/events`, {
      method: "POST", token: scorerToken,
      body: { events: [{ epoch, deviceId: DEVICE, idempotencyKey: newEventId(DEVICE, MATCH),
                         clientSeq: 100, clientTs: Date.now(), innings: 0, payload: voidEv }] },
    });
    ok("the server accepts a void like any other event", posted.body?.accepted?.length === 1);

    const reread = await api(`/api/matches/${MATCH}/events?since=0`, { token: scorerToken });
    const rows = reread.body?.events || [];
    ok("the log GREW — nothing was deleted", rows.length === 10);
    ok("...and the append-only log still holds the voided ball",
       rows.some((r) => r.kind === "ball" && r.seq === 9));

    // The proof: replaying the server's log gives the score the scorer sees.
    // Each event's identity comes back off idempotency_key, which is what the
    // void names — see fromRow().
    const rebuilt = deriveInnings(rows.map(fromRow), {});
    ok(`the server replays to ${rebuilt.runs}/${rebuilt.wickets} off ${rebuilt.balls}`,
       rebuilt.runs === scoreBefore.runs - 6 && rebuilt.balls === scoreBefore.balls - 1);
    ok("...and reports the correction rather than hiding it", rebuilt.voided === 1);
    ok("the void is in the log as an event", rows.some((r) => r.kind === KIND.VOID));
  }

  // ── Who may read the log ───────────────────────────────────────
  group("Reading the log");
  const coachToken = await login(COACH);
  const LOG_LENGTH = 10;   // nine scored events plus the void
  const coachRead = await api(`/api/matches/${MATCH}/events?since=0`, { token: coachToken });
  ok("the coach of this team reads the log", (coachRead.body?.events || []).length === LOG_LENGTH);

  // A physio follows the score like anyone else — reading a fixture is not a
  // medical disclosure, and fixture.read is in almost every bundle. What they
  // cannot do is write to it.
  const medicRead = await api(`/api/matches/${MATCH}/events?since=0`, { token: medicToken });
  ok("the medical officer can follow the score", (medicRead.body?.events || []).length === LOG_LENGTH);

  // The sharpest write control available: sign the medic's token to the SAME
  // device that holds the live lease, so every application-level gate passes
  // and the only thing left to refuse the insert is the row-level policy.
  // If this ever succeeds, the database has stopped being the authority.
  const medicOnLease = await api("/api/auth/dev-login", {
    method: "POST", body: { email: MEDIC, deviceId: DEVICE },
  });
  const medicWrite = await api(`/api/matches/${MATCH}/events`, {
    method: "POST", token: medicOnLease.body.token,
    body: { events: [{ epoch, deviceId: DEVICE, idempotencyKey: `${DEVICE}:medic:1`,
                       clientSeq: 1, clientTs: Date.now(), innings: 0,
                       payload: ball({ type: BALL_TYPE.RUN, value: 4 }) }] },
  });
  ok("the medical officer cannot append a ball", medicWrite.status !== 200);
  const afterMedic = await api(`/api/matches/${MATCH}/events?since=0`, { token: scorerToken });
  ok("...and the log is untouched", (afterMedic.body?.events || []).length === LOG_LENGTH);

  const anon = await api(`/api/matches/${MATCH}/events?since=0`);
  ok("an unauthenticated request is refused", anon.status === 401);

  // Incremental sync: a device that already has the over asks only for what
  // came after it.
  const incremental = await api(`/api/matches/${MATCH}/events?since=${LOG_LENGTH}`, { token: scorerToken });
  ok("since= returns only what is new", (incremental.body?.events || []).length === 0);
} catch (e) {
  ok(`the airplane-mode over threw: ${e.message?.slice(0, 100)}`, false);
  console.log(e.stack?.split("\n").slice(0, 4).join("\n"));
} finally {
  server.kill("SIGTERM");
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nSYNC SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
