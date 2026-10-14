# GA-I27 — Evidence-linked coach cards: the design

**Status:** Decided 14 Oct 2026; build not started.
**Source:** `audit/GAP_ANALYSIS_2026-10-05.md` ("The decision"; Phase C row "I26a, I27, I29, I32"); `docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md` §0, §3.6, §3.7, §4, §7, §10, Appendix A; `docs/design/SCRBRD-136-137_phaseB.md` (PB-D1–D11, decided 13 Oct); `apps/web/src/lib/signals.js` and `views/cockpit/useCockpit.js` (branch `claude/wip-cockpit-b`); `apps/web/src/lib/cockpitNever.js`; `views/cockpit/FeedDrawer.jsx`; `docs/design/GA-I24-I25_compare_and_combine.md` D7, D14, §4, §5; `docs/design/GA-I36_corrections_everywhere.md` §0, D1, D2, §2.3; `docs/design/SCRBRD-110_workload.md` §3.3, §4.2; `docs/adr/0002-coach-medical-overview.md`. Line numbers in `read-api.mjs` and `db/60` are as phase B and GA-I24-I25 cite them; this document did not reopen those files.
**Reader:** Kameel on a phone first; then the Opus lead; then the Opus agent who builds the evidence model and (if chosen) the table, and the Sonnet agent who builds the disclosure. Names in examples are the seed's illustrative ones (Hilton, Westville, Kearsney, D Erasmus, R Pillay, K Naidoo), never a real child's.
**Scope:** GA-I27 only. It does not reopen D1–D16 of the 136 doc, PB-D1–D11, 110 §3.3/§4.2, ADR 0002, GA-I24-I25's refusals or GA-I36's model. I26a (assessment history and the drill loop), I29 and I32 share its gap-analysis row and are named only where this design leaves them a seam.

**Lead's review (2026-10-14).** Checked against the code on `claude/wip-cockpit-b` (PR #141): `RULES` (`signals.js:44–60`), `card()` (`:84–88`), `evaluate()` (`:391`), the drawer's source line (`FeedDrawer.jsx:77–82`), `NEVER_ON_THE_COCKPIT` and `FORBIDDEN_FIELDS` (`cockpitNever.js:15–16, 24–27`) and the `player.development.*` holders (`roles.mjs:178, 260, 277`) are as cited. Three notes, none changing a decision. (1) "Phase B: nothing built" is true of main only until #141 merges; S2c and `useBowlerDay` are on that branch. (2) db/95 is free: `signal_ack` is not being built (PB-D5), so the lead numbers slice 2's table when it is built. (3) The drift §12 lists in the 136 doc (S7 reads `readiness`, S8's first-aider slot, S12's gate, the moved `isSeen`/`markSeen` lines) is recorded by Haiku after this merges; none is a fault in the code.

---

## What Kameel decides

**Decided 14 October 2026 (Kameel): every recommendation below, as written.**

1. **What a card is.** Recommendation (C-D1): **two kinds.** A *signal card* is what the drawer draws today (`signals.js:44–60`), derived on read, stored nowhere, and it gains an evidence trail now with no migration. A *coaching point* is a sentence the coach writes about one boy, pinned to the evidence it stood on; it is stored, and it is slice 2, built with I26a, one table. Alternative: signals only, no coaching point. Why not: the brief names the coach's own notes, and I26a will need the same evidence pointer.
2. **Where the evidence comes from.** Recommendation (C-D2): **the rows the rule already read, in the browser; no new read, no new gate, no new row.** The trail is the card's own working shown, not a second query. Alternative: a server function returning evidence per card (phase B §7's `coach_signals()`). Why not: PB-D9 keeps that behind a measured trigger, and a trail over the same rows cannot widen a gate.
3. **How the coach opens it.** Recommendation (C-D3): **a disclosure on the card ("Where this comes from"), then one link to the existing screen that holds the full figures.** No evidence-only route, no new destination. Alternative: a sheet per card. Why not: 136 D2's "no fifth destination".
4. **The coaching point's gate and what it stores.** Recommendation (C-D4): **one boy per point; `player.development.*` tier, RESTRICTED and logged as skills are; evidence stored as a pointer (rule, read, parameters, head, as-of) plus the card's lines only when every capability in the card's `via` is `fixture.read` or `player.performance.read`; a load card's figures are re-derived on read under the reader's own `player.workload.read`.** Reaches no pupil and no parent through this design (138's rule decides if it ever does). Alternative: store every card's lines. Why not: a load word in a development row is read by a different tier than wrote it.
5. **Corrections and "as of".** Recommendation (C-D5): **every signal card says when its read answered and, where it stands on the fold, the match's head `seq` (GA-I36 D1); a coaching point shows "stood on" and "now" side by side when the figure has moved, and never replaces the old line.** Alternative: re-derive and overwrite. Why not: GA-I36 keeps both versions.
6. **What a card may do.** Recommendation (C-D6): **a link to where the act already lives; the drawer itself still writes nothing.** "Make a coaching point of this" opens the boy's development panel with the pointer pre-filled; the write happens there, under that screen's gate. Alternative: a write route from the drawer. Why not: PB-D5 — "the feed writes nothing" is worth more than a saved tap.

