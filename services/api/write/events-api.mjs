/**
 * SCRBRD — Scoring write path (Step 4, server)
 *
 * Appends ball events to the append-only log. Authorization is the database's
 * job: the ball_event INSERT policy (schema_scoring.sql) already requires
 * capability + token + matching epoch + a live lease. This layer:
 *   - serialises writes per match (locks the session row),
 *   - dedupes on idempotency_key (retries are free) — and refuses a DIFFERENT
 *     event under a key already used (db/36, the commit fingerprint),
 *   - judges every live event against the Laws before it is written
 *     (lawsRefusal() in packages/scoring, over the fold of the log so far),
 *   - refuses, per event, a value the table cannot hold (SCRBRD-077),
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
import { toRow, fromRow, normaliseDismissal, MatchFold, lawsRefusal, REFUSAL, REFUSAL_TEXT,
         PLACEMENT_SOURCE, PLACEMENT_NULL, CAPTURE_PROFILE } from "@scrbrd/scoring";
/** @import { Pool, ApiRequest, ApiResponse, Handler, IdHandler, IdRequest, RouteDeps, DressedError } from "../api-types.mjs" */
// A caught error is `any` to the checker (CaughtError in api-types.mjs): pg's
// carry a SQLSTATE `code` (and `table`, `constraint`, `detail`), this
// module's own carry an HTTP `status`.

/**
 * A reason that has words in REFUSAL_TEXT (packages/scoring/src/laws.mjs):
 * every Law, the idempotency conflict, and each value the record cannot hold.
 * Typing a refusal this way makes the checker prove it can be put in words.
 * @typedef {keyof typeof REFUSAL_TEXT} RefusalCode
 */

/**
 * The columns an event is stored with, as ONE object, keyed by column name.
 *
 * The insert reads its values out of this object (through
 * jsonb_populate_record, so Postgres coerces them exactly once, one way) and
 * the idempotency check fingerprints this same object. If the two were built
 * separately, a retry of an honest ball could fingerprint differently from the
 * row it matches — a numeric rounded on one side and not the other — and be
 * refused as a conflict. One object, so it cannot.
 *
 * toRow() from @scrbrd/scoring is the ONLY place the camelCase event shape
 * becomes snake_case columns. This used to be a second mapping written out by
 * hand here, and the two had already drifted — it read p.strikerId where the
 * event says striker, so every dismissal arrived with a null batter. Anything
 * the table has no column for rides in payload, so capturing a new dimension
 * needs no migration.
 *
 * Every column toRow() maps is listed here AND in the insert below. `contact`
 * and `trajectory` were not (SCRBRD-071): toRow() took them out of the payload
 * and nothing put them in a column, so they were dropped. Listing them does not
 * move the fingerprint (db/36) of any row stored before: those were stored with
 * both NULL, the pad's ball() sends both as null unless a scorer captured them
 * (it has never offered to), and NULLs are stripped before hashing — so a retry
 * of an old ball still reads as a duplicate.
 *
 * @param {string} matchId
 * @param {IncomingEvent} ev  the envelope {innings, payload, ...}
 * @returns {Record<string, any>}
 */
function columnsFor(matchId, ev) {
  const row = toRow(ev.payload || {});
  return {
    match_id: matchId,
    innings: row.innings ?? ev.innings ?? 0,
    kind: row.kind || "ball",
    ball_type: row.ball_type ?? null, value: row.value ?? null,
    shot: row.shot ?? null, contact: row.contact ?? null, trajectory: row.trajectory ?? null,
    seg: row.seg ?? null, zone: row.zone ?? null,
    striker_id: row.striker_id ?? null, non_striker_id: row.non_striker_id ?? null,
    bowler_id: row.bowler_id ?? null, dismissed_id: row.dismissed_id ?? null,
    dismissal: row.dismissal ?? null, payload: row.payload ?? {},
    theta: row.theta ?? null, radius: row.radius ?? null,
    placement_source: row.placement_source ?? null, placement_null: row.placement_null ?? null,
    close_position: row.close_position ?? null, capture_profile: row.capture_profile ?? null,
  };
}

/**
 * The placement vocabularies packages/scoring owns, checked at the door
 * (SCRBRD-077). Read from placement.mjs, never listed here: db/07's CHECKs
 * say the same, and the walk (tools/smoke-laws.mjs) fails if the two differ.
 * @type {[column: string, allowed: string[], reason: RefusalCode][]}
 */
const PLACEMENT_VOCABULARY = [
  ["placement_source", Object.values(PLACEMENT_SOURCE), "placement_invalid"],
  ["placement_null", Object.values(PLACEMENT_NULL), "placement_invalid"],
  ["capture_profile", Object.values(CAPTURE_PROFILE), "capture_profile_unknown"],
];

/**
 * Why this event's columns cannot be stored, by packages/scoring's own
 * vocabularies, or null.
 * @param {Record<string, any>} cols  columnsFor()
 * @returns {{reason: RefusalCode, field: string, value: any} | null}
 */
function vocabularyRefusal(cols) {
  for (const [field, allowed, reason] of PLACEMENT_VOCABULARY) {
    const value = cols[field];
    if (value != null && !allowed.includes(value)) return { reason, field, value };
  }
  return null;
}

/**
 * The database's own answer, as a reason a person can read: the CHECK a row
 * broke is named by its constraint, and the refusal by what the scorer
 * recorded. Each reason has its words in REFUSAL_TEXT (packages/scoring/src/laws.mjs).
 * Keyed by a constraint's name as pg reports it, so any string may index it.
 * @type {Record<string, RefusalCode>}
 */
const CHECK_REASON = {
  ball_event_contact: "contact_unknown",
  ball_event_trajectory: "trajectory_unknown",
  ball_event_trajectory_needs_contact: "trajectory_without_contact",
  ball_event_placement_source: "placement_invalid",
  ball_event_placement_null: "placement_invalid",
  ball_event_theta_range: "placement_invalid",
  ball_event_radius_range: "placement_invalid",
  ball_event_point_is_complete: "placement_invalid",
  ball_event_zone_check: "placement_invalid",
  ball_event_capture_profile: "capture_profile_unknown",
};

/**
 * A write the database refused because of a VALUE in the event — a column
 * CHECK on ball_event (23514), or a value that is not the column's type or
 * does not fit it (SQLSTATE class 22) — as a per-event refusal. Anything else
 * (a policy, a missing function, a lost connection) is not the event's fault
 * and returns null, so the caller rethrows it.
 * @param {any} e  a pg error
 * @returns {{reason: RefusalCode, constraint?: string} | null}
 */
function valueRefusal(e) {
  if (e?.code === "23514" && e.table === "ball_event") {
    return { reason: CHECK_REASON[e.constraint] ?? "value_refused", constraint: e.constraint };
  }
  if (typeof e?.code === "string" && e.code.startsWith("22")) return { reason: "value_refused" };
  return null;
}

/** The fingerprint of an event that has not been stored: db/36's function over the row it would be. */
const FINGERPRINT_OF = `ball_event_fingerprint(jsonb_populate_record(null::ball_event, $2::jsonb))`;

/**
 * One event of a POST /matches/:id/events batch: the outbox's envelope
 * (OutboxEvent in packages/sync) around a scoring event whose shape
 * @scrbrd/scoring owns.
 *
 * What a batch is expected to hold, not what has been checked: the route hands
 * the body over as it arrived. appendEvents() checks that the batch is a
 * non-empty array, the dismissal on a wicket and the placement vocabularies;
 * every other field is the database's to judge — a column's type or CHECK
 * refuses the one event, the INSERT policies refuse what the token does not
 * hold.
 * @typedef {object} IncomingEvent
 * @property {number} epoch            the token epoch the device believes it holds
 * @property {string} deviceId
 * @property {string} idempotencyKey   the event's identity (newEventId)
 * @property {number} clientSeq
 * @property {number} [clientTs]       ms since the epoch, on the device
 * @property {number} [innings]        the outbox's own field; the event carries its innings in `payload`
 * @property {string} [scorerId]       carried, not trusted: a row's scorer is app_user_id()
 * @property {Record<string, any>} [payload]  the event itself (a LogEvent), read field by field as toRow() reads it
 */

/**
 * appendEvents()'s answer: every event in the batch in exactly one bucket,
 * named by its idempotency key.
 * @typedef {object} AppendResult
 * @property {{idempotencyKey: string, seq: number}[]} accepted     written now, at `seq`
 * @property {{idempotencyKey: string, seq: number}[]} duplicates   the same event, already written at `seq`
 * @property {{idempotencyKey: string, reason: "match_complete" | "stale_epoch_or_lease" | "no_session"}[]} quarantined  held for a person
 * @property {{idempotencyKey: string, seq: number | null, reason: "idempotency_conflict"}[]} conflicts
 *   the key names another event: `seq` is the stored one's, null when that one is held
 * @property {{idempotencyKey: string, reason: RefusalCode, field?: string, value?: any, constraint?: string}[]} refused
 *   the Laws, or the record, refused it
 */

