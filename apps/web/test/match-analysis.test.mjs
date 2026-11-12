/**
 * CRI-2.5: who reads a match's whole analysis on the signed-in Analytics tab
 * (lib/matchAnalysis.js), and who the three spectator charts. Decided by
 * capability — analytics.read, through an assignment about a side or a school
 * that covers this fixture — and never by a role's name: the table below is
 * derived from roles.mjs, so a bundle that gains or loses the capability
 * moves its row here without anybody editing a list of titles.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/match-analysis.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES, SUBJECT_SCOPED_ROLES, roleGrants } from "@scrbrd/policy/roles";
import { FULL_ANALYSIS_CAPABILITY, fullAnalysis } from "../src/lib/matchAnalysis.js";
import { deriveMatch, inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { AnalyticsTab } from "../src/views/matchcentre/tabs.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", WES = "wes";
const FIXTURE = { id: "m1", schoolId: HIL, homeTeam: "1XI", awaySchoolId: WES, awayTeamCode: "2XI", status: "live" };

group("The capability, and who holds it");
{
  ok("the capability is analytics.read", FULL_ANALYSIS_CAPABILITY === "analytics.read");
  // Every role, with an assignment at the home school on the home side: the whole analysis exactly when
  // its bundle grants analytics.read and the assignment is not about a named person.
  const wrong = ROLES.filter((role) => {
    const subjects = SUBJECT_SCOPED_ROLES.includes(role) ? ["p1"] : [];
    const got = fullAnalysis([{ role, school: HIL, team: "1XI", subjects }], FIXTURE);
    return got !== (roleGrants(role, "analytics.read") && !SUBJECT_SCOPED_ROLES.includes(role));
  });
  ok("every role in roles.mjs: the whole analysis exactly when its bundle grants analytics.read", wrong.length === 0, wrong);
  const has = (role) => fullAnalysis([{ role, school: HIL, team: role === "coach" || role === "player" ? "1XI" : null }], FIXTURE);
  ok("a parent (guardian), a pupil (player, his own file), a spectator: the three", !fullAnalysis([{ role: "guardian", school: HIL, team: null, subjects: ["p1"] }], FIXTURE)
     && !has("player") && !fullAnalysis([{ role: "selfaccess", school: HIL, team: null, subjects: ["p1"] }], FIXTURE) && !has("spectator"));
  ok("the coach of the side, the director of sport, the principal, the analyst: the whole analysis", has("coach") && has("directorofsport") && has("principal") && has("analyst"));
}

group("Scope: this fixture's side, as the Coach tab reads it");
{
  ok("the away school's coach of the away side", fullAnalysis([{ role: "coach", school: WES, team: "2XI" }], FIXTURE));
  ok("not the coach of another side at the home school", !fullAnalysis([{ role: "coach", school: HIL, team: "U14A" }], FIXTURE));
  ok("not the director of sport of a school not in the fixture", !fullAnalysis([{ role: "directorofsport", school: "kea", team: null }], FIXTURE));
  ok("a platform-wide assignment that grants it", fullAnalysis([{ role: "superadmin", school: null, team: null }], FIXTURE) === roleGrants("superadmin", "analytics.read"));
  ok("one qualifying assignment among others is enough", fullAnalysis([{ role: "guardian", school: HIL, team: null, subjects: ["p1"] }, { role: "coach", school: HIL, team: "1XI" }], FIXTURE));
  ok("an assignment naming a person never qualifies, whatever it grants", !fullAnalysis([{ role: "coach", school: HIL, team: "1XI", subjects: ["p1"] }], FIXTURE));
  ok("fails closed: no assignments, no fixture", !fullAnalysis(null, FIXTURE) && !fullAnalysis([], FIXTURE) && !fullAnalysis([{ role: "coach", school: HIL, team: "1XI" }], null));
}

group("The three, drawn (signed out here, so no assignment: the spectator's layout)");
{
  const ev = [];
  let k = 0;
  const add = (e) => ev.push({ ...e, innings: 0, id: `e${++k}` });
  add(inningsStart({ battingTeam: "1XI", bowlingTeam: "2XI", overs: 2 }));
  add(batters({ striker: "a", nonStriker: "b" }));
  add(bowler({ bowler: "x" }));
  for (const v of [1, 4, 0, 6, 2, 1]) add(ball({ type: BALL_TYPE.RUN, value: v }));
  add(bowler({ bowler: "y" }));
  for (const v of [0, 1, 1, 4, 0, 0]) add(ball({ type: BALL_TYPE.RUN, value: v }));
  const innings = deriveMatch(ev).innings;
  const html = renderToStaticMarkup(h(AnalyticsTab, { match: FIXTURE, innings, inningsSel: 0, setInningsSel: () => {}, overs: 2, events: ev }));
  const toggles = [...html.matchAll(/data-testid="([a-z]+)-table-toggle"/g)].map((m) => m[1]);
  ok("the spectator's layout: runs per over and the partnerships (one innings, so no worm)", /data-analysis="spectator"/.test(html) && toggles.join() === "manhattan,partnership", toggles);
  ok("...no batting impact, bowling economy, wheel, heat map, spider or wagon-wheel analysis",
     !/shot-wheel|wagon-analysis|Batting impact|Bowling economy|shot-heat-map|shot-spider/.test(html));
}

console.log(`\nMATCH ANALYSIS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
