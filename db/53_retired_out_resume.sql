-- ══════════════════════════════════════════════════════════════════
--  53 · A batter retired out who resumes with the captain's consent
--       is not out (Law 25.4.3)
-- ══════════════════════════════════════════════════════════════════
--
-- THE RULE (MCC Laws, Law 25.4.3 and 25.4.4): a batter who retires for any
-- reason other than illness, injury or another unavoidable cause may resume
-- only with the opposing captain's consent, and — like any retired batter —
-- only at the fall of a wicket or the retirement of another batter. If he
-- does not resume he is recorded "retired, out".
--
-- HOW THE LOG SAYS IT (SCRBRD-071). Retired out is a `retire` row marked
-- ball_type 'W' (db/40, SCRBRD-081): a wicket with no ball, from the moment
-- it is recorded. His return is a `batters` row naming him, with
-- payload.captainConsent = true (batters() in packages/scoring/src/events.mjs;
-- lawsRefusal() takes it only for a batter retired out, at a wicket or
-- another's retirement since). The fold (replay.mjs) then takes his wicket
-- back: one fewer, off the fall of wickets, his line batting again.
--
-- WHAT SQL DID. Every reader decided a retirement's wicket from its own row:
-- ball_retirement_dismissal() and ball_retired_batter() (db/40) are
-- row-local, and ball_wicket_stands() (db/42) answers true for any non-ball
-- W. So a consented return left the wicket standing in the live score and
-- the handover's count (the device would say one fewer: every handover of
-- that innings refused), in player_innings (out), in every career
-- dismissal and in the dismissal breakdowns.
--
-- WHAT THIS FILE DOES. One place, not twelve. Every one of those readers
-- reads ball_event_live, whose ball_type is already "the ball type as the
-- fold reads it" (db/43's ball_type_as_folded()). A retirement the fold has
-- taken back is, to the fold, no wicket — so ball_event_live now says so:
--
--   retirement_resumed(match, innings, seq, batter)
--     true when a LIVE (not voided) `batters` row later in the same innings
--     carries captainConsent and names that batter (striker_id or
--     non_striker_id, or payload.striker / payload.nonStriker for a name
--     SCRBRD holds no row for)
--
--   ball_event_live: a `retire` row marked 'W' that retirement_resumed()
--     reads with ball_type NULL and dismissal NULL — a retirement that is
--     not a wicket, exactly as a retired hurt row reads. Every other row,
--     every other column, exactly as db/43 had them.
--
-- and so, with no change to their text: match_live_score (wickets),
-- innings_score_as_folded() and scoring_verify_takeover() (the handover's
-- count), player_innings (not out), player_dismissals_since(),
-- player_dismissal_breakdown, player_batting_since(), the season views
-- (db/44), player_batting_career and player_dismissals (db/49),
-- milestone_watch() (db/51), and the read API's queries over
-- ball_event_live. Nothing that reads ball_event itself counts a wicket
-- (the fold's own reads, the quarantine, the broadcast's last ball).
--
-- EXACT FOR A LAWFUL LOG. "A later consented return names him" is his
-- return from THIS retirement: once retired out he bats again in the innings
-- only with consent, so a return before a later retirement belongs to an
-- earlier one, and seq orders them. A consent the Laws refused never reached
-- the log. A voided return is no return (the retirement stands again), as
-- the fold reads it.
--
-- IDENTICAL SHAPE. ball_event_live keeps its columns, types, order,
-- security_invoker, owner and grants; the block at the end checks them
-- against a snapshot taken before. retirement_resumed() is SECURITY INVOKER
-- and reads ball_event under the caller's policy, as the view does: a
-- reader who may see the retirement may see the return (the same match).
-- It keeps PUBLIC's EXECUTE, as every rule function the invoker views call
-- (ball_type_as_folded(), ball_wicket_stands() ...): the view runs as its
-- caller, who must be able to call it. Idempotent: CREATE OR REPLACE, the
-- snapshot replaced if it exists, the proof rolled back.
--
-- PROOF THAT SQL AND THE FOLD AGREE. The block at the end writes "the db/53
-- fixture" — the same events replay.test.mjs folds under that name — and
-- reads it through the live score, the handover's count, player_innings and
-- the dismissal readers; then voids the return and reads the wicket back.
-- db/99 §31 holds it on every verify paste; tools/smoke-fold-figures.mjs
-- compares every reader with the fold over generated logs that resume
-- batters retired out.

