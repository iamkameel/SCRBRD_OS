# Recognition — the five hard parts: the design

**Status:** for Kameel's review (Fable, 2026-10-07). Nothing built. Designed on the reconciliation's recommendations, taken as numbered assumptions (§1), because Kameel has not yet answered its eighteen questions.
**Source:** `docs/design/RECOGNITION_spec_v0.2.md` v0.2.3 (on `origin/claude/scrbrd-os-03vb2m`); `docs/design/RECOGNITION_reconciliation.md` (on `origin/claude/wip-recognition-reconcile`, Opus): §3 for what exists, §4.1 Q1–Q18, §4.2 F1–F5, §5 R1–R12; `docs/design/GA-I36_corrections_everywhere.md` (on `origin/claude/wip-ga-corrections-design`), its D4, N4 and slices A1/A2; `docs/policy/PUBLIC_DATA.md`; `docs/design/SCRBRD-083_public_pages.md` §3.5, §5, §9 Q6; `docs/design/SCRBRD-138_captains_view.md` §1.2, §4, §5, D3, D5, D6; `docs/design/STEP4_parent_pupil.md` §2, §4, §6; `docs/design/GA-I20_parent_action_list.md` §4.4; `packages/policy/src/roles.mjs`; `packages/policy/src/tables.mjs` (the `honour` entry); `db/08_schema_programme.sql` 5428–5790 (`honour`, `milestone_notice`, `milestone_notify()`, `milestone_watch()`, `recognition()`); `db/59_public_read_path.sql` (the forbidden-column list and the notify triggers).
**Reader:** Kameel on a phone first (§0, then §8 and §9); then the Opus lead who builds the schema, policy and triggers; then the Sonnet agent who builds the screens. Names in the sketches are STEP4's invented ones (Rohan Pillay, D Erasmus, K Naidoo, Mr Dlamini, Hilton, Kearsney, DHS), never a real child's.

---

## 0 · In one page

**Nothing here becomes a second place where a score is true.** Achievements, personal bests and records stay derived from the ball log, as `player_milestone` already is. What people decide (an award, a nomination, "put it on the board") is stored. A corrected ball takes a derived item away on the next read and sends a decided award back to the person who decided it. The system never moves an award to someone else.

**Who sees what (F1).** The rule that already governs `honour` stands: a boy's recognition is read by whoever may read his sporting profile, which is his side, his coaches, his parents, the office and the school's analyst and media officer, and nobody at another school. Four things narrow it. A withdrawn honour disappears from every screen another child can open and stays, marked "withdrawn", on his own passport, his parent's screen and the deciders' sheet; its reason is masked to the deciders and the audit (D3, D4). A nomination is read by the nominator and the side's staff and by nobody else, never by the nominee (D8). A live milestone notice stays the side's news; a notice to a parent about *her* child waits for the scorer's seal (D6). Rankings of team-mates reach staff only (D22).

**Consent (F2).** The existing public-name consent, the never-public mark and the names-off switch are enough (D11). Only two things about recognition are ever public: honours the school marks public, and milestones on the live page, both named by the initial-and-surname rule. No record, no personal best, no photo, no player page. Revoking the consent makes the boy a position ("Player") on every public surface at once and deletes nothing; a never-public boy is absent from the honours board altogether (D12, D13). One check before the board goes live: the words the parent agreed to must name it (Q3).

**The captain's pick (F3).** The holder of the season's `captain` honour, if he played, otherwise the `vice_captain`, may nominate one team-mate for Player of the Match, from the match being verified until the coach decides or 48 hours pass. Never himself. No words: the nomination is a row, so no child-to-adult message exists (D15, D16). He sees the system's two or three suggestions with the figures he already reads, and nothing else. His coach confirms with one tap or chooses another; the captain learns the outcome as the side does, from the honour posted to the side (D17, D18).

**Corrections (F4).** A void retracts the notices it falsified (GA-I36 A2) and the parent's card with them (D20). An award whose cited figures or result moved is flagged to its decider and stands until he withdraws it, with `withdrawn_kind = 'correction'`, the only kind the side is ever told about (D19, D21).

**Boards (F5).** Signed in only. Staff see the full board. A pupil sees the record and its holders as a pavilion board shows them, never a list of his team-mates ordered by a figure; a parent sees only her own child's standing (D22, D23).

**Build.** The decisions change six of the reconciliation's twelve slices and add two small ones (§10). Nothing before the 15 October test.

---

## 1 · Assumptions

The reconciliation's Q1–Q18 are taken as recommended. Each is an assumption here; the right-hand column says what changes if Kameel answers otherwise. **★** marks one that would put a child's name or photo on a public page if decided the other way.

