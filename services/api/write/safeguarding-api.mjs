/**
 * SCRBRD — safeguarding, phase 1: raising a concern, and the DSO's record.
 *
 * CSA's Safeguarding Policy asks for a Designated Safeguarding Officer at
 * every school and club, a way for anybody to raise a concern with that
 * officer, and a record of it nobody else reads by standing (p15–18, p52,
 * p63). db/57 is all of that; this file only carries it over HTTP.
 *
 * WHAT THIS FILE DECIDES: nothing. Every route calls one SECURITY DEFINER
 * function under the caller's own identity, and the function checks who may
 * do what, writes the access log and answers with a verdict. A refusal is a
 * fact the screen shows in words, not a 500.
 *
 * NOT A READ RESOURCE. No safeguarding table is in read-api.mjs: the
 * functions are the only doors, so every read of the record is logged under
 * the institution that holds it (db/57 §4.2 of the design).
 *
 * NOT MODULE-GATED. A school cannot switch off a child's way to tell
 * somebody, the way it switches off Analytics.
 *
 * The Guardian's app (CSA's anonymous-reporting partner) is linked from the
 * form by a URL the platform sets: GUARDIAN_APP_URL on this server. Unset,
 * the screen says so rather than inventing one.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiResponse, Handler, CaughtError } from "../api-types.mjs" */

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });

/** @type {Record<string, number>} */
const STATUS = {
  not_signed_in: 401, not_your_school: 403, not_permitted: 403,
  no_such_concern: 404, no_such_share: 404, no_such_person: 404, child_not_visible: 404, subject_unknown: 404,
};

/** @param {ApiResponse} res @param {CaughtError} e */
const fail = (res, e) => {
  if (e.code === "22P02" || e.code === "22007" || e.code === "22008") return res.status(400).json({ error: "bad_request" });
  if (e.code === "23514") return res.status(422).json({ error: "refused" });
  const status = e.code === "42501" ? 403 : (e.status || 500);
  res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
};

/** @param {unknown} v */
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v));
/** @param {unknown} v */
const list = (v) => (Array.isArray(v) ? v.map(String) : null);

