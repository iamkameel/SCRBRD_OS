# How a union selector finds the boys whose families named his union

**Status:** design (Fable, 30 Oct 2026). Kameel answered all six questions in §9 "as recommended" on the Build Board, 30 Oct 2026 21:05 SAST. Nothing here is built yet; the build is §10, from db/125.
**Stands on:** `db/124_union_passport.sql` on `origin/claude/wip-union-passport` (built, red-teamed, not pasted; the fix pass of 30 Oct is taken as given: `passport_open()` is not the application's, a read is logged only when the union arm is the sole way in, the reader's name and role are copied into the log, the picker offers schools, his union and CSA Schools); `docs/design/READERS_child_data.md` (§2 the readers, B2, Q, §7 Q14 and its 30 Oct exception); `docs/design/GA-I24-I25_compare_and_combine.md` (D1–D14, §5, Q7); `docs/policy/PUBLIC_DATA.md`; `packages/policy/src/roles.mjs` (`unionselector`, `competitionadmin`) and `capabilities.mjs` (`passport.union.read`, level 2); the Passport tab of `apps/web/src/views/SettingsView.jsx`.
**Reader:** Kameel on a phone first. No child's real name appears; the boys are "the opener", "boy A", and the adults are roles.

---

## 0 · In one page

db/124 opens a boy's passport to a named Union Selector when his family has named that union, every read logged and shown to the family. It opens the passport by the boy's id and nothing lists the boys. Kameel deferred the list on 29 Oct (U6): "a list later, as its own decision, each read logged."

This design is that decision. In one sentence: **a selector lists only the boys whose consent to his institution is in force at the moment he asks, filtered by school or age group, each row carrying the boy's name, school and side and no figure; every row shown is a logged read his family sees; nothing is kept, sorted by merit, compared, exported or annotated.**

The list is **the same door as the passport, asked for many boys at once**: it is computed from `passport_union_consent()`'s own test (in force, naming his union or CSA Schools, the caller a named reader there), so a row and the passport it leads to can never disagree. A consent withdrawn or lapsed takes the row away on the next read, with no reason given to the union. A boy whose family named CSA Schools and not his province appears to the federation's selector and not to the province's; the reverse likewise; a family's choice of one is never shown to the other.

Seven decisions are made here (§2), nine things are refused (§4), and six questions go to Kameel with a recommendation each (§9). The one that changes a shipped rule is the clock (§7): link liveness runs on the database's day and everything else about a child runs on SAST, so a row can outlive its consent by two hours after midnight; the recommendation is to put `consent_giver_live()` on SAST in the list's migration.

---

## 1 · The problem

A provincial union's selectors pick age-group sides (U13 to U19) from the province's schools; CSA Schools picks national schools sides from the provinces. Each has a dozen to a few hundred boys whose families have said "the union may read his record". Today a selector must be handed a boy's id by somebody who has it (his school's office, the family) and open the passport one at a time. That is safe and useless: the family gave the consent so the union would *find* him.

What the list must not become: a province-wide file of named children with figures beside them, sortable, kept from season to season, searchable by anyone at the union. db/124 made the passport a door with a record; the list must be a door with a record too, and no wider than the consent it stands on.

---

## 2 · Decisions

