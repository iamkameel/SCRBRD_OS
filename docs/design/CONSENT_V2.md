# The public-name consent, version 2, and the terms change

**Status:** approved by Kameel, 6 Nov 2026: "Text approved; all ten as recommended" (§5, all ten as recommended; Q8 included, so four terms sentences change: 14, 19, 20, 23). Counsel reads §6's four items. Built with R11; nothing built yet.
**Kameel's decision this answers (6 Nov):** "Fable drafts the v2 public-name consent and the terms change (popia-2026-02) for your approval; R11 waits; a boy without the new consent has no row at all; staff recognition comes out of R11."
**Read, and nothing else:** `apps/web/src/views/publicname.jsx` (the v1 screen and `publicNameWords`, `PUBLIC_NAME_VERSION`), the `public_name_consent` table header (`version`, `given_on`, `ended_on`, the three end kinds), `GUARDIAN_TERMS.md` (`popia-2026-01`, approved 5 Nov, its eight decisions, §4's rule that any edit is a new version), `RECOGNITION_design.md` §2, §3 (D11–D13, §3.3), §7, Q3, `docs/policy/PUBLIC_DATA.md`.
**The rule I wrote to**, as for the terms: every sentence promises something a design decided or the code does. §4 traces each new sentence and marks the ones that stand on R11, which is not built.

**Version strings.** Today's consent is `public-names-2026-10`. The scheme is `public-names-YYYY-MM`, so the new wording is **`public-names-2026-11`**. The terms go from `popia-2026-01` to **`popia-2026-02`**.

---

## 0 · In one page

The honours board is a new public purpose, so it needs its own named yes (RECOGNITION §3.3; POPIA wants the purpose named). It stays **one consent** (D11, A13): a family answers once for match pages and the board together; a second switch about the same name could disagree with the first.

What changes for a family: the switch's title and words name the board. A yes names him, initial and surname, on match pages and on the board; a no, or no answer, keeps him a position on match pages and **off the board altogether** (Kameel, 6 Nov: no row, not "Player"). A no still reaches every public page at once, finished scorecards and the board included.

A family on v1 keeps exactly what it has on match pages until it answers again; the board shows nothing about the boy meanwhile. The parent's action list carries one row, "answer again (new wording)".

The terms change three sentences (19, 20, 23) and nothing else. I recommend the change is shown to existing families as an information line, not a re-agree (§3.3), because the only new processing needs the separate yes anyway.

---

## 1 · The v2 public-name consent, `public-names-2026-11`

### 1.1 Where it is read

The same place as today: the switch on the child's file (Family → Consents), drawn by `PublicNameSwitch`; the office's copy on Squad → Edit Profile. The title changes. Today's three bullets become six; each sentence of today's that still holds is kept word for word, so a family recognises it. `{label}` is the child's public label as today, initial and surname ("T Bekker"), made from his stored surname and known-as.

### 1.2 The text, as a parent reads it on a phone

> **Show {label} on public match pages and the honours board**
>
> 1. If you say yes, public match pages and the school's public honours board show your child as "{label}": initial and surname, never more. A full name, a first name alone, a photo or a date of birth is never shown.
> 2. On the honours board that means the honour, the season or match it was for, his initial and surname, and the school's few words about it. The school chooses which honours go on its board; you choose whether he is named there.
> 3. The board never shows a photo, a record, a rank among his team-mates, any figure of his across matches, an honour the school has withdrawn, or why.
> 4. Until you say yes, your child is shown by position on match pages, "Batter", "Bowler", and is not on the honours board at all.
> 5. Saying no takes effect at once, on every public page, finished scorecards and the honours board included. A copy someone has already saved or printed is beyond our reach.
> 6. From twelve, your child may say no himself, and his no stands. From eighteen the answer is his.
> 7. You can change your answer at any time, here or by telling the school office. Each answer is kept with its date and the wording it answered.

*One sentence waits on Q3 (a boy who has left the school). If Kameel decides as I recommend, nothing is added: the answer simply keeps counting until the school clears his name, and sentence 7 already says it can be changed at any time. If he decides the board drops a leaver, sentence 2 gains: "An honour stays on the board only while he is at the school."*

### 1.3 Kept, changed, new

| # | kept from v1 | changed | new |
|---|---|---|---|
| title | "Show {label} on public match pages" | "… and the honours board" | |
| 1 | both v1 sentences | "public match pages" → "public match pages and the school's public honours board" | |
| 2 | | | all new |
| 3 | | | all new |
| 4 | "Until you say yes, your child is shown by position: "Batter", "Bowler"." | "on match pages" added | "and is not on the honours board at all" |
| 5 | "Saying no takes effect at once, on every public page, finished scorecards included." | "and the honours board" added | the saved-copy sentence |
| 6 | | | all new (the terms already promise it, sentence 21) |
| 7 | "You can change your answer at any time." | "here or by telling the school office" added | "Each answer is kept …" |

### 1.4 What a yes and a no do, surface by surface (D12, amended by Kameel's 6 Nov decision)

| surface | standing v2 yes | v1 yes only | no, or no answer | never-public mark | names off for his age group |
|---|---|---|---|---|---|
| public match pages, live page, scorecards | "{label}" | "{label}", as today | "Batter" / "Bowler" | position | position |
| the public honours board (R11) | "{label} · Full colours · 2026 · citation" | **no row** | **no row** | **no row** | **no row** |
| the live page's milestone line | "Fifty for {label}" | as today | "Fifty for the Batter" | "… the Batter" | "… the Batter" |
| everything signed in | unchanged | unchanged | unchanged | unchanged | unchanged |

This replaces D12's first row: there is no anonymous "Player · Full colours · 2026" row any more. Every row on the board is a named boy with a standing v2 yes, so D13 (citation only when named) is met by construction. The never-public mark and names-off give the same absence (§3.2's note on why a never-public boy is absent applies to all of them now: a board row with no name is a count that can be joined to a team sheet).

