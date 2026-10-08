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

## Decided 2026-10-08 (Kameel)

1. The solo pilot run planned for 8 October is postponed, with no new date. Kameel: "Ignore the solo run. It's postponed. Let's go as far as we can with production."
2. Pulled forward from after the pilot, to build now: notifications S1–S5, corrections everywhere (GA-I36), account lifecycle slices 2–7, and the recognition build. Four build agents at once.
3. Live updates: keep polling (public page and ground display every 5 s, Match Centre every 15 s). The realtime hub (`services/api/realtime`) is not mounted and stays parked. For corrections, an approved amendment or a released ball drops the public cache after commit; screens learn of it on their next poll ("Updated · refresh"). This replaces the hub broadcast in the corrections design's N2. GA-I36 is pulled forward 8 Oct; A0+A1 building, polling (decision 3).
4. Scorer claim (GA-I13): claiming a fixture stays as it is. A scorer with the team's scoring assignment may claim any fixture of that team. The appointment shapes the scorer home's list (appointed fixtures first, then the team's others); it is not required to claim.
5. Phase B pulled forward (Kameel, 8 Oct, "Pull forward the rest of Phase B": yes). The match-day queue's later slices (GA-I09–I11 A1 onwards) and the parent action list's later slices (GA-I20 A1 onwards) are built now, not after the pilot.
6. I14–I16 (Kameel, 8 Oct: yes). Haiku listed the evidence gaps: 18 claims, 12 covered, 2 partly, 4 gaps. Claim 15 (production's ledger matches db/SHIPPED.sha256) was then closed by the lead's read-only check at 07:40 UTC: all 88 migrations match, hash for hash. Claims 9, 12 and 14 are being built (Sonnet). Claims 16 and 17 close with Kameel's backup drill (due 10 Oct).
7. I19 medical review worklist (Kameel, 8 Oct: in scope for this release). Fable's design (`docs/design/GA-I19_medical_review.md`) is approved as recommended at 08:01. Slice 0 (InjuryView's phase words, no migration) builds now. Slice A waits on two answers from outside the app: Q0 (will the school have a physio, the medical role) and Q2 (the information officer's written confirmation that injury records stand on guardian consent).
8. Official result (Kameel, 8 Oct, 12:49: "approved as recommended"; `docs/design/OFFICIAL_RESULT.md`): Q1 the organiser confirms a competition result; Q2 a 7-day dispute window per competition; Q3 "Under review" is never public; Q4 records wait for official, the family card and Player of the Match don't; Q5 a confirmer may withdraw within the window; Q6 abandoned matches may be confirmed; Q7 no pre-freeze slice; Q8 the home school's confirmation stands alone when the away side isn't on SCRBRD. Slice 1 (Opus, one migration) is queued after the gap-analysis items.
9. Corrections (GA-I36, Kameel, 8 Oct, 13:03): trim the public bundle rather than raise its 470 KB ceiling (Kameel: "use the ponytail skill"). The "Corrected" chip shows only for approved amendments and released balls, not for a scorer's undo during play.

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
| I09–I11 | The match-day queue: readiness rows open the exact fixture and action; a multi-squad coach day queue; a director/admin operations home with owner and deadline | Fable design check (coach cockpit, SCRBRD-136/137), then Opus | design approved; slice A0 merged #78; A1 onwards pulled forward 8 Oct (was: after the pilot) |
| I12 | Notification read receipts persist per person, and counts agree everywhere | Sonnet + Opus review | done · merged #97 (2026-10-08), db/89 live |
| I13 | The scorer's preparation and resume home, with appointments | Opus | building (decision 4 recorded) |
| I14–I16 | Acceptance evidence on a real database: cross-school and child refusals, two-device offline scoring, the deployed revision, a backup restore | Opus | 13 of 18 covered, plus 9, 12, 14 closed by #99 (2026-10-08); 16 and 17 wait for the backup drill |
| I17 | Push: a supported FCM token refresh, or "unavailable" stated plainly | Opus | open |
| I19 | Medical review worklist, only if clinical work is in pilot scope | Fable (SCRBRD-110 family) | in scope; design approved; slice 0 in review (#101); slice A waits on Q0 and Q2 |
| I20 | The parent's action list per child | Fable (redesign step 4); design started 7 Oct | design approved; slice A0 merged #81; the rest after the pilot |
| I21 | Honesty labels (demo / practice / read-only / official), and success messages that reflect the actual acknowledgement | Sonnet | done · merged #91 and #98 (2026-10-08); "official" waits for the official result design's slice 1 |

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
- lineage and correction refresh (GA-I36: A0+A1 in review, #102).

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
