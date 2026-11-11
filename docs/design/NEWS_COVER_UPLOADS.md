# News cover photos — staff uploads beside the generated cover: the design

Status: **approved by Kameel, 11 Nov 2026: "All 8 as recommended"** (his note on the card, confirmed the same day: public data moves to opt-out by terms; that is a separate design, and photos of pupils stay off public pages here). Was: **design for Kameel's review** (Fable, 2026-11-11; revised the same day after Opus's review).
Nothing here is built. Opus builds from it after Kameel answers §12. Asked for by Kameel on 6 Nov
2026: "Generated + staff uploads".

**This is the first part of backlog SCRBRD-092** ("photo and video sharing for registered users, and
the consent to it at sign-up", `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md:3557-3590`): photos, on news
posts, as covers. Video and any wider sharing stay in SCRBRD-092. §10.1 maps that entry's
"before any photo feature" list onto the slices here.

Read against `origin/main`: `docs/policy/PUBLIC_DATA.md`; `NewsView.jsx`, `NewsCover.jsx`,
`newsFeed.js`; `db/101`; the `news.*` rows of `db/01`; `SCRBRD-120_scorebook_importer.md` and
`object-store.mjs`; `SAFEGUARDING_DSO.md`; `READERS_child_data.md`; the image lines of SCRBRD-083 and
SCRBRD-142; `ACCOUNT_LIFECYCLE.md`; `NOTIFICATIONS.md`; `INCIDENTS_AND_BREACHES.md`;
`ACCESS_REQUESTS.md`; and, for the revision, the lines the review cites.

No real child is named in this document. "Boy A" and "boy B" stand for pupils.

### Revised 11 Nov after review

- **The view gate no longer fails open** (B1). The entry points run as the caller, so `news_post`'s own
  policies decide who reads the post; only then does a narrow owner-run function read the cover (§5.4).
- **Serving follows the importer** (B2): the screen fetches with the bearer token, `no-store`, into a
  blob. No `<img>` URL, no browser or Firebase Hosting cache. "At once" is restated honestly (§4.3).
- **A pupil may be picked only if he reads the post**, checked again at every serve (B3; §2.2, F2,
  gate step 6). A family can always open a post their child's photo is on.
- **Slice 5 waits on SAFEGUARDING phases 2 and 4**, not 4 alone; SCRBRD-092 and CSA SG-9 rule 5 are
  placed, and lifting rule 5 is now a question (B4; §10.1, Q1).
- **No covers on competition posts or on plans** in this version (§2.2).
- The post-read rules are restated with db/117, db/129 and db/131: **followers read every side's team
  posts**, so a `none` or `adults` photo on a team post reaches them (§3.3).
- **A post's words may not name a pupil while it carries a `pupils` photo** (§2.4).
- The uploader and approvers **cannot read why a photo is hidden**: one display state, no `held`, no
  actor on the event (§5.2, §5.3).
- **The owner's key reads no cover table**; one logged door with a written reason (§5.3).
- The consent check (F3) is logged per pupil and narrowed by the pick rule (§5.5, Q7).
- Restore, the hold under a concern, the slice order, the `NEVER_PUBLIC` shape and the `og:image` test
  are corrected (§9.2, §3.5, §8, §6).
- Questions: the public-pages question is dropped (A8 and SCRBRD-092 decide it); one added on
  SCRBRD-092 and SG-9 rule 5; one added on logging views. Eight in all.
- C2 (approve) is no longer held by `media`: it goes to the three roles that already decide what the
  school publishes.

---

## 0 · In one page

Today every post draws its cover in code (`NewsCover.jsx`): no photograph, no person, the same on
every device. That stays the default, and it stays underneath every photo as the fallback.

A member of staff who may publish a team or school post may attach **one photo** to it as its cover.

1. **The post goes out at once with its generated cover.** The photo waits for a second person. A
   photo never delays a notice and a refused photo never takes a notice down.
2. **Every photo is approved by a second person** at the school before any reader sees it.
3. **A photo is one of three classes**, declared by the uploader and confirmed by the approver: `none`
   (no person can be recognised), `adults` (recognisable adults only), `pupils` (pupils of this school).
4. **A `pupils` photo names every pupil in it, privately.** The uploader picks each boy from the
   roster, and only boys who read that post. The picks are never shown.
5. **A pupil appears only with photo consent** (`media_consent`, purpose `photo`, SAFEGUARDING K1): his
   guardian's, and his own from twelve. Consent is judged each time the photo is served.
6. **A photo that shows pupils is seen by the school's own people only**: staff, pupils and parents who
   already read the post. A follower, a scout and an official see the generated cover.
7. **No signed-out page ever shows an uploaded photo.** PUBLIC_DATA A8 stands. It is held by
   structure, not by an approver's care (§6).
8. **Anyone who sees a photo can report it in one tap; a family can remove a photo of their own child
   in one tap.** Both hide it at once. A report goes to the school's DSO with no name in the notice.
9. **Photos are not an archive.** The bytes are deleted twelve months after approval and at once on a
   takedown; the rows stay as the audit.

Six slices (§8). Slices 1–3 carry `none` and `adults` photos on what is on main today. Slices 4–5
(`pupils`) wait on SAFEGUARDING phases 2 and 4. Eight questions need Kameel (§12).

---

## 1 · Principles — what never happens with a cover photo

1. **No photo on a public page.** PUBLIC_DATA rule 4 and A8 are unchanged. SCRBRD-092 already records
   that a public photo "would reopen A8, which is Kameel's decision"; this design does not ask it.
2. **No child's name on or beside a photo.** No caption, no credit, no legible name inside the picture
   (a scoreboard with surnames, a team sheet, a kit bag, a shirt), and no pupil named in the post's
   own words while it carries a `pupils` photo (§2.4). CSA p34 rule 2 says the same
   (`CSA_SAFEGUARDING_CHECK.md:97-98`).
3. **One person never decides alone what a room of people sees of a child.**
4. **A "no" is immediate and needs no reason.** A guardian's, a pupil's, the DSO's.
5. **The reader who may not see a photo sees nothing odd**: the generated cover, exactly as on a post
   that never had a photo.
6. **Why a photo is hidden is the DSO's to know.** A consent withdrawn, a never-public mark, a report,
   a hold and a family's removal look the same to everyone else.
7. **The store is private and nothing is signed or cached.** No URL to a photo exists outside the API.
8. **No photo goes to a detector, a captioner or a moderation service.** That would be an operator
   processing children's faces (SCRBRD-120 §5.4's question).
9. **The generated cover is never removed from the code path.**

---

## 2 · The model

### 2.1 The cover's life

```
            upload              submit              approve
  (none) ─────────▶ draft ─────────────▶ submitted ─────────▶ approved ──▶ down ──▶ (bytes purged)
                      ▲                      │  │                 │
                      └──────── return ──────┘  └─ decline ──▶ declined ──▶ (bytes purged at once)
                                                                  │
                                                     hold (DSO) ◀─┴─▶ release (DSO)
```

| state | who sees the photo | bytes |
|---|---|---|
| `draft` | the uploader | kept 14 days from the last change, then abandoned and purged |
| `submitted` | the uploader; the school's approvers, through the logged review door | kept; the approvals card shows its age |
| `approved` | the readers §3.3 admits, each time the gate (§5.4) says yes | kept until `expires_at` |
| `declined` | nobody | purged at once |
| `down` | nobody | purged at once, unless held |

