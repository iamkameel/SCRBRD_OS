# A pupil's photo on public pages: changing rule A8

**Status:** design, decided by Kameel on 20 Nov 2026 (all ten calls in §12 as recommended); nothing is built; A8 stands for the pilot; the build waits until after the pilot and until counsel answers §13, and the information officer re-signs PUBLIC_DATA.
**Kameel's decision this answers (18 Nov 2026):** "Change the rule: public profile shows a photo."
**Read, all at `origin/main` (3b80b4d2, 20 Nov):** `docs/policy/PUBLIC_DATA.md`; `docs/design/PUBLIC_BY_TERMS.md` (PBT below); `GUARDIAN_TERMS.md`; `CONSENT_V2.md`; `CLAUDE.md`. By search only: `packages/policy/src/public.mjs` (the surfaces table), `services/api/io/object-store.mjs` and `page-image.mjs` (headers), `services/api/read/ground-names-api.mjs` (header), `services/api/public/public.test.mjs:208-220`.
**Not read, cited only through PBT:** `SAFEGUARDING_DSO.md`, `ACCESS_REQUESTS.md`, `INCIDENTS_AND_BREACHES.md`, `ACCOUNT_LIFECYCLE.md`, `NEWS_COVER_UPLOADS.md`. Where this design leans on them it says "per PBT".
**The law here is my reading, not advice, and I searched nothing.** §13 is counsel's.
**No child's name appears.** "T Bekker" is the consent screen's own placeholder.

---

## 0 · Recommendation

Photos should wait until after the pilot, and nothing public should be built for them before counsel answers. A face is the one detail that lets a stranger recognise a child in person, and beside his name, school, team and a public fixture list it says who he is, what he looks like and where he will be on Saturday. When photos do come, I recommend the smallest version that is honest about that: one head-and-shoulders portrait per boy, shown only beside a name the public page already shows, only on a finished scorecard and the school's honours board, never while a match is being played, never on the ground display, a stream, the home page or a link preview. It needs its own explicit yes to that exact picture from **every** guardian linked to him, his own agreement from twelve, a check by a second person at the school, seven days in which the DSO sees the list, a floor of the U14 age group, and a yes that ends each year. It never takes the by-terms route. Any one of those people can take it down at the next request. A copy someone has saved cannot be recalled, and the consent says so before the yes.

---

## 1 · What exists today, and what "public profile" means

- **No photo of a player is stored anywhere.** The app draws initials in a disc (`Avatar`, `ui/primitives.jsx:110`). The Google account picture is never kept (`firebase-verify.test.mjs:72`). The only stored images are scorebook pages, in a private bucket the API proxies, with metadata stripped (`object-store.mjs`, `page-image.mjs`).
- **No media consent exists.** `media_consent` is designed (per PBT §1.3) and not built.
- **There is no public profile page.** A4 says "a public page per player: never", and the terms promise "never … a page about him". In the code, "has a public profile" means "the public page would name him" (`ground-names-api.mjs:3-4`, Kameel, 12 Nov). A profile is "set public" today by the name switch on Family → Consents, or the office's record from a form (`public_name_consent_set()`), read through `publicName()`.
- **Promises that say "never a photo":** A8; rule 4; the terms `-01` sentence 22 ("never public, whatever anyone agrees"); the public-name wording v1 and v2 (sentences 1 and 3); PBT's notice and its must-never 9; `public.mjs` (`A8 … "never"`); a test that fails if the word "photo" appears in public JSON.

**So I have read Kameel's words as:** where a family has set their boy public (he is named), a photo may sit beside that name. I have **not** designed a public page per player. That would reverse A4 and a second promise in the terms, and it gathers a child's face, name and figures in one place. It is Q1.

---

## 2 · What the photo is, and where it may appear

### 2.1 The picture

