/**
 * THE FIXTURE PLANNER: A LEAGUE OR A KNOCKOUT, DRAWN AND PUT ON GROUNDS
 * (SCRBRD-123, the engine).
 *
 * A league administrator today types every fixture by hand. This module
 * does the two mechanical halves of that job and nothing else:
 *
 *   pairings()        who plays whom, in which round: a single or double
 *                     round robin, or a seeded single-elimination knockout.
 *   plan()            when and where: each pairing put into a declared
 *                     ground window, under rules that are never broken to
 *                     fill a calendar.
 *   toFixtureDrafts() each placed fixture as the body POST /api/fixtures
 *                     already accepts, so publishing is a loop over the
 *                     existing route (services/api/write/fixture-api.mjs).
 *
 * The design note is docs/design/SCRBRD-123_planner.md. The idea came from
 * competition-planner.ts in iamkameel/scrbrd; the behaviour was taken, not
 * the code.
 *
 * A PLAN RESERVES NOTHING. It is a proposal computed from what the caller
 * declares: windows a ground's owner has offered, blackout days, existing
 * commitments. It never reads the database and never books a ground; a
 * window that looks free here is free only in what the caller passed.
 *
 * REQUIRED RULES ARE NEVER BROKEN TO FILL A CALENDAR. A fixture the planner
 * cannot place stays unscheduled, with the reasons every window refused it
 * (PLAN_REASON). A short, honest calendar is the output; a full one that
 * double-books a side is a lie somebody acts on. The rules:
 *
 *   window_short        the window holds preparation + the match + recovery
 *   blackout            no play on a side's blackout day, or everybody's
 *                       (South African calendar days, matchDay())
 *   ground_closed       the ground, a field it lies on, or a pitch on it,
 *                       is closed at any point of the window's use
 *   ground_taken        one fixture per window, and no two fixtures (or a
 *                       known booking) on overlapping ground at once
 *   rest                a side's rest between matches, plus travel when the
 *                       two are on different sites, known commitments too
 *   daily_cap           the most matches a side plays in a day, known
 *                       commitments counted
 *   feeder              a knockout round after the match that feeds it,
 *                       plus rest
 *   feeder_unscheduled  a knockout fixture whose feeder has no slot waits
 *
 * A LATER KNOCKOUT ROUND IS PLANNED FOR EVERY SIDE IT COULD HOLD. "Winner of
 * match 2" is not a team yet, so a rule about a side applies to every
 * entrant that could arrive: a blackout for any of them, the rest of any of
 * them, the daily cap of any of them. That is the only reading under which
 * the rule holds whatever the results are.
 *
 * LOCKS. An administrator may fix a fixture to a window. Locks are placed
 * first and are never moved: a locked fixture is tried in its window and
 * nowhere else, so regenerating around it leaves it where it was. A lock
 * whose window now breaks a rule leaves its fixture unscheduled with the
 * reasons (not quietly moved); a lock that names no fixture or no window in
 * this draw is reported in `staleLocks` for the administrator to clear.
 *
 * DETERMINISTIC. The same input gives the same output, byte for byte: no
 * clock, no randomness, windows tried earliest first (then by id), fixtures
 * in the draw's order. The search is greedy — first window that breaks no
 * rule — and does not promise the fullest calendar there is. It promises a
 * valid one.
 *
 * BOUNDED. At most 16 entrants (a double round robin of 16 is 240
 * fixtures) and 256 windows. With F fixtures, W windows, and K known
 * commitments, B blackouts and C closures, plan() is
 * O(F · W · (F + K + B + C)) — about fifteen million cheap comparisons at
 * the ceiling, well under a second. pairings() is O(F).
 *
 * WHY IT LIVES IN @scrbrd/scoring. It is pure JavaScript about a
 * competition, like conditions.mjs beside it; it dates a day the way
 * edition.mjs does (matchDay(), SAST) and names a format the way
 * conditions.mjs does (fixtureFormatFrom()), and both tiers that will call
 * it — the API that publishes and the screen that previews — already depend
 * on this package. It is a subpath export (@scrbrd/scoring/planner) and
 * deliberately NOT on the package index, which the pad and every web screen
 * load: the planner enters the web bundle only when a screen imports it.
 */
import { matchDay } from "./edition.mjs";
import { fixtureFormatFrom } from "./conditions.mjs";

/** @import { PlayConditions } from "./conditions.mjs" */

// ── Formats and limits ──────────────────────────────────────────────

/** The draws the planner makes. */
export const PLAN_FORMAT = Object.freeze({
  ROUND_ROBIN: "round_robin",
  DOUBLE_ROUND_ROBIN: "double_round_robin",
  KNOCKOUT: "knockout",
});
/** @typedef {typeof PLAN_FORMAT[keyof typeof PLAN_FORMAT]} PlanFormat */

const FORMATS = new Set(Object.values(PLAN_FORMAT));

