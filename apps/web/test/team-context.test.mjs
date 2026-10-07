/**
 * The right side by default, and one set of roles for the screen and the menu
 * (GA-I07).
 *
 * Squad and Analytics opened on "1XI" and filtered by it, so a U15A coach saw
 * an empty roster; Analytics offered a fixed 1XI / U15A / U13A whatever the
 * person had. The Dashboard and Skills gates asked about the one badge role
 * while the menu was drawn from every role held.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/team-context.test.mjs
 */
import { readFileSync } from "node:fs";
import { pickTeam, teamsOf } from "../src/lib/teamContext.js";
import { holdsAsHeld } from "../src/lib/held.js";
import { holdsCapability } from "../src/rbac/index.js";
import { navForRoles } from "../src/design/roles.js";
import { NAV_CAPABILITY } from "../src/design/roles.js";
import { roleGrants } from "@scrbrd/policy/roles";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const rows = (...teams) => teams.map((team, i) => ({ id: `p${i}`, team }));

group("The teams on offer are the rows' own, in team-sheet order");
ok("a U15A-only roster offers U15A, not 1XI / U15A / U13A", teamsOf(rows("U15A", "U15A")).join() === "U15A");
ok("1st XI first, then the age groups from the oldest down, then a division", teamsOf(rows("U13A", "U16B", "1XI", "U16A", "2XI")).join() === "1XI,2XI,U16A,U16B,U13A");
ok("a side outside the old three is offered", teamsOf(rows("U16B")).join() === "U16B");
ok("no rows, no sides; a row with no team adds none", teamsOf([]).length === 0 && teamsOf(null).length === 0 && teamsOf([{ id: "x", team: null }]).length === 0);

group("The side to open on");
ok("a coach who holds U15A opens on U15A, with players in it", pickTeam({ teams: ["U15A"], held: ["U15A"] }) === "U15A");
ok("...even when the rows are wider than his assignment", pickTeam({ teams: ["1XI", "U15A"], held: ["U15A"] }) === "U15A");
ok("a U16B coach does not land on 1XI", pickTeam({ teams: ["1XI", "U16B"], held: ["U16B"] }) === "U16B");
ok("the first held team that the rows contain", pickTeam({ teams: ["1XI", "U16B"], held: ["U13A", "U16B"] }) === "U16B");
ok("holding nothing: the first team the rows contain, not 1XI", pickTeam({ teams: ["U15A", "U13A"], held: [] }) === "U15A");
ok("a school-wide person (no team held) opens on the first side in the sheet's order", pickTeam({ teams: ["1XI", "U15A"], held: [] }) === "1XI");
ok("no rows yet: no side, rather than a guess that a late read would then contradict", pickTeam({ teams: [], held: ["U15A"] }) === null);
ok("the rows arrive after the first render: the held side is chosen then", pickTeam({ teams: [], held: ["U15A"] }) === null && pickTeam({ teams: ["U15A"], held: ["U15A"] }) === "U15A");

group("A choice stands until its team leaves the rows");
ok("his own pick stands over what he holds", pickTeam({ teams: ["1XI", "U15A"], held: ["U15A"], chosen: "1XI" }) === "1XI");
ok("a pick the rows no longer contain falls back to his own side, not to a stale tab", pickTeam({ teams: ["U15A"], held: ["U15A"], chosen: "1XI" }) === "U15A");
ok("...or to the first, with nothing held", pickTeam({ teams: ["U13A", "U15A"], held: [], chosen: "1XI" }) === "U13A");

group("Changing side clears what depended on it");
const sq = readFileSync(new URL("../src/views/SquadView.jsx", import.meta.url), "utf8");
const an = readFileSync(new URL("../src/views/AnalyticsView.jsx", import.meta.url), "utf8");
ok("Squad: the open player and his action are cleared by the one function every tab and a move go through",
  /const chooseTeam = \(t\) => \{ setChosenTeam\(t\); setSelectedId\(null\); setAct\(null\); \}/.test(sq) && !/setTeam\(/.test(sq));
ok("Squad: the player on show is looked up IN the current side", /PLAYERS\.find\(p=>p\.id===selectedId && p\.team===team\)/.test(sq));
ok("Squad: the side's own panels are keyed by it, so their state does not cross", /<AvailabilityPanel key=\{team\}/.test(sq) && /<LiftsPanel key=\{team\}/.test(sq) && /<LiftDayStaff key=\{team\}/.test(sq));
ok("Squad: a new player goes to the side on show, not 1XI", /const npTeam = np\.teamCode \|\| team \|\| "1XI"/.test(sq) && !/teamCode:"1XI"/.test(sq));
ok("Analytics: the fixed three are gone and the tabs are the rows' own", !/\["1XI","U15A","U13A"\]/.test(an) && /teams\.map\(t=>/.test(an) && /useState\(null\)/.test(an) && !/useState\("1XI"\)/.test(an));
ok("Analytics: the match-up batter picked for one side is not carried to another", /<Matchups key=\{teamFilter\?\?"none"\}/.test(an));
ok("Neither screen defaults to 1XI any more", !/useState\("1XI"\)/.test(sq) && !/useState\("1XI"\)/.test(an));

group("Gates answer from the roles held, as the menu does");
// A mixed-role person: a coach (reads the squad, writes development) who is
// also a parent. The badge the shell chose is whichever; the menu is drawn
// from both.
const CAP = "player.development.write";
const coachHolds = roleGrants("coach", CAP);
ok("the premise: a coach holds development.write, a guardian does not", coachHolds === true && roleGrants("guardian", CAP) === false);
ok("badged guardian, but he also holds coach: the control is drawn", holdsAsHeld("guardian", CAP, ["guardian", "coach"]) === true);
ok("...and the old badge-only gate would have hidden it", holdsCapability("guardian", CAP) === false);
ok("badged coach, holding only guardian assignments: not drawn on the strength of a badge", holdsAsHeld("coach", CAP, ["guardian"]) === false);
ok("nothing held (the demo): the badge role answers, exactly as before", holdsAsHeld("coach", CAP, []) === holdsCapability("coach", CAP) && holdsAsHeld("guardian", CAP, []) === holdsCapability("guardian", CAP));
ok("it agrees with the menu: every destination the held set reaches is one a held role's capability grants", (() => {
  const held = ["guardian", "coach"];
  const nav = navForRoles(held);
  return nav.every((k) => NAV_CAPABILITY[k] === null || held.some((r) => roleGrants(r, NAV_CAPABILITY[k])));
})());
const dash = readFileSync(new URL("../src/views/DashboardView.jsx", import.meta.url), "utf8");
const skv = readFileSync(new URL("../src/views/SkillsView.jsx", import.meta.url), "utf8");
ok("Dashboard gates through holdsAsHeld and no longer through the badge role", /holdsAsHeld\(role, capability[,)]/.test(dash) && !/holdsCapability\(/.test(dash.replace(/\/\*[\s\S]*?\*\//g, "")) && !/canScore\(/.test(dash));
ok("Skills edit gate: signed in AND held", /signedIn\(\) && holdsAsHeld\(role,"player\.development\.write"\)/.test(skv) && !/holdsCapability\(/.test(skv));

console.log(`\n${fail ? "✗" : "✓"} team-context: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
