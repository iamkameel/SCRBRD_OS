const D = {
  // ── Base surfaces (unified · SCRBRD canonical) ──
  bg:"#060910", base:"#060910",                 // base + bg aliased
  surf0:"#0a0f1a", surf1:"#0f1621", surf2:"#151d2e", surf3:"#1c2640",
  glass:"rgba(10,14,28,0.75)",
  border:"rgba(255,255,255,0.07)", borderMed:"rgba(255,255,255,0.12)",
  // ── Text ──
  textPrimary:"#f0f4ff", textSecondary:"#8b9bc4", textMuted:"#4a5570",
  // ── Accent palette ──
  indigo:"#6366f1", sky:"#0ea5e9", emerald:"#10b981", amber:"#f59e0b",
  rose:"#f43f5e", orange:"#f97316", violet:"#8b5cf6", cyan:"#06b6d4",
  teal:"#14b8a6", lime:"#84cc16", pink:"#ec4899",
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

export { D, GLOBAL_CSS, clr, px };
