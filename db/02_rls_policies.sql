-- SCRBRD — Row-Level Security & column masking
-- GENERATED from rls/policy.mjs by rls/generate-rls.mjs — DO NOT EDIT BY HAND.
-- Regenerate after any policy change. Companion: schema_scoring.sql.

-- ══════════════════════════════════════════════════════════════════
--  Session principal helpers
-- ══════════════════════════════════════════════════════════════════
-- Principal helpers (set from the JWT on every request via set_config).
-- app_user_id / app_role / app_school_id already exist in schema_scoring.sql.
CREATE OR REPLACE FUNCTION app_player_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.player_id', true), '')::uuid $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_child_ids() RETURNS uuid[] AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.child_ids', true), ''), ',')::uuid[], '{}') $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_teams() RETURNS text[] AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.teams', true), ''), ','), '{}') $$ LANGUAGE sql STABLE;

-- ══════════════════════════════════════════════════════════════════
--  Policy functions (derived from POLICY)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION rbac_scope(p_role text, p_resource text)
RETURNS text AS $$
  SELECT CASE
    WHEN p_role = 'superadmin' THEN 'all'
    WHEN p_role = 'superadmin' AND p_resource = 'players' THEN 'all'
    WHEN p_role = 'superadmin' AND p_resource = 'profiles' THEN 'all'
    WHEN p_role = 'superadmin' AND p_resource = 'injuries' THEN 'all'
    WHEN p_role = 'superadmin' AND p_resource = 'matches' THEN 'all'
    WHEN p_role = 'platformsupport' AND p_resource = 'players' THEN 'all'
    WHEN p_role = 'platformsupport' AND p_resource = 'profiles' THEN 'all'
    WHEN p_role = 'platformsupport' AND p_resource = 'injuries' THEN 'all'
    WHEN p_role = 'platformsupport' AND p_resource = 'matches' THEN 'all'
    WHEN p_role = 'headmaster' AND p_resource = 'players' THEN 'school'
    WHEN p_role = 'headmaster' AND p_resource = 'profiles' THEN 'school'
    WHEN p_role = 'headmaster' AND p_resource = 'injuries' THEN 'school'
    WHEN p_role = 'headmaster' AND p_resource = 'matches' THEN 'school'
    WHEN p_role = 'sportsmaster' AND p_resource = 'players' THEN 'school'
    WHEN p_role = 'sportsmaster' AND p_resource = 'profiles' THEN 'school'
    WHEN p_role = 'sportsmaster' AND p_resource = 'injuries' THEN 'school'
    WHEN p_role = 'sportsmaster' AND p_resource = 'matches' THEN 'school'
    WHEN p_role = 'schooladmin' AND p_resource = 'players' THEN 'school'
    WHEN p_role = 'schooladmin' AND p_resource = 'profiles' THEN 'school'
    WHEN p_role = 'schooladmin' AND p_resource = 'injuries' THEN 'school'
    WHEN p_role = 'schooladmin' AND p_resource = 'matches' THEN 'school'
    WHEN p_role = 'financeadmin' AND p_resource = 'players' THEN 'none'
    WHEN p_role = 'financeadmin' AND p_resource = 'profiles' THEN 'school'
    WHEN p_role = 'financeadmin' AND p_resource = 'injuries' THEN 'none'
    WHEN p_role = 'financeadmin' AND p_resource = 'matches' THEN 'none'
    WHEN p_role = 'headcoach' AND p_resource = 'players' THEN 'school'
    WHEN p_role = 'headcoach' AND p_resource = 'profiles' THEN 'school'
    WHEN p_role = 'headcoach' AND p_resource = 'injuries' THEN 'school'
    WHEN p_role = 'headcoach' AND p_resource = 'matches' THEN 'school'
    WHEN p_role = 'coach' AND p_resource = 'players' THEN 'team'
    WHEN p_role = 'coach' AND p_resource = 'profiles' THEN 'team'
    WHEN p_role = 'coach' AND p_resource = 'injuries' THEN 'team'
    WHEN p_role = 'coach' AND p_resource = 'matches' THEN 'team'
    WHEN p_role = 'assistant' AND p_resource = 'players' THEN 'team'
    WHEN p_role = 'assistant' AND p_resource = 'profiles' THEN 'team'
    WHEN p_role = 'assistant' AND p_resource = 'injuries' THEN 'team'
    WHEN p_role = 'assistant' AND p_resource = 'matches' THEN 'team'
    WHEN p_role = 'analyst' AND p_resource = 'players' THEN 'school'
    WHEN p_role = 'analyst' AND p_resource = 'profiles' THEN 'school'
    WHEN p_role = 'analyst' AND p_resource = 'injuries' THEN 'none'
    WHEN p_role = 'analyst' AND p_resource = 'matches' THEN 'school'
    WHEN p_role = 'scorer' AND p_resource = 'players' THEN 'none'
    WHEN p_role = 'scorer' AND p_resource = 'profiles' THEN 'none'
    WHEN p_role = 'scorer' AND p_resource = 'injuries' THEN 'none'
    WHEN p_role = 'scorer' AND p_resource = 'matches' THEN 'team'
    WHEN p_role = 'medical' AND p_resource = 'players' THEN 'school'
    WHEN p_role = 'medical' AND p_resource = 'profiles' THEN 'school'
    WHEN p_role = 'medical' AND p_resource = 'injuries' THEN 'school'
    WHEN p_role = 'medical' AND p_resource = 'matches' THEN 'none'
    WHEN p_role = 'groundskeeper' AND p_resource = 'players' THEN 'none'
    WHEN p_role = 'groundskeeper' AND p_resource = 'profiles' THEN 'none'
    WHEN p_role = 'groundskeeper' AND p_resource = 'injuries' THEN 'none'
    WHEN p_role = 'groundskeeper' AND p_resource = 'matches' THEN 'school'
    WHEN p_role = 'driver' AND p_resource = 'players' THEN 'none'
    WHEN p_role = 'driver' AND p_resource = 'profiles' THEN 'none'
    WHEN p_role = 'driver' AND p_resource = 'injuries' THEN 'none'
    WHEN p_role = 'driver' AND p_resource = 'matches' THEN 'school'
    WHEN p_role = 'player' AND p_resource = 'players' THEN 'none'
    WHEN p_role = 'player' AND p_resource = 'profiles' THEN 'own'
    WHEN p_role = 'player' AND p_resource = 'injuries' THEN 'own'
    WHEN p_role = 'player' AND p_resource = 'matches' THEN 'own'
    WHEN p_role = 'parent' AND p_resource = 'players' THEN 'none'
    WHEN p_role = 'parent' AND p_resource = 'profiles' THEN 'own'
    WHEN p_role = 'parent' AND p_resource = 'injuries' THEN 'own'
    WHEN p_role = 'parent' AND p_resource = 'matches' THEN 'school'
    WHEN p_role = 'spectator' AND p_resource = 'players' THEN 'none'
    WHEN p_role = 'spectator' AND p_resource = 'profiles' THEN 'none'
    WHEN p_role = 'spectator' AND p_resource = 'injuries' THEN 'none'
    WHEN p_role = 'spectator' AND p_resource = 'matches' THEN 'school'
    ELSE 'none'
  END
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION rbac_can_read(
  p_resource text, p_school uuid, p_team text, p_owner uuid)
