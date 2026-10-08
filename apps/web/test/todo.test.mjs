/**
 * The parent's action list, phase A0 (docs/design/GA-I20_parent_action_list.md
 * §2, §4, §6, §7): R1 (an answer is owed) and R2 (answer again), the row, the
 * fourteen-day fold and the count line with its "Could not read …". Hand-built
 * fixtures, no DOM, no database, no clock (the clock is passed in).
 *
 * The browser walk (tools/smoke-browser-read.mjs, the parent's list) holds the
 * screen to this.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/todo.test.mjs
 */
import { readFileSync } from "node:fs";
import { FORBIDDEN_FIELDS, NEVER_ON_THE_COCKPIT } from "../src/lib/cockpitNever.js";
import { CLOCK_HOURS, WINDOW_DAYS, HANDOVER_MINUTES, OFF, countWords, dayFixtures, firstNameOf, fixturesToRead, recordOf, ruleOf, todoOf } from "../src/lib/todo.js";
import { NEVER_ON_THE_TAB } from "../src/lib/captain.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", KES = "kes";
const NOW = Date.parse("2026-10-07T08:00:00Z");              // Wednesday 10:00 SA
const at = (iso, o = {}) => ({ id: o.id ?? iso, schoolId: HIL, homeTeam: "1XI", awayTeamCode: null, awaySchoolId: null,
  homeLabel: "Hilton College 1st XI", awayLabel: o.opponent ?? "Kearsney College 1st XI", status: "upcoming",
  startsAt: `${iso}.000Z`, date: iso.slice(0, 10), time: iso.slice(11, 16), ...o });
const SAT = at("2026-10-10T07:00:00", { id: "sat" });          // 3 days off
const SUN = at("2026-10-11T07:00:00", { id: "sun", opponent: "Maritzburg College 1st XI" });
const IN_14 = at("2026-10-21T07:00:00", { id: "in-14" });       // 14 days off, a little under
const LATE_A = at("2026-10-24T07:00:00", { id: "late-a" });     // 17 days off: folded
const LATE_B = at("2026-10-31T07:00:00", { id: "late-b" });
const OTHER_SIDE = at("2026-10-10T09:00:00", { id: "u16b", homeTeam: "U16B" });
const AT_KES = at("2026-10-10T08:00:00", { id: "at-kes", schoolId: KES });
const PLAYED = at("2026-10-05T07:00:00", { id: "played", status: "complete" });

const ROHAN = { id: "p-rohan", name: "R Pillay", knownAs: null, school: HIL, team: "1XI" };
const ANIKA = { id: "p-anika", name: "A Pillay", knownAs: "Anika", school: KES, team: "1XI" };
const row = (playerId, status, o = {}) => ({ playerId, name: `Boy ${playerId}`, team: "1XI", status, saidStatus: null, needsReconfirming: false,
  reasonKind: null, note: null, ...o });
/** A whole side's read: every other boy silent, and his own row as given. */
const side = (his) => [row("p-b1", null, { reasonKind: "illness", note: "Has a cold" }), row("p-b2", "unavailable", { reasonKind: "family", note: "Away" }),
  his, row("p-b3", "needs_reconfirming", { needsReconfirming: true })];
const said = (...ms) => Object.fromEntries(ms.map(([m, rows]) => [m.id, rows]));

const SAYS = /\b(done|ready|cleared|resolved|complete|all clear|overdue|urgent|priority)\b|%/i;
const words = (t) => [t.label, t.line, t.later.line, t.clockWords, ...t.rows.flatMap((r) => [r.fact, r.owner, r.byWhenText, r.sourceText, r.door?.label]),
  ...t.later.rows.flatMap((r) => [r.fact, r.owner, r.byWhenText, r.sourceText, r.door?.label])].filter(Boolean);

group("R1: an answer is owed when his row says nothing");
{
  const silent = todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, [row("p-rohan", null)]]), now: NOW });
  ok("a null status is one row: R1, for that fixture", silent.rows.length === 1 && silent.rows[0].rule === "R1" && silent.rows[0].matchId === "sat", silent.rows);
  ok("...worded with the day and the other side: 'Answer for Sat v Kearsney College 1st XI'", silent.rows[0].fact === "Answer for Sat v Kearsney College 1st XI", silent.rows[0].fact);
  ok("...open, and counted: '1 to do'", silent.rows[0].state === "open" && silent.open === 1 && silent.line === "1 to do" && !silent.clear, silent.line);
  for (const status of ["available", "doubtful", "unavailable"]) {
    const t = todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, [row("p-rohan", status)]]), now: NOW });
    ok(`status '${status}' is an answer, whoever gave it: no row`, t.rows.length === 0 && t.open === 0 && t.line === "Nothing to do for R Pillay", t.line);
  }
  ok("an answer the coach gave for him clears it too: one record per boy (the row says only that it is answered)",
     todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, [row("p-rohan", "available", { selfDeclared: false, declaredByName: "J Coach" })]]), now: NOW }).rows.length === 0);
  ok("his row missing from a read that answered is not proof of silence: no row (the server did not say)",
     todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, [row("p-b1", null)]]), now: NOW }).rows.length === 0);
  ok("ruleOf: null fires R1; every set status fires none; needs_reconfirming fires R2; no row fires none",
     ruleOf({ status: null }) === "R1" && ruleOf({ status: undefined }) === "R1" && ["available", "doubtful", "unavailable"].every((s) => ruleOf({ status: s }) === null)
     && ruleOf({ status: "needs_reconfirming" }) === "R2" && ruleOf(null) === null);
}

group("R2: answer again, once the fixture has moved");
{
  const moved = todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, [row("p-rohan", "needs_reconfirming", { needsReconfirming: true, saidStatus: "available" })]]), now: NOW });
  ok("needs_reconfirming is one row: R2", moved.rows.length === 1 && moved.rows[0].rule === "R2" && moved.line === "1 to do", moved.rows);
  ok("...worded as a move to say again", moved.rows[0].fact === "Sat v Kearsney College 1st XI moved: say again", moved.rows[0].fact);
  ok("...with the one door: the fixture, 'Say again'", moved.rows[0].door.kind === "fixture" && moved.rows[0].door.matchId === "sat" && moved.rows[0].door.label === "Say again");
  ok("the server's flag alone is enough (a client that never saw the word)", ruleOf({ status: "available", needsReconfirming: true }) === "R2");
  ok("an R2 row never says what he had answered before", !/available|unavailable|doubtful/i.test(moved.rows[0].fact + moved.rows[0].owner));
}