/**
 * The ceiling on what one plan takes. The algorithm's cost is stated above;
 * these keep it there. A caller over a limit is refused, not truncated.
 */
export const PLAN_LIMITS = Object.freeze({
  entrants: 16,
  windows: 256,
  known: 1024,
  blackouts: 1024,
  grounds: 256,
});

// ── Reasons ─────────────────────────────────────────────────────────

/** Why a fixture has no slot. The order here is the order they are listed in. */
export const PLAN_REASON = Object.freeze({
  NO_WINDOWS: "no_windows",
  FEEDER_UNSCHEDULED: "feeder_unscheduled",
  WINDOW_SHORT: "window_short",
  BLACKOUT: "blackout",
  GROUND_CLOSED: "ground_closed",
  GROUND_TAKEN: "ground_taken",
  REST: "rest",
  DAILY_CAP: "daily_cap",
  FEEDER: "feeder",
});
/** @typedef {typeof PLAN_REASON[keyof typeof PLAN_REASON]} PlanReason */

const REASON_ORDER = Object.values(PLAN_REASON);

/**
 * The words for each reason, for the screen and the administrator. They say
 * what to change, because that is what the person reading them will do next.
 * @type {Readonly<Record<PlanReason, string>>}
 */
export const PLAN_REASON_TEXT = Object.freeze({
  no_windows: "No ground windows were offered. Add windows to place this fixture.",
  feeder_unscheduled: "The match that decides one of the sides has no slot yet.",
  window_short: "The windows are too short for the match with its preparation and recovery.",
  blackout: "A side, or the whole competition, has a blackout on those days.",
  ground_closed: "The ground, or the field it is on, is closed then.",
  ground_taken: "The ground is already taken then, by another fixture or a booking.",
  rest: "A side would not have its rest, or its travel time, between matches.",
  daily_cap: "A side would play more matches in a day than the rules allow.",
  feeder: "A knockout match must come after the match that feeds it, plus rest.",
});

/** Why a lock was not applied at all (as opposed to a lock that breaks a rule). */
export const LOCK_STALE = Object.freeze({
  NO_SUCH_FIXTURE: "no_such_fixture",
  NO_SUCH_WINDOW: "no_such_window",
});

// ── Types ───────────────────────────────────────────────────────────

/**
 * An entrant, in seed order: the first is seed 1. The id is the caller's
 * (competition_entrant.id in the product), letters, digits, - and _ only.
 * @typedef {{ id: string, name?: string }} PlanEntrant
 */

/**
 * One side of a fixture: an entrant, or the winner of an earlier knockout
 * fixture. Never an invented team.
 * @typedef {{ entrant: string } | { winnerOf: string }} PlanSide
 */

/**
 * @typedef {object} PairedFixture
 * @property {string} id       stable: see pairings()
 * @property {number} round    1-based
 * @property {1 | 2} leg       2 is the return leg of a double round robin
 * @property {number} match    its number in the round (a knockout's bracket position)
 * @property {PlanSide} home
 * @property {PlanSide} away
 */

/** @typedef {{ round: number, entrant: string }} PlanBye */

/**
 * @typedef {object} Pairings
 * @property {PlanFormat} format
 * @property {number} rounds
 * @property {PairedFixture[]} fixtures
 * @property {PlanBye[]} byes
 */

/**
 * A window a ground's owner has offered: the ground is free for a fixture
 * from `startsAt` to `endsAt`. Instants carry their offset ("…+02:00" or
 * "…Z"); a bare local time is refused, because it would be read in the
 * server's zone.
 * @typedef {{ id: string, groundId: string, startsAt: string, endsAt: string }} PlanWindow
 */

/**
 * A ground the windows or known bookings name. `parentId` is the field a
 * pitch lies on; `closed` are the spans it cannot be used.
 * @typedef {{ id: string, parentId?: string | null, closed?: { from: string, to: string }[] }} PlanGround
 */

/**
 * A day nobody plays (`entrant` absent or null), or one side does not.
 * @typedef {{ day: string, entrant?: string | null }} PlanBlackout
 */

/**
 * A commitment the plan must work around: another fixture of a side, a
 * booking of a ground, or both. With no `endsAt` it takes the whole South
 * African day it starts on — a fixture with no recorded end time is not
 * assumed to be short.
 * @typedef {object} PlanKnown
 * @property {string[]} [entrants]
 * @property {string | null} [groundId]
 * @property {string} startsAt
 * @property {string | null} [endsAt]
 */

/**
 * The rules. Minutes throughout.
 * @typedef {object} PlanRules
 * @property {number} durationMinutes         the match itself
 * @property {number} [preparationMinutes]    ground preparation before it (0)
 * @property {number} [recoveryMinutes]       ground recovery after it (0)
 * @property {number} [restMinutes]           a side's rest between two matches (0)
 * @property {number} [travelMinutes]         added to rest when the two are on different sites (0)
 * @property {number} [maxPerDay]             a side's matches in one South African day (1)
 */

