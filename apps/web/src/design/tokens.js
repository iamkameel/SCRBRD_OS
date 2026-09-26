/**
 * SCRBRD DESIGN SYSTEM 2.1 — foundations.
 *
 * ── Why this file is shaped the way it is ─────────────────────────
 *
 * There are two token surfaces here and they are not redundant.
 *
 * `T` is the SEMANTIC system: a colour is named for the job it does, not for
 * the hue it happens to be. `T.semantic.critical` stays critical when the red
 * changes; `D.rose` does not. Everything written from here on should reach for
 * `T`.
 *
 * `D` is the COMPATIBILITY surface: forty-two files and four and a half
 * thousand call sites already say `D.surf1` and `D.amber`, and rewriting all
 * of them in one pass would be a very large diff whose only testable claim is
 * "nothing moved". So `D` stays, re-pointed at the 2.0 values. Every existing
 * screen inherits the new palette the moment this file changes, and the
 * migration to `T` can happen screen by screen behind real review.
 *
 * The one rule: `D` may only ever be an alias of something in `T`. When the
 * last call site is gone, `D` goes with it.
 *
 * ── The palette ──────────────────────────────────────────────────
 *
 * Neutral-first. Midnight and graphite carry the interface; the spectral
 * colours — lime, luminous green, cyan, cobalt — behave as information, light
 * and energy rather than as constant decoration. A screen in which everything
 * is coloured has told the reader nothing about what matters.
 *
 * ── Contrast is computed, not eyeballed ──────────────────────────
 *
 * Every value used as text clears WCAG AA (4.5:1) against ALL FIVE surfaces,
 * IN BOTH THEMES, checked by apps/web/test/design.test.mjs rather than by
 * anyone's judgement. Some cannot, and are kept as FILLS paired with a
 * readable half — the same discipline the 1.0 palette arrived at for indigo,
 * violet and rose, and for the same reason: lightening the fill until it reads
 * washes the colour out of the brand.
 *
 *   Fills and borders → brand.blue, semantic.critical, brand.lime (Daylight)
 *   Anything read     → brand.blueText, semantic.criticalText,
 *                       brand.accentText, or textOn()
 *   Text ON a fill    → inkOn(fill)
 *
 * ── 2.1: two themes, and a board that is neither ─────────────────
 *
 * DAYLIGHT (light) and FLOODLIT (dark, = the 2.0 values exactly) are two
 * complete value sets for the colour groups below. The device's system setting
 * picks one unless the person has chosen (design/theme.js is the engine; the
 * boot script in index.html makes the first decision before any of this runs,
 * so the page never paints in the wrong one). The BOARD is always black — a
 * real scoreboard is black against a bright sky — and does not switch.
 *
 * WHY THE TOKENS STAY HEX STRINGS AND SWITCH IN PLACE, rather than becoming
 * CSS custom properties. 249 call sites make a translucent colour by appending
 * two hex digits to a token — `D.emerald+"12"`, `${D.indigo}33` — and more do
 * it to colours that arrive as data (a role, a shot category, a team's kit).
 * `var(--x)+"12"` is not a colour; every one of those sites would fail
 * SILENTLY, rendering no background or no border and throwing nothing. The
 * alternative was to rewrite all of them through a helper (`color-mix()`) in
 * the same change as the theme, which is a large diff whose only testable
 * claim is "nothing moved". So `T` and `D` are the same two objects for the
 * life of the page; applyTheme() rewrites their VALUES, bumps a revision, and
 * rebuilds GLOBAL_CSS; the React root re-renders on that, and every inline
 * style reads the new value.
 *
 * The price of that choice is one rule, enforced by design.test.mjs: nothing
 * may copy a token's value into a module-level constant at import time
 * (`const TONE = { ok: D.emerald }`), because that constant would hold
 * whichever theme was current when the module loaded. Read the token inside
 * the render, use a getter, or wrap the table in themed().
 */

// ══════════════════════════════════════════════════════════════════
//  The two value sets
// ══════════════════════════════════════════════════════════════════
//
// Every group here is THEMED: both sets carry exactly the same keys, and
// applyTheme() copies one set's values into `T`. The groups after this block
// (board, space, radius, motion, type, role) are the same in both.

