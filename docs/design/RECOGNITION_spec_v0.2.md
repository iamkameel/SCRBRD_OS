# SCRBRD — Awards, Achievements & Records (Recognition Module)

**Spec v0.2.3 · 2026-10-07 · Supersedes** `scrbrd_recognition_spec.md` (v0.1) and is the merge of that with your uploaded `SCRBRD_Awards_Achievements_And_Records.md` ("U"). v0.2.1 to v0.2.3 record your decisions on the open questions (§16). Spec-first. No code written.
Audited source: `scrbrd_os.jsx` (11,410 lines). Line numbers refer to it.
Method: U's rule-integrity, evidence and data model are the base. v0.1's code audit, role mapping, POPIA handling, Pilot Match rule and build order are merged in. Items marked **[Proposed]** are my recommendation awaiting your decision (§16).

---

## 0. What changed

| From | Change |
|---|---|
| U | Adopted whole: six recognition types, three status dimensions, evidence levels, coverage labels, versioned rules, two idempotency keys, typed recipients, eligibility classes, conflict-of-interest rule, fairness guards. |
| U | Trimmed: Scout (deferred to V2 per your earlier decision), Fans' Choice, spectator and supporter recognition (V2). Staff service launches only where evidence is real. |
| U | Corrected: Open Sans removed. Typography follows `scrbrd_ci.html` (Syne / DM Sans / DM Mono). |
| v0.1 | Dropped: v0.1 §5 schema (replaced by §12), unqualified `all_time` and `region` scopes, hat-tricks as V1, single `status` column, single record holder. |
| v0.1 | Kept: code audit (§7), per-role access mapped to your 17 roles (§11), POPIA consent for minors, Pilot Match and unlinked-player exclusion, derivation triggers, build order (§14). |
| New | Phase 0 prerequisites that must be fixed in the scorer before any recognition is trusted (§7). |
| v0.2.1 | Decisions recorded: standardised Colours; Player of the Match by coach or captain with system suggestions; staff split confirmed; school `organisation_id` as tenant; badges and icons instead of colour (§16). P5 (match-level captain) is now required for launch. |
| v0.2.2 | Colours rubric built from OS-evidenceable signals (OS has none); captain-only and own-team Player of the Match confirmed; migration section rewritten (nothing to migrate row by row); proposed fixture-class defaults table added (§5.4). |
| v0.2.3 | Fixture-class data is kept separately from school records: class group is part of the record key, with separate School, Inter-House and Friendly boards (§5.4). |

---

## 1. Principles

1. **Recognition reads, never re-counts.** It consumes canonical scoring output. No competing counter in the UI. (Today C has three sources; see P6.)
2. **Honest framing.** A derived award is labelled derived; a discretionary one shows who decided. Nothing is inferred, estimated or back-filled. Missing data stays unknown, never zero.
3. **Separate concepts, separate identity.** A century can create an achievement, a personal best, a school record and a nomination. Each has its own evidence and none grants another.
4. **Positive recognition only for minors.** No ducks, worst figures or "no incidents reported" awards.
5. **Corrections are normal.** Void with a reason; never delete.

---

## 2. Recognition types

| Type | Meaning | Examples | Confirmation |
|---|---|---|---|
| Award | Distinction granted by an authorised person or panel | Player of the Match, Coach of the Season, School Sportsmanship Award | Recorded decision and awarding authority |
| Achievement | Verified milestone | First 50, 50 appearances, scorer accreditation | Rule evaluation or verified evidence |
| Record | Leading eligible performance in a defined comparison group | Highest Open T20 innings for a school | Eligible dataset, comparison rule, verified source |
| Personal Best | Record within an individual's own eligible history | Highest score, best figures | Same evidence and correction rules as a record |
| Accolade | Attributed endorsement | Opposition coach praise | Attribution and review; subjective wording stays attributed |
| Reward | Benefit under a separate programme | Points, vouchers | **Out of scope here** (separate eligibility, balance, redemption) |

---

## 3. Recipients and context

Recipients: person, team, school, fixture, competition. Context: match, season, competition, school, and the **role held at the time**. One person has one recognition history with role filters. Role changes never rewrite an earlier award's role.

- Player of the Match → person + fixture.
- Match of the Tournament → the fixture itself.
- Partnership record → two person recipients, one performance.
- School of the Season → the school only, not every pupil.

**Unlinked players** (opposition and Pilot Match typed-in names, which are not `persons` rows) can appear on a scorecard but **cannot hold achievements, records or awards in V1**.

---

## 4. Catalogue

Phase tags: **V1** = launch after Phase 0 · **V1b** = after fixture class exists (P4) · **V2** = needs data or authority not yet present.

### 4.1 Players and captains

