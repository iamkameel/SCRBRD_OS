/**
 * The league wizard's and the fixture planner's words (SCRBRD-123, SCRBRD-127;
 * lib/league.js): an entrant's standing, where a checklist row stands, the rules
 * a person types turned into what the API takes, a plan grouped for its two
 * views, the locks a click makes, a publishing outcome and a refusal in plain
 * words. The screens are walked in a browser (tools/smoke-browser-league.mjs);
 * the rules are the database's and the API's and are not repeated here.
 *
 *   node apps/web/test/league.test.mjs
 */
import {
  LEAGUE_FORMATS, RULE_FIELDS, addDays, bracketRounds, checklistCounts, entrantCounts, entrantSummary, entrantWords, figureKind,
  formOfRules, instantOf, leagueRefusal, outcomeWords, planGroups, refusedWords, resumeStep, rulesOfForm, saDay, saTime, saToday,
  sideWords, slotId, slotWords, startOfDay, toggledLocks,
} from "../src/lib/league.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

group("South African days and times");
ok("an instant's day is the South African day (UTC+2)", saDay("2026-10-01T22:30:00Z") === "2026-10-02" && saDay("2026-10-01T21:59:00Z") === "2026-10-01");
ok("...and its clock time", saTime("2026-10-01T07:00:00Z") === "09:00" && saTime("2026-10-01T22:30:00+00:00") === "00:30");
ok("a value that is not an instant is nothing", saDay("soon") === "" && saTime(null) === "" && saDay(undefined) === "");
ok("today is this device's South African day", saToday(Date.parse("2026-09-30T23:00:00Z")) === "2026-10-01");
ok("days are added across a month end", addDays("2026-09-30", 1) === "2026-10-01" && addDays("2026-03-01", -1) === "2026-02-28");
ok("a slot in words", slotWords("2026-10-10T07:00:00Z", "2026-10-10T11:00:00Z") === "Sat, 10 Oct, 09:00 to 13:00" || /10 Oct, 09:00 to 13:00/.test(slotWords("2026-10-10T07:00:00Z", "2026-10-10T11:00:00Z")), slotWords("2026-10-10T07:00:00Z", "2026-10-10T11:00:00Z"));
ok("...and one across two days", /to .*11 Oct/.test(slotWords("2026-10-10T20:00:00Z", "2026-10-11T08:00:00Z")), slotWords("2026-10-10T20:00:00Z", "2026-10-11T08:00:00Z"));
ok("a day and a time make an instant with its offset", instantOf("2026-10-10", "09:00") === "2026-10-10T09:00:00+02:00" && startOfDay("2026-10-10") === "2026-10-10T00:00:00+02:00");

group("An entrant's standing");
ok("an invited side waits for its school, and the organiser cannot accept for it",
   /Waiting for the school/.test(entrantWords({ status: "invited" })) && /cannot accept on its behalf/.test(entrantWords({ status: "invited" })));
ok("...and the school is told it is waiting for its own answer", entrantWords({ status: "invited" }, false) === "Waiting for your answer.");
ok("an accepted side will be drawn", /drawn/.test(entrantWords({ status: "accepted" })));
ok("a declined side may be invited again, to the organiser", /invite it again/.test(entrantWords({ status: "declined" })));
const E = [{ status: "accepted" }, { status: "accepted" }, { status: "accepted" }, { status: "declined" }];
ok("the counts", JSON.stringify(entrantCounts(E)) === '{"invited":0,"accepted":3,"declined":1}');
ok("the summary", entrantSummary(E) === "3 accepted, 1 declined, 0 waiting");

group("Where the wizard picks up");
ok("no entrants: step 2", resumeStep({ entrants: 0, sets: [] }) === 2);
ok("entrants and no conditions: step 3", resumeStep({ entrants: 4, sets: [] }) === 3);
ok("a draft open: step 3", resumeStep({ entrants: 4, sets: [{ status: "draft" }] }) === 3);
ok("published: step 4", resumeStep({ entrants: 4, sets: [{ status: "published" }] }) === 4);

group("A checklist row");
ok("nothing entered is none", figureKind(undefined) === "none");
ok("what \"start from defaults\" filled in is a default",
   figureKind({ status: "unconfirmed", sourceNote: "Platform default: what every reader applies when a league sets nothing." }) === "default"
   && figureKind({ status: "unconfirmed", sourceNote: "Platform fast-bowling directive (rulebook PACE-U13): ..." }) === "default"
   && figureKind({ status: "unconfirmed", sourceNote: "From the competition's format (T20)." }) === "default");
