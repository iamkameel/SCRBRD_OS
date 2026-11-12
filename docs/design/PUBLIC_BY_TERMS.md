# Public by terms: the opt-out model for a child's name on public pages

**Status: approved by Kameel, 11 Nov 2026 (10:42 SAST): "All 9 as recommended".** Counsel answers §0's questions before any slice that publishes ships; slice 1 (the stream caption) does not wait.


**Status:** design, for Kameel's review (Fable, 11 Nov 2026; revised the same day after an Opus review). Nothing is built. Nothing ships before counsel answers §8 and the information officer re-signs PUBLIC_DATA. Slice 1 (the stream caption) is the exception: it fixes a defect that exists today and should not wait.
**Kameel's decision this answers (11 Nov 2026):** "My agreeing to the Terms & Condition, parents and kids automatically accept to having some details completely public. Privacy setting will be available for them to disable data and information they choose to hide from public view." He chose "Move to opt-out by terms" over keeping opt-in.
**Read:** `CLAUDE.md`; `docs/policy/PUBLIC_DATA.md`; `CONSENT_V2.md`; `GUARDIAN_TERMS.md`; `SCRBRD-083_public_pages.md` (§0–§3, §6, phase 2); `RECOGNITION_design.md` §2, §3; `READERS_child_data.md` (rules, K, M, conflict 7); `apps/web/src/views/publicname.jsx`; `services/api/public/redact.mjs` (header, `nameFor`); `ACCOUNT_LIFECYCLE.md` §3.4, §4.1–4.2; `SAFEGUARDING_DSO.md` §2, §6.1, Q7; `ACCESS_REQUESTS.md` D4, §3.1, §4 rows K, K2, M; `INCIDENTS_AND_BREACHES.md` §3.2–3.3, §4.3, §6.1. All at `origin/main` on 11 Nov.
**Taken from the review, not read by me:** every `file:line` below into `db/08`, `db/47`, `db/59`, `db/62`, `db/71`, `db/116`, `db/122`, `db/128`, `public.mjs`, `public-api.mjs`, `roles.mjs`, `bigscreen.jsx`, `BACKUP_RESTORE.md` and `NEWS_COVER_UPLOADS.md` is the reviewer's finding (`REVIEW.md`, Opus, 11 Nov), cited as given.
**No child's name appears.** "T Bekker" is the placeholder label the consent screen's own comments use.

## Decided 12 November 2026 (Kameel)

- **Build plan: "Build 1-8, switched off".** Slices 1–8 are built now, and nothing that publishes is switched on before counsel answers §8.
- **The big screen, 13:05 SAST: "Both as recommended".**
  - (a) Only staff may open the big screen and make its read.
  - (b) When any boy on the field is marked never-public, the screen shows that boy's whole side by position, and the read says only "this side by position", never which boy.
- **The big screen, 17:45 SAST: "Season roster: hide the side all season".** A side shows by position whenever a marked boy is on its season roster, whatever the day's XI.
- **Engineering notes (the lead's, not Kameel's):**
  - "staff" means `player.roster.read` or `scoring.start` at the host side, never a pupil, and never a scoring pad's credential;
  - on a fixture with no team sheet, the away side is always shown by position;
  - the build is PR #302, db/153.

---

### Revised 11 Nov after review

- **B1 fixed.** A no given to the old wording is a no on every surface. Wording narrows a yes, never a no (§5.1 line 5, §6.1).
- **B2 fixed.** A no that was competent on the day it was given stays a no whatever later happens to its giver's link. Only a yes needs a live giver (§5.1, §5.2).
- **B3 fixed.** The stream caption names children today with no consent, mark or names-off check. It is out of the default, it is closed to the by-terms route in code, and closing it is slice 1 (§1.3).
- **B4 fixed.** The gate reads each record's stored choice against a platform setting, so a fall from tier A works after launch as well as before. The cost of a post-launch fall is stated (§5.3, §8).
- **B5 fixed.** Once one guardian's date is running, every other verified guardian is shown the date and both switches, and can stop it without agreeing to anything (§4.4).
- **Live play is now its own surface** (§1.1): the live page shows the ground and the time, so naming a child there says where he is. I recommend it needs its own yes. Q1 puts it to Kameel.
- **Facts corrected:** the pupil's no from twelve is built (db/116 §4); the cover-photo rule is `NEWS_COVER_UPLOADS.md` §1 principle 1, not its Q2.
- **Should-fixes taken:** every writer of an agreement named and closed (§6.1); the 120-second cache (§2.4); the index and signatures (§6.2); who reads a DSO mark (§3.2); the access pack's K2 (§9.6); the "Batter" tell (§3.4); the big screen at the ground (§2.5); the platform setting moved into the database (§5.3); re-adoption (§5.3); restore (§9.7); slices split and re-sized; migrations from db/149.
- **Questions:** Q1 split by surface with the days folded in; four rulings I had made in the body are now Kameel's (Q6–Q9); tier B's words are drafted (§4.6) so his fallback answer is a setting. Counsel's list gains five items.

---

## 0 · In one page

**What changes.** Today a child is named in public only after a guardian's separate yes. Under this design a guardian who agrees to a new terms version, `popia-2026-03`, agrees in the same act that named details are public by default, and can switch each off, on the agreement screen itself or at any time after.

**The default, as I recommend it.**
1. His initial and surname ("T Bekker") beside his figures on the **scorecard after the match**, on a match page his school has published.
2. The same initial and surname on his school's **public honours board** (R11), with the honour, its season or match, and the school's few words.

**Not in the default, by my recommendation:** his name on the **live page while play is on**. That page shows the ground and the time, so a name there tells a stranger where a child is now. It keeps its own yes, one tap on the same screen (Q1b).

**Never, whatever is accepted:** PUBLIC_DATA's never-list, a photo, a full name, a first name alone, a page per player, any ranking, any figure across matches, and a name on a video stream.

**How it is made defensible.** POPIA allows a child's information to be processed on the prior consent of a competent person, and that consent must be voluntary, specific and informed. A default that is on is the weak point, and §7 says so plainly. The design does six things about it:

1. **Silence never publishes.** A child becomes public by terms only when a verified guardian has agreed to `popia-2026-03` on a screen that showed the public notice. A family that never answers stays exactly as it is today.
2. **A separate notice at agreement**, outside the scrolled text and directly above the button, naming each detail with the child's own label and its switch. The terms can be agreed with every switch off.
3. **Seven days before first publication**, with the date shown to every guardian of the child and to the child himself from twelve.
4. **A no always wins and never lapses.** No default outvotes a no, whoever gave it, whenever, under whatever wording, and whatever has since happened to that person's link.
5. **An off that is easy, immediate and reaches the past**, from a parent, from the pupil from twelve, from the office on the family's word, and from the DSO without a reason.
6. **Each school adopts it**, and one logged platform setting can stop it.

