/**
 * SCRBRD — the fixture planner, phase 2: inputs, drafts and publishing
 * (SCRBRD-123). The engine is @scrbrd/scoring/planner (phase 1); the schema
 * and every rule of who may do what is db/67_fixture_planner.sql; the design
 * note and this API's contract, for the screen, is
 * docs/design/SCRBRD-123_planner.md §5.
 *
 * THE SERVER COMPUTES EVERY PLAN. A client sends the format, the range, the
 * rules, the seeds and the locks — never a plan. This module reads the
 * inputs from the database (planner_inputs(), for the competition's manager
 * only), derives each existing fixture's end from its format
 * (knownFixtureEnd()), calls pairings() and plan(), and stores what they
 * returned beside the inputs they were given (fixture_plan_save()).
 *
 * PUBLISHING IS THE FIXTURE ROUTE. Each placed fixture becomes the body
 * toFixtureDrafts() makes and goes through fixtureInsertParams() and
 * insertFixture() — the validation and the insert POST /api/fixtures runs —
 * in one transaction with fixture_plan_item_begin() (a per-fixture lock, and
 * the match already made, if any) and fixture_plan_item_record(). A refusal
 * rolls the whole fixture back: no match without its item, no item without
 * its match. Before any fixture is made, the plan is checked again against
 * the database as it is now (a booking typed since, a ground closed since):
 * each placed fixture is locked to its window and plan() is run over fresh
 * inputs; one that no longer fits is refused as a `clash`, with the reasons.
 *
 * A FIXTURE ALREADY MADE stays where its match is. When a plan is drawn and
 * this competition's planner has already made a fixture's match (an earlier
 * published version, or this one before a retry), the fixture is not placed
 * again: in a round robin it leaves the draw and its match becomes a known
 * commitment (its sides and its ground are taken then); in a knockout, whose
 * later rounds need it, it is locked to a window that is exactly its match.
 *
 * Every refusal is { error: <reason>, detail? }: 403 not_permitted (which
 * never says whether the competition or plan exists), 400 for a malformed
 * request, 422 for the rest. The reasons are listed in the design note §5.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { fixtureInsertParams, insertFixture, fixtureRefusal } from "./fixture-api.mjs";
import { matchDay, fixtureFormatFrom } from "@scrbrd/scoring";
import {
  pairings, plan, toFixtureDrafts, knownFixtureEnd, fixtureLength,
  PLAN_FORMAT, PLAN_REASON_TEXT, LOCK_STALE, DRAFT_HELD, PLAN_LIMITS,
} from "@scrbrd/scoring/planner";
/** @import { RouteDeps, Handler, Db } from "../api-types.mjs" */
/** @import { Plan, PlanWindow, PlanKnown, PlanLock, PlanRules, PlannedFixture, PairedFixture, PlanSide } from "@scrbrd/scoring/planner" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// An instant must say which zone it is in, as the engine requires.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MINUTE = 60_000;
const FORMATS = new Set(Object.values(PLAN_FORMAT));
const RULE_KEYS = ["durationMinutes", "preparationMinutes", "recoveryMinutes", "restMinutes", "travelMinutes", "maxPerDay"];

/** Words for a lock that was not applied at all. */
export const LOCK_STALE_TEXT = Object.freeze({
  [LOCK_STALE.NO_SUCH_FIXTURE]: "The locked fixture is not in this draw.",
  [LOCK_STALE.NO_SUCH_WINDOW]: "The window it was locked to is no longer offered.",
  published: "The fixture has been published: it stays where its match is.",
});
/** Words for a fixture that is placed but not made into a match. */
export const HELD_TEXT = Object.freeze({
  [DRAFT_HELD.UNSCHEDULED]: "It has no slot.",
  [DRAFT_HELD.AWAITING_WINNER]: "A side is the winner of an earlier match, not yet known.",
  [DRAFT_HELD.NO_TEAM_CODE]: "An entrant has no team code; the fixture route needs one.",
});

/** @param {string} code @param {number} [status] @param {unknown} [detail] */
const err = (code, status = 400, detail = undefined) => Object.assign(new Error(code), { status, detail });

/**
 * A definer function's (ok, reason, detail) row: the row when ok, else a
 * refusal (403 for not_permitted, 422 for the rest).
 * @param {any} r
 */
function answer(r) {
  if (!r) throw err("no_result", 500);
  if (r.ok) return r;
  throw err(r.reason ?? "refused", r.reason === "not_permitted" ? 403 : 422, r.detail ?? undefined);
}

