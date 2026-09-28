/**
 * Playing conditions per competition, phase 1: the shape (SCRBRD-114).
 *
 * docs/design/SCRBRD-114_playing_conditions.md, §1–§3 and §9 phase 1. What
 * this suite holds, in JavaScript; db/61's proof and db/99 §39 hold the same
 * in SQL, and tools/smoke-playing-conditions.mjs through the API:
 *
 *   A. The catalogue, as one string: db/99 §39 serialises
 *      playing_condition_key the same way and compares it with CATALOGUE
 *      below, so the two lists cannot drift
 *   B. The deny-list: no key may need a child's race to evaluate
 *   C. The readers, over a fixed list of documents: the same list db/99 §39
 *      folds through play_free_hit() and play_overs() (PARITY below)
 *   D. The fold: a T20 whose conditions say no free hit stands the bowled
 *      after a no-ball; a declaration match whose conditions say free hit
 *      saves it — the server's fold, the pad's and the whole match's agree
 *   E. No document is today's behaviour (D4): a seed-like log folds byte for
 *      byte alike with conditions absent and with conditions {}; and the
 *      check can fail — a document with the other free hit moves it
 *   F. rulesOf() and the commentary carry the conditions; the hash is stamped
 *   G. The pad's words (D1: words, never a refusal) and the fixture
 *      screen's pre-fill
 *
 *   node packages/scoring/test/conditions.test.mjs
 */
import {
  CONDITION, CONDITION_DENY_PREFIXES, conditionKeyAllowed, catalogueString, jsonbText,
  conditionsOf, freeHit, oversPerInnings, bowlerInningsCap, bowlingLimit, capWords, fixtureFormatFrom,
  freeHitsApply, DECLARATION_FORMATS,
  deriveInnings, deriveMatch, deriveInningsList, MatchFold, rulesOf, lawsRefusal,
  inningsStart, batters, bowler, ball, BALL_TYPE,
} from "../src/index.mjs";
import { deriveCommentary } from "../src/commentary.mjs";
import { readFileSync } from "node:fs";

/** @import { LogEvent } from "../src/events.mjs" */

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c  @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

/**
 * The catalogue as db/61 writes it and db/99 §39 reads it back. A key added
 * to one and not the other fails here or there.
 */
export const CATALOGUE =
  'format.kind|play|enum|-|limited,declaration,timed|-|-|pad,fold,laws,sql; '
  + 'format.overs_per_innings|play|int|overs|-|-|-|pad,fold,sql,table; '
  + 'format.innings_per_side|play|int|-|-|-|-|fold,pad; '
  + 'format.free_hit|play|bool|-|-|-|-|pad,fold,laws,sql; '
  + 'bowling.max_overs_per_bowler_innings|play|int|overs|-|-|-|pad,sql; '
  + 'bowling.limit|play|object|overs|-|band|-|sql,pad; '
  + 'result.min_overs_per_side|play|int|overs|-|-|-|pad,sql; '
  + 'result.tie_break|play|enum|-|none,super_over|-|"none"|fold,table; '
  + 'points.win|table|int|points|-|-|-|table; '
  + 'points.tie|table|int|points|-|-|-|table; '
  + 'points.draw|table|int|points|-|-|-|table; '
  + 'points.no_result|table|int|points|-|-|-|table; '
  + 'points.loss|table|int|points|-|-|-|table; '
  + 'points.abandoned|table|int|points|-|-|-|table; '
  + 'bonus.kind|table|enum|-|none,run_rate_ratio,batting_bowling|-|"none"|table; '
  + 'bonus.params|table|object|-|-|-|-|table; '
  + 'nrr.method|table|enum|-|standard|-|"standard"|table; '
  + 'table.order|table|list|-|points,wins,nrr,head_to_head,fewer_losses|-|["points", "wins", "nrr"]|table; '
  + 'over_rate.kind|table|enum|-|none,points,runs|-|"none"|table; '
  + 'eligibility.age_on|sheet|date|-|-|-|-|selection,sql; '
  + 'eligibility.max_age_open|sheet|int|years|-|-|-|selection,sql; '
  + 'eligibility.bona_fide_scholar|sheet|bool|-|-|-|false|selection,pad; '
  + 'over.max_balls|play|int|balls|-|-|-|-; '
  + 'over.free_hit_falls_away_on_last_ball|play|bool|-|-|-|-|-; '
  + 'batting.retire_at_runs|play|int|runs|-|-|-|-; '
  + 'pitch.length_m|play|int|m|-|-|-|-; '
  + 'ball.weight_g|play|int|g|-|-|-|-; '
  + 'fielding.powerplay|play|object|-|-|-|-|-; '
  + 'target.method|play|enum|-|umpires_revision|-|"umpires_revision"|-; '
  + 'bowling.rest_overs_between_spells|play|int|overs|-|-|-|-; '
  + 'eligibility.max_overage_players|sheet|int|-|-|-|-|-';