| # | Taken as | If Kameel decides otherwise |
|---|---|---|
| **A1** | Friendly = a fixture with no competition; Practice Match never reaches the server; no pilot flag; no "promote" | Nothing here changes. |
| **A2** | Inter-house deferred to V2 | Nothing here changes; an inter-house board would follow D22–D24 unchanged. |
| **A3** | External festivals feed School Records by format; DLS, abandoned and super over on no board; bests per class group, School Records the headline | D24's headline rule moves with his answer. |
| **A4** | One Player of the Match per side per match; coach's choice stands; captain's pick kept as a nomination; the decider is the side's coach or the director of sport | If "either may finalise alone", D17 and D18 collapse: the captain's row becomes the award. **Not recommended**: a minor would then publish an honour about another minor with no adult's hand on it. |
| **A5** | `recognition.manage` splits: `recognition.decide` for principal and director; the office keeps the caps baseline, `is_public`, and recording a decision by naming the decider | If the office keeps deciding, `honour.decided_by` (D5) is still added, defaulting to the recorder. |
| **A6** | Recognition carved out of `superadmin` as safeguarding is | If not, D7's RESTRICTIVE cut is dropped and the owner's key can award a child an honour at any school; the design does not otherwise change. |
| **A7** | The scorer does not nominate | If he does, he gets D15's path with `scorer` in place of the honour gate; nothing else moves. |
| **A8** | The repository's hat-trick rule is the validated contract; a hat-trick is an achievement, never a record | If hidden, it leaves `player_milestone`'s reads and the pad's cue, and D20 has one fewer kind to retract. |
| **A9** | The side's live milestone notice stays; parent "your child" alerts and anything beyond the side wait for the seal | D6 is this. If parents are to be told live, D6's family card is drawn at once with a dashed "not yet sealed" outline. |
| **A10** | Derive achievements, bests and records; store only decisions, nominations, publication and the notice's "once" | If stored, F4 (D19–D21) becomes a rebuild job with its own revisions table, and R4, R5, R9 roughly double. |
| ★ **A11** | No public record boards or personal bests; public recognition is A5 and A6 only | If any board goes public, D22 is reversed and a child's performances across matches become linkable in public, which `PUBLIC_DATA.md` A3 forbids. **Do not.** |
| ★ **A12** | No `public_photo` consent; no photo of a pupil anywhere public | No design here places a photo. **Do not.** |
| ★ **A13** | Reuse `public_name_consent`, the never-public mark and names-off; no second consent table | D11 confirms it. A second table would let two consents disagree about one boy. **Do not.** |
| **A14** | Season labels come from the `season` row | Nothing here changes. |
| **A15** | The Season Awards tab's rankings stay for staff, labelled; hidden from pupils and parents | D23. If pupils may see them, STEP4's "no leaderboard on a family screen" is reopened; say so there first. |
| **A16** | The season captaincy honour is "the captain" for Player of the Match; the vice-captain when the captain is not playing | D14. If a per-match captain mark is wanted, 138 D3 is reversed and `is_captain_of()` reads `match_squad` as well; D15–D18 are unchanged. |
| **A17** | Colours: the side's coach nominates; the director decides; the principal decides when the director nominated | D9's conflict rule is written for this. |
| **A18** | Staff recognition last, in a small table beside `honour` | Out of this document's scope except that D4's masking rule applies to it too. |

Assumptions about the repository that I did not verify by running anything:

| # | Assumption | If wrong |
|---|---|---|
| **A19** | A guardian receives the side's `team`-scope notices for her child's side (STEP4 draws Notices on her Home) | D6's "she already has the live team notice" is false; she then gets only the sealed family card, which is the stricter outcome. |
| **A20** | GA-I36 A2 lands first and gives `milestone_notice` and `notification` a `retracted_at` | D20 and D21 add the column in their own migration. |
| **A21** | `is_captain_of(p_player, p_team, p_season)` is built as 138 phase C describes, or is built by R7 | R7 builds it. |
| **A22** | The staff To-resolve queue (GA-I09 O7) exists to carry a row | The nomination and the flag are shown on the fixture's staff sheet alone until it does. |
| **A23** | `tables.mjs`'s `masked` map takes a column and a capability, and the generator writes the column rule | Opus writes the mask by hand in the migration; the rule in D4 stands. |

---

## 2 · F1 — what may be shown, and to whom

### 2.1 Plain words

A boy's recognition is a part of his sporting record, so it is read by the people who read that record: his side, his coaches, his parents, the office, and the school's analyst and media officer. That is what `honour`, `milestone_notice` and `recognition()` already do under `player.profile.read`, and it stays. Nobody at another school reads it, and the public reads two things only. The new rules are about the parts that are not sporting facts: why something was withdrawn, who was nominated and not chosen, and lists that put one boy above another.

### 2.2 The things

| thing | what it is | stored or derived |
|---|---|---|
| **honour** | colours, half colours, honours, captain, vice-captain, player of the season, a named award; **new:** `player_of_match` tied to a match | stored (`honour`) |
| **achievement** | fifty, hundred, five-for, hat-trick, career runs and wickets, a cap | derived (`player_milestone`, `team_cap`) |
| **personal best** | highest innings and best bowling, per class group and format | derived (R5 `player_best`) |
| **record** | the leading eligible performance for metric × scope × format × division × class group; joint and former holders | derived (R9) |
| **nomination** | a captain's Player of the Match pick; a coach's Colours nomination | stored (R7/R8) |
| **the decision's working** | `decided_by`, `derived_from` (the suggestions and figures at decision time), the Colours evidence checklist | stored, staff-side |
| **a withdrawal** | `withdrawn_at`, `withdrawn_kind` (D21), `withdrawn_reason` | stored on `honour` |
| **a notice** | "Fifty for Rohan Pillay" to the side; "Player of the Match: R Pillay" to the side; a parent's "your child" card | stored (`milestone_notice`, `notification`) |

### 2.3 The matrix

"Yes" means through a capability the role already holds, scoped as it is today. "Name" means the full name, because every signed-in reader here is inside the school. Nothing in this table widens a role.