Everything else below is a design call made with reasons, and is Kameel's to overturn.

---

## 0 · In one page

Today a card is a true sentence with its source named and nothing behind it: "D Erasmus v left-arm spin · 48 balls · 31 runs · out 3 times" (`signals.js:273–275`), drawn with "From matchups, matchup_coverage. You see it through coach with player.performance.read" (`FeedDrawer.jsx:77–79`) and a Seen button (`:80–82`). The gap analysis's rule for every Phase C item is "source, unit, window and denominator shown"; the card shows the source and nothing else, and a coach who doubts the 48 has nowhere to tap.

**This design adds a trail to every signal card, from the rows the rule already read.** Each rule already holds them: S11 has `overs7d`, `loadWord`, `estimated7d` in hand (`:357–359`); S5 has the balls, the runs, the dismissals and the coverage (`:272–275`); S1 has the capacity, the named, the lifts (`:131–134`). The trail is those figures, each with a label and a unit, under a line that names the read, its window, its denominator and when it answered. It is computed in the same pure function (`evaluate`, `:391–395`), so it is proved under plain node, it is gated exactly as the card is (a figure the rule did not read cannot appear), and the drawer still writes nothing (D11, A4, PB-D5).

**The coaching point is the first thing the cockpit stores,** so it is kept small and kept out of the drawer: a sentence by a coach about one boy, written on the boy's development panel, carrying the card's pointer. It lives in the development tier (skills, ratings and notes are already a named coach's judgement of a named child, GA-I24-I25 D5), is logged, never reaches a pupil or a parent through this design, and never names a second boy. It is slice 2, with I26a, one migration the lead numbers.

**What never changes:** who may open the drawer (136 §1.2, D1); the twelve rules and eight refusals (§4.3, §4.4); the never-regex and the forbidden fields (`cockpitNever.js:15–16, 24–27`), which now also police the trail; 110 §3.3 (no flag), §4.2 (a guideline passed is a line); ADR 0002 (status on the cockpit, the nature on the Injuries screen, D4). The team manager's drawer still says nothing is hidden, and the trail never says a read was made that he cannot see.

---

## 1 · The card model

### 1.1 Plain words

A card is a claim and its working. The claim is the sentence; the working is the figures it stands on, where they came from, over what period, out of what, and as of when. For a signal card the working is derived at the same instant as the claim, from the same rows. For a coaching point the claim is the coach's and the working is borrowed from a card, kept as it was, and re-derived beside it later.

### 1.2 The signal card — derived, no storage (C-D1, C-D2)

`Card` (`signals.js:65–77`) gains one field, `evidence`, filled by every rule through one helper beside `card()` (`:84–88`):

```
evidence: {
  read:        "workload",                  // the read's name as read-api names it; or "fold" for the frozen log
  params:      { teamCode: "HIL-U15A" },    // never a player id of a boy not on this card
  window:      "the 7 days to today",       // words
  denominator: "overs begun, every match",  // words, or null where the figure is a count of rows
  unit:        "overs",
  asOf:        1760450000000,               // ms: when the read answered (new: reads.at[read], §4.1)
  head:        412 | null,                  // the match's head seq, fold-derived cards only (GA-I36 D1)
  figures:     [{ label: "this week", value: 6, unit: "overs" }, { label: "word", value: "rising (estimate)" }],
  screen:      { route: "workload", label: "Open the Workload screen" }   // an existing route, same gate
}
```

Three rules hold it to the gate it already has:
- **`figures` draws only from fields the rule read.** The static test (`apps/web/test/signals.test.mjs`, 136 §9) already scans the rules for `FORBIDDEN_FIELDS` (`cockpitNever.js:24–27`); it scans the helper and every `figures` label and value for `NEVER_ON_THE_COCKPIT` (`:15–16`) too.
- **`params` names a boy only when the card does.** S7's trail is "4 of 13 named have not answered", never who (136 §4.3: "names on the Squad screen"). S6's trail is "9 named · a side needs 11", never the roster size (a roster minus a sheet is an absence, GA-I24-I25 D8).
- **`screen` is a route the reader may already open under the card's `via`.** No route is added; the link is the Workload screen, the Squad screen, the scorecard, Notices, the duties panel — each the screen 136 §3.6's "where the rest is" column already names.

*Rejected — a server-side evidence read:* it would be a new read with a new gate to prove, for figures the browser holds; PB-D9's trigger decides if evaluation moves to SQL, and the trail moves with it unchanged.

### 1.3 The coaching point — stored, slice 2 (C-D1, C-D4)

A coaching point is **one boy, one sentence, one pointer.** It is written on the boy's development panel (the Skills screen's tier), not in the drawer. The table and its policy are in §6; the words are §5.3. It is drawn in two places: on the boy's development panel (where it is written) and, when it names this fixture, as a card in the drawer under a thirteenth rule, **S13 "A coaching point for this fixture"**, gated `player.development.read`, source `coaching_points`, in `RULES` after S12 (`signals.js:44–60`) and in `RULE_ORDER` (`:63`). S13 derives nothing; like S12 it shows a row as written.

