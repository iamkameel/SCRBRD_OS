# Who sees a child's data — one map across every design

Status: **design, for Kameel's review** (Fable, 21 Oct 2026). Built from the reader sections of every design on `origin/main` at ab79828, the policy code in `packages/policy/src/`, and the decisions already recorded. Nothing here reopens a decision Kameel has made; where two decided texts disagree, that is a finding (§4). Opus builds from this; Haiku records the answers.

Every line cites `file:line` on that commit. No child's name or data appears; the roles are the readers.

---

## 0 · In one page

Every design already stands on the same eight rules. They are stated here once so the map below can say "agrees" in a word.

1. **A capability in a scope, never a role name.** One assignment answers every read; a guardian's names her children, a pupil's `selfaccess` names him, a coach's names a side (`REACH_parent_pupil.md:13-26`, ADR 0001, ADR 0003). The captaincy is an honour and opens nothing (`SCRBRD-138_captains_view.md:85`).
2. **The family reads the child as a person; the side reads the side; nobody reads another boy as a person.** Of a team-mate a parent or pupil knows what the sheet and the scorecard say (`REACH_parent_pupil.md:21-22, 193`).
3. **Health is in tiers.** Status (out, until when) for the side's adults; nature (what, how bad) for coaches, the manager, the director; the clinical words for the physio, the family and the boy; nothing medical to a team-mate, a spectator, a scorer or the public (ADR 0002; `GA-I19_medical_review.md:100-111`; `SAFEGUARDING_DSO.md:646-654`; PUBLIC_DATA N2).
4. **A judgement stays with the adults who made it.** The boy reads his scores and targets, never the prose; his parents read neither; the public never (`GA-I26a_assessment_history.md:191-205`; `GA-I27_coach_cards.md:121-122`).
5. **Safeguarding is the DSO's alone.** A share is a recorded act with an expiry; a parent has no standing read; the owner's key and every support session read nothing (`SAFEGUARDING_DSO.md:20-36, 414-426, 491-495`).
6. **Public is initial and surname with consent, team level for everything else; a "no" is immediate and reaches the past** (`docs/policy/PUBLIC_DATA.md:19-42, 69-100`).
7. **Every restricted read is logged, a parent may ask who read, and a push carries a pointer and no name** (`INCIDENTS_AND_BREACHES.md:531-544`; `NOTIFICATIONS.md:261-270`).
8. **Nothing widens by the clock; an ending is an act; a "no" from anyone competent wins** (`SCRBRD-110_workload.md:561-562`; `SCRBRD-124_lift_clubs.md:473`; `SEASON_ROLLOVER.md:440`).

**Found:** 9 conflicts between decided texts (§4), 12 cells no design decides (§5), 13 places the code seems to differ from the designs (§6), and 16 questions for Kameel (§7). The three that matter most: the parent of an eighteen-year-old at school (two designs still end her reads on the birthday; the signed-off rule keeps them open); `audit.read` opening reasons four designs say the DSO and the office never see; and a departed boy's clinical record (one design cuts the physio off, one keeps her on).

---

## 1 · The data classes

Sensitivity is `capabilities.mjs:487-600`'s scale: 0 public, 1 internal, 2 restricted personal, 3 highly sensitive, 4 ultra-restricted. "Table" is where the rows live on main; "none yet" means the design is not built.

| # | class | what it holds | level | table (capability) |
|---|---|---|---|---|
| A | **Roster identity** | name, team, playing role, styles, age group | 1 | `player` masked row (`player.profile.read`; roster-wide under `player.roster.read`, `tables.mjs:124-139`) |
| A2 | **Date of birth** | `born`, exact age | 2 | `player.born` (`player.age.read`) |
| A3 | **ID number** | `id_number` | 4 | `player.id_number` (`player.identity.read`) |
| A4 | **Contact and home** | email, phone, address, guardian text, hometown, boarding house | 2 | `player.*` (`player.pii.read`) |
| A5 | **Body measures** | height, weight | 3 | `player.height/weight` (`player.biometric.read`) |
| B | **This match's figures** | the log, the scorecard, the board | 0 | `ball_event` (`fixture.read`, both anchors, `SCRBRD-136-137_away_visibility.md:74-84`) |
| B2 | **Career and season figures, per boy** | `career`, `career_by_season`, wheel, dismissal breakdown, matchups | 0 in code (see §6 X7) | views over `ball_event_career` (`player.performance.read`) |
| C | **Availability** | the answer, who said it, `reason_kind`, `note` | 2 | `match_availability`, `_history` (`availability.read`) |
| D | **The team sheet** | the eleven, order, the captain mark (SR-6, not built) | 1 | `match_squad` (`player.profile.read`, per side); `fixture_sheet()` for the family (REACH R-H, not built) |
| E | **Honours and recognition** | honours, caps, milestones, bests, records; withdrawn mark; `withdrawn_reason`; nominations | 0–3 | `honour` (`player.profile.read`); reason masked (`recognition.decide`, design); nominations: none yet |
| F | **Injury** | status / nature / clinical words; reviews; the worklist | 2 / 3 / 4 | `injury` masked (`medical.status/nature/details.read`); `injury_review`: none yet |
| G | **Workload** | overs, nets band, breaches, the directive figures | 2 | `load_entry`, `bowling_breach`, `bowler_over` (`player.workload.read`) |
| G2 | **Wellness** | check-ins, flags, capacity tests, technique reviews, guidelines, plans; the parent share | 3 | `health_monitoring_consent` on main; the rest none yet (`wellness.read`, under the health consent) |
| H | **Assessment** | skill scores and their history, targets | 1 | `player_skill`, `development_target` (`player.development.read`) |
| H2 | **Coach's prose** | notes, coaching points | 3 | `development_note` (`player.note.read`) |
| I | **Conduct** | disciplinary records, the umpire's report | 3 | `disciplinary_record` (`discipline.read`) |
| J | **Safeguarding** | concerns, reporter, notes, shares, suspension, the lift bar | 4 | `safeguarding_concern`, `_reporter`, `_note`, `_share` (`safeguarding.concern.read`); suspension and bar: none yet |
| K | **Consents** | terms on the link; public name; health monitoring; scouting; passport; media (K1, none yet) | 2 | `assignment_subject`, `public_name_consent`, `health_monitoring_consent`, `player_scouting_consent`, `passport_consent` (office under `guardian.link.manage`; the family through definers) |
| K2 | **Never-public mark and its reason** | `player_never_public` | 3 | (`player.public.withhold`) |
| K3 | **Links and family** | who his guardians are, link state, dates; the revocation reason | 2 | `assignment_subject`; `guardian_link_ending`: none yet |
| L | **Emergency contacts** | who to ring and their numbers | 2 | `emergency_contact` (`player.emergency.read`) |
| M | **Public pages** | his label (initial and surname, or "Batter"), milestones on the live page, public honours | 0 | `public_*()` functions (PUBLIC_DATA) |
| N | **Transport and lifts** | the bus (`trip`, its `notes`), lift offers, seats, marks, driver's declarations | 1–2 | `trip` (`transport.read`); `lift_*` (`transport.lift.*`) |
| O | **Notices** | each kind's rows about him or his side | per kind | `notification` (`news.read` + the kind's capability) |
| P | **Messages and the plan** | team posts, the fixture plan | 0 | `news_post` (`news.read` at the side) |
| Q | **Scouting and opposition** | `scouting_candidates()`; `opposition_squad()` in the window | 1–2 | (`scouting.read`; `opposition.read`, logged) |
| R | **Account state** | active or disabled; the reason; sessions | 1 | `app_user`, `account_status_change` (`user.read`; reason under `user.invite` or `audit.read`) |
| S | **The access log** | who read his record | 1 (hidden rows: 4) | `access_log` (`audit.read`; safeguarding rows cut, `SAFEGUARDING_DSO.md:446-451`) |
| T | **Scorebook photos** | pages with two schools' children's names in handwriting | 1 | `scorebook_import_page` (`scoring.import.read`, logged, purged) |
| U | **Training register** | attended or not, per session | 1 | `training_attendance` (`player.profile.read`, side-shared) |
| V | **Data events** | a breach or outage naming him among its subjects | — | `data_event`, `_subject`: none yet (`compromise.read`; `audit.read` at the school) |

