/**
 * THE MATCH CARD, as words (redesign slice 1; DESIGN_DIRECTION §2.2).
 *
 * One match, said the one way on every signed-in screen: its state, both
 * sides with their scores, and the status sentence. ui/matchCard.jsx draws
 * it in three sizes (a row, a card, a board); this decides what it says, and
 * is pure, so the rules are tested without a browser
 * (apps/web/test/match-card.test.mjs).
 *
 * NOTHING HERE READS. Every figure is one the screen already had: a fold of
 * the ball log it already made, the result route's innings it already asked
 * for, or a demo scorecard line. A screen with no score passes none, and the
 * card draws the sides without one; it never guesses.
 *
 * The rules (§2.2):
 *   - "Live" comes from the match's one status (db/165), never worked out
 *     here. A live match whose log already holds a result is "Provisional":
 *     never "Live", never "Upcoming".
 *   - Overs carry their unit: "50/0 · 7 overs", never a bare "7".
 *   - The reader's own side first where he has one (the read's `mySide`, or
 *     the end a screen names); otherwise the home side.
 *   - The sentence is statusSentence()'s (lib/matchCentre.js), the one
 *     function there is.
 */
import { humanDate } from "./format.js";
import { sideOfTeam, sidesOf, statusSentence } from "./matchCentre.js";

/** "1 over", "7 overs", "7.2 overs" from balls bowled. @param {number} balls */
export function oversWords(balls) {
  if (!Number.isFinite(balls) || balls < 0) return null;
  const o = Math.floor(balls / 6), b = balls % 6;
  const figure = b ? `${o}.${b}` : String(o);
  return `${figure} ${figure === "1" ? "over" : "overs"}`;
}

/** "14.2" (the scorer's own writing) → "14.2 overs". @param {string | number | null | undefined} overs */
function oversText(overs) {
  if (overs == null || overs === "") return null;
  const s = String(overs).trim().replace(/\s*ov(er)?s?$/i, "");
  if (!/^\d+(\.\d)?$/.test(s)) return null;
  return `${s} ${s === "1" ? "over" : "overs"}`;
}

/**
 * One side's score in words: "50/0 · 7 overs", "143/10 · 20 overs", "128".
 * Null where there is no figure. A side with two innings says both runs,
 * "120 & 50/2 · 18 overs", the overs being the latest innings'.
 * @param {{runs?: number | null, wickets?: number | null, balls?: number | null, overs?: string | number | null}[]} inns
 * @returns {string | null}
 */
export function scoreWords(inns) {
  const list = (inns ?? []).filter((i) => i && Number.isFinite(i.runs));
  if (!list.length) return null;
  const one = (/** @type {any} */ i, /** @type {boolean} */ last) => {
    const all = Number.isFinite(i.wickets) && i.wickets >= 10;
    // A finished innings that was all out reads its runs alone in a pair ("120 & 50/2"); the latest keeps its wickets.
    if (!last && (all || i.complete)) return String(i.runs);
    return Number.isFinite(i.wickets) ? `${i.runs}/${i.wickets}` : String(i.runs);
  };
  const runs = list.map((i, n) => one(i, n === list.length - 1)).join(" & ");
  const latest = list[list.length - 1];
  const ov = Number.isFinite(latest.balls) ? oversWords(/** @type {number} */ (latest.balls)) : oversText(latest.overs);
  return ov ? `${runs} · ${ov}` : runs;
}

/**
 * Which end an innings belongs to: the result route's own `side`, else the
 * fold's batting side named as the fixture names it.
 * @param {any} match  @param {any} inn  @returns {"home" | "away" | null}
 */
function endOfInnings(match, inn) {
  if (inn?.side === "home" || inn?.side === "away") return inn.side;
  return sideOfTeam(match, inn?.battingTeam ?? inn?.team ?? null);
}

/**
 * Both sides' scores from innings the screen already has: a fold's (with
 * `battingTeam`) or the result route's (with `side`). Super overs are not
 * the match's score and are left out. `batting` is the side in at the
 * crease, only while the match is live and its innings is still open.
 * @param {any} match  @param {any[] | null | undefined} innings
 * @returns {{home: string | null, away: string | null, batting: "home" | "away" | null}}
 */
export function scoresOf(match, innings) {
  const played = (innings ?? []).filter((i) => i && i.superOver == null);
  /** @type {{home: any[], away: any[]}} */
  const by = { home: [], away: [] };
  let unplaced = 0;
  for (const inn of played) {
    let end = endOfInnings(match, inn);
    // An innings whose side cannot be named: the first is the home side's
    // unless the other is known, the second the other side's.
    if (!end) end = unplaced++ === 0 && !by.home.length ? "home" : "away";
    by[end].push(inn);
  }
  const last = played[played.length - 1] ?? null;
  const open = match?.status === "live" && last && !last.complete;
  return {
    home: scoreWords(by.home),
    away: scoreWords(by.away),
    batting: open ? (endOfInnings(match, last) ?? (by.home.includes(last) ? "home" : "away")) : null,
  };
}

