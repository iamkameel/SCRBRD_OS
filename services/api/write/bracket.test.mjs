/**
 * A knockout's bracket, shaped from what is stored (SCRBRD-060, bracket.mjs).
 *
 * The draws are the planner's own (pairings() + plan(), packages/scoring), so
 * the fixture ids, rounds, positions and byes are exactly what a published
 * plan holds. The fixtures and results are written as the route hands them
 * over: competition_results() rows through resultOut().
 *
 *   node services/api/write/bracket.test.mjs
 */
import { bracketOf, howDecided } from "./bracket.mjs";
import { pairings, plan as placeAll, PLAN_FORMAT } from "@scrbrd/scoring/planner";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 600)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const COMP = { id: "c0000000-0000-0000-0000-000000000001", name: "Walk Cup", compType: "knockout" };

/** A published plan of `n` entrants, drawn by the planner, with no windows (so no slot). @param {number} n */
function drawOf(n) {
  const entrants = Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, name: `School ${String.fromCharCode(65 + i)} 1st XI` }));
  const p = pairings({ format: PLAN_FORMAT.KNOCKOUT, entrants });
  const placed = placeAll({ pairings: p, windows: [], grounds: [], rules: { durationMinutes: 180 } });
  return { id: "p1", version: 1, publishedAt: "2026-11-01T08:00:00Z", entrants, plan: placed };
}

/** A result as resultOut() returns it. @param {"home" | "away" | null} winnerSide @param {object} [more] */
const result = (winnerSide, more = {}) => ({
  outcome: winnerSide ? `${winnerSide}_win` : "tie", marginKind: winnerSide ? "runs" : null, margin: winnerSide ? 6 : null,
  decidedBy: winnerSide ? "play" : null, winnerSide, playOutcome: winnerSide ? `${winnerSide}_win` : "tie",
  decisionApplied: false, decision: null, text: winnerSide ? `${winnerSide} side won by 6 runs` : "Match tied", superOvers: [], ...more,
});

/** @param {string | null} home @param {string | null} away @param {any} [r] @param {string} [status] */
const fixture = (home, away, r = null, status = "upcoming") => ({ startsAt: "2026-11-20T07:00:00Z", status, home, away, result: r });

// ── 1 · Four entrants: an unplayed round ─────────────────────────
group("1. Four entrants, nothing made: two semi-finals and a final, every later side waiting");
{
  const plan = drawOf(4);
  const b = bracketOf({ competition: COMP, plan, items: [], matches: new Map() });
  ok("drawn, two rounds", b.drawn === true && b.rounds.length === 2 && b.rounds[0].round === 1 && b.rounds[1].round === 2, b);
  ok("round 1 has two ties at positions 1 and 2", b.rounds[0].ties.map((t) => t.match).join() === "1,2", b.rounds[0]);
  ok("...each side is an entrant, known by its drawn name", b.rounds[0].ties.every((t) => t.home.known && t.away.known && /^School/.test(String(t.home.label))), b.rounds[0]);
  const final = b.rounds[1].ties[0];
  ok("the final's sides are not known, and say which tie each waits for",
     !final.home.known && final.home.label === null && final.home.from?.round === 1 && final.home.from?.match === 1
     && !final.away.known && final.away.from?.match === 2, final);
  ok("no fixture, no date, no status, no result, nobody through",
     final.matchId === null && final.startsAt === null && final.plannedAt === null && final.status === null && final.result === null && final.through === null, final);
  ok("no byes, no champion", b.byes.length === 0 && b.champion === null, b);
}

// ── 2 · A bye ────────────────────────────────────────────────────
group("2. Three entrants: the top seed has a bye, recorded as a bye and never as a tie");
{
  const plan = drawOf(3);
  const b = bracketOf({ competition: COMP, plan, items: [], matches: new Map() });
  ok("one bye, in round 1, to the top seed by name", b.byes.length === 1 && b.byes[0].round === 1 && b.byes[0].label === "School A 1st XI", b.byes);
  ok("round 1 is one tie, between the other two", b.rounds[0].ties.length === 1
     && [b.rounds[0].ties[0].home.label, b.rounds[0].ties[0].away.label].sort().join() === "School B 1st XI,School C 1st XI", b.rounds[0]);
  const final = b.rounds[1].ties[0];
  const [seeded, waiting] = final.home.known ? [final.home, final.away] : [final.away, final.home];
  ok("the final: the bye's side known, the other waiting for round 1's tie",
     seeded.known && seeded.label === "School A 1st XI" && seeded.from === null && !waiting.known && waiting.from?.round === 1, final);
}

