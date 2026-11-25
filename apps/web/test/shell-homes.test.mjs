/**
 * EXPERIENCE_PASS Slice 5: the homes as the menu, the header, Q17's gate on
 * To resolve, the things' addresses (Q11), "Needs you" landing on the fix,
 * and the day sheet's figures (§3.10). The browser half is
 * tools/smoke-browser-homes.mjs.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/shell-homes.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES as POLICY_ROLES, SUBJECT_SCOPED_ROLES, roleGrants } from "@scrbrd/policy/roles";
import { NAV_ACTS, NAV_ALSO, NAV_CAPABILITY, ROLES, navForRoles, navGrants } from "../src/design/roles.js";
import { collapseHomes } from "../src/design/homes.js";
import { OFFICE_CAPS, entersQueue } from "../src/lib/queue.js";
import { THING_PAGE, teamId, teamParts, thingOf, thingPath } from "../src/lib/things.js";
import { fixFor, peekFix, requestFix } from "../src/lib/fixNote.js";
import { lastMatchWords } from "../src/lib/recentMatches.js";
import { COMPARE_FLOOR } from "../src/lib/compare.js";
import { MIN_MATCHES, seasonLineWords } from "../src/lib/sideSeason.js";
import { needsYouRows } from "../src/views/needsyou.jsx";
import { READY_SLOTS, chipOrder, weekOf } from "../src/views/DashboardView.jsx";
import { ruleS8 } from "../src/lib/signals.js";
import { formLetter, teamResults } from "../src/views/TeamPage.jsx";
import { MobileNav, SportSwitcher } from "../src/shell/MobileNav.jsx";
import { readFileSync } from "node:fs";
import { TopBar } from "../src/shell/TopBar.jsx";
import { PersonaBar } from "../src/shell/PersonaBar.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

group("Q17: To resolve is drawn only for a role that can act on one of its rows");
{
  // The queue's own reader rule, per role (lib/queue.js isQueueReader, resultsReader, and the two lists useQueue
  // asks for): written out here from that module, never from roles.js, and compared for every role.
  const acts = (r) => !SUBJECT_SCOPED_ROLES.includes(r) && roleGrants(r, "fixture.read")
    && (entersQueue(r) || OFFICE_CAPS.some((c) => roleGrants(r, c)) || ["result.confirm", "scoring.amend.approve", "recognition.match.award"].some((c) => roleGrants(r, c)));
  const off = POLICY_ROLES.filter((r) => navGrants(r, "readiness") !== acts(r));
  ok("for every role, the menu's gate is the queue's reader rule", off.length === 0, off.join());
  ok("it only narrows: no role is offered To resolve without fixture.read", POLICY_ROLES.every((r) => !navGrants(r, "readiness") || roleGrants(r, "fixture.read")));
  ok("NAV_CAPABILITY still reads it under fixture.read", NAV_CAPABILITY.readiness === "fixture.read" && Object.keys(NAV_ACTS).join() === "readiness");
  const lost = POLICY_ROLES.filter((r) => roleGrants(r, "fixture.read") && !navGrants(r, "readiness"));
  ok("a spectator, an official and a scorer lose it", ["spectator", "official", "scorer"].every((r) => lost.includes(r)), lost.join());
  ok("a coach, a team manager, a director of sport and the office keep it",
     ["coach", "teammanager", "directorofsport", "schooladmin", "sportsadmin"].every((r) => navGrants(r, "readiness")));
  ok("a guardian and a pupil are never offered it", !navGrants("guardian", "readiness") && !navGrants("selfaccess", "readiness"));
  ok("no other destination is narrowed by it", Object.keys(NAV_CAPABILITY).filter((k) => k !== "readiness").every((k) =>
    POLICY_ROLES.every((r) => navGrants(r, k) === (NAV_CAPABILITY[k] === null || roleGrants(r, NAV_CAPABILITY[k]) || [NAV_ALSO[k] ?? []].flat().some((c) => roleGrants(r, c))))));
  ok("a coach who is also a parent keeps it (the set of roles held)", navForRoles(["coach", "guardian"]).includes("readiness"));
  ok("a spectator's Today has no To resolve section: his menu is Today and Matches", eq(collapseHomes(ROLES.spectator.nav), ["dashboard", "matches"]));
}

group("Q11: the things' addresses, by id only");
{
  const P = "3f1c2a9e-1b2c-4d5e-8f90-1234567890ab", S = "aa1c2a9e-1b2c-4d5e-8f90-1234567890ab";
  ok("a player's address", eq(thingOf(`/app/players/${P}`), { kind: "players", id: P }) && thingPath("players", P) === `/app/players/${P}`);
  ok("a ground's address", eq(thingOf(`/app/grounds/${P}/`), { kind: "grounds", id: P }));
  ok("a team's address is its school's id and its code", eq(thingOf(`/app/teams/${S}.U15A`), { kind: "teams", id: `${S}.U15A` })
     && thingPath("teams", teamId(S, "1XI")) === `/app/teams/${S}.1XI` && eq(teamParts(`${S}.U15A`), { school: S, code: "U15A" }));
  ok("a name is never an address", [`/app/players/T%20Bekker`, `/app/players/Thabo`, `/app/teams/Westville%20Boys'%20High`, `/app/teams/${S}.U15A%20B`,
     `/app/grounds/Gordon%20Sherwood%20Oval`, `/app/players/${P}/extra`].every((p) => thingOf(p) === null));
  ok("...and is never written as one", thingPath("players", "T Bekker") === null && thingPath("teams", "Westville.1XI") === null);
  ok("each opens the screen that shows it", eq(THING_PAGE, { players: "profiles", teams: "squad", grounds: "fields" }));
  ok("the demo's ids are addresses too, and still no name", eq(thingOf("/app/players/p3"), { kind: "players", id: "p3" }) && thingOf("/app/players/peter") === null);
  ok("an unknown kind is not an address", thingOf(`/app/schools/${P}`) === null && thingOf("/app/matches/x") === null);
}

group("Needs you lands on the fix");
{
  ok("the bus: this fixture's trip on Logistics, the booking form if it has none",
     eq(fixFor("bus", { matchId: "m1" }), { page: "logistics", find: ['[data-testid="trip-fixture-m1"]', '[data-testid="trip-card-m1"]'], fallback: ['[data-testid="transport-book"]'] }));
  ok("the conditions: this fixture's competition, chosen", eq(fixFor("conditions", { competitionId: "c9" }), { page: "competitions", find: ['[data-testid="competition-c9"]'], click: true }));
  ok("the requests, the claims and the register: their own panels",
     fixFor("requests").find[0] === '[data-testid="requests-panel"]' && fixFor("claims").find[0] === '[data-testid="claims"]' && fixFor("register").find[0] === '[data-testid="clearance-register"]');
  ok("a fixture's own rows go through the Match Centre, not here", fixFor("side", { matchId: "m1" }) === null && fixFor("duties", { matchId: "m1" }) === null);
  ok("a bus with no fixture named has no note", fixFor("bus", {}) === null);
  requestFix({ page: "staff", find: ["x"] });
  ok("a note waits for its page", peekFix()?.page === "staff");
  const row = (id, state = "open") => ({ id, state });
  const q = { offices: [{ rows: [row("o1"), row("o2", "info")] }], results: { rows: [row("r1")] }, potm: null, groups: [{ rows: [row("g1"), row("g2", "info")] }, { rows: [row("g3")] }] };
  ok("Today's rows: the office's, then results, then the fixtures by date; open rows only", eq(needsYouRows(/** @type {any} */ (q)).map((r) => r.id), ["o1", "r1", "g1", "g3"]));
  // Slice 11 (question 8): what only the office can clear stays off a coach's Needs you; each fixture row names its fixture.
  const qs = { offices: [], results: null, potm: null, groups: [
    { school: "hil", label: "U15A v Kearsney", rows: [{ id: "s7", state: "open", rule: "S7", owner: "the U15A coach" }, { id: "o4", state: "open", rule: "O4", owner: "the office" }] },
    { school: "hil", label: "U14B v Michaelhouse", rows: [{ id: "s6", state: "open", rule: "S6", owner: "the U14B coach" }] }] };
  const coachRows = needsYouRows(/** @type {any} */ (qs), [{ role: "coach", school: "hil", team: "U15A" }, { role: "coach", school: "hil", team: "U14B" }]);
  ok("a coach across two squads: his rows from both, the office's left off, each naming its fixture",
     eq(coachRows.map((r) => [r.id, r.where]), [["s7", "U15A v Kearsney"], ["s6", "U14B v Michaelhouse"]]));
  ok("...the director, the office there: the office's row stays on his", eq(needsYouRows(/** @type {any} */ (qs), [{ role: "directorofsport", school: "hil" }]).map((r) => r.id), ["s7", "o4", "s6"]));
}

