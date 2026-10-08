# Comparative gap analysis (5 October 2026): the plan

Kameel's deep comparison of SCRBRD_OS (`2b55618`) with the scrbrd-beta-2 prototype
(`42c48a6`) was added to the pipeline on 7 October 2026. The full report (about 200 KB)
is held privately. This repository is public, and the report cites exact lines for
weaknesses that are not yet fixed, so it is not committed here. This file is the plan
built from it. It is the record of what is open, what is scheduled and what is closed.

## The decision

SCRBRD_OS is the product and the system of record. scrbrd-beta-2 is a reference for
interaction and information design only.

- **What may be transferred from beta:** a role's questions, a priority order, or an
  information pattern (Action Centre; target → evidence → recommendation → action; the
  multi-squad matrix; player comparison).
- **How it is transferred:** each one is rebuilt on OS's authorised reads and writes.
- **What is never transferred:** beta's permission rules, its scoring or sync logic, its
  analytics formulas, and any generated or bundled figure.

That rule has the same standing as the frozen-file rules in DEPLOYING.md.

**First delivery the report recommends:** the authorised multi-squad coach/admin
match-day queue (GA-I09–I11), shipped together with the chart and skills integrity
repairs (GA-I05, GA-I06).

## Ids

GA-Rnn are the report's risk register entries and GA-Inn its backlog entries. They keep
the report's numbers so the two can be read side by side. A GA item that becomes a
ticket takes a SCRBRD number, and that number is noted here.

## Phase A: repair and establish trust (before or around the pilot)

| GA | What | Tier | Status |
|---|---|---|---|
| I01 | Operational-write retries must be atomic: claim the key, fingerprint the request, write the row and store the receipt in one transaction. Same-key concurrent writes make one row; a changed payload is refused. Separate from the scoring append path, which is already sound | Opus | done · merged #75 |
| I02 | The managed-database reset helper must touch only this project's objects (manifest allowlist), and must refuse real-data hosts by default | Opus | done · merged #75 |
| I03 | Sign-out, account disable and sign-in removal must revoke tokens already issued (a session version checked on every request). Role revocation stays immediate | Opus | done · merged #76; db/85 in production |
| I04 | Quarantine unsafe donor logic: no beta rules, fake receipts, name-hash analytics or generated player history in any import or build | Opus review | standing rule (above) |
| I05 | One shared projection for the scorer's charts. The worm ends on the innings total; per-over runs include wides, no-balls and penalties; no NaN or Infinity after a completed chase | Opus | done · merged #75 |
| I06 | The skills radar draws the 1–20 rubric on its own scale, and no target appears unless a coach saved one | Sonnet | done · merged #77 |
| I07 | Context: Squad and Analytics open on the coach's actual team, not `1XI`; view gates use the same role set as navigation; changing context clears stale selections | Sonnet | done · merged #77 |
| I08 | One read-state contract: loading, empty, unassessed, forbidden, failed, stale and partial stay distinct | Sonnet | done · merged #92 (2026-10-08) |
| I18 | Weather keeps the manual observation time, and the provider hint is labelled as such | Sonnet | done · merged #77 |

## Phase B: complete the pilot work

| GA | What | Tier | Status |
|---|---|---|---|
| I09–I11 | The match-day queue: readiness rows open the exact fixture and action; a multi-squad coach day queue; a director/admin operations home with owner and deadline | Fable design check (coach cockpit, SCRBRD-136/137), then Opus | design approved; slice A0 merged #78; the rest after the pilot |
| I12 | Notification read receipts persist per person, and counts agree everywhere | Sonnet + Opus review | open |
| I13 | The scorer's preparation and resume home, with appointments | Opus | open |
| I14–I16 | Acceptance evidence on a real database: cross-school and child refusals, two-device offline scoring, the deployed revision, a backup restore | Opus | partly covered by the API and browser walks and BACKUP_RESTORE.md; gaps to list |
| I17 | Push: a supported FCM token refresh, or "unavailable" stated plainly | Opus | open |
| I19 | Medical review worklist, only if clinical work is in pilot scope | Fable (SCRBRD-110 family) | Kameel to decide scope |
| I20 | The parent's action list per child | Fable (redesign step 4); design started 7 Oct | design approved; slice A0 merged #81; the rest after the pilot |
| I21 | Honesty labels (demo / practice / read-only / official), and success messages that reflect the actual acknowledgement | Sonnet | partly done · #91 (2026-10-08): success lines wait for the server and refusals are shown; the honesty labels (demo / practice / read-only / official) are still open |

## Phase C: enrich verified information (after the pilot)

GA-I22–I36:
- panel-level source and scope;
- a real season trend;
- the analyst workspace;
- two-player comparison;
- assessment history and the drill loop;
- evidence-linked coach cards;
- shot-wheel filtering;
- scenario controls;
- grounds, transport and competition homes;
- full-name chart tables;
- the narrow-screen, keyboard and daylight pass;
- lineage and correction refresh.

Each one is built over existing reads, with its source, unit, window and denominator
shown.

## Phase D: only when evidence exists

GA-I37–I40:
- win probability and forecasts, with a held-out evaluation;
- finance and media lifecycles;
- tracking and sensor data.

None of these starts without a real data source and Kameel's say.

## Already closed by this week's work (overlap with the report)

- Cross-school squad naming: closed in the route by `cd6f10a` and `05f17f6`, and in the
  database by db/84 (`claude/wip-hardening`).
- News post audience frozen on edit: db/84.
- Requests filed before the email was verified are marked for the office: db/84.
- The weather hint requires an enrolled account; backup credentials are kept out of `ps`.

## For Kameel, outside this repository

- GA-R03: scrbrd-beta-2 has a Firebase Admin SDK key file committed. The repository is
  private, but it was also imported into a Google AI Studio applet. Revoke that key in
  the Firebase console (Project settings → Service accounts), then remove the file from
  the repository. Nobody here has opened the file.
- GA-R01/R02 (beta's Firestore rules let a user make himself an administrator): these
  matter only if beta still holds real records. If it does, take it offline or lock its
  rules.

GA-I36 (corrections everywhere) was brought forward to a Fable design pass on 7 Oct by Kameel's decision; the build stays after the pilot unless he says otherwise.
