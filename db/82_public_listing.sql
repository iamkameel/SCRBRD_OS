-- ══════════════════════════════════════════════════════════════════
--  82 · Listing on the home page, and the live read (SCRBRD-142 phase 2)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-142_public_home_page.md
-- (decided by Kameel, 2026-10-02: D1–D14 as recommended), §1.2–§1.4 and
-- §2.2. The rule is docs/policy/PUBLIC_DATA.md, rule 7 as amended (D1a): a
-- school's fixtures appear on the public home page only when that school has
-- switched listing on AND has published that fixture. A fixture published but
-- not listed stays findable by its link alone, exactly as before this file.
--
-- WHAT IS HERE:
--
--   1. public_listing — one row per school: "list our matches on the SCRBRD
--      home page". Off until switched on (PUBLIC_DATA §1.1): no row is off.
--      Written only through public_listing_set(); read by the school's own
--      broadcast.publish holders (the publication panel's line, the setting
--      itself) and by the public read below, as its owner. A school setting,
--      about no child.
--
--   2. public_listing_set(school, listed) — under broadcast.publish at the
--      school with NO team (a school-wide holder: the director of sport, the
--      office), as public_names_off_set() (db/47) decides for the whole
--      school. A sports administrator appointed to one side does not put the
--      whole school on the front page.
--
--   3. public_live_fixtures() — the home page's strip (§2.2): today's
--      fixtures (sa_today(), A2: none without a start) where, for at least
--      one side, the side is published (fixture_side_published(), db/47) AND
--      that side's school lists (§1.4: either school speaks for its own
--      listing; D2: no away consent for a team-level card). Live first, then
--      by start; at most 50 (A3). Team facts only, each already on the match
--      page's header (db/59) or result (db/69): the two schools' names and
--      team codes, whether the away side is on the platform, the status, the
--      format and overs, the start, the score by innings with the side that
--      batted it (a team fact: which team made which total), and the result
--      as public_match_result() gives it — sides, never a reason. Not here,
--      on purpose: the GROUND (D3: a list of where children are right now is
--      not the match page a parent was sent), officials, the toss, weather,
--      any player column, any id but the fixture's.
--
--   4. public_data_changed on public_listing: payload {"k": "school", "id"}.
--      The API's cache does not key by school, so the whole cache drops
--      (PublicCache.drop(), public-api.mjs) — correct and cheap. The strip's
--      other dependencies already notify: fixture_publication and match
--      (status, starts_at, sides), db/59.
--
-- THE LABELS. A side's label here is the school's name and its code the team
-- ("Hilton College", "1XI"), as §2.2 sketches; the header's label is
-- fixture_side_label(), which is both together, and the card puts the two
-- side by side. An away side off the platform is its typed name, as the
-- header shows it, with no code.
--
-- WHO MAY CALL THE READ: scrbrd_app, and nobody else — db/59's grant and for
-- db/59's reason. It is the first public read with no id (083 §2.8 as
-- amended): it walks only fixtures already public AND listed, today, bounded.
--
-- search_path pinned on every function (db/16). Safe to run twice. Applies
-- after db/81; reads nothing db/79–81 add.


-- ── 1 · The switch ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public_listing (
  school_id  uuid PRIMARY KEY REFERENCES school(id) ON DELETE CASCADE,
  -- Off until switched on. A row switched back off is kept, with who and when.
  listed     boolean NOT NULL DEFAULT false,
  set_by     uuid NOT NULL REFERENCES app_user(id),
  set_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public_listing ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public_listing FROM scrbrd_app;
GRANT SELECT ON public_listing TO scrbrd_app;

-- Read: the school's own broadcast.publish holders, any side of it ('*').
DROP POLICY IF EXISTS public_listing_read ON public_listing;
CREATE POLICY public_listing_read ON public_listing
  FOR SELECT USING (
    app_can('broadcast.publish', public_listing.school_id, '*'::text,
            '00000000-0000-0000-0000-000000000000'::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid));
-- A pad's resume credential reads nothing here (db/50's guard, on every table
-- behind row-level security).
SELECT pad_scope_guard_install('public_listing'::regclass);

