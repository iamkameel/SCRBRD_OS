/**
 * SCRBRD — a bowler's nets and training load, and the family's health-
 * monitoring consent (SCRBRD-110 phase 1, db/60).
 *
 * WHAT THIS FILE DECIDES: nothing. The load route inserts rows under the
 * caller's own identity and load_entry's policy (player.workload.write, on
 * his side) and its stamp decide: who recorded it and as whom, which school
 * it belongs to, which day a session was on, whether the school has the
 * module, and whether a nets entry carries a count (it may not) or a paper-
 * scored match a band (it may not). The consent route calls one SECURITY
 * DEFINER function that checks who may answer for the child. A refusal is a
 * fact the screen shows in words, not a 500.
 *
 * There is NO health-consent gate on the load route (§1.5, Q5): a nets band is
 * ordinary processing under the guardian-link consent, as attendance is.
 *
 *   POST /api/load-entry
 *     the group: { trainingSessionId, kind?, entries: [{ playerId, band, effort?, minutes? }] }
 *                one transaction, one row per boy — all or nothing
 *     one:       { playerId, kind, onDate?, band | units, effort?, minutes?,
 *                  trainingSessionId?, supersedes? }
 *   POST /api/players/:id/consents/health
 *     { yes, version, guardianId?, formName?, formDate? }
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler, CaughtError } from "../api-types.mjs" */

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });

/** The effort buttons: low, medium, high write 3, 6, 9 (§1.3). */
export const EFFORT = Object.freeze({ low: 3, medium: 6, high: 9 });
export const BANDS = Object.freeze(["lt12", "12_24", "24_36", "36plus"]);
export const KINDS = Object.freeze(["nets", "training", "match_elsewhere"]);

/** The stamp's refusals, by the word it raises; every other check violation is "refused". */
const STAMP = new Set(["workload_monitoring_off", "unit_not_of_sport", "session_not_at_his_school",
  "session_is_on_another_day", "load_entry_in_future", "supersedes_another_session", "no_date"]);

/** @type {Record<string, number>} */
const CONSENT_STATUS = {
  not_signed_in: 401, not_permitted: 403, not_under_support: 403,
  no_such_player: 404, no_verified_link: 404, already_given: 409,
};

/** @param {ApiResponse} res @param {CaughtError} e */
const fail = (res, e) => {
  if (e.code === "22P02" || e.code === "22007" || e.code === "22008") return res.status(400).json({ error: "bad_request" });
  // A CHECK constraint (the band-or-count rule) or the stamp's own refusal.
  if (e.code === "23514") {
    const reason = STAMP.has(e.message) ? e.message : (/** @type {CaughtError & { constraint?: string }} */ (e).constraint || "refused");
    return res.status(422).json({ error: "refused", reason });
  }
  if (e.code === "23503") return res.status(404).json({ error: e.message === "no_such_session" ? "no_such_session" : "no_such_player" });
  if (e.code === "23502") return res.status(400).json({ error: e.message === "no_date" ? "no_date" : "missing_field" });
  // RLS: the caller may not write a load for this boy.
  if (e.code === "42501") return res.status(403).json({ error: "not_permitted" });
  res.status(e.status || 500).json({ error: e.message || "error" });
};

