/**
 * Recognition R4's words (RECOGNITION_design.md §7, D3, D6): a milestone says
 * where it came from, the family's line is the server's notice in the same
 * words, and a withdrawn honour reads "withdrawn · date" with no reason. Pure
 * functions and one server render of the seal's mark: no DOM, no database
 * (db/99 §118 and tools/smoke-recognition.mjs hold the reads).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/recognition-words.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  dayMonth, dayMonthYear, familyName, familyMilestoneLine, figureOf, honourWords, isFirst, isSealed, isWithdrawn,
  provenanceOf, whatOf, NOT_SEALED, FROM_BOOK,
} from "../src/lib/recognitionWords.js";
import { SealMark } from "../src/ui/sealMark.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const fifty = { family: "milestone", kind: "fifty", value: 63, opponent: "DHS", on: "2026-09-12", sealedOn: "2026-09-12", source: "ball log" };
const live  = { ...fifty, sealedOn: null };
const book  = { ...fifty, kind: "hundred", value: 104, source: "scorebook" };

group("Dates as §7 writes them");
ok("12 Sep", dayMonth("2026-09-12") === "12 Sep", dayMonth("2026-09-12"));
ok("3 Oct 2026", dayMonthYear("2026-10-03") === "3 Oct 2026", dayMonthYear("2026-10-03"));
ok("no date is no words, never 'Invalid'", dayMonth(null) === "" && dayMonthYear("nonsense") === "");

group("What his family calls him");
ok("known as, first", familyName({ knownAs: "Ro", name: "Rohan Pillay" }) === "Ro");
ok("else his first name", familyName({ name: "Rohan Pillay" }) === "Rohan");
ok("an initial is not a name: his name as it stands", familyName({ name: "R Pillay" }) === "R Pillay"
   && familyName({ name: "R. Pillay" }) === "R. Pillay");

group("The family's line (D6, §7)");
{
  const s = familyMilestoneLine(fifty, "Rohan", true);
  ok("sealed: §7's words exactly", s.line === "Rohan's first fifty · 63 v DHS · sealed by the scorer, 12 Sep" && s.sealed && s.note === null, s);
  const n = familyMilestoneLine(live, "Rohan", true);
  ok("not sealed: no seal date, and the words say so", n.line === "Rohan's first fifty · 63 v DHS" && !n.sealed && n.note === NOT_SEALED, n);
  const b = familyMilestoneLine(book, "Rohan", false);
  ok("a scorebook card says so", b.line === "Rohan's hundred · 104 v DHS · sealed by the scorer, 12 Sep" && b.note === FROM_BOOK, b);
  ok("a five-for's figure is its wickets", figureOf({ kind: "five_for", value: 6, opponent: "Kearsney" }) === "6 wickets v Kearsney");
  ok("a hat-trick has no figure", figureOf({ kind: "hat_trick", value: 3, opponent: "DHS" }) === "v DHS");
  ok("a career mark names its threshold", whatOf("career_runs", 500) === "500 career runs" && whatOf("five_for", 5) === "five-for");
  // Newest first, as recognition() orders: the last fifty is the first he made.
  const rows = [{ ...fifty, on: "2026-10-01" }, fifty];
  ok("first: the oldest of its kind", isFirst(rows, rows[1]) && !isFirst(rows, rows[0]));
  ok("a career mark is never 'first'", !isFirst([{ family: "milestone", kind: "career_runs" }], { family: "milestone", kind: "career_runs" }));
}

group("Where it came from, on the pupil's and the staff's screens");
ok("sealed, from the log: nothing to add", provenanceOf(fifty).length === 0 && isSealed(fifty));
ok("not sealed: the words", provenanceOf(live).join() === NOT_SEALED);
ok("a book's: the words", provenanceOf(book).join() === FROM_BOOK);
ok("an honour has no provenance line", provenanceOf({ family: "honour" }).length === 0);

group("A withdrawn honour (D3, D4)");
{
  const w = { family: "honour", label: "Half colours", season: "2026", withdrawnOn: "2026-10-03" };
  ok("the pupil and the deciders: 'withdrawn · date'", honourWords(w) === "Half colours 2026 · withdrawn 3 Oct 2026", honourWords(w));
  ok("his parent: '· the school can say why'", honourWords(w, { family: true }) === "Half colours 2026 · withdrawn 3 Oct 2026 · the school can say why");
  ok("a live one: label and season", honourWords({ family: "honour", label: "Full colours", season: "2025" }) === "Full colours 2025");
  ok("isWithdrawn reads withdrawnOn, on an honour only", isWithdrawn(w) && !isWithdrawn({ ...w, family: "milestone" }) && !isWithdrawn({ ...w, withdrawnOn: null }));
  ok("no word of a reason anywhere", !/reason|because|error/i.test(honourWords(w, { family: true })));
}

group("The seal's mark: a medal once sealed, a dashed star before; hidden, the words say it");
{
  const sealed = renderToStaticMarkup(h(SealMark, { sealed: true, testid: "m" }));
  const open = renderToStaticMarkup(h(SealMark, { sealed: false, testid: "m" }));
  ok("sealed draws the medal, aria-hidden", /data-sealed="true"/.test(sealed) && /aria-hidden="true"/.test(sealed), sealed);
  ok("not sealed draws a dashed outline, aria-hidden", /stroke-dasharray/.test(open) && /aria-hidden="true"/.test(open) && /data-sealed="false"/.test(open), open);
  ok("no animation in either", !/animat/i.test(sealed + open));
}

console.log(`\n${"─".repeat(52)}\nRECOGNITION WORDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
