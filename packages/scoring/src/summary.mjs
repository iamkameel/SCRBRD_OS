/**
 * SCRBRD — a paper scorebook's innings: its shape and its arithmetic
 * (SCRBRD-120, docs/design/SCRBRD-120_scorebook_importer.md §1.2, §2.3, §2.5).
 *
 * A scorebook card is what a person checked, cell by cell, beside a photo of
 * the book. This module says whether it is a card at all and whether it adds
 * up — the one function the review screen runs as the person types and the
 * commit route runs before the events are written (summaryRefusal()). SQL
 * asks the same questions of the card before a submit and again at the
 * commit (summary_reconciles(), db/63), so no client can skip them; db/99 §41
 * and test/summary.test.mjs hold the two to one list of cards (PARITY).
 *
 * What it does NOT decide:
 *   - whether the ending agrees with the figures ("all out" with seven down):
 *     that is the seal's, sealRefusal() in replay.mjs, against the fold of the
 *     summary — the same check a pad's seal meets;
 *   - whether the innings may be recorded at all (a live ball in it, a second
 *     summary): lawsRefusal() in laws.mjs;
 *   - who a ref is: a person matches our side to the roster, and SQL checks
 *     each id is a boy of the importing school at submit.
 *
 * NOTHING IS ZERO-FILLED (D12). A figure the book does not give is null, and
 * the arithmetic counts only what is there: a null extra is unknown, so the
 * batting side of the book can only be reconciled by declaring the
 * difference (D4, `unreconciled`), and a check that needs a missing figure
 * is not asked rather than asked of nought.
 */
import { DISMISSALS, chargedToBowler } from "./events.mjs";
import { ballsOfOvers } from "./replay.mjs";

/** @import { ScorebookCard } from "./events.mjs" */

/** A batter still in when the innings ended, and one who retired hurt: not wickets. */
export const CARD_NOT_OUT = "not_out";
export const CARD_RETIRED_HURT = "retired_hurt";

/**
 * How a batter's innings ended, as a card says it: every canonical dismissal
 * (events.mjs DISMISSAL), and the two that are not wickets.
 * @type {ReadonlySet<unknown>}
 */
export const CARD_HOW_OUT = new Set([...DISMISSALS, CARD_NOT_OUT, CARD_RETIRED_HURT]);

/**
 * A card's ending → the innings_end reason the commit writes. The three the
 * Laws derive (all out, the overs, the target) are checked against the
 * figures at the seal; the rest are taken on the book's word, as a pad's
 * declaration is.
 */
export const CARD_END_REASON = Object.freeze({
  all_out: "all_out", overs: "overs_complete", target: "target_reached",
  declared: "declared", time: "time", other: "other",
});

/** Most rows a side of a card may have: an XI and its substitutes, generously. */
export const CARD_MAX_ROWS = 15;

/** Every reason a card is refused, per cell. */
export const SUMMARY_REFUSAL = Object.freeze({
  CARD_SHAPE:        "card_shape",          // not a card: a field missing, of the wrong kind, or one the card has no place for
  REF_UNKNOWN:       "ref_unknown",         // names nobody: not a player id, and not a typed name on this card
  REF_SIDE:          "ref_side",            // our side named by a typed name, or theirs by a player id
  REF_REPEATED:      "ref_repeated",        // the same player twice on one side of the card
  DISMISSAL_BOWLER:  "dismissal_bowler",    // a bowler's dismissal with no bowler of this card, or a bowler named on one that is not his
  BATTING_PLUS_EXTRAS: "batting_plus_extras", // the batters' runs and the extras do not make the total, and no difference was declared
  UNRECONCILED_WRONG: "unreconciled_wrong", // a difference declared that is not the book's difference
  WICKETS_MISMATCH:  "wickets_mismatch",    // the batters out are not the wickets
  BOWLER_WICKETS:    "bowler_wickets",      // a bowler's wickets are not the dismissals credited to him
  BOWLING_PLUS_BYES: "bowling_plus_byes",   // the runs off the bowlers, byes, leg byes and penalties do not make the total
  BALLS_MISMATCH:    "balls_mismatch",      // the bowlers' overs are not the innings' overs
  BOUNDARIES:        "boundaries_exceed_runs", // more runs in fours and sixes than the batter made
  FALL_OF_WICKETS:   "fall_of_wickets",     // the fall of wickets does not count the wickets, in order, within the total
});
/** @typedef {typeof SUMMARY_REFUSAL[keyof typeof SUMMARY_REFUSAL]} SummaryRefusalCode */

