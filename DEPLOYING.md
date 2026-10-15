# Deploying SCRBRD

One Firebase project, **scrbrd-os**, and the Google Cloud project behind it.
Nothing here uses any other Firebase project. Three pieces:

| Piece | Where | How it gets there |
|---|---|---|
| Client (`apps/web`) | Firebase Hosting | by hand (5b), or `.github/workflows/deploy.yml` on push to `main` |
| API (`services/api`) | Cloud Run, `africa-south1`, service `scrbrd-api` | by hand (5), or the same workflow, from the root `Dockerfile` |
| Database | Cloud SQL, Postgres 16, `africa-south1` | by hand, once, then by hand for every schema change |

Hosting rewrites `/api/**` to the Cloud Run service (`firebase.json`), so the
browser talks to one origin and the client is built with `VITE_API_BASE=""`.
Realtime is plain HTTP, so the rewrite carries everything the client needs.

## Where to run all of this

**Google Cloud Shell**, at <https://shell.cloud.google.com> or the `>_` icon in
the Cloud Console. It is a free browser terminal, already signed in as you,
with `gcloud`, `firebase`, `node`, `git` and `psql` already installed. Nothing
below needs anything installed on your own machine.

```sh
gcloud config set project scrbrd-os
git clone https://github.com/iamkameel/SCRBRD_OS.git && cd SCRBRD_OS
npm install -g pnpm && pnpm install --frozen-lockfile
```

Cloud Shell's home directory survives between sessions; the session itself
times out when idle, and reconnecting puts you back in the same directory.

## The whole thing in one service

The API can serve the client from its own process: set `SERVE_CLIENT` to the
built client directory and it answers `/` with the app and `/api/**` with the
API, from one address. No CORS, no second host, and no build-time API address
to get wrong — the browser calls `/api` on whatever origin served the page.

`render.yaml` in the repository root is that deployment, ready to use, on a
host with a free tier and no billing account:

1. Provision the database (section 1 below) and apply the schema (section 2).
2. On render.com: **New → Blueprint**, point it at this repository.
3. It asks for two values, and only two:
   - `DATABASE_URL` — the **application** role, `scrbrd_app`, never the owner.
   - `SESSION_SECRET` — 32+ random bytes (`openssl rand -hex 32`).
4. Deploy. The address it gives you is the whole product.

A free instance sleeps when idle and takes a while to answer the first
request after that. It is a demonstration, not a service a school depends on.

Until the pilot moves to a paid plan, `.github/workflows/keep-warm.yml` keeps
it awake through school cricket's hours (weekday afternoons and Saturdays,
SAST) by pinging `/api/health` every ten minutes, about 170 of the plan's 750
instance-hours a month. Set the repository variable `SCRBRD_HEALTH_URL`
(Settings → Secrets and variables → Actions → Variables) to the service's
`/api/health` address; unset, the job does nothing. Run it once by hand from
the Actions tab to see it answer 200.

### The deployed revision

`GET /api/health` carries `"revision"`: the full commit id the process was
built from, read from `RENDER_GIT_COMMIT` (Render sets it), else `GIT_COMMIT`
(set it yourself on Cloud Run or a hand-built image), else `null`. After each
deploy, `curl -s <service url>/api/health` and compare it with the commit the
merge put on `main` (the merged PR's "merged commit" link; `git rev-parse
origin/main` while nothing newer has landed). A fast-forward merge makes that
the PR's own head; a merge or squash commit is a new id, and the PR's last
commit is then an ancestor of it (`git merge-base --is-ancestor <pr head>
<revision>`). `null` means the host did not say; it is not a pass. Only a hex
commit id is ever reported, never a path or a secret.

### A demonstration is not a pilot

The fixtures in `98_seed_pilot.sql` are invented people at invented schools,
and one-click sign-in as any of them (`NODE_ENV=development` plus
`ALLOW_DEV_LOGIN=1`) is a reasonable thing to put in front of someone who
wants to see what SCRBRD does. Nothing real is exposed, because nothing there
is real.

The moment one actual child's record goes into a database, that arrangement
is indefensible, and the rules are not negotiable: a fresh database from the
same migrations, no seed, `NODE_ENV=production`, no dev login, and a first
administrator from `tools/bootstrap.mjs` who invites everyone else by handing
them a code. The two must never be the same database.

## Two ways to deploy, and which to do first

| | Who deploys | What it needs |
|---|---|---|
| **By hand** (start here) | you, signed in as yourself | nothing beyond Cloud Shell |
| **On push to main** (later) | GitHub Actions | two service accounts and three secrets, section 6 |

Do the manual deploy first. It is two commands, it proves the whole thing
works end to end, and it needs no robot accounts or stored credentials. The
automation in section 6 only removes the step of typing those two commands,
and it will make much more sense once you have watched them work.

## One-time provisioning

Done by an operator with owner rights on the project. None of it is in a
workflow because none of it should happen twice.

### 1 · A Postgres, either way

Two routes. **Supabase** needs no billing account and is what the first
deployment used; **Cloud SQL** is the one to grow into. The schema applies
cleanly to Postgres 15, 16 and 17.

#### Supabase

Create a project, then, in the dashboard's **SQL Editor**:

```sql
-- The application role. db/06_app_role.sql creates it with a DEVELOPMENT
-- password if it does not exist, and that password is published in this
-- repository — so either create it here first, or run this immediately
-- after migrating. Either way it must not keep the default.
ALTER ROLE scrbrd_app WITH PASSWORD '<app secret>';
```

Connection strings come from the green **Connect** button at the top of the
dashboard, not from the settings sidebar. Take the **session pooler** one:
direct connections are IPv6-only and most build environments are not. The
pooler wants the role and the project reference together as the username,
including for the application role:

```
postgresql://scrbrd_app.<project-ref>:<app secret>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

**Never run `--reset` against Supabase.** It drops the whole public schema and
takes Supabase's own objects with it. The migrator now refuses `--reset` for
any host that is not `localhost`, `127.0.0.1` or the compose service `db`
(exit code 2); the override, `I_UNDERSTAND_THIS_DESTROYS_PRODUCTION=1`, is
named for what it does.

Use `--reset-objects` instead. It drops only what this project created in
`public`, **by name**: the tables, views, routines, types and sequences that a
`db/NN_*.sql` file creates, read out of the files themselves
(`tools/reset-objects.mjs`), plus the ledger. The schema, its grants, anything
belonging to an extension, and any object another application keeps in
`public` are left exactly as they were. (Until GA-I02 it dropped every
non-extension object in `public`, ours or not.) The ledger goes with it, so
the next run applies every migration from the beginning.

It refuses a host that is not local, as `--reset` does, with its own override
named for what it does:

```sh
I_UNDERSTAND_THIS_ERASES_EVERY_SCRBRD_RECORD=1 \
DATABASE_URL='<owner connection string>' node tools/migrate.mjs --reset-objects --seed
```

`--reset`'s override does not open it. Two things it cannot do for you:

- **It stops if somebody else's object is built on one of ours** — a view over
  our table, a function taking our type, a foreign key into our table — and
  names it, before dropping anything. Remove or detach that object first. A
  leftover from an older edit of a pilot-era file (a view no current file
  creates, over a table that one does) stops it the same way.
- **A name is all it goes by.** Another application's object with exactly the
  name of one of ours (its own `player` table) is taken for ours, and every
  overload of one of our routine names goes. Only a separate schema would
  close that.

`tools/smoke-reset-objects.mjs` proves both paths — this one and section 1 of
the rebuild bundle, which is the same statement — against a scratch database
holding somebody else's table, view, function, enum and sequence.

That is the DEMONSTRATION path, and only the demonstration path: it destroys
everything this project holds in the database and reseeds it with invented
people. Take and prove a backup first
([docs/pilot/BACKUP_RESTORE.md](docs/pilot/BACKUP_RESTORE.md)) if there is
anything in it you would miss.

For a database that already carries the ledger — the demonstration instance
after its first rebuild included — a new migration does not need a rebuild,
and a rebuild throws away whatever was added since (the owner's real account
and key, for one). `node tools/bundle-sql.mjs --apply 14` writes
`scrbrd-supabase-apply-14.sql`: the one file and its ledger row, exactly what
`tools/migrate.mjs` would apply, guarded so it refuses to run twice or ahead of
its predecessor. Paste that instead, then the verify bundle. Against a
database holding one real record it is exactly as wrong as `--reset` would be
— there the rule above still stands, and a schema change is a new
`db/NN_*.sql` with the `ALTER`s.

Two things to know before choosing this for anything real: a free project
sleeps after about a week of inactivity, and the region list has nothing in
Africa, so every query from a South African school crosses to Europe and back.

#### Cloud SQL

Create a Postgres 16 instance in `africa-south1`, private IP or public with
the Cloud SQL Auth Proxy — either way, the API reaches it over the Cloud SQL
socket and nothing reaches it from the internet. Then, as `postgres`:

```sql
CREATE ROLE scrbrd LOGIN PASSWORD '<owner secret>' CREATEDB CREATEROLE;
CREATE DATABASE scrbrd OWNER scrbrd;
-- The application role, with a real secret. db/06_app_role.sql creates it
-- with a development password ONLY if it does not already exist, so create
-- it first and the migration leaves it alone.
CREATE ROLE scrbrd_app LOGIN PASSWORD '<app secret>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
```

Two roles, on purpose, on either host. The owner owns the schema, and
row-level security does not apply to a table's owner. `scrbrd_app` is what
the API connects as, and `server.mjs` asks the database what it is at boot
and refuses to start on a connection that owns tables or can bypass RLS —
which is how a first deployment discovered it had been handed the owner's
connection string by an environment variable it had forgotten was exported.

### 2 · Schema

From a machine running the Cloud SQL Auth Proxy on `127.0.0.1:5432`, as the
owner, with **no** `--reset` and **no** `--seed`:

```sh
DATABASE_URL=postgres://scrbrd:<owner secret>@127.0.0.1:5432/scrbrd node tools/migrate.mjs
DATABASE_URL=postgres://scrbrd:<owner secret>@127.0.0.1:5432/scrbrd node tools/migrate.mjs --verify
```

`--verify` runs `db/99_rls_verify.sql`, the live policy assertions, against
the real instance. The pilot seed is fixture data with development sign-ins in
it and never goes near this database.

The migrator keeps a ledger, `schema_migration`: each `db/NN_*.sql` is
recorded with its hash when applied, skipped when unchanged, and **refused**
if it changed after it ran. So a schema change after go-live is a new file
with a higher number — `db/10_….sql` with the `ALTER`s — applied by the same
command, by the owner role, before the code that needs it is deployed. Editing
a file that has already run is not a migration path; the migrator says so.
The full rule, the generated-file case and the paste procedure are under
"Changing the schema after go-live" below.

### 3 · The first person

Nobody can be invited until somebody holds `user.invite`, so the first
platform administrator is written directly, once:

```sh
DATABASE_URL=postgres://scrbrd:<owner secret>@127.0.0.1:5432/scrbrd \
SESSION_SECRET='<the same secret the API runs with>' \
  node tools/bootstrap.mjs --email ops@example.co.za --name "Platform Ops" \
    --school HIL "Hilton College" KwaZulu-Natal
```

It prints a login code, once. `SESSION_SECRET` must be the API's: the code is
stored hashed with it and `/api/auth/redeem` hashes the typed code with the
same. That person signs in with the code, and invites the school's first
administrator from the app. Running it again for the same email mints a new
code and changes nothing else — the recovery path for a locked-out operator.

### 3a · The owner's key

The platform administrator above can grant every role but one. The owner's
key — `superadmin`, every capability, no school — is deliberately not
grantable from inside the platform (`db/99` asserts it), so it is written the
same way, once, with `--owner`:

```sh
read -rs SESSION_SECRET && export SESSION_SECRET
DATABASE_URL=postgres://scrbrd:<owner secret>@127.0.0.1:5432/scrbrd \
  node tools/bootstrap.mjs --owner --email you@example.co.za --name "Your Name"
```

Until this existed the only thing that ever created that assignment was
`98_seed_pilot.sql`, which must never run here. The seed still carries a
fixture owner for the demonstration; this is the one for a real database.
The verify bundle's "An owner's key exists" column reads OK when somebody
holds it.

### 3b · The owner's way back in

Every other account's code is reissued by whoever holds `user.invite` at
their school. The owner answers to no school, so there is no office for
theirs — and a code is single-use and time-boxed like any other, so the day
comes when it has expired and section 3a's SQL is the only way back in.

`POST /api/auth/owner/recover` is that door, permanently open and normally
inert: it is a 501 until `OWNER_RECOVERY_SECRET` is set as an environment
variable on the API — a **separate** secret from `SESSION_SECRET`, generated
once and known only to the operator:

```sh
openssl rand -base64 32
```

Set it on Render (or wherever the API runs) alongside `SESSION_SECRET`. From
then on, `https://<your-domain>/recover.html` — not linked from the app, kept
by the operator — takes the owner's email and that secret, and returns a
fresh sign-in code good for 24 hours. No SQL Editor, no `DATABASE_URL`, no
Claude session required.

The function behind it, `owner_recovery_issue()` (`db/18`), has exactly one
gate of its own: the account named must already hold a live, platform-wide
`superadmin` assignment. It cannot create that assignment or touch any other
account, so a leaked `OWNER_RECOVERY_SECRET` lets somebody refresh the
owner's own code — a real risk, on the order of `SESSION_SECRET` leaking —
never mint new privilege. Rotate it (generate a new one, update the
environment variable) if it is ever suspected to have leaked; nothing else
needs to change.

### 4 · Secrets

In Secret Manager, on the project:

| Secret | Value |
|---|---|
| `DATABASE_URL` | `postgres://scrbrd_app:<app secret>@/scrbrd?host=/cloudsql/scrbrd-os:africa-south1:<instance>` |
| `SESSION_SECRET` | 32+ random bytes; the API refuses to start without it outside development |
| `WEB_ORIGIN` | only when the client is served from another origin (Firebase Hosting: `https://scrbrd-os.web.app`). Unset on Render, where the API serves the client itself |
| `ANTHROPIC_API_KEY` | optional; without it Stats-Magic and commentary answer null |
| `OWNER_RECOVERY_SECRET` | optional; unset means /api/auth/owner/recover is a 501. Separate from SESSION_SECRET — see §3b |
| `GUARDIAN_APP_URL` | The Guardian's app, CSA's anonymous-reporting partner, linked from Safeguarding (db/57). https only; unset, the screen says the link has not been set. Not a secret, but set here with the rest |
| `PUBLIC_PAGES` | **leave unset** until the information officer has confirmed `docs/policy/PUBLIC_DATA.md` in writing (filed in `docs/policy/`). Unset (or anything but `on`), every public path — `/api/public/*`, `/live/*`, `/scorecard/*`, `/table/*`, `/fixtures/*` — answers the one 404. `on` serves the signed-out pages (SCRBRD-083, see below) |
| `PUBLIC_PSEUDONYM_SECRET` | required when `PUBLIC_PAGES=on`: 32+ random bytes (`openssl rand -hex 32`), **not** the `SESSION_SECRET`. Keys the per-match HMAC pseudonyms that stand in for every player id on a public page; it is never in the code or the database, so a database dump cannot turn a pseudonym back into a boy. The API refuses to start without it, or with the session secret reused. Rotating it changes every pseudonym (harmless: they are per-match and nothing stores them) |
| `SUPABASE_URL` | where scorebook photos are stored (SCRBRD-120, db/63): the Supabase project's URL, `https://<project-ref>.supabase.co` — the project that holds the database, so the photos sit in its region. Not a secret. See "The scorebook importer's photos" below |
| `SUPABASE_SERVICE_ROLE_KEY` | the same project's **service-role** key (Project Settings → API). A secret: it reads and writes every bucket, and never leaves the API — no photo is ever signed for a browser. Unset with `NODE_ENV=production`, photo uploads answer 503 `store_unconfigured` and nothing is written to the server's disk |
| `SCOREBOOK_BUCKET` | optional, default `scorebook-pages`: the private bucket's name |
| `GOOGLE_WEATHER_API_KEY` | optional. The Practice Match weather hint (`GET /api/weather/hint`) asks Google's Weather API with it; unset, the hint answers 503 `weather_unavailable` and the scorer picks the weather from the buttons as before. A secret: it stays in the API's environment, goes only in the request header to Google, and is never logged or sent to a browser. Restrict it as below ("The weather hint") |
| `PUBLIC_TRUST_PROXY_HOPS` | optional, default `0`. How many proxies in front of the API append to `X-Forwarded-For`, for the public pages' per-address rate limit (120 a minute, bursts of 30). `1` behind Cloud Run alone or Render; `2` behind Firebase Hosting in front of Cloud Run. `0` behind a proxy limits everybody as one address |

#### Turning the public pages on (SCRBRD-083)

They are off by default because go-live waits on the design's phase 1 "before
live" conditions: the information officer's written confirmation of
PUBLIC_DATA.md, one pilot school publishing and withdrawing a side, the
never-public mark exercised on the pilot, and the rate limit measured against
a real match's poll. Then, on the API: set `PUBLIC_PSEUDONYM_SECRET` (a new
secret), set `PUBLIC_PAGES=on`, and redeploy. `GET /api/health` says
`"public": "on"` (or `"on_without_notifications"` if its LISTEN connection is
down, when a change reaches a page within the cache's 60 seconds rather than
on the next request). Nothing is public until a school's `broadcast.publish`
holder publishes its side of a fixture from the fixture screen; the page is
then `/live/<fixture id>` (and `/scorecard/<fixture id>`). Firebase Hosting
rewrites those four prefixes to the API (`firebase.json`); the single-service
deployment (`SERVE_CLIENT`) needs nothing more.

