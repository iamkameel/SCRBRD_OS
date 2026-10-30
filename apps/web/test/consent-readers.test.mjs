/**
 * Whose consents a person is shown (REACH R-B, db/115), for the Settings and
 * family consent cards. Presentation only: the rows come from the server
 * under the tables' own policies, which db/99 §92 proves. This holds the
 * screen to the same reader set, so that a team-mate's absent row is never
 * drawn as "no decision recorded", and a coach handed an empty passport list
 * is told whose list it is rather than that no school has been named.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/consent-readers.test.mjs
 */
import { readFileSync } from "node:fs";
import { familyOf, passportConsentReader, readsScoutingOf } from "../src/lib/held.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", WES = "wes";
const A = { id: "a", school: HIL, team: "18XI" };   // and M, his team-mate
const M = { id: "m", school: HIL, team: "18XI" };
const B = { id: "b", school: HIL, team: "19XI" };   // another side
const W = { id: "w", school: WES, team: "18XI" };   // the same team code at another school
const as = (role, school, team = null, subjects = []) => ({ role, school, team, subjects });

group("Family: the boys a guardian or self-access link names");
ok("a guardian's children and a pupil's own record", [...familyOf([as("guardian", HIL, null, ["a"]), as("selfaccess", HIL, null, ["m"])])].sort().join() === "a,m");
ok("a granted enquiry names a boy and is not his family", familyOf([as("enquiry", HIL, null, ["a"])]).size === 0);
ok("a coach is nobody's family", familyOf([as("coach", HIL, "18XI")]).size === 0);
// db/119: the session's liveSubjects are the links verified and live today.
const ended = { ...as("guardian", HIL, null, ["a", "m"]), liveSubjects: ["m"] };
ok("a link that ended by its date, or is pending, is not family (liveSubjects wins)",
   [...familyOf([ended])].join() === "m");
ok("...so the ended boy's scouting decision is not drawn, and the live one's is",
   !readsScoutingOf(A, [ended]) && readsScoutingOf(M, [ended]));
ok("a guardian whose every link has ended is nobody's family, and reads no passport consent",
   familyOf([{ ...as("guardian", HIL, null, ["a"]), liveSubjects: [] }]).size === 0
   && passportConsentReader([{ ...as("guardian", HIL, null, ["a"]), liveSubjects: [] }]) === null);
const authDb = readFileSync(new URL("../../../services/api/auth/auth-db.mjs", import.meta.url), "utf8");
ok("the session's liveSubjects are verified, begun and not ended, as is_family_of() asks (db/119)",
   /g\.verification_state = 'verified'/.test(authDb) && /g\.valid_from <= current_date/.test(authDb)
   && /g\.valid_until is null or g\.valid_until > current_date/.test(authDb) && /liveSubjects: a\.live_subjects/.test(authDb));

group("The scouting decision: his family, his school's office, his own side's coach");
const scout = (asg) => [A, M, B, W].filter((p) => readsScoutingOf(p, asg)).map((p) => p.id).join();
ok("his guardian reads his, and no other family's", scout([as("guardian", HIL, null, ["a"])]) === "a");
ok("O6: a pupil reads his own and no team-mate's, though his side holds player.profile.read",
   scout([as("player", HIL, "18XI"), as("selfaccess", HIL, null, ["a"])]) === "a");
ok("a pupil with no self link reads none", scout([as("player", HIL, "18XI")]) === "");
ok("his side's coach and assistant read the side's", scout([as("coach", HIL, "18XI")]) === "a,m" && scout([as("assistantcoach", HIL, "18XI")]) === "a,m");
ok("another side's coach reads his own side's only", scout([as("coach", HIL, "19XI")]) === "b");
ok("the same team code at another school is another side", scout([as("coach", WES, "18XI")]) === "w");
ok("the director of sport reads his school's", scout([as("directorofsport", HIL)]) === "a,m,b");
ok("the office reads his school's, and not another school's", scout([as("schooladmin", HIL)]) === "a,m,b" && scout([as("principal", WES)]) === "w");
for (const role of ["teammanager", "scorer", "medical", "analyst", "scout", "spectator"])
  ok(`a ${role} reads none`, scout([as(role, HIL, role === "teammanager" ? "18XI" : null)]) === "");
ok("the demo, with no assignments, lists every boy as before", scout([]) === "a,m,b,w");

group("The passport consents: the family, and the office of the school named");
ok("a guardian reads the schools she named", passportConsentReader([as("guardian", HIL, null, ["a"])]) === "family");
ok("a pupil through his self link reads his own", passportConsentReader([as("player", HIL, "18XI"), as("selfaccess", HIL, null, ["a"])]) === "family");
ok("a school administrator or principal reads what names the school", passportConsentReader([as("schooladmin", WES)]) === "office" && passportConsentReader([as("principal", WES)]) === "office");
ok("the owner's key reads as an office", passportConsentReader([as("superadmin", null)]) === "office");
for (const [role, team] of [["coach", "1XI"], ["directorofsport", null], ["player", "1XI"], ["scorer", null], ["spectator", null]])
  ok(`a ${role} reads none, and is told so`, passportConsentReader([as(role, WES, team)]) === null);
ok("the demo draws the family's card, as before", passportConsentReader([]) === "family");

group("The cards ask these, and say whose list it is");
const settings = readFileSync(new URL("../src/views/SettingsView.jsx", import.meta.url), "utf8");
ok("the scouting card lists only the boys whose decision the reader is shown", /offered\.filter\(\(p\) => readsScoutingOf\(p\)\)/.test(settings));
ok("...and a reader shown none is told whose it is", /Not yours to see\. A boy's scouting decision is read by his family, his school's office and his own coach\./.test(settings));
ok("the passport card's empty state is the reader's", /PASSPORT_NONE\[passportConsentReader\(\) \?\? "none"\]/.test(settings)
   && /family: "No school has been named\."/.test(settings) && /office: "No family has named your school\."/.test(settings)
   && /none: "Not yours to see\./.test(settings));
// db/122 §1d (Kameel, 29 Oct 2026): a withdrawal that withdrew nothing is a
// 403 from the route, and the card says why instead of saying nothing.
ok("a refused withdrawal is said in words, on a 403",
   /setSaid\(e\?\.status === 403 \? PASSPORT_WITHDRAW_REFUSED/.test(settings)
   && /PASSPORT_WITHDRAW_REFUSED = "That name was not taken back\. Only his family/.test(settings));
ok("...and the boy's own words say he may take a name back at any age",
   /You can take a school's name back yourself at any time\./.test(settings));

console.log(`\n${fail ? "✗" : "✓"} consent-readers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
