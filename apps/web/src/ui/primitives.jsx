import { useEffect, useId, useRef } from "react";
import { D, T, inkOn, px, textOn } from "../design/tokens.js";
import { initials } from "../lib/format.js";
import { radarGeometry, radarSummary } from "../lib/radar.js";
import { readState } from "../lib/readState.js";
import { Icon, isIcon } from "./icons.jsx";

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

// `icon` on a card or an empty state is a name from ui/icons.jsx.
const KPICard = ({ label, value, sub, icon, color=D.indigo, trend }) => (
  <Card sx={{padding:"16px 18px",cursor:"default"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div>
        <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"8px"}}>{label}</div>
        <div style={{fontFamily:D.mono,fontSize:"26px",fontWeight:500,color:textOn(color),lineHeight:1}}>{value}</div>
        {sub&&<div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginTop:"5px"}}>{sub}</div>}
      </div>
      <div style={{width:"38px",height:"38px",borderRadius:D.md,background:color+"18",border:`1px solid ${color}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",flexShrink:0,color:textOn(color)}}>{isIcon(icon) ? <Icon name={icon}/> : icon}</div>
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
  const col = variant==="ghost"?D.textSecondary
    : variant==="primary"||variant==="success"?T.light.ink
    : variant==="danger"?inkOn(D.rose)
    : D.textPrimary;
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
//
// §3.2's floor: nothing read below 12px. This was 9px — noise, not a tag —
// with padding sized for it; both move together onto the floor, matching the
// pill scorer/ui.jsx's own Badge already draws at 12px.
const Badge = ({ children, color=D.indigo, ...rest }) => (
  <span {...rest} style={{
    padding:"3px 8px",borderRadius:D.pill,fontFamily:D.mono,fontSize:"12px",fontWeight:500,
    background:color+"18",border:`1px solid ${color}30`,color:textOn(color),letterSpacing:"0.05em",textTransform:"uppercase",
  }}>{children}</span>
);

// §3.2's floor again: initials below ~34px would clip 12px — the circle
// grows to fit the floor rather than the type shrinking under it, so a
// caller's own `size` (down to 18, on the smallest inline chips) still reads.
// Above 34 nothing changes: the proportion is the one this always drew.
const Avatar = ({ name, size=32, color=D.indigo }) => {
  const d = Math.max(size, 34);
  return (
    <div style={{width:px(d),height:px(d),borderRadius:"50%",background:`linear-gradient(135deg,${color}33,${color}55)`,
      border:`1px solid ${color}44`,display:"flex",alignItems:"center",justifyContent:"center",
      fontFamily:D.mono,fontSize:px(Math.round(d*0.35)),fontWeight:700,color:textOn(color),flexShrink:0}}>
      {initials(name)}
    </div>
  );
};

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
      <span style={{fontFamily:D.mono,fontSize:"11px",color:textOn(color)}}>{value}</span>
    </div>
    <ProgressBar pct={value} color={color}/>
  </div>
);

const Pill = ({ children, color=D.indigo, onClick }) => (
  <span onClick={onClick} style={{
    display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:D.pill,
    fontFamily:D.body,fontSize:"11px",fontWeight:500,cursor:onClick?"pointer":"default",
    background:color+"15",border:`1px solid ${color}28`,color:textOn(color),
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
    style={{position:"fixed",inset:0,background:T.glass.scrim,display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:"20px"}}>
    <div className="os-modal-card" ref={card} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}
      style={{background:D.surf1,borderRadius:D.xl,border:`1px solid ${D.borderMed}`,width:"100%",maxWidth:width,maxHeight:"90vh",overflow:"auto",outline:"none"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${D.border}`}}>
        <h3 id={headingId} style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary}}>{title}</h3>
        <button onClick={onClose} className="pressBtn" aria-label="Close dialog" style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"18px",minWidth:"44px",minHeight:"44px",margin:"-8px -10px -8px 0"}}>✕</button>
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
/**
 * `max` is the value that reaches the OUTER ring, and it has no default: a
 * rubric rating is 1-20, a caller that has already scaled its figures says 100,
 * and one that says nothing is drawn nothing (lib/radar.js). A hidden 0-100
 * once drew a 20 out of 20 a fifth of the way out.
 *
 * `size` is the width of the plot; axis labels (12px, never smaller) are drawn
 * around it when there are few enough axes to keep them apart, so the whole
 * chart is a little wider than `size`. `caption` is the words for a screen
 * reader; without it they are made from the data.
 */
