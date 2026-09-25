#!/usr/bin/env node
/**
 * The server decides what a scoring command may be, at commit.
 *
 * Three things the write path used to take on the client's word, each proved
 * here against a real Postgres and a real HTTP server:
 *
 *   ONE KEY, ONE EVENT (db/36). The same key with the same body is a retry:
 *   a duplicate, as it always was. The same key with a DIFFERENT body used to
 *   be answered "duplicate" too, and the new body dropped — the device told
 *   its ball was safe while the server kept another. It is now a conflict,
 *   reported by name, and nothing is written.
 *
 *   UNDO IS LAST-IN, FIRST-OUT. The pad only ever voids the latest event that
 *   still counts. The server accepted a void naming ANY event, which is an
 *   amendment with no second person. It now refuses anything but the latest.
 *
 *   THE LAWS (lawsRefusal, packages/scoring). A ball with nobody bowling, the
 *   same bowler twice running, a wicket for a boy who is not batting, a ball
 *   after the match is decided — refused per event, with the reason, and the
 *   rest of the batch still judged, so one illegal ball cannot wedge an
 *   offline queue. The sync engine holds a refused event for a person.
 *
 * And a legal match still scores end to end, through both innings, to a
 * result the server's own fold and the device's agree on.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-laws.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { SyncEngine, memoryStorage } from "@scrbrd/sync";
import {
  deriveInnings, deriveMatch, fromRow, inningsStart, batters, bowler, ball, voidEvent, sealInnings,
  BALL_TYPE, newEventId, REFUSAL, REFUSAL_TEXT, toRow, PLACEMENT_SOURCE, PLACEMENT_NULL, CAPTURE_PROFILE,
} from "@scrbrd/scoring";

const PORT = 8891;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const MATCH = "77777777-0000-0000-0000-000000000002";
// A second fixture for the contact/trajectory walk, so its deliveries do not
// change the over and innings counts the walk above asserts.
const SHOTS = "77777777-0000-0000-0000-000000000003";
const SCORER = "scorer@example.invalid";
const DEVICE = "device-laws-01";
const P = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002",
           "aaaaaaaa-0000-0000-0000-000000000004"];
// The opposition bowls in the first innings and bats in the second. SCRBRD
// holds no rows for them, so they are typed names, as the pad records them.
const DLAMINI = "S Dlamini", MOKOENA = "T Mokoena";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-laws-secret" },
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
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

let token, epoch, clientSeq = 0;
/** Every event gets its identity first, exactly as the scorer's emit() does: the id IS the key. */
const stamp = (innings, ev) => ({ ...ev, innings, id: ev.id ?? newEventId(DEVICE, MATCH) });
const envelope = (ev) => ({ epoch, deviceId: DEVICE, idempotencyKey: ev.id, clientSeq: ++clientSeq,
                            clientTs: Date.now(), innings: ev.innings, payload: ev });
const post = async (...evs) => (await api(`/api/matches/${MATCH}/events`, {
  method: "POST", token, body: { events: evs.map(envelope) } })).body;
const serverLog = async () => ((await api(`/api/matches/${MATCH}/events?since=0`, { token })).body?.events || []).map(fromRow);
const innings = async (i) => deriveInnings((await serverLog()).filter((e) => (e.innings ?? 0) === i));
const rowCount = async () => (await q(`select count(*)::int n from ball_event where match_id = $1`, [MATCH]))[0].n;
const refusedAs = (res, reason) => res?.refused?.length === 1 && res.refused[0].reason === reason && !res.accepted?.length;

