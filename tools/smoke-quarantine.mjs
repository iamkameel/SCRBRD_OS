#!/usr/bin/env node
/**
 * A way out of quarantine.
 *
 * A ball sent under a revoked epoch lands in ball_event_quarantine. Until
 * db/14 nothing could release it: no policy, no function, no route — the over
 * was short on the scorecard for ever. This walk puts a ball there the way a
 * real handover does, and then walks the door: who may open it, what an
 * accepted ball looks like in the log, what a rejected one leaves behind.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-quarantine.mjs
 */
import { spawn } from "node:child_process";
import { inningsStart, batters, bowler, ball, BALL_TYPE, fromRow, deriveInnings } from "@scrbrd/scoring";

const PORT = 8886, BASE = `http://127.0.0.1:${PORT}`;
const MATCH = "77777777-0000-0000-0000-000000000002";
// The submitter HOLDS the approval capability on purpose: the rule that you
// may not release your own ball is only exercised by somebody who could
// otherwise have released it. A scorer without scoring.amend.approve is
// refused one step earlier, for a different reason, and proves nothing about
// that rule — which is how a falsification of it stayed green the first time.
const SCORER    = "sarah@example.invalid";      // directorofsport: scoring.edit AND scoring.amend.approve — submits
const PRINCIPAL = "principal@example.invalid";  // scoring.amend.approve — decides
const PLAIN     = "scorer@example.invalid";     // scoring.edit only — may not decide
const COACH     = "coach@example.invalid";      // no correction capability over this match
const DEV_A = "device-quarantine-a", DEV_B = "device-quarantine-b";
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002", "aaaaaaaa-0000-0000-0000-000000000003"];

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-quarantine-secret" },
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
const log = async (token) => ((await api(`/api/matches/${MATCH}/events?since=0`, { token })).body?.events) || [];
const list = (token) => api(`/api/matches/${MATCH}/quarantine`, { token });
const resolve = (id, token, body) => api(`/api/quarantine/${id}/resolve`, { method: "POST", token, body });

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const scorer = await login(SCORER, DEV_A), dos = await login(PRINCIPAL, DEV_B), coach = await login(COACH, "device-coach"), plain = await login(PLAIN, "device-plain");

  group("A ball lands in quarantine the way it does in a real handover");
  const claim = await api(`/api/matches/${MATCH}/session/claim`, { method: "POST", token: scorer, body: { device: DEV_A } });
  ok("the scorer claims the match", claim.body?.ok === true, JSON.stringify(claim.body));
  const epoch = claim.body.epoch;
  const opened = await post(scorer, DEV_A, epoch, [
    inningsStart({ innings: 0, battingTeam: "HIL", bowlingTeam: "MHS", oversLimit: 20 }),
    batters({ striker: P[0], nonStriker: P[1] }), bowler({ bowler: P[2] }),
    ball({ type: BALL_TYPE.RUN, value: 4, striker: P[0], nonStriker: P[1], bowler: P[2] }),
  ]);
  ok("four live events accepted", opened.body?.accepted?.length === 4, JSON.stringify(opened.body).slice(0, 200));
  // A stale epoch: the device thinks the match is one handover behind.
  const stale = await post(scorer, DEV_A, epoch + 7, [
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "Run Out", fielder: "L Govender", striker: P[0], nonStriker: P[1], bowler: P[2] }),
    ball({ type: BALL_TYPE.RUN, value: 1, striker: P[0], nonStriker: P[1], bowler: P[2] }),
  ], 10);
  ok("two stale balls are quarantined, not merged", stale.body?.quarantined?.length === 2 && stale.body.accepted.length === 0, JSON.stringify(stale.body).slice(0, 200));
  const beforeLog = await log(dos);
  ok("...and the log does not have them", beforeLog.length === 4);

  group("Who may look, who may decide");
  const seenByDos = await list(dos);
  ok("the approver — who holds approval, not correction — sees both, unresolved", seenByDos.status === 200 && seenByDos.body?.rows?.length === 2 && seenByDos.body.rows.every((r) => !r.resolved_at), JSON.stringify(seenByDos.body).slice(0, 200));
  ok("...with the scorer named", seenByDos.body.rows[0].scorer_name === "Sarah Mokoena", seenByDos.body.rows[0].scorer_name);
  const seenByPlain = await list(plain);
  ok("a scorer holding scoring.correct may look", seenByPlain.status === 200 && seenByPlain.body?.rows?.length === 2, JSON.stringify(seenByPlain.body).slice(0, 120));
  const seenByCoach = await list(coach);
  ok("a coach with no correction capability over this match sees nothing", seenByCoach.status === 200 && seenByCoach.body?.rows?.length === 0, JSON.stringify(seenByCoach.body).slice(0, 120));
  const [wicketRow, runRow] = seenByDos.body.rows;
  const byCoach = await resolve(wicketRow.id, coach, { accept: true });
  ok("...and cannot decide what they cannot see", byCoach.status === 404 || byCoach.body?.ok === false, JSON.stringify(byCoach.body));
  const byPlain = await resolve(wicketRow.id, plain, { accept: true });
  ok("a scorer without the approval capability is refused: not_permitted", byPlain.body?.ok === false && byPlain.body?.reason === "not_permitted", JSON.stringify(byPlain.body));
  const bySelf = await resolve(wicketRow.id, scorer, { accept: true });
  ok("the person who sent it may not release it, even holding approval: cannot_release_your_own",
     bySelf.body?.ok === false && bySelf.body?.reason === "cannot_release_your_own", JSON.stringify(bySelf.body));
  ok("nothing was written by a refusal", (await log(dos)).length === 4);

  group("Accepting writes the ball into the log, under the current epoch, marked recovered");
  const accepted = await resolve(wicketRow.id, dos, { accept: true, note: "device was one handover behind" });
  ok("the approver accepts it", accepted.body?.ok === true && Number.isInteger(accepted.body?.seq), JSON.stringify(accepted.body));
  const after = await log(dos);
  const released = after.find((e) => e.idempotencyKey === wicketRow.idempotency_key || e.idempotency_key === wicketRow.idempotency_key);
  ok("the ball is in the log at the next seq", after.length === 5 && released && (released.seq === accepted.body.seq), JSON.stringify(after.map((e) => e.seq)));
  ok("...under the current epoch, not the stale one", released && released.epoch === epoch, `epoch ${released?.epoch}`);
  ok("...marked recovered", released?.recovered === true, JSON.stringify(released).slice(0, 200));
  const inn = deriveInnings(after.map(fromRow));
  ok("the replay now counts the wicket", inn.wickets === 1, `wickets ${inn.wickets}`);
  ok("...and, being a run out, does not credit the bowler", inn.bowlers.find((b) => b.id === P[2])?.wickets === 0);
  const again = await resolve(wicketRow.id, dos, { accept: true });
  ok("a second decision is refused: already_accepted", again.body?.ok === false && again.body?.reason === "already_accepted", JSON.stringify(again.body));
  ok("...and wrote nothing", (await log(dos)).length === 5);

  group("Rejecting closes the row and writes nothing");
  const rejected = await resolve(runRow.id, dos, { accept: false, note: "double-entered" });
  ok("the approver rejects the other", rejected.body?.ok === true);
  ok("the log is unchanged", (await log(dos)).length === 5);
  const closed = await list(dos);
  ok("both rows are resolved, accepted and rejected", closed.body.rows.every((r) => r.resolved_at) && new Set(closed.body.rows.map((r) => r.resolution)).size === 2);

  group("A ball that arrived by another road is not written twice");
  // The same key, quarantined again by a stale send after it was released.
  const dupe = await post(scorer, DEV_A, epoch + 7, [   // the SAME key as before: epoch + 7, client seq 10
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", striker: P[0], nonStriker: P[1], bowler: P[2] }),
  ], 10);
  ok("a resend of the released key is reported as a duplicate, not quarantined", dupe.body?.duplicates?.length === 1, JSON.stringify(dupe.body));
  const unknown = await resolve(999999, dos, { accept: true });
  ok("an id that does not exist is a 404", unknown.status === 404);
} catch (e) {
  ok(`the quarantine walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
}

if (fail && serverErr.length) { console.log("\nServer stderr:"); console.log(serverErr.join("").split("\n").slice(0, 12).join("\n")); }
console.log(`\n${"─".repeat(52)}\nQUARANTINE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
