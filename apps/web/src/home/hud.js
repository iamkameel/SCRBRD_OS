import { T, clr } from "../design/tokens.js";

/**
 * The page's micro-interactions and its HUD (Kameel, 6 Nov 2026: "make it
 * look and feel like a modern video game"), in every picture mode: the
 * captions as HUD cards, the hero's words slamming in, the header's progress
 * bar, the ticker on the board, tiles that lean to the pointer, the privacy
 * promise's reveal, the ring round the schools' panel, and the shine on a
 * call to action. fx.js's rules hold here too: everything that moves is
 * inside `prefers-reduced-motion: no-preference`, a reveal starts visible
 * (opacity .35 or a few pixels off), and only transform, opacity, clip-path
 * and stroke-dashoffset are animated, never a layout property.
 */
export function interactCss() {
  const lime = "#b9f227", cyan = T.brand.cyan;
  return `
.kicker{display:flex;align-items:center;gap:10px}
.kicker::before{content:"";width:22px;height:2px;background:currentColor;box-shadow:0 0 10px currentColor;flex:none}
.film-n{display:inline-block;padding:1px 7px;border-radius:4px;background:${lime};color:#05070a;font-weight:500}
.tick{overflow:hidden;margin:0 -16px 16px;border-top:1px solid rgba(255,255,255,.08);border-bottom:1px solid rgba(255,255,255,.08);background:#050705;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}
.tick-run{display:flex;width:max-content}
.tick-item{display:inline-flex;align-items:center;gap:10px;padding:11px 32px 11px 0;font-family:${T.type.mono};font-size:13px;line-height:1;letter-spacing:.06em;color:#f4f6f3;white-space:nowrap;font-variant-numeric:tabular-nums}
.tick-dot{width:6px;height:6px;border-radius:50%;background:${lime};box-shadow:0 0 8px ${lime};display:block}
.hb-card{position:relative;overflow:hidden}
.hb-card::after,a.pressBtn::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;
  background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.16) 50%,transparent 65%);transform:translateX(-110%)}
a.pressBtn{position:relative;overflow:hidden}
.tiles{perspective:1000px}
.hb-tile{transition:transform .28s ${T.motion.ease},box-shadow .28s ease,border-color .28s ease}
.hb-tile::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .25s ease;
  background:radial-gradient(280px circle at var(--mx,50%) var(--my,30%),${clr(T.brand.lime, 0.14)},transparent 62%)}
.hb-tile:hover{box-shadow:${T.elevation.lg};border-color:${clr(T.brand.accentText, 0.4)}!important}
.hb-tile:hover::after{opacity:1}
.chip{transition:border-color .2s ease,color .2s ease}
.chip:hover{border-color:${T.brand.accentText}!important;color:${T.content.primary}!important}
.hb-post{transition:transform .2s ease,border-color .2s ease}
.hb-post:hover{border-color:${T.line.strong}!important}
.pr-shield path{stroke-dasharray:1;stroke-dashoffset:0}
.cta-ring{isolation:isolate}
.cta-ring::after{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;pointer-events:none;
  background:conic-gradient(from var(--ang,0deg),transparent 0 55%,${lime} 72%,${cyan} 84%,transparent 100%);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.xp{display:none}
@property --ang{syntax:"<angle>";inherits:false;initial-value:0deg}

@media (prefers-reduced-motion:no-preference){
  @keyframes slam{from{clip-path:inset(0 100% 0 0);transform:translateX(-18px) skewX(-10deg)}to{clip-path:inset(0 0 -20% 0);transform:none}}
  @keyframes riseIn{from{opacity:.35;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes popIn{from{opacity:.35;transform:scale(.88)}to{opacity:1;transform:none}}
  .h1-a,.h1-b{animation:slam .62s ${T.motion.punch} both}
  .h1-b{animation-delay:.09s}
  .hero-pill{animation:popIn .45s ${T.motion.punch} both}
  .hero-lede{animation:riseIn .5s ${T.motion.ease} .14s both}
  .hero-doors,.hero-ctas{animation:riseIn .5s ${T.motion.ease} .2s both}
  .film-cap{clip-path:polygon(0 0,calc(100% - 22px) 0,100% 22px,100% 100%,22px 100%,0 calc(100% - 22px));border-radius:4px;position:relative}
  .film-cap::before{content:"";position:absolute;left:0;top:22px;bottom:22px;width:3px;background:${lime};box-shadow:0 0 14px ${lime}}
  .hb-card:hover::after,a.pressBtn:hover::after{transform:translateX(110%);transition:transform .65s ${T.motion.ease}}
  .tick-run{animation:tickRun var(--tick-s,32s) linear infinite}
  .tick:hover .tick-run{animation-play-state:paused}
  @keyframes tickRun{to{transform:translateX(-50%)}}
  .hb-tile{transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))}
  .hb-tile:hover{transform:translateY(-4px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg))}
  .hb-tile:active{transform:translateY(-1px) scale(.985);transition-duration:.12s}
  .hb-post:hover{transform:translateY(-2px)}
  .cta-ring::after{animation:ringSpin 7s linear infinite}
  @keyframes ringSpin{to{--ang:360deg}}
  @keyframes capIn{from{opacity:.35;transform:translateX(-36px) skewX(-6deg)}to{opacity:1;transform:none}}
  @keyframes headIn{from{opacity:.35;transform:translateY(22px);clip-path:inset(0 0 40% 0)}to{opacity:1;transform:none;clip-path:inset(0 0 -20% 0)}}
  @keyframes barDraw{from{transform:scaleY(.15)}to{transform:none}}
  @keyframes scan{from{transform:translateY(0)}to{transform:translateY(360%)}}
  @keyframes rowIn{from{opacity:.35;transform:translateX(14px)}to{opacity:1;transform:none}}
  @keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
  @keyframes xp{from{transform:scaleX(0)}to{transform:none}}
  @supports (animation-timeline: view()){
    .film-cap{animation:capIn linear both;animation-timeline:view();animation-range:entry 0% cover 32%}
    .display-h{animation:headIn linear both;animation-timeline:view();animation-range:entry 5% cover 30%}
    .pr-li{position:relative}
    .pr-li::before{content:"";position:absolute;left:-3px;top:0;bottom:0;width:3px;background:${T.brand.accentText};box-shadow:0 0 12px ${T.brand.accentText};
      transform-origin:top;animation:barDraw linear both;animation-timeline:view();animation-range:entry 10% cover 40%}
    .pr-card::after{content:"";position:absolute;left:0;right:0;top:-40%;height:40%;pointer-events:none;
      background:linear-gradient(180deg,transparent,${clr(T.brand.lime, 0.18)} 70%,${clr(T.brand.lime, 0.4)} 98%,transparent);animation:scan linear both;animation-timeline:view();animation-range:entry 30% cover 60%}
    .pr-row{animation:rowIn linear both;animation-timeline:view();animation-range:entry 40% cover 55%}
    .pr-shield path{animation:draw linear both;animation-timeline:view();animation-range:entry 30% cover 50%}
    .pr-shield .pr-tick{animation-range:cover 35% cover 55%}
  }
  @supports (animation-timeline: scroll()){
    .xp{display:block;position:absolute;left:0;right:0;bottom:-1px;height:2px;background:linear-gradient(90deg,${lime},${cyan});
      transform-origin:0 50%;box-shadow:0 0 10px ${lime};animation:xp linear both;animation-timeline:scroll(root)}
  }
}
`;
}