#### The weather hint (Practice Match, 2026-10-02)

`GET /api/weather/hint?lat=…&lon=…` gives a signed-in person the current
conditions at a ground from Google's Weather API (`currentConditions:lookup`),
in the scorer's words (sunny, partly_cloudy, overcast, drizzle, rain, storm,
fog, windy), marked "Weather by Google". It needs no migration and stores
nothing in the database: the match's weather stays what the scorer records.
Only the position goes to Google, rounded to two decimal places (about a
kilometre). Answers are kept in the process for ten minutes at most, per
rounded position, and sent to the browser `no-store`; each person may ask 30
times a minute. `GET /api/health` says `"weather": "configured"` or
`"unconfigured"`.

`GOOGLE_WEATHER_API_KEY` is **optional**. To set it up, in the Google Cloud
project that bills Maps Platform:

1. APIs & Services → Library → enable **Weather API**.
2. APIs & Services → Credentials → Create credentials → API key. Then edit it:
   - **API restrictions:** Restrict key → **Weather API** only. A leaked key
     then reaches nothing else on the account.
   - **Application restrictions:** not *HTTP referrers*. The API calls Google
     from the server, which sends no referrer, and a referrer-restricted key
     is meant for a browser, where this key must never be. Use *IP addresses*
     with the outbound addresses the host lists (Render: the service's
     Connect → Outbound tab), or *None* on a host with no fixed outbound
     address — the API restriction and the quota still hold it.
3. APIs & Services → Weather API → Quotas: cap requests per day at what the
   pilot needs (a few thousand is generous with the ten-minute cache), so a
   leaked key cannot run up a bill.
4. Set the key on the API service (Render: Environment → `GOOGLE_WEATHER_API_KEY`;
   Cloud Run: a Secret Manager secret, as the table above) and redeploy. Never
   in the client's build variables, never committed.

To rotate it: make a new key with the same restrictions, set it, redeploy,
then delete the old one. `GOOGLE_WEATHER_BASE_URL` exists only for the API
walk's stub and is ignored in production and for any non-loopback address.

#### Workload monitoring (SCRBRD-110, db/60)

`db/60_workload_consent_count.sql` adds the nets band, each bowler's load
figures and the health-monitoring consent. It needs no secret. The feature
`workload_monitoring` arrives **off** for every school: until the platform
grants it to a school (Settings → Modules, as a `platform.feature.manage`
holder), `POST /api/load-entry` and the `load` / `load_weeks` reads answer
`module_disabled`, and the database refuses the row as well. The consent
route and the `consents` read are never switched off — a family's answer is
theirs to give and withdraw. `db/60` stands without SCRBRD-110's phase 0 (the
guardian link past eighteen, waiting on the information officer): until that
lands, a parent's health consent ends on her son's eighteenth birthday with
her access, which is today's rule.

#### The scorebook importer's photos (SCRBRD-120, db/63)

`db/63_scorebook_import.sql` adds importing a match scored on paper: photos
of the scorebook's pages, a card typed beside them, a second person's
confirmation. The module `scorebook_import` arrives **off** for every school;
the platform grants it per school (Settings → Modules, as a
`platform.feature.manage` holder) — until then every route answers
`module_disabled`, and the database refuses as well.

The photos carry children's names and handwriting from two schools, so they
are kept privately, read only through the API (every read on `access_log`),
and deleted thirty days after the import is confirmed (at once when it is
abandoned). They live in **Supabase Storage**, in the database's own project:

1. In the Supabase dashboard of the project that holds the database: check
   **Project Settings → General → Region** is the region you mean the
   children's data to be in. The photos go where the project is; this is
   the residency check the design asks for before the first photo is stored.
2. **Storage → New bucket**: name `scorebook-pages`, **Public bucket OFF**.
   Optionally set its file size limit to 8 MB and its allowed types to
   `image/jpeg, image/png`. Add **no** storage policies: the API reaches it
   with the service-role key, which bypasses them, and with none nobody
   else — not `anon`, not `authenticated` — can list, read or write it.
