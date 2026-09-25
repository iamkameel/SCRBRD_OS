import { useEffect, useId, useRef } from "react";
import { D, T, clr, inkOn, textOn } from "../design/tokens.js";

/* ═══════════════════════════════════════════════════════
   DESIGN SYSTEM
═══════════════════════════════════════════════════════ */
const GS = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{font-size:14px;-webkit-font-smoothing:antialiased}
    body{background:${T.surface.canvas};overflow-x:hidden}
    ::-webkit-scrollbar{width:2px;height:2px}
    ::-webkit-scrollbar-thumb{background:${T.line.normal};border-radius:99px}
    input,button,textarea,select{font-family:'DM Sans',sans-serif}
    @keyframes dotPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.75);opacity:.45}}
    @keyframes pulseGlow{0%,100%{box-shadow:0 0 6px ${clr(D.emerald,.6)}}50%{box-shadow:0 0 18px ${clr(D.emerald,.3)}}}
    @keyframes slideUp{from{transform:translateY(24px);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes scoreReveal{from{transform:translateY(-8px) scale(.95);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}
    @keyframes gradShift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    @keyframes badgePop{0%{transform:scale(.8);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
    @keyframes wagonDraw{from{stroke-dashoffset:320}to{stroke-dashoffset:0}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes overlayIn{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}60%{transform:translate(-50%,-50%) scale(1.08)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
    @keyframes overlayOut{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}
    @keyframes freeHitPulse{0%,100%{box-shadow:0 0 0 0 ${clr(D.orange,.5)}}50%{box-shadow:0 0 0 18px ${clr(D.orange,0)}}}
    @keyframes bounceIn{0%{transform:translateY(20px);opacity:0}60%{transform:translateY(-8px)}100%{transform:translateY(0);opacity:1}}
    @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes milestoneIn{0%{opacity:0;transform:translate(-50%,-60%) scale(.5) rotate(-6deg)}60%{transform:translate(-50%,-50%) scale(1.05) rotate(1deg)}100%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(0deg)}}
    @keyframes milestoneOut{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.2) translateY(-20px)}}
    @keyframes confetti{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(60px) rotate(720deg);opacity:0}}
    @keyframes goldShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}
    @keyframes undoPop{0%{transform:scale(.85);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
    .slideUp{animation:slideUp .32s cubic-bezier(.22,1,.36,1) both}
    .scoreAnim{animation:scoreReveal .28s cubic-bezier(.22,1,.36,1) both}
    .liveDot{animation:dotPulse 1.8s ease-in-out infinite}
    .liveGlow{animation:pulseGlow 2s ease-in-out infinite}
    .gradAnim{background-size:200% 200%;animation:gradShift 4s ease infinite}
    .badgePop{animation:badgePop .3s cubic-bezier(.34,1.56,.64,1) both}
    .wagonLine{stroke-dasharray:320;animation:wagonDraw .38s ease both}
    .fadeIn{animation:fadeIn .22s ease both}
    .pressBtn{transition:transform .1s ease,opacity .1s ease}
    .pro-score-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
    .sc-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
    @media(max-width:900px){.sc-grid-2{grid-template-columns:1fr}}
    @media(max-width:900px){.pro-score-grid{grid-template-columns:1fr}}
    .pressBtn:active:not(:disabled){transform:scale(.95);opacity:.85}
    .pressBtn:disabled{cursor:not-allowed!important;opacity:.38!important}
    .shotBtn{transition:all .15s ease;border:1px solid transparent}
    .shotBtn:hover{border-color:${T.line.strong}!important}
    .shotBtn.active{border-color:${clr(D.indigo,.7)}!important}
  `}</style>
);

/* Design tokens: inherits the single canonical `D` from module scope
   (unified — no separate scorer palette). */

/* ── Primitives ── */
const Glass = ({ children, style, glow, onClick }) => (
  <div onClick={onClick} style={{
    background:D.glass, backdropFilter:"blur(20px) saturate(1.6)",
    WebkitBackdropFilter:"blur(20px) saturate(1.6)",
    border:`1px solid ${D.border}`, borderRadius:D.xl,
    boxShadow: glow
      ? `${T.elevation.lg},${T.elevation.sheen},0 0 60px ${glow}10`
      : `${T.elevation.lg},${T.elevation.sheen}`,
    position:"relative", overflow:"hidden", ...style,
  }}>{children}</div>
);

const Card = ({ children, style, accent }) => (
  <div style={{
    background:D.surf1, border:`1px solid ${accent?`${accent}28`:D.border}`,
    borderRadius:D.lg,
    boxShadow: accent
      ? `${T.elevation.md},${T.elevation.sheen},0 0 32px ${accent}0c`
      : `${T.elevation.md},${T.elevation.sheen}`,
    position:"relative", overflow:"hidden", ...style,
  }}>{children}</div>
);

const Lbl = ({ children, sx }) => (
  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.15em",
    textTransform:"uppercase",color:D.textMuted,...sx}}>{children}</div>
);

const Sep = ({ sx }) => <div style={{height:"1px",background:D.border,...sx}} />;

// `rest` carries data-* and aria-* attributes through, the way Card and
// Sheet already do — without it, a data-testid passed to a Badge is
// silently dropped, which is what left review-reason (InningsReviewSheet)
// unfindable until SCRBRD-052's browser walk was the first thing to look.
const Badge = ({ children, color, sx, ...rest }) => (
  <span {...rest} style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.12em",
    textTransform:"uppercase",padding:"3px 8px",borderRadius:D.pill,
    background:`${color||D.indigo}1e`,color:textOn(color||D.indigo),
    border:`1px solid ${color||D.indigo}30`,flexShrink:0,...sx}}>{children}</span>
);

const BallDot = ({ ball, size=28 }) => {
  const m = b => {
    if(b.type==="W")  return {bg:D.rose,   fg:inkOn(D.rose),   tx:"W"};
    if(b.type==="Wd") return {bg:D.orange,  fg:inkOn(D.orange), tx:"Wd"};
    if(b.type==="Nb") return {bg:D.amber,   fg:inkOn(D.amber),  tx:"NB"};
    if(b.type==="Pen")return {bg:D.violet,  fg:inkOn(D.violet), tx:`+${b.value}`};
    if(b.value===6)   return {bg:D.amber,   fg:inkOn(D.amber),  tx:"6"};
    if(b.value===4)   return {bg:D.indigo,  fg:inkOn(D.indigo), tx:"4"};
    if(b.value===0)   return {bg:D.surf3,   fg:D.textMuted,tx:"·"};
    return {bg:`${D.emerald}33`,fg:D.emerald,tx:String(b.value)};
  };
  const{bg,fg,tx}=m(ball);
  const lbl=ball.type==="B"?`${ball.value}b`:ball.type==="LB"?`${ball.value}lb`:tx;
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:bg,
      display:"flex",alignItems:"center",justifyContent:"center",
      color:fg,fontSize:size*.38,fontFamily:D.mono,fontWeight:500,flexShrink:0,
      boxShadow:(ball.value===6||ball.value===4)?`0 0 10px ${bg}66`:"none"}}>
      {lbl}
    </div>
  );
};

// `...rest` reaches the element, so a data-testid or an aria attribute on a
// scorer button is not silently dropped — a walk that clicks a testid that
// never rendered fails on a timeout, which says nothing about why.
const Btn = ({ children, onClick, disabled, variant="primary", size="md", full, sx, ...rest }) => {
  const pad = size==="xs"?"5px 10px":size==="sm"?"8px 14px":size==="lg"?"15px 28px":"11px 20px";
  const fs  = size==="xs"?"10px":size==="sm"?"12px":size==="lg"?"15px":"13px";
  const V = {
    primary:{background:disabled?D.surf2:D.grad,color:disabled?D.textMuted:T.light.ink,border:"none",boxShadow:disabled?"none":`0 4px 24px ${clr(D.indigo,.4)}`},
    danger: {background:disabled?D.surf2:T.light.critical,color:disabled?D.textMuted:T.light.ink,border:"none",boxShadow:disabled?"none":`0 4px 20px ${D.rose}40`},
    ghost:  {background:"transparent",color:D.textSecondary,border:`1px solid ${D.border}`},
    tonal:  {background:D.surf2,color:D.textPrimary,border:`1px solid ${D.borderMed}`},
    live:   {background:disabled?D.surf2:D.gradLive,color:disabled?D.textMuted:T.light.ink,border:"none",boxShadow:disabled?"none":`0 4px 20px ${D.emerald}40`},
    amber:  {background:disabled?D.surf2:`${D.amber}1a`,color:disabled?D.textMuted:D.amber,border:`1px solid ${disabled?D.border:D.amber+"44"}`},
    s4:     {background:disabled?D.surf2:`${D.indigo}1a`,color:disabled?D.textMuted:D.sky,border:`1px solid ${disabled?D.border:D.indigo+"44"}`},
    s6:     {background:disabled?D.surf2:`${D.amber}1a`,color:disabled?D.textMuted:D.amber,border:`1px solid ${disabled?D.border:D.amber+"44"}`},
    wkt:    {background:disabled?D.surf2:`${D.rose}14`,color:disabled?D.textMuted:D.rose,border:`1px solid ${disabled?D.border:D.rose+"44"}`,boxShadow:disabled?"none":`0 4px 24px ${D.rose}28`},
  };
  const v=V[variant]||V.primary;
  return (
    <button className="pressBtn" disabled={!!disabled} onClick={!disabled?onClick:undefined} {...rest} style={{
      ...v, padding:pad, borderRadius:D.pill, cursor:disabled?"not-allowed":"pointer",
      fontFamily:D.body, fontSize:fs, fontWeight:600, letterSpacing:"0.01em",
      width:full?"100%":undefined, whiteSpace:"nowrap",
      opacity:disabled?0.42:1, transition:"all .15s", ...sx,
    }}>{children}</button>
  );
};

const SignalBar = ({ label, value, pct, color, center }) => (
  <div>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
      <Lbl>{label}</Lbl>
      <span style={{fontFamily:D.mono,fontSize:"11px",color:textOn(color||D.textPrimary)}}>{value}</span>
    </div>
    <div style={{height:"3px",borderRadius:"2px",background:D.surf3,overflow:"hidden",position:"relative"}}>
      {center
        ? <><div style={{position:"absolute",left:"50%",width:"1px",height:"100%",background:D.border,zIndex:1}}/>
            <div style={{position:"absolute",left:pct>=50?"50%":`${pct}%`,width:`${Math.abs(pct-50)}%`,height:"100%",background:color||D.indigo,transition:"width .8s ease"}}/></>
        : <div style={{height:"100%",width:`${Math.min(100,Math.max(0,pct))}%`,background:color||D.indigo,borderRadius:"2px",transition:"width .8s ease"}}/>
      }
    </div>
  </div>
);

/* ── Bottom Sheet ──────────────────────────────────────────────
   Every blocking decision in the scorer comes through here: who is opening
   the batting, who is bowling the next over, how a batter was dismissed. It
   was a pair of divs — no dialog role, no name, no Escape, and nothing
   stopping Tab from wandering out of it into the page underneath while the
   scrim covered everything.

   That last one is the sharp edge. A sheet is modal in appearance only, so a
   keyboard user could tab to a button they cannot see, press it, and change
   the match without any idea what they had done.

   What this adds:
     - role="dialog" + aria-modal, and aria-labelledby pointing at the title,
       so it is announced as a dialog with a name rather than as loose text.
     - Escape closes it, which is what every user of every dialog expects.
     - Focus moves in on open and is returned to whatever had it on close;
       otherwise dismissing a sheet drops focus to the top of the document
       and the scorer starts tabbing from the beginning of the page.
     - Tab is trapped, so the only things reachable are inside the sheet.
*/
const Sheet = ({ children, title, accent, onClose }) => {
  const panel = useRef(null);
  const titleId = useId();
  const returnTo = useRef(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    // Focus the panel rather than the first control: announcing the dialog
    // and its name comes first, and a scorer who lands straight on a player
    // button has not been told what they are answering.
    panel.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab") return;
      const focusables = panel.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusables?.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      // Wrap at both ends. Without this, Tab from the last control lands on
      // the page behind the scrim — invisible, and still clickable.
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Only restore focus if it is still somewhere in this sheet; if the
      // caller has already moved it deliberately, leave it alone.
      if (panel.current?.contains(document.activeElement) || document.activeElement === document.body) {
        returnTo.current?.focus?.();
      }
    };
  }, [onClose]);

  return (
  <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
    {/* The scrim is decorative and is not a control: a keyboard user closes
        with Escape, and giving this a tab stop would just add a mystery one. */}
    <div onClick={onClose} aria-hidden="true" style={{position:"absolute",inset:0,background:T.glass.scrim,backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)"}}/>
    <div ref={panel} className="slideUp" role="dialog" aria-modal="true" tabIndex={-1}
      {...(title ? { "aria-labelledby": titleId } : {})}
      style={{position:"relative",background:D.glass,backdropFilter:"blur(28px) saturate(1.8)",
      WebkitBackdropFilter:"blur(28px) saturate(1.8)",border:`1px solid ${D.borderMed}`,
      borderBottom:"none",borderRadius:`${D.xxl} ${D.xxl} 0 0`,
      boxShadow:`${T.elevation.xl},${T.elevation.sheen}`,
      maxHeight:"92vh",display:"flex",flexDirection:"column"}}>
      <div aria-hidden="true" style={{display:"flex",justifyContent:"center",paddingTop:"12px",paddingBottom:"4px",flexShrink:0}}>
        <div style={{width:"36px",height:"4px",borderRadius:"2px",background:D.borderMed}}/>
      </div>
      {title&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 24px 4px",flexShrink:0}}>
          <h2 id={titleId} style={{fontFamily:D.head,fontSize:"18px",fontWeight:700,color:accent||D.textPrimary,margin:0}}>{title}</h2>
          <button onClick={onClose} aria-label={`Close ${title}`} style={{background:"transparent",border:"none",color:D.textMuted,fontSize:"22px",cursor:"pointer",lineHeight:1,padding:"4px 6px"}}>&times;</button>
        </div>
      )}
      <div style={{overflow:"auto",padding:"0 24px 32px"}}>{children}</div>
    </div>
  </div>
  );
};

/**
 * What this innings will capture on every ball — DECLARED, at setup, rather
 * than inferred afterwards from whichever path each ball took. SCRBRD-039.
 *
 * The choice travels on the innings_start event (packages/scoring events.mjs)
 * and is what a thin heat map is read against: a standard innings with no
 * exact points says "never asked for", not "missing". It does not change the
 * pad — every ball still records its own profile as before.
 *
 * `value` may be null: an innings nobody declared, which reads exactly as
 * every innings did before this existed. Nothing is chosen for the scorer.
 */
const CAPTURE_CHOICES = [
  { id: "full",     label: "Full",     hint: "exact point" },
  { id: "standard", label: "Standard", hint: "sector only" },
  { id: "quick",    label: "Quick",    hint: "runs only" },
];
const CaptureProfilePicker = ({ value, onChange, label = "What will you capture?" }) => (
  <div data-testid="capture-profile-picker">
    <Lbl sx={{ marginBottom: "8px" }}>{label}</Lbl>
    <div role="radiogroup" aria-label={label} style={{ display: "flex", gap: "6px" }}>
      {CAPTURE_CHOICES.map(c => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id}
          data-testid={`capture-profile-${c.id}`} onClick={() => onChange(c.id)} className="pressBtn" style={{
            flex: 1, padding: "9px 0", borderRadius: D.md, cursor: "pointer",
            border: `1px solid ${value === c.id ? D.indigo + "77" : D.border}`,
            background: value === c.id ? `${D.indigo}1a` : D.surf2,
            color: value === c.id ? D.sky : D.textMuted, transition: "all .2s",
          }}>
          <div style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600 }}>{c.label}</div>
          <div style={{ fontFamily: D.body, fontSize: "10px", marginTop: "2px" }}>{c.hint}</div>
        </button>
      ))}
    </div>
    {value == null && (
      <div style={{ fontFamily: D.body, fontSize: "10px", color: D.textMuted, marginTop: "6px" }}>
        Not declared — read as it always has been.
      </div>
    )}
  </div>
);

export { Badge, BallDot, Btn, Card, CaptureProfilePicker, GS, Glass, Lbl, Sep, Sheet, SignalBar };