A return puts the cover back to `draft` with a reason word and keeps the bytes. One live cover per
post. A post whose cover is `declined` or `down` may be given a new one.

### 2.2 The three classes, and where a photo may go

| class | what it shows | approval | who sees it |
|---|---|---|---|
| `none` | no recognisable person: the ground, a trophy, kit, a scoreboard showing only scores and side names | a second person | everyone who reads the post |
| `adults` | recognisable adults only, each of whom has said yes to the uploader | a second person | everyone who reads the post |
| `pupils` | one or more pupils **of this school who read this post**, each picked from the roster | a second person, a live DSO authorisation for the season (Q3), every picked pupil's consent | the school's own people among the post's readers (§3.3) |

- **Team and school posts only.** No cover on a **competition** post in this version: it has no school
  to ask for the module (`feature_enabled()` needs one, `db/08:2494-2515`), no school DSO to route a
  report to, and the pilot's league account is a platform-wide assignment, which this design bars from
  approving and from being served. It is a narrowing; it can be reopened with its own design.
- **No cover on a plan** (`kind = 'plan'`). "The plan is words" (`SCRBRD-138_phaseB.md:187`), and a
  never-sent plan can be deleted (`db/110:30-36`), which would orphan the bytes.
- **Only a boy who reads the post may be picked.** On a school post: any pupil of the school. On a
  team post: a boy of that side today. A U15B boy in a photo of the U15A match goes on a school post,
  not on U15A's team post, because his parents do not read U15A's posts (`db/101:9-15`) and a family
  must always be able to open the post their child's photo is on.
- **A crowd counts.** If a pupil can be recognised by someone who knows him, the class is `pupils` and
  he is picked.

### 2.3 What no photo may show, whatever its class

The uploader ticks these; the approver ticks them again. The list is versioned
(`cover-rules-2026-01`) and the version is stored on the cover.

- A recognisable **child of another school** (Q4). Each school speaks for its own children.
- A **legible name** of any child, a date of birth, a number plate, a home, a boarding house.
- A pupil **changing, in a changing room, in swimwear or underwear, being treated, injured, in
  distress, or being disciplined** (PUBLIC_DATA N2, N3; the DSO's conditions line, §3.5).
- A **scorebook page, a team sheet, a medical form, a screen** showing any of them.
- Anything the uploader did not take, or the school has no right to use.

A machine checks none of this. Two people and a takedown route do. That is why the wall around the
public (§6) is built from structure instead.

### 2.4 The post's own words

While a post carries a `pupils` cover that is `submitted` or `approved`, its title and body may not
name a pupil. The check is db/83's owner-only `news_public_names()` (`db/83:130-142`), which returns
a count and never a name:

- on approval: a count above zero refuses, `names_pupils`, and the screen says "This post names a
  pupil. A photo of pupils cannot sit beside their names. Reword the post, or keep the generated
  cover.";
- on every later edit of the post: a count above zero sends the cover back to `submitted` (not
  served), and the uploader is told the same sentence. The edit itself goes through.

It over-blocks as db/118 does, for the same accepted reason. A post with a `none` or `adults` photo,
or with the generated cover, may name boys as it may today.

---

## 3 · Who may

### 3.1 Uploading

A person may attach a photo to a post **only if he is that post's author and still holds the publish
tier that post needed**, at that anchor, today.

| post | who may attach (as db/01 holds `news.publish.*`, `db/01_authz.sql:305-589`) |
|---|---|
| team | coach, team manager, media, sports administrator, director of sport |
| school | media, school office, sports administrator, director of sport |

It is also a capability of its own, `news.cover.upload`, so it can be withheld from a role without
touching who may write a notice. Never a pupil, a parent or a follower.

### 3.2 Approving

`news.cover.approve`, at the post's school: **director of sport, school office, sports
administrator**. These are the roles that already decide what the school publishes (`broadcast.publish`
is the director and the sports administrator; the office keeps the consent records). `media` uploads
and does not approve: giving the media officer the picks of every photo would widen READERS G9, which
is still open.

- `news_cover_decide()` refuses `own_cover` when the caller uploaded the cover, picked or unpicked any
  pupil on it, or wrote the post.
- The approver cannot change the class, the picks or the picture. He approves, returns (`wrong_class`,
  `pupil_missing`, `rule_broken`, `poor_quality`) or declines.
- Not a support session, not the pad's credential, not a platform-wide assignment.

### 3.3 Seeing

Who reads a post is decided by `news_post`'s policies as they stand: db/12, db/96, db/101, db/117 (the
dated side), db/129 and db/131. **Since db/131 (Kameel, 4 Nov) every follower at the school reads every
side's team posts** (`db/131:11-20`); finance, sponsorship, a driver and facilities still read no team
post. A cover never widens that. It can only narrow it:

| the reader, where he already reads the post | `none` / `adults` | `pupils` |
|---|---|---|
| staff of the school (principal, director, office, sports administrator, coach, assistant, manager, physio, S&C, DSO, media, analyst) | photo | photo |
| a pupil of the school | photo | photo |
| a parent with a live verified link to a pupil of the school | photo | photo |
| follower (`spectator`), scout, union selector, official, a scorer from outside, driver, facilities, finance, sponsorship, transport coordinator | photo | **generated cover** |
| support session; the pad's credential; a platform-wide assignment | generated cover | generated cover |
| the public, the pavilion screen, the overlay | **generated cover, always** | **generated cover, always** |

So a `none` or `adults` photo on a team post reaches the side **and the school's followers**; a
`pupils` photo on a team post reaches the side's staff, boys and parents and no follower. The `pupils`
column is a new capability, `news.cover.pupils.view` (Q2; it closes READERS gap G8).

The consent card's sentence must name exactly this room: *"Staff, pupils and parents at {school} may
see photos that include him on the school's news."* It is `media_consent`'s version text; changing who
sees is a new version, never a silent widening.

### 3.4 Taking down

| who | what | effect |
|---|---|---|
| the uploader | withdraw his own cover | `down`, at once |
| any `news.cover.approve` holder at the school | withdraw any cover at the school | `down`, at once |
| **a picked pupil, at any age** | "Remove this photo of me" | `down`, at once, no reason asked |
| **a parent with a live verified link to a picked pupil** | "Remove this photo" | `down`, at once, no reason asked |
| any reader who is served the photo | "Report this photo" | hidden at once, the DSO told (§3.5) |
| a DSO of the school | hold, release, remove | hidden / shown again / `down` |
| the system | a picked pupil's consent ends, he gets the never-public mark, he no longer reads the post, the DSO's authorisation ends, the module goes off, `expires_at` passes, the post is withdrawn | the gate refuses on the next request; the sweep writes `down` and purges |

A pupil removes a photo of himself at any age, not from twelve: K1's twelve is for the standing
consent, and one picture is a smaller thing. It needs him to have an account, which a pupil under
twelve may not (SAFEGUARDING Q7); his parent's button covers that. Removing one photo does not end the
family's standing consent.