**Three tiers, one data shape.** A: default on (Kameel's decision). B: the parent must choose on or off for each detail before she can agree. C: the opt-in v2 approved on 6 Nov. §8 says honestly what moving between them costs before and after launch.

**My reading of the risk, stated once.** I expect careful counsel to doubt that tier A is consent under POPIA, and to accept tier B. Tier B costs a parent one tap per detail and would, I expect, name nearly as many children.

**Where the design is narrower than Kameel's words** (Q9): he said "parents and kids automatically accept"; only a verified guardian's agreement can publish, never a child's. He said "completely public"; the pages stay out of search engines.

---

## 1 · What is public by default, and what never is

### 1.1 The surfaces

| # | surface | by default? | why |
|---|---|---|---|
| 1 | **The scorecard after the match** (`card`): initial and surname beside his figures, dismissals and fall of wickets, once the match has ended (A2) | **in** | the level PUBLIC_DATA already allows a consenting boy; his figures are already public against "Batter"; the match is over, so the page says nothing about where he is |
| 2 | **The honours board** (`board`): initial and surname, the honour, season or match, citation (A5, R11) | **in** | Kameel's decision and the reason R11 waits; the school still chooses each honour (`honour.is_public`); the citation is filtered at the writer (RECOGNITION D2) and shown only beside a name (D13) |
| 3 | **The live page while play is on** (`live`): his name at the crease, in the commentary and on the milestone line (L2, L4, A6), beside the ground and time (L3) | **recommended out; its own yes** (Q1b) | it is the only surface that puts a named child at a place at a time; INCIDENTS rates a protected child's whereabouts S1; "informed" is hardest to show here. The yes is one switch on the same notice |
| 4 | His age group through the team code ("U15A") | already public | a team fact |

"While play is on" is the fixture's own status: from the first event until the match is completed. The moment it completes, the same page is the scorecard and the `card` rule applies.

### 1.2 Never by default, or never at all

| detail | status | why |
|---|---|---|
| His name on a stream caption, over video of him | **out; its own consent** (§1.3) | a name beside a moving image of his face; SAFEGUARDING K1 gives it its own consent (`stream_name`); CSA's Annexure C is a signed form |
| A photo | never | A8; `NEWS_COVER_UPLOADS.md` §1 principle 1 and its status line, approved 11 Nov ("photos of pupils stay off public pages here") |
| Full name, a first name alone, known-as | never | rule 4 |
| A page per player, a leaderboard, a record, a best, any figure across matches | never | A3, A4, RECOGNITION A11; a default must not build a profile of a child |
| Team sheets before a match, the captain mark | never | A7 |
| News posts naming pupils | out | D4: news stays signed in; the public news scan is unchanged |
| A pupil who scores, named as an official | out | PUBLIC_DATA §5a: "not covered by this rule yet"; it stays outside the default |
| A shared milestone card | **only on an explicit yes** | it leaves the platform and cannot be recalled, like an access pack (§9.6) |
| N1–N5: date of birth and exact age, health and why he is not playing, conduct, contact and identity, judgements | never | PUBLIC_DATA §3; `NEVER_PUBLIC` and its test are untouched |
| A withdrawn honour and its reason, a bowling-load breach, a typed name (L6), a side whose school is off the platform (L5) | never | §5a, RECOGNITION D3, D4 |

The by-terms route is closed to the surfaces of §1.1 by a `CHECK` constraint. Scouting, the passport, health monitoring, media and the stream keep their own consents; none may ever be given by default.

### 1.3 The stream caption today (B3)

The review found that `broadcast_state()` names the striker, non-striker and bowler through `broadcast_name(full_name, name_display)`, initials by default, with **no check of consent, the never-public mark or names-off** (`db/71_super_over.sql:789-791`; `db/08:3401-3416, 3446`), granted to `PUBLIC` (`db/08:3562`) and served at `read-api.mjs:1507`. So wherever a school publishes an overlay, a child under a DSO mark, a child switched off and a child whose parents never answered can be named on it. That is a defect now, whatever happens to this design. The lead is checking whether any overlay is live.

Two things follow:

1. **Slice 1 closes it before anything else.** `broadcast_state()` serves role words, "Batter" and "Bowler", for every child until the stream's own consent (`media_consent`, purpose `stream_name`, SAFEGUARDING K1) is built. This is stricter than D2 ("brought under the L2 consent rule"), because no wording a family has ever answered names a stream. Q1e asks Kameel to confirm.
2. **The caption can never take the by-terms route.** `public.mjs:95` gives D2 to `name_rule`, and 083 §5.2 planned to bring the overlay under `publicName()`. Once by-terms is in `publicName()`, that plan would name a by-terms child on the stream. `SURFACES.D2` changes to its own rule; the overlay's call passes `byTermsAllowed: false` as a literal; a test on the overlay path proves a by-terms child, a marked child and a names-off child are role words.

Only then is the terms sentence "His name on a video stream needs your separate yes" true.

### 1.4 What stays true from PUBLIC_DATA

Rules 1, 2, 4, 5, 6 and 7 are unchanged. Rule 7 now carries more weight: with more children named, `noindex` on every page that carries a label is a condition of this design. If D1 is ever loosened, public by terms is switched off first. Rule 3 is reworded, not removed (§9.1).

---

## 2 · The privacy settings

### 2.1 The switches

Per child, one switch per surface and one shortcut.

| switch | on | off |
|---|---|---|
| **Name on scorecards after the match** | "T Bekker" on a finished scorecard | "Batter" / "Bowler" on every public scorecard, past ones included; his figures stay, because a scorecard cannot lose a batter without lying |
| **Name during live play** (off until she says yes, if Q1b is taken as recommended) | "T Bekker" on the live page, its commentary, the milestone line and the pavilion display | a position on all of them |
| **Name on the honours board** | his rows on the school's public board | no row at all (Kameel, 6 Nov: never an anonymous "Player") |
| **Hide everything** (a button) | — | sets every switch off in one tap |

Per-surface switches reverse CONSENT_V2 Q1, which chose one answer for both surfaces because two switches about the same name could disagree. Under opt-out the balance changes: being able to refuse one named thing and keep another is most of what makes a default "specific". The switches cannot contradict each other, because each governs its own surface. Q2 puts this to Kameel.

The screen also says what the switches do not govern: "People signed in at the school still see his name as the terms describe. The school's own scoreboard at the ground is not a public page" (§2.5).

### 2.2 Who may use them

| who | where | may switch off | may switch on |
|---|---|---|---|
| **a verified guardian**, each for herself, **whichever terms version she is on** | the agreement screen (§4.2); Family → child → **Privacy** (today's Consents switch moves here) | yes, at once. An off needs no agreement to anything | yes: an explicit yes at the current wording, stronger than the default |
| **the pupil, under 12** | Me → Privacy, read-only | no | no |
| **the pupil, 12 to 17** | Me → Privacy | **yes; his off stands whatever a guardian says** (built: `db/116:311-336, 372-381, 472-476`) | **no, as today.** Whether and how his own no can be taken back before eighteen is Q6 |
| **the pupil, from 18** | Me → Privacy | yes | yes; once he has answered, only his records count. Until then his guardian's state carries on (C6), and while he is at school she may switch off, never on (083 §6, option C) |
| **the office** (`guardian.link.manage`) | Squad → Edit Profile | yes, on the family's word, no signature; and the departure tick (ACCOUNT_LIFECYCLE §3.4, Q5), which now writes every surface | only from a signed form carrying the `-03` words, naming the form and its date |
| **principal, director of sport, office** (`player.public.withhold`) | Squad → Edit Profile | the never-public mark, with a reason its holders read | end a mark set under that capability |
| **the DSO** | the same, and the pre-publication list (§3.3) | a safeguarding mark, **with no reason recorded** (§3.2, Q7) | end a safeguarding mark; nobody else can |
| **the school** (`broadcast.publish`) | Settings → School | names off for an age group; withdraw a fixture; `honour.is_public` off | its own switches |
| **the school's information officer** | Settings → School | public by terms off for the whole school (§5.3) | on, as a recorded act |
| **the platform** | a logged platform setting (§5.3) | public by terms off everywhere; `PUBLIC_PAGES` off | **never a child's name on** |
| a coach, a team manager, a scorer, another family | — | no | no; they do not see the state (READERS K) |

A pupil with no account has no route of his own today: the office's branch of `public_name_consent_set()` takes only a guardian's link (`db/116:383-399`), and SAFEGUARDING Q7's form route is not built. This design does not add it. His guardian's off, or the office's on the family's word, is his route until it is.

### 2.3 What the parent's Privacy screen says

Each switch shows its state and the one fact that decides it:

- "On. You agreed to the school's terms on 12 Nov 2026."
- "On from 19 Nov 2026. Until then he is shown as Batter."
- "On from 19 Nov 2026: the other guardian agreed to the school's terms on 12 Nov. You can switch this off now."
- "Off since 14 Nov 2026, switched off by you." (or "by the other guardian", "by the office, on the family's word")
- "Off. T Bekker has switched this off himself, and his answer stands."
- "Off. The school is not showing him on public pages. Ask the office."

The last sentence is **one string for every school-side cause**: any mark, whoever set it; names off for his age group; an unknown date of birth (names-off is true when `born` is null, so the default never names a boy with no date of birth on file). A parent cannot tell them apart, the office answers with the same sentence, and her own switches stay as she left them underneath. This keeps PUBLIC_DATA C5 and stops a mark tipping off a parent who is the subject of a concern.

### 2.4 What happens when a switch goes off

| where the name was | what happens | how fast |
|---|---|---|
| the API's cache of the scorecard, live page, commentary, board | dropped by the `public_data_changed` notification, on each API instance that is listening | the next request |
| the same, with an instance's listener down | the cache's own life is the ceiling | **today up to 120 s**: 60 s for a finished match, doubled while a fixture is busy (`public-api.mjs:454, 457`). Slice 2 removes the doubling for any entry that carries a label, which makes the ceiling 60 s as 083 §2.6 accepted |
| a browser or the edge | nothing to drop: every response carrying a label is `no-store` | — |
| finished scorecards, old honours | changed with the rest: the rule is judged on the day served | the next request |
| the pavilion display (`/display/`) | follows the public rule | its next poll |
| a link preview on WhatsApp | names nobody by construction (`shellTitle()`, team facts only) | — |
| a search engine | pages with labels are `noindex` | — |
| a saved or printed copy, a screenshot, a recording of a stream | **beyond reach.** The terms and the switch say so | never |
| an access pack or a shared card already issued | beyond reach; that is why both name another child only on an explicit yes | never |

Switching off writes a record; it deletes nothing.

### 2.5 The big screen at the ground

The Match Centre's big screen is fed by the signed-in fold with full names and was kept signed in by 083 Q9 (`bigscreen.jsx:4-15`). It faces the boundary crowd. It is the school's own scoreboard, not a public page, and the switches do not govern it; the Privacy screen says so. One change: a boy under any never-public mark is shown by position on it. A mark is for a child who must not be findable, and a screen facing a crowd is a place he can be found. That is in slice 1.

---

## 3 · Age, and the child who must not be findable

### 3.1 Twelve and eighteen

- **Under 12:** his guardians decide. He reads the state on Me.
- **On his twelfth birthday** a quiet row appears on Me: "You can now hide your name from public pages yourself." No push. From twelve he also sees any running date ("Your name will be shown from 19 Nov. You can say no.").
- **At 18:** a row on Me: "Your privacy settings are yours now", with the state and the switches. The standing state carries on until he answers (C6, signed off 28 Sep for an explicit yes). §8 asks counsel whether a default may carry past eighteen as a yes may; if not, the default lapses thirty days after his birthday unless he has answered.
- **No agreement after eighteen makes him public.** A guardian's agreement on or after his eighteenth birthday writes no by-terms record, as her yes is refused today (`db/116:358-366`).

### 3.2 The DSO's route (Q7)

The never-public mark (C5) already overrides every consent. Three changes:

1. **A safeguarding mark carries no reason.** Today the mark requires a reason every holder of `player.public.withhold` reads (`db/47:32-36, 470-475`). A mark set under a new capability, `player.public.withhold.safeguarding`, held only by the `dso` bundle, stores no reason. If there is one, it lives in the safeguarding concern.
2. **Only a holder of that capability ends it.** The check is the capability, never a role name (READERS rule 1, ADR 0003).
3. **Other holders are told nothing about its author.** The principal, the director of sport and the office see "Marked. Only the person who set this mark can end it", with no name and no word of the DSO. A director of sport may be the adult a concern is about; "marked by the DSO" would tell him one exists (READERS rule 5). The family sees the one sentence of §2.3.

On public pages a marked boy is a position on a scorecard and absent from the board, as today. The mark stays a public-page mark; it does not hide him from his side's signed-in team sheet (083 §7).

### 3.3 The pre-publication list

The seven days are also the school's. A read under `player.public.withhold`, logged: every child at the school whose first by-terms publication falls in the next seven days, with the date, at roster tier. It exists so a child under a court order or a safeguarding plan is marked **before** his name is ever shown. The DSO's home shows the count. When a school adopts or re-adopts public by terms (§5.3), nobody is named until seven days after that, so the DSO always sees the list first.

### 3.4 The one "Batter" among named boys

083's principle that "Batter is one string" protects a marked boy because many boys are "Batter". Under opt-out most of a side is named, and a marked boy becomes the one position at the same place in the order each week. On a finished scorecard that marks which line is his to someone who already knows he plays there; it does not say where he is. On the live page it would, during play.

- If Kameel takes Q1b as recommended, the live page names only boys with an explicit yes, most of a side is a position during play, and the crowd is back.
- If he puts live play in the default, then I recommend a second rule: while play is on, a published side that holds a marked boy is served with names off for the whole side. It costs his team-mates their names for those hours and never says which boy is the cause. Q1b carries this as its consequence.

The remaining tell, on finished scorecards, goes to counsel (§8, 19).

---

## 4 · The terms: `popia-2026-03`

### 4.1 The version strings (an implementation note, no question)

`popia-2026-02` and `public-names-2026-11` are CONSENT_V2's, approved 6 Nov and never issued; they stay reserved for tier C. This design is `popia-2026-03` (tier A) and `popia-2026-04` (tier B's words, §4.6); the wording on the switches is `public-settings-2026-11`. Versions are compared through one ordered list, never by string order. The list lives in the policy package and in SQL, with a drift test between the two copies as `notifications.mjs` KINDS has (`db/116:513-516`). The server holds the table from version to notice hash; a client sends the version only, and a version the server holds no hash for is refused.

### 4.2 The agreement screen

The scrolled terms end with §4.3. Then, outside the scroll and directly above the button, **the public notice** (drawn for Q1 as recommended):

> **What becomes public about T Bekker**
> From **19 November 2026**, anyone with a link to a page the school has published can see:
> **"T Bekker" on scorecards after a match** · beside his runs, wickets and catches   `[ On ]`
> **"T Bekker" on the school's honours board** · with the honour and the school's few words   `[ On ]`
> Your choice, off unless you turn it on:
> **"T Bekker" while a match is being played** · the live page also shows the ground and the time   `[ Off ]`
> Never his full name, a photo, his age or anything about his health.
> You can change any of these now, or at any time in Family → Privacy. Switching off changes nothing else: he is picked, scored and honoured the same.
>
> `[ I agree ]`
> *Public: scorecards on · honours board on · live play off · from 19 Nov 2026*

- A switch starts **off wherever any no stands**: hers, the other guardian's, the office's or the pupil's, at any wording. A no to the old wording starts every switch off. It reads "A no was recorded on 3 Oct 2026. That stands."
- The line under the button always states what she is agreeing to, as it will be recorded.
- The button is disabled until the notice has been on screen.
- The record keeps the terms version, each switch's state at the tap and whether she touched it, and the time (§6.1). This is the evidence section 11(2)(a) puts on the responsible party.

### 4.3 The terms section, tier A, as a draft for counsel

Replaces sentences 19, 20, 21 and 23 under "What is public, and what never is" and keeps 22's list. Sentence 14 is not touched (snoozed by Kameel, 11 Nov). Everything else is `popia-2026-01` word for word.

> **What is public, and what you can switch off**
> By agreeing, you agree that two things about him are public, for anyone who has the link, starting seven days after you agree:
> One: his name as an initial and surname beside his runs, wickets and catches on the scorecard of a match the school has published, once the match is over.
> Two: the same initial and surname on the school's public honours board, with the honour, its season and the school's few words, where the school puts an honour there.
> His name on the live page while a match is being played, which also shows the ground and the time, needs your separate yes.
> You can switch each off, on this screen before you agree, or at any time in Family, or by telling the school office. Off takes effect at once, on past scorecards and the honours board too. A copy someone has already saved or printed is beyond our reach.
> Switching off changes nothing else. He is picked, scored and honoured the same.
> Until the seven days are up, and whenever a switch is off, he is "Batter" or "Bowler" on a match page and is not on the honours board.
> If he has another parent or guardian on SCRBRD, they are shown the date and can switch it off too. One no is enough.
> From twelve he may switch his own name off himself, and his no stands. From eighteen the choice is his.
> The school may keep a child off public pages, and does not say why.
> Never public, whatever anyone agrees: his full name, a first name alone, a photo, his date of birth, his health or why he is not playing, conduct, contact details, ratings, notes, a page about him, a list that ranks him, or any figure of his across matches. His name on a video stream needs its own separate yes.
> We tell search engines not to list these pages.

If Kameel puts live play in the default (Q1b), sentence "One" ends "…during the match and afterwards. While a match is being played the page also shows the ground and the time", and the separate-yes sentence goes.

Every sentence traces: the details to §1.1; seven days to §5.1 line 6; "at once, on the past too" to rule 6; the saved copy to CONSENT_V2 v2·5; "changes nothing else" to must-never 8; the other guardian to §4.4; twelve to db/116 §4; eighteen to C6; the school's silence to C5; the list to §3 and sentence 22; the stream to §1.3; search engines to D1 (the home page is indexed and names no child, so the sentence says "these pages").

Two sentences stand on things not built: the honours board (R11, slice 8) and the stream sentence (slice 1). Both land before `-03` is issued.

### 4.4 Moving families who are on `popia-2026-01`

**Nothing flips on a notice.** A child becomes public by terms when a guardian agrees to `-03`, and seven days later.

| the family today | on the day the school adopts | after a guardian agrees | if nobody ever agrees |
|---|---|---|---|
| standing yes at `public-names-2026-10` | named on match pages, live and after, as now; not on the board | scorecards and live: no gap, her yes carries on. Board: on after seven days unless switched off | named on match pages on her own yes; never on the board |
| a standing no, a withdrawal, the office's no, the pupil's own no | hidden | **hidden on every surface.** The notice shows every switch off | hidden |
| never answered | "Batter" | scorecards and board on after seven days unless switched off | "Batter"; no board row |
| no verified guardian, or the link pending | "Batter" | — | "Batter" |
| a pupil's own `self` link | as his guardians' records say | a `self` link never makes him public; the agreement function skips it without failing | — |

**How they are asked.** `-03` is a re-agreement, not CONSENT_V2 §3.3's information line. It is **not blocking**: `-01` stays a valid agreement for everything it covered, the link stays `granted`, and the boy is selected as before.

- Once, on opening the app: a sheet, "The school's terms have changed: what is public about your child", with **Read and decide** and **Not now**.
- On the action list, one quiet row per child: "The school's terms have changed. Until a parent or guardian agrees to them, nothing about T Bekker changes." No push, no urgency colour. GA-I20's rule R8a fires on `consent_version ≠ current` with the words "Read and agree again" (`GUARDIAN_TERMS.md:145`); for `-03` its words and weight become this row, or every family gets an urgent prompt.
- New links from the adoption date sign `-03`.

**The other guardian (B5).** Each guardian agrees for herself, and one agreement is enough to start the date (§5.2). So the moment a by-terms date is running for a child, **every other verified guardian** gets:

- an action-list row, with a notice whose push names nobody: "The other guardian agreed to the school's new terms on 12 Nov. T Bekker will be shown on public scorecards and the honours board from 19 Nov unless a switch is off. **[ See and change ]**";
- the Privacy screen's line for it (§2.3), with the switches live. She can switch off without agreeing to `-03`; an off needs no agreement.

Her own prompt row changes from "nothing about T Bekker changes" to that sentence. She is "the other guardian", ACCESS D4's word, to each of them.

A school may later make `-03` the terms for a new season's registration. That is defensible only because `-03` can be agreed with every switch off; it belongs to the season rollover and is not designed here.

### 4.5 Paper

The office may record a `-03` agreement from the school's paper form only if the form carries the notice with a box per detail. The office's dialog asks for the form's name, its date and each box as ticked. The seven days run from the day it is recorded; every guardian with an account gets the row of §4.4.

### 4.6 Tier B's words, `popia-2026-04`, drafted now

So that a fall to tier B is Kameel's setting and not a second text approval. Counsel reads both.

The notice:

> **Choose what is public about T Bekker**
> Anyone with a link to a page the school has published could see these. Choose for each:
> **"T Bekker" on scorecards after a match**   `[ Show his name ]`  `[ Keep him as "Batter" ]`
> **"T Bekker" on the school's honours board**   `[ Show him ]`  `[ Leave him off ]`
> **"T Bekker" while a match is being played** · the live page also shows the ground and the time   `[ Show his name ]`  `[ Keep him as "Batter" ]`
> Never his full name, a photo, his age or anything about his health. What you choose to show starts on 19 November 2026. You can change any of these at any time in Family → Privacy. Your choice changes nothing else: he is picked, scored and honoured the same.
>
> `[ I agree ]` *(enabled once each line is answered)*

Nothing is chosen for her, except that a line where a no already stands starts on the no. The terms section is §4.3 with its first sentence replaced:

> **What is public, and what you choose**
> When you agree, you choose for each of these whether it is public, for anyone who has the link. What you choose to show starts seven days after you agree: …

The rest is word for word. Tier B's hash and version are held beside tier A's from the start.

---

## 5 · Who decides: the rule in order

### 5.1 The gate

For one child, one surface (`card`, `live` or `board`) and the day served. The first line that applies decides. A missing fact is a no.

1. **The surface exists for him.** His side of the fixture is published; or the honour is `is_public`, not withdrawn, and awarded at the school whose records are being read. Otherwise nothing is served.
2. **A never-public mark** → not named.
3. **Names off** for his age group or the side's, or no date of birth on file → not named.
4. **His own standing no**, from twelve → not named. From eighteen, once he has any record of his own, only his records are read from here on.
5. **The latest explicit answer for this surface**, by the day it was given:
   - **A no counts if its giver was competent on the day it was given.** What has happened to her link since (dated out, revoked, replaced, her account disabled) does not matter. *A no never lapses by someone else's act.*
   - **A no covers every surface its wording could reach.** A no to the old single wording (`public-names-2026-10`, "public match pages") is a no on `card`, `live` and `board`. *Wording narrows a yes, never a no.*
   - **A yes counts only if its giver is live today** (the `consent_giver_live()` test of db/122: active, in its dates, not suspended, verified), and only on the surfaces its wording named: the old wording names `card` and `live`, never `board`.
   - The latest counting answer governs: a no → not named; a yes → **named**.
6. **No explicit answer counts: public by terms.** Named only if all hold:
   - the platform setting is on (§5.3);
   - his school's basis is `by_terms`;
   - a by-terms record stands from a guardian who is live today by the same db/122 test, worked out when read, not stamped by a job (`db/122:20-60`);
   - that record's stored choice for this surface is `chose_on`, **or** it is `default_on` and the platform setting currently allows a default for this surface;
   - the day served is on or after the later of the record's `effective_on` and seven days after the school's latest adoption.
7. Otherwise → not named.

Line 6 is the whole of the opt-out. With the platform setting off or the school at `separate_yes`, it never fires and the system behaves as CONSENT_V2 designed it.

**What B1 and B2 close.** Guardian A said no in October; guardian B agrees to `-03`: line 5 finds A's no on every surface, so line 6 is never reached. A boy of fourteen refused his own name: line 4 reads it on every surface. A mother said no and her link was later revoked: her no still counts at line 5, so the father's agreement does not name the child. To name him, a live competent person must give an explicit yes later than that no, which is §5a's rule ("the later one decides") unchanged. The office's revoke sheet says so before the tap (lifecycle D14).

### 5.2 Two guardians

One guardian's agreement starts the date; §8 asks counsel to confirm that is enough when the other is told and can stop it. Any no, from either, at any date, is read at line 5 before line 6. Two explicit answers are settled as §5a settles them today.

### 5.3 The school's adoption, and the platform setting

- **`school_public_basis`**: per school, `separate_yes` (today's rule) or `by_terms`; it starts at `separate_yes`. Switching is the information officer's act (the principal unless the school names another), recorded with who, when and the terms version, behind a confirmation that states what it does. Switching back to `separate_yes` is immediate. **Switching on again starts a fresh seven days for everyone** (line 6's last test), so old records do not name a whole school at once and the DSO sees a new list first. While a school is at `separate_yes`, new links still sign `-03`; its public section is then untrue only in the safe direction, and the notice reads "The school is not showing names by default at present."
- **The platform setting** is one row in the database, not an environment variable: `by_terms_on`, and per surface `default_allowed`, plus `tier_for_new` (`default_on` or `forced_choice`). It is written through one logged door by the owner's key, with a reason. SQL reads it, so the Privacy screen, `public_name_basis()` and the pre-publication list say the same thing the public pages do. It takes effect on the next request, not on a redeploy. It starts off.
- **What each lever does after launch:**

| setting | effect |
|---|---|
| `by_terms_on = false` | line 6 never fires; every child named only by terms reverts on the next request; explicit yeses stand; no page is taken down |
| `default_allowed[board] = false` | board records with `default_on` stop counting; `chose_on` records stand |
| `default_allowed` false for every surface, `tier_for_new = forced_choice` | **the fall to tier B.** Every family that agreed under A without touching a switch reverts to "Batter" and gets a row, "Choose what is public about T Bekker", which opens tier B's notice. Families who chose stand |

That last row is the honest cost: after launch, a fall from A is one setting, and it un-names every default-named child until his family chooses. Before launch it costs nothing.

---

## 6 · Data shape

New migrations only (Opus): **db/149** (slice 3) and **db/150** (slice 4). Main ends at db/144; db/145–148 are taken on branches. The bodies to start from are db/116's `public_name_*` functions with db/128's `sa_today()` transforms, not db/47's. db/128 guards bodies by md5 (`db/128:158-160, 187, 223`); each new file carries its own guards against whichever bodies have landed first.

### 6.1 Tables

**`public_name_consent` gains `surface`** `text NULL CHECK (surface IN ('card','live','board'))`. **Existing rows are left NULL**, meaning "the old single wording", and are read by §5.1 line 5's rule: a yes on `card` and `live`; a no on all three. Nothing is backfilled, so no old answer is reinterpreted by a migration. New rows always carry a surface. The unique index `public_name_consent_one_open (player_id, giver_link_id) WHERE ended_on IS NULL` (`db/47:245-246`) is rebuilt on `(player_id, giver_link_id, coalesce(surface, 'old'))`. "Hide everything" and the departure tick write one `refused` row per surface in one transaction.

**`public_by_terms`**, new, append-only, end-dated, never deleted. One open record per giver link (a partial unique index on `giver_link_id WHERE ended_on IS NULL`).

| column | meaning |
|---|---|
| `id`, `player_id`, `school_id` | the school is the link's; a record at one school never serves another school's board |
| `giver_link_id` | a guardian's link, verified and `granted` on the day; never a `self` link |
| `terms_version`, `notice_hash` | the version from the ordered list; the hash looked up by the server |
| `choice_card`, `choice_live`, `choice_board` | `default_on`, `chose_on`, `chose_off` or `not_offered`: what each switch showed at the tap and whether she set it. A `chose_off` writes the `refused` row above in the same transaction |
| `agreed_at`, `agreed_on` | the time; `sa_today()` |
| `effective_on` | `agreed_on + public_cooling_off_days()` |
| `source`, `form_name`, `form_date`, `recorded_by` | `app` or `paper_form`; the form pair is required for paper |
| `ended_on`, `end_reason` | `terms_withdrawn`, `link_revoked`, `superseded`. A link that simply dates out is not stamped; line 6 works it out on the day |

**Every writer of an agreement, and what each does at `-03` or later:**

| writer | today | under this design |
|---|---|---|
| **`guardian_terms_agree(guardian, player, version, choice_card, choice_live, choice_board, source, form_name, form_date)`**, new | — | the only door that records `-03` or later. The guardian herself with `source = 'app'`; a holder of `guardian.link.manage` only with `source = 'paper_form'` and the form pair. Refuses a version with no hash on the server, a platform-wide assignment or support session (db/57's cut, as db/145 uses for honours), and an agreement on or after his eighteenth birthday for the by-terms part. For a `self` link it records the terms and **skips** the by-terms row; it does not raise |
| `guardian_consent_record(guardian, player, version)` (`db/08:1125-1160`; route `assessment-api.mjs:552-555`) | open to the guardian or the office, version from the client, no form | **refuses `-03` and later** (`use_terms_agree`). Otherwise the office could create an agreement with no notice and no form |
| `guardian_link_verify(guardian, player, p_consent_version, note)` (`db/08:987-1024`) | the office's verify-and-consent from one form | **refuses `-03` and later** as a consent version; verification itself is unchanged |
| the `self` link's literal version (`db/08:5949, 5955`; `db/62:236, 242`; `db/92:284, 290`) | `popia-2026-01` | may move to `-03` for the terms; never writes by-terms |
| `guardian_consent_withdraw()`, both `guardian_link_revoke()`s | end the consent, the link | also end the by-terms record (`terms_withdrawn`, `link_revoked`). **They never touch a no** |

**`school_public_basis`** `(school_id, basis, terms_version, set_by, set_at, ended_at)`: one open row per school; history kept. **`platform_public_setting`**: one row, with its own history table.

**`player_never_public`** gains `set_under text NOT NULL DEFAULT 'withhold' CHECK (set_under IN ('withhold','safeguarding'))`; `reason` becomes nullable, with a `CHECK` that it is null for `safeguarding` and present otherwise. A new capability `player.public.withhold.safeguarding` in the `dso` bundle only, with its `ADDED_SINCE_01` line.

### 6.2 Functions

- **`public_name_facts(player uuid, side text, on date, surface text)`**: today's signature is `(uuid, text, date)` (`db/116:440`), so this is a new overload. It returns `consents` already read for the surface by §5.1 line 5 (with `DISTINCT ON (giver_link_id, surface)`, `db/116:452`), `neverPublic`, `namesOff`, and `byTerms`, a boolean worked out in the database for the day (line 6 entire, platform setting included). No date, giver, reason or version leaves it. The old 3-argument function is dropped in the same file; `public_match_people()` (`db/59:284, 293`) and the API's caller move with it. Leaving the old overload in place would keep the existing route writing and reading the old shape.
- **`public_name_consent_set()`** re-emitted from db/116's body: takes `surface`; looks up the open record per surface (`db/116:406`); the pupil's branch is unchanged.
- **`publicName()`** (`packages/policy/src/public.mjs`) gains `surface`, `byTerms` and `byTermsAllowed` and implements §5.1 in order. It stays pure. `byTermsAllowed` is a literal `false` at the overlay's call (§1.3) and for access packs and shared cards (§9.6).
- **`redact.mjs`** `nameFor()` passes `card` or `live` by the fixture's status at serve time. R11's `public_honours()` passes `board` and serves a row only where a name came back. The public JSON never says which line decided, and never a date.
- **`public_name_basis(player, surface)`**: signed in, logged, under `player.public.withhold`, which returns which line governs and the record behind it, never a reason. For `guardian.link.manage` without that capability, and for the parent's Privacy screen, lines 2 and 3 are merged into one answer. It is **not** opened to `audit.read`: that would show a mark to the platform administrator and the director (READERS Q2, `db/116:14-16`).
- **`public_due(school)`**: the pre-publication list, under `player.public.withhold`, logged.

### 6.3 A name that begins on a date (Q8)

A by-terms name begins on `effective_on` with no write on that day; the cache's ceiling makes it appear within a minute or two of midnight. READERS rule 8 says "nothing widens by the clock". My reading is that the widening act is the agreement and the date is a delay on it that the screen stated at the tap. That is a reading of Kameel's rule, so it is his to accept (Q8). The alternative is a second tap after seven days, which is an opt-in by another name.

### 6.4 Audit

Every row above is its own record: who, when, which wording, what the screen showed. The audit log takes each switch change, each by-terms record opened or ended, each mark (a safeguarding mark on the safeguarding log, hidden from the school's audit readers as db/57 hides the rest), each change of a school's basis, and each change of the platform setting with the person and the reason. Public reads are not logged.

---

## 7 · POPIA: the risk, plainly

*This is my reading, not advice. Counsel answers §8.*

**The law as I read it.** Section 34 forbids processing a child's personal information. Section 35(1) lifts that in a short list of cases; the one that fits publishing a pupil's name is (a), the prior consent of a competent person. Section 1 defines consent as a "voluntary, specific and informed expression of will". Section 11(2)(a) puts the burden of proving it on the responsible party; section 11(2)(b) covers withdrawal. Legitimate interests are not in section 35's list. Section 10 separately requires that what is processed be adequate, relevant and not excessive for its purpose.

**Where opt-out is weak.**
- *Expression of will.* A default that is on infers agreement from a parent not switching something off. The Information Regulator's published position on direct marketing, as I understand it, is that opt-out is not consent. Counsel says whether that reads across.
- *Minimality.* Publishing a child's name by default may be more than the purpose needs, whatever the consent. This is the strongest attack on a default.
- *Voluntary.* Agreeing to the terms is the condition for a boy being selected (terms sentence 38).
- *Specific.* One "I agree" covers the whole terms.
- *Informed.* A parent who scrolls to the button has not necessarily read the section; a live page tells strangers where her child is.
- *Adults.* A default agreed by a parent carrying past his eighteenth birthday.
- *Exposure.* An enforcement notice, an administrative fine (to R10 million), civil claims, and the school's and CSA's standing. One child under a protection order named by default is worse than all of those.

**What the design does about each.**

| weakness | the design's answer |
|---|---|
| expression of will | the notice at the tap, with the child's label, each detail and the date; the tap recorded with what each switch showed. Tier B replaces the default with a choice |
| minimality | two surfaces, an initial and surname, no profile across matches, no search indexing; live play outside the default |
| voluntary | every switch on the agreement screen, so the terms can be agreed with nothing public; "changes nothing else" in the terms and in code; `-03` never blocks selection |
| specific | one switch per named detail, closed by constraint; every other publication keeps its own yes |
| informed | a separate notice outside the scrolled text; seven days with the date shown to every guardian; the live page's ground and time said in the notice |
| the child's view | his own no from twelve; he is told when he may use it and when a date is running |
| the child at risk | the safeguarding mark with no reason; the pre-publication list; a no that survives its giver's link ending |
| silence | nothing flips on a notice; no by-terms record without a verified guardian's agreement |
| being wrong | each school adopts it; one logged setting reverts every default-named child; the gate reads each record's stored choice, so the fall to B is real after launch |

**What remains.** In tier A the switches are still on before the parent has touched them. I do not think the mitigations turn that into an "expression of will"; they make it fair, visible and reversible, which is a different thing. If counsel agrees, tier B is the same product with one tap per detail.

---

## 8 · Questions counsel must answer before ship

1. **Is tier A consent?** A guardian's tap on "I agree" to §4.3 with the notice of §4.2, switches on by default and available before the tap: is that the prior, voluntary, specific and informed consent of a competent person (sections 1, 11, 35(1)(a))? Does the Regulator's position on opt-out in direct marketing, or any other guidance or enforcement, read across?
2. **If not, is tier B** (§4.6)?
3. **Minimality and purpose (sections 10, 13).** Is publishing a child's name by default adequate, relevant and not excessive, and is the purpose defined specifically enough?
4. **Bundling.** The terms are the condition of selection. Do the at-agreement switches and "switching off changes nothing else" make the public part voluntary?
5. **Another ground or an authorisation.** Is any other paragraph of section 35(1) available? Is an application under section 35(2) advisable?
6. **One guardian.** Is one guardian's agreement enough where two hold parental responsibilities, given the Children's Act on major decisions, when the other is told the date and can stop it (§4.4)? Must she be told?
7. **The child's view.** Is a veto from twelve, with no say below twelve, enough for the Children's Act's duty to consider the child's views?
8. **A pupil taking his no back** (if Kameel allows it, Q6): his no had no standing in the Act; does lifting it have any effect, and may it lead to his being named?
9. **Eighteen.** May a default agreed by a parent keep naming him after his eighteenth birthday until he acts, or must it lapse?
10. **Who is the responsible party.** The school adopts the basis; SCRBRD writes the terms and sets the default. Is SCRBRD a responsible party for the publication, jointly or alone?
11. **Who may adopt for a public school.** Is a public school a public body with the principal as its information officer, and does adopting a basis for publishing pupils' names need a governing-body resolution (SASA sections 15, 16)? Q4's recommendation depends on this.
12. **Live whereabouts (section 19).** Does naming a child during play, with ground and time, need its own consent or its own safeguard?
13. **Publication to the world.** Is a public web page a transfer outside the Republic (section 72), and does publishing children's information that way need the Regulator's prior authorisation (sections 57(1)(d), 58)?
14. **The notice.** Do the terms and notice meet section 18, naming the recipients as "anyone with the link"?
15. **Withdrawal.** Is "at once, on the past too; a saved copy is beyond our reach" the right account of section 11(2)(b)?
16. **Seven days.** Adequate, or irrelevant to whether consent exists?
17. **CSA.** Does CSA's Safeguarding Policy require a signed consent to publish a child's name in match records, as Annexure C does for images?
18. **The evidence and its retention (sections 11(2)(a), 14).** Is §6.1's record enough to discharge the burden, and how long are by-terms records and notice hashes kept after he leaves?
19. **The marked child.** On a finished scorecard a marked boy may be the one position among named team-mates. Is that a disclosure the school must prevent?
20. **Existing families.** Is a non-blocking re-agreement the right route? (Only if Kameel chooses Q3(b): can a notice followed by silence ever be consent?)
21. **Across several fixtures (added 12 Nov).** A coach who picks the side could narrow down which boy is marked by who is in it. The season-roster rule (12 Nov) closes this for the big screen.

**The fallback ladder, and what each step really costs.**

| counsel says | before launch | after launch |
|---|---|---|
| A is sound | ships as written | — |
| A no, B yes | a setting: `tier_for_new = forced_choice`, defaults disallowed; `popia-2026-04` is issued in place of `-03`; no migration, no new text approval (§4.6 is approved with this document) | the same setting; every child named by an untouched default reverts and his family is asked to choose (§5.3). Not free |
| A sound for scorecards, not the board | the board's `default_allowed` off; the notice draws the board as a choice | the same; default-named board rows go until chosen |
| A and B no | the platform setting stays off; CONSENT_V2's texts are issued | the setting goes off; every by-terms child reverts; tier C's prompt goes to families |

**Tier C is not only a setting.** Slices 2 and 3 serve it, but two things need deciding if it is issued: its single switch (CONSENT_V2 Q1) against this design's per-surface screen, where I would keep the per-surface screen and store a v2 yes as a row per surface; and its sentence 14, which `-02` changed under Q8 (approved 6 Nov) and Kameel snoozed on 11 Nov. The later decision wins: `-02` would be issued with three changed sentences, not four.

A change from counsel to any sentence is a new version of that text.

---

## 9 · What changes in the other documents

Haiku records these after Kameel decides and counsel answers; none is edited before.

### 9.1 `docs/policy/PUBLIC_DATA.md`
- **Header:** the ground stays "the prior consent of a competent person"; how it is given now has two routes; the information officer re-signs (the 28 Sep sign-off covered a separate yes only).
- **Rule 3:** "No name without a competent person's agreement: a separate yes, or, where his school has adopted it, a guardian's agreement to terms whose public notice named it, seven days old. Never against anyone's no, and never while he carries a never-public mark. Before either, he is a position."
- **C1:** the by-terms route and the paper form's boxes. **C3:** "a no never lapses when its giver's link ends, and a no to any wording covers every surface". **C5:** a safeguarding mark records no reason; the family reads one sentence for every school-side cause.
- **New C8** seven days, shown to every guardian. **C9** each school adopts; the platform setting. **C10** three surfaces, a switch each.
- **L2, A6:** the live page while play is on is the `live` surface. **A5:** the board names a boy by a yes that named the board, or by terms. **D2:** role words until the stream's own consent exists; `SURFACES.D2` is no longer `name_rule`.
- **§5a:** the gate's order; "a yes needs a live giver, a no does not"; versions by list; the big screen shows a marked boy by position.

### 9.2 `docs/design/CONSENT_V2.md`
Status: "Fallback (tier C) for PUBLIC_BY_TERMS." §2.1 and Q5 (a v1 no covers the board) are kept and are now the general rule. Its Q1 is reversed if Kameel takes Q2 here. Its "check" on the pupil's no from twelve is answered: built, db/116 §4. Its §7 string-order rule is replaced by the list. If issued, sentence 14 stays as `-01` has it.

### 9.3 `docs/design/GUARDIAN_TERMS.md`
A pointer to `popia-2026-03` and `-04`. §4's rule gains: a version that changes what is public by default is a re-agreement, never an information line, never blocking, and R8a's words for it are the quiet row of §4.4. Agreement at `-03` or later goes through `guardian_terms_agree()` only.

### 9.4 `docs/design/RECOGNITION_design.md` and R11
D11 becomes "one gate, three surfaces". D12's board row: named by a board yes or by terms, otherwise no row. The shared milestone card (D12, designed, not built) names only on an explicit yes. R11 is its own build (slice 8); it reads the gate and adds no rule.

### 9.5 `docs/design/SCRBRD-083_public_pages.md`
Principle 3 gains: the public JSON never says why a boy is or is not named, or when he will be; and §3.4's note that "Batter" is a smaller crowd under opt-out. §2.6: the cache ceiling without doubling for labelled entries; the new tables on the notify list. §5.2: the overlay serves role words until `media_consent`; it never takes the by-terms route. Q9 (the big screen) gains the marked boy's position.

### 9.6 `docs/design/ACCESS_REQUESTS.md`
- **Row K:** each by-terms record and each switch change, with dates and wording.
- **Row K2:** today the family gets "the fact and the date" of a mark (`ACCESS_REQUESTS.md:142`). A pack would then say what the screen hides, and an office mark is usually a protective matter too ("a court order, a custody dispute, a protection order", `db/47:72-73`). **Every mark, whoever set it, appears in a pack as the one sentence of §2.3 and nothing else.** Stricter than K2 as decided; listed in §12.
- **Row M:** why he is or is not shown, in the family's words.
- **D4:** a pack names another child only on an explicit yes; a child named only by terms is a position.

### 9.7 `docs/design/INCIDENTS_AND_BREACHES.md`, and the restore runbook
- **Kind 3, `wrong_public`,** gains: named inside his seven days; named by terms while the school's basis or the platform's was off; named against any no after the cache ceiling; a by-terms record for an unverified, pending or `self` link; a name on a stream caption without its own consent; a mark's existence shown to a family or to another holder. Any naming of a marked child is S1.
- **§6.1, containment,** gains: the platform setting off (the owner or deputy; the next request; every default-named child reverts) and a school's basis back to `separate_yes` (its information officer).
- **Restore.** A restore undoes every no, switch-off, mark and basis change written after the dump (`BACKUP_RESTORE.md:321-325`). Under opt-in a lost no usually leaves a boy unnamed; under opt-out it names him. The runbook gains: after any restore the platform setting (or `PUBLIC_PAGES`) is off before the API serves, and stays off until every no, mark and basis change since the dump has been put back from the audit trail or the families.
- **A legal finding against the basis** after launch is a data event in the register, and the setting goes off the same day.

---

## 10 · What must never be possible

Each is a test or a constraint in the slice that builds it.

1. A child named because nobody answered.
2. A child named by terms before the later of `effective_on` and his school's latest adoption plus seven days.
3. A default outvoting a no: anyone's, of any date, at any wording, on any surface, **including a no whose giver's link has since been revoked, dated out or replaced**. Tested for: the other guardian's old no; the pupil's own; the guardian's own at agreement; a revoked giver; a replaced `self` link.
4. A by-terms record from a `self` link, an unverified or revoked link, a guardian agreeing after his eighteenth birthday, the office without a form, or a platform-wide assignment (db/57's cut). `guardian_consent_record()` or `guardian_link_verify()` recording `-03` or later.
5. A child named by terms while his school's basis or the platform setting is off, or on a `default_on` choice the setting no longer allows.
6. A mark or names-off overridden; the cause of a hidden child distinguishable in public JSON, on a family's screen or in a pack; a safeguarding mark's author or reason visible outside the safeguarding tables.
7. Anything beyond the surfaces of §1.1 reaching the public by this route.
8. A switch's state reaching a coach's, selector's or captain's screen, or any selection, award or scoring path reading it.
9. A photo, a stream caption, a shared card, an access pack, scouting, the passport or health monitoring taking the by-terms route. **Tested on the overlay path.**
10. The platform, support or any job turning a child's name on.
11. A page that carries a label being indexable, or cached past 60 seconds.
12. The notice or terms changing without a new version; a version the server holds no hash for being recorded.
13. An unanswered `-03` prompt changing a link's state or a boy's eligibility.
14. A pupil under eighteen giving a yes; a pupil's no being lifted except as Q6 decides.
15. One guardian's date running without every other verified guardian being shown it.
16. The public pages serving by terms after a restore before the setting is put back on by a logged act.

---

## 11 · Slices, in build order

Everything after slice 1 ships dark: with the platform setting off and every school at `separate_yes`, public reads are byte-identical to today's.

| # | slice | what | tier | proof |
|---|---|---|---|---|
| 0 | **Counsel and the information officer** | §8 answered in writing; PUBLIC_DATA re-signed; the tier chosen | no code | nothing from slice 4 on is switched on without it |
| 1 | **Close the stream caption and the big screen. Now, not waiting on slice 0** | `broadcast_state()` serves role words for every child; `SURFACES.D2` its own rule; the big screen shows a marked boy by position | Opus (db/NN re-emitting `broadcast_state`; minors' data) | a marked, a switched-off and an unanswered child are role words on the overlay read; must-never 9's overlay test |
| 2 | **The rule** | `publicName()` with `surface`, `byTerms`, `byTermsAllowed`; line 5's two rules (B1, B2); the version list and its drift test; no cache doubling for labelled entries | Opus | unit tests for every branch of §5.1; must-nevers 3, 5, 11 |
| 3 | **Surfaces and the no (db/149)** | the `surface` column and index; `public_name_facts()` 4-argument, the old overload dropped; `public_name_consent_set()` per surface; `public_match_people()` and the API caller moved; live or card by fixture status; md5 guards. **Tier C needs all of this too** | Opus; Fable red-team on Kameel's say | `db/99`: the three B1 cases, the B2 cases, two guardians, eighteen; the existing public-name walks unchanged |
| 4 | **By terms (db/150)** | `public_by_terms`; `guardian_terms_agree()`; the two old writers refusing `-03`; `school_public_basis`; `platform_public_setting` and its door; the safeguarding mark and capability; `public_name_basis()`; `public_due()`; notify triggers | Opus; Fable red-team on Kameel's say | `db/99`: must-nevers 1, 2, 4, 5, 6, 13, 15, 16; re-adoption; a `self` link skipped without failing |
| 5 | **The terms and the notice** | `-03` and `-04` constants and hashes; the agreement screen in both tiers; the non-blocking prompt; the other guardian's row and notice; R8a's quiet words; the office's paper dialog | Opus (renders a child's data) | the hash tests; a browser walk for each choice and "Not now"; the co-guardian sees the date and stops it; a11y |
| 6 | **Privacy** | Family → Privacy, Me → Privacy, the office's panel, the one sentence, the birthday rows; Q6's route if decided | Opus | `smoke-public-name` per actor and refusal; a no reaches a finished scorecard on the next request |
| 7 | **The school and the DSO** | the adoption switch; the safeguarding mark's screens; the pre-publication list | Opus | no author or reason outside db/57's tables; the list is logged |
| 8 | **R11, the honours board: its own build** | `public_honours()`, the school page's public route and shell (neither exists; `wip-awards-r11` is stale at 6 Nov), through the gate with `board` | Opus, sized as a build of its own | `smoke-public`: no row inside the seven days, for a board no, an old-wording no, a mark, names off, a withdrawn honour |
| 9 | **The access pack** | rows K, K2, M and D4's explicit-yes rule | Opus (minors' PII) | a by-terms team-mate is a position in a pack; no mark distinguishable |
| 10 | **Runbooks and records** | the restore step, the incidents rows, DEPLOYING's notes; the documents of §9 | Sonnet for runbook text and walks; Haiku for the records | the restore walk ends with the setting off |

Slices 1, 2 and 3 are worth building whatever counsel says. Slices 4 to 7 are the opt-out's own.

---

## 12 · Questions for Kameel

Nine, each closed. ★ changes what a child's name does in public.

| # | question | options | recommendation |
|---|---|---|---|
| ★ **Q1** | **What is public by default, line by line.** | | |
| a | His name on **scorecards after the match** | in / needs its own yes | **In** |
| b | His name on **the live page while play is on**, which shows the ground and the time | in / needs its own yes | **Its own yes**: one switch on the same notice, off until she turns it on. It is the only surface that says where a named child is now. *If you choose "in":* the notice and terms say so in words (§4.3), and a side holding a marked boy is served with names off for the whole side during play (§3.4) |
| c | His name on **the honours board** | in / needs its own yes | **In** |
| d | **Days before anything is first shown** | 7 / 14 / none | **7** |
| e | **The stream caption** until its own consent is built | role words for every child / named on a match-page yes (D2 as decided) | **Role words.** No wording a family has answered names a stream; today it names children with no check at all (§1.3) |
| ★ **Q2** | **A switch per surface, or one switch.** Reverses CONSENT_V2 Q1 (6 Nov). | per surface, plus "Hide everything" / one switch | **Per surface.** Refusing one named thing is what makes a default specific |
| ★ **Q3** | **Families who never respond to `-03`.** | (a) stay exactly as today; (b) a notice, then public after 30 days | **(a).** (b) is consent from silence; I cannot make it defensible |
| **Q4** | **Who switches public by terms on for a school.** | (a) each school's information officer (the principal unless the school names another), by a recorded act; (b) the platform, for all | **(a).** Counsel item 11 may add the governing body |
| ★ **Q5** | **If counsel refuses the default-on.** | (a) tier B, whose words are §4.6: approving this document approves them, so the fall is a setting; (b) straight to the opt-in v2 | **(a).** Before launch it costs nothing. After launch it un-names every default-named child until his family chooses (§5.3) |
| ★ **Q6** | **A pupil of 12 to 17 who has said no: can it be taken back before 18?** Today it cannot (SAFEGUARDING K1, "a no only"). Taking it back can lead to his being named, and invites pressure on a child. | (a) no, as today; (b) he lifts it himself in the app; (c) the office records it from a form he and a guardian both sign | **(c).** A boy should not be held for six years to one tap, and the way back should have an adult and a record in it. His off screen says so before he taps |
| **Q7** | **The DSO's mark.** No reason recorded; only the DSO ends it; the principal, director and office see "only the person who set this mark can end it", with no author. Changes C5's rule that every holder reads the reason, and takes the ending from the principal. | as designed / as today (a reason every holder reads; any holder ends it) | **As designed.** A reason the director of sport can read is not a route a DSO can use |
| **Q8** | **A name that begins on a date.** Your rule is "nothing widens by the clock" (READERS rule 8). The seven days mean a name appears on a date with no further act. | (a) accept: the act is the agreement and the screen stated the date; (b) require a second tap after seven days | **(a).** (b) is opt-in by another name; if you want (b), tier B or C is the cleaner way |
| **Q9** | **Two places the design is narrower than your words.** "Parents and kids automatically accept": only a verified guardian's agreement can publish; a child's own acceptance never does, at any age under 18. "Completely public": the pages stay out of search engines and name him only as an initial and surname. | confirm / change | **Confirm both.** A child cannot consent for himself under POPIA, and `noindex` is a condition of the whole design (§1.4) |

**Stricter readings I have taken; say if you object.**
- Every never-public mark appears to the family, on screen and in an access pack, as one sentence that does not say it is a mark (§2.3, §9.6). ACCESS K2 gave "the fact and the date".
- An access pack and a shared milestone card name another child only on an explicit yes, never on the default (§9.6, §1.2).
- A no given to the old wording covers the honours board and every later surface (CONSENT_V2 Q5, kept), and a no outlives its giver's link.
- The big screen at the ground shows a marked boy by position (§2.5).

---

**To the lead:** Revised in place after `REVIEW.md`. B1–B5 are fixed in the rule (§5.1), the data shape (§6.1) and the must-nevers, each with named tests. The largest change beyond the blockers is that live play is now its own surface, recommended outside the default (Q1b). Nine questions for Kameel, twenty for counsel. I did not open the code the review cites; its line references are carried as the reviewer's findings and marked so in the header. One thing only the lead can settle: whether any overlay is live today (§1.3); slice 1 should go ahead either way.