group("The day sheet (§3.10)");
{
  const slots = [{ key: "a", on: (has) => has("a") }, { key: "b", on: (has) => has("b") }, { key: "c", on: (has) => has("c") }];
  {
    // One fact, one answer (slice 11): the Officials chip is S8's rule (the queue's O4), in its words.
    const off = READY_SLOTS.find((x) => x.key === "officials");
    const chip = (/** @type {string[]} */ duties) => { const has = (/** @type {string} */ k) => duties.includes(k); return off.on(has) ? "on record" : off.missing(has); };
    const s8 = (/** @type {string[]} */ duties) => ruleS8(/** @type {any} */ ({ gate: { panels: { day: true } }, duties: duties.map((duty) => ({ duty })),
      match: { status: "upcoming", startsAt: "2026-11-26T07:00:00Z" }, now: Date.parse("2026-11-25T09:00:00Z") })).map((c) => c.lines[0].replace(/ for .*$/, "")).join(" · ") || "on record";
    ok("an umpire alone is not 'Officials · on record': 'No scorer on record', as the O4 row says it", chip(["umpire"]) === "No scorer on record" && chip(["umpire"]) === s8(["umpire"]));
    ok("...a referee or third umpire is no scorer or umpire", chip(["referee", "third_umpire"]) === "No scorer on record · No umpire on record" && chip(["referee", "third_umpire"]) === s8(["referee"]));
    ok("...a scorer and an umpire: on record, and S8 has no row", chip(["scorer", "umpire"]) === "on record" && s8(["scorer", "umpire"]) === "on record");
  }
  ok("the chips not done come first, each kind in its place", eq(chipOrder(/** @type {any} */ (slots), (k) => k === "a").map((s) => s.key), ["b", "c", "a"]));
  const day = new Date("2026-11-18T09:00:00+02:00"); // a Wednesday
  const ms = [
    { id: "past", date: "2026-11-16", status: "complete" }, { id: "last", date: "2026-11-14", status: "complete" },
    { id: "soon", date: "2026-11-20", status: "upcoming" }, { id: "far", date: "2026-11-30", status: "upcoming" },
    { id: "off", date: "2026-11-17", status: "complete", calledOff: true },
  ];
  ok("this week: played since Monday by its result, and the next seven days by its start", eq(weekOf(ms, day).map((m) => m.id), ["past", "off", "soon"]));

  const boy = (o) => ({ id: "b", name: "A Batter", runs: 0, balls: 0, innings: 1, wickets: 0, ballsBowled: 0, conceded: 0, bowled: 0, ...o });
  const line = { id: "m", date: null, opponent: "X", result: "Won by 23 runs", resultRead: true, ours: "142/6 (20 ov)", theirs: "119 all out", carded: true, correctedAt: null };
  const under = lastMatchWords({ line, boys: [boy({ runs: 12, balls: COMPARE_FLOOR - 1 })] }, true);
  ok("last match: the result and the totals", under.result === "Won by 23 runs" && under.totals === "142/6 (20 ov) v 119 all out");
  ok("...the top score by name, with no strike rate under the floor", under.top === `Top score: A Batter, 12 (${COMPARE_FLOOR - 1} balls)`, under.top);
  const over = lastMatchWords({ line, boys: [boy({ runs: 45, balls: 30 })] }, true);
  ok("...and with one from the floor up, through childRate", over.top === "Top score: A Batter, 45 (30 balls), strike rate 150.0", over.top);
  const book = lastMatchWords({ line, boys: [boy({ runs: 20, balls: null })] }, true);
  ok("...a scorebook innings with no balls says so, and has no rate", book.top === "Top score: A Batter, 20 (balls not recorded)", book.top);
  const bowl = lastMatchWords({ line, boys: [boy({ innings: 0, wickets: 3, conceded: 21, ballsBowled: 24, bowled: 1 })] }, true);
  ok("...the best bowling by name", bowl.best === "Best bowling: A Batter, 3 for 21 (4 ov)", bowl.best);
  const none = lastMatchWords({ line, boys: [boy({ runs: 45, balls: 30 })] }, false);
  ok("...and no boy is named where the gate does not let the reader count them", none.top === null && none.best === null && none.result === "Won by 23 runs");

  const pts = (n) => Array.from({ length: n }, (_, i) => ({ forRuns: 120, forBalls: 120, soFarFor: i + 1 >= MIN_MATCHES ? 6 : null }));
  ok("the season line from the fifth match", seasonLineWords(/** @type {any} */ (pts(9))) === "Season run rate 6.0 from 9 completed matches, 1,080 balls.");
  ok("...and under it, how many and when the line starts", seasonLineWords(/** @type {any} */ (pts(3))) === `3 completed matches this season: the season's run rate is drawn from the ${MIN_MATCHES}th.`);
  ok("...and nothing with no completed match", seasonLineWords([]) === null);

  const sp = (result, i) => ({ matchId: `m${i}`, result, resultLine: result, opponent: "X", date: null });
  const tr = teamResults(/** @type {any} */ (["won", "lost", "abandoned", "won", "tied", "no_result", "won"].map(sp)));
  ok("the team's results: last 5 completed, newest first, an abandoned one said and not counted",
     eq(tr.shown.map((p) => p.matchId), ["m6", "m5", "m4", "m3", "m1"]) && tr.basis === "Last 5 completed, of the matches this account can read; 1 abandoned, not counted" && tr.form === "W NR T W L", tr);
  ok("form letters", formLetter("won") === "W" && formLetter("draw") === "D" && formLetter(null) === null);
}

