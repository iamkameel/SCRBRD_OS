import { useEffect, useId, useRef } from "react";
import { D, px, textOn } from "../design/tokens.js";
import { initials } from "../lib/format.js";

// ══════════════════════════════════════════════════════
//  PRIMITIVE COMPONENTS
// ══════════════════════════════════════════════════════

// `rest` carries data-* and aria-* attributes through to the element, so a
// card can be found by a stable id or named for a screen reader.
const Card = ({ children, sx, className="card-hover", onClick, ...rest }) => (
  <div onClick={onClick} className={className} {...rest} style={{
    background:D.surf1, border:`1px solid ${D.border}`,
    borderRadius:D.lg, overflow:"hidden", ...sx
  }}>{children}</div>
);

const KPICard = ({ label, value, sub, icon, color=D.indigo, trend }) => (
  <Card sx={{padding:"16px 18px",cursor:"default"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div>
        <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"8px"}}>{label}</div>
        <div style={{fontFamily:D.mono,fontSize:"26px",fontWeight:500,color,lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"5px"}}>{sub}</div>}
      </div>
      <div style={{width:"38px",height:"38px",borderRadius:D.md,background:color+"18",border:`1px solid ${color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",flexShrink:0}}>{icon}</div>
    </div>
    {trend!==undefined&&(
      <div style={{marginTop:"10px",display:"flex",alignItems:"center",gap:"5px"}}>
        <span style={{color:trend>=0?D.emerald:D.rose,fontFamily:D.mono,fontSize:"11px"}}>{trend>=0?"▲":"▼"} {Math.abs(trend)}%</span>
        <span style={{color:D.textMuted,fontSize:"11px",fontFamily:D.body}}>vs last month</span>
      </div>
    )}
  </Card>
);

const SectionHeader = ({ title, sub, actions, color=D.indigo }) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",flexWrap:"wrap",gap:"8px"}}>
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
        <div style={{width:"3px",height:"20px",borderRadius:"2px",background:color}}/>
        <h2 style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{title}</h2>
      </div>
      {sub&&<div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"3px",paddingLeft:"13px"}}>{sub}</div>}
    </div>
    {actions&&<div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>{actions}</div>}
  </div>
);

// ...rest so a caller can put a data-testid (or an aria-label, or a type) on
// the button it is actually rendering. Without it those props were accepted
// and silently dropped, which is how a test that targets a control by id ends
// up asserting against a control that does not exist.
const Btn = ({ children, onClick, variant="primary", size="md", disabled, ...rest }) => {
  const bg = variant==="primary"?D.gradMain:variant==="success"?D.gradLive:variant==="danger"?D.rose:variant==="ghost"?"transparent":D.surf3;
  const col = variant==="ghost"?D.textSecondary:"#fff";
  const pad = size==="sm"?"5px 12px":size==="lg"?"12px 24px":"8px 18px";
  const fs  = size==="sm"?"11px":size==="lg"?"14px":"12px";
  return (
    <button onClick={onClick} disabled={disabled} className="pressBtn" {...rest} style={{
      padding:pad,borderRadius:D.pill,border:`1px solid ${variant==="ghost"?D.border:"transparent"}`,
      background:bg,color:col,cursor:disabled?"not-allowed":"pointer",fontFamily:D.head,
      fontSize:fs,fontWeight:700,letterSpacing:"0.04em",opacity:disabled?0.4:1,
      boxShadow:variant==="primary"?`0 2px 12px ${D.indigo}33`:"none",
    }}>{children}</button>
  );
};

// `rest` carries data-* and aria-* attributes through, the same as Card
// above — without it, a data-testid passed to a Badge is silently dropped,
// which is what let review-reason (InningsReviewSheet) go unfindable until
// SCRBRD-052's browser walk was the first thing to actually look for it.
const Badge = ({ children, color=D.indigo, ...rest }) => (
  <span {...rest} style={{
    padding:"2px 8px",borderRadius:D.pill,fontFamily:D.mono,fontSize:"9px",fontWeight:500,
    background:color+"18",border:`1px solid ${color}30`,color,letterSpacing:"0.05em",textTransform:"uppercase",
  }}>{children}</span>
);

const Avatar = ({ name, size=32, color=D.indigo }) => (
  <div style={{width:px(size),height:px(size),borderRadius:"50%",background:`linear-gradient(135deg,${color}33,${color}55)`,
    border:`1px solid ${color}44`,display:"flex",alignItems:"center",justifyContent:"center",
    fontFamily:D.mono,fontSize:px(Math.round(size*0.35)),fontWeight:700,color,flexShrink:0}}>
    {initials(name)}
  </div>
);

const StatusDot = ({ status }) => {
  const c = status==="live"?D.emerald:status==="upcoming"?D.sky:status==="complete"?D.textMuted:D.amber;
  return <div className={status==="live"?"live-dot":""} style={{width:"7px",height:"7px",borderRadius:"50%",background:c,flexShrink:0,
    ...(status!=="live"?{}:{})}}/>;
};

const ProgressBar = ({ pct, color=D.indigo, height=4 }) => (
  <div style={{width:"100%",height:px(height),background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
    <div className="skill-bar" style={{height:"100%",width:`${pct}%`,background:color,borderRadius:"4px"}}/>
  </div>
);

const SkillBar = ({ label, value, color=D.indigo }) => (
  <div style={{marginBottom:"8px"}}>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{label}</span>
      <span style={{fontFamily:D.mono,fontSize:"11px",color}}>{value}</span>
    </div>
    <ProgressBar pct={value} color={color}/>
  </div>
);

const Pill = ({ children, color=D.indigo, onClick }) => (
  <span onClick={onClick} style={{
    display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:D.pill,
    fontFamily:D.body,fontSize:"11px",fontWeight:500,cursor:onClick?"pointer":"default",
    background:color+"15",border:`1px solid ${color}28`,color,
  }}>{children}</span>
);

/**
 * A dialog that can actually be left.
 *
 * This drew a full-viewport backdrop at zIndex 1000 and listened for nothing.
 * Escape did nothing, clicking the backdrop did nothing, and the only way out
 * was to find and hit the small ✕. While it was open the backdrop swallowed
 * every click in the app, so a person who opened one by accident — or a
 * keyboard user, who could not reach the ✕ at all without tabbing the whole
 * dialog — was stuck on that screen.
 *
 * The browser walk found it the moment a live role could first reach one: the
 * sweep opens a record, presses Escape, and moves on. Escape left the dialog
 * standing, and every later click landed on the backdrop instead of the menu.
 * A test that presses Escape is not being fussy; it is doing what a person
 * does.
 *
 * So: Escape closes, the backdrop closes (but not a click inside the card,
 * which is the same element's child), and it announces itself as a dialog
 * named by its own heading. Focus moves in on open and returns to whatever
 * opened it on close, because a dialog that drops focus at the top of the
 * document leaves a screen-reader user with no idea where they are.
 *
 * Still missing: a tab cycle trapped inside the card. Tab can still walk out
 * into the page behind. That is a real gap, not a solved one.
 */
const Modal = ({ title, children, onClose, width="520px" }) => {
  const headingId = useId();
  const card = useRef(null);
  // Held in a ref, not read at close time: by then the opener may be gone
  // (it is often a row that the dialog's own save has just re-rendered).
  const opener = useRef(null);

  useEffect(() => {
    opener.current = document.activeElement;
    // Focus the card, not the first field: dropping a screen reader straight
    // into an input skips the heading that says what this dialog is.
    card.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = opener.current;
      if (back && typeof back.focus === "function" && document.contains(back)) back.focus();
    };
  }, [onClose]);

  return (
  <div className="os-modal" data-testid="modal-backdrop"
    onMouseDown={(e)=>{ if (e.target === e.currentTarget) onClose?.(); }}
    style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:"20px"}}>
    <div className="os-modal-card" ref={card} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}
      style={{background:D.surf1,borderRadius:D.xl,border:`1px solid ${D.borderMed}`,width:"100%",maxWidth:width,maxHeight:"90vh",overflow:"auto",outline:"none"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${D.border}`}}>
        <h3 id={headingId} style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary}}>{title}</h3>
        <button onClick={onClose} className="pressBtn" aria-label="Close dialog" style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"18px"}}>✕</button>
      </div>
      <div style={{padding:"20px"}}>{children}</div>
    </div>
  </div>
  );
};

