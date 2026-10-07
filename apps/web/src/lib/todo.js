/**
 * THE PARENT'S ACTION LIST, PHASE A0 (docs/design/GA-I20_parent_action_list.md
 * §2, §3.1, §4, §6, §7): "To do for Rohan", drawn from the reads the family
 * app already makes, in the staff queue's shape (lib/queue.js): a row is a
 * fact the server can prove, with a source, a by-when and one door; it is
 * worked out again every time the screen opens, never marked done and never
 * stored on the device.
 *
 * TWO RULES, and no others yet (A1 adds R3 to R9):
 *
 *   R1  an answer is owed for a fixture: his row in the fixture's answers
 *       says nothing (`status` null; silence is not a yes).
 *   R2  answer again: the fixture moved since the answer was given, and the
 *       server says so (`needs_reconfirming`, db/65).
 *
 * THE RULES ARE HONEST ABOUT A READ THAT DID NOT ANSWER (I08). `null` is a read
 * that failed and makes a "Could not read …" row and a "· 1 read failed" in the
 * count; `[]` is a read that answered with nothing and says nothing; a read not
 * made yet is `undefined` and the count says "Reading…". "Nothing to do for
 * Rohan" is said only when every read answered and no rule fired.
 *
 * HIS ROWS AND NOBODY'S (D11). A coach who is a parent reads her whole side's
 * answers; `narrow()` cuts every read to the one child's own row before a rule
 * is run, so a rule never counts, and a row never names, another boy. The only
 * place this file reads a `playerId` is there.
 *
 * What it never says (design §4.4): no reason and no note of an answer, no
 * other child's name, and no "done", "ready" or percentage. Counts and the
 * names of reads only; apps/web/test/todo.test.mjs holds the source to it.
 *
 * Pure, so it is proved under plain node: no React, no DOM, no database and
 * no clock (the caller passes `now`).
 */
import { fixturesOf, opponentOf } from "./family.js";
import { startMs } from "./cockpit.js";

/** How far ahead the list looks, in days (design D4); later fixtures fold. */
export const WINDOW_DAYS = 14;
/** The list's clock for an answer: this many hours before the start (D3, the feed's `isSoon`). */
export const CLOCK_HOURS = 48;

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The South African clock (UTC+2, no summer time): "Sat" and "Thu 07:00". @param {number} ms */
const sa = (ms) => new Date(ms + 2 * HOUR);
const dayShort = (/** @type {number} */ ms) => WEEKDAY[sa(ms).getUTCDay()];
const clockWords = (/** @type {number} */ ms) => `${dayShort(ms)} ${sa(ms).toISOString().slice(11, 16)}`;

/**
 * "To do for Rohan": the name the family uses for him, as the screen says it
 * (`knownAs`, else the name on the record).
 * @param {{knownAs?: string | null, name?: string | null}} child
 */
export function firstNameOf(child) {
  return String(child?.knownAs || child?.name || "").trim();
}

/**
 * His own row out of one fixture's answers, and no other. The read's rows may
 * be a whole side's (a coach reads the side); only `child.id` is kept, and the
 * first of those, so one boy is one row per fixture however many came back.
 * @param {any[]} rows  @param {{id: string}} child
 */
function narrow(rows, child) {
  return rows.find((r) => r.playerId === child.id) ?? null;
}

/**
 * Which rule, if any, his row fires. Only a silent row (R1) or one the server
 * says to answer again (R2): every status that was set, whoever set it, is an
 * answer.
 * @param {{status?: string | null, needsReconfirming?: boolean} | null} row
 * @returns {"R1" | "R2" | null}
 */
export function ruleOf(row) {
  if (!row) return null;                       // not on the roster this read returned: not provable, so not said
  if (row.status === "needs_reconfirming" || row.needsReconfirming === true) return "R2";
  if (row.status == null) return "R1";
  return null;
}

/** The fixture in its own words: "Sat v Kearsney". */
const fixtureWords = (/** @type {any} */ m, /** @type {any} */ child) => {
  const t = startMs(m);
  return `${t == null ? "" : `${dayShort(t)} `}v ${opponentOf(m, child)}`;
};

/**
 * One open row. The by-when is the list's own clock, labelled as such: 48 hours
 * before the start, and "due now" once that has come.
 *
 * @param {"R1" | "R2"} rule  @param {any} match  @param {any} child  @param {number} now
 */
