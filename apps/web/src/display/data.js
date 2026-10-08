import { deriveMatch } from "@scrbrd/scoring";
import { boardBall, boardFromInnings } from "../scorer/boardData.js";
import { RR, fmtOv, isOut } from "../scorer/format.js";
import { boardInnings, inningsBreak, oversOf, revisionNotice, sidesOf, teamOf } from "../lib/matchCentre.js";
import { chaseOf, matchInningsOf, superOverInPlay, superOverTitle, superOversOf } from "../lib/superOver.js";
import { chaseRates, rainTouched, rateTrack, reportFor } from "../lib/par.js";

/**
 * What the ground display shows, from the fold (SCRBRD-133 §2.2) — pure, so
 * apps/web/test/rotation.test.mjs proves it over built logs without a browser.
 *
 * Every figure is the fold's (deriveMatch over the log the display was given:
 * the public projection on /display, the signed-in log on the Match Centre's
 * big screen). Every name is the innings' own — on /display the public
 * projection's label ("D Erasmus", or "Batter"), decided on the server (D3) —
 * and nothing here adds one, asks for one or says a reason: a retirement is
 * not a card (D8), a stop says rain or light and nothing about a boy.
 */

// ── What is on the board, and what holds ──

/**
 * The state the display draws: which innings is on the Board, its target and
 * overs, what holds the panel area (§2.2: pre-toss, innings break, result,
 * stopped), and which of the cycle's panels have something to show.
 * @param {{match: any, innings: any[], settled?: boolean}} o
 *   `innings` the fold's, played; `settled` the result stands (play has decided it)
 */
export function displayState({ match, innings, settled = false }) {
  const played = (innings ?? []).filter(Boolean);
  const complete = match?.status === "complete" || match?.status === "abandoned";
  const { index, atBreak } = boardInnings(played, settled ? {} : null);
  const inn = played[index] ?? null;
  const chase = chaseOf(played, index);
  const target = chase ? chase.target : null;
  const overs = inn?.overs ?? match?.overs ?? 20;
  /** @type {string | null} */
  let hold = null;
  if ((settled || complete) && played.length && !superOverInPlay(played, match?.status)) hold = "result";
  else if (inn?.stopped) hold = "stopped";
  else if (atBreak) hold = "break";
  else if (!played.length) hold = "pretoss";
  return { played, index, inn, target, overs, hold, available: availablePanels(inn) };
}

/**
 * Which panels of the cycle have something true to show (§2.2's "skipped
 * when"): the worm once an over is complete (G2), the partnership while a
 * pair is in, the over story once an over is complete, the bowling once a
 * ball has been bowled.
 * @param {any} inn  @returns {Set<string>}
 */
export function availablePanels(inn) {
  const out = new Set();
  if (!inn) return out;
  if ((inn.balls ?? 0) >= 6 && inn.summarised == null) out.add("worm");
  if (inn.striker && inn.nonStriker && !inn.complete) out.add("partnership");
  if ((inn.overLog ?? []).some((o) => legalIn(o.balls) >= 6) || inn.balls >= 6) out.add("overs");
  if ((inn.bowlers ?? []).some((b) => b.balls > 0 || b.runs > 0)) out.add("bowling");
  return out;
}

/** @param {any[]} balls */
const legalIn = (balls) => balls.filter((b) => b.type !== "Wd" && b.type !== "Nb" && b.notInOver !== true).length;

/** The Board's props for the innings on it (scorer/boardData.js, as every screen draws it), its second line saying par (G2). */
export function boardOf(state, par = undefined) {
  return state.inn ? boardFromInnings(state.inn, { target: state.target, overs: state.overs, par }) : null;
}

// ── Par and pressure (G2, §3) ──

/**
 * What the Board's second line and the rate track need about par, for the
 * innings on the board: the server's report when it speaks for exactly this
 * position (lib/par.js reportFor()), the chase's two required rates and
 * their direction (the log's own arithmetic, chaseRates()), whether rain
 * touched the match, and the result's words once play has decided it.
 * @param {{state: any, events: any[], fold: any, report: any, result?: string | null, settled?: boolean}} o
 */
export function parOf({ state, events, fold, report, result = null, settled = false }) {
  const inn = state.inn;
  if (!inn) return null;
  const chasing = state.index === 1 && state.target != null && inn.superOver == null;
  return {
    chasing,
    report: reportFor(report, inn, state.index),
    rates: chasing ? chaseRates(events ?? [], fold ?? {}, state.index) : null,
    rained: rainTouched(state.played, inn.conditions ?? null),
    result: settled ? result : null,
  };
}