*Rejected — a coaching point that cites two boys ("Pillay over Naidoo at three"):* a selection verdict written down, refused by GA-I24-I25 D5 for the same reason; a point about the side is a point with `player_id` null and no card evidence (§6). *Rejected — a point readable by the boy or his parent:* a message to a child; SCRBRD-138 asked whether a coach may send a pupil anything and this design does not answer it by the back door.

---

## 2 · The evidence trail, card by card

Window words: *the fixture's day* and *soon* are 136 §4.3's; *this week* is `workload()`'s seven days to `sa_today()` (`db/60:1089`, per phase B §1.3). "Read" names what `useCockpit` fetches (`useCockpit.js:50–69`).

| card | read (`path`) | window | denominator / unit | figures on the trail | as of | screen | never on the trail |
|---|---|---|---|---|---|---|---|
| S1 bus | `trips`, `match_squad`, lifts (`useCockpit.js:58, 50, 67`) | this fixture | seats; boys named | capacity, named, by lift, travelling, seats taken (`signals.js:131–134`) | read time | the Transport screen | a boy's name; who is on the bus |
| S2a cap | `fold` + `GET /api/matches/:id/playing-conditions` (`:63`) | this innings | balls bowled; the cap's sentence | balls, the cap's words verbatim (`signals.js:156`) | **head seq** | the scorecard | a reason; a guideline |
| S2b spell | `bowling_spells` (`:56`; `read-api.mjs:1568–1585` per phase B §5) | the open spell | overs of `maxSpell` | spell no., overs, max, age band (`:172–177`) | head seq + read time | the Workload screen | basis, `limit_kind` other than its word (PB-D6) |
| S2c day | `bowler_day` (`useCockpit.js:142`; `db/94`) | the fixture's date, every match | overs of `maxDay` | overs today, max, matches today as a count (`:205–211`) | read time | the Workload screen | the other match's name (PB-D3) |
| S3 picked, not available | `readiness` (`:54`) | this fixture | per boy | state word, who said it, return date (`:225–231`) | read time | the Squad screen | `reason_kind`, `note`, the nature (D4) |
| S4a lifts | `/lifts/expected` (`:67`; logged, db/76) | the fixture's day | lifts | count, not left, handed over unconfirmed (`:243–247`) | read time | the Day-of screen | a name, a driver, a number (D10) |
| S4b exception | `/lifts/exceptions` (`:68`; office only) | the fixture's day | per seat | as db/76 names them (`:255–258`) | read time | the Lifts office screen | — (already by name, to the office) |
| S5 matchup | `matchups`, `matchup_coverage` per boy (`:73–75`; `read-api.mjs:2095, 2166` per GA-I24-I25) | every match of his this reader may read | attributable of deliveries; balls | balls, runs, out, attributable/deliveries (`:272–275`) | read time | the boy's Profile | a named bowler of another school (D7); a rate under 30 balls (D14) |
| S6 thin sheet | `match_squad` (`:50`) | this fixture | of a side of 11 | named, 11 (`:286–288`) | read time | the Squad screen | the roster size |
| S7 unanswered | `readiness` (`:54`) | this fixture | of boys named | none, again, named (`:298–299`) | read time | the Squad screen | names; a reason |
| S8 duties | `match_duties` (`:59`) | this fixture | per slot | the empty slot (`:312–315`) | read time | the duties panel | "pending" |
| S9 weather | `weather` (`:62`) | the fixture's day | the read's words | rain chance, forecast, playable (`:324–328`) | read time | — | a DLS figure |
| S10 conditions | `/playing-conditions` (`:63`) | this fixture | the document | state, cap, free hit (`:343–347`) | read time | the competition's conditions page | — |
| S11 week | `workload` (`:55`; `read-api.mjs:1481`) | this week | overs begun, every match | overs 7d, word, estimate (`:357–359`) | read time | the Workload screen | a ratio, *risk*, a guideline (D7) |
| S12 notice | `notifications` (`:64`) | as published | — | none: the notice is the record (db/89) | published time | Notices | nothing new |
| S13 coaching point | `coaching_points` (slice 2) | as written | — | the stored pointer, re-derived (§5) | written time; "now" | the boy's development panel | a second boy; anything the reader's own gate refuses |