| Category | Achievements | Awards | Records / personal bests | Phase |
|---|---|---|---|---|
| Batting | First verified 50 / 100; milestone counts; season run milestones | Batter of the Season; Best Batting Performance | Highest innings; most season runs; fastest 50/100 (needs ball sequence) | 50/100, highest innings **V1**; season, fastest **V1b** |
| Bowling | First wicket; first five-wicket haul; season wicket milestones | Bowler of the Season; Best Bowling Performance | Best innings figures; most season wickets; qualifying economy | **V1** after P1; economy **V1b** |
| Hat-trick | Review-only until its rule contract is validated | — | — | **V2** |
| Fielding / keeping | First catch, stumping; milestone counts; run-out involvement | Fielder / Wicketkeeper of the Season | Most catches / keeping dismissals per innings or season | **V2** until P2 (structured fielder IDs) |
| Participation | Verified debut (within coverage); XI appearance; appearance milestones; representative selection | Player of the Season; Contribution to the Team | Appearance totals in declared scope | **V1** |
| Development | Coach-verified skill milestone; completed development plan | Most Improved Player | Progress vs recorded baseline; **no** universal skill record | **V1** (discretionary) |
| Leadership | Captaincy debut and appearance milestones | Leadership Award; Spirit of Cricket | Verified captaincy appearances | achievements **V1** once P5 lands (captain is now needed for Player of the Match); awards **V1** (discretionary) |
| Colours | — | **Half Colours; Full Colours** (standardised award types, same for every school) | — | **V1** (nominated → decided; see §9.2) |

Keep improvement and participation recognition open to reserves. Runs and wickets alone favour opportunity. No awards for playing through injury, ignoring rest, or having no reported medical issues.

### 4.2 Teams, schools, matches, competitions

| Entity | Achievements | Awards | Records | Phase |
|---|---|---|---|---|
| Team | First win; tournament qualification; championship; defined unbeaten run | Team of the Season; Team Sportsmanship | Highest innings total; largest victory margin; consecutive wins; season points | honours **V1**; records **V1b** |
| School | First verified season; programme launch; hosting milestone | School of the Season; Development Programme; Inclusive Participation | School team and player records by format and division; verified titles | boards **V1**; records **V1b** |
| Match | First inter-school meeting in dataset; verified final | Match of the Tournament; Spirit of Cricket Match | Combined match runs / wickets | **V2** |
| Competition | First completed edition | Tournament Organisation Award | Edition totals under the competition's eligibility | **V2** |

Comparisons between schools need comparable denominators and verified coverage. Total runs do not rank programmes. Sportsmanship needs reviewed evidence, not absence of complaints.

### 4.3 Other roles (maps to your existing `ROLES`)

| Role (id) | Suitable recognition | Evidence and limits | Phase |
|---|---|---|---|
| coach / headcoach | Accredited qualification; service milestone; development contribution; Coach of the Season | Verified appointment, certificate or reviewed evidence; account for squad opportunity | **V1** (discretionary / certificate) |
| assistant | Verified service; mentoring | Confirmed assignment; reviewed contribution | **V1** |
| sportsmaster | Programme delivery; inclusive participation | Approved programme evidence | **V1** |
| analyst | Accredited training; accepted analytical contribution | Reviewed reports. Model confidence is not accuracy | **V1** |
| scorer | Accreditation; **matches scored**; mentoring new scorers | Completed, signed-off assignments. Exclude practice and duplicate sessions | **V1** (matches scored is derived) |
| groundskeeper | Accredited training; verified venue service | Approved tasks; inspections stay private | discretionary only (**V1**); counters **V2** |
| driver | Accredited training; completed assigned service | Confirmed trip records. **Logistics is mock today**, so no trip counters | counters **V2** |
| medical | Accredited training; verified welfare service | Redacted verification only; never patient data; never reward low injury reporting | **V1** (discretionary) |
| schooladmin / financeadmin | Onboarding completion; administrative service | Distinguish entering data from verifying it | **V2** |
| headmaster | Not a recipient by default | | — |
| platformsupport / superadmin | Internal service recognition if wanted | Platform access confers no school award authority | **V2** |
| parent | Reviewed volunteering | Needs a volunteer role (does not exist); no ranking by donation | **V2** |
| spectator | Optional community recognition | Not part of official awards | **V2** |
| umpire / match official, scout, competition authority | Per U | **Roles do not exist in C**; add as role assignments first | **V2** |

Service counts are milestones, not records. Do not force leaderboards onto every role. Launch an operational milestone only when its source module produces reliable evidence. Login counts, time online and edit counts are not contribution.

---

## 5. Records

### 5.1 Definition fields (every record definition must state all)

Sport · format · entity or role cohort · division · season or career period · competition or school scope · **fixture class group** · metric · minimum qualification · ordering · tie policy · evidence requirement · coverage.

