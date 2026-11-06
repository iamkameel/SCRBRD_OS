-- ══════════════════════════════════════════════════════════════════
--  146 · Colours: the side's coach nominates, the school decides
--        (RECOGNITION R8)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/RECOGNITION_design.md, approved by Kameel on
-- 7 Oct 2026 as recommended (D1–D25, Q1–Q12, A1–A18); "I want more centuries
-- today!" (Kameel, 6 Nov 2026), and his reading of D10 the same day: a
-- guardian steps aside from deciding either way. This is §10's R8 row: R7's
-- `recognition_nomination` (its kind already allows colours and
-- half_colours) carries a coach's Colours nomination, with an optional
-- rationale that only a coach's Colours nomination may carry (D15); the
-- rationale and the citation pass D2's list at the writer (the API: one list,
-- packages/policy/src/words.mjs); D9's and A17's row checks; the award is the
-- ordinary honour row, named for its decider (D5), under recognition.decide
-- (db/145). Its proof is db/99 §124; the walk is smoke-colours.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   capability  + recognition.colours.nominate: the side's coach (A17,
--                 team-scoped), through ADDED_SINCE_01. Disjoint from
--                 recognition.decide (D9: separation.test.mjs).
--   recognition_nomination (db/144)
--               + rationale  a coach's words on why, read by the people who
--                            read the nomination (D8: the side's staff and the
--                            school's deciders and office), never the boy,
--                            his parents, his team-mates or the public. NULL
--                            for every captain's nomination (D15, SG-9: the
--                            table's own CHECK)
--               + recognition_nomination_colours_shape  a Colours nomination
--                            names its coach, no match, no pupil, no
--                            captaincy, no window, no working
--               + recognition_nomination_rationale_coach  only a coach's
--                            Colours nomination carries a rationale, of 3 to
--                            300 characters
--               + one open Colours nomination a boy a kind a season
--   triggers    + honour_colours_answer  AFTER INSERT on honour, Colours and
--                 half colours, by whichever route: the decider is never the
--                 coach who nominated him (D9); an open nomination is answered
--                 by the award (confirmed). A guardian of the boy deciding or
--                 withdrawing is refused for every kind by db/145.
--   ~ audit_log() (db/144's)  a Colours nomination is "the coach's", never
--                 "the captain's pick", patched in place (db/142's
--                 exact-needle pattern)
--   functions   + colours_nominator_holds, honour_colours_answer (nobody's)
--               + colours_sides, colours_nominations, colours_nominate,
--                 colours_decide (the doors: scrbrd_app only)
--
-- ── WHO MAY (A17, D9, D10) ──────────────────────────────────────────
-- Nominate: a holder of recognition.colours.nominate over the boy's side
-- today (the side's coach), through an assignment AT the school, as himself
-- (never a pad, a support hour or anybody who holds a platform-wide
-- assignment). Never himself (his account or a self link naming him); never
-- a boy he is guardian of (Kameel, 6 Nov 2026: another coach of the side
-- nominates his son); one
-- open nomination a boy a kind a season; not a boy who already holds them
-- this season.
-- Decide: a holder of recognition.decide at the boy's school (the director of
-- sport; the principal), as db/145's recognition_decider_holds() asks it.
-- Row checks (the guardian's at the table are db/145's, for every kind):
-- the decider is not the nominator; the decider is not a live
-- guardian of the boy (any guardian link naming him, verified or not, not
-- ended: refused, and told who decides instead — the principal when he is the
-- director); the nominee is not the nominator (above). The guardian steps
-- aside from "No award" as from "Award" (Kameel, 6 Nov 2026).
--
-- ── WHAT IS SAID ────────────────────────────────────────────────────
-- Nothing new. A Colours award is an honour on the side's board, read as
-- every honour is (D1); no notice is written about a nomination, to anybody
-- (D8: a boy never learns he was nominated and not chosen). When the office
-- records the decision through the ordinary route, db/145 tells the decider.
--
-- EXISTING ROWS. None change. Safe to run twice. DROPs: none but the pg_temp
-- helpers at the end; DROP POLICY is not needed (no policy is made).
--
-- SCHEMA FIRST. The API built with it (colours-api.mjs) calls the four
-- doors; this file goes before it and is in services/api/expected-migrations.json.
--
-- THE GUARD keys on pg_proc.prosrc as db/142 does: the md5 of the live
-- audit_log() body, whitespace folded, must be db/144's or this file's.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v146_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('recognition_nomination') IS NULL OR to_regclass('honour') IS NULL
     OR to_regprocedure('recognition_decider_holds(uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'honour'::regclass AND tgname IN ('honour_decided_by', 'honour_withdrawn_by'))
     OR to_regprocedure('recognition_nomination_staff(uuid,text,uuid)') IS NULL
     OR to_regprocedure('match_award_guardian_of(uuid,uuid)') IS NULL OR to_regprocedure('match_award_instead(uuid,uuid)') IS NULL
     OR to_regprocedure('match_award_short(text)') IS NULL OR to_regprocedure('potm_is_the_boy(uuid,uuid)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL OR to_regprocedure('season_for(date,text)') IS NULL
     OR to_regprocedure('app_is_platform_wide()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('app_support_access_id(uuid)') IS NULL OR to_regprocedure('sa_today()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM capability WHERE name = 'recognition.decide') THEN
    RAISE EXCEPTION 'db/146: recognition (db/145), the captain''s nomination (db/144) or Player of the Match (db/142) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                                         'b1ae191ba7ddb1e122d1bf849883f6a7', '017da95e9d2905102ce032be1b0d99a6', 'db/144'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/146: % (%) is not there to patch', r.fn, r.src;
    END IF;
    v_md5 := pg_temp._v146_fold(v_src);
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/146: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;

-- db/142's patcher: `needle` must stand in the body exactly `times` times.
CREATE OR REPLACE FUNCTION pg_temp._v146_patch(p_fn text, p_needle text, p_repl text, p_times integer) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> p_times THEN
    RAISE EXCEPTION 'db/146: % holds its needle % times, not %: look before replacing it', p_fn, v_n, p_times;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════════
--  1 · The capability (ADDED_SINCE_01)
-- ══════════════════════════════════════════════════════════════════
INSERT INTO capability (name) VALUES ('recognition.colours.nominate') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES ('coach', 'recognition.colours.nominate') ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════
--  2 · A coach's Colours nomination, in R7's table (D15)
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE recognition_nomination ADD COLUMN IF NOT EXISTS rationale text;
COMMENT ON COLUMN recognition_nomination.rationale IS
  'db/146 (RECOGNITION R8): a coach''s words on why he nominates a boy for Colours, passed through D2''s list at the writer. Read by whoever reads the nomination (D8); never on a captain''s nomination.';

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'recognition_nomination'::regclass
                    AND conname = 'recognition_nomination_colours_shape') THEN
    ALTER TABLE recognition_nomination ADD CONSTRAINT recognition_nomination_colours_shape CHECK (
      kind NOT IN ('colours', 'half_colours')
      OR (match_id IS NULL AND nominated_by_user_id IS NOT NULL AND nominated_by_player_id IS NULL
          AND nominated_as IS NULL AND closes_at IS NULL AND derived_from IS NULL
          AND status IN ('open', 'confirmed', 'no_award')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'recognition_nomination'::regclass
                    AND conname = 'recognition_nomination_rationale_coach') THEN
    ALTER TABLE recognition_nomination ADD CONSTRAINT recognition_nomination_rationale_coach CHECK (
      rationale IS NULL
      OR (kind IN ('colours', 'half_colours') AND nominated_by_user_id IS NOT NULL AND nominated_by_player_id IS NULL
          AND length(btrim(rationale)) BETWEEN 3 AND 300));
  END IF;
END $constraints$;

-- One open Colours nomination a boy a kind a season.
CREATE UNIQUE INDEX IF NOT EXISTS recognition_nomination_colours_open_once
  ON recognition_nomination (nominee_player_id, kind, season_id)
  WHERE kind IN ('colours', 'half_colours') AND status = 'open';
CREATE INDEX IF NOT EXISTS recognition_nomination_colours_school
  ON recognition_nomination (school_id, created_at DESC) WHERE kind IN ('colours', 'half_colours');


-- ══════════════════════════════════════════════════════════════════
--  3 · Who nominates (A17)
-- ══════════════════════════════════════════════════════════════════
-- recognition.colours.nominate over the boy's side, held as himself through
-- an assignment AT the side's school by a role holding it: never a
-- platform-wide assignment (D7, by the person), never a pad's credential,
-- never a support hour.
CREATE OR REPLACE FUNCTION colours_nominator_holds(p_school uuid, p_team text) RETURNS boolean AS $$
  SELECT p_school IS NOT NULL AND p_team IS NOT NULL
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND app_support_access_id(p_school) IS NULL
     AND NOT app_is_platform_wide()
     AND app_can('recognition.colours.nominate', p_school, p_team, '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
     AND EXISTS (SELECT 1 FROM role_assignment a
                   JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'recognition.colours.nominate'
                  WHERE a.person_id = app_user_id() AND a.active AND a.school_id = p_school
                    AND a.team_code = p_team AND a.fixture_id IS NULL
                    AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
                    AND (a.valid_until IS NULL OR a.valid_until > sa_today())
                    AND (a.expires_at IS NULL OR a.expires_at > now())
                    AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  4 · Whichever route awards Colours: the row checks (D9, D10)
-- ══════════════════════════════════════════════════════════════════
-- After honour_stamp has named the decider (db/145), so decided_by is his.
-- A write with no session (a migration, the seed) is the owner's and is not
-- asked. A refusal here undoes the award with it.
-- A guardian of the boy deciding or withdrawing any honour of his is db/145's
-- (honour_decided_by, honour_withdrawn_by: every kind, Kameel 6 Nov 2026).
CREATE OR REPLACE FUNCTION honour_colours_answer() RETURNS trigger AS $$
DECLARE n recognition_nomination%ROWTYPE;
BEGIN
  IF app_user_id() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO n FROM recognition_nomination x
   WHERE x.kind = NEW.kind AND x.nominee_player_id = NEW.player_id AND x.season_id = NEW.season_id AND x.status = 'open'
   FOR UPDATE;
  IF FOUND THEN
    IF n.nominated_by_user_id = NEW.decided_by THEN
      RAISE EXCEPTION 'decider_is_nominator' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE recognition_nomination SET status = 'confirmed', decided_by = NEW.decided_by, decided_at = now(), honour_id = NEW.id
     WHERE id = n.id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS honour_colours_answer ON honour;
CREATE TRIGGER honour_colours_answer AFTER INSERT ON honour
  FOR EACH ROW WHEN (NEW.kind IN ('colours', 'half_colours')) EXECUTE FUNCTION honour_colours_answer();


-- ══════════════════════════════════════════════════════════════════
--  5 · On the recognition audit: the coach's, never the captain's
-- ══════════════════════════════════════════════════════════════════
-- R7's trigger already writes 'nominated' and the decision of every
-- nomination; its words in audit_log() were the captain's alone. (No comment
-- may end a replacement: the rest of its line would be commented out.)
SELECT pg_temp._v146_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
$n$                                               ELSE ' (the captain''s pick)' END   -- db/144$n$,
$r$                                               WHEN rx.kind IN ('colours', 'half_colours') THEN ' (the coach''s nomination)'   -- db/146
                                               ELSE ' (the captain''s pick)' END   -- db/144$r$, 1);
SELECT pg_temp._v146_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
$n$WHEN 'nomination_confirmed'  THEN 'Confirmed the captain''s nomination for '$n$,
$r$WHEN 'nomination_confirmed'  THEN 'Confirmed the ' || CASE WHEN rx.kind IN ('colours', 'half_colours') THEN 'coach''s' ELSE 'captain''s' END || ' nomination for '$r$, 1);
SELECT pg_temp._v146_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
$n$WHEN 'nomination_no_award'   THEN 'Recorded no award on the captain''s nomination for '$n$,
$r$WHEN 'nomination_no_award'   THEN 'Recorded no award on the ' || CASE WHEN rx.kind IN ('colours', 'half_colours') THEN 'coach''s' ELSE 'captain''s' END || ' nomination for '$r$, 1);


-- ══════════════════════════════════════════════════════════════════
--  6 · The doors
-- ══════════════════════════════════════════════════════════════════
-- The Colours sheet (D8): every Colours nomination the caller reads — his
-- own, and those of the sides he is staff of or the school he decides or
-- records at — open first, with whether he may decide it now and, if not,
-- why. The rationale goes with the row to the same readers. Nobody who holds
-- a platform-wide assignment (D7).
--   refusal: decided · not_permitted (he reads, does not decide) ·
--            guardian_conflict (instead: who decides) · decider_is_nominator
--            · cannot_award_yourself
CREATE OR REPLACE FUNCTION colours_nominations()
RETURNS TABLE (nomination_id uuid, kind text, season text, school_id uuid, team_code text, side_label text,
               nominee_id uuid, nominee_name text, nominated_by_name text, mine boolean, rationale text, status text,
               nominated_at timestamptz, decided_at timestamptz, decided_by_name text, honour_id uuid,
               may_decide boolean, refusal text, instead text) AS $$
DECLARE v_me uuid := app_user_id();
BEGIN
  IF v_me IS NULL OR app_is_platform_wide() OR app_pad_scoped() THEN RETURN; END IF;
  RETURN QUERY
  SELECT n.id, n.kind, s.label, n.school_id, n.team_code, coalesce(fixture_side_label(n.school_id, n.team_code), n.team_code),
         n.nominee_player_id, p.full_name, u.name, n.nominated_by_user_id = v_me, n.rationale, n.status,
         n.created_at, n.decided_at, d.name, n.honour_id,
         x.refusal IS NULL, x.refusal,
         CASE WHEN x.refusal = 'guardian_conflict' THEN match_award_instead(v_me, n.school_id) END
    FROM recognition_nomination n
    JOIN player p ON p.id = n.nominee_player_id
    JOIN season s ON s.id = n.season_id
    LEFT JOIN app_user u ON u.id = n.nominated_by_user_id
    LEFT JOIN app_user d ON d.id = n.decided_by
    CROSS JOIN LATERAL (SELECT CASE
        WHEN n.status <> 'open' THEN 'decided'
        WHEN NOT recognition_decider_holds(v_me, n.school_id) THEN 'not_permitted'
        WHEN match_award_guardian_of(v_me, n.nominee_player_id) THEN 'guardian_conflict'
        WHEN n.nominated_by_user_id = v_me THEN 'decider_is_nominator'
        WHEN potm_is_the_boy(v_me, n.nominee_player_id) THEN 'cannot_award_yourself' END AS refusal) x
   WHERE n.kind IN ('colours', 'half_colours')
     AND app_support_access_id(n.school_id) IS NULL
     AND (n.nominated_by_user_id = v_me OR recognition_nomination_staff(n.school_id, n.team_code, NULL)
          OR recognition_decider_holds(v_me, n.school_id))
   ORDER BY (n.status = 'open') DESC, n.created_at DESC, n.id;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The sides the caller nominates for (A17): each of his own side assignments
-- through which colours_nominator_holds() answers, and the boys of each he is
-- guardian of (`kin`: the door refuses them), so the Colours sheet offers him
-- only the boys the door would take. Nothing for anybody else.
DROP FUNCTION IF EXISTS colours_sides();
CREATE FUNCTION colours_sides() RETURNS TABLE (school_id uuid, team_code text, side_label text, kin uuid[]) AS $$
  SELECT x.school_id, x.team_code, coalesce(fixture_side_label(x.school_id, x.team_code), x.team_code),
         coalesce((SELECT array_agg(p.id ORDER BY p.id) FROM player p
                    WHERE p.school_id = x.school_id AND p.team_code = x.team_code
                      AND match_award_guardian_of(app_user_id(), p.id)), '{}'::uuid[])
    FROM (SELECT DISTINCT a.school_id, a.team_code FROM role_assignment a
           WHERE a.person_id = app_user_id() AND a.team_code IS NOT NULL AND a.school_id IS NOT NULL
             AND colours_nominator_holds(a.school_id, a.team_code)) x
   ORDER BY 1, 2
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The side's coach nominates (A17). The rationale is optional; D2's list is
-- the API's (one list, in JavaScript), and the table bounds its length.
--   not_permitted · kind_invalid · cannot_nominate_yourself ·
--   nominator_is_guardian · no_season · already_awarded · already_nominated
--   · rationale_invalid
CREATE OR REPLACE FUNCTION colours_nominate(p_player uuid, p_kind text, p_rationale text)
RETURNS TABLE (ok boolean, reason text, nomination_id uuid) AS $$
DECLARE
  v_me uuid := app_user_id();
  pl player%ROWTYPE;
  v_season uuid; v_id uuid; v_why text := nullif(btrim(coalesce(p_rationale, '')), '');
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN;
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('colours', 'half_colours') THEN
    RETURN QUERY SELECT false, 'kind_invalid'::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO pl FROM player x WHERE x.id = p_player;
  -- "No such boy" and "not your side's" are one answer: confirming a boy's
  -- id to a coach who may not read him is the leak.
  IF NOT FOUND OR NOT colours_nominator_holds(pl.school_id, pl.team_code) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN;
  END IF;
  IF potm_is_the_boy(v_me, p_player) THEN
    RETURN QUERY SELECT false, 'cannot_nominate_yourself'::text, NULL::uuid; RETURN;
  END IF;
  -- Kameel, 6 Nov 2026: a coach does not nominate his own son. Any guardian
  -- link naming the boy, verified or not, not ended (db/142's test): another
  -- coach of the side nominates him.
  IF match_award_guardian_of(v_me, p_player) THEN
    RETURN QUERY SELECT false, 'nominator_is_guardian'::text, NULL::uuid; RETURN;
  END IF;
  v_season := (SELECT f.id FROM season_for(sa_today(), 'school') f);
  IF v_season IS NULL THEN
    RETURN QUERY SELECT false, 'no_season'::text, NULL::uuid; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM honour h WHERE h.player_id = p_player AND h.kind = p_kind AND h.season_id = v_season AND h.withdrawn_at IS NULL) THEN
    RETURN QUERY SELECT false, 'already_awarded'::text, NULL::uuid; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM recognition_nomination n WHERE n.nominee_player_id = p_player AND n.kind = p_kind
                AND n.season_id = v_season AND n.status = 'open') THEN
    RETURN QUERY SELECT false, 'already_nominated'::text, NULL::uuid; RETURN;
  END IF;
  IF v_why IS NOT NULL AND length(v_why) NOT BETWEEN 3 AND 300 THEN
    RETURN QUERY SELECT false, 'rationale_invalid'::text, NULL::uuid; RETURN;
  END IF;
  BEGIN
    INSERT INTO recognition_nomination (kind, season_id, school_id, team_code, nominee_player_id, nominated_by_user_id, rationale)
    VALUES (p_kind, v_season, pl.school_id, pl.team_code, p_player, v_me, v_why)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'already_nominated'::text, NULL::uuid; RETURN;
  END;
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The school decides (D9): award (the ordinary honour row, decided_by the
-- caller, which honour_colours_answer() ties to the nomination) or no
-- award. The citation is optional; D2's list is the API's.
--   not_permitted · already_decided · action_invalid · guardian_conflict
--   (detail: who decides) · decider_is_nominator · cannot_award_yourself ·
--   citation_invalid · already_awarded
CREATE OR REPLACE FUNCTION colours_decide(p_nomination uuid, p_action text, p_citation text)
RETURNS TABLE (ok boolean, reason text, detail text, honour_id uuid) AS $$
DECLARE
  n recognition_nomination%ROWTYPE;
  v_me uuid := app_user_id();
  v_id uuid; v_cite text := nullif(btrim(coalesce(p_citation, '')), '');
BEGIN
  SELECT * INTO n FROM recognition_nomination x WHERE x.id = p_nomination AND x.kind IN ('colours', 'half_colours');
  IF NOT FOUND OR v_me IS NULL OR app_is_platform_wide() OR NOT recognition_decider_holds(v_me, n.school_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO n FROM recognition_nomination x WHERE x.id = p_nomination FOR UPDATE;
  IF n.status <> 'open' THEN
    RETURN QUERY SELECT false, 'already_decided'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('award', 'no_award') THEN
    RETURN QUERY SELECT false, 'action_invalid'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  -- D10, read broadly (Kameel, 6 Nov 2026): either way.
  IF match_award_guardian_of(v_me, n.nominee_player_id) THEN
    RETURN QUERY SELECT false, 'guardian_conflict'::text, match_award_instead(v_me, n.school_id), NULL::uuid; RETURN;
  END IF;
  IF n.nominated_by_user_id = v_me THEN
    RETURN QUERY SELECT false, 'decider_is_nominator'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF potm_is_the_boy(v_me, n.nominee_player_id) THEN
    RETURN QUERY SELECT false, 'cannot_award_yourself'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF p_action = 'no_award' THEN
    UPDATE recognition_nomination SET status = 'no_award', decided_by = v_me, decided_at = now() WHERE id = n.id;
    RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF v_cite IS NOT NULL AND length(v_cite) NOT BETWEEN 3 AND 300 THEN
    RETURN QUERY SELECT false, 'citation_invalid'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  BEGIN
    -- Off the public board until the school puts it there (is_public is the
    -- school's switch, D11), said here rather than left to the default.
    INSERT INTO honour (player_id, kind, season_id, citation, awarded_on, is_public)
    VALUES (n.nominee_player_id, n.kind, n.season_id, v_cite, sa_today(), false)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'already_awarded'::text, NULL::text, NULL::uuid; RETURN;
  END;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  7 · Who may call what
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['colours_sides()', 'colours_nominations()', 'colours_nominate(uuid,text,text)', 'colours_decide(uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['colours_nominator_holds(uuid,text)', 'honour_colours_answer()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
--  What this file promised, checked in the same paste
-- ══════════════════════════════════════════════════════════════════
-- The behaviour is asserted live in db/99 §124.
DO $check$
DECLARE f text; r text; v_src text;
BEGIN
  IF pg_temp._v146_fold((SELECT prosrc FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure))
     <> '017da95e9d2905102ce032be1b0d99a6' THEN
    RAISE EXCEPTION 'db/146: audit_log() is not this file''s after the paste (md5 %)',
      pg_temp._v146_fold((SELECT prosrc FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure));
  END IF;
  -- A17, D9: the coach nominates, and nobody who decides does.
  IF (SELECT string_agg(role, ',' ORDER BY role) FROM role_capability WHERE capability = 'recognition.colours.nominate') IS DISTINCT FROM 'coach'
     OR EXISTS (SELECT 1 FROM role_capability a JOIN role_capability b ON b.role = a.role
                 WHERE a.capability = 'recognition.colours.nominate' AND b.capability = 'recognition.decide') THEN
    RAISE EXCEPTION 'db/146: recognition.colours.nominate is not the coach''s alone, or a role both nominates and decides';
  END IF;
  -- D15: the rationale is a coach's Colours nomination's alone, and bounded.
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'recognition_nomination'::regclass
        AND conname IN ('recognition_nomination_colours_shape', 'recognition_nomination_rationale_coach')) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'recognition_nomination_colours_open_once') THEN
    RAISE EXCEPTION 'db/146: a Colours constraint or the one-open index is missing';
  END IF;
  -- The application still writes no nomination: SELECT is its only privilege.
  IF has_table_privilege('scrbrd_app', 'recognition_nomination', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'recognition_nomination', 'UPDATE') THEN
    RAISE EXCEPTION 'db/146: the application writes recognition_nomination';
  END IF;
  -- Definers, pinned; no reading of the database's day (db/128).
  FOREACH f IN ARRAY ARRAY['colours_nominator_holds(uuid,text)', 'honour_colours_answer()', 'colours_sides()', 'colours_nominations()',
                           'colours_nominate(uuid,text,text)', 'colours_decide(uuid,text,text)'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/146: % is not a definer', f;
    END IF;
    IF NOT ('search_path=pg_catalog, public, pg_temp' = ANY (coalesce((SELECT proconfig FROM pg_proc WHERE oid = f::regprocedure), '{}'))) THEN
      RAISE EXCEPTION 'db/146: % does not pin its search_path', f;
    END IF;
    IF v_src ~* '\mcurrent_date\M' THEN
      RAISE EXCEPTION 'db/146: % reads the database''s day (db/128)', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['colours_sides()', 'colours_nominations()', 'colours_nominate(uuid,text,text)', 'colours_decide(uuid,text,text)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/146: % is not the application''s alone', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['colours_nominator_holds(uuid,text)', 'honour_colours_answer()'] LOOP
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/146: % is callable by the application or PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles ro, pg_proc p
                WHERE ro.rolname = r AND p.proname LIKE 'colours\_%' AND p.pronamespace = 'public'::regnamespace
                  AND has_function_privilege(ro.oid, p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/146: a colours function is executable by a managed host''s API role (%)', r;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'honour'::regclass AND tgname = 'honour_colours_answer' AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'db/146: honour_colours_answer is missing or disabled';
  END IF;
  v_src := (SELECT prosrc FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure);
  IF position($k$THEN ' (the coach''s nomination)'$k$ IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/146: audit_log() does not word the coach''s nomination';
  END IF;
END $check$;

DROP FUNCTION pg_temp._v146_patch(text, text, text, integer);
DROP FUNCTION pg_temp._v146_fold(text);
