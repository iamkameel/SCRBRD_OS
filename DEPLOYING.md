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
`public` — every table, view, routine and enum this repository's migrations
made — and leaves the schema, its grants, and anything belonging to an
extension exactly as they were. The ledger goes with it, so the next run
applies every migration from the beginning:

```sh
DATABASE_URL='<owner connection string>' node tools/migrate.mjs --reset-objects --seed
```

That is the DEMONSTRATION path, and only the demonstration path: it destroys
everything in the database and reseeds it with invented people. Against a
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

### 4 · Secrets

In Secret Manager, on the project:

| Secret | Value |
|---|---|
| `DATABASE_URL` | `postgres://scrbrd_app:<app secret>@/scrbrd?host=/cloudsql/scrbrd-os:africa-south1:<instance>` |
| `SESSION_SECRET` | 32+ random bytes; the API refuses to start without it outside development |
| `WEB_ORIGIN` | `https://scrbrd-os.web.app` (or the custom domain) |
| `ANTHROPIC_API_KEY` | optional; without it Stats-Magic and commentary answer null |

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

Until they exist the deploy jobs build and then say so in a notice, rather
than fail. **The moment they exist, the next push to main deploys for real** —
so add them after steps 1 to 5, never before. An API deployed ahead of its
database is a service that refuses to start, which is the guard working and
still a bad first impression of the platform.

## Every deploy after that

Push to `main`. The workflow builds the client with an empty API base, checks
that nothing confidential reaches the bundle, deploys it to Hosting, and
deploys the API from the Dockerfile. It never touches the database.

To try the image locally, against the development database:

```sh
docker build -t scrbrd-api .
docker run --rm --network host -e NODE_ENV=production \
  -e SESSION_SECRET=try -e DATABASE_URL=postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd scrbrd-api
```

## What is not here

- **Email or SMS.** Login codes are handed over by a person; see
  `services/api/auth/auth-db.mjs` for why that is the design and not a gap.
- **Push delivery.** Without `FCM_*` on the service the fan-out route answers
  503 and writes no delivery log. Turn it on when the credentials exist.
- **Backups and retention.** Cloud SQL automated backups on; a retention rule
  for a churned school is an open POPIA decision noted in `db/00_schema_core.sql`.
