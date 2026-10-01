-- ══════════════════════════════════════════════════════════════════
--  78 · Public commentary names the shot and where it went
--       (SCRBRD-139; SCRBRD-083 rule L7, amended)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel, 2026-10-01: "I want the public page to name the shot
-- and where it went ('driven through the covers for four')." PUBLIC_DATA.md
-- L7 as amended: a ball's shot and where it went may be named in public
-- commentary, AS WORDS; wagon-wheel and shot-map drawings stay team-level
-- (public_shot_sectors(), db/59, unchanged); no coordinate — theta, radius,
-- seg, zone or any placement field — ever reaches a browser or the public
-- cache. Names still follow L2 and L6: nothing here names anybody.
--
-- WHERE THE WORDS ARE MADE, AND WHY. On the API, in services/api/public/
-- redact.mjs, by packages/scoring's ballAreas() and nowhere else:
--
--   1. One implementation. The words are commentary.mjs's: areaOf() names a
--      point by its fielding position (positionName(), which needs the
--      radius for the depth — cover or deep cover), and a sector-era ball by
--      its sector read through the hand of the batter on strike, whom only
--      the fold knows (the stored seg is the screen's, mirrored for a
--      left-hander). Neither can be said in SQL without writing the
--      fielding taxonomy and the fold a second time, and a second copy is
--      the one that drifts. So SQL does not make words.
--   2. No coordinate leaves the server. This function hands the API process
--      the fields the words need — the shot, and `place`: theta, radius,
--      seg and the placement's source, as fromRow() reads them — for each
--      ball of a SERVED fixture. redact.mjs folds the log, asks ballAreas()
--      for each ball's word, keeps `shot` (an id of the closed vocabulary)
--      and `area` (a word of AREA_WORDS), and drops `place` before anything
--      is cached or sent: no PUBLIC_EVENT_FIELDS kind lists it, and
--      public.test.mjs and tools/smoke-public.mjs hold every response free of
--      every coordinate key.
--   3. The function stays a redaction boundary. Every key is still named one
--      by one; `place` carries exactly the four fields the words read and is
--      built only for a ball; the zone, the contact, the trajectory, the
--      close position, the placement's null reason, the capture profile and
--      the bowler's approach are never selected; an unserved fixture returns
--      nothing, as before. db/99 §57 shows what the application role gets,
--      key for key: for a placed ball `shot` and `place` {theta, radius,
--      seg, source} and nothing else positional; for a ball with nothing
--      recorded, neither.
--
-- WHAT IS HERE.
--
--   public_match_log(m, since)  db/73's, with two keys for a ball: `shot`
--                               and `place`. Signature, attributes and
--                               grants unchanged (§0 snapshots them and §2
--                               compares).
--
-- REBASING. §0 refuses to run unless public_match_log() is still db/73's
-- body. A later file that re-emits it merges these two keys and moves the
-- hash, rather than overwriting this file without a word.
--
-- RLS. Nothing new to read or write: the function is db/59's definer, behind
-- public_fixture_served(), granted to the application alone.

-- ── 0 · What this file replaces, before it does ───────────────────
DO $guard$
BEGIN
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public_match_log(uuid,integer)'::regprocedure)
       IS DISTINCT FROM '7082b8c2de8acd573fbb857144ec0bf8' THEN
    RAISE EXCEPTION 'db/78: public_match_log(uuid,integer) is not db/73''s any more; merge this file''s two keys into the version now in place and move its hash';
  END IF;
END $guard$;

DROP TABLE IF EXISTS _db78_before;
CREATE TEMP TABLE _db78_before AS
SELECT jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'strict', p.proisstrict,
         'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
         'language', p.prolang) AS shape
  FROM pg_proc p
 WHERE p.oid = 'public_match_log(uuid,integer)'::regprocedure;