Labels carry full context: "Highest Individual Innings — Westville Boys' Open T20 — 2026/27". Never "Highest Score".

### 5.2 Metrics

| Metric | Comparison | Required qualification |
|---|---|---|
| Highest innings | Batter runs, descending | Same format and division; not-out is descriptive |
| Best innings bowling | Wickets desc, then runs conceded asc | Same format; joint holders retained |
| Most season runs / wickets | Verified eligible totals, desc | Same competition, period, cohort |
| Fastest 50 / 100 | Balls faced at first threshold crossing, asc | Delivery history sufficient to reconstruct the crossing |
| Best strike rate | Runs ÷ balls faced, desc | Published minimum balls faced; **unset minimum disables the record** |
| Best economy | Runs ÷ legal balls, normalised by configured balls per over, asc | Published minimum legal balls; same format |
| Highest partnership | Canonical partnership runs, desc | Shared recipients, same innings, wicket context recorded |
| Largest victory margin | Runs and wickets in separate categories | Confirmed result; adjusted-target and special results classified |
| Consecutive wins | Chronological eligible sequence | Declared treatment of ties, no-results, abandoned, walkovers |

### 5.3 Rules

- **Division is the fixture's division at the time**, never the player's current age. A later move does not recategorise earlier performances.
- Compare rates with **unrounded numerators and denominators**. Rounding is display only.
- Store overs as **legal-ball counts**. `.4` is four balls, not four tenths.
- Equal performances **share** the record. Keep the first established date and each equalling date. A surpassed holder remains in history as a **former holder** (distinct from an invalidated claim).
- Season counters: a century innings is counted as a century, not also a fifty innings, though its timeline keeps the 50 crossing.

### 5.4 Eligibility (fixture classes)

Each definition decides, explicitly, whether each class qualifies. Missing decision **blocks confirmation**.

| Class | Default |
|---|---|
| Confirmed competitive fixture | Eligible |
| Friendly | Per definition |
| Abandoned / no-result (verified performances) | Per definition |
| Adjusted-target (DLS) game | Per definition |
| Super over | Per definition |
| **Pilot Match (sandbox)** | **Never eligible until promoted** via "promote to real match", which triggers one full evaluation |

**Fixture class decides which board a performance lives on (decided 2026-10-07).** Data from non-competitive classes is **kept separately from school records**. It is retained and shown, but never merged into the School Records boards.

The prototype's `COMPETITIONS` has `league`, `cup` and `tournament` (the U13 T10 Festival and the Hilton Inter-House T20), and **no friendly or practice class** (L673–712). I add friendly and practice as classes (P4). "Verified" means the innings is complete and the scorer has signed off.

| Fixture class | Class group (the board it lives on) | Achievements | Personal bests |
|---|---|---|---|
| `league`, `cup` | **School Records** | Yes | Yes |
| `tournament` / festival, external schools | **School Records**, within that format only (T10 and T20 never mix) **[Proposed]** | Yes | Yes |
| Inter-house (internal, not school v school) | **Inter-House Records** (separate board) | Yes | Yes |
| Friendly / practice (new class) | **Friendly Records** (separate board) | Yes | Yes |
| Adjusted-target (DLS) game | **No board in V1**: retained as match data **[Proposed]** | Yes, if the innings itself is complete | Yes |
| Abandoned / no-result | **No board in V1**: retained **[Proposed]** | Yes, verified completed innings only | Yes, same limit |
| Super over | **No board in V1**: retained | No | No |
| Pilot Match | **Never** until promoted | Never | Never |

Rules:
- **Class group is part of every record's identity.** The record key is metric × scope × format × division × **class group**. A performance appears only on the boards of its own class group and is never counted on another.
- **Boards are labelled** with their class group: "Highest Individual Innings — Hilton U15 — T20 — **School Records** — 2026/27" versus "… — **Friendly Records** — …". A friendly 120 never displaces a competitive record, and a competitive record never hides a friendly one.
- **Achievements** (a 100 is a 100) still count in every class above, and each carries its fixture class as context.
- **Personal bests** are tracked per class group. The headline personal best on a profile is the School Records one; other groups appear under a filter and are never silently merged **[Proposed]**.
- A definition may add or remove a class group, but a missing decision still blocks confirmation.

### 5.5 Scope and coverage

- V1 scopes: person, team, school, competition, season.
- Labels state coverage: "Best in verified SCRBRD matches since October 2026" is justified; "all-time school record" requires reviewed, sufficiently complete history and the school's authority to claim it.
- Regional or national records need the governing dataset and authority. Pooling participating schools does **not** make a national record. **V2.**

---

## 6. Evidence and historical coverage