/**
 * scoring_lease_check()'s row (db/33): whether the match has a session,
 * whether this caller holds its live lease on this device at this epoch, and
 * the session's epoch and state — 'match_complete' once the match is over.
 * @typedef {object} LeaseCheck
 * @property {boolean} found
 * @property {boolean} holds
 * @property {number | null} epoch
 * @property {string | null} [state]
 */

/**
 * @param {Pool} pool
 * @param {string} secret
 * @param {string | undefined} bearer  the Authorization header, as sent
 * @param {string} matchId
 * @param {IncomingEvent[]} events  the batch: one device's queue, in order
 * @returns {Promise<AppendResult>}
 *
 * Every event in the batch lands in exactly one bucket. `conflicts` and
 * `refused` are the two where NOTHING was written: the server has no copy,
 * so the device must keep its own and show it to a person (packages/sync
 * holds them durably, apart from the outbox, for exactly that).
 */
export async function appendEvents(pool, secret, bearer, matchId, events) {
  if (!Array.isArray(events) || events.length === 0) { const e = /** @type {DressedError} */ (new Error("no_events")); e.status = 400; throw e; }

  // THE VOCABULARY IS CLOSED AT THIS DOOR. A wicket names how the batter was
  // out from packages/scoring's DISMISSAL, or it is not recorded: the bowler's
  // figures and the free-hit rule both read that value, and a spelling
  // nothing recognises used to credit the bowler with a wicket that was
  // never his. Checked over the whole batch before the transaction opens, so
  // a refusal is a 400 naming the value and nothing was written.
  for (const ev of events) {
    const p = ev.payload || {};
    if ((p.kind ?? "ball") !== "ball" || p.type !== "W") continue;
    const d = normaliseDismissal(p.dismissal);
    if (!d) {
      const e = /** @type {DressedError} */ (new Error("dismissal_unknown")); e.status = 400;
      e.detail = { field: "dismissal", value: p.dismissal ?? null, idempotencyKey: ev.idempotencyKey };
      throw e;
    }
    p.dismissal = d;
  }

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
    /** @type {LeaseCheck} */
    const lease = lrows[0] || { found: false, holds: false, epoch: null };
    /** @type {AppendResult} */
    const result = { accepted: [], duplicates: [], quarantined: [], conflicts: [], refused: [] };

    // The match as the Laws read it, folded ONCE, on the first event that
    // needs judging, and extended as each event is accepted — so the fifth
    // ball of a batch is judged against the four before it, not against the
    // log as it stood when the request arrived. Safe to hold across the
    // batch because scoring_lease_check above holds the per-match lock.
    /** @type {MatchFold|null} */
    let fold = null;
    const loadFold = async () => {
      /** @type {{ rows: BallEventRow[] }} */
      const { rows } = await client.query(
        `select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [matchId]);
      return new MatchFold(rows.map(fromRow));
    };

    /**
     * Steps 1–4 for one event: everything that touches the database. Run by the
     * loop below inside a savepoint, so a value the table refuses refuses this
     * event and not the batch.
     * @param {IncomingEvent} ev  @param {Record<string, any>} cols  columnsFor(ev)
     */
    const writeOne = async (ev, cols) => {
      const colsJson = JSON.stringify(cols);

      // 1. idempotency — is this key already stored, and is it THIS event?
      //    A key is one event's identity (newEventId). The same key with the
      //    same content is a retry and costs nothing. The same key with other
      //    content is two events claiming one identity: it is refused and
      //    reported, because answering "duplicate" would tell the device its
      //    ball was recorded when the server kept a different one.
      const { rows: dup } = await client.query(
        `select seq, fingerprint = ${FINGERPRINT_OF} as same from ball_event where idempotency_key = $1`,
        [ev.idempotencyKey, colsJson]);
      if (dup[0]) {
        if (dup[0].same) result.duplicates.push({ idempotencyKey: ev.idempotencyKey, seq: dup[0].seq });
        else result.conflicts.push({ idempotencyKey: ev.idempotencyKey, seq: dup[0].seq, reason: "idempotency_conflict" });
        return;
      }
      // ...and the same question of a key already HELD. A NULL fingerprint
      // is a row quarantined before db/36, which cannot be fingerprinted in
      // SQL (see there): it is answered as the write path always answered it.
      const { rows: held } = await client.query(
        `select fingerprint is null or fingerprint = ${FINGERPRINT_OF} as same
           from ball_event_quarantine where idempotency_key = $1`,
        [ev.idempotencyKey, colsJson]);
      if (held[0] && !held[0].same) {
        result.conflicts.push({ idempotencyKey: ev.idempotencyKey, seq: null, reason: "idempotency_conflict" });
        return;
      }
      // The SAME event, held under a stale token and re-sent now, goes on
      // like any other: if this device holds the token it is judged and
      // written live below, exactly as a new ball would be, and writing it
      // closes the held copy as 'superseded' in the same statement (db/37's
      // trigger) — so nobody is later asked to release a ball already in the
      // log. Answering "duplicate" instead would tell the device its ball was
      // recorded while the log still lacked it, and every ball after it would
      // be judged against a log one short.

      // 2. token/epoch/lease gate (the DB RLS enforces this too; we check here to
      //    ROUTE mismatches to quarantine rather than get an opaque RLS failure).
      const authed = lease.holds && ev.epoch === lease.epoch && ev.deviceId === events[0].deviceId;
      if (!authed) {
        await client.query(
          `insert into ball_event_quarantine
             (match_id, school_id, submitted_epoch, current_epoch, scorer_user_id, device_id, idempotency_key, body, fingerprint)
           values ($1, match_school($1), $2, $3, app_user_id(), $4, $5, $6,
                   ball_event_fingerprint(jsonb_populate_record(null::ball_event, $7::jsonb)))
           on conflict (idempotency_key) do nothing`,
          [matchId, ev.epoch, lease.epoch, ev.deviceId, ev.idempotencyKey, JSON.stringify(ev), colsJson]);
        result.quarantined.push({
          idempotencyKey: ev.idempotencyKey,
          // db/33: a ball sent at a complete match is held for a person to
          // decide, and says why — not mistaken for a stale token.
          reason: lease.state === "match_complete" ? "match_complete"
                : lease.found ? "stale_epoch_or_lease" : "no_session",
        });
        return;
      }

      // 3. The Laws. Judged on the event exactly as it will be stored and read
      //    back (fromRow of these columns), so the fold that judges it and the
      //    fold that later replays it see the same thing.
      //
      //    A refusal is PER EVENT, in `refused`, and the rest of the batch is
      //    still judged — not a 4xx for the whole request. A batch is one
      //    phone's offline queue, sent in order and resent until it settles.
      //    A 4xx would leave every event pending, so the phone would send the
      //    same batch, be refused the same way, and never sync again: one
      //    illegal ball at 11:05 would wedge the whole afternoon behind it,
      //    and a handover (which needs an empty outbox) would become
      //    impossible. Per event, the illegal one is named and handed back —
      //    the device holds it for a person (packages/sync) — and the legal
      //    ones after it are judged on their own against the log without it.
      //    Nothing is dropped: every event lands in exactly one bucket.
      if (!fold) fold = await loadFold();
      const candidate = fromRow({ ...cols, idempotency_key: ev.idempotencyKey });
      const why = lawsRefusal(fold.view(), candidate);
      if (why) { result.refused.push({ idempotencyKey: ev.idempotencyKey, reason: why }); return; }

      // 4. allocate the authoritative seq and insert (RLS WITH CHECK is the final guard)
      const { rows: mx } = await client.query(
        `select coalesce(max(seq), 0) + 1 as next from ball_event where match_id = $1`, [matchId]);
      const seq = mx[0].next;
      await client.query(
        `insert into ball_event
           (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
            idempotency_key, client_seq, client_ts, kind, ball_type, value, shot, contact, trajectory,
            seg, zone, striker_id, non_striker_id, bowler_id, dismissed_id, dismissal, payload,
            theta, radius, placement_source, placement_null, close_position, capture_profile)
         select $1, match_school($1), $2, $3, r.innings, app_user_id(), $4,
                $5, $6, $7, r.kind, r.ball_type, r.value, r.shot, r.contact, r.trajectory, r.seg, r.zone,
                r.striker_id, r.non_striker_id, r.bowler_id, r.dismissed_id, r.dismissal, r.payload,
                r.theta, r.radius, r.placement_source, r.placement_null, r.close_position, r.capture_profile
           from jsonb_populate_record(null::ball_event, $8::jsonb) r`,
        [matchId, seq, ev.epoch, ev.deviceId,
         ev.idempotencyKey, ev.clientSeq, new Date(ev.clientTs ?? Date.now()), colsJson]);

      fold.push({ ...candidate, seq });
      result.accepted.push({ idempotencyKey: ev.idempotencyKey, seq });
    };

    for (const ev of events) {
      const cols = columnsFor(matchId, ev);

      // 0. A VALUE THE RECORD CANNOT HOLD REFUSES THIS EVENT, NOT THE BATCH
      //    (SCRBRD-077). A contact, trajectory or placement outside a column
      //    CHECK used to make the INSERT throw: the whole batch was a 500, and
      //    the device resent it forever — the wedge step 3 exists to prevent.
      //    Two checks, neither holding a copy of a vocabulary:
      //
      //    - At the door, before the database is touched, the placement
      //      vocabularies packages/scoring owns (placement.mjs:
      //      PLACEMENT_SOURCE, PLACEMENT_NULL, CAPTURE_PROFILE), read from
      //      there. A refused value is refused whether or not the device
      //      holds the token: holding it would only move the failure to the
      //      day somebody tried to release it.
      //    - Everything else the table constrains — contact and trajectory,
      //      whose only vocabulary is db/07's CHECK, theta and radius ranges,
      //      a zone, a malformed number — is judged by those CHECKs
      //      themselves: steps 1-4 run in a savepoint, and a CHECK violation
      //      or malformed value (SQLSTATE 23514, class 22) rolls back that
      //      one event and names it. Anything else still fails the request.
      //      An event routed to quarantine meets them only when released
      //      (quarantineRoutes answers value_refused then, not a 500).
      const bad = vocabularyRefusal(cols);
      if (bad) { result.refused.push({ idempotencyKey: ev.idempotencyKey, ...bad }); continue; }
      await client.query("savepoint event_write");
      try {
        await writeOne(ev, cols);
        await client.query("release savepoint event_write");
      } catch (e) {
        const why = valueRefusal(e);
        if (!why) throw e;
        await client.query("rollback to savepoint event_write");
        result.refused.push({ idempotencyKey: ev.idempotencyKey, ...why });
      }
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
  seq, epoch, innings, kind, ball_type, value, shot, contact, trajectory, seg, zone,
  striker_id, non_striker_id, bowler_id, dismissed_id, dismissal, idempotency_key,
  scorer_user_id, device_id, client_ts, server_ts, payload,
  theta, radius, placement_source, placement_null, close_position, capture_profile,
  recovered`;   // a ball released from quarantine says so on the way out

/**
 * A ball_event row as EVENT_COLUMNS reads it, through pg's default parsers:
 * smallint and integer arrive as numbers, numeric (radius) as a string,
 * timestamptz as a Date, jsonb parsed. fromRow() turns it into an event.
 * @typedef {object} BallEventRow
 * @property {number} seq
 * @property {number} epoch
 * @property {number} innings
 * @property {string} kind
 * @property {string | null} ball_type
 * @property {number | null} value
 * @property {string | null} shot
 * @property {string | null} contact
 * @property {string | null} trajectory
 * @property {number | null} seg
 * @property {string | null} zone
 * @property {string | null} striker_id
 * @property {string | null} non_striker_id
 * @property {string | null} bowler_id
 * @property {string | null} dismissed_id
 * @property {string | null} dismissal
 * @property {string} idempotency_key
 * @property {string} scorer_user_id
 * @property {string} device_id
 * @property {Date} client_ts
 * @property {Date} server_ts
 * @property {Record<string, any>} payload
 * @property {number | null} theta
 * @property {string | null} radius
 * @property {string | null} placement_source
 * @property {string | null} placement_null
 * @property {string | null} close_position
 * @property {string | null} capture_profile
 * @property {boolean} recovered
 */

/**
 * The log after `sinceSeq` (see above: raw rows, for fromRow()).
 * @param {Pool} pool
 * @param {string} secret
 * @param {string | undefined} bearer  the Authorization header, as sent
 * @param {string} matchId
 * @param {number} [sinceSeq]
 * @returns {Promise<BallEventRow[]>}  in seq order
 */
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
/** @param {RouteDeps} deps @returns {Record<string, IdHandler>}  both are /matches/:id/events */
export function eventRoutes({ pool, secret }) {
  return {
    // POST /matches/:id/events  { events: [...] }
    append: async (req, res) => {
      try {
        const out = await appendEvents(pool, secret, req.headers?.authorization, req.params.id, req.body?.events || []);
        res.json(out);
      } catch (/** @type {any} */ e) {
        if (!e.status) console.error("append →", e.code || "", e.message, e.detail || "", e.column || "");
        res.status(e.status || 500).json({ error: e.code || e.message });
      }
    },
    // GET /matches/:id/events?since=seq
    list: async (req, res) => {
      try {
        const rows = await readEvents(pool, secret, req.headers?.authorization, req.params.id, Number(req.query?.since || 0));
        res.json({ matchId: req.params.id, events: rows });
      } catch (/** @type {any} */ e) { res.status(e.status || 500).json({ error: e.code || e.message }); }
    },
  };
}


/**
 * Amending a completed match.
 *
 * Both handlers do what every write path here does: as little as possible. The
 * INSERT policy on scoring_amendment decides who may ask, and
 * scoring_amendment_decide() checks the approver's authority — and that they
 * are not the requester — before it appends anything. A check in JavaScript
 * would be a second opinion that can drift from the one that runs.
 *
 * AN APPROVED AMENDMENT MEETS THE LAWS (SCRBRD-076), in the release route's
 * order: scoring_amendment_decide() inside a SAVEPOINT decides WHO, and takes
 * the live path's per-match lock before it appends (db/38); the log up to the
 * void is folded and the void judged as it was stored; a refusal rolls the
 * savepoint back — no void, the request still pending — and says why in
 * words. See amendmentRefusal() for which Laws those are.
 */

/**
 * The Laws an amendment's void is judged by: lawsRefusal(), less the one rule
 * that is about live undo and not about the log.
 *
 * An amendment is a correction to a match — usually a COMPLETED one — filed by
 * one person and approved by another (scoring.amend.request, then
 * scoring.amend.approve, never the same person: db/02, db/24). Its void names
 * an OLDER delivery; that is the whole point of it. lawsRefusal() refuses any
 * void but the latest event that still counts (`void_not_latest`), because on
 * the pad an undo is last-in, first-out and anything older "needs an
 * amendment" — its own words. Applied here that rule would refuse every
 * amendment there is. So it is the one refusal an amendment is exempt from;
 * lawsRefusal() itself is not bent, and the live path still enforces it.
 *
 * Every other void rule stands: the target must be an event of this match, in
 * the innings the void is filed under, not a void, not already undone, and not
 * an `innings_start` — voiding the start of an innings leaves its balls with no
 * batting side, squad or overs, and an amendment can only void, never write the
 * replacement, so that is never a correction. In practice the SQL function
 * answers all but the last first, with its own reason (no_such_live_delivery);
 * `void_foundation` is the one the Laws add.
 *
 * This leans on voidRefusal() (packages/scoring/src/laws.mjs) asking the LIFO
 * question LAST — every other void rule is checked before `void_not_latest` is
 * returned, so an exemption from it cannot excuse anything else. The walk
 * (tools/smoke-amend.mjs) approves a non-latest void and refuses an
 * innings_start one, and fails if that order ever changes.
 *
 * What an amendment does to the events AFTER its target — a wicket voided under
 * the batter who came in for it — is not re-judged: the fold replays them as it
 * always has. Deciding that a correction must also re-judge the balls bowled
 * since would be a product decision, not a Law.
 *
 * @param {import("@scrbrd/scoring").MatchView} match  the fold of the log before the void
 * @param {import("@scrbrd/scoring").LogEvent} voidEv  the void, as stored
 * @returns {import("@scrbrd/scoring").Refusal | null}
 */
function amendmentRefusal(match, voidEv) {
  const why = lawsRefusal(match, voidEv);
  return why === REFUSAL.VOID_NOT_LATEST ? null : why;
}

/**
 * scoring_amendment_decide()'s row (db/38). `void_key` is the void it wrote,
 * on an approval that succeeded.
 * @typedef {object} AmendmentDecision
 * @property {boolean} ok
 * @property {string | null} reason
 * @property {string | null} [void_key]
 */

/** @param {RouteDeps} deps @returns {Record<string, IdHandler>}  /matches/:id/amendments, /amendments/:id/decide */
export function amendmentRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
  /** @param {(req: IdRequest) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  return {
    // POST /matches/:id/amendments { targetKey, reason }
    request: handle(async (req) => {
      const targetKey = (req.body?.targetKey || "").trim();
      const reason = (req.body?.reason || "").trim();
      if (!targetKey) throw err("target_required");
      if (!reason) throw err("reason_required");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        // school_id comes from the MATCH, not the payload: the policy anchors
        // on it, and a request that names its own tenant is one that can be
        // filed against the wrong school.
        const { rows } = await client.query(
          `insert into scoring_amendment (match_id, school_id, target_key, reason, requested_by)
           select $1, m.school_id, $2, $3, app_user_id()
             from match m where m.id = $1
           returning id, state`,
          [req.params.id, targetKey, reason]);
        if (!rows.length) throw err("not_permitted", 403);
        return { id: rows[0].id, state: rows[0].state };
      });
    }),
    // POST /amendments/:id/decide { approve, note? }
    //   → { ok: true, void_key } | { ok: false, reason }
    //   | { ok: false, reason: "laws_refused", law, text }   (nothing written; still pending)
    decide: handle(async (req) => {
      const approve = req.body?.approve === true;
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        await client.query("savepoint amendment_decide");
        const { rows } = await client.query(
          `select * from scoring_amendment_decide($1, $2, $3)`,
          [req.params.id, approve, req.body?.note ?? null]);
        /** @type {AmendmentDecision} */
        const out = rows[0] ?? { ok: false, reason: "no_result" };
        if (!approve || !out.ok) { await client.query("release savepoint amendment_decide"); return out; }

        // Written, under the per-match lock (db/38). Now the Laws, over the
        // log the void landed on.
        /** @type {{ rows: BallEventRow[] }} */
        const { rows: log } = await client.query(
          `select ${EVENT_COLUMNS} from ball_event
            where match_id = (select match_id from ball_event where idempotency_key = $1)
              and seq <= (select seq from ball_event where idempotency_key = $1)
            order by seq`, [out.void_key]);
        const written = log.find((r) => r.idempotency_key === out.void_key);
        const why = written
          ? amendmentRefusal(new MatchFold(log.filter((r) => r.seq < written.seq).map(fromRow)).view(), fromRow(written))
          // The approver cannot read the log they would be amending. Nothing
          // can be judged, so nothing is written.
          : "log_unreadable";
        if (why) {
          await client.query("rollback to savepoint amendment_decide");
          return why === "log_unreadable"
            ? { ok: false, reason: "not_permitted" }
            : { ok: false, reason: "laws_refused", law: why, text: REFUSAL_TEXT[why] ?? why };
        }
        await client.query("release savepoint amendment_decide");
        return out;
      });
    }),
  };
}


