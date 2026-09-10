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

/**
 * The platform switch, and the reviews it gates.
 *
 * Both live here rather than in events-api.mjs because neither is a scoring
 * write: the flag belongs to nobody's fixture, and a DRS review is a statement
 * about a decision rather than about a delivery.
 *
 * NOTHING IN THIS FILE ENFORCES THE FLAG. The trigger on drs_review does
 * (db/08_schema_programme.sql). A check here as well would be a second answer
 * to the same question that can drift from the first, and it is the database's
 * answer that a queued offline write and a stale client both eventually meet.
 */
export function featureRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /admin/features/:key { enabled: boolean, reason?: string }
    //
    // Upsert rather than insert: a flag is a switch with a position, not a log
    // of positions. Who last moved it and when are on the row; the history of
    // a switch belongs in access_log with every other administrative act.
    set: handle(async (req) => {
      if (typeof req.body?.enabled !== "boolean") throw err("enabled_must_be_boolean");
      // Turning something OFF needs no explanation; turning it ON does. The
      // asymmetry is deliberate: every flag here is off because somebody
      // decided the feature was not yet trustworthy, and the person overriding
      // that should have to say what changed.
      const reason = req.body?.reason == null ? null : String(req.body.reason).slice(0, 1000);
      if (req.body.enabled === true && !reason?.trim()) throw err("reason_required_to_enable");

      // `params.id` and not `params.key`: the router names the first capture
      // group `id` whatever the pattern matches (server.mjs). Reading a name
      // it never sets yields undefined, and the insert then fails on a NOT
      // NULL rather than on anything to do with the flag.
      const key = req.params?.id;
      if (!key) throw err("feature_key_required");

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const r = await client.query(
          `insert into feature_flag (key, enabled, reason, changed_by, changed_at)
           values ($1, $2, $3, app_user_id(), now())
           on conflict (key) do update
             set enabled = excluded.enabled, reason = excluded.reason,
                 changed_by = excluded.changed_by, changed_at = now()
           returning key, enabled, reason, changed_at`,
          [key, req.body.enabled, reason]);
        // No row and no error means the policy refused it.
        if (!r.rowCount) throw err("not_permitted", 403);
        return r.rows[0];
      });
    }),
  };
}

/**
 * Recording a review.
 *
 * Every field the caller may set is validated here for the same reason the
 * pitch report validates its own: the database's CHECK constraint names a
 * constraint, and an umpire needs to be told which box was wrong.
 *
 * `evidenceSource` is required and has no default anywhere in the stack. A
 * review that does not say how it was known is the one thing this feature must
 * never record — see drs_review in db/08 for why.
 */
