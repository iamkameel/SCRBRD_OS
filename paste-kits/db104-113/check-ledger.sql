-- ══════════════════════════════════════════════════════════════════
--  SCRBRD — the ledger's last eleven rows (read-only)
-- ══════════════════════════════════════════════════════════════════
--
--  Changes nothing. After the kit (db/104 to db/113) this should list 103
--  to 113, each with the first eight characters of the sha256 the migrator
--  records; compare them with hashes.txt. ledger_rows is the whole ledger's
--  count: 110 after db/113. The fix file (fix-player-without-team.sql) is
--  not a migration and has no row.
SELECT name, left(sha256, 8) AS sha8, applied_at,
       (SELECT count(*) FROM schema_migration) AS ledger_rows
  FROM (SELECT name, sha256, applied_at
          FROM schema_migration
         ORDER BY (substring(name FROM '^[0-9]+'))::int DESC
         LIMIT 11) last_eleven
 ORDER BY (substring(name FROM '^[0-9]+'))::int;