/**
 * The arena (arena/Arena.jsx, arena/scene.js): a sticky stage behind the
 * whole of <main>, shown only when the 3D scene was chosen (`arena-3d` on
 * <html>, set by Arena.jsx) and faded in on its first frame (`arena-on`).
 * Until then, and if it never comes, the stage is the film's night, and the
 * 2D film's own stage stands aside. Over it every section sits on a panel,
 * so no word is ever read off the moving picture. The HUD over the film is
 * aria-hidden, at or above the 12px floor, and on only while the film plays.
 */
export function arenaCss() {
  const lime = "#b9f227";
  return `
.arena-stage{display:none}
.arena-3d main{position:relative}
.arena-3d .arena-stage{display:block;position:sticky;top:0;height:100vh;height:100svh;margin-bottom:-100vh;margin-bottom:-100svh;z-index:0;overflow:hidden;pointer-events:none;
  background:linear-gradient(180deg,#03060d 0%,#0a1a30 45%,#2a3b58 62%,#174a2c 63%,#0b2f1d 100%)}
.arena-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .9s ease}
.arena-on .arena-canvas{opacity:1}
.arena-3d .arena-stage::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse 90% 80% at 50% 55%,rgba(0,0,0,0) 55%,rgba(0,0,0,.5) 100%),repeating-linear-gradient(0deg,rgba(255,255,255,.018) 0 1px,transparent 1px 3px)}
.arena-3d main > :not(.arena-stage){position:relative;z-index:1}
.arena-3d .film{background:transparent}
.arena-3d .film-stage{visibility:hidden}
.arena-3d .panel{position:relative;isolation:isolate}
.arena-3d .panel:not(.cta-ring)::before{content:"";position:absolute;inset:8px 6px;z-index:-1;border-radius:24px;pointer-events:none;
  background:${clr(T.surface.canvas, 0.88)};border:1px solid ${T.line.subtle};box-shadow:0 30px 80px rgba(0,0,0,.35)}

.hud{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .35s ease;color:#f4f6f3;font-family:${T.type.mono}}
.hud.on{opacity:1}
.hud-c{position:absolute;width:24px;height:24px;border:2px solid ${clr(T.brand.lime, 0.7)}}
.hud-c.tl{top:84px;left:12px;border-right:0;border-bottom:0}
.hud-c.tr{top:84px;right:12px;border-left:0;border-bottom:0}
.hud-c.bl{bottom:12px;left:12px;border-right:0;border-top:0}
.hud-c.br{bottom:12px;right:12px;border-left:0;border-top:0}
.hud-bug{position:absolute;top:96px;right:24px;display:flex;align-items:center;gap:10px;padding:8px 14px 8px 8px;background:rgba(4,7,12,.82);
  border:1px solid rgba(255,255,255,.14);clip-path:polygon(0 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%);font-variant-numeric:tabular-nums}
.hud-tag{font-size:12px;letter-spacing:.12em;text-transform:uppercase;background:${lime};color:#05070a;padding:3px 7px;border-radius:3px}
.hud-team{font-family:${T.type.head};font-weight:700;font-size:14px}
.hud-score{font-size:22px;font-weight:500;color:${lime};min-width:3.2em;text-align:right}
.hud-ov{font-size:12px;color:#c9d1db}
.hud-shot{position:absolute;right:24px;bottom:30px;display:flex;align-items:baseline;gap:2px;font-variant-numeric:tabular-nums}
.hud-shot b{font-size:30px;font-weight:500;color:#f4f6f3;text-shadow:0 0 18px ${clr(T.brand.lime, 0.5)}}
.hud-shot span{font-size:14px;color:#a3adbb}
.hud-bar{position:absolute;left:24px;right:96px;bottom:42px;height:3px;background:rgba(255,255,255,.14);overflow:hidden}
.hud-bar i{position:absolute;inset:0;background:linear-gradient(90deg,${lime},${T.brand.cyan});transform-origin:0 50%;transform:scaleX(0);box-shadow:0 0 10px ${lime}}
@media (max-width:599px){.hud-bug{top:auto;bottom:62px;right:auto;left:24px}}
@media (prefers-reduced-motion:reduce){.arena-stage{display:none!important}}
`;
}