/** List (or stop listing) one school's matches on the home page. */
CREATE OR REPLACE FUNCTION public_listing_set(p_school uuid, p_listed boolean)
RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF p_school IS NULL OR NOT EXISTS (SELECT 1 FROM school s WHERE s.id = p_school) THEN
    RETURN QUERY SELECT false, 'no_such_school'; RETURN;
  END IF;
  -- NULL team, not '*': the whole school's front-page presence needs a
  -- school-wide holder (db/47's names-off switch decides the same way).
  IF NOT app_can('broadcast.publish', p_school, NULL::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF p_listed IS NULL THEN RETURN QUERY SELECT false, 'no_answer'; RETURN; END IF;
  INSERT INTO public_listing (school_id, listed, set_by)
  VALUES (p_school, p_listed, app_user_id())
  ON CONFLICT (school_id)
  DO UPDATE SET listed = EXCLUDED.listed, set_by = EXCLUDED.set_by, set_at = now();
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_listing_set(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_listing_set(uuid, boolean) TO scrbrd_app;

/**
 * Whether a school lists. Internal, as public_fixture_served() is: not a
 * definer, called only from inside the definer below (as its owner).
 */
CREATE OR REPLACE FUNCTION public_school_listed(p_school uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT l.listed FROM public_listing l WHERE l.school_id = p_school), false)
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_school_listed(uuid) FROM PUBLIC;


-- ── 2 · The read: today's listed fixtures ──────────────────────────
/**
 * One row per fixture on the home page today (§1.2's rule, §1.4's table),
 * live first, then by start, at most 50. `scores` is [{innings, runs,
 * wickets, balls, side}] — match_live_score as the header counts it, and the
 * side ("home" | "away") that batted the innings as match_result_compute()
 * reads it (by the innings' team key; NULL when it cannot tell). `result` is
 * public_match_result()'s columns for the fixture, the API words them.
 */
CREATE OR REPLACE FUNCTION public_live_fixtures()
RETURNS TABLE (
  match_id uuid,
  home_label text, home_code text,
  away_label text, away_code text, away_on_platform boolean,
  status text, format text, overs smallint, starts_at timestamptz,
  scores jsonb, result jsonb, served_on text
) AS $$
  WITH listed AS (
    SELECT m.id, m.school_id, m.team_code, m.away_school_id, m.away_team_code, m.opponent,
           m.status, m.format, m.overs, m.starts_at
      FROM match m
     WHERE m.starts_at IS NOT NULL
       AND (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date = sa_today()
       AND m.status IN ('scheduled', 'live', 'complete', 'abandoned')
       AND ((fixture_side_published(m.id, 'home') AND public_school_listed(m.school_id))
            OR (m.away_school_id IS NOT NULL
                AND fixture_side_published(m.id, 'away') AND public_school_listed(m.away_school_id)))
     ORDER BY (m.status = 'live') DESC, m.starts_at, m.id
     LIMIT 50
  )
  SELECT l.id,
         hs.name, l.team_code,
         CASE WHEN l.away_school_id IS NULL THEN l.opponent ELSE aws.name END,
         CASE WHEN l.away_school_id IS NULL THEN NULL ELSE l.away_team_code END,
         l.away_school_id IS NOT NULL,
         l.status, l.format, l.overs, l.starts_at,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                            'innings', s.innings, 'runs', s.runs, 'wickets', s.wickets, 'balls', s.legal_balls,
                            'side', (SELECT x.value->>'side' FROM jsonb_array_elements(r.innings) x
                                      WHERE (x.value->>'innings')::integer = s.innings
                                        AND x.value->>'side' IN ('home', 'away') LIMIT 1))
                            ORDER BY s.innings)
                     FROM match_live_score s
                    WHERE s.match_id = l.id), '[]'::jsonb),
         CASE WHEN r.outcome IS NULL THEN NULL ELSE jsonb_build_object(
           'outcome', r.outcome, 'margin_kind', r.margin_kind, 'margin', r.margin, 'decided_by', r.decided_by,
           'winner_side', r.winner_side, 'play_outcome', r.play_outcome, 'play_winner_side', r.play_winner_side,
           'play_margin_kind', r.play_margin_kind, 'play_margin', r.play_margin,
           'decision_applied', r.decision_applied, 'decision_kind', r.decision->>'kind',
           'decision_side', r.decision->>'side', 'decision_overrides_play', (r.decision->>'overrides_play')::boolean,
           'super_overs', coalesce((SELECT jsonb_agg(jsonb_build_object('n', p.value->'n', 'state', p.value->'state',
                                                                        'first', p.value->'first', 'winner', p.value->'winner')
                                                     ORDER BY (p.value->>'n')::integer)
                                      FROM jsonb_array_elements(r.super_overs) p), '[]'::jsonb)) END,
         to_char(sa_today(), 'YYYY-MM-DD')
    FROM listed l
    JOIN school hs ON hs.id = l.school_id
    LEFT JOIN school aws ON aws.id = l.away_school_id
    LEFT JOIN LATERAL match_result_compute(l.id) r ON true
   ORDER BY (l.status = 'live') DESC, l.starts_at, l.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_live_fixtures() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_live_fixtures() TO scrbrd_app;


