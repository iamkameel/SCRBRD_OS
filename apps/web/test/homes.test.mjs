/**
 * GA-I30: one home per domain — grounds, transport, competitions.
 *
 * A home gathers destinations that already existed. It decides nothing, so
 * this proves the one thing a home could get wrong: showing somebody more
 * than the menu did. For every role and every home, the sections and links on
 * show are re-derived here straight from the capability data (NAV_CAPABILITY
 * and roleGrants), never from the home code's own output, and compared with
 * what the home gives; a role that reaches none of a home's parts has no menu
 * entry for it; and the old menu is rebuilt and compared with the new one, so
 * nobody gained a destination and nobody who had one lost it.
 *
 * The drawn half renders the bar and the three screens signed out (the
 * demonstration) for named roles. The browser walks
 * (tools/smoke-browser-read.mjs, -league.mjs and the rest) prove the same
 * against a real server.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/homes.test.mjs
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES as POLICY_ROLES, roleGrants } from "@scrbrd/policy/roles";
import { MODULE_OF_NAV } from "@scrbrd/policy/modules";
import { NAV_CAPABILITY, NAV_META, NAV_ORDER, PERSONA_ONLY, ROLE_IDENTITY, ROLES, navGrants, personaFor } from "../src/design/roles.js";
import { FRAMED, HEADER, HOMES, HOME_OF, UNDER, collapseHomes, entryFor, entryLabel, homeOf, homeParts } from "../src/design/homes.js";
import { HomeBar } from "../src/shell/HomeBar.jsx";
import { useMenu } from "../src/lib/homeNav.js";
import { CompetitionsView } from "../src/views/CompetitionsView.jsx";
import { LeagueView } from "../src/views/LeagueView.jsx";
import { LogisticsView } from "../src/views/LogisticsView.jsx";
import { FieldsView } from "../src/views/FieldsView.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const heldBy = (r) => [r, ...(ROLE_IDENTITY[r].also ?? [])];
/** The capability check, written out from the data: null is everyone's. */
const holds = (roles, k) => NAV_CAPABILITY[k] === null || roles.some((r) => navGrants(r, k));
/** What a role reaches: the menu as it has always been (ROLES[r].nav, Leagues its own entry). */
const reachFor = (r) => ROLES[r].nav;
/** What the shell now draws: that reach with each home once (lib/homeNav.js useMenu, on the capability stage). */
const menu = (r) => collapseHomes(ROLES[r].nav);
const STAFF_ROLES = POLICY_ROLES.filter((r) => personaFor(heldBy(r)) === null);

group("The homes are built from destinations that exist, under the capability they always had");
{
  ok("eight homes: Today, Matches, Team, Competitions, Logistics (transport), Fields (grounds), School, Platform",
     eq(Object.keys(HOMES), ["dashboard", "matches", "squad", "competitions", "logistics", "fields", "staff", "pitchdeck"]));
  ok("every home key, section source and link target is a destination with a capability",
     Object.values(HOMES).every((hm) => hm.key in NAV_CAPABILITY && hm.sections.every((s) => s.from in NAV_CAPABILITY)
       && hm.links.every((l) => l.to in NAV_CAPABILITY && l.from in NAV_CAPABILITY)));
  // The rule that keeps a home from widening anything (EXPERIENCE_PASS §1.2): a
  // home's sections may carry different capabilities (Team: the roster, the
  // injuries tier, the development record), so the home is drawn under a key
  // only when that key is in the reader's reach. A reader who reaches a section
  // but not the home's own key gets the home under the section's key, never
  // under one he was not offered (checked for every role below).
  ok("a framed home's section keys are the destinations themselves",
     FRAMED.every((k) => HOMES[k].sections.every((s) => s.key === s.from)));
  ok("the three older homes keep one capability for all their sections",
     ["competitions", "logistics", "fields"].every((k) => HOMES[k].sections.every((s) => NAV_CAPABILITY[s.from] === NAV_CAPABILITY[k])));
  ok("no home mentions a role by name", !/\b(coach|principal|director|schooladmin|driver|facilities|transportcoordinator)\b/.test(JSON.stringify(HOMES)));
  ok("the destinations folded into homes (§1.5)", eq(HOME_OF, { readiness: "dashboard", news: "dashboard", calendar: "matches", officials: "matches",
     profiles: "squad", injuries: "squad", training: "squad", skills: "squad", analytics: "squad", selection: "squad", leagues: "competitions",
     management: "staff", record: "staff", modules: "staff", sponsors: "staff", requests: "pitchdeck", support: "pitchdeck", dls: "pitchdeck", roadmap: "pitchdeck" }));
  ok("a folded destination keeps its place in the order, capability and module",
     Object.keys(HOME_OF).every((k) => NAV_ORDER.includes(k) && k in NAV_CAPABILITY) && MODULE_OF_NAV.leagues === "leagues");
  ok("section keys are distinct within a home", Object.values(HOMES).every((hm) => new Set(hm.sections.map((s) => s.key)).size === hm.sections.length));
  ok("under: Competitions and the Rulebook under Matches, Fields under Logistics", eq(UNDER, { competitions: "matches", fields: "logistics", rulebook: "matches" }));
  ok("the header holds the bell, Raise a concern and Settings", eq(HEADER, ["notifications", "safeguarding", "settings"]));
}

