/**
 * The family and pupil apps' plain parts (redesign step 4, phase A): the
 * helpers that keep a screen about ONE child (lib/family.js), the words per
 * tenant and sport (G15, lib/words.js), the child switcher, and the Match
 * Centre's family mode (G13). No DOM beyond server rendering, no database:
 * what the reads return is the walks' (tools/smoke-browser-read.mjs, the
 * guardian group; tools/smoke-browser-pupil.mjs) and db/99 §49's.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/family.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inningsStart, batters, bowler, ball, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";
import {
  howOutWord, lineFor, fixturesOf, isTheirs, opponentOf, chooseChild, noticesFor, linkEndWords, longDate,
  pendingWords, doorTo, takeDoor,
} from "../src/lib/family.js";
import { todoOf, countWords } from "../src/lib/todo.js";
import { tenantWords } from "../src/lib/words.js";
import { ChildSwitcher, stateWords } from "../src/views/family/parts.jsx";
import { ScorecardTab } from "../src/views/matchcentre/scorecard.jsx";
import { AnalyticsTab } from "../src/views/matchcentre/tabs.jsx";
import {
  captaincyOf, currentSchoolSeason, sheetOf, nextIn, inningsOf, bowlerRows, notYetBowled, bandOfTeam, bandLine, pitchWords,
  bowlingType, matchupTypes, matchupWords, termsOf, overStory, NEVER_ON_THE_TAB,
} from "../src/lib/captain.js";
import { bowlerCapWords } from "../src/scorer/conditionsLine.jsx";
import { bowlingLimit } from "@scrbrd/scoring";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

// Every fixture here takes an explicit date; the clock is passed in.
const NOW = Date.parse("2026-10-03T06:00:00Z");
const HIL = "hil", WES = "wes";
const ROHAN = { id: "p-rohan", name: "R Pillay", team: "1XI", school: HIL };
const ANIKA = { id: "p-anika", name: "D Mkhize", team: "1XI", school: WES };

group("How he was out: a method, never a name (§3.1)");
for (const [line, want] of [["c Bekker b Naidoo", "caught"], ["c & b Naidoo", "caught and bowled"], ["b Naidoo", "bowled"],
  ["lbw b Naidoo", "lbw"], ["st Whitfield b Naidoo", "stumped"], ["run out (Bekker)", "run out"], ["hit wicket b Naidoo", "hit wicket"],
  ["retired hurt", "retired hurt"], ["", "out"], [null, "out"]]) {
  const got = howOutWord(line);
  ok(`"${line}" → "${want}"`, got === want, got);
}
ok("...and no dismissal line's names survive", !/Bekker|Naidoo|Whitfield/.test(
  ["c Bekker b Naidoo", "st Whitfield b Naidoo", "run out (Bekker)"].map(howOutWord).join(" ")));

group("His line in a match, from the fold: his figures and nobody else's name");
{
  const squad = [{ id: "p-rohan", name: "R Pillay" }, { id: "p-two", name: "T Bekker" }, { id: "p-three", name: "S Naidoo" }];
  const opp = [{ id: "o-1", name: "Opp Bowler" }];
  const inn = deriveInnings([
    inningsStart({ battingTeam: "1XI", bowlingTeam: "Opp", squad, bowlingSquad: opp, overs: 2 }),
    batters({ striker: "p-rohan", nonStriker: "p-two" }), bowler({ bowler: "o-1" }),
    ball({ value: 4 }), ball({ value: 1 }), ball({ value: 2 }), ball({ value: 0 }), ball({ value: 6 }),
    ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }),
  ].map((e, i) => ({ ...e, id: `e${i}` })));
  const line = lineFor([inn], "p-two");
  ok("a batter who was out: runs off balls, and how", line === "8 off 4, bowled", line);
  ok("...and it names nobody", !/Pillay|Naidoo|Opp/.test(line ?? ""));
  ok("a player who neither batted nor bowled has no line", lineFor([inn], "p-three") === null);
  ok("no player, no line", lineFor([inn], null) === null);
  const bowled = { batsmen: [], bowlers: [{ id: "p-rohan", name: "R Pillay", runs: 18, balls: 24, wickets: 2 }] };
  ok("a bowler: wickets for runs off overs", lineFor([bowled], "p-rohan") === "2 for 18 off 4");
  const notOut = { batsmen: [{ id: "p-rohan", name: "R Pillay", runs: 63, balls: 58, status: "not_out" }], bowlers: [] };
  ok("not out says so", lineFor([notOut], "p-rohan") === "63 not out (58)", lineFor([notOut], "p-rohan"));
}

group("His side's fixtures, at either end of a shared one");
{
  const M = [
    { id: "m1", schoolId: HIL, homeTeam: "1XI", status: "upcoming", startsAt: "2026-10-04T07:00:00Z", awayTeam: "Michaelhouse" },
    { id: "m2", schoolId: HIL, homeTeam: "U16B", status: "upcoming", startsAt: "2026-10-03T07:00:00Z", awayTeam: "Kearsney" },
    { id: "m3", schoolId: WES, homeTeam: "1XI", status: "upcoming", startsAt: "2026-10-10T07:00:00Z", awaySchoolId: HIL, awayTeamCode: "1XI",
      homeLabel: "Westville Boys' High 1XI", awayLabel: "Hilton College 1XI", awayTeam: "Hilton" },
    { id: "m4", schoolId: HIL, homeTeam: "1XI", status: "complete", startsAt: "2026-09-24T07:00:00Z", awayTeam: "Westville" },
    { id: "m5", schoolId: HIL, homeTeam: "1XI", status: "complete", startsAt: "2026-09-17T07:00:00Z", awayTeam: "Maritzburg" },
    { id: "m6", schoolId: HIL, homeTeam: "1XI", status: "upcoming", startsAt: "2026-09-01T07:00:00Z", awayTeam: "Stale" },
  ];
  const f = fixturesOf(M, ROHAN, NOW);
  ok("upcoming: his side's, soonest first, at home and away", f.upcoming.map((m) => m.id).join() === "m1,m3", f.upcoming.map((m) => m.id));
  ok("...another side of his school's is not his", !isTheirs(M[1], ROHAN));
  ok("...nor a fixture whose day long passed while still marked upcoming", !f.upcoming.some((m) => m.id === "m6"));
  ok("played: latest first — the passed, unclosed one among them", f.played.map((m) => m.id).join() === "m4,m5,m6", f.played.map((m) => m.id));
  ok("the opponent of an away fixture is the home side, named", opponentOf(M[2], ROHAN) === "Westville Boys' High 1XI", opponentOf(M[2], ROHAN));
  ok("the child the app opens on: the one remembered on this device", chooseChild([ROHAN, ANIKA], M, ANIKA.id, NOW) === ANIKA);
  ok("...else the one with the nearest fixture", chooseChild([ANIKA, ROHAN], M, null, NOW) === ROHAN);
  ok("...a remembered child who is no longer linked is not chosen", chooseChild([ANIKA, ROHAN], M, "gone", NOW) === ROHAN);
  ok("...and no children, no child", chooseChild([], M, null, NOW) === null);
}

group("A Home's notices: about this child, or about nobody in particular at his place");
{
  const N = [
    { id: 1, title: "About him", subjectPerson: ROHAN.id, school: HIL, team: "1XI" },
    { id: 2, title: "About another boy", subjectPerson: "p-other", school: HIL, team: "1XI" },
    { id: 3, title: "School-wide", subjectPerson: null, school: HIL, team: null },
    { id: 4, title: "Another side", subjectPerson: null, school: HIL, team: "U16B" },
    { id: 5, title: "Another school", subjectPerson: null, school: WES, team: null },
    { id: 6, title: "The league", subjectPerson: null, school: null, team: null },
  ];
  ok("his, his place's and the league's; never another child's, side's or school's",
     noticesFor(N, ROHAN).map((n) => n.id).join() === "1,3,6", noticesFor(N, ROHAN).map((n) => n.id));
}

group("The guardianship line: the link's own end date, never a birthday (G11, §3.3)");
{
  ok("a dated link says the date", linkEndWords({ name: "R Pillay", until: "2029-03-14" }, tenantWords()) ===
    "Your link to R Pillay on SCRBRD ends on 14 Mar 2029.");
  const open = linkEndWords({ name: "R Pillay", until: null }, tenantWords({ kind: "club" }));
  ok("an open link (db/62) says it stays open while the child is at the place, in the tenant's word", /stays open while R Pillay is at the club/.test(open), open);
  ok("dates are written as a person reads them", longDate("2026-09-01") === "1 Sep 2026" && longDate(null) === null);
}

group("Words per tenant and sport (G15)");
{
  const s = tenantWords({ kind: "school" }), c = tenantWords({ kind: "club" }), a = tenantWords({ kind: "academy", sport: "swimming" });
  ok("a school's pupil", s.place === "school" && s.member === "pupil");
  ok("a club's player", c.place === "club" && c.member === "player" && c.Place === "Club");
  ok("an academy's gala, for swimming", a.place === "academy" && a.match === "gala");
  ok("a parent, unless the link says guardian", tenantWords({ relationship: "parent" }).guardian === "parent"
     && tenantWords({ relationship: "guardian" }).guardian === "guardian" && tenantWords({ relationship: "grandparent" }).guardian === "guardian");
  ok("an unknown kind or sport falls back to plain words, not a blank", tenantWords({ kind: "nope", sport: "nope" }).place === "school"
     && tenantWords({ sport: "nope" }).match === "match");
}

group("The child switcher (§3.1): hidden with one child, one lit chip per child with two");
{
  ok("one child: no switcher", renderToStaticMarkup(h(ChildSwitcher, { kids: [ROHAN], chosen: ROHAN, onChoose: () => {} })) === "");
  const two = renderToStaticMarkup(h(ChildSwitcher, { kids: [ROHAN, ANIKA], chosen: ANIKA, onChoose: () => {} }));
  ok("two children: two chips", (two.match(/data-testid="child-chip-/g) ?? []).length === 2);
  ok("...the chosen one pressed, the other not",
     /data-testid="child-chip-p-anika" aria-pressed="true"/.test(two) && /data-testid="child-chip-p-rohan" aria-pressed="false"/.test(two));
  ok("...a group a screen reader names", /role="group" aria-label="Which child"/.test(two));
}

group("A state is a word, never a colour alone (§3.7)");
for (const s of ["available", "doubtful", "unavailable", "needs_reconfirming", null]) {
  ok(`${s ?? "no answer"} reads as words`, typeof stateWords(s).word === "string" && stateWords(s).word.length > 3);
}

group("The Match Centre in family mode (G13): his rows lit, a wheel offered for him only");
{
  const squad = [{ id: "p-rohan", name: "R Pillay" }, { id: "p-two", name: "T Bekker" }, { id: "p-three", name: "S Naidoo" }];
  const inn = deriveInnings([
    inningsStart({ battingTeam: "1XI", bowlingTeam: "Opp", squad, bowlingSquad: [{ id: "o-1", name: "Opp Bowler" }], overs: 2 }),
    batters({ striker: "p-rohan", nonStriker: "p-two" }), bowler({ bowler: "o-1" }),
    ball({ value: 4 }), ball({ value: 1 }), ball({ value: 2 }), ball({ value: 1 }),
  ].map((e, i) => ({ ...e, id: `e${i}` })));
  const match = { id: "m", homeTeam: "1XI", awayTeam: "Opp" };
  const base = { match, innings: [inn], inningsSel: 0, setInningsSel: () => {}, commentary: [], events: [], overs: 2 };
  const plain = renderToStaticMarkup(h(ScorecardTab, base));
  ok("without family mode no row is lit", !/data-focus="true"/.test(plain) && !/mc-focus-tag/.test(plain));
  const fam = renderToStaticMarkup(h(ScorecardTab, { ...base, focus: new Set(["p-rohan"]), focusLabel: "Your child" }));
  ok("in family mode exactly his batting row is lit", (fam.match(/data-testid="mc-bat-row"[^>]*data-focus="true"/g) ?? []).length === 1);
  ok("...with a word beside his name, not a colour alone", /mc-focus-tag[^>]*>Your child</.test(fam));
  const aPlain = renderToStaticMarkup(h(AnalyticsTab, base));
  const aFam = renderToStaticMarkup(h(AnalyticsTab, { ...base, focus: new Set(["p-rohan"]) }));
  const chips = (html) => [...html.matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]+)</g)].map((m) => m[1]);
  ok("Analytics offers every batter's wheel to a staff reader", ["R Pillay", "T Bekker"].every((n) => chips(aPlain).includes(n)), chips(aPlain));
  ok("...and to a family only the whole innings and his own", chips(aFam).includes("R Pillay") && !chips(aFam).includes("T Bekker")
     && chips(aFam).includes("Whole innings"), chips(aFam));
}

// ── SCRBRD-138 phase A: the captain's view ──────────────
// Names are the seed's illustrative ones; no date is pinned to a clock.

group("The captain's gate (§1.2): five tests, and each refuses on its own");
{
  const ME = { id: "p-rohan", school: HIL, team: "1XI" };
  const H = { playerId: "p-rohan", school: HIL, team: "1XI", kind: "captain", season: "2026", withdrawnAt: null };
  ok("his live captain honour, this season, this side, this school: the view", captaincyOf([H], ME, "2026")?.label === "Captain");
  ok("a vice-captain has the same view, labelled for what he is (D1)", captaincyOf([{ ...H, kind: "vice_captain" }], ME, "2026")?.label === "Vice-captain");
  ok("holding both, the captain's label wins, whichever order the read gives them", captaincyOf([{ ...H, kind: "vice_captain" }, H], ME, "2026")?.label === "Captain" && captaincyOf([H, { ...H, kind: "vice_captain" }], ME, "2026")?.label === "Captain");
  ok("the kind alone: colours are not a captaincy", captaincyOf([{ ...H, kind: "colours" }], ME, "2026") === null);
  ok("...nor half colours, honours, player of the season or an award",
     ["half_colours", "honours", "player_of_season", "award"].every((k) => captaincyOf([{ ...H, kind: k }], ME, "2026") === null));
  ok("live alone: a withdrawn honour is not a captaincy", captaincyOf([{ ...H, withdrawnAt: "2026-09-30T08:00:00Z" }], ME, "2026") === null);
  ok("this season alone: last season's captaincy is last season's", captaincyOf([{ ...H, season: "2025" }], ME, "2026") === null);
  ok("this side alone: an honour does not move sides when he does", captaincyOf([{ ...H, team: "2XI" }], ME, "2026") === null);
  ok("...whichever way the sides differ: he moved down", captaincyOf([H], { ...ME, team: "2XI" }, "2026") === null);
  ok("his school alone", captaincyOf([{ ...H, school: WES }], ME, "2026") === null);
  ok("it must be HIS honour: a team-mate's is not his", captaincyOf([{ ...H, playerId: "p-other" }], ME, "2026") === null);
  ok("a team-mate with no honour at all has no view", captaincyOf([], ME, "2026") === null && captaincyOf(null, ME, "2026") === null);
  ok("no season to ask about, no view (fails closed)", captaincyOf([H], ME, null) === null && captaincyOf([H], ME, undefined) === null);
  ok("no player, no view", captaincyOf([H], null, "2026") === null && captaincyOf([H], { ...ME, team: null }, "2026") === null);
  ok("the season is the school's current one, from the calendar's own flag",
     currentSchoolSeason([{ level: "club", label: "2025/26", current: true }, { level: "school", label: "2025", current: false },
       { level: "school", label: "2026", current: true }]) === "2026" && currentSchoolSeason([]) === null);
}

group("Next in: the sheet's order minus those who have batted (C3)");
{
  const rows = [
    { playerId: "p6", side: "home", battingNo: 6, twelfth: false, name: "J Smith" },
    { playerId: "p2", side: "home", battingNo: 2, twelfth: false, name: "R Pillay" },
    { playerId: "p1", side: "home", battingNo: 1, twelfth: false, name: "D Erasmus" },
    { playerId: "p12", side: "home", battingNo: null, twelfth: true, name: "T Cele" },
    { playerId: "p7", side: "home", battingNo: null, twelfth: false, name: "K Naidoo" },
    { playerId: "p3", side: "home", battingNo: 3, twelfth: false, name: "M Khan" },
    { playerId: "x1", side: "away", battingNo: 1, twelfth: false, name: "Other Side" },
  ];
  const sheet = sheetOf(rows, "home");
  ok("the sheet: his end only, in batting order, the unnumbered then the twelfth last", sheet.map((r) => r.playerId).join() === "p1,p2,p3,p6,p7,p12", sheet.map((r) => r.playerId));
  const out = nextIn(sheet, [{ id: "p1" }, { id: "p2" }]);
  ok("next in is the sheet minus the batted, in the sheet's order", out.map((r) => r.playerId).join() === "p3,p6,p7", out.map((r) => r.playerId));
  ok("...the twelfth man does not bat", !out.some((r) => r.twelfth));
  ok("...nobody has batted: the whole order", nextIn(sheet, []).map((r) => r.playerId).join() === "p1,p2,p3,p6,p7");
  ok("...everybody has: nobody", nextIn(sheet, sheet.map((r) => ({ id: r.playerId }))).length === 0);
  ok("...and the batted list is the fold's: a name not on the sheet changes nothing", nextIn(sheet, [{ id: "zz" }]).length === 5);
  ok("not yet bowled is the sheet minus the bowlers", notYetBowled(sheet, [{ id: "p3" }]).map((r) => r.playerId).join() === "p1,p2,p6,p7");
}

group("Overs left, in the cap's own words (D4): the pad's sentence, or no line");
{
  const doc = { "bowling.max_overs_per_bowler_innings": 4 };
  const info = { conditions: doc, sources: { "bowling.max_overs_per_bowler_innings": { from: "set", status: "confirmed" } } };
  const inn = { bowlers: [
    { id: "b1", name: "K Naidoo", balls: 24, runs: 18, wickets: 2, maidens: 0 },
    { id: "b2", name: "J Smith", balls: 18, runs: 21, wickets: 0, maidens: 0 },
    { id: "b3", name: "T Cele", balls: 12, runs: 12, wickets: 1, maidens: 1 },
    { id: "b4", name: "M Khan", balls: 30, runs: 19, wickets: 0, maidens: 0 },
    { id: "b5", name: "Not Bowled", balls: 0, runs: 0, wickets: 0, maidens: 0 },
  ] };
  const rows = bowlerRows(inn, (balls) => bowlerCapWords(info, balls), true);
  const say = Object.fromEntries(rows.map((r) => [r.id, r.words]));
  ok("at the cap: 'Has bowled his 4 overs'", say.b1 === "Has bowled his 4 overs", say.b1);
  ok("one over short: 'Has 1 over left (4 an innings)'", say.b2 === "Has 1 over left (4 an innings)", say.b2);
  ok("nothing worth saying earlier in his spell: no line", say.b3 === null);
  ok("past the cap: recorded, and said", say.b4 === "5 overs; the conditions allow 4", say.b4);
  ok("...each is the pad's own sentence for the same balls, word for word",
     rows.every((r) => r.words === bowlerCapWords(info, inn.bowlers.find((b) => b.id === r.id).balls)));
  ok("a bowler who has not bowled is not listed", !rows.some((r) => r.id === "b5") && rows.length === 4);
  ok("his figures are overs-maidens-runs-wickets", rows[0].figures === "4-0-18-2" && rows[2].figures === "2-1-12-1", rows.map((r) => r.figures));
  const none = bowlerRows(inn, (balls) => bowlerCapWords({ conditions: {}, sources: null }, balls), true);
  ok("a document with no cap: no line for any bowler", none.every((r) => r.words === null) && none.length === 4);
  ok("no document at all: no line either", bowlerRows(inn, (balls) => bowlerCapWords(null, balls), true).every((r) => r.words === null));
  ok("an innings no longer in play says nothing about overs left", bowlerRows(inn, (balls) => bowlerCapWords(info, balls), false).every((r) => r.words === null));
  const unconf = bowlerRows(inn, (balls) => bowlerCapWords({ conditions: doc, sources: null }, balls), true);
  ok("an unconfirmed figure carries the pad's own tail", unconf[0].words === "Has bowled his 4 overs (platform default, unconfirmed)", unconf[0].words);
  const every = rows.map((r) => `${r.name} ${r.figures} ${r.words ?? ""}`).join(" ");
  ok("...and nothing in them is a reason or a per-boy limit", !NEVER_ON_THE_TAB.test(every) && !/spell/i.test(every), every);
}

group("The band's one line for the side (D4), and the groundsman's words");
{
  ok("U15A is the U15 band; the open sides are open; a code nobody can read has none",
     bandOfTeam("U15A") === "U15" && bandOfTeam("U16B") === "U16" && bandOfTeam("1XI") === "open" && bandOfTeam("2nd XI") === "open"
     && bandOfTeam("U12A") === null && bandOfTeam("Colts") === null && bandOfTeam(null) === null);
  const doc = { "bowling.limit": { U15: { spell: 6, day: 12 } } };
  ok("the competition's document first: 'U15 rule: 6-over spells, 12 a day, for every bowler'",
     bandLine(bowlingLimit(doc, "U15"), { maxSpell: 5, maxDay: 10 }, "U15") === "U15 rule: 6-over spells, 12 a day, for every bowler");
  ok("else the platform's directive for the band", bandLine(null, { maxSpell: 5, maxDay: 10 }, "U15") === "U15 rule: 5-over spells, 10 a day, for every bowler");
  ok("neither names a figure: no line", bandLine(null, { maxSpell: null, maxDay: null }, "open") === null && bandLine(null, null, "U15") === null && bandLine(null, { maxSpell: 5, maxDay: 10 }, null) === null);
  ok("the line is for every bowler: it names no boy and no source", !/[A-Z] [A-Z][a-z]+|physio|guideline/.test(bandLine(null, { maxSpell: 5, maxDay: 10 }, "U15")));
  ok("the pitch, in a line a captain reads on the bus",
     pitchWords({ surface: "firm", grass: "covered", bounce: "even", pace: "quick", favours: "seam", notes: null }) === "firm, good grass cover, even bounce, quick pace, favours seam");
  ok("...nothing reported, nothing said", pitchWords(null) === null && pitchWords({ surface: null, grass: null, bounce: null, pace: null, favours: null }) === null);
}

group("Matchups: bowling types only, and no row the read cannot fill (D8)");
{
  ok("pace and spin from the style a record carries", bowlingType("Right-arm fast-medium") === "pace" && bowlingType("Left-arm orthodox") === "spin"
     && bowlingType("Leg-break googly") === "spin" && bowlingType("S") === "spin" && bowlingType("F") === "pace");
  ok("a style that says nothing names no type, and its row is dropped", bowlingType(null) === null && bowlingType("") === null && bowlingType("Underarm") === null);
  const rows = [
    { bowlingStyle: "Right-arm fast", balls: 12, runs: 15, dismissals: 1 },
    { bowlingStyle: "Right-arm medium", balls: 6, runs: 9, dismissals: 0 },
    { bowlingStyle: "Off-break", balls: 10, runs: 7, dismissals: 2 },
    { bowlingStyle: null, balls: 30, runs: 40, dismissals: 3 },
    { bowlingStyle: "Left-arm orthodox", balls: 0, runs: 0, dismissals: 0 },
  ];
  const t = matchupTypes(rows);
  ok("folded by type: pace 18 balls, spin 10; the unnamed and the empty are not offered",
     t.length === 2 && t[0].type === "pace" && t[0].balls === 18 && t[0].runs === 24 && t[0].out === 1 && t[1].type === "spin" && t[1].balls === 10 && t[1].out === 2, JSON.stringify(t));
  ok("...in words, naming no bowler", matchupWords(t[0]) === "24 off 18 balls, out once" && matchupWords(t[1]) === "7 off 10 balls, out 2 times" && matchupWords({ balls: 1, runs: 0, out: 0 }) === "0 off 1 ball, not out");
  ok("a batter nobody has bowled to has nothing to offer", matchupTypes([]).length === 0 && matchupTypes(undefined).length === 0);
}

group("What the tab never says (§4), and the terms the fold hands over");
{
  for (const w of ["Has 1 over left (4 an innings)", "Has bowled his 4 overs", "5 overs; the conditions allow 4", "K Naidoo 4-0-18-2", "Next in", "D Erasmus 23 off 18, 3 fours; caught"]) {
    ok(`allowed: "${w}"`, !NEVER_ON_THE_TAB.test(w), w);
  }
  for (const w of ["Physio restricted", "shoulder injury", "not fit", "guideline set by the physio", "Unavailable, family", "doubtful", "no reason given", "threat level high", "win probability 62%", "workload 8.0", "rehab", "Back Sat 10 Oct, return date"]) {
    ok(`refused: "${w}"`, NEVER_ON_THE_TAB.test(w), w);
  }
  ok("the terms are the document's play part, its sources and its title; none, none", termsOf({ conditions: { "format.free_hit": true }, conditionsTitle: "U15 League", conditionsVersion: 2 })?.title === "U15 League"
     && termsOf({ conditions: null }) === null && termsOf(null) === null && termsOf({}) === null);
  const items = [
    { innings: 0, over: 0, kind: "over_end", key: "a", text: "End of over 1: 6 runs", ball: 6 },
    { innings: 0, over: 1, kind: "over_end", key: "b", text: "End of over 2: 9 runs", ball: 6 },
    { innings: 0, over: 2, kind: "ball", key: "c", text: "no summary yet", ball: 2 },
    { innings: 1, over: 0, kind: "over_end", key: "d", text: "End of over 1 (chase)", ball: 6 },
  ];
  ok("the over story: finished overs of one innings, newest first, the over in play left out",
     overStory(items, 0).map((o) => o.over).join() === "2,1" && overStory(items, 1).map((o) => o.over).join() === "1");
  ok("...the last N", overStory(items, 0, 1).map((o) => o.over).join() === "2");
}

group("Which innings are his side's: by the side the innings names, else by his own players");
{
  const me = { id: "p-rohan", school: HIL, team: "1XI" };
  const match = { id: "m", schoolId: HIL, homeTeam: "1XI", awayTeam: "Westville", awaySchoolId: WES, awayTeamCode: "1XI", homeLabel: "Hilton College 1XI", awayLabel: "Westville 1XI" };
  const ours = new Set(["p-rohan", "p-two"]);
  const mk = (battingTeam, batIds, bowlIds) => ({ battingTeam, batsmen: batIds.map((id) => ({ id })), bowlers: bowlIds.map((id) => ({ id })) });
  const byName = inningsOf(match, me, [mk("1XI", [], []), mk("Westville 1XI", [], [])], ours);
  ok("by name: the home side batting is his, the other's is his bowling", byName.map((x) => x.side).join() === "batting,bowling");
  const byIds = inningsOf(match, me, [mk("Hilton 1XI", ["p-two"], ["o-1"]), mk("Somebody", ["o-1"], ["p-rohan"])], ours);
  ok("by ids when the name says nothing", byIds.map((x) => x.side).join() === "batting,bowling");
  const none = inningsOf(match, me, [mk("Somebody", ["o-1"], ["o-2"])], ours);
  ok("an innings neither says is neither: nothing 'ours' is drawn from it", none[0].side === null);
  const away = inningsOf({ ...match, schoolId: WES, homeTeam: "1XI", awaySchoolId: HIL, awayTeamCode: "1XI", homeLabel: "Westville 1XI", awayLabel: "Hilton College 1XI" },
    me, [mk("Westville 1XI", [], []), mk("Hilton College 1XI", [], [])], ours);
  ok("at the away end the sides turn over", away.map((x) => x.side).join() === "bowling,batting");
  ok("a super over is no part of it", inningsOf(match, me, [{ ...mk("1XI", [], []), superOver: 1 }], ours)[0].side === null);
}


group("GA-I20 A1: a pending link is said as pending, never as approved, and names no child (§3.3)");
{
  const NOW_P = Date.parse("2026-10-08T10:00:00Z");
  const req = (o = {}) => ({ id: "rq-1", mine: true, state: "pending", role: "guardian", schoolName: "Hilton College", requestedAt: "2026-10-04T08:00:00Z",
    note: "For my son in the U15A", name: "N Mother", playerId: null, ...o });
  const p = pendingWords([req()], NOW_P);
  ok("her own pending request: one sentence, the school's name and how long ago",
     p.length === 1 && p[0].words === "Your request to be linked to a child at Hilton College is with the office · asked 4 days ago. "
       + "This does not mean it was approved. When the office verifies the link, your child appears here.", p[0]?.words);
  ok("...her own note beside it, as she wrote it", p[0].note === "For my son in the U15A");
  ok("asked today, and asked one day ago", pendingWords([req({ requestedAt: "2026-10-08T07:00:00Z" })], NOW_P)[0].words.includes("· asked today.")
     && pendingWords([req({ requestedAt: "2026-10-07T08:00:00Z" })], NOW_P)[0].words.includes("· asked 1 day ago."));
  ok("the sentence names no child and no person, even where the row carries a player or her own name",
     !/N Mother|Pillay|player/i.test(pendingWords([req({ playerId: "aaaaaaaa-0000-0000-0000-000000000005" })], NOW_P)[0].words));
  ok("a request decided, withdrawn or rejected is not pending: nothing said here (the revoked and rejected words are A2's)",
     ["granted", "declined", "withdrawn", "rejected"].every((st) => pendingWords([req({ state: st })], NOW_P).length === 0));
  ok("a request that is not hers (the office's read lists others'), or not for a guardian's link, is not said",
     pendingWords([req({ mine: false }), req({ role: "coach" })], NOW_P).length === 0);
  ok("a read that has not answered says nothing", pendingWords(null, NOW_P).length === 0 && pendingWords(undefined, NOW_P).length === 0);
  ok("the words pass the never-words of the tab (no reason, no 'why')", p.every((x) => !NEVER_ON_THE_TAB.test(x.words)), p.map((x) => x.words));
}

group("GA-I20 A1: a door from the list opens one panel on his card, once, and only his");
{
  doorTo("p-rohan", "ring");
  ok("another child's card takes nothing", takeDoor("p-anika") === null);
  ok("his card takes the panel the door asked for", takeDoor("p-rohan") === "ring");
  ok("...once: a second look takes nothing", takeDoor("p-rohan") === null);
}

group("GA-I20 A1: each child's count on Family is his own; nothing sums them (D1, D10)");
{
  const at = (iso, o) => ({ id: iso, schoolId: HIL, homeTeam: "1XI", awayTeamCode: null, awaySchoolId: null, homeLabel: "Hilton College 1st XI",
    awayLabel: "Kearsney College 1st XI", status: "upcoming", startsAt: `${iso}.000Z`, date: iso.slice(0, 10), time: iso.slice(11, 16), ...o });
  const hil = at("2026-10-07T07:00:00", { id: "hil" }), wes = at("2026-10-07T08:00:00", { id: "wes", schoolId: WES });
  const answers = { hil: [{ playerId: ROHAN.id, status: null }], wes: [{ playerId: ANIKA.id, status: null }] };
  const reads = { matches: [hil, wes], answers, now: NOW, contacts: [{ playerId: ROHAN.id, active: 0 }, { playerId: ANIKA.id, active: 2 }] };
  const a = todoOf({ ...reads, child: ROHAN }), b = todoOf({ ...reads, child: ANIKA });
  ok("R Pillay '2 to do' (his answer and his missing number); D Mkhize '1 to do' (his answer)", countWords(a) === "2 to do" && countWords(b) === "1 to do", [countWords(a), countWords(b)]);
  ok("...and the words of each count are his own: no '3 to do' anywhere", ![countWords(a), countWords(b)].includes("3 to do"));
}

console.log(`\n${"─".repeat(52)}\nFAMILY APPS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