/** Words for the review screen, per code. */
export const SUMMARY_REFUSAL_TEXT = Object.freeze({
  card_shape: "this is not a figure the scorecard can hold here",
  ref_unknown: "this names nobody: choose the player from the roster, or type the name",
  ref_side: "our players are chosen from the roster; the opposition's names are typed",
  ref_repeated: "the same player is on this side of the card twice",
  dismissal_bowler: "a batter bowled, caught, lbw, stumped or hit wicket names a bowler of this innings; any other dismissal names none",
  batting_plus_extras: "the batters' runs and the extras do not add up to the total — correct a figure, or record the book's difference",
  unreconciled_wrong: "the difference recorded is not the difference between the batters' runs and extras and the total",
  wickets_mismatch: "the number of batters out is not the number of wickets",
  bowler_wickets: "a bowler's wickets are not the dismissals credited to him in the batting",
  bowling_plus_byes: "the runs off the bowlers, with the byes, leg byes and penalties, do not add up to the total",
  balls_mismatch: "the bowlers' overs do not add up to the innings' overs",
  boundaries_exceed_runs: "more runs in fours and sixes than the batter scored",
  fall_of_wickets: "the fall of wickets does not list each wicket once, in order, within the total",
});

/**
 * One refusal: where on the card, which rule, and the words.
 * @typedef {{path: string, code: SummaryRefusalCode, text: string}} SummaryRefusal
 */

/**
 * What the arithmetic needs besides the card: the spellings typed into the
 * import (so a `t:<n>` names somebody), and which side is the importing
 * school's (so our rows are player ids and theirs typed names, D6). `ours`
 * "both" is a fixture between two sides of one school; null asks nothing
 * about sides (a test of the arithmetic alone).
 * @typedef {{typed?: Record<string, unknown> | null, ours?: "home" | "away" | "both" | null}} SummaryContext
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPED = /^t:\d{1,3}$/;
const CARD_KEYS = ["v", "innings", "battingSide", "batting", "didNotBat", "bowling", "extras", "total", "wickets",
                   "overs", "fallOfWickets", "endReason", "unreconciled"];
const BATTING_KEYS = ["order", "ref", "howOut", "fielderRef", "bowlerRef", "runs", "balls", "fours", "sixes"];
const BOWLING_KEYS = ["ref", "overs", "maidens", "runs", "wickets", "wides", "noBalls"];
const EXTRAS_KEYS = ["byes", "legByes", "wides", "noBalls", "penalty"];
const FOW_KEYS = ["wicket", "score", "ref", "over"];

/** A whole number from nought to 9999. @param {unknown} v */
const isCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 9999;
/** A count or null. @param {unknown} v */
const isCountOrNull = (v) => v === null || isCount(v);
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
/** Is it a player id or a typed key? @param {unknown} v @returns {v is string} */
const isRef = (v) => typeof v === "string" && (UUID.test(v) || TYPED.test(v));
/** Keys the object has that the list does not. @param {Record<string, any>} o @param {string[]} keys */
const strays = (o, keys) => Object.keys(o).filter((k) => !keys.includes(k));

/**
 * Why this card may not be recorded, cell by cell; an empty list when it may.
 *
 * Shape first: a card that is not one is refused for its shape alone, because
 * arithmetic over a missing figure says nothing. Then the names, then the
 * sums. Each refusal names its cell (`batting.3.runs`), for the screen.
 *
 * @param {unknown} card  a ScorebookCard, or whatever a client sent as one
 * @param {SummaryContext} [ctx]
 * @returns {SummaryRefusal[]}
 */
