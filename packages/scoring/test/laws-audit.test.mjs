/**
 * The Laws audit of 28 Oct 2026 (audit/AUDIT_scoring_laws_2026-10-28.md),
 * each finding's own ball-by-ball scenario, as Kameel decided it (§6).
 *
 * Every case here failed against main before its fix (16ebe23), and the name
 * says which finding it is. The pad's half of F1 (asking the end on every run
 * out) is apps/web/test/run-out-end.test.mjs; SQL's half of F4, F5, F7 and the
 * front-foot free hit is db/121's proof and tools/smoke-fold-figures.mjs.
 */
import {
  deriveInnings, deriveMatch, describeResult, lawsRefusal, MatchFold,
  inningsStart, inningsEnd, batters, bowler, ball, voidEvent, newEventId,
  BALL_TYPE, REFUSAL, runsOffBat, runsToBowler, boundaryHit, givesFreeHit,
} from "../src/index.mjs";
import { deriveCommentary } from "../src/commentary.mjs";

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SQ_A = [{ id: "p1", name: "A Adams" }, { id: "p2", name: "B Botha" }, { id: "p3", name: "C Cele" }, { id: "p4", name: "D Dube" }];
const SQ_B = [{ id: "w1", name: "W Wood" }, { id: "w2", name: "X Xulu" }];
const open = (overs = 20) => [
  inningsStart({ battingTeam: "Hilton", bowlingTeam: "Kearsney", squad: SQ_A, bowlingSquad: SQ_B, overs }),
  batters({ striker: "p1", nonStriker: "p2" }),
  bowler({ bowler: "w1" }),
];
const dot = () => ball({ type: BALL_TYPE.RUN, value: 0 });
const runs = (/** @type {number} */ v, /** @type {object} */ more = {}) => ball({ type: BALL_TYPE.RUN, value: v, ...more });
/** @param {any} inn @param {string} id */
const bat = (inn, id) => inn.batsmen.find((/** @type {any} */ b) => b.id === id);
/** @param {any} inn @param {string} id */
const bowl = (inn, id) => inn.bowlers.find((/** @type {any} */ b) => b.id === id);