Two facts this table rests on and the hook does not give today: **no read's answer time is kept** (`useCockpit.js:80–90` stores rows alone), and **the head `seq` reaches the hook only as `seen`** ("what the match's log has grown to", `:24`). §4.1 adds both to the context; neither is a new read.

---

## 3 · Who reads what, and what never surfaces

### 3.1 Plain words

The trail is behind the same two gates as the card: the drawer's entry rule (136 §1.2, D1) and the card's own `via`. A reader who does not pass the first sees no drawer; one who fails the second sees no card and so no trail. The only new question is the coaching point, which is a row and so has a policy of its own.

### 3.2 By role

| role | the drawer | signal cards and trails | coaching points (slice 2) | never |
|---|---|---|---|---|
| **coach** (team-scoped) | yes (D1) | every rule his bundle admits, trail included; S4b never (D10) | reads and writes for boys on his side | a reason, a nature, a flag, a guideline's basis, a lift name (136 §3.7) |
| **assistant coach** | yes | as the coach (holds `player.workload.read`, PB §1.2) | reads; writes only if `player.development.write` is his today (A3) | as the coach |
| **director of sport** | yes | as the coach; S4b through `transport.lift.oversee` (D10) | reads (A3) | a wellness flag (110 §3.3: not alerted, "even by a dot") |
| **team manager** | yes (GA-I09 §3.1) | S1, S3, S4a, S6, S7, S8, S9, S10, S12 with trails; no load cards and **no sign one exists** | none (A3) | S2b, S2c, S11 and their reads' names anywhere on his drawer |
| **analyst** | **no** (no `team.select`, no `player.workload.read`; GA-I24-I25 D12's bundle) | none | none: "coach's note" is never in a workspace (GA-I24-I25 D5, §4 item 2) | — |
| **physio** (`medical`) | yes, by `player.workload.read` | S2b, S2c, S11 with trails; S3 not (needs `team.select`) | none: a coaching point is cricket, not clinical | — |
| **pupil** (`player`, `selfaccess`; the captain) | **no** (136 §4.5: no subject-scoped role passes) | none; his surface is 138's tab | none through this design (C-D4) | another boy's figures in any form |
| **parent** (`guardian`) | **no** | none | none | her child's coaching point by any route here; another boy's anything |
| **scorer, office, official, media, spectator** | no (D3; GA-I09) | none | none | — |

### 3.3 What never surfaces, restated for a diff

1. **No figure the rule did not read.** The trail is a view of the rule's inputs; the static test pins it (§7).
2. **No read's name on a drawer whose reader did not get its card.** The trail names `bowler_day` only under a card that fired; the drawer's count is `feed.open.length` (`FeedDrawer.jsx:52`) and counts drawn cards only. The team manager never reads "1 card needs a capability you lack".
3. **No absence by subtraction.** S6's trail carries the sheet and eleven, never the roster; S7's carries counts over the named sheet, never the roster or a name; no card compares a sheet to a roster (GA-I24-I25 D8, §5 "Team sheet beside the roster: No").
4. **No age by subtraction.** `age_band` is on S2b's and S2c's trails only, which are behind `player.workload.read` (the lead's `bowling_spells` fix, phase B §5), and the trail prints it as the rule's sentence already does.
5. **No health beyond status, no reason, no flag, no guideline basis, no discipline, no safeguarding** (136 §3.6, §3.7, §4.4; 110 §3.3; ADR 0002 D4; PB-D7's never-list). A trail is text, so `NEVER_ON_THE_COCKPIT` reads it.
6. **No other school's child beyond what the card already says.** S5's read drops a named bowler the reader may not read (D7); the trail says "left-arm spin", as the card does.
7. **No coaching point names two boys, reaches a pupil or a parent, or is read by the analyst, the physio, the team manager or the office.**
8. **No invented figure on any trail:** no index, probability, pressure, threat, percentile (136 §5; `NEVER_ON_THE_COCKPIT` refuses `\d\s?%`).

---

## 4 · Corrections, and the "as of" line

### 4.1 Plain words

A card drawn at 14:02 is true as of 14:02. If a ball is voided at 14:10 the cockpit's next poll re-reads, the rules re-run and the card either changes or goes; nothing is stored, so nothing is stale for longer than a poll (GA-I36 §0, §2.3). What is missing is the sentence that says so.

**Every signal card's trail ends with one line:** "as at 14:02" from the read's answer time; for S2a, which stands on the fold, "as at 14:02 · head 412". `useCockpit` records `reads.at[name] = Date.now()` beside each read's rows (`useCockpit.js:80–90`) and passes `head: seen` into the context (`useFeed`, `:164–171`); `Ctx` (`signals.js:96–115`) gains `at` and `head`. When the Match Centre's header shows GA-I36 A1's "Updated · refresh", the drawer shows the same words under its title and re-evaluates on the next render; the words are I36's, not new ones.

### 4.2 A coaching point after a correction (C-D5)

The point stores its pointer and, where C-D4 allows, the card's lines as the coach saw them (`evidence_text`, §6). On open the client re-derives the same card from today's reads. Three cases:

| the figure | the card shows |
|---|---|
| unchanged | "stood on: 48 balls, 31 runs, out 3 · as at 11 Oct 14:02 (head 412)" |
| moved by a correction (the head is higher and `inn.voided` has grown, GA-I36 D2) | both lines: "stood on … head 412" and "now: 46 balls, 31 runs, out 3 · head 415 · corrected 18:42" — the word *corrected* only for an approved amendment or a released ball (gap analysis decision 9, 8 Oct) |
| moved by play (more balls, no void) | "stood on … 48 balls" and "now: 54 balls"; no *corrected* |
| not re-derivable for this reader (a load card, reader without `player.workload.read`) | "the load figures are on the Workload screen" and the pointer's time; no figure |

The old line is never overwritten and never deleted; a point the coach no longer stands by is withdrawn (`withdrawn_at`), kept, and drawn struck through to those who may read it. Careers and season figures carry no "corrected" marker (GA-I36 D10); a coaching point is one card and may.

---

## 5 · The screens

### 5.1 The disclosure on a signal card (C-D3)

In `FeedDrawer.jsx`, after the lines (`:76`) and before the source sentence (`:77–79`): one button, **"Where this comes from"**, `minHeight: 44px` as `btn()` already sets (`:98`), `aria-expanded`, the existing tokens (`T.role.body`, `T.line.normal`, `T.space.*`). Expanded, it shows:

1. the source line: "**workload** · the 7 days to today · overs begun, every match · as at 14:02" (`evidence.read`, `window`, `denominator`, `asOf`, and `head` where set);
2. the figures as a two-column list in the figure face (`T.role.figure.sm`, as the count uses, `:52`), label left, value and unit right, tabular;
3. one link, `evidence.screen.label`, to the existing route, a `<a>` styled as `btn()`.

The source sentence that is there today (`:77–79`) stays as the collapsed state's one line; "You see it through coach with …" keeps saying the capability (ADR 0001). **No animation**: the drawer's own rule is "Cards do not animate in" (`:16`); the disclosure appears and disappears, which also honours `prefers-reduced-motion` with nothing to switch off. Nothing under 12px: `quiet()` is 14px (`:97`). The expanded state is per card and per open; it is not remembered.

**Bundle.** The entry bundle sits at ~498 KB of a 500 KB ceiling (`tools/check-bundle.mjs`). The disclosure's body is a separate component in `views/cockpit/EvidenceTrail.jsx`, imported with `React.lazy()` and `Suspense` from `FeedDrawer.jsx`, loaded on the first expand; the fallback is the collapsed line. Haiku's ground map (§8) confirms whether `FeedDrawer.jsx` itself is already behind a lazy boundary from the Coach tab; if it is not, the drawer goes behind one in the same slice. The helper in `signals.js` is a few hundred bytes and stays in the pure module so the test reaches it.

### 5.2 Actions on a card (C-D6)

| card | the link | what it never does |
|---|---|---|
| S1, S4a | the Transport / Day-of screen | S4a's "with us" is 136 §4.3's real act and is **not built in the drawer today** (`FeedDrawer.jsx:80–82` draws only Seen); this design leaves it where 136 D10 put it and adds no write here |
| S3, S6, S7 | the Squad screen | change the sheet from the drawer |
| S2a, S2b, S2c, S11 | the Workload screen / the scorecard | take a bowler off; say *stop* (PB-D4) |
| S5 | the boy's Profile; slice 2: "Make a coaching point of this" → the boy's development panel with the pointer pre-filled | write from the drawer |
| S8, S10 | the duties panel; the competition's conditions | — |
| S12 | Notices (one read state, D13) | — |
| S13 | the boy's development panel | — |

### 5.3 Writing a coaching point (slice 2)

On the boy's development panel (the Skills screen's own surface, `player.development.*`), a field of at most 500 characters, labelled **"Coaching point"**, with the pointer shown above it as the card's collapsed line and "as at …". Save and Withdraw are the only acts. Words the field refuses on save, client-side first and in the function (§6): anything `NEVER_ON_THE_COCKPIT` matches, and a second boy's name from the side's sheet (the client has the sheet; the function has `match_squad`). The panel shows the author by role words ("the coach, 11 Oct"), never a staff name to a reader who is not staff, and this design admits no such reader.

---

## 6 · Storage — none for slice 1; one table for slice 2

**Slice 1 needs no row.** The trail is derived (C-D2); the device store for "seen" (`useCockpit.js:183–195`) is untouched and PB-D5 stands.

**Slice 2, `db/NN_coaching_point.sql`** (the lead numbers it; `db/94` is `bowler_day`, `db/95` is reserved for `signal_ack` on its trigger, PB §3.3), Opus:

```
coaching_point (
  id             uuid PK,
  school_id      uuid NOT NULL → school,
  player_id      uuid → player,                 -- exactly one boy, or NULL for a point about the side
  team_code      text NOT NULL,
  match_id       uuid → match,                  -- the fixture it is about, or NULL
  author_id      uuid NOT NULL → app_user,      -- set by the function, never by the caller
  written_at     timestamptz NOT NULL DEFAULT now(),
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  evidence_rule  text CHECK (evidence_rule IN ('S2a','S2b','S2c','S5','S11')),   -- cricket and load cards only; NULL = no card
  evidence_read  text, evidence_params jsonb,   -- the pointer: {teamCode, matchId, batterId: this boy only}
  evidence_head  int, evidence_as_of timestamptz,
  evidence_text  text[],                        -- the card's lines, ONLY when evidence_rule IN ('S2a','S5') (C-D4)
  withdrawn_at   timestamptz, withdrawn_by uuid → app_user,
  CHECK (evidence_text IS NULL OR evidence_rule IN ('S2a','S5')),
  CHECK (player_id IS NOT NULL OR evidence_rule IS NULL)
)
```

- **Policy:** read under `player.development.read`, write under `player.development.write` (A3), anchored on the player's *current* side as `injury` is (ADR 0002 "scope, not tier"); a `RESTRICTIVE` `not_under_support` cut (`db/60:240–243` pattern, per PB §3.3); no `superadmin` read of the body (DSO §1 item 4's shape, as PB §3.3 applies it to `signal_ack`). `coaching_points` joins `RESTRICTED_FIELDS` so each read is logged as skills are (`read-api.mjs:2951–2996` per GA-I24-I25).
- **Written through `coaching_point_write(p_player, p_match, p_body, p_evidence)`**, `SECURITY DEFINER`, pinned path, revoked from `PUBLIC`, `anon`, `authenticated`, granted to `scrbrd_app` (`db/60:1156–1182` pattern); it stamps `author_id`, refuses `evidence_params` naming a `batterId` other than `p_player`, refuses a body matching a SQL copy of the forbidden words (kept in step by a test that compares the two lists), and refuses a body containing the full name of another boy on the fixture's `match_squad`. Withdraw is the only update.
- **Never deleted by a user; retained with the boy's development record** and purged when it is (ACCOUNT_LIFECYCLE governs; A5). Never exported by the generic CSV route (GA-I24-I25 D9's rule, extended).
- **Never a `notification` row, never a push** (136 §4.5; db/89 names no such kind).

