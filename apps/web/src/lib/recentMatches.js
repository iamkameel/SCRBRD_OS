/**
 * THE COACH'S RECENT MATCHES (pilot item 5, "a small coach view: runs,
 * wickets, match history and one or two trustworthy insights"): the plain
 * parts of the Dashboard's "Recent matches" card
 * (views/cockpit/RecentMatches.jsx).
 *
 * NOTHING HERE DECIDES WHAT ANYBODY MAY READ. The card is offered by the
 * cockpit's own gate (lib/cockpit.js cockpitGate: one school- or team-scoped
 * assignment on the side that grants team.select or player.workload.read,
 * never a title, never a guardian's or a pupil's, D1), and the boys' figures
 * only where that assignment also grants player.performance.read. Every
 * figure comes from two reads the Match Centre already makes, decided again
 * by the database for this reader:
 *
 *   GET /api/matches/:id/result  match_result(): the result in words and each
 *                                side's total, by home and away
 *   GET /api/matches/:id/events  the log, folded by deriveMatch(): the
 *                                scorecard's batting and bowling lines
 *
 * Both are the log as it stands, so an approved correction moves every figure
 * here on the next read, as it moves the scorecard (GA-I36). Nothing is
 * stored and nothing is sent: the card notifies nobody (D11).
 *
 * OUR BOYS ONLY (D8). A batting line is counted only from an innings our side
 * batted, a bowling line only from one our side fielded in; the other
 * school's players are never named, summed or ranked. Which side an innings
 * is comes from the result read (the server's `side`), and only where it has
 * no answer from the fold's own reading of the innings (ourInnings).
 *
 * Nothing here reads an injury, a wellness flag, a load or a reason (D4, D5):
 * runs, balls, wickets and the result, and no other field.
 *
 * Pure: proved under plain node (apps/web/test/recentMatches.test.mjs).
 */
import { cockpitGate, ourInnings, oversOf, startMs } from "./cockpit.js";
import { COMPARE_FLOOR, floorRate } from "./compare.js";

/** How many finished matches the card covers. */
export const RECENT_LIMIT = 3;

/** How many boys each list names. */
export const LEADERS = 3;

/**
 * @typedef {{match: any, gate: NonNullable<ReturnType<typeof cockpitGate>>}} Pick
 * @typedef {{key: string, school: string, teamCode: string | null, picks: Pick[], figures: boolean}} Side
 */

/**
 * The reader's sides and each one's last few finished matches, newest first.
 * A match is finished when the fixture read says so and it was not called off
 * (an abandoned fixture is read as complete, lib/live.js asMatch). A side is
 * the school and team the gate named; a coach with two sides gets two, the
 * side of his latest match first. `figures` is whether every one of the
 * side's matches was admitted under player.performance.read (the gate's
 * `matchups` panel), so a list never mixes matches it may count with ones it
 * may not.
 * @param {any[] | null | undefined} matches  the fixture read, adapted
 * @param {Parameters<typeof cockpitGate>[0]} assignments  the session's
 * @param {{limit?: number}} [o]
 * @returns {Side[]}
 */
export function recentSides(matches, assignments, { limit = RECENT_LIMIT } = {}) {
  const done = (matches ?? []).filter((m) => m?.id && m.status === "complete" && !m.calledOff)
    .sort((a, b) => (startMs(b) ?? 0) - (startMs(a) ?? 0) || String(a.id).localeCompare(String(b.id)));
  /** @type {Map<string, Side>} */
  const sides = new Map();
  for (const match of done) {
    const gate = cockpitGate(assignments, match);
    if (!gate || !gate.panels.day) continue;
    const key = `${gate.school}|${gate.teamCode ?? ""}`;
    const side = sides.get(key) ?? { key, school: gate.school, teamCode: gate.teamCode, picks: [], figures: true };
    if (side.picks.length < limit) {
      side.picks.push({ match, gate });
      side.figures = side.figures && gate.panels.matchups === true;
    }
    sides.set(key, side);
  }
  return [...sides.values()];
}

/** "172/2 (16 ov)": a total as the board says it. @param {{runs: number, wickets: number, balls?: number | null}} t */
export function totalWords(t) {
  const score = t.wickets >= 10 ? `${t.runs} all out` : `${t.runs}/${t.wickets}`;
  return t.balls != null && t.balls > 0 ? `${score} (${oversOf(t.balls)} ov)` : score;
}