/** FLOODLIT — the dark theme; the 2.0 values, unchanged. */
const FLOODLIT = {
  /**
   * Five steps, each a tonal lift rather than a new colour. The ladder is
   * deliberately shallow (1.40:1 end to end) because depth in a dark interface
   * comes from borders and elevation, not from surfaces racing each other
   * towards grey — and a raised card that is visibly paler than the page reads
   * as a different product, not a different layer.
   */
  surface: {
    canvas:      "#05070a",   // the page itself
    base:        "#0a0d13",   // the default resting surface
    raised:      "#11151d",   // a card lifted off the page
    interactive: "#1a1f29",   // hover, pressed, selected
    overlay:     "#242a36",   // modals, drawers, the Inspector
  },

  /**
   * Three weights of voice. Anything below tertiary is not quiet, it is
   * unreadable — there is no fourth step on purpose.
   */
  content: {
    primary:   "#f4f6f3",     // 13.24:1 — muted warm white, not a blue white
    secondary: "#a3adbb",     //  6.34:1
    tertiary:  "#8a94a5",     //  4.70:1 — the floor, and it only just clears
  },

  /**
   * SCRBRD's own colours. Lime is the signature and is rationed accordingly:
   * it means "this is the intelligent part", and a screen with lime in four
   * places has said that four times and therefore not at all.
   */
  brand: {
    lime:       "#b9f227",    // 10.82:1 — signature, intelligence, emphasis
    accentText: "#b9f227",    // under lights, lime reads as itself
    green:      "#34e58a",    //  8.72:1 — live, healthy, complete
    cyan:       "#2ee6d6",    //  9.19:1 — analysis, motion, data
    blue:       "#3b6ef5",    //  3.24:1 — FILL ONLY. Selective cobalt.
    blueText:   "#93b4fd",    //  6.98:1 — the readable half of blue
  },

  /**
   * State, never sport. A wicket is not an error and a win is not a success
   * message; keeping these separate from `sport` is what stops a scorecard
   * turning red because somebody got out.
   */
  semantic: {
    positive:     "#3ddc84",  // 8.06:1
    warning:      "#f9b233",  // 7.84:1
    critical:     "#f4374f",  // 3.77:1 — FILL ONLY
    criticalText: "#ff9aa6",  // 7.14:1 — the readable half of critical
    info:         "#4fc3f7",  // 7.18:1
  },

  /**
   * The four things cricket is made of. These are DATA colours: a bowling
   * figure is cyan wherever it appears, in a chart, a table or a card, so the
   * reader learns the mapping once.
   */
  sport: {
    batting:      "#f7b733",  // 8.07:1
    bowling:      "#4fd1e8",  // 7.96:1
    fielding:     "#b48cf5",  // 5.49:1
    fieldingText: "#cdb4fb",  // 7.89:1 — lighter than fielding, for small type
    intelligence: "#b9f227",  // 10.82:1 — the same lime, deliberately
  },

  /** Hairlines. A border is how a surface says where it ends in a flat system. */
  line: {
    subtle: "rgba(255,255,255,0.06)",
    normal: "rgba(255,255,255,0.10)",
    strong: "rgba(255,255,255,0.18)",
  },

  /**
   * Translucent fills — the content colour at low alpha, for a panel that sits
   * ON the page rather than being one of the five surfaces: the sign-in card,
   * a text field, a track behind a bar. 2.1 names what the auth screens and
   * the scorer had written as `rgba(255,255,255,…)` by hand.
   */
  fill: {
    panel: "rgba(255,255,255,0.02)",  // a card floating on the page
    field: "rgba(255,255,255,0.05)",  // a text field, a quiet button
    track: "rgba(255,255,255,0.08)",  // a track, a disabled key, a divider bar
  },

  /**
   * Elevation is shadow, not a paler surface. Kept dark and wide so a lifted
   * card reads as lifted rather than as glowing.
   */
  elevation: {
    none:  "none",
    sm:    "0 1px 2px rgba(0,0,0,.45)",
    md:    "0 4px 16px rgba(0,0,0,.45)",
    lg:    "0 12px 40px rgba(0,0,0,.55)",
    xl:    "0 24px 72px rgba(0,0,0,.65)",
    // The one-pixel highlight along a raised edge. Composed after a shadow.
    sheen: "inset 0 1px 0 rgba(255,255,255,.06)",
  },

  /**
   * §21 — glass creates depth, not identity. Budget: roughly 5–10% of surface
   * area, and only where something floats ABOVE the content (navigation, the
   * match HUD, the command bar, the Inspector). Never on a table, a scorecard,
   * a form, or a scorer action grid.
   */
  glass: {
    film:   "rgba(10,13,19,0.72)",
    blur:   "blur(22px) saturate(1.5)",
    edge:   "rgba(255,255,255,0.10)",
    // What a dialog dims the page with. Not glass itself; the dark behind it.
    scrim:  "rgba(0,0,0,0.7)",
  },

  /**
   * §22 — gradients behave like light. One broad, low-opacity wash over a
   * region, with the bento surfaces above it staying flat. Not a per-card
   * decoration: applying these tile by tile is the anti-pattern they exist to
   * replace.
   */
  light: {
    // The ambient page wash — cyan high, lime low, over near-black.
    ambient: "radial-gradient(1200px 600px at 78% -8%, rgba(46,230,214,0.10), transparent 60%), radial-gradient(900px 500px at 8% 8%, rgba(185,242,39,0.06), transparent 55%)",
    live:    "linear-gradient(135deg,#34e58a,#2ee6d6)",
    intel:   "linear-gradient(135deg,#b9f227,#34e58a)",
    cobalt:  "linear-gradient(135deg,#3b6ef5,#2ee6d6)",
    gold:    "linear-gradient(135deg,#f7b733,#f9b233)",
    // The sign-in and onboarding call to action: cobalt into the fielding
    // violet, which the onboarding flow already drew from these tokens.
    action:  "linear-gradient(135deg,#3b6ef5,#b48cf5)",
    // Destructive, and the free-hit alert. Named so they can have a Daylight
    // value; they were two hand-written gradients.
    critical: "linear-gradient(135deg,#f4374f,#dc2626)",
    alert:    "linear-gradient(135deg,#f97316,#f59e0b)",
    // Type set ON one of the gradients above. White under lights, as it was.
    ink:     "#ffffff",
  },

  /** The keyboard focus ring, and the halo that separates it from any surface. */
  focus: {
    ring: "#4fc3f7",
    halo: "rgba(2,6,15,.9)",
  },

  /**
   * The cricket field as the pad and the charts draw it: grass, the square,
   * the pitch strip and the marks on them. A picture of a real place, so it
   * is drawn in the theme's light — a night field under lights, a day field
   * in the sun — and the marks on it take the theme's ink.
   */
  field: {
    ground:      "#070d09",               // the whole playing area, flat
    grass:       "#0e1a10",               // outfield, radial centre
    grassEdge:   "#060c08",               // outfield, at the rope
    square:      "#0c1610",               // the inner ring, centre
    squareEdge:  "#050a07",               // the inner ring, edge
    pitch:       "#7c6e45",               // the strip
    mark:        "rgba(255,255,255,.55)", // creases
    stumps:      "rgba(255,255,255,.8)",
    label:       "rgba(255,255,255,.32)", // a sector's short name
    figure:      "rgba(255,255,255,.65)", // a sector's runs
    watermark:   "rgba(255,255,255,.18)", // OFF / LEG
    rule:        "rgba(255,255,255,.08)", // ring lines
    hairline:    "rgba(255,255,255,.04)", // sector edges
  },

  /**
   * The wagon wheel's run colours: a line per ball, drawn on the field. DATA
   * colours, like `sport`, and until 3b they were aliases of the semantic trio
   * (field.js LK_COLS) — which is why they are a group of their own now: the
   * colour-vision setting (§3.9) moves the trio, and a wheel whose 1–3 went
   * blue beside a blue four would be worse than before. Standard keeps the
   * values the wheel always drew.
   */
  run: {
    four:   "#3b6ef5",   // brand.blue
    six:    "#f9b233",   // semantic.warning
    few:    "#3ddc84",   // 1–3; semantic.positive
    wicket: "#f4374f",   // semantic.critical
    extras: "#f7b733",   // sport.batting
  },
};

