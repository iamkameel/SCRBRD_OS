/**
 * SWITCHED OFF: HIDDEN FOR THAT USER, BUT STILL RECORDING (Kameel, 13 Nov 2026).
 *
 * "Anything that's switched off for a user should be hidden for that user but
 * still record data." Two halves, and this file holds what can be said of each
 * without a server:
 *
 *   HIDDEN. The one test every screen asks of the feature map (isOff, navOff),
 *   the sports drawn (sportsOn: no "SOON" badge), the cockpit's panels
 *   (withSwitches: the bus without Logistics, the dossier without Opposition),
 *   and the day sheet drawn with Injuries, Training and Logistics off: no "Who
 *   is out", no session in "This week", no bus and no Transport chip. Hiding
 *   only ever narrows: a key the map does not answer, or answers on, draws
 *   what it always drew, and nothing is granted.
 *
 *   RECORDED. The write routes of the modules that hold no child's own data
 *   (logistics, officials, sponsors' signing, broadcast's settings) carry no
 *   module tag in server.mjs any more, so they store while off; the six that
 *   hold a child's data (skills, injuries, workload_monitoring, scouting,
 *   lift_club, scorebook_import) keep every tag they had; training keeps its
 *   tags (the lead's call); a sponsor's placement keeps its tag (an outward
 *   act). tools/smoke-modules.mjs proves the same against a real server, and
 *   db/99 §154 the database's half.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/switched-off.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { MODULES, MODULE_OF_NAV } from "@scrbrd/policy/modules";
import { isOff, navOff, sportsOn, sportBadge } from "../src/lib/features.js";
import { PANEL_MODULE, withSwitches } from "../src/lib/cockpit.js";
import { DaySheet } from "../src/views/DashboardView.jsx";
import { buildDaySheet, buildMatch } from "../src/views/pitchdeck/demo.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

group("isOff: only an explicit false hides");
ok("false is off", isOff({ injuries: false }, "injuries") === true);
ok("true is on", isOff({ injuries: true }, "injuries") === false);
ok("unknown is on (the menu's rule, features.js)", isOff({}, "injuries") === false && isOff(null, "injuries") === false && isOff(undefined, "x") === false);
ok("no key is never off", isOff({ undefined: false }, undefined) === false && isOff({ "": false }, "") === false);

group("navOff: every module's destination goes with its switch, and nothing else does");
for (const [key, def] of Object.entries(MODULES)) {
  if (!def.nav) continue;
  ok(`${def.nav} is off when ${key} is`, navOff({ [key]: false }, def.nav) === true);
  ok(`${def.nav} is on when ${key} is`, navOff({ [key]: true }, def.nav) === false);
}
ok("a destination no module owns is never hidden by a switch", ["dashboard", "matches", "settings", "notifications"].every((p) => !MODULE_OF_NAV[p] && navOff(Object.fromEntries(Object.keys(MODULES).map((k) => [k, false])), p) === false));

group("Sports: a sport switched off is not drawn, not badged SOON");
const SPORTS = [
  { code: "cricket", enabled: true, engine: "scoring" },
  { code: "hockey", enabled: true, engine: "fixtures" },
  { code: "rugby", enabled: false, engine: "fixtures" },
  { code: "swimming", enabled: false, engine: "none" },
];
const drawn = sportsOn(SPORTS);
ok("only the sports switched on", drawn.map((s) => s.code).join(",") === "cricket,hockey", drawn);
ok("so no badge drawn says SOON", drawn.every((s) => sportBadge(s).text !== "SOON"));
ok("an empty or missing list draws nothing", sportsOn([]).length === 0 && sportsOn(null).length === 0);
const nav = readFileSync(new URL("../src/shell/MobileNav.jsx", import.meta.url), "utf8");
ok("both sport lists in the shell draw through sportsOn", (nav.match(/sportsOn\(useSports\(\)\.sports\)/g) ?? []).length === 2);

group("The cockpit's panels: a module's panel goes with its switch");
const GATE = { end: "home", role: "coach", school: "s", team: "1XI", teamCode: "1XI",
  panels: { day: true, team: true, side: true, status: true, select: true, load: false, opposition: true, bus: true, lifts: true, liftOffice: false, matchups: true, points: true } };
ok("logistics off: no bus panel", withSwitches(GATE, { logistics: false }).panels.bus === false);
ok("opposition off: no dossier panel", withSwitches(GATE, { opposition: false }).panels.opposition === false);
ok("...and nothing else moves", JSON.stringify({ ...withSwitches(GATE, { logistics: false, opposition: false }).panels, bus: true, opposition: true }) === JSON.stringify(GATE.panels));
ok("on, or unknown: the gate as it was", withSwitches(GATE, { logistics: true }) === GATE && withSwitches(GATE, {}) === GATE && withSwitches(GATE, null) === GATE);
ok("never grants: a panel the gate did not give stays ungiven", withSwitches(GATE, { logistics: true, opposition: true }).panels.load === false
   && Object.values(withSwitches({ ...GATE, panels: { ...GATE.panels, bus: false } }, { logistics: true }).panels).filter(Boolean).length
      === Object.values(GATE.panels).filter(Boolean).length - 1);
ok("no gate stays no gate", withSwitches(null, { logistics: false }) === null);
ok("the lift panels are not switched here (a lift on the road is seen through)", !Object.keys(PANEL_MODULE).some((p) => /lift/i.test(p)));

group("The day sheet: Injuries, Training and Logistics off are hidden, not dashed");
const day = buildDaySheet(buildMatch());
const all = renderToStaticMarkup(h(DaySheet, day));
const offAll = renderToStaticMarkup(h(DaySheet, { ...day, off: { injuries: true, training: true, logistics: true } }));
ok("on: Who is out, the week's sessions, the bus and the Transport chip are drawn",
   /data-testid="day-out"/.test(all) && /data-testid="week-training-deck-tr-1"/.test(all) && /Bus 10:45/.test(all) && /data-testid="ready-transport"/.test(all));
ok("Injuries off: no Who is out", !/data-testid="day-out"/.test(offAll) && !/Z Mahlangu/.test(offAll));
ok("Training off: no session in This week", !/week-training-/.test(offAll) && !/Nets: batting/.test(offAll));
ok("...while the week's fixtures still are", /data-testid="week-fixture-deck-next"/.test(offAll));
ok("Logistics off: no bus and no Transport chip", !/Bus 10:45/.test(offAll) && !/data-testid="ready-transport"/.test(offAll));
ok("...while the other ready chips still are", /data-testid="ready-squad"/.test(offAll) && /data-testid="ready-officials"/.test(offAll));
ok("nothing says switched off, and no dash stands in", !/switched off/i.test(offAll));
const one = renderToStaticMarkup(h(DaySheet, { ...day, off: { injuries: true } }));
ok("one switch hides its own section only", !/data-testid="day-out"/.test(one) && /week-training-deck-tr-1/.test(one) && /Bus 10:45/.test(one));

group("Recorded: which writes still store while off (server.mjs)");
const server = readFileSync(new URL("../../../services/api/server.mjs", import.meta.url), "utf8");
/** The module tag on the route whose pattern matches `path` with `method`, or null; undefined when no route is found. */
const tagOf = (method, path) => {
  for (const line of server.split("\n")) {
    const m = /^\s*\[\/(.+)\/,\s*"(GET|POST|PATCH)",\s*[\w.]+(?:,\s*"([a-z_]+)")?\],/.exec(line);
    if (!m || m[2] !== method) continue;
    if (new RegExp(m[1].replace(/\\\//g, "/")).test(path)) return m[3] ?? null;
  }
  return undefined;
};
const M = "/api/matches/00000000-0000-0000-0000-000000000000";
const RECORDS = [
  ["logistics: a trip", "POST", `${M}/trip`],
  ["logistics: the driver's mark", "POST", "/api/trips/x/mark"],
  ["logistics: a vehicle", "POST", "/api/vehicles"],
  ["officials: an appointment", "POST", `${M}/officials`],
  ["sponsors: a sponsor signed", "POST", "/api/sponsors"],
  ["broadcast: the overlay's settings (publishing refused in the handler)", "POST", `${M}/broadcast`],
];
for (const [what, method, path] of RECORDS) ok(`${what} is routed, with no module gate`, tagOf(method, path) === null, tagOf(method, path));
const REFUSES = [
  ["skills: an assessment", "POST", "/api/players/x/assessment", "skills"],
  ["skills: a coaching point", "POST", "/api/players/x/coaching-points", "skills"],
  ["skills: a withdrawal", "POST", "/api/skills/x/withdraw", "skills"],
  ["skills: a target", "POST", "/api/players/x/targets", "skills"],
  ["injuries: a record", "POST", "/api/injuries", "injuries"],
  ["injuries: a review", "POST", "/api/injuries/x/reviews", "injuries"],
  ["workload: a nets load", "POST", "/api/load-entry", "workload_monitoring"],
  ["scouting: an accreditation", "POST", "/api/scouts/accreditation", "scouting"],
  ["scouting: a decision", "POST", "/api/scouts/x/accreditation/decide", "scouting"],
  ["lift club: an offer", "POST", "/api/matches/00000000-0000-0000-0000-000000000000/lifts", "lift_club"],
  ["lift club: the policy signed", "POST", "/api/lifts/policy", "lift_club"],
  ["training: a session (the lead's call, unchanged)", "POST", "/api/training", "training"],
  ["training: attendance (unchanged)", "POST", "/api/training/x/attendance", "training"],
  ["sponsors: a placement (an outward act)", "POST", "/api/sponsorships", "sponsors"],
];
for (const [what, method, path, key] of REFUSES) ok(`${what} keeps its gate`, tagOf(method, path) === key, tagOf(method, path));
const sb = readFileSync(new URL("../../../services/api/write/scouting-api.mjs", import.meta.url), "utf8");
ok("broadcast: publishing asks the feature before it writes, and refuses as module_disabled",
   /if \(b\.published === true\) \{\s*const \{ rows: \[gate\] \} = await client\.query\(`select my_feature_enabled\('broadcast'\) as on`\);/.test(sb)
   && /error: "module_disabled", module: "broadcast"/.test(sb));

console.log("\n" + "─".repeat(52));
console.log(`SWITCHED OFF: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
