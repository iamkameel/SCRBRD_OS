# GA-I19 · The medical review worklist

**Status:** design for Kameel's review (Fable, 2026-10-08). Nothing here is built.
**Family:** SCRBRD-110 (fast-bowler workload, health data, POPIA consent).
**Governs:** `injury`, its write route, the physio's worklist, SG-12's injury half.
**Inputs read:** the Haiku map (`scratchpad/map-i19.md`), `audit/GAP_ANALYSIS_2026-10-05.md` I19,
SCRBRD-110 §3.3–3.4, §5, §6, §7, §10; SAFEGUARDING_DSO §2.2, §3.3, §6.3, SG-12; PUBLIC_DATA §3;
ADR 0002; GA-I09–I11 line 33 and D2; NOTIFICATIONS D1, D2, D7; ACCOUNT_LIFECYCLE §3.4, §6.2.

Migration numbers are the lead's at build time; every one below is `db/NN`. `db/89` and `db/90` are taken.

---

## 0 · In one page

A school physio today can read every injury row at her school and write none of them: `medical.write`
is hers alone (`roles.mjs:430`) and no route uses it (`InjuryView.jsx:38–39`: "Recording and updating
injuries is coming"). The only injury rows are the seed's. So "medical review" has nothing to review.

**The decision this document recommends:** I19 is the physio's injury record, in three pieces that build on
one another, and not yet the wellness flag.

1. **The record** — a physio records an injury, and each later look at it is a **review**: a dated row that
   sets the phase, the restriction, the return date and the next review date, with a clinical note. Both
   versions are kept; the `injury` row carries the current state; the reviews are the history.
2. **The worklist** — one list for the physio, on the Injuries screen she already has: every open injury,
   each with one reason it is on the list (newly recorded, review due, review overdue, return date passed and
   still restricted), a clock, and one door. Nobody else sees it. It is not the match-day queue.
3. **SG-12's injury half** — a `severe` injury, or one where emergency services were called, writes the DSO
   the safeguarding notice with no name that SAFEGUARDING §3.3 already defines.

The wellness flag (SCRBRD-110 phase 2) is the fourth piece and is **after the pilot**: its design is done
in 110 §3 and needs no words here; it is the largest migration of the four and the pilot has no check-ins
to flag.

What never changes: a coach reads status and nature and never a note (ADR 0002); a pupil reads no team-mate's
row (K3, `db/55`); the DSO holds no `medical.*`; nothing medical is public (PUBLIC_DATA §3); the cockpit shows
status only (136 D4); a push carries a pointer and no name (NOTIFICATIONS D14).

**The first slice** is a Sonnet half-day with no migration: `InjuryView`'s phase labels (D7). The first
Opus slice is the record and the worklist in one `db/NN` (slice A, §8).

**The one question that decides whether to build at all** is Q0: does the pilot school have a `medical`
assignment? A worklist with no reader is a paste for nobody.

---

## 1 · What exists, in one table

| thing | where | state |
|---|---|---|
| `injury` (type, severity minor/moderate/severe, date, rtw_date, phase active/rehab/cleared, restricted, notes, physio) | `db/00:163` | built, frozen; no `recorded_by`, no `updated_at`, no review date |
| RLS: read `medical.status.read`, insert/update `medical.write`, anchored through `player.team_code` | `db/09:213–228` | built, frozen |
| `injury_masked`: nature columns behind `medical.nature.read`; `notes`, `physio` behind `medical.details.read`; introspects `information_schema` | `db/09:822–863` | built; a new column surfaces unmasked unless re-emitted |
| `notify_injury()`: recorded / cleared / return date changed → `injury` notice, `medical.nature.read`, team + child | `db/08:1381–1421` | built, frozen; fires on INSERT and UPDATE |
| `player.fitness` (fit/injured/rehab/unavailable), masked behind status tier | `db/00:90`, `db/58` | built; nothing but the seed writes it |
| `health_monitoring_consent`, `health_consent_live()`, `health_retention_due()` | `db/60:181–384` | built; gates **wellness**, not `injury` |
| `log_restricted_read()` | `db/22:218` | built; the `injuries` read is `masked: true` (`read-api.mjs:195`); whether it names `watched` columns is for the builder to confirm |
| `injuries` read, `injuries_active` count, `clinically_restricted` on Readiness (status tier) | `read-api.mjs:195, 719, 1215` | built |
| write route for `injury` | — | **none** |
| `InjuryView.jsx` | `apps/web/src/views/InjuryView.jsx:45` | built; counts "In Rehab" by mock labels the database does not have |
| `wellness_flag`, `wellness_checkin`, `body_site`, the four functions, `wellness.write/alert` | SCRBRD-110 §3, §6.1 | designed, not built |
| SG-12 trigger on `injury` | SAFEGUARDING SG-12 | designed, not built; "waits for 110 phase 2" (only its flag-check third does) |

---

## 2 · Decisions

### D1 · What "medical review" means, and the order

| | recommendation | rejected |
|---|---|---|
| **Meaning** | A **return-to-play review of an injury row by the physio**: one dated `injury_review` row per look, applied to `injury` by a trigger. The recording itself is the first state; reviews follow. | *The wellness flag first.* It is 110 phase 2: four functions, two tables, consent gates, the `welfare` subject kind. The pilot has no check-ins, so a flag queue would be empty, while the physio's actual work — a boy with a hamstring — has no record at all. |
| **Order** | 0 labels → **A record + worklist** (one `db/NN`) → B screens → C SG-12 injury half → D wellness flag (after the pilot) → E retention purge (with 110 phase 6). | *SG-12 first.* A DSO notice about a row nobody can write. |

### D2 · The write route is two functions, not a bare INSERT

| | recommendation | rejected |
|---|---|---|
| **Door** | `injury_record(...)` and `injury_review_record(...)`, both `SECURITY DEFINER`, each requiring `medical.write` over the player (`app_can`, viaPlayer anchors). `REVOKE INSERT, UPDATE ON injury, injury_review FROM scrbrd_app` (as `db/60` does for the consent table); `db/09`'s policies stay as shipped and have no privilege left to grant. | *The `db/09` policies as the door.* They allow it today, but the row would carry no `recorded_by`, no history of who set which phase, and no refusal of the family (D4). A child's clinical record with no author is the audit gap GA-I36 calls out. |
| **Record** | `injury_record(p_player, p_injury_type, p_severity, p_date_injured, p_restricted, p_rtw_date, p_next_review_on, p_emergency_services, p_notes)` → inserts `injury` (with `recorded_by`), inserts the first `injury_review` row (the recording), returns the id. | *A separate "recorded" kind.* One shape; the first review *is* the recording. |
| **Review** | `injury_review_record(p_injury, p_phase_after, p_restricted_after, p_rtw_date_after, p_next_review_on, p_note)` → inserts a review; an `AFTER INSERT` trigger `injury_apply_review()` writes `phase`, `restricted`, `rtw_date`, `next_review_on` onto `injury`, which fires `notify_injury()` exactly as today (cleared → "Cleared to play"; date moved → "Return date updated"). | *Updating `injury` directly and deriving history from `access_log`.* The access log records reads, not what was written. |
| **Next review** | `p_next_review_on` is **required** unless `phase_after = 'cleared'`; the form offers +7 and +14 days. | *A platform default of 14 days.* "A deadline nobody set is an invention" (GA-I09 D3); the physio names the date. |
| **Reopen** | A cleared injury is not reopened; a new injury is recorded (it may name `recurs_injury_id`). | *Reviewing a cleared row back to active.* It would rewrite a "Cleared to play" notice that was already pushed. |

### D3 · Who sees each row, at which tier

Tiers are the existing three (`capabilities.mjs:201–204`); nothing new is levelled. New columns are placed on
an existing tier and the `injury_masked` view is re-emitted in `db/NN` so they are masked, not merely added.

| fact | tier | capability | columns |
|---|---|---|---|
| a row exists; out or not; until when; a review happened on a date | 2 | `medical.status.read` | `injury.id, player_id, date_injured, rtw_date, restricted, created_at`; `injury_review.id, injury_id, reviewed_at, restricted_after, rtw_date_after` |
| what, how bad, what phase, emergency services, when next seen | 3 | `medical.nature.read` | `injury.injury_type, severity, phase, emergency_services, next_review_on`; `injury_review.phase_after, next_review_on` |
| the clinical words, and who wrote them | 4 | `medical.details.read` | `injury.notes, physio, recorded_by`; `injury_review.note, reviewed_by` |
| **the worklist** (reasons and clocks) | — | **`medical.write`** at the school | `injury_worklist()` returns rows only to a caller holding `medical.write` over each row |

| reader | sees | does not see |
|---|---|---|
| **physio** (`medical`) | everything at her school; the worklist; the two forms | another school's rows |
| **coach, assistant** | own side's status and nature; the review history's phases and dates on the Injuries screen (ADR 0002) | notes, who wrote them, the worklist, any reason or clock |
| **team manager, sports admin, school admin** | status and nature as today (`roles.mjs:210, 224, 289`) | notes; the worklist |
| **director of sport, principal** | director: status and nature; principal: status (as today) | the worklist; no count of reviews due (110 Q2: reads on request, never paged) |
| **fitness** | status and nature (110 Q13) | notes; the worklist |
| **parent** (`guardian`, own child) | her child's record at every tier, review history included, on the Family screen | any other child; the worklist |
| **pupil** (`selfaccess`, himself) | his own record at every tier, as today (110 §6.4) | any team-mate's row (K3) |
| **DSO** | the SG-12 notice: *a* serious injury, no name, no diagnosis | any `injury` or `injury_review` row (holds no `medical.*`, SAFEGUARDING §2.2) |
| **office under a support session** | `injury` as today, logged | `injury_review`: a `RESTRICTIVE` policy hides it, as 110 §6.5 hides check-ins (Q7 asks whether `injury` should follow) |
| **scorer, spectator, analyst, media, scout, public** | nothing | — |

*Rejected — a `medical.review.read` capability for the worklist:* ADR 0003's test fails; the person who may act on
a review is exactly the `medical.write` holder, and "the capability is the owner" (GA-I09 D10).

### D4 · Separation of duties

| rule | enforced by |
|---|---|
| only `medical` writes a record or a review | `medical.write` is held by `medical` alone (`separation.test.mjs` §11.3 already asserts it); the functions check it; the REVOKE closes the table |
| **a physio who is the child's parent writes nothing clinical about her own child** under the school's role | both functions refuse when `is_family_of(p_player)` (`db/08`), as `wellness_flag_respond()` refuses the subject and parent (110 §3.3); she reads him as his guardian |
| the pupil never writes his own record | `selfaccess` holds no `medical.write`; the function's `app_can` fails |
| the coach cannot clear a boy to play | no `medical.write`; the function refuses; `match_availability` stays his door (D9) |
| a review cannot name a different child's injury | `injury_review.player_id` is denormalised for the anchors and a FK `(injury_id, player_id) → injury (id, player_id)` holds them together (the `health_monitoring_consent` pattern, `db/60:214`) |
| the DSO never reaches the record through the notice | the SG-12 row has `subject_person_id NULL`, `subject_id NULL`, `required_capability = 'safeguarding.concern.read'`; a `db/99` assertion reads it as the DSO and finds no uuid of a child |

*Rejected — allow a parent-physio with a logged read:* logging is for reads that were legitimate; no one is both author and family on a child's clinical row.

### D5 · What never surfaces

| never | where it holds |
|---|---|
| a child's name or diagnosis on a lock screen | push is a pointer (`push-api.mjs`, NOTIFICATIONS D14); `notify_injury()` is unchanged |
| any of it on a public page | `packages/policy/src/public.mjs` N2 list gains `injury.emergency_services`, `injury.next_review_on`, `injury.recorded_by`, `injury_review.phase_after`, `injury_review.next_review_on`, `injury_review.note`, `injury_review.reviewed_by` — the tripwire test fails until it does |
| a reason or a clock on the coach's cockpit or the match-day queue | `cockpitNever.js` `FORBIDDEN_FIELDS` gains `next_review_on`, `nextReviewOn`, `emergency_services`, `emergencyServices`, `phase_after`, `phaseAfter`, `review_reason`, `reviewReason`; `lib/queue.js` reads no medical content (unchanged) |
| a count of "reviews due" in any nav badge, dashboard tile or director's row | the count is drawn only inside the physio's worklist section, behind `medical.write`; `smoke-browser-injuries.mjs` reads the rendered Injuries screen as coach and director and asserts no "review" word |
| a worklist row for another school | anchors viaPlayer; `medical` is school-scoped |

### D6 · The legal basis of an injury row — a question, not an assumption

Today `injury` stands under the **guardian-link consent** (the terms: the school may run the sport with this
child's information), not under `health_monitoring_consent` (`db/60`), which 110 §7 reserves for check-ins,
flags, tests and plans. `injury_review` follows the row it reviews.

**What the information officer must confirm (Q2), in writing, as he did on 2026-09-28 for 110 §7.4:** an
injury record kept by the school's physio for the child's care is special personal information (POPIA s 26);
the ground the platform relies on is not a separate consent but the school's and the health professional's
processing for the child's treatment and support (s 27 read with s 32 — the officer names the subsection he
stands on), under the general processing consent the guardian link already carries. If he will not, the fallback
is to gate `injury_record()` on `health_consent_live(p_player)` — one line — and a child without health
consent could then have no injury recorded on the platform, which is the consequence the officer must weigh.

*Rejected — placing `injury` under `health_monitoring_consent` now:* that consent arrives **off** and is given
per family (110 §9.1 decision 2); most of the pilot's boys would be unrecordable, and a physio who cannot write
down that a boy may not bowl is worse for the boy than the record is.

### D7 · `InjuryView`'s phase vocabulary

| | recommendation | rejected |
|---|---|---|
| **vocabulary** | The database's three words stand: `active`, `rehab`, `cleared` (`db/00:170`). Shown as **Injured / Rehabilitating / Cleared**. The physio's sub-phase (immobilisation, strengthening, return to bowl) is the review's `note`, not a state. | *Widening the CHECK to the mock's five phases.* A clinical sub-phase is the physio's to word; a coach needs three states; a CHECK change on a frozen table for labels is the wrong trade. |
| **counts** | "Active" = `phase = 'active'`; "In Rehab" = `phase = 'rehab'`; "Returning soon" as now (`rtw_date` within 7 days). For a status-only reader `phase` is NULL from the view, so the tile says "Out: N" from `restricted` instead of a phase count. | *Counting "Active" from `restricted` for everyone (today's code).* `restricted` is a status fact; `phase` is a nature fact; conflating them miscounts a rehabilitating boy who is still restricted. |
| **severity** | `minor / moderate / severe` (`db/00:168`). The mock's `mild` becomes `minor`. | — |
| **mock** | `data/mock.js:587–591` rewritten to the database's words. The builder confirms no walk uses it as a fixture (map Q18). | — |

### D8 · The physio and the match-day queue

| | recommendation | rejected |
|---|---|---|
| **GA-I09 line 33 stands.** The physio is not a queue reader; her worklist is a section at the top of the Injuries screen, drawn only for `medical.write`. No fifth destination (GA-I09 D2's rule). | *Medical review rows on the director's "To resolve".* A school-wide list of overdue reviews is a roster of the hurt (GA-I09 D8) and a judgement on the physio that the director never asked for. *A fifth screen.* The Injuries screen is already hers and in her sidebar. |
| The coach's queue is unchanged: `clinically_restricted` stays status tier. A review that clears a boy changes that row by its fact, as every queue row changes (GA-I09 D7). | — |

### D9 · Who may record an injury, and `player.fitness`

| | recommendation | rejected |
|---|---|---|
| **Recorder** | The physio only. A coach on a Saturday with no physio marks the boy **unavailable** through `match_availability` as today; the physio records the injury when she sees him. | *A coach's "status-only" injury row.* It would hand `medical.write` to `coach` in effect, undoing the one line separation.test §11.3 holds; and an injury record written by someone who did not examine the boy is not a clinical record. Q4 asks. |
| **`player.fitness`** | Derived, not typed: `injury_apply_review()` sets `fitness` = `injured` (an open `active` row), `rehab` (an open `rehab` row and no `active`), `fit` (no open row). `unavailable` is left for the seed and a future non-injury reason. One truth. | *Leaving it dead.* A column the screens draw behind the status tier (`db/58`) and nobody writes is a lie waiting to be read. |

### D10 · Notices

| event | notice | change |
|---|---|---|
| recorded, cleared, return date moved | `injury`, `medical.nature.read`, team + child, medium (high if severe): `notify_injury()` | **none**; fires on the trigger's UPDATE as today |
| a review that changes only the phase (active → rehab) or the note | none | `notify_injury()` already returns without a row |
| review due or overdue | **none**; the worklist is the clock | *a `welfare` notice to the physio*: rejected; pull, not push, for a date she set herself (Q10) |
| severe, or emergency services called | **SG-12**: `kind = 'safeguarding'`, `required_capability = 'safeguarding.concern.read'`, `scope_level = 'school'`, no team, no subject, `urgency = 'high'` (D2's contract: always pushed, never retractable, 30 days). Title "A serious injury has been recorded"; body "A pupil at your school has had a serious injury recorded by the physio today. This is for your awareness under CSA's Safeguarding Policy; the clinical record stays with the physio. Raise a concern if there is a safeguarding question." | new trigger `injury_serious_watch()` AFTER INSERT, and AFTER UPDATE when `severity` becomes `severe` or `emergency_services` becomes true; once per injury (`notification.subject_id` NULL, so the once-guard is a column `injury.dso_notified_at`) |
| to the parent | as today: the `injury` notice reaches a guardian through the person anchor (NOTIFICATIONS D7) | none |

### D11 · Retention, leaving, changing school

| event | what happens | consistent with |
|---|---|---|
| **a pupil leaves** (`player_leave`, lifecycle §3.3) | open rows stay as they are — **nothing is auto-cleared**, no review is written by the system; the worklist **excludes** a departed boy (join on an open `team_membership` at a `school`); the Injuries screen marks his row "left the school"; the physio reads it until retention; a `selfaccess` boy and his linked parent read it as before | lifecycle D8 (nothing rewritten), 110 §7.5 (the clock starts on leaving) |
| **changes school on SCRBRD** | nothing travels: not the injury, not the reviews (lifecycle D9) | — |
| **turns 18 at school** | his parent's read continues through the link (`db/62`); his own `selfaccess` read as before | 110 §7.4 |
| **retention** | `injury` and `injury_review`: **12 months after he leaves the school system**, then **delete**, through 110 phase 6's door (`health_records_purge()` gains the two tables; `health_purge_log` counts them) and a `retention.mjs` entry (lifecycle D22: kind `health: injuries`, anchor leaving). The clock cannot be `health_retention_due()` as built: it is NULL for a boy with no consent row (`db/60:339`), and most injured boys will have none. A sibling `injury_retention_due(p_player)` = last school membership's `left_on` + 12 months, NULL while enrolled. | lifecycle §6.2 names "SCRBRD-110 §7.5's period" for `injury`; this is that period on a workable anchor. Q3 asks whether a clinical record wants longer. |
| **a parent's link ends** | her read ends with it; the record is the school's | lifecycle part 3 |
| **a disabled account** | reads nothing; writes nothing; rows untouched | lifecycle part 1 |

*Rejected — auto-clearing an open injury on departure:* a clearance is a clinical act; "left" is a fact about enrolment.
*Rejected — keeping injuries with the identity for 5 years:* the platform is not the practitioner's clinical file; the officer may say otherwise (Q3), and the shape — a date, a due list, a logged purge — stands either way.

### D12 · Capabilities, and `ADDED_SINCE_01`

**Slices 0, A, B, C need no new capability.** `medical.write` (exists, level 3, `medical` only) gates the
record, the review and the worklist. `medical.status/nature/details.read` place every new column.

The capabilities the map found undefined belong to the slices that gate tables with them, each one
`ADDED_SINCE_01` line in `generate-rls.mjs` and inserted by that slice's migration (110 §6.1, `db/60:98`'s
pattern):

| capability | level | holders | slice |
|---|---|---|---|
| `wellness.write` | 3 | `selfaccess`, `guardian` | D (110 phase 2) |
| `wellness.alert` | 3 | `coach`, `assistantcoach`, `medical` | D |
| `player.workload.plan` | 2 | `coach`, `medical` | 110 phase 3 |
| `wellness.share`, `wellness.shared.read` | 3 | `coach`, `medical`; `guardian`, `selfaccess` | 110 phase 5 |

*Rejected — defining them now, gating nothing:* `db/60` did that for `wellness.read` and `fitness.test.write`
so the `fitness` role would be whole at appointment; no role needs these four to be whole today.

---

## 3 · Schema, named

All in one `db/NN` (slice A; C's trigger joins it if Q8 is yes before the build).

| object | kind | notes |
|---|---|---|
| `injury.recorded_by` uuid → `app_user` | ALTER TABLE ADD | nullable (the seed's rows); details tier |
| `injury.emergency_services` boolean NOT NULL DEFAULT false | ADD | nature tier; SG-12's second condition |
| `injury.next_review_on` date | ADD | nature tier; NULL only when `phase = 'cleared'` — CHECK `(phase = 'cleared') = (next_review_on IS NULL)` **not** added, because the seed's rows predate it; the function enforces it |
| `injury.recurs_injury_id` uuid → `injury` | ADD | optional; status tier (a link, no words) |
| `injury.dso_notified_at` timestamptz | ADD | SG-12 once-guard; details tier (it says a DSO was told) |
| `injury_review` | CREATE TABLE | `id, school_id, player_id, injury_id, reviewed_at DEFAULT now(), reviewed_by → app_user, phase_after CHECK (active/rehab/cleared), restricted_after boolean, rtw_date_after date, next_review_on date, note text`; FK `(injury_id, player_id) → injury (id, player_id)`; CHECK `(phase_after = 'cleared') = (next_review_on IS NULL)`; CHECK `(phase_after = 'cleared') → restricted_after = false` |
| `injury_review` in `tables.mjs` | entry | `read: "medical.status.read", write: "medical.write", anchors: viaPlayer("injury_review"), masked: { "medical.nature.read": ["phase_after","next_review_on"], "medical.details.read": ["note","reviewed_by"] }`; generated into `db/NN` between the `TABLES_ADDED_SINCE_09` markers |
| `injury_review_not_support` | RESTRICTIVE SELECT | `app_support_access_id(school_id) IS NULL` (110 §6.5's shape) |
| `injury_masked` | CREATE OR REPLACE VIEW | re-emitted with the five new columns on their tiers (D3); `security_invoker = true` kept |
| `injury_review_masked` | view | the generator's masked view for the new table |
| REVOKE | privileges | `INSERT, UPDATE, DELETE, TRUNCATE ON injury, injury_review FROM scrbrd_app` |
| `injury_record(...)` | function, SECURITY DEFINER | D2; `app_can('medical.write', …)` viaPlayer; refuses `is_family_of`; refuses under a support session (`app_support_access_id() IS NOT NULL`) and a pad credential (`app_pad_scoped()`); requires the Injuries module on (`feature_enabled('injuries', school)`) |
| `injury_review_record(...)` | function, SECURITY DEFINER | D2; same guards; refuses a cleared injury; refuses a review dated before the last |
| `injury_apply_review()` | trigger AFTER INSERT on `injury_review` | writes `phase, restricted, rtw_date, next_review_on` to `injury`; sets `player.fitness` (D9); `notify_injury()` fires on that UPDATE |
| `injury_worklist()` | function, SECURITY INVOKER, STABLE | over `injury` and `injury_review` under RLS; returns `injury_id, player_id, reason, since, due_on, days_over` for open rows of enrolled boys where the caller holds `medical.write` per row; `reason` ∈ `new` (no review since recording), `due` (`next_review_on` within 7 days), `overdue` (`next_review_on` past), `return_passed` (`rtw_date` past and `restricted`), `no_return_date`; ordered overdue → return_passed → due → new |
| `injury_serious_watch()` | trigger AFTER INSERT OR UPDATE on `injury`, SECURITY DEFINER | D10's SG-12 notice, once per injury; **slice C** |
| `injury_retention_due(p_player)` | function | D11; `NULL` while enrolled |
| `retention.mjs` | entry | with lifecycle slice 7, not here |

No change to `db/00`, `db/08`, `db/09`, `notify_injury()`, `notification`'s CHECKs, or `health_monitoring_consent`.

---

## 4 · Routes and screens

| route | gate | does |
|---|---|---|
| `POST /api/injuries` | `medical.write`; module `injuries` | `injury_record()`; `422 { error }` on the function's refusals (`family_cannot_record`, `module_off`, `next_review_required`) |
| `POST /api/injuries/:id/reviews` | `medical.write` | `injury_review_record()` |
| read `injury_reviews?injuryId` | `medical.status.read`, masked | from `injury_review_masked`; logged through `log_restricted_read()` with the disclosed columns |
| read `injury_worklist` | `medical.write` | `injury_worklist()`; logged (every row is a nature-tier read of a child) |
| read `injuries` | as today | the builder confirms it names `watched` columns so a nature read is in `access_log`; if not, it gains them in slice A |

| screen | who | reads | writes |
|---|---|---|---|
| **Injuries** (exists) | status tier and up | `injuries`; phase words per D7 | — |
| **Reviews due** section at the top of Injuries | `medical.write` only | `injury_worklist` | tap → the injury |
| **Record an injury** form (from Injuries) | `medical.write` | the side's players | `POST /api/injuries` |
| **Injury** detail (exists as a card) | status tier and up | `injury_reviews` as a dated history, each row at the reader's tier | **Review** form for `medical.write`: phase, restricted, return date, next review (+7, +14), note |
| **Family → child → Health** (exists for consent) | `guardian` | her child's injuries and reviews at every tier | — |
| **Me** (pupil) | `selfaccess` | his own, as today | — |
| **DSO inbox** (exists, SAFEGUARDING §8) | `dso` | the SG-12 notice among the safeguarding notices | — |

Honesty labels (GA-I21): the record form says "This is the school's record, not a medical file" in one line.
Floors stand: nothing under 12px, taps 44px, reduced motion honoured.

---

## 5 · Tests

| suite | asserts |
|---|---|
| `db/99` new section | physio records → `recorded_by` set, one `injury_review` row, one `injury` notice; coach `INSERT` → `permission denied`; coach calling `injury_record()` → refused; a `medical` who `is_family_of` the boy → refused; a review to `rehab` changes `injury.phase` and `player.fitness` and writes **no** notice; a review to `cleared` writes one "Cleared to play" and sets `fitness = 'fit'`; a review of a cleared row → refused; coach reads `phase_after` and not `note`; pupil reads his own review and zero of a team-mate's; director reads nature and not note; `injury_worklist()` returns N rows to the physio and **zero** to coach, director, fitness; a departed boy is absent from the worklist; a support session reads zero `injury_review` rows; `injury_masked`'s new columns are NULL for a status-only reader; `injury_retention_due()` NULL while enrolled, `left_on + 12 months` after |
| `db/99` SG-12 (slice C) | a `severe` record writes one `safeguarding` notice the DSO reads; its body and title contain no uuid of a child, no `full_name`, no `injury_type` word; a second update writes none; a `moderate` record writes none; `emergency_services = true` on a `minor` one writes one |
| `rls.test.mjs` | the generated block for `injury_review` is verbatim in `db/NN` |
| `separation.test.mjs` | `medical.write` held by `medical` alone (exists); `dso` holds no `medical.*` (exists) |
| `public.test.mjs` | N2 list names every new masked column |
| `sensitivity.test.mjs` | no new capability; nothing to add |
| `apps/web/test/cockpit.test.mjs`, `signals.test.mjs` | `FORBIDDEN_FIELDS` additions scanned |
| `apps/web/test/injuries.test.mjs` (new) | D7's counts from DB words; a status-only read shows "Out: N" and no phase tile |
| `tools/smoke-injury.mjs` (new, API) | the `db/99` story through the routes, with the `422` bodies |
| `tools/smoke-browser-injuries.mjs` (new) | physio sees "Reviews due" and the forms; coach and director see neither and no "review" word; pupil sees his own and not a team-mate's; the push payload for the cleared notice names nobody |
| `tools/smoke-modules.mjs` | Injuries off hides the worklist and refuses the record route |
| `tools/smoke-support.mjs` | a support session reads zero reviews |

---

## 6 · Build slices, in order

| slice | scope | migration | routes and screens | tests | tier | closes |
|---|---|---|---|---|---|---|
| **0 · Labels** | D7: `InjuryView` counts and words; `mock.js` vocabulary | no | Injuries screen | `injuries.test.mjs`; `smoke-browser-read` unchanged | **Sonnet** | map Q8; gap 5.4 (4) |
| **A · Record, review, worklist** | §3 minus `injury_serious_watch()`; `tables.mjs`; `public.mjs`; `cockpitNever.js`; `generate-rls.mjs` markers; the four routes | **yes, `db/NN`** | `POST /api/injuries`, `POST /api/injuries/:id/reviews`, `injury_reviews`, `injury_worklist` | `db/99` section; `rls.test`; `public.test`; `smoke-injury.mjs`; `smoke-support`; `smoke-modules` | **Opus** | map Q3, Q5, Q6, Q9, Q10, Q13; gap 5.4 (1)–(3) |
| **B · Screens** | "Reviews due", Record form, Review form and history, Family child Health history, "left the school" mark | no | the screens in §4 | `smoke-browser-injuries.mjs`; interface-review before merge | **Sonnet**, Opus review (minors' medical on screen) | I19's row |
| **C · SG-12 injury half** | `injury_serious_watch()`, `dso_notified_at` | in A's `db/NN` if Q8 is decided first; else its own | DSO inbox (exists) | `db/99` SG-12 asserts | **Opus** | SG-12's first condition; CSA check row |
| **D · The flag** (110 phase 2) | as 110 §3, §6.1, §9 row 2; `wellness.write`, `wellness.alert` via `ADDED_SINCE_01`; `welfare` subject kind (NOTIFICATIONS D5) | **yes** | 110's | 110 §9 row 2 | **Opus** | the rest of I19's "review"; SG-12's flag check | **after the pilot** |
| **E · Retention** | `health_records_purge()` gains `injury`, `injury_review`; `retention.mjs` entry | with 110 phase 6 | the due list (lifecycle slice 7) | 110 §9 row 6 + the two tables | **Opus** | D11 | after the officer's sign-off |

Haiku: before A, the file map is this document's §1 and §3; after each merge, the status rows (gap analysis I19,
CSA check SG-12, `DEPLOYING.md` paste list).

---

## 7 · Questions for Kameel

| # | question | recommendation |
|---|---|---|
| **Q0** | Is there a `medical` assignment at the pilot school, or will there be before the pilot? | **If no:** build slice 0 only and move A–C after the pilot; a worklist with no reader is a paste for nobody. **If yes:** 0, A, B, C in that order. |
| **Q1** | Scope: is "medical review" the physio's injury record, review and worklist (D1), with the wellness flag after the pilot? | **Yes.** The flag has no check-ins to read yet. |
| **Q2** | **For the information officer:** does `injury` (and `injury_review`) stand under the guardian-link consent, on the school's and the physio's processing of health information for the child's care (POPIA s 26, s 27, s 32 — he names the subsection), and **not** under `health_monitoring_consent`? | **Confirm that reading in writing**, as for 110 §7.4. The fallback (gate on `health_consent_live()`) is one line and makes most pupils unrecordable. |
| **Q3** | Retention of `injury` and `injury_review`: 12 months after leaving (110's period, lifecycle D22's row), or a longer clinical period? | **12 months**, deleted through 110 phase 6's door. The officer may set longer; the shape stands. |
| **Q4** | May a coach record a status-only injury when no physio is at the ground? | **No.** `match_availability` is his door; the physio records when she sees the boy. |
| **Q5** | Does the director of sport see the worklist, or a count of reviews due? | **Neither.** He reads the Injuries screen on request (110 Q2). |
| **Q6** | A physio who is the child's parent: refuse her write about her own child? | **Refuse.** She reads him as his guardian. |
| **Q7** | Support sessions: hide `injury_review` (as wellness is hidden); should `injury` itself follow, changing today's logged read? | **Hide `injury_review` now; leave `injury` as today**, and revisit with 110 phase 2's support cut. |
| **Q8** | SG-12's injury half in I19's first migration, with D10's wording for the DSO? | **Yes.** One trigger on a table the same migration opens for writing; the breach half and the 72-hour flag check stay with 110 phase 2. |
| **Q9** | `player.fitness` derived from the injury rows by the review trigger? | **Yes.** One truth for a column nothing writes today. |
| **Q10** | A next-review date required on every non-clearing review, and no notice when it passes? | **Required, no notice.** The worklist is her clock; the form offers +7 and +14. |
| **Q11** | Phase words stay `active / rehab / cleared`, shown as Injured / Rehabilitating / Cleared; the sub-phase is the note? | **Yes.** |
| **Q12** | Should the parent be told when a review changes the phase but not the return date (today: no notice)? | **No change.** Recorded, cleared and a moved return date already reach her; a phase step is the physio's. |

## 8 · Assumptions

- `notification.recipient_id` and its RESTRICTIVE policy exist (`db/57`, NOTIFICATIONS D7); nothing here needs them.
- `is_family_of()`, `app_support_access_id()`, `app_pad_scoped()`, `feature_enabled()`, `still_at_school()` exist as the map and `db/60` describe.
- `injury_masked` can be re-emitted by `CREATE OR REPLACE VIEW` with columns appended (Postgres allows adding, not reordering or dropping); the generator's masked-view emitter is reusable for `injury_review`.
- The seed's `injury` rows (`db/98`) have `recorded_by NULL` and `next_review_on NULL` and are not refused by anything in slice A; the seed runs as owner, not `scrbrd_app`.
- `data/mock.js` is not a fixture for any walk of `InjuryView` (the builder confirms).
- The Injuries module key is `injuries` (`modules.mjs:105`).
- No child's name appears in this document, and none will in `db/99`'s new section (role words and uuids, as `db/99` does).
