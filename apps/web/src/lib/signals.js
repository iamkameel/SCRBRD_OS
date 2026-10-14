/**
 * THE INTELLIGENCE FEED — the rules (SCRBRD-137 phase A,
 * docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md §4).
 *
 * A signal is a sentence the data can prove: "the bus seats 22 and 25 are
 * named". Each rule below is a PURE FUNCTION over the reads the cockpit has
 * already fetched, evaluated in the browser when the drawer opens (D12). No
 * rule scores, weights or ranks anything; a rule with nothing true behind it
 * draws no card. Each card carries its evidence as text, a count, the read it
 * came from and the capabilities that let this reader see it.
 *
 * WHAT THIS MODULE DOES NOT DO, ON PURPOSE
 *   - It pushes nothing and writes nothing (D11, A4). A card reaches no parent
 *     and no pupil: the drawer sits behind the cockpit's entry rule.
 *   - It never reads a reason for an absence, an injury's nature, a ratio, a
 *     check-in or a flag, or whether a boy is monitored (D4, D5). The static
 *     check in apps/web/test/signals.test.mjs holds the source to that.
 *   - It builds none of the eight refused signals (§4.4). S2c, the directive's
 *     day across two matches, is phase B's (docs/design/SCRBRD-136-137_phaseB.md
 *     §1.5) over the `bowler_day` read (db/94). The lift rules show a head
 *     count; the office's S4b shows names to the office only (D10).
 *   - "Dismiss" is "I have seen this" (D13): per person, per evidence, held by
 *     the caller. It changes no row and tells nobody.
 *
 * Pure, so every rule is proved under plain node
 * (apps/web/test/signals.test.mjs): no DOM, no database, no clock.
 */
import { busOf, isMatchDay, isSoon, saTime, shortDate, LOAD_SENTENCE, weatherWords } from "./cockpit.js";
import { EXCEPTION_WORDS } from "./liftWords.js";
import { matchupTypes } from "./captain.js";
import { clockWords } from "./corrections.js";

/** The matchup floor (D14): thirty balls against a type, the dossier's own floor for a strike rate. */
export const MATCHUP_FLOOR = 30;
/** A dismissed matchup returns when the balls behind it have grown by this many. */
export const MATCHUP_GROWTH = 6;
/** A side of eleven. */
export const SIDE = 11;

/**
 * The rules, in the fixed order the drawer draws them in, each with the
 * capabilities that let a reader see it (the granting capability is part of
 * the answer, ADR 0001) and the read it came from.
 */
export const RULES = Object.freeze({
  S1:  { title: "The bus is short",                          via: ["transport.read", "team.read"],                source: "trips, match_squad, lift_expected" },
  S2a: { title: "A bowler at the competition's cap",         via: ["fixture.read"],                               source: "the fold, the frozen conditions" },
  S2b: { title: "A bowler at the directive's spell",         via: ["player.workload.read"],                       source: "bowling_spells" },
  S2c: { title: "A bowler at the day's limit",               via: ["player.workload.read"],                       source: "bowler_day, the frozen conditions" },
  S3:  { title: "A picked boy may not be available",         via: ["team.select", "availability.read"],           source: "readiness" },
  S4a: { title: "Lifts to chase",                            via: ["transport.lift.receive"],                     source: "lift_expected" },
  S4b: { title: "A lift exception",                          via: ["transport.lift.oversee"],                     source: "lift_exceptions" },
  S5:  { title: "A matchup with enough balls to mean something", via: ["player.performance.read"],                source: "matchups, matchup_coverage" },
  S6:  { title: "The sheet is thin",                         via: ["team.select"],                                source: "match_squad" },
  S7:  { title: "Unanswered",                                via: ["availability.read", "team.read"],             source: "readiness" },
  S8:  { title: "Nobody on record",                          via: ["fixture.read"],                               source: "match_duties" },
  S9:  { title: "Weather",                                   via: ["fixture.read"],                               source: "weather" },
  S10: { title: "No playing conditions",                     via: ["fixture.read"],                               source: "playing-conditions" },
  S11: { title: "A bowler's week",                           via: ["player.workload.read"],                       source: "workload" },
  S12: { title: "A notice for this fixture",                 via: ["news.read"],                                  source: "notifications" },
});

/** The order of the rules, for sorting and for the test that holds the list whole. */
export const RULE_ORDER = Object.freeze(Object.keys(RULES));

