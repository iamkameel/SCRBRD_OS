# Running SCRBRD locally

Everything below was walked on a clean checkout of this branch before it was
written. If a step here does not match what happens on your machine, the doc is
wrong and worth a fix — not the machine.

## What you need

| Tool | Version | Why |
|---|---|---|
| Node | 22 or later | the API, the tools, the client build |
| pnpm | 10 | pinned in `package.json` → `packageManager`; `corepack enable` gives you the right one |
| Postgres | 16 | the only backend. Docker **or** a local install — both below |
| `psql` | any recent | `tools/migrate.mjs` shells out to it rather than using a driver, so the client binary is a real dependency of migrating, not a convenience |
| Chromium | optional | only for the two browser walks (`pnpm smoke:browser`) |

Firebase is **not** a backend here. The `scrbrd-os` project is used for
Analytics only, initialised client-side, and a local run needs nothing from it.

## 1 · Install

```sh
pnpm install --frozen-lockfile
```

`--frozen-lockfile` is deliberate. The lockfile is maintained by pnpm 10; a
different major would want to rewrite it and this refuses instead of drifting.

## 2 · A database

Two routes. Pick one.

### Docker

```sh
pnpm db:up          # docker compose up -d db, then waits until it accepts connections
```

`docker-compose.yml` runs `postgres:16-alpine` as role `scrbrd` / password
`scrbrd` / database `scrbrd` on `5432`, with a named volume so data survives
`docker compose down`. `pnpm db:down` stops it.

### A Postgres you already have

The migrations connect as an **owner** role that must also be able to create
the application role (`db/06_app_role.sql` creates `scrbrd_app`), so give it
`CREATEROLE`:

```sh
psql -U postgres -c "CREATE ROLE scrbrd LOGIN PASSWORD 'scrbrd' CREATEDB CREATEROLE;"
psql -U postgres -c "CREATE DATABASE scrbrd OWNER scrbrd;"
```

If your server, port, or credentials differ, point the **db:** commands at it
for that shell:

```sh
export DATABASE_URL=postgres://scrbrd:scrbrd@localhost:5432/scrbrd
```

## 3 · Schema and sample data

```sh
pnpm db:reset       # DROP SCHEMA public CASCADE, apply db/0*.sql, load the pilot seed
pnpm db:verify      # the same, then run db/99_rls_verify.sql — the live RLS assertions
```

**`db:reset` destroys everything in the database.** It is the only honest way
to re-apply, because there is no migration ledger: every `db/0*.sql` file is
applied in order from nothing. Never point it at a database you care about.

`98_seed_pilot.sql` is fixture data — two schools, Hilton College (`HIL`) and
Westville Boys' High (`WES`), their people, players, fixtures, a scored innings,
injuries, vehicles, sponsors. `99_rls_verify.sql` is the live verifier and is
not schema; `pnpm smoke:api` runs it before every walk.

## 4 · Run

```sh
pnpm dev
```

`tools/dev.mjs` starts both processes and forwards Ctrl-C to both:

| | URL | |
|---|---|---|
| client | http://localhost:5173 | Vite dev server, hot reload |
| API | http://localhost:8787 | `GET /api/health` reports `db`, `auth`, and every live read resource |

The runner sets `NODE_ENV=development` and `ALLOW_DEV_LOGIN=1` **as defaults**
— anything already in your environment wins — and loads a root `.env` if one
exists (`cp .env.example .env`; every variable is documented there). Production
never runs through this file, and `server.mjs` refuses dev login outright when
`NODE_ENV=production`, whatever the runner says.

The API connects as the **unprivileged** role `scrbrd_app` by design: row-level
security does not apply to a table's owner, so a server connected as the owner
would run with every policy silently inert. `server.mjs` checks the role it got
on startup and **refuses to start** if it is a superuser, has `BYPASSRLS`, or
owns the tables. That refusal is the product working — see Troubleshooting.

## 5 · Sign in

On the Login screen the server is asked whether it accepts dev login; when it
does, the seeded people appear as a picker and no code is needed. (When it does
not, a login **code** is required — codes are issued by a school office through
`login_code_issue()` and none is seeded, on purpose.)

Every seeded account, and the scope each one holds. Everyone is at Hilton unless
marked otherwise; a **team** means the assignment reaches that side only.

