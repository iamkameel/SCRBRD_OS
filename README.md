# SCRBRD OS

A school-sport operating system, with Cricket OS as its first sport. Postgres
is the only backend and the authorization model lives in it: capability +
scoped assignment, enforced per row with row-level security, generated from
`packages/policy/`. The ball log is the only source of truth for a match; every
score, average, ladder and award is derived from it by replay and none is
stored.

**Run it:** [`RUNNING.md`](RUNNING.md) — clone to signed-in in four commands,
every seeded account, every variable, and what to do when it refuses to start.

```sh
pnpm install --frozen-lockfile
pnpm db:up          # or point DATABASE_URL at a Postgres 16 you already have
pnpm db:reset       # schema + pilot seed
pnpm dev            # client :5173 · API :8787 · dev login on
```

**Check it:** `pnpm verify` — the unit suites, the import and bundle checks,
every API walk against a freshly seeded database, and the live RLS verifier
before any of them. Each runner prints its own count; the docs stop quoting
numbers that drift the moment a walk is added.

**Read it:** `docs/ARCHITECTURE.md` for the shape, `docs/adr/` for the
decisions, and the long comments in `db/` for why each table is the way it is —
the reasoning was written where the code is, on purpose.