group("The row: its source, its by-when and its one door");
{
  const r = todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, [row("p-rohan", null)]]), now: NOW }).rows[0];
  ok("source: the fixture's answers, named for 'why am I seeing this'", r.source === "availability" && r.sourceText === "from the fixture's answers");
  ok("owner: you or him", r.owner === "you or R Pillay", r.owner);
  ok(`by-when: ${CLOCK_HOURS} hours before the start, on the South African clock, labelled as the list's clock`,
     CLOCK_HOURS === 48 && r.byWhenText === "by Thu 09:00" && r.byWhen === Date.parse("2026-10-10T07:00:00Z") - 48 * 3600e3 && r.clockLabel === "the list's clock", r);
  ok("one door, the fixture: where the answer is given today", r.door.kind === "fixture" && r.door.matchId === "sat" && Object.keys(r.door).sort().join() === "kind,label,matchId");
  ok("it names its child by id and nobody else", r.childId === "p-rohan");
  const near = todoOf({ child: ROHAN, matches: [at("2026-10-08T07:00:00", { id: "tomorrow" })], answers: { tomorrow: [row("p-rohan", null)] }, now: NOW }).rows[0];
  ok("a fixture already inside the forty-eight hours: 'due now', never a time in the past", near.byWhenText === "due now" && near.byWhen < NOW, near.byWhenText);
  const first = todoOf({ child: { ...ROHAN, knownAs: "Rohan" }, matches: [SAT], answers: said([SAT, [row("p-rohan", null)]]), now: NOW });
  ok("his first name is the family's own: the card says 'To do for Rohan' and the owner 'you or Rohan'",
     first.label === "To do for Rohan" && first.rows[0].owner === "you or Rohan" && firstNameOf({ knownAs: "Rohan", name: "R Pillay" }) === "Rohan" && firstNameOf({ name: "R Pillay" }) === "R Pillay");
  ok("the list says what its clock is, when a row carries one", first.clocked && first.clockWords === "By-when is 48 hours before the start.");
  ok("nothing open: no clock to explain", !todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, [row("p-rohan", "available")]]), now: NOW }).clocked);
}

group("One row out per child, whatever side came in (D11)");
{
  const t = todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, side(row("p-rohan", null))]), now: NOW });
  ok("a side's worth of rows in: one row out, his", t.rows.length === 1 && t.open === 1 && t.rows[0].childId === "p-rohan", t.rows);
  const json = JSON.stringify(t);
  ok("...and nothing of another boy in anything the module returns (no id, no name)", !/p-b[123]|Boy p-/.test(json), json.match(/p-b\d|Boy p-\w+/)?.[0]);
  const whole = todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, side(row("p-rohan", "available"))]), now: NOW });
  ok("a side's worth in where HIS row is answered: nothing, though three other boys are silent or asked again", whole.rows.length === 0 && whole.line === "Nothing to do for R Pillay", whole.line);
  const twice = todoOf({ child: ROHAN, matches: [SAT], answers: said([SAT, [row("p-rohan", null), row("p-rohan", null)]]), now: NOW });
  ok("his row twice in one read is still one row", twice.rows.length === 1);
  const many = todoOf({ child: ROHAN, matches: [SAT, SUN], answers: said([SAT, side(row("p-rohan", null))], [SUN, side(row("p-rohan", "needs_reconfirming", { needsReconfirming: true }))]), now: NOW });
  ok("two fixtures, a side's worth each: one row each for him, R1 then R2, nearest first", many.rows.map((r) => `${r.rule}:${r.matchId}`).join() === "R1:sat,R2:sun" && many.line === "2 to do", many.rows);
  // Two children, two schools: two lists, each from its own reads, never one count.
  const kesMatch = at("2026-10-10T08:00:00", { id: "kes-sat", schoolId: KES });
  const both = [SAT, kesMatch];
  const answers = said([SAT, [row("p-rohan", null)]], [kesMatch, [row("p-anika", null)]]);
  const a = todoOf({ child: ROHAN, matches: both, answers, now: NOW }), b = todoOf({ child: ANIKA, matches: both, answers, now: NOW });
  ok("two children at two schools are two lists: each one row, from its own school's fixture", a.rows.length === 1 && b.rows.length === 1
     && a.rows[0].matchId === "sat" && b.rows[0].matchId === "kes-sat" && a.childId !== b.childId, [a.rows, b.rows]);
  ok("...each says '1 to do' and nothing sums them: no '2 to do' anywhere", a.line === "1 to do" && b.line === "1 to do" && a.label === "To do for R Pillay" && b.label === "To do for Anika");
  ok("a fixture of another side, another school or already played gives no row, answered or not",
     todoOf({ child: ROHAN, matches: [OTHER_SIDE, AT_KES, PLAYED], answers: said([OTHER_SIDE, [row("p-rohan", null)]], [AT_KES, [row("p-rohan", null)]], [PLAYED, [row("p-rohan", null)]]), now: NOW }).rows.length === 0);
  ok("an answer read for a fixture of another side is never drawn on this child's list", todoOf({ child: ROHAN, matches: [SAT], answers: { ...said([SAT, [row("p-rohan", "available")]]), u16b: [row("p-rohan", null)] }, now: NOW }).rows.length === 0);
}