/** The rate track's ticks (lib/par.js rateTrack()), for the Board band. @param {any} state @param {any} par @param {string | null} side */
export const trackOf = (state, par, side) => (par && state.inn
  ? rateTrack({ inn: state.inn, chasing: par.chasing, target: state.target, overs: state.overs, report: par.report,
                rates: par.rates, rained: par.rained, side }) : null);

// ── Panel 2 · the partnership ──

/** Runs off the bat from one delivery: a run or a wicket ball's value, a no-ball's when it came off the bat. */
const offBat = (b) => {
  const t = b.type ?? "run";
  if (t === "run" || t === "W") return b.value ?? 0;
  if (t === "Nb" && b.nbRuns !== "byes" && b.nbRuns !== "leg_byes") return b.value ?? 0;
  return 0;
};

/**
 * The stand in progress: the pair by label, its runs and balls (the fold's
 * curPartner — extras in, as stands are reported), each batter's share off
 * the bat, its run rate; and the innings' finished stands with the wicket each
 * ended at. Null while there is no pair.
 * @param {any} inn
 */
export function partnershipPanel(inn) {
  const cp = inn?.curPartner;
  if (!inn || !inn.striker || !inn.nonStriker || !cp) return null;
  const pair = [inn.striker, inn.nonStriker];
  // Each batter's share: what he made off the bat since the stand began —
  // the deliveries back to the last wicket, faced by one of the pair.
  const share = new Map(pair.map((id) => [id, { runs: 0, balls: 0 }]));
  const log = inn.ballLog ?? [];
  for (let i = log.length - 1; i >= 0; i--) {
    const b = log[i];
    if (isOut(b) || !share.has(b.strikerId)) break;
    const s = share.get(b.strikerId);
    s.runs += offBat(b);
    if (b.type !== "Wd") s.balls += 1;
  }
  const who = (id) => {
    const b = (inn.batsmen ?? []).find((x) => x.id === id);
    return { id, name: b?.name ?? "Batter", runs: share.get(id).runs, balls: share.get(id).balls };
  };
  return {
    wicket: (inn.wickets ?? 0) + 1,
    runs: cp.runs, balls: cp.balls, rate: RR(cp.runs, cp.balls),
    batters: pair.map(who),
    extras: Math.max(0, cp.runs - pair.reduce((t, id) => t + share.get(id).runs, 0)),
    earlier: (inn.partnerships ?? []).map((p) => ({ wicket: p.wicket, runs: p.runs, balls: p.balls, names: `${p.bat1} and ${p.bat2}` })),
  };
}

// ── Panel 3 · the over story (static rows, §6.2's display form) ──

/**
 * The innings' score at the end of each over, by folding the log to that
 * over's last delivery — exact, penalties and all, because it is the fold's
 * own figure and not a sum made here. `events` the match's log as folded;
 * `n` the innings' place in the match.
 * @param {any[]} events  @param {any} fold  @param {number} n  @param {any} inn  @param {number[]} overs
 * @returns {Map<number, {runs: number, wickets: number}>}
 */
export function scoresAtOverEnds(events, fold, n, inn, overs) {
  const out = new Map();
  if (!events?.length || !inn) return out;
  const voided = new Set(events.filter((e) => e.kind === "void").map((e) => e.target));
  const at = new Map(events.map((e, i) => [e.id, i]));
  for (const over of overs) {
    const balls = (inn.overLog ?? []).find((o) => o.over === over)?.balls ?? [];
    const last = balls[balls.length - 1];
    const i = last ? at.get(last.id) : undefined;
    if (i == null) continue;
    const prefix = events.slice(0, i + 1).filter((e) => e.kind !== "void" && !voided.has(e.id));
    const f = deriveMatch(prefix, fold ?? {}).innings[n];
    if (f) out.set(over, { runs: f.runs, wickets: f.wickets });
  }
  return out;
}

/**
 * The last six overs, newest first: the over's number, its bowler by label,
 * its balls as the Board's chips, its runs and wickets ("7 · 1W"; a maiden
 * "M", a wicket maiden "WM") and the score after it. The over in progress is
 * the first row, with the score as it stands.
 * @param {any} inn  @param {{events?: any[], fold?: any, n?: number, rows?: number}} [o]
 */