try {
  ok("server comes up", !!(await waitForHealth()));
  token = (await api("/api/auth/dev-login", { method: "POST", body: { email: SCORER, deviceId: DEVICE } })).body?.token;
  const claim = await api(`/api/matches/${MATCH}/session/claim`, { method: "POST", token, body: { device: DEVICE } });
  ok("the scorer claims the match", claim.body?.ok === true, JSON.stringify(claim.body));
  epoch = claim.body?.epoch;

  const squad = P.map((id, i) => ({ id, name: `Player ${i + 1}` }));
  // Both innings opened up front, the way the scorer's setup does it.
  const open0 = [stamp(0, inningsStart({ battingTeam: "Hilton 1st XI", bowlingTeam: "Michaelhouse", squad, overs: 2 })),
                 stamp(1, inningsStart({ battingTeam: "Michaelhouse", bowlingTeam: "Hilton 1st XI", squad: [], bowlingSquad: squad, overs: 2 })),
                 stamp(0, batters({ striker: P[0], nonStriker: P[1] })),
                 stamp(0, bowler({ bowler: DLAMINI }))];
  const opened = await post(...open0);
  ok("the innings is opened", opened?.accepted?.length === 4, JSON.stringify(opened));

  group("One key names one event");
  const first = stamp(0, ball({ type: BALL_TYPE.RUN, value: 1 }));
  const a1 = await post(first);
  ok("a ball is accepted", a1?.accepted?.length === 1);
  const seq1 = a1?.accepted?.[0]?.seq;
  const before = await rowCount();
  const retry = await post(first);
  ok("the same key with the same body is a duplicate, at the same seq",
     retry?.duplicates?.length === 1 && retry.duplicates[0].seq === seq1 && !retry.conflicts?.length, JSON.stringify(retry));
  const changed = await post({ ...first, value: 4 });
  ok("the same key with a DIFFERENT body is a conflict, naming the stored seq",
     changed?.conflicts?.length === 1 && changed.conflicts[0].seq === seq1
     && changed.conflicts[0].reason === "idempotency_conflict" && !changed.duplicates?.length, JSON.stringify(changed));
  ok("...and nothing was written for either", (await rowCount()) === before);
  const stored = await q(`select value from ball_event where idempotency_key = $1`, [first.id]);
  ok("...the stored ball is still the one first sent", stored[0]?.value === 1);

  group("Innings are played in order");
  const early = await post(stamp(1, ball({ type: BALL_TYPE.RUN, value: 4 })));
  ok("a ball in the second innings while the first is open is refused",
     refusedAs(early, REFUSAL.PREVIOUS_INNINGS_OPEN), JSON.stringify(early));

  group("At the crease");
  // After the single, P[1] is on strike and P[0] at the other end.
  const stranger = await post(stamp(0, ball({ type: BALL_TYPE.WICKET, dismissal: "run_out", dismissed: P[2] })));
  ok("a wicket for a batter who is not at the crease is refused", refusedAs(stranger, REFUSAL.NOT_AT_CREASE), JSON.stringify(stranger));
  const twice = await post(stamp(0, batters({ nonStriker: P[1] })));
  ok("the same batter at both ends is refused", refusedAs(twice, REFUSAL.SAME_BATTER_BOTH_ENDS), JSON.stringify(twice));
  const swap = await post(stamp(0, batters({ striker: P[2] })));
  ok("a not-out batter cannot be replaced without leaving", refusedAs(swap, REFUSAL.CREASE_OCCUPIED), JSON.stringify(swap));

  group("Undo is last-in, first-out");
  const second = stamp(0, ball({ type: BALL_TYPE.RUN, value: 6 }));
  await post(second);
  const old = await post(stamp(0, voidEvent({ target: first.id })));
  ok("a void of an older ball is refused — that is an amendment", refusedAs(old, REFUSAL.VOID_NOT_LATEST), JSON.stringify(old));
  const unknown = await post(stamp(0, voidEvent({ target: "no-such-ball" })));
  ok("a void of nothing in this match is refused", refusedAs(unknown, REFUSAL.VOID_UNKNOWN_TARGET), JSON.stringify(unknown));
  const latest = await post(stamp(0, voidEvent({ target: second.id })));
  ok("a void of the latest ball is accepted", latest?.accepted?.length === 1, JSON.stringify(latest));
  ok("...and the six is off the board", (await innings(0)).runs === 1);
  const again = await post(stamp(0, voidEvent({ target: second.id })));
  ok("it cannot be undone twice", refusedAs(again, REFUSAL.VOID_ALREADY_VOIDED), JSON.stringify(again));

  group("One illegal event does not wedge the queue");
  // Five legal balls finish the over. The middle event is illegal; the rest
  // of the batch is still judged, against the log without it.
  const batch = await post(stamp(0, ball({ value: 0 })), stamp(0, ball({ value: 2 })),
                           stamp(0, ball({ type: BALL_TYPE.WICKET, dismissal: "caught", dismissed: "Nobody" })),
                           stamp(0, ball({ value: 0 })), stamp(0, ball({ value: 1 })), stamp(0, ball({ value: 0 })));
  ok("the illegal one is refused by name, the five legal ones are written",
     batch?.refused?.length === 1 && batch.refused[0].reason === REFUSAL.NOT_AT_CREASE && batch?.accepted?.length === 5,
     JSON.stringify(batch));
  ok("the over is complete", (await innings(0)).balls === 6);

  group("The over, and the bowler");
  const noBowler = await post(stamp(0, ball({ value: 1 })));
  ok("a ball with nobody named to bowl the new over is refused", refusedAs(noBowler, REFUSAL.NEXT_BOWLER), JSON.stringify(noBowler));
  const same = await post(stamp(0, bowler({ bowler: DLAMINI })));
  ok("the same bowler for a second over running is refused (Law 17.8)", refusedAs(same, REFUSAL.CONSECUTIVE_OVERS), JSON.stringify(same));
  const change = await post(stamp(0, bowler({ bowler: MOKOENA })));
  ok("a different bowler is accepted", change?.accepted?.length === 1);
  const over2 = await post(...[1, 0, 4, 0, 0, 1].map((v) => stamp(0, ball({ value: v }))));
  ok("the second over is scored", over2?.accepted?.length === 6, JSON.stringify(over2));
  const inn0 = await innings(0);
  ok(`the first innings is over by the laws — ${inn0.runs}/${inn0.wickets} off ${inn0.balls}`,
     inn0.complete === true && inn0.balls === 12 && inn0.runs === 10);
  const late = await post(stamp(0, ball({ value: 1 })));
  ok("a ball after the overs are done is refused", refusedAs(late, REFUSAL.INNINGS_OVER), JSON.stringify(late));
  const seal = await post(stamp(0, sealInnings(inn0)));
  ok("the scorer seals it", seal?.accepted?.length === 1 && (await innings(0)).sealed === true);

  group("The chase, through the sync engine, to a result");
  // The break re-declares the chase with its target (engine.jsx, SCRBRD-063).
  const target = inn0.runs + 1;
  const engine = new SyncEngine({
    matchId: MATCH, deviceId: DEVICE, scorerId: claim.body?.user_id ?? null, epoch, innings: 1,
    storage: memoryStorage(),
    transport: async (id, evs) => {
      const r = await api(`/api/matches/${id}/events`, { method: "POST", token, body: { events: evs } });
      if (r.status !== 200) throw new Error(`${r.status}: ${JSON.stringify(r.body)}`);
      return r.body;
    },
  });
  await engine.init();
  const rec = async (ev) => { await engine.record(stamp(1, ev)); await engine.sync(); };
  const drain = async () => {
    for (let i = 0; i < 40 && engine.pendingCount > 0; i++) { await engine.sync(); await new Promise((r) => setTimeout(r, 50)); }
  };
  await rec(inningsStart({ battingTeam: "Michaelhouse", bowlingTeam: "Hilton 1st XI", squad: [], bowlingSquad: squad, overs: 2, target }));
  await rec(batters({ striker: DLAMINI, nonStriker: MOKOENA }));
  await rec(bowler({ bowler: P[2] }));
  await rec(ball({ value: 4 }));
  await rec(ball({ type: BALL_TYPE.WICKET, dismissal: "stumped", dismissed: "Twelfth Man" }));   // illegal
  await rec(ball({ value: 2 }));
  await drain();
  ok("the engine holds the refused ball for a person, with its reason",
     engine.held.length === 1 && engine.held[0].state === "refused" && engine.held[0].reason === REFUSAL.NOT_AT_CREASE,
     JSON.stringify(engine.held.map((h) => [h.state, h.reason])));
  ok("...it is neither acked nor left pending, so the outbox drains", engine.pendingCount === 0
     && !engine.acked.some((a) => a.idempotencyKey === engine.held[0]?.idempotencyKey));
  ok("...and the balls either side of it reached the server", (await innings(1)).runs === 6);
  await rec(ball({ value: 4 }));   // 10 — one short of 11
  await rec(ball({ value: 1 }));   // 11: the chase is won
  await drain();

  const log = await serverLog();
  const match = deriveMatch(log);
  ok(`the match is decided — ${match.result?.winner} by ${match.result?.margin}`,
     match.result?.winner === "Michaelhouse" && match.innings[1].runs === target, JSON.stringify(match.result));
  const after = await post(stamp(1, ball({ value: 6 })));
  ok("no ball is accepted after the match is decided", refusedAs(after, REFUSAL.MATCH_DECIDED), JSON.stringify(after));

  group("The server's fold and the device's agree");
  const [live0] = await q(`select runs::int, wickets::int, legal_balls::int from match_live_score where match_id = $1 and innings = 0`, [MATCH]);
  const [live1] = await q(`select runs::int, wickets::int, legal_balls::int from match_live_score where match_id = $1 and innings = 1`, [MATCH]);
  ok("first innings: SQL and replay agree", live0?.runs === match.innings[0].runs && live0?.legal_balls === match.innings[0].balls,
     JSON.stringify([live0, match.innings[0].runs]));
  ok("second innings: SQL and replay agree", live1?.runs === match.innings[1].runs && live1?.legal_balls === match.innings[1].balls,
     JSON.stringify([live1, match.innings[1].runs]));
  const [unstamped] = await q(`select count(*)::int n from ball_event where match_id = $1 and fingerprint is null`, [MATCH]);
  ok("every event written carries its fingerprint", unstamped.n === 0);

  group("How the bat met it: contact and trajectory reach the log (SCRBRD-071)");
  // toRow() maps both to columns; the live INSERT used to list neither, so a
  // captured edge arrived as nothing at all.
  const sc = await api(`/api/matches/${SHOTS}/session/claim`, { method: "POST", token, body: { device: DEVICE } });
  ok("the scorer claims a second fixture", sc.body?.ok === true, JSON.stringify(sc.body));
  const shotsPost = async (...evs) => (await api(`/api/matches/${SHOTS}/events`, {
    method: "POST", token, body: { events: evs.map((ev) => ({ ...envelope(ev), epoch: sc.body?.epoch })) } })).body;
  const shotsLog = async () => ((await api(`/api/matches/${SHOTS}/events?since=0`, { token })).body?.events || []);
  const setUp = await shotsPost(stamp(0, inningsStart({ battingTeam: "Hilton U16B", bowlingTeam: "Kearsney", squad, overs: 2 })),
                                stamp(0, batters({ striker: P[0], nonStriker: P[1] })), stamp(0, bowler({ bowler: DLAMINI })));
  ok("the innings is opened", setUp?.accepted?.length === 3, JSON.stringify(setUp));
  const edged = stamp(0, ball({ type: BALL_TYPE.RUN, value: 4, contact: "outside_edge", trajectory: "aerial" }));
  const e1 = await shotsPost(edged);
  ok("an edge in the air is accepted", e1?.accepted?.length === 1, JSON.stringify(e1));
  const [stored2] = await q(`select contact, trajectory from ball_event where idempotency_key = $1`, [edged.id]);
  ok("...stored in its columns", stored2?.contact === "outside_edge" && stored2?.trajectory === "aerial", JSON.stringify(stored2));
  const back = (await shotsLog()).map(fromRow).find((e) => e.id === edged.id);
  ok("...and read back through the API as the scorer sent it",
     back?.contact === "outside_edge" && back?.trajectory === "aerial", JSON.stringify(back));
  const e2 = await shotsPost(edged);
  ok("a retry of it is a duplicate", e2?.duplicates?.length === 1 && !e2?.conflicts?.length, JSON.stringify(e2));
  const e3 = await shotsPost({ ...edged, contact: "middle" });
  ok("the same key claiming the ball was middled is a conflict: contact is content", e3?.conflicts?.length === 1, JSON.stringify(e3));

  // A ROW STORED BEFORE THIS FIX, retried now. The old write path listed
  // neither column, so the row holds NULL for both whatever the event said.
  // Written here exactly as that path wrote it — its column list, the same
  // toRow() — and then retried through today's path.
  const oldWriter = async (ev, seq) => {
    const r = toRow(ev);
    await q(`insert into ball_event
               (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                idempotency_key, client_seq, client_ts, kind, ball_type, value, shot, seg, zone,
                striker_id, non_striker_id, bowler_id, dismissed_id, dismissal, payload,
                theta, radius, placement_source, placement_null, close_position, capture_profile)
             select $1, match_school($1), $2, $3, r.innings, (select id from app_user where email = $4), $5,
                    $6, $2, now(), r.kind, r.ball_type, r.value, r.shot, r.seg, r.zone,
                    r.striker_id, r.non_striker_id, r.bowler_id, r.dismissed_id, r.dismissal, r.payload,
                    r.theta, r.radius, r.placement_source, r.placement_null, r.close_position, r.capture_profile
               from jsonb_populate_record(null::ball_event, $7::jsonb) r`,
            [SHOTS, seq, sc.body?.epoch, SCORER, DEVICE, ev.id, JSON.stringify({ ...r, match_id: SHOTS })]);
  };
  const [{ n: top }] = await q(`select max(seq)::int n from ball_event where match_id = $1`, [SHOTS]);
  // What the pad sends, and always has: ball() fills both with null.
  const padBall = stamp(0, ball({ type: BALL_TYPE.RUN, value: 1 }));
  ok("the pad's ball() carries contact and trajectory as null", padBall.contact === null && padBall.trajectory === null);
  await oldWriter(padBall, top + 1);
  const r1 = await shotsPost(padBall);
  ok("a retry of a ball the OLD path stored is still a duplicate — its fingerprint did not move",
     r1?.duplicates?.length === 1 && r1.duplicates[0].seq === top + 1 && !r1?.conflicts?.length, JSON.stringify(r1));
  // The one case that would move: an event that DID carry a contact, stored
  // by the old path without it. No client has ever sent one (the pad does
  // not offer the capture), so no stored row is in this state — this shows
  // what the risk would have looked like: loud, a conflict held for a
  // person, never a silent drop.
  const lost = stamp(0, ball({ type: BALL_TYPE.RUN, value: 0, contact: "beat" }));
  await oldWriter(lost, top + 2);
  const r2 = await shotsPost(lost);
  ok("(an old row that had lost a contact would read as a conflict, not a duplicate)", r2?.conflicts?.length === 1, JSON.stringify(r2));

  group("A value the record cannot hold refuses one event, not the batch (SCRBRD-077)");
  // A value outside a column CHECK used to throw inside appendEvents: the
  // whole batch a 500, and the device resending it forever. Now each is
  // refused on its own, named, and the legal balls either side are written.
  const bad = (name, fields) => ({ name, ev: stamp(0, ball({ type: BALL_TYPE.RUN, value: 0, ...fields })) });
  const good1 = stamp(0, ball({ type: BALL_TYPE.RUN, value: 1 }));
  const good2 = stamp(0, ball({ type: BALL_TYPE.RUN, value: 2 }));
  const cases = [
    [bad("contact", { contact: "thick_edge" }), "contact_unknown"],
    [bad("trajectory", { contact: "middle", trajectory: "skied" }), "trajectory_unknown"],
    [bad("a path off a bat that missed", { contact: "beat", trajectory: "aerial" }), "trajectory_without_contact"],
    [bad("placement source", { placementSource: "guess" }), "placement_invalid"],
    [bad("why there is no placement", { placementNull: "forgot" }), "placement_invalid"],
    [bad("capture profile", { captureProfile: "extreme" }), "capture_profile_unknown"],
    [bad("a bearing past 359", { placementSource: "point", theta: 400, radius: 0.5 }), "placement_invalid"],
    [bad("a zone", { zone: "deep" }), "placement_invalid"],
    [bad("a segment that is not a number", { seg: "abc" }), "value_refused"],
  ];
  const valueBatch = [good1, ...cases.map(([c]) => c.ev), good2];
  const vr = await api(`/api/matches/${SHOTS}/events`, {
    method: "POST", token, body: { events: valueBatch.map((ev) => ({ ...envelope(ev), epoch: sc.body?.epoch })) } });
  ok("the batch is answered, not a 500", vr.status === 200, JSON.stringify(vr.body));
  ok("the legal balls either side are written", vr.body?.accepted?.length === 2
     && vr.body.accepted.every((a) => [good1.id, good2.id].includes(a.idempotencyKey)), JSON.stringify(vr.body?.accepted));
  for (const [c, reason] of cases) {
    const r = vr.body?.refused?.find((x) => x.idempotencyKey === c.ev.id);
    ok(`${c.name}: refused as ${reason}`, r?.reason === reason, JSON.stringify(r));
  }
  ok("every refused reason has words for the person reading it",
     (vr.body?.refused ?? []).every((r) => typeof REFUSAL_TEXT[r.reason] === "string"), JSON.stringify(vr.body?.refused));
  const [{ n: wrote }] = await q(`select count(*)::int n from ball_event where idempotency_key = any($1)`,
                                 [cases.map(([c]) => c.ev.id)]);
  ok("...and none of the refused events was written", wrote === 0);
  const resent = await api(`/api/matches/${SHOTS}/events`, {
    method: "POST", token, body: { events: valueBatch.map((ev) => ({ ...envelope(ev), epoch: sc.body?.epoch })) } });
  ok("resent, the batch settles the same way: two duplicates, the rest refused — nothing wedges",
     resent.status === 200 && resent.body?.duplicates?.length === 2 && resent.body?.refused?.length === cases.length,
     JSON.stringify(resent.body));

  // A vocabulary packages/scoring owns is refused at the door, whatever the
  // token: holding it would only move the failure to the day it is released.
  const staleBad = stamp(0, ball({ type: BALL_TYPE.RUN, value: 0, captureProfile: "extreme" }));
  const sb = await api(`/api/matches/${SHOTS}/events`, {
    method: "POST", token, body: { events: [{ ...envelope(staleBad), epoch: (sc.body?.epoch ?? 0) + 99 }] } });
  ok("a stale-token event with a value the record cannot hold is refused, not held",
     sb.body?.refused?.[0]?.reason === "capture_profile_unknown" && !sb.body?.quarantined?.length, JSON.stringify(sb.body));
  // One whose only vocabulary is the database's CHECK is held — the CHECK runs
  // at the INSERT — and refused, in words, when somebody tries to release it.
  const staleContact = stamp(0, ball({ type: BALL_TYPE.RUN, value: 0, contact: "thick_edge" }));
  const sh = await api(`/api/matches/${SHOTS}/events`, {
    method: "POST", token, body: { events: [{ ...envelope(staleContact), epoch: (sc.body?.epoch ?? 0) + 99 }] } });
  ok("a stale-token event whose contact only the CHECK knows is held", sh.body?.quarantined?.length === 1, JSON.stringify(sh.body));
  const [heldRow] = await q(`select id from ball_event_quarantine where idempotency_key = $1`, [staleContact.id]);
  const approver = (await api("/api/auth/dev-login", { method: "POST", body: { email: "sarah@example.invalid", deviceId: "device-laws-approver" } })).body?.token;
  const rel = await api(`/api/quarantine/${heldRow?.id}/resolve`, { method: "POST", token: approver, body: { accept: true } });
  ok("...and releasing it is refused with the reason, not a 500", rel.status === 200 && rel.body?.ok === false
     && rel.body?.reason === "value_refused" && rel.body?.value === "contact_unknown" && !!rel.body?.text, JSON.stringify(rel));
  const [{ n: stillHeld }] = await q(`select count(*)::int n from ball_event_quarantine
                                       where idempotency_key = $1 and resolved_at is null`, [staleContact.id]);
  ok("...and it is still held, for a person to discard", stillHeld === 1);

  // The door reads placement.mjs; the table's CHECKs say the same. If one
  // moves without the other, this is where it shows.
  for (const [constraint, vocab] of [["ball_event_placement_source", PLACEMENT_SOURCE],
                                     ["ball_event_placement_null", PLACEMENT_NULL],
                                     ["ball_event_capture_profile", CAPTURE_PROFILE]]) {
    const [{ def }] = await q(`select pg_get_constraintdef(oid) def from pg_constraint
                                where conrelid = 'ball_event'::regclass and conname = $1`, [constraint]);
    const inCheck = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
    ok(`${constraint} and placement.mjs list the same values`,
       JSON.stringify(inCheck) === JSON.stringify(Object.values(vocab).sort()), `${def} vs ${Object.values(vocab)}`);
  }
  group("An event without its identity is refused at the door, and nothing is written");
  const rowsBeforeNameless = await rowCount();
  const nameless = await api(`/api/matches/${MATCH}/events`, { method: "POST", token, body: { events: [
    envelope(stamp(0, ball({ type: BALL_TYPE.RUN, value: 1 }))),                // well-formed
    { epoch, deviceId: DEVICE, clientSeq: ++clientSeq, clientTs: Date.now(), innings: 0,
      payload: ball({ innings: 0, type: BALL_TYPE.RUN, value: 1 }) },   // no idempotencyKey
  ] } });
  ok("a batch with an event missing its key is a 400 naming it — it used to be a 500 the device resent for ever",
     nameless.status === 400 && nameless.body?.error === "malformed_event", `${nameless.status} ${JSON.stringify(nameless.body)}`);
  ok("...and not even the well-formed event beside it was written", (await rowCount()) === rowsBeforeNameless);

} catch (e) {
  ok(`the walk threw: ${e.message?.slice(0, 200)}`, false);
  console.log(e.stack?.split("\n").slice(0, 4).join("\n"));
} finally {
  server.kill("SIGTERM");
  await pool.end();
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nLAWS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