-- ── 3 · "At once": a school switching listing drops the cache ──────
DROP TRIGGER IF EXISTS public_data_changed ON public_listing;
CREATE TRIGGER public_data_changed AFTER INSERT OR UPDATE OR DELETE ON public_listing
  FOR EACH ROW EXECUTE FUNCTION public_data_notify('school', 'school_id');


-- ── Who may call these: the application, and nobody else ──────────
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['public_listing_set(uuid,boolean)', 'public_school_listed(uuid)',
                               'public_live_fixtures()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON TABLE public_listing FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  v_cols text;
  n int;
BEGIN
  FOREACH f IN ARRAY ARRAY['public_listing_set(uuid,boolean)', 'public_live_fixtures()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/82: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/82: the application cannot call %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public_listing_set(uuid,boolean)', 'public_school_listed(uuid)', 'public_live_fixtures()'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/82: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(r.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/82: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  -- The internal helper is the owner's alone, and is not a definer.
  IF has_function_privilege('scrbrd_app', 'public_school_listed(uuid)'::regprocedure, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public_school_listed(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/82: public_school_listed() is callable by the application, or is a definer';
  END IF;
  -- The application writes the switch only through its door.
  IF has_table_privilege('scrbrd_app', 'public_listing', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'public_listing', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'public_listing', 'DELETE') THEN
    RAISE EXCEPTION 'db/82: the application can write public_listing directly';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public_listing'::regclass) THEN
    RAISE EXCEPTION 'db/82: public_listing has no row-level security';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'public_listing'
                    AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/82: public_listing has no RESTRICTIVE pad_scope_select (db/50)';
  END IF;
  -- Off by default.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'public_listing' AND column_name = 'listed') <> 'false' THEN
    RAISE EXCEPTION 'db/82: listing does not default to off';
  END IF;

  -- The read returns no ground, no person and no column §3 forbids, by name.
  SELECT string_agg(a.name, ',') INTO v_cols
    FROM pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) AS a(name, mode)
   WHERE p.oid = 'public_live_fixtures()'::regprocedure
     AND a.mode = 't'
     AND (a.name ~ '(ground|venue|toss|official|umpire|player|born|reason|payload|scorer|device)'
          OR a.name IN ('home_team', 'away_team', 'ground_id'));
  IF v_cols IS NOT NULL THEN
    RAISE EXCEPTION 'db/82: the live read returns %', v_cols;
  END IF;

  -- The notifier is on the switch.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                  WHERE g.tgrelid = 'public_listing'::regclass AND g.tgname = 'public_data_changed'
                    AND g.tgfoid = 'public_data_notify()'::regprocedure AND NOT g.tgisinternal) THEN
    RAISE EXCEPTION 'db/82: public_listing has no public_data_changed trigger';
  END IF;

  -- Nothing unlisted or unpublished is answered: every row belongs to a
  -- fixture with a published side whose school lists.
  SELECT count(*) INTO n
    FROM public_live_fixtures() x JOIN match m ON m.id = x.match_id
   WHERE NOT ((fixture_side_published(m.id, 'home') AND public_school_listed(m.school_id))
              OR (fixture_side_published(m.id, 'away') AND public_school_listed(m.away_school_id)));
  IF n <> 0 THEN
    RAISE EXCEPTION 'db/82: the live read answered % fixtures nobody listed', n;
  END IF;
END $check$;