/** @typedef {{ fixtureId: string, windowId: string }} PlanLock */

/**
 * @typedef {PairedFixture & {
 *   locked: boolean,
 *   windowId: string | null,
 *   groundId: string | null,
 *   startsAt: string | null,
 *   endsAt: string | null,
 *   reasons: PlanReason[],
 * }} PlannedFixture
 * `startsAt`/`endsAt` are the match itself, not its preparation or recovery.
 * `reasons` is empty exactly when the fixture has a window.
 */

/**
 * @typedef {object} Plan
 * @property {PlanFormat} format
 * @property {PlannedFixture[]} fixtures   in the draw's order
 * @property {PlanBye[]} byes
 * @property {{ fixtureId: string, windowId: string, reason: string }[]} staleLocks
 * @property {number} placed
 * @property {number} unscheduled
 */

// ── Small helpers ───────────────────────────────────────────────────

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// An instant must say which zone it is in: "Z" or "+02:00".
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MINUTE = 60_000;
const DAY_MS = 86_400_000;

/**
 * A caller's mistake: refused with words, never repaired. A declaration so
 * the checker narrows past it.
 * @param {string} msg
 * @returns {never}
 */
function refuse(msg) { throw new RangeError(`planner: ${msg}`); }

/** @param {unknown} v @param {string} what */
function instant(v, what) {
  if (typeof v !== "string" || !INSTANT.test(v)) refuse(`${what} must be an ISO instant with its offset`);
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) refuse(`${what} is not a real instant`);
  return ms;
}

/** @param {unknown} v @param {string} what */
function calendarDay(v, what) {
  if (typeof v !== "string" || !DAY.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) {
    refuse(`${what} must be a real calendar date, YYYY-MM-DD`);
  }
  return v;
}

/** @param {unknown} v @param {string} what @param {number} lo @param {number} hi @param {number} [dflt] */
function minutes(v, what, lo, hi, dflt) {
  if (v == null && dflt !== undefined) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) refuse(`${what} must be a whole number from ${lo} to ${hi}`);
  return v;
}

/** Half-open spans [a, b) and [c, d) share a moment. */
const overlaps = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ c, /** @type {number} */ d) => a < d && c < b;

/** The day after a calendar day. */
const nextDay = (/** @type {string} */ day) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/**
 * The South African calendar days a span [from, to) touches. A match that
 * starts at 23:00 SAST on Friday is on Friday and Saturday; one that starts
 * at 00:30 SAST on Saturday is on Saturday, though it is still Friday in UTC.
 * @param {number} from @param {number} to
 * @returns {string[]}
 */
function saDays(from, to) {
  const first = /** @type {string} */ (matchDay(from));
  const last = /** @type {string} */ (matchDay(Math.max(from, to - 1)));
  const out = [first];
  for (let d = first; d < last;) { d = nextDay(d); out.push(d); }
  return out;
}

/** The start of a South African day, as an instant: SAST is UTC+2 all year. */
const saMidnight = (/** @type {string} */ day) => Date.parse(`${day}T00:00:00+02:00`);

/**
 * FNV-1a, 32 bits, as eight hex digits: a short, stable fingerprint of a
 * knockout fixture's possible entrants, so its id changes when the draw
 * under it changes (and a lock on it goes stale instead of silently
 * following a different pair).
 * @param {string} s
 */
