/**
 * The team vocabulary, and the sport it is supposed to describe.
 *
 * This exists because the codebase was wrong about the sport. It carried U19A
 * everywhere — in the seed, in nineteen views, in every smoke test — and South
 * African schools do not field a U19 side. Above U16 a schoolboy is in the OPEN
 * category and the team is the 1st XI.
 *
 * A team code is a scope anchor, compared for equality on every authorization
 * decision, so a closed vocabulary is not tidiness — an anchor nobody can
 * enumerate is one nobody can audit.
 */
import {
  parseTeam, isValidTeam, teamLabel, compareTeams, isEligible,
  teamsForLevel, teamCodeCheck, AGE_GROUPS, LEVELS,
  ageAtCutoff, cutoffFor, CUTOFF_MONTH, CUTOFF_DAY,
  seasonYearFor, seasonLabel, SEASON_SPANS_NEW_YEAR, SEASON_START_MONTH,
} from "../src/teams.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

// ── A. Schools stop at U16 ───────────────────────────────
group("A. A school has no U17, U18 or U19");
for (const bad of ["U17A", "U18A", "U19A", "U19"])
  ok(`${bad} is not a school team`, isValidTeam(bad, "school") === false);
for (const good of ["U9A", "U13B", "U16A", "U16"])
  ok(`${good} is a school team`, isValidTeam(good, "school") === true);
ok("U8 is below the youngest band", isValidTeam("U8A", "school") === false);
ok("the school bands are U9 to U16",
   AGE_GROUPS.school[0] === 9 && AGE_GROUPS.school[AGE_GROUPS.school.length - 1] === 16);

// ── B. Over 16 is OPEN, named by rank ────────────────────
group("B. Above the age groups, teams are ranked");
ok("1XI is a school team", isValidTeam("1XI", "school") === true);
ok("...and reads as 1st XI", teamLabel("1XI") === "1st XI");
ok("2XI reads as 2nd XI", teamLabel("2XI") === "2nd XI");
ok("3XI reads as 3rd XI", teamLabel("3XI") === "3rd XI");
ok("4XI reads as 4th XI", teamLabel("4XI") === "4th XI");
ok("11XI reads as 11th XI, not 11st", teamLabel("11XI") === "11th XI");
ok("an open team has a rank and no age", parseTeam("2XI").rank === 2 && parseTeam("2XI").age === null);
ok("an age team has an age and no rank", parseTeam("U14B").age === 14 && parseTeam("U14B").rank === null);
ok("...and carries its division", parseTeam("U14B").division === "B");
ok("a division is optional", parseTeam("U14").division === null);

// ── C. Representative cricket DOES have U19 ──────────────
group("C. Provincial and national select on age");
ok("U19 is a provincial team", isValidTeam("U19A", "provincial") === true);
ok("...and a national one", isValidTeam("U19A", "national") === true);
ok("...and still not a school one", isValidTeam("U19A", "school") === false);
ok("a province fields no 1st XI", isValidTeam("1XI", "provincial") === false);
// The case that has to be representable: a boy in his school's 1st XI who is
// also picked for a provincial U19 side. Both are true in the same season.
ok("both can be valid at once, at their own levels",
   isValidTeam("1XI", "school") && isValidTeam("U19A", "provincial"));
ok("every level is named", LEVELS.length === 4 && LEVELS.includes("club"));

// ── D. Nonsense is refused ───────────────────────────────
group("D. The vocabulary is closed");
for (const junk of ["", "  ", "First XI", "1st XI", "U16Z", "0XI", "21XI", "XI", "U", null, 42, {}])
  ok(`${JSON.stringify(junk)} does not parse`, parseTeam(junk) === null);
ok("the SQL check accepts a real code",
   new RegExp(teamCodeCheck("t").match(/'\^(.*)\$'/)[0].slice(1, -1)).test("U14A"));
ok("...and rejects U19 shaped like a school team is not its job",
   /U\(9\|10\|11\|12\|13\|14\|15\|16\|17\|18\|19\)/.test(teamCodeCheck("t")));

// ── E. Reading order ─────────────────────────────────────
group("E. Sorted the way a team sheet is read");
{
  const order = ["U13A", "1XI", "U16A", "2XI", "U16B", "U9A"].sort(compareTeams);
  ok("open sides come first", order[0] === "1XI" && order[1] === "2XI");
  ok("then age groups, oldest first", order[2] === "U16A" && order[3] === "U16B");
  ok("...down to the youngest", order[order.length - 1] === "U9A");
  ok("an unparseable code sorts last, not first",
     ["U13A", "rubbish", "1XI"].sort(compareTeams)[2] === "rubbish");
}

