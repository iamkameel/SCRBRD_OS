# SCRBRD-138 phase B — The plan to the side: the design

**Status:** for Kameel's review, 2026-10-13. Nothing of phase B is built. Phase A (C1–C5) is built and shipped with no migration (`apps/web/src/lib/captain.js:59`, `apps/web/src/views/family/captain.jsx:68`, `:117`, `apps/web/src/views/matchcentre/captainTab.jsx:80`).
**Source:** `docs/design/SCRBRD-138_captains_view.md` (§3.2 C1, §3.3 C2, §5.2, §9 phase B, D5, D6, A3; the lead's note at line 8); `db/12_news.sql`; `db/91_notification_one_stream.sql`; `db/57_safeguarding_dso.sql` (SG-9's trigger); `docs/policy/CSA_SAFEGUARDING_CHECK.md` SG-9, SG-10, K3; `docs/design/SAFEGUARDING_DSO.md` §1, §4.4, §9.1; `docs/design/STEP4_parent_pupil.md` §1.2, §2.2, §3.3; `docs/policy/PUBLIC_DATA.md` §3, §5a; ADR 0003; `packages/policy/src/roles.mjs` 250–335; `services/api/ai/ai-service.mjs`.
**Reader:** the product owner first; then the Opus agent who builds the migration, the route and the filter, and the Sonnet agent who builds the composer and the block. Plain words come first in each section. Names in the sketches are the seed's illustrative ones (Hilton, Kearsney, D Erasmus, R Pillay, K Naidoo, Mr Dlamini), never a real child's.
**Scope:** phase B only. Phase C (a server-side `is_captain_of()`, a captain's note to the side) is named only where phase B must leave room for it (§6).

**Lead's review (2026-10-14).** Checked against the code. Three assumptions are settled:
PB-A1, the fixture table is `match` (`match_squad.match_id`; `db/09:273` reads its `school_id`,
`team_code`, `away_school_id` and `away_team_code`), so the guard's "either end" is those four
columns. PB-A2, `news_post_withdraw()` sets `published_at` back to null (`db/91:183`), so `<live>`
is `published_at IS NOT NULL` and a withdrawn plan is its author's draft again, as §1.2 hoped.
PB-A5, the web app already imports `@scrbrd/policy` (`auth/OnboardingFlow.jsx`), so the
composer's courtesy check costs only the list's bytes. Two notes for the builder, neither
changing a decision. (1) PB-D4: more than the coach and the team manager hold
`news.publish.team`. Two school-level bundles do (`roles.mjs:190`, `:228`), and so does `media`
(`:480`). At school scope they can write any side's plan. That is still "do not narrow by role",
but Kameel should know who the writers are, and the composer's entry point stays on the coach's
screens. (2) The block's Report button: `notification_report()` takes a notice's id
(`db/91:208`), not a post's. B3's `news` read must return the plan's live notice id, or the block
must open the notice in Notices to report it. Opus decides in B3.

---

## What Kameel decides

1. **PB-D1** · The plan is a `news_post` tagged to a fixture (`db/96` adds `fixture_id` and `kind`), not a table of its own. *Recommended: the post.*
2. **PB-D3** · The audience is the side — everyone `news.read` reaches at that team: the side's boys (sheet or not), their guardians, the side's staff — never narrowed to the sheet or to the captain. *Recommended: the side.*
3. **PB-D4** · Anyone holding `news.publish.team` at the side may write it (the coach; the team manager also holds it, `roles.mjs:291`); the design does not narrow to the coach by role. *Recommended: do not narrow.*
4. **PB-D6** · The word list lives in `packages/policy` as code, maintained by PR; not a table, not per school. *Recommended: code.*
5. **PB-D8** · The filter runs on the plan only in phase B, not on every team post. *Recommended: the plan only, for now.*
6. **PB-D9** · The AI tone line is out of phase B. *Recommended: out.*
7. **PB-D11** · The plan is kept and retained exactly as a post is; no rule of its own. *Recommended: the post's.*

---

## 0 · In one page

Phase A gave the captain a view drawn from reads a team-mate already holds. Phase B adds the one thing it left a gap for: **the coach's plan for the day, to the side.** The 138 design settled the shape (D5, §5.2): one plan per fixture, written by the coach, a post to the side, never to the captain alone, because an adult's private channel to a child is what SG-9 forbids and `db/57:597–609` refuses.

This document settles what the 138 doc left to the build. The plan is a `news_post` with a fixture on it (`db/96`): the read policy, the author stamp, the notice, the withdrawal, the one-tap report and the DSO's reach all already exist for a post (`db/12:73–87`, `:52–58`; `db/91:104–120`, `:25–30`), and a second table would be a second channel to children with all of that to build again. It reaches every reader `news.read` reaches at the side, which is the side's boys, their parents and the side's staff; nobody on another side, nobody at the other school, nobody public. It arrives as the post's own notice in the one stream (`db/91` D9–D10), with no recipient, so the no-pupil-recipient trigger never fires and stays green. Before it can go out, one word list — SG-10's, which today exists only in a policy document — refuses health, absence, discipline and derisive words back to the coach, with the words named, never altered, never stored. A word list is not a tone check; the design says so on the composer, and the audience (the whole side and every parent), the DSO's openable record and the report tap are the real check.

The screens are three: a composer for the coach; one block, THE PLAN, on the fixture screen for every boy and every parent of the side, with the captain's section below it; and one line on the captain's Home card. One migration, `db/96`. Opus builds the migration, the route, the filter and the read; Sonnet the screens; Opus reviews the screens.

---

## 1 · The model: a post tagged to a fixture

### 1.1 Plain words

A plan is a team post that knows which match it is for. Everything else about it — who wrote it, who reads it, how it is withdrawn, how a DSO opens it, how a boy reports it — is what a post already has. The migration adds two columns and three refusals, and nothing else moves.

### 1.2 What `db/96` adds (PB-D1)

`db/92`–`93` are SCRBRD-140 phase 2's and `db/94`–`95` the cockpit's phase B; this is **`db/96`**, in `db/91`'s shape: `ADD COLUMN IF NOT EXISTS`, every function new or `CREATE OR REPLACE`, nothing dropped (`db/91:56–59`).

| change | what | why |
|---|---|---|
| `news_post.kind text NOT NULL DEFAULT 'post'` | `'post'` or `'plan'`; every stored row reads `'post'` | the plan is a plan by a column, not by "a team post that happens to carry a fixture"; the route, the index and the block pick it without guessing |
| `news_post.fixture_id uuid REFERENCES <the fixture table>(id) ON DELETE CASCADE` | null for a post; the match for a plan (PB-A1 names the table) | the anchor the fixture screen draws by |
| trigger `news_post_plan_guard()` BEFORE INSERT OR UPDATE | refuses: a `kind` not in `('post','plan')`; a plan without a fixture or with a scope other than `'team'`; a post with a fixture; a plan whose fixture does not have this `(school_id, team_code)` at either end; a change of `fixture_id` or `kind` once `published_at` is set | the rule is a trigger and not a CHECK on purpose: phase C adds a third kind by `CREATE OR REPLACE` of the function, and the paste tool hangs on a `DROP CONSTRAINT` (`db/91:56–57`) |
| partial unique index on `(fixture_id, school_id, team_code) WHERE kind = 'plan' AND <live>` | one live plan per fixture per side | the 138 doc's "one plan per fixture"; the two sides of one fixture each have their own, because the side is `(school_id, team_code)` |
| `COMMENT ON COLUMN` for both | | as `db/91:73–74` does |

`<live>` is "not withdrawn", in whatever mark `news_post_withdraw()` (`db/91:63`) leaves on the row — PB-A2. If that mark is `published_at` back to null, a withdrawn plan is the coach's draft again, readable by him alone (`db/12:91`), and he edits and re-sends it; that reads well and nothing further is needed.

The existing policies cover the rest without change: a plan is inserted under `news.publish.team` at its anchor (`db/12:97–101`), read under `news.read` at its anchor (`db/12:73–78`), its author stamped from the session (`db/12:52–58`), edited by its author alone (`db/12:118–120`), its notice written by the trigger (`db/91:104–120`) and by nobody else (`db/91:80–92`).

### 1.3 One plan per fixture per side

The index refuses a second live plan. The route turns the refusal into words: "The side already has a plan for this fixture, by Mr Dlamini, Thu 20:10." If the second writer is the author he is offered Edit; if not, he is told who wrote it, and the two adults talk. Only the author edits (`db/12:118`); the author or a `news.publish.school` holder at the school withdraws (`db/91:25–27`). After a withdrawal the index admits a new one.

### 1.4 Who writes it (PB-D4)

Whoever holds `news.publish.team` at that side, which the schema already decides (`db/12:93–101`): the coach (`roles.mjs:272`) and the team manager (`roles.mjs:291`). The assistant coach does not hold it (`roles.mjs:274–286`). The design does not add a role test to keep the team manager out: capabilities are the model, roles are not (ADR 0003), and a team manager who posts the side's plan because the coach is on the bus is doing his job. The composer's entry point sits on the coach's screens, so in practice it is the coach. The other school's coach holds `news.publish.team` at his own side; the anchor check and the guard mean he can tag his own side's plan to the same fixture and nothing else, which is exactly right.

### 1.5 Edit, withdraw, after the match, retention

| event | what happens | what the side sees |
|---|---|---|
| the coach edits a published plan | the author's UPDATE (`db/12:118`); the filter runs again (§3.4); the notice's words re-sync (`db/91:16–18`) | the block shows the current words; the notice reads the new first 280 characters |
| the coach withdraws | `news_post_withdraw()`; the notice is retracted to the same readers (`db/91:18–20`) | the block is gone on the next load; Notices says it was withdrawn |
| the match is played | nothing; the plan stays on the fixture as a post (138 §5.2, fourth bullet) | the past fixture's screen still shows it; C1's line goes when the card goes (§5.3) |
| the fixture is postponed or moved | `fixture_id` stays; the coach withdraws or edits | as above |
| the coach's account ends | `author_id` to null (`db/12:42`) | "Plan from the coaches" in place of a name |
| retention (PB-D11) | the post's; the account-lifecycle design governs posts and is not reopened here | — |

*Rejected — a `match_plan` table of its own:* every rule a plan needs is a rule a post has — a read derived from the anchor, a byline the caller cannot forge, a notice written only by a definer, a withdrawal that retracts it, a report in one tap, a DSO's reach — and a second table is a second channel to children with each of those to build, prove in `db/99` and keep in step. The 138 doc's A3 already said the column is the answer if the post cannot carry a fixture; it cannot (`db/12:20–44` has no such column; `db/91:71` added only `urgency`), so the column it is.

---

## 2 · Who reads it, and how it reaches them

### 2.1 The audience is the side (PB-D3)

A team post reaches "the people `news.read` reaches AT THAT TEAM — which is the parent of a boy in that side, and not the parent of a boy in another one" (`db/12:62–64`). `player` holds `news.read` (`roles.mjs:332`), scoped to his school and team. So the plan reaches:

| reader | reads | why |
|---|---|---|
| every boy on the side's roster, on the sheet or not | yes | he is in the side; the boy left out on Thursday is the one called up on Saturday morning |
| his guardians | yes | `news.read` at the team reaches the parent (`db/12:63`); every adult of the side seeing it is "visible to a second adult" in its clearest form, and a parent sees what her child was told |
| the side's staff | yes | `READ_TEAM` carries `news.read` (`roles.mjs:60`) |
| a boy on another side at the school, and his parents | no | the anchor is the team |
| anyone at the other school | no | the anchor is the school |
| the public | no | `news_post` has no public policy; the page reads nothing |
| a DSO, on a concern | yes, as any post | SAFEGUARDING_DSO §1 principle 2 is about the concern; the post is kept and openable (138 §5.2) |

*Rejected — the sheet only:* a read policy joined to `match_squad` is a new policy on a channel to children, for a privacy from a team-mate that nobody has asked for, and it would hide the plan from the boy who replaces a sick one on the morning. *Rejected — the captain and vice-captain only:* 138 D5; a private channel to two children is a private channel.

### 2.2 Where it is drawn

| surface | who | what | from |
|---|---|---|---|
| **THE PLAN block** on the fixture screen (pupil S3 and parent P3, `FixtureDetail`) | every reader of §2.1 | author, time, the whole body | the `news` read, rows carrying `kind` and `fixtureId`; the client picks `kind === 'plan' && fixtureId === match.id` |
| **C1's line** on the captain's Home card | the captain or vice-captain | "Plan from Mr Dlamini · Thu" and Open | the same read, for the card's fixture |
| **a collapsed row** on the Match Centre's Captain tab | the captain or vice-captain | "THE PLAN · Mr Dlamini", opening to the body | the same read; the 138 moments table (§2.2) names the innings break as the one real moment for it |
| **Notices** | every reader of §2.1 | the post's notice: the title and the first 280 characters | `db/91:104–120`, as for any post |

One block, one place on the fixture screen, drawn **above** the Captain section for everyone, so the captain does not get a second copy inside his section. This supersedes 138 §3.3's sketch, which drew THE PLAN inside the section (§7.4).

### 2.3 The notice, and the phone

The plan writes no notice of its own. Publishing it fires `news_post_notice()` (`db/91:104–120`), which writes one `notice` for the school with the post's scope and team, `news.read`, no child and **no recipient** (`db/91:99–100`). `notification_recipient_not_pupil()` (`db/57:597–609`) fires only on a `recipient_id`; there is none, so it never fires, and `db/99`'s existing assertion that a pupil recipient is refused (SAFEGUARDING_DSO §9.1, "a `recipient_id` naming a pupil is refused unless `kind = 'system'`") stays green with nothing added.

So a boy learns there is a plan the way he learns of any post: the unread count on Home (STEP4 S1, `NOTICES · 1 unread`, STEP4:319), the row in Notices, C1's line, the block on the fixture. Nothing is addressed to him. The phone: a plan is `urgency 'low'` unless the coach ticks the post's existing "Send to phones too" (`'medium'`, `db/91:68–74`); the push is then the post's push as built, a pointer, under the notifications design's rules for children's phones, which this design does not reopen or widen. Nothing here pushes on its own (138 §7).

---

## 3 · The writer-side filter

### 3.1 Plain words

Before a plan goes out, the words are checked against one short list and the plan is refused back to the coach if a word is on it, with the words named. The list is SG-10's — health, absence, discipline and derisive words about a labelled child — and today it exists only as prose in `docs/policy/CSA_SAFEGUARDING_CHECK.md:563–566`; nothing in code holds it, and `ai-service.mjs` has a name-masking check (`:98–122`) and no tone check. Phase B puts the list in one place so the plan uses it now and SG-10's AI discard filter uses the same list when it is built (the lead's note, 138 line 8).

### 3.2 Where the list lives (PB-D6)

`packages/policy/src/words.mjs`: one frozen list, each entry a stem and its class (`health`, `absence`, `discipline`, `derisive`), and one pure function, `refusedWords(text) → [{ word, cls }]`, whole-word and case-insensitive with the lookaround shape `maskNames()` uses so an initial's full stop or a bracket does not hide a word (`ai-service.mjs:116–117`). No table, no settings screen, no per-school list: the list is a safeguarding rule, and a school must not be able to loosen one; a table would need RLS, an editor and a maintainer, and ADR 0003 says no new role for that. It changes by PR, reviewed by the lead; a DSO or a coach proposes a word through the backlog. The first list is SG-10's English words plus the health and absence words in §3.3; words in the pilot school's other languages are added by the same route.

### 3.3 What it checks

| class | the words, by example | why |
|---|---|---|
| health | physio, injur-, hamstring, concussion, sick, ill, unwell, niggle, rehab, doctor, medical, workload, restricted, unavailable | K3: a pupil holds no medical tier at all since `db/55` (`roles.mjs:315–323`); PUBLIC_DATA N2 treats even "unavailable" as health (§3); "Naidoo is on four overs, physio" is the 138 doc's own example |
| absence | excused, sick note, grounded, exam-, suspended | no reason for anyone's absence (138 §5.2); the sheet is the side |
| discipline | detention, disciplin-, conduct matter | another boy's discipline is never in front of children (PUBLIC_DATA N3; SAFEGUARDING_DSO §1) |
| derisive | shocker, howler, embarrassing, and the rest of SG-10's list | mocking is bullying (CSA p39, SG-10) |

Words a plan needs are not on it: "away", "rest" (as in "the rest of the order"), "out", "load" (the off side), "limit" — each would refuse a true plan, and a list that cries wolf is turned off in the coach's head. "Four overs" is not a health word; "physio" is.

### 3.4 On a hit

The route is the gate: the news publish route (the one that owns `POST /api/news/:id/withdraw`, `db/91:63`; the build map names the file) runs `refusedWords()` over the title and body on every write that makes or keeps words published — Send, a draft being sent, and an edit of a published plan — and on a hit returns the refusal and writes nothing. The same function runs in the composer as the coach types, so he sees the refusal before he taps Send; the server is the authority, the client a courtesy. The words of the refusal:

> This can't go to the side with **physio** in it. A plan is read by every boy in the side and their parents. A boy's health is not for it. Change the words and send again.

One sentence per class (health: "A boy's health is not for it"; absence: "Why a boy is not playing is not for it"; discipline: "A boy's conduct is not for it"; derisive: "The side reads this about a team-mate"). Every refused word is named, so the coach is never guessing which one.

*Rejected — the list as a SQL function on a trigger:* the database would then hold a second copy of the list, which is the one thing the lead's note forbids; the database's job here is the audience and the anchor, and the words are the application's. The cost is that the words' proof is a policy unit test and a route test, not a `db/99` section (§7.2).

### 3.5 What the filter never does

- **Never alters the text.** It refuses or it passes; no word is replaced, softened or cut.
- **Never stores the refused text.** No draft is written on a refusal; no log row carries the words or the text. The text reaches the route and goes no further.
- **Never tells the side.** A refusal is the coach's screen and nobody else's; no notice, no mark on the fixture.
- **Never reads anything but the string.** It is a pure function of the text: no roster, no injury table, no availability row is consulted to decide. The filter cannot leak what it never reads.
- **Never stands alone.** The honesty line on the composer, the DSO's reach, the author's and the school's withdrawal and the reader's one-tap report stand beside it (`db/91:22–30`).

### 3.6 Its limits, said plainly

A word list catches words, not meaning. "Naidoo bowled like a drain last week" passes. "Their keeper drops everything" passes, and is a judgement about another school's child. "Smith's mum says he can't make it" passes, and is a reason for an absence. The design does not pretend otherwise: the composer says who reads the plan above the Send button, the plan is kept and a DSO can open it, and every reader — a nine-year-old included — can report it in one tap (`notification_report()`, `db/91:28–30`). The list's job is the obvious slip, caught before it goes out, with the words back to the coach so the next plan is cleaner.

### 3.7 The AI tone line: out (PB-D9)

A model judging a coach's words before he may speak to his side is a bigger decision than this phase, it is a runtime cost on every plan, and `ai-service.mjs` has no such check to reuse. SG-10's tone check is SG-10's own item, Opus tier, for AI lines; when it is built it imports the same list (§3.2). Nothing in phase B forecloses it: the route has one place where the check runs, and a second check slots in beside the first.

---

## 4 · What a plan never says, and how that holds

| never | held by |
|---|---|
| anybody's health, fitness, return date, load, guideline, "restricted", "on four overs, physio" — any status at all, because a pupil's tier is none (K3, `db/55`) | the filter's health class (§3.3); the structure: the composer has no field for who is out, the sheet beside it is the side; the honesty line |
| why anybody is absent | the filter's absence class; the sheet is the answer (138 D7) |
| another boy's discipline or a conduct matter | the filter's discipline class; SAFEGUARDING_DSO §1 |
| a derisive word about a labelled boy | the filter's derisive class (SG-10) |
| another school's child beyond the public label — initial and surname, where consented (PUBLIC_DATA §5a) | **not the filter's:** it cannot know names and reads no roster. The composer's reminder: "Name the other side's boys only as the public scorecard does." The DSO and the report tap after that |
| a photo or an attachment | the structure: the plan is words; no media until SCRBRD-092 (SG-9 rule 5) |
| a pupil's own words back to the coach | not in phase B (138 D6); the block has no reply |

The three layers in one line: **structure** (one body, no per-boy field, no attachment, the sheet read-only beside it), **the filter** (words refused, named), **the adult's responsibility** (the honesty line, the kept post, the DSO, the report tap, the withdrawal by the author or the school).

---

## 5 · Screens

Described, not drawn. The floors stand: nothing under 12px, nothing tapped under 44px, `prefers-reduced-motion` honoured, the `T` tokens as `captain.jsx:82–102` uses them and nothing new.

### 5.1 The coach's composer

Reached from the coach's fixture (wherever he opens a fixture today; the build map names it) and from the news composer with "This is a plan for a match". Portrait at 390 first.

- **The fixture picker:** his sides' fixtures where he holds `news.publish.team`, the next first, live ones marked; a fixture that already has a live plan says "Plan by Mr Dlamini · Thu — Edit" when it is his and "Plan by Mrs Pillay · Thu" when it is not (§1.3). One tap, 44px rows.
- **The side's sheet**, read-only, beside or above the body: names and places as `SideSheet` draws them, so he writes the order against the sheet he published. Nothing from it is copied into the post by the screen; what goes out is what he typed.
- **The title** is made by the screen — "The plan: v Kearsney, Sat 3 Oct" — and is not his to edit; the notice's first line is then always the fixture.
- **The body:** one field, 1 000 characters (the route refuses more for a plan; the column's 4 000 CHECK, `db/12:36`, stays), a count from 900. A plan is read on a bus.
- **The honesty line**, above Send, always: "Read by every boy in the side and their parents. Kept with the fixture; a DSO can open it. Name the other side's boys only as the public scorecard does."
- **"Send to phones too"**: the post's existing `medium` option, unchanged.
- **Save draft · Send to the side.** A draft is his alone (`db/12:91`).
- **The refusal:** inline under the body, in words (§3.4), the refused words named and marked in the text; Send is disabled until the words change; no modal, no animation. `aria-live="polite"` on the refusal so it is read out.
- **Edit and Withdraw** on his own published plan; Withdraw asks once and says the side will be told it was withdrawn.

### 5.2 THE PLAN block (every boy, every parent)

On the fixture screen under the sheet and above the Captain section, for every reader of §2.1, only when a live plan exists; otherwise nothing is drawn and no space is held (`captain.jsx:12`'s rule).

```
THE PLAN · Mr Dlamini · Thu 20:10            T.role.label
"Bat first if we win it. Naidoo and          T.role.body, the whole body, no truncation
 Smith open the bowling …"
                                     [ Report ]   the post's one-tap report, as Notices has it
```

No reply, no reaction, no "seen". Withdrawn: gone on the next load. The parent's P3 draws the same block; it is one component, `PlanBlock`, with `data-testid="plan-block"`.

### 5.3 C1's line

`CaptainCardFor` (`captain.jsx:77–94`) gains one `Line` after "N named in the side": "Plan from Mr Dlamini · Thu", with the card's existing action opening the fixture (`captain.jsx:88`) where the block is; `data-testid="captain-card-plan"`. Drawn only when a live plan exists for the card's fixture. The card itself is unchanged in when it draws (the gate, and a fixture within seven days or live, `captain.jsx:70–73`), so the line goes when the card goes.

### 5.4 The Captain tab's row

After the Board on `CaptainTab` (`captainTab.jsx:119`), a 44px row "THE PLAN · Mr Dlamini" that opens to the body as a cut, not a slide; closed by default so the Board stays first; `aria-expanded` on the row. Drawn only when a live plan exists.

### 5.5 Words and floors

Every string is under `tenantWords()`' conventions where the 138 doc uses them; "the side" stays "the side" for a club. Figures none. The refusal and the honesty line are 14px body; the label 12px at the floor. Nothing here moves, so reduced motion has nothing to switch off, and that is the point.

---

## 6 · Phase C, not foreclosed

- **A captain's note to the side (138 D6)** would be a `news_post` of a third `kind`, tagged to the fixture, by a pupil under an honour-gated publish. `db/96`'s guard admits a kind by `CREATE OR REPLACE` (§1.2), the index is `WHERE kind = 'plan'` and does not touch it, and the filter runs on it word for word.
- **`is_captain_of()`** is not built here and nothing here needs it: the plan's readers are decided by `news.read` at the team, and the captain's line and row are client reads of his own honour as phase A does (`captain.js:59`).
- **SG-10's AI tone check** imports `words.mjs` and runs beside the plan's check (§3.7).
- **The filter on every team post (PB-D8)** is a one-line change at the route when Kameel wants it.

---

## 7 · Build plan

### 7.1 Items and tiers

| # | item | tier | why that tier |
|---|---|---|---|
| B1 | `db/96_news_plan.sql`: `kind`, `fixture_id`, `news_post_plan_guard()`, the partial unique index, comments (§1.2) | **Opus** | a schema change on a channel to children |
| B2 | `packages/policy/src/words.mjs` and its test: the one list, `refusedWords()` (§3.2–3.3) | **Opus** | policy; minors' data by construction |
| B3 | the news publish route: accepts `kind` and `fixture_id`, the 1 000 limit, the filter as the gate on Send and edit, the refusal's words and the index's words (§1.3, §3.4); the `news` read exposing `kind` and `fixtureId` | **Opus** | the route is the gate |
| B4 | `db/99` section for phase B (§7.2) | **Opus** | RLS proof |
| B5 | the composer (§5.1) | Sonnet; **Opus reviews** | a screen over an API that exists after B3 |
| B6 | `PlanBlock` on the pupil's and the parent's fixture screen; C1's line; the Captain tab's row (§5.2–5.4); `planOf()` in `lib/captain.js` (pure: the live plan for a fixture from the `news` rows) | Sonnet; **Opus reviews** | minors' data on screen, as phase A was |
| B7 | walks and tests (§7.3) | Sonnet writes; Opus the `db/99` part | |
| B0 | before B1: the build map — files, routes, the fixture table's name, the withdrawal mark, the coach's fixture screen, the news route's file, `file:line` | Haiku | CLAUDE.md's standing step 1 |
| B8 | after merge: the 138 doc's status line and A3, the roadmap, the gap plan, `DEPLOYING.md`'s paste list for `db/96` | Haiku | standing step 3 |

One Opus agent for B1–B4 together: the migration, the list, the route and the proof are one change and one review.

### 7.2 `db/99`, one section (the lead numbers it)

Proves, each as a separate assertion, with the seed's two schools and two sides:

- the coach of Hilton U15A inserts a plan for the fixture; the captain reads it; a team-mate on the sheet reads it; a boy on the U15A roster **not** on the sheet reads it; a guardian of a U15A boy reads it; the side's team manager reads it;
- a boy on Hilton U15B reads **zero** rows; his parent zero; Kearsney's coach zero; Kearsney's U15A captain zero; an anonymous read zero;
- the plan's notice exists with `recipient_id IS NULL` and `subject_kind = 'news'`; no `notification` row written in the section names a pupil, and `db/57`'s existing refusal is exercised once beside it and still refuses;
- a second live plan for the same fixture and side is refused (the index); after `news_post_withdraw()` a new one is accepted;
- a plan for a fixture that is not this side's is refused (the guard); a plan with `scope 'school'` is refused; a `kind 'post'` with a fixture is refused; a change of `fixture_id` on a published plan is refused;
- Kearsney's coach inserts a plan for the same fixture for his own side, and no Hilton reader reads it;
- the assistant coach, holding no `news.publish.team`, is refused the insert.

The words are **not** proved here (§3.4, rejected): `packages/policy/test` proves each class hits, a clean plan passes, "away", "rest", "out" and "load" pass, a stem matches its forms, an initial's full stop hides nothing; the route's test proves a hit returns the refusal and writes no row, on Send and on an edit.

### 7.3 Walks

- `smoke-browser-pupil` gains a plan group: the seed's coach writes a plan with "physio" in it and is refused with the word on the screen; writes a clean one; the captain's card shows the line; a team-mate's fixture screen shows the block; the parent's fixture screen shows the block; a boy on another side sees no block; the Captain tab's row opens; the coach withdraws; the block and the line are gone on the next load; Notices says it was withdrawn; no notification row carries a `recipient_id`.
- `smoke-a11y` over the composer, the refusal (read out) and the block.
- `apps/web/test/family.test.mjs`: `planOf()` picks the live plan for the fixture and nothing for another; `CaptainCard` draws the line only with a plan.
- `separation.test.mjs` unchanged: no capability moves.

### 7.4 What this supersedes in the 138 doc

| where | it says | now |
|---|---|---|
| line 3, status | "nothing built yet" | phase A built and shipped, no migration (Haiku records the date at B8); phase B designed here |
| A3 (line 328) | `coach` holds `news.publish.team`, and a post can carry a fixture | the first is true (`roles.mjs:272`); the second is false (`db/12:20–44`, `db/91:71`): `db/96` adds it |
| §3.3, the sketch (lines 122–125) and the table's "the plan" row (142) | THE PLAN drawn inside the Captain section, first | one `PlanBlock` on the fixture screen above the Captain section, for every reader; the section does not draw it (§2.2) |
| §3.2 C1 (line 94) | "Plan from Mr Dlamini · Thu [Open]" | as drawn; Open is the card's existing action to the fixture (§5.3) |
| §5.2 (line 234) | "readable by every boy named on the sheet and by the side's staff" | by everyone `news.read` reaches at the side: the roster, their guardians, the staff (§2.1, PB-D3) |
| §5.2 (line 241) | "The same filter the AI line already passes through" | no such filter exists in code; phase B makes the one list (§3.2) that both use |
| §9 phase B row (line 299) | "one, if `news` cannot be tagged" / the filter proved in `db/99` | one, `db/96`; the words proved in policy and route tests, the audience in `db/99` (§7.2) |
| §7 (line 268) | "Nothing pushes … a pointer" | stands; the post's `medium` option is the only push (§2.3) |
| `captain.jsx:11–12` | "The coach's plan waits for phase B and is not drawn here, nor is a place held for it" | the plan is `PlanBlock` on the fixture, not the section; the header says so |

---

## 8 · Decisions

| # | decision | recommendation | why, in one line |
|---|---|---|---|
| **PB-D1** | A `news_post` with `fixture_id` and `kind`, or a table of its own | **the post, `db/96`** | every rule a plan needs a post has; a second table is a second channel to children |
| **PB-D2** | One live plan per fixture per side, by a partial unique index | **yes** | the 138 doc's "one per fixture"; the side is `(school_id, team_code)` |
| **PB-D3** | The audience: the side as `news.read` reaches it, guardians included; never the sheet only or the captain only | **the side** | the dropped boy is the one called up; a parent is the second adult; no new policy |
| **PB-D4** | Who writes: any `news.publish.team` holder at the side (coach, team manager) | **do not narrow by role** | capabilities are the model (ADR 0003); the index tells the second writer who wrote it |
| **PB-D5** | The kind and fixture rules as a trigger, not a CHECK | **trigger** | phase C adds a kind by `CREATE OR REPLACE`; the paste tool hangs on a drop |
| **PB-D6** | The word list as code in `packages/policy`, by PR | **code** | a safeguarding rule a school must not loosen; one copy for the plan and for SG-10 |
| **PB-D7** | The filter at the route (and as a courtesy in the composer), not in SQL | **route** | no second copy of the list; the database holds the audience, the application the words |
| **PB-D8** | The filter on the plan only, or on every team post | **the plan only, for now** | every name in a plan is a child's; a school notice is not; extend later by one line |
| **PB-D9** | The AI tone line in phase B | **out** | no check to reuse, a runtime cost, a bigger decision; the list is shared when SG-10 builds it |
| **PB-D10** | On a hit: refuse with the words named; never alter, never store, never tell the side, never log the text | **as stated** | a filter that rewrites a coach's words or keeps his refused ones is worse than none |
| **PB-D11** | Retention and keeping: the post's | **the post's** | nothing in a plan is a record about a child by construction; the lifecycle design governs posts |
| **PB-D12** | The block once, on the fixture screen above the Captain section, for everyone; a line on C1; a collapsed row on the Captain tab | **as stated** | one component, no second copy for the captain; the innings break is the one Match Centre moment |
| **PB-D13** | The body at 1 000 characters, the title made from the fixture | **yes** | a plan is read on a bus; the notice's first line is then the fixture |
| **PB-D14** | No reply, no reaction, no "seen" on the block | **none** | 138 D6; a "seen" is a per-child record nobody asked for |

## 9 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **PB-A1** | the fixture table that `match_squad.match_id` and `match_pitch_report` anchor on is the one `fixture_id` references (the build map names it) | the reference names whichever table a fixture is; nothing else changes |
| **PB-A2** | `news_post_withdraw()` (`db/91:63`) leaves a mark on the row the index's `<live>` predicate can read — `published_at` back to null, or a column | if withdrawal leaves no mark on `news_post`, `db/96` adds `withdrawn_at` and the function is replaced to set it |
| **PB-A3** | the `news` read returns the post's rows to a pupil and a parent at the team today (STEP4 §1.2 job 6) and can carry two more columns | the read gains them in B3 either way |
| **PB-A4** | the post's `medium` push is already under the notifications design's rules for children's phones | the plan does not widen it; the rule is that design's to settle |
| **PB-A5** | the web app can import `@scrbrd/policy` as it imports `@scrbrd/scoring` (`captain.jsx:15`) within `tools/check-bundle.mjs`'s ceiling for a list of some sixty words | the composer's courtesy check is dropped and the route's refusal is the only one; the behaviour is the same |
| **PB-A6** | the seed's coach persona holds `news.publish.team` at the pupil persona's side, so the walk can write the plan | the walk assigns it inside its own run |
| **PB-A7** | the Notices screen opens a `subject_kind 'news'` notice as the post, as it does today | the plan's notice is opened the same way; no change |

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `news_post`, `news_post_read`, `news_post_read_own`, `news_post_insert`, `news_post_update`, `news_post_author()` | `db/12_news.sql:20–122` | the model; who writes; who reads; the byline |
| `news_post.urgency`, `news_post_notice()`, `news_post_withdraw()`, `notification_report()`, the two `RESTRICTIVE` notice policies | `db/91_notification_one_stream.sql:71–120`, `:63–65`, `:80–92` | the notice; withdrawal; the report tap; nobody else writes a notice |
| `notification_recipient_not_pupil()` | `db/57_safeguarding_dso.sql:597–609` | the refusal the plan never meets, because it addresses nobody |
| `coach`, `teammanager`, `assistantcoach`, `player` bundles; `READ_TEAM` | `packages/policy/src/roles.mjs:250–335`, `:60` | who writes; who reads |
| `maskNames()`'s word-boundary shape | `services/api/ai/ai-service.mjs:104–122` | the filter's matching |
| SG-9, SG-10, K3 | `docs/policy/CSA_SAFEGUARDING_CHECK.md:527–567`, `:145–166` | the channel rule; the list; the pupil's tier |
| N1–N5, §5a | `docs/policy/PUBLIC_DATA.md:69–84`, `:135–162` | what is never in front of children; the public label |
| `captaincyOf()`, `sheetOf()`, `CaptainCard`, `CaptainSection`, `CaptainTab` | `lib/captain.js:59`, `:81`; `views/family/captain.jsx:68`, `:117`; `views/matchcentre/captainTab.jsx:80` | where the line, the block and the row go |
| ADR 0003 | `docs/adr/0003-job-titles-are-not-roles.md` | no role for the writer, no role for the reader |
