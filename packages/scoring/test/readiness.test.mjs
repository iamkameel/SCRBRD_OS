/**
 * SCRBRD-040. The scoring gate reports its own readiness.
 *
 * `scoringReadiness(inn)` is the only thing that decides whether the scorer may
 * record a delivery, and it answers with named reasons rather than a boolean,
 * so the pad can say what is missing instead of silently opening a sheet. The
 * rubric's gate has the same shape (rubric.test.mjs, group A).
 *
 * Every innings below is FOLDED from an event log, the way the scorer gets one:
 * a reason that only fires on a hand-built object would be a reason no real
 * innings can produce.
 *
 * Falsified by making the function report ready when the openers are missing
 * (groups B, E and F go red, and 6 of the render test) — see the backlog entry.
 *
 *   node packages/scoring/test/readiness.test.mjs
 */
import {
  deriveInnings, inningsStart, batters, bowler, ball, retire, voidEvent, sealInnings, inningsEnd,
  BALL_TYPE, INNINGS_END_REASON,
  scoringReadiness, SCORING_BLOCK, SCORING_BLOCK_TEXT,
} from "../src/index.mjs";

/** @import { LogEvent } from "../src/events.mjs" */
/** @import { Innings } from "../src/replay.mjs" */

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c  @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 200)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const SQ_A = ["p1", "p2", "p3", "p4"].map((id) => ({ id, name: id.toUpperCase() }));
const SQ_B = [{ id: "w1", name: "W1" }, { id: "w2", name: "W2" }];
const OPEN = inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 2 });
const PAIR = batters({ striker: "p1", nonStriker: "p2" });
const BOWL = bowler({ bowler: "w1" });
const run = (v = 0) => ball({ type: BALL_TYPE.RUN, value: v });
const out = () => ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" });