/**
 * quarantine_resolve()'s row (db/37). `seq` is where an accepted ball was
 * written.
 * @typedef {object} QuarantineResolution
 * @property {boolean} ok
 * @property {string | null} reason
 * @property {number | null} [seq]
 */

/**
 * The way out of quarantine. See db/14_quarantine_release.sql and
 * db/37_quarantine_loose_ends.sql.
 *
 * Listing is the table's own read policy (scoring.correct over the match).
 * Resolving goes through quarantine_resolve(), which checks its own authority
 * — scoring.amend.approve, and not the submitting scorer. The columns an
 * accepted ball is written with are produced HERE by toRow(), the same mapper
 * the live path uses, so a released delivery and a live one can never be two
 * different readings of the same event.
 *
 * A RELEASED BALL MEETS THE LAWS, the same function as a live one
 * (SCRBRD-071). It used to be written with no judgement at all: a held ball
 * from a bowler bowling his second over running, or one delivered after the
 * match was decided, went straight into the log on an approver's click. SQL
 * cannot run lawsRefusal(), so the order is:
 *
 *   1. quarantine_resolve() inside a SAVEPOINT. It decides WHO may release —
 *      a caller it refuses learns nothing about the match from a Laws verdict
 *      — and takes the live path's per-match lock, held to our commit, before
 *      it writes the ball at the next seq.
 *   2. The log up to that seq is folded (MatchFold, the live path's fold) and
 *      lawsRefusal() is asked about the row exactly as it was stored.
 *   3. Refused: ROLLBACK TO the savepoint. Nothing was written, the held row
 *      is still open, and the answer says why in words. The person deciding
 *      then has two honest choices, both theirs to make: discard it, or leave
 *      it held until the log changes (a bowler named, a batter in) and try
 *      again. Neither is taken for them.
 * @param {RouteDeps} deps @returns {Record<string, IdHandler>}  /matches/:id/quarantine, /quarantine/:id/resolve
 */