/** @param {unknown} v */
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
/** A whole number in range, or null when absent; anything else is refused by name. @param {unknown} v @param {number} lo @param {number} hi @param {string} code */
const int = (v, lo, hi, code) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw err(code);
  return n;
};
/** @param {unknown} v */
const effort = (v) => {
  if (v == null || v === "") return null;
  const n = EFFORT[/** @type {keyof typeof EFFORT} */ (String(v))];
  if (!n) throw err("effort_is_low_medium_or_high");
  return n;
};
/** @param {unknown} v */
const band = (v) => {
  if (v == null || v === "") return null;
  if (!BANDS.includes(String(v))) throw err("band_invalid");
  return String(v);
};
/** @param {unknown} v */
const day = (v) => {
  const s = text(v);
  if (s == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw err("on_date_invalid");
  return s;
};

/**
 * One row as the client sent it, shaped for the insert. The band-or-count
 * rule is NOT checked here: the table's CHECK is the authority, and a nets
 * entry that carries a count is sent to it to be refused.
 * @param {any} e @param {{ kind?: unknown, trainingSessionId?: unknown }} [group]
 */
function shape(e, group = {}) {
  const kind = text(group.kind ?? e.kind) ?? "nets";
  if (!KINDS.includes(kind)) throw err("kind_invalid");
  const playerId = text(e.playerId);
  if (!playerId) throw err("player_required");
  return {
    playerId, kind,
    trainingSessionId: text(group.trainingSessionId ?? e.trainingSessionId),
    onDate: day(e.onDate),
    band: band(e.band),
    units: int(e.units, 0, 1000, "units_invalid"),
    rpe: effort(e.effort),
    minutes: int(e.minutes, 1, 600, "minutes_invalid"),
    supersedes: text(e.supersedes),
  };
}

/** @param {ReturnType<typeof shape>} r */
const asParams = (r) => [r.playerId, r.kind, r.trainingSessionId, r.onDate, r.band, r.units, r.rpe, r.minutes, r.supersedes];

/** @param {any} r */
const asEntry = (r) => ({
  id: r.id, playerId: r.player_id, kind: r.kind, trainingSessionId: r.training_session_id,
  onDate: r.on_date ? String(r.on_date).slice(0, 10) : null, band: r.band, units: r.units,
  rpe: r.rpe, minutes: r.minutes, recordedAs: r.recorded_as, recordedAt: r.recorded_at, supersedes: r.supersedes,
});

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function loadRoutes({ pool, secret }) {
  return {
    // POST /api/load-entry — a group or one.
    entry: async (/** @type {ApiRequest} */ req, /** @type {ApiResponse} */ res) => {
      try {
        const b = req.body || {};
        const group = Array.isArray(b.entries);
        if (group && !text(b.trainingSessionId)) throw err("training_session_required");
        if (group && (b.entries.length === 0 || b.entries.length > 60)) throw err("entries_invalid");
        const rows = group ? b.entries.map((/** @type {any} */ e) => shape(e, { kind: b.kind, trainingSessionId: b.trainingSessionId }))
                           : [shape(b)];
        if (group && new Set(rows.map((/** @type {{ playerId: string }} */ r) => r.playerId)).size !== rows.length) throw err("a_player_twice");
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const written = [];
          for (const r of rows) {
            const { rows: [row] } = await client.query(
              `insert into load_entry (player_id, kind, training_session_id, on_date, band, units, rpe, minutes, supersedes)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               returning id, player_id, kind, training_session_id, on_date, band, units, rpe, minutes,
                         recorded_as, recorded_at, supersedes`,
              asParams(r));
            written.push(asEntry(row));
          }
          return written;
        });
        res.json(group ? { rows: out } : out[0]);
      } catch (/** @type {any} */ e) { fail(res, e); }
    },

    // POST /api/players/:id/consents/health — yes or no, for this child.
    healthConsent: async (/** @type {ApiRequest} */ req, /** @type {ApiResponse} */ res) => {
      try {
        const b = req.body || {};
        if (typeof b.yes !== "boolean") throw err("no_answer");
        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const { rows: [r] } = await client.query(
            `select * from health_monitoring_consent_set($1, $2, $3, $4, $5, $6)`,
            [req.params.id, b.yes, text(b.version), text(b.guardianId), text(b.formName), day(b.formDate)]);
          return r;
        });
        if (!out?.ok) throw err(out?.reason || "refused", CONSENT_STATUS[out?.reason] ?? 422);
        res.json({ ok: true, yes: b.yes });
      } catch (/** @type {any} */ e) { fail(res, e); }
    },
  };
}
