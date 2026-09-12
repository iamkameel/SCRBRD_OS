/** SCRBRD — a school's drills and kit. Policies do the deciding; see tables.mjs and db/08. */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
const CATEGORIES = ["batting", "bowling", "fielding", "keeping", "fitness", "tactical"];
const KINDS = ["bat", "ball", "pads", "gloves", "helmet", "kit", "stumps", "net", "bowling_machine", "other"];

export function kitRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
      if (e.code === "23505") return res.status(422).json({ error: "already_granted" });
      if (e.code === "23503") return res.status(404).json({ error: "not_found" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  const asPrincipal = (req, fn) => runAsPrincipal(pool, secret, req.headers?.authorization, fn);

  return {
    // POST /api/drills { schoolId, name, category, durationMin, description? }
    drill: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
      if (!CATEGORIES.includes(b.category)) throw err("category_invalid");
      const name = clean(b.name, 80); if (!name || name.length < 3) throw err("name_required");
      const mins = Number(b.durationMin); if (!Number.isInteger(mins) || mins < 5 || mins > 180) throw err("duration_invalid");
      return asPrincipal(req, async (c) => {
        const { rows } = await c.query(`insert into drill (school_id, name, category, duration_min, description) values ($1,$2,$3,$4,$5) returning id`,
                                       [b.schoolId, name, b.category, mins, clean(b.description, 500)]);
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id };
      });
    }),
    // POST /api/equipment { schoolId, kind, label, quantity, condition?, notes? }
    equipment: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
      if (!KINDS.includes(b.kind)) throw err("kind_invalid");
      const label = clean(b.label, 80); if (!label || label.length < 2) throw err("label_required");
      const qty = Number(b.quantity); if (!Number.isInteger(qty) || qty < 0) throw err("quantity_invalid");
      return asPrincipal(req, async (c) => {
        const { rows } = await c.query(`insert into equipment (school_id, kind, label, quantity, condition, notes) values ($1,$2,$3,$4,coalesce($5,'good'),$6) returning id`,
                                       [b.schoolId, b.kind, label, qty, clean(b.condition, 10), clean(b.notes, 300)]);
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id };
      });
    }),
    // POST /api/equipment/:id/issue { playerId }
    issue: handle(async (req) => {
      const player = String(req.body?.playerId ?? "");
      if (!UUID.test(player)) throw err("player_required");
      return asPrincipal(req, async (c) => {
        const { rows } = await c.query(`insert into equipment_issue (equipment_id, player_id) values ($1,$2) returning id, issued_on`, [req.params.id, player]);
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id, issuedOn: String(rows[0].issued_on).slice(0, 10) };
      });
    }),
    // POST /api/passport/consent { playerId, schoolId } — the family names a school
    consent: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.playerId ?? "")) || !UUID.test(String(b.schoolId ?? ""))) throw err("player_and_school_required");
      return asPrincipal(req, async (c) => {
        const { rows } = await c.query(`insert into passport_consent (player_id, to_school_id) values ($1, $2) returning id`, [b.playerId, b.schoolId]);
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id };
      });
    }),
    // POST /api/passport/consent/:id/withdraw
    withdrawConsent: handle(async (req) => asPrincipal(req, async (c) => {
      const { rowCount } = await c.query(`update passport_consent set withdrawn_at = now() where id = $1 and withdrawn_at is null`, [req.params.id]);
      return { withdrawn: rowCount };
    })),
    // POST /api/equipment-issues/:id/return
    giveBack: handle(async (req) => asPrincipal(req, async (c) => {
      const { rowCount } = await c.query(`update equipment_issue set returned_on = sa_today() where id = $1 and returned_on is null`, [req.params.id]);
      return { returned: rowCount };
    })),
  };
}
