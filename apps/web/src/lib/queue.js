/**
 * THE MATCH-DAY QUEUE, PHASES A0 AND A1 (docs/design/GA-I09-I11_match_day_queue.md
 * §2–§5, §7). A0 is the two plain parts the coach's match-day card needs to
 * grow from one fixture to a list; A1 is the rest of the queue over the reads
 * the app already makes, with no new read, no new gate and no migration.
 *
 *   chooseFixtures()  which fixtures get a card, in what order, and which
 *                     fold under "Later". One call to `cockpitGate` per
 *                     fixture, so each card is admitted by ONE assignment
 *                     and never by a union of two (ADR 0001); a fixture the
 *                     gate does not admit is not here, and nothing says it
 *                     is missing (§4.2 rule 6).
 *   countOf()         the card's per-fixture count: "N to resolve", from the
 *                     feed's cards that this reader has not marked seen, and
 *                     a "Could not read X" for every read that was asked for
 *                     and did not answer. A read that failed is `null`; a
 *                     read that answered with nothing is `[]` and says
 *                     nothing (I08): "0 to resolve" with a failed read and
 *                     "Nothing to resolve" with every read answered are
 *                     different sentences on purpose.
 *   queueGate()       who enters the school-wide screen, and by which single
 *                     assignment: the cockpit's entry or any office capability.
 *   chooseSchoolFixtures()  the fixtures it draws: seven days, then "Later".
 *   fixtureRows()     one fixture's rows (S7, S3, S6, S1, S8/O4, S10, S9, O5),
 *                     each a COUNT with its source, owner, the queue's clock
 *                     and one door; a failed read is a row that says so.
 *   officeReader() / officeRows()   the office list O1, O2, O3 (O6 is a tap).
 *   groupByDay() / headerOf()       date then team; the header's three numbers.
 *
 * What it never says (design §5): no child's name, no medical, safeguarding or
 * disciplinary detail, and no "done", "ready" or percentage. Counts and the
 * names of reads only; apps/web/test/queue.test.mjs holds the source to it.
 *
 * Pure, so it is proved under plain node: no DOM, no database, no clock (the
 * caller passes `now`).
 */
import { SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES, roleGrants } from "@scrbrd/policy/roles";
import { busOf, cockpitGate, endCovered, entersAs, isMatchDay, isSoon, isWithin, liftCounts, panelsOf, saDay, shortDate, startMs, stateOf } from "./cockpit.js";
import { sidesOf } from "./matchCentre.js";
import { couldNotRead, readsFailed } from "./readState.js";
import { RULES, SIDE, ruleS1, ruleS4b, ruleS8, ruleS9, ruleS10 } from "./signals.js";

/** The window the card looks across, in days (design D5). */
export const WINDOW_DAYS = 7;
/** Cards drawn at once; the rest fold under "Later" and are drawn on a tap. */
export const SHOWN = 3;

/**
 * @typedef {NonNullable<ReturnType<typeof cockpitGate>>} Gate
 * @typedef {{match: any, gate: Gate}} Pick
 */

/**
 * Every fixture within the window that one assignment admits, in `starts_at`
 * order with today's first, split into the cards drawn now and those folded
 * under "Later". `cockpitGate` already takes the one assignment that grants the
 * most panels (the first on a tie); it is asked once per fixture.
 *
 * @param {any[] | null | undefined} matches  the Match Centre's fixture rows
 * @param {Parameters<typeof cockpitGate>[0]} assignments  the session's own
 * @param {number} now  ms
 * @param {{days?: number, shown?: number}} [o]
 * @returns {{all: Pick[], shown: Pick[], later: Pick[]}}
 */
export function chooseFixtures(matches, assignments, now, { days = WINDOW_DAYS, shown = SHOWN } = {}) {
  /** @type {Pick[]} */
  const all = [];
  for (const match of matches ?? []) {
    if (!isWithin(match, now, days)) continue;
    const gate = cockpitGate(assignments, match);
    if (gate) all.push({ match, gate });
  }
  const today = (/** @type {Pick} */ p) => (isMatchDay(p.match, now) ? 0 : 1);
  all.sort((a, b) => today(a) - today(b) || (startMs(a.match) ?? 0) - (startMs(b.match) ?? 0) || String(a.match.id).localeCompare(String(b.match.id)));
  return { all, shown: all.slice(0, shown), later: all.slice(shown) };
}

