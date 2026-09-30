import {
  inningsStart, batters, bowler, ball, placementFromTap, deriveInnings, deriveMatch, deriveCommentary, BALL_TYPE,
} from "@scrbrd/scoring";
import { seedRng } from "../../scorer/seed.js";
import { teamOf } from "../../lib/matchCentre.js";
import { undoWords } from "../../scorer/prompts.js";

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
 * rows are literals in the shape the screens' adapters produce. Nothing here
 * is a child's real data, and nothing here is ever written anywhere.
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