export function quarantineRoutes({ pool, secret }) {
  /** @param {(req: IdRequest) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };
  return {
    // GET /matches/:id/quarantine  — unresolved first, oldest first
    list: handle(async (req) => runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
      const { rows } = await client.query(
        `select q.id, q.match_id, q.submitted_epoch, q.current_epoch, q.scorer_user_id, u.name as scorer_name,
                q.device_id, q.idempotency_key, q.body, q.quarantined_at, q.resolved_at, q.resolution
           from ball_event_quarantine q
           left join app_user u on u.id = q.scorer_user_id
          where q.match_id = $1
          order by (q.resolved_at is not null), q.quarantined_at, q.id`, [req.params.id]);
      return { rows };
    })),
    // POST /quarantine/:id/resolve { accept, note? }
    //   → { ok: true, seq } | { ok: false, reason }
    //   | { ok: false, reason: "laws_refused", law, text }   (nothing written; still held)
    resolve: handle(async (req) => {
      const accept = req.body?.accept === true;
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        // The row is read under RLS first: a caller who may not see it may not
        // resolve it, and the function then applies the stricter rule.
        const { rows: q } = await client.query(
          `select match_id, body from ball_event_quarantine where id = $1`, [req.params.id]);
        if (!q.length) { const e = /** @type {DressedError} */ (new Error("no_such_quarantine")); e.status = 404; throw e; }
        let row = null;
        if (accept) {
          const payload = q[0].body?.payload || {};
          if ((payload.kind ?? "ball") === "ball" && payload.type === "W") {
            const d = normaliseDismissal(payload.dismissal);
            if (!d) { const e = /** @type {DressedError} */ (new Error("dismissal_unknown")); e.status = 400; e.detail = { value: payload.dismissal ?? null }; throw e; }
            payload.dismissal = d;
          }
          row = { ...toRow(payload), innings: q[0].body?.innings };
        }
        await client.query("savepoint quarantine_release");
        let rows;
        try {
          ({ rows } = await client.query(
            `select * from quarantine_resolve($1, $2, $3, $4)`,
            [req.params.id, accept, row ? JSON.stringify(row) : null, req.body?.note ?? null]));
        } catch (e) {
          // A held ball carrying a value the table cannot hold (SCRBRD-077).
          // The live path refuses one when it writes it; a ball held under a
          // stale token is held before any column CHECK runs, so the first
          // CHECK it meets is this INSERT. Nothing written, still held, and
          // the reason in words — not a 500.
          const bad = valueRefusal(e);
          if (!bad) throw e;
          await client.query("rollback to savepoint quarantine_release");
          return { ok: false, reason: "value_refused", value: bad.reason, text: REFUSAL_TEXT[bad.reason] ?? bad.reason };
        }
        /** @type {QuarantineResolution} */
        const out = rows[0] ?? { ok: false, reason: "no_result" };
        if (!accept || !out.ok) { await client.query("release savepoint quarantine_release"); return out; }

        // Written, under the lock. Now the Laws, over the log it landed on.
        /** @type {{ rows: BallEventRow[] }} */
        const { rows: log } = await client.query(
          `select ${EVENT_COLUMNS} from ball_event where match_id = $1 and seq <= $2 order by seq`,
          [q[0].match_id, out.seq]);
        const released = log.find((r) => r.seq === out.seq);
        // `out.seq` is a number wherever `released` was found: it equals that
        // row's seq, a NOT NULL integer. (quarantine_resolve() answers an
        // accepted release with the seq it wrote; its only ok row without
        // one is a rejection, returned above.)
        const why = released
          ? lawsRefusal(new MatchFold(log.filter((r) => r.seq < /** @type {number} */ (out.seq)).map(fromRow)).view(), fromRow(released))
          // The approver cannot read the log they would be adding to. Nothing
          // can be judged, so nothing is written.
          : "log_unreadable";
        if (why) {
          await client.query("rollback to savepoint quarantine_release");
          return why === "log_unreadable"
            ? { ok: false, reason: "not_permitted" }
            : { ok: false, reason: "laws_refused", law: why, text: REFUSAL_TEXT[why] ?? why };
        }
        await client.query("release savepoint quarantine_release");
        return out;
      });
    }),
  };
}


