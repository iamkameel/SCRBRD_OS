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
  ALL_SEASONS, awardSeasons, bestBattingAverages, bestBowlingEconomies, defaultAwardSeason, mvpRanking, mvpScore,
  playersForSeason, topRunScorers, topWicketTakers,
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

// ── SCRBRD-086: one season at a time ─────────────────────────────
// A row of career_by_season, in the shape asSeasonCareer() (lib/live.js)
// returns: a career line plus the season the server filed it under.
const seasonRow = (over) => ({ ...player(over), season: "2026", currentSeason: false, ...over });

group("awardSeasons: the seasons the read has figures for, newest first, and which is current");
{
  const rows = [
    seasonRow({ id: "a", season: "2025" }), seasonRow({ id: "b", season: "2026", currentSeason: true }),
    seasonRow({ id: "a", season: "2026", currentSeason: true }), seasonRow({ id: "c", season: "2024" }),
  ];
  const { seasons, current } = awardSeasons(rows);
  ok("each season once, newest first", JSON.stringify(seasons) === JSON.stringify(["2026", "2025", "2024"]), seasons);
  ok("the current season is the one the server marked", current === "2026", current);
  ok("no rows: no seasons and no current one — nothing is invented",
     JSON.stringify(awardSeasons([])) === JSON.stringify({ seasons: [], current: null }));
  ok("a season with no label is never offered",
     awardSeasons([seasonRow({ id: "x", season: null }), seasonRow({ id: "y", season: "" })]).seasons.length === 0);
  ok("no row in the current season: current is null, not a guess from the clock",
     awardSeasons([seasonRow({ id: "a", season: "2025" })]).current === null);
}

group("defaultAwardSeason: the current season when it has figures, else the latest that does");
{
  ok("the current season, when it is on the list", defaultAwardSeason({ seasons: ["2026", "2025"], current: "2026" }) === "2026");
  ok("never an older season over the current one", defaultAwardSeason({ seasons: ["2027", "2026"], current: "2026" }) === "2026");
  ok("the first week of January: last season, not an empty page",
     defaultAwardSeason({ seasons: ["2025", "2024"], current: null }) === "2025");
  ok("nothing on record at all: every season (the career read, as before)",
     defaultAwardSeason({ seasons: [], current: null }) === ALL_SEASONS);
}

group("playersForSeason: one season's rows, and nothing from another");
{
  // The all-seasons merge (usePlayersWithCareer): career figures laid over
  // the player row. A season row must replace every figure, not add to it.
  const players = [
    { id: "a", name: "A Batter", schoolName: "Hilton", team: "1XI", school: "HIL", runs: 500, ballsFaced: 400, dismissals: 9, avg: 55.56, wkts: 4, ballsBowled: 60, runsConceded: 50, econ: 5 },
    { id: "b", name: "B Bowler", schoolName: "Hilton", team: "1XI", school: "HIL", runs: 10, ballsFaced: 12, dismissals: 2, avg: 5, wkts: 30, ballsBowled: 300, runsConceded: 250, econ: 5 },
  ];
  const rows = [
    seasonRow({ id: "a", name: "A Batter", season: "2026", runs: 120, ballsFaced: 90, dismissals: 2, avg: 60, wkts: 0, ballsBowled: 0, runsConceded: 0, econ: null }),
    seasonRow({ id: "a", name: "A Batter", season: "2025", runs: 380, ballsFaced: 310, dismissals: 7 }),
    seasonRow({ id: "z", name: "Z Only In The Season Read", season: "2026", runs: 5, ballsFaced: 3 }),
  ];
  const s2026 = playersForSeason(players, rows, "2026");
  const a = s2026.find((p) => p.id === "a");
  ok("the season's figures, not the career's", a?.runs === 120 && a?.ballsFaced === 90 && a?.dismissals === 2 && a?.wkts === 0, a);
  ok("...with the player row's own fields kept", a?.schoolName === "Hilton" && a?.name === "A Batter");
  ok("a player with no figures this season is not in it at all", !s2026.some((p) => p.id === "b"), s2026.map((p) => p.id));
  ok("a season row whose player row has not loaded is still ranked, under its own name",
     s2026.some((p) => p.id === "z" && p.name === "Z Only In The Season Read"));
  ok("the other season is its own", playersForSeason(players, rows, "2025").map((p) => p.runs).join() === "380");
  ok("a season nobody played in is empty", playersForSeason(players, rows, "2019").length === 0);
}

group("The floor applies per season: enough balls in total is not enough in either season");
{
  // Twenty balls a season: below MIN_BALLS_FACED (30) in each, above it in total.
  const half = MIN_BALLS_FACED - 10;
  const rows = [
    seasonRow({ id: "split", season: "2025", runs: 20, ballsFaced: half, dismissals: 1 }),
    seasonRow({ id: "split", season: "2026", runs: 20, ballsFaced: half, dismissals: 1 }),
  ];
  const career = [player({ id: "split", runs: 40, ballsFaced: 2 * half, dismissals: 2 })];
  ok("absent from the 2025 batting index", bestBattingAverages(playersForSeason(career, rows, "2025")).length === 0);
  ok("absent from the 2026 batting index", bestBattingAverages(playersForSeason(career, rows, "2026")).length === 0);
  ok("...present across every season, where his balls add up", bestBattingAverages(career).length === 1);
  ok("still a real score on each season's run-scorers list", topRunScorers(playersForSeason(career, rows, "2026")).length === 1);
}

console.log("\n" + "─".repeat(52));
console.log(`SEASON AWARDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
