const D = {
  // ── Base surfaces (unified · SCRBRD canonical) ──
  bg:"#060910", base:"#060910",                 // base + bg aliased
  surf0:"#0a0f1a", surf1:"#0f1621", surf2:"#151d2e", surf3:"#1c2640",
  glass:"rgba(10,14,28,0.75)",
  border:"rgba(255,255,255,0.07)", borderMed:"rgba(255,255,255,0.12)",
  // ── Text ──
  textPrimary:"#f0f4ff", textSecondary:"#8b9bc4",
  // textMuted was #4a5570 — 2.47:1 against the card surfaces, against a 4.5:1
  // floor. It is the colour of nearly every small label in the app: the sub-
  // labels on the scoring pad, the over count beside the score, field names,
  // timestamps. Not decoration — the words that say what a number means.
  //
  // Raised to the lightest value that clears 4.5:1 on every surface here
  // (4.53:1 on surf3, the worst case) while keeping the original hue and
  // saturation, so it still reads as the same muted blue-grey rather than
  // becoming a second secondary. Anything genuinely decorative should be
  // aria-hidden and drawn some other way, not made unreadable.
  textMuted:"#818dac",
  // ── Accent palette ──
  // sky is the website's #38bdf8 rather than the app's old #0ea5e9: the two
  // surfaces were a shade apart for no reason, and the lighter one is a free
  // contrast improvement (7.00:1 at worst, against 5.41 before).
  indigo:"#6366f1", sky:"#38bdf8", emerald:"#10b981", amber:"#f59e0b",
  rose:"#f43f5e", orange:"#f97316", violet:"#8b5cf6", cyan:"#06b6d4",
  teal:"#14b8a6", lime:"#84cc16", pink:"#ec4899",

  // ── Accents, as TEXT ──
  // indigo is the brand colour and fails as body text on every surface
  // (3.36-4.46:1). violet and rose fail on the darker ones. They are perfectly
  // good as fills, borders and large display type — the failure is specific to
  // running text, which is what they are currently used for.
  //
  // A token PAIR rather than a replacement, because the fill and the type want
  // genuinely different values: lighten the fill and the brand goes pale.
  // #a5b4fc already appeared ten times in the codebase before this existed —
  // the lighter indigo was reached for instinctively wherever legibility
  // actually mattered, and this formalises that instinct rather than inventing
  // something.
  //
  // Rule: `indigo` for fills and borders, `indigoText` for anything read.
  indigoText:"#a5b4fc",   // 7.52:1 at worst
  violetText:"#c4b5fd",   // 8.12:1
  roseText:"#fda4af",     // 7.93:1 — rose alone fails on surf3 (4.08)
  // ── Gradients (grad + gradMain aliased) ──
  grad:"linear-gradient(135deg,#6366f1,#0ea5e9)",
  gradMain:"linear-gradient(135deg,#6366f1,#0ea5e9)",
  gradGold:"linear-gradient(135deg,#f59e0b,#f97316)",
  gradLive:"linear-gradient(135deg,#10b981,#06b6d4)",
  // ── Radius ──
  sm:"6px", md:"10px", lg:"14px", xl:"18px", xxl:"24px", pill:"9999px",
  // ── Type ──
  mono:"'DM Mono',monospace", head:"'Syne',sans-serif", body:"'DM Sans',sans-serif",
};

// ── UTILITY HELPERS ────────────────────────────────────
const px = (n) => `${n}px`;

const D_ACCENT_INDIGO = "#6366f1", D_ACCENT_VIOLET = "#8b5cf6", D_ACCENT_ROSE = "#f43f5e";

/**
 * The readable half of an accent.
 *
 * Three accents fail WCAG AA as body text on our surfaces — indigo (the brand
 * colour) on all of them, violet and rose on the darker ones. They are fine as
 * fills, borders and large display type; the failure is specific to running
 * text, which is where they were being used.
 *
 * Pass any accent through this at the point it becomes TEXT. Anything with no
 * readable pair comes back unchanged, so it is safe to apply everywhere rather
 * than remembering which three are the problem — and a colour picked from data
 * (a shot category, a role) can be styled without the call site knowing which
 * value it received.
 */
