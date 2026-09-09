# SCRBRD — RLS from the policy layer

Generates Postgres Row-Level Security and column masking **from the same policy
the client uses**, so authorization cannot drift between app and database.

## Files

| File | Role |
|---|---|
| `@scrbrd/policy` | **Single source of truth**, in `packages/policy/`: `capabilities.mjs` (the verbs), `roles.mjs` (bundles), `authorize.mjs` (the decision), `tables.mjs` (physical tables → capabilities). The web client imports the same module, so the two cannot drift. See docs/adr/0001. |
| `generate-rls.mjs` | Generator. Emits `app_can()`, the role→capability rows, the table policies and the masking views. Never hand-edit the SQL. |
| `rls_policies.sql` | **Generated** RLS + masking migration. Apply after `schema_scoring.sql`. |
| `rls.test.mjs` | Proves the brain reproduces every RBAC guarantee **and** the SQL faithfully reflects it (drift guard). 55 assertions. |
| `rls_verify.sql` | Live-DB proof. Run against Postgres + seed data to confirm RLS actually fires. |

## Workflow

```bash
# 1. change packages/policy/ (never the SQL)
# 2. regenerate
node generate-rls.mjs > rls_policies.sql
# 3. prove logic + faithfulness (no DB needed)
node rls.test.mjs
# 4. apply, then prove enforcement on a real DB
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema_scoring.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f rls_policies.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f rls_verify.sql
```

## The one design subtlety: RLS ÷ columns

Postgres RLS is **row-level**. Our field/PII rules (analyst sees no `born`,
assistant sees no clinical `notes`) are **column-level**, which RLS cannot do
with a single application role + session variables. So:

- **Row visibility** → RLS policies (`*_rbac_read`), mirroring the app's `inScope()`.
- **Column masking** → generated `*_masked` views that null denied columns per role.

**The API must read PII/clinical tables through the `*_masked` views, never the
base tables.** That is the single rule that keeps column masking honest; enforce
it in code review and by not granting the app role SELECT on the raw columns
where feasible.

## Request context

The API sets these from the JWT on every request (mirrors `principalForRole()`):

```sql
select set_config('app.role',      $role,      true);
select set_config('app.school_id', $schoolId,  true);
select set_config('app.user_id',   $userId,    true);
select set_config('app.player_id', $playerId,  true);  -- '' if not a player
select set_config('app.child_ids', $childCsv,  true);  -- parent's children, csv
select set_config('app.teams',     $teamCsv,   true);  -- coach/assistant teams, csv
```

Run the app as a **non-superuser** role — superusers bypass RLS entirely.

## Honest limits

- This is production SQL I can generate and unit-test, but I cannot run it
  against your Postgres from here. `rls_verify.sql` is how you confirm
  enforcement once it's applied — treat a green run there as the real gate.
- `RESOURCE_TABLES` covers the security-critical tables (players, profiles,
  injuries, matches). Purely derived/aggregate resources (dashboard, analytics)
  are enforced at the query layer, not RLS — by construction they only read
  already-RLS-filtered base data.
- Ball-event write authorization (capability + token + epoch + lease) lives in
  `schema_scoring.sql`, not here; this migration covers the read model and the
  domain tables.