/**
 * A demo fixture's scorecard line ({ score: "142/6", overs: "20" }) as the
 * card's score. The demo has no fold; this is its one figure.
 * @param {{score?: string, overs?: string | number} | null | undefined} line
 */
export function demoScore(line) {
  if (!line?.score) return null;
  const ov = oversText(line.overs);
  return ov ? `${line.score} · ${ov}` : String(line.score);
}

/** When the match starts, as an instant: the read's own `startsAt`, else its SA day and time. @param {any} m */
function startOf(m) {
  if (m?.startsAt) { const t = Date.parse(m.startsAt); if (Number.isFinite(t)) return t; }
  if (!m?.date) return null;
  // `date` and `time` are SA's clock (UTC+2, no daylight saving).
  const t = Date.parse(`${m.date}T${m.time || "00:00"}:00+02:00`);
  return Number.isFinite(t) ? t : null;
}

/**
 * "in 12 min", in the last hour before the start of a match still to come;
 * null otherwise. @param {any} match  @param {number} now
 */
export function startsIn(match, now) {
  if (match?.status !== "upcoming") return null;
  const t = startOf(match);
  if (t == null) return null;
  const mins = Math.ceil((t - now) / 60e3);
  if (mins <= 0 || mins > 60) return null;
  return `in ${mins} min`;
}

/**
 * The card's state line, left: "Live", "Sat 21 Nov · 17:25", "Result",
 * "Provisional", "Postponed", "Called off".
 * @param {any} match
 * @param {{state: string}} sentence  statusSentence()'s
 * @param {"provisional" | "official" | "review" | null} [official]  the result's state, where the screen has read it
 * @returns {{kind: "live" | "upcoming" | "provisional" | "result" | "postponed" | "off", words: string}}
 */
export function stateOf(match, sentence, official = null) {
  const status = match?.status;
  if (status === "postponed") return { kind: "postponed", words: "Postponed" };
  if (match?.calledOff || status === "abandoned") return { kind: "off", words: "Called off" };
  if (status === "live") {
    // A result on the pad, not yet confirmed: provisional, never "Live" (§2.2).
    return sentence?.state === "result" ? { kind: "provisional", words: "Provisional" } : { kind: "live", words: "Live" };
  }
  if (status === "complete") {
    return official === "provisional" || official === "review" ? { kind: "provisional", words: "Provisional" } : { kind: "result", words: "Result" };
  }
  const day = match?.date ? humanDate(match.date) : null;
  return { kind: "upcoming", words: [day, match?.time || null].filter(Boolean).join(" · ") || "To be arranged" };
}

/**
 * Everything the card says, in order.
 *
 * @param {{
 *   match: any,
 *   fold?: {innings?: any[], result?: any, conditions?: any} | null,   a fold of the log the screen already made
 *   innings?: any[] | null,     innings for the scores alone (the result route's), where there is no fold
 *   resultSaid?: string | null,  the result route's words, where the screen read them
 *   scores?: {home?: string | null, away?: string | null, batting?: "home" | "away" | null} | null,  scores already in words (the demo's)
 *   ownEnd?: "home" | "away" | null,   the reader's own end; the read's `mySide` when not given
 *   official?: "provisional" | "official" | "review" | null,
 *   now?: number,
 * }} p
 */
export function cardModel({ match, fold = null, innings = null, resultSaid = null, scores = null, ownEnd = null, official = null, now = Date.now() }) {
  const sentence = statusSentence(match, fold && fold.innings?.length ? fold : null, { result: resultSaid });
  const state = stateOf(match, sentence, official);
  const got = scores ?? scoresOf(match, fold?.innings?.length ? fold.innings : innings);
  const names = sidesOf(match);
  const first = ownEnd ?? (match?.mySide === "away" ? "away" : "home");
  const order = first === "away" ? ["away", "home"] : ["home", "away"];
  const sides = order.map((end) => ({
    end, name: names[/** @type {"home" | "away"} */ (end)],
    score: got?.[/** @type {"home" | "away"} */ (end)] ?? null,
    batting: state.kind === "live" && got?.batting === end,
  }));
  // §2.2's table: an upcoming match says where, "Starts at 17:25 · Hilton Oval", the ground being the read's own.
  const text = state.kind === "provisional" && sentence.state === "result" && !/provisional/i.test(sentence.text)
    ? `${sentence.text} · provisional`
    : sentence.state === "upcoming" && match?.venue ? `${sentence.text} · ${match.venue}` : sentence.text;
  return { state, soon: startsIn(match, now), sides, sentence: { state: sentence.state, text } };
}

/**
 * The action's words, named for the match: "Open v Westville 1XI". The other
 * side is the one that is not the reader's.
 * @param {any} match  @param {"home" | "away" | null} [ownEnd]
 */
export function openWords(match, ownEnd = null) {
  const names = sidesOf(match);
  const mine = ownEnd ?? (match?.mySide === "away" ? "away" : "home");
  return `Open v ${mine === "away" ? names.home.full : names.away.full}`;
}
