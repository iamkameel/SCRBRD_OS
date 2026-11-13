// The big screen at the ground (docs/design/PUBLIC_BY_TERMS.md §2.5, slice
// 1; Kameel, 12 Nov 2026): (b) when the host side's season roster holds a
// boy under a never-public mark the WHOLE SIDE is shown by position (and the
// away side always is), and, on top of that (21:00, "we should be masking
// the names of any boy that doesn't have a public profile"), a boy is named
// only where the public live page of the match names him, by its label.
// apps/web/src/display/groundNames.js over a log built with
// @scrbrd/scoring's own constructors and the server's labels (GET
// /api/matches/:id/ground-names: nameFor() over public_match_people()'s
// rows, ground-names-api.mjs groundLabels()), folded
// and told as the Match Centre's big screen does it
// (views/matchcentre/bigscreen.jsx). Catches are written in the pad's shape:
// `fielder` the scorecard's name text, `fielders` the references. db/99 §131
// proves the server's per-side answer; smoke-browser-matchcentre walks it on
// a real big screen. Everyone here is invented.
import { deriveMatch, inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { GROUND_POSITION, answerFor, answeredThrough, byPosition, forGround, groundAnswerOf, groundInnings, groundNameOf, labelsFromAnswer, namedOnGround } from "../src/display/groundNames.js";
import { groundAnswer, groundLabels } from "../../../services/api/read/ground-names-api.mjs";
import { displayState, fallOfWicket, bowlingPanel, partnershipPanel } from "../src/display/data.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

const id = (/** @type {string} */ s, /** @type {number} */ n) => `${s}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const squad = (/** @type {string} */ s, /** @type {string} */ who, n = 6) =>
  Array.from({ length: n }, (_, i) => ({ id: id(s, i + 1), name: `${who} Invented${i + 1}` }));
const H = squad("a", "Homeboy"), K = squad("b", "Awayboy");
const HOME = "U15A", AWAY = "Visitors U15A";
const LATE = { id: id("c", 1), name: "Lateboy Invented" };   // carried only by a later innings_start
/** The public page's label for a boy: initial and surname, as publicName() writes it. */
const label = (/** @type {{name: string}} */ p) => `${p.name[0]} ${p.name.split(" ")[1]}`;
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

/**
 * The server's answer (ground-names-api.mjs): groundLabels() over rows as
 * public_match_people() returns them — the boys in `namedIds` with a live,
 * competent consent, the rest with none — so the label is publicName()'s own.
 */
function factsOf(/** @type {Set<string>} */ namedIds, who = PLAYERS) {
  return who.map((p) => ({
    player_id: p.id, school_published: true, full_name: p.name, surname: p.name.split(" ")[1], known_as: null, served_on: "2026-11-12",
    facts: { neverPublic: false, namesOff: false,
             consents: namedIds.has(p.id) ? [{ by: "guardian", competent: true, givenOn: "2026-11-01", endedOn: null }] : [] },
  }));
}
function publicOf(/** @type {Set<string>} */ namedIds) {
  return { labels: groundLabels(factsOf(namedIds)) };
}
const EVERYONE = new Set(PLAYERS.map((p) => p.id));
/** The server's answer (db/153). */
const answer = (/** @type {Record<string, boolean>} */ flags, logSeq = 99) =>
  ({ rows: Object.entries(flags).map(([team, position_only]) => ({ team, position_only, log_seq: logSeq })) });
const AWAY_MARKED = answer({ [HOME]: false, [AWAY]: true });

/** The big screen's fold and commentary, as bigscreen.jsx makes them. */
function screen(/** @type {any} */ ans, pub = publicOf(EVERYONE)) {
  const named = namedOnGround(ans, LOG, labelsFromAnswer(pub));
  const { events, spoken, hidden } = forGround(LOG, named);
  const folded = deriveMatch(events, {});
  groundInnings(folded.innings, named, hidden);
  const played = folded.innings.filter(Boolean);
  const commentary = deriveCommentary(spoken, { nameOf: groundNameOf(named, hidden), teamName: (_k, n) => n });
  return { named, hidden, events, inn: played[0], inn2: played[1], played, commentary };
}
const everyText = (/** @type {any} */ s) => JSON.stringify({ inn: s.played, c: s.commentary.map((c) => c.text) });
const SQUAD_NAMES = PLAYERS.map((p) => p.name);
const AWAY_WORDS = [...K.map((p) => p.name), ...K.map(label), "Awayfour"];

console.log("A. The answers: the server's per side, the public page's per boy");
{
  const L = labelsFromAnswer(publicOf(EVERYONE));
  ok("no answer names nobody with a row", namedOnGround(null, LOG, L).size === 0 && namedOnGround(undefined, LOG, L).size === 0);
  ok("no labels answer names nobody", namedOnGround(answer({ [HOME]: false, [AWAY]: false }), LOG, null).size === 0
     && labelsFromAnswer(null) === null && labelsFromAnswer(/** @type {any} */ ({})) === null);
  ok("the server's labels are publicName()'s: initial and surname, for the boys it names",
     L?.get(H[0].id) === label(H[0]) && L?.get(K[5].id) === label(K[5]) && L?.get(LATE.id) === label(LATE), JSON.stringify([...(L ?? [])].slice(0, 3)));
  ok("...and none for a boy with no public name", labelsFromAnswer(publicOf(new Set([H[1].id])))?.size === 1);
  ok("a key that is not a player id, or a blank label, names nobody",
     labelsFromAnswer({ labels: { "Typed Name": "T Name", [H[0].id]: " ", [H[1].id]: 7 } })?.size === 0);
  const n = namedOnGround(AWAY_MARKED, LOG, L);
  ok("a side answered position-only names none of the boys its first squad carries", K.every((p) => !n.has(p.id)));
  ok("...and every boy of the other side's squad the public page names is named, by its label", H.every((p) => n.get(p.id) === label(p)));
  ok("a boy only a later innings_start carries is never named, his side answered or not",
     !n.has(LATE.id) && !namedOnGround(answer({ [HOME]: false, [AWAY]: false }), LOG, L).has(LATE.id));
  ok("a side the answer does not mention names nobody it carries", [...namedOnGround(answer({ [HOME]: false }), LOG, L).keys()].every((x) => H.some((p) => p.id === x))
     && namedOnGround(answer({ [AWAY]: false }), LOG, L).size === K.length);
  ok("a side answered twice, once position-only, is position-only",
     namedOnGround({ rows: [{ team: AWAY, position_only: false }, { team: AWAY, position_only: true }, { team: HOME, position_only: false }] }, LOG, L).size === H.length);
  ok("an answer that is not a clear false names nobody",
     namedOnGround({ rows: [{ team: HOME, position_only: null }, { team: AWAY }] }, LOG, L).size === 0);
  ok("the answer's log_seq is what it covered", answeredThrough(answer({}, 7)) === null && answeredThrough(AWAY_MARKED) === 99
     && answeredThrough({ rows: [{ team: HOME, position_only: false, log_seq: "12" }] }) === 12 && answeredThrough(null) === null);
  ok("a name the scorer typed is a position, as on the public page", byPosition(new Map(), "Typed Name"));
}

console.log("\nA2. One answer, one snapshot (ground_screen_names(), Fable's red-team B1)");
{
  // The rows as ground_screen_names() returns them: facts only for a side answered false.
  const rows = [{ team: HOME, position_only: false, log_seq: "41", people: factsOf(EVERYONE, H) },
                { team: AWAY, position_only: true, log_seq: "41", people: [] }];
  const d = groundAnswer("m1", rows);
  ok("the route's answer is the sides as answered, and labels from the false side's facts alone",
     d.matchId === "m1" && d.sides.length === 2 && d.sides[0].log_seq === 41 && d.sides[1].position_only === true
     && Object.keys(d.labels).length === H.length && H.every((p) => d.labels[p.id] === label(p)), JSON.stringify(d.sides));
  const smuggled = groundAnswer("m1", [{ team: AWAY, position_only: true, log_seq: 41, people: factsOf(EVERYONE, K) },
                                       { team: HOME, position_only: null, log_seq: 41, people: factsOf(EVERYONE, H) }]);
  ok("facts beside a side answered anything but false lend no label, and the side stays position-only",
     Object.keys(smuggled.labels).length === 0 && smuggled.sides.every((x) => x.position_only === true), JSON.stringify(smuggled));
  ok("no rows (not the host's staff) is no sides and no labels", (() => { const z = groundAnswer("m1", []); return z.sides.length === 0 && Object.keys(z.labels).length === 0; })());
  const a = groundAnswerOf(JSON.parse(JSON.stringify(d)));
  ok("the screen reads both from the one answer", a !== null && a.rows.length === 2 && a.labels?.size === H.length && answeredThrough(a) === 41);
  const n = namedOnGround(a, LOG, a?.labels ?? null);
  ok("...and names the host side by its labels and the away side by position", n.size === H.length && K.every((p) => !n.has(p.id)));
  ok("an answer about another match is no answer, and one held from the match before is not used (NIT 2)",
     groundAnswerOf(JSON.parse(JSON.stringify(d)), "m2") === null && answerFor(a, "m2") === null && answerFor(a, "m1") === a
     && answerFor(null, "m1") === null && groundAnswerOf({ sides: [], labels: {} }) === null);
  ok("an answer without sides is no answer: nobody is named",
     groundAnswerOf({ labels: d.labels }) === null && groundAnswerOf(null) === null && groundAnswerOf({ sides: "x" }) === null);
  const marked = groundAnswerOf(groundAnswer("m1", [{ team: HOME, position_only: true, log_seq: 42, people: [] },
                                                    { team: AWAY, position_only: true, log_seq: 42, people: [] }]));
  ok("a host side turned position-only carries no labels to set beside it", marked?.labels?.size === 0
     && namedOnGround(marked, LOG, marked?.labels ?? null).size === 0);
}

console.log("\nB. The marked boy's whole side by position, the other side by the public page's labels");
{
  const s = screen(AWAY_MARKED);
  const leaked = AWAY_WORDS.filter((m) => everyText(s).toLowerCase().includes(m.toLowerCase()));
  ok("no name or label of the marked side, nor the shorter name a scorer typed for one, is anywhere on the screen", leaked.length === 0, leaked.join(", "));
  ok("no squad name, only the public labels, anywhere on the screen", SQUAD_NAMES.every((m) => !everyText(s).includes(m)),
     SQUAD_NAMES.filter((m) => everyText(s).includes(m)).join(", "));
  ok("every bowler of the first innings is 'Bowler'", s.inn.bowlers.length === 2 && s.inn.bowlers.every((b) => b.name === GROUND_POSITION.bowler),
     s.inn.bowlers.map((b) => b.name).join(","));
  const opener = s.inn.batsmen.find((b) => b.id === H[0].id);
  ok("the home opener is named by his public label", opener?.name === label(H[0]), opener?.name);
  ok("...caught in the pad's shape by a boy of the marked side: 'c Fielder b Bowler'", opener?.dismissal === "c Fielder b Bowler", opener?.dismissal);
  const second = s.inn.batsmen.find((b) => b.id === H[1].id);
  ok("a catch whose name text matches nobody, but whose reference is the marked side's, is 'c Fielder'",
     second?.dismissal === "c Fielder b Bowler", second?.dismissal);
  ok("every home batter on the card is named by his label", s.inn.batsmen.every((b) => b.name === label(/** @type {any} */ (H.find((h) => h.id === b.id)))),
     s.inn.batsmen.map((b) => b.name).join(","));
  ok("the fall of wickets names the home batters by label", s.inn.fow[0]?.batsman === label(H[0]), JSON.stringify(s.inn.fow));
  const st = displayState({ match: { id: "m", homeTeam: HOME, awayTeam: AWAY, status: "live", overs: 5 }, innings: [s.inn] });
  const panels = JSON.stringify({ fow: fallOfWicket(st.inn), bowl: bowlingPanel(st.inn), part: partnershipPanel(st.inn) });
  ok("the display's panels (the fall, the bowling, the partnership) carry no away name or label",
     AWAY_WORDS.every((m) => !panels.toLowerCase().includes(m.toLowerCase())), panels.slice(0, 240));
  ok("the commentary names home boys by label and says the bowler's role",
     s.commentary.some((c) => c.text.includes(label(H[1]))) && s.commentary.some((c) => /the bowler|a fielder/i.test(c.text)),
     s.commentary.map((c) => c.text).join(" | ").slice(0, 400));
  ok("after the break the sides keep their own: the away batters are 'Batter', the home bowler named",
     s.inn2.batsmen.every((b) => b.name === GROUND_POSITION.batter) && s.inn2.bowlers.every((b) => b.name === label(H[4])),
     JSON.stringify({ bat: s.inn2.batsmen.map((b) => b.name), bowl: s.inn2.bowlers.map((b) => b.name) }));
  ok("...and a home boy's catch is his label", s.inn2.batsmen.some((b) => b.dismissal === `c ${label(H[5])} b ${label(H[4])}`),
     s.inn2.batsmen.map((b) => b.dismissal).join(" | "));
  ok("the log the screen was given is not changed", LOG[0].bowlingSquad[0].name === K[0].name && LOG[7].fielder === K[1].name);
}

console.log("\nC. A boy the public page does not name is a position, on a side that is named");
{
  // H[0] and H[3] have no public name (no consent, names off, the school's choice): the public page shows them by position.
  const s = screen(answer({ [HOME]: false, [AWAY]: true }), publicOf(new Set(PLAYERS.filter((p) => p !== H[0] && p !== H[3]).map((p) => p.id))));
  ok("the boys the public page does not name are 'Batter'", s.inn.batsmen.find((b) => b.id === H[0].id)?.name === GROUND_POSITION.batter
     && s.inn.batsmen.find((b) => b.id === H[3].id)?.name === GROUND_POSITION.batter);
  ok("...nowhere named on the screen", [H[0], H[3]].every((p) => !everyText(s).includes(label(p)) && !everyText(s).includes(p.name)));
  ok("...while his team-mates the public page names keep their labels", s.inn.batsmen.find((b) => b.id === H[1].id)?.name === label(H[1]));
  const m = screen(answer({ [HOME]: true, [AWAY]: true }));
  ok("a side with a marked boy on its roster is wholly by position, the boys the public page names included",
     PLAYERS.every((p) => !everyText(m).includes(label(p)) && !everyText(m).includes(p.name)));
}

console.log("\nD. Fail closed");
{
  const s = screen(null);
  ok("before the server answers, nobody with a row is named on the screen",
     PLAYERS.every((p) => !everyText(s).includes(label(p))), PLAYERS.filter((p) => everyText(s).includes(label(p))).map(label).join(", "));
  ok("...each is his position", s.inn.batsmen.every((b) => b.name === GROUND_POSITION.batter) && s.inn.bowlers.every((b) => b.name === GROUND_POSITION.bowler));
  const nopub = screen(answer({ [HOME]: false, [AWAY]: false }), /** @type {any} */ (null));
  ok("without the public page's answer (not published, or the read failed), nobody is named",
     PLAYERS.every((p) => !everyText(nopub).includes(label(p)) && !everyText(nopub).includes(p.name)));
  const typed = forGround([A(inningsStart({ battingTeam: HOME, bowlingTeam: AWAY, squad: ["Typed Batter"], bowlingSquad: [] }))], new Map());
  ok("a name the scorer typed is a position", typed.events[0].squad[0]?.name === GROUND_POSITION.batter, JSON.stringify(typed.events[0].squad));
}

console.log(`\nGROUND NAMES: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