3. On the API (Render, Cloud Run): set `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (and `SCOREBOOK_BUCKET` if the bucket has
   another name). `GET /api/health` then says `"pages": "supabase"`.
   `"unconfigured"` means the variables are missing and uploads are refused;
   `"local"` must never appear outside development.
4. **The daily purge.** Photos past their window are deleted by
   `POST /api/scorebook/purge`, called with a platform administrator's (or
   the owner's) token; for anybody else it deletes nothing. Until a
   scheduler exists, run it by hand, or from any daily job:
   ```sh
   curl -X POST -H "Authorization: Bearer <platform token>" https://<your-domain>/api/scorebook/purge
   # {"due": 4, "deleted": 4, "failed": 0}
   ```
   It also abandons drafts nobody has touched for thirty days. A photo the
   store would not delete stays due and is tried again on the next run.

In development and in the walks the photos go to a local directory
(`SCOREBOOK_STORE_DIR`, default under the OS temp directory); that backend
refuses to exist when `NODE_ENV=production`.

<!-- ── SCRBRD-124 phase 1: parent lift clubs (db/70) ── -->
#### Parent lift clubs (SCRBRD-124, db/70)

`db/70_lift_clubs.sql` adds the arrangement half of parent lift clubs:
parents offer seats in their own cars to their own son's fixtures, other
parents ask for a seat for theirs, and a seat is confirmed only while the
boy's guardian and the driver have both said yes to the lift as it now
stands. A pupil takes no part, except that a pupil of eighteen still at
school may ask for, withdraw and read his own seat. It needs no secret. The
day's marks (left, boy in, handed over, received) are phase 2 and are
**not** in this file.

**Do not grant it to a school before db/76 (phase 2, below) is pasted.** The module `lift_club` arrives **off**
for every school, and the design puts it live only after phase 2: an
arrangement with no record of the day is a noticeboard. When it is time, it
takes two keys, in this order:

1. The platform grants `lift_club` to the school (Settings → Modules, as a
   `platform.feature.manage` holder).
2. The school's principal signs the school's lift policy (Settings → School,
   "Lift clubs at …"). Until a signed policy stands, nothing is live; the
   principal's withdrawing it cancels every open lift at the school at once
   and tells the families.

Taking the grant back stops new arrangements everywhere at the school at
once; a family's withdrawal, a driver's or the office's cancel, and the
policy's withdrawal are never switched off. The paste is
`node tools/bundle-sql.mjs --apply 70`, then the verify bundle (§48 is its
proof).
<!-- ── end SCRBRD-124 ── -->

<!-- ── SCRBRD-114 phases 3b and 3c: the super over (db/71), knockout progression (db/72) ── -->
#### The super over and knockout progression (SCRBRD-114, db/71 and db/72)

`db/71_super_over.sql` lets a tied match whose playing conditions say
`result.tie_break = super_over` be settled by a super over, and keeps every
career, milestone, dossier and wheel from counting one. It re-emits the
career readers over a new view, `ball_event_career`, adds a last column
(`super_over`) to `ball_event_live` and `match_live_score`, and drops and
re-creates `public_match_result()` with one more column. Nothing is
backfilled: no match has a super over until a pad sends one, and an older
pad cannot. One behaviour changes for every school at once: **a tied cup
match is not marked complete** while nothing has settled who goes through
(`super_over_pending` from the fixture route); a league's tie, under the
platform default `none`, is unaffected.

`db/72_knockout_progression.sql` adds `match_progression`: publishing a
knockout plan makes a later round's fixture from the earlier results'
winners, and a later correction re-resolves an unplayed fixture's side or
flags a played one for the organiser.

Paste in order, each once: `node tools/bundle-sql.mjs --apply 71`, then
`--apply 72`, then the verify bundle (§50 and §51 are their proofs). Both
before the API that reads them: the API's routes for the result, the live
score, the public page and the planner's publish call `db/71` and `db/72`
by name.
<!-- ── end SCRBRD-114 phases 3b and 3c ── -->

<!-- ── SCRBRD-130: the rain rule (db/73–75) ── -->
#### The rain rule: interruptions, venue par, the DLS table (SCRBRD-130, db/73–75)

Three files, pasted in turn, then the verify bundle once (§52–§54 are their proofs):

```sh
node tools/bundle-sql.mjs --apply 73   # interruptions in the log, the par clause, the deemed NRR figures
node tools/bundle-sql.mjs --apply 74   # venue par at a ground
node tools/bundle-sql.mjs --apply 75   # the DLS resource table: storage, the loader, the frozen reference
node tools/bundle-sql.mjs              # → scrbrd-supabase-verify.sql
```

None needs a secret. After `db/75` the calculator answers *No DLS table
loaded; enter the umpires' figures* everywhere until an operator loads the
table; nothing else waits on it — the record is always the umpires' figure.

**Loading the real table (once, by a platform administrator).** The table is
never in the repository, a migration or a seed (design D5): it is a CSV held
outside it, transcribed from the ICC playing conditions' section 06 (the D-L
Standard Edition, ball by ball, 301 rows × 10 wickets). Its sha256 is the one
recorded in `docs/design/SCRBRD-130_rain_and_par.md` §8.

1. Sign in as a holder of `platform.reference.manage` — a platform
   administrator (`platformadmin` on an assignment naming no school) or the
   owner — as yourself, not inside a support session (the loader refuses one).
   Go to **Settings → DLS table**.
2. Choose the CSV. The screen shows the file's sha256: **it must equal the one
   in §8**. If it does not, stop: the file is not the checked transcription.
   (`sha256sum <file>` on your machine gives the same figure.)
3. Fill in: **Title** `DLS Standard Edition, ICC playing conditions section 06`;
   **Grain** by the ball; **Balls in the full innings** 300; **Figures in**
   per cent (or "read from the file"); **Publisher** ICC; **Document** the
   section's title; **Edition date** the document's; **Permission**
   `granted by the school (Kameel) for the pilot, 2026-10-01`.
4. **Load as a draft.** Expect *Every structural check passed* with 3010 cells
   and a content hash; a refusal lists each check that failed, and nothing is
   kept. The cells go to the database and are never shown or sent back.
5. **Publish.** Matches fixed from now on name this version in their frozen
   conditions and read it for ever; a match fixed earlier reads the current
   table and its words say so.
6. **G50 is the league's, not the platform's.** In the pilot league's
   conditions, its officer enters `target.g50` = 200 (cited to the same
   section 06, "lower levels of the game") and `target.method` =
   `dls_standard`, with their source, and publishes the version. No platform
   default exists; without it the calculator's third line says *G50 not set*.

A correction is the next version: load it, publish it, then withdraw the old
one with a note. A withdrawn table keeps its rows; matches that named it still
read it, and say *table since withdrawn*. No route ever serves a cell.
<!-- ── end SCRBRD-130 ── -->

<!-- ── SCRBRD-124 phase 2: the day (db/76) ── -->
#### Parent lift clubs, the day (SCRBRD-124, db/76)

`db/76_lift_day.sql` adds the day: the driver's marks (left, boy in, handed
over, not collected, arrived), the receiver's "with us" (the side's coach on
the way there) and "collected" (the boy's guardian on the way home), the
office's exceptions by name and resolve, the coach's expected list, the
boy of eighteen's own line, the watch, and the purge. It needs no secret and
applies after db/75.

**After this paste the module may go live per school, and it stays off by
default.** It still takes the two keys of db/70, in that order: the platform
grants `lift_club` to one school (Settings → Modules), then that school's
principal signs its lift policy. Grant it to the pilot school only when
Kameel says so.

**The watch** (`lift_missed_watch()`) tells a family when a lift is 45
minutes past its meeting time and not marked as left, and when a boy handed
over has not been acknowledged within 30 minutes — once per seat. It is run
by the platform's key (a `platform.feature.manage` holder, platform-wide);
for anybody else it is refused. Until a scheduler exists, run it every few
minutes on match days from any job:
```sh
curl -X POST -H "Authorization: Bearer <platform token>" https://<your-domain>/api/lifts/watch
# {"notLeft": 0, "notReceived": 0}
```
**The purge** is the office's, never a job: Settings → School lists the
lifts three years past their fixture and the declarations a year past their
end; each purge leaves a row of counts for the season, naming nobody.

The paste is `node tools/bundle-sql.mjs --apply 76`, then the verify bundle
(§55 is its proof).
<!-- ── end SCRBRD-124 phase 2 ── -->

<!-- ── SCRBRD-139: public commentary names the shot (db/78) ── -->
#### Public commentary names the shot and where it went (SCRBRD-139, db/78)

`db/78_public_shot_words.sql` re-emits `public_match_log()` (db/73's, md5-guarded)
with two keys for a ball: `shot`, and `place` (theta, radius, seg and the
placement's source), which only the API reads. The API turns `place` into the
word the commentary says ("cover") and drops it, so no coordinate reaches a
browser or the public cache (PUBLIC_DATA L7 as amended, 2026-10-01). No secret,
no backfill: every ball already scored is worded from what it already carries.

Paste `node tools/bundle-sql.mjs --apply 78`, then the verify bundle (§57 is its
proof). Either order with the API is safe: the API from before this change drops
`shot` and `place` (neither is on its list), and this API against a database
without db/78 has nothing to word, so its lines say "Four" as before. Only both
together name the shot.
<!-- ── end SCRBRD-139 ── -->

<!-- ── SCRBRD-132 B2: the audit log (db/79) ── -->
#### The audit log, read (SCRBRD-132 B2, db/79)

`db/79_audit_log.sql` adds `audit_log()`, the one door Management's **Audit
log** tab reads through: the school's audit tables under each one's own
`audit.read` predicate, never a safeguarding row and never a written reason, a
child named by initials, and one `access_log` row for every read of it. It
creates no table, changes no policy and needs no secret or backfill: every row
it shows is one the audit tables already hold.

Paste `node tools/bundle-sql.mjs --apply 79`, then the verify bundle (§58 is its
proof). **Schema first:** the API built with it serves `GET
/api/read/audit_log`, which against a database without db/79 is a `42883`
(the server refuses to start on the missing migration anyway). The tab is
read-only, so nothing a school does waits on it.

`db/80_audit_log_grants.sql` re-emits `audit_log()` with roles **granted** as
well as ended (`role_assignment`, under `audit.read` and that table's own
reader; never a support hour's assignment; a child by initials). db/79 is not
touched: db/80 refuses to run unless the `audit_log()` in place is db/79's as
shipped (the md5 of its body) or db/80's own. No table, policy, secret or
backfill: every appointment already on record appears, those made by a seed
or a migration with no actor ("The system" on the tab).

Paste `node tools/bundle-sql.mjs --apply 80` (after 79), then the verify bundle
(§59 is its proof). **Schema first**, as always: the code built with it lists
db/80 in `expected-migrations.json` and refuses to start without it. The
route and its shape are unchanged, so the code from before it, against a
database with db/80, already serves the grants; its tab only words them less
well ("Roles ended" for the filter, and "Somebody no longer on the system"
for a seeded grant's missing actor) until the client follows.
<!-- ── end SCRBRD-132 B2 ── -->
<!-- ── SCRBRD-140 phase 1: sign-in with Google (db/81) ── -->
#### Sign-in with Google, and an account with no school (SCRBRD-140, db/81)

`db/81_signup_google.sql` adds `auth_identity` and `pending_claim` (no policy,
no privilege for the application: every read and write is a function), the
functions behind `POST /api/auth/firebase`, the pupil-consent trigger, one line
in `decide_role_request()` (a first grant gives a school-less account its
school), and **D14**: sixteen read policies that let any signed-in account read
reference data — umpires' records among them — now ask for a live assignment
(`app_enrolled()`). It depends on nothing in db/79–80 and applies after either.

**One behaviour changes for every school at once: who may issue a login code.**
db/81 re-emits `login_code_issue()` (db/05). Before it, anybody holding
`user.invite` at a school could issue a code — which comes back to the issuer —
to any account filed at that school, the principal's and the DSO's included. Now
the issuer must be able to appoint every role the account holds there
(`app_may_grant_at()`, db/77), and an account holding anything platform-wide
(the owner's key, a platform administrator) takes a superadmin. In the pilot's
role table that means: the office still issues codes for coaches, parents,
pupils, officials and its own colleagues; **a principal's, a director of
sport's or a DSO's code — and that of anybody holding roles at two schools —
comes from the owner** (`/api/auth/invite` signed in with the owner's key), or
the person signs in with Google. The same rule decides who may confirm a Google
sign-in onto an account (the office's Claims list).

**No new secret.** Google's signing keys are public; the API fetches them from
`www.googleapis.com` (A9) and caches them. If it cannot, the exchange answers
503 and the sign-in screen offers the office code; nothing skips the signature.
`FIREBASE_TEST_KEYS` exists for `tools/smoke-signup.mjs` only: the API refuses
to start with it set and `NODE_ENV=production`, and even in development it
verifies only the project `scrbrd-os-test`. **Never set it on a deployment.**

Before anybody signs in with Google (design §11): Kameel enables Authentication
and the Google provider in the `scrbrd-os` Firebase console, with the
address the app is served from as an authorised domain (A1): for the pilot
that is the Render service, `scrbrd.onrender.com`, plus a custom domain if one
is added (Authentication → Settings → Authorized domains). A domain missing
from that list fails Google sign-in with `auth/unauthorized-domain`. Kameel signs
the privacy notice's paragraph on the transfer outside the Republic (§7.5, A5).
Until the sign-in screen ships, the route is simply unused.

Paste `node tools/bundle-sql.mjs --apply 81`, then the verify bundle (§60 is its
proof). **Schema first**: an API with the route against a database without
db/81 refuses to start (the migrations guard), as for every file.
<!-- ── end SCRBRD-140 phase 1 ── -->
<!-- ── SCRBRD-142 phase 2: listing on the home page (db/82) ── -->
#### Listing on the home page, and its live read (SCRBRD-142, db/82)

`db/82_public_listing.sql` adds `public_listing` (one switch per school, **off
until switched on**, written only through `public_listing_set()` under
`broadcast.publish` at the school with no team: the director of sport or the
office), and `public_live_fixtures()`, the home page's strip: today's fixtures
where a side is published **and** that side's school lists (PUBLIC_DATA rule 7
as amended, D1a). Team facts only — no ground, no player. A trigger on the
switch drops the public cache. No secret, no backfill: no school lists until
one says so, so the strip is empty after the paste.

Paste `node tools/bundle-sql.mjs --apply 82` (after 81), then the verify bundle
(§61 is its proof). **Schema first**: the API built with it serves `GET
/api/public/live` and `GET/POST /api/schools/:id/listing`, and refuses to
start without db/82 (`expected-migrations.json`). With `PUBLIC_PAGES` off the
live read is the one 404 and the home page hides the strip.

**The home page itself (phase 1) needs no paste.** It ships with the client:
`/` and `/privacy` are `home.html`, the app is at `/app`. Hosting no longer
uploads `index.html` (it would answer `/` before any rewrite) and serves the
app as `/app.html`, which the build writes beside it; `serveClient` does the
same for a single container. The service worker's shell moves to a v2 cache.
<!-- ── end SCRBRD-142 phase 2 ── -->
<!-- ── SCRBRD-142 phase 3: public news on the home page (db/83) ── -->
#### Public news on the home page (SCRBRD-142, db/83)

`db/83_public_news.sql` adds `news_post_public` (a side table: one row per
request to put a notice on the home page; db/12 is untouched) and its four
doors: `news_public_request()` (the author, a sent team or school post),
`news_public_approve()` (`broadcast.publish` at the post's school with no team,
**never the author or the requester**, and refused `names_pupils` with a count
when the words name one of the school's pupils by full name or known-as),
`news_public_withdraw()` (the author or any `broadcast.publish` holder at the
school — so the office can take a coach's post down), `news_public_check()`;
and `public_news()`, the home page's read: approved, unwithdrawn, unedited
posts of schools that list (db/82's switch), no author. Triggers on both tables
drop the public news cache. No secret, no backfill: nothing is asked for, so the
section is empty after the paste.

Paste `node tools/bundle-sql.mjs --apply 83` (after 82), then the verify bundle
(§62 is its proof). **Schema first**: the API built with it serves `GET
/api/public/news` and `POST /api/news/:id/public/{request,approve,withdraw}`,
reads the request state on the newsfeed, and refuses to start without db/83
(`expected-migrations.json`). With `PUBLIC_PAGES` off the news read is the one
404 and the home page hides the section.
<!-- ── end SCRBRD-142 phase 3 ── -->
<!-- ── security review 2026-10-06: the guards beneath the routes (db/84) ── -->
#### The database keeps the routes' rules (db/84)

`db/84_row_guards.sql` puts three of the review's route fixes where every door
passes them. **A squad row's boy must be the side's school's**
(`match_squad_00_school_of_side`, 42501, naming nobody), and the trigger is
named to fire before the two db/08 triggers whose refusals name the boy, his
age and his consent state; the file's own check asserts that order. **A news
post's scope, school, side, competition and author never change on UPDATE**
(`news_post_anchor_frozen`, 42501): db/12's policy let an author move his own
post to another school. **`role_request.asked_unverified`** marks a request not
asked by its person signed in as himself — `POST /api/onboard` — and the mark
survives Google linking the stub; the office's Requests list says "Asked
before the email was verified". Pending requests already in the table are
marked when no Google sign-in was linked to the account before they were
asked. No secret.

Paste `node tools/bundle-sql.mjs --apply 84` (after 83), then the verify bundle
(§63 is its proof). **Schema first**: the API built with it reads
`role_request.asked_unverified` and refuses to start without db/84
(`expected-migrations.json`).
<!-- ── end security review 2026-10-06 ── -->
<!-- ── GA-I03: a session ends when it is ended (db/85) ── -->
#### A session ends when it is ended (GA-I03, db/85)

`db/85_session_revocation.sql` gives every account a session epoch
(`auth_epoch`) and every token a session (`auth_session`), both with no policy
and no privilege for the application, and `app_session_begin()`, which the API
now calls to become somebody: the account must be active and the token's
session live under the current epoch. **Signing out ends the token on that
device; `POST /api/auth/sign-out-everywhere`, the office disabling an account
(`POST /api/auth/users/:id/disable`, or a plain `UPDATE app_user SET active =
false`), and removing a Google sign-in end every token and pad credential the
account holds**, on their next request. Role revocation is unchanged. No
secret, no backfill. `docs/AUTH_SPEC.md` has the rule.

Paste `node tools/bundle-sql.mjs --apply 85` (after 84), then the verify bundle
(§64 is its proof, and the summary row's "Sessions end when ended" reads OK).
**Schema first**: the API built with it calls `app_session_begin()` on every
request and refuses to start without db/85 (`expected-migrations.json`).
**Everybody signed in signs in once more** when that API is deployed: a token
minted before it names no session and is refused (`401 incomplete_claims`).
Deploy it outside a match; a pad's resume credential is not a token and keeps
scoring.
<!-- ── end GA-I03 ── -->
<!-- ── RBAC 2026-10-07: a platform role belongs to no school (db/86) ── -->
#### A platform role belongs to no school (db/86)

`db/86_platform_roles_need_no_school.sql` makes the database refuse a
`superadmin` or `platformadmin` appointment that names a school (Kameel,
2026-10-07: "a super admin role isn't attached to any school and shouldn't
be"). Before it, `POST /api/users` answered 200 to the platform account for a
platformadmin at a school and to the owner for a superadmin there, and a
superadmin at a school holds every capability there, medical and PII
included. The rule is a CHECK on `role_assignment`,
`platform_role_needs_no_school`, so every door passes it: each function,
the application's INSERT policy, and the SQL Editor. `enrol_person()` and
`decide_role_request()` answer it by name (`platform_role_needs_no_school`,
422 from the API). The tenant-less doors are unchanged: `tools/bootstrap.mjs`
(both forms), owner recovery (§3b) and the seed. A pending request for a
platform role can still be declined, and can never be granted. No secret, no
backfill.

**Before you paste, look for rows it would refuse.** If anybody tried the
diagnosis's request against this database, or appointed a platform role at a
school some other way, those appointments are on the record, live or ended,
and the paste stops and names each one without changing anything. Ask first,
in the SQL Editor:

```sql
SELECT a.id, u.email, a.role, s.code AS school, a.active, a.created_at
  FROM role_assignment a
  JOIN app_user u ON u.id = a.person_id
  LEFT JOIN school s ON s.id = a.school_id
 WHERE a.role IN ('superadmin', 'platformadmin') AND a.school_id IS NOT NULL;
