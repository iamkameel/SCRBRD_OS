/**
 * SCRBRD — Scoring write path (Step 4, server)
 *
 * Appends ball events to the append-only log. Authorization is the database's
 * job: the ball_event INSERT policy (schema_scoring.sql) already requires
 * capability + token + matching epoch + a live lease. This layer:
 *   - serialises writes per match (locks the session row),
 *   - dedupes on idempotency_key (retries are free),
 *   - allocates the authoritative per-match seq,
 *   - routes stale-epoch events to QUARANTINE instead of merging them,
 *   - refreshes the lease on activity.
 *
 * Mirrors MatchSession.append() from scoring-session.mjs, against SQL.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";

/**
 * @param events array of {epoch, deviceId, scorerId, idempotencyKey, clientSeq, clientTs, innings, payload}
 * @returns { accepted:[{idempotencyKey,seq}], duplicates:[...], quarantined:[...] }
 */
export async function appendEvents(pool, authData, secret, bearer, matchId, events, now = () => new Date()) {
  if (!Array.isArray(events) || events.length === 0) { const e = new Error("no_events"); e.status = 400; throw e; }

  return runAsPrincipal(pool, authData, secret, bearer, async client => {
    // Serialise all writes for this match on the session row.
    const { rows: srows } = await client.query(
      `select epoch, state, holder_user_id, holder_device, lease_until
         from scoring_session where match_id = $1 for update`, [matchId]);
    const s = srows[0];
    const result = { accepted: [], duplicates: [], quarantined: [] };

    for (const ev of events) {
      // 1. idempotency — already stored?
      const { rows: dup } = await client.query(
        `select seq from ball_event where idempotency_key = $1`, [ev.idempotencyKey]);
      if (dup[0]) { result.duplicates.push({ idempotencyKey: ev.idempotencyKey, seq: dup[0].seq }); continue; }

      // 2. token/epoch/lease gate (the DB RLS enforces this too; we check here to
      //    ROUTE mismatches to quarantine rather than get an opaque RLS failure).
      const liveLease = s && s.lease_until && new Date(s.lease_until) > now();
      const authed = s && s.state === "active" && s.epoch === ev.epoch
                     && s.holder_device === ev.deviceId && liveLease;
      if (!authed) {
        await client.query(
          `insert into ball_event_quarantine
             (match_id, school_id, submitted_epoch, current_epoch, scorer_user_id, device_id, idempotency_key, body)
           values ($1, app_school_id(), $2, $3, app_user_id(), $4, $5, $6)
           on conflict (idempotency_key) do nothing`,
          [matchId, ev.epoch, s ? s.epoch : null, ev.deviceId, ev.idempotencyKey, JSON.stringify(ev)]);
        result.quarantined.push({ idempotencyKey: ev.idempotencyKey, reason: s ? "stale_epoch_or_lease" : "no_session" });
        continue;
      }

      // 3. allocate the authoritative seq and insert (RLS WITH CHECK is the final guard)
      const { rows: mx } = await client.query(
        `select coalesce(max(seq), 0) + 1 as next from ball_event where match_id = $1`, [matchId]);
      const seq = mx[0].next;
      const p = ev.payload || {};
      await client.query(
        `insert into ball_event
           (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
            idempotency_key, client_seq, client_ts, kind, ball_type, value, shot, seg, zone,
            striker_id, non_striker_id, bowler_id, dismissal, payload)
         values ($1, app_school_id(), $2, $3, $4, app_user_id(), $5,
                 $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [matchId, seq, ev.epoch, ev.innings || 0, ev.deviceId,
         ev.idempotencyKey, ev.clientSeq, ev.clientTs,
         p.kind || "ball", p.type || null, p.value ?? null, p.shot || null, p.seg ?? null, p.zone ?? null,
         p.strikerId || null, p.nonStrikerId || null, p.bowlerId || null, p.dismissal || null, JSON.stringify(p)]);

      // 4. activity refreshes the lease
      await client.query(
        `update scoring_session set lease_until = now() + interval '90 seconds', updated_at = now()
          where match_id = $1`, [matchId]);

      result.accepted.push({ idempotencyKey: ev.idempotencyKey, seq });
    }
    return result;
  });
}

/** Incremental sync / rebuild: everything after `sinceSeq`. RLS lets the school read. */
export async function readEvents(pool, authData, secret, bearer, matchId, sinceSeq = 0) {
  return runAsPrincipal(pool, authData, secret, bearer, async client => {
    const { rows } = await client.query(
      `select seq, epoch, innings, kind, ball_type, value, shot, seg, zone,
              striker_id, non_striker_id, bowler_id, dismissal, scorer_user_id, device_id, server_ts, payload
         from ball_event
        where match_id = $1 and seq > $2
        order by seq`, [matchId, sinceSeq]);
    return rows;
  });
}

// ── Routes ──
export function eventRoutes({ pool, authData, secret }) {
  return {
    // POST /matches/:id/events  { events: [...] }
    append: async (req, res) => {
      try {
        const out = await appendEvents(pool, authData, secret, req.headers?.authorization, req.params.id, req.body?.events || []);
        res.json(out);
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },
    // GET /matches/:id/events?since=seq
    list: async (req, res) => {
      try {
        const rows = await readEvents(pool, authData, secret, req.headers?.authorization, req.params.id, Number(req.query?.since || 0));
        res.json({ matchId: req.params.id, events: rows });
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },
  };
}
