/**
 * Proves the fold is total and correct:
 *   A. aggregates the artifact used to maintain by hand are reproduced exactly
 *   B. undo is truncation + re-derive, at any depth
 *   C. the Laws-of-Cricket cases the artifact's counters got wrong
 *   D. replay is deterministic and order-independent given seq
 *   E. the wire round-trip (client event ↔ ball_event row) is lossless
 */
import {
  deriveInnings, deriveMatch, fmtOvers, confirmationState,
  inningsStart, batters, bowler, ball, penalty, retire, inningsEnd,
  BALL_TYPE, KIND, toRow, fromRow, isLegal,
  voidEvent, undoLast, lastUndoableIndex, newEventId,
  placementFromTap, noPlacement, screenAngle, thetaFromScreen,
  zoneFromRadius, closePositionFor, hasPoint, heatMapEligible, batHandOf,
  thetaFromClock, clockFromTheta, fieldingCircle, depthBand, positionName,
  PLACEMENT_SOURCE, PLACEMENT_NULL, CLOSE_RADIUS,
} from "../src/index.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

// ── Fixtures ─────────────────────────────────────────────
const SQ_A = [
  { id: "p1", name: "James Whitfield" }, { id: "p2", name: "T Bekker" },
  { id: "p3", name: "S Naidoo" },        { id: "p4", name: "M Cele" },
  { id: "p5", name: "R Pillay" },
];
const SQ_B = [
  { id: "w1", name: "D Mkhize" }, { id: "w2", name: "K Botha" },
  { id: "w3", name: "L Govender" },
];

const open = () => [
  inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville Boys'", squad: SQ_A, bowlingSquad: SQ_B, overs: 20 }),
  batters({ striker: "p1", nonStriker: "p2" }),
  bowler({ bowler: "w1" }),
];
const runs = (v, o = {}) => ball({ type: BALL_TYPE.RUN, value: v, ...o });