```

No rows: paste. Rows: each one is an appointment that should never have
existed, so ending it is not enough (an ended row still breaks the rule).
Save that query's output first: it is the record of what you remove. Then
delete those rows by id, in one transaction, as the owner:

```sql
BEGIN;
DELETE FROM role_assignment WHERE id IN ('<id>', '<id>')
   AND role IN ('superadmin', 'platformadmin') AND school_id IS NOT NULL;
COMMIT;
```

The delete takes the appointment's subject links, suspensions, ending record
and support row with it, and clears the pointer to it on any role request,
access request and match official. An account made only to hold one of
these rows (an `app_user` with nothing else) stays, holding nothing. Disable
it from the office (`POST /api/auth/users/:id/disable`) if nobody should sign
in as it. If somebody really does need platform powers, they get a
tenant-less appointment from `tools/bootstrap.mjs`, never one at a school.

Paste `node tools/bundle-sql.mjs --apply 86` (after 85), then the verify bundle
(§65 is its proof, and the summary row's "Platform roles belong to no school"
reads OK). The paste locks `role_assignment` for the length of one statement,
which is milliseconds on a table this size, but every request reads that
table. Paste outside a match. If the lock is not granted within ten seconds
the paste stops with `lock_timeout` and changes nothing: paste it again.
**Schema first**: the API built with it refuses to start without db/86
(`expected-migrations.json`). It needs nothing new from db/86 to run, so the
order is the procedure's own rule and nothing more.
<!-- ── end RBAC 2026-10-07 ── -->
<!-- ── db/87: a wicket on a wide or a no-ball ── -->
#### A wicket on a wide or a no-ball (db/87)

`db/87_wicket_on_extra.sql` adds `ball_is_wicket(type, dismissal)` — a W, a
wide naming run out, stumped, hit wicket or obstructing the field (Law 22.9),
or a no-ball naming run out, hit the ball twice or obstructing the field (Law
21.17) — and asks it wherever SQL asked for a W: `ball_wicket_stands()` (the
live score, the handover's count, the result), the career readers, the
keeper's dismissals, the milestone trigger and db/68's keeper door, each
otherwise exactly as db/71 left it. A new door, `ball_event_out_off_extra`,
refuses a wide or no-ball naming any other method. No secret, no backfill;
the paste names how many stored wide or no-ball rows carry a dismissal (none
should: no client wrote one).

Paste `node tools/bundle-sql.mjs --apply 87` (after 86), then the verify bundle
(§66 is its proof, and the summary row's "Wickets off a wide or no-ball" reads
OK). **Schema first**: the API built with it refuses to start without db/87
(`expected-migrations.json`), and the pad records these wickets only once the
server's Laws take them.
<!-- ── end db/87 ── -->
<!-- ── db/88: public venue par (SCRBRD-133 G2) ── -->
#### Public venue par (SCRBRD-133 G2, db/88)

`db/88_public_venue_par.sql` (sha `3b45e737`) was applied to the demonstration and production databases on 2026-10-08 at about 05:25 UTC.
<!-- ── end db/88 ── -->
<!-- ── db/89: notifications S1, the contract and read state ── -->
#### Notices: the contract and read state (db/89)

`db/89_notification_contract.sql` is notifications slice S1
(`docs/design/NOTIFICATIONS.md` D1, D4, D5, D17–D19). `notification.kind` is
one of nine (CHECK `notification_kind_known`), `subject_kind` gains `welfare`
and `news`, and a trigger holds the contract: a default expiry by kind, and a
person's `notice` names no child, has no recipient, is never high and asks
news.read alone; no notice is public. Four retraction columns, written only by
`notification_retract()` (granted to nobody: the system's own triggers call it
from S2 and S5). `my_notifications`, a view as the caller, is what the notices
list and the summary's unread count both read; `notification_by_id()` opens one
(a tiered notice's open goes on `access_log` as `notification.open`).
`milestone_notice` and `recognition()` leave out a retracted mark.

Two backfills, both printed by the paste: every row's `is_public` becomes false
(nothing has read it since S0), and the pilot seed's one `training` notice
becomes a `notice` (only where that seed row exists). No row is refused or
deleted. If the paste WARNs that stored notices sit outside the nine kinds,
they stay as written and the CHECK stays NOT VALID — it still holds every new
row — and §68's (stored) assertion names them: that is a decision to take with
Kameel, not a reason to edit the file.

Paste `node tools/bundle-sql.mjs --apply 89` (after 88), then the verify bundle
(§68 is its proof, and the summary row's "Notices keep their contract" reads
OK). **Schema first**: the API built with it reads `my_notifications` and
refuses to start without db/89 (`expected-migrations.json`); the two receipt
routes, `POST /api/notifications/:id/read` and `/read-all`, are on that API.
<!-- ── end db/89 ── -->
<!-- ── db/90: account lifecycle slice 2, the reason, the preview, the notice ── -->
#### An account changes with a reason (account lifecycle slice 2, db/90)

`db/90_account_status_change.sql` is slice 2 of `docs/design/ACCOUNT_LIFECYCLE.md`
(D3, D4, D20, Q3). Disabling or enabling an account now needs a reason of ten
characters or more (`POST /api/auth/users/:id/disable` and `/enable`
`{ reason }`), kept in a new table, `account_status_change`, which the school
office and its auditors read (`user.invite` or `audit.read` at the account's
school) and the person never does. Enabling writes the person one notice, kind
`system`: the date and "sign in again", never the reason.
`GET /api/auth/users/:id/preview` says what disabling would cut (devices,
scoring phones, scoring tokens by fixture, duties and lifts this fortnight,
linked children as a count), refused first by the same rule as the act.

**The application can no longer write `app_user.active` itself** (Q3): its
table-level UPDATE on `app_user` is replaced by UPDATE on every other column,
so `account_set_active()` is the only door. The owner in the SQL Editor still
can (and the session epoch still bumps). **The file contains one DROP**:
`DROP FUNCTION IF EXISTS account_set_active(uuid, boolean)`, the old form
without a reason. No row is changed, no account changes state, no session
ends; an account disabled before db/90 has no reason row and reads "Disabled"
without a date. No secret, no backfill.

Paste `node tools/bundle-sql.mjs --apply 90` (after 89), then the verify bundle
(§69 is its proof, and the summary row's "Accounts change with a reason" reads
OK). **Schema first**: the API built with it calls the three-argument function
and refuses to start without db/90 (`expected-migrations.json`). Between the
paste and that API, the old API's Disable and Enable answer 500 and change
nothing; everything else works.
<!-- ── end db/90 ── -->

<!-- ── db/91: notifications S2, one stream ── -->
#### Notices: one stream (db/91)

`db/91_notification_one_stream.sql` is notifications slice S2
(`docs/design/NOTIFICATIONS.md` D9–D11). People write posts; the system writes
notices. `news_post` gains `urgency` (`low` | `medium`, default `low`: "Send to
phones too" is `medium`; never `high`). A trigger on `news_post` writes one
`notice` when a post is sent (one per school entered, for a league post),
re-syncs its words when a sent post is edited, and retracts it through
`notification_retract(…, 'withdrawn', true)` when the post is withdrawn, so its
readers are told. The application may no longer insert or edit a `notice`
itself (two RESTRICTIVE policies). `news_post_withdraw()` lets a
`news.publish.school` holder at the post's school withdraw it, not only its
author. `notification_report()` is the one-tap report: one safeguarding notice
to the school's DSOs naming nobody, and an `access_log` row
(`safeguarding.notice_report`) that only the school's DSOs read and that
refuses a second report of the same notice by the same person.

**What it does to a live database.** Adds the column (every stored post reads
`low`; no rewrite), four functions, one trigger and three RESTRICTIVE policies.
No row is inserted, changed or deleted, and **no notice is backfilled** for
posts sent before the paste: those stay in News and do not arrive in
everybody's Notices as new. Nothing in the file drops anything (no `DROP` of
any kind): the trigger is `CREATE OR REPLACE TRIGGER`, the policies are created
only when `pg_policies` lacks them, so a second paste changes nothing.

Paste `node tools/bundle-sql.mjs --apply 91` (after 89, and after 90 if that has
shipped), then the verify bundle (§70 is its proof; the summary row's "Posts
write their notices" reads OK). **Schema first**: the API built with it refuses
to start without db/91 (`expected-migrations.json`), answers
`POST /api/notifications` and `POST /api/notifications/:id/push` with 410,
takes `urgency` on `POST /api/news`, withdraws through `news_post_withdraw()`,
and serves `POST /api/notifications/:id/report`. Nothing is pushed by itself
until slice S3's worker: a `medium` post is stored as `medium` and waits.
<!-- ── end db/91 ── -->

<!-- ── db/92: the school staff register ── -->
#### The school staff register (db/92)

`db/92_staff_register.sql` is SCRBRD-140 phase 2
(`docs/design/SCRBRD-140_phase2_register.md`, decided 13 October). The office
lists its staff (`staff.csv`'s columns: `name, email, role, team_code,
valid_until`); a staff member who signs in with Google and chooses the school
is granted what was listed for the address Google verified, through the same
grant body a hand grant uses. `school_register` is a new table under RLS with
no policy and no privilege for the application: every read and write is one
of six functions (`register_upload`, `register_claim`, `register_withdraw`,
`school_register_rows`, `register_redact_due`, `register_redact`).
`decide_role_request()` is re-emitted with its grant half moved, unchanged,
into the internal `role_request_grant_as()`; it refuses to apply unless the
function in place is db/81's (its md5) and checks that the moved text is that
body with `app_user_id()` → the decider. Rows naming a child's role, a DSO, a
platform role, or any role whose bundle holds `medical.details.read`,
`discipline.read` or `safeguarding.*` are refused. Nothing runs unattended:
an unclaimed row's name and address are cleared ninety days after it expired
or was withdrawn only when someone at the school presses Clear.

**What it does to a live database.** Adds the table, its two indexes, eleven
functions, and re-emits `decide_role_request()` (its rights kept). No row is
inserted, changed or deleted. Nothing in the database is dropped; the one
temporary table the file makes for itself is dropped at its end.

Paste `node tools/bundle-sql.mjs --apply 92` (after 91), then the verify
bundle (§73 is its proof; the summary row's "Staff register is the office's"
reads OK). **Schema first**: the API built with it refuses to start without
db/92 (`expected-migrations.json`) and serves `POST`/`GET /api/register/:schoolId`,
`POST /api/register/rows/:id/withdraw`, `GET`/`POST /api/register/:schoolId/redact`
and `POST /api/join/register-claim`. No screen calls them until the register's
screens ship.
<!-- ── end db/92 ── -->

<!-- ── db/93: a declined parent claim, and the request cooldown ── -->
#### A declined parent claim tells the DSO; repeated ones pause the asker (db/93)

`db/93_declined_claim_notice.sql` is SCRBRD-140's D7 (the phase 2 design's §4;
P2-D11, P2-D12). When the office declines a request to be a child's guardian,
or declines a Google sign-in's claim on a pupil's or a parent's account, the
school's DSOs get a `safeguarding` notice naming nobody ("The office can tell
you who asked"). When a person's declined guardian requests in thirty days
reach three, or their guardian requests in thirty days span more than two
schools, `request_cooldown` pauses them for thirty days: a `BEFORE INSERT`
trigger on `role_request` refuses every request (`check_violation
request_cooldown`), whichever route inserts it, and the schools' DSOs are
told. A DSO at one of those schools lifts it (`request_cooldown_lift()`); the
office cannot, and neither can the owner's key.

**What it does to a live database.** Adds the table (RLS on, no policy, no
privilege), three triggers (`role_request_declined_notice`,
`role_request_cooldown`, `pending_claim_declined_notice`, each `CREATE OR
REPLACE TRIGGER`) and six functions. No row is inserted, changed or deleted,
and no notice is backfilled; declines from the thirty days before the paste
do count toward a cooldown set by a decline after it. Nothing is dropped.

Paste `node tools/bundle-sql.mjs --apply 93` (after 92), then the verify
bundle (§74 is its proof; the summary row's "Declined parent claims reach the
DSO" reads OK). **Schema first**: the API built with it refuses to start
without db/93, answers a request under a cooldown with `409 request_cooldown`
and words, answers signed-out `POST /api/onboard` as it always does, and
serves `POST /api/cooldowns/:id/lift`.
<!-- ── end db/93 ── -->
<!-- ── db/94: bowler_day, a boy's overs today across every match ── -->
#### A bowler's day (db/94)

`db/94_bowler_day.sql` is SCRBRD-136/137 phase B's one read
(`docs/design/SCRBRD-136-137_phaseB.md` §1, decided by Kameel on 2026-10-13).
`bowler_day(p_date, p_team)` gives, for each boy the caller may read the load
of, his overs on one date in every match he bowled in that day, how many
matches that was, and the directive's spell and day figures with their clause.
It is the read behind the coach's S2c card: "11 of 12 today, two matches (U15
directive)". The gate is `player.workload.read`, asked per boy inside the
function exactly as `workload()` asks it. A team manager, the office, a scorer,
a pupil or a guardian gets no row; the boy gets his own through self-access.
The date is the fixture's start date on the South African calendar, the date
`workload()` and the breach watch already count by. It returns no other match's
id, opponent or venue, and nothing of the load model.

**What it does to a live database.** It adds one function: `SECURITY DEFINER`,
`STABLE`, with a pinned search path, executable by `scrbrd_app` and not by
`PUBLIC`, `anon` or `authenticated`. It also takes `EXECUTE` on
`bowling_directive_for()` (db/08) away from `PUBLIC` and grants it to
`scrbrd_app` by name. Its callers are three definer functions, which run as
the owner, and the `bowling_spells` read, which runs as `scrbrd_app`, so every
caller keeps it. It adds no table, row or policy. `CREATE OR REPLACE` means a
second paste changes nothing.

Paste `node tools/bundle-sql.mjs --apply 94` (after 91, and after 92–93 if they
have shipped), then the verify bundle (§71 holds the cockpit's read fixes; §72
proves the function, reader by reader). The summary row "A bowler's day is
read under the load capability" should read OK. **Schema first**: an API built
with it refuses to start without db/94 (`expected-migrations.json`) and serves
`GET /api/read/bowler_day?date=YYYY-MM-DD&teamCode=…`. The web app reads it
only on the Coach tab, and only while our side fields.
<!-- ── end db/94 ── -->
<!-- ── db/97: the ball log follows the fixture ── -->
#### The away side reads its fixture's balls (db/97)

`db/97_ball_event_away_read.sql` is SCRBRD-136/137 away visibility
(`docs/design/SCRBRD-136-137_away_visibility.md`, approved by Kameel on
2026-10-14; AV-D1 to AV-D5). A fixture's `match` row was already readable by
either side's `fixture.read` holders, but every ball of it carries the host's
school, and `ball_event_read` (db/02) asked only the host. So at an away
fixture the visiting coach, pupils and spectators saw the fixture and none of
it: no scorecard, no spells, no wheel. `ball_event_read` now has
`match_read`'s two branches: the host's, unchanged, or `fixture.read` at the
fixture's away school and away team. Every read of the log follows (they are
`security_invoker` down to `ball_event`); every per-boy gate on top of it
still asks per boy, so the host's boys' load, records and wheels stay the
host's. The pad's tables (`scoring_session`, `ball_event_quarantine`,
`scoring_audit`) and every write stay the host's: nothing lets the away side
score. A guardian's reads are unchanged (the log asks about nobody in
particular, at either side's fixtures).

**What it does to a live database.** It drops `ball_event_read` on
`ball_event` and creates it again with the away branch, in the paste's one
transaction; the file checks the policy's text before it commits. No table,
column, row, function or grant is added or changed, and no other policy is
touched. A second paste changes nothing.

Paste `node tools/bundle-sql.mjs --apply 97` (after 94; 95 and 96 are not
needed first), then the verify bundle (§75 is its proof; the summary row "The
away side reads its fixture's balls" should read OK). **Schema first**: the
API built with it refuses to start without db/97 (`expected-migrations.json`).
The API it ships with also asks a boy's record before `player_shot_points`
draws his wheel and before `matchup_coverage` counts a named batter's balls,
so the visiting school reads a shared fixture's balls but not the host's boy
across fixtures. No screen changes.
<!-- ── end db/97 ── -->
<!-- ── db/100: a parent reads his child's side's balls ── -->
#### A parent reads the ball log of his child's side's fixtures (db/100)

`db/100_ball_event_guardian_read.sql` is Kameel's decision of 2026-10-14:
a guardian reads the balls of fixtures his child's side plays, home and away;
per-boy figures stay gated as they are. Until now `ball_event_read` asked
`fixture.read` about nobody in particular, which a guardian's assignment (it
names his children) never answers, so a parent saw his son's fixture on his
list and none of it: the family cards and the Match Centre in family mode
folded an empty log. `ball_event_read` keeps db/97's host and away branches
word for word and gains a third: the fixture is one `my_child_fixtures()`
returns, a new helper that answers the caller alone. It lists the fixtures
whose side, at either end, has on it a child the caller's own verified link
names, each asked of `app_can()` about that child. "On the side" is the
child's team at that end's school, or the fixture's team sheet
(`match_squad`, not withdrawn), so a boy playing up for an older side is
followed into that match. It never asks with the all-zeros person
`match_read` uses, which for a school-wide guardian assignment would open
every fixture at the school. Another side's fixture at the same school, and
any fixture at another school, read nothing; a link that ends reads nothing
from the next query. The per-boy gates still ask per boy: other boys' wheels,
careers and matchups join `player`, which a parent reads for his own child
only, and the load (`bowling_spells`' directive, `workload`, `bowler_day`)
asks `player.workload.read`, which a guardian does not hold. The pad's tables
and every write are unchanged.

**What it does to a live database.** It creates `my_child_fixtures()` (a
`SECURITY DEFINER` function taking no argument; `EXECUTE` revoked from
`PUBLIC` and granted to `scrbrd_app`), then drops `ball_event_read` on
`ball_event` and creates it again with the guardian branch, in the paste's
one transaction; the file checks the policy's and the helper's text and
grants before it commits. No table, column or row is added or changed, and no
other policy is touched. A second paste changes nothing. The helper runs once
per read of the log, not once per ball: on the seed, every read compared (a
coach's own match, the away coach's, a refused fixture, a career view) costs
what it did under db/97 within a few milliseconds, planning is unchanged, and
a guardian's helper call is about 5 ms (db/100's header has the figures).

Paste `node tools/bundle-sql.mjs --apply 100` (after 97), then the verify
bundle (§77 is its proof; the summary row "A parent reads his child's side's
balls" should read OK, and "The away side reads its fixture's balls" still
does). **Schema first**: the API built with it refuses to start without
db/100 (`expected-migrations.json`). No API text or screen changes: the
parent's screens already read `GET /api/matches/:id/events`.
<!-- ── end db/100 ── -->

<!-- ── db/96: the plan to the side, a team post tagged to a fixture ── -->
#### The coach's plan to the side (db/96)

`db/96_news_plan.sql` is SCRBRD-138 phase B (`docs/design/SCRBRD-138_phaseB.md`
§1–§2, decided by Kameel on 2026-10-14). The coach's plan for a match is a
`news_post` of kind `plan` with the fixture on it: written under
`news.publish.team` at the side, its one notice written by the post's trigger
with no recipient, withdrawn as any post is. `news_post` gains `kind` (`post`
or `plan`) and `fixture_id`. A trigger, `news_post_plan_guard`, refuses a plan
with no fixture or not to a team, a post with a fixture, a plan for a fixture
the side does not play in (home or away), and a sent plan's kind or fixture
changed. A partial unique index, `news_post_plan_live`, allows one live plan
per fixture per side. Two `RESTRICTIVE` policies narrow a plan, and its
notice, to the side: `news.read` and `team.read` at the side, a guardian
through a boy on it. Without them a guardian of a boy on another side, and a
follower holding `news.read` school-wide, read every side's posts. A trigger
on `news_post_public` refuses a plan on the public home page. The plan's
words are not checked here: the API checks them, with the one list in
`packages/policy/src/words.mjs`.

**What it does to a live database.** Adds two columns to `news_post` (every
stored post reads `kind = 'post'`, `fixture_id` null; no rewrite), two
triggers (`CREATE OR REPLACE TRIGGER`), four functions, three indexes
(`news_post_plan_live`, `news_post_fixture`, `notification_news_subject`) and
two `RESTRICTIVE` `SELECT` policies, each created only when `pg_policies` does
not have it. An ordinary post, and every notice that is not a plan's, reads
exactly as before. No row is inserted, changed or deleted. Nothing is dropped.

Paste `node tools/bundle-sql.mjs --apply 96` (after 94), then the verify
bundle (§76 is its proof; the summary row "A plan is one per side, to the
side" should read OK). **Schema first**: an API built with it refuses to start
without db/96 (`expected-migrations.json`). It accepts `kind: "plan"` and
`fixtureId` on `POST /api/news`, refuses a plan's refused words with `422
refused_words` (the words named) at publish and at `POST /api/news/:id/publish`,
answers a second live plan with `409 plan_exists` and who wrote the first, and
returns `kind`, `fixtureId` and `noticeId` on the `news` read. No screen
writes a plan until the composer ships (B5).
<!-- ── end db/96 ── -->

<!-- ── db/101: news to the side, a team post and the team sheet ── -->
#### News to the side: a team post, and the team sheet (db/101)

`db/101_news_to_the_side.sql` is two decisions of Kameel's (2026-10-14).
**A team post reaches the side only**: an ordinary post to a side (scope
`team`) and its notice now read as a plan does since db/96, to `news.read`
and `team.read` at the side, a guardian through a child on it, and its author
always. Before it, a guardian of a boy on another side and every school-wide
role that reads no side (a follower, finance, sponsorship, a driver,
facilities) read every side's posts and their notices. School and league
posts are unchanged. **A boy on the team sheet reads his match's plan**: a
boy named on a fixture's sheet at the plan's end (not withdrawn), and his
guardians, read that fixture's plan and its notice even when his own side is
another (a boy playing up), and nothing else of that side. A boy taken off the
sheet loses it.

**What it does to a live database.** Three functions (`news_sheet_reach`,
`news_team_notice_reach`, `news_notice_sheet`), db/96's `news_notice_reach`
replaced in place (same signature and grants), two `RESTRICTIVE` and two
permissive `SELECT` policies (`news_post_team_side`, `notification_team_side`,
`news_post_read_sheet`, `notification_read_sheet`), each created only when
`pg_policies` does not have it, and **one `ALTER POLICY`**: db/96's
`news_post_plan_side` gains the sheet (a restrictive policy would otherwise
refuse the boy playing up). Nothing is dropped. No row is inserted, changed
or deleted. Nothing grants a write. **One behaviour changes for every school
at once, on the paste:** parents and followers stop seeing other sides' team
posts and their notices in News and Notices, and stop being pushed them.
The ALTER and the policies lock `news_post` and `notification` for the
length of one statement each; paste outside a match.

Paste `node tools/bundle-sql.mjs --apply 101` (after 96, and after 97 and
100 where those have shipped), then the verify bundle (§78 is its proof; the
summary row "A team post is the side's; the sheet reads its plan" should read
OK). **Schema first**: an API built with it refuses to start without db/101
(`expected-migrations.json`). The API needs nothing new from it: the `news`
and `notifications` reads return what the database's policies let through,
so they answer the narrower set on the paste.
<!-- ── end db/101 ── -->

<!-- ── db/102: who a module was hidden from is the school's to read ── -->
#### Who a module was hidden from is the school's to read (db/102)

`db/102_suppression_read.sql` closes a leak found on 2026-10-14 before anyone
used the feature (production held no row naming a person). A school can hide
a module from one named person, with a free-text reason. Until now anybody
enrolled at any school could read those rows, and `module_suppressions` gave
them the person's name and the reason. Now a row naming a person is read only
by a holder of `school.feature.manage` at that school and by the person named.
He reads that the module is hidden from him, not why: the application no
longer selects `feature_suppression.reason`, and `feature_suppression_reason(id)`
gives the reason to the school's managers (and, for a school-wide row, to
whoever reads the row, as before). Who a module is hidden from still resolves
as before, because `feature_enabled()` and `my_feature_enabled()` read the
table as its owner. `module_settings` gives its `people_hidden` count to the
school's managers and null to everybody else.

**What it does to a live database.** Replaces the `feature_suppression_read`
policy. Refuses to run if that policy is not the one db/81 left (or this
file's own). Takes `SELECT` on `feature_suppression` from `scrbrd_app`, and
from a managed host's `anon`/`authenticated` where they hold it, and grants
it back on every column but `reason`. `INSERT` and `UPDATE` are unchanged.
Adds one function: `SECURITY DEFINER`, `STABLE`, pinned search path,
executable by `scrbrd_app` and not `PUBLIC`. No table, no row. A second paste
changes nothing.

Paste `node tools/bundle-sql.mjs --apply 102` (after 94, and after 96–101 if
they have shipped; the bundle names the one it needs first), then the verify
bundle (§79 is its proof). The summary row "Who a module is hidden from is
the school's" should read OK. **Schema first**: the API built with it refuses
to start without db/102 (`expected-migrations.json`), and its
`module_suppressions` read calls `feature_suppression_reason()`, which an older
database does not have.
<!-- ── end db/102 ── -->

<!-- ── db/103: the plan's byline, who wrote the side's plan ── -->
#### The plan names its author (db/103)

`db/103_plan_author_name.sql` closes a gap in SCRBRD-138 phase B. The design
draws "Plan from Mr Dlamini · Thu", and CSA SG-9 says a pupil always knows which
adult wrote to his side. But the `news` read took the author's name from
`app_user`, which a pupil and a parent cannot read (they hold no `user.read`),
so for them the plan said "The plan · Thu". `plan_author_name(post)` gives the
author's display name for one post, and only when that post is a plan, live
(sent, not withdrawn, not dated in the future) and one the caller already
reads. It asks what `news_post`'s read policies ask: db/12's, db/96's
narrowing to the side, and db/101's team sheet. It calls db/96's
`news_plan_reach()` and db/101's `news_sheet_reach()` rather than copying
them, so a boy playing up on the fixture's sheet, and his guardian, read the
name too. It returns
only the name. A draft, a withdrawn plan, another side's plan, an ordinary
post, a post that is not there, and an anonymous caller all get null. Ordinary
posts are unchanged: whether a post's author is named to pupils and parents is
not decided.

**What it does to a live database.** It adds one function: `SECURITY DEFINER`,
`STABLE`, with a pinned search path, executable by `scrbrd_app` and not by
`PUBLIC`, `anon` or `authenticated`. It adds no table, column, row or policy.
`CREATE OR REPLACE` means a second paste changes nothing. The file checks
itself and refuses to commit if the function is not what it says.

Paste `node tools/bundle-sql.mjs --apply 103` after 101 (it calls db/101's
`news_sheet_reach()` and refuses to commit without it), and after 100 and 102
if they ship with it, then the verify bundle (§80 is its proof). The summary row "A plan names its author to the
side" should read OK. **Schema first**: an API built with it refuses to start
without db/103 (`expected-migrations.json`). Its `news` read names a live
plan's author to the plan's readers and takes `fixtureId`, which narrows the
read to one fixture's posts. The fixture screen, the captain's card, the
Captain tab and the coach's tab read with it, so a plan stays findable when
more than 100 newer posts sit above it.
<!-- ── end db/103 ── -->

<!-- ── db/104: corrections to a coach's judgement, and the coaching point ── -->
#### Corrections to a coach's judgement, and the coaching point (db/104)

`db/104_assessment_corrections.sql` is GA-I26a slice A1 (Kameel, 15 Oct:
AH-D2, AH-D3, AH-D5 as recommended). **A score keeps its assessor.** Before
it, a colleague who rated a boy on the same day as his coach overwrote the
number and took the authorship. Now a coach corrects his own score that day,
as before; anybody else's same-day upsert is refused (`403 not_the_assessor`)
and he rates on his own row. **A wrong score or note is withdrawn, not
deleted**: it stays, struck, with who withdrew it and why, and every screen
that reads the standing score (Skills, the ratings, the focus areas, the
rewards score) stops counting it. **A coaching point is a development note
with its evidence pointer**, read only by the note's readers (coach,
assistant, director, principal) and never by the boy, his parents or a
platform-wide account.

**What it does to a live database.** Three nullable columns on
`player_skill` and nine on `development_note` (no rewrite). `player_skill`'s
unique key on (player, day, category, metric) becomes a partial unique index
over standing rows (`player_skill_standing`), so a withdrawn score does not
hold its slot. One new trigger (`player_skill_keeps_its_assessor`), one
trigger function replaced in place (`development_note_author()`, same
trigger), four `RESTRICTIVE` policies (`player_skill_not_support`,
`development_note_not_support`, `development_note_not_platform`,
`development_note_plain_insert`), and four functions: `coaching_point_write`,
`skill_withdraw`, `note_withdraw` (`SECURITY DEFINER`, pinned search path,
executable by `scrbrd_app` alone) and the internal `coaching_point_never`.
No row is inserted, changed or deleted. **One behaviour changes for every
school at once, on the paste:** the owner's key (a platform-wide assignment)
and a support session stop reading development notes, and a support session
stops reading skill ratings. Each statement locks `player_skill` or
`development_note` briefly; paste outside a coaching session. A second paste
changes nothing.

Paste `node tools/bundle-sql.mjs --apply 104` (after 102, and after 103 where
it has shipped), then the verify bundle (§81 is its proof). The summary row
"A score keeps its assessor; a point is a note" should read OK. **Schema
first**: the API built with it refuses to start without db/104
(`expected-migrations.json`); its assessment upsert names the partial index
(`ON CONFLICT … WHERE withdrawn_at IS NULL`), which an older database does
not have.
<!-- ── end db/104 ── -->

<!-- ── db/105: the development loop — a target, the side's plan, the register ── -->
#### The development loop: a target, the side's plan, the register (db/105)

`db/105_development_loop.sql` is GA-I26a slice A2 (Kameel, 15 Oct: AH-D1,
AH-D3, AH-D6, AH-D9 as recommended). **A coach sets a target** on one
attribute of one boy (a number above where he stands, a date, the drill for
it, and the reasoning as a staff-only note). The boy reads his own targets;
his parents, the principal, the team manager and a team-mate do not. Whether
he reached it is read off his scores, never stored. **A session's plan is
keyed to the drill library** and read by the side, parents included, as the
session is; it names no boy. **The register gets its route**, which never
writes `injured`: that is a health word on a list the side reads, and an old
`injured` row now reads as `excused`. **The team manager runs the session**
(Kameel, 15 Oct): a new capability, `team.training.run`, lets him set a
session's plan and take its register at his own side, and nothing else. He is
still refused the drill library, the kit register and scheduling, which stay
under `team.manage`. Every role that holds `team.manage` holds the new one
too, so nobody loses a write. The assistant coach holds neither.

**What it does to a live database.** Two new empty tables
(`development_target`, `training_session_drill`) under row security: the
first with one read policy, a `RESTRICTIVE` support cut and no write policy
or write privilege at all (its doors are `target_set` and `target_withdraw`,
`SECURITY DEFINER`, pinned search path, `scrbrd_app` alone); the second with
four policies (read under `team.read`, written under `team.training.run`)
and a trigger refusing another school's drill. One capability row and six
`role_capability` rows (`team.training.run`: coach, director of sport, school
admin, sports admin, the owner's key, the team manager).
`training_attendance`'s two write policies are re-created under
`team.training.run` with the same anchors (its read is unchanged), and two
`RESTRICTIVE` policies refuse `injured` from the application's role. No existing row is changed. Refuses to run before db/104.
A second paste changes nothing.

**Behaviour the paste and the deploy change.** The Training screen's
navigation is gated by `team.read` (it was `player.development.read`), so
parents, pupils, the team manager and the analyst find it; what they see in
it is what row security already gave them. The CSV export
(`GET /api/export/:resource`) now refuses `skills`, `ratings`, `notes` and
the new development reads with `403 not_exported`; it served the first three
before.

Paste `node tools/bundle-sql.mjs --apply 105` (after 104), then the verify
bundle (§82 is its proof). The summary row "A target is the coach's; the plan
is the side's" should read OK. **Schema first**: the API built with it refuses
to start without db/105 (`expected-migrations.json`); its `targets`,
`training_plan` and `development_since` reads name the new tables.
<!-- ── end db/105 ── -->

<!-- ── db/106: a family reads its side's fixtures, trips and training ── -->
#### A family reads its side's fixtures, trips and training (db/106)

`db/106_reach_side.sql` is REACH group R-A (`docs/design/REACH_parent_pupil.md`
§6.1), Kameel's decision of 2026-10-14 (REACH-D1, "the side only"). Until now
every guardian read every fixture, every trip (with its driver, its pickup and
notes that may name a child) and every training session at her school, and
the browser filtered the list down to her child's side. Now a guardian reads
her child's side's fixtures home and away, the one fixture he is on the team
sheet of when he plays up, their buses at the bus's own school, and their
training; nothing of another side at her school or any other. A pupil reads
his side's, as before, and (Kameel, 15 Oct) a boy playing up reads the one
fixture whose team sheet names him, its toss, umpires and weather, and its
bus, as his guardian does; nothing else of the older side, not its nets, and
nothing of a fixture he was taken off. Nothing is added to a pupil's
self-access. Staff, a school-wide follower, the office and a driver
read what they read. The away side's family and staff now also read the toss,
the umpires, the pitch report, the weather, the playing conditions and the
broadcast setting of their side's away fixture, which were the host's alone.
A link that is pending, ended or revoked reads nothing of the child's side.

**What it does to a live database.** Eight functions (`SECURITY DEFINER`,
`STABLE`, pinned search path; `EXECUTE` revoked from `PUBLIC` and granted to
`scrbrd_app`, and from a managed host's `anon`/`authenticated` where they
exist): the rule, one row at a time (`side_reach`, `fixture_end_reach`,
`fixture_reach`), and the same rule asked once per statement, which is what
the policies call (`my_fixture_ends`, `my_sides`, `my_own_boy` for "the
reader is the boy on the sheet", and the away anchors
`match_away_school`/`match_away_team` beside db/02's home ones). db/41's
`trip_fixture_driver_only()` is replaced in place (same signature and grants:
"a driver who reaches the fixture only as its driver" now asks match_read's
new question). Thirteen read policies are dropped and created again
(`match_read`, `trip_read`, `training_session_read`,
`fixture_publication_read`, `match_result_decision_read` and the eight
satellites' `*_read`), in the paste's one transaction. A trip is read at its
own school's end, and only by someone who reads its fixture, as before. The
file checks every policy's text and the helpers' grants before it commits.
No table, column, row or write policy is touched. A second paste changes
nothing. **One behaviour changes for every school at once, on the paste:**
parents stop seeing other sides' fixtures, buses and nets; paste outside a
match. Cost, on a forty-fixture season: a coach's or the director's fixture
list as before (8–11 ms); a parent of two 34 ms for her list and 100 ms for
her buses, where it was 9 and 47 (db/106's header has the figures).

Paste `node tools/bundle-sql.mjs --apply 106` (after 102, and after 103–105 if
they have shipped; the bundle names the one it needs first), then the verify
bundle (§83 is its proof; the summary row "A family reads its side's fixtures"
should read OK). **Schema first**: the API built with it refuses to start
without db/106 (`expected-migrations.json`), and its `matches` read asks
`my_fixture_ends()` which end the reader is at.
<!-- ── end db/106 ── -->

<!-- ── db/107: the officials register and the grant notes, closed ── -->
#### The officials register is its keeper's; a school's plan is its own (db/107)

`db/107_official_register_closed.sql` is REACH-D5 and the grant-note decision
(Kameel, 14 October 2026). **The officials register** held an umpire's or a
scorer's date of birth, ID number, email and phone, and every enrolled person
at every school, pupils and parents included, could read the table raw; the
API was safe only because one route read a masked view. Now the table is read
by the body that keeps it (`officiating.registry.manage`, platform-wide) and
by an official reading his own row, and by nobody else. Everybody who needs a
name and a grade, to appoint an umpire or to read the register screen, reads
`official_panel()`, which names its columns (name, panel, standing, grade,
how many accreditations, whether he has an account) and never returns a date
of birth, an ID number, an address or a phone. **A school's plan**
(`feature_grant`, with the platform's free-text note) was readable by anybody
enrolled anywhere, so `module_settings` gave one school's note to another's
parents. Now a school's own people and the platform read its rows, nobody
else; which modules are on still resolves for everyone exactly as before.

**What it does to a live database.** Replaces three read policies
(`official_read`, `official_accreditation_read`, `feature_grant_read`); refuses
to run if any is not what db/81 left (or this file's own). Adds three
functions (`app_enrolled_at`, `official_panel`, `official_conflict`): `SECURITY
DEFINER`, `STABLE`, pinned search path, executable by `scrbrd_app` and not
`PUBLIC`. No table, column, row or table grant changes; a second paste changes
nothing. **One behaviour changes on the paste:** a school's coach, director of
sport or principal who opens the officials screen still sees the panel and
its grades, and no longer receives a date of birth or contact for anybody
(they already arrived empty through the API); a parent or pupil asking the
modules read about another school gets no grant row.

Paste `node tools/bundle-sql.mjs --apply 107` (after 102, and after 103–106
where those have shipped; the bundle names the one it needs first), then the
verify bundle (§84 is its proof). The summary row "The officials register is
its keeper's" should read OK. **Schema first**: the API built with it reads
`official_panel()` and `official_conflict()` and refuses to start without
db/107 (`expected-migrations.json`).
<!-- ── end db/107 ── -->

<!-- ── db/108: a pupil is a pupil of a side ── -->
#### A pupil is a pupil of a side (db/108)

`db/108_player_team_scoped.sql` is REACH-D4 (Kameel, 14 October 2026: "player
becomes team-scoped (a CHECK, like coach). Yes."). A pupil's `player` role
with no team reached every side at his school: every sheet, post and bus
list. A new CHECK, `role_assignment_player_team_scoped`, makes a live `player`
role name a side, as db/01's has always made a coach's; and the one door
every grant passes (`role_request_grant_as()`) takes a pupil's side from the
roster when nobody named one, or refuses by name (`team_required`).

**FIRST, with Kameel's yes: `tools/sql/fix-player-without-team.sql`.** On 14
October production and the demo database each held exactly one live `player`
role with no team: the seeded test account `spectator@example.invalid`, not a
pupil. db/108 refuses to run while one exists ("Nothing was changed"), and it
does not change live data itself. The fix file ends that one role
(`active = false`; the row, its dates and its provenance stay, and the account
can be given the role again with a side). It ends only the account it names,
and stops without changing anything if it finds a team-less `player` role on
any other account, or on an account linked to a pupil on the roster: a pupil
is given a side by the office, not ended. Paste it in the SQL Editor, read its
notice ("ended 1 team-less player role(s)…") and the empty result under it,
then paste db/108. On a rebuilt database (the seed now puts that account on
the 1st XI) the fix file finds nothing and says so.

**What db/108 does to a live database.** Adds one CHECK constraint
(`NOT VALID`, then `VALIDATE`, under a lock with a ten-second `lock_timeout`;
ended roles are exempt, since an ended role reaches nothing and is never
reactivated). Re-emits `role_request_grant_as()` (db/92) with one block,
md5-guarded; same signature, rights and settings. No row is inserted, changed
or deleted; a second paste changes nothing. Paste outside a busy hour: the
lock is held for the length of one table scan of `role_assignment`.

Paste `tools/sql/fix-player-without-team.sql` (with Kameel's yes), then `node
tools/bundle-sql.mjs --apply 108` (after 107), then the verify bundle (§85 is
its proof). The summary row "A pupil is a pupil of a side" should read OK. The
API needs nothing new from it: a refusal comes back as `team_required`, which
the request, enrolment and register routes already answer in words.
<!-- ── end db/108 ── -->

<!-- ── db/109: account lifecycle slice 3, a child's links ── -->
#### A child's links, and the reason for an ending (account lifecycle slice 3, db/109)

`db/109_guardian_link_ending.sql` is slice 3 of `docs/design/ACCOUNT_LIFECYCLE.md`
(§4; D11–D14, Q8, Q10, Q13). Every ending of a guardian link is now recorded in
a new table, `guardian_link_ending`, with a kind and, when a person ended it,
the reason: the office revoking one (`custody`, `family_left`, `guardian_asked`,
`office`, with a reason of ten characters or more), a guardian role ended
(`role_ended`, the role's reason), or the boy leaving school (`majority` when
his parents keep the link until his birthday, `left_school` when he left as an
adult; no reason, no actor). The office and its auditors read it; the guardian
never does, and the DSO reads only the kind and the date, inside an open
concern. **Nobody reads it platform-wide** (Kameel, 15 October 2026): the
platform administrator and the owner's key read a child's links and the ending
reasons only inside a live support session at that school (db/22), as the role
the session lent them, and the read is logged under the session. The same
holds for ending one: a platform-wide caller is refused `not_permitted` by
`guardian_link_revoke()` unless a support session is live at that school. The guardian is told in one notice: "Your link to a child at {school}
ended on {date}. The school office can say why; the platform does not." Never
the child's name, never the reason. What a revoked link takes with it is the
existing rules', unchanged: his name off public pages until another guardian
answers (db/47), the health consent through it (db/60), her lift seats (db/70).

New routes: `POST /api/players/:id/guardians/:link/revoke { kind, reason }`, and
the office's read `GET /api/read/child_links?playerId=…` (every link of a child,
in every state; `user.role.assign` or `guardian.link.manage` at the school,
never platform-wide outside a support session there; every read logged). The old `POST /api/players/:id/guardians/revoke
{ guardianId, note }` still works, now through the new door (kind `office`
unless one is sent; the note is the reason, so it needs ten characters).
Squad → a pupil → Edit Profile gains a Family links panel.

**What it does to a live database.** Adds the table, its indexes, its read
policy and a RESTRICTIVE one (`guardian_link_ending_not_platform`), three functions (`guardian_link_revoke(uuid, text, text)`,
`guardian_link_ending_notice_is_mine(uuid)`, the trigger function
`role_assignment_ending_links()`), one trigger on `role_assignment_ending`, and
a notification read policy (`notification_link_ended`). Re-emits db/62's
`guardian_links_close_on_leaving()` and `guardian_links_reopen_at_school()` and
db/57's `safeguarding_family()`, each md5-guarded against the body in place.
**Takes EXECUTE on db/08's `guardian_link_revoke(uuid, uuid, text)`** from
`PUBLIC`, the application and a managed host's API roles: the function stays
(nothing is dropped), but only the owner can call it. No row is inserted,
changed or deleted; links revoked or dated out before the paste have no ending
row and read "no reason recorded". A second paste changes nothing.

Paste `node tools/bundle-sql.mjs --apply 109` (after 103, and after 104–108 if
they have shipped; the bundle names the one it needs first), then the verify
bundle (§86 is its proof; the summary row "A link's ending is the office's to
read" should read OK). **Schema first**: the API built with it refuses to start
without db/109 (`expected-migrations.json`). Between the paste and that API,
the old API's revoke answers "not permitted" and changes nothing; everything
else works.
<!-- ── end db/109 ── -->

<!-- ── db/110: the coach's draft plan, changed and thrown away ── -->
#### A draft plan is its author's to change or delete (db/110)

`db/110_plan_drafts.sql` puts Kameel's decision of 15 Oct 2026 into the
database:
- A plan that was never sent can be changed and deleted by its author.
- A withdrawn plan can be changed and sent again, but never deleted.
- A plan out with the side is not changed in place; it is withdrawn first.

Withdrawing a plan makes it its author's draft again, so `news_post` gains
`first_sent_at`, the date a plan was first sent. The trigger stamps it, it is
never taken from the caller, and it is never cleared. Existing plans are
dated from `published_at`, or, for a plan already withdrawn, from its first
notice. The trigger `news_post_plan_drafts` refuses two things:
- A change to a live plan's words or urgency (`news_post_plan_sent`).
- A change to a plan by anybody but its author (`news_post_plan_author`),
  whichever door the change comes through.

`news_plan_discard(post)` is the only way a plan is deleted: by its author,
and only for a plan never sent. The application still holds no `DELETE` on
`news_post`. A withdrawn plan's first sending stays in its retracted notice
(db/91), and sending it again writes a new notice, so both versions are kept.

**What it does to a live database.**
- Adds one column, with no table rewrite.
- Dates the existing plans: it updates `first_sent_at` alone, which no notice
  trigger reads.
- Adds one trigger (`CREATE OR REPLACE TRIGGER`) and two `SECURITY DEFINER`
  functions with a pinned search path. `news_plan_discard` is executable by
  `scrbrd_app` only; the trigger's function by nobody.
- Changes no policy or grant, and writes or changes no notice. Nothing is
  dropped. A second paste changes nothing.

Paste `node tools/bundle-sql.mjs --apply 110` after 103 (and after 104–109
if they ship with it), then the verify bundle (§87 is its proof). The summary
row "A draft plan is its author's to change or throw away" should read OK.

**Schema first.** An API built with it refuses to start without db/110
(`expected-migrations.json`). It serves `POST /api/news/:id/edit` and
`POST /api/news/:id/delete`, and its `news` read returns `wasSent` and
`urgency`. The coach's tab offers the following on his unsent plan:
- **Change it** on any unsent plan.
- **Delete**, asked once, on a plan never sent.
- **Send again** on a withdrawn plan.
<!-- ── end db/110 ── -->

<!-- ── db/111: the physio's injury record, its reviews and her worklist ── -->
#### The physio records and reviews an injury (db/111)

`db/111_injury_review.sql` is GA-I19 slice A, with slice C's SG-12 injury half
(`docs/design/GA-I19_medical_review.md`, decided 8 Oct; Q0 and Q2 confirmed
15 Oct). Until now a physio could read every injury at her school and write
none of them. Now she records an injury through `injury_record()` and reviews
it through `injury_review_record()`. Each review is a dated `injury_review`
row with the state it left the injury in (phase, restriction, return date,
next review, note). A trigger applies it to the `injury` row, and
`notify_injury()` sends its notices exactly as before. A trigger also derives
`player.fitness`. `injury_worklist()` is her list of reviews due, and nobody
without `medical.write` gets a row of it. A severe injury, or one where
emergency services were called, sends the school's DSOs one safeguarding
notice that names no child and no diagnosis, once per injury. The legal basis
is the guardian-link consent (the information officer, Q2), so nothing here
asks for health-monitoring consent.

**What it does to a live database.** `injury` gains five nullable or
defaulted columns (`recorded_by`, `emergency_services`, `next_review_on`,
`recurs_injury_id`, `dso_notified_at`) and a unique key on
`(id, player_id, school_id)`. No stored row is rewritten. `injury_masked` is
rebuilt with db/09's five masks and four new ones. `injury_review` is
created behind RLS, with the generated policies, a masked view, a RESTRICTIVE
cut that hides it from support sessions, and the pad guard. The application
**loses INSERT, UPDATE, DELETE and TRUNCATE on `injury`** and on
`injury_review`, so the two functions are the only writers. Nothing in the API
wrote `injury` before; the seed and the walks write it as the owner. The new
functions are `SECURITY DEFINER` with a pinned path, except the worklist,
which runs as the caller. The application may call the two doors, the
worklist and the family check, and `PUBLIC`, `anon` and `authenticated` may
call none of them. No capability is added. Existing rows that were already
severe send no notice. The file checks itself and refuses to commit if
anything above is not so. Running it a second time changes nothing.

Paste `node tools/bundle-sql.mjs --apply 111` after 103 (it needs db/57's
safeguarding notice policies, db/60's `still_at_school()` and db/89's
notification contract, all long shipped), then the verify bundle (§88 is its
proof). The summary row "The physio records and reviews an injury" should
read OK. **Schema first**: an API built with it refuses to start without
db/111 (`expected-migrations.json`). Its new routes are `POST /api/injuries`
and `POST /api/injuries/:id/reviews`, and its new reads are `injury_reviews`
and `injury_worklist`, all behind the Injuries module. The `injuries` read
also returns the new columns, masked by tier.
<!-- ── end db/111 ── -->

### 5 · Cloud Run, the first time

```sh
gcloud run deploy scrbrd-api --source . --region africa-south1 \
  --add-cloudsql-instances scrbrd-os:africa-south1:<instance> \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,SESSION_SECRET=SESSION_SECRET:latest,WEB_ORIGIN=WEB_ORIGIN:latest \
  --allow-unauthenticated --min-instances 0 --max-instances 4
