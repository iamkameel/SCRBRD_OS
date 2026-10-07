/**
 * THE MATCH-DAY QUEUE, PHASE A0 (docs/design/GA-I09-I11_match_day_queue.md
 * §2.5, §3.1, §4, §7): the two plain parts the coach's match-day card needs
 * to grow from one fixture to a list. Nothing else of the queue is here yet
 * (A1 adds the rest: the grouping, the clock, the office rules).
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
 *
 * What it never says (design §5): no child's name, no medical, safeguarding or
 * disciplinary detail, and no "done", "ready" or percentage. Counts and the
 * names of reads only; apps/web/test/queue.test.mjs holds the source to it.
 *
 * Pure, so it is proved under plain node: no DOM, no database, no clock (the
 * caller passes `now`).
 */
import { roleGrants } from "@scrbrd/policy/roles";
import { cockpitGate, isMatchDay, isWithin, startMs } from "./cockpit.js";

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
  const unread = unreadOf(reads, gate, { lifts }).map((r) => ({ ...r, text: `Could not read ${r.label}` }));
  const clear = open === 0 && unread.length === 0;
  return { open, unread, clear, line: clear ? "Nothing to resolve" : `${open} to resolve` };
}
