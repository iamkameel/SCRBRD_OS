/**
 * SCRBRD — the words for a shot and for where it went.
 *
 * Moved here from the pad (apps/web/src/scorer/shots.js and field.js) so the
 * commentary generator (commentary.mjs) can describe a ball without the
 * package reaching into the app. The pad keeps its own short labels for its
 * keys ("Fwd Def", "Rev Sweep"): those are buttons. These are prose — how a
 * line of commentary says what the scorer recorded.
 *
 * Keyed by the ids the pad records on a ball (`shot`, `seg`). An id not here
 * says nothing: the generator never prints a raw id, and never guesses one.
 * commentary.test.mjs checks every id the pad offers has its words here.
 */

import { SECTORS } from "./placement.mjs";

/**
 * A shot, as a past participle or a phrase that reads after "Bowler to
 * Batter, …": "driven", "off the outside edge". Every id the pad's shot grid
 * offers (SHOT_CATS) and the older catalogue (SHOT_CATEGORIES).
 * @type {Readonly<Record<string, string>>}
 */
export const SHOT_WORDS = Object.freeze({
  drive: "driven", pull: "pulled", hook: "hooked", cut: "cut", sweep: "swept",
  ramp: "ramped", flick: "flicked", glance: "glanced", loft: "lofted", slog: "slogged",
  fwd_def: "defended on the front foot", back_def: "defended off the back foot", padded: "padded away",
  hit_body: "off the body", hit_glove: "off the glove", hit_helmet: "off the helmet", hit_arm: "off the arm",
  missed: "beaten",
  inside_edge: "off the inside edge", outside_edge: "off the outside edge",
  top_edge: "off the top edge", leading_edge: "off a leading edge",
  reverse_sweep: "reverse-swept", switch_hit: "switch-hit", paddle: "paddled", lap: "lapped",
});

/**
 * Shots where the bat did not meet the ball, or met it only by accident of
 * the body: a line does not send these "to cover".
 * @type {ReadonlySet<string>}
 */
export const NO_STROKE = new Set(["missed", "padded", "hit_body", "hit_helmet", "hit_arm"]);

/**
 * The twelve sectors, by BATTER-RELATIVE sector (placement.mjs SECTORS): how a
 * line names where the ball went. `straight` reads as a phrase of its own
 * ("straight down the ground") rather than after "to".
 *
 * Derived from the fielding families, never typed: the list this replaced was
 * about 30° off ("mid-on" at 90°, which is square; "cover" at 270°, which is
 * point), so a ball hit square read "through mid-on". Index it with
 * sectorOf(ball, hand) — never with a stored `seg`, which is the screen's
 * sector and is mirrored for a left-hander (batterSector()).
 * @type {ReadonlyArray<string>}
 */
export const SECTOR_WORDS = Object.freeze(SECTORS.map((s) => s.label));