| Level | Supports |
|---|---|
| Verified deliveries | Innings and match statistics; sequence-based achievements; threshold timing |
| Verified full scorecard | Recorded totals and supported statistics; not missing sequences |
| Reviewed historical document | Only facts the document establishes |
| Verified role assignment / module completion | Service milestones within that module's coverage |
| Certificate or authorised decision | Accreditation, selection, discretionary recognition |
| Unverified submission | Private claim awaiting review |

- A final score of 104 can support a verified century. It cannot establish balls to reach 100.
- Missing fielding attribution stays unknown, not zero.
- **Existing `careerTotals`, `avg`, `sr`, `wkts` on `PLAYERS` are hand-entered** (L150+). Treat them as "reviewed historical document" at best. They cannot seed verified achievements until reviewed.
- First uploaded appearance is not a career debut unless history coverage is declared complete.
- Illustrative wireframe or sample numbers never seed verified recognitions.

---

## 7. Phase 0 — scoring prerequisites (fix before any recognition ships)

| ID | Problem in C | Evidence | Required change | Blocks |
|---|---|---|---|---|
| P1 | **Every dismissal credits the bowler**, incl. Run Out, Handled Ball, Obstructed Field | `bow.wickets++` L10487; modes L8717 | Credit bowler only for Bowled, Caught, LBW, Stumped, Hit Wicket | All bowling achievements and records; hat-trick |
| P2 | No structured dismissed-batter or fielder. Striker always marked out; fielder is text inside `dismissal` | L10486, L10490 | Add `dismissed_batter_id`, `fielder_ids[]`, run-out end, contribution policy | Fielding, keeping, run-out involvement; correct batting dismissals |
| P3 | Balls have no ID or timestamp. Undo is a 10-step in-memory snapshot | L10490, L10579, L10331–10360 | Client-generated UUID + timestamp per ball; persist as event log; define "verified" = scorer sign-off at match close | Idempotency, offline sync, corrections |
| P4 | `MATCHES` has no fixture class, result status (abandoned / no-result / adjusted), balls per over, or Laws/playing-conditions reference | L661–670 | Add these fields; add Pilot Match flag | Records; eligibility |
| P5 | No match-level captain; only `cap:"c"` on player | L153 etc. | Add captain to the match team sheet | **Player of the Match (captain path)**, leadership recognition |
| P6 | Three competing sources: in-place counters, `detectMilestone` on a pre-ball snapshot, hand-entered `PLAYERS` stats | L10484–10487, L9028, L150+ | One canonical reducer; `detectMilestone` becomes a consumer of the same pure function | Integrity |
| P7 | Live hat-trick overlay ships today, counts run-outs, and U requires review-only | L9041–9046, L7050 | Keep as unlabelled-provisional display only; never persisted until its rule contract is validated | Hat-trick |
| P8 | Shot and zone are optional per ball; boundary-vs-four-run needs checking | L9393, L10490 | Record batter boundary vs run explicitly; shot zone is analysis, never distance | Boundary counts |

Already correct and to keep: overs as integer legal balls (L10478); milestone by threshold crossing (`prev<50 && cur>=50`, L9035).

Display rule for the live overlay: `detectMilestone` returns only the first milestone (L9058). The overlay may keep a display priority; **persistence records all**.

---

## 8. Evaluation pipeline and integrity

Single pure function shared by overlay and persistence:

```
deriveFacts(canonicalBallEvents, rosterIndex, ruleVersions) ->
  { achievements[], personalBestCandidates[], recordCandidates[] }
```

Stamps on every result: **reducer version · recognition rule version · source revision**.

Keys:
- `logical_occurrence_key` = definition identity + recipients + scope + source performance + threshold. Same honour = same key. Rule or source version changes **update provenance, never issue a second copy**.
- `evaluation_key` = logical key + rule version + source revision.
- Notifications have their **own** stable keys.

Pipeline:
1. Accept an authorised source event or a source verification change.
2. Replay canonical source; select applicable versioned definitions.
3. Create or update candidates by `logical_occurrence_key`.
4. Confirm eligible automatic achievements; route discretionary and historical claims to review.
5. Recompute affected record comparisons; store revision history.
6. Queue notifications only after the transaction commits, honouring recipient scope and preferences.

Triggers:
| Trigger | Effect |
|---|---|
| Live ball (local) | Tentative cue on the scorer's device. **Not official.** Unsynced devices cannot issue awards or cross-school records |
| Server evaluation of acknowledged data | Provisional candidate |
| Innings close | Persist innings-grain facts as candidates |
| Match complete + scorer sign-off | Full recompute; confirm eligible facts; evaluate records |
| Score correction | Rebuild affected achievements, personal bests, records; keep prior revisions; neutral correction note; a **discretionary award returns to its authority**, it does not move to someone else |
| Backdated import | Order by performance date, audit by import date; rebuild sequences; a past milestone is never shown as new today |
| Season / competition close | Run derived award types |

