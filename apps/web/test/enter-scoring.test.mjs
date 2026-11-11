/**
 * CRI-1.4: "Enter scoring" on the match page, for an authorised scorer only
 * (docs/design/CRICINFO_GAP_PLAN.md §6). The gate is lib/enterScoring.js:
 * authorize() over the session's assignments, the scoring routes' own
 * capability, this fixture's home school, home team and id. This proves, for
 * EVERY role in roles.mjs, that a role without the capability is never offered
 * the button, at its own school or anywhere else; that a role with it is
 * offered it only over a fixture its assignment covers and only while the
 * assignment is in force; and that the capability is the one the database's
 * scoring routes ask. The screen is the browser walk's
 * (tools/smoke-browser-matchcentre.mjs, "CRI-1.4").
 *
 *   node apps/web/test/enter-scoring.test.mjs
 */
import { readFileSync } from "node:fs";
import { ROLES, SCORING_ROLES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES, roleGrants } from "@scrbrd/policy/roles";
import { ENTERABLE, ENTER_SCORING_CAPABILITY, mayEnterScoring, scoringResource } from "../src/lib/enterScoring.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", WES = "wes";
const NOW = new Date("2026-11-06T10:00:00Z");
const LIVE = { id: "m1", schoolId: HIL, homeTeam: "1XI", awaySchoolId: WES, awayTeamCode: "1XI", status: "live" };
const UPCOMING = { ...LIVE, id: "m2", status: "upcoming" };

/**
 * An assignment of `role` at `school`, shaped as the database requires it:
 * a team for the team-scoped roles, a child for the subject-scoped, the pupil
 * himself for a player, and none of those for anyone else.
 */
function assignment(role, school = HIL, extra = {}) {
  const a = { role, school, team: null };
  if (TEAM_SCOPED_ROLES.includes(role)) a.team = "1XI";
  if (SUBJECT_SCOPED_ROLES.includes(role)) a.children = ["p5"];
  if (role === "player") a.person = "p1";
  return { ...a, ...extra };
}