// ── F1 · a run out with no run completed: the end, asked, settles who faces ──
group("F1 · run out with no run completed, the batters crossed (Law 38.4, 18.12.1.2)");
{
  // Over 7, ball 3 in the audit; any ball will do. A on strike, B at the
  // bowler's end; A runs, B runs, A is run out at the BOWLER's end. With the
  // end recorded the empty end is the bowler's: B, who reached the striker's
  // end, faces next, and the incoming batter takes the bowler's end.
  const a = deriveInnings([...open(), dot(), dot(),
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", dismissed: "p1", outAt: "bowler_end" })]);
  ok("F1 striker run out at the bowler's end, 0 run: B is at the striker's end", a.striker === "p2" && a.nonStriker === null);
  const a2 = deriveInnings([...open(), dot(), dot(),
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", dismissed: "p1", outAt: "bowler_end" }),
    batters({ nonStriker: "p3" }), dot()]);
  ok("F1 ...and B faces the next ball, the new batter at the bowler's end",
     a2.ballLog[a2.ballLog.length - 1].strikerId === "p2" && a2.nonStriker === "p3");
  // The mirror: B run out at the keeper's end on the same single; A reached
  // the bowler's end, the incoming batter faces.
  const b = deriveInnings([...open(),
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", dismissed: "p2", outAt: "striker_end" })]);
  ok("F1 non-striker run out at the striker's end, 0 run: A at the bowler's end", b.striker === null && b.nonStriker === "p1");
  // The pre-ball default stays for a log that never said (an old pad).
  const c = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", dismissed: "p2" })]);
  ok("F1 no end recorded (an old log): the dismissed batter's own end empties, as before", c.striker === "p1" && c.nonStriker === null);
  ok("F1 the Laws take an end on a run out with no run", lawsRefusal(deriveMatch([...open(), dot()].map((e) => ({ ...e, innings: 0 }))),
     { ...ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", dismissed: "p1", outAt: "bowler_end" }), innings: 0 }) === null);
}

// ── F2 · a two-innings match is scored live through its third and fourth innings ──
group("F2 · Two-Day: the third innings is not 'match decided' (Law 13, 16)");
{
  const TWO = { conditions: { "format.innings_per_side": 2 } };
  /** One innings: `bat` batting, `steps` balls, sealed `how`. */
  const inns = (/** @type {number} */ i, /** @type {string} */ batT, /** @type {string} */ bowlT, /** @type {any[]} */ steps, /** @type {string | null} */ how, /** @type {object} */ more = {}) => {
    const sqBat = batT === "Hilton" ? SQ_A : SQ_B.concat([{ id: "w3", name: "Y" }, { id: "w4", name: "Z" }]);
    const sqBowl = batT === "Hilton" ? SQ_B.concat([{ id: "w3", name: "Y" }, { id: "w4", name: "Z" }]) : SQ_A;
    const evs = [inningsStart({ battingTeam: batT, bowlingTeam: bowlT, squad: sqBat, bowlingSquad: sqBowl, overs: 80, ...more }),
      batters({ striker: sqBat[0].id, nonStriker: sqBat[1].id }), bowler({ bowler: sqBowl[0].id }), ...steps];
    const withI = evs.map((e) => ({ ...e, innings: i }));
    if (!how) return withI;
    const inn = deriveInnings(withI, TWO);
    return [...withI, { ...inningsEnd({ reason: how, confirmed: { runs: inn.runs, wickets: inn.wickets, balls: inn.balls } }), innings: i }];
  };
  // Home bat and declare at 6/0; away all out for 4 (three wickets in a squad of four).
  const W = () => ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" });
  const i0 = inns(0, "Hilton", "Kearsney", [runs(6)], "declared");
  const i1 = inns(1, "Kearsney", "Hilton", [runs(4), W(), batters({ striker: "w3" }), W(), batters({ striker: "w4" }), W()], "all_out");
  const third = inns(2, "Hilton", "Kearsney", [], null);
  const m = new MatchFold([...i0, ...i1, ...third], TWO).view();
  ok("F2 the third innings' first ball is taken (it was match_decided)", lawsRefusal(m, { ...runs(1), innings: 2 }) === null);
  ok("F2 ...and a one-innings match's second innings still decides it",
     lawsRefusal(new MatchFold([...i0, ...i1, ...third], {}).view(), { ...runs(1), innings: 2 }) !== null);
  // Home all out in the third for 1 (lead 3); away chase 4 in the fourth.
  const i2 = inns(2, "Hilton", "Kearsney", [runs(1), W(), batters({ striker: "p3" }), W(), batters({ striker: "p4" }), W()], "all_out");
  const fourth = inns(3, "Kearsney", "Hilton", [runs(2)], null, { target: 4 });
  const m4 = new MatchFold([...i0, ...i1, ...i2, ...fourth], TWO).view();
  ok("F2 the fourth innings is live", lawsRefusal(m4, { ...runs(1), innings: 3 }) === null);
  const won = new MatchFold([...i0, ...i1, ...i2, ...fourth, { ...runs(2), innings: 3 }], TWO).view();
  ok("F2 the fourth innings reaching its target decides it", lawsRefusal(won, { ...runs(1), innings: 3 }) === REFUSAL.MATCH_DECIDED);
  const res = describeResult(deriveMatch([...i0, ...i1, ...i2, ...fourth, { ...runs(2), innings: 3 }], TWO).innings, { conditions: TWO.conditions });
  ok("F2 ...won by the side batting last", res?.winner === "Kearsney" && res?.marginKind === "wickets");
  // An innings win: home 6 and 3 v away 2 all out twice? Away follow on —
  // here: home declare 6, away all out 4, away (following on) all out 1:
  // home win by an innings and 1 and there is no fourth innings.
  const fo = inns(2, "Kearsney", "Hilton", [runs(1), W(), batters({ striker: "w3" }), W(), batters({ striker: "w4" }), W()], "all_out");
  const mi = new MatchFold([...i0, ...i1, ...fo], TWO).view();
  ok("F2 an innings win (followed on, still behind) decides it: no fourth innings",
     lawsRefusal(mi, { ...inningsStart({ battingTeam: "Hilton", bowlingTeam: "Kearsney", squad: SQ_A, overs: 80 }), innings: 3 }) === null
     && lawsRefusal(new MatchFold([...i0, ...i1, ...fo, ...inns(3, "Hilton", "Kearsney", [], null)], TWO).view(), { ...runs(1), innings: 3 }) === REFUSAL.MATCH_DECIDED);
}

// ── F3 · a change of ends keeps the partnership ──
group("F3 · a swap of ends is the same partnership");
{
  // Openers A and B put on 6 (a four and a two); the scorer swaps ends; a
  // single; B bowled at 7/1. The first-wicket stand is 7 off 4.
  const inn = deriveInnings([...open(), runs(4), runs(2), batters({ striker: "p2", nonStriker: "p1" }), runs(1),
    ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]);
  const p = inn.partnerships[0];
  ok("F3 the first-wicket partnership is 7 off 4 (it was 1 off 2)", p?.runs === 7 && p?.balls === 4 && p?.wicket === 1);
  const live = deriveInnings([...open(), runs(4), runs(2), batters({ striker: "p2", nonStriker: "p1" })]);
  ok("F3 ...and the stand in progress after the swap still reads 6", live.curPartner.runs === 6 && live.curPartner.balls === 2);
  ok("F3 ...with the pair as they now stand", live.curPartner.bat1 === "p2" && live.curPartner.bat2 === "p1");
  const after = deriveInnings([...open(), runs(4), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }), batters({ striker: "p3" }), runs(1)]);
  ok("F3 a new batter is still a new partnership", after.curPartner.runs === 1 && after.partnerships[0].runs === 4);
}

// ── F4 · correcting an older ball: the fold re-derives who faced ──
group("F4 · an amendment's void: who faced the later balls is the fold's");
{
  // Ball 1: A takes a single (stamped A). Ball 2: B hits four (stamped B).
  // The amendment voids ball 1 (a dead ball). The fold has A facing ball 2.
  const b1 = { ...runs(1, { striker: "p1", nonStriker: "p2" }), id: newEventId("dev", "m1") };
  const b2 = { ...runs(4, { striker: "p2", nonStriker: "p1" }), id: newEventId("dev", "m1") };
  const inn = deriveInnings([...open(), b1, b2, voidEvent({ target: b1.id })]);
  ok("F4 after the void, ball 2 was A's: the fold re-judges it", inn.ballLog[0].strikerId === "p1" && bat(inn, "p1").runs === 4);
  ok("F4 ...and the stamp on the event, which SQL read, says B", inn.ballLog[0].striker === "p2");
  // db/121 is how SQL agrees: services/api/write/restamp.mjs re-stamps from
  // this same fold (restamp.test.mjs).
}

// ── F5 · a run out going for a second bye: the bye is a bye ──
group("F5 · run out after a completed bye or leg bye (Law 18.10, 23, 38.5)");
{
  const ro = (/** @type {string} */ nbRuns) => ball({ type: BALL_TYPE.WICKET, value: 1, nbRuns, dismissal: "run_out", dismissed: "p2", outAt: "striker_end" });
  const inn = deriveInnings([...open(), ro("byes")]);
  ok("F5 one bye: the side has 1, one bye", inn.runs === 1 && inn.extras.bye === 1 && inn.extras.legBye === 0);
  ok("F5 ...the striker faced it and scored none of it", bat(inn, "p1").runs === 0 && bat(inn, "p1").balls === 1);
  ok("F5 ...the bowler is charged nothing, a ball bowled, no wicket", bowl(inn, "w1").runs === 0 && bowl(inn, "w1").balls === 1 && bowl(inn, "w1").wickets === 0);
  ok("F5 ...and the wicket stands", inn.wickets === 1 && bat(inn, "p2").status === "out");
  const lb = deriveInnings([...open(), ro("leg_byes")]);
  ok("F5 going for a second leg bye: one leg bye, not the striker's, not the bowler's",
     lb.extras.legBye === 1 && lb.extras.bye === 0 && bat(lb, "p1").runs === 0 && bowl(lb, "w1").runs === 0);
  ok("F5 runsOffBat / runsToBowler say the same", runsOffBat({ type: "W", value: 1, nbRuns: "byes" }) === 0
     && runsToBowler({ type: "W", value: 1, nbRuns: "leg_byes" }) === 0 && runsToBowler({ type: "W", value: 1 }) === 1);
  ok("F5 a run out off the bat is as it was", bat(deriveInnings([...open(), ball({ type: "W", value: 1, dismissal: "run_out", dismissed: "p2", outAt: "striker_end" })]), "p1").runs === 1);
  ok("F5 the Laws take nbRuns on a wicket ball", lawsRefusal(deriveMatch([...open()].map((e) => ({ ...e, innings: 0 }))), { ...ro("byes"), innings: 0 }) === null);
  let threw = 0;
  try { ball({ type: BALL_TYPE.RUN, value: 1, nbRuns: "byes" }); } catch { threw++; }
  ok("F5 ...and still refuse it on a run", threw === 1);
}

// ── F7 · fours and sixes are boundaries ──
group("F7 · boundaries only: an all-run four, overthrows (Kameel Q4)");
{
  const inn = deriveInnings([...open(), runs(4), runs(4, { boundary: false }), runs(6, { boundary: false }), runs(6)]);
  // Strike: 4 (A), 4 all run (A, even), 6 (A), 6 (A).
  ok("F7 an all-run four is four runs and no four", bat(inn, "p1").runs === 20 && bat(inn, "p1").fours === 1);
  ok("F7 two and four overthrows is six runs and no six", bat(inn, "p1").sixes === 1);
  const nb = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 4, boundary: false, nbType: "front_foot" })]);
  ok("F7 a no-ball run for four off the bat: four runs, no four", bat(nb, "p1").runs === 4 && bat(nb, "p1").fours === 0);
  ok("F7 a delivery keyed 4 (no field) is a four, as every ball already scored", boundaryHit({ type: "run", value: 4 }) === 4 && boundaryHit({ type: "Nb", value: 6 }) === 6);
  ok("F7 ...a bye is never one", boundaryHit({ type: "B", value: 4 }) === null && boundaryHit({ type: "Nb", value: 4, nbRuns: "byes" }) === null);
  let threw = 0;
  try { ball({ type: BALL_TYPE.BYE, value: 4, boundary: false }); } catch { threw++; }
  try { ball({ type: BALL_TYPE.RUN, value: 4, boundary: true }); } catch { threw++; }
  ok("F7 boundary is only false, and only on a run or a no-ball", threw === 2);
  const c = deriveCommentary([...open(), runs(4, { boundary: false })].map((e) => ({ ...e, innings: 0 })));
  ok("F7 the commentary does not call it a four", c.length > 0 && c.every((x) => x.kind !== "four"));
}

// ── F9 · bowled off a free hit with byes run ──
group("F9 · a bowled free hit the batters ran a bye off");
{
  const inn = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0, nbType: "front_foot" }),
    ball({ type: BALL_TYPE.WICKET, value: 1, nbRuns: "byes", dismissal: "bowled" })]);
  ok("F9 not out (the free hit), one bye, nothing to the striker", inn.wickets === 0 && inn.extras.bye === 1 && bat(inn, "p1").runs === 0);
  ok("F9 ...the bowler is charged the no-ball only", bowl(inn, "w1").runs === 1);
  ok("F9 ...and the strike changed: they ran one", inn.striker === "p2");
}

