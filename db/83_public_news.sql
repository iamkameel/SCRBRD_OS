-- ══════════════════════════════════════════════════════════════════
--  83 · Public news on the home page (SCRBRD-142 phase 3)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-142_public_home_page.md
-- (decided by Kameel, 2026-10-02), §3 and §7 phase 3. The rule is
-- docs/policy/PUBLIC_DATA.md, rule 7 as amended (D1a): a school's news
-- appears on the public home page only when that school lists (db/82's one
-- switch, D5) AND a second person approved that post. In v1 a public post
-- names no pupil at all; it talks about sides (§3.3).
--
-- WHAT IS HERE:
--
--   1. news_post_public — one row per request to put a post on the home
--      page: who asked and when, who approved and when (and the digest of
--      what they approved), who withdrew it and when. A SIDE TABLE, not
--      columns on news_post (§10 note 1): db/12's news_post_update is the
--      author's alone, and the approver and the office that takes a coach's
--      post down are not the author. db/12 is untouched. Rows are never
--      deleted: a withdrawn request stays, as db/12 keeps a withdrawn notice
--      ("a disputed notice can still be shown to have existed"); one OPEN
--      row (not withdrawn) per post at a time.
--
--   2. news_public_request(post) — the post's author, while it is published
--      and scoped to a team or a school. A competition post belongs to no
--      one school and waits for an organiser's door (§3.2).
--
--   3. news_public_approve(post) — broadcast.publish at the post's school
--      with NO team (a school-wide holder: the director of sport, the
--      office), as public_listing_set() (db/82) decides the school's
--      front-page presence. SEPARATION OF DUTIES: never the author, never
--      the requester (one person deciding what the public sees about
--      children), and the table's CHECK says so too. A holder at another
--      school is no holder here. And THE SCAN: a post that names one of its
--      school's pupils by full name or known-as is refused, `names_pupils`,
--      with how many — never which.
--
--   4. news_public_withdraw(post) — the author, or any broadcast.publish
--      holder at the school (any side of it): a definer, so the office can
--      take down a coach's post, which db/12 alone does not let it do. A
--      decline is a withdrawal of the request; no note is stored (§3.5).
--
--   5. news_public_check(post) — the scan's count for the author and the
--      school's publishers (the approvals card warns before anyone presses
--      Approve); NULL for anybody else. A count, never a name.
--
--   6. public_news(limit) — the home page's read: id, the school's name, the
--      team code, title, body, published_at. NO author_id and no person
--      column (§3.2: a byline waits on A4). Only posts published and in
--      date, approved, not withdrawn, UNCHANGED since approval (the digest:
--      an author's edit after approval takes the post off the home page
--      until somebody approves the new words), team or school scope, of a
--      school that lists. Newest first, at most `limit`, never more than 20.
--
--   7. public_data_changed on news_post and on news_post_public: payload
--      {"k": "news", "id": post}. The API's cache drops the news read on it
--      (and an older build, not knowing the kind, drops everything — §10
--      note 3, correct and cheap). A post's internal withdrawal
--      (published_at = null, db/12's route) also takes it off the home page,
--      because the read requires published_at.
--
-- THE SCAN IS A BELT, NOT A GUARANTEE (§3.2). It reads player.full_name and
-- player.known_as of the post's own school — the two a stranger recognises
-- as a name; a surname alone is too common to scan — matched whole-word and
-- case-blind. It cannot read "the tall left-hander from Pietermaritzburg";
-- the approver's attestation is the braces.
--
-- WHO MAY CALL THESE: scrbrd_app, and nobody else. search_path pinned on
-- every function (db/16). Safe to run twice. Applies after db/82; reads its
-- public_school_listed().


-- ── 1 · The requests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_post_public (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          uuid NOT NULL REFERENCES news_post(id) ON DELETE CASCADE,
  -- The post's school, copied at the request so the read policy needs no
  -- join through a table whose own policy would hide the row.
  school_id        uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  requested_by     uuid NOT NULL REFERENCES app_user(id),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  approved_by      uuid REFERENCES app_user(id),
  approved_at      timestamptz,
  -- What was approved: news_public_digest() of the post as the approver read it.
  approved_digest  text,
  withdrawn_by     uuid REFERENCES app_user(id),
  withdrawn_at     timestamptz,
  CONSTRAINT news_post_public_approved_whole CHECK (
    (approved_by IS NULL) = (approved_at IS NULL) AND (approved_by IS NULL) = (approved_digest IS NULL)),
  CONSTRAINT news_post_public_withdrawn_whole CHECK ((withdrawn_by IS NULL) = (withdrawn_at IS NULL)),
  -- Separation of duties, in the table as well as the door.
  CONSTRAINT news_post_public_two_people CHECK (approved_by IS NULL OR approved_by <> requested_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS news_post_public_open ON news_post_public (post_id) WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS news_post_public_school ON news_post_public (school_id) WHERE withdrawn_at IS NULL;

ALTER TABLE news_post_public ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON news_post_public FROM scrbrd_app;
GRANT SELECT ON news_post_public TO scrbrd_app;

-- Read: the one who asked (the author), and the school's publishers.
DROP POLICY IF EXISTS news_post_public_read ON news_post_public;
CREATE POLICY news_post_public_read ON news_post_public
  FOR SELECT USING (
    requested_by = app_user_id()
    OR app_can('broadcast.publish', news_post_public.school_id, '*'::text,
               '00000000-0000-0000-0000-000000000000'::uuid,
               '00000000-0000-0000-0000-000000000000'::uuid));
SELECT pad_scope_guard_install('news_post_public'::regclass);

/**
 * What an approval is bound to: the post's audience and its words. Pure;
 * the newsfeed's read compares it to say "edited since approval".
 */
CREATE OR REPLACE FUNCTION news_public_digest(p_scope text, p_school uuid, p_team text, p_title text, p_body text)
RETURNS text AS $$
  SELECT encode(sha256(convert_to(concat_ws(E'\x1f', p_scope, p_school::text, coalesce(p_team, ''), p_title, p_body), 'UTF8')), 'hex')
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_digest(text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_public_digest(text, uuid, text, text, text) TO scrbrd_app;


-- ── 2 · The scan ───────────────────────────────────────────────────
/**
 * How many of the post's school's pupils its title and body name, by full
 * name or known-as, whole-word and case-blind. Internal: not a definer,
 * called only from inside the definers below (as their owner).
 */
CREATE OR REPLACE FUNCTION news_public_names(p_post uuid) RETURNS integer AS $$
  SELECT count(DISTINCT p.id)::integer
    FROM news_post n
    JOIN player p ON p.school_id = n.school_id
   WHERE n.id = p_post
     AND EXISTS (
       SELECT 1 FROM unnest(ARRAY[p.full_name, p.known_as]) AS x(name)
        WHERE length(btrim(coalesce(x.name, ''))) >= 2
          AND (n.title || E'\n' || n.body) ~* (
                '(^|[^[:alnum:]])'
             || regexp_replace(regexp_replace(btrim(x.name), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '\s+', '\\s+', 'g')
             || '($|[^[:alnum:]])'))
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_names(uuid) FROM PUBLIC;

/** The scan's count, for the author and the school's publishers; NULL for anybody else. */
CREATE OR REPLACE FUNCTION news_public_check(p_post uuid) RETURNS integer AS $$
  SELECT CASE WHEN (n.author_id = app_user_id() AND NOT app_pad_scoped())
                   OR app_can('broadcast.publish', n.school_id, '*'::text,
                              '00000000-0000-0000-0000-000000000000'::uuid,
                              '00000000-0000-0000-0000-000000000000'::uuid)
              THEN news_public_names(n.id) END
    FROM news_post n
   WHERE n.id = p_post AND n.scope IN ('team', 'school')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_check(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_public_check(uuid) TO scrbrd_app;


-- ── 3 · The doors ──────────────────────────────────────────────────
/** The author asks for a published post to go on the home page. */
CREATE OR REPLACE FUNCTION news_public_request(p_post uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  n news_post;
  o news_post_public;
BEGIN
  SELECT * INTO n FROM news_post WHERE id = p_post;
  IF n.id IS NULL THEN RETURN QUERY SELECT false, 'no_such_post'; RETURN; END IF;
  IF n.author_id IS DISTINCT FROM app_user_id() OR app_pad_scoped() THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF n.scope NOT IN ('team', 'school') THEN RETURN QUERY SELECT false, 'scope_not_public'; RETURN; END IF;
  IF n.published_at IS NULL OR n.published_at > now() THEN
    RETURN QUERY SELECT false, 'not_published'; RETURN;
  END IF;
  SELECT * INTO o FROM news_post_public WHERE post_id = p_post AND withdrawn_at IS NULL FOR UPDATE;
  IF o.id IS NOT NULL THEN
    IF o.approved_at IS NULL THEN RETURN QUERY SELECT false, 'already_requested'; RETURN; END IF;
    IF o.approved_digest = news_public_digest(n.scope, n.school_id, n.team_code, n.title, n.body) THEN
      RETURN QUERY SELECT false, 'already_public'; RETURN;
    END IF;
    -- Approved, then edited: that approval is of words no longer there.
    -- Closed, and the new words asked about afresh.
    UPDATE news_post_public SET withdrawn_by = app_user_id(), withdrawn_at = now() WHERE id = o.id;
  END IF;
  INSERT INTO news_post_public (post_id, school_id, requested_by) VALUES (n.id, n.school_id, app_user_id());
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * A school-wide publisher at the post's school approves it — not the author,
 * not the requester, and not a post that names a pupil. `names` is the
 * scan's count on a `names_pupils` refusal, and NULL otherwise.
 */
CREATE OR REPLACE FUNCTION news_public_approve(p_post uuid)
RETURNS TABLE (ok boolean, reason text, names integer) AS $$
DECLARE
  n news_post;
  o news_post_public;
  v_names integer;
BEGIN
  SELECT * INTO n FROM news_post WHERE id = p_post;
  IF n.id IS NULL THEN RETURN QUERY SELECT false, 'no_such_post', NULL::integer; RETURN; END IF;
  IF n.scope NOT IN ('team', 'school') THEN RETURN QUERY SELECT false, 'scope_not_public', NULL::integer; RETURN; END IF;
  -- NULL team, not '*': the school's front page needs a school-wide holder,
  -- as listing does (db/82). A holder at another school fails here.
  IF NOT app_can('broadcast.publish', n.school_id, NULL::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::integer; RETURN;
  END IF;
  SELECT * INTO o FROM news_post_public WHERE post_id = p_post AND withdrawn_at IS NULL FOR UPDATE;
  IF o.id IS NULL THEN RETURN QUERY SELECT false, 'not_requested', NULL::integer; RETURN; END IF;
  IF o.approved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_public', NULL::integer; RETURN; END IF;
  -- Separation of duties: one person never decides alone what the public
  -- reads about a school's children.
  IF app_user_id() IS NULL OR app_user_id() = n.author_id OR app_user_id() = o.requested_by THEN
    RETURN QUERY SELECT false, 'own_post', NULL::integer; RETURN;
  END IF;
  IF n.published_at IS NULL OR n.published_at > now() THEN
    RETURN QUERY SELECT false, 'not_published', NULL::integer; RETURN;
  END IF;
  v_names := news_public_names(n.id);
  IF v_names > 0 THEN RETURN QUERY SELECT false, 'names_pupils', v_names; RETURN; END IF;
  UPDATE news_post_public
     SET approved_by = app_user_id(), approved_at = now(),
         approved_digest = news_public_digest(n.scope, n.school_id, n.team_code, n.title, n.body)
   WHERE id = o.id;
  RETURN QUERY SELECT true, NULL::text, NULL::integer;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Take a post off the home page, or decline a request: the author, or any
 * broadcast.publish holder at the school. Taking something down is the safe
 * direction, so any side's publisher may; putting it up is school-wide.
 */
CREATE OR REPLACE FUNCTION news_public_withdraw(p_post uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  n news_post;
  o news_post_public;
BEGIN
  SELECT * INTO n FROM news_post WHERE id = p_post;
  IF n.id IS NULL THEN RETURN QUERY SELECT false, 'no_such_post'; RETURN; END IF;
  IF NOT ((n.author_id = app_user_id() AND NOT app_pad_scoped())
          OR (n.school_id IS NOT NULL
              AND app_can('broadcast.publish', n.school_id, '*'::text,
                          '00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid))) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  SELECT * INTO o FROM news_post_public WHERE post_id = p_post AND withdrawn_at IS NULL FOR UPDATE;
  IF o.id IS NULL THEN RETURN QUERY SELECT false, 'not_requested'; RETURN; END IF;
  UPDATE news_post_public SET withdrawn_by = app_user_id(), withdrawn_at = now() WHERE id = o.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION news_public_approve(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION news_public_withdraw(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_public_request(uuid) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION news_public_approve(uuid) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION news_public_withdraw(uuid) TO scrbrd_app;


-- ── 4 · The read: approved posts of the schools that list ──────────
/**
 * The home page's news (§3.2): newest first, at most `p_limit` (1–20; 20
 * when NULL). Team-level words; no author, no person.
 */
CREATE OR REPLACE FUNCTION public_news(p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, school text, team_code text, title text, body text, published_at timestamptz) AS $$
  SELECT n.id, s.name, n.team_code, n.title, n.body, n.published_at
    FROM news_post n
    JOIN news_post_public pp ON pp.post_id = n.id
    JOIN school s ON s.id = n.school_id
   WHERE n.scope IN ('team', 'school')
     AND n.published_at IS NOT NULL AND n.published_at <= now()
     AND pp.withdrawn_at IS NULL AND pp.approved_at IS NOT NULL
     AND pp.approved_digest = news_public_digest(n.scope, n.school_id, n.team_code, n.title, n.body)
     AND public_school_listed(n.school_id)
   ORDER BY n.published_at DESC, n.id
   LIMIT least(greatest(coalesce(p_limit, 20), 1), 20)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_news(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_news(integer) TO scrbrd_app;


-- ── 5 · "At once": a post or its approval changing drops the cache ──
DROP TRIGGER IF EXISTS public_data_changed ON news_post;
CREATE TRIGGER public_data_changed AFTER UPDATE OR DELETE ON news_post
  FOR EACH ROW EXECUTE FUNCTION public_data_notify('news', 'id');
DROP TRIGGER IF EXISTS public_data_changed ON news_post_public;
CREATE TRIGGER public_data_changed AFTER INSERT OR UPDATE OR DELETE ON news_post_public
  FOR EACH ROW EXECUTE FUNCTION public_data_notify('news', 'post_id');


-- ── Who may call these: the application, and nobody else ──────────
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['news_public_digest(text,uuid,text,text,text)', 'news_public_names(uuid)',
                               'news_public_check(uuid)', 'news_public_request(uuid)', 'news_public_approve(uuid)',
                               'news_public_withdraw(uuid)', 'public_news(integer)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON TABLE news_post_public FROM %I', r);
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
  FOREACH f IN ARRAY ARRAY['news_public_check(uuid)', 'news_public_request(uuid)', 'news_public_approve(uuid)',
                           'news_public_withdraw(uuid)', 'public_news(integer)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/83: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/83: the application cannot call %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['news_public_digest(text,uuid,text,text,text)', 'news_public_names(uuid)',
                           'news_public_check(uuid)', 'news_public_request(uuid)', 'news_public_approve(uuid)',
                           'news_public_withdraw(uuid)', 'public_news(integer)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/83: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(r.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/83: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  -- The scan is the owner's alone, and is not a definer: nobody calls it to
  -- learn whether a name is on a school's roll.
  IF has_function_privilege('scrbrd_app', 'news_public_names(uuid)'::regprocedure, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'news_public_names(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/83: news_public_names() is callable by the application, or is a definer';
  END IF;
  -- The application writes requests only through the doors.
  IF has_table_privilege('scrbrd_app', 'news_post_public', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'news_post_public', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'news_post_public', 'DELETE') THEN
    RAISE EXCEPTION 'db/83: the application can write news_post_public directly';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'news_post_public'::regclass) THEN
    RAISE EXCEPTION 'db/83: news_post_public has no row-level security';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post_public'
                    AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/83: news_post_public has no RESTRICTIVE pad_scope_select (db/50)';
  END IF;
  -- Separation of duties is in the table, not only in the door.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'news_post_public'::regclass
                    AND conname = 'news_post_public_two_people' AND contype = 'c') THEN
    RAISE EXCEPTION 'db/83: news_post_public lets the requester approve';
  END IF;
  -- db/12's author-only update policy is untouched (§10 note 1).
  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
       WHERE polrelid = 'news_post'::regclass AND polname = 'news_post_update') !~ '^\(?author_id = app_user_id\(\)\)?$' THEN
    RAISE EXCEPTION 'db/83: news_post_update is no longer the author''s alone';
  END IF;

  -- The read returns no author and no person, by name.
  SELECT string_agg(a.name, ',') INTO v_cols
    FROM pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) AS a(name, mode)
   WHERE p.oid = 'public_news(integer)'::regprocedure
     AND a.mode = 't'
     AND a.name ~ '(author|_by|person|player|user|requested|approved|withdrawn|digest|competition|email)';
  IF v_cols IS NOT NULL THEN
    RAISE EXCEPTION 'db/83: the news read returns %', v_cols;
  END IF;
  IF pg_get_functiondef('public_news(integer)'::regprocedure) ~* 'author_id|\mplayer\M' THEN
    RAISE EXCEPTION 'db/83: the news read reads an author or a player';
  END IF;

  -- The notifiers are on both tables.
  FOREACH f IN ARRAY ARRAY['news_post', 'news_post_public'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = f::regclass AND g.tgname = 'public_data_changed'
                      AND g.tgfoid = 'public_data_notify()'::regprocedure AND NOT g.tgisinternal) THEN
      RAISE EXCEPTION 'db/83: % has no public_data_changed trigger', f;
    END IF;
  END LOOP;

  -- Nothing unapproved, withdrawn or unlisted is answered.
  SELECT count(*) INTO n
    FROM public_news(20) x JOIN news_post np ON np.id = x.id
   WHERE NOT public_school_listed(np.school_id)
      OR NOT EXISTS (SELECT 1 FROM news_post_public pp
                      WHERE pp.post_id = np.id AND pp.withdrawn_at IS NULL AND pp.approved_at IS NOT NULL);
  IF n <> 0 THEN
    RAISE EXCEPTION 'db/83: the news read answered % posts nobody approved or listed', n;
  END IF;
END $check$;
