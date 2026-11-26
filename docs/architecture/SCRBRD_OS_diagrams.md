# SCRBRD OS: three diagrams

The system, the data model, and how a read is decided. Each was drawn from the code on `main` (28f08b63, 25 Nov 2026) and checked against it; the file each claim rests on is named under its diagram. When the code changes what a diagram shows, the diagram changes in the same PR.

---

## 1. The system

```mermaid
flowchart LR
  subgraph Device["Phone or browser · apps/web (React, Vite)"]
    Staff["Staff app<br/>Today, Matches, Team, Logistics, School, Platform"]
    Persona["Family and pupil apps<br/>their own bar and header"]
    Pad["Scorer's pad<br/>log kept on the phone<br/>(packages/sync, IndexedDB)"]
    Public["Public pages and<br/>ground display"]
  end

  Google["Google sign-in<br/>through Firebase Auth"]

  subgraph Render["Render web service · node services/api/server.mjs"]
    Web["Serves the built client<br/>apps/web/dist"]
    Auth["auth/<br/>Firebase token checked,<br/>auth_identity_sign_in(),<br/>signed token: who and which device"]
    Read["read/<br/>GET /api/read/:resource<br/>(READ_QUERIES)"]
    Write["write/, io/ (imports),<br/>handover/ (scoring sessions)"]
    Pub["public/<br/>redacted public answers"]
    Opt["Optional, off unless configured:<br/>weather, AI commentary,<br/>scorebook reader, push (FCM)"]
  end

  subgraph DB["Supabase Postgres (production, and a separate demo project)"]
    PG["Tables with row-level security<br/>app_can() decides every row"]
    Mig["db/NN_*.sql, pasted in order,<br/>each hash-checked,<br/>schema_migration records them"]
  end

  subgraph Pkg["Shared packages"]
    Scoring["packages/scoring<br/>events, replay, the Laws"]
    Policy["packages/policy<br/>capabilities, roles"]
    Gen["services/api/rls<br/>generates db/01, 09, 23, 35, 39"]
  end

  CI["GitHub Actions<br/>unit · API walks · browser walks ·<br/>RLS verifier (db/99)"]

  Device -- "HTTPS, polling:<br/>Match Centre 15 s,<br/>public and ground 5 s" --> Render
  Device -- "sign in" --> Google
  Google -- "ID token" --> Auth
  Render -- "as scrbrd_app, through the pooler,<br/>refusing to start if that login<br/>could bypass row security" --> PG
  Pad -. "balls sent when there is signal,<br/>the server's log is the truth" .-> Write
  Scoring --- Pad
  Scoring --- Write
  Policy --> Gen --> PG
  CI -. "every PR (one that touches no schema, policy,<br/>API or workflow skips the RLS verifier)<br/>and every merge to main, in full" .-> Pkg
```