/**
 * The reads the feed's rules are evaluated over, said in words, each with the
 * condition that the cockpit asked for it at all. A read that was never asked
 * for (the reader's gate does not grant its panel, or the lifts on a day that
 * is not the match day) is not one that failed. `reads` is the cockpit's own
 * (views/cockpit/useCockpit.js): `null` is a failed read, `[]` an empty one.
 *
 * @type {{key: string, label: string, asked: (g: Gate, o: {lifts: boolean}) => boolean, failed?: (reads: Record<string, any>) => boolean}[]}
 */
const READS = [
  { key: "squad",          label: "the sheet",             asked: (g) => !!(g.panels.team || g.panels.select) },
  { key: "readiness",      label: "who has answered",      asked: (g) => !!g.panels.side },
  { key: "trips",          label: "the bus",               asked: (g) => !!g.panels.bus },
  { key: "lifts",          label: "the lifts",             asked: (g, o) => o.lifts && !!g.panels.lifts },
  { key: "liftExceptions", label: "the lift exceptions",   asked: (g, o) => o.lifts && !!g.panels.liftOffice },
  { key: "duties",         label: "the duties",            asked: (g) => !!g.panels.day },
  { key: "conditions",     label: "the playing conditions", asked: (g) => !!g.panels.day, failed: (r) => r.conditions?.state === "failed" },
  { key: "weatherRows",    label: "the weather",           asked: (g) => !!g.panels.day },
  { key: "workload",       label: "the bowlers' week",     asked: (g) => !!g.panels.load },
  { key: "notices",        label: "the notices",           asked: (g) => roleGrants(g.role, "news.read") },
];

/**
 * The reads this reader's card asked for that did not answer, in a fixed order.
 * @param {Record<string, any> | null | undefined} reads
 * @param {Gate} gate
 * @param {{lifts?: boolean}} [o]
 * @returns {{key: string, label: string}[]}
 */
export function unreadOf(reads, gate, { lifts = false } = {}) {
  if (!reads || !gate) return [];
  return READS.filter((r) => r.asked(gate, { lifts }) && (r.failed ? r.failed(reads) : reads[r.key] == null))
    .map(({ key, label }) => ({ key, label }));
}

/**
 * The card's count for one fixture.
 *
 * `open` is the number of feed cards this reader has not marked seen (the
 * drawer's own number). `unread` is every read that failed. `line` is
 * "N to resolve", or "Nothing to resolve" only when nothing is open AND every
 * read answered: zero blockers and a failed read never read the same.
 *
 * @param {{open: number, reads?: Record<string, any> | null, gate: Gate, lifts?: boolean}} o
 * @returns {{open: number, unread: {key: string, label: string, text: string}[], line: string, clear: boolean}}
 */
export function countOf({ open, reads = null, gate, lifts = false }) {
  const unread = unreadOf(reads, gate, { lifts }).map((r) => ({ ...r, text: couldNotRead(r.label) }));
  const clear = open === 0 && unread.length === 0;
  return { open, unread, clear, line: clear ? "Nothing to resolve" : `${open} to resolve` };
}

// ════════════════════════════════════════════════════════════════════════
//  PHASE A1 — the queue over what exists (design §2, §3.2, §3.3, §5)
// ════════════════════════════════════════════════════════════════════════
//
// A row is a fact the data can prove, with an owner, a clock and one door
// (§2.1). It is re-derived from its source every time the queue is opened and
// nobody closes it: it leaves when the fact changes. Nothing is ranked, scored
// or marked done, and there is no "Seen" here (D7): a school-wide blocker is
// open until its fact changes.

const HOUR = 3600e3;

/**
 * @typedef {object} Deadline
 * @property {string} clock   which of the queue's clocks: "answers" | "sheet" | "firstBall" | "bus" | "record"
 * @property {number | null} at   ms, or null for a record's own date that carries none
 * @property {boolean} due    has the clock run out
 * @property {string} words   "by Thu 09:00" or "was due Thu 09:00"
 */
/**
 * @typedef {object} Row
 * @property {string} id
 * @property {string} rule        "S7" | "S3" | "S6" | "S1" | "O4" | "S10" | "S9" | "O5" | "O1" | "O2" | "O3" | "O6" | "read"
 * @property {"open" | "info" | "could_not_read"} state   a failed read is a row that says so (I08); `info` is drawn and counted as none
 * @property {string} fact        one sentence in the source's own words, with its count
 * @property {number} count
 * @property {string | null} source   the read it came from, in words
 * @property {string | null} owner    a role word on the side, or "the office"
 * @property {Deadline | null} deadline
 * @property {string | null} age      "oldest 4 days" where the record has no deadline
 * @property {{kind: string, label: string, matchId?: string, school?: string} | null} action   exactly one door
 * @property {any[] | null} [items]   an adult's own clearance rows, for the register row only
 * @property {string} [read]      for a failed read: which
 * @property {string | null} [error]
 */

