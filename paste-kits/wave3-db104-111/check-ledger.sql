-- ══════════════════════════════════════════════════════════════════
--  SCRBRD — the ledger's last nine rows (read-only)
-- ══════════════════════════════════════════════════════════════════
--
--  Changes nothing. After the wave 3 kit (db/104 to db/111) this should list
--  103 to 111, each with the first eight characters of the sha256 the
--  migrator records; compare them with hashes.txt. The fix file
--  (fix-player-without-team.sql) is not a migration and has no row.
SELECT name, left(sha256, 8) AS sha8, applied_at
  FROM (SELECT name, sha256, applied_at
          FROM schema_migration
         ORDER BY (substring(name FROM '^[0-9]+'))::int DESC
         LIMIT 9) last_nine
 ORDER BY (substring(name FROM '^[0-9]+'))::int;