/**
 * The readers' parity list: [label, play document, format, innings_start
 * overs]. db/99 §39 folds the same list through play_free_hit(doc, format)
 * and play_overs(doc, overs) and compares with PARITY.
 * @type {[string, Record<string, unknown>, string | null, number | null][]}
 */
const CASES = [
  ["a", {}, "T20", 20],
  ["b", {}, "Two-Day", null],
  ["c", {}, null, null],
  ["d", { "format.free_hit": false }, "T20", 20],
  ["e", { "format.free_hit": true }, "One-Day Declaration", 100],
  ["f", { "format.free_hit": false }, null, null],
  ["g", { "format.overs_per_innings": 25 }, "T20", null],
  ["h", { "format.overs_per_innings": 25 }, "T20", 20],
  ["i", { "format.free_hit": "no" }, "T20", 20],
  ["j", { "format.overs_per_innings": 0 }, "Two-Day", null],
  ["k", { "format.free_hit": true, "format.overs_per_innings": 50 }, "multi-day", null],
];
export const PARITY = "a:true/20 b:false/20 c:true/20 d:false/20 e:true/100 f:false/20 g:true/25 h:true/20 i:true/20 j:false/20 k:true/50";

const SQ_A = ["p1", "p2", "p3", "p4", "p5"].map((id) => ({ id, name: id.toUpperCase() }));
const SQ_B = ["w1", "w2", "w3", "w4", "w5"].map((id) => ({ id, name: id.toUpperCase() }));
let n = 0;
/** @param {...LogEvent} evs */
const at = (...evs) => evs.map((e) => ({ ...e, innings: 0, id: e.id ?? `c${++n}`, clientTs: Date.parse("2026-10-03T08:00:00Z") }));
const open = (overs = 20) => at(
  inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, bowlingSquad: SQ_B, overs }),
  batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }));
/** @param {...number} vs */
const runs = (...vs) => at(...vs.map((v) => ball({ type: BALL_TYPE.RUN, value: v })));
const nbThenBowled = () => [...open(), ...runs(1), ...at(ball({ type: BALL_TYPE.NO_BALL }), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }))];