/** @param {unknown} v @param {string} code */
const dayOf = (v, code) => {
  if (typeof v !== "string" || !DAY.test(v) || new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw err(code);
  return v;
};
/** @param {unknown} v @param {string} code */
const instantOf = (v, code) => {
  if (typeof v !== "string" || !INSTANT.test(v) || !Number.isFinite(Date.parse(v))) throw err(code);
  return new Date(Date.parse(v)).toISOString();
};
/** Days from a to b. @param {string} a @param {string} b */
const daysBetween = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;

/** A range of South African days, checked. @param {unknown} from @param {unknown} to */
function rangeOf(from, to) {
  const f = dayOf(from, "range_invalid"), t = dayOf(to, "range_invalid");
  const n = daysBetween(f, t);
  if (n < 0 || n > 366) throw err("range_invalid", 400, "from on or before to, at most a year apart");
  return { from: f, to: t };
}

/** The organiser's locks, checked for shape. @param {unknown} v @returns {PlanLock[]} */
function locksOf(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > PLAN_LIMITS.windows) throw err("locks_invalid", 400, `a list of at most ${PLAN_LIMITS.windows} { fixtureId, windowId }`);
  const seen = new Set();
  return v.map((l) => {
    const fixtureId = l?.fixtureId, windowId = l?.windowId;
    if (typeof fixtureId !== "string" || !fixtureId || fixtureId.length > 200
        || typeof windowId !== "string" || !windowId || windowId.length > 200) throw err("locks_invalid", 400, "each lock is { fixtureId, windowId }");
    if (seen.has(fixtureId)) throw err("locks_invalid", 400, `${fixtureId} is locked twice`);
    seen.add(fixtureId);
    return { fixtureId, windowId };
  });
}

/**
 * The rules plan() takes, from the request's: only its six keys, whole
 * minutes (the engine refuses a bad figure in words). The match's length
 * defaults to the competition's format (fixtureLength()); a declaration
 * format, whose length is days, has to be told.
 * @param {unknown} v @param {{ format: string | null, overs: number | null }} fmt
 * @returns {PlanRules}
 */
function rulesOf(v, fmt) {
  if (v != null && (typeof v !== "object" || Array.isArray(v))) throw err("rules_invalid", 400, "rules are an object of minutes");
  const given = /** @type {Record<string, unknown>} */ (v ?? {});
  const unknown = Object.keys(given).filter((k) => !RULE_KEYS.includes(k));
  if (unknown.length) throw err("rules_invalid", 400, `not a rule: ${unknown.join(", ")}`);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of RULE_KEYS) if (given[k] != null) out[k] = given[k];
  if (out.durationMinutes == null) {
    const len = fixtureLength({ sport: "cricket", format: fmt.format, overs: fmt.overs });
    if (!("minutes" in len)) throw err("duration_required", 422, "a declaration format lasts days: say how many minutes a match takes");
    out.durationMinutes = len.minutes;
  }
  return /** @type {PlanRules} */ (/** @type {unknown} */ (out));
}

/**
 * The entrants to draw, in seed order: the request's ids (a subset, each
 * once), else every entrant as planner_inputs() lists them.
 * @param {unknown} v @param {any[]} all  planner_inputs().entrants
 * @returns {{ id: string, schoolId: string, teamCode: string | null, name: string }[]}
 */
function entrantsOf(v, all) {
  const byId = new Map(all.map((e) => [e.id, e]));
  let ids = all.map((e) => e.id);
  if (v != null) {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw err("entrants_invalid", 400, "a list of entrant ids, in seed order");
    if (new Set(v).size !== v.length) throw err("entrants_invalid", 400, "an entrant appears twice");
    const strangers = v.filter((x) => !byId.has(x));
    if (strangers.length) throw err("entrants_invalid", 422, "not an entrant of this competition");
    ids = /** @type {string[]} */ (v);
  }
  if (ids.length < 2) throw err("too_few_entrants", 422, "a draw needs two entrants");
  if (ids.length > PLAN_LIMITS.entrants) throw err("too_many_entrants", 422, `at most ${PLAN_LIMITS.entrants}: name them with entrants`);
  return ids.map((id) => { const e = byId.get(id); return { id, schoolId: e.schoolId, teamCode: e.teamCode ?? null, name: e.name }; });
}

/**
 * The published conditions in force on each day (condition_set_for(), as the
 * fixture screen pre-fills from), as one values object per day.
 * @param {Db} client @param {string} competition @param {string[]} days
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
async function conditionsOn(client, competition, days) {
  /** @type {Map<string, Record<string, unknown>>} */ const out = new Map(days.map((d) => [d, {}]));
  if (!days.length) return out;
  const { rows } = await client.query(
    `select to_char(d.day, 'YYYY-MM-DD') as day, v.key, v.age_band, v.value
       from unnest($2::date[]) as d(day)
       join condition_value v on v.set_id = condition_set_for($1, d.day)`, [competition, days]);
  for (const r of rows) {
    const values = /** @type {Record<string, unknown>} */ (out.get(r.day));
    if (r.age_band === "") values[r.key] = r.value;
    else values[r.key] = { .../** @type {object} */ (values[r.key] ?? {}), [r.age_band]: r.value };
  }
  return out;
}

/**
 * The inputs planner_inputs() reads for the manager; not_permitted for
 * anybody else, and for a competition that is not there.
 * @param {Db} client @param {string} competition @param {{ from: string, to: string }} range
 */
async function readInputs(client, competition, range) {
  const { rows } = await client.query(`select planner_inputs($1, $2::date, $3::date) as inputs`, [competition, range.from, range.to]);
  const inputs = rows[0]?.inputs;
  if (!inputs) throw err("not_permitted", 403);
  return inputs;
}

/**
 * pairings() and plan() over what the database says, with the fixtures this
 * competition's planner has already made kept where their matches are.
 *
 * @param {object} a
 * @param {any} a.inputs            planner_inputs()'s document
 * @param {string} a.format
 * @param {PlanRules} a.rules
 * @param {PlanLock[]} a.locks      the organiser's
 * @param {{ id: string }[]} a.entrants  in seed order
 * @returns {Plan & { fixtures: (PlannedFixture & { published: { matchId: string, startsAt: string, groundId: string | null } | null })[] }}
 */
