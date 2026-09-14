/**
 * SCRBRD DESIGN SYSTEM 2.0 — foundations.
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
 * checked by apps/web/test/design.test.mjs rather than by anyone's judgement.
 * Two colours cannot: cobalt and the critical red. They are kept as FILLS and
 * paired with a readable half — the same discipline the 1.0 palette arrived at
 * for indigo, violet and rose, and for the same reason: lightening the fill
 * until it reads washes the colour out of the brand.
 *
 *   Fills and borders → brand.blue, semantic.critical
 *   Anything read     → brand.blueText, semantic.criticalText, or textOn()
 */

// ══════════════════════════════════════════════════════════════════
//  T — the semantic system
// ══════════════════════════════════════════════════════════════════
const T = {
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
    lime:      "#b9f227",     // 10.82:1 — signature, intelligence, emphasis
    green:     "#34e58a",     //  8.72:1 — live, healthy, complete
    cyan:      "#2ee6d6",     //  9.19:1 — analysis, motion, data
    blue:      "#3b6ef5",     //  3.24:1 — FILL ONLY. Selective cobalt.
    blueText:  "#93b4fd",     //  6.98:1 — the readable half of blue
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
    intelligence: "#b9f227",  // 10.82:1 — the same lime, deliberately
  },

  /** Hairlines. A border is how a surface says where it ends in a flat system. */
  line: {
    subtle: "rgba(255,255,255,0.06)",
    normal: "rgba(255,255,255,0.10)",
    strong: "rgba(255,255,255,0.18)",
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
    panel:     "280ms",   // cards, sheets, the Inspector
    nav:       "340ms",   // moving between destinations
    context:   "420ms",   // a larger contextual change
    interrupt: "1100ms",  // wicket, fifty, hundred, result
    ease:      "cubic-bezier(.22,1,.36,1)",
    swift:     "cubic-bezier(.4,0,.2,1)",
  },

  /**
   * Elevation is shadow, not a paler surface. Kept dark and wide so a lifted
   * card reads as lifted rather than as glowing.
   */
  elevation: {
    none: "none",
    sm:   "0 1px 2px rgba(0,0,0,.45)",
    md:   "0 4px 16px rgba(0,0,0,.45)",
    lg:   "0 12px 40px rgba(0,0,0,.55)",
    xl:   "0 24px 72px rgba(0,0,0,.65)",
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
  },

  type: {
    head: "'Syne',sans-serif",
    body: "'DM Sans',sans-serif",
    mono: "'DM Mono',monospace",
  },
};

// ══════════════════════════════════════════════════════════════════
//  D — the compatibility surface
// ══════════════════════════════════════════════════════════════════
// Every entry is an alias of something above. Nothing here may invent a value:
// if a screen needs a colour this list cannot express, the answer is a new
// semantic token, not a new hex in the alias table.
const D = {
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
  indigoText:T.brand.blueText,   // 6.98:1
  violetText:"#cdb4fb",          // 7.08:1 — lighter than sport.fielding
  roseText:T.semantic.criticalText, // 7.14:1

  // ── Gradients ──
  grad:T.light.cobalt, gradMain:T.light.cobalt, gradGold:T.light.gold, gradLive:T.light.live,

  // ── Radius ──
  sm:T.radius.sm, md:T.radius.md, lg:T.radius.lg, xl:T.radius.xl, xxl:T.radius.xxl, pill:T.radius.pill,

  // ── Type ──
  mono:T.type.mono, head:T.type.head, body:T.type.body,
};

// ── UTILITY HELPERS ────────────────────────────────────
const px = (n) => `${n}px`;

/**
 * The readable half of an accent.
 *
 * Two values in the 2.0 palette fail AA as body text on our surfaces —
 * the cobalt and the critical red. They are fine as fills, borders and large
 * display type; the failure is specific to running text.
 *
 * Pass any accent through this at the point it becomes TEXT. Anything with no
 * readable pair comes back unchanged, so it is safe to apply everywhere rather
 * than remembering which two are the problem — and a colour picked from data
 * (a shot category, a role) can be styled without the call site knowing which
 * value it received.
 */
const textOn = (accent) => ({
  [T.brand.blue]:        T.brand.blueText,
  [T.semantic.critical]: T.semantic.criticalText,
  [T.sport.fielding]:    "#cdb4fb",
}[accent] ?? accent);

const clr = (hex, a) => hex + Math.round(a*255).toString(16).padStart(2,"0");

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
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
   offset keeps the ring clear of the element's own border, and the shadow
   underneath it guarantees contrast against a dark surface where the accent
   alone would be too close in value. */
:focus-visible{
  outline:2px solid ${T.semantic.info};
  outline-offset:2px;
  border-radius:${T.radius.sm};
  box-shadow:0 0 0 4px rgba(2,6,15,.9);
}
/* Never remove the ring without replacing it. */
:focus:not(:focus-visible){outline:none}

/* Skip link — the first thing a keyboard reaches, invisible until focused.
   Without it, reaching the scoring pad means tabbing through the whole of
   the navigation on every page. */
.skip-link{position:absolute;left:-9999px;top:0;z-index:10000;
  padding:10px 16px;border-radius:0 0 ${T.radius.md} 0;background:${T.semantic.info};color:#02060f;
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
.os-drawer-scrim{position:fixed;inset:0;z-index:490;background:rgba(0,0,0,.6)}
.os-drawer{position:fixed;left:0;right:0;bottom:0;z-index:500;background:${T.surface.overlay};
  border-top:1px solid ${T.line.normal};border-radius:20px 20px 0 0;max-height:78vh;overflow-y:auto;
  padding:14px 14px calc(18px + env(safe-area-inset-bottom));animation:drawerIn ${T.motion.panel} ${T.motion.ease}}
.os-exit-scorer{position:fixed;top:calc(10px + env(safe-area-inset-top));left:10px;z-index:9999;
  display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:999px;cursor:pointer;
  background:${T.glass.film};backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border:1px solid ${T.glass.edge};color:${T.content.primary};font-family:${T.type.head};font-size:10px;
  font-weight:700;letter-spacing:.1em;box-shadow:${T.elevation.lg}}
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
`;

export { D, T, GLOBAL_CSS, clr, px, textOn };
