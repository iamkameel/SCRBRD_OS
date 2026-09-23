#!/usr/bin/env node
/**
 * The two folds agree.
 *
 * There are two implementations of "replay the log and tell me the score":
 * deriveInnings() in packages/scoring, which runs on the device so a scorer can
 * work with no signal, and match_live_score in Postgres, which serves everyone
 * else. Two implementations is one more than anybody wants, and it is not
 * avoidable — the offline one cannot be a SQL view and the public one cannot be
 * JavaScript running in a scorer's pocket.
 *
 * What IS avoidable is the two of them disagreeing without anyone noticing.
 *
 * They did. The log is append-only, so undoing a ball the server already has
 * appends a `void` naming it rather than deleting it. Excluding the voided ball
 * and the void itself was written out by hand wherever it was needed, and
 * match_live_score simply did not do it: a six the scorer corrected still read
 * as six on the public scoreboard, forever, with no error anywhere. The
 * handover path had the exclusion, because a handover FAILS loudly without it.
 * The scoreboard just lied quietly.
 *
 * This walk drives real balls and real undos through the real API, then asks
 * both folds the same question. It is the assertion that makes a fifth
 * divergence impossible to ship rather than merely unlikely.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-fold.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { SyncEngine, memoryStorage } from "@scrbrd/sync";
import {
  deriveInnings, inningsStart, batters, bowler, ball, BALL_TYPE, undoLast, newEventId,
  noPlacement, placementEvidence, evidenceLabel, PLACEMENT_FIELD, PLACEMENT_NULL, CAPTURE_PROFILE,
} from "@scrbrd/scoring";

const PORT = 8796;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const MATCH = "77777777-0000-0000-0000-000000000002";
const DEVICE = "device-fold-01";
const P = [
  "aaaaaaaa-0000-0000-0000-000000000001",
  "aaaaaaaa-0000-0000-0000-000000000002",
  "aaaaaaaa-0000-0000-0000-000000000003",
];

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-fold-secret" },
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

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const token = (await api("/api/auth/dev-login", {
    method: "POST", body: { email: "scorer@example.invalid", deviceId: DEVICE } })).body?.token;
  const profile = await api("/api/session", { token });
  const claim = await api(`/api/matches/${MATCH}/session/claim`, {
    method: "POST", token, body: { device: DEVICE } });
  const epoch = claim.body?.epoch;
  ok("the scorer holds the match", claim.body?.ok === true && typeof epoch === "number");

  // A claim with no device used to succeed. It created a session with
  // holder_device NULL, returned ok and an epoch, and then every ball that
  // scorer sent was quarantined as 'stale_epoch_or_lease' — because the lease
  // check compares the sending device against a NULL holder and never matches.
  // The scorer is told they have the match, scores an over, and loses all of
  // it silently. Found by this file sending `deviceId` where the route reads
  // `device`, which is the typo any client integration makes once.
  const noDevice = await api(`/api/matches/${MATCH}/session/claim`, {
    method: "POST", token, body: {} });
  ok("a claim with no device is refused, not silently accepted",
     noDevice.body?.ok === false && noDevice.body?.reason === "no_device");
  const blankDevice = await api(`/api/matches/${MATCH}/session/claim`, {
    method: "POST", token, body: { device: "   " } });
  ok("...and so is a blank one", blankDevice.body?.ok === false);
  if (process.env.FOLD_DEBUG) {
    console.log("[debug] claim:", JSON.stringify(claim.body));
    console.log("[debug] session row:", JSON.stringify(await dbq("select state, epoch, holder_device, lease_until > now() as valid from scoring_session where match_id=$1",[MATCH])));
  }

  const stillHeld = await dbq(
    `select holder_device, epoch from scoring_session where match_id = $1`, [MATCH]);
  ok("a refused claim leaves the real holder's session untouched",
     stillHeld[0]?.holder_device === DEVICE && stillHeld[0]?.epoch === epoch);

  let online = true;
  // Everything is sent as it happens, so every undo lands on a SYNCED event
  // and therefore appends a void rather than truncating. That is the case the
  // two folds disagreed about, so it is the case worth driving.
  const engine = new SyncEngine({
    matchId: MATCH, deviceId: DEVICE, scorerId: profile.body.user.id, epoch, innings: 0,
    storage: memoryStorage(),
    // Switchable, so the declared-profile innings below can be recorded with
    // no signal and sent afterwards — the offline queue, not a live post.
    isOnline: () => online,
    transport: async (matchId, batch) => {
      const r = await api(`/api/matches/${matchId}/events`, {
        method: "POST", token, body: { events: batch } });
      if (r.status !== 200) throw new Error(`${r.status}: ${JSON.stringify(r.body)}`);
      if (process.env.FOLD_DEBUG) console.log("[debug] sent", batch.length, "→", JSON.stringify(r.body).slice(0,300));
      return r.body;
    },
  });
  await engine.init();

  const log = [];
  // Every event gets an id before it is recorded, exactly as the scoring screen
  // does. This is not ceremony: the id IS the idempotency key, and a void names
  // the ball it undoes by that id. undoLast() refuses to undo an event without
  // one and says so — which is how this walk found out it had been skipping the
  // step, rather than by producing a subtly wrong score.
  const stamp = (ev) => ({ ...ev, id: ev.id ?? newEventId(DEVICE, MATCH) });

  // Attribution is stamped from the crease BEFORE the delivery, exactly as
  // commitBall() does in the scoring surface: the striker who faced this ball
  // is the one there before it rotated them. Mirrored here rather than
  // shortcut, because a walk that attributes balls differently from the app is
  // not testing the app.
  const attribute = (raw) => {
    if (raw.kind !== "ball") return raw;
    const before = deriveInnings(log, {});
    return { ...raw,
             striker: raw.striker ?? before.striker ?? null,
             nonStriker: raw.nonStriker ?? before.nonStriker ?? null,
             bowler: raw.bowler ?? before.bowler ?? null };
  };

  const record = async (raw) => {
    const ev = stamp(attribute(raw));
    log.push(ev);
    await engine.record(ev);
    await engine.sync();
    return ev;
  };

  const squad = P.map((id, i) => ({ id, name: `Player ${i + 1}` }));
  await record(inningsStart({ battingTeam: "Hilton 1st XI", bowlingTeam: "Michaelhouse", squad, overs: 20 }));
  await record(batters({ striker: P[0], nonStriker: P[1] }));
  await record(bowler({ bowler: P[2] }));

  group("An over with corrections in it");
  // Deliberately mixed: runs, a wide and a no-ball (which score AND do not
  // count as a legal delivery), a wicket, and byes — so an off-by-one in
  // either fold shows up rather than cancelling out.
  await record(ball({ type: BALL_TYPE.RUN,    value: 1 }));
  await record(ball({ type: BALL_TYPE.RUN,    value: 4 }));
  await record(ball({ type: BALL_TYPE.WIDE,   value: 0 }));
  await record(ball({ type: BALL_TYPE.NO_BALL, value: 2 }));
  await record(ball({ type: BALL_TYPE.RUN,    value: 0 }));   // undone below
  await record(ball({ type: BALL_TYPE.RUN,    value: 6 }));   // undone below

  // Undo walks back one event at a time, so two undos take the six and then
  // the 0 before it — NOT the six and whatever else looks interesting. Getting
  // that wrong is how the first version of this walk asserted a number that was
  // never going to be produced, and blamed the code for it.
  //
  // Both targets are already synced, so both corrections become voids rather
  // than truncations. That is the case the two folds disagreed about.
  for (let i = 0; i < 2; i++) {
    const { events, action } = undoLast(log, { isSynced: () => true });
    ok(`undo ${i + 1} appends a void rather than deleting`, action === "void");
    const appended = stamp(events[events.length - 1]);
    log.length = 0; log.push(...events.slice(0, -1), appended);
    await engine.record(appended);
    await engine.sync();
  }

  // Let the outbox drain.
  for (let i = 0; i < 40 && engine.pendingCount > 0; i++) {
    await engine.sync();
    await new Promise((r) => setTimeout(r, 100));
  }
  ok("everything reached the server", engine.pendingCount === 0);

  group("Both folds, one log, one answer");
  const local = deriveInnings(log, {});
  const [remote] = await dbq(
    `select runs::int, wickets::int, legal_balls::int from match_live_score
      where match_id = $1 and innings = 0`, [MATCH]);

  ok("the database has a live score for this match", !!remote);
  if (remote) {
    ok(`runs agree — device ${local.runs}, database ${remote.runs}`,
       local.runs === remote.runs);
    ok(`wickets agree — device ${local.wickets}, database ${remote.wickets}`,
       local.wickets === remote.wickets);
    ok(`legal balls agree — device ${local.balls}, database ${remote.legal_balls}`,
       local.balls === remote.legal_balls);
  }

  // The arithmetic, stated independently of both implementations, so this is
  // not just "two things agree" — they could agree and both be wrong.
  //   Standing: 1, 4, a wide, a no-ball for 2. The 0 and the 6 were voided.
  //   Runs = 1 + 4 + (1 wide) + (1 + 2 no-ball) = 9.
  //   Legal deliveries = the 1 and the 4. A wide and a no-ball are not legal,
  //   and the two voided balls did not happen. = 2.
  ok(`the score is independently 9 off 2 legal balls (got ${local.runs}/${local.balls})`,
     local.runs === 9 && local.balls === 2);

  group("The void is recorded, not hidden");
  const all = await dbq(
    `select count(*)::int n from ball_event where match_id = $1 and kind = 'void'`, [MATCH]);
  ok("both corrections are in the log as void events", all[0].n === 2);
  const kept = await dbq(
    `select count(*)::int n from ball_event where match_id = $1`, [MATCH]);
  const live = await dbq(
    `select count(*)::int n from ball_event_live where match_id = $1`, [MATCH]);
  ok("nothing was deleted — the log still holds every row",
     kept[0].n === live[0].n + 4);   // 2 voids + the 2 balls they undid
  ok("ball_event_live excludes exactly the voids and their targets",
     live[0].n === kept[0].n - 4);

  group("Career figures come from the same log");
  // Attribution now lives ON the ball — striker, non-striker and bowler stamped
  // from the crease at the moment of delivery. It used to exist only as replay
  // state, which meant a career average in SQL would have required
  // re-implementing strike rotation as a window function: a third fold over the
  // log, and by far the most intricate one.
  //
  // So this checks the same thing the live score check does, one level down:
  // the per-batter figures the device computed, and the per-player figures the
  // database derived, are the same numbers.
  // Scoped to THIS MATCH, not to a career.
  //
  // It read the career aggregates, which agreed with one innings only while
  // every player in the seed had played exactly one match — true of a seed with
  // no ball log at all, and false the moment one was added, which is the state
  // of any real season. The comparison it means to make is between the device's
  // fold of this innings and the database's fold of the same deliveries, so it
  // now aggregates the same rows rather than everything the boy has ever done.
  //
  // Same source as the career views (ball_event_live, so voided balls are gone)
  // and the same run/extra split, so the two folds stay comparable.
  const careerRows = await dbq(
    `select p.id as player_id,
            coalesce(bat.runs, 0)          as runs,
            coalesce(bat.balls_faced, 0)   as balls_faced,
            coalesce(bowl.balls_bowled, 0) as balls_bowled,
            coalesce(bowl.runs_conceded, 0) as runs_conceded
       from player p
       left join (
         -- Exactly the rules player_batting_career uses, so the two folds are
         -- compared on one definition: runs off the bat only, and a no-ball IS
         -- a ball faced while a wide is not.
         select striker_id,
                sum(case when ball_type in ('run','W','Nb') then coalesce(value,0) else 0 end)::int as runs,
                sum(case when ball_type <> 'Wd' then 1 else 0 end)::int as balls_faced
           from ball_event_live where match_id = $2 and kind = 'ball' group by striker_id
       ) bat on bat.striker_id = p.id
       left join (
         -- Likewise player_bowling_career: an extra costs the bowler the run
         -- plus the delivery, and neither counts towards his legal balls.
         select bowler_id,
                sum(case when ball_type not in ('Wd','Nb') then 1 else 0 end)::int as balls_bowled,
                sum(case when ball_type in ('Wd','Nb') then 1 + coalesce(value,0)
                         when ball_type in ('run','W')  then coalesce(value,0)
                         else 0 end)::int as runs_conceded
           from ball_event_live where match_id = $2 and kind = 'ball' group by bowler_id
       ) bowl on bowl.bowler_id = p.id
      where p.id = any($1::uuid[])`, [P, MATCH]);
  const career = Object.fromEntries(careerRows.map((r) => [r.player_id, r]));

  ok("the database attributes balls to a batter at all",
     careerRows.some((r) => Number(r.balls_faced) > 0));

  // A producer that forgets to stamp the crease does not fail — its balls just
  // quietly stop counting towards anybody's record, which is the same shape of
  // silent wrongness as the voided ball that kept scoring. So it is asserted
  // rather than assumed.
  const unattributed = await dbq(
    `select count(*)::int n from ball_event
      where match_id = $1 and kind = 'ball' and striker_id is null`, [MATCH]);
  ok(`every stored ball names who faced it (${unattributed[0].n} without)`,
     unattributed[0].n === 0);

  for (const bat of local.batsmen) {
    const c = career[bat.id];
    if (!c) continue;
    ok(`${bat.name}: runs agree — device ${bat.runs}, database ${c.runs}`,
       Number(c.runs) === bat.runs);
    ok(`${bat.name}: balls faced agree — device ${bat.balls}, database ${c.balls_faced}`,
       Number(c.balls_faced) === bat.balls);
  }
  for (const bow of local.bowlers) {
    const c = career[bow.id];
    if (!c) continue;
    ok(`${bow.name}: runs conceded agree — device ${bow.runs}, database ${c.runs_conceded}`,
       Number(c.runs_conceded) === bow.runs);
    ok(`${bow.name}: legal balls bowled agree — device ${bow.balls}, database ${c.balls_bowled}`,
       Number(c.balls_bowled) === bow.balls);
  }

  // The voided balls must be absent from the career figures too — the whole
  // reason the aggregates read ball_event_live rather than ball_event.
  const totalFaced = careerRows.reduce((a, r) => a + Number(r.balls_faced), 0);
  ok(`a corrected ball is not in anyone's figures for this match (${totalFaced} faced, ${local.balls} legal + 2 not legal)`,
     totalFaced === local.batsmen.reduce((a, b) => a + b.balls, 0));

  group("What an innings declared it would capture — both folds (SCRBRD-039)");
  // Innings 0 above declared nothing, like every innings scored before a
  // profile could be declared. It must read exactly as it always did.
  const [undeclared] = await dbq(
    `select declared_profile, points, placed, point_evidence, placement_evidence
       from innings_placement_evidence where match_id = $1 and innings = 0`, [MATCH]);
  const localEv0 = placementEvidence(local.ballLog, { declared: local.declaredProfile });
  ok("the undeclared innings is undeclared in both folds",
     local.declaredProfile === null && undeclared?.declared_profile === null);
  ok(`...and grades as it always did — device ${localEv0.label}, database ${undeclared?.point_evidence}, count-only ${evidenceLabel(localEv0.n)}`,
     localEv0.label === evidenceLabel(localEv0.n) && undeclared?.point_evidence === localEv0.label
     && undeclared?.placement_evidence === evidenceLabel(Number(undeclared?.placed)));

  // Innings 1, recorded with NO SIGNAL: declared standard, then a sector and a
  // quick single, then a second declaration — quick — arriving after the
  // balls. Everything sits in the outbox until the signal comes back, then
  // goes to the server in one flush, in order.
  online = false;
  const log1 = [];
  const rec1 = async (raw) => {
    const ev = stamp({ ...raw, innings: 1 });
    log1.push(ev);
    await engine.record(ev);
    return ev;
  };
  const open1 = { innings: 1, battingTeam: "Michaelhouse", bowlingTeam: "Hilton 1st XI", squad, overs: 20 };
  const crease = { striker: P[0], nonStriker: P[1], bowler: P[2] };
  await rec1(inningsStart({ ...open1, captureProfile: CAPTURE_PROFILE.STANDARD }));
  await rec1(batters({ innings: 1, striker: P[0], nonStriker: P[1] }));
  await rec1(bowler({ innings: 1, bowler: P[2] }));
  await rec1(ball({ innings: 1, type: BALL_TYPE.RUN, value: 2, ...crease, seg: 3, zone: "outer",
                    placementSource: "sector", captureProfile: CAPTURE_PROFILE.STANDARD }));
  await rec1(ball({ innings: 1, type: BALL_TYPE.RUN, value: 0, ...crease,
                    ...noPlacement(PLACEMENT_NULL.NOT_REQUIRED, CAPTURE_PROFILE.QUICK) }));
  await rec1(inningsStart({ ...open1, captureProfile: CAPTURE_PROFILE.QUICK }));   // too late
  ok(`offline: the declared innings is queued, not sent (${engine.pendingCount} pending)`,
     engine.pendingCount === log1.length);

  online = true;
  for (let i = 0; i < 40 && engine.pendingCount > 0; i++) {
    await engine.sync();
    await new Promise((r) => setTimeout(r, 100));
  }
  ok("the offline-queued innings reached the server when the signal came back", engine.pendingCount === 0);

  const local1 = deriveInnings(log1);
  const [remote1] = await dbq(
    `select declared_profile, deliveries, points, placed, point_evidence, placement_evidence
       from innings_placement_evidence where match_id = $1 and innings = 1`, [MATCH]);
  const pt1 = placementEvidence(local1.ballLog, { need: PLACEMENT_FIELD.POINT, declared: local1.declaredProfile });
  const pl1 = placementEvidence(local1.ballLog, { need: PLACEMENT_FIELD.SECTOR, declared: local1.declaredProfile });
  const stored = await dbq(
    `select capture_profile from ball_event
      where match_id = $1 and innings = 1 and kind = 'innings_start' order by seq`, [MATCH]);
  ok("the log keeps BOTH declarations, in the capture_profile column — deriving decides, nothing is dropped",
     stored.map((r) => r.capture_profile).join() === "standard,quick");
  ok(`declared agree — device ${local1.declaredProfile}, database ${remote1?.declared_profile}`,
     local1.declaredProfile === remote1?.declared_profile);
  // Independently of both: the promise was made before the balls, the second
  // one after them, so the first stands.
  ok("...and it is standard: the declaration after the balls is refused by both", remote1?.declared_profile === "standard");
  ok(`no exact point in a standard innings is not captured, by design — device ${pt1.label}, database ${remote1?.point_evidence}`,
     pt1.label === "not_captured" && remote1?.point_evidence === pt1.label);
  ok(`one sector of two deliveries is graded, not excused — device ${pl1.label}, database ${remote1?.placement_evidence}`,
     pl1.label === "insufficient" && remote1?.placement_evidence === pl1.label && Number(remote1?.placed) === 1);
  ok("the declaration moved no cricket: the second innings' score is its balls",
     local1.runs === 2 && local1.balls === 2 && Number(remote1?.deliveries) === 2);

  group("The handover fold sees the same match");
  // scoring_verify_takeover reads ball_event_live too now. Asking it with the
  // device's own numbers must be accepted — which it could not be if the two
  // still disagreed about which balls happened.
  const arm = await api(`/api/matches/${MATCH}/session/handover/arm`, {
    method: "POST", token, body: { device: DEVICE } });
  ok("handover can be armed after an over containing corrections",
     arm.status === 200 && arm.body?.ok === true);
} catch (e) {
  ok(`the fold walk threw: ${e.message?.slice(0, 200)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nFOLD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
