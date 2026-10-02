# SCRBRD-140 — Sign-up with Google, and linking an account to a school: the design

Status: **design, for Kameel's review** (Fable, 2026-10-02). Nothing here is built. Kameel's
question (2026-10-02): "Can we use Google OAuth via Firebase? Can users just sign up and then
later be linked to their school, or select a school and it must get passed against a
school-provided register." Added to Fable's list the same day: "security isn't cheap."

What this document reads from, by name, is in Appendix A. Opus builds from it; the lead
numbers the migration, the `db/99` section and the phases at build.

**Lead's review (Opus, 2026-10-02), before Kameel reads it.** Checked against the branch:
`onboard_request()`, `decide_role_request()`, `login_code_issue()`/`_redeem()` and
`public_schools()` are where Appendix A says; §2.3's issuer, audience and key URLs are
Google's documented ones; the first-sign-in table (§3.3) never links on an email alone.
**One correction, to §4.2–4.3:** "every policy denies" a school-less account is **not true
today**. Fourteen tables are readable by *any signed-in account* (`app_user_id() IS NOT NULL`):
`official`, `official_accreditation`, `season`, `sport`, `feature_flag`, `feature_grant`,
`feature_suppression`, `load_unit`, `bowling_directive`, `clearance_requirement`,
`clearance_kind_max_days`, `playing_condition_key`, `rulebook_clause`, `rulebook_clause_age`
(db/08, db/32, db/56, db/60, db/61). Until now "signed in" meant "somebody a school enrolled";
with open sign-up it means "anybody with a Google account". Most are reference data, but
`official` holds umpires' **ID numbers, birthdays, emails and phones**. The API reads it only
through `official_masked`, so nothing leaks today, but the row policy is the second layer and it
would let a stranger's session read every row. So phase 1's migration also re-emits these
policies as "signed in **and** holding a live assignment" (one helper, `app_enrolled()`,
md5-guarded like db/77), and §4.3's `db/99` sweep is the proof: it would fail on exactly these
tables without the fix. That is **D14** below. The other `app_user_id() IS NOT NULL` uses
(db/63, db/69, db/70, db/75–77) sit beside an authority check and need no change.

---

## 0 · Summary, in plain words

- **Yes to Google, through Firebase Auth, now.** A person signs in with Google in the browser;
  the API checks Google's signed statement that this is that Google account with that verified
  email; then the API mints **exactly the token it mints today** — thirty minutes, bound to the
  device, saying only who. Firebase never says what anyone may do. Authority stays where ADR
  0001 put it: `role_assignment` rows that `app_can()` reads at query time.
- **Yes to "sign up first, link later."** A new Google sign-in makes an account with no school,
  no assignments and nothing to see but itself and its own pending requests. The database
  proves that: `app_can()` finds no row, every policy denies, and a `db/99` section asserts it
  table by table.
- **Yes to a school register, for staff only.** The office uploads its staff list (name, email,
  role, side, until when). A staff member whose *verified* Google email is on it gets that role
  on sign-in, with the uploader as the recorded decider, and the office is told and can end it.
  **A parent's claim on a child is never automatic**, and the form never reveals whether the
  child exists; the office confirms it as it verifies a guardian link today. **A pupil is linked
  by the office** (or by a verified guardian asking the office), never by signing up alone; an
  eighteen-year-old still at school may ask for himself.
- **Nothing silent.** A Google email that matches an account the office already enrolled does
  not take that account over on its own: the office confirms with one tap, or issues a code
  once. After that first link Google is enough.
- **The office code stays** — for anyone without Google (many pupils, the under-thirteens Google
  will not sign up), as the way to claim an enrolled account, and as recovery.
- **Microsoft and email-link sign-in come later**, in that order, through the same exchange.
- **Three small tables** (`auth_identity`, `pending_claim`; in phase 2 `school_register`), one
  new route (`POST /api/auth/firebase`), a handful of `SECURITY DEFINER` functions in
  `login_code`'s no-policy shape, no new role, no policy change, no change to the token, the
  pad's resume credential or the support session.

---

## 1 · Today, and the gap

| Today | Where | Keeps |
|---|---|---|
| The office issues a one-time code to somebody it has identified; `user.invite` at the account's school | `login_code_issue()` (db/05), `POST /api/auth/invite` | yes — fallback, claim, recovery |
| Redeem spends the code atomically and mints a 30-minute HS256 token `{sub, did}` | `login_code_redeem()`, `signToken()` (auth.mjs) | yes — unchanged, and the Google path ends in the same call |
| A stranger may ask for a role: an account stub and a pending request, same answer whether the email was known | `onboard_request()` (db/08), `POST /api/onboard` | superseded by the Google path for anyone with Google; kept for the office code path |
| The office decides a request; a guardian's or pupil's link is written verified-by-decider, consent pending | `decide_role_request()` (db/62), `enrol_person()` (db/08) | yes — the only door a grant goes through |
| An emailed magic link, written and unwired for want of a delivery channel | `requestMagicLink()` (auth-db.mjs) | its no-enumeration shape; Firebase's email-link is that channel (phase 3) |
| Firebase for analytics only, loaded after consent; "Auth only on purpose" | `apps/web/src/lib/firebase.js` | this is the on-purpose decision |