/**
 * One side's totals from the result read, its innings in order, super overs
 * left out (they are the tie's, not the side's total). Null when the side has
 * no innings on the log.
 * @param {any} route  GET /api/matches/:id/result's answer
 * @param {"home" | "away"} side
 */
function sideTotal(route, side) {
  const inns = (route?.innings ?? []).filter((i) => i && i.superOver == null && i.side === side)
    .sort((a, b) => a.innings - b.innings);
  return inns.length ? inns.map((i) => totalWords({ runs: i.runs ?? 0, wickets: i.wickets ?? 0, balls: i.balls ?? null })).join(" & ") : null;
}

/**
 * Which of the fold's innings our side batted in and which it fielded in:
 * the result read's `side` for that innings number where it gives one, else
 * the fold's own reading (ourInnings, by the name the innings carries). An
 * innings neither can place is neither, and nothing is counted from it.
 * @param {any} match  @param {"home" | "away"} end  @param {any[]} innings  the fold's
 * @param {any} route  the result read, or null when it failed
 * @returns {{inn: any, side: "batting" | "bowling"}[]}
 */
export function placedInnings(match, end, innings, route) {
  /** @type {Map<number, string>} */
  const said = new Map((route?.innings ?? []).filter((i) => i && i.superOver == null && (i.side === "home" || i.side === "away"))
    .map((i) => [Number(i.innings), i.side]));
  return ourInnings(match, end, innings ?? [], new Set()).flatMap(({ inn, i, side }) => {
    if (!inn || inn.superOver != null) return [];
    const s = said.get(i);
    const placed = s ? (s === end ? "batting" : "bowling") : side;
    return placed ? [{ inn, side: placed }] : [];
  });
}

/**
 * @typedef {{id: string, name: string, runs: number, balls: number | null, innings: number,
 *            wickets: number, ballsBowled: number | null, conceded: number, bowled: number}} Boy
 * @typedef {{id: string, date: string | null, opponent: string, result: string | null, resultRead: boolean,
 *            ours: string | null, theirs: string | null, carded: boolean, correctedAt: number | null}} Line
 */

/**
 * One finished match, in words, and our boys' lines from its scorecard.
 * @param {{match: any, end: "home" | "away", theirName: string, route: any, innings: any[] | null, correctedAt?: number | null}} o
 *   `route`: the result read, null when it failed; `innings`: the fold's, null when the log could not be read
 * @returns {{line: Line, boys: Boy[]}}
 */
export function matchSummary({ match, end, theirName, route, innings, correctedAt = null }) {
  const other = end === "home" ? "away" : "home";
  /** @type {Map<string, Boy>} */
  const boys = new Map();
  const boy = (/** @type {any} */ p) => {
    let b = boys.get(p.id);
    if (!b) { b = { id: p.id, name: p.name, runs: 0, balls: 0, innings: 0, wickets: 0, ballsBowled: 0, conceded: 0, bowled: 0 }; boys.set(p.id, b); }
    return b;
  };
  for (const { inn, side } of innings ? placedInnings(match, end, innings, route) : []) {
    if (side === "batting") {
      for (const p of inn.batsmen ?? []) {
        if (!p?.id) continue;
        const b = boy(p);
        b.runs += p.runs ?? 0;
        // A scorebook innings may not have recorded balls (SUMMARY_NULLS): then the sum is unknown, never a smaller number.
        b.balls = b.balls == null || p.balls == null ? null : b.balls + p.balls;
        b.innings += 1;
      }
    } else {
      for (const p of inn.bowlers ?? []) {
        if (!p?.id || !((p.balls ?? 0) > 0 || (p.wickets ?? 0) > 0)) continue;
        const b = boy(p);
        b.wickets += p.wickets ?? 0;
        b.conceded += p.runs ?? 0;
        b.ballsBowled = b.ballsBowled == null || p.balls == null ? null : b.ballsBowled + p.balls;
        b.bowled += 1;
      }
    }
  }
  return {
    line: {
      id: match.id, date: match.date ?? null, opponent: theirName,
      result: route ? (route.result?.text ?? null) : null, resultRead: !!route,
      ours: route ? sideTotal(route, end) : null, theirs: route ? sideTotal(route, other) : null,
      carded: boys.size > 0, correctedAt,
    },
    boys: [...boys.values()],
  };
}

/**
 * Our boys across the matches: each boy's lines summed, every boy who batted
 * by runs and every boy who took a wicket by wickets (the card names the
 * first LEADERS of each). Ties: fewer balls, then fewer runs conceded, then
 * the name, so the same log always reads the same.
 * @param {Boy[][]} perMatch
 */