/**
 * THE EVIDENCE TRAIL (GA-I27 slice 1, C1; docs/design/GA-I27_coach_cards.md
 * §1.2, §2): what each card's working stands on. The trail is a view of the
 * rows the rule already read, in the browser (C-D2): no new read, no new
 * gate, no row. Per rule, the read it names (one of its `source` names; "fold"
 * for the frozen log), the window and the denominator in words, the reads
 * whose answer time is its "as at", whether it stands on the match's log (and
 * so says the head `seq`, GA-I36 D1), and the existing screen that holds the
 * rest (C-D3), opened under the screen's own gate. The figures are each
 * rule's own, passed to card() beside its lines.
 */
const TRAINING = { route: "training", label: "Open the load on Training" };
const SQUAD = { route: "squad", label: "Open Squad" };
const LIFTS = { route: "squad", label: "Open the lifts on Squad" };
export const TRAILS = Object.freeze({
  S1:  { read: "trips",              reads: ["trips", "match_squad", "lift_expected"], window: "this fixture",                      denominator: "seats on the bus, boys named",          unit: "boys",  screen: { route: "logistics", section: "transport", label: "Open Transport" } },
  S2a: { read: "fold",               reads: ["fold"],                 window: "this innings",                       denominator: "balls bowled, against the frozen conditions", unit: "balls", fold: true, screen: { route: "scorecard", label: "Open the scorecard" } },
  S2b: { read: "bowling_spells",     reads: ["bowling_spells"],       window: "the open spell",                     denominator: "overs, of the directive's spell",     unit: "overs", fold: true, screen: TRAINING },
  S2c: { read: "bowler_day",         reads: ["bowler_day"],           window: "the fixture's date, every match",    denominator: "overs, of the day's limit",           unit: "overs", screen: TRAINING },
  S3:  { read: "readiness",          reads: ["readiness"],            window: "this fixture",                       denominator: null,                                  unit: null,    screen: SQUAD },
  S4a: { read: "lift_expected",      reads: ["lift_expected"],        window: "the fixture's day",                  denominator: "lifts and the boys in them",          unit: "lifts", screen: LIFTS },
  S4b: { read: "lift_exceptions",    reads: ["lift_exceptions"],      window: "the fixture's day",                  denominator: null,                                  unit: null,    screen: LIFTS },
  S5:  { read: "matchups",           reads: ["matchups", "matchup_coverage"], window: "every match of his you may read", denominator: "balls attributable, of the balls he faced", unit: "balls", screen: { route: "profile", label: "Open his profile" } },
  S6:  { read: "match_squad",        reads: ["match_squad"],          window: "this fixture",                       denominator: `of a side of ${SIDE}`,                unit: "boys",  screen: SQUAD },
  S7:  { read: "readiness",          reads: ["readiness"],            window: "this fixture",                       denominator: null,                                  unit: null,    screen: SQUAD },
  S8:  { read: "match_duties",       reads: ["match_duties"],         window: "this fixture",                       denominator: "the scorer's and the umpire's slots", unit: null,    screen: { route: "duties", label: "Open the duties" } },
  S9:  { read: "weather",            reads: ["weather"],              window: "the fixture's day",                  denominator: "the read's own words",                unit: null,    screen: null },
  S10: { read: "playing-conditions", reads: ["playing-conditions"],   window: "this fixture",                       denominator: "the conditions document",             unit: null,    screen: { route: "competitions", label: "Open the conditions" } },
  S11: { read: "workload",           reads: ["workload"],             window: "the 7 days to today",                denominator: "overs begun, every match",            unit: "overs", screen: TRAINING },
  S12: { read: "notifications",      reads: ["notifications"],        window: "as published",                       denominator: null,                                  unit: null,    screen: { route: "notifications", label: "Open Alerts" } },
});

/**
 * @typedef {object} Card
 * @property {string} rule     "S1" … "S12"
 * @property {string} base     what a dismissal is filed under: the rule and the thing it is about
 * @property {string} key      the evidence: a dismissal holds only while this is unchanged
 * @property {string} title
 * @property {string[]} lines  the evidence, as text
 * @property {number} count    the number the evidence carries
 * @property {string[]} via    the capabilities that let this reader see it
 * @property {string} source   the read it came from
 * @property {boolean} dismissable
 * @property {number} [growth] a dismissal holds until `count` has grown by this much (S5)
 * @property {Evidence} evidence the card's working: the figures it stands on, from the rows the rule read (GA-I27)
 */