// ── F. Eligibility is an upper bound ─────────────────────
group("F. U14 means fourteen AND UNDER");
ok("a fourteen-year-old plays U14", isEligible(14, "U14A") === true);
ok("a twelve-year-old may play up", isEligible(12, "U14A") === true);
ok("a fifteen-year-old may not play down", isEligible(15, "U14A") === false);
ok("an open team has no age limit", isEligible(19, "1XI") === true);
// born is masked behind player.pii.read. A caller who may not read a date of
// birth must not be handed an eligibility answer computed from one.
ok("an unknown age answers null, not false", isEligible(null, "U14A") === null);
ok("an unparseable team answers null", isEligible(14, "rubbish") === null);

// ── F2. The cut-off, and the calendar it depends on ──────
//
// Age is measured at 1 JANUARY of the year of the match. That is confirmed
// convention, and this block exists because the rule is only safe given a fact
// about the South African school calendar that is nowhere in the code:
//
//   THE SCHOOL YEAR IS THE CALENDAR YEAR. Four terms, January to December.
//   Cricket is played in Term 1 (Jan–Mar) and Term 4 (Oct–Dec) OF THE SAME
//   SCHOOL YEAR.
//
// So `the year of the match` and `the school year` are the same number, and a
// side cannot change age band part-way through a season. In a country whose
// season runs September to March the identical code would be wrong, and wrong
// in the dangerous direction — every boy a year younger than he is for the
// first half of the season.
//
// None of this was tested. The function the whole eligibility rule lives in
// had no unit test at all; the only coverage was the database trigger, which
// derives the same date by a different route and could have agreed with it
// while both were wrong.
group("F2. Age is measured at 1 January of the school year");
{
  const born = (s) => new Date(s + "T00:00:00Z");
  const on   = (s) => new Date(s + "T00:00:00Z");

  ok("the cut-off is the first of January",
     CUTOFF_MONTH === 1 && CUTOFF_DAY === 1);
  ok("cutoffFor names that date in the given year",
     cutoffFor(2026).toISOString().startsWith("2026-01-01"));

  // A boy who turns 14 in March is 13 on 1 January and plays U13 all year —
  // in Term 1 BEFORE the birthday and in Term 4 after it. Two terms, one
  // school year, one answer.
  ok("Term 1, before the birthday: 13",
     ageAtCutoff(born("2012-03-15"), on("2026-02-14")) === 13);
  ok("Term 4, after the birthday: still 13",
     ageAtCutoff(born("2012-03-15"), on("2026-10-10")) === 13);
  ok("...so he is U13-eligible in both terms",
     isEligible(ageAtCutoff(born("2012-03-15"), on("2026-02-14")), "U13A") === true &&
     isEligible(ageAtCutoff(born("2012-03-15"), on("2026-10-10")), "U13A") === true);

  // The band DOES change between school years, and that is the point of the
  // thirty-day notice: Term 4 of one year and Term 1 of the next are different
  // age groups, so the U14 coaches must have seen him before December.
  ok("the next school year moves him up",
     ageAtCutoff(born("2012-03-15"), on("2027-02-14")) === 14);
  ok("...and out of the side he was in",
     isEligible(ageAtCutoff(born("2012-03-15"), on("2027-02-14")), "U13A") === false);

  // The boundaries of the cut-off itself.
  ok("born ON the cut-off is that age exactly",
     ageAtCutoff(born("2013-01-01"), on("2026-06-01")) === 13);
  ok("born the day after is a year younger",
     ageAtCutoff(born("2013-01-02"), on("2026-06-01")) === 12);
  ok("born the day before is a year older",
     ageAtCutoff(born("2012-12-31"), on("2026-06-01")) === 13);

  // born is masked behind player.age.read. A caller without it gets NULL and
  // must not be handed an age derived from nothing.
  ok("an unknown date of birth answers null", ageAtCutoff(null, on("2026-06-01")) === null);
  ok("an unparseable date of birth answers null",
     ageAtCutoff(born("not-a-date"), on("2026-06-01")) === null);
  ok("an unparseable match date answers null",
     ageAtCutoff(born("2012-03-15"), new Date("rubbish")) === null);
}

