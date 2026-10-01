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
} from "../src/lib/family.js";
import { tenantWords } from "../src/lib/words.js";
import { ChildSwitcher, stateWords } from "../src/views/family/parts.jsx";
import { ScorecardTab } from "../src/views/matchcentre/scorecard.jsx";
import { AnalyticsTab } from "../src/views/matchcentre/tabs.jsx";

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

console.log(`\n${"─".repeat(52)}\nFAMILY APPS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