/**
 * Naming the side, which is where the safeguarding checks actually live.
 *
 * `match_squad` carries two BEFORE triggers — age eligibility and registration
 * — and until this route existed NOTHING IN THE PRODUCT EVER WROTE THAT TABLE.
 * The scorer's setup wizard kept the XI in React state and put it into an
 * `innings_start` event, so a coach could pick a fifteen-year-old for a U13
 * fixture, or a child with no verified guardian and no consent, and the app
 * would score it happily. The rules were correct, tested, and bypassed.
 *
 * REPLACING A SQUAD IS NOT A DELETE. No table in this schema has a DELETE
 * policy for any role, and this one is not the exception: the previous
 * selection is withdrawn and the new one written, inside one transaction, so a
 * squad that is refused half-way leaves the old side intact rather than a side
 * of six.
 *
 * The trigger's own message is returned verbatim. It names the boy and the
 * reason — "is 14 on 1 January and cannot play U13A: the limit is 13" — and a
 * coach who is told only "invalid" has to guess which of eleven names is the
 * problem.
 * @param {RouteDeps} deps @returns {Record<string, IdHandler>}  /matches/:id/squad
 */
export function squadRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
  return {
    // POST /matches/:id/squad { side, players: [{ playerId, battingNo?, twelfth? }] }
    select: async (req, res) => {
      try {
        const side = req.body?.side;
        const players = req.body?.players;
        if (side !== "home" && side !== "away") throw err("side_must_be_home_or_away");
        if (!Array.isArray(players) || !players.length) throw err("players_required");
        const ids = players.map((p) => p?.playerId);
        if (ids.some((id) => !id)) throw err("player_id_required");
        if (new Set(ids).size !== ids.length) throw err("duplicate_player");

        // The batting order. Checked here as well as in the database because
        // the constraint violation names a column and an index; a coach needs
        // to be told which position is doubled up, before anything is written.
        const orders = [];
        for (const p of players) {
          if (p?.battingNo == null) continue;          // a reserve, or not placed yet
          const n = Number(p.battingNo);
          if (!Number.isInteger(n) || n < 1 || n > 11) throw err("batting_no_must_be_1_to_11");
          orders.push(n);
        }
        if (new Set(orders).size !== orders.length) throw err("duplicate_batting_no");
        // A twelfth man does not bat. Naming one at number six is a mis-tick
        // rather than a plan, and it is cheaper to refuse than to explain later
        // why the scorecard has twelve names in the order.
        if (players.some((p) => p?.twelfth === true && p?.battingNo != null)) {
          throw err("twelfth_man_has_no_batting_no");
        }

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          // Withdraw the side as it stands. UPDATE rather than DELETE, and the
          // triggers let a withdrawal through unconditionally — a player who
          // became ineligible AFTER selection has to be removable, or the check
          // that should have stopped him getting in now refuses to let him out.
          await client.query(
            `update match_squad set withdrawn = true
              where match_id = $1 and side = $2 and not withdrawn`,
            [req.params.id, side]);

          let written = 0;
          for (const p of players) {
            const r = await client.query(
              `insert into match_squad
                 (match_id, player_id, side, batting_no, twelfth, withdrawn, selected_by, selected_at)
               values ($1, $2, $3, $4, $5, false, app_user_id(), now())
               on conflict (match_id, player_id) do update
                 set side = excluded.side, batting_no = excluded.batting_no,
                     twelfth = excluded.twelfth, withdrawn = false,
                     selected_by = excluded.selected_by, selected_at = excluded.selected_at
               returning player_id`,
              [req.params.id, p.playerId, side,
               p.battingNo == null ? null : Number(p.battingNo), p.twelfth === true]);
            // An INSERT's command tag always carries a count; pg's type allows
            // null only for commands that have none.
            written += /** @type {number} */ (r.rowCount);
          }
          // Zero rows with no error means the policy refused every insert.
          // Reported as a refusal rather than a success with nothing in it.
          if (written === 0) throw err("not_permitted", 403);
          return { matchId: req.params.id, side, selected: written };
        });
        res.json(out);
      } catch (/** @type {any} */ e) {
        // 23514 is one of the two triggers. Its message names the player and
        // says why, which is the only useful thing to put in front of a coach.
        if (e.code === "23514") return res.status(400).json({ error: "not_eligible", detail: e.message });
        // 23505 on the batting-order index: two boys at the same position. The
        // check above catches this for a single request; this catches the race
        // between two coaches naming the same side at once.
        if (e.code === "23505") return res.status(409).json({ error: "duplicate_batting_no" });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}


/**
 * The toss.
 *
 * Third instance of the same disease as the squad: `match` has carried
 * toss_won_by and toss_decision since the first migration, the scorer's setup
 * wizard collects both on step 3, and nothing ever wrote them. The toss went
 * into React state, decided the innings order for that one browser session,
 * and was gone. A second scorer opening the same match got no toss at all;
 * two devices could disagree about who was batting and neither was wrong,
 * because there was nothing to be wrong against.
 *
 * `wonBy` is 'home' or 'away' — a side in this fixture, not a school's name.
 * That is what makes the innings order derivable (bats_first() in SQL) rather
 * than something the client works out and everyone downstream trusts.
 *
 * Correcting a mistyped toss before the first ball is just an edit. After the
 * first ball the database refuses it, because reversing the innings order
 * under a scorecard people have already read is not an edit — it goes through
 * scoring_amendment, where it needs a second person.
 * @param {RouteDeps} deps @returns {Record<string, IdHandler>}  /matches/:id/toss
 */
export function tossRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
  return {
    // POST /matches/:id/toss { wonBy: 'home'|'away', decision: 'bat'|'bowl' }
    record: async (req, res) => {
      try {
        const wonBy = req.body?.wonBy;
        const decision = req.body?.decision;
        // Named sides, not school names. A fixture's away team is free text,
        // so a name could never be checked against who is actually playing.
        if (wonBy !== "home" && wonBy !== "away") throw err("won_by_must_be_home_or_away");
        if (decision !== "bat" && decision !== "bowl") throw err("decision_must_be_bat_or_bowl");

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          // school_id is derived via match_school(), never taken from the
          // caller — same rule as ball_event. A row whose school disagrees
          // with its match is invisible to the read policy.
          const r = await client.query(
            `insert into match_toss (match_id, school_id, won_by, decision, called_by, called_at)
             values ($1, match_school($1), $2, $3, app_user_id(), now())
             on conflict (match_id) do update
               set won_by = excluded.won_by, decision = excluded.decision,
                   called_by = excluded.called_by, called_at = excluded.called_at
             returning won_by, decision,
                       bats_first(won_by, decision) as bats_first, called_at`,
            [req.params.id, wonBy, decision]);
          // No row and no error means the policy refused it.
          if (!r.rowCount) throw err("not_permitted", 403);
          const t = r.rows[0];
          return {
            matchId: req.params.id, wonBy: t.won_by, decision: t.decision,
            // The whole reason for the change: the server says who bats,
            // rather than each client deciding for itself.
            batsFirst: t.bats_first, calledAt: t.called_at,
          };
        });
        res.json(out);
      } catch (/** @type {any} */ e) {
        // 23514 is the freeze trigger — play has started. Its message says so
        // and names the amendment route, which is the only way through.
        if (e.code === "23514") return res.status(409).json({ error: "toss_locked", detail: e.message });
        // 23502 = school_id came back NULL, i.e. match_school() found nothing:
        // the match does not exist, or not for this principal.
        // 23502: a derived school_id came back NULL. 23503: the match_id foreign
      // key found nothing. Both mean the same thing to a caller — that match is
      // not there, or not theirs.
      if (e.code === "23502" || e.code === "23503") return res.status(404).json({ error: "no_such_match" });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}


/**
 * Appointing the officials.
 *
 * The sixth instance of the pattern this branch keeps closing, and the
 * emptiest: `officiating.assign` has been in the capability table since the
 * first migration and three roles hold it, but no table existed to assign
 * anything in, so the capability could never once be exercised. The scorecard
 * showed a scorer's name read from a mock-only field.
 *
 * REPLACING THE PANEL IS NOT A DELETE, for the same reason naming a squad is
 * not: no table here has a DELETE policy for any role. The standing panel is
 * withdrawn and the new one written inside one transaction, so an appointment
 * sheet that is refused half way leaves the previous officials in place rather
 * than a match with nobody standing.
 */
