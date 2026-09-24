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
import { inningsStart, batters, bowler, ball, BALL_TYPE, fromRow, deriveInnings, REFUSAL, REFUSAL_TEXT } from "@scrbrd/scoring";

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
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002", "aaaaaaaa-0000-0000-0000-000000000003",
           "aaaaaaaa-0000-0000-0000-000000000004"];

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
/** One event under a key chosen by the caller — a resend keeps the key it was first sent with. */
const postKeyed = (token, device, epoch, key, payload, clientSeq = 1) => api(`/api/matches/${MATCH}/events`, {
  method: "POST", token,
  body: { events: [{ epoch, deviceId: device, idempotencyKey: key, clientSeq, clientTs: Date.now(), innings: 0, payload }] },
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
  // The SAME ball — fielder and all. db/36: a key names one event, so a
  // resend is a duplicate only when it says what the stored one says.
  const dupe = await post(scorer, DEV_A, epoch + 7, [   // the SAME key as before: epoch + 7, client seq 10
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "Run Out", fielder: "L Govender", striker: P[0], nonStriker: P[1], bowler: P[2] }),
  ], 10);
  ok("a resend of the released key is reported as a duplicate, not quarantined", dupe.body?.duplicates?.length === 1, JSON.stringify(dupe.body));
  // ...and a DIFFERENT ball under that key is not a duplicate. This used to be
  // answered "duplicate" and dropped: the device told its wicket was safe, the
  // server holding another.
  const other = await post(scorer, DEV_A, epoch + 7, [
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", striker: P[0], nonStriker: P[1], bowler: P[2] }),
  ], 10);
  ok("the same key with a different body is a conflict, naming the stored seq",
     other.body?.conflicts?.length === 1 && other.body.conflicts[0].seq === released?.seq
     && other.body?.duplicates?.length === 0, JSON.stringify(other.body));

  group("A released ball meets the Laws, like a live one (SCRBRD-071)");
  // The wicket released above emptied the striker's end, so any ball is
  // illegal until somebody walks in — and P[0], who was run out, never can.
  const heldNow = await post(scorer, DEV_A, epoch + 7, [
    ball({ type: BALL_TYPE.RUN, value: 1, contact: "middle", trajectory: "ground", striker: P[3], nonStriker: P[1], bowler: P[2] }),
    batters({ striker: P[0] }),
  ], 20);
  ok("a ball and a returning batter are held", heldNow.body?.quarantined?.length === 2, JSON.stringify(heldNow.body).slice(0, 200));
  const keyOf = (n) => `${DEV_A}:${epoch + 7}:${n}`;
  const rowFor = async (key) => (await list(dos)).body?.rows?.find((r) => r.idempotency_key === key);
  const early = await rowFor(keyOf(20)), comeback = await rowFor(keyOf(21));
  const logBefore = (await log(dos)).length;
  const tooSoon = await resolve(early.id, dos, { accept: true });
  ok("releasing a ball with nobody at the striker's end is refused, by the Laws",
     tooSoon.body?.ok === false && tooSoon.body?.reason === "laws_refused" && tooSoon.body?.law === REFUSAL.NEXT_BATTER,
     JSON.stringify(tooSoon.body));
  ok("...and says why in words", tooSoon.body?.text === REFUSAL_TEXT.next_batter, tooSoon.body?.text);
  ok("...nothing was written", (await log(dos)).length === logBefore);
  ok("...and the ball is still held, for the approver to discard or leave", !(await rowFor(keyOf(20)))?.resolved_at);
  const outAgain = await resolve(comeback.id, dos, { accept: true });
  ok("releasing a batter who is already out is refused: batter_already_out",
     outAgain.body?.reason === "laws_refused" && outAgain.body?.law === REFUSAL.BATTER_ALREADY_OUT
     && outAgain.body?.text === REFUSAL_TEXT.batter_already_out, JSON.stringify(outAgain.body));
  const discard = await resolve(comeback.id, dos, { accept: false, note: "he was run out" });
  ok("...which the approver discards", discard.body?.ok === true && (await rowFor(keyOf(21)))?.resolution === "rejected");
  // Left held, the ball waits for the log to change. A new batter walks in.
  const walkIn = await post(scorer, DEV_A, epoch, [batters({ striker: P[3] })], 30);
  ok("the scorer names the new batter, live", walkIn.body?.accepted?.length === 1, JSON.stringify(walkIn.body));
  const nowLegal = await resolve(early.id, dos, { accept: true });
  ok("the ball left held is released once the Laws allow it", nowLegal.body?.ok === true && Number.isInteger(nowLegal.body?.seq), JSON.stringify(nowLegal.body));
  const releasedRun = (await log(dos)).find((e) => e.idempotency_key === keyOf(20));
  ok("...at the end of the log, marked recovered", releasedRun?.seq === nowLegal.body?.seq && releasedRun?.recovered === true);
  ok("...with contact and trajectory intact (db/37)", releasedRun?.contact === "middle" && releasedRun?.trajectory === "ground",
     JSON.stringify(releasedRun).slice(0, 300));
  ok("...and the replay scores the run", deriveInnings((await log(dos)).map(fromRow)).runs === 5);

  group("Held, then sent again by the device that holds the token (SCRBRD-071)");
  // A stale send, and the response lost; the device claims again and its
  // outbox re-sends the same event under the same key, now with the token.
  const h = ball({ type: BALL_TYPE.RUN, value: 2, striker: P[3], nonStriker: P[1], bowler: P[2] });
  const heldH = await postKeyed(scorer, DEV_A, epoch + 7, keyOf(40), h, 40);
  ok("the ball is held under the stale token", heldH.body?.quarantined?.length === 1);
  const liveH = await postKeyed(scorer, DEV_A, epoch, keyOf(40), h, 40);
  ok("re-sent with the token, the same event is judged and written live",
     liveH.body?.accepted?.length === 1 && !liveH.body?.duplicates?.length, JSON.stringify(liveH.body));
  const closedH = await rowFor(keyOf(40));
  ok("...and its held copy is closed as superseded, not left for a person", closedH?.resolved_at && closedH?.resolution === "superseded",
     JSON.stringify(closedH).slice(0, 200));
  const lateRelease = await resolve(closedH.id, dos, { accept: true });
  ok("a release of the held copy is refused, naming why: already_superseded",
     lateRelease.body?.ok === false && lateRelease.body?.reason === "already_superseded", JSON.stringify(lateRelease.body));
  ok("...and the ball is in the log once", (await log(dos)).filter((e) => e.idempotency_key === keyOf(40)).length === 1);
  const again2 = await postKeyed(scorer, DEV_A, epoch, keyOf(40), h, 40);
  ok("a further resend is a plain duplicate", again2.body?.duplicates?.length === 1, JSON.stringify(again2.body));
  // db/36's rule still stands: the same key saying something else is a
  // conflict, whether its first copy is live or held.
  const h2 = ball({ type: BALL_TYPE.RUN, value: 3, striker: P[3], nonStriker: P[1], bowler: P[2] });
  await postKeyed(scorer, DEV_A, epoch + 7, keyOf(41), h2, 41);
  const lengthBefore = (await log(dos)).length;
  const changedH = await postKeyed(scorer, DEV_A, epoch, keyOf(41), { ...h2, value: 6 }, 41);
  ok("a different event under a held key is a conflict, written nowhere",
     changedH.body?.conflicts?.length === 1 && !changedH.body?.accepted?.length && (await log(dos)).length === lengthBefore,
     JSON.stringify(changedH.body));
  ok("...and the held copy stays for a person", !(await rowFor(keyOf(41)))?.resolved_at);

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
