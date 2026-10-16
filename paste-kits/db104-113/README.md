# Paste kit: db/104–113 (wave 3, SR-1, corrections)

Paste each file whole into the Supabase SQL Editor and run it. Do it on the **demo copy (scrbrd-demo) first, then production**, and check the project name before every paste.

1. `01-apply-104.sql`
2. `02-apply-105.sql`
3. `03-apply-106.sql`
4. `04-apply-107.sql`
5. `05-fix-player-without-team.sql`. This must run before file 6.
6. `06-apply-108.sql`
7. `07-apply-109.sql`
8. `08-apply-110.sql`
9. `09-apply-111.sql`
10. `10-apply-112.sql`: SR-1 (#171).
11. `11-apply-113.sql`: corrections reach the notices (#170).
12. `check-ledger.sql`. It is read-only and should show 110 rows, ending with 113.
13. `check-health.sql`. It is read-only, and 42 of 42 columns should read OK, including "Migration ledger: OK — 110 applied".

If a file says "already in this database's ledger", it was pasted before, so go on to the next one. Any other error: stop and send the message.

Files 01–09 are byte-identical to the wave 3 kit. The kit was generated from `claude/wip-kit-104-113` at 00bc558 and tested at production's state (db/103). db/108 refused before the fix ran, every file applied, 42 of 42 health rows read OK, and a second paste changed nothing.