```

`--allow-unauthenticated` is the HTTP surface; authorization is the bearer
token and the database's policies, on every request. The secrets and the SQL
attachment stay on the service across later deploys, which is why the
workflow does not repeat them.

Check it:

```sh
curl https://<service url>/api/health          # {"ok":true,"db":"ok",...}
curl -X POST https://<service url>/api/auth/dev-login   # refused: NODE_ENV=production
```

### 5b · The client, by hand

```sh
VITE_API_BASE="" pnpm build      # empty base: same-origin, Hosting rewrites /api/**
firebase login --no-localhost    # in Cloud Shell; a browser prompt otherwise
firebase deploy --only hosting --project scrbrd-os
```

It prints the live URL. Open it, sign in as the platform administrator from
step 3, and the pilot is running. **At this point you are deployed** — sections
6 and onward are automation, not requirements.

### 6 · LATER: the two deploy identities, so GitHub can deploy for you

Only needed when you want a push to `main` to deploy on its own. Skip this
entirely until the manual deploy above has worked at least once.

Two identities, both created by you. Neither is a Google-managed service
agent.

**Which account is NOT this.** A project has service agents Google creates
and owns, with addresses like
`service-<project number>@gs-project-accounts.iam.gserviceaccount.com` —
that one is the Cloud Storage agent, and it appears on its own the first time
a `--source` deploy stages a build. No key can be downloaded for it and it is
nobody's deploy identity. If one of these turns up in a console listing or an
error, it is Google's plumbing working, not a credential to configure.

The project NUMBER is a different thing and is genuinely needed below, for
the workload identity principal. Confirm it rather than trusting a number
copied from somewhere:

```sh
gcloud config set project scrbrd-os
PROJECT_NUMBER=$(gcloud projects describe scrbrd-os --format='value(projectNumber)')
echo "$PROJECT_NUMBER"          # expected: 705280257618
```

**Hosting.** The Firebase CLI does the whole exchange — it creates the
account, generates the key, and writes the GitHub secret itself:

```sh
firebase login
firebase init hosting:github        # repository: iamkameel/SCRBRD_OS
```

Decline the build script and decline overwriting the workflow: `firebase.json`
and `.github/workflows/deploy.yml` are already here and are the ones we want.
It leaves `FIREBASE_SERVICE_ACCOUNT_SCRBRD_OS` set.

**Cloud Run.** Workload identity rather than a key file, so there is no JSON
secret to leak or rotate:

```sh
gcloud iam service-accounts create scrbrd-deploy --display-name="SCRBRD deploy"