group("A read that failed is a row; an empty read is not (I08)");
{
  const matches = [SAT, SUN];
  const failed = todoOf({ child: ROHAN, matches, answers: { sat: null, sun: [row("p-rohan", null)] }, now: NOW });
  ok("a null read gives a 'Could not read …' row in its own place, naming the fixture", failed.rows.some((r) => r.state === "could_not_read" && r.fact === "Could not read the answers for Sat v Kearsney College 1st XI"), failed.rows);
  ok("...with the one door of trying again", failed.rows.find((r) => r.state === "could_not_read").door.kind === "retry");
  ok("...the count keeps the rows that answered and says so: '1 to do · 1 read failed'", failed.open === 1 && failed.unread === 1 && failed.line === "1 to do · 1 read failed", failed.line);
  ok("...and it is not the same as clear", !failed.clear);
  const none = todoOf({ child: ROHAN, matches, answers: { sat: null, sun: [row("p-rohan", "available")] }, now: NOW });
  ok("ZERO ROWS AND A FAILED READ DO NOT LOOK THE SAME: '0 to do · 1 read failed', never 'Nothing to do'", none.line === "0 to do · 1 read failed" && !none.clear && !/Nothing to do/.test(none.line), none.line);
  const two = todoOf({ child: ROHAN, matches, answers: { sat: null, sun: null }, now: NOW });
  ok("two reads failed: '0 to do · 2 reads failed'", two.line === "0 to do · 2 reads failed" && two.rows.length === 2, two.line);
  const empty = todoOf({ child: ROHAN, matches, answers: { sat: [], sun: [] }, now: NOW });
  ok("an empty read (no roster rows at all) gives no row", empty.rows.length === 0 && empty.unread === 0);
  ok("...it is a read that answered: 'Nothing to do for R Pillay'", empty.line === "Nothing to do for R Pillay" && empty.clear, empty.line);
  const gone = todoOf({ child: ROHAN, matches: null, answers: {}, now: NOW });
  ok("the fixture list itself failing is a row, and never 'Nothing to do'", gone.rows.length === 1 && gone.rows[0].fact === "Could not read the fixtures" && gone.line === "0 to do · 1 read failed" && !gone.clear, gone.line);
  ok("...it has no door to try again here (the Home's own list is read once)", gone.rows[0].door === null);
  const reading = todoOf({ child: ROHAN, matches, answers: { sat: [row("p-rohan", null)] }, now: NOW });
  ok("a read not answered yet: 'Reading…', with the rows that have arrived, and never 'Nothing to do'", reading.line === "Reading…" && reading.reading && reading.rows.length === 1 && !reading.clear, reading.line);
  ok("the fixture list not read yet: 'Reading…' too", todoOf({ child: ROHAN, matches: undefined, answers: {}, now: NOW }).line === "Reading…");
  ok("no fixtures at all, the list answered: nothing to do, said plainly", todoOf({ child: ROHAN, matches: [], answers: {}, now: NOW }).line === "Nothing to do for R Pillay");
  ok("the fixtures the list reads are his side's still to come, and no others", fixturesToRead([SAT, OTHER_SIDE, AT_KES, PLAYED, SUN], ROHAN, NOW).join() === "sat,sun" && fixturesToRead(null, ROHAN, NOW).length === 0);
}

group("The fourteen-day window: later fixtures fold");
{
  ok("the window is fourteen days", WINDOW_DAYS === 14);
  const all = [SAT, IN_14, LATE_A, LATE_B];
  const silent = Object.fromEntries(all.map((m) => [m.id, [row("p-rohan", null)]]));
  const t = todoOf({ child: ROHAN, matches: all, answers: silent, now: NOW });
  ok("inside fourteen days: drawn and counted (a fixture 14 days, less a few hours, off is inside)", t.rows.map((r) => r.matchId).join() === "sat,in-14" && t.open === 2 && t.line === "2 to do", t.rows);
  ok("beyond it: folded, kept in order, and not counted", t.later.rows.map((r) => r.matchId).join() === "late-a,late-b" && t.later.line === "Later · 2 to answer", t.later);
  ok("...a folded row is a whole row, with its door", t.later.rows.every((r) => r.state === "open" && r.door.kind === "fixture" && r.byWhenText));
  const onlyLater = todoOf({ child: ROHAN, matches: [LATE_A], answers: { "late-a": [row("p-rohan", null)] }, now: NOW });
  ok("only a later fixture owed: nothing in the window, said for the window and not for ever",
     onlyLater.open === 0 && onlyLater.rows.length === 0 && onlyLater.line === "Nothing to do for R Pillay in the next 14 days" && onlyLater.later.line === "Later · 1 to answer" && !onlyLater.clear, onlyLater.line);
  const answeredLater = todoOf({ child: ROHAN, matches: [LATE_A], answers: { "late-a": [row("p-rohan", "available")] }, now: NOW });
  ok("a later fixture already answered: no fold", answeredLater.later.line === null && answeredLater.later.rows.length === 0 && answeredLater.line === "Nothing to do for R Pillay");
  const lateFail = todoOf({ child: ROHAN, matches: [LATE_A], answers: { "late-a": null }, now: NOW });
  ok("a later fixture whose read failed is still a failed read, never a quiet one", lateFail.unread === 1 && lateFail.line === "0 to do · 1 read failed", lateFail.line);
  ok("the fold and the order do not depend on the order the fixtures came in", todoOf({ child: ROHAN, matches: [LATE_B, IN_14, LATE_A, SAT], answers: silent, now: NOW }).later.rows.map((r) => r.matchId).join() === "late-a,late-b");
}