---

## 7 · Proofs

**Unit (`apps/web/test/signals.test.mjs`, slice 1):** every card from `evaluate()` over the seed's fixture carries `evidence` with `read`, `window`, `asOf` and at least one figure; every figure label and value, and every `window`/`denominator`, passes `NEVER_ON_THE_COCKPIT`; `evidence.read` is one of the card's `source` names; `evidence.params` holds no `playerId`/`batterId` absent from the card's `base`; S6's and S7's trails hold no field named `roster`; the source scan of `signals.js` for `FORBIDDEN_FIELDS` includes the helper. S2a's `head` equals the context's `head`; a context with `at` missing yields "as at" absent, not `Invalid Date`.

**Browser walk (`tools/smoke-browser-cockpit.mjs`, 136 §9):** as the coach, expand every card's disclosure and grep the rendered drawer against `NEVER_ON_THE_COCKPIT` and the five basis words (PB-D7); as the team manager, the rendered drawer contains none of `bowler_day`, `bowling_spells`, `workload`; the disclosure button measures ≥ 44 px; no text under 12 px; the `EvidenceTrail` chunk is absent from the entry bundle (`tools/check-bundle.mjs` stays green).

**API walk:** none new for slice 1 (no read is added). Slice 2 adds to `tools/smoke-cockpit.mjs`: `coaching_points?matchId` as the coach returns his side's rows and writes an access-log row; as the assistant, the director: rows (A3); as the team manager, the analyst, the physio, the scorer, a pupil, a guardian: empty and no error naming the gate.