// ── A. Aggregates the artifact maintained by hand ────────
group("A. Derived aggregates");
{
  const inn = deriveInnings([...open(), runs(4), runs(1), runs(0), runs(6), runs(2), runs(1)]);
  ok("runs total",            inn.runs === 14);
  ok("legal balls counted",   inn.balls === 6);
  ok("overs formatted",       fmtOvers(inn.balls) === "1.0");
  // p1 faces balls 1-2 (4, then 1 which rotates); p2 faces 3-6 (0, 6, 2, 1).
  ok("striker figures",       inn.batsmen.find(b => b.id === "p1").runs === 5);
  ok("non-striker figures",   inn.batsmen.find(b => b.id === "p2").runs === 9);
  ok("balls faced split",     inn.batsmen.find(b => b.id === "p1").balls === 2 && inn.batsmen.find(b => b.id === "p2").balls === 4);
  ok("boundaries counted",    inn.batsmen.find(b => b.id === "p1").fours === 1 && inn.batsmen.find(b => b.id === "p2").sixes === 1);
  ok("bowler conceded",       inn.bowlers.find(b => b.id === "w1").runs === 14);
  ok("bowler balls",          inn.bowlers.find(b => b.id === "w1").balls === 6);
  ok("ballLog length",        inn.ballLog.length === 6);
  ok("overLog grouped",       inn.overLog.length === 1 && inn.overLog[0].balls.length === 6);
  ok("bowler cleared at over end", inn.bowler === null);
}
{
  // Extras: a wide, a no-ball with 2 off the bat, 3 byes, 1 leg bye.
  const inn = deriveInnings([
    ...open(),
    ball({ type: BALL_TYPE.WIDE, value: 0 }),
    ball({ type: BALL_TYPE.NO_BALL, value: 2 }),
    ball({ type: BALL_TYPE.BYE, value: 3 }),
    ball({ type: BALL_TYPE.LEG_BYE, value: 1 }),
  ]);
  ok("wide = 1 extra",          inn.extras.wide === 1);
  ok("no-ball penalty only",    inn.extras.noBall === 1);
  ok("byes recorded",           inn.extras.bye === 3);
  ok("leg byes recorded",       inn.extras.legBye === 1);
  ok("total runs 1+3+3+1",      inn.runs === 8);
  ok("only legal balls count",  inn.balls === 2);
  ok("no-ball runs to batter",  inn.batsmen.find(b => b.id === "p1").runs === 2);
  ok("byes NOT to batter",      inn.batsmen.find(b => b.id === "p1").runs === 2);
  ok("byes NOT charged to bowler", inn.bowlers.find(b => b.id === "w1").runs === 4);
}
{
  const inn = deriveInnings([
    ...open(), runs(1), runs(0), runs(0),
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: "K Botha" }),
    batters({ striker: "p3" }),
    runs(2),
  ]);
  ok("wicket counted",        inn.wickets === 1);
  ok("bowler credited",       inn.bowlers.find(b => b.id === "w1").wickets === 1);
  ok("fall of wicket logged", inn.fow.length === 1 && inn.fow[0].runs === 1);
  ok("dismissal reads as a scorecard line", inn.batsmen.find(b => b.id === "p2").dismissal === "c K Botha b D Mkhize");
  ok("out batter marked",     inn.batsmen.find(b => b.id === "p2").status === "out");
  ok("new batter at crease",  inn.striker === "p3");
  ok("partnership closed",    inn.partnerships.length === 1);
}
{
  // Run out is not the bowler's wicket.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run out", fielder: "L Govender" })]);
  ok("run out counts as a wicket",     inn.wickets === 1);
  ok("run out NOT credited to bowler", inn.bowlers.find(b => b.id === "w1").wickets === 0);
}
{
  // Maidens: an over of dots, then an over with a leg bye (still a maiden).
  const dots = Array.from({ length: 6 }, () => runs(0));
  const inn = deriveInnings([
    ...open(), ...dots,
    bowler({ bowler: "w2" }),
    ...Array.from({ length: 5 }, () => runs(0)), ball({ type: BALL_TYPE.LEG_BYE, value: 1 }),
  ]);
  ok("maiden over detected",        inn.bowlers.find(b => b.id === "w1").maidens === 1);
  ok("leg bye does not spoil maiden", inn.bowlers.find(b => b.id === "w2").maidens === 1);
}
{
  // A wide IS charged to the bowler, so an over containing one is never a maiden
  // even though the six legal balls were all dots.
  const withWide = deriveInnings([...open(), ball({ type: BALL_TYPE.WIDE, value: 0 }), ...Array.from({ length: 6 }, () => runs(0))]);
  ok("over has 6 legal balls plus the wide", withWide.overLog[0].balls.length === 7 && withWide.balls === 6);
  ok("wide spoils the maiden",               withWide.bowlers.find(b => b.id === "w1").maidens === 0);
}
{
  const inn = deriveInnings([...open(), penalty({ runs: 5 })]);
  ok("penalty runs added",     inn.runs === 5);
  ok("penalty in extras",      inn.extras.penalty === 5);
  ok("penalty is not a ball",  inn.balls === 0);
}

// ── B. Undo is truncation ────────────────────────────────
group("B. Undo by truncation");
{
  const log = [...open(), runs(4), runs(1), runs(6), runs(2), runs(0), runs(1)];
  const full = deriveInnings(log);
  const back1 = deriveInnings(log.slice(0, -1));
  const back5 = deriveInnings(log.slice(0, -5));
  ok("undo one ball",       back1.runs === full.runs - 1 && back1.balls === 5);
  ok("undo five balls",     back5.runs === 4 && back5.balls === 1);
  ok("undo to the start",   deriveInnings(log.slice(0, 3)).runs === 0);
  // The artifact capped undo at a 10-entry snapshot stack. Deriving makes depth
  // free: correcting ball 2 after ball 14 is just a shorter log.
  const long = [...open(), ...Array.from({ length: 14 }, (_, i) => runs(i % 3))];
  const corrected = [...long.slice(0, 4), runs(6), ...long.slice(5)];
  ok("correct ball 2 after ball 14", deriveInnings(corrected).runs === deriveInnings(long).runs - long[4].value + 6);
  ok("undo depth is unbounded",      deriveInnings(long.slice(0, 4)).balls === 1);
}

