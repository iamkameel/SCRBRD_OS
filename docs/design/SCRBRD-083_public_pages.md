# SCRBRD-083 — The public pages: how the rule is built

Status: **design, for Kameel's review** (Fable, 2026-09-27); §9 decided the same day.
**Phase 1 built 2026-09-28 (Opus), and not live**: off unless a deployment sets
`PUBLIC_PAGES=on` (§8, phase 1, "As built"). Phases 2–5 are not built.
Opus builds from it, phase by phase (§8). The rule itself is decided and is not
reopened here: `docs/policy/PUBLIC_DATA.md` (§1–§4, confirmed reading §5a). This
document is that rule's §6 items 3 and 4, and everything that now hangs off them.

Two decisions made today are taken from the brief, not from a file: the health-data
answer to SCRBRD-110 Q7 (a parent's consent stays valid while the pupil is still in
the school system, and her access continues) and the parent's view of her child's
side's team sheet (STEP4 §9). The copies of those documents on this branch still
carry the earlier recommendations (`SCRBRD-110_workload.md` line 571 says "Lapse";
`STEP4_parent_pupil.md` Q10 says "Not in step 4"). Whoever merges should update
them; this design assumes the brief.

---

## 0 · Summary

A public page is a page anyone with the link can open, signed out. Today none exists;
the Match Centre is signed-in and folds the raw ball log in the browser, and that log
carries every child's full name in its squads. So the public pages cannot be "the
Match Centre without a token". They need **one server-side read path** that hands the
browser a version of the match with the rule already applied, and nothing the rule
forbids ever leaving the server.

The design in one paragraph. Every signed-out request goes to `/api/public/*`, runs
as the **anonymous principal** the auth layer already has (RLS then denies every
base table), and can therefore only read through a small set of new
`public_*()` SECURITY DEFINER functions, each of which names its columns and is
checked against `NEVER_PUBLIC` by a test. The centre of it is one function,
`public_match_log()`, which returns the fixture's event log **after redaction**:
every player replaced by a per-match pseudonym, every name replaced by what
`publicName()` says (computed on the server from `public_name_facts()`), typed names
and off-platform sides reduced to a position, and every field that is not on an
allowlist dropped — reasons, notes, shot placement. The browser then folds that log
with the same `@scrbrd/scoring` the Match Centre uses, so the public live page, the
scorecard, the commentary, the overlay and the graphics pack all draw from **one
projection**, and a withdrawn consent changes all of them at once because none of
them ever held a name. AI commentary lines are stored **tokenised**, never with a
name, and the tokens are resolved at serve time by the same rule. Search engines are
told `noindex` on every response, and public reads are cached for seconds, not days.

On turning 18 the recommendation is asymmetric: a parent may still take her adult
son's name **off** a public page while he is at school, but never put it **on**;
from his birthday only his own word puts it on, and the app asks him for it.

---

## 1 · Principles — what never happens on a public page

These follow from PUBLIC_DATA and are restated so a builder can check a diff
against them without re-reading the rule.

1. **No name leaves the server unless `publicName()` said so.** The browser never
   sees a full name, a first name, a stored surname or a known-as. It sees the
   string `publicName()` returned — "D Erasmus" or "Batter" — and nothing it could
   turn back into a name.
2. **No child's identifier leaves the server.** A `player.id` on a public response
   is a key to every other record about him and lets a stranger join his
   scorecards together (A4: no page per player). Public responses carry per-match
   pseudonyms (§2.4).
3. **"Batter" is one string.** A boy without consent, a boy with a never-public
   mark, a boy whose school has names off, and a typed name are indistinguishable
   on the page and in the JSON. No field says which.
4. **Allowlist, never denylist.** A public read names every column it selects and
   every field it emits. `*` is refused (`assertPublicSelect`), and so is a
   projection that copies an event payload through. A field added to a table or an
   event later reaches nobody until somebody puts it on a list.
5. **Reasons and free text never leave.** A retirement's reason, a bowler change's
   reason, a scorer's note, a revision's comment, an honour's withdrawal reason:
   none of them is on any list. Health (N2) and discipline (N3) mostly live in
   exactly these fields.
6. **Fail closed at every layer.** No token → anonymous principal → RLS denies →
   only `public_*()` functions answer. A function that forgets a check returns
   nothing rather than something. `publicName()` with a missing fact returns a
   position.
7. **Consent is judged on the day served** (§5a). A page carrying names is never
   cached past a minute and is re-read the moment a consent, a mark, a switch or a
   publication changes (§2.6).
8. **Findable by link, not by search.** `X-Robots-Tag: noindex` on every public
   response, `<meta name="robots" content="noindex">` in every public HTML shell,
   and `/robots.txt` disallowing the public paths.
9. **No photo, no age, no date of birth, no health, no discipline, no judgement**
   (§3) on any public page, overlay or graphic, whatever the consent.
10. **Off until switched on.** An unpublished fixture, competition or overlay is a
    404 that reads exactly like a fixture that does not exist.

---

## 2 · The signed-out read path

### 2.1 Identifying a signed-out request

There is no "signed-out mode" on the existing routes. The public pages get their own
router, `/api/public/*`, and the rule is about the **route**, not the caller:

- A request to `/api/public/*` runs as `ANON` (`services/api/auth/auth.mjs` line
  145) whether or not it carries an `Authorization` header. A signed-in coach who
  opens a public link sees the public page. This keeps one code path and makes the
  test in §8 phase 1 possible: the response to a request with a valid staff token
  must be byte-identical to the response without one.
- Every other route keeps its behaviour: no token is `401 missing_token`
  (`auth-db.mjs` line 194). Nothing existing loosens.
- The public router never calls `readResource()` and never touches `READ_QUERIES`.
  Those are the governed, signed-in reads with masking views and the access log,
  and a public request has no principal to log against.

### 2.2 Why running as the anonymous principal is the guarantee

`withPrincipal()` with `ANON` sets `app.user_id` to the empty string, `app_user_id()`
returns NULL, `app_can()` finds no assignment, and every RLS policy denies
(`auth.mjs` lines 152–158, ADR 0001). So inside a public read a plain
`SELECT … FROM player` returns **no rows**. The only way a public function gets
data is to be `SECURITY DEFINER`, like `public_name_facts()` already is (db/47 line
837), and every such function is written by hand, names its columns, and is granted
to `scrbrd_app` only with the platform's `anon`/`authenticated` roles revoked (db/47
lines 843–870 shows the pattern). A builder who forgets to go through such a
function gets an empty page, not a leak.

The test that holds this: `packages/policy/test/public.test.mjs` already checks
`NEVER_PUBLIC` against `tables.mjs` and the schema. It gains a case that reads every
`public_*()` function body in the new migration, extracts the `table.column` pairs
it selects, and runs `assertPublicSelect()` over them. A function selecting
`player.born`, or `injury.*`, fails the suite.

### 2.3 The reads, and what each returns

All under `GET /api/public/…`, all JSON, all with the headers in §2.7. `:match` and
`:competition` are the existing uuids (unguessable; they already travel in
signed-in links). A fixture is served when **at least one side** is published
(`fixture_side_published()`, db/47 line 695); a competition when
`competition_published()` is true; otherwise 404 with the same body as "no such id".