// ── Q2 · the free hit after a front-foot no-ball only; F11 ──
group("Q2 · free hit after a front-foot no-ball only; F11 a ball not in the over keeps it");
{
  const after = (/** @type {object} */ nb) => deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0, ...nb })]).freeHit;
  ok("Q2 a front-foot no-ball earns a free hit", after({ nbType: "front_foot" }) === true);
  ok("Q2 a waist-high full toss does not (it did)", after({ nbType: "height" }) === false);
  ok("Q2 a beamer does not (it did)", after({ nbType: "beamer" }) === false);
  ok("Q2 a no-ball of no recorded kind earns one, as every old log did", after({}) === true);
  ok("Q2 givesFreeHit says the same", givesFreeHit({ type: "Nb", nbType: "front_foot" }) && !givesFreeHit({ type: "Nb", nbType: "height" }) && !givesFreeHit({ type: "run" }));
  const caught = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0, nbType: "height" }), ball({ type: BALL_TYPE.WICKET, dismissal: "caught" })]);
  ok("Q2 so a catch off the ball after a waist-high no-ball stands", caught.wickets === 1);
  const carried = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0, nbType: "front_foot" }), ball({ type: BALL_TYPE.NO_BALL, value: 0, nbType: "beamer" })]);
  ok("Q2 a beamer ON a free hit leaves the free hit for the next ball", carried.freeHit === true);
  const f11 = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0, nbType: "front_foot" }), ball({ type: BALL_TYPE.RUN, value: 0, notInOver: "illegal_fielding" })]);
  ok("F11 a fair delivery that does not count keeps the free hit for the next (it spent it)", f11.freeHit === true && f11.balls === 0);
  const spent = deriveInnings([...open(), ball({ type: BALL_TYPE.NO_BALL, value: 0, nbType: "front_foot" }),
    ball({ type: BALL_TYPE.RUN, value: 0, notInOver: "illegal_fielding" }), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]);
  ok("F11 ...so the next delivery is the free hit: bowled, not out", spent.wickets === 0 && spent.ballLog[2].freeHitSaved === true);
}