Concurrency: lock or transact per record scope so workers cannot declare contradictory holders. Season aggregates reference a source-set revision manifest so corrections reproduce them.

When a career milestone moves to an earlier fixture, update its evidence and date; do not award it again.

---

## 9. Award decisions

An award definition names: awarding body, eligibility, nomination window, decision authority, tie or shared policy, allowed frequency.

Workflow: **nomination → evidence review → authorised decision → optional publication.**

- A nominee cannot approve their own award. If one person is both coach and school administrator, switching role does not remove the conflict; assign another reviewer.
- An algorithm may **suggest** candidates with an explanation. Official sporting awards need the designated decision-maker.
- Player of the Match may have none, one or shared recipients per competition policy.
- Improvement, leadership, service and sportsmanship awards need rubrics and reviewed evidence. Team wins alone cannot assess a coach.
- Derived awards (e.g. Top Run-Scorer) show their stat snapshot and are labelled derived.

### 9.1 Player of the Match (decided 2026-10-07)

Either the **coach** (headcoach / coach of that team) or the team's **match captain** may select the recipient, with **system suggestions** to help them.

- **Own-team only in V1.** Each school awards its own player. Cross-school Player of the Match needs a competition authority and shared-fixture access, which is V2. **[Proposed]**
- **One decision per match per team.** If both select, the **coach's choice stands**; the captain's pick is retained in revisions as a nomination. **[Proposed]**
- **Captain-only selection** (a minor choosing) is saved as a **nomination awaiting one-tap coach confirmation** before it publishes. **[Proposed]** Simpler alternative if you prefer: either may finalise alone. Say the word and I will switch it.
- A captain cannot select themselves; a nominee never decides their own award (conflict rule, §9).
- Selection is allowed only after the match is signed off, and only from players on the confirmed team sheet.
- Recipients: none, one or shared, per competition policy.

**System suggestions** (assistive, never decisive):
- Candidates come only from **verified** match data and show **why** (e.g. "104 off 71, 1 catch"), with the stat snapshot. No opaque score.
- Show a short ranked list (2 to 3), not a single answer, and include non-top-scorers when contribution is high.
- State what was **not** considered. Until P2 lands, fielding is not factored: label "Based on batting and bowling only".
- Suggestions are the same for coach and captain, and are stored in `derived_from` on the decision for audit. The system does not track whether people followed its suggestion.
- Suggestions never auto-select and never publish.

### 9.2 Colours (decided 2026-10-07)

Standardised now; configurable per school later.
- Two fixed award types: **Half Colours** and **Full Colours**, identical for every school.
- One fixed workflow: nominated by headcoach, decided by sportsmaster, evidence attached, conflict rule applies.
- **Rubric follows SCRBRD OS (decided).** `scrbrd_os.jsx` contains **no Colours rubric** (no "colours", "half colours" or "honours" anywhere), so there is nothing to copy. I therefore build the standard rubric only from signals the prototype can already evidence, as an **evidence checklist, not pass/fail numbers**:
  1. **Appearances** for the school's team in that age division: derived from verified matches.
  2. **Verified performance**: batting, bowling, and fielding once P2 lands: derived.
  3. **Leadership and contribution**: reviewed evidence from the coach.
  4. **Conduct and Spirit of Cricket**: reviewed evidence.
  5. **Representative selection**: a certificate or authorised decision. In the prototype this exists only as free text in player bios (L156, L273, L410), so it counts as an **unverified submission** until reviewed.
- Because no thresholds exist, **no Colours award is ever automatic**: the system can show the derived items (1 and 2) as suggestions, and a person decides. Numeric thresholds, if the school or SCRBRD later wants them, become configurable per school in V2.

---

## 10. Verification, publication, standing

| Dimension | Values |
|---|---|
| Verification | proposed · pending review · confirmed · under review · rejected · invalidated |
| Publication | private · school · authorised competition audience · public |
| Record standing | current holder · joint holder · former holder (confirmed eligible records only) |

A confirmed achievement may stay private. Former holder ≠ invalidated claim; different labels and treatment.

Empty states are distinct: *No recognitions yet* · *Awaiting verification* · *Not enough eligible data* · *Historical coverage incomplete*. Never a placeholder that looks like a confirmed honour.

---

## 11. Access, tenancy and POPIA

Enforce on the server: capability + tenant scope + entity relationship. A role name alone never authorises.

### 11.1 New RBAC resources (added to `POLICY`)

`recognition` (read) · `recognition_nominate` · `recognition_decide` · `recognition_admin` (definitions, corrections, publication). Add a `public` scope above `school`. Add deny-group `recognition_private` (nominator, rationale, evidence, `derived_from`) stripped for non-reviewers.