| Read | Function(s) behind it | Returns |
|---|---|---|
| `matches/:match` | `public_match_header(match)` | The header: both team names (a school's name is not a child's; the away `opponent` text stays as typed because it names a school, not a boy — §9 Q3), short codes, age group as the team code carries it ("U15A"), format and overs, `starts_at`, ground name, status, competition and division names, toss (who and decision), result text, which sides are published. **No** officials (§9 Q5), no date of birth, no weather. |
| `matches/:match/log` | `public_match_log(match, since)` | The redacted event log (§2.4). Incremental with `since` like the signed-in read. |
| `matches/:match/shots` | `public_shot_sectors(match)` | L7, team level: per innings, per sector, the count of scoring shots and runs. No ball, no batter, no coordinates. |
| `matches/:match/commentary` | `public_commentary_ai(match, since)` | The stored AI lines (§4), tokens already resolved by the rule, keyed by event so the browser can interleave them with the deterministic lines. Empty when a school has switched them off. |
| `matches/:match/board` | composed from the two above | The overlay's slice (§5): score, overs, run rate, target, batters at the crease, bowler, this over's balls, banner event, sponsor, strapline. Same names as the page, by construction. |
| `competitions/:competition` | `public_competition(competition)` | Name, season, divisions; standings (`competition_entrant` fields as `league` reads them today: played, won, lost, drawn, no result, points, NRR); results and fixtures: date, both team names, scores by innings, result text, and a link to the fixture page **only where a side is published**. No player anywhere (A3). |
| `schools/:school/fixtures` | `public_school_fixtures(school, team?)` | The school's fixtures and results whose side is published: date, time, ground, opponent name, scores, result, status. Team names only. Serves the "fixtures and results" page of the brief. |
| `honours/:school` | `public_honours(school, team?)` | Phase 2. Honours with `is_public` and no `withdrawn_at`: kind, label, season, `awarded_on`, citation (§9 Q6), name by the rule with label "Player". No `withdrawn_reason` ever (it is on `NEVER_PUBLIC`). |

Each function takes `sa_today()` as the day and passes it to `public_name_facts()`;
the API passes the same day string as `on` to `publicName()`. Two clocks are one clock.

### 2.4 The redacted log: `public_match_log()` and the projection

This is the load-bearing piece, so it is spelled out.

**Why a redacted log and not a server-folded view.** The Match Centre, the
commentary generator, the partnerships, the phases and the graphics pack all
consume the fold of the event log. Folding on the server and shipping derived
state would mean a second rendering path to keep in step with the first for every
law the fold knows. Shipping the log with the rule applied to it keeps one fold and
one set of components, in public mode. The cost is that the projection must be an
allowlist done with care; that is the whole of this section.

**Pseudonyms.** Every player reference in the log (`SquadMember.id`,
`striker`/`nonStriker`/`bowler`, the fielder on a wicket, the batter on a retire or
a milestone) is replaced by `hmac(PUBLIC_PSEUDONYM_SECRET, match_id || player_id)`
truncated to 12 hex characters. Stable within a match — the fold needs the same id
on every event — and not linkable to another match or to any record without the
secret. The secret is a server environment variable like the token secret
(DEPLOYING.md's table). A typed name (a person with no player row) gets a pseudonym
the same way from the typed string, so the fold still tells two typed fielders apart.

**Squads.** `innings_start` carries `squad` and `bowlingSquad` as `SquadMember[]`
(`packages/scoring/src/events.mjs` line 473: `id`, `name`, `batHand`,
`batting_style`, `battingStyle`). The projection emits, per member:
`{ id: pseudonym, label: publicName(facts) }` and `batHand` (a batting hand is on
no list in §3 and the Match Centre's phases need it; §9 Q7 asks it anyway). The
`label` is the **only** name-like string on the whole response, and it is either
"D Erasmus" or the position word. Nothing else on the member survives.

**How the label is computed, per member, on the server.** The function joins the
member's id to `player`, works out which side he is on, and calls
`public_name_facts(player, side_team_code, on)` (db/47 line 794). The API composes
`NameFacts` (`public.mjs` line 337):

- `on` — the day string the function returned;
- `typed` — true when the id matched no `player` row (L6);
- `schoolOnPlatform` — the side's school id is not null (L5: an away side with only
  `opponent` text is not on the platform);
- `schoolPublished` — `fixture_side_published(match, side)` for **his** side (L5:
  each school speaks for its own children; a fixture with only the home side
  published shows the away eleven as positions);
- `neverPublic`, `namesOff`, `consents` — exactly as `public_name_facts()` returns
  them;
- `fullName`, `surname`, `knownAs` — read by the function for the sole purpose of
  the formatter, and **never emitted**; the function returns the label, not the
  parts. Concretely: the SQL returns the three facts and the three name columns to
  the API in one row per member, the API calls `publicName()` and keeps the label,
  and a test asserts the response body contains none of the three name columns'
  values for any member;
- `label` — "Batter" or "Bowler" by which squad he is on; the fielder and keeper
  labels come from the commentary's `ROLE_WORDS` when it needs them.

**Events.** Each event kind has an allowlist of fields. Everything else is dropped
before serialisation. The lists, as the design stands (Opus finalises them against
`events.mjs`'s typedefs and the fold's needs, and the test in §8 pins them):

| Kind | Kept | Dropped, and why |
|---|---|---|
| `innings_start` | innings number, batting side, format/overs, target, squads as above | anything else |
| `batters` | striker, nonStriker (pseudonyms) | — |
| `bowler` | bowler (pseudonym) | `reason` — injured or suspended is N2/N3 |
| `ball` | type, runs/value, extras kind, dismissal (canonical), the out batter, fielder (pseudonym), run-out end, free-hit flag, short-run flag, `seq`, timestamp | `placement`/shot coordinates (L7: team level only — served aggregated by `public_shot_sectors`), shot id and any note; `speed` if ever recorded |
| `retire` | batter, out/not-out as the fold needs it | `reason` ("hurt" is N2). The commentary already reads "retires, not out" with `sensitive: false` |
| `penalty` | runs, which side, the Law 41 reason **code** (§9 Q4) | any note |
| `void` / `revision` | the target event's seq and the corrected fields; on a void an approved amendment wrote, `amendment: true` (GA-I36, 8 Oct 2026: the page tells it from a scorer's undo) | the comment or note; the amendment's id, reason and people |
| `innings_end` | reason code, totals as recorded | note |
| `milestone`, `over_end`, `short_running` | as the fold needs; players as pseudonyms | notes |
| anything not listed | **the whole event is dropped** | a new event kind reaches the public only when it is listed |

