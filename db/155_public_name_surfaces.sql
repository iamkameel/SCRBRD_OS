-- ══════════════════════════════════════════════════════════════════
--  155 · Public by terms, slice 3: surfaces and the no
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/PUBLIC_BY_TERMS.md (approved by Kameel, 11 Nov
-- 2026; "Build 1-8, switched off", 12 Nov), §11 row 3: "the `surface`
-- column and index; `public_name_facts()` 4-argument ...;
-- `public_name_consent_set()` per surface; `public_match_people()` and the
-- API caller moved; live or card by fixture status; md5 guards." The rule
-- it feeds is slice 2's publicName() (packages/policy/src/public.mjs,
-- surfaceStands(): §5.1 lines 1-7), unchanged here. The design's number
-- for this file, db/149, was taken by the stream caption before it was
-- built; this is db/155 (db/154 is another build's).
--
-- ── IT SHIPS DARK ──────────────────────────────────────────────────
-- With the switch below off, every public read answers byte for byte what
-- it answered before this file: the live page, the scorecard, the big
-- screen (db/153), a publication's count, a family's consent screen. Every
-- existing caller reaches the same body through the same signature, and
-- every row on the record today is the old single wording (surface NULL),
-- which those bodies read exactly as db/116 and db/59 did. The proof is
-- db/99 §132 (dark): db/116's and db/59's bodies, held verbatim by their
-- shipped md5s, against the live functions over every player, side, day
-- and match the verifier has made by then.
--
-- THE SWITCH is a feature_flag row, `public_name_surfaces`, seeded off and
-- locked (db/08: "a FEATURE that arrives switched on has not been decided
-- about"; locked, so no school grant can move it: it is the platform's,
-- one setting, written through db/08's logged door under
-- platform.feature.manage). Off, public_name_surface() answers NULL and
-- every read runs as before. On, the public match page and a publication's
-- count judge each name by §5.1 for the surface the fixture's status gives:
-- `live` while play is on (status 'live'), `card` otherwise. Turning it on
-- can never name a child the old rule does not: §5.1 lines 1-5 are the old
-- rule's checks with three narrowings (a no outlives its giver's link, B2;
-- a yes needs its giver live today, B2; a no nobody counted still stops the
-- default, Reading 3), and line 6 cannot fire, because `byTerms` is a
-- literal false until slice 4 builds the platform setting, the school's
-- basis and the by-terms record, and the public page passes no
-- `byTermsAllowed`. Slice 4 replaces the switch with its platform setting.
--
-- ── A DEVIATION FROM §11 (the lead's decision, 13 Nov 2026) ────────
-- §6.2 and §11 drop the 3-argument public_name_facts(uuid,text,date). This
-- file keeps it, as a thin wrapper that calls the 4-argument form with no
-- surface (today's behaviour). The reason: db/153, live on both databases
-- and frozen, calls the 3-argument form at :140 (its needs-check), :153 and
-- :219 (ground_screen_names()), as do publication-api.mjs:59 before this
-- file, the grant and search-path loops of db/47, db/62 and db/116, and
-- some twenty db/99 calls. Dropping it would break a shipped file's body
-- and its re-paste; keeping it as the same signature over one body keeps
-- every caller byte-identical. The two API callers §11 names move onto the
-- 4-argument form (below). The same is done, for the same reason, with
-- public_name_consent_set()'s 6-argument form (db/47's grants, db/116's
-- loops, the family's write route) and public_match_people(uuid) (db/153's
-- needs-check and ground_screen_names()).
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   public_name_consent
--     + surface text NULL, CHECK IN ('card','live','board') (§6.1). NULL is
--       the old single wording (`public-names-2026-10`, "public match
--       pages"). Existing rows are left NULL and nothing is backfilled, so
--       no old answer is reinterpreted by a migration.
--     ~ public_name_consent_one_open rebuilt on (player_id, giver_link_id,
--       coalesce(surface, 'old')) WHERE ended_on IS NULL: one open record per
--       giver per wording. Every row today is NULL, so the rebuild refuses
--       nothing the old index allowed and allows nothing it refused.
--       The paste takes the table's lock for one statement each (ADD COLUMN
--       with no default, ADD CONSTRAINT on an empty column, CREATE INDEX on
--       a small table); lock_timeout is 10 s, and a paste that is not granted
--       the lock stops and changes nothing: paste it again.
--   feature_flag
--     + public_name_surfaces (feature, off, locked): the switch above.
--   + public_name_facts(player uuid, side text, on date, surface text)
--       surface NULL: today's answer, exactly (db/116's body; its rows read
--         are the old wording's, plus a no given to one surface's wording
--         as a no on its day, so a no written while the reads are on and
--         then switched off still stops a name: the old rule has one
--         wording, so such a no stops all of it). Three keys: consents,
--         neverPublic, namesOff.
--       surface card, live or board: §5.1's facts for that surface. Each
--         giver's latest act per wording that can reach it (the old
--         wording's, and this surface's own: DISTINCT ON (giver_link_id,
--         surface)), each with
--           competent  on the day it was given, and nothing later (B2): the
--                      link verified by then and in its dates then, the
--                      giver the right kind for the boy's age then. Not the
--                      link's state today: revoked, dated out, replaced or
--                      an account disabled since does not unmake a no
--           giverLive  db/122's consent_giver_live() of its giver today:
--                      only a yes needs it (publicName() reads it so)
--           surface    its wording: NULL (old) or the surface
--           adult      a pupil's record only: he was eighteen that day
--         and byTerms, literally false (slice 4 works out line 6). Four
--         keys. No date of birth, giver, reason or version leaves it.
--       Any other surface raises (22023), as publicName() refuses one.
--   ~ public_name_facts(uuid, text DEFAULT NULL, date DEFAULT sa_today())
--       db/116's signature over the 4-argument body with no surface. Its
--       grants are db/47's and CREATE OR REPLACE keeps them.
--   + public_name_consent_set(player, yes, version, guardian, form_name,
--       form_date, surface)
--       db/116's door, line for line, with a surface: NULL is the old
--       wording (the only one the family's screen writes until slice 6); a
--       surface other than card, live or board is refused, no_such_surface.
--       The open record it supersedes or withdraws is the giver's open one
--       FOR THIS WORDING (§6.2, db/116:406), so a no to `board` never ends
--       a yes to the old wording, nor the other way round. The pupil's
--       branch is db/116's, unchanged: his no from twelve, his yes from
--       eighteen, on any wording. No defaults, so no call can be read two
--       ways.
--   ~ public_name_consent_set(uuid, boolean, text, uuid DEFAULT NULL,
--       text DEFAULT NULL, date DEFAULT NULL)
--       db/47's signature over the 7-argument door with no surface. The
--       family's write route (public-name-api.mjs) calls it as before.
--   + public_match_people(match uuid, surface text)
--       db/59's read, line for line, its facts the 4-argument form's for
--       the surface given (NULL: today's).
--   ~ public_match_people(uuid)
--       db/59's signature over the 2-argument read with no surface: what
--       db/153's ground_screen_names() and its needs-check read. The big
--       screen is the school's own scoreboard (§2.5), and stays on it.
--   + public_name_surface(match uuid) → text
--       NULL while the switch is off (and for no such fixture); else `live`
--       while play is on, `card` once it is not (§1.1: "The moment it
--       completes, the same page is the scorecard and the card rule
--       applies").
--   The API (same change): public-api.mjs's log reads public_match_people(
--   match, public_name_surface(match)) and passes the surface to
--   publicName() through redact.mjs nameFor(); publication-api.mjs's count
--   reads the same, and the 4-argument facts for a boy on the sheet; the
--   family's read of its own answer reads the old wording's records only.
--   No capability, role, bundle or policy changes.
--
-- THE GUARD keys on pg_proc.prosrc as db/128, db/146 and db/149 do: the md5
-- of each body this file replaces, whitespace folded, must be the shipped
-- one (db/116's, db/59's) or this file's; each body this file adds must be
-- absent or this file's. A body moved by another file since stops the
-- paste. A second paste changes nothing. No file before this one that reads
-- these bodies (db/153's needs-check reads the 3-argument signature and the
-- `neverPublic` key, both kept) is broken by it.
--
-- Its proof is db/99 §132; the walks are smoke-public-name, smoke-public,
-- smoke-browser-public-name, smoke-browser-public and
-- smoke-browser-public-live, unchanged.

CREATE OR REPLACE FUNCTION pg_temp._v155_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

-- ── 0 · What this file was written against ─────────────────────────
DO $guard$
DECLARE r record; v text;
BEGIN
  IF to_regclass('public_name_consent') IS NULL OR to_regclass('player_never_public') IS NULL
     OR to_regclass('public_names_off') IS NULL OR to_regclass('feature_flag') IS NULL
     OR to_regclass('match') IS NULL OR to_regclass('ball_event') IS NULL
     OR to_regprocedure('public_name_live_link(uuid,uuid,text)') IS NULL
     OR to_regprocedure('consent_giver_live(uuid,uuid,timestamptz)') IS NULL
     OR to_regprocedure('feature_enabled(text)') IS NULL
     OR to_regprocedure('majority_on(date)') IS NULL OR to_regprocedure('still_at_school(uuid)') IS NULL
     OR to_regprocedure('birth_age_group(date,date)') IS NULL OR to_regprocedure('team_age_group(text)') IS NULL
     OR to_regprocedure('fixture_side_published(uuid,text)') IS NULL
     OR to_regprocedure('public_fixture_served(uuid)') IS NULL
     OR to_regprocedure('public_ref_uuid(text)') IS NULL OR to_regprocedure('public_json_array(jsonb)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL THEN
    RAISE EXCEPTION 'db/155: the public name rule (db/47, db/116), the public read path (db/59), the lapsed-consent test (db/122) or the feature switches (db/08) is missing; apply every file before this one (through db/153) first';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'public_name_consent' AND column_name = 'surface'
                AND data_type <> 'text') THEN
    RAISE EXCEPTION 'db/155: public_name_consent.surface is there and is not text; look before pasting';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      -- The bodies replaced: the shipped one (db/116's, db/59's), or this file's.
      ('public_name_facts(uuid,text,date)', 'b0e0f3c15f891e2c862c310c4c7dbb45', 'dc920c0a2a8887ba2653d76981d30218', true),
      ('public_name_consent_set(uuid,boolean,text,uuid,text,date)', 'b39a68ab76e425f51a76ba0881c560a7', '1d29900b929f9ce256c6e2b003c9558e', true),
      ('public_match_people(uuid)', '7ff11b3fe1bf34d2bc802c01946a6871', '9eaf0820a9262868e5f704104ed91e89', true),
      -- The bodies added: absent, or this file's.
      ('public_name_facts(uuid,text,date,text)', NULL, '6f824f307ad0f5c35c13dc2415954075', false),
      ('public_name_consent_set(uuid,boolean,text,uuid,text,date,text)', NULL, 'b9213df6600dfc50bc2bf1896f5397ec', false),
      ('public_match_people(uuid,text)', NULL, 'ec7899e97920da22bfaf083f4ae4a0cd', false),
      ('public_name_surface(uuid)', NULL, 'c5d8a36f8b085d7de499c2631041f993', false)
    ) t(fn, was, mine, needed)
  LOOP
    SELECT pg_temp._v155_fold(p.prosrc) INTO v FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v IS NULL AND r.needed THEN
      RAISE EXCEPTION 'db/155: % is not there to replace; apply db/116 and db/59 first', r.fn;
    END IF;
    IF v IS NOT NULL AND v IS DISTINCT FROM r.was AND v <> r.mine THEN
      RAISE EXCEPTION 'db/155: % is not % (md5 % of its folded body); look before replacing it', r.fn,
        CASE WHEN r.was IS NULL THEN 'this file''s' ELSE 'the shipped body or this file''s' END, v;
    END IF;
  END LOOP;
END $guard$;


-- ── 1 · The wording each answer was given to (§6.1) ─────────────────
ALTER TABLE public_name_consent ADD COLUMN IF NOT EXISTS surface text;
COMMENT ON COLUMN public_name_consent.surface IS
  'PUBLIC_BY_TERMS §6.1 (db/155): the surface this answer''s wording named, card, live or board. NULL is the old single wording (public-names-2026-10, "public match pages"): its yes names card and live, never board; its no covers all three (§5.1 line 5, B1).';

DO $surface$
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public_name_consent'::regclass AND conname = 'public_name_consent_surface') THEN
    ALTER TABLE public_name_consent ADD CONSTRAINT public_name_consent_surface
      CHECK (surface IN ('card', 'live', 'board'));
  END IF;
  -- One open record per giver per wording. The old index (db/47:245) is
  -- rebuilt only where it is still the old one.
  IF coalesce((SELECT position('COALESCE(surface' IN pg_get_indexdef(i.indexrelid)) = 0
                 FROM pg_index i WHERE i.indexrelid = to_regclass('public_name_consent_one_open')), true) THEN
    DROP INDEX IF EXISTS public_name_consent_one_open;
    CREATE UNIQUE INDEX public_name_consent_one_open
      ON public_name_consent (player_id, giver_link_id, coalesce(surface, 'old')) WHERE ended_on IS NULL;
  END IF;
END $surface$;


-- ── 2 · The switch ─────────────────────────────────────────────────
INSERT INTO feature_flag (key, kind, label, enabled, locked, reason) VALUES
  ('public_name_surfaces', 'feature', 'Public names by surface', false, true,
   'PUBLIC_BY_TERMS slice 3 (db/155): the public match page judges each name for its surface (live while play is on, '
   'the scorecard after), by the per-surface rule. Off and locked: built switched off (Kameel, 12 Nov 2026), and '
   'on only by the platform, never a school, once the red-team and Kameel say so. Slice 4''s platform setting replaces it.')
ON CONFLICT (key) DO NOTHING;


-- ── 3 · The facts, for a surface (§6.2) ────────────────────────────
CREATE OR REPLACE FUNCTION public_name_facts(p_player uuid, p_side text, p_on date, p_surface text)
RETURNS jsonb AS $$
BEGIN
  IF p_surface IS NOT NULL AND p_surface NOT IN ('card', 'live', 'board') THEN
    RAISE EXCEPTION 'public_name_facts: % is not a surface (card, live or board): PUBLIC_BY_TERMS §1.1', p_surface
      USING ERRCODE = '22023';
  END IF;

  IF p_surface IS NULL THEN
    -- Today's answer: db/116's body. The records it reads are the old
    -- wording's, each giver's latest; and a no given to one surface's
    -- wording (a refusal, or a yes since withdrawn), each giver's latest per
    -- wording, as a refusal on the day it was said. Every row on the record
    -- before db/155 is the old wording's, so this is db/116's answer.
    RETURN (
  SELECT jsonb_build_object(
    'consents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'by',        x.given_by,
               'competent', x.competent,
               'givenOn',   to_char(x.given_on, 'YYYY-MM-DD'),
               'endedOn',   to_char(x.ended_on, 'YYYY-MM-DD'))
             ORDER BY x.given_on, x.seq)
        FROM (
          SELECT y.seq, y.given_by,
                 CASE WHEN y.surface IS NULL THEN y.given_on ELSE y.ended_on END AS given_on,
                 y.ended_on, y.competent
            FROM (
          SELECT DISTINCT ON (c.giver_link_id, c.surface)
                 c.seq, c.given_by, c.given_on, c.ended_on, c.surface,
                 coalesce(
                   g.verification_state = 'verified'
                   AND g.valid_from <= c.given_on
                   AND (g.valid_until IS NULL OR g.valid_until > c.given_on)
                   AND g.verified_at IS NOT NULL
                   AND (g.verified_at AT TIME ZONE 'Africa/Johannesburg')::date <= c.given_on
                   AND CASE c.given_by
                         WHEN 'guardian' THEN a.role = 'guardian' AND g.relationship IS DISTINCT FROM 'self'
                                              AND (p.born IS NULL OR c.given_on < majority_on(p.born)
                                                   OR (c.end_reason = 'refused' AND c.ended_on = c.given_on
                                                       AND EXISTS (
                                                         SELECT 1 FROM team_membership m
                                                           JOIN school s ON s.id = m.school_id AND s.kind = 'school'
                                                          WHERE m.player_id = p.id
                                                            AND m.joined_on <= c.given_on
                                                            AND (m.left_on IS NULL OR m.left_on > c.given_on))))
                         WHEN 'pupil'    THEN a.role = 'selfaccess' AND g.relationship = 'self'
                                              AND p.born IS NOT NULL
                                              AND (majority_on(p.born) <= c.given_on
                                                   OR (c.end_reason = 'refused' AND c.ended_on = c.given_on
                                                       AND (p.born + interval '12 years')::date <= c.given_on))
                       END, false) AS competent
            FROM public_name_consent c
            JOIN assignment_subject g ON g.id = c.giver_link_id AND g.assignment_id = c.giver_assignment_id
                                     AND g.player_id = c.player_id
            JOIN role_assignment a ON a.id = c.giver_assignment_id
           WHERE c.player_id = p.id
           ORDER BY c.giver_link_id, c.surface, c.seq DESC
            ) y
           WHERE y.surface IS NULL OR y.ended_on IS NOT NULL
        ) x), '[]'::jsonb),
    'neverPublic', EXISTS (
      SELECT 1 FROM player_never_public m
       WHERE m.player_id = p.id AND (m.ended_on IS NULL OR m.ended_on > p_on)),
    'namesOff', EXISTS (
      SELECT 1 FROM public_names_off o
       WHERE o.school_id = p.school_id AND o.names_off
         AND (o.age_group IN (birth_age_group(p.born, p_on), team_age_group(p.team_code), team_age_group(p_side))
              OR p.born IS NULL)))
    FROM player p
   WHERE p.id = p_player);
  END IF;

  -- §5.1's facts for one surface.
  RETURN (
  SELECT jsonb_build_object(
    'consents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'by',        x.given_by,
               'competent', x.competent,
               'givenOn',   to_char(x.given_on, 'YYYY-MM-DD'),
               'endedOn',   to_char(x.ended_on, 'YYYY-MM-DD'),
               'surface',   x.surface,
               'giverLive', x.giver_live)
               || CASE WHEN x.given_by = 'pupil' THEN jsonb_build_object('adult', x.adult) ELSE '{}'::jsonb END
             ORDER BY x.given_on, x.seq)
        FROM (
          SELECT DISTINCT ON (c.giver_link_id, c.surface)
                 c.seq, c.given_by, c.given_on, c.ended_on, c.surface,
                 -- B2: competent on the day it was given. The link verified
                 -- by then and in its dates then; never its state today.
                 coalesce(
                   g.valid_from <= c.given_on
                   AND (g.valid_until IS NULL OR g.valid_until > c.given_on)
                   AND g.verified_at IS NOT NULL
                   AND (g.verified_at AT TIME ZONE 'Africa/Johannesburg')::date <= c.given_on
                   AND CASE c.given_by
                         WHEN 'guardian' THEN a.role = 'guardian' AND g.relationship IS DISTINCT FROM 'self'
                                              AND (p.born IS NULL OR c.given_on < majority_on(p.born)
                                                   OR (c.end_reason = 'refused' AND c.ended_on = c.given_on
                                                       AND EXISTS (
                                                         SELECT 1 FROM team_membership m
                                                           JOIN school s ON s.id = m.school_id AND s.kind = 'school'
                                                          WHERE m.player_id = p.id
                                                            AND m.joined_on <= c.given_on
                                                            AND (m.left_on IS NULL OR m.left_on > c.given_on))))
                         WHEN 'pupil'    THEN a.role = 'selfaccess' AND g.relationship = 'self'
                                              AND p.born IS NOT NULL
                                              AND (majority_on(p.born) <= c.given_on
                                                   OR (c.end_reason = 'refused' AND c.ended_on = c.given_on
                                                       AND (p.born + interval '12 years')::date <= c.given_on))
                       END, false) AS competent,
                 -- B2: only a yes needs its giver live, and live TODAY.
                 coalesce(consent_giver_live(a.person_id, c.player_id, c.recorded_at), false) AS giver_live,
                 coalesce(p.born IS NOT NULL AND majority_on(p.born) <= c.given_on, false) AS adult
            FROM public_name_consent c
            JOIN assignment_subject g ON g.id = c.giver_link_id AND g.assignment_id = c.giver_assignment_id
                                     AND g.player_id = c.player_id
            JOIN role_assignment a ON a.id = c.giver_assignment_id
           WHERE c.player_id = p.id
             -- The wordings that can reach this surface: the old one, and its own.
             AND (c.surface IS NULL OR c.surface = p_surface)
           ORDER BY c.giver_link_id, c.surface, c.seq DESC
        ) x), '[]'::jsonb),
    'neverPublic', EXISTS (
      SELECT 1 FROM player_never_public m
       WHERE m.player_id = p.id AND (m.ended_on IS NULL OR m.ended_on > p_on)),
    'namesOff', EXISTS (
      SELECT 1 FROM public_names_off o
       WHERE o.school_id = p.school_id AND o.names_off
         AND (o.age_group IN (birth_age_group(p.born, p_on), team_age_group(p.team_code), team_age_group(p_side))
              OR p.born IS NULL)),
    -- §5.1 line 6. Slice 4 works it out; until then nobody is public by terms.
    'byTerms', false)
    FROM player p
   WHERE p.id = p_player);
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/116's signature, over the one body, with no surface.
CREATE OR REPLACE FUNCTION public_name_facts(p_player uuid, p_side text DEFAULT NULL,
                                             p_on date DEFAULT sa_today())