The gap is the one `requests-api.mjs` describes from the other side: a school arrives with
people already in the building and no way for any of them to sign in without a piece of paper
per head. Google sign-in removes the paper for everyone who has Google; the register removes
the office's per-head decision for staff; neither removes the office's decision about a child.

---

## 2 · Identity providers

### 2.1 Plain words

Google tells us "this browser is signed into Google account X, whose email Y is verified." We
believe that and nothing more. Who X is on SCRBRD is our table; what X may do is
`role_assignment`. Firebase Auth is a verifier of Google (and later Microsoft) sign-ins, not a
user store we read from, not a place roles live, not a second backend.

### 2.2 The exchange

```
browser                         API (services/api/auth)                  Postgres
  │ signInWithPopup(Google)        │                                        │
  │◄── Firebase ID token (RS256)   │                                        │
  │ POST /api/auth/firebase        │                                        │
  │   { idToken, deviceId } ──────►│ verify (§2.3)                          │
  │                                │ auth_identity_sign_in(uid, email,      │
  │                                │   email_verified, name) ──────────────►│ one SECURITY DEFINER fn
  │                                │◄── (user_id | 'claim_required' | …) ───│ no RLS context yet
  │◄── { token } ── signToken({userId, deviceId}, SESSION_SECRET)           │
  │  …every later request exactly as today: Bearer token, withPrincipal()   │
```

The route is the third unauthenticated route in the service after `/api/onboard` and
`/api/schools`, and like them it runs one narrow function. It requires `deviceId` as
`redeemMagicLink()` does — an unbound token is one any device can score with. The Firebase ID
token is used once, at the exchange, and never sent to the API again; it is not our session.
However the client renews its thirty-minute token today, that stays; the Firebase session in
the browser is simply a way to get a fresh ID token to exchange, which is better than a
single-use paper code.

### 2.3 Verifying a Firebase ID token on the server

A Firebase ID token is an RS256 JWT signed by Google. The checks, all of which must pass:

| check | value |
|---|---|
| header `alg` | exactly `RS256`; any other algorithm is refused before anything is parsed |
| header `kid` | names one of Google's current keys, fetched from `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com` (X.509) or the JWK form at `…/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`; cached for the response's `Cache-Control: max-age`; an unknown `kid` refetches once, then refuses |
| signature | verifies against that key (`node:crypto` `verify`) |
| `iss` | `https://securetoken.google.com/scrbrd-os` |
| `aud` | `scrbrd-os` — the one project `firebase.js` names; a token for any other project is refused |
| `exp`, `iat`, `auth_time` | `exp > now`, `iat <= now + 60s`, `auth_time <= now`; for a **link** or **claim** (§3) `auth_time` within the last five minutes, so a stale browser session cannot be used to attach an identity to an account |
| `sub` | non-empty; this is the Firebase uid, the only stable key we keep |
| `email_verified` | `true`, or the token is refused for every purpose — an unverified email matches nothing and creates nothing |
| `firebase.sign_in_provider` | `google.com` (phase 1); `microsoft.com`, `password`/`emailLink` when those phases ship; anything else refused |

**firebase-admin, or verify directly?** `auth.mjs` is deliberately dependency-free and already
contains a JWT verifier of the same shape. Direct verification is one module
(`services/api/auth/firebase-verify.mjs`, ~100 lines: fetch and cache keys, the table above,
one `AuthError` per row) with a unit test that signs tokens with a fixture RSA key and asserts
each refusal by name. `firebase-admin` brings a large dependency tree into a service that
otherwise has `pg` and little else, and tempts the next person to call its user-management
API from the server, which this design keeps out (§3.8). **Recommend direct** (D2). The classic
JWT mistakes are each a row in the table: algorithm pinned, key chosen only from Google's set by
`kid`, issuer and audience exact, no `none`, no HS256 with the public key.

Outbound HTTPS to `googleapis.com` is needed for the keys. If the keys cannot be fetched and the
cache is empty, the exchange answers 503 and the sign-in screen offers the office code. Fail
closed, never "skip the signature."

### 2.4 Later providers, and the fallback

- **Microsoft** (`OAuthProvider('microsoft.com')` in Firebase): many SA schools run Microsoft
  365, so a staff register will often list `@school.co.za` addresses that are Microsoft
  accounts. Needs an Azure app registration owned by SCRBRD and the provider allowed in the
  verifier. **Phase 3, first in it.** Nothing else changes: same exchange, same `auth_identity`
  row with `provider = 'microsoft.com'`.
- **Email-link sign-in**: Firebase sends the email; this is the delivery channel
  `requestMagicLink()` was waiting for. It is the weakest of the three (whoever reads the
  mailbox), so it is for people with neither Google nor Microsoft, and it still goes through
  the same claim rules (§3.3). **Phase 3, after Microsoft.**
- **The office code** stays exactly as built, for anyone without any of the above, for claiming
  an enrolled account (§3.3) and for recovery (§3.6). The owner's way back in (DEPLOYING §3b)
  is untouched.

---

## 3 · The account model

### 3.1 Plain words

