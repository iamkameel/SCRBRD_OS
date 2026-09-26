# Design direction — the front-end

Status: **agreed** (2026-09-25). The six decisions in §9 were made by Kameel the same
day and are written into the sections below. This is now the brief every screen is
built against, and `apps/web/src/design/tokens.js` is where its values live. Nothing
in it is built yet; §8 is the order it will be.

It builds on Design System 2.0 (`0be5ce8`, 14 Sep): the neutral-first palette, the
computed contrast, the rationed lime, the glass budget, the motion scale, the focus
rings and reduced-motion support. Those hold. What follows is what 2.0 did not reach,
found by reading the screens as a scorer, a coach and a parent would use them.

---

## 1. The thesis: a scoreboard, not a dashboard

The logo is a split-flap board. That is the right cue, and the product has not
followed it. A school ground has one piece of information design everybody trusts:
the scoreboard. Black board, painted figures, a fixed vocabulary — total, wickets,
overs, target, batters, bowler, last man — big enough to read from the boundary.
Nobody has ever asked a scoreboard for a KPI tile.

So the direction is: **figures first, words second, decoration never.**

- The score is drawn one way everywhere — the pad, the match-day hub, the public
  page, the report, the parent's phone — by one component, `Board`, and it is always
  a black board with white and lime figures, whatever theme the page around it is in.
  A real scoreboard is black against a bright sky; ours sits black on a light page in
  daylight and black on a dark page under lights.
- Every number is set in the figure face, tabular, and sized for the distance it is
  read from: the total on the pad at arm's length, the run rate at reading distance.
- When the score changes, the figure flips (190 ms). It is the one animation the
  product is known by; wicket, fifty, hundred and result keep the interrupt slot.

Everything else on a screen is the things a person does next, in the order they need
them, with nothing competing.

---

## 2. Where the app is now (evidence, not opinion)

Read on 25 Sep from `apps/web/src` and from the demo build at desktop (1366) and
phone (390) widths.

**Type is too small to read outdoors.** Inline `fontSize` counts across views, scorer
and ui: 11px ×284, 10px ×184, 12px ×180, 9px ×144, 8px ×39. Navigation group labels
are 8px uppercase. A scorer's phone at a ground in September sun is the hardest
reading condition the product has, and the smallest type is on it.

**Emoji are doing the job of icons.** 🎯 for the coach's role, 🏏 🏆 📈 🏥 💪 🔔 on the
dashboard tiles, and on the pad the shot grid: 🏏 Drive, 💪 Pull, 🪝 Hook, ✂️ Cut,
🧹 Sweep, 🚀 Ramp, 👆 Flick, 🎯 Glance, 🌤 Loft, 💥 Slog, 🛡 Fwd Def, 🦵 Padded,
🔪 Out Edge, 🧤 Hit Glove, ❌ Missed. They render differently on every phone, they
clash with the wordmark, and they make a serious product read as a toy.

**The pad shows the score twice and overflows.** At 390px the top row (SCRBRD OS ·
Revise · 142/3 14.2 · On d…) runs off the right edge; the strip below it truncates
("1…"); then the score card repeats 142/3 (14.2) and CRR 9.91. The first thing a
scorer meets is a 22-button shot grid in four categories, as step 1 of 3, before the
outcome of the ball. A quick mode exists (`CAPTURE_PROFILE.QUICK`, `engine.jsx:1168`)
and is the better default for a school scorer; the full grid is what opens.

