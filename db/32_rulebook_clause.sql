-- ══════════════════════════════════════════════════════════════════
--  32 · Rulebook clauses, and the directive citing its own (SCRBRD-041)
-- ══════════════════════════════════════════════════════════════════
--
-- The workload monitor said "U13 · 5/10" and nothing else: a number with no
-- rule behind it that anybody could read. The rule existed only as a comment
-- above bowling_directive in db/08. This file makes the rule a row a screen
-- can cite — code, title, text, category, severity, the ages it applies to —
-- and gives every bowling_directive row the code of the clause it enforces.
--
-- WHAT IS AND IS NOT CLAIMED. The repository has no official directive text.
-- What it has is db/08's statement of where its figures come from: the ECB
-- fast bowling directives, mapped onto the school bands (U14 and U15 into the
-- ECB's U15 band, U16 into its U17), which is what most South African schools
-- apply in the absence of a published CSA schedule. So every clause below is
-- written as THE PLATFORM'S SUMMARY of what it applies, says so in `source`,
-- and carries a SCRBRD code rather than an official clause number or a
-- quotation nobody here has read.
--
-- NO NUMBERS IN THE TEXT. The overs are bowling_directive's and stay there;
-- the read that shows a clause joins the figures in beside it. A limit
-- restated in prose is a limit that drifts from the one the breach trigger
-- actually enforces, and the reader would have no way to tell which was true.
--
-- WHO READS AND WRITES. Reference material, like the directive it annotates
-- and like season, official and the capability catalogue: readable by anyone
-- signed in (app_user_id() IS NOT NULL — the same predicate
-- bowling_directive_read already uses, so a clause is never more visible or
-- less visible than the limit it explains), and holding nothing about any
-- person. Not anonymous: nothing in this schema answers a session with no
-- user. Written by the platform, in migrations, and by nobody through the
-- application — there is no route, no write policy, and the INSERT/UPDATE
-- the blanket grant in db/06 would otherwise hand scrbrd_app is taken back,
-- the two layers db/06 already uses for capability and role_capability. A
-- school cannot edit the rule its coaches are held to; a school that wants a
-- stricter line for its Open bowlers has bowling_ceiling_open for that.
--
-- Safe to run twice.

-- ── The clause ─────────────────────────────────────────────────────
-- `code` is the identity: it is what a directive row, a screen and a person
-- on the phone cite, it survives a re-seed, and a surrogate uuid beside it
-- would be a second identity nothing uses.
--
-- The categories are a closed list so the rulebook's grouping cannot fork on
-- a spelling ("Medical and Safety"). They are the four the backlog's clause
-- shape names; only Medical & Safety has clauses today, and the rulebook
-- draws a category only when it has one.
CREATE TABLE IF NOT EXISTS rulebook_clause (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z]+(-[A-Z0-9]+)*$'),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 120),
  body        text NOT NULL CHECK (length(btrim(body)) >= 40),
  category    text NOT NULL CHECK (category IN ('Medical & Safety', 'Curator & Turf', 'Playing Conditions', 'Conduct')),
  severity    text NOT NULL CHECK (severity IN ('Mandatory', 'Guideline', 'Penalty Enforced')),
  -- Where the clause comes from, in words the reader sees beside it.
  source      text NOT NULL CHECK (length(btrim(source)) >= 10),
  sort_order  smallint NOT NULL DEFAULT 0
);

-- ── The ages it applies to ─────────────────────────────────────────
-- A row per band, and the band is a foreign key into bowling_directive's
-- own: the vocabulary age_band() produces (U13–U16, open, unknown), which is
-- the one teams.mjs and match_squad_age_eligible() agree with. Not a second
-- list of band names that could come to disagree with the first — a band
-- the directive does not know is refused here. A clause with no rows is not
-- tied to an age band (a ground rule, say), and the rulebook says so.
CREATE TABLE IF NOT EXISTS rulebook_clause_age (
  clause_code text NOT NULL REFERENCES rulebook_clause(code) ON DELETE CASCADE,
  age_band    text NOT NULL REFERENCES bowling_directive(age_band),
  PRIMARY KEY (clause_code, age_band)
);

-- ── The directive cites its clause ─────────────────────────────────
-- A composite foreign key onto the clause's AGES, not just onto the clause:
-- the U13 row cannot cite a clause that does not apply to U13. That is the
-- mistake this whole item exists to make visible — a monitor citing the U16
-- rule beside a thirteen-year-old's limit — and it is refused by the schema
-- rather than caught by a walk.
ALTER TABLE bowling_directive ADD COLUMN IF NOT EXISTS clause_code text;