export function summaryRefusal(card, ctx = {}) {
  /** @type {SummaryRefusal[]} */
  const out = [];
  /** @param {string} path @param {SummaryRefusalCode} code */
  const no = (path, code) => out.push({ path, code, text: SUMMARY_REFUSAL_TEXT[code] });

  for (const [path] of shapeProblems(card)) no(path, SUMMARY_REFUSAL.CARD_SHAPE);
  if (out.length) return out;
  const c = /** @type {ScorebookCard} */ (card);
  const typed = isObject(ctx.typed) ? ctx.typed : {};

  // ── The names ───────────────────────────────────────────────────
  // A typed key names somebody only when this import has its spelling.
  /** @param {unknown} r */
  const named = (r) => typeof r === "string" && (UUID.test(r) || (TYPED.test(r) && typeof typed[r] === "string" && typed[r].trim() !== ""));
  for (const [path, r] of refCells(c)) if (r != null && !named(r)) no(path, SUMMARY_REFUSAL.REF_UNKNOWN);

  // Our side is the importing school's boys, chosen from the roster (a row
  // left unmatched is not submitted); theirs are typed (D6).
  if (ctx.ours) {
    const battingOurs = ctx.ours === "both" || ctx.ours === c.battingSide;
    const bowlingOurs = ctx.ours === "both" || ctx.ours !== c.battingSide;
    /** @param {string} path @param {unknown} r @param {boolean} ours */
    const side = (path, r, ours) => {
      if (typeof r !== "string") return;
      if (ours ? !UUID.test(r) : (ctx.ours !== "both" && UUID.test(r))) no(path, SUMMARY_REFUSAL.REF_SIDE);
    };
    c.batting.forEach((b, i) => side(`batting.${i}.ref`, b.ref, battingOurs));
    c.didNotBat.forEach((r, i) => side(`didNotBat.${i}`, r, battingOurs));
    c.bowling.forEach((b, i) => side(`bowling.${i}.ref`, b.ref, bowlingOurs));
    c.batting.forEach((b, i) => {
      side(`batting.${i}.bowlerRef`, b.bowlerRef, bowlingOurs);
      side(`batting.${i}.fielderRef`, b.fielderRef, bowlingOurs);
    });
  }

  /** @type {Set<string>} */ const seen = new Set();
  c.batting.forEach((b, i) => { if (seen.has(b.ref)) no(`batting.${i}.ref`, SUMMARY_REFUSAL.REF_REPEATED); seen.add(b.ref); });
  c.didNotBat.forEach((r, i) => { if (seen.has(r)) no(`didNotBat.${i}`, SUMMARY_REFUSAL.REF_REPEATED); seen.add(r); });
  seen.clear();
  c.bowling.forEach((b, i) => { if (seen.has(b.ref)) no(`bowling.${i}.ref`, SUMMARY_REFUSAL.REF_REPEATED); seen.add(b.ref); });

  const bowlers = new Set(c.bowling.map((b) => b.ref));
  c.batting.forEach((b, i) => {
    const charged = chargedToBowler(b.howOut);
    if (charged ? !(b.bowlerRef != null && bowlers.has(b.bowlerRef)) : b.bowlerRef != null) {
      no(`batting.${i}.bowlerRef`, SUMMARY_REFUSAL.DISMISSAL_BOWLER);
    }
  });

  // ── The sums ────────────────────────────────────────────────────
  const x = c.extras;
  const battingRuns = c.batting.reduce((s, b) => s + b.runs, 0);
  const knownExtras = EXTRAS_KEYS.reduce((s, k) => s + (x[/** @type {keyof typeof x} */ (k)] ?? 0), 0);
  const difference = c.total - battingRuns - knownExtras;
  if (c.unreconciled == null) {
    if (difference !== 0) no("total", SUMMARY_REFUSAL.BATTING_PLUS_EXTRAS);
  } else if (c.unreconciled.runs !== difference || difference === 0) {
    no("unreconciled.runs", SUMMARY_REFUSAL.UNRECONCILED_WRONG);
  }

  const out_ = c.batting.filter((b) => b.howOut !== CARD_NOT_OUT && b.howOut !== CARD_RETIRED_HURT).length;
  if (out_ !== c.wickets) no("wickets", SUMMARY_REFUSAL.WICKETS_MISMATCH);

  c.bowling.forEach((w, i) => {
    const credited = c.batting.filter((b) => b.bowlerRef === w.ref && chargedToBowler(b.howOut)).length;
    if (credited !== w.wickets) no(`bowling.${i}.wickets`, SUMMARY_REFUSAL.BOWLER_WICKETS);
  });

  if (x.byes != null && x.legByes != null && x.penalty != null) {
    const offBowlers = c.bowling.reduce((s, w) => s + w.runs, 0);
    if (offBowlers + x.byes + x.legByes + x.penalty !== c.total) no("bowling", SUMMARY_REFUSAL.BOWLING_PLUS_BYES);
  }

  const bowled = c.bowling.reduce((s, w) => s + /** @type {number} */ (ballsOfOvers(w.overs)), 0);
  if (bowled !== ballsOfOvers(c.overs)) no("overs", SUMMARY_REFUSAL.BALLS_MISMATCH);

  c.batting.forEach((b, i) => {
    if (4 * (b.fours ?? 0) + 6 * (b.sixes ?? 0) > b.runs) no(`batting.${i}.runs`, SUMMARY_REFUSAL.BOUNDARIES);
  });

  // The fall of wickets, where the book has one (none is "not recorded"):
  // each wicket once, 1 to n, n the wickets; scores never falling, never past
  // the total; each batter named one who batted.
  const f = c.fallOfWickets;
  if (f.length) {
    const batted = new Set(c.batting.map((b) => b.ref));
    let last = 0;
    let bad = f.length !== c.wickets;
    f.forEach((w, i) => {
      if (w.wicket !== i + 1) bad = true;
      if (w.score != null) { if (w.score < last || w.score > c.total) bad = true; last = w.score; }
      if (w.ref != null && !batted.has(w.ref)) bad = true;
    });
    const fallen = f.map((w) => w.ref).filter((r) => r != null);
    if (new Set(fallen).size !== fallen.length) bad = true;
    if (bad) no("fallOfWickets", SUMMARY_REFUSAL.FALL_OF_WICKETS);
  }
  return out;
}

