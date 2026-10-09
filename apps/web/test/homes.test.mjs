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
import { NAV_CAPABILITY, NAV_ORDER, PERSONA_ONLY, ROLE_IDENTITY, ROLES, personaFor } from "../src/design/roles.js";
import { HOMES, HOME_OF, collapseHomes, homeParts } from "../src/design/homes.js";
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
const holds = (roles, k) => NAV_CAPABILITY[k] === null || roles.some((r) => roleGrants(r, NAV_CAPABILITY[k]));
/** What a role reaches: the menu as it has always been (ROLES[r].nav, Leagues its own entry). */
const reachFor = (r) => ROLES[r].nav;
/** What the shell now draws: that reach with each home once (lib/homeNav.js useMenu, on the capability stage). */
const menu = (r) => collapseHomes(ROLES[r].nav);
const STAFF_ROLES = POLICY_ROLES.filter((r) => personaFor(heldBy(r)) === null);

group("The homes are built from destinations that exist, under the capability they always had");
{
  ok("three homes: competitions, logistics (transport), fields (grounds)", eq(Object.keys(HOMES), ["competitions", "logistics", "fields"]));
  ok("every home key, section source and link target is a destination with a capability",
     Object.values(HOMES).every((hm) => hm.key in NAV_CAPABILITY && hm.sections.every((s) => s.from in NAV_CAPABILITY)
       && hm.links.every((l) => l.to in NAV_CAPABILITY && l.from in NAV_CAPABILITY)));
  // The strict rule: a home is offered under ITS OWN capability, and none of its
  // sections is gated by a wider or different one. A section that needed a
  // different capability would make the home appear for someone who could not
  // have reached its key before.
  ok("every section of a home is gated by the capability the home's own key carries (no widening)",
     Object.values(HOMES).every((hm) => hm.sections.every((s) => NAV_CAPABILITY[s.from] === NAV_CAPABILITY[hm.key])),
     Object.values(HOMES).flatMap((hm) => hm.sections.filter((s) => NAV_CAPABILITY[s.from] !== NAV_CAPABILITY[hm.key]).map((s) => `${hm.key}/${s.key}`)).join());
  ok("no home mentions a role by name", !/\b(coach|principal|director|schooladmin|driver|facilities|transportcoordinator)\b/.test(JSON.stringify(HOMES)));
  ok("the only destination folded into a home is Leagues, into Competitions", eq(HOME_OF, { leagues: "competitions" }));
  ok("a folded destination keeps its place in the order, capability and module",
     NAV_ORDER.includes("leagues") && NAV_CAPABILITY.leagues === "competition.read" && MODULE_OF_NAV.leagues === "leagues");
  ok("section keys are distinct within a home", Object.values(HOMES).every((hm) => new Set(hm.sections.map((s) => s.key)).size === hm.sections.length));
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
      if (menu(r).includes(hm.key) !== (want.length > 0)) bad.push(`${r}/${hm.key} in nav`);
    }
  }
  ok(`${STAFF_ROLES.length} roles x 3 homes: sections, links and the menu entry match the capability data`, bad.length === 0, bad.join(" | "));

  const none = STAFF_ROLES.filter((r) => Object.values(HOMES).every((hm) => !homeParts(hm.key, reachFor(r)).visible));
  ok("a role that reaches none of a home's parts has no entry for it", STAFF_ROLES.every((r) =>
    Object.values(HOMES).every((hm) => hm.sections.some((s) => holds(heldBy(r), s.from)) || !menu(r).includes(hm.key))));
  ok("...for example a groundskeeper has no Competitions, a transport coordinator neither Competitions nor Fields",
     !menu("facilities").includes("competitions") && !menu("transportcoordinator").includes("competitions") && !menu("transportcoordinator").includes("fields"));
  ok(`${none.length} roles reach none of the three, and so get none`, none.every((r) => !["competitions", "logistics", "fields"].some((k) => menu(r).includes(k))), none.join());

  // The old menu, rebuilt: the reach (every destination, Leagues its own entry).
  const diff = [];
  for (const r of STAFF_ROLES) {
    const old = NAV_ORDER.filter((k) => holds(heldBy(r), k) && !PERSONA_ONLY.has(k));
    const now = menu(r);
    const lost = old.filter((k) => !now.includes(k) && !(k in HOME_OF));
    const gained = now.filter((k) => !old.includes(k));
    const leaguesOnly = old.includes("leagues") && !now.includes("leagues") && now.includes("competitions");
    if (lost.length || gained.length) diff.push(`${r}: -${lost} +${gained}`);
    if (old.includes("leagues") && !leaguesOnly) diff.push(`${r}: Leagues not folded into Competitions`);
    if (!old.includes("leagues") && now.includes("leagues")) diff.push(`${r}: Leagues appeared`);
  }
  ok("against the old menu, no role gained an entry and none lost one but Leagues, which moved into Competitions", diff.length === 0, diff.join(" | "));
  ok("every entry a role is offered is one whose capability it holds",
     STAFF_ROLES.every((r) => menu(r).every((k) => holds(heldBy(r), k))));
  ok("a parent's and a pupil's bars carry no home", ["guardian", "player"].every((r) => !Object.keys(HOMES).some((k) => menu(r).includes(k))));
  ok("Leagues is never a menu entry of its own", STAFF_ROLES.every((r) => !menu(r).includes("leagues")));
}

