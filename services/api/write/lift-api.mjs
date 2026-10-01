/**
 * SCRBRD — parent lift clubs, phase 1: the arrangement (SCRBRD-124).
 *
 * The design is docs/design/SCRBRD-124_lift_clubs.md; the schema and every
 * rule of who may do what are db/70_lift_clubs.sql. Parents offer seats in
 * their own cars to their own son's fixtures; other parents ask for a seat for
 * theirs; a seat is confirmed only while the boy's guardian and the driver
 * have both said yes to the lift as it now stands.
 *
 * WHAT THIS FILE DECIDES: nothing about who. Every route calls one SECURITY
 * DEFINER function under the caller's own identity, and the function decides,
 * writes the access log where a name or a number is read, and answers with a
 * verdict — a refusal is a word the screen shows, never a sentence that says
 * whether a row the caller may not see exists. The one thing done here is the
 * round trip (D1): two offers, one form, one transaction, so a refused second
 * leg leaves no first leg behind.
 *
 * NOT A READ RESOURCE. No lift table is in read-api.mjs (§5.4): these routes
 * are the only doors. The module gate (`lift_club`) is on every route that
 * makes or reads an arrangement; the routes that END one — a family's "no", a
 * driver's or the office's cancel, a declaration or a policy withdrawn — are
 * never gated, because a school switching the module off must not be able to
 * stop anybody stopping.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, Handler, ApiResponse, CaughtError } from "../api-types.mjs" */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (/** @type {string} */ code, status = 422, /** @type {unknown} */ detail = undefined) =>
  Object.assign(new Error(code), { status, detail });

/** @type {Record<string, number>} */
const STATUS = {
  not_signed_in: 401, not_permitted: 403, module_disabled: 403,
  version_conflict: 409, already_on_a_lift: 409, already_offered: 409, seats_full: 409,
};

/** @param {ApiResponse} res @param {CaughtError & { detail?: unknown }} e */
const fail = (res, e) => {
  if (e.code === "22P02" || e.code === "22007" || e.code === "22008") return res.status(400).json({ error: "bad_request" });
  if (e.code === "23514") return res.status(422).json({ error: "refused" });
  const status = e.code === "42501" ? 403 : (e.status || 500);
  res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error"),
                            ...(e.detail !== undefined ? { detail: e.detail } : {}) });
};

/** @param {unknown} v */
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v));
/** @param {unknown} v */
const id = (v) => { const s = text(v); if (!s || !UUID.test(s)) throw err("not_permitted", 403); return s; };
/** @param {unknown} v */
const int = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

/** A verdict row: itself when ok, else the function's own word with its status. @param {any} r */
const verdict = (r) => {
  if (!r) throw err("no_result", 500);
  if (!r.ok) throw err(r.reason || "refused", STATUS[r.reason] ?? 422, r.other_offer ? { otherOffer: r.other_offer } : undefined);
  return r;
};

