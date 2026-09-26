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
3. Client keeps the token in memory (never in storage: `apps/web/src/lib/api.js`
   says why); sends `Authorization: Bearer <token>` on every request.
4. Token TTL is 30 min. There is no refresh of this token. The one thing that
   outlives it is the scoring pad's resume credential (below), which is not a
   refresh: it signs five routes of one match and nothing else.

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

## The pad's resume credential (SCRBRD-078 option B, db/50)

A scorer whose pad reloads, or whose match runs past the token's thirty
minutes, used to be unable to send balls without a new one-time code from the
office. Decided 2026-09-26 (Kameel): a reloaded — or unlocked and lost — phone
keeps scoring its match without the scorer re-entering anything, until the
credential ends; the rest of the app stays signed out.

**What it is.** A credential bound to (person, device, match), held with proof
of possession. The device makes an ECDSA P-256 key pair with WebCrypto,
`extractable = false`, and keeps the private key as a `CryptoKey` in IndexedDB
(`scrbrd-pad` → `credentials`, `apps/web/src/lib/padKey.js`): the page can ask
the browser to sign with it and can never read it out. The server stores the
public key, its RFC 7638 thumbprint and an HMAC of the credential id
(`pad_resume_credential`) — never the id, never anything that signs. A copied
credential is useless off the device.

**Issued** by `POST /api/matches/:id/session/pad-credential { jwk }`, with an
ordinary token, to a device that holds the match's token *right now* (state
active, this person, this device, a live lease) and holds `scoring.edit` over
it (`pad_resume_issue()`). The pad asks right after a claim made signed in, and
after a takeover. One live credential per person, device and match; a new
issue ends the last (`reissued`). Nothing a credential can do mints another.

**Good for exactly five routes, on its own match** (`PAD_ROUTES` in
`services/api/auth/pad-resume.mjs`):

| Route | What for |
|---|---|
| `POST /api/matches/:id/session/heartbeat` | the lease, and where the token stands |
| `POST /api/matches/:id/session/claim` | only this device's own token taken back (`pad_resume_reclaim()`: state active, this person, this device) |
| `POST /api/matches/:id/events` | appending that match's events |
| `GET  /api/matches/:id/events` | reading that match's log |
| `GET  /api/matches/:id/toss` | reading that match's toss (never recording one) |

Every other request carrying a credential — every read (pupils, medical,
contacts, discipline), every write, another match's routes, `/api/session`,
`/api/health` — is `403 pad_scope`, decided by `servePad()` in `server.mjs`
before any other routing and before the body is read.
`tools/smoke-pad-resume.mjs` sends a validly signed request to every route the
server mounts (read out of `server.mjs` by `tools/mounted-routes.mjs`) and to
every read resource, and checks each is refused and nothing was written.

**The request.** `Authorization: ScrbrdPad <proof>`, a compact JWS:

```
header   {"alg":"ES256","typ":"scrbrd-pad+jwt"}
payload  {"cid":"<credential id>","htm":"POST","htu":"/api/matches/<id>/events",
          "iat":<seconds>,"jti":"<16+ base64url chars, once>","bh":"<b64url sha256 of the body bytes>"}
signature  ECDSA P-256 / SHA-256, raw r‖s (WebCrypto's own form)
```

The server (`padPrincipal()`): parses the proof (anything but ES256 and this
`typ` is `pad_malformed` — no `alg: none`, no HMAC with a key the sender
picks); looks the credential up by `HMAC(SESSION_SECRET, "scrbrd-pad-resume:" +
cid)` (`pad_unknown`); verifies the signature against the stored public key
*before* saying anything about the credential's state (`pad_bad_signature`);
checks the proof names this method, this request-target and this body
(`pad_wrong_request`) and that `iat` is within 120 s of its own clock
(`pad_stale`, answered with `serverTime` — the device keeps the offset and
signs again, once); checks the route's match is the credential's (`403
pad_scope`); checks the credential still works (`pad_revoked` with the reason,
or `pad_expired`); and spends the jti (`pad_resume_spend()`: refused if this
credential has signed with it before, `pad_replay`; kept ten minutes, which
covers the ±2-minute window). The spend commits on its own, before the
request's transaction opens.

**The principal** runs as the person on the device, with two more
transaction-local settings, `app.scope = 'pad'` and `app.match_id`
(`sessionConfigStatements()`; set for this principal only). The database
narrows it at two layers (db/50): `app_can()` is true under pad scope only for
`fixture.read` and `scoring.edit` on the credential's fixture (and
`app_holds()`/`app_may_grant()` are false), which narrows every policy and
every SECURITY DEFINER function that asks it; and a RESTRICTIVE
`pad_scope_<cmd>` policy on every table behind RLS closes the rest — the
policies that ask only who the caller is (their own receipts, notifications,
device tokens) and the fixture.read tables of the match that are not its log
(squad, availability, officials). The existing policies admit the scorer to
the match's log already (`ball_event_read`, `ball_event_insert`,
`session_read`, `match_toss_read`); nothing is granted, only narrowed.
`scoring_arm_handover()` refuses a credential by its own first line. db/99 §28
proves each of these live, and each assertion there was falsified once.

**It ends** at midnight (Africa/Johannesburg) of the day it was issued, and
before that when the match completes or is abandoned (trigger on
`match.status`), when the token moves — a handover, a claim by another device,
a force-release (trigger on `scoring_session`) — when the device signs out
(`POST /api/auth/sign-out` → `pad_resume_sign_out()`; the client also forgets
every key it holds, which ends them on the device even offline), and when the
school office revokes it (`POST /api/matches/:id/pad-credentials/revoke` →
`pad_resume_revoke()`, under `user.invite` at the match's school: whoever may
let a person sign in may stop a phone staying signed in). An assignment revoked
or a duty suspended ends what the credential can do on the next request,
because every request is decided by the person's live assignments.

**Threat model** (the migration header has the long form):

- *Theft from IndexedDB* — the store holds an id and a key handle; the id
  alone signs nothing, and the key cannot be exported.
- *XSS on the page* — injected script can *use* the key while the page is open
  (the honest limit of a non-extractable key); it reaches five routes of one
  match until midnight, every event still judged by the Laws and stamped with
  this device. The in-memory token it could already use reaches more.
- *Replay* — one method, one path, one body, a time and a jti, spent once.
- *A lost phone* — keeps scoring its one match (the owner's decision) until
  midnight, the token moving, the match ending, or the office revoking it.
- *A revoked scorer* — refused on the next request by `app_can()`.
- *Clock skew* — ±2 minutes, corrected from the server's time.

**Without WebCrypto** — a page served over plain http, which is not a secure
context — there is no credential: the pad signs in on every reload, as before,
and says so on the pad.

## Session variables set (must match `rls_policies.sql`)

| var | source | used by |
|---|---|---|
| `app.role` | token claim | `rbac_scope`, capability checks |
| `app.school_id` | token claim | `school` scope |
| `app.user_id` | token claim | scoring session ownership |
| `app.device_id` | token claim (or resume credential) | the scoring lease, `ball_event.device_id` |
| `app.scope` | `'pad'` for a resume credential only | db/50's narrowing (`app_pad_scoped()`) |
| `app.match_id` | the resume credential's match only | db/50's narrowing (`app_pad_match()`) |
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
