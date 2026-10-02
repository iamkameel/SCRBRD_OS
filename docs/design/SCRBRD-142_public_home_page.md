# SCRBRD-142 — The public home page: the pitch, live matches, news and public data

**Status:** **decided (Kameel, 2026-10-02, on the Build Board): D1–D14 all as recommended; rule 8 amended in PUBLIC_DATA as §1.5 words.** Nothing built yet.
**Lead's review (Opus, 2026-10-02), before Kameel reads it.** Sound. Listing is a second, school-level switch on top of the per-fixture publication (D1), off by default, so nothing becomes findable until a school chooses it. The home-page card names no child and no ground. Public news names no pupil in v1 (D6) and needs a second person (D7). Two findings go on the build list:
1. **Only a post's author can withdraw it today** (`news_post_update` in db/12 is author-only). For public news the office must be able to take a post down, so phase 3's withdraw function is the office's too.
2. **`notification.is_public`** (db/08) is a public flag that nothing reads. It will be marked dormant so nobody mistakes it for this design's switch.
The landing pitch Sonnet refreshed today (`claude/wip-landing-pitch`) already does D10's tile changes.
**Amends:** `docs/design/SCRBRD-083_public_pages.md` (the public pages; phase 1 built and off, phases 2–5 not built) and `docs/policy/PUBLIC_DATA.md` rule 8 ("findable by link, not by search"), in the exact words of §1.5 below, which Kameel signs or edits.
**Reader:** Kameel first, on a phone; then the Opus lead, who reviews it and builds §7's Opus parts; then Sonnet for the screens.
**Sources read:** `CLAUDE.md`; `PUBLIC_DATA.md` (all); SCRBRD-083 (all); SCRBRD-133 §1–3, §9 D2; SCRBRD-140 §0, §5.1; `services/api/public/public-api.mjs`, `redact.mjs`; `services/api/write/publication-api.mjs`, `news-api.mjs`; `apps/web/src/auth/LandingPage.jsx`, `public/main.jsx`, `public/PublicMatch.jsx`, `views/NewsView.jsx`, `views/publication.jsx`; `db/08` (the `notification` table), `db/12_news.sql`, `db/47` and `db/59` (the parts named), `db/98` (the seed's names); `tools/check-bundle.mjs`; `apps/web/vite.config.js`, `public/robots.txt`, `public/sw.js`; `firebase.json`; `DEPLOYING.md` ("Turning the public pages on"). Everything else is marked **A** and listed in §9. Figures and names in sketches are the seed's illustrative ones (Hilton College, Westville Boys' High, "D Erasmus"); no sketch is a claim about a real match or a real child.

---

## 0 · One page

**What Kameel asked for.** A front door at `/` that anyone can open, signed out: a page that sells SCRBRD, shows the matches being played right now, carries some news, and gives people public information. Today `/` is the signed-in app's landing screen (`LandingPage.jsx`), the public match pages exist only as links nobody can find, and news is signed-in only (PUBLIC_DATA D4).

**The one hard problem is discovery.** PUBLIC_DATA rule 8 says every public page is *findable by link, not by search*. A home page that lists live matches makes a match findable by anyone who opens the site, with no link. That is a change to what a school agreed to when it published a fixture, so it cannot be inferred from the publish switch that exists. The answer is **a second, per-school switch**: *"List our matches and news on the SCRBRD home page"*, off by default, under `broadcast.publish` (the same door as publishing, for the same reason). A fixture is on the home page only when **a school that lists has published its side of it**. Everything else stays as it is: link-only, `noindex`, 404 when unpublished.

**What the home page shows, and never shows.**

- **Live now / Today**: one card per listed fixture today — the two schools' names and team codes ("Hilton College 1XI v Westville Boys' High 1XI"), the score by innings, overs, status, start time. No child's name, no photo, **no ground** (a card that says where children are right now is a different thing from a match page a parent was sent). It links to `/live/:id`, which is unchanged.
- **News**: posts a school has asked to make public and a second person has approved. In v1 a public post **names no pupil at all** — team-level words only — because a free-text post naming a boy cannot honour a withdrawn consent reaching the past (C3) without the token machinery SCRBRD-083 §4 designed for AI lines. Names in news come later, with tokens.
- **The pitch**: only what is built. Four of the eight tiles on today's landing page claim something not built or not verifiable from the code (§5.1); they are cut or reworded.
- **For families**: the plain-words promise about children's data, from PUBLIC_DATA.
- **For schools**: "Bring SCRBRD to your school" is a `mailto:` link in v1. No form, nothing collected.
- **Footer**: the analytics consent toggle stays, exactly as honest as today.

**Where it lives.** The home page is a **static page on the public bundle** (a third Vite entry, `home.html`), not the signed-in app: a stranger's phone downloads no scorer, no API client, no Firebase. The app moves to `/app`. The strip and the news are two new public reads, `GET /api/public/live` and `GET /api/public/news`, each a `SECURITY DEFINER` function in db/59's shape, cached and rate-limited as today's are. The home page itself **may be indexed by search engines** (it names no child); every match page stays `noindex`, and the home page's links to them say `nofollow`.

**Phasing.** Phase 1 ships the page with no migration and no public data (the pitch, the CTA, the privacy words, the schools route, `/app`); it can go live before the public pages do. Phase 2 adds the per-school switch and the live strip (one migration). Phase 3 adds public news (one migration). Phase 4 is SCRBRD-083 phase 2 (tables, fixtures, honours) surfaced on the page.

**For Kameel:** fourteen decisions in §8, each with a recommendation; and rule 8's new wording in §1.5 to sign.

---

## 1 · Rule 8 and discovery

### 1.1 Plain words

Rule 8 was written for pages a school hands out one link at a time. A home page that lists matches is a new way to find them, and the schools that have already published fixtures (none yet — nothing is live — but the switch exists) did not agree to it. So listing needs its own yes, from the same person who publishes, and it is off until given.

### 1.2 Who decides a fixture appears in the list

Three ways to do it, weighed:

| option | how a fixture gets listed | why not / why |
|---|---|---|
| (a) Publication alone | every published fixture is listed | Changes the meaning of a switch already built and documented ("the page is then `/live/<id>`", DEPLOYING.md). A school that published for its WhatsApp group would find itself on the front page. No. |
| **(b) A per-school switch, plus publication** | the school says once "list our matches on the SCRBRD home page"; then each fixture it publishes is listed | **Recommended.** One decision by the right person, made once; the per-fixture act stays what it is. A school can be on the pages and off the front page. |
| (c) A per-fixture "list this one" flag | a third button beside publish, per side | More precise, more clicks, and the first time it is wanted is unknown. A later override ("published, but not listed") if a school asks; not now. |

**(b), concretely.** A table `public_listing (school_id, listed, set_by, set_at)` with a function `public_listing_set(school, listed)` under `broadcast.publish` at that school (the roles that hold it today: two, `packages/policy/src/roles.mjs` lines 183 and 223 — **A1**: the director of sport and the school office). Read by nobody but the public read below. Off by default, like everything public (PUBLIC_DATA §1.1).

**The rule the public read applies:** a fixture is on the home page today when, for at least one side, `fixture_side_published(match, side)` is true **and** that side's school has `public_listing.listed`. Nothing about the other side changes.

### 1.3 The away side

**No consent from the away school is needed for the card.** The card is team-level: two school names, team codes, a score, a status. A school's name is not a child's (SCRBRD-083 Q3, decided), and the match page's header already shows both names once either side publishes (083 §2.5). The card adds no fact to what the link already shows, and takes one away (the ground, §2.3).

What the away school keeps: its children's names on the match page follow its own publication and its own consents, as now (L5). An away side off the platform is a typed opponent name, as now.

### 1.4 One side lists and the other does not

| home lists? | away lists? | published | on the home page? | the match page |
|---|---|---|---|---|
| yes | — | home side | **yes** | as today |
| yes | no | both sides | **yes** | as today: both XIs by their own rules |
| no | yes | away side only | **yes** (the away school listed its own fixture) | as today |
| no | no | either or both | **no** — link only | as today |
| yes | — | neither | no — and the page is 404 | — |

Symmetric by design: a fixture belongs to both schools, and each speaks for its own listing as it speaks for its own children. This differs from SCRBRD-133 D2 (the ground display is the *home* side's), on purpose: a pavilion screen is at the home ground; a card on the front page is at nobody's ground.

### 1.5 Search engines, and rule 8 amended

Today: `X-Robots-Tag: noindex` on every public response, `noindex, nofollow` meta on every shell, `/robots.txt` disallowing `/live/`, `/scorecard/`, `/table/`, `/fixtures/`, `/api/public/`. All of that stays.

The home page is different in kind: it is about the product, and the only child-adjacent thing on it is a team-level card. **Recommendation: the home page is indexed; the match pages are not.** A school that is "findable by search" through the home page is findable as a school name on a product's front page, which is the kind of public its own website already makes it. Three mechanics keep rule 8's intent:

1. `/` carries no `robots` meta and is not in `robots.txt`'s disallow list. `/api/public/live` and `/api/public/news` carry `X-Robots-Tag: noindex` like every public read (a crawler that fetches the JSON indexes nothing).
2. Every link from a card to `/live/:id` carries `rel="nofollow"`, and `/live/` stays disallowed and `noindex`. The home page is a door; the rooms stay unlisted.
3. The strip is rendered from a read made after the page loads. A crawler that does not run scripts indexes the pitch and the news; one that does indexes team names and scores for a day. Neither is a fact about a child.

**Rule 8, as amended (for Kameel to sign). It is item 7 in PUBLIC_DATA §1's list and principle 8 in SCRBRD-083 §1; the brief's "rule 8" is that rule. The new words replace PUBLIC_DATA §1 item 7 and sit beside the row for D1 in §2:**

> 7. **Findable by link, not by search — except the front door.** Every public page about a match, a competition or a school tells search engines not to index it (D1). The home page at `/` may be indexed: it names no child and shows only team-level facts — school names, team codes, scores, status — of fixtures whose school has chosen to list them. A school's fixtures and news appear on the home page only when that school has switched listing on (one setting per school, under `broadcast.publish`, off until switched on) **and** has published that fixture or approved that post. A fixture a school has published but not listed stays findable by its link alone. The home page links to match pages with `nofollow`, and those pages stay unindexed (D1a, 2026-10-02).

And a new row in §2's table:

> | D1a | The home page lists live matches and news | Team-level only; per-school listing switch plus the existing per-fixture publication; indexed itself, its match pages not |

---

## 2 · The "Live now" strip and today's fixtures

### 2.1 Plain words

A Saturday morning. A parent opens scrbrd.co.za on her phone at the ground, or at home. The first thing on the page is what is being played right now by the schools that list: Hilton 1XI 142/3 (18.2) v Westville 1XI. She taps it and gets the live page she would have got from the WhatsApp link. Under the live cards, today's other fixtures: the ones to come, with their start time, and the ones finished, with their result. Nothing about any boy; not even where.

### 2.2 The read: `GET /api/public/live`

A new public read with **no id** — the one listing the public router has (SCRBRD-083 §2.8 said "no listing endpoint that walks all matches"; this walks only fixtures that are already public *and* listed, today, bounded). One `SECURITY DEFINER` function, `public_live_fixtures()`, in db/59's shape (granted to `scrbrd_app` only; `anon`/`authenticated` revoked), returning for each fixture where `starts_at::date = sa_today()` **(A2)** and the listing rule of §1.2 holds, ordered live first, then by start:

```
{ asOf: "2026-10-03",            // sa_today(), the day the list is of
  fixtures: [
    { id,                          // the fixture's uuid (already travels in public links)
      home: { label, code },       // "Hilton College", "1XI" — fixture_side_label(), as the header
      away: { label, code, onPlatform },
      status,                      // scheduled | live | complete | abandoned (db/00 line 307)
      format, overs,
      startsAt,                    // ISO; the card shows the time of day only
      scores: [{ innings, runs, wickets, balls }],   // match_live_score, as the header
      result }                     // publicResult()'s text, or null — sides named, never a reason
  ] }
```

Every field is already on the public header (`public_match_header()`, db/59 lines 116–140) except nothing: this is a projection of the header over a list. The function selects no `player` column and is held to `NEVER_PUBLIC` by the existing test over `public_*()` bodies (`packages/policy/test/public.test.mjs`). At most 50 rows (**A3**: the pilot's busiest Saturday is under twenty).

**Caching.** One cache entry under a fixed key (`"live"`), `PublicCache.get()` as built, TTL 5 s while any row is live, 60 s otherwise. Dropped by `LISTEN public_data_changed` on: `fixture_publication` (trigger exists), `match` (exists: status and `starts_at` changes), and the new `public_listing` (a new trigger; its payload `{k: "school", id}` is a kind `drop()` does not know, so the whole cache clears, which is correct and cheap). Edge: `Cache-Control: public, max-age=10` — team facts, no label, so the edge may hold it for ten seconds; a withdrawn publication still 404s the match page on the next request, which is where the names are.

**Rate limit.** Unchanged (`RATE` 360/60 per address). The home page costs one read on load and one every **15 s** while a card is live and the tab is visible (4 a minute a visitor); a pavilion's shared address with the ground display (13 a minute) and 43 phones on `/live` (083's arithmetic) gains headroom for ~30 phones on the home page before the bucket empties. The cache, not the limit, protects the database: one query per 5 s for everyone.

**Off.** `PUBLIC_PAGES` off → the one 404, as every public path; the page then hides the section.

### 2.3 The card

```
┌──────────────────────────────────────────────┐
│ ● LIVE                                 18.2 ov│
│ Hilton College 1XI            142/3           │
│ Westville Boys' High 1XI       —              │
│ 40 overs · started 10:00                      │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ RESULT                                        │
│ Hilton College U15A           131/8 (40)      │
│ Westville Boys' High U15A     132/4 (36.1)    │
│ Westville Boys' High U15A won by 6 wickets    │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ 14:00                                         │
│ Hilton College 2XI v Westville Boys' High 2XI │
│ 40 overs                                      │
└──────────────────────────────────────────────┘
```

**Shows:** school names (the side labels the header uses), team codes (the age group rides on them — "U15A" — as PUBLIC_DATA §3 allows), score by innings, overs bowled, status, format, start time of day, the result words (sides named, no reason: `publicResult()` as built). The whole card is the link to `/live/:id` (`rel="nofollow"`); a finished one to `/scorecard/:id`.

**Never:** a boy's name or label (not even "D Erasmus" — the card has no squad), a photo, the ground or any place (L3 shows the ground *on the match page* while the match is on; a list of where children are right now is not L3 and is not on the card — §8 D3), officials, weather, the toss, any reason, a date of birth or age (the age *group* stays), anything from a fixture whose school has not listed.

**When a card leaves.** A scheduled card stays through the day; it becomes live when the status does; live becomes result; abandoned reads "Abandoned" (no reason). All of today's cards go at the SA midnight (`sa_today()` moves on). A fixture unpublished or unlisted mid-day is gone on the next read (cache dropped by the trigger). A fixture rescheduled to another day leaves with the `match` notification. **Nothing from yesterday**: results live on the competition page (phase 4), not the front door.

**Empty.** When nothing is listed today the section is one quiet line, *No matches listed today*, under the hero — never a blank box, and never "no matches are being played" (a school may be playing unlisted).

---

## 3 · Public news

### 3.1 Plain words

A coach posts "1st XI through to the final" to the school's newsfeed, as he does today. He ticks "ask to put this on the SCRBRD home page". The director of sport sees it in a short queue, reads it, and approves it — or doesn't. It appears on the home page within a minute. If either of them takes it back, it goes within a minute. In v1 a public post may not name a pupil at all; it talks about sides.

### 3.2 The model as built, and what it needs

Two tables carry "news":

- **`news_post`** (`db/12_news.sql`): `scope` team/school/competition, an anchor per scope, `title` (3–140), `body` (1–4000), `published_at` (null = draft, and withdrawal sets it null again — `news-api.mjs` line 96), `author_id` from the session. Read under `news.read` at the anchor; written under the three `news.publish.*` tiers; **update and withdrawal by the author only** (`news_post_update`, line 118). No `is_public`, no image column, no approval. This is the newsfeed screen's table (`NewsView.jsx`, `read-api.mjs` line 560).
- **`notification`** (`db/08` line 220): the alerts table. It *has* `is_public` with a CHECK that a public row requires no more than `news.read`, and an index on it — written for "a public match centre" that was never built. Nothing reads it publicly, and PUBLIC_DATA D4 says news stays signed-in. It is not the home page's table: a notification is a bell, often about one boy (`subject_person_id`).

**So the news model can carry this with one migration**, on `news_post`, and `notification.is_public` is left as it is (a lead note in §10: it is a flag with no reader; the lead may want it documented as dormant so nobody builds on it by mistake).

**The migration (Opus):**

- Four columns on `news_post`: `public_requested_by`, `public_requested_at`, `public_approved_by`, `public_approved_at`; and two: `public_withdrawn_at`, `public_withdrawn_by`. Or a side table `news_post_publication` keyed by post — Opus chooses; the side table keeps db/12's policy untouched, which matters because `news_post_update` is author-only and the approver is not the author.
- `news_public_request(post)`: the author, while the post is published; records who and when. `news_public_approve(post)`: a `broadcast.publish` holder **at the post's school** who is **not the requester** (separation of duties: the office approving its own post is one person deciding what the public sees about children; the policy package already has the pattern). `news_public_withdraw(post)`: the author **or** any `broadcast.publish` holder at the school; sets the withdrawn pair. A post's internal withdrawal (`published_at = null`) also removes it from the public read, because the read requires `published_at IS NOT NULL`.
- **Only `scope IN ('team','school')` in v1.** A competition post belongs to no one school, and no one school's `broadcast.publish` holder should put it on the front page. Competition news waits for an organiser's door (SCRBRD-114's `competition.manage` is the likely one).
- **The name scan, a belt for the attestation.** `news_public_check(post)`, `SECURITY DEFINER`, reads the post's school's `player.full_name` and `player.known_as` (the two columns a stranger would recognise as a name; `surname` alone is too common to scan — "Naidoo" is a sentence about many families) and returns **a count**, never a name: how many of the school's pupils the text names. `news_public_approve()` refuses with `names_pupils` when the count is above zero. The screen says *"This post names a pupil. Public posts talk about sides, not boys — reword it, or keep it on the school's feed."* The approver also attests, on the button: *no pupil's name, no photo, no health, no discipline, no address or contact.* The scan is the belt; the attestation is the braces; neither is a guarantee against "the tall left-hander from Pietermaritzburg", which is why v1's rule is the simple one and why the approver is a person.
- A `public_data_notify()` trigger on `news_post` (payload `{k: "news", id}`; `drop()` clears everything on an unknown kind, correct and cheap).
- `public_news(limit)`: `SECURITY DEFINER`, returns `id, school label, team_code, title, body, published_at` for posts where `published_at IS NOT NULL AND published_at <= now()`, approved, not withdrawn, **and the school has `public_listing.listed`** (§8 D5: one switch for everything of the school's on the home page), newest first, at most `limit` (20). Held to `NEVER_PUBLIC` by the existing body test. `author_id` is never selected: a coach's name on a public post is an adult's, outside the rule, but the newsfeed shows it and the home page need not (**A4**: Kameel may want a byline; if so it is the author's display name through a definer, and the author is told).

### 3.3 What a public post may not contain

| never | why | enforced by |
|---|---|---|
| A pupil's name in any form — full, first, initial and surname | C3: a withdrawn consent must reach the past, and free text cannot be re-judged on the day served without tokens (083 §4.1's design for AI lines). v2 adds `PLAYER_n` tokens to posts and resolves them by `publicName()` at serve time, exactly as the AI lines do | the scan (full name, known-as), the attestation, the approver |
| A photo or video | A8 | `news_post` has no image column; the body is text; the read sends text |
| Health, discipline, contact, home, identity, judgements (PUBLIC_DATA §3) | N1–N5 | the attestation and the approver; the scan cannot read meaning |
| A link to a signed-in page | a stranger gets a login wall | the screen strips `/app` links; cosmetic |

### 3.4 How a withdrawn post disappears

`news_public_withdraw()` or the author's `withdraw` commits → the `news_post` trigger notifies → `PublicCache.drop()` clears → the next `GET /api/public/news` does not carry it. The news read is served `Cache-Control: public, max-age=30` (no label, team words only); at the edge a post can outlive its withdrawal by 30 s at most; the LISTEN connection down, by 60 s (083 Q1's accepted meaning of "at once"). The row stays, as db/12 intends ("a disputed notice can still be shown to have existed").

### 3.5 The screens (Sonnet)

- `NewsView.jsx`: on a post the reader authored, a row *Public: not asked · asked (waiting for the office) · on the home page · withdrawn*, with the one button the state allows. On the composer, nothing new: a post is asked about after it is posted, so nobody writes "for the public" in haste.
- A small **approvals** card at the top of the newsfeed for `broadcast.publish` holders: the requested posts of their school, the attestation, Approve / Decline (a decline is a withdrawal of the request; a note is not stored — the two can talk).
- The home page's News section: the five latest, title and body (body clamped to four lines, "more" expands in place), the school and side as a chip, the date. No separate news page in v1.

---

## 4 · Public information and data

### 4.1 Plain words

The brief names tables and fixtures (083 phase 2), honours, school pages and the rulebook. None of their public reads exist except the standings read (`/api/public/competitions/:id/standings`, db/69), and its page (`/table/:id`) still answers 404. The home page's v1 should not wait for them, and should not pretend to have them.

### 4.2 What goes on the home page, and when

| item | PUBLIC_DATA | built? | home page |
|---|---|---|---|
| Live and today's fixtures (team-level) | L1, A1, D1a | header read yes; the list read no | **v1 (phase 2)** |
| News, team-level words | D4 amended by §3 | table yes; public path no | **v1 (phase 3)** |
| How children's data is treated — plain words from PUBLIC_DATA §1–§4 | the rule itself | words exist | **v1 (phase 1)**: a static page `/privacy` (also linked from the match page's footer note) |
| The pitch, the CTA, the schools route | not about children | — | **v1 (phase 1)** |
| Competition tables (A1) | public once the competition is published | read yes (db/69); page no | **phase 4**: a *Competitions* section listing published competitions whose organiser's schools list (**A5**: the listing rule for a competition — recommend: listed when any entrant school lists), each linking to `/table/:id` once 083 phase 2 ships the shell |
| Fixtures and results per school (`/fixtures/:school`) | L1, A1 | no | phase 4, as a link from a school's chip on a card or a post |
| Honours (A5) | only `honour.is_public`, names by L2 | no | phase 4, on the school page, not the home page: an honour names a boy, and the front door names none |
| School pages | team-level | no | phase 4 = `/fixtures/:school` with the school's listed news; nothing more |
| The rulebook / playing conditions per competition (SCRBRD-114) | not about children | per-match conditions are on the public header; no page | later, if wanted: a competition's conditions on its table page. Not a home-page item |
| Leaderboards, a player page, team sheets, photos | A3, A4, A7, A8: never | — | never |

Every v1 item sits within PUBLIC_DATA as it stands plus rule 8 as amended; nothing in v1 names a child anywhere on `/`.

---

## 5 · The product pitch

### 5.1 What the page claims

The rule: **a tile is a thing a person could be shown in the app today.** Each tile below names where it lives; the lead checks any I could not read.

Today's eight tiles (`LandingPage.jsx` lines 21–30), judged:

| tile today | claim | verdict |
|---|---|---|
| Live Scoring — "Ball-by-ball broadcast scoring with AI commentary" | scoring: `packages/scoring`, the pad; overlay: built (PUBLIC_DATA D2 "built"); AI commentary: a per-device call, nothing stored, phase 3 of 083 not built | **Reword.** "Ball-by-ball scoring, offline when the signal drops, with a live page for families." Drop "AI commentary" from the front door until 083 phase 3 ships — and because "AI" on a children's product is a claim to make carefully, not as a tile. |
| Player Analytics — "Wagon wheel, phase analysis, shot breakdown by zone" | signed-in Match Centre: yes (083 §2.9's table) | Keep; say "for coaches, signed in" — the public page is team-level (L7). |
| Squad Management — "Profiles, skills matrix, development tracking" | `player_skill` (db/08 line ~200): yes | Keep. |
| Injury Tracking — "Medical logs, return-to-play, fitness reporting" | an injury table exists (N2's source); "fitness reporting" — **A6**: not verified | **Reword or cut.** "Return-to-play, recorded by the people allowed to see it." A tile that advertises medical logs of children on the front door should say who may read them. |
| Logistics — "Transport scheduling, venues, kit allocation" | transport: yes (SCRBRD-085 driver's landing); lift clubs: design only (SCRBRD-124); "kit allocation" — **A6**: not verified | **Cut "kit allocation"** unless the lead finds it. |
| Smart Calendar — "Fixtures, training, events in one unified view" | fixtures: yes; training and events as a calendar — **A6**: not verified | **Reword to what exists** ("Fixtures and training in one view") or cut. |
| League Manager — "Standings, brackets, fixtures, top performers" | standings: yes (`league` read, db/69); "brackets" — **A6**: not verified; "top performers" is a leaderboard, signed-in only (A3) | **Cut "brackets"**; "top performers" reworded "for coaches". |
| Alerts — "Push notifications to players, parents and staff" | `notification_delivery`, `firebase-messaging-sw.js`: yes | Keep. |

Two more claims on the page: **"The Cricket OS for Schools · Season 2026"** (fine) and **"Get Started — It's Free"** — a pricing promise. **§8 D10** asks Kameel what the button may say; the recommendation is "Get started" with no price until there is a price.

**What to lead with instead** (true today, and what a school is buying): a scorer that works at a ground with no signal (`packages/sync`); a live page a family follows by link, with every name shown only by consent (the privacy promise *is* the pitch to a headmaster); fast-bowler workload under the CSA guideline (db/60 — the module is off per school until granted, so the words are "available to schools that switch it on"); a paper scorebook photographed and imported (SCRBRD-120, db/63). Six tiles, not eight.

### 5.2 The call to action

SCRBRD-140 is designed, not built. Until it ships, the honest CTA is what exists:

- **"Log in"** → `/app` (the login page, office code). Beside it, one line: *Your school's office gives you your code.*
- **"Follow a match"** → the strip, or when empty: *Ask your school for the live link, or look here on match day.*

When 140 lands, "Log in" becomes **"Sign in with Google"** → `/app?signin=google` → 140 §5.1's *Choose school → Who are you?*, and the one line becomes *New here? Sign in and choose your school.* Nothing on the home page collects a name or an email before the sign-in; the page hands the person to the app, which is where 140's rules live.

### 5.3 The analytics consent toggle

Stays, in the footer, with today's words and today's test id (`analytics-consent`). One change under it: the home page runs **no analytics at all** (the public bundle may not carry the Firebase SDK — `check-bundle` marker `@firebase/app`), so the toggle sets the device preference the *app* honours (`getPref`/`setPref` in `lib/persist.js`, which does not import Firebase — **A7**: it can be imported by the public bundle without dragging the SDK in; `check-bundle` proves it). The words say so: *Anonymous usage analytics in the app: off. This page collects nothing.*

### 5.4 Schools: "Bring SCRBRD to your school"

A section, not a form: three sentences on what the pilot is, the privacy promise in one line, and a **`mailto:`** link to an address Kameel names (**A8**; not a personal address). Nothing is collected by the page; the school writes an email and says what it likes. A form (school, your name, your role, a work email) is a table, a route, a POPIA notice and a spam problem, for a pilot that is signing schools by conversation. If the mailto proves clumsy, v2 is that four-field form, stored under a `platform.*` capability, with the notice. **§8 D11.**

---

## 6 · Layout and performance

### 6.1 The page, top to bottom (phone first)

1. **Header**: logo; *Log in*. Sticky, as today's.
2. **Live now** — only when a listed fixture is live: the live cards, before anything else. A parent on a Saturday did not come for the pitch.
3. **Hero**: one sentence and the CTA. (When nothing is live, this is first and the strip's *Today* follows it.)
4. **Today**: scheduled and finished cards; or the one quiet line.
5. **What SCRBRD does**: six tiles (§5.1).
6. **News**: five latest public posts.
7. **For families**: the promise, four lines, *How we treat children's data →* `/privacy`.
8. **For schools**: three sentences and the `mailto:`.
9. **Footer**: the analytics toggle; `/privacy`; © .

### 6.2 Where it lives, and why

Today `/` is `index.html` → `App.jsx` → `LandingPage` in the **signed-in entry** (ceiling 500 KB; views and the scorer lazy). The home page must be on the public side of `check-bundle`'s line.

**Recommendation: a third Vite entry, `apps/web/home.html` → `src/home/main.jsx`**, static, served by Hosting (rewrite `"/"` → `/home.html`, before the `**` → `/index.html` rule) and by `serveClient` in the single-service deployment (`/` → `home.html`). Rollup shares React and the tokens between the three entries as hashed chunks. `check-bundle` gains a **home graph**: the eight `NOT_PUBLIC` markers absent (the scorer, a view, the App shell, the API client, the governed read path, a signed-in match route, the Firebase SDK, the service worker's registration), `/api/public/live` present, and a ceiling of its own (**A9**: ~220 KB — React and the tokens, no fold; measured at build and written into the check as the public one was). The alternative — the home page as a lazy chunk of `/public-app.js` — makes every visitor download the scoring fold and the match tabs (447 KB static) to read a pitch. **§8 D8.**

Two consequences, both small, both for Opus:

- **The app moves to `/app`.** `index.html` is still the fallback for every other path (Hosting `**`, `serveClient`), so `/app` loads the app; `App.jsx`'s `"landing"` state goes straight to `"login"` (or `LandingPage.jsx` becomes a redirect to `/`), and `LandingPage.jsx` is retired. **A10**: `App.jsx` reads `location.pathname` for nothing that `/app` would break (the grep found no `pathname` read).
- **The service worker** (`public/sw.js` line 52) leaves `/live/`, `/scorecard/`, `/table/`, `/fixtures/` and `/public-app.js` to the network; `/` exactly and `/home.html` join the list, or a returning user's cached app shell is served at `/`. `robots.txt` is unchanged (nothing new disallowed).

### 6.3 Performance on a phone over mobile data

- The HTML is static and small (**A9**: < 15 KB), with the theme boot inline (`THEME_BOOT`, as the shells have) so daylight does not flash dark, and the fonts the shells already load (`display=swap`). One image: the logo already in the repo. No hero image, no video.
- First paint needs no request. The strip and the news are two reads after paint, each `public, max-age` at the edge; the strip polls every 15 s only while a card is live and `document.hidden` is false (the pattern `PublicMatch.jsx`'s `usePublicMatch` uses).
- `PUBLIC_PAGES` off: both reads 404; the sections hide; the page is complete without them. The home page therefore ships **before** the public pages go live.
- Works signed out by construction: the bundle has no token to send.

---

## 7 · Phasing and tiers

Each phase names what ships, who builds it, and the proofs — named, not written. db/99's next free section follows §57; migrations take the next free `db/NN` when written (db/80 is the latest shipped; nothing shipped moves).

### Phase 1 — The page, with no migration and no public data

**Ships:** `home.html` + `src/home/` (hero, tiles, families, schools, footer with the toggle; the strip and news sections present but hidden until their reads answer); `/privacy` as a second static page from PUBLIC_DATA's words; Hosting and `serveClient` for `/`; the SW exclusions; `/app`; `LandingPage.jsx` retired; `check-bundle`'s home graph.
**Opus:** the routing of `/` (Hosting, `serveClient`, the SW — one mistake serves a stranger the app shell or a returning user a blank page), `check-bundle`, and the review. **Sonnet:** the page and its sections, the copy from §5, the privacy page.
**Proofs:** `check-bundle` (the home graph: markers, ceiling, `/api/public/live` present); `apps/web/test/home-page.test.mjs` (renders signed out; hides the strip and news on 404; the toggle writes the pref and starts nothing); `tools/smoke-browser-home.mjs` (opens `/` signed out on a phone viewport: no sign-in, no `Bearer`, no request to `/api/read/` or `/api/matches/`; no `robots` meta; `Log in` lands on `/app`'s login; the DOM contains no name from the seed — a guard that stays true when phases 2–3 add data).

### Phase 2 — The per-school listing and the strip (one migration, Opus)

**Migration:** `public_listing` + `public_listing_set()` under `broadcast.publish`; `public_live_fixtures()`; the notify trigger on `public_listing`. **API:** `GET /api/public/live` in `public-api.mjs` (a fixed cache key; the TTL rule; `max-age=10`; `X-Robots-Tag`); `GET/POST /api/schools/:id/listing` beside `publication-api.mjs`, calling `changed()` on commit as publication does. **Policy doc:** PUBLIC_DATA rule 8 amended as §1.5, by Kameel's hand.
**Sonnet:** the cards; the strip's poll; on `views/publication.jsx` a line under the publish switch — *Your school lists its matches on the SCRBRD home page: this fixture will appear there* (or *does not list*, with a link to the setting); the setting itself on the school's settings screen for `broadcast.publish` holders.
**Proofs:** `packages/policy/test/public.test.mjs` (the new body's columns against `NEVER_PUBLIC`); `services/api/public/public.test.mjs` (the listing rule's five rows of §1.4 over a fake pool; a staff token byte-identical; 404 when off; headers; the cache's TTL flips with a live row; a `public_listing` notification clears it); db/99 §58 (two schools, one listing: the fixture appears for each publication state, disappears on unlisting, never appears for a fixture with no published side, carries no ground and no player column); `tools/smoke-public.mjs` gains the live read; `tools/smoke-browser-home.mjs` gains: a card for the seed's listed fixture, the tap lands on `/live/:id`, `rel="nofollow"` on the link, no ground text in the DOM.

### Phase 3 — Public news (one migration, Opus)

**Migration:** the request/approve/withdraw columns or side table; `news_public_request()`, `_approve()` (separation of duties, the scan refusal), `_withdraw()`, `news_public_check()`; `public_news()`; the notify trigger on `news_post`. **API:** `GET /api/public/news`; `POST /api/news/:id/public/{request,approve,withdraw}` in `news-api.mjs`, each calling `changed()`.
**Sonnet:** `NewsView.jsx`'s state row and the approvals card (§3.5); the home page's News section.
**Proofs:** `public.test.mjs` (body columns; no `author_id`); `services/api/write/news.test.mjs` or db/99 §59 (author requests; the same person cannot approve; a `broadcast.publish` holder at another school cannot; a post naming a seed pupil by full name or known-as is refused with a count and no name; a withdrawn post leaves the public read; a competition post cannot be requested); `tools/smoke-browser-home.mjs` gains: the approved post appears, the withdrawn one is gone within 60 s, the DOM still contains no seed name.

### Phase 4 — SCRBRD-083 phase 2 on the home page

Competitions, fixtures per school, honours on the school page — 083 phase 2's migration and shells, plus a *Competitions* section here (**A5**). Nothing in this document changes 083's phase 2 beyond that section.

### What needs Opus, in one list

New public functions (`public_live_fixtures`, `public_news`, `news_public_check`); the listing table and its door; the news approval functions and the separation-of-duties check; both migrations; the public router's two reads and their cache keys; the routing of `/` (Hosting, `serveClient`, the SW); `check-bundle`; the review of every Sonnet screen before it lands; the redaction review of §2.2's and §3.2's field lists against `NEVER_PUBLIC`.

---

## 8 · Decisions for Kameel

| # | decision | recommendation, and why in one line |
|---|---|---|
| **D1** | Listing on the home page is a **per-school switch plus the existing per-fixture publication**, not publication alone | **Yes.** Publication was agreed as "by link"; a second yes from the same person keeps that promise and costs one setting |
| **D2** | **Either** listing school's published side lists the fixture; no away consent for the team-level card | **Yes.** The card adds nothing the link already shows; each school speaks for its own listing as for its own children |
| **D3** | The card shows **no ground** | **Yes.** A list of where children are right now is a different fact from a match page a parent was sent; the ground is one tap away on `/live` (L3) |
| **D4** | The home page is **indexed**; match pages stay `noindex`; card links are `nofollow`; rule 8 amended as §1.5 | **Yes.** A product's front door that names no child is the public a school's own website already makes it |
| **D5** | **One** per-school switch governs both the strip and public news | **Yes.** "If we are off the front page, nothing of ours is on it" is a sentence an office can hold |
| **D6** | Public news **names no pupil at all** in v1; names come with tokens in v2 | **Yes.** C3 needs a withdrawal to reach the past, and free text cannot be re-judged on the day served |
| **D7** | A public post needs **a second person**: a `broadcast.publish` holder at the school who is not the requester | **Yes.** Putting words about children on the front page is the act that door already guards |
| **D8** | The home page is a **static third entry** (`home.html`) on the public side; the app moves to **`/app`** | **Yes.** A stranger downloads a pitch, not the scorer or the fold; one Hosting rule and one SW line |
| **D9** | **v1 content:** strip, news, pitch, families, schools, privacy page. Tables, fixtures per school and honours wait for 083 phase 2 | **Yes.** Nothing on `/` promises a page that 404s |
| **D10** | **The tiles:** reword Live Scoring (no "AI commentary"), Injury Tracking and Smart Calendar; cut "brackets" and "kit allocation"; **"It's Free" becomes "Get started"** until there is a price | **Yes.** Every claim is something a person can be shown today |
| **D11** | **Schools route is a `mailto:`**, no form | **Yes.** Nothing collected for a pilot signed by conversation; a form is a v2 if the inbox says so |
| **D12** | **CTA until SCRBRD-140 ships:** *Log in* (office code) with *Your school's office gives you your code*; then *Sign in with Google* | **Yes.** The home page hands people to the app; the sign-up rules live there |
| **D13** | **Cards are today's only**; results leave at SA midnight; nothing from yesterday on `/` | **Yes.** The front door is now; history belongs to the competition page |
| **D14** | **Strip cache** `max-age=10` at the edge, 5 s in-process while live; **poll 15 s** while a card is live | **Yes.** Team facts, no label; a withdrawn name is on the match page, which is `no-store` and dropped at once |

---

## 9 · Assumptions (A), each to be confirmed

- **A1** The roles holding `broadcast.publish` (`roles.mjs` lines 183, 223) are the director of sport and the school office, as SCRBRD-133 assumed.
- **A2** "Today" is `sa_today()` (db/08), and `match.starts_at` is set for every fixture a school would list; a fixture with no `starts_at` is not listed.
- **A3** The pilot's busiest day is under fifty listed fixtures; the read's bound is 50.
- **A4** No byline on public news. If Kameel wants one, it is the author's display name through the definer, and authors are told their name goes public.
- **A5** A competition is listed (phase 4) when any entrant school lists. 083 phase 2's design decides; this document only reserves the section.
- **A6** Four tile claims I could not verify from the files read — "fitness reporting", "kit allocation", "training, events" as a calendar, "brackets" — the lead checks each against the code; the rule stands either way (§5.1).
- **A7** `apps/web/src/lib/persist.js` (`getPref`/`setPref`) can be imported by the public bundle without reaching the Firebase SDK; `check-bundle` proves it or the toggle moves to a small pref module of its own.
- **A8** The schools `mailto:` address is one Kameel names, not a personal one.
- **A9** The home graph measures ~220 KB and the HTML < 15 KB; both are measured at the first build and written into `check-bundle` as the public ceiling was (447 → 470 KB).
- **A10** `App.jsx` reads `location.pathname` for nothing that `/app` breaks; the SCRBRD-085 driver's landing is a state, not a path.
- **A11** Firebase Hosting's `"source": "/"` matches the root path only and can be ordered before `"**"`; otherwise `serveClient`'s rule and a Hosting `redirect` of `/` are the fallback.
- **A12** `fixture_side_label()` and `match_live_score` (db/59's header) are the right sources for a card's labels and scores, so the list read is a projection of the header and nothing new passes `NEVER_PUBLIC`.

---

## Appendix A · Existing things this design relies on, by path

| thing | where |
|---|---|
| The rule; "findable by link" (§1 item 7); surfaces L1–L7, A1, A5, A8, D1, D3, D4; never-public §3; consent C1–C7; §5a's "judged on the day served" | `docs/policy/PUBLIC_DATA.md` |
| Principles 1–10; the read path §2; publication side by side §2.5; caching §2.6; headers §2.7; rate limits and "no listing endpoint" §2.8; phase 2 §8; Q1, Q2, Q3, Q8 decided | `docs/design/SCRBRD-083_public_pages.md` |
| The ground display signs in as nothing (D1); the home side's publication is its switch (D2); the shared-address rate arithmetic (A4) | `docs/design/SCRBRD-133_immersive_match_centre.md` §1, §9 |
| Sign up first, link later; *Choose school → Who are you?* | `docs/design/SCRBRD-140_signup_and_school_linking.md` §0, §5.1 |
| `publicPages()`, `PublicCache` (`get`, `drop`, `hit`), `RateLimit`, `RATE` 360/60, `LIVE_TTL_MS`, `SETTLED_TTL_MS`, `HOT_PER_MINUTE`, `PUBLIC_HEADERS`, `NO_STORE`, `TEAM_LEVEL`, `NOT_FOUND`, `shellHtml()`, `THEME_BOOT`, `publicResult()`, `listen()` | `services/api/public/public-api.mjs` lines 79–82, 102–113, 144–227, 232–266, 293–308, 334–363, 395–585, 604–619, 628–669 |
| `projectLog()`, `nameFor()`, `PUBLIC_EVENT_FIELDS` (the allowlist habit this design copies) | `services/api/public/redact.mjs` lines 749–773, 842–859, 947–1022 |
| `fixture_publish()`'s route; `onChange`/`changed()` on commit; `NAMES_SQL` (the counts the publication panel shows) | `services/api/write/publication-api.mjs` |
| `news_post` table, author trigger, read / insert / update policies; withdrawal = `published_at = null` | `db/12_news.sql` lines 20–58, 60–122; `services/api/write/news-api.mjs` lines 91–100 |
| `notification.is_public` (line 242) and its CHECK (line 268) — a flag with no public reader | `db/08_schema_programme.sql` lines 220–268 |
| `honour.is_public`, `withdrawn_at`, `withdrawn_reason`, `citation` | `db/08_schema_programme.sql` lines 5451–5477 |
| `fixture_publication`, `fixture_publish()`, `fixture_side_published()`; `competition_publication`, `competition_publish()` | `db/47_public_data.sql` lines 625–747 |
| `public_match_header()` (labels, codes, status, scores, `sa_today()`), the notify triggers' list | `db/59_public_read_path.sql` lines 116–140, 375 |
| `public_competition_standing()` (the one phase-2 read built) | `db/69_*.sql` line 1294 |
| `match.status` values | `db/00_schema_core.sql` line 307 |
| The seed's schools and illustrative names | `db/98_seed_pilot.sql` lines 19–65 |
| db/99's latest section (§57) | `db/99_rls_verify.sql` |
| Today's landing page: the eight tiles, the CTA, the analytics toggle | `apps/web/src/auth/LandingPage.jsx` lines 21–30, 56–59, 85–93 |
| The public entry; the lazy display chunk; "nothing signed-in is reachable" | `apps/web/src/public/main.jsx` |
| `usePublicMatch()`'s poll-while-visible; the footer note on names | `apps/web/src/public/PublicMatch.jsx` lines 71–96, 322 |
| The newsfeed screen and `/api/news` | `apps/web/src/views/NewsView.jsx`; `services/api/server.mjs` lines 662–666 |
| The publish panel | `apps/web/src/views/publication.jsx` |
| `analyticsConsented()`, `setAnalyticsConsent()`; `getPref`/`setPref` | `apps/web/src/lib/firebase.js` lines 43, 59, 86–92; `apps/web/src/lib/persist.js` |
| The two Vite entries and the fixed `/public-app.js` name | `apps/web/vite.config.js` build.rollupOptions |
| `check-bundle`: the entry graph's 500 KB ceiling, the public graph's 470 KB ceiling, `NOT_PUBLIC`'s eight markers, `staticGraph()`/`wholeGraph()` | `tools/check-bundle.mjs` |
| Hosting rewrites (`/api/**`, `/live/**`, `/scorecard/**`, `/table/**`, `/fixtures/**`, `**` → `/index.html`); `/public-app.js` no-cache | `firebase.json` lines 5–17 |
| `robots.txt`'s disallow list | `apps/web/public/robots.txt` |
| The service worker leaves the public paths to the network | `apps/web/public/sw.js` line 52 |
| `serveClient()` and the `index.html` fallback; `PUBLIC_ON` | `services/api/server.mjs` lines 208–220, 985–1030, 1270 |
| Turning the public pages on | `DEPLOYING.md` lines 286–300 |
| Who holds `broadcast.publish` | `packages/policy/src/roles.mjs` lines 183, 223 |
| Existing walks and tests to extend | `tools/smoke-public.mjs`, `tools/smoke-browser-public.mjs`, `services/api/public/public.test.mjs`, `packages/policy/test/public.test.mjs` |

---

## 10 · Notes for the lead (not decisions)

1. **`news_post_update` is author-only** (db/12). The withdraw route runs as the caller, so today **only the author can withdraw a notice**; the school office cannot take down a coach's post. Not this design's problem, but phase 3's approval functions must not inherit it — hence the side-table shape and a definer for withdrawal.
2. **`notification.is_public`** (db/08 line 242; its CHECK at 268) is a public flag with no public reader, and its comment speaks of "a public match centre". Nothing should be built on it without a decision; this design does not use it.
3. **`PublicCache.drop()`** clears everything on an unknown `k` (public-api.mjs line 225). The two new triggers rely on that; if the cache is ever made selective, `"school"` and `"news"` need branches.
4. **The listing read is the first public read with no id.** 083 §2.8's "no listing endpoint" sentence should be amended in that document when phase 2 is built, to say "none that walks unlisted or unpublished fixtures".
5. **`shellTitle()`'s Open Graph title** already makes a WhatsApp preview of a match; the home page's own `og:title`/`og:description` are static and name no match, so a shared `/` link previews the product, not a fixture.
