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

**`db:reset` destroys everything in the database** and applies every
`db/NN_*.sql` again from nothing, writing a fresh ledger (`schema_migration`)
as it goes. That is the right thing for the throwaway database on your
machine and the wrong thing for any database you keep: there the ledger is
what makes a change a new file rather than a rebuild, and the migrator refuses
`--reset` off localhost for exactly this reason. `DEPLOYING.md`, "Changing the
schema after go-live", is the rule for those.

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
pnpm typecheck         # TypeScript over the JavaScript, on the strict list (below)
pnpm lint              # ESLint across apps, packages, services and tools
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

### Types and lint

The code stays JavaScript. Nothing is renamed to `.ts` and nothing is compiled:
the server runs straight from source, and the paths `db/SHIPPED.sha256` and
`tools/hooks/guard.mjs` know about stay where they are. TypeScript runs as a
**checker** (`allowJs` + `checkJs`, `strict`, `noEmit`) and the types come from
JSDoc.

**What is checked.** `tsconfig.json`'s `include` is the strict list — today
`packages/policy` (source and tests), `packages/sync`, `packages/scoring`
(source and tests) and `services/api`. Every file on it must have zero errors.
Its `exclude` holds the holes — none today but `**/node_modules`
(`services/api/write/events-api.mjs`, the last, came onto the list on
2026-09-25). An excluded file is loaded when a listed one imports it, but its
own errors are not counted and lint treats it as off the list;
`tools/typecheck-scope.test.mjs` refuses an exclusion it does not name
(`HOLES_CEILING`) and one that reopens a closed hole (`CLOSED_HOLES`). A file on the list that imports one off it (sync imports
`@scrbrd/scoring`) pulls it into the program so its inferred types flow in, but
`tools/typecheck.mjs` does not count the outside file's own errors;
`node tools/typecheck.mjs --all` shows them.

**Adding a package.** Add its glob to `include` in `tsconfig.json` *and* to
`FLOOR` in `tools/typecheck-scope.test.mjs`, run `pnpm typecheck`, and fix what
it reports. The test refuses a list that shrinks, and an entry that matches no
directory (tsc treats a typo'd glob as "zero files, zero errors"). The same
list is where ESLint's `no-unused-vars` and `no-useless-assignment` are errors
rather than warnings. A type fix must not change behaviour; where the honest
fix would, leave the code as found and write it up instead.

**JSDoc conventions.**

- Exported functions carry `@param` / `@returns`. Destructured options are
  `@param {object} args` then `@param {T} [args.name]` per field.
- Shapes that recur get a `@typedef` next to the code that owns them
  (`Assignment` in `authorize.mjs`, `TableDef` in `tables.mjs`, `OutboxEvent`
  in `sync-engine.mjs`) and are imported elsewhere with
  `@type {import("./file.mjs").Name}` or a `/** @import { Name } from "./file.mjs" */`
  line. The server's shared shapes — the request and response a route handler
  sees, the pool, a caught error — are in `services/api/api-types.mjs`, a
  types-only module nothing imports at runtime.
- Lookup tables indexed by a runtime string are `Record<string, T>` — a frozen
  literal's exact keys cannot be indexed by `string` under `strict`.
- Result unions name the other side's fields as absent
  (`{ok: true, born: string, reason?: undefined} | {ok: false, reason: string, born?: undefined}`),
  so `r.born` reads without narrowing on `ok` first.
- A cast is `/** @type {T} */ (expr)` — parentheses required — and gets a
  comment saying why the checker cannot see what the code knows.
- `any` is for real boundaries (storage values, a scoring event owned by a
  package not yet on the list, a database row, a request body before it is
  validated), never to silence an error. A `catch` binding can only be `any`
  or `unknown` to the checker, so the server writes `catch (/** @type {any} */ e)`
  — `CaughtError` in `api-types.mjs` says what that `any` holds.

**Lint.** `eslint.config.mjs` is `@eslint/js` recommended plus bug-shaped
rules (`eqeqeq` with the `== null` idiom allowed, `no-throw-literal`,
`array-callback-return`, …) and, for `apps/web`, the React hooks rules.
Nothing stylistic. Errors fail `pnpm lint`; warnings (unused variables outside
the strict list, `exhaustive-deps`) are the cleanup queue. A deliberately
unused binding starts with `_`.

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

## Deploying

Not from here. `DEPLOYING.md` covers the one Firebase project (scrbrd-os),
Cloud Run for the API, Cloud SQL for Postgres, and the first person on an
empty database (`tools/bootstrap.mjs`).

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
