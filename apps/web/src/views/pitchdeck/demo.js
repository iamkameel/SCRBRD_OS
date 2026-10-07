import {
  inningsStart, batters, bowler, ball, placementFromTap, deriveInnings, deriveMatch, deriveCommentary, BALL_TYPE,
} from "@scrbrd/scoring";
import { seedRng } from "../../scorer/seed.js";
import { teamOf } from "../../lib/matchCentre.js";
import { undoWords } from "../../scorer/prompts.js";
import { boardFromInnings } from "../../scorer/boardData.js";
import { boardInsights } from "../../scorer/signals.js";
import { addDays, dateStr, today } from "../../lib/format.js";

/**
 * THE SHOWCASE'S OWN DATA — built here, in the browser, and never fetched.
 *
 * The deck's live-UI slides (views/pitchdeck/Showcase.jsx) draw the real
 * screens: the scorer's pad and board, the Match Centre's tabs, the consent
 * cards, the raise-a-concern form. Those screens read their data from a
 * server and a session; this file is what stands in for both, and it is
 * built the way the wheel slide's innings is (PitchDeckView's DEMO): from a
 * key, deterministic, so the deck shows the same match at every showing and
 * no request is made to draw it.
 *
 * WHAT IS REAL AND WHAT IS INVENTED. The match is a ball log written through
 * the scoring package's own constructors (the same events the pad emits) and
 * folded by its own replay (deriveMatch), with commentary from its own
 * generator. The people in it are invented: two made-up school sides and
 * made-up initials, nobody's record. The consent rows and the two contact
 * rows are literals in the shape the screens' adapters produce, and so are
 * the day sheet's fixtures, injuries and alerts and the scorebook's card.
 * Nothing here is a child's real data, and nothing here is ever written
 * anywhere.
 */

export const HOME = "Riverside College 1st XI";
export const AWAY = "Northgate High 1st XI";
const OVERS = 10;

const HOME_XI = ["T Mokoena", "A Naidoo", "S van Rensburg", "K Dlamini", "J Pillay", "M Botha", "L Mthembu", "D Govender", "R Steyn", "N Khumalo", "P Adams"];
const AWAY_XI = ["B Sithole", "C Fourie", "E Maharaj", "F Nkosi", "G Petersen", "H Zulu", "I Reddy", "O Venter", "Q Mabaso", "V Jacobs", "W Cele"];
const squad = (names) => names.map((n) => ({ id: n, name: n }));

const SHOTS = { 0: ["fwd_def", "back_def"], 1: ["drive", "flick", "glance", "cut"], 2: ["drive", "cut", "pull"], 3: ["drive", "cut"], 4: ["drive", "cut", "pull", "sweep"], 6: ["loft", "pull", "slog"] };
const RADIUS = { 1: [0.25, 0.55], 2: [0.5, 0.75], 3: [0.7, 0.9], 4: [0.97, 1], 6: [1, 1] };

/**
 * One innings, scored the way a scorer taps it: bowler named at each over's
 * start, the next batter after each wicket, a point on the field for every
 * ball that ran. `wicketsAt` are legal-ball indices; `pace` is how freely the
 * runs come (a higher figure, a faster innings).
 */