### 11.2 Role mapping

| Role | Read | Nominate | Decide | Admin |
|---|---|---|---|---|
| superadmin | all (audited support only) | — | **no school authority from platform role** | platform config |
| platformsupport | public items, read-only | — | — | — |
| headmaster | school | staff, school | staff, school, colours | — |
| sportsmaster | school | colours, season | colours, season, team | definitions, publication |
| schooladmin | school | — | — | definitions (display, visibility); cannot bypass conflicts |
| headcoach | school | player awards | match and season player awards | — |
| coach | own team(s) | own team | Player of the Match, own team (§9.1) | — |
| assistant | own team(s) | — | — | — |
| analyst | school, `pii` denied | — | — | — |
| scorer | own matches | Player of the Match for matches scored | — | — |
| medical / groundskeeper / driver | own recognition | — | — | — |
| player | own + permitted team items | — | — | — |
| parent | linked child, per sharing policy | — | — | sharing settings where delegated |
| spectator | published items only | — | — | — |
| financeadmin | none | — | — | — |

A person holding several roles has one history, scoped by the relevant permissions. A nominee never decides on their own nomination.

**Match captain** is a match-level role from the team sheet (P5), not a system role. A captain gets a time-limited `recognition_nominate` grant for Player of the Match on that match only, for their own team, never for themselves. The grant ends when the match award is decided or after the school's window closes.

### 11.3 Tenancy and sharing

- Add `tenant_id` to every table; tenant-aware foreign keys; the server validates evidence and recipient IDs (a client-supplied ID proves nothing). **Decided:** the owning school's `organisation_id` is the tenant. Each school is its own data wall. A fixture between two schools stays visible to both only through explicit sharing (next bullet), so a cross-school match never silently exposes one school's private evidence to the other.
- A shared fixture needs explicit access for participating schools and the competition operator. A visible scorecard does not grant access to medical, welfare or nomination evidence.
- Publication does not publish supporting documents; return a redacted evidence summary. Cards and exports obey the same field-level rules as the UI.
- Recognition earned at a previous school keeps its original context; portable history carries approved receipts only. Retention and deletion apply to evidence, projections and exports.

### 11.4 POPIA (minors)

- Within school (team / school audience): allowed under the school's existing consent.
- **Public, cross-school, and any photo: off by default.** Opt-in per child by guardian; revocable. Revocation hides the item everywhere and does not delete the underlying fact.
- Public cross-school items name a child only where the child's school is on SCRBRD and consent exists; otherwise anonymised ("Hilton U15A player").
- Parent alerts ("your child scored a fifty") use **confirmed** achievements only.

---

## 12. Data model

Extends the unified person, fixture and role-assignment model. Awards, achievements and records are queryable through one read view, without forcing them into one generic value field.

```sql
recognition_definitions (
  definition_id PK, tenant_id, code, kind,            -- award|achievement|accolade
  sport, title, description, version, effective_from, effective_to NULL,
  eligibility_json, criteria_json,
  awarding_authority, publication_defaults, grant_mode,   -- derived|nominated|discretionary
  nominator_roles text[], decider_roles text[]
)

recognitions (
  recognition_id PK, tenant_id, definition_id FK, definition_version,
  fixture_id NULL, season_id, competition_id NULL, occurred_at,
  verification_status, publication_scope,
  decision_by NULL, decision_at NULL, citation NULL,
  source_revision, reducer_version,
  logical_occurrence_key UNIQUE, evaluation_key
)

recognition_recipients (
  recognition_id FK, recipient_id PK,
  person_id NULL, team_id NULL, school_id NULL, fixture_id NULL, competition_id NULL,
  role_assignment_id NULL, affiliation_snapshot,
  CHECK (exactly one of person_id, team_id, school_id, fixture_id, competition_id is NOT NULL),
  UNIQUE (recognition_id, person_id, team_id, school_id, fixture_id, competition_id)
)

recognition_evidence (
  evidence_id PK, tenant_id, recognition_id FK,
  evidence_level,                                        -- §6
  source_type,                                           -- allow-listed
  source_id, source_version, source_hash,
  verification_by, verification_at,
  redacted_summary, access_policy
)

record_definitions (
  record_definition_id PK, tenant_id, version, sport, metric,
  cohort, scope_type, format, age_division_id,
  fixture_class_group,                                   -- school_records | inter_house | friendly; part of the record key (§5.4); null blocks confirmation
  qualification_json, comparison, tie_policy, coverage
)

record_entries (
  record_entry_id PK, tenant_id, record_definition_id FK, definition_version,
  performance_key, performance_date, fixture_division_id,
  value_components_json,                                 -- numerators / denominators, legal balls
  source_revision, reducer_version, verification_status
)

record_entry_recipients ( ...same recipient shape and constraints as recognition_recipients... )
record_entry_evidence   ( evidence_id PK, record_entry_id FK, source_type, source_id,
                          source_version, verification_by, verification_at, access_policy )

recognition_nominations (
  nomination_id PK, tenant_id, definition_id FK, proposed_recipient_json,
  context_json, nominated_by, rationale, status,        -- proposed|in_review|decided|withdrawn
  conflict_checked_at, reviewer_id NULL
)

recognition_revisions (
  revision_id PK, tenant_id, target_type, target_id, version,
  action,                                                -- decide|correct|invalidate|publish|unpublish|supersede
  actor_id, reason, source_revision, occurred_at
)

recognition_consents (
  consent_id PK, tenant_id, person_id FK,                -- the child
  granted_by_person_id FK,                               -- guardian, or the person if an adult
  scope,                                                 -- school_name|public_name|public_photo|public_stats
  granted_at, revoked_at NULL
)
```