/**
 * The anonymous-reporting link, if the platform set one. Only an https URL is
 * handed to a browser: this is a link a frightened child will press.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function guardianAppUrl(env = process.env) {
  const raw = String(env.GUARDIAN_APP_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch { return null; }
}

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function safeguardingRoutes({ pool, secret }) {
  /**
   * @param {(client: any, req: any) => Promise<unknown>} fn
   * @returns {Handler}
   */
  const handle = (fn) => async (req, res) => {
    try {
      const out = await runAsPrincipal(pool, secret, req.headers?.authorization, (client) => fn(client, req));
      res.json(out);
    } catch (/** @type {any} */ e) { fail(res, e); }
  };
  /** A verdict row: ok, or the function's own reason with its status. @param {any} r */
  const verdict = (r) => {
    if (!r) throw err("no_result", 500);
    if (!r.ok) throw err(r.reason || "refused", STATUS[r.reason] ?? 422);
    return r;
  };

  return {
    // GET /api/safeguarding/contacts — the DSO card: who the DSOs are at my
    // institutions (or, with none, above them), and the anonymous link.
    contacts: handle(async (client) => {
      const { rows } = await client.query(`select * from dso_contacts(null)`);
      return {
        rows: rows.map((/** @type {any} */ r) => ({ schoolId: r.school_id, schoolName: r.school_name, personId: r.person_id,
                                 name: r.name, heldAt: r.held_at })),
        guardianAppUrl: guardianAppUrl(),
      };
    }),

    // POST /api/safeguarding/concerns — anybody signed in. The answer is a
    // reference and a time, and nothing else, ever.
    raise: handle(async (client, req) => {
      const b = req.body || {};
      const { rows } = await client.query(
        `select * from safeguarding_concern_raise(
           p_school => $1, p_about_kind => $2, p_nature => $3, p_certainty => $4, p_account => $5,
           p_how_learned => $6, p_subject_player => $7, p_subject_person => $8, p_subject_text => $9,
           p_occurred_on => $10, p_occurred_where => $11, p_authorities_told => $12, p_named_ok => $13,
           p_preferred_dso => $14)`,
        [text(b.schoolId), text(b.aboutKind), list(b.nature), text(b.certainty), text(b.account),
         text(b.howLearned), text(b.subjectPlayerId), text(b.subjectPersonId), text(b.subjectText),
         text(b.occurredOn), text(b.occurredWhere), text(b.authoritiesTold), b.namedOk === true,
         text(b.preferredDsoId)]);
      const r = verdict(rows[0]);
      return { reference: r.reference, raisedAt: r.raised_at, unheld: r.unheld === true };
    }),

    // GET /api/safeguarding/receipts — my own references and when.
    receipts: handle(async (client) => {
      const { rows } = await client.query(`select reference, raised_at from my_concern_receipts()`);
      return { rows: rows.map((/** @type {any} */ r) => ({ reference: r.reference, raisedAt: r.raised_at })) };
    }),

    // GET /api/safeguarding/inbox — a DSO's concerns, with the clocks. Empty
    // for anybody else, which is the same answer as a DSO with none.
    inbox: handle(async (client) => {
      const { rows } = await client.query(`select * from safeguarding_inbox(null)`);
      return {
        rows: rows.map((/** @type {any} */ r) => ({
          id: r.id, reference: r.reference, tenantId: r.tenant_id, tenantName: r.tenant_name,
          schoolId: r.school_id, schoolName: r.school_name, raisedAt: r.raised_at, aboutKind: r.about_kind,
          nature: r.nature, certainty: r.certainty, state: r.state, assignedTo: r.assigned_to,
          assignedName: r.assigned_name, unheld: r.unheld, clockHours: r.clock_hours,
          hoursOpen: r.hours_open == null ? null : Number(r.hours_open), clockStopped: r.clock_stopped,
          overdue: r.overdue,
        })),
      };
    }),

    // GET /api/safeguarding/concerns/:id — the record, to a DSO who holds it.
    open: handle(async (client, req) => {
      const { rows: [r] } = await client.query(`select safeguarding_concern_open($1) as c`, [req.params.id]);
      if (!r?.c) throw err("no_such_concern", 404);
      return r.c;
    }),

    // GET /api/safeguarding/concerns/:id/family — the named child's guardians
    // and emergency contacts, while the concern is open; logged.
    family: handle(async (client, req) => {
      const { rows: [r] } = await client.query(`select safeguarding_family($1) as f`, [req.params.id]);
      if (!r?.f) throw err("no_such_concern", 404);
      return r.f;
    }),

    // POST /api/safeguarding/concerns/:id/notes { kind, body }
    note: handle(async (client, req) => {
      const b = req.body || {};
      const { rows } = await client.query(`select * from safeguarding_note($1, $2, $3)`,
        [req.params.id, text(b.kind) ?? "note", text(b.body)]);
      return { id: verdict(rows[0]).note_id };
    }),

    // POST /api/safeguarding/concerns/:id/assign { dsoId }
    assign: handle(async (client, req) => {
      const { rows } = await client.query(`select * from safeguarding_assign($1, $2)`,
        [req.params.id, text(req.body?.dsoId)]);
      verdict(rows[0]);
      return { ok: true };
    }),

    // POST /api/safeguarding/concerns/:id/shares { withPersonId, what, openUntil, reason, withLinkId? }
    share: handle(async (client, req) => {
      const b = req.body || {};
      const { rows } = await client.query(`select * from safeguarding_share($1, $2, $3, $4, $5, $6)`,
        [req.params.id, text(b.withPersonId), list(b.what), text(b.openUntil), text(b.reason), text(b.withLinkId)]);
      return { id: verdict(rows[0]).share_id };
    }),

    // POST /api/safeguarding/concerns/:id/close { outcome, positionOfTrust, note? }
    close: handle(async (client, req) => {
      const b = req.body || {};
      if (typeof b.positionOfTrust !== "boolean") throw err("position_of_trust_required", 422);
      const { rows } = await client.query(`select * from safeguarding_close($1, $2, $3, $4)`,
        [req.params.id, text(b.outcome), b.positionOfTrust, text(b.note)]);
      return { retainUntil: verdict(rows[0]).retain_until };
    }),

    // GET /api/safeguarding/shares — what a DSO has shared with me, live.
    shares: handle(async (client) => {
      const { rows } = await client.query(`select * from my_safeguarding_shares()`);
      return { rows: rows.map((/** @type {any} */ r) => ({ id: r.id, sharedAt: r.shared_at, openUntil: r.open_until, what: r.what })) };
    }),

    // GET /api/safeguarding/shares/:id — open one; only the parts named; logged.
    shareOpen: handle(async (client, req) => {
      const { rows: [r] } = await client.query(`select safeguarding_share_open($1) as s`, [req.params.id]);
      if (!r?.s) throw err("no_such_share", 404);
      return r.s;
    }),

    // POST /api/safeguarding/shares/:id/revoke
    shareRevoke: handle(async (client, req) => {
      const { rows } = await client.query(`select * from safeguarding_share_revoke($1)`, [req.params.id]);
      const r = verdict(rows[0]);
      return { ok: true, ...(r.reason ? { note: r.reason } : {}) };
    }),

    // POST /api/safeguarding/appointments/:id/end — the provincial or
    // national DSO ends a school DSO's appointment (db/57's guard lets
    // nobody at the school do it while a concern naming them is open).
    endAppointment: handle(async (client, req) => {
      const { rows } = await client.query(`select * from safeguarding_dso_end($1)`, [req.params.id]);
      const r = verdict(rows[0]);
      return { ok: true, ...(r.reason ? { note: r.reason } : {}) };
    }),
  };
}
