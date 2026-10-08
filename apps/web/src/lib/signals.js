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
 *   - It builds none of the eight refused signals (§4.4), and not S2c (it needs
 *     `bowler_day`, phase B). The lift rules show a head count; the office's
 *     S4b shows names to the office only (D10).
 *   - "Dismiss" is "I have seen this" (D13): per person, per evidence, held by
 *     the caller. It changes no row and tells nobody.
 *
 * Pure, so every rule is proved under plain node
 * (apps/web/test/signals.test.mjs): no DOM, no database, no clock.
 */
import { busOf, isMatchDay, isSoon, saTime, shortDate, LOAD_SENTENCE, weatherWords } from "./cockpit.js";
import { EXCEPTION_WORDS } from "./liftWords.js";
import { matchupTypes } from "./captain.js";

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
 */

/**
 * @param {string} rule  @param {string} base  @param {string} key  @param {string[]} lines
 * @param {number} count  @param {{dismissable?: boolean, growth?: number, via?: string[]}} [o]
 * @returns {Card}
 */
const card = (rule, base, key, lines, count, o = {}) => ({
  rule, base, key, title: RULES[/** @type {keyof typeof RULES} */ (rule)].title, lines: lines.filter(Boolean), count,
  via: o.via ?? [...RULES[/** @type {keyof typeof RULES} */ (rule)].via], source: RULES[/** @type {keyof typeof RULES} */ (rule)].source,
  dismissable: o.dismissable !== false, ...(o.growth ? { growth: o.growth } : {}),
});

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
    [head, over ? `${bus.seatsTaken} seats are marked taken on a bus of ${bus.capacity}` : null], Math.max(short, over))];
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
      out.push(card("S2a", `S2a:${i}:${b.id}`, `S2a:${i}:${b.id}:${words}`, [`${b.name} · ${words}`], 1, { dismissable: !inPlay }));
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
      [`${who} · spell ${open.overs} of ${open.maxSpell} (${open.ageBand ? `${open.ageBand} ` : ""}directive)`], 1, { dismissable: false }));
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
    return [card("S3", `S3:${r.playerId}`, `S3:${r.playerId}:${state}:${restricted ? r.returnDate ?? "" : ""}`, [line], 1)];
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
  ], l.count)];
}

// ── S4b · A lift exception (the office's) ──────────────

/** By name, to the office only: `transport.lift.oversee`, which the coach does not hold (D10). @param {Ctx} c @returns {Card[]} */
export function ruleS4b(c) {
  if (!c.gate.panels.liftOffice || !c.liftExceptions) return [];
  return c.liftExceptions.map((r) => card("S4b", `S4b:${r.seatId}`, `S4b:${r.seatId}:${r.kind}`, [
    `${r.name} · ${/** @type {Record<string, string>} */ (EXCEPTION_WORDS)[r.kind] ?? r.kind}`,
    `${r.leg === "out" ? "To the fixture" : "Home"}${r.driverName ? ` with ${r.driverName}` : ""}${r.since ? ` · since ${saTime(r.since)}` : ""}`,
  ], 1));
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
      out.push(card("S5", `S5:${r.playerId}:${t.type}`, `S5:${r.playerId}:${t.type}:${t.balls}`, [
        `${r.name} v ${t.type} · ${plural(t.balls, "ball")} · ${plural(t.runs, "run")} · ${t.out === 0 ? "not out" : t.out === 1 ? "out once" : `out ${t.out} times`}`, cov,
      ], t.balls, { growth: MATCHUP_GROWTH }));
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
  return [card("S6", "S6", `S6:${n}`, [n === 0 ? "The sheet is empty" : `${n} named · a side needs ${SIDE}`], n)];
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
  ], none + again)];
}

// ── S8 · Nobody on record ──────────────────────────────

/** Scorer and umpire only: no read says how many a fixture ought to have. @param {Ctx} c @returns {Card[]} */
export function ruleS8(c) {
  if (!c.gate.panels.day || !c.duties || !isSoon(c.match, c.now)) return [];
  const has = new Set(c.duties.map((r) => r.duty));
  const day = shortDate(c.match.startsAt ?? c.match.date) ?? "the day";
  return ["scorer", "umpire"].filter((duty) => !has.has(duty))
    .map((duty) => card("S8", `S8:${duty}`, `S8:${duty}`, [`No ${duty} on record for ${day}`], 1));
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
  ], 1)];
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
  ], 1)];
}

// ── S11 · A bowler's week ──────────────────────────────

/** The word and the fixed sentence, for a pace bowler on the sheet; never a ratio (D7). @param {Ctx} c @returns {Card[]} */
export function ruleS11(c) {
  if (!c.gate.panels.load || !c.workload || !c.squad) return [];
  const sheet = new Set(named(c).map((r) => r.playerId));
  return c.workload.filter((w) => w.pace === true && sheet.has(w.playerId) && (w.loadWord === "rising" || w.loadWord === "spike"))
    .map((w) => card("S11", `S11:${w.playerId}`, `S11:${w.playerId}:${w.loadWord}`,
      [`${w.name} · ${plural(w.overs7d ?? 0, "over")} this week · ${w.loadWord}${w.estimated7d ? " (estimate)" : ""}`, LOAD_SENTENCE], 1));
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
    .map((n) => card("S12", `S12:${n.id}`, `S12:${n.id}`, [n.title, n.body].filter((x) => x != null && x !== ""), 1));
}

/** Every rule, in the fixed order. */
const EVALUATE = [ruleS1, ruleS2a, ruleS2b, ruleS3, ruleS4a, ruleS4b, ruleS5, ruleS6, ruleS7, ruleS8, ruleS9, ruleS10, ruleS11, ruleS12];

/**
 * The feed: every rule over what the cockpit holds, in the rules' fixed order.
 * Nothing is scored or ranked; a card with nothing true behind it is not drawn.
 * @param {Ctx} c @returns {Card[]}
 */
export function evaluate(c) {
  if (!c?.gate || !c.match) return [];
  // A dismissal is filed under the fixture too: seeing "the bus is short" for Saturday says nothing of next week's.
  return EVALUATE.flatMap((rule) => rule(c)).map((k) => ({ ...k, base: `${c.match.id}:${k.base}` }));
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