---

## 2 · What a family on v1 sees

### 2.1 Does v1's match-page consent carry on unchanged?

**Yes.** A standing v1 yes was given for public match pages and stays a valid consent for exactly that. `publicName()` keeps reading any standing yes, whatever its version, for match pages, the live page and the milestone line. Nothing about match pages changes for anyone on the day v2 is issued. Only the board (R11) asks for the version: it serves a row only for a standing yes at `public-names-2026-11` or later.

A v1 **no** also carries on: it was a no to naming, and the board is a stricter place than a scorecard, so it needs no re-asking (Q5).

### 2.2 The action-list row (GA-I20)

One row per child, on the list of each verified guardian of a child who has a **standing v1 yes** and no v2 record. It is not urgent; nothing stops while it waits.

> **{label}: answer again (new wording)**
> The school can now put honours such as colours and Player of the Match on its public page. Your yes of {given_on} covered match pages only, and still does. Until you answer the new wording, {label} stays named on match pages as before and is not on the honours board.
> If you say no to the new wording, he is shown by position on match pages too.
> **[ Read and answer ]**

The button opens the child's file at the switch, with the v2 text (§1.2) and one line above it: "New since your last answer: the honours board." The switch shows "On since {given_on} · old wording, match pages only" until a v2 record exists.

The last sentence of the row is there because it is the cost of one switch (D11): a family who wants the scorecard name but not the board can only say no to both. Q1 asks Kameel to confirm that.

### 2.3 What happens before they answer

- Match pages: unchanged, as §2.1.
- The board: no row for the boy, however many honours the school has marked public for him.
- The office's screen (Squad → Edit Profile) shows each guardian's standing with its wording: "On since 3 Oct 2026, recorded by the guardian · old wording (match pages only)". The office may record a v2 yes only from a signed form that carries the v2 words (Q6).
- The row stays until a v2 record exists, yes or no. It never nags: no push, no urgency colour.

### 2.4 What an answer writes (for the Opus builder; not family-facing)

