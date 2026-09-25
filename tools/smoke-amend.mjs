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
 *   the approver may not request (db/24), and could not approve her own even if she had
 *   the void is authored by the requester and approved by somebody else,
 *     and both names survive in the record
 *   the ordinary scoring path still cannot touch a finished match
 *
 * And, since SCRBRD-076 (db/38): the approved void meets the Laws — every
 * void rule but last-in-first-out, which is the pad's undo — and the approval
 * waits for the per-match lock a live batch holds.
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
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
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
  // Until db/24 the head of sport could file a request, because the request
  // rode on scoring.correct and she holds that for session recovery. Now the
  // request is its own capability and she does not hold it: the door is shut
  // at the request, before the function's own guard is ever reached.
  const ownReq = await ask(MATCH, head, {
    targetKey: "other-ball", reason: "Head of sport files one themselves." });
  ok("the head of sport cannot file a request at all", ownReq.status === 403);
  ok("...and is told it is not permitted", ownReq.body?.error === "not_permitted");
  ok("...and no row was written", (await q(
    `select count(*)::int n from scoring_amendment where requested_by = $1`, [U_HEAD]))[0].n === 0);
  // The function's guard is the second lock on the same door, and it has to
  // hold even for the one account that does hold both halves. Put a request
  // in her name past the policy — as the superuser, which is the only way
  // in — and have her decide it.
  await q(`insert into ball_event
             (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
              idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id)
           values ($1,$2, 9003, 1, 0, $3, 'device-amend', 'other-ball', 9003, now(),
                   'ball', 'run', 2, $4)`, [MATCH, HIL, U_SCORER, P_BAT]);
  const planted = (await q(
    `insert into scoring_amendment (match_id, school_id, target_key, reason, requested_by)
     values ($1, $2, 'other-ball', 'Planted past the policy.', $3) returning id`, [MATCH, HIL, U_HEAD]))[0];
  const decided = await decide(planted.id, head, { approve: true });
  ok("even then, the head of sport cannot approve their own", decided.body?.ok === false);
  ok("...and is told exactly why", decided.body?.reason === "cannot_approve_your_own");
  ok("...and the delivery is still in the log", (await q(
    `select count(*)::int n from ball_event_live where match_id = $1 and idempotency_key = 'other-ball'`,
    [MATCH]))[0].n === 1);
  // The head of sport still has what scoring.correct is for. Withdrawing it
  // was the fix that broke three walks; this is the line that says it stayed.
  ok("...while still holding session recovery", (await q(
    `select count(*)::int n from role_capability
      where role = 'directorofsport' and capability = 'scoring.correct'`))[0].n === 1);

  group("Somebody else approves, and the log changes");
  // Measured immediately before, not at the top: the self-approval group above
  // adds a delivery of its own, so a total captured earlier is a total of a
  // different match. The first version of this assertion compared across that
  // gap and failed for a reason that had nothing to do with the fold.
  const justBefore = await runs();
  const done = await decide(req.body.id, head, { approve: true, note: "Confirmed against the book." });
  ok("the head of sport approves the scorer's request", done.body?.ok === true, JSON.stringify(done.body));
  // SCRBRD-076: the void is judged by the Laws — but an amendment is not an
  // undo. `other-ball` was bowled after `wrong-six`, so the pad's rule (only
  // the latest event) would refuse this; the amendment route does not apply it.
  ok("...although it is not the latest delivery: last-in-first-out is the pad's undo, not an amendment's",
     (await q(`select max(seq)::int n from ball_event
                where match_id = $1 and kind <> 'void'`, [MATCH]))[0].n === 9003);
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

  group("An approved amendment meets the Laws (SCRBRD-076)");
  // The void is judged as it was stored, over the log it lands on. Every void
  // rule stands but last-in-first-out — and the one the SQL function does not
  // already answer is the start of an innings, which is never undone: voiding
  // it leaves the innings' balls with no side, squad or overs, and an
  // amendment cannot write the replacement.
  await q(`insert into ball_event
             (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
              idempotency_key, client_seq, client_ts, kind, payload)
           values ($1,$2, 9100, 1, 3, $3, 'device-amend', 'fourth-innings-start', 9100, now(),
                   'innings_start', '{"battingTeam":"Hilton 1st XI","bowlingTeam":"Westville","overs":20}')`,
          [MATCH, HIL, U_SCORER]);
  const found = await ask(MATCH, scorer, { targetKey: "fourth-innings-start", reason: "Opened by mistake." });
  ok("a request to void the start of an innings is filed", found.status === 200, JSON.stringify(found.body));
  const foundDecision = await decide(found.body?.id, head, { approve: true });
  ok("...and refused at approval by the Laws", foundDecision.body?.ok === false
     && foundDecision.body?.reason === "laws_refused" && foundDecision.body?.law === "void_foundation",
     JSON.stringify(foundDecision.body));
  ok("...with the reason in words", /start of an innings/.test(foundDecision.body?.text ?? ""));
  ok("...nothing was written", (await q(
    `select count(*)::int n from ball_event where payload->>'amendment' = $1`, [found.body?.id]))[0].n === 0);
  ok("...the innings is still open", (await q(
    `select count(*)::int n from ball_event_live where idempotency_key = 'fourth-innings-start'`))[0].n === 1);
  ok("...and the request is still pending, for a person to decline",
     (await q(`select state from scoring_amendment where id = $1`, [found.body?.id]))[0]?.state === "pending");
  ok("declining it is still possible", (await decide(found.body?.id, head, { approve: false })).body?.ok === true);

  group("An approval waits for the per-match lock a live batch holds (db/38)");
  // A live batch holds the match's scoring_session row FOR UPDATE for its
  // whole transaction (scoring_lease_check). Hold it here, as that batch
  // would, and the approval must wait for it — so it appends after the batch,
  // and the next batch folds the log with the void in it.
  await q(`insert into scoring_session (match_id, school_id) values ($1, $2) on conflict do nothing`, [MATCH, HIL]);
  await q(`insert into ball_event
             (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
              idempotency_key, client_seq, client_ts, kind, ball_type, value, striker_id)
           values ($1,$2, 9101, 1, 0, $3, 'device-amend', 'late-ball', 9101, now(),
                   'ball', 'run', 1, $4)`, [MATCH, HIL, U_SCORER, P_BAT]);
  const late = await ask(MATCH, scorer, { targetKey: "late-ball", reason: "Counted twice." });
  const holder = await pool.connect();
  let settled = false;
  try {
    await holder.query("begin");
    await holder.query(`select 1 from scoring_session where match_id = $1 for update`, [MATCH]);
    const pending = decide(late.body?.id, head, { approve: true }).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 750));
    ok("the approval does not append while a live batch holds the match", settled === false);
    ok("...and nothing is in the log yet", (await q(
      `select count(*)::int n from ball_event where payload->>'amendment' = $1`, [late.body?.id]))[0].n === 0);
    await holder.query("commit");
    const lateDone = await pending;
    ok("once the batch commits, the approval goes through", lateDone.body?.ok === true, JSON.stringify(lateDone.body));
  } finally {
    await holder.query("rollback").catch(() => {});
    holder.release();
  }
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