group("For every role: a section is shown exactly when the menu would have shown its source");
{
  const bad = [];
  for (const r of STAFF_ROLES) {
    const roles = heldBy(r);
    const reach = reachFor(r);
    for (const hm of Object.values(HOMES)) {
      const want = hm.sections.filter((s) => holds(roles, s.from)).map((s) => s.key);
      const wantLinks = hm.links.filter((l) => holds(roles, l.from)).map((l) => l.to);
      const got = homeParts(hm.key, reach);
      if (!eq(got.sections.map((s) => s.key), want)) bad.push(`${r}/${hm.key} sections ${got.sections.map((s) => s.key)} != ${want}`);
      if (!eq(got.links.map((l) => l.to), wantLinks)) bad.push(`${r}/${hm.key} links`);
      if (got.visible !== (want.length > 0)) bad.push(`${r}/${hm.key} visible`);
      // In the menu once, under its own key or its first reached section, unless it sits under a home the reader has.
      const entries = menu(r).filter((k) => homeOf(k) === hm.key);
      const under = !!hm.under && reach.includes(hm.under);
      if (entries.length !== (want.length > 0 && !under ? 1 : 0)) bad.push(`${r}/${hm.key} in nav ${entries}`);
      if (entries.length && !reach.includes(entries[0])) bad.push(`${r}/${hm.key} under a key out of reach`);
    }
  }
  ok(`${STAFF_ROLES.length} roles x ${Object.keys(HOMES).length} homes: sections, links and the menu entry match the capability data`, bad.length === 0, bad.join(" | "));

  ok("a role that reaches none of a home's parts has no entry for it", STAFF_ROLES.every((r) =>
    Object.values(HOMES).every((hm) => hm.sections.some((s) => holds(heldBy(r), s.from)) || !menu(r).some((k) => homeOf(k) === hm.key))));
  ok("...for example a groundskeeper has no Competitions, a transport coordinator neither Competitions nor Fields",
     !menu("facilities").includes("competitions") && !menu("transportcoordinator").includes("competitions") && !menu("transportcoordinator").includes("fields"));

  // The old menu, rebuilt: the reach (every destination its own entry). Each one
  // a role had is still reached: an entry, a section of a home it has, a link on
  // the bar of the home it sits under, or the header.
  const diff = [];
  for (const r of STAFF_ROLES) {
    const old = NAV_ORDER.filter((k) => holds(heldBy(r), k) && !PERSONA_ONLY.has(k));
    const now = menu(r);
    const kept = (k) => now.includes(k) || HEADER.includes(k)
      || now.some((e) => homeOf(e) === homeOf(k))
      || (!!UNDER[homeOf(k)] && now.some((e) => homeOf(e) === UNDER[homeOf(k)]));
    const lost = old.filter((k) => !kept(k));
    const gained = now.filter((k) => !old.includes(k));
    if (lost.length || gained.length) diff.push(`${r}: -${lost} +${gained}`);
  }
  ok("against the old menu, no role gained an entry, and every one it had is an entry, a section, a link on a bar or in the header", diff.length === 0, diff.join(" | "));
  ok("every entry a role is offered is one whose capability it holds",
     STAFF_ROLES.every((r) => menu(r).every((k) => holds(heldBy(r), k))));
  ok("a parent's and a pupil's bars carry no home", ["guardian", "player"].every((r) => !Object.keys(HOMES).some((k) => menu(r).includes(k))));
  ok("Leagues is never a menu entry of its own", STAFF_ROLES.every((r) => !menu(r).includes("leagues")));
  ok("no staff menu holds the header's three", STAFF_ROLES.every((r) => !HEADER.some((k) => menu(r).includes(k))));
}

