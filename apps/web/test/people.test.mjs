/**
 * Management's people list: every person with every role they hold.
 *
 * The pure half (lib/people.js) is checked over hand-built rows with the day
 * named, never the clock. The drawn half is rendered signed-out — the
 * demonstration — where the screen reads the seeded directory and must offer
 * nothing that writes; and the enrolment form is rendered for two callers to
 * show the role picker offers what GRANTABLE_ROLES gives each and no more.
 * The browser walk (tools/smoke-browser-management.mjs) proves the same
 * against a real server and database.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/people.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GRANTABLE_ROLES } from "@scrbrd/policy/roles";
import { accountAction, liveRoles, matchesPerson, peopleWithRoles, roleState } from "../src/lib/people.js";
import { PeoplePanel } from "../src/views/people.jsx";
import { AccountButton, DisableConfirm, accountRefusalWords, setAccountActive, ACCOUNT_WORDS } from "../src/views/accountactive.jsx";
import { ManagementView } from "../src/views/ManagementView.jsx";
import { ENROL_MESSAGE, EnrolModal, enrolWords, grantableFor } from "../src/views/enrol.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const TODAY = "2026-10-01";

group("A role's state on a named day");
{
  const live = { active: true };
  ok("an active appointment with no dates is live", roleState(live, TODAY) === "live");
  ok("withdrawn is ended", roleState({ active: false }, TODAY) === "ended");
  ok("dated out on the day is ended (the policy's t >= until)", roleState({ active: true, validUntil: TODAY }, TODAY) === "ended");
  ok("dated out tomorrow is still live", roleState({ active: true, validUntil: "2026-10-02" }, TODAY) === "live");
  ok("dated out last term is ended", roleState({ active: true, validUntil: "2026-06-30" }, TODAY) === "ended");
  ok("not yet started is upcoming, not live", roleState({ active: true, validFrom: "2026-11-01" }, TODAY) === "upcoming");
  ok("paused by the office is paused, not live and not ended", roleState({ active: true, suspended: true }, TODAY) === "paused");
  ok("withdrawn beats paused", roleState({ active: false, suspended: true }, TODAY) === "ended");
}

const users = [
  { id: "u1", name: "Sarah Mokoena", email: "sarah@example.invalid", role: "coach", school: "s1", status: "active", player: null },
  { id: "u2", name: "T Ndlovu", email: "u14coach@example.invalid", role: "coach", school: "s1", status: "active", player: null },
  { id: "u3", name: "T Ndlovu", email: "registrar.wes@example.invalid", role: "schooladmin", school: "s2", status: "active", player: null },
  { id: "u4", name: "R Pillay", email: "pillay@example.invalid", role: "player", school: "s1", status: "active", player: "p5" },
  { id: "u5", name: "Quiet Person", email: "quiet@example.invalid", role: "spectator", school: "s1", status: "inactive", player: null },
];
const asg = (id, personId, role, extra = {}) => ({ id, personId, role, team: null, active: true, validFrom: null, validUntil: null, suspended: false, revokedAt: null, ...extra });
const assignments = [
  asg("a1", "u1", "coach", { team: "U16B" }),
  asg("a2", "u1", "directorofsport"),
  asg("a3", "u1", "guardian", { active: false, revokedAt: "2026-03-12T08:00:00Z" }),
  asg("a4", "u1", "assistantcoach", { team: "1XI", validUntil: "2026-06-30" }),
  asg("a5", "u2", "coach", { team: "U14A" }),
  asg("a6", "u3", "schooladmin"),
  asg("a7", "u4", "player", { team: "1XI" }),
  asg("a8", "u4", "selfaccess"),
];

group("Each person, with every role they hold");
{
  const people = peopleWithRoles(users, assignments, TODAY);
  const sarah = people.find((p) => p.id === "u1");
  ok("one entry per account", people.length === users.length);
  ok("Sarah holds four appointments, all shown", sarah.roles.length === 4, sarah.roles.map((r) => r.role).join(","));
  ok("...the live ones first, the ended last", sarah.roles.map((r) => r.state).join(",") === "live,live,ended,ended", sarah.roles.map((r) => r.state).join(","));
  ok("...a coach of U16B keeps her side", sarah.roles.find((r) => r.role === "coach").team === "U16B");
  ok("...the withdrawn one says the day it was withdrawn", sarah.roles.find((r) => r.role === "guardian").endedOn === "2026-03-12");
  ok("...the dated-out one says the day it was dated out", sarah.roles.find((r) => r.role === "assistantcoach").endedOn === "2026-06-30");
  ok("two accounts of one name stay two (by id, not name)", people.filter((p) => p.name === "T Ndlovu").length === 2
     && people.find((p) => p.id === "u2").roles[0].role === "coach" && people.find((p) => p.id === "u3").roles[0].role === "schooladmin");
  ok("a pupil holds the team role and his own record", people.find((p) => p.id === "u4").roles.map((r) => r.role).sort().join() === "player,selfaccess");
  ok("an account the assignments say nothing about keeps the role it was opened with, live",
     JSON.stringify(people.find((p) => p.id === "u5").roles.map((r) => [r.role, r.state])) === '[["spectator","live"]]');
  ok("with no assignments read at all, every account still shows one role",
     peopleWithRoles(users, [], TODAY).every((p) => p.roles.length === 1));
  ok("liveRoles leaves out the ended", liveRoles(sarah).length === 2);
}

group("The filters look across all of a person's roles");
{
  const people = peopleWithRoles(users, assignments, TODAY);
  const label = (r) => ({ directorofsport: "Director of Sport", assistantcoach: "Assistant Coach" }[r] ?? r);
  const who = (f) => people.filter((p) => matchesPerson(p, f, { label })).map((p) => p.id).join(",");
  ok("by a second role, not just the first", who({ role: "directorofsport" }) === "u1");
  ok("by a role that has ended", who({ role: "guardian" }) === "u1");
  ok("by status", who({ status: "inactive" }) === "u5");
  ok("search finds the words on screen, not the code", who({ q: "director of sport" }) === "u1");
  ok("search finds a side", who({ q: "u14a" }) === "u2");
  ok("search finds an email", who({ q: "pillay@" }) === "u4");
  ok("filters combine", who({ role: "coach", status: "active", q: "u16b" }) === "u1");
  ok("nothing matches nothing", who({ q: "zzzz" }) === "");
}

group("Disable or Enable is offered only where db/81's rule would allow it (account lifecycle D2)");
{
  // Two schools; the office (registrar) at s1, the director of sport at s1,
  // the owner's key and the platform account belonging to no school.
  const S1 = "s1", S2 = "s2";
  const me = (id, ...as) => ({ user: { id }, assignments: as.map(([role, school]) => ({ role, school })) });
  const office = me("off", ["schooladmin", S1]);
  const dos = me("dos", ["directorofsport", S1]);
  const coach = me("co", ["coach", S1]);
  const owner = me("own", ["superadmin", null]);
  const platform = me("plat", ["platformadmin", null]);
  const role = (r, school = S1, state = "live") => ({ key: `${r}-${school}`, role: r, school, state });
  const person = (id, roles, { school = S1, status = "active" } = {}) => ({ id, name: id, school, status, roles });

  const coachP = person("c1", [role("coach")]);
  const parent = person("g1", [role("guardian")]);
  const pupil = person("p1", [role("player"), role("selfaccess")]);
  const principal = person("pr", [role("principal")]);
  const dso = person("ds", [role("dso")]);
  const physio = person("ph", [role("medical")]);
  const twoSchools = person("x2", [role("coach"), role("guardian", S2)]);
  const plat = person("pa", [role("platformadmin", null)], { school: null });

  ok("the office may disable a coach, a parent and a pupil (selfaccess with player)",
     accountAction(coachP, office) === "disable" && accountAction(parent, office) === "disable" && accountAction(pupil, office) === "disable");
  ok("...a disabled one is offered Enable instead", accountAction({ ...coachP, status: "inactive" }, office) === "enable");
  ok("...but never its principal, its DSO or its physio", [principal, dso, physio].every((p) => accountAction(p, office) === null));
  ok("...nor somebody who holds a role at a second school", accountAction(twoSchools, office) === null);
  ok("...nor an account at another school", accountAction(person("w1", [role("coach", S2)], { school: S2 }), office) === null);
  ok("...nor its own account (cannot_disable_yourself)", accountAction(person("off", [role("schooladmin")]), office) === null);
  ok("a paused role still counts; an ended or upcoming one does not",
     accountAction(person("q1", [role("coach"), role("medical", S1, "paused")]), office) === null
     && accountAction(person("q2", [role("coach"), role("medical", S1, "ended"), role("principal", S1, "upcoming")]), office) === "disable");
  ok("the director of sport may disable the physio she appoints, not a parent she cannot",
     accountAction(physio, dos) === "disable" && accountAction(parent, dos) === null);
  ok("a coach (no user.invite) is offered nothing", [coachP, parent, pupil].every((p) => accountAction(p, coach) === null));
  ok("a platform-wide account: the owner's key only", accountAction(plat, owner) === "disable" && accountAction(plat, office) === null
     && accountAction(plat, platform) === null);
  ok("the platform account (no user.invite) gains no school authority (db/86)", accountAction(coachP, platform) === null);
  ok("the owner's key reaches a school's account from no school", accountAction(principal, owner) === "disable");
  ok("signed out (no profile), nothing", accountAction(coachP, null) === null);
}

group("Disable and Enable, drawn and posted");
{
  const p = { id: "c1", name: "C Example" };
  const closed = renderToStaticMarkup(h(AccountButton, { person: p, action: "disable" }));
  ok("Disable account is a 44px button naming whose account", /Disable account/.test(closed) && /min-height:44px/.test(closed)
     && /aria-label="Disable C Example&#x27;s account"/.test(closed), closed);
  ok("Enable account, for a disabled one", /Enable account/.test(renderToStaticMarkup(h(AccountButton, { person: p, action: "enable" }))));
  ok("nothing for an action of null", renderToStaticMarkup(h(AccountButton, { person: p, action: null })) === "");
  const form = renderToStaticMarkup(h(DisableConfirm, { name: "C Example", busy: false, refusal: "", onConfirm: () => {}, onCancel: () => {} }));
  ok("the confirmation says every device is signed out now, and the roles stay",
     /signs C Example out of every device now and stops them signing in\. Their roles stay\./.test(form), form);
  ok("...with two 44px buttons, the safe one first and focused, the destructive one not the default",
     (form.match(/min-height:44px/g) ?? []).length === 2 && form.indexOf("Keep it active") < form.indexOf("Disable account")
     && /autofocus=""[^>]*>Keep it active|data-testid="account-disable-cancel"[^>]*autofocus/i.test(form.replace(/\n/g, "")), form);
  ok("...nothing under 12px in it", ![...form.matchAll(/font-size:(\d+)px/g)].some((m) => Number(m[1]) < 12));
  const refused = renderToStaticMarkup(h(DisableConfirm, { name: "C Example", busy: false, refusal: "You cannot do this for that account. The school office that enrolled them can.", onConfirm: () => {}, onCancel: () => {} }));
  ok("a refusal is said in words, as an alert", /role="alert"[^>]*>You cannot do this for that account\./.test(refused));

  const calls = [];
  const yes = async (url, opts) => { calls.push([url, opts?.method]); return { ok: true, active: url.endsWith("/enable") }; };
  const d = await setAccountActive("c1", false, yes);
  const e = await setAccountActive("c1", true, yes);
  ok("disable posts to /api/auth/users/:id/disable, enable to /enable",
     calls[0][0] === "/api/auth/users/c1/disable" && calls[1][0] === "/api/auth/users/c1/enable" && calls.every((c) => c[1] === "POST"));
  ok("...and answers what the server says the account now is", d.ok && d.active === false && e.ok && e.active === true);
  const no = await setAccountActive("pr", false, async () => { throw Object.assign(new Error("x"), { status: 403, code: "not_permitted", detail: "You cannot do this for that account. The school office that enrolled them can." }); });
  ok("a refusal carries the server's sentence", !no.ok && no.code === "not_permitted" && /school office that enrolled them/.test(no.words));
  ok("cannot_disable_yourself and an unanswered post have words too",
     accountRefusalWords({ status: 403, detail: "You cannot disable or enable your own account. Ask a colleague at the office." }).startsWith("You cannot disable")
     && accountRefusalWords(new TypeError("fetch failed")) === ACCOUNT_WORDS.unreachable);
}

group("Signed out: the seeded directory, and nothing that writes");
{
  const out = renderToStaticMarkup(h(PeoplePanel, { role: "superadmin", players: [], onDirectoryChanged: () => {} }));
  const rows = (out.match(/data-testid="person-row-/g) ?? []).length;
  ok("the seeded people are listed", rows >= 10, rows);
  ok("...each with a role chip", (out.match(/data-testid="role-chip"/g) ?? []).length >= rows);
  ok("no Add user", !/Add user/.test(out));
  ok("no Add role", !/Add role|Add a role/.test(out));
  ok("the 'coming' line is gone: disabling is real now", !/Suspending an account is coming/.test(out) && !/people-coming/.test(out));
  ok("no Disable or Enable signed out (db/85 is a write)", !/Disable account|Enable account|account-disable-|account-enable-/.test(out));
  ok("no End role signed out (db/77 is a write)", !/data-testid="end-role"/.test(out));
  ok("it says it is the demonstration", /demonstration directory/.test(out));
  ok("no Edit, Promote, Suspend or Delete", !/>(Edit|Promote|Suspend|Delete|Restore)</.test(out));
}

group("The role picker offers what the caller may grant, and no more");
{
  const picks = (role) => {
    const out = renderToStaticMarkup(h(EnrolModal, { role, players: [], onClose: () => {}, onEnrolled: () => {} }));
    const sel = /data-testid="enrol-role"[^>]*>(.*?)<\/select>/s.exec(out)?.[1] ?? "";
    return [...sel.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  };
  const office = picks("schooladmin");
  ok("the school office is offered exactly its grant list", JSON.stringify([...office].sort()) === JSON.stringify([...GRANTABLE_ROLES.schooladmin].sort()), office.join(","));
  ok("...and not the clinical or commercial roles it is kept from",
     !office.some((r) => ["medical", "finance", "sponsorship", "principal", "directorofsport", "superadmin", "platformadmin"].includes(r)));
  const head = picks("principal");
  ok("the principal is offered the clinical ones the office is not", head.includes("medical") && head.includes("finance"));
  ok("a role with no grant list is offered nothing", picks("coach").length === 0 && grantableFor("coach").length === 0);
}

group("A refusal is said in words");
{
  ok("a known code has its sentence", enrolWords("not_permitted") === ENROL_MESSAGE.not_permitted && /may not/.test(enrolWords("not_permitted")));
  const unknown = enrolWords("check_violation");
  ok("an unknown code is still a sentence, and not the code", /not saved/.test(unknown) && !/check_violation/.test(unknown), unknown);
  ok("no message is a bare code", Object.values(ENROL_MESSAGE).every((m) => /\s/.test(m) && /[.]$/.test(m)));
  // db/86: the server's refusal of a platform role at a school, in words.
  ok("a platform role at a school is refused in words", enrolWords("platform_role_needs_no_school")
     === "That role belongs to no school, so it cannot be given at one.");
}

group("The tabs a person has are the capabilities they hold");
{
  const tabsOf = (role) => {
    const out = renderToStaticMarkup(h(ManagementView, { role, onDirectoryChanged: () => {} }));
    return { out, tabs: [...out.matchAll(/data-testid="mgmt-tab-([a-z]+)"/g)].map((m) => m[1]) };
  };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok("a groundskeeper has Ground tasks and nothing else", eq(tabsOf("facilities").tabs, ["grounds"]), tabsOf("facilities").tabs);
  ok("a coach has the squad (team.manage) and nothing else", eq(tabsOf("coach").tabs, ["squad"]), tabsOf("coach").tabs);
  ok("a principal — who may assign roles and read the audit — has Users and Audit log, not the coach's squad",
     eq(tabsOf("principal").tabs, ["users", "audit"]), tabsOf("principal").tabs);
  ok("a director of sport has the Users tab her capability earns, and is on it", eq(tabsOf("directorofsport").tabs, ["users", "squad", "fixtures", "broadcast", "audit", "grounds"]) && /data-testid="people-panel"/.test(tabsOf("directorofsport").out), tabsOf("directorofsport").tabs);
  ok("a school admin has every tab but Broadcast, which she does not hold", eq(tabsOf("schooladmin").tabs, ["users", "squad", "fixtures", "audit", "grounds"]), tabsOf("schooladmin").tabs);
  ok("reading the people (user.read) is not the audit log (audit.read): a bursar has neither tab", eq(tabsOf("finance").tabs, []), tabsOf("finance").tabs);
  ok("a role with none of these is told so, and drawn no tab", eq(tabsOf("spectator").tabs, []) && /Nothing on this screen is yours to manage/.test(tabsOf("spectator").out));
  ok("the screen opens on the first tab a person has — a groundskeeper is not shown the directory", !/people-panel/.test(tabsOf("facilities").out));
  // The audit log: holders of audit.read; signed out (as this render is), one
  // plain line asking for a sign-in and nothing else (db/79). The demo directory
  // (the Users tab) legitimately names Hendricks and Khumalo, so what is
  // checked is the invented ENTRIES, on the tab that used to carry them.
  const audit = tabsOf("dso");
  ok("a holder of audit.read and nothing else has the Audit log tab, opened on it", eq(audit.tabs, ["audit"]), audit.tabs);
  ok("...which, signed out, asks for a sign-in and lists nothing", /Sign in to see the audit log\./.test(audit.out)
     && !/data-testid="audit-row"/.test(audit.out) && !/The audit log is coming/.test(audit.out));
  const invented = /Updated fixture|Added training session|role changed|scorecard submitted|Medical clearance|New user created|Coaching Asst|Pretorius/;
  ok("none of the invented audit entries is anywhere", ["superadmin", "directorofsport", "facilities", "schooladmin", "dso"].every((r) => !invented.test(tabsOf(r).out)));
  const gk = tabsOf("facilities").out;
  ok("...nor the invented ground tasks, on the groundskeeper's own tab", !/Irrigation|Roll and mark|Outfield mowing|Mzimba|Hadebe|Prepare Main Oval/.test(gk) && /data-testid="ground-duties/.test(gk), gk.slice(0, 200));
  ok("...whose duties are the fixtures at the grounds, and no fake New Task button", /Fixtures at your grounds/.test(gk) && !/New Task/.test(gk));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
