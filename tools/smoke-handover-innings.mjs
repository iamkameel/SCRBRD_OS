#!/usr/bin/env node
/**
 * A handover verifies against THIS innings, penalties included (SCRBRD-088).
 *
 * The incoming scorer reads the physical scoreboard and types what it says:
 * runs, wickets, and the legal deliveries bowled THIS innings (the sheet asks
 * for overs and balls; apps/web handover.js sends overs × 6 + balls). The fold
 * keeps those per innings, and a penalty award is in its total. Until db/45
 * the server's check summed every innings of the match and read only `value`,
 * which a penalty row does not carry — so a handover after the first innings,
 * or after a penalty, could never verify: the honest answer was refused, and
 * the only answer accepted was a number no scoreboard shows.
 *
 * Two handovers through the real API, each stated as the incoming device's
 * own fold of the log it was handed (deriveMatch — the innings it is on):
 *
 *   1. in the first innings, after five penalty runs to the batting side;
 *   2. in the second innings — after the first was sealed — after a penalty
 *      to the batting side, one to the fielding side and a deliberate short
 *      run. The fielding side's fives are not in this innings: they are in
 *      the fielding side's own completed innings, the first, and raise the
 *      target (SCRBRD-094, db/48) — which the live score read says too.
 *
 * And the old wrong answers are refused: the match's totals across both
 * innings, and this innings without its penalty runs. The server takes a
 * short run's award only straight after its dot delivery.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-handover-innings.mjs
 */
import { spawn } from "node:child_process";
import {
  deriveMatch, fromRow, inningsStart, batters, bowler, ball, penalty, sealInnings, shortRunning,
  BALL_TYPE, INNINGS_END_REASON, REFUSAL,
} from "@scrbrd/scoring";

const PORT = 8893;
const BASE = `http://127.0.0.1:${PORT}`;
const MATCH = "77777777-0000-0000-0000-000000000002";
const SCORER = "scorer@example.invalid";   // device A
const COACH  = "coach@example.invalid";    // device B
const DEV_A = "device-innings-a";
const DEV_B = "device-innings-b";

const P = [1, 2, 3, 4, 5, 6].map((n) => `aaaaaaaa-0000-0000-0000-00000000000${n}`);

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-handover-innings-secret" },
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

// Each device numbers its own events, as the outbox does.
const nextSeq = { [DEV_A]: 0, [DEV_B]: 0 };
/** Post events as a device, the way the sync engine would. The envelope says
 *  innings 0, as the pad's always does; the event's own innings decides. */
const post = (token, device, epoch, evs) => api(`/api/matches/${MATCH}/events`, {
  method: "POST", token,
  body: {
    events: evs.map((payload) => {
      const n = ++nextSeq[device];
      return { epoch, deviceId: device, idempotencyKey: `${device}:${epoch}:${n}`,
               clientSeq: n, clientTs: Date.now(), innings: 0, payload };
    }),
  },
});

const readLog = async (token) =>
  ((await api(`/api/matches/${MATCH}/events?since=0`, { token })).body?.events) || [];

/** What the incoming device's own fold says: the innings it is on. */
const onBoard = (rows) => {
  const m = deriveMatch(rows.map(fromRow), {});
  const inn = m.innings[m.current];
  return { innings: m.current, runs: inn?.runs, wickets: inn?.wickets, balls: inn?.balls, all: m.innings };
};

/** Arm on `from`, claim on `to`, and return what the claim handed over. */
const handOver = async (fromTok, fromDev, toTok, toDev) => {
  const arm = await api(`/api/matches/${MATCH}/session/handover/arm`, {
    method: "POST", token: fromTok, body: { device: fromDev, pending: 0, ballInFlight: false },
  });
  const claim = await api(`/api/matches/${MATCH}/session/handover/claim`, {
    method: "POST", token: toTok, body: { device: toDev, code: arm.body?.code },
  });
  return { arm, claim };
};

const verify = (token, device, f) => api(`/api/matches/${MATCH}/session/handover/verify`, {
  method: "POST", token, body: { device, runs: f.runs, wickets: f.wickets, balls: f.balls },
});
const said = (r) => `ok=${r.body?.ok} reason=${r.body?.reason} expected ${r.body?.exp_runs}/${r.body?.exp_wkts} off ${r.body?.exp_balls}`;

