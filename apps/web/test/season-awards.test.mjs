/**
 * lib/seasonAwards.js — ranking for the Season Awards / MVP roll-up
 * (SCRBRD-084), against the exact shape usePlayersWithCareer() returns.
 *
 * The one thing this file exists to prove: the sample floor in
 * packages/scoring/src/rating.mjs (MIN_BALLS_FACED / MIN_BALLS_BOWLED) is
 * respected end to end — a boy below it is ABSENT from the ranked lists,
 * never last on them with a number the package itself refused to produce.
 *
 *   node apps/web/test/season-awards.test.mjs
 */
import { MIN_BALLS_BOWLED, MIN_BALLS_FACED } from "@scrbrd/scoring";
import {
  bestBattingAverages, bestBowlingEconomies, mvpRanking, mvpScore, topRunScorers, topWicketTakers,
} from "../src/lib/seasonAwards.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d)}` : ""); } };
const group = (t) => console.log("\n" + t);

// A career row, in the shape asCareer() (apps/web/src/lib/live.js) returns —
// runs/ballsFaced/dismissals and wkts/ballsBowled/runsConceded, never a
// pre-computed index, so this test exercises exactly what the view will pass.
const player = (over) => ({
  id: "p", name: "Player", team: "1XI", school: "HIL",
  runs: 0, ballsFaced: 0, dismissals: 0, avg: null,
  wkts: 0, ballsBowled: 0, runsConceded: 0, econ: null,
  ...over,
});

group("The sample floor: a thin season is absent, not ranked last");
{
  const thin = player({ id: "thin", runs: 20, ballsFaced: MIN_BALLS_FACED - 1, dismissals: 1 });
  const proven = player({ id: "proven", runs: 40, ballsFaced: MIN_BALLS_FACED, dismissals: 1 });
  const battingRanked = bestBattingAverages([thin, proven]);
  ok("the thin sample never appears in the batting index ranking", !battingRanked.some((r) => r.player.id === "thin"), battingRanked);
  ok("the proven one does, with a real number", battingRanked.some((r) => r.player.id === "proven" && r.index.value != null));

  const thinBowl = player({ id: "thinBowl", wkts: 2, ballsBowled: MIN_BALLS_BOWLED - 1, runsConceded: 10 });
  const provenBowl = player({ id: "provenBowl", wkts: 3, ballsBowled: MIN_BALLS_BOWLED, runsConceded: 24 });
  const bowlRanked = bestBowlingEconomies([thinBowl, provenBowl]);
  ok("the thin bowling sample never appears", !bowlRanked.some((r) => r.player.id === "thinBowl"), bowlRanked);
  ok("the proven one does", bowlRanked.some((r) => r.player.id === "provenBowl"));
}

group("Top run-scorers and wicket-takers are a plain count — no floor");
{
  const few = player({ id: "few", runs: 5, ballsFaced: 4, dismissals: 0 });
  const many = player({ id: "many", runs: 90, ballsFaced: 60, dismissals: 2, avg: 45 });
  const scorers = topRunScorers([few, many]);
  ok("both appear — a thin sample is still a real score", scorers.length === 2, scorers);
  ok("the higher total is first", scorers[0].id === "many");

  const oneWkt = player({ id: "one", wkts: 1, ballsBowled: 6, runsConceded: 4, econ: 4 });
  const fiveWkts = player({ id: "five", wkts: 5, ballsBowled: 24, runsConceded: 20, econ: 5 });
  const takers = topWicketTakers([oneWkt, fiveWkts]);
  ok("both wicket-takers appear regardless of sample size", takers.length === 2);
  ok("more wickets ranks first", takers[0].id === "five");
}

group("A player with nothing this season is on neither list");
{
  const nobody = player({ id: "nobody" });
  ok("not a run-scorer", topRunScorers([nobody]).length === 0);
  ok("not a wicket-taker", topWicketTakers([nobody]).length === 0);
  ok("not on the batting index table", bestBattingAverages([nobody]).length === 0);
  ok("not on the bowling index table", bestBowlingEconomies([nobody]).length === 0);
  ok("not on the MVP table", mvpRanking([nobody]).length === 0);
}

group("mvpScore: never a blend with a zero for the missing half");
{
  ok("neither index — no score", mvpScore({ batting: { value: null }, bowling: { value: null } }) === null);
  ok("batting only — the rating IS the batting index, not halved",
     mvpScore({ batting: { value: 14 }, bowling: { value: null } }) === 14);
  ok("bowling only — the rating IS the bowling index", mvpScore({ batting: { value: null }, bowling: { value: 16 } }) === 16);
  ok("both — the mean of the two, on the same 1-20 scale as either alone",
     mvpScore({ batting: { value: 10 }, bowling: { value: 16 } }) === 13);
}

group("MVP ranking: an all-rounder with both disciplines proven, a specialist with one");
{
  const allrounder = player({ id: "ar", runs: 40, ballsFaced: MIN_BALLS_FACED, dismissals: 1,
    wkts: 3, ballsBowled: MIN_BALLS_BOWLED, runsConceded: 24 });
  const batOnly = player({ id: "bat", runs: 60, ballsFaced: MIN_BALLS_FACED + 10, dismissals: 1 });
  const ranked = mvpRanking([allrounder, batOnly]);
  ok("both make the table — each cleared at least one floor", ranked.length === 2, ranked);
  ok("every entry carries a real, non-null score", ranked.every((r) => Number.isFinite(r.score)), ranked);
}

group("Scoped by team and by school — the same rows, narrowed for the caller");
{
  const a = player({ id: "a", team: "1XI", school: "HIL", runs: 50 });
  const b = player({ id: "b", team: "2XI", school: "HIL", runs: 80 });
  const c = player({ id: "c", team: "1XI", school: "WES", runs: 99 });
  ok("team scoping keeps only that team", topRunScorers([a, b, c], { team: "1XI" }).every((p) => p.team === "1XI"));
  ok("...across schools, when no school is named", topRunScorers([a, b, c], { team: "1XI" }).length === 2);
  ok("school scoping keeps only that school", topRunScorers([a, b, c], { school: "HIL" }).every((p) => p.school === "HIL"));
  ok("team and school together narrow to one", topRunScorers([a, b, c], { team: "1XI", school: "HIL" }).length === 1);
}

console.log("\n" + "─".repeat(52));
console.log(`SEASON AWARDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