Derived views and replaceable projections (never truth): current record standings, honour boards, trophy cabinet, per-person recognition. Keep eligible `record_entries` so ties, corrections and former holders can be recomputed. Record evaluation records provenance across the **whole comparison dataset**, not only the winning performance.

Required scoring schema additions come from §7 (P2–P5): `dismissed_batter_id`, `fielder_ids`, ball `id` + `recorded_at`, fixture class, result status, `balls_per_over`, Laws / playing-conditions reference, `is_pilot`, match captain.

Audit: all decisions, corrections, invalidations, publication changes write to `recognition_revisions` and the existing `audit_logs`.

**Migration (decided 2026-10-07: these are part of the prototype and mostly derived).** My audit found no stored `awards`, `accolades` or `milestones` tables in `scrbrd_os.jsx`: milestones exist only as the derived live overlay (`detectMilestone`, L9028), and there are no award records. So there is **nothing to migrate row by row**:
- **Milestones:** recompute from verified ball events; do not copy overlay output. No second history counter.
- **Hand-entered stats** (`careerTotals`, `avg`, `sr`, `wkts`, L150+): import as "reviewed historical document" evidence at most, never as verified achievements.
- **Staff certificates** (e.g. `qualifications:["CSA Certified Scorer (Level 2)","ECB Scoring Award"]`, L502): import as certificate evidence for accreditation recognition.
- **Player representative selection** in free-text bios: import only as unverified submissions awaiting review.
- Finance and reward ledgers stay outside this module.

---

## 13. UI placement (inside existing tabs)

Follow `scrbrd_ci.html`: dark-first, five surface tiers, Syne headings, DM Sans copy, DM Mono figures, 4px grid, grain overlay on full-screen surfaces. Animations brief and honour reduced-motion.

**Badges and icons, not colour (decided).** No honour accent colour in V1; school colours come later and are out of scope now. Recognition is identified by a **monochrome badge** drawn with existing text and surface tokens, always paired with a text label.

| Badge | Meaning |
|---|---|
| Rosette | Award |
| Milestone pin | Achievement |
| Laurel | Record |
| Upward chevron | Personal Best |
| Quote mark | Accolade |

State is carried by **form**, not hue: solid outline = confirmed; dashed outline = tentative / provisional; history mark = former holder. Invalidated items do not appear on public surfaces. Tier (if used) is shown as pips or rings, not metal colours. The existing live overlay uses emoji icons (🏏 💯 🎩 etc., L9035–9046); replace them with this badge set in the UI phase. Final glyph artwork is a design task; this spec fixes only the semantics.

| Surface (tab) | Content |
|---|---|
| Wicket Hub | Quiet tentative cue, labelled "Tentative". Scoring stays primary. Existing `EventOverlay` reads `deriveFacts` |
| Match Centre | Player of the Match; confirmed milestones; records set or equalled in that fixture |
| Profiles / Player Passport | Honours timeline; personal bests; role filters; selected public items |
| Squad / Team | Team achievements and trophies; eligible player honours |
| Dashboard | Recent confirmed milestones (player); linked child's honours (parent, per sharing policy) |
| Competitions | Season awards; record holders; historical editions (V2 for records) |
| Staff | Role-specific verified service and qualifications |
| Management | Definitions; pending review; nominations; evidence; conflicts; corrections; publication settings |

Every recognition card shows title, recipient, type, date, role or entity context, scope and verification state. Detail view shows criteria, permitted evidence, awarding authority and correction history appropriate to the viewer. Mobile: compact filters, readable cards, full-width detail; expandable record rows rather than shrunk tables. Search results keep their scope when opened or shared.

No unexplained overall rating in V1. A public rating needs a documented method, adequate data and appropriate comparisons. Prefer transparent stats and a small set of honours.

---

## 14. Phasing

