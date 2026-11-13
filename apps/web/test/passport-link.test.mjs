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
import { FAMILY_ROLES, PASSPORT_ARMS, PLATFORM_ROLES, opensPassportOf } from "../src/lib/passportLink.js";
import { ROLES, roleGrants, SUBJECT_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { ROLE_IDENTITY } from "../src/design/roles.js";

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
// Kameel, 13 Nov 2026: no scorecard passport link for the platform account.
ok("the platform account (superadmin), tenant-less: no link on any school's rows, though the read would open them",
   who([as("superadmin", null)]) === "" && who([as("superadmin")]) === "" && who([as("superadmin", WES, "1XI")]) === "");
ok("...nor the platform administrator", who([as("platformadmin", null)]) === "" && who([as("platformadmin")]) === "");
ok("...the platform's roles are the ones holding a platform-only capability, and the design's platform family, exactly",
   PLATFORM_ROLES.join() === "superadmin,platformadmin"
   && [...PLATFORM_ROLES].sort().join() === Object.keys(ROLE_IDENTITY).filter((r) => ROLE_IDENTITY[r].family === "platform").sort().join(),
   PLATFORM_ROLES);
ok("...a platform reader who also coaches keeps the coach's link, and only the coach's",
   who([as("superadmin", null), as("coach", HIL, "1XI")]) === "boy,mate"
   && who([as("coach", WES, "1XI"), as("superadmin", null)]) === "away");
ok("...who is also the office at one school keeps that school's", who([as("platformadmin", null), as("schooladmin")]) === "boy,mate,u14");
ok("...who is also a parent keeps her own child's", who([as("superadmin", null), fam("guardian", ["u14"])]) === "u14");
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
  ok("the side arm asks about him (p.id) with no fixture, both its capabilities exactly; the school arm about anybody (the zero id)",
     /app_can\('team\.select', p\.school_id, p\.team_code, p\.id, NULL::uuid\)/.test(own)
     && /app_can\('player\.profile\.manage', p\.school_id, p\.team_code, p\.id, NULL::uuid\)/.test(own)
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
  const readApi = src("../../../services/api/read/read-api.mjs");
  ok("the reads the sheet makes are passport($1) and passport_name($1), and only those",
     /from passport\(\$1::uuid\)/.test(readApi) && /select passport_name\(\$1::uuid\) as name/.test(readApi));
  // app_can() is how the side and school arms scope (the link's reaches() copies it).
  ok("app_can() is db/50's, the scoping the link copies; a later one means this link is reviewed again",
     last(/FUNCTION app_can\(/) === "50_pad_resume.sql", last(/FUNCTION app_can\(/));
  // Who holds the gate's capabilities is roles.mjs's here and role_capability's
  // there: db/01 writes the table whole; no later migration may add or take a
  // row for one of the three without this link being looked at again.
  const GATE = [...PASSPORT_ARMS.side, ...PASSPORT_ARMS.school];
  const touches = [];
  for (const f of files.filter((x) => parseInt(x) > 1 && !x.startsWith("99_"))) {
    const text = src(`../../../db/${f}`).replace(/--[^\n]*/g, "");
    for (const stmt of text.split(";")) {
      if (!/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+role_capability\b/i.test(stmt)) continue;
      const pats = [...stmt.matchAll(/capability\s+(?:NOT\s+)?I?LIKE\s+'([^']+)'/gi)].map((m) => new RegExp(`^${m[1].replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`));
      const broad = /^\s*(DELETE\s+FROM|UPDATE)/i.test(stmt.trim()) && !/capability\s*(=|IN\b|I?LIKE)/i.test(stmt);
      if (GATE.some((c) => stmt.includes(`'${c}'`) || pats.some((p) => p.test(c))) || broad) touches.push(f);
    }
  }
  ok("no migration after db/01 adds or takes a role_capability row for team.select, player.profile.manage or guardian.link.manage",
     touches.length === 0, touches);
  ok("...and db/01 still grants them as roles.mjs does", GATE.every((c) => ROLES.filter((r) => roleGrants(r, c)).every((r) =>
     new RegExp(`\\('${r}',\\s*'${c.replace(/\./g, "\\.")}'\\)`).test(src("../../../db/01_authz.sql")))));
}

group("2b · A duty suspension never reaches a link: it rests only on a one-fixture assignment, which the link skips");
{
  const d34 = src("../../../db/34_duty_authority.sql");
  ok("a suspension is written by duty_suspend() alone, on the duty's own assignment (match_official.assignment_id)",
     /INSERT INTO duty_suspension \(duty_id, assignment_id, school_id, suspended_by, reason\)\s*VALUES \(d\.id, d\.assignment_id,/.test(d34)
     && /REVOKE INSERT, UPDATE, DELETE ON duty_suspension FROM scrbrd_app/.test(d34));
  ok("...that assignment is duty_link()'s, made for the one fixture",
     /INSERT INTO role_assignment \(person_id, role, school_id, team_code, fixture_id\)\s*VALUES \(d\.person_id, v_role, d\.school_id, NULL, d\.match_id\)/.test(d34)
     && /UPDATE match_official SET assignment_id = v_new/.test(d34));
  ok("...kept one-fixture by the linked guard, and not re-pointed by the application role",
     /NEW\.fixture_id\s+IS DISTINCT FROM OLD\.fixture_id/.test(d34) && /the application role can write match_official\.assignment_id directly/.test(d34));
  const files = readdirSync(new URL("../../../db/", import.meta.url)).filter((f) => /^\d+_.*\.sql$/.test(f) && parseInt(f) > 34 && !f.startsWith("99_"));
  const later = files.filter((f) => /INSERT INTO duty_suspension|SET assignment_id|FUNCTION duty_link\(|FUNCTION duty_suspend\(|FUNCTION role_assignment_linked_guard\(/.test(src(`../../../db/${f}`)));
  ok("...and no later migration writes a suspension, re-points a duty or redefines those three", later.length === 0, later);
  ok("so the link's skip of every one-fixture assignment covers every suspended one",
     !opensPassportOf(BOY, [as("coach", HIL, "1XI", { fixture: "f1" })]) && !opensPassportOf(BOY, [as("directorofsport", HIL, null, { fixture: "f1" })]));
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
    const grants = !FAMILY_ROLES.includes(role) && !SUBJECT_SCOPED_ROLES.includes(role) && !PLATFORM_ROLES.includes(role)
      && ARM_CAPS.some((c) => roleGrants(role, c));
    if (any !== grants) wrong.push(role);
    // A family role naming the boy on a link not live: never.
    if (opensPassportOf(BOY, [{ ...as(role), subjects: ["boy"], liveSubjects: [] }]) && !grants) wrong.push(`${role}:pending`);
  }
  ok("a role gets a link exactly when it holds a gate capability and is neither person-scoped nor the platform's", wrong.length === 0, wrong);
  ok("the family roles are is_family_of()'s two", FAMILY_ROLES.join() === "guardian,selfaccess");
}

group("4 · The wiring: the Match Centre asks, the public page has nothing, the sheet is its own chunk");
{
  const mv = src("../src/views/matchcentre/MatchView.jsx");
  const sc = src("../src/views/matchcentre/scorecard.jsx");
  const sheet = src("../src/views/matchcentre/passportSheet.jsx");
  const pub = src("../src/public/PublicMatch.jsx");
  ok("MatchView draws a link only signed in, off a real log, and only where opensPassportOf() says so",
     /const linkable = useMemo\(\(\) => \{\s*if \(!signedIn\(\) \|\| log\.demo \|\| !cardIds\) return new Set\(\);[\s\S]{0,300}opensPassportOf\(\{ id, school: p\?\.school \?\? null, team: p\?\.team \?\? null \}, asg\)/.test(mv)
     && /const asg = profile\(\)\?\.assignments;/.test(mv)
     && /const passportOf = [^\n]*\n\s*if \(!id \|\| !linkable\.has\(id\)\) return null;/.test(mv));
  ok("N2: the boys who get a link are decided once per change of the card or the roster, not per row",
     /\}, \[cardIds, PLAYERS, log\.demo\]\);/.test(mv) && !/PLAYERS\.find\(\(x\) => x\.id === id\)/.test(mv.split("const linkable")[1] ?? ""));
  ok("N1: the bowler link's › is hidden from a screen reader; the batter's button is named with his name",
     /Passport <span aria-hidden="true">›<\/span>/.test(mv) && /aria-label=\{`Passport, \$\{name\}`\}/.test(mv));
  ok("...the sheet is a lazy import there, and nowhere statically",
     /const PassportSheet = lazy\(\(\) => import\("\.\/passportSheet\.jsx"\)\)/.test(mv) && !/import [^;]*from "\.\/passportSheet\.jsx"/.test(mv));
  ok("the scorecard has no link of its own: none unless handed passportOf", /passportOf = \(\) => null/.test(sc) && !/import[^;]*passport(Link|Sheet)/.test(sc));
  ok("the public page hands it none, and imports neither", !/passportOf|passportLink|passportSheet/.test(pub));
  ok("...nor does anything under public/", readdirSync(new URL("../src/public/", import.meta.url))
     .filter((f) => /\.jsx?$/.test(f)).every((f) => !/passportOf|passportLink|passportSheet/.test(src(`../src/public/${f}`))));
  const reads = [...sheet.matchAll(/useLive\("([a-z_]+)"/g)].map((m) => m[1]);
  ok("the sheet makes two reads for this boy: the passport, and its door (passport_name, S1)", reads.join() === "passport,passport_name"
     && /useLive\("passport", role, nonce, \{ playerId: player\.id \}\)/.test(sheet) && /useLive\("passport_name", role, nonce, \{ playerId: player\.id \}\)/.test(sheet), reads);
  ok("N3: the page behind does not scroll while it is open, and is given back as it was",
     /h\.el\.style\.overflow = "hidden"/.test(sheet) && /h\.el\.style\.overflow = h\.was/.test(sheet) && /overscrollBehavior: "contain"/.test(sheet));
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
  const { groupLines, sheetState } = await import("../src/views/matchcentre/passportSheet.jsx");
  const g = groupLines([{ family: "milestone", label: "50" }, { family: "cap", label: "1XI cap #4" }, { family: "career", label: "Batting" }, { family: "honour", label: "Colours" }]);
  ok("the sheet's sections run career, caps, honours, milestones", g.map((x) => x.family).join() === "career,cap,honour,milestone");

  group("5 · S1: refused is not empty");
  const answered = (rows) => ({ rows, loading: false, error: null, status: null, live: true });
  const line = { family: "career", label: "Batting", value: "34 runs in 1 innings" };
  const refused = sheetState(answered([]), answered([{ name: null }]));
  ok("the read refuses him (passport_name null): \"You can't open his passport now.\", no retry, no lines",
     refused.state === "refused" && refused.sentence === "You can't open his passport now." && !refused.retry, refused);
  ok("...even if passport() had somehow answered lines, they are not drawn (the door decides)",
     sheetState(answered([line]), answered([{ name: null }])).state === "refused");
  ok("...a door that answered no row at all is shut, not open", sheetState(answered([]), answered([])).state === "refused");
  const empty = sheetState(answered([]), answered([{ name: "R Pillay" }]));
  ok("the read admits him and his record is empty: \"Nothing on his record yet.\"", empty.state === "empty" && empty.sentence === "Nothing on his record yet.", empty);
  ok("admitted with lines: drawn", sheetState(answered([line]), answered([{ name: "R Pillay" }])).state === "ok");
  ok("either read still on its way: reading, never refused or empty",
     sheetState(answered([]), { rows: [], loading: true, error: null }).state === "loading"
     && sheetState({ rows: [], loading: true, error: null }, answered([{ name: "R Pillay" }])).state === "loading");
  const failed = sheetState(answered([]), { rows: [], loading: false, error: "unreachable", status: null });
  ok("the door's read failed: said as a failure with a retry, not as refused", failed.state === "failed" && failed.retry, failed);
  ok("the passport's read failed with the door open: a failure with a retry, not empty",
     sheetState({ rows: [], loading: false, error: "unreachable", status: null }, answered([{ name: "R Pillay" }])).state === "failed");
}

console.log(`\n${"─".repeat(52)}\nPASSPORT LINK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