RETURNS boolean AS $$
DECLARE v_scope text := rbac_scope(app_role(), p_resource);
BEGIN
  RETURN CASE v_scope
    WHEN 'all'    THEN true
    WHEN 'school' THEN p_school = app_school_id()
    WHEN 'team'   THEN p_team = ANY(app_teams())
    WHEN 'own'    THEN p_owner = app_player_id() OR p_owner = ANY(app_child_ids())
    ELSE false
  END;
END $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION rbac_can_write(p_resource text, p_action text)
RETURNS boolean AS $$
  SELECT CASE
    WHEN app_role() = 'superadmin' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'players' AND p_action = 'create' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'players' AND p_action = 'update' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'players' AND p_action = 'delete' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'profiles' AND p_action = 'create' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'profiles' AND p_action = 'delete' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'injuries' AND p_action = 'create' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'injuries' AND p_action = 'update' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'injuries' AND p_action = 'delete' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'matches' AND p_action = 'create' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'matches' AND p_action = 'update' THEN true
    WHEN app_role() = 'superadmin' AND p_resource = 'matches' AND p_action = 'delete' THEN true
    WHEN app_role() = 'headmaster' AND p_resource = 'players' AND p_action = 'update' THEN true
    WHEN app_role() = 'headmaster' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'headmaster' AND p_resource = 'injuries' AND p_action = 'update' THEN true
    WHEN app_role() = 'headmaster' AND p_resource = 'matches' AND p_action = 'update' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'players' AND p_action = 'create' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'players' AND p_action = 'update' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'players' AND p_action = 'delete' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'profiles' AND p_action = 'create' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'profiles' AND p_action = 'delete' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'injuries' AND p_action = 'create' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'injuries' AND p_action = 'update' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'injuries' AND p_action = 'delete' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'matches' AND p_action = 'create' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'matches' AND p_action = 'update' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'matches' AND p_action = 'delete' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'players' AND p_action = 'create' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'players' AND p_action = 'update' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'players' AND p_action = 'delete' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'profiles' AND p_action = 'create' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'profiles' AND p_action = 'delete' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'injuries' AND p_action = 'create' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'injuries' AND p_action = 'update' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'injuries' AND p_action = 'delete' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'matches' AND p_action = 'create' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'matches' AND p_action = 'update' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'matches' AND p_action = 'delete' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_action = 'create' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_action = 'delete' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'players' AND p_action = 'create' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'players' AND p_action = 'update' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'players' AND p_action = 'delete' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'profiles' AND p_action = 'create' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'profiles' AND p_action = 'delete' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'injuries' AND p_action = 'create' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'injuries' AND p_action = 'update' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'injuries' AND p_action = 'delete' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'matches' AND p_action = 'create' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'matches' AND p_action = 'update' THEN true
    WHEN app_role() = 'headcoach' AND p_resource = 'matches' AND p_action = 'delete' THEN true
    WHEN app_role() = 'coach' AND p_resource = 'players' AND p_action = 'create' THEN true
    WHEN app_role() = 'coach' AND p_resource = 'players' AND p_action = 'update' THEN true
    WHEN app_role() = 'coach' AND p_resource = 'profiles' AND p_action = 'create' THEN true
    WHEN app_role() = 'coach' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'coach' AND p_resource = 'injuries' AND p_action = 'create' THEN true
    WHEN app_role() = 'coach' AND p_resource = 'injuries' AND p_action = 'update' THEN true
    WHEN app_role() = 'coach' AND p_resource = 'matches' AND p_action = 'create' THEN true
    WHEN app_role() = 'coach' AND p_resource = 'matches' AND p_action = 'update' THEN true
    WHEN app_role() = 'assistant' AND p_resource = 'players' AND p_action = 'update' THEN true
    WHEN app_role() = 'assistant' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'assistant' AND p_resource = 'injuries' AND p_action = 'update' THEN true
    WHEN app_role() = 'assistant' AND p_resource = 'matches' AND p_action = 'update' THEN true
    WHEN app_role() = 'scorer' AND p_resource = 'matches' AND p_action = 'create' THEN true
    WHEN app_role() = 'scorer' AND p_resource = 'matches' AND p_action = 'update' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'players' AND p_action = 'create' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'players' AND p_action = 'update' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'players' AND p_action = 'delete' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'profiles' AND p_action = 'create' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'profiles' AND p_action = 'update' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'profiles' AND p_action = 'delete' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'injuries' AND p_action = 'create' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'injuries' AND p_action = 'update' THEN true
    WHEN app_role() = 'medical' AND p_resource = 'injuries' AND p_action = 'delete' THEN true
    WHEN app_role() = 'groundskeeper' AND p_resource = 'matches' AND p_action = 'update' THEN true
    ELSE false
  END
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION rbac_field_denied(p_resource text, p_field text)
RETURNS boolean AS $$
  SELECT CASE
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'email' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'phone' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'born' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'address' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'height' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'players' AND p_field = 'weight' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'email' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'phone' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'born' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'address' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'height' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'weight' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'email' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'phone' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'born' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'address' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'height' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'profiles' AND p_field = 'weight' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'email' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'phone' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'born' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'address' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'height' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'weight' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'notes' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'injuries' AND p_field = 'physio' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'email' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'phone' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'born' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'address' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'height' THEN true
    WHEN app_role() = 'platformsupport' AND p_resource = 'matches' AND p_field = 'weight' THEN true
    WHEN app_role() = 'headmaster' AND p_resource = 'injuries' AND p_field = 'notes' THEN true
    WHEN app_role() = 'headmaster' AND p_resource = 'injuries' AND p_field = 'physio' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'injuries' AND p_field = 'notes' THEN true
    WHEN app_role() = 'sportsmaster' AND p_resource = 'injuries' AND p_field = 'physio' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'injuries' AND p_field = 'notes' THEN true
    WHEN app_role() = 'schooladmin' AND p_resource = 'injuries' AND p_field = 'physio' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'born' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'height' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'weight' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'born' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'height' THEN true
    WHEN app_role() = 'financeadmin' AND p_resource = 'profiles' AND p_field = 'weight' THEN true
    WHEN app_role() = 'assistant' AND p_resource = 'injuries' AND p_field = 'notes' THEN true
    WHEN app_role() = 'assistant' AND p_resource = 'injuries' AND p_field = 'physio' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'email' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'phone' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'born' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'address' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'height' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'players' AND p_field = 'weight' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'email' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'phone' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'born' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'address' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'height' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'weight' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'email' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'phone' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'born' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'address' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'height' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'profiles' AND p_field = 'weight' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'email' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'phone' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'born' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'address' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'height' THEN true
    WHEN app_role() = 'analyst' AND p_resource = 'matches' AND p_field = 'weight' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'email' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'phone' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'born' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'hometown' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'houseAtSchool' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'address' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'guardian' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'height' THEN true
    WHEN app_role() = 'spectator' AND p_resource = 'matches' AND p_field = 'weight' THEN true
    ELSE false
  END