/**
 * DAYLIGHT — the light theme, for a phone in the sun (DESIGN_DIRECTION §3.1).
 * Whitewash with a cool-green bias; the accents deepen until they read on it.
 * Every text value is measured against the DARKEST of these five surfaces
 * (interactive, #e3e7dd), which is where a hover row puts it.
 */
const DAYLIGHT = {
  surface: {
    canvas:      "#eef0ea",   // whitewash, cool-green bias
    base:        "#f7f8f4",
    raised:      "#ffffff",
    interactive: "#e3e7dd",   // hover, pressed — the one surface darker than the page
    overlay:     "#ffffff",   // lifted by elevation, not by tone
  },
  content: {
    primary:   "#10140f",     // 14.83:1 on the darkest surface
    secondary: "#4a5347",     //  6.39:1
    // §3.1 proposed #66705f, measured at 4.6:1 against WHITE — and 4.14:1 on
    // the interactive surface, which is a fail where a hover lands. One step
    // darker keeps it clearly tertiary and clears every surface.
    tertiary:  "#5e6857",     //  4.66:1 — the floor
  },
  brand: {
    lime:       "#b9f227",    // FILL ONLY in daylight (1.3:1 on white); ink on it is content.primary
    accentText: "#1e6b3a",    //  5.20:1 — pitch green, lime's readable half
    green:      "#0b733c",    //  4.74:1 — live, healthy, complete
    cyan:       "#0b6f69",    //  4.79:1 — analysis, motion, data
    blue:       "#2e5bd6",    //  4.67:1 — cobalt, deepened so white reads on it (5.86:1) as a fill
    blueText:   "#2455b0",    //  5.58:1
  },
  semantic: {
    positive:     "#1e6b3a",  //  5.20:1
    warning:      "#8a5a00",  //  4.72:1
    critical:     "#b3122a",  //  5.51:1 — reads AND fills in daylight
    criticalText: "#b3122a",
    info:         "#0a6897",  //  4.87:1
  },
  sport: {
    batting:      "#9a4f00",  //  4.79:1 — burnt orange, a step off warning's brown
    bowling:      "#0a6b80",  //  4.88:1
    fielding:     "#7248b8",  //  5.02:1
    fieldingText: "#6a3fb0",  //  5.67:1
    intelligence: "#1e6b3a",  //  5.20:1 — lime's readable half — the same idea as under lights
  },
  line: {
    subtle: "rgba(16,20,15,0.07)",
    normal: "rgba(16,20,15,0.12)",
    strong: "rgba(16,20,15,0.20)",
  },
  fill: {
    panel: "rgba(255,255,255,0.72)",
    field: "#ffffff",
    track: "rgba(16,20,15,0.08)",
  },
  elevation: {
    none:  "none",
    sm:    "0 1px 2px rgba(16,20,15,.08)",
    md:    "0 4px 16px rgba(16,20,15,.08)",
    lg:    "0 12px 40px rgba(16,20,15,.12)",
    xl:    "0 24px 72px rgba(16,20,15,.16)",
    sheen: "inset 0 1px 0 rgba(255,255,255,.9)",
  },
  glass: {
    film:   "rgba(247,248,244,0.80)",
    blur:   "blur(22px) saturate(1.5)",
    edge:   "rgba(16,20,15,0.10)",
    scrim:  "rgba(16,20,15,0.32)",
  },
  light: {
    // Lime low, teal high — the same two lights, faint on white.
    ambient: "radial-gradient(1200px 600px at 78% -8%, rgba(11,111,105,0.06), transparent 60%), radial-gradient(900px 500px at 8% 8%, rgba(185,242,39,0.16), transparent 55%)",
    live:    "linear-gradient(135deg,#0b733c,#0b6f69)",
    intel:   "linear-gradient(135deg,#1e6b3a,#0b733c)",
    cobalt:  "linear-gradient(135deg,#2e5bd6,#0b6f69)",
    gold:    "linear-gradient(135deg,#8a5a00,#9a4f00)",
    action:  "linear-gradient(135deg,#2e5bd6,#7248b8)",
    critical: "linear-gradient(135deg,#b3122a,#8f0e22)",
    alert:    "linear-gradient(135deg,#9a4f00,#8a5a00)",
    ink:     "#ffffff",
  },
  focus: {
    ring: "#0a6897",
    halo: "rgba(255,255,255,.95)",
  },
  field: {
    ground:      "#e3ecdb",
    grass:       "#dbe8d1",
    grassEdge:   "#cddcc2",
    square:      "#e5eedd",
    squareEdge:  "#d6e3cb",
    pitch:       "#c9b98a",
    mark:        "rgba(16,20,15,.5)",
    stumps:      "rgba(16,20,15,.7)",
    label:       "rgba(16,20,15,.5)",
    figure:      "rgba(16,20,15,.78)",
    watermark:   "rgba(16,20,15,.22)",
    rule:        "rgba(16,20,15,.14)",
    hairline:    "rgba(16,20,15,.07)",
  },
  run: {
    four:   "#2e5bd6",
    six:    "#8a5a00",
    few:    "#1e6b3a",
    wicket: "#b3122a",
    extras: "#9a4f00",
  },
};

/** The theme names, as stored and as set on <html data-theme>. */
const THEMES = { daylight: DAYLIGHT, floodlit: FLOODLIT };
const THEMED_GROUPS = Object.keys(FLOODLIT);

