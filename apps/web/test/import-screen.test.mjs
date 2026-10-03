/**
 * Settings → Import and the Staff screen: the pure halves, and the two places
 * a list on the client could drift from the server.
 *
 *   - THE KINDS. The importer's registry is the server's IMPORTS and no read
 *     lists it, so the screen keeps a short list beside it (lib/importScreen.js).
 *     This reads the two together: a kind the server imports that the screen
 *     does not offer, a label that differs, or a capability that is not one
 *     the policy knows, fails here and not in an office.
 *   - IMPORT IS OFFERED ONLY AFTER A CLEAN CHECK OF THE SAME FILE: another
 *     kind, school or file, a file with a problem, an empty one, and a commit
 *     report all say no.
 *   - THE WORDS: a line number in the route's own words, never a code.
 *   - WHO SEES IT: the office and the owner, not a coach, a scorer or a parent;
 *     and the screen draws nothing for a coach.
 *   - STAFF: the people who hold a staff role at the school, from the two
 *     reads People uses; a parent is not staff; a coach who is also a parent is
 *     one entry, as a coach; an ended or not-yet-started role is not staff.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/import-screen.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IMPORTS } from "../../../services/api/io/import-api.mjs";
import { isCapability } from "@scrbrd/policy/capabilities";
import { roleGrants } from "@scrbrd/policy/roles";
import { IMPORT_KINDS, MAX_FILE_BYTES, checkSummary, errorWords, importSummary, kindsHeld, mayImport, refusalWords } from "../src/lib/importScreen.js";
import { NOT_STAFF, rolesPresent, staffFrom } from "../src/lib/staff.js";
import { ROLES } from "../src/design/roles.js";
import { ImportPanel, canImport } from "../src/views/importer.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

group("The screen offers exactly the kinds the server imports");
{
  const server = Object.keys(IMPORTS).sort();
  const screen = IMPORT_KINDS.map((k) => k.id).sort();
  ok("every kind the server imports is on the screen's list (add a row to IMPORT_KINDS)", server.every((k) => screen.includes(k)), `server ${server} screen ${screen}`);
  ok("...and the screen lists none the server does not", screen.every((k) => server.includes(k)));
  ok("each label is the server's", IMPORT_KINDS.every((k) => IMPORTS[k.id]?.label === k.label));
  ok("each capability is one the policy knows", IMPORT_KINDS.every((k) => isCapability(k.cap)), IMPORT_KINDS.map((k) => k.cap));
  ok("each kind's template columns exist, so the download has something to say", IMPORT_KINDS.every((k) => IMPORTS[k.id].template.length > 0));
}

group("Who is offered the screen");
{
  const holds = (role) => (cap) => roleGrants(role, cap);
  ok("the school office is offered players", kindsHeld(holds("schooladmin")).some((k) => k.id === "players"));
  ok("the director of sport is", kindsHeld(holds("directorofsport")).length > 0);
  ok("a coach is offered nothing", kindsHeld(holds("coach")).length === 0);
  ok("a scorer is offered nothing", kindsHeld(holds("scorer")).length === 0);
  ok("a parent is offered nothing", kindsHeld(holds("guardian")).length === 0);
  ok("canImport answers the same from the client's own role layer", canImport("schooladmin") === true && canImport("coach") === false && canImport("scorer") === false);
  ok("the panel draws nothing at all for a coach", renderToStaticMarkup(h(ImportPanel, { role: "coach" })) === "");
  const signedOut = renderToStaticMarkup(h(ImportPanel, { role: "schooladmin" }));
  ok("signed out, the office is asked to sign in and is given no form", /Sign in to the live platform/.test(signedOut) && !/import-file/.test(signedOut));
}

group("Import is offered only after a clean Check of the same file");
{
  const clean = { clean: true, committed: false, rows: 3, errors: [] };
  const checked = { kind: "players", schoolId: "s1", text: "full_name\nA\nB\nC\n", report: clean };
  const now = { kind: "players", schoolId: "s1", text: "full_name\nA\nB\nC\n" };
  ok("nothing checked: not offered", mayImport(null, now) === false);
  ok("no file: not offered", mayImport(checked, { ...now, text: null }) === false);
  ok("a clean Check of this very file: offered", mayImport(checked, now) === true);
  ok("another file (one cell changed): not offered", mayImport(checked, { ...now, text: "full_name\nA\nB\nD\n" }) === false);
  ok("another school: not offered", mayImport(checked, { ...now, schoolId: "s2" }) === false);
  ok("another kind: not offered", mayImport(checked, { ...now, kind: "guardians" }) === false);
  ok("a Check with a problem: not offered", mayImport({ ...checked, report: { ...clean, clean: false, errors: [{ line: 3 }] } }, now) === false);
  ok("a clean Check of no rows: not offered", mayImport({ ...checked, report: { ...clean, rows: 0 } }, now) === false);
  ok("a report that already committed: not offered again", mayImport({ ...checked, report: { ...clean, committed: true } }, now) === false);
}

group("The words");
{
  ok("a line, a column and the route's own sentence",
     errorWords({ line: 7, column: "born", message: "must be a date like 2011-04-07 (day/month order is ambiguous and is not guessed)" })
       === "Line 7, born: must be a date like 2011-04-07 (day/month order is ambiguous and is not guessed)");
  ok("a line with no column", errorWords({ line: 9, column: null, message: "not permitted at this school" }) === "Line 9: not permitted at this school");
  ok("a file-level problem says File", errorWords({ message: "x" }) === "File: x");
  ok("clean rows, counted", checkSummary({ clean: true, rows: 12, errors: [], wouldInsert: 12, wouldUpdate: 0 }) === "12 rows clean (12 new). Nothing is written until you press Import.");
  ok("one row is singular, with its updates", checkSummary({ clean: true, rows: 1, errors: [], wouldInsert: 0, wouldUpdate: 1 })
       === "1 row clean (1 already there, to be updated). Nothing is written until you press Import.");
  ok("problems, counted, and nothing written", checkSummary({ clean: false, rows: 2, errors: [{}, {}, {}] }) === "3 problems to fix. Nothing was written.");
  ok("one problem is singular", /^1 problem to fix/.test(checkSummary({ errors: [{}] })));
  ok("a file with no rows is not clean", checkSummary({ clean: true, rows: 0, errors: [] }) === "The file has no rows to import.");
  ok("the result line", importSummary({ rows: 5, inserted: 4, updated: 1 }) === "Imported 5 rows: 4 added, 1 updated.");
  ok("...and with only additions", importSummary({ rows: 1, inserted: 1, updated: 0 }) === "Imported 1 row: 1 added.");
  ok("a refusal code has a sentence, not the code", !/not_permitted/.test(refusalWords({ code: "not_permitted", status: 403 })) && /may not import/.test(refusalWords({ code: "not_permitted" })));
  ok("an unknown code is still said, with nothing written", /Nothing was written/.test(refusalWords({ code: "weird", status: 500 })));
  ok("no answer at all is said as that", /did not answer/.test(refusalWords(new Error("x"))));
  ok("a prototype name is not a code", /did not answer/.test(refusalWords({ code: "constructor" })));
  ok("the size cap sits under the server's 256 KB body limit", MAX_FILE_BYTES < 256 * 1024);
}

group("Staff: the people who hold a staff role at the school");
{
  const TODAY = "2026-10-03";
  const u = (id, name, role, extra = {}) => ({ id, name, email: `${id}@example.invalid`, role, school: "S", status: "active", teams: [], lastLogin: null, ...extra });
  const a = (id, personId, role, extra = {}) => ({ id, personId, role, team: null, active: true, validFrom: null, validUntil: null, suspended: false, ...extra });
  const users = [
    u("u1", "C Hendricks", "coach"), u("u2", "D Pillay", "parent"), u("u3", "Sarah M", "directorofsport"),
    u("u4", "A Wessels", "scorer"), u("u5", "R Pillay", "player"), u("u6", "Old Coach", "coach"), u("u7", "No Reads", "medical"),
    u("u8", "Platform Ops", "platformadmin"),
  ];
  const assignments = [
    a("a1", "u1", "coach", { team: "1XI" }), a("a2", "u2", "guardian"),
    a("a3", "u3", "directorofsport"), a("a4", "u3", "guardian"), a("a5", "u3", "coach", { team: "U16B" }),
    a("a6", "u4", "scorer", { team: "1XI" }), a("a7", "u5", "player"), a("a8", "u5", "selfaccess"),
    a("a9", "u6", "coach", { active: false }), a("a10", "u8", "platformadmin"),
  ];
  const staff = staffFrom(users, assignments, TODAY);
  const names = staff.map((s) => s.name);
  ok("the coach, the director of sport and the scorer are staff", ["C Hendricks", "Sarah M", "A Wessels"].every((n) => names.includes(n)), names);
  ok("a parent is not", !names.includes("D Pillay"));
  ok("a pupil is not", !names.includes("R Pillay"));
  ok("the platform's own account is not", !names.includes("Platform Ops"));
  ok("a coach whose role was withdrawn is not", !names.includes("Old Coach"));
  ok("an account the assignments read says nothing about keeps its one role, so a reader without it still sees a physio", names.includes("No Reads"));
  const sarah = staff.find((s) => s.name === "Sarah M");
  ok("a director of sport who is also a parent is one entry", names.filter((n) => n === "Sarah M").length === 1);
  ok("...with her staff roles only, the guardian role left off", sarah.roles.map((r) => r.role).sort().join() === "coach,directorofsport");
  ok("...and a coach's side is on its role", sarah.roles.find((r) => r.role === "coach").team === "U16B");
  ok("sorted by name", names.join("|") === [...names].sort((x, y) => x.localeCompare(y)).join("|"));
  ok("a paused role is still staff, and says so", staffFrom([u("p", "P", "coach")], [a("x", "p", "coach", { suspended: true })], TODAY)[0]?.roles[0].state === "paused");
  ok("a role that has not started is not staff yet", staffFrom([u("f", "F", "coach")], [a("y", "f", "coach", { validFrom: "2026-11-01" })], TODAY).length === 0);
  ok("nothing read is an empty list, not a crash", staffFrom([], [], TODAY).length === 0 && staffFrom(undefined, undefined, TODAY).length === 0);
  ok("the roles present, once each", rolesPresent(staff).sort().join() === "coach,directorofsport,medical,scorer");
  ok("every word in NOT_STAFF is a role the product knows, or the old account word", [...NOT_STAFF].every((r) => r === "parent" || Object.hasOwn(ROLES, r)), [...NOT_STAFF]);
  ok("no staff role in the policy's vocabulary is thrown out by name", ["coach", "assistantcoach", "teammanager", "scorer", "medical", "driver", "facilities", "principal", "schooladmin", "dso"].every((r) => !NOT_STAFF.has(r)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