$$ LANGUAGE sql STABLE;

-- ══════════════════════════════════════════════════════════════════
--  Per-table RLS policies
-- ══════════════════════════════════════════════════════════════════
-- player (lens: players)
ALTER TABLE player ENABLE ROW LEVEL SECURITY;
CREATE POLICY player_rbac_read ON player
  FOR SELECT USING (
    rbac_can_read('players', school_id, team_code, id)
  );
CREATE POLICY player_rbac_insert ON player
  FOR INSERT WITH CHECK (
    rbac_can_write('players', 'create') AND school_id = app_school_id()
  );
CREATE POLICY player_rbac_update ON player
  FOR UPDATE USING (
    rbac_can_write('players', 'update')
    AND rbac_can_read('players', school_id, team_code, id)
  );

-- coach (lens: profiles)
ALTER TABLE coach ENABLE ROW LEVEL SECURITY;
CREATE POLICY coach_rbac_read ON coach
  FOR SELECT USING (
    rbac_can_read('profiles', school_id, team_code, id)
  );
CREATE POLICY coach_rbac_insert ON coach
  FOR INSERT WITH CHECK (
    rbac_can_write('profiles', 'create') AND school_id = app_school_id()
  );
CREATE POLICY coach_rbac_update ON coach
  FOR UPDATE USING (
    rbac_can_write('profiles', 'update')
    AND rbac_can_read('profiles', school_id, team_code, id)
  );