A person has one `app_user` row. They may have several ways to prove they are that person: a
Google account, later a Microsoft account, and the office code. Each way is a row in a new
table, keyed on the provider's stable id, never on the email. Email is used once, to *suggest* a
match at first sign-in, and the suggestion is confirmed by a person unless there is nothing to
protect.

### 3.2 The table

```
auth_identity (
  id             uuid PK,
  user_id        uuid NOT NULL → app_user ON DELETE CASCADE,
  provider       text NOT NULL CHECK (provider IN ('google.com','microsoft.com','emailLink')),
  provider_uid   text NOT NULL,                 -- Firebase `sub`; the only key
  email_at_link  text NOT NULL,                 -- the verified email as it was that day
  linked_at      timestamptz NOT NULL DEFAULT now(),
  linked_how     text NOT NULL CHECK (linked_how IN ('new_account','office_confirmed','code','self_added','register')),
  linked_by      uuid → app_user,               -- the office person for office_confirmed; the person for self_added
  last_sign_in_at timestamptz,
  revoked_at     timestamptz, revoked_by uuid → app_user,
  UNIQUE (provider, provider_uid)
)
```

RLS on, **no policy at all**, exactly `login_code`'s shape: every read and write happens through
the functions below, before or outside an identity. A signed-in session reads its own
identities through `my_sign_ins()` (provider, email_at_link, linked_at, last_sign_in_at —
never the uid). Nothing from Google's token is stored but `sub`, the verified email and, on a
new account only, the display name to prefill `app_user.name` (§7.4). No photo URL, ever.

### 3.3 First sign-in: what happens, case by case

`auth_identity_sign_in(provider, uid, email, name)` answers one of these, in this order:

| the uid is… | the verified email… | answer | why |
|---|---|---|---|
| already linked, not revoked | — | `user_id` → token | the ordinary case from the second day on |
| linked but revoked | — | `revoked` (401) | §3.7 |
| unknown | matches no `app_user` | **new account**: `app_user (school_id NULL, email, name, active)` — the legacy `role` column, non-authoritative since ADR 0001, takes whatever the lead picks (`'spectator'` or a new `'none'`); nothing reads it for authority — plus an identity `new_account` → token | §4: it can see nothing |
| unknown | matches an **active** `app_user` with **no live assignment, no `assignment_subject`, `player_id` NULL** (an `onboard_request()` stub, or an account whose roles all ended) | link, `linked_how = 'new_account'` → token | nothing reachable is being claimed; the pending request, if any, now has a verified email behind it |
| unknown | matches an active `app_user` that **holds or held anything** | `claim_required` — no token; a `pending_claim` row (uid, email, user_id, requested_at) the office sees | **never silently** (D3). Two ways through: the office confirms from the People screen (one tap, `user.invite` at the account's school, writes the identity `office_confirmed`), or the office issues a code as today and the person redeems it **in the same browser session** as the Google sign-in, which links the identity (`code`). Either way one person looked. |
| unknown | matches an **inactive** `app_user` | `claim_required`, the same path — not a new account | a deactivated account's address reused by a stranger must not quietly become a fresh account under the old email; the office decides |

Why the office must look: the office typed that email at enrolment. A typo that lands on a
real stranger's Gmail is rare, and the account behind it is a parent's with two children or a
pupil's own file. Email ownership is identity in most products; on a platform holding minors'
records it is a strong hint, and a hint is confirmed. The cost is one tap per already-enrolled
person, once, and for the pilot's enrolled accounts that is the status quo (they need a code
today anyway).

### 3.4 Several Google accounts, one person

Allowed. A signed-in person adds another sign-in from their Me screen ("Add a way to sign in"):
the browser signs into the second Google account, the API verifies the new token with
`auth_time` fresh (§2.3), and `auth_identity_link_self(uid, email)` writes the row
`self_added`, `linked_by` = themselves. A uid already linked to a *different* `app_user` is
refused (`identity_in_use`) and the refusal says no more. An email match is never used to link
to an existing account except through §3.3's office path — the person proves they hold the
account by *being signed into it*, not by sharing its email.

### 3.5 Changing email