// ── C. Laws the artifact's hand-maintained counters got wrong ──
group("C. Divergences from the artifact (documented in docs/SCORING_RULES.md)");
{
  // 1. Odd runs off a no-ball rotate the strike. The artifact returned early
  //    from the no-ball path before its rotation call and never swapped.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 1 })]);
  ok("odd runs off a no-ball rotate strike", inn.striker === "p2" && inn.nonStriker === "p1");
}
{
  // 2. Byes run off a wide rotate the strike, for the same reason.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.WIDE, value: 1 })]);
  ok("odd byes off a wide rotate strike", inn.striker === "p2");
}
{
  // 3. A no-ball with no run off the bat is still a ball faced. The artifact
  //    guarded the increment behind `value > 0`.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0 })]);
  ok("no-ball with 0 runs is a ball faced", inn.batsmen.find(b => b.id === "p1").balls === 1);
}
{
  // 4. Maidens were never tracked at all — the field existed and stayed 0.
  const inn = deriveInnings([...open(), ...Array.from({ length: 6 }, () => runs(0))]);
  ok("maidens are tracked", inn.bowlers.find(b => b.id === "w1").maidens === 1);
}
{
  // 5. The fielder was dropped from the log entirely, so a caught dismissal
  //    could not name who took it after replay.
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, dismissal: "caught", fielder: "K Botha" })]);
  ok("fielder survives replay", /K Botha/.test(inn.batsmen.find(b => b.id === "p1").dismissal));
}
{
  // 6. Free hit: a bowled dismissal off a free hit does not stand; a run out does.
  const fh = [...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0 })];
  const saved = deriveInnings([...fh, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]);
  const runOut = deriveInnings([...fh, ball({ type: BALL_TYPE.WICKET, dismissal: "run out" })]);
  ok("free hit saves a bowled batter",     saved.wickets === 0);
  ok("free hit does not save a run out",   runOut.wickets === 1);
  ok("free hit consumed by legal delivery", deriveInnings([...fh, runs(1)]).freeHit === false);
}

// ── D. Strike, overs and completion ──────────────────────
group("D. Strike rotation and innings end");
{
  const inn = deriveInnings([...open(), runs(1)]);
  ok("odd runs rotate",  inn.striker === "p2" && inn.nonStriker === "p1");
  const even = deriveInnings([...open(), runs(2)]);
  ok("even runs hold",   even.striker === "p1");
  const overEnd = deriveInnings([...open(), ...Array.from({ length: 6 }, () => runs(0))]);
  ok("over end rotates", overEnd.striker === "p2");
  const oddThenOver = deriveInnings([...open(), ...Array.from({ length: 5 }, () => runs(0)), runs(1)]);
  ok("odd run on last ball of over cancels out", oddThenOver.striker === "p1");
}
{
  const allOut = deriveInnings([
    ...open(),
    ...Array.from({ length: 4 }, () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })),
  ]);
  ok("all out with a 5-man squad", allOut.complete === true && allOut.wickets === 4);
}
{
  const short = deriveInnings([
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 1 }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ...Array.from({ length: 6 }, () => runs(1)),
  ]);
  ok("innings ends when overs are done", short.complete === true);
  ok("explicit end reason recorded",
     deriveInnings([...open(), inningsEnd({ reason: "declared" })]).endReason === "declared");
}
{
  const r = deriveInnings([...open(), runs(1), retire({ batter: "p1", reason: "hurt" })]);
  ok("retired batter marked",   r.batsmen.find(b => b.id === "p1").status === "retired");
  ok("retirement is not a wicket", r.wickets === 0);
}