-- staff (lens: profiles)
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_rbac_read ON staff
  FOR SELECT USING (
    rbac_can_read('profiles', school_id, NULL::text, id)
  );
CREATE POLICY staff_rbac_insert ON staff
  FOR INSERT WITH CHECK (
    rbac_can_write('profiles', 'create') AND school_id = app_school_id()
  );
CREATE POLICY staff_rbac_update ON staff
  FOR UPDATE USING (
    rbac_can_write('profiles', 'update')
    AND rbac_can_read('profiles', school_id, NULL::text, id)
  );

-- injury (lens: injuries)
-- injury row anchors resolve through the linked player (team + school).
ALTER TABLE injury ENABLE ROW LEVEL SECURITY;
CREATE POLICY injury_rbac_read ON injury
  FOR SELECT USING (
    rbac_can_read('injuries', school_id, (SELECT team_code FROM player WHERE player.id = injury.player_id), player_id)
  );
CREATE POLICY injury_rbac_insert ON injury
  FOR INSERT WITH CHECK (
    rbac_can_write('injuries', 'create') AND school_id = app_school_id()
  );
CREATE POLICY injury_rbac_update ON injury
  FOR UPDATE USING (
    rbac_can_write('injuries', 'update')
    AND rbac_can_read('injuries', school_id, (SELECT team_code FROM player WHERE player.id = injury.player_id), player_id)
  );

