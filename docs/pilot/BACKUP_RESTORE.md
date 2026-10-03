# Backup and restore: the drill

For Kameel, on his own machine. The pilot plan has the drill on **10 October
2026**, five days before the first match (15 October). Do it once in full that
day. After that, take a backup on every match day.

Production is **Supabase Postgres**. The API runs on **Render** and the web
app on **Firebase Hosting**. Neither Render nor Firebase holds the scores, the
people or the consents. Those are all in the database, so this document is
only about the database.

**The database holds children's personal information.** Names, dates of
birth, guardian links, consent records and, for some pupils, medical and
workload data. Every dump and every restored copy holds all of it, so treat
each one as you would the production database. The rules on where a dump may
live are in [section 3](#3--where-a-dump-may-live-and-for-how-long).

---

## 1 · What protection exists today

**Tick the plan the production project is on.** The Supabase dashboard shows
it under *Organization → Billing*. This document does not assume a plan.

**Decided 3 October 2026 (Kameel): production stays on Free for the pilot,
and Kameel's own encrypted dumps (section 2) are the backup.** So the dump
before the pilot and the dump on each match day are not optional: on Free
they may be the only copy there is.

- [x] Free
- [ ] Pro
- [ ] Team
- [ ] Enterprise
- [ ] Point-in-Time Recovery add-on enabled (*Project → Database → Backups*)

Here is what Supabase's documentation says each plan gives. **None of it was
confirmed first-hand.** The session that wrote this could not open
supabase.com because its network proxy blocked it. The rows come from search
results that quote Supabase's pages. Before 10 October, open the two pages
linked below, read them, and correct this table.

| | Free | Pro | Team | Enterprise | Source |
|---|---|---|---|---|---|
| Daily backups | **unconfirmed**: search results contradict each other. One says all plans are backed up daily, another says only Pro and above. Either way the docs **recommend that Free projects export their own data** (`supabase db dump`) and keep it off-site. | yes | yes | yes | [Database Backups](https://supabase.com/docs/guides/platform/backups) |
| Daily backups you can reach | none reported | last **7 days** | last **14 days** | up to **30 days** | [Database Backups](https://supabase.com/docs/guides/platform/backups) |
| Can you download one? | no | **unconfirmed.** Larger projects get a physical snapshot that can only be restored in place, not downloaded. Older projects that still use logical backups may show a download button on *Database → Backups*. | as Pro | as Pro | [Database Backups](https://supabase.com/docs/guides/platform/backups) |
| Point-in-Time Recovery | no | paid add-on: 7 days ≈ $100/month, 14 days ≈ $200/month, 28 days ≈ $400/month (**unconfirmed**, and it may also need a compute add-on) | as Pro | included or arranged | [Manage PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery) |
| Restoring a Supabase backup | — | restores the **whole project in place**, with downtime, and everything after the backup's moment is gone | as Pro | as Pro | [Database Backups](https://supabase.com/docs/guides/platform/backups) (**unconfirmed**) |

Read the backups page for two more facts this table cannot vouch for:

- whether daily backups include files kept through Supabase **Storage**, and
- how long a **paused** Free project can still be restored.

DEPLOYING.md already notes that a Free project sleeps after about a week of
inactivity.

**What this means, whatever the plan:** a Supabase backup is something only
Supabase can restore, into the same project, and it overwrites everything
after its moment. It cannot be restored onto your machine to *prove* it
works. The drill below uses a backup **you** take and hold. A Supabase backup
on a paid plan is a second line, not a replacement.

---

## 2 · The backup you take yourself

What you need:

- `pg_dump` and `pg_restore` of the same major version as production, or newer.
  The tool checks this and refuses an older `pg_dump`. In the SQL Editor,
  `SHOW server_version;` gives production's version. On macOS that is
  `brew install postgresql@17` (or whichever major version it is), on
  Debian/Ubuntu `postgresql-client-17`.
- This repository, checked out, with `pnpm install` done.
- The **owner** connection string from Supabase's green **Connect** button.
  Use the **session pooler** (port 5432), as `postgres.<project-ref>`.
  - Not the transaction pooler (6543). The dump has to hold one session open.
  - Not `scrbrd_app`. Row-level security hides every row from the application
    role, and `pg_dump` refuses to run under it.

### Keep the connection string out of files and history

Paste the string into a shell variable. **Do not export it**, do not put it in
a file, and do not put it in `.env`:

```sh
read -rs SCRBRD_PROD_OWNER_URL     # paste, press Enter: nothing echoes, nothing goes into history
```

Hand it to one command at a time, as `DATABASE_URL="$SCRBRD_PROD_OWNER_URL"`
in front of that command. DEPLOYING.md explains why an exported owner string
is dangerous: a server once started on one because somebody had forgotten it
was exported. When you finish, `unset SCRBRD_PROD_OWNER_URL` or close the
terminal.

### Take the backup

Keep backups in one folder **outside the repository**, on a disk with
encryption switched on (section 3):

```sh
mkdir -p ~/scrbrd-backups && chmod 700 ~/scrbrd-backups
STAMP=$(date +%Y-%m-%d-%H%M)

DATABASE_URL="$SCRBRD_PROD_OWNER_URL" node tools/backup-verify.mjs dump \
  --out    ~/scrbrd-backups/scrbrd-$STAMP.dump \
  --counts ~/scrbrd-backups/scrbrd-$STAMP.counts.json
```

What it does. It only reads, and it holds a read-only transaction the whole
time:

1. Opens one read-only, repeatable-read transaction on production.
2. Counts the rows of every table in `public` and reads the ledger
   (`schema_migration`).
3. Runs `pg_dump --format=custom --schema=public` **inside that same
   snapshot**. The counts then describe exactly what is in the dump, even
   while a scorer is sending balls.
4. Writes the dump (mode 600) and the counts file. The counts file records the
   dump's sha256, every table's row count and every migration in the ledger.
   It holds **no names and no rows**.

`schema_migration` lives in `public`, so the dump carries the ledger with it.
What the dump does **not** carry:

- **Roles and their passwords.** `scrbrd_app`'s secret is not in it.
- **Supabase's own schemas** (`auth`, `storage`, and so on). SCRBRD uses none
  of them for its data.
- **Files held outside the database.** That includes scorebook photos, if the
  importer's photo store is not the database.

### When to take one

| When | Why |
|---|---|
| **10 October**, before the drill | It is the dump the drill restores |
| **14 October**, the evening before the first match | The last dump before real match data arrives |
| **Every match day, after close of play**, once every scorer's pad shows nothing waiting to send | Holds the day's scoring. A dump during play is safe: it only reads and runs in one snapshot. After play, it holds the whole day. |
| Before any `apply-NN` paste into production | A known point to return to if the paste goes wrong |

---

## 3 · Where a dump may live, and for how long

Under POPIA, SCRBRD processes this information for the schools. A dump is a
full copy of it, and the same duties apply to the copy as to the database:

- **Security safeguards (s19)** apply to the copy.
- **Retention (s14)**: keep it no longer than its purpose needs.
- **Notification (s22)**: a lost or exposed dump is a security compromise to
  report to the schools and the Information Regulator.
- **Children (s34–35) and health information (s26–33)** are special
  categories.

This is a summary for running the drill, not legal advice.

**Where it may live**

- On your own machine, in `~/scrbrd-backups`, **only with full-disk
  encryption on** (FileVault on macOS, BitLocker on Windows, LUKS on Linux),
  the folder at mode 700, and the screen locked whenever you are away.
- A second copy off the machine is wise, because a stolen laptop takes the
  only backup with it. It may go on a USB disk you keep, or in a private
  storage bucket only you can reach. Either way it is **encrypted before it
  leaves**:
  ```sh
  gpg --symmetric --cipher-algo AES256 ~/scrbrd-backups/scrbrd-$STAMP.dump   # → .dump.gpg
  ```
  Keep the passphrase in your password manager, never beside the file.

**Where it may never go**

- Email, WhatsApp, Slack, or any chat, including one with an AI assistant.
- A shared drive or folder anyone else can open: Google Drive, OneDrive, a
  school's share.
- This repository. `.gitignore` refuses `*.dump`, `*.dump.gpg` and
  `*.counts.json`, but that is only the second lock. The first is never
  writing one inside the repository.
- Any database other than a throwaway local copy (section 4).

**How long** (a proposal until you decide; see "What you must decide" below)

| Dump | Kept until |
|---|---|
| A match day's dump | 14 days after that day, as long as a later dump has passed the drill |
| The pre-pilot dump (14 October) | The end of the pilot |
| Everything | Deleted at the end of the pilot, unless the schools' agreements say otherwise |
| A restored copy (section 4) | **Dropped the same day.** It exists only to prove the dump. |

To delete a dump, remove the file and its `.gpg` copies, and wipe it from any
USB disk. On an SSD with full-disk encryption, an ordinary delete is enough.
The counts files hold no personal data and may be kept as the record that the
drill was done.

---

## 4 · The restore drill

This proves the dump restores, and that the restored copy is the database it
came from. It needs a **local** Postgres on your machine: Docker
(`pnpm db:up`) or an installed server (RUNNING.md). Its major version must be
the same as production's or newer. The local role needs permission to create
databases and roles; the RUNNING.md set-up role does.

**Use a local copy, not a Supabase branch.** If your plan includes branching
(**unconfirmed** which plans do), a branch is another cloud database. Loading
production's children into it makes another copy of them somewhere else, which
is exactly what section 3 avoids.

```sh
# 1. A fresh, empty database, used only for this drill
createdb scrbrd_drill                                   # or: psql -c 'CREATE DATABASE scrbrd_drill'

# 2. Restore. Refused unless the target is on this machine AND empty.
SCRBRD_DB=scrbrd_drill node tools/backup-verify.mjs restore \
  --from ~/scrbrd-backups/scrbrd-<STAMP>.dump

# 3. Prove it: the ledger matches db/SHIPPED.sha256 and the ledger at dump
#    time, every table has the rows it had, and the file is the one counted.
SCRBRD_DB=scrbrd_drill node tools/backup-verify.mjs verify \
  --counts ~/scrbrd-backups/scrbrd-<STAMP>.counts.json \
  --dump   ~/scrbrd-backups/scrbrd-<STAMP>.dump
#    expect: BACKUP VERIFIED: 0 check(s) failed

# 4. The RLS proofs, against the restored copy
SCRBRD_DB=scrbrd_drill node tools/migrate.mjs --verify
#    expect: "0 applied, N already applied" and ALL RLS LIVE ASSERTIONS PASSED

# 5. Drop it
dropdb scrbrd_drill
```

`SCRBRD_DB` points the tools at `postgres://scrbrd:scrbrd@127.0.0.1:5432/<name>`,
the RUNNING.md defaults. If your local Postgres uses another role or port, use
`DATABASE_URL=postgres://<you>@localhost:<port>/scrbrd_drill` instead.
`restore` refuses any `DATABASE_URL` whose host is not this machine.

What `restore` does:

1. Refuses (exit 2) unless the target database is on this machine **and** has
   no tables or views in `public`.
2. Creates, as `NOLOGIN`, any role the dump's grants name that the machine
   lacks. On a Supabase dump that means `anon`, `authenticated`,
   `service_role` and the like, and `scrbrd_app` if you have never run SCRBRD
   locally. Each object's grants restore as one statement, so one missing role
   would also lose that object's grant to `scrbrd_app`, and step 4 would fail
   for the wrong reason. These empty roles stay on your local server. They
   cannot sign in. Drop them after the drill if you like (`DROP ROLE anon;`
   and so on).
3. Creates `pgcrypto`. A dump of one schema leaves extensions out.
4. Runs `pg_restore --no-owner --single-transaction --exit-on-error`. Either
   everything restores or nothing does.

**If step 4 prints "applied" with a number above 0,** the repository holds
migrations that production's ledger does not, and `migrate.mjs` has just
applied them to the copy. Step 3 already says which ones (its ledger lines).
Either production is behind (DEPLOYING.md, "When production is behind by more
than one file") or you are on a branch ahead of `main`. Check out `main` at
the commit production runs and drill again.

**If anything fails,** the backup is not proven. Keep the failing dump, do not
delete the previous good one, and find out why before the next match day.

Write down how long steps 1–2 took. That is the least time a real restore
would take.

---

## 5 · A real restore into production

**This is not a procedure to run.** It is what to weigh, in the moment, before
deciding. A restore takes the database back to the dump's moment. Everything
written after it disappears from the server: balls, amendments, consents,
**consent withdrawals**, safeguarding concerns and sign-ins. Most problems
during the pilot are smaller than that.

| What happened | Restore production? | Instead, or first |
|---|---|---|
| A wrong ball, score, dismissal or name | **No** | Correct it in the app (void, amend). The event log is append-only, and a correction is just another event. |
| A person's record wrong or missing | **No** | Fix it in the app. A restore would undo everything else written since the dump. |
| Rows deleted or damaged by hand (the SQL Editor), API still running | **Not the whole database** | Restore the dump **locally** (section 4) and compare. Put back only the missing rows, with SQL that a second person reads before you paste it, then run the verify bundle. |
| The API refuses to start: "missing N migration(s)" | **No** | That is the schema guard (DEPLOYING.md, "The API refuses to run ahead of its schema"). Paste the named `apply-NN`. |
| The database is gone or unusable **during a match** | **Not now** | Scorers carry on. The pad keeps every ball on the device (IndexedDB) before it counts, and the paper scorebook is the record. Restore after play. |
| The database is gone or unusable **between matches** (project deleted, paused past recovery, corrupted) | **Yes, into a new project** | See the list after this table. |
| Supabase offers its own backup or PITR restore (paid plans) | Only in the last two cases | It restores the whole project in place, with downtime. Afterwards it has exactly the consequences listed under "After any restore". |

**What a restore into a new project involves** (in outline; do it with a
second person):

1. Create the Supabase project.
2. Create `scrbrd_app` **with a new secret** first, because the dump carries no
   roles (DEPLOYING.md, Supabase).
3. Restore the newest dump that passed the drill, as the owner, with
   `pg_restore --no-owner`. This tool refuses to do it on purpose.
4. Paste `verify` and expect `ALL RLS LIVE ASSERTIONS PASSED`.
5. Set the Render service's `DATABASE_URL` to the new `scrbrd_app` string and
   redeploy. The API compares its expected migrations with the restored
   ledger at boot and refuses to start if the ledger is behind.
6. Set the GitHub variable `SCRBRD_HEALTH_URL` if the address changed.

**After any restore: the event log and the scorers' pads**

- **The server's log ends at the dump's moment.** Balls scored after it are
  only on the pads that scored them, and on paper.
- **What the code says about resending:**
  - A pad writes every ball to its own storage before it counts it, and
    retries unsent balls with backoff.
  - Every ball carries an idempotency key. The server answers *duplicate* for
    a ball it already has and accepts a ball it lacks.
  - The engine's comments say a reloaded pad offers its whole log again, so a
    pad that still holds the match should refill the gap after the restore.
- **What is not proven:**
  - A pad that cleared the match after completion holds nothing to resend.
  - A handover or force-release after the dump leaves a pad whose
    token generation (epoch) is ahead of the restored server's. Its balls
    could come back *held* or *quarantined* instead of accepted.
  - **None of this has been tested against a restored database.** Until it
    has been, the paper scorebook (and the scorebook importer) is how the gap
    gets filled.
- **POPIA, the part that is easy to miss:** a consent withdrawn, a guardian
  link removed, or an erasure done after the dump is **undone** by the
  restore. Before the restored database serves anyone, put back every
  withdrawal and removal made since the dump. Collect them from the schools,
  and from the audit log of the old database if any of it can still be read.
- People may have to sign in again. Login codes and sign-ins issued after the
  dump do not exist on the restored database.

---

## What you must decide

1. **The plan.** Tick it in section 1, and decide whether the pilot pays for
   Pro (7 days of daily backups) or for PITR. Without either, the dumps in
   section 2 are the **only** backup.
2. **The retention periods** in section 3: 14 days for a match-day dump, and
   deletion at the end of the pilot. Check them against what the schools'
   agreements say.
3. **The second copy.** Decide whether there is one off your machine, and
   where it lives (a USB disk or a private bucket), encrypted either way.
4. **Who else may hold a dump.** The proposal is nobody. If a second person
   ever needs to restore, they take their own dump with their own access.

## The drill on 10 October, in order

- [ ] Section 1: the plan ticked, the two Supabase pages read, this
      document's table corrected.
- [ ] Full-disk encryption on; `~/scrbrd-backups` at mode 700.
- [ ] Section 2: dump and counts taken.
- [ ] Section 4: restored locally, `verify` passed, `migrate.mjs --verify`
      passed, the copy dropped.
- [ ] The time steps 1–2 took, written down: ______
- [ ] The dump's sha256 (it is in the counts file), written down beside the date.
