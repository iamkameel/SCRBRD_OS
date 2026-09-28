-- ══════════════════════════════════════════════════════════════════
--  55 · A pupil does not read whether a team-mate is out (K3)
-- ══════════════════════════════════════════════════════════════════
--
-- CSA's Safeguarding Policy (2025), p52 item 6: children's medical needs
-- "should be accessible to staff and coaches who need it, but not in general
-- view to other parents/caregivers or children". The `player` bundle held
-- medical.status.read, and a `player` assignment is held across a side, so
-- every pupil read every team-mate's injury row at the availability tier:
-- date_injured, rtw_date and restricted — who is out, since when, and until
-- when. SCRBRD's own rule already agreed with CSA: PUBLIC_DATA N2 treats even
-- the bare word "unavailable" as health. Signed in, a team-mate is "other
-- children". (docs/policy/CSA_SAFEGUARDING_CHECK.md K3;
-- docs/design/SAFEGUARDING_DSO.md §6.3.)
--
-- WHAT CHANGES, and nothing else:
--
--   1. `player` loses medical.status.read. A pupil learns the side from the
--      team sheet. His OWN injury, at every tier, still reaches him through
--      his `selfaccess` assignment, which names him and nobody else, and
--      which this file does not touch.
--
--   2. `enquiry` KEEPS it (Kameel, 2026-09-28). The design (§10 Q8) proposed
--      withdrawing it too, reasoning "an enquiring family is not staff"; but
--      `enquiry` is not a family. access_request_decide() (db/08) grants it
--      to a COACH at the same school, about one named player on another side,
--      time-boxed, when that player's own coach says yes ("can I have him for
--      the 2nd XI on Saturday"). Both ends are staff — CSA p52's "staff and
--      coaches who need it" — so the grant still shows whether the boy is out
--      and until when, and still never what is wrong with him.
--
-- Who still holds it, unchanged: superadmin, principal, directorofsport,
-- schooladmin, sportsadmin, coach, assistantcoach, teammanager, medical, and —
-- each scoped to the one player or the children their assignment names —
-- enquiry, guardian and selfaccess.
--
-- WHAT ELSE FOLLOWS, with no further SQL: the injury read (db/09 injury_read,
-- app_can('medical.status.read', ...)), so injury_masked and the readiness
-- read; and the notification feed, where an injury notice declaring
-- medical.status.read (db/08's status-tier notice) stops reaching team-mates
-- and still reaches the boy himself through selfaccess.
--
-- NOT done by editing db/01_authz.sql and regenerating: that file shipped.
-- generate-rls.mjs's WITHDRAWN_SINCE_01 keeps db/01 reproducing its original
-- grant, so a fresh install receives it there and loses it here — the same
-- history a live database went through (db/21's shape, ADR 0002).
--
-- Safe to run twice: it deletes the rows if they are there.

DELETE FROM role_capability
 WHERE role = 'player' AND capability = 'medical.status.read';


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  v_holders text;
BEGIN
  IF EXISTS (SELECT 1 FROM role_capability
              WHERE role = 'player' AND capability = 'medical.status.read') THEN
    RAISE EXCEPTION 'db/55: player still holds medical.status.read';
  END IF;
  -- And nobody else lost it: the holders are exactly roles.mjs's.
  SELECT string_agg(role, ' ' ORDER BY role) INTO v_holders
    FROM role_capability WHERE capability = 'medical.status.read';
  IF v_holders IS DISTINCT FROM
     'assistantcoach coach directorofsport enquiry guardian medical principal schooladmin selfaccess sportsadmin superadmin teammanager' THEN
    RAISE EXCEPTION 'db/55: medical.status.read is held by [%], expected the twelve roles of roles.mjs', v_holders;
  END IF;
  -- The pupil's own record still reaches him: selfaccess keeps every tier.
  IF (SELECT count(*) FROM role_capability
       WHERE role = 'selfaccess'
         AND capability IN ('medical.status.read', 'medical.nature.read', 'medical.details.read')) <> 3 THEN
    RAISE EXCEPTION 'db/55: selfaccess no longer holds all three medical tiers';
  END IF;
END $check$;
