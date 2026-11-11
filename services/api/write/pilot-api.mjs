/**
 * SCRBRD — Pilot Match, phase 2: the server's half (slices 1 and 2).
 *
 * docs/design/PILOT_MATCH_PHASE2.md. A Pilot Match is a match a
 * platform-granted scorer starts from the field with typed teams and typed
 * names. It lives in schema `pilot` (db/151), which the application role
 * cannot reach: every route here calls one of db/151's pilot_* functions,
 * which ask `owner_user_id = app_user_id()` and a live pilot.scorer grant —
 * never app_can(), so no role assignment reaches a pilot.
 *
 * BEHIND TWO SWITCHES, both off as db/151 leaves them: `pilot_sync` (off,
 * every function refuses and the phone offers phase 1 only) and
 * `pilot_names_upload` (off, the typed names stay on the phone). Counsel's
 * §14 is unanswered; nothing here sends a name while the second is off.
 *
 * ONE ANSWER FOR "NOT YOURS". An unknown id, another account's id, a caller
 * with no grant and phase 2 switched off all answer 404 not_found on every
 * per-match route, so nobody learns that a pilot exists (§3.3 step 2).
 *
 * THE WRITE PATH IS THE FIXTURE'S (§3.1): appendBatch() in events-api.mjs,
 * the one core (dedupe by fingerprint, the Laws over the fold, value
 * refusals, the authoritative seq, held for a stale epoch), over PILOT_STORE
 * below. What the pilot adds is the screen every event passes first:
 * name_in_event, unknown_slot and free_text (db/151 pilot_event_refusal()).
 * What it does not take from the fixture path: a handover to another person,
 * a second account, an official's amendment, and a competition's playing
 * conditions (it folds by its date and format alone).
 *
 * Routes (all signed in; a pad resume credential reaches none of them — the
 * pilot scope of padKey is slice 3b):
 *   GET  /api/pilot/status                  { sync, granted, names }
 *   GET  /api/pilot/mine                    { matches: [header] }
 *   POST /api/pilot/matches                 pilot_create: { ok, reason }
 *   GET  /api/pilot/:id                     the header
 *   GET  /api/pilot/:id/names               { names: [{slot, name}] } (until the names' date)
 *   POST /api/pilot/:id/names { rows }      pilot_names_put: { ok, reason, n }
 *   POST /api/pilot/:id/session/claim       { device, takeover?, epoch? }
 *   POST /api/pilot/:id/session/heartbeat   { device, epoch }
 *   POST /api/pilot/:id/events { events }   the batch, as /api/matches/:id/events
 *   GET  /api/pilot/:id/events?since=       { matchId, events, quarantined, fold }
 *   POST /api/pilot/:id/finish              { ok, reason }
 *   POST /api/pilot/:id/abandon { reason }  { ok, reason }   a code only
 *   POST /api/pilot/:id/delete              { ok, reason }
 *   POST /api/pilot/delete-all              { removed }
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { appendBatch, checkBatch } from "./events-api.mjs";
import { safeErr } from "../log-safe.mjs";
/** @import { Pool, IdHandler, RouteDeps } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {unknown} id @returns {string | null} */
export const pilotUuid = (id) => (typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null);

/** The one not-found. */
const notFound = () => Object.assign(new Error("not_found"), { status: 404 });

/**
 * What the core is told about how to fold a pilot (matchFoldContext()'s
 * shape): its start and format. A pilot has no playing conditions.
 */
const NO_CONDITIONS = { conditions: null, conditionsHash: null, conditionsFixed: false,
                        conditionsSources: null, conditionsTitle: null, conditionsVersion: null };

/**
 * What a held ball keeps: the envelope's own fields and the screened event,
 * nothing else a client might have put beside them.
 * @param {any} ev
 */
const heldBody = (ev) => ({
  matchId: ev.matchId ?? null, deviceId: ev.deviceId, scorerId: ev.scorerId ?? null, epoch: ev.epoch,
  innings: ev.innings ?? 0, clientSeq: ev.clientSeq, clientTs: ev.clientTs ?? null,
  idempotencyKey: ev.idempotencyKey, payload: ev.payload ?? {},
});

/**
 * A Pilot Match's log (LogStore, events-api.mjs): db/151's functions, each
 * of which asks the owner again.
 * @type {import("./events-api.mjs").LogStore}
 */