RETURNS jsonb AS $$
  SELECT public_name_facts(p_player, p_side, p_on, NULL::text)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/47's and CREATE OR REPLACE keeps them.


-- ── 4 · The door, per surface (§6.2) ───────────────────────────────
-- db/116's body, line for line, with p_surface: its check, the open record
-- looked up for this wording, and the wording written on every row.
CREATE OR REPLACE FUNCTION public_name_consent_set(
  p_player    uuid,
  p_yes       boolean,
  p_version   text,
  p_guardian  uuid,
  p_form_name text,
  p_form_date date,
  p_surface   text
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_school uuid;
  v_born   date;
  v_by     text;
  v_asg    uuid;
  v_link   uuid;
  v_today  date := sa_today();
  v_open   public_name_consent%ROWTYPE;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  p_form_name := nullif(btrim(p_form_name), '');
  IF p_yes IS NULL THEN RETURN QUERY SELECT false, 'no_answer'; RETURN; END IF;
  IF p_version IS NULL OR btrim(p_version) = '' THEN
    RETURN QUERY SELECT false, 'no_consent_version'; RETURN;
  END IF;
  -- §1.1: the three surfaces, or NULL for the old wording. Nothing else is a
  -- surface a public-name answer can reach (must-never 7).
  IF p_surface IS NOT NULL AND p_surface NOT IN ('card', 'live', 'board') THEN
    RETURN QUERY SELECT false, 'no_such_surface'; RETURN;
  END IF;
  SELECT p.school_id, p.born INTO v_school, v_born FROM player p WHERE p.id = p_player;
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;

  IF p_guardian IS NULL THEN
    -- The caller answers for himself. A form is the office's evidence, not his.
    IF p_form_name IS NOT NULL OR p_form_date IS NOT NULL THEN
      RETURN QUERY SELECT false, 'form_is_for_the_office'; RETURN;
    END IF;
    SELECT l.assignment_id, l.link_id INTO v_asg, v_link
      FROM public_name_live_link(app_user_id(), p_player, 'guardian') l;
    IF v_link IS NOT NULL THEN
      -- From his eighteenth birthday a guardian may take his name off while
      -- he is at school, and never put it on (option C).
      IF v_born IS NOT NULL AND majority_on(v_born) <= v_today THEN
        IF p_yes THEN RETURN QUERY SELECT false, 'adult_consents_for_himself'; RETURN; END IF;
        IF NOT still_at_school(p_player) THEN
          RETURN QUERY SELECT false, 'player_is_an_adult'; RETURN;
        END IF;
      END IF;
      v_by := 'guardian';
    ELSE
      SELECT l.assignment_id, l.link_id INTO v_asg, v_link
        FROM public_name_live_link(app_user_id(), p_player, 'selfaccess') l;
      IF v_link IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
      -- His "yes" counts from eighteen; his "no" from twelve (READERS Q7). An
      -- unknown date of birth is neither.
      IF p_yes AND (v_born IS NULL OR majority_on(v_born) > v_today) THEN
        RETURN QUERY SELECT false, 'not_yet_eighteen'; RETURN;
      END IF;
      IF NOT p_yes AND (v_born IS NULL OR (v_born + interval '12 years')::date > v_today) THEN
        RETURN QUERY SELECT false, 'not_yet_twelve'; RETURN;
      END IF;
      v_by := 'pupil';
    END IF;
  ELSE
    IF NOT app_can('guardian.link.manage', v_school, '*'::text,
                   '00000000-0000-0000-0000-000000000000'::uuid,
                   '00000000-0000-0000-0000-000000000000'::uuid) THEN
      RETURN QUERY SELECT false, 'not_permitted'; RETURN;
    END IF;
    SELECT l.assignment_id, l.link_id INTO v_asg, v_link
      FROM public_name_live_link(p_guardian, p_player, 'guardian') l;
    IF v_link IS NULL THEN RETURN QUERY SELECT false, 'no_verified_link'; RETURN; END IF;
    -- The office records her answer by the same rule as her own (option C).
    IF v_born IS NOT NULL AND majority_on(v_born) <= v_today THEN
      IF p_yes THEN RETURN QUERY SELECT false, 'adult_consents_for_himself'; RETURN; END IF;
      IF NOT still_at_school(p_player) THEN
        RETURN QUERY SELECT false, 'player_is_an_adult'; RETURN;
      END IF;
    END IF;
    IF (p_form_name IS NULL) <> (p_form_date IS NULL)
       OR (p_yes AND p_form_name IS NULL) THEN
      RETURN QUERY SELECT false, 'form_required'; RETURN;
    END IF;
    IF p_form_date > v_today THEN RETURN QUERY SELECT false, 'form_in_future'; RETURN; END IF;
    v_by := 'guardian';
  END IF;

  -- The giver's open record for THIS wording (one per wording: the index).
  SELECT * INTO v_open FROM public_name_consent c
   WHERE c.player_id = p_player AND c.giver_link_id = v_link AND c.ended_on IS NULL
     AND c.surface IS NOT DISTINCT FROM p_surface
   FOR UPDATE;

  IF p_yes THEN
    IF FOUND AND v_open.version = p_version THEN
      RETURN QUERY SELECT false, 'already_given'; RETURN;
    END IF;
    IF FOUND THEN
      UPDATE public_name_consent
         SET ended_on = v_today, end_reason = 'superseded', ended_by = app_user_id(), ended_at = now()
       WHERE id = v_open.id;
    END IF;
    INSERT INTO public_name_consent
      (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on,
       form_name, form_date, recorded_by, surface)
    VALUES (p_player, v_by, v_asg, v_link, p_version, v_today,
            p_form_name, p_form_date, app_user_id(), p_surface);
  ELSIF FOUND THEN
    UPDATE public_name_consent
       SET ended_on = v_today, end_reason = 'withdrawn', ended_by = app_user_id(), ended_at = now()
     WHERE id = v_open.id;
  ELSE
    INSERT INTO public_name_consent
      (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on, ended_on,
       end_reason, form_name, form_date, recorded_by, ended_by, ended_at, surface)
    VALUES (p_player, v_by, v_asg, v_link, p_version, v_today, v_today,
            'refused', p_form_name, p_form_date, app_user_id(), app_user_id(), now(), p_surface);
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/47's signature, over the one door, with no surface: the old wording.
CREATE OR REPLACE FUNCTION public_name_consent_set(
  p_player    uuid,
  p_yes       boolean,
  p_version   text,
  p_guardian  uuid DEFAULT NULL,
  p_form_name text DEFAULT NULL,
  p_form_date date DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text) AS $$
  SELECT s.ok, s.reason
    FROM public_name_consent_set(p_player, p_yes, p_version, p_guardian, p_form_name, p_form_date, NULL::text) s
$$ LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/47's and CREATE OR REPLACE keeps them.


-- ── 5 · The public page's people, for a surface ────────────────────
/**
 * db/59's read, line for line, its facts for `p_surface` (NULL: today's).
 * The per-side names-off probe reads only `namesOff`, which no surface
 * changes, so it asks the old form, as db/59 did.
 */
CREATE OR REPLACE FUNCTION public_match_people(p_match uuid, p_surface text)
RETURNS TABLE (
  player_id uuid, school_published boolean, facts jsonb,
  full_name text, surname text, known_as text, served_on text
) AS $$
  WITH refs AS (
    SELECT b.striker_id AS pid FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT b.non_striker_id FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT b.bowler_id FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT b.dismissed_id FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'striker') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'nonStriker') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'bowler') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'dismissed') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'fielder') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'batter') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(coalesce(e.member ->> 'id', e.member #>> '{}'))
            FROM ball_event b
            CROSS JOIN LATERAL jsonb_array_elements(public_json_array(b.payload -> 'squad')
                                                    || public_json_array(b.payload -> 'bowlingSquad')) AS e(member)
           WHERE b.match_id = p_match AND b.kind = 'innings_start'
  )
  SELECT p.id,
         coalesce(x.published, false),
         public_name_facts(p.id, x.team, sa_today(), p_surface)
           || jsonb_build_object('namesOff', coalesce(x.names_off, true)),
         p.full_name, p.surname, p.known_as,
         to_char(sa_today(), 'YYYY-MM-DD')
    FROM refs r
    JOIN player p ON p.id = r.pid
    JOIN match m ON m.id = p_match
    CROSS JOIN LATERAL (
      SELECT bool_and(fixture_side_published(m.id, s.side)) AS published,
             bool_or((public_name_facts(p.id, s.team, sa_today()) ->> 'namesOff')::boolean) AS names_off,
             min(s.team) AS team
        FROM (VALUES ('home', m.school_id, m.team_code),
                     ('away', m.away_school_id, m.away_team_code)) AS s(side, school, team)
       WHERE s.school = p.school_id
    ) x
   WHERE public_fixture_served(m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/59's signature, over the one read, with no surface.
CREATE OR REPLACE FUNCTION public_match_people(p_match uuid)
RETURNS TABLE (
  player_id uuid, school_published boolean, facts jsonb,
  full_name text, surname text, known_as text, served_on text
) AS $$
  SELECT x.player_id, x.school_published, x.facts, x.full_name, x.surname, x.known_as, x.served_on
    FROM public_match_people(p_match, NULL::text) x
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/59's and CREATE OR REPLACE keeps them.


-- ── 6 · Live or card, by the fixture's status (§1.1) ───────────────
/**
 * The surface a public match page names for: NULL while the switch is off
 * (every read then runs as before db/155), and for no such fixture; else
 * `live` while play is on and `card` once it is not. "While play is on is
 * the fixture's own status: from the first event until the match is
 * completed" (§1.1); a fixture scheduled, completed or abandoned is a
 * scorecard.
 */
CREATE OR REPLACE FUNCTION public_name_surface(p_match uuid) RETURNS text AS $$
  SELECT CASE WHEN m.status = 'live' THEN 'live' ELSE 'card' END
    FROM match m
   WHERE m.id = p_match AND feature_enabled('public_name_surfaces')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 7 · Grants ─────────────────────────────────────────────────────
-- The application's, and nobody else's. Not PUBLIC, and not a managed
-- host's API roles, which get EXECUTE on every new function by default
-- privilege (db/29, db/47). The three re-made signatures keep their grants
-- (CREATE OR REPLACE) and are held to the same below.
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public_name_facts(uuid,text,date,text)',
                           'public_name_consent_set(uuid,boolean,text,uuid,text,date,text)',
                           'public_match_people(uuid,text)', 'public_name_surface(uuid)',
                           'public_name_facts(uuid,text,date)',
                           'public_name_consent_set(uuid,boolean,text,uuid,text,date)',
                           'public_match_people(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
END $grants$;


-- ── 8 · After: refuse to commit a file that did not do what it says ──
DO $after$
DECLARE r text; f text; v jsonb; v_old jsonb; v_pl uuid;
BEGIN
  -- Every function: a definer with its path pinned (db/16), the
  -- application's to call, and nobody else's: every grant, not four names.
  FOREACH f IN ARRAY ARRAY['public_name_facts(uuid,text,date,text)',
                           'public_name_consent_set(uuid,boolean,text,uuid,text,date,text)',
                           'public_match_people(uuid,text)', 'public_name_surface(uuid)',
                           'public_name_facts(uuid,text,date)',
                           'public_name_consent_set(uuid,boolean,text,uuid,text,date)',
                           'public_match_people(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p
                    WHERE p.oid = f::regprocedure AND p.prosecdef
                      AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
      RAISE EXCEPTION 'db/155: % is not a definer with its search path pinned', f;
    END IF;
    IF has_function_privilege('public', f, 'EXECUTE') OR NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/155: % is executable by PUBLIC, or not by the application', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p
                CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = f::regprocedure AND a.grantee <> p.proowner
                  AND NOT (a.grantee = 'scrbrd_app'::regrole AND a.privilege_type = 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/155: % may be called by a role other than its owner and the application', f;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
        RAISE EXCEPTION 'db/155: % is executable by %', f, r;
      END IF;
    END LOOP;
  END LOOP;

  -- The three old signatures are the one body each, with no surface.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public_name_facts(uuid,text,date)'::regprocedure
                    AND regexp_replace(p.prosrc, '\s+', ' ', 'g') ~ '^ ?SELECT public_name_facts\(p_player, p_side, p_on, NULL::text\) ?$')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public_name_consent_set(uuid,boolean,text,uuid,text,date)'::regprocedure
                    AND position('public_name_consent_set(p_player, p_yes, p_version, p_guardian, p_form_name, p_form_date, NULL::text)' IN p.prosrc) > 0)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public_match_people(uuid)'::regprocedure
                    AND position('FROM public_match_people(p_match, NULL::text) x' IN p.prosrc) > 0) THEN
    RAISE EXCEPTION 'db/155: an old signature is not the one body with no surface';
  END IF;
  -- No call can be read two ways: the new forms take no defaults.
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid IN ('public_name_facts(uuid,text,date,text)'::regprocedure,
                              'public_name_consent_set(uuid,boolean,text,uuid,text,date,text)'::regprocedure,
                              'public_match_people(uuid,text)'::regprocedure)
                AND p.pronargdefaults > 0) THEN
    RAISE EXCEPTION 'db/155: a new form takes a default, so a call to the old one could be read as it';
  END IF;

  -- The column, its CHECK and the index.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public_name_consent'::regclass
                    AND c.conname = 'public_name_consent_surface' AND c.convalidated
                    AND pg_get_constraintdef(c.oid) ~ 'card.*live.*board')
     OR position('COALESCE(surface, ''old''::text)' IN
                 coalesce(pg_get_indexdef(to_regclass('public_name_consent_one_open')), '')) = 0
     OR position('WHERE (ended_on IS NULL)' IN coalesce(pg_get_indexdef(to_regclass('public_name_consent_one_open')), '')) = 0
     OR NOT (SELECT i.indisunique FROM pg_index i WHERE i.indexrelid = to_regclass('public_name_consent_one_open')) THEN
    RAISE EXCEPTION 'db/155: public_name_consent.surface, its CHECK or the one-open-per-wording index is not as this file makes it';
  END IF;

  -- The switch is there, a platform feature that no school grant moves.
  IF (SELECT row(kind, locked)::text FROM feature_flag WHERE key = 'public_name_surfaces') IS DISTINCT FROM '(feature,t)' THEN
    RAISE EXCEPTION 'db/155: the public_name_surfaces switch is missing, or not a locked feature';
  END IF;

  -- The shapes: today's three keys with no surface; four with one, byTerms
  -- false; an unknown surface refused.
  SELECT p.id INTO v_pl FROM player p ORDER BY p.id LIMIT 1;
  IF v_pl IS NOT NULL THEN
    v_old := public_name_facts(v_pl, NULL, sa_today());
    v := public_name_facts(v_pl, NULL, sa_today(), 'card');
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_old) k) IS DISTINCT FROM ARRAY['consents', 'namesOff', 'neverPublic']
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) k) IS DISTINCT FROM ARRAY['byTerms', 'consents', 'namesOff', 'neverPublic']
       OR v -> 'byTerms' IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION 'db/155: public_name_facts() does not answer the shapes this file says (% / %)', v_old, v;
    END IF;
    BEGIN
      PERFORM public_name_facts(v_pl, NULL, sa_today(), 'stream');
      RAISE EXCEPTION 'db/155: public_name_facts() answered a surface that is not one' USING ERRCODE = 'P0001';
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END IF;
END $after$;

DROP FUNCTION pg_temp._v155_fold(text);