One portrait per boy per school. Him alone, head and shoulders, facing the camera, plain or blurred background, square, at most 512 pixels a side and 1 MB. Cricket whites, school cricket kit or uniform. Not allowed: another person, any part of one; a name on clothing or a name tag; a house, street, vehicle, number plate or anything that says where he lives; a team photo cropped; anything not clothed as for a match; a screenshot from social media. One picture, never a gallery, never video.

**Uniform and crest.** I recommend kit and crest are allowed. The page already names his school beside him, so the crest tells a visitor nothing new, and a rule against it could not be kept by any school photographer. Its cost is that a copied picture carries his school with it. Q8.

### 2.2 Surface by surface

| surface | photo? | why |
|---|---|---|
| **The finished scorecard** (PBT's `card`) | **yes**, small, beside his name | the match is over; the page says nothing about where he is |
| **The school's honours board** (`board`, R11, not built) | **yes**, beside his row | the school chose the honour; fewest boys; not tied to a fixture |
| **The live page while play is on** (`live`) | **never** | it shows the ground and the time. A face and a name there tell a stranger which child to look for, where, now. No yes buys this in v1 |
| **The ground display and the big screen** | **no** | they are live surfaces; the pavilion display follows the public live rule (per PBT §2.4). The crowd can see the boy; the screen would tell them his name |
| **The stream overlay** | never | D2: no child is even named there |
| **The home page `/`** | never | it is indexed and names no child (rule 7) |
| **A link preview** (WhatsApp and others) | **never** | the preview image and title stay team facts (`shellTitle()`). A preview is copied to the other service and into every chat it is sent to, and cannot be recalled. A test asserts no public shell ever carries a child's picture as its preview image |
| **Search engines** | not listed | pages stay `noindex`; they gain `noimageindex`; the image itself answers `X-Robots-Tag: noindex, noimageindex`. Not every crawler obeys. §6 says what is done if one does not |
| News posts, a shared milestone card, an access pack about another child | no | news stays signed in; the other two leave the platform |
| **Signed in** | only his family, the uploader, the checker and the DSO | whether team-mates, coaches or the other school see it is A8's old note ("registered users"), and a design of its own. Q10 |

**The photo never appears without the name.** It is drawn only where the gate (PBT §5.1) names him on that surface that day. Beside "Batter", or beside the masked "R ••••••" decided on 18 Nov, there is the initials disc, the same for every boy. There is no "photo withheld" state: a boy with no picture, a boy refused one and a boy under a mark look the same, and with this consent most boys will have none.

---

## 3 · Who consents, and how

### 3.1 The rule

A photo is shown on a surface only when **all** of these hold. A missing fact is a no.

1. The gate names him on that surface today (so: published, no mark, names on, no standing no).
2. The platform's photo setting is on, his school has adopted photos, and photos are not switched off for his age group. His age group is U14 or older (Q5).
3. There is one approved picture for him at this school (§4).
4. **Every guardian with a live, verified link to him** has a standing yes to **that picture** for that surface, at the current wording. A guardian linked later stops the photo until she answers.
5. **From twelve, he has agreed to that picture himself**, in his own account or on a signed form the office records.
6. Nobody's no stands: any guardian's, his own, the office's on the family's word. A no counts whatever later happens to its giver's link (PBT B2).
7. Seven days have passed since the last of 3, 4 and 5.
8. The yes has not run out: it ends on 31 December of the year it was given, on his eighteenth birthday, and on the day he leaves the school.

Line 1 means a name by terms is enough for the name. The photo itself **never** has a default: it is `chose_on` or nothing, on tier A, B and C alike (PBT must-never 9 stays).

### 3.2 The choices in it, and why

- **Every guardian, not one.** For a name, one yes is enough and the latest answer governs. I recommend a photo needs each linked guardian, because it cannot be taken back once copied, and because the commonest serious harm is one parent publishing where the other has reason to keep the child from being found. A parent who is not on SCRBRD cannot be asked; the seven days, the school's check and the DSO's list are what stand for her (§7). Q4; counsel §13.2.
- **His own agreement from twelve.** PUBLIC_DATA gives him a no from twelve and a yes from eighteen. This does not change that: his agreement is needed **as well as** his guardians' and never instead of it, so it is a second lock, not a consent in law. His face is his in a way a scorecard line is not, and CSA's Annexure C is a form the child signs (per PBT §1.2). A boy with no account agrees on that form. Q5.
- **An age floor.** No public photo below the U14 age group. With the floor, every photographed boy is old enough to have agreed himself. Q5.
- **The yes is to one picture.** The record holds the picture's hash. A new picture needs every yes again.
- **The record:** who (the link), which picture (hash), which surfaces, the wording version (`public-photo-YYYY-MM`, named at issue), the notice hash held by the server, the time, and the terms version her link was at. Never deleted; end-dated with a reason.
- **The terms come first.** A guardian on `popia-2026-01` was promised "never a photo, whatever anyone agrees". Her photo yes is accepted only once her link is at a terms version that carries §9.2's sentence. She is shown that change and agrees to it on the same screen, before the photo question. It never blocks selection (PBT §4.4).
- **The office** may record a guardian's yes only from a signed form that carries the photo wording and a print of the picture, naming the form and its date. It may record a no on the family's word.
- **At eighteen** the picture comes down on his birthday. It returns only on his own yes; then only his records count. Stricter than names (C6), because the picture was chosen for him.

### 3.3 A pupil who objects

| he is | his route | effect |
|---|---|---|
| under 12 (no public photo under the floor anyway) | tells a parent, a teacher or the office | the office records a no on his word alone |
| 12 to 17 | "Take my picture down" on Me → Privacy; or tells the office or the DSO | down at the next request, whatever any guardian says. A later yes from him needs no form (it restores a second lock, and his guardians' yes must still stand). The name's rule (PBT Q6) is untouched |
| 18 or over | Me → Privacy | his alone |

His off never reaches a coach's, selector's or captain's screen (PBT must-never 8). His screen says before he taps: "Nobody at the school is told you did this."

---

## 4 · Who uploads, and who checks

**Upload.** A verified guardian, from Family → Privacy; or the office, from the school's own portrait day. Never the pupil, a coach, a scorer, a URL or the Google picture. The browser crops to a square and re-draws it at 512 pixels, which drops the camera's metadata; the server checks the file by its bytes (JPEG or PNG only), its size and its dimensions, and strips metadata again with `page-image.mjs`'s method (GPS, device, owner, comments). The uploader ticks "I took this picture or have the right to use it" (a school photographer's portrait is the photographer's; §13.8).

**Check.** A second person at his school, never the uploader, holding a new capability `player.photo.review` (the office by default). The checker opens the picture through the API, logged, and answers a fixed list:

1. It is this boy (the office knows him; a parent could send the wrong child).
2. Him alone, head and shoulders; no other person in any part.
3. Dressed as §2.1 says; no name on clothing.
4. Nothing that says where he lives or travels.
5. Not a crop of a team photo, a screenshot or an old picture.

Any "no" rejects, with one of five fixed reasons shown to the uploader and no free text. A rejected file is deleted after seven days.

**What is never done with a picture.** It is never sent to the AI service or any other processor, never matched, never used to recognise anyone, and no face template is ever made. The design has no automatic content check; a person looks.

**An indecent or worrying picture.** The checker does not reject it in the ordinary way and does not forward it. One button, "Send to the safeguarding officer", holds the file where only the DSO can open it, and the school's Safeguarding Policy takes over, including any duty to report (§13.10).

**The DSO** does not approve each picture. The DSO's pre-publication list (PBT §3.3) gains every boy whose picture is due in the next seven days, and the DSO's home shows the count.

---

## 5 · What each person sees

### 5.1 The consent screen (Family → Privacy → Picture), as a draft for counsel

Shown only once the picture is approved, with the picture itself at the size the public will see it.

> **Show this picture of T Bekker on public pages**
> [the picture]
> 1. If you say yes, this picture is shown beside "T Bekker" to anyone who has the link, on the pages you choose:
>    **Scorecards after a match** `[ Off ]`   **The school's honours board** `[ Off ]`
> 2. Never while a match is being played, never on the screen at the ground, a video stream, or the picture that appears when a link is shared.
> 3. **A picture cannot be taken back once someone has saved it.** We take it off our pages at once; a copy, a screenshot or a forwarded picture is beyond our reach. With his name, school and team, a picture lets a stranger recognise him.
> 4. It is shown only if every parent or guardian linked to him here says yes to this picture, and he agrees himself. One no is enough.
> 5. It starts seven days after the last yes, and the school can keep any picture off its pages without saying why.
> 6. Your yes ends on 31 December, when he turns eighteen, or when he leaves the school, whichever is first. A new picture needs a new yes.
> 7. Any of you can take it down at any time, here or by telling the office. He can take it down himself. Saying no changes nothing else: he is picked, scored and honoured the same.
> 8. We keep the picture file until 30 days after it comes down, or delete it at once if you ask. We keep the record of each answer.
>
> `[ Yes, show this picture ]`   `[ No ]`

Both switches start off. The button is disabled until sentence 3 has been on screen. The pupil's screen (Me → Privacy) has the same picture and sentences 1 to 3 and 7 in his words, with "I agree to this picture" and "No".

### 5.2 State lines (one fact each, as PBT §2.3)

- "Waiting for the school to check the picture."
- "Waiting for the other guardian's answer." / "Waiting for T Bekker's own answer."
- "Shown from 9 Feb 2027 on: scorecards after a match."
- "Off since 3 Mar 2027, taken down by you." (or "by the other guardian", "by T Bekker", "by the office, on the family's word")
- "Ended on 31 Dec 2027. Choose a picture for the new year."
- "The school is not showing his picture. Ask the office." **One string for every school-side cause:** a mark, a DSO hold, names or photos off for his age group, the school or platform switch, the age floor. It never says which (PBT §2.3, C5).

When one guardian answers, every other verified guardian gets a quiet action-list row and a notice whose push names nobody: "There is a picture question about T Bekker for you to answer."

---

## 6 · Taking it down

**Who can, at once:** any guardian; the boy from twelve; the office on the family's or the boy's word; a holder of the never-public mark; the DSO, by a mark or by a **photo hold** on one picture with no reason recorded; the school (photos off for an age group or the whole school); the platform (one logged setting, off everywhere). The platform and its support staff can never turn a child's picture on.

| where the picture was | what happens | how fast |
|---|---|---|
| the scorecard and the board, past pages included | the rule is judged on the day served; the public JSON stops carrying the picture's token | the next request; 60 seconds at most if an API instance's listener is down (PBT §2.4, slice 2's ceiling) |
| the picture's own address | the route checks the same rule on every request, so an address already loaded stops answering. The address is a token that changes each day, so yesterday's saved link is dead in any case | the next request |
| a browser or anything between | every response carrying a picture or its token is `no-store`; the picture is served only by the API, never from a storage address, and refuses to be embedded on another site (`Cross-Origin-Resource-Policy`) | nothing to drop |
| a link preview | there never was one (§2.2) | none |
| a search engine | not indexed by instruction. If a picture is ever found in one, the school's information officer uses that engine's removal request, the family is told, and it is an entry in the incident register | days; not in our hands |
| a screenshot, a saved or forwarded copy, another site | **beyond reach.** The consent says so in bold before the yes. The school's officer will write to a site that hosts a copy if the family asks, and can promise nothing | never |
| the file | hidden at once; deleted 30 days after it stops being servable, or at once on "Delete the picture now" | 30 days or now |

A take-down writes a record and deletes none. Putting a picture back needs fresh answers and a fresh seven days.

---

## 7 · A child's safety

**The combination, plainly.** A public scorecard would show a face, "T Bekker", his school and "U14A". The indexed home page lists that team's next fixture with its ground and time where the school lists it. Together they tell a stranger who to look for, what to call him and where he will be. Each fact alone is already public or harmless; the face is what joins them. Nothing in software removes this. The design narrows it:

| measure | what it does |
|---|---|
| never on a live surface, never before a match ends | the picture is never on the page that says where he is now |
| the U14 floor | no primary-school child has a public picture |
| every guardian, and the boy himself | the people most likely to know of a danger each hold a veto |
| seven days and the DSO's list | a boy under a court order or a safeguarding plan is marked before any picture shows |
| one small portrait, checked by a person | no home, no route, no other child; low value for re-use |
| no page per player, no gallery, no list of pictures, a rate limit on the picture route | no one place to harvest a school's faces. The honours board is the nearest thing to one, and it is the school's own choice, row by row |
| a yearly end | a picture is never older than a year; a family is asked again each year |
| the mark and the hold | one person can remove it in a request, with no reason |

**What remains** is the reason I recommend waiting: a determined stranger who opens last week's scorecard can still learn a face and find the next fixture. Families must be told that in sentence 3, and counsel should say whether telling them is enough (§13.1).

**The safeguarding route.**
- Anyone signed in uses "Raise a concern" (built, db/57). A concern that names a picture puts a hold on it at once, before anyone decides anything.
- A public page that carries a picture carries one line: "Worried about a child's picture? Tell the school", with the school's information officer's contact. A signed-out report does not hide anything by itself (anyone could then hide any picture); the school acts on it the same day.
- **The DSO can:** read the seven-day list; set a safeguarding mark (name and picture both, no reason, only the DSO ends it); hold one picture; open a picture sent by a checker; ask the information officer to switch photos off for the school. The family reads only the one sentence of §5.2, so a parent who is the subject of a concern is not tipped off.
- **Incidents** (to add to kind `wrong_public`): a picture shown against anyone's no, under a mark, inside the seven days, below the floor, of the wrong child, or on a live surface or a preview is S1. A picture found copied elsewhere is recorded and the family told.
- **After a database restore** the photo setting is off before the API serves, and stays off until every no, hold and mark since the dump is put back (PBT §9.7).

---

## 8 · Storage, retention and access requests

- **Where:** a second private bucket, `player-photos`, through the existing adapter. Key `<school>/<player>/<uuid>.<ext>`, checked by a constraint. No address to a file ever exists outside the API. The local backend stays refused in production.
- **The public address:** `/api/public/photos/<token>`; the token is a keyed hash of the picture's id and the day, under its own secret. It carries no player id.
- **Kept, and for how long:**

| what | how long |
|---|---|
| a rejected upload | 7 days |
| a picture waiting for answers | 60 days, then deleted with a line to the uploader |
| the approved file | until 30 days after it stops being servable (a no, the year's end, eighteen, leaving, a new picture), or at once on the family's request |
| a file held for the DSO | as the Safeguarding Policy says; outside this purge |
| each consent, agreement, check, hold and take-down, with the picture's hash | with the other consent records (PBT §8.18: counsel says how long after he leaves) |

- **Deletion is real only if the bucket is not in a backup.** I recommend it is not backed up: a lost picture is uploaded again. The purge is a dated, logged job, as scorebook pages have. To confirm with the lead before build.
- **The log:** every upload, check, answer, hold and take-down is audited; every signed-in opening of a file is in the access log. Public views are not logged, as for every public page.
- **An access request (POPIA s23).** The pack for his own child gains: the picture if still held; every answer with its wording, time and giver ("you" or "the other guardian"); the check's outcome and reason; the dates it was public and on which surfaces. It cannot say who saw a public page. A mark or a hold appears only as §5.2's sentence. **Correction** is a new picture; **deletion** (s24) is the button.

---

## 9 · The new wording

### 9.1 `PUBLIC_DATA.md`

**Rule 4** becomes: "**Initial and surname, never more.** A consenting child is shown as "D Erasmus". A full name, a first name alone or a date of birth is never shown. A photograph is shown only under A8."

**A8** becomes:

> | A8 | Photographs of pupils | **One portrait, beside a name this rule already shows, on a finished scorecard and the school's honours board only.** Head and shoulders, the boy alone, checked by a second person at his school. Only on the separate yes, to that picture, of every guardian linked to him, and from twelve his own agreement; never by terms, never by default; not below the U14 age group; seven days after the last answer; ending each 31 December, at eighteen and when he leaves. Any guardian's no, his own from twelve, the school's or the DSO's takes it down at the next request. **Never** while play is on, on the ground display, the stream, the home page, a news post or a link preview, and never without his name. Every other photograph of a pupil: none on public pages. *Changed [date] (Kameel, 18 Nov 2026: "Change the rule: public profile shows a photo"; PUBLIC_PHOTO_DESIGN). Not in force until counsel has answered and the information officer has re-signed this document.* |

**D1** gains "and their pictures are not indexed". **D3** gains "the preview never carries a child's picture". **C1–C6** gain a line each pointing to A8 where the photo's rule is stricter (every guardian; his agreement from twelve; down at eighteen). `public.mjs`: A8's decision moves from `never` to a new `photo_rule`. `CLAUDE.md`'s line becomes "No photograph of a real child on a public page except the one portrait PUBLIC_DATA A8 allows".

### 9.2 The terms: the sentence for `popia-2026-02`

In sentence 22, "a photo" comes out of the never-list, and one sentence follows it:

> A photo of him is public only if every parent or guardian linked to him here says yes to that one picture, and from twelve he agrees himself; it is shown beside his name on finished scorecards and the school's honours board, never while a match is being played, and any of you, or he, can take it down at once, though a copy someone has already saved is beyond our reach.

`-02` was approved on 6 Nov and never issued, so this is an amendment before issue and the count of changed sentences goes up by one. **The same change is needed in `-03` and `-04`** (PBT §4.3, §4.6: "Never public, whatever anyone agrees: … a photo") **and in their notices** ("Never his full name, a photo, his age…" becomes "Never his full name or his age… A picture only if you separately say yes"). Whichever version is issued must carry it, or the terms deny what the consent screen offers. Under "What we keep", "a portrait, if you give one" joins the list.

### 9.3 The public-name wording

v1 and v2 sentence 1 lose "a photo"; v2 sentence 3's "The board never shows a photo" becomes "The board shows a picture only on its own separate yes". Each is a new version of that text.

---

## 10 · What must never be possible

Each is a test or a constraint in its slice.

1. A picture served without every live guardian's standing yes to that exact hash, or with any no standing.
2. A picture served for a boy of twelve or over without his own agreement to that hash.
3. A picture taking the by-terms route, a default, or a yes recorded on a link whose terms version says "never a photo".
4. A picture on the live page, the ground display, the big screen, the overlay, the home page, a news post, a shared card, an access pack about another child, or as any page's preview image.
5. A picture beside "Batter" or a masked name; a public response that tells a boy with no picture from a boy refused one.
6. A picture served under a mark, a hold, names off, photos off, below the floor, inside the seven days, past 31 December, past eighteen or after he has left.
7. A file reachable by a storage address, cacheable, indexable, or by a token from another day.
8. A picture approved by its uploader; uploaded by a pupil, a coach or a scorer; or kept with metadata.
9. A picture sent to any model or outside processor, or matched to a face.
10. The platform, support or a job turning a picture on; a cause of a hidden picture readable by a family, a coach or a pack.
11. A switch's state reaching selection, scoring or awards.
12. A file outliving its purge date; a consent record being deleted.

---

## 11 · Build plan

Everything is built dark: with the platform's photo setting off, public reads are byte-identical to today's. Migration numbers are the next free at build time (main ends at db/168).

| # | slice | what | tier | proof |
|---|---|---|---|---|
| 0 | **Decisions** | Kameel's §12; counsel's §13; PUBLIC_DATA re-signed; the terms version carrying §9.2 issued | no code | nothing below is switched on without it |
| 1 | **The rule** | `publicPhoto()` in `packages/policy`, pure, implementing §3.1 in order; A8 as `photo_rule`; the wording constant and its hash test | Opus | unit tests for every line of §3.1; must-nevers 3, 4, 5 |
| 2 | **Migration** | `player_photo` (key, hash, state, uploader, checker, reason, dates); `media_consent` with purpose `public_photo` (giver link, photo, surface, version, notice hash, kind `consent` or `agreement`); the school's adoption and age-group switch; the platform setting; the DSO's hold; `player.photo.review`; the doors `player_photo_submit/review`, `public_photo_set`, `public_photo_facts()` (returns yes or no and the file's id, nothing else); the due list; the purge; notify triggers; RLS | Opus; Fable red-team on Kameel's say | `db/99`: must-nevers 1, 2, 6, 8, 10, 12; two guardians; a guardian linked later; a revoked giver's no; eighteen |
| 3 | **Server** | the upload route (bytes checked and stripped); the `player-photos` bucket; the logged review read; `/api/public/photos/<token>` with its headers and rate limit; the token in `redact.mjs` only where a name is; the purge job | Opus | API walk: a no kills a loaded address on the next request; yesterday's token fails; must-never 7; the public leak test still refuses "photo" everywhere but the one field |
| 4 | **Family and pupil screens** | Family → Privacy → Picture (upload, crop, the consent, state lines); Me → Privacy; the terms step for a link on an old version; the other guardian's row and notice | Opus (renders a child's data) | browser walk per answer and per actor; a11y; no child's name in a route, title or push |
| 5 | **School screens** | the office's check queue and "Send to the safeguarding officer"; the paper-form dialog; Settings → School (adopt, age groups); the DSO's list, hold and count | Opus | the checker is never the uploader; no hold's author or reason outside the safeguarding tables |
| 6 | **Public pages** | the portrait on the scorecard, and on the board when R11 exists; the initials disc otherwise; `noimageindex`; the concern line; `alt` is his public label and nothing more; 390 and 1366, both themes | Opus | `smoke-public`: no picture on a live match, a preview or the home page; the page at 390 and 1366 |
| 7 | **Walks, runbooks, records** | the restore step; the incident rows; the access pack's rows; DEPLOYING's secret and bucket; the documents of §9 | Sonnet (walks and runbook text for behaviour already designed; records) | the restore walk ends with photos off |

Slice 6's board half waits on R11 (PBT slice 8). No slice here is worth building before slice 0, unlike PBT's 1 to 3.

---

## 12 · Questions for Kameel

| # | question | options | recommendation |
|---|---|---|---|
| **Q1** | **What "public profile shows a photo" means.** | (a) a picture beside his name where the public page already names him; (b) a new public page per player | **(a).** (b) reverses A4 and the terms' "never a page about him", and puts a child's face, name and figures in one place |
| **Q2** | **When.** | (a) after the pilot, built after counsel answers; (b) built dark during the pilot, switched on after; (c) in the pilot | **(a).** The pilot gains little from pictures and carries all the risk; no storage, consent or check exists yet; the name's own basis is still with counsel. If something must show in the pilot, the least is (b) with the honours board only |
| **Q3** | **Which surfaces.** | finished scorecard / honours board / live page / ground display | **Finished scorecard and honours board. Never live or the ground display in v1** |
| **Q4** | **Each guardian, or one.** | (a) every guardian linked to him; (b) one, the other told and able to stop it, as for names | **(a).** A picture cannot be recalled |
| **Q5** | **The boy's own say, and a floor.** | his agreement needed from 12 / only his no counts, as for names. Floor: none / U14 and older / U16 and older | **His agreement from twelve, and U14 and older.** Then every boy pictured has agreed himself |
| **Q6** | **Who uploads.** | a guardian / the office / both / the pupil | **Both a guardian and the office; never the pupil.** Whoever uploads, each yes is to that picture |
| **Q7** | **Who checks.** | (a) a second person in the office, the DSO seeing the seven-day list; (b) the DSO approves every picture | **(a).** (b) makes the DSO a bottleneck and puts every family's picture in front of them |
| **Q8** | **Kit and crest in the picture.** | allowed / plain clothing only | **Allowed.** The page names his school anyway; never a name on clothing |
| **Q9** | **How long a yes lasts.** | to 31 December each year, down at eighteen and on leaving / until withdrawn | **Yearly, down at eighteen and on leaving** |
| **Q10** | **The picture signed in** (team-mates, coaches, the other school's dossier). A8's note promised photos "for registered users". | part of this build / its own design later | **Its own design later.** Here only his family, the uploader, the checker and the DSO see it |

**Decided (Kameel, 20 Nov 2026, on the board): "All ten as recommended."** Q1 (a) a picture beside his name where the public page already names him; Q2 (a) after the pilot, built after counsel answers; Q3 finished scorecard and honours board only; Q4 (a) every guardian linked to him; Q5 his agreement from twelve and U14 and older; Q6 a guardian or the office, never the pupil; Q7 (a) a second person in the office, the DSO seeing the seven-day list; Q8 allowed, never a name on clothing; Q9 yearly, down at eighteen and on leaving; Q10 its own design later. The stricter readings stand, as Kameel raised no objection.

**Stricter readings I have taken; say if you object.** The picture comes down at eighteen rather than carrying on as a name does. A signed-in concern hides a picture before anyone decides. No automatic check of pictures by any model. The bucket is kept out of backups.

---

## 13 · Questions for counsel

1. **Is this consent?** Sections 1, 11 and 35(1)(a): an explicit, separate, per-picture yes from every linked guardian with §5.1's words. Is sentence 3 enough to make it informed, given §7's combination?
2. **Both parents.** Does the Children's Act (sections 18, 30, 31) make publishing a child's image a decision needing every holder of parental responsibilities? What of a holder who is not on SCRBRD?
3. **The child.** Is his agreement from twelve, with a veto and no lone yes, a sound reading of his right to be heard (section 10)? Is a floor of U14 needed, or too low?
4. **Special personal information.** A face can show race or ethnic origin, and sometimes religion or health (sections 26 to 33). Does a published portrait process those, and does this consent cover it? Is a portrait "biometric information" when nothing is matched?
5. **The earlier promise.** Families on `-01` were told "never a photo, whatever anyone agrees". May a later version withdraw that by a non-blocking re-agreement, with nothing changing for a family that does not agree?
6. **CSA.** Does the Safeguarding Policy's Annexure C require a paper form signed by the child for any published image, and does the in-app agreement meet it?
7. **Withdrawal and copies** (section 11(2)(b)). Is "off our pages at once; a saved copy is beyond our reach" an adequate account? Is there a duty to pursue copies or search engines?
8. **Whose picture, and who answers for it.** Copyright in a school photographer's portrait; whether the uploader's tick is enough; whether the school or SCRBRD is the responsible party for the published image.
9. **Publication to the world.** Section 72, and prior authorisation under sections 57 and 58, as PBT §8.13 asks for names.
10. **A harmful upload.** What the checker, the DSO and SCRBRD must do, keep and report if an indecent image of a child is uploaded, and under which Acts.
11. **Retention** (section 14). May the hash of a deleted picture and its consent records be kept as evidence, and for how long after he leaves?
12. **A copy found elsewhere.** Is that a security compromise under section 22 when the publication itself was lawful, and who must be told?

---

**To the lead.** Seven slices after slice 0; ten questions for Kameel, twelve for counsel. Three things to know. (1) The documents on the reading list are at `origin/main`; the working tree at `/home/user/SCRBRD_OS` is at 14 Nov and has neither the 18 Nov notes nor three of the four documents, so I read them from `origin/main`. (2) `CLAUDE.md`'s entry for this problem says "after the 25 Nov reset"; today is 20 Nov. (3) "Public profile" is not a page today, and A4 forbids one; the whole design rests on Q1(a).
