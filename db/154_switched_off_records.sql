-- ══════════════════════════════════════════════════════════════════
--  154 · Switched off is hidden for that user, but still records
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's rule, 13 Nov 2026: "Anything that's switched off
-- for a user should be hidden for that user but still record data." His
-- answer on scope, the same day, "as recommended":
--   1. hide every switch that shows something when off (apps/web, done in
--      the same branch, no migration);
--   2. KEEP RECORDING while off for the seven modules that hold no child's
--      own data: logistics, officials, broadcast, sponsors, drs_review,
--      scorebook_reader and other sports' fixtures. "Record" is storing.
--      Where a write has an outward or public effect, that part stays
--      refused while off: storing, not publishing;
--   3. the six child-data modules (skills, injuries, workload_monitoring,
--      scouting, lift_club, scorebook_import) are hidden when off and keep
--      refusing writes, as before: nothing here touches them;
--   4. consents and incident freezes: nothing changes.
--
-- Four of the seven were gated only in the API (server.mjs route tags:
-- logistics, officials, sponsors' signing, broadcast) and are lifted there.
-- Three have a gate in the database, and this file is about those:
--
--   drs_review         db/08 drs_review_feature_gate(): a review row was
--                      refused while the feature was off. It is a record
--                      of a decision already announced on the field and
--                      sends nothing anywhere, so it now STORES while off.
--                      Who may write one is unchanged (drs_review_insert,
--                      scoring.correct over the fixture), and the reads
--                      stay refused while off (read-api.mjs, OWNER_OF_READ
--                      drs_reviews): stored, not shown.
--   sports' fixtures   db/08 match_sport_is_enabled(): a fixture in a sport
--                      the school has not been granted was refused. A
--                      fixture is the school's own diary and is sent to
--                      nobody by being written, so it now STORES while the
--                      sport is off. The sport must still exist ("no such
--                      sport" still raises). Putting a fixture on a public
--                      page is a separate act (fixture_publish(), db/47,
--                      broadcast.publish) that this file does not touch.
--   scorebook_reader   db/66 scorebook_import_read_start(): NOT CHANGED, ON
--                      PURPOSE. "Reading the pages" is sending photos of a
--                      paper scorebook, children's names in them, to an AI
--                      provider outside the platform (D8; POPIA s17's
--                      processing record). That is the outward act the rule
--                      keeps refused while off, and there is nothing to store
--                      until it has happened: the record of a read
--                      (scorebook_import_read_done()) was never module-gated
--                      and still lands for a read already under way.
--
-- WHAT MOVES. Two trigger functions re-created with the feature check
-- removed and every other line as it was:
--   ~ drs_review_feature_gate()   RETURNS NEW: the feature is no longer
--                                 asked. The trigger drs_review_gate (db/08)
--                                 stays, so a later decision to gate a part
--                                 of the row again has its one place.
--   ~ match_sport_is_enabled()    the unknown-sport check alone; SECURITY
--                                 DEFINER with its pinned search_path, as
--                                 db/08 and db/16 left it.
-- Nothing is granted, no table, policy or column moves, and no read changes:
-- what a switched-off module shows is the API's and the shell's business.
--
-- Safe to paste again: CREATE OR REPLACE of two functions whose triggers
-- already exist; ownership and grants are kept by CREATE OR REPLACE.
-- db/99 section 132 is the proof: each of the seven stores while off (the
-- reader's outward read stays refused), and the child-data modules' own
-- database gates still refuse.
--
-- NOT PASTED. It waits for Fable's red-team on Kameel's say, and his word.

-- ── 1 · DRS: a review row stores while the feature is off ──────────
CREATE OR REPLACE FUNCTION drs_review_feature_gate() RETURNS trigger AS $$
BEGIN
  -- Switched off records (db/154, Kameel 13 Nov 2026). The feature flag is
  -- no longer asked here: a review is stored whatever drs_review is set to,
  -- and is shown only where it is on (the read gate in read-api.mjs).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2 · Sports: a fixture stores while its sport is off ────────────
CREATE OR REPLACE FUNCTION match_sport_is_enabled() RETURNS trigger AS $$
DECLARE v_label text; v_key text;
BEGIN
  -- An UPDATE that does not touch the sport is left alone, as before.
  IF TG_OP = 'UPDATE' AND NEW.sport IS NOT DISTINCT FROM OLD.sport THEN
    RETURN NEW;
  END IF;

  SELECT s.label, s.flag_key INTO v_label, v_key FROM sport s WHERE s.code = NEW.sport;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such sport: %', NEW.sport USING ERRCODE = 'check_violation';
  END IF;

  -- Switched off records (db/154, Kameel 13 Nov 2026): a sport the school
  -- has not been granted no longer refuses the fixture. It is stored; the
  -- shell hides the sport, and publishing it is its own act (db/47).
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