export function leaders(perMatch) {
  /** @type {Map<string, Boy>} */
  const all = new Map();
  for (const list of perMatch) {
    for (const b of list) {
      const a = all.get(b.id);
      if (!a) { all.set(b.id, { ...b }); continue; }
      a.runs += b.runs; a.innings += b.innings; a.wickets += b.wickets; a.conceded += b.conceded; a.bowled += b.bowled;
      a.balls = a.balls == null || b.balls == null ? null : a.balls + b.balls;
      a.ballsBowled = a.ballsBowled == null || b.ballsBowled == null ? null : a.ballsBowled + b.ballsBowled;
    }
  }
  const boys = [...all.values()];
  const batting = boys.filter((b) => b.innings > 0)
    .sort((a, b) => b.runs - a.runs || (a.balls ?? Infinity) - (b.balls ?? Infinity) || a.name.localeCompare(b.name));
  const bowling = boys.filter((b) => b.bowled > 0 && b.wickets > 0)
    .sort((a, b) => b.wickets - a.wickets || a.conceded - b.conceded || a.name.localeCompare(b.name));
  return { batting, bowling };
}

/** "42 (31 balls)" @param {Boy} b */
export const battingWords = (b) => `${b.runs} (${b.balls == null ? "balls not recorded" : `${b.balls} ${b.balls === 1 ? "ball" : "balls"}`})`;

/** "3 for 41 (8 ov)" @param {Boy} b */
export const bowlingWords = (b) => `${b.wickets} for ${b.conceded}${b.ballsBowled != null ? ` (${oversOf(b.ballsBowled)} ov)` : ""}`;

/**
 * The card's insights: at most two, each a plain count over the matches the
 * card shows, and a rate only where COMPARE_FLOOR (thirty legal balls, the
 * floor Compare and the matchups keep) stands behind it; under it the rate
 * is not drawn and the sentence says why. A tie at the top is said as a tie,
 * never broken for the sentence's sake.
 * @param {ReturnType<typeof leaders>} top  @param {number} n  how many matches the card shows
 * @returns {{key: "bat" | "bowl", text: string, rate: string}[]}
 */
export function insights(top, n) {
  const over = `over the last ${n === 1 ? "match" : `${n} matches`}`;
  /** @type {{key: "bat" | "bowl", text: string, rate: string}[]} */
  const out = [];
  const bat = top.batting[0];
  if (bat && bat.runs > 0) {
    const level = top.batting.filter((b) => b.runs === bat.runs);
    if (level.length > 1) {
      out.push({ key: "bat", text: `Top scorers ${over}: ${level.map((b) => b.name).join(" and ")}, ${bat.runs} runs each.`, rate: "" });
    } else {
      const balls = bat.balls == null ? "balls not recorded" : `${bat.balls} ${bat.balls === 1 ? "ball" : "balls"}`;
      const sr = floorRate(bat.balls ? (100 * bat.runs) / bat.balls : null, bat.balls, 1);
      out.push({ key: "bat", text: `Top scorer ${over}: ${bat.name}, ${bat.runs} runs from ${balls}.`,
        rate: sr.held ? rateHeld(bat.balls, "strike rate") : `Strike rate ${sr.text}.` });
    }
  }
  const bowl = top.bowling[0];
  if (bowl && bowl.wickets > 0) {
    const level = top.bowling.filter((b) => b.wickets === bowl.wickets && b.conceded === bowl.conceded);
    if (level.length > 1) {
      out.push({ key: "bowl", text: `Most wickets ${over}: ${level.map((b) => b.name).join(" and ")}, ${bowl.wickets} for ${bowl.conceded} each.`, rate: "" });
    } else {
      const econ = floorRate(bowl.ballsBowled ? (6 * bowl.conceded) / bowl.ballsBowled : null, bowl.ballsBowled, 2);
      out.push({ key: "bowl", text: `Most wickets ${over}: ${bowl.name}, ${bowlingWords(bowl)}.`,
        rate: econ.held ? rateHeld(bowl.ballsBowled, "economy rate") : `Economy ${econ.text} an over.` });
    }
  }
  return out;
}

/** Why a rate is not drawn: under the floor, or the balls were never recorded. @param {number | null} balls @param {string} what */
function rateHeld(balls, what) {
  return balls == null ? `No ${what}: the balls were not recorded.`
    : `No ${what}: ${balls} ${balls === 1 ? "ball" : "balls"} is fewer than the ${COMPARE_FLOOR} a rate needs.`;
}
