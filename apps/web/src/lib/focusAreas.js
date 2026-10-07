/**
 * The skills screen's development plan (GA-I06).
 *
 * It used to print "13 -> 23" and "14 -> 24" beside a rubric that stops at 20:
 * a target invented as rating + 10. A target is a coaching decision, so it
 * exists only where a coach saved one. There is no saved-goal read yet, so the
 * screen passes none and no target is drawn; this is the shape one will take.
 *
 * Pure: apps/web/test/radar.test.mjs holds it.
 */
import { radarLabelOf } from "./radar.js";

const SCALE_TOP = 20;

/**
 * The lowest-rated skills of a category, lowest first, each with the target a
 * coach saved for it or null. A saved goal is believed only if it is a whole
 * number above the rating and within the scale; anything else is no target.
 *
 * @param {Record<string, number>} ratings  skill -> 1..20
 * @param {Record<string, number> | null} [saved]  skill -> the coach's saved target; none by default
 * @param {number} [count]
 * @returns {{ skill: string, label: string, value: number, target: number | null }[]}
 */
export function focusAreas(ratings, saved = null, count = 3) {
  return Object.entries(ratings ?? {})
    .filter(([, v]) => Number.isFinite(v))
    .sort(([, a], [, b]) => a - b)
    .slice(0, count)
    .map(([skill, value]) => {
      const g = saved?.[skill];
      const target = Number.isInteger(g) && g > value && g <= SCALE_TOP ? g : null;
      return { skill, label: radarLabelOf(skill), value, target };
    });
}