/**
 * Saying whether a boy can play on Saturday.
 *
 * The route validates the vocabulary and derives the school; everything about
 * WHO may answer for WHOM is the INSERT policy's decision, evaluated against
 * the caller's own assignments. A guardian reaches their child through the
 * person anchor and nobody else's child at all.
 *
 * declared_by is app_user_id() and is never taken from the request. A coach
 * recording what a boy told them at practice is recording it in their own
 * name — "unavailable, said so himself" and "unavailable, according to the
 * coach" are different degrees of certainty, and letting the caller name
 * somebody else would erase the difference.
 * @param {RouteDeps} deps @returns {Record<string, IdHandler>}  /matches/:id/availability
 */
export function availabilityRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
  const STATUS = ["available", "unavailable", "doubtful"];
  const KINDS = ["illness", "family", "academic", "travel", "religious", "other_sport", "other"];

  return {
    // POST /matches/:id/availability { playerId, status, reasonKind?, note? }
    declare: async (req, res) => {
      try {
        const b = req.body || {};
        if (!b.playerId) throw err("player_required");
        if (!STATUS.includes(b.status)) throw err("status_invalid");
        const kind = b.reasonKind == null || b.reasonKind === "" ? null : String(b.reasonKind);
        if (kind && !KINDS.includes(kind)) throw err("reason_kind_invalid");
        const note = b.note == null || String(b.note).trim() === ""
          ? null : String(b.note).trim().slice(0, 280);

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          const r = await client.query(
            `insert into match_availability
               (match_id, player_id, school_id, status, reason_kind, note, declared_by, declared_at)
             values ($1, $2, match_school($1), $3, $4, $5, app_user_id(), now())
             on conflict (match_id, player_id) do update
               set status = excluded.status, reason_kind = excluded.reason_kind,
                   note = excluded.note, declared_by = excluded.declared_by,
                   declared_at = now()
             returning match_id, player_id, status, reason_kind, declared_at`,
            [req.params.id, b.playerId, b.status, kind, note]);
          if (!r.rowCount) throw err("not_permitted", 403);
          return r.rows[0];
        });
        res.json(out);
      } catch (/** @type {any} */ e) {
        // 23514 is the belongs-to-this-school trigger almost every time, and
        // its message says which question was actually asked.
        if (e.code === "23514") return res.status(422).json({ error: "wrong_school", detail: e.message });
        if (e.code === "23502" || e.code === "23503") return res.status(404).json({ error: "no_such_match_or_player" });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}

/**
 * Buses, trips, and the driver's two marks.
 *
 * Three routes for three different kinds of act, and they are deliberately not
 * one. Adding a vehicle is fleet administration; arranging a trip is fixture
 * logistics; saying the bus has left is a report from the road. The first two
 * are ordinary policy-governed writes. The third goes through trip_mark(),
 * because transport.drive is a capability to REPORT on a trip and not to
 * change one — a driver who could update the row could re-time the departure
 * or swap the vehicle.
 * @param {RouteDeps} deps
 * @returns {Record<string, Handler>}  POST /vehicles has no :id; the trip routes do
 */
export function transportRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
  // YYYY-MM-DD or nothing. A cover date typed as "March next year" is refused
  // rather than stored as null, because null means "not recorded" and a
  // coordinator who typed a date would read "unknown" as the system losing it.
  const isoDate = (/** @type {unknown} */ v) => {
    if (v == null || v === "") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw err("date_must_be_yyyy_mm_dd");
    return String(v);
  };
  /** @param {(req: ApiRequest) => Promise<unknown>} fn @returns {Handler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      // 23514 is one of the safety checks on the trip — a bus that seats
      // fourteen carrying fifteen, or another school's vehicle. The message
      // names the vehicle and the numbers, so it is passed through.
      if (e.code === "23514") return res.status(422).json({ error: "invalid_trip", detail: e.message });
      if (e.code === "23505") return res.status(409).json({ error: "vehicle_already_on_this_fixture" });
      if (e.code === "23502" || e.code === "23503") return res.status(404).json({ error: "no_such_match_or_vehicle" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  return {
    // POST /vehicles { schoolId, registration, description, kind, capacity, ... }
    vehicle: handle(async (req) => {
      const b = req.body || {};
      if (!b.schoolId) throw err("school_required");
      if (!b.registration || !String(b.registration).trim()) throw err("registration_required");
      if (!b.description || !String(b.description).trim()) throw err("description_required");
      const cap = Number(b.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 80) throw err("capacity_invalid");
      const kind = b.kind ?? "minibus";
      if (!["bus", "minibus", "van", "car"].includes(kind)) throw err("kind_invalid");
      const cond = b.condition == null || b.condition === "" ? null : String(b.condition);
      if (cond && !["excellent", "good", "fair", "poor", "off_road"].includes(cond)) {
        throw err("condition_invalid");
      }
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const r = await client.query(
          `insert into vehicle (school_id, registration, description, kind, capacity,
                                condition, next_service_on, active, notes,
                                insurance_expires_on, roadworthy_expires_on)
           values ($1, btrim($2), btrim($3), $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (school_id, upper(btrim(registration))) do update
             set description = excluded.description, kind = excluded.kind,
                 capacity = excluded.capacity, condition = excluded.condition,
                 next_service_on = excluded.next_service_on,
                 active = excluded.active, notes = excluded.notes,
                 insurance_expires_on = excluded.insurance_expires_on,
                 roadworthy_expires_on = excluded.roadworthy_expires_on
           returning id, registration, description, kind, capacity, condition,
                     next_service_on, active, insurance_expires_on, roadworthy_expires_on`,
          [b.schoolId, String(b.registration), String(b.description), kind, cap, cond,
           b.nextServiceOn || null, b.active === false ? false : true,
           b.notes == null ? null : String(b.notes).slice(0, 500),
           // The two dates a minibus of children turns on. Optional: a school
           // that has not recorded them is shown "unknown", not refused.
           isoDate(b.insuranceExpiresOn), isoDate(b.roadworthyExpiresOn)]);
        if (!r.rowCount) throw err("not_permitted", 403);
        return r.rows[0];
      });
    }),

    // POST /matches/:id/trip { vehicleId?, driverId?, departAt?, returnAt?, pickup?, seatsTaken? }
    //
    // school_id comes from the MATCH via match_school(), never from the
    // request, exactly as the toss and the pitch report do.
    trip: handle(async (req) => {
      const b = req.body || {};
      const seats = b.seatsTaken == null || b.seatsTaken === "" ? null : Number(b.seatsTaken);
      if (seats != null && (!Number.isInteger(seats) || seats < 0)) throw err("seats_invalid");

      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const r = await client.query(
          `insert into trip (match_id, school_id, vehicle_id, driver_id, depart_at,
                             return_at, pickup, seats_taken, notes, arranged_by, arranged_at)
           values ($1, match_school($1), $2, $3, $4, $5, $6, $7, $8, app_user_id(), now())
           returning id, match_id, vehicle_id, driver_id, depart_at, return_at,
                     pickup, seats_taken, arranged_at`,
          [req.params.id, b.vehicleId || null, b.driverId || null,
           b.departAt || null, b.returnAt || null,
           b.pickup == null ? null : String(b.pickup).slice(0, 200),
           seats, b.notes == null ? null : String(b.notes).slice(0, 500)]);
        if (!r.rowCount) throw err("not_permitted", 403);
        return r.rows[0];
      });
    }),

    // POST /trips/:id/mark { event: "departed" | "arrived" }
    mark: handle(async (req) => {
      const event = req.body?.event;
      if (!["departed", "arrived"].includes(event)) throw err("event_invalid");
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(`select * from trip_mark($1, $2)`,
                                            [req.params.id, event]);
        /** @type {{ ok: boolean, reason: string | null }}  trip_mark()'s row (db/41) */
        const r = rows[0] ?? { ok: false, reason: "no_result" };
        // The function's own reason, not a flattened refusal: "already
        // departed" and "not this driver" send a person to different places.
        if (r.ok === false) throw err(r.reason || "refused", r.reason === "no_such_trip" ? 404 : 403);
        return { tripId: req.params.id, event };
      });
    }),
  };
}

/**
 * Appointing the officials: the comment that says why is the one headed so,
 * above availabilityRoutes().
 * @param {RouteDeps} deps @returns {Record<string, IdHandler>}  /matches/:id/officials
 */
