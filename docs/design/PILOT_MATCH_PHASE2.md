# Pilot Match, phase 2: the server, the live link, promotion and the typed names

**Status:** design, for Kameel's review (Opus, 11 Nov 2026). Nothing is built. Nothing in it ships before Kameel answers §13 and counsel answers §14; slices 1 to 3 may be built behind the switch while counsel reads, because with the switch off they send nothing.
**Kameel's decisions this answers (11 Nov 2026):** R0 is Kameel scoring Pilot Matches alone, with no school accounts (`ROLE_DASHBOARDS_v1.1.md` §5 "Pilot", §9 R0, §10). The Pilot Match is today's Practice Match. Phase 2 sends it to the server so spectators can follow it live and so it can be promoted later. The public view shows the score and team names only, never a player's name. "Names go to the server, hidden": the typed names are stored but never shown publicly, under a retention rule and counsel's view, both settled before R0 ships. A Pilot Match is left out of every stat, standing, record, milestone, honour and P2 figure until it is promoted, and promoting it adds it exactly once.
**Read (origin/main unless named):** `apps/web/src/lib/practice.js` (header in full, `practiceRecord`, the store), `scorer/practice.jsx`, `lib/practiceExport.js`, `lib/persist.js` (lines 136–144, the `practice:` routing), `lib/sync.js` (the three locks: `open()` line 270, `call()` line 753, the pad), `scorer/engine.jsx` `startMatch` (line 987); `packages/sync/src/*`; `services/api/write/events-api.mjs` (header, `columnsFor`); `services/api/handover/scoring-session.mjs` (header); `db/02_schema_scoring.sql` (lines 82–146 `ball_event`, line 212 `ball_event_read`), `db/100`, `db/112`, and `db/147_ball_log_read_per_match.sql` on `origin/claude/wip-read-speed` (`ball_event_live` as the one view over the log); `db/22_support_access.sql`; `db/08` `access_log` (line 526); `db/59_public_read_path.sql`; `services/api/public/public-api.mjs`, `redact.mjs`; `docs/policy/PUBLIC_DATA.md`; `PUBLIC_BY_TERMS.md` on `origin/claude/wip-design-public-by-terms` (§1.2, §7, §8); `SCRBRD-083_public_pages.md`; `ACCOUNT_LIFECYCLE.md` §6; `ACCESS_REQUESTS.md` D1, D4, D7, D10; `INCIDENTS_AND_BREACHES.md` §3.3; `docs/pilot/BACKUP_RESTORE.md` §3 and its POPIA note.
**No child's name appears.** The test name used throughout is the canary `Qa Canarytest`, which is nobody.

---

## 0 · In one page

**Where it lives.** A Pilot Match lives in its own schema, `pilot`, and nowhere else until it is promoted. Its ball log has the same columns as `ball_event`, but it is a different table, so the 49 migrations, 43 views and every career, record, milestone, honour, standing and P2 read that reads `match`, `match_squad`, `player` or `ball_event` cannot reach it. The flag is the location, not a boolean that every reader has to remember. A check in the migration chain fails if any view or function outside an allow-list ever names a `pilot.` table (§2.4).

**The names live in one column.** The phone sends no typed name inside a ball. Before anything leaves the phone, every player in every event becomes a slot id ("home, list position 3"). The typed names travel separately, once, into `pilot.name.typed_name`, the only column on the server that holds one. The server refuses any event that carries a string equal to one of that match's names. Deleting the names means deleting one table's rows. The log stays whole, and the scorecard still adds up, with positions in place of names.

**Sync.** The real client engine is reused: the outbox, IndexedDB, idempotency, epochs, held balls, attach and take-over (§3). Losing an over hurts in exactly the same way, and `packages/sync`'s own header says why there must not be a second engine. The server's write path is reused through a store adapter over its core (dedupe, Laws, sequence numbers, the lease), not copied.

**Who reads it.** Signed in, only the account that scored it. The platform reads the nameless log through one logged function. It reads the names through a second logged function, which needs a written reason (an access request, a deletion check, an incident), and only one match at a time. A superadmin's role assignment alone never reaches either (§4).

**Public.** The match is off until the scorer taps **Share live link**. The link carries its own random slug, never the match id. The page shows the team names, each innings' runs, wickets and overs, the target, the status or result, and the balls of the over in play. It shows no batter, no bowler, no commentary, no venue and no weather. No public function can read `pilot.name`: the verifier and a test check this. A canary walk asserts that the typed name appears in no public response (§5).

**Retention.** Recommended: the typed names are deleted 30 days after the match ends (finished, abandoned, or the last ball, whichever is latest), on the server and on the phone. After the deadline, a read refuses them even if the job has not run. The nameless match is deleted after 12 months unless it is promoted. The live link closes 30 days after the end. Backups age out 14 days later (§7).

**Promotion.** Built in R1, when a school exists to take the match (Q4). The scorer asks; an office holder at the school accepts and maps each slot of his own side to a registered player. One transaction copies the log into `match` and `ball_event`, marked with its source. `match.promoted_from` is `UNIQUE`, so the match counts exactly once. The typed names and the pilot log are then deleted. The other side stays as positions (§6).

**Never sent.** A Practice Match started under phase 1 stays on its phone forever. It was promised that, and the three locks in `lib/sync.js` stay (§3.5).

---

## 1 · Words

- **Pilot Match:** a match started from the field with typed teams and typed names, scored on the real pad, and sent to the server under this design. Today's Practice Match, renamed, with phase 2 switched on.
- **Practice Match (phase 1):** one started before phase 2 reached the phone, or with the switch off. It stays on its phone.
- **Slot:** one entry on a typed team list: the side, its position in the list (1–15), its batting number (1–11 or none), and whether it is the twelfth man. A slot has an id. It has no name on the server, except through `pilot.name`.
- **The end:** the latest of the match finishing, the match being abandoned, and its last ball. Every clock below runs from it.
- **Sandbox:** a Pilot Match that is not promoted. "Keep as sandbox" is the default, not an act.
- **Promotion:** a school's acceptance of a finished Pilot Match into its own record (§6).

---