// ── F10 · a chase ahead of par is won by runs ──
group("F10 · a curtailed chase ahead of par: won by the runs ahead (Kameel Q3)");
{
  const DLS = { "target.method": "dls_standard" };
  const a = { ...deriveInnings([...open(), runs(6), runs(6), runs(6)]), complete: true };
  const chase = { ...deriveInnings([inningsStart({ battingTeam: "Kearsney", bowlingTeam: "Hilton", squad: SQ_B.concat([{ id: "w3", name: "Y" }]), overs: 20 }),
    batters({ striker: "w1", nonStriker: "w2" }), bowler({ bowler: "p1" }), runs(6), runs(6), runs(3)]), complete: true, endReason: "abandoned", par: 12 };
  const r = describeResult([a, chase], { conditions: DLS });
  ok("F10 15 against a par of 12: won by 3 runs (it was by 2 wickets)", r?.winner === "Kearsney" && r?.marginKind === "runs" && r?.marginValue === 3);
  ok("F10 ...in words", typeof r?.text === "string" && /won by 3 runs \(DLS\)/.test(r.text));
}

// ── F13 · the fall of a wicket on an over's last ball is 4.6 ──
group("F13 · fall of wickets: the sixth ball of the fifth over is 4.6 (Kameel Q8)");
{
  const inn = deriveInnings([...open(), ...Array.from({ length: 29 }, dot), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]);
  ok("F13 a wicket on ball 30 falls at 4.6 (it was 5.0)", inn.fow[0].overs === "4.6");
  const mid = deriveInnings([...open(), ...Array.from({ length: 27 }, dot), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]);
  ok("F13 ...ball 28 at 4.4, as before", mid.fow[0].overs === "4.4");
  const first = deriveInnings([...open(), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })]);
  ok("F13 ...the first ball at 0.1", first.fow[0].overs === "0.1");
  const wide = deriveInnings([...open(), ...Array.from({ length: 30 }, dot), bowler({ bowler: "w2" }),
    ball({ type: BALL_TYPE.WIDE, value: 0, dismissal: "stumped" })]);
  ok("F13 ...a stumping off a wide at the start of the sixth over at 5.0", wide.fow[0].overs === "5.0");
}

console.log(`\nlaws-audit: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