**The dashboard is six equal tiles.** "Active players 8 — Demo data", "Win rate —",
"Sessions this wk 3", each with its own accent and a coloured emoji square. It is the
pattern the 2.0 tokens file itself warns against ("a screen in which everything is
coloured has told the reader nothing about what matters"). A coach on a Friday needs:
tomorrow's fixture, who is unavailable, what is still to do, and the live score if
there is one.

**2.0 is half-applied.** `T` (semantic) exists; `D` (the compatibility alias) still
carries four and a half thousand call sites, and screens pick per-tile colours from
it. The philosophy is written; the screens have not been migrated.

**Dark only.** There is no daylight theme. The pad is used in direct sun.

**Dates are ISO.** Match Centre prints `2026-09-23`; a person reads "Wed 23 Sep".

**What is right and stays.** The sync vocabulary built this week (the pill, the
banner, "Held 3", "Sign in to send 4 balls"); refusals in words, in place; the
readiness slots; the focus ring, the skip link, reduced motion, `smoke-a11y`; the
print area for the report; the bento spans; the glass budget; the contrast test.

---

## 3. Foundations (tokens 2.1)

### 3.1 Two themes, and the board

| Token | Daylight (light) | Floodlit (dark, = 2.0) |
|---|---|---|
| `surface.canvas` | `#eef0ea` whitewash, cool-green bias | `#05070a` |
| `surface.base` | `#f7f8f4` | `#0a0d13` |
| `surface.raised` | `#ffffff` | `#11151d` |
| `surface.interactive` | `#e3e7dd` | `#1a1f29` |
| `surface.overlay` | `#ffffff` + elevation | `#242a36` |
| `content.primary` | `#10140f` | `#f4f6f3` |
| `content.secondary` | `#4a5347` | `#a3adbb` |
| `content.tertiary` | `#66705f` (4.6:1 floor) | `#8a94a5` (4.7:1 floor) |
| `brand.lime` | `#b9f227` **fill only**; text on it is `content.primary` | `#b9f227` (10.8:1 as text) |
| `brand.accentText` | `#1e6b3a` pitch green, 5.6:1 | `#b9f227` |
| `semantic.positive` | `#1e6b3a` | `#3ddc84` |
| `semantic.warning` | `#8a5a00` | `#f9b233` |
| `semantic.critical` | `#b3122a` (reads and fills) | `#f4374f` fill / `#ff9aa6` text |
| `line.normal` | `rgba(16,20,15,0.12)` | `rgba(255,255,255,0.10)` |

The board never changes: `board.face #0b0e0b`, `board.figure #f4f6f3`,
`board.lime #b9f227`, `board.dim #8a94a5`, `board.rule rgba(255,255,255,0.14)`.

Theme selection (decided): **the whole app** has both themes. It follows the device's
system setting by default, and a person can override it — System, Daylight or
Floodlit — in Settings, and from the pad's own menu, remembered on that device. The
browser's `theme-color` follows the theme in use. `design.test.mjs` checks every text
token clears AA against every surface **in both themes**.

### 3.2 Type

Three families stay: **DM Mono** for every figure, **DM Sans** for everything read,
**Syne** for the wordmark and section titles only (it is a display face; at 8px it is
noise). New roles and one scale, in px, on a 4px rhythm:

| Role | Size / line | Face | Where |
|---|---|---|---|
| `figure.board` | 56 / 1.0 (72 on tablet) | Mono 500, tabular | the total on the pad |
| `figure.lg` | 32 / 1.1 | Mono 500 | scores on cards, the hub |
| `figure.md` | 20 / 1.2 | Mono 500 | batters, bowlers, rates |
| `figure.sm` | 14 / 1.4 | Mono 400 | table cells |
| `title.lg` | 24 / 1.2 | Syne 700 | screen title |
| `title.md` | 18 / 1.3 | Sans 600 | card and section titles |
| `body` | 15 / 1.5 (phone), 14 (desktop) | Sans 400 | reading |
| `label` | 12 / 1.3, +0.06em, uppercase | Sans 600 | eyebrows, table heads |
| `control` | 16 | Sans 500 | inputs and buttons (16 stops iOS zooming) |

**Floors:** nothing read is below 12px; nothing tapped is below 16px. The 8/9/10px
sizes go. `smoke-a11y` gains a check that no rendered text is under 12px.

### 3.3 Figures

Every number that can change is `font-variant-numeric: tabular-nums` so a 142 and a
9 take the same width and nothing jumps. Overs are written `14.2`, never `14.2 ov`
beside a label that already says overs. Rates to two places, run rates as `CRR 9.91`
with the label in `content.secondary`. A target is a sentence a scorer would say:
"Need 45 off 34".

### 3.4 Icons

One line-icon set on a 24px grid, 1.75px stroke: **Lucide** (`lucide-react`,
tree-shaken; the 500 KB entry ceiling in `check-bundle.mjs` holds) for the general
vocabulary, plus **twelve drawn cricket glyphs** on the same grid: bat, ball, stumps,
bails off, gloves, pads, helmet, overs, target, scorebook, bus, ground. Emoji are
removed from every control and label; `smoke-a11y` gains a check that no button text
contains one.

The shot chips on the pad are **words with no icon**. "Drive" reads faster than a
picture of a bat, and there are twenty-two of them.

### 3.5 Touch and density

- Anything tapped is at least 44 × 44. Pad keys are 56 tall with an 8px gap; the run
  keys and the wicket key are 64.
- Phone screens have a 16px gutter; cards inside them 16px padding; 12px between
  siblings.
- Desktop tables are dense on purpose: 36px rows, 12px labels, sticky header, figures
  right-aligned and tabular.

### 3.6 Motion

The 2.0 scale stays. One addition: `flip` (190 ms, `swift`) on a board figure when its
value changes — a vertical half-turn, like the logo. `interrupt` (1100 ms) stays
reserved for a wicket, a fifty, a hundred and the result. Reduced motion collapses
both to a cut, as it does today.

### 3.7 Colour discipline

- One accent per screen. On the pad it is lime and it means "the ball just recorded".
- Semantic colours say state (saved, held, refused, out) and never sport.
- Sport colours (batting, bowling, fielding) appear only in charts and table columns,
  where the reader learns the mapping once.
- A tile is not coloured to be a tile. A card gets a border, not a tint.
- One exception, decided 2026-09-26: the ball chips keep the prototype's colours
  (§10). Each chip carries its figure, and §3.9 swaps the palette for colour vision.

### 3.8 What makes it stick

`apps/web/test/design.test.mjs` checks contrast in both themes. `tools/smoke-a11y.mjs`
adds three rules: no rendered text under 12px, no tappable element under 44px on the
pad, no emoji in button text. These fail the build, so the direction cannot drift the
way 2.0 drifted.

### 3.9 Colour vision

Decided 2026-09-26 (Kameel: "We should consider theme options for colorblind users").
About one boy in twelve, and one girl in two hundred, has a colour-vision deficiency. On
a team sheet of fifteen, that is likely one of the players, and a parent or two on the
boundary.

**A second axis beside the theme.** Settings, and the pad's menu, offer:
- **Colours:** Standard / Red-green safe (protan and deutan) / Blue-yellow safe (tritan).

It is remembered on the device like the theme, and it combines with any theme (a
Daylight red-green page, a Floodlit tritan page). `applyTheme()` already mutates the
tokens in place, so this is a third input to it, not a new engine.

**What it swaps:** only the tokens whose meaning rides on hue:
- the ball chips;
- the semantic trio (positive, warning, critical);
- the sport colours in charts: wagon wheel runs, batting, bowling and fielding columns;
- the Match Centre's worm and Manhattan series.

The board's black, white and lime do not move. Layout, words and icons never change
with it.

**Measured, 2026-09-26** (Machado 2009 simulation at full severity, CIE76 ΔE between
the two closest chips; under about 10 two colours read as one):

| Palette | Normal | Protan | Deutan | Tritan |
|---|---|---|---|---|
| Prototype (Standard) | 42 | **8** (2 vs 3) | **6** (2 vs 3) | **11** (1 vs 6) |
| A searched red-green set* | ≥ 46 | ≥ 46 | ≥ 46 | — |
| A searched blue-yellow set* | ≥ 48 | — | — | ≥ 48 |

\*Existence proofs from a random search held to the same limits as the build: a black
or white figure at 4.5:1 on the chip, and the chip at 3:1 against the board. They show
the target is reachable. They are not the final colours, which step 3b chooses.

The prototype's 2 and 3 are the same colour to a red-green colour-blind viewer, and its
1 and 6 nearly so to a tritan viewer. The semantic trio has the same fault today. In
Daylight, positive `#1e6b3a` and critical `#b3122a` (saved and refused) are ΔE 15
apart for a protan viewer, and critical and warning 12 for a deutan viewer. The state
line always has its words, but the colour is a lie to those users.

**What makes it stick:** `design.test.mjs` gains the simulation. In each palette, every
pair of chips and every pair of the semantic trio keeps ΔE of at least 20 under the
deficiencies that palette serves, and ordinary vision is never worse than 25. A new
colour cannot land without clearing it.

**Chosen, step 3b (2026-09-26)** — `tokens.js` `CHIPS` and `VISION`. The white wicket
chip is counted as a chip. Worst pair, ΔE:

| Chips | 1 | 2 | 3 | 4 (and 5) | 6 | extras | Normal | Protan | Deutan | Tritan |
|---|---|---|---|---|---|---|---|---|---|---|
| Standard | `#ec4899` | `#b2e358` | `#f2c14b` | `#3b83f6` | `#dd514c` | `#8445f0` | 42 | 8 | 6 | 11 |
| Red-green safe | `#cc6d99` | `#f7f08c` | `#f5b700` | `#56b4e9` | `#c8600a` | `#0062c4` | 41 | **25** | **30** | 13 |
| Blue-yellow safe | `#dd44ae` | `#96da40` | `#f2c14b` | `#3b83f6` | `#f03a30` | `#8445f0` | 48 | 11 | 4 | **28** |

Every chip is 3.28:1 or more on the board (the extras' purple in Standard, `#8445f0`, is
3.8:1; the prototype's `#5200bc` was 1.9) and takes a figure at 4.7:1 or more: black on
all of them, white on the extras. The semantic trio moves only where it failed: Red-green
safe is sky blue / yellow / vermillion under lights (`#56b4e9`, `#f5d43f`, `#f0703c`,
deutan worst 27) and blue / ochre / oxblood in daylight (`#1f5fa6`, `#7c5e00`, `#6a0e14`,
deutan worst 28); Blue-yellow safe changes only the Floodlit critical text half, to
`#ff5a5f` (tritan worst 45; the Daylight trio already clears it at 45). Every value still
reads at AA on every surface of its theme. Batting, bowling and fielding already clear
the floor in every palette and do not move. The wagon wheel's run colours became their
own tokens (`T.run`), moved in the two safe palettes; Standard's are the wheel as it
was, whose six and extras are the same amber (ΔE 4) — unchanged here, noted for its own
step.

---

## 4. The pad

The screen the product is judged on. Principles:

1. **Every tap earns its place.** No scrolling to reach a key, no sheet for a normal
   delivery, keys in the thumb zone.
2. **The board once.** The score appears one time, at the top, drawn by `Board`.
3. **Three phases by default** (decided): **Shot → Area → Outcome**, as the pad asks
   today, redrawn. Shot is a grid of words in its four groups (attacking, defensive,
   edge and contact, special) with no emoji; Area is the field diagram; Outcome is the
   run keys, extras and wicket. The phase stepper shows where the scorer is and lets
   them step back. **Basic Scoring** is the quick keypad — outcome only — offered as
   an option, not the default; it maps to the `quick` capture profile already on
   `innings_start`, and the three-phase pad to `full`.
4. **State in one line.** "Saved on this phone · 3 to send", "Held 1", "Sign in to
   send 4 balls" — the vocabulary from SCRBRD-078, unchanged, in `body` size under the
   board.
5. **Daylight by default outdoors.** See §3.1.
6. **Refusals stay in place and in words** (SCRBRD-070/077).

The default pad at 390 wide, phase 1 (Shot), top to bottom, nothing scrolling:

```
┌──────────────────────────────────────────┐
│ ‹ Hilton v Kearsney · T20        ⋯ menu  │  title bar, 44 tall
├──────────────────────────────────────────┤
│ ████████████ BOARD (black) ████████████ │
│  HILTON 1st XI            142 / 3        │  figure.board
│  14.2 ov · need 45 off 34 · CRR 9.91     │  figure.md + body
│  ● D Erasmus 5 (1)     R Pillay 17 (12)  │  figure.md
│  K Naidoo 1/31 (3.2)   · · 4 1 5 3 · 3   │  this over
├──────────────────────────────────────────┤
│  Saved on this phone · 3 to send         │  state, one line
├──────────────────────────────────────────┤
│  [1 Shot]──[2 Area]──[3 Outcome]         │  stepper, current filled
│  ATTACKING                               │  label
│  Drive  Pull  Hook  Cut  Sweep  Ramp     │  word keys, 48 tall
│  Flick  Glance  Loft  Slog               │
│  DEFENSIVE  Fwd def  Back def  Padded    │
│  EDGE  Out edge  In edge  Top edge ...   │
│  SPECIAL  Rev sweep  Switch hit  Paddle  │
│  [ Wd ] [ Nb ] [ Dot ball ] [ Undo ]     │  always there, 56 tall
└──────────────────────────────────────────┘
```

Phase 2 (Area) is the field, full width, tapped once. Phase 3 (Outcome) is the run
keys (0 1 2 3 4 6, 64 tall), byes and leg byes, and the wicket key. Wide, no ball, a
dot and undo stay on every phase, so the commonest deliveries never need the three
steps. **Basic Scoring** replaces the three phases with the outcome keys alone.

The wicket key opens one sheet: the eleven methods (the closed list), then who is
out (the striker by default, the other end for a run out, with the end asked as
SCRBRD-069 decided), then confirm. Byes and leg byes ask the runs on the same key.
Toss, openers, next batter, next bowler, innings end and handover keep their sheets
and their words; they get the type scale and the icons.

**What does not change:** the events the pad emits (`packages/scoring` `ball()`,
`toRow()`), the Laws check, the sync engine, the outbox, the `data-testid`s the
browser walks drive, the words the walks assert. This is a change to how the pad
asks, not to what it records. Every pad change lands behind the existing browser
walks, and a walk changes only when the screen it drives changes.

---

## 5. The match-day hub (coach, director of sport): the day sheet

Replaces the KPI dashboard. It is a sheet for the day, in the order the day happens:

1. **Now.** If a fixture is live: the `Board`, full width, with "Open scorer" for a
   scorer and "Match centre" for everyone else.
2. **Today / next.** The next fixture as a card: opponent, time, ground, the bus time,
   and the readiness slots as chips (team sheet, transport, officials, ground report),
   each a word and a state, never a percentage.
3. **Who is out.** Injured and restricted players with the date they are back, from
   the medical *status* read (never the nature).
4. **This week.** Training and fixtures, as a list, not a calendar grid.
5. **Alerts** last, and only unread.

Bento spans do the emphasis: the live board is `bento-a`, the next fixture `bento-b`,
the rest `bento-c`. Weather is one line on the fixture card ("22° overcast, rain
after 4"), not a badge in a chip in a card.

---

## 6. Parent and pupil

A parent's screen is about one child and is calm. "My boy": his next match with the
bus time, his last innings in words ("17 off 12, run out"), what he needs to bring,
and the alerts they have chosen. Two children are two sections, never one merged
list. Nothing on the screen names another child. What a signed-out page may show
about any child is decided in `docs/policy/PUBLIC_DATA.md` (SCRBRD-083): no name
without recorded consent, initial and surname at most, never a photo.

A pupil sees his own passport: caps, honours, career figures, the form guide, drawn
with the same `Board` and figure roles, and nothing of anyone else's medical or
disciplinary record.

---

## 7. Admin (desktop)

The office screens are tables and forms and may stay dense. They get the type floor,
tabular figures, sticky table headers, 16px inputs, real icons, human dates, and the
sidebar as it is. Each screen migrates from `D` to `T` as it is touched, and `D`
shrinks until it can be deleted; no big-bang rewrite.

---

## 8. Sequence

Each step is a PR, reviewed before it lands, behind the walks that already exist.

| # | Work | Who (CLAUDE.md) | Guard |
|---|---|---|---|
| 1a | Tokens 2.1 and the theme engine: both themes across the whole app (System / Daylight / Floodlit), the hard-coded colours moved onto tokens, type roles, `Board`, `flip`; the type-floor check as a ratchet | Opus (cross-cutting) | `design.test` in both themes, `smoke-a11y`, `check-bundle`, every walk |
| 1b | Icons: Lucide plus the twelve cricket glyphs; every emoji out of controls and labels; the emoji check as a ratchet | Opus | `smoke-a11y`, `check-bundle`, every walk |
| 2 | The pad on the new foundations | Opus (scorer UI) | every `browser-*` walk that touches the pad; `browser-offline-day` both ways |
| 3 | The day sheet and Match Centre | Sonnet build, Opus review | `browser-read`, `browser-dayof` |
| 4 | Parent and pupil screens | Opus (minors' data) | `browser-read` guardian steps, `db/99` |
| 5 | Admin screens, one at a time, `D` → `T` | Sonnet | the screen's walk |

The 500 KB entry ceiling and the offline behaviour are non-negotiable throughout.

---

## 9. Decisions (Kameel, 2026-09-25)

1. **Typefaces:** keep DM Mono, DM Sans and Syne; fix the scale (§3.2).
2. **Daylight theme:** the whole app, following the system setting, with an override
   in Settings and on the pad (§3.1).
3. **The pad:** the three-phase pad (Shot → Area → Outcome) stays the default.
   The quick keypad is **Basic Scoring**, an option (§4).
4. **Icons:** Lucide plus twelve drawn cricket glyphs; every emoji goes (§3.4).
5. **The day sheet replaces the KPI dashboard** (§5).
6. **The board is always black**, in both themes, everywhere the score appears (§1).

### Measured before step 1 (2026-09-25)

In `apps/web/src`, outside `design/tokens.js`: 160 hex colour literals and 126
`rgba(255,255,255,…)` / `rgba(0,0,0,…)` in 26 files, every one wrong in one of the
two themes; 249 places that make a translucent colour by appending two hex digits to
a token (`D.emerald+"12"`), which is why the theme cannot simply become CSS custom
properties without rewriting them; 437 emoji in 50 files, 50 of them in
`design/roles.js`.

---

## 10. From the first prototypes (live scoring interface 2.0)

Kameel's earlier designs (`live_scoring_interface_2.0.pdf`, 10 pages, read 2026-09-26):
a broadcast scorebug, a spectator Match Center, the old OS scoring console, and a
public mobile match page with its scorecard. They got a lot right. What carries over,
and where it lands:

### Taken as drawn

1. **Three tiers of information** (p10) — the clearest idea in the set, and it maps
   onto the board directly:
   - **Tier 1, always there:** total, wickets, overs, run rate, required rate. This is
     `Board`'s fixed rows.
   - **Tier 2, one rotating line:** partnership, projected score, a milestone in reach
     ("needs 4 for fifty"), a match-up, a record. `Board` gains one `insight` slot.
     `scorer/signals.js` already works out most of it (projected, droughts, dots).
   - **Tier 3, the interrupt:** wicket, milestone, hat-trick ball, pressure spike.
     This is the `interrupt` slot §3.6 already reserves; hat-trick ball joins the list.
2. **The partnership on the board** (p1, p9): "Partnership 43 (27)" as a `Board` row
   under the batters. It is the figure a coach asks for most, and it has no home yet.
3. **The striker marked** (p1, p9): the striker's row is lit and the other is dim.
   The board's ● stays. The striker's figures take `board.figure` and the
   non-striker's `board.dim`, so the mark is not colour alone.
4. **Target in words on the board** (p1): "Target 143", then "Need 45 off 34" once
   the chase starts. This is `Board`'s `sub` line, as drawn.
5. **A match line under the board** (p1, p4): competition · age group · ground ·
   start · weather · innings, one line in `body` below the board, never inside it.
   It goes on the Match Centre and the public page. The pad keeps only its title bar.
6. **Full names where there is room, the short code where there is not** (p1, p2).
   Use "Westville Boys' High School 1st XI" on the Match Centre header and "WBHS" on
   the board at 390 wide. The short code is `school.code`, which already exists.
7. **The scorecard** (p7–p9):
   - an innings toggle (one tab per side);
   - the dismissal on a second line under the name;
   - not-out batters shaded;
   - "Did not bat" rows;
   - extras broken out as NB · WD · B · LB · PEN (PEN now matters, with Law 41);
   - a total bar, bowling, then fall of wickets as "43/3 · R Rickelton · 5.5".

   The Match Centre is rebuilt to this layout (step 3c).
8. **A player row that opens** (p8): tap a batter to open 1s/2s/3s/4s/6s counts, his
   wagon wheel and the commentary line for his dismissal. This is signed-in only (see
   below).
9. **Match Centre tabs** (p4, p7):
   - Summary
   - Scorecard
   - Commentary
   - Partnerships
   - Analytics
   - Match details

   Six tabs, in that order.
10. **Innings-break card** (p2): top scorers, best bowling, most boundaries and best
    strike rate from the first innings. This is the Tier 2 line's content between
    innings.
11. **Share** (p6, p7): a share action on the public page (D3 expects the WhatsApp
    link).

### Taken, bent to the rules already decided

- **Ball chips in the current over** (p1, p4): **the prototype's colours, as drawn**
  (Kameel, 2026-09-26: "I'd like the colours back"). This is a named exception to §3.7:
  the chips are a fixed vocabulary, like a chart's legend, learned once. Every chip
  still carries its figure or word ("4", "W", "2wd"), so colour is never the only
  signal (WCAG 1.4.1), and the colour-vision setting (§3.9) swaps the palette for
  people who need it. As drawn, in the Standard palette:

  | Outcome | Chip | Figure on it |
  |---|---|---|
  | 1 | `#ec4899` pink | black (6.0:1; white is 3.5, fails) |
  | 2 | `#b2e358` green-lime | black |
  | 3 | `#f2c14b` amber | black |
  | 4 | `#3b83f6` blue | black (5.8:1; white is 3.6, fails) |
  | 6 | `#dd514c` red | black (5.4:1; white is 3.9, fails) |
  | Wide | `#5200bc` purple, **lightened or ringed** | white |

  Two fixes to the drawing, both measured:
  - **Figures on 1, 4 and 6 are black.** White fails AA on all three.
  - **The wide chip changes.** `#5200bc` is 1.9:1 against the board, under the 3:1 a
    shape needs (WCAG 1.4.11), so a wide would read as a hole in the over. It gets a
    lighter purple or a `board.figure` ring.

  The prototype does not colour a dot, a 5, a wicket, a no-ball, byes or leg byes.
  **Proposed, not objected to, built in step 3b:**
  - a dot is an unfilled dim "·";
  - a 5 is 4's blue;
  - a wicket is filled white with a black "W", the strongest mark on the board in
    every palette;
  - a no-ball, byes and leg byes take the wide's purple, with their word on the chip:
    "wd", "nb" alone; with runs, the delivery's runs ("2wd", "5nb"); "2b", "1lb".
- **School badges** (p1, p6, p7). A crest is not a pupil's data, so it may appear on
  public pages. `school` has no crest column yet: it needs a small migration and an
  upload, and the short code stands in until then, as p2 itself says.
- **Tier 2 rotation** goes on spectator screens only: the Match Centre, the public
  page and the overlay. On the pad a line that changes by itself pulls the scorer's eye
  off the ball, so the pad shows Tier 1 and Tier 3 only. Where it rotates:
  - it changes every 8 s;
  - it holds while hovered or focused, and has a pause button (WCAG 2.2.2);
  - under reduced motion it cuts rather than slides.
- **Win probability and predictor** (p5): parked. It needs a model we don't have, and a
  number that says a school side is losing, shown to its own parents, is a product
  call and not a layout one.

### Not taken: the public data rule decides (`docs/policy/PUBLIC_DATA.md`)

- **Player photos** in every row (p4, p6–p9): none on public pages (A8). Signed-in
  rows get an initials monogram until photo sharing (SCRBRD-092) exists.
- **Full names** on the public scorecard ("Aiden Markram (c)"): at most "A Markram",
  and only with consent. Otherwise the row is "Batter 1" (L2, A2).
- **Player of the match** banner (p7): on the public page under the same name rule;
  on signed-in pages as drawn.
- **Per-player wagon wheel and stats** on the public page (p8): team-level only (L7).
  The opening row in item 8 is signed-in.
- **Squads before the match** with role icons (p6): not public (A7). Signed in, the
  opposition sees them 5 days out (db/46). The role icons are the cricket glyphs from
  step 1b: `bat`, `gloves`, `ball`, and bat with ball for an all-rounder.
- **Colour-coded brand palette** (p1's ten swatches): the board's black, white and
  lime stand, and so does the "approved" pill on p3 (green on black), which is what
  the board already is.

### Where it goes in the sequence (§8)

| Step | Adds |
|---|---|
| 3b (new, small) | `Board`: `partnership` row, striker lit and dim, `insight` slot with rotation rules, ball chips in the prototype's colours; the colour-vision setting and its test (§3.9, SCRBRD-096); Opus, as `Board` sits on the pad and the setting is cross-cutting |
| 3c (new, after step 3 lands) | Match Centre to the prototype: the match line (5), full names and codes (6), the scorecard layout (7), the tabs (9); Sonnet build, Opus review |
| SCRBRD-083 step 3 (public page) | the match line, the scorecard under the name rule, share, `noindex` |
| later | school crest column and upload; the innings-break card; the opening player row |