group("Modules: switching a module off removes that section, and the home only when none is left");
{
  const reachWith = (r, off) => reachFor(r).filter((k) => !off.some((m) => MODULE_OF_NAV[k] === m));
  const keys = (r, off, home) => homeParts(home, reachWith(r, off)).sections.map((s) => s.key);
  ok("Leagues off: Competitions is the one section, and the entry stays", eq(keys("coach", ["leagues"], "competitions"), ["competitions"])
     && collapseHomes(reachWith("coach", ["leagues"])).includes("competitions"));
  ok("Competitions off, Leagues on: the entry stays and offers Leagues alone", eq(keys("coach", ["competitions"], "competitions"), ["leagues"])
     && collapseHomes(reachWith("coach", ["competitions"])).includes("competitions"));
  ok("both off: no Competitions entry", !collapseHomes(reachWith("coach", ["competitions", "leagues"])).includes("competitions"));
  ok("Logistics off: no Transport entry, and Fields loses its link to the ground schedule",
     !collapseHomes(reachWith("coach", ["logistics"])).includes("logistics") && homeParts("fields", reachWith("coach", ["logistics"])).links.length === 0
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
  ok("a competition admin sees Competitions and neither Transport nor Fields",
     menu("competitionadmin").includes("competitions") && !menu("competitionadmin").includes("logistics") && !menu("competitionadmin").includes("fields"));
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
  ok("a coach's menu has Competitions, Logistics and Fields once each, and no Leagues", ["competitions", "logistics", "fields"].every((k) => coach.filter((x) => x === k).length === 1) && !coach.includes("leagues"), coach.join());
  const tc = drawn("transportcoordinator");
  ok("a transport coordinator's has Logistics and neither Competitions nor Fields", tc.includes("logistics") && !tc.includes("competitions") && !tc.includes("fields"), tc.join());
  const gk = drawn("facilities");
  ok("a groundskeeper's has Fields and neither Competitions nor Logistics", gk.includes("fields") && !gk.includes("competitions") && !gk.includes("logistics"), gk.join());
  const ca = drawn("competitionadmin");
  ok("a competition admin's has Competitions and no Leagues, Logistics or Fields", ca.includes("competitions") && !["leagues", "logistics", "fields"].some((k) => ca.includes(k)), ca.join());
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
  ok("...and the menu highlights the home while Leagues is open", (app.match(/active=\{HOME_OF\[page\] \?\? page\}/g) || []).length === 2);
  ok("a menu choice clears a section a link had named", /const setPage = \(k, section = null\) => \{ setPageSection\(section\); setPageRaw\(k\); \}/.test(app));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