INSERT INTO rulebook_clause (code, title, category, severity, sort_order, source, body) VALUES
  ('PACE-SCOPE', 'Who the bowling limits apply to', 'Medical & Safety', 'Mandatory', 10,
   'Platform rule: how SCRBRD applies the fast-bowling directive (db/08_schema_programme.sql).',
   'The over limits apply to pace bowlers: anyone recorded as a fast or medium bowler. A spinner is under no over limit. '
   || 'A bowler whose style nobody has recorded is treated as pace, because wrongly limiting a spinner costs an over taken '
   || 'off him early, and wrongly not limiting an unrecorded quick bowler can cost a stress fracture. The band is his age '
   || 'on 1 January of the season, the same date his eligibility for an age-group side is measured on.'),
  ('PACE-COUNT', 'How overs, spells and days are counted', 'Medical & Safety', 'Mandatory', 20,
   'Platform rule: how SCRBRD applies the fast-bowling directive (db/08_schema_programme.sql).',
   'An over is six legal balls; a wide or a no-ball does not advance it. A spell is unbroken bowling from one end: ends '
   || 'alternate, so overs two apart are one spell, and a bowler who misses his turn at that end has been rested and '
   || 'starts a new spell when he comes back. A day is every over he bowls on the fixture''s date, across every match and '
   || 'innings, dated by the fixture and not by when the scorer''s phone synced. Nothing refuses a ball: the first over '
   || 'past either limit is recorded as a breach, once, and the coaching and medical staff responsible for him are told.'),
  ('PACE-U13', 'Pace bowling limits: U13', 'Medical & Safety', 'Mandatory', 30,
   'Platform summary. The figures follow the ECB fast bowling directives for this age, in the absence of a published CSA schedule. Not official wording.',
   'A pace bowler in the U13 band bowls no more overs in one spell, and no more overs in one day, than the figures shown '
   || 'with this clause. They are the platform''s directive for the band, and the same figures the workload monitor '
   || 'and the breach record apply.'),
  ('PACE-U14-U15', 'Pace bowling limits: U14 and U15', 'Medical & Safety', 'Mandatory', 40,
   'Platform summary. The figures follow the ECB fast bowling directives, with the school U14 and U15 bands both placed in the ECB''s U15 band, in the absence of a published CSA schedule. Not official wording.',
   'A pace bowler in the U14 or U15 band bowls no more overs in one spell, and no more overs in one day, than the figures '
   || 'shown with this clause. The two school bands share one set of figures. They are the platform''s directive for '
   || 'these bands, and the same figures the workload monitor and the breach record apply.'),
  ('PACE-U16', 'Pace bowling limits: U16', 'Medical & Safety', 'Mandatory', 50,
   'Platform summary. The figures follow the ECB fast bowling directives, with the school U16 band placed in the ECB''s U17 band, in the absence of a published CSA schedule. Not official wording.',
   'A pace bowler in the U16 band bowls no more overs in one spell, and no more overs in one day, than the figures shown '
   || 'with this clause. They are the platform''s directive for the band, and the same figures the workload monitor and '
   || 'the breach record apply.'),
  ('PACE-OPEN', 'Open band: no platform limit; a school may set its own', 'Medical & Safety', 'Guideline', 60,
   'Platform rule: the directive as applied by SCRBRD sets no limit for the Open band (db/08_schema_programme.sql).',
   'A bowler seventeen or older on 1 January plays Open at a high school, and the platform''s directive sets no over '
   || 'limit for him: a club fielding grown men in the same division is rightly under no such rule. A high school may '
   || 'set its own ceiling for its Open bowlers in Settings. Where it has, that ceiling is the limit the workload monitor '
   || 'shows and the breach record applies, exactly as the directive''s would be.'),
  ('PACE-DOB', 'No date of birth, no band', 'Medical & Safety', 'Mandatory', 70,
   'Platform rule: how SCRBRD applies the fast-bowling directive (db/08_schema_programme.sql).',
   'A player whose date of birth is not recorded cannot be placed in an age band, so no over limit can be applied to '
   || 'him. The workload monitor names him unknown rather than quietly treating him as Open. His school records his date '
   || 'of birth before he bowls, and from that moment the limits for his band apply.')
ON CONFLICT (code) DO UPDATE
  SET title = EXCLUDED.title, category = EXCLUDED.category, severity = EXCLUDED.severity,
      sort_order = EXCLUDED.sort_order, source = EXCLUDED.source, body = EXCLUDED.body;

INSERT INTO rulebook_clause_age (clause_code, age_band) VALUES
  ('PACE-SCOPE', 'U13'), ('PACE-SCOPE', 'U14'), ('PACE-SCOPE', 'U15'), ('PACE-SCOPE', 'U16'), ('PACE-SCOPE', 'open'),
  ('PACE-COUNT', 'U13'), ('PACE-COUNT', 'U14'), ('PACE-COUNT', 'U15'), ('PACE-COUNT', 'U16'), ('PACE-COUNT', 'open'),
  ('PACE-U13', 'U13'),
  ('PACE-U14-U15', 'U14'), ('PACE-U14-U15', 'U15'),
  ('PACE-U16', 'U16'),
  ('PACE-OPEN', 'open'),
  ('PACE-DOB', 'unknown')