// ── E. Determinism, match level, and the wire ────────────
group("E. Determinism, match derivation, wire round-trip");
{
  const log = [...open(), runs(4), runs(1), runs(2)];
  ok("replay is pure",  JSON.stringify(deriveInnings(log)) === JSON.stringify(deriveInnings(log)));
  ok("replay does not mutate the log", log.length === 6 && log[3].value === 4);
}
{
  const m = deriveMatch([
    ...open().map(e => ({ ...e, innings: 0 })),
    ...[runs(10)].map(e => ({ ...e, innings: 0 })),
    inningsEnd({ innings: 0, reason: "overs_complete" }),
    { ...inningsStart({ battingTeam: "Westville Boys'", bowlingTeam: "Hilton College", squad: SQ_B, bowlingSquad: SQ_A, overs: 20, target: 11 }), innings: 1 },
    { ...batters({ striker: "w1", nonStriker: "w2" }), innings: 1 },
    { ...bowler({ bowler: "p1" }), innings: 1 },
    { ...runs(6), innings: 1 }, { ...runs(6), innings: 1 },
  ]);
  ok("two innings derived",   m.innings.length === 2);
  ok("chase completes",       m.innings[1].complete === true);
  ok("result names a winner", m.result?.winner === "Westville Boys'");
}
{
  const ev = ball({ type: BALL_TYPE.WICKET, value: 0, shot: "drive", seg: 4, zone: 2, dismissal: "caught", fielder: "K Botha", bowlerApproach: "over" });
  const back = fromRow({ ...toRow(ev), seq: 12 });
  ok("wire round-trip keeps shot",     back.shot === "drive");
  ok("wire round-trip keeps segment",  back.seg === 4);
  ok("wire round-trip keeps fielder",  back.fielder === "K Botha");
  ok("wire round-trip keeps approach", back.bowlerApproach === "over");
  ok("seq survives",                   back.seq === 12);
  ok("derives identically after a round-trip",
     deriveInnings([...open(), ev]).wickets === deriveInnings([...open(), fromRow(toRow(ev))]).wickets);
}
{
  const inn = deriveInnings([...open(), runs(4), runs(1)]);
  const c = confirmationState(inn);
  ok("confirmation state matches the handover handshake fields",
     c.runs === 5 && c.wickets === 0 && c.balls === 2 && c.bowler === "w1");
  ok("isLegal agrees with the schema", isLegal("Wd") === false && isLegal("run") === true);
  ok("KIND is exported for the queue", KIND.BALL === "ball");
}

// ── E2. Player references the database cannot store ──────
group("E. A bowler with no player row");
{
  const UUID = "aaaaaaaa-0000-0000-0000-000000000001";
  // SCRBRD holds rows for its OWN schools' players. A fixture against a school
  // that is not a tenant has no away roster, so the scorer types the bowler's
  // name — and ball_event.bowler_id is a uuid foreign key. Sending a name to
  // that column is a 22P02 that rejects the delivery: every ball of every over
  // bowled by an opposition bowler, which is nearly all of them.
  const typed = toRow(bowler({ bowler: "A Nel" }));
  ok("a typed name does not go in the uuid column", typed.bowler_id === null);
  ok("...it rides in the payload instead", typed.payload.bowler === "A Nel");
  ok("...and comes back intact", fromRow({ ...typed, seq: 1 }).bowler === "A Nel");

  // A real player still joins, so a scorecard can be attributed.
  const mixed = toRow(batters({ striker: UUID, nonStriker: "Unlisted Kid" }));
  ok("a real player id goes in the column", mixed.striker_id === UUID);
  ok("...and is not duplicated into the payload", !("striker" in mixed.payload));
  ok("an unlisted batter still rides in the payload", mixed.payload.nonStriker === "Unlisted Kid");
  const back = fromRow({ ...mixed, seq: 2 });
  ok("both come back the way they went in",
     back.striker === UUID && back.nonStriker === "Unlisted Kid");

  // Replay only ever compares ids for equality, so it does not care which is which.
  const mixedLog = [
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: [{ id: UUID, name: "J Whitfield" }], overs: 20 }),
    batters({ striker: UUID, nonStriker: "Unlisted Kid" }),
    bowler({ bowler: "A Nel" }),
    ball({ type: BALL_TYPE.RUN, value: 4 }),
  ];
  const inn = deriveInnings(mixedLog);
  ok("replay handles a mixed log", inn.runs === 4 && inn.balls === 1);
  ok("...naming the player it knows", inn.batsmen.find(b => b.id === UUID)?.name === "J Whitfield");
  ok("...and the one it does not", inn.bowlers.find(b => b.id === "A Nel")?.name === "A Nel");
}

