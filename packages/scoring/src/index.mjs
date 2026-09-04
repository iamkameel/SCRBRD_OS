/**
 * @scrbrd/scoring — the event model and the deterministic replay that derives
 * every score, scorecard and chart from it.
 *
 * Nothing in SCRBRD stores a score. If you find yourself reaching for a
 * mutable counter, add an event kind instead and let `deriveInnings` fold it.
 */
export * from "./events.mjs";
export * from "./replay.mjs";
export * from "./undo.mjs";
export * from "./placement.mjs";
export * from "./rating.mjs";