function fingerprint(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

// ── Pairings ────────────────────────────────────────────────────────

/**
 * The entrant ids, checked: each one well formed and once only, at most
 * PLAN_LIMITS.entrants.
 * @param {unknown} entrants
 * @returns {string[]}
 */
function entrantIds(entrants) {
  if (!Array.isArray(entrants)) refuse("entrants must be a list");
  if (entrants.length > PLAN_LIMITS.entrants) refuse(`at most ${PLAN_LIMITS.entrants} entrants`);
  const ids = entrants.map((e, i) => {
    const id = e?.id;
    if (typeof id !== "string" || !ID.test(id)) refuse(`entrant ${i + 1} has no usable id`);
    return id;
  });
  if (new Set(ids).size !== ids.length) refuse("an entrant appears twice");
  return ids;
}

/**
 * Who plays whom.
 *
 * ROUND ROBIN, by the circle method: the first entrant stays put and the
 * rest rotate one place a round, so every pair meets exactly once in n − 1
 * rounds (n rounded up to even; with an odd count the empty place is that
 * round's bye). Each side plays at most once a round.
 *
 * Home and away are decided by the pair, not the round: with the entrants
 * numbered 0…n−1 and c the odd number n or n + 1, the side at i hosts the
 * side at j when (j − i) mod c is at most (c − 1) / 2. Every side then hosts
 * exactly half its matches when n is odd, and half give or take one when n
 * is even — as balanced as a single round robin can be. A double round
 * robin repeats the draw with the venues reversed, so every side hosts every
 * other exactly once.
 *
 * KNOCKOUT, seeded: the bracket is the next power of two, laid out the
 * standard way (1 v 16, 8 v 9, 4 v 13, 5 v 12, 2 v 15, 7 v 10, 3 v 14,
 * 6 v 11), and the places past the last entrant are empty — so the byes fall
 * to the top seeds, and a bye is recorded as a bye, never as a fixture. A
 * later round's side is `{ winnerOf }` an earlier fixture's id; the higher
 * place in the bracket is listed at home.
 *
 * IDS ARE STABLE. A round-robin fixture is named by its pair and leg
 * ("rr:A:B:1", the two ids in sorted order), so it keeps its id — and its
 * lock — when the entrant list is reordered or the windows change. A
 * knockout fixture is named by its round, its bracket position and a
 * fingerprint of the entrants who could reach it ("ko:r2:m1:9a3c…"), so a
 * redraw that changes who could be in it changes its id.
 *
 * @param {{ format: PlanFormat, entrants: PlanEntrant[] }} input
 * @returns {Pairings}
 */
export function pairings({ format, entrants }) {
  if (!FORMATS.has(format)) refuse(`unknown format ${JSON.stringify(format)}`);
  const ids = entrantIds(entrants);
  if (ids.length < 2) return { format, rounds: 0, fixtures: [], byes: [] };
  return format === PLAN_FORMAT.KNOCKOUT
    ? knockout(ids)
    : roundRobin(ids, format === PLAN_FORMAT.DOUBLE_ROUND_ROBIN);
}

/**
 * @param {string[]} ids
 * @param {boolean} double
 * @returns {Pairings}
 */
function roundRobin(ids, double) {
  const n = ids.length;
  const cycle = n % 2 ? n : n + 1;
  /** Does the side at index i host the side at index j? */
  const hosts = (/** @type {number} */ i, /** @type {number} */ j) => (j - i + cycle) % cycle <= (cycle - 1) / 2;

  // Indexes into ids, and -1 for the empty place when n is odd.
  let ring = ids.map((_, i) => i);
  if (n % 2) ring.push(-1);
  const m = ring.length;
  const rounds = m - 1;

  /** @type {PairedFixture[]} */ const fixtures = [];
  /** @type {PlanBye[]} */ const byes = [];
  for (let r = 1; r <= rounds; r++) {
    let match = 0;
    for (let k = 0; k < m / 2; k++) {
      const a = ring[k], b = ring[m - 1 - k];
      if (a < 0 || b < 0) { byes.push({ round: r, entrant: ids[a < 0 ? b : a] }); continue; }
      const [h, v] = hosts(a, b) ? [a, b] : [b, a];
      const pair = [ids[a], ids[b]].sort().join(":");
      fixtures.push({ id: `rr:${pair}:1`, round: r, leg: 1, match: ++match,
                      home: { entrant: ids[h] }, away: { entrant: ids[v] } });
    }
    // The circle turns: the first place is fixed, the last moves to second.
    ring = [ring[0], ring[m - 1], ...ring.slice(1, m - 1)];
  }

  if (double) {
    const first = fixtures.slice();
    for (const f of first) {
      fixtures.push({ id: f.id.replace(/:1$/, ":2"), round: f.round + rounds, leg: 2, match: f.match,
                      home: f.away, away: f.home });
    }
    for (const b of byes.slice()) byes.push({ round: b.round + rounds, entrant: b.entrant });
  }
  return { format: double ? PLAN_FORMAT.DOUBLE_ROUND_ROBIN : PLAN_FORMAT.ROUND_ROBIN,
           rounds: double ? 2 * rounds : rounds, fixtures, byes };
}

/**
 * The standard seeding order for a bracket of `size` places: [1, 2] becomes
 * [1, 4, 2, 3], then [1, 8, 4, 5, 2, 7, 3, 6], each seed followed by the
 * seed it would meet first.
 * @param {number} size a power of two
 */
function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap((s) => [s, total - s]);
  }
  return order;
}

/**
 * @param {string[]} ids in seed order
 * @returns {Pairings}
 */
function knockout(ids) {
  const n = ids.length;
  let size = 2;
  while (size < n) size *= 2;

  /** @typedef {{ side: PlanSide, entrants: string[] }} Slot */
  /** @type {(Slot | null)[]} */
  let slots = seedOrder(size).map((seed) => seed <= n ? { side: { entrant: ids[seed - 1] }, entrants: [ids[seed - 1]] } : null);

  /** @type {PairedFixture[]} */ const fixtures = [];
  /** @type {PlanBye[]} */ const byes = [];
  let round = 1;
  while (slots.length > 1) {
    /** @type {(Slot | null)[]} */ const next = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i], b = slots[i + 1], match = i / 2 + 1;
      if (!a || !b) {
        // An empty place: the other side goes through. Only the first round
        // has empty places, and never two together (n is more than half the
        // bracket), so the side going through is a single entrant.
        const through = /** @type {Slot} */ (a ?? b);
        byes.push({ round, entrant: through.entrants[0] });
        next.push(through);
        continue;
      }
      const entrants = [...a.entrants, ...b.entrants];
      const id = `ko:r${round}:m${match}:${fingerprint(entrants.join(","))}`;
      fixtures.push({ id, round, leg: 1, match, home: a.side, away: b.side });
      next.push({ side: { winnerOf: id }, entrants });
    }
    slots = next;
    round++;
  }
  return { format: PLAN_FORMAT.KNOCKOUT, rounds: round - 1, fixtures, byes };
}