**Phase 0 — scorer correctness (blocks everything).** P1–P8. Includes ball IDs, structured dismissals, fixture class and Pilot flag.

**Phase 1 — V1 launch.**
- Player of the Match (coach or captain, with system suggestions; §9.1).
- Half and Full Colours (standardised; §9.2).
- Verified 50 and 100 achievements; five-wicket hauls.
- Appearance milestones.
- Personal bests: highest innings, best bowling.
- Team and school honour boards.
- Scorer "matches scored" (derived).
- Discretionary staff and school awards with evidence.
- Revisions, evidence, corrections, publication, consents.

**Phase 1b — after P4.** School records by format and division; season totals; economy and strike-rate records with published qualification.

**Phase 2 — V2.** Fielding and keeping; hat-trick (after validated contract); leadership; sequence-based and partnership records; match and competition awards; regional comparisons; Scout, umpire, competition authority, volunteer; Fans' Choice; staff counters where source modules are real; scout-facing layer.

Build order within phases: pure `deriveFacts` + tests in `scrbrd-backend/` (pure Node ESM, extend the 260-assertion suite) → schema → engine → RBAC and consent → UI.

---

## 15. Acceptance scenarios

| Scenario | Expected |
|---|---|
| Batter 98 → 104 | One century with threshold evidence |
| Century innings crosses 50 | Both crossings on the timeline; season fifty-innings total does not double-count |
| Scorecard corrected 100 → 99 | Century invalidated; totals and records rebuild; audit retained |
| Offline event submitted twice | One honour, one notification |
| Highest score equalled | Joint holders; both performances retained |
| Better performance confirmed | New current holder; previous becomes former holder |
| Historical innings has a total but no sequence | Total-based recognition only; no inferred fastest century |
| Unknown fielding attribution | No invented catch or run-out |
| **Run-out dismissal** | **Bowler not credited; no bowler milestone** |
| **Non-striker run out** | **Non-striker recorded as dismissed** |
| Coach also has admin privileges | Cannot approve own nomination |
| Person holds several roles | One history, correct role context and scoped permissions |
| Public card opened by spectator | Only published fields and permitted evidence summaries |
| School submits another tenant's source ID | Server denies link or read |
| Staff award references medical work | Approved service wording only; no patient information |
| Backdated result changes a career milestone | Chronology updates; milestone not awarded twice |
| No minimum for an economy record | Record stays disabled |
| "All-time" label with incomplete coverage | UI uses bounded verified-history label |
| **Pilot Match played, then promoted** | **No recognitions before promotion; one full evaluation on promotion** |
| **Opposition or typed-in player scores 60** | **Appears on scorecard; no achievement, no career record** |
| **Child's public name without guardian consent** | **Shown anonymised or school-only** |
| Consent revoked | Item hidden everywhere; fact retained |
| Hat-trick overlay fires live | Tentative display only; never persisted or published |

---

## 16. Decisions

### Resolved (2026-10-07)

| # | Question | Decision | Where applied |
|---|---|---|---|
| 1 | Colours criteria | **Standardised now, configurable later** | §4.1, §9.2 |
| 2 | Player of the Match decider | **Coach or captain, with system suggestions** | §9.1 |
| 3 | Staff recognition split | **Confirmed:** derived where a source module is real (scorer matches-scored); discretionary plus evidence otherwise | §4.3 |
| 4 | Tenant key | **Owning school's `organisation_id`** (accepted) | §11.3 |
| 5 | Honour accent colour | **No colour. Monochrome badges and icons for now.** School colours later | §13 |

### Resolved in the second round (2026-10-07)

| # | Question | Decision | Where applied |
|---|---|---|---|
| 6 | Colours rubric | **Follows SCRBRD OS.** OS has none, so the rubric is an evidence checklist with no thresholds; Colours are never automatic | §9.2 |
| 7 | Captain-only Player of the Match | **Yes:** a captain's pick is a nomination that the coach confirms with one tap | §9.1 |
| 8 | Player of the Match scope | **Yes:** own team only in V1 | §9.1 |
| 9 | Backend `awards` / `accolades` / `milestones` | **Part of the prototype and mostly derived.** Nothing to migrate row by row | §12 |

### Resolved in the third round (2026-10-07)

| # | Question | Decision | Where applied |
|---|---|---|---|
| 10 | Fixture classes | **Fixture-class data is kept separately from school records.** Separate boards per class group; never merged | §5.4, §12 |

### Still open

1. **Friendly / practice class:** the prototype has none. I have assumed it is added to match setup (Phase 0, P4). Tell me if not.
2. **Marked [Proposed] in §5.4** (not yet confirmed): external tournaments feed School Records; DLS, abandoned and super-over matches have no board in V1; personal bests are tracked per class group with the School Records one as the profile headline.