The Google email can change under a stable uid; `app_user.email` is the office's record and is
`UNIQUE NOT NULL` (used by `login_code_issue()` and shown to the office). So: a changed Google
email **does not** overwrite `app_user.email`. `email_at_link` stays as it was; the Me screen
shows "Google: new@…, enrolled as old@…" and offers "Ask the office to update your email", which
is a `role_request`-shaped note the office actions by editing the account. A collision (the
new email is already another account's) is then the office's to resolve, by hand, as
`enrol_person()` already refuses `email_belongs_to_another_school` rather than resolving it.

### 3.6 Recovery

Lost the Google account: the office issues a code (`user.invite` at the account's school), the
person redeems it, and may link a new Google account from Me. Nothing new. For an account with
**no school yet** there is no office to issue a code, which is why §4.3 sets `app_user.school_id`
on the first grant. The owner's recovery (DEPLOYING §3b) is unchanged.

### 3.7 Sign-out and revocation

- **Sign-out** is the client's: drop the token, `signOut()` the Firebase session. Our token is
  stateless and dies in thirty minutes; that is the bound on a stolen one, as `auth.mjs` says.
- **Revoking a sign-in method**: the person, from Me (`auth_identity_revoke_self`), or the office
  (`user.invite` at the account's school, `auth_identity_revoke`), sets `revoked_at`; the
  exchange then refuses that uid. The current token runs to its expiry; **authority does not
  wait for it** — ending an assignment takes effect on the next statement, as ADR 0001 made it.
- **Deactivating an account** (`app_user.active = false`) refuses every exchange for it, as
  `auth_account_for_email()` already refuses a code.

### 3.8 Deleting an account (POPIA)

A person asks from Me; the office may do it for a departed person. `account_erase(user_id)`:
`active = false`; `email` replaced by `erased+<id>@invalid`; `name` by "Erased account";
every `auth_identity` row deleted; every live assignment ended through `role_assignment_end()`
with the reason "account erased at the person's request" (which refuses, as it should, to
end a minor's last verified guardian — the office must link another guardian first, and the
screen says so). Audit rows (`role_request.decided_by`, `created_by`, `access_log`) keep the
uuid: a record that somebody read a child's file in March is not the somebody's to erase.

The Firebase user is deleted **by the browser** (`deleteUser()` on the signed-in Firebase
user, which Firebase allows only when `auth_time` is recent) as the last step of the same
flow, so the API never needs the admin SDK or a service-account credential. If that step fails
(the person has already lost the Google account), the row is gone on our side, the exchange
refuses the uid forever, and an orphaned Firebase user holding only a uid and an email is a
backlog item for an operator's console job, not a reason to add a server credential.

A pupil's erasure removes **his sign-in**, not the school's record of him: `player`, his
figures and his injuries are the school's records under its own retention (SCRBRD-110 §7.5 for
health); erasing them is a different request, by the school.

---

## 4 · An account with no school

### 4.1 Plain words

A person who has just signed in with Google and chosen nothing is nobody in particular. They
can see their own name and email, which sign-ins they hold, the list of schools to choose from,
and their own requests. Nothing else — not a fixture, not a team name, not a school's DSO.

### 4.2 What it can reach, exactly

| what | how | why it is safe |
|---|---|---|
| its own `app_user` row | the self-read `sessionProfile()` already relies on | one row, theirs |
| its own `role_request` rows | `role_request_read`: `person_id = app_user_id()` | theirs; the decider's half of that policy needs `user.role.assign` |
| its own sign-ins | `my_sign_ins()` | no uid returned |
| the school list | `public_schools()` — already unauthenticated | id and name |
| nothing else | `app_can()` finds no `role_assignment` row → every generated and hand-written policy is false; `ANY_SCOPE` has no escape at the tenant boundary (ADR 0001) | default deny falls out of the data model, not a branch |

Not the DSO card: `dso_contacts(p_school)` is per school and a school-less account has none
to ask about; the join screen shows The Guardian's link (`GUARDIAN_APP_URL`) instead, so a
child who got this far and needs help still has a route.

### 4.3 How the database proves it

A `db/99` section: create an `app_user` with one `auth_identity` and nothing else; set
`app.user_id`; for **every table in `tables.mjs`** and every hand-written table assert
`count(*) = 0`, in the shape of the existing ANON negative controls; assert an INSERT into
`role_request` for themselves succeeds and into anything else fails; assert `role_request_read`
returns only their own. Then grant one request through `decide_role_request()` as an office
user and assert the first row appears on the very next statement — the revocation test run
forwards.

One seam: `app_user.school_id` is `NULL` for such an account, and `login_code_issue()` reads
it to decide whose office may issue a code. `decide_role_request()` gains one line: when it
grants and `app_user.school_id IS NULL`, set it to the request's school. The column is not
authority (ADR 0001) — it says which office is *theirs* for codes and erasure.

---

## 5 · Joining a school

### 5.1 Plain words

After sign-in the person picks a school and says who they are: staff, a parent, a pupil, or
"I just want to follow matches." Staff may be let in at once if the office listed them in
advance. Everyone else waits for a person at the school to say yes. Nobody learns anything from
the asking.

```
  Sign in with Google ──► no school yet ──► Choose school ──► Who are you?
                                                               │
         ┌─────────────────────────────────────────────────────┼──────────────────────────┐
         ▼                                                     ▼                          ▼
   Staff ─► verified email on the staff register?     Parent ─► "Your child's name,   Pupil ─► "Ask the office
         │  yes: granted now (uploader decided),               and your relationship"       for a code" / or an
         │       office told, can end it                        → requested (always)       18-year-old: request
         │  no:  requested → office decides                     → office confirms           `player` → office
         ▼                                                        as a guardian link        names his row
   Follower ─► request `spectator` → office decides
```

### 5.2 The school-provided register

**What it is.** A list the office keeps of the adults it expects: name, email, role, side (for
team-scoped roles), and until when. A CSV upload or a row-at-a-time screen; the pilot's is a
dozen lines. It is **staff only** in phases 1–2 (D4); a pupil register on a school-verified
domain is phase 3 (D6).

```
school_register (
  id uuid PK, school_id uuid NOT NULL → school,
  email text NOT NULL,                         -- lower-cased; matched exactly
  name text NOT NULL,
  role text NOT NULL,                          -- a roles.mjs role; never guardian/selfaccess/player/enquiry/dso
  team_code text, season text,
  valid_until date NOT NULL,                   -- default: end of the current season
  uploaded_by uuid NOT NULL → app_user, uploaded_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz, claimed_by uuid → app_user, claimed_identity uuid → auth_identity,
  withdrawn_at timestamptz, withdrawn_by uuid → app_user,
  UNIQUE (school_id, lower(email), role, coalesce(team_code,'')) WHERE withdrawn_at IS NULL
)
```

**Who maintains it.** Whoever holds `user.role.assign` at the school — and, **per row**,
`app_may_grant_at(row.role, school)` must be true for the uploader at upload time, checked by
the INSERT function. A sports administrator cannot list a principal; the register is a set of
grants decided in advance, so it is bounded by exactly the authority a grant is bounded by
(db/77's one-school rule). Readable under `user.role.assign` or `audit.read` at the school; it
holds adults' work emails, no child.

**Matching.** Exact: `lower(verified email) = lower(row.email)`, at the chosen school, on an
open row (`claimed_at IS NULL AND withdrawn_at IS NULL AND valid_until >= today`). No name
matching, no domain matching, no "looks like." A person can match only with the email Google
verified as theirs, so the register cannot be probed with other people's addresses.

**The automatic grant.** `register_claim(row)`, `SECURITY DEFINER`, called by the join screen
when a match exists:

1. re-checks, **at claim time**, that the uploader still holds `user.role.assign` at the
   school and may still grant that role there (the same two questions, evaluated for the
   uploader's id — Opus adds a `_for(person)` variant of `app_may_grant_at()` or reads
   `role_assignment` and `role_grantable` directly, with the same liveness and suspension
   clauses). If not, the row is **not** granted: it becomes an ordinary pending request for
   someone else at the school to decide. A departed office's list grants nothing;
2. writes a `role_request` for the person and grants it **through the same body as
   `decide_role_request()`** — the team requirement, the granter table, the audit row — with
   `decided_by = uploaded_by` and `decided_note = 'from the staff register, row <id>, uploaded
   <date>'`. The uploader is the honest decider: they decided when they listed the person.
   (Shape for Opus: factor the grant half of `decide_role_request()` into an internal
   `role_request_grant_as(request, decider)` that both call, md5-guarded as db/77 re-emits;
   not a second copy that drifts.);
3. marks the row claimed (once; a second sign-in by anyone with that email finds no open row)
   and writes the identity `linked_how = 'register'`;
4. sends one `notification` to the school's `user.role.assign` holders: "{name} joined as
   {role} of {side} from the staff register." The People screen shows register grants with an
   **End role** button beside each, which is `role_assignment_end()` with its reason.

**What is excluded by construction:** `guardian`, `selfaccess`, `enquiry`, `player` (the
subject-scoped roles — a register row cannot name a child) and `dso` (its appointment is the
principal's live act with a register line and a notice to the union, SAFEGUARDING_DSO §2.3;
pre-deciding it would skip both). The platform roles are excluded by `app_may_grant_at()`'s
floor already.

### 5.3 The lead's three recommendations, weighed

| recommendation | verdict | with |
|---|---|---|
| **Staff** whose verified Google email is on the register are granted automatically; the office can undo | **Accept, refined** | uploader's authority re-checked at claim time; a row claims once and expires; `dso` and every subject-scoped role excluded; the office is told; end-role is one tap; the upload screen warns on an email whose role at this school ended in the last twelve months ("ended 3 Sep — list anyway?") |
| **A parent's claim on a child is never automatic**; a match only queues it for confirmation, as guardian links are verified today | **Accept** | and go one step further: the parent's form takes the child as **free text** (name, relationship, optionally year group) into the request's note; it never looks a child up, never autocompletes, never says "found" or "not found". The office's decide screen does the matching, picks the `player` row, and `decide_role_request()` writes the link `verified` by the decider with `consent_state = 'pending'` — the family's consent is still the family's to give (db/00's comment). A parent register (guardian emails from the school's admin system) may **prefill the office's suggestion**; it never grants. Who confirms: the office (`user.role.assign` and may grant `guardian`), as today; see D9 for the DSO's part |
| **Pupils** are linked by the school or a verified guardian, never by self sign-up alone; the eighteen-year-old at school excepted | **Accept, with the exception made precise** | a pupil's Google identity may be linked to a pupil account only when the office enrolled him (`enrol_person()` → code or office confirmation, §3.3) **and** his `self` link's `consent_state = 'granted'` or he is an adult (`majority_on(born) <= today`) — a trigger on the link function. A verified guardian asks the office from Family (STEP4 P7e) and the school's minimum age applies (STEP4 §9 Q2). The eighteen-year-old still at school may sign up with Google and request `player` at his school himself; the office names his roster row and grants; he is an adult so no guardian consent is sought, and SCRBRD-110 §7.4 keeps his parent's link open while he is at school. A pupil register of school-domain Google Workspace accounts, which would let the school link its pupils in bulk, is phase 3 (D6) |

*Rejected — fuzzy matching of the register (name similarity, domain-only):* every false
positive is a grant.
*Rejected — a parent register that grants:* the school's admin system is often wrong about
which parent holds which email, and a wrong guardian link is a stranger reading a child's file.
*Rejected — the parent typing the child's name against a live lookup:* the lookup is an
enumeration oracle for every child at the school.

---

## 6 · Abuse

| threat | what stops it |
|---|---|
| **Enumeration** of children or people through joining | the parent form stores free text and answers "requested" always; the staff path only ever matches the caller's own verified email; `onboard_request()`'s "same answer either way" is kept for the code path; `pending_claim` (§3.3) returns `claim_required` without saying what the account holds or whether it is active |
| **A stranger claims a child** | never automatic; the office declines; a declined `guardian` request writes a `safeguarding`-kind notice to the school's DSOs with no name ("A parent claim was declined at your school; open People to see it") and the DSO may raise a concern (D7). Three declined guardian claims from one account, or claims at more than two schools in a month, suspend that account's ability to request (`request_cooldown_until`) and notify the DSO |
| **Impersonating a parent** the school knows | the office's decide screen shows the Google email beside the school's own record of the parent's email where the admin system has one; a mismatch is marked; the office phones the number it already holds. The link is written `verified` by a named person, as today |
| **A former staff member's address still on the register** | a row claims once; rows expire with the season; ending a role does not reopen a row; the upload screen warns on recently ended people; the claim re-checks the *uploader's* authority, so a list uploaded by someone who has since left grants nothing. Nothing on the register grants to a person whose assignments at the school are under a `safeguarding_suspension` — `role_assignment_write`'s trigger refuses (SAFEGUARDING_DSO §5) |
| **A reassigned school mailbox** (a new teacher given a departed one's address) | this is exactly §3.3's "matches an account that held anything → claim_required": the office sees "new Google uid wants the account of X, who left" and refuses, then enrols the new teacher as themselves |
| **Rate limits** | `/api/auth/firebase` per address and per uid (the public pages' limiter and `PUBLIC_TRUST_PROXY_HOPS` already exist); one open `role_request` per role per school per person (the existing unique index); at most three pending requests per account; claims and links need a fresh `auth_time` |
| **Audit trail** | `auth_identity.linked_how/linked_by/revoked_by`; `role_request` rows for every grant including register grants (`decided_by` the uploader, the note naming the row); `school_register` rows never deleted (withdrawn); `access_log` rows for `auth.claim_confirmed`, `auth.identity_revoked`, `register.upload`, `register.claim`; the existing `role_assignment_ending` for undos |
| **What the DSO sees** | nothing about accounts by standing (SAFEGUARDING_DSO §1); the declined-claim notice (D7); and, inside an open concern, `safeguarding_family()` reads the child's **verified** guardians — a queued or declined claim never appears there, because it never became a link |
| **A stolen Firebase ID token** | useless after the exchange (we never accept it again); at the exchange it yields only a thirty-minute device-bound token for the uid's own account |
| **A forged ID token** | §2.3: algorithm pinned, Google's keys only, issuer and audience exact |

---

## 7 · Minors and POPIA

### 7.1 Plain words

Google will not give a child under thirteen an ordinary account, and SCRBRD should not take a
child's sign-in on his own say-so at any age. A child's account exists because the school and a
parent said so; Google is only how he proves it is him afterwards.

### 7.2 Google's age floor

Google's minimum age for an unsupervised account in South Africa is thirteen (A2). Younger
children have Family Link accounts a parent controls, which can sign in with Google, but a
parent-controlled identity signing in as the pupil is the parent, not the child. So the pupil
path says: "Under 13? Ask the office for a code," and the office code remains the pupil's
ordinary door until the school says otherwise (STEP4 §9 Q2, the school sets the minimum age).

### 7.3 Parental consent for a child's account

Under POPIA s35 processing a child's personal information needs a competent person's consent.
The record of that consent is already in the schema: the pupil's `self` link
`consent_state = 'granted', consent_version = 'popia-2026-01'`, written by the office from the
school's signed form when it enrols him (`decide_role_request()`'s `player` path). The link
function refuses a pupil identity while that consent is not granted and he is a minor (§5.3).
Firebase's own terms are between Google and the person; our notice to the parent says the
child's Google identity is verified by Google in the United States when he signs in.

### 7.4 Data minimisation — what we keep from Google

| claim | kept? | where |
|---|---|---|
| `sub` (uid) | yes | `auth_identity.provider_uid` |
| `email`, `email_verified` | yes, verified only | `email_at_link`; `app_user.email` on a new account |
| `name` | on a **new account only**, to prefill `app_user.name`, which the person edits | `app_user.name` |
| `picture` | **never** | — |
| `hd` (Workspace domain) | phase 3 only, for the pupil register | — |
| everything else (`firebase.identities`, locale, …) | never | — |

No `setUserId()`, no custom claims, no Firebase user properties — `firebase.js`'s rule holds.
Firebase Auth's own user record (uid, email, provider, display name, last sign-in) is held by
Google; we do not read it back and we do not write to it.

### 7.5 The transborder note

Firebase Auth has no South African region; the identity record lives on Google's
infrastructure outside the Republic (A6). Under POPIA s72 that is a transfer to a recipient
bound by Google's data-processing terms. The privacy notice gains one paragraph: what is held
there (the table above), by whom, where, and that the school's and the child's cricket records
never go there. This is separate from the analytics consent switch, which stays as it is: a
sign-in is the person's own act, asked for on the screen; it is not a background collection
(D13). Kameel, as information officer, signs the paragraph before phase 1 goes live (A5).

---

## 8 · What stays unchanged

- The token: HS256, `SESSION_SECRET`, `{iss, aud, sub, did, iat, exp}`, thirty minutes, device
  required. `signToken()` and `verifyToken()` are not edited.
- `withPrincipal()` and the transaction-local session variables; `app_can()`; every generated
  and hand-written policy; `tables.mjs`, `roles.mjs`, `capabilities.mjs`. **No new role** (ADR
  0003: joining is a workflow, not a title) and no new capability.
- The pad's resume credential (`pad-resume.mjs`, `app.scope = 'pad'`): it never touches login.
- The support session (db/22): a support session is an assignment with an hour hand, not a
  sign-in.
- The office code, `login_code`, `login_code_issue()`, `login_code_redeem()`, `/api/auth/invite`
  and `/api/auth/redeem`; `tools/bootstrap.mjs`; the owner's key and `/api/auth/owner/recover`.
- `decide_role_request()` as the only door a grant goes through — the register grant calls
  its body, it does not copy it.
- Firebase Analytics stays consent-gated and lazy; Firebase Auth's SDK is likewise imported
  only on the sign-in screen and the Me screen, never at boot.

---

## 9 · Phasing, tiers and proofs

The lead numbers the migration files, the `db/99` sections and the phases at build.

| phase | what | tier |
|---|---|---|
| **1 · Google sign-in, the account, the school-less proof** | `firebase-verify.mjs` + unit test with a fixture RSA key (every refusal by name); `POST /api/auth/firebase`; one migration: `auth_identity`, `pending_claim`, `auth_identity_sign_in()`, `auth_identity_link_self()`, `auth_identity_revoke[_self]()`, `pending_claim_confirm()`, `my_sign_ins()`, the one-line `school_id` seam in `decide_role_request()`, the pupil-consent trigger; the `db/99` section of §4.3; `services/api/expected-migrations.json` | **Opus** |
| 1 · screens | Sign-in (Google button, "I have a code"), the join screen of §5.1 with the parent free-text form, Me → "Ways to sign in", the office's **Claims** list on People (confirm / issue a code) | Sonnet, Opus reviews the join form's wording for enumeration |
| **2 · The staff register** | `school_register`, `register_upload()` (per-row `app_may_grant_at`), `register_claim()` with the factored `role_request_grant_as()`, the uploader re-check, the notice, the recently-ended warning; `db/99`: a row by an uploader who lost authority grants nothing; a guardian row is refused at upload; a claimed row cannot be claimed again; a suspended person is refused | **Opus** |
| 2 · screens | Register upload (CSV + rows), register grants on People with End role, the D7 DSO notice | Sonnet |
| **3 · Later providers and the pupil register** | Microsoft (`microsoft.com`), then email-link; `hd`-domain pupil register for schools on Google Workspace, linking `player` + `selfaccess` through the same grant body with the school as decider; `account_erase()` and the client-side `deleteUser()` flow | Opus for the verifier, the grant and erasure; Sonnet for screens |

**Proofs, in three places:**

1. **`db/99` section**: §4.3's school-less assertions; §5.3's trigger (a pupil identity without
   consent is refused, an adult's is not); the register assertions above; a `claim_required`
   answer for an account holding one guardian link and an automatic link for an account
   holding nothing; the owner's key never claimable through the register.
2. **An API walk** (`tools/smoke-signup.mjs`, in the shape of `smoke-end-role.mjs`): sign a
   fixture ID token; exchange; assert every `read-api.mjs` resource answers empty or 403;
   request `coach` at the pilot school; as the office, decide; assert the squad appears on the
   next read; upload a register row and claim it as a second fixture identity; end it; claim
   again and assert `requested`, not granted.
3. **A browser walk** (`tools/smoke-browser-signup.mjs`): the Google button is present and the
   SDK chunk is **not** fetched before it is pressed; the join form never shows a child's name
   from a lookup; the office's Claims list confirms one and the person's next load shows the
   school.

---

## 10 · Decisions for Kameel

| | decision | recommendation | why, in one line |
|---|---|---|---|
| **D1** | Google sign-in through Firebase Auth now | **Yes** | removes the paper for everyone with Google; Firebase stays a verifier, never an authority |
| **D2** | Verify the ID token directly, or add `firebase-admin` | **Directly** | ~100 dependency-free lines in `auth.mjs`'s own style, each refusal tested; the admin SDK brings a tree we do not need and a server credential we should not want |
| **D3** | A Google email matching an account the office already enrolled | **Never silent**: the office confirms with one tap, or issues a code once; automatic only when the account holds and held nothing | a typo'd enrolment email is rare and the account behind it is a child's file or a parent's |
| **D4** | Staff on the register are granted automatically | **Yes, refined**: uploader's authority re-checked at claim, row claims once and expires, `dso` and subject-scoped roles excluded, office told, End role beside it | the office pre-decided; the refinements keep a stale list from granting |
| **D5** | A parent's claim on a child | **Never automatic**; free-text child, no lookup; office confirms; a parent register may prefill, never grant | a wrong guardian link is a stranger in a child's record |
| **D6** | Pupils | **Office or verified guardian link him; the eighteen-year-old at school may ask for himself**; a Workspace-domain pupil register in phase 3 | a child's account is the school's and a parent's decision; Google is only how he proves it is him afterwards |
| **D7** | What the DSO sees of claims | **A no-name notice on every declined `guardian` claim**, and on an account that is cooled down for repeated claims | a stranger claiming a child is a safeguarding matter before it is an IT one |
| **D8** | Microsoft and email-link | **Phase 3, Microsoft first** | many schools run M365; email-link is the weakest proof and should wait |
| **D9** | Who confirms a parent claim | **The office** (`user.role.assign`, may grant `guardian`), not the DSO | the office verifies guardian links today and knows the parents; the DSO holds no `user.role.assign` by design |
| **D10** | Deleting an account | **Deactivate + tombstone + delete identities + end roles; the browser deletes the Firebase user**; no admin SDK | audit rows keep the uuid; the one step we cannot do server-side is an operator's console job, not a new credential |
| **D11** | Several Google accounts per person | **Allowed, from a signed-in session only** | being signed in is the proof; an email match is not |
| **D12** | A changed Google email | **Not propagated** to `app_user.email`; the office updates on request | `app_user.email` is the office's record and `UNIQUE`; collisions are the office's to resolve |
| **D13** | Firebase Auth behind the analytics consent switch? | **No**: a sign-in is the person's own act; the privacy notice carries the disclosure | gating the sign-in button behind an analytics switch confuses two different things |
| **D14** | Tables any signed-in account may read today (14, incl. umpires' records) | **Narrow them to "signed in and holding a live assignment"** in phase 1's migration | open sign-up turns "signed in" into "anyone with Google"; the db/99 sweep proves the narrowing |

## 11 · Assumptions

- **A1** The Firebase project is `scrbrd-os` and no other; Kameel enables Authentication and
  the Google provider in its console, and lists only `scrbrd-os.web.app` and the custom domain
  as authorised domains.
- **A2** Google's minimum age for an unsupervised account in South Africa is thirteen; Opus
  confirms the current figure when writing the pupil screen's sentence.
- **A3** The pilot school's staff each have a Google account (personal or Workspace) and the
  office will list the address they actually use.
- **A4** The client has some way of renewing its thirty-minute token today; this design does
  not change it, only gives it a fresh ID token to exchange.
- **A5** Kameel, as information officer, signs the privacy-notice paragraph of §7.5 before
  phase 1 goes live, as he signed SCRBRD-110 §7.4.
- **A6** Firebase Auth offers no South African data location; the identity record is held
  outside the Republic.
- **A7** `role_request.note` (300 characters) can carry a parent's free-text description of the
  child; if the office wants it structured, a `claimed_subject_text` column is the lead's call.
- **A8** `app_user.email` stays `UNIQUE NOT NULL`; a new Google account uses the verified email
  as its `app_user.email`; a collision is §3.3's claim path, never a second row.
- **A9** The API's outbound network may reach `www.googleapis.com` for Google's signing keys.
- **A10** A school's "register" today is a spreadsheet the office already keeps; the upload
  asks for nothing it does not have.

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `signToken()`, `verifyToken()`, `TOKEN`, device binding, `withPrincipal()` | `services/api/auth/auth.mjs` | the exchange ends in `signToken()`; nothing else changes |
| `redeemMagicLink()`, `issueLoginCode()`, `requestMagicLink()` (unwired), `sessionProfile()` | `services/api/auth/auth-db.mjs` | the office code as fallback and claim; the no-enumeration shape |
| `login_code`, `login_code_issue()`, `login_code_redeem()`, `auth_account_for_email()` | `db/05_auth.sql` | the table-with-no-policy pattern `auth_identity` copies; who may issue a code |
| `onboard_request()`, `decide_role_request()`, `enrol_person()`, `role_request_read` | `db/08`, `db/62` | the only door a grant goes through; "same answer either way" |
| `app_may_grant_at()`, `role_assignment_end()`, `END_ROLE_REFUSALS` | `db/77`, `requests-api.mjs` | per-row register authority; undoing a register grant; erasure ending roles |
| `assignment_subject` (verification, consent, one open link) | `db/00` 523 | why a parent claim is a verification the office does |
| `still_at_school()`, `majority_on()`, the link past eighteen | `db/62`, SCRBRD-110 §7.4 | the eighteen-year-old's exception |
| the DSO, `safeguarding_suspension`, `safeguarding_family()`, notices with no name | `docs/design/SAFEGUARDING_DSO.md` | D7; the suspension refusal on a register grant |
| Firebase for analytics only, consent first, one project, lazy SDK | `apps/web/src/lib/firebase.js` | the "on purpose" decision this document is |
| `SESSION_SECRET`, `OWNER_RECOVERY_SECRET`, bootstrap, the owner's way back in | `DEPLOYING.md` §3–4 | nothing in the secrets table changes; no new secret is needed for verification |
| the per-address rate limiter, `PUBLIC_TRUST_PROXY_HOPS` | `DEPLOYING.md` §4 | limiting the exchange route |