// ── The queue's clock (design §2.4, D3) ─────────────────────────────────
/**
 * Constants, said on the screen as "the queue's clock", never "the school's
 * rule": a school-set deadline is a `school_setting` row and a paste (D3).
 * `hours` before the fixture's `starts_at`; the bus is the trip's own
 * `depart_at`, else the first ball. Requests and claims have none: the office
 * decides its own pace, and their age is shown instead. A clearance has its
 * record's own date.
 */
export const CLOCK = Object.freeze({
  answers:   Object.freeze({ hours: 48 }),               // S7, S3 (the feed's own "soon", cockpit.js isSoon)
  sheet:     Object.freeze({ hours: 24 }),               // S6: a side is named the day before
  firstBall: Object.freeze({ hours: 0 }),                // O4, S10, O5
  bus:       Object.freeze({ hours: 0, trip: true }),    // S1: the trip's depart_at, else the first ball
});

/** Which clock each rule runs on. A rule not here has none. */
export const ROW_CLOCK = Object.freeze({ S7: "answers", S3: "answers", S6: "sheet", S1: "bus", O4: "firstBall", S10: "firstBall", O5: "firstBall" });

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const sa = (/** @type {number} */ ms) => new Date(ms + 2 * HOUR);
/** "09:00" on the SA clock. @param {number} ms */
export const clockTime = (ms) => sa(ms).toISOString().slice(11, 16);
/** "Sat 10 Oct". @param {number} ms */
export const dayWords = (ms) => `${DAY_NAMES[sa(ms).getUTCDay()]} ${sa(ms).getUTCDate()} ${MONTH_NAMES[sa(ms).getUTCMonth()]}`;
const whenWords = (/** @type {number} */ ms) => `${DAY_NAMES[sa(ms).getUTCDay()]} ${clockTime(ms)}`;

/**
 * When a clock runs out for this fixture, in ms, or null (no start on record).
 * @param {keyof typeof CLOCK} clock  @param {any} match  @param {any[] | null} [trips]  @param {string | null} [school]
 * @returns {{clock: string, at: number} | null}
 */
export function deadlineAt(clock, match, trips = null, school = null) {
  const c = /** @type {{hours: number, trip?: boolean} | undefined} */ (CLOCK[clock]);
  const t = startMs(match);
  if (!c || t == null) return null;
  if (c.trip) {
    const left = Date.parse(busOf(trips, school ?? "")?.departAt ?? "");
    if (Number.isFinite(left)) return { clock: "bus", at: left };
    return { clock: "firstBall", at: t };
  }
  return { clock, at: t - c.hours * HOUR };
}

/** Has the clock run out: true AT the threshold and false one millisecond short. @param {number | null} at @param {number} now */
export const isDue = (at, now) => at != null && now >= at;

/** @param {{clock: string, at: number} | null} d @param {number} now @returns {Deadline | null} */
function deadlineOf(d, now) {
  if (!d) return null;
  const due = isDue(d.at, now);
  const what = d.clock === "firstBall" ? `first ball (${whenWords(d.at)})` : d.clock === "bus" ? `the bus's departure (${whenWords(d.at)})` : whenWords(d.at);
  return { clock: d.clock, at: d.at, due, words: `${due ? "was due" : "by"} ${what}` };
}

/** "today", "1 day", "4 days": whole days since an instant. @param {string | number | null | undefined} when @param {number} now */
export function ageWords(when, now) {
  const t = typeof when === "number" ? when : Date.parse(String(when ?? ""));
  if (!Number.isFinite(t)) return null;
  const d = Math.floor((now - t) / (24 * HOUR));
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
}
const oldestOf = (/** @type {(string | null | undefined)[]} */ isos) =>
  isos.map((s) => Date.parse(String(s ?? ""))).filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;

// ── Owners, derived from the capability that can change the fact (§2.2) ──
const ROLE_WORD = /** @type {Record<string, string>} */ ({ coach: "coach", assistantcoach: "assistant coach", teammanager: "team manager" });
/** Everything that is not a side's: the school's office (the holders of a school-scoped capability). */
export const OFFICE = "the office";
const ORGANISER = "the competition's organiser";

/**
 * The side's staff who hold what the rule needs, said as role words:
 * "the U15A coach or team manager". Derived from the rule's own capabilities
 * (signals.js RULES) over the team-scoped roles in roles.mjs; never typed per row.
 * @param {keyof typeof RULES} rule  @param {string | null} team
 */