-- ── The shape of what this file replaces, before it does ─────────
DROP TABLE IF EXISTS _db53_before;
CREATE TEMP TABLE _db53_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions),
         'acl', to_jsonb(c.relacl::text[]),
         'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname = 'ball_event_live';

-- ── Was this retirement taken back? ───────────────────────────────
-- A live `batters` row after it, in its innings, with the captain's consent,
-- naming the batter. lower(): an id is compared as text, and a payload may
-- spell a uuid in either case.
CREATE OR REPLACE FUNCTION retirement_resumed(p_match uuid, p_innings smallint, p_seq integer, p_batter text)
RETURNS boolean AS $$
  SELECT p_batter IS NOT NULL AND EXISTS (
    SELECT 1 FROM ball_event c
     WHERE c.match_id = p_match
       AND c.innings = p_innings
       AND c.seq > p_seq
       AND c.kind = 'batters'
       AND c.payload->>'captainConsent' = 'true'
       AND lower(p_batter) IN (lower(c.striker_id::text), lower(c.non_striker_id::text),
                               lower(c.payload->>'striker'), lower(c.payload->>'nonStriker'))
       AND NOT EXISTS (
             SELECT 1 FROM ball_event v
              WHERE v.match_id = c.match_id
                AND v.kind = 'void'
                AND v.payload->>'target' = c.idempotency_key))
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- ── The balls that count (db/43) ─────────────────────────────────
-- db/43's view, word for word, but for the two CASEs: a retirement marked W
-- that was taken back reads as one that is no wicket. Keep
-- ball_type_as_folded() and these CASEs if this view is ever recreated.
-- security_invoker is restated: CREATE OR REPLACE VIEW replaces the options.
CREATE OR REPLACE VIEW ball_event_live WITH (security_invoker = true) AS
SELECT b.id, b.match_id, b.school_id, b.seq, b.epoch, b.innings,
       b.scorer_user_id, b.device_id, b.idempotency_key, b.client_seq, b.client_ts, b.server_ts,
       b.kind,
       CASE WHEN b.kind = 'retire' AND b.ball_type = 'W'
                 AND retirement_resumed(b.match_id, b.innings, b.seq, b.payload->>'batter') THEN NULL
            ELSE ball_type_as_folded(b.kind, b.ball_type) END AS ball_type,
       b.value, b.shot, b.contact, b.trajectory, b.seg, b.zone,
       b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id,
       CASE WHEN b.kind = 'retire' AND b.ball_type = 'W'
                 AND retirement_resumed(b.match_id, b.innings, b.seq, b.payload->>'batter') THEN NULL
            ELSE b.dismissal END AS dismissal,
       b.payload, b.recovered,
       b.theta, b.radius, b.placement_source, b.placement_null, b.close_position, b.capture_profile
  FROM ball_event b
 WHERE b.kind <> 'void'
   -- NOT EXISTS rather than NOT IN, as db/02 explains.
   AND NOT EXISTS (
         SELECT 1 FROM ball_event v
          WHERE v.match_id = b.match_id
            AND v.kind = 'void'
            AND v.payload->>'target' = b.idempotency_key);

-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  r record;
  now_shape jsonb;
  n int;
  got text;
  want text;
  -- The proof's own rows, built below and rolled back before this block ends.
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  m_a      uuid := gen_random_uuid();
  p_a      uuid := gen_random_uuid();   -- on strike; retires out; back with consent
  p_b      uuid := gen_random_uuid();   -- at the other end
  p_c      uuid := gen_random_uuid();   -- comes in; bowled
  p_d      uuid := gen_random_uuid();   -- bowling
  v_door   boolean := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                               AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O');
  v_setting text := coalesce(current_setting('app.user_id', true), '');