export function overRows(inn, { events = [], fold = {}, n = 0, rows = 6 } = {}) {
  if (!inn) return [];
  const log = (inn.overLog ?? []).slice(-rows).reverse();
  const done = log.filter((o) => legalIn(o.balls) >= 6).map((o) => o.over);
  const scores = scoresAtOverEnds(events, fold, n, inn, done);
  const nameOf = (id) => (inn.bowlers ?? []).find((b) => b.id === id)?.name ?? "Bowler";
  return log.map((o, k) => {
    const runs = o.balls.reduce((t, b) => t + (b.type === "Wd" || b.type === "Nb" ? 1 : 0) + (b.value ?? 0), 0);
    const wickets = o.balls.filter(isOut).length;
    const complete = legalIn(o.balls) >= 6;
    const conceded = o.balls.reduce((t, b) => t + (b.type === "Wd" || b.type === "Nb" ? 1 : 0)
      + (b.type === "B" || b.type === "LB" || (b.type === "Nb" && (b.nbRuns === "byes" || b.nbRuns === "leg_byes")) ? 0 : (b.value ?? 0)), 0);
    const maiden = complete && conceded === 0;
    const figure = maiden ? (wickets ? "WM" : "M") : `${runs}${wickets ? ` · ${wickets}W` : ""}`;
    const score = complete ? scores.get(o.over) : k === 0 ? { runs: inn.runs, wickets: inn.wickets } : null;
    const bowlers = [...new Set(o.balls.map((b) => b.bowlerId).filter(Boolean))];
    return {
      over: o.over + 1, current: !complete && k === 0,
      bowler: bowlers.length ? bowlers.map(nameOf).join(", ") : "Bowler",
      chips: o.balls.map(boardBall), figure, runs, wickets,
      score: score ? `${score.runs}/${score.wickets}` : null,
    };
  });
}

// ── Panel 4 · bowling ──

/**
 * The bowler on — or, between overs, the one who bowled last — with his
 * figures, economy and his overs as rows of chips; the other bowlers' figures
 * as a table, in the order they came on.
 * @param {any} inn
 */
export function bowlingPanel(inn) {
  const bowlers = (inn?.bowlers ?? []).filter((b) => b.balls > 0 || b.runs > 0);
  if (!bowlers.length) return null;
  const lastBall = (inn.ballLog ?? []).at(-1);
  const onId = inn.bowler ?? lastBall?.bowlerId ?? bowlers[bowlers.length - 1].id;
  const on = bowlers.find((b) => b.id === onId) ?? bowlers[bowlers.length - 1];
  const fig = (b) => ({ id: b.id, name: b.name, overs: fmtOv(b.balls), maidens: b.maidens ?? 0, runs: b.runs, wickets: b.wickets,
    economy: RR(b.runs, b.balls) });
  const his = (inn.overLog ?? [])
    .map((o) => ({ over: o.over + 1, chips: o.balls.filter((b) => b.bowlerId === on.id).map(boardBall) }))
    .filter((o) => o.chips.length).slice(-4).reverse();
  return { on: { ...fig(on), current: inn.bowler === on.id, overs: fmtOv(on.balls) }, his, others: bowlers.filter((b) => b !== on).map(fig) };
}

// ── Panel 7 · the fall of a wicket (an interrupt) ──

/**
 * The wicket that just fell: the batter's label, his score and how he was
 * out (the scorecard's line), the stand that ended, the score at the fall,
 * and the new batter once he is in. Null before the first wicket.
 * @param {any} inn
 */
export function fallOfWicket(inn) {
  const f = (inn?.fow ?? []).at(-1);
  if (!f) return null;
  const out = [...(inn.batsmen ?? [])].reverse().find((b) => b.status === "out" && b.name === f.batsman)
    ?? [...(inn.batsmen ?? [])].reverse().find((b) => b.status === "out");
  const stand = (inn.partnerships ?? []).at(-1) ?? null;
  const ended = stand ? new Set([stand.bat1, stand.bat2]) : new Set();
  const newcomer = [inn.striker, inn.nonStriker].map((id) => (inn.batsmen ?? []).find((b) => b.id === id))
    .find((b) => b && !ended.has(b.name) && (b.balls ?? 0) === 0) ?? null;
  return {
    wicket: f.wickets, score: `${f.runs}/${f.wickets}`, overs: f.overs,
    batter: out ? { name: out.name, runs: out.runs, balls: out.balls, how: out.dismissal ?? null } : { name: f.batsman, runs: null, balls: null, how: null },
    stand: stand ? { runs: stand.runs, balls: stand.balls, names: `${stand.bat1} and ${stand.bat2}` } : null,
    next: newcomer ? newcomer.name : null,
  };
}

// ── Panel 8 · the innings break ──

/**
 * The chase's target in words, then the first innings' four facts
 * (lib/matchCentre.js inningsBreak, as the Summary tab's card has them).
 * @param {any} match  @param {any[]} played
 */
