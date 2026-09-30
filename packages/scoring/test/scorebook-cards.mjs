/**
 * Scorebook cards for the tests (SCRBRD-120): one that adds up, and a fixed
 * list of cards that each break one rule (PARITY). test/summary.test.mjs
 * holds summaryRefusal() to the list; tools/smoke-scorebook.mjs asks
 * summary_reconciles() (db/63) the same questions of the same cards against
 * a live database and compares the two answers, card by card — so the
 * screen's arithmetic and the database's cannot drift.
 *
 * Not a test itself: imported by the two that are.
 */

/** @import { ScorebookCard } from "../src/events.mjs" */

/**
 * The opposition's names as a scorer typed them. Invented, like the seed's.
 * @type {Record<string, string>}
 */
export const TYPED = Object.freeze({
  "t:1": "Opp Fielder One", "t:2": "Opp Bowler Two", "t:3": "Opp Bowler Three",
  "t:4": "Opp Fielder Four", "t:5": "Opp Bowler Five",
});

/**
 * A home innings of 127 for 4 in 20 overs that adds up every way the book
 * can be added: the batters' 116 and 11 extras; 124 off the bowlers with 3
 * byes and leg byes; 120 balls; the fall of wickets in order.
 * @param {string[]} p  six player ids of the home side, batting order
 * @param {string[]} [dnb]  those who did not bat
 * @returns {ScorebookCard}
 */
export function baseCard(p, dnb = []) {
  return {
    v: 1, innings: 0, battingSide: "home",
    batting: [
      { order: 1, ref: p[0], howOut: "caught",  fielderRef: "t:1", bowlerRef: "t:2", runs: 34, balls: 40, fours: 4, sixes: 1 },
      { order: 2, ref: p[1], howOut: "bowled",  fielderRef: null,  bowlerRef: "t:2", runs: 12, balls: 15, fours: 1, sixes: 0 },
      { order: 3, ref: p[2], howOut: "lbw",     fielderRef: null,  bowlerRef: "t:3", runs: 0,  balls: 3,  fours: 0, sixes: 0 },
      { order: 4, ref: p[3], howOut: "run_out", fielderRef: "t:4", bowlerRef: null,  runs: 25, balls: null, fours: null, sixes: null },
      { order: 5, ref: p[4], howOut: "not_out", fielderRef: null,  bowlerRef: null,  runs: 40, balls: 30, fours: 5, sixes: 1 },
      { order: 6, ref: p[5], howOut: "not_out", fielderRef: null,  bowlerRef: null,  runs: 5,  balls: 4,  fours: 0, sixes: 0 },
    ],
    didNotBat: dnb,
    bowling: [
      { ref: "t:2", overs: "8", maidens: 0, runs: 40, wickets: 2, wides: 3, noBalls: 1 },
      { ref: "t:3", overs: "8", maidens: 1, runs: 45, wickets: 1, wides: 2, noBalls: 2 },
      { ref: "t:5", overs: "4", maidens: null, runs: 39, wickets: 0, wides: null, noBalls: null },
    ],
    extras: { byes: 2, legByes: 1, wides: 5, noBalls: 3, penalty: 0 },
    total: 127, wickets: 4, overs: "20",
    fallOfWickets: [
      { wicket: 1, score: 30, ref: p[1], over: "5.1" },
      { wicket: 2, score: 31, ref: p[2], over: "5.3" },
      { wicket: 3, score: 60, ref: p[0], over: "10.2" },
      { wicket: 4, score: 90, ref: p[3], over: "15" },
    ],
    endReason: "overs",
    unreconciled: null,
  };
}

/**
 * Each case: a name, what it does to the base card, and the refusal codes
 * summaryRefusal() and summary_reconciles() answer, sorted, comma-joined.
 * @type {[string, (c: any) => void, string][]}
 */
export const PARITY = [
  ["clean", () => {}, ""],
  ["null extras declared", (c) => { c.extras.wides = null; c.unreconciled = { runs: 5, note: "wides not broken down" }; c.extras.byes = null; c.unreconciled.runs = 7; }, ""],
  ["null boundaries", (c) => { c.batting[0].fours = null; c.batting[0].sixes = null; c.batting[0].balls = null; }, ""],
  ["no fall of wickets", (c) => { c.fallOfWickets = []; }, ""],
  ["stray field", (c) => { c.batting[0].name = "A Name"; }, "card_shape"],
  ["total missing", (c) => { c.total = null; }, "card_shape"],
  ["overs 3.6", (c) => { c.overs = "19.6"; }, "card_shape"],
  ["unknown how out", (c) => { c.batting[1].howOut = "hit_by_bus"; }, "card_shape"],
  ["zero-filled string", (c) => { c.batting[1].runs = "12"; }, "card_shape"],
  ["too many wickets", (c) => { c.wickets = 11; }, "card_shape"],
  ["typed name unknown", (c) => { c.bowling[2].ref = "t:9"; }, "ref_unknown"],
  ["repeated batter", (c) => { c.batting[5].ref = c.batting[4].ref; }, "ref_repeated"],
  ["bowled with no bowler", (c) => { c.batting[1].bowlerRef = null; c.bowling[0].wickets = 1; }, "dismissal_bowler"],
  ["run out with a bowler", (c) => { c.batting[3].bowlerRef = "t:2"; }, "dismissal_bowler"],
  ["batting short", (c) => { c.batting[4].runs = 37; c.fallOfWickets = []; }, "batting_plus_extras"],
  ["difference declared wrong", (c) => { c.batting[4].runs = 37; c.unreconciled = { runs: 2, note: "the book is out" }; }, "unreconciled_wrong"],
  ["difference declared right", (c) => { c.batting[4].runs = 37; c.unreconciled = { runs: 3, note: "the book is out" }; }, ""],
  ["difference declared, none", (c) => { c.unreconciled = { runs: 0, note: "nothing" }; }, "unreconciled_wrong"],
  ["wickets off by one", (c) => { c.wickets = 5; c.fallOfWickets = []; }, "wickets_mismatch"],
  ["bowler wickets", (c) => { c.bowling[1].wickets = 2; }, "bowler_wickets"],
  ["bowling runs", (c) => { c.bowling[2].runs = 38; }, "bowling_plus_byes"],
  ["bowling runs, byes unknown", (c) => { c.bowling[2].runs = 38; c.extras.byes = null; c.unreconciled = { runs: 2, note: "byes not recorded" }; }, ""],
  ["balls", (c) => { c.bowling[2].overs = "3.5"; }, "balls_mismatch"],
  ["boundaries", (c) => { c.batting[5].fours = 2; }, "boundaries_exceed_runs"],
  ["fall of wickets short", (c) => { c.fallOfWickets.pop(); }, "fall_of_wickets"],
  ["fall of wickets falling", (c) => { c.fallOfWickets[2].score = 20; }, "fall_of_wickets"],
  ["fall of wickets past total", (c) => { c.fallOfWickets[3].score = 200; }, "fall_of_wickets"],
];