const textOn = (accent) => ({
  [D_ACCENT_INDIGO]: "#a5b4fc",
  [D_ACCENT_VIOLET]: "#c4b5fd",
  [D_ACCENT_ROSE]:   "#fda4af",
}[accent] ?? accent);


const clr = (hex, a) => hex + Math.round(a*255).toString(16).padStart(2,"0");

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:${D.bg};color:${D.textPrimary};font-family:${D.body}}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:${D.surf3};border-radius:2px}
.os-page{animation:fadeUp .25s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.pressBtn{transition:all .12s ease;transform-origin:center}
.pressBtn:active{transform:scale(0.96)}
.card-hover{transition:all .2s ease}
.card-hover:hover{transform:translateY(-1px);box-shadow:0 8px 32px rgba(0,0,0,.4)!important}
.pulse{animation:pulse 2s ease infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.live-dot{width:6px;height:6px;border-radius:50%;background:${D.emerald};animation:livePulse 1.2s ease infinite}
@keyframes livePulse{0%,100%{box-shadow:0 0 0 0 ${D.emerald}66}50%{box-shadow:0 0 0 6px transparent}}
.skill-bar{transition:width .6s cubic-bezier(.34,1.56,.64,1)}
.tab-active{position:relative}
.tab-active::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:${D.gradMain};border-radius:2px}

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
  outline:2px solid ${D.sky};
  outline-offset:2px;
  border-radius:${D.sm};
  box-shadow:0 0 0 4px rgba(2,6,15,.9);
}
/* Never remove the ring without replacing it. */
:focus:not(:focus-visible){outline:none}

/* Skip link — the first thing a keyboard reaches, invisible until focused.
   Without it, reaching the scoring pad means tabbing through the whole of
   the navigation on every page. */
.skip-link{position:absolute;left:-9999px;top:0;z-index:10000;
  padding:10px 16px;border-radius:0 0 ${D.md} 0;background:${D.sky};color:#02060f;
  font-family:${D.head};font-size:12px;font-weight:700;text-decoration:none}
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
  background:rgba(8,12,20,.94);backdrop-filter:blur(22px) saturate(1.6);-webkit-backdrop-filter:blur(22px) saturate(1.6);
  border-top:1px solid rgba(255,255,255,.08);padding:6px 8px calc(6px + env(safe-area-inset-bottom))}
.os-drawer-scrim{position:fixed;inset:0;z-index:490;background:rgba(0,0,0,.6)}
.os-drawer{position:fixed;left:0;right:0;bottom:0;z-index:500;background:${D.surf1};
  border-top:1px solid ${D.borderMed};border-radius:20px 20px 0 0;max-height:78vh;overflow-y:auto;
  padding:14px 14px calc(18px + env(safe-area-inset-bottom));animation:drawerIn .28s cubic-bezier(.22,1,.36,1)}
.os-exit-scorer{position:fixed;top:calc(10px + env(safe-area-inset-top));left:10px;z-index:9999;
  display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:999px;cursor:pointer;
  background:rgba(10,14,28,.8);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
  border:1px solid rgba(255,255,255,.14);color:#f0f4ff;font-family:${D.head};font-size:10px;
  font-weight:700;letter-spacing:.1em;box-shadow:0 8px 28px rgba(0,0,0,.5)}
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
    border-radius:18px 18px 0 0!important;animation:sheetUp .28s cubic-bezier(.22,1,.36,1)}
  .os-shell table{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch}
}
@media(max-width:640px){
  .os-shell{--g-2:1fr;--g-3:1fr}
}
`;

export { D, GLOBAL_CSS, clr, px, textOn };
