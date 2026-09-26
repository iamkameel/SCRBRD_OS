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
 */
export function boardBall(b) {
  if (b.type === "W") return "W";
  if (b.type === "Wd") return b.value ? `${1 + b.value}wd` : "wd";
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
 * Everything the board shows, as Board's props. `inn` is a folded innings
 * (packages/scoring's replay, or the demo's seeded one); `target` and `overs`
 * as the chase line needs them. A part the fold does not have is left out, and
 * Board draws no row for it.
 */
export function boardFromInnings(inn, { target = null, overs = 20 } = {}) {
  if (!inn) return null;
  const st = inn.batsmen?.find((b) => b.id === inn.striker);
  const ns = inn.batsmen?.find((b) => b.id === inn.nonStriker);
  const bw = inn.bowlers?.find((b) => b.id === inn.bowler);
  const thisOver = inn.overLog?.find((o) => o.over === Math.floor(inn.balls / 6))?.balls ?? [];
  const crr = RR(inn.runs, inn.balls);
  const chase = chaseLine(inn, target, overs);
  const rates = [crr !== "—" ? `CRR ${crr}` : null, chase?.rrr ? `RRR ${chase.rrr}` : null].filter(Boolean).join(" · ");
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
