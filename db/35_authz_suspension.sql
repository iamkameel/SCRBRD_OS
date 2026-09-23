-- ══════════════════════════════════════════════════════════════════
--  35 · A suspended duty grants nothing (SCRBRD-034)
-- ══════════════════════════════════════════════════════════════════
-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.
-- Regenerate with `pnpm rls:generate`. Companions: db/01_authz.sql and
-- db/23_authz_time_box.sql, which stay exactly as they shipped; this file is
-- db/23's three functions with one more condition in their liveness rule:
--
--     AND NOT EXISTS (SELECT 1 FROM duty_suspension s
--                      WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
--
-- duty_suspension (db/34) holds a row only for an assignment the school
-- office linked to a match duty and then suspended, with a reason. While
-- that row is open the assignment is not live — to app_can(), app_holds()
-- and app_may_grant() alike — and lifting it (another reason, another name)
-- makes it live again without touching role_assignment.active, which db/01
-- never lets go from false back to true. Every other assignment has no row
-- there, so nothing changes for anybody else.


-- ══════════════════════════════════════════════════════════════════
--  The authorization decision
-- ══════════════════════════════════════════════════════════════════
-- app_can(capability, school, team, person, fixture)
--
-- TRUE when ONE SINGLE assignment held by the current user both grants the
-- capability and covers the resource. Never a union across assignments: a
-- capability held through one assignment is only ever applied within that
-- same assignment's scope.
--
-- Scope semantics, which are asymmetric on purpose:
--   NULL on the ASSIGNMENT widens  — school_id NULL is platform-wide,
--                                    team_code NULL is every team in the school.
--   NULL on the RESOURCE narrows   — a row that does not state its school is
--                                    NOT covered by a school-scoped assignment.
-- The second half is what makes a query that forgot its scope fail closed
-- instead of matching everything.
--
-- The third state is ANY_SCOPE ('*' for team, the nil UUID for the others),
-- meaning the dimension DOES NOT APPLY to this kind of row. A fixture is not
-- about one person, so a guardian assignment's child list has nothing to
-- constrain and does not constrain it. Without this, every guardian was denied
-- every fixture — they could not see when their own child was playing. It is
-- passed by the generator only for dimensions a table omits entirely; a table
-- that states a dimension as absent still narrows.
--
-- SECURITY DEFINER because role_assignment is itself RLS-protected: a person
-- may not read other people's assignments, but the decision must read their
-- own. STABLE so it is evaluated once per statement per argument set.
CREATE OR REPLACE FUNCTION app_can(
  p_capability text,
  p_school     uuid DEFAULT NULL,
  p_team       text DEFAULT NULL,
  p_person     uuid DEFAULT NULL,
  p_fixture    uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       -- institution. There is no ANY_SCOPE for school: every governed row
       -- belongs to a tenant, and one that does not state its tenant is one
       -- nobody should reach.
       AND (a.school_id IS NULL OR (p_school IS NOT NULL AND a.school_id = p_school))
       -- team
       AND (a.team_code IS NULL OR p_team = '*'::text
            OR (p_team IS NOT NULL AND a.team_code = p_team))
       -- single fixture (scorers, match officials)
       AND (a.fixture_id IS NULL OR p_fixture = '00000000-0000-0000-0000-000000000000'::uuid
            OR (p_fixture IS NOT NULL AND a.fixture_id = p_fixture))
       -- WHO the assignment is about. An assignment naming people reaches ONLY
       -- those people: a guardian's children, and a pupil's own record. An
       -- assignment naming nobody is about nobody in particular and is scoped
       -- by school and team alone, which is how a coach reaches their squad —
       -- EXCEPT for the roles that only make sense about a person, which are
       -- refused outright rather than widened (SUBJECT_SCOPED_ROLES).
       --
       -- A LIVE link is verified, started and not ended. Verification is what
       -- turns a claimed relationship into a permission, and 'pending' is the
       -- column default, so nothing reaches a child until somebody at the
       -- school put their name to the link.
       AND CASE WHEN a.role = ANY (ARRAY['guardian', 'selfaccess', 'enquiry']::text[]) THEN
             -- A role that only means anything ABOUT SOMEBODY. It must name a
             -- live person, and then reaches that person and rows with no
             -- person dimension (a fixture: which is how a parent sees when
             -- their child is playing). Name nobody live and it reaches
             -- nothing at all — not the school, not a fixture.
             EXISTS (SELECT 1 FROM assignment_subject g
                      WHERE g.assignment_id = a.id
                        AND g.verification_state = 'verified'
                        AND g.valid_from <= current_date
                        AND (g.valid_until IS NULL OR g.valid_until > current_date))
             AND (p_person = '00000000-0000-0000-0000-000000000000'::uuid
                  OR (p_person IS NOT NULL AND EXISTS (
                        SELECT 1 FROM assignment_subject g
                         WHERE g.assignment_id = a.id AND g.player_id = p_person
                           AND g.verification_state = 'verified'
                           AND g.valid_from <= current_date
                           AND (g.valid_until IS NULL OR g.valid_until > current_date))))
           ELSE
             -- Everyone else. Naming nobody means "about nobody in
             -- particular", scoped by school and team, which is how a coach
             -- reaches their squad. The NOT EXISTS counts EVERY row, live or
             -- not: filtering it to live links would mean that revoking the
             -- last link turns a person-scoped assignment into a school-wide
             -- one, so revocation would WIDEN access.
             NOT EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id)
             OR p_person = '00000000-0000-0000-0000-000000000000'::uuid
             OR (p_person IS NOT NULL AND EXISTS (
                   SELECT 1 FROM assignment_subject g
                    WHERE g.assignment_id = a.id AND g.player_id = p_person
                      AND g.verification_state = 'verified'
                      AND g.valid_from <= current_date
                      AND (g.valid_until IS NULL OR g.valid_until > current_date)))
           END
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION app_can(text, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can(text, uuid, text, uuid, uuid) TO PUBLIC;

-- app_holds(capability) — does this person hold the capability AT ALL?
--
-- app_can() asks whether someone may act on a particular ROW, and every
-- governed row belongs to a tenant. A few decisions have no row and no tenant:
-- verifying a scout's accreditation, or turning a product feature off across
-- the whole platform. There is no ANY_SCOPE for school, so handing app_can() a
-- placeholder anchor does not widen it — it refuses everyone, silently, which
-- is exactly what happened the first time the scouting register tried it.
--
-- This is that same existence check with the scope arms removed, and it has a
-- name because it had already been written out by hand three times. Each copy
-- repeated the valid_from IS NULL comparison that silently refused every
-- open-ended assignment until it was found, and every copy omitted a.active
-- — so a deactivated assignment still passed them. One of those is a bug that
-- was caught; the other was not, and that is the argument for one definition.
--
-- NOT a bypass. Holding a capability somewhere is not permission to touch a
-- particular school's rows: anything with a tenant still goes through
-- app_can(), and this answers only the tenant-less question.
CREATE OR REPLACE FUNCTION app_holds(p_capability text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
      JOIN capability c
        ON c.name = rc.capability
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (NOT c.platform_only OR a.school_id IS NULL)
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION app_holds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_holds(text) TO PUBLIC;

-- There is deliberately NO can_score(role) here. It existed, it was correct,
-- and nothing called it after the scoring policies moved to app_can() — which
-- makes it worse than useless: a role-shaped decision function sitting in the
-- schema is an invitation to reach for it, and reaching for it reintroduces
-- the exact hole ADR 0001 closed (a role the session asserts, evaluated
-- without a scope). Scoring authority is app_can('scoring.edit', ...) against
-- the assignments the database looks up, and there is no second way to ask.
-- app_may_grant(role) — may the caller appoint somebody to this role?
--
-- Two questions, both of which have to answer yes. Whether the caller's own
-- roles list this one as grantable, and — for a role carrying a tenant-less
-- capability — whether the caller's assignment is itself tenant-less. The
-- second is what stops a school-scoped grant of a platform role.
CREATE OR REPLACE FUNCTION app_may_grant(p_role text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_grantable g ON g.granter = a.role AND g.role = p_role
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       -- A role carrying a platform capability may only be handed out by
       -- somebody whose own assignment belongs to no school.
       AND (a.school_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM role_capability rc
                JOIN capability c ON c.name = rc.capability AND c.platform_only
               WHERE rc.role = p_role))
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION app_may_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_may_grant(text) TO PUBLIC;

-- ── Assertion ──────────────────────────────────────────────────────
DO $check$
DECLARE
  f   text;
  o   oid;
BEGIN
  FOREACH f IN ARRAY ARRAY['app_can(text,uuid,text,uuid,uuid)', 'app_holds(text)', 'app_may_grant(text)'] LOOP
    o := to_regprocedure(f);
    IF o IS NULL THEN
      RAISE EXCEPTION 'db/35: % is missing', f;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = o) THEN
      RAISE EXCEPTION 'db/35: % is no longer SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
                    WHERE p.oid = o AND c = 'search_path=pg_catalog, public, pg_temp') THEN
      RAISE EXCEPTION 'db/35: % does not pin its search_path', f;
    END IF;
    IF (SELECT prosrc FROM pg_proc WHERE oid = o) NOT LIKE '%duty_suspension s%s.lifted_at IS NULL%' THEN
      RAISE EXCEPTION 'db/35: % does not read the suspension', f;
    END IF;
    IF (SELECT prosrc FROM pg_proc WHERE oid = o) NOT LIKE '%a.expires_at IS NULL OR a.expires_at > now()%' THEN
      RAISE EXCEPTION 'db/35: % lost db/23''s hour hand', f;
    END IF;
  END LOOP;
END $check$;