export function officialRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });
  const DUTIES = ["umpire", "third_umpire", "scorer", "referee"];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    // POST /matches/:id/officials
    //   { officials: [{ duty, name?, officialId?, personId?, panel? }] }
    //
    // `officialId` names somebody on the register (db/08) and is what turns an
    // appointment from a typed name into a checkable one. It stays OPTIONAL,
    // and that is not laziness: a fixture on Saturday morning that needs an
    // umpire gets one, and a school standing a parent up at short notice must
    // not be blocked because that parent is on nobody's panel.
    appoint: async (req, res) => {
      try {
        const officials = req.body?.officials;
        if (!Array.isArray(officials) || !officials.length) throw err("officials_required");

        for (const o of officials) {
          if (!DUTIES.includes(o?.duty)) throw err("duty_must_be_umpire_third_umpire_scorer_or_referee");
          if (o?.officialId != null && !UUID.test(String(o.officialId))) throw err("official_id_invalid");
          // The name is required even when an account is named, because it is
          // what every reader sees: the read never joins app_user, and a blank
          // name on a scorecard is worse than a refusal here. See the table.
          // The ONE exception is an appointment that names the register, where
          // the name is filled in from it below rather than retyped — retyping
          // it is how two spellings of one umpire got into the data.
          const named = typeof o?.name === "string" && o.name.trim();
          if (!named && o?.officialId == null) throw err("name_required");
        }
        // The same person twice on one duty is a mis-tick. The database has
        // partial unique indexes for this; catching it here names which one,
        // before anything is written.
        const seen = new Set();
        for (const o of officials) {
          const key = `${o.duty}:${(o.officialId || o.personId || o.name.trim().toLowerCase())}`;
          if (seen.has(key)) throw err("duplicate_official");
          seen.add(key);
        }

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          // A LINKED DUTY RE-SUBMITTED IS KEPT, NOT RE-MADE (SCRBRD-034).
          // A sheet replaces the panel by withdrawing it and writing the new
          // one, and withdrawing a duty the office has linked to an assignment
          // revokes that assignment (db/34). So re-saving the sheet to add a
          // second umpire would silently end the scorer's authority — and the
          // re-made row would be unlinked. A linked appointment whose duty and
          // account are on the new sheet is therefore left standing as it
          // was, link and all; everything else is replaced exactly as before.
          const { rows: linked } = await client.query(
            `select id, duty, person_id from match_official
              where match_id = $1 and not withdrawn and assignment_id is not null`,
            [req.params.id]);
          const keep = new Map();
          for (const o of officials) {
            const hit = o.personId && linked.find((l) => l.duty === o.duty && l.person_id === o.personId && ![...keep.values()].includes(l.id));
            if (hit) keep.set(o, hit.id);
          }
          await client.query(
            `update match_official set withdrawn = true
              where match_id = $1 and not withdrawn and not (id = any($2::uuid[]))`,
            [req.params.id, [...keep.values()]]);

          let written = 0;
          const standing = [];
          for (const o of officials) {
            if (keep.has(o)) continue;
            let name = typeof o.name === "string" ? o.name.trim() : "";
            let panel = o.panel == null ? null : String(o.panel).slice(0, 200);

            if (o.officialId != null) {
              // Read the register under the caller's own identity — the read
              // policy is "anybody signed in", so this needs no widening, and
              // going through official_masked rather than the table means a
              // school appointing somebody still does not learn their date of
              // birth as a side effect of appointing them.
              const { rows } = await client.query(
                `select o.id, o.full_name, o.panel, o.active,
                        official_level(o.id) as level,
                        (select count(*)::int from official_accreditation a
                          where a.official_id = o.id) as accreditations,
                        o.person_id is not null as linked,
                        (o.person_id is not null and exists (
                           select 1 from role_assignment ra
                            where ra.person_id = o.person_id and ra.active
                              and ra.school_id = match_school($2)
                              and (ra.valid_until is null or ra.valid_until > current_date)
                         )) as conflict
                   from official_masked o
                  where o.id = $1`,
                [o.officialId, req.params.id]);
              const reg = rows[0];
              if (!reg) throw err("no_such_official", 404);
              // Standing DOWN is a decision somebody made about this person.
              // Appointing them anyway would make it meaningless, and unlike a
              // lapsed grade there is no Saturday-morning argument for it.
              if (!reg.active) throw err("official_not_active", 422);

              if (!name) name = reg.full_name;
              if (panel == null) panel = reg.panel;

              standing.push({
                officialId: reg.id,
                name: reg.full_name,
                level: reg.level,
                // Lapsed and never-accredited are both a null grade and only
                // one of them means "go and renew it".
                lapsed: reg.level == null && Number(reg.accreditations) > 0,
                accredited: reg.level != null,
                // An official with no account here cannot be checked against
                // the school's own people at all, and `null` says so. Matching
                // on the name instead would be the fuzzy merge this codebase
                // refuses everywhere else.
                conflict: reg.linked ? reg.conflict === true : null,
              });
            }

            const r = await client.query(
              `insert into match_official
                 (match_id, school_id, duty, person_name, person_id, official_id, panel, appointed_by, appointed_at)
               values ($1, match_school($1), $2, $3, $4, $5, $6, app_user_id(), now())
               returning id`,
              [req.params.id, o.duty, name, o.personId ?? null, o.officialId ?? null, panel]);
            // An INSERT's command tag always carries a count; pg's type allows
            // null only for commands that have none.
            written += /** @type {number} */ (r.rowCount);
          }
          // Zero rows and no error means the policy refused every insert. A
          // sheet that only re-submitted linked duties wrote nothing either,
          // so it is asked the same question the policy would have asked.
          if (written === 0 && keep.size === 0) throw err("not_permitted", 403);
          if (written === 0) {
            const { rows: [can] } = await client.query(
              `select app_can('officiating.assign', match_school($1), match_team($1),
                              '00000000-0000-0000-0000-000000000000'::uuid, $1) as ok`,
              [req.params.id]);
            if (!can?.ok) throw err("not_permitted", 403);
          }
          // The appointment is made EITHER WAY, and what was wrong with it
          // comes back with it. Refusing a lapsed accreditation outright would
          // block a fixture that has to be played; saying nothing would make
          // the register decorative. So it is recorded, and named, at the one
          // moment somebody is in a position to do something about it.
          return { matchId: req.params.id, appointed: written, kept: keep.size, standing };
        });
        res.json(out);
      } catch (/** @type {any} */ e) {
        if (e.code === "23505") return res.status(409).json({ error: "duplicate_official" });
        // 23502: match_school() came back NULL. 23503: the match_id foreign key
        // found nothing. Both mean that match is not there, or not theirs.
        if (e.code === "23502" || e.code === "23503") return res.status(404).json({ error: "no_such_match" });
        const status = e.code === "42501" ? 403 : (e.status || 500);
        res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
      }
    },
  };
}


/**
 * Conditions: the weather, and the state of the square.
 *
 * Both tables existed with a read query and no way to write them — the fourth
 * and fifth instances of the pattern this branch keeps closing. The scorer's
 * setup wizard showed a weather step that went nowhere.
 *
 * They are separate routes under one factory because they are separate facts
 * with separate authors. Weather is fixture administration (fixture.update) —
 * whoever is deciding whether Saturday goes ahead. The pitch report is the
 * groundsman's (facility.manage) — the person who prepared the square is the
 * one who can describe it. The database enforces both; this layer only maps
 * refusals onto something a human can read.
 *
 * Neither freezes after the first ball, unlike the toss. Conditions CHANGE
 * during a match — that is the whole point of recording them — and a scorer
 * who cannot write "rain arrived at 3pm" because play has started has been
 * given a worse tool than a notebook.
 * @param {RouteDeps} deps
 * @returns {Record<string, IdHandler>}  /matches/:id/weather, /matches/:id/pitch, /grounds/:id/condition
 */