group("The menus of §1.7, after");
{
  const words = (r) => menu(r).map((k) => entryLabel(k, reachFor(r)) ?? NAV_META[k].label);
  const say = (r, want) => ok(`${r}: ${want.join(" · ")}`, eq(words(r), want), words(r).join(" · "));
  say("coach", ["Today", "Matches", "Team", "Logistics"]);
  say("teammanager", ["Today", "Matches", "Team", "Logistics"]);
  say("scorer", ["Today", "Matches", "Team"]);
  say("spectator", ["Today", "Matches"]);
  // Slice 6: the School and Platform homes (§1.7, §1.8).
  say("directorofsport", ["Today", "Matches", "Team", "Logistics", "School"]);
  say("schooladmin", ["Today", "Matches", "Team", "Logistics", "School"]);
  say("sportsadmin", ["Today", "Matches", "Team", "Logistics", "School"]);
  say("dso", ["Today", "Matches", "Team", "Logistics", "School"]);
  say("principal", ["Today", "Matches", "Team", "Fields & pitches", "School"]);
  say("superadmin", ["Today", "Matches", "Team", "Logistics", "School", "Platform"]);
  // No Matches, so Competitions and the Rulebook stay entries (§1.5 rows 5 and 34).
  say("platformadmin", ["Today", "Competitions", "School", "Platform", "Rulebook"]);
  say("finance", ["Today", "School", "Rulebook"]);
  // Review SF4: the lift purge (transport.lift.oversee) is on Logistics, Transport, so he keeps §1.8's menu.
  say("transportcoordinator", ["Today", "Matches", "Squad", "Logistics"]);
  ok("nobody at a school has more than five entries; only the superadmin's recovery key has six",
     STAFF_ROLES.every((r) => menu(r).length <= 5 || r === "superadmin"), STAFF_ROLES.filter((r) => menu(r).length > 5).join());
  const parts = (r, home) => homeParts(home, reachFor(r)).sections.map((s) => s.label);
  ok("School for the office: People, Access, Record, Modules, Sponsors", eq(parts("schooladmin", "staff"), ["People", "Access", "Record", "Modules", "Sponsors"]));
  ok("...for the director: no Modules (he cannot hide one)", eq(parts("directorofsport", "staff"), ["People", "Access", "Record", "Sponsors"]));
  ok("...for the DSO and the sports admin: People and Record, no Access", eq(parts("dso", "staff"), ["People", "Record"]) && eq(parts("sportsadmin", "staff"), ["People", "Record"]));
  ok("Platform: School requests, Support access, DLS table, What's built, Pitch deck, for the platform alone",
     eq(parts("platformadmin", "pitchdeck"), ["School requests", "Support access", "DLS table", "What's built", "Pitch deck"])
     && STAFF_ROLES.filter((r) => homeParts("pitchdeck", reachFor(r)).visible).join() === "superadmin,platformadmin");
  ok("each School and Platform section under the gate its part had (or the home's, never wider)",
     STAFF_ROLES.every((r) => homeParts("pitchdeck", reachFor(r)).sections.every((s) => roleGrants(r, NAV_CAPABILITY[s.from])))
     && STAFF_ROLES.every((r) => !homeParts("staff", reachFor(r)).sections.some((s) => s.from === "record") || ["user.read", "broadcast.publish", "transport.lift.policy", "audit.read"].some((c) => roleGrants(r, c))));
  ok("every holder of transport.lift.oversee reaches Logistics, where the lift purge is drawn (review SF4)",
     STAFF_ROLES.filter((r) => roleGrants(r, "transport.lift.oversee")).every((r) => homeParts("logistics", reachFor(r)).sections.some((s) => s.key === "transport")));
  ok("a coach, a team manager, a scorer, a parent and a pupil reach no School and no Platform",
     ["coach", "teammanager", "scorer", "guardian", "player"].every((r) => !homeParts("staff", reachFor(r)).visible && !homeParts("pitchdeck", reachFor(r)).visible));
  ok("a union selector's Team is named by its one section, and keyed on it", menu("unionselector").includes("selection") && words("unionselector").includes("Selection") && !menu("unionselector").includes("squad"));
  ok("a scout reaching only the squad is named Squad", words("scout").includes("Squad"));
  ok("a platform admin, with no Matches, keeps Competitions and the Rulebook", menu("platformadmin").includes("competitions") && menu("platformadmin").includes("rulebook"));
  ok("entryFor: a section lights its home, a page under a home lights that home, the header lights none",
     entryFor("training", menu("coach")) === "squad" && entryFor("leagues", menu("coach")) === "matches" && entryFor("fields", menu("coach")) === "logistics"
     && entryFor("settings", menu("coach")) === null && entryFor("injuries", menu("enquiry")) === "profiles" && entryFor("leagues", menu("platformadmin")) === "competitions");
}