/**
 * @typedef {{label: string, value: string | number, unit?: string}} Figure
 * @typedef {object} Evidence
 * @property {string} read          the read's name as read-api names it, or "fold" for the match's log
 * @property {Record<string, string | number>} params  what the read was about; a boy only when the card names him
 * @property {string} window        words
 * @property {string | null} denominator  words, or null where the figure is a count of rows
 * @property {string | null} unit
 * @property {Figure[]} figures     drawn only from fields the rule read
 * @property {number | null} asOf   ms: when the oldest of its reads answered (Ctx.at), stamped by evaluate()
 * @property {number | null} head   the match's head seq, fold-derived cards only (Ctx.head), stamped by evaluate()
 * @property {{route: string, label: string, section?: string} | null} screen  an existing screen, opened under its own gate
 */

/**
 * @param {string} rule  @param {string} base  @param {string} key  @param {string[]} lines
 * @param {number} count  @param {{dismissable?: boolean, growth?: number, via?: string[], figures?: (Figure | null | false)[], params?: Record<string, string | number>}} [o]
 * @returns {Card}
 */
const card = (rule, base, key, lines, count, o = {}) => ({
  rule, base, key, title: RULES[/** @type {keyof typeof RULES} */ (rule)].title, lines: lines.filter(Boolean), count,
  via: o.via ?? [...RULES[/** @type {keyof typeof RULES} */ (rule)].via], source: RULES[/** @type {keyof typeof RULES} */ (rule)].source,
  dismissable: o.dismissable !== false, ...(o.growth ? { growth: o.growth } : {}),
  evidence: trail(rule, o.figures ?? [], o.params ?? {}),
});

/** A card's trail before evaluate() stamps its time: the rule's TRAILS row and its own figures. @param {string} rule @param {(Figure | null | false)[]} figures @param {Record<string, string | number>} params @returns {Evidence} */
function trail(rule, figures, params) {
  const t = TRAILS[/** @type {keyof typeof TRAILS} */ (rule)];
  return { read: t.read, params, window: t.window, denominator: t.denominator, unit: t.unit,
    figures: /** @type {Figure[]} */ (figures.filter(Boolean)), asOf: null, head: null, screen: t.screen };
}

/** A figure: a label, the value as the row has it, and its unit where it has one. @param {string} label @param {string | number} value @param {string} [unit] @returns {Figure} */
const fig = (label, value, unit) => (unit ? { label, value, unit } : { label, value });
/** The unit for a count: "1 ball", "2 balls". @param {number} n @param {string} one @param {string} [many] */
const per = (n, one, many = `${one}s`) => (n === 1 ? one : many);
/** Yes, no, or not said, for a field that may be absent. @param {boolean | null | undefined} b */
const yesNo = (b) => (b === true ? "yes" : b === false ? "no" : "not said");

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the rules are given. Every read is `null` when it did not answer (a
 * failed read is not an empty one: a rule over it does not fire) and the rows
 * are the reads' own, adapted (lib/live.js).
 * @typedef {object} Ctx
 * @property {number} now  ms
 * @property {any} match
 * @property {{end: "home" | "away", school: string, teamCode: string | null, panels: Record<string, boolean>}} gate
 * @property {any[] | null} squad       match_squad
 * @property {any[] | null} readiness
 * @property {any[] | null} workload
 * @property {any[] | null} spells      bowling_spells
 * @property {any[] | null} [bowlerDay] bowler_day: each boy's overs on the fixture's date, every match (read only while our side fields)
 * @property {((band: string) => number | null) | null} [docDayFor] this fixture's competition day figure for a band (bowlingLimit over the frozen conditions), or null
 * @property {any[] | null} trips
 * @property {{boys: Set<string>, count: number, lifts: number, notLeft: number, handedOverUnconfirmed: number} | null} lifts  liftCounts()
 * @property {any[] | null} liftExceptions
 * @property {any | null} weather
 * @property {any[] | null} duties      match_duties
 * @property {{state: "set" | "defaults" | "failed", cap: number | null, freeHit: boolean | null}} conditions  conditionsState()
 * @property {any[] | null} notices
 * @property {Record<string, {rows: any[], coverage: {attributable: number, deliveries: number} | null}> | null} matchups
 * @property {{inn: any, i: number, inPlay: boolean}[]} fielding  our fielding innings
 * @property {((balls: number) => string | null) | null} capFor  the pad's cap sentence for the frozen conditions
 * @property {Record<string, number> | null} [at]  when each read answered (ms), by the read's name; "fold" is the match's log (GA-I27 §4.1)
 * @property {number | null} [head]  the match's head seq: the highest the log has reached (GA-I36 D1)
 */

const ours = (/** @type {Ctx} */ c) => (c.squad ?? []).filter((r) => r.side === c.gate.end);
const named = (/** @type {Ctx} */ c) => ours(c).filter((r) => !r.twelfth);

// ── S1 · The bus is short ──────────────────────────────