const codes = (/** @type {Partial<Innings> | null} */ inn) => scoringReadiness(inn).blocked.map((b) => b.code);
const readyOf = (/** @type {LogEvent[]} */ evs) => scoringReadiness(deriveInnings(evs));
/** @param {unknown} a  @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── A. Before there is an innings ────────────────────────
group("A. No innings: nobody has said who is batting");
{
  ok("a null innings (an empty log, as the engine holds it) is not ready",
     same(codes(null), [SCORING_BLOCK.NO_INNINGS]));
  ok("an empty log folded is not ready either", same(codes(deriveInnings([])), [SCORING_BLOCK.NO_INNINGS]));
  // A log carrying batters and a bowler but no innings_start has players and
  // no batting side. That is not a scoreable innings; it is a broken one.
  ok("a log with a pair and a bowler but no innings_start is still no innings",
     same(codes(deriveInnings([PAIR, BOWL])), [SCORING_BLOCK.NO_INNINGS]));
}

// ── B. Opening the innings ───────────────────────────────
group("B. Openers, then the opening bowler — each named, in order");
{
  ok("innings opened, nobody chosen: openers THEN opening bowler",
     same(codes(deriveInnings([OPEN])), [SCORING_BLOCK.OPENERS, SCORING_BLOCK.OPENING_BOWLER]));
  ok("one opener named is still the openers, not a 'next batter'",
     same(codes(deriveInnings([OPEN, batters({ striker: "p1" })])), [SCORING_BLOCK.OPENERS, SCORING_BLOCK.OPENING_BOWLER]));
  ok("openers named, no bowler: only the opening bowler",
     same(codes(deriveInnings([OPEN, PAIR])), [SCORING_BLOCK.OPENING_BOWLER]));
  ok("a bowler named before the openers: only the openers",
     same(codes(deriveInnings([OPEN, BOWL])), [SCORING_BLOCK.OPENERS]));
  const r = readyOf([OPEN, PAIR, BOWL]);
  ok("pair and bowler named: READY, and nothing blocked", r.ready === true && r.blocked.length === 0, r);
}

// ── C. Mid-innings gaps ──────────────────────────────────
group("C. Between deliveries: a new batter, a new bowler");
{
  ok("a wicket mid-over leaves an end empty: next batter, not openers",
     same(codes(deriveInnings([OPEN, PAIR, BOWL, run(1), out()])), [SCORING_BLOCK.NEXT_BATTER]));
  ok("...and the next batter arriving makes it ready again",
     readyOf([OPEN, PAIR, BOWL, run(1), out(), batters({ striker: "p3" })]).ready === true);

  const overDone = [OPEN, PAIR, BOWL, ...Array.from({ length: 6 }, () => run(0))];
  const r = scoringReadiness(deriveInnings(overDone));
  ok("the over ends and replay clears the bowler: next bowler",
     same(r.blocked.map((b) => b.code), [SCORING_BLOCK.NEXT_BOWLER]), r);
  ok("...and it says which over", r.blocked[0]?.over === 2, r.blocked[0]);
  ok("...and a bowler for it makes it ready", readyOf([...overDone, bowler({ bowler: "w2" })]).ready === true);

  const lastBallWicket = [OPEN, PAIR, BOWL, ...Array.from({ length: 5 }, () => run(0)), out()];
  ok("a wicket on the last ball of the over: batter THEN bowler, the order the sheets ask in",
     same(codes(deriveInnings(lastBallWicket)), [SCORING_BLOCK.NEXT_BATTER, SCORING_BLOCK.NEXT_BOWLER]));

  ok("a retirement leaves an end empty too",
     same(codes(deriveInnings([OPEN, PAIR, BOWL, run(0), retire({ batter: "p1", reason: "hurt" })])),
          [SCORING_BLOCK.NEXT_BATTER]));

  // Undo reaches the gate: voiding the bowler event puts it back.
  const b = bowler({ bowler: "w1" }); b.id = "bw-1";
  ok("voiding the opening bowler's event puts the opening bowler back on the list",
     same(codes(deriveInnings([OPEN, PAIR, b, voidEvent({ target: "bw-1" })])), [SCORING_BLOCK.OPENING_BOWLER]));
}

// ── D. An innings that is over ───────────────────────────
group("D. Over is terminal, and it is the only reason given");
{
  // Squad of four: three wickets is all out. The last one leaves an end empty,
  // and the gate must not ask for a batter who does not exist.
  const allOut = deriveInnings([OPEN, PAIR, BOWL, out(), batters({ striker: "p3" }), out(), batters({ striker: "p4" }), out()]);
  ok("the fixture is all out", allOut.complete === true && allOut.endReason === INNINGS_END_REASON.ALL_OUT, allOut.endReason);
  const r = scoringReadiness(allOut);
  ok("all out: innings over, and NOT also 'next batter'", same(r.blocked.map((x) => x.code), [SCORING_BLOCK.INNINGS_OVER]), r);
  ok("...carrying the laws' reason for the screen to name", r.blocked[0]?.endReason === INNINGS_END_REASON.ALL_OUT);

  const overs = deriveInnings([OPEN, PAIR, BOWL, ...Array.from({ length: 6 }, () => run(0)),
    bowler({ bowler: "w2" }), ...Array.from({ length: 6 }, () => run(0))]);
  ok("overs complete: innings over, not 'next bowler'",
     overs.complete === true && same(codes(overs), [SCORING_BLOCK.INNINGS_OVER]), codes(overs));

  const chase = deriveInnings([
    inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs: 2, target: 4 }),
    PAIR, BOWL, run(4),
  ]);
  ok("target reached: innings over", chase.endReason === INNINGS_END_REASON.TARGET && same(codes(chase), [SCORING_BLOCK.INNINGS_OVER]));

  const log = [OPEN, PAIR, BOWL, out(), batters({ striker: "p3" }), out(), batters({ striker: "p4" }), out()];
  const sealed = deriveInnings([...log, sealInnings(allOut)]);
  ok("a seal that stands: innings closed", sealed.sealed === true && same(codes(sealed), [SCORING_BLOCK.INNINGS_CLOSED]));
  const refused = deriveInnings([...log, inningsEnd({ reason: INNINGS_END_REASON.ALL_OUT })]);
  ok("a refused seal is not a closed innings — still waiting on the review",
     refused.sealed === false && same(codes(refused), [SCORING_BLOCK.INNINGS_OVER]));
}

// ── E. The gate agrees with the facts it reads ───────────
group("E. Ready exactly when the fold has a side, a pair, a bowler and is not over");
{
  // Every prefix of a played log, including the awkward moments — after a
  // wicket, at an over boundary, before the openers. The gate is checked
  // against the facts directly, so a reason that quietly stopped firing shows
  // up here even if no case above names it.
  const log = [OPEN, PAIR, BOWL, run(1), run(0), out(), batters({ striker: "p3" }), run(2), run(0), run(1),
    bowler({ bowler: "w2" }), run(4), out(), batters({ nonStriker: "p4" }), run(0)];
  let agree = 0, first = null;
  for (let n = 0; n <= log.length; n++) {
    const inn = n ? deriveInnings(log.slice(0, n)) : null;
    const facts = !!inn && inn.battingTeam != null && !inn.complete
      && inn.striker != null && inn.nonStriker != null && inn.bowler != null;
    const r = scoringReadiness(inn);
    if (r.ready === facts && r.ready === (r.blocked.length === 0)) agree++;
    else if (!first) first = { n, facts, r };
  }
  ok(`the gate agrees with the fold at every prefix (${agree}/${log.length + 1})`, agree === log.length + 1, first);
}

// ── F. Every reason has words ────────────────────────────
group("F. Every reason can be said out loud");
{
  for (const code of Object.values(SCORING_BLOCK)) {
    const t = SCORING_BLOCK_TEXT[code];
    ok(`${code} has a sentence`, typeof t?.says === "string" && t.says.length > 10);
    // Only a closed innings has nothing to fix; everything else names the action.
    ok(`${code} ${code === SCORING_BLOCK.INNINGS_CLOSED ? "has no fix" : "names its fix"}`,
       code === SCORING_BLOCK.INNINGS_CLOSED ? t?.fix === null : typeof t?.fix === "string" && t.fix.length > 3);
  }
  const r = scoringReadiness(deriveInnings([OPEN]));
  ok("a reason carries its words, so the screen reads them off the gate",
     r.blocked[0]?.says === SCORING_BLOCK_TEXT[SCORING_BLOCK.OPENERS].says
     && r.blocked[0]?.fix === SCORING_BLOCK_TEXT[SCORING_BLOCK.OPENERS].fix);
}

console.log("\n" + "─".repeat(52));
console.log(`READINESS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