A family who sees their child in a photo he was **not picked in** uses Report, with the fixed choice
"My child is in this photo".

### 3.5 The DSO

- **A season's authorisation (Q3).** `pupils` photos are served only while a `safeguarding_register`
  line of kind `photo_authorisation` is live for the season, signed under `safeguarding.authorise`,
  its `body` holding the DSO's conditions (shown to every uploader above the rules). CSA p32 item 4:
  media "must be made available to the Club DSO … use … can be denied"
  (`CSA_SAFEGUARDING_CHECK.md:120-124`). The DSO reads every side's posts and holds
  `news.cover.pupils.view`, so every `pupils` photo is available to the DSO, who holds the remove.
- **A report** follows `notification_report()` (CSA SG-9 rule 4). `news_cover_report(post, word)`
  hides the photo, writes the reporter and the word to the restricted table, and writes one
  `safeguarding` notice to the school's DSOs: "A photo was reported at your school. Open SCRBRD to see
  it." No name, no post title, no word. The reporter is told "Reported. The photo is hidden while the
  school's safeguarding officer looks at it." and nothing after (SAFEGUARDING §3.5).
- **A concern about a photo** is raised through `safeguarding_concern_raise()` as it stands; the
  report screen offers the form. The function writes the cover's id into the concern's first note and
  a `concern` row in the restricted table. Nothing about the concern is written on the cover's
  ordinary rows.
- **A hold keeps the bytes**, and only a DSO opens them (`news_cover_open_dso()`, logged by
  `log_restricted_read()`). A hold lasts 90 days unless renewed. **While a concern names the cover, the
  hold does not lapse and a DSO's "remove" takes the photo down but keeps the bytes held**, until the
  concern is closed and purged under SAFEGUARDING §4.7.
- **A report on a cover the school's DSO uploaded or approved** is routed by `safeguarding_route()` as
  "about the DSO": to the union's DSOs.
- The DSO does not approve each photo (Q3 says why).

---

## 4 · The photo: file, store, serving

### 4.1 In

- **One file, a still photograph.** JPEG or PNG, told by its signature. No GIF, SVG, video, HEIC or PDF
  at the API.
- **The browser prepares it**: canvas, longest edge 1280 px, JPEG (about 250 KB). That turns a phone's
  HEIC into JPEG where the browser decodes it, bakes in the rotation and drops EXIF.
- **The API does not trust the browser.** It runs `sanitisePage()` (`services/api/io/page-image.mjs:54-66`,
  pure and exported), so GPS, device, captions and XMP are gone whatever sent the bytes. That function's
  caps are the scorebook's (8 MB, 12 000 px); the cover route applies its own first and maps the
  reasons: over **3 MB**, a side over **4000 px**, a longer side under **800 px** or a shorter side
  under **450 px** (so a portrait of 450 × 800 passes). A raw upload that skipped the browser loses its
  EXIF rotation, as the importer's does.
- **A hash that was taken down stays down**: an upload matching a cover at that school that went `down`
  for any reason but the uploader's own withdrawal is refused `previously_removed`. A weak belt (a
  re-saved file has a new hash), and it tells a second uploader that this image was removed once. Both
  are accepted.

### 4.2 The store

The existing adapter with a **second private bucket**: `NEWS_COVER_BUCKET` (default `news-covers`) and
its own local directory for development, `NEWS_COVER_STORE_DIR`. `supabaseStore()` already takes a
bucket; `objectStoreFromEnv()` reads only the scorebook's variables today (`object-store.mjs:66-75`)
and gains a second factory. The key shape already fits: `<school>/<post>/<uuid>.jpg`. The adapter gains
`list(prefix)`, used only by the restore step (§9.2).

The processors in the path are the ones already there: Supabase Storage holds the bytes; Firebase
Hosting fronts `/api/**` (`firebase.json:6`) and must never cache them.

### 4.3 Out

The app's credential is a bearer token in memory, not a cookie (`apps/web/src/lib/api.js:39-56`), so an
`<img src>` cannot carry it. Serving copies the importer exactly:

1. The screen fetches `GET /api/news/:post/cover` with the bearer and `cache: "no-store"`, makes a blob
   URL, and revokes it when the card leaves the screen (`apps/web/src/lib/scorebook.js:542-555`).
2. The route answers `cache-control: no-store, private` and `nosniff`
   (`services/api/write/scorebook-api.mjs:580-583`), never `public`, never `s-maxage`. Nothing is left in
   the browser's disk cache or at Firebase Hosting.
3. The route calls `news_cover_serve(post)` as the caller (§5.4). No row: 404, no body, the same answer
   a post with no cover gives.
4. **Only covers on screen are fetched** (an intersection observer). The feed returns up to 100 posts
   (`read-api.mjs:1053-1095`) and each fetch pulls the bytes through the API.
5. The feed's row carries `cover: null | { v }` (`v` the first 12 characters of the hash) only when the
   gate passes for this reader, so the screen knows whether to fetch. The screen draws `NewsCover`
   first and lays the photo over it when the blob arrives. A 404, an error or a slow network leaves the
   generated cover, with no shift in layout.
6. The service worker already skips `/api/` (`sw.js:61-62`).

**What "at once" means here:** a takedown is refused on the next fetch, for everyone. A screen that is
already open keeps its blob until it re-renders or closes. Nothing survives on the device after that.

What this cannot stop: a screenshot. The room is kept small, there is no download or share control, and
a shared photo is an incident with a named kind (§10.7).

---

## 5 · The data shape

For `db/NN_news_covers.sql` (slices 1–2) and `db/NN_news_cover_pupils.sql` (slice 4). Hand-written
RLS, Opus. Nothing in db/01, db/09 or db/12 moves; nothing is dropped.

### 5.1 Capabilities (`capabilities.mjs`; `ADDED_SINCE_01` in `services/api/rls/generate-rls.mjs:525`)

| # | capability | level | held by | governs |
|---|---|---|---|---|
| C1 | `news.cover.upload` | 1 | coach, teammanager, media, sportsadmin, schooladmin, directorofsport | attach, pick, submit, withdraw one's own |
| C2 | `news.cover.approve` | 2 | directorofsport, schooladmin, sportsadmin | the review door, decide, withdraw any at the school. Level 2: the review shows who is picked and who cannot appear |
| C3 | `news.cover.pupils.view` | 1 | principal, directorofsport, schooladmin, sportsadmin, coach, assistantcoach, teammanager, medical, fitness, dso, media, analyst, player, guardian | being served a `pupils` photo on a post one already reads |

`superadmin` holds all three by its bundle; §5.3 cuts what a platform-wide assignment can do with them.
`separation.test.mjs` gains: every C1 holder holds a `news.publish.*` tier; `player`, `guardian`,
`selfaccess`, `spectator`, `scout`, `media` do not hold C2; `spectator`, `scout`, `unionselector`,
`official`, `scorer`, `driver`, `facilities`, `finance`, `sponsorship`, `transportcoordinator`,
`enquiry`, `competitionadmin`, `platformadmin` do not hold C3.

