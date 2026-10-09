/**
 * PLAYING CONDITIONS: A COMPETITION'S RULES, AS THE FOLD READS THEM (SCRBRD-114).
 *
 * A playing condition is a rule of a competition, not a Law of Cricket: how
 * many overs an innings has, whether a no-ball earns a free hit, how many
 * overs a bowler may bowl in an innings. The Laws are the engine's
 * (laws.mjs, keyed by Edition, edition.mjs); conditions differ between one
 * league and the next, and between this season and the next. The design is
 * docs/design/SCRBRD-114_playing_conditions.md (D1–D12 decided by Kameel,
 * 2026-09-28); this module is its JavaScript half.
 *
 * THE CATALOGUE. CONDITION is the closed list of keys — the same rows as
 * db/61's playing_condition_key, each with its part, type, unit, platform
 * default and the readers that consult it. catalogueString() serialises it
 * and db/99 serialises the SQL table the same way; conditions.test.mjs pins
 * the string, so the two lists cannot drift (as free_hits_apply() and
 * DECLARATION_FORMATS are held together, db/54 §3b). No key may begin with
 * a prefix on CONDITION_DENY_PREFIXES: nothing a competition sets may need a
 * child's race to evaluate (the backlog's rule; the CHECK in db/61 is the
 * same list).
 *
 * THE DOCUMENT. A match reads one frozen document, match_conditions.doc,
 * fixed on the match's first event inside the per-match lock
 * (match_conditions_fix(), db/61). The fold is told its `play` part as
 * FoldContext.conditions and its hash as FoldContext.conditionsHash (the
 * hash is computed in SQL alone; JS never reproduces jsonb's key order).
 *
 * NO DOCUMENT IS TODAY'S BEHAVIOUR (D4). Every reader here keeps the rule it
 * had before this module existed when the document is absent or lacks the
 * key: freeHit({}, "Two-Day") is freeHitsApply("Two-Day"), and the overs of
 * an innings are its innings_start's, else 20. Every match scored before
 * db/61 has no document and folds exactly as it did.
 *
 * CONDITIONS NEVER REFUSE A DELIVERY (D1). lawsRefusal() does not read this
 * module. A bowler past a competition's innings cap is recorded; the pad
 * says so in words (capWords()), and phase 2 writes the fact.
 */
import { freeHitsApply, MATCH_FORMAT } from "./format.mjs";


/**
 * Key prefixes no condition may carry: anything whose evaluation would need
 * a child's race, nationality or other special personal information
 * (transformation quotas; design §1.2, A8). db/61's CHECK on
 * playing_condition_key.key is this list.
 */
export const CONDITION_DENY_PREFIXES = Object.freeze(["quota.", "transformation.", "race."]);

/** The shape every key has: dotted lower-case words, a digit allowed after a
 *  word's first character (db/61's CHECK, widened by db/73 for `target.g50`). */
const KEY_SHAPE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/;

/**
 * May this string be a condition key at all? The catalogue is written by
 * migration only; this is the rule its CHECK enforces, for the tests and the
 * API's words.
 * @param {unknown} key
 */
