# SCRBRD-136 / 137 — Phase B: `bowler_day`, `signal_ack`, the guideline slot, and the proofs phase A still owes

**Status:** draft for Kameel's review (Fable, 2026-10-13). Nothing built.
**Source:** `docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md` (the base; D1–D16 stand; this document supersedes its phase B row and the lines §12 names); `apps/web/src/lib/signals.js`, `lib/cockpit.js`, `views/cockpit/useCockpit.js`, `views/cockpit/MatchDayCard.jsx`, `views/cockpit/useQueue.js` (phase A as built); `services/api/read/read-api.mjs` (the lead's three read fixes); `db/60_workload_consent_count.sql` (`workload()`, the consent); `docs/design/SCRBRD-110_workload.md` §3.3, §4.2, §6.1, §6.5, §7.4, §9; ADR 0002; `docs/design/SAFEGUARDING_DSO.md` §1, §4.4; `packages/policy/src/roles.mjs`; `db/89_notification_contract.sql`; `docs/design/GA-I09-I11_match_day_queue.md` §3.1 through `MatchDayCard.jsx`'s header.
**Reader:** Kameel first; then the Opus lead; then the Opus agent who builds the function, the proofs and (if chosen) the table, and the Sonnet agent who builds the one new card. Names in examples are the seed's illustrative ones, never a real child's.

**Lead's review (2026-10-13).** Checked against the code: `workload()`'s per-boy gate (db/60:1085),
the six roles holding `player.workload.read` (roles.mjs:169, 250, 274, 376, 425, 451), the stale
`workload` comment (read-api.mjs:1477-1479, which also names db/08 where the function is db/60's)
and db/99's last section (§70) are as cited. One change: PB-D11 gives the comment fix to Haiku,
but CLAUDE.md keeps Haiku out of code files. The fix is a comment in `read-api.mjs`, so it rides
B0 with the Opus review of the proofs; Haiku keeps the status line and the 136 doc's pointers.

---

## What Kameel decides

1. **`signal_ack`: build it in phase B, or keep the device store until the pilot shows it failing?** Recommendation: **keep the device store; do not build the table now** (PB-D5). The 136 phase table lists the table; this document asks to take it out of phase B and keep its design in §3 so it drops in if a coach asks for it.
2. **`bowler_day`'s gate: `player.workload.read`, per boy, inside the function (D16 confirmed), held by coach, assistant coach, director of sport, physio, S&C coach and the boy himself; not the team manager, not the office.** Recommendation: confirm (PB-D1). The alternative, widening the team manager in, is a change to `roles.mjs` this document does not ask for.
3. **Phase C (`coach_signals()` in SQL): keep as an option with a measured trigger, or drop it.** Recommendation: keep, with the trigger in §7 (PB-D9).
4. **The stale comment on `workload` at `read-api.mjs:1479`** ("per row under `player.development.read`") is the same drift the lead fixed on `bowling_breaches`. Recommendation: Haiku corrects it with the status line (PB-D11). Named here only because it is a claim about a gate.

Everything else below is a design call made with reasons, and is Kameel's to overturn.

---

## 0 · In one page

Phase A shipped the whole product for the pilot with no migration: the entry gate (`cockpit.js:105`), the Coach tab's panels, the match-day cards, and the drawer's twelve rules evaluated in the browser (`signals.js:43–58`), with S2c left out because no read answers it (`signals.js:18–19`). The 136 doc's status line still says "Nothing built yet"; it is wrong and §12 says what replaces it.

Phase B is smaller than the 136 doc's phase table says. **One read is owed:** `bowler_day(p_date, p_team)`, the first per-boy figure that spans two matches on one date, under `player.workload.read` per boy, exactly as `workload()` asks it (`db/60:1085`). **One card follows it:** S2c, in the drawer, in play only, worded by the directive's day figure. **The table is not worth it yet:** dismissing is "I have seen this" (D13), the evidence changes within days, and a server table of (staff member × hashed child evidence) is a new place minors' data accumulates with a retention duty, for the gain of a dismissal following a coach from his laptop to his phone. **The guideline line waits** on SCRBRD-110 phase 3, which is not built (`athlete_limit`, `effective_limits()` exist only in 110 §4.2); this document fixes the slot and its words so phase 3 drops in and the cockpit never has to be redesigned for it. **The proofs phase A still owes come first:** the lead's three read fixes (`read-api.mjs:1568–1585`, `:218–230`, `:1587`) have neither a `db/99` section nor the API walk 136 §9 named (`tools/smoke-cockpit.mjs`), and nothing proves today that a scorer gets `bowling_spells` with the age band null.

Migrations start at **`db/94`**: `db/92` and `db/93` are claimed by SCRBRD-140 phase 2 (`docs/design/SCRBRD-140_phase2_register.md:37–39, 67`). `db/99`'s last section is §70, so phase B's proofs are §71 onward. If 140 phase 2 does not land first, the numbers shift and nothing else.

---

## 1 · `bowler_day(p_date, p_team)` — a boy's overs today, across every match

### 1.1 Plain words

On a Saturday with two fixtures a pace bowler can bowl in both: the morning's 2nd XI and the afternoon's 1st XI, or an U15A match and a cup match the same day. The directive's day limit (`bowling_directive.max_overs_per_day`, `db/60:1075`) is a limit on the *day*, and nothing on the platform adds the two matches up for the coach of the second one. The pad's cap words are the match's; `bowling_spells` is one match's (`read-api.mjs:1582`); `workload()` gives the week (`db/60:1089`). So S2c was left out of phase A (`signals.js:18`) and D16 named the read. This section designs it.

### 1.2 The gate — D16 confirmed

**`player.workload.read`, level 2, asked per boy inside the function with the same `app_can()` call `workload()` makes** (`db/60:1085–1086`) and `bowling_spells` now makes (`read-api.mjs:1579–1581`). Not a new capability, not a widening: "how many overs did this boy bowl today" is the same tier as "how many this week", which `workload().overs_7d` already returns to the same readers and already includes today's overs from every match (`db/60:1089`, `o.bowled_on > sa_today() - 7`). The new read is one grain finer in time and coarser in everything else.

Who holds it (`roles.mjs`): `coach` (:250), `assistantcoach` (:274), `directorofsport` (:169), `medical` (:425), `fitness` (:451), `selfaccess` (:376, the boy for himself). Who does not: `teammanager` (:287–294), `sportsadmin` (:219–231), `scorer` (:306), `player` (:330), `guardian` (:391–400), `official`, `analyst`, `media`, `spectator`. So the team manager's drawer has no S2c, as it has no S2b and no S11 (GA-I09 §3.1 lists his rows); his card and tab say nothing is missing (136 §1.2's rule).

*Rejected — `fixture.read` + the frozen conditions, like S2a:* the day figure is not the match's; it is the boy's, and it reaches into a match the reader may not hold `fixture.read` for. *Rejected — letting the team manager in because he picks the side:* he lacks the load tier by design (136 §1.2, D1); a day total is load.

### 1.3 The function

In `db/94_bowler_day.sql`, hand-written, Opus. `SECURITY DEFINER` with the pinned search path, `STABLE`, revoked from `PUBLIC` and from a managed host's `anon`/`authenticated`, granted to `scrbrd_app` — `db/60:1156–1158, 1165–1182` is the shape to copy, and `db/60`'s self-check block (`:1186–1259`) the proof pattern.

```
bowler_day(p_date date DEFAULT sa_today(), p_team text DEFAULT NULL)
RETURNS TABLE (
  player_id uuid, full_name text, team_code text, school_id uuid,
  bowled_on date,
  overs_today int,          -- bowler_over rows on p_date, every match, as workload() counts a week
  matches_today int,        -- distinct match_id on p_date
  age_band text, pace boolean,
  max_overs_per_spell smallint, max_overs_per_day smallint, clause_code text
)
```

- `boys` is `workload()`'s CTE verbatim (`db/60:1081–1086`): every `player` row the caller may read the load of, narrowed by `p_team`, so the two functions can never disagree about who is in.
- `overs_today` counts `bowler_over` rows where `bowled_on = p_date`, as `workload()` counts `overs_7d` (`db/60:1089`): an over begun counts as one. The directive is in overs; so is this.
- The directive comes from `bowling_directive_for(b.id)` in a lateral, as `workload()` does (`db/60:1147`): `max_overs_per_day` is null for a spinner (`pace = false`), and the card is not drawn for him (§1.5).
- Rows come back for every boy the caller may read, including those with `overs_today = 0`, so the client can tell "he has not bowled" from "I may not read him" (the row is absent). The read is small — a side's pace bowlers — and the tab calls it only while our side fields (§1.6).
- **`bowled_on` is `sa_today()`'s date** (`db/60:1089`), the fixture's local date, so a match that runs past midnight UTC is one day, as `workload()` already treats it.

**What it never returns, by construction, not by promise:** no `load_word`, `acwr`, `ewma_ratio`, `units_*`, `monitored` (those stay in `workload()` and the profile); nothing from `injury`, `health_monitoring_consent`, `load_entry` or any 110 phase-2 table; no `athlete_limit` basis (the table does not exist; when it does, §4 says what joins); no opponent, venue or the other match's id (the count is enough: "two matches"; a match id would let a reader name a fixture his `fixture.read` does not reach). A reader who may read a boy's load learns the figure, never why a bowler should stop.

*Rejected — adding `overs_today` and `matches_today` to `workload()`:* one read fewer, but a function's row type cannot change in place (`db/60:1070–1072`: drop and re-create), 110 phase 2 already plans to re-emit `workload()` with `open_flag` (110 §3.3, §9 phase 2), two designs re-emitting one function is a merge the lead should not inherit, and `workload()` is read by every Dashboard card (`useCockpit.js:55`) where S2c is never drawn. A narrow function with a date parameter is a narrow proof. *Rejected — a `security_invoker` view like `bowler_spell`:* the point is that the sum crosses a match the reader's own RLS may not reach; a definer function that asks the load capability is the only honest shape.

### 1.4 The read

`bowler_day` in `read-api.mjs`, beside `workload` (`:1481`): `select * from bowler_day($1::date, $2::text)`, params `[req(q, "date"), q?.teamCode || null]`. Level 2, not logged, as `workload` is (110 §2.3: "Level 2, not logged"). Nothing joins it on the way out; the `clause_code` is in the row already.

### 1.5 S2c — the card

In `signals.js`, between `ruleS2b` and `ruleS3`, with its row in `RULES` (`:43–58`) and `RULE_ORDER` (`:61`), gated as S2b is (`:165`, `c.gate.panels.load`), over a new `Ctx.bowlerDay` (null when the read did not answer: a failed read fires no rule, `:91–93`).

| | S2c |
|---|---|
| title | "A bowler at the directive's day" |
| via | `["player.workload.read"]` |
| source | `bowler_day` |
| fires when | our side is fielding and in play (`c.fielding`, as S2a/S2b); the bowler is `pace = true`; `max_overs_per_day` is not null; `overs_today >= max_overs_per_day - 1` |
| line | `"K Naidoo · 11 of 12 today (U15 directive)"`; with `matches_today > 1`: `"K Naidoo · 11 of 12 today, two matches (U15 directive)"`; at or past the figure: `"K Naidoo · 12 of 12 today"` / `"13 of 12 today"` — the figure, never "stop" |
| count | `overs_today` |
| base / key | `S2c:${i}:${playerId}` / `S2c:${i}:${playerId}:${overs_today}:${max}` — it clears with the next over, as S2a/S2b do |
| dismissable | `false` while in play (as S2b, `:174`); afterwards the card is not drawn at all — the record of a day passed is `bowling_breach`'s, read by `bowling_breaches` (`read-api.mjs:1588`) on P9, and this design does not reopen what `bowling_breach_watch()` records |
| never says | a reason; a guideline (until §4, and then its kind only); the other match's name; the word *risk* |

The static never-list in `apps/web/test/signals.test.mjs` (136 §9 "Unit") extends to the new read's absent columns: no rule reads `load_word`, `monitored` or `open_flag` from `bowlerDay` either. The S2c unit cases: fires at `max − 1`, not at `max − 2`; sums two matches; a spinner never fires; a null read never fires; the key changes with the over.

### 1.6 Where the tab reads it, and where it does not

- **The Coach tab only, while our side fields.** `useCockpit.js:100–108` already re-reads `bowling_spells` and `workload` on live ticks for `panels.load`; `bowler_day` joins that pair with `{ date: match.date, teamCode }`, but only when `fielding.some(f => f.inPlay)` — before the match the card cannot fire (nobody has bowled today for us yet, and a morning match elsewhere is S11's and P3's business as "overs this week"), and after it, it is not drawn (§1.5).
- **Not the Dashboard cards.** A card has no fold (`useCockpit.js:115–116`: "the dashboard's card has none and the two bowler rules draw nothing there"), and the list now makes one `workload` read per fixture (`useCockpit.js:55`, `MatchDayCard.jsx:74`); adding a per-fixture `bowler_day` read for a card that cannot draw it would be reads for nothing.
- **The two-fixtures case is the GA-I09 list's own case.** A coach of two sides on one Saturday sees two cards; S2c on the afternoon's tab counts the morning's overs whoever coached that match.

### 1.7 Proofs — `db/99 §71` and the walk

`db/99 §71 · bowler_day`, SET ROLE as the seed's personas against a date on which the seed's bowler has overs in two matches (the section writes the second match's balls inside its transaction if the seed has only one):
1. the coach of his side reads his row, `overs_today` is the sum, `matches_today = 2`;
2. the same date as `assistantcoach` of the side: his row; as `medical` at the school: his row; as `fitness`: his row; as `directorofsport`: his row;
3. as `scorer` of one of the matches: **no row**; as `teammanager` of the side: none; as `player` on the side: none; as `guardian` of the boy: none; as `coach` of another team at the school (team-scoped): none; as `coach` of the other school: none;
4. as the boy himself through `selfaccess`: his row and nobody else's;
5. a spinner's row carries `max_overs_per_day IS NULL`;
6. the function is `SECURITY DEFINER` with the pinned path, not executable by `PUBLIC`, `anon` or `authenticated`, executable by `scrbrd_app` (the `db/60:1192–1224` pattern);
7. `overs_today` for the date equals `workload().overs_7d` for a boy whose only overs in seven days are that day's (the two reads agree).

The API walk (`tools/smoke-cockpit.mjs`, §5) adds: `bowler_day?date&teamCode` as the coach returns rows; as the team manager, the scorer and the pupil, an empty set and no error that names the gate.

---

## 2 · The guideline slot (P3, P6, S2b, S2c) — restating D6 as a rule a test can hold

### 2.1 Plain words

SCRBRD-110 phase 3 (`athlete_limit`, `load_plan`, `effective_limits()`) is designed (110 §4.2, §9 phase 3) and not built; nothing in `db/` has it, and `db/55` turned out to be medical-status-withdrawn, so 110 §9's migration numbers are stale too. The cockpit today prints the directive's figures: `limitWords()` says "6 a spell, 12 a day · U15" (`cockpit.js:263–266`), S2b says "spell 5 of 6 (U15 directive)" (`signals.js:174`). When a guideline for one boy exists and is tighter, those sentences would be wrong, and worse, would claim the directive said something it did not.

**Decision: design the slot and its words now; build nothing in phase B** (PB-D6). The slot is two things the phase-3 build must honour, written here so its brief can name them:

1. **A column, `limit_kind`**, `'directive'` or `'guideline'`, beside `max_overs_per_spell` and `max_overs_per_day` wherever the cockpit reads them: `workload()`, `bowling_spells`' lateral, `bowler_day`. Phase 3 replaces the `bowling_directive_for()` lateral in each with `effective_limits()` (110 §4.2: tightest wins), keeps the column names, and adds `limit_kind`. Nothing else travels: not `basis`, not `injury_id`, not `set_by`, not `set_at`, not `valid_from`, not `valid_until`.
2. **The words.** Where `limit_kind = 'guideline'` the cockpit prints the figure and the word *guideline* in the directive's place: `limitWords()` → "4 a spell, 12 a day · guideline"; S2b → "spell 3 of 4 (guideline)"; S2c → "11 of 12 today (guideline)". The kind is said because S2b's sentence names its source and must not name the wrong one; the basis is not, because the figure is what the coach acts on and "returning from injury" is a clinical fact that belongs on the profile (D6, 110 §4.2's last paragraph).

### 2.2 D6, testable

> **Rule.** No cockpit surface — P3, P6, S2b, S2c, S11, the Dashboard cards — renders, and no cockpit read returns to the browser, any of: `basis`, `injury_id`, `set_by`, `set_at`, `valid_from`, `valid_until`, `ended_by`, `ended_at`, or any of the five basis words (`returning_from_injury`, `growth`, `preseason`, `physio_judgement`, `coach_judgement`) in any spelling; and the rendered text beside a limit never contains "set by", a person's name, or a date other than a return-to-play date already allowed on P2.

Held three ways when phase 3 lands: the static source check in `signals.test.mjs` (the `NEVER_ON_THE_TAB` pattern, `lib/captain.js:255`) gains those names; the browser walk's grep of the rendered tab (136 §9) gains the five basis words and "set by"; `db/99`'s phase-3 section asserts the three cockpit reads' column lists contain `limit_kind` and none of the names above. Until then the rule is a one-line note in 110's phase-3 brief, which Haiku adds when Kameel accepts this document.

*Rejected — print nothing until phase 3 and hide the directive too:* the directive is the law's figure and public-grade in the captain's tab; hiding it helps nobody. *Rejected — a "why" tap on P6 opening the basis:* that is the profile, one tap away by name, and the panel saying "tap for why" is the basis by another route.

---

## 3 · `signal_ack` — decided against for now; designed so it drops in

### 3.1 Plain words

Today a dismissal lives in the browser's storage, keyed by the person's user id (`useCockpit.js:145–157`), with an in-memory fallback when storage is blocked. It is per device: a coach who dismisses "4 have not answered" on his laptop on Thursday sees it again on his phone on Saturday. That is the whole defect. It is not a privacy defect — the store holds a card's `base` and `key` (`signals.js:361–364`), which carry a player id and, for S3, a state word and a return date; that already sits in a staff member's browser beside the reads themselves.

### 3.2 The decision — PB-D5

**Do not build the table in phase B.** Reasons, in order:

1. **The gain is small and the pilot can measure it.** A dismissal is "I have seen this" (D13); S2a–S2c are not dismissable in play; S3, S6, S7 clear by the real act (the sheet changes, the family answers); S5 returns on growth. Most dismissals are stale within days. What a second device shows is a count a few higher, and the same true cards.
2. **The cost is a new place minors' data accumulates.** A row per (staff member, fixture, child, evidence) is minors' data keyed by a reader — under POPIA it needs a retention rule, a purge, a support cut (110 §6.5's `RESTRICTIVE` pattern) and a `db/99` section; the migration, the RLS, the read, the first write route the cockpit has ever had (A4: phase A writes nothing) and the proof are the Opus budget for a week, spent on a convenience.
3. **It is the first write from the drawer.** Everything in 136 §4.5 rests on the feed deriving and storing nothing. A table of acks does not push and does not reach a parent, but it is the first row the feed writes, and the line "the feed writes nothing" is worth more to the design than cross-device dismissals.

**The trigger to build it:** a pilot coach or manager says, in the pilot's feedback, that re-seeing dismissed cards on a second device costs him time; or the GA-I09 list for a reader with three or more fixtures shows a "to resolve" count that differs between his devices by more than the cards he dismissed that day. Either is a sentence Kameel can hear and act on.

### 3.3 If it is built — the design, so nothing is reopened

`db/95_signal_ack.sql`, Opus.

```
signal_ack (
  person_id    uuid NOT NULL → app_user,         -- set by the function, never by the caller
  fixture_id   uuid NOT NULL → match,
  base_hash    bytea NOT NULL,                   -- sha256 of Card.base (fixture:rule:subject)
  key_hash     bytea NOT NULL,                   -- sha256 of Card.key (the evidence)
  count        int   NOT NULL,                   -- Card.count, for S5's growth rule
  acked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, base_hash)
)
```

- **Owner-only, no capability** (136 phase B row): the generated policy is `person_id = app_user_id()` for read and write; a `RESTRICTIVE` `not_under_support` cut as `db/60:240–243` makes; no `superadmin` or platform-wide read (DSO §1 item 4's shape, applied to a smaller thing). An assistant coach never sees the coach's acks (136 §4.2: "never shared between two people").
- **Hashed, so the row names no child.** The server stores the hashes the client computes (`crypto.subtle`, falling back to not acking when unavailable); `isSeen()` and `markSeen()` (`signals.js:367–377`) keep their contract over `{key, count}` by comparing hashes. A database reader without the player ids cannot read a status word or a date out of a row. The count is a number (a bus shortfall, a ball count), never a name.
- **One write, one read.** `POST /api/signals/ack` → `signal_ack_set(p_fixture, p_base_hash, p_key_hash, p_count)`, `SECURITY DEFINER`, stamping `person_id`; `GET` through a `signal_acks?fixtureId` read, the caller's rows only. Both refused to a pad credential (`app_pad_scoped()`, `db/60`'s rule) and under support.
- **Retention:** a row is deleted when its fixture is more than 30 days past, by the same job that expires notices (db/89 §4's "a notice about a fixture lives by the fixture"); and a row is replaced, not appended, when the key changes (the primary key). `db/99 §72`: a row written by one coach is invisible to the assistant on the same side, to the office, to a `support_access` session and to a platform-wide assignment; a row older than the window is gone after the job runs.
- **Migration from the device store: none; start fresh.** The browser's `scrbrd.signals.seen.<person>` is not uploaded: its contents are whatever a device held, under no server rule, and uploading them would be the one time the key travels in clear. On the first open after the table ships, the client reads the server's rows and keeps the device store as the offline cache: `seen = union(device, server)` for the open, server wins on write, and the device store is dropped from the code a release later.

---

## 4 · The GA-I09 list and the Dashboard — what phase B changes

Nothing structural. The 136 doc's "Dashboard card" (§3.2, one fixture within seven days) was grown by the match-day queue's phase A0 into **one card per admitted fixture, today's first, the rest under "Later"** (`MatchDayCard.jsx:14–31, 50–63`), each with the side's foot, the bus, a "to resolve" count from `evaluate()` over the card's own reads (`:84`), a line per read that failed (`:102–106`), and two buttons into the tab and the drawer (`:109–111`). The team manager sees the same list through the same gate (GA-I09 §3.1). Phase B leaves all of that as it is:

| phase B item | on the Dashboard |
|---|---|
| S2c / `bowler_day` | never drawn on a card, never read for one (§1.6) |
| the guideline slot | the cards print no limit (`sideFoot`, the bus, the count), so nothing changes |
| `signal_ack`, if built | the count on each card would use the server's rows for that fixture, one read per fixture per open; a reason the table stays deferred (§3.2) |

§12 replaces 136 §3.2's "Dashboard card" paragraph with a pointer to GA-I09 §3.1.

---

## 5 · The proofs phase A owes — first in the build

Phase A was built with no `db/99` section and no `tools/smoke-cockpit.mjs`; the lead's three read fixes were made in `read-api.mjs` and are proved by nothing but reading them. They are claims about gates on minors' data, so they are proved before anything new is built (PB-D8).

**What the three fixes do, as read today:**
- `bowling_spells` (`read-api.mjs:1568–1585`): `age_band`, `pace`, `max_overs_per_spell`, `max_overs_per_day` come from a lateral `bowling_directive_for()` joined `ON w.may` (`:1581`), where `w.may` is `app_can('player.workload.read', …)` per bowler (`:1579–1580`); `over_spell_limit` is computed only `WHEN w.may` (`:1572–1573`). A scorer gets the spell with those null. 136 §3.6 note (i) is answered: the band does not come back to him.
- `shot_points` (`:218–230`) reads `ball_event_live` (`:224`), so a voided ball is not drawn. 136 §3.6 note (ii) is answered.
- `bowling_breaches` (`:1587`) now says `player.workload.read`. Note (iii) is answered — and the same drift still sits on `workload` (`:1479`, "under `player.development.read`"), to be corrected by Haiku (PB-D11).

**`tools/smoke-cockpit.mjs`** (the API walk 136 §9 named), signed in as each persona of 136 §1.2's table:
1. `bowling_spells?matchId` as the coach: rows with `age_band`, `max_*` filled and `over_spell_limit` a boolean; as the scorer of that match, as a pupil on the side, as the team manager: the same spell rows with those four null and `over_spell_limit` null; as `medical` at the school: filled; as the other school's coach: his own bowlers filled, ours null.
2. `shot_points?matchId` after a ball is voided through the pad's own route: the voided `seq` is absent; `player_shot_points` for the striker agrees; the count equals `ball_event_live`'s for the match.
3. `workload?teamCode` as the team manager: empty; as the coach: rows; as the assistant: rows (136 §9's first walk, kept).
4. The rest of 136 §9's API walk as written: `readiness` for the assistant, `opposition_context` empty for the scorer, `trips` empty for the analyst, `matchups` never naming the other school's boy, `opposition_squad`'s access-log row, `lift_expected()`'s log row.
5. Phase B's: `bowler_day` as in §1.7.

**`db/99 §71`** carries `bowler_day` (§1.7) and, in the same section so the proof is in one place (136 §9's wish), the schema-level facts the read fixes rest on: `bowler_spell` is `security_invoker`; `bowling_directive_for()` is callable by `scrbrd_app`; `ball_event_live` excludes a row the section voids inside its transaction. The read texts themselves are JavaScript and are proved by the walk, plus one static test (`services/api/test/`, like `public.test.mjs`'s scan): `READS.shot_points.text` names `ball_event_live` and not `from ball_event `; `READS.bowling_spells.text` contains `on w.may`.

---

## 6 · What the cockpit still never does — checked against db/89

The feed pushes nothing (D11). `db/89_notification_contract.sql` writes a closed list of kinds and subjects (`:121–160`), a contract trigger (`:187–191`) and retraction; it names no signal, no cockpit and no push of its own, and nothing in phase B writes a `notification` row: `bowler_day` is a read, S2c is a card, and `signal_ack` — if built — is a row about the reader, not a notice to anyone. The welfare notice that *does* reach a phone for a directive breach is `bowling_breach_watch()`'s (136 Appendix A), shown by S12 as the notice it is; a day limit passed across two matches is that trigger's to notice or not, and this design does not touch it. No parent, no pupil, no quiet hours; 136 §4.5 stands word for word.

---

## 7 · Phase C — `coach_signals()` in SQL

**Keep as an option; do not schedule** (PB-D9). D12 chose the browser; the reason to leave it is speed, and nothing measured says the drawer is slow. The trigger, so it is a measurement and not a mood: the browser walk (`tools/smoke-browser-cockpit.mjs`, 136 §9) times the drawer from tap to first card on a throttled connection at the seed's fixture; if the median passes **two seconds**, or the GA-I09 list for a three-fixture reader makes more than **thirty reads** on open, phase C is written as 136 §8 row C says (one logged call, rows equal to the client's for the seed's fixture). Phase C would then also be the natural home of `bowler_day`'s sum, and S2c would move with it; nothing else in this document changes.

---

## 8 · Build plan, tiers, migrations

Order is the order of risk: proofs first, then the one read, then the card. `db/94`, `db/95`; `db/99 §71`, `§72`.

| # | item | migration | tier | proof |
|---|---|---|---|---|
| **B0** | the proofs phase A owes: `tools/smoke-cockpit.mjs` (§5 items 1–4), the static read-text test, the `workload` comment at `read-api.mjs:1479` | none | the walk's assertions are listed in §5 word for word, so **Sonnet** writes it from them and **Opus reviews** every assertion; the static test with it; the comment is Haiku's | the walk green against the seed; CI runs it beside `smoke-matchups.mjs` |
| **B1** | `bowler_day()` (§1.3), its grants and self-check; `db/99 §71` (§1.7 and §5's schema facts) | **`db/94_bowler_day.sql`** | **Opus** (SQL, a gate on minors' data) | `db/99 §71` |
| **B2** | the `bowler_day` read (§1.4); `Ctx.bowlerDay`; `ruleS2c` and its `RULES` row; the unit cases; the tab's read while fielding (§1.6) | none | **Opus** for the read and the rule (it is the gate's client), **Sonnet** for the hook and the card's drawing, **Opus reviews** | `signals.test.mjs`; the browser walk: S2c appears on the second match's tab when the seed's bowler has eleven overs across two matches and clears with his next over; the team manager's drawer has none |
| **B3** | the guideline slot: nothing built; §2's `limit_kind` and the never-list go into 110's phase-3 brief and 110 §9's phase-3 row | none | **Haiku** records it after Kameel decides | — |
| **B4** | `signal_ack` (§3.3) | **`db/95_signal_ack.sql`** | **Opus**, **only on §3.2's trigger** | `db/99 §72` |
| **B5** | after the merge: 136's status line, phase table and §12's lines; `DEPLOYING.md`'s paste list for `db/94`; the roadmap and gap-analysis rows | none | **Haiku** | the lead reviews before it lands |

Phase B stays one Opus agent's week with Sonnet beside it; nothing in it waits on the database lock except B1's paste.

---

## 9 · Decisions — PB-D1 … PB-D11

| # | decision | recommendation | why, in one line |
|---|---|---|---|
| **PB-D1** | `bowler_day`'s gate | **`player.workload.read` per boy inside the function (D16 confirmed); coach, assistant, director, physio, S&C, the boy** | the day total is load, the tier `workload()` already serves to the same people (`db/60:1085`) |
| **PB-D2** | its shape | **a definer function `bowler_day(p_date, p_team)` in `db/94`, not a column on `workload()`** | a date parameter, a narrow proof, and `workload()`'s row type is 110 phase 2's to change next |
| **PB-D3** | what it returns | **overs and matches today as counts, the directive's figures, the clause; never the other match, never a word, never health** | a reader learns a figure, not why a bowler should stop |
| **PB-D4** | S2c's words and life | **"11 of 12 today, two matches (U15 directive)"; in play only; not dismissable; gone after the match** | as S2a/S2b; the record of a day passed is `bowling_breach`'s |
| **PB-D5** | `signal_ack` | **not in phase B; keep the device store; build on §3.2's trigger** | a convenience against a new table of reader-keyed minors' data and the feed's first write |
| **PB-D6** | the guideline line | **design the slot now (`limit_kind` and the words), build nothing** | phase 3 is not built; the slot makes its brief exact |
| **PB-D7** | D6 as a rule | **§2.2's never-list, held by a static check, the browser grep and `db/99`** | "never on this panel" is a sentence until a test holds it |
| **PB-D8** | the proofs phase A owes | **first, before `db/94`; walk by Sonnet from §5's list, reviewed by Opus** | three gates on minors' data are proved today by reading the code |
| **PB-D9** | phase C | **kept as an option; trigger: two seconds to first card, or thirty reads per open** | D12 stands until a measurement says otherwise |
| **PB-D10** | the Dashboard | **unchanged; S2c never on a card; `bowler_day` never read for one** | the cards have no fold and already make one `workload` read each |
| **PB-D11** | the `workload` read's comment | **Haiku corrects `read-api.mjs:1479` to `player.workload.read`** | the same drift the lead fixed on `bowling_breaches` |

## 10 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **PB-A1** | `bowler_over` carries today's overs of a match in play (it is the view `bowling_spells` and `workload()` already read live, `read-api.mjs:1551–1553`, `db/60:1092`) | `bowler_day` reads `ball_event_live` grouped by over, as `bowler_over` is defined |
| **PB-A2** | the frozen conditions document carries an innings cap per bowler (`bowlerInningsCap`, 136 Appendix A) and no per-day cap | a competition day cap becomes a second input to S2c, tightest wins, read by the client from the match's document as S2a reads it; `bowler_day` does not change |
| **PB-A3** | `db/92` and `db/93` are taken by SCRBRD-140 phase 2 (`SCRBRD-140_phase2_register.md:37–39, 67`) and land first | phase B's numbers move down and nothing else |
| **PB-A4** | `db/99`'s last section is §70 | phase B's are the next two free |
| **PB-A5** | `sa_today()` is the fixture's local date for `bowled_on` (`db/60:1089`) | `p_date` is compared to `bowled_on` as stored; the two reads still agree |
| **PB-A6** | the seed can hold one bowler's overs in two matches on one date, or `db/99 §71` writes the second match's balls inside its transaction | the section seeds them |
| **PB-A7** | 110 phase 3, when built, replaces `bowling_directive_for()` in the three cockpit reads with `effective_limits()` and keeps the column names | the client's adapter maps the new names once; §2's words do not change |
| **PB-A8** | `bowling_breach_watch()` decides for itself whether a day limit passed across two matches is a breach it records | S2c's after-the-fact case stays undrawn either way; P9 shows what the table holds |

---

## 11 · What this document does not reopen

D1–D16 of the 136 doc; the twelve rules and the eight refusals; 110 §3.3 (no flag on a team screen), §4.2 (a guideline passed is a line, never a notice); ADR 0002 (the nature tier stays off the cockpit, D4); DSO §1 and §4.4 (a coach learns of a concern only by a share; nothing here reads one); the opposition window (D9); db/89's contract.

## 12 · What this supersedes in `SCRBRD-136-137_coach_cockpit_and_feed.md`

Haiku applies these after Kameel decides (B5), word for word:

| where | from | to |
|---|---|---|
| line 3, status | "Nothing built yet." | "Phase A built (no migration; `lib/signals.js`, `lib/cockpit.js`, `views/cockpit/`), S2c and the guideline line excepted. Phase B: `docs/design/SCRBRD-136-137_phaseB.md`." |
| §0, last paragraph (line 27) | "Phase B is three small Opus items: one read (`bowler_day`), one table (`signal_ack`), and the `effective_limits()` line when SCRBRD-110 phase 3 lands." | "Phase B is one read (`bowler_day`, `db/94`) and its card (S2c); `signal_ack` is deferred and the guideline line is a slot, both in the phase B document." |
| §3.2, "The Dashboard card" (line 127) | one card for the next fixture within seven days | "one card per fixture the reader's assignment admits, today's first, the rest under Later (GA-I09 §3.1, `MatchDayCard.jsx`)" |
| §3.2 P3 row, §3.3 P6 row, "left out on purpose" | "when 110 phase 3 lands … basis never on this panel (D6)" | add "the slot is phase B §2: `limit_kind` and the word *guideline*, never the basis" |
| §3.6, the lead's note (line 200) | "not this design's to fix" | add "Fixed by the lead in `read-api.mjs` (`bowling_spells` :1568, `shot_points` :218, `bowling_breaches` :1587); proved by phase B's B0" |
| §4.3 S2c row | "missing read: `bowler_day?date&teamCode`" | "`bowler_day?date&teamCode` (`db/94`, phase B §1)" |
| §8 phase table, row B | the three items, one migration | "`bowler_day` (`db/94`) and S2c; the phase A proofs first; `signal_ack` on its trigger (`db/95`); the guideline slot" |
| §8 phase table, row C | "if the drawer gets slow" | "if the drawer's first card passes two seconds or an open passes thirty reads (phase B §7)" |
| §9, "db/99 assertions (phase B only)" | as written | "`db/99 §71` (`bowler_day`, the read fixes' schema facts), `§72` (`signal_ack`, if built)"; the scorer's `age_band` question is answered: null |
| §9, "API walks" | as written | add §5 items 1–2 (the spells' nulls, the voided ball) and `bowler_day` |
| D16 | "phase B, `bowler_day` under `player.workload.read`" | add "confirmed, PB-D1; `db/94`" |
| A3 | "a `lift_expected` read is added in phase B" | "served by `lift-api.mjs:281`; phase B adds nothing" |
