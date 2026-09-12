# Deploying SCRBRD

One Firebase project, **scrbrd-os**, and the Google Cloud project behind it.
Nothing here uses any other Firebase project. Three pieces:

| Piece | Where | How it gets there |
|---|---|---|
| Client (`apps/web`) | Firebase Hosting | `.github/workflows/deploy.yml`, on push to `main` |
| API (`services/api`) | Cloud Run, `africa-south1`, service `scrbrd-api` | same workflow, from the root `Dockerfile` |
| Database | Cloud SQL, Postgres 16, `africa-south1` | by hand, once, then by hand for every schema change |

Hosting rewrites `/api/**` to the Cloud Run service (`firebase.json`), so the
browser talks to one origin and the client is built with `VITE_API_BASE=""`.
Realtime is plain HTTP, so the rewrite carries everything the client needs.

## One-time provisioning

Done by an operator with owner rights on the project. None of it is in a
workflow because none of it should happen twice.

### 1 · Cloud SQL

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

Two roles, on purpose. `scrbrd` owns the schema and row-level security does
not apply to an owner. `scrbrd_app` is what the API connects as, and
`server.mjs` refuses to start on a connection that owns tables or can bypass
RLS.

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

**Known gap.** There is no migration ledger: `db/0*.sql` applies from nothing.
A schema change after go-live is applied as a hand-written `ALTER`, reviewed
against the diff of `db/`, by the owner role, before the code that needs it is
deployed. A ledger is an open decision, not a thing to improvise on the day.

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
| `ANTHROPIC_API_KEY` | optional; without it StatGuru and commentary answer null |

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

### 6 · GitHub secrets

| Secret | For |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_SCRBRD_OS` | Hosting deploy — the JSON key of a service account with Firebase Hosting Admin on scrbrd-os |
| `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` | Cloud Run deploy via workload identity — the account needs Cloud Run Admin, Cloud Build Editor, Service Account User |
| `VITE_FCM_VAPID_KEY` | optional; the public half of the web-push pair |

Until they exist the deploy jobs build and then say so in a notice, rather
than fail.

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