export const PILOT_STORE = {
  // The per-match lock, and the lease. Raises 42501 for anybody but the
  // owner, which the route answers as not_found.
  lease: async (client, id, device, epoch) => {
    const { rows } = await client.query(`select * from pilot_lease_check($1, $2, $3)`, [id, device, epoch]);
    return rows[0] || { found: false, holds: false, epoch: null };
  },
  prepare: async () => {},
  log: async (client, id) => (await client.query(`select * from pilot_log($1, 0)`, [id])).rows,
  foldContext: async (client, id) => {
    const { rows } = await client.query(`select starts_at, format from pilot_fold_context($1)`, [id]);
    const t = rows[0]?.starts_at ?? null;
    return { ...NO_CONDITIONS, startsAt: t == null ? null : new Date(t).toISOString(), format: rows[0]?.format ?? null };
  },
  dedupe: async (client, id, key, colsJson) => {
    const { rows } = await client.query(`select * from pilot_dedupe($1, $2, $3::jsonb)`, [id, key, colsJson]);
    const r = rows[0];
    if (r?.seq != null) return { written: { seq: r.seq, same: r.same === true } };
    if (r?.held_same != null) return { held: { same: r.held_same === true } };
    return {};
  },
  hold: (client, id, ev, lease, colsJson) => client.query(
    `select pilot_hold($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [id, ev.epoch, lease.epoch, ev.idempotencyKey, JSON.stringify(heldBody(ev)), colsJson]),
  insert: async (client, id, ev, colsJson) => {
    const { rows } = await client.query(
      `select pilot_insert($1, $2, $3, $4, $5, $6::jsonb) as seq`,
      [id, ev.epoch, ev.idempotencyKey, ev.clientSeq, new Date(ev.clientTs ?? Date.now()), colsJson]);
    return rows[0].seq;
  },
  // Before anything else, whoever holds the token: a name, a stranger in a
  // player field, or free text refuses this event (and only this event).
  screen: async (client, id, ev) => {
    const { rows } = await client.query(`select pilot_event_refusal($1, $2::jsonb) as why`, [id, JSON.stringify(ev?.payload ?? {})]);
    return /** @type {any} */ (rows[0]?.why ?? null);
  },
};

/**
 * @param {RouteDeps} deps
 * @returns {Record<string, IdHandler>}
 */
export function pilotRoutes({ pool, secret }) {
  /**
   * Run as the caller. A refusal of the caller's standing (42501: the lease
   * check, an insert without a live lease) and every not_found are the one
   * not-found; everything else is the error as it came.
   * @param {(req: any) => Promise<unknown>} fn @returns {IdHandler}
   */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "42501" || e.status === 404) return res.status(404).json({ error: "not_found" });
      if (!e.status) console.error("pilot →", safeErr(e));
      res.status(e.status || 500).json({ error: e.code || e.message });
    }
  };
  /** @param {any} req @param {(client: any, principal: any) => Promise<any>} fn */
  const as = (req, fn) => runAsPrincipal(pool, secret, req.headers?.authorization, fn);
  /** @param {any} req */
  const idOf = (req) => { const id = pilotUuid(req.params?.id); if (!id) throw notFound(); return id; };
  /** A function's {ok, reason} row; its not_found is the one not-found. @param {any} row */
  const answer = (row) => { if (!row || row.reason === "not_found") throw notFound(); return row; };
  /** The caller's own match, or the one not-found. @param {any} client @param {string} id */
  const mine = async (client, id) => {
    const { rows } = await client.query(`select pilot_header($1) as h`, [id]);
    if (!rows[0]?.h) throw notFound();
    return rows[0].h;
  };

  return {
    status: handle((req) => as(req, async (c) => {
      const { rows } = await c.query(`select * from pilot_status()`);
      return { sync: rows[0]?.sync === true, granted: rows[0]?.granted === true, names: rows[0]?.names === true };
    })),

    mine: handle((req) => as(req, async (c) => ({ matches: (await c.query(`select x as h from pilot_mine() x`)).rows.map((/** @type {any} */ r) => r.h) }))),

    create: handle((req) => {
      const b = req.body ?? {};
      const id = pilotUuid(b.id);
      if (!id) return Promise.resolve({ ok: false, reason: "bad_match" });
      return as(req, async (c) => {
        const { rows } = await c.query(
          `select * from pilot_create($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9::jsonb)`,
          [id, JSON.stringify(b.sides ?? null), JSON.stringify(b.slots ?? null), Number.isInteger(b.overs) ? b.overs : null,
           typeof b.format === "string" ? b.format : null, b.startsAt ? new Date(b.startsAt) : null,
           JSON.stringify(b.toss ?? null), typeof b.venueName === "string" ? b.venueName : null, JSON.stringify(b.weather ?? null)]);
        // The create's own refusals (not_granted, pilot_off) are answers the
        // phone acts on: the match stays on it as a Practice Match.
        return rows[0] ?? { ok: false, reason: "no_result" };
      });
    }),

    header: handle((req) => { const id = idOf(req); return as(req, (c) => mine(c, id)); }),

    names: handle((req) => {
      const id = idOf(req);
      return as(req, async (c) => {
        await mine(c, id);
        const { rows } = await c.query(`select slot_id, typed_name from pilot_names_for_owner($1)`, [id]);
        return { names: rows.map((/** @type {any} */ r) => ({ slot: r.slot_id, name: r.typed_name })) };
      });
    }),

    putNames: handle((req) => {
      const id = idOf(req);
      return as(req, async (c) => answer((await c.query(`select * from pilot_names_put($1, $2::jsonb)`,
                                                         [id, JSON.stringify(req.body?.rows ?? null)])).rows[0]));
    }),

    claim: handle((req) => {
      const id = idOf(req);
      const device = typeof req.body?.device === "string" ? req.body.device : null;
      return as(req, async (c) => answer(req.body?.takeover === true
        ? (await c.query(`select * from pilot_takeover($1, $2, $3)`, [id, device, Number.isInteger(req.body?.epoch) ? req.body.epoch : null])).rows[0]
        : (await c.query(`select * from pilot_claim($1, $2)`, [id, device])).rows[0]));
    }),

    // The heartbeat, and the pad's way to ask where the token stands: the
    // fixture route's answer shape (session-routes.mjs). The lease asked
    // about is the principal's device.
    heartbeat: handle((req) => {
      const id = idOf(req);
      return as(req, async (c, principal) => {
        const named = req.body?.device;
        if (named != null && named !== principal.deviceId) return { ok: false, epoch: null, state: null, reason: "device_mismatch" };
        const r = (await c.query(`select * from pilot_lease_check($1, $2, $3)`,
                                 [id, principal.deviceId, Number.isInteger(req.body?.epoch) ? req.body.epoch : null])).rows[0] ?? {};
        const over = r.state === "match_complete" || r.state === "match_abandoned";
        return { ok: !!r.holds, epoch: r.epoch ?? null, state: over ? null : (r.state ?? null),
                 reason: r.holds ? null : over ? r.state : (r.found ? "not_token_holder" : "no_session") };
      });
    }),

    append: handle((req) => {
      const id = idOf(req);
      const events = req.body?.events || [];
      checkBatch(events);
      return as(req, (c, principal) => appendBatch(c, principal, PILOT_STORE, id, events));
    }),

    list: handle((req) => {
      const id = idOf(req);
      return as(req, async (c) => {
        await mine(c, id);
        const since = Number(req.query?.since || 0);
        const { rows } = await c.query(`select * from pilot_log($1, $2)`, [id, Number.isInteger(since) ? since : 0]);
        const { rows: q } = await c.query(`select pilot_held_here($1) as n`, [id]);
        const fold = await PILOT_STORE.foldContext(c, id);
        return { matchId: id, events: rows, quarantined: q[0]?.n ?? 0, fold };
      });
    }),

    finish: handle((req) => { const id = idOf(req); return as(req, async (c) => answer((await c.query(`select * from pilot_finish($1)`, [id])).rows[0])); }),

    abandon: handle((req) => {
      const id = idOf(req);
      return as(req, async (c) => answer((await c.query(`select * from pilot_abandon($1, $2)`,
                                                         [id, typeof req.body?.reason === "string" ? req.body.reason : null])).rows[0]));
    }),

    remove: handle((req) => { const id = idOf(req); return as(req, async (c) => answer((await c.query(`select * from pilot_delete($1)`, [id])).rows[0])); }),

    removeAll: handle((req) => as(req, async (c) => ({ removed: (await c.query(`select pilot_delete_all_for(app_user_id()) as n`)).rows[0]?.n ?? 0 }))),
  };
}