// ── 3 · Played, and the winner carried on ────────────────────────
group("3. A semi-final played: its winner is the final's side before the final is made");
{
  const plan = drawOf(4);
  const [s1, s2] = plan.plan.fixtures.filter((f) => f.round === 1).sort((a, b) => a.match - b.match);
  const items = [{ fixtureKey: s1.id, matchId: "m-s1" }, { fixtureKey: s2.id, matchId: "m-s2" }];
  const matches = new Map([
    ["m-s1", fixture("School A 1st XI", "School D 1st XI", result("home"), "complete")],
    ["m-s2", fixture("School B 1st XI", "School C 1st XI", result(null, { outcome: "in_progress", playOutcome: "in_progress", text: null }))],   // as competition_results() says an unplayed fixture
    ["m-other", fixture("School A 1st XI", "School B 1st XI")],   // arranged by hand, outside the draw
  ]);
  const b = bracketOf({ competition: COMP, plan, items, matches });
  const t1 = b.rounds[0].ties[0], final = b.rounds[1].ties[0];
  ok("the played tie: its fixture, its date, its words, the home side through",
     t1.matchId === "m-s1" && t1.startsAt === "2026-11-20T07:00:00Z" && t1.result?.text === "home side won by 6 runs"
     && t1.result?.how === "play" && t1.through === "home", t1);
  ok("the unplayed tie: a fixture with no result", b.rounds[0].ties[1].matchId === "m-s2" && b.rounds[0].ties[1].result === null
     && b.rounds[0].ties[1].through === null, b.rounds[0].ties[1]);
  const fromS1 = final.home.from?.match === 1 ? final.home : final.away;
  const fromS2 = fromS1 === final.home ? final.away : final.home;
  ok("the final's side from semi-final 1 is its winner, by name", fromS1.known && fromS1.label === "School A 1st XI", final);
  ok("...the other still waits", !fromS2.known && fromS2.label === null, final);
  ok("a fixture the draw did not make is counted outside it, never placed", b.fixturesOutsideDraw === 1, b);
}

// ── 4 · A tie settled by a super over; a forfeit; a walkover ────
group("4. Settled otherwise: a super over, a concession, a walkover, an award; a tie not yet settled");
{
  ok("a super over", howDecided(result("away", { outcome: "tie", decidedBy: "super_over" })) === "super_over");
  ok("a concession (a forfeit)", howDecided(result("home", { decidedBy: "decision", marginKind: "conceded", decision: { kind: "conceded", side: "away" } })) === "conceded");
  ok("a walkover", howDecided(result("home", { decidedBy: "decision", marginKind: "walkover", decision: { kind: "walkover", side: "away" } })) === "walkover");
  ok("an award", howDecided(result("away", { decidedBy: "decision", decision: { kind: "awarded", side: "away", overridesPlay: true } })) === "awarded");
  ok("a tie nobody has settled: no winner, no how", howDecided(result(null)) === null);

  const plan = drawOf(4);
  const [s1, s2] = plan.plan.fixtures.filter((f) => f.round === 1).sort((a, b) => a.match - b.match);
  const fin = /** @type {any} */ (plan.plan.fixtures.find((f) => f.round === 2));
  const items = [{ fixtureKey: s1.id, matchId: "m-s1" }, { fixtureKey: s2.id, matchId: "m-s2" }, { fixtureKey: fin.id, matchId: "m-f" }];
  const matches = new Map([
    ["m-s1", fixture("School A 1st XI", "School D 1st XI", result("away", { outcome: "tie", decidedBy: "super_over", text: "Match tied; School D 1st XI won the super over" }), "complete")],
    ["m-s2", fixture("School B 1st XI", "School C 1st XI", result("home", { decidedBy: "decision", marginKind: "walkover", outcome: "home_win",
                                                                           decision: { kind: "walkover", side: "away" }, text: "School B 1st XI won by a walkover" }), "upcoming")],
    ["m-f", fixture("School D 1st XI", "School B 1st XI", result("away", { decidedBy: "decision", marginKind: "conceded", decision: { kind: "conceded", side: "home" },
                                                                          text: "School B 1st XI won: School D 1st XI conceded" }), "complete")],
  ]);
  const b = bracketOf({ competition: COMP, plan, items, matches });
  ok("the super-over semi: the away side through, how = super_over", b.rounds[0].ties[0].through === "away" && b.rounds[0].ties[0].result?.how === "super_over", b.rounds[0].ties[0]);
  ok("the walkover semi: the home side through, how = walkover, whatever the status", b.rounds[0].ties[1].through === "home" && b.rounds[0].ties[1].result?.how === "walkover", b.rounds[0].ties[1]);
  ok("the final made: its sides are the fixture's own", b.rounds[1].ties[0].home.label === "School D 1st XI" && b.rounds[1].ties[0].away.label === "School B 1st XI", b.rounds[1]);
  ok("...they still say where they came from", b.rounds[1].ties[0].home.from?.round === 1, b.rounds[1].ties[0]);
  ok("the final conceded: the champion is the side through", b.rounds[1].ties[0].result?.how === "conceded" && b.champion === "School B 1st XI", b);
}

