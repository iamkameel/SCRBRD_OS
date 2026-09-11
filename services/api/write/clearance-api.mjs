/**
 * SCRBRD — recording that an adult was checked.
 *
 * Two acts: record a clearance, and revoke one. There is no edit. A verified
 * row is a named person's statement that they saw a document on a date; if
 * it was wrong it is revoked with a reason and a new one recorded, and the
 * register shows both. The table's trigger refuses anything else.
 *
 * WHO MAY: the table's policy, under clearance.manage at the school — the
 * office, the director of sport, the principal. A refused write is an empty
 * result, not a branch here. verified_by and verified_at are stamped by the
 * trigger from the session; the request supplies neither, and a request that
 * tried would be overwritten.
 *
 * WHAT IS NOT RECORDED: the document. The reference number is enough to
 * re-verify, and it is a restricted field on the way back out.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });
const KINDS = ["police_clearance", "child_protection", "first_aid", "driving_permit", "coaching_accreditation"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = (v, code) => {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw err(code);
  return s;
};

export function clearanceRoutes({ pool, secret }) {
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      // 23514 is one of the table's own rules — the vocabulary, the dates, an
      // edit after verification — and its message names which.
      if (e.code === "23514") return res.status(422).json({ error: "invalid_clearance", detail: e.message });
      if (e.code === "23503") return res.status(404).json({ error: "no_such_person" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /api/clearances
    //   { personId, schoolId, kind, reference?, issuedOn, expiresOn, note? }
    record: handle(async (req) => {
      const b = req.body || {};
      if (!UUID.test(String(b.personId ?? ""))) throw err("person_required");
      if (!UUID.test(String(b.schoolId ?? ""))) throw err("school_required");
      if (!KINDS.includes(b.kind)) throw err("kind_invalid");
      const issuedOn = isoDate(b.issuedOn, "issued_on_must_be_yyyy_mm_dd");
      const expiresOn = isoDate(b.expiresOn, "expires_on_must_be_yyyy_mm_dd");
      if (!issuedOn) throw err("issued_on_required");
      // A clearance without a re-check date is not a clearance. Said here as
      // well as by the column so the office gets a name, not a null violation.
      if (!expiresOn) throw err("expires_on_required");
      if (expiresOn <= issuedOn) throw err("expires_on_must_follow_issued_on");
      const reference = b.reference == null || String(b.reference).trim() === "" ? null : String(b.reference).trim();
      if (reference && (reference.length < 3 || reference.length > 60)) throw err("reference_invalid");
      const note = b.note == null || String(b.note).trim() === "" ? null : String(b.note).trim().slice(0, 200);

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `insert into adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on, note)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id, person_id, school_id, kind, reference, issued_on, expires_on, note, verified_by, verified_at`,
          [b.personId, b.schoolId, b.kind, reference, issuedOn, expiresOn, note]);
        if (!rows.length) throw err("not_permitted", 403);
        const c = rows[0];
        return { id: c.id, personId: c.person_id, schoolId: c.school_id, kind: c.kind, reference: c.reference,
                 issuedOn: String(c.issued_on).slice(0, 10), expiresOn: String(c.expires_on).slice(0, 10),
                 note: c.note, verifiedBy: c.verified_by, verifiedAt: c.verified_at };
      });
    }),

    // POST /api/clearances/:id/revoke { reason }
    revoke: handle(async (req) => {
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 3 || reason.length > 200) throw err("reason_required");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rowCount } = await client.query(
          `update adult_clearance set revoked_at = now(), revoked_reason = $2
            where id = $1 and revoked_at is null`, [req.params.id, reason]);
        // No row is "not yours" or "already revoked" and the API must not say
        // which: confirming a clearance id exists for an adult the caller may
        // not read about is the disclosure.
        return { revoked: rowCount };
      });
    }),
  };
}