| reader | honours (live) | withdrawn honour | reason | achievements | bests | records | nominations | decision's working | live notice | sealed "your child" |
|---|---|---|---|---|---|---|---|---|---|---|
| **the pupil himself** (`selfaccess`, `player`) | yes | **yes**, "withdrawn · date" | no (D4) | yes | yes | his own standing (D23) | his own captain's pick, its state (D18) | no | yes (the side's) | n/a |
| **team-mates** (`player`, side-scoped) | yes (the side's board) | **no**, absent | no | yes | yes (career figures they read today) | the side's board as D22 draws it for pupils | **never** | no | yes | no |
| **the captain** | as a team-mate | as a team-mate | no | as a team-mate | as a team-mate | as a team-mate | only his own | the suggestions' figures only (D16) | yes | no |
| **his parents** (`guardian`) | her child's | **yes**, "withdrawn · date" | no | her child's | her child's | her child's standing only (D23) | **never** (not even that he was nominated) | no | yes (A19) | **yes**, after the seal (D6) |
| **team-mates' parents** | no (not her child) | no | no | no | no | no | never | no | yes, the side's news | no |
| **the side's coach, assistant, team manager** | yes | **yes**, with date | **no** unless he is the withdrawer or holds `recognition.decide` | yes | yes | full board (D22) | the side's (D8) | the side's | yes | n/a |
| **director of sport, principal** (`recognition.decide`) | yes | yes | **yes** | yes | yes | full | all at the school | all | yes | n/a |
| **the office** (`recognition.manage`) | yes | yes | **no** (D4) unless it withdrew | yes | yes | full | all at the school (read) | all (read) | yes | n/a |
| **analyst** | yes | no | no | yes | yes | full, figures | never | no | no | n/a |
| **media** | yes | no | no | yes | yes | full | never | no | yes | n/a |
| **scorer** (one fixture) | the side's rows, as RLS already allows; no screen draws them | no | no | the pad's tentative cue | no | no | never | no | the pad's cue | n/a |
| **DSO** | yes | yes | through `audit_log()` on a concern | yes | yes | no | through the audit on a concern | through the audit | yes | n/a |
| **another school** | only through a `passport_consent` the family gave (as today) | no | no | passport lines as today | the dossier's career figures, five days, staff (as today) | **never** | never | never | never | never |
| **competition admin** | no (an honour is a school's) | no | no | no | no | no | never | no | no | n/a |
| **spectator, scout** | the public board only | no | no | the public live page only | no | no | never | no | no | n/a |
| **superadmin, platformadmin** | **no** (D7); support reaches a school as one of its roles for an hour, audited | | | | | | | | | |
| **the public** (signed out) | **A5:** `is_public`, named by L2, never-public absent (D12) | **never** | **never** (`NEVER_PUBLIC`) | **A6:** the live page's line, named by L2 | **never** (A11) | **never** (A11) | never | never | never | never |

### 2.4 Decisions

**D1 · The read rule stands.** A boy's honours, achievements and bests are read under `player.profile.read` and `player.performance.read` as today. No new read capability for the sporting facts; the new capabilities are for deciding (A5, A6) and for the board (D22).

**D2 · A citation is filtered at the writer.** `honour.citation` is a coach's free text about a child and is read by his team-mates. It passes the writer-side filter SCRBRD-138 §5.2 gives the coach's plan (SG-10's list: no health or load, no reason for anyone's absence, no name of another school's child beyond the public label, no derisive words), and the refused words are shown back. One list, not a second copy. A citation is positive by construction (spec principle 4); the filter makes that true of the words, not only the intent.

**D3 · A withdrawn honour leaves every screen another child can open and stays on three.** `recognition()`, `passport()` and the honours board keep filtering `withdrawn_at IS NULL` for every reader except: the pupil himself (`selfaccess`), his guardian, and a holder of `recognition.decide` or `recognition.manage` at his school. For those three the row is returned with `withdrawn_on` and reads "Half colours 2026 · withdrawn 3 Oct 2026". Nothing says why. SCRBRD-138 §1.3's "nothing is demoted on a screen a team-mate sees" holds because the team-mate's screen simply no longer has the row.

**D4 · `withdrawn_reason` is masked at the table.** Today `honour.masked` is `{}`, so any reader of the row could select a reason that may be a conduct matter. It becomes masked under `recognition.decide`, with the withdrawer and `audit.read` also able to read it. The pupil does not read it through `selfaccess`, though he reads his own conduct record: the text was written about a decision, not for him, and may name a third party ("awarded in error; the century was D Erasmus's"). The school tells the family in person, as it would any conduct matter. The reason never leaves the database to a screen a child can open, to a parent, to the side's coach unless he wrote it, or to the public (`NEVER_PUBLIC` already lists it).

**D5 · Every honour names its decider.** `honour.decided_by` (an `app_user` at the school) is added beside `awarded_by` (the recorder). Existing rows are backfilled with `awarded_by`. For `player_of_match` it must hold `recognition.match.award` over the side; for the rest, `recognition.decide`. When the office records a decision it did not make (A5), the named decider is sent a staff notice ("The office recorded Full colours for R Pillay as your decision, 3 Oct"), so a false attribution is seen by the person it names. Pupils and parents see the decider as a role word ("decided by the coach"); staff see the name; the audit holds both.

**D6 · Two notices, two moments.** The side's live notice ("Fifty for Rohan Pillay", team scope, `news.read`) stays as built: it is the team's news inside the school, and GA-I36 A2 retracts it on a void. A notice about *her* child to a parent, and the STEP4 G14 milestone card with its share action, are produced only when the innings is sealed and standing (`match_verified` for a match-grain fact, the innings seal for an innings-grain one). Before the seal the family's season card shows the star with a dashed outline and the words "not yet sealed by the scorer". A push payload names nobody, as today.

**D7 · Platform roles hold no recognition.** `recognition.*` joins `safeguarding.*` in the carve-out from `superadmin` (`roles.mjs` 101), and `honour`, the nomination table and the record-definitions table get the same RESTRICTIVE cut `db/57` gives the safeguarding tables: false for any platform-wide assignment. Support reaches a school through `db/22` as one of its roles, time-boxed and audited, which is enough to fix a wrong row.

**D8 · A nomination is read by its nominator and the side's staff.** The nominator reads his own rows (through `selfaccess`, the row names him). The side's coach, assistant coach and team manager, and the school's `recognition.decide` and `recognition.manage` holders, read all nominations for their scope. Nobody else: not the nominee, not a team-mate, not a parent, not the other school, never the public. A boy never learns he was nominated and not chosen.

**D9 · Separation of duties, as the repository already does it.** Two capabilities held by disjoint role sets plus a row check (`scoring.amend.request` / `.approve` is the pattern). Nominate: the captain through the honour gate (D14), the side's coach for Colours. Decide: `recognition.match.award` (coach of the side, director of sport) for Player of the Match; `recognition.decide` (director, principal) for Colours and season honours. Row checks: the decider is not the nominator; the decider is not a live guardian of the nominee (D10); the nominee is not the nominator. `separation.test.mjs` asserts the disjoint sets.

**D10 · A coach does not decide his own son's award.** If the decider holds a live guardian link (`assignment_subject`) to the nominee, the server refuses and the director of sport decides; if the director is the guardian, the principal. The spec's conflict rule covers a nominee deciding his own award; a parent deciding his child's is the case schools actually meet.

---

## 3 · F2 — consent

### 3.1 Plain words

The question is whether one consent, "his name may appear on public pages", is enough for everything recognition will ever put in public. It is, because recognition puts only two things in public: an honour the school has marked public, and a milestone line on the live page. Both are a child's name beside a cricket fact, which is exactly what the consent is about. A separate consent for recognition would be a second switch about the same thing, and a second switch can disagree with the first.

### 3.2 Decisions

**D11 · One consent, judged on the day served.** Public recognition is governed by `public_name_consent` (C1), `player_never_public` (C5) and `public_names_off` (C4), read through `public_name_facts()` and `publicName()`, exactly as the scorecard is. No `recognition_consents` table. The two switches have two owners: `honour.is_public` is the **school's** decision to put an honour on its board; the consent is the **family's** decision whether he is named there. Both must be on for his name to show.

**D12 · What each "no" does, surface by surface.**

| surface | consent live | no consent (C2) or withdrawn (C3) | never-public (C5) | names off for his age group (C4) |
|---|---|---|---|---|
| the public honours board (A5) | "R Pillay · Full colours · 2026 · citation" | "Player · Full colours · 2026", **no citation** | **absent**: the row is not served | "Player …", no citation |
| the live page's milestone line (A6) | "Fifty for R Pillay" | "Fifty for the Batter" | "Fifty for the Batter" | the same |
| the shared milestone card (STEP4 G14) | rendered server-side with the name | rendered with "Batter"; the share action still works | share action disabled | "Batter" |
| the public match page | **no Player of the Match in V1** (Q4) | | | |
| everything signed in | unchanged: the family and the school are inside the consent the terms already give | | | |

A withdrawal changes nothing in the database but the consent record (end-dated, never deleted). The `public_data_changed` trigger on `public_name_consent` already drops the cache; `public_honours()` (R11) must call `publicName()` per row and must not be cached past the day, as the scorecard reads are not.

**D13 · The citation is public only when the boy is named.** SCRBRD-083 Q6 publishes the citation with a public honour. Narrowed: a citation on an anonymised honour ("for his 104 against Kearsney") can re-identify a "Player" against a public scorecard, so it is served only when `publicName()` returned a name. A school that marks an honour public is told, on the switch, that this publishes the citation when he is named.

**Note · Why the never-public boy is absent, not "Player" (part of D12).** On a scorecard a boy cannot vanish without the figures lying, so he is a position. An honours board is a list of boys, and a row reading "Player · Full colours · 2026" is a count that can be joined to a team sheet by anyone who knows the side. The mark exists for a boy who must not be findable; his honour is his, signed in, and not on the board.

**Turning 18 (C6):** unchanged; his own record governs once given. **Clubs (C7):** unchanged. **The passport (`passport_consent`):** unchanged, and it is the only way an honour reaches another school.

**Shared cards already saved.** A card shared before a withdrawal is on someone's phone and cannot be recalled. The consent card's wording should say so in one sentence. It is the same truth as a printed scorecard.

### 3.3 The one check

The consent wording the parent agreed to (STEP4 §4.1 draws v1 as "may appear on public scorecards and the live page") may not name an honours board or a shared card. Before R11 serves the board, Opus reads the version constant. If it does not name them, a v2 wording is issued; a boy whose standing consent is v1 is named on scorecards and the live page as before and appears as "Player" on the board until a v2 record exists; GA-I20's list gets a row "a consent to answer again (new wording)". Kameel decides whether v1's words already cover it (Q3). POPIA wants the purpose named; a board is a new purpose if the words did not name it.

---

## 4 · F3 — the captain's Player of the Match

### 4.1 Plain words

The captain may nominate one team-mate. His coach decides. The nomination is a row with no words in it, so there is no message from a child to an adult, and nothing comes back to him alone: he learns the outcome from the honour posted to the side, as every team-mate does. He may never nominate himself, may only choose from his own side's sheet, and may do it only in a short window after the scorer has sealed the match. What the screen shows him is the same two or three suggestions his coach sees, each with figures he already reads on the scorecard.

### 4.2 Decisions

**D14 · Who is the captain.** `is_captain_of(player, team, season)` (SCRBRD-138 §1.2's five tests in SQL; phase C there, built by R7 if not before) with kind `captain`, for the fixture's side and the fixture's school season. If the `captain` is on the match's confirmed sheet, he alone may nominate. If he is not on the sheet, the season's `vice_captain` may. If neither played, there is no nomination and the coach decides alone. No per-match captain mark (138 D3 stands, A16).

**D15 · The nomination is a row, not a message.** `recognition_nomination` (shared with Colours, R8): `kind` (`player_of_match` | `colours` | `half_colours`), `match_id` (POTM), `season_id`, `team_code`, `school_id`, `nominee_player_id`, `nominated_by_player_id` (the captain) or `nominated_by_user_id` (a coach, for Colours), `derived_from` (the suggestions snapshot: each suggested boy, his figures, the log head `seq`), `status` (`open` | `confirmed` | `superseded` | `no_award` | `lapsed`), `decided_by`, `decided_at`, `honour_id`. **No rationale column for a captain's nomination.** SG-9 is met by construction: a structured write with no free text is not a channel. The row is kept for ever, is in the recognition audit (R6), and a DSO opens it on a concern like any record.

**D16 · The gate, stated once.** The server accepts a captain's nomination only when every test passes, and `db/99` proves each false in turn:

| test | source |
|---|---|
| the caller is the pupil the row names (`nominated_by_player_id` is his own `player` row through `selfaccess`) | `assignment_subject` |
| `is_captain_of()` is true for the fixture's side and season, with the captain/vice-captain rule of D14 | `honour` |
| the nominator is on the match's confirmed sheet | `match_squad` |
| the nominee is on the same side's confirmed sheet | `match_squad` |
| the nominee is not the nominator | row check |
| `match_verified(match)` is true (R3: every innings sealed and standing, the match complete) | R3 |
| no `player_of_match` honour stands for this side and match | `honour` unique index (R6) |
| now is before the window closes: 48 hours after the match became verified | row check |
| one open nomination per side per match | unique index |

A nomination made while the honour was live stands if the honour is later withdrawn; the coach's decision is his either way.

**D17 · What he sees, and what he never sees.**

```
┌──────────────────────────────────────────┐
│ ‹ Sat 3 Oct · Hilton U15A v Kearsney     │  the Captain tab, C5 "After" (138 §3.6)
│ …result, figures, over strip as built…   │
├──────────────────────────────────────────┤
│ PLAYER OF THE MATCH                      │  drawn only while D16's gate passes
│ Nominate one team-mate. Mr Dlamini       │
│ decides. You cannot choose yourself.     │
│ Based on batting and bowling only.       │  until P2 (fielding) lands
│                                          │
│  ○ R Pillay   63 (48) · 1/14 (3)          │  2–3 suggestions from R1, same as the coach's
│  ○ K Naidoo   4-0-18-3                   │  figures he already reads under player.performance.read
│  ○ T Cele     31 (22)                    │
│  ○ Someone else …                        │  the rest of the sheet, minus himself
│                                          │
│                     [ Nominate R Pillay ]│  56 px; one confirm sheet; then the row below
├──────────────────────────────────────────┤
│ You nominated R Pillay · Sat 20:14       │  his own row's state, in neutral words
│ With Mr Dlamini.                         │  open
│ Player of the Match: R Pillay · Sun      │  confirmed — the honour, as the side sees it
│ Player of the Match: K Naidoo ·          │  superseded — "the coach decided"; no verdict word
│ the coach decided                        │
│ No award for this match.                 │  no_award
│ The window closed on Monday.             │  lapsed
└──────────────────────────────────────────┘
```

He sees: the suggestions with the "why" as figures; the sheet; his own nomination and its state. He never sees: the opposition's players as nominees (another school's children); the coach's reason; any word like "rejected" or "declined"; whether the coach "followed" him (the system does not track it, spec §9.1); any other nomination (there is only his); anything in 138 §4. Suggestions never pre-select and the button is disabled until he chooses. Floors: 12 px text, 44 px targets, 56 px for the one tap, `prefers-reduced-motion` honoured, no colour alone.

**D18 · How it reaches the coach, and how the answer reaches the side.** The row appears on the coach's fixture staff sheet under "Player of the Match" and as one row on his To-resolve queue (GA-I09 O7; A22): "Player of the Match to decide · the captain nominated R Pillay · by Mon 20:14". The coach taps **Confirm** (one tap, a confirm sheet: "This awards Player of the Match to R Pillay and tells the side"), or **Choose another** (the same suggestions, the same sheet), or **No award**. Confirm or Choose writes the `honour` (kind `player_of_match`, `match_id`, `decided_by` = the coach, `derived_from` from the nomination, `nomination_id`) and sets the nomination's status; the honour's own notice goes **to the side** at team scope ("Player of the Match · Sat v Kearsney: R Pillay"), so the captain learns it as his team-mates do and no notice names him alone. A system notice to the captain is allowed by `db/57` but is not sent: his screen reads his own row.

**Shared Player of the Match:** none in V1; one per side per match (Q5). **Cross-school:** never in V1 (A4). **An 18-year-old captain:** no difference (138 §6).

---

## 5 · F4 — a corrected score takes an honour back

### 5.1 Plain words

Two kinds of thing, two rules. A derived item is a reading of the log, so when a ball is voided the reading changes by itself: the fifty is gone from the passport on the next load, the record returns to its former holder, nothing is written. What was *said* about it must be unsaid: the notice, the parent's card, the public line. A decided award is a person's statement. The system does not take it back and never hands it to someone else; it tells the person who decided that the figures he cited have moved, and he withdraws it or lets it stand.

### 5.2 Decisions

**D19 · A flagged award returns to its decider.** A trigger on the void (`WHEN NEW.kind = 'void'`), beside GA-I36 A2's `milestone_retract()`: for each standing `honour` with `match_id` = the voided ball's match (`player_of_match`; later any match-tied kind), re-derive the awardee's figures for that match through the SQL mirror of R1's facts and compare them with `derived_from`; also compare `match_result()`'s `result_hash` with the one stored at decision. If either moved, insert a `recognition_review` row (`honour_id`, `reason` `figures_moved` | `result_moved`, the before and after figures, `opened_at`) and a staff notice to `decided_by`, falling back to the holders of `recognition.match.award` over the side if his assignment has ended. The award **stands** until he acts. He may **withdraw** (D21, kind `correction`) and, as a separate act, award another boy as a new honour by the ordinary path; or **let it stand**, which closes the review with his name. The system never writes the second honour.

**D20 · Everything said is unsaid, to the same audience.** On a void: GA-I36 A2 sets `retracted_at` on the falsified `milestone_notice` and its `notification` and sends one low-urgency "withdrawn" notice to the side. Added here: the parent's sealed "your child" notice (D6) is a `notification` and is retracted the same way, with the family words of §6; the STEP4 card is not drawn once its milestone no longer folds; a record notice (D25) is retracted the same way; the public line vanishes from the fold and GA-I36 A1's team-level "corrected" line appears. A mark retracted and then **re-reached** (a later correction, or an N6 replacement) clears `retracted_at` on the same row and sends no second notice (the row is the "once"); GA-I36 A2's test "re-reached → no second notice" should be read this way and not as "stays retracted" (Q7). A mark that **newly** folds after a correction (a hat-trick made by voiding the ball between two wickets) is noticed once, dated by its ball, with "after a correction" in the body.

**D21 · A withdrawal says what kind it is.** `honour.withdrawn_kind IN ('correction', 'other')`, NOT NULL with `withdrawn_at`. `correction` is the only kind the side is ever told about: the honour's team notice is retracted and one low-urgency notice says "Player of the Match · Sat v Kearsney: the award was withdrawn after the scorecard was corrected." It names nobody. For `other` the team notice is retracted and nothing is said; the school speaks in person. The reason text is required for both (the existing constraint) and masked for both (D4). The honours board drops the row through the `honour` table's existing `public_data_changed` trigger.

**Derived items need nothing written.** `player_milestone`, `player_best` and the record views fold `ball_event_live`, which skips the void, so a corrected 100 → 99 removes the hundred, moves the best and restores the former record holder on the next read, with the chronology intact. Former holder and invalidated performance are kept distinct by construction: a former holder is in the view with a later date beside him; an invalidated performance is not in the view.

---

## 6 · F5 — boards inside the school

### 6.1 Plain words

A pavilion board names the boy who holds the record and the boys who held it before him. It does not list the whole side from best to worst. That is the line: a pupil may see a record and its holders; he may not see his team-mates ordered by a figure, and neither may his parent. Staff may, because selecting a side is their job and the figures are labelled with their method.

### 6.2 Decisions

**D22 · Boards are signed in, anchored on the side the performance was for.** A record row (R9) carries the match's side code (division at the time), never `player.team_code`, and RLS anchors on it. So a U15A boy reads the U15A board, including a performance by a boy now in the 1st XI or no longer at the school, named, because the honour table already keeps an honour on the side it was awarded for. Full boards (holder, joint and former holders, and a staff-only "this season" list ordered by the metric with its minimum qualification stated) are read by the side's staff, the director, principal, office, analyst and media. **Never public** (A11).

**D23 · A pupil sees the record; a parent sees her child.** The pupil's Team screen gets a "Records" section listing each board of his side as a chronology: "Highest innings · U15A · T20 · School Records · in verified SCRBRD matches since Oct 2026 — 87* D Erasmus v Kearsney, 12 Sep 2026 · formerly 71 K Naidoo, 2025". No ordered list of the current side. His passport shows his own best per class group and, where he holds or held a record, one laurel line; never "you are fourth". The family app draws **no board**: her child's card shows his bests and any record he holds or held, and nothing about another family's child (STEP4 §6: "no leaderboard of the team's parents' children on a family screen"). The Season Awards tab's rankings (`seasonAwards.js`) and the MVP figure are hidden from the pupil and family personas (A15) and labelled with their method for staff.

**D24 · Headline and groups.** The headline best on a passport is the School Records group; Friendly and other groups sit under a filter with their label and are never merged (A3). Empty states are the spec's four (no recognitions yet · awaiting verification · not enough eligible data · historical coverage incomplete) and never look like a confirmed honour.

**D25 · A record is noticed at verification, not live.** A record is a comparison across history, so its notice to the side ("School record · Highest innings U15A T20: 87* D Erasmus") is written when `match_verified` becomes true, not on the ball; a live cue on the pad may say "a school record if it stands". Retracted under D20 if a later correction removes it.

---

## 7 · Words

| reader | where | words | never |
|---|---|---|---|
| **the side** (team notice) | Notices | "Fifty for Rohan Pillay · 63 against DHS." · "Player of the Match · Sat v Kearsney: R Pillay" · "The notice 'Fifty for Rohan Pillay' was withdrawn after a correction." · "Player of the Match · Sat v Kearsney: the award was withdrawn after the scorecard was corrected." | a reason of kind `other`; who asked for the correction |
| **the pupil** | Passport, Honours tab | "Half colours 2026 · withdrawn 3 Oct 2026" · "Your best: 63 v DHS · School Records" · "U15A highest innings · since Oct 2026" (a laurel, only if his) | the reason; "you are 4th"; "demoted"; a team-mate's withdrawn honour |
| **the captain** | Captain tab | §4's sketch: "Nominate one team-mate. Mr Dlamini decides. You cannot choose yourself." · "the coach decided" | "rejected", "declined", "overruled"; the coach's reason; an opposition name as a nominee |
| **the parent** | her child's card, Notices | "Rohan's first fifty · 63 v DHS · sealed by the scorer, 12 Sep" · "not yet sealed by the scorer" (dashed) · "The fifty noticed for Rohan was withdrawn after the scorecard was corrected." · "Half colours 2026 · withdrawn 3 Oct 2026 · the school can say why" | the reason; another child's standing; a board |
| **the coach** | staff sheet, To-resolve | "Player of the Match to decide · the captain nominated R Pillay · by Mon 20:14" · "This awards Player of the Match to R Pillay and tells the side." · "The figures this award cited have changed: 104 (71) → 99 (70). Withdraw, or let it stand." | "approve your own"; a button the server would refuse |
| **the office** | the honour sheet | "Recorded by the office as Mr Dlamini's decision, 3 Oct" | the reason text unless it withdrew (D4) |
| **the public** | the honours board, the live page | "R Pillay · Full colours · 2026" · "Player · Full colours · 2026" · "Fifty for R Pillay" / "Fifty for the Batter" | a withdrawn honour; a reason; a citation on "Player"; a never-public boy's row; a photo; a record; a rank |

Times are the fixture's time zone; a date is added once it is not today; nothing under 12 px; a word beside every badge (spec §13's monochrome set: rosette, pin, laurel, chevron; dashed outline = not yet sealed; history mark = former holder).

---

## 8 · Decisions, numbered

| # | decision |
|---|---|
| **D1** | Sporting facts (honours, achievements, bests) stay under `player.profile.read` / `player.performance.read`; no new read capability for them. |
| **D2** | `honour.citation` passes SCRBRD-138 §5.2's writer-side filter (SG-10's list), one list shared. |
| **D3** | A withdrawn honour is absent for every reader except the pupil, his guardian and `recognition.decide` / `recognition.manage` holders, who see "withdrawn · date" and no reason. |
| **D4** | `withdrawn_reason` is masked at the table to `recognition.decide`, the withdrawer and `audit.read`; never the pupil, the parent, the side's coach (unless he withdrew), or the public. |
| **D5** | `honour.decided_by` added beside `awarded_by`; the office recording a decision names the decider, who is told; pupils and parents see a role word, staff the name. |
| **D6** | The side's live notice stays; a notice to a parent about her child and the shareable card wait for the seal; a dashed "not yet sealed" star until then. |
| **D7** | `recognition.*` carved out of `superadmin`; RESTRICTIVE cut on `honour`, nominations and record definitions for platform-wide assignments, as `db/57`. |
| **D8** | A nomination is read by its nominator and the side's staff (and `recognition.decide` / `manage` at the school); never the nominee, team-mates, parents, another school or the public. |
| **D9** | Nominate and decide are disjoint capability sets plus row checks: decider ≠ nominator, nominee ≠ nominator, decider not a live guardian of the nominee. |
| **D10** | A coach who is the nominee's guardian is refused as decider; the director decides, or the principal if the director is. |
| **D11** | One consent: `public_name_consent` + never-public + names-off, judged on the day served; `honour.is_public` is the school's switch, the consent the family's; both needed for a name. |
| **D12** | No consent → "Player" and no citation; never-public → absent from the board; the live line → "the Batter"; the shared card renders with `publicName()`; no Player of the Match on the public match page in V1. |
| **D13** | A citation is public only when the boy is named. |
| **D14** | The captain is the season `captain` honour holder if on the sheet, else the `vice_captain`; neither on the sheet → no nomination. |
| **D15** | The nomination is a row with no free text; one table shared with Colours; kept for ever and in the audit. |
| **D16** | Nine gate tests, each proved false in turn; the window is from `match_verified` until the coach decides or 48 hours pass. |
| **D17** | The captain sees the same 2–3 suggestions as the coach, figures only, "based on batting and bowling only"; never the opposition, a reason or a verdict word. |
| **D18** | The coach confirms, chooses another or records no award in one tap; the honour's notice goes to the side; nothing goes to the captain alone. |
| **D19** | A void re-derives a match-tied award's cited figures and result; a difference opens a `recognition_review` row to the decider; the award stands until he withdraws or closes it; the system never awards the next boy. |
| **D20** | Every notice a void falsifies is retracted to its own audience, the parent's and a record's included; a re-reached mark clears `retracted_at` on the same row; a newly folded mark is noticed once, "after a correction". |
| **D21** | `honour.withdrawn_kind IN ('correction','other')`; only `correction` is announced to the side, naming nobody. |
| **D22** | Boards are signed in, anchored on the performance's side code; staff see full boards with a method-labelled season list; never public. |
| **D23** | A pupil sees each record as a chronology, never an ordered list of his side; his passport shows his own bests and any record of his; the family app draws no board; the Awards tab's rankings and MVP are hidden from pupils and parents. |
| **D24** | School Records is the headline group; other groups under a labelled filter; the spec's four empty states. |
| **D25** | A record is noticed to the side at verification, not on the ball. |

---

## 9 · Questions for Kameel

Each with a recommendation. **★** marks one about a public page.

| # | question | recommendation |
|---|---|---|
| **Q1** | May the pupil read his own `withdrawn_reason` through `selfaccess`, as he reads his conduct record? | **No** (D4). The text may name a third party and was written about a decision. The school tells him in person. |
| **Q2** | Should the parent see a withdrawn honour at all? | **Yes**, the fact and date, no reason (D3). Hiding it from her while her son sees it on his passport makes the app disagree with the dinner table. |
| ★ **Q3** | Do the words of the public-name consent (v1) already cover the public honours board and a shared milestone card? | **Opus reads the constant; if they do not, a v2 wording and GA-I20 row** (§3.3). A board is a purpose; POPIA wants it named. |
| ★ **Q4** | Player of the Match on the public match page? | **Not in V1.** It is a child's name on a new public surface; if wanted later it follows L2 and needs your nod as information officer. The honours board (A5) carries it when the school marks it public. |
| **Q5** | Shared Player of the Match (two boys)? | **Not in V1**: one per side per match (unique index). Add by competition policy later. |
| **Q6** | The captain's window: 48 hours from verification? | **Yes.** Saturday evening to Monday evening; a nomination a week later is noise, and the coach can always decide without one. Alternative: until the next fixture of the side. |
| **Q7** | GA-I36 A2's "re-reached → no second notice": read as "the same row un-retracts and no new notification" (D20)? | **Yes**; say so in A2's `db/99` section, or a fifty voided and re-reached stays hidden. |
| **Q8** | Should a coach who is the nominee's guardian be refused as decider (D10)? | **Yes.** It is the conflict schools actually meet. Cost: one row check against `assignment_subject`. |
| **Q9** | The staff-only "this season" list ordered by the metric on a record board (D22): keep it, or records only? | **Keep for staff**, labelled with its minimum qualification; it is what `seasonAwards.js` already does signed in. |
| **Q10** | Should the pupil's Team screen show the record chronology (D23), or only his own standing? | **The chronology.** It is the pavilion board, and a former holder is positive recognition. If you prefer, his own standing only is a one-line change in the screen. |
| **Q11** | Does the office's recording of a decision (D5) send the named decider a notice? | **Yes.** A false attribution of an honour to a coach should be seen by the coach. |
| **Q12** | A record's live cue on the pad ("a school record if it stands", D25)? | **Yes, tentative, dashed, as the milestone cue is**; the notice waits for verification. |

---

## 10 · What this changes in the build slices

The reconciliation's R1–R12 stand in order. Changes are listed per slice; tiers follow `CLAUDE.md` (Opus for schema, policy, RLS and scoring; Sonnet for screens over an existing API, Opus review). Two slices are added. Nothing before the 15 October test; nothing in the 12 October freeze.

| slice | change from this design | tier |
|---|---|---|
| **R1 · Facts** | none; D17's suggestions and D19's SQL mirror read it | Opus |
| **R2 · Pad reads the facts** | D25's tentative record cue is a later addition once R9 exists; nothing now | Sonnet, Opus review |
| **R3 · Fixture class and `match_verified`** | none; D6, D16 and D25 depend on `match_verified` | Opus |
| **R4 · Milestones say where they came from** | adds D3 (`recognition()` returns withdrawn rows with `withdrawn_on` to the three readers), D6 (the family's sealed notice and the dashed star; the parent's notification written at seal, not on the ball), and the parent's words of §7 | Opus (views, notices to a parent); Sonnet the Honours tab and family card |
| **R5 · Personal bests** | D22's anchor (the match's side code), D24's headline and filter, D23's passport lines; reads under `player.performance.read` as career figures are | Opus the view; Sonnet the screens |
| **new · R5b · Rankings off the family screens** | D23's last sentence: the Season Awards tab's rankings and MVP hidden from the pupil and family personas, labelled with their method for staff; a `smoke-browser-pupil` check that no ordered list of team-mates is drawn | Sonnet, Opus review; can land any time after the freeze |
| **new · R5c · Capabilities and the carve-out** | A5/A6 and D7, D9: `recognition.decide`, `recognition.match.award` through `ADDED_SINCE_01`; `recognition.*` out of `superadmin`; the RESTRICTIVE cut on `honour` (and later tables) for platform-wide assignments; `separation.test.mjs` asserts the disjoint sets; D4's mask on `withdrawn_reason` in `tables.mjs` and the migration; D5's `decided_by` with backfill and the office's notice; D21's `withdrawn_kind` with backfill `other` | **Opus** (policy, schema, RLS); before R6 and R8, which both need it |
| **R6 · Player of the Match, the coach's path** | takes D5, D9, D10 (guardian conflict), D18's notice to the side, D21's withdrawal kinds; `derived_from` stores the suggestions and the log head and `result_hash` for D19; a recognition audit table joined to `audit_log()` as planned | Opus; Sonnet the staff sheet |
| **R7 · The captain's nomination** | D14–D18 as §4: `recognition_nomination` (D15's shape, no rationale for a captain), `is_captain_of()` if not built, the nine gate tests in `db/99`, the Captain tab block, the To-resolve row; RLS per D8 | Opus; Sonnet the two screens |
| **R8 · Colours** | shares R7's table (`kind` colours / half_colours, `rationale` allowed for a coach's nomination, filtered by D2's list); D9 and A17's row checks; D2's citation filter | Opus; Sonnet the Management screens |
| **R9 · School record boards (V1b)** | D22–D25: anchor on the side code, the chronology view for pupils and the full view for staff, no family board, the record notice at verification, the spec's empty states | Opus the SQL; Sonnet the screens |
| **R10 · Corrections reach awards** | D19–D21 as §5: the void trigger comparing `derived_from` and `result_hash`, `recognition_review`, retraction of the honour's and the parent's and a record's notices, the un-retract rule, the "after a correction" notice; the decider's To-resolve row and sheet | **Opus**; after GA-I36 A1 and A2 |
| **R11 · Public honours board and staff recognition** | D11–D13: `public_honours()` calls `publicName()` per row, never-public rows absent, citation only when named; §3.3's wording check and, if needed, the v2 consent and GA-I20 row; `smoke-public` asserts a "Player" row has no citation and a never-public boy has no row | Opus; Sonnet the school page |
| **R12 · Scorer completeness (V2)** | none; when P2 lands, D17's "based on batting and bowling only" line is dropped | Opus |

Order: R1 → R2 and R3 → (GA-I36 A2) → R4 → R5, R5b, R5c → R6 → R7 → R8 → R9 → R10 → R11 → R12. R5b can go anywhere after the freeze; R5c must precede R6.

What no slice does: adds a stored score, a stored record holder or a counter beside the log; sends a notice to a child alone; puts a record, a rank, a photo or a reason on a public page; adds a runtime dependency or a second token set.
