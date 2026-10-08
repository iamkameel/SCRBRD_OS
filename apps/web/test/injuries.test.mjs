/**
 * The Injuries screen's phase and severity words and its counts (GA-I19
 * design, D7, slice 0). No DOM, no database, no clock (the clock is passed in).
 *
 * The words are held to the database: the CHECK lists on `injury.phase` and
 * `injury.severity` are read from db/00_schema_core.sql, so a widened or
 * renamed CHECK fails here until the screen's words are decided again.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/injuries.test.mjs
 */
import { readFileSync } from "node:fs";
import { INJURIES } from "../src/data/mock.js";
import { PHASE_WORDS, SEVERITY_WORDS, injuryCounts, phaseWord, severityWord } from "../src/lib/injury.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

// The CHECK, read from the schema: `<column> text NOT NULL … CHECK (<column> IN ('a','b'))`.
const schema = readFileSync(new URL("../../../db/00_schema_core.sql", import.meta.url), "utf8");
const injuryTable = schema.match(/CREATE TABLE injury \(([\s\S]*?)\n\);/)?.[1] ?? "";
const checkOf = (column) => {
  const m = injuryTable.match(new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
};
const DB_PHASES = checkOf("phase");
const DB_SEVERITIES = checkOf("severity");
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

group("the words are the database's words");
ok("the schema's phase CHECK was found", Array.isArray(DB_PHASES) && DB_PHASES.length > 0, DB_PHASES);
ok("the schema's severity CHECK was found", Array.isArray(DB_SEVERITIES) && DB_SEVERITIES.length > 0, DB_SEVERITIES);
ok("the phase words are exactly the CHECK's values", same(Object.keys(PHASE_WORDS), DB_PHASES ?? []), [Object.keys(PHASE_WORDS), DB_PHASES]);
ok("the severity words are exactly the CHECK's values", same(Object.keys(SEVERITY_WORDS), DB_SEVERITIES ?? []), [Object.keys(SEVERITY_WORDS), DB_SEVERITIES]);
ok("active shows as Injured", phaseWord("active") === "Injured");
ok("rehab shows as Rehabilitating", phaseWord("rehab") === "Rehabilitating");
ok("cleared shows as Cleared", phaseWord("cleared") === "Cleared");
ok("minor, moderate and severe show as Minor, Moderate and Severe",
   severityWord("minor") === "Minor" && severityWord("moderate") === "Moderate" && severityWord("severe") === "Severe");
ok("no sub-phase and no 'mild' is a word", ["Reconditioning", "Strengthening", "Immobilisation", "Return to bowl", "mild"]
   .every((w) => phaseWord(w) === null && severityWord(w) === null));
ok("a phase or severity not read (NULL) is no word", phaseWord(null) === null && phaseWord(undefined) === null && severityWord(null) === null);
ok("Object.prototype keys are no word", phaseWord("constructor") === null && severityWord("toString") === null);

group("the fixture uses only those words");
ok("mock.js has injuries to check", INJURIES.length > 0);
ok("every mock injury's phase is a CHECK value", INJURIES.every((i) => (DB_PHASES ?? []).includes(i.phase)), INJURIES.map((i) => i.phase));
ok("every mock injury's severity is a CHECK value", INJURIES.every((i) => (DB_SEVERITIES ?? []).includes(i.severity)), INJURIES.map((i) => i.severity));
ok("the mock still shows each phase once or more", ["active", "rehab", "cleared"].every((p) => INJURIES.some((i) => i.phase === p)));

group("the counts follow phase, not restricted");
const NOW = new Date("2026-10-08T08:00:00Z");
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10);
const ROWS = [
  { phase: "active",  restricted: true,  rtw: day(20) },
  { phase: "active",  restricted: true,  rtw: day(3) },
  { phase: "rehab",   restricted: true,  rtw: day(5) },     // rehabilitating and still restricted
  { phase: "rehab",   restricted: false, rtw: day(12) },    // rehabilitating, not restricted
  { phase: "cleared", restricted: false, rtw: day(-2) },
  { phase: "cleared", restricted: true,  rtw: day(7) },     // restricted flag stale on a cleared row
];
const full = injuryCounts(ROWS, { natureTier: true, now: NOW });
ok("Injured counts phase 'active' (2), not restricted (4)", full.injured === 2, full);
ok("Rehabilitating counts phase 'rehab' (2), including a boy not restricted", full.rehab === 2, full);
ok("Out counts restricted (4)", full.out === 4, full);
ok("Returning soon counts rtw within 7 days (3: day 3, 5, 7)", full.returningSoon === 3, full);
const oneRehab = injuryCounts([{ phase: "rehab", restricted: true, rtw: day(30) }], { natureTier: true, now: NOW });
ok("a rehabilitating boy who is restricted is in Rehabilitating and not in Injured", oneRehab.injured === 0 && oneRehab.rehab === 1, oneRehab);
ok("no rows, all zero", JSON.stringify(injuryCounts([], { natureTier: true, now: NOW })) === JSON.stringify({ injured: 0, rehab: 0, out: 0, returningSoon: 0 }));

group("a status-only reader gets Out, and no phase count");
const MASKED = ROWS.map((r) => ({ ...r, phase: null }));      // injury_masked: phase is the nature tier
const status = injuryCounts(MASKED, { natureTier: false, now: NOW });
ok("Out: 4 from restricted", status.out === 4, status);
ok("no Injured and no Rehabilitating count", status.injured === null && status.rehab === null, status);
ok("returning soon is still the rtw count", status.returningSoon === 3, status);
ok("even with phases present, a reader without the nature tier gets no phase count",
   injuryCounts(ROWS, { natureTier: false, now: NOW }).injured === null);

group("the fixture's own counts");
const m = injuryCounts(INJURIES, { natureTier: true, now: new Date() });
ok("mock: 1 injured, 3 rehabilitating, 4 out", m.injured === 1 && m.rehab === 3 && m.out === 4, m);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