# run.admin to deploy; cloudbuild + artifactregistry + storage because
# `--source` builds the image in the project rather than pushing one;
# serviceAccountUser to act as the service's own runtime identity.
for R in roles/run.admin roles/cloudbuild.builds.editor \
         roles/artifactregistry.writer roles/storage.admin \
         roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding scrbrd-os \
    --member="serviceAccount:scrbrd-deploy@scrbrd-os.iam.gserviceaccount.com" --role="$R"
done

gcloud iam workload-identity-pools create github --location=global

# The attribute condition is the security boundary: a token minted for any
# other repository cannot assume this account, however it was obtained.
gcloud iam workload-identity-pools providers create-oidc github \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='iamkameel/SCRBRD_OS'"

gcloud iam service-accounts add-iam-policy-binding \
  scrbrd-deploy@scrbrd-os.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/iamkameel/SCRBRD_OS"
```

**The secrets**, under Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_SCRBRD_OS` | written by `firebase init hosting:github` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `scrbrd-deploy@scrbrd-os.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/<project number>/locations/global/workloadIdentityPools/github/providers/github` |
| `VITE_FCM_VAPID_KEY` | optional; the public half of the web-push pair |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` | not needed in production. Continue with Google (SCRBRD-140) uses scrbrd-os's public web config (`apps/web/src/lib/firebaseProject.js`), the project the server pins tokens to. Set all three only to point a build at another project, as the walks' build does. Google must be enabled as a sign-in provider in the Firebase console |

Until they exist the deploy jobs build and then say so in a notice, rather
than fail. **The moment they exist, the next push to main deploys for real** —
so add them after steps 1 to 5, never before. An API deployed ahead of its
database is a service that refuses to start, which is the guard working and
still a bad first impression of the platform.

## Every deploy after that

Push to `main`. The workflow deploys the API from the Dockerfile, then builds
the client with an empty API base, checks that nothing confidential reaches
the bundle, and deploys it to Hosting. It never touches the database — and an
API whose migrations the database does not have yet refuses to start, so that
deploy fails and the client waits with it ("The API refuses to run ahead of
its schema", below).

To try the image locally, against the development database:

```sh
docker build -t scrbrd-api .
docker run --rm --network host -e NODE_ENV=production \
  -e SESSION_SECRET=try -e DATABASE_URL=postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd scrbrd-api
