import { formatKind } from "@scrbrd/scoring";
import { RR, fmtOv } from "./format.js";

/**
 * What the board shows, from the fold — pure, and light enough for any screen
 * to import without the pad behind it (the day sheet does; the pad re-exports
 * these from scorer/pad.jsx). DESIGN_DIRECTION §1: the score is drawn one way
 * everywhere, so it is worked out one way everywhere too.
 */

/**
 * The balls of an over as the board writes them, each of which Board draws as
 * a chip (ui/board.jsx chipFor): "·", "1"–"6", "W", and the extras with their
 * word — a wide or a no-ball alone is "wd" / "nb", with runs it shows the
 * delivery's runs ("2wd", "5nb"); byes and leg byes their runs ("2b", "1lb").
 * A no-ball's byes or leg byes are byes or leg byes (Law 21.15, db/52), not
 * no-ball runs, so that no-ball says both: "nb+4b", "nb+1lb".
 */
export function boardBall(b) {
  if (b.type === "W") return "W";
  if (b.type === "Wd") return b.value ? `${1 + b.value}wd` : "wd";
  if (b.type === "Nb" && b.value && (b.nbRuns === "byes" || b.nbRuns === "leg_byes")) return `nb+${b.value}${b.nbRuns === "byes" ? "b" : "lb"}`;
  if (b.type === "Nb") return b.value ? `${1 + b.value}nb` : "nb";
  if (b.type === "Pen") return `+${b.value}`;
  if (b.type === "B") return `${b.value}b`;
  if (b.type === "LB") return `${b.value}lb`;
  return b.value ? String(b.value) : "·";
}

/**
 * The target, as a scorer says it: "Need 45 off 34". Null outside a chase.
 * @returns {{need: number, balls: number, rrr: string | null} | null}
 */
export function chaseLine(inn, target, overs) {
  if (target == null || !inn) return null;
  const balls = Math.max(0, overs * 6 - inn.balls);
  const need = target - inn.runs;
  return { need, balls, rrr: need > 0 && balls > 0 ? ((need / balls) * 6).toFixed(2) : null };
}

/**
 * "AT THIS RATE": the total a first innings reaches if it keeps scoring at the
 * rate it has scored so far, to the end of its overs — runs, plus the runs
 * per ball so far times the balls still to come, rounded.
 *
 *     runs + (runs / balls) × (overs × 6 − balls)
 *
 * Plain arithmetic, stated as such: no weight for the wickets that have gone,
 * for the overs still to come or for the pitch, and no model. It is what the
 * run rate already on the board comes to, and nothing it claims to know more.
 *
 * NULL — the line is left off — when it would say nothing true or nothing
 * useful: in a second innings (the required rate is on the board), before a
 * legal ball has been bowled (nothing to rate; a first-ball wide is runs with
 * no ball), when the format has no over limit (a declaration or timed match),
 * when the innings has no overs to reckon against, and once the innings is
 * over (its total is on the board).
 * @param {any} inn  a folded innings (packages/scoring's replay)
 * @param {{overs?: number | null, chasing?: boolean, format?: unknown}} [o]
 *   `overs` the innings' limit (revised, if it was); `chasing` it is the second innings
 * @returns {number | null}
 */
export function atThisRate(inn, { overs = null, chasing = false, format = null } = {}) {
  if (!inn || chasing) return null;
  if (formatKind(format) === "declaration") return null;
  if (!Number.isInteger(overs) || /** @type {number} */ (overs) <= 0) return null;
  if (!(inn.balls > 0) || inn.complete) return null;
  const left = /** @type {number} */ (overs) * 6 - inn.balls;
  if (left <= 0) return null;
  return Math.round(inn.runs + (inn.runs / inn.balls) * left);
}

/**
 * Everything the board shows, as Board's props. `inn` is a folded innings
 * (packages/scoring's replay, or the demo's seeded one); `target` and `overs`
 * as the chase line needs them. A part the fold does not have is left out, and
 * Board draws no row for it.
 */
export function boardFromInnings(inn, { target = null, overs = 20, projected = null } = {}) {
  if (!inn) return null;
  const st = inn.batsmen?.find((b) => b.id === inn.striker);
  const ns = inn.batsmen?.find((b) => b.id === inn.nonStriker);
  const bw = inn.bowlers?.find((b) => b.id === inn.bowler);
  const thisOver = inn.overLog?.find((o) => o.over === Math.floor(inn.balls / 6))?.balls ?? [];
  const crr = RR(inn.runs, inn.balls);
  const chase = chaseLine(inn, target, overs);
  // `projected` is atThisRate()'s answer, passed by the screens that show it
  // (the Match Centre's and the public page's Summary): the pad and the day
  // sheet do not pass it, and draw the board as before.
  const rates = [crr !== "—" ? `CRR ${crr}` : null, chase?.rrr ? `RRR ${chase.rrr}` : null,
    projected != null ? `At this rate: ${projected}` : null].filter(Boolean).join(" · ");
  const sub = chase
    ? [chase.need > 0 ? `Need ${chase.need} off ${chase.balls}` : "Target reached", rates].filter(Boolean).join(" · ")
    : rates || null;
  // The stand in progress — the fold's `curPartner`: runs with the extras in,
  // as partnerships are reported, and legal balls — while both of the pair
  // are in. Between a wicket and the next batter there is no pair, and no row.
  const cp = inn.curPartner;
  const partnership = st && ns && cp ? { runs: cp.runs, balls: cp.balls } : undefined;
  return {
    team: inn.battingTeam, total: inn.runs, wickets: inn.wickets, overs: fmtOv(inn.balls), sub,
    batters: [st, ns].filter(Boolean).map((b) => ({ name: b.name, runs: b.runs, balls: b.balls, onStrike: b.id === inn.striker })),
    partnership,
    bowler: bw ? { name: bw.name, wickets: bw.wickets, runs: bw.runs, overs: fmtOv(bw.balls) } : undefined,
    thisOver: thisOver.map(boardBall),
  };
}
