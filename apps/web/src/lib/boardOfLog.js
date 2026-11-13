/**
 * The board for a log this phone holds, with no player named (the scorer's
 * home, R0). Its own module so the stores (lib/pilot.js, lib/practice.js)
 * can hand the home a board and never the log behind it (review S6), and
 * lib/scorerDay.js can still fold a log in its tests. Pure.
 */
import { foldPad } from "../scorer/penalty.js";
import { boardFromInnings } from "../scorer/boardData.js";

// ── The board, from the phone's own log ──────────────────────────────

/**
 * The board for a log this phone holds: the innings in play, folded as the
 * pad folds it, drawn with no player's name (no batters, no bowler, no last
 * wicket). Null when the log holds no innings yet, or does not fold.
 * @param {any[][] | null | undefined} events  the pad's log, one array per innings
 * @param {{curIn?: number | null, overs?: number | null}} [o]
 */
export function boardOfLog(events, { curIn = null, overs = null } = {}) {
  if (!Array.isArray(events)) return null;
  let innings;
  try { innings = foldPad(events, {}); } catch { return null; }
  if (!Array.isArray(innings)) return null;
  const at = Number.isInteger(curIn) && innings[/** @type {number} */ (curIn)]?.battingTeam ? /** @type {number} */ (curIn)
    : innings.reduce((last, inn, i) => (inn?.battingTeam ? i : last), -1);
  const inn = at >= 0 ? innings[at] : null;
  if (!inn?.battingTeam) return null;
  const o = Number.isFinite(overs) && /** @type {number} */ (overs) > 0 ? /** @type {number} */ (overs) : inn.overs ?? 20;
  const target = at >= 1 ? (inn.target ?? (Number.isFinite(innings[0]?.runs) ? innings[0].runs + 1 : null)) : null;
  const b = boardFromInnings(inn, { target, overs: o });
  if (!b) return null;
  return { team: b.team, total: b.total, wickets: b.wickets, overs: b.overs, sub: b.sub ?? undefined, thisOver: b.thisOver ?? [] };
}


/**
 * One match as the scorer's home is handed it by its store (lib/pilot.js
 * pilotHomeRows, lib/practice.js practiceHomeRows): its title, its innings'
 * scores, whether it is over, its board, and the few record fields the home
 * reads (a Pilot Match's call-off and ending, its overs). Never the log, the
 * roster, the squads or a player (review S6). `logError`: a record with no
 * log this phone could read (review S5).
 * @param {string} id @param {any} meta @param {any} log
 * @param {{title: string, lines: any[], complete: boolean, savedAt: number | null}} sum  the store's summarise()
 */
export function homeRow(id, meta, log, sum) {
  const p = meta?.pilot ?? null;
  return {
    id, title: sum.title, lines: sum.lines, complete: sum.complete, savedAt: sum.savedAt,
    hasEvents: (Array.isArray(log?.events) ? log.events : []).some((e) => Array.isArray(e) && e.length),
    logError: !!meta && !log,
    board: boardOfLog(log?.events, { curIn: log?.curIn ?? null, overs: meta?.match?.overs ?? log?.cfg?.overs ?? null }),
    meta: {
      match: { overs: meta?.match?.overs ?? null },
      ...(p ? { pilot: { server: p.server ?? null, callOff: p.callOff ?? null, abandoned: p.abandoned === true, finished: p.finished === true } } : {}),
    },
  };
}