| Sign in as | Name | Holds | Start here |
|---|---|---|---|
| `sarah@example.invalid` | Sarah Mokoena | director of sport · coach U16B · guardian at **both** schools | the widest view of one school; publishes notices, arranges fixtures |
| `coach@example.invalid` | C Hendricks | coach, 1XI | squad, availability, readiness, notes, ratings for one side |
| `coach2@example.invalid` | P Moodley | coach, 2XI | the side `coach@` cannot see — useful for scope checks |
| `u14coach@example.invalid` | T Ndlovu | coach, U14A | the age-eligibility trigger's home |
| `coach.wes@example.invalid` | S Pillay | coach, **Westville** 1XI | the **away** side of a shared fixture: reads it, names only their own XI |
| `scorer@example.invalid` | A Wessels | scorer | live scoring, toss, handover |
| `medical@example.invalid` | L van Wyk | medical | full injury detail; no publishing |
| `parent@example.invalid` | D Pillay | guardian of R Pillay | one child's availability, alerts, consent — and nothing about another child |
| `parent.whitfield@` / `.bekker@` / `.naidoo@` / `.cele@example.invalid` | | guardians | the other families; `parent.cele@` is the boy whose consent is still pending |
| `pillay@example.invalid` | R Pillay | player, 1XI + his own file | what a pupil sees: the team sheet, who is out and until when — not the diagnosis |
| `watcher@example.invalid` | A Watcher | spectator | `news.read` and the public score; the account to prove refusals with |
| `spectator@example.invalid` | A Spectator | **player** (despite the name) | holds the player bundle, which includes `medical.status.read` — so it can never prove a medical refusal. That is why `watcher@` exists |
| `analyst@example.invalid` | An Analyst | scout | scouting candidates, consent-gated |
| `registrar@example.invalid` | B Naicker | school administrator | guardian links, module suppressions (Settings → Modules), imports |
| `registrar.wes@example.invalid` | T Ndlovu | school administrator, **Westville** | the other tenant's office |
| `principal@example.invalid` | Dr N Mkhize | principal | waives sponsor exclusivity; appoints roles |
| `bursar@example.invalid` | M du Toit | finance | sponsorship contract values |
| `driver@example.invalid` | B Ngcobo | driver | marks a trip departed / arrived, nothing else |
| `platform@example.invalid` | Platform Ops | platform administrator | feature flags, **sports**, reward coefficients; holds no school |

A person can hold several assignments — Sarah is the example — and the shell
draws the union of what they may see. What each screen returns is decided by
the database, per row, from these assignments; the role picker in the shell is
presentation.

## 6 · Check your setup

```sh
pnpm test              # every unit suite, no database needed
pnpm check:imports     # every import resolves
pnpm build && pnpm check:bundle   # the client builds, and nothing confidential is in it
pnpm smoke:api         # every API walk, one per feature. RESETS THE DATABASE before each one.
pnpm smoke:browser     # the browser walks: needs `pnpm build` and a Chromium (set CHROMIUM_PATH if not found)
pnpm smoke             # the walks that need no database
pnpm verify            # all of the above, in order
```

`smoke:api` refuses to start if a `tools/smoke-*.mjs` exists that nothing runs,
and runs the live RLS verifier before the first walk. Both are there because a
test nobody runs is a document.

## Ports and variables

| Variable | Read by | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | API **and** `db:*` tools | API: `postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd` · tools: `…scrbrd:scrbrd@…` | two roles, one name. A root `.env` reaches only the API (via `pnpm dev`); export in the shell for the tools |
| `PORT` | API | `8787` | |
| `WEB_ORIGIN` | API | `http://localhost:5173` | CORS |
| `SESSION_SECRET` | API | ephemeral | unset → minted at boot; tokens die on restart. Fine locally, never in a deployment |
| `NODE_ENV` / `ALLOW_DEV_LOGIN` | API | set by `pnpm dev` | dev login is refused whenever `NODE_ENV=production` |
| `VITE_API_BASE` | client | `http://localhost:8787` | Vite reads the **root** `.env` (`envDir`) |
| `VITE_FCM_VAPID_KEY` | client | unset | web-push public key; without it the Alerts tab says push is not configured |
| `FCM_PROJECT_ID` / `FCM_ACCESS_TOKEN` | API | unset | push fan-out answers `503 push_not_configured` and logs nothing; `PUSH_TRANSPORT=echo` in development records sends in memory |
| `CHROMIUM_PATH` | browser walks | auto | see `tools/chromium.mjs` |

## Troubleshooting

**`psql: command not found` during `pnpm db:*`** — install the Postgres client
(`postgresql-client` on Debian/Ubuntu, `brew install libpq` on macOS and add it
to `PATH`). The migrations shell out to it.

**`connect ECONNREFUSED 127.0.0.1:5432`** — nothing is listening. Docker:
`pnpm db:up` (and check `docker compose ps`). Local: start the service.

**The API prints "refusing to start" about the role** — `DATABASE_URL` points
at the owner role, or at a superuser. The API must connect as `scrbrd_app`
(created by the migrations). Unset the variable, or set it to the app-role URL
in `.env.example`.

**The Login screen shows a code field and no people** — the server is not
advertising dev login. Start it with `pnpm dev`, or set
`NODE_ENV=development ALLOW_DEV_LOGIN=1` yourself; `GET /api/health` should say
`"auth": "dev_login_enabled"`.

**`pnpm install` complains about the lockfile** — a different pnpm major.
`corepack enable` and re-run; `package.json` pins the version.

**Port in use** — `PORT=8790 pnpm dev` (put it in `.env`; the client's
`VITE_API_BASE` must match), or `pnpm --filter @scrbrd/web dev -- --port 5174`.

**A read answers `403 module_disabled`** — the school has switched that module
off. Sign in as `registrar@example.invalid` → Settings → Modules to un-hide it.
This is the setting working, not an error.

**My data vanished** — `pnpm db:reset` and `pnpm smoke:api` both drop the
schema. Local data is fixture data; keep anything real elsewhere.

## What a local run does not include

- **Push to a real phone.** The whole delivery path runs, but without FCM
  credentials the fan-out refuses rather than pretending. `PUSH_TRANSPORT=echo`
  exercises it end to end in memory — that is what the `push` walk uses.
- **The AI flows.** No credentials → `/api/health` reports `"ai":
  "no_credentials"` and those routes stand down.
- **Firebase Analytics.** Initialised, collects nothing identifying, and is a
  no-op offline.
- **A second school's full roster.** Westville has a registrar, a coach and two
  players — enough to exercise every cross-school policy, not a full programme.
