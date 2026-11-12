// The big screen at the ground shows a marked boy by his position
// (docs/design/PUBLIC_BY_TERMS.md §2.5, slice 1): apps/web/src/display/
// groundNames.js over a log built with @scrbrd/scoring's own constructors,
// folded and told as the Match Centre's big screen does it
// (views/matchcentre/bigscreen.jsx). db/99 §130 proves the server's answer;
// smoke-browser-matchcentre walks it on a real big screen. Everyone here is
// invented.
import { deriveMatch, inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { GROUND_POSITION, byPosition, forGround, groundInnings, groundNameOf, namedOnGround } from "../src/display/groundNames.js";
import { nameBook } from "../src/lib/matchCentre.js";
import { displayState, fallOfWicket, bowlingPanel, partnershipPanel } from "../src/display/data.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

const id = (/** @type {string} */ s, /** @type {number} */ n) => `${s}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const squad = (/** @type {string} */ s, /** @type {string} */ who, n = 6) =>
  Array.from({ length: n }, (_, i) => ({ id: id(s, i + 1), name: `${who} Invented${i + 1}` }));
const H = squad("a", "Home"), K = squad("b", "Away");
// The marked boys: the home opener (h1) and the away opening bowler (k1), who also takes a catch.
const MARKED = [H[0].id, K[0].id];
let seq = 0;
const A = (/** @type {any} */ ev) => ({ ...ev, innings: 0, id: `ev${++seq}`, clientTs: Date.parse("2026-11-12T08:00:00Z") + seq * 30_000 });
const LOG = [
  A(inningsStart({ battingTeam: "U15A", bowlingTeam: "Visitors U15A", teamKey: "U15A", bowlingTeamKey: "Visitors U15A", squad: H, bowlingSquad: K, overs: 5 })),
  A(batters({ striker: H[0].id, nonStriker: H[1].id })),
  A(bowler({ bowler: K[0].id })),
  A(ball({ value: 4 })), A(ball({ value: 1 })), A(ball({ value: 1 })), A(ball({ value: 0 })),
  // H[0] caught, the fielder written by the name his squad gave him (the pad's wicket sheet).
  A(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: K[1].name })),
  A(batters({ striker: H[2].id })),
  A(ball({ value: 2 })),
  // The over is done; the ends change, and H[1] faces K[2].
  A(bowler({ bowler: K[2].id })),
  // H[1] caught by the marked bowler K[0], in the field now, written by his reference.
  A(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: K[0].id })),
  A(batters({ striker: H[3].id })),
  A(ball({ value: 6 })),
];
const ROWS = [...H, ...K].map((p) => ({ player_id: p.id, position_only: MARKED.includes(p.id) }));
const PLAYERS = [...H, ...K];

/** The big screen's fold and commentary, as bigscreen.jsx makes them. */
function screen(/** @type {any[] | null} */ rows) {
  const named = namedOnGround(rows);
  const { events, hidden } = forGround(LOG, named);
  const folded = deriveMatch(events, {});
  groundInnings(folded.innings, named, hidden);
  const played = folded.innings.filter(Boolean);
  const nameOf = groundNameOf(nameBook(played, PLAYERS), named, hidden);
  const commentary = deriveCommentary(LOG, { nameOf, teamName: (_k, n) => n });
  return { named, hidden, events, inn: played[0], played, commentary };
}
const everyText = (/** @type {any} */ s) => JSON.stringify({ inn: s.inn, c: s.commentary.map((c) => c.text) });

console.log("A. The server's answer");
{
  ok("no answer names nobody with a row", namedOnGround(null).size === 0 && namedOnGround(undefined).size === 0);
  const n = namedOnGround(ROWS);
  ok("an answer names exactly the boys it says are not position-only", n.size === ROWS.length - 2 && MARKED.every((m) => !n.has(m)));
  ok("a row without a clear false names nobody", namedOnGround([{ player_id: H[1].id }, { player_id: H[2].id, position_only: null }]).size === 0);
  ok("a player with a row the answer does not cover is his position", byPosition(n, id("c", 9)));
  ok("a name the scorer typed (no row) is not a position: nothing marks him", !byPosition(new Set(), "Typed Name"));
}

console.log("\nB. A marked boy by his position, everyone else by name");
{
  const s = screen(ROWS);
  const marked = [H[0].name, K[0].name];
  ok("neither marked boy's name is anywhere on the screen's fold or in its commentary",
     marked.every((m) => !everyText(s).includes(m)), marked.filter((m) => everyText(s).includes(m)).join(", "));
  const opener = s.inn.batsmen.find((b) => b.id === H[0].id);
  ok("the marked opener is 'Batter' on the card", opener?.name === GROUND_POSITION.batter, opener?.name);
  ok("...dismissed 'c Away Invented2 b Bowler': his bowler is his position too", opener?.dismissal === `c ${K[1].name} b Bowler`, opener?.dismissal);
  const k1 = s.inn.bowlers.find((b) => b.id === K[0].id);
  ok("the marked bowler is 'Bowler' in the bowling", k1?.name === GROUND_POSITION.bowler, k1?.name);
  const second = s.inn.batsmen.find((b) => b.id === H[1].id);
  ok("a catch the marked boy took, written by his reference, is 'c Fielder', the unmarked bowler named",
     second?.dismissal === `c Fielder b ${K[2].name}`, second?.dismissal);
  ok("an unmarked team-mate keeps his name", second?.name === H[1].name
     && s.inn.bowlers.find((b) => b.id === K[2].id)?.name === K[2].name);
  ok("the fall of wickets says 'Batter' for the marked opener", s.inn.fow[0]?.batsman === GROUND_POSITION.batter, JSON.stringify(s.inn.fow));
  const st = displayState({ match: { id: "m", homeTeam: "U15A", awayTeam: "Visitors U15A", status: "live", overs: 5 }, innings: s.played });
  const fow = fallOfWicket(st.inn);
  const panels = JSON.stringify({ fow, bowl: bowlingPanel(st.inn), part: partnershipPanel(st.inn) });
  ok("the display's panels (the fall, the bowling, the partnership) carry neither marked name",
     marked.every((m) => !panels.includes(m)), panels.slice(0, 240));
  ok("the commentary names an unmarked boy, and says the marked one's role",
     s.commentary.some((c) => c.text.includes(H[1].name)) && s.commentary.some((c) => /the striker|the bowler|a fielder/.test(c.text)));
  ok("the log the screen was given is not changed", LOG[0].squad[0].name === H[0].name && LOG[11].fielder === K[0].id);
}

console.log("\nC. Fail closed");
{
  const s = screen(null);
  ok("before the server answers, nobody with a row is named on the screen",
     PLAYERS.every((p) => !everyText(s).includes(p.name)), PLAYERS.filter((p) => everyText(s).includes(p.name)).map((p) => p.name).join(", "));
  ok("...each is his position", s.inn.batsmen.every((b) => b.name === GROUND_POSITION.batter) && s.inn.bowlers.every((b) => b.name === GROUND_POSITION.bowler));
  const late = screen(ROWS.filter((r) => r.player_id !== H[3].id));
  ok("a boy the last answer did not cover (in since) is his position until the next one",
     late.inn.batsmen.find((b) => b.id === H[3].id)?.name === GROUND_POSITION.batter);
  const typed = forGround([A(inningsStart({ battingTeam: "U15A", bowlingTeam: "Visitors", squad: ["Typed Batter"], bowlingSquad: [] }))], new Set());
  ok("a name the scorer typed stays as he typed it", typed.events[0].squad[0] === "Typed Batter");
}

console.log(`\nGROUND NAMES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