-- match (lens: matches)
ALTER TABLE match ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_rbac_read ON match
  FOR SELECT USING (
    rbac_can_read('matches', school_id, team_code, NULL::uuid)
  );
CREATE POLICY match_rbac_insert ON match
  FOR INSERT WITH CHECK (
    rbac_can_write('matches', 'create') AND school_id = app_school_id()
  );
CREATE POLICY match_rbac_update ON match
  FOR UPDATE USING (
    rbac_can_write('matches', 'update')
    AND rbac_can_read('matches', school_id, team_code, NULL::uuid)
  );

-- ══════════════════════════════════════════════════════════════════
--  Column-masking views (field/PII deny)
-- ══════════════════════════════════════════════════════════════════
-- Read player through this view; base-table PII is masked per role.
-- Assembled from information_schema so every column is listed explicitly.
DO $mask_player$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN c.column_name = ANY (ARRAY['email', 'phone', 'born', 'hometown', 'houseatschool', 'address', 'guardian', 'height', 'weight'])
                THEN format('CASE WHEN rbac_field_denied(%L, %L) THEN NULL ELSE %I END AS %I',
                            'players', c.column_name, c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'player';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build player_masked: table player not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW player_masked WITH (security_barrier = true) AS SELECT %s FROM player',
    cols);
END
$mask_player$;

-- Read coach through this view; base-table PII is masked per role.
-- Assembled from information_schema so every column is listed explicitly.
DO $mask_coach$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN c.column_name = ANY (ARRAY['email', 'phone', 'born', 'hometown', 'address'])
                THEN format('CASE WHEN rbac_field_denied(%L, %L) THEN NULL ELSE %I END AS %I',
                            'profiles', c.column_name, c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'coach';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build coach_masked: table coach not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW coach_masked WITH (security_barrier = true) AS SELECT %s FROM coach',
    cols);
END
$mask_coach$;

-- Read staff through this view; base-table PII is masked per role.
-- Assembled from information_schema so every column is listed explicitly.
DO $mask_staff$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN c.column_name = ANY (ARRAY['email', 'phone', 'born', 'hometown', 'address'])
                THEN format('CASE WHEN rbac_field_denied(%L, %L) THEN NULL ELSE %I END AS %I',
                            'profiles', c.column_name, c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'staff';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build staff_masked: table staff not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW staff_masked WITH (security_barrier = true) AS SELECT %s FROM staff',
    cols);
END
$mask_staff$;

-- Read injury through this view; base-table PII is masked per role.
-- Assembled from information_schema so every column is listed explicitly.
DO $mask_injury$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN c.column_name = ANY (ARRAY['notes', 'physio'])
                THEN format('CASE WHEN rbac_field_denied(%L, %L) THEN NULL ELSE %I END AS %I',
                            'injuries', c.column_name, c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'injury';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build injury_masked: table injury not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW injury_masked WITH (security_barrier = true) AS SELECT %s FROM injury',
    cols);
END
$mask_injury$;

-- ══════════════════════════════════════════════════════════════════
--  Scoring capability (mirrors canScore) — used by ball_event policies in schema_scoring.sql
-- ══════════════════════════════════════════════════════════════════
-- Roles that may score: superadmin, sportsmaster, headcoach, coach, assistant, scorer