// ── F. The undo/sync boundary ────────────────────────────
// Undo has two correct implementations and picking the wrong one is how a
// scorecard ends up quietly wrong with no evidence of why. See src/undo.mjs.
group("F. Undo before and after the server has it");
{
  const id = (n) => `dev:m1:${n}`;
  const withIds = (evs) => evs.map((e, i) => ({ ...e, id: id(i) }));
  const log = withIds([...open(), runs(4), runs(1), runs(6)]);
  const before = deriveInnings(log);
  ok("baseline", before.runs === 11 && before.balls === 3);

  // Nothing has left the device: dropping the last event is exact.
  const local = undoLast(log, { isSynced: () => false });
  ok("an unsynced ball is truncated", local.action === "truncate" && local.events.length === log.length - 1);
  ok("...and the log carries no trace of it",
     !local.events.some(e => e.kind === KIND.VOID));
  ok("...and re-derives exactly", deriveInnings(local.events).runs === 5);

  // The server has it: the correction has to be appendable evidence.
  const remote = undoLast(log, { isSynced: () => true });
  ok("a synced ball is voided, not dropped", remote.action === "void");
  ok("...the log grows rather than shrinks", remote.events.length === log.length + 1);
  ok("...the void names the ball it undoes",
     remote.events.at(-1).kind === KIND.VOID && remote.events.at(-1).target === log.at(-1).id);
  ok("...and replay agrees with the truncated version",
     deriveInnings(remote.events).runs === deriveInnings(local.events).runs);
  ok("...down to the ball count and the striker",
     deriveInnings(remote.events).balls === deriveInnings(local.events).balls &&
     deriveInnings(remote.events).striker === deriveInnings(local.events).striker);
  ok("...and the void is visible as a correction", deriveInnings(remote.events).voided === 1);

  // The safe default. undoLast() with no isSynced treats the event as synced,
  // because a void is always correct and truncation is the optimisation.
  ok("the default is the safe one", undoLast(log).action === "void");

  // Repeated undo walks back through the innings rather than undoing its own
  // corrections — a void must not become the next undo's target.
  let walk = log;
  for (let i = 0; i < 3; i++) walk = undoLast(walk, { isSynced: () => true }).events;
  const walked = deriveInnings(walk);
  ok("three undos remove three balls", walked.runs === 0 && walked.balls === 0);
  ok("...leaving three voids in the log",
     walk.filter(e => e.kind === KIND.VOID).length === 3 && walked.voided === 3);

  // A voided wicket must not leave the batter out. This is the case that
  // decrementing a counter cannot fix: the next batter is already at the crease.
  const wLog = withIds([...open(), runs(1), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })]);
  ok("wicket taken", deriveInnings(wLog).wickets === 1);
  const undoneW = undoLast(wLog, { isSynced: () => true }).events;
  ok("voiding a wicket un-takes it", deriveInnings(undoneW).wickets === 0);
  ok("...and the batter is not out",
     deriveInnings(undoneW).batsmen.find(b => b.id === "p2")?.status !== "out");

  // Choosing the openers and the opening bowler ARE undoable — a scorer who
  // taps the wrong name needs to fix it, and the screen simply asks again.
  // What is not undoable is innings_start: without it there are no squads and
  // nothing left to score against.
  let strip = withIds(open());
  ok("the opening bowler can be undone", undoLast(strip, { isSynced: () => false }).action === "truncate");
  strip = undoLast(strip, { isSynced: () => false }).events;
  strip = undoLast(strip, { isSynced: () => false }).events;
  ok("...and so can the openers", strip.length === 1 && strip[0].kind === KIND.INNINGS_START);
  ok("undo stops at the innings opening", undoLast(strip).action === "none");
  ok("...and leaves the log untouched", undoLast(strip).events.length === 1);
  ok("lastUndoableIndex agrees", lastUndoableIndex(strip) === -1);

  // An event with no id cannot be named by a void, so it cannot be undone once
  // it has synced. Reported, never silently skipped.
  const anon = [...open(), runs(4)];
  ok("an event with no id cannot be voided", undoLast(anon).action === "none");

  // A void survives the wire, because a correction that only exists on one
  // device is the problem it was invented to solve.
  // id(3) is the first delivery, worth four.
  const v = voidEvent({ target: id(3) });
  ok("a void round-trips through the wire", fromRow(toRow(v)).target === id(3));
  ok("...and still voids the right ball after the round trip",
     deriveInnings([...log, fromRow(toRow(v))]).runs === 7);

  ok("event ids are unique per device", newEventId("dev", "m1") !== newEventId("dev", "m1"));
}