export function computePlan({ inputs, format, rules, locks, entrants }) {
  const draw = pairings({ format: /** @type {any} */ (format), entrants: entrants.map((e) => ({ id: e.id })) });
  const inDraw = new Set(entrants.map((e) => e.id));
  const drawIds = new Set(draw.fixtures.map((f) => f.id));
  const knockout = draw.format === PLAN_FORMAT.KNOCKOUT;
  const prep = (rules.preparationMinutes ?? 0) * MINUTE;
  const hold = (rules.durationMinutes + (rules.recoveryMinutes ?? 0)) * MINUTE;

  /** @type {Map<string, any>} fixture id → its match, as planner_inputs() lists it */
  const made = new Map();
  /** @type {PlanKnown[]} */ const known = [];
  for (const k of inputs.known ?? []) {
    if (k.fixtureKey && drawIds.has(k.fixtureKey) && !made.has(k.fixtureKey)) { made.set(k.fixtureKey, k); if (knockout) continue; }
    const sides = (k.entrants ?? []).filter((/** @type {string} */ e) => inDraw.has(e));
    if (!sides.length && !k.groundId) continue;
    known.push({ entrants: sides, groundId: k.groundId ?? null, startsAt: k.startsAt, endsAt: knownFixtureEnd(k) });
  }

  /** @type {PlanWindow[]} */
  const windows = (inputs.windows ?? []).map((/** @type {any} */ w) => ({ id: w.id, groundId: w.groundId, startsAt: w.startsAt, endsAt: w.endsAt }));
  /** @type {Plan["staleLocks"]} */ const overridden = [];
  const userLocks = locks.filter((l) => {
    if (!made.has(l.fixtureId)) return true;
    overridden.push({ ...l, reason: "published" });
    return false;
  });
  /** @type {PlanLock[]} */ const pins = [];
  let fixtures = draw.fixtures;
  if (knockout) {
    // A made knockout fixture is locked to a window that is exactly its match.
    for (const [key, m] of made) {
      const start = Date.parse(m.startsAt);
      const id = `published:${m.matchId}`;
      windows.push({ id, groundId: m.groundId ?? `unplaced:${m.matchId}`,
                     startsAt: new Date(start - prep).toISOString(), endsAt: new Date(start + hold).toISOString() });
      pins.push({ fixtureId: key, windowId: id });
    }
  } else {
    // A made round-robin fixture leaves the draw; its match is a known
    // commitment (above), so nothing else is put on its sides or its ground.
    fixtures = draw.fixtures.filter((f) => !made.has(f.id));
  }

  const result = plan({
    pairings: { ...draw, fixtures },
    windows,
    rules,
    locks: [...pins, ...userLocks],
    known,
    blackouts: (inputs.blackouts ?? [])
      .filter((/** @type {any} */ b) => b.entrantId == null || inDraw.has(b.entrantId))
      .map((/** @type {any} */ b) => ({ day: b.day, entrant: b.entrantId ?? null })),
    grounds: (inputs.grounds ?? []).map((/** @type {any} */ g) => ({
      id: g.id, parentId: g.parentId ?? null,
      closed: (g.closed ?? []).map((/** @type {any} */ c) => ({ from: c.from, to: c.to })),
    })),
  });

  const placedById = new Map(result.fixtures.map((f) => [f.id, f]));
  const all = draw.fixtures.map((f) => {
    const m = made.get(f.id);
    const startsAt = m ? new Date(Date.parse(m.startsAt)).toISOString() : null;
    const published = m ? { matchId: String(m.matchId), startsAt: /** @type {string} */ (startsAt), groundId: m.groundId ?? null } : null;
    const p = placedById.get(f.id);
    if (p) return { ...p, published };
    // A made round-robin fixture: where its match is.
    return { ...f, locked: false, windowId: null, groundId: m?.groundId ?? null, startsAt,
             endsAt: m ? knownFixtureEnd(m) : null, reasons: [], published };
  });
  const placed = all.filter((f) => f.startsAt != null).length;
  return { format: draw.format, fixtures: all, byes: draw.byes, staleLocks: [...overridden, ...result.staleLocks],
           placed, unscheduled: all.length - placed };
}

/**
 * The drafts toFixtureDrafts() makes of a plan, each with the published
 * conditions in force on its own day, and what it holds back.
 * @param {Db} client @param {any} row  a fixture_plan row @param {string | null} competitionFormat
 */
async function draftsOf(client, row, competitionFormat) {
  /** @type {Plan} */ const p = row.plan;
  const entrants = row.entrants.map((/** @type {any} */ e) => ({ id: e.id, schoolId: e.schoolId, teamCode: e.teamCode ?? null }));
  const days = [...new Set(p.fixtures.filter((f) => f.startsAt).map((f) => /** @type {string} */ (matchDay(f.startsAt))))];
  const conditions = await conditionsOn(client, row.competition_id, days);
  /** @type {Map<string, any>} */ const drafts = new Map();
  /** @type {Map<string, string>} */ const held = new Map();
  for (const f of p.fixtures) {
    const day = f.startsAt ? /** @type {string} */ (matchDay(f.startsAt)) : null;
    const one = toFixtureDrafts({ ...p, fixtures: [f] },
                                { id: row.competition_id, format: competitionFormat, conditions: day ? conditions.get(day) ?? {} : {}, entrants });
    for (const d of one.drafts) drafts.set(d.fixtureId, d.body);
    for (const h of one.held) held.set(h.fixtureId, h.reason);
  }
  return { drafts, held };
}