// ── F3. A club season is named for two years, and keeps time differently ──
//
// Above school level the season is the southern summer — spring through
// autumn, "the 2025/26 season" — and winter belongs to northern tours and
// county cricket. Such a season straddles 1 January, so the year of the match
// is NOT the year of the season, and taking one for the other is wrong in the
// direction that matters: every player computes a year young from September to
// December, and a fourteen-year-old passes an under-13 check in October.
//
// The same fixture dates therefore give different answers at different levels,
// and that is correct rather than a contradiction. Both are asserted here
// against each other, because a rule that is right at one level and silently
// applied at another is the failure this whole block exists to catch.
group("F3. Above school, the season straddles the new year");
{
  const born = (s) => new Date(s + "T00:00:00Z");
  const on   = (s) => new Date(s + "T00:00:00Z");
  const B = born("2011-03-15");             // turns 15 in March 2026

  ok("school seasons do not straddle", SEASON_SPANS_NEW_YEAR.school === false);
  ok("club, provincial and national seasons do",
     SEASON_SPANS_NEW_YEAR.club && SEASON_SPANS_NEW_YEAR.provincial &&
     SEASON_SPANS_NEW_YEAR.national);
  // The boundary must sit in the off-season or it splits a fixture list.
  ok("the season boundary is in midwinter", SEASON_START_MONTH === 7);

  // October and February are ONE club season and answer to one 1 January.
  ok("a spring fixture belongs to the season that ends next year",
     seasonYearFor(on("2025-10-10"), "club") === 2026);
  ok("...and a summer fixture in the new year to the same season",
     seasonYearFor(on("2026-02-14"), "club") === 2026);
  ok("...which is written the way people say it",
     seasonLabel(on("2025-10-10"), "club") === "2025/26" &&
     seasonLabel(on("2026-02-14"), "club") === "2025/26");
  ok("a club player is the same age all season",
     ageAtCutoff(B, on("2025-10-10"), "club") === 14 &&
     ageAtCutoff(B, on("2026-02-14"), "club") === 14);

  // The SAME two dates at school level are two different school years, and the
  // boy is genuinely a different age in each.
  ok("a school season is named for one year",
     seasonLabel(on("2025-10-10"), "school") === "2025" &&
     seasonLabel(on("2026-02-14"), "school") === "2026");
  ok("...so the same dates split across two school years",
     ageAtCutoff(B, on("2025-10-10"), "school") === 13 &&
     ageAtCutoff(B, on("2026-02-14"), "school") === 14);
  // Which is the point: the two levels disagree, on purpose.
  ok("the levels disagree about October, and must",
     ageAtCutoff(B, on("2025-10-10"), "school") !==
     ageAtCutoff(B, on("2025-10-10"), "club"));

  // The direction of the error, if a school rule were used for a club season.
  ok("the school rule would let a 14-year-old pass an under-13 check in spring",
     isEligible(ageAtCutoff(B, on("2025-10-10"), "school"), "U13A") === true &&
     isEligible(ageAtCutoff(B, on("2025-10-10"), "club"),   "U13A") === false);

  // A winter date is off-season, and falls to the season just ended.
  ok("a June date belongs to the season ending that year",
     seasonLabel(on("2026-06-01"), "club") === "2025/26");
  ok("a July date has turned over to the next",
     seasonLabel(on("2026-07-01"), "club") === "2026/27");

  ok("an unparseable date has no season", seasonYearFor(new Date("rubbish"), "club") === null);
  ok("...and no age", ageAtCutoff(B, new Date("rubbish"), "club") === null);
}

// ── G. Enumerating a level ───────────────────────────────
group("G. What a level may field");
{
  const school = teamsForLevel("school", { divisions: ["A", "B"], openSides: 2 });
  ok("open sides lead", school[0] === "1XI" && school[1] === "2XI");
  ok("age groups follow, oldest first", school[2] === "U16A");
  ok("no U17 or above appears", school.every((c) => !/^U1[789]/.test(c)));
  ok("every code it lists is valid at that level",
     school.every((c) => isValidTeam(c, "school")));

  const prov = teamsForLevel("provincial", { divisions: ["A"], openSides: 3 });
  ok("a province lists no open sides", prov.every((c) => !/XI$/.test(c)));
  ok("...and does list U19", prov.includes("U19A"));
}

console.log(`\n${"─".repeat(52)}\nTEAMS SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
