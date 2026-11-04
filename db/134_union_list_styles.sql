-- ══════════════════════════════════════════════════════════════════
--  134 · The union selector's list carries each boy's playing styles:
--        how he bats and what he bowls, in the row, and nothing more
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Slice S5 of docs/design/UNION_SELECTOR_FIND.md (§10), the
-- last. Kameel's answer to the design's Q4 (30 Oct 2026, 21:05 SAST, the
-- Build Board, "all six as recommended"): "4 yes, in slice S5". He said yes
-- to building it on 4 Nov 2026, as an exception to the pilot scope freeze.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
-- passport_union_list() (db/125 §4) gains two columns at the end of its row:
--   batting_style  player.batting_style: 'R' or 'L', or null
--   bowling_style  player.bowling_style: 'F', 'M' or 'S', or null
-- read from player as the function's owner, as the row's name, school and
-- side already are. The screen draws them in words ("Right-hand bat ·
-- spin"); a style not recorded is left out, never "unknown".
--
-- Styles are roster identity (READERS_child_data class A, level 1), less
-- than the passport the consent already opens, and not a figure. Everything
-- else in D3 stands: no figure, no rate, no role (playing_role is not read),
-- no bowling arm, no honour, no cap, no date of birth, no order of merit;
-- the order is still school, then surname, then the whole name. Every other
-- line of db/125's body is db/125's: the in-force test, the filters, the
-- refusal of an unfiltered call, and the record written before the list
-- answers (passport_union_log_list(), unchanged, which takes the same ids
-- and consents as before).
--
-- ── WHY DROP AND CREATE ─────────────────────────────────────────────
-- A function's return columns cannot change under CREATE OR REPLACE. So the
-- old one is dropped (plain DROP, which refuses if anything depends on it:
-- nothing does; the API names it in a query string and db/99 by signature)
-- and the new one created with the same signature, owner, SECURITY DEFINER,
-- pinned search_path and VOLATILE, and granted again: scrbrd_app alone;
-- revoked from PUBLIC, anon, authenticated and service_role. The drop and
-- the create sit in the same transaction, so no caller sees it missing.
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   function passport_union_list(uuid,uuid,text,text) (db/125): dropped and
--     created again returning eight columns, not six; grants as db/125 left
--     them (scrbrd_app's alone)
-- No table, column, capability, role or policy. A second paste changes
-- nothing. db/125 cannot be pasted again after this file: its CREATE OR
-- REPLACE cannot change the eight columns back to six, and refuses.
--
-- Its proof is db/99 §102 (i): the row is exactly the eight columns, and the
-- body reads nothing past the name, the school, the side and the two styles.
-- Not to be pasted before it is reviewed.
--
-- THE GUARD keys on pg_proc.prosrc as db/124 and db/125 do: the md5 of the
-- live body, its whitespace folded, must be db/125's or this file's.


-- ── 0 · Refuse to run against what this file was not written for ───
DO $guard$
DECLARE v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('passport_union_log_list(uuid[],uuid[])') IS NULL
     OR to_regprocedure('passport_union_reader_at(uuid)') IS NULL
     OR to_regprocedure('consent_giver_live(uuid,uuid,timestamptz)') IS NULL
     OR to_regprocedure('school_union(uuid)') IS NULL OR to_regprocedure('school_federation()') IS NULL THEN
    RAISE EXCEPTION 'db/134: db/125''s union selector''s list (passport_union_log_list()) or db/124''s doors are missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('passport_union_list(uuid,uuid,text,text)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/134: passport_union_list(uuid,uuid,text,text) (db/125) is not there to re-create';
  END IF;
  v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
  IF v_md5 NOT IN ('60e938bf165d3bfbe2e8435405fee403', '2af1cad23f951d568740d075f4d0a8bc') THEN
    RAISE EXCEPTION 'db/134: passport_union_list() is not db/125''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · The list, with his styles
-- ══════════════════════════════════════════════════════════════════
DROP FUNCTION passport_union_list(uuid, uuid, text, text);

/**
 * The boys whose consent to the caller's institution is in force now, at a
 * school or in an age group (at least one), optionally narrowed by a name
 * fragment: his id, name, school, side, the institution that admits him and
 * its consent, and how he bats and what he bowls (db/134; roster identity,
 * not a figure). Every row returned is recorded first (db/125 §2 of the
 * header). Refuses a call with neither school nor age group
 * (choose_a_school_or_age_group). A caller who reads at no union is
 * answered nothing, and nothing is recorded.
 */
CREATE FUNCTION passport_union_list(p_org uuid, p_school uuid, p_age_group text, p_name text DEFAULT NULL)
RETURNS TABLE (player_id uuid, name text, school_name text, team_code text, org_id uuid, consent_id uuid,
               batting_style text, bowling_style text) AS $$
DECLARE
  v_age text := upper(nullif(btrim(p_age_group), ''));
  v_q   text := lower(nullif(btrim(p_name), ''));
  v_pid uuid[]; v_name text[]; v_school text[]; v_side text[]; v_org uuid[]; v_cid uuid[];
  v_bat text[]; v_bowl text[];
BEGIN
  -- Never everyone (D2): a school, or an age group of the form U15.
  IF (p_school IS NULL AND v_age IS NULL) OR v_age !~ '^U[0-9]{2}$' THEN
    RAISE EXCEPTION 'choose_a_school_or_age_group' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- A caller who reads at no union (or not at the one named) is answered
  -- nothing, before a consent is looked at.
  IF NOT EXISTS (SELECT 1 FROM school o
                  WHERE o.kind IN ('union', 'federation') AND o.archived_at IS NULL
                    AND (p_org IS NULL OR o.id = p_org)
                    AND passport_union_reader_at(o.id)) THEN
    RETURN;
  END IF;
  WITH admitted AS (
    -- db/124's passport_union_consent(), for every boy the filters allow.
    SELECT DISTINCT ON (c.player_id) c.player_id AS pid, c.id AS cid, o.id AS oid
      FROM passport_consent c
      JOIN player p ON p.id = c.player_id
      JOIN school o ON o.id = c.to_school_id
     WHERE c.withdrawn_at IS NULL
       AND (p_org IS NULL OR o.id = p_org)
       AND (p_school IS NULL OR p.school_id = p_school)
       AND (v_age IS NULL OR substring(p.team_code FROM '^U[0-9]{2}') = v_age)
       AND (v_q IS NULL OR position(v_q IN lower(p.full_name)) > 0)
       AND consent_giver_live(c.granted_by, c.player_id, c.granted_at)
       AND o.archived_at IS NULL
       AND ((o.kind = 'union' AND o.id = school_union(p.school_id))
            OR (o.kind = 'federation' AND o.id = school_federation()))
       AND passport_union_reader_at(o.id)
     ORDER BY c.player_id, c.granted_at, c.id
  ), listed AS (
    SELECT a.pid, p.full_name, s.name AS school, p.team_code AS side, a.oid, a.cid,
           -- His styles (db/134): roster identity, never a figure or an order.
           p.batting_style AS bat, p.bowling_style AS bowl,
           row_number() OVER (ORDER BY lower(s.name) COLLATE "C",
                                       lower(substring(p.full_name FROM '(\S+)\s*$')) COLLATE "C",
                                       lower(p.full_name) COLLATE "C", a.pid) AS n
      FROM admitted a
      JOIN player p ON p.id = a.pid
      JOIN school s ON s.id = p.school_id
  )
  SELECT array_agg(pid ORDER BY n), array_agg(full_name ORDER BY n), array_agg(school ORDER BY n),
         array_agg(side ORDER BY n), array_agg(oid ORDER BY n), array_agg(cid ORDER BY n),
         array_agg(bat ORDER BY n), array_agg(bowl ORDER BY n)
    INTO v_pid, v_name, v_school, v_side, v_org, v_cid, v_bat, v_bowl
    FROM listed;
  IF v_pid IS NULL THEN RETURN; END IF;
  -- On the record before a row is given (D5).
  PERFORM passport_union_log_list(v_pid, v_cid);
  RETURN QUERY
    SELECT t.pid, t.full_name, t.school, t.side, t.oid, t.cid, t.bat, t.bowl
      FROM unnest(v_pid, v_name, v_school, v_side, v_org, v_cid, v_bat, v_bowl) WITH ORDINALITY
           AS t(pid, full_name, school, side, oid, cid, bat, bowl, n)
     ORDER BY t.n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §2 · Grants: the application's alone, as db/125 left it
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['passport_union_list(uuid,uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE v_src text; v_args text; v_n int;
BEGIN
  -- A pinned definer, VOLATILE (it logs), executable by scrbrd_app and its
  -- owner and nobody else.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure
                    AND p.prosecdef AND p.provolatile = 'v' AND p.proretset
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/134: passport_union_list() is not a VOLATILE SECURITY DEFINER with a pinned search_path';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'passport_union_list(uuid,uuid,text,text)'::regprocedure, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                 WHERE p.oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure AND x.privilege_type = 'EXECUTE'
                   AND x.grantee NOT IN (p.proowner, (SELECT oid FROM pg_roles WHERE rolname = 'scrbrd_app')))
     OR (SELECT proacl FROM pg_proc WHERE oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure) IS NULL THEN
    RAISE EXCEPTION 'db/134: passport_union_list() is executable by someone other than scrbrd_app, or not by it';
  END IF;

  -- The row is the eight columns, in that order, the two styles text.
  SELECT array_to_string(p.proargnames[pronargs + 1:], ','), array_to_string(p.proargmodes, '')
    INTO v_args, v_src
    FROM pg_proc p WHERE p.oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure;
  IF v_args IS DISTINCT FROM 'player_id,name,school_name,team_code,org_id,consent_id,batting_style,bowling_style'
     OR v_src IS DISTINCT FROM 'iiiitttttttt'
     OR (SELECT array_to_string(proallargtypes[11:12]::regtype[], ',') FROM pg_proc
          WHERE oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure) IS DISTINCT FROM 'text,text' THEN
    RAISE EXCEPTION 'db/134: passport_union_list() returns [%], not the eight columns', v_args;
  END IF;

  -- And reads nothing past the name, the school, the side and the two
  -- styles: no date of birth, no figure, no role, no arm, no honour, no cap,
  -- no second logged read.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure;
  IF v_src ~* '\m(born|player_innings|bowler_innings_figures|honour|team_cap|player_milestone|playing_role|bowling_arm|passport_name|passport_open)\M' THEN
    RAISE EXCEPTION 'db/134: passport_union_list() reads past the name, the school, the side and the styles';
  END IF;
  -- Each style read once, from his own player row, and never in the order.
  IF (length(v_src) - length(replace(v_src, 'batting_style', ''))) / length('batting_style') <> 1
     OR (length(v_src) - length(replace(v_src, 'bowling_style', ''))) / length('bowling_style') <> 1
     OR position('p.batting_style AS bat, p.bowling_style AS bowl' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/134: passport_union_list() reads the styles other than once each from player';
  END IF;
  -- db/125's in-force test, filters, order and record, untouched.
  v_src := btrim(regexp_replace(v_src, '\s+', ' ', 'g'));
  IF position('c.withdrawn_at IS NULL' IN v_src) = 0
     OR position('consent_giver_live(c.granted_by, c.player_id, c.granted_at)' IN v_src) = 0
     OR position('o.archived_at IS NULL' IN v_src) = 0
     OR position('(o.kind = ''union'' AND o.id = school_union(p.school_id))' IN v_src) = 0
     OR position('(o.kind = ''federation'' AND o.id = school_federation())' IN v_src) = 0
     OR position('passport_union_reader_at(o.id)' IN v_src) = 0
     OR position('ORDER BY c.player_id, c.granted_at, c.id' IN v_src) = 0
     OR position('row_number() OVER (ORDER BY lower(s.name) COLLATE "C", lower(substring(p.full_name FROM ''(\S+)\s*$'')) COLLATE "C", lower(p.full_name) COLLATE "C", a.pid) AS n' IN v_src) = 0
     OR position('choose_a_school_or_age_group' IN v_src) = 0
     OR position('PERFORM passport_union_log_list(v_pid, v_cid);' IN v_src) = 0
     OR position('PERFORM passport_union_log_list(v_pid, v_cid);' IN v_src) > position('RETURN QUERY' IN v_src)
     OR v_src ~* '\m(LIKE|ILIKE|SIMILAR)\M' THEN
    RAISE EXCEPTION 'db/134: passport_union_list() is not db/125''s in-force test, filtered, ordered and logged before it answers';
  END IF;

  -- And it answers nobody (the owner, with no caller set), logging nothing,
  -- and still refuses an unfiltered call.
  PERFORM set_config('app.user_id', '', true);
  SELECT count(*) INTO v_n FROM passport_union_read;
  IF EXISTS (SELECT 1 FROM passport_union_list(NULL, gen_random_uuid(), NULL, NULL))
     OR EXISTS (SELECT 1 FROM passport_union_list(NULL, NULL, 'U15', NULL))
     OR (SELECT count(*) FROM passport_union_read) <> v_n THEN
    RAISE EXCEPTION 'db/134: the list answered nobody, or logged for nobody';
  END IF;
  BEGIN
    PERFORM 1 FROM passport_union_list(NULL, NULL, NULL, 'a');
    RAISE EXCEPTION 'db/134: the list answered a call with neither school nor age group';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $check$;
