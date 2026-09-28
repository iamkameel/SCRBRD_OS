// The public page's side of the redacted log (SCRBRD-083 phase 1):
// apps/web/src/public/publicLog.js. The labels arrive decided by the server;
// this holds that the page puts them where the shared fold and commentary
// look for names, never shows a pseudonym as a name, and folds the same
// figures as the log it was given.
import { deriveMatch, deriveCommentary } from "@scrbrd/scoring";
import { foldable, unnamedToPositions, asPublicMatch } from "../src/public/publicLog.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

// A public log as /api/public/matches/:id/log sends it: pseudonyms, labels.
const A = "a1a1a1a1a1a1", B = "b2b2b2b2b2b2", C = "c3c3c3c3c3c3", X = "d4d4d4d4d4d4", Y = "e5e5e5e5e5e5", F = "f6f6f6f6f6f6";
let seq = 0;
const ev = (o) => ({ innings: 0, seq: ++seq, id: `e${String(seq).padStart(15, "0")}`, clientTs: 1_790_000_000_000 + seq * 1000, ...o });
const events = [
  ev({ kind: "innings_start", battingTeam: "1XI", bowlingTeam: "Kearsney College 1XI", teamKey: "1XI", bowlingTeamKey: "Kearsney College 1XI",
    squad: [{ id: A, label: "D Erasmus", batHand: "L" }, { id: B, label: "Batter" }, { id: C, label: "Batter" }],
    bowlingSquad: [{ id: X, label: "Bowler" }], overs: 5 }),
  ev({ kind: "batters", striker: A, nonStriker: B }),
  ev({ kind: "bowler", bowler: X }),
  ev({ kind: "ball", type: "run", value: 4, striker: A, nonStriker: B, bowler: X }),
  ev({ kind: "ball", type: "W", value: 0, striker: B, nonStriker: A, bowler: X, dismissal: "caught", fielder: F }),
  ev({ kind: "batters", striker: C }),
  ev({ kind: "bowler", bowler: Y }),                                    // a bowler the squads never carried
  ev({ kind: "ball", type: "run", value: 1, striker: C, nonStriker: A, bowler: Y }),
];
const people = { [A]: "D Erasmus" };

const ready = foldable(events, people);
const start = ready[0];
ok("a squad member's label is the name the fold reads", start.squad[0].name === "D Erasmus" && start.squad[1].name === "Batter" && start.squad[0].batHand === "L");
ok("the batting squad keeps its length (the fold's 'all out' reads it)", start.squad.length === 3);
ok("a stray bowler and fielder join the fielding squad under their positions",
   start.bowlingSquad.some((m) => m.id === Y && m.name === "Bowler") && start.bowlingSquad.some((m) => m.id === F && m.name === "Fielder"));
ok("no label field reaches the fold's input", [...start.squad, ...start.bowlingSquad].every((m) => !("label" in m)));
const m = deriveMatch(ready, {});
const inn = m.innings[0];
unnamedToPositions(m.innings, people);
const shown = JSON.stringify({ bat: inn.batsmen.map((b) => [b.name, b.dismissal]), bowl: inn.bowlers.map((b) => b.name), fow: inn.fow });
ok("a catch by an unnamed fielder reads 'c Fielder b Bowler'", inn.batsmen.find((b) => b.status === "out")?.dismissal === "c Fielder b Bowler", shown);
const named = deriveMatch(foldable(events.map((e) => (e.fielder ? { ...e, fielder: A } : e)), people), {}).innings[0];
ok("...and by a named one, 'c D Erasmus b Bowler'", named.batsmen.find((b) => b.status === "out")?.dismissal === "c D Erasmus b Bowler");
ok("the commentary's events keep the fielder's reference, to look him up", foldable(events, people, { forCommentary: true })[4].fielder === F);
ok("no pseudonym is shown as a name anywhere on the scorecard", ![A, B, C, X, Y, F].some((p) => shown.includes(p)), shown);
ok("the named boy is named; the others are positions", inn.batsmen[0].name === "D Erasmus" && inn.batsmen[1].name === "Batter" && inn.bowlers.every((b) => b.name === "Bowler"), shown);
ok("the fold's figures are the log's", inn.runs === 5 && inn.wickets === 1 && inn.balls === 3);

// A log with no innings_start: the fold can only name by id, and the page renames.
const bare = deriveMatch(foldable([ev({ kind: "batters", striker: A, nonStriker: B }), ev({ kind: "bowler", bowler: X }),
  ev({ kind: "ball", type: "run", value: 2, striker: A, bowler: X }), ev({ kind: "ball", type: "run", value: 1, striker: A, bowler: X })], people), {});
unnamedToPositions(bare.innings, people);
ok("with no squads at all, a batter reads his name or 'Batter', never his pseudonym",
   bare.innings[0].batsmen.map((b) => b.name).join() === "D Erasmus,Batter" && bare.innings[0].bowlers[0].name === "Bowler");

// The commentary: a role word for a boy with no name, the name for the named.
const lines = deriveCommentary(foldable(events, people, { forCommentary: true }), { nameOf: (ref) => people[ref] ?? null, teamName: (_k, n) => n }).map((c) => c.text).join(" | ");
ok("the commentary names the named boy", /D Erasmus/.test(lines), lines);
ok("...and says a role for everyone else, never a pseudonym or 'Batter' as a name", ![A, B, C, X, Y, F].some((p) => lines.includes(p)), lines);
ok("...and never 'hurt'", !/hurt/i.test(lines));

// The header, as the Match Centre's components read a fixture.
const h = asPublicMatch({ id: "m", homeLabel: "Hilton College 1XI", homeCode: "HIL", homeTeam: "1XI", awayLabel: "Kearsney College 1XI",
  awayOnPlatform: false, awayTeam: null, status: "live", startsAt: "2026-09-26T08:00:00.000Z", ground: "Gordon Sherwood Oval", overs: 5, format: "T5" });
ok("an off-platform opponent is its typed name, as the signed-in read has it", h.awayTeam === "Kearsney College 1XI" && h.awayLabel === null);
ok("status, ground and start carried", h.status === "live" && h.venue === "Gordon Sherwood Oval" && h.date === "2026-09-26" && h.time === "08:00");
ok("a scheduled fixture is 'upcoming'", asPublicMatch({ id: "m", status: "scheduled" }).status === "upcoming");

console.log(`\nPUBLIC PAGE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
