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
            striker_id, non_striker_id, bowler_id, dismissed_id, dismissal, payload,
            theta, radius, placement_source, placement_null, close_position, capture_profile)
         values ($1, match_school($1), $2, $3, $4, app_user_id(), $5,
                 $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                 $20, $21, $22, $23, $24, $25, $26)`,
        [matchId, seq, ev.epoch, row.innings ?? ev.innings ?? 0, ev.deviceId,
         ev.idempotencyKey, ev.clientSeq, new Date(ev.clientTs ?? Date.now()),
         row.kind || "ball", row.ball_type ?? null, row.value ?? null,
         row.shot ?? null, row.seg ?? null, row.zone ?? null,
         row.striker_id ?? null, row.non_striker_id ?? null, row.bowler_id ?? null,
         row.dismissed_id ?? null, row.dismissal ?? null, JSON.stringify(row.payload ?? {}),
         row.theta ?? null, row.radius ?? null, row.placement_source ?? null,
         row.placement_null ?? null, row.close_position ?? null, row.capture_profile ?? null]);


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
  striker_id, non_striker_id, bowler_id, dismissed_id, dismissal, idempotency_key,
  scorer_user_id, device_id, client_ts, server_ts, payload,
  theta, radius, placement_source, placement_null, close_position, capture_profile`;

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


/**
 * Amending a completed match.
 *
 * Both handlers do what every write path here does: as little as possible. The
 * INSERT policy on scoring_amendment decides who may ask, and
 * scoring_amendment_decide() checks the approver's authority — and that they
 * are not the requester — before it appends anything. A check in JavaScript
 * would be a second opinion that can drift from the one that runs.
 */
export function amendmentRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
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
    decide: handle(async (req) => {
      const approve = req.body?.approve === true;
      return runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const { rows } = await client.query(
          `select * from scoring_amendment_decide($1, $2, $3)`,
          [req.params.id, approve, req.body?.note ?? null]);
        return rows[0] ?? { ok: false, reason: "no_result" };
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
 */
export function squadRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
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
            written += r.rowCount;
          }
          // Zero rows with no error means the policy refused every insert.
          // Reported as a refusal rather than a success with nothing in it.
          if (written === 0) throw err("not_permitted", 403);
          return { matchId: req.params.id, side, selected: written };
        });
        res.json(out);
      } catch (e) {
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
 */
export function tossRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
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
      } catch (e) {
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
 */
export function availabilityRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
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
      } catch (e) {
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
 */
export function transportRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
  // YYYY-MM-DD or nothing. A cover date typed as "March next year" is refused
  // rather than stored as null, because null means "not recorded" and a
  // coordinator who typed a date would read "unknown" as the system losing it.
  const isoDate = (v) => {
    if (v == null || v === "") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw err("date_must_be_yyyy_mm_dd");
    return String(v);
  };
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
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
        const r = rows[0] ?? { ok: false, reason: "no_result" };
        // The function's own reason, not a flattened refusal: "already
        // departed" and "not this driver" send a person to different places.
        if (r.ok === false) throw err(r.reason || "refused", r.reason === "no_such_trip" ? 404 : 403);
        return { tripId: req.params.id, event };
      });
    }),
  };
}

export function officialRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });
  const DUTIES = ["umpire", "third_umpire", "scorer", "referee"];
  return {
    // POST /matches/:id/officials { officials: [{ duty, name, personId?, panel? }] }
    appoint: async (req, res) => {
      try {
        const officials = req.body?.officials;
        if (!Array.isArray(officials) || !officials.length) throw err("officials_required");

        for (const o of officials) {
          if (!DUTIES.includes(o?.duty)) throw err("duty_must_be_umpire_third_umpire_scorer_or_referee");
          // The name is required even when an account is named, because it is
          // what every reader sees: the read never joins app_user, and a blank
          // name on a scorecard is worse than a refusal here. See the table.
          if (!o?.name || typeof o.name !== "string" || !o.name.trim()) throw err("name_required");
        }
        // The same person twice on one duty is a mis-tick. The database has
        // partial unique indexes for this; catching it here names which one,
        // before anything is written.
        const seen = new Set();
        for (const o of officials) {
          const key = `${o.duty}:${(o.personId || o.name.trim().toLowerCase())}`;
          if (seen.has(key)) throw err("duplicate_official");
          seen.add(key);
        }

        const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
          await client.query(
            `update match_official set withdrawn = true
              where match_id = $1 and not withdrawn`,
            [req.params.id]);

          let written = 0;
          for (const o of officials) {
            const r = await client.query(
              `insert into match_official
                 (match_id, school_id, duty, person_name, person_id, panel, appointed_by, appointed_at)
               values ($1, match_school($1), $2, $3, $4, $5, app_user_id(), now())
               returning id`,
              [req.params.id, o.duty, o.name.trim(), o.personId ?? null,
               o.panel == null ? null : String(o.panel).slice(0, 200)]);
            written += r.rowCount;
          }
          // Zero rows and no error means the policy refused every insert.
          if (written === 0) throw err("not_permitted", 403);
          return { matchId: req.params.id, appointed: written };
        });
        res.json(out);
      } catch (e) {
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
 */
export function conditionsRoutes({ pool, secret }) {
  const err = (code, status = 400) => Object.assign(new Error(code), { status });

  // Shared shape for both handlers: derive school from the match, upsert on
  // match_id, report a policy refusal as a refusal rather than a silent no-op.
  const upsert = async (req, res, { sql, params, build }) => {
    try {
      const values = build(req);
      const out = await runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
        const r = await client.query(sql, [req.params.id, ...params(values)]);
        if (!r.rowCount) throw err("not_permitted", 403);
        return { matchId: req.params.id, ...r.rows[0] };
      });
      res.json(out);
    } catch (e) {
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
  const num = (v, lo, hi, field) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw err(`${field}_out_of_range`);
    return n;
  };
  const oneOf = (v, allowed, field) => {
    if (v == null || v === "") return null;
    if (!allowed.includes(v)) throw err(`${field}_invalid`);
    return v;
  };
  const bool = (v) => (v == null ? null : v === true);
  // A calendar date, or nothing. Rejected rather than coerced: `new Date()` of
  // a typo yields Invalid Date, which Postgres refuses with a message about a
  // type rather than about the field the groundsman got wrong.
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