export function conditionsRoutes({ pool, secret }) {
  const err = (/** @type {string} */ code, status = 400) => Object.assign(new Error(code), { status });

  // Shared shape for both handlers: derive school from the match, upsert on
  // match_id, report a policy refusal as a refusal rather than a silent no-op.
  /**
   * @template V  the fields build() validated out of the body
   * @param {IdRequest} req
   * @param {ApiResponse} res
   * @param {object} spec
   * @param {string} spec.sql                       $1 is the route's :id
   * @param {(values: V) => unknown[]} spec.params  $2 onwards, in order
   * @param {(req: IdRequest) => V} spec.build      throws err() on a bad field
   */
  const upsert = async (req, res, { sql, params, build }) => {
    try {
      const values = build(req);
      const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const r = await client.query(sql, [req.params.id, ...params(values)]);
        if (!r.rowCount) throw err("not_permitted", 403);
        return { matchId: req.params.id, ...r.rows[0] };
      });
      res.json(out);
    } catch (/** @type {any} */ e) {
      if (e.code === "23514") return res.status(400).json({ error: "invalid_value", detail: e.message });
      // school_id came back NULL: match_school() found nothing, so the match
      // does not exist or is not visible to this principal.
      if (e.code === "23502") return res.status(404).json({ error: "no_such_match" });
      const status = e.code === "42501" ? 403 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : (e.message || "error") });
    }
  };

  // Whole numbers only, within a range, or null. The database checks these too;
  // doing it here means the message names the field rather than the constraint.
  /** @param {unknown} v  a body field as sent @param {number} lo @param {number} hi @param {string} field */
  const num = (v, lo, hi, field) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw err(`${field}_out_of_range`);
    return n;
  };
  /**
   * @param {any} v  a body field as sent; returned only once it is on the list
   * @param {readonly string[]} allowed
   * @param {string} field
   */
  const oneOf = (v, allowed, field) => {
    if (v == null || v === "") return null;
    if (!allowed.includes(v)) throw err(`${field}_invalid`);
    return v;
  };
  const bool = (/** @type {unknown} */ v) => (v == null ? null : v === true);
  // A calendar date, or nothing. Rejected rather than coerced: `new Date()` of
  // a typo yields Invalid Date, which Postgres refuses with a message about a
  // type rather than about the field the groundsman got wrong.
  /** @param {any} v  a body field as sent; returned only once it reads as a date @param {string} field */
  const date = (v, field) => {
    if (v == null || v === "") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw err(`${field}_must_be_yyyy_mm_dd`);
    if (Number.isNaN(Date.parse(v))) throw err(`${field}_invalid`);
    return v;
  };

  return {
    // POST /matches/:id/weather
    weather: (req, res) => upsert(req, res, {
      // No school_id column here, unlike ball_event and the pitch report:
      // match_weather's policy derives the school with a subquery on the match,
      // so there is nothing to denormalise. It does mean a write against a
      // match that does not exist fails the foreign key rather than a NOT NULL,
      // which is why the error map below covers both.
      sql: `insert into match_weather
              (match_id, condition, temp_c, humidity_pct, wind_kph,
               wind_dir, uv_index, rain_chance_pct, forecast, playable, observed_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
            on conflict (match_id) do update
              set condition = excluded.condition, temp_c = excluded.temp_c,
                  humidity_pct = excluded.humidity_pct, wind_kph = excluded.wind_kph,
                  wind_dir = excluded.wind_dir, uv_index = excluded.uv_index,
                  rain_chance_pct = excluded.rain_chance_pct, forecast = excluded.forecast,
                  playable = excluded.playable, observed_at = now()
            returning condition, temp_c, humidity_pct, wind_kph, wind_dir,
                      uv_index, rain_chance_pct, forecast, playable, observed_at`,
      build: (r) => {
        const b = r.body || {};
        // `condition` is the one required field: a weather row that does not
        // say what the weather is has recorded nothing.
        if (!b.condition || typeof b.condition !== "string") throw err("condition_required");
        return {
          condition: b.condition.slice(0, 120),
          tempC: num(b.tempC, -20, 60, "temp_c"),
          humidity: num(b.humidityPct, 0, 100, "humidity_pct"),
          wind: num(b.windKph, 0, 200, "wind_kph"),
          windDir: b.windDir == null ? null : String(b.windDir).slice(0, 8),
          uv: num(b.uvIndex, 0, 15, "uv_index"),
          rain: num(b.rainChancePct, 0, 100, "rain_chance_pct"),
          forecast: b.forecast == null ? null : String(b.forecast).slice(0, 500),
          // Defaults to playable. "Nobody said otherwise" and "somebody
          // inspected it and called it off" are different, but the false case
          // is the one that must be stated deliberately.
          playable: b.playable === false ? false : true,
        };
      },
      params: (v) => [v.condition, v.tempC, v.humidity, v.wind, v.windDir,
                      v.uv, v.rain, v.forecast, v.playable],
    }),

    // POST /matches/:id/pitch
    pitch: (req, res) => upsert(req, res, {
      sql: `insert into match_pitch_report
              (match_id, school_id, surface, grass, bounce, pace, favours,
               covers_on, notes, bounce_rating, pace_rating, outfield,
               reported_by, reported_at)
            values ($1, match_school($1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                    app_user_id(), now())
            on conflict (match_id) do update
              set surface = excluded.surface, grass = excluded.grass,
                  bounce = excluded.bounce, pace = excluded.pace,
                  favours = excluded.favours, covers_on = excluded.covers_on,
                  notes = excluded.notes, bounce_rating = excluded.bounce_rating,
                  pace_rating = excluded.pace_rating, outfield = excluded.outfield,
                  reported_by = excluded.reported_by, reported_at = now()
            returning surface, grass, bounce, pace, favours, covers_on, notes,
                      bounce_rating, pace_rating, outfield, reported_at`,
      build: (r) => {
        const b = r.body || {};
        const v = {
          surface: oneOf(b.surface, ["hard", "firm", "soft", "damp"], "surface"),
          grass:   oneOf(b.grass,   ["bare", "light", "covered", "green"], "grass"),
          bounce:  oneOf(b.bounce,  ["low", "even", "variable", "steep"], "bounce"),
          pace:    oneOf(b.pace,    ["slow", "medium", "quick"], "pace"),
          favours: oneOf(b.favours, ["seam", "spin", "batting", "even"], "favours"),
          coversOn: bool(b.coversOn),
          notes: b.notes == null ? null : String(b.notes).slice(0, 2000),
          // The degree beside the character — see the column comments. Either
          // may be given without the other: a groundsman who says "two-paced"
          // and declines to put a number on it has still said something.
          bounceRating: num(b.bounceRating, 1, 10, "bounce_rating"),
          paceRating:   num(b.paceRating,   1, 10, "pace_rating"),
          outfield: oneOf(b.outfield, ["fast", "medium", "slow"], "outfield"),
        };
        // Every field is optional, but a report of nothing at all is a row that
        // says a groundsman filed a report when he did not.
        if (Object.values(v).every((x) => x == null)) throw err("empty_report");
        return v;
      },
      params: (v) => [v.surface, v.grass, v.bounce, v.pace, v.favours, v.coversOn, v.notes,
                      v.bounceRating, v.paceRating, v.outfield],
    }),

    // POST /grounds/:id/condition
    //
    // The groundsman's standing record of a ground, as opposed to the square
    // prepared for one fixture. Same shape as the pitch report and the same
    // capability, because it is the same person doing the same job — but keyed
    // on the ground, because that is what the facts belong to.
    ground: (req, res) => upsert(req, res, {
      sql: `insert into ground_condition
              (ground_id, school_id, moisture_pct, grass_mm, roller, outfield,
               drainage_min, last_rolled, last_mown, notes, reported_by, reported_at)
            select $1, g.school_id, $2, $3, $4, $5, $6, $7, $8, $9, app_user_id(), now()
              from ground g where g.id = $1
            on conflict (ground_id) do update
              set moisture_pct = excluded.moisture_pct, grass_mm = excluded.grass_mm,
                  roller = excluded.roller, outfield = excluded.outfield,
                  drainage_min = excluded.drainage_min, last_rolled = excluded.last_rolled,
                  last_mown = excluded.last_mown, notes = excluded.notes,
                  reported_by = excluded.reported_by, reported_at = now()
            returning moisture_pct, grass_mm, roller, outfield, drainage_min,
                      last_rolled, last_mown, notes, reported_at`,
      build: (r) => {
        const b = r.body || {};
        const v = {
          moisture: num(b.moisturePct, 0, 100, "moisture_pct"),
          grassMm:  num(b.grassMm, 0, 100, "grass_mm"),
          roller:   oneOf(b.roller, ["none", "light", "heavy"], "roller"),
          outfield: oneOf(b.outfield, ["fast", "medium", "slow"], "outfield"),
          // The wet-morning question. Ten hours is the ceiling: past that the
          // answer is "not today", which is a decision and not a measurement.
          drainage: num(b.drainageMin, 0, 600, "drainage_min"),
          lastRolled: date(b.lastRolled, "last_rolled"),
          lastMown:   date(b.lastMown, "last_mown"),
          notes: b.notes == null ? null : String(b.notes).slice(0, 2000),
        };
        if (Object.values(v).every((x) => x == null)) throw err("empty_report");
        return v;
      },
      params: (v) => [v.moisture, v.grassMm, v.roller, v.outfield, v.drainage,
                      v.lastRolled, v.lastMown, v.notes],
    }),
  };
}
