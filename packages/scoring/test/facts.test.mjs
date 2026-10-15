/**
 * Recognition facts (Recognition R1): deriveFacts() reads the fold, and says
 * what SQL's player_milestone says of the same balls.
 *
 *   A. fifty and hundred: 98 → 104 is one hundred, with both crossings; the
 *      runs are the fold's (a no-ball hit is his, its byes and a wide are not)
 *   B. five-for: only the bowler's ways out; a run out is no bowler fact; a
 *      stumping off a wide is his (db/87); a run out off a no-ball is not
 *   C. a non-striker run out dismisses him, and is nobody's wicket
 *   D. the hat-trick under Q8: three of his balls of the over in a row; a
 *      wide or a no-ball, a wicket on one included, neither makes nor breaks
 *      it; a run out, or a wicket a free hit saved, breaks it; across overs;
 *      four in four and two in one innings are one milestone
 *   E. a free-hit-saved wicket is nothing
 *   F. retirements: retired hurt and back, his runs go on; retired out is out
 *      and nobody's wicket
 *   G. a super over yields nothing (its moments are still said)
 *   H. a summary (a scorebook's innings) yields totals and null balls
 *   I. a typed player yields nothing; the roster decides who holds a figure
 *   J. a correction (a void, an amendment) changes the fold, and the facts
 *      follow it (GA-I36)
 *   K. player_milestone's rows, pinned: kind, value, innings, one per player
 *      per innings, as db/08 (re-read through db/87) and db/71 define them
 *   L. determinism: the same events give the same facts, in either shape,
 *      and the input is not touched
 *   M. the commentary's milestone lines are the facts' moments
 */
import {
  deriveFacts, FACT_KIND as F, MOMENT_KIND as M, FACTS_VERSION,
  inningsStart, batters, bowler, ball, retire, voidEvent, inningsSummary, inningsEnd, BALL_TYPE,
  deriveMatch, deriveCommentary, COMMENTARY_KIND, ballsOfOvers,
} from "../src/index.mjs";
import { baseCard, TYPED as BOOK_TYPED } from "./scorebook-cards.mjs";

