# Who sees a child's data — one map across every design

Status: **design, for Kameel's review** (Fable, 21 Oct 2026). Built from the reader sections of every design on `origin/main` at ab79828, the policy code in `packages/policy/src/`, and the decisions already recorded. Nothing here reopens a decision Kameel has made; where two decided texts disagree, that is a finding (§5). Opus builds from this; Haiku records the answers.

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

**Found:** 9 conflicts between decided texts (§5), 12 cells no design decides (§6), 13 places the code seems to differ from the designs (§7), and 16 questions for Kameel (§8). The three that matter most: the parent of an eighteen-year-old at school (two designs still end her reads on the birthday; the signed-off rule keeps them open); `audit.read` opening reasons four designs say the DSO and the office never see; and a departed boy's clinical record (one design cuts the physio off, one keeps her on).

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
| B2 | **Career and season figures, per boy** | `career`, `career_by_season`, wheel, dismissal breakdown, matchups | 0 in code (see §7 X7) | views over `ball_event_career` (`player.performance.read`) |
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