/** @param {any} side @param {Map<string, string>} names */
const sideOut = (side, names) => "entrant" in side
  ? { entrantId: side.entrant, name: names.get(side.entrant) ?? null }
  : { winnerOf: side.winnerOf };

/**
 * A plan as the screen reads it: the fixtures in the draw's order with their
 * sides named, the ground named, the reasons in words, what publishing would
 * hold back and why, and the match each fixture made.
 * @param {any} row  a fixture_plan row
 * @param {{ items: Map<string, any>, manage: boolean, withInputs?: boolean }} ctx
 */
function planOut(row, { items, manage, withInputs = false }) {
  /** @type {Plan & { fixtures: any[] }} */ const p = row.plan;
  const names = new Map(row.entrants.map((/** @type {any} */ e) => [e.id, e.name]));
  const grounds = new Map((row.inputs.grounds ?? []).map((/** @type {any} */ g) => [g.id, g.name]));
  const entrants = row.entrants.map((/** @type {any} */ e) => ({ id: e.id, schoolId: e.schoolId, teamCode: e.teamCode ?? null }));
  const { held } = heldOf(p, row.competition_id, entrants);
  return {
    id: row.id, competitionId: row.competition_id, version: row.version, state: row.state, format: row.format,
    from: row.range_from_day, to: row.range_to_day, rules: row.rules, locks: row.locks, basedOn: row.based_on ?? null,
    createdBy: row.created_by, createdAt: row.created_at, computedAt: row.computed_at,
    publishedBy: row.published_by ?? null, publishedAt: row.published_at ?? null, supersededAt: row.superseded_at ?? null,
    canManage: manage,
    entrants: row.entrants.map((/** @type {any} */ e) => ({ id: e.id, name: e.name, schoolId: e.schoolId, teamCode: e.teamCode ?? null })),
    summary: { fixtures: p.fixtures.length, placed: p.placed, unscheduled: p.unscheduled,
               made: p.fixtures.filter((f) => items.has(f.id)).length, byes: p.byes.length },
    fixtures: p.fixtures.map((f) => {
      const item = items.get(f.id);
      return {
        id: f.id, round: f.round, leg: f.leg, match: f.match,
        home: sideOut(f.home, names), away: sideOut(f.away, names),
        locked: f.locked, windowId: f.windowId, groundId: f.groundId, groundName: f.groundId ? grounds.get(f.groundId) ?? null : null,
        startsAt: f.startsAt, endsAt: f.endsAt,
        reasons: (f.reasons ?? []).map((/** @type {keyof typeof PLAN_REASON_TEXT} */ code) => ({ code, text: PLAN_REASON_TEXT[code] })),
        held: held.get(f.id) ? { code: held.get(f.id), text: HELD_TEXT[/** @type {keyof typeof HELD_TEXT} */ (held.get(f.id))] } : null,
        // The match publishing made for it (any version of this competition's plans), as made.
        made: item ? { matchId: item.match_id, planId: item.plan_id, startsAt: item.starts_at, groundId: item.ground_id ?? null } : null,
      };
    }),
    byes: p.byes.map((b) => ({ round: b.round, entrantId: b.entrant, name: names.get(b.entrant) ?? null })),
    staleLocks: p.staleLocks.map((l) => ({ ...l, text: LOCK_STALE_TEXT[/** @type {keyof typeof LOCK_STALE_TEXT} */ (l.reason)] ?? null })),
    inputs: withInputs ? row.inputs : {
      windows: (row.inputs.windows ?? []).length, grounds: (row.inputs.grounds ?? []).length,
      blackouts: (row.inputs.blackouts ?? []).length, known: (row.inputs.known ?? []).length,
    },
  };
}

/** What publishing would hold back, without the conditions (the view needs only the reason). @param {Plan} p @param {string} id @param {any[]} entrants */
function heldOf(p, id, entrants) {
  const { held } = toFixtureDrafts(p, { id, entrants });
  return { held: new Map(held.map((h) => [h.fixtureId, h.reason])) };
}

const PLAN_COLUMNS = `p.id, p.competition_id, p.version, p.state, p.format, to_char(p.range_from, 'YYYY-MM-DD') as range_from_day,
  to_char(p.range_to, 'YYYY-MM-DD') as range_to_day, p.rules, p.entrants, p.locks, p.inputs, p.plan, p.based_on,
  p.created_by, p.created_at, p.computed_at, p.published_by, p.published_at, p.superseded_at`;

/** @param {Db} client @param {string} competition @param {string} planId */
async function planRow(client, competition, planId) {
  const { rows } = await client.query(`select ${PLAN_COLUMNS} from fixture_plan p where p.id = $1 and p.competition_id = $2`, [planId, competition]);
  if (!rows.length) throw err("not_permitted", 403);
  return rows[0];
}