try {
  const health = await waitForHealth();
  ok("server comes up and reaches the database", !!health);

  const tokenA = await login(SCORER, DEV_A);
  const tokenB = await login(COACH, DEV_B);
  const claimA = await api(`/api/matches/${MATCH}/session/claim`, {
    method: "POST", token: tokenA, body: { device: DEV_A },
  });
  ok("device A claims the match", claimA.body?.ok === true, JSON.stringify(claimA.body));
  const epochA = claimA.body?.epoch;

  // ── The first innings, with a penalty ─────────────────────────
  group("First innings: an over, five penalty runs, then the pen changes hands");
  const squad = P.map((id, i) => ({ id, name: `Player ${i + 1}` }));
  const first = [
    inningsStart({ battingTeam: "Hilton 1st XI", bowlingTeam: "Michaelhouse", squad, overs: 20 }),
    batters({ striker: P[0], nonStriker: P[1] }),
    bowler({ bowler: "T Mokoena" }),
    ball({ type: BALL_TYPE.RUN, value: 1 }),
    ball({ type: BALL_TYPE.RUN, value: 4 }),
    ball({ type: BALL_TYPE.WIDE, value: 0 }),
    ball({ type: BALL_TYPE.RUN, value: 0 }),
    // Law 41: five penalty runs to the batting side. No ball bowled, so
    // nothing but the total moves.
    penalty({ runs: 5, toBattingTeam: true, reason: "ball_tampering" }),
    ball({ type: BALL_TYPE.RUN, value: 2 }),
    ball({ type: BALL_TYPE.RUN, value: 6 }),
    ball({ type: BALL_TYPE.RUN, value: 4 }),
  ];
  const w1 = await post(tokenA, DEV_A, epochA, first);
  ok("the first innings' events are accepted", w1.body?.accepted?.length === first.length, JSON.stringify(w1.body));

  const h1 = await handOver(tokenA, DEV_A, tokenB, DEV_B);
  ok("device B claims a handover in the first innings", h1.claim.body?.ok === true, JSON.stringify(h1.claim.body));
  const b1 = onBoard(h1.claim.body?.events || []);
  ok(`device B's fold reads innings ${b1.innings + 1}: ${b1.runs}/${b1.wickets} off ${b1.balls}, penalty included`,
     b1.innings === 0 && b1.runs === 23 && b1.wickets === 0 && b1.balls === 6);
  const noPen1 = await verify(tokenB, DEV_B, { ...b1, runs: b1.runs - 5 });
  ok("this innings without its penalty runs is refused", noPen1.body?.ok === false && noPen1.body?.reason === "verify_mismatch", said(noPen1));
  ok("...and the server says it expects the fold's figures",
     noPen1.body?.exp_runs === b1.runs && noPen1.body?.exp_wkts === b1.wickets && noPen1.body?.exp_balls === b1.balls, said(noPen1));
  const v1 = await verify(tokenB, DEV_B, b1);
  ok("the fold's figures verify after a penalty award", v1.body?.ok === true, said(v1));
  const epochB = v1.body?.epoch;

  // ── The first innings ends; the second begins ─────────────────
  group("Second innings: a penalty each way, then the pen changes hands again");
  const log1 = (await readLog(tokenB)).map(fromRow);
  const inn0 = deriveMatch(log1, {}).innings[0];
  const seal = await post(tokenB, DEV_B, epochB, [sealInnings(inn0, INNINGS_END_REASON.DECLARED)]);
  ok("device B seals the first innings", seal.body?.accepted?.length === 1, JSON.stringify(seal.body));

  const second = [
    inningsStart({ innings: 1, battingTeam: "Michaelhouse", bowlingTeam: "Hilton 1st XI", squad, overs: 20, target: 24 }),
    batters({ innings: 1, striker: "S Zulu", nonStriker: "M Nkosi" }),
    bowler({ innings: 1, bowler: P[2] }),
    ball({ innings: 1, type: BALL_TYPE.RUN, value: 6 }),
    ball({ innings: 1, type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }),
    batters({ innings: 1, striker: "T Dube" }),
    ball({ innings: 1, type: BALL_TYPE.NO_BALL, value: 1 }),
    // Five to the batting side: in this innings' total.
    penalty({ innings: 1, runs: 5, toBattingTeam: true, reason: "helmet_struck" }),
    // Five to the fielding side: in Hilton's first innings, not this one.
    penalty({ innings: 1, runs: 5, toBattingTeam: false, reason: "pitch_damage" }),
    ball({ innings: 1, type: BALL_TYPE.LEG_BYE, value: 1 }),
    // A deliberate short run: the delivery counts with no run, and five more to Hilton.
    ...shortRunning({ innings: 1, type: BALL_TYPE.RUN, value: 2 }),
  ];
  const w2 = await post(tokenB, DEV_B, epochB, second);
  ok("the second innings' events are accepted", w2.body?.accepted?.length === second.length, JSON.stringify(w2.body));

  const h2 = await handOver(tokenB, DEV_B, tokenA, DEV_A);
  ok("device A claims a handover in the second innings", h2.claim.body?.ok === true, JSON.stringify(h2.claim.body));
  const b2 = onBoard(h2.claim.body?.events || []);
  ok(`device A's fold reads innings ${b2.innings + 1}: ${b2.runs}/${b2.wickets} off ${b2.balls}`,
     b2.innings === 1 && b2.runs === 14 && b2.wickets === 1 && b2.balls === 4);
  ok("...the first innings, sealed at 23/0 off 6, has the fielding side's two fives: 33",
     b2.all[0]?.runs === 33 && b2.all[0]?.balls === 6 && b2.all[0]?.sealed === true && b2.all[0]?.penaltyCarried === 10);
  ok("...and the chase's target rose from 24 to 34", b2.all[1]?.target === 34, `${b2.all[1]?.target}`);
  const live = (await api(`/api/read/live_score?matchId=${MATCH}`, { token: tokenA })).body?.rows || [];
  ok("the live score read says the same: 33 and 14",
     live.length === 2 && Number(live[0].runs) === 33 && Number(live[1].runs) === 14, JSON.stringify(live));

  // The answers the old check wanted: every innings of the match, by value.
  const byValue = (h2.claim.body?.events || []).filter((r) => r.kind !== "void");
  const matchTotals = {
    runs: byValue.reduce((s, r) => s + (r.ball_type === "Wd" || r.ball_type === "Nb" ? 1 : 0) + (r.value ?? 0), 0),
    wickets: byValue.filter((r) => r.ball_type === "W").length,
    balls: byValue.filter((r) => r.kind === "ball" && r.ball_type !== "Wd" && r.ball_type !== "Nb").length,
  };
  ok(`the match's totals by value read ${matchTotals.runs}/${matchTotals.wickets} off ${matchTotals.balls} — no scoreboard shows that`,
     matchTotals.runs === 27 && matchTotals.wickets === 1 && matchTotals.balls === 10);
  const old = await verify(tokenA, DEV_A, matchTotals);
  ok("the match's totals are refused", old.body?.ok === false && old.body?.reason === "verify_mismatch", said(old));
  ok("...and the server expects this innings' figures",
     old.body?.exp_runs === b2.runs && old.body?.exp_wkts === b2.wickets && old.body?.exp_balls === b2.balls, said(old));
  const noPen2 = await verify(tokenA, DEV_A, { ...b2, runs: b2.runs - 5 });
  ok("this innings without its penalty is refused", noPen2.body?.ok === false && noPen2.body?.reason === "verify_mismatch", said(noPen2));
  const bothPen = await verify(tokenA, DEV_A, { ...b2, runs: b2.runs + 5 });
  ok("...and so is one that adds the fielding side's penalty to it", bothPen.body?.ok === false, said(bothPen));
  const firstInn = await verify(tokenA, DEV_A, { runs: 33, wickets: 0, balls: 6 });
  ok("...and so is the first innings' score, now that the second is under way", firstInn.body?.ok === false, said(firstInn));
  const v2 = await verify(tokenA, DEV_A, b2);
  ok("the second innings' figures, off the incoming device's fold, verify", v2.body?.ok === true, said(v2));
  ok("...and the epoch advanced", v2.body?.epoch === epochB + 1);

  // The new holder scores on in the innings it verified.
  const on = await post(tokenA, DEV_A, v2.body?.epoch, [ball({ innings: 1, type: BALL_TYPE.RUN, value: 4 })]);
  ok("device A scores on in the second innings", on.body?.accepted?.length === 1, JSON.stringify(on.body));
  const after = onBoard(await readLog(tokenA));
  ok(`the second innings reads ${after.runs}/${after.wickets} off ${after.balls}`,
     after.innings === 1 && after.runs === 18 && after.balls === 5);
  // A short run's award with no dot delivery before it is refused, by name.
  const stray = await post(tokenA, DEV_A, v2.body?.epoch,
    [penalty({ innings: 1, runs: 5, toBattingTeam: false, reason: "short_running" })]);
  ok("a short-running award after a scoring ball is refused: short_run_unmatched",
     stray.body?.refused?.length === 1 && stray.body.refused[0].reason === REFUSAL.SHORT_RUN_UNMATCHED && !stray.body?.accepted?.length,
     JSON.stringify(stray.body));
} catch (e) {
  ok(`the walk threw: ${e.message?.slice(0, 100)}`, false);
  console.log(e.stack?.split("\n").slice(0, 4).join("\n"));
} finally {
  server.kill("SIGTERM");
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nHANDOVER-INNINGS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