**Checked against:**
- `services/api/server.mjs`: it serves `apps/web/dist`, refuses to start for a superuser or BYPASSRLS login (lines 190-205), and resolves push at boot.
- `services/api/realtime/realtime.mjs`: the hub is not mounted (8 Oct), so every screen polls.
- `services/api/auth/auth.mjs`: the token carries only who and which device.
- `services/api/auth/signin-api.mjs` and `db/81` `auth_identity_sign_in()`.
- `packages/sync/src` (`indexeddb-storage.mjs`, `sync-engine.mjs`).
- `services/api/rls` and the generated files named in CI's "RLS output is current" step.
- The Render startup log of 25 Nov: weather, AI and the scorebook reader are unconfigured on production.
- `.github/workflows/ci.yml`, the "What changed" job (#396): which paths make a PR run the RLS verifier; a push to main always runs it.

---

## 2. The data model (the core of 146 tables)

```mermaid
erDiagram
  SCHOOL |o--o{ APP_USER : "home school (none for platform staff and new sign-ups)"
  SCHOOL ||--o{ PLAYER : "roster"
  SCHOOL ||--o{ GROUND : "owns"
  SCHOOL ||--o{ COMPETITION : "runs"
  APP_USER ||--o{ ROLE_ASSIGNMENT : "holds"
  SCHOOL |o--o{ ROLE_ASSIGNMENT : "scope (none for platform roles)"
  MATCH |o--o{ ROLE_ASSIGNMENT : "one-fixture scope"
  ROLE_ASSIGNMENT ||--o{ ASSIGNMENT_SUBJECT : "names a child"
  PLAYER ||--o{ ASSIGNMENT_SUBJECT : "is named"
  PLAYER |o--o{ APP_USER : "his own account (player_id, not unique)"
  PLAYER ||--o{ TEAM_MEMBERSHIP : "side, dated"
  SCHOOL ||--o{ MATCH : "home"
  SCHOOL |o--o{ MATCH : "away (none for an opponent not on SCRBRD)"
  GROUND |o--o{ MATCH : "played at (may be unset)"
  COMPETITION |o--o{ MATCH : "played under"
  COMPETITION ||--o{ COMPETITION_ENTRANT : "entrants"
  MATCH ||--o{ MATCH_SQUAD : "team sheet"
  MATCH ||--o{ MATCH_AVAILABILITY : "answers"
  MATCH ||--o{ MATCH_OFFICIAL : "officials"
  MATCH ||--o{ SCORING_SESSION : "who holds the pad"
  MATCH ||--o{ BALL_EVENT : "the ball log"
  PLAYER ||--o{ BALL_EVENT : "striker, bowler, dismissed"
  PLAYER ||--o{ INJURY : "injuries"
  PLAYER |o--o{ NOTIFICATION : "about one child"
  APP_USER ||--o{ AUTH_IDENTITY : "sign-ins"
  APP_USER ||--o{ PENDING_CLAIM : "sign-in waiting for the office"
  APP_USER ||--o{ PUPIL_CLAIM : "says he is a pupil"

  ROLE_ASSIGNMENT {
    uuid person_id
    text role
    uuid school_id
    text team_code
    text season
    uuid fixture_id
    bool active
    date valid_from
    date valid_until
  }
  ASSIGNMENT_SUBJECT {
    uuid assignment_id
    uuid player_id
    text relationship
    text verification_state
    text consent_state
    date valid_from
    date valid_until
  }
  BALL_EVENT {
    uuid match_id
    int seq
    int innings
    text kind
    uuid scorer_user_id
    text device_id
  }
```

**Notes.**
- **There is no team table.** A side is a school plus a `team_code`, on `role_assignment`, `team_membership` and the match.
- **A link to a child is an `assignment_subject` row.** Access through it needs that row verified and live. A parent's terms agreement is kept on it (`consent_state`).
- **Optional keys are drawn as optional:** a person's home school, a role's school (platform roles have none), the away school (an opponent not on SCRBRD), the ground, a match's competition and a notice's child.
- **The ball log is append-only.** A correction is a new event, never an edit (`packages/scoring`).
- **Reads of restricted records write `access_log`.** The ball log's own audit is `scoring_audit`.

**Checked against:**
- the `REFERENCES` clauses in `db/00_schema_core.sql`, `db/02_schema_scoring.sql`, `db/08_schema_programme.sql`, `db/81` and `db/168`;
- `match.competition_id`, added later (`ALTER TABLE match ADD COLUMN competition_id … REFERENCES competition`);
- `app_user.player_id`, whose key is added after `player`.

---

## 3. How a read is decided

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant A as API (read-api.mjs)
  participant P as runAsPrincipal (auth.mjs)
  participant D as Postgres, as scrbrd_app
  C->>A: GET /api/read/:resource, Bearer token
  alt resource is not in READ_QUERIES
    A-->>C: 404 unknown_resource
  end
  A->>P: run the read as this person
  P->>P: verify the signed token (HMAC): user, device, session and its epoch
  P->>D: BEGIN, then app_session_begin(user, device, session, epoch)
  alt the session was revoked, signed out everywhere (epoch moved),<br/>the account is not active, or a pad credential has ended
    D-->>P: 28000
    P-->>C: 401 session_revoked
  end
  P->>D: set app.user_id, app.device_id (transaction-local,<br/>a pad also gets app.scope and app.match_id)
  opt the read belongs to a module
    A->>D: my_feature_enabled(module)
    D-->>A: off
    A-->>C: 403 module_disabled
  end
  A->>D: the read's SQL
  Note over D: Row-level security on every table:<br/>each row passes app_can(capability, school, team, person, fixture).<br/>A read that calls a SECURITY DEFINER function instead<br/>gets that function's own check, in the same terms.
  Note over D: app_can: one of the caller's role_assignment rows that is live<br/>(active, in its dates, not past expires_at (db/23),<br/>not suspended from a duty (db/35)), whose school, team and<br/>fixture scope cover the row, and whose role grants the capability.<br/>A guardian, selfaccess or enquiry role reaches only the<br/>children its assignment_subject rows name, verified and live.<br/>A pupil's own account reads only while his sign-in is open (db/169).
  Note over D: clinical and other restricted detail is read<br/>through *_masked views, tier by tier
  D-->>A: only the rows that passed
  A->>D: access_log rows for a restricted read
  A->>D: COMMIT
  A-->>C: 200 { resource, rows }
```

**Checked against:**
- `services/api/read/read-api.mjs`: `readResource()` covers the unknown-resource 404, the module gate through `my_feature_enabled` and the `logsItself` / `logsReads` options.
- `services/api/auth/auth.mjs`: `sessionConfigStatements()` and `runAsPrincipal()`.
- `db/85` `app_session_begin()`, raising 28000, which `auth.mjs` answers 401 `session_revoked`.
- `db/23` (`expires_at`) and `db/35` (a suspended duty grants nothing): the generated liveness rule.
- `db/01` `app_can()`, whose person-scoped arm is unchanged in its rules.
- db/169's re-emitted `app_can()`, `app_can_but_player()` and `is_family_of()`, which add `pupil_signin_open()`.
- The generated policies in `db/09`.
