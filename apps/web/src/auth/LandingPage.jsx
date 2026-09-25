import { useState, useEffect } from "react";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { T, clr } from "../design/tokens.js";

// ══════════════════════════════════════════════════════
//  LANDING PAGE
// ══════════════════════════════════════════════════════
import { analyticsConsented, setAnalyticsConsent } from "../lib/firebase.js";
import { Icon } from "../ui/icons.jsx";

function LandingPage({ onEnter, onLogin }) {
  // Anonymous usage analytics: off until this device says otherwise. Asked
  // here, at the front door, because a pupil or a parent should never have to
  // find a settings page to learn that nothing was collected.
  const [analytics, setAnalytics] = useState(false);
  useEffect(() => { analyticsConsented().then(setAnalytics).catch(() => {}); }, []);
  const toggleAnalytics = async () => { const on = !analytics; setAnalytics(on); await setAnalyticsConsent(on); };

  const [hov, setHov] = useState(null);
  const FEATURES = [
    { icon:"scorebook", title:"Live Scoring",     desc:"Ball-by-ball broadcast scoring with AI commentary" },
    { icon:"chart-column", title:"Player Analytics", desc:"Wagon wheel, phase analysis, shot breakdown by zone" },
    { icon:"users", title:"Squad Management", desc:"Profiles, skills matrix, development tracking" },
    { icon:"bandage", title:"Injury Tracking",  desc:"Medical logs, return-to-play, fitness reporting" },
    { icon:"bus", title:"Logistics",        desc:"Transport scheduling, venues, kit allocation" },
    { icon:"calendar", title:"Smart Calendar",   desc:"Fixtures, training, events in one unified view" },
    { icon:"trophy", title:"League Manager",   desc:"Standings, brackets, fixtures, top performers" },
    { icon:"bell", title:"Alerts",           desc:"Push notifications to players, parents and staff" },
  ];
  return (
    <div style={{minHeight:"100vh",background:T.surface.canvas,display:"flex",flexDirection:"column",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",padding:"18px 32px",borderBottom:`1px solid ${T.line.subtle}`,position:"sticky",top:0,background:T.glass.film,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",zIndex:10}}>
        <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"26px",objectFit:"contain",filter:"brightness(1.15)"}}/>
        <div style={{marginLeft:"auto",display:"flex",gap:"10px"}}>
          <button onClick={onLogin} className="pressBtn" style={{padding:"8px 18px",borderRadius:"20px",cursor:"pointer",background:"transparent",border:`1px solid ${T.line.strong}`,fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:T.content.secondary}}>Log In</button>
          <button onClick={onEnter} className="pressBtn" style={{padding:"8px 20px",borderRadius:"20px",cursor:"pointer",background:T.light.action,border:"none",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:T.light.ink,boxShadow:`0 4px 20px ${clr(T.brand.blue,0.4)}`}}>Get Started →</button>
        </div>
      </div>
      <div style={{textAlign:"center",padding:"80px 24px 60px",maxWidth:"900px",margin:"0 auto"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:"8px",padding:"6px 16px",borderRadius:"20px",background:clr(T.brand.blue,0.12),border:`1px solid ${clr(T.brand.blue,0.3)}`,marginBottom:"28px"}}>
          <div style={{width:"6px",height:"6px",borderRadius:"50%",background:T.brand.blue,boxShadow:`0 0 8px ${T.brand.blue}`}}/>
          <span style={{fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:T.brand.blueText,letterSpacing:"0.1em",textTransform:"uppercase"}}>The Cricket OS for Schools · Season 2026</span>
        </div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"clamp(36px,6vw,72px)",fontWeight:800,color:T.content.primary,lineHeight:1.05,letterSpacing:"-0.02em",marginBottom:"20px"}}>
          Cricket, Intelligently
          <span style={{display:"block",background:`linear-gradient(90deg,${T.brand.blue},${T.brand.cyan},${T.brand.green})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}> Managed.</span>
        </div>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"17px",color:T.content.secondary,lineHeight:1.7,maxWidth:"600px",margin:"0 auto 36px"}}>
          SCRBRD is the all-in-one cricket operating system for schools — live scoring, analytics, squad management, logistics and communication in a single platform.
        </div>
        <div style={{display:"flex",gap:"14px",justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={onEnter} className="pressBtn" style={{padding:"14px 32px",borderRadius:"24px",cursor:"pointer",background:T.light.action,border:"none",fontFamily:"'Syne',sans-serif",fontSize:"14px",fontWeight:700,color:T.light.ink,boxShadow:`0 6px 32px ${clr(T.brand.blue,0.4)}`,letterSpacing:"0.04em"}}>Get Started — It's Free</button>
          <button onClick={onLogin} className="pressBtn" style={{padding:"14px 32px",borderRadius:"24px",cursor:"pointer",background:"transparent",border:`1px solid ${T.line.strong}`,fontFamily:"'Syne',sans-serif",fontSize:"14px",fontWeight:700,color:T.content.secondary}}>Log In to My School →</button>
        </div>
      </div>
      <div style={{padding:"20px 24px 60px",maxWidth:"1000px",margin:"0 auto",width:"100%"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:T.content.tertiary,textAlign:"center",marginBottom:"32px"}}>Everything your cricket programme needs</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"14px"}}>
          {FEATURES.map((f,i)=>(
            <div key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
              style={{borderRadius:"14px",border:`1px solid ${hov===i?clr(T.brand.blue,0.4):T.line.subtle}`,background:hov===i?clr(T.brand.blue,0.08):T.fill.panel,padding:"20px",transition:"all .2s"}}>
              <div style={{fontSize:"26px",marginBottom:"10px",color:T.brand.blueText}}><Icon name={f.icon}/></div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:T.content.primary,marginBottom:"5px"}}>{f.title}</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:T.content.tertiary,lineHeight:1.5}}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{borderTop:`1px solid ${T.line.subtle}`,padding:"24px",textAlign:"center"}}>
        <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"18px",objectFit:"contain",opacity:0.35,filter:"grayscale(1) brightness(2)",display:"block",margin:"0 auto 10px"}}/>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:T.content.tertiary,letterSpacing:"0.08em"}}>© 2026 SCRBRD · School Cricket Intelligence Platform</div>
        <div style={{marginTop:"10px",fontFamily:"'DM Mono',monospace",fontSize:"10px",color:T.content.tertiary,letterSpacing:"0.04em"}}>
          Anonymous usage analytics: <strong>{analytics ? "on" : "off"}</strong>{" "}
          <button onClick={toggleAnalytics} role="switch" aria-checked={analytics} data-testid="analytics-consent" className="pressBtn"
            style={{marginLeft:"6px",padding:"2px 10px",borderRadius:"10px",cursor:"pointer",background:"transparent",border:`1px solid ${T.line.strong}`,fontFamily:"'DM Mono',monospace",fontSize:"10px",color:T.content.secondary}}>
            {analytics ? "Turn off" : "Turn on"}
          </button>
          {analytics && <span style={{marginLeft:"8px"}}>— stops on your next visit if turned off</span>}
        </div>
      </div>
    </div>
  );
}

export { LandingPage };
