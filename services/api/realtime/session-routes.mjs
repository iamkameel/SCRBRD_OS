/**
 * SCRBRD — Session & handover routes (Step 5)
 *
 * Thin HTTP layer over the token state machine. The state transitions live in
 * the DB (SECURITY DEFINER functions in schema_scoring.sql + session_functions.sql);
 * these handlers run them under the caller's principal and broadcast the new
 * session state so the incoming scorer and every watcher see the transition live.
 *
 * The protocol (claim → arm → claim-handover → verify → active; plus heartbeat
 * and force-release) is specified in SCORING_HANDOVER_SPEC.md and proven in
 * scoring-session.test.mjs. This just exposes it and keeps the hub in sync.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

async function callFn(pool, secret, bearer, sql, params) {
  return runAsPrincipal(pool, secret, bearer, async client => {
    const { rows } = await client.query(sql, params);
    return rows[0] || {};
  });
}

/** After any successful transition, read the fresh session row and broadcast it. */
async function broadcastState(pool, secret, bearer, hub, matchId) {
  const { rows } = await runAsPrincipal(pool, secret, bearer, async client =>
    client.query(`select state, epoch, holder_user_id, holder_device from scoring_session where match_id = $1`, [matchId]));
  const s = rows?.[0];
  if (s) hub.broadcastSession(matchId, { state: s.state, epoch: s.epoch, holder: s.holder_user_id });
}

export function sessionRoutes({ pool, secret, hub }) {
  const withBroadcast = async (matchId, bearer, result) => {
    if (result.ok) await broadcastState(pool, secret, bearer, hub, matchId);
    return result;
  };

  return {
    // POST /matches/:id/session/claim { device }
    claim: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b, `select * from scoring_claim($1,$2)`, [id, req.body.device]);
        res.json(await withBroadcast(id, b, r));
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/heartbeat { device, epoch }
    // Heartbeat is high-frequency and does NOT broadcast (no state change).
    heartbeat: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        // Through scoring_lease_check, not a direct UPDATE: scoring_session
        // has no UPDATE policy by design, so the old statement matched nothing
        // and every heartbeat reported "not_token_holder" while the scorer was
        // holding the token perfectly well.
        const r = await callFn(pool, secret, b,
          `select * from scoring_lease_check($1,$2,$3)`, [id, req.body.device, req.body.epoch]);
        res.json({ ok: !!r.holds, reason: r.holds ? null : (r.found ? "not_token_holder" : "no_session"), epoch: r.epoch });
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/handover/arm { device, pending, ballInFlight, to? }
    armHandover: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b,
          `select * from scoring_arm_handover($1,$2,$3,$4,$5)`,
          [id, req.body.device, req.body.pending ?? 0, !!req.body.ballInFlight, req.body.to || null]);
        res.json(await withBroadcast(id, b, r));
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/handover/claim { device, code }  → VERIFYING
    claimHandover: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b,
          `select * from scoring_claim_handover($1,$2,$3)`, [id, req.body.device, req.body.code]);
        // On success, also return the event log so the incoming device rebuilds state.
        if (r.ok) {
          const evs = await runAsPrincipal(pool, secret, b, async client =>
            client.query(`select seq, epoch, innings, payload from ball_event where match_id = $1 order by seq`, [id]));
          r.events = evs.rows;
          await broadcastState(pool, secret, b, hub, id);
        }
        res.json(r);
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/handover/verify { device, runs, wickets, balls }
    verifyTakeover: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b,
          `select * from scoring_verify_takeover($1,$2,$3,$4,$5)`,
          [id, req.body.device, req.body.runs, req.body.wickets, req.body.balls]);
        res.json(await withBroadcast(id, b, r));
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/force-release
    forceRelease: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b, `select * from scoring_force_release($1)`, [id]);
        res.json(await withBroadcast(id, b, r));
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },
  };
}
