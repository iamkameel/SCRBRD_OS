#!/usr/bin/env node
/**
 * Finishing the match, through the API and against Postgres (db/130; Kameel,
 * 4 Nov 2026, option A: whoever holds scoring.finalise at the home side
 * finishes the match from the pad's result screen). Two friendlies, Hilton
 * 1XI at home to Westville 1XI, scored on the real write path by the seed's
 * scorer: D with both innings sealed (decided), U with Hilton's alone.
 *
 *   A. Refused, each in its words, the match still live: signed out (401),
 *      a parent, the office (fixture.update and no scoring.finalise) and
 *      Westville's coach (scoring.finalise at the AWAY side), each 403
 *      not_permitted; a malformed id 404; U, which the log has not decided,
 *      422 not_decided.
 *   B. The scorer does NOT finish D (db/171; Kameel, 20 Nov 2026, Q2 (a):
 *      his part ends at the last ball): 403 coach_confirms, in its words,
 *      the match still live, no audit row. The chase's seal told the 1XI
 *      coach and the director of sport, once each: "1XI v Westville Boys'
 *      High 1XI is decided. Confirm the result." — never the scorer, and the
 *      same batch sent again tells nobody twice.
 *   P. The pen (db/171): the scorer's phone still holds D, so the coach's
 *      Confirm is 422 held_elsewhere. The coach cannot put the scorer's pen
 *      down; the scorer cannot at another generation, from another device,
 *      or with a ball still to send; then he does (the end screen's
 *      release), the session idle, and the coach confirms at once: 200,
 *      finished; the status complete; one scoring_audit row, the coach's;
 *      the decided notices taken back. The released generation's ball is
 *      set aside, not written into the log.
 *   C. Again: 200 already_complete, and nothing more written.
 *   D. After it: the official result reads provisional (not "not finished"),
 *      and a claim of the pen is refused match_complete (db/33).
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-finalise.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { inningsStart, batters, bowler, ball, sealInnings, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";
import { FINALISE_WORDS } from "../services/api/write/results-api.mjs";

const PORT = port(8904);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const STARTS = "2026-10-03T10:00:00+02:00";
const T0 = Date.parse("2026-10-03T08:00:00Z");
const HIL_XI = ["01", "02", "03", "04", "05"].map((n) => ({ id: `aaaaaaaa-0000-0000-0000-0000000000${n}`, name: `Hilton ${n}` }));
const WES_XI = ["01", "02"].map((n) => ({ id: `bbbbbbbb-0000-0000-0000-0000000000${n}`, name: `Westville ${n}` }));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 600)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-finalise-secret", PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await pool.query(text, params)).rows;

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
};
const login = async (email, deviceId = "finalise-desk") => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`;
const finalise = (m, token) => api(`/api/matches/${m}/finalise`, { method: "POST", token });
const status = async (m) => (await q(`select status from match where id = $1`, [m]))[0]?.status;
const audits = (m) => q(`select actor_id, detail from scoring_audit where match_id = $1 and event = 'match_finalised'`, [m]);

/** Score a match on the real write path: claim, then each innings' events and its seal. */
async function score(token, match, innings) {
  const device = "finalise-pad";
  const claim = await api(`/api/matches/${match}/session/claim`, { method: "POST", token, body: { device } });
  if (claim.body?.ok !== true) return { claim };
  let clientSeq = 0, at = 0, accepted = 0;
  for (const [i, inn] of innings.entries()) {
    const evs = [
      inningsStart({ battingTeam: inn.bat, bowlingTeam: inn.bowl, squad: inn.squad, bowlingSquad: inn.bowlingSquad, overs: 1, target: inn.target ?? null }),
      batters({ striker: inn.squad[0].id, nonStriker: inn.squad[1].id }),
      bowler({ bowler: inn.bowlingSquad[0].id }),
      ...inn.runs.map((v) => ball({ type: BALL_TYPE.RUN, value: v })),
    ].map((e) => ({ ...e, innings: i }));
    evs.push({ ...sealInnings(deriveInnings(evs)), innings: i });
    const stamped = evs.map((e) => ({ ...e, id: `${match}:${device}:${at}`, clientTs: T0 + (at++) * 20_000 }));
    const r = await api(`/api/matches/${match}/events`, { method: "POST", token, body: { events: stamped.map((ev) => ({
      epoch: claim.body.epoch, deviceId: device, idempotencyKey: ev.id, clientSeq: ++clientSeq, clientTs: ev.clientTs, innings: ev.innings, payload: ev })) } });
    accepted += r.body?.accepted?.length ?? 0;
    if ((r.body?.refused ?? []).length) return { refused: r.body.refused };
  }
  return { accepted };
}

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const fixture = async () => (await q(`insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
    values ($1, '1XI', $2, '1XI', 'x', $3, 'cricket', 'T20', 1, 'scheduled') returning id`, [HIL, WES, STARTS]))[0].id;
  const D = await fixture(), U = await fixture();
  const scorer = await login("scorer@example.invalid", "finalise-pad");
  const hilton = { bat: "Hilton College 1XI", bowl: "Westville 1XI", squad: HIL_XI, bowlingSquad: WES_XI, runs: [1, 1, 1, 1, 1, 1] };
  const reply = { bat: "Westville 1XI", bowl: "Hilton College 1XI", squad: WES_XI, bowlingSquad: HIL_XI, runs: [0, 0, 0, 0, 0, 0], target: 7 };
  const sd = await score(scorer, D, [hilton, reply]);
  const su = await score(scorer, U, [hilton]);
  ok("both are scored on the write path (D both innings, U one)", sd.accepted > 0 && su.accepted > 0, JSON.stringify({ sd, su }));
  const result = await api(`/api/matches/${D}/result`, { token: scorer });
  ok(`D is decided on the log (${result.body?.result?.outcome})`, /win/.test(result.body?.result?.outcome ?? ""), show(result));

  group("A. Refused, each in its words, the match still live");
  const anon = await finalise(D);
  ok(`signed out: 401 (${anon.status})`, anon.status === 401, show(anon));
  for (const [who, email] of [["a parent", "parent@example.invalid"], ["the office", "registrar@example.invalid"],
                              ["Westville's coach (the away side)", "coach.wes@example.invalid"]]) {
    const r = await finalise(D, await login(email));
    ok(`${who}: 403 not_permitted, in words`, r.status === 403 && r.body?.error === "not_permitted" && r.body?.detail === FINALISE_WORDS.not_permitted, show(r));
  }
  const bad = await finalise("not-a-match", scorer);
  ok(`a malformed id: 404 (${bad.status})`, bad.status === 404, show(bad));
  // Asked as the coach: since db/171 the scorer hears coach_confirms first.
  const undecided = await finalise(U, await login("coach@example.invalid", "coach-phone"));
  ok("U, which the log has not decided: 422 not_decided, in words",
    undecided.status === 422 && undecided.body?.error === "not_decided" && undecided.body?.detail === FINALISE_WORDS.not_decided, show(undecided));
  // Both are live from their first ball (db/165), and no refusal moved either.
  ok("...and every refusal left both live, with no audit row", (await status(D)) === "live" && (await status(U)) === "live"
    && (await audits(D)).length === 0 && (await audits(U)).length === 0);

  group("B. The scorer does not finish D; the coach is told");
  const refusedScorer = await finalise(D, scorer);
  ok("the scorer: 403 coach_confirms, in its words", refusedScorer.status === 403 && refusedScorer.body?.error === "coach_confirms"
    && refusedScorer.body?.detail === FINALISE_WORDS.coach_confirms, show(refusedScorer));
  ok("...the match still live, no audit row", (await status(D)) === "live" && (await audits(D)).length === 0);
  const coach = await login("coach@example.invalid", "coach-phone");
  const sarah = await login("sarah@example.invalid", "dos-phone");
  const TITLE = "1XI v Westville Boys' High 1XI is decided. Confirm the result.";
  const decided = async (token) => ((await api("/api/read/notifications", { token })).body?.rows ?? [])
    .filter((n) => n.subject_id === D && n.title === TITLE);
  const toCoach = await decided(coach);
  ok("the 1XI coach reads one decided notice for D, medium, in the fixture kind", toCoach.length === 1
    && toCoach[0].urgency === "medium" && toCoach[0].kind === "fixture", JSON.stringify(toCoach));
  ok("...and so does the director of sport", (await decided(sarah)).length === 1);
  ok("...and the scorer none", (await decided(scorer)).length === 0);
  // The pad re-sends a batch it got no answer to: every event a duplicate.
  const [{ n: before }] = await q(`select count(*)::int n from notification where subject_id = $1 and title = $2`, [D, TITLE]);
  const resent = await q(`select idempotency_key, client_seq, client_ts, innings, epoch, device_id, payload from ball_event where match_id = $1 and kind = 'innings_end' order by seq desc limit 1`, [D]);
  const again1 = await api(`/api/matches/${D}/events`, { method: "POST", token: scorer, body: { events: resent.map((r) => ({
    epoch: r.epoch, deviceId: r.device_id, idempotencyKey: r.idempotency_key, clientSeq: Number(r.client_seq), clientTs: Number(r.client_ts) || Date.parse(r.client_ts), innings: r.innings, payload: r.payload })) } });
  const [{ n: after }] = await q(`select count(*)::int n from notification where subject_id = $1 and title = $2`, [D, TITLE]);
  ok(`the seal sent again (${JSON.stringify(again1.body).slice(0, 80)}) tells nobody twice`, after === before && before >= 2, `${before} → ${after}`);

  group("P. The pen: the coach confirms at once once the scorer's end screen puts it down");
  const held = await finalise(D, coach);
  ok("while the scorer's phone holds it: 422 held_elsewhere", held.status === 422 && held.body?.error === "held_elsewhere", show(held));
  const release = (token, body) => api(`/api/matches/${D}/session/release`, { method: "POST", token, body });
  const [{ epoch }] = await q(`select epoch from scoring_session where match_id = $1`, [D]);
  const byCoach = await release(coach, { epoch, pending: 0 });
  ok("the coach cannot put the scorer's pen down: not_token_holder", byCoach.body?.ok === false && byCoach.body?.reason === "not_token_holder", show(byCoach));
  const stale = await release(scorer, { epoch: epoch + 1, pending: 0 });
  ok("the scorer at another generation: not_token_holder", stale.body?.ok === false && stale.body?.reason === "not_token_holder", show(stale));
  const elsewhere = await release(await login("scorer@example.invalid", "another-pad"), { epoch, pending: 0 });
  ok("the scorer from another device: not_token_holder", elsewhere.body?.ok === false && elsewhere.body?.reason === "not_token_holder", show(elsewhere));
  const named = await release(scorer, { epoch, pending: 0, device: "another-pad" });
  ok("a body naming another device: device_mismatch", named.body?.ok === false && named.body?.reason === "device_mismatch", show(named));
  const unsent = await release(scorer, { epoch, pending: 1 });
  ok("a ball still to send: unsynced_work", unsent.body?.ok === false && unsent.body?.reason === "unsynced_work", show(unsent));
  const down = await release(scorer, { epoch, pending: 0 });
  ok("the scorer puts it down: ok, the generation moved on", down.body?.ok === true && down.body?.epoch === epoch + 1, show(down));
  const [s] = await q(`select state, holder_user_id from scoring_session where match_id = $1`, [D]);
  ok("...the session idle, nobody holding it", s.state === "idle" && s.holder_user_id === null, JSON.stringify(s));
  const [{ id: scorerId }] = await q(`select id from app_user where email = 'scorer@example.invalid'`);
  ok("...one pen_released row, his", (await q(`select actor_id from scoring_audit where match_id = $1 and event = 'pen_released'`, [D]))
    .map((r) => r.actor_id).join() === scorerId);
  const late = await api(`/api/matches/${D}/events`, { method: "POST", token: scorer, body: { events: [{
    epoch, deviceId: "finalise-pad", idempotencyKey: `${D}:finalise-pad:late`, clientSeq: 999, clientTs: T0 + 9_999_000, innings: 1,
    payload: { ...ball({ type: BALL_TYPE.RUN, value: 4 }), id: `${D}:finalise-pad:late`, innings: 1 } }] } });
  ok("a ball under the released generation is set aside, not logged",
    (await q(`select count(*)::int n from ball_event where match_id = $1 and idempotency_key = $2`, [D, `${D}:finalise-pad:late`]))[0].n === 0
    && (await q(`select count(*)::int n from ball_event_quarantine where match_id = $1`, [D]))[0].n === 1, show(late));
  const done = await finalise(D, coach);
  ok("the coach confirms at once: 200, finished, in the pad's words", done.status === 200 && done.body?.state === "finished" && done.body?.message === FINALISE_WORDS.finished, show(done));
  ok("the status is complete", (await status(D)) === "complete");
  const [{ id: coachId }] = await q(`select id from app_user where email = 'coach@example.invalid'`);
  const rows = await audits(D);
  ok("one scoring_audit row, the coach's, with the outcome", rows.length === 1 && rows[0].actor_id === coachId && /win/.test(rows[0].detail?.outcome ?? ""),
    JSON.stringify(rows));
  ok("the decided notices are taken back: the coach reads none", (await decided(coach)).length === 0);

  group("C. Again: a no-op");
  const again = await finalise(D, coach);
  ok("200 already_complete", again.status === 200 && again.body?.state === "already_complete", show(again));
  ok("...and nothing more written", (await audits(D)).length === 1);

  group("D. After it");
  const off = await api(`/api/matches/${D}/official`, { token: await login("sarah@example.invalid") });
  ok(`the official result reads provisional, not "not finished" (${off.body?.state})`, off.body?.state === "provisional", show(off));
  const claim = await api(`/api/matches/${D}/session/claim`, { method: "POST", token: scorer, body: { device: "finalise-pad" } });
  ok("a claim of the pen is refused: match_complete (db/33)", claim.body?.ok !== true && /match_complete/.test(JSON.stringify(claim.body)), show(claim));
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.stack || e.message);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}
if (fail && serverErr.length) console.log("\nAPI stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
console.log(`\n${"─".repeat(52)}\nFINALISE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
