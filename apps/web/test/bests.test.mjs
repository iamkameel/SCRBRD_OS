/**
 * Personal bests on a screen (RECOGNITION R5; RECOGNITION_design.md D22–D24,
 * §7): lib/bests.js's grouping and words, and the card drawn from rows as
 * the `personal_bests` read returns them (asPersonalBest()). What the read
 * returns is db/99 §119's and tools/smoke-bests.mjs's; this proves only
 * what the screen makes of it.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/bests.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GROUPS, figureOf, bestLines, whereWords, awaitingCount, groupsHeld, headline, coverageSince, emptyState,
} from "../src/lib/bests.js";
import { PersonalBestsView } from "../src/views/family/bests.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d); } };

const row = (o) => ({ metric: "batting", group: "school_records", format: "T20", side: "1XI", matchId: "m", innings: 0,
  on: "2026-09-12", opponent: "DHS", runs: 63, balls: 40, notOut: false, wickets: null, conceded: null,
  verified: true, best: true, ...o });
const rows = [
  row({ matchId: "a", runs: 63, notOut: true }),
  row({ matchId: "b", runs: 63, on: "2026-10-30", opponent: "Kearsney" }),
  row({ matchId: "c", metric: "bowling", runs: null, wickets: 3, conceded: 18, opponent: "Kearsney", on: "2026-10-01" }),
  row({ matchId: "d", group: "friendly", runs: 71, opponent: "Old Boys", on: "2026-10-20" }),
  row({ matchId: "e", runs: 90, verified: false, best: false, on: "2026-11-03", opponent: "Maritzburg College" }),
];

// ── lib/bests.js ──
ok("School Records is the headline group", GROUPS[0].id === "school_records" && GROUPS[0].label === "School Records");
ok("a not-out is said", figureOf(rows[0]) === "63*" && figureOf(rows[1]) === "63");
ok("a spell is wickets/runs", figureOf(rows[2]) === "3/18");
const sr = bestLines(rows, "school_records");
ok("one line per metric, format and side, batting first",
   sr.map((l) => l.metric).join() === "batting,bowling", JSON.stringify(sr));
ok("a tie keeps both dates, oldest first", sr[0].at.length === 2 && sr[0].at[0].on === "2026-09-12" && sr[0].at[1].on === "2026-10-30");
ok("...and says both", whereWords(sr[0].at) === "v DHS, 12 Sep 2026 and v Kearsney, 30 Oct 2026", whereWords(sr[0].at));
ok("the friendly's 71 is never a School Records line", !sr.some((l) => l.figure.startsWith("71")));
ok("...it is the Friendly group's", bestLines(rows, "friendly").map((l) => l.figure).join() === "71");
ok("an unsealed innings is no best anywhere", ![...sr, ...bestLines(rows, "friendly")].some((l) => l.figure.startsWith("90")));
ok("...and is counted as awaiting", awaitingCount(rows) === 1);
ok("the groups held, in order", groupsHeld(rows).join() === "school_records,friendly");
ok("the headline is the passport's words (§7)", headline(rows, "school_records", "Your") === "Your best: 63* v DHS · School Records",
   headline(rows, "school_records", "Your"));
ok("...and the parent's", headline(rows, "school_records", "Rohan's") === "Rohan's best: 63* v DHS · School Records");
ok("coverage from his first verified best", coverageSince(rows) === "Sep 2026");
ok("the spec's empty states: none", emptyState([], "school_records") === "none");
ok("...awaiting", emptyState([rows[4]], "school_records") === "awaiting");
ok("...not enough eligible data", emptyState([rows[3]], "school_records") === "not_enough");
ok("...and none when the group holds a best", emptyState(rows, "school_records") === null);
// Rows never rank him against anybody: no word of order.
const all = JSON.stringify([sr, headline(rows, "school_records", "Your")]);
ok("no rank, no ordinal", !/\b(\d+(st|nd|rd|th)|rank|place)\b/i.test(all));

// ── The card ──
const card = (rs, group = "school_records") => renderToStaticMarkup(h(PersonalBestsView,
  { rows: rs, read: null, group, onGroup: () => {}, who: "Your", testid: "t" }));
{
  const html = card(rows);
  ok("the card draws the headline", html.includes("Your best: 63* v DHS · School Records"));
  ok("...the two lines", (html.match(/data-testid="t-line"/g) ?? []).length === 2);
  ok("...a tie's word, not a colour", html.includes("equalled"));
  ok("...the filter, as buttons that say which is chosen", html.includes('data-testid="t-filter"')
     && /aria-pressed="true"[^>]*>.*School Records/.test(html));
  ok("...the awaiting line", html.includes("Awaiting verification: 1 match the scorer has not sealed yet."));
  ok("...the coverage label", html.includes("School Records · in verified SCRBRD matches since Sep 2026."));
  ok("...and no name but his own words", !html.includes("Maritzburg"));
}
{
  const html = card(rows, "friendly");
  ok("the Friendly filter draws the friendly's best only", html.includes("Your best: 71 v Old Boys · Friendly") && !html.includes("63"));
}
ok("no filter when only the headline group holds a best", !card(rows.filter((r) => r.group !== "friendly")).includes("t-filter"));
ok("an empty card says the spec's words", card([]).includes("No personal bests yet."));
ok("...awaiting alone", card([rows[4]]).includes("Awaiting verification: the scorer has not sealed these matches yet."));
{
  // The floors: nothing read under 12px, every control 44 tall.
  const html = card(rows);
  const sizes = [...html.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  ok("nothing under 12px", sizes.length > 0 && sizes.every((s) => s >= 12), sizes.join());
  ok("every button 44 tall", (html.match(/<button/g) ?? []).length === (html.match(/min-height:\s*44px/g) ?? []).length);
}

console.log(`\n${fail === 0 ? "✓" : "✗"} bests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