function innings(rng, { n, batting, bowling, batXI, bowlXI, legal, wicketsAt, pace, target = null, tsBase }) {
  /** @type {any[]} */
  const log = [];
  let k = 0;
  const add = (ev) => log.push({ ...ev, innings: n, id: `deck-${n}-${++k}`, clientTs: tsBase + k * 20000 });
  const attack = bowlXI.slice(6, 11);
  add(inningsStart({ battingTeam: batting, bowlingTeam: bowling, squad: squad(batXI), bowlingSquad: squad(bowlXI), overs: OVERS, target }));
  add(batters({ striker: batXI[0], nonStriker: batXI[1] }));
  const queue = batXI.slice(2);
  let overNo = 0, faced = 0;
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  const between = ([lo, hi]) => lo + rng() * (hi - lo);
  while (faced < legal) {
    const inn = deriveInnings(log);
    if (inn.bowler == null) { add(bowler({ bowler: attack[overNo % attack.length] })); overNo += 1; }
    if ((inn.striker == null || inn.nonStriker == null) && queue.length) {
      add(batters(inn.striker == null ? { striker: queue.shift() } : { nonStriker: queue.shift() }));
    }
    if (rng() < 0.04) { add(ball({ type: BALL_TYPE.WIDE, value: 0 })); continue; }
    if (wicketsAt.includes(faced)) {
      const how = pick(["caught", "caught", "bowled", "lbw"]);
      add(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: how, fielder: how === "caught" ? pick(bowlXI.slice(0, 6)) : null, shot: how === "bowled" ? "drive" : "loft" }));
    } else {
      const r = rng() * pace;
      const v = r < 0.30 ? 0 : r < 0.62 ? 1 : r < 0.73 ? 2 : r < 0.75 ? 3 : r < 0.90 ? 4 : 6;
      const shot = pick(SHOTS[v]);
      add(ball(v === 0
        ? { type: BALL_TYPE.RUN, value: 0, shot }
        : { type: BALL_TYPE.RUN, value: v, shot, ...placementFromTap({ angle: Math.floor(rng() * 360), radius: between(RADIUS[v]) }) }));
    }
    faced += 1;
  }
  return log;
}

/** The demonstration fixture: a ten-over match, the chase five and a half overs in, needing 39 from 27. */
export function buildMatch() {
  const first = innings(seedRng("pitch-deck-showcase-1"), { n: 0, batting: HOME, bowling: AWAY, batXI: HOME_XI, bowlXI: AWAY_XI,
    legal: OVERS * 6, wicketsAt: [11, 24, 31, 44, 53], pace: 0.9, tsBase: Date.parse("2026-09-26T09:00:00Z") });
  const total = deriveInnings(first).runs;
  const second = innings(seedRng("pitch-deck-showcase-2"), { n: 1, batting: AWAY, bowling: HOME, batXI: AWAY_XI, bowlXI: HOME_XI,
    legal: 33, wicketsAt: [9, 22], pace: 1.0, target: total + 1, tsBase: Date.parse("2026-09-26T10:00:00Z") });
  const events = [...first, ...second];

  const match = { id: "deck-demo", homeTeam: HOME, awayTeam: AWAY, status: "live", overs: OVERS,
    venue: "Main Oval", date: "2026-09-26", time: "09:00" };
  const folded = deriveMatch(events, {});
  const played = folded.innings.filter(Boolean);
  const commentary = deriveCommentary(events, {
    ctx: {},
    nameOf: (ref) => ref,
    teamName: (_key, name) => teamOf(match, name).full,
  });
  const chasing = played[1];
  const lastBall = [...second].reverse().find((e) => e.kind === "ball");
  return {
    match, events, played, commentary, chasing, target: total + 1, overs: OVERS, result: folded.result,
    undoWhat: undoWords(lastBall, chasing),
  };
}

// ── The families' screens ──
// Rows in the shape lib/live.js asConsent produces, one per state a family
// meets: not yet answered, on, and a boy of eighteen answering for himself.
export const CONSENT_ROWS = {
  ask: { demo: true, kind: "health", playerId: "deck-child-a", name: "Lwazi", relation: "guardian", adult: false, live: false, state: "not_answered",
         canSayYes: true, canSayNo: false, askAt18: false, moduleOn: true },
  section: [
    { demo: true, kind: "health", playerId: "deck-child-b", name: "Aiden", relation: "guardian", adult: false, live: true, state: "given", givenBy: "guardian",
      byYou: true, givenOn: "2026-08-14", canSayYes: false, canSayNo: true, askAt18: false, moduleOn: true },
    { demo: true, kind: "health", playerId: "deck-child-c", name: "Mila", relation: "guardian", adult: false, live: false, state: "withdrawn", givenBy: "guardian",
      byYou: true, givenOn: "2026-05-02", endedOn: "2026-09-01", canSayYes: true, canSayNo: false, askAt18: false, moduleOn: true },
  ],
  eighteen: { demo: true, kind: "health", playerId: "deck-self", name: "Him", relation: "self", adult: true, live: true, state: "given", givenBy: "guardian",
              givenOn: "2026-02-10", canSayYes: false, canSayNo: true, askAt18: true, moduleOn: true },
  self: { demo: true, kind: "health", playerId: "deck-self", name: "Him", relation: "self", adult: true, live: true, state: "given", givenBy: "guardian",
          givenOn: "2026-02-10", canSayYes: false, canSayNo: true, askAt18: false, moduleOn: true },
};