export function conditionKeyAllowed(key) {
  return typeof key === "string" && KEY_SHAPE.test(key)
    && !CONDITION_DENY_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * @typedef {object} ConditionKey
 * @property {"play" | "table" | "sheet"} part
 * @property {"bool" | "int" | "enum" | "date" | "list" | "object"} type
 * @property {string | null} unit
 * @property {string[] | null} values   the enum's values, or a list's allowed items
 * @property {boolean} byAgeBand         one value per bowling_directive age band
 * @property {unknown} platformDefault   null: "none", the reader's own fallback
 * @property {string[]} readers          documentation; [] is a reserved key, read by nothing
 * @property {number} sort
 */

/** @param {Partial<ConditionKey> & Pick<ConditionKey, "part" | "type" | "sort">} k @returns {ConditionKey} */
const key = (k) => Object.freeze({ unit: null, values: null, byAgeBand: false, platformDefault: null, readers: [], ...k });

/**
 * THE CATALOGUE for the high-school pilot (design §1.2), in the order the
 * screen lists it. `platformDefault` null means the reader's own fallback,
 * which for the fixture-derived keys (format.kind, format.overs_per_innings,
 * format.innings_per_side, format.free_hit) is the fixture itself — the
 * resolver fills those from `match` (match_conditions_resolve(), db/61).
 * Reserved keys (readers []) are read by nothing; a league may record one
 * and the screen says "recorded, not applied".
 * @type {Readonly<Record<string, ConditionKey>>}
 */
export const CONDITION = Object.freeze({
  "format.kind":                          key({ part: "play", type: "enum", values: ["limited", "declaration", "timed"], readers: ["pad", "fold", "laws", "sql"], sort: 10 }),
  "format.overs_per_innings":             key({ part: "play", type: "int", unit: "overs", readers: ["pad", "fold", "sql", "table"], sort: 20 }),
  "format.innings_per_side":              key({ part: "play", type: "int", readers: ["fold", "pad"], sort: 30 }),
  "format.free_hit":                      key({ part: "play", type: "bool", readers: ["pad", "fold", "laws", "sql"], sort: 40 }),
  "bowling.max_overs_per_bowler_innings": key({ part: "play", type: "int", unit: "overs", readers: ["pad", "sql"], sort: 50 }),
  "bowling.limit":                        key({ part: "play", type: "object", unit: "overs", byAgeBand: true, readers: ["sql", "pad"], sort: 60 }),
  "result.min_overs_per_side":            key({ part: "play", type: "int", unit: "overs", readers: ["pad", "sql"], sort: 70 }),
  "result.tie_break":                     key({ part: "play", type: "enum", values: ["none", "super_over"], platformDefault: "none", readers: ["fold", "table"], sort: 80 }),
  // SCRBRD-130 R1 (D4, D7): how a rain-revised target was set, and the DLS
  // Standard Edition's G50 — a competition's figure with its source, never a
  // platform default (Kameel, 2026-10-01); the calculator says so without it.
  "target.method":                        key({ part: "play", type: "enum", values: ["umpires_revision", "dls_standard"], platformDefault: "umpires_revision", readers: ["fold", "sql"], sort: 90 }),
  "target.g50":                           key({ part: "play", type: "int", unit: "runs", readers: ["pad"], sort: 91 }),
  // SCRBRD-130 R2 (§4.4): the published DLS table in force when the match was
  // fixed, {id, version, hash} — the platform's, never a competition's.
  "target.dls_table":                     key({ part: "play", type: "object", readers: ["pad", "sql"], sort: 92 }),
  "points.win":                           key({ part: "table", type: "int", unit: "points", readers: ["table"], sort: 100 }),
  "points.tie":                           key({ part: "table", type: "int", unit: "points", readers: ["table"], sort: 101 }),
  "points.draw":                          key({ part: "table", type: "int", unit: "points", readers: ["table"], sort: 102 }),
  "points.no_result":                     key({ part: "table", type: "int", unit: "points", readers: ["table"], sort: 103 }),
  "points.loss":                          key({ part: "table", type: "int", unit: "points", readers: ["table"], sort: 104 }),
  "points.abandoned":                     key({ part: "table", type: "int", unit: "points", readers: ["table"], sort: 105 }),
  "bonus.kind":                           key({ part: "table", type: "enum", values: ["none", "run_rate_ratio", "batting_bowling"], platformDefault: "none", readers: ["table"], sort: 110 }),
  "bonus.params":                         key({ part: "table", type: "object", readers: ["table"], sort: 111 }),
  "nrr.method":                           key({ part: "table", type: "enum", values: ["standard"], platformDefault: "standard", readers: ["table"], sort: 120 }),
  "table.order":                          key({ part: "table", type: "list", values: ["points", "wins", "nrr", "head_to_head", "fewer_losses"], platformDefault: ["points", "wins", "nrr"], readers: ["table"], sort: 130 }),
  "over_rate.kind":                       key({ part: "table", type: "enum", values: ["none", "points", "runs"], platformDefault: "none", readers: ["table"], sort: 140 }),
  "eligibility.age_on":                   key({ part: "sheet", type: "date", readers: ["selection", "sql"], sort: 200 }),
  "eligibility.max_age_open":             key({ part: "sheet", type: "int", unit: "years", readers: ["selection", "sql"], sort: 210 }),
  "eligibility.bona_fide_scholar":        key({ part: "sheet", type: "bool", platformDefault: false, readers: ["selection", "pad"], sort: 220 }),
  // Reserved: read by nothing (design §1.2).
  "over.max_balls":                       key({ part: "play", type: "int", unit: "balls", sort: 900 }),
  "over.free_hit_falls_away_on_last_ball": key({ part: "play", type: "bool", sort: 901 }),
  "batting.retire_at_runs":               key({ part: "play", type: "int", unit: "runs", sort: 902 }),
  "pitch.length_m":                       key({ part: "play", type: "int", unit: "m", sort: 903 }),
  "ball.weight_g":                        key({ part: "play", type: "int", unit: "g", sort: 904 }),
  "fielding.powerplay":                   key({ part: "play", type: "object", sort: 905 }),
  "bowling.rest_overs_between_spells":    key({ part: "play", type: "int", unit: "overs", sort: 907 }),
  "eligibility.max_overage_players":      key({ part: "sheet", type: "int", sort: 908 }),
});

/**
 * A value as Postgres prints a jsonb: arrays "[a, b]", objects
 * "{"k": v}" with keys shorter-first then bytewise (jsonb's own order),
 * strings JSON-quoted. Enough for the catalogue's defaults and the parity
 * strings; not a general serialiser.
 * @param {unknown} v
 * @returns {string}
 */
export function jsonbText(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(", ")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(/** @type {object} */ (v)).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}: ${jsonbText(/** @type {any} */ (v)[k])}`).join(", ")}}`;
  }
  return JSON.stringify(v);
}

