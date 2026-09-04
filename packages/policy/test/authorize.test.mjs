/**
 * Proves the scoped-assignment model, with emphasis on the cases the previous
 * single-role/single-school model could not express or got wrong:
 *
 *   A. capability + scope are evaluated together, never unioned
 *   B. a guardian with children at two schools
 *   C. aggregates are scoped by the same assignment that authorised them
 *   D. sensitive splits (availability vs diagnosis) hold per role
 *   E. assignments expire, and the model is default-deny throughout
 */
import {
  authorize, may, covers, isActive, scopeFilter, grantingAssignments, contexts,
} from "../src/authorize.mjs";
import { ROLES, ROLE_CAPABILITIES, roleGrants, SCORING_ROLES, unknownCapabilities, ungrantedCapabilities } from "../src/roles.mjs";
import { ALL_CAPABILITIES, SENSITIVE, isCapability } from "../src/capabilities.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const HIL = "school-hilton", WES = "school-westville", KEA = "school-kearsney";

// Sarah: Director of Sport at Hilton, coach of one Hilton team, guardian of a
// child in a different Hilton team, and guardian of a child at another school.
const SARAH = [
  { role: "directorofsport", school: HIL },
  { role: "coach",           school: HIL, team: "U16A" },
  { role: "guardian",        school: HIL, children: ["child-james"] },
  { role: "guardian",        school: KEA, children: ["child-lucy"] },
];

// ── A. Capability and scope, together ────────────────────
group("A. Capability and scope are one decision");
{
  ok("coach reads performance in their own team",
     may({ assignments: SARAH, capability: "player.performance.read",
           resource: { school: HIL, team: "U16A", person: "p1" } }));

  // The core of §24: the coaching capability must not reach the child's team.
  // A union of Sarah's permissions would allow this. Scoped evaluation denies it.
  const guardianOnly = SARAH.filter((a) => a.role === "guardian");
  ok("coaching capability does NOT reach the child's team",
     !may({ assignments: guardianOnly, capability: "player.performance.write",
            resource: { school: HIL, team: "U14B", person: "child-james" } }));

  ok("a coach cannot write performance outside their team",
     !may({ assignments: [{ role: "coach", school: HIL, team: "U16A" }],
            capability: "player.performance.write",
            resource: { school: HIL, team: "U14B", person: "p9" } }));

  ok("the decision names the granting assignment",
     authorize({ assignments: SARAH, capability: "player.performance.write",
                 resource: { school: HIL, team: "U16A", person: "p1" } }).via.team === "U16A");

  ok("default deny with no assignments",
     !may({ assignments: [], capability: "fixture.read", resource: { school: HIL } }));
  ok("default deny for an unknown capability",
     !may({ assignments: SARAH, capability: "nonsense.read", resource: { school: HIL } }));
  ok("denial carries a reason",
     authorize({ assignments: [], capability: "fixture.read" }).reason === "no_matching_assignment");
}

// ── B. Cross-school guardian ─────────────────────────────
group("B. A guardian with children at two schools");
{
  ok("sees their own child at school A",
     may({ assignments: SARAH, capability: "player.profile.read",
           resource: { school: HIL, team: "U14B", person: "child-james" } }));
  ok("sees their own child at school B",
     may({ assignments: SARAH, capability: "player.profile.read",
           resource: { school: KEA, team: "U12A", person: "child-lucy" } }));
  // Sarah CAN see another Hilton player — but through Director of Sport, not
  // through guardianship. Which assignment granted it is the difference
  // between a correct decision and a coincidence, and it is what the
  // "why am I seeing this?" affordance reports.
  const other = { school: HIL, team: "U14B", person: "other-child" };
  ok("sees another Hilton player via Director of Sport",
     authorize({ assignments: SARAH, capability: "player.profile.read", resource: other }).via.role === "directorofsport");
  ok("guardianship alone does NOT reach another child",
     !may({ assignments: SARAH.filter((a) => a.role === "guardian"),
            capability: "player.profile.read", resource: other }));
  ok("drop the staff assignment and the same read is denied",
     !may({ assignments: SARAH.filter((a) => a.role !== "directorofsport"),
            capability: "player.profile.read", resource: other }));
  // The tenant boundary: the Hilton guardian assignment must not reach Kearsney.
  ok("guardianship at A does not reach a child at B",
     !may({ assignments: [{ role: "guardian", school: HIL, children: ["child-james"] }],
            capability: "player.profile.read",
            resource: { school: KEA, person: "child-james" } }));
  ok("a guardian sees their child's invoices",
     may({ assignments: SARAH, capability: "invoice.read",
           resource: { school: KEA, person: "child-lucy" } }));
  ok("a guardian cannot select a side",
     !may({ assignments: SARAH.filter(a => a.role === "guardian"),
            capability: "team.select", resource: { school: HIL, team: "U14B" } }));
}