/** @param {Ctx} c @returns {Card[]} */
export function ruleS1(c) {
  const p = c.gate.panels;
  if (!p.bus || !p.team || !c.squad || !c.trips) return [];
  const bus = busOf(c.trips, c.gate.school);
  if (!bus || !(bus.capacity > 0)) return [];
  const all = ours(c);
  const ids = new Set(all.map((r) => r.playerId));
  // The lifts are counted only for a reader who holds the lift capability and whose read answered.
  const byLift = p.lifts && c.lifts ? [...c.lifts.boys].filter((id) => ids.has(id)).length : null;
  const travelling = all.length - (byLift ?? 0);
  const short = Math.max(0, travelling - bus.capacity);
  const over = Math.max(0, bus.seatsTaken - bus.capacity);
  if (!short && !over) return [];
  // A reader who may count lifts, whose lift read has not answered, is not told the bus is short.
  if (p.lifts && c.lifts == null) return [];
  const head = byLift == null
    ? `Bus seats ${bus.capacity} · ${all.length} named (lifts not counted)`
    : `Bus seats ${bus.capacity} · ${all.length} named, ${byLift} by lift → ${travelling} travelling`;
  return [card("S1", "S1", `S1:${bus.capacity}/${all.length}/${byLift ?? "x"}/${bus.seatsTaken}`,
    [head, over ? `${bus.seatsTaken} seats are marked taken on a bus of ${bus.capacity}` : null], Math.max(short, over), { figures: [
      fig("seats on the bus", bus.capacity, per(bus.capacity, "seat")),
      fig("seats marked taken", bus.seatsTaken, per(bus.seatsTaken, "seat")),
      fig("named", all.length, per(all.length, "boy")),
      byLift == null ? fig("by lift", "not counted") : fig("by lift", byLift, per(byLift, "boy")),
      fig("travelling by bus", travelling, per(travelling, "boy")),
    ] })];
}

// ── S2a · A bowler at the competition's cap ────────────

const pastCap = (/** @type {string} */ w) => /the conditions allow/.test(w);

/** The cap's own sentence beside each bowler (capWords, verbatim), while he is in play and after if he went past it. @param {Ctx} c @returns {Card[]} */
export function ruleS2a(c) {
  if (!c.gate.panels.day || typeof c.capFor !== "function") return [];
  const out = [];
  for (const { inn, i, inPlay } of c.fielding ?? []) {
    for (const b of inn?.bowlers ?? []) {
      if (!(b.balls > 0)) continue;
      const words = c.capFor(b.balls);
      if (!words || (!inPlay && !pastCap(words))) continue;
      out.push(card("S2a", `S2a:${i}:${b.id}`, `S2a:${i}:${b.id}:${words}`, [`${b.name} · ${words}`], 1, { dismissable: !inPlay,
        figures: [fig("balls bowled", b.balls, per(b.balls, "ball")), fig("the conditions", words)], params: { innings: i, playerId: b.id } }));
    }
  }
  return out;
}

// ── S2b · A bowler at the directive's spell ────────────

/** @param {Ctx} c @returns {Card[]} */
export function ruleS2b(c) {
  if (!c.gate.panels.load || !c.spells) return [];
  const out = [];
  for (const { inn, i, inPlay } of c.fielding ?? []) {
    if (!inPlay || inn?.bowler == null) continue;             // an open spell is the bowler on now
    const mine = c.spells.filter((s) => s.bowlerId === inn.bowler && s.innings === i);
    const open = mine.sort((a, b) => b.spellNo - a.spellNo)[0];
    if (!open || open.pace !== true || open.maxSpell == null || open.overs < open.maxSpell - 1) continue;
    const who = inn.bowlers?.find((/** @type {any} */ b) => b.id === open.bowlerId)?.name ?? open.name;
    out.push(card("S2b", `S2b:${i}:${open.bowlerId}`, `S2b:${i}:${open.bowlerId}:${open.spellNo}:${open.overs}`,
      [`${who} · spell ${open.overs} of ${open.maxSpell} (${open.ageBand ? `${open.ageBand} ` : ""}directive)`], 1, { dismissable: false,
        figures: [fig("spell", open.spellNo), fig("overs in it", open.overs, per(open.overs, "over")), fig("the directive's spell", open.maxSpell, per(open.maxSpell, "over")),
          open.ageBand ? fig("age band", open.ageBand) : null], params: { innings: i, playerId: open.bowlerId } }));
  }
  return out;
}

