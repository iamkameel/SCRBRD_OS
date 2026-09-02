import { D, px } from "../design/tokens.js";
import { initials } from "../lib/format.js";

// ══════════════════════════════════════════════════════
//  PRIMITIVE COMPONENTS
// ══════════════════════════════════════════════════════

const Card = ({ children, sx, className="card-hover", onClick }) => (
  <div onClick={onClick} className={className} style={{
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

const Btn = ({ children, onClick, variant="primary", size="md", disabled }) => {
  const bg = variant==="primary"?D.gradMain:variant==="success"?D.gradLive:variant==="danger"?D.rose:variant==="ghost"?"transparent":D.surf3;
  const col = variant==="ghost"?D.textSecondary:"#fff";
  const pad = size==="sm"?"5px 12px":size==="lg"?"12px 24px":"8px 18px";
  const fs  = size==="sm"?"11px":size==="lg"?"14px":"12px";
  return (
    <button onClick={onClick} disabled={disabled} className="pressBtn" style={{
      padding:pad,borderRadius:D.pill,border:`1px solid ${variant==="ghost"?D.border:"transparent"}`,
      background:bg,color:col,cursor:disabled?"not-allowed":"pointer",fontFamily:D.head,
      fontSize:fs,fontWeight:700,letterSpacing:"0.04em",opacity:disabled?0.4:1,
      boxShadow:variant==="primary"?`0 2px 12px ${D.indigo}33`:"none",
    }}>{children}</button>
  );
};

const Badge = ({ children, color=D.indigo }) => (
  <span style={{
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

const Modal = ({ title, children, onClose, width="520px" }) => (
  <div className="os-modal" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:"20px"}}>
    <div className="os-modal-card" style={{background:D.surf1,borderRadius:D.xl,border:`1px solid ${D.borderMed}`,width:"100%",maxWidth:width,maxHeight:"90vh",overflow:"auto"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",borderBottom:`1px solid ${D.border}`}}>
        <h3 style={{fontFamily:D.head,fontSize:"15px",fontWeight:700,color:D.textPrimary}}>{title}</h3>
        <button onClick={onClose} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"18px"}}>✕</button>
      </div>
      <div style={{padding:"20px"}}>{children}</div>
    </div>
  </div>
);

const Input = ({ label, value, onChange, type="text", placeholder, small }) => (
  <div style={{marginBottom:small?"0":"14px"}}>
    {label&&<div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>{label}</div>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
      style={{width:"100%",padding:"9px 12px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
        color:D.textPrimary,fontFamily:D.body,fontSize:"13px",outline:"none"}}/>
  </div>
);

const Select = ({ label, value, onChange, options }) => (
  <div style={{marginBottom:"14px"}}>
    {label&&<div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>{label}</div>}
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{width:"100%",padding:"9px 12px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
        color:D.textPrimary,fontFamily:D.body,fontSize:"13px",outline:"none"}}>
      {options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
    </select>
  </div>
);

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

export { Avatar, Badge, Btn, Card, Input, KPICard, Modal, Pill, ProgressBar, RadarChart, SectionHeader, Select, SkillBar, StatusDot };