```

## Changing the schema after go-live

**A production change is a new `db/NN_*.sql` file. Nothing else.** Not an
edit to a file that has already run, not a regenerated `db/01`, not a rebuild.
This is the rule the ledger enforces, and it is worth knowing why before the
migrator refuses something.

### Three guards, and what each one means for a change

1. **The ledger.** `schema_migration` records every file applied with its
   hash. `tools/migrate.mjs` skips a file whose hash is unchanged and
   **refuses** one whose hash changed — the file is what production ran, and
   a different file with the same name is not a migration, it is a story
   about one. `bundle-sql.mjs --apply NN` refuses to run twice and refuses to
   run ahead of its predecessor, for the same reason.

2. **The generator.** `db/01_authz.sql` and `db/09_rls_policies.sql` are
   written by `pnpm rls:generate` from `packages/policy`, and CI fails if
   regenerating changes either byte. Once they have run on production they
   are frozen like everything else — so a change to a role's capability
   bundle is **not** "edit `roles.mjs` and regenerate". That rewrites `db/01`,
   which production has already applied, and the ledger refuses it. The
   change is three things: `roles.mjs` (the truth for a fresh install and for
   the client), a `db/NN` with the `DELETE`/`INSERT` on `role_capability` for
   a database that already has `db/01`, and an entry in `WITHDRAWN_SINCE_01`
   in `services/api/rls/generate-rls.mjs` so the generator keeps emitting the
   frozen file exactly as shipped. `db/21_coach_medical_overview.sql` is the
   worked example. A **new role** goes in `ROLES_ADDED_SINCE_01`, which
   keeps it out of `db/01` altogether; `db/27_sponsorship_role.sql` is that
   example. A **new** capability is the mirror image: an entry in
   `ADDED_SINCE_01` keeps it out of the emitted `db/01` altogether, and the
   `db/NN` it names inserts the catalogue row, the grants and whatever policy
   it was introduced for — `db/24_amend_request.sql` is that example, and
   `rls.test.mjs` checks the file carries a row for every holder in
   `roles.mjs`. The same shape corrects anything else a generated file got
   wrong: `db/10` corrects `db/08` without touching it.

3. **The verifier.** `db/99_rls_verify.sql` is not schema and is never
   ledgered, so it changes freely — every guarantee a new file adds gets a
   section there, and the verify bundle runs the whole file against
   production after each paste.

### The procedure

1. Write `db/NN_*.sql`, the next number after the highest in `db/`, and add
   its name to `services/api/expected-migrations.json` (the suite fails
   until you do). Forward only. `IF NOT EXISTS` and `CREATE OR REPLACE` where they are honest;
   `SET search_path = pg_catalog, public, pg_temp` on every `SECURITY DEFINER`
   function (`db/16` is why). Explain the change in the file's header — that
   comment is what the next person reads in the SQL Editor.
2. Prove it locally against a rebuilt database, with its assertion in place:
   ```sh
   node tools/migrate.mjs --reset --seed && node tools/migrate.mjs --verify
   ```
   Then break the guard and watch the assertion go red for the right reason
   before trusting it.
3. Generate the paste and apply it to production, in the SQL Editor:
   ```sh
   node tools/bundle-sql.mjs --apply NN     # → scrbrd-supabase-apply-NN.sql
   node tools/bundle-sql.mjs                # → scrbrd-supabase-verify.sql (and the rebuild bundle, which you do not paste)
   ```
   Paste `apply-NN`, then `verify`. Expect `ALL RLS LIVE ASSERTIONS PASSED`.
   Then record it as shipped, so the suite refuses any later edit to it:
   ```sh
   sha256sum db/NN_*.sql >> db/SHIPPED.sha256
   ```
4. **Only then** deploy or merge the code that needs it. Schema first, always.
   An API that calls a function the database does not have yet is a `42883`
   on every screen that touches it — a read path that started calling
   `app_is_platform_wide()` before `db/20` had been pasted did exactly that.

### The API refuses to run ahead of its schema

Step 4 used to be a sentence. On 2026-09-23 production was found serving the
code from PRs #30 and #31 against a database still at `db/23` — `db/24` to
`db/27` had never been pasted, and nothing said so. Now, at boot and before it
listens, `services/api/server.mjs` compares the migrations it was built
against (`services/api/expected-migrations.json` — the image carries no `db/`)
with the database's ledger, read through `schema_migrations_applied()`
(`db/29`), and exits if any is missing:

```
Refusing to start: the database is missing 4 migration(s) this code was built against.
  missing:  24_amend_request.sql
  ...