// ── S2c · A bowler at the directive's day ──────────────

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * A boy who may bowl in this innings, one over from the directive's day or
 * past it, counting every match he has bowled in on the fixture's date
 * (phase B §1.5). The day's figure is the directive's, from `bowler_day`
 * (db/94), as S2b's spell is: the read is the boy's, so it is asked of
 * player.workload.read and a reader without it has no row to draw. In play
 * only, and never dismissable: it clears with his next over, and after the
 * innings the record of a day passed is bowling_breach's (P9). It says the
 * figure and its source and never a reason, a guideline, the other match's
 * name or "stop".
 * @param {Ctx} c @returns {Card[]}
 */
export function ruleS2c(c) {
  if (!c.gate.panels.load || !c.bowlerDay) return [];
  const out = [];
  for (const { inn, i, inPlay } of c.fielding ?? []) {
    if (!inPlay) continue;
    // Who may bowl in it: our named side, and anyone who already has.
    const may = new Set([...named(c).map((r) => r.playerId), ...(inn?.bowlers ?? []).map((/** @type {any} */ b) => b.id)]);
    for (const d of c.bowlerDay) {
      if (!may.has(d.playerId)) continue;
      // Tightest wins (Kameel, 14 Oct, #141): the directive's day (a pace
      // bowler's only) against this fixture's competition figure for his band,
      // where its frozen conditions name one (for every bowler, as bandLine
      // says it). The lower is the limit, and the card says whose it is.
      const dir = d.pace === true && d.maxDay != null ? d.maxDay : null;
      const doc = d.ageBand && typeof c.docDayFor === "function" ? c.docDayFor(d.ageBand) : null;
      const max = dir == null ? doc : doc == null ? dir : Math.min(dir, doc);
      if (max == null || !(d.oversToday >= max - 1)) continue;
      const whose = doc != null && (dir == null || doc < dir) ? "competition" : "directive";
      const who = inn?.bowlers?.find((/** @type {any} */ b) => b.id === d.playerId)?.name ?? d.name;
      const matches = d.matchesToday > 1 ? `, ${NUMBER_WORDS[d.matchesToday] ?? d.matchesToday} matches` : "";
      const line = d.oversToday >= max
        ? `${who} · ${d.oversToday} of ${max} today`
        : `${who} · ${d.oversToday} of ${max} today${matches} (${d.ageBand ? `${d.ageBand} ` : ""}${whose})`;
      out.push(card("S2c", `S2c:${i}:${d.playerId}`, `S2c:${i}:${d.playerId}:${d.oversToday}:${max}`, [line], d.oversToday, { dismissable: false,
        figures: [fig("overs today", d.oversToday, per(d.oversToday, "over")), fig("the day's limit", max, per(max, "over")), fig("whose limit", whose),
          fig("matches today", d.matchesToday ?? 1), d.ageBand ? fig("age band", d.ageBand) : null], params: { innings: i, playerId: d.playerId } }));
    }
  }
  return out;
}

// ── S3 · A picked boy may not be available ─────────────

/** @param {Ctx} c @returns {Card[]} */
export function ruleS3(c) {
  const p = c.gate.panels;
  if (!p.select || !p.side || !c.readiness) return [];
  return c.readiness.filter((r) => r.selected && (r.side == null || r.side === c.gate.end)).flatMap((r) => {
    const restricted = p.status && r.clinicallyRestricted === true;
    const state = restricted ? "restricted" : r.declaredStatus === "unavailable" ? "unavailable" : r.declaredStatus === "needs_reconfirming" ? "again" : null;
    if (!state) return [];
    const said = r.selfDeclared ? "said himself" : r.declaredByName ? `said by ${r.declaredByName}` : "said by the family";
    const line = state === "restricted" ? `${r.name} · restricted${r.returnDate ? ` · back ${shortDate(r.returnDate)}` : ""}`
      : state === "unavailable" ? `${r.name} · on the sheet · marked unavailable (${said})`
      : `${r.name} · on the sheet · asked again: the fixture has moved`;
    return [card("S3", `S3:${r.playerId}`, `S3:${r.playerId}:${state}:${restricted ? r.returnDate ?? "" : ""}`, [line], 1, {
      figures: [fig("on the sheet", "yes"), fig("state", state === "again" ? "asked again" : state),
        state === "unavailable" ? fig("who said it", said) : null,
        state === "restricted" && r.returnDate ? fig("back", shortDate(r.returnDate) ?? "not said") : null], params: { playerId: r.playerId } })];
  });
}

// ── S4a · Lifts to chase ───────────────────────────────