/** An offer as the screens read it. @param {any} r */
const offerOut = (r) => ({
  id: r.offer_id, schoolId: r.school_id, team: r.team_code, leg: r.leg, driverName: r.driver_name, mine: r.is_mine,
  meetKind: r.meet_kind, meetPlace: r.meet_place, meetAt: r.meet_at, seats: r.seats, confirmed: r.confirmed,
  seatsLeft: r.seats_left, note: r.note, state: r.state, version: r.version, awaitingDriver: r.awaiting_driver,
  fixtureStartsAt: r.fixture_starts_at, mySeats: r.my_seats ?? [], myChildren: r.my_children ?? [],
});

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function liftRoutes({ pool, secret }) {
  /** @param {(client: any, req: any) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try {
      res.json(await runAsPrincipal(pool, secret, req.headers?.authorization, (client) => fn(client, req)));
    } catch (/** @type {any} */ e) { fail(res, e); }
  };
  /** One verdict function by name, with its arguments. @param {any} client @param {string} sql @param {unknown[]} args */
  const call = async (client, sql, args) => verdict((await client.query(sql, args)).rows[0]);

  return {
    // GET /api/lifts/standing?schoolId= — may I drive here, and if not why, in
    // the school's words; my declaration; whether the module is live.
    standing: handle(async (client, req) => {
      const { rows: [r] } = await client.query(`select * from my_lift_standing($1)`, [id(req.query?.schoolId)]);
      if (!r) return { moduleLive: false, mayDrive: false, reason: "not_permitted", words: null, declaration: null };
      return {
        moduleLive: r.module_live, mayDrive: r.may_drive, reason: r.reason, words: r.words, policyVersion: r.policy_version,
        declaration: r.declaration_id ? {
          id: r.declaration_id, vehicle: r.vehicle_description, registration: r.registration, seats: r.seats,
          expiresOn: r.expires_on, policyVersion: r.declared_policy_version, contactId: r.reach_contact_id,
          policyCurrent: r.declared_policy_version === r.policy_version,
        } : null,
      };
    }),

    // GET /api/lifts/policy?schoolId= — the school's text, as it stands. Read
    // under lift_policy's own policy: anyone with an assignment at the school.
    policy: handle(async (client, req) => {
      const { rows: [p] } = await client.query(
        `select p.id, p.version, p.body, p.requires_clearance, p.allow_one_to_one, p.meet_note, p.signed_at,
                (select u.name from app_user u where u.id = p.signed_by) as signed_by_name,
                lift_module_live(p.school_id) as live
           from lift_policy p where p.school_id = $1 and p.withdrawn_at is null`, [id(req.query?.schoolId)]);
      return { policy: p ? { id: p.id, version: p.version, body: p.body, requiresClearance: p.requires_clearance,
                             allowOneToOne: p.allow_one_to_one, meetNote: p.meet_note, signedAt: p.signed_at,
                             signedBy: p.signed_by_name, live: p.live } : null };
    }),

    // POST /api/lifts/policy { schoolId, body, requiresClearance, allowOneToOne, meetNote } — the principal signs.
    signPolicy: handle(async (client, req) => {
      const b = req.body || {};
      const r = await call(client, `select * from lift_policy_sign($1, $2, $3, $4, $5)`,
        [id(b.schoolId), text(b.body), b.requiresClearance === true, b.allowOneToOne !== false, text(b.meetNote)]);
      return { id: r.policy_id, version: r.version };
    }),

    // POST /api/lifts/policy/withdraw { schoolId } — every open lift at the school is cancelled.
    withdrawPolicy: handle(async (client, req) => {
      const r = await call(client, `select * from lift_policy_withdraw($1)`, [id(req.body?.schoolId)]);
      return { cancelled: r.cancelled };
    }),

    // POST /api/lifts/declaration { schoolId, vehicle, registration, seats, licenceHeld, insured, roadworthy, belts, codeAcknowledged, contactId }
    declare: handle(async (client, req) => {
      const b = req.body || {};
      const r = await call(client, `select * from lift_driver_declare($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id(b.schoolId), text(b.vehicle), text(b.registration), int(b.seats), b.licenceHeld === true, b.insured === true,
         b.roadworthy === true, b.belts === true, b.codeAcknowledged === true, text(b.contactId)]);
      return { id: r.declaration_id, expiresOn: r.expires_on };
    }),

    // POST /api/lifts/declaration/withdraw { schoolId } — her open lifts are cancelled.
    withdrawDeclaration: handle(async (client, req) => {
      const r = await call(client, `select * from lift_driver_declaration_withdraw($1)`, [id(req.body?.schoolId)]);
      return { cancelled: r.cancelled };
    }),

    // GET /api/matches/:id/lifts — the offers on a fixture, as this family reads them.
    offers: handle(async (client, req) => {
      const { rows } = await client.query(`select * from lift_offers_for($1)`, [id(req.params.id)]);
      return { rows: rows.map(offerOut) };
    }),

    // POST /api/matches/:id/lifts { legs: [{ leg, seats, meetKind, meetAt, note }] } — one leg, or a round
    // trip as two (D1), in one transaction: a refused leg leaves neither.
    offer: handle(async (client, req) => {
      const legs = Array.isArray(req.body?.legs) ? req.body.legs : [req.body ?? {}];
      if (legs.length < 1 || legs.length > 2) throw err("legs", 422);
      if (legs.length === 2 && legs[0]?.leg === legs[1]?.leg) throw err("legs", 422);
      const match = id(req.params.id);
      const made = [];
      for (const l of legs) {
        const r = await call(client, `select * from lift_offer_create($1, $2, $3, $4, $5, $6)`,
          [match, text(l?.leg), int(l?.seats), text(l?.meetKind), text(l?.meetAt), text(l?.note)]);
        made.push({ leg: l.leg, id: r.offer_id });
      }
      return { offers: made };
    }),

    // GET /api/matches/:id/lifts/summary — the office's counts (no name).
    summary: handle(async (client, req) => {
      const { rows } = await client.query(`select * from lift_summary($1)`, [id(req.params.id)]);
      return { rows: rows.map((/** @type {any} */ r) => ({ schoolId: r.school_id, leg: r.leg, offers: r.offers,
        seatsOffered: r.seats_offered, confirmed: r.confirmed, requested: r.requested, awaiting: r.awaiting })) };
    }),

    // POST /api/lifts/:id { seats, meetKind, meetAt, note, version } — the driver edits; every family is asked again.
    update: handle(async (client, req) => {
      const b = req.body || {};
      const r = await call(client, `select * from lift_offer_update($1, $2, $3, $4, $5, $6)`,
        [id(req.params.id), int(b.seats), text(b.meetKind), text(b.meetAt), text(b.note), int(b.version)]);
      return { version: r.version };
    }),

    // POST /api/lifts/:id/reaffirm { version } — after the fixture moved, she still offers it.
    reaffirm: handle(async (client, req) => {
      const r = await call(client, `select * from lift_offer_reaffirm($1, $2)`, [id(req.params.id), int(req.body?.version)]);
      return { version: r.version };
    }),

    // POST /api/lifts/:id/close — no more requests.
    close: handle(async (client, req) => {
      await call(client, `select * from lift_offer_close($1)`, [id(req.params.id)]);
      return { ok: true };
    }),

    // POST /api/lifts/:id/cancel — the driver, or the office.
    cancel: handle(async (client, req) => {
      await call(client, `select * from lift_offer_cancel($1)`, [id(req.params.id)]);
      return { ok: true };
    }),

    // GET /api/lifts/:id/passengers — names, to whoever db/70 allows; logged.
    passengers: handle(async (client, req) => {
      const { rows } = await client.query(`select * from lift_passengers($1)`, [id(req.params.id)]);
      return { rows: rows.map((/** @type {any} */ r) => ({ seatId: r.seat_id, playerId: r.player_id, name: r.full_name,
                                                            status: r.status })) };
    }),

    // GET /api/lifts/:id/contacts — numbers, on the day only; logged. null outside.
    contacts: handle(async (client, req) => {
      const { rows: [r] } = await client.query(`select lift_contacts($1) as c`, [id(req.params.id)]);
      return { contacts: r?.c ?? null };
    }),

    // POST /api/lifts/:id/seats { playerId } — a family asks for a seat.
    request: handle(async (client, req) => {
      const r = await call(client, `select * from lift_seat_request($1, $2)`, [id(req.params.id), id(req.body?.playerId)]);
      return { seatId: r.seat_id };
    }),

    // POST /api/lifts/:id/accept { seatIds } — the driver accepts one or more, together (D5).
    accept: handle(async (client, req) => {
      const seats = Array.isArray(req.body?.seatIds) ? req.body.seatIds.map(id) : [];
      if (!seats.length) throw err("no_seats", 422);
      const r = await call(client, `select * from lift_seat_accept($1::uuid[])`, [seats]);
      // The seats must be this offer's: the function checks they share one
      // offer and that the caller drives it; this checks it is the one named.
      const { rows: [o] } = await client.query(`select offer_id from lift_seat where id = $1`, [seats[0]]);
      if (o && o.offer_id !== req.params.id) throw err("not_permitted", 403);
      return { confirmed: r.confirmed };
    }),

    // POST /api/lift-seats/:id/decline — the driver says no to a request.
    decline: handle(async (client, req) => {
      await call(client, `select * from lift_seat_decline($1)`, [id(req.params.id)]);
      return { ok: true };
    }),

    // POST /api/lift-seats/:id/withdraw — a family's "no". Never gated.
    withdraw: handle(async (client, req) => {
      await call(client, `select * from lift_seat_withdraw($1)`, [id(req.params.id)]);
      return { ok: true };
    }),

    // POST /api/lift-seats/:id/reconfirm — a family says yes to the lift as it now stands.
    reconfirm: handle(async (client, req) => {
      await call(client, `select * from lift_seat_reconfirm($1)`, [id(req.params.id)]);
      return { ok: true };
    }),
  };
}