Fix: apply scrbrd-supabase-apply-NN.sql for each, in this order (DEPLOYING.md,
"The procedure"):
    node tools/bundle-sql.mjs --apply 24   → scrbrd-supabase-apply-24.sql  (24_amend_request.sql)
  ...
```

A revision that does not start never takes traffic on Cloud Run or Render, so
the previous one keeps serving; the deploy workflow runs the client only after
the API succeeds, so the client does not go out ahead either. **The fix is
always the schema**: paste each named `apply-NN` in order, `verify`, then
redeploy (re-run the workflow, or push again). A database that is *ahead* of
the code — a file pasted before the code that needs it merged — is the normal
order and starts fine. A database with no `db/29` cannot report what it has, so
the server refuses and says to look (`SELECT name FROM schema_migration`).

There is no switch to skip this. A development database that is behind takes
`node tools/migrate.mjs`, the same as any other.

**`db/29` itself is in the list.** The first deploy of this guard needs
`apply-29` pasted first — which is the rule, applied to the file that enforces it.

### When production is behind by more than one file

The apply bundles are one file each, and each refuses to run ahead of its
predecessor, so the wrong order fails loudly instead of leaving a gap. Find
out where production is:

```sql
SELECT name FROM schema_migration ORDER BY name;
```

then paste `apply-NN` for each missing number, in order, and `verify` once at
the end. Production was once found frozen at `db/14` while the branch had
reached `db/19` — five pastes, one verify, and the recovery page that had
been failing with `42883` worked.

### What never happens to a database holding a real record

- Editing any `db/NN` file already in its ledger. Hand-editing `db/01` or
  `db/09` counts: the generator overwrites them and CI diffs them.
- `--reset` or `--reset-objects`. Both are the demonstration path and both
  destroy everything. The demonstration instance stops being exempt the day
  it carries the ledger and the owner's real key — from then on it, too,
  takes `apply-NN`.
- Pasting a migration by hand without its ledger row. The next `apply` sees
  the predecessor missing and refuses; the next `migrate.mjs` tries to apply
  it again and fails on the first `CREATE`.

## What is not here

- **Email or SMS.** Login codes are handed over by a person; see
  `services/api/auth/auth-db.mjs` for why that is the design and not a gap.
- **Push delivery.** Without `FCM_*` on the service the fan-out route answers
  503 and writes no delivery log. Turn it on when the credentials exist.
- **Backups and retention.** Production is Supabase. What Supabase keeps
  depends on the plan, and on Free it may be nothing you can restore; the
  backup that counts is the one you take and prove yourself:
  [docs/pilot/BACKUP_RESTORE.md](docs/pilot/BACKUP_RESTORE.md) (the dump, where
  it may live, the restore drill with `tools/backup-verify.mjs`, and when a
  restore into production is and is not the answer). A retention rule for a
  churned school is still an open POPIA decision noted in `db/00_schema_core.sql`.