/** Head count only (D10): no name, no driver, no number. @param {Ctx} c @returns {Card[]} */
export function ruleS4a(c) {
  if (!c.gate.panels.lifts || !c.lifts || !isMatchDay(c.match, c.now)) return [];
  const l = c.lifts;
  if (!l.notLeft && !l.handedOverUnconfirmed) return [];
  return [card("S4a", "S4a", `S4a:${l.count}/${l.notLeft}/${l.handedOverUnconfirmed}`, [
    `${l.count} arriving by lift`,
    l.notLeft ? `${plural(l.notLeft, "lift")} not marked as leaving` : null,
    l.handedOverUnconfirmed ? `${l.handedOverUnconfirmed} handed over, not yet confirmed` : null,
  ], l.count, { figures: [fig("arriving by lift", l.count, per(l.count, "boy")), fig("not marked as leaving", l.notLeft, per(l.notLeft, "lift")),
    fig("handed over, not yet confirmed", l.handedOverUnconfirmed, per(l.handedOverUnconfirmed, "boy"))] })];
}

// ── S4b · A lift exception (the office's) ──────────────

/** By name, to the office only: `transport.lift.oversee`, which the coach does not hold (D10). @param {Ctx} c @returns {Card[]} */
export function ruleS4b(c) {
  if (!c.gate.panels.liftOffice || !c.liftExceptions) return [];
  return c.liftExceptions.map((r) => card("S4b", `S4b:${r.seatId}`, `S4b:${r.seatId}:${r.kind}`, [
    `${r.name} · ${/** @type {Record<string, string>} */ (EXCEPTION_WORDS)[r.kind] ?? r.kind}`,
    `${r.leg === "out" ? "To the fixture" : "Home"}${r.driverName ? ` with ${r.driverName}` : ""}${r.since ? ` · since ${saTime(r.since)}` : ""}`,
  ], 1, { figures: [fig("what", /** @type {Record<string, string>} */ (EXCEPTION_WORDS)[r.kind] ?? r.kind), fig("leg", r.leg === "out" ? "to the fixture" : "home"),
    r.since ? fig("since", saTime(r.since) ?? "not said") : null], params: { seatId: r.seatId } }));
}

// ── S5 · A matchup with enough balls ───────────────────

/** Before the match, our boys against pace or spin; thirty balls or nothing (D14). @param {Ctx} c @returns {Card[]} */
export function ruleS5(c) {
  if (!c.gate.panels.matchups || !c.matchups || c.match?.status !== "upcoming") return [];
  const out = [];
  for (const r of named(c)) {
    const m = c.matchups[r.playerId];
    if (!m) continue;
    for (const t of matchupTypes(m.rows)) {
      if (t.balls < MATCHUP_FLOOR) continue;
      const cov = m.coverage && m.coverage.deliveries > 0 ? `${m.coverage.attributable} of ${m.coverage.deliveries} balls attributable` : null;
      const has = !!(m.coverage && m.coverage.deliveries > 0);
      out.push(card("S5", `S5:${r.playerId}:${t.type}`, `S5:${r.playerId}:${t.type}:${t.balls}`, [
        `${r.name} v ${t.type} · ${plural(t.balls, "ball")} · ${plural(t.runs, "run")} · ${t.out === 0 ? "not out" : t.out === 1 ? "out once" : `out ${t.out} times`}`, cov,
      ], t.balls, { growth: MATCHUP_GROWTH, figures: [fig("against", t.type), fig("balls", t.balls, per(t.balls, "ball")), fig("runs", t.runs, per(t.runs, "run")),
        fig("out", t.out, t.out === 1 ? "time" : "times"),
        has ? fig("attributable", m.coverage.attributable, per(m.coverage.attributable, "ball")) : null,
        has ? fig("of the balls he faced", m.coverage.deliveries, per(m.coverage.deliveries, "ball")) : null], params: { playerId: r.playerId, type: t.type } }));
    }
  }
  return out;
}

// ── S6 · The sheet is thin ─────────────────────────────

/** @param {Ctx} c @returns {Card[]} */
export function ruleS6(c) {
  if (!c.gate.panels.select || !c.squad || !isSoon(c.match, c.now)) return [];
  const n = named(c).length;
  if (n >= SIDE) return [];
  return [card("S6", "S6", `S6:${n}`, [n === 0 ? "The sheet is empty" : `${n} named · a side needs ${SIDE}`], n, {
    figures: [fig("named", n, per(n, "boy")), fig("a side", SIDE, "boys")] })];
}

// ── S7 · Unanswered ────────────────────────────────────