function openRow(rule, match, child, now) {
  const start = startMs(match);
  const clock = start == null ? null : start - CLOCK_HOURS * HOUR;
  const first = firstNameOf(child);
  return {
    id: `${rule}:${match.id}`,
    rule,
    state: /** @type {"open"} */ ("open"),
    matchId: /** @type {string} */ (match.id),
    childId: /** @type {string} */ (child.id),
    fact: rule === "R1" ? `Answer for ${fixtureWords(match, child)}` : `${fixtureWords(match, child)} moved: say again`,
    owner: `you or ${first}`,
    byWhen: clock,
    byWhenText: clock == null ? null : clock <= now ? "due now" : `by ${clockWords(clock)}`,
    clockLabel: "the list's clock",
    source: "availability",
    sourceText: "from the fixture's answers",
    door: { kind: /** @type {"fixture"} */ ("fixture"), matchId: /** @type {string} */ (match.id), label: rule === "R1" ? "Answer" : "Say again" },
    at: start,
  };
}

/**
 * A read that did not answer, as a row in its place: "Could not read the
 * answers for Sat v Kearsney", with the one door of trying again.
 * @param {string} key  @param {string} label  @param {string | null} matchId
 */
function unreadRow(key, label, matchId) {
  return {
    id: `unread:${key}`,
    rule: null,
    state: /** @type {"could_not_read"} */ ("could_not_read"),
    matchId,
    key,
    label,
    fact: `Could not read ${label}`,
    source: key.split(":")[0],
    door: matchId ? { kind: /** @type {"retry"} */ ("retry"), matchId, label: "Try again" } : null,
  };
}

/**
 * The list for ONE child.
 *
 * `matches` is the fixtures read (the Match Centre's rows): `undefined` while it
 * is being made, `null` if it failed. `answers` is each fixture's availability
 * read, keyed by the fixture's id: a missing key is a read not made yet, `null`
 * a failed one, an array (even empty) an answered one.
 *
 * `rows` are the ones inside the window, nearest first: open ones and the
 * "could not read" ones in the place of the read that failed. `later` is every
 * open row beyond the window, folded. `open` counts open rows inside the window
 * and nothing else: a read that failed is not a zero, and a later fixture is not
 * today's to do.
 *
 * @param {{child: {id: string, name?: string, knownAs?: string | null, school?: string, team?: string},
 *          matches: any[] | null | undefined, answers?: Record<string, any[] | null | undefined>, now: number}} o
 */
export function todoOf({ child, matches, answers = {}, now }) {
  const first = firstNameOf(child);
  /** @type {(ReturnType<typeof openRow> | ReturnType<typeof unreadRow>)[]} */
  const rows = [];
  /** @type {ReturnType<typeof openRow>[]} */
  const later = [];
  let reading = false;

  if (matches === undefined) reading = true;
  else if (matches === null) rows.push(unreadRow("matches", "the fixtures", null));
  else {
    const horizon = now + WINDOW_DAYS * DAY;
    for (const m of fixturesOf(matches, child, now).upcoming) {
      const read = answers?.[m.id];
      if (read === undefined) { reading = true; continue; }
      if (read === null) { rows.push(unreadRow(`availability:${m.id}`, `the answers for ${fixtureWords(m, child)}`, m.id)); continue; }
      const rule = ruleOf(narrow(read, child));
      if (!rule) continue;
      const row = openRow(rule, m, child, now);
      if ((row.at ?? 0) <= horizon) rows.push(row); else later.push(row);
    }
  }

  const open = rows.filter((r) => r.state === "open").length;
  const unread = rows.length - open;
  const clear = !reading && open === 0 && unread === 0 && later.length === 0;
  const line = reading ? "Reading…"
    : clear ? `Nothing to do for ${first}`
    : open === 0 && unread === 0 ? `Nothing to do for ${first} in the next ${WINDOW_DAYS} days`
    : `${open} to do${unread ? ` · ${unread} read${unread === 1 ? "" : "s"} failed` : ""}`;
  return {
    childId: child.id,
    label: `To do for ${first}`,
    rows,
    open,
    unread,
    reading,
    clear,
    line,
    later: { rows: later, line: later.length ? `Later · ${later.length} to answer` : null },
    /** Whether any open row carries the list's clock, so the card can say what the clock is. */
    clocked: rows.some((r) => r.state === "open" && r.byWhenText) || later.some((r) => r.byWhenText),
    clockWords: `By-when is ${CLOCK_HOURS} hours before the start.`,
  };
}

/**
 * The fixtures whose answers the list must read for this child: every one of
 * his side's still to come. The same set the Matches screen already reads one
 * answer for, per row.
 * @param {any[] | null | undefined} matches  @param {any} child  @param {number} now
 */
export function fixturesToRead(matches, child, now) {
  return (Array.isArray(matches) ? fixturesOf(matches, child, now).upcoming : []).map((m) => m.id);
}
