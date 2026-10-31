-- ══════════════════════════════════════════════════════════════════
--  128 · The SA day: every "live today" check reads sa_today()
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN (its table of bodies is read from the catalog, below).
-- Kameel's call, Season rollover design, the quiet-week item: every "live
-- today" check moves to sa_today() in one migration. Done before this file:
-- the side moves (db/122) and consent_giver_live() (db/125).
--
-- THE FAULT. The database's day is UTC. sa_today() (db/08) is the day in
-- Johannesburg, where the cricket is played. Between 00:00 and 02:00 SAST
-- current_date is still yesterday, so a role, a guardian link or an
-- assignment that ended "yesterday" in South Africa still reads live, and
-- one that starts "today" does not yet. It is the API walks' red between
-- 00:00 and 02:00 SAST (31 Oct 2026, 01:01 SAST, #224 and #225, three API
-- shards, green on re-run).
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
-- Every function, view and column default in the schema that reads the
-- database's day. Found in the catalog (pg_proc.prosrc and argument
-- defaults, pg_views, pg_attrdef, pg_policies, CHECK constraints) for
-- current_date, CURRENT_DATE, now()::date, current_timestamp::date and
-- localtimestamp, after every migration to db/126: no policy and no CHECK
-- reads the clock itself (each asks one of these functions), and only
-- current_date was spelled. Each function's latest definition, the file and
-- line this file replaces it from:
--
--   access_request_decide(uuid,boolean,text,integer)            db/08:742   3× current_date
--   account_offboard_preview(uuid)                              db/90:231   4× current_date
--   app_can(text,uuid,text,uuid,uuid)                           db/50:197   8× current_date
--   app_enrolled()                                              db/81:88    4× current_date
--   app_enrolled_at(uuid)                                       db/107:150  4× current_date
--   app_holds(text)                                             db/50:282   2× current_date
--   app_is_platform_wide()                                      db/22:244   2× current_date
--   app_may_assign_at_for(uuid,uuid)                            db/92:155   2× current_date
--   app_may_grant(text)                                         db/50:305   2× current_date
--   app_may_grant_at(text,uuid)                                 db/77:116   2× current_date
--   app_may_grant_at_for(uuid,text,uuid)                        db/92:143   2× current_date
--   auth_holds_superadmin(uuid)                                 db/81:277   2× current_date
--   auth_identity_pupil_consent()                               db/81:227   3× current_date
--   auth_office_refusal(uuid)                                   db/81:308   4× current_date
--   availability_ask_again()                                    db/65:291   4× current_date
--   broadcast_state(uuid)                                       db/71:716   1× current_date
--   clearance_register(uuid)                                    db/56:194   4× current_date
--   clearance_status(uuid,uuid,text)                            db/08:4909  2× current_date
--   coaching_point_write(uuid,uuid,text,jsonb)                  db/104:357  1× current_date
--   dob_gaps()                                                  db/19:26    2× current_date
--   dso_people_at(uuid)                                         db/57:259   2× current_date
--   guardian_consent_record(uuid,uuid,text)                     db/08:1125  1× current_date
--   guardian_consent_withdraw(uuid,uuid)                        db/08:1177  1× current_date
--   guardian_link_establish(uuid,uuid,text)                     db/62:93    2× current_date
--   guardian_link_revoke(uuid,text,text)                        db/109:221  6× current_date
--   guardian_link_revoke(uuid,uuid,text)                        db/08:1050  5× current_date
--   guardian_link_verify(uuid,uuid,text,text)                   db/08:987   1× current_date
--   guardian_links_reopen_at_school(uuid)                       db/109:423  1× current_date
--   health_giver_link_live(uuid)                                db/60:253   4× current_date
--   is_family_of(uuid)                                          db/119:151  4× current_date
--   lift_acting_for(uuid)                                       db/70:1351  2× current_date
--   lift_at_school(uuid)                                        db/70:409   2× current_date
--   lift_family_at(uuid,uuid,text)                              db/70:261   4× current_date
--   lift_is_pupil(uuid)                                         db/70:221   1× current_date
--   lift_link_is_live(uuid)                                     db/70:310   4× current_date
--   lift_live_link(uuid,uuid,text)                              db/70:287   4× current_date
--   lift_staff(uuid,text,text)                                  db/76:160   2× current_date
--   my_alert_choices()                                          db/120:218  4× current_date
--   my_health_consents()                                        db/60:522   4× current_date
--   my_own_boy()                                                db/106:245  4× current_date
--   news_sheet_reach(uuid,uuid,text)                            db/101:118  4× current_date
--   official_conflict(uuid,uuid)                                db/107:238  1× current_date
--   official_level(uuid,date)                                   db/08:1665  argument default
--   owner_recovery_issue(text,text,integer)                     db/18:24    2× current_date
--   passport_consent_writer_ok(uuid)                            db/125:406  4× current_date
--   passport_union_log(uuid,uuid,text)                          db/124:566  2× current_date
--   person_is_pupil(uuid)                                       db/57:292   1× current_date
--   person_live_at(uuid,uuid,text[])                            db/57:276   2× current_date
--   person_pupil_of_age(uuid)                                   db/116:555  1× current_date
--   player_guardian_link_counts(uuid)                           db/08:1256  6× current_date
--   player_own_accounts(uuid)                                   db/112:168  8× current_date
--   public_name_live_link(uuid,uuid,text)                       db/47:285   4× current_date
--   push_candidates(uuid)                                       db/08:3749  2× current_date
--   register_claim(uuid)                                        db/92:604   1× current_date
--   register_redact_due(uuid)                                   db/92:787   1× current_date, 1× an instant's ::date
--   register_upload(uuid,jsonb,boolean,uuid[])                  db/92:380   6× current_date, 2× an instant's ::date
--   result_confirm_platform()                                   db/114:388  4× current_date
--   result_official_notices(uuid,text,timestamptz)              db/114:642  2× current_date
--   result_school_holds(uuid,text,uuid)                         db/114:412  2× current_date
--   reward_weight_at(text,date)                                 db/08:3909  argument default
--   role_assignment_end(uuid,text)                              db/77:287   11× current_date
--   role_assignment_ending_links()                              db/109:324  1× current_date
--   role_request_grant_as(uuid,uuid,text,uuid,text)             db/108:183 (re-emitted over 92:229) 1× current_date
--   safeguarding_family(uuid)                                   db/109:461  2× current_date
--   safeguarding_share(uuid,uuid,text[],timestamptz,text,uuid)  db/57:1244  2× current_date
--   school_register_rows(uuid,text)                             db/116:227  1× current_date
--   scorebook_import_actors(uuid)                               db/63:1368  1× current_date
--   scorebook_school_grant(text[],uuid)                         db/63:684   2× current_date
--   scouting_consent_set(uuid,boolean)                          db/125:436  9× current_date
--   support_access_begin(uuid,text,text,text,integer)           db/57:618   1× current_date
--   target_set(uuid,text,text,integer,date,uuid,uuid)           db/105:168  1× current_date
--   trip_contacts(uuid)                                         db/116:920  1× current_date, 5× an instant's ::date
--   trip_vehicle_fits()                                         db/08:2829  2× current_date, 2× an instant's ::date
--
-- Each body is re-emitted from the catalog (pg_get_functiondef, as db/77,
-- db/86, db/108 and db/123 re-emit theirs), with two words changed and
-- nothing else:
--   current_date              → sa_today()
--   <instant>::date           → sa_date(<instant>)   (db/117)
-- The second is the same fault spelled differently: a timestamptz cast to a
-- date takes the session's (UTC's) day. Four of the bodies above do it, all
-- on the same rows as their current_date: trip_contacts()'s window (a
-- departure's day against today), trip_vehicle_fits()'s cover (the day of
-- departure against an insurance date), register_redact_due()'s 90 days
-- from a withdrawal, and register_upload()'s "ended on" days. Grants,
-- SECURITY DEFINER, search_path, volatility and owner are the catalog's own,
-- and the re-emit checks each is unchanged.
--
-- Views (re-created with their own WITH options; grants kept):
--   player_band_change_due   db/08:453    next birthday, days until, the 30-day window
--   player_guardian_status   db/08:1279   is_minor
-- Column defaults (the day a row is stamped with, when the writer gives
-- none):
--   assignment_subject.valid_from  db/00:560     player_skill.assessed_on      db/08:185
--   development_note.observed_on   db/08:1880    team_membership.joined_on     db/08:4265
--   development_target.set_on      db/105:106    disciplinary_record.occurred_on db/25:69
-- A default moves with its reader: a link stamped with sa_today() at 00:30
-- SAST is live at once to a check on sa_today(), as it was to one on
-- current_date before.
--
-- ── WHAT DOES NOT MOVE, AND WHY ─────────────────────────────────────
--   * scout_accreditation_register(text,text): current_date only in a
--     comment. Its body has no clock.
--   * Every comparison with now(): expires_at, a support session's end, a
--     login code, the consent's own given_at, a lease. Those are instants,
--     the same moment everywhere; the fault is only in days.
--   * The bodies already on Johannesburg's day: consent_giver_live() (db/125),
--     side_on() and the side moves (db/117, db/122), the lifts' days
--     (db/70: `AT TIME ZONE 'Africa/Johannesburg'`), bowler_day() and the
--     load model (db/08, db/94).
--   * db/01, db/09, db/23, db/35, db/39 (generate-rls.mjs's output) still
--     spell current_date: they are shipped history and never move. The live
--     app_can(), app_holds(), app_may_grant() and app_is_platform_wide() are
--     the hand-written ones re-emitted here.
--   * The API's own SQL (services/api) is not schema; it moves in the same
--     change, in code, so a row this file stamps with sa_today() is read on
--     the same day there.
--
-- ── THE CHANGE, IN ONE LIST ─────────────────────────────────────────
--   73 functions: bodies (and two argument defaults) re-emitted as above;
--     grants, definer, search_path, volatility unchanged
--   views player_band_change_due, player_guardian_status: re-created, their
--     WITH options and grants unchanged
--   six column defaults: CURRENT_DATE → sa_today()
--   anon, authenticated, service_role: revoked on every one of them, where
--     those roles exist (a hosted database's), as db/125 does
-- No table, column, capability, role or policy. A second paste changes
-- nothing. No file before this one can be pasted again after it where its
-- guard reads one of these bodies (db/119's reads is_family_of()'s).
--
-- THE GUARD keys on pg_proc.prosrc: the md5 of each body, its whitespace
-- folded, must be the shipped one or this file's. A body moved by another
-- file since db/126 (db/127 moves none of these) stops the paste.
--
-- Its proof is db/99 §105: each body at 23:30 SAST on day N and at 00:30
-- SAST on day N+1 under a pinned clock, and one guard broken and restored.


-- ── 0 · What this file was written against ──────────────────────────
-- The table of bodies, the transform and the fold: session-local helpers,
-- dropped at the end of the file.
CREATE OR REPLACE FUNCTION pg_temp._v128_fns()
RETURNS TABLE (fn text, was text, mine text, secdef boolean, vol text, app_exec boolean, public_exec boolean) AS $$
  VALUES
      ('access_request_decide(uuid,boolean,text,integer)', 'a97e1e1a8bc4254e688966cc444dc8a0', 'ee6dac388c0a103d46f3fa00e9e190b7', true, 'v', true, true),
      ('account_offboard_preview(uuid)', '2cf96b6da69e7eea5b218e1c16584479', '0a6f42eff5278b80317e8b523c6eb07a', true, 's', true, false),
      ('app_can(text,uuid,text,uuid,uuid)', '2bd900a8608b71501c5debd0ccce48ce', 'f2104665f4ea2207c6d9165b6206785c', true, 's', true, true),
      ('app_enrolled()', '0e0c16510d5ab7fd460afb1e65b6362a', '2fec84b71ae669120eab9e13e075f27c', true, 's', true, false),
      ('app_enrolled_at(uuid)', 'e6219b8aaa793edbac9fdfb9e0985b4b', '32deaa3b577183ed637a101ffa907188', true, 's', true, false),
      ('app_holds(text)', '8d26f9905de6389ff807f82aa8e7d9da', '70aeb7530cde5d3415023a83df8cb3bd', true, 's', true, true),
      ('app_is_platform_wide()', '5656d08df7728359e4b0ae6addcf562c', '5232415427b320fe0b0425cf634af3c1', true, 's', true, true),
      ('app_may_assign_at_for(uuid,uuid)', 'f819f3abf91629d794b72f912099e4c6', '61111ccdc3ccd117f303baa15b0c520f', true, 's', false, false),
      ('app_may_grant(text)', '437b9ac005d65d16d21aaaab47014e4f', '7b1cd7c7617d4045f13cbca0a5ef3dfe', true, 's', true, true),
      ('app_may_grant_at(text,uuid)', 'd56f35160c791ffeaebb22fff1576b8f', '5b91f4e7a1eb76b8e894ae32eaa54e8e', true, 's', true, false),
      ('app_may_grant_at_for(uuid,text,uuid)', '6ac7e2ecc5840d1e3bf611eee6b4051b', '8fc012de69adc8818cb7d51297d61e05', true, 's', false, false),
      ('auth_holds_superadmin(uuid)', '500634741cbcee8e03dbe2767bae897b', 'ce968fe467612b0280acf0f30aafe24f', true, 's', false, false),
      ('auth_identity_pupil_consent()', 'd42360b68bd9cab42da87cdfad6bda55', '5f18576e683d7e2187cfe4b54785df69', true, 'v', false, false),
      ('auth_office_refusal(uuid)', '292d5e89a2dab90213095cb45196e551', 'e0962675e2bb94ee9f4605713674b60f', true, 's', false, false),
      ('availability_ask_again()', '0a54bd90f03e02c82720a9fb1fe31437', '116c945fb47b3151b165f5f62c831b97', true, 'v', false, false),
      ('broadcast_state(uuid)', '9ea9662b92dae87fee93743a5f829945', '5f412558479db82c3cb32ed21f83656f', true, 's', true, true),
      ('clearance_register(uuid)', '75a15d1344f979334ddb78dd0588a9e4', '112b086853a07e0f4a4d8e9ad4fca040', true, 's', true, false),
      ('clearance_status(uuid,uuid,text)', '2e0e436ded304d32be9aa9926daceeae', 'ed7f4896693f56be50bd13a72c766a9e', true, 's', false, false),
      ('coaching_point_write(uuid,uuid,text,jsonb)', '7f6ee7ca5034543a3ebcd55b62000f18', '4ea0a5860eabfc9abfcdc7587ea73fe3', true, 'v', true, false),
      ('dob_gaps()', '5b3e77fcdbff6a5ddce9dba49e50f27c', 'b7e85e0c98f3572f62a7230092c42547', true, 's', true, true),
      ('dso_people_at(uuid)', '9a61550e7bd8b202e01e32ead9eeab23', '0c55dd7ee9d59aae8ff578481f121591', true, 's', false, false),
      ('guardian_consent_record(uuid,uuid,text)', '4aa20ee9bab87ce2b05c0ed5ba89d2dc', '19510324fd80760e97f8d1a3b140bd4b', true, 'v', true, true),
      ('guardian_consent_withdraw(uuid,uuid)', '9bbea5b7fa441c6ee2183b3c8707b643', '063f73bc1f9089472fdd30c4bcfc937b', true, 'v', true, true),
      ('guardian_link_establish(uuid,uuid,text)', 'c4f75b71c740a3039ac03952737e8568', '6d5ac4437a1b9354caf4badaf2516392', true, 'v', true, true),
      ('guardian_link_revoke(uuid,text,text)', '026d0637cac0f10022ebe23a01d3ada4', '29775324b1f6903d3ba4f68945a47292', true, 'v', true, false),
      ('guardian_link_revoke(uuid,uuid,text)', '34f2c8f5a27afd6b0ef860d5400ed886', '1ce90b14baac6b5ed8f537c401b0b5e3', true, 'v', false, false),
      ('guardian_link_verify(uuid,uuid,text,text)', '583bd83f953cdc5f4b5827bf914c5ac5', '6994458644be91e8ce2a2d83d3b588b9', true, 'v', true, true),
      ('guardian_links_reopen_at_school(uuid)', '559fb38b5a3a708810200d942e60875f', 'e45c9586e53b4f1ba735a0c0be50c205', true, 'v', false, false),
      ('health_giver_link_live(uuid)', '430ea5a1652e12e9c2b0034bef921ef4', '069d8249f46abfc8084207c6a86c6e30', true, 's', false, false),
      ('is_family_of(uuid)', 'df3d415fd2f319b8c92009ae94a52c81', '99dec2cb4ac0a59a7bfa5235ce6e5801', true, 's', true, false),
      ('lift_acting_for(uuid)', '2d0b4cc6b6e226afdad98817839b8b89', 'c006897a7c60d1974c5bbb3a2d40411c', true, 's', false, false),
      ('lift_at_school(uuid)', '805ccb1245a86e0604c50049ca3c5ddb', '44b068c65d22200941536fb93d273e7f', true, 's', true, false),
      ('lift_family_at(uuid,uuid,text)', '3201d994b4c06869e9fed709647a440e', '4951f14ccbd1885c48bb239f789474f7', true, 's', false, false),
      ('lift_is_pupil(uuid)', '669cb07eeea886d20fd734e6e8ed7184', '795fd066099a5a026191726b3033b2d7', true, 's', false, false),
      ('lift_link_is_live(uuid)', '3309d36e55ec65af5f872c70fda139b4', '158de643ab4fab1160d4fa6df6c845a3', true, 's', false, false),
      ('lift_live_link(uuid,uuid,text)', 'b02a66427711a2c45469779868b9f23e', 'a56a07876fbcf0f1388513186b608ae8', true, 's', false, false),
      ('lift_staff(uuid,text,text)', '07bff661d22401d88a47062ef88598bf', '8fb2944a914c156f1963ecdc2d4ff31f', true, 's', false, false),
      ('my_alert_choices()', 'b47d5f55e249d693601fae16d6d5fbb4', 'bb1ad347768fd4a9bb6a5fffd5f61270', true, 's', true, false),
      ('my_health_consents()', '3d20951f4d19731f9957efbc98afefcc', 'c1c2678857cc446d9f0901bcadbde4e2', true, 's', true, false),
      ('my_own_boy()', 'fd671d255a4cb83685a33b08e2fe7bea', 'a084165afe1277871bc85a7766e826bd', true, 's', true, false),
      ('news_sheet_reach(uuid,uuid,text)', '6f3243089d4c0f4851ba069520c27cb1', '853f1f08219cb4c784112b3037c25395', true, 's', true, false),
      ('official_conflict(uuid,uuid)', '1876a517be3ac6463025793f72b162f1', 'c9570693b1547c7c06993d05bb04484d', true, 's', true, false),
      ('official_level(uuid,date)', '06f8438867dc5a9a19dacdf140135d82', '06f8438867dc5a9a19dacdf140135d82', false, 's', true, true),
      ('owner_recovery_issue(text,text,integer)', '844a34636370aa9d67bd8d863574a85d', '4c5acdfd1dcb370dcf282cc759891f22', true, 'v', true, true),
      ('passport_consent_writer_ok(uuid)', 'efcc61cb83f096304255b59d8b219896', 'caf5c16437ea6d8d90308dd344000d2f', true, 's', true, false),
      ('passport_union_log(uuid,uuid,text)', 'f726e7741c32c2d16c48d5d369001e17', '6c0840a26cf78bcd22b90ba1eade0b0b', false, 'v', false, false),
      ('person_is_pupil(uuid)', 'bbce523f7b66c9973508a04473c88514', '23790873365bdf518881feb09aafb51b', true, 's', false, false),
      ('person_live_at(uuid,uuid,text[])', 'b370c273e48ab70c0ffb2fbd71b5e81c', 'd297a6e7c5d28474c9cc8c157eca5bf3', true, 's', false, false),
      ('person_pupil_of_age(uuid)', '5691694504c9b55dd976324d25bbe07f', 'c3592f7289e27bfb898ec7be6edc8c93', true, 's', false, false),
      ('player_guardian_link_counts(uuid)', 'c8ee97bd22c79a13751f30463aaa7a20', 'dd5abed6d0d329a1184de30f3f33e39d', true, 's', true, true),
      ('player_own_accounts(uuid)', '03d0eb1fbaf1ee1daf8c1f0c04d42c92', '52efa36509b1063999faf17f321dd6d9', true, 's', false, false),
      ('public_name_live_link(uuid,uuid,text)', 'e503b255548287b073eae23b3680019b', '78a8ba5e49c6099584130dd625a8b595', true, 's', false, false),
      ('push_candidates(uuid)', 'b193e68cfffac0c026f2f9931cc4eb16', 'f4037f8a8b2e258c811a14406df9f13b', true, 's', true, false),
      ('register_claim(uuid)', '1db399cc282527d74a24a55240b1a75f', 'a224d2038c4869b64e6241c2cb777057', true, 'v', true, false),
      ('register_redact_due(uuid)', 'd4f14620277b7a3dbdbe3979452b7bc0', '6bbb618d5775061220b09fe8a82a64a8', true, 's', true, false),
      ('register_upload(uuid,jsonb,boolean,uuid[])', '2793a7d752e5bb46dc9f5cb530bee5fa', '34d9f57e7432ea68f7900047ec431cbe', true, 'v', true, false),
      ('result_confirm_platform()', '64c74874ea80b63ce3fae0cfe15dc8d7', '70d74fa6b013d7cf9bbf5031f1b80e31', true, 's', false, false),
      ('result_official_notices(uuid,text,timestamptz)', '2ded51e72e007d95a8eb15c78b94078f', '1b199f56f809bc43b6c9637ee1609375', true, 'v', false, false),
      ('result_school_holds(uuid,text,uuid)', 'e92c99db267a426c9f1b1397fc590de1', 'abade9a8054ec7e1ddf50aa92a827d38', true, 's', false, false),
      ('reward_weight_at(text,date)', 'e2f8ce84b6dfa0a5647cd7d8a6f28aa9', 'e2f8ce84b6dfa0a5647cd7d8a6f28aa9', true, 's', true, false),
      ('role_assignment_end(uuid,text)', '6495470ee4ae64975a208c3aeb2e665b', 'b0ac95b7cff917971470308b26953e01', true, 'v', true, false),
      ('role_assignment_ending_links()', '465c6994d693470b35ea2ed7e3485660', 'fc62d66ebd311f9f0b5c333aea04e973', true, 'v', false, false),
      ('role_request_grant_as(uuid,uuid,text,uuid,text)', 'f9317b824323c6e726c1548fd94bf6b6', 'ca0cb9c9bdef12c0684a397cafda7324', true, 'v', false, false),
      ('safeguarding_family(uuid)', '5da5491c4ce9272fb3e08db57f180b7c', '4175ce46bab4e277b455fe4bce7cc7af', true, 'v', true, false),
      ('safeguarding_share(uuid,uuid,text[],timestamptz,text,uuid)', '98e7bff7a4637fb89c9bbe4604bfaa3c', 'be8e17ef16b548227b0b03eae5cb3e75', true, 'v', true, false),
      ('school_register_rows(uuid,text)', '6fb62daf5647dca5d876752f1d11c086', 'd436293e763515e217c9cbecb7bcf0cb', true, 's', true, false),
      ('scorebook_import_actors(uuid)', '0203fdf9e81b135a823f64c1dae78244', '74b1367f62e8980c97cea28b42979f8d', true, 's', true, false),
      ('scorebook_school_grant(text[],uuid)', 'bc46cfe808220ed0ff56ce4a9be44bfc', 'd38550f22c8aa50872bf1d17d9fba291', true, 's', false, false),
      ('scouting_consent_set(uuid,boolean)', '881d579db81625ce6951989fbe17b215', '29cdf35b1984e38414b781090e7c41ab', true, 'v', true, false),
      ('support_access_begin(uuid,text,text,text,integer)', '144a13a6515a714af395e1aeda311d3f', 'ed44daf8f4c7873cd3d9fecdf693baf0', true, 'v', true, true),
      ('target_set(uuid,text,text,integer,date,uuid,uuid)', 'a2619f9d229d017f4147d8566b162a9e', '7febecee7b78363f90ef2476c52c9229', true, 'v', true, false),
      ('trip_contacts(uuid)', '898c73d058365b74939324df19a37084', 'edcfe66184cd68d9cec6b5aafc146570', true, 's', true, false),
      ('trip_vehicle_fits()', 'b441825879d6884100915b63efeac4c0', 'fd3e2ca1d74ea3d705bfcb6d9172623f', true, 'v', true, true)
$$ LANGUAGE sql IMMUTABLE;

-- The day where the cricket is played, in place of the database's.
CREATE OR REPLACE FUNCTION pg_temp._v128_sa(t text) RETURNS text AS $$
  SELECT regexp_replace(
           regexp_replace(
             replace(t, 'coalesce(a.revoked_at, a.created_at)::date', 'sa_date(coalesce(a.revoked_at, a.created_at))'),
             '(\m[A-Za-z_][A-Za-z0-9_]*\.)?(\m[a-z_]*_at)::date\M', 'sa_date(\1\2)', 'g'),
           '\mcurrent_date\M', 'sa_today()', 'gi')
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp._v128_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp._v128_views()
RETURNS TABLE (v text, was text, mine text, opts text) AS $$
  VALUES
      ('player_band_change_due', '1e222192ec2ed61f06e4922db4dae585', 'b18bf1b1b4ffd809b8664441f51cbdcd', 'security_barrier=true, security_invoker=true'),
      ('player_guardian_status', 'c6951d1460d5eab4a9fba8032c917126', 'b28791193d2117920ef74f5073eeaae7', 'security_invoker=true')
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp._v128_defaults()
RETURNS TABLE (tbl text, col text) AS $$
  VALUES ('assignment_subject', 'valid_from'), ('player_skill', 'assessed_on'),
         ('development_note', 'observed_on'), ('team_membership', 'joined_on'),
         ('development_target', 'set_on'), ('disciplinary_record', 'occurred_on')
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE r record; v_src text; v_md5 text; v_def text; n int;
BEGIN
  IF to_regprocedure('sa_today()') IS NULL OR to_regprocedure('sa_date(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'db/128: sa_today() (db/08) or sa_date() (db/117) is missing; apply them first';
  END IF;
  -- The two clocks, as db/08 and db/117 wrote them.
  IF btrim(regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = 'sa_today()'::regprocedure), '\s+', ' ', 'g'))
       <> 'SELECT (now() AT TIME ZONE ''Africa/Johannesburg'')::date'
     OR btrim(regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = 'sa_date(timestamptz)'::regprocedure), '\s+', ' ', 'g'))
       <> 'SELECT (p_at AT TIME ZONE ''Africa/Johannesburg'')::date' THEN
    RAISE EXCEPTION 'db/128: sa_today() or sa_date() is not db/08''s or db/117''s day in Johannesburg; look first';
  END IF;
  SELECT count(*) INTO n FROM pg_temp._v128_fns();
  IF n <> 73 THEN
    RAISE EXCEPTION 'db/128: the table of bodies has % rows, not 73', n;
  END IF;
  FOR r IN SELECT * FROM pg_temp._v128_fns() LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/128: % is not there', r.fn;
    END IF;
    v_md5 := pg_temp._v128_fold(v_src);
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/128: % is not as shipped or this file''s (md5 % of its folded prosrc); look before replacing it', r.fn, v_md5;
    END IF;
    SELECT coalesce(pg_get_expr(p.proargdefaults, 0), '') INTO v_def FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_def ~* 'current_date' AND v_def <> 'CURRENT_DATE' THEN
      RAISE EXCEPTION 'db/128: %''s argument defaults read % — not as shipped; look first', r.fn, v_def;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp._v128_views() LOOP
    IF to_regclass(r.v) IS NULL OR pg_temp._v128_fold(pg_get_viewdef(to_regclass(r.v))) NOT IN (r.was, r.mine)
       OR (SELECT array_to_string(c.reloptions, ', ') FROM pg_class c WHERE c.oid = to_regclass(r.v)) IS DISTINCT FROM r.opts THEN
      RAISE EXCEPTION 'db/128: the view % is not db/08''s or this file''s; look first', r.v;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM pg_temp._v128_defaults() LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
      FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
     WHERE d.adrelid = to_regclass(r.tbl) AND a.attname = r.col;
    IF v_def IS NULL OR v_def NOT IN ('CURRENT_DATE', 'sa_today()') THEN
      RAISE EXCEPTION 'db/128: %.% defaults to %, not CURRENT_DATE or sa_today(); look first', r.tbl, r.col, coalesce(v_def, '(nothing)');
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · The functions: the same bodies, on Johannesburg's day
-- ══════════════════════════════════════════════════════════════════
DO $reemit$
DECLARE r record; v_oid oid; v_src text; v_cfg text; v_acl text; v_sec boolean; v_vol "char"; v_own oid; v_def text;
BEGIN
  FOR r IN SELECT * FROM pg_temp._v128_fns() ORDER BY fn COLLATE "C" LOOP
    v_oid := to_regprocedure(r.fn);
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef, p.provolatile, p.proowner,
           coalesce(pg_get_expr(p.proargdefaults, 0), '')
      INTO v_src, v_cfg, v_acl, v_sec, v_vol, v_own, v_def
      FROM pg_proc p WHERE p.oid = v_oid;
    IF pg_temp._v128_fold(v_src) = r.mine AND v_def !~* 'current_date' THEN
      CONTINUE;   -- already on sa_today(): a second run
    END IF;
    EXECUTE pg_temp._v128_sa(pg_get_functiondef(v_oid));
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM pg_temp._v128_sa(v_src)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM v_sec
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM v_vol
       OR (SELECT p.proowner FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM v_own
       OR (SELECT coalesce(pg_get_expr(p.proargdefaults, 0), '') FROM pg_proc p WHERE p.oid = v_oid)
            IS DISTINCT FROM regexp_replace(v_def, '\mCURRENT_DATE\M', 'sa_today()', 'g') THEN
      RAISE EXCEPTION 'db/128: re-emitting % changed more than its clock', r.fn;
    END IF;
  END LOOP;
END $reemit$;


-- ══════════════════════════════════════════════════════════════════
-- §2 · The views, and the days rows are stamped with
-- ══════════════════════════════════════════════════════════════════
DO $views$
DECLARE r record; v_acl text;
BEGIN
  FOR r IN SELECT * FROM pg_temp._v128_views() ORDER BY v COLLATE "C" LOOP
    IF pg_temp._v128_fold(pg_get_viewdef(to_regclass(r.v))) = r.mine THEN
      CONTINUE;   -- a second run
    END IF;
    SELECT c.relacl::text INTO v_acl FROM pg_class c WHERE c.oid = to_regclass(r.v);
    EXECUTE format('CREATE OR REPLACE VIEW %I WITH (%s) AS %s', r.v, r.opts,
                   regexp_replace(pg_get_viewdef(to_regclass(r.v)), '\mCURRENT_DATE\M', 'sa_today()', 'g'));
    IF pg_temp._v128_fold(pg_get_viewdef(to_regclass(r.v))) IS DISTINCT FROM r.mine
       OR (SELECT c.relacl::text FROM pg_class c WHERE c.oid = to_regclass(r.v)) IS DISTINCT FROM v_acl
       OR (SELECT array_to_string(c.reloptions, ', ') FROM pg_class c WHERE c.oid = to_regclass(r.v)) IS DISTINCT FROM r.opts THEN
      RAISE EXCEPTION 'db/128: re-creating the view % changed more than its clock', r.v;
    END IF;
  END LOOP;
END $views$;

ALTER TABLE assignment_subject  ALTER COLUMN valid_from  SET DEFAULT sa_today();
ALTER TABLE player_skill        ALTER COLUMN assessed_on SET DEFAULT sa_today();
ALTER TABLE development_note    ALTER COLUMN observed_on SET DEFAULT sa_today();
ALTER TABLE team_membership     ALTER COLUMN joined_on   SET DEFAULT sa_today();
ALTER TABLE development_target  ALTER COLUMN set_on      SET DEFAULT sa_today();
ALTER TABLE disciplinary_record ALTER COLUMN occurred_on SET DEFAULT sa_today();


-- ══════════════════════════════════════════════════════════════════
-- §3 · Grants: as they were, and none to a hosted database's own roles
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; v text; r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOR f IN SELECT x.fn FROM pg_temp._v128_fns() x LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      FOR v IN SELECT x.v FROM pg_temp._v128_views() x LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', v, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE r record; v_oid oid; v_src text; v_bad text;
BEGIN
  -- §1: each body is this file's, has no database day left in it, and is
  -- the definer, the path, the volatility and the grants it was.
  FOR r IN SELECT * FROM pg_temp._v128_fns() LOOP
    v_oid := to_regprocedure(r.fn);
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_oid;
    IF pg_temp._v128_fold(v_src) <> r.mine THEN
      RAISE EXCEPTION 'db/128: % is not this file''s body', r.fn;
    END IF;
    IF v_src ~* '\mcurrent_date\M|localtimestamp|now\(\)\s*::\s*date|_at::date\M'
       OR (SELECT coalesce(pg_get_expr(p.proargdefaults, 0), '') FROM pg_proc p WHERE p.oid = v_oid) ~* 'current_date' THEN
      RAISE EXCEPTION 'db/128: % still reads the database''s day', r.fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                      AND p.prosecdef = r.secdef AND p.provolatile::text = r.vol
                      AND (NOT r.secdef OR 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}')))) THEN
      RAISE EXCEPTION 'db/128: % is not the % % function with a pinned path it was', r.fn,
        CASE r.vol WHEN 's' THEN 'STABLE' WHEN 'v' THEN 'VOLATILE' ELSE 'IMMUTABLE' END,
        CASE WHEN r.secdef THEN 'SECURITY DEFINER' ELSE 'invoker' END;
    END IF;
    IF has_function_privilege('scrbrd_app', v_oid, 'EXECUTE') IS DISTINCT FROM r.app_exec
       OR has_function_privilege('public', v_oid, 'EXECUTE') IS DISTINCT FROM r.public_exec THEN
      RAISE EXCEPTION 'db/128: %''s grants moved (the application %, PUBLIC %)', r.fn,
        CASE WHEN r.app_exec THEN 'calls it' ELSE 'does not' END, CASE WHEN r.public_exec THEN 'calls it' ELSE 'does not' END;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x JOIN pg_roles g ON g.oid = x.grantee
                WHERE p.oid = v_oid AND g.rolname IN ('anon', 'authenticated', 'service_role')) THEN
      RAISE EXCEPTION 'db/128: a hosted database''s own role may call %', r.fn;
    END IF;
  END LOOP;

  -- §2: the views and the defaults.
  FOR r IN SELECT * FROM pg_temp._v128_views() LOOP
    IF pg_temp._v128_fold(pg_get_viewdef(to_regclass(r.v))) <> r.mine
       OR pg_get_viewdef(to_regclass(r.v)) ~* 'current_date'
       OR (SELECT array_to_string(c.reloptions, ', ') FROM pg_class c WHERE c.oid = to_regclass(r.v)) IS DISTINCT FROM r.opts
       OR NOT has_table_privilege('scrbrd_app', to_regclass(r.v), 'SELECT') THEN
      RAISE EXCEPTION 'db/128: the view % is not this file''s, or lost its options or the application''s read', r.v;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_temp._v128_defaults() x
               JOIN pg_attribute a ON a.attrelid = to_regclass(x.tbl) AND a.attname = x.col
               LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
              WHERE pg_get_expr(d.adbin, d.adrelid) IS DISTINCT FROM 'sa_today()') THEN
    RAISE EXCEPTION 'db/128: a stamped day still defaults to the database''s';
  END IF;

  -- And nothing in the schema reads the database's day any more: no body
  -- (bar one comment), argument default, view, column default, policy or
  -- CHECK.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text COLLATE "C") INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (EXISTS (SELECT 1 FROM regexp_split_to_table(p.prosrc, E'\n') l
                   WHERE l ~* '\mcurrent_date\M|localtimestamp|now\(\)\s*::\s*date|current_timestamp\s*::\s*date|_at::date\M'
                     AND btrim(l) !~ '^--')
          OR coalesce(pg_get_expr(p.proargdefaults, 0), '') ~* 'current_date|localtimestamp');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'db/128: these still read the database''s day: %', v_bad;
  END IF;
  SELECT string_agg(x.what, ', ' ORDER BY x.what COLLATE "C") INTO v_bad FROM (
    SELECT 'view ' || c.relname AS what FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') AND pg_get_viewdef(c.oid) ~* 'current_date|localtimestamp'
    UNION ALL
    SELECT 'default ' || d.adrelid::regclass::text FROM pg_attrdef d
     WHERE pg_get_expr(d.adbin, d.adrelid) ~* 'current_date|localtimestamp'
    UNION ALL
    SELECT 'policy ' || p.polname FROM pg_policy p
     WHERE coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
           ~* 'current_date|localtimestamp'
    UNION ALL
    SELECT 'check ' || c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'public' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ~* 'current_date|localtimestamp') x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'db/128: these still read the database''s day: %', v_bad;
  END IF;
END $check$;

DROP FUNCTION pg_temp._v128_fns();
DROP FUNCTION pg_temp._v128_sa(text);
DROP FUNCTION pg_temp._v128_fold(text);
DROP FUNCTION pg_temp._v128_views();
DROP FUNCTION pg_temp._v128_defaults();