/**
 * The refusal codes alone, sorted and once each: what db/63's
 * summary_reconciles() answers for the same card (the PARITY list).
 * @param {unknown} card @param {SummaryContext} [ctx]
 * @returns {string}
 */
export function summaryCodes(card, ctx = {}) {
  return [...new Set(summaryRefusal(card, ctx).map((r) => r.code))].sort().join(",");
}

/**
 * Every cell whose shape is wrong, as [path, reason]. Empty for a card.
 * @param {unknown} card
 * @returns {[string, string][]}
 */
function shapeProblems(card) {
  /** @type {[string, string][]} */
  const out = [];
  /** @param {string} path @param {string} why */
  const bad = (path, why) => out.push([path, why]);
  if (!isObject(card)) { bad("", "not an object"); return out; }
  for (const k of strays(card, CARD_KEYS)) bad(k, "no such field");
  if (card.v !== 1) bad("v", "version 1");
  if (!(Number.isInteger(card.innings) && card.innings >= 0 && card.innings <= 3)) bad("innings", "0 to 3");
  if (card.battingSide !== "home" && card.battingSide !== "away") bad("battingSide", "home or away");
  if (!(isCount(card.total))) bad("total", "a count");
  if (!(Number.isInteger(card.wickets) && card.wickets >= 0 && card.wickets <= 10)) bad("wickets", "0 to 10");
  if (ballsOfOvers(card.overs) == null) bad("overs", "overs and balls");
  if (!Object.hasOwn(CARD_END_REASON, String(card.endReason))) bad("endReason", "a known ending");

  if (!isObject(card.extras)) bad("extras", "an object");
  else {
    for (const k of strays(card.extras, EXTRAS_KEYS)) bad(`extras.${k}`, "no such field");
    for (const k of EXTRAS_KEYS) if (!isCountOrNull(card.extras[k])) bad(`extras.${k}`, "a count or null");
  }

  const u = card.unreconciled;
  if (u !== null && !(isObject(u) && strays(u, ["runs", "note"]).length === 0
      && Number.isInteger(u.runs) && Math.abs(u.runs) <= 9999
      && typeof u.note === "string" && u.note.trim().length >= 3 && u.note.length <= 200)) {
    bad("unreconciled", "null, or the difference and a note");
  }

  /** @param {string} name @param {(row: any, i: number) => void} each */
  const rows = (name, each) => {
    const list = card[name];
    if (!Array.isArray(list)) { bad(name, "a list"); return; }
    if (list.length > CARD_MAX_ROWS) bad(name, `at most ${CARD_MAX_ROWS}`);
    list.forEach(each);
  };
  rows("batting", (b, i) => {
    if (!isObject(b)) { bad(`batting.${i}`, "an object"); return; }
    for (const k of strays(b, BATTING_KEYS)) bad(`batting.${i}.${k}`, "no such field");
    if (b.order !== i + 1) bad(`batting.${i}.order`, "1, 2, 3 … in order");
    if (!isRef(b.ref)) bad(`batting.${i}.ref`, "a player");
    if (!CARD_HOW_OUT.has(b.howOut)) bad(`batting.${i}.howOut`, "a known way out, or not out");
    for (const k of ["fielderRef", "bowlerRef"]) if (b[k] !== null && !isRef(b[k])) bad(`batting.${i}.${k}`, "a player or null");
    if (!isCount(b.runs)) bad(`batting.${i}.runs`, "a count");
    for (const k of ["balls", "fours", "sixes"]) if (!isCountOrNull(b[k])) bad(`batting.${i}.${k}`, "a count or null");
  });
  rows("didNotBat", (r, i) => { if (!isRef(r)) bad(`didNotBat.${i}`, "a player"); });
  rows("bowling", (w, i) => {
    if (!isObject(w)) { bad(`bowling.${i}`, "an object"); return; }
    for (const k of strays(w, BOWLING_KEYS)) bad(`bowling.${i}.${k}`, "no such field");
    if (!isRef(w.ref)) bad(`bowling.${i}.ref`, "a player");
    if (ballsOfOvers(w.overs) == null) bad(`bowling.${i}.overs`, "overs and balls");
    for (const k of ["runs", "wickets"]) if (!isCount(w[k])) bad(`bowling.${i}.${k}`, "a count");
    for (const k of ["maidens", "wides", "noBalls"]) if (!isCountOrNull(w[k])) bad(`bowling.${i}.${k}`, "a count or null");
  });
  rows("fallOfWickets", (w, i) => {
    if (!isObject(w)) { bad(`fallOfWickets.${i}`, "an object"); return; }
    for (const k of strays(w, FOW_KEYS)) bad(`fallOfWickets.${i}.${k}`, "no such field");
    if (!(Number.isInteger(w.wicket) && w.wicket >= 1 && w.wicket <= 10)) bad(`fallOfWickets.${i}.wicket`, "1 to 10");
    if (!isCountOrNull(w.score)) bad(`fallOfWickets.${i}.score`, "a count or null");
    if (w.ref !== null && !isRef(w.ref)) bad(`fallOfWickets.${i}.ref`, "a player or null");
    if (w.over !== null && ballsOfOvers(w.over) == null) bad(`fallOfWickets.${i}.over`, "overs and balls, or null");
  });
  return out;
}