---

## 2 · The readers

| reader | role or shape | scope |
|---|---|---|
| **Parent** | `guardian` | her own children by name (`assignment_subject`), school-wide team NULL; her child's side through him (`REACH_parent_pupil.md:70-76`) |
| **Pupil** | `player` (side) + `selfaccess` (himself) | the side through `player`; himself at every tier his bundle holds through `selfaccess` (`roles.mjs:340-345, 386-396`) |
| **Pupil captain / vice-captain** | an honour, not a role (ADR 0003) | exactly `player`'s reads, re-arranged (`SCRBRD-138_captains_view.md:85`) |
| **Coach, assistant coach** | `coach`, `assistantcoach`, team-scoped | his side's boys; the school's roster at roster tier (`tables.mjs:137-139`) |
| **Team manager** | `teammanager`, team-scoped | the side; no load, no judgement |
| **Physio** | `medical`, school-scoped | every injury row at the school; the load; wellness under consent |
| **S&C coach** | `fitness`, school-scoped | load, check-ins, tests; status and nature; never the physio's notes |
| **DSO** | `dso`, tenant-scoped | concerns; clearances; the log; the never-public mark; names of children, adults and fixtures |
| **Office** | `schooladmin`, school-wide | the file (PII, DOB, ID, contacts), links and consents, status and nature, conduct; not the judgement |
| **Sports administrator** | `sportsadmin` | the office's operational half: roster, availability, sheet, status and nature, DOB, lifts oversight |
| **Director of sport** | `directorofsport`, school-wide | everything a coach reads, school-wide, plus conduct, wellness on request, contacts, honours deciding |
| **Principal** | `principal`, school-wide | notes and conduct, status and nature, DOB, links, the mark; not scores, not availability |
| **Analyst** | `analyst`, school-wide | roster and figures; no judgement, no health, no age |
| **Media** | `media`, school-wide | roster and figures; publishes news |
| **Scorer** | `scorer`, usually one fixture; may be a pupil | the sheet and the sporting profile behind it, nothing else (`roles.mjs:306-321`) |
| **Official / umpire** | `official` | the fixture; writes the umpire's report |
| **Spectator** | `spectator` | fixtures, results, the signed-in scorecard, posts; never a boy as a person |
| **Enquiry** | `enquiry`, one named boy, time-boxed | a coach-to-coach grant: profile and status (`roles.mjs:365`) |
| **The other school** | no role: `match.away_school_id` on `match` and `ball_event` | their own people read our fixture's log and scorecard; staff read our squad through the dossier in the window, logged |
| **League organiser** | `competitionadmin` | the competition; results; conditions; confirms imports and amendments |
| **Platform owner** | `superadmin` | everything outside `safeguarding.*`, unlogged (`roles.mjs:108`) |
| **Platform / support** | `platformadmin`; a support session borrowing one role for an hour | no school data by standing; the session reads as the role, logged, cut from wellness, safeguarding, imports, lifts |
| **Driver / transport coordinator** | `driver`, `transportcoordinator` | the bus; the coordinator oversees lifts in counts and exceptions |
| **Scout** | `scout`, accredited | `scouting_candidates()` for consented boys only |
| **The public** | signed out | `public_*()` only |

The information officer (Kameel) is not a role; his reads are the owner key's (`INCIDENTS_AND_BREACHES.md:221-225`).

---

## 3 · The map, class by class

Each table lists the readers who **may**, with the condition and the source. The line under it says who may not, where a design says so in words. "Undecided" means no design and no code line settles it (§5 ranks these). "Logged" means `log_restricted_read()` writes an `access_log` row. Where the designs agree the row says so in one word.

### A · Roster identity (name, team, role, styles, age group)

| reader | may | condition | source |
|---|---|---|---|
| parent | yes | her own child; a team-mate's name only on the sheet and scorecard | `REACH_parent_pupil.md:70` |
| pupil | yes | himself; team-mates' masked rows at the side | `REACH_parent_pupil.md:80`; `RECOGNITION_reconciliation.md:103` |
| coach, assistant, manager | yes | own side's masked rows; every child at the school at roster tier (exists, team, role, age) | `tables.mjs:128-139, 164-168` |
| physio, S&C, director, office, sportsadmin, principal, analyst, media, DSO | yes | school-wide, masked row | `roles.mjs` bundles |
| scorer | yes | the fixture's sheet and the sporting profile behind it | `roles.mjs:306-321` |
| other school's staff | yes | our named squad, cricket columns only, inside five days before the fixture, logged against us | `SCRBRD-136-137_coach_cockpit_and_feed.md:176-182` |
| other school's family and spectators | yes | names on the scorecard and log of the shared fixture, as the pad wrote them | `SCRBRD-136-137_away_visibility.md:17, 174` |
| spectator (own school) | no as a person; names on the signed-in scorecard | | `REACH_parent_pupil.md:90` |
| public | label only | initial and surname with consent, else "Batter"; never a full name, first name or photo; age group stays | `PUBLIC_DATA.md:26-30, 73` |

Nobody else. Agreed everywhere.

### A2–A5 · Date of birth, ID number, contact and home, height and weight

| reader | may | condition | source |
|---|---|---|---|
| parent | yes, all four | her own child (`player.pii/age/identity/biometric.read`) | `roles.mjs:401-416` |
| pupil | yes, all four | himself through `selfaccess`; **not** his own emergency contacts (L) | `roles.mjs:386-396`; `STEP4_parent_pupil.md:643` |
| office | yes, all four | school-wide; the only staff reader of the ID number | `roles.mjs:214-215`; `tables.mjs:147-152` |
| coach, assistant, manager, director, principal, sportsadmin | DOB only | `player.age.read`; roster-wide for selection | `tables.mjs:164-168` |
| physio, S&C | DOB and body measures | clinical inputs | `roles.mjs:436-439, 458-460` |
| DSO | **no**, by standing | reaches a family only through `safeguarding_family()` on an open concern, logged; the age band is computed inside the referral | `SAFEGUARDING_DSO.md:142-148, 499-505`; `roles.mjs:517-519` |
| other school, analyst, media, scorer, spectator, public | never | N1, N4 | `PUBLIC_DATA.md:73-78`; `SCRBRD-136-137_away_visibility.md:154` |

Agreed everywhere. One thing undecided: the pupil reading his **own** ID number on his phone (G12).

### B · This match's figures (the log, the scorecard)

| reader | may | condition | source |
|---|---|---|---|
| anyone with `fixture.read` at either anchor | yes | the fixture's host school and team, or its away school and team: staff, pupils, parents (through a child on the side), spectators of both schools | `SCRBRD-136-137_away_visibility.md:74-84, 162-181` |
| parent | yes | her child's side's fixtures only, home and away; not the school's other matches (REACH-D1) | `REACH_parent_pupil.md:372` |
| a boy playing up, and his parents | yes, that fixture | the sheet branch of `fixture_reach()` | `REACH_parent_pupil.md:82` |
| a newcomer to a side | no, for fixtures before he joined; a parent the same | dated reach (SR Q2) | `SEASON_ROLLOVER.md:115, 522` |
| public | team level and labels | once the school publishes; no official, weather, pitch, note, reason, photo | `SCRBRD-083_public_pages.md:340-360` |

