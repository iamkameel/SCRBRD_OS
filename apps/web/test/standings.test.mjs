/**
 * The league table's words and choices (SCRBRD-114 phase 3a; lib/standings.js):
 * a refusal in words for every reason db/69 gives; net run rate to three
 * places; points whole or to a tenth; the over-rate sheet offered only where
 * the league counts over-rate penalties in points; the decisions a match may
 * take. Pure: no DOM, no database.
 */
import {
  RESULTS_REFUSAL, resultsRefusal, nrrText, pointsText, basisWords, orderWords, adjustmentKinds, overRateWords,
  decisionChoices, decisionWords,
} from "../src/lib/standings.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

group("Every refusal db/69 and the results routes give is said in words");
for (const code of ["not_permitted", "support_session", "kind_invalid", "side_invalid", "reason_required", "note_required",
                    "override_not_award", "needs_play", "already_decided", "already_withdrawn", "points_invalid",
                    "entrant_invalid", "match_invalid", "no_document", "set_invalid"]) {
  ok(code, typeof RESULTS_REFUSAL[code] === "string" && resultsRefusal({ code, status: 422 }) === RESULTS_REFUSAL[code]);
}
ok("over_rate_not_points says the server's own words",
   resultsRefusal({ code: "over_rate_not_points", status: 422, detail: "this competition has no over-rate penalties" })
   === "This competition has no over-rate penalties.");
ok("an unknown refusal names its code", resultsRefusal({ code: "mystery", status: 422 }) === "Not changed. The server said mystery.");
ok("no server: nothing was changed", resultsRefusal(new Error("fetch failed")) === "Could not reach the server. Nothing was changed.");

group("Figures as a table prints them");
ok("net run rate to three places, signed", nrrText(1.25) === "+1.250" && nrrText(-0.0666851) === "−0.067" && nrrText(0) === "0.000");
ok("...a dash when there is none", nrrText(null) === "—" && nrrText(undefined) === "—");
ok("points whole where whole, else to a tenth", pointsText(8) === "8" && pointsText(9.5) === "9.5" && pointsText(null) === "—");

group("What the table stands on, and how it is ranked");
ok("computed and entered say which", /confirmed points/.test(basisWords("computed")) && /not confirmed yet/.test(basisWords("entered")));
ok("the order in words", orderWords(["points", "wins", "nrr"]) === "Ranked by points, then wins, then net run rate. Sides level on every one share a place.");
ok("head-to-head is said as not applied (D13)", /head-to-head \(not applied\)/.test(orderWords(["points", "head_to_head"])));

group("The adjustment sheet: over rate only where the league counts it in points");
ok("points: over rate offered first", adjustmentKinds("points")[0].value === "over_rate" && adjustmentKinds("points").length === 4);
ok("none or runs: not offered", !adjustmentKinds("none").some((k) => k.value === "over_rate") && !adjustmentKinds("runs").some((k) => k.value === "over_rate"));
ok("runs: said to be the scorer's, on the pad", /penalty runs on the pad/.test(overRateWords("runs")) && overRateWords("none") === "");

group("The decision sheet");
const played = decisionChoices({ playOutcome: "home_win" }, true);
ok("a played match offers all three, and an award may set play aside", played.kinds.map((k) => k.value).join() === "conceded,walkover,awarded" && played.overridable);
const unplayed = decisionChoices({ playOutcome: "in_progress" }, false);
ok("no ball bowled: a concession or a walkover, never an award", unplayed.kinds.map((k) => k.value).join() === "conceded,walkover" && !unplayed.overridable);
ok("a tie: nothing to set aside", decisionChoices({ playOutcome: "tie" }, true).overridable === false);
const names = { home: "Hilton College 1XI", away: "Westville Boys' High 1XI" };
ok("a decision in words", decisionWords({ kind: "conceded", side: "away" }, names) === "Westville Boys' High 1XI conceded."
   && decisionWords({ kind: "walkover", side: "home" }, names) === "Walkover to Hilton College 1XI."
   && decisionWords({ kind: "awarded", side: "away", overridesPlay: true }, names) === "Awarded to Westville Boys' High 1XI by the organiser, setting aside the result played.");

console.log(`\n${"─".repeat(52)}\nSTANDINGS SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