- A v2 **yes**: the v1 record ends `superseded` (the end kind the table already names for "he gave a newer version") and a v2 record opens, `given_on` = `sa_today()`.
- A v2 **no**: the v1 record ends `withdrawn`, and a v2 `refused` record is written the same day. The v2 record must exist, or the action-list row cannot close and the audit cannot show that the family answered the new wording.
- Either drops the public cache through the existing `public_data_changed` trigger. The board must not be cached past the day, as the scorecard is not (D12).

---

## 3 · The terms change, `popia-2026-02`

### 3.1 The sentences that change

Three sentences, all under **What is public, and what never is**. Everything else is `popia-2026-01` word for word.

| # | before (`popia-2026-01`) | after (`popia-2026-02`) |
|---|---|---|
| 19 | Nothing until the school publishes a match; then team scores and results. | Nothing until the school publishes a match or puts an honour on its public honours board; then team scores and results, and that honour. |
| 20 | His name on a public scorecard is an initial and surname, only if you separately say yes; until then he is "Batter" or "Bowler". | His name on a public match page or on the school's honours board is an initial and surname, only if you separately say yes to that; until then he is "Batter" or "Bowler" on a match page, and not on the board at all. |
| 23 | A no takes effect at once, on past scorecards too. | A no takes effect at once, on past scorecards and on the honours board too. |

Sentence 19 must change as well as 20: once a board exists, an honour can be public with no match published (colours are not tied to a match), so "nothing until the school publishes a match" would be untrue. Sentence 23 changes so that the promise of immediacy names the new surface; without it a parent would be right to ask whether "past scorecards" includes the board.

The heading block changes from "Version popia-2026-01" to "Version popia-2026-02".

### 3.2 Everything else the change touches, changed or not

| what | touched how |
|---|---|
| `GUARDIAN_TERMS_VERSION` and the `GUARDIAN_TERMS` constant (`guardianLink.js`) | a second constant beside the first; the old stays for reading past agreements; the hash test must see both |
| the self link written at `'popia-2026-01'` (db/08 5949, 5955, from the school's signed form) | the literal becomes the current version for new links; existing self links stay at -01 |
| the office's confirm dialog and the family screen | render the current version; a link at -01 shows the information line (§3.3) |
| the pilot school's paper equivalent | the school signs -02 as its own terms, as it did -01 (GUARDIAN_TERMS Q8) |
| the word count | 700 → about 715 |
| **sentence 14**, "Team-mates and their parents: his name on the sheet and scorecard, nothing more" | **not changed here**, but it is already narrower than what is built and designed signed in: the side's live fifty notice names him in full, and RECOGNITION's matrix gives team-mates the side's honours and achievements. Q8 asks whether to fold a fix into -02 now. **11 Nov 2026:** sentence 14 needs a redraft naming both exceptions (the Compare card's one team-mate's season figures, GA-I24 D10; the captain's side season figures, 138). For Kameel's approval, then counsel, before -02 is issued; the new sentence is not decided here. |
| sentence 22's never-public list | not changed: a record and a rank are "any figure of his across matches"; the reason an honour was withdrawn is in `NEVER_PUBLIC` already (PUBLIC_DATA §5a) and is "conduct" where it is one |
| sentence 6, "honours" among what is kept | not changed; it already says honours are held |

### 3.3 How existing families are told

**Recommendation: an information line, not a re-agree.** On every link at `popia-2026-01`, the family screen and the office's dialog show: "The terms changed on {date}: the school may now put honours on its public honours board. Read what changed." with the three before/after sentences. The link stays "agreed · popia-2026-01". New links from that date sign -02.

The reason: the only new processing the change describes is the board, and the board names nobody without the separate v2 yes, which names the purpose itself. A forced re-agree of the terms would gain nothing a family has not already been asked, and if an unanswered re-agree were to put a link to `pending_consent`, boys would drop out of selection over a wording change (sentence 38). Q7 puts this to Kameel; GUARDIAN_TERMS §4 left it open ("if Kameel wants re-consent; else only an information line").

---

## 4 · Trace: each new or changed sentence to what makes it true