/**
 * Every cell of a card that names somebody, as [path, ref]: null where a
 * cell may be empty and is.
 * @param {ScorebookCard} c
 * @returns {[string, string | null][]}
 */
function refCells(c) {
  /** @type {[string, string | null][]} */
  const out = [];
  c.batting.forEach((b, i) => { out.push([`batting.${i}.ref`, b.ref], [`batting.${i}.fielderRef`, b.fielderRef], [`batting.${i}.bowlerRef`, b.bowlerRef]); });
  c.didNotBat.forEach((r, i) => out.push([`didNotBat.${i}`, r]));
  c.bowling.forEach((b, i) => out.push([`bowling.${i}.ref`, b.ref]));
  c.fallOfWickets.forEach((w, i) => out.push([`fallOfWickets.${i}.ref`, w.ref]));
  return out;
}

/**
 * A card with only the fields a card has, in their order — whatever else a
 * client sent is dropped, so nothing rides into the record that no reader
 * knows to look for (a name in a stray field would outlive every rule about
 * names). Values are kept as sent: summaryRefusal() judges them.
 * @param {unknown} input
 * @returns {Record<string, any>}
 */
export function normaliseCard(input) {
  const c = isObject(input) ? input : {};
  /** @param {unknown} o @param {string[]} keys */
  const pick = (o, keys) => {
    const src = isObject(o) ? o : {};
    /** @type {Record<string, any>} */
    const r = {};
    for (const k of keys) r[k] = src[k] === undefined ? null : trimmed(src[k]);
    return r;
  };
  /** @param {unknown} v */
  const list = (v) => (Array.isArray(v) ? v.slice(0, CARD_MAX_ROWS + 1) : []);
  return {
    v: c.v ?? 1,
    innings: c.innings ?? null,
    battingSide: c.battingSide ?? null,
    batting: list(c.batting).map((b) => pick(b, BATTING_KEYS)),
    didNotBat: list(c.didNotBat).map(trimmed),
    bowling: list(c.bowling).map((b) => pick(b, BOWLING_KEYS)),
    extras: pick(c.extras, EXTRAS_KEYS),
    total: c.total ?? null,
    wickets: c.wickets ?? null,
    overs: trimmed(c.overs ?? null),
    fallOfWickets: list(c.fallOfWickets).map((w) => pick(w, FOW_KEYS)),
    endReason: c.endReason ?? null,
    unreconciled: isObject(c.unreconciled) ? { runs: c.unreconciled.runs ?? null, note: trimmed(c.unreconciled.note ?? null) } : null,
  };
}