/**
 * A labelled text field.
 *
 * The label was a styled <div> — visible, and invisible to everything else.
 * A screen reader announced "edit, blank"; clicking the word did not focus
 * the field; and voice control had no name to say. A placeholder is not a
 * substitute: it vanishes the moment someone types, which is exactly when a
 * person who has lost their place needs it most.
 *
 * A real <label htmlFor> costs nothing visually and fixes all three.
 */
// `...rest` reaches the element — a data-testid or aria-* on a form field is
// not silently dropped. Found the way the scorer's own Btn was: a walk's
// .fill() timed out at Playwright's default 30s because the testid never
// reached the DOM, which looks exactly like a slow page and nothing like a
// missing prop.
const Input = ({ label, value, onChange, type="text", placeholder, small, ...rest }) => {
  const id = useId();
  return (
  <div style={{marginBottom:small?"0":"14px"}}>
    {label&&<label htmlFor={id} style={{display:"block",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>{label}</label>}
    <input id={id} type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      {...(label ? {} : { "aria-label": placeholder })}
      {...rest}
      style={{width:"100%",padding:"9px 12px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
        color:D.textPrimary,fontFamily:D.body,fontSize:"13px"}}/>
  </div>
  );
};

// An option is either a bare primitive ("1XI") or {value, label}. `o.value||o`
// looked like a reasonable fallback for the second shape but is wrong for any
// FALSY value — an empty string standing for "none selected", or a real 0 —
// because `"" || o` and `0 || o` both fall through to the whole object. React
// then stringifies it onto the DOM attribute, so the option silently became
// value="[object Object]" and choosing it committed that string rather than
// the empty/zero value the caller asked for. Caught because a squad-number
// clear in the Add Player modal hung a browser walk for a full 30 seconds
// selecting an option that, from Playwright's side, did not exist — the
// select had one whose value was NOT "", search as it might.
//
// The fix is a shape check, not a truthier fallback: an option is the
// {value, label} form only when it actually is one.
const optionOf = (o) => (o != null && typeof o === "object" ? o : { value: o, label: o });
const Select = ({ label, value, onChange, options, ...rest }) => {
  const id = useId();
  return (
  <div style={{marginBottom:"14px"}}>
    {label&&<label htmlFor={id} style={{display:"block",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>{label}</label>}
    <select id={id} value={value} onChange={e=>onChange(e.target.value)} {...rest}
      style={{width:"100%",padding:"9px 12px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
        color:D.textPrimary,fontFamily:D.body,fontSize:"13px"}}>
      {options.map(o=>{ const { value: v, label: l } = optionOf(o); return <option key={v} value={v}>{l}</option>; })}
    </select>
  </div>
  );
};

// ── RADAR / SPIDER CHART ───────────────────────────────
function RadarChart({ data, color=D.indigo, size=160 }) {
  const keys = Object.keys(data);
  const n = keys.length;
  const cx = size/2, cy = size/2, r = size*0.38;
  const angle = i => (i/n)*2*Math.PI - Math.PI/2;
  const pt = (i,v) => [cx + r*(v/100)*Math.cos(angle(i)), cy + r*(v/100)*Math.sin(angle(i))];
  const grid = [20,40,60,80,100];
  const pts = keys.map((k,i)=>pt(i,data[k]));
  const polyPts = pts.map(p=>p.join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{width:px(size),height:px(size)}}>
      {/* Grid */}
      {grid.map(g=>(
        <polygon key={g} points={keys.map((_,i)=>{const[x,y]=pt(i,g);return`${x},${y}`}).join(" ")}
          fill="none" stroke={D.surf3} strokeWidth="0.8"/>
      ))}
      {/* Spokes */}
      {keys.map((_,i)=>{
        const[x,y]=pt(i,100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={D.surf3} strokeWidth="0.8"/>;
      })}
      {/* Data polygon */}
      <polygon points={polyPts} fill={color+"28"} stroke={color} strokeWidth="1.5"/>
      {/* Dots */}
      {pts.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="3" fill={color} stroke={D.surf1} strokeWidth="1.5"/>)}
      {/* Labels */}
      {keys.map((k,i)=>{
        const[x,y]=pt(i,118);
        return <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
          fontSize="7.5" fontFamily={D.body} fill={D.textMuted} fontWeight="500">{k}</text>;
      })}
    </svg>
  );
}

/**
 * Nothing to show — and WHICH nothing.
 *
 * Three states that look identical in a list and mean completely different
 * things, so the component insists on being told which one it is:
 *
 *   loading — the server has not answered yet. Say nothing about the data.
 *   error   — the request failed. This is NOT "no fixtures"; it is "we do not
 *             know", and the difference matters to someone deciding whether to
 *             get in a car.
 *   empty   — the server answered, and the answer is none. The only one of the
 *             three where a definitive statement is honest.
 *
 * The read path never falls back to mock rows in a live session, so an empty
 * list is a real answer rather than a hidden failure — which is precisely why
 * it has to be possible to tell an empty answer from an absent one.
 */
const EmptyState = ({ loading, error, message = "Nothing here yet", icon = "—" }) => (
  <div style={{ padding: "32px 16px", textAlign: "center",
                fontFamily: D.body, fontSize: "12px",
                color: error ? textOn(D.rose) : D.textMuted }}>
    <div style={{ fontSize: "20px", marginBottom: "8px", opacity: 0.6 }} aria-hidden="true">
      {loading ? "…" : error ? "!" : icon}
    </div>
    {loading ? "Loading…"
     : error ? "Could not load this — the server did not answer. This is not the same as there being nothing."
     : message}
  </div>
);

export { Avatar, Badge, Btn, Card, EmptyState, Input, KPICard, Modal, Pill, ProgressBar, RadarChart, SectionHeader, Select, SkillBar, StatusDot };