// ── Placement ───────────────────────────────────────────────────────

/**
 * @typedef {object} Win
 * @property {string} id
 * @property {string} groundId
 * @property {number} from
 * @property {number} to
 */

/**
 * @typedef {object} Placed
 * @property {Win} window
 * @property {number} from    the ground is in use from here (preparation)…
 * @property {number} start   …the match starts…
 * @property {number} end     …and ends…
 * @property {number} to      …and the ground is free again (after recovery)
 * @property {string[]} days  the SA days of the match itself
 */

/**
 * Put the pairings on grounds.
 *
 * @param {object} input
 * @param {Pairings} input.pairings
 * @param {PlanWindow[]} [input.windows]
 * @param {PlanBlackout[]} [input.blackouts]
 * @param {PlanRules} input.rules
 * @param {PlanKnown[]} [input.known]
 * @param {PlanLock[]} [input.locks]
 * @param {PlanGround[]} [input.grounds]   parents and closures; a ground not listed has neither
 * @returns {Plan}
 */
export function plan({ pairings: draw, windows = [], blackouts = [], rules, known = [], locks = [], grounds = [] }) {
  if (!draw || !FORMATS.has(draw.format) || !Array.isArray(draw.fixtures)) refuse("pairings must be what pairings() returned");

  // ── The rules ──
  const r = rules ?? refuse("rules are required");
  const prep = minutes(r.preparationMinutes, "preparationMinutes", 0, 720, 0) * MINUTE;
  const duration = minutes(r.durationMinutes, "durationMinutes", 15, 7 * 24 * 60) * MINUTE;
  const recovery = minutes(r.recoveryMinutes, "recoveryMinutes", 0, 720, 0) * MINUTE;
  const rest = minutes(r.restMinutes, "restMinutes", 0, 14 * 24 * 60, 0) * MINUTE;
  const travel = minutes(r.travelMinutes, "travelMinutes", 0, 24 * 60, 0) * MINUTE;
  const maxPerDay = minutes(r.maxPerDay, "maxPerDay", 1, 8, 1);

  // ── Who is in the draw, and who could be in each fixture ──
  /** @type {Map<string, PairedFixture>} */ const byId = new Map();
  for (const f of draw.fixtures) {
    if (byId.has(f.id)) refuse(`fixture ${f.id} appears twice`);
    byId.set(f.id, f);
  }
  /** @type {Map<string, Set<string>>} the entrants each fixture could hold */
  const sidesOf = new Map();
  /** @param {PlanSide} s @returns {string[]} */
  const reach = (s) => {
    if ("entrant" in s) return [s.entrant];
    const feeder = sidesOf.get(s.winnerOf);
    // The draw's order puts a feeder before what it feeds; anything else is
    // a cycle or a reference to nothing, and is refused.
    if (!feeder) refuse(`fixture refers to ${s.winnerOf}, which is not an earlier fixture`);
    return [...feeder];
  };
  for (const f of draw.fixtures) sidesOf.set(f.id, new Set([...reach(f.home), ...reach(f.away)]));
  const inDraw = new Set([...draw.byes.map((b) => b.entrant), ...[...sidesOf.values()].flatMap((s) => [...s])]);
  /** @param {unknown} e @param {string} what */
  const entrantIn = (e, what) => {
    if (typeof e !== "string" || !inDraw.has(e)) refuse(`${what} names an entrant that is not in this draw`);
    return e;
  };
  /** @param {PairedFixture} f @returns {string[]} */
  const feedersOf = (f) => [f.home, f.away].flatMap((s) => "winnerOf" in s ? [s.winnerOf] : []);

  // ── Grounds: which lie on which, and when each is closed ──
  if (grounds.length > PLAN_LIMITS.grounds) refuse(`at most ${PLAN_LIMITS.grounds} grounds`);
  /** @type {Map<string, { parentId: string | null, closed: { from: number, to: number }[] }>} */
  const groundMap = new Map();
  for (const g of grounds) {
    if (typeof g?.id !== "string" || !g.id) refuse("a ground has no id");
    if (groundMap.has(g.id)) refuse(`ground ${g.id} appears twice`);
    groundMap.set(g.id, {
      parentId: g.parentId ?? null,
      closed: (g.closed ?? []).map((c, i) => {
        const from = instant(c.from, `ground ${g.id} closure ${i + 1} from`), to = instant(c.to, `ground ${g.id} closure ${i + 1} to`);
        if (to <= from) refuse(`ground ${g.id} closure ${i + 1} ends before it starts`);
        return { from, to };
      }),
    });
  }
  /** @type {Map<string, string[]>} a ground, then the field it lies on, and up */
  const chains = new Map();
  /** @param {string} id */
  const chain = (id) => {
    let c = chains.get(id);
    if (c) return c;
    c = [];
    for (let at = /** @type {string | null} */ (id); at != null; at = groundMap.get(at)?.parentId ?? null) {
      if (c.includes(at)) refuse(`ground ${id} lies on itself`);
      c.push(at);
    }
    chains.set(id, c);
    return c;
  };
  /** One ground lies on the other, or they are the same ground. */
  const related = (/** @type {string} */ a, /** @type {string} */ b) => chain(a).includes(b) || chain(b).includes(a);
  /** The same site: no travel between them. */
  const sameSite = (/** @type {string} */ a, /** @type {string} */ b) => chain(a).at(-1) === chain(b).at(-1);
  /** @type {Map<string, { from: number, to: number }[]>} */ const closures = new Map();
  /** Every closure on this ground, on a field it lies on, or on a pitch lying on it. */
  const closuresTouching = (/** @type {string} */ g) => {
    let c = closures.get(g);
    if (!c) {
      c = [...groundMap.entries()].filter(([id, x]) => x.closed.length && related(g, id)).flatMap(([, x]) => x.closed);
      closures.set(g, c);
    }
    return c;
  };

  // ── Windows, earliest first ──
  if (windows.length > PLAN_LIMITS.windows) refuse(`at most ${PLAN_LIMITS.windows} windows`);
  /** @type {Map<string, Win>} */ const winById = new Map();
  for (const w of windows) {
    if (typeof w?.id !== "string" || !w.id) refuse("a window has no id");
    if (winById.has(w.id)) refuse(`window ${w.id} appears twice`);
    if (typeof w.groundId !== "string" || !w.groundId) refuse(`window ${w.id} names no ground`);
    const from = instant(w.startsAt, `window ${w.id} startsAt`), to = instant(w.endsAt, `window ${w.id} endsAt`);
    if (to <= from) refuse(`window ${w.id} ends before it starts`);
    winById.set(w.id, { id: w.id, groundId: w.groundId, from, to });
  }
  const sorted = [...winById.values()].sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── Blackouts and known commitments ──
  if (blackouts.length > PLAN_LIMITS.blackouts) refuse(`at most ${PLAN_LIMITS.blackouts} blackouts`);
  const dark = blackouts.map((b, i) => ({
    day: calendarDay(b?.day, `blackout ${i + 1}`),
    entrant: b.entrant == null ? null : entrantIn(b.entrant, `blackout ${i + 1}`),
  }));
  if (known.length > PLAN_LIMITS.known) refuse(`at most ${PLAN_LIMITS.known} known commitments`);
  const commitments = known.map((k, i) => {
    const start = instant(k?.startsAt, `known ${i + 1} startsAt`);
    // No end recorded: the whole South African day it starts on.
    const end = k.endsAt == null ? saMidnight(nextDay(/** @type {string} */ (matchDay(start)))) : instant(k.endsAt, `known ${i + 1} endsAt`);
    if (end <= start) refuse(`known ${i + 1} ends before it starts`);
    return { start, end, groundId: k.groundId ?? null, days: saDays(start, end),
             entrants: (k.entrants ?? []).map((e) => entrantIn(e, `known ${i + 1}`)) };
  });

  // ── Locks ──
  /** @type {Map<string, string>} fixture id → window id */ const lockOf = new Map();
  /** @type {Plan["staleLocks"]} */ const staleLocks = [];
  for (const l of locks) {
    if (lockOf.has(l.fixtureId)) refuse(`fixture ${l.fixtureId} is locked twice`);
    if (!byId.has(l.fixtureId)) staleLocks.push({ ...l, reason: LOCK_STALE.NO_SUCH_FIXTURE });
    else if (!winById.has(l.windowId)) staleLocks.push({ ...l, reason: LOCK_STALE.NO_SUCH_WINDOW });
    else lockOf.set(l.fixtureId, l.windowId);
  }

  /** @type {Map<string, Placed>} */ const placed = new Map();

  /**
   * Everything wrong with putting fixture f in window w, given what is
   * already placed. Empty means it goes there.
   * @param {PairedFixture} f @param {Win} w @param {{ deferFeeders?: boolean }} [opt]
   * @returns {Set<PlanReason>}
   */
  const refusals = (f, w, { deferFeeders = false } = {}) => {
    /** @type {Set<PlanReason>} */ const out = new Set();
    const sides = /** @type {Set<string>} */ (sidesOf.get(f.id));
    const from = w.from, start = from + prep, end = start + duration, to = end + recovery;
    const days = saDays(start, end);

    if (to > w.to) out.add(PLAN_REASON.WINDOW_SHORT);

    for (const b of dark) {
      if ((b.entrant == null || sides.has(b.entrant)) && days.includes(b.day)) out.add(PLAN_REASON.BLACKOUT);
    }

    for (const c of closuresTouching(w.groundId)) if (overlaps(from, to, c.from, c.to)) out.add(PLAN_REASON.GROUND_CLOSED);

    // A side's matches on a day: entrant|day → count, the ones already placed and known.
    /** @type {Map<string, number>} */ const perDay = new Map();
    /** @param {string[]} shared @param {string[]} theirDays */
    const tally = (shared, theirDays) => {
      for (const e of shared) for (const d of theirDays) if (days.includes(d)) perDay.set(`${e}|${d}`, (perDay.get(`${e}|${d}`) ?? 0) + 1);
    };

    for (const [id, q] of placed) {
      if (id === f.id) continue;
      if (q.window.id === w.id || (related(q.window.groundId, w.groundId) && overlaps(from, to, q.from, q.to))) {
        out.add(PLAN_REASON.GROUND_TAKEN);
      }
      const shared = [...sides].filter((e) => sidesOf.get(id)?.has(e));
      if (shared.length) {
        const gap = rest + (sameSite(w.groundId, q.window.groundId) ? 0 : travel);
        if (overlaps(start - gap, end + gap, q.start, q.end)) out.add(PLAN_REASON.REST);
        tally(shared, q.days);
      }
      // A later round already placed that this fixture feeds.
      if (feedersOf(byId.get(id) ?? f).includes(f.id) && q.start < end + rest) out.add(PLAN_REASON.FEEDER);
    }

    for (const k of commitments) {
      if (k.groundId != null && related(k.groundId, w.groundId) && overlaps(from, to, k.start, k.end)) out.add(PLAN_REASON.GROUND_TAKEN);
      const shared = k.entrants.filter((e) => sides.has(e));
      if (shared.length) {
        // A commitment somewhere unknown is somewhere else: travel applies.
        const gap = rest + (k.groundId != null && sameSite(w.groundId, k.groundId) ? 0 : travel);
        if (overlaps(start - gap, end + gap, k.start, k.end)) out.add(PLAN_REASON.REST);
        tally(shared, k.days);
      }
    }
    for (const n of perDay.values()) if (n + 1 > maxPerDay) { out.add(PLAN_REASON.DAILY_CAP); break; }

    for (const x of feedersOf(f)) {
      const q = placed.get(x);
      if (!q) { if (!deferFeeders) out.add(PLAN_REASON.FEEDER_UNSCHEDULED); }
      else if (start < q.end + rest) out.add(PLAN_REASON.FEEDER);
    }
    return out;
  };

  /** @param {PairedFixture} f @param {Win} w */
  const put = (f, w) => {
    const start = w.from + prep, end = start + duration;
    placed.set(f.id, { window: w, from: w.from, start, end, to: end + recovery, days: saDays(start, end) });
  };

  /** @type {Map<string, Set<PlanReason>>} */ const why = new Map();

  // Locks first, in the draw's order, each in its own window and no other.
  // A locked later round whose feeder is not locked is checked against the
  // feeder when the feeder is placed (the FEEDER test above), and after.
  for (const f of draw.fixtures) {
    const wid = lockOf.get(f.id);
    if (wid == null) continue;
    const w = /** @type {Win} */ (winById.get(wid));
    const no = refusals(f, w, { deferFeeders: true });
    if (no.size) why.set(f.id, no); else put(f, w);
  }

  // Then everything else, in the draw's order, into the first window that
  // breaks no rule.
  for (const f of draw.fixtures) {
    if (lockOf.has(f.id)) continue;
    if (feedersOf(f).some((x) => !placed.has(x))) { why.set(f.id, new Set([PLAN_REASON.FEEDER_UNSCHEDULED])); continue; }
    if (!sorted.length) { why.set(f.id, new Set([PLAN_REASON.NO_WINDOWS])); continue; }
    /** @type {Set<PlanReason>} */ const all = new Set();
    let home = null;
    for (const w of sorted) {
      const no = refusals(f, w);
      if (!no.size) { home = w; break; }
      for (const x of no) all.add(x);
    }
    if (home) put(f, home); else why.set(f.id, all);
  }

  // A locked later round whose feeder found no slot waits with it. The draw
  // lists feeders first, so one pass in its order settles every chain.
  for (const f of draw.fixtures) {
    if (placed.has(f.id) && feedersOf(f).some((x) => !placed.has(x))) {
      placed.delete(f.id);
      why.set(f.id, new Set([PLAN_REASON.FEEDER_UNSCHEDULED]));
    }
  }

  /** @type {PlannedFixture[]} */
  const fixtures = draw.fixtures.map((f) => {
    const q = placed.get(f.id);
    return {
      ...f,
      locked: lockOf.has(f.id),
      windowId: q ? q.window.id : null,
      groundId: q ? q.window.groundId : null,
      startsAt: q ? new Date(q.start).toISOString() : null,
      endsAt: q ? new Date(q.end).toISOString() : null,
      reasons: q ? [] : REASON_ORDER.filter((x) => why.get(f.id)?.has(x)),
    };
  });
  const count = placed.size;
  return { format: draw.format, fixtures, byes: draw.byes.slice(), staleLocks,
           placed: count, unscheduled: fixtures.length - count };
}

