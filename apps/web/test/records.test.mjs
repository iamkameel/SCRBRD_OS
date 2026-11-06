/**
 * School record boards on a screen (RECOGNITION R9; RECOGNITION_design.md
 * D22–D24, §7): lib/records.js's grouping and words, and the card drawn from
 * rows as the `record_boards` read returns them (asRecordLine()). Who gets
 * which rows is db/99 §121's and tools/smoke-records.mjs's; this proves only
 * what the screen makes of them — in particular that a pupil's rows (no
 * season list) draw no ordered list, and a staff reader's do.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/records.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GROUPS, NO_BOARDS, boardEmptyWords, boardTitle, boardsOf, coverageWords, figureOf, groupsHeld, monthYear, viewOf, whereWords,
} from "../src/lib/records.js";
import { RecordBoardsView } from "../src/views/records.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d); } };

const base = { view: "chronology", school: "s", side: "U15A", metric: "highest_innings", group: "school_records", format: "T20",
  state: null, minBalls: null, since: null, awaiting: null, place: null, equalled: false, playerId: "p", name: "D Erasmus",
  matchId: "m", innings: 0, on: "2026-09-12", opponent: "Kearsney", runs: 87, balls: 15, notOut: true, wickets: null, conceded: null };
const row = (o) => ({ ...base, ...o });
const pupilRows = [
  row({ line: "board", state: "standing", since: "2026-09-01", awaiting: 1, playerId: null, name: null, runs: null }),
  row({ line: "holder", playerId: "e", matchId: "m2" }),
  row({ line: "holder", playerId: "t", matchId: "m3", name: "T Mokoena", runs: 87, notOut: false, on: "2026-09-19", opponent: "DHS", equalled: true }),
  row({ line: "former", playerId: "n", matchId: "m1", name: "K Naidoo", runs: 71, on: "2026-09-01", opponent: "Hilton B" }),
  row({ line: "board", metric: "best_economy", state: "no_minimum", since: "2026-09-12", awaiting: 0 }),
  row({ line: "board", metric: "best_strike_rate", state: "not_enough", minBalls: 200, since: "2026-09-01", awaiting: 0 }),
  row({ line: "board", group: "friendly", state: "standing", since: "2026-09-26", awaiting: 0 }),
  row({ line: "holder", group: "friendly", playerId: "n", matchId: "m4", name: "K Naidoo", runs: 120, on: "2026-09-26", opponent: "Old Boys" }),
];
const staffRows = [
  ...pupilRows.map((r) => ({ ...r, view: "full" })),
  row({ view: "full", line: "season", place: 1, playerId: "t", matchId: "m3", name: "T Mokoena", runs: 87, notOut: false, on: "2026-09-19" }),
  row({ view: "full", line: "season", place: 1, playerId: "e", matchId: "m2" }),
  row({ view: "full", line: "season", place: 3, playerId: "n", matchId: "m1", name: "K Naidoo", runs: 71, on: "2026-09-01" }),
];

// ── lib/records.js ──
ok("School Records is the headline group", GROUPS[0].id === "school_records");
ok("a not-out is said", figureOf(pupilRows[1]) === "87*" && figureOf(pupilRows[2]) === "87");
ok("a spell is wickets/runs", figureOf({ metric: "best_bowling", wickets: 2, conceded: 10 }) === "2/10");
ok("a strike rate carries its figures and rate",
   figureOf({ metric: "best_strike_rate", runs: 87, balls: 15, notOut: true }) === "87* off 15 · strike rate 580.0");
ok("an economy is per over", figureOf({ metric: "best_economy", conceded: 10, balls: 6 }) === "10 off 6 balls · 10.00 an over");
ok("where: opponent and the date", whereWords(pupilRows[1]) === "v Kearsney, 12 Sep 2026");
const sr = boardsOf(pupilRows, "school_records");
ok("one board per metric and format, in order", sr.map((b) => b.metric).join() === "highest_innings,best_strike_rate,best_economy",
   sr.map((b) => b.metric).join());
ok("joint holders both held, the former kept", sr[0].holders.length === 2 && sr[0].formers.length === 1);
ok("the Friendly 120 is never a School Records line", !sr.some((b) => b.holders.some((x) => x.runs === 120)));
ok("...it is the Friendly board's", boardsOf(pupilRows, "friendly")[0].holders[0].runs === 120);
ok("the groups held, headline first", groupsHeld(pupilRows).join() === "school_records,friendly");
ok("the reader's view is the server's", viewOf(pupilRows) === "chronology" && viewOf(staffRows) === "full" && viewOf([]) === null);
ok("a pupil's boards carry no season list", sr.every((b) => b.season.length === 0));
ok("the title names metric, side, format and group", boardTitle(sr[0], "U15A", "school_records") === "Highest innings · U15A · T20 · School Records");
ok("coverage is bounded", coverageWords(sr[0]) === "In verified SCRBRD matches since Sep 2026. Earlier matches are not counted.");
ok("...with the minimum stated", /Minimum 200 balls faced\./.test(coverageWords(sr[1])), coverageWords(sr[1]));
ok("month and year", monthYear("2026-10-03") === "Oct 2026" && monthYear(null) === null);
ok("empty states: a board off", /Off until the school publishes a minimum/.test(boardEmptyWords(sr[2])));
ok("...not enough data, with the minimum", /Not enough eligible data yet: nobody has reached the minimum of 200 balls faced/.test(boardEmptyWords(sr[1])));
ok("...awaiting verification", /Awaiting verification/.test(boardEmptyWords({ state: "awaiting" })));
ok("...and a standing board says none", boardEmptyWords(sr[0]) === null);

// ── the card ──
const pupil = renderToStaticMarkup(h(RecordBoardsView, { rows: pupilRows, side: "U15A", group: "school_records" }));
const text = (m) => m.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
ok("the pupil's card draws the holders and the former holder",
   /Joint holder/.test(pupil) && /T Mokoena/.test(pupil) && /Formerly 71\* K Naidoo v Hilton B, 1 Sep 2026/.test(text(pupil)), text(pupil).slice(0, 400));
ok("...the equalled one says so", /equalled/.test(pupil));
ok("...no ordered list for a pupil", !/data-testid="record-boards-season"/.test(pupil) && !/<ol/.test(pupil) && !/staff only/.test(pupil));
ok("...never a rank word", !/\b(\d+(st|nd|rd|th)|rank(ed)?|place)\b/i.test(pupil.replace(/<[^>]+>/g, " ")));
ok("...the awaiting count is said", /Awaiting verification: 1 match the scorer has not sealed yet/.test(text(pupil)));
ok("...and the filter offers Friendly Records", /record-boards-group-friendly/.test(pupil) && /aria-pressed="true"/.test(pupil));
const staff = renderToStaticMarkup(h(RecordBoardsView, { rows: staffRows, side: "U15A", group: "school_records" }));
ok("staff read this season's list, labelled and ordered", /This season · ordered by highest innings · staff only/.test(staff)
   && (staff.match(/record-boards-season-line/g) ?? []).length === 3, staff.slice(0, 300));
ok("...places shared on a tie", /<li value="1"[^>]*>87 (<!-- -->)?T Mokoena/.test(staff) && /<li value="3"/.test(staff), staff.match(/<li[^>]*>/g)?.join(" "));
ok("...and say nothing counted where a board has no season line", /Nothing counted this season yet/.test(staff));
const none = renderToStaticMarkup(h(RecordBoardsView, { rows: [], side: "U15A", group: "school_records" }));
ok("no boards at all: the spec's first empty state", none.includes(NO_BOARDS));
const friendly = renderToStaticMarkup(h(RecordBoardsView, { rows: pupilRows, side: "U15A", group: "friendly" }));
ok("the Friendly view is labelled", /Highest innings · U15A · T20 · Friendly Records/.test(friendly));

console.log(`\nrecords: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
