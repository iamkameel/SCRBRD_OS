#!/usr/bin/env node
/**
 * A handover that never finishes.
 *
 * tools/smoke-handover.mjs walks the clean case: arm, claim, verify, carry on.
 * This is the one the audit found untested. Device B claims the match — the
 * token moves, scoring locks for verification — and then B dies before it
 * verifies: battery, drop, a phone left in a bag. The spec's answer is the
 * lease: nobody can score until it lapses, and then somebody who holds the
 * correction capability force-releases the match, the epoch moves on, and A
 * (or anyone) claims it fresh. B's late balls land in quarantine; they do not
 * merge.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-handover-crash.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";

const PORT = 8888, BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const MATCH = "77777777-0000-0000-0000-000000000002";
const SCORER = "scorer@example.invalid", COACH = "coach@example.invalid", DOS = "sarah@example.invalid";
const DEV_A = "device-crash-a", DEV_B = "device-crash-b";
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002", "aaaaaaaa-0000-0000-0000-000000000003"];

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);
const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-crash-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email, deviceId) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const post = (token, device, epoch, evs, from = 1) => api(`/api/matches/${MATCH}/events`, {
  method: "POST", token,
  body: { events: evs.map((payload, i) => ({ epoch, deviceId: device, idempotencyKey: `${device}:${epoch}:${from + i}`,
                                              clientSeq: from + i, clientTs: Date.now(), innings: 0, payload })) },
});
const session = (path, token, body) => api(`/api/matches/${MATCH}/session/${path}`, { method: "POST", token, body });
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) { try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  const tokenA = await login(SCORER, DEV_A), tokenB = await login(COACH, DEV_B), tokenD = await login(DOS, "device-dos");

  group("Device A scores, and arms a handover");
  const claimA = await session("claim", tokenA, { device: DEV_A });
  ok("A claims the match", claimA.body?.ok === true, JSON.stringify(claimA.body));
  const epochA = claimA.body.epoch;
  const opened = await post(tokenA, DEV_A, epochA, [
    inningsStart({ innings: 0, battingTeam: "HIL", bowlingTeam: "MHS", oversLimit: 20 }),
    batters({ striker: P[0], nonStriker: P[1] }), bowler({ bowler: P[2] }),
    ball({ type: BALL_TYPE.RUN, value: 4, striker: P[0], nonStriker: P[1], bowler: P[2] }),
    ball({ type: BALL_TYPE.RUN, value: 1, striker: P[0], nonStriker: P[1], bowler: P[2] }),
  ]);
  ok("A's balls are accepted", opened.body?.accepted?.length === 5, JSON.stringify(opened.body).slice(0, 160));
  const arm = await session("handover/arm", tokenA, { device: DEV_A, pending: 0, ballInFlight: false });
  ok("A arms the handover and gets a code", arm.body?.ok === true && /^\d{6}$/.test(arm.body?.code ?? ""), JSON.stringify(arm.body));

  group("Device B claims — and then dies");
  const claimB = await session("handover/claim", tokenB, { device: DEV_B, code: arm.body.code });
  ok("B claims with the code", claimB.body?.ok === true, JSON.stringify(claimB.body).slice(0, 160));
  // B never verifies. Nothing about that is visible to the server yet: from
  // where it sits, verification is simply pending.
  const st = (await q(`select state, epoch, holder_device, lease_until from scoring_session where match_id = $1`, [MATCH]))[0];
  ok("the session is waiting for B to verify", st?.state === "verifying", JSON.stringify(st));
  const lockedA = await post(tokenA, DEV_A, epochA, [ball({ type: BALL_TYPE.RUN, value: 2, striker: P[0], nonStriker: P[1], bowler: P[2] })], 10);
  ok("A cannot score while verification is pending", (lockedA.body?.accepted?.length ?? 0) === 0 && lockedA.body?.quarantined?.length === 1, JSON.stringify(lockedA.body));
  const claimAgain = await session("claim", tokenA, { device: DEV_A });
  ok("...nor simply claim it back: verifying", claimAgain.body?.ok === false && claimAgain.body?.reason === "verifying", JSON.stringify(claimAgain.body));

  group("Recovery waits for the lease");
  const early = await session("force-release", tokenD, {});
  ok("force-release is refused while B's lease is live", early.body?.ok === false && early.body?.reason === "lease_active", JSON.stringify(early.body));
  // Time passes: the lease lapses (nobody heartbeats a dead phone). The
  // walk does not wait ninety seconds; it moves the clock the way ninety
  // seconds would have.
  await q(`update scoring_session set lease_until = now() - interval '1 minute' where match_id = $1`, [MATCH]);
  // SCRBRD-059 / db/28: the lapse opens force-release, not a plain claim.
  // db/17 let a claim through here; with no heartbeat outside ACTIVE, that
  // was ninety seconds after the last ball whether B was dead or still
  // reading the scoreboard.
  const claimLapsed = await session("claim", tokenA, { device: DEV_A });
  ok("a lapsed lease does not reopen a plain claim past verification", claimLapsed.body?.ok === false && claimLapsed.body?.reason === "verifying", JSON.stringify(claimLapsed.body));
  const noCap = await post(tokenB, DEV_B, epochA + 1, [ball({ type: BALL_TYPE.RUN, value: 1 })], 50);
  ok("a ball from the dead device after its lease lapsed is quarantined, not merged", noCap.body?.quarantined?.length === 1, JSON.stringify(noCap.body));
  const release = await session("force-release", tokenD, {});
  ok("someone holding scoring.correct force-releases once the lease has lapsed", release.body?.ok === true, JSON.stringify(release.body));
  const epochNew = release.body?.epoch;
  ok("the epoch moved on", Number.isInteger(epochNew) && epochNew > epochA);
  const audit = await q(`select event from scoring_audit where match_id = $1 and event = 'force_release'`, [MATCH]);
  ok("...and the audit trail says so", audit.length >= 1);

  group("Scoring resumes on a fresh claim; the dead device's late work is quarantined");
  const reclaim = await session("claim", tokenA, { device: DEV_A });
  // A claim is a transition too, so the epoch moves once more: the spec says
  // "incremented on every claim, transfer, and force-release".
  ok("A claims the idle match, under a fresh epoch", reclaim.body?.ok === true && reclaim.body?.epoch === epochNew + 1, JSON.stringify(reclaim.body));
  const epochResumed = reclaim.body?.epoch;
  const onward = await post(tokenA, DEV_A, epochResumed, [ball({ type: BALL_TYPE.RUN, value: 6, striker: P[0], nonStriker: P[1], bowler: P[2] })], 60);
  ok("A scores under the new epoch", onward.body?.accepted?.length === 1, JSON.stringify(onward.body));
  const lateVerify = await session("handover/verify", tokenB, { device: DEV_B, runs: 5, wickets: 0, balls: 2 });
  ok("B's late verify is refused", lateVerify.body?.ok !== true, JSON.stringify(lateVerify.body));
  const lateBall = await post(tokenB, DEV_B, epochA + 1, [ball({ type: BALL_TYPE.RUN, value: 1 })], 70);
  ok("B's late ball is quarantined under its dead epoch", lateBall.body?.quarantined?.length === 1, JSON.stringify(lateBall.body));
  const log = (await api(`/api/matches/${MATCH}/events?since=0`, { token: tokenD })).body?.events ?? [];
  ok("the log is A's five balls and the one after recovery — nothing from the dead handover", log.length === 6 && log.every((e) => e.device_id === DEV_A), `${log.length} events`);
} catch (e) {
  ok(`the crash walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}
if (fail && serverErr.length) { console.log("\nServer stderr:"); console.log(serverErr.join("").split("\n").slice(0, 12).join("\n")); }
console.log(`\n${"─".repeat(52)}\nHANDOVER CRASH SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