What the log never carries about a boy: age, limit, injury, reason, note (`SCRBRD-136-137_away_visibility.md:140-158`). Agreed everywhere.

### B2 · Career and season figures, per boy (the dossier)

| reader | may | condition | source |
|---|---|---|---|
| parent | yes | her own child only; **not** a team-mate's; never her two children side by side | `STEP4_parent_pupil.md:227` (via REACH M5); `GA-I24-I25_compare_and_combine.md:51` |
| pupil | yes | himself; **and his current side's team-mates** (REACH-D2, Kameel chose "leave them open", 14 Oct); after a move, the old side's no longer | `REACH_parent_pupil.md:373`; `GA-I27_coach_cards.md:121`; `SEASON_ROLLOVER.md:127, 135` |
| pupil captain | as any pupil | the side's season table on his Captain section; himself v one team-mate; never two team-mates against each other | `SCRBRD-138_captains_view.md:126-129`; `GA-I24-I25_compare_and_combine.md:49, 71` |
| coach, assistant, manager, director, principal, analyst, media, office | yes | `player.performance.read` in their scope; compare and the workspace only under `analytics.read` (coach, analyst, director, principal, office) | `GA-I24-I25_compare_and_combine.md:55, 69-73` |
| other school's staff | yes, in the window | `opposition_squad()`'s aggregates, five days, thirty-ball floor, logged; a named bowler v our batter never | `GA-I24-I25_compare_and_combine.md:41-43` |
| other school's family | never | `player.performance.read` per boy | `SCRBRD-136-137_away_visibility.md:176` |
| scout | yes, consented boys | `scouting_candidates()`: name, team, career figures | `roles.mjs:491-501` |
| public | never | A3, A4: no player page, no leaderboard, no figure for one child across matches | `PUBLIC_DATA.md:57-58`; `GA-I24-I25_compare_and_combine.md:76` |

Agreed, with one decided asymmetry worth saying plainly: a pupil reads a team-mate's season figures and a parent does not (`REACH_parent_pupil.md:373`, the alternative taken). Skills, ratings, health, load, availability, age and discipline never enter a comparison (`GA-I24-I25_compare_and_combine.md:39`).

### C · Availability (the answer, who said it, the reason)

| reader | may | condition | source |
|---|---|---|---|
| parent | yes | her own child; reads and declares | `roles.mjs:402` |
| pupil | yes, his own | `selfaccess`; declares through `player`; a team-mate's never, not even a count | `SCRBRD-138_captains_view.md:200-202, 316` |
| coach, assistant, manager, director, office, sportsadmin | yes | own side (staff) or school-wide (office); the cockpit shows status, who, when; `reason_kind` and `note` stay on the Squad screen | `SCRBRD-136-137_coach_cockpit_and_feed.md:190, 207` |
| principal | no | holds no `availability.read` | `GA-I09-I11_match_day_queue.md:45` |
| physio, S&C, analyst, scorer, spectator, other school, public | never | N2: "unavailable" is health | `PUBLIC_DATA.md:74-75`; `GA-I24-I25_compare_and_combine.md:88` |

Agreed everywhere. The reason is "between the family and the coach" (`GA-I20_parent_action_list.md:214`).

### D · The team sheet

| reader | may | condition | source |
|---|---|---|---|
| the side's staff and pupils | yes | `match_squad` per side, names and order | `REACH_parent_pupil.md:199` |
| parent | yes, once published | `fixture_sheet()`: names and order, no id, no profile, no age, no photo (STEP4 Q10, decided 27 Sep; not built) | `STEP4_parent_pupil.md:626-629`; `REACH_parent_pupil.md:197-199` |
| scorer | yes | the fixture's sheet | `roles.mjs:309-311` |
| other school | no | per side; they read their own sheet | `SCRBRD-136-137_away_visibility.md:128, 177` |
| spectator | no | no `player.profile.read` | `REACH_parent_pupil.md:199` |
| public | never before the innings; then the squad's labels in the log | A7 | `SCRBRD-083_public_pages.md:384-388` |

The captain mark (SR-6) is read as the sheet is and is never public (`SEASON_ROLLOVER.md:395-397`). Agreed.

### E · Honours, achievements, bests, records, nominations

| reader | honours | withdrawn honour | the reason | records | nominations | source |
|---|---|---|---|---|---|---|
| pupil | his own and the side's board | his own, "withdrawn · date" | no | his own standing, as a chronology | his own captain's pick | `RECOGNITION_design.md:91, 115, 117` |
| team-mate | the side's board | absent | no | the side's board as pupils see it | never | `:92` |
| parent | her child's | "withdrawn · date" | no | her child's standing | never, not even that he was nominated | `:94` |
| team-mates' parents | the side's news only | no | no | no | never | `:95` |
| coach, assistant, manager | yes | yes, with date | only the withdrawer | the full board | the side's | `:96` |
| director, principal (`recognition.decide`, design) | yes | yes | yes | full | all at the school | `:97` |
| office (`recognition.manage`) | yes | yes | **no** unless it withdrew — but see conflict 2 | full | all, read | `:98` |
| analyst, media | yes | no | no | full | never | `:99-100` |
| DSO | yes | **matrix says yes; D3 says absent** (conflict 6) | through the audit on a concern | no | through the audit on a concern | `:102, 115` |
| other school | passport lines only, with `passport_consent` | no | no | never | never | `:103` |
| league organiser, platform roles | no | | | | | `:104, 106` |
| public | A5: `is_public` and named by L2; a never-public boy is absent, not "Player" | never | never | never (A3, A11) | never | `:107, 145-157` |

The citation is read by team-mates and is public only when the boy is named (`RECOGNITION_design.md:113, 155`). Honours stay on the side they were awarded for after a move (SR-8, `SEASON_ROLLOVER.md:352`).

### F · Injury (status / nature / clinical words; reviews; the worklist)

| reader | tier | condition | source |
|---|---|---|---|
| parent | every tier, reviews included | her own child; her read continues at 18 while he is at school and after he leaves until his birthday | `GA-I19_medical_review.md:107, 196`; `ACCOUNT_LIFECYCLE.md:423-429` |
| pupil | every tier | himself; **no team-mate's row, not even status** (K3, db/55) | `GA-I19_medical_review.md:108`; `roles.mjs:325-333` |
| physio | everything at her school; the worklist | `medical.write`; a departed boy: **conflict 3** | `GA-I19_medical_review.md:102, 194` |
| coach, assistant | status and nature | own side, current side only; the cockpit shows status alone | `roles.mjs:241-256`; `SCRBRD-136-137_coach_cockpit_and_feed.md:191-192` |
| team manager, sportsadmin, office, director, S&C | status and nature | as the bundles hold them | `GA-I19_medical_review.md:104-106` |
| principal | **design says status; code gives nature too** (§6 X1) | | `GA-I19_medical_review.md:105`; `roles.mjs:166` |
| enquiry (a coach granted one boy) | status | out or not, until when; never what is wrong | `SAFEGUARDING_DSO.md:660-662` |
| DSO | **none**; the SG-12 notice says "a serious injury", no name | holds no `medical.*` | `GA-I19_medical_review.md:109, 125` |
| a former coach after a move | none | current-side anchoring; SR Q8 | `SEASON_ROLLOVER.md:165, 528` |
| support session | `injury` as today, logged; `injury_review` hidden | | `GA-I19_medical_review.md:110, 325` |
| scorer, spectator, analyst, media, scout, other school, public | nothing | N2 | `GA-I19_medical_review.md:111` |