## 2 · The data model

### 2.1 Why its own tables, not a flag on `match`

The alternative was a boolean `match.pilot` and a platform-owned "sandbox school", so that the real write path, the real session, the real public read and the real tables served pilots unchanged. I rejected it for three reasons:

1. **Every reader would have to remember it.** On `main` today, 49 migration files read `ball_event`, 70 read `match`, and there are 43 views. db/147 (on `wip-read-speed`) narrows the log reads to `ball_event_live`, but standings, P2 figures, `public_live_fixtures()`, recognition and anything a platform-wide reader asks of `match` or `player` read their tables directly. A filter in each is a promise that the next view breaks.
2. **The names would sit in `player.full_name`**, beside registered children's names. Every roster read, every platform-wide read, and every export and retention rule for `player` would then cover strangers' children who have no school, no guardian and no consent. `ACCOUNT_LIFECYCLE` D22 would keep them for "5 years after leaving". They never joined, so they never leave.
3. **The tenant model would lie.** `ball_event.school_id` and `player.school_id` are `NOT NULL REFERENCES school`. A fake school would answer every "which school is this child at?" with a school that does not exist.

Separate tables answer all three by construction: a derived read cannot count what it cannot see.

### 2.2 The tables

Everything below is in schema `pilot`. `scrbrd_app` has no `USAGE` on the schema and no grant on any of its tables. All access goes through `public.pilot_*` functions that are `SECURITY DEFINER` with a pinned `search_path` (the db/16 rule).

| table | holds | notes |
|---|---|---|
| `pilot.scorer` | `user_id` → `app_user`, `granted_by`, `granted_at`, `ended_at` | who may start one (Q2). Only the owner's key writes it |
| `pilot.match` | `id` (uuid, minted on the phone), `owner_user_id` → `app_user` NOT NULL, `overs`, `format`, `starts_at`, `venue_name` (typed text, **no coordinates**), toss (`won_by` side, `decision`), `status` ∈ `live · finished · abandoned · promoted`, `abandon_reason` (a code), `finished_at`, `last_event_at`, `ended_at` (maintained: the end, §1), `names_purge_after`, `purge_after`, `share_slug` (UNIQUE, NULL when not shared), `shared_at`, `promoted_to` → `public.match(id)` UNIQUE, `promoted_at`, `weather` (conditions only, the `match_weather` shape; never a position) | the client mints the id, so a match started with no signal is the same match when it reaches the server |
| `pilot.side` | `(match_id, side)` PK, `school` (typed), `age_division`, `team_class`, `display_name` | team facts. The public page shows `display_name` |
| `pilot.slot` | `id` uuid PK, `match_id`, `side`, `list_no` 1–15, `batting_no` 1–11 or NULL, `twelfth` | positions. No name |
| `pilot.name` | `slot_id` PK → `pilot.slot` ON DELETE CASCADE, `match_id`, `typed_name` (1–60 chars, the `cleanName` rule), `updated_at` | **the only column on the server that holds a typed name.** A correction overwrites it and keeps no history: a history would be one more copy |
| `pilot.session` | `match_id` PK, `state`, `epoch`, `holder_device`, `lease_until` | `scoring_session`'s shape. The holder is always the owner account; only its devices change (§3.3) |
| `pilot.ball_event` | `ball_event`'s columns without `school_id`. `striker_id`, `non_striker_id`, `bowler_id` and `dismissed_id` → `pilot.slot(id)`; `scorer_user_id` → `app_user`; the same `UNIQUE (match_id, seq)` and `UNIQUE (idempotency_key)` | append-only by trigger, as `ball_event`. The one exception: `DELETE` when the transaction has set `pilot.deleting` (only `pilot_delete`, the purge and promotion set it) |
| `pilot.held` | `ball_event_quarantine`'s shape | stale-epoch balls, decided by the scorer on the pad's existing held sheet |
| `pilot.audit` | `match_id` (plain uuid, **no FK**, so it outlives the match), `event`, `actor_id`, `at`, `detail` jsonb (never a name) | created, names put, claim, take-over, shared, unshared, finished, abandoned, names purged, deleted, promotion asked, promoted, platform read |
| `pilot.tombstone` | `match_id`, `what` ∈ `names · match`, `why` ∈ `scorer · retention · request · promotion · erasure · incident`, `at`, `by` | ids and reasons only. Read back after a restore (§7.5) |

On the real side, one column is added in a new migration: `match.promoted_from uuid UNIQUE`, NULL for every match not promoted. db/00 is not edited.

### 2.3 What never reaches the server

- **A typed name inside an event.** §3.2 maps them on the phone, and the server refuses any that slip through (§3.4).
- **Free text a scorer typed during play.** A retirement's reason ("hit on the helmet") is a health fact (N2). A suspension is a conduct matter (N3). The `play_stopped` note, a `void`'s reason, a revision's reason and the weather change's `note` could name anyone. The wire keeps each one's **code** (`retired_hurt`, `retired_out`, a suspension's reason code, a stoppage cause from `causes.mjs`) and drops the text. The phone keeps the text for its own pad and export.
- **The venue's coordinates.** The phone keeps them (phase 1's record). The weather hint already asks our API with a position rounded to two places (`fetchWeather`), and that does not change. A position beside a live match and a list of children is a child's whereabouts (INCIDENTS S1). The server does not need one.

### 2.4 How SQL keeps it out of every derived read

The rule is "nothing outside `pilot` can see `pilot`". Four things enforce it, and each fails a migration or a test, not a reviewer's memory:

1. **No grant.** `REVOKE ALL ON SCHEMA pilot FROM PUBLIC, scrbrd_app`. A view or query running as the app role errors with "permission denied" rather than returning nothing quietly.
2. **No dependency.** The pilot migration, and from then on `db/99_rls_verify.sql`'s bundle, raises if `pg_depend` and `pg_rewrite` show any view or materialized view outside schema `pilot` depending on a `pilot` table. This catches a view created by the owner, which a missing grant would not stop.
3. **An allow-list of functions.** The same verifier lists every function whose `prosrc` mentions `pilot.` and raises if one is not on the list written into the verifier: the `pilot_*` functions of §8. A second list is narrower: only `pilot_names_put`, `pilot_names_for_owner`, `pilot_names_read`, `pilot_promote` and the purge may mention `pilot.name`. `public_pilot_*` may not, and neither may any function `GRANT`ed to the public path.
4. **A test over the source.** `packages/policy/test` reads every `db/*.sql` file, as `assertPublicSelect()` does for db/59, and fails on `pilot.` anywhere outside the pilot migrations. A builder who writes a new view therefore learns of the rule from a red test before it reaches a database.