// ── A. The catalogue ──────────────────────────────────────────────
group("A. The catalogue: one list, in both languages");
{
  ok("catalogueString() is the pinned string db/99 §39 compares with", catalogueString() === CATALOGUE, catalogueString());
  const keys = Object.keys(CONDITION);
  ok(`${keys.length} keys, every part one of play, table, sheet`, keys.length === 31
     && Object.values(CONDITION).every((c) => ["play", "table", "sheet"].includes(c.part)));
  ok("the phase 1 readers' keys are in it: free hit, overs, innings cap",
     ["format.free_hit", "format.overs_per_innings", "bowling.max_overs_per_bowler_innings"].every((k) => CONDITION[k]?.part === "play"));
  ok("bowling.limit is the one key by age band", keys.filter((k) => CONDITION[k].byAgeBand).join() === "bowling.limit");
  ok("a reserved key is read by nothing", CONDITION["over.max_balls"].readers.length === 0 && CONDITION["pitch.length_m"].readers.length === 0);
  ok("jsonbText prints as Postgres prints a jsonb", jsonbText(["points", "wins"]) === '["points", "wins"]' && jsonbText(false) === "false"
     && jsonbText({ spell: 6, day: 12 }) === '{"day": 12, "spell": 6}' && jsonbText("none") === '"none"');

  // db/61 writes the catalogue by migration: every key here is inserted
  // there, and none there is missing here.
  const sql = readFileSync(new URL("../../../db/61_playing_conditions.sql", import.meta.url), "utf8");
  const insert = sql.slice(sql.indexOf("INSERT INTO playing_condition_key"), sql.indexOf("ON CONFLICT (key)", sql.indexOf("INSERT INTO playing_condition_key")));
  const listed = [...insert.matchAll(/^\s*\('([a-z_.]+)'/gm)].map((m) => m[1]).sort();
  ok("db/61 inserts exactly these keys", JSON.stringify(listed) === JSON.stringify([...keys].sort()), listed);
}

// ── B. The deny-list ──────────────────────────────────────────────
group("B. The deny-list: no key may need a child's race");
{
  ok("quota., transformation. and race. are refused", ["quota.x", "transformation.black_players", "race.a"].every((k) => !conditionKeyAllowed(k)));
  ok("...by prefix, and the list is those three", CONDITION_DENY_PREFIXES.join() === "quota.,transformation.,race.");
  ok("a key must be dotted lower-case words", !conditionKeyAllowed("Format.Kind") && !conditionKeyAllowed("format") && !conditionKeyAllowed("")
     && !conditionKeyAllowed(null) && conditionKeyAllowed("format.free_hit"));
  ok("every catalogue key passes its own rule", Object.keys(CONDITION).every(conditionKeyAllowed));
  const sql = readFileSync(new URL("../../../db/61_playing_conditions.sql", import.meta.url), "utf8");
  ok("db/61's CHECK is the same deny-list", sql.includes("key !~ '^(quota|transformation|race)\\.'"));
}

// ── C. The readers ────────────────────────────────────────────────
group("C. The readers: a document's answer, else today's rule");
{
  const got = CASES.map(([k, doc, f, ov]) => `${k}:${freeHit(doc, f)}/${oversPerInnings(doc, { overs: ov })}`).join(" ");
  ok("the parity list reads PARITY (db/99 §39 reads it through play_free_hit() and play_overs())", got === PARITY, got);
  const formats = ["T20", "One-Day", "50-over", null, "", ...DECLARATION_FORMATS];
  ok("no document is the format's answer, for every format", formats.every((f) => freeHit({}, f) === freeHitsApply(f) && freeHit(null, f) === freeHitsApply(f)));
  ok("freeHit({}, \"Two-Day\") is freeHitsApply(\"Two-Day\")", freeHit({}, "Two-Day") === false && freeHitsApply("Two-Day") === false);
  ok("the innings_start's overs win; the document fills only a missing one; else 20",
     oversPerInnings({ "format.overs_per_innings": 50 }, { overs: 20 }) === 20 && oversPerInnings({ "format.overs_per_innings": 50 }, {}) === 50
     && oversPerInnings({}, {}) === 20 && oversPerInnings(undefined, undefined) === 20);
  ok("conditionsOf: the context's object, else {}", Object.keys(conditionsOf({})).length === 0 && Object.keys(conditionsOf(null)).length === 0
     && conditionsOf({ conditions: { a: 1 } }).a === 1 && Object.keys(conditionsOf({ conditions: [1] })).length === 0);
  ok("the innings cap: a whole number of overs, else none (D5)", bowlerInningsCap({ "bowling.max_overs_per_bowler_innings": 4 }) === 4
     && bowlerInningsCap({}) === null && bowlerInningsCap({ "bowling.max_overs_per_bowler_innings": "4" }) === null);
  ok("bowling.limit by band; a band it does not name is null (the directive applies)",
     JSON.stringify(bowlingLimit({ "bowling.limit": { U15: { spell: 6, day: 12 } } }, "U15")) === '{"spell":6,"day":12}'
     && bowlingLimit({ "bowling.limit": { U15: { spell: 6, day: 12 } } }, "U14") === null && bowlingLimit({}, "U15") === null);
}

// ── D. The fold ───────────────────────────────────────────────────
group("D. The fold: the document's free hit, both ways round, every fold alike");
{
  const log = nbThenBowled();
  const t20 = { format: "T20", conditions: { "format.free_hit": false }, conditionsHash: "h-t20" };
  const decl = { format: "One-Day Declaration", conditions: { "format.free_hit": true }, conditionsHash: "h-decl" };
  const a = deriveInnings(log, t20), b = deriveInnings(log, decl);
  ok("a T20 under free_hit = false: no free hit, the bowled stands, the bowler's", a.freeHits === false && a.wickets === 1
     && !a.ballLog.at(-1)?.freeHitSaved && a.bowlers[0].wickets === 1);
  ok("a declaration match under free_hit = true: the no-ball gives one, the bowled batter is saved", b.freeHits === true && b.wickets === 0
     && b.ballLog.at(-1)?.freeHitSaved === true);
  ok("the same log with no document: the format's answer (T20 saves, declaration stands)",
     deriveInnings(log, { format: "T20" }).wickets === 0 && deriveInnings(log, { format: "One-Day Declaration" }).wickets === 1);
  for (const [label, ctx, w] of /** @type {const} */ ([["T20, free_hit false", t20, 1], ["declaration, free_hit true", decl, 0]])) {
    ok(`${label}: MatchFold (the server), deriveInningsList (the pad) and deriveMatch agree`,
       new MatchFold(log, ctx).view().innings[0].wickets === w && deriveInningsList([log], ctx)[0]?.wickets === w
       && deriveMatch(log, ctx).innings[0].wickets === w);
  }
  // D1: the Laws do not read conditions. A bowler past a four-over cap is
  // recorded; the same event, the same answer, with and without the cap.
  const capped = { conditions: { "bowling.max_overs_per_bowler_innings": 1 } };
  const one = [...open(), ...runs(0, 0, 0, 0, 0, 0), ...at(bowler({ bowler: "w2" })), ...runs(0, 0, 0, 0, 0, 0)];
  const next = { ...at(bowler({ bowler: "w1" }))[0] };
  ok("conditions never refuse (D1): a bowler past the innings cap is not a refusal",
     lawsRefusal(new MatchFold(one, capped).view(), next) === null && lawsRefusal(new MatchFold(one, {}).view(), next) === null);
  ok("the innings still ends at its innings_start's overs, whatever the document says (§3.7)",
     deriveInnings(open(2), { conditions: { "format.overs_per_innings": 50 } }).overs === 2
     && deriveInnings(open(undefined).map((e) => (e.kind === "innings_start" ? { ...e, overs: undefined } : e)), { conditions: { "format.overs_per_innings": 25 } }).overs === 25);
}

// ── E. Nothing already scored moves ───────────────────────────────
group("E. No document is today's behaviour, byte for byte (D4) — and the check can fail");
{
  // A seed-like log: the seeded fixture's shape (runs and two wickets), with
  // the no-ball the free-hit check needs to be able to go red.
  const seedLike = [...open(), ...runs(1, 4, 0, 2, 6, 1), ...at(ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" })),
    ...at(batters({ striker: "p3", nonStriker: "p1" })), ...runs(0, 1),
    ...at(ball({ type: BALL_TYPE.NO_BALL, value: 1 }), ball({ type: BALL_TYPE.WICKET, dismissal: "caught" })), ...runs(3)];
  for (const fmt of ["T20", "Two-Day", undefined]) {
    const base = /** @type {any} */ (fmt ? { format: fmt } : {});
    const absent = JSON.stringify(deriveMatch(seedLike, base));
    const empty = JSON.stringify(deriveMatch(seedLike, { ...base, conditions: {} }));
    const nul = JSON.stringify(deriveMatch(seedLike, { ...base, conditions: null }));
    ok(`${fmt ?? "no format"}: conditions absent, {} and null fold byte for byte alike`, absent === empty && absent === nul);
    const server = JSON.stringify(new MatchFold(seedLike, base).view());
    ok(`${fmt ?? "no format"}: ...and the server's fold likewise`, server === JSON.stringify(new MatchFold(seedLike, { ...base, conditions: {} }).view()));
    // The document the resolver writes for such a fixture says what the
    // format says: the same fold.
    const resolved = JSON.stringify(deriveMatch(seedLike, { ...base, conditions: { "format.free_hit": freeHitsApply(fmt) } }).innings.map((i) => ({ ...i, conditions: {} })));
    ok(`${fmt ?? "no format"}: a document that says what the format says folds the same figures`,
       resolved === JSON.stringify(deriveMatch(seedLike, base).innings));
    // Falsified: the other free hit moves a figure.
    const flipped = deriveMatch(seedLike, { ...base, conditions: { "format.free_hit": !freeHitsApply(fmt) } }).innings[0];
    ok(`${fmt ?? "no format"}: forced the other way, the check goes red (the wicket after the no-ball)`,
       flipped.wickets !== deriveMatch(seedLike, base).innings[0].wickets);
  }
}

// ── F. rulesOf, the commentary, the hash ──────────────────────────
group("F. rulesOf() and the commentary carry the conditions; the hash is stamped");
{
  const log = nbThenBowled();
  const ctx = { format: "T20", conditions: { "format.free_hit": false }, conditionsHash: "abc123" };
  const inn = deriveInnings(log, ctx);
  ok("every innings carries the hash and the document it was folded with", inn.conditionsHash === "abc123" && inn.conditions["format.free_hit"] === false
     && new MatchFold(log, ctx).view().innings[0].conditionsHash === "abc123");
  ok("no document: hash null, conditions {}", deriveInnings(log).conditionsHash === null && Object.keys(deriveInnings(log).conditions).length === 0);
  const r = rulesOf([inn]);
  ok("rulesOf() hands the conditions and the hash on", r.conditions?.["format.free_hit"] === false && r.conditionsHash === "abc123"
     && deriveInnings(log, r).wickets === 1);
  ok("rulesOf() with no document is the context it always was", JSON.stringify(rulesOf([deriveInnings(log, { format: "T20" })])) === JSON.stringify({ edition: 4 }));
  const said = deriveCommentary(log, { ctx }).map((c) => c.text).join(" ");
  ok("the commentary folds as the scorecard does: no free hit under the document", !/free hit/i.test(said), said);
}

// ── G. The pad's words and the fixture's pre-fill ─────────────────
group("G. The pad's words (never a refusal) and the fixture screen's pre-fill");
{
  const c4 = { "bowling.max_overs_per_bowler_innings": 4 };
  ok("no cap, no words", capWords(24, {}) === null && capWords(18, null) === null);
  ok("one over short: 'Has 1 over left (4 an innings)'", capWords(18, c4) === "Has 1 over left (4 an innings)");
  ok("at the cap: 'Has bowled his 4 overs'", capWords(24, c4) === "Has bowled his 4 overs");
  ok("past it: recorded, and said", capWords(26, c4) === "4.2 overs; the conditions allow 4" && capWords(30, c4) === "5 overs; the conditions allow 4");
  ok("nothing to say earlier in his spell", capWords(12, c4) === null && capWords(20, c4) === null);
  ok("an unconfirmed figure says so", capWords(24, c4, { unconfirmed: true }) === "Has bowled his 4 overs (platform default, unconfirmed)");
  const pre = (/** @type {any} */ c, /** @type {any} */ f) => JSON.stringify(fixtureFormatFrom(c, f));
  ok("20 overs, limited: T20", pre({ "format.kind": "limited", "format.overs_per_innings": 20 }) === '{"format":"T20","overs":20}');
  ok("50 overs: One-Day", pre({ "format.overs_per_innings": 50 }) === '{"format":"One-Day","overs":50}');
  ok("25 overs in a T20 league: T20 at 25", pre({ "format.kind": "limited", "format.overs_per_innings": 25 }, "T20") === '{"format":"T20","overs":25}');
  ok("declaration, two innings a side: Two-Day", pre({ "format.kind": "declaration", "format.innings_per_side": 2, "format.overs_per_innings": 80 }) === '{"format":"Two-Day","overs":80}');
  ok("declaration: One-Day Declaration", pre({ "format.kind": "declaration" }) === '{"format":"One-Day Declaration","overs":null}');
  ok("nothing stated: the competition's own format, or nothing", pre({}, "50-over") === '{"format":"One-Day","overs":null}'
     && pre({}, "multi-day") === '{"format":"Two-Day","overs":null}' && pre({}, null) === '{"format":null,"overs":null}');
}

console.log("\n" + "─".repeat(52));
console.log(`CONDITIONS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