Agreed except the two rows marked.

### G · Workload (overs, nets band, breaches) and G2 · Wellness (check-ins, flags, tests, guidelines)

| reader | load (G) | wellness (G2) | condition | source |
|---|---|---|---|---|
| pupil | his own, every row | his own: check-ins, flags, tests, reviews **without** the coach's notes, guidelines, every share about him | `selfaccess`; not logged | `SCRBRD-110_workload.md:479, 285` |
| parent | **no** standing read | **no**; only a `wellness_share` opened through the function, 14 days (30 at most), logged; her own recorded check-ins (Q15) | `guardian` holds no `wellness.read`, no `player.workload.read` | `SCRBRD-110_workload.md:451-469, 742` |
| coach, assistant, physio, S&C, director | yes | yes; every read of check-ins and flags logged; the director reads on request and is not alerted | under the health consent; `RESTRICTIVE` hides rows without a live consent | `SCRBRD-110_workload.md:285, 543, 685-691`; `roles.mjs:257-259, 281-282, 435-442, 457-464, 203` |
| team manager | no | no, and no sign one exists | | `GA-I27_coach_cards.md:118` |
| team-mate, captain | never | never | | `SCRBRD-110_workload.md:483`; `SCRBRD-138_captains_view.md:211` |
| other school | never; his age band and limit come back null | never | | `SCRBRD-136-137_away_visibility.md:148-150` |
| support session | load yes, logged | **never** (RESTRICTIVE) | | `SCRBRD-110_workload.md:484` |
| public | the overs on the scorecard only | never; a breach is never public | | `PUBLIC_DATA.md:152` |

Agreed everywhere. Match overs are not under the health consent; check-ins and anything about his body are (`SCRBRD-110_workload.md:498-500`).

### H · Assessment (scores, history, targets) and H2 · Coach's prose (notes, coaching points)

| reader | scores and targets | notes and points | source |
|---|---|---|---|
| pupil | his own, every row, the trend | **never** | `GA-I26a_assessment_history.md:199` |
| parent | never | never | `:200` |
| coach (current side) | reads and writes | reads and writes | `:194` |
| assistant | reads | reads; writes a plain note, not a point | `:195` |
| former coach, while both are at the school | read-only, rows dated in his time with the boy | the same | `SEASON_ROLLOVER.md:157-168` |
| director | reads school-wide | reads | `GA-I26a_assessment_history.md:196` |
| principal | **no** | reads | `:197` |
| team manager, office, analyst, captain, other school, scorer, public | never | never | `:198-205` |
| support session | never (RESTRICTIVE) | never | `:206` |

Agreed everywhere. A coaching point never reaches a pupil or a parent (`GA-I27_coach_cards.md:133`).

### I · Conduct and discipline

| reader | may | condition | source |
|---|---|---|---|
| pupil | yes, his own | on request, behind a tap, never on Home (STEP4 Q6) | `STEP4_parent_pupil.md:630, 642` |
| parent | **no** | `guardian` holds no `discipline.read`; the school tells parents by letter (STEP4 Q5, "not in step 4") | `STEP4_parent_pupil.md:641` |
| director, principal, office | yes | school-wide | `roles.mjs:166, 188, 218` |
| coach, assistant, manager | **no** | | `SCRBRD-136-137_coach_cockpit_and_feed.md:197`; `roles.mjs:257-304` |
| umpire | writes the report | `discipline.write` | `roles.mjs:322` |
| league organiser | **holds `discipline.read`**; no design says what it reads (G1) | | `roles.mjs:544` |
| DSO | no | | `roles.mjs:520` |
| everyone else, public | never | N3 | `PUBLIC_DATA.md:76` |

Two decided texts disagree on the parent and the coach (conflict 5).

### J · Safeguarding (concerns, reporter, notes, shares, suspension, the bar)

| reader | may | condition | source |
|---|---|---|---|
| DSO | yes | at the holding tenant only; every read logged; the reporter's identity DSO-only even inside a share | `SAFEGUARDING_DSO.md:414-417, 432-439` |
| a named adult (coach, principal, physio) | a share only | `safeguarding_share_open()`: the parts in `what`, 30 days at most, revoked by any DSO; never the reporter | `:461-492` |
| parent | a share to her verified link, or a `guardian_contacted` note | no standing read; no automatic notice, not even "something was raised" | `:493-495`; `CSA_SAFEGUARDING_CHECK.md:637-641` |
| the reporter | the reference and "received"; not the state | | `SAFEGUARDING_DSO.md:335-340` |
| pupil | nothing of a concern about himself | | `SCRBRD-138_captains_view.md:215` |
| principal, director, office (`audit.read`) | **no**, and not the log rows that would show one exists | RESTRICTIVE on `access_log` | `SAFEGUARDING_DSO.md:446-459` |
| owner key, platform, support | **never** | the carve-out and two RESTRICTIVE cuts | `:154-160, 418-426` |
| the lift bar | the DSO; the barred parent sees only "the DSO has asked you not to drive"; the office sees nothing | | `SCRBRD-124_lift_clubs.md:343` |

Agreed everywhere. The one undecided case: a concern about a child of the **other** school raised at a fixture (G2).

### K · Consents, K2 · the never-public mark, K3 · links and family

| reader | consents | the mark | its reason | the child's links | a revocation's reason | source |
|---|---|---|---|---|---|---|
| parent | her child's, every kind, with version and dates; the other guardian as "the guardian" | the fact only, "ask the office" | never | her own rows through `my_links`, no name unless live | **never** | `STEP4_parent_pupil.md:474-525`; `GA-I20_parent_action_list.md:166-171`; `ACCOUNT_LIFECYCLE.md:494-516` |
| pupil | read-only until 18; his own to give from 18 (a "no" to his text name from 12, K1) | the fact | never | no | never | `STEP4_parent_pupil.md:463-466`; `SAFEGUARDING_DSO.md:616-620` |
| office | all, and records them from forms | sets, ends, reads | yes | `child_links`, every state, logged | yes (`guardian.link.manage` or `audit.read`) | `ACCOUNT_LIFECYCLE.md:524-543` |
| principal, director | — | yes (`player.public.withhold`) | yes | `child_links` through `user.role.assign` | via `audit.read`: see conflict 2 | `roles.mjs:170, 200, 163, 182` |
| DSO | no | yes, sets and ends | yes | **not by standing**; `safeguarding_family()` on a concern | **"never by standing"** — but it holds `audit.read` (conflict 2) | `ACCOUNT_LIFECYCLE.md:513-516, 540-541`; `roles.mjs:529` |
| coach | no | no | no | no | no | `ACCOUNT_LIFECYCLE.md:539` |
| another family at the school | never; the passport and scouting consents are closed to them (REACH O5, O6) | | | | | `REACH_parent_pupil.md:251-252` |
| public | never; a revoked link counts as "untrue" for the public name | | | | | `PUBLIC_DATA.md:183-184` |

### L · Emergency contacts

| reader | may | source |
|---|---|---|
| parent | yes, her child's; reads and manages | `roles.mjs:404` |
| pupil | **no**, his own (STEP4 Q7: "not in step 4") | `STEP4_parent_pupil.md:643` |
| coach, assistant, manager, director, office, sportsadmin, physio | yes | `roles.mjs:270, 287, 300, 187, 216, 436` |
| transport coordinator | **holds it school-wide**; no design says so (G3) | `roles.mjs:485` |
| a lift driver | each passenger's emergency contacts, on the day only, through `lift_contacts()`, logged | `SCRBRD-124_lift_clubs.md:358` |
| DSO | only through `safeguarding_family()` on an open concern | `SAFEGUARDING_DSO.md:499-505` |
| everyone else, public | never (N4) | `PUBLIC_DATA.md:77` |

