/**
 * EXPERIENCE_PASS Slice 2, Q9: from a scorecard figure to its balls
 * (lib/ballsOf.js). A batter's runs list the deliveries he faced and the one
 * that got him out, never a wide; a bowler's list every delivery he bowled.
 * Each id is a commentary line's, so the Commentary's id filter keeps exactly
 * them. The tap, the gate (signed in only) and the way back are the browser
 * walk's (tools/smoke-browser-matchcentre.mjs, "Slice 2").
 *
 *   node apps/web/test/balls-of.test.mjs
 */
import { inningsStart, batters, bowler, ball, deriveInnings, deriveCommentary, commentaryMatches, BALL_TYPE } from "@scrbrd/scoring";
import { ballsOf, mayListBalls } from "../src/lib/ballsOf.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const squad = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, name: `Batter ${i}` }));
let n = 0;
const ev = (e) => ({ ...e, innings: 0, id: `e${++n}` });
const log = [ev(inningsStart({ battingTeam: "1XI", bowlingTeam: "Opp", squad, overs: 20 })), ev(batters({ striker: "p0", nonStriker: "p1" }))];
// Over 1 (b0): p0 a single, p1 a four, a wide to p1, p1 a dot, p1 a single, p0 bowled.
log.push(ev(bowler({ bowler: "b0" })));
log.push(ev(ball({ value: 1 })));                       // p0 faces
log.push(ev(ball({ value: 4 })));                       // p1 faces
log.push(ev(ball({ type: BALL_TYPE.WIDE, value: 0 }))); // to p1: not a ball he faced
log.push(ev(ball({ value: 0 })));                       // p1
log.push(ev(ball({ value: 1 })));                       // p1, single: p0 on strike
log.push(ev(ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })));   // p0 out
log.push(ev(batters({ striker: "p2" })));
log.push(ev(ball({ value: 2 })));                       // p2 faces, the over's sixth legal ball
// Over 2 (b1): p1 on strike (end of over), a dot, then p2 run out at the non-striker's end off p1's ball.
log.push(ev(bowler({ bowler: "b1" })));
log.push(ev(ball({ value: 0 })));                       // p1, on strike after the over
const runOut = ev(ball({ type: BALL_TYPE.WICKET, dismissal: "run out", dismissed: "p2", outAt: "bowler_end", value: 0 }));
log.push(runOut);

const inn = deriveInnings(log);
const lines = deriveCommentary(log, { nameOf: (r) => squad.find((p) => p.id === r)?.name ?? r });
const struck = (id) => inn.ballLog.filter((b) => b.strikerId === id && b.type !== "Wd").map((b) => b.id);
const keep = (ids) => lines.filter((c) => commentaryMatches(c, { ids: new Set(ids) }));

group("a batter's runs: the balls he faced and the one that got him out");
const p0 = ballsOf(inn, "bat", "p0", log);
const p0row = inn.batsmen.find((b) => b.id === "p0");
ok(`p0's list is his faced balls (${p0.length}) and his B is ${p0row.balls}`, p0.length === p0row.balls && p0.every((id) => struck("p0").includes(id)), p0);
ok("...which hold the ball that bowled him", p0.includes(log[8].id), p0);
const p1 = ballsOf(inn, "bat", "p1", log);
const p1row = inn.batsmen.find((b) => b.id === "p1");
ok(`a wide is not a ball he faced: p1's list is his B (${p1row.balls})`, p1.length === p1row.balls && !p1.includes(log[5].id), { p1, b: p1row.balls });
const p2 = ballsOf(inn, "bat", "p2", log);
ok("run out at the other end: the ball that got him out is in his list", p2.includes(runOut.id), p2);
ok("...beside the ball he faced", p2.includes(log[10].id), p2);
ok("every id is a commentary line's, so the filter keeps one line each", keep(p1).length === p1.length, keep(p1).map((c) => c.key));
ok("in the log's order", p1.join() === [...p1].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).join(), p1);

group("a bowler's figures: every delivery he bowled");
const b0 = ballsOf(inn, "bowl", "b0", log);
ok(`b0 bowled the first over's seven deliveries, the wide among them (${b0.length})`, b0.length === 7 && b0.includes(log[5].id), b0);
const b1 = ballsOf(inn, "bowl", "b1", log);
ok(`b1's two (${b1.length})`, b1.length === 2 && b1.includes(runOut.id), b1);
ok("nobody's balls are anybody else's", !b0.some((id) => b1.includes(id)));

group("nothing to list");
ok("a player with no balls: none", ballsOf(inn, "bat", "p9", log).length === 0);
ok("no innings: none", ballsOf(null, "bat", "p0").length === 0 && ballsOf(inn, "bat", null).length === 0);

group("whose figures open (review N1): every player's on a staff screen; on a family's, his own boy's only");
ok("a staff or spectator screen (no focus): any player", mayListBalls(null, "p0") && mayListBalls([], "p7"));
ok("a parent's screen for p1: p1's figures open", mayListBalls(["p1"], "p1"));
ok("...and another boy's do not", !mayListBalls(["p1"], "p0"));
ok("a parent of two on the card: each of hers", mayListBalls(["p1", "p2"], "p2") && !mayListBalls(["p1", "p2"], "p3"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
