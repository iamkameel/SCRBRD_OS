# Design direction — the front-end

Status: **draft, for Kameel to react to** (2026-09-25). Nothing in this document is
built. Once the decisions in §9 are made it becomes the brief every screen is built
against, and `apps/web/src/design/tokens.js` is where its values live.

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

Theme selection: the pad defaults to **Daylight** between sunrise and sunset on the
device clock and Floodlit otherwise, with a one-tap toggle on the pad's own menu;
every other screen follows the system setting. `design.test.mjs` checks every text
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

### 3.8 What makes it stick

`apps/web/test/design.test.mjs` checks contrast in both themes. `tools/smoke-a11y.mjs`
adds three rules: no rendered text under 12px, no tappable element under 44px on the
pad, no emoji in button text. These fail the build, so the direction cannot drift the
way 2.0 drifted.

---

## 4. The pad

The screen the product is judged on. Principles:

1. **One ball, one tap, under three seconds.** A normal delivery is recorded without
   scrolling, without a sheet, with the thumb.
2. **The board once.** The score appears one time, at the top, drawn by `Board`.
3. **Outcome first, detail after.** The quick keypad is the default. Shot, area and
   contact are an "Add detail" step offered *after* the ball is saved, and the
   scorer's chosen capture profile (`quick` / `standard` / `full`, already an
   `innings_start` field) decides whether the pad opens that step by itself.
4. **State in one line.** "Saved on this phone · 3 to send", "Held 1", "Sign in to
   send 4 balls" — the vocabulary from SCRBRD-078, unchanged, in `body` size under the
   board.
5. **Daylight by default outdoors.** See §3.1.
6. **Refusals stay in place and in words** (SCRBRD-070/077).

Layout at 390 wide, top to bottom, nothing scrolling:

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
│  ┌────┐ ┌────┐ ┌────┐                    │
│  │ 0  │ │ 1  │ │ 2  │   run keys, 64 tall│
│  ├────┤ ├────┤ ├────┤                    │
│  │ 3  │ │ 4  │ │ 6  │                    │
│  └────┘ └────┘ └────┘                    │
│  [ Wd ] [ Nb ] [ B ] [ Lb ]   56 tall    │
│  [ WICKET ]            [ Undo ]  64 tall │
│  Add detail to the last ball ›           │
└──────────────────────────────────────────┘
```

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
list. Nothing on the screen names another child (SCRBRD-083's public-data decision
is still open; this design assumes nothing is public until it is decided).

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
| 1 | Tokens 2.1: themes, type roles, `Board`, `flip`, icon set, the three a11y rules | Opus (cross-cutting) | `design.test`, `smoke-a11y`, `check-bundle` |
| 2 | The pad on the new foundations | Opus (scorer UI) | every `browser-*` walk that touches the pad; `browser-offline-day` both ways |
| 3 | The day sheet and Match Centre | Sonnet build, Opus review | `browser-read`, `browser-dayof` |
| 4 | Parent and pupil screens | Opus (minors' data) | `browser-read` guardian steps, `db/99` |
| 5 | Admin screens, one at a time, `D` → `T` | Sonnet | the screen's walk |

The 500 KB entry ceiling and the offline behaviour are non-negotiable throughout.

---

## 9. Decisions for Kameel

1. **Typefaces.** Keep DM Mono / DM Sans / Syne and fix the scale, or change the
   display face while we are here?
2. **Daylight theme.** Pad only (auto by sun, toggle on the pad), or the whole app
   following the system setting?
3. **Quick keypad as the default pad**, with shot detail after the ball. Yes?
4. **Icons.** Lucide plus twelve drawn cricket glyphs; every emoji goes. Yes?
5. **The day sheet replaces the KPI dashboard.** Yes?
6. **The board is always black**, in both themes, everywhere the score appears. Yes?