function RadarChart({ data, max, color=D.indigo, size=160, caption }) {
  const g = radarGeometry({ data, max, size });
  if (!g) return null;
  const words = caption ?? radarSummary(data, max);
  return (
    <svg viewBox={`0 0 ${g.width} ${g.height}`} role="img" aria-label={`Skills radar. ${words}`}
      data-testid="radar" data-max={max}
      style={{width:px(g.width),height:px(g.height),maxWidth:"100%",display:"block"}}>
      {/* Grid: the last ring is the outer one, the value of `max`. */}
      {g.rings.map((points,i)=>(
        <polygon key={i} points={points} fill="none" stroke={D.surf3} strokeWidth="0.8"/>
      ))}
      {/* Spokes */}
      {g.spokes.map(([x,y],i)=>(
        <line key={i} x1={g.cx} y1={g.cy} x2={x} y2={y} stroke={D.surf3} strokeWidth="0.8"/>
      ))}
      {/* Data polygon */}
      <polygon points={g.polygon} fill={color+"28"} stroke={color} strokeWidth="1.5"/>
      {/* Dots */}
      {g.dots.map(([x,y],i)=><circle key={i} cx={x} cy={y} r="3" fill={color} stroke={D.surf1} strokeWidth="1.5"/>)}
      {/* Labels */}
      {g.labels.map(l=>(
        <text key={l.key} x={l.x} y={l.y} textAnchor={l.anchor}
          fontSize="12" fontFamily={D.body} fill={D.textMuted} fontWeight="500">
          {l.lines.map((t,i)=><tspan key={i} x={l.x} dy={i?12:0}>{t}</tspan>)}
        </text>
      ))}
    </svg>
  );
}

/**
 * A read that did not give rows, said as exactly what it is (GA-I08).
 *
 * `read` is what lib/readState.js returned: a state and its one sentence. This
 * only draws it. Loading, an empty answer, "not assessed yet", a role that may
 * not read it, a module switched off, a failure, an old observation and a
 * partly answered screen are different statements and each looks and reads
 * differently; none of them is a blank.
 *
 * RETRY is offered only where a second read could change the answer: a failed
 * or partial read, or a stale one. `onRetry` is the screen's own nonce bump,
 * which re-runs the SAME read with the same params and scope, so it can never
 * widen what was asked. Forbidden, disabled, loading, empty and unassessed get
 * no button. It is 44px tall, the floor for anything tapped.
 *
 * No motion: nothing here animates, so `prefers-reduced-motion` has nothing to
 * honour.
 */
const READ_ICON = { loading: "hourglass", failed: "triangle-alert", partial: "triangle-alert",
                    forbidden: "lock", disabled: "ban", unassessed: "target", stale: "hourglass" };

const ReadState = ({ read, onRetry, icon, compact = false, testId = "read-state" }) => {
  const { state, sentence, retry } = read;
  if (state === "ok" || !sentence) return null;
  const bad = state === "failed" || state === "partial";
  const glyph = READ_ICON[state] ?? icon ?? "—";
  return (
    <div data-testid={testId} data-state={state}
      role={bad ? "alert" : state === "loading" ? "status" : undefined}
      style={{ padding: compact ? "10px 14px" : "32px 16px", textAlign: "center",
               fontFamily: D.body, fontSize: "13px", lineHeight: 1.5,
               color: bad ? D.roseText : D.textMuted,
               display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
      {!compact && (
        <div style={{ fontSize: "20px", opacity: 0.7 }} aria-hidden="true">
          {isIcon(glyph) ? <Icon name={glyph}/> : glyph}
        </div>
      )}
      <div data-testid={`${testId}-sentence`}>{sentence}</div>
      {retry && onRetry && (
        <button type="button" onClick={onRetry} data-testid={`${testId}-retry`} className="pressBtn" style={{
          minHeight: "44px", minWidth: "44px", padding: "0 20px", borderRadius: D.pill,
          border: `1px solid ${D.border}`, background: D.surf3, color: D.textPrimary,
          fontFamily: D.head, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>Retry</button>
      )}
    </div>
  );
};

/**
 * Nothing to show — and WHICH nothing.
 *
 * Several states that look identical in a list and mean completely different
 * things, so the component insists on being told which one it is, and
 * lib/readState.js decides (the same decision every screen gets):
 *
 *   loading — the server has not answered yet. Say nothing about the data.
 *   error   — the request failed. This is NOT "no fixtures"; it is "we do not
 *             know", and the difference matters to someone deciding whether to
 *             get in a car. `status` separates "you may not read this" (403)
 *             from "it did not work"; `disabled` is a module switched off.
 *   empty   — the server answered, and the answer is none. The only one of
 *             these where a definitive statement is honest, and the only one
 *             that draws `message`.
 *
 * `what` names the thing in the reader's own words ("the injury list"): the
 * failure then reads "Could not read the injury list." `onRetry` adds the Retry
 * button to a failure and to nothing else.
 *
 * The read path never falls back to mock rows in a live session, so an empty
 * list is a real answer rather than a hidden failure — which is precisely why
 * it has to be possible to tell an empty answer from an absent one.
 */
const EmptyState = ({ loading, error, status, disabled, message = "Nothing here yet", icon = "—", what, onRetry }) => {
  const read = readState({ rows: [], loading, error, status, disabled, live: true }, { what });
  if (read.state !== "empty") return <ReadState read={read} onRetry={onRetry}/>;
  return (
    <div style={{ padding: "32px 16px", textAlign: "center",
                  fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>
      <div style={{ fontSize: "20px", marginBottom: "8px", opacity: 0.6 }} aria-hidden="true">
        {isIcon(icon) ? <Icon name={icon}/> : icon}
      </div>
      {message}
    </div>
  );
};

export { Avatar, Badge, Btn, Card, EmptyState, Input, KPICard, Modal, Pill, ProgressBar, RadarChart, ReadState, SectionHeader, Select, SkillBar, StatusDot };