/** A count, never a name and never a reason. @param {Ctx} c @returns {Card[]} */
export function ruleS7(c) {
  const p = c.gate.panels;
  if (!p.side || !c.readiness || !isSoon(c.match, c.now)) return [];
  const rows = c.readiness.filter((r) => r.team == null || c.gate.teamCode == null || r.team === c.gate.teamCode);
  const none = rows.filter((r) => r.declaredStatus == null).length;
  const again = rows.filter((r) => r.declaredStatus === "needs_reconfirming").length;
  if (!none && !again) return [];
  return [card("S7", "S7", `S7:${none}/${again}`, [
    none ? `${none} ${none === 1 ? "has" : "have"} not answered` : null,
    again ? `${again} to answer again (the fixture moved)` : null,
  ], none + again, { figures: [fig("not answered", none), fig("to answer again", again)] })];
}

// ── S8 · Nobody on record ──────────────────────────────

/** Scorer and umpire only: no read says how many a fixture ought to have. @param {Ctx} c @returns {Card[]} */
export function ruleS8(c) {
  if (!c.gate.panels.day || !c.duties || !isSoon(c.match, c.now)) return [];
  const has = new Set(c.duties.map((r) => r.duty));
  const day = shortDate(c.match.startsAt ?? c.match.date) ?? "the day";
  return ["scorer", "umpire"].filter((duty) => !has.has(duty))
    .map((duty) => card("S8", `S8:${duty}`, `S8:${duty}`, [`No ${duty} on record for ${day}`], 1, {
      figures: [fig("slot", duty), fig("on record", "nobody"), fig("the day", day)] }));
}

// ── S9 · Weather ───────────────────────────────────────

/** @param {Ctx} c @returns {Card[]} */
export function ruleS9(c) {
  const w = c.weather;
  if (!c.gate.panels.day || !w || !isSoon(c.match, c.now)) return [];
  const rain = w.rainChancePct != null && w.rainChancePct >= 40;
  if (!rain && w.playable !== false) return [];
  return [card("S9", "S9", `S9:${rain}:${w.playable}:${w.forecast ?? ""}`, [
    w.forecast ?? null,
    [weatherWords(w), rain && w.rainChancePct != null ? `${w.rainChancePct} in 100 chance of rain` : null].filter(Boolean).join(" · "),
  ], 1, { figures: [w.forecast ? fig("forecast", w.forecast) : null, w.rainChancePct != null ? fig("chance of rain", w.rainChancePct, "in 100") : null,
    fig("playable", yesNo(w.playable))] })];
}

// ── S10 · No playing conditions ────────────────────────

/**
 * The fixture is governed by no competition's conditions: the route answered
 * with the platform's defaults alone (no set, nothing fixed yet), so the pad
 * will play it under those. Said as what the document says, never as a
 * guess: a cap is named only if the document names one.
 * @param {Ctx} c @returns {Card[]}
 */
export function ruleS10(c) {
  if (!c.gate.panels.day || c.conditions?.state !== "defaults" || !isSoon(c.match, c.now)) return [];
  const { cap, freeHit } = c.conditions;
  return [card("S10", "S10", `S10:${cap ?? "x"}:${freeHit}`, [
    "No playing conditions are set for this fixture: the pad will use the platform defaults",
    [cap == null ? "no cap on a bowler's overs" : `${plural(cap, "over")} a bowler`,
      freeHit === true ? "a free hit after a no-ball" : freeHit === false ? "no free hit" : null].filter(Boolean).join(" · "),
  ], 1, { figures: [fig("conditions", "the platform defaults"), cap == null ? fig("cap", "none") : fig("cap", cap, `${per(cap, "over")} a bowler`),
    fig("free hit", yesNo(freeHit))] })];
}

// ── S11 · A bowler's week ──────────────────────────────

/** The word and the fixed sentence, for a pace bowler on the sheet; never a ratio (D7). @param {Ctx} c @returns {Card[]} */
export function ruleS11(c) {
  if (!c.gate.panels.load || !c.workload || !c.squad) return [];
  const sheet = new Set(named(c).map((r) => r.playerId));
  return c.workload.filter((w) => w.pace === true && sheet.has(w.playerId) && (w.loadWord === "rising" || w.loadWord === "spike"))
    .map((w) => card("S11", `S11:${w.playerId}`, `S11:${w.playerId}:${w.loadWord}`,
      [`${w.name} · ${plural(w.overs7d ?? 0, "over")} this week · ${w.loadWord}${w.estimated7d ? " (estimate)" : ""}`, LOAD_SENTENCE], 1, {
        figures: [fig("overs this week", w.overs7d ?? 0, per(w.overs7d ?? 0, "over")), fig("the word", w.loadWord), fig("an estimate", w.estimated7d ? "yes" : "no")],
        params: { playerId: w.playerId } }));
}