group("The shell, drawn signed out (the demo)");
{
  const phone = (role) => renderToStaticMarkup(h(MobileNav, { role, active: "dashboard", onNav: () => {}, notifCount: 0, userName: "Coach" }));
  const c = phone("coach");
  ok("a coach's phone bar is Today, Matches, Team, Logistics, and no More",
     ["mnav-dashboard", "mnav-matches", "mnav-squad", "mnav-logistics"].every((t) => c.includes(`data-testid="${t}"`)) && !c.includes("mnav-more")
     && (c.match(/data-testid="mnav-[a-z]+"/g) ?? []).length === 4, c.slice(0, 200));
  ok("...the words on it", ["Today", "Matches", "Team", "Logistics"].every((w) => c.includes(`>${w}</span>`)));
  const dos = phone("directorofsport");
  ok("a director of sport's phone bar is Today, Matches, Team, Logistics, School, and no More (Slice 6)",
     ["mnav-dashboard", "mnav-matches", "mnav-squad", "mnav-logistics", "mnav-staff"].every((t) => dos.includes(`data-testid="${t}"`)) && !dos.includes("mnav-more")
     && (dos.match(/data-testid="mnav-[a-z]+"/g) ?? []).length === 5 && dos.includes(">School</span>"), dos.slice(0, 200));
  const top = renderToStaticMarkup(h(TopBar, { role: "coach", onRoleChange: () => {}, onNav: () => {}, userName: "A Coach", active: "dashboard", onSignOut: () => {} }));
  ok("the staff header: the bell, Raise a concern and the person's name", top.includes('data-testid="topbar-alerts"') && /data-testid="nav-safeguarding"[^>]*aria-label="Raise a concern"|aria-label="Raise a concern"[^>]*data-testid="nav-safeguarding"/.test(top)
     && top.includes('data-testid="nav-settings"') && top.includes("A Coach"));
  ok("...and no mark beside Raise a concern", !/nav-safeguarding[^]*?badge/.test(top.slice(top.indexOf("nav-safeguarding"), top.indexOf("nav-settings"))));
  ok("every control in it at least 44px", (top.match(/min-height:(\d+)px/g) ?? []).every((m) => parseInt(m.slice(11), 10) >= 44));
  // Glossary review item 1: "Raise a concern" in words beside its icon, on both headers, its name starting with them.
  const persona = renderToStaticMarkup(h(PersonaBar, { active: "children", onNav: () => {}, onSignOut: () => {}, userName: "A Parent" }));
  for (const [who, html] of [["the staff header", top], ["the persona header", persona]]) {
    const btn = html.match(/<button[^>]*data-testid="nav-safeguarding"[^>]*>([^]*?)<\/button>/);
    const words = (btn?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\u00a0|&nbsp;|&#160;/g, " ").trim();
    const name = btn?.[0].match(/aria-label="([^"]*)"/)?.[1] ?? "";
    ok(`${who}: Raise a concern shows its words beside the icon, and its name starts with them`,
       words === "Raise a concern" && name.startsWith(words) && /aria-hidden="true"/.test(btn?.[1] ?? ""), btn?.[0]?.slice(0, 300));
    ok(`${who}: ...and carries no mark or count`, !/\d/.test(words) && !/badge|count/.test(btn?.[1] ?? ""));
  }
}