/**
 * The catalogue as one line, in sort order: key|part|type|unit|values|band|default|readers
 * per key, joined by "; ". db/99 §39 builds the same string from
 * playing_condition_key and compares it with the one conditions.test.mjs pins.
 */
export function catalogueString() {
  return Object.entries(CONDITION)
    .sort(([, a], [, b]) => a.sort - b.sort)
    .map(([k, c]) => [k, c.part, c.type, c.unit ?? "-", c.values ? c.values.join(",") : "-", c.byAgeBand ? "band" : "-",
                      c.platformDefault == null ? "-" : jsonbText(c.platformDefault), c.readers.length ? c.readers.join(",") : "-"].join("|"))
    .join("; ");
}

/** @typedef {Readonly<Record<string, unknown>>} PlayConditions  match_conditions.doc.play */

/** @type {PlayConditions} */
const NONE = Object.freeze({});

/**
 * The play conditions a fold was told, or none: `ctx.conditions` when it is
 * an object, else {} (the pad's own match, a caller without the fixture,
 * every match before SCRBRD-114).
 * @param {{conditions?: unknown} | null | undefined} ctx
 * @returns {PlayConditions}
 */
export function conditionsOf(ctx) {
  const c = ctx?.conditions;
  return c != null && typeof c === "object" && !Array.isArray(c) ? /** @type {PlayConditions} */ (c) : NONE;
}

/**
 * Does a no-ball give a free hit in this match? The document's
 * `format.free_hit` when it states a boolean; else the format's answer, as
 * before (freeHitsApply(), SCRBRD-113). SQL asks play_free_hit() (db/61),
 * the same rule, through match_free_hits_apply().
 * @param {PlayConditions | null | undefined} conditions
 * @param {unknown} format
 */
export function freeHit(conditions, format) {
  const v = conditions?.["format.free_hit"];
  return typeof v === "boolean" ? v : freeHitsApply(format);
}

/** A whole number of overs, or null. @param {unknown} v */
const wholeOvers = (v) => (Number.isInteger(v) && /** @type {number} */ (v) > 0 ? /** @type {number} */ (v) : null);

/**
 * The overs of an innings: its innings_start's, as today — what the scorer
 * started the innings with, and the umpires' revision moves it after —
 * else the document's `format.overs_per_innings`, else 20. The document
 * fills only an innings_start that states none; it never overrides one
 * (design §3.7: "an innings still ends at its overs as today, from the
 * innings_start's figure"). SQL's play_overs() (db/61) is the same rule.
 * @param {PlayConditions | null | undefined} conditions
 * @param {{overs?: unknown} | null | undefined} inningsStart
 */
export function oversPerInnings(conditions, inningsStart) {
  const own = inningsStart?.overs;
  if (own != null) return /** @type {number} */ (own);
  return wholeOvers(conditions?.["format.overs_per_innings"]) ?? 20;
}

/**
 * The most overs one bowler may bowl in an innings under the competition's
 * conditions, or null: none (the platform default, D5).
 * @param {PlayConditions | null | undefined} conditions
 */
export function bowlerInningsCap(conditions) {
  return wholeOvers(conditions?.["bowling.max_overs_per_bowler_innings"]);
}

/**
 * The competition's bowling limit for an age band, `{spell, day}` in overs,
 * or null where it names none (the platform's bowling_directive then
 * applies; phase 2 reads it).
 * @param {PlayConditions | null | undefined} conditions
 * @param {string | null | undefined} ageBand
 * @returns {{spell: number | null, day: number | null} | null}
 */