group("the capability is the scoring routes' own, and no new one");
{
  ok("the button stands on scoring.edit", ENTER_SCORING_CAPABILITY === "scoring.edit");
  const db02 = readFileSync(new URL("../../../db/02_schema_scoring.sql", import.meta.url), "utf8");
  ok("...which is what ball_event's insert policy asks, over the match's school, team and the match itself (db/02)",
     /CREATE POLICY ball_event_insert ON ball_event\s+FOR INSERT WITH CHECK \(\s+app_can\('scoring\.edit', ball_event\.school_id, match_team\(ball_event\.match_id\), NULL, ball_event\.match_id\)/.test(db02));
  ok("...and undo asks, through match_school() and match_team() (db/02)",
     db02.includes("IF NOT app_can('scoring.edit', match_school(p_match), match_team(p_match), NULL, p_match)"));
  ok("the resource is those four: home school, home team, no person, the fixture",
     JSON.stringify(scoringResource(LIVE)) === JSON.stringify({ school: HIL, team: "1XI", fixture: "m1" }));
  // The pad's claim asks scoring.start: every role offered the button may also claim.
  ok("every role holding scoring.edit also holds scoring.start, so the claim it leads to is the same people's",
     SCORING_ROLES.every((r) => roleGrants(r, "scoring.start")) && ROLES.filter((r) => roleGrants(r, "scoring.start")).every((r) => roleGrants(r, "scoring.edit")));
}

group("every role in roles.mjs, at the fixture's own school: offered exactly when it holds the capability");
for (const role of ROLES) {
  const grants = roleGrants(role, "scoring.edit");
  for (const m of [LIVE, UPCOMING]) {
    ok(`${role} on a ${m.status} fixture: ${grants ? "offered" : "never offered"}`,
       mayEnterScoring([assignment(role)], m, NOW) === grants);
  }
}

group("an unauthorised role never sees it — alone, together, platform-wide, or on any fixture");
{
  const without = ROLES.filter((r) => !roleGrants(r, "scoring.edit"));
  ok(`there are roles without it (${without.length})`, without.length > 0);
  // Every non-scoring role at once, at the home school, at the away school and with no school at all.
  const all = without.flatMap((r) => [assignment(r), assignment(r, WES), { ...assignment(r), school: null, team: null }]);
  for (const m of [LIVE, UPCOMING]) ok(`all ${without.length} together on a ${m.status} fixture: never offered`, !mayEnterScoring(all, m, NOW));
  for (const role of without) {
    ok(`${role} with a platform-wide assignment: never offered`, !mayEnterScoring([{ role, school: null, team: null }], LIVE, NOW));
    ok(`${role} named on this very fixture: never offered`, !mayEnterScoring([assignment(role, HIL, { fixture: LIVE.id })], LIVE, NOW));
  }
}

group("a role that may score is offered it only over a fixture its assignment covers");
for (const role of SCORING_ROLES) {
  if (role === "superadmin") continue;   // the owner's key is platform-wide: below
  ok(`${role} at another school: not offered`, !mayEnterScoring([assignment(role, WES)], LIVE, NOW));
  ok(`${role} at the AWAY school of this fixture: not offered (the database scores the home side's log)`,
     !mayEnterScoring([assignment(role, WES)], { ...LIVE, awaySchoolId: WES }, NOW));
  ok(`${role} for another team at this school: not offered`, !mayEnterScoring([assignment(role, HIL, { team: "U15A" })], LIVE, NOW));
  ok(`${role} named on another fixture: not offered`, !mayEnterScoring([assignment(role, HIL, { fixture: "m9" })], LIVE, NOW));
  ok(`${role} named on this fixture: offered`, mayEnterScoring([assignment(role, HIL, { fixture: LIVE.id })], LIVE, NOW));
  ok(`${role} with an assignment that has ended: not offered`, !mayEnterScoring([assignment(role, HIL, { until: "2026-11-01" })], LIVE, NOW));
  ok(`${role} with one not yet begun: not offered`, !mayEnterScoring([assignment(role, HIL, { from: "2026-12-01" })], LIVE, NOW));
  ok(`${role} past its hour hand: not offered`, !mayEnterScoring([assignment(role, HIL, { expiresAt: "2026-11-06T09:00:00Z" })], LIVE, NOW));
  ok(`${role} revoked: not offered`, !mayEnterScoring([assignment(role, HIL, { active: false })], LIVE, NOW));
  ok(`${role} suspended: not offered`, !mayEnterScoring([assignment(role, HIL, { suspended: true })], LIVE, NOW));
}
ok("the owner's key (superadmin, platform-wide) is offered it, as app_can() lets it score", mayEnterScoring([{ role: "superadmin", school: null, team: null }], LIVE, NOW));
ok("a school-wide director of sport is offered it on any of the school's teams", mayEnterScoring([assignment("directorofsport")], { ...LIVE, homeTeam: "U14B" }, NOW));

group("never on a fixture there is nothing to score on, and never without a session");
{
  const dos = [assignment("directorofsport")];
  ok(`the states the pad is entered in: ${ENTERABLE.join(", ")}`, JSON.stringify([...ENTERABLE]) === JSON.stringify(["live", "upcoming"]));
  for (const status of ["complete", "abandoned", "cancelled", "postponed", undefined]) {
    ok(`a ${status ?? "status-less"} fixture: not offered`, !mayEnterScoring(dos, { ...LIVE, status }, NOW));
  }
  ok("a fixture row with no school (a demonstration's): not offered", !mayEnterScoring(dos, { ...LIVE, schoolId: undefined }, NOW) && scoringResource({ id: "x" }) === null);
  ok("no fixture: not offered", !mayEnterScoring(dos, null, NOW));
  ok("no assignments (signed out, or none): not offered", !mayEnterScoring(null, LIVE, NOW) && !mayEnterScoring([], LIVE, NOW));
}

group("the page offers nothing else that enters scoring");
{
  const mv = readFileSync(new URL("../src/views/matchcentre/MatchView.jsx", import.meta.url), "utf8");
  const calls = mv.match(/onOpenScorer\(/g) ?? [];
  ok("MatchView calls onOpenScorer in one place, the button's own tap", calls.length === 1 && /onClick=\{\(\) => onOpenScorer\(match\)\}[^>]*data-testid="mc-enter-scoring"/.test(mv));
  ok("...drawn only where its caller passed canScoreIt", /\{canScoreIt && \(isLive \|\| match\.status === "upcoming"\) && onOpenScorer && \(/.test(mv));
  ok("...and MatchView never claims a session or writes the log", !/session\/claim|\/events`, \{ method: "POST"|handover/.test(mv));
  const mc = readFileSync(new URL("../src/views/MatchCentreView.jsx", import.meta.url), "utf8");
  ok("the Match Centre's one gate is the fixture's own when signed in",
     /const scoresHere = \(m\) => \(signedIn\(\) \? mayEnterScoring\(profile\(\)\?\.assignments, m\)/.test(mc));
  ok("...the match page passes it", /const enters = scoresHere\(fresh\);/.test(mc) && /canScoreIt=\{enters\}/.test(mc));
  ok("...and every fixture card's scorer button in the list asks it, and nothing else", /\(isLive\|\|m\.status==="upcoming"\)&&scoresHere\(m\)&&<Btn/.test(mc)
     && !/canScore\(role\)&&<Btn/.test(mc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
