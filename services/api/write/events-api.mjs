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
 *   - refreshes the lease on activity (once per request, not once per ball).
 *
 * Every row it writes is stamped with match_school(match_id) rather than a
 * school the session names for itself. The capability check already asks
 * app_can() about the match's own school, so a wrong assertion could not write
 * anything it could not otherwise write — but a scorer assigned at two schools
 * would have stamped their balls with whichever school the token happened to
 * carry, and a ball_event whose school disagrees with its match is invisible to
 * the read policy. Deriving it removes the question.
 *
 * Mirrors MatchSession.append() from scoring-session.mjs, against SQL.
 */
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { toRow } from "@scrbrd/scoring";

/**
 * @param events array of {epoch, deviceId, scorerId, idempotencyKey, clientSeq, clientTs, innings, payload}
 * @returns { accepted:[{idempotencyKey,seq}], duplicates:[...], quarantined:[...] }
 */
export async function appendEvents(pool, secret, bearer, matchId, events) {
  if (!Array.isArray(events) || events.length === 0) { const e = new Error("no_events"); e.status = 400; throw e; }

  return runAsPrincipal(pool, secret, bearer, async client => {
    // Serialise all writes for this match, and refresh the lease if this
    // caller holds the token. Both happen inside scoring_lease_check because
    // scoring_session has no UPDATE policy by design, and Postgres will not
    // lock a row FOR UPDATE that the UPDATE policy does not admit — doing it
    // from here silently returned no rows and quarantined a live scorer's
    // whole over. See db/02_schema_scoring.sql.
    //
    // The epoch is taken from the first event: a batch is one device's queue,
    // so they share an epoch, and anything that does not is caught per-event
    // below and routed to quarantine.
    const { rows: lrows } = await client.query(
      `select * from scoring_lease_check($1, $2, $3)`,
      [matchId, events[0].deviceId, events[0].epoch]);
    const lease = lrows[0] || { found: false, holds: false, epoch: null };
    const result = { accepted: [], duplicates: [], quarantined: [] };

    for (const ev of events) {
      // 1. idempotency — already stored?
      const { rows: dup } = await client.query(
        `select seq from ball_event where idempotency_key = $1`, [ev.idempotencyKey]);
      if (dup[0]) { result.duplicates.push({ idempotencyKey: ev.idempotencyKey, seq: dup[0].seq }); continue; }

      // 2. token/epoch/lease gate (the DB RLS enforces this too; we check here to
      //    ROUTE mismatches to quarantine rather than get an opaque RLS failure).
      const authed = lease.holds && ev.epoch === lease.epoch && ev.deviceId === events[0].deviceId;
      if (!authed) {
        await client.query(
          `insert into ball_event_quarantine
             (match_id, school_id, submitted_epoch, current_epoch, scorer_user_id, device_id, idempotency_key, body)
           values ($1, match_school($1), $2, $3, app_user_id(), $4, $5, $6)
           on conflict (idempotency_key) do nothing`,
          [matchId, ev.epoch, lease.epoch, ev.deviceId, ev.idempotencyKey, JSON.stringify(ev)]);
        result.quarantined.push({
          idempotencyKey: ev.idempotencyKey,
          reason: lease.found ? "stale_epoch_or_lease" : "no_session",
        });
        continue;
      }

      // 3. allocate the authoritative seq and insert (RLS WITH CHECK is the final guard)
      const { rows: mx } = await client.query(
        `select coalesce(max(seq), 0) + 1 as next from ball_event where match_id = $1`, [matchId]);
      const seq = mx[0].next;
      // toRow() from @scrbrd/scoring is the ONLY place the camelCase event
      // shape becomes snake_case columns. This used to be a second mapping
      // written out by hand here, and the two had already drifted — it read
      // p.strikerId where the event says striker, so every dismissal arrived
      // with a null batter. Anything the table has no column for rides in
      // payload, so capturing a new dimension needs no migration.
      const row = toRow(ev.payload || {});
      await client.query(
        `insert into ball_event
           (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
            idempotency_key, client_seq, client_ts, kind, ball_type, value, shot, seg, zone,
            striker_id, non_striker_id, bowler_id, dismissal, payload)
         values ($1, match_school($1), $2, $3, $4, app_user_id(), $5,
                 $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        [matchId, seq, ev.epoch, row.innings ?? ev.innings ?? 0, ev.deviceId,
         ev.idempotencyKey, ev.clientSeq, new Date(ev.clientTs ?? Date.now()),
         row.kind || "ball", row.ball_type ?? null, row.value ?? null,
         row.shot ?? null, row.seg ?? null, row.zone ?? null,
         row.striker_id ?? null, row.non_striker_id ?? null, row.bowler_id ?? null,
         row.dismissal ?? null, JSON.stringify(row.payload ?? {})]);


      result.accepted.push({ idempotencyKey: ev.idempotencyKey, seq });
    }
    return result;
  });
}

/**
 * Incremental sync / rebuild: everything after `sinceSeq`.
 *
 * Returns raw rows. The caller turns them back into events with fromRow() from
 * @scrbrd/scoring — the inverse of the mapping used on the way in, and the
 * reason a log that made the round trip replays to the same scorecard.
 */
export const EVENT_COLUMNS = `
  seq, epoch, innings, kind, ball_type, value, shot, seg, zone,
  striker_id, non_striker_id, bowler_id, dismissal, idempotency_key,
  scorer_user_id, device_id, client_ts, server_ts, payload`;

export async function readEvents(pool, secret, bearer, matchId, sinceSeq = 0) {
  return runAsPrincipal(pool, secret, bearer, async client => {
    const { rows } = await client.query(
      `select ${EVENT_COLUMNS}
         from ball_event
        where match_id = $1 and seq > $2
        order by seq`, [matchId, sinceSeq]);
    return rows;
  });
}

// ── Routes ──
export function eventRoutes({ pool, secret }) {
  return {
    // POST /matches/:id/events  { events: [...] }
    append: async (req, res) => {
      try {
        const out = await appendEvents(pool, secret, req.headers?.authorization, req.params.id, req.body?.events || []);
        res.json(out);
      } catch (e) {
        if (!e.status) console.error("append →", e.code || "", e.message, e.detail || "", e.column || "");
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
    // GET /matches/:id/events?since=seq
    list: async (req, res) => {
      try {
        const rows = await readEvents(pool, secret, req.headers?.authorization, req.params.id, Number(req.query?.since || 0));
        res.json({ matchId: req.params.id, events: rows });
      } catch (e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },
  };
}
