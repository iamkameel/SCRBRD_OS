#!/usr/bin/env node
/**
 * Correcting a match after the scorer has gone home.
 *
 * A `void` recorded who corrected and never who approved, and in any case a
 * correction to a finished match was not merely unapproved — it was impossible.
 * ball_event_insert demands an ACTIVE session with a live lease, and a
 * completed match has none. That refusal is correct and stays; this is the
 * other door.
 *
 * The assertions worth reading are about SEPARATION OF DUTIES, because an
 * approval one person can give themselves is a formality with a column:
 *
 *   the scorer may request and may not approve
 *   nobody approves their own, whatever they hold
 *   the void is authored by the requester and approved by somebody else,
 *     and both names survive in the record
 *   the ordinary scoring path still cannot touch a finished match
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-amend.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8805;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL     = "11111111-1111-1111-1111-111111111111";
const MATCH   = "77777777-0000-0000-0000-000000000001";
const U_SCORER = "88888888-0000-0000-0000-000000000006";
const U_HEAD   = "88888888-0000-0000-0000-000000000007";
const P_BAT    = "aaaaaaaa-0000-0000-0000-000000000001";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-amend-secret" },
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
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-amend" } })).body?.token;
const ask = (match, token, body) => api(`/api/matches/${match}/amendments`, { method: "POST", token, body });
const decide = (id, token, body) => api(`/api/amendments/${id}/decide`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const runs = async () =>
  Number((await q(`select coalesce(sum(case when ball_type in ('run','W','Nb')
                                            then coalesce(value,0) else 0 end),0) r
                     from ball_event_live where match_id = $1 and kind='ball'`, [MATCH]))[0].r);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const scorer = await login("scorer@example.invalid");
  const head   = await login("sarah@example.invalid");     // directorofsport
  const coach  = await login("coach@example.invalid");     // holds neither

  // A finished match with one delivery on the record: six runs that were never
  // hit. The match is COMPLETE, so the ordinary path is shut.
  await q(`insert into ball_event
             (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
              idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id)
           values ($1,$2, 9001, 1, 0, $3, 'device-amend', 'wrong-six', 9001, now(),
                   'ball', 'run', 6, $4)`, [MATCH, HIL, U_SCORER, P_BAT]);
  await q(`update match set status = 'complete' where id = $1`, [MATCH]);

  group("The ordinary path cannot touch a finished match");
  const direct = await api(`/api/matches/${MATCH}/events`, {
    method: "POST", token: scorer,
    body: { events: [{ id: "sneak-void", kind: "void", seq: 9002, clientSeq: 9002,
                       ts: Date.now(), payload: { target: "wrong-six" } }] } });
  const stillThere = await q(
    `select 1 from ball_event_live where match_id=$1 and idempotency_key='wrong-six'`, [MATCH]);
  ok("...so a void posted straight at the log does not land", stillThere.length === 1);
  ok("...whatever the endpoint answered", direct.status === 200 || direct.status >= 400);
  const before = await runs();
  ok("the six is still in the total", before >= 6);

  group("A scorer may ASK");
  const bad = await ask(MATCH, scorer, { targetKey: "wrong-six" });
  ok("a request with no reason is refused", bad.body?.error === "reason_required");
  const req = await ask(MATCH, scorer, {
    targetKey: "wrong-six", reason: "Six credited to the wrong batter; it was four byes." });
  ok("a scorer may request an amendment", req.status === 200 && !!req.body?.id);
  ok("...and it starts pending", req.body?.state === "pending");
  ok("a coach holding neither capability may not request",
     (await ask(MATCH, coach, { targetKey: "wrong-six", reason: "x" })).status === 403);
  ok("asking twice about the same delivery is refused",
     (await ask(MATCH, scorer, { targetKey: "wrong-six", reason: "again" })).status >= 400);

  group("...and may not approve");
  const selfApprove = await decide(req.body.id, scorer, { approve: true });
  ok("the scorer cannot approve their own request", selfApprove.body?.ok === false);
  // Which refusal matters: they lack the capability entirely, so it is
  // not_permitted rather than the self-approval guard.
  ok("...because they do not hold the approval at all",
     selfApprove.body?.reason === "not_permitted");
  ok("the six is still there", (await runs()) === before);

  group("Nobody approves their own, whatever they hold");
  const ownReq = await ask(MATCH, head, {
    targetKey: "wrong-six", reason: "Head of sport files one themselves." });
  // The scorer's request is still open on this delivery, so this one is
  // refused by the one-open-request rule — file it against nothing instead.
  if (ownReq.status === 200) {
    const own = await decide(ownReq.body.id, head, { approve: true });
    ok("the head of sport cannot approve their own", own.body?.ok === false);
    ok("...and is told exactly why", own.body?.reason === "cannot_approve_your_own");
  } else {
    ok("a second open request against the same delivery is refused", ownReq.status >= 400);
    // Prove the self-approval guard on a different delivery.
    await q(`insert into ball_event
               (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id)
             values ($1,$2, 9003, 1, 0, $3, 'device-amend', 'other-ball', 9003, now(),
                     'ball', 'run', 2, $4)`, [MATCH, HIL, U_SCORER, P_BAT]);
    const own = await ask(MATCH, head, { targetKey: "other-ball", reason: "Own request." });
    const decided = await decide(own.body.id, head, { approve: true });
    ok("the head of sport cannot approve their own", decided.body?.ok === false);
    ok("...and is told exactly why", decided.body?.reason === "cannot_approve_your_own");
  }

  group("Somebody else approves, and the log changes");
  // Measured immediately before, not at the top: the self-approval group above
  // adds a delivery of its own, so a total captured earlier is a total of a
  // different match. The first version of this assertion compared across that
  // gap and failed for a reason that had nothing to do with the fold.
  const justBefore = await runs();
  const done = await decide(req.body.id, head, { approve: true, note: "Confirmed against the book." });
  ok("the head of sport approves the scorer's request", done.body?.ok === true);
  ok("...and the void it wrote is named back", !!done.body?.void_key);
  ok("the six is gone from the fold", (await runs()) === justBefore - 6);
  ok("...and the delivery itself is out of the live log",
     (await q(`select 1 from ball_event_live where match_id=$1 and idempotency_key='wrong-six'`,
              [MATCH])).length === 0);
  ok("...while still being on the record, because the log is append-only",
     (await q(`select 1 from ball_event where match_id=$1 and idempotency_key='wrong-six'`,
              [MATCH])).length === 1);
  const row = (await q(`select * from scoring_amendment where id = $1`, [req.body.id]))[0];
  ok("the amendment records who approved it", row.decided_by === U_HEAD);
  ok("...and when", row.decided_at != null);
  ok("...and their note", /Confirmed against the book/.test(row.decided_note ?? ""));

  group("Both names survive: who corrected, and who authorised");
  const v = (await q(`select * from ball_event where idempotency_key = $1`, [done.body.void_key]))[0];
  ok("the void is authored by the person who spotted it", v.scorer_user_id === U_SCORER);
  ok("...and carries the approver beside it", v.payload?.approved_by === U_HEAD);
  ok("...and names the delivery it voids", v.payload?.target === "wrong-six");
  ok("...and the amendment that authorised it", v.payload?.amendment === req.body.id);
  // It did not come from a scoring device, and does not claim to.
  ok("...and does not invent a device that was never involved", v.device_id === "amendment");

  group("An approval happens once");
  ok("the same amendment cannot be approved twice",
     (await decide(req.body.id, head, { approve: true })).body?.reason === "already_approved");
  ok("...and the log has exactly one void for it",
     (await q(`select count(*)::int n from ball_event where payload->>'amendment' = $1`,
              [req.body.id]))[0].n === 1);

  group("Approving something that is not there");
  const ghost = await ask(MATCH, scorer, { targetKey: "no-such-ball", reason: "Typo in the key." });
  ok("a request naming an unknown delivery is accepted…", ghost.status === 200);
  const ghostDecision = await decide(ghost.body.id, head, { approve: true });
  // Refused at approval rather than at request, because whether a delivery is
  // still live can change between the two.
  ok("…and refused at approval, when the delivery cannot be found",
     ghostDecision.body?.reason === "no_such_live_delivery");
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.message);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nAMENDMENT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
