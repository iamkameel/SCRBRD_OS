#!/usr/bin/env node
/**
 * Separation of duties: the boundaries between roles that must not collapse.
 *
 * Every other policy test asks whether a role can do what it is meant to do.
 * This one asks the opposite question — what must this role *never* reach? —
 * because that half is never noticed when it breaks. Adding a capability to a
 * role is a one-line change that makes a screen work, and nothing anywhere
 * says that the same line just handed a scout a minor's phone number or let
 * one person approve their own correction. The capability sets in roles.mjs
 * already carry these boundaries; what they have not had until now is anything
 * that fails when one is crossed.
 *
 * The rules are harvested from Roles&Duty.md §11 (separation of duties) and
 * §21 (production rules) in the scrbrd-beta-2 prototype, which states them as
 * governance prose. Most of them describe SCRBRD OS as it already is — that is
 * the point. A rule this file asserts is one that can no longer be undone by
 * accident.
 *
 * What it can and cannot check. Each rule below is either mechanical (it reads
 * the real capability sets and fails on a real crossing) or it is named at the
 * bottom as prose-only, with the reason it cannot be reduced to an assertion.
 * A test suite that quietly drops the rules it found inconvenient is worse than
 * one that never claimed them, so the prose-only list is part of the output.
 *
 * `superadmin` is the one standing exception throughout: it holds every
 * capability outside `safeguarding.*` by construction (roles.mjs), which is
 * the platform's break-glass and is asserted elsewhere. Safeguarding is the
 * one domain it is kept from (CSA p63, db/57), and the SG group below holds
 * it to that. Every OTHER exception has to be
 * written into KNOWN below with a reason, and each one is checked to still be
 * real — an exception that has been fixed must be deleted, not left to rot.
 *
 * Falsified by granting `scout` the capability `player.pii.read` in a local
 * copy of roles.mjs and confirming §11.7 and §21.5 both go red; and by
 * granting `directorofsport` the capability `scoring.amend.request` in the
 * same way and confirming §11.2 names it as an unrecorded crossing. KNOWN
 * held one entry — the two roles that could request and approve a
 * correction in one pair of hands — until db/24 split the request onto its
 * own capability; the entry went with it, and the anti-rot assertion below
 * is what would have said so had it been left behind.
 *
 *   node packages/policy/test/separation.test.mjs
 */
