// The big screen at the ground (docs/design/PUBLIC_BY_TERMS.md §2.5, slice
// 1; Kameel, 12 Nov 2026, (b)): when a side's squad carries a boy under a
// never-public mark, the WHOLE SIDE is shown by position, and the other side
// by name. apps/web/src/display/groundNames.js over a log built with
// @scrbrd/scoring's own constructors, folded and told as the Match Centre's
// big screen does it (views/matchcentre/bigscreen.jsx). Catches are written
// in the pad's shape: `fielder` the scorecard's name text, `fielders` the
// references. db/99 §130 proves the server's per-side answer;
// smoke-browser-matchcentre walks it on a real big screen. Everyone here is
// invented.
import { deriveMatch, inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { GROUND_POSITION, answeredThrough, byPosition, forGround, groundInnings, groundNameOf, namedOnGround } from "../src/display/groundNames.js";
import { nameBook } from "../src/lib/matchCentre.js";
import { displayState, fallOfWicket, bowlingPanel, partnershipPanel } from "../src/display/data.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

const id = (/** @type {string} */ s, /** @type {number} */ n) => `${s}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const squad = (/** @type {string} */ s, /** @type {string} */ who, n = 6) =>
  Array.from({ length: n }, (_, i) => ({ id: id(s, i + 1), name: `${who} Invented${i + 1}` }));
const H = squad("a", "Home"), K = squad("b", "Away");
const HOME = "U15A", AWAY = "Visitors U15A";
const LATE = { id: id("c", 1), name: "Late Invented" };   // carried only by a later innings_start
let seq = 0;
const at = (/** @type {number} */ inn) => (/** @type {any} */ ev) => ({ ...ev, innings: inn, id: `ev${++seq}`, clientTs: Date.parse("2026-11-12T08:00:00Z") + seq * 30_000 });
const A = at(0), B = at(1);
/** A catch as the pad writes it: the name the scorecard prints, and the reference. */
const caught = (/** @type {{id: string, name: string}} */ by, text = by.name) =>
  ({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: text, fielders: [by.id] });
const LOG = [
  A(inningsStart({ battingTeam: HOME, bowlingTeam: AWAY, teamKey: HOME, bowlingTeamKey: AWAY, squad: H, bowlingSquad: K, overs: 5 })),
  A(batters({ striker: H[0].id, nonStriker: H[1].id })),
  A(bowler({ bowler: K[0].id })),
  A(ball({ value: 4 })), A(ball({ value: 1 })), A(ball({ value: 1 })), A(ball({ value: 0 })),
  // H[0] caught by K[1], in the pad's shape.
  A(ball(caught(K[1]))),
  A(batters({ striker: H[2].id })),
  A(ball({ value: 2 })),
  A(bowler({ bowler: K[2].id })),
  // H[1] caught by K[3], the scorer typing a shorter name for him than his squad's.
  A(ball(caught(K[3], " Awayfour"))),
  A(batters({ striker: H[3].id })),
  A(ball({ value: 6 })),
  // The innings break: the sides change ends, and a boy only this innings_start carries bats.
  B(inningsStart({ battingTeam: AWAY, bowlingTeam: HOME, teamKey: AWAY, bowlingTeamKey: HOME, squad: [...K, LATE], bowlingSquad: H, overs: 5 })),
  B(batters({ striker: K[0].id, nonStriker: LATE.id })),
  B(bowler({ bowler: H[4].id })),
  B(ball({ value: 1 })),
  B(ball(caught(H[5]))),
];
const PLAYERS = [...H, ...K, LATE];
/** The server's answer (db/153). */
const answer = (/** @type {Record<string, boolean>} */ flags, logSeq = 99) =>
  ({ rows: Object.entries(flags).map(([team, position_only]) => ({ team, position_only, log_seq: logSeq })) });
const AWAY_MARKED = answer({ [HOME]: false, [AWAY]: true });

/** The big screen's fold and commentary, as bigscreen.jsx makes them. */
function screen(/** @type {any} */ ans) {
  const named = namedOnGround(ans, LOG);
  const { events, spoken, hidden } = forGround(LOG, named);
  const folded = deriveMatch(events, {});
  groundInnings(folded.innings, named, hidden);
  const played = folded.innings.filter(Boolean);
  const nameOf = groundNameOf(nameBook(played, PLAYERS), named, hidden);
  const commentary = deriveCommentary(spoken, { nameOf, teamName: (_k, n) => n });
  return { named, hidden, events, inn: played[0], inn2: played[1], played, commentary };
}
const everyText = (/** @type {any} */ s) => JSON.stringify({ inn: s.played, c: s.commentary.map((c) => c.text) });
const AWAY_WORDS = [...K.map((p) => p.name), "Awayfour"];

console.log("A. The server's answer, per side");
{
  ok("no answer names nobody with a row", namedOnGround(null, LOG).size === 0 && namedOnGround(undefined, LOG).size === 0);
  const n = namedOnGround(AWAY_MARKED, LOG);
  ok("a side answered position-only names none of the boys its first squad carries", K.every((p) => !n.has(p.id)));
  ok("...and every boy of the other side's squad is named, whether or not he has played yet", H.every((p) => n.has(p.id)));
  ok("a boy only a later innings_start carries is never named, his side answered or not",
     !n.has(LATE.id) && !namedOnGround(answer({ [HOME]: false, [AWAY]: false }), LOG).has(LATE.id));
  ok("a side the answer does not mention names nobody it carries", [...namedOnGround(answer({ [HOME]: false }), LOG)].every((x) => H.some((p) => p.id === x))
     && namedOnGround(answer({ [AWAY]: false }), LOG).size === K.length);
  ok("a side answered twice, once position-only, is position-only",
     namedOnGround({ rows: [{ team: AWAY, position_only: false }, { team: AWAY, position_only: true }, { team: HOME, position_only: false }] }, LOG).size === H.length);
  ok("an answer that is not a clear false names nobody",
     namedOnGround({ rows: [{ team: HOME, position_only: null }, { team: AWAY }] }, LOG).size === 0);
  ok("a row with no side names nobody and unnames nobody", namedOnGround({ rows: [{ team: null, position_only: true }, ...answer({ [HOME]: false }).rows] }, LOG).size === H.length);
  ok("the answer's log_seq is what it covered", answeredThrough(answer({}, 7)) === null && answeredThrough(AWAY_MARKED) === 99
     && answeredThrough({ rows: [{ team: HOME, position_only: false, log_seq: "12" }] }) === 12 && answeredThrough(null) === null);
  ok("a name the scorer typed (no row) is not a position: nothing marks him", !byPosition(new Set(), "Typed Name"));
}

console.log("\nB. The marked boy's whole side by position, the other side by name");
{
  const s = screen(AWAY_MARKED);
  const leaked = AWAY_WORDS.filter((m) => everyText(s).toLowerCase().includes(m.toLowerCase()));
  ok("no name of the marked side, nor the shorter name a scorer typed for one, is anywhere on the screen", leaked.length === 0, leaked.join(", "));
  ok("every bowler of the first innings is 'Bowler'", s.inn.bowlers.length === 2 && s.inn.bowlers.every((b) => b.name === GROUND_POSITION.bowler),
     s.inn.bowlers.map((b) => b.name).join(","));
  const opener = s.inn.batsmen.find((b) => b.id === H[0].id);
  ok("the home opener keeps his name", opener?.name === H[0].name, opener?.name);
  ok("...caught in the pad's shape by a boy of the marked side: 'c Fielder b Bowler'", opener?.dismissal === "c Fielder b Bowler", opener?.dismissal);
  const second = s.inn.batsmen.find((b) => b.id === H[1].id);
  ok("a catch whose name text matches nobody, but whose reference is the marked side's, is 'c Fielder'",
     second?.dismissal === "c Fielder b Bowler", second?.dismissal);
  ok("every home batter on the card is named", s.inn.batsmen.every((b) => b.name === H.find((h) => h.id === b.id)?.name),
     s.inn.batsmen.map((b) => b.name).join(","));
  ok("the fall of wickets names the home batters", s.inn.fow[0]?.batsman === H[0].name, JSON.stringify(s.inn.fow));
  const st = displayState({ match: { id: "m", homeTeam: HOME, awayTeam: AWAY, status: "live", overs: 5 }, innings: [s.inn] });
  const panels = JSON.stringify({ fow: fallOfWicket(st.inn), bowl: bowlingPanel(st.inn), part: partnershipPanel(st.inn) });
  ok("the display's panels (the fall, the bowling, the partnership) carry no away name",
     AWAY_WORDS.every((m) => !panels.toLowerCase().includes(m.toLowerCase())), panels.slice(0, 240));
  ok("the commentary names home boys and says the bowler's role",
     s.commentary.some((c) => c.text.includes(H[1].name)) && s.commentary.some((c) => /the bowler|a fielder/i.test(c.text)),
     s.commentary.map((c) => c.text).join(" | ").slice(0, 400));
  ok("after the break the sides keep their own: the away batters are 'Batter', the home bowler named",
     s.inn2.batsmen.every((b) => b.name === GROUND_POSITION.batter) && s.inn2.bowlers.every((b) => b.name === H[4].name),
     JSON.stringify({ bat: s.inn2.batsmen.map((b) => b.name), bowl: s.inn2.bowlers.map((b) => b.name) }));
  ok("...and a home boy's catch keeps his name", s.inn2.batsmen.some((b) => b.dismissal === `c ${H[5].name} b ${H[4].name}`),
     s.inn2.batsmen.map((b) => b.dismissal).join(" | "));
  ok("the log the screen was given is not changed", LOG[0].bowlingSquad[0].name === K[0].name && LOG[7].fielder === K[1].name);
}

console.log("\nC. The home side marked: the away side by name");
{
  const s = screen(answer({ [HOME]: true, [AWAY]: false }));
  ok("every home batter is 'Batter'", s.inn.batsmen.every((b) => b.name === GROUND_POSITION.batter));
  ok("...the away bowlers and catchers are named", s.inn.bowlers.every((b) => b.name === K.find((k) => k.id === b.id)?.name)
     && s.inn.batsmen.find((b) => b.id === H[0].id)?.dismissal === `c ${K[1].name} b ${K[0].name}`, s.inn.batsmen.map((b) => b.dismissal).join(" | "));
  ok("...the home boy's catch after the break is 'c Fielder'", s.inn2.batsmen.some((b) => b.dismissal === "c Fielder b Bowler"));
}

console.log("\nD. Fail closed");
{
  const s = screen(null);
  ok("before the server answers, nobody with a row is named on the screen",
     PLAYERS.every((p) => !everyText(s).includes(p.name)), PLAYERS.filter((p) => everyText(s).includes(p.name)).map((p) => p.name).join(", "));
  ok("...each is his position", s.inn.batsmen.every((b) => b.name === GROUND_POSITION.batter) && s.inn.bowlers.every((b) => b.name === GROUND_POSITION.bowler));
  const both = screen(answer({ [HOME]: true, [AWAY]: true }));
  ok("both sides position-only: nobody named", PLAYERS.every((p) => !everyText(both).includes(p.name)));
  const typed = forGround([A(inningsStart({ battingTeam: HOME, bowlingTeam: AWAY, squad: ["Typed Batter"], bowlingSquad: [] }))], new Set());
  ok("a name the scorer typed stays as he typed it", typed.events[0].squad[0] === "Typed Batter");
}

console.log(`\nGROUND NAMES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
