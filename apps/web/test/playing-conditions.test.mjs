/**
 * The playing-conditions screen's words (SCRBRD-114 §7, §8; lib/playingConditions.js):
 * a figure's value and unit, where it came from, "N of M figures confirmed",
 * where a version stands, what she types turned into what the API takes, and a
 * refusal in plain words. The screen itself is walked in a browser
 * (tools/smoke-browser-playing-conditions-screen.mjs); the rules are the
 * database's and are not repeated here.
 *
 *   node apps/web/test/playing-conditions.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  KEY_WORDS, bandDefault, sourceWords, confirmedCount, dayOf, draftOf, figureSlots, formatDay, oversCell, platformDefaultWords,
  refusalWords, standing, valueOfDraft, valueWords,
} from "../src/lib/playingConditions.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

// The catalogue as the API sends it (a slice of it: one of each type, a band key, a reserved key).
const K = (key, type, extra = {}) => ({ key, part: "play", type, unit: null, values: null, byAgeBand: false, platformDefault: null, readers: ["pad"], reserved: false, clauseCode: null, ...extra });
const CAT = { ageBands: ["U13", "U14", "U15", "U16", "open"], keys: [
  K("format.kind", "enum", { values: ["limited", "declaration", "timed"] }),
  K("format.overs_per_innings", "int", { unit: "overs" }),
  K("format.free_hit", "bool"),
  K("bowling.max_overs_per_bowler_innings", "int", { unit: "overs" }),
  K("bowling.limit", "object", { unit: "overs", byAgeBand: true, platformDefault: { U13: { spell: 5, day: 10 }, U15: { spell: 6, day: 12 }, open: { spell: null, day: null } } }),
  K("table.order", "list", { part: "table", values: ["points", "wins", "nrr"], platformDefault: ["points", "wins", "nrr"] }),
  K("eligibility.age_on", "date", { part: "sheet" }),
  K("pitch.length_m", "int", { unit: "m", reserved: true, readers: [] }),
] };
const E = (key) => CAT.keys.find((k) => k.key === key);

group("A date, as the server sends it");
ok("a plain day is itself", dayOf("2026-10-01") === "2026-10-01");
ok("a timestamp is not a day: the API sends plain days, so nothing is guessed from one", dayOf("2026-10-30T00:00:00.000Z") === "" && dayOf(new Date()) === "");
ok("nothing is nothing", dayOf(null) === "" && formatDay("") === "");
ok("a day in words", /15.*Sep.*2026/.test(formatDay("2026-09-15")), formatDay("2026-09-15"));

group("A value, with its unit");
ok("an int with overs", valueWords(E("format.overs_per_innings"), 25) === "25 overs" && valueWords(E("format.overs_per_innings"), 1) === "1 over");
ok("a bool is yes or no", valueWords(E("format.free_hit"), false) === "No" && valueWords(E("format.free_hit"), true) === "Yes");
ok("an enum in words", valueWords(E("format.kind"), "limited") === "Limited overs");
ok("a list in its order", valueWords(E("table.order"), ["points", "nrr"]) === "Points, then Net run rate");
ok("null for a cap is 'No cap'", valueWords(E("bowling.max_overs_per_bowler_innings"), null) === "No cap");
ok("a bowling limit says spell and day", valueWords(E("bowling.limit"), { spell: 6, day: 12 }) === "6 overs a spell, 12 overs a day");
ok("...and no limit for null", valueWords(E("bowling.limit"), { spell: null, day: null }) === "no limit a spell, no limit a day" && oversCell(null) === "no limit");

group("Where a figure comes from");
ok("a citation: document, clause, date", sourceWords({ sourceDocument: "KZNCU Schools Bye-laws", sourceClause: "7.3", sourceDate: "2026-09-15" }) === `KZNCU Schools Bye-laws, clause 7.3, ${formatDay("2026-09-15")}`);
ok("the platform's default for a band is the one the catalogue carries", bandDefault(E("bowling.limit"), "U15").spell === 6 && bandDefault(E("bowling.limit"), "U15").day === 12 && bandDefault(E("bowling.limit"), "open").spell === null);
ok("...a band the catalogue does not name has no limit, not a guess; it is worded", bandDefault(E("bowling.limit"), "U99").spell === null && platformDefaultWords(E("bowling.limit"), "U13") === "5 overs a spell, 10 overs a day");
ok("a default the catalogue carries is worded", platformDefaultWords(E("table.order")) === "Points, then Wins, then Net run rate");
ok("a default it does not carry is described", platformDefaultWords(E("bowling.max_overs_per_bowler_innings")) === "no cap");
ok("every applied key has words for today", CAT.keys.filter((k) => !k.reserved).every((k) => KEY_WORDS[k.key]?.label && (KEY_WORDS[k.key].byDefault || k.platformDefault != null)));

group("N of M figures confirmed");
{
  const slots = figureSlots(CAT);
  ok("a figure a key, and one a band for a key given by band; reserved keys are not counted", slots.length === 7 - 1 + 5 && !slots.some((s) => s.key === "pitch.length_m"), slots.length);
  const v = (key, status, ageBand = null) => ({ key, ageBand, status });
  ok("nothing entered: none confirmed", confirmedCount(CAT, []).confirmed === 0 && confirmedCount(CAT, []).total === 11);
  const c = confirmedCount(CAT, [v("format.kind", "confirmed"), v("format.free_hit", "unconfirmed"), v("bowling.limit", "confirmed", "U15"), v("pitch.length_m", "confirmed")]);
  ok("confirmed ones counted, unconfirmed and reserved ones not", c.confirmed === 2 && c.total === 11, JSON.stringify(c));
}

group("Where a version stands");
{
  const s = (id, status, effectiveFrom, version) => ({ id, status, effectiveFrom, version });
  const sets = [s("d", "draft", "2026-11-01", 4), s("f", "published", "2026-10-20", 3), s("c", "published", "2026-09-01", 2), s("o", "published", "2026-03-01", 1), s("w", "withdrawn", "2026-10-25", 5)];
  const st = (id) => standing(sets.find((x) => x.id === id), sets, "c");
  ok("a draft is a draft, whatever its date", st("d") === "draft");
  ok("the one the API names is in force", st("c") === "in_force");
  ok("a later published day is not yet in force", st("f") === "scheduled");
  ok("an earlier one has been replaced", st("o") === "superseded");
  ok("withdrawn stays withdrawn", st("w") === "withdrawn");
  ok("with none in force, every published version is still to come", standing(sets[1], sets, null) === "scheduled");
}

group("What she types, as the API takes it");
{
  const draft = (key, over = {}) => ({ ...draftOf(E(key), undefined), ...over });
  ok("a whole number", JSON.stringify(valueOfDraft(E("format.overs_per_innings"), draft("format.overs_per_innings", { text: "25" }))) === '{"value":25}');
  ok("a blank number is a problem in words, not a request", "problem" in valueOfDraft(E("format.overs_per_innings"), draft("format.overs_per_innings", { text: "" })));
  ok("2.5 is not a whole number", "problem" in valueOfDraft(E("format.overs_per_innings"), draft("format.overs_per_innings", { text: "2.5" })));
  ok("'no cap' sends null", valueOfDraft(E("bowling.max_overs_per_bowler_innings"), draft("bowling.max_overs_per_bowler_innings", { none: true })).value === null);
  ok("a toggle is a boolean", valueOfDraft(E("format.free_hit"), draft("format.free_hit", { bool: false })).value === false);
  ok("an enum must be chosen", "problem" in valueOfDraft(E("format.kind"), draft("format.kind")) && valueOfDraft(E("format.kind"), draft("format.kind", { text: "timed" })).value === "timed");
  ok("a band's spell and day, blank for no limit", JSON.stringify(valueOfDraft(E("bowling.limit"), draft("bowling.limit", { spell: "6", day: "" }))) === '{"value":{"spell":6,"day":null}}');
  ok("a list in the order picked", JSON.stringify(valueOfDraft(E("table.order"), draft("table.order", { picked: ["nrr", "points"] })).value) === '["nrr","points"]');
  const back = draftOf(E("bowling.limit"), { value: { spell: 7, day: null }, status: "confirmed", sourceDocument: "Doc", sourceClause: "1", sourceDate: "2026-09-15" });
  ok("an entered figure comes back into the editor as it was", back.spell === "7" && back.day === "" && back.status === "confirmed" && back.document === "Doc" && back.date === "2026-09-15");
}

group("A refusal, in words");
{
  const e = (code, status = 422, detail) => ({ code, status, detail });
  const words = (c, d) => refusalWords(e(c, 422, d), CAT);
  ok("citation_required says what to fill in", /document, the clause and the date/.test(words("citation_required")));
  ok("effective_from_not_future says tomorrow", /tomorrow or later/.test(words("effective_from_not_future")));
  ok("note_required says ten characters", /10 characters/.test(words("note_required")));
  ok("in_force points to a new version", /new version/.test(words("in_force")));
  ok("published_is_immutable points to a new version", /new version/.test(words("published_is_immutable")));
  ok("not_permitted is plain and says nothing of whether it exists", refusalWords(e("not_permitted", 403), CAT) === "You cannot change this competition's playing conditions.");
  ok("a value the database refused names the figure as the screen does, not by its key",
     words("value_invalid", "format.overs_per_innings is at least 1") === "Overs an innings is at least 1.", words("value_invalid", "format.overs_per_innings is at least 1"));
  ok("a title's own words", words("title_invalid", "a title of 3 to 120 characters") === "Give it a title of 3 to 120 characters.");
  ok("a code nobody worded is still said, with its code", /some_new_reason/.test(words("some_new_reason")));
  ok("no answer at all is not 'refused'", /Could not reach the server/.test(refusalWords(new Error("offline"), CAT)));
}

group("The screen");
{
  const src = readFileSync(new URL("../src/views/playingconditions.jsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("it never asks with window.confirm", !/window\.confirm|\bconfirm\(/.test(src));
  ok("it sets no type under 12px", ![...src.matchAll(/fontSize:\s*"(\d+(?:\.\d+)?)px"/g)].some((m) => Number(m[1]) < 12));
}

console.log("\n" + "─".repeat(52));
console.log(`PLAYING CONDITIONS SCREEN (words): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
