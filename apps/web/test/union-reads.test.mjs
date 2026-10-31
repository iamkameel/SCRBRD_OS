/**
 * Who at a union looked, the family's lines (docs/design/UNION_SELECTOR_FIND.md
 * §3, §7, S4): a selector's list appearances grouped per boy, per reader, per
 * SA day, with a count; an opened passport and a name-only read a line each.
 * The day is Africa/Johannesburg's from the row's own timestamp, so a list at
 * 01:00 SAST (23:00 UTC the day before) is on the SA day, whatever zone the
 * test runs in.
 *
 *   node apps/web/test/union-reads.test.mjs
 */
import { readFileSync } from "node:fs";
import { saDay, saDayWords, unionReadLines, unionReadWords } from "../src/lib/unionReads.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const A = "boy-a", B = "boy-b";
const SEL = { readerName: "Sam Selector", readerRole: "Union Selector", organisation: "KZN Cricket Union" };
const FED = { readerName: "Sam Selector", readerRole: "Union Selector", organisation: "CSA Schools" };
const OTHER = { readerName: "Thandi Other", readerRole: "Union Selector", organisation: "KZN Cricket Union" };
const row = (playerId, readAt, what, who = SEL) => ({ playerId, readAt, what, ...who });

group("The SA day, from the timestamp, never the browser's zone");
ok("01:00 SAST is 23:00 UTC the day before, and lands on the SA day", saDay("2026-10-29T23:00:00Z") === "2026-10-30");
ok("...with the offset written out, the same", saDay("2026-10-30T01:00:00+02:00") === "2026-10-30");
ok("01:59:59 SAST is still the SA day", saDay("2026-10-29T23:59:59Z") === "2026-10-30");
ok("23:59 SAST is the same SA day", saDay("2026-10-30T21:59:00Z") === "2026-10-30");
ok("00:00 SAST is the next", saDay("2026-10-30T22:00:00Z") === "2026-10-31");
ok("in words, the SA day", saDayWords("2026-10-29T23:00:00Z") === "30 Oct 2026", saDayWords("2026-10-29T23:00:00Z"));
ok("no time, no day", saDay(null) === null && saDay("not a time") === null && saDayWords(undefined) === "—");

group("List rows grouped per boy, per reader, per SA day, with a count");
const rows = [
  row(A, "2026-10-30T08:00:00Z", "list"),           // 10:00 SAST, 30 Oct
  row(A, "2026-10-30T07:00:00Z", "list"),           // 09:00 SAST, 30 Oct
  row(A, "2026-10-29T23:00:00Z", "list"),           // 01:00 SAST, 30 Oct: the SA day, not the 29th
  row(A, "2026-10-29T21:00:00Z", "list"),           // 23:00 SAST, 29 Oct
  row(A, "2026-10-30T09:00:00Z", "passport"),       // opened, 11:00 SAST
  row(A, "2026-10-30T09:30:00Z", "name"),
  row(A, "2026-10-30T09:40:00Z", "passport"),       // opened again: its own line
  row(A, "2026-10-30T06:00:00Z", "list", FED),      // the same person, at CSA Schools: his own line
  row(A, "2026-10-30T06:30:00Z", "list", OTHER),    // another reader
  row(B, "2026-10-30T08:00:00Z", "list"),           // another boy, the same list answer
];
const lines = unionReadLines(rows);
const lists = lines.filter((l) => l.kind === "list");
const a30 = lists.find((l) => l.playerId === A && l.day === "2026-10-30" && l.organisation === SEL.organisation && l.readerName === SEL.readerName);
ok("three appearances on 30 Oct (SA) are one line of three, the 01:00 row among them", a30?.count === 3, a30);
ok("the 23:00 SAST row of 29 Oct is its own line, of one", lists.some((l) => l.playerId === A && l.day === "2026-10-29" && l.count === 1));
ok("the same person at CSA Schools is a line of his own", lists.some((l) => l.organisation === "CSA Schools" && l.count === 1));
ok("another reader is a line of his own", lists.some((l) => l.readerName === "Thandi Other" && l.count === 1));
ok("another boy is a line of his own", lists.some((l) => l.playerId === B && l.count === 1));
ok("five list lines in all", lists.length === 5, lists.length);
ok("every list row is counted once", lists.reduce((n, l) => n + l.count, 0) === rows.filter((r) => r.what === "list").length);

group("An opened passport and a name-only read stay a line each");
ok("two opens, two lines", lines.filter((l) => l.kind === "passport").length === 2);
ok("the name-only read, one line", lines.filter((l) => l.kind === "name").length === 1);
ok("ten rows make eight lines", lines.length === 8, lines.length);

group("Newest first; a group sits where its newest row falls");
ok("the newest open is first", lines[0].kind === "passport" && lines[0].readAt === "2026-10-30T09:40:00Z");
ok("the times run newest first", lines.every((l, i) => i === 0 || Date.parse(lines[i - 1].readAt) >= Date.parse(l.readAt)));
ok("the 30 Oct group carries its newest time", a30?.readAt === "2026-10-30T08:00:00Z");
ok("the order the server sent does not matter", JSON.stringify(unionReadLines([...rows].reverse())) === JSON.stringify(lines));
ok("nothing, nothing", unionReadLines([]).length === 0 && unionReadLines().length === 0);

group("The words (§3)");
ok("a list line: in his list, the role, the institution, how often, the SA day",
   unionReadWords(a30) === "appeared in Sam Selector's list (Union Selector), KZN Cricket Union · 3 times on 30 Oct 2026", unionReadWords(a30));
ok("once and twice in words",
   /· once on 29 Oct 2026$/.test(unionReadWords(lists.find((l) => l.day === "2026-10-29")))
   && /· twice on/.test(unionReadWords({ ...a30, count: 2 })));
ok("an open: who, the role, the institution, on the SA day",
   unionReadWords(lines[0]) === "Sam Selector (Union Selector), KZN Cricket Union · opened his passport on 30 Oct 2026", unionReadWords(lines[0]));
ok("a name-only read says so",
   unionReadWords(lines.find((l) => l.kind === "name")) === "Sam Selector (Union Selector), KZN Cricket Union · his name only, on 30 Oct 2026");
ok("an open at 01:00 SAST is on the SA day too", /on 30 Oct 2026$/.test(unionReadWords(unionReadLines([row(A, "2026-10-29T23:00:00Z", "passport")])[0])));

group("The screen draws these lines, for the family and the boy alike");
const src = readFileSync(new URL("../src/views/SettingsView.jsx", import.meta.url), "utf8");
ok("the Passport block draws unionReadLines in unionReadWords", /unionReadLines\(unionReads\)/.test(src) && /unionReadWords\(l\)/.test(src));
ok("...under 'Who at a union looked', for a family reader", /forFamily && \(/.test(src) && /Who at a union looked/.test(src));
ok("no \"closes by 02:00\" line (Q3 yes)", !/closes by 02:00/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