**D1. The list is the consent set, computed live, nothing else.** `passport_union_list()` returns the boys for whom `passport_union_consent(boy)` would return a consent for *this caller* at *this institution*: `withdrawn_at IS NULL`, `consent_giver_live(granted_by, player_id, granted_at)` (db/122 as db/124 §5 rewrote it: a boy's own word only if he was eighteen on the day he gave it; a guardian's word not past a reopened link), the recipient `passport_consent_recipient_ok()` (his own province's union, or the federation, not archived), and the caller `passport_union_reader_at(org)` (held at the institution, no team, no support session, no platform-wide assignment, no pad). Nothing is stamped or cached: a row exists only while the passport would open. The list is `STABLE` in its membership test and `VOLATILE` only because it logs (D5).

**D2. Filtered before it is shown; never "everyone".** The screen asks for the institution (only if the caller reads at two: his union and CSA Schools), then **a school or an age group, at least one**, and optionally a name fragment. The function refuses a call with neither school nor age group (`choose_a_school_or_age_group`). The age group is read from the boy's current side's code (`player.team_code`, the "U15" of "U15A"), which PUBLIC_DATA §3 N1 leaves standing even in public; no date of birth is read. The schools offered are those whose `school_union()` is his union (every school, for the federation): a province's schools are public knowledge and the selector holds `school.read` already.

**D3. A row is his name, his school and his side. No figure, no rate, no role, no order of merit.** The row carries `passport_name()`'s name (the same function, so the two names cannot differ), his school's name, his side's code, and the institution under which he appears. It carries nothing of the passport's lines: no runs, no wickets, no honour, no cap count. A list with figures is a leaderboard across schools (PUBLIC_DATA A3's reason, signed-in), and a list sorted by a figure is a selection verdict the app wrote (GA-I24/25 D3). The list is ordered by school, then surname, then first name. Q4 asks whether the row may carry his playing styles.

**D4. A boy appears under the institution his family named, and the other institution is never told.** A consent naming his province's union puts him in that union's selectors' lists; one naming CSA Schools puts him in the federation's selectors' lists. A person who is a named reader at both (a provincial manager also appointed at CSA Schools, with two assignments) sees one row, labelled with the institution whose consent admits him; where both admit him, the earlier consent (`passport_union_consent()`'s own `ORDER BY granted_at`), and the log names that one. No row, header or count says "also named CSA Schools" or "not named to the province": the consent rows are the family's alone (db/124 §2, `passport_consent_union_family_only`), and the list keeps that.

**D5. Every row shown is a logged read, in the same log, as `what = 'list'`.** Kameel's deferral said "each read logged", and a row carries the boy's name, which `passport_name()` already logs as a read. So each list answer writes one `passport_union_read` row per boy returned (reader name and role copied in as db/124 §6 Q3 does, the consent that admitted him, `what = 'list'`) and one `access_log` row per school whose boys were returned (`log_restricted_read('passport_union', ARRAY[ids], ARRAY['list'], school)`, the array form the opposition log already uses, so the school's auditors see the list as one event). The insert is not caught: a list whose record cannot be written is not answered, as db/124's `passport_union_log()` does. Q1 asks Kameel to confirm the family sees these.

**D6. The passport opens from the row as it does today, and Q2 of db/124 stands for that open.** Tapping a row calls `passport()` (and `passport_name()`), which log a `'passport'` read when only the union arm admits the caller. A selector who is also the boy's coach is logged for the list row (see Q2 below, where the recommendation is that the list is always a union act) and, on the open, reads as his coach, unlogged, exactly as db/124 §6 Q2 decided.

**D7. Nothing is kept, compared, exported, posted or annotated.** No saved list, no shortlist, no pin, no CSV, no share, no note on a boy, no "compare two passports" screen, no store on the device (GA-I24/25 D9 extended to the list; the screen re-reads on every open, `Cache-Control: no-store`). The scout's answer in GA-I24/25 Q7 is the union's: "a side-by-side is a shortlist the consent did not describe." A selector who wants a shortlist writes it where unions write them today, outside the system; what he writes down he has read under a logged open, and the system cannot and does not pretend to govern his notebook. Q5 asks whether a recorded shortlist should be its own design.

---

## 3 · Who sees what

| reader | the list | a row | the log of it |
|---|---|---|---|
| **Union Selector** (`unionselector` at his union) | the boys whose in-force consent names his union, filtered by school or age group | name, school, side; opens the passport | each row he is shown is a `'list'` row under his name |
| **Union Selector at CSA Schools** (`unionselector` at the federation) | the boys whose in-force consent names CSA Schools, any province | the same | the same |
| **The same person at both** | one list, one row per boy, the institution that admits him on the row | the same | logged under the admitting consent |
| **A union's principal** | nothing, unless he appointed himself selector (db/124 §6 Q7); then as a selector, under his own name | — | — |
| **Competition organiser** (`competitionadmin`), the union's office, a platform-wide account, a support session, a pad | nothing: `passport_union_reader_at()` refuses each | — | — |
| **The owner's key** | nothing as a union (platform-wide); its own office arm opens a passport as before (db/124 §1; Q8 of db/124 still open) | — | — |
| **The family** (guardian on a live link; the boy himself at any age, db/124 U4) | — | — | "appeared in {name}'s list ({role}), {institution}" grouped per reader per SAST day, under "Who at a union looked", beside the opened-passport lines |
| **His school's `audit.read` holders** | — | — | one `access_log` row per list answer naming the boys of their school, resource `passport_union`, action `list` |
| **The boy's school's office, coaches** | no change: their passport arms are db/116's; they have no union list | — | — |
| **Another province's union** | nothing: `passport_consent_recipient_ok()` is false for a union that is not `school_union()` of his school | — | — |
| **The public** | nothing; no public read touches any of this (PUBLIC_DATA §1, A4) | — | — |

---

## 4 · What never surfaces

Restated so a diff can be checked against it.

1. **No boy without a consent in force to this caller's institution**, at the moment of the call. Not a lapsed one, not a withdrawn one, not one his family gave to the other institution, not one from a province he has left.
2. **No reason a row is gone.** The union is told "no longer open to your union" when an open fails and nothing else: not "withdrawn", not "lapsed", not "moved", not "left school". The consent row and its in-force answer are the family's (db/124 §2).
3. **No figure, rate, honour, cap count or milestone on a row**; no sort by any of them; no count of boys per school in a header beyond what the filtered rows show.
4. **No date of birth, exact age, health, availability, workload, discipline, PII, guardian, contact or note** anywhere on the screen. The role holds no `player.*` capability and the list function reads `player.team_code`, `player.full_name` (through `passport_name()`) and `player.school_id` only.
5. **No "everyone in the province" page.** A school or an age group first (D2).
6. **No store**: no saved list, shortlist, note, CSV, share, pin, post, `localStorage`, IndexedDB or service-worker cache of a row.
7. **No comparison screen** for a selector, and the Analytics compare screen (GA-I24/25 D13, under `analytics.read`) is not his: the role holds neither `analytics.read` nor `player.performance.read`.
8. **No hint of the other institution's consent** on a row or in an empty result (D4).
9. **No unlogged row.** A row shown is a row logged; a list whose log cannot be written is not shown (D5).

---

## 5 · Which boys appear, event by event

| event | the row | why |
|---|---|---|
| Family names his union | appears on the selectors' next read | `passport_consent` insert passes `passport_consent_union_is_his`; in force at once |
| Family names CSA Schools, not his province | appears for the federation's selectors; the province's see nothing | D4; two institutions, two consents (db/124 U1) |
| Family names his province, not CSA Schools | the reverse | the same |
| Family withdraws (anyone of his family on a live link; the boy at any age, db/122 §1d) | gone on the next read; a passport open already on a screen answers no rows | `withdrawn_at` set; D1 computes, nothing is stamped |
| The giver's link ends (a parent's revoked link; the later of leaving school and eighteen, db/62) | gone on the next read | `consent_giver_live()` false: the fam-ended-consent rule of 29 Oct |
| He turns eighteen while at school | stays, on his guardian's consent | READERS Q1: the link stays open while he is at school; nothing widens or narrows by the birthday |
| He gave the consent himself at eighteen | stays while his own self-access link is live | db/124 §5 (1): eighteen on the day he gave it |
| He gave it himself at fifteen (before db/122 shut the door) | never appears, not at eighteen either | db/124 §5 (1) |
| He leaves school and comes back after his links ended | gone from the day his links ended; a consent given before his return does not come back; the family gives it again | db/124 §5 (2), §6 Q6 |
| He moves to a school in another province | gone from the old union's list; stays for CSA Schools | `passport_consent_recipient_ok()` asks `school_union()` of his *current* school at read time; the old consent reads as not in force and the family's screen says so |
| He moves to another school in the same province | stays | the union is still his |
| His union is archived | gone | `o.archived_at IS NULL` |
| The selector's appointment ends, is suspended or expires | the whole list is gone for him | `passport_union_reader_at()` through `app_can()` |
| The selector is also the boy's coach or parent | the row appears (he is listed as a union); the open reads as coach or parent, unlogged (db/124 §6 Q2) | D6, and Q2 below for the row's log |
| The boy's `player` row is deleted | gone; his `'list'` rows go with it | `ON DELETE CASCADE`, as every union read (db/124 U3) |

---

## 6 · Combining: what a list across many schools reveals

A passport is one boy, on his family's word. A list is the set of families in a province who gave that word, and the set is new information. What it reveals, and what is done about each:

| what the list could reveal | allowed? | how it is held |
|---|---|---|
| Which boys in the province his union may read | **yes**, that is the consent's purpose | D1: exactly those and no more |
| Which schools' families engage with the union (counts per school) | tolerated, not drawn | no per-school count or header; a selector filtering by school learns it by counting rows he has already read under log. Not worth a second rule |
| An order of merit across schools | **no** | D3: no figure on a row, no sort by one. Two passports in two tabs is the most the screen allows, as it is for two profiles today |
| Two boys' passports side by side (a compare screen) | **no** | D7; GA-I24/25 Q7's answer for scouts extended to selectors: the consent said "read his record", not "rank him". GA-I24/25 §3 gains a Union Selector row reading "nothing", and its D9 gains the list |
| A boy who was listed last month and is not now (an absence by subtraction: withdrawn, lapsed, moved, left) | cannot be prevented; **nothing is said** | item 2 of §4; the compare design's D8 reasoning: the screen shows what is, never what is not. There is no "recently removed" |
| Which boys' families refused, or never answered | **no** | the list never names a non-consenting boy; the age groups offered are fixed bands, the schools are the province's, so an empty result says only "no consent in force in that band" |
| A standing file kept from season to season | **no** | D7: no store; D1: the list is now, so a boy whose consent lapsed is not in it |
| A match between list names and pseudonymous public scorecards | nothing new | the selector already reads the full name under the passport; public pages give him no figure the passport does not |
| A selector at two institutions learning which institution a family chose | **no** | D4 |

**Re-identification across schools** is the passport's own reach, consented per boy; the list adds the set, which §4 items 3, 5 and 6 keep from becoming a file. **Small-sample inference** does not arise on the list (no figure) and on the passport is db/116's as today. **Leakage by subtraction** is item 2 and the absence row above.

Where this extends GA-I24/25: §3's reader table gains "Union Selector: may compare nobody; no workspace; `passport_union_read` logs the list and each open; never a figure beside a name across schools"; D9's list of things never stored gains "a union's list and any row of it"; §14 A1's CSV check gains `passport_union_list` and `passport` to the reads the generic export must refuse.

---

## 7 · The clock

**The gap.** `consent_giver_live()` (db/122, rewritten in db/124 §5) tests the giver's assignment and subject with `current_date`, which is the database's day: UTC on the pilot's server. Everything else about a child runs on SAST: `sa_today()`, `sa_date()`, `majority_on()`, the family's screen. SAST is UTC+2, so **between 00:00 and 02:00 SAST the database still has yesterday's date**. db/124 §6 left this as its Q5, "link liveness by the database's day rather than SAST's".

**What it does to the list and the passport**, the same way to both, because both ask the same function:

- A guardian link ending today (`valid_until = today`, SAST) reads live until 02:00 SAST tomorrow: the row stays, and the passport opens, two hours into the day the family was told the link had ended. A link beginning today reads not yet live until 02:00. A selector's own appointment (`app_can()` over `role_assignment`, also `current_date`) has the same two-hour shift at both ends.
- The age test does not shift: a boy giving his own consent at 00:30 SAST on his eighteenth birthday is eighteen (`majority_on(born) <= sa_date(now())`), and his self-access link's `created_at <= granted_at` holds, so the consent counts from the first minute of his day. The guardian's link does not end on his birthday while he is at school (READERS Q1), so no row changes at that midnight.
- The family's view groups list appearances **per SAST day** (`sa_date(read_at)`), so a list at 01:00 SAST is shown on the right day. A log row's `read_at` is `timestamptz` and needs no change.
- The screen never caches a list across midnight or at all (D7); the question is only the server's day.

**Recommendation (Q3 below):** the list's migration replaces the four `current_date` tests in `consent_giver_live()` with `sa_today()`, so a child's consent is live on the child's clock, and leaves `app_can()`'s clock for the sweep of every `current_date` in the schema (it reaches every role, not only this one, and belongs to its own migration). After that, the only two-hour shift left here is the reader's own appointment, which cuts off a selector early or late by two hours and widens nothing about a child. "Nothing widens by the clock" (READERS §0 rule 8) is the reason to fix the consent side first.

If Kameel prefers to leave Q5 whole for the sweep, the family's screen says it in one line beside a lapsed or withdrawn consent: "closes by 02:00", and this design changes nothing else.

---

## 8 · The reads it needs, and what each stands on

| part | function or route | new? | stands on |
|---|---|---|---|
| Where the caller reads as a union | `passport_union_orgs()` → (org_id, name, kind) for each institution at which `passport_union_reader_at(org)` is true; empty for everyone else | new definer, `scrbrd_app`'s | `passport_union_reader_at()`, `institution_is_union()` |
| The schools a filter may name | `passport_union_schools(p_org)` → the schools whose `school_union()` is the union, every school for the federation; only if the caller reads at `p_org` | new definer | `school_union()`, `school_federation()`, `passport_union_reader_at()` |
| The list | `passport_union_list(p_org, p_school, p_age_group, p_name)` → (player_id, name, school_name, team_code, org_id, consent_id); refuses neither school nor age group; writes the log before it returns | new definer, VOLATILE | `passport_union_reader_at()`, `consent_giver_live()`, `passport_consent_recipient_ok()`, `passport_name()`'s source of the name (the `player.full_name` column read as owner, never through `passport_name()`, which would log a second time), `log_restricted_read()`, `passport_union_log()`'s pattern |
| The log of a list | `passport_union_log_list(p_org, p_rows)` → one `passport_union_read` row per boy with `what = 'list'`, one `access_log` row per school | new, nobody's to call | `passport_union_read` with its CHECK widened to `('passport','name','list')`; `role_words()` for the role; `log_restricted_read()` |
| The family's view | `passport_union_reads()` | exists; returns `what` already | the screen groups `what = 'list'` per reader per `sa_date(read_at)` |
| The passport from a row | `passport(p_player)`, `passport_name(p_player)` and their existing route | exists | db/124 as fixed |
| The selector's screen | a Selection view for the `unionselector` persona: institution (if two), school, age group, name; rows; tap to passport | new | the API routes above, `Cache-Control: no-store` |
| The family's screen | the "Who at a union looked" block in `SettingsView.jsx`'s Passport tab | exists; gains the grouped list lines | `passport_union_reads` |

Not a new capability, role or table. One CHECK constraint widened on a table that is not yet pasted (the lead decides whether db/124's fix pass takes `'list'` into the CHECK or db/125 alters it; this design assumes db/125 alters it, so db/124 is not reopened). No change to any policy. No read of `born`, no read through any `player.*` capability.

---

## 9 · Questions for Kameel

Each is one decision with a recommendation. "As recommended" is an answer.

**Kameel's answer (30 Oct 2026, 21:05 SAST, Build Board): all six as recommended.** So: 1 yes; 2 yes, always; 3 yes, in db/125; 4 yes, in slice S5; 5 not now; 6 yes, within the consented set only.

1. **Does a list appearance belong in the family's log?** *Recommend: yes.* "Each read logged" was the deferral's own condition, and a row is a read of his name, which the passport already logs. Shown grouped per reader per day ("appeared in R. Naidoo's list (Union Selector), KZN Cricket Union · 3 times on 30 Oct") so the opened-passport lines, which matter more, are not drowned. Under eighteen the boy sees it, as he sees the opens (db/124 U4).
2. **A selector who is also the boy's coach or parent: is his list row logged as a union read?** *Recommend: yes, always.* The list exists only because of union consents and is reached only as a union, so it is a union act whatever else he is; the open from the row then follows db/124 §6 Q2 as built (reads as coach, unlogged). The alternative is Q2 applied to the row too, which leaves a parent unaware her son was in a union's list because the lister was his coach.
3. **Put `consent_giver_live()` on SAST now?** *Recommend: yes*, in the list's migration (§7), leaving `app_can()`'s clock for the schema-wide sweep. Closes db/124's Q5 for the child's side.
4. **May a row carry his playing styles (right-hand bat, leg-spin)?** *Recommend: yes, in slice S5.* A selector picking spinners otherwise opens twenty passports to find three, and twenty log lines tell the family less than one. Styles are roster identity (READERS class A, level 1), less than the passport the consent already opens, and they are not a figure. If no, the row stays name, school and side.
5. **A recorded shortlist or a note on a boy?** *Recommend: not now, and never as a line in this build.* Either is a new child-data record held by a union about a named child: it needs its own readers (the other selectors? the schools cricket manager? the family?), a retention (the season's end?), a route for the family to see it and object (POPIA right of access and correction), and an answer to what a withdrawn consent does to a note already written. That is a design, not a slice. Until then the system keeps no union notes and offers no store.
6. **A name search within the consented set?** *Recommend: yes*, as the optional fragment in D2: it narrows the rows the filters already allow, a miss reads the same as a boy who does not exist, and a selector with a name from a trial day should not have to page a province to find it. Never a search across non-consenting boys.

---

## 10 · Build plan, in slices

Each slice commits and pushes its branch after each step that passes, at least every 30 minutes, as every brief says. Opus throughout: every slice reads or renders a child's data and the first is a schema change.

| slice | ships | proof |
|---|---|---|
| **S1 · db/125 the list door** (Opus) | `passport_union_orgs()`, `passport_union_schools()`, `passport_union_list()`, `passport_union_log_list()`; the CHECK on `passport_union_read.what` widened; grants (`scrbrd_app` the three definers, nobody the log writer); the guard at the top refusing to run unless db/124's `passport_union_consent()`, `passport_union_reader_at()`, `passport_union_log()` and `consent_giver_live()` are db/124's by md5, as db/124 does for db/122's. If Q3 is yes: `consent_giver_live()` with `sa_today()` in its four tests, and the guard's md5 of it updated | **db/99 §102**, as the owner with `SET ROLE scrbrd_app` and the request settings, on the seed: (a) a selector at the seed's union lists only boys whose in-force consent names it; the count equals a direct count over `passport_consent` with db/124's test; (b) a withdrawn consent drops the row in the same transaction; (c) a giver's link ended (`valid_until` yesterday) drops it; (d) a consent naming CSA Schools appears to a federation selector and not to the province's, and the reverse; (e) a platform-wide caller, a support session (`app_support_access_id()` set), a pad and a competition organiser each get an empty list and no log row; (f) the function refuses neither school nor age group; (g) each row returned writes exactly one `'list'` row with the reader's name and role copied in and one `access_log` row per school with every boy's id; (h) `passport_union_reads()` returns the `'list'` rows to the boy's guardian and to the boy on his own self-access link, and nothing to a stranger; (i) the return type's columns are exactly the six named, by `pg_proc.proargnames`/`prorettype`, and the body reads no `born`, no `player_innings`, no `honour` (source-text assertions in db/124's style); (j) the three are SECURITY DEFINER with the pinned path, the log writer is not, nobody but `scrbrd_app` executes the three, nobody executes the writer; (k) if Q3: `consent_giver_live()`'s source holds no `current_date` and `sa_today()` four times |
| **S2 · the read routes** (Opus) | `GET /api/read/passport_union_orgs`, `passport_union_schools?org=`, `passport_union_list?org=&school=&ageGroup=&q=`, each `Cache-Control: no-store`; the generic CSV export refuses `passport_union_list` and `passport` (GA-I24/25 A1's check extended); `services/api/expected-migrations.json` gains db/125 | `tools/smoke-passport.mjs` extended: the selector persona lists, a row's name equals `passport_name()`'s, the family's `passport_union_reads` gains `'list'` rows after the list and `'passport'` after the open, the export route answers 403 for the two reads, a second list by the same selector writes a second set of rows |
| **S3 · the selector's screen** (Opus: it renders children's data) | a Selection view for the `unionselector` persona: institution chip when `passport_union_orgs` returns two, school and age-group pickers, name field, rows (name · school · side), tap opens the passport screen by id; empty state "No boy's family has named {institution} in that school or age group"; a failed open says "No longer open to {institution}" and nothing more; re-read on open and on return; no client store | `tools/smoke-browser-passport-union.mjs`: the selector persona reaches the view, sees only consented rows, opens one, the family persona then sees both the list line and the open; nothing in `localStorage`/IndexedDB after the walk; `smoke-a11y` over the view; 12 px and 44 px floors; `interface-review` on the diff |
| **S4 · the family's screen** (Sonnet builds, Opus reviews) | the "Who at a union looked" block groups `what = 'list'` per reader per SAST day with a count, keeps `'passport'` and `'name'` line by line; copy per §3; if Q3 is no, the "closes by 02:00" line beside a lapsed or withdrawn consent | `tools/smoke-browser-read.mjs` (Settings → Passport) extended with a `'list'` row; `apps/web/test` for the grouping by `sa_date` across a 01:00 SAST row |
| **S5 · styles on the row** (Opus), only if Q4 is yes | `passport_union_list()` gains `batting_style`, `bowling_style` from `player`, read as the owner; the screen draws them in words | db/99 §102 (i) updated to eight columns and no others; the smoke walk checks the words |
| **S6 · records** (Haiku) | READERS_child_data: B2 and Q gain the Union Selector's list; §7 gains Kameel's six answers word for word; GA-I24/25 §3, D9 and A1 gain the lines §6 names; db/124's header U6 struck through with "built in db/125"; the backlog and DEPLOYING's paste list | the lead reads it before it lands |

S1 before anything; S2 and S4 can run beside each other once S1 is on the branch; S3 waits on S2. One Opus on S1, which is the whole of the policy; the screens are the cheaper part.

---

## 11 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| A1 | `player.team_code` holds the current side's code and its leading `U\d\d` is the age group for every school side in the seed and the pilot | the age-group filter reads the `team` row's age band instead; still no `born` |
| A2 | The database's day is UTC on the pilot's server (so the gap is two hours, 00:00–02:00 SAST) | the gap is whatever the offset is; §7's reasoning and Q3's recommendation stand |
| A3 | `log_restricted_read(text, uuid[], text[], uuid)` accepts many ids in one row, as the opposition log uses it | one row per boy per school, still one event per list for the auditors to read |
| A4 | db/124 is pasted before db/125 and not reopened for the CHECK; db/125 alters it | the fix pass takes `'list'` into db/124's CHECK and db/125's guard reads the new md5 |
| A5 | The existing passport screen opens by player id for a selector today (db/124's `tools/smoke-passport.mjs`) | S3 adds the open to the passport route the smoke walk already uses |
