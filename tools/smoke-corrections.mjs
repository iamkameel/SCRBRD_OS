#!/usr/bin/env node
/**
 * Corrections everywhere, slices A0 and A1 (GA-I36,
 * docs/design/GA-I36_corrections_everywhere.md §6 N1, N2, §8.1).
 *
 * Two things a correction did not do before this:
 *
 *   N2  tell the public page. An approved amendment's void and a released
 *       held ball are written by their own routes, and `ball_event` is not in
 *       db/59's notification list, so the public cache served the old
 *       scorecard until its TTL (60 s settled). Now both routes drop the
 *       fixture's entry once committed (afterCommit, as publication does), and
 *       the public log answers the new head on the very next read. There is
 *       no push: screens poll (Kameel, 8 Oct), and this is what makes their
 *       next poll true.
 *   N1  be listed. `GET /api/matches/:id/corrections` and `GET
 *       /api/corrections` read scoring_amendment and ball_event_quarantine
 *       under the policies they already have, and widen nothing: the scorer
 *       sees his own request, the approver every one with the requester's
 *       name, a coach without audit.read and a guardian nothing, the public
 *       nothing at all.
 *
 * And what the public page is sent of a correction: the void, its time and a
 * pseudonymous target, never the reason, the requester or the approver.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-corrections.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { buildPublicFixture } from "./fixture-public.mjs";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8836);
const BASE = `http://127.0.0.1:${PORT}`;
const LIVE = "77777777-0000-0000-0000-000000000002";   // the seed's fixture smoke-quarantine uses
const REASON = "Four credited to Daniel Erasmus; it was four byes off the pad.";
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002", "aaaaaaaa-0000-0000-0000-000000000003"];

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-corrections-secret", PUBLIC_PAGES: "on" },
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
  const raw = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* not json */ }
  return { status: res.status, body: parsed, raw };
};
const login = async (email, deviceId = "device-corrections") => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId } })).body?.token;

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const { pub2 } = await buildPublicFixture(q);
  const scorer = await login("scorer@example.invalid");          // scoring.amend.request
  const head = await login("sarah@example.invalid");             // directorofsport: approves, publishes
  const principal = await login("principal@example.invalid");    // approves
  const coach = await login("coach@example.invalid");            // neither, and no audit.read
  const parent = await login("guardian.erasmus@example.invalid");// a guardian of a boy in the match

  group("A finished, published fixture, read by the public before anything changes");
  ok("Hilton publishes the finished fixture", (await api(`/api/matches/${pub2}/publication`, { method: "POST", token: head,
    body: { side: "home", published: true } })).status === 200);
  const before = await api(`/api/public/matches/${pub2}/log`);
  ok("the public log answers, with a head", before.status === 200 && Number.isInteger(before.body?.last), before.raw);
  const lastBefore = before.body.last;
  // The four that the book says were byes: the innings' first ball.
  const target = (await q(`select idempotency_key from ball_event where match_id = $1 and kind = 'ball' and value = 4`, [pub2]))[0].idempotency_key;

  group("N1 · a request, and who may see it");
  const asked = await api(`/api/matches/${pub2}/amendments`, { method: "POST", token: scorer, body: { targetKey: target, reason: REASON } });
  ok("the scorer files a request", asked.status === 200 && asked.body?.state === "pending", asked.raw);
  const mine = await api(`/api/matches/${pub2}/corrections`, { token: scorer });
  const myRow = mine.body?.amendments?.[0];
  ok("the scorer reads his own request", mine.status === 200 && mine.body.amendments.length === 1 && myRow.id === asked.body.id, mine.raw);
  ok("...as his, and not his to decide", myRow?.mine === true && myRow?.canDecide === false);
  ok("...with his reason (the policy's audience for it)", myRow?.reason === REASON);
  ok("...and no name for the requester: that is only the approver's", !("requesterName" in (myRow ?? {})));
  ok("...with the target found in the log", myRow?.target?.innings === 0 && Number.isInteger(myRow?.target?.seq), JSON.stringify(myRow?.target));
  const theirs = await api(`/api/matches/${pub2}/corrections`, { token: head });
  const headRow = theirs.body?.amendments?.[0];
  ok("the director of sport reads it", theirs.status === 200 && headRow?.id === asked.body.id, theirs.raw);
  ok("...as hers to decide", headRow?.canDecide === true && headRow?.mine === false);
  ok("...with the requester's name", typeof headRow?.requesterName === "string" && headRow.requesterName.length > 0, JSON.stringify(headRow));
  const coachRead = await api(`/api/matches/${pub2}/corrections`, { token: coach });
  ok("a coach without audit.read reads no amendment, and so no reason", coachRead.status === 200
    && coachRead.body.amendments.length === 0 && !coachRead.raw.includes(REASON), coachRead.raw);
  const parentRead = await api(`/api/matches/${pub2}/corrections`, { token: parent });
  ok("a guardian reads nothing", parentRead.status === 200 && parentRead.body.amendments.length === 0
    && parentRead.body.held.length === 0 && !parentRead.raw.includes(REASON), parentRead.raw);
  const nobody = await api(`/api/matches/${pub2}/corrections`);
  ok("signed out: refused, and nothing in the answer", nobody.status >= 400 && !nobody.raw.includes(REASON), `${nobody.status} ${nobody.raw}`);
  const open = await api(`/api/corrections`, { token: head });
  const o7 = open.body?.matches?.find((m) => m.matchId === pub2);
  ok("the director's open list counts it (the To-resolve row)", o7?.amendments === 1 && o7?.held === 0 && !!o7?.oldest, open.raw);
  ok("...with no reason and no name in it", !open.raw.includes(REASON) && !/Erasmus/.test(open.raw));
  const coachOpen = await api(`/api/corrections`, { token: coach });
  ok("a coach's open list does not have it", coachOpen.status === 200 && !coachOpen.body.matches.some((m) => m.matchId === pub2), coachOpen.raw);

  group("Refusals stand as they were");
  ok("the requester cannot approve his own (he holds no approval)",
    (await api(`/api/amendments/${asked.body.id}/decide`, { method: "POST", token: scorer, body: { approve: true } })).body?.reason === "not_permitted");
  ok("an approver cannot request", (await api(`/api/matches/${pub2}/amendments`, { method: "POST", token: head,
    body: { targetKey: target, reason: "x" } })).status === 403);
  ok("a pending request changes nothing public (D12)", (await api(`/api/public/matches/${pub2}/log`)).body?.last === lastBefore);

  group("N2 · an approval reaches the public page on its next read, not its TTL");
  const warm = await api(`/api/public/matches/${pub2}/log`);
  ok("the public log is cached at the old head (60 s for a finished match)", warm.body?.last === lastBefore);
  const done = await api(`/api/amendments/${asked.body.id}/decide`, { method: "POST", token: principal, body: { approve: true, note: "Checked against the book." } });
  ok("the principal approves", done.body?.ok === true, done.raw);
  const after = await api(`/api/public/matches/${pub2}/log`);
  ok("the public log answers the new head at once", after.body?.last === lastBefore + 1, `${lastBefore} → ${after.body?.last}`);
  const v = after.body?.events?.find((e) => e.seq === after.body.last);
  ok("...and the new row is the void", v?.kind === "void" && typeof v?.target === "string", JSON.stringify(v));
  ok("...with its time", Number.isFinite(v?.clientTs));
  // `amendment: true` says an approved amendment wrote it, so the page tells it
  // from a scorer's undo (GA-I36, Kameel 8 Oct); never the amendment's id.
  ok("...and nothing else: no reason, no amendment id, no approver", Object.keys(v ?? {}).sort().join() === "amendment,clientTs,id,innings,kind,seq,target"
    && v?.amendment === true, Object.keys(v ?? {}).join());
  ok("the public answer carries no reason, note, requester, approver or amendment id anywhere",
    !after.raw.includes(REASON) && !after.raw.includes("Checked against the book") && !after.raw.includes(asked.body.id)
    && !/approved_by|requested|"amendment":(?!true)/.test(after.raw));
  const since = await api(`/api/public/matches/${pub2}/log?since=${lastBefore}`);
  ok("a poll with ?since= gets the void alone (the page's stale check)", since.body?.events?.length === 1 && since.body.last === lastBefore + 1, since.raw);
  const decided = await api(`/api/matches/${pub2}/corrections`, { token: scorer });
  ok("the scorer's list now shows it approved, naming the void", decided.body?.amendments?.[0]?.state === "approved"
    && !!decided.body.amendments[0].appliedKey, decided.raw);
  ok("the director's open list no longer counts it", !(await api(`/api/corrections`, { token: head })).body.matches.some((m) => m.matchId === pub2));

  group("A decline drops nothing and writes nothing");
  const ask2 = await api(`/api/matches/${pub2}/amendments`, { method: "POST", token: scorer, body: { targetKey: (await q(
    `select idempotency_key from ball_event where match_id = $1 and kind = 'ball' and value = 1`, [pub2]))[0].idempotency_key, reason: "Not sure." } });
  const declined = await api(`/api/amendments/${ask2.body.id}/decide`, { method: "POST", token: head, body: { approve: false, note: "The book agrees with the pad." } });
  ok("the director declines", declined.body?.ok === true, declined.raw);
  ok("...the public head is unchanged", (await api(`/api/public/matches/${pub2}/log`)).body?.last === lastBefore + 1);
  const dRow = (await api(`/api/matches/${pub2}/corrections`, { token: scorer })).body?.amendments?.find((a) => a.id === ask2.body.id);
  ok("...and the scorer reads the note on his declined request", dRow?.state === "declined" && dRow?.decidedNote === "The book agrees with the pad.", JSON.stringify(dRow));

  group("N2 · a released held ball reaches the public page at once too");
  ok("Hilton publishes the seed's fixture", (await api(`/api/matches/${LIVE}/publication`, { method: "POST", token: head,
    body: { side: "home", published: true } })).status === 200);
  const sub = await login("sarah@example.invalid", "device-corrections-a");   // submits: holds approval, so the own-ball rule is real
  const claim = await api(`/api/matches/${LIVE}/session/claim`, { method: "POST", token: sub, body: { device: "device-corrections-a" } });
  ok("the scorer claims the match", claim.body?.ok === true, claim.raw);
  const epoch = claim.body.epoch;
  const post = (ep, evs, from) => api(`/api/matches/${LIVE}/events`, { method: "POST", token: sub, body: { events: evs.map((payload, i) => ({
    epoch: ep, deviceId: "device-corrections-a", idempotencyKey: `corr:${ep}:${from + i}`, clientSeq: from + i, clientTs: Date.now(), innings: 0, payload })) } });
  ok("four live events", (await post(epoch, [inningsStart({ innings: 0, battingTeam: "HIL", bowlingTeam: "MHS", oversLimit: 20 }),
    batters({ striker: P[0], nonStriker: P[1] }), bowler({ bowler: P[2] }),
    ball({ type: BALL_TYPE.RUN, value: 4, striker: P[0], nonStriker: P[1], bowler: P[2] })], 1)).body?.accepted?.length === 4);
  const stale = await post(epoch + 5, [ball({ type: BALL_TYPE.RUN, value: 2, striker: P[0], nonStriker: P[1], bowler: P[2] })], 20);
  ok("a stale ball is held", stale.body?.quarantined?.length === 1, stale.raw);
  const heldList = await api(`/api/matches/${LIVE}/corrections`, { token: principal });
  const held = heldList.body?.held?.[0];
  ok("the principal's list has the held ball, his to decide", held && held.canDecide === true && held.event?.type === "run", heldList.raw);
  const subList = await api(`/api/matches/${LIVE}/corrections`, { token: sub });
  ok("...and the submitter's has it as hers, not hers to decide", subList.body?.held?.[0]?.mine === true && subList.body.held[0].canDecide === false, subList.raw);
  ok("the open list counts it", (await api(`/api/corrections`, { token: principal })).body.matches.some((m) => m.matchId === LIVE && m.held === 1));
  const warm2 = await api(`/api/public/matches/${LIVE}/log`);
  ok("the public log is read (cached 5 s live)", warm2.status === 200 && Number.isInteger(warm2.body?.last), warm2.raw);
  const rel = await api(`/api/quarantine/${held.id}/resolve`, { method: "POST", token: principal, body: { accept: true } });
  ok("the principal releases it", rel.body?.ok === true, rel.raw);
  const after2 = await api(`/api/public/matches/${LIVE}/log`);
  ok("the public log answers the released ball at once", after2.body?.last === rel.body.seq && after2.body.last > warm2.body.last,
    `${warm2.body.last} → ${after2.body?.last} (seq ${rel.body.seq})`);
  ok("...and the held list is empty", (await api(`/api/matches/${LIVE}/corrections`, { token: principal })).body?.held?.length === 0);
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
console.log(`\n${"─".repeat(52)}\nCORRECTIONS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