group("What this module says: counts and the names of reads, never a reason, never 'done'");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const code = strip(readFileSync(new URL("../src/lib/todo.js", import.meta.url), "utf8"));
  const card = strip(readFileSync(new URL("../src/views/family/todo.jsx", import.meta.url), "utf8"));
  const hit = FORBIDDEN_FIELDS.filter((w) => new RegExp(`\\b${w}\\b`).test(code + card));
  ok(`no forbidden field is read (${FORBIDDEN_FIELDS.join(", ")})`, hit.length === 0, hit);
  // The one name it may read is the child's own, to say "To do for Rohan".
  const bare = (code + card).replace(/\bchild\??\.(name|knownAs)\b/g, "child");
  ok("it reads no reason, no note, no name but the child's own, and no word of what he said before",
     !/\.(reason\w*|note|name|full_name|declaredByName|saidStatus|wasLine|fixtureWords|injury\w*|severity|rtw\w*|returnDate|clinical\w*)\b/.test(bare),
     bare.match(/\.(reason\w*|note|name|full_name|declaredByName|saidStatus|wasLine|clinical\w*)\b/)?.[0]);
  ok("it asks for no phone, address or email", !/\b(phone|email|address)\b/i.test(code + card));
  ok("the only playerId it reads is the narrowing to the one child, in one place (D11)", (code.match(/\bplayerId\b/g) ?? []).length === 1 && /r\.playerId === child\.id/.test(code), code.match(/\bplayerId\b/g));
  ok("...and no card draws a name or an id of anyone but the child it was handed", !/\.playerId|full_name|\.name\b/.test(card.replace(/child\.name/g, "")), card.match(/\.playerId|full_name/)?.[0]);
  ok("the module fetches nothing and writes nothing, and reads no clock", !/\bapi\(|fetch\(|localStorage|sessionStorage|Date\.now|new Date\(\)|XMLHttpRequest/i.test(code));
  ok("it imports no screen and no react", !/from "\.\.\/(views|ui)\//.test(code) && !/from "react"/.test(code));
  // A1: the card reads the design's §5.1 sources and nothing else, and writes nothing.
  const paths = [...card.matchAll(/api\(`([^`]*)`/g)].map((m) => m[1]).concat([...card.matchAll(/api\("([^"]*)"/g)].map((m) => m[1]));
  const reads = [...card.matchAll(/readLive\("([a-z_]+)"/g)].map((m) => m[1]);
  ok("the card makes no write: no POST, no useLive of its own", !/method:\s*"POST"|useLive\(/.test(card));
  ok(`its routes are the fixture's lifts, her lifts' request counts and the public-name answer (${paths.join(" ")})`,
     paths.length === 3 && paths.every((p) => ["/api/matches/${id}/lifts", "/api/lifts/requests-mine", "/api/players/${child.id}/public-name"].includes(p)), paths);
  ok(`its reads are the answers, the consents and the COUNT of numbers (${reads.join(" ")})`,
     reads.sort().join() === "availability,consents,emergency_contact_count", reads);
  ok("it never asks for a contact, a passenger's name or the driver's number (the logged doors)",
     !/emergency_contacts"|\/passengers|\/contacts|lifts\/day/.test(card));
  ok("no 'done', 'ready', 'complete', 'cleared' and no percentage in what it can say", !/["'`][^"'`]*\b(done|ready|cleared|complete|all clear|resolved)\b[^"'`]*["'`]|%/i.test(code.replace(/\/\/.*$/gm, "")), code.match(/["'`][^"'`]*\b(done|ready|cleared|complete)\b[^"'`]*["'`]/i)?.[0]);

  // Every sentence it can say, in every state, over a side whose other boys carry reasons and notes.
  const rec = side(row("p-rohan", null));
  const states = [
    todoOf({ child: ROHAN, matches: [SAT, SUN, LATE_A], answers: { sat: rec, sun: [row("p-rohan", "needs_reconfirming", { needsReconfirming: true, reasonKind: "illness", note: "He has the flu" })], "late-a": rec }, now: NOW }),
    todoOf({ child: ROHAN, matches: [SAT], answers: { sat: null }, now: NOW }),
    todoOf({ child: ROHAN, matches: [SAT], answers: {}, now: NOW }),
    todoOf({ child: ROHAN, matches: null, answers: {}, now: NOW }),
    todoOf({ child: ROHAN, matches: [SAT], answers: { sat: [row("p-rohan", "unavailable", { reasonKind: "family", note: "Away for a wedding" })] }, now: NOW }),
    todoOf({ child: ROHAN, matches: [LATE_A], answers: { "late-a": [row("p-rohan", null)] }, now: NOW }),
  ];
  const say = states.flatMap(words);
  ok(`${say.length} sentences across six states pass the cockpit's never-words, and say no 'done', 'ready', 'cleared' and no percentage`,
     say.every((l) => !NEVER_ON_THE_COCKPIT.test(l) && !SAYS.test(l)), say.filter((l) => NEVER_ON_THE_COCKPIT.test(l) || SAYS.test(l)));
  ok("none carries a reason or a note of anyone's answer, nor a word of 'ill', 'family', 'flu', 'wedding', 'cold'",
     !say.some((l) => /illness|\bfamily\b|\bflu\b|wedding|\bcold\b|\breason\b|\bnote\b|Away/i.test(l)), say.filter((l) => /illness|\bfamily\b|\bflu\b|wedding|\bcold\b|\breason\b|\bnote\b|Away/i.test(l)));
  ok("...and nothing of another boy (an id or a name), in any of them", !/p-b[123]|Boy p-/.test(JSON.stringify(states)));
  ok("counts, not percentages: the count line is a number, or a sentence, in every state", states.every((t) => /^(\d+ to do( · \d+ reads? failed)?|Reading…|Nothing to do for R Pillay( in the next 14 days)?)$/.test(t.line)), states.map((t) => t.line));
  ok("'Nothing to do' appears in no state where a read failed, was still out, or a rule fired in the window",
     states.every((t) => !/^Nothing to do/.test(t.line) || (t.unread === 0 && !t.reading && t.open === 0)), states.map((t) => t.line));
}


// ── A1: R3 to R9, the record, the pupil (design §2.3, §3, §7 A1) ─────────
const ROHAN_G = { ...ROHAN, knownAs: "Rohan", schoolName: "Hilton College", consent: "granted", consentVersion: "popia-2026-01",
                  consentAt: "2026-01-12T10:30:00Z", from: "2026-01-12", until: null };
/** Every A1 source answered with nothing owed: the base each group changes one thing of. */
const quiet = (o = {}) => ({ child: ROHAN_G, matches: [SAT], answers: said([SAT, [row("p-rohan", "available")]]), now: NOW,
  lifts: { sat: [] }, day: {}, requests: [], consents: [], publicName: { mine: { state: "given", actor: "you", givenOn: "2026-01-14", version: "public-names-2026-10", recordedAt: "2026-01-14T12:02:00Z" } },
  contacts: [{ playerId: "p-rohan", active: 2 }], ...o });
const MEET_SAT = "2026-10-10T05:15:00.000Z";                       // 07:15 SA, Saturday
const offer = (o = {}) => ({ id: "o-1", schoolId: HIL, team: "1XI", leg: "out", driverName: "H Whitfield", mine: false, meetAt: MEET_SAT,
  state: "open", version: 2, awaitingDriver: false, mySeats: [], ...o });
const seat = (playerId, status, id = `s-${playerId}`) => ({ seatId: id, playerId, status });
const rulesOf = (t) => t.rows.map((r) => r.rule ?? `unread:${r.key}`).join();

group("A1: every source answered and nothing owed says so; a source left out or OFF says nothing");
{
  const t = todoOf(quiet());
  ok("all quiet: 'Nothing to do for Rohan'", t.line === "Nothing to do for Rohan" && t.rows.length === 0 && t.clear, [t.line, rulesOf(t)]);
  const off = todoOf(quiet({ lifts: OFF, requests: OFF, day: OFF, consents: OFF, publicName: OFF, contacts: OFF }));
  ok("every A1 source OFF (a module off, a reader it is not for): no row, no line, no 'read failed'", off.line === "Nothing to do for Rohan" && off.unread === 0);
  const reading = todoOf(quiet({ contacts: undefined }));
  ok("one A1 read still out: 'Reading…', never 'Nothing to do'", reading.line === "Reading…" && !reading.clear);
}

group("R3: a seat to confirm again, his and nobody else's");
{
  const t = todoOf(quiet({ lifts: { sat: [offer({ mySeats: [seat("p-rohan", "awaiting_guardian"), seat("p-sibling", "awaiting_guardian")] })] } }));
  const r = t.rows.find((x) => x.rule === "R3");
  ok("his seat awaiting a guardian's yes is one R3 row", t.rows.filter((x) => x.rule === "R3").length === 1 && r.childId === "p-rohan", rulesOf(t));
  ok("...worded with the adult who drives, the leg and the fixture: 'Rohan's seat with H Whitfield there for Sat v Kearsney College 1st XI: confirm again'",
     r.fact === "Rohan's seat with H Whitfield there for Sat v Kearsney College 1st XI: confirm again", r.fact);
  ok("...owned by either parent, by the meeting time (Sat 07:15), with the fixture's lifts as its door",
     r.owner === "you or Rohan's other parent" && r.byWhenText === "by Sat 07:15" && r.door.kind === "fixture" && r.door.label === "Lifts" && r.door.matchId === "sat", r);
  ok("a sibling's seat on the same read is never on Rohan's list", !JSON.stringify(t).includes("p-sibling"));
  for (const st of ["confirmed", "requested", "declined", "awaiting_driver"]) {
    ok(`a seat '${st}' (far from meeting) is no R3`, !todoOf(quiet({ lifts: { sat: [offer({ mySeats: [seat("p-rohan", st)] })] } })).rows.some((x) => x.rule === "R3"));
  }
  ok("the other parent's reconfirm clears it: the read says confirmed, and the row is gone", todoOf(quiet({ lifts: { sat: [offer({ mySeats: [seat("p-rohan", "confirmed")] })] } })).clear);
  ok("a lifts read that failed is a row with a retry, in the fixture's place", rulesOf(todoOf(quiet({ lifts: { sat: null } }))) === "unread:lifts:sat"
     && todoOf(quiet({ lifts: { sat: null } })).rows[0].fact === "Could not read the lifts for Sat v Kearsney College 1st XI");
  ok("a lifts read not answered yet: 'Reading…'", todoOf(quiet({ lifts: {} })).line === "Reading…");
}

group("R4: a seat still only asked for, inside 48 hours of meeting");
{
  const near = todoOf(quiet({ now: Date.parse("2026-10-08T08:00:00Z"), lifts: { sat: [offer({ mySeats: [seat("p-rohan", "requested")] })] } }));
  const r = near.rows.find((x) => x.rule === "R4");
  ok("requested, 45 hours from meeting: one R4 row", Boolean(r) && r.fact === "Rohan's seat there for Sat v Kearsney College 1st XI is not confirmed; the driver has not answered" && r.owner === "you", r?.fact);
  ok("requested, 69 hours from meeting: not yet hers to decide", !todoOf(quiet({ lifts: { sat: [offer({ mySeats: [seat("p-rohan", "requested")] })] } })).rows.some((x) => x.rule === "R4"));
  ok("after the meeting time: no row", !todoOf(quiet({ now: Date.parse("2026-10-10T06:00:00Z"), matches: [at("2026-10-10T09:00:00", { id: "sat" })],
    lifts: { sat: [offer({ mySeats: [seat("p-rohan", "requested")] })] } })).rows.some((x) => x.rule === "R4"));
}

group("R5 and R6: her own lift, as the driver");
{
  const t = todoOf(quiet({ requests: [{ offerId: "o-9", matchId: "sat", schoolId: HIL, team: "1XI", leg: "back", meetAt: "2026-10-10T13:00:00Z", requested: 2 }] }));
  const r = t.rows.find((x) => x.rule === "R5");
  ok("two seats asked for on her open lift: one R5 row, a count", Boolean(r) && r.fact === "2 requests for a seat on your lift home for Sat v Kearsney College 1st XI" && r.owner === "you, as the driver", r?.fact);
  ok("...from a count read that carries no name and no player", !/playerId|Boy|Pillay/.test(JSON.stringify(r)));
  ok("one request: singular", todoOf(quiet({ requests: [{ offerId: "o-9", matchId: "sat", schoolId: HIL, team: "1XI", leg: "out", meetAt: MEET_SAT, requested: 1 }] })).rows[0]?.fact.startsWith("1 request for a seat"));
  ok("a request on a lift to another side's fixture, or another school's, is not on Rohan's list",
     todoOf(quiet({ requests: [{ offerId: "o-8", matchId: "u16b", schoolId: HIL, team: "U16B", leg: "out", meetAt: MEET_SAT, requested: 3 },
                                { offerId: "o-7", matchId: "sat", schoolId: KES, team: "1XI", leg: "out", meetAt: MEET_SAT, requested: 1 }] })).clear);
  ok("the requests read failing is a row, with a retry", rulesOf(todoOf(quiet({ requests: null }))) === "unread:requests" && todoOf(quiet({ requests: null })).rows[0].door?.kind === "retry");
  const moved = todoOf(quiet({ lifts: { sat: [offer({ mine: true, awaitingDriver: true })] } }));
  ok("her own lift under a moved fixture: R6 'Sat v Kearsney College 1st XI moved. Do you still offer the lift there?'",
     moved.rows.length === 1 && moved.rows[0].rule === "R6" && moved.rows[0].fact === "Sat v Kearsney College 1st XI moved. Do you still offer the lift there?", moved.rows[0]?.fact);
  ok("another driver's lift under the same move: no R6 for her", !todoOf(quiet({ lifts: { sat: [offer({ mine: false, awaitingDriver: true })] } })).rows.some((x) => x.rule === "R6"));
}

group("R7: the handover, on the day only");
{
  const NOW7 = Date.parse("2026-10-10T14:40:00Z");
  const DAYM = at("2026-10-10T07:00:00", { id: "sat", status: "complete" });
  const fam = (seatO = {}, o = {}) => ({ as: "family", offerId: "o-back", leg: "back", driverName: "H Whitfield", departedAt: "2026-10-10T14:20:00Z",
    seats: [{ seatId: "s-r", playerId: "p-rohan", mayReceive: true, handedOverAt: "2026-10-10T14:35:00Z", acknowledgedAt: null, resolvedAt: null, ...seatO }], ...o });
  ok("the day's fixtures are his side's within a day and a half, whatever the status", dayFixtures([DAYM, OTHER_SIDE, LATE_A], ROHAN, NOW7).map((m) => m.id).join() === "sat");
  const t = todoOf(quiet({ now: NOW7, matches: [DAYM], answers: {}, lifts: {}, day: { sat: [fam()] } }));
  const r = t.rows.find((x) => x.rule === "R7");
  ok("handed over, not received: 'H Whitfield says Rohan was handed over at 16:35. Confirm.'", r?.fact === "H Whitfield says Rohan was handed over at 16:35. Confirm.", r?.fact);
  ok(`...by ${HANDOVER_MINUTES} minutes after the handover, the door the day card's 'Confirm collected'`,
     r.byWhen === Date.parse("2026-10-10T14:35:00Z") + 30 * 60e3 && r.door.kind === "day" && r.door.offerId === "o-back" && r.door.label === "Confirm collected", r);
  ok("the car home has left, no handover mark yet: said as left", todoOf(quiet({ now: NOW7, matches: [DAYM], answers: {}, lifts: {}, day: { sat: [fam({ handedOverAt: null })] } })).rows[0]?.fact === "Rohan's lift home with H Whitfield has left. Confirm when Rohan is with you.");
  ok("received (either parent's tap): no row", todoOf(quiet({ now: NOW7, matches: [DAYM], answers: {}, lifts: {}, day: { sat: [fam({ acknowledgedAt: "2026-10-10T14:38:00Z" })] } })).clear);
  ok("the way there: no row", !todoOf(quiet({ now: NOW7, matches: [DAYM], answers: {}, lifts: {}, day: { sat: [fam({}, { leg: "out" })] } })).rows.some((x) => x.rule === "R7"));
  ok("another boy's seat on the card: no row", !todoOf(quiet({ now: NOW7, matches: [DAYM], answers: {}, lifts: {}, day: { sat: [fam({ playerId: "p-other" })] } })).rows.some((x) => x.rule === "R7"));
  ok("the day's read failing is a row, never a quiet day", rulesOf(todoOf(quiet({ now: NOW7, matches: [DAYM], answers: {}, lifts: {}, day: { sat: null } }))) === "unread:lifts_day:sat");
}

group("R8a, R8b, R8c, R9: the undated rows, after the dated ones, in the design's order");
{
  const pending = todoOf(quiet({ child: { ...ROHAN_G, consent: "pending", consentVersion: null, consentAt: null } }));
  ok("R8a: the terms not agreed on her own link", pending.rows[0]?.rule === "R8a" && pending.rows[0].fact === "The school's terms for Rohan are not agreed yet. The office will ask you."
     && pending.rows[0].owner === "you (your own agreement)" && pending.rows[0].byWhenText === "since 12 Jan 2026", pending.rows[0]);
  const withdrawn = todoOf(quiet({ child: { ...ROHAN_G, consent: "withdrawn", consentAt: "2026-09-03T08:00:00Z" } }));
  ok("...withdrawn: said with its date", withdrawn.rows[0]?.fact === "You withdrew the school's terms for Rohan on 3 Sep 2026. Lifts and health monitoring are off until they are agreed again.", withdrawn.rows[0]?.fact);
  const pn = todoOf(quiet({ publicName: { mine: { state: "not_answered", actor: null, version: null, recordedAt: null } } }));
  ok("R8b: her own public-name answer not given", pn.rows.length === 1 && pn.rows[0].rule === "R8b" && /Rohan is shown as "Batter" or "Bowler" on public pages until someone answers/.test(pn.rows[0].fact), pn.rows[0]?.fact);
  ok("...a 'no' clears it as surely as a 'yes'", todoOf(quiet({ publicName: { mine: { state: "refused", actor: "you" } } })).clear);
  ok("...a reader the read answers 404 (not hers to answer): no row", todoOf(quiet({ publicName: OFF })).clear);
  ok("...the read failing: a row", rulesOf(todoOf(quiet({ publicName: null }))) === "unread:public_name");
  const health = (o) => ({ kind: "health", playerId: "p-rohan", relation: "guardian", adult: false, state: "not_answered", moduleOn: true, canSayYes: true, ...o });
  const hc = todoOf(quiet({ consents: [health()] }));
  ok("R8c: health monitoring in use at his school and not answered", hc.rows[0]?.rule === "R8c" && hc.rows[0].fact === "Health monitoring for Rohan: not answered, and Hilton College runs it", hc.rows[0]?.fact);
  ok("...never where the module is off, or the server says she may not say yes", todoOf(quiet({ consents: [health({ moduleOn: false })] })).clear && todoOf(quiet({ consents: [health({ canSayYes: false })] })).clear);
  ok("...answered by anyone: no row", todoOf(quiet({ consents: [health({ state: "given" })] })).clear);
  ok("...another child's consent row is not his", todoOf(quiet({ consents: [health({ playerId: "p-anika" })] })).clear);
  const adult = todoOf(quiet({ consents: [health({ adult: true, canSayYes: false })], publicName: { mine: { state: "not_answered" } } }));
  ok("an adult son (the server's word): no consent row of hers at all, R8b included (D13)", adult.clear, rulesOf(adult));
  const none = todoOf(quiet({ contacts: [{ playerId: "p-rohan", active: 0 }] }));
  ok("R9: no live number, from a count: 'No number is on record to ring if Rohan is hurt', before Sat", none.rows[0]?.rule === "R9"
     && none.rows[0].fact === "No number is on record to ring if Rohan is hurt" && none.rows[0].byWhenText === "before Sat" && none.rows[0].door.kind === "ring", none.rows[0]);
  ok("...one live number clears it", todoOf(quiet({ contacts: [{ playerId: "p-rohan", active: 1 }] })).clear);
  ok("...no row in the count read (another family's child, a reader without the right): no R9, never a zero", todoOf(quiet({ contacts: [] })).clear && todoOf(quiet({ contacts: [{ playerId: "p-other", active: 0 }] })).clear);
  ok("...the count failing: a row", rulesOf(todoOf(quiet({ contacts: null }))) === "unread:emergency_contact_count");
  const all = todoOf(quiet({ answers: said([SAT, [row("p-rohan", null)]]), child: { ...ROHAN_G, consent: "pending" }, contacts: [{ playerId: "p-rohan", active: 0 }],
    consents: [health()], publicName: { mine: { state: "not_answered" } }, lifts: { sat: [offer({ mySeats: [seat("p-rohan", "awaiting_guardian")] })] } }));
  ok("order: the dated rows nearest first (R3 at 07:15 before R1's Sat 09:00 start), then R8a, R8b, R8c, R9", rulesOf(all) === "R3,R1,R8a,R8b,R8c,R9", rulesOf(all));
  ok("...counted together, one child's: '6 to do'", all.line === "6 to do" && countWords(all) === "6 to do", all.line);
  ok("the clock is explained for an answer and for a lift", all.clockWords === "By-when is 48 hours before the start. For a lift, it is the meeting time.", all.clockWords);
}

group("The pupil's list (D12): under eighteen his answers only");
{
  const ME = { id: "p-rohan", name: "R Pillay", knownAs: null, school: HIL, team: "1XI", schoolName: "Hilton College" };
  const everything = { child: ME, self: true, matches: [SAT], answers: said([SAT, [row("p-rohan", null)]]), now: NOW,
    lifts: { sat: [offer({ mySeats: [seat("p-rohan", "awaiting_guardian")] })] }, requests: [{ offerId: "o", matchId: "sat", schoolId: HIL, team: "1XI", leg: "out", meetAt: MEET_SAT, requested: 2 }],
    day: {}, consents: [{ kind: "health", playerId: "p-rohan", relation: "self", adult: false, state: "not_answered", moduleOn: true, canSayYes: false, askAt18: false }],
    publicName: { mine: { as: "pupil", state: "not_answered" } }, contacts: [{ playerId: "p-rohan", active: 0 }] };
  const t = todoOf(everything);
  ok("under eighteen, every source answered and owing: R1 only, worded to him", rulesOf(t) === "R1" && t.label === "To do for you" && t.rows[0].owner === "you or your parents", [rulesOf(t), t.rows[0]?.owner]);
  ok("...no seat, no driver's request, no consent, no contact row, and no 'read failed' for a source that is not his", t.unread === 0 && t.line === "1 to do");
  const moved = todoOf({ ...everything, answers: said([SAT, [row("p-rohan", "needs_reconfirming", { needsReconfirming: true })]]) });
  ok("R2 too", rulesOf(moved) === "R2");
  ok("...and a failing lift, contact or public-name read is no row of his either", todoOf({ ...everything, lifts: { sat: null }, contacts: null, publicName: null, requests: null }).unread === 0);
  const at18 = todoOf({ ...everything, answers: said([SAT, [row("p-rohan", "available")]]),
    consents: [{ kind: "health", playerId: "p-rohan", relation: "self", adult: true, state: "given", moduleOn: true, canSayYes: true, askAt18: true }] });
  ok("eighteen and at school, his parents said yes (the server's ask_at_18): one R8c of his own", rulesOf(at18) === "R8c"
     && at18.rows[0].fact === "Health monitoring: your parents said yes. From your eighteenth birthday it is yours to answer" && at18.rows[0].owner === "you", at18.rows[0]?.fact);
  ok("...and never a parent's consent row read as his", todoOf({ ...everything, answers: said([SAT, [row("p-rohan", "available")]]),
    consents: [{ kind: "health", playerId: "p-rohan", relation: "guardian", state: "not_answered", moduleOn: true, canSayYes: true }] }).clear);
}

group("Two children at two schools: two lists, two counts, nothing summed (D10)");
{
  const KES_SAT = at("2026-10-10T08:00:00", { id: "kes-sat", schoolId: KES });
  const ANIKA_G = { ...ANIKA, schoolName: "Kearsney College", consent: "granted" };
  const shared = { matches: [SAT, KES_SAT], answers: said([SAT, [row("p-rohan", "available")]], [KES_SAT, [row("p-anika", "available")]]), now: NOW,
    lifts: { sat: [offer({ mySeats: [seat("p-rohan", "awaiting_guardian")] })], "kes-sat": [offer({ id: "o-k", schoolId: KES, mySeats: [seat("p-anika", "confirmed")] })] },
    day: {}, requests: [{ offerId: "o-k", matchId: "kes-sat", schoolId: KES, team: "1XI", leg: "out", meetAt: MEET_SAT, requested: 1 }],
    consents: [], publicName: { mine: { state: "given", actor: "you" } },
    contacts: [{ playerId: "p-rohan", active: 1 }, { playerId: "p-anika", active: 0 }] };
  const a = todoOf({ ...shared, child: ROHAN_G }), b = todoOf({ ...shared, child: ANIKA_G });
  ok("Rohan's list: his seat to confirm again, nothing of Anika's (no request on her school's lift, no missing number)", rulesOf(a) === "R3" && a.line === "1 to do", rulesOf(a));
  ok("Anika's list: the request on the lift to her fixture and her missing number, nothing of Rohan's", rulesOf(b) === "R5,R9" && b.line === "2 to do", rulesOf(b));
  ok("each names its own child only, and no total is anywhere ('3 to do')", !JSON.stringify(a).includes("p-anika") && !JSON.stringify(b).includes("p-rohan")
     && ![a.line, b.line].some((l) => /3 to do/.test(l)));
}

group("What you have agreed: the version, the time and the giver, in the server's words");
{
  const rec = recordOf({ child: ROHAN_G, now: NOW, consents: [{ kind: "health", playerId: "p-rohan", relation: "guardian", state: "given", moduleOn: true, byYou: false, fromForm: true, givenOn: "2026-02-01", version: "health-2026-01", adult: false }],
    publicName: { mine: { state: "given", actor: "you", givenOn: "2026-01-14", version: "public-names-2026-10", recordedAt: "2026-01-14T12:02:00Z" } } });
  const by = Object.fromEntries(rec.lines.map((l) => [l.key, l]));
  ok("the terms: agreed, with the time recorded and the version", by.terms.words === "agreed" && by.terms.detail === "12 Jan 2026 12:30 · popia-2026-01", by.terms);
  ok("his name on public pages: on, given by you, at 14:02 on the day, and the wording's version", by.public_name.words === "on" && by.public_name.detail === "given by you · 14 Jan 2026 14:02 · public-names-2026-10", by.public_name);
  ok("health monitoring: on, from the office's form, with its date and version", by.health.words === "on" && by.health.detail === "given by the office, from a signed form · 1 Feb 2026 · health-2026-01", by.health);
  const other = recordOf({ child: ROHAN_G, now: NOW, consents: [], publicName: { mine: { state: "withdrawn", actor: "guardian", endedOn: "2026-03-01", version: "v1", recordedAt: "2026-02-01T08:00:00Z" } } });
  ok("another giver is 'the guardian', never a name", other.lines.find((l) => l.key === "public_name").detail === "turned off by the guardian · 1 Feb 2026 10:00 · v1");
  const off = recordOf({ child: ROHAN_G, now: NOW, consents: [{ kind: "health", playerId: "p-rohan", relation: "guardian", moduleOn: false, state: "not_answered" }], publicName: OFF });
  ok("the module off: 'Health monitoring: not in use at Hilton College', said once; no public-name line where the read is not hers",
     off.lines.map((l) => `${l.label}: ${l.words}`).join("|") === "The school's terms: agreed|Health monitoring: not in use at Hilton College", off.lines);
  ok("a read failing is said as one", recordOf({ child: ROHAN_G, now: NOW, consents: null, publicName: null }).lines.filter((l) => /^Could not read/.test(l.words)).length === 2);
  const ending = recordOf({ child: { ...ROHAN_G, until: "2026-10-30" }, now: NOW, consents: [{ kind: "health", playerId: "p-rohan", relation: "guardian", adult: true, moduleOn: true, state: "given" }] });
  ok("the link ending within thirty days, and an adult's consents his own: two information lines, no row",
     ending.info.join("|") === "Rohan is eighteen: these consents are Rohan's to give. You may still say no.|Your link to Rohan ends on 30 Oct 2026. After that the record is Rohan's own.", ending.info);
}

group("A1's words: never a reason, a number, another child, 'done' or a percentage");
{
  const NAMES = /Pillay|Mkhize|Bekker|Naidoo|Cele|Dlamini|p-sibling|p-other|p-b\d/;
  const states = [
    todoOf(quiet({ answers: said([SAT, side(row("p-rohan", null))]), child: { ...ROHAN_G, consent: "pending" }, contacts: [{ playerId: "p-rohan", active: 0 }],
      consents: [{ kind: "health", playerId: "p-rohan", relation: "guardian", state: "not_answered", moduleOn: true, canSayYes: true }], publicName: { mine: { state: "not_answered" } },
      lifts: { sat: [offer({ mine: true, awaitingDriver: true, mySeats: [seat("p-rohan", "awaiting_guardian"), seat("p-sibling", "requested")] })] },
      requests: [{ offerId: "o-1", matchId: "sat", schoolId: HIL, team: "1XI", leg: "out", meetAt: MEET_SAT, requested: 3 }] })),
    todoOf(quiet({ lifts: { sat: null }, requests: null, consents: null, publicName: null, contacts: null })),
    todoOf(quiet({ now: Date.parse("2026-10-10T14:40:00Z"), matches: [at("2026-10-10T07:00:00", { id: "sat", status: "complete" })], answers: {}, lifts: {},
      day: { sat: [{ as: "family", offerId: "o", leg: "back", driverName: "H Whitfield", seats: [{ seatId: "s", playerId: "p-rohan", name: "R Pillay", mayReceive: true, handedOverAt: "2026-10-10T14:35:00Z" }] }] } })),
  ];
  const say = states.flatMap(words);
  ok(`${say.length} sentences: the cockpit's and the captain's never-words, and no 'done', 'ready' or percentage`,
     say.every((l) => !NEVER_ON_THE_COCKPIT.test(l) && !SAYS.test(l) && !NEVER_ON_THE_TAB.test(l)),
     say.filter((l) => NEVER_ON_THE_COCKPIT.test(l) || SAYS.test(l) || NEVER_ON_THE_TAB.test(l)));
  ok("...no reason, no note, no number to ring, no other boy, and the boy's surname never (the family's own name for him only)",
     !say.some((l) => /illness|\bflu\b|\bcold\b|\breason\b|\bnote\b|Away|\+?\d{3}[ -]?\d{3}[ -]?\d{4}|@/.test(l) || NAMES.test(l)), say.filter((l) => NAMES.test(l)));
  ok("...and no id of anyone but him in anything the module returns", !/p-sibling|p-b\d|p-other/.test(JSON.stringify(states)));
  const rec = recordOf({ child: ROHAN_G, now: NOW, consents: [{ kind: "health", playerId: "p-rohan", relation: "guardian", state: "given", moduleOn: true, givenBy: "guardian" }],
    publicName: { mine: { state: "refused", actor: "office", recordedAt: "2026-01-01T00:00:00Z" } } });
  const recWords = rec.lines.flatMap((l) => [l.label, l.words, l.detail]).filter(Boolean).concat(rec.info);
  ok("the record's words pass the same tests", recWords.every((l) => !NEVER_ON_THE_COCKPIT.test(l) && !SAYS.test(l) && !NAMES.test(l)), recWords);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