Two module flags, off by default, granted per school by the platform: **`news_cover_uploads`** and,
under it, **`news_cover_pupils`**. Each function asks `feature_enabled(key, school, person)` for the
**post's school**, which also honours the school's own suppression (`db/08:2500-2515`): a school can
switch covers off itself. The serve route is **not** put behind the dispatcher's per-caller module
gate: under it "off at any school you belong to is off" (`db/08:2521-2533`), and a parent with a child
at each of two schools would lose every cover (SCRBRD-120 departure 5).

### 5.2 Tables

**T1 · `news_cover`**

```
news_cover (
  id             uuid PK,
  post_id        uuid NOT NULL REFERENCES news_post ON DELETE RESTRICT,
  school_id      uuid NOT NULL → school,        -- stamped from the post by trigger
  scope          text NOT NULL CHECK (scope IN ('team','school')),   -- the post's, stamped
  team_code      text,                          -- the post's, stamped
  class          text NOT NULL CHECK (class IN ('none','adults','pupils')),
  state          text NOT NULL CHECK (state IN ('draft','submitted','approved','declined','down')),
  held           boolean NOT NULL DEFAULT false,
  object_key     text NOT NULL CHECK (object_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png)$'),
  sha256 text NOT NULL, bytes integer NOT NULL, width integer NOT NULL, height integer NOT NULL, mime text NOT NULL,
  rules_version  text NOT NULL,
  uploaded_by    uuid NOT NULL → app_user, uploaded_at timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  decided_by     uuid → app_user, decided_at timestamptz,
  returned_word  text CHECK (returned_word IN ('wrong_class','pupil_missing','rule_broken','poor_quality','names_pupils')),
  expires_at     timestamptz,
  down_at        timestamptz,
  down_word      text CHECK (down_word IN ('withdrawn','removed','expired')),
  purged_at      timestamptz,
  CONSTRAINT two_people        CHECK (decided_by IS NULL OR decided_by <> uploaded_by),
  CONSTRAINT approved_is_dated CHECK (state <> 'approved' OR (decided_by IS NOT NULL AND expires_at IS NOT NULL))
)
UNIQUE (post_id) WHERE state IN ('draft','submitted','approved')
INDEX  (post_id) WHERE state = 'approved'
```

- `ON DELETE RESTRICT`: a post with a cover row cannot be deleted, so no object is orphaned and the
  audit survives. `news_post.school_id` cascades from `school` (`db/12:27`); deleting a school
  therefore stops at its covers until the school's deletion runbook has purged every object. That is
  the intended order.
- A trigger on `news_post` refuses `kind` becoming `plan` while the post has a live cover.
- The post's scope, school, team and author cannot change (`db/84:45-57`), so the stamped columns
  cannot drift.
- There is no `down_by`. Who withdrew is on the event row when it was the uploader or an approver, and
  nowhere an ordinary reader can see when it was anyone else.

**T2 · `news_cover_subject`** — the picks.

```
news_cover_subject (
  cover_id uuid NOT NULL → news_cover, player_id uuid NOT NULL → player, school_id uuid NOT NULL,
  added_by uuid NOT NULL → app_user, added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz, removed_by uuid → app_user,
  PRIMARY KEY (cover_id, player_id)
)
```

Written only by `news_cover_pick()`. No typed name, ever.

**T3 · `news_cover_event`** — append-only, the ordinary audit.

```
news_cover_event ( id uuid PK, cover_id uuid NOT NULL, school_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('upload','pick','unpick','submit','approve','return',
                                         'decline','withdraw','down','expire','purge','purge_failed')),
  actor_id uuid → app_user,
  detail jsonb NOT NULL DEFAULT '{}',            -- counts and words only; never a player id
  at timestamptz NOT NULL DEFAULT now() )
```