/** @param {unknown} v */
const trimmed = (v) => (typeof v === "string" ? v.trim() : v);

/**
 * The typed spellings an import keeps: `t:<n>` → a name, trimmed, 1 to 80
 * characters. Anything else is dropped, never guessed at.
 * @param {unknown} input
 * @returns {Record<string, string>}
 */
export function normaliseTyped(input) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!isObject(input)) return out;
  for (const [k, v] of Object.entries(input)) {
    if (!TYPED.test(k) || typeof v !== "string") continue;
    const name = v.trim().replace(/\s+/g, " ");
    if (name.length >= 1 && name.length <= 80) out[k] = name;
  }
  return out;
}

/**
 * Every cell of an import's cards a person must tick or edit before it is
 * submitted (§6.3: the reader's confidence is never a tick), as paths
 * `<card>.<field>` — `0.total`, `1.batting.3.runs`. The screen records a tick
 * per path in the revision's `checked`.
 * @param {unknown} cards  the import's card list
 * @returns {string[]}
 */
export function cellPaths(cards) {
  /** @type {string[]} */
  const out = [];
  (Array.isArray(cards) ? cards : []).forEach((card, n) => {
    const c = isObject(card) ? card : {};
    for (const k of ["battingSide", "total", "wickets", "overs", "endReason"]) out.push(`${n}.${k}`);
    for (const k of EXTRAS_KEYS) out.push(`${n}.extras.${k}`);
    (Array.isArray(c.batting) ? c.batting : []).forEach((_, i) => {
      for (const k of BATTING_KEYS) if (k !== "order") out.push(`${n}.batting.${i}.${k}`);
    });
    (Array.isArray(c.didNotBat) ? c.didNotBat : []).forEach((_, i) => out.push(`${n}.didNotBat.${i}`));
    (Array.isArray(c.bowling) ? c.bowling : []).forEach((_, i) => { for (const k of BOWLING_KEYS) out.push(`${n}.bowling.${i}.${k}`); });
    (Array.isArray(c.fallOfWickets) ? c.fallOfWickets : []).forEach((_, i) => { for (const k of FOW_KEYS) out.push(`${n}.fallOfWickets.${i}.${k}`); });
  });
  return out;
}

/**
 * The cells not yet ticked.
 * @param {unknown} cards @param {unknown} checked  path → true
 * @returns {string[]}
 */
export function uncheckedCells(cards, checked) {
  const ticks = isObject(checked) ? checked : {};
  return cellPaths(cards).filter((p) => ticks[p] !== true);
}