// ── S12 · A notice for this fixture ────────────────────

/** The kinds S12 shows, in D1's list (db/89). */
export const S12_KINDS = Object.freeze(["welfare", "notice", "lift"]);

/**
 * Welfare, selection and transport notices about this match, as published.
 * Nothing here is derived. In NOTIFICATIONS.md D1's closed list of kinds
 * (db/89) those are `welfare`, a person's `notice` (a selector's word about
 * the sheet) and `lift` (the transport notices db/70 and db/76 write); the
 * free-text `selection` and `transport` were never written by anything.
 * A tiered notice (welfare, lift) lists its title only, so its card is the
 * title; the body is read in Notices, on open, and logged (D17).
 * @param {Ctx} c @returns {Card[]}
 */
export function ruleS12(c) {
  if (!c.notices) return [];
  return c.notices.filter((n) => S12_KINDS.includes(n.type) && n.subjectKind === "match" && n.subjectId === c.match?.id)
    .map((n) => card("S12", `S12:${n.id}`, `S12:${n.id}`, [n.title, n.body].filter((x) => x != null && x !== ""), 1, {
      figures: [fig("kind", n.type)], params: { notificationId: n.id } }));
}

/** Every rule, in the fixed order. */
const EVALUATE = [ruleS1, ruleS2a, ruleS2b, ruleS2c, ruleS3, ruleS4a, ruleS4b, ruleS5, ruleS6, ruleS7, ruleS8, ruleS9, ruleS10, ruleS11, ruleS12];

/**
 * The feed: every rule over what the cockpit holds, in the rules' fixed order.
 * Nothing is scored or ranked; a card with nothing true behind it is not drawn.
 * @param {Ctx} c @returns {Card[]}
 */
export function evaluate(c) {
  if (!c?.gate || !c.match) return [];
  // A dismissal is filed under the fixture too: seeing "the bus is short" for Saturday says nothing of next week's.
  return EVALUATE.flatMap((rule) => rule(c)).map((k) => ({ ...k, base: `${c.match.id}:${k.base}`, evidence: stamp(k, c) }));
}

/**
 * The trail's time, from the context alone (this module has no clock): when
 * its reads answered, the oldest of them, so "as at" never claims a read is
 * newer than it is; and, for a card that stands on the match's log, the head
 * `seq` (GA-I36 D1). A read with no time is no "as at", never an invented one.
 * @param {Card} k @param {Ctx} c @returns {Evidence}
 */
function stamp(k, c) {
  const t = /** @type {{reads: string[], read: string, fold?: boolean}} */ (TRAILS[/** @type {keyof typeof TRAILS} */ (k.rule)]);
  const at = c.at ?? {};
  const times = t.reads.map((r) => at[r]).filter((x) => Number.isFinite(x));
  const asOf = Number.isFinite(at[t.read]) && times.length ? Math.min(...times) : null;
  const head = t.fold === true && Number.isFinite(c.head) ? /** @type {number} */ (c.head) : null;
  return { ...k.evidence, asOf, head };
}

/**
 * The trail's source line (GA-I27 §5.1): "workload · the 7 days to today ·
 * overs begun, every match · as at 14:02 · head 412". `now` is the context's,
 * so a read from another day says its date. No time, no "as at".
 * @param {Evidence} e @param {number} now @returns {string}
 */
export function trailLine(e, now) {
  const at = e.asOf != null ? clockWords(e.asOf, now) : "";
  return [e.read, e.window, e.denominator, at ? `as at ${at}` : null, e.head != null ? `head ${e.head}` : null].filter(Boolean).join(" · ");
}

// ── Dismissal: "I have seen this" (D13) ────────────────

/**
 * @typedef {Record<string, {key: string, count: number}>} Seen
 * What one person has seen, by what a card is about. Held by the caller, in
 * memory or the device's storage, per person; never sent anywhere.
 */

/** Has this person seen this evidence? A card comes back when its key changes, or (S5) when its count has grown. @param {Card} c @param {Seen} seen */
export function isSeen(c, seen) {
  const prev = seen?.[c.base];
  if (!prev) return false;
  if (c.growth) return c.count < prev.count + c.growth;
  return prev.key === c.key;
}

/** The store after this person sees the card. Pure. @param {Seen} seen @param {Card} c @returns {Seen} */
export function markSeen(seen, c) {
  return c.dismissable ? { ...(seen ?? {}), [c.base]: { key: c.key, count: c.count } } : (seen ?? {});
}

/** The cards this person has not seen. @param {Card[]} cards @param {Seen} seen */
export const unseen = (cards, seen) => cards.filter((c) => !isSeen(c, seen));
