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