BEGIN
  -- 1. The shape: the same view, the same everything but its body.
  SELECT count(*) INTO n FROM _db53_before;
  IF n <> 1 THEN RAISE EXCEPTION 'db/53: expected to snapshot ball_event_live, found % object(s)', n; END IF;
  FOR r IN SELECT * FROM _db53_before LOOP
    SELECT jsonb_build_object(
             'options', to_jsonb(c.reloptions),
             'acl', to_jsonb(c.relacl::text[]),
             'owner', c.relowner::regrole::text,
             'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                           FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
      INTO now_shape
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'v' AND c.relname = substr(r.obj, 6);
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/53: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;

  -- 2. The view asks the rule, for its ball type and its dismissal, and still
  --    reads ball types as the fold does; the rule is the caller's own.
  IF (SELECT count(*) FROM regexp_matches(pg_get_viewdef('ball_event_live'::regclass), 'retirement_resumed\(', 'g')) <> 2
     OR pg_get_viewdef('ball_event_live'::regclass) NOT LIKE '%ball_type_as_folded(%' THEN
    RAISE EXCEPTION 'db/53: ball_event_live does not read a resumed retirement through retirement_resumed() twice, or lost ball_type_as_folded()';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'retirement_resumed(uuid,smallint,integer,text)'::regprocedure) THEN
    RAISE EXCEPTION 'db/53: retirement_resumed() must run as its caller';
  END IF;

  -- 3. The fixture: "the db/53 fixture" in packages/scoring/test/replay.test.mjs,
  --    which the fold reads as 6 for 1, A 6 (2) not out, C bowled. Written as
  --    the owner in a school that exists only inside this block, then undone
  --    by the sentinel.
  --      k  event                                 the fold
  --      1  A hits 4                              4 for 0; A 4 (1)
  --      2  retire marked W: A retired out        4 for 1
  --      3  batters: C at the striker's end
  --      4  C a dot
  --      5  C bowled                              4 for 2
  --      6  batters: A, captainConsent            4 for 1 — his wicket taken back
  --      7  A hits 2                              6 for 1; A 6 (2), not out
  --    then (8) a void of 6: the return undone, 6 for 2 and A out again.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db53-' || v_school, 'db/53 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db53-' || v_user || '@example.invalid', 'db/53 proof, scorer', 'coach', v_school);
    INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
      (p_a, v_school, '1XI', 'db/53 Opener',  1, 'batter', (current_date - interval '16 years')::date),
      (p_b, v_school, '1XI', 'db/53 Partner', 2, 'batter', (current_date - interval '16 years')::date),
      (p_c, v_school, '1XI', 'db/53 Three',   3, 'batter', (current_date - interval '16 years')::date),
      (p_d, v_school, '1XI', 'db/53 Seamer',  4, 'bowler', (current_date - interval '16 years')::date);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (m_a, v_school, '1XI', 'db/53 proof', now() - interval '7 days', 'cricket', 'T20', 20, 'complete');
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, ball_type, value,
                            striker_id, non_striker_id, bowler_id, dismissal, payload)
    SELECT m_a, v_school, x.k, 1, 0, v_user, 'db53-proof',
           'db53:' || m_a || ':' || x.k, x.k, now(), x.kind, x.bt, x.v,
           x.striker, x.ns, x.bowler, x.dis, x.pl
      FROM (VALUES
        (1, 'ball',    'run', 4,    p_a,  p_b,        p_d,        NULL,          '{}'::jsonb),
        (2, 'retire',  'W',   NULL, NULL, NULL,       NULL,       'retired_out', jsonb_build_object('batter', p_a, 'reason', 'out')),
        (3, 'batters', NULL,  NULL, p_c,  NULL::uuid, NULL::uuid, NULL,          '{}'::jsonb),
        (4, 'ball',    'run', 0,    p_c,  p_b,        p_d,        NULL,          '{}'::jsonb),
        (5, 'ball',    'W',   0,    p_c,  p_b,        p_d,        'bowled',      '{}'::jsonb),
        (6, 'batters', NULL,  NULL, p_a,  NULL,       NULL,       NULL,          '{"captainConsent":true}'::jsonb),
        (7, 'ball',    'run', 2,    p_a,  p_b,        p_d,        NULL,          '{}'::jsonb)
      ) AS x(k, kind, bt, v, striker, ns, bowler, dis, pl);

    SELECT concat_ws(' ',
             (SELECT 'live' || row(s.runs, s.wickets, s.legal_balls)::text FROM match_live_score s
               WHERE s.match_id = m_a AND s.innings = 0),
             (SELECT 'handover' || row(f.runs, f.wickets, f.legal_balls)::text FROM innings_score_as_folded(m_a, 0::smallint) f),
             (SELECT 'A' || row(i.runs, i.balls_faced, i.out)::text FROM player_innings i WHERE i.player_id = p_a AND i.match_id = m_a),
             (SELECT 'C' || row(i.runs, i.balls_faced, i.out)::text FROM player_innings i WHERE i.player_id = p_c AND i.match_id = m_a),
             'dismissed' || row(player_dismissals_since(p_a, NULL), player_dismissals_since(p_c, NULL))::text,
             'breakdown:' || coalesce((SELECT string_agg(d.dismissal, ',' ORDER BY d.dismissal) FROM player_dismissal_breakdown d
                                        WHERE d.player_id IN (p_a, p_c)), '-'),
             (SELECT 'row2' || row(coalesce(l.ball_type, '-'), coalesce(l.dismissal, '-'))::text FROM ball_event_live l
               WHERE l.match_id = m_a AND l.seq = 2))
      INTO got;

    -- The return undone: the retirement stands again.
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, payload)
    VALUES (m_a, v_school, 8, 1, 0, v_user, 'db53-proof', 'db53:' || m_a || ':8', 8, now(), 'void',
            jsonb_build_object('target', 'db53:' || m_a || ':6'));
    SELECT got || ' | ' || concat_ws(' ',
             (SELECT 'live' || row(s.runs, s.wickets, s.legal_balls)::text FROM match_live_score s
               WHERE s.match_id = m_a AND s.innings = 0),
             (SELECT 'A' || row(i.runs, i.balls_faced, i.out)::text FROM player_innings i WHERE i.player_id = p_a AND i.match_id = m_a),
             'dismissed' || row(player_dismissals_since(p_a, NULL))::text)
      INTO got;
    RAISE EXCEPTION USING ERRCODE = 'ZZ053', MESSAGE = 'db/53: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ053' THEN NULL;
  END;
  want := 'live(6,1,4) handover(6,1,4) A(6,2,f) C(0,2,t) dismissed(0,1) breakdown:bowled row2(-,-)'
       || ' | live(6,2,4) A(6,2,t) dismissed(1)';
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/53: the fixture reads %, the fold reads % — a resumed retirement still counts, or a reader moved', got, want;
  END IF;

  -- And nothing of the proof is left: no row, no setting.
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school)
     OR EXISTS (SELECT 1 FROM app_user WHERE id = v_user)
     OR EXISTS (SELECT 1 FROM player WHERE id IN (p_a, p_b, p_c, p_d))
     OR EXISTS (SELECT 1 FROM match WHERE id = m_a)
     OR EXISTS (SELECT 1 FROM ball_event WHERE match_id = m_a)
     OR v_door IS DISTINCT FROM EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass
                                         AND tgname = 'ball_event_names_its_delivery' AND tgenabled = 'O')
     OR coalesce(current_setting('app.user_id', true), '') IS DISTINCT FROM v_setting THEN
    RAISE EXCEPTION 'db/53: the proof left something behind';
  END IF;
END $check$;

DROP TABLE _db53_before;
