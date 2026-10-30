-- ══════════════════════════════════════════════════════════════════
--  125 · The union selector's list: the boys whose families named his
--        union, found by school or age group, every row a logged read
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Slice S1 of docs/design/UNION_SELECTOR_FIND.md (§10). db/124
-- opened a boy's passport to a named Union Selector by the boy's id, and
-- nothing listed the boys (db/124's U6: "a list later, as its own decision,
-- each read logged"). This is that list, and nothing past it: no route, no
-- screen, no playing styles (slice S5), no shortlist, no note.
--
-- Kameel's answers to the design's six questions (30 Oct 2026, 21:05 SAST,
-- the Build Board: "all six as recommended"):
--   Q1  A list appearance goes in the family's log; the boy under eighteen
--       sees it too, as he sees the opens (db/124 U4).
--   Q2  A selector who is also the boy's coach or parent: his list rows are
--       still logged as union reads. The list is reached only as a union.
--   Q3  consent_giver_live() moves onto sa_today() here, the child's side
--       only; app_can()'s clock waits for the schema-wide sweep.
--   Q4  Playing styles on the row: yes, in slice S5, not now. The row here is
--       the six columns the design names.
--   Q5  No shortlists or notes. No store is built.
--   Q6  A name search, only within the consented set; a miss looks the same
--       as a boy who does not exist.
--
-- Its proof is db/99 §102. Not to be pasted before it is reviewed.
--
-- ── 1 · THE LIST IS THE PASSPORT'S DOOR, ASKED FOR MANY BOYS AT ONCE ─
-- passport_union_list() returns a boy exactly when db/124's
-- passport_union_consent() test holds for the caller: a consent not
-- withdrawn, its giver's link live (consent_giver_live()), naming his own
-- union (school_union() of his school) or CSA Schools, neither archived, at
-- which the caller is a named reader (passport_union_reader_at(): held at
-- that institution, no team, no support session, no platform-wide
-- assignment, never on a pad). The test is written out here, word for word
-- as db/124 has it, and narrowed by the filters; nothing is stamped or
-- cached, so a row exists only while the passport would open (D1).
--   Filters (D2): a school or an age group, at least one; a call with
--   neither is refused (choose_a_school_or_age_group), so there is no
--   "everyone in the province". The age group is the leading "U15" of the
--   boy's side code (player.team_code), never his date of birth. A name
--   fragment narrows within that (Q6), matched as plain text, never as a
--   pattern.
--   Institution: p_org names one institution at which the caller reads; a
--   caller who does not read there is answered nothing. p_org NULL is the
--   design's "one list" for a reader at both his union and CSA Schools (D4):
--   one row per boy, under the consent passport_union_consent() itself would
--   choose (the earliest, by granted_at then id). With p_org given, the row's
--   consent is the earliest at that institution. Either way no row, header or
--   count says what the family chose for the other institution.
--   The row (D3): his id, his name (player.full_name, read as the owner: never
--   through passport_name(), which would log a second time), his school's
--   name, his side's code, the institution that admits him and the consent
--   that does. No figure, honour, cap, milestone, date of birth or style.
--   Ordered by school, then surname (the last word of the name), then the
--   whole name, case folded, under COLLATE "C" so both databases agree.
--
-- ── 2 · EVERY ROW SHOWN IS A LOGGED READ (D5, Q1, Q2) ───────────────
-- Before the list answers, passport_union_log_list() writes one
-- passport_union_read row per boy returned (what = 'list'; the reader's name
-- and his role at the admitting institution copied in, as db/124 §6 Q3; the
-- consent that admitted him), and one access_log row per school whose boys
-- were returned (log_restricted_read('passport_union', ids, '{list}',
-- school)), so the school's auditors see one event. The insert is not
-- caught: a list whose record cannot be written is not answered. The writer
-- is nobody's to call. The family reads the rows through db/124's
-- passport_union_reads(), unchanged: it returns `what` already.
--
-- ── 3 · THE CLOCK (Q3) ──────────────────────────────────────────────
-- consent_giver_live() asked current_date, the database's day (UTC on the
-- pilot's server), in its four link tests, so between 00:00 and 02:00 SAST a
-- link that ended "today" still read live. It now asks sa_today() in all
-- four, and nothing else in it moves. That closes db/124's Q5 for the
-- child's side; app_can() and the role lookup in the logs keep current_date
-- until the sweep of every current_date in the schema.
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   functions passport_union_orgs(), passport_union_schools(uuid),
--     passport_union_list(uuid,uuid,text,text): new definers, scrbrd_app's
--     alone
--   function passport_union_log_list(uuid[],uuid[]): new, nobody's to call
--   constraint passport_union_read_what_check (db/124): dropped and added
--     again taking 'list' beside 'passport' and 'name'; a brief lock on
--     passport_union_read while it re-checks the rows already there
--   function consent_giver_live(uuid,uuid,timestamptz) (db/124): body
--     replaced: sa_today() for current_date in its four link tests. On the
--     paste a link whose end date is today (SAST) stops counting from SAST
--     midnight, not from 02:00
-- No table, column, capability, role or policy. A second paste changes
-- nothing. db/124 cannot be pasted again after this file: its guard reads
-- consent_giver_live()'s new body as not its own, and refuses.


-- ── 0 · Refuse to run against what this file was not written for ───
DO $guard$
DECLARE r record; v_src text; v_md5 text; v_def text;
BEGIN
  IF to_regclass('passport_union_read') IS NULL OR to_regclass('passport_consent') IS NULL
     OR to_regprocedure('passport_union_reads()') IS NULL OR to_regprocedure('role_words(text)') IS NULL
     OR to_regprocedure('school_union(uuid)') IS NULL OR to_regprocedure('school_federation()') IS NULL
     OR to_regprocedure('log_restricted_read(text,uuid[],text[],uuid)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('sa_date(timestamptz)') IS NULL
     OR to_regprocedure('majority_on(date)') IS NULL
     OR to_regprocedure('guardian_link_reopened_since(uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'db/125: db/124''s union passport (passport_union_read, passport_union_reads(), guardian_link_reopened_since()), school_union() (db/57), log_restricted_read() or sa_today() is missing; apply them first';
  END IF;
  -- The three this file reads as db/124 wrote them, and the one it replaces.
  FOR r IN SELECT * FROM (VALUES
      ('passport_union_consent(uuid)',              'd3e4a5e61489746efc568f17be26ea53', 'd3e4a5e61489746efc568f17be26ea53'),
      ('passport_union_reader_at(uuid)',            '43826493881f12b2633ba38ef4cfbada', '43826493881f12b2633ba38ef4cfbada'),
      ('passport_union_log(uuid,uuid,text)',        'f726e7741c32c2d16c48d5d369001e17', 'f726e7741c32c2d16c48d5d369001e17'),
      ('consent_giver_live(uuid,uuid,timestamptz)', '77a2afe09e3720cf1975a58843db6cba', '656959c1dee1fb04db0625dabc6733c2'))
      AS x(fn, was, mine)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/125: % (db/124) is not there', r.fn;
    END IF;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/125: % is not db/124''s or this file''s (md5 % of its folded body); look before building on it', r.fn, v_md5;
    END IF;
  END LOOP;
  -- The log's CHECK is db/124's, or this file's widening of it.
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'passport_union_read'::regclass AND c.conname = 'passport_union_read_what_check';
  IF v_def IS NULL OR v_def NOT IN (
       'CHECK ((what = ANY (ARRAY[''passport''::text, ''name''::text])))',
       'CHECK ((what = ANY (ARRAY[''passport''::text, ''name''::text, ''list''::text])))') THEN
    RAISE EXCEPTION 'db/125: passport_union_read''s CHECK on what reads % — not db/124''s; look first', coalesce(v_def, '(missing)');
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · The log takes a list
-- ══════════════════════════════════════════════════════════════════
-- db/124 is live on both databases, so its CHECK is altered here, not
-- edited there. The rows already there are 'passport' or 'name' and pass.
ALTER TABLE passport_union_read DROP CONSTRAINT IF EXISTS passport_union_read_what_check;
ALTER TABLE passport_union_read ADD CONSTRAINT passport_union_read_what_check
  CHECK (what IN ('passport', 'name', 'list'));
COMMENT ON TABLE passport_union_read IS
  'Every read of a boy''s passport by a union''s named reader (db/124), and every appearance in a union''s list (db/125): who, which institution, when, which boy. Shown to his family by passport_union_reads().';


-- ══════════════════════════════════════════════════════════════════
-- §2 · Whose word counts, on the child's clock (Q3)
-- ══════════════════════════════════════════════════════════════════
/**
 * db/124's consent_giver_live(), its four link tests on sa_today() (the
 * child's clock, SAST) where they asked current_date (the database's day),
 * and nothing else moved: the boy's own word only if he was eighteen on the
 * day he gave it; a guardian's link reopened after it ended while he was
 * away is a fresh link. Internal: not a definer, granted to nobody.
 */
CREATE OR REPLACE FUNCTION consent_giver_live(p_giver uuid, p_player uuid, p_given_at timestamptz) RETURNS boolean AS $$
  SELECT p_giver IS NOT NULL AND EXISTS (
    SELECT 1 FROM role_assignment a
    JOIN assignment_subject s ON s.assignment_id = a.id
   WHERE a.person_id = p_giver AND a.active
     AND a.role IN ('guardian', 'selfaccess')
     AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
     AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
     AND (a.expires_at IS NULL OR a.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                      WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
     AND s.player_id = p_player AND s.verification_state = 'verified'
     AND s.valid_from <= sa_today()
     AND (s.valid_until IS NULL OR s.valid_until > sa_today())
     AND (a.role = 'guardian'
          -- His own word: eighteen on the day he gave it (db/124, (1)).
          OR EXISTS (SELECT 1 FROM player p WHERE p.id = s.player_id
                        AND p.born IS NOT NULL AND majority_on(p.born) <= sa_date(p_given_at)))
     AND a.created_at <= p_given_at AND s.created_at <= p_given_at
     -- A guardian's link reopened after it ended while he was away is a
     -- fresh link (db/124, (2)).
     AND NOT (a.role = 'guardian' AND guardian_link_reopened_since(s.player_id, p_given_at)))
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §3 · Where he reads, and the schools he may filter by
-- ══════════════════════════════════════════════════════════════════
/**
 * The institutions at which the caller reads as a union: his provincial
 * union, CSA Schools, or both, each only while passport_union_reader_at()
 * holds there. Empty for everyone else (an organiser, a union's office, a
 * platform-wide account, a support session, a pad).
 */
CREATE OR REPLACE FUNCTION passport_union_orgs()
RETURNS TABLE (org_id uuid, name text, kind text) AS $$
  SELECT o.id, o.name, o.kind
    FROM school o
   WHERE o.kind IN ('union', 'federation') AND o.archived_at IS NULL
     AND passport_union_reader_at(o.id)
   ORDER BY o.kind = 'federation', lower(o.name) COLLATE "C", o.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The schools a selector at p_org may filter by: those whose union is p_org
 * (school_union()), or every school for CSA Schools; none unless the caller
 * reads at p_org. A province's schools are public knowledge, and the role
 * holds school.read already; this names no boy.
 */
CREATE OR REPLACE FUNCTION passport_union_schools(p_org uuid)
RETURNS TABLE (school_id uuid, name text) AS $$
  SELECT s.id, s.name
    FROM school s
    JOIN school o ON o.id = p_org AND o.archived_at IS NULL
   WHERE s.kind = 'school' AND s.archived_at IS NULL
     AND ((o.kind = 'union' AND school_union(s.id) = o.id)
          OR (o.kind = 'federation' AND o.id = school_federation()))
     AND passport_union_reader_at(o.id)
   ORDER BY lower(s.name) COLLATE "C", s.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §4 · The list, and its record
-- ══════════════════════════════════════════════════════════════════
/**
 * Write the record of one list answer, before it answers. One
 * passport_union_read row per boy (what = 'list'), the reader's name and
 * his role at the admitting consent's institution copied in as db/124's
 * passport_union_log() copies them; one access_log row per school whose boys
 * were listed. Not caught: a row not recorded fails the list. The access-log
 * rows are log_restricted_read()'s, which never fails a read. Internal: not a
 * definer, granted to nobody.
 */
CREATE OR REPLACE FUNCTION passport_union_log_list(p_players uuid[], p_consents uuid[]) RETURNS void AS $$
DECLARE v_n int; v_want int := coalesce(array_length(p_players, 1), 0); r record;
BEGIN
  IF v_want = 0 THEN RETURN; END IF;
  IF coalesce(array_length(p_consents, 1), 0) <> v_want THEN
    RAISE EXCEPTION 'db/125: a union list of % boy(s) came with % consent(s)', v_want, coalesce(array_length(p_consents, 1), 0);
  END IF;
  INSERT INTO passport_union_read (player_id, reader_id, reader_name, reader_role, org_id, consent_id, what)
  SELECT x.player_id, u.id, u.name,
         (SELECT role_words(a.role)
            FROM role_assignment a
            JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'passport.union.read'
           WHERE a.person_id = u.id AND a.school_id = c.to_school_id AND a.active
             AND a.team_code IS NULL AND a.fixture_id IS NULL
             AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
             AND (a.valid_until IS NULL OR a.valid_until >  current_date)
             AND (a.expires_at IS NULL OR a.expires_at > now())
             AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                              WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
           ORDER BY a.role, a.created_at, a.id
           LIMIT 1),
         c.to_school_id, c.id, 'list'
    FROM unnest(p_players, p_consents) AS x(player_id, consent_id)
    JOIN passport_consent c ON c.id = x.consent_id AND c.player_id = x.player_id
    JOIN app_user u ON u.id = app_user_id();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_want THEN
    RAISE EXCEPTION 'db/125: a union list of % boy(s) recorded % row(s)', v_want, v_n;
  END IF;
  FOR r IN SELECT p.school_id, array_agg(p.id ORDER BY p.id) AS ids
             FROM player p WHERE p.id = ANY (p_players)
            GROUP BY p.school_id LOOP
    PERFORM log_restricted_read('passport_union', r.ids, ARRAY['list'], r.school_id);
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;

/**
 * The boys whose consent to the caller's institution is in force now, at a
 * school or in an age group (at least one), optionally narrowed by a name
 * fragment: his id, name, school, side, the institution that admits him and
 * its consent. Every row returned is recorded first (§2 of the header).
 * Refuses a call with neither school nor age group
 * (choose_a_school_or_age_group). A caller who reads at no union is
 * answered nothing, and nothing is recorded.
 */
CREATE OR REPLACE FUNCTION passport_union_list(p_org uuid, p_school uuid, p_age_group text, p_name text DEFAULT NULL)
RETURNS TABLE (player_id uuid, name text, school_name text, team_code text, org_id uuid, consent_id uuid) AS $$
DECLARE
  v_age text := upper(nullif(btrim(p_age_group), ''));
  v_q   text := lower(nullif(btrim(p_name), ''));
  v_pid uuid[]; v_name text[]; v_school text[]; v_side text[]; v_org uuid[]; v_cid uuid[];
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
           row_number() OVER (ORDER BY lower(s.name) COLLATE "C",
                                       lower(substring(p.full_name FROM '(\S+)\s*$')) COLLATE "C",
                                       lower(p.full_name) COLLATE "C", a.pid) AS n
      FROM admitted a
      JOIN player p ON p.id = a.pid
      JOIN school s ON s.id = p.school_id
  )
  SELECT array_agg(pid ORDER BY n), array_agg(full_name ORDER BY n), array_agg(school ORDER BY n),
         array_agg(side ORDER BY n), array_agg(oid ORDER BY n), array_agg(cid ORDER BY n)
    INTO v_pid, v_name, v_school, v_side, v_org, v_cid
    FROM listed;
  IF v_pid IS NULL THEN RETURN; END IF;
  -- On the record before a row is given (D5).
  PERFORM passport_union_log_list(v_pid, v_cid);
  RETURN QUERY
    SELECT t.pid, t.full_name, t.school, t.side, t.oid, t.cid
      FROM unnest(v_pid, v_name, v_school, v_side, v_org, v_cid) WITH ORDINALITY
           AS t(pid, full_name, school, side, oid, cid, n)
     ORDER BY t.n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── Grants ─────────────────────────────────────────────────────────
-- The application's: the three doors. Nobody's: the log writer, and the
-- giver test as db/124 left it.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['passport_union_orgs()', 'passport_union_schools(uuid)',
                           'passport_union_list(uuid,uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['passport_union_log_list(uuid[],uuid[])', 'consent_giver_live(uuid,uuid,timestamptz)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['passport_union_orgs()', 'passport_union_schools(uuid)',
                               'passport_union_list(uuid,uuid,text,text)', 'passport_union_log_list(uuid[],uuid[])',
                               'consent_giver_live(uuid,uuid,timestamptz)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE f text; v_src text; v_n int; v_args text;
BEGIN
  -- §1: the log takes 'list', and only the three.
  IF (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
       WHERE c.conrelid = 'passport_union_read'::regclass AND c.conname = 'passport_union_read_what_check')
     IS DISTINCT FROM 'CHECK ((what = ANY (ARRAY[''passport''::text, ''name''::text, ''list''::text])))' THEN
    RAISE EXCEPTION 'db/125: passport_union_read does not take ''list'' beside ''passport'' and ''name'' alone';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'passport_union_read'::regclass AND c.contype = 'c') <> 1 THEN
    RAISE EXCEPTION 'db/125: passport_union_read carries a CHECK other than its what';
  END IF;

  -- §2: the giver test is db/124's on the child's clock: no current_date,
  -- sa_today() in the four link tests, and db/124's two decisions still in it.
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src
    FROM pg_proc WHERE oid = 'consent_giver_live(uuid,uuid,timestamptz)'::regprocedure;
  IF position('current_date' IN v_src) > 0
     OR (length(v_src) - length(replace(v_src, 'sa_today()', ''))) / length('sa_today()') <> 4
     OR position('majority_on(p.born) <= sa_date(p_given_at)' IN v_src) = 0
     OR position('AND NOT (a.role = ''guardian'' AND guardian_link_reopened_since(s.player_id, p_given_at))' IN v_src) = 0
     OR position('a.created_at <= p_given_at AND s.created_at <= p_given_at' IN v_src) = 0
     OR position('s.verification_state = ''verified''' IN v_src) = 0
     OR position('d.lifted_at IS NULL' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/125: consent_giver_live() is not db/124''s on sa_today()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'consent_giver_live(uuid,uuid,timestamptz)'::regprocedure
                    AND NOT p.prosecdef AND p.provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/125: consent_giver_live() is a definer, not stable, or unpinned';
  END IF;

  -- §3, §4: the three doors are definers with the pinned path, the writer
  -- is not; the list and the writer are VOLATILE, the other two STABLE.
  FOREACH f IN ARRAY ARRAY['passport_union_orgs()', 'passport_union_schools(uuid)',
                           'passport_union_list(uuid,uuid,text,text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/125: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'passport_union_log_list(uuid[],uuid[])'::regprocedure
                    AND NOT p.prosecdef AND p.provolatile = 'v'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/125: passport_union_log_list() is a definer, not VOLATILE, or unpinned';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure) <> 'v'
     OR (SELECT string_agg(provolatile::text, '' ORDER BY oid) FROM pg_proc
          WHERE oid IN ('passport_union_orgs()'::regprocedure, 'passport_union_schools(uuid)'::regprocedure)) <> 'ss' THEN
    RAISE EXCEPTION 'db/125: the list is not VOLATILE (it cannot log), or orgs/schools are not STABLE';
  END IF;

  -- Who may call what: scrbrd_app the three, and nobody else but their
  -- owner; the writer and the giver test nobody's.
  FOREACH f IN ARRAY ARRAY['passport_union_orgs()', 'passport_union_schools(uuid)',
                           'passport_union_list(uuid,uuid,text,text)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.privilege_type = 'EXECUTE'
                     AND x.grantee NOT IN (p.proowner, (SELECT oid FROM pg_roles WHERE rolname = 'scrbrd_app'))) THEN
      RAISE EXCEPTION 'db/125: % is executable by someone other than scrbrd_app, or not by it', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['passport_union_log_list(uuid[],uuid[])', 'consent_giver_live(uuid,uuid,timestamptz)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.privilege_type = 'EXECUTE' AND x.grantee <> p.proowner)
       OR (SELECT proacl FROM pg_proc WHERE oid = f::regprocedure) IS NULL THEN
      RAISE EXCEPTION 'db/125: % is executable by someone other than its owner', f;
    END IF;
  END LOOP;

  -- The row is the six columns the design names, in that order.
  SELECT array_to_string(p.proargnames[pronargs + 1:], ',') INTO v_args
    FROM pg_proc p WHERE p.oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure;
  IF v_args IS DISTINCT FROM 'player_id,name,school_name,team_code,org_id,consent_id'
     OR (SELECT array_to_string(proargmodes, '') FROM pg_proc WHERE oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure)
        IS DISTINCT FROM 'iiiitttttt' THEN
    RAISE EXCEPTION 'db/125: passport_union_list() returns [%], not the six columns', v_args;
  END IF;
  -- And reads nothing past the name, the school and the side: no date of
  -- birth, no figure, no honour, no cap, no style, no second logged read.
  FOREACH f IN ARRAY ARRAY['passport_union_list(uuid,uuid,text,text)', 'passport_union_log_list(uuid[],uuid[])',
                           'passport_union_orgs()', 'passport_union_schools(uuid)'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF v_src ~* '\m(born|player_innings|bowler_innings_figures|honour|team_cap|player_milestone|batting_style|bowling_style|bowling_arm|passport_name|passport_open)\M' THEN
      RAISE EXCEPTION 'db/125: % reads past the name, the school and the side', f;
    END IF;
  END LOOP;
  -- The list is db/124's in-force test, logged before it answers, and
  -- refuses an unfiltered call.
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src
    FROM pg_proc WHERE oid = 'passport_union_list(uuid,uuid,text,text)'::regprocedure;
  IF position('c.withdrawn_at IS NULL' IN v_src) = 0
     OR position('consent_giver_live(c.granted_by, c.player_id, c.granted_at)' IN v_src) = 0
     OR position('o.archived_at IS NULL' IN v_src) = 0
     OR position('(o.kind = ''union'' AND o.id = school_union(p.school_id))' IN v_src) = 0
     OR position('(o.kind = ''federation'' AND o.id = school_federation())' IN v_src) = 0
     OR position('passport_union_reader_at(o.id)' IN v_src) = 0
     OR position('ORDER BY c.player_id, c.granted_at, c.id' IN v_src) = 0
     OR position('choose_a_school_or_age_group' IN v_src) = 0
     OR position('PERFORM passport_union_log_list(v_pid, v_cid);' IN v_src) = 0
     OR position('PERFORM passport_union_log_list(v_pid, v_cid);' IN v_src) > position('RETURN QUERY' IN v_src)
     OR v_src ~* '\m(LIKE|ILIKE|SIMILAR)\M' THEN
    RAISE EXCEPTION 'db/125: passport_union_list() is not db/124''s in-force test, filtered, logged before it answers';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'passport_union_log_list(uuid[],uuid[])'::regprocedure;
  IF position('INSERT INTO passport_union_read' IN v_src) = 0 OR v_src ~* 'EXCEPTION\s+WHEN'
     OR position('reader_name, reader_role' IN v_src) = 0 OR position('u.name' IN v_src) = 0
     OR position('role_words(a.role)' IN v_src) = 0 OR position('''list''' IN v_src) = 0
     OR position('log_restricted_read(''passport_union'', r.ids, ARRAY[''list''], r.school_id)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/125: passport_union_log_list() does not write the log, or swallows a failure to';
  END IF;
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src
    FROM pg_proc WHERE oid = 'passport_union_orgs()'::regprocedure;
  IF position('passport_union_reader_at(o.id)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/125: passport_union_orgs() names an institution the caller does not read at';
  END IF;
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src
    FROM pg_proc WHERE oid = 'passport_union_schools(uuid)'::regprocedure;
  IF position('passport_union_reader_at(o.id)' IN v_src) = 0 OR position('school_union(s.id) = o.id' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/125: passport_union_schools() is not the union''s schools, to its readers';
  END IF;

  -- And they answer nobody (the owner, with no caller set).
  PERFORM set_config('app.user_id', '', true);
  SELECT count(*) INTO v_n FROM passport_union_read;
  IF EXISTS (SELECT 1 FROM passport_union_orgs())
     OR EXISTS (SELECT 1 FROM passport_union_schools(gen_random_uuid()))
     OR EXISTS (SELECT 1 FROM passport_union_list(NULL, gen_random_uuid(), NULL, NULL))
     OR EXISTS (SELECT 1 FROM passport_union_list(NULL, NULL, 'U15', NULL))
     OR (SELECT count(*) FROM passport_union_read) <> v_n THEN
    RAISE EXCEPTION 'db/125: the list, its institutions or its schools answered nobody, or logged for nobody';
  END IF;
  BEGIN
    PERFORM 1 FROM passport_union_list(NULL, NULL, NULL, 'a');
    RAISE EXCEPTION 'db/125: the list answered a call with neither school nor age group';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $check$;