ON CONFLICT DO NOTHING;

UPDATE bowling_directive d SET clause_code = x.code
  FROM (VALUES ('U13', 'PACE-U13'), ('U14', 'PACE-U14-U15'), ('U15', 'PACE-U14-U15'),
               ('U16', 'PACE-U16'), ('open', 'PACE-OPEN'), ('unknown', 'PACE-DOB')) AS x(band, code)
 WHERE d.age_band = x.band AND d.clause_code IS DISTINCT FROM x.code;

ALTER TABLE bowling_directive DROP CONSTRAINT IF EXISTS bowling_directive_clause_applies;
ALTER TABLE bowling_directive ADD CONSTRAINT bowling_directive_clause_applies
  FOREIGN KEY (clause_code, age_band) REFERENCES rulebook_clause_age(clause_code, age_band);
-- Every limit cites a rule. A band added later without a clause is refused.
ALTER TABLE bowling_directive ALTER COLUMN clause_code SET NOT NULL;

-- ── Row-level security and privileges ──────────────────────────────
-- Hand-written, not in packages/policy/src/tables.mjs, for db/25's reason:
-- the generator writes db/09, which runs before this file and is frozen.
ALTER TABLE rulebook_clause     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rulebook_clause_age ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rulebook_clause_read     ON rulebook_clause;
DROP POLICY IF EXISTS rulebook_clause_age_read ON rulebook_clause_age;
CREATE POLICY rulebook_clause_read ON rulebook_clause
  FOR SELECT USING (app_user_id() IS NOT NULL);
CREATE POLICY rulebook_clause_age_read ON rulebook_clause_age
  FOR SELECT USING (app_user_id() IS NOT NULL);

-- Named explicitly: db/06's default privileges only reach tables created by
-- the role that ran db/06, and a managed host may run this as another.
GRANT SELECT ON rulebook_clause, rulebook_clause_age TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON rulebook_clause, rulebook_clause_age FROM scrbrd_app;

-- ── Assertion ──────────────────────────────────────────────────────
-- What this file promised, checked in the same paste. A DO block raises, so
-- the transaction the operator wrapped this in rolls back rather than leaving
-- half of it applied. Who reads it is asserted live, as scrbrd_app, in
-- db/99_rls_verify.sql; that the monitor cites the right clause, by
-- tools/smoke-workload.mjs and tools/smoke-browser-rulebook.mjs.
DO $check$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rulebook_clause', 'rulebook_clause_age'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'db/32: % has row-level security disabled', t;
    END IF;
    -- One policy, SELECT, and the predicate the directive uses.
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = t::regclass) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE tablename = t AND cmd = 'SELECT'
                         AND qual = '(app_user_id() IS NOT NULL)') THEN
      RAISE EXCEPTION 'db/32: % is not governed by exactly one signed-in read policy', t;
    END IF;
    IF NOT has_table_privilege('scrbrd_app', t, 'SELECT') THEN
      RAISE EXCEPTION 'db/32: the application role cannot read %', t;
    END IF;
    IF has_table_privilege('scrbrd_app', t, 'INSERT') OR has_table_privilege('scrbrd_app', t, 'UPDATE')
       OR has_table_privilege('scrbrd_app', t, 'DELETE') THEN
      RAISE EXCEPTION 'db/32: the application role can write %', t;
    END IF;
  END LOOP;

  -- Every directive row cites a clause that exists and applies to its band.
  -- The foreign key guarantees the second half; this makes a missing row loud.
  IF EXISTS (SELECT 1 FROM bowling_directive d
              WHERE NOT EXISTS (SELECT 1 FROM rulebook_clause_age a
                                 WHERE a.clause_code = d.clause_code AND a.age_band = d.age_band)) THEN
    RAISE EXCEPTION 'db/32: a bowling_directive row cites no clause for its own band';
  END IF;

  -- The constraints refuse what they exist to refuse. Each attempt runs in its
  -- own subtransaction and is undone whether it is refused or not.
  BEGIN
    INSERT INTO rulebook_clause (code, title, category, severity, source, body)
    VALUES ('CHECK-SEV', 'A clause of no known force', 'Medical & Safety', 'Advisory',
            'db/32 assertion', 'A severity outside the three the rulebook knows must be refused by the table.');
    RAISE EXCEPTION 'db/32: a clause with severity Advisory was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO rulebook_clause_age (clause_code, age_band) VALUES ('PACE-U16', 'U17');
    RAISE EXCEPTION 'db/32: a clause was tied to U17, a band no school fields';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE bowling_directive SET clause_code = 'PACE-U16' WHERE age_band = 'U13';
    RAISE EXCEPTION 'db/32: the U13 limit was allowed to cite the U16 clause';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $check$;
