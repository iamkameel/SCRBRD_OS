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
import { CLOCK_HOURS, WINDOW_DAYS, firstNameOf, fixturesToRead, ruleOf, todoOf } from "../src/lib/todo.js";

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
  ok("the only playerId it reads is the narrowing to the one child (D11)", (code.match(/\bplayerId\b/g) ?? []).length === 1 && /r\.playerId === child\.id/.test(code), code.match(/\bplayerId\b/g));
  ok("...and no card draws a name or an id of anyone but the child it was handed", !/\.playerId|full_name|\.name\b/.test(card.replace(/child\.name/g, "")), card.match(/\.playerId|full_name/)?.[0]);
  ok("the module fetches nothing and writes nothing, and reads no clock", !/\bapi\(|fetch\(|localStorage|sessionStorage|Date\.now|new Date\(\)|XMLHttpRequest/i.test(code));
  ok("it imports no screen and no react", !/from "\.\.\/(views|ui)\//.test(code) && !/from "react"/.test(code));
  ok("the card makes no write and no read of its own: no POST, no new resource", !/\bapi\(|method:\s*"POST"|useLive\(/.test(card) && /readLive\("availability"/.test(card));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
