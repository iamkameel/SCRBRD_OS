// The big screen at the ground (docs/design/PUBLIC_BY_TERMS.md §2.5, slice
// 1; Kameel, 12 Nov 2026, (b)): when a boy under a never-public mark is on
// the field, his WHOLE SIDE is shown by position, and the other side by
// name. apps/web/src/display/groundNames.js over a log built with
// @scrbrd/scoring's own constructors, folded and told as the Match Centre's
// big screen does it (views/matchcentre/bigscreen.jsx). db/99 §130 proves
// the server's per-side answer; smoke-browser-matchcentre walks it on a real
// big screen. Everyone here is invented.
import { deriveMatch, inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { GROUND_POSITION, byPosition, forGround, groundInnings, groundNameOf, namedOnGround, onField } from "../src/display/groundNames.js";
import { nameBook } from "../src/lib/matchCentre.js";
import { displayState, fallOfWicket, bowlingPanel, partnershipPanel } from "../src/display/data.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

const id = (/** @type {string} */ s, /** @type {number} */ n) => `${s}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const squad = (/** @type {string} */ s, /** @type {string} */ who, n = 6) =>
  Array.from({ length: n }, (_, i) => ({ id: id(s, i + 1), name: `${who} Invented${i + 1}` }));
const H = squad("a", "Home"), K = squad("b", "Away");
const HOME = "U15A", AWAY = "Visitors U15A";
let seq = 0;
const A = (/** @type {any} */ ev) => ({ ...ev, innings: 0, id: `ev${++seq}`, clientTs: Date.parse("2026-11-12T08:00:00Z") + seq * 30_000 });
// The fielding side's K[0] is the marked boy: he opens the bowling, and later
// takes a catch written by his reference.
const LOG = [
  A(inningsStart({ battingTeam: HOME, bowlingTeam: AWAY, teamKey: HOME, bowlingTeamKey: AWAY, squad: H, bowlingSquad: K, overs: 5 })),
  A(batters({ striker: H[0].id, nonStriker: H[1].id })),
  A(bowler({ bowler: K[0].id })),
  A(ball({ value: 4 })), A(ball({ value: 1 })), A(ball({ value: 1 })), A(ball({ value: 0 })),
  // H[0] caught, the fielder written by the name his squad gave him (the pad's wicket sheet).
  A(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: K[1].name })),
  A(batters({ striker: H[2].id })),
  A(ball({ value: 2 })),
  // The over is done; the ends change, and H[1] faces K[2].
  A(bowler({ bowler: K[2].id })),
  // H[1] caught by the marked K[0], in the field now, written by his reference.
  A(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: K[0].id })),
  A(batters({ striker: H[3].id })),
  A(ball({ value: 6 })),
];
const PLAYERS = [...H, ...K];
/** The server's answer (db/153) and what was on the field when it was asked. */
const answer = (/** @type {Record<string, boolean>} */ flags, extra = /** @type {any[]} */ ([]), log = LOG) =>
  ({ rows: [...Object.entries(flags).map(([team, position_only]) => ({ team, position_only })), ...extra], asked: onField(log) });
const AWAY_MARKED = answer({ [HOME]: false, [AWAY]: true });

/** The big screen's fold and commentary, as bigscreen.jsx makes them. */
function screen(/** @type {any} */ ans) {
  const named = namedOnGround(ans, LOG);
  const { events, hidden } = forGround(LOG, named);
  const folded = deriveMatch(events, {});
  groundInnings(folded.innings, named, hidden);
  const played = folded.innings.filter(Boolean);
  const nameOf = groundNameOf(nameBook(played, PLAYERS), named, hidden);
  const commentary = deriveCommentary(LOG, { nameOf, teamName: (_k, n) => n });
  return { named, hidden, events, inn: played[0], played, commentary };
}
const everyText = (/** @type {any} */ s) => JSON.stringify({ inn: s.inn, c: s.commentary.map((c) => c.text) });

console.log("A. The server's answer, per side");
{
  ok("no answer names nobody with a row", namedOnGround(null, LOG).size === 0 && namedOnGround(undefined, LOG).size === 0);
  const field = onField(LOG);
  ok("on the field: the six boys the log puts there in a role, by reference",
     field.size === 6 && [H[0], H[1], H[2], H[3], K[0], K[2]].every((p) => field.has(p.id)), [...field].join(" "));
  const n = namedOnGround(AWAY_MARKED, LOG);
  ok("a side answered position-only names none of its boys", K.every((p) => !n.has(p.id)));
  ok("...and the other side's boys on the field are named", [H[0], H[1], H[2], H[3]].every((p) => n.has(p.id)));
  ok("a boy not on the field when the read was asked is not named until the next one", !n.has(H[4].id));
  ok("a side the answer does not mention names nobody", namedOnGround(answer({ [HOME]: false }), LOG).size === 4
     && namedOnGround(answer({ [AWAY]: false }), LOG).size === 2);
  ok("a row with no side (a marked boy no squad carries) names nobody",
     namedOnGround(answer({ [HOME]: false, [AWAY]: false }, [{ team: null, position_only: true }]), LOG).size === 0);
  ok("a side answered twice, once position-only, is position-only",
     namedOnGround(answer({ [HOME]: false }, [{ team: AWAY, position_only: false }, { team: AWAY, position_only: true }]), LOG)
       .size === 4);
  ok("an answer that is not a clear false names nobody",
     namedOnGround({ rows: [{ team: HOME, position_only: null }, { team: AWAY }], asked: onField(LOG) }, LOG).size === 0);
  ok("a name the scorer typed (no row) is not a position: nothing marks him", !byPosition(new Set(), "Typed Name"));
}

console.log("\nB. The marked boy's whole side by position, the other side by name");
{
  const s = screen(AWAY_MARKED);
  const away = K.map((p) => p.name);
  ok("no name of the marked boy's side is anywhere on the screen's fold or in its commentary",
     away.every((m) => !everyText(s).includes(m)), away.filter((m) => everyText(s).includes(m)).join(", "));
  ok("every bowler is 'Bowler'", s.inn.bowlers.length === 2 && s.inn.bowlers.every((b) => b.name === GROUND_POSITION.bowler),
     s.inn.bowlers.map((b) => b.name).join(","));
  const opener = s.inn.batsmen.find((b) => b.id === H[0].id);
  ok("the home opener keeps his name", opener?.name === H[0].name, opener?.name);
  ok("...dismissed 'c Fielder b Bowler': a catch written by an away boy's name is his position",
     opener?.dismissal === "c Fielder b Bowler", opener?.dismissal);
  const second = s.inn.batsmen.find((b) => b.id === H[1].id);
  ok("a catch written by the marked boy's reference is 'c Fielder'", second?.dismissal === "c Fielder b Bowler", second?.dismissal);
  ok("every home batter on the card is named", s.inn.batsmen.every((b) => b.name === H.find((h) => h.id === b.id)?.name),
     s.inn.batsmen.map((b) => b.name).join(","));
  ok("the fall of wickets names the home batters", s.inn.fow[0]?.batsman === H[0].name, JSON.stringify(s.inn.fow));
  const st = displayState({ match: { id: "m", homeTeam: HOME, awayTeam: AWAY, status: "live", overs: 5 }, innings: s.played });
  const panels = JSON.stringify({ fow: fallOfWicket(st.inn), bowl: bowlingPanel(st.inn), part: partnershipPanel(st.inn) });
  ok("the display's panels (the fall, the bowling, the partnership) carry no away name",
     away.every((m) => !panels.includes(m)), panels.slice(0, 240));
  ok("the commentary names home boys and says the bowler's role",
     s.commentary.some((c) => c.text.includes(H[1].name)) && s.commentary.some((c) => /the bowler|a fielder/.test(c.text)));
  ok("the log the screen was given is not changed", LOG[0].bowlingSquad[0].name === K[0].name && LOG[11].fielder === K[0].id);
}

console.log("\nC. Fail closed");
{
  const s = screen(null);
  ok("before the server answers, nobody with a row is named on the screen",
     PLAYERS.every((p) => !everyText(s).includes(p.name)), PLAYERS.filter((p) => everyText(s).includes(p.name)).map((p) => p.name).join(", "));
  ok("...each is his position", s.inn.batsmen.every((b) => b.name === GROUND_POSITION.batter) && s.inn.bowlers.every((b) => b.name === GROUND_POSITION.bowler));
  const late = screen(answer({ [HOME]: false, [AWAY]: false }, [], LOG.slice(0, 12)));
  ok("a boy who came onto the field after the read was asked is his position until the next one",
     late.inn.batsmen.find((b) => b.id === H[3].id)?.name === GROUND_POSITION.batter
     && late.inn.batsmen.find((b) => b.id === H[2].id)?.name === H[2].name);
  const both = screen(answer({ [HOME]: true, [AWAY]: true }));
  ok("both sides position-only: nobody named", PLAYERS.every((p) => !everyText(both).includes(p.name)));
  const typed = forGround([A(inningsStart({ battingTeam: HOME, bowlingTeam: AWAY, squad: ["Typed Batter"], bowlingSquad: [] }))], new Set());
  ok("a name the scorer typed stays as he typed it", typed.events[0].squad[0] === "Typed Batter");
}

console.log(`\nGROUND NAMES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