group("Modules: switching a module off removes that section, and the home only when none is left");
{
  const reachWith = (r, off) => reachFor(r).filter((k) => !off.some((m) => MODULE_OF_NAV[k] === m));
  const keys = (r, off, home) => homeParts(home, reachWith(r, off)).sections.map((s) => s.key);
  // A coach reaches Matches, so Competitions is a link on its bar; a platform admin has it as an entry.
  ok("Leagues off: Competitions is the one section, and the entry stays", eq(keys("platformadmin", ["leagues"], "competitions"), ["competitions"])
     && collapseHomes(reachWith("platformadmin", ["leagues"])).includes("competitions"));
  ok("Competitions off, Leagues on: the entry stays and offers Leagues alone, under the Leagues key", eq(keys("platformadmin", ["competitions"], "competitions"), ["leagues"])
     && collapseHomes(reachWith("platformadmin", ["competitions"])).includes("leagues"));
  ok("both off: no Competitions entry", !collapseHomes(reachWith("platformadmin", ["competitions", "leagues"])).some((k) => homeOf(k) === "competitions"));
  ok("a coach's Matches bar links to Competitions while it is on, and not when both are off",
     homeParts("matches", reachWith("coach", [])).links.some((l) => l.to === "competitions") && !homeParts("matches", reachWith("coach", ["competitions", "leagues"])).links.some((l) => l.to === "competitions"));
  ok("Logistics off: no Transport entry, Fields becomes an entry, and it loses its link to the ground schedule",
     !collapseHomes(reachWith("coach", ["logistics"])).includes("logistics") && collapseHomes(reachWith("coach", ["logistics"])).includes("fields") && homeParts("fields", reachWith("coach", ["logistics"])).links.length === 0
     && homeParts("fields", reachWith("coach", [])).links.length === 1);
  ok("Fields off: no Fields entry, and Transport loses its link to it",
     !collapseHomes(reachWith("coach", ["fields"])).includes("fields") && homeParts("logistics", reachWith("coach", ["fields"])).links.length === 0);
  ok("a module being on gives nothing a capability withheld",
     eq(keys("facilities", [], "competitions"), []) && eq(keys("transportcoordinator", [], "fields"), []));
}

group("The role → sections table (what each home shows, by capability)");
{
  const rows = (home) => STAFF_ROLES.map((r) => {
    const p = homeParts(home, reachFor(r));
    return p.visible ? `${r.padEnd(22)} ${p.sections.map((s) => s.label).join(" | ")}${p.links.length ? `   links: ${p.links.map((l) => l.label).join(", ")}` : ""}` : null;
  }).filter(Boolean);
  for (const home of Object.keys(HOMES)) console.log(`\n  ${HOMES[home].title} (${home}), gate ${NAV_CAPABILITY[home]}\n    ` + rows(home).join("\n    "));
  const who = (home) => STAFF_ROLES.filter((r) => homeParts(home, reachFor(r)).visible);
  ok("Competitions: both sections for every role that holds competition.read, and only those",
     eq(who("competitions"), STAFF_ROLES.filter((r) => roleGrants(r, "competition.read"))) && who("competitions").every((r) => eq(homeParts("competitions", reachFor(r)).sections.map((s) => s.key), ["competitions", "leagues"])));
  ok("Transport: the three tabs for every role that holds transport.read, and only those",
     eq(who("logistics"), STAFF_ROLES.filter((r) => roleGrants(r, "transport.read"))) && who("logistics").every((r) => eq(homeParts("logistics", reachFor(r)).sections.map((s) => s.key), ["transport", "equipment", "grounds"])));
  ok("Grounds: Fields for every role that holds facility.read, and only those",
     eq(who("fields"), STAFF_ROLES.filter((r) => roleGrants(r, "facility.read"))));
  ok("a driver sees Transport and no Competitions or Fields", menu("driver").includes("logistics") && !menu("driver").includes("competitions") && !menu("driver").includes("fields"));
  ok("a groundskeeper sees Fields, with no link to the ground schedule (no transport.read)",
     menu("facilities").includes("fields") && homeParts("fields", reachFor("facilities")).links.length === 0);
  ok("a coach sees Fields with the link to the ground schedule", homeParts("fields", reachFor("coach")).links.map((l) => l.to).join() === "logistics");
  ok("a competition admin reaches Competitions from the Matches bar, and neither Transport nor Fields",
     homeParts("matches", reachFor("competitionadmin")).links.some((l) => l.to === "competitions") && !menu("competitionadmin").includes("logistics") && !menu("competitionadmin").includes("fields"));
  ok("a principal sees Fields without the link (no transport.read), and no Transport",
     menu("principal").includes("fields") && !menu("principal").includes("logistics") && homeParts("fields", reachFor("principal")).links.length === 0);
}