// ── G. Shot placement ────────────────────────────────────
group("G. Where the ball went");
{
  // The frame is the clock coaches already speak in: theta is degrees
  // CLOCKWISE FROM BEHIND THE BATTER, so 180 is straight down the ground and
  // positive is the leg side for a right-hander. It is also exactly the angle
  // the wheel draws at, which is why a right-hander needs no conversion at all.
  ok("theta is clock_hour x 30", thetaFromClock(6) === 180 && thetaFromClock(3) === 90);
  ok("...and reads back", clockFromTheta(180) === 6 && clockFromTheta(0) === 12);
  ok("straight down the ground is 180", screenAngle(180, "R") === 180);
  ok("a right-hander needs no conversion", thetaFromScreen(214, "R") === 214);

  // The defect this replaces: a left-hander's placement was stored against
  // fixed segment angles and was silently wrong for every ball they faced.
  const rh = placementFromTap({ angle: 270, radius: 0.7, batHand: "R" });
  const lh = placementFromTap({ angle: 270, radius: 0.7, batHand: "L" });
  ok("the same spot is off side for a right-hander", rh.theta === 270);
  ok("...and leg side for a left-hander", lh.theta === 90);
  ok("...yet both draw in the same place", rh.seg === lh.seg);
  ok("mirroring round-trips", screenAngle(thetaFromScreen(123, "L"), "L") === 123);

  // seg and zone are DERIVED, so the sector-era read path keeps working
  // unchanged and point capture ships without rewriting it.
  const p = placementFromTap({ angle: 300, radius: 0.93, batHand: "R" });
  ok("a point derives its sector", p.seg === 10);
  ok("...and its zone", p.zone === "boundary");
  ok("zone bands come from the ring radii, not round numbers",
     zoneFromRadius(0.44) === "inner" && zoneFromRadius(0.5) === "outer" && zoneFromRadius(0.85) === "boundary");

  // Quantise on write: float noise implies precision nobody has. The scorer is
  // estimating from a boundary, not measuring.
  const q = placementFromTap({ angle: 137.4821, radius: 0.61847, batHand: "R" });
  ok("theta is whole degrees", Number.isInteger(q.theta));
  ok("radius is two decimals", q.radius === 0.62);
  ok("radius clamps at the rope",
     placementFromTap({ angle: 180, radius: 1.8, batHand: "R" }).radius === 1);

  // The fielding circle is VENUE-DERIVED. Because radius normalises to the
  // rope, the 30-yard circle sits at a different normalised radius at every
  // ground — and it carries fielding-restriction meaning, so a hardcoded band
  // would be wrong somewhere every time.
  ok("the circle is ~0.50 at a 55m boundary", Math.abs(fieldingCircle(55) - 0.50) < 0.01);
  ok("...and ~0.40 at 68m", Math.abs(fieldingCircle(68) - 0.40) < 0.01);
  ok("so the same ball is in the ring at one ground and deep at another",
     depthBand(0.45, { boundaryM: 55 }) === "ring" && depthBand(0.45, { boundaryM: 68 }) === "deep");

  // Position names are DERIVED, never stored, so the table can be corrected or
  // localised later without touching a single ball.
  ok("a cover drive to the rope is deep cover", positionName(235, 0.75) === "deep cover");
  ok("...and inside the circle is just cover", positionName(235, 0.35) === "cover");
  // The table is not regular, and the irregularities are the point.
  ok("straight breaks the pattern: long on, not deep mid on", positionName(178, 0.9) === "long on");
  ok("...and long off on the other side of it", positionName(190, 0.9) === "long off");
  // 0.50 would be DEEP at the default ground — the circle is 0.44 there — so
  // this asserts the family at a radius that is genuinely inside the ring.
  ok("behind square on the off side is backward point",
     positionName(295, 0.35) === "backward point");
  ok("...and deep backward point outside the circle",
     positionName(295, 0.5) === "deep backward point");
  ok("off side behind square is `third`, not third man",
     positionName(325, 0.8) === "deep third");

  // The catching ring, where the outfield taxonomy means nothing.
  ok("a ball at the batter's feet has somewhere to sit",
     placementFromTap({ angle: 0, radius: 0.02, batHand: "R" }).closePosition === "at_feet");
  ok("slips are ordinal, derived from theta within the cordon",
     closePositionFor(340, 0.06) === "slip_2" && closePositionFor(350, 0.06) === "slip_1");
  ok("the leg-side cordon is named too", closePositionFor(15, 0.06) === "leg_slip");
  ok("nothing outside the ring gets a close position",
     closePositionFor(230, CLOSE_RADIUS + 0.01) === null);

  // Why there is no placement is recorded, because "no stroke was offered" and
  // "the scorer skipped it" are different facts.
  const missed = noPlacement(PLACEMENT_NULL.NO_CONTACT);
  ok("a ball with no contact carries a reason", missed.placementNull === "no_contact");
  ok("...and no source", missed.placementSource === null);
  ok("...and no sector either", missed.seg === null && missed.zone === null);

  // THE HARD RULE: a point is never synthesised from a sector.
  const sectorEra = ball({ type: BALL_TYPE.RUN, value: 4, seg: 9, zone: "outer" });
  ok("a sector-era ball has no point", sectorEra.theta === null && sectorEra.radius === null);
  ok("...and is not mistaken for one", hasPoint(sectorEra) === false);
  ok("...but keeps its sector", sectorEra.seg === 9);

  const pointEra = ball({ type: BALL_TYPE.RUN, value: 4, ...p });
  ok("a point-era ball is recognised", hasPoint(pointEra) === true);
  const mixed = heatMapEligible([sectorEra, pointEra, pointEra, sectorEra, sectorEra]);
  ok("a heat map can state what it excluded rather than dropping it quietly",
     mixed.eligible.length === 2 && mixed.excludedCount === 3);

  // The wire carries the point in its own columns, so the query layer can
  // filter on placement_source and be indexed rather than trusting report code.
  const row = toRow(pointEra);
  ok("theta and radius get columns of their own",
     row.theta === p.theta && row.radius === p.radius);
  ok("as does the source the heat map filters on",
     row.placement_source === PLACEMENT_SOURCE.POINT);
  ok("none of it is duplicated into the payload",
     !("theta" in row.payload) && !("placementSource" in row.payload));
  const back = fromRow({ ...row, seq: 3 });
  ok("the point survives the round trip",
     back.theta === p.theta && back.radius === p.radius && hasPoint(back));

  // Handedness comes off the squad. Missing handedness produces a right-handed
  // placement, which is a roster problem rather than something to guess at.
  const inn = { striker: "p1", squad: [{ id: "p1", name: "A", batHand: "L" }, { id: "p2", name: "B" }] };
  ok("a left-hander is read from the squad", batHandOf(inn) === "L");
  ok("...and an unmarked player defaults to right", batHandOf(inn, "p2") === "R");
}

console.log(`\n${"─".repeat(52)}\nSCORING SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
