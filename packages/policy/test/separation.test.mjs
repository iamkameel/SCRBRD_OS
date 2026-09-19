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
 * capability by construction (roles.mjs line 90), which is the platform's
 * break-glass and is asserted elsewhere. Every OTHER exception has to be
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
import { ROLES, ROLE_CAPABILITIES, SCORING_ROLES, boundaries } from "../src/roles.mjs";
import { ALL_CAPABILITIES, SENSITIVE, PLATFORM_ONLY } from "../src/capabilities.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};
const group = (t) => console.log("\n" + t);

const caps = (role) => ROLE_CAPABILITIES[role] ?? [];
const holders = (cap) => ROLES.filter((r) => caps(r).includes(cap));
/** Roles holding `cap`, minus the break-glass account. */
const others = (cap) => holders(cap).filter((r) => r !== "superadmin");
/** Which of `forbidden` this role holds — the empty array is the pass. */
const reach = (role, forbidden) => forbidden.filter((c) => caps(role).includes(c));

// Recorded exceptions. Each needs a reason, and each is checked below to still
// be a real crossing: when the policy is corrected the entry has to go, or the
// suite says so. Correcting one of these is not a code change — it is
// roles.mjs + a new db/NN + a WITHDRAWN_SINCE_01 or ADDED_SINCE_01 entry + a
// production paste (ARCHITECTURE.md §9), which is why they are recorded
// rather than fixed here.
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
  ok("every scoring capability is a session act, a recovery act or a governance one",
     ALL_CAPABILITIES.filter((c) => c.startsWith("scoring.")).length === SESSION.length + RECOVERY.length + GOVERNANCE.length,
     ALL_CAPABILITIES.filter((c) => c.startsWith("scoring.")).join(" "));
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

// ── §11.4 School administration vs safeguarding ──────────
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
  // §21.1 — a role name is not an access check. Fourteen view gates still read
  // the role string directly (SCRBRD-011). This is a ratchet, not a pass: it
  // may fall, never rise, so a new one fails here rather than in review.
  const GATE_CEILING = 14;
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

// ── The boundary, told to the person standing at it ──────
//
// SCRBRD-033. boundaries(role) is the same separation these rules assert,
// turned around and addressed to whoever holds the role: the sensitive things
// you do not hold, and who holds them instead. It is derived, so it cannot
// drift from the policy above — which is the whole reason it is not prose.
group("§11, said to the person rather than about them");
{
  ok("the owner's key has no boundary, because it holds everything",
     boundaries("superadmin").length === 0);
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