group("The sport switcher (glossary review item 4)");
{
  const cricket = { code: "cricket", label: "Cricket", enabled: true, engine: "scoring" };
  const netball = { code: "netball", label: "Netball", enabled: true, engine: "fixtures" };
  const hockey = { code: "hockey", label: "Hockey", enabled: false, engine: "fixtures" };
  ok("a school that plays one sport is drawn no switcher", renderToStaticMarkup(h(SportSwitcher, { sports: [cricket] })) === "");
  ok("...nor one whose other sports are not switched on", renderToStaticMarkup(h(SportSwitcher, { sports: [cricket, hockey] })) === "");
  ok("...nor while the list is empty (unread, or not read)", renderToStaticMarkup(h(SportSwitcher, { sports: [] })) === "");
  const two = renderToStaticMarkup(h(SportSwitcher, { sports: [netball, cricket] }));
  const btn = two.match(/<button[^>]*data-testid="sport-switcher-button"[^>]*>/)?.[0] ?? "";
  ok("two sports: the switcher is drawn, showing the scorable one", two.includes('data-testid="sport-switcher"') && />Cricket</.test(two), two.slice(0, 300));
  ok("...its button a 44px target", /min-height:44px/.test(btn), btn);
  // The options are drawn only when open, so their floor is read from the source.
  const src = readFileSync(new URL("../src/shell/MobileNav.jsx", import.meta.url), "utf8");
  const option = src.split("\n").find((l) => l.includes("sport-option-")) ?? "";
  ok("...and each option a 44px target too", /minHeight:"44px"/.test(option), option.trim().slice(0, 200));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