group("The bar, drawn");
{
  const bar = (home, role, extra = {}) => renderToStaticMarkup(h(HomeBar, { home, role, ...extra }));
  const comp = bar("competitions", "coach", { section: "competitions", onSection: () => {} });
  ok("Competitions: both sections as buttons, the open one pressed",
     /data-testid="home-competitions-section-competitions"[^>]*/.test(comp) && /data-testid="home-competitions-section-leagues"/.test(comp)
     && /aria-pressed="true"[^>]*data-testid="home-competitions-section-competitions"/.test(comp) && /aria-pressed="false"[^>]*data-testid="home-competitions-section-leagues"/.test(comp), comp.slice(0, 300));
  ok("...in a labelled group", /role="group" aria-label="Competitions: sections"/.test(comp));
  ok("a role without competition.read gets no bar at all", bar("competitions", "facilities", { section: "competitions", onSection: () => {} }) === "");
  ok("one section and no link draws nothing", bar("fields", "facilities", { onNav: () => {} }) === "");
  ok("Fields for a coach: the link to the ground schedule, and no section switch",
     /data-testid="home-fields-link-logistics-grounds"/.test(bar("fields", "coach", { onNav: () => {} })) && !/home-fields-section/.test(bar("fields", "coach", { onNav: () => {} })));
  ok("...and none without a way to navigate", bar("fields", "coach") === "");
  ok("Transport for a coach: three sections and a link to Fields",
     ["transport", "equipment", "grounds"].every((s) => bar("logistics", "coach", { section: "transport", onSection: () => {}, onNav: () => {} }).includes(`home-logistics-section-${s}`))
     && /home-logistics-link-fields/.test(bar("logistics", "coach", { section: "transport", onSection: () => {}, onNav: () => {} })));
  ok("Transport for a transport coordinator: the three sections and no link (no facility.read)",
     !/home-logistics-link/.test(bar("logistics", "transportcoordinator", { section: "transport", onSection: () => {}, onNav: () => {} }))
     && /home-logistics-section-equipment/.test(bar("logistics", "transportcoordinator", { section: "transport", onSection: () => {}, onNav: () => {} })));
  const all = comp + bar("logistics", "coach", { section: "transport", onSection: () => {}, onNav: () => {} }) + bar("fields", "coach", { onNav: () => {} });
  const px = (re) => [...all.matchAll(re)].map((m) => parseFloat(m[1]));
  ok("every button is at least 44px tall and every word at least 12px", px(/min-height:(\d+(?:\.\d+)?)px/g).length > 0 && px(/min-height:(\d+(?:\.\d+)?)px/g).every((n) => n >= 44)
     && px(/font-size:(\d+(?:\.\d+)?)px/g).every((n) => n >= 12), all.slice(0, 200));
}

