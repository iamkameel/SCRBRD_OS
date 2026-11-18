/**
 * EXPERIENCE_PASS Slice 6, "The office": Settings taken apart (§1.6), the
 * School and Platform homes' parts, the set-up list (§2.7) and "A parent is
 * waiting" landing on her request, and the Safeguarding Officer's route (Q7).
 *
 * The homes' gates are proved role by role in homes.test.mjs; this holds the
 * parts themselves: a person's own Settings carries nobody else's accounts, a
 * moved part keeps its own gate inside it, and the set-up list reads nothing.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/office.test.mjs
 */
import { readFileSync } from "node:fs";
import { roleGrants } from "@scrbrd/policy/roles";
import { NAV_ALSO, NAV_CAPABILITY, ROLES } from "../src/design/roles.js";
import { HOMES, homeParts } from "../src/design/homes.js";
import { forgetSetup, learnSetup, setupKey, setupLearned, setupLines } from "../src/lib/setupList.js";
import { fixFor } from "../src/lib/fixNote.js";
import { doorsFor } from "../src/views/queueDoors.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

group("Settings, taken apart (§1.6): a person's own Settings is theirs");
{
  const settings = src("../src/views/SettingsView.jsx");
  const own = settings.slice(settings.indexOf("function OwnSettings("), settings.indexOf("/** Settings' Roles"));
  ok("own Settings offers Me, and a Passport only for a reader with his own record", /\{ id: "me"/.test(settings) && /id: "passport".*offered: \(\) => ownRecordsOf\(\)\.size > 0/.test(settings));
  ok("...and reads nothing of anybody else's: no accounts, roster, staff or claims read in it",
     !/useRows\(|useLive\(/.test(own), own.slice(0, 200));
  ok("the parts are named, and each draws one thing", ["people", "roles", "record", "roadmap", "support", "dls"].every((p) => settings.includes(`part === "${p}"`)));
  ok("People carries the claims (user.invite), the accounts, and Import with the register (their own gates)",
     /function PeoplePart\(/.test(settings) && /canClaims\s*=\s*holdsCapability\(role,\s*"user\.invite"\)/.test(settings)
     && /\(canImport\(role\) \|\| canSeeRegister\(role\)\) && \(/.test(settings));
  ok("the support and DLS panels keep their own gates inside them", /function SupportAccessPanel\(/.test(src("../src/views/support.jsx")) && /holdsCapability/.test(src("../src/views/support.jsx")) && /cap|holdsCapability|platform\.reference\.manage/.test(src("../src/views/dlsTables.jsx")));
  ok("the no-account figure carries its denominator", /sub=\{`of \$\{players\.length\} cannot sign in yet`\}/.test(settings));
  // (SettingsView imports package.json, so it is held by its source here and drawn by the walks.)
  ok("a parent's Settings: Me, and none of People, Roles, School, Roadmap or Import: those are parts, never tabs of it",
     /function OwnSettings\(/.test(settings) && !/id: "users"|id: "roles"|id: "school"|id: "upgrades"|id: "import"/.test(settings.slice(settings.indexOf("const OWN_TABS"), settings.indexOf("// ── Small shared pieces"))));
  ok("...with no tab strip when Me is the only tab", /\{tabs\.length > 1 && \(/.test(own));
  const app = src("../src/App.jsx");
  ok("the shell routes each part to its home's section",
     /staff:\s+<><StaffView role=\{role\}\/><SettingsView role=\{role\} part="people"/.test(app) && /record:\s+<SettingsView\s+role=\{role\} part="record"/.test(app)
     && /management:\s+<><ManagementView[^>]*\/><SettingsView role=\{role\} part="roles"/.test(app)
     && /support:\s+<SettingsView\s+role=\{role\} part="support"\/>/.test(app) && /dls:\s+<SettingsView\s+role=\{role\} part="dls"\/>/.test(app)
     && /roadmap:\s+<SettingsView\s+role=\{role\} part="roadmap"\/>/.test(app));
  ok("...and Settings itself is the person's own", /settings:\s+<SettingsView\s+role=\{role\} onSignOut=\{handleSignOut\}\/>/.test(app));
  const profiles = src("../src/views/ProfilesView.jsx");
  ok("the office's Passport is on the player page, behind a tap, so opening a boy reads none of it",
     /<PassportConsentPart key=\{p\.id\} player=\{p\} role=\{role\}\/>/.test(profiles) && /\{open&&\(/.test(profiles) && /lazy\(\(\) => import\("\.\/SettingsView\.jsx"\)/.test(profiles));
  ok("a family keeps it on the child's file", /<PassportTab role=\{role\} only=\{\[child\]\}\/>/.test(src("../src/views/family/childfile.jsx")));
}

group("The School and Platform homes keep each part's gate (or the home's, never wider)");
{
  ok("Record: user.read, or a capability one of its panels is drawn under", NAV_CAPABILITY.record === "user.read"
     && eq([...NAV_ALSO.record], ["broadcast.publish", "transport.lift.policy", "audit.read"]));
  ok("Platform's sections under the capabilities their panels had", NAV_CAPABILITY.requests === "platform.tenant.manage"
     && NAV_CAPABILITY.support === "platform.support.impersonate" && NAV_CAPABILITY.dls === "platform.reference.manage" && NAV_CAPABILITY.roadmap === "platform.tenant.manage");
  ok("School requests are no longer drawn on Management", !/SchoolRequestsPanel/.test(src("../src/views/ManagementView.jsx")));
  const sections = (r, k) => homeParts(k, ROLES[r].nav).sections.map((s) => s.key);
  ok("the transport coordinator has no School (§1.8), and his lift purge is on Logistics, Transport (review SF4)",
     !homeParts("staff", ROLES.transportcoordinator.nav).visible && roleGrants("transportcoordinator", "transport.lift.oversee")
     && sections("transportcoordinator", "logistics").includes("transport")
     && /schoolsWhere\("transport\.lift\.oversee"\)\.length>0&&\(\s*<div data-testid="logistics-lift-purge"><Suspense fallback=\{null\}><LiftPurgePanel\/>/.test(src("../src/views/LogisticsView.jsx")));
  ok("a parent reaches neither home", !homeParts("staff", ROLES.guardian.nav).visible && !homeParts("pitchdeck", ROLES.guardian.nav).visible);
  ok("School is keyed on Staff and Platform on the Pitch deck (nav-staff, nav-pitchdeck land where they did)", HOMES.staff.key === "staff" && HOMES.pitchdeck.key === "pitchdeck");
}

group("The set-up list (§2.7): each line opens its fix, and goes when it is true");
{
  const office = ["dashboard", "matches", "squad", "staff", "management", "record", "readiness"];
  const all = () => true;
  const base = { reach: office, mayDo: all, matches: { answered: true, count: 0 }, players: [], parentsWaiting: 0, claimsWaiting: 0, account: "me", schools: ["A"], known: new Set() };
  const keys = (o) => (setupLines({ ...base, ...o }) ?? []).map((l) => l.key);
  ok("a new school: staff, pupils, teams, the first fixture, and what is public, in §2.7's order", eq(keys({}), ["staff", "pupils", "teams", "fixture", "public"]), keys({}));
  ok("...a parent waiting adds her line before what is public", eq(keys({ parentsWaiting: 1 }), ["staff", "pupils", "teams", "fixture", "parents", "public"]));
  ok("...'A parent is waiting', and two are '2 parents are waiting'", setupLines({ ...base, parentsWaiting: 1 }).find((l) => l.key === "parents").fact === "A parent is waiting"
     && setupLines({ ...base, parentsWaiting: 2 }).find((l) => l.key === "parents").fact === "2 parents are waiting");
  ok("a Google sign-in claim is not counted as a parent (the read does not say whose account it is)", !keys({ claimsWaiting: 3 }).includes("parents"));
  ok("pupils imported: that line goes; sides made: that one too", !keys({ players: [{ id: "p" }] }).includes("pupils") && keys({ players: [{ id: "p" }] }).includes("teams")
     && !keys({ players: [{ id: "p", team: "U13A" }] }).includes("teams"));
  ok("the register said a row is listed, and the listing that the school chose: those go", !keys({ known: new Set([setupKey("me", "A", "staff")]) }).includes("staff")
     && !keys({ known: new Set([setupKey("me", "A", "public")]) }).includes("public"));
  // Review SF3: what a screen said is this account's, about that school.
  ok("...never another account's word on the same device", keys({ known: new Set([setupKey("someone", "A", "staff"), setupKey("someone", "A", "public")]) }).includes("staff")
     && keys({ known: new Set([setupKey("someone", "A", "public")]) }).includes("public"));
  ok("...nor one school's for another: at two schools, the line goes when both have said so",
     keys({ schools: ["A", "B"], known: new Set([setupKey("me", "A", "staff")]) }).includes("staff")
     && !keys({ schools: ["A", "B"], known: new Set([setupKey("me", "A", "staff"), setupKey("me", "B", "staff")]) }).includes("staff"));
  ok("...and with no account or no school, nothing counts as said", keys({ account: null, known: new Set([setupKey(null, "A", "staff")]) }).includes("staff")
     && keys({ schools: [], known: new Set([setupKey("me", "A", "staff")]) }).includes("staff"));
  ok("a fixture exists: no list at all", setupLines({ ...base, matches: { answered: true, count: 1 } }) === null);
  ok("the fixtures read not answered yet (or failed): no list, rather than a wrong one", setupLines({ ...base, matches: { answered: false, count: 0 } }) === null);
  ok("a coach (no School home) has no list", setupLines({ ...base, reach: ["dashboard", "matches", "squad", "readiness"] }) === null);
  ok("each line is drawn only where its capability is held: a director who may not import has no pupils line",
     !keys({ mayDo: (c) => c !== "player.profile.manage" }).includes("pupils") && !keys({ mayDo: (c) => c !== "user.role.assign" }).includes("staff")
     && !keys({ mayDo: (c) => c !== "broadcast.publish" }).includes("public"));
  const lines = setupLines(base);
  ok("every line has the office as owner and one door to a screen in reach", lines.every((l) => l.owner === "The office" && office.includes(l.door.page)));
  ok("...the staff line lands on the register, the pupils line on Import, the public line on Record",
     lines.find((l) => l.key === "staff").door.fix === '[data-testid="register-panel"]' && lines.find((l) => l.key === "pupils").door.fix === '[data-testid="import-panel"]'
     && lines.find((l) => l.key === "public").door.page === "record");
  forgetSetup(); learnSetup("staff", "A", "me"); learnSetup("public", "A", null); learnSetup("public", null, "me");
  ok("learnSetup keeps what a screen says for one account at one school, and nothing without both",
     eq([...setupLearned()], [setupKey("me", "A", "staff")]));
  forgetSetup();
  ok("forgetSetup forgets it all", setupLearned().size === 0);
  ok("signing out forgets it", /const handleSignOut = [\s\S]{0,300}forgetSetup\(\);/.test(src("../src/App.jsx")));
  const lib = src("../src/lib/setupList.js");
  ok("the set-up list makes no read of its own", !/^\s*import\s|api\(|useLive|useRows|fetch\(/m.test(lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  ok("the register and the listing say so when they draw it", /learnSetup\("staff", school, profile\(\)\?\.user\?\.id\)/.test(src("../src/views/staffRegister.jsx")) && /learnSetup\("public", schoolId, profile\(\)\?\.user\?\.id\)/.test(src("../src/views/listing.jsx")));
  const needs = src("../src/views/needsyou.jsx");
  ok("Today draws it inside Needs you, from the queue's rows and Today's own fixtures and players reads", /setupLines\(\{ reach, mayDo/.test(needs) && /data-testid="setup-list"/.test(needs)
     && /matchesAnswered=\{\[matchesRead, playersRead\]\.every/.test(src("../src/views/DashboardView.jsx")));
}

group("A parent is waiting: the row lands on her request; the claims on School, People");
{
  ok("the requests note lands on the one request, and falls back to the panel", eq(fixFor("requests", { requestId: "r1" }), { page: "management", find: ['[data-testid="request-row-r1"]'], fallback: ['[data-testid="requests-panel"]'] }));
  ok("...without one, the panel", eq(fixFor("requests"), { page: "management", find: ['[data-testid="requests-panel"]'] }));
  ok("the claims are School, People's now", fixFor("claims").page === "staff");
  const went = [];
  const door = doorsFor({ nav: ["staff", "management"], byId: new Map(), assignments: [], onNav: (p) => went.push(p) });
  door({ action: { kind: "claims", label: "Confirm" } }).go();
  door({ action: { kind: "requests", label: "Decide", requestId: "r9" } }).go();
  ok("the claims door opens School, People; the parents' door Access", eq(went, ["staff", "management"]));
  ok("...and no door for a reader without the screen", doorsFor({ nav: ["dashboard"], byId: new Map(), assignments: [], onNav: () => {} })({ action: { kind: "claims", label: "Confirm" } }) === null);
}

group("The Safeguarding Officer's route (Q7): Today, then the bell's notice, then the inbox");
{
  const app = src("../src/App.jsx");
  ok("nobody lands on Safeguarding: the DSO opens on Today like everyone else", !/setPage\("safeguarding"\)\s*;?\s*\}?\s*,\s*\[/.test(app) && !/safeguarding\.concern\.read/.test(app));
  const notes = src("../src/views/NotificationsView.jsx");
  ok("a safeguarding notice opens the inbox in one tap, for a holder of safeguarding.concern.read only",
     /const dso = !!onNav && holdsAsHeld\(role, "safeguarding\.concern\.read"\)/.test(notes) && /\{dso && n\.type === "safeguarding" && \(/.test(notes)
     && /onNav\("safeguarding"\)/.test(notes) && /notifications:<NotificationsView role=\{role\} onNav=\{setPage\}\/>/.test(app));
  ok("...landed on the inbox itself (review SF2): a fix note for sg-inbox before the screen opens",
     /requestFix\(\{ page: "safeguarding", find: \['\[data-testid="sg-inbox"\]'\] \}\); onNav\("safeguarding"\)/.test(notes));
  ok("...the button is on the row, not inside the opened notice (the bell, then the notice: one tap)",
     notes.indexOf('data-testid="notice-open-inbox"') > notes.indexOf("{liftable(n)") && !/isOpen && dso/.test(notes));
  ok("Today's alerts and Home's notices never list a safeguarding notice", /NOTIFICATIONS\.filter\(\(n\) => !n\.read && n\.type !== "safeguarding"\)/.test(src("../src/views/DashboardView.jsx"))
     && /mine\.filter\(\(n\) => !n\.read && n\.type !== "safeguarding"\)/.test(src("../src/views/family/cards.jsx")));
  ok("the DSO card is still drawn last on Today", /dso && <div style=\{\{ marginTop: T\.space\.lg \}\}>\{dso\}<\/div>\}\s*<\/div>/.test(src("../src/views/DashboardView.jsx")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
