/** SCRBRD — a school's drills and kit. Policies do the deciding; see tables.mjs and db/08. */
import { runAsPrincipal } from "../auth/auth-db.mjs";
/** @import { RouteDeps, ApiRequest, ApiResponse, Handler, Db } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs):
// pg's carry a SQLSTATE `code`, this module's own carry an HTTP `status`.

const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (/** @type {unknown} */ v, /** @type {number} */ max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
const CATEGORIES = ["batting", "bowling", "fielding", "keeping", "fitness", "tactical"];
const KINDS = ["bat", "ball", "pads", "gloves", "helmet", "kit", "stumps", "net", "bowling_machine", "other"];

/** @param {RouteDeps} deps @returns {Record<string, Handler>} */
export function kitRoutes({ pool, secret }) {
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.code === "23514") return res.status(422).json({ error: "refused", detail: e.message });
      if (e.code === "23505") return res.status(422).json({ error: "already_granted" });
      if (e.code === "23503") return res.status(404).json({ error: "not_found" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  /** @template T @param {ApiRequest} req @param {(client: Db) => Promise<T>} fn */
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
    // POST /api/passport/consent { playerId, schoolId } — the family names a
    // school, or his union or CSA Schools (db/124: an institution above a
    // school is named the same way, and its named readers open the passport)
    consent: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.playerId ?? "")) || !UUID.test(String(b.schoolId ?? ""))) throw err("player_and_school_required");
      return asPrincipal(req, async (c) => {
        // A school, his union or CSA Schools: never another province's union,
        // and not a club or an academy until Kameel decides on them (db/124
        // §6 Q4). Said in words, and only to somebody who may name a school
        // for him (db/122's writer test): anybody else is refused as before,
        // below, by the same test in the insert policy.
        const { rows: [chk] } = await c.query(
          `select not passport_consent_recipient_ok($1, $2) and passport_consent_writer_ok($1) as refused,
                  institution_is_union($2) as is_union`, [b.playerId, b.schoolId]);
        if (chk?.refused) throw err(chk.is_union ? "not_his_union" : "not_a_school", 422);
        // His family, on a guardian's link, once he is eighteen: the consent
        // is his to give now (db/125 §5 (1), Kameel 30 Oct 2026; READERS
        // Q1), said in words rather than as the insert policy's bare refusal.
        // The boy himself at eighteen passes the writer test and never gets here.
        const { rows: [age] } = await c.query(
          `select not passport_consent_writer_ok($1) and is_family_of($1)
                  and exists (select 1 from player_masked p
                               where p.id = $1 and p.born is not null and majority_on(p.born) <= sa_today())
                  and exists (select 1 from role_assignment a
                               where a.person_id = app_user_id() and a.role = 'guardian' and a.active) as of_age`,
          [b.playerId]);
        if (age?.of_age) throw err("he_is_of_age", 422);
        // A consent lapses when the link that gave it ends (db/122, Kameel 29
        // Oct 2026), but its row stays open, and db/08 allows one open row per
        // boy and school. A lapsed one naming this school is withdrawn first,
        // as the caller (db/08's policy: only his family may), so the boy at
        // eighteen, or his other parent, can give the consent afresh.
        await c.query(`update passport_consent set withdrawn_at = now()
                        where player_id = $1 and to_school_id = $2 and withdrawn_at is null
                          and passport_consent_in_force(id) = false`, [b.playerId, b.schoolId]);
        const { rows } = await c.query(`insert into passport_consent (player_id, to_school_id) values ($1, $2) returning id`, [b.playerId, b.schoolId]);
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id };
      });
    }),
    // POST /api/passport/consent/:id/withdraw
    //
    // Anyone of his family on a live link may take a school's name back, the
    // boy at any age (db/122 §1d). Row security decides; nothing withdrawn is
    // answered 403, not a quiet 200, so the screen can say why: the caller is
    // not his family on a live link, or the name was already taken back.
    withdrawConsent: handle(async (req) => {
      if (!UUID.test(String(req.params?.id ?? ""))) throw err("not_permitted", 403);
      return asPrincipal(req, async (c) => {
        const { rowCount } = await c.query(`update passport_consent set withdrawn_at = now() where id = $1 and withdrawn_at is null`, [req.params.id]);
        if (!rowCount) throw err("not_permitted", 403);
        return { withdrawn: rowCount };
      });
    }),
    // POST /api/equipment-issues/:id/return
    giveBack: handle(async (req) => asPrincipal(req, async (c) => {
      const { rowCount } = await c.query(`update equipment_issue set returned_on = sa_today() where id = $1 and returned_on is null`, [req.params.id]);
      return { returned: rowCount };
    })),
  };
}