**R11** marks a sentence that stands on the public honours board, which is not built. Until R11 serves a board, these sentences describe nothing that exists; v2 is issued with R11, not before (§6, build order).

| where | sentence (short) | source | built? |
|---|---|---|---|
| v2 title | public match pages and the honours board | PUBLIC_DATA A5 (the board, names by L2); D11 (one consent) | **R11** |
| v2·1 | both surfaces show "{label}", initial and surname, never more; no full name, first name, photo, DOB | PUBLIC_DATA rule 4, L2, A8, N1; `publicName()` as today; D12 (`public_honours()` calls `publicName()` per row) | match pages built; board **R11** |
| v2·2 | the honour, the season or match, his label, the school's few words | §7 public words ("R Pillay · Full colours · 2026"); D13 (citation only when named; every board row is named under Kameel's 6 Nov rule); D2 (the citation passed the writer-side filter); `honour.kind`, `season`, `match_id` (`player_of_match`) | **R11** |
| v2·2 | the school chooses which honours; you choose whether he is named | D11: `honour.is_public` is the school's switch, the consent the family's; both needed | `is_public` exists; the board **R11** |
| v2·3 | never a photo | A12, PUBLIC_DATA A8 | by construction |
| v2·3 | never a record, a rank, a figure across matches | A11 (no public records or bests), D22 (boards signed in only), PUBLIC_DATA A3, A4 | by construction |
| v2·3 | never a withdrawn honour, or why | D3 (`withdrawn_at IS NULL` for the public), D21 (the board drops the row through `public_data_changed`), D4 and `NEVER_PUBLIC` (the reason) | `NEVER_PUBLIC` built; the board's filter **R11** |
| v2·4 | by position on match pages until a yes | PUBLIC_DATA rule 3, C2; v1 sentence kept | built |
| v2·4 | not on the board at all | **Kameel, 6 Nov 2026**: "a boy without the new consent has no row at all"; replaces D12's "Player" row | **R11** |
| v2·5 | a no at once, everywhere public, finished scorecards included | PUBLIC_DATA rule 6, C3; §5a (consent judged on the day served; no caching past the day); v1 sentence kept | built |
| v2·5 | … and the board | D12 (not cached past the day; `public_data_changed` on `public_name_consent`) | **R11** |
| v2·5 | a saved or printed copy is beyond our reach | RECOGNITION §3.2 "Shared cards already saved" ("the same truth as a printed scorecard"); PUBLIC_DATA D3 (a link shared on WhatsApp is expected). True of any public page today; it does not depend on the G14 share card | by nature |
| v2·6 | from twelve he may say no himself; his no stands | PUBLIC_DATA C1/C4 as changed 21 Oct 2026 (Kameel, READERS Q7); terms sentence 21 already promises it. **Kameel to confirm the pupil's refusal from twelve is built in `public_name_consent_set()`**; the function header on my list names only the guardian, the pupil from eighteen, and the office | **check** |
| v2·6 | from eighteen the answer is his | PUBLIC_DATA C6, §5a (his own record governs once given; a record before 18 counts for nothing); terms sentence 33 | built |
| v2·7 | change it at any time, here or via the office | v1 sentence kept; `PublicNameStaff` (the office records a no on the family's word, a yes from a signed form, PUBLIC_DATA C1) | built |
| v2·7 | each answer kept with its date and wording | `public_name_consent.version`, `given_on`, `ended_on`; C3 (end-dated, never deleted) | built |
| action row | your yes of {given_on} covered match pages only, and still does | `version = 'public-names-2026-10'` on the record; `publicName()` reads any standing yes for match pages (§2.1) | built; the row itself is **GA-I20** work |
| action row | not on the honours board until you answer | Kameel 6 Nov; R11's version check | **R11** |
| action row | a no takes him off match-page names too | D11 (one consent); §5a "a no is never outvoted by an earlier yes" | built |
| terms 19 | nothing until a match is published or an honour put on the board | PUBLIC_DATA rule 1, L1, A1, A5; `honour.is_public` | **R11** for the board half |
| terms 20 | match page or board; initial and surname; separately say yes to that; else position on a match page and not on the board | as v2·1 and v2·4 | **R11** for the board half |
| terms 23 | a no at once, past scorecards and the board | as v2·5 | **R11** for the board half |

**Left out as untraced:** Player of the Match on the public match page (Q4 of RECOGNITION: not in V1); the shared milestone card by name (G14 is designed, not on my list as built; sentence v2·5 covers the truth without naming it); anything about the never-public mark or names-off (the school's acts, never family-facing, as today); clubs (C7: the same rules, nothing to say).

---

## 5 · Questions for Kameel

Each with a recommendation. ★ marks one that changes what a child's name does on a public page.

| # | question | recommendation |
|---|---|---|
| ★ **Q1** | **One answer for both surfaces?** With one consent (D11, A13) a family who is happy with the scorecard name but not the board can only say no to both. | **Yes, one answer.** A second switch about the same name can disagree with the first, which is what A13 refused. The cost is said plainly on the action row and nowhere hidden. If this proves too blunt in the pilot, a v3 can split it; a split cannot be undone as cheaply. |
| **Q2** | **A pupil of 16 or 17: does he see or answer this?** | He **sees** the v2 words on his own screen, as he sees the v1 words today, and may say **no** from twelve as C1 allows; his no stands for both surfaces. He gets **no action-list row** (his parent does); a 16- or 17-year-old is not asked to agree a wording he cannot say yes to. From eighteen the row is his and his parent's yes no longer counts once he answers (§5a). |
| ★ **Q3** | **Does the board name a boy who has left the school?** The honour stays on the side it was awarded for (D22); the guardian link stays open until the later of eighteen and leaving the school system (terms 32); his name is cleared after the retention period by a logged act (terms 30). | **Follow the consent and the lifecycle, no special rule.** He stays named while a v2 yes stands and the school still holds his name; the clearing act removes him from the board as from every public page. His family can switch him off at any time (sentence 7). Nothing is added to the text. The alternative, "an honour stays on the board only while he is at the school", is one sentence in v2·2 and a `player.left_on` check in R11; it also removes the honour the moment a boy moves school mid-season, which schools may not want. |
| **Q4** | **How long does a withdrawn consent keep his past honours off the board?** | **Until a new yes, with no limit**, exactly as scorecards (C3, §5a: judged on the day served). A later yes names him again on old honours and old scorecards at once; the consent records are end-dated, never deleted, so the audit shows both. No sentence needed beyond v2·5 and v2·7. |
| **Q5** | **Who gets the "answer again" row?** | Only a family with a **standing v1 yes**. A v1 no was a no to naming; the board is stricter than a scorecard, so re-asking would read as pressure. A family that never answered has no row today and gets none; the switch shows the v2 words whenever they open it. |
| **Q6** | **May the office record a v2 yes from a signed form?** Today it records a v1 yes from the admission form, naming the form and its date (C1). | **Yes, only from a form that carries the v2 words** (a new admission form, or the school's own consent slip at -11). Never from the old form: it did not name the board. The office's form field gains one line: "This form must name the honours board." |
| **Q7** | **The terms change: re-agree, or an information line?** (§3.3) | **Information line.** The new processing needs the separate v2 yes anyway, and a forced re-agree risks dropping boys from selection over a wording change. New links sign -02. |
| **Q8** | **Sentence 14** promises team-mates and their parents "his name on the sheet and scorecard, nothing more", but the side's live notice "Fifty for Rohan Pillay" is built and RECOGNITION gives team-mates the side's honours and achievements (matrix, D1). Fix it in -02 now, or in a later version? | **Fold it into -02 now**, so families re-read once, not twice: sentence 14 becomes "Team-mates and their parents: his name on the sheet and scorecard, his honours and milestones as the side's news, nothing more." It is outside the brief's "change nothing else", so it is your call; if yes, the count becomes four sentences and §4 gains a row traced to READERS rule 2, D1 and D6. **11 Nov 2026:** sentence 14 needs a redraft naming both exceptions (the Compare card's one team-mate's season figures; the captain's side season figures). For Kameel's approval, then counsel, before -02 is issued. The sentence above is the earlier draft and is not decided by this note. |
| **Q9** | **When does v2 become the current version?** Issuing it before a board exists asks families about a page they cannot see. | **With R11, in one release**: the constant flips, the action rows appear, the board goes live empty of every boy until families answer (that is the 6 Nov decision working as intended). "R11 waits" means it waits for this text, not for the families. |
| **Q10** | **Label form.** The brief says "his chosen label form". Today the label is initial and surname made by the formatter from the stored surname and known-as, and nobody chooses it. | Keep "{label}" as today, with no choice offered; a chosen form (a known-as initial) would be a change to `publicName()`, not to this wording. If you do mean a choice, it is a v3 matter. |

---

## 6 · Counsel

The terms had three sentences for counsel (2, 35, 40, then 43). For this change, counsel reads once, outside the code:

| sentence | why |
|---|---|
| v2·1 and v2·2 (one consent for two named purposes) and terms 20 | consent to a child's information must be "voluntary, specific and informed" (POPIA s1) from a competent person (s34–35); confirm that one answer naming two public surfaces is specific enough, and that naming the board as a purpose in the words is what the Act wants |
| v2·5, terms 23 (a no at once, on the past too; a saved copy is beyond reach) | withdrawal of consent (s11(3)) does not undo processing already done; confirm the saved-copy sentence is the right way to say so to a parent |
| v2·6 (from twelve his no stands) | a child's refusal has no standing in the Act; the school is choosing to honour it. Confirm that promising it is safe (it is stricter, so I expect yes) |
| §3.3's information line in place of a re-agree | confirm that a change describing a new public surface, whose use needs its own separate consent, does not itself need fresh agreement of the terms |

A change from counsel is a new version of whichever text it touches, as GUARDIAN_TERMS Q8 settled.

---

## 7 · Notes for the Opus builder of R11 (not family-facing)

- `PUBLIC_NAME_VERSION = "public-names-2026-11"` replaces the constant in `publicname.jsx`; `publicNameWords(label)` becomes the seven sentences of §1.2, kept pure and tested under node; a static test hashes the words against the version, as the terms do. The old words stay beside it for reading a v1 record on the office's screen ("old wording, match pages only").
- `public_name_consent_set()` keeps accepting any version string the screen sends; the board's read, not the write, is where the version matters. `public_honours()` serves a row only where `publicName()` returned a name **and** the standing record's `version >= 'public-names-2026-11'` (string order works for this scheme); a never-public boy, names-off, no consent and v1-only consent all give no row. `smoke-public` asserts: a v1-only boy has no row; a v2 boy's row carries his citation; a withdrawn honour has no row; a v2 no the same day removes the row.
- The v2 no must write a v2 `refused` record (§2.4), or the GA-I20 row cannot close.
- The office's "Record a yes from a signed form" at v2 carries the one-line reminder of Q6.
- The GA-I20 row's words are §2.2; it is quiet (no push, no urgency); it opens the child's file at the switch.
- The terms: `popia-2026-02` as a second constant beside `popia-2026-01`; sentences 19, 20, 23 (and 14 if Q8 is yes); the information line of §3.3 on every -01 link; new links at -02; db/08's literal for the self link moves with it.
- Staff recognition is **out of R11** (Kameel, 6 Nov): the board serves pupils' honours only; nothing here says anything about staff.
- Floors as today: 12 px, 44 px, `prefers-reduced-motion`; no child's name in a route, a title or a push.

---

**To the lead:** Ready for Kameel, with ten questions. Versions: `public-names-2026-11` and `popia-2026-02`. The terms change three sentences (19, 20, 23), four if Q8 is taken. The v2 text keeps every v1 sentence that still holds and adds four; every sentence traces (§4), with eight marked as standing on R11 and one (the pupil's refusal from twelve) marked for Kameel to confirm it is built. Counsel reads four things (§6).
