#!/usr/bin/env node
/**
 * Pilot Match phase 2, slice 2: the write path, against a real Postgres and
 * the real API (docs/design/PILOT_MATCH_PHASE2.md §3, §4, §11).
 *
 *   A  Off as db/151 leaves it: the status says so, and a granted account
 *      creates nothing.
 *   B  Switched on: an account with no pilot.scorer grant cannot create
 *      (Google sign-up gives nobody one); the granted owner creates,
 *      idempotently; for anybody else every per-match route is the one
 *      not-found, the same as an id that does not exist.
 *   C  The names: refused while the counsel fallback is on; with it off,
 *      put once, and read back by the owner alone.
 *   D  The node SyncEngine scores two innings against the server, OFFLINE
 *      then online: recorded unattached, claimed, flushed; every event
 *      accepted; a retried batch all duplicates; the server's log folds to
 *      the pad's score.
 *   E  The screen: the canary in a ball (name_in_event), a player who is no
 *      slot (unknown_slot), a note (free_text), each refused per event, the
 *      rest of the batch written.
 *   F  Another account cannot claim; the owner's second phone is refused a
 *      live lease, refused a plain claim over a lapsed one, and takes it over
 *      only by the confirmed press; the first phone's next ball is HELD.
 *   G  The server's rows: no typed name in any pilot row but pilot.name (a
 *      dump grepped for the canary), and nothing in ball_event or match.
 *   H  Delete: another account cannot; the owner can, everything goes,
 *      tombstones stay.
 *
 * Everyone here is invented, with @example.invalid addresses; the test name
 * is the canary `Qa Canarytest`, which is nobody.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-pilot-sync.mjs
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { SyncEngine, memoryStorage } from "@scrbrd/sync";
import { appUrl, ownerUrl, port } from "./db-url.mjs";
import { deriveMatch, fromRow, inningsStart, batters, bowler, ball, playStopped, BALL_TYPE, newEventId } from "@scrbrd/scoring";

const PORT = port(8793);
const BASE = `http://127.0.0.1:${PORT}`;
const CANARY = "Qa Canarytest";
const EMAIL = { a: "pilot.walk.a@example.invalid", b: "pilot.walk.b@example.invalid", c: "pilot.walk.c@example.invalid" };

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const owner = new pg.Client({ connectionString: ownerUrl() });
await owner.connect();
const sql = (/** @type {string} */ q, /** @type {any[]} */ p = []) => owner.query(q, p);

// Three school-less accounts, as a Google sign-up makes them (role 'none'):
// A and B are granted, C is not.
const ids = {};
for (const [k, email] of Object.entries(EMAIL)) {
  const { rows } = await sql(`insert into app_user (school_id, email, name, role) values (null, $1, $2, 'none')
                              on conflict (email) do update set active = true returning id`, [email, `Pilot Walk ${k.toUpperCase()}`]);
  ids[k] = rows[0].id;
}
await sql(`update pilot.switch set enabled = false`);
await sql(`insert into pilot.scorer (user_id) values ($1), ($2) on conflict (user_id) do update set ended_at = null`, [ids.a, ids.b]);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-pilot-sync-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (/** @type {string} */ path, { method = "GET", token = /** @type {string|undefined} */ (undefined), body = /** @type {any} */ (undefined) } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, text };
};
const login = async (/** @type {string} */ email, /** @type {string} */ device) =>
  (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: device } })).body?.token;

const M = randomUUID();
const slot = () => randomUUID();
const H = Array.from({ length: 4 }, slot);   // home: list 1..4
const W = Array.from({ length: 4 }, slot);   // away
const SIDES = [
  { side: "home", school: "Walk Home", age_division: "U13", team_class: "B", display_name: "Walk Home U13B" },
  { side: "away", school: "Walk Away", age_division: "U13", team_class: "B", display_name: "Walk Away U13B" },
];
const SLOTS = [...H.map((id, i) => ({ id, side: "home", list_no: i + 1, batting_no: i + 1, twelfth: false })),
               ...W.map((id, i) => ({ id, side: "away", list_no: i + 1, batting_no: i + 1, twelfth: false }))];