/** @import { LogEvent } from "../src/events.mjs" */
/** @import { Facts, Milestone } from "../src/facts.mjs" */

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, detail) => {
  if (c) pass++;
  else { fail++; console.log("  ✗", n, detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 600)}`); }
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

// ── Fixtures ─────────────────────────────────────────────
// Ids shaped as the database's (players SCRBRD holds a row for), and names a
// scorer types for an opposition with no roster. No child is named here.
const P = Array.from({ length: 11 }, (_, k) => `f0f0f0f0-0000-4000-8000-0000000000${String(k + 1).padStart(2, "0")}`);
const Q = Array.from({ length: 6 }, (_, k) => `e0e0e0e0-0000-4000-8000-0000000000${String(k + 1).padStart(2, "0")}`);
const TYPED_BAT = "Typed Batter";
const TYPED_BOWL = "Typed Bowler";
// A 4th-Edition day: nothing here reads the clock.
const T0 = Date.parse("2026-10-03T08:00:00Z");

let n = 0;
/**
 * An event as the server holds it: an id, a seq, an innings, a fixed time.
 * @template {object} T  @param {T} e  @param {number} [inns]
 * @returns {T & {id: string, seq: number, innings: number, clientTs: number}}
 */
const I = (e, inns = 0) => { n++; return { ...e, id: `ff:${n.toString(36)}`, seq: n, innings: inns, clientTs: T0 + n * 1000 }; };

/** An innings opened: the sides, and the first two batters. */
const open = (/** @type {number} */ inns = 0, /** @type {Record<string, unknown>} */ o = {}, striker = P[0], nonStriker = P[1]) => [
  I(inningsStart({ battingTeam: "Home", bowlingTeam: "Away", overs: 20, ...o }), inns),
  I(batters({ striker, nonStriker }), inns),
];
const bw = (/** @type {string} */ id, inns = 0) => I(bowler({ bowler: id }), inns);
const r = (/** @type {number} */ v, inns = 0) => I(ball({ type: BALL_TYPE.RUN, value: v }), inns);
/** @param {string} how  @param {Record<string, unknown>} [o]  @param {number} [inns] */
const W = (how, o = {}, inns = 0) => I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: how, ...o }), inns);
/** @param {number} v  @param {Record<string, unknown>} [o]  @param {number} [inns] */
const wd = (v = 0, o = {}, inns = 0) => I(ball({ type: BALL_TYPE.WIDE, value: v, ...o }), inns);
/** @param {number} v  @param {Record<string, unknown>} [o]  @param {number} [inns] */
const nb = (v = 0, o = {}, inns = 0) => I(ball({ type: BALL_TYPE.NO_BALL, value: v, ...o }), inns);
const inAt = (/** @type {string} */ striker, inns = 0) => I(batters({ striker }), inns);
const inAtOther = (/** @type {string} */ nonStriker, inns = 0) => I(batters({ nonStriker }), inns);

/** @param {Facts} f  @param {string} [player] */
const ms = (f, player) => f.milestones.filter((m) => player == null || m.player === player);
/** @param {Milestone[]} list */
const brief = (list) => list.map((m) => `${m.kind}:${m.player.slice(-2)}:${m.value}:i${m.innings}`).sort();

// ── A. Fifty and hundred ─────────────────────────────────
group("A. Fifty and hundred: 98 → 104 is one hundred, with both crossings");
{
  // P0 faces every ball: even runs keep him on strike, an over's end is
  // answered by a single from P1. 36, 66 (a single first), 90 and 92, 98, 104.
  const log = [
    ...open(), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6),
    bw(Q[1]), r(1), r(6), r(6), r(6), r(6), r(6),
    bw(Q[0]), r(1), r(6), r(6), r(6), r(6), r(2),
    bw(Q[1]), r(1), r(6), r(6), r(0), r(0), r(0),
  ];
  const six98to104 = log[log.length - 4];
  const f = deriveFacts(log);
  const mine = ms(f, P[0]);
  ok("one milestone for the batter: a hundred, worth 104", mine.length === 1 && mine[0].kind === F.HUNDRED && mine[0].value === 104, mine);
  ok("...reached on the six that took him from 98", mine[0]?.at?.id === six98to104.id && mine[0]?.at?.seq === six98to104.seq
     && mine[0]?.at?.over === 3 && mine[0]?.at?.ball === 3, mine[0]?.at);
  ok("...from 18 balls (balls to 100)", mine[0]?.ballsTo === 18, mine[0]);
  const line = f.batting.find((b) => b.player === P[0]);
  ok("his line keeps both crossings: 50 and 100, in order", JSON.stringify(line?.crossings.map((c) => c.mark)) === "[50,100]", line);
  ok("...the fifty off his 9th ball, 48 to 54: over 2, ball 4",
     line?.crossings[0]?.balls === 9 && line.crossings[0].at.over === 1 && line.crossings[0].at.ball === 4, line?.crossings[0]);
  ok("...the hundred's crossing is the milestone's ball", line?.crossings[1]?.at.id === six98to104.id);
  ok("104 not out off 21", line?.runs === 104 && line.balls === 21 && line.out === false, line);
  ok("the single-taker made nothing", ms(f, P[1]).length === 0);
  ok("moments: a mark at 50 and at 100, said of him", f.moments.filter((m) => m.kind === M.BATTER_MARK && m.player === P[0])
    .map((m) => m.mark).join() === "50,100");
  ok("the answer is stamped with the rules' version", f.version === FACTS_VERSION && FACTS_VERSION === 1);

  // The runs are the fold's: a no-ball hit for four is his and a ball faced;
  // a no-ball's byes are not his; a wide is neither runs nor a ball faced.
  const nbLog = [
    ...open(), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6),   // 36 off 6
    bw(Q[1]), r(1), r(6), r(6),                                   // 48 off 8 (P1's single)
    nb(4, { nbRuns: "byes" }),                                    // byes: still 48, a ball faced (9)
    wd(4),                                                        // a wide: still 48, not faced
    nb(4),                                                        // off the bat: 52 off 10
    r(0), r(0),
  ];
  const fn = deriveFacts(nbLog);
  const fifty = ms(fn, P[0]);
  ok("a no-ball hit for four brings up the fifty: worth 52", fifty.length === 1 && fifty[0].kind === F.FIFTY && fifty[0].value === 52, fifty);
  ok("...on the no-ball, after 10 balls faced (the no-ball with byes counts, the wide does not)",
     fifty[0]?.at?.id === nbLog[nbLog.length - 3].id && fifty[0]?.ballsTo === 10, fifty[0]);
  ok("a no-ball is placed on the ball of the over it was bowled before: over 2, ball 4", fn.moments[0]?.at.over === 1 && fn.moments[0]?.at.ball === 4,
     fn.moments[0]?.at);

  // 49 not out is nothing; exactly fifty is a fifty.
  const just = deriveFacts([...open(), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6), bw(Q[1]), r(1), r(6), r(6), r(1), r(1)]);
  ok("49 is nothing; the single-taker's 2 is nothing", just.milestones.length === 0, just.milestones);
}

// ── B. Five-for ──────────────────────────────────────────
group("B. A five-for: only the bowler's ways out");
{
  const log = [
    ...open(), bw(Q[0]),
    W("bowled"), inAt(P[2]),
    W("caught", { fielder: TYPED_BAT }), inAt(P[3]),
    W("run_out"), inAt(P[4]),                         // not his
    W("lbw"), inAt(P[5]),
    r(0), r(0),
    bw(Q[1]), r(1), r(1), r(0), r(0), r(0), r(0),
    bw(Q[0]),
    wd(0, { dismissal: "stumped" }), inAt(P[6]),      // a stumping off a wide: his (db/87)
    nb(0, { dismissal: "run_out", dismissed: P[1] }), inAtOther(P[7]),   // the non-striker run out off a no-ball: not his
    r(0),                                             // the free hit
    W("hit_wicket"), inAt(P[8]),                      // his fifth
  ];
  const f = deriveFacts(log);
  const mine = ms(f, Q[0]);
  ok("one five-for, worth five", mine.length === 1 && mine[0].kind === F.FIVE_FOR && mine[0].value === 5, mine);
  ok("...at his fifth: the hit wicket, after a stumping off a wide made four",
     mine[0]?.at?.id === log[log.length - 2].id, mine[0]?.at);
  const line = f.bowling.find((b) => b.player === Q[0]);
  ok("his figures: 5 for 2 off 8 balls (the wide's run and the no-ball's are his; neither a ball of the over)",
     line?.wickets === 5 && line.runs === 2 && line.balls === 8, line);
  ok("the run outs are nobody's: no fact for the other bowler", ms(f, Q[1]).length === 0 && f.bowling.find((b) => b.player === Q[1])?.wickets === 0);
  ok("moments: 'five wickets' said once, on the fifth", f.moments.filter((m) => m.kind === M.BOWLER_WICKETS).map((m) => `${m.wickets}/${m.runs}`).join() === "5/2",
     f.moments);

  // Four of his and a run out is not a five-for.
  const four = deriveFacts([
    ...open(), bw(Q[0]),
    W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]), r(0), W("bowled"), inAt(P[4]), r(0), W("bowled"), inAt(P[5]),
    bw(Q[1]), W("run_out"), inAt(P[6]),
  ]);
  ok("four of his and a run out: no five-for, no bowler fact", ms(four, Q[0]).length === 0 && four.milestones.length === 0, four.milestones);
}

// ── C. Non-striker run out ───────────────────────────────
group("C. A non-striker run out dismisses him, and is nobody's wicket");
{
  const log = [...open(), bw(Q[0]), r(1), W("run_out", { dismissed: P[0], outAt: "bowler_end" }), inAtOther(P[2]), r(0)];
  // After the single, P1 faces and P0 is at the other end: P0 is the one out.
  const f = deriveFacts(log);
  const p0 = f.batting.find((b) => b.player === P[0]);
  const p1 = f.batting.find((b) => b.player === P[1]);
  ok("the non-striker is out", p0?.out === true, p0);
  ok("the striker is not", p1?.out === false, p1);
  ok("the bowler has no wicket and no fact", f.bowling.find((b) => b.player === Q[0])?.wickets === 0 && f.milestones.length === 0);
  ok("...and no moment", f.moments.length === 0, f.moments);
}

// ── D. The hat-trick (Q8) ────────────────────────────────
group("D. The hat-trick: three of his balls of the over in a row (Q8)");
{
  const three = [...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("caught", { fielder: TYPED_BAT }), inAt(P[3]), W("lbw"), inAt(P[4]), r(0)];
  const f = deriveFacts(three);
  const hat = ms(f, Q[0]).filter((m) => m.kind === F.HAT_TRICK);
  ok("three in three: one hat-trick, worth 3", hat.length === 1 && hat[0].value === 3, hat);
  ok("...at the third", hat[0]?.at?.id === three[three.length - 3].id, hat[0]?.at);
  ok("moments: on a hat-trick at the second, the hat-trick at the third",
     f.moments.map((m) => `${m.kind}@${m.at.ball}`).join() === `${M.HAT_TRICK_BALL}@2,${M.HAT_TRICK}@3`, f.moments);

  // Across overs: his last ball of one over and the first two of his next.
  const across = deriveFacts([
    ...open(), bw(Q[0]), r(0), r(0), r(0), r(0), r(0), W("bowled"), inAt(P[2]),
    bw(Q[1]), r(1), r(0), r(0), r(0), r(0), r(1),   // the other end: his balls are not the bowler's
    bw(Q[0]), W("bowled"), inAt(P[3]), W("bowled"), inAt(P[4]),
  ]);
  ok("across his overs, the other bowler's over between: a hat-trick", ms(across, Q[0]).some((m) => m.kind === F.HAT_TRICK), across.milestones);

  const wide = deriveFacts([...open(), bw(Q[0]), W("bowled"), inAt(P[2]), wd(0), W("bowled"), inAt(P[3]), W("bowled"), inAt(P[4])]);
  ok("W, a wide, W, W: a hat-trick (a wide is not one of his balls of the over: it does not break it)",
     ms(wide, Q[0]).filter((m) => m.kind === F.HAT_TRICK).length === 1
     && wide.moments.filter((m) => m.kind === M.HAT_TRICK_BALL).length === 1, wide.moments);
  const noBall = deriveFacts([...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]), nb(1), r(0), W("bowled"), inAt(P[4])]);
  ok("W, W, a no-ball, its free hit (a dot), W: no hat-trick — the free hit is a ball of the over",
     !noBall.milestones.some((m) => m.kind === F.HAT_TRICK), noBall.milestones);

  // A wide, a stumping off a wide and a no-ball neither make nor break one.
  // A declaration match (no free hit after a no-ball, SCRBRD-113), so the
  // ball after the no-ball can be a wicket: the fold's context is passed on.
  const DECL = { ctx: { format: "One-Day Declaration" } };
  const wides = deriveFacts([
    ...open(), bw(Q[0]), W("bowled"), inAt(P[2]), wd(1), W("bowled"), inAt(P[3]),
    wd(0, { dismissal: "stumped" }), inAt(P[4]), nb(0), W("bowled"), inAt(P[5]),
  ], null, DECL);
  ok("W, a wide, W, a stumping off a wide, a no-ball, W: a hat-trick",
     ms(wides, Q[0]).filter((m) => m.kind === F.HAT_TRICK).length === 1, wides.milestones);
  ok("...and a five-for? no: four of his (the stumping off the wide is his)", wides.bowling[0]?.wickets === 4, wides.bowling);
  const offWide = deriveFacts([...open(), bw(Q[0]), W("bowled"), inAt(P[2]), wd(0, { dismissal: "stumped" }), inAt(P[3]), W("bowled"), inAt(P[4]), r(0)]);
  ok("W, a stumping off a wide, W: not a hat-trick (two of his balls of the over)",
     !offWide.milestones.some((m) => m.kind === F.HAT_TRICK) && !offWide.moments.some((m) => m.kind === M.HAT_TRICK), offWide.moments);

  // A run out between breaks it.
  const ro = deriveFacts([...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("run_out"), inAt(P[3]), W("bowled"), inAt(P[4]), W("bowled"), inAt(P[5])]);
  ok("W, a run out, W, W: no hat-trick", !ro.milestones.some((m) => m.kind === F.HAT_TRICK), ro.milestones);
  ok("...on a hat-trick after the last two, once", ro.moments.filter((m) => m.kind === M.HAT_TRICK_BALL).length === 1, ro.moments);
  // A run out off a no-ball between: not a ball of the over, neither.
  const roNb = deriveFacts([...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]),
    nb(0, { dismissal: "run_out" }), inAt(P[4]), W("bowled"), inAt(P[5])], null, DECL);
  ok("W, W, a run out off a no-ball, W: a hat-trick (the no-ball is not one of his balls of the over)",
     roNb.milestones.some((m) => m.kind === F.HAT_TRICK), roNb.milestones);

  // Four in four, and two in one innings: one milestone each innings.
  const four = deriveFacts([...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]), W("bowled"), inAt(P[4]), W("bowled"), inAt(P[5]), r(0)]);
  ok("four in four: one hat-trick milestone, said once", ms(four, Q[0]).filter((m) => m.kind === F.HAT_TRICK).length === 1
     && four.moments.filter((m) => m.kind === M.HAT_TRICK).length === 1, four.moments);
  const twice = deriveFacts([
    ...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]), W("bowled"), inAt(P[4]),
    r(0), r(0), r(1),
    bw(Q[1]), r(1), r(0), r(0), r(0), r(0), r(0),
    bw(Q[0]), W("bowled"), inAt(P[5]), W("bowled"), inAt(P[6]), W("bowled"), inAt(P[7]),
  ]);
  const twiceHat = ms(twice, Q[0]).filter((m) => m.kind === F.HAT_TRICK);
  ok("two hat-tricks in one innings: one milestone (bowler_hat_trick's min(seq)), at the first",
     twiceHat.length === 1 && twiceHat[0].at?.over === 0 && twiceHat[0].at?.ball === 3, twiceHat);
  ok("...two said", twice.moments.filter((m) => m.kind === M.HAT_TRICK).length === 2);
  ok("...and a five-for: six of his, worth 6, at the fifth", ms(twice, Q[0]).some((m) => m.kind === F.FIVE_FOR && m.value === 6 && m.at?.over === 2 && m.at.ball === 2),
     ms(twice, Q[0]));
}

// ── E. Free hit ──────────────────────────────────────────
group("E. A wicket a free hit saved is nothing");
{
  const log = [...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]), nb(0), W("bowled"), r(0)];
  const f = deriveFacts(log);
  ok("bowled on the free hit: no wicket for him (two)", f.bowling[0]?.wickets === 2, f.bowling);
  ok("...the batter not out", f.batting.find((b) => b.player === P[3])?.out === false, f.batting);
  ok("...and it breaks the run: no hat-trick, and no moment for it",
     !f.milestones.some((m) => m.kind === F.HAT_TRICK) && !f.moments.some((m) => m.kind === M.HAT_TRICK), f.moments);
  // A run out on the free hit stands, and is still not his.
  const ro = deriveFacts([...open(), bw(Q[0]), nb(0), W("run_out"), inAt(P[2]), r(0)]);
  ok("a run out on a free hit stands, and is nobody's wicket", ro.batting.find((b) => b.player === P[0])?.out === true
     && ro.bowling[0]?.wickets === 0, ro.batting);
}

// ── F. Retirements ───────────────────────────────────────
group("F. Retirements: retired hurt and back, retired out");
{
  const log = [
    ...open(), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6),     // 36
    bw(Q[1]), r(1), r(6), r(4),                                     // 46 (P1's single)
    I(retire({ batter: P[0], reason: "hurt" })), inAt(P[2]),
    r(0), W("bowled"), inAt(P[0]),                                  // a wicket falls: he may come back (Law 25.4.2)
    r(4), r(0),                                                     // 50
    bw(Q[0]), r(1), r(0),
  ];
  const f = deriveFacts(log);
  const mine = ms(f, P[0]);
  ok("back from retired hurt, his runs go on: a fifty worth 50", mine.length === 1 && mine[0].kind === F.FIFTY && mine[0].value === 50, mine);
  ok("...on the ball after his return", mine[0]?.at?.id === log[log.length - 5].id, mine[0]?.at);
  const out = deriveFacts([...open(), bw(Q[0]), r(1), I(retire({ batter: P[0], reason: "out" })), inAtOther(P[2]), r(0)]);
  ok("retired out: out, and nobody's wicket", out.batting.find((b) => b.player === P[0])?.out === true
     && out.bowling[0]?.wickets === 0 && out.milestones.length === 0, out);
}

// ── G. Super over ────────────────────────────────────────
group("G. A super over yields nothing");
{
  // A fifty in a super over: no-balls hit for six (no ball of the over).
  const so = [
    ...open(0, {}, P[0], P[1]), bw(Q[0]), r(1),
    ...open(1, { superOver: 1, overs: 1, battingTeam: "Home" }, P[0], P[1]), bw(Q[0], 1),
    ...[0, 0, 0, 0, 0, 0, 0, 0, 0].map(() => nb(6, {}, 1)),
    r(0, 1),                                                         // the free hit
    W("bowled", {}, 1), inAt(P[2], 1), W("bowled", {}, 1),
  ];
  const m = deriveMatch(so);
  ok("the fold reads innings 1 as the first super over", m.innings[1]?.superOver === 1 && m.innings[1].batsmen[0]?.runs === 54, m.innings[1]?.batsmen);
  const f = deriveFacts(so);
  ok("no milestone from it", f.milestones.length === 0, f.milestones);
  ok("no batting or bowling line from it", !f.batting.some((b) => b.innings === 1) && !f.bowling.some((b) => b.innings === 1), [f.batting, f.bowling]);
  ok("its moments are still said, marked as a super over's", f.moments.some((x) => x.kind === M.BATTER_MARK && x.superOver && x.at.innings === 1)
     && f.moments.some((x) => x.kind === M.HAT_TRICK_BALL && x.superOver), f.moments);
  ok("the match innings' lines are there", f.batting.some((b) => b.innings === 0 && b.player === P[0]));
}

// ── H. A summary ─────────────────────────────────────────
group("H. A scorebook's innings yields totals and null balls");
{
  const card = baseCard(P.slice(0, 6));
  // The book's hundred, fifty and five-for; one batter's balls not recorded.
  card.batting[0].runs = 104; card.batting[1].runs = 54; card.batting[3].runs = 61;   // balls null on the card
  card.bowling.push({ ref: Q[0], overs: "4", maidens: 0, runs: 20, wickets: 5, wides: 0, noBalls: 0 });
  const SRC = { kind: /** @type {"scorebook"} */ ("scorebook"), import: "imp-1", checkedBy: "u-scorer", confirmedBy: "u-dos" };
  const log = [
    I(inningsStart({ battingTeam: "1XI", bowlingTeam: "Opposition", overs: 20, squad: P.slice(0, 6).map((id) => ({ id, name: id })) })),
    I(inningsSummary({ innings: 0, card, typed: BOOK_TYPED, source: SRC })),
    I(inningsEnd({ reason: "overs", confirmed: { runs: card.total, wickets: card.wickets, balls: /** @type {number} */ (ballsOfOvers(card.overs)) } })),
  ];
  const f = deriveFacts(log);
  ok("the book's 104 is a hundred, its 54 and 61 fifties",
     brief(ms(f).filter((m) => m.kind !== F.FIVE_FOR)).join() === [`hundred:01:104:i0`, `fifty:02:54:i0`, `fifty:04:61:i0`].sort().join(), brief(f.milestones));
  ok("...each with no ball and no balls to it", ms(f).every((m) => m.at === null && m.ballsTo === null), f.milestones);
  ok("the book's five wickets are a five-for, with no ball", ms(f, Q[0]).length === 1 && ms(f, Q[0])[0].kind === F.FIVE_FOR && ms(f, Q[0])[0].at === null);
  ok("no hat-trick from a book: no sequence", !f.milestones.some((m) => m.kind === F.HAT_TRICK));
  const b0 = f.batting.find((b) => b.player === P[0]), b3 = f.batting.find((b) => b.player === P[3]);
  ok("lines from the book: 104 off 40, no crossings; 61 with balls not recorded (null, not nought)",
     b0?.runs === 104 && b0.balls === 40 && b0.summarised && b0.crossings.length === 0 && b3?.balls === null, [b0, b3]);
  ok("the typed bowlers on the card hold nothing", f.bowling.every((b) => b.player === Q[0]), f.bowling);
  ok("no moments: nothing was bowled", f.moments.length === 0);
}

// ── I. Typed players and the roster ──────────────────────
group("I. A typed player yields nothing; the roster decides");
{
  const log = [
    ...open(0, {}, TYPED_BAT, P[1]), bw(TYPED_BOWL),
    r(6), r(6), r(6), r(6), r(6), r(6), bw(Q[1]), r(1), r(6), r(6), r(6), r(0), r(0),   // the typed batter's 54
    bw(TYPED_BOWL), W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]), W("bowled"), inAt(P[4]), W("bowled"), inAt(P[5]), W("bowled"), inAt(P[6]),
  ];
  const f = deriveFacts(log);
  ok("a typed batter's fifty and a typed bowler's five-for and hat-trick: no milestone", f.milestones.length === 0, f.milestones);
  ok("...no line for either", !f.batting.some((b) => b.player === TYPED_BAT) && !f.bowling.some((b) => b.player === TYPED_BOWL));
  ok("...but the moments are said, marked not linked (the commentary narrates everyone)",
     f.moments.some((m) => m.player === TYPED_BAT && m.kind === M.BATTER_MARK && !m.linked)
     && f.moments.some((m) => m.player === TYPED_BOWL && m.kind === M.HAT_TRICK && !m.linked), f.moments);
  ok("a linked player's moment says linked", deriveFacts([...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("bowled")]).moments.every((m) => m.linked));
  // The roster: a set, a list, a function.
  const both = [...open(), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6), bw(Q[1]), r(1), r(6), r(6), r(6), r(0), r(0)];
  ok("default: a player id holds his fifty", ms(deriveFacts(both), P[0]).length === 1);
  ok("a roster without him: nothing", deriveFacts(both, new Set([P[1]])).milestones.length === 0
     && deriveFacts(both, [P[1]]).milestones.length === 0 && deriveFacts(both, (ref) => ref === P[1]).milestones.length === 0);
  ok("a roster with him: his fifty", ms(deriveFacts(both, new Map([[P[0], {}]])), P[0]).length === 1 && ms(deriveFacts(both, [P[0]]), P[0]).length === 1);
  ok("a roster that names a typed batter makes him attributable",
     deriveFacts(log, (ref) => ref === TYPED_BAT).milestones.some((m) => m.player === TYPED_BAT && m.kind === F.FIFTY));
}

// ── J. Corrections ───────────────────────────────────────
group("J. A correction changes the fold, and the facts follow it (GA-I36)");
{
  const played = [
    ...open(), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6),
    bw(Q[1]), r(1), r(6), r(6), r(6), r(6), r(6),
    bw(Q[0]), r(1), r(6), r(6), r(6), r(6), r(2),
    bw(Q[1]), r(1), r(6), r(6),
  ];
  const last = played[played.length - 1];
  ok("played: a hundred", ms(deriveFacts(played), P[0])[0]?.kind === F.HUNDRED);
  const undone = [...played, I(voidEvent({ target: last.id }))];
  const u = ms(deriveFacts(undone), P[0]);
  ok("the six voided: 98, a fifty (the hundred is gone, not kept)", u.length === 1 && u[0].kind === F.FIFTY && u[0].value === 98, u);
  const amended = [...undone, I(ball({ type: BALL_TYPE.RUN, value: 1 }))];
  ok("re-entered as a single: 99, still a fifty", ms(deriveFacts(amended), P[0])[0]?.value === 99);
  const again = [...undone, I(ball({ type: BALL_TYPE.RUN, value: 2 }))];
  const a = ms(deriveFacts(again), P[0]);
  ok("re-entered as two: 100, a hundred at the new ball", a[0]?.kind === F.HUNDRED && a[0].value === 100 && a[0].at?.id === again[again.length - 1].id, a);

  // An amendment: a wicket in the middle of a five-for, voided by a second
  // person's approval, takes the five-for with it.
  const five = [...open(), bw(Q[0]), W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]), W("bowled"), inAt(P[4]), W("bowled"), inAt(P[5]), W("bowled"), inAt(P[6])];
  const [fifth, fifthIn] = [five[11], five[12]];
  ok("before: a five-for and a hat-trick", brief(ms(deriveFacts(five), Q[0])).join() === "five_for:01:5:i0,hat_trick:01:3:i0");
  /** @param {{id: string}} t  @param {string} id */
  const amend = (t, id) => ({ ...voidEvent({ target: t.id, reason: "amendment" }), id, innings: 0, clientTs: T0 });
  const af = deriveFacts([...five, amend(fifth, "amendment:1"), amend(fifthIn, "amendment:2")]);
  ok("the fifth wicket amended away (and its new batter): four of his, no five-for; the hat-trick stands",
     brief(ms(af, Q[0])).join() === "hat_trick:01:3:i0" && af.bowling[0].wickets === 4, brief(af.milestones));
  ok("...and its moment is gone with it", !af.moments.some((m) => m.kind === M.BOWLER_WICKETS), af.moments);
}

// ── K. player_milestone, pinned ──────────────────────────
group("K. player_milestone's rows: kind, value, innings, one per player per innings");
{
  // Two innings; one boy bats in each, one bowls in each. Expected rows are
  // what db/08's player_milestone (latest db/87) and db/71's bowler_hat_trick
  // give for these balls: a hundred (not also a fifty), a fifty, a five-for
  // with its final count, one hat-trick for the innings.
  const log = [
    ...open(0), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6),
    bw(Q[1]), r(1), r(6), r(6), r(6), r(6), r(6),
    bw(Q[0]), r(1), r(6), r(6), r(6), r(6), r(2),
    bw(Q[1]), r(1), r(6), r(6), r(0), r(0), r(0),           // P0 104*
    ...open(1, { battingTeam: "Away", bowlingTeam: "Home" }, Q[2], Q[3]), bw(P[5], 1),
    W("bowled", {}, 1), inAt(Q[4], 1), W("bowled", {}, 1), inAt(Q[5], 1), W("bowled", {}, 1), inAt(TYPED_BAT, 1),
    W("bowled", {}, 1), inAt(Q[0], 1), r(0, 1), W("lbw", {}, 1), inAt(Q[1], 1), W("bowled", {}, 1), inAt(P[9], 1),
  ];
  const f = deriveFacts(log);
  // The over's end clears the bowler: the seventh ball, with none named, is
  // nobody's wicket (the fold's, and SQL's bowler_id NULL).
  ok("the rows: P0's hundred (104) in innings 0; P5's five-for (5) and hat-trick in innings 1",
     brief(f.milestones).join() === ["hundred:01:104:i0", "five_for:06:5:i1", "hat_trick:06:3:i1"].sort().join(), brief(f.milestones));
  ok("in the order they happened", f.milestones.map((m) => m.kind).join() === "hundred,hat_trick,five_for", f.milestones.map((m) => m.kind));
}

// ── L. Determinism ───────────────────────────────────────
group("L. Determinism: the same events, the same facts");
{
  const log = [...open(), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6), bw(Q[1]), r(1), r(6), r(6), r(6), r(6), W("bowled"), inAt(P[2]),
    ...open(1, { battingTeam: "Away", bowlingTeam: "Home" }, Q[2], Q[3]), bw(P[5], 1), W("bowled", {}, 1), inAt(Q[4], 1), W("bowled", {}, 1)];
  const frozen = JSON.stringify(log);
  const a = JSON.stringify(deriveFacts(log)), b = JSON.stringify(deriveFacts(log));
  ok("twice over, byte for byte", a === b);
  ok("the input is not touched", JSON.stringify(log) === frozen);
  const byInn = [log.filter((e) => e.innings === 0), log.filter((e) => e.innings === 1)];
  ok("a flat log and the pad's logs by innings give the same facts", JSON.stringify(deriveFacts(byInn)) === a);
  const deep = /** @type {(o: any) => any} */ ((o) => { if (o && typeof o === "object") { Object.values(o).forEach(deep); Object.freeze(o); } return o; });
  let threw = null;
  try { deriveFacts(deep(structuredClone(log))); } catch (e) { threw = e; }
  ok("a frozen log folds (nothing is written to it)", threw === null, String(threw));
  ok("an empty log: no facts", JSON.stringify(deriveFacts([])) === JSON.stringify({ version: 1, milestones: [], batting: [], bowling: [], moments: [] }));
  ok("no argument at all: no facts", deriveFacts().milestones.length === 0);
}

// ── M. The commentary reads them ─────────────────────────
group("M. The commentary's milestone lines are the facts' moments");
{
  const log = [
    ...open(), bw(Q[0]), r(6), r(6), r(6), r(6), r(6), r(6), bw(Q[1]), r(1), r(6), r(6), r(6), r(6), r(6),
    bw(Q[0]), r(1), r(6), r(6), r(6), r(6), r(2), bw(Q[1]), r(1), r(6), r(6), r(0), r(0), r(0),
    bw(Q[0]), W("bowled"), inAt(P[2]), W("bowled"), inAt(P[3]), W("bowled"), inAt(P[4]), W("bowled"), inAt(P[5]), W("bowled"), inAt(P[6]),
  ];
  const lines = deriveCommentary(log).filter((x) => x.kind === COMMENTARY_KIND.MILESTONE && !/partnership/.test(x.text));
  const f = deriveFacts(log);
  ok("one line per moment, at its ball", lines.length === f.moments.length
     && lines.every((x, k) => x.over === f.moments[k].at.over && x.ball === f.moments[k].at.ball), [lines, f.moments.map((m) => m.at)]);
  ok("...in the facts' words: the hundred, the hat-trick, five wickets",
     lines.some((x) => /hundred/.test(x.text)) && lines.some((x) => /^A hat-trick for/.test(x.text)) && lines.some((x) => /^Five wickets for .*: 5\/\d+\.$/.test(x.text)),
     lines.map((x) => x.text));
}

console.log("\n────────────────────────────────────────────────────");
console.log(`FACTS SUITE: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