ok("a copied figure is copied, citation or not", figureKind({ status: "confirmed", sourceNote: "Copied from KZN T20, version 1" }) === "copied"
   && figureKind({ status: "unconfirmed", sourceNote: "Copied from KZN T20, version 1" }) === "copied");
ok("a confirmed figure is the league's own, even with a default's note", figureKind({ status: "confirmed", sourceNote: "Platform default: x" }) === "own");
ok("a figure with its own words is own", figureKind({ status: "unconfirmed", sourceNote: "Agreed at the AGM" }) === "own" && figureKind({ status: "unconfirmed", sourceNote: null }) === "own");
ok("a row's id follows its band", slotId("bowling.limit", "U13") === "bowling.limit|U13" && slotId("points.win", null) === "points.win");
const slots = [{ key: "a", band: null }, { key: "b", band: null }, { key: "c", band: null }, { key: "d", band: "U13" }, { key: "e", band: null }];
const values = [
  { key: "a", ageBand: null, status: "confirmed", sourceNote: null },
  { key: "b", ageBand: null, status: "unconfirmed", sourceNote: "Platform default: x" },
  { key: "c", ageBand: null, status: "unconfirmed", sourceNote: "mine" },
  { key: "d", ageBand: "U13", status: "unconfirmed", sourceNote: "Platform default: x" },
];
const counts = checklistCounts(slots, values, new Set(["b"]));
ok("the review counts confirmed, own, ticked and unchecked", JSON.stringify(counts) === '{"total":5,"confirmed":1,"own":1,"ticked":1,"unchecked":2}', JSON.stringify(counts));
ok("a ticked default with nothing entered counts as ticked", checklistCounts([{ key: "z", band: null }], [], new Set(["z"])).ticked === 1);

group("The rules she types");
ok("blanks are left out and whole numbers sent", JSON.stringify(rulesOfForm({ durationMinutes: " 180 ", restMinutes: "", maxPerDay: "2" }).rules) === '{"durationMinutes":180,"maxPerDay":2}');
ok("a figure that is not a whole number is refused in words", /Match length: type a whole number of minutes/.test(rulesOfForm({ durationMinutes: "3h" }).problem ?? ""));
ok("a negative number is not a whole number", !!rulesOfForm({ restMinutes: "-5" }).problem);
ok("the form takes a plan's rules back", formOfRules({ durationMinutes: 180, restMinutes: null }).durationMinutes === "180" && formOfRules({ durationMinutes: 180, restMinutes: null }).restMinutes === "");
ok("every rule has a label, a unit and the engine's range", RULE_FIELDS.length === 6 && RULE_FIELDS.every((r) => r.label && r.unit && r.max > r.min - 1));
ok("the formats are the league route's four", LEAGUE_FORMATS.map((f) => f.value).join("|") === "T20|One-Day|One-Day Declaration|Two-Day");

group("A plan in two views");
const side = (id, name) => ({ entrantId: id, name });
const plan = { fixtures: [
  { id: "ko:r1:m1", round: 1, match: 1, home: side("a", "Hilton"), away: side("b", "Westville"), startsAt: "2026-10-10T07:00:00Z", endsAt: "2026-10-10T10:00:00Z" },
  { id: "ko:r1:m2", round: 1, match: 2, home: side("c", "Kearsney"), away: side("d", "Maritzburg"), startsAt: "2026-10-03T07:00:00Z", endsAt: "2026-10-03T10:00:00Z" },
  { id: "ko:r2:m1", round: 2, match: 1, home: { winnerOf: "ko:r1:m1" }, away: { winnerOf: "ko:r1:m2" }, startsAt: null, endsAt: null },
] };
ok("a side is its name", sideWords(plan.fixtures[0].home, plan) === "Hilton");
ok("a later round's side is \"Winner of R1 · Match 2\"", sideWords(plan.fixtures[2].away, plan) === "Winner of R1 · Match 2" && sideWords(plan.fixtures[2].home, plan) === "Winner of R1 · Match 1");
ok("a winner of a fixture not in the draw is still worded", sideWords({ winnerOf: "x" }, plan) === "Winner of an earlier match");
const byRound = planGroups(plan, "round");
ok("by round: round 1 then round 2, time order within", byRound.map((g) => g.title).join("|") === "Round 1|Round 2" && byRound[0].fixtures[0].id === "ko:r1:m2");
const byDay = planGroups(plan, "day");
ok("by day: the days in order, then those with no slot", byDay.map((g) => g.key).join("|") === "2026-10-03|2026-10-10|none" && byDay[2].title === "No slot", byDay.map((g) => g.key).join("|"));
const br = bracketRounds(plan);
ok("the bracket: rounds left to right, the last a final, the one before it the semi-finals", br.length === 2 && br[1].title === "Final" && br[0].title === "Semi-finals" && br[0].fixtures.length === 2);
ok("eight sides: quarter-finals, semi-finals, final", bracketRounds({ fixtures: [{ round: 1, match: 1 }, { round: 2, match: 1 }, { round: 3, match: 1 }] }).map((r) => r.title).join("|") === "Quarter-finals|Semi-finals|Final");