import { ROLES, ROLE_CAPABILITIES, SCORING_ROLES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES, boundaries, mayGrantRole } from "../src/roles.mjs";
import { ALL_CAPABILITIES, LEVEL, SENSITIVE, PLATFORM_ONLY } from "../src/capabilities.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let passes = 0, fails = 0;
const ok = (/** @type {string} */ label, /** @type {unknown} */ cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

const caps = (/** @type {string} */ role) => ROLE_CAPABILITIES[role] ?? [];
const holders = (/** @type {string} */ cap) => ROLES.filter((r) => caps(r).includes(cap));
/** Roles holding `cap`, minus the break-glass account. */
const others = (/** @type {string} */ cap) => holders(cap).filter((r) => r !== "superadmin");
/** Which of `forbidden` this role holds — the empty array is the pass. */
const reach = (/** @type {string} */ role, /** @type {readonly string[]} */ forbidden) => forbidden.filter((c) => caps(role).includes(c));

// Recorded exceptions. Each needs a reason, and each is checked below to still
// be a real crossing: when the policy is corrected the entry has to go, or the
// suite says so. Correcting one of these is not a code change — it is
// roles.mjs + a new db/NN + a WITHDRAWN_SINCE_01 or ADDED_SINCE_01 entry + a
// production paste (ARCHITECTURE.md §9), which is why they are recorded
// rather than fixed here.
/** @type {Record<string, {roles: string[], reason: string}>} */
const KNOWN = {
  // Empty since db/24. The entry that lived here — directorofsport and
  // competitionadmin holding both halves of a correction — is the worked
  // example of why this list exists: the obvious fix (withdraw
  // `scoring.correct` from both) was written, run, and reverted because that
  // capability also gates session recovery, the quarantine queue and DRS
  // entry. The real fix was a fourth name, `scoring.amend.request`, which
  // took a capability, a ledger file and a paste — and only then could the
  // entry be deleted. See db/24_amend_request.sql and SCRBRD-054.
};


/** Every role any recorded exception covers. */
const EXEMPT = Object.values(KNOWN).flatMap((k) => k.roles);

// ── The exception list itself ────────────────────────────
group("Recorded exceptions carry their reasons");
for (const [name, k] of Object.entries(KNOWN)) {
  ok(`"${name}" names the roles it covers`, Array.isArray(k.roles) && k.roles.length > 0);
  ok("...and says why, at length enough to be a reason rather than a label",
     typeof k.reason === "string" && k.reason.length > 120, `${k.reason?.length ?? 0} chars`);
  ok("...and covers only roles that exist", k.roles.every((r) => ROLES.includes(r)),
     k.roles.filter((r) => !ROLES.includes(r)).join(" "));
}

// ── §11.1 Scoring vs viewing ─────────────────────────────
group("§11.1  Viewing a match does not grant scoring rights");
{
  // Two different things share the `scoring.` prefix, and conflating them is
  // the first mistake this rule invites. SESSION is the live act — claiming the
  // token, appending balls, closing an innings — and SCORING_ROLES is derived
  // from exactly that (roles.mjs: holders of `scoring.edit`). GOVERNANCE is what
  // happens to a locked match afterwards, and it belongs to people who will
  // never touch a tablet: a principal approving an amendment is not a scorer.
  // RECOVERY is the third thing: what somebody senior does at the ground when
  // a session is stuck — release the lease, read the quarantine, enter a DRS
  // review. It is neither the live act nor governance of a locked match, and
  // until db/24 it shared a name with the amendment request, which is what
  // made §11.2 unfixable without breaking a Saturday morning (SCRBRD-054).
  const SESSION = ["scoring.start", "scoring.edit", "scoring.finalise"];
  const RECOVERY = ["scoring.correct"];
  const GOVERNANCE = ["scoring.amend.request", "scoring.amend.approve"];
  // The fourth thing (SCRBRD-120): a match scored on paper, typed in from
  // photos of the book and confirmed by somebody else. Not the live act — no
  // token, no lease — and governed like an amendment: two people, by role.
  const IMPORT = ["scoring.import.read", "scoring.import.write", "scoring.import.confirm"];
  ok("every scoring capability is a session act, a recovery act, a governance one or an import",
     ALL_CAPABILITIES.filter((c) => c.startsWith("scoring.")).length
       === SESSION.length + RECOVERY.length + GOVERNANCE.length + IMPORT.length,
     ALL_CAPABILITIES.filter((c) => c.startsWith("scoring.")).join(" "));
  // An import takes two people, by the role catalogue, as a correction does
  // (§4.2): nobody who types a card may confirm one. db/63 adds the per-import
  // rule — the submitter and every revision's author are refused — for the
  // person holding both through two assignments.
  const typists = new Set(others("scoring.import.write"));
  const signers = new Set(others("scoring.import.confirm"));
  ok("an import takes two people: no role both types and confirms one",
     [...typists].every((r) => !signers.has(r)) && typists.size > 0 && signers.size > 0,
     `write ${[...typists].join(",")} · confirm ${[...signers].join(",")}`);
  ok("...and both can open the import they work on",
     [...typists, ...signers].every((r) => caps(r).includes("scoring.import.read")));
  ok("...and only a role that can score a match live may type one in",
     [...typists].every((r) => caps(r).includes("scoring.edit")), [...typists].join(","));
  ok("...and the confirmers are the approvers of a correction",
     [...signers].every((r) => caps(r).includes("scoring.amend.approve")), [...signers].join(","));
  ok("no family, pupil or support role reaches an import",
     ["guardian", "player", "selfaccess", "enquiry", "spectator", "platformadmin"].every((r) => reach(r, IMPORT).length === 0));
  const leaked = ROLES.filter((r) => !SCORING_ROLES.includes(r) && reach(r, SESSION).length);
  ok("no role outside SCORING_ROLES reaches the live scoring session", leaked.length === 0,
     leaked.map((r) => `${r}: ${reach(r, SESSION).join(",")}`).join(" · "));
  // The invariant §11.2 is actually reaching for, stated as the two sets
  // rather than as a list of roles: a correction has to take two people. An
  // earlier version of this line asserted something larger — that nobody who
  // can append balls may also approve an amendment — which is not required.
  // A director of sport who scored the match himself is fine as an approver
  // PROVIDED he cannot also be the one requesting — which held only on paper
  // until db/24 gave the request its own name (SCRBRD-029, SCRBRD-054).
  const requesters = new Set(others("scoring.amend.request"));
  const approvers = new Set(others("scoring.amend.approve"));
  const overlap = [...requesters].filter((r) => approvers.has(r) && !EXEMPT.includes(r));
  ok("a correction takes two people, beyond the recorded exception",
     overlap.length === 0 && requesters.size > 0 && approvers.size > 0,
     `requesters ${[...requesters].join(",")} · approvers ${[...approvers].join(",")}`);
  // The public end of it: the roles that exist only to watch.
  const scoring = [...SESSION, ...GOVERNANCE];
  for (const r of ["spectator", "media", "scout"])
    ok(`${r} can read a fixture and cannot score it`,
       caps(r).includes("fixture.read") && reach(r, scoring).length === 0,
       reach(r, scoring).join(","));
  ok("enquiry — the narrowest role there is — reaches neither",
     caps("enquiry").length === 2 && reach("enquiry", scoring).length === 0, caps("enquiry").join(" "));
}

// ── §11.2 Scorer vs match authority ──────────────────────
group("§11.2  The scorer records, the umpire officiates, a third party approves");
{
  const pair = ["scoring.amend.request", "scoring.amend.approve"];
  const both = others(pair[0]).filter((r) => caps(r).includes(pair[1]));
  // Reads the exception list generically rather than by key: since db/24 the
  // list is empty, so this stands on nothing but the two capability sets —
  // which is the state it always wanted.
  const unrecorded = both.filter((r) => !EXEMPT.includes(r));
  ok("nobody may both request and approve a correction, beyond the recorded exceptions",
     unrecorded.length === 0, `unrecorded: ${unrecorded.join(", ")}`);
  // The exception list must stay real, or it silently licenses a role that no
  // longer needs licensing. This is what forced the directorofsport /
  // competitionadmin entry out when db/24 landed.
  const stale = EXEMPT.filter((r) => !both.includes(r));
  ok("...and every recorded exception is still a real crossing", stale.length === 0,
     `fixed — delete from KNOWN: ${stale.join(", ")}`);
  ok("the scorer requests corrections and cannot approve them",
     caps("scorer").includes("scoring.amend.request") && !caps("scorer").includes("scoring.amend.approve"));
  // The split has to leave recovery where it was, or it is db/24's reverted
  // predecessor under another name: the two roles that lost the request
  // still release a lease, still read the quarantine, still enter a review.
  for (const r of ["directorofsport", "competitionadmin"])
    ok(`${r} approves, recovers a session, and does not request`,
       caps(r).includes("scoring.amend.approve") && caps(r).includes("scoring.correct")
         && !caps(r).includes("scoring.amend.request"));
  ok("the request is held by the scorer and nobody else who is not the owner",
     others("scoring.amend.request").join() === "scorer");
  ok("the scorer holds no officiating or disciplinary authority",
     reach("scorer", ["officiating.assign", "officiating.report", "officiating.registry.manage",
                      "discipline.read", "discipline.write"]).length === 0,
     reach("scorer", ["officiating.report", "discipline.write"]).join(","));
  ok("the official officiates and does not score",
     reach("official", ALL_CAPABILITIES.filter((c) => c.startsWith("scoring."))).length === 0);
  ok("...and no single capability carries both scoring and officiating",
     !ALL_CAPABILITIES.some((c) => /scoring/.test(c) && /officiat/.test(c)));
}

// ── D5 The confirmer is never a hand on the log (OFFICIAL_RESULT, db/114) ──
group("D5  Whoever makes a result official files no correction to it");
{
  // OFFICIAL_RESULT §5: the two sets that must stay disjoint, as the two
  // amendment capabilities are. The role half is here; db/114's row check
  // (result_hand_on_log(), refusal `you_wrote_this_log`, db/99 §91 (hands))
  // is the half that keeps a director of sport who scored the match himself,
  // or approved its correction, from confirming it.
  const confirmers = new Set(others("result.confirm"));
  const requesters = new Set(others("scoring.amend.request"));
  ok("nobody may both request a correction and confirm a result",
     confirmers.size > 0 && requesters.size > 0 && [...confirmers].every((r) => !requesters.has(r)),
     `confirm ${[...confirmers].join(",")} · request ${[...requesters].join(",")}`);
  ok("result.confirm is the organiser's, the director of sport's and the principal's (§5), and the owner's",
     [...confirmers].sort().join() === "competitionadmin,directorofsport,principal" && caps("superadmin").includes("result.confirm"),
     [...confirmers].join(","));
  ok("...every confirmer approves corrections too (a second hand, never the first)",
     [...confirmers].every((r) => caps(r).includes("scoring.amend.approve")), [...confirmers].join(","));
  ok("no scorer, coach, family, pupil or watcher confirms a result",
     ["scorer", "coach", "assistantcoach", "teammanager", "sportsadmin", "guardian", "player", "selfaccess",
      "spectator", "media", "scout", "official"].every((r) => !caps(r).includes("result.confirm")));
}

// ── §11.3 Coach vs medical authority ─────────────────────
group("§11.3  A coach learns what safe participation requires, not the file");
for (const r of ["coach", "assistantcoach"]) {
  ok(`${r} can read a player's medical status`, caps(r).includes("medical.status.read"));
  ok(`...and cannot read the file or write to it`,
     reach(r, ["medical.details.read", "medical.write"]).length === 0,
     reach(r, ["medical.details.read", "medical.write"]).join(","));
}
ok("the capability that opens the file is held by the roles that need it",
   others("medical.details.read").every((r) => ["medical", "guardian", "selfaccess"].includes(r)),
   others("medical.details.read").join(" "));

// ── K3 · A child's medical needs are not in general view to other children ──
// CSA Safeguarding Policy p52 item 6; docs/policy/CSA_SAFEGUARDING_CHECK.md K3;
// db/55. A role held across a side by children reads no tier of a
// team-mate's injury — not even that he is out and until when. A granted
// enquiry is coach to coach, for one named player, and keeps the status tier
// and nothing more (Kameel, 2026-09-28).
group("K3  A pupil reads no team-mate's injury, at any tier");
{
  const tiers = ["medical.status.read", "medical.nature.read", "medical.details.read"];
  ok("player holds no medical tier", reach("player", tiers).length === 0, reach("player", tiers).join(","));
  ok("enquiry holds the status tier and no other",
     reach("enquiry", tiers).join() === "medical.status.read", reach("enquiry", tiers).join(","));
  ok("...while the pupil's own record reaches him at every tier, through selfaccess",
     tiers.every((c) => caps("selfaccess").includes(c)));
  ok("...and a guardian's, over his own children, likewise",
     tiers.every((c) => caps("guardian").includes(c)));
  // Who may know that a child is out: staff who need it, the child, his parent.
  // A new holder of the status tier is a decision against p52, not a tidy-up.
  // `fitness` joined by decision (SCRBRD-110 Q13, Kameel 2026-09-27): the
  // strength-and-conditioning coach bringing a boy back needs the coach's
  // tier — status and nature — and never the notes.
  const staff = ["principal", "directorofsport", "schooladmin", "sportsadmin",
                 "coach", "assistantcoach", "teammanager", "medical", "fitness", "enquiry", "guardian", "selfaccess"];
  ok("the status tier is held by staff who need it, the child and his parent, and nobody else",
     others("medical.status.read").every((r) => staff.includes(r))
       && staff.every((r) => caps(r).includes("medical.status.read")),
     others("medical.status.read").join(" "));
}

// ── REACH-D4 · A pupil is a pupil of a side ──────────────
// A `player` row with no team passed app_can()'s team test for every side at
// the school (db/50): a boy with no side read every sheet, post and bus.
// Decided 14 October 2026 (Kameel): `player` is team-scoped, like a coach;
// db/108 is the CHECK. His own record stays subject-scoped (selfaccess).
// Falsified by taking `player` back out of TEAM_SCOPED_ROLES: red here.
group("REACH-D4  A pupil's `player` assignment names his side");
{
  ok("player is team-scoped, as a coach is", TEAM_SCOPED_ROLES.includes("player"));
  ok("...and not subject-scoped: his own record is selfaccess's",
     !SUBJECT_SCOPED_ROLES.includes("player") && SUBJECT_SCOPED_ROLES.includes("selfaccess"));
  ok("the coaching roles are still team-scoped",
     ["coach", "assistantcoach", "teammanager"].every((r) => TEAM_SCOPED_ROLES.includes(r)));
}

// ── §11.4 School administration vs safeguarding ──────────
// ── SG · Safeguarding: nobody but a DSO reads a concern ──
// CSA Safeguarding Policy p15–17, p52 item 5, p63; docs/design/SAFEGUARDING_DSO.md
// §2.2; db/57. The four capabilities are the DSO's and nobody else's — the
// owner's key included — and the DSO reaches a family only through an open
// concern, never by standing. Falsified by adding safeguarding.concern.read
// to `principal`, and by typing `superadmin` back to [...ALL_CAPABILITIES]:
// both go red below.
group("SG  Nobody but a DSO reads a safeguarding concern");
{
  const SG = ALL_CAPABILITIES.filter((c) => c.startsWith("safeguarding."));
  ok("the four safeguarding capabilities exist",
     ["safeguarding.concern.read", "safeguarding.concern.manage", "safeguarding.suspend", "safeguarding.authorise"]
       .every((c) => SG.includes(c)) && SG.length === 4, SG.join(" "));
  const wrong = SG.filter((c) => holders(c).join() !== "dso");
  ok("safeguarding.* is held by dso and by no other role — the owner's key included",
     wrong.length === 0, wrong.map((c) => `${c}: ${holders(c).join(",")}`).join(" · "));
  ok("the owner's key holds every capability outside safeguarding.*",
     ALL_CAPABILITIES.filter((c) => !c.startsWith("safeguarding.")).every((c) => caps("superadmin").includes(c)));
  const kept = [...ALL_CAPABILITIES.filter((c) => /^(medical|discipline|scoring)\./.test(c)),
                "user.role.assign", "player.pii.read", "player.emergency.read", "player.age.read",
                "player.note.read", "broadcast.publish"];
  ok("dso holds no medical, disciplinary or scoring capability, no appointments, and not the family's file",
     reach("dso", kept).length === 0, reach("dso", kept).join(","));
  ok("...and does hold what the job at the institution needs",
     ["clearance.read", "clearance.manage", "audit.read", "player.public.withhold", "player.profile.read"]
       .every((c) => caps("dso").includes(c)));
  ok("the principal appoints a DSO; the office and the director of sport do not",
     mayGrantRole("principal", "dso") && !mayGrantRole("schooladmin", "dso") && !mayGrantRole("directorofsport", "dso"));
  ok("a DSO holds an institution, not a team or a child",
     !TEAM_SCOPED_ROLES.includes("dso") && !SUBJECT_SCOPED_ROLES.includes("dso"));
  // SCRBRD-110 plans a `fitness` role; whenever it lands it reads no concern.
  ok("SCRBRD-110's fitness role, if it has landed, holds none of it",
     !ROLES.includes("fitness") || reach("fitness", SG).length === 0);
}

// ── WL · A boy's load and his body are his, his staff's, and nobody else's ──
// SCRBRD-110 §6.5 and §6.1, phase 1 (db/60). The nets band, the check-ins and
// the tests are read by the people who look after him and by him; a
// team-mate, an observer and a borrowed enquiry grant reach none of it. The
// strength-and-conditioning coach reads the load and an injury at the coach's
// tier, and never the physio's notes or a coach's prose. Falsified by adding
// player.workload.write to `player` and medical.details.read to `fitness`:
// both go red below.
group("WL  Workload and wellness: his staff and him, never a team-mate");
{
  const WL = ALL_CAPABILITIES.filter((c) => /^(wellness|player\.workload|fitness)\./.test(c));
  ok("the phase 1 capabilities exist", ["player.workload.write", "wellness.read", "fitness.test.write"]
       .every((c) => WL.includes(c)), WL.join(" "));
  const observers = ["player", "spectator", "analyst", "scorer", "official", "media", "scout", "enquiry"];
  const crossing = observers.filter((r) => reach(r, WL).length > 0);
  ok("no team-mate, observer or enquiry grant holds a workload, wellness or fitness capability",
     crossing.length === 0, crossing.map((r) => `${r}: ${reach(r, WL).join(",")}`).join(" · "));
  ok("fitness holds neither the physio's notes nor a coach's prose",
     ROLES.includes("fitness") && reach("fitness", ["medical.details.read", "medical.write", "player.note.read"]).length === 0);
  ok("...and holds the load, the check-ins, the tests and the coach's injury tier (Q13)",
     ["player.workload.read", "player.workload.write", "wellness.read", "fitness.test.write",
      "medical.status.read", "medical.nature.read"].every((c) => caps("fitness").includes(c)));
  ok("fitness sets no guideline and shares nothing (it is not paged either)",
     reach("fitness", ["player.workload.plan", "wellness.alert", "wellness.share"]).length === 0);
  ok("a guardian reads no wellness record by standing (a share is an act, §6.3)",
     !caps("guardian").includes("wellness.read") && !caps("guardian").includes("player.workload.read"));
  ok("the boy records his own nets band and reads his own load",
     ["player.workload.read", "player.workload.write"].every((c) => caps("selfaccess").includes(c)));
  ok("the director of sport appoints the fitness coach; the office does not",
     mayGrantRole("directorofsport", "fitness") && !mayGrantRole("schooladmin", "fitness"));
  ok("fitness holds a school, like medical: not a team, not a child",
     !TEAM_SCOPED_ROLES.includes("fitness") && !SUBJECT_SCOPED_ROLES.includes("fitness"));
}

// ── UP · The union passport: named selectors only (db/124) ──
// Kameel, 29 Oct 2026: "CSA Schools/Provincial Union will be able to access a
// child's full passport ... Named selectors and the schools cricket manager
// only, every read logged." The capability opens passport() and nothing
// else; held by the union selector, and by the owner's key only because its
// bundle is every capability (db/124's reader test refuses a platform-wide
// caller). Being a competition organiser opens nothing. Falsified by adding
// passport.union.read to competitionadmin: the second check goes red.
group("UP  The union passport: the named selectors, never the organiser");
{
  ok("passport.union.read is a capability, at the passport's tier (2)",
     ALL_CAPABILITIES.includes("passport.union.read") && LEVEL["passport.union.read"] === 2);
  ok("held by the union selector and the owner's key, and by nobody else",
     holders("passport.union.read").sort().join() === "superadmin,unionselector", holders("passport.union.read").join());
  ok("a competition organiser does not hold it", !caps("competitionadmin").includes("passport.union.read"));
  ok("the union selector holds the passport and the school read, nothing of the roster or the body",
     caps("unionselector").slice().sort().join() === "passport.union.read,school.read", caps("unionselector").join());
  ok("...nor anything sensitive but the passport",
     caps("unionselector").filter((c) => LEVEL[c] >= 2).join() === "passport.union.read");
  ok("a principal (the union's) appoints one; the office, the director of sport and the organiser do not",
     mayGrantRole("principal", "unionselector") && !mayGrantRole("schooladmin", "unionselector")
       && !mayGrantRole("directorofsport", "unionselector") && !mayGrantRole("competitionadmin", "unionselector"));
  ok("a union selector holds an institution, not a team or a child",
     !TEAM_SCOPED_ROLES.includes("unionselector") && !SUBJECT_SCOPED_ROLES.includes("unionselector"));
}

// ── LIFT · Families arrange, the school facilitates (SCRBRD-124, db/70) ──
// docs/design/SCRBRD-124_lift_clubs.md §2.1, as confirmed against this file.
// The four jobs are four pairs of hands: the family arranging for its own
// children; the side's staff receiving; the office overseeing in counts; the
// principal signing the policy. A pupil holds none (D8: he never drives;
// from eighteen he asks for his own seat through his self link). The DSO
// gains nothing (§2.1: the history and the bar come through safeguarding.*).
// A bus driver gains nothing: a lift is not a trip. Falsified by adding
// transport.lift.arrange to `selfaccess` and transport.lift.oversee to
// `principal`: both go red below.
group("LIFT  Families arrange lifts; the school facilitates and does not operate them");
{
  const LIFT = ALL_CAPABILITIES.filter((c) => c.startsWith("transport.lift."));
  ok("the four lift capabilities exist",
     ["transport.lift.arrange", "transport.lift.receive", "transport.lift.oversee", "transport.lift.policy"]
       .every((c) => LIFT.includes(c)) && LIFT.length === 4, LIFT.join(" "));
  const without = (/** @type {string} */ c) => holders(c).filter((r) => r !== "superadmin").sort().join(",");
  ok("arrange is the guardian's alone", without("transport.lift.arrange") === "guardian", without("transport.lift.arrange"));
  ok("receive is the side's staff's", without("transport.lift.receive") === "assistantcoach,coach,teammanager",
     without("transport.lift.receive"));
  ok("oversee is held by exactly the roles that hold transport.manage",
     without("transport.lift.oversee") === holders("transport.manage").filter((r) => r !== "superadmin").sort().join(","),
     without("transport.lift.oversee"));
  ok("policy is the principal's alone", without("transport.lift.policy") === "principal", without("transport.lift.policy"));
  const pupils = ["player", "selfaccess", "enquiry", "spectator"];
  ok("no pupil, enquiry or observer holds any lift capability",
     pupils.every((r) => reach(r, LIFT).length === 0), pupils.map((r) => `${r}: ${reach(r, LIFT).join(",")}`).join(" · "));
  ok("the DSO and the bus driver gain nothing", reach("dso", LIFT).length === 0 && reach("driver", LIFT).length === 0);
  ok("no role but the owner's key both arranges and oversees (the family is not the office)",
     ROLES.filter((r) => r !== "superadmin" && caps(r).includes("transport.lift.arrange") && caps(r).includes("transport.lift.oversee")).length === 0);
  ok("the principal signs and does not oversee: switching lifts on is not reading them",
     !caps("principal").includes("transport.lift.oversee") && !caps("principal").includes("transport.lift.arrange"));
  ok("arrange reaches a child only through the guardian link: guardian is subject-scoped",
     SUBJECT_SCOPED_ROLES.includes("guardian"));
}

group("§11.4  Administering a school is not conducting a safeguarding case");
ok("schooladmin sees that a disciplinary record exists and cannot write one",
   caps("schooladmin").includes("discipline.read") && !caps("schooladmin").includes("discipline.write"));
ok("...and cannot read a coach's private player notes",
   !caps("schooladmin").includes("player.note.read"));
ok("...nor a medical file",
   !caps("schooladmin").includes("medical.details.read"));
// THE MIRROR, and since SCRBRD-053 it is load-bearing rather than tidy.
// `official` writes a disciplinary record and cannot read one, which is why
// neither write path in services/api/write/discipline-api.mjs uses RETURNING:
// Postgres applies the SELECT policy to a row an INSERT returns, so the day
// this asymmetry stops being true is the day that design decision stops being
// necessary — and the day it is reversed in the other direction, by somebody
// taking the write away, an umpire silently cannot file an incident at all.
ok("the official files a disciplinary record and cannot read one",
   caps("official").includes("discipline.write") && !caps("official").includes("discipline.read"));
ok("...and the two ends of it are held by different sets of roles",
   others("discipline.read").join() !== others("discipline.write").join(),
   `read: ${others("discipline.read").join(" ")} · write: ${others("discipline.write").join(" ")}`);
// Filing is one job and running the school's sport is another. The overlap is
// exactly one role — the director of sport, who is the only person who can
// both file an off-field matter and conclude one an umpire filed — and that is
// a decision rather than an accident, so it is written down.
ok("filing is held by the umpire and the director of sport, and by nobody else",
   others("discipline.write").join() === "directorofsport,official",
   others("discipline.write").join(" "));

// ── §11.5 Finance vs sporting performance ────────────────
group("§11.5  Finance sees payers and invoices, not performance or health");
{
  // SCRBRD-030 put invoice.read/invoice.manage on SENSITIVE (level 2) — the
  // same widening that split this role in two. Spreading the whole of
  // SENSITIVE into "forbidden" would now forbid finance the one thing it
  // holds, so the billing pair is named out rather than swept in with it.
  const forbidden = SENSITIVE.filter((c) => !c.startsWith("invoice."))
    .concat(["analytics.read", "opposition.read", "player.performance.read",
             "player.development.read", "scouting.read", "medical.status.read"]);
  ok("finance reaches nothing sporting, personal or clinical",
     reach("finance", forbidden).length === 0, reach("finance", forbidden).join(","));
  ok("...and does hold the billing reads it exists for",
     ["invoice.read", "invoice.manage"].every((c) => caps("finance").includes(c)));
  // The half that used to be true by construction, when one bundle held both:
  // now that `sponsorship` exists, finance holding a scrap of it back would be
  // the split failing to actually separate anything.
  ok("...and none of the commercial capabilities that moved to `sponsorship`",
     ["sponsorship.read", "sponsorship.manage", "sponsorship.finance.read"]
       .every((c) => !caps("finance").includes(c)));

  ok("sponsorship reaches nothing sporting, personal, clinical or billing",
     reach("sponsorship", [...forbidden, "invoice.read", "invoice.manage"]).length === 0,
     reach("sponsorship", [...forbidden, "invoice.read", "invoice.manage"]).join(","));
  ok("...and does hold the commercial reads it exists for",
     ["sponsorship.read", "sponsorship.manage", "sponsorship.finance.read"]
       .every((c) => caps("sponsorship").includes(c)));
}

// ── §11.6 Sponsor vs participant data ────────────────────
group("§11.6  Commercial access is aggregate and never a back door");
{
  // The external sponsor viewer is a role SCRBRD OS has not built (SCRBRD-036).
  // `sponsorship` is not that role — it is the internal commercial role
  // SCRBRD-030 split out of the old `finance` bundle, held by somebody at the
  // school — but it is exactly the shape §11.6 exists to hold to
  // aggregate-only, so it is checked the same way rather than carved out.
  const sponsorish = ROLES.filter((r) => /sponsor|partner/.test(r) && r !== "sponsorship");
  ok("no external sponsor-viewer role exists yet (SCRBRD-036 would add one)",
     sponsorish.length === 0, sponsorish.join(" "));
  const bad = [...sponsorish, "sponsorship"].filter((r) => reach(r, [...SENSITIVE]).length);
  ok("...and neither the internal commercial role nor a future external one holds anything sensitive",
     bad.length === 0, bad.join(" "));
  ok("sponsorship.exclusivity.waive is not reachable from outside governance",
     others("sponsorship.exclusivity.waive").every((r) => ["principal", "directorofsport"].includes(r)),
     others("sponsorship.exclusivity.waive").join(" "));
}

// ── §11.7 Scout vs contact with a minor ──────────────────
group("§11.7  Scouting is permission to review evidence, not to reach a child");
{
  const contact = ["player.pii.read", "player.emergency.read", "player.identity.read",
                   "player.biometric.read", "guardian.link.manage", "player.note.read",
                   "medical.status.read", "medical.nature.read", "medical.details.read"];
  ok("scout reaches no contact detail, identity document, note or medical field",
     reach("scout", contact).length === 0, reach("scout", contact).join(","));
  ok("...and does hold the scouting reads it exists for",
     caps("scout").includes("scouting.read"));
  ok("accrediting a scout is a platform act, not a school one",
     PLATFORM_ONLY.includes("scouting.accredit"));
}

// ── §21 The production rules that can be asserted ────────
group("§21  The nevers, where a never can be checked");
ok("§21.2  schooladmin is not 'can see everything'",
   caps("schooladmin").length < ALL_CAPABILITIES.length &&
   reach("schooladmin", ["player.note.read", "medical.details.read", "discipline.write",
                         "analytics.read", "opposition.read", "scouting.read",
                         "platform.tenant.manage"]).length === 0,
   `${caps("schooladmin").length} of ${ALL_CAPABILITIES.length}`);
ok("§21.5  no minor's contact detail reaches a scout, a media contributor or a spectator",
   ["scout", "media", "spectator", "enquiry"].every((r) =>
     reach(r, ["player.pii.read", "player.emergency.read", "player.identity.read"]).length === 0));
ok("§21.10  holding a commercial capability never carries a sensitive one with it",
   !ROLES.some((r) => r !== "superadmin" &&
     caps(r).includes("sponsorship.finance.read") && reach(r, [...SENSITIVE]).length));
{
  // §21.1 — a role name is not an access check. Twelve view gates still read
  // the role string directly. SCRBRD-011 closed the `superadmin` pair in
  // ManagementView.jsx (isSuperAdmin and the "Highest privilege" badge), both
  // now derived from mayGrantRole() instead of a hand-written role literal.
  // This is a ratchet, not a pass: it may fall, never rise, so a new one
  // fails here rather than in review.
  // 10 → 6: the Staff screen's four per-role detail panels (scorer, medical,
  // driver, facilities) went with its move onto the school's role assignments.
  const GATE_CEILING = 6;
  /** @type {(dir: string) => string[]} */
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const gates = walk(join(ROOT, "apps/web/src"))
    .filter((f) => f.endsWith(".jsx"))
    .flatMap((f) => (readFileSync(f, "utf8").match(/role\s*===\s*"[a-z]+"/g) ?? [])
      .map((m) => `${f.slice(ROOT.length + 1)} ${m}`));
  ok(`§21.1  role-string gates in the views do not increase (${gates.length} ≤ ${GATE_CEILING})`,
     gates.length <= GATE_CEILING, gates.slice(0, 4).join(" · "));
  ok("...and the ceiling is not slack — lower it when SCRBRD-011 removes one",
     gates.length === GATE_CEILING, `${gates.length} found; set GATE_CEILING to that`);
}

// ── READERS · who reads a child's data (Kameel, 21 Oct 2026) ──
// docs/design/READERS_child_data.md §7, Decisions; db/116. Each assertion is
// a decision that a one-line change to roles.mjs or a policy would undo.
//
// Q2: `audit.read` opens the access log and nothing else. A reason stays
// under the capability of the act that wrote it, so no read policy names
// audit.read but the log's own: the access log, the pen's log, the support
// sessions (the platform's reads into a school) and the scorebook import's
// audit (the card and its revisions, never a page). Read from the migrations
// as they stand at the end, in order: a policy dropped and re-created by a
// later file is judged by its last text. Falsified by putting db/90's
// `OR app_can('audit.read', …)` arm back into db/116's account_status_change_read
// (the allow-list below names the policy and the group goes red).
group("READERS Q2  audit.read opens the access log, and no reason");
{
  const DB = join(ROOT, "db");
  const files = readdirSync(DB).filter((f) => /^\d{2,3}_.*\.sql$/.test(f) && !/^9[89]_/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  /** @type {Map<string, string>} table.policy → its last CREATE text */
  const live = new Map();
  /** @type {Map<string, string>} function name → its last body */
  const fns = new Map();
  for (const f of files) {
    const text = readFileSync(join(DB, f), "utf8")
      // A comment is not a policy: strip line comments before reading.
      .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    const re = /DROP POLICY IF EXISTS\s+(\w+)\s+ON\s+(\w+)|CREATE POLICY\s+(\w+)\s+ON\s+(\w+)([\s\S]*?);|CREATE OR REPLACE FUNCTION\s+(\w+)\s*\(([\s\S]*?)\$\$([\s\S]*?)\$\$/g;
    for (const m of text.matchAll(re)) {
      if (m[1]) live.delete(`${m[2]}.${m[1]}`);
      else if (m[3]) live.set(`${m[4]}.${m[3]}`, m[5]);
      else if (m[6]) fns.set(m[6], m[8]);
    }
  }
  // What audit_log() draws on (READERS §4, conflict 2: "the access log and
  // the audit screen's own reads"). Not the scorebook card, which carries the
  // confirmer's notes: db/116 re-emits its policy without the auditor's arm.
  const ALLOWED = new Set(["access_log.access_log_read", "scoring_audit.audit_read",
    "support_access.support_access_read",
    "scorebook_import_revision.scorebook_import_revision_read"]);
  const naming = [...live].filter(([, body]) => /FOR\s+(SELECT|ALL)\b/.test(body) && /'audit\.read'/.test(body))
    .map(([k]) => k);
  ok(`the read policies that name audit.read are the log's alone (${naming.length} found)`,
     naming.every((k) => ALLOWED.has(k)) && naming.includes("access_log.access_log_read"),
     naming.filter((k) => !ALLOWED.has(k)).join(" "));
  for (const k of ["scoring_amendment.scoring_amendment_read", "role_assignment_ending.role_assignment_ending_read",
                   "account_status_change.account_status_change_read",
                   // db/109's revocation reasons, re-written by db/116 (Q2 names them).
                   "guardian_link_ending.guardian_link_ending_read",
                   // the scorebook card (db/63's generated policy, re-emitted by db/116).
                   "scorebook_import.scorebook_import_read"])
    ok(`...${k} is still there, and reads its reason under the act's own capability`,
       live.has(k) && !/'audit\.read'/.test(live.get(k) ?? ""));
  ok("...and the staff register's door asks user.role.assign alone",
     fns.has("school_register_rows") && !/audit\.read/.test(fns.get("school_register_rows") ?? "")
       && /'user\.role\.assign'/.test(fns.get("school_register_rows") ?? ""));
  // The red-team's A1 (db/116): the passport carries no coach's judgement and
  // opens on a coach's or the office's capability, never on the roster read
  // a team-mate holds.
  ok("A1  passport() carries no rating, and passport_open() does not open on player.profile.read",
     fns.has("passport") && !/player_skill|'rating'/.test(fns.get("passport") ?? "")
       && fns.has("passport_open") && !/player\.profile\.read/.test(fns.get("passport_open") ?? ""));
  ok("the parser is not reading nothing: it found db/09's injury_read and db/08's access_log_read",
     live.has("injury.injury_read") && live.has("access_log.access_log_read"));
  // The model half: no table in tables.mjs reads under audit.read but the
  // scorebook import's audit.
  ok("the DSO holds audit.read and none of the capabilities a reason sits under",
     caps("dso").includes("audit.read")
       && reach("dso", ["user.invite", "user.role.assign", "guardian.link.manage", "scoring.amend.approve"]).length === 0,
     reach("dso", ["user.invite", "user.role.assign", "guardian.link.manage", "scoring.amend.approve"]).join(","));
}

// Q10, Q12, Q14, Q15, Q16: the bundles the decisions narrowed.
group("READERS Q10–Q16  the narrowed reads stay narrow");
{
  ok("Q10  the league holds no discipline.read: a school's conduct file is not a league's",
     !caps("competitionadmin").includes("discipline.read"));
  ok("...it reads its own fixtures' records through competition.discipline.read, held by it and the owner's key alone",
     holders("competition.discipline.read").join() === "superadmin,competitionadmin",
     holders("competition.discipline.read").join(" "));
  ok("Q12  the transport coordinator holds no standing read of every family's numbers",
     !caps("transportcoordinator").includes("player.emergency.read"));
  ok("...he reads a trip's manifest on the day through transport.manifest.read, his and the owner's key's alone",
     holders("transport.manifest.read").join() === "superadmin,transportcoordinator",
     holders("transport.manifest.read").join(" "));
  ok("Q5   a coach holds no discipline.read: his side's records come through side_discipline_records(), logged",
     !caps("coach").includes("discipline.read") && !caps("assistantcoach").includes("discipline.read"));
  ok("...through discipline.side.read, held by the coach and the owner's key alone",
     holders("discipline.side.read").join() === "superadmin,coach", holders("discipline.side.read").join(" "));
  ok("...a team-scoped role, so his own side is the whole of its reach", TEAM_SCOPED_ROLES.includes("coach"));
  ok("Q14  a pupil reads no access log: neither of his bundles holds audit.read (from eighteen, through its own door, when built)",
     !caps("player").includes("audit.read") && !caps("selfaccess").includes("audit.read"));
  ok("Q15  a parent reads no disciplinary record: the letter stays the channel",
     !caps("guardian").includes("discipline.read"));
  ok("Q16  a child's own ID number is never drawn on his screen: selfaccess holds no player.identity.read",
     !caps("selfaccess").includes("player.identity.read"));
  ok("...and the office still holds it, so his right of access is met on request",
     caps("schooladmin").includes("player.identity.read"));
}

// ── The boundary, told to the person standing at it ──────
//
// SCRBRD-033. boundaries(role) is the same separation these rules assert,
// turned around and addressed to whoever holds the role: the sensitive things
// you do not hold, and who holds them instead. It is derived, so it cannot
// drift from the policy above — which is the whole reason it is not prose.
group("§11, said to the person rather than about them");
{
  ok("the owner's key's only boundary is safeguarding.*, which it is kept from",
     boundaries("superadmin").length > 0
       && boundaries("superadmin").every((b) => b.capability.startsWith("safeguarding.") && b.askInstead.join() === "dso"),
     boundaries("superadmin").map((b) => b.capability).join(" "));
  ok("an operational role does have one", boundaries("coach").length >= 4,
     `coach: ${boundaries("coach").length}`);

  const wrong = [], undescribed = [], liars = [], selfish = [], nobody = [];
  for (const role of ROLES)
    for (const b of boundaries(role)) {
      // It may only name what the role does NOT hold, or the screen tells a
      // coach he cannot do something he does every day.
      if (caps(role).includes(b.capability)) wrong.push(`${role}:${b.capability}`);
      if (!b.what) undescribed.push(b.capability);
      // Every name offered has to actually hold it: a hand-off to somebody who
      // would also be refused sends a person round a loop.
      const bad = b.askInstead.filter((r) => !caps(r).includes(b.capability));
      if (bad.length) liars.push(`${b.capability}→${bad.join(",")}`);
      if (b.askInstead.includes(role)) selfish.push(`${role}:${b.capability}`);
      if (b.askInstead.includes("superadmin") || b.askInstead.includes("platformadmin"))
        nobody.push(`${role}:${b.capability}`);
      if (b.askInstead.length === 0) nobody.push(`${role}:${b.capability} has nobody to ask`);
    }
  ok("a boundary never names something the role already holds", wrong.length === 0, wrong.slice(0, 3).join(" "));
  ok("every boundary says what the capability is, in the words the policy uses",
     undescribed.length === 0, undescribed.slice(0, 3).join(" "));
  ok("every name offered as a hand-off genuinely holds it", liars.length === 0, liars.slice(0, 3).join(" "));
  ok("...and is never the role itself", selfish.length === 0, selfish.slice(0, 3).join(" "));
  ok("...and is never a break-glass account, nor an empty list",
     nobody.length === 0, nobody.slice(0, 3).join(" "));

  // The floor. An empty SENSITIVE, or a boundaries() that returned nothing,
  // would make all five of those true about no data at all.
  const total = ROLES.reduce((n, r) => n + boundaries(r).length, 0);
  ok(`${total} boundaries were checked across ${ROLES.length} roles`, total >= 100, `${total}`);
}

// ── What this file does not check ────────────────────────
// Named, so that nobody reads a green run as "§11 and §21 are enforced".
group("Prose-only, and why");
for (const [rule, why] of [
  ["§11.3 'minimum safe participation instructions'",
   "a capability can gate the field; whether the words in it are the minimum is an editorial judgement"],
  ["§21.7 multi-role accounts never merge scopes invisibly",
   "authorize() takes one role and one scope, so a merge is unrepresentable here — it would have to be a walk against two live assignments"],
  ["§21.9 nothing sensitive is exposed merely to simplify a dashboard",
   "the motive for a grant is not in the data; this is what review is for"],
  ["§21.12 every sensitive action is attributable to person, role and scope",
   "attribution lives in the audit trail, not the capability set — smoke-audit.mjs is where it belongs"],
])
  console.log(`  · ${rule}\n      ${why}`);

console.log("\n" + "─".repeat(52));
console.log(`SEPARATION: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