group("The screens carry the bar, with the same test ids as before");
{
  const draw = (c, props) => renderToStaticMarkup(h(c, props));
  const bar = h(HomeBar, { home: "competitions", role: "coach", section: "competitions", onSection: () => {} });
  ok("Competitions carries the bar under its header, and keeps its testids",
     /Competitions<\/h2>[\s\S]*data-testid="home-competitions"/.test(draw(CompetitionsView, { role: "coach", homeBar: bar })) && /data-testid="competition-/.test(draw(CompetitionsView, { role: "coach", homeBar: bar })));
  ok("...and without a bar it is the screen it was", !/home-competitions/.test(draw(CompetitionsView, { role: "coach" })));
  ok("Leagues carries the bar under League Management, and keeps its tab test ids",
     /League Management[\s\S]*data-testid="home-competitions"/.test(draw(LeagueView, { role: "coach", homeBar: bar })) && /data-testid="league-tab-table"/.test(draw(LeagueView, { role: "coach", homeBar: bar })));
  const lg = draw(LogisticsView, { role: "coach", onNav: () => {} });
  ok("Logistics (Transport) draws its three tabs from the home's sections, as Transport, Equipment, Grounds",
     /home-logistics-section-transport/.test(lg) && />Transport<\/button>/.test(lg) && />Equipment<\/button>/.test(lg) && />Grounds<\/button>/.test(lg));
  ok("...opens on Transport by default, and on the section a link names",
     /aria-pressed="true"[^>]*data-testid="home-logistics-section-transport"/.test(lg)
     && /aria-pressed="true"[^>]*data-testid="home-logistics-section-grounds"/.test(draw(LogisticsView, { role: "coach", section: "grounds", onNav: () => {} })));
  ok("a reader without transport.read is offered no section switch, whatever a link asked for",
     !/home-logistics-section-/.test(draw(LogisticsView, { role: "facilities", section: "grounds", onNav: () => {} })));
  const fv = draw(FieldsView, { role: "coach", onNav: () => {} });
  ok("Fields carries the link to the ground schedule for a coach, and not for a groundskeeper",
     /home-fields-link-logistics-grounds/.test(fv) && !/home-fields-link/.test(draw(FieldsView, { role: "facilities", onNav: () => {} })));
  ok("no contact detail came with the home: the bar's markup holds no phone, email or name",
     !/phone|email|@|\+27/.test(draw(HomeBar, { home: "logistics", role: "coach", section: "transport", onSection: () => {}, onNav: () => {} })));
}

group("The menu the shell draws (useMenu, which Sidebar and MobileNav both read), signed out, for every role");
{
  const drawn = (role) => renderToStaticMarkup(h(function Menu() { return h("i", null, useMenu(role).join(",")); })).replace(/<\/?i>/g, "").split(",").filter(Boolean);
  ok("for every role it is exactly the capability-stage menu: the reach with each home once", STAFF_ROLES.every((r) => eq(drawn(r), menu(r))),
     STAFF_ROLES.filter((r) => !eq(drawn(r), menu(r))).join());
  const coach = drawn("coach");
  ok("a coach's menu is Today, Matches, Team and Logistics, each once", eq(coach, ["dashboard", "matches", "squad", "logistics"]), coach.join());
  const tc = drawn("transportcoordinator");
  ok("a transport coordinator's has Logistics and neither Competitions nor Fields", tc.includes("logistics") && !tc.includes("competitions") && !tc.includes("fields"), tc.join());
  const gk = drawn("facilities");
  ok("a groundskeeper's has Fields and neither Competitions nor Logistics", gk.includes("fields") && !gk.includes("competitions") && !gk.includes("logistics"), gk.join());
  const ca = drawn("competitionadmin");
  ok("a competition admin's has Matches and no Competitions, Leagues, Logistics or Fields entry", ca.includes("matches") && !["competitions", "leagues", "logistics", "fields"].some((k) => ca.includes(k)), ca.join());
  ok("the phone's bar reads the same menu", /useMenu/.test(readFileSync(new URL("../src/shell/MobileNav.jsx", import.meta.url), "utf8")) && /useMenu/.test(readFileSync(new URL("../src/shell/Sidebar.jsx", import.meta.url), "utf8")));
}

group("The home module imports nothing, so the public graph does not grow");
{
  const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  ok("design/homes.js has no import", !/^\s*import\s/m.test(src("../src/design/homes.js")));
  ok("design/roles.js and lib/features.js (in the public graph) do not import it", !/homes\.js|homeNav\.js/.test(src("../src/design/roles.js").replace(/\/\/.*$/gm, "")) && !/homes\.js|homeNav\.js/.test(src("../src/lib/features.js")));
}

group("The shell routes the folded destination to its home");
{
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("App still routes leagues (a saved session, a link), opened on the Leagues section", /leagues:\s+<CompetitionsHome\s+role=\{role\} section="leagues"\/>/.test(app));
  ok("...and the competitions route gets the section a link named", /competitions:\s+<CompetitionsHome\s+role=\{role\} section=\{pageSection\}\/>/.test(app));
  ok("...and the menu is told the page, and lights its home (design/homes.js entryFor)", (app.match(/<(Sidebar|MobileNav) role=\{role\} active=\{page\}/g) || []).length === 2);
  ok("...and Today, Matches and Team draw their bar over the screen", /FRAMED\.includes\(homeOf\(shown\)\)/.test(app) && /<HomeBar home=\{homeOf\(shown\)\}/.test(app));
  ok("a menu choice clears a section a link had named", /const setPage = \(k, section = null\) => \{ setPageSection\(section\); setPageRaw\(k\); \}/.test(app));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
