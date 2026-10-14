/**
 * The staff register's screens (SCRBRD-140 phase 2): the pure halves, and the
 * places a list on the client could drift from the server.
 *
 *   - THE TEMPLATE the office downloads has the server's columns and the docs
 *     template's header, reads clean through the server's own CSV reader, and
 *     holds only made-up adults.
 *   - THE FILE'S LINES. The client names each Check line from the file; its
 *     line numbers are the server's, over a BOM, CRLF, quotes and blank lines.
 *   - THE ONE-ROW FORM, and what its role list holds (never a parent, a pupil,
 *     the safeguarding officer, or a role that reads children's private records).
 *   - IMPORT IS OFFERED ONLY after a Check of the same file and school with no
 *     problem and every warning ticked.
 *   - THE WORDS: a row's state, the cooldown (its own state, never why, never
 *     a name), the claim (granted words are the server's; nothing granted is
 *     no words at all), the DSO's lift, People's origin line.
 *   - THE FLOORS in the new screens' source: nothing under 12px.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/staff-register.test.mjs
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { REGISTER_COLUMNS as SERVER_COLUMNS, PROBLEM_WORDS, COOLDOWN_WORDS, registerRowsFromCsv } from "../../../services/api/write/register-api.mjs";
import { GRANTABLE_ROLES } from "@scrbrd/policy/roles";
import {
  ADULTS_ONLY, LIFTED_WORDS, PAUSE_TITLE, REGISTER_COLUMNS, STAFF_TEMPLATE_CSV, STATES, checkWords, clearAsk, clearLabel, clearedWords, dayWords, importedWords, liftErrorWords, liftable, listableRoles, listedWords,
  mayCommit, needsSide, overCeiling, previewRows, registerErrorWords, registerOrigin, roleLine, rowFromForm, rowsKey, sourceKey,
  stateWords, warnedRows, withdrawAsk,
} from "../src/lib/staffRegister.js";
import { JOIN_WORDS, joinWords } from "../src/lib/joinSchool.js";
import { COOLDOWN_SENTENCE, claimFailure, claimResult } from "../src/lib/registerClaim.js";
import { ApiError } from "../src/lib/api.js";
import { primaryRole } from "../src/lib/primaryRole.js";
import { peopleWithRoles } from "../src/lib/people.js";
import { StaffRegisterPanel, canSeeRegister } from "../src/views/staffRegister.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const apiError = (status, code, detail) => new ApiError(status, code, "/x", detail);

group("The template");
{
  ok("the columns are the server's, in its order", REGISTER_COLUMNS.join() === SERVER_COLUMNS.join(), REGISTER_COLUMNS);
  const docs = src("../../../docs/pilot/templates/staff.csv").split("\n")[0].trim();
  ok("...and the header is the docs template's first line", STAFF_TEMPLATE_CSV.split("\n")[0] === docs, docs);
  const rows = registerRowsFromCsv(STAFF_TEMPLATE_CSV);
  ok("it reads clean through the server's own reader, two people", rows.length === 2 && rows.every((r) => r.name && r.email && r.role), rows);
  ok("a coach in it names a side", rows.find((r) => r.role === "coach")?.team_code === "U14A");
  ok("every address is on a reserved .invalid domain, so a left-in row is nobody", rows.every((r) => /@school\.invalid$/.test(r.email)));
  ok("it names no pupil and no parent", !/pupil|parent|guardian|player|learner/i.test(STAFF_TEMPLATE_CSV));
  ok("the rule above the table is the design's, word for word", ADULTS_ONLY === "Adults who work at the school. Never a pupil, never a parent.");
}

group("The lines of a file, named as the server numbers them");
{
  const files = {
    plain: STAFF_TEMPLATE_CSV,
    crlf: STAFF_TEMPLATE_CSV.replace(/\n/g, "\r\n"),
    bom: "﻿" + STAFF_TEMPLATE_CSV,
    loneCr: STAFF_TEMPLATE_CSV.replace(/\n/g, "\r"),
    blankMiddle: "name,email,role,team_code,valid_until\nA One,a.one@school.invalid,scorer,,\n\n,,,,\nB Two,b.two@school.invalid,scorer,,\n",
    quoted: 'name,email,role,team_code,valid_until\n"Two, Commas",c.three@school.invalid,scorer,,\n"Say ""hi""\nacross lines",d.four@school.invalid,scorer,,\n',
    reordered: "email,role,name\ne.five@school.invalid,scorer,Five Name\n",
    noTrailingNewline: "name,email,role\nF Six,f.six@school.invalid,scorer",
  };
  for (const [what, text] of Object.entries(files)) {
    const theirs = registerRowsFromCsv(text).map((r) => `${r.line}|${r.name}|${r.email}`);
    const ours = previewRows(text).map((r) => `${r.line}|${r.name}|${r.email}`);
    ok(`${what}: the same lines, names and addresses as the server's reader`, theirs.join("\n") === ours.join("\n"), `${theirs} vs ${ours}`);
  }
  ok("a file with no rows names nobody", previewRows("name,email,role\n").length === 0 && previewRows("").length === 0);
}

group("The one-person form");
{
  const good = { name: "  Example   Scorer ", email: "example.scorer@school.invalid", role: "scorer" };
  const r = rowFromForm(good);
  ok("a scorer needs no side; the row is tidy", r.ok && r.row.name === "Example Scorer" && !("team_code" in r.row) && r.row.role === "scorer", r);
  ok("...and no date means none sent (the season's end is the server's default)", r.ok && !("valid_until" in r.row));
  ok("a coach needs a side, said in words", rowFromForm({ ...good, role: "coach" }).problem === "A coach needs a side.", rowFromForm({ ...good, role: "coach" }));
  ok("...and with one, it is sent", rowFromForm({ ...good, role: "coach", team: "U14A" }).row?.team_code === "U14A");
  ok("a side typed against a scorer is not sent", !("team_code" in rowFromForm({ ...good, team: "U14A" }).row));
  ok("a name of one letter is refused", /name/.test(rowFromForm({ ...good, name: "X" }).problem));
  ok("an address that is not one is refused", /address/.test(rowFromForm({ ...good, email: "nobody" }).problem));
  ok("no role is refused", /what they do/.test(rowFromForm({ ...good, role: "" }).problem));
  ok("a claim-by date must look like a date", /2026-12-31/.test(rowFromForm({ ...good, until: "31/12/2026" }).problem));
  ok("a good date is sent as typed", rowFromForm({ ...good, until: "2026-12-31" }).row?.valid_until === "2026-12-31");
  ok("needsSide is the policy's team-scoped roles", needsSide("coach") && needsSide("assistantcoach") && needsSide("teammanager") && !needsSide("scorer"));
}

group("The roles the form offers");
{
  const office = listableRoles(GRANTABLE_ROLES.schooladmin);
  const principal = listableRoles(GRANTABLE_ROLES.principal);
  ok("the office is offered the squad's staff", ["coach", "assistantcoach", "teammanager", "scorer"].every((r) => office.includes(r)), office);
  ok("never a parent, a pupil, an enquirer or a child's own record", !["guardian", "player", "selfaccess", "enquiry"].some((r) => office.includes(r) || principal.includes(r)));
  ok("never the safeguarding officer", !principal.includes("dso"));
  ok("never a platform role", !principal.some((r) => /^(super|platform)admin$/.test(r)));
  ok("never a role over the ceiling (a physio reads a child's clinical notes)", !principal.includes("medical") && overCeiling("medical"));
  ok("...and a scorer is under it", overCeiling("scorer") === false && overCeiling("coach") === false);
  ok("every role offered is under the ceiling", [...office, ...principal].every((r) => !overCeiling(r)));
}

group("Import is offered only after a clean Check of the same file, with every warning ticked");
{
  const text = STAFF_TEMPLATE_CSV;
  const clean = { ok: true, committed: false, rows: [{ line: 2, ok: true }, { line: 3, ok: true }] };
  const warn = { line: 4, ok: true, warning: "recently_ended", ack: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", warningWords: "Ended 3 Sep (Coach (U14A)). List anyway?" };
  const checked = (report) => ({ school: "s1", key: sourceKey(text), report });
  const now = { school: "s1", key: sourceKey(text) };
  ok("nothing checked: not offered", mayCommit(null, now, []) === false);
  ok("no file: not offered", mayCommit(checked(clean), { school: "s1", key: null }, []) === false);
  ok("a clean Check of this very file: offered", mayCommit(checked(clean), now, []) === true);
  ok("another file (one cell changed): not offered", mayCommit(checked(clean), { school: "s1", key: sourceKey(text + " ") }, []) === false);
  ok("another school: not offered", mayCommit(checked(clean), { ...now, school: "s2" }, []) === false);
  ok("a form row is a different key from a file of the same words", rowsKey([{ name: "A" }]) !== sourceKey("A"));
  ok("a Check with a problem: not offered", mayCommit(checked({ ...clean, ok: false, rows: [{ line: 2, ok: false, words: "Row 2: x" }] }), now, []) === false);
  ok("a Check of no rows: not offered", mayCommit(checked({ ...clean, rows: [] }), now, []) === false);
  ok("a report that already committed: not offered again", mayCommit(checked({ ...clean, committed: true }), now, []) === false);
  const withWarn = { ...clean, rows: [...clean.rows, warn] };
  ok("a warning not ticked: not offered", mayCommit(checked(withWarn), now, []) === false);
  ok("a different warning ticked: not offered", mayCommit(checked(withWarn), now, ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]) === false);
  ok("every warning ticked: offered", mayCommit(checked(withWarn), now, [warn.ack]) === true);
  ok("warnedRows finds the ones to tick", warnedRows(withWarn).length === 1 && warnedRows(clean).length === 0);
}

group("The Check's words");
{
  const row = (line, over = {}) => ({ line, ok: true, ...over });
  ok("clean", checkWords({ rows: [row(2), row(3)] }) === "2 rows clean. Nothing is listed until you press Import.");
  ok("one row is a row", checkWords({ rows: [row(2)] }).startsWith("1 row clean"));
  ok("a problem says how many to fix and that nothing was listed", checkWords({ rows: [row(2), row(3, { ok: false })] }) === "1 row to fix. Nothing was listed.");
  ok("a warning says to tick it", /Tick the warning/.test(checkWords({ rows: [row(2, { warning: "recently_ended", ack: "x" })] })));
  ok("...and, ticked, reads clean", /clean/.test(checkWords({ rows: [row(2, { warning: "recently_ended", ack: "x" })] }, 1)));
  ok("no rows is not clean", /no rows/.test(checkWords({ rows: [] })));
  ok("imported words say how many and how they join", /^2 people listed\. They join by signing in with Google/.test(importedWords({ rows: [row(2), row(3)] })) && /^1 person listed/.test(importedWords({ rows: [row(2)] })));
  ok("every problem the server words is a sentence the person can act on (it is drawn as it comes)",
     Object.entries(PROBLEM_WORDS).every(([, f]) => /\w{4}/.test(f({ role: "Principal" }, "x"))), Object.keys(PROBLEM_WORDS));
}

group("A refusal from the register's routes");
{
  ok("the route's own sentence is shown as it comes", registerErrorWords(apiError(403, "not_permitted", "Only somebody who may appoint staff at this school can use its register.")) === "Only somebody who may appoint staff at this school can use its register.");
  ok("a missing column says what to do", /template/.test(registerErrorWords(apiError(422, "csv_columns"))));
  ok("signed out says to sign in", /Sign in/.test(registerErrorWords(apiError(401, "token_expired"))));
  ok("a request that never arrived says nothing was changed", /nothing was changed/.test(registerErrorWords(new TypeError("x"))));
  ok("a code nobody wrote words for still says what to do", /Try again/.test(registerErrorWords(apiError(500, "weird_code"))) && !registerErrorWords(apiError(500, "weird_code")).includes("weird_code"));
}

group("The list: a row's state in words");
{
  const base = { id: "i", name: "Example Coach", email: "example.coach@school.invalid", role: "coach", team_code: "U14A", valid_until: "2026-03-31", uploaded_by_name: "The Office", uploaded_at: "2026-10-03T08:00:00Z" };
  ok("open", stateWords({ ...base, state: "open" }) === "Open until 31 Mar", stateWords({ ...base, state: "open" }));
  ok("claimed and granted", stateWords({ ...base, state: "claimed", outcome: "granted", claimed_at: "2026-10-14T09:00:00Z" }) === "Joined 14 Oct");
  ok("claimed but only requested, the uploader no longer able to grant it",
     stateWords({ ...base, state: "claimed", outcome: "requested", outcome_reason: "uploader_authority_lapsed" }) === "Requested instead — the uploader may no longer grant Coach here");
  ok("claimed and requested otherwise: the office decides", /Requested instead/.test(stateWords({ ...base, state: "claimed", outcome: "requested", outcome_reason: "refused", claimed_by_name: "A Person" })));
  ok("expired", stateWords({ ...base, state: "expired" }) === "Expired 31 Mar");
  ok("withdrawn, by whom", stateWords({ ...base, state: "withdrawn", withdrawn_at: "2026-11-02T10:00:00Z", withdrawn_by_name: "The Office" }) === "Withdrawn 2 Nov by The Office");
  ok("withdrawn by somebody not named", stateWords({ ...base, state: "withdrawn", withdrawn_at: "2026-11-02T10:00:00Z" }) === "Withdrawn 2 Nov");
  ok("listed by whom and when", listedWords(base) === "Listed by The Office on 3 Oct", listedWords(base));
  ok("the role line names the side", roleLine("coach", "U14A") === "Coach (U14A)" && roleLine("scorer", null) === "Scorer");
  ok("four filters, in the design's order", STATES.map((s) => s.label).join() === "Open,Claimed,Expired,Withdrawn");
  ok("withdraw is asked in words, and says nobody is told", /Take Example Coach off the register\?/.test(withdrawAsk(base)) && /Nobody is told/.test(withdrawAsk(base)));
  ok("a cleared row's withdraw does not print a name", !/Redacted/.test(withdrawAsk({ name: "Redacted", redacted_at: "2027-01-01" })));
  ok("the clear button counts", clearLabel(4) === "Clear 4 expired rows" && clearLabel(1) === "Clear 1 expired row");
  ok("...and says what it does before it does it", /name and email/.test(clearAsk(4)) && /cannot be undone/.test(clearAsk(4)));
  ok("...and afterwards how many", clearedWords(4) === "Cleared 4 rows." && /nothing to clear/.test(clearedWords(0)));
  ok("days read the way the design writes them", dayWords("2026-09-03") === "3 Sep" && dayWords("2026-10-14T22:30:00Z") === "15 Oct" && dayWords(null) === "");
}

group("The staff member signing in");
{
  ok("granted: the server's words, as it wrote them",
     claimResult({ granted: [{ role: "coach", teamCode: "U14A" }], requested: [], words: "You're in. The office listed you as Coach (U14A)." }).words === "You're in. The office listed you as Coach (U14A).");
  ok("mixed: the server's words too", claimResult({ granted: [{ role: "scorer" }], requested: [{ role: "coach", teamCode: "U14A" }], words: "You're in as Scorer. Your Coach (U14A) request has gone to the school office." }).kind === "granted");
  ok("nothing granted is no words at all: the ordinary form follows", claimResult({ granted: [], requested: [], words: null }).kind === "none");
  ok("...even if a reply carried words but granted nothing", claimResult({ granted: [], requested: [{ role: "coach" }], words: "x" }).kind === "none");
  ok("...and a reply that is not one is nothing", claimResult(null).kind === "none" && claimResult({}).kind === "none");

  const cool = claimFailure(apiError(409, "request_cooldown", COOLDOWN_WORDS));
  ok("a cooldown is its own state", cool.kind === "cooldown" && cool.words === COOLDOWN_SENTENCE);
  ok("...said plainly: can't ask yet, the school's safeguarding lead can lift it", /can't send a request yet/.test(COOLDOWN_SENTENCE) && /safeguarding lead can lift/.test(COOLDOWN_SENTENCE));
  ok("...and never why, never who: no declined, no parent, no child, no claim, no name",
     !/declin|parent|child|guardian|claim|repeated|three|account (was|has been)|because|paused/i.test(COOLDOWN_SENTENCE), COOLDOWN_SENTENCE);
  ok("the request form says the same sentence (one source)", joinWords(apiError(409, "request_cooldown")) === COOLDOWN_SENTENCE && JOIN_WORDS.request_cooldown === COOLDOWN_SENTENCE);
  ok("a request already with the office is said plainly", /already with the school office/.test(joinWords(apiError(422, "already_pending"))) && /need not|do not need to send it again/.test(JOIN_WORDS.already_pending));
  const offline = claimFailure(new TypeError("x"));
  ok("a claim that never arrived does not block the form", offline.kind === "error" && /still send a request/.test(offline.words));
  ok("any other refusal is an error that does not block the form", claimFailure(apiError(500, "boom")).kind === "error");
  ok("signed out says to sign in", /Sign in/.test(claimFailure(apiError(401, "token_expired")).words));

  const screen = src("../src/auth/NoSchool.jsx");
  const code = screen.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("the claim goes to the register's door, once per school chosen, for staff only", /"\/api\/join\/register-claim"/.test(code) && /kind !== "staff"/.test(code));
  ok("an unlisted person is told nothing: the none branch sets no words", /setClaim\(\{ state: "none", words: "" \}\)/.test(code));
  ok("the request form is not hidden by a claim that granted nothing", /claim\.state === "none" \|\| claim\.state === "error"/.test(code));
}

group("The safeguarding officer lifting a pause");
{
  const n = { type: "safeguarding", title: PAUSE_TITLE, subjectKind: "system", subjectId: "11111111-1111-1111-1111-111111111111" };
  ok("the pause notice carries Lift the pause", liftable(n) === true);
  ok("...no other safeguarding notice does", liftable({ ...n, title: "A parent claim was declined" }) === false);
  ok("...nor a notice of another kind", liftable({ ...n, type: "system" }) === false);
  ok("...nor one without its pause's id", liftable({ ...n, subjectId: null }) === false);
  ok("the title is db/93's, word for word", PAUSE_TITLE === "An account has been paused from asking" && /An account has been paused from asking/.test(src("../../../db/93_declined_claim_notice.sql")));
  ok("the route's own sentence on a refusal", liftErrorWords(apiError(403, "not_permitted", "You cannot do that here.")) === "You cannot do that here.");
  ok("already lifted is said in the route's words", liftErrorWords(apiError(409, "already_lifted", "This pause has already been lifted.")) === "This pause has already been lifted.");
  ok("a request that never arrived says the pause may or may not be lifted", /may or may not/.test(liftErrorWords(new TypeError("x"))));
  ok("lifted, in words", /lifted/.test(LIFTED_WORDS) && !/who|name/i.test(LIFTED_WORDS));
  ok("the screen names nobody: it holds an id and no person", !/personName|person_name|email/.test(src("../src/views/liftPause.jsx").replace(/\/\*[\s\S]*?\*\//g, "")));
}

group("People: where an appointment came from");
{
  const note = "from the staff register, row 11111111-1111-1111-1111-111111111111, uploaded 2026-10-03";
  ok("a register grant says so, with the day it was listed", registerOrigin(note) === "From the staff register, listed 3 Oct");
  ok("an ordinary grant says nothing", registerOrigin(null) === null && registerOrigin("Granted from Requests") === null && registerOrigin("") === null);
  ok("a note that only mentions the register in passing says nothing", registerOrigin("see the staff register") === null);
  const people = peopleWithRoles([{ id: "u1", name: "Example Coach" }], [
    { id: "a1", personId: "u1", role: "coach", school: "s1", team: "U14A", active: true, grantedNote: note },
    { id: "a2", personId: "u1", role: "scorer", school: "s1", team: null, active: true, grantedNote: null },
  ], "2026-10-14");
  ok("peopleWithRoles carries the origin onto the role that has one", people[0].roles.find((r) => r.role === "coach").origin === "From the staff register, listed 3 Oct" && !people[0].roles.find((r) => r.role === "scorer").origin);
}

group("Who is offered the register, and what a signed-out or unlisted person sees");
{
  ok("the school office is", canSeeRegister("schooladmin") === true);
  ok("the principal is", canSeeRegister("principal") === true);
  ok("a coach is not", canSeeRegister("coach") === false);
  ok("a scorer is not", canSeeRegister("scorer") === false);
  ok("a parent is not", canSeeRegister("guardian") === false);
  ok("the panel draws nothing at all for a coach", renderToStaticMarkup(h(StaffRegisterPanel, { role: "coach" })) === "");
  ok("signed out (the demonstration) it draws nothing: there is no register to read", renderToStaticMarkup(h(StaffRegisterPanel, { role: "schooladmin" })) === "");
  ok("primaryRole picks the widest role held, for the shell after a claim", primaryRole({ assignments: [{ role: "scorer" }, { role: "coach" }] }) === "coach" && primaryRole({ assignments: [] }) === "spectator");
}

group("The floors, in the new screens' source");
{
  const files = ["../src/views/staffRegister.jsx", "../src/views/liftPause.jsx", "../src/lib/staffRegister.js"];
  for (const f of files) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const sizes = [...code.matchAll(/fontSize:\s*"(\d+(?:\.\d+)?)px"/g)].map((m) => Number(m[1]));
    ok(`${f.split("/").pop()}: nothing set under 12px`, sizes.every((s) => s >= 12), sizes.filter((s) => s < 12));
  }
  const view = src("../src/views/staffRegister.jsx").replace(/\/\*[\s\S]*?\*\//g, "");
  const heights = [...view.matchAll(/minHeight:\s*"(\d+)px"/g)].map((m) => Number(m[1]));
  ok("every button, field and tick has a 44px floor", heights.length >= 3 && heights.every((x) => x >= 44), heights);
  ok("the new screens add no dependency: they import from the app and the policy only",
     files.every((f) => [...src(f).matchAll(/^import .* from "([^"]+)"/gm)].every((m) => /^(\.|react$|@scrbrd\/policy)/.test(m[1]))));
  ok("the register's screens read no pupil or parent list", !/\/api\/read\/(players|children|pupils|guardians)/.test(view));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