export function bowlingLimit(conditions, ageBand) {
  const all = conditions?.["bowling.limit"];
  if (!ageBand || all == null || typeof all !== "object") return null;
  const v = /** @type {Record<string, any>} */ (all)[ageBand];
  if (v == null || typeof v !== "object") return null;
  return { spell: wholeOvers(v.spell), day: wholeOvers(v.day) };
}

/**
 * What the pad says about a bowler and the competition's innings cap
 * (design §7.4), or null when there is no cap or nothing worth saying yet.
 * Words only: nothing is greyed out and no delivery is refused (D1).
 *
 *   "Has 1 over left (4 an innings)"    one over short of the cap
 *   "Has bowled his 4 overs"            at the cap
 *   "5 overs; the conditions allow 4"   past it: recorded, as the umpires allowed
 *
 * `balls` are the bowler's legal deliveries in this innings (the fold's
 * inn.bowlers[].balls). `unconfirmed` adds the words every figure nobody
 * has confirmed carries (design §8.2).
 * @param {number} balls
 * @param {PlayConditions | null | undefined} conditions
 * @param {{unconfirmed?: boolean}} [o]
 * @returns {string | null}
 */
export function capWords(balls, conditions, { unconfirmed = false } = {}) {
  const cap = bowlerInningsCap(conditions);
  if (cap == null || !Number.isFinite(balls)) return null;
  const tail = unconfirmed ? " (platform default, unconfirmed)" : "";
  const overs = Math.floor(balls / 6);
  const inOver = balls % 6 !== 0;
  if (overs > cap || (overs === cap && inOver)) return `${overs}${inOver ? `.${balls % 6}` : ""} overs; the conditions allow ${cap}${tail}`;
  if (overs === cap) return `Has bowled his ${cap} over${cap === 1 ? "" : "s"}${tail}`;
  if (overs === cap - 1 && !inOver) return `Has 1 over left (${cap} an innings)${tail}`;
  return null;
}

/**
 * The fixture screen's pre-fill from a competition's conditions (design
 * §2.3: the fixture wins on the day, but it starts from the set). Returns
 * the MATCH_FORMAT spelling and the overs to show, or nulls where the set
 * says nothing the form can use.
 *
 *   declaration, two innings a side  → "Two-Day"
 *   declaration                      → "One-Day Declaration"
 *   limited, 20 overs                → "T20"
 *   limited, 50 overs                → "One-Day"
 *   limited, other overs             → the competition's own format if it names one, else "T20"
 *
 * @param {PlayConditions | null | undefined} conditions  a set's values, or a resolved doc's play part
 * @param {string | null | undefined} [competitionFormat] competition.format ("T20", "50-over" …)
 * @returns {{format: string | null, overs: number | null}}
 */
export function fixtureFormatFrom(conditions, competitionFormat = null) {
  const kind = conditions?.["format.kind"];
  const overs = wholeOvers(conditions?.["format.overs_per_innings"]);
  if (kind === "declaration" || kind === "timed") {
    return { format: conditions?.["format.innings_per_side"] === 2 ? MATCH_FORMAT.TWO_DAY : MATCH_FORMAT.ONE_DAY_DECLARATION, overs };
  }
  if (overs === 20) return { format: MATCH_FORMAT.T20, overs };
  if (overs === 50) return { format: MATCH_FORMAT.ONE_DAY, overs };
  const own = offered(competitionFormat);
  if (kind === "limited" || overs != null) {
    return { format: own != null && own !== MATCH_FORMAT.TWO_DAY && own !== MATCH_FORMAT.ONE_DAY_DECLARATION ? own : MATCH_FORMAT.T20, overs };
  }
  return { format: own, overs: null };
}

/**
 * A competition's own format (competition.format, db/00: "T20", "50-over",
 * "multi-day", free text) as one the fixture screen offers, or null.
 * @param {unknown} f
 * @returns {string | null}
 */
function offered(f) {
  if (typeof f !== "string") return null;
  const s = f.trim().toLowerCase();
  if (s === "50-over" || s === "50 over" || s === "one-day" || s === "one day") return MATCH_FORMAT.ONE_DAY;
  if (s === "multi-day" || s === "multi day" || s === "two-day" || s === "two day") return MATCH_FORMAT.TWO_DAY;
  if (s === "t20") return MATCH_FORMAT.T20;
  if (s === "one-day declaration" || s === "one day declaration") return MATCH_FORMAT.ONE_DAY_DECLARATION;
  return null;
}