Timestamps stay: minutes batted (SCRBRD-105, SCRBRD-106's lower-third) needs them,
and a timestamp on a ball says nothing about a child.

**Amendments and voids** stay in the log and the browser's fold drops them as it
does today; the projection does not pre-apply them, so the public fold and the
signed-in fold are the same fold. A revision banner on the public page is fine
(the fact that a scorecard was corrected is not about a child) but its note is not.

**Backfilled records** (SCRBRD-099) are excluded at the function: a match whose
provenance is "transcribed" is never served by `public_match_log()` or listed by the
competition and school reads, whatever its publication rows say. `fixture_publish()`
should also refuse such a match (a one-line addition in the same migration).

### 2.5 Publication, side by side

`fixture_publication` has a row per side (db/47 lines 625–640). The page rule:

- neither side published → 404, indistinguishable from no such fixture;
- one side published → the page exists; L1/L3 header shown; that side's eleven by
  the rule, the other eleven as positions; the score of both sides (a score is a
  team fact);
- both published → both elevens by the rule.

A competition page (A1) lists results of every fixture in it at team level once
`competition_published()` is true, and links a result to its fixture page only where
a side has published (§9 Q2 asks Kameel to confirm the team-level reading).

### 2.6 Caching and "at once"

`publicName()` is judged on the day served, and C3 says a "no" reaches every page
"at once". Three layers:

1. **In-process cache** in the API, per read and key, TTL **5 s while the fixture is
   live, 60 s otherwise**. It exists so that a WhatsApp link opened by three
   hundred parents at once costs one query per five seconds, not three hundred.
2. **Invalidation by notification.** The migration adds `AFTER INSERT OR UPDATE`
   triggers on `public_name_consent`, `player_never_public`, `public_names_off`,
   `fixture_publication`, `competition_publication`, `match_broadcast` and `honour`
   that `pg_notify('public_data_changed', …)` with the player/match/school id. The
   API `LISTEN`s and drops every cached entry the change can touch (a player change
   drops every match he appears in; a school change drops the school's matches). A
   withdrawal therefore reaches the next request, not the next TTL. If the LISTEN
   connection drops, the TTL is the ceiling: 60 s.
3. **Edge and browser:** `Cache-Control: no-store` on every response that carries a
   label (log, commentary, board, honours), `Cache-Control: public, max-age=30` on
   team-level responses (header, standings, fixtures, shots). Firebase Hosting
   rewrites `/api/**` to the API (DEPLOYING.md line 295) and honours these headers.

`§9 Q1` asks Kameel to accept "within 60 seconds in the worst case, next request in
the ordinary case" as the meaning of "at once".

### 2.7 Headers, `noindex`, and the HTML shells

The SPA is one `index.html` served for every route (`server.mjs` lines 720–746, or
Hosting). A `robots` meta on it would de-index the whole app, and a header only on
JSON would not stop a crawler that indexes the HTML. So the public pages get **their
own HTML shells**, served by the API:

- `GET /live/:match`, `/scorecard/:match`, `/table/:competition`,
  `/fixtures/:school` return a small HTML document with
  `<meta name="robots" content="noindex, nofollow">`, the `X-Robots-Tag: noindex,
  nofollow` header, an Open Graph title of the two team names and the score (so a
  WhatsApp preview is useful and names nobody — D3), and the SPA bundle in public
  mode. Hosting rewrites these four prefixes to the API as it does `/api/**`.
- Every `/api/public/*` response carries `X-Robots-Tag: noindex` too
  (`ROBOTS` in `public.mjs` line 128 is the value).
- `/robots.txt` disallows `/live/`, `/scorecard/`, `/table/`, `/fixtures/`,
  `/api/public/`.

### 2.8 Rate limits and abuse

Nothing in `server.mjs` limits request rates today (no 429 anywhere). Public reads
are the first surface an anonymous script can hammer, so:

- a per-IP token bucket on `/api/public/*` and the four shells: 120 requests per
  minute per IP, burst 30, answered `429` with `Retry-After`. The live page polls
  every `liveRefreshMs()` (≥ 5 s), well inside it; the cache means a 429 protects
  the process, not the database;
- a global ceiling per match (e.g. 2,000 requests per minute) behind which the
  live TTL doubles automatically — a viral derby degrades to slower updates, not
  to a down API;
- no enumeration: uuids only, 404 for unpublished and unknown alike, no listing
  endpoint that walks unlisted or unpublished fixtures (the school and competition
  lists require an id). *Amended by SCRBRD-142 (2026-10-02, §10 note 4): the home
  page's `GET /api/public/live` (db/82 `public_live_fixtures()`) is the one public
  read with no id, and it walks only today's fixtures a school has both published
  and listed (PUBLIC_DATA rule 7 as amended, D1a), at most 50;*
- no per-request access log rows (there is no principal to log), but one counter per
  match per day (`public_page_view`) so a school can see "this page was opened
  1,204 times" — a fact the information officer will be asked for, and cheap. §9 Q8.

### 2.9 Relation to the Match Centre

`MatchView.jsx` (`apps/web/src/views/matchcentre/`) is kept and gains a public
source. Today `useMatchLog()` (line 48) reads `GET /api/matches/:id/events` when
`signedIn()` and otherwise seeds a demonstration. In public mode it reads
`/api/public/matches/:id/log`, the header from `/api/public/matches/:id/header`,
and passes `nameOf = (ref) => squadLabel(ref)` to `deriveCommentary()` (the door
the header comment at lines 33–36 names). What changes per tab:

| Tab | Public mode |
|---|---|
| Summary | As now: board, moments, highlights. Labels from the squads. Milestones (A6) appear as the generator raises them. |
| Scorecard | As now, labels in place of names. A "Batter" row and a "D Erasmus" row look the same apart from the string. |
| Commentary | Deterministic lines from the fold with `sensitive: false`; AI lines interleaved from `/commentary` when present (§4). |
| Partnerships | As now, labels. |
| Analytics | Team-level only: the team wagon wheel from `/shots`; per-batter wheels, matchups and anything keyed to one player are **not drawn** (the log has no placement, so they cannot be). |
| Match details | Header fields only. No officials, no weather, no pitch report (§9 Q5). |

Big-screen mode (`spectator.jsx`) and the demonstration seed are untouched by
phase 1 (§5.3 and §9 Q9 for the big screen).

---

## 3 · Each surface, at field level

Names below mean "the label `publicName()` returned": initial and surname for a
consenting child on a published side, otherwise the position word. "Team" means a
team name or code, never a child.

### 3.1 The live match page (L1–L7, A6, D3) — `/live/:match`

Header: teams, age group by team code, competition and division, ground, start time,
status, toss. Board: score, wickets, overs, run rate, target/need, current
partnership (runs and balls), batters at the crease (label, runs, balls), bowler
(label, figures), this over's balls. Scorecard tab as §3.2. Commentary (L4) as §4.
Milestones (A6): the generator's milestone line on the page as it happens, label
by the rule. Shot map (L7): the team wheel. Not on the page: officials, weather,
the pitch report, any per-player analytics, any note, any reason, any photo, any
minute-by-minute "unavailable"/"retired hurt" wording (the fold says "retired, not
out").

### 3.2 The scorecard (A2) — `/scorecard/:match`

The same page after the match, finished. Per innings: each batter's label, how out
(canonical dismissal, the fielder's and bowler's labels), runs, balls, fours,
sixes, strike rate, minutes; extras by kind; total, overs, run rate; fall of
wickets (score, over, the label of the batter out); each bowler's label, overs,
maidens, runs, wickets, economy, wides, no-balls; the result line; a revision
banner if the log was amended (no note). The scorecard of a backfilled match is
never served (§2.4).

### 3.3 League and competition tables (A1, not A3) — `/table/:competition`

Competition name and season; per division, the standings with the `league` read's
fields (played, won, lost, drawn, no result, points, NRR, rank); results and
upcoming fixtures at team level with a link to the fixture page where one is
published. **No leaderboard, no top scorer, no best bowler, no player anywhere.**

### 3.4 Fixtures and results per school — `/fixtures/:school?team=`

The school's published fixtures: date, time, ground, home/away, opponent, scores,
result, status, link. Team level only. A school that has published nothing has a
page that says so and lists nothing.

### 3.5 The honours board (A5) — phase 2, on the school page

Honours with `is_public` true and not withdrawn: label, kind, season, date, citation
(§9 Q6: a citation is free text a coach wrote about a child; recommendation is to
show it only on honours the school marked public, which is what `is_public` means,
and to say so to schools). Never `withdrawn_reason`.

### 3.6 Not built, by decision

A4 (a player page), A3 (leaderboards), A7 (team sheets — signed-in only, §7), D4
(news), A8 (photos). The public router has no route for any of them, and the SPA's
public mode has no screen. The "yet to bat" list (SCRBRD-105 item 3) is a team
sheet before the fact and is **not** shown on a public page until the innings has
begun and the squad is in the log — then it is the squad's labels.

---

## 4 · Commentary to spectators, AI lines included

Decided today: spectators see the commentary including the AI lines, switchable off
per school. The deterministic lines are already public-safe by construction
(`commentary.mjs` header: names only through `nameOf`; health and discipline only
with `sensitive`). The AI lines need a store, a switch and a rule for names.

### 4.1 Where the AI line is made and kept

Today `POST /api/ai/commentary` (`server.mjs` line 430) is called from the scorer's
phone per ball, names tokenised by `maskNames()` (`ai-service.mjs` line 91) and
restored on the phone; nothing is stored. That moves to the server, once per ball:

- **Trigger:** after `events.append` has committed a `ball` (or a wicket, or a
  milestone the fold raises), the handler enqueues `{match, seq}`. Never inside the
  write transaction, never awaited by the scorer's response: the AI service's own
  rule is that commentary never blocks scoring (`ai-service.mjs` lines 16–21). A
  small in-process queue with a `commentary_ai_job` table behind it, so a restart
  loses nothing and a second API instance does not double-generate (a job row is
  claimed with `FOR UPDATE SKIP LOCKED`).
- **Situation:** the worker folds the match on the server (`foldSteps()` is pure),
  builds the same situation text `fetchAICommentary()` builds today, and tokenises
  every squad name, surname and known-as with `maskNames()`, so the provider sees
  `PLAYER_3`, never a child.
- **Store:** `commentary_ai_line (match_id, event_seq, text_tokenised, tokens
  jsonb, model, generated_at, discarded_reason)`. `tokens` maps each `PLAYER_n` to
  the player id, or to `{typed: "<as typed>"}` for a name with no row. **No name is
  ever stored in the text.** That is the whole reason a consent change needs no
  rewrite: there is nothing to rewrite.
- **Before storing, two checks, and a discard on either:** (a) the output contains
  none of the match's names, surnames or known-as in clear (the model may only
  echo tokens; a leak means the prompt leaked or the model guessed — discard,
  count it, alert); (b) the output contains no word from a short list of physical
  or health description ("tall", "injur", "limp", "hurt", "young", "small",
  "heavy" …). A child's height and weight are N4, health is N2, and a model that is
  asked to be colourful will reach for them. The prompt bans them too; the filter
  is the belt.
- **Voids and amendments:** a line whose `event_seq` is voided is not served (join
  to the live view of the log as `ball_event_live` does), and the worker generates a
  fresh line for the correcting event.
- **Cost:** once per ball per match, server-side; SCRBRD-098 item 4 is right that a
  smaller model is the likely trade. `AI_MODELS.commentary` moves to whatever
  Kameel picks; the worker records the model per line so a season's bill can be
  read off the table. An environment kill switch (`AI_COMMENTARY=off`) stops
  generation without a deploy.

### 4.2 Serving the line: tokens resolved by the reader's rule

`GET /api/public/matches/:match/commentary` returns each line with its tokens
resolved **on the server** — `PLAYER_3` → the same label the squad carries for that
player's pseudonym, computed by the same `publicName()` call the log used, or the
role word ("the batter") where the label is a position. A typed token resolves to a
role word. The browser never sees a token or a name it did not already have. When a
school's switch is off, the read returns an empty list and the page shows the
deterministic lines only.

The signed-in Match Centre reads the same rows through a governed read
(`READ_QUERIES.commentary_ai`, under `fixture.read`) with tokens resolved to the
names the reader may see. The pad's per-device call is retired: the scorer sees the
stored line arrive a second after the ball, and everyone reads the same words
(SCRBRD-098's own aim).

### 4.3 The per-school switch

A row per school, `public_commentary_ai (school_id, off boolean, set_by, set_at)`,
written through `public_commentary_ai_set()` under `broadcast.publish` — the same
door as names-off, for the same reason (db/47 header lines 74–83: publishing is the
act that puts children in front of an audience). **Default on**, because that is
what Kameel decided; a school that wants none switches it off.

A line names two schools' children (striker and bowler). Rule: AI lines are served
for a fixture only when **every on-platform school in it** has the switch on. A side
not on the platform has no say and its players are role words anyway.

### 4.4 What about the deterministic lines?

They are derived in the browser from the redacted log, so they carry the labels and
nothing else, and `sensitive` is never passed in public mode. Penalty lines say the
Law 41 reason in words ("five penalty runs to Hilton for time wasting") — §9 Q4 asks
whether a reason attributed to a side is acceptable on a public page. Recommendation
is yes: it is an umpire's ruling about the game, on every scorecard in cricket, and
it is never attributed to a named boy; a public page says "the fielding side".

---

## 5 · The stream overlay (SCRBRD-104) and the graphics pack (SCRBRD-106)

### 5.1 One shared path

Both read `GET /api/public/matches/:match/board` (and, for richer graphics, the
same `/log` and `/shots`). Nothing about a player reaches either that did not come
through `publicName()` on the server. The overlay is a browser source in OBS; it is
signed out by nature and it is public (D2), so it is on the public router like any
other page.

### 5.2 Bringing `broadcast_state()` under the rule

Today `broadcast_state()` (db/08 line 3477, replaced by db/48 line 277) returns
`striker`, `non_striker` and `bowler` as `broadcast_name(full_name, name_display)`
(db/08 line 3446): `'full'` gives the whole name, `'initials'` guesses, and neither
asks consent. Under the rule (§1.4, D2):

- a new migration replaces `broadcast_state()` once more: the three name columns
  become **player ids** for the API to label (or are dropped, and the API takes the
  crease from the log's last ball — Opus chooses; the ids never leave the API
  either way), and `name_display` is returned for the API to read as: `'none'` →
  `namesOff = true` for this fixture (C4 says so); `'initials'` and `'full'` → the
  rule applies. `'full'` is retired in meaning: no public surface ever shows more
  than initial and surname, and the column's CHECK keeps accepting the value so
  nothing shipped breaks (§9 Q10 asks whether to migrate existing `'full'` rows to
  `'initials'` for honesty);
- the overlay serves a side's names only when **both** `match_broadcast.published`
  and that side's `fixture_publication` row are true (db/47 lines 617–619 planned
  exactly this). A school may publish the page and refuse the stream;
- `show_officials`: officials are adults outside the rule, but a pupil may score.
  Recommendation (§9 Q5): the overlay names an official only when he is not also a
  `player` at any school on the platform; a pupil official is "Scorer";
- the sponsor's three columns pass as today (a sponsor is not a child).

`tools/smoke-broadcast.mjs` walks the overlay already; it gains the consent cases.

### 5.3 What each graphic may show on a public surface

| Graphic (SCRBRD-106) | On the overlay / a public page |
|---|---|
| Partnerships | Yes. Each pair by label, shares, runs, balls; "still to bat" only as squad labels once the innings has begun. |
| Batter lower-third | Yes. Label (surname bold when there is one), runs, balls, dots, 4s, 6s, SR, minutes. |
| Bowler card | Yes. Label and figures; runs per over; economy by phase; fall of wickets by label. |
| Innings story | Yes. Phases, scores, run rates; "top performers" by label. |
| Focus ring | Yes. It is a run distribution, not a shot map. |
| **Leaderboards** (season, school records) | **Never.** A3, and a record across matches is exactly the cross-match linkage pseudonyms exist to prevent. Signed-in only. |
| Match summary | Yes. Top three by label; the closing line. |
| Sponsor slot | Yes. |
| Photo slot | **There is none.** Not designed until SCRBRD-092 (A8). |
| Age or date of birth | **Never.** The age group on the team code stays. |

The components take `{label}` and never `{name}`; a signed-in caller passes the
name as the label. That one prop name keeps a graphic from ever asking for more.

**Big-screen mode** (`spectator.jsx`) is a signed-in Match Centre surface today, run
from a device at the ground. The rule defines public as signed out, and the
boundary scoreboard precedent (db/08 lines 3395–3400) treats the ground's crowd
differently from a stream's. §9 Q9 asks Kameel whether the big screen keeps
signed-in names or switches to the public projection; the recommendation is to keep
it signed-in and add a one-tap "public names" mode for schools that want it, because
a big screen fed to a stream is the overlay, not the big screen.

---

## 6 · Turning 18 while still at school

### 6.1 What the records say today

- **PUBLIC_DATA C6 and §5a:** his own consent counts from his birthday; until he
  gives it, his guardian's standing consent carries on. Once he has spoken, only his
  records count.
- **db/47:** `public_name_consent_set()` refuses a guardian's act for a boy who is
  eighteen — a yes **and** a no ("From his eighteenth birthday the answer is his
  own, whatever an old link still says", lines 368 and 391); `public_name_facts()`
  marks a guardian's record given on or after the birthday as not competent
  (lines 815–816). A standing pre-18 consent stays competent and keeps naming him.
- **db/08 and db/10:** every guardian link ends at the child's majority
  (`valid_until = majority_on(born)`, db/10 lines 3–35). So today the parent's
  **access** ends at 18 as well.
- **SCRBRD-110 Q7, decided today:** for health data the parent's consent stays valid
  while the pupil is still in the school system, and her access continues. That
  decision needs the guardian link to outlive the birthday while he is at school —
  a change to the db/08/db/10 rule that is SCRBRD-110's migration, not this one, and
  this design **depends on it** for options B and C below to mean anything.

The conflict is narrow. Both rules agree the pre-18 consent carries on. They
disagree on whether a parent may **act** on an 18-year-old's public name while he
is still at school, and on whether she still has access to do so.

### 6.2 Options

**A — Leave the public name as db/47 has it.** Two consents, two competence rules.
The parent keeps her health access (110) but cannot touch the public-name consent
after the birthday; the app tells him at 18 and asks for his own answer.
*For:* POPIA-clean; nothing to migrate. *Against:* the office records both consents
from the same admission form under two rules; a mother who can still read her son's
wellness data cannot take his name off a scorecard when she is worried, and has to
ask him to.

**B — Mirror the health decision.** A guardian's yes or no counts while he is in the
school system, at any age; his own record still governs once given.
*For:* one rule for the office to learn. *Against:* it lets a parent put an adult's
name on a public page. POPIA's basis for an adult's personal information is his own
consent (s 11(1)(a)) or another s 11 ground; a parent's consent is neither. The
information officer is likely to refuse this one, and would be right to.

**C — Asymmetric (recommended).** While he is at school, a guardian's act after the
birthday may only take his name **off** — a withdrawal of the standing consent, or a
refusal where nothing is open — never put it on. His pre-18 consent carries on (C6
unchanged); from 18, only his own record can newly name him; the app asks him at
18 (a prompt on his Me screen; the office may record his own signed answer from a
form). *For:* nobody adult is ever named on a parent's word; a parent with standing
concern can still act, and acting only ever fails closed; it matches the spirit of
today's health decision (the parent stays involved while he is at school) without
its letter (the parent does not consent for an adult). *Against:* a third state for
the office to understand — "after 18 she can say no but not yes" — which is one
sentence on the consent screen.

### 6.3 What changes in db/47 if Kameel takes C

db/47 is shipped (`db/SHIPPED.sha256` line 49) and frozen; the change is a new
migration that `CREATE OR REPLACE`s two functions.

1. **`public_name_consent_set()`** (line 332), guardian branches (self at 368,
   office at 391): where today `majority_on(v_born) <= v_today` returns a refusal, instead:
   if `p_consent = false` **and** he is still at the school (a side-history row at
   this school with `left_on IS NULL`, db/08 ~4258–4268, or `player.school_id` — Opus
   picks the test and states it), record the withdrawal or refusal as today with
   `given_by = 'guardian'`; if `p_consent = true`, refuse with a new reason,
   `adult_consents_for_himself`. The guardian's link must be live for her to be
   calling at all, which is SCRBRD-110's link change.
2. **`public_name_facts()`**, the guardian arm of `competent` (lines 815–816): today
   `c.given_on < majority_on(p.born)`. Becomes: that, **or** the record is a "no"
   (`c.ended_on = c.given_on AND c.end_reason = 'refused'`) given while he was at
   the school on `given_on`. Without this the post-18 refusal would be that
   guardian's most recent act, incompetent, and filtered out — which fails closed
   for her own records but would let the *other* guardian's standing yes keep
   naming him. With it, "the latest record governs" (public.mjs line 459) lets her
   no beat that yes, which is what C3 wants. A withdrawal needs no change: it ends a
   pre-18 record whose competence is unchanged.
3. **No change to `publicName()`**: a "no" from a competent guardian is already a
   "no", and his own records still displace hers once he speaks.
4. **Tests:** the db/99 section for db/47 gains: guardian yes at 18 refused; guardian
   no at 18 while enrolled recorded and effective against the other guardian's yes;
   guardian no at 18 after leaving refused; his own yes at 18 names him over her
   no given earlier, and her later no does **not** beat his yes (his records alone
   govern once he has spoken — §9 Q11 asks whether that is what Kameel wants, since
   under C a mother's "no" about her adult son at school is then overridable by him;
   the recommendation is yes: he is an adult).

### 6.4 For the information officer

**Signed off (2026-09-28).** Kameel, as information officer, confirmed in writing (a reply to the POPIA sign-off brief, https://claude.ai/code/artifact/4e924a72-6306-4666-8897-5065f9f3201a): PUBLIC_DATA.md and the position under C below. The link change it depends on (SCRBRD-110 §7.4) is confirmed with it.

The position under C, in POPIA's terms: while he is a child, the ground for
publishing his name is the prior consent of a competent person (s 35(1)(a)). From
his eighteenth birthday he is the data subject in his own right; the platform
continues under the consent lawfully obtained while he was a child, tells him so,
and gives him the means to withdraw or replace it at any time (s 11(2)(b), (3)); no
new consent is taken from anyone but him. A parent's act after the birthday is not
treated as consent: it is a request to stop publication, which the platform honours
from anyone with a live, verified link because stopping publication needs no lawful
basis — it is the default. Nothing about him is ever **added** to a public page on
a parent's word once he is an adult. The health decision stands on a different
footing (processing the record, not publishing it) and its officer note lives in
SCRBRD-110.

---

## 7 · Today's other decisions, checked against the rule

| Decision | Where | Conflict with PUBLIC_DATA? |
|---|---|---|
| A signed-in parent sees her child's side's team sheet before the match | STEP4 §9 (brief) | **None.** A7 keeps team sheets off public pages and says "the school's own channels"; a verified guardian signed in is not the public (STEP4 Q4's reasoning). It widens `player.profile.read` over the side to `guardian` — a db/NN and an `ADDED_SINCE_01` line, STEP4's own note. One thing to tell the information officer, not a conflict: the never-public mark (C5) is a public-page mark; a marked child still appears on the sheet to other parents of the side, as he does on the board at the ground. If a school ever needs "this boy is not to be listed to other families", that is a new mark, not this one. |
| Backfilled records are signed-in only | SCRBRD-099 | **None**, and this design enforces it at the function (§2.4): a transcribed match is never served publicly and cannot be published. |
| No photos on any public page, graphic or overlay until SCRBRD-092 | A8 | **None.** No public read selects an image column; the graphics pack has no photo slot; the pseudonymised log carries none. |
| Health consent stays valid while at school; parent's access continues | SCRBRD-110 Q7 (brief) | **Partial**, on the public name only — §6, with a recommendation. Also a dependency: the link-end rule (db/10) must change for a parent to have access to act at all. |

---

## 8 · Phased build plan

Each phase names what ships, the migrations it needs (Opus writes them; every one is
a new `db/NN`, nothing shipped moves), the tests and walks that prove it, and what
must be true before it goes live. The information officer's confirmation of
PUBLIC_DATA (§6.5 there) is a condition of **phase 1's** go-live, and each later
phase that adds a surface is shown to the officer as a page, not a document.

### Phase 0 — Prerequisites (no code)

- Kameel answers §9. Q1, Q2, Q3 and Q7 shape phase 1; the rest can wait for their
  phase.
- The information officer has PUBLIC_DATA and this document.
- `PUBLIC_PSEUDONYM_SECRET` is added to the environment table in DEPLOYING.md and
  set on every host; Hosting rewrites for `/live/**`, `/scorecard/**`, `/table/**`,
  `/fixtures/**` are written down beside the `/api/**` one.

### Phase 1 — The read path, the live page and the scorecard

**Ships:** `/api/public/*` router running as `ANON`; `public_match_header()`,
`public_match_log()`, `public_shot_sectors()`, `fixture_side_published` in use;
the projection and pseudonyms; cache, LISTEN/NOTIFY, headers, robots, rate limit;
the four HTML shells (two used); the Match Centre's public mode (Summary,
Scorecard, Commentary with deterministic lines, Partnerships, team-level
Analytics, Details); the publish switch for a side surfaced on the fixture screen
for `broadcast.publish` holders (the function exists; the button does not).

**Migration (one file):** the three `public_*` functions, SECURITY DEFINER, granted
to `scrbrd_app`, revoked from `anon`/`authenticated` as db/47 does; the
`public_data_changed` notify triggers; `fixture_publish()` refusing a transcribed
match (or a note that SCRBRD-099 adds it when provenance exists); the
`public_page_view` counter if Q8 is yes.

**Tests:**
- `packages/policy/test/public.test.mjs`: the new functions' selected columns pass
  `assertPublicSelect()`; the projection's allowlist per event kind is pinned, and
  a generated log with reasons, notes, placement and typed names comes out with
  none of them; no `player.id` and none of the three name columns' values for any
  squad member appear anywhere in a serialised response.
- `services/api` unit: `/api/public/*` with a valid staff token is byte-identical
  to the same request without one; unpublished and unknown ids return the same 404
  body; every response carries `X-Robots-Tag`; `Cache-Control` per §2.6; 429 after
  the bucket empties.
- `db/99` new section: a fixture with one consenting boy, one marked, one typed, one
  boy in a names-off age group, one boy playing up, one away side off-platform, one
  away side on-platform and unpublished — the expected labels; then a withdrawal, a
  mark and a publication flip, and the facts change on the next call.
- Walk: `tools/smoke-browser-public.mjs`, signed out, opens the live page and
  the scorecard of the seeded fixture and asserts the DOM contains no full name, no
  first name from the seed, no date, no "injur", "unavail", "hurt", "suspend";
  that the meta robots tag is present; that the consenting boy reads "D Erasmus" and
  the others their positions; then withdraws consent (as the office) and reloads
  within 60 s to see the position. `tools/smoke-browser-matchcentre.mjs` keeps
  proving the signed-in view is unchanged.

**Before live:** the information officer's confirmation in writing, filed in
`docs/policy/`; one pilot school's `broadcast.publish` holder has published one
side of one fixture and withdrawn it; the never-public mark exercised on the pilot
with the reason held away from every page (`player.public.withhold` only); the rate
limit measured against a real live match's poll; SCRBRD-098's open "signed-out
walk" closed by the walk above.

**As built (2026-09-28). Not live.** Off unless the API runs with `PUBLIC_PAGES=on`
(and then it needs `PUBLIC_PSEUDONYM_SECRET`, 32+ bytes, not the session secret;
`PUBLIC_TRUST_PROXY_HOPS` for the rate limit behind a proxy) — DEPLOYING.md,
"Turning the public pages on". Every "before live" condition above is still open
except the signed-out walk, which exists.

- **Migration `db/59_public_read_path.sql`.** `public_match_header(match)`,
  `public_match_log(match, since)`, `public_match_people(match)` (one row per player
  the log names: the three facts for *his* side, whether his side is published, and
  the three name columns for the formatter — a function of its own rather than part
  of the log's), `public_shot_sectors(match)`; each SECURITY DEFINER with a pinned
  search path, granted to `scrbrd_app` only (PUBLIC, `anon`, `authenticated`
  revoked: the API is the only caller, and these return the rule's *inputs* — ids,
  full names — which only the API turns into its answer), each empty for a fixture
  with no published side. `public_fixture_served()` (owner only) is the one test.
  `public_data_notify()` triggers on `public_name_consent`, `player_never_public`,
  `public_names_off`, `fixture_publication`, `competition_publication`,
  `match_broadcast`, `honour` — and three the list did not name: `assignment_subject`
  (a revoked guardian link unmakes a consent's competence), `player` (the name
  columns, `born`, the side) and `match` (a side's school changing unpublishes it).
  The payload is `{k, id}` — never the table, so a listener cannot tell a
  never-public mark from a consent. No page-view counter (Q8).
- **The read path, `services/api/public/`.** `public-api.mjs` answers
  `GET /api/public/matches/:id` (the header), `…/log?since=`, `…/shots`, and the
  shells `/live/:id`, `/scorecard/:id` (`/table/` and `/fixtures/` answer the one 404
  until phase 2), before anything reads a credential, as `ANON`. `redact.mjs` is the
  projection: `PUBLIC_EVENT_FIELDS` per kind, each kept field checked (a dismissal
  canonical, a reason a code), per-match `hmac(secret, match ‖ ref)` pseudonyms of
  12 hex characters for every player reference, and of the event ids too, squads
  as `{id, label, batHand}`, and `people` naming exactly the boys `publicName()`
  names. Cache 5 s live / 60 s otherwise, doubled past 2,000 requests a minute on one
  fixture (§2.8's ceiling), dropped by `LISTEN public_data_changed`; `no-store` on the
  log, every 404, 429 and shell; `public, max-age=30` on the header and sectors;
  `X-Robots-Tag: noindex` on everything (`noindex, nofollow` on the shells, with the
  meta); a token bucket of 120 a minute, bursts of 30, per client address.
- **The page, `apps/web/src/public/`.** A second Vite entry built to a fixed
  `/public-app.js` (the API's shells load it; the API image carries no `dist/`). It
  folds the redacted log with `@scrbrd/scoring` and draws the Match Centre's own
  Summary, Scorecard, Commentary and Partnerships tabs (moved to `tabs-core.jsx`;
  `scorecard.jsx` now takes its signed-in parts as props), a team-level Analytics
  (the side's twelve sectors) and a header-only Match details. `check-bundle`
  reads each entry's static graph and holds the public one free of eight
  signed-in markers. The publish switch per side is on the fixture screen
  (`views/publication.jsx`, `GET/POST /api/matches/:id/publication`).
- **Proofs.** `packages/policy/test/public.test.mjs` reads every `public_*()` body in
  db/59 on and holds its columns to `NEVER_PUBLIC` (views mapped to their tables;
  `*`, `alias.*` and a whole payload refused; the checker falsified in-suite);
  `services/api/public/public.test.mjs` pins the allowlist, projects a log full of
  reasons, placement, typed names and ids, and drives the router over a fake pool
  (one 404, a staff token byte-identical, always `ANON`, headers, 429, the cache);
  `apps/web/test/public-page.test.mjs`; db/99 §37; `tools/smoke-public.mjs` (every
  public answer of the seed's fixtures and two of its own, in every state of the
  rule, for ids, dates, photos, reasons and unconsented names; a withdrawal on the
  next request of a finished page); `tools/smoke-browser-public.mjs`.

**Where the code differs from this design, and why:**

1. **The header's route** is `GET /api/public/matches/:id` (§2.3's table), not
   `…/header` (§2.9). It carries **no competition or division**: nothing links a
   fixture to a competition in the schema. It carries **no result text**: no result
   is stored; the page's fold decides it, as the signed-in Match Centre's does. It
   carries the score by innings (`match_live_score`), which the shell's Open Graph
   title uses.
2. **The allowlist's kinds.** `milestone`, `over_end` and `short_running` are not
   event kinds (milestones and over ends are the commentary's, short running is a
   ball and a penalty), so there is nothing to list. `bowler_suspended` is a kind
   the table did not name, so it is dropped whole — a Law 41 suspension of one boy is
   N3. No ball carries a `speed`.
3. **A retirement's reason cannot simply be dropped:** the fold writes
   `retired ${reason ?? "hurt"}` as the batter's dismissal, so a missing reason
   *reads* "hurt". The projection sends "not out" for every retirement that is not a
   dismissal (retired out and timed out keep theirs).
4. **The fielder is the one reference the fold does not look up** — it writes it into
   the scorecard line as it stands ("c C Botha b …", from logs where the scorer typed
   him). The page gives the fold the fielder's label ("Fielder", or his name) and the
   commentary his pseudonym to look up. The browser walk found this: "c d20bf7b8e52a
   b Bowler" on the first render.
5. **Event ids are pseudonymised too.** An event's id is its idempotency key, which
   names the scoring device; a void's target is mapped the same way.
6. **A squad may hold bare strings** (typed names), and `twelfthMan` is a name, not an
   id: both handled (the twelfth man is dropped: a team sheet, A7).
7. **`MatchView.jsx` does not gain a public source** (§2.9): the public page is its own
   component sharing the tabs, because `MatchView` imports the role model, the API
   client and the shell, none of which may reach a stranger's bundle.
8. **The app's service worker** would have cached a public shell as the app's offline
   shell and served a stale `/public-app.js`; it now leaves the public paths to the
   network.
9. **`fixture_publish()` refusing a transcribed match** waits: no provenance column
   exists yet. SCRBRD-099's migration adds the refusal and the exclusion when it adds
   the column.
10. **db/99 §37 asserts facts, not labels**: labels are `publicName()`'s, in the API;
    the walks assert the labels.

### Phase 2 — Competition pages, fixtures and results, honours

**Ships:** `/table/:competition`, `/fixtures/:school`, honours on the school page;
`competition_publish()` surfaced for `competition.manage` holders.
**Migration:** `public_competition()`, `public_school_fixtures()`,
`public_honours()`; notify trigger on `honour` if not in phase 1.
**Tests:** the allowlist test covers the new functions (no player id or name on
any competition or fixtures response at all; honours labels by the rule; no
`withdrawn_reason`); a db/99 case for a competition with one published fixture and
one not; the walk opens the table and follows the one link.
**Before live:** Q2 and Q6 answered; the officer has seen the honours page.

### Phase 3 — AI commentary lines

**Ships:** server-side generation once per ball; the store; the per-school switch
under `broadcast.publish`; the public and signed-in commentary reads; the pad's
per-device AI call retired.
**Migration:** `commentary_ai_job`, `commentary_ai_line`, `public_commentary_ai`
and `_set()`, `public_commentary_ai(match, since)`; RLS on the line table for the
signed-in read under `fixture.read`.
**Tests:** a fake provider (the service already supports one) returns a line with
a token, a line with a name in clear, and a line with "tall"; the first is stored
and the other two discarded with reasons; tokens resolve to labels on the public
read and to names on the signed-in read; a school with the switch off yields an
empty public list while the other school's fixtures still carry lines; a voided
ball's line is not served. Walk: the public Commentary tab shows an AI line with a
label, then none after the school switches off.
**Before live:** the model and the per-match cost chosen and measured on one real
match (the service's own cost note); the officer has seen a page of AI lines; the
kill switch tested.

### Phase 4 — The overlay and the graphics pack under the rule

**Ships:** `/api/public/matches/:match/board`; the overlay reading it;
`broadcast_state()` without names; the graphics components taking `label`; the
public-surface set of §5.3.
**Migration:** replace `broadcast_state()` (ids or nothing for the crease,
`name_display` passed through); nothing else.
**Tests:** `tools/smoke-broadcast.mjs` gains: overlay names appear only with both
`match_broadcast.published` and the side's publication row; `'none'` gives
positions; `'full'` gives initial and surname; a pupil official reads "Scorer";
leaderboards are absent from every public graphic variant.
**Before live:** Q9 and Q10 answered; SCRBRD-104's block lifted in the backlog.

### Phase 5 — Turning 18 (if Kameel takes §6 option C)

**Ships:** the two function changes; the Me-screen prompt at 18 (STEP4's screen,
one card); the consent screen's one sentence for guardians.
**Migration:** `CREATE OR REPLACE` of `public_name_consent_set()` and
`public_name_facts()` as §6.3; depends on SCRBRD-110's link-end change landing
first.
**Tests:** §6.3 item 4, in db/99 and in `public.test.mjs` for the facts shape.
**Before live:** the officer's note on §6.4; PUBLIC_DATA C6 amended by Kameel to
say what was decided (the rule document is the record, this design is not).

---

## 9 · Open questions for Kameel

### Decided (Kameel, 2026-09-27)

- **Q8 — no page-view counter.** Public pages count nothing per match or per visitor; a builder adds none.
- **Q1–Q7, Q9, Q10, Q12, Q13 — as recommended** in the table below (Kameel: "all recommendations for the rest").
- **Q11 — option C at 18 (§6).** A parent's standing consent from before 18 carries on; while he is at school she may take his name off but never newly put it on; the app asks him for his own answer at 18. §6.3's changes to `public_name_consent_set()` and `public_name_facts()` are the ones to build, and PUBLIC_DATA C6 is amended to say it.

| # | Question | Recommendation |
|---|---|---|
| **Q1** | **"At once."** C3 says a withdrawal reaches every page at once. The design gives: the next request in the ordinary case (notify-driven cache flush), 60 s in the worst case (a dropped LISTEN connection), and `no-store` at the edge so no copy lives longer. Acceptable? | **Yes.** Anything tighter means no cache, and one viral link would then take the API down for the scorer too. |
| **Q2** | **Results on a competition page.** A1 says results and standings are public once the competition is published; §1.1 says a fixture is private until its school publishes it. May a published competition list the **team-level result** (teams, scores, result) of a fixture whose schools have not published it, without a link to its page? | **Yes.** A result at team level names no child and is what a league table is. The fixture's own page stays 404 until a side publishes. |
| **Q3** | **The `opponent` text.** A fixture against a school not on the platform carries a typed opponent name. L6 forbids a typed *player* name; the opponent is a school. Show it? | **Yes**, as the team name. Add a test that the field is never a person: a scorer who typed "Mr Naidoo's XI" is the school's problem, not a leak of a child. |
| **Q4** | **Law 41 penalty reasons in public commentary.** "Five penalty runs to Hilton for time wasting" attributes a ruling to a side. N3 is about a child's conduct matter. | **Show the reason code's words, attributed to the side, never to a boy.** It is on every scorecard in the game. Any penalty whose reason text could name a player's act ("deliberate short run by …") is said without the actor. |
| **Q5** | **Officials on public pages.** Adults are outside the rule, but a pupil may score (§5a's open item). Phase 1 shows no officials on the page; the overlay's `show_officials` stays. | **Page: none in phase 1.** **Overlay: name an official only when he is not also a `player` at any school; a pupil official is "Scorer" / "Umpire".** Officials on the page can come with the pupil-official consent later. |
| **Q6** | **Honour citations.** A citation is a coach's free text about a child (near N5). `is_public` is per honour. Show the citation on public honours? | **Yes, only where `is_public` is true**, and tell schools that marking an honour public publishes its citation. A school that wants the honour without the words leaves the citation empty. |
| **Q7** | **Batting hand on the public log.** The fold and phases use it; it is on no list in §3 but it is a fact about a boy's body in the loosest sense. | **Keep it.** It is on every broadcast in the world and drives the wagon wheel's orientation at team level. Say so in `NEVER_PUBLIC`'s comment so nobody adds it later by mistake. |
| **Q8** | **A page-view counter per match per day**, so a school sees how many times its public page was opened. No IP, no identity stored. | **Yes.** Cheap, and the first question a headmaster asks. |
| **Q9** | **Big-screen mode at the ground.** Signed-in today; the crowd is the boundary crowd. Keep signed-in names, or switch it to the public projection? | **Keep signed-in, add a one-tap "public names" mode.** A screen fed into a stream is the overlay and goes through the public path regardless. |
| **Q10** | **`match_broadcast.name_display = 'full'`.** Retired in meaning by §1.4 (never more than initial and surname). Migrate existing `'full'` rows to `'initials'`, or leave them and let the API read both as "the rule applies"? | **Migrate them**, in phase 4's file, with a note. A setting that says "full" and does "initials" is a setting whose name lies. |
| **Q11** | **At 18 under option C, his own "yes" beats his mother's later "no".** That is C6 as written (his records alone govern once he has spoken). Confirm. | **Yes.** He is an adult. Her remaining power is to raise it with him and the school, which is where it belongs. |
| **Q12** | **Which option in §6** — A (leave db/47), B (mirror the health decision), C (asymmetric)? | **C.** It keeps every adult's public name on his own word, keeps a parent's protective "no" while he is at school, and gives the information officer a clean answer. Whichever is chosen, PUBLIC_DATA C6 is amended to say it. |
| **Q13** | **AI lines' default.** Decided on, switchable off per school. Confirm the default is **on** for every school (rather than off until the school switches it on, which is §1.1's habit for everything else public). | **On**, as decided, because the lines contain nothing the deterministic lines do not except colour, and every name in them passes the same rule. If the officer prefers off-by-default, it is one default value. |

---

## Appendix A · Existing things this design relies on

| Thing | Where |
|---|---|
| The rule: §1 rule, §2 surfaces, §3 never public, §4 consent, §5a code reading, §6 build list | `docs/policy/PUBLIC_DATA.md` lines 17–33, 37–57, 59–73, 75–90, 105–131, 133–159 |
| `SURFACES`, `surface()`, `ROBOTS` | `packages/policy/src/public.mjs` lines 69–106, 117, 128 |
| `NEVER_PUBLIC`, `PUBLIC_DESPITE_MASK`, `assertPublicSelect()` (refuses `*`) | `public.mjs` lines 166–230, 244, 275–288 |
| `POSITION_LABELS`, `NameFacts` typedef, `publicName()`, `consentStands()` (latest governs, C6), `initialAndSurname()` | `public.mjs` lines 298, 337–364, 412–426, 450–461, 556 |
| The never-public and column test | `packages/policy/test/public.test.mjs` |
| db/47 header: capabilities, "competent", latest governs | `db/47_public_data.sql` lines 1–129 |
| `public_name_consent` table; `public_name_consent_set()` and its 18 refusals | `db/47` lines 197–240; 332–438 (18 branches at 368 and 391) |
| `player_never_public`, `public_names_off` | `db/47` lines 440, 531 |
| `fixture_publication` (per side), `fixture_publish()`, `fixture_side_published()` | `db/47` lines 625–640, 656, 695 |
| `competition_publication`, `competition_publish()`, `competition_published()` | `db/47` lines 706, 722, 747 |
| `public_name_facts(player, side, on)` — SECURITY DEFINER, three facts, no DOB | `db/47` lines 755–837 (function at 794; guardian competence at 815–816) |
| Grants to `scrbrd_app` only; `anon`/`authenticated` revoked | `db/47` lines 843–870 |
| db/47 is shipped and frozen | `db/SHIPPED.sha256` line 49 |
| `match_broadcast` (`published`, `name_display`, `show_officials`), `broadcast_name()` | `db/08_schema_programme.sql` lines 3395–3420, 3446 |
| `broadcast_state()` (current definition) | `db/48_penalty_runs.sql` line 277 (original db/08 line 3477) |
| `majority_on()`, `sa_today()` | `db/08` lines 885, 5027 |
| The side-history row with `joined_on` / `left_on` ("still at the school") | `db/08` ~4258–4268 |
| Guardian links end at majority | `db/10_*.sql` lines 3–35 |
| `honour` fields as read today (`is_public`, `withdrawn_at`, citation) | `services/api/read/read-api.mjs` lines 1358–1372 |
| `matches`, `league`, `broadcast_state` reads (field lists reused at team level) | `read-api.mjs` lines 56–126, 550–565, 895–898 |
| `readResource()` — the governed read the public router must **not** use | `read-api.mjs` lines 2583–2665; dispatched at `services/api/server.mjs` lines 850–858 |
| `ANON`, `sessionConfigStatements()`, `withPrincipal()`, `AuthError` (401) | `services/api/auth/auth.mjs` lines 145, 163, 190, 122 |
| `runAsPrincipal()` — `missing_token` without a bearer | `services/api/auth/auth-db.mjs` line 183 (194) |
| `GET /api/matches/:id/events` (signed-in log read) | `server.mjs` line 451 → `services/api/write/events-api.mjs` line 572 |
| `POST /api/ai/commentary`, `describeDelivery()`, `maskNames()`, `AI_MODELS`, `aiConfigured()` | `server.mjs` line 430; `services/api/ai/ai-service.mjs` lines 256, 91, 49, 280 |
| Static client and `index.html` fallback; `SERVE_CLIENT`; Hosting rewrite of `/api/**` | `server.mjs` lines 720–746; `DEPLOYING.md` lines 34, 295 |
| `deriveCommentary(events, {nameOf, teamName, sensitive})`, `ROLE_WORDS`, `COMMENTARY_KIND` | `packages/scoring/src/commentary.mjs` lines 268, 89, 64 (header 1–50) |
| `SquadMember` (`id`, `name`, `batHand`, …), `INNINGS_START` carries squads | `packages/scoring/src/events.mjs` lines 473, 55 |
| Match Centre: header comment naming the public door; `useMatchLog()`; tabs | `apps/web/src/views/matchcentre/MatchView.jsx` lines 21–40, 48, 43; `spectator.jsx` (big screen) |
| `signedIn()` | `apps/web/src/lib/api.js` line 55 |
| `spectator` role's thin bundle | `packages/policy/src/roles.mjs` line 367 |
| Backlog entries: SCRBRD-098, 104, 106, 099, 092 | `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md` lines 3982, 3651, 3672, 3939, 3398 |
| STEP4 §9 Q4 (names on a parent's scorecard), Q8 (spectator after 18), Q9 (`'pupil'`/`'self'`), Q10 (team sheet); the team-sheet read | `docs/design/STEP4_parent_pupil.md` lines 621–637, 152 |
| SCRBRD-110 on C6 and Q7 (earlier recommendation "Lapse") | `docs/design/SCRBRD-110_workload.md` lines 500, 571 |
| Access is capability + scoped assignment, default deny; `app_can()` SECURITY DEFINER | `docs/adr/0001-scoped-assignments.md`; no new role (`docs/adr/0003-job-titles-are-not-roles.md`) |
| Existing walks to extend | `tools/smoke-browser-matchcentre.mjs`, `tools/smoke-broadcast.mjs` |