// ── Drafts for the fixture route ────────────────────────────────────

/**
 * What POST /api/fixtures accepts (services/api/write/fixture-api.mjs,
 * `create`), for one placed fixture. The mapping:
 *
 *   schoolId, teamCode           the home entrant's (competition_entrant.school_id, team_code)
 *   awaySchoolId, awayTeamCode   the away entrant's: a tenant school, so the
 *                                fixture is one row both schools read
 *                                (`opponent` is stamped by the trigger, never sent)
 *   startsAt                     the match's start, after the ground's preparation
 *   groundId                     the window's ground
 *   competitionId                the competition: db/61's trigger checks both
 *                                sides entered it, and its conditions apply
 *   sport                        "cricket"
 *   format, overs                fixtureFormatFrom() over the competition's
 *                                conditions and format, as the fixture
 *                                screen pre-fills them; left out when it
 *                                says nothing, so the route's own default
 *                                applies exactly as it does for a typed fixture
 *
 * @typedef {object} FixtureBody
 * @property {string} schoolId
 * @property {string} teamCode
 * @property {string} awaySchoolId
 * @property {string} awayTeamCode
 * @property {string} startsAt
 * @property {string} groundId
 * @property {string} competitionId
 * @property {"cricket"} sport
 * @property {string} [format]
 * @property {number} [overs]
 */

