/**
 * The pad's milestones: what the facts say a ball brought up (Recognition R2).
 *
 * The pad used to count its own (detectMilestone(), panels.jsx): a second
 * copy of the rules that skipped a no-ball's runs off the bat, called a
 * hat-trick over a run out, and showed only the first milestone a ball
 * earned. Now it reads deriveFacts() (@scrbrd/scoring, facts.mjs, R1), the
 * one reading of the fold the commentary and the recognition SQL mirrors
 * share: the batter's marks, the bowler's fifth wicket and each after it, the
 * hat-trick under Q8 and the ball that puts him on one. Every one a ball
 * earns is returned, in the facts' order; the pad queues them all.
 *
 * The side's own marks (50, 100, … and all out) are not anyone's fact. They
 * are read from the pad's fold before and after the ball, the same innings
 * the board draws, never counted here.
 *
 * DISPLAY ONLY. Nothing here is asked before an event is emitted, and nothing
 * here touches the log: it folds a copy (withAppended()) and returns words.
 * A milestone is a tentative cue on the scorer's device (spec §8: "not
 * official"), so an achievement carries the milestone pin, dashed (spec §13),
 * and the word "Tentative".
 */
import { deriveFacts, KIND, MOMENT_KIND, INNINGS_END_REASON } from "@scrbrd/scoring";
import { foldPad, withAppended } from "./penalty.js";
import { isSuperOver } from "../lib/superOver.js";

/** The side's marks the pad calls. */
export const TEAM_MARKS = Object.freeze([50, 100, 150, 200, 250, 300, 350, 400]);

/** An achievement's cue: the milestone pin (spec §13), dashed while tentative. */
const ACHIEVEMENT = Object.freeze({ badge: "pin", tentative: true });

/** A batter reaching a mark, in the pad's words. */
function batterMark(mark, name) {
  if (mark === 50) return { type: "fifty", label: "FIFTY!", sub: `${name} reaches 50` };
  if (mark === 100) return { type: "century", label: "CENTURY!", sub: `${name} reaches 100` };
  if (mark === 150) return { type: "150", label: "150!", sub: `${name} on 150` };
  if (mark === 200) return { type: "200", label: "DOUBLE!", sub: `${name} reaches 200` };
  return { type: String(mark), label: `${mark}!`, sub: `${name} reaches ${mark}` };
}

/**
 * One fact's moment in the pad's words, or null for one the pad does not call.
 * @param {import("@scrbrd/scoring").Moment} m
 * @param {(id: string) => string} nameOf
 */
function wordsOf(m, nameOf) {
  const name = nameOf(m.player);
  switch (m.kind) {
    case MOMENT_KIND.BATTER_MARK:
      return { ...batterMark(/** @type {number} */ (m.mark), name), ...ACHIEVEMENT };
    case MOMENT_KIND.BOWLER_WICKETS:
      return m.wickets === 5
        ? { type: "fifer", label: "FIFER!", sub: `${name} takes 5 wickets`, ...ACHIEVEMENT }
        : { type: `wickets${m.wickets}`, label: `${m.wickets} WICKETS!`, sub: `${name}: ${m.wickets}/${m.runs}`, ...ACHIEVEMENT };
    case MOMENT_KIND.HAT_TRICK:
      return { type: "hattrick", label: "HAT-TRICK!", sub: `${name} — three in three`, ...ACHIEVEMENT };
    case MOMENT_KIND.HAT_TRICK_BALL:
      // A cue to the scorer, nobody's honour: no badge.
      return { type: "hattrickball", label: "HAT-TRICK BALL", sub: `${name} — two in two` };
    default:
      return null;
  }
}

/**
 * Every milestone `evs`, appended to innings `curIn` of the pad's log, bring
 * up, in order: the facts' moments, then the side's all out and its marks.
 * None in a super over (SCRBRD-114 phase 3b, §4: two wickets in one would
 * call themselves a hat-trick ball as it ended).
 *
 * @param {object} a
 * @param {object[][]} a.events   the pad's log by innings, BEFORE `evs`
 * @param {number} a.curIn        the innings `evs` go to
 * @param {object[]} a.evs        the events just emitted, as built (no id needed)
 * @param {object} [a.ctx]        the fold's context, as the pad folds with it
 * @param {object | null} [a.before]  the pad's innings before `evs`; folded here if not given
 * @param {object | null} [a.after]   ...and after them
 * @returns {{type: string, label: string, sub: string, badge?: string, tentative?: boolean}[]}
 */
export function ballMilestones(a) {
  // A cue that cannot be worked out is no cue: the over's sheet, the
  // innings' review and the next ball never wait on, or fall over with, it.
  try { return milestonesOf(a); } catch { return []; }
}

function milestonesOf({ events, curIn, evs, ctx = {}, before, after }) {
  if (!evs?.length) return [];
  const log = withAppended(events, curIn, evs);
  const pre = before !== undefined ? before : (foldPad(events, ctx)[curIn] ?? null);
  const post = after !== undefined ? after : (foldPad(log, ctx)[curIn] ?? null);
  if (isSuperOver(pre) || isSuperOver(post)) return [];
  const from = events[curIn]?.length ?? 0;
  const to = from + evs.length;
  const nameOf = (id) => post?.batsmen?.find((b) => b.id === id)?.name
    ?? post?.bowlers?.find((b) => b.id === id)?.name ?? id;
  // The innings ended on this ball: nobody is on a hat-trick in an innings
  // that is over (Q8: one innings).
  const ended = post?.complete === true && pre?.complete !== true;

  const out = [];
  for (const m of deriveFacts(log, null, { ctx }).moments) {
    if (m.superOver || m.at.innings !== curIn || m.at.index < from || m.at.index >= to) continue;
    if (m.kind === MOMENT_KIND.HAT_TRICK_BALL && ended) continue;
    const w = wordsOf(m, nameOf);
    if (w) out.push(w);
  }
  if (pre && post) {
    if (post.endReason === INNINGS_END_REASON.ALL_OUT && pre.endReason !== INNINGS_END_REASON.ALL_OUT) {
      out.push({ type: "allout", label: "ALL OUT!", sub: `${post.battingTeam ?? ""} all out` });
    }
    for (const n of TEAM_MARKS) {
      if (pre.runs < n && post.runs >= n) out.push({ type: `team${n}`, label: `${n}!`, sub: `${post.battingTeam} reach ${n}` });
    }
  }
  return out;
}

/**
 * The milestones the latest delivery of innings `idx` brought up: the same
 * reading, of the log as it stands (the commentary card's line label).
 * @param {object[][]} events  @param {number} idx  @param {object} [ctx]
 */
export function latestMilestones(events, idx, ctx = {}) {
  const list = events?.[idx] ?? [];
  let k = list.length - 1;
  while (k >= 0 && list[k]?.kind !== KIND.BALL) k--;
  if (k < 0) return [];
  const head = [...events];
  head[idx] = list.slice(0, k);
  return ballMilestones({ events: head, curIn: idx, evs: list.slice(k), ctx });
}
