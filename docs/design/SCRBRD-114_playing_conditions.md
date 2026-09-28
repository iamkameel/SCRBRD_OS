# SCRBRD-114 — Playing conditions per competition: the design

**Status:** for Kameel's review, 2026-09-28. Nothing here is built. The KZN schools' bye-laws are not in hand; every figure below that is not already in the repository is an **assumption to be confirmed** and is marked as one.
**Source:** `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`, SCRBRD-114 (the item, the CSA club-regulations note, the transformation-quota rule) and SCRBRD-113 (the free hit by format, the first condition built).
**Reader:** the product owner first, then whoever builds it. Plain words open each section; the schema and the functions follow. A builder reads §1–§8 and builds §9; §10 is the decision record.

---

## 0 · What this is, in one page

A **playing condition** is a rule of a competition, not a Law of Cricket: how many overs an innings has, whether a no-ball earns a free hit, how many overs a fifteen-year-old may bowl in a spell, what a win is worth, how a tie in the table is broken, who may be on a team sheet. The Laws are the same in every match and live in the engine (`packages/scoring/src/laws.mjs`, keyed only by Edition, `edition.mjs`). Conditions differ between the KZN Cricket Union's league and KZN Inland's, between U13 and 1st XI, between this season and next. The 4th-Edition work built the first one (`freeHitsApply(format)`, `format.mjs`) as a function of the fixture's format; this design makes that the general case, so **no condition is ever a rule hard-coded in the engine, and every reader — the scorer's pad, the fold, the Laws check, SQL, the standings table, selection — reads the same value from the same place.**

The shape, in three sentences:

1. **A closed catalogue of condition keys** (`playing_condition_key`, mirrored by `conditions.mjs`), each with a type, a unit, today's behaviour as its platform default, and the readers that consult it. A competition publishes **immutable, dated versions** of its values (`condition_set` and `condition_value`), and every value carries its source (document, clause, date) or says plainly that it is the platform's default, unconfirmed.
2. **A match reads one frozen document**, `match_conditions.doc`, resolved once from the platform defaults, the competition's version in force on the match's start day, and the fixture itself, and fixed on the match's first event. The fold receives it as `FoldContext.conditions`; SQL reads the same jsonb through `match_playing_conditions()`; nothing folds a match from a live table. A match with no document — every match scored before this ships, and a friendly with no competition — folds exactly as it does today, so nothing already scored moves.
3. **Conditions never refuse a delivery.** The Laws refuse; conditions make **facts** (`bowling_breach` and its kin), **figures** (points, net run rate, standings, derived at read time from each match's own frozen document) and **words** on the pad ("Bowler has 1 over left in this spell"). A wrong condition is corrected by a new dated version for matches to come and, for a match already played, by an audited re-fix of its table figures only; its play figures are frozen with its log forever, as its Laws Edition is.

What is out: primary-school rules (balls-per-over caps, compulsory retirement, pitch and ball) are named as reserved keys and read by nothing; **transformation quotas are not a key and never will be without Kameel's explicit decision and the information officer's advice**, because they need each child's race, special personal information under POPIA. The catalogue's CHECK admits no key whose evaluation would need it.

---

## 1 · What a playing condition is, and the catalogue

### 1.1 Plain words

A condition is anything a competition may lawfully vary that the platform reads while scoring, checking, tabulating or selecting. The test for putting something in the catalogue: two competitions in the pilot could reasonably answer it differently, and some reader in the platform changes its behaviour on the answer. Something every match answers alike is a Law (the engine's); something no reader consults is documentation (`rulebook_clause`, db/32).

Every key belongs to one of three **parts**, which decide when it is frozen and who may change it after play:

| part | read by | frozen |
|---|---|---|
| `play` | the pad, the fold (`replay.mjs`), the Laws check (`laws.mjs`), the SQL mirrors (db/54's `free_hits_apply()`, `bowler_over`, `bowling_breach_watch()`) | on the match's first event, forever |
| `table` | the standings (`competition_standing`, §5), the public competition page (db/47 `competition_publication`) | on the first event; re-fixable by the organiser with a reason, audited (§3.4) |
| `sheet` | team-sheet checks (`match_squad_age_eligible()`, db/08) and the selection screen | on the first event; before it, the resolved preview applies |

### 1.2 The catalogue for the high-school pilot

Keys are dotted strings. "Default" is what the platform does today when nothing is stated, so the defaults column is also the answer to "how does the platform behave until the KZN figures arrive": exactly as it does now. **A** marks a figure that is an assumption about the KZN bye-laws (§8.4 lists them).

| key | part | type · unit | platform default (today's behaviour) | readers | phase |
|---|---|---|---|---|---|
| `format.kind` | play | enum `limited` · `declaration` · `timed` | `formatKind(match.format)` (`format.mjs`) | pad, fold, laws, sql | 1 |
| `format.overs_per_innings` | play | int · overs | `match.overs`, else the innings_start's `overs`, else 20 (`replay.mjs` `inningsFolder`) | pad, fold, sql, table (NRR) | 1 |
| `format.innings_per_side` | play | int (1 or 2) | 1; 2 for a declaration or timed format (`DECLARATION_FORMATS`) | fold (result words), pad | 1 |
| `format.free_hit` | play | bool | `freeHitsApply(match.format)` | pad, fold, laws, sql (`ball_on_free_hit()`) | 1 |
| `bowling.max_overs_per_bowler_innings` | play | int · overs, null = no cap | **none** (the Laws check does not refuse it today, `laws.mjs` header) | pad (words), sql (`condition_breach`, §4.4) | 1 |
| `bowling.limit` | play, **by age band** | object per band `{spell, day}` · overs, null = no limit | `bowling_directive` rows: U13 5/10, U14 6/12, U15 6/12, U16 7/18, open and unknown none | sql (`bowling_directive_for()`, `bowling_breach_watch()`, `workload()`), pad (words) | 2 |
| `result.min_overs_per_side` | play | int · overs, null = none | none: the fold's result stands whenever the chase resolves; the umpires' `revision` event is the only reduction | pad (words), sql (`match_result()`) | 3 |
| `result.tie_break` | play | enum `none` · `super_over` | `none` (a tie is a tie; `describeResult()`) | fold (result words), table | 3 |
| `points.win` `points.tie` `points.draw` `points.no_result` `points.loss` `points.abandoned` | table | int · points | **none**: the ladder is what the school types into `competition_entrant` today | table | 3 |
| `bonus.kind` and its parameters | table | enum `none` · `run_rate_ratio` (A: `{ratio: 1.25, points: 1}`) · `batting_bowling` (A: runs and wickets thresholds, multi-day) | `none` | table | 3 |
| `nrr.method` | table | enum `standard` (runs per over faced minus conceded; a side all out is charged its full allotted overs) | `standard` | table | 3 |
| `table.order` | table | list of `points`, `wins`, `nrr`, `head_to_head`, `fewer_losses` | `[points, wins, nrr]` | table | 3 |
| `over_rate.kind` | table | enum `none` · `points` · `runs` (the unit the umpires' penalty is entered in, §5.4) | `none` | table (offers the adjustment sheet) | 3 |
| `eligibility.age_on` | sheet | date | `season_for(match.starts_at, 'school').cutoff_on` (db/08, what `age_band()` and `match_squad_age_eligible()` use) | selection, `match_squad_age_eligible()` | 4 |
| `eligibility.max_age_open` | sheet | int · years, null = none | none: "Open teams (1XI, 2XI …) carry no age limit" (db/08) | selection, `match_squad_age_eligible()` | 4 |
| `eligibility.bona_fide_scholar` | sheet | bool | false: nothing attested today | selection (the attestation, §6), pad (notice) | 4 |

**Reserved, read by nothing** (in the catalogue so a later league fills them without a schema change, each with `readers = '{}'`): `over.max_balls` and `over.free_hit_falls_away_on_last_ball` (SCRBRD-113's primary-school note), `batting.retire_at_runs`, `pitch.length_m`, `ball.weight_g`, `fielding.powerplay`, `target.method` (`umpires_revision` today; DLS is not modelled), `bowling.rest_overs_between_spells`, `eligibility.max_overage_players`. A reserved key may be entered with a source; the screen says "recorded, not applied".

**Not a key:** anything that would need a child's race, nationality or any special personal information. `playing_condition_key.key` is CHECKed against a short deny-list of prefixes (`quota.`, `transformation.`, `race.`) so the rule is in the schema, not a comment, and the catalogue is migration-written (§7.1), so no screen can add one.

### 1.3 The catalogue in code and in SQL

`packages/scoring/src/conditions.mjs` (new) exports `CONDITION` — the same keys, parts, types, units and platform defaults as the table — and the readers the fold uses: `conditionsOf(ctx)` (the doc the fold was told, or `{}`), `freeHit(conditions, format)`, `oversPerInnings(conditions, inningsStart)`, `bowlerInningsCap(conditions)`, `bowlingLimit(conditions, ageBand)`. Every existing reader keeps its fallback so an absent doc is today's answer: `freeHit({}, "Two-Day")` is `freeHitsApply("Two-Day")`.

`playing_condition_key` (db/61) holds the same rows. The proof compares them the way db/54 §3b compares `free_hits_apply()` with `DECLARATION_FORMATS`: the db/99 section serialises the table and `conditions.test.mjs` pins the same string, so the two lists cannot drift.

---

## 2 · Where conditions live

### 2.1 Plain words

The union writes its bye-laws once for a season and they apply to every match in its league. So the values live on the **competition**, in dated versions. A **fixture belongs to one competition or to none**; today `match` has no such column (a competition knows its entrants through `competition_entrant`, db/08, but a match does not know its competition), and that is the one column this design adds to a shipped table. Two schools whose teams play in different competitions are not, for that fixture, in either: the fixture names the competition it is played under, or it is a friendly. Age is not a layer of its own: a KZN league is already one competition per age group (`competition.age_group`), and the one condition that genuinely varies by a boy's age inside a single match — the bowling limit, because a U16 boy in the 1st XI is still a U16 bowler — is keyed by age band inside the set.

### 2.2 The tables

```
playing_condition_key (          -- the catalogue; platform reference data, migration-written (§7.1)
  key              text PRIMARY KEY CHECK (key ~ '^[a-z_]+(\.[a-z_]+)+$' AND key !~ '^(quota|transformation|race)\.'),
  part             text NOT NULL CHECK (part IN ('play','table','sheet')),
  value_type       text NOT NULL CHECK (value_type IN ('bool','int','enum','date','list','object')),
  unit             text,                                   -- 'overs','runs','points','years', or NULL
  enum_values      text[],
  by_age_band      boolean NOT NULL DEFAULT false,         -- bowling.limit: one value per age_band
  platform_default jsonb,                                  -- NULL = "none": the reader's own fallback
  readers          text[] NOT NULL,                        -- documentation: pad, fold, laws, sql, table, selection
  clause_code      text REFERENCES rulebook_clause(code),  -- db/32; optional
  sort_order       smallint NOT NULL DEFAULT 0
)

condition_set (                  -- one version of one competition's conditions
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  version         smallint NOT NULL CHECK (version >= 1),
  title           text NOT NULL,                           -- "KZNCU Schools 2026/27, first issue"
  effective_from  date NOT NULL,                           -- SAST day; matches whose start day >= this (§3.2)
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn')),
  supersedes      uuid REFERENCES condition_set(id),
  published_by    uuid REFERENCES app_user(id), published_at timestamptz,
  withdrawn_by    uuid REFERENCES app_user(id), withdrawn_at timestamptz, withdrawn_note text,
  created_by      uuid NOT NULL REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, version),
  CONSTRAINT published_rows_are_dated CHECK (status = 'draft' OR published_at IS NOT NULL)
)

condition_value (                -- one figure in one version
  set_id          uuid NOT NULL REFERENCES condition_set(id) ON DELETE CASCADE,
  key             text NOT NULL REFERENCES playing_condition_key(key),
  age_band        text NOT NULL DEFAULT '' ,               -- '' unless the key is by_age_band; else a bowling_directive(age_band)
  value           jsonb NOT NULL,
  status          text NOT NULL CHECK (status IN ('confirmed','unconfirmed')),   -- §8
  source_document text, source_clause text, source_date date, source_note text,
  entered_by      uuid NOT NULL REFERENCES app_user(id), entered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, key, age_band),
  CONSTRAINT confirmed_rows_cite CHECK (status <> 'confirmed'
    OR (source_document IS NOT NULL AND source_clause IS NOT NULL AND source_date IS NOT NULL))
)
```

A `BEFORE INSERT OR UPDATE` trigger on `condition_value` checks the value against the key's `value_type`, `enum_values` and `by_age_band` (and, for `bowling.limit`, that `day >= spell` as `bowling_ceiling_open` does), and **refuses any write to a value whose set is published**: a change is a new version (`condition_set_new_version(set)` copies every row into a draft with `supersedes` set). A published set is immutable, as a `load_entry` is in SCRBRD-110 and an honour is: the table is its own audit.

```
ALTER TABLE match ADD COLUMN competition_id uuid REFERENCES competition(id);     -- NULL = a friendly
match_condition_override (      -- a per-fixture departure, before play is fixed (§3.3)
  match_id  uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  key       text NOT NULL REFERENCES playing_condition_key(key),
  age_band  text NOT NULL DEFAULT '',
  value     jsonb NOT NULL,
  reason    text NOT NULL CHECK (length(btrim(reason)) >= 10),
  set_by    uuid NOT NULL REFERENCES app_user(id), set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, key, age_band)
)
```

A trigger on `match` warns nothing but the proof checks one thing: a `competition_id` may name only a competition in which the home side is an entrant (`competition_entrant (competition_id, school_id, team_code)`); the away side, when it is a tenant, likewise. Refused, not warned: a fixture in a league neither side has entered is a data error the ladder would act on.

### 2.3 The cases

| case | what resolves |
|---|---|
| a league fixture | platform defaults ← the competition's version in force on the start day ← the fixture's own `format` and `overs` ← `match_condition_override` rows |
| a friendly (`competition_id` NULL) | platform defaults ← the fixture's `format` and `overs` ← overrides. No points; the standings never see it |
| two schools whose competitions differ | the fixture names the competition it is played under, or it is a friendly. There is no merging of two sets: a match has one set of conditions or the umpires could not stand on it |
| a 1st XI "under senior conditions" | the 1st XI league is its own competition row; its set carries the senior figures under their source (A: the union's senior playing conditions), with `bowling.limit` for `open` null and for `U16` and below still the junior figures, because the limit follows the boy, not the team (§4). "Senior" is not a flag; it is which document the figures cite |
| the fixture's `format` and `overs` versus the set | the fixture wins for `format.kind`, `format.overs_per_innings` and `format.innings_per_side` — it is what the umpires agreed on the day and what the fixture screen shows — but the fixture screen **pre-fills** them from the competition's set when a fixture is created in a competition, and the resolved doc records `sources[key] = 'fixture'` so a departure is visible. `format.free_hit` follows the set when stated, else the format, as today |

---

## 3 · Determinism: a match replays identically forever

### 3.1 Plain words

Today a match's Laws Edition is fixed by its start date (`lawsEdition()`), and its free hit by its stored format; both are facts the log cannot lose. Conditions get the same guarantee, stronger: a match carries **its own copy** of the conditions it was played under, fixed when its first event is committed, and every fold — the pad's, the server's at commit inside the per-match lock, the handover check (`services/api/handover/scoring-session.mjs`), an approved amendment's re-fold, a release from quarantine (db/33) — reads that copy and nothing else. A union changing a figure in October changes matches from the date it says, and no match already fixed.

### 3.2 Which version applies: the start day, never the fixing time

`condition_set_for(competition, on_day)` is the published version with the greatest `effective_from <= on_day`, `on_day` being the match's `starts_at` as a SAST date (`AT TIME ZONE 'Africa/Johannesburg'`, as `bowler_over` and `edition.mjs` date a match). So a fixture scored from the book a week late is under the version of the day it was played, as it is under the Edition of that day.

**No retroactive versions.** `condition_set_publish(set)` refuses an `effective_from` earlier than tomorrow (SAST). The version in force on any day is therefore settled before that day begins, and a pad that resolved the preview at breakfast and syncs at dusk resolves the same version as the server. A figure found wrong for matches already played is corrected per match (§3.4), not by rewriting the past.

### 3.3 The frozen document: `match_conditions`

```
match_conditions (
  match_id        uuid PRIMARY KEY REFERENCES match(id) ON DELETE CASCADE,
  set_id          uuid REFERENCES condition_set(id),      -- NULL: defaults and the fixture only (a friendly)
  set_version     smallint,
  doc             jsonb NOT NULL,                          -- {"v":1,"play":{...},"table":{...},"sheet":{...}}
  sources         jsonb NOT NULL,                          -- key -> {"from":"platform_default"|"set"|"fixture"|"override","status":...,"document":...,"clause":...,"date":...}
  doc_hash        text NOT NULL,                           -- md5(doc::text), computed in SQL only (§3.6)
  fixed_at        timestamptz NOT NULL DEFAULT now(), fixed_by uuid REFERENCES app_user(id),
  table_refixed_at timestamptz, table_refixed_by uuid REFERENCES app_user(id), table_refixed_reason text,
  table_doc_before jsonb                                   -- the table part as it was, kept beside the new one
)
```

`match_conditions_resolve(match)` (STABLE, SECURITY DEFINER, `fixture.read` over the match as `match_fold_context()` guards) computes the doc and sources without writing. `match_conditions_fix(match)` writes the row if none exists and returns it; it is called by the write path (`services/api/write/events-api.mjs`) **inside the per-match lock before the first event of the match is committed**, and by db/50's pad-resume path the same way. `match_playing_conditions(match)` returns `(doc, sources, doc_hash, fixed boolean)`: the row when there is one, else the resolved preview with `fixed = false`. The fold, the pad and every SQL reader ask this one function; `match_fold_context()` (db/54) keeps its shape and its callers, and `matchFoldContext()` in `events-api.mjs` calls both.

`play` is frozen at fixing: the trigger on `match_conditions` refuses any UPDATE that changes `doc->'play'` or `doc->'sheet'`. A `match_condition_override` row is refused once the match has a `match_conditions` row (the trigger checks; the screen greys it). A match with events but no row — impossible after db/61 for a new match, and every match before it — is the "no document" case: today's behaviour, by every reader's fallback.

### 3.4 A wrong figure after the fact

- **Future matches:** a new version, effective from a date, by the organiser (§7).
- **A played match's table figures** (points, bonus, over-rate unit): `match_conditions_refix_table(match, reason)` under `competition.conditions.manage`, replacing `doc->'table'` from the version now in force *on the match's start day* (which, given §3.2, means a version published since with an effective date that could not reach the match — so the function takes an explicit `set_id` and the reason says why), keeping the old part in `table_doc_before`. The standings (§5) re-derive on the next read. The row's `table_refixed_*` columns are the audit, and the standings page marks the match "conditions adjusted".
- **A played match's play figures** — a T20 fixed as a 50-over, say — are a scoring question: the innings_start's `overs` and the umpires' `revision` event carry what was played, and an amendment (`scoring_amendment`, db/02, db/38) corrects the log. The play doc is never rewritten, exactly as an Edition never is. If the fixture was created in the wrong competition, the fix before the first ball is the fixture's `competition_id` (`fixture.update` at the home school, refused after fixing); after it, the organiser moves the match with `match_conditions_refix_table()` for the ladder and the play doc stands, since it was what the umpires played to.

### 3.5 How the fold receives them

`FoldContext` (`replay.mjs`) gains one member:

```
@property {object} [conditions]   the match's play conditions: match_conditions.doc.play, as
   match_playing_conditions() gives them (or the pad's copy from the fixture read). Absent —
   the pad's own match, a caller without the fixture, every match before SCRBRD-114 —
   every reader falls back to today's rule (format.mjs, the innings_start's overs, no cap).
```

`inningsFolder()` stamps `inn.conditionsHash` (the doc's, or null) and reads `overs` and `freeHits` through `conditions.mjs`; `rulesOf(innings)` returns `conditions` alongside `edition` and `format` so a reader holding only a fold (the pad's commentary, the Match Centre) folds alike. The Laws check reads `match.innings[i]` as it does now and needs nothing more; where a condition would bear on a refusal it does not (§3.7). The pad takes the doc from the same read that gives it `startsAt` and `format` (`readFoldContext()`), and the handover check (`scoring-session.mjs`) compares the pad's `conditionsHash` with the server's before it compares figures: a mismatch is refused with words ("this match's conditions changed since the pad opened it"), which §3.2 makes a case for the proof, not for a scorer.

### 3.6 SQL reads the same values: the parity rule

**Rule:** every SQL reader of a play condition reads `match_playing_conditions(match).doc`, never `condition_value`, never `competition`; every JS reader reads `FoldContext.conditions`; both fall back to the same today's rule when the doc lacks the key. Concretely in db/61: `match_free_hits_apply(match)` becomes `coalesce((doc->'play'->>'format.free_hit')::boolean, free_hits_apply(m.format), true)` (a `CREATE OR REPLACE` of db/54's function in the new file; db/54's own proof clause on `ball_on_free_hit()` still holds); `innings_score_as_folded()` and `match_live_score` read `format.overs_per_innings` only where they read the innings_start's overs today.

**Tested three ways,** as db/54 is: (1) a db/99 section folds a fixed list of docs and formats through `free_hits_apply()`, `match_free_hits_apply()` and the new readers and serialises the answers; `conditions.test.mjs` folds the same list through `conditions.mjs` and pins the same string; (2) the section fixes a T20 fixture in a competition whose set says `format.free_hit = false` and a declaration fixture in one that says `true`, plays a no-ball then a bowled through both, and checks `match_live_score`, `innings_score_as_folded()` and `bowler_over` against the fold's reading (`tools/smoke-fold-figures.mjs` gets the same two innings); (3) an old log (the seed's, no `match_conditions` row) folds byte-identically with `conditions` absent and with `conditions = {}`, in JS and in SQL, which is the "nothing already scored moves" claim, falsified by giving the seed a row with a different `free_hit` and watching it go red.

The hash is computed in SQL alone (`md5(doc::text)`; jsonb's key order is Postgres's, and JS never reproduces it). The pad carries the hash it was given; parity is proved on answers, not on bytes.

### 3.7 What the Laws check does not do

`lawsRefusal()` keeps refusing only what the Laws refuse. A fifth over from a bowler in a T20 with a four-over cap, a seventh spell over from a U15, a 21st over of a 20-over innings: each is recorded, because the umpires allowed it and the scorer's job is to record what happened, and each writes a fact (§4.4) and words on the pad. This is the same choice `bowling_breach` already makes ("a boy who bowled a seventh over of a spell bowled it, and the row says so"). Kameel decides it (§10, D1); the fold's `overs` is unchanged by it — an innings still ends at its overs as today, from the innings_start's figure.

---

## 4 · Bowling limits

### 4.1 Plain words

`bowling_directive` (db/08) holds the platform's figures "in the absence of a published CSA schedule", and db/32's clauses say so beside them. The union's figures replace those **for matches under its competition**, by the boy's age band, with their source. The school's own ceiling on Open bowlers (`bowling_ceiling_open`) still tightens, never loosens. SCRBRD-110's personal guidelines (`athlete_limit`, `effective_limits()`, its phase 3) sit beside all of it as guidelines that write a profile line and no breach, exactly as decided there (Q8). Nothing in SCRBRD-110's load model reads a competition: it counts deliveries from `bowler_over`, which is unchanged.

### 4.2 The value

`bowling.limit` is `by_age_band`: one `condition_value` row per band the union names, `value = {"spell": 6, "day": 12}`, `age_band` a `bowling_directive(age_band)` value (the FK db/32's `rulebook_clause_age` already uses, so the union cannot name a band the platform does not know; `unknown` may not be given a figure — a boy with no recorded birth date is never quietly made Open). A band the set does not name keeps the platform default, and the resolved doc's `sources` says so per band.

### 4.3 The reader

```
bowling_directive_for(p_player uuid, p_match uuid DEFAULT NULL)
  RETURNS TABLE (age_band text, pace boolean, max_overs_per_spell smallint, max_overs_per_day smallint,
                 source text)     -- 'competition:<set_id>/v<n>' | 'platform_default' | 'school_ceiling'
```

With `p_match`, the band's figures come from `match_playing_conditions(p_match).doc->'play'->'bowling.limit'->band` when present, else `bowling_directive`; then `least()` with `bowling_ceiling_open` for an Open boy as today; `source` names which won. Without `p_match` — `workload()`, the monitor, the rulebook screen — as today (the one-argument call is the same function with the default, so every existing caller stands). `bowling_breach_watch()` passes `NEW.match_id`; `bowling_breach` gains `source text` (nullable, `ALTER TABLE ... ADD COLUMN`), and the notification says "the KZNCU bye-laws allow 6" or "the platform's directive allows 6 (unconfirmed)". SCRBRD-110's `effective_limits()` takes the same optional match and layers `athlete_limit` on the result, so the profile line names the figure it was tighter than.

The daily limit is a boy's day across every match (`bowler_over.bowled_on`), and two matches on one day could be under two competitions. The breach for the day is judged under the match being scored; the proof plays that case and the notice names the match. (A: no KZN league sets a daily figure that differs from CSA's; confirm.)

### 4.4 The innings cap: a fact, like the breach

`bowling.max_overs_per_bowler_innings` (T20: A 4; 50-over: A 10) is watched by the same trigger, writing a `bowling_breach` row with `kind = 'innings'` (the CHECK widens; `key` = the innings) and a notice under `player.workload.read`, for a tenant bowler; an opposition bowler with no `player` row has no breach row, as today. The pad shows the count for both sides from the fold (`inn.bowlers[].balls`), and for the home side the spell count too (§7.4).

---

## 5 · Points, bonus points, net run rate, over-rate penalties

### 5.1 Plain words

None of this is folded. The fold answers what happened in a match; the table is arithmetic over many matches under figures the union sets, and it belongs in SQL, derived at read time from each match's **own** frozen `table` doc, so a points change mid-season applies from its effective date by construction and a corrected result flows through with no stored figure to fix. Today `competition_entrant` holds played, won, lost, drawn, no_result, points and net_run_rate as columns a school types (db/08: "a school still edits its own entrant's record"). Those columns stay, for the competitions that have no confirmed points figures, and the standings read says which basis it is on.

### 5.2 The result in SQL: `match_result()`

New in db/63, mirroring `describeResult()` (`replay.mjs`): `match_result(match)` returns `(outcome, winner_school_id, winner_team_code, margin_kind, margin, innings_summaries)` with `outcome` in `home_win`, `away_win`, `tie`, `draw`, `no_result`, `abandoned`, `in_progress`, from `innings_score_as_folded()` per innings, the seals and revisions in the log, `match.status`, and `result.min_overs_per_side` from the play doc (fewer overs than that on either side, with no umpires' `revision`, is `no_result`). Parity as for the last four (db/43, `docs/SCORING_RULES.md` "SQL agrees with the fold"): the proof folds a list of logs both ways, `smoke-fold-figures` carries the results, and `describeResult()` is exported for the test.

### 5.3 The standings: `competition_standing`

A `security_invoker` view, read under `competition.read` as the entrant is:

- one row per `competition_entrant`, per division, for its competition's matches with `match.competition_id = c.id` and `status IN ('complete','abandoned')`;
- points per match from that match's `match_conditions.doc->'table'` (`points.<outcome>`, `bonus.kind` with its parameters against `innings_score_as_folded()` and the play doc's overs), summed with `competition_points_adjustment` rows (§5.4);
- net run rate by `nrr.method`, a side all out charged `format.overs_per_innings` of its match, a revised innings charged its revised overs;
- ordered by `table.order`;
- `basis = 'computed'` when every `points.*` key the competition's matches carry is `confirmed` in their sources, else `'entered'` and the typed columns; `unattested_results` counts matches without a §6 attestation where the sheet part asks for one.

The standings screen and db/47's public competition page read the view; nothing writes `competition_entrant.points` from it. A result correction — an approved amendment re-folding, a status change, a release from quarantine — changes `match_result()` and the view follows on the next read. Nothing is cached in the schema; if the public read path (db/59) caches, it re-reads on the match's `updated_at`, which the builder confirms.

### 5.4 Adjustments: over-rate and everything the umpires decide

```
competition_points_adjustment (
  id uuid PK, competition_id uuid NOT NULL → competition, entrant_id uuid NOT NULL → competition_entrant,
  match_id uuid → match,                         -- NULL for a season-level deduction
  kind text NOT NULL CHECK (kind IN ('over_rate','conduct','correction','other')),
  points numeric(4,1) NOT NULL,                  -- negative for a penalty
  reason text NOT NULL, source_clause text,
  set_by uuid NOT NULL → app_user, set_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_by uuid, withdrawn_at timestamptz, withdrawn_note text
)
```

An over-rate penalty is **entered, not computed**: the umpires calculate it under the bye-laws with allowances (wickets, drinks, injuries, DRS) the log does not carry, and a platform figure that disagreed with the umpires' would be wrong in the way that matters. `over_rate.kind` says whether the competition has such penalties and in what unit, so the screen offers the sheet; a `runs` penalty is a Law 41-style award the scorer records as a penalty event in the log under the reason list (`PENALTY_REASON`; A: whether any KZN league penalises over rates in runs; if none does, `runs` is dropped from the enum). Written under `competition.conditions.manage` (§7); never deleted, withdrawn with a note.

---

## 6 · Eligibility on team sheets

### 6.1 Plain words

Two things a bye-law says about a team sheet: the boys are the right age, and they are bona fide scholars of the school. The platform already checks age for U-teams (`match_squad_age_eligible()`, db/08) from `player.born`, which it holds. It records nothing new about any boy. "Bona fide scholar" becomes an **attestation by the school about the side**, not a field on the child: the person who names the XI attests, once per fixture, that the named boys are bona fide scholars of the school, and the row says who and when.

### 6.2 Age

`match_squad_age_eligible()` reads `match_playing_conditions(NEW.match_id).doc->'sheet'`: `eligibility.age_on` replaces the season cutoff when set (default is the same date, so nothing changes without a figure), and `eligibility.max_age_open` gives an Open team a limit where today it has none (A: KZN 1st XI leagues are U19 on the season date). It refuses as it does today for a boy over the limit, and taking a boy out is always allowed, as today. `age_band()` and `season_for()` are untouched: the band a boy is named by is the platform's; the date a competition measures on is the competition's.

### 6.3 The attestation

```
match_squad_attestation (
  match_id uuid NOT NULL → match, school_id uuid NOT NULL → school,
  key text NOT NULL REFERENCES playing_condition_key(key),       -- 'eligibility.bona_fide_scholar'
  attested_by uuid NOT NULL → app_user, attested_at timestamptz NOT NULL DEFAULT now(),
  statement text NOT NULL,                                       -- the words shown and agreed, as they stood
  PRIMARY KEY (match_id, school_id, key)
)
```

Written under the capability that writes `match_squad` today at that school and team, from the selection screen, when the sheet part asks for it. Nothing refuses a first ball for want of paperwork (a scorer is never stranded by the office); the pad shows "Team sheet not attested" as a notice and `competition_standing.unattested_results` counts it, and the organiser sees it on the table. Withdrawing a boy after attestation does not void it; adding one does (a trigger deletes the row for that school, and the screen asks again). No per-boy field, no enrolment date, no ID number: the boy's standing is what `player.school_id` and his `team_membership` already say. (A: whether KZN wants a per-season registration of every player with the union, as CSA's club regulations 3.1 do; that is a later item and this attestation does not preclude it.)

---

## 7 · Who may create and change conditions, and what the scorer sees

### 7.1 Capability and scope

- **The catalogue** (`playing_condition_key`) is written by migrations and by nobody through the application, as `rulebook_clause` and `bowling_directive` are: `REVOKE INSERT, UPDATE, DELETE` from `scrbrd_app`, read by anyone signed in (`app_user_id() IS NOT NULL`).
- **`competition.conditions.manage`** (new; `ADDED_SINCE_01` in `generate-rls.mjs`, catalogue row and grants in db/61): create a draft version, enter and confirm values, publish, withdraw, override a fixture before play, re-fix a played match's table part, enter a points adjustment. Held by `competitionadmin` (`roles.mjs`), which already holds `competition.manage`. Scoped through `app_can(cap, competition.school_id)` — the organiser; a competition with `school_id` NULL (an external body not on the platform) is administered by a platform-wide holder (`app_is_platform_wide()`, db/20), which in the pilot is Kameel. A KZN union that becomes a tenant (`school.kind = 'union'`) organises its competitions as itself and assigns its own `competitionadmin`. A school running its own festival is the organiser of that competition and assigns the role at the school.
- **Reads:** published sets and their values under `competition.read` over the competition, as `competition_division` is read; drafts under `competition.conditions.manage` only. The frozen `match_conditions` row is read wherever the fixture is (`fixture.read`), and the public page shows the competition's confirmed figures by name and source when the competition is published (db/47), never a draft.
- **Overrides on a friendly** (`competition_id` NULL): `fixture.update` at the home school, before play.

### 7.2 Separation of duties

- A scorer holds none of it: `scorer` has no `competition.*` write and the pad's resume credential (db/50) cannot reach `condition_set` at all.
- The person who **publishes** a version and the person who **enters** a value may be one person; the row records both acts. What is separated is the ladder from the log: a re-fix (§3.4) or an adjustment (§5.4) changes the table and cannot touch an event, and an amendment approval (`scoring.amend.approve`) changes the log and cannot touch the table. `competitionadmin` holds both today; the standings page names, per match, who adjusted what, so a union that wants two people can see whether it has them. Splitting the role is D8 for Kameel.
- Support sessions (the platform owner acting as a role) cannot publish or re-fix: the two functions check `app_user_id()` is the session's own user, as `bowling_ceiling_school_only()` sets `set_by` from it.

### 7.3 Audit

Versions are immutable and dated; values name who entered them and their source; a re-fix keeps the part it replaced; an adjustment is withdrawn, never deleted; an override names its reason. That is the audit, in the tables, readable under `audit.read` through the existing audit screen's reads. No `access_log` rows: nothing here is personal information at a restricted tier.

### 7.4 What the scorer sees on the pad

The pad reads the doc with the fixture (§3.5) and the fold. It says, in the bowler line and on the new-over sheet:

- "Bowler has 1 over left in this spell (U15: 6 a spell, KZNCU bye-laws 7.3)" or "… (platform default, unconfirmed)", from `bowling.limit[band]` and the boy's spell as `bowler_spell` counts it (over numbers two apart are one spell; a gap of three or more ends it), computed in JS by `spellsOf(inn)` in `conditions.mjs`, with a parity test against `bowler_spell` on a fixture list. The band comes with the home squad read as `ageBand` (a band, not a birth date; the pad never holds a date of birth); an opposition bowler with no row gets no spell words, and the innings cap words only.
- "Bowler has bowled his 4 overs" from `bowling.max_overs_per_bowler_innings`, both sides.
- "Free hit" / "No free hit in this match" as today, now from the doc.
- "Fewer than 5 overs bowled: no result unless the umpires say otherwise" from `result.min_overs_per_side`.
- "Team sheet not attested" (§6.3).
- The sheet does not grey the bowler out (§3.7). Past the line, the ball is recorded and the line reads "7 overs into a spell; the bye-laws allow 6", the same words the breach notice carries.

---

## 8 · Data provenance

### 8.1 Every figure names where it came from

`condition_value.status` is `confirmed` only with a document, a clause and a date (the CHECK); everything else is `unconfirmed`. The resolved and frozen `sources` doc carries, per key and band, `from` (`platform_default`, `set`, `fixture`, `override`) and the citation, so a scorecard's footer can say "Played under KZNCU Schools 2026/27 v2" and the rulebook screen can say, beside a figure, "KZNCU Schools Bye-laws 2026/27, clause 7.3, 15 September 2026" or "the platform's default; no published schedule confirmed". The platform defaults cite db/32's clauses (`clause_code`) so the existing rulebook words are the source they name.

### 8.2 What the platform shows meanwhile

Wherever a figure is shown — the pad's words, the rulebook, the competition's conditions page, the standings' basis — an `unconfirmed` or `platform_default` figure carries the words "platform default, unconfirmed" (a chip on screens, a parenthesis on the pad). The competition page counts "12 of 18 figures confirmed". Nothing is hidden for being unconfirmed and nothing behaves differently: the behaviour is today's until a figure says otherwise.

### 8.3 How the KZN figures arrive

1. Kameel supplies the KZNCU and KZNICU schools' bye-laws and playing conditions as PDFs (the union sites are blocked from here).
2. A Haiku pass extracts each candidate figure with its clause into a table in the backlog under SCRBRD-114, one row per catalogue key and band, marked "extracted, not entered".
3. The competition admin — for the pilot, Kameel as platform-wide holder, on the unions' behalf — enters each figure on the conditions screen with its citation and publishes the first version with an `effective_from`. Nothing is seeded by migration: the unions' figures are application data they must be able to change per season, unlike the catalogue.
4. The demonstration seed (`db/98_seed_pilot.sql`, the demonstration path) gets one published set per seeded competition with plausible figures marked `unconfirmed`, so every screen has something to show and no unconfirmed figure ever ships as confirmed.

### 8.4 Assumptions about the KZN rules, each to be confirmed

| # | assumption | where it bites |
|---|---|---|
| A1 | Each union's schools league has its own bye-laws layered on CSA's regulations and the MCC Laws; one competition row per league and age group is the right grain | §2 |
| A2 | Age-band bowling limits exist for U13–U16 and differ, if at all, only in figures from the platform's; none sets a daily figure that differs by competition | §4 |
| A3 | 1st XI plays under senior playing conditions: no bowling limit for Open boys, a per-bowler innings cap (T20 4, 50-over 10), and a maximum age (U19 on the season date) | §1.2, §4.4, §6.2 |
| A4 | Limited-overs formats are T20, 25-over and 50-over; declaration cricket is one- or two-day timed with two innings a side possible | §1.2 |
| A5 | Points systems award fixed points per outcome with a bonus in 50-over cricket for a run-rate ratio (1.25) and, if multi-day exists, batting and bowling bonus points; tables order by points, wins, NRR | §5 |
| A6 | Over-rate penalties, where they exist, are in points or in runs, decided by the umpires or the union after the match | §5.4 |
| A7 | Team sheets must be bona fide scholars, attested per fixture; per-season registration is a union matter not required for the pilot | §6.3 |
| A8 | Nothing in either union's conditions needs a child's race or nationality to evaluate; if one does, it is not built (the backlog's rule) | §1.2 |

---

## 9 · Phasing

One migration per phase, its proof in `db/99` (`docs/ARCHITECTURE.md §9`), a smoke walk, and the shipped-file rules of `DEPLOYING.md` (db/01 and db/09 never change; a shipped file never changes; each phase's policies are emitted into its own file; `FROZEN_THROUGH` moves after each paste). Numbers assume db/60 is SCRBRD-110's phase 1 and nothing else lands first; if SCRBRD-110's later phases land between, these move up and nothing else changes. db/99 sections continue from the last (db/59 is §37).

| phase | migration | tier | ships | proves (db/99 and a smoke walk) |
|---|---|---|---|---|
| **1 · The shape** | `db/61` | Opus (schema, fold, parity); Sonnet (the conditions screen over the API) | `playing_condition_key` with the pilot catalogue and reserved keys; `condition_set`, `condition_value`, their triggers, `condition_set_new_version()`, `condition_set_publish()`; `match.competition_id` and its entrant check; `match_condition_override`; `match_conditions`, `_resolve()`, `_fix()`, `match_playing_conditions()`; `match_free_hits_apply()` reading the doc; `competition.conditions.manage` (`ADDED_SINCE_01`); `conditions.mjs`, `FoldContext.conditions`, `inn.conditionsHash`, `rulesOf()`; `matchFoldContext()` and `readFoldContext()` carrying the doc; the fix call in the write path and db/50's resume; the handover hash check; the pad's free-hit and innings-cap words; the conditions screen (draft, enter with citation, publish) | the catalogue serialises to the string `conditions.test.mjs` pins; the deny-list refuses `quota.x`; a published value cannot change and a new version copies it; publishing with `effective_from` today or earlier is refused; a fixture on day D resolves the version in force on D, not the one published after; the first event fixes the row and a later publish does not touch it; an override after fixing is refused; a friendly resolves defaults and the fixture's format; a T20 under `free_hit = false` stands the bowled after a no-ball in JS and in `match_live_score`, `innings_score_as_folded()` and `bowler_over`, and a declaration fixture under `free_hit = true` saves it; the seed's logs fold byte-identically with and without a row; a pad resume with a different hash is refused with words; a scorer cannot read `condition_set`; a fixture in a competition neither side entered is refused. Walk: `smoke-conditions` (API) and a `smoke-browser-conditions` that publishes a set, creates a fixture in it, sees the pre-filled format and the pad's words |
| **2 · Bowling limits** | `db/62` | Opus | `bowling_directive_for(player, match)` with `source`; `bowling_breach.source` and `kind = 'innings'`; `bowling_breach_watch()` re-emitted; the notice words; `spellsOf()` in `conditions.mjs`; the pad's spell words and `ageBand` on the squad read; SCRBRD-110's `effective_limits()` taking the match (if its phase 3 has landed; else a note there) | a U15 under a set saying 7 a spell breaches at 8, not 7, and the row and notice name the union; the same boy in a friendly breaches at 7 and names the platform default; a school ceiling still tightens an Open boy under a set saying none; `workload()` is unchanged; `athlete_limit` still writes a profile line and no breach; two matches in one day under two sets judge the day under the match being scored; `spellsOf()` agrees with `bowler_spell` on the fixture list; the U16 in the 1st XI is limited and the Open boy beside him is not; an innings-cap breach row for a tenant bowler and none for an opposition one |
| **3 · The table** | `db/63` | Opus (`match_result()`, the view, adjustments); Sonnet (standings screen, adjustment sheet, public page read) | `match_result()`; `competition_points_adjustment`; `competition_standing`; `match_conditions_refix_table()`; `describeResult()` exported; the standings and public reads moved to the view; `over_rate.kind` sheet | `match_result()` agrees with `describeResult()` on the fixture list including a tie, a no-result under `min_overs_per_side`, a by-penalty-runs win and an abandoned match; a competition with confirmed points computes and one without shows the typed ladder; NRR charges an all-out side its full overs and a revised innings its revised overs; a points change effective next week leaves this week's matches on the old figure; an approved amendment that flips a result flips the table on the next read; an over-rate adjustment lands and its withdrawal restores; a re-fix keeps `table_doc_before` and cannot change `play`; a support session cannot re-fix; the public page shows confirmed figures and no draft |
| **4 · Team sheets** | `db/64` | Opus (trigger, attestation policy); Sonnet (selection screen, pad notice) | `match_squad_age_eligible()` re-emitted reading the sheet doc; `match_squad_attestation`; `unattested_results` in the view; the selection screen's attestation; the pad's notice | an Open team with `max_age_open = 19` refuses a twenty-year-old and accepts him when the key is absent; `age_on` moves a boy across a band and the trigger follows; taking a boy out is always allowed; an attestation is written only by the squad's writer, voided by an addition and not by a withdrawal; a first ball is never refused for want of one; the standings count it; no new column on `player` |
| **5 · The KZN figures** | none (application data); `db/98` seed rows on the demonstration path | Haiku (extraction table in the backlog, docs); Kameel (entry and publication) | the extracted figures with clauses; the two unions' first versions entered and published; `docs/SCORING_RULES.md` and the rulebook words updated | the competition page counts every pilot figure confirmed; every pad word names a clause; the standings show `computed` for the pilot leagues |

Phase 1 must be first. Phases 2, 3 and 4 are independent of each other and may land in any order; 3 before 4 lets the table count attestations from the day they exist. Phase 5 needs the PDFs and nothing else.

### 9.1 Build notes (phase 1, Opus, 2026-09-28)

Phase 1 is built as `db/61_playing_conditions.sql` (numbered after SCRBRD-110's db/60; renumbered at landing if needed), with its proof in the file and in db/99 §39. Where the build departs from or fills in the text above, and why:

1. **Names.** `tools/smoke-conditions.mjs` already exists (the weather and the pitch), so the walks are `smoke-playing-conditions` and `smoke-browser-playing-conditions`, and the routes say `playing-conditions` (`/api/matches/:id/weather` is the other kind).
2. **Where the fix is called.** Once per batch in `appendEvents()`, right after `scoring_lease_check()` takes the per-match lock and outside the per-event savepoints, when the device holds the token and has an event of its generation to write. Called per event inside a savepoint, a first event refused by a column CHECK would roll the fix back while the next event was written, leaving a new match scored with no document for ever. The cost: a batch whose every event is refused still fixes the document — the first scoring write fixes it, a moment before the first event lands. The pad's resume credential comes through the same function. A release from quarantine calls the fix before `quarantine_resolve()` writes the ball (inside its savepoint, so a Laws refusal rolls both back).
3. **The fix refuses a match already scored** (`scored_before_conditions`), which is how D4's "no backfill" is enforced rather than hoped for: a match in progress when db/61 is pasted is never given a document mid-match. It asks `scoring.edit` or `scoring.amend.approve` (a release's approver), and takes the live path's lock itself (session row, then a per-match advisory lock the override and a change of competition also take).
4. **`match_playing_conditions()`** returns, beside `(doc, sources, doc_hash, fixed)`, `applies` — the frozen row, or the preview of a match with no event yet — and the version's id, number and title for the pad's words. A fold applies the document only when `applies`; SQL's `match_free_hits_apply()` reads the frozen row only, so a preview never decides a logged wicket.
5. **Overs.** `oversPerInnings()` is the innings_start's overs, else the document's, else 20 (§3.7: "an innings still ends at its overs as today, from the innings_start's figure"). No SQL reader reads an innings' overs today (`match_live_score` and `innings_score_as_folded()` count balls, not the limit), so nothing in SQL changed for it; `play_overs()` exists as the parity mirror.
6. **Withdrawal** is of a draft, or of a published version *not yet in force*; one in force is corrected by a new version. Otherwise withdrawing today's version would change the version in force on a day already begun, which §3.2 exists to prevent. A support session may not withdraw, as it may not publish.
7. **Publishing** also refuses an `effective_from` before the newest published version's, so a later version cannot reach back under an earlier one; two on the same day resolve to the higher version (a correction before the day).
8. **The catalogue** is 31 keys: the table's, with `bonus.kind`'s parameters as `bonus.params` (object), and the reserved `target.method` an enum of one (`umpires_revision`). `bowling.limit` may not be given for `unknown`. JSON `null` is accepted for a number or an object ("none stated", e.g. no cap).
9. **The entrant check** runs when the competition or a side is named or changed, not on every touch of the row: a school that has left a league can still move its old fixture. The fixture's amend route takes `competitionId` (a correction before the first ball; refused once scored).
10. **Sources** for the fixture-derived keys say `from: "fixture", status: "confirmed"` — the school's own statement of the day, not an assumption; an override says `from: "override"` with its reason.
11. **The handover's hash** is checked in the verify route (`POST /session/handover/verify`, `conditionsHash` in the body) before `scoring_verify_takeover()` reads the board; the claim now returns `fold` (the conditions and their hash) with the log, and the incoming pad adopts it. A pad that sends no hash (an older build) is not asked. The phase 1 cell says "a pad resume with a different hash is refused with words": on a resume (a reload, the pad's credential) the pad re-reads the document before it folds (what it saved with the log, then the server's), so it never folds under a stale one; the refusal in words is at the handover, as the lead's brief put it. Flagged in the report.
12. **The public page** (db/59, off by default) folds a served fixture in the browser; it would stand a free-hit wicket differently from the server under a league's document. `public_match_conditions()` (db/61) gives it the frozen play part and hash, gated on db/59's own `public_fixture_served()`. Not in the phase 1 cell; added so no reader of the log folds it differently.
13. **The pad's words** are one line under the board (the version, "No free hit in this match", "N overs a bowler", each "(unconfirmed)" where nobody confirmed it), a line for the bowler on against the cap, and the cap on the new-over sheet per bowler. Nothing is greyed out for a condition (D1). The spell words are phase 2's.
14. **The seed** (D12) gets no sets in phase 1: the walks and db/99 make their own; §8.3's step 4 is phase 5's `db/98` row.
15. **db/99 §28**'s list of definer functions that ask a pad capability by name gains `match_conditions_fix`, `match_conditions_resolve` and `match_playing_conditions`, each looked at: the credential's own match only, the league's published figures, nothing about a person.

---

## 10 · Decisions for Kameel

**Decided (Kameel, 2026-09-28): D1–D12 as recommended.** A1–A8 stay open until the KZN bye-laws are in hand.

Each with the recommendation the body assumes.

| # | decision | recommendation |
|---|---|---|
| **D1** | Conditions never refuse a delivery: a bowler past his cap, a spell past its limit, a 21st over are recorded, a fact is written and the pad says so. Or should the Laws check refuse them? | **Never refuse.** The umpires allowed it; the scorer records; the breach row and the notice are the enforcement, as `bowling_breach` already is. A refusal strands a scorer against the game in front of him |
| **D2** | The version in force is chosen by the match's start day, and a version cannot be published with an effective date of today or earlier | **Yes.** It is the Edition rule again, and it makes the pad's morning preview and the server's evening fix agree by construction |
| **D3** | `play` (and `sheet`) frozen at the first event forever; `table` re-fixable per match by the organiser with a reason kept beside the old part | **Yes.** A wrong play figure is a scoring amendment; a wrong points figure is arithmetic and is corrected where it lives |
| **D4** | No backfill: matches before db/61 have no document and fold as today; standings stay typed until a competition has confirmed points figures | **Yes.** Nothing already scored moves, and no ladder is computed from figures nobody confirmed |
| **D5** | The platform default for the per-bowler innings cap: none (today), or the common overs-divided-by-five | **None.** The platform has never enforced one; a number nobody confirmed becomes a breach notice to a coach. The screen suggests "T20 leagues commonly use 4" beside the empty field |
| **D6** | Over-rate penalties entered as the umpires' adjustment rows, never computed from timestamps | **Yes.** The log lacks the allowances; a computed figure that disagreed with the umpires' would be the wrong one |
| **D7** | "Bona fide scholar" as a per-fixture attestation about the side by whoever names the XI, with no new field on any boy | **Yes.** It is what a signed team sheet is; it records nothing new about a child. Ask the unions whether they want per-season registration instead, later |
| **D8** | `competition.conditions.manage` held by `competitionadmin` alone (who also approves amendments); or split a `conditionsadmin` role so the ladder and the log are never one person | **`competitionadmin` alone for the pilot.** The table names who adjusted what; a union that wants two people can assign two. Splitting is one `ROLES_ADDED_SINCE_01` entry later |
| **D9** | Per-fixture overrides allowed before play is fixed, by the organiser (a friendly: the home school's `fixture.update`), each with a reason | **Yes.** A festival day with a shortened format is real; after the first ball it is the umpires' revision, as today |
| **D10** | The home squad read carries each boy's age band to the pad (a band, not a birth date) so the spell words work; the opposition gets innings-cap words only | **Yes.** "U15" is already on every team screen; a date of birth never leaves the server |
| **D11** | For the pilot, Kameel enters the two unions' figures with citations as the platform-wide holder, and the unions take over their own competitions when they become tenants | **Yes.** It is the only way the pilot's figures exist by the season, and the rows say who entered them |
| **D12** | The seed's competitions carry an `unconfirmed` set with plausible figures so screens show something; production shows platform defaults until the real figures are published | **Yes.** No figure ever ships confirmed that nobody confirmed |

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `match.format`, `match.overs`, `match.starts_at`, `match.status` | `db/00_schema_core.sql` | the fixture's own format; the start day; completion (db/33) |
| `competition`, `competition_entrant`, `competition_division`, `competition_publication` | `db/00`, `db/08`, `db/47` | the competition grain; entrants and the typed ladder; the public page |
| `formatKind()`, `freeHitsApply()`, `DECLARATION_FORMATS` | `packages/scoring/src/format.mjs` | the fallback for `format.kind` and `format.free_hit` |
| `lawsEdition()`, `matchDay()` | `packages/scoring/src/edition.mjs` | the date rule this design copies |
| `FoldContext`, `rulesOf()`, `inningsFolder()`, `describeResult()` | `packages/scoring/src/replay.mjs` | where the doc enters the fold; the result the SQL mirror agrees with |
| `lawsRefusal()` | `packages/scoring/src/laws.mjs` | what is not changed |
| `match_fold_context()`, `free_hits_apply()`, `match_free_hits_apply()`, `ball_on_free_hit()`, `innings_score_as_folded()`, `match_live_score` | `db/54_laws_4th_edition.sql`, `db/45`, `db/48` | the SQL mirrors and the parity pattern |
| `matchFoldContext()`, `readFoldContext()` | `services/api/write/events-api.mjs` | the read that carries the doc to the fold and the pad |
| `scoring-session.mjs` | `services/api/handover/` | the handover check that compares the hash |
| `bowling_directive`, `bowling_ceiling_open`, `bowling_directive_for()`, `bowler_over`, `bowler_spell`, `bowling_breach`, `bowling_breach_watch()`, `workload()`, `age_band()`, `season_for()` | `db/08_schema_programme.sql` | the limits and the breach; the band vocabulary; the season date |
| `rulebook_clause`, `rulebook_clause_age` | `db/32_rulebook_clause.sql` | the platform defaults' citations; the band FK pattern |
| `match_squad`, `match_squad_age_eligible()` | `db/00`, `db/08` | the team sheet and its age check |
| `scoring_amendment`, `scoring_amendment_decide()`, db/33's quarantine, db/50's resume | `db/02`, `db/38`, `db/33`, `db/50` | the paths that re-fold and must read the same doc |
| `athlete_limit`, `effective_limits()`, `load_entry` | `docs/design/SCRBRD-110_workload.md` (unbuilt) | guidelines beside the limits; the immutable-version pattern |
| `app_can()`, `app_is_platform_wide()`, `competitionadmin`, `competition.manage`, `ADDED_SINCE_01` | `db/01`, `db/20`, `packages/policy/src/roles.mjs`, `services/api/rls/generate-rls.mjs` | the capability and its scope; how a new capability ships |
