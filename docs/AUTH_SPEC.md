# SCRBRD — Auth & Request Context

Step 2 of the backend build. Turns an authenticated request into the Postgres
session variables `rls_policies.sql` reads. **Nothing in the RLS migration fires
until this populates `app.*` correctly.**

## Files

| File | Role |
|---|---|
| `auth.mjs` | Framework-agnostic core: JWT sign/verify, principal resolution, transaction-local session config, middleware. No external deps. |
| `auth.test.mjs` | 37 assertions: token integrity, trust boundary, per-role resolution, and the pooling-leak guard. |
| `auth-db.mjs` | Postgres adapter: linkage lookups, magic-link login/redeem, and `runAsPrincipal()` for route handlers. |

## Login flow (schools: no passwords)

1. **`POST /auth/request-link { email }`** — if the account exists and is active,
   store a hashed one-time code and email a link. Response is identical whether
   or not the email exists (no user enumeration).
2. **`POST /auth/redeem { email, code }`** — validate the unused, unexpired code,
   mark it used, and mint a JWT. **Role and school are read from the DB here** —
   this is the moment trust is established.
3. Client stores the token; sends `Authorization: Bearer <token>` on every request.
4. Token TTL is 30 min; add a refresh endpoint before launch.

## The trust boundary

Role, school and identity live in a **signed** token minted after a DB check at
redeem time. They are **never** read from request headers or a client-supplied
body. `resolvePrincipal()` consumes only verified claims. A client cannot elevate
its role by editing a header — a tampered token fails signature verification
(tested: privilege-escalation tamper → `bad_signature`).

Volatile scope — a parent's children, a coach's teams — is resolved **fresh per
request** from the linkage tables, so a mid-season squad change takes effect
without re-issuing tokens. Stable identity in the token; volatile scope from the DB.

## The one pitfall that matters: no context bleed

RLS reads `current_setting('app.role', true)` etc. Those must be set
**transaction-local** (`set_config(..., true)`) inside the same transaction as the
query. With a connection pool, session-level config (`, false`) would persist on
the physical connection and leak the previous request's identity onto the next
one that reuses it — a silent, catastrophic authorization bug.

`withPrincipal(client, principal, fn)` enforces the correct shape:

```
BEGIN → set_config(app.*, LOCAL) → your query → COMMIT   (ROLLBACK on error)
```

and `runAsPrincipal()` checks out a dedicated connection, wraps the work, and
releases it with no lingering context. The test suite proves it by simulating two
requests (coach, then spectator) on one shared connection and asserting every
config statement is transaction-local and each request re-establishes its own
context. **Rule: route handlers never touch the pool directly — always go through
`runAsPrincipal()`.**

## Session variables set (must match `rls_policies.sql`)

| var | source | used by |
|---|---|---|
| `app.role` | token claim | `rbac_scope`, capability checks |
| `app.school_id` | token claim | `school` scope |
| `app.user_id` | token claim | scoring session ownership |
| `app.player_id` | linkage (player only) | `own` scope |
| `app.child_ids` | linkage (parent only), csv | `own` scope |
| `app.teams` | linkage (coach/assistant/scorer), csv | `team` scope |

## Honest limits

- HMAC-SHA256 JWTs are implemented directly (no dependency) so the logic is
  self-contained and testable here. A production deployment may prefer a vetted
  library and asymmetric keys (RS256) if tokens are ever verified by other
  services — the claims contract is unchanged.
- The magic-code pepper in `auth.mjs` is a placeholder; move it to an env secret.
- I can generate and unit-test this, but cannot run it against your Postgres.
  Confirm end-to-end against a live DB together with `rls_verify.sql`: redeem a
  code, then check a spectator's token yields zero injury rows.
- Rate-limit `request-link` and `redeem` (per email + per IP) before launch —
  not shown here, but required to stop code-guessing and email bombing.