// ══════════════════════════════════════════════════════════════════
//  Colour vision (DESIGN_DIRECTION §3.9, SCRBRD-096)
// ══════════════════════════════════════════════════════════════════
//
// A second axis beside the theme: Standard, Red-green safe (protan and deutan)
// and Blue-yellow safe (tritan). It moves ONLY the tokens whose meaning rides
// on hue — the ball chips, the semantic trio, the wagon wheel's runs — and
// combines with either theme. The board's black, white and lime never move;
// nor do layout, words or icons.
//
// Every value below is measured, not chosen by eye, and design.test.mjs holds
// it there: under the deficiencies a palette serves (Machado 2009, full
// severity), every pair of chips and every pair of the semantic trio is at
// least ΔE (CIE76) 20 apart, and at least 25 in ordinary vision; every chip
// is 3:1 against the board and takes a black or white figure at 4.5:1; every
// semantic value still reads on every surface of its theme.

/**
 * The ball chips, in the order a scorer reads them. Theme-independent: they
 * sit on the always-black board. The wicket chip is `board.figure` and the dot
 * is an unfilled `board.dim` mark in every palette; a 5 takes the four's
 * colour; a no-ball, a bye and a leg bye take the wide's.
 *
 * STANDARD is the prototype's (§10, Kameel 2026-09-26: "I'd like the colours
 * back"), with one fix: the wide's #5200bc was 1.9:1 on the board, a hole in
 * the over, and is lightened to 3.8:1 — still purple, still a white figure.
 */
const CHIPS = {
  standard:   { one: "#ec4899", two: "#b2e358", three: "#f2c14b", four: "#3b83f6", six: "#dd514c", extra: "#8445f0" },
  // Okabe–Ito's hues: a reddish purple, a lemon, an amber, a sky blue, a
  // vermillion and a royal blue. Red-green vision reads them as a yellow
  // ramp and a blue ramp, so each ramp is spaced by lightness.
  redgreen:   { one: "#cc6d99", two: "#f7f08c", three: "#f5b700", four: "#56b4e9", six: "#c8600a", extra: "#0062c4" },
  // The prototype's, moved only where tritan vision collapsed them: the one
  // more magenta and the six a clearer red (they were 11 apart), the two a
  // deeper green (it paled into the white wicket).
  blueyellow: { one: "#dd44ae", two: "#96da40", three: "#f2c14b", four: "#3b83f6", six: "#f03a30", extra: "#8445f0" },
};

/**
 * What each palette changes in the themed groups, per theme. Standard changes
 * nothing. A group or a key not named here keeps the theme's own value.
 *
 * `sport` is not here on purpose: batting, bowling and fielding already clear
 * the rule under every deficiency in both themes (design.test.mjs measures it
 * and fails if that stops being true).
 */
const VISION = {
  standard: {},
  redgreen: {
    floodlit: {
      // Saved is sky blue, held is yellow, refused is vermillion: the GitHub
      // colour-blind themes' answer, and the one the Okabe–Ito set gives.
      // Critical reads as well as fills here, so its text half is itself.
      semantic: { positive: "#56b4e9", warning: "#f5d43f", critical: "#f0703c", criticalText: "#f0703c" },
      run: { four: CHIPS.redgreen.four, six: CHIPS.redgreen.six, few: CHIPS.redgreen.two, wicket: "#f4f6f3", extras: CHIPS.redgreen.extra },
    },
    daylight: {
      // Three dark inks that must all read on the hover surface: a blue, an
      // ochre at the top of the AA range, and an oxblood at the bottom of it,
      // so that where the hue is lost the lightness still tells them apart.
      semantic: { positive: "#1f5fa6", warning: "#7c5e00", critical: "#6a0e14", criticalText: "#6a0e14" },
      run: { four: "#0062c4", six: "#a76100", few: "#a0406e", wicket: "#10140f", extras: "#4d3400" },
    },
  },
  blueyellow: {
    floodlit: {
      // Only the pink text half moves: #ff9aa6 and the amber warning are 11
      // apart to a tritan eye. A red that reads replaces it.
      semantic: { criticalText: "#ff5a5f" },
      run: { four: CHIPS.blueyellow.four, six: CHIPS.blueyellow.six, few: CHIPS.blueyellow.two, wicket: "#f4f6f3", extras: CHIPS.blueyellow.extra },
    },
    daylight: {
      // The Daylight trio already clears tritan vision (45 apart at worst).
      run: { four: "#3067f4", six: "#c0282d", few: "#005110", wicket: "#10140f", extras: "#8c13db" },
    },
  },
};
const VISION_NAMES = Object.keys(VISION);