For every cause in principle 6 (a family's removal, a consent, the mark, a boy no longer reading the
post, the authorisation ending, a DSO's remove) the row is `action = 'down'`, `actor_id` NULL. **A
report, a hold and a release write no row here at all.**

**T4 · `news_cover_restricted`** — append-only, the DSO's.

```
news_cover_restricted ( id uuid PK, cover_id uuid NOT NULL, tenant_id uuid NOT NULL,   -- by safeguarding_route()
  kind text NOT NULL CHECK (kind IN ('consent_ended','never_public','not_a_reader','authorisation_ended',
                                     'family_removed','report','hold','hold_renewed','release','dso_removed',
                                     'departure_tick','concern')),
  player_id uuid → player, actor_id uuid → app_user, concern_id uuid, word text,
  at timestamptz NOT NULL DEFAULT now() )
```

**T5 · the DSO's authorisation**: the kind `photo_authorisation` on `safeguarding_register`. That table
is SAFEGUARDING **phase 2** (`SAFEGUARDING_DSO.md:867-883`) and is not on main; slice 4 waits for it.

**T6 · `media_consent`**, `media_consent_set()`, `media_consent_live()`: SAFEGUARDING **phase 4**
(`:897-909`), not on main, not redesigned here. Slice 4 waits for it.

### 5.3 Policies

**The application has no SELECT on `news_cover` or `news_cover_subject`.** Every read is a function
that answers only what its caller may know:

| read | who | answers |
|---|---|---|
| `news_cover_state(post)` | the uploader of that post's cover; C2 at the school | **one display state**: waiting · approved · sent back: {word} · not approved · no longer shown. A held photo answers "approved". `held`, `down_word` and who acted are never returned |
| `news_cover_waiting(school)` | C2 at the school | the approvals list: post, side, class, age, the uploader, the picked pupils, F3's result |
| `news_cover_event` (table) | C2 or `audit.read` at the school | the rows of T3 |
| `news_cover_restricted` (table) | `safeguarding.concern.read` at `tenant_id`, nothing else | the rows of T4 |

`RESTRICTIVE` on all four tables: false under a support session, false for the pad's credential, and
**`NOT app_is_platform_wide()`**. Every function refuses the same three. So the owner's key reads no
cover, no pick and no event by standing, at any school.

**The information officer's door.** `news_cover_open_officer(cover, reason)`: a platform-wide
`superadmin`, a written reason of 20 characters or more, any state but held. It writes `access_log`
with `record_ids` the cover and its live picks before the bytes are fetched. It is the one way the
owner sees a photo, it is for an incident, and it is always logged. A held photo is the DSO's; in an
incident that involves one, the officer asks the DSO, as INCIDENTS §3.3 already routes S1.

One residual tell, stated plainly: an uploader who looks at his own post while its photo is held sees
the generated cover and the state "approved". He can infer a hold. He cannot learn who or why, and no
row he can read records it.

### 5.4 The view gate

An owner-run (`SECURITY DEFINER`) function bypasses RLS on the owner's tables, and an invoker function
called from inside one runs as the owner too. No table here forces RLS (`db/99:36978` treats forcing it
as a fault). `notification_report()` had to restate the read policies by hand for exactly this reason
(`db/101:232-269`), and db/123 and db/131 had to re-emit it each time the reach changed
(`db/131:63-66`). So the gate is two functions, in this order:

**`news_cover_serve(p_post)`: `SECURITY INVOKER`.** It runs as `scrbrd_app` for the caller.

1. `SELECT 1 FROM news_post WHERE id = p_post`. Every policy on the table decides, today's and any
   later one. No row: return nothing.
2. Only then: `RETURN QUERY SELECT * FROM news_cover_for(p_post)`.

**`news_cover_for(p_post)`: `SECURITY DEFINER`, narrow.** It reads the cover row and returns
`(object_key, sha256)` only when all of these hold:

- a floor of its own, so a route that called it directly is still bounded: the caller holds `news.read`
  at the cover's school;
- the post is published; the cover is `approved`, not held, not purged, `now() < expires_at`;
- `news_cover_uploads` is on for the school;
- the caller is not a support session, not the pad, not platform-wide;
- for `pupils`, also: `news_cover_pupils` on; the caller holds `news.cover.pupils.view` at the post's
  anchor; a live `photo_authorisation` for the season; and **for every live pick**:
  `media_consent_live(player, 'photo')`, no open never-public mark, no departure tick (§9.2), and
  **the boy still reads the post** (`news_post_reaches_player(post, player)`: a pupil of the school
  for a school post; of that side today, by db/117's dated side, for a team post).

The `pupils` conditions are judged at the second of serving, as PUBLIC_DATA §5a judges a name.

**The same entry rule for everything a reader touches**: `news_cover_report()` (F8), `news_cover_mine()`
(F11) and `news_cover_remove_mine()` (F7) are invoker entry points that select the post first and then
call their narrow definer. The read API's `news` resource computes `cover` per row inside its own
caller-run statement, over rows RLS has already admitted. A test asserts that no API module calls
`news_cover_for()` except through those entry points.

`news_post_reaches_player()` is the one place the read rule is restated about somebody else. It is
restated for a boy's side membership only, not for the reader's reach, and `db/99` proves it agrees
with what the boy's own account reads, for every boy in the fixtures.

The uploader's preview (`news_cover_preview()`, his own cover) and the approver's review
(`news_cover_open_review()`) are definers that check the caller directly. The review door writes
`access_log` (`resource = 'news_cover'`, `record_ids` the cover **and its live picks**,
`fields = {review}`) before the bytes are fetched, in its own committed transaction. Writing the picks
is what lets a child's "who read his record" include "an approver opened a photo of him".

### 5.5 The functions

| # | function | who | does |
|---|---|---|---|
| F1 | `news_cover_add(post, key, sha256, bytes, w, h, mime, class, rules_version)` | the post's author, holding C1 and the post's publish tier at its anchor; module on; the post not a plan; no live cover; hash not `previously_removed` | `draft` |
| F2 | `news_cover_pick(cover, players uuid[])` | the uploader; `draft`; class `pupils`; **each player passes `news_post_reaches_player()`** | replaces the live picks |
| F3 | `news_cover_check(cover)` | the uploader, or C2 at the school | the picked pupils who **cannot appear today**, by id, in one word, `cannot_appear`, whatever the cause. **Logged**: `access_log`, `resource = 'photo_consent'`, `record_ids` every pupil queried (Q7) |
| F4 | `news_cover_submit(cover, attest)` | the uploader; `draft`; every rule ticked; for `pupils`: at least one pick, the declared head count equals the picks, F3 empty, a live authorisation | `submitted` |
| F5 | `news_cover_decide(cover, approve \| return \| decline, word, attest)` | C2 at the anchor; not `own_cover`; not platform-wide; for approve: the rules ticked again, F3 empty, and for `pupils` §2.4's name count zero | `approved` with `expires_at`; or `draft` with the word; or `declined` and purged |
| F6 | `news_cover_withdraw(cover)` | the uploader, or C2 at the school | `down`, `withdrawn`; the event names the actor |
| F7 | `news_cover_remove_mine(post)` | invoker entry, then: a picked pupil, or a guardian with a live verified link to one | `down`, `removed`; T4 `family_removed`; T3 `down` with no actor |
| F8 | `news_cover_report(post, word)` | invoker entry, then: anyone the gate serves that photo to now | held; T4 `report`; the DSO's notice; once per person per cover |
| F9 | `news_cover_hold / _release / _dso_remove(cover)` | `safeguarding.concern.manage` at the holding tenant | held on or off, or `down` `removed` (bytes kept while a `concern` row is open) |
| F10 | `news_cover_open_dso(cover)` | `safeguarding.concern.read` at the holding tenant | the key; `log_restricted_read()` |
| F11 | `news_cover_mine(post)` | invoker entry | one boolean: the caller, or a child linked to the caller, is a live pick on the post's approved cover |
| F12 | `news_cover_sweep(school)` | the platform's daily run; and the API after any consent, mark, side, authorisation or departure write commits | every `approved` cover that fails the gate for a reason no reader's identity changes → `down`, T4 with the true reason, purge queued |
| F13 | `news_cover_purge_due()` / `news_cover_purged(cover)` | the daily run, and the route straight after any `down` or `declined` | the row first, committed, then the object; a store that fails is asked again. Skips a held cover, and any cover with an open `concern` row |
| F14 | a trigger on `news_post` | — | §2.4's edit rule; and a post withdrawn 14 days → its cover `down` |

Deleting on a clock follows the importer's precedent (`scorebook_import_purge_due()`), not lifecycle
D22's "nothing on a clock", which is about a child's identity record
(`ACCOUNT_LIFECYCLE.md:831`).

### 5.6 The routes

| route | door |
|---|---|
| `POST /api/news/:id/cover` | strips, stores, then F1; if F1 refuses, the object is deleted |
| `PUT /api/news/:id/cover/picks` · `GET …/cover/check` · `POST …/cover/submit` · `POST …/cover/decide` · `DELETE …/cover` | F2 · F3 · F4 · F5 · F6 |
| `POST /api/news/:id/cover/remove-mine` · `POST …/cover/report` | F7 · F8 |
| `GET /api/news/:id/cover` | the view gate, §4.3 |
| `GET /api/news/:id/cover/review` | the preview or the logged review door |
| `GET /api/news/covers/waiting` | `news_cover_waiting()` |
| `POST /api/safeguarding/covers/:id/hold \| release \| remove`, `GET …/:id` | F9, F10; under the safeguarding routes |
| `POST /api/platform/covers/:id/open` | the officer's door |

No route under `/api/public` touches any of this.

---

## 6 · The public wall

A signed-out reader sees **the generated cover**, on every surface, for every class. PUBLIC_DATA A8
decides it; GUARDIAN_TERMS says "never public … a photo" (`GUARDIAN_TERMS.md:28`) and stays true.

Each of these is a test that fails, none is a person's care. They land in the same branch as the serve
route (slice 1):

1. **No public read reaches a photo.** `public_news()` names its six columns (`db/83:273-286`); the
   cover is in its own table, which no `public_*()` function selects. A test in the public API's own
   tests lists the keys of `GET /api/public/news` and of the public post and asserts the exact set.
2. **The anonymous principal gets nothing from the gate**: step 1 finds no post row for him. `db/99`
   proves zero; and proves that a signed-in reader at another school, given a post id, gets nothing.
3. **`NEVER_PUBLIC` gains the four tables whole** (`packages/policy/src/public.mjs:139-175`; its test
   checks every entry against `db/`). `NEVER_PUBLIC_RULES` gains a key for A8, which is not one of
   N1–N5 today.
4. **The public bundle cannot draw one.** The photo layer lives in the signed-in app only and carries a
   unique marker (a test id, as `DISPLAY_MARKER` works). `tools/check-bundle.mjs`'s marker lists for
   the public graph (`:264-330`) and the home graph (from `:342`) gain it.
5. **The bucket is private**, reached only by the API with the service key.
6. **No link preview image.** No public shell carries `og:image` today (`apps/web/home.html:24-26`;
   `public-api.mjs:33`). A test asserts that none carries `og:image` or `twitter:image` except a
   static asset path.
7. **The pavilion screen, the overlay and the graphics pack have no photo slot** (SCRBRD-083 §5.3).
8. **A post with a photo may still be asked onto the home page.** Its text is judged as today (db/83,
   db/118); the public sees the generated cover.

---

## 7 · The screens, in words

Complex frontend that renders children's data: **Opus**, with interface-review and break-ui on the
diff, the 44 px and 12 px floors, and no new dependency.

**The composer.** Under the body: "Cover: generated", with the cover as it will look, and "Add a photo"
for a C1 holder where the module is on and the post is not a plan. Choosing a photo asks: "Who can be
recognised in this photo? Nobody · Adults only · Pupils of {school}". For `pupils`: a picker that
offers **only the boys who read this post** (the side for a team post, with the line "A boy from
another side? Put this photo on a whole-school post."), a head count, and the result of the check in
one wording (Q7). Then §2.3's rules as ticks, the DSO's conditions above them, and "Send for
approval". Above the photo: "Your notice goes out now with the generated cover. The photo joins it
once someone else at the school has approved it."

**The author's row on his post.** "Photo: waiting for approval · approved · sent back: a pupil is
missing · not approved · no longer shown", and the one button the state allows.

**The approvals card.** For C2 holders, the shape of the public approvals card: the photo large, the
post's headline and audience, the declared class, for `pupils` the picked names and the count, "Everyone
picked may appear" or who cannot, the rules as ticks, Approve / Send back / Decline.

**The feed and the article.** The generated cover draws first; the photo fades in over it when its blob
arrives (no fade under `prefers-reduced-motion`). `alt=""`: the cover stays decorative, so no
description field exists to carry a name. Under the article's cover: "Report this photo" for any reader
who sees it; for a picked pupil or his parent, "Remove this photo", which asks once in the page
("Remove this photo from the post? Nobody is told why.").

**The parent's action list (GA-I20).** One item per child while no photo consent is recorded.

**The DSO's Safeguarding screen.** "Photos": reported and held photos with the reporter, the word, the
hold's age; Release, Remove, Renew. And the season's authorisation with its conditions.

**Settings → School.** The two switches as granted, the school's own off switch, and counts of pupils
with and without a photo consent (counts, no names; a small function of slice 4, not
`stream_readiness()`, which is about filming).

---

## 8 · Slices for Opus, in build order

Haiku maps the ground first (the news API, the `news` read in `read-api.mjs`, `page-image.mjs`,
`roles.mjs`, which of SAFEGUARDING's phases are on main), and records Kameel's answers word for word.

**The module is granted to no school until slice 3 has merged**: a reader must have Report before any
photo shows (CSA SG-9 rule 4).

| # | slice | tier | carries | proof |
|---|---|---|---|---|
| 1 | **The record, the store, the gate and the public wall.** C1, C2, T1, T3, the flag, the second bucket, F1, F4–F6 for `none` and `adults`, the two-function gate, the purge clock, the upload and serve routes, and §6's tests in the same branch | Opus | `db/NN_news_covers.sql`, policy package, `object-store.mjs`, a cover API module | `db/99`: every zero of §11 that slice 1 can prove, with B1's zero first (another school's reader holding a post id gets nothing); `separation.test.mjs`; a smoke: upload → the uploader cannot approve → approve → served → withdraw → 404 and the object gone |
| 2 | **Takedown, report, the DSO, the restricted record.** T4, F8–F10, the sweep for expiry and module-off, the hold under a concern, the officer's door, the uploader's `system` notices | Opus | the same migration if slice 1 has not shipped | a report hides at once; the notice names nobody; T4 reads zero to the office, the owner and a support session; `news_cover_state()` answers the same for a held and an unheld photo; a held photo is not purged |
| 3 | **The screens for slices 1–2.** Composer, author's row, approvals card, the blob over the generated cover, lazy fetch, Report, the DSO's Photos list | Opus | `NewsView.jsx`, a `CoverPhoto` component outside the public bundle | browser and a11y walks; break-ui (a panorama, a portrait, a 404 mid-load, a slow network, 100 posts) |
| 4 | **Pupils, the SQL.** C3, T2, T5's kind, F2, F3, F7, F11, the `pupils` conditions of the gate, `news_post_reaches_player()`, §2.4's name rule, the sweep's consent branches, the `media` notice kind (NOTIFICATIONS D1's CHECK, `KINDS` in `packages/policy/src/notifications.mjs` and its test), the consent counts. **After SAFEGUARDING phases 2 and 4 are on main** | Opus | `db/NN_news_cover_pupils.sql` | one of eleven consents withdrawn takes the photo off on the next fetch for every reader; the mark does; a boy changing side does; the authorisation ending does; a follower gets 404; a boy of another side cannot be picked on a team post; a parent of an unpicked boy cannot remove; F3 says one word for every cause and writes its log row |
| 5 | **Pupils, the screens.** The picker, the family's "Remove this photo", the consent card's sentence, the action-list item, the family's notice | Opus | `NewsView.jsx`, `apps/web/src/views/family/` | browser and a11y walks; a pupil's and a parent's walk end to end |
| 6 | **Lifecycle, access, incidents, restore.** Each part lands **when the thing it leans on lands**; none is on main today: the `retention.mjs` entry (lifecycle D22), `player_minimise()`'s call (D24), the departure form's tick (lifecycle §3.4), the access pack's row (ACCESS_REQUESTS' pack function), the register's kinds (INCIDENTS §7). The restore step and the off-boarding item need none of them | Opus for code; Haiku for the documents | small | the pack of a boy with a held photo and of a boy without one are the same shape; the restore drill |

Slices 1–3 are useful alone: grounds, trophies, scoreboards, the coach. A child's face enters at
slice 4, last on purpose.

---

## 9 · Retention, deletion and the lifecycle

### 9.1 The clock

| what | keep | then |
|---|---|---|
| an approved photo's bytes | **12 months from approval** (Q5) | deleted; the post shows its generated cover |
| a draft untouched | 14 days | abandoned and deleted |
| a declined photo; a photo taken down | — | deleted at once |
| a held photo | while held; 90 days unless renewed; **no lapse while a concern names it** | deleted on removal or lapse; under a concern, with the concern (SAFEGUARDING §4.7) |
| `news_cover`, `news_cover_event`, `news_cover_subject` rows | 5 years, with the access log | deleted. A pick carries a player id and no name |
| `news_cover_restricted` rows | SAFEGUARDING §4.7's periods where a concern refers to the cover; otherwise 5 years | deleted |

When `retention.mjs` exists (D22), this table is its entry and D22's test demands it.

### 9.2 What each lifecycle event does to a cover he is picked in

| event | effect | why |
|---|---|---|
| **photo consent withdrawn** (guardian, or the pupil from 12) | refused on the next fetch; the sweep takes it down and deletes it. One "no" among eleven removes the whole photo | principle 4; PUBLIC_DATA C3 inside the app |
| **a guardian's link revoked** | her consent no longer counts; if no other live consent stands, as above | db/47's reading |
| **the never-public mark set** | as a withdrawal; nobody but the mark's holders learns why | C5 |
| **he changes side** | a team post's photo he is picked in comes down: he no longer reads that post | the pick rule (§2.2) |
| **he turns 12** | his own record is now needed (K1); until he gives one, photos he is in are not served | SAFEGUARDING §6.1 |
| **he turns 18** | his own record governs (C6) | as public names |
| **he leaves the school** | he no longer reads the school's posts once his side ends, so photos he is picked in come down with his departure. The departure tick (when the form exists) takes them down at once instead of at the side's end date | the pick rule decides it; no separate lifecycle rule is needed |
| **his record is minimised** (D24, when built) | calls the sweep for him first | a belt; the bytes are years gone |
| **the uploader or approver leaves or is disabled** | approved photos stay (they are the school's); his drafts are abandoned and purged; his submitted photos stay in the approvals card | staff leaving does not unpublish the school's news |
| **the post is withdrawn** | not served; after 14 days the cover is taken down and purged | |
| **the post is edited** | the approval stands unless §2.4's name rule sends it back | the picture did not change |
| **the school is suspended or archived** | the module is off with the school; the clocks keep running | PLATFORM_CONTROLS |
| **a database restore** | before the API opens: (1) **every approved `pupils` cover goes back to `submitted`**, because a hold or a removal made after the dump is lost and its photo would be served again; (2) the sweep runs for every school; (3) **bucket objects with no row are listed and deleted** (uploads after the dump); (4) the DSO re-applies holds from the DSO's own records, by hand, as INCIDENTS D21 says of every withdrawal (`INCIDENTS_AND_BREACHES.md:553-560`). The steps go into the D21 note and `BACKUP_RESTORE.md` | a restore must never show a child's photo that had been taken down |

The earlier draft of this design kept a leaver's photos to their date. The pick rule now takes them
down when he stops reading the post, which is simpler and stricter, and needs no decision of its own.

---

## 10 · Where it touches each existing design

### 10.1 SCRBRD-092 and CSA SG-9 rule 5

SCRBRD-092 lists what must exist "before any photo feature". Mapped:

| SCRBRD-092's deliverable | here |
|---|---|
| the consent records (a migration) | `media_consent`, SAFEGUARDING phase 4; before slice 4. K1 already changed its giver rule from "the pupil from 18" to "the pupil from 12" |
| the sign-up consent screen, separate opt-ins, off by default | STEP4's Consents card exists (`apps/web/src/views/family/`); slice 5 adds the photo opt-in and its sentence to it and to the action list |
| a plain-language privacy notice | the guardian's terms gain a sentence, as a new version (§10.11); before the `news_cover_pupils` flag is granted anywhere |
| a data processing agreement template for schools | **exists nowhere.** It is a document for Kameel or an attorney, not a slice. No school is granted `news_cover_pupils` before it is signed with that school |
| the wording to the information officer or a POPIA attorney | Kameel's, before slice 5 ships |

**CSA SG-9 rule 5** says "No photos in messages until SCRBRD-092 exists"
(`CSA_SAFEGUARDING_CHECK.md:549`); a team post is a message to the side under SG-9
(`NOTIFICATIONS.md:202`); SCRBRD-138 phase B repeats the rule. Slices 1–3 put `none` and `adults`
photos on team posts **before** SCRBRD-092's consent work exists. That lifts a rule Kameel has relied
on, so it is Q1. If he says no, slices 1–3 ship for school posts only and team posts wait for slice 5.

### 10.2 PUBLIC_DATA

Nothing in §1–§4 changes. §5a gains one paragraph pointing at §6 here.

### 10.3 SCRBRD-142 and SCRBRD-083

SCRBRD-142 §3.3's row "A photo or video: `news_post` has no image column" stays true and gains "and
the cover tables are on `NEVER_PUBLIC`". SCRBRD-142 §6.4's empty `HERO_PHOTO` slot is not this
design's. SCRBRD-083's "no photo slot" lines stand.

### 10.4 SAFEGUARDING_DSO

- Phases 2 (the register) and 4 (`media_consent`) become dependencies of slice 4 and can no longer
  wait for SCRBRD-104.
- `safeguarding_register` gains `photo_authorisation`; `safeguarding_concern_raise()` gains the
  optional cover reference.
- The cover's restricted rows follow §4.2's three layers and §4.3's hidden log rows.
- K1's Q7 (the office recording a pupil's assent from a form) applies as it stands.

### 10.5 NOTIFICATIONS

- **No image ever travels in a notice or a push.** `buildPayload()` stays D14's pointer.
- **The uploader**: kind `system`, by `recipient_id`, medium: "A photo on one of your posts was
  approved." / "…was sent back." / "…was not approved." / "…is no longer shown." No child, no reason;
  nothing on a hold. D2's `system` row (`:84`) gains this writer.
- **Approvers**: the approvals card only.
- **The DSO**: the `safeguarding` notice of §3.5.
- **A picked pupil's guardians** (Q6): a new kind, `media`. Its D2 row: writer `news_cover_decide()`
  on approval; `required_capability` `news.read`; audience one row per live guardian by `recipient_id`;
  urgency medium; pushed, preference allowed; retractable by the system, `superseded`, with no
  "withdrawn" notice (telling eleven families that one of them said no is the wrong notice); lives 60
  days. Body: "A photo that includes your child is on {school}'s news." Opening it opens the post,
  which the pick rule guarantees she can read. Never to a pupil (SG-9).

### 10.6 READERS_child_data

A new class, **T2 · Cover photos**: the bytes (level 2), the picks (level 2), the restricted rows
(level 4). **G8 is closed by Q2.** One new read of class K (consents) is created, for Q7: an uploader
and an approver learn that a named pupil cannot appear. A coach learns it only for his own side; a
school-post publisher (media, the office, the sports administrator, the director) for any pupil of the
school. That touches G9 for `media`, which gains C1 and C3 and this one word, and no C2.

### 10.7 INCIDENTS_AND_BREACHES

| what happened | kind (D2's list) | severity |
|---|---|---|
| an uploaded photo on any signed-out surface | `wrong_public` | S3; **S1** if a child in it carries the mark |
| a photo served to a reader §3.3 would not admit, or after a withdrawal | `wrong_read_rule` | S3; S1 as above |
| an approved photo that showed a pupil who was not picked or had no consent | `other`, text "cover photo" | S3; S1 as above |
| a reader shares a cover outside the platform | `page_shared` | S3; S1 as above |
| the bucket or a service key exposed | `secret_exposure` / `provider` | S2 |

The subjects list for a cover event is the picks, plus any pupil a report named. The kill switch joins
§6.1's table: "`news_cover_uploads` off: by the school itself, or by the platform for one school or
all; at once; every post shows its generated cover". Whether each view of a `pupils` photo is logged is
Q8; without it a `wrong_read_rule` event can say who could have seen a photo and not who did.

### 10.8 ACCESS_REQUESTS

A row in §4's table, after T (`:152`):

| # | class | parent's pack | pupil's pack (18+) | other people | why |
|---|---|---|---|---|---|
| T2 | cover photos | for each cover he was picked in: the post's date and audience, "a photo that included him was shown from {date} to {date}", "removed" or "deleted on {date}"; **the picture itself out**, fixed sentence | the same | the other pupils: out; uploader and approver by role | a photo with other children in it is other children as people |

A cover that was reported, held or removed by the DSO appears exactly as any removed cover; T4 is in no
pack; the fixed sentence appears in every pack. Row S of the pack (the access log) carries the review
door's and F3's rows about him, because both now write his id.

### 10.9 ACCOUNT_LIFECYCLE

§9: the retention entry, the departure tick, the off-boarding item, `player_minimise()`'s call, each
when its host exists.

### 10.10 SCRBRD-120 and the store

The adapter gains a second factory and `list`; `sanitisePage()` is shared, not copied. The importer's
bucket, clocks and readers are untouched. No cover is sent to the scorebook reader or to any model.

### 10.11 The guardian's terms, GA-I20, PLATFORM_CONTROLS

The terms (`popia-2026-01`) gain one sentence when slice 5 ships, as a new version: what a photo is
used for, who sees it, for how long, and that she or her child can remove any photo at once. The action
list gains the consent item. The two flags are homed with PLATFORM_CONTROLS; "no grant of
`news_cover_pupils` to a school without a DSO" is a trigger on `feature_grant`, which is that design's
to own.

---

## 11 · What must never be possible

Each is a `db/99` zero or a test, named in the slice that brings it.

1. A signed-out request receiving any byte of an uploaded photo, or any field that says one exists.
2. An uploaded photo on the public home page, a public post, the pavilion screen, the overlay, a
   graphic, a link preview, a push or an email.
3. A reader who cannot read a post being served its cover, told it has one, or able to report it,
   because he holds its id.
4. A response carrying a photo that a browser, Firebase Hosting or any cache may keep.
5. A photo seen by any reader before a second person approved it; a person approving a cover he
   uploaded, picked for, or wrote the post of.
6. A pupil or a parent uploading, picking or approving.
7. A cover on a competition post or a plan.
8. A `pupils` photo served while any picked pupil lacks a live photo consent, carries the never-public
   mark, no longer reads the post, or the season's DSO authorisation is not live. Or served to a reader
   without `news.cover.pupils.view`.
9. A pupil picked who does not read the post; a typed name; another school's boy.
10. A child's name on, beside or under a photo: a caption, or the words of a post carrying a `pupils`
    photo.
11. A family unable to open a post their child's photo is on, or unable to remove that photo at once.
12. An uploader, an approver, the office, `audit.read`, the owner's key or a support session able to
    read why a photo is hidden, who reported it or who removed it.
13. A support session or the pad's credential served any photo, pick or event; the owner's key reading
    any of them outside the one logged door.
14. Bytes kept after a takedown (unless held by a DSO), after decline, or past `expires_at`; an
    original with EXIF or GPS stored anywhere; a held photo purged while a concern names it.
15. A photo sent to any third party beyond the two processors already in the path.
16. A post held back, withdrawn or refused an edit because of its photo.
17. A surface that does not fall back to the generated cover.
18. A restore that serves a photo taken down or held after the dump.

### Assumptions, for Opus to confirm

- **A1.** db/117's dated side can be asked about a boy ("is he of this side today") by an owner-run
  function without restating a reader's reach. If it cannot, `news_post_reaches_player()` needs its own
  design note before slice 4.
- **A2.** `safeguarding_concern_raise()` can take one more optional argument without breaking its
  callers; else the cover's id travels in `p_subject_text`.
- **A3.** 90 days for a hold, 14 days for a draft, 3 MB, 1280 px, 800 × 450, 5 years for the rows: mine,
  and cheap to change.

Confirmed by the review and no longer assumptions: a post's anchor is frozen (db/84); `public_news()`
names its columns; `media_consent`, `safeguarding_register` and `stream_readiness()` are not on main;
the service worker skips `/api/`; the role keys exist.

---

## 12 · Questions for Kameel

Eight. Each is a closed call; the body assumes the recommendation.

| # | the call | recommendation |
|---|---|---|
| **Q1** | **Is this design the first part of SCRBRD-092, and may photos with no pupil in them (`none`, `adults`) go on team posts before 092's consent work exists?** That lifts CSA SG-9 rule 5 ("no photos in messages until SCRBRD-092 exists") for those two classes only | **Yes to both.** A photo of a ground or a coach needs no child's consent, every one is approved by a second person, and Report is built before any photo shows. If no: slices 1–3 ship for school posts only |
| **Q2** | **Who sees a photo that shows pupils:** (a) the school's own people among the post's readers: staff, pupils, parents; or (b) everyone who reads the post? Since db/131, (b) includes every follower at the school on every side's team posts | **(a).** SCRBRD-092's words are "registered users"; a follower is registered and still someone the school may never have met. It closes READERS G8 |
| **Q3** | **The DSO's part in pupils' photos:** (a) one authorisation per season with conditions, as K2 does for the stream; (b) the DSO approves every photo; (c) no DSO step | **(a).** CSA p32 item 4 asks that media be available to the DSO, who may deny its use: the DSO sees every pupils photo and holds the remove. (b) makes the DSO a picture desk |
| **Q4** | **The other school's children in a photo: never, in this version?** It rules out most action shots with the opposition's keeper or bowler in frame | **Never.** No consent of theirs exists here. Team photos, celebrations and our own batter alone remain |
| **Q5** | **How long an approved photo is kept:** 12 months from approval, then the bytes are deleted | **12 months**, one number for every class; the number is the information officer's |
| **Q6** | **Are a picked pupil's parents told when a photo that includes him goes live?** It needs a tenth notice kind, `media` | **Yes.** A right to remove a photo is worth little to a parent who never learns it exists. She can always open the post: only boys who read it can be picked |
| **Q7** | **When a picked pupil cannot appear, is the uploader told which pupil, in one word that never says why?** This gives a coach one fact about consent for boys of his own side, and a school-post publisher (media, the office, the sports administrator, the director) the same for any pupil of the school. Each check is logged against each pupil asked about, so a family can see it was asked | **Yes, name him.** A count sends the uploader picking boys one at a time to find out. The one word covers no answer, a refusal, a withdrawal, his own no and the mark alike, so the mark stays hidden. The alternative is the count only |
| **Q8** | **Is each view of a pupils' photo logged?** One row per reader per photo per day, against each picked pupil. INCIDENTS D18 logs every single-record read of a child's file; without the row, a wrong-read incident and a parent's "who has seen him" can say who could have seen a photo, not who did. The cost is volume: a team photo to four hundred readers is four hundred rows that day | **Yes, for `pupils` only.** `none` and `adults` photos are not logged |

Decided in the body without a question; say so if any is wrong: a report hides the photo at once
(§3.4); a pupil removes a photo of himself at any age (§3.4); no covers on competition posts or plans in
this version (§2.2); only a boy who reads the post may be picked (§2.2); a post's words may not name a
pupil beside a pupils' photo (§2.4); `media` uploads and does not approve (§3.2); no caption and no alt
text (§7); public pages show generated covers only (A8, §6).