export function breakPanel(match, played) {
  const first = played[0];
  if (!first) return null;
  const chase = chaseOf(played, 1);
  const target = chase?.target ?? first.runs + 1;
  return {
    words: `${teamOf(match, first.bowlingTeam).full} need ${target} to win from ${first.overs ?? match?.overs ?? 20} overs`,
    line: `${teamOf(match, first.battingTeam).full} ${first.runs}/${first.wickets} (${oversOf(first.balls)})`,
    facts: inningsBreak(first),
  };
}

// ── Panel 9 · the result ──

/**
 * The result's words, each of the match's innings as a line, and a super
 * over's block under them when there was one.
 * @param {any} match  @param {any[]} played  @param {string | null} words  the result as the page says it
 */
export function resultPanel(match, played, words) {
  const own = matchInningsOf(played);
  return {
    words: words ?? null,
    lines: own.map((inn) => `${teamOf(match, inn.battingTeam).full} ${inn.runs}/${inn.wickets} (${oversOf(inn.balls)})`),
    superOvers: superOversOf(played).map((p) => ({
      title: superOverTitle(p.n),
      lines: p.innings.map((inn) => `${teamOf(match, inn.battingTeam).full} ${inn.runs}/${inn.wickets}`),
    })),
  };
}

// ── Panel 10 · stopped ──

/** "14:32", Johannesburg time, or null. @param {number | null | undefined} ms */
export function clockAt(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
  } catch { return null; }
}

/**
 * "Play stopped (rain) at 12.3 ov, 87/3, 14:32", and the revised figures
 * where the umpires set them (revisionNotice, as the banner says it).
 * @param {any} inn
 */
export function stoppedPanel(inn) {
  const s = inn?.stopped;
  if (!s) return null;
  const why = { rain: "rain", bad_light: "bad light", wet_ground: "a wet ground" }[s.reason] ?? null;
  const at = clockAt(s.at);
  return {
    words: `Play stopped${why ? ` (${why})` : ""} at ${s.over}.${s.ball} ov, ${s.runs}/${s.wickets}${at ? `, ${at}` : ""}`,
    revised: inn.revised && (inn.revised.overs != null || inn.revised.target != null) ? revisionNotice({ ...inn, stopped: null })?.text ?? null : null,
  };
}

// ── Panel 11 · before the toss ──

/** The sides, the ground, the start and the format, from the header. @param {any} match */
export function pretossPanel(match) {
  const sides = sidesOf(match);
  let start = null;
  if (match?.startsAt) {
    try {
      start = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", weekday: "long", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(match.startsAt));
    } catch { start = null; }
  }
  return {
    sides: `${sides.home.full} v ${sides.away.full}`,
    rows: [["Ground", match?.venue ?? null], ["Start", start],
      ["Format", [match?.format, match?.overs ? `${match.overs} overs a side` : null].filter(Boolean).join(" · ") || null]]
      .filter(([, v]) => v),
  };
}

// ── The settings in the URL (D14) ──

/**
 * The display's three settings, from its address: `?theme=daylight`,
 * `?dwell=long`, `?motion=reduce`. Anything else is the default — Floodlit,
 * Normal, motion on. Nothing is stored and nothing is counted (§1.3).
 * @param {string} search  location.search
 */
export function displaySettings(search) {
  const q = new URLSearchParams(search ?? "");
  return {
    theme: q.get("theme") === "daylight" ? "daylight" : "floodlit",
    dwell: q.get("dwell") === "long" ? "long" : "normal",
    reduceMotion: q.get("motion") === "reduce",
  };
}

/**
 * The display's address with its settings, for the setup section's link and
 * QR code. Defaults are left out, so the plain link is the plain address.
 * @param {string} origin  @param {string} matchId  @param {{theme?: string, dwell?: string, reduceMotion?: boolean}} s
 */
export function displayUrl(origin, matchId, s = {}) {
  const q = new URLSearchParams();
  if (s.theme === "daylight") q.set("theme", "daylight");
  if (s.dwell === "long") q.set("dwell", "long");
  if (s.reduceMotion) q.set("motion", "reduce");
  const qs = q.toString();
  return `${origin}/display/${matchId}${qs ? `?${qs}` : ""}`;
}

/**
 * Daylight's board.dim (§2.6, D14; A6: to be measured on a real pavilion TV
 * in sun). About 10:1 on the board's face where board.dim is 6.3:1. The
 * board's black, white and lime do not move (DESIGN_DIRECTION decision 6).
 */
export const DAYLIGHT_DIM = "#b8c0cc";