// ── 5 · A flag, and a tie with no winner ─────────────────────────
group("5. A tie with no winner keeps the next side waiting; a db/72 flag reaches its tie");
{
  const plan = drawOf(4);
  const [s1] = plan.plan.fixtures.filter((f) => f.round === 1).sort((a, b) => a.match - b.match);
  const fin = /** @type {any} */ (plan.plan.fixtures.find((f) => f.round === 2));
  const items = [{ fixtureKey: s1.id, matchId: "m-s1" }, { fixtureKey: fin.id, matchId: "m-f" }];
  const matches = new Map([
    ["m-s1", fixture("School A 1st XI", "School D 1st XI", result(null), "complete")],
    ["m-f", fixture("School A 1st XI", null)],
  ]);
  const flags = [{ matchId: "m-f", side: "away", note: "awaiting a winner of A v D (20 Nov)", awaitingWinner: true, played: false },
                 { matchId: "m-elsewhere", side: "home", note: "not this bracket's", awaitingWinner: false, played: false }];
  const b = bracketOf({ competition: COMP, plan, items, matches, flags });
  const final = b.rounds[1].ties[0];
  ok("a tied, unsettled semi sends nobody on", b.rounds[0].ties[0].through === null && b.rounds[0].ties[0].result?.how === null, b.rounds[0].ties[0]);
  ok("the final's side the match does not name is not known", final.home.known && !final.away.known && final.away.label === null, final);
  ok("the flag is on the final, and only its own", final.flags.length === 1 && final.flags[0].awaitingWinner === true && final.flags[0].side === "away", final.flags);
}

// ── 6 · No draw ──────────────────────────────────────────────────
group("6. A knockout with no published draw: no bracket is made up");
{
  const b = bracketOf({ competition: COMP, plan: null, items: [], matches: new Map([["m1", fixture("A", "B")]]) });
  ok("drawn false, no rounds, the fixture counted outside", b.drawn === false && b.rounds.length === 0 && b.fixturesOutsideDraw === 1 && b.champion === null, b);
  const planned = drawOf(4);
  planned.plan.fixtures[0].startsAt = "2026-11-21T07:00:00Z";
  const p = bracketOf({ competition: COMP, plan: planned, items: [], matches: new Map() });
  const t = p.rounds.flatMap((r) => r.ties).find((x) => x.key === planned.plan.fixtures[0].id);
  ok("a tie with no fixture carries the plan's slot as plannedAt, never as its date", t?.plannedAt === "2026-11-21T07:00:00Z" && t?.startsAt === null, t);
}

console.log(`\n${"─".repeat(52)}\nBRACKET: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