/** Why a planned fixture is not a draft yet. */
export const DRAFT_HELD = Object.freeze({
  UNSCHEDULED: "unscheduled",          // it has no window
  AWAITING_WINNER: "awaiting_winner",  // a knockout side is still "winner of …"
  NO_TEAM_CODE: "no_team_code",        // an entrant has no team code, and the route needs one
});

/**
 * The placed fixtures as bodies for the existing fixture route, and the rest
 * with the reason each is held back. Publishing (phase 2) is a loop over
 * `drafts` posting each `body`; nothing here writes.
 *
 * @param {Plan} p
 * @param {object} competition
 * @param {string} competition.id                       competition.id
 * @param {string | null} [competition.format]          competition.format ("T20", "50-over" …)
 * @param {PlayConditions | null} [competition.conditions] the set in force, if any
 * @param {{ id: string, schoolId: string, teamCode: string | null }[]} competition.entrants
 * @returns {{ drafts: { fixtureId: string, body: FixtureBody }[],
 *             held: { fixtureId: string, reason: typeof DRAFT_HELD[keyof typeof DRAFT_HELD] }[] }}
 */
export function toFixtureDrafts(p, competition) {
  const entrants = new Map(competition.entrants.map((e) => [e.id, e]));
  const { format, overs } = fixtureFormatFrom(competition.conditions ?? {}, competition.format ?? null);

  /** @type {{ fixtureId: string, body: FixtureBody }[]} */ const drafts = [];
  /** @type {{ fixtureId: string, reason: typeof DRAFT_HELD[keyof typeof DRAFT_HELD] }[]} */ const held = [];
  for (const f of p.fixtures) {
    if (f.windowId == null || f.startsAt == null || f.groundId == null) { held.push({ fixtureId: f.id, reason: DRAFT_HELD.UNSCHEDULED }); continue; }
    if (!("entrant" in f.home) || !("entrant" in f.away)) { held.push({ fixtureId: f.id, reason: DRAFT_HELD.AWAITING_WINNER }); continue; }
    const home = entrants.get(f.home.entrant), away = entrants.get(f.away.entrant);
    if (!home || !away) refuse(`fixture ${f.id} names an entrant the competition does not list`);
    if (!home.teamCode?.trim() || !away.teamCode?.trim()) { held.push({ fixtureId: f.id, reason: DRAFT_HELD.NO_TEAM_CODE }); continue; }
    /** @type {FixtureBody} */
    const body = {
      schoolId: home.schoolId, teamCode: home.teamCode.trim(),
      awaySchoolId: away.schoolId, awayTeamCode: away.teamCode.trim(),
      startsAt: f.startsAt, groundId: f.groundId, competitionId: competition.id, sport: "cricket",
    };
    if (format != null) body.format = format;
    if (overs != null) body.overs = overs;
    drafts.push({ fixtureId: f.id, body });
  }
  return { drafts, held };
}