// ── Safeguarding: the two contact rows the form reads, and a receipt ──
export const SAFEGUARDING = {
  contacts: {
    rows: [
      { schoolId: "deck-school", schoolName: "Riverside College", heldAt: "school", personId: "deck-dso-1", name: "Designated Safeguarding Officer" },
    ],
    guardianAppUrl: "#",
    loading: false,
    error: null,
  },
  receipt: { reference: "SG-DEMO-0001", raisedAt: "2026-09-26T10:30:00Z", unheld: false },
};

// ── The coach's day sheet ──
// What DashboardView holds after its reads, handed to <DaySheet/> instead: the
// live fixture is the demonstration chase above (its board is drawn by the same
// boardFromInnings and boardInsights the view calls), and the rest are
// invented fixtures, players and alerts, dated from today so "this week" is
// always this week. The two players named as out are in neither XI above, so
// nobody in the deck is out and batting at once.

const day = (n) => dateStr(addDays(today, n));
const ASHDOWN = "Ashdown High 1st XI";
const HILLVIEW = "Hillview College 1st XI";

/** @param {ReturnType<typeof buildMatch>} d  the demonstration match, for the "Now" tile's board */
export function buildDaySheet(d) {
  const props = boardFromInnings(d.chasing, { target: d.target, overs: d.overs });
  const insight = boardInsights(d.chasing, { target: d.target, overs: d.overs });
  const next = { id: "deck-next", homeTeam: HOME, awayTeam: ASHDOWN, status: "upcoming", date: day(1), time: "13:00", venue: "Ashdown High, Top Field" };
  return {
    role: "coach",
    live: false,
    // The coach's sheet, whoever is presenting: not the signed-in viewer's own roles (GA-I07's holdsAsHeld).
    held: false,
    demoNote: "Demonstration: invented fixtures and players",
    liveMatch: d.match,
    board: props ? { ...props, team: props.team || d.match.homeTeam, insight: insight.length ? insight : undefined } : null,
    boardState: { loading: false, error: null },
    next,
    busTime: "10:45",
    weather: { icon: "cloud-sun", tempC: 24, condition: "Partly cloudy", rainChancePct: 20 },
    // Three of the four ready chips on record; the ground report is not, and the sheet says so.
    dutyRows: [{ duty: "squad" }, { duty: "transport" }, { duty: "umpire" }],
    weekMatches: [next, { id: "deck-wk-2", homeTeam: HOME, awayTeam: HILLVIEW, status: "upcoming", date: day(5), time: "09:00", venue: "Main Oval" }],
    weekTraining: [
      { id: "deck-tr-1", title: "Nets: batting", date: day(2), time: "15:30" },
      { id: "deck-tr-2", title: "Fielding and fitness", date: day(4), time: "15:30" },
    ],
    out: [
      { id: "deck-inj-1", name: "Z Mahlangu", rtw: day(9) },
      { id: "deck-inj-2", name: "Y Coetzee", rtw: day(3) },
    ],
    unread: [
      { id: "deck-al-1", title: "Umpires confirmed for tomorrow", body: "Two umpires are on record for the fixture at Ashdown High." },
      { id: "deck-al-2", title: "Ground report is still to come", body: "Nothing is on record from Ashdown High's ground yet." },
    ],
  };
}

// ── The paper scorebook ──
// One innings' card as a person would have typed it from a page: the shape
// scorebookcard.jsx's CardReader takes, and one the scoring package's own
// summaryRefusal() passes (the unit suite holds it to that). Our side are ids
// as the roster would give them; the opposition are typed names, `t:<n>` keys
// with their spelling in `typed`, never a player.

const pid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OURS = ["T Mokoena", "A Naidoo", "S van Rensburg", "K Dlamini", "J Pillay", "M Botha", "L Mthembu", "D Govender", "R Steyn", "N Khumalo", "P Adams"];
const ID_OF = Object.fromEntries(OURS.map((n, i) => [n, pid(i + 1)]));
const TYPED = Object.fromEntries(AWAY_XI.map((n, i) => [`t:${i + 1}`, n]));