export function sideOwner(rule, team) {
  const caps = RULES[rule].via;
  const words = TEAM_SCOPED_ROLES.filter((r) => caps.every((c) => roleGrants(r, c))).map((r) => ROLE_WORD[r] ?? r);
  if (!words.length) return OFFICE;
  const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}` : words[0];
  return `the ${team ? `${team} ` : ""}${list}`;
}

/** What each read is called on a row ("from the side read"), for ADR 0001's "why am I seeing this". */
export const SOURCE = Object.freeze({
  readiness: "the side read", squad: "the sheet read", trips: "the bus read", duties: "the duties read",
  conditions: "the playing-conditions read", weather: "the weather read",
  requests: "the requests read", claims: "the sign-ins read", register: "the clearance register",
});

// ── Who enters (§1.1) ───────────────────────────────────────────────────
/**
 * The capabilities that open the school-wide screen beside the cockpit's own
 * entry. `fixture.read` alone is NOT a door: a scorer, an official and a
 * spectator hold it and are not readers (§1, "Not readers"), so the fixture
 * groups need it as well as one of these.
 */
export const OFFICE_CAPS = Object.freeze(["clearance.read", "user.role.assign", "user.invite", "guardian.link.manage", "transport.lift.oversee"]);

/** Does this role read fixtures on the queue: fixture.read, and the cockpit's entry or an office capability. @param {string} role */
export const entersQueue = (role) => !SUBJECT_SCOPED_ROLES.includes(role) && roleGrants(role, "fixture.read")
  && (entersAs(role) || OFFICE_CAPS.some((c) => roleGrants(role, c)));

/**
 * The gate for one fixture on the school-wide screen: cockpitGate's own rule
 * with the queue's entry. One assignment, never a union (ADR 0001), school- or
 * team-scoped, never one that names a person or a single fixture; the one
 * granting the most panels, the first on a tie. Layout, not authority: every
 * read behind it is decided again by the database.
 * @param {Parameters<typeof cockpitGate>[0]} assignments  @param {any} match
 */
export function queueGate(assignments, match) {
  if (!match?.id) return null;
  /** @type {ReturnType<typeof cockpitGate>} */
  let best = null;
  let bestN = -1;
  for (const a of assignments ?? []) {
    if (!a?.role || !a.school || !entersQueue(a.role)) continue;
    if ((a.subjects?.length ?? 0) > 0) continue;
    if (a.fixture && a.fixture !== match.id) continue;
    const end = endCovered(a, match);
    if (!end) continue;
    const panels = panelsOf(a.role);
    const n = Object.values(panels).filter(Boolean).length;
    if (n > bestN) {
      bestN = n;
      best = { end, role: a.role, school: a.school, team: a.team ?? null, teamCode: (end === "home" ? match.homeTeam : match.awayTeamCode) ?? null, panels };
    }
  }
  return best;
}

/**
 * The fixtures the school-wide screen draws: seven days of them (D5) in
 * `starts_at` order, and the upcoming ones after that, which fold under
 * "Later" and are read on a tap. A fixture called off inside the window is
 * drawn too (O5's first clause); one already played or live is not.
 * @param {any[] | null | undefined} matches  @param {Parameters<typeof cockpitGate>[0]} assignments  @param {number} now
 * @param {{days?: number}} [o]
 * @returns {{inWindow: Pick[], later: Pick[]}}
 */
export function chooseSchoolFixtures(matches, assignments, now, { days = WINDOW_DAYS } = {}) {
  /** @type {Pick[]} */ const inWindow = [];
  /** @type {Pick[]} */ const later = [];
  for (const match of matches ?? []) {
    const t = startMs(match);
    if (t == null || t <= now - 6 * HOUR) continue;
    const off = match.calledOff === true;
    if (match.status !== "upcoming" && !off) continue;
    const gate = queueGate(assignments, match);
    if (!gate) continue;
    if (t - now <= days * 24 * HOUR) inWindow.push({ match, gate });
    else if (!off) later.push({ match, gate });
  }
  const byStart = (/** @type {Pick} */ a, /** @type {Pick} */ b) => (startMs(a.match) ?? 0) - (startMs(b.match) ?? 0) || String(a.match.id).localeCompare(String(b.match.id));
  return { inWindow: inWindow.sort(byStart), later: later.sort(byStart) };
}

// ── One fixture's rows ──────────────────────────────────────────────────
/** The reads the school-wide screen makes of a fixture: the cockpit's, less the bowlers' week, the notices and the lift exceptions. */
const QUEUE_READ_KEYS = new Set(["squad", "readiness", "trips", "lifts", "duties", "conditions", "weatherRows"]);

/** "U15A v Kearsney": our side first, as the match-day card names it. @param {any} match @param {{end: "home" | "away"}} gate */
export function fixtureLabel(match, gate) {
  const s = sidesOf(match);
  return gate.end === "home" ? `${s.home.full} v ${s.away.full}` : `${s.away.full} v ${s.home.full}`;
}

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) => (n === 1 ? one : many);

/** @param {Partial<Row> & {id: string, rule: string, fact: string}} o @returns {Row} */
const mk = (o) => ({ state: "open", count: 1, source: null, owner: null, deadline: null, age: null, action: null, ...o });

/** A failed read, as a row: its name and, where the read said one, its error. @param {string} id @param {string} key @param {string} label @param {string | null} [error] @param {string} [school] */
function unreadRow(id, key, label, error = null, school) {
  return /** @type {Row} */ ({ id, rule: "read", state: "could_not_read", read: key, error, count: 1,
    fact: `${couldNotRead(label)}${error ? ` (${error})` : ""}`, source: null, owner: null, deadline: null, age: null,
    action: { kind: "retry", label: "Try again", ...(school ? { school } : {}) } });
}

/**
 * One fixture's rows for the school-wide screen, in the fixed order of §2.5
 * (S7, S3, S6, S1, S8 as O4, S10, S9, then O5). Every school row is a COUNT:
 * it carries no child's name and no id of one (§5, D8), only what the side
 * read, the sheet, the bus, the duties and the conditions say in numbers; a
 * name is one tap deeper, inside the fixture his gate admits. Reads are the
 * cockpit's own and `null` is a read that failed (I08).
 *
 * @param {{match: any, gate: Gate, reads: Record<string, any> | null | undefined, now: number, errors?: Record<string, string | null>}} o
 * @returns {{id: string, label: string, start: number | null, team: string | null, calledOff: boolean, loading: boolean,
 *   dutyKeys: string[] | null, rows: Row[], unread: Row[], open: number, failed: number, clear: boolean, line: string}}
 */
export function fixtureRows({ match, gate, reads, now, errors = {} }) {
  const id = String(match.id);
  const base = { id, label: fixtureLabel(match, gate), start: startMs(match), team: gate.teamCode ?? null, calledOff: match.calledOff === true,
    // Which duties have somebody on record (the duties read, as the fixture's own roster counts them), or null if it was not read or did not answer.
    dutyKeys: /** @type {string[] | null} */ (reads?.duties ? [...new Set(reads.duties.map((/** @type {any} */ r) => String(r.duty)))] : null) };
  if (!reads) return { ...base, loading: true, rows: [], unread: [], open: 0, failed: 0, clear: false, line: "Reading…" };

  const p = gate.panels;
  const team = gate.teamCode ?? null;
  const go = (/** @type {string} */ kind, /** @type {string} */ label) => ({ kind, label, matchId: id });
  const lifts = isMatchDay(match, now);
  /** @type {Row[]} */ const rows = [];

  const readiness = reads.readiness ?? null;
  const mine = readiness ? readiness.filter((/** @type {any} */ r) => r.team == null || team == null || r.team === team) : null;

  if (base.calledOff) {
    // O5, first clause: called off with work still on record.
    const duties = (reads.duties ?? []).length;
    const bus = busOf(reads.trips ?? [], gate.school)?.vehicles ?? 0;
    if (duties || bus) {
      rows.push(mk({ id: `${id}:O5`, rule: "O5", count: duties + bus,
        fact: `Called off: ${[duties ? `${duties} ${plural(duties, "duty", "duties")}` : null, bus ? `${bus} ${plural(bus, "bus", "buses")}` : null].filter(Boolean).join(" and ")} still on record`,
        source: SOURCE.duties, owner: OFFICE, deadline: deadlineOf(deadlineAt("firstBall", match), now), action: go("fixture", "Open the fixture") }));
    }
  } else {
    // S7 · answers: the count of those who have not answered, never a name.
    if (p.side && mine && isSoon(match, now)) {
      const none = mine.filter((/** @type {any} */ r) => r.declaredStatus == null).length;
      if (none) rows.push(mk({ id: `${id}:S7`, rule: "S7", count: none, fact: `${none} ${none === 1 ? "has" : "have"} not answered`,
        source: SOURCE.readiness, owner: sideOwner("S7", team), deadline: deadlineOf(deadlineAt("answers", match), now), action: go("side", "Open the side") }));
    }
    // S3 · on the sheet but may not play: counted by state (the physio's tier only for a reader who holds it).
    if (p.select && p.side && readiness) {
      const states = readiness.filter((/** @type {any} */ r) => r.selected && (r.side == null || r.side === gate.end)).map((/** @type {any} */ r) => stateOf(r, { status: p.status }));
      const restricted = states.filter((s) => s === "restricted").length;
      const out = states.filter((s) => s === "unavailable").length;
      const when = deadlineOf(deadlineAt("answers", match), now);
      if (restricted) rows.push(mk({ id: `${id}:S3:restricted`, rule: "S3", count: restricted, fact: `${restricted} restricted ${plural(restricted, "boy")} on the sheet`,
        source: SOURCE.readiness, owner: sideOwner("S3", team), deadline: when, action: go("side", "Open the side") }));
      if (out) rows.push(mk({ id: `${id}:S3:unavailable`, rule: "S3", count: out, fact: `${out} marked unavailable on the sheet`,
        source: SOURCE.readiness, owner: sideOwner("S3", team), deadline: when, action: go("side", "Open the side") }));
    }
    // S6 · the sheet is thin.
    if (p.select && reads.squad && isSoon(match, now)) {
      const n = reads.squad.filter((/** @type {any} */ r) => r.side === gate.end && !r.twelfth).length;
      if (n < SIDE) rows.push(mk({ id: `${id}:S6`, rule: "S6", count: n, fact: n === 0 ? "The sheet is empty" : `${n} named · a side needs ${SIDE}`,
        source: SOURCE.squad, owner: sideOwner("S6", team), deadline: deadlineOf(deadlineAt("sheet", match), now), action: go("side", "Open the side") }));
    }
    // The signals' own rules run over the same reads for S1, S8, S9 and S10: their words, their gates.
    const weather = reads.weatherRows ? reads.weatherRows.find((/** @type {any} */ w) => w.matchId === match.id) ?? null : null;
    const ctx = /** @type {any} */ ({ now, match, gate, squad: reads.squad ?? null, readiness, workload: null, spells: null, trips: reads.trips ?? null,
      lifts: reads.lifts != null ? liftCounts(reads.lifts, now) : null, liftExceptions: null, weather, duties: reads.duties ?? null,
      conditions: reads.conditions ?? { state: "failed", cap: null, freeHit: null }, notices: null, matchups: null, fielding: [], capFor: null });
    for (const c of ruleS1(ctx)) rows.push(mk({ id: `${id}:S1`, rule: "S1", count: c.count, fact: c.lines[0], source: SOURCE.trips, owner: sideOwner("S1", team),
      deadline: deadlineOf(deadlineAt("bus", match, reads.trips, gate.school), now), action: go("bus", "Open the bus") }));
    for (const c of ruleS8(ctx)) rows.push(mk({ id: `${id}:${c.base}`, rule: "O4", count: 1, fact: c.lines[0], source: SOURCE.duties, owner: OFFICE,
      deadline: deadlineOf(deadlineAt("firstBall", match), now), action: go("duties", "Open the duties") }));
    for (const c of ruleS10(ctx)) rows.push(mk({ id: `${id}:S10`, rule: "S10", count: 1, fact: c.lines[0], source: SOURCE.conditions, owner: ORGANISER,
      deadline: deadlineOf(deadlineAt("firstBall", match), now), action: go("conditions", "Open the conditions") }));
    for (const c of ruleS9(ctx)) rows.push(mk({ id: `${id}:S9`, rule: "S9", state: "info", count: 0, fact: c.lines.join(" · "), source: SOURCE.weather }));
    // O5 · the fixture moved: the only on-record trace is the answers asked again (the amend route writes no `amended_at`, phase B).
    if (p.side && mine) {
      const again = mine.filter((/** @type {any} */ r) => r.declaredStatus === "needs_reconfirming").length;
      if (again) rows.push(mk({ id: `${id}:O5`, rule: "O5", count: again, fact: `Moved: ${again} ${plural(again, "answer")} to ask again`,
        source: SOURCE.readiness, owner: `${OFFICE}; ${sideOwner("S7", team)} for the answers`, deadline: deadlineOf(deadlineAt("firstBall", match), now), action: go("fixture", "Open the fixture") }));
    }
  }

  // Every read that was asked for and did not answer: a row that says so, never an empty group (I08).
  const keep = base.calledOff ? new Set(["duties", "trips"]) : QUEUE_READ_KEYS;
  const unread = unreadOf(reads, gate, { lifts }).filter((r) => keep.has(r.key))
    .map((r) => unreadRow(`${id}:read:${r.key}`, r.key, r.label, errors[r.key] ?? null));
  const open = rows.filter((r) => r.state === "open").length;
  const clear = open === 0 && unread.length === 0;
  return { ...base, loading: false, rows, unread, open, failed: unread.length, clear, line: clear ? "Nothing to resolve" : `${open} to resolve` };
}

/** @typedef {ReturnType<typeof fixtureRows>} FixtureGroup */

/**
 * Date, then team (§2.5): each day's fixtures in start order, then by team.
 * Nothing is ranked.
 * @param {FixtureGroup[]} groups
 * @returns {{day: string, label: string, groups: FixtureGroup[]}[]}
 */
export function groupByDay(groups) {
  /** @type {Map<string, FixtureGroup[]>} */ const byDay = new Map();
  for (const g of groups) {
    if (g.start == null) continue;
    const day = saDay(g.start);
    byDay.set(day, [...(byDay.get(day) ?? []), g]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, gs]) => ({
    day, label: dayWords(/** @type {number} */ (gs[0].start)),
    groups: gs.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || String(a.team).localeCompare(String(b.team)) || a.id.localeCompare(b.id)),
  }));
}

// ── The office list (§2.3, §3.3) ────────────────────────────────────────
/**
 * The schools where this reader holds a school-scoped assignment (no team, no
 * person, no single fixture) whose role grants an office capability, and which
 * rows each may read. Each row checks its own capability (§1.1); layout, not
 * authority: the reads decide again.
 * @param {Parameters<typeof cockpitGate>[0]} assignments
 * @returns {{school: string, schoolName: string | null, can: {requests: boolean, claims: boolean, register: boolean, lifts: boolean}}[]}
 */
export function officeReader(assignments) {
  /** @type {Map<string, {school: string, schoolName: string | null, can: {requests: boolean, claims: boolean, register: boolean, lifts: boolean}}>} */
  const bySchool = new Map();
  for (const a of /** @type {any[]} */ (assignments ?? [])) {
    if (!a?.role || !a.school || a.team != null || a.fixture || (a.subjects?.length ?? 0) > 0 || SUBJECT_SCOPED_ROLES.includes(a.role)) continue;
    const can = { requests: roleGrants(a.role, "user.role.assign"), claims: roleGrants(a.role, "user.invite"),
      register: roleGrants(a.role, "clearance.read"), lifts: roleGrants(a.role, "transport.lift.oversee") };
    if (!Object.values(can).some(Boolean)) continue;
    const had = bySchool.get(a.school);
    bySchool.set(a.school, { school: a.school, schoolName: a.schoolName ?? had?.schoolName ?? null,
      can: { requests: !!had?.can.requests || can.requests, claims: !!had?.can.claims || can.claims, register: !!had?.can.register || can.register, lifts: !!had?.can.lifts || can.lifts } });
  }
  return [...bySchool.values()];
}

/** The statuses the register gives a gap, worst first (db/08's clearance_status). */
const GAPS = Object.freeze(["missing", "expired", "revoked", "expiring"]);

/**
 * O1, O2 and O3 for one school. `requests` is the `role_requests` read
 * (adapted), `claims` the raw `sign_in_claims` rows, `register` the adapted
 * `clearance_register`; `null` is a read that failed, and a read the reader's
 * capability does not cover is never asked for, so it is not a failure.
 *
 * O1 counts a request that was asked before the email was verified (db/84)
 * beside the others and never drops one for it. Age is shown where a record
 * carries no deadline (O1, O2); O3 runs on the record's own date. The register
 * row carries the adults' own rows (`items`): the register names adults, never
 * children; nothing here reads a name.
 *
 * @param {{school: string, can: {requests: boolean, claims: boolean, register: boolean}, requests?: any[] | null, claims?: any[] | null, register?: any[] | null, now: number, errors?: Record<string, string | null>}} o
 * @returns {{rows: Row[], unread: Row[], open: number, failed: number}}
 */
export function officeRows({ school, can, requests = [], claims = [], register = [], now, errors = {} }) {
  /** @type {Row[]} */ const rows = [];
  /** @type {Row[]} */ const unread = [];
  const here = (/** @type {any} */ r) => r.school == null || r.school === school;

  if (can.requests) {
    if (requests == null) unread.push(unreadRow(`office:${school}:read:requests`, "requests", "the requests", errors.requests ?? null, school));
    else {
      const waiting = requests.filter((r) => r.state === "pending" && r.decidable === true && here(r));
      const unverified = waiting.filter((r) => r.askedUnverified === true).length;
      if (waiting.length) rows.push(mk({ id: `office:${school}:O1`, rule: "O1", count: waiting.length,
        fact: `${waiting.length} ${plural(waiting.length, "request")} waiting${unverified ? ` · ${unverified} asked before the email was verified` : ""}`,
        source: SOURCE.requests, owner: OFFICE, age: `oldest ${ageWords(oldestOf(waiting.map((r) => r.requestedAt)) ?? now, now)}`,
        action: { kind: "requests", label: "Decide", school } }));
    }
  }
  if (can.claims) {
    if (claims == null) unread.push(unreadRow(`office:${school}:read:claims`, "claims", "the sign-ins", errors.claims ?? null, school));
    else {
      const waiting = claims.filter((c) => c.school_id == null || c.school_id === school);
      if (waiting.length) rows.push(mk({ id: `office:${school}:O2`, rule: "O2", count: waiting.length,
        fact: `${waiting.length} Google ${plural(waiting.length, "sign-in")} ${waiting.length === 1 ? "matches" : "match"} an enrolled account`,
        source: SOURCE.claims, owner: OFFICE, age: `oldest ${ageWords(oldestOf(waiting.map((c) => c.requested_at)) ?? now, now)}`,
        action: { kind: "claims", label: "Confirm", school } }));
    }
  }
  if (can.register) {
    if (register == null) unread.push(unreadRow(`office:${school}:read:register`, "register", "the clearance register", errors.register ?? null, school));
    else {
      const gaps = register.filter((r) => GAPS.includes(r.status) && here(r));
      // One entry for each adult: the worst gap he has, and the earliest date among them.
      const worst = new Map();
      for (const r of gaps) {
        const k = r.personId ?? r.id;
        const had = worst.get(k);
        const rank = GAPS.indexOf(r.status);
        if (!had || rank < GAPS.indexOf(had.status) || (rank === GAPS.indexOf(had.status) && String(r.expiresOn ?? "9") < String(had.expiresOn ?? "9"))) worst.set(k, r);
      }
      const items = [...worst.values()].sort((a, b) => GAPS.indexOf(a.status) - GAPS.indexOf(b.status) || String(a.expiresOn ?? "9").localeCompare(String(b.expiresOn ?? "9")));
      if (items.length) {
        const n = (/** @type {string} */ s) => items.filter((r) => r.status === s).length;
        const parts = GAPS.map((s) => (n(s) ? `${n(s)} ${s}` : null)).filter(Boolean);
        // The earliest date on ANY gap, not only the worst one: an adult who is missing one check and expired in another is due from the expiry.
        const dated = gaps.filter((r) => r.expiresOn).sort((a, b) => String(a.expiresOn).localeCompare(String(b.expiresOn)))[0];
        const at = dated ? Date.parse(`${dated.expiresOn}T00:00:00+02:00`) : null;
        rows.push(mk({ id: `office:${school}:O3`, rule: "O3", count: items.length, items,
          fact: `${items.length} ${plural(items.length, "adult")} without a current clearance: ${parts.join(", ")}`,
          source: SOURCE.register, owner: OFFICE,
          deadline: dated && at != null ? { clock: "record", at, due: at < now, words: `${at < now ? "expired" : "expires"} ${shortDate(dated.expiresOn)}` } : null,
          action: { kind: "register", label: "The register", school } }));
      }
    }
  }
  return { rows, unread, open: rows.length, failed: unread.length };
}

/**
 * O6 on a tap: the lift exceptions the office asked for, in S4b's own five
 * sentences (signals.js ruleS4b), by name, to `transport.lift.oversee` only.
 * The read is logged by the database against the children it names, so it is
 * never made on opening the queue (D6).
 * @param {any[] | null} exceptions  GET /api/lifts/exceptions
 * @returns {{rule: "O6", id: string, fact: string, detail: string | null}[]}
 */
export function liftExceptionRows(exceptions) {
  const gate = { end: "home", school: "", teamCode: null, panels: { liftOffice: true } };
  return ruleS4b(/** @type {any} */ ({ gate, liftExceptions: exceptions ?? null }))
    .map((c) => ({ rule: /** @type {"O6"} */ ("O6"), id: c.base, fact: c.lines[0], detail: c.lines[1] ?? null }));
}

// ── The header's three numbers (§3.2) ───────────────────────────────────
/**
 * Open rows, reads that failed, fixtures in the window: always all three. A
 * screen with 0 open and 1 failed says so, never "all clear".
 * @param {FixtureGroup[]} groups  @param {{open: number, failed: number}[]} [offices]
 */
export function headerOf(groups, offices = []) {
  const open = groups.reduce((n, g) => n + g.open, 0) + offices.reduce((n, o) => n + o.open, 0);
  const failed = groups.reduce((n, g) => n + g.failed, 0) + offices.reduce((n, o) => n + o.failed, 0);
  return { open, failed, fixtures: groups.length, loading: groups.filter((g) => g.loading).length };
}

/** "5 open · 1 read failed · 7 fixtures". @param {ReturnType<typeof headerOf>} h */
export const headerWords = (h) => `${h.open} open · ${readsFailed(h.failed)} · ${h.fixtures} ${plural(h.fixtures, "fixture")}`;
