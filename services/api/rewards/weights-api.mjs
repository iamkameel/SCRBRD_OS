/**
 * SCRBRD — setting a coefficient, and the deliberate absence of reading one.
 *
 * ONE ROUTE, AND IT IS WRITE-ONLY. There is no GET here and no read resource
 * anywhere for these values, because an endpoint that returns a coefficient
 * publishes the algorithm to everyone who can call it — and "everyone who can
 * call it" grows every time somebody is given a platform role. The
 * confirmation deliberately echoes the key and the date and NOT the value: a
 * round trip that hands back what you sent is a read endpoint with extra
 * steps, and it would work for somebody guessing values one at a time.
 *
 * A platform administrator who needs to see the current coefficients has a
 * database. That is not an inconvenience to be smoothed away later; it is the
 * boundary.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

const err = (code, status = 400) => Object.assign(new Error(code), { status });

export function rewardWeightRoutes({ pool, secret }) {
  return {
    // POST /api/admin/reward-weights/:key { value, effectiveFrom?, note? }
    set: async (req, res) => {
      try {
        const b = req.body || {};
        const key = String(req.params?.id ?? "").trim();
        if (key.length < 3) throw err("key_invalid");
        const value = Number(b.value);
        if (!Number.isFinite(value)) throw err("value_invalid");
        // A date, because a coefficient takes effect on a day and a term is
        // awarded on the coefficients that were in force. Defaults to today
        // rather than to "now, retroactively for everything".
        const from = b.effectiveFrom ?? null;
        const note = b.note == null || String(b.note).trim() === ""
          ? null : String(b.note).trim().slice(0, 500);

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const { rows } = await client.query(
            `insert into reward_weight (key, value, effective_from, note)
             values (btrim($1), $2, coalesce($3::date, current_date), $4)
             returning key, effective_from`,
            [key, value, from, note]);
          if (!rows.length) throw err("not_permitted", 403);
          return { key: rows[0].key, effectiveFrom: rows[0].effective_from };
        });
        res.json(out);
      } catch (e) {
        // 23505 is the same key on the same day. Reported as a conflict rather
        // than swallowed: an operator who meant to correct today's value needs
        // to know the first one is already standing, because the correction is
        // a new row tomorrow and not an edit.
        if (e.code === "23505") return res.status(409).json({ error: "already_set_for_that_date" });
        if (e.code === "23514") return res.status(422).json({ error: "invalid_weight", detail: e.message });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}