### M · Public pages (the label, milestones, the honours board, the ground display)

Signed-out readers only; agreed in every design. Initial and surname with a live consent and a published side, else "Batter"; a never-public boy is "Batter" on a scorecard and absent from the board; no photo, DOB, health, discipline, judgement, note, reason, per-player page, leaderboard, team sheet, captain mark, officials in phase 1, or any figure across matches (`PUBLIC_DATA.md:19-83`; `SCRBRD-083_public_pages.md:57-89, 882-883`; `SCRBRD-133_immersive_match_centre.md:47`; `SEASON_ROLLOVER.md:397`). The home page lists team-level cards only and is the one indexed page (`SCRBRD-142_public_home_page.md:85-91`). Public news names no pupil in v1 (`:187`). Consent is judged on the day served; at 18 his own record governs once given; while at school a parent may say no, never a new yes (`PUBLIC_DATA.md:140-149`; `SCRBRD-083_public_pages.md:583-593`).

### N · Transport (the bus) and lifts

| reader | the bus (`trip`) | lifts | source |
|---|---|---|---|
| parent | her child's side's trips: departure, return, pickup, driver's name, status; `notes` may name a child | her own offers and seats; other passengers' names once her seat is confirmed; the driver's number on the day | `REACH_parent_pupil.md:205-213`; `SCRBRD-124_lift_clubs.md:356-357` |
| pupil | the side's bus | his own lift (driver's name, point, time, car), no number, nobody else's; under 18 he requests nothing | `SCRBRD-124_lift_clubs.md:268, 359` |
| coach, assistant, manager | the side's trips | who is arriving by lift, with whom, when; "with us"; never numbers | `:271, 360` |
| office, sportsadmin, transport coordinator | every trip at the school | counts; exceptions by name on a tap, logged; cancel; the declarations | `:270, 361`; `GA-I09-I11_match_day_queue.md:247, 322` |
| director | every trip | **GA-I27 says exceptions by name; GA-I09 and the code say no** (conflict 4) | `GA-I27_coach_cards.md:117`; `GA-I09-I11_match_day_queue.md:44` |
| principal | the lift access-log rows through `audit.read`; never the arrangements | | `SCRBRD-124_lift_clubs.md:269, 363` |
| DSO | trips, and clears them (K6) | `lift_history()` logged; the bar; never contact numbers outside a concern | `SAFEGUARDING_DSO.md:718-729`; `SCRBRD-124_lift_clubs.md:333` |
| a parent on another side at the school | **not** this side's trips (REACH M3, decided; today's policy is wider) | — | `REACH_parent_pupil.md:250` |
| support, the pad, the owner key | nothing of lifts | | `SCRBRD-124_lift_clubs.md:273` |

### O · Notices

Four audience shapes and nothing else (`NOTIFICATIONS.md:117-147`). A notice about one child reaches the team's staff with the capability and the child's own guardians, never another family. **The pupil never reads an `injury`, `welfare`, `safeguarding` or `lift` notice, even about himself**: no single assignment of his holds both `news.read` and the kind's capability (`:139-143`; `roles.mjs:340-345, 386-396`). He reads the side's rows and a `system` row addressed to him. A push names nobody (`:261-270`). Minors get no `medium` push 21:00–06:00 (`:437-444`). Agreed everywhere, with one exception at the edge: an eighteen-year-old pupil as the named recipient of a `compromise` notice (conflict 8).

### P · Messages and the plan to the side

No private channel between an adult and a pupil; a plan is a post to the side, read by every boy on the roster, his guardians and the side's staff; a DSO opens it on a concern; the words are filtered at the writer (`SCRBRD-138_captains_view.md:228-244`; `SCRBRD-138_phaseB.md:96-106, 178-190`). A spectator reads a team's posts only when the office scoped him to the side (REACH-D3, `REACH_parent_pupil.md:374`). Agreed everywhere.

### Q · Scouting and opposition

| reader | may | condition | source |
|---|---|---|---|
| scout | consented boys only: name, team, career figures | accreditation verified; no side-by-side (Q7) | `roles.mjs:491-501`; `GA-I24-I25_compare_and_combine.md:74, 217` |
| coach, assistant, analyst, director (`opposition.read`) | the other school's named squad and aggregates | five days before, until the first ball; logged against the other school with every boy's id; never kept | `SCRBRD-136-137_coach_cockpit_and_feed.md:176-182`; `GA-I24-I25_compare_and_combine.md:41, 109` |
| team manager, captain, pupil, parent, spectator | never the dossier | | `SCRBRD-138_captains_view.md:216`; `GA-I27_coach_cards.md:118` |
| a parent, asking | who read her son as an opposition player: the school, the fixture, the day | from `access_log` | `GA-I24-I25_compare_and_combine.md:128` |

Agreed.

### R · Account state, S · the access log, T · scorebook photos, U · the register, V · data events

| class | who may | condition | source |
|---|---|---|---|
| R account state | the office (People) sees "not active · disabled {date}"; the reason to `user.invite` or `audit.read`; the person is never told why; the coach, the parent, the DSO, the public see nothing | | `ACCOUNT_LIFECYCLE.md:231-244, 807` |
| S the access log | `audit.read` holders at the school; **the parent** (or the pupil at 18+) sees when, the reader's role and school, what kind of record — not the name; safeguarding rows hidden from everyone but the DSO; the self-read not logged | `my_child_access_log()`, design | `INCIDENTS_AND_BREACHES.md:531-544`; `SAFEGUARDING_DSO.md:446-459`; `SCRBRD-110_workload.md:285` |
| T scorebook photos | the submitter and the confirmer (`scoring.import.read` over the import), logged per page, purged 30 days after confirmation; not `audit.read`, not a parent, a pupil, the other school, support, the pad, the public | | `SCRBRD-120_scorebook_importer.md:256, 260-267` |
| U training register | the side under `player.profile.read`: team-mates, the analyst, the scorer, the manager, the parent for her child's row; never a health word on it (AH-D9) | | `GA-I26a_assessment_history.md:185, 220` |
| V data events | the officer and the deputy (`compromise.*`); **`audit.read` at a school** reads its own school's events and the count of its subjects; families told by email and a `compromise` notice; a pupil under 18 never a recipient; the DSO told only for a child at risk, through a concern | | `INCIDENTS_AND_BREACHES.md:447-456, 251-252, 261-285` |

The DSO holds `audit.read` (`roles.mjs:529`), which is why classes V, R and K3 appear again in conflict 2.

---

## 4 · Conflicts between decided texts

Each quotes both texts, says what breaks if a builder follows one and not the other, and gives a resolution. None reopens a decision; each picks the decision that governs and names the text to correct.

### Conflict 1 · The parent of an eighteen-year-old at school

- `STEP4_parent_pupil.md:461`: *"The parent, after the day. The child's card on Family becomes a closed card: 'Your link to Rohan ended on 14 Mar 2029. His record is his own now.' The switcher drops him. His past fixtures and his figures are gone from her app."* And `:465`: *"Health monitoring: … the guardian's consent lapses on the day … collection pauses and staff reads stop until he says yes."*
- `REACH_parent_pupil.md:84`: *"At eighteen: nothing changes for him; his guardian's link ends by its date (STEP4 §3.3; the SCRBRD-110 Q7 exception for health is that design's, not this one's)."*
- Against: `SCRBRD-110_workload.md:552`: *"A guardian link's `valid_until` is the later of the child's eighteenth birthday and the day he leaves the school system; while he is at school it is open."* Signed off by the information officer (`:579`), built as db/52/db/62, and relied on by `ACCOUNT_LIFECYCLE.md:557` (*"18, at school: nothing ends"*), `GA-I20_parent_action_list.md:150`, `SCRBRD-124_lift_clubs.md:293`, `SEASON_ROLLOVER.md:526` and `SCRBRD-083_public_pages.md:583-593` (option C).