-- ── 1 · The log, with a ball's shot and the words' material ────────
CREATE OR REPLACE FUNCTION public_match_log(p_match uuid, p_since integer DEFAULT 0)
RETURNS TABLE (
  seq integer, innings smallint, kind text, ball_type text, value smallint,
  striker_id uuid, non_striker_id uuid, bowler_id uuid, dismissed_id uuid, dismissal text,
  event_key text, client_ts timestamptz, detail jsonb
) AS $$
  SELECT b.seq, b.innings, b.kind, b.ball_type, b.value,
         b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id, b.dismissal,
         b.idempotency_key, b.client_ts,
         jsonb_strip_nulls(jsonb_build_object(
           -- innings_start
           'battingTeam',    b.payload -> 'battingTeam',
           'bowlingTeam',    b.payload -> 'bowlingTeam',
           'teamKey',        b.payload -> 'teamKey',
           'bowlingTeamKey', b.payload -> 'bowlingTeamKey',
           'squad',          b.payload -> 'squad',
           'bowlingSquad',   b.payload -> 'bowlingSquad',
           'overs',          b.payload -> 'overs',
           'target',         b.payload -> 'target',
           'superOver',      b.payload -> 'superOver',   -- db/71: the nth super over
           -- a player the scorer typed, where the column holds no id
           'striker',        b.payload -> 'striker',
           'nonStriker',     b.payload -> 'nonStriker',
           'bowler',         b.payload -> 'bowler',
           'dismissed',      b.payload -> 'dismissed',
           -- batters
           'captainConsent', b.payload -> 'captainConsent',
           -- ball
           'fielder',        b.payload -> 'fielder',
           'freeHit',        b.payload -> 'freeHit',
           'nbRuns',         b.payload -> 'nbRuns',
           'nbType',         b.payload -> 'nbType',
           'outAt',          b.payload -> 'outAt',
           'facesNext',      b.payload -> 'facesNext',
           'notInOver',      b.payload -> 'notInOver',
           -- db/78 (SCRBRD-139): a ball's shot, an id the API keeps only if
           -- it is one of SHOT_WORDS'; and the material of where it went, for
           -- the API to turn into a word and drop (redact.mjs). Each as
           -- fromRow() reads it: the payload's, else the column's.
           'shot',           CASE WHEN b.kind = 'ball' THEN coalesce(b.payload -> 'shot', to_jsonb(b.shot)) END,
           'place',          CASE WHEN b.kind = 'ball' THEN nullif(jsonb_strip_nulls(jsonb_build_object(
                               'theta',  coalesce(b.payload -> 'theta', to_jsonb(b.theta)),
                               'radius', coalesce(b.payload -> 'radius', to_jsonb(b.radius)),
                               'seg',    coalesce(b.payload -> 'seg', to_jsonb(b.seg)),
                               'source', coalesce(b.payload -> 'placementSource', to_jsonb(b.placement_source)))), '{}'::jsonb) END,
           -- penalty
           'runs',           b.payload -> 'runs',
           'toBattingTeam',  b.payload -> 'toBattingTeam',
           -- retire; penalty, innings_end and revision reasons (the API keeps
           -- a reason only where it is a code from a closed list)
           'batter',         b.payload -> 'batter',
           'reason',         b.payload -> 'reason',
           -- innings_end
           'confirmed',      b.payload -> 'confirmed',
           -- innings_summary (db/63): the card, less the note on a difference
           'card',           CASE WHEN b.kind = 'innings_summary' THEN (b.payload -> 'card') #- '{unreconciled,note}' END,
           -- SCRBRD-130 R1: a stop's or resumption's time; the umpires' par
           -- (the API keeps each only for its kind: redact.mjs)
           'at',             b.payload -> 'at',
           'par',            b.payload -> 'par')) AS detail
    FROM ball_event b
   WHERE b.match_id = p_match
     AND b.seq > coalesce(p_since, 0)
     AND b.kind IN ('innings_start', 'batters', 'bowler', 'ball', 'penalty', 'retire',
                    'innings_end', 'revision', 'void', 'innings_summary',
                    'play_stopped', 'play_resumed')
     AND public_fixture_served(b.match_id)
   ORDER BY b.seq
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_match_log(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_log(uuid, integer) TO scrbrd_app;

-- ── 2 · The proof ────────────────────────────────────────────────
-- Built and rolled back. db/99 §57 is the fuller proof, under the
-- application role, on every verify paste. This is what must hold the
-- moment the file has run.
DO $check$
DECLARE
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_on     uuid := gen_random_uuid();   -- published
  v_off    uuid := gen_random_uuid();   -- the same log, nobody published
  r        record;
  got      text;
  T        timestamptz := '2026-10-10 10:00+02';
BEGIN
  -- 1. The signature, attributes and grants are db/73's.
  IF (SELECT jsonb_build_object(
            'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
            'definer', p.prosecdef, 'volatility', p.provolatile, 'strict', p.proisstrict,
            'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
            'language', p.prolang) FROM pg_proc p WHERE p.oid = 'public_match_log(uuid,integer)'::regprocedure)
     IS DISTINCT FROM (SELECT shape FROM _db78_before) THEN
    RAISE EXCEPTION 'db/78: public_match_log changed shape';
  END IF;
  -- 2. Nothing positional but the four the words read is ever selected.
  IF pg_get_functiondef('public_match_log(uuid,integer)'::regprocedure)
       ~ '(b\.zone|b\.contact|b\.trajectory|b\.close_position|b\.placement_null|b\.capture_profile|''zone''|''contact''|''trajectory''|''closePosition''|''placementNull''|''captureProfile''|''bowlerApproach'')' THEN
    RAISE EXCEPTION 'db/78: the public log selects a placement field the words do not read';
  END IF;
  -- 3. A placed four, a sector-era four and a ball with nothing recorded, in
  -- a published fixture and in one nobody published.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db78-' || v_school, 'db/78 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db78-' || v_user || '@example.invalid', 'db/78 proof', 'scorer', v_school);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (v_on, v_school, '1XI', 'Kearsney', T, 'cricket', 'T20', 20, 'live'),
      (v_off, v_school, '1XI', 'Kearsney', T, 'cricket', 'T20', 20, 'live');
    INSERT INTO fixture_publication (match_id, side, school_id, team_code, published, set_by)
    VALUES (v_on, 'home', v_school, '1XI', true, v_user);
    FOR r IN SELECT m.m AS mm FROM unnest(ARRAY[v_on, v_off]) AS m(m) LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, shot, contact, trajectory, seg, zone,
                              theta, radius, placement_source, placement_null, close_position, capture_profile, payload)
      VALUES
        (r.mm, v_school, 1, 1, 0, v_user, 'db78-pad', 'db78:' || r.mm || ':1', 1, T, 'ball', 'run', 4, 'drive', 'middle', 'ground',
         8, 'boundary', 235, 0.35, 'point', NULL, NULL, 'full', '{"bowlerApproach": "over"}'),
        (r.mm, v_school, 2, 1, 0, v_user, 'db78-pad', 'db78:' || r.mm || ':2', 2, T, 'ball', 'run', 4, 'drive', NULL, NULL,
         4, 'boundary', NULL, NULL, 'sector', NULL, NULL, NULL, '{}'),
        (r.mm, v_school, 3, 1, 0, v_user, 'db78-pad', 'db78:' || r.mm || ':3', 3, T, 'ball', 'run', 0, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL, 'skipped', NULL, 'quick', '{}');
    END LOOP;
    SELECT string_agg(l.seq || '=' || l.detail::text, ' ' ORDER BY l.seq) INTO got FROM public_match_log(v_on, 0) l;
    IF got IS DISTINCT FROM '1={"shot": "drive", "place": {"seg": 8, "theta": 235, "radius": 0.35, "source": "point"}} '
                            '2={"shot": "drive", "place": {"seg": 4, "source": "sector"}} 3={}' THEN
      RAISE EXCEPTION 'db/78: the published log reads %', got;
    END IF;
    IF EXISTS (SELECT 1 FROM public_match_log(v_off, 0)) THEN
      RAISE EXCEPTION 'db/78: a fixture nobody published answered';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ078', MESSAGE = 'db/78: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ078' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/78: the proof left something behind'; END IF;
END $check$;

DROP TABLE _db78_before;
