/**
 * Scouting, over HTTP.
 *
 * Three routes for the three functions in db/08_schema_programme.sql. Every
 * one of them does what every write path here does: nothing. Whether a
 * caller may act is decided inside the function, under their own identity —
 * this layer only shapes the request and reports the refusal.
 *
 * `err` and the `call`/`handle` pair mirror guardianLinkRoutes() in
 * assessment-api.mjs exactly, because the shape is the same: a SECURITY
 * DEFINER function returns { ok, reason }, and a false ok is a 403 naming
 * the reason rather than a generic failure.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

function err(code, status = 400) {
  return Object.assign(new Error(code), { status });
}

export function scoutingRoutes({ pool, secret }) {
  const call = (sql, params) => (req) => runAsPrincipal(
    pool, secret, req.headers?.authorization,
    async (client) => {
      const { rows } = await client.query(sql, params(req));
      const r = rows[0] ?? { ok: false, reason: "no_result" };
      if (r.ok === false) { throw err(r.reason || "refused", 403); }
      return r;
    });
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /players/:id/scouting-consent { granted: boolean }
    //
    // The check inside scouting_consent_set() is guardian-only, with no
    // administrative override — see that function for why. This handler adds
    // one thing the function cannot: rejecting a missing or non-boolean
    // `granted` before it reaches the database, so "withdraw" typed as a
    // string does not silently become truthy.
    consent: handle(async (req) => {
      if (typeof req.body?.granted !== "boolean") throw err("granted_must_be_boolean");
      return call(
        `select * from scouting_consent_set($1, $2)`,
        (r) => [r.params.id, r.body.granted])(req);
    }),

    // POST /scouts/accreditation { organisation, scoutRole? }
    //
    // Self-service, and always lands 'pending' — the function will not let
    // this call verify itself. Re-registering under a different organisation
    // re-opens the gate: see scout_accreditation_register().
    registerAccreditation: handle(async (req) => {
      if (!req.body?.organisation || typeof req.body.organisation !== "string") {
        throw err("organisation_required");
      }
      return call(
        `select * from scout_accreditation_register($1, $2)`,
        (r) => [r.body.organisation, r.body.scoutRole ?? null])(req);
    }),

    // POST /scouts/:id/accreditation/decide { verified: boolean, note? }
    //
    // Platform-only — scouting.accredit, checked inside the function against
    // the caller's own role_assignment, never against the scout being decided.
    decideAccreditation: handle(async (req) => {
      if (typeof req.body?.verified !== "boolean") throw err("verified_must_be_boolean");
      return call(
        `select * from scout_accreditation_decide($1, $2, $3)`,
        (r) => [r.params.id, r.body.verified, r.body.note ?? null])(req);
    }),
  };
}
