/**
 * CRI-3.2, tap-to-passport: "parent own child; coach squad; public nothing".
 *
 * The client never offers the passport link to a reader the passport read
 * would refuse. The read is passport() (db/124), whose arms are
 * passport_open_not_union() and a union's named reader; lib/passportLink.js
 * draws a link on the first three of those arms and no wider. This holds:
 *
 *   1 the readers, one by one (the brief's and REACH-D2's);
 *   2 the capabilities and scopes it draws on are the SQL's own, read from
 *     db/124, and db/124 is still the last word on the gate;
 *   3 every role in roles.mjs: no role reaches a link without one of those
 *     capabilities, and none through a pending or ended family link;
 *   4 the wiring: the Match Centre asks it, the public page passes nothing,
 *     and the sheet reads the passport and nothing else, in its own chunk.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/passport-link.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { FAMILY_ROLES, PASSPORT_ARMS, opensPassportOf } from "../src/lib/passportLink.js";
import { ROLES, roleGrants, SUBJECT_SCOPED_ROLES } from "@scrbrd/policy/roles";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const HIL = "hil", WES = "wes";
const BOY = { id: "boy", school: HIL, team: "1XI" };       // her child, and the pupil himself
const MATE = { id: "mate", school: HIL, team: "1XI" };     // his team-mate
const U14 = { id: "u14", school: HIL, team: "U14A" };      // another side at his school
const AWAY = { id: "away", school: WES, team: "1XI" };     // the other school's boy, same team code
const as = (role, school = HIL, team = null, x = {}) => ({ role, school, team, fixture: null, subjects: [], liveSubjects: [], ...x });
const fam = (role, ids, live = ids) => as(role, HIL, null, { subjects: ids, liveSubjects: live });
const who = (asg) => [BOY, MATE, U14, AWAY].filter((p) => opensPassportOf(p, asg)).map((p) => p.id).join();

group("1 · Who gets a link on whose row");
ok("a parent: her own child's row, and no other boy's", who([fam("guardian", ["boy"])]) === "boy");
ok("...two children in one match: both, and nobody else's", who([fam("guardian", ["boy", "u14"])]) === "boy,u14");
ok("...a link the office has not verified, or that ended, is no link (liveSubjects, db/119)",
   who([fam("guardian", ["boy"], [])]) === "" && who([{ ...as("guardian"), subjects: ["boy"] }]) === "");
ok("...her child's row needs no roster row: the family arm is the link alone",
   opensPassportOf({ id: "boy" }, [fam("guardian", ["boy"])]));
ok("REACH-D2: a pupil, his own row and no team-mate's, though his side's `player` role reads profiles",
   who([as("player", HIL, "1XI"), fam("selfaccess", ["boy"])]) === "boy");
ok("...a pupil with no self link: none", who([as("player", HIL, "1XI")]) === "");
ok("a coach: his own side's boys, not another side's, not the other school's", who([as("coach", HIL, "1XI")]) === "boy,mate");
ok("...the away side's coach: his own boys only", who([as("coach", WES, "1XI")]) === "away");
ok("...his team manager the same", who([as("teammanager", HIL, "1XI")]) === "boy,mate");
ok("...an assistant coach holds no team.select or profile.manage: none", who([as("assistantcoach", HIL, "1XI")]) === "");
ok("...a coach named for one boy reaches that boy on a live link only",
   who([as("coach", HIL, "1XI", { subjects: ["mate"], liveSubjects: ["mate"] })]) === "mate"
   && who([as("coach", HIL, "1XI", { subjects: ["mate"], liveSubjects: [] })]) === "");
ok("the director and the sports admin, school-wide: every boy at the school", who([as("directorofsport")]) === "boy,mate,u14"
   && who([as("sportsadmin")]) === "boy,mate,u14");
ok("the office (guardian.link.manage), any side at its school", who([as("schooladmin")]) === "boy,mate,u14" && who([as("principal")]) === "boy,mate,u14");
ok("the platform account, tenant-less, reaches every school as app_can() does", who([as("superadmin", null)]) === "boy,mate,u14,away");
ok("a scorer's one-fixture assignment: none (passport() asks with no fixture)",
   who([as("scorer", HIL, "1XI", { fixture: "f1" })]) === "" && who([as("coach", HIL, "1XI", { fixture: "f1" })]) === "");
ok("a spectator, an umpire, a physio: none", who([as("spectator")]) === "" && who([as("umpire")]) === "" && who([as("physio", HIL, "1XI")]) === "");
ok("a union's selector: none (his reads are logged to the family; he opens them on purpose)", who([as("unionselector", "kzn")]) === "");
ok("an enquiry naming the boy: none", who([as("enquiry", HIL, null, { subjects: ["boy"], liveSubjects: ["boy"] })]) === "");
ok("a support session past its hour: none", who([as("directorofsport", HIL, null, { expiresAt: new Date(Date.now() - 60e3).toISOString() })]) === "");
ok("signed out or in the demonstration (no assignments): none", who([]) === "" && who(null) === "" && who(undefined) === "");
ok("a row with no id, or a staff reader with no roster row for him: none",
   !opensPassportOf({ id: null }, [as("directorofsport")]) && !opensPassportOf({ id: "boy" }, [as("directorofsport")]));
ok("a boy whose roster row names no side: not his side's coach's, still the office's",
   !opensPassportOf({ id: "x", school: HIL, team: null }, [as("coach", HIL, "1XI")])
   && opensPassportOf({ id: "x", school: HIL, team: null }, [as("schooladmin")]));

group("2 · No wider than the read: db/124's arms, and db/124 the last word");
{
  const sql = src("../../../db/124_union_passport.sql");
  const body = /CREATE OR REPLACE FUNCTION passport_open_not_union\(p_player uuid\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)?.[1] ?? "";
  // The arm at his own school, up to the named-school (consent) arm.
  const own = body.split(/OR EXISTS \(SELECT 1 FROM passport_consent/)[0] ?? "";
  const calls = [...own.matchAll(/app_can\('([a-z.]+)',\s*p\.school_id,\s*([^,]+),/g)].map((m) => ({ cap: m[1], team: m[2].trim() }));
  const side = calls.filter((c) => c.team === "p.team_code").map((c) => c.cap).sort();
  const school = calls.filter((c) => c.team.startsWith("'*'")).map((c) => c.cap).sort();
  ok("the family arm is is_family_of(), as the link's family arm reads", /^\s*SELECT is_family_of\(p_player\)/.test(body));
  ok("the side arm's capabilities are the SQL's (team.select, player.profile.manage at his side)",
     side.join() === [...PASSPORT_ARMS.side].sort().join(), side);
  ok("the school-wide arm's are the SQL's (guardian.link.manage, any side)",
     school.join() === [...PASSPORT_ARMS.school].sort().join(), school);
  ok("...and the own-school arm calls app_can no other way", calls.length === side.length + school.length && calls.length === 3, calls);
  ok("the side arm asks about him (p.id), the school arm about anybody (the zero id)",
     /app_can\('team\.select', p\.school_id, p\.team_code, p\.id, NULL::uuid\)/.test(own)
     && /app_can\('guardian\.link\.manage', p\.school_id, '\*'::text,\s*'00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid\)/.test(own));
  ok("passport() itself still opens only through passport_open_not_union() or the union arm",
     /IF NOT passport_open_not_union\(p_player\) THEN[\s\S]*?v_union := passport_union_consent\(p_player\);/.test(sql));
  const files = readdirSync(new URL("../../../db/", import.meta.url)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  const last = (re) => files.filter((f) => re.test(src(`../../../db/${f}`))).at(-1);
  ok("db/124 is the last migration to define passport_open_not_union(); a later one means this link is reviewed again",
     last(/FUNCTION passport_open_not_union\(/) === "124_union_passport.sql", last(/FUNCTION passport_open_not_union\(/));
  ok("...and passport()", last(/FUNCTION passport\(p_player/) === "124_union_passport.sql", last(/FUNCTION passport\(p_player/));
  ok("...and is_family_of() is db/119's, read through the session's liveSubjects",
     last(/FUNCTION is_family_of\(/) === "119_family_of_live.sql" && /liveSubjects: a\.live_subjects/.test(src("../../../services/api/auth/auth-db.mjs")));
  ok("the read the sheet makes is passport($1) and only that", /from passport\(\$1::uuid\)/.test(src("../../../services/api/read/read-api.mjs")));
}

group("3 · Every role: a link only through one of the gate's capabilities");
{
  const ARM_CAPS = [...PASSPORT_ARMS.side, ...PASSPORT_ARMS.school];
  const everyPlace = [BOY, U14, AWAY];
  const wrong = [];
  for (const role of ROLES) {
    // The widest assignment the role can hold: tenant-less, no side, naming nobody.
    const wide = [as(role, null)];
    const any = everyPlace.some((p) => opensPassportOf(p, wide));
    const grants = !FAMILY_ROLES.includes(role) && !SUBJECT_SCOPED_ROLES.includes(role) && ARM_CAPS.some((c) => roleGrants(role, c));
    if (any !== grants) wrong.push(role);
    // A family role naming the boy on a link not live: never.
    if (opensPassportOf(BOY, [{ ...as(role), subjects: ["boy"], liveSubjects: [] }]) && !grants) wrong.push(`${role}:pending`);
  }
  ok("a role gets a link exactly when it holds a gate capability and is not person-scoped", wrong.length === 0, wrong);
  ok("the family roles are is_family_of()'s two", FAMILY_ROLES.join() === "guardian,selfaccess");
}

group("4 · The wiring: the Match Centre asks, the public page has nothing, the sheet is its own chunk");
{
  const mv = src("../src/views/matchcentre/MatchView.jsx");
  const sc = src("../src/views/matchcentre/scorecard.jsx");
  const sheet = src("../src/views/matchcentre/passportSheet.jsx");
  const pub = src("../src/public/PublicMatch.jsx");
  ok("MatchView draws a link only signed in, off a real log, and only where opensPassportOf() says so",
     /const passportOf = [\s\S]{0,200}if \(!signedIn\(\) \|\| log\.demo \|\| !id\) return null;[\s\S]{0,200}opensPassportOf\(\{ id, school: p\?\.school \?\? null, team: p\?\.team \?\? null \}, profile\(\)\?\.assignments\)/.test(mv));
  ok("...the sheet is a lazy import there, and nowhere statically",
     /const PassportSheet = lazy\(\(\) => import\("\.\/passportSheet\.jsx"\)\)/.test(mv) && !/import [^;]*from "\.\/passportSheet\.jsx"/.test(mv));
  ok("the scorecard has no link of its own: none unless handed passportOf", /passportOf = \(\) => null/.test(sc) && !/import[^;]*passport(Link|Sheet)/.test(sc));
  ok("the public page hands it none, and imports neither", !/passportOf|passportLink|passportSheet/.test(pub));
  ok("...nor does anything under public/", readdirSync(new URL("../src/public/", import.meta.url))
     .filter((f) => /\.jsx?$/.test(f)).every((f) => !/passportOf|passportLink|passportSheet/.test(src(`../src/public/${f}`))));
  const reads = [...sheet.matchAll(/useLive\("([a-z_]+)"/g)].map((m) => m[1]);
  ok("the sheet makes one read, the passport, for this boy", reads.join() === "passport" && /useLive\("passport", role, nonce, \{ playerId: player\.id \}\)/.test(sheet), reads);
  ok("...no api() or fetch of its own", !/\bapi\(|fetch\(/.test(sheet));
  const sizes = [...sheet.matchAll(/fontSize:\s*"(\d+)px"/g), ...sc.matchAll(/fontSize:\s*"(\d+)px"/g)].map((m) => Number(m[1]));
  ok("nothing under 12px in the sheet or the scorecard", sizes.every((n) => n >= 12), sizes.filter((n) => n < 12));
  ok("the sheet's controls are 44px", (sheet.match(/minHeight: "44px"/g) ?? []).length >= 2 && /minWidth: "44px"/.test(sheet));
  ok("the sheet honours reduced motion, by the system and by the root's setting",
     /@media \(prefers-reduced-motion: reduce\)\{\.mc-pass-scrim,\.mc-pass-card\{animation:none!important\}\}/.test(sheet)
     && /:root\[data-reduce-motion\] \.mc-pass-scrim/.test(sheet));
  ok("...Escape closes it, focus returns to the row's button", /e\.key === "Escape"/.test(sheet) && /back\)\.focus\(\)/.test(sheet) && /from: e\?\.currentTarget/.test(mv));
  ok("...and no colour outside the theme tokens", !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(sheet));
}

{
  const { groupLines } = await import("../src/views/matchcentre/passportSheet.jsx");
  const g = groupLines([{ family: "milestone", label: "50" }, { family: "cap", label: "1XI cap #4" }, { family: "career", label: "Batting" }, { family: "honour", label: "Colours" }]);
  ok("the sheet's sections run career, caps, honours, milestones", g.map((x) => x.family).join() === "career,cap,honour,milestone");
}

console.log(`\n${"─".repeat(52)}\nPASSPORT LINK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