group("Locks");
const locks = [{ fixtureId: "a", windowId: "w1" }];
ok("locking adds the fixture with its window", JSON.stringify(toggledLocks(locks, { id: "b", windowId: "w2", locked: false })) === '[{"fixtureId":"a","windowId":"w1"},{"fixtureId":"b","windowId":"w2"}]');
ok("unlocking takes it off and keeps the others", JSON.stringify(toggledLocks(locks, { id: "a", windowId: "w1", locked: true })) === "[]");
ok("a fixture with no window cannot be locked", toggledLocks(locks, { id: "c", windowId: null, locked: false }).length === 1);

group("Publishing, fixture by fixture");
ok("created says when", /A match was made for .*10 Oct/.test(outcomeWords({ outcome: "created", startsAt: "2026-10-10T07:00:00Z" })));
ok("...and that the opponent's school sees it", /opponent's school sees it too/.test(outcomeWords({ outcome: "created", startsAt: "2026-10-10T07:00:00Z", sharedWithOpponent: true })));
ok("already says nothing was made twice", /Nothing was made twice/.test(outcomeWords({ outcome: "already" })));
ok("held says why", outcomeWords({ outcome: "held", text: "A side is the winner of an earlier match, not yet known." }) === "A side is the winner of an earlier match, not yet known.");
ok("a clash is worded with the engine's reasons", /no longer fits/.test(refusedWords({ error: "clash", reasons: [{ code: "rest", text: "A side would not have its rest." }] })) && /would not have its rest/.test(refusedWords({ error: "clash", reasons: [{ code: "rest", text: "A side would not have its rest." }] })));
ok("a withdrawn window", /withdrew the slot/.test(refusedWords({ error: "window_withdrawn" })));
ok("an invalid fixture carries the route's own detail", /a side that has not entered/i.test(refusedWords({ error: "invalid_fixture", detail: "a side that has not entered" })));
ok("a refusal nobody worded still names its code", /weird_code/.test(refusedWords({ error: "weird_code" })));

group("A refusal, in words");
const e = (code, extra = {}) => ({ code, status: 422, ...extra });
ok("the organiser cannot invite for a school that is not there", /could not be found/.test(leagueRefusal(e("school_invalid"))));
ok("a team that is not a team says what a team is", /1XI to 20XI/.test(leagueRefusal(e("team_invalid"))));
ok("an answered invitation", /already been answered/.test(leagueRefusal(e("not_invited", { detail: "accepted" }))));
ok("a start today: tomorrow or later", /Choose tomorrow or later/.test(leagueRefusal(e("effective_from_not_future"))));
ok("nothing to copy", /nothing to copy/.test(leagueRefusal(e("source_has_no_conditions"))));
ok("the planner's own words for its inputs", leagueRefusal(e("plan_input_invalid", { detail: "rest is at most 14 days" })) === "The planner cannot use these inputs: rest is at most 14 days.");
ok("a draft only", /This one is published/.test(leagueRefusal(e("not_a_draft", { detail: "published" }))));
ok("too few entrants", /at least two/.test(leagueRefusal(e("too_few_entrants"))));
ok("a code from another screen goes to its words", leagueRefusal(e("citation_required"), () => "cited") === "cited");
ok("a code nobody worded names itself", /weird_code/.test(leagueRefusal(e("weird_code"))));
ok("no answer at all", /Could not reach the server/.test(leagueRefusal(new Error("offline"))));

console.log(`\n${"─".repeat(52)}\nLEAGUE WORDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