// ══════════════════════════════════════════════════════════════════
//  T — the semantic system
// ══════════════════════════════════════════════════════════════════
const T = {
  // The themed groups — filled from one of the two sets by applyTheme().
  ...Object.fromEntries(THEMED_GROUPS.map((g) => [g, { ...FLOODLIT[g] }])),

  /**
   * THE BOARD. Always black, in both themes, everywhere the score appears
   * (DESIGN_DIRECTION §1, decision 6). A real scoreboard is black against a
   * bright sky; ours sits black on a light page in daylight and black on a
   * dark page under lights. Nothing here switches.
   */
  board: {
    face:   "#0b0e0b",                 // the board itself
    figure: "#f4f6f3",                 // 17.86:1 on the face — painted white figures
    lime:   "#b9f227",                 // 14.60:1 — the figure that just changed, the target
    dim:    "#8a94a5",                 //  6.34:1 — labels on the board
    rule:   "rgba(255,255,255,0.14)",  // the lines between rows
  },

  /**
   * THE BALL CHIPS in "this over" — the prototype's colours (§10), a named
   * exception to one-accent-per-screen: a fixed vocabulary, learned once,
   * like a chart's legend. On the board, so they do not switch with the
   * theme; they switch with the colour-vision setting (CHIPS, above). Every
   * chip carries its figure or word, so colour is never the only signal.
   */
  chip: { ...CHIPS.standard },

  /**
   * A pitch strip as the groundsman's report draws it: clay, painted creases
   * and stumps, cracks, a grass cover. A picture of a real surface, the same
   * whatever the page around it — fixed, like the board.
   */
  strip: {
    clay:      "#c8a96a",
    edge:      "#8a7040",
    crack:     "#6b4f20",
    crackDeep: "#5a3e1a",
    grass:     "#4a8c30",
    paint:     "#ffffff",   // creases and stumps
  },

  /** One 4px rhythm. Anything off it is a decision somebody has to defend. */
  space: { xs:"4px", sm:"8px", md:"12px", lg:"16px", xl:"24px", xxl:"32px", huge:"48px" },

  radius: { xs:"4px", sm:"6px", md:"10px", lg:"14px", xl:"18px", xxl:"24px", pill:"9999px" },

  /**
   * §26 of the refactor strategy, as values. Motion here explains a state
   * change; it is not evidence that the app is modern. The top of the scale is
   * reserved for a match event that genuinely earns an interruption.
   */
  motion: {
    micro:     "140ms",   // a press, a toggle
    control:   "190ms",   // a control settling
    // A board figure turning over when its value changes — the one animation
    // the product is known by (§3.6). Always with `swift`. Reduced motion
    // collapses it to a cut, as it does every animation here.
    flip:      "190ms",
    panel:     "280ms",   // cards, sheets, the Inspector
    nav:       "340ms",   // moving between destinations
    context:   "420ms",   // a larger contextual change
    interrupt: "1100ms",  // wicket, fifty, hundred, result
    ease:      "cubic-bezier(.22,1,.36,1)",
    swift:     "cubic-bezier(.4,0,.2,1)",
  },

  type: {
    head: "'Syne',sans-serif",
    body: "'DM Sans',sans-serif",
    mono: "'DM Mono',monospace",
  },

  /**
   * §3.2 — the type roles, as spreadable styles. One scale, in px, on a 4px
   * rhythm. Figures are DM Mono and tabular so a 142 and a 9 take the same
   * width; Syne is for the wordmark and screen titles only.
   *
   * Tokens, not yet applied: the screens move onto these in steps 2–5. The
   * floors are what smoke-a11y ratchets towards: nothing read under 12px,
   * nothing tapped under 16px.
   */
  //
  // Each role is plain CSS, ready to spread into a style. The two sizes that
  // change with the screen are in `wide` (below), which a style cannot say
  // inline: the board total is drawn with the `.os-board-total` class for it.
  role: {
    figure: {
      board: { fontFamily:"'DM Mono',monospace", fontSize:"56px", lineHeight:1.0, fontWeight:500, fontVariantNumeric:"tabular-nums" },
      lg:    { fontFamily:"'DM Mono',monospace", fontSize:"32px", lineHeight:1.1, fontWeight:500, fontVariantNumeric:"tabular-nums" },
      md:    { fontFamily:"'DM Mono',monospace", fontSize:"20px", lineHeight:1.2, fontWeight:500, fontVariantNumeric:"tabular-nums" },
      sm:    { fontFamily:"'DM Mono',monospace", fontSize:"14px", lineHeight:1.4, fontWeight:400, fontVariantNumeric:"tabular-nums" },
    },
    title: {
      lg: { fontFamily:"'Syne',sans-serif",    fontSize:"24px", lineHeight:1.2, fontWeight:700 },
      md: { fontFamily:"'DM Sans',sans-serif", fontSize:"18px", lineHeight:1.3, fontWeight:600 },
    },
    body:    { fontFamily:"'DM Sans',sans-serif", fontSize:"15px", lineHeight:1.5, fontWeight:400 },
    label:   { fontFamily:"'DM Sans',sans-serif", fontSize:"12px", lineHeight:1.3, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" },
    // 16 stops iOS zooming into a focused field.
    control: { fontFamily:"'DM Sans',sans-serif", fontSize:"16px", fontWeight:500 },
    // The sizes that change with the screen: the board total is 72 on a
    // tablet (from 768px), body is 14 on a desktop (from 1024px).
    wide: {
      figureBoard: { minWidth: "768px",  fontSize: "72px" },
      body:        { minWidth: "1024px", fontSize: "14px" },
    },
  },

  /** §3.2 floors, in px: nothing read below `read`, nothing tapped below `tap`. */
  floor: { read: 12, tap: 16, target: 44 },
};

// ══════════════════════════════════════════════════════════════════
//  D — the compatibility surface
// ══════════════════════════════════════════════════════════════════
// Every entry is an alias of something above. Nothing here may invent a value:
// if a screen needs a colour this list cannot express, the answer is a new
// semantic token, not a new hex in the alias table.
//
// Built by a function because the colour entries are re-pointed in place when
// the theme changes: `D` is one object for the life of the page.
const aliases = () => ({
  // ── Surfaces ──
  bg:T.surface.canvas, base:T.surface.canvas,
  surf0:T.surface.base, surf1:T.surface.raised, surf2:T.surface.interactive, surf3:T.surface.overlay,
  glass:T.glass.film,
  border:T.line.subtle, borderMed:T.line.normal,

  // ── Text ──
  textPrimary:T.content.primary, textSecondary:T.content.secondary, textMuted:T.content.tertiary,

  // ── Accents ──
  // The 1.0 names, pointed at their 2.0 equivalents. `indigo` is now the
  // selective cobalt; `emerald` the luminous green; `cyan` the brand cyan.
  indigo:T.brand.blue, sky:T.semantic.info, emerald:T.semantic.positive, amber:T.semantic.warning,
  rose:T.semantic.critical, orange:T.sport.batting, violet:T.sport.fielding, cyan:T.brand.cyan,
  teal:T.brand.cyan, lime:T.brand.lime, pink:T.sport.fielding,

  // ── Accents, as TEXT ──
  // The pairing, unchanged in principle and re-pointed in value. `indigo` for
  // fills and borders, `indigoText` for anything read.
  indigoText:T.brand.blueText,
  violetText:T.sport.fieldingText,
  roseText:T.semantic.criticalText,

  // ── Gradients ──
  grad:T.light.cobalt, gradMain:T.light.cobalt, gradGold:T.light.gold, gradLive:T.light.live,

  // ── Radius ──
  sm:T.radius.sm, md:T.radius.md, lg:T.radius.lg, xl:T.radius.xl, xxl:T.radius.xxl, pill:T.radius.pill,

  // ── Type ──
  mono:T.type.mono, head:T.type.head, body:T.type.body,
});
const D = aliases();

// ── UTILITY HELPERS ────────────────────────────────────
const px = (n) => `${n}px`;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const channel = (h, i) => {
  const x = parseInt(h.slice(i, i + 2), 16) / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
/** WCAG relative luminance of a #rrggbb colour. */
const luminance = (h) => 0.2126 * channel(h, 1) + 0.7152 * channel(h, 3) + 0.0722 * channel(h, 5);
/** WCAG contrast ratio between two #rrggbb colours. */
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const mix = (a, b, t) => "#" + [1, 3, 5].map((i) =>
  Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)
    .toString(16).padStart(2, "0")).join("");

// A data colour that is not a token (a team's kit, a sponsor's board) made
// legible as text, per theme. Cached: textOn() is called in render.
const legibleCache = new Map();
const legible = (hex) => {
  const key = `${current}:${hex.toLowerCase()}`;
  let out = legibleCache.get(key);
  if (out) return out;
  out = hex;
  const floor = () => Math.min(...Object.values(T.surface).map((s) => contrast(out, s)));
  // Walk it towards the primary ink until it clears on every surface. Hue
  // survives most of the way: a navy kit reads as navy-grey under lights, a
  // gold one as bronze in daylight, rather than both becoming white or black.
  for (let t = 0.1; floor() < 4.5 && t <= 1; t += 0.1) out = mix(hex, T.content.primary, t);
  legibleCache.set(key, out);
  return out;
};

/**
 * The readable half of an accent.
 *
 * Some values fail AA as body text on our surfaces — the cobalt and the
 * critical red under lights; the cobalt and the lime in daylight. They are
 * fine as fills, borders and large display type; the failure is specific to
 * running text.
 *
 * Pass any accent through this at the point it becomes TEXT. Anything with a
 * declared readable pair gets it; any other token is already readable and
 * comes back unchanged; and a colour that arrives as DATA — a role, a team's
 * kit — is walked towards the ink until it reads on every surface of the
 * current theme. So it is safe to apply everywhere rather than remembering
 * which are the problem.
 */
const textOn = (accent) => {
  const pair = {
    [T.brand.blue]:        T.brand.blueText,
    [T.semantic.critical]: T.semantic.criticalText,
    [T.sport.fielding]:    T.sport.fieldingText,
    [T.brand.lime]:        T.brand.accentText,
  }[accent];
  if (pair) return pair;
  return typeof accent === "string" && HEX6.test(accent) ? legible(accent) : accent;
};

/**
 * The ink for type set ON a fill — a count badge, a ball in the over, a key.
 *
 * Whichever of the theme's two inks (the page colour and the primary text
 * colour) reads better against that fill. Under lights the bright accents take
 * the near-black page colour; in daylight the deep ones take the whitewash;
 * lime takes near-black in both. Computed rather than hand-picked, because a
 * hand-picked `#fff` is right in one theme and wrong in the other.
 */
const inkOn = (fill) => {
  if (typeof fill !== "string" || !HEX6.test(fill)) return T.content.primary;
  const [a, b] = [T.surface.canvas, T.content.primary];
  return contrast(a, fill) >= contrast(b, fill) ? a : b;
};

const clr = (hex, a) => hex + Math.round(a*255).toString(16).padStart(2,"0");

// ══════════════════════════════════════════════════════════════════
//  The theme, applied
// ══════════════════════════════════════════════════════════════════
let current = "floodlit";
let currentVision = "standard";
let revision = 0;

/** The theme in force: "daylight" or "floodlit". */
const themeName = () => current;
/** The colour-vision palette in force: "standard", "redgreen" or "blueyellow". */
const visionName = () => currentVision;
/** Bumped on every switch; themed() and anything else caching a derived value keys on it. */
const themeRevision = () => revision;

/**
 * A module-level table that must follow the theme.
 *
 * `const TONE = themed(() => ({ ok: D.emerald, late: D.amber }))` reads like
 * the literal it replaces and is rebuilt the first time it is read after a
 * switch. For tables of COLOURS (read as `TONE[k]`), not for style objects
 * handed to React as `style={X}`: React skips a style prop that is the same
 * object as last render, and a proxy is always the same object. Style objects
 * are functions or live in the render.
 *
 * Nothing is built until the first read, so the table may name things
 * declared after it. A table that is an ARRAY says so — `themed(build, [])` —
 * so that Array.isArray() and the array methods see an array.
 */
function themed(build, shape = {}) {
  let at = -1, value;
  const now = () => (at === revision ? value : (at = revision, value = build()));
  return new Proxy(shape, {
    get: (_, k) => { const v = now(); const x = v[k]; return typeof x === "function" ? x.bind(v) : x; },
    has: (_, k) => k in now(),
    ownKeys: () => Reflect.ownKeys(now()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(now(), k);
      return d && { ...d, configurable: k !== "length" };
    },
  });
}

/**
 * Switch every token to a theme's values, and a colour-vision palette's, in
 * place.
 *
 * `T`'s themed groups, `T.chip` and `D`'s aliases are rewritten on the same
 * objects, so every module that imported them sees the new values on its next
 * read, and GLOBAL_CSS (a live binding) is rebuilt. The caller re-renders —
 * design/theme.js does that for the app.
 *
 * `vision` is the third input (§3.9): the palette laid over the theme. Left
 * out, the one in force stays, so a theme switch never resets it.
 */
function applyTheme(name, vision = currentVision) {
  const set = THEMES[name] ? name : "floodlit";
  const v = VISION[vision] ? vision : "standard";
  const over = VISION[v][set] ?? {};
  for (const g of THEMED_GROUPS) Object.assign(T[g], THEMES[set][g], over[g]);
  Object.assign(T.chip, CHIPS[v]);
  Object.assign(D, aliases());
  current = set;
  currentVision = v;
  revision++;
  GLOBAL_CSS = buildGlobalCss();
  return set;
}

// Before the first read: whatever the boot script in index.html decided, so a
// module that evaluates now, and the first paint, are in the same theme.
// (No document under Node: the tests start under lights and switch.)
const booted = typeof document !== "undefined" ? document.documentElement?.dataset?.theme : undefined;

// A `let`, not a `const`: applyTheme() reassigns it, and an ES module export
// is a live binding, so App.jsx's `<style>{GLOBAL_CSS}</style>` reads the
// current theme's sheet on its next render.
let GLOBAL_CSS = "";
function buildGlobalCss() { return `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{color-scheme:${current === "daylight" ? "light" : "dark"}}
html{background:${T.surface.canvas}}
body{background:${T.surface.canvas};color:${T.content.primary};font-family:${T.type.body}}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:${T.surface.overlay};border-radius:2px}
.os-page{animation:fadeUp .25s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.pressBtn{transition:all .12s ease;transform-origin:center}
.pressBtn:active{transform:scale(0.96)}
.card-hover{transition:all .2s ease}
.card-hover:hover{transform:translateY(-1px);box-shadow:${T.elevation.lg}!important}
.pulse{animation:pulse 2s ease infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.live-dot{width:6px;height:6px;border-radius:50%;background:${T.brand.green};animation:livePulse 1.2s ease infinite}
@keyframes livePulse{0%,100%{box-shadow:0 0 0 0 ${T.brand.green}66}50%{box-shadow:0 0 0 6px transparent}}
.skill-bar{transition:width .6s cubic-bezier(.34,1.56,.64,1)}
.tab-active{position:relative}
.tab-active::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:${T.light.cobalt};border-radius:2px}

/* ── Design System 2.0 ──────────────────────────────────────────

   §22 — gradients behave like light. ONE wash per page region, fixed behind
   the content, with the bento surfaces above it flat. The alternative, which
   this replaces, is a gradient per card: forty small light sources, no
   hierarchy, and body text sitting on a colour ramp. */
.os-ambient{position:relative}
.os-ambient::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background:${T.light.ambient}}
.os-ambient>*{position:relative;z-index:1}

/* §21 — glass floats, and only where something is ABOVE the content. Never on
   a table, a scorecard, a form or the scorer's action grid. */
.os-glass{background:${T.glass.film};
  backdrop-filter:${T.glass.blur};-webkit-backdrop-filter:${T.glass.blur};
  border:1px solid ${T.glass.edge}}

/* Material 3 state layers, as one mechanism rather than per-component hover
   colours. The layer is the CONTENT colour at low alpha, so it works on any
   surface without knowing which one it is on. */
.os-state{position:relative;isolation:isolate}
.os-state::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:${T.content.primary};opacity:0;transition:opacity ${T.motion.micro} ${T.motion.swift}}
.os-state:hover::after{opacity:.05}
.os-state:active::after{opacity:.09}
.os-state[aria-selected="true"]::after,.os-state[data-selected="true"]::after{opacity:.08}

/* Bento: size communicates importance (§4). The span classes are the only
   sanctioned way to make a tile bigger, so "this matters more" stays a
   statement in the markup rather than a one-off grid-column in a style prop. */
.os-bento{display:grid;grid-template-columns:repeat(12,1fr);gap:${T.space.md};align-items:start}
.bento-a{grid-column:span 12}
.bento-b{grid-column:span 6}
.bento-c{grid-column:span 4}
.bento-d{grid-column:span 3}
@media(max-width:1180px){.bento-c{grid-column:span 6}.bento-d{grid-column:span 4}}
@media(max-width:880px){.os-bento{gap:${T.space.sm}}.bento-b,.bento-c,.bento-d{grid-column:span 12}}

/* An event worth interrupting for (§13). Deliberately the only animation in
   the system over half a second. */
@keyframes interruptIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
.os-interrupt{animation:interruptIn ${T.motion.panel} ${T.motion.ease}}

/* §3.6 — a board figure turning over when its value changes: a vertical
   half-turn, like the logo. The board is always black, so none of this
   switches with the theme. Reduced motion (below) makes it a cut. */
@keyframes boardFlip{from{transform:perspective(240px) rotateX(-90deg);opacity:.2}to{transform:none;opacity:1}}
.os-board-total{font-size:${T.role.figure.board.fontSize}}
@media(min-width:${T.role.wide.figureBoard.minWidth}){.os-board-total{font-size:${T.role.wide.figureBoard.fontSize}}}
.os-board-flip{display:inline-block;transform-origin:50% 50%;backface-visibility:hidden;
  animation:boardFlip ${T.motion.flip} ${T.motion.swift} both}

/* ── Keyboard focus ─────────────────────────────────────────────
   There were 164 buttons in this app and not one visible focus state,
   because every one of them sets its own inline styles and none set an
   outline. Tab through it and nothing moved.

   That is not only an accessibility failure. A scorer working one-handed on
   a phone in the rain, an administrator who lives on the keyboard, anyone
   using switch access or voice control — all of them navigate by focus, and
   an invisible focus ring means the app cannot be operated without a mouse
   at all.

   :focus-visible rather than :focus, so a mouse click does not leave a ring
   behind; the browser decides when the interaction was keyboard-driven. The
   offset keeps the ring clear of the element's own border, and the halo
   underneath it guarantees contrast against any surface, where the accent
   alone would be too close in value. */
:focus-visible{
  outline:2px solid ${T.focus.ring};
  outline-offset:2px;
  border-radius:${T.radius.sm};
  box-shadow:0 0 0 4px ${T.focus.halo};
}
/* Never remove the ring without replacing it. */
:focus:not(:focus-visible){outline:none}

/* Skip link — the first thing a keyboard reaches, invisible until focused.
   Without it, reaching the scoring pad means tabbing through the whole of
   the navigation on every page. */
.skip-link{position:absolute;left:-9999px;top:0;z-index:10000;
  padding:10px 16px;border-radius:0 0 ${T.radius.md} 0;background:${T.focus.ring};color:${inkOn(T.focus.ring)};
  font-family:${T.type.head};font-size:12px;font-weight:700;text-decoration:none}
.skip-link:focus{left:0}

/* Visually hidden, but read aloud. For labels and live regions that would
   otherwise have to be either invisible to a screen reader or visible to
   everyone. */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;
  overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* ── Reduced motion ─────────────────────────────────────────────
   This app animates a great deal: cards fade up on every page, the dynamic
   bar rotates every seven seconds, milestone overlays sweep in over the
   scoring pad, and the live dot pulses continuously. For someone with a
   vestibular disorder that is not decoration, it is nausea — and the
   scoring pad is the screen they cannot look away from.

   The !important flags are load-bearing: animations here are set inline and in
   component classes, and a preference the user has expressed at the OS
   level must win over both. Durations go to 1ms rather than 0 so that
   animationend / transitionend handlers still fire; several components
   sequence state off those events, and killing them outright would leave
   overlays stranded on screen. */
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{
    animation-duration:1ms!important;
    animation-iteration-count:1!important;
    transition-duration:1ms!important;
    scroll-behavior:auto!important;
  }
  .pressBtn:active{transform:none}
  .card-hover:hover{transform:none}
}

/* ── ScrbrdOS responsive layer — mobile first ── */
html{-webkit-text-size-adjust:100%}
button{touch-action:manipulation}
.os-main{padding:24px}
@keyframes sheetUp{from{transform:translateY(28px);opacity:.4}to{transform:none;opacity:1}}
@keyframes drawerIn{from{transform:translateY(100%)}to{transform:none}}
.os-bottomnav{position:fixed;left:0;right:0;bottom:0;z-index:400;display:none;gap:2px;
  background:${T.glass.film};backdrop-filter:${T.glass.blur};-webkit-backdrop-filter:${T.glass.blur};
  border-top:1px solid ${T.glass.edge};padding:6px 8px calc(6px + env(safe-area-inset-bottom))}
.os-drawer-scrim{position:fixed;inset:0;z-index:490;background:${T.glass.scrim}}
.os-drawer{position:fixed;left:0;right:0;bottom:0;z-index:500;background:${T.surface.overlay};
  border-top:1px solid ${T.line.normal};border-radius:20px 20px 0 0;max-height:78vh;overflow-y:auto;
  padding:14px 14px calc(18px + env(safe-area-inset-bottom));animation:drawerIn ${T.motion.panel} ${T.motion.ease}}
.os-exit-scorer{position:fixed;top:calc(10px + env(safe-area-inset-top));left:10px;z-index:9999;
  display:flex;align-items:center;gap:6px;min-height:44px;padding:8px 16px;border-radius:999px;cursor:pointer;
  background:${T.glass.film};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border:1px solid ${T.glass.edge};color:${T.content.primary};font-family:${T.type.body};font-size:14px;
  font-weight:600;box-shadow:${T.elevation.lg}}
@media(max-width:1180px) and (min-width:881px){
  .os-shell{--g-4:repeat(2,1fr);--g-5:repeat(3,1fr)}
}
@media(max-width:880px){
  .os-shell{--g-side-r:1fr;--g-side-l:1fr;--g-4:repeat(2,1fr);--g-5:repeat(2,1fr);
    --g-league:1.7fr repeat(6,minmax(28px,1fr))}
  .os-main{padding:14px 12px calc(92px + env(safe-area-inset-bottom))!important}
  .os-kbd,.os-username{display:none!important}
  .os-bottomnav{display:flex}
  .os-modal{align-items:flex-end!important;padding:0!important}
  .os-modal-card{max-width:100%!important;max-height:92vh!important;
    border-radius:18px 18px 0 0!important;animation:sheetUp ${T.motion.panel} ${T.motion.ease}}
  .os-shell table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
}
@media(max-width:640px){
  .os-shell{--g-2:1fr;--g-3:1fr}
}

/* ── Print (SCRBRD-082) ──────────────────────────────────────────
   Nothing else in the product ships a print stylesheet, so this is one
   utility rather than a print theme for every screen: whichever element on
   the page carries \`.os-print-area\` is the only thing a print of that page
   shows, wherever it sits in the tree — a report opened as a modal over the
   shell is still nested under the sidebar and the topbar, so hiding those two
   by name would miss the next thing that opens the same way. The standard
   "print just this element" rule instead: hide everything, then reveal one
   subtree and pull it out of the page's normal flow so it prints from the
   top of the sheet rather than wherever the modal happened to be centred.
   Paper is white and ink is black in either theme: fixed, not tokens. */
@media print{
  body *{visibility:hidden}
  .os-print-area,.os-print-area *{visibility:visible}
  .os-print-area{position:absolute;left:0;top:0;width:100%;margin:0;padding:0;background:#fff;color:#000;box-shadow:none}
  .os-print-hide{display:none!important}
}
`; }

applyTheme(booted === "daylight" ? "daylight" : "floodlit");

// One line: tools/check-imports.mjs reads a module's exports from it.
export { D, T, GLOBAL_CSS, FLOODLIT, DAYLIGHT, THEMES, CHIPS, VISION, VISION_NAMES, applyTheme, themeName, visionName, themeRevision, themed, clr, contrast, inkOn, luminance, px, textOn };
