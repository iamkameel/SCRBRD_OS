/**
 * SCRBRD — keeping a child's emergency contacts.
 *
 * Two acts: add a contact at a position, and retire one. There is no edit —
 * a changed number is a new row and the old one retired, so "which number did
 * we have in March" always has an answer. Adding at a position that already
 * has a live contact retires that contact first, in the same transaction;
 * the partial unique index would refuse the insert otherwise, and a family
 * updating a number should not have to know that.
 *
 * WHO MAY: the table's policy, under player.emergency.manage — the guardian
 * for their own child through the person anchor, the office and the director
 * of sport for the school. A refused write is an empty result, not a branch
 * here. school_id and created_by are stamped by the trigger from the child
 * and the session; the request supplies neither.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const RELATIONSHIPS = ["mother", "father", "guardian", "grandparent", "sibling", "family", "other"];
const PHONE = /^\+?[0-9][0-9 ]{6,19}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function contactRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      // 23514 is one of the table's own rules — the vocabulary, the number
      // shape, a reactivated retired row — and its message names which.
      if (e.code === "23514") return res.status(422).json({ error: "invalid_contact", detail: e.message });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_player" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /api/players/:id/emergency-contacts
    //   { priority, name, relationship, phone, phoneAlt?, email?, note? }
    add: handle(async (req) => {
      const b = req.body || {};
      const priority = Number(b.priority);
      if (!Number.isInteger(priority) || priority < 1 || priority > 3) throw err("priority_must_be_1_to_3");
      const name = String(b.name ?? "").trim();
      if (name.length < 2) throw err("name_required");
      if (!RELATIONSHIPS.includes(b.relationship)) throw err("relationship_invalid");
      const phone = String(b.phone ?? "").trim();
      if (!PHONE.test(phone)) throw err("phone_invalid");
      const phoneAlt = b.phoneAlt == null || String(b.phoneAlt).trim() === "" ? null : String(b.phoneAlt).trim();
      if (phoneAlt && !PHONE.test(phoneAlt)) throw err("phone_alt_invalid");
      const email = b.email == null || String(b.email).trim() === "" ? null : String(b.email).trim();
      if (email && !EMAIL.test(email)) throw err("email_invalid");
      const note = b.note == null || String(b.note).trim() === "" ? null : String(b.note).trim().slice(0, 200);

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        // Retire whatever holds this position for this child. Bounded by the
        // same policy as the insert, so it cannot reach a child the caller may
        // not keep contacts for — and a zero row count here is fine: the
        // position was simply free.
        await client.query(
          `update emergency_contact set active = false
            where player_id = $1 and priority = $2 and active`, [req.params.id, priority]);
        const { rows } = await client.query(
          `insert into emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id, player_id, priority, name, relationship, phone, phone_alt, email, note, created_at`,
          [req.params.id, priority, name, b.relationship, phone, phoneAlt, email, note]);
        if (!rows.length) throw err("not_permitted", 403);
        const c = rows[0];
        return { id: c.id, playerId: c.player_id, priority: c.priority, name: c.name,
                 relationship: c.relationship, phone: c.phone, phoneAlt: c.phone_alt,
                 email: c.email, note: c.note, createdAt: c.created_at };
      });
    }),

    // POST /api/emergency-contacts/:id/retire
    retire: handle(async (req) =>
      runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rowCount } = await client.query(
          `update emergency_contact set active = false where id = $1 and active`, [req.params.id]);
        // No row is "not yours" or "already retired" and the API must not say
        // which: telling somebody a contact id exists for a child they may not
        // reach is the disclosure.
        return { retired: rowCount };
      })),
  };
}
