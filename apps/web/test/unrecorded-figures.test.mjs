/**
 * A figure a paper scorebook did not record stays null on screen (SCRBRD-120
 * D12, db/64): the career adapter passes NULL through, the strike rate is
 * taken over the innings whose balls are recorded, and the screens' helpers
 * say "—", "at least N" and one short note. Never a 0 that was not counted,
 * never a division by a null.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/unrecorded-figures.test.mjs
 */
import { asCareer } from "../src/lib/live.js";
import { atLeast, bookNote, stat } from "../src/lib/format.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d)}` : ""); } };
const group = (t) => console.log("\n" + t);

// A /read/career row as the API returns it, bigints as strings.
const row = (over) => ({
  player_id: "p", full_name: "P", team_code: "1XI", school_id: "s",
  bat_matches: "1", runs: "34", balls_faced: null, fours: null, sixes: null, dismissals: "1",
  bowl_matches: "0", runs_conceded: "0", balls_bowled: "0", wides: "0", no_balls: "0", wickets: "0",
  innings_without_balls: 1, runs_without_balls: 34, innings_without_boundaries: 1, bowling_without_extras: 0,
  book_innings: 1, form: ["34"], ...over,
});

group("A book-only boy with no balls column");
const a = asCareer(row({}));
ok("balls faced, fours and sixes stay null, not 0", a.ballsFaced === null && a.fours === null && a.sixes === null, a);
ok("no strike rate: nothing recorded to divide by", a.sr === null, a.sr);
ok("the runs are still his 34, and his average is over his dismissal", a.runs === 34 && a.avg === 34);
ok("the screens' dash and note", stat(a.ballsFaced) === "—" && atLeast(a.fours, true) === "—"
   && bookNote(a) === "Includes 1 innings from a scorebook; balls not recorded in 1.", bookNote(a));

group("Live innings and a book innings without balls");
// 96 runs of which 25 came in an innings with no balls; 41 balls faced live: the rate is 71 off 41.
const m = asCareer(row({ runs: "96", balls_faced: "41", fours: "5", sixes: "3", bat_matches: "2", dismissals: "2",
                         runs_without_balls: 25, innings_without_balls: 1, book_innings: 1 }));
ok("the strike rate is over the recorded balls: (96 − 25) / 41", m.sr === Math.round((71 * 100 / 41) * 100) / 100, m.sr);
ok("...not runs over balls", m.sr !== Math.round((96 * 100 / 41) * 100) / 100);
ok("boundaries read at least N, since one innings left them out", atLeast(m.fours, m.inningsWithoutBoundaries > 0) === "at least 5"
   && atLeast(m.sixes, m.inningsWithoutBoundaries > 0) === "at least 3");

group("A boy with a book innings that is fully recorded");
const f = asCareer(row({ runs: "12", balls_faced: "15", fours: "1", sixes: "0", innings_without_balls: 0, runs_without_balls: 0,
                         innings_without_boundaries: 0, book_innings: 1 }));
ok("the rate is runs over balls", f.sr === 80 && f.fours === 1 && f.sixes === 0);
ok("a zero that was counted is a 0, not a dash", stat(f.sixes) === "0" && atLeast(f.sixes, false) === "0");
ok("the note without a missing column", bookNote(f) === "Includes 1 innings from a scorebook.", bookNote(f));

group("A boy with live figures only, or none");
const live = asCareer(row({ runs: "50", balls_faced: "40", fours: "4", sixes: "1", innings_without_balls: 0, runs_without_balls: 0,
                            innings_without_boundaries: 0, book_innings: 0 }));
ok("no book: the rate is runs over balls and there is no note", live.sr === 125 && bookNote(live) === null);
const none = asCareer(row({ bat_matches: "0", runs: "0", balls_faced: "0", fours: "0", sixes: "0", dismissals: "0",
                            innings_without_balls: 0, runs_without_balls: 0, innings_without_boundaries: 0, book_innings: 0 }));
ok("a boy who has not batted reads 0 balls (a fact) and no rate", none.ballsFaced === 0 && none.sr === null);

group("A bowler's extras");
const w = asCareer(row({ wides: null, no_balls: null, bowling_without_extras: 1 }));
ok("wides and no-balls stay null", w.wides === null && w.noBalls === null && w.bowlingWithoutExtras === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
