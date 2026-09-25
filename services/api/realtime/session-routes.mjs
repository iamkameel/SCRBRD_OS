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
import { EVENT_COLUMNS } from "../write/events-api.mjs";
/** @import { Pool, IdHandler } from "../api-types.mjs" */
/** @import { MatchHub } from "./realtime.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs).

/**
 * @param {Pool} pool @param {string} secret @param {string | undefined} bearer
 * @param {string} sql @param {unknown[]} params
 * @returns {Promise<any>}  the function's result row, or {}
 */
async function callFn(pool, secret, bearer, sql, params) {
  return runAsPrincipal(pool, secret, bearer, async client => {
    const { rows } = await client.query(sql, params);
    return rows[0] || {};
  });
}

/**
 * After any successful transition, read the fresh session row and broadcast it.
 * @param {Pool} pool @param {string} secret @param {string | undefined} bearer
 * @param {MatchHub} hub @param {string} matchId
 */
async function broadcastState(pool, secret, bearer, hub, matchId) {
  const { rows } = await runAsPrincipal(pool, secret, bearer, async client =>
    client.query(`select state, epoch, holder_user_id, holder_device from scoring_session where match_id = $1`, [matchId]));
  const s = rows?.[0];
  if (s) hub.broadcastSession(matchId, { state: s.state, epoch: s.epoch, holder: s.holder_user_id });
}

/**
 * @param {{ pool: Pool, secret: string, hub: MatchHub }} deps
 * @returns {Record<string, IdHandler>}  every route here is /matches/:id/session/…
 */
export function sessionRoutes({ pool, secret, hub }) {
  /** @param {string} matchId @param {string | undefined} bearer @param {any} result */
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
      } catch (/** @type {any} */ e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/heartbeat { device, epoch }
    // Heartbeat is high-frequency and does NOT broadcast (no state change).
    //
    // It is also how a pad asks, without changing anything, where the token
    // stands (SCRBRD-078): scoring_lease_check extends only a live lease the
    // caller already holds, and otherwise just reports. So the answer carries
    // the session's `state` as well as its epoch: a device whose lease has
    // lapsed takes the token back only while the state is `active` and the
    // epoch is the one it held — never while a handover it armed is pending,
    // where its own claim would be the protocol's cancel.
    heartbeat: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        // Through scoring_lease_check, not a direct UPDATE: scoring_session
        // has no UPDATE policy by design, so the old statement matched nothing
        // and every heartbeat reported "not_token_holder" while the scorer was
        // holding the token perfectly well.
        const r = await callFn(pool, secret, b,
          `select * from scoring_lease_check($1,$2,$3)`, [id, req.body.device, req.body.epoch]);
        // db/33: on a complete match the lease is never extended and the
        // function says so in `state` (its shape cannot grow a reason).
        res.json({ ok: !!r.holds, epoch: r.epoch ?? null,
                   state: r.state === "match_complete" ? null : (r.state ?? null),
                   reason: r.holds ? null
                         : r.state === "match_complete" ? "match_complete"
                         : (r.found ? "not_token_holder" : "no_session") });
      } catch (/** @type {any} */ e) {
        // scoring_lease_check raises insufficient_privilege for a caller who
        // may not score this match: an answer, like the claim's no_capability,
        // not a server error.
        if (e.code === "42501") { res.json({ ok: false, epoch: null, state: null, reason: "no_capability" }); return; }
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },

    // POST /matches/:id/session/handover/arm { device, pending, ballInFlight, to? }
    armHandover: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b,
          `select * from scoring_arm_handover($1,$2,$3,$4,$5)`,
          [id, req.body.device, req.body.pending ?? 0, !!req.body.ballInFlight, req.body.to || null]);
        res.json(await withBroadcast(id, b, r));
      } catch (/** @type {any} */ e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/handover/claim { device, code }  → VERIFYING
    claimHandover: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b,
          `select * from scoring_claim_handover($1,$2,$3)`, [id, req.body.device, req.body.code]);
        // On success, also return the event log so the incoming device rebuilds state.
        if (r.ok) {
          // The SAME columns the sync path returns, not a shorter list. The
          // incoming device rebuilds the innings from this and then states the
          // score back for verification — hand it four columns and fromRow()
          // produces events with no kind, no runs and no batter, so its replay
          // says 0/0 and the handover fails verification every time.
          const evs = await runAsPrincipal(pool, secret, b, async client =>
            client.query(`select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [id]));
          r.events = evs.rows;
          await broadcastState(pool, secret, b, hub, id);
        }
        res.json(r);
      } catch (/** @type {any} */ e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/handover/verify { device, runs, wickets, balls }
    verifyTakeover: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b,
          `select * from scoring_verify_takeover($1,$2,$3,$4,$5)`,
          [id, req.body.device, req.body.runs, req.body.wickets, req.body.balls]);
        res.json(await withBroadcast(id, b, r));
      } catch (/** @type {any} */ e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },

    // POST /matches/:id/session/force-release
    forceRelease: async (req, res) => {
      const { id } = req.params, b = req.headers?.authorization;
      try {
        const r = await callFn(pool, secret, b, `select * from scoring_force_release($1)`, [id]);
        res.json(await withBroadcast(id, b, r));
      } catch (/** @type {any} */ e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },
  };
}