**What breaks.** A builder of the family screens from STEP4 or REACH closes the parent's card and ends every read on the birthday, while the database keeps her link live: the screen says "his record is his own now" to a parent who can still open his injury record and withdraw his public name. Two sources of truth about the same link, on the same phone.

**Resolution.** SCRBRD-110 §7.4 governs every read, not health alone: the link is open while he is at school; her reads continue; her acts after 18 are "no" only (public name, health monitoring, a lift seat); the card closes on the later of leaving and the birthday. Haiku corrects STEP4 §3.3 (both paragraphs) and REACH §2.2's "At eighteen" line to say so. Q1.

### Conflict 2 · `audit.read` opens reasons the designs say the DSO and the office never see

The `dso` bundle holds `audit.read` so a DSO can answer "who read this child's record" (`SAFEGUARDING_DSO.md:135-136`; `roles.mjs:529`). Four designs then hand `audit.read` a second job, and each contradicts itself or the DSO's stated reach:

1. `ACCOUNT_LIFECYCLE.md:513-514`: the revocation reason is *"Readable by `guardian.link.manage` or `audit.read` at the school; never by the guardian; never by the DSO by standing"* — the DSO holds `audit.read`, so it reads every revocation reason by standing, custody reasons included.
2. `ACCOUNT_LIFECYCLE.md:763, 807`: the disable reason is read by *"`user.invite` or `audit.read`"* — the DSO reads why any account at the school was disabled; `:241` says the DSO sees *"nothing by standing"* of an account's state.
3. `SCRBRD-140_phase2_register.md:208-209`: the staff register is read by *"`user.role.assign` or `audit.read` at the school"* and *"What the DSO sees: nothing by standing"* — both cannot hold.
4. `RECOGNITION_design.md:117`: `withdrawn_reason` is *"masked under `recognition.decide`, with the withdrawer and `audit.read` also able to read it"*, while the matrix at `:98` says the office reads the reason *"no (D4) unless it withdrew"* — the office holds `audit.read` (`roles.mjs:222`), so it reads every reason; the DSO too, though `:102` says *"through `audit_log()` on a concern"*.
5. `INCIDENTS_AND_BREACHES.md:451-452`: *"`audit.read` at a school reads the events whose `schools` include that school"* — so the DSO reads the breach register, while `:252` tells the DSO *"only when a child is at risk"* and through a concern.

**What breaks.** Every one of those tables, built as written, gives the DSO a standing read of custody reasons, dismissal reasons, honour withdrawals (which may be conduct matters) and the breach register, and gives the office the honour reasons D4 keeps from it. The separation these designs promise exists on paper only.

**Resolution.** `audit.read` opens the access log and nothing else. A reason stays with the capability of the act that wrote it: revocation reasons under `guardian.link.manage`; disable reasons under `user.invite`; honour reasons under `recognition.decide` and the withdrawer; the staff register under `user.role.assign`; data events under `compromise.read` and, for the school's own, a school's principal (its information officer) through a named capability rather than `audit.read`. Opus adds a separation assertion: no table's read policy names `audit.read` except `access_log` and the audit screen's own reads. Q2.

### Conflict 3 · A departed pupil's clinical record

- `ACCOUNT_LIFECYCLE.md:451` (Q9, decided 7 Oct as recommended): *"should departed pupils' clinical records be cut from staff reads except the office's, until purge? Recommendation: yes, a `RESTRICTIVE` policy on the masked health, note, rating and discipline tables, false for a departed player unless the caller is the office, a live guardian or the pupil himself."* `GA-I26a_assessment_history.md:302` builds on it.
- `GA-I19_medical_review.md:194` (decided 8 Oct): a pupil leaves, *"the worklist excludes a departed boy …; the Injuries screen marks his row 'left the school'; the physio reads it until retention."*

**What breaks.** AL slice 4's RESTRICTIVE cut hides the row the GA-I19 screen is drawn to show; whichever lands second either reopens the physio's read or breaks the screen.

**Resolution.** AL Q9 governs: it was decided first, covers four tables, and a physio's sight of a boy who has left is the thing SR Q8 and K3 exist to narrow. GA-I19 D11's row becomes "the office holds it until purge; the physio's read ends on departure and returns if he re-enrols". Q3.

### Conflict 4 · The director of sport and lift exceptions by name

- `GA-I27_coach_cards.md:117`: *"director of sport … S4b through `transport.lift.oversee` (D10)"*; `SCRBRD-124_lift_clubs.md:259` assumed the director holds it.
- `GA-I09-I11_match_day_queue.md:44`: *"`directorofsport` … lifts: no (holds neither lift capability)"*; `roles.mjs:176-204` agrees: no `transport.lift.*` on the bundle.

**What breaks.** A builder of GA-I27's drawer draws S4b (a child's name and a lift exception) for a reader whose bundle refuses the read; the card fails silently or, if the builder "fixes" the bundle, widens a level-2 read of children's names without a decision.

**Resolution.** The code and GA-I09 stand; GA-I27's director row loses S4b (he gets S4a's head count as the coach does). If Kameel wants the director to see exceptions, it is one line in `roles.mjs` and a decision, not a drawer. Q4.

### Conflict 5 · SEASON_ROLLOVER gives the parent and the coach a "discipline tier"

- `SEASON_ROLLOVER.md:118`: the parent reads *"her child's file, consents, contacts, availability history, injuries, **discipline tier**, figures, honours …"*; `:148`: the new coach reads *"his injury record, availability, workload, contacts, **discipline tier**"*.
- `STEP4_parent_pupil.md:641` (Q5): *"`guardian` does not hold `discipline.read` … Not in step 4."* `roles.mjs:257-280, 401-416`: neither `coach` nor `guardian` holds `discipline.read`; `SCRBRD-136-137_coach_cockpit_and_feed.md:197`: discipline is *"not his"*.

**What breaks.** A builder of the rollover's family or coach reads adds a conduct read for two roles that STEP4 Q5 and the bundles refuse.

**Resolution.** Strike "discipline tier" from both rows; SR changes no reader (its own never-list item 8). Q5 asks only whether to confirm.

### Conflict 6 · The DSO and a withdrawn honour

- `RECOGNITION_design.md:102` (the matrix): DSO, withdrawn honour: *"yes"*.
- `RECOGNITION_design.md:115` (D3): *"A withdrawn honour leaves every screen … for every reader except: the pupil himself, his guardian, and a holder of `recognition.decide` or `recognition.manage`."*

**What breaks.** Small: a DSO screen that lists a withdrawn honour, or a `recognition()` filter that must special-case a role (ADR 0003 forbids it).

**Resolution.** D3 governs; the matrix row reads "absent; through the audit on a concern". Q6.

### Conflict 7 · PUBLIC_DATA has not taken the twelve-year-old's "no"

- `SAFEGUARDING_DSO.md:616-620` (K1, decided CSA Q6, 27 Sep): *"a 'no' only, from 12 … `public_name_consent_set()` accepts a pupil's record from his 12th birthday when `p_yes = false` … PUBLIC_DATA C1/C4 gain the sentence; that wording is Kameel's."*
- `docs/policy/PUBLIC_DATA.md:87-99`: C1 names *"a verified guardian"* only; C6 starts at 18. No sentence about 12.