Promotion is the only door from `pilot` into the real tables, and `UNIQUE (match.promoted_from)` makes it a door that opens once.

---

## 3 · Sync from the phone

### 3.1 Reuse the real engine: yes, and why

**The client:** `SyncEngine`, `indexedDbStorage`, `tryAttach`, the held store and `PadSync`'s gate, heartbeat, wake lock and take-over, all unchanged. A pilot is scored offline at a ground with no signal, exactly like a fixture. Every hard lesson in `lib/sync.js` (SCRBRD-074/075/078/079, db/126, the audit's P4–P7) applies to it in full. A second outbox would be a second set of bugs in the one place where a lost over cannot be recovered. What changes is three injected things: the **transport** (`/api/pilot/:id/events`), the **routes the gate and heartbeat call**, and the **wire mapping** below.

**The server:** `events-api.mjs`'s per-batch core does six things: lock the session, dedupe on the key with the db/36 fingerprint, judge each event by `lawsRefusal()` over the fold so far, refuse values the table cannot hold, allocate `seq`, and route a stale epoch to held. That core moves behind a small `LogStore` interface, implemented twice: the fixture store (today's SQL, byte for byte) and the pilot store (`pilot_*` functions). This touches the scoring write path, so it is Opus's, with the fixture suite and `smoke-sync` green before and after as proof that nothing moved. Copying the core into a second 2,000-line file is what this avoids.

**What the pilot does not take from the fixture path:** handover to another person (`handover_to`, codes), a second account (TWO_PHONES), amendments by an official (a Pilot Match's corrections are the pad's own undo and correction events), and playing conditions from a competition (the pilot folds by its date and its format alone, as a fixture with no conditions does).

### 3.2 The wire: no name leaves the phone inside a ball

From its first ball in phase 2, the pad scores a Pilot Match on slot ids, not names. It holds a local roster (slot id → typed name) and shows names from it, as it already shows a fixture's players by `id` (`engine.jsx` `nameOf`, line 2137). `practiceCfg` passes the squads as `{id, name}` objects. One pure function, `pilotWire(event)` in `lib/pilotWire.js`, stands between the outbox and the transport:

- every player-bearing field (`striker`, `nonStriker`, `bowler`, `batter`, `dismissed`, `fielder`, the squads and `twelfthMan` in `innings_start`) leaves as a bare slot id. A `{id, name}` object leaves as its `id`;
- each free-text field of §2.3 leaves as its code, or not at all;
- `teamKey` and `battingTeam` leave as `home` or `away`, and the team name travels once, on `pilot.side`;
- **a last check:** if any string anywhere in the result equals (by the `normKey` rule) any name on the local roster, the event is not sent. It goes to the held store as `name_on_wire`, the pad says so, and the build's test suite treats that as a failure to fix, not a path to use.

Coming back the other way (`adopt`, `restore`, a reload from the server on a new phone), the pad puts the names back from its roster, or from `pilot_names_for_owner` (§4.1) on a phone that has no roster yet.

### 3.3 Order of first contact, and offline

1. **Start, signal or not.** The phone mints `pilot-<uuid>`, writes the record and the draft as phase 1 does (under keys `pilot:meta:`, `pilot:log:` and `pilot:draft`, a new prefix routed in `persist.js` `matchKey`), opens the outbox **unattached**, and scores. The pad's label reads "Pilot · sending when there's signal".
2. **First signal.** The client calls `pilot_create(id, sides, slots, overs, format, starts_at, toss, venue_name, weather)`. It is idempotent for the same owner. For any other caller it answers the same `not_found` an unknown id gets. It is refused if the account holds no `pilot.scorer` grant (§4.3). On a refusal the match **stays on this phone as a Practice Match**: its id is re-keyed under `practice:` and the pad says "This match stays on this phone. Your account can't send Pilot Matches." Nothing else is retried.
3. **Then the names:** `pilot_names_put(id, [{slot, name}])`, once, and again only after an edit. It goes only after `pilot_create` has succeeded, and never while the platform switch `pilot_names_upload` is off (the counsel fallback, §14 item 1).
4. **Then the toss, then the balls,** through the engine as any fixture's go: the claim takes the lease, a flush goes at each over boundary, a refusal is said in words.
5. **Another phone, same account.** Opening a Pilot Match from **My Pilot Matches** on a second device is the db/126 "Take over": a person's press, over the generation shown, with an audit row. It is never automatic. The first phone's unsent balls come back held, on the pad's existing sheet. Another account can never claim a pilot match: the session's holder must be `owner_user_id`.
6. **Signed out or token expired.** The pad resume credential (`lib/padKey.js`) gains a pilot scope: issued after a signed-in claim, it signs that one pilot's claim, heartbeat and events, and nothing else (Opus, under the same review as SCRBRD-078's). Until that slice lands, the pad says "Sign in to send 14 balls" and keeps them queued. Nothing is ever lost for want of a session.

### 3.4 What the server refuses

`pilot_append` refuses an event, one by one, with a reason the pad can say:

- `name_in_event`: any text value equals a typed name of that match (by the `normKey` rule, in SQL, against `pilot.name`). This is the second lock on §3.2's first;
- `unknown_slot`: a player field that is not one of this match's slot ids;
- `free_text`: a key outside the allow-list for its kind (the same per-kind, key-by-key listing db/59's `public_match_log` uses);
- every Laws refusal, value refusal and idempotency conflict, as for a fixture.

### 3.5 Phase 1's promise stands

Every match under `practice:` stays on its phone. `isPracticeId` and the three locks (`PadSync.open()`, `PadSync.call()`, and the pad's own refusal to build an outbox) are kept word for word. Pilot ids start `pilot-`, and nothing converts one into the other, except the refusal in §3.3 step 2, which goes from pilot to practice and never back. The start screen asks once, before the first name is typed: **Send live to SCRBRD** (the default once phase 2 is on, for a granted account) or **Keep on this phone only** (phase 1, unchanged).

### 3.6 The notice, where names are typed

Above the first name field, in the setup step and before any name exists (POPIA s18), the words, for Sonnet to set and Kameel to approve:

> "These names are sent to SCRBRD so you can carry on scoring on another phone. They are never shown publicly: the live page shows the score and team names only. They are deleted 30 days after the match ends. Delete the match and they go at once."

The label on every pilot screen changes from "Practice match · kept on this phone" to **"Pilot match · names kept private"**. A new `STATE_WORDS.pilot` goes beside the old one, which stays for phase 1 matches.

---

## 4 · Who reads a Pilot Match, signed in

### 4.1 The scorer

The owner account reads everything it sent: the header, the log, the slots, the names (`pilot_names_for_owner(id)`, until `names_purge_after`), the held balls and the audit. It reads them on **My Pilot Matches** and on the pad. This is purpose 1: carrying on, or reviewing, on any phone. No other account reads any of it, whatever roles it holds. The pilot functions never ask `app_can()`. They ask `owner_user_id = app_user_id()`, so `superadmin`'s `ALL_CAPABILITIES` does not reach a pilot.

### 4.2 The platform

There is no school, so `support_access` (db/22), which is one school for one hour, has nothing to open. There are two owner-key functions instead, each refused without a reason of at least 20 characters, and each writing an `access_log` row (`school_id` NULL, `resource` `pilot.match` or `pilot.name`, `record_ids` = the match id, `fields` = what came back) and a `pilot.audit` row:

- `pilot_platform_read(id, reason)`: the header, status, the nameless log and the audit. For a fault, a stuck sync, an incident.
- `pilot_names_read(id, reason)`: the names of **one** match. Only for an access request, a deletion request being checked, or an incident (§9, §10). There is **no search across matches** and no list of names. Whoever asks names the match first.

In R0 the scorer and the platform are the same person, so both functions are about the record more than about access. They exist so that R1's guest scorers and any second scorer are covered from day one.

### 4.3 Who may start one

A `pilot.scorer` row, granted by the owner's key and nothing else (Q2). Without one, `pilot_create` refuses, and so does every other pilot function. Signing in with Google gives nobody this grant: an open sign-up must never become a way for strangers to upload children's names to SCRBRD.

### 4.4 The scorer's own account ending

`account_erase()` (140 §3.8) calls `pilot_delete_all_for(user)` first: every match, every name, a tombstone for each with `why = erasure`. Disabling an account (lifecycle D-part 1) closes every live link it shared and stops its sends. Re-enabling it does not re-share anything.

---

## 5 · The public live page and scorecard

### 5.1 What is shown

| shown | not shown |
|---|---|
| both team names (`display_name`) | any batter, bowler, fielder or position card |
| each innings: runs, wickets, overs; the target; the required rate in a chase | commentary, dismissals, fall-of-wicket names, milestones |
| the balls of the over in play, as marks (`1 · 4 W`) | the venue, the weather, the coordinates |
| status: Live · Innings break · Finished · Abandoned · Scoring stopped (no ball for 48 hours) | the scorer, the account, the match id |
| the result in words (`describeResult`, which names no player) | anything after a promotion (§6.5) |
| "Pilot Match · not an official result" on every view | |

The scorecard route is the same payload after the end: the innings totals and extras by kind. Nothing about a player, not even as a position. "Score and team names only" is read strictly. Q3 asks whether the over's marks may stay.

### 5.2 How it is read

- **Off until shared.** The scorer taps **Share live link**. `pilot_share(id)` sets a new random `share_slug` (128 bits, base32), and the link is `/live/p/<slug>` (with `/scorecard/p/<slug>`). **Stop sharing** sets it to NULL. Sharing again makes a new slug, so a link that went further on WhatsApp than meant can be killed. The pilot's id never appears in any public answer.
- **Read as nobody.** The new route sits in `public-api.mjs` under the same anonymous principal, cache, rate limit, headers (`noindex`, `no-referrer`) and single not-found body as SCRBRD-083 phase 1. One function, `public_pilot_score(slug)`, `SECURITY DEFINER`, returns the side names, status, `ended_at` and the log's typed columns the fold needs, with the slot ids replaced by per-match pseudonyms. It does not read `pilot.name` and cannot (§2.4 item 3). The API folds, and serialises only the keys in §5.1 through an allow-list shape check (`pilotLeaks()`, as `parLeaks()` is for par), which refuses and logs any other key.
- **A team name that contains a typed name.** The school field is free text. At share time, `pilot_share` refuses (`team_name_has_player_name`) while any `display_name` contains a typed name of that match as a whole (`normKey`) substring. The pad says "A team name contains a player's name. Change it to share the live link." The same check runs on every `pilot.side` edit of a shared match, and unshares on failure.
- **The home page.** A Pilot Match is never listed at `/`, because D1a needs a listing school and a pilot has none. It is findable by link alone.
- **The switch.** `PILOT_PUBLIC=on` gates the routes, as `PUBLIC_PAGES` gates the rest. Off, every pilot path answers the one not-found.
- **Cache.** A pilot's entries drop at once on unshare, delete, purge or a team-name change (a `pilot_public_changed` notify, plus the in-process `changed()` after the API's own writes, the db/59 pattern). The TTL is the ceiling.
- **Closes by itself** 30 days after the end (Q1): `public_pilot_score` answers nothing past `ended_at + 30 days`, whether or not the slug was cleared.

### 5.3 PUBLIC_DATA needs a row

Rule 1 says a fixture is private "until its school publishes it". A pilot has no school, so the scorer's share is the publication. Rule 2 and L5 say "a side whose school is not on the platform is never named". That rule is about the side's players, and L5 is "the other school's players", but rule 2 can be read as covering the side's name too. So the policy needs, in the information officer's hand (Q3):

> **L8 · A Pilot Match** (scored by a platform-granted scorer with no school): team names, innings totals, overs, the over in play and the result are public once the scorer shares the link; never a player, never as a position, never the venue; never listed on the home page; the link closes 30 days after the match ends; the page says it is not an official result.

---

## 6 · Promotion

### 6.1 The shape

Promotion is a school taking a finished Pilot Match into its own record. It needs a school, so it is built in R1 (Q4). R0 offers **Keep** (the default, which needs no tap) and **Delete**. "Ask a school to take this match" appears with the first school.

1. **The scorer asks:** `pilot_promotion_ask(id, school)`. One open ask per match. Allowed only when the status is `finished` or `abandoned`.
2. **The school accepts:** on the office's or the coach's day sheet, an "Offered match" row. The accepter holds `fixture.create` at that school **and** `player.profile.read` over the team (the roster, so he can map). He sees team names, the date, the totals and the positions. **He does not see the typed names by default.** He maps by batting order against his own team sheet: "Home No. 3 → (his player)". Q4 asks whether he may see the typed names to help. I recommend **no**: they are a stranger's typing about his pupils, his own sheet is the better source, and it keeps `pilot.name`'s readers at two.
3. **The mapping:** each slot of his side → one of his players, or "not one of ours" (it stays a position). The other side stays positions, unless its school is a tenant and maps it the same way in a second step (R1+, optional).
4. **`pilot_promote(id, school, team_code, map)`**, one transaction:
   - refuses unless the ask is open, the status is `finished`/`abandoned`, and `promoted_to` is NULL. A second call with the same ask returns the match it made, with nothing new written;
   - inserts `match` (`school_id`, `team_code`, `opponent` = the other side's `display_name`, `starts_at`, `format`, `overs`, `status`, **`promoted_from = id`**), `match_toss`, and `match_squad` for the mapped players;
   - copies the log into `ball_event`: `seq`, `epoch`, `client_ts`, `server_ts` and `device_id` kept; `idempotency_key` = `pilot:` + the original; `scorer_user_id` = the pilot's owner; slot refs → the mapped `player.id`, an unmapped slot → its position word ("Away No. 3"), which is not a name; `payload.source = {kind: "pilot", pilot_match: id}`, as the scorebook importer marks its source. The copy goes through `ball_event`'s own triggers;
   - checks that the fold of the copy equals the fold of the pilot log, innings by innings (runs, wickets, legal balls, extras, result), and rolls back if not;
   - deletes `pilot.name` and `pilot.ball_event` for the match (tombstone `why = promotion`), sets `status = promoted` and `promoted_to`, and clears the share slug.
5. **After.** The promoted match is the school's: **unpublished** until the school publishes it (rule 1), its children named on public pages only by the school's own rule (PUBLIC_DATA, PUBLIC_BY_TERMS), and counted by every derived read, once, because it is one row in `match`. The old pilot link answers the one not-found. The scorer's **My Pilot Matches** shows "Taken by {school} on {date}".

### 6.2 Counted once

- `UNIQUE (match.promoted_from)` and `UNIQUE (pilot.match.promoted_to)`. Two concurrent promotions: one commits, the other gets a unique violation and is answered with the first one's match;
- the pilot log is deleted in the same transaction, so nothing is left that a second copy could be made from;
- a promoted match cannot be "un-promoted" into a pilot. A wrong promotion is the school's to correct through its own amendment and void routes.

### 6.3 What happens to the typed names

They are deleted at promotion, not mapped into anything. The school's record carries its own children's registered names and positions for everyone else. **No typed name ever enters `ball_event`.** A normal fixture's typed opposition names do sit in its payload, kept forever under L6. A promoted pilot's never do.

---

## 7 · Deletion and retention

### 7.1 The rule (Q1)

| what | kept until | then |
|---|---|---|
| typed names (`pilot.name`, and the phone's roster) | **the end + 30 days**, or the scorer's delete, a promotion, an erasure or a request, whichever is first | deleted; tombstone |
| the nameless match (`pilot.match`, `side`, `slot`, `ball_event`, `held`, `session`) | **the end + 12 months**, unless promoted or deleted sooner | deleted; tombstone |
| the live link | **the end + 30 days**, or Stop sharing | answers not-found |
| `pilot.audit`, `pilot.tombstone` | **5 years** (the `access_log` period, lifecycle D22) | deleted |
| backups and dumps | 14 days after the day (BACKUP_RESTORE §3) | aged out by the provider and the runbook |

So a typed name is gone from the live database by day 30 after the end, and from every backup by day 44. The notice (§3.6) says 30 days. The privacy notice says, "and from backups within a further 14 days".

**Why 30 days.** The names' purposes are carrying on, a review in the days after, and a school taking the match. The first ends with the match. A review rarely takes a week. Promotion needs no name (§6.1). Thirty days covers a school that is asked the following week, with room. Beyond that, the purpose is gone and only the risk is left.

**Why 12 months for the nameless match.** Positions beside a school's team name and a date can still identify a boy to someone who knows the team, and counsel answers whether that is personal information (§14 item 2). A season is the scorer's natural review period. If counsel says it is not personal information, Kameel may lengthen it.

### 7.2 How it is enforced

- **At read time first.** Every function that returns a typed name returns nothing past `names_purge_after`, and `public_pilot_score` returns nothing past the link's date, whatever the job has or has not done. The rule holds even on a day the job fails.
- **The job.** `pilot_purge_expired()` deletes names past their date, then matches past theirs, writes the tombstones, and returns counts. The API calls it at boot and hourly (one row lock, no work if nothing is due). It is the lift-purge shape, but automatic, because there is no school office to work a due list.
- **On the phone.** On each open of the app, `lib/pilot.js` deletes local rosters whose server date has passed (the date is stored with the record when the match is created). For a match that never reached the server, the date is computed locally from its end. The phone's copy must not outlive the server's.
- **Delete one / delete all.** **Delete this match** removes it from the phone and, through `pilot_delete(id)`, from the server: everything, a tombstone, and the link dead at once. **Delete everything on this phone** stays phase 1's sweep and gains the `pilot:` prefix. It asks "Also delete them from SCRBRD?", and Yes calls `pilot_delete_all_for(me)`.
- **Erase one name** (an access request's deletion, §9): `pilot_name_erase(slot, reason)` deletes one row. The slot is a position from then on. The scorer may also do this on the pad, for any one name, at any time.

### 7.3 Abandonment

- **Abandoned by the scorer** (weather, light, the ground, the other side, "other"; codes only): `status = abandoned`, the result reads "Abandoned" (or the Laws' result if one stands), and the end is now. The page says "Abandoned".
- **Stopped without a word** (no ball for 48 hours and not finished): the page says "Scoring stopped". The clocks run from the last ball. The scorer may still finish or abandon it, and may score on, which resets the end, until the names' date. After that he may still score, on positions.
- **Started and never sent** (no signal all day, then deleted): it never existed on the server. Nothing to do.

### 7.4 After promotion

The promoted record follows the school's retention (lifecycle D22: the match record forever, identities by the school's schedule). Nothing of the pilot remains except `pilot.match`'s stub (id, `promoted_to`, dates) and the audit, kept for the audit period.

### 7.5 Restore

A restore puts back deleted names. BACKUP_RESTORE's own note warns that "an erasure done after the dump is undone by the restore". So, before the restored database serves anyone:

1. Run `pilot_purge_expired()`. Everything due by the clock goes again, which covers retention.
2. Re-apply every deletion since the dump from the off-database deletion log. Each `pilot_delete`, `pilot_name_erase` and promotion appends `{at, match_id, slot_id?, why}` (ids only, no name) to the object store's append-only `pilot-deletions/` file, because the restored database's own tombstones stop at the dump.

The restore runbook gains both steps (Haiku records them, from this design).

---

## 8 · The functions

All are `public.pilot_*`, `SECURITY DEFINER`, with a pinned search path. All refuse without a `pilot.scorer` grant, except the platform reads and the public one.

| function | caller | does |
|---|---|---|
| `pilot_create(id, …)` | owner | create, idempotent; §3.3 |
| `pilot_names_put(id, rows)` | owner | upsert `pilot.name`; refused while `pilot_names_upload` is off |
| `pilot_names_for_owner(id)` | owner | the names, until their date |
| `pilot_claim / heartbeat / takeover` | owner's device | `pilot.session`, the db/126 rules |
| `pilot_append(id, batch)` | owner's device | through the `LogStore` core; §3.4's refusals |
| `pilot_log(id, since)` | owner | the nameless log, as the pad reads a fixture's |
| `pilot_finish / pilot_abandon(id, code)` | owner | status, the end, the clocks |
| `pilot_share / pilot_unshare(id)` | owner | the slug; the team-name check |
| `pilot_side_edit(id, side, …)` | owner | team facts; the check again if shared |
| `pilot_name_erase(slot, reason)` | owner, or the platform with a reason | one name; tombstone |
| `pilot_delete(id)` / `pilot_delete_all_for(user)` | owner; `account_erase()` | everything; tombstones; the deletion log |
| `pilot_platform_read(id, reason)` | owner's key | nameless; `access_log` and audit |
| `pilot_names_read(id, reason)` | owner's key | one match's names; `access_log` and audit |
| `pilot_purge_expired()` | the API's timer | §7.2 |
| `public_pilot_score(slug)` | the anonymous path | §5.2; never `pilot.name` |
| `pilot_promotion_ask(id, school)` | owner | R1 |
| `pilot_promote(id, school, team, map)` | the school's office or coach | R1; §6 |

---

## 9 · Access requests

SCRBRD, not a school, is the responsible party for a Pilot Match: nobody else is (§14 item 3). `ACCESS_REQUESTS` D1's "the school answers" therefore does not apply. Kameel answers, on D7's clock (30 days, a ten-day aim, one written extension).

- **Who asks:** someone who says a typed name is their child's, or their own. They name the match: the date, the team, and the scorer if they know him. **There is no search by name across matches** (§4.2), so a request that names no match is answered "Tell us the date and the team, and we will look".
- **Standing:** with no guardian link to check, the proof is a copy of the asker's ID, and a statement of the relationship for a child. Counsel says whether more is needed (§14 item 7). If standing is doubtful, the answer is the fixed sentence ("We cannot confirm what we hold without…"), never a partial pack.
- **The pack:** the typed name as held; team names; the date; **his line only**: his figures at his slot (batting, bowling, how out, with no fielder named); the result; and the dates his name and the match will be deleted. Other children appear as positions (D4), always, even though the scorer typed their names.
- **After the names' date:** the fixed sentence: "Names typed in for a Pilot Match are deleted 30 days after it ends. We hold no name for the match on {date}. Its score is kept without names until {date}." There is nothing to tie the nameless log to the asker, and the design does not try.
- **Deletion and objection (s24, s11(3)):** `pilot_name_erase` at once, on the scorer's account of which slot, or by the platform after `pilot_names_read`. The asker is told it is done. The match stays, nameless.
- **Logged:** each read of the names is an `access_log` row (§4.2). The pack follows D10: the file is kept 90 days, the manifest 7 years.

---

## 10 · Where it sits in INCIDENTS

- **The kind:** a new row in INCIDENTS §3.2, `pilot_name_exposure`: a typed name seen by anyone other than its scorer, or read through the platform functions without a logged reason.
- **Severity (§3.3):** **S3** for names alone. **S1** where a name was exposed beside a live status: names, a team and "playing now" say where a child is. This is why §2.3 keeps the coordinates off the server and §5.1 keeps the venue off the page.
- **Who is told:** SCRBRD's information officer (Kameel), at once. The families cannot be contacted directly: the server holds no contact for anyone in a pilot. Counsel says what section 22 then asks (§14 item 6).
- **Containment, in order:** `PILOT_PUBLIC=off`; `pilot_names_upload=off`; then, if the names themselves are what leaked, `pilot_purge_names_now(reason)`, which deletes every typed name on the server with an `incident` tombstone. That is safe to do in one act, because the phones keep their own rosters and scoring goes on, on positions.

---

## 11 · Slices, in build order

Each slice: Opus builds, a second Opus reviews, then interface-review and break-ui on any screen. Migration numbers are the next free ones when the slice starts (db/147–150 are taken on branches; the lead assigns). Every builder commits and pushes `claude/wip-pilot-p2-*` after each step that passes its checks.

| # | slice | contents | proof |
|---|---|---|---|
| **0** | **records** (Haiku, after Kameel decides) | PUBLIC_DATA L8 text for the information officer; `retention.mjs` entries for the three pilot kinds; INCIDENTS §3.2 row; the restore runbook's two steps; the backlog | `tools/check-pilot-docs.mjs` |
| **1** | **the schema** | schema `pilot`, its tables (§2.2), the triggers, `match.promoted_from`, the four enforcement checks (§2.4) wired into the verifier bundle, the policy source test | SQL tests: the app role gets "permission denied" on every `pilot` table; a scratch view on `pilot.ball_event` makes the verifier raise; a scratch function naming `pilot.name` outside the list makes it raise; `UPDATE` and `DELETE` on the pilot log raise without `pilot.deleting` |
| **2** | **the write path** | `LogStore` extracted from `events-api.mjs`; the pilot store; `pilot_create`, the names, claim, heartbeat, take-over, append, log, finish, abandon, delete; the §3.4 refusals; the `pilot.scorer` grant | the fixture suite and `smoke-sync` green **unchanged**; `smoke-pilot-sync.mjs`: the node `SyncEngine` scores two innings against the server, offline then online, retries are duplicates, a stale epoch is held; `name_in_event` refuses an event carrying the canary; a second account cannot claim; an account with no grant cannot create |
| **3** | **the phone** | `pilotWire()`; slot-id squads in `practiceCfg`; `pilot:` keys in `persist.js`; `PadSync` pilot mode (transport, routes); the start screen's choice and notice; the label; **My Pilot Matches** (restore, take-over, delete everywhere); local purge | unit: `pilotWire` property test (random events × a roster including the canary: no wire string equals a roster name; free text gone); phase 1's three locks still refuse `practice-`; browser walk `smoke-browser-pilot.mjs` (§11.1 W1–W3) |
| **3b** | **the resume credential, pilot scope** | `padKey` issue and verify for a pilot; five calls, one match | a credential for pilot A refused on pilot B and on every fixture route; ends on take-over and on delete |
| **4** | **the public page** | `public_pilot_score`; the route and slug; share and unshare; the team-name check; `pilotLeaks()`; `PILOT_PUBLIC`; the cache notify; the `PilotLive` and `PilotScorecard` views in the public bundle (bundle ceilings stand) | `public.test.mjs` cases; W4–W6 |
| **5** | **retention and deletion** | `pilot_purge_expired()` and its timer; the read-time dates; `pilot_name_erase`; the deletion log; `account_erase()` hook; the phone's purge | SQL clock tests with a fixed `now()`; W7–W8 |
| **6** | **the platform's reads** | `pilot_platform_read`, `pilot_names_read`, `access_log` rows; `pilot_purge_names_now` | W9 |
| **7 (R1)** | **promotion** | the ask, the offered-match row, the mapping screen, `pilot_promote`, the fold-equality check, the after-states | W10–W11 |

### 11.1 The walks

| walk | proves |
|---|---|
| **W1 offline start** | airplane mode: start, type names (the canary among them), score 3 overs, reload. Signal on: create → names → toss → balls in that order; "Sent"; the server's log has slot ids only (`grep` of the `pilot.ball_event` dump for the canary is empty); `pilot.name` holds it |
| **W2 another phone** | phone B, same account: My Pilot Matches → Take over (a press, an audit row) → names restored → score on; phone A's late balls held |
| **W3 phase 1 stays put** | a `practice-` match from before phase 2 is never sent: no request leaves for it (network log), and the locks refuse it |
| **W4 public, never a name** | share; every public path for the slug (header, log-equivalent, scorecard, the shell's HTML and OG title) checked for the canary, the slot ids, the pilot id, the venue and any coordinates: none present; the score matches the pad |
| **W5 a name in a team** | a school typed as "Qa Canarytest XI": share refused with the words; edited to a school: share works; edited back while shared: unshared at once |
| **W6 the link dies** | unshare → not-found on the next request (cache dropped); share again → new slug, old one dead; at end + 30 days (fixed clock) → not-found |
| **W7 the names go** | at end + 30 days (fixed clock): `pilot_names_for_owner` empty before the job runs; after the job, rows gone, tombstone written; the phone's roster gone on next open; the pad shows positions |
| **W8 delete everywhere** | Delete this match → server rows gone, link dead, deletion log line; Delete everything → both prefixes swept, server asked |
| **W9 the platform** | `pilot_platform_read` without a reason refused; with one, an `access_log` row; a superadmin assignment without the functions reads nothing; `pilot_names_read` names one match only |
| **W10 counted once** | before promotion: the school's career, standings, personal bests, record boards, milestones and P2 reads are unchanged by the pilot. Promote. After: each moves by exactly this match. Promote again, concurrently: the same match id, nothing new. The fold of the copy equals the pilot's |
| **W11 after promotion** | no typed name in `ball_event` (the canary is absent); `pilot.name` and the pilot log empty; the old link not-found; the school's page private until published |

---

## 12 · What must never be possible

1. A typed name in any public response, HTML shell, OG tag, cache entry or log line, as a name or as a position card.
2. A typed name in any server row other than `pilot.name.typed_name`. That includes `pilot.ball_event`'s payload, `pilot.audit`, the access log, the deletion log, and `ball_event` after promotion.
3. A Pilot Match in any derived read (stat, career, standing, record, milestone, honour, Player of the Match, scorer recognition, P2 figure, home page list) before promotion, or twice after.
4. Any account other than the owner reading or writing a Pilot Match, except the two logged platform functions with a reason. A role assignment alone, superadmin included, is never enough.
5. A Practice Match from phase 1 leaving its phone.
6. A typed name readable after its date, from the server or the phone, whether or not the purge has run.
7. The venue's coordinates, a retirement's reason, a suspension's reason or any free-text note on the server.
8. An account with no `pilot.scorer` grant sending anything, Google sign-up included.
9. A pilot's own id, its slot ids or its scorer on a public page, and a dead slug answering anything.
10. A promotion without an accepter at the school, of an unfinished match, or one that leaves a typed name or a second copy of the log behind.
11. A search for a name across Pilot Matches, by anyone.
12. A restore that brings back a name deleted after its dump.

---

## 13 · Questions for Kameel

Closed, each with a recommendation. Five.

| | question | recommendation |
|---|---|---|
| **Q1** | **The periods.** Typed names deleted 30 days after the end (server and phone); the nameless match 12 months after; the live link closed 30 days after; backups out 14 days later. Or 7 days, or 90 days, for the names? | **30 / 12 months / 30**, as §7.1. Seven days is too short for a school asked the next week; ninety keeps strangers' children's names for a purpose promotion does not need |
| **Q2** | **Who may start one in R0.** Only accounts the platform owner grants (`pilot.scorer`), which at R0 means Kameel alone? Or any signed-in account? | **Granted accounts only.** Open sign-up would let anyone upload children's names to SCRBRD under SCRBRD's name |
| **Q3** | **The public page, and L8.** Team names, innings totals, overs, target, status, result, and the balls of the over in play; nothing about any player, not even as a position; no venue; never on the home page; off until the scorer shares; noindex. Do you, as information officer, add §5.3's L8 to PUBLIC_DATA? And may the over's marks stay, or is it the totals alone? | **Yes to L8, and the over's marks stay.** They are team facts, like the score, and they are what makes a live page live. No position card: "Batter 3: 42" is a figure about one identifiable boy on a team sheet his friends know |
| **Q4** | **Promotion.** Designed now, built in R1 with the first school; R0 offers keep and delete only. At promotion the school's office or coach maps his own side by batting order **without seeing the typed names**; the other side stays positions; the typed names are deleted at promotion. | **Yes, as §6.** It cannot be built without a school, and the school's own team sheet is a better source than a stranger's typing |
| **Q5** | **Phase 1's matches.** Practice Matches already on phones (yours included) stay there forever and are never uploaded, even by choice. | **Yes.** They were promised "nothing leaves this phone". If you want one of yours live, re-score it as a Pilot Match |

---

## 14 · Questions for counsel, before R0 ships

On holding children's typed names with nobody's consent. My reading is not advice.

1. **The ground.** POPIA s34 forbids processing a child's personal information, and s35(1) lifts that only on its listed grounds. SCRBRD holds the names a scorer types, for children whose guardians have never heard of SCRBRD. Which ground, if any, covers it: (a) consent (impossible in practice); (d) historical, statistical or research purposes with the s35(1)(d) safeguards; (e) information "deliberately made public by the child with the consent of a competent person", if the school itself posted the team sheet? Or does it need the Regulator's authorisation under s35(2)? If none fits, **the fallback is built in: `pilot_names_upload` off**, and the names stay on the phone (phase 1's position), with the server holding positions only. Is that the safer R0?
2. **Is the nameless log personal information?** With names deleted, the server holds a team name ("{School} U13B"), a date, and figures by batting position. Is a boy identifiable from that "by reasonable means" (s1)? The answer sets §7.1's 12 months.
3. **Who is the responsible party?** SCRBRD, which decides the purpose and holds the data, or the scorer, a private person scoring on his own phone? Does s6(1)(a), the purely personal or household exclusion, cover a scorer in phase 1 and stop at the server? Does the answer change when the scorer is not Kameel (R1 guest scorers)?
4. **Notice (s18).** The scorer sees §3.6's notice; the children and their parents see nothing. Do s18(4)'s exceptions (not reasonably practicable; the information is not about them in an identifying way) apply? Is a published privacy notice on the site, naming Pilot Matches, enough?
5. **Retention (s14).** Is 30 days for the names and 12 months for the nameless match "no longer than necessary" for "carrying on scoring, review, and a school taking the match"? Does a backup copy within 14 days after deletion meet s14(4)?
6. **A compromise (s22) with no one to tell.** If the names leak, SCRBRD has no contact for any family. Does s22(5)'s publication route ("on the website" or in the news media) apply, and is the Regulator told in every case?
7. **Access requests (s23) on a typed name.** With no guardian link to check, what proof of standing is enough before SCRBRD confirms that it holds a name, and is refusing to confirm without proof lawful (PAIA s63, s71)?
8. **Promotion as a transfer.** When a school accepts a Pilot Match, SCRBRD gives the school figures about its pupils that SCRBRD gathered without consent. Is that further processing compatible with the original purpose (s15)? Must the school's own guardian notice, and PUBLIC_BY_TERMS's terms, cover the match before it counts or is published?
9. **The live page (s19, and safeguarding).** Team names and "playing now", with no venue: does that tell a stranger where a team of children is (a home ground is easy to guess), and does it need a safeguard beyond §5.1, such as showing the score only after each innings?
10. **Where the server is (s72).** If the database or a backup is outside the Republic, is holding the typed names there a transfer that needs its own basis for children's information?

---

## 15 · What changes in other documents

- `ROLE_DASHBOARDS_v1.1.md` §3D: the scorer's "Pilot Matches awaiting promotion" becomes "Pilot Matches" (keep, share, delete), with promotion from R1. §10's two Pilot tests are W10 and W4.
- `PUBLIC_DATA.md`: L8 (Q3), in the information officer's hand.
- `ACCOUNT_LIFECYCLE.md` §6.2: three rows (pilot names, the pilot match, the pilot audit); `account_erase()` calls `pilot_delete_all_for()`.
- `ACCESS_REQUESTS.md` D1: "SCRBRD is the responsible party for a Pilot Match"; §9 here is its route.
- `INCIDENTS_AND_BREACHES.md` §3.2: `pilot_name_exposure`; §6.1: the two switches and the emergency purge.
- `BACKUP_RESTORE.md`: §7.5's two steps.
- `lib/practice.js`'s header: phase 2's paragraph, beside phase 1's, which stays true for `practice-` ids.