/** The innings as typed from the page (Riverside batting, twenty overs). */
export const SCOREBOOK_CARD = {
  v: 1, innings: 0, battingSide: "home",
  batting: [
    { order: 1, ref: ID_OF["T Mokoena"],      howOut: "caught",  fielderRef: "t:4", bowlerRef: "t:1", runs: 34, balls: 27, fours: 5, sixes: 1 },
    { order: 2, ref: ID_OF["A Naidoo"],       howOut: "bowled",  fielderRef: null,  bowlerRef: "t:2", runs: 12, balls: 15, fours: 1, sixes: 0 },
    { order: 3, ref: ID_OF["S van Rensburg"], howOut: "lbw",     fielderRef: null,  bowlerRef: "t:2", runs: 41, balls: 30, fours: 4, sixes: 2 },
    { order: 4, ref: ID_OF["K Dlamini"],      howOut: "run_out", fielderRef: "t:7", bowlerRef: null,  runs: 8,  balls: 6,  fours: 1, sixes: 0 },
    { order: 5, ref: ID_OF["J Pillay"],       howOut: "caught",  fielderRef: "t:3", bowlerRef: "t:5", runs: 27, balls: 16, fours: 2, sixes: 2 },
    { order: 6, ref: ID_OF["M Botha"],        howOut: "bowled",  fielderRef: null,  bowlerRef: "t:3", runs: 5,  balls: 4,  fours: 1, sixes: 0 },
    { order: 7, ref: ID_OF["L Mthembu"],      howOut: "not_out", fielderRef: null,  bowlerRef: null,  runs: 22, balls: 12, fours: 1, sixes: 2 },
    { order: 8, ref: ID_OF["D Govender"],     howOut: "not_out", fielderRef: null,  bowlerRef: null,  runs: 10, balls: 5,  fours: 1, sixes: 0 },
  ],
  "didNotBat": [ID_OF["R Steyn"], ID_OF["N Khumalo"], ID_OF["P Adams"]],
  bowling: [
    { ref: "t:1", overs: "4", maidens: 0, runs: 36, wickets: 1, wides: 1, noBalls: 0 },
    { ref: "t:2", overs: "4", maidens: 0, runs: 31, wickets: 2, wides: 2, noBalls: 1 },
    { ref: "t:3", overs: "4", maidens: 1, runs: 27, wickets: 1, wides: 1, noBalls: 0 },
    { ref: "t:5", overs: "4", maidens: 0, runs: 40, wickets: 1, wides: 1, noBalls: 0 },
    { ref: "t:6", overs: "4", maidens: 0, runs: 31, wickets: 0, wides: 0, noBalls: 0 },
  ],
  extras: { byes: 2, legByes: 1, wides: 5, noBalls: 1, penalty: 0 },
  total: 168, wickets: 6, overs: "20",
  fallOfWickets: [
    { wicket: 1, score: 52,  ref: ID_OF["T Mokoena"],      over: "6.4" },
    { wicket: 2, score: 77,  ref: ID_OF["A Naidoo"],       over: "10.1" },
    { wicket: 3, score: 108, ref: ID_OF["S van Rensburg"], over: "14.2" },
    { wicket: 4, score: 118, ref: ID_OF["K Dlamini"],      over: "15.5" },
    { wicket: 5, score: 121, ref: ID_OF["M Botha"],        over: "16.3" },
    { wicket: 6, score: 141, ref: ID_OF["J Pillay"],       over: "18.2" },
  ],
  endReason: "overs", unreconciled: null,
};

const NAME_OF = { ...Object.fromEntries(Object.entries(ID_OF).map(([n, id]) => [id, n])), ...TYPED };

/** What CardReader is handed: the card, its place in the import, the names, the sides; nothing refused. */
export const SCOREBOOK = {
  card: SCOREBOOK_CARD, n: 0, typed: TYPED, refusals: [],
  nameOf: (/** @type {string | null | undefined} */ ref) => (ref ? NAME_OF[ref] ?? "" : ""),
  sideNames: { home: HOME, away: AWAY },
};
