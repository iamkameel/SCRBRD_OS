-- ══════════════════════════════════════════════════════════════════
--  177 · A boy born on 29 February can be put on a team sheet: his
--        age at the cut-off, and his next birthday, as age() reads them
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel, 26 Nov 2026 (22:42): "count and fix". Production has
-- no such boy among the 11 with a date (26 Nov 2026), so nobody is blocked
-- today.
--
-- THE FAULT. Two places build a boy's birthday in a given year from the month
-- and the day of his date of birth:
--     make_date(year, extract(month FROM born), extract(day FROM born))
-- For a boy born on 29 February that is a day that does not exist in a year
-- with no 29 February, and make_date() raises "date field value out of range:
-- 2027-02-29" (22008).
--   * match_squad_age_eligible() (db/08:337; the trigger
--     match_squad_is_age_eligible, db/08:405), his age on 1 January of the
--     match's year. Putting him on the sheet of any age side (U9 to U16) in a
--     year that is not a leap year (2026, 2027 ...) fails with that raw error,
--     whoever writes the row. An open side has no limit and takes him; an
--     unknown date and a band above U16 are refused before the arithmetic,
--     as they were.
--   * player_band_change_due (db/08:453, as db/128 re-dated it), the boys
--     about to age up: his next birthday, twice, and his age at the cut-off
--     after it. The view computes them for every boy in an age side that the
--     reader may see, so one such boy makes the whole read fail: every
--     coach's list at his school (the API's band_changes), in any year but a
--     leap year before his birthday, and in that one too once he is within
--     its thirty days (his age after it reads 29 February of the next year).
-- No later file redefines either. The only other make_date() in the schema
-- built from a typed day is sa_id_born() (db/172), which checks the day first
-- ("Nested, so make_date() never sees a month that is not one"); it is left
-- alone. season_for() builds 1 January, 31 December, 1 July and 30 June.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
-- Only the age arithmetic. Everything else in each is as db/08 (and db/128)
-- left it: the 1 January cut-off, the open-team rule, the refusal above U16
-- and its representative-season comment, the unknown date's refusal, every
-- error message, SECURITY DEFINER, the pinned search_path, the owner and the
-- grants; the view's columns, its WITH options (security_barrier,
-- security_invoker), its 30-day window on sa_today() and its grants.
--   ~ match_squad_age_eligible(), patched by needle, guarded: his age is
--       extract(year FROM age(make_date(y, 1, 1)::timestamp, born::timestamp))
--       where y is the match's year, as before. age() compares month and day
--       and never builds his birthday, so a boy born on 29 February is 14 on
--       1 January 2027 and 15 on 1 January 2028. The ::timestamp casts keep
--       the session's time zone out of it (age() of two dates is otherwise
--       read as two instants). For every date of birth on or before the
--       cut-off the number is the one the old arithmetic gave (every day of
--       1990 to 2030 but 29 February, against match years 2000 to 2035:
--       357,731 pairs, none differ). For a date after it (a child not yet
--       born on 1 January) the two can differ by one, both 0 or below: both
--       pass every band, and the number is shown only in the refusal of a
--       boy over the limit.
--   ~ player_band_change_due, re-created, guarded: his birthday in a year is
--       the first of his month plus his day less one,
--           make_date(year, extract(month FROM born), 1) + (extract(day FROM born) - 1)
--       which is the day itself for every date but 29 February, and 1 March
--       in a year without one: the day age() first reads him a year older,
--       and the day packages/policy/src/teams.mjs's bandChangeAhead() names
--       (Date.UTC rolls 29 February over to 1 March). His age at the cut-off
--       after that birthday (next_band) is age()'s, as in the trigger.
-- Not here: majority_on() (db/08:885), the day a guardian's link ends, keeps
-- Postgres's clamp to 28 February ("moving it would be inventing a rule").
-- The view lists boys in an age side, so no row of it is an 18th birthday.
--
-- WHAT A PASTE CHANGES ON A LIVE DATABASE: no row of any table. A squad row
-- the trigger used to refuse with 22008 is now checked against the band like
-- any other; a squad row it took before is taken now, and one it refused
-- over the limit is refused with the same words and the same age. Nothing is
-- re-checked: the trigger runs on the next INSERT or UPDATE of a sheet row.
--
-- THE GUARD keys on the folded md5 (whitespace runs folded, as db/128 and
-- db/176 fold) of the trigger function's prosrc and of the view's
-- pg_get_viewdef(): each must be db/08's (the view: db/128's) or this file's.
-- Anything else stops the paste, changing nothing. A later paste of db/128
-- then stops at its own guard on the view, changing nothing (db/128: "No
-- file before this one can be pasted again after it where its guard reads
-- one of these bodies").
--
-- TO PASTE: after db/176, as the schema owner (the file refuses any other
-- role), in one transaction (no BEGIN or COMMIT here: the SQL Editor's single
-- run, or psql -1 -v ON_ERROR_STOP=1 -f), outside a match: replacing the
-- trigger function waits for no table, but re-creating the view waits on
-- every read of it (ten-second lock_timeout, reset by the last statement; a
-- paste that timed out on its lock is simply run again). Safe to paste twice:
-- a second paste finds both in place and changes nothing.
--
-- Its proof is db/99 §152.


-- ── 0a · Ten seconds for a lock, or nothing (db/168's pattern) ──────
SET lock_timeout = '10s';


-- ── 0 · What this file stands on ───────────────────────────────────
DO $guard$
BEGIN
  IF to_regprocedure('match_squad_age_eligible()') IS NULL OR to_regclass('player_band_change_due') IS NULL
     OR to_regprocedure('sa_today()') IS NULL THEN
    RAISE EXCEPTION 'db/177: match_squad_age_eligible() or player_band_change_due (db/08), or sa_today() (db/08), is missing; apply them first';
  END IF;
  IF NOT pg_has_role(current_user, (SELECT p.proowner FROM pg_proc p
                                     WHERE p.oid = 'match_squad_age_eligible()'::regprocedure), 'MEMBER')
     OR NOT pg_has_role(current_user, (SELECT c.relowner FROM pg_class c
                                        WHERE c.oid = 'player_band_change_due'::regclass), 'MEMBER') THEN
    RAISE EXCEPTION 'db/177: run this as the schema owner (current_user is %), not as the application', current_user;
  END IF;
  -- The trigger still calls it: BEFORE INSERT OR UPDATE, FOR EACH ROW.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'match_squad'::regclass AND t.tgname = 'match_squad_is_age_eligible'
                    AND t.tgfoid = 'match_squad_age_eligible()'::regprocedure AND t.tgtype = 23) THEN
    RAISE EXCEPTION 'db/177: match_squad_is_age_eligible is not db/08''s trigger on match_squad; look first';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION pg_temp._v177_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

-- Each body this file moves, as the file before it left it, or this file's
-- own (a second paste); and what the paste must not move, as it stands now.
DROP TABLE IF EXISTS pg_temp._v177_bodies;
CREATE TEMP TABLE _v177_bodies (what text PRIMARY KEY, was text, mine text, file text,
                                src text, cfg text, acl text, secdef boolean, vol "char", owner_ oid, opts text);
INSERT INTO _v177_bodies (what, was, mine, file, src, cfg, acl, secdef, vol, owner_)
SELECT 'match_squad_age_eligible()', 'bba8b9b819cf1597b34b9fc23b09212a', '4a931b22b7d64d74b13585e2c296c27f', 'db/08',
       p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef, p.provolatile, p.proowner
  FROM pg_proc p WHERE p.oid = 'match_squad_age_eligible()'::regprocedure;
INSERT INTO _v177_bodies (what, was, mine, file, src, acl, owner_, opts)
SELECT 'player_band_change_due', 'b18bf1b1b4ffd809b8664441f51cbdcd', '53b35f08bdbfb414c5840537dc443b86', 'db/128',
       pg_get_viewdef(c.oid), c.relacl::text, c.relowner, array_to_string(c.reloptions, ', ')
  FROM pg_class c WHERE c.oid = 'player_band_change_due'::regclass;

DO $bodies$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM _v177_bodies LOOP
    v := pg_temp._v177_fold(r.src);
    IF v NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/177: % is neither %''s nor this file''s (md5 % of its folded body); look before replacing it',
        r.what, r.file, v;
    END IF;
  END LOOP;
  IF (SELECT b.opts FROM _v177_bodies b WHERE b.what = 'player_band_change_due')
       IS DISTINCT FROM 'security_barrier=true, security_invoker=true' THEN
    RAISE EXCEPTION 'db/177: player_band_change_due is not the security_barrier, security_invoker view db/08 made; look first';
  END IF;
END $bodies$;


-- ── 1 · The squad check: his age on 1 January, as age() reads it ───
-- Patched by needle, from the catalog (pg_get_functiondef, as db/176 patches
-- role_request_grant_as()): the seven lines of arithmetic, and nothing else.
-- Rights, settings, volatility and owner are checked unchanged. A second
-- paste finds the patch in place.
DO $squad$
DECLARE
  v_needle constant text :=
       '  v_age := extract(year FROM make_date(extract(year FROM v_starts)::int, 1, 1))' || chr(10)
    || '         - extract(year FROM v_born)' || chr(10)
    || '         - CASE WHEN make_date(extract(year FROM v_starts)::int, 1, 1)' || chr(10)
    || '                     < make_date(extract(year FROM v_starts)::int,' || chr(10)
    || '                                 extract(month FROM v_born)::int,' || chr(10)
    || '                                 extract(day FROM v_born)::int)' || chr(10)
    || '                THEN 1 ELSE 0 END;' || chr(10);
  v_patch constant text :=
       '  -- db/177: his age on 1 January as age() reads it, from the month and' || chr(10)
    || '  -- the day, so a boy born on 29 February has one in a year without a' || chr(10)
    || '  -- 29 February (make_date() of his birthday that year raised). The same' || chr(10)
    || '  -- number for every date of birth on or before the cut-off.' || chr(10)
    || '  v_age := extract(year FROM age(make_date(extract(year FROM v_starts)::int, 1, 1)::timestamp,' || chr(10)
    || '                                 v_born::timestamp))::int;' || chr(10);
  v_fn constant text := 'match_squad_age_eligible()';
  b _v177_bodies%ROWTYPE; n int;
BEGIN
  SELECT * INTO b FROM _v177_bodies WHERE what = v_fn;
  IF position('-- db/177: ' IN b.src) > 0 THEN RETURN; END IF;   -- a second paste (§0 checked it is this file's)
  n := (length(b.src) - length(replace(b.src, v_needle, ''))) / length(v_needle);
  IF n <> 1 THEN
    RAISE EXCEPTION 'db/177: % holds its needle % times, not once: look before replacing it', v_fn, n;
  END IF;
  EXECUTE replace(pg_get_functiondef(v_fn::regprocedure), v_needle, v_patch);
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM replace(b.src, v_needle, v_patch)
     OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM b.cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM b.acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM b.secdef
     OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM b.vol
     OR (SELECT p.proowner FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM b.owner_ THEN
    RAISE EXCEPTION 'db/177: re-emitting % changed more than its age arithmetic', v_fn;
  END IF;
END $squad$;


-- ── 2 · The boys about to age up: his next birthday, and his age after it ──
-- db/08's view, on sa_today() as db/128 left it, with the birthday built as
-- the first of his month plus his day less one (1 March for 29 February in a
-- year without one: the day age() first reads him a year older), and his age
-- at the cut-off after it as age() reads it. Every other column, the window
-- and the options as they were; CREATE OR REPLACE keeps the grants.
CREATE OR REPLACE VIEW player_band_change_due
  WITH (security_barrier = true, security_invoker = true) AS
WITH upcoming AS (
  SELECT
    p.id AS player_id, p.school_id, p.full_name, p.team_code, p.born,
    substring(p.team_code FROM '^U([0-9]{1,2})')::int AS band,
    coalesce(substring(p.team_code FROM '^U[0-9]{1,2}([A-F])'), '') AS division,
    make_date(
      CASE WHEN make_date(extract(year FROM sa_today())::int,
                          extract(month FROM p.born)::int, 1)
                + (extract(day FROM p.born)::int - 1) < sa_today()
           THEN extract(year FROM sa_today())::int + 1
           ELSE extract(year FROM sa_today())::int END,
      extract(month FROM p.born)::int, 1)
      + (extract(day FROM p.born)::int - 1) AS next_birthday
  FROM player p
  WHERE p.born IS NOT NULL
    AND p.team_code ~ '^U[0-9]{1,2}'
),
aged AS (
  SELECT u.*,
         extract(year FROM u.next_birthday)::int - extract(year FROM u.born)::int AS turning,
         -- Their age at the cut-off AFTER that birthday. If it exceeds the band
         -- they are in, they age out of it for the coming season.
         extract(year FROM age(make_date(extract(year FROM u.next_birthday)::int + 1, 1, 1)::timestamp,
                               u.born::timestamp))::int AS band_next_season
    FROM upcoming u
)
SELECT
  a.player_id, a.school_id, a.full_name,
  a.team_code                              AS current_team,
  a.band                                   AS current_band,
  a.band_next_season                       AS next_band,
  a.next_birthday,
  a.turning,
  (a.next_birthday - sa_today())::int      AS days_until,
  -- The side or sides to trial them for.
  CASE WHEN a.band >= 16
       THEN ARRAY['1XI','2XI','3XI']
       ELSE ARRAY['U' || (a.band + 1)::text || a.division]
  END                                      AS trial_for
FROM aged a
WHERE a.band_next_season > a.band
  AND a.next_birthday >= sa_today()
  AND a.next_birthday <= sa_today() + 30;


-- ── 3 · Each is this file's now, and nothing else moved ────────────
DO $after$
DECLARE r record; v text; v_bad text;
BEGIN
  FOR r IN SELECT * FROM _v177_bodies LOOP
    v := pg_temp._v177_fold(CASE WHEN r.what = 'player_band_change_due'
                                 THEN pg_get_viewdef('player_band_change_due'::regclass)
                                 ELSE (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(r.what)) END);
    IF v IS DISTINCT FROM r.mine THEN
      RAISE EXCEPTION 'db/177: % is not this file''s after the paste (md5 %)', r.what, v;
    END IF;
  END LOOP;
  IF (SELECT c.relacl::text FROM pg_class c WHERE c.oid = 'player_band_change_due'::regclass)
       IS DISTINCT FROM (SELECT b.acl FROM _v177_bodies b WHERE b.what = 'player_band_change_due')
     OR (SELECT c.relowner FROM pg_class c WHERE c.oid = 'player_band_change_due'::regclass)
       IS DISTINCT FROM (SELECT b.owner_ FROM _v177_bodies b WHERE b.what = 'player_band_change_due')
     OR (SELECT array_to_string(c.reloptions, ', ') FROM pg_class c WHERE c.oid = 'player_band_change_due'::regclass)
       IS DISTINCT FROM 'security_barrier=true, security_invoker=true'
     OR NOT has_table_privilege('scrbrd_app', 'player_band_change_due', 'SELECT') THEN
    RAISE EXCEPTION 'db/177: player_band_change_due lost its options, its owner or its grants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'match_squad_age_eligible()'::regprocedure
                    AND p.prosecdef AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/177: match_squad_age_eligible() is not the SECURITY DEFINER with a pinned path it was';
  END IF;
  -- And no function or view in the schema builds a birthday from a date of
  -- birth's day any more: a make_date() whose day is extract(day FROM ...born).
  SELECT string_agg(x.what, ', ' ORDER BY x.what COLLATE "C") INTO v_bad FROM (
    SELECT p.oid::regprocedure::text AS what FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* ',\s*\(?extract\(day from [a-z_.]*born\)\)?(::int(eger)?)?\s*\)'
    UNION ALL
    SELECT 'view ' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
       AND pg_get_viewdef(c.oid) ~* ',\s*\(?extract\(day from [a-z_.]*born\)\)?(::int(eger)?)?\s*\)') x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'db/177: these still build a birthday from a date of birth''s day: %', v_bad;
  END IF;
END $after$;
DROP TABLE _v177_bodies;
DROP FUNCTION pg_temp._v177_fold(text);


-- ── 4 · The lock limit back as it was ──────────────────────────────
RESET lock_timeout;