const CREATE = { id: M, sides: SIDES, slots: SLOTS, overs: 1, format: null, startsAt: new Date().toISOString(),
                 toss: { wonBy: "home", decision: "bat" }, venueName: "Walk Oval",
                 weather: { condition: "sunny", temp_c: 22, lat: -29.54, lon: 30.28 } };

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await api("/api/health")).body?.db === "ok"; } catch { /* not yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 250));
  }
  ok("server comes up and reaches the database", up);
  const A1 = "pilot-walk-a-1", A2 = "pilot-walk-a-2";
  const ta = await login(EMAIL.a, A1), tb = await login(EMAIL.b, "pilot-walk-b-1"), tc = await login(EMAIL.c, "pilot-walk-c-1");
  ok("three invented accounts sign in", [ta, tb, tc].every((t) => typeof t === "string"));

  group("A. Off, as db/151 leaves it");
  let st = await api("/api/pilot/status", { token: ta });
  ok("the status says phase 2 is off, and says nothing of the grant", st.status === 200 && st.body?.sync === false && st.body?.granted === false && st.body?.names === false, st.text);
  let cr = await api("/api/pilot/matches", { method: "POST", token: ta, body: CREATE });
  ok("a granted account creates nothing: pilot_off", cr.body?.ok === false && cr.body?.reason === "pilot_off", cr.text);
  ok("signed out, the status is refused", (await api("/api/pilot/status")).status === 401);

  group("B. Switched on: the grant, the owner, the one not-found");
  await sql(`update pilot.switch set enabled = true where key = 'pilot_sync'`);
  st = await api("/api/pilot/status", { token: tc });
  ok("an account with no grant is told so", st.body?.sync === true && st.body?.granted === false, st.text);
  cr = await api("/api/pilot/matches", { method: "POST", token: tc, body: CREATE });
  ok("...and cannot create: not_granted", cr.body?.ok === false && cr.body?.reason === "not_granted", cr.text);
  st = await api("/api/pilot/status", { token: ta });
  ok("the granted owner is told he may send, and that names stay on the phone", st.body?.granted === true && st.body?.names === false, st.text);
  cr = await api("/api/pilot/matches", { method: "POST", token: ta, body: CREATE });
  ok("the owner creates the match", cr.body?.ok === true, cr.text);
  ok("...again, the same answer (idempotent)", (await api("/api/pilot/matches", { method: "POST", token: ta, body: CREATE })).body?.ok === true);
  ok("...and the venue it was sent is not kept (review S4)",
     (await sql(`select venue_name from pilot.match where id = $1`, [M])).rows[0]?.venue_name === null);
  const head = await api(`/api/pilot/${M}`, { token: ta });
  ok("the header: live, two sides, eight slots, no position kept", head.body?.status === "live" && head.body?.sides?.length === 2
     && head.body?.slots?.length === 8 && !/"lat"|"lon"|-29\.54/.test(head.text), head.text);
  const nf = await api(`/api/pilot/${randomUUID()}`, { token: tb });
  const other = await api(`/api/pilot/${M}`, { token: tb });
  ok("another granted account reads the one not-found, the same as an unknown id",
     other.status === 404 && nf.status === 404 && other.text === nf.text, `${other.status} ${other.text} / ${nf.status} ${nf.text}`);
  ok("...and creating the same id is not_found to it", (await api("/api/pilot/matches", { method: "POST", token: tb, body: CREATE })).body?.reason === "not_found");
  for (const path of [`/api/pilot/${M}/events`, `/api/pilot/${M}/names`]) {
    const r = await api(path, { token: tb });
    ok(`...GET ${path.replace(M, ":id")} is the one not-found`, r.status === 404 && r.text === nf.text, r.text);
  }
  ok("...its list holds none of A's", !((await api("/api/pilot/mine", { token: tb })).body?.matches ?? [{}]).some((m) => m.id === M));
  ok("the owner's list holds it", ((await api("/api/pilot/mine", { token: ta })).body?.matches ?? []).some((m) => m.id === M));

  group("C. The names");
  const NAMES = [{ slot: H[0], name: CANARY }, { slot: H[1], name: "Walk Home Two" }, { slot: W[0], name: "Walk Away One" }];
  let np = await api(`/api/pilot/${M}/names`, { method: "POST", token: ta, body: { rows: NAMES } });
  ok("with the counsel fallback on, the names do not go: names_upload_off", np.body?.ok === false && np.body?.reason === "names_upload_off", np.text);
  ok("...and none is held", (await sql(`select count(*)::int n from pilot.name where match_id = $1`, [M])).rows[0].n === 0);
  await sql(`update pilot.switch set enabled = true where key = 'pilot_names_upload'`);
  np = await api(`/api/pilot/${M}/names`, { method: "POST", token: ta, body: { rows: NAMES } });
  ok("with it off, the owner puts three names", np.body?.ok === true && np.body?.n === 3, np.text);
  const back = await api(`/api/pilot/${M}/names`, { token: ta });
  ok("...and reads them back", back.body?.names?.some((x) => x.slot === H[0] && x.name === CANARY), back.text);
  ok("another account cannot put one", (await api(`/api/pilot/${M}/names`, { method: "POST", token: tb, body: { rows: NAMES } })).status === 404);

  group("D. Two innings, offline then online");
  let online = false;
  const sent = [];
  const transport = (/** @type {string} */ token) => async (/** @type {string} */ _id, /** @type {any[]} */ batch) => {
    sent.push(batch.length);
    const r = await api(`/api/pilot/${M}/events`, { method: "POST", token, body: { events: batch } });
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text}`);
    return r.body;
  };
  const engine = new SyncEngine({ matchId: `pilot-${M}`, deviceId: A1, scorerId: ids.a, epoch: null, innings: 0,
                                  storage: memoryStorage(), isOnline: () => online, transport: transport(ta) });
  await engine.init();
  const id = () => newEventId(A1, `pilot-${M}`);
  // Until the queue is empty: record() starts a flush of its own once
  // attached, and sync() then answers with that one.
  const drain = async () => { let r = await engine.sync(); for (let i = 0; i < 10 && engine.pendingCount && !engine.lastError; i++) r = await engine.sync(); return r; };
  const rec = (/** @type {any} */ ev) => engine.record({ ...ev, id: id() });
  await rec(inningsStart({ innings: 0, battingTeam: "home", bowlingTeam: "away", teamKey: "home", bowlingTeamKey: "away",
                           squad: H, bowlingSquad: W, overs: 1 }));
  await rec(batters({ innings: 0, striker: H[0], nonStriker: H[1] }));
  await rec(bowler({ innings: 0, bowler: W[0] }));
  for (const v of [1, 4, 0, 2, 0, 6]) await rec(ball({ innings: 0, type: BALL_TYPE.RUN, value: v }));
  ok("nothing sent while offline and unattached", sent.length === 0 && engine.pendingCount === 9);
  online = true;
  const claim = await api(`/api/pilot/${M}/session/claim`, { method: "POST", token: ta, body: { device: A1 } });
  ok("the owner claims: epoch 1", claim.body?.ok === true && claim.body?.epoch === 1, claim.text);
  await engine.attach(claim.body.epoch);
  let flush = await drain();
  ok("the first innings flushed: nine accepted, none refused or held", flush.remaining === 0 && engine.held.length === 0 && engine.rejected.length === 0,
     JSON.stringify({ flush, held: engine.held, rej: engine.rejected, err: engine.lastError }));
  // The chase: the second innings, one over, the target 14.
  engine.innings = 1;
  await rec(inningsStart({ innings: 1, battingTeam: "away", bowlingTeam: "home", teamKey: "away", bowlingTeamKey: "home",
                           squad: W, bowlingSquad: H, overs: 1, target: 14 }));
  await rec(batters({ innings: 1, striker: W[0], nonStriker: W[1] }));
  await rec(bowler({ innings: 1, bowler: H[2] }));
  for (const v of [6, 0, 1]) await rec(ball({ innings: 1, type: BALL_TYPE.RUN, value: v }));
  await rec(ball({ innings: 1, type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled", dismissed: W[1] }));
  await rec(batters({ innings: 1, striker: W[2] }));
  for (const v of [2, 4]) await rec(ball({ innings: 1, type: BALL_TYPE.RUN, value: v }));
  flush = await drain();
  ok("the second innings flushed too", flush.remaining === 0 && engine.held.length === 0, JSON.stringify({ flush, held: engine.held, err: engine.lastError }));
  const retry = await api(`/api/pilot/${M}/events`, { method: "POST", token: ta, body: { events: engine.acked.map(({ seq: _s, ...e }) => e) } });
  ok("a retried batch is all duplicates", retry.body?.duplicates?.length === engine.acked.length && retry.body?.accepted?.length === 0, retry.text.slice(0, 300));
  const listed = await api(`/api/pilot/${M}/events?since=0`, { token: ta });
  const rows = listed.body?.events ?? [];
  ok(`the server holds the ${engine.acked.length} events, seq 1 onwards`, rows.length === engine.acked.length && rows.every((r, i) => r.seq === i + 1), listed.text.slice(0, 300));
  ok("...each on epoch 1, from this device, by this owner", rows.every((r) => r.epoch === 1 && r.device_id === A1 && r.scorer_user_id === ids.a));
  ok("...and the read says how to fold it, with no conditions", listed.body?.fold?.conditions === null && typeof listed.body?.fold?.startsAt === "string");
  const pad = deriveMatch(engine.acked.map((e) => e.payload));
  const srv = deriveMatch(rows.map(fromRow));
  ok("the server's log folds to the pad's score, innings by innings",
     [0, 1].every((i) => srv.innings[i]?.runs === pad.innings[i]?.runs && srv.innings[i]?.wickets === pad.innings[i]?.wickets
       && srv.innings[i]?.balls === pad.innings[i]?.balls),
     JSON.stringify([srv.innings.map((x) => x && [x.runs, x.wickets, x.balls]), pad.innings.map((x) => x && [x.runs, x.wickets, x.balls])]));
  ok("...13 off the first over, the striker by his slot", srv.innings[0]?.runs === 13 && srv.innings[0]?.batsmen?.some((b) => b.id === H[1] && b.runs === 12));

  group("E. The screen, per event");
  const env = (/** @type {any} */ payload, /** @type {number} */ n) => ({
    matchId: `pilot-${M}`, deviceId: A1, scorerId: ids.a, epoch: 1, innings: 1, clientSeq: 1000 + n, clientTs: Date.now(),
    idempotencyKey: `${A1}:pilot-${M}:screen:${n}`, payload: { ...payload, innings: 1, id: `${A1}:pilot-${M}:screen:${n}`, clientTs: Date.now() } });
  const scr = await api(`/api/pilot/${M}/events`, { method: "POST", token: ta, body: { events: [
    env({ kind: "ball", type: "W", value: 0, dismissal: "caught", dismissed: W[2], fielder: "qa  CANARYTEST" }, 1),
    env({ kind: "batters", striker: randomUUID() }, 2),
    env({ kind: "play_stopped", reason: "rain", note: "hit on the helmet" }, 3),
    env({ kind: "innings_start", battingTeam: "Walk Away U13B", squad: W, bowlingSquad: H, overs: 1 }, 4),
  ] } });
  const why = Object.fromEntries((scr.body?.refused ?? []).map((r) => [r.idempotencyKey.split(":").pop(), r.reason]));
  ok("the canary, in any case and spacing, is name_in_event", why["1"] === "name_in_event", scr.text);
  ok("a player who is no slot is unknown_slot", why["2"] === "unknown_slot", scr.text);
  ok("a note is free_text", why["3"] === "free_text", scr.text);
  ok("a team by its name, not its side, is free_text", why["4"] === "free_text", scr.text);
  ok("...nothing of them was written or held", (scr.body?.accepted ?? []).length === 0 && (scr.body?.quarantined ?? []).length === 0);
  const playStop = await api(`/api/pilot/${M}/events`, { method: "POST", token: ta, body: { events: [
    env(playStopped({ innings: 1, reason: "rain" }), 5)] } });
  ok("the same stoppage as a code alone is not refused for its words", !(playStop.body?.refused ?? []).some((r) => r.reason === "free_text"), playStop.text);

  group("F. Another account; the owner's second phone; a stale ball held");
  const bc = await api(`/api/pilot/${M}/session/claim`, { method: "POST", token: tb, body: { device: "pilot-walk-b-1" } });
  ok("another account cannot claim: the one not-found", bc.status === 404, bc.text);
  const bh = await api(`/api/pilot/${M}/session/heartbeat`, { method: "POST", token: tb, body: { device: "pilot-walk-b-1", epoch: 1 } });
  ok("...nor ask where the token stands", bh.status === 404, bh.text);
  const ta2 = await login(EMAIL.a, A2);
  let c2 = await api(`/api/pilot/${M}/session/claim`, { method: "POST", token: ta2, body: { device: A2 } });
  ok("the owner's second phone, under a live lease: lease_active", c2.body?.ok === false && c2.body?.reason === "lease_active", c2.text);
  await sql(`update pilot.session set lease_until = now() - interval '1 second' where match_id = $1`, [M]);
  c2 = await api(`/api/pilot/${M}/session/claim`, { method: "POST", token: ta2, body: { device: A2 } });
  ok("...a plain claim over the lapsed lease: held_elsewhere, never automatic", c2.body?.ok === false && c2.body?.reason === "held_elsewhere" && c2.body?.epoch === 1, c2.text);
  c2 = await api(`/api/pilot/${M}/session/claim`, { method: "POST", token: ta2, body: { device: A2, takeover: true, epoch: 1 } });
  ok("...the confirmed take-over: epoch 2", c2.body?.ok === true && c2.body?.epoch === 2, c2.text);
  ok("...with an audit row naming both devices",
     (await sql(`select count(*)::int n from pilot.audit where match_id = $1 and event = 'takeover' and detail->>'from_device' = $2 and detail->>'to_device' = $3`, [M, A1, A2])).rows[0].n === 1);
  await rec(ball({ innings: 1, type: BALL_TYPE.RUN, value: 1 }));
  await drain();
  ok("the first phone's next ball is held, not written", engine.rejected.length === 1 && engine.rejected[0]?.reason === "stale_epoch_or_lease",
     JSON.stringify(engine.rejected));
  ok("...it is in pilot.held, and the log did not grow",
     (await sql(`select count(*)::int n from pilot.held where match_id = $1 and resolved_at is null`, [M])).rows[0].n === 1
     && (await sql(`select count(*)::int n from pilot.ball_event where match_id = $1`, [M])).rows[0].n === rows.length);
  const heldKeys = (await sql(`select distinct k from pilot.held h, jsonb_object_keys(h.body) k where match_id = $1`, [M])).rows.map((r) => r.k);
  ok("...its body is the server's own few fields, nothing the client named (review S2)",
     heldKeys.length > 0 && heldKeys.every((k) => ["epoch", "idempotencyKey", "innings", "clientSeq", "clientTs", "payload"].includes(k)), heldKeys.join());

  group("G. What the server holds");
  const dump = (await sql(`select coalesce(string_agg(t, E'\\n'), '') d from (
      select row_to_json(x)::text t from pilot.ball_event x where match_id = $1
      union all select row_to_json(x)::text from pilot.held x where match_id = $1
      union all select row_to_json(x)::text from pilot.match x where id = $1
      union all select row_to_json(x)::text from pilot.side x where match_id = $1
      union all select row_to_json(x)::text from pilot.slot x where match_id = $1
      union all select row_to_json(x)::text from pilot.session x where match_id = $1
      union all select row_to_json(x)::text from pilot.audit x where match_id = $1) z`, [M])).rows[0].d;
  ok("a dump of every pilot row but the names: no typed name", dump.length > 1000 && !/canarytest|Walk Home Two|Walk Away One|Walk Oval/i.test(dump), dump.slice(0, 200));
  ok("...the balls carry slot ids", dump.includes(H[0]) && dump.includes(W[0]));
  ok("pilot.name holds the canary, as typed", (await sql(`select count(*)::int n from pilot.name where match_id = $1 and typed_name = $2`, [M, CANARY])).rows[0].n === 1);
  ok("no ball_event, match or player row was written for it",
     (await sql(`select (select count(*) from ball_event where match_id::text = $1) + (select count(*) from match where id::text = $1)
                      + (select count(*) from player where full_name = $2) as n`, [M, CANARY])).rows[0].n === "0");

  group("H. Delete");
  ok("another account cannot delete it", (await api(`/api/pilot/${M}/delete`, { method: "POST", token: tb })).status === 404);
  const del = await api(`/api/pilot/${M}/delete`, { method: "POST", token: ta2 });
  ok("the owner deletes it", del.body?.ok === true, del.text);
  const left = (await sql(`select (select count(*) from pilot.match where id = $1) + (select count(*) from pilot.name where match_id = $1)
                                + (select count(*) from pilot.ball_event where match_id = $1) + (select count(*) from pilot.held where match_id = $1)
                                + (select count(*) from pilot.slot where match_id = $1) as n`, [M])).rows[0].n;
  ok("...everything of it is gone", left === "0", left);
  ok("...the tombstones stay: its names and itself, by the scorer",
     (await sql(`select string_agg(what || ':' || why, ',' order by what) s from pilot.tombstone where match_id = $1`, [M])).rows[0].s === "match:scorer,names:scorer");
  ok("...and the header is the one not-found", (await api(`/api/pilot/${M}`, { token: ta })).status === 404);
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", /** @type {any} */ (e)?.stack ?? e);
} finally {
  await sql(`update pilot.switch set enabled = false`).catch(() => {});
  await owner.end().catch(() => {});
  server.kill();
  if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
