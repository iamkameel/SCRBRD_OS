import { T } from "../design/tokens.js";

/**
 * The home page's own stylesheet: the film's stage, the reveals, the over in
 * the header, and the storyboard that replaces the film for reduced motion.
 * A function, not a constant, so the few theme colours in it follow a theme
 * switch (tokens.js rewrites T in place); main.jsx renders it beside
 * GLOBAL_CSS.
 *
 * THE RULES IT KEEPS
 *   - Everything that moves is inside `@media (prefers-reduced-motion:
 *     no-preference)`. With reduced motion nothing here animates, the film's
 *     stage is not drawn, and the five shots are a storyboard of stills with
 *     their captions, all of it visible.
 *   - The page is complete at rest. A reveal starts from a VISIBLE state
 *     (opacity .35, a few pixels low), never from nothing, and the state it
 *     starts from is applied only where something will end it: a scroll
 *     timeline (CSS), or the IntersectionObserver fallback, which marks <html>
 *     with `rv-io` before it hides anything.
 *   - Scroll-driven where CSS can do it (`animation-timeline: view()` and
 *     `scroll()`), with no library. The film itself is a canvas driven by
 *     film/engine.js, because a CSS timeline cannot draw a bowler.
 *   - Nothing wider than the screen: the stage clips, and every block keeps
 *     the 16px gutter.
 */
export function homeCss() {
  const scrim = "rgba(4,7,12,0.78)";
  return `
html{scroll-padding-top:76px}
body{overflow-x:clip}
.film{position:relative;isolation:isolate;color:#f4f6f3;
  background:linear-gradient(180deg,#03060d 0%,#0a1a30 45%,#2a3b58 62%,#174a2c 63%,#0b2f1d 100%)}
.film-stage{position:sticky;top:0;height:100vh;height:100svh;overflow:hidden;z-index:0}
.film-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.film-stage::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse 85% 75% at 50% 55%,rgba(0,0,0,0) 50%,rgba(0,0,0,.55) 100%)}
.film-block{position:relative;z-index:1;min-height:100vh;min-height:100svh;padding:0 16px}
.film-hero{margin-top:-100vh;margin-top:-100svh;display:flex;flex-direction:column;padding-top:clamp(84px,13svh,140px);padding-bottom:24px}
.film-hero::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
  background:linear-gradient(180deg,rgba(3,6,12,.86) 0%,rgba(3,6,12,.62) 42%,rgba(3,6,12,0) 70%)}
.film-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}
.film-in{width:100%;max-width:760px}
.film-cue{margin-top:auto;align-self:center;display:flex;flex-direction:column;align-items:center;gap:8px;
  font-family:${T.type.mono};font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#c9d1db;padding-top:24px}
.film-cue i{width:14px;height:14px;border-radius:50%;background:#c8262f;box-shadow:inset -3px -2px 0 rgba(0,0,0,.25);position:relative}
.film-cue i::after{content:"";position:absolute;left:2px;right:2px;top:6px;border-top:1.5px dashed #f6efdc}
.film-shots{list-style:none;margin:0;padding:0}
.film-shot{display:flex;align-items:flex-start;padding-top:62vh;padding-top:62svh}
.film-cap{max-width:440px;background:${scrim};-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
  border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:20px 20px 22px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.film-tag{font-family:${T.type.mono};font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#b9f227;margin:0 0 8px}
.film-cap h2{font-family:${T.type.head};font-size:clamp(22px,5.4vw,30px);line-height:1.12;font-weight:700;margin:0 0 10px;color:#f4f6f3;letter-spacing:-.01em}
.film-cap p.film-say{font-family:${T.type.body};font-size:16px;line-height:1.55;color:#c9d1db;margin:0}
.film-still{display:none}
@media (min-width:900px){
  .film-block{padding-left:max(40px,calc((100vw - 1180px)/2));padding-right:40px}
  .film-shot{padding-top:56vh;padding-top:56svh}
}

@media (min-width:1000px){#home-tiles{--wide:2}#home-tiles ol{grid-template-columns:repeat(4,1fr)!important}}

/* The over, in the header: six balls, lit one by one as the page is read. */
.ov{display:flex;gap:5px;align-items:center}
.ov b{width:8px;height:8px;border-radius:50%;border:1.5px solid ${T.line.strong};box-sizing:border-box}

@media (max-width:479px){header.has-live .ov{display:none}}

/* Board figures that change turn over (GLOBAL_CSS's boardFlip); the strip's
   cards lift a little under a pointer. */
.hb-card{transition:transform .18s ease,border-color .18s ease}
.hb-card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.28)}
.hb-tile{transition:transform .2s ease,box-shadow .2s ease}
.hb-tile:hover{transform:translateY(-3px);box-shadow:${T.elevation.lg}}

@media (prefers-reduced-motion:no-preference){
  html{scroll-behavior:smooth}
  .film-cue i{animation:cueBob 1.6s cubic-bezier(.45,0,.55,1) infinite}
  @keyframes cueBob{0%,100%{transform:translateY(0)}50%{transform:translateY(8px)}}
  @keyframes lampOn{from{background:transparent;border-color:${T.line.strong}}to{background:#b9f227;border-color:#b9f227}}
  @keyframes rvIn{from{opacity:.35;transform:translateY(28px)}to{opacity:1;transform:none}}
  @keyframes seamDraw{from{clip-path:inset(0 70% 0 0)}to{clip-path:inset(0 0 0 0)}}
  .lamp-live{animation:livePulse 1.2s ease infinite}
  @supports (animation-timeline: view()){
    .ov b{animation:lampOn linear both;animation-timeline:scroll(root);animation-range:calc(var(--i) * 16.6%) calc(var(--i) * 16.6% + 6%)}
    .rv{animation:rvIn linear both;animation-timeline:view();animation-range:entry 0% entry 70%}
    .rv-seam svg{animation:seamDraw linear both;animation-timeline:view();animation-range:entry 10% cover 45%}
  }
  html.rv-io .rv{transition:opacity .6s ${T.motion.ease},transform .6s ${T.motion.ease};transition-delay:calc(var(--i,0) * 60ms)}
  html.rv-io .rv:not(.in){opacity:.35;transform:translateY(28px)}
}

/* Reduced motion: the film is a storyboard of five stills, every caption under its frame. */
@media (prefers-reduced-motion:reduce){
  .film-stage{display:none}
  .film-hero{margin-top:0;min-height:0;padding-bottom:56px}
  .film-hero .film-still{display:block;position:absolute;inset:0;width:100%;height:100%;z-index:-2}
  .film-cue{display:none}
  .film-shots{display:grid;gap:20px;padding:32px 16px 56px;max-width:1180px;margin:0 auto;
    grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
  .film-shot{min-height:0;padding:0;flex-direction:column;align-items:stretch}
  .film-shot .film-still{display:block;width:100%;aspect-ratio:4/5;border-radius:18px 18px 0 0}
  .film-shot .film-cap{max-width:none;border-radius:0 0 18px 18px;-webkit-backdrop-filter:none;backdrop-filter:none;flex:1}
}
`;
}
