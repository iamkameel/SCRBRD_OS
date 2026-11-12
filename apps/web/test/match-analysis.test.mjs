/**
 * CRI-2.5: which layout of the signed-in Analytics tab a reader is drawn
 * (lib/matchAnalysis.js).
 *
 * THE RULE (the lead's call, 13 Nov 2026): the three-chart view is
 * presentation, not access — every reader of a match already reads its ball
 * log — so it is decided by persona, not by a capability. Pupils, guardians
 * and followers (the spectator role) get the three charts: the worm with its
 * wicket pins, runs per over, and the partnerships. Every staff role keeps
 * all of them, assistant coaches, team managers, scorers, admins and medical
 * included. No capability and no grant changes for it.
 *
 * AND THE FAMILY'S OWN WHEEL (the lead's call (b), 13 Nov 2026): in family
 * mode (step 4 G13: a parent's child, a pupil himself) the three charts keep
 * the per-player wheel, heat map and spider for the reader's own child, and
 * only his: no whole-innings wheel, no other child's. A family reader whose
 * child did not bat in the innings has no shot-placement section at all.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/match-analysis.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES } from "@scrbrd/policy/roles";
import { THREE_CHART_ROLES, fullAnalysisFor } from "../src/lib/matchAnalysis.js";
import { PERSONA_NAV } from "../src/design/roles.js";
import { deriveMatch, inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { AnalyticsTab } from "../src/views/matchcentre/tabs.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const FAMILY = ["guardian", "player", "selfaccess", "spectator"];

group("The rule: pupils, guardians and followers get three; every staff role keeps all");
{
  ok("the three-chart readers are the family and pupil personas' roles and the follower's, and no others",
     [...THREE_CHART_ROLES].sort().join() === [...FAMILY].sort().join()
     && Object.values(PERSONA_NAV).flatMap((p) => p.roles).every((r) => THREE_CHART_ROLES.has(r)), [...THREE_CHART_ROLES]);
  for (const r of FAMILY) ok(`${r}: the three charts`, fullAnalysisFor([r]) === false);
  ok("a pupil as the session holds him (player and selfaccess): the three", fullAnalysisFor(["player", "selfaccess"]) === false);
  ok("a parent who also follows the school: the three", fullAnalysisFor(["guardian", "spectator"]) === false);
  const staff = ROLES.filter((r) => !FAMILY.includes(r));
  const lost = staff.filter((r) => !fullAnalysisFor([r]));
  ok(`every one of the ${staff.length} other roles in roles.mjs keeps every chart`, lost.length === 0 && staff.length > 15, lost);
  for (const r of ["coach", "assistantcoach", "teammanager", "scorer", "schooladmin", "sportsadmin", "medical", "directorofsport", "principal", "analyst"]) {
    ok(`${r}: every chart`, fullAnalysisFor([r]) === true);
  }
  ok("a coach who is also a parent holds a staff role, and keeps every chart", fullAnalysisFor(["coach", "guardian"]) === true);
  ok("nothing held (a demonstration with no role): every chart, as before CRI-2.5", fullAnalysisFor([]) === true && fullAnalysisFor(null) === true);
}

group("The three, drawn (a guardian's session)");
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
  const FIXTURE = { id: "m1", schoolId: "hil", homeTeam: "1XI", status: "live" };
  const draw = (role, focus = null) => renderToStaticMarkup(h(AnalyticsTab, { match: FIXTURE, role, innings, inningsSel: 0, setInningsSel: () => {}, overs: 2, events: ev, focus }));
  const toggles = (html) => [...html.matchAll(/data-testid="([a-z]+)-table-toggle"/g)].map((m) => m[1]);
  const g = draw("guardian");
  ok("the guardian: runs per over and the partnerships (one innings, so no worm)", /data-analysis="spectator"/.test(g) && toggles(g).join() === "manhattan,partnership", toggles(g));
  ok("...no batting impact, bowling economy, wheel, heat map, spider or wagon-wheel analysis",
     !/shot-wheel|wagon-analysis|Batting impact|Bowling economy|shot-heat-map|shot-spider/.test(g));
  ok("...and, with no child of his batting, no shot-placement section", !/mc-shot-placement|Whose shots/.test(g));
  const whose = (html) => [...(/aria-label="Whose shots"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "").matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  const mine = draw("guardian", new Set(["a"]));
  ok("a guardian whose boy batted: the three, and his boy's shots — his name alone, no whole innings",
     /data-analysis="spectator"/.test(mine) && /mc-shot-placement/.test(mine) && whose(mine).join() === "a", whose(mine));
  ok("...the wheel, heat map and spider are his (no other child's chooser, no batting impact or wagon analysis)",
     !/Whole innings|Batting impact|Bowling economy|wagon-analysis/.test(mine));
  const notHere = draw("guardian", new Set(["someone-else"]));
  ok("a guardian whose child is not in the innings: the three, and no shot-placement section", !/mc-shot-placement|Whose shots/.test(notHere));
  const pupil = draw("player", new Set(["b"]));
  ok("a pupil: his own shots, by his name alone", whose(pupil).join() === "b", whose(pupil));
  const c = draw("assistantcoach");
  // These balls carry no placement, so the wheel, the heat map and the spider say so rather than draw.
  ok("the assistant coach: every chart", /data-analysis="full"/.test(c) && toggles(c).join() === "manhattan,partnership,batsman,bowler" && /Shot placement/.test(c)
     && /wagon-analysis/.test(c), toggles(c));
}

console.log(`\nMATCH ANALYSIS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