**What breaks.** PUBLIC_DATA is "the rule every public page is built against" (`:5`); a builder of `public_name_facts()` from it ignores a pupil's refused record and names a boy who said no.

**Resolution.** Kameel words the sentence; Haiku adds it to C1 and C4 and marks whether db/47's function already takes it (§6 X11). Q7.

### Conflict 8 · An eighteen-year-old pupil as a notice's named recipient

- `INCIDENTS_AND_BREACHES.md:282-284`: *"A pupil of 18 or more with `selfaccess` is his own data subject and receives his own"* `compromise` notice.
- `CSA_SAFEGUARDING_CHECK.md:544-546` (SG-9 rule 2, decided): *"`recipient_id` … never names a pupil, unless the notice is the system's own … A test asserts this."* `SAFEGUARDING_DSO.md:324-325` makes it a test; `NOTIFICATIONS.md:141-142`: *"He reads a row addressed to him alone only when it is `system`."*

**What breaks.** `person_is_pupil()` is true for an eighteen-year-old still at school, so db/57's trigger refuses the row INCIDENTS writes, or the builder loosens the trigger for every kind.

**Resolution.** `compromise` joins `system` as a kind the system itself writes to one person; the trigger admits `recipient_id` naming a pupil for those two kinds only, and only when the pupil is 18 or more. Q8.

### Conflict 9 · What the owner's key holds

- `ACCOUNT_LIFECYCLE.md:774`: *"`superadmin` holds every capability above as it holds everything outside `safeguarding.*`"*; `SCRBRD-124_lift_clubs.md:262` the same.
- `RECOGNITION_design.md:123` (D7, decided 7 Oct): *"`recognition.*` joins `safeguarding.*` in the carve-out from `superadmin`."*

**What breaks.** A builder of the recognition tables adds the RESTRICTIVE cut and finds the key still holds `recognition.manage` (`roles.mjs:108` filters `safeguarding.` alone); or a builder of AL assumes the key can record a departure's honour withdrawal and cannot.

**Resolution.** D7 is the later and narrower decision and stands; `roles.mjs:108` gains the second prefix when recognition's first migration lands; AL §7 and 124 §2.1 are reworded to "everything outside `safeguarding.*` and `recognition.*`". No question: the decision exists.

**Resolved already, recorded here so nobody reopens it:** GA-I27 C-D4's *"another boy's figures in any form"* was amended on 14 Oct to REACH-D2's "leave them open" (`GA-I27_coach_cards.md:121`); SEASON_ROLLOVER applies it (`:127`).

---

## 5 · Gaps: cells no design decides

Ranked by the harm if a builder guesses wrong. "Harm" is what a wrong guess discloses about a child.

