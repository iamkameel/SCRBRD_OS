/**
 * CRI-1.5: a dismissal on the Scorecard opens the Commentary at that ball
 * (lib/toBall.js). Every dismissal's key is a commentary line's key, and the
 * Commentary opens far enough back to hold it — past "Earlier overs" when the
 * wicket fell early in a long innings. The tap, the scroll and the way back
 * are the browser walk's (tools/smoke-browser-matchcentre.mjs, "CRI-1.5").
 *
 *   node apps/web/test/to-ball.test.mjs
 */
import { inningsStart, batters, bowler, ball, deriveInnings, deriveCommentary, BALL_TYPE } from "@scrbrd/scoring";
import { commentaryByOver, dismissalKey } from "../src/lib/matchCentre.js";
import { groupOf, shownFor } from "../src/lib/toBall.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const OVERS_AT_FIRST = 12;   // tabs-core.jsx: the Commentary's first reveal
const squad = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, name: `Batter ${i}` }));
let n = 0;
const ev = (e) => ({ ...e, innings: 0, id: `e${++n}` });
const log = [ev(inningsStart({ battingTeam: "1XI", bowlingTeam: "Opp", squad, overs: 20 })), ev(batters({ striker: "p0", nonStriker: "p1" }))];
// Twenty overs: a wicket in the first, one in the tenth, one in the last.
let next = 2;
for (let o = 0; o < 20; o++) {
  log.push(ev(bowler({ bowler: `Bowler ${o % 2}` })));
  for (let b = 0; b < 6; b++) {
    if ((o === 0 && b === 2) || (o === 9 && b === 4) || (o === 19 && b === 5)) {
      log.push(ev(ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })));
      if (o < 19) log.push(ev(batters({ striker: `p${next++}` })));
    } else log.push(ev(ball({ value: 1 })));
  }
}
const inn = deriveInnings(log);
const lines = deriveCommentary(log, { nameOf: (r) => squad.find((p) => p.id === r)?.name ?? r });
const groups = commentaryByOver(lines);
const out = inn.batsmen.filter((b) => b.status === "out");

group("every dismissal on the card is a line of the commentary");
ok(`three batters out (${out.length})`, out.length === 3);
for (const b of out) {
  const key = dismissalKey(inn, b.id, log);
  ok(`${b.name}: his dismissal's key (${key}) is a line's key, and that line is a wicket`, !!key && lines.some((c) => c.key === key && c.kind === "wicket"));
}

group("the Commentary opens far enough back to hold the ball asked for");
ok("twenty overs, newest first: the first over is the last group", groups.length === 20 && groups[19].over === 0, groups.map((g) => g.over));
const first = dismissalKey(inn, out[0].id, log), tenth = dismissalKey(inn, out[1].id, log), last = dismissalKey(inn, out[2].id, log);
ok("the first over's wicket is in the twentieth group", groupOf(groups, first) === 19, groupOf(groups, first));
ok("...so the tab opens all twenty overs, not the first twelve", shownFor(groups, first, OVERS_AT_FIRST) === 20);
ok("the tenth over's is in the eleventh, inside the first twelve: twelve stay", groupOf(groups, tenth) === 10 && shownFor(groups, tenth, OVERS_AT_FIRST) === OVERS_AT_FIRST);
ok("the last over's is the first group", groupOf(groups, last) === 0 && shownFor(groups, last, OVERS_AT_FIRST) === OVERS_AT_FIRST);
ok("no key, or one on no line: the ordinary twelve", shownFor(groups, null, OVERS_AT_FIRST) === OVERS_AT_FIRST && shownFor(groups, "e:nope", OVERS_AT_FIRST) === OVERS_AT_FIRST
   && groupOf(groups, null) === -1 && groupOf(groups, "e:nope") === -1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
