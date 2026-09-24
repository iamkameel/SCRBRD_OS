/**
 * The officials register — who may stand, and what grade they hold.
 *
 * db/08 has held the register since it existed: official, official_accreditation,
 * and the policies that let officiating.registry.manage write them. Nothing
 * wrote them. A register that only the seed could fill is a list, and the
 * capability that maintains it governed nothing — the audit's phrase.
 *
 * Three routes, each a plain INSERT/UPDATE under row-level security: the
 * policies decide who may, and a refusal is the database's 42501 mapped to
 * 403. Nothing here re-states the capability.
 *
 *   POST /api/officials                     { fullName, born | idNumber, panel?, email?, phone? }
 *   POST /api/officials/:id/accredit        { level, validFrom, validUntil?, issuedBy? }
 *   POST /api/officials/:id/retire          {}
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { resolveBirthDate, PLAUSIBLE_YEARS_OFFICIAL } from "@scrbrd/policy/date-of-birth";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const LEVELS = new Set(["club", "level1", "level2", "national"]);

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function officialRegisterRoutes({ pool, secret }) {
  /** @param {string} code @param {number} [status] @param {unknown} [detail] */
  const err = (code, status = 400, detail) => Object.assign(new Error(code), { status, detail });
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      const status = e.code === "42501" ? 403 : e.code === "23505" ? 409 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : e.code === "23505" ? "already_registered" : (e.message || "error"), ...(e.detail ? { detail: e.detail } : {}) });
    }
  };
  return {
    add: handle(async (req) => {
      const b = req.body || {};
      const fullName = String(b.fullName ?? "").trim();
      if (!fullName) throw err("name_required");
      // An official's age is not decoration (db/08): the window is an adult's.
      const dob = resolveBirthDate({ born: b.born, idNumber: b.idNumber }, new Date(),
        { plausible: PLAUSIBLE_YEARS_OFFICIAL, notPlausible: "born_not_plausible_for_an_official" });
      if (!dob.ok) throw err(dob.reason, 400, { field: dob.field });
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into official (full_name, born, id_number, email, phone, panel)
           values ($1, $2, $3, $4, $5, $6)
           returning id, full_name, panel, active`,
          [fullName, dob.born, dob.idNumber ?? null, b.email?.trim() || null, b.phone?.trim() || null, b.panel?.trim() || null]);
        return { ...rows[0], warning: dob.warning ?? null };
      });
    }),
    accredit: handle(async (req) => {
      const b = req.body || {};
      if (!LEVELS.has(b.level)) throw err("level_unknown", 400, { level: b.level ?? null, known: [...LEVELS] });
      const from = String(b.validFrom ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw err("valid_from_required");
      const until = b.validUntil ? String(b.validUntil).slice(0, 10) : null;
      if (until && !(until > from)) throw err("valid_until_before_from");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into official_accreditation (official_id, level, issued_by, valid_from, valid_until)
           values ($1, $2, $3, $4, $5)
           returning id, official_id, level, valid_from, valid_until`, [req.params.id, b.level, b.issuedBy?.trim() || null, from, until]);
        return rows[0];
      });
    }),
    retire: handle(async (req) => runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
      const { rows } = await client.query(`update official set active = false where id = $1 and active returning id, active`, [req.params.id]);
      if (!rows.length) throw err("no_such_official", 404);
      return rows[0];
    })),
  };
}