**`db/99 §NN` (slice 2):** SET ROLE as the seed's personas: the coach writes a point for D Erasmus and reads it; the same point is invisible to `teammanager`, `analyst`, `medical`, `player` (D Erasmus himself), `guardian` (his parent), the other school's coach, a `support_access` session and a platform-wide assignment; a write with `evidence_params.batterId` ≠ `p_player` is refused; a body naming R Pillay on the same sheet is refused; `evidence_text` with `evidence_rule = 'S11'` is refused by the CHECK; the function's grants match `db/60:1192–1224`'s pattern; a withdrawn row is still readable to the coach and `withdrawn_at` is the only column that changed.

**Corrections (slice 2, GA-I36 §8.1's shape):** void a ball of D Erasmus's inside the test transaction; the re-derived S5 differs from `evidence_text`; the screen's words are "stood on … head N" and "now … head N+1 · corrected HH:MM".

---

## 8 · Build plan and tiers

| # | item | migration | tier | proof |
|---|---|---|---|---|
| **C0** | Haiku's ground map: whether `FeedDrawer.jsx` is lazy-loaded from the Coach tab; the routes behind each `evidence.screen`; the exact `player.development.*` capabilities and their holders in `roles.mjs`; the Skills screen's write route; `read-api.mjs`'s current lines for the reads in §2 | none | **Haiku** | the brief for C1 names what to read |
| **C1** | `evidence` on `Card`, the helper, each rule's trail, `Ctx.at` and `Ctx.head`, `reads.at` in `useCockpit`; the unit cases | none | **Opus** (the rules are the gate's client, as PB B2 held) | `signals.test.mjs` |
| **C2** | `EvidenceTrail.jsx` behind `lazy()`, the disclosure in `FeedDrawer.jsx`, the "as at" and "Updated · refresh" lines, the link per card | none | **Sonnet**, **Opus reviews** (minors' data on the screen); interface-review on the diff | the browser walk; `check-bundle` |
| **C3** | `coaching_point`, its function, policy, `RESTRICTED_FIELDS` entry, `db/99 §NN` | **`db/NN`** | **Opus** | `db/99 §NN`; the API walk |
| **C4** | S13, the development panel's field, "Make a coaching point of this" from S5, the stood-on/now drawing | none | **Opus** for S13 and the write's client, **Sonnet** for the panel, **Opus reviews** | the browser walk; the corrections case |
| **C5** | after each merge: the gap-analysis row, the roadmap, 136's §4.3 pointer to this document, `DEPLOYING.md`'s paste list for `db/NN` | none | **Haiku** | the lead reviews |

C1–C2 are one Opus agent with Sonnet beside it and wait on no database lock. C3–C4 are slice 2, built with I26a so the assessment history and the drill loop take the same pointer rather than a second one; if Kameel keeps I26a after the pilot, C3–C4 wait with it.

---

## 9 · Decisions — C-D1 … C-D8

| # | decision | recommendation | why, in one line |
|---|---|---|---|
| **C-D1** | what a card is | **a signal card (derived, trail added now) or a coaching point (stored, slice 2)** — **decided 14 Oct** | the brief names both; the trail needs no row, the note does |
| **C-D2** | where the trail comes from | **the rule's own rows, in the browser; no new read or gate** — **decided 14 Oct** | a view of inputs cannot widen a gate; PB-D9 decides if evaluation moves |
| **C-D3** | how it opens | **a disclosure on the card, then one link to the existing screen** — **decided 14 Oct** | 136 D2: no fifth destination |
| **C-D4** | the coaching point's tier and evidence | **one boy; `player.development.*`, logged; pointer always, lines only for `fixture.read`/`player.performance.read` cards; load figures re-derived under the reader's own gate; no pupil, no parent** — **decided 14 Oct** | a load word in a development row crosses a tier; a note to a child is 138's question |
| **C-D5** | corrections | **"as at" on every card, head on fold-derived ones; a point shows stood-on and now, never overwrites** — **decided 14 Oct** | GA-I36 D1, D2, D10; both versions kept |
| **C-D6** | actions | **links to where the act lives; the drawer writes nothing** — **decided 14 Oct** | PB-D5 |
| **C-D7** | which cards may seed a point | **S2a, S2b, S2c, S5, S11; never S3, S4a, S4b, S6–S10, S12** — **decided 14 Oct** | availability, lifts, duties and notices are not coaching |
| **C-D8** | the team manager's trail | **his cards' trails only; no read he cannot see is named anywhere on his drawer** — **decided 14 Oct** | 136 §1.2: his tab says nothing is missing |

## 10 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | each rule's inputs are already in scope where `card()` is called, so the helper needs no new field on `Ctx` beyond `at` and `head` | the rule passes the figures it has; nothing is read anew |
| **A2** | the routes in §2's "screen" column exist for every reader who holds the card's `via` (Workload, Squad, Transport, Day-of, Profile, Notices, the duties panel) | the link is omitted for that card; the trail stands without it |
| **A3** | `player.development.read` is held by coach, assistant coach and director of sport, and a `player.development.write` (or the Skills screen's write capability) exists and is the coach's | C3's policy names whatever `roles.mjs` has; the §3.2 column changes to match, and Kameel is asked before any role is widened |
| **A4** | `FeedDrawer.jsx` can take a `lazy()` child without breaking the dialog's focus trap (`:25–38`) | the trail renders inline and the drawer itself goes behind the boundary |
| **A5** | ACCOUNT_LIFECYCLE's rule for development records (skills, notes) covers `coaching_point`'s retention and purge | C3 adds the row to that design's table list and the purge job |
| **A6** | GA-I36 A1's "Updated · refresh" marker is drawn by the Match Centre header the Coach tab sits in | the drawer draws its own from `head` against the header's `last_seq` |
| **A7** | the seed's S5 card for D Erasmus has ≥ 30 balls against one type, so the walks have a card to expand | the walk seeds the balls inside its run (136 A9's shape) |

## 11 · What this document does not reopen

D1–D16 (136); PB-D1–D11; the twelve rules and eight refusals; 110 §3.3 and §4.2; ADR 0002 (D4); GA-I24-I25 D5, D7, D8, D9; GA-I36 D1, D2, D10; db/89's contract; SAFEGUARDING_DSO §1.

## 12 · For the lead: code against earlier designs

- Phase B's status line says "Nothing built; building starts after the pilot", but the branch has `ruleS2c` (`signals.js:198–216`), its `RULES` row (`:48`) and `useBowlerDay` (`useCockpit.js:130–148`) over `bowler_day` (db/94). Haiku should correct the status line once the branch merges.
- 136 §4.3 S8 names scorer, umpire and first-aider; the code draws scorer and umpire only (`signals.js:314`, "no read says how many a fixture ought to have"). The first-aider slot is dropped without a decision recorded; this design does not add it.
- 136 §4.3 S12 is gated by "each notice's own `required_capability`"; the card's `via` prints `news.read` alone (`signals.js:59`). The policy still decides; the sentence on the card understates it.
- 136 §4.3 S7 names `availability?matchId` as its source; the code reads `readiness` (`signals.js:54, 294–304`). Same gate, different read; the trail names `readiness`.
- Phase B §3.1 cites `isSeen()`/`markSeen()` at `signals.js:367–377`; on the branch they are `:406–416`. Line drift only.
