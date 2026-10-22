-- ══════════════════════════════════════════════════════════════════
--  118 · Names, login emails, retirements and bowler changes: narrower reads
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Four small rules about children's data, in three functions,
-- each proved by db/99 §93. No table changes; nothing here widens a read.
--
-- 1. THE PUBLIC NEWS SCAN READS EVERY PART OF A NAME (PUBLIC_DATA §1 rules
--    3 and 4: no full name, no first name alone, no name without consent).
--    db/83's news_public_names() counted the school's pupils whose full name
--    or known-as the post's words carried. A surname alone ("Erasmus took
--    five", "D Erasmus 52*") or a first name alone ("Well done Dylan") passed
--    the scan, and the scan is the only check: the approver is told a count,
--    never which name. It now also reads the stored surname (db/47) and every
--    word of the full name of three letters or more, split on anything
--    that is not a letter ("Erasmus, D" gives Erasmus; "Mary-Anne" gives
--    Mary and Anne), whole-word and case-blind, and refuses on any hit. The
--    surname particles (van, der, de, …) are not names on their own and are
--    not scanned as words; the full name and the surname that carry them
--    still are. Kameel's answers (22 October 2026):
--      - the boys scanned are the post's school's AND those of every school
--        it has a fixture with, home or away, starting in the twelve months
--        before now or the three after: a post names the other side's boys
--        as easily as its own;
--      - the refusal still answers a count, and news_public_word() tells the
--        author and the school's publishers which word of their own post
--        matched, as the post writes it: never which boy or which school.
--    The scan (news_public_hits, news_public_names) is no definer and
--    nobody's to call.
--
-- 2. A PUPIL'S LOGIN EMAIL IS THE OFFICE'S (READERS A2-A5; PUBLIC_DATA §5a).
--    The `users` and `accounts` reads give every user.read holder at a school
--    each account's email, and user.read is held by finance and sponsorship
--    as well as the office. app_user_email_seen() answers an account's email
--    to the account holder himself, to anybody for an adult's account, and
--    for a pupil's account (an account linked to a player row, or that holds
--    or held a `player` or `selfaccess` assignment) only to a holder of
--    user.role.assign or guardian.link.manage at a school the pupil is at.
--    Otherwise NULL. It is handed the row's own email, so it can only ever
--    answer what the caller's row already carried, or less.
--
-- 3. A RETIREMENT'S REASON STAYS AT THE BOY'S SCHOOL (SCRBRD-136-137 away
--    visibility §4: the log does not say whether a boy is carrying
--    something; the public page's projection already says "not out").
--    A `retire` event carries its reason (hurt, out, timed out) in its
--    payload, and the signed-in log is read by both schools' families and
--    spectators. ball_event_payload_seen() leaves every payload as it is
--    except a retirement that is not a dismissal (no `W`, or a reason other
--    than out or timed out), whose reason reads "not out" to a reader who
--    holds no fixture.read at the retiring boy's school. A batter the pad
--    knows only by a typed name has no school here, and reads "not out" to
--    everybody. A retired-out or timed-out batter keeps his reason: it is a
--    dismissal on the scorecard. The fold reads both alike (a retirement
--    that is not a dismissal leaves him not out and free to return), so a
--    log read with the reason masked replays to the same scorecard.
--    The pad's handover still reads the raw log; it is the scorer's.
--
-- 4. A BOWLER CHANGE'S REASON STAYS AT THE BOWLER'S SCHOOL (Kameel, 22
--    October 2026). A bowler replaced during an over (Law 17.7.1) is
--    recorded with why: injury, or suspended. The other school of the
--    fixture sees that the bowler changed, never why: the same function
--    drops `reason` from a `bowler` event for a reader with no fixture.read
--    at the bowler's school. A Law 41 suspension (`bowler_suspended`) is
--    treated alike: its ground is a conduct matter (db/59), so the other
--    school reads that he was suspended and for how long (`scope`), never
--    on what ground; the fold reads a suspension with no reason the same. A bowler the pad knows only by a typed name is
--    at no school here, and his reason reaches nobody through the log. The
--    public projection already keeps only who bowls (public/redact.mjs), and
--    the Match Centre's scorecard and commentary say no reason; the pad's
--    words say it from the log as the reader has it.
--
-- GRANTS. app_user_email_seen(), ball_event_payload_seen() and news_public_word() are definers
-- (they look up a pupil's assignments and a boy's school past the caller's
-- own policies), executable by scrbrd_app only: never PUBLIC, nor a
-- managed host's anon/authenticated roles.
-- news_public_names() keeps db/83's grants: none.

-- ── 1 · The scan ───────────────────────────────────────────────────
/**
 * Every word of the post's title and body that names a boy the scan reads:
 * the boy and the word as the post writes it, with where it first stands.
 * The boys are the post's school's, and those of every school it has a
 * fixture with, home or away, starting within the twelve months before now
 * or the three after (Kameel, 22 October 2026). The names: full name,
 * known-as and stored surname (two letters or more), and each word of the
 * full name of three letters or more, split on anything that is not a
 * letter, surname particles aside; whole-word and case-blind. Internal: not
 * a definer, called only from inside definers (as their owner), nobody's to
 * call.
 */
CREATE OR REPLACE FUNCTION news_public_hits(p_post uuid)
RETURNS TABLE (player_id uuid, word text, at integer) AS $$
  WITH post AS (
    SELECT n.school_id, n.title || E'\n' || n.body AS txt FROM news_post n WHERE n.id = p_post
  ), schools AS (
    SELECT post.school_id AS school_id FROM post
    UNION
    SELECT CASE WHEN m.school_id = post.school_id THEN m.away_school_id ELSE m.school_id END
      FROM match m, post
     WHERE (m.school_id = post.school_id OR m.away_school_id = post.school_id)
       AND m.away_school_id IS NOT NULL
       AND m.starts_at >= now() - interval '12 months'
       AND m.starts_at <= now() + interval '3 months'
  ), names AS (
    SELECT p.id AS player_id, c.name
      FROM player p
      JOIN schools sc ON sc.school_id = p.school_id
      CROSS JOIN LATERAL (
        SELECT btrim(x) AS name
          FROM unnest(ARRAY[p.full_name, p.known_as, p.surname]) AS x
         WHERE length(btrim(coalesce(x, ''))) >= 2
        UNION
        SELECT t
          FROM regexp_split_to_table(btrim(coalesce(p.full_name, '')), '[^[:alpha:]]+') AS t
         WHERE length(t) >= 3
           AND lower(t) NOT IN ('van', 'von', 'der', 'den', 'des', 'del', 'dos', 'das', 'ten', 'ter')) AS c
  ), hits AS (
    SELECT nm.player_id,
           regexp_match(post.txt,
             '(?:^|[^[:alnum:]])('
             || regexp_replace(regexp_replace(nm.name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '\s+', '\\s+', 'g')
             || ')(?:$|[^[:alnum:]])', 'i') AS m,
           post.txt
      FROM names nm, post
  )
  SELECT h.player_id, h.m[1], strpos(h.txt, h.m[1])
    FROM hits h
   WHERE h.m IS NOT NULL
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_hits(uuid) FROM PUBLIC;

/**
 * How many boys the post names (news_public_hits()). Internal, as db/83's:
 * called only from inside its definers.
 */
CREATE OR REPLACE FUNCTION news_public_names(p_post uuid) RETURNS integer AS $$
  SELECT count(DISTINCT h.player_id)::integer FROM news_public_hits(p_post) h
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_names(uuid) FROM PUBLIC;

/**
 * The first word in the post that names a boy, as the post writes it, for
 * the author and the school's publishers (who already read the post), and
 * NULL for anybody else or a post that names nobody (Kameel, 22 October
 * 2026). The word only: never which boy, nor which school, it belongs to.
 */
CREATE OR REPLACE FUNCTION news_public_word(p_post uuid) RETURNS text AS $$
  SELECT CASE WHEN (n.author_id = app_user_id() AND NOT app_pad_scoped())
                   OR app_can('broadcast.publish', n.school_id, '*'::text,
                              '00000000-0000-0000-0000-000000000000'::uuid,
                              '00000000-0000-0000-0000-000000000000'::uuid)
              THEN (SELECT h.word FROM news_public_hits(n.id) h ORDER BY h.at, h.word LIMIT 1) END
    FROM news_post n
   WHERE n.id = p_post AND n.scope IN ('team', 'school')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_word(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_public_word(uuid) TO scrbrd_app;


-- ── 2 · A pupil's login email ──────────────────────────────────────
/**
 * The email an account row may show this reader: `p_email` (the row's own)
 * or NULL. See (2) above.
 */
CREATE OR REPLACE FUNCTION app_user_email_seen(p_user uuid, p_school uuid, p_email text)
RETURNS text AS $$
DECLARE
  v_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  v_schools uuid[];
BEGIN
  IF p_email IS NULL OR p_user IS NULL THEN RETURN p_email; END IF;
  IF p_user = app_user_id() THEN RETURN p_email; END IF;
  -- The schools a pupil is at: his player row's, and his player or
  -- selfaccess assignments' (ended ones too: a boy who has left is still a
  -- boy). An account with none of these is an adult's.
  SELECT array_agg(DISTINCT s) INTO v_schools
    FROM (SELECT p.school_id AS s
            FROM app_user u JOIN player p ON p.id = u.player_id
           WHERE u.id = p_user
          UNION ALL
          SELECT a.school_id
            FROM role_assignment a
           WHERE a.person_id = p_user AND a.role IN ('player', 'selfaccess')) z;
  IF v_schools IS NULL THEN
    -- Neither linked to a player nor ever held a pupil's role: an adult.
    RETURN p_email;
  END IF;
  v_schools := array_remove(v_schools || p_school, NULL);
  IF EXISTS (SELECT 1 FROM unnest(v_schools) s
              WHERE app_can('user.role.assign', s, '*'::text, v_nil, v_nil)
                 OR app_can('guardian.link.manage', s, '*'::text, v_nil, v_nil)) THEN
    RETURN p_email;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION app_user_email_seen(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_email_seen(uuid, uuid, text) TO scrbrd_app;


-- ── 3 · A retirement's reason, and a bowler change's ──────────────
/**
 * A ball_event payload of match `p_match` as this reader may have it. See (3)
 * and (4) above. The match is asked of app_can() as the fixture, so a
 * one-fixture assignment counts for its own fixture, and a pad resume
 * credential (db/50) answers for its own match only. `p_bowler` is the row's
 * bowler_id; a bowler the pad knows only by a typed name is in the payload.
 */
CREATE OR REPLACE FUNCTION ball_event_payload_seen(p_match uuid, p_kind text, p_ball_type text, p_bowler uuid, p_payload jsonb)
RETURNS jsonb AS $$
  SELECT CASE
    WHEN p_payload IS NULL OR NOT (p_payload ? 'reason') OR p_kind IS NULL
         OR p_kind NOT IN ('retire', 'bowler', 'bowler_suspended') THEN p_payload
    -- A retirement that is a dismissal is on the scorecard, reason and all.
    WHEN p_kind = 'retire' AND p_ball_type = 'W' AND p_payload->>'reason' IN ('out', 'timed_out') THEN p_payload
    -- The reader holds fixture.read at the school of the boy the reason is about.
    WHEN EXISTS (SELECT 1 FROM player p
                  WHERE p.id::text = lower(CASE WHEN p_kind = 'retire' THEN p_payload->>'batter'
                                                ELSE coalesce(p_bowler::text, p_payload->>'bowler') END)
                    AND app_can('fixture.read', p.school_id, '*'::text,
                                '00000000-0000-0000-0000-000000000000'::uuid, p_match)) THEN p_payload
    WHEN p_kind = 'retire' THEN jsonb_set(p_payload, '{reason}', to_jsonb('not out'::text))
    -- A bowler change or a suspension: that it happened (and a suspension's
    -- scope), never why.
    ELSE p_payload - 'reason'
  END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION ball_event_payload_seen(uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ball_event_payload_seen(uuid, text, text, uuid, jsonb) TO scrbrd_app;


-- ── A managed host's API roles reach none of it ────────────────────
DO $managed$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['app_user_email_seen(uuid,uuid,text)', 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)',
                               'news_public_names(uuid)', 'news_public_hits(uuid)', 'news_public_word(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $managed$;


-- ── Checks ─────────────────────────────────────────────────────────
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('anon', 'authenticated')
               AND (has_function_privilege(g.oid, 'app_user_email_seen(uuid,uuid,text)'::regprocedure, 'EXECUTE')
                    OR has_function_privilege(g.oid, 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'db/118: a managed host''s API role can call a definer here';
  END IF;
  IF has_function_privilege('scrbrd_app', 'news_public_names(uuid)'::regprocedure, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'news_public_names(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/118: news_public_names() is callable by the application, or is a definer';
  END IF;
  IF has_function_privilege('scrbrd_app', 'news_public_hits(uuid)'::regprocedure, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'news_public_hits(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/118: news_public_hits() is callable by the application, or is a definer';
  END IF;
  IF has_function_privilege('public', 'news_public_word(uuid)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'news_public_word(uuid)'::regprocedure, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(g.oid, 'news_public_word(uuid)'::regprocedure, 'EXECUTE')) THEN
    RAISE EXCEPTION 'db/118: news_public_word() is not the application''s alone';
  END IF;
  IF has_function_privilege('public', 'app_user_email_seen(uuid,uuid,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/118: a definer here is executable by PUBLIC';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'app_user_email_seen(uuid,uuid,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/118: the application cannot execute a function its reads call';
  END IF;
END $check$;