/** The matches this competition's planner made, as the caller may read them. @param {Db} client @param {string} competition */
async function itemsOf(client, competition) {
  const { rows } = await client.query(
    `select fixture_key, plan_id, match_id, starts_at, ground_id from fixture_plan_item where competition_id = $1`, [competition]);
  return new Map(rows.map((r) => [r.fixture_key, r]));
}

/** @param {Db} client @param {string} competition */
async function manages(client, competition) {
  const { rows } = await client.query(`select competition_conditions_manager($1) as m`, [competition]);
  return rows[0]?.m === true;
}

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function plannerRoutes({ pool, secret }) {
  /** @param {(req: any) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
      if (e.code === "22P02") return res.status(400).json({ error: "malformed" });
      // The engine refuses a caller's mistake in words ("planner: …"): an
      // input over a limit, a rule out of range, a window with no offset.
      if (e instanceof RangeError && /^planner: /.test(e.message)) {
        return res.status(422).json({ error: "plan_input_invalid", detail: e.message.slice(9) });
      }
      const status = e.status || 500;
      if (status >= 500) console.error("planner →", e.code || "", e.message);
      res.status(status).json({ error: e.message || "error", ...(e.detail !== undefined ? { detail: e.detail } : {}) });
    }
  };
  /** @param {any} req */
  const as = (req) => req.headers?.authorization;
  /** @param {unknown} v */
  const uuid = (v) => { const s = String(v ?? ""); if (!UUID.test(s)) throw err("not_found", 404); return s; };
  /** @param {any} req */
  const idOf = (req) => uuid(req.params?.id);
  /** @param {any} req */
  const subOf = (req) => uuid(req.params?.sub);

  /**
   * Compute a plan from fresh inputs and the given parameters. The entrants
   * are either the request's (`ids`, checked against the competition as it
   * is now) or a stored plan's snapshot, drawn as it was: an entrant that has
   * left since is still in the draw, and publishing its fixture is refused
   * by the fixture route in its own words (invalid_fixture).
   * @param {Db} client @param {string} competition
   * @param {{ format: string, range: { from: string, to: string }, rules: unknown, locks: PlanLock[],
   *           entrants: { ids: unknown } | { snapshot: { id: string, schoolId: string, teamCode: string | null, name: string }[] } }} a
   */
  const compute = async (client, competition, a) => {
    const inputs = await readInputs(client, competition, a.range);
    const conditions = (await conditionsOn(client, competition, [a.range.from])).get(a.range.from) ?? {};
    const rules = rulesOf(a.rules, fixtureFormatFrom(conditions, inputs.competition?.format ?? null));
    const entrants = "snapshot" in a.entrants ? a.entrants.snapshot : entrantsOf(a.entrants.ids, inputs.entrants ?? []);
    const computed = computePlan({ inputs, format: a.format, rules, locks: a.locks, entrants });
    return { inputs, rules, entrants, computed };
  };

  /** @param {Db} client @param {string} competition @param {string} planId @param {boolean} [withInputs] */
  const view = async (client, competition, planId, withInputs = false) => {
    const row = await planRow(client, competition, planId);
    const manage = await manages(client, competition);
    return planOut(row, { items: await itemsOf(client, competition), manage, withInputs: withInputs && manage });
  };

  return {
    // GET /api/competitions/:id/planner/inputs?from=YYYY-MM-DD&to=YYYY-MM-DD
    //   → planner_inputs()'s document, each known fixture with the end the
    //     planner takes for it (endsAt, from its format), and the rules'
    //     default durationMinutes. The competition's manager only.
    inputs: handle(async (req) => {
      const id = idOf(req);
      const range = rangeOf(req.query?.from, req.query?.to);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const inputs = await readInputs(client, id, range);
        const conditions = (await conditionsOn(client, id, [range.from])).get(range.from) ?? {};
        const fmt = fixtureFormatFrom(conditions, inputs.competition?.format ?? null);
        const len = fixtureLength({ sport: "cricket", format: fmt.format, overs: fmt.overs });
        return { ...inputs,
                 known: (inputs.known ?? []).map((/** @type {any} */ k) => ({ ...k, endsAt: knownFixtureEnd(k) })),
                 defaults: { durationMinutes: "minutes" in len ? len.minutes : null, format: fmt.format, overs: fmt.overs } };
      });
    }),

    // GET /api/competitions/:id/plans → { canManage, plans: [...] }
    //   The manager lists every version; anybody else who may reach the
    //   competition only the published (and superseded-after-published) ones.
    list: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(
          `select p.id, p.version, p.state, p.format, to_char(p.range_from, 'YYYY-MM-DD') as range_from_day,
                  to_char(p.range_to, 'YYYY-MM-DD') as range_to_day, (p.plan->>'placed')::int as placed,
                  (p.plan->>'unscheduled')::int as unscheduled, jsonb_array_length(p.plan->'fixtures') as fixtures,
                  p.based_on, p.created_by, p.created_at, p.computed_at, p.published_at, p.superseded_at
             from fixture_plan p where p.competition_id = $1 order by p.version desc`, [id]);
        return { canManage: await manages(client, id),
                 plans: rows.map((r) => ({ id: r.id, version: r.version, state: r.state, format: r.format,
                                           from: r.range_from_day, to: r.range_to_day, fixtures: r.fixtures,
                                           placed: r.placed, unscheduled: r.unscheduled, basedOn: r.based_on ?? null,
                                           createdBy: r.created_by, createdAt: r.created_at, computedAt: r.computed_at,
                                           publishedAt: r.published_at ?? null, supersededAt: r.superseded_at ?? null })) };
      });
    }),

    // GET /api/competitions/:id/plans/:planId[?inputs=1] → the plan (planOut)
    get: handle(async (req) => {
      const id = idOf(req), planId = subOf(req);
      return runAsPrincipal(pool, secret, as(req), (client) => view(client, id, planId, req.query?.inputs === "1"));
    }),

    // POST /api/competitions/:id/plans
    //   { format, from, to, rules?, locks?, entrants?, basedOn? } → the new draft (planOut)
    //   With basedOn (a plan of this competition), anything not sent is that
    //   plan's: regenerate is { basedOn } alone.
    create: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const basedOn = b.basedOn == null ? null : uuid(b.basedOn);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const base = basedOn ? await planRow(client, id, basedOn) : null;
        const format = b.format ?? base?.format;
        if (!FORMATS.has(format)) throw err("format_invalid", 400, "round_robin, double_round_robin or knockout");
        const range = rangeOf(b.from ?? base?.range_from_day, b.to ?? base?.range_to_day);
        const locks = locksOf(b.locks !== undefined ? b.locks : base?.locks);
        const { inputs, rules, entrants, computed } = await compute(client, id, {
          format, range, locks,
          rules: b.rules !== undefined ? b.rules : base?.rules,
          entrants: { ids: b.entrants !== undefined ? b.entrants : base?.entrants.map((/** @type {any} */ e) => e.id) },
        });
        const { rows } = await client.query(
          `select * from fixture_plan_save($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, $10)`,
          [id, format, range.from, range.to, JSON.stringify(rules), JSON.stringify(entrants), JSON.stringify(locks),
           JSON.stringify(inputs), JSON.stringify(computed), basedOn]);
        const r = answer(rows[0]);
        return view(client, id, r.plan_id);
      });
    }),

    // POST /api/competitions/:id/plans/:planId/locks { locks } → the draft (planOut)
    //   The draft recomputed in place with these locks, over the inputs as
    //   they are now. A published or superseded plan: not_a_draft.
    locks: handle(async (req) => {
      const id = idOf(req), planId = subOf(req);
      const locks = locksOf((req.body || {}).locks);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const row = await planRow(client, id, planId);
        if (row.state !== "draft") throw err("not_a_draft", 422, row.state);
        const { inputs, computed } = await compute(client, id, {
          format: row.format, range: { from: row.range_from_day, to: row.range_to_day }, locks,
          rules: row.rules, entrants: { snapshot: row.entrants },
        });
        const { rows } = await client.query(`select * from fixture_plan_recompute($1, $2, $3, $4)`,
          [planId, JSON.stringify(locks), JSON.stringify(inputs), JSON.stringify(computed)]);
        answer(rows[0]);
        return view(client, id, planId);
      });
    }),

    // POST /api/competitions/:id/plans/:planId/publish
    //   → { plan: { id, version, state }, first, results: [...], counts }
    //   Each fixture: created | already | refused | held. Idempotent: a
    //   retry makes only what was not made.
    publish: handle(async (req) => {
      const id = idOf(req), planId = subOf(req);
      // 1. The state, and the check against the database as it is now.
      const prepared = await runAsPrincipal(pool, secret, as(req), async (client) => {
        const row = await planRow(client, id, planId);
        const { rows } = await client.query(`select * from fixture_plan_publish($1)`, [planId]);
        const pub = answer(rows[0]);
        const items = await itemsOf(client, id);
        /** @type {Plan & { fixtures: any[] }} */ const stored = row.plan;
        // Every fixture the plan placed and has not made, locked to its window.
        const locks = stored.fixtures.filter((f) => f.windowId && !items.has(f.id) && !String(f.windowId).startsWith("published:"))
                                     .map((f) => ({ fixtureId: f.id, windowId: /** @type {string} */ (f.windowId) }));
        const { computed } = await compute(client, id, {
          format: row.format, range: { from: row.range_from_day, to: row.range_to_day }, locks,
          rules: row.rules, entrants: { snapshot: row.entrants },
        });
        const now = new Map(computed.fixtures.map((f) => [f.id, f]));
        const stale = new Map(computed.staleLocks.map((l) => [l.fixtureId, l.reason]));
        const { rows: comp } = await client.query(`select format from competition where id = $1`, [id]);
        const { drafts, held } = await draftsOf(client, row, comp[0]?.format ?? null);
        return { row, first: pub.first === true, items, now, stale, drafts, held };
      });

      const names = new Map(prepared.row.entrants.map((/** @type {any} */ e) => [e.id, e.name]));
      /** @param {PlanSide} s */
      const who = (s) => "entrant" in s ? names.get(s.entrant) ?? s.entrant : `winner of ${s.winnerOf}`;
      /** @type {any[]} */ const results = [];
      for (const f of /** @type {PairedFixture[] & any[]} */ (prepared.row.plan.fixtures)) {
        const base = { fixtureId: f.id, round: f.round, home: who(f.home), away: who(f.away) };
        const made = prepared.items.get(f.id);
        if (made) { results.push({ ...base, outcome: "already", matchId: made.match_id }); continue; }
        const heldReason = prepared.held.get(f.id);
        if (heldReason) { results.push({ ...base, outcome: "held", held: heldReason, text: HELD_TEXT[/** @type {keyof typeof HELD_TEXT} */ (heldReason)] }); continue; }
        const again = prepared.now.get(f.id);
        if (prepared.stale.get(f.id) === LOCK_STALE.NO_SUCH_WINDOW) {
          results.push({ ...base, outcome: "refused", error: "window_withdrawn", detail: LOCK_STALE_TEXT[LOCK_STALE.NO_SUCH_WINDOW] }); continue;
        }
        if (!again || again.windowId !== f.windowId) {
          const reasons = (again?.reasons ?? []).map((/** @type {keyof typeof PLAN_REASON_TEXT} */ code) => ({ code, text: PLAN_REASON_TEXT[code] }));
          results.push({ ...base, outcome: "refused", error: "clash", detail: "The slot no longer fits: regenerate the plan.", reasons }); continue;
        }
        const body = prepared.drafts.get(f.id);
        // 2. One fixture, one transaction: the lock, the route's insert, the item.
        try {
          const r = await runAsPrincipal(pool, secret, as(req), async (client) => {
            const { rows: b } = await client.query(`select * from fixture_plan_item_begin($1, $2)`, [planId, f.id]);
            const begun = answer(b[0]);
            if (begun.match_id) return { outcome: "already", matchId: begun.match_id };
            const m = await insertFixture(client, fixtureInsertParams(body));
            const { rows: rec } = await client.query(`select * from fixture_plan_item_record($1, $2, $3)`, [planId, f.id, m.id]);
            answer(rec[0]);
            return { outcome: "created", matchId: m.id, startsAt: m.startsAt, sharedWithOpponent: m.sharedWithOpponent };
          });
          results.push({ ...base, ...r });
        } catch (/** @type {any} */ e) {
          // Not a refusal (the connection, a bug): the whole request fails,
          // and a retry makes only what this one did not.
          if (!e.code && !e.status) throw e;
          // A database refusal in the fixture route's words; one of this
          // module's (a definer function's answer, the route's validation) as it is.
          const refusal = e.code ? fixtureRefusal(e).body : { error: e.message, ...(e.detail !== undefined ? { detail: e.detail } : {}) };
          results.push({ ...base, outcome: "refused", ...refusal });
        }
      }
      /** @type {Record<string, number>} */ const counts = { created: 0, already: 0, refused: 0, held: 0 };
      for (const r of results) counts[r.outcome] += 1;
      return { plan: { id: planId, version: prepared.row.version, state: "published" }, first: prepared.first, counts, results };
    }),

    // ── The inputs' own records ────────────────────────────────────

    // GET /api/competitions/:id/blackouts → { blackouts: [{ id, day, entrantId, entrantName, reason, createdAt }] }
    //   As the table's policy lets the reader see them (db/67).
    blackouts: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(
          `select b.id, to_char(b.day, 'YYYY-MM-DD') as day, b.entrant_id, e.display_name, b.reason, b.created_at
             from competition_blackout b left join competition_entrant e on e.id = b.entrant_id
            where b.competition_id = $1 order by b.day, b.entrant_id nulls first, b.id`, [id]);
        return { blackouts: rows.map((r) => ({ id: r.id, day: r.day, entrantId: r.entrant_id ?? null,
                                               entrantName: r.display_name ?? null, reason: r.reason ?? null, createdAt: r.created_at })) };
      });
    }),

    // POST /api/competitions/:id/blackouts { day, entrantId?, reason? } → { ok, id }
    //   refusals: not_permitted, entrant_invalid, day_invalid, reason_too_long
    blackoutAdd: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const day = dayOf(b.day, "day_invalid");
      const entrant = b.entrantId == null || b.entrantId === "" ? null : uuid(b.entrantId);
      if (b.reason != null && typeof b.reason !== "string") throw err("reason_invalid");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from competition_blackout_add($1, $2::date, $3, $4)`, [id, day, entrant, b.reason ?? null]);
        return { ok: true, id: answer(rows[0]).blackout_id };
      });
    }),

    // POST /api/competition-blackouts/:id/remove → { ok }
    blackoutRemove: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`select * from competition_blackout_remove($1)`, [id]);
        answer(rows[0]);
        return { ok: true };
      });
    }),

    // GET /api/grounds/:id/windows[?from=&to=] → { windows: [{ id, groundId, startsAt, endsAt, competitionId, createdAt }] }
    windows: handle(async (req) => {
      const id = idOf(req);
      const range = req.query?.from || req.query?.to ? rangeOf(req.query?.from, req.query?.to) : null;
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(
          `select w.id, w.ground_id, w.starts_at, w.ends_at, w.competition_id, w.created_at from ground_window w
            where w.ground_id = $1
              and ($2::date is null or w.starts_at >= $2::date::timestamp at time zone 'Africa/Johannesburg')
              and ($3::date is null or w.ends_at <= ($3::date + 1)::timestamp at time zone 'Africa/Johannesburg')
            order by w.starts_at, w.id`, [id, range?.from ?? null, range?.to ?? null]);
        return { windows: rows.map((r) => ({ id: r.id, groundId: r.ground_id, startsAt: r.starts_at, endsAt: r.ends_at,
                                             competitionId: r.competition_id ?? null, createdAt: r.created_at })) };
      });
    }),

    // POST /api/grounds/:id/windows { startsAt, endsAt, competitionId? } → the window
    //   Instants with their offset. refusals: not_permitted, starts_at_invalid,
    //   ends_at_invalid, window_invalid (ends first, or longer than a week),
    //   competition_invalid
    windowAdd: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const starts = instantOf(b.startsAt, "starts_at_invalid"), ends = instantOf(b.endsAt, "ends_at_invalid");
      if (Date.parse(ends) <= Date.parse(starts)) throw err("window_invalid", 400, "a window ends after it starts");
      const competition = b.competitionId == null || b.competitionId === "" ? null : String(b.competitionId);
      if (competition != null && !UUID.test(competition)) throw err("competition_invalid");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        await groundVisible(client, id);
        try {
          const { rows } = await client.query(
            `insert into ground_window (ground_id, starts_at, ends_at, competition_id) values ($1, $2, $3, $4)
             returning id, ground_id, starts_at, ends_at, competition_id, created_at`, [id, starts, ends, competition]);
          const r = rows[0];
          return { id: r.id, groundId: r.ground_id, startsAt: r.starts_at, endsAt: r.ends_at, competitionId: r.competition_id ?? null, createdAt: r.created_at };
        } catch (/** @type {any} */ e) {
          if (e.code === "23514") throw err("window_invalid", 422, e.message);
          if (e.code === "23503") throw err("competition_invalid", 422);
          throw e;
        }
      });
    }),

    // POST /api/ground-windows/:id/remove → { ok }
    windowRemove: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`delete from ground_window where id = $1 returning id`, [id]);
        if (!rows.length) throw err("not_permitted", 403);
        return { ok: true };
      });
    }),

    // GET /api/grounds/:id/closures → { closures: [{ id, groundId, from, to, reason, createdAt }] }
    closures: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(
          `select id, ground_id, closed_from, closed_to, reason, created_at from ground_closure
            where ground_id = $1 order by closed_from, id`, [id]);
        return { closures: rows.map((r) => ({ id: r.id, groundId: r.ground_id, from: r.closed_from, to: r.closed_to,
                                              reason: r.reason, createdAt: r.created_at })) };
      });
    }),

    // POST /api/grounds/:id/closures { from, to, reason } → the closure
    //   refusals: not_permitted, from_invalid, to_invalid, closure_invalid,
    //   reason_required (3 to 120 characters)
    closureAdd: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      const from = instantOf(b.from, "from_invalid"), to = instantOf(b.to, "to_invalid");
      if (Date.parse(to) <= Date.parse(from)) throw err("closure_invalid", 400, "a closure ends after it starts");
      const reason = typeof b.reason === "string" ? b.reason.trim() : "";
      if (reason.length < 3 || reason.length > 120) throw err("reason_required", 400, "a reason of 3 to 120 characters");
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        await groundVisible(client, id);
        try {
          const { rows } = await client.query(
            `insert into ground_closure (ground_id, closed_from, closed_to, reason) values ($1, $2, $3, $4)
             returning id, ground_id, closed_from, closed_to, reason, created_at`, [id, from, to, reason]);
          const r = rows[0];
          return { id: r.id, groundId: r.ground_id, from: r.closed_from, to: r.closed_to, reason: r.reason, createdAt: r.created_at };
        } catch (/** @type {any} */ e) {
          if (e.code === "23514") throw err("closure_invalid", 422, e.message);
          throw e;
        }
      });
    }),

    // POST /api/ground-closures/:id/remove → { ok }
    closureRemove: handle(async (req) => {
      const id = idOf(req);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        const { rows } = await client.query(`delete from ground_closure where id = $1 returning id`, [id]);
        if (!rows.length) throw err("not_permitted", 403);
        return { ok: true };
      });
    }),

    // POST /api/grounds/:id/parent { parentId: uuid | null } → { id, parentId }
    //   A pitch put on its field (or taken off it). facility.manage at the
    //   ground's school (the ground's own policy). refusals: not_permitted,
    //   parent_invalid (another school's ground, itself, a cycle, too deep)
    parent: handle(async (req) => {
      const id = idOf(req);
      const b = req.body || {};
      if (!("parentId" in b)) throw err("parent_invalid", 400, "parentId: a ground's id, or null");
      const parent = b.parentId == null ? null : uuid(b.parentId);
      return runAsPrincipal(pool, secret, as(req), async (client) => {
        try {
          const { rows } = await client.query(`update ground set parent_id = $2 where id = $1 returning id, parent_id`, [id, parent]);
          if (!rows.length) throw err("not_permitted", 403);
          return { id: rows[0].id, parentId: rows[0].parent_id ?? null };
        } catch (/** @type {any} */ e) {
          if (e.code === "23514" || e.code === "23503") throw err("parent_invalid", 422, e.code === "23514" ? e.message : "no such ground");
          throw e;
        }
      });
    }),
  };
}

/**
 * A ground the caller may see, or not_permitted: a window or closure on a
 * ground that is not there, and one on a ground that is not yours, are the
 * same refusal (the insert policy decides the second anyway).
 * @param {Db} client @param {string} id
 */
async function groundVisible(client, id) {
  const { rows } = await client.query(`select 1 from ground where id = $1`, [id]);
  if (!rows.length) throw err("not_permitted", 403);
}