| # | gap | where a builder would guess | harm |
|---|---|---|---|
| **G1** | **The league organiser and conduct.** `competitionadmin` holds `discipline.read` (`roles.mjs:544`, level 3). No design says which disciplinary records a league reads: its own fixtures' umpire reports, or every record at every entrant school. OFFICIAL_RESULT and the planner are silent. | `disciplinary_record`'s policy (db/25) when the organiser's reads are built | **high**: a conduct record about a child read by an outside body, school-wide |
| **G2** | **A concern about a child of the other school.** A Westville parent at a Hilton fixture sees a Hilton boy mistreated. `safeguarding_raise()` routes by *the school* (`SAFEGUARDING_DSO.md:294-302`) and picks the child from *"people the reporter can already see"* (`CSA_SAFEGUARDING_CHECK.md:406`); she can see him only as a name on the scorecard. Which tenant holds it, and may she name him? | the form's school picker; the routing function | **high**: a concern lost, or held by the wrong school |
| **G3** | **The transport coordinator and emergency contacts.** `transportcoordinator` holds `player.emergency.read` school-wide (`roles.mjs:485`). SCRBRD-124 gives the office *"counts; exceptions by name"* and the driver contacts *"on the day"* (`:358, 361`); nothing designs a coordinator's standing read of every child's contacts. | left as is | **medium-high**: every family's numbers to a volunteer role |
| **G4** | **A pupil who scores at a fixture.** A scorer holds `player.profile.read` over the fixture (`roles.mjs:316`); a pupil may be the scorer, of either school (`PUBLIC_DATA.md:160-161`; `SCRBRD-136-137_coach_cockpit_and_feed.md:367`). What of the host's eleven does an away pupil scorer read beyond the sheet's names: the masked profile row, honours, the training register (U)? REACH-D5 closed `official`; nothing bounds the scorer's profile read. | the pad's squad read | **medium**: a child's roster row and honours to a child of the other school |
| **G5** | **The under-18 pupil's own "who read my record".** INCIDENTS D20 gives the view to a live guardian *"or the pupil himself at 18+"* (`:533`). The right of access is the child's too (`roles.mjs:381-385`'s reasoning for his clinical notes). Under 18: nothing, or through the parent only? | the route's gate | **medium**: either a right withheld or a log of adults' reads shown to a child |
| **G6** | **The parent and her child's disciplinary record.** STEP4 Q5 deferred it (*"raise it with the information officer"*, `:641`); nothing since decides. The office tells parents by letter; the app says nothing, not even that a record exists. | a family screen | **medium**: a widening of a level-3 read, or a parent who learns from her son's phone (he reads it, `:642`) what the app will not tell her |
| **G7** | **An enquiry grant and the family.** A coach granted one named boy reads his profile and status for a week (`roles.mjs:346-365`). `medical.status.read` is level 2 and may not be in the logged set; no design says the family can see, on "who read my record", that another coach was granted him. | the access-log view's fields | **medium**: a disclosure the parent cannot ask about |
| **G8** | **Photos and `media_consent`.** K1's `media_consent` (`SAFEGUARDING_DSO.md:621-628`) and SCRBRD-092's in-app photos are not built; STEP4 draws the card as *"Registered users at his school may see photos of him"* (`:490-492`). Who at the school: the side, the school, the other school's family at a shared fixture? | the photo table's policy | **medium**: a child's face to a wider room than the consent named |
| **G9** | **Media's standing reach.** `media` holds `player.profile.read` and `player.performance.read` school-wide (`roles.mjs:490`); no design places the role beyond RECOGNITION's matrix (`:100`). Does the media officer read the training register (U), availability-free but side-shared? | nothing | **low-medium**: a roster and attendance to a publishing role |
| **G10** | **The pupil's own emergency contacts.** STEP4 Q7 (`:643`) deferred it; still open. | — | **low**: a correct widening left undone |
| **G11** | **Invoices.** `guardian` holds `invoice.read` with nothing behind it (STEP4 Q1, `:637`); a table built later inherits a read nobody designed. | a future table | **low** |
| **G12** | **A child reads his own ID number.** `selfaccess` holds `player.identity.read` (`roles.mjs:394`, level 4). No screen draws it, and no design says whether a thirteen-year-old's Me screen should. | the Me screen | **low**: the most dangerous field about a child, on his own phone |

Not gaps, because a design decides them and the map says so: a sibling (REACH class D), a coach who is also a parent (`GA-I19_medical_review.md:121`; `RECOGNITION_design.md:129`), the nomination row (`RECOGNITION_design.md:179`), the analyst and the register (`GA-I26a_assessment_history.md:220`), the wellness share's witnesses (`SCRBRD-110_workload.md:451`), and a disabled pupil's reads (`ACCOUNT_LIFECYCLE.md:197`).

---

## 6 · The designs against the code — Opus to confirm

Read from the lines the map points to and nothing else. Each is a place where `packages/policy/src/` seems to say something the designs do not, or the reverse. None is built on here; each is a check for Opus before a brief.

| # | where | what seems to differ | Opus to confirm |
|---|---|---|---|
| **X1** | `roles.mjs:166` | `principal` holds `medical.nature.read`; `GA-I19_medical_review.md:105` says *"principal: status (as today)"*. | which is "today"; if the code, correct the design row (Q9) |
| **X2** | `roles.mjs:108` | the owner's key filters `safeguarding.` only; RECOGNITION D7 carves out `recognition.*`; `recognition.decide` (reconciliation Q5) is not in `capabilities.mjs`. | both wait on recognition's first migration; AL §7's sentence is stale (conflict 9) |
| **X3** | `roles.mjs:544` | `competitionadmin` holds `discipline.read` (level 3); no design gives a league a conduct read (G1). | what `disciplinary_record`'s policy lets a platform-wide or school-scoped organiser read today |
| **X4** | `roles.mjs:485` | `transportcoordinator` holds `player.emergency.read` school-wide (G3). | whether any route serves it; whether `lift_contacts()` or the trip screen is the only consumer |
| **X5** | `roles.mjs:176-204` | `directorofsport` holds no `transport.lift.oversee`; `SCRBRD-124_lift_clubs.md:259` assumed it and `GA-I27_coach_cards.md:117` relies on it (conflict 4). | the bundle as shipped in db/70 |
| **X6** | `roles.mjs:529` | `dso` holds `audit.read`; five designs let `audit.read` open reasons and registers (conflict 2). | which shipped policies already name `audit.read` beside a reason column (`scoring_amendment`, `account_status_change`, db/90) |
| **X7** | `capabilities.mjs:513` | `player.performance.read` is level 0, *"a scorecard, meant to be public"*; but the per-boy career, season and wheel it also opens are what A4 forbids in public and what REACH and GA-I24-I25 call a dossier. Level 0 keeps it out of `SENSITIVE` and out of logging by construction. | whether level 1 changes any test; GA-I24-I25 §6 already chose not to log `career` |
| **X8** | `capabilities.mjs:510` | `recognition.manage` is level 0 though it writes an honour and (today) its reason. | low; the reason moves under `recognition.decide` with X2 |
| **X9** | `notifications.mjs:11` | `KINDS` has no `compromise` (INCIDENTS D1, decided 21 Oct); the SG-9 trigger refuses a pupil as recipient (conflict 8). | expected, unbuilt; the trigger's shape when it is |
| **X10** | `tables.mjs:124-169` | `player.fitness` masked under `medical.status.read` (SCRBRD-117; `SAFEGUARDING_DSO.md:663-665`). | that the mask shipped and `player_masked` honours it |
| **X11** | db/47 (not read here) | `public_name_consent_set()` accepting a pupil's `refused` record from 12 (K1, conflict 7). | built or not; if not, it is a line in the backlog with Kameel's sentence |
| **X12** | `REACH_parent_pupil.md:247-263` | fourteen mismatches decided 14 Oct (M3 trips school-wide, O5/O6 consents to every family, O4 `official` open, O8 team-less pupil, O-N notices). The map above states the decided rule, not today's policy. | which have landed since ab79828 (db/100–102 were "in hand"); O8 verified live first |
| **X13** | `roles.mjs:365` | `enquiry` keeps `medical.status.read` (decided 28 Sep). `GA-I20_parent_action_list.md`'s access-log view and INCIDENTS D20 map `fields` to words; whether a level-2 status read is in the logged set decides G7. | the `RESTRICTED_FIELDS` list |

---

## 7 · Questions for Kameel

Each is one decision, with the recommendation and one line of why. "As recommended" is an answer.

1. **Eighteen at school, every read.** Confirm SCRBRD-110 §7.4 governs all of a parent's reads (not health alone): the link stays open while he is at school; she keeps reading; after 18 she may say "no" and never a new "yes". STEP4 §3.3 and REACH §2.2 are corrected. *Recommend: yes.* It is the signed-off rule and the database already does it.
2. **`audit.read` opens the log and nothing else.** Revocation reasons, disable reasons, honour reasons, the staff register and the breach register each stay under the capability of the act that wrote them; no read policy names `audit.read` but the log's. *Recommend: yes.* The DSO must answer "who read", not "why was she revoked".
3. **A departed boy's clinical record.** AL Q9 (office, family and the boy until purge; staff cut) over GA-I19 D11 (the physio reads until retention). *Recommend: AL Q9*; a re-enrolment reopens the physio's read.
4. **The director of sport and lift exceptions by name.** Leave him without `transport.lift.oversee` (GA-I09, the code) and amend GA-I27. *Recommend: leave it.* The office and the coordinator hold it; a level-2 read of children's names is not a drawer's to add.
5. **SEASON_ROLLOVER's "discipline tier".** Strike it from the parent's and the coach's rows. *Recommend: strike.* STEP4 Q5 stands; nothing widens on a move.
6. **The DSO and a withdrawn honour.** D3's list (absent) over the matrix (yes). *Recommend: D3.* The DSO reaches it through the audit on a concern.
7. **The twelve-year-old's "no" in PUBLIC_DATA.** Word the sentence for C1 and C4. *Recommend:* "From his twelfth birthday a pupil may refuse his own name on public pages; his refusal stands whatever a guardian says. His 'yes' counts from eighteen."
8. **A `compromise` notice to a pupil of eighteen.** Let the SG-9 trigger admit `recipient_id` naming a pupil for `system` and `compromise` only, and only at 18 or more. *Recommend: yes.* He is the data subject; under 18 his guardians are told.
9. **The principal's injury tier.** Status and nature (the code) or status only (GA-I19 D3). *Recommend: the code stands*; the head reads what the office reads. Correct the design row.
10. **The league organiser and conduct (G1).** Remove `discipline.read` from `competitionadmin`, or scope it to records arising from its own competition's fixtures through a definer read. *Recommend: scope it, logged.* A league needs the umpire's report on its match, not a school's file.
11. **A concern about the other school's child (G2).** Route by the child's school when the reporter names a boy on the other side's sheet; the reporter's own DSO is told a concern exists, no name. *Recommend: yes.* The child's DSO is the one who can act.
12. **The transport coordinator's contacts (G3).** Narrow `player.emergency.read` to the boys on a trip he coordinates, on the day, through a logged function; no standing school-wide read. *Recommend: narrow.* The driver already gets exactly that for lifts.
13. **A pupil scorer and the host's eleven (G4).** Opus lists what a fixture-scoped `player.profile.read` reaches at the host; the pad's squad read is cut to names, order and styles. *Recommend: cut.* A child of the other school scoring needs names, not profiles.
14. **The under-18 pupil's "who read my record" (G5).** From 18 only in v1; under 18 through the parent. *Recommend: 18.* A log of adults' reads is a conversation for the family, not a list on a child's phone.
15. **The parent and the disciplinary record (G6).** Still defer, or decide now. *Recommend: defer to the information officer's next sign-off*, with one change now: the app never shows a parent a record it holds about her child without telling her one exists — so the letter stays the channel and the app stays silent.
16. **A child's own ID number on Me (G12).** Draw it never; the right of access is met by the office on request. *Recommend: never on a screen.* Level 4 on a thirteen-year-old's phone is the breach the register is designed for.

---

*Sources read for this map:* the reader sections named in Haiku's ground map of 21 Oct 2026, `docs/policy/PUBLIC_DATA.md` whole, and `packages/policy/src/roles.mjs:100-554`, `capabilities.mjs:452-615`, `tables.mjs:120-169`, `public.mjs:139-208`. Nothing else was searched.