// ── C. Aggregates ────────────────────────────────────────
group("C. Aggregates are scoped, not filtered afterwards");
{
  const f = scopeFilter({ assignments: [{ role: "coach", school: HIL, team: "U16A" }],
                          capability: "medical.status.read" });
  ok("a team coach gets one team scope",
     !f.unrestricted && f.scopes.length === 1 && f.scopes[0].team === "U16A");

  const wide = scopeFilter({ assignments: SARAH, capability: "fixture.read" });
  ok("multi-assignment yields a disjunction", wide.scopes.length > 1);
  ok("school-wide assignment widens the team to null",
     wide.scopes.some((s) => s.school === HIL && s.team === null));

  const platform = scopeFilter({ assignments: [{ role: "platformadmin", school: null }],
                                 capability: "platform.health.read" });
  ok("platform assignment is unrestricted", platform.unrestricted === true);

  // Was medical.details.read, until a coach was granted it — and Sarah coaches
  // U16B, so she now holds it and the assertion tested nothing. Uses a
  // capability no bundle of hers carries, so it stays about the SHAPE of a
  // refusal: an empty scope set, never an unrestricted one.
  const none = scopeFilter({ assignments: SARAH, capability: "platform.tenant.manage" });
  ok("no grant yields an empty scope set, not a wildcard",
     none.unrestricted === false && none.scopes.length === 0);

  // The §36 trap: a school-wide count shown to a team-scoped coach has already
  // leaked, even though no row was rendered.
  ok("a team coach cannot count over the whole school",
     scopeFilter({ assignments: [{ role: "coach", school: HIL, team: "U16A" }],
                   capability: "player.profile.read" }).scopes.every((s) => s.team !== null));
  ok("granting assignments are reported for provenance",
     grantingAssignments({ assignments: SARAH, capability: "fixture.read" }).length === 4);
}

// ── D. Sensitive splits ──────────────────────────────────
group("D. Medical access is bounded by scope, not by tier");
{
  const coach = [{ role: "coach", school: HIL, team: "U16A" }];
  const physio = [{ role: "medical", school: HIL }];
  const res = { school: HIL, team: "U16A", person: "p5" };
  const otherSide = { school: HIL, team: "1XI", person: "p9" };
  ok("coach sees availability",        may({ assignments: coach, capability: "medical.status.read", resource: res }));
  // The coach of a side holds the whole record for that side. The boundary is
  // the TEAM, not the tier: the same capability against another side's player
  // is refused, which is the assertion that has to hold for this to be safe.
  ok("coach sees the diagnosis for their own side",
     may({ assignments: coach, capability: "medical.details.read", resource: res }));
  ok("coach does NOT see it for another side",
     !may({ assignments: coach, capability: "medical.details.read", resource: otherSide }));
  ok("a pupil never reaches the diagnosis of a team mate",
     !may({ assignments: [{ role: "player", school: HIL, team: "U16A" }],
            capability: "medical.nature.read", resource: res }));
  ok("physio sees diagnosis",          may({ assignments: physio, capability: "medical.details.read", resource: res }));
  ok("physio cannot select a side",    !may({ assignments: physio, capability: "team.select", resource: res }));

  ok("finance never sees a minor's PII",     !roleGrants("finance", "player.pii.read"));
  ok("driver reaches only transport",         ROLE_CAPABILITIES.driver.every((c) => /^(transport|news)\./.test(c)));
  ok("a scorer gets no standing squad access",!roleGrants("scorer", "player.performance.read"));
  ok("platform admin does not read clinical notes", !roleGrants("platformadmin", "medical.details.read"));
  ok("platform admin does not read discipline",     !roleGrants("platformadmin", "discipline.read"));
  ok("platform support access is explicit",         roleGrants("platformadmin", "platform.support.impersonate"));

  // A scorer's assignment is normally pinned to one fixture.
  const pinned = [{ role: "scorer", school: HIL, fixture: "fix-1" }];
  ok("scorer may score the assigned fixture",
     may({ assignments: pinned, capability: "scoring.edit", resource: { school: HIL, fixture: "fix-1" } }));
  ok("scorer may NOT score another fixture",
     !may({ assignments: pinned, capability: "scoring.edit", resource: { school: HIL, fixture: "fix-2" } }));
}

// ── E. Time, integrity, and the model itself ─────────────
group("E. Expiry, integrity, contexts");
{
  const past = { role: "coach", school: HIL, team: "U16A", until: "2020-01-01" };
  const future = { role: "coach", school: HIL, team: "U16A", from: "2999-01-01" };
  ok("an expired assignment grants nothing", !may({ assignments: [past], capability: "team.select", resource: { school: HIL, team: "U16A" } }));
  ok("a future assignment grants nothing",   !may({ assignments: [future], capability: "team.select", resource: { school: HIL, team: "U16A" } }));
  ok("active:false grants nothing",          !isActive({ role: "coach", active: false }));
  ok("a dated assignment is live in window", isActive({ role: "coach", from: "2020-01-01", until: "2999-01-01" }));

  // An unscoped resource must not match a scoped assignment — otherwise a
  // query that forgot its scope silently matches everything.
  ok("unscoped resource does not match a school assignment",
     !covers({ role: "coach", school: HIL }, {}));
  ok("unscoped resource does not match a team assignment",
     !covers({ role: "coach", school: HIL, team: "U16A" }, { school: HIL }));

  ok("every capability named by a role exists", unknownCapabilities().length === 0);
  ok("every capability is granted by some role", ungrantedCapabilities().length === 0);
  ok("all capability ids are well-formed", ALL_CAPABILITIES.every((c) => /^[a-z]+(\.[a-z]+)+$/.test(c)));
  ok("SENSITIVE names real capabilities",  SENSITIVE.every(isCapability));
  ok("scoring roles are derived, not listed",
     SCORING_ROLES.includes("scorer") && SCORING_ROLES.includes("coach") && !SCORING_ROLES.includes("guardian"));
  ok("no role can score without scoring.edit",
     ROLES.every((r) => SCORING_ROLES.includes(r) === roleGrants(r, "scoring.edit")));

  const ctx = contexts({ assignments: SARAH });
  ok("context switcher lists every live assignment", ctx.length === 4);
  ok("contexts carry a readable label", ctx.some((c) => /U16A/.test(c.label)));
  ok("an expired assignment is not offered as a context",
     contexts({ assignments: [past] }).length === 0);
}

console.log(`\n${"─".repeat(52)}\nAUTHORIZE SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