export function drsRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
  const oneOf = (v, allowed, field, required = false) => {
    if (v == null || v === "") {
      if (required) throw err(`${field}_required`);
      return null;
    }
    if (!allowed.includes(v)) throw err(`${field}_invalid`);
    return v;
  };

  return {
    // POST /matches/:id/drs { ballSeq, calledBy, onField, outcome, evidenceSource, ... }
    record: async (req, res) => {
      try {
        const b = req.body || {};
        const ballSeq = Number(b.ballSeq);
        if (!Number.isInteger(ballSeq) || ballSeq < 1) throw err("ball_seq_required");

        const v = {
          calledBy: oneOf(b.calledBy, ["batting", "fielding", "umpire"], "called_by", true),
          onField:  oneOf(b.onField, ["out", "not_out"], "on_field", true),
          outcome:  oneOf(b.outcome, ["upheld", "overturned", "umpires_call"], "outcome", true),
          pitching: oneOf(b.pitching, ["in_line", "outside_off", "outside_leg"], "pitching"),
          impact:   oneOf(b.impact, ["in_line", "outside_off"], "impact"),
          wickets:  oneOf(b.wickets, ["hitting", "missing", "umpires_call"], "wickets"),
          shotOffered: b.shotOffered == null ? null : b.shotOffered === true,
          // The one that cannot be omitted.
          evidenceSource: oneOf(b.evidenceSource,
            ["umpire_eye", "video_replay", "ball_tracking"], "evidence_source", true),
          notes: b.notes == null ? null : String(b.notes).slice(0, 2000),
        };

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const r = await client.query(
            `insert into drs_review
               (match_id, school_id, ball_seq, called_by, on_field, outcome,
                pitching, impact, wickets, shot_offered, evidence_source, notes,
                reviewed_by, reviewed_at)
             values ($1, match_school($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                     app_user_id(), now())
             on conflict (match_id, ball_seq) do update
               set called_by = excluded.called_by, on_field = excluded.on_field,
                   outcome = excluded.outcome, pitching = excluded.pitching,
                   impact = excluded.impact, wickets = excluded.wickets,
                   shot_offered = excluded.shot_offered,
                   evidence_source = excluded.evidence_source, notes = excluded.notes,
                   reviewed_by = excluded.reviewed_by, reviewed_at = now()
             returning id, ball_seq, outcome, evidence_source, reviewed_at`,
            [req.params.id, ballSeq, v.calledBy, v.onField, v.outcome, v.pitching,
             v.impact, v.wickets, v.shotOffered, v.evidenceSource, v.notes]);
          if (!r.rowCount) throw err("not_permitted", 403);
          return { matchId: req.params.id, ...r.rows[0] };
        });
        res.json(out);
      } catch (e) {
        // 23514 is either a CHECK or the feature gate. The gate's message names
        // the flag and who can move it, so it is passed through rather than
        // flattened — a scorer told only "invalid" would go looking for a bug
        // in a feature that is working exactly as intended.
        if (e.code === "23514") {
          const gated = /switched off platform-wide/.test(e.message || "");
          return res.status(gated ? 409 : 400)
                    .json({ error: gated ? "feature_disabled" : "invalid_value", detail: e.message });
        }
        // 23503: the (match_id, ball_seq) foreign key found no such delivery.
        if (e.code === "23503") return res.status(404).json({ error: "no_such_delivery" });
        if (e.code === "23502") return res.status(404).json({ error: "no_such_match" });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}

/**
 * Putting a fixture on a public screen.
 *
 * The route does nothing clever. Whether the caller may publish is the INSERT
 * policy's decision (broadcast.publish), and what the overlay then shows is
 * broadcast_state()'s — this only shapes the request.
 */
export function broadcastRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
  return {
    // POST /matches/:id/broadcast { published, nameDisplay?, showOfficials?, strapline? }
    publish: async (req, res) => {
      try {
        const b = req.body || {};
        if (typeof b.published !== "boolean") throw err("published_must_be_boolean");
        const nameDisplay = b.nameDisplay ?? "initials";
        if (!["initials", "full", "none"].includes(nameDisplay)) throw err("name_display_invalid");
        // Naming children in full on a public stream is a decision, so it is
        // made explicitly or not at all. The default is initials and stays
        // initials unless somebody says otherwise in the request.
        const showOfficials = b.showOfficials === false ? false : true;
        const strapline = b.strapline == null ? null : String(b.strapline).slice(0, 200);

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const r = await client.query(
            `insert into match_broadcast
               (match_id, school_id, published, name_display, show_officials, strapline,
                published_by, published_at)
             values ($1, match_school($1), $2, $3, $4, $5, app_user_id(), now())
             on conflict (match_id) do update
               set published = excluded.published, name_display = excluded.name_display,
                   show_officials = excluded.show_officials, strapline = excluded.strapline,
                   published_by = excluded.published_by, published_at = now()
             returning match_id, published, name_display, show_officials, strapline, published_at`,
            [req.params.id, b.published, nameDisplay, showOfficials, strapline]);
          if (!r.rowCount) throw err("not_permitted", 403);
          return r.rows[0];
        });
        res.json(out);
      } catch (e) {
        if (e.code === "23514") return res.status(400).json({ error: "invalid_value", detail: e.message });
        if (e.code === "23502" || e.code === "23503") return res.status(404).json({ error: "no_such_match" });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
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
