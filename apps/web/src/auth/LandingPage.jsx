import { useState } from "react";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { SCRBRD } from "../scorer/engine.jsx";

// ══════════════════════════════════════════════════════
//  LANDING PAGE
// ══════════════════════════════════════════════════════
function LandingPage({ onEnter, onLogin }) {
  const [hov, setHov] = useState(null);
  const FEATURES = [
    { icon:"🏏", title:"Live Scoring",     desc:"Ball-by-ball broadcast scoring with AI commentary" },
    { icon:"📊", title:"Player Analytics", desc:"Wagon wheel, phase analysis, shot breakdown by zone" },
    { icon:"👥", title:"Squad Management", desc:"Profiles, skills matrix, development tracking" },
    { icon:"🏥", title:"Injury Tracking",  desc:"Medical logs, return-to-play, fitness reporting" },
    { icon:"🚌", title:"Logistics",        desc:"Transport scheduling, venues, kit allocation" },
    { icon:"📅", title:"Smart Calendar",   desc:"Fixtures, training, events in one unified view" },
    { icon:"📋", title:"League Manager",   desc:"Standings, brackets, fixtures, top performers" },
    { icon:"📡", title:"Alerts",           desc:"Push notifications to players, parents and staff" },
  ];
  return (
    <div style={{minHeight:"100vh",background:"#03050c",display:"flex",flexDirection:"column",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"center",padding:"18px 32px",borderBottom:"1px solid rgba(255,255,255,0.06)",position:"sticky",top:0,background:"rgba(3,5,12,0.92)",backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",zIndex:10}}>
        <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"26px",objectFit:"contain",filter:"brightness(1.15)"}}/>
        <div style={{marginLeft:"auto",display:"flex",gap:"10px"}}>
          <button onClick={onLogin} className="pressBtn" style={{padding:"8px 18px",borderRadius:"20px",cursor:"pointer",background:"transparent",border:"1px solid rgba(255,255,255,0.15)",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.7)"}}>Log In</button>
          <button onClick={onEnter} className="pressBtn" style={{padding:"8px 20px",borderRadius:"20px",cursor:"pointer",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:"#fff",boxShadow:"0 4px 20px rgba(99,102,241,0.4)"}}>Get Started →</button>
        </div>
      </div>
      <div style={{textAlign:"center",padding:"80px 24px 60px",maxWidth:"900px",margin:"0 auto"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:"8px",padding:"6px 16px",borderRadius:"20px",background:"rgba(99,102,241,0.12)",border:"1px solid rgba(99,102,241,0.3)",marginBottom:"28px"}}>
          <div style={{width:"6px",height:"6px",borderRadius:"50%",background:"#6366f1",boxShadow:"0 0 8px #6366f1"}}/>
          <span style={{fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:"#a5b4fc",letterSpacing:"0.1em",textTransform:"uppercase"}}>The Cricket OS for Schools · Season 2026</span>
        </div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"clamp(36px,6vw,72px)",fontWeight:800,color:"#fff",lineHeight:1.05,letterSpacing:"-0.02em",marginBottom:"20px"}}>
          Cricket, Intelligently
          <span style={{display:"block",background:"linear-gradient(90deg,#6366f1,#06b6d4,#10b981)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}> Managed.</span>
        </div>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"17px",color:"rgba(255,255,255,0.55)",lineHeight:1.7,maxWidth:"600px",margin:"0 auto 36px"}}>
          SCRBRD is the all-in-one cricket operating system for schools — live scoring, analytics, squad management, logistics and communication in a single platform.
        </div>
        <div style={{display:"flex",gap:"14px",justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={onEnter} className="pressBtn" style={{padding:"14px 32px",borderRadius:"24px",cursor:"pointer",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",fontFamily:"'Syne',sans-serif",fontSize:"14px",fontWeight:700,color:"#fff",boxShadow:"0 6px 32px rgba(99,102,241,0.4)",letterSpacing:"0.04em"}}>🏏 Get Started — It's Free</button>
          <button onClick={onLogin} className="pressBtn" style={{padding:"14px 32px",borderRadius:"24px",cursor:"pointer",background:"transparent",border:"1px solid rgba(255,255,255,0.15)",fontFamily:"'Syne',sans-serif",fontSize:"14px",fontWeight:700,color:"rgba(255,255,255,0.7)"}}>Log In to My School →</button>
        </div>
      </div>
      <div style={{padding:"20px 24px 60px",maxWidth:"1000px",margin:"0 auto",width:"100%"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:"rgba(255,255,255,0.3)",textAlign:"center",marginBottom:"32px"}}>Everything your cricket programme needs</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"14px"}}>
          {FEATURES.map((f,i)=>(
            <div key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}
              style={{borderRadius:"14px",border:`1px solid ${hov===i?"rgba(99,102,241,0.4)":"rgba(255,255,255,0.06)"}`,background:hov===i?"rgba(99,102,241,0.08)":"rgba(255,255,255,0.02)",padding:"20px",transition:"all .2s"}}>
              <div style={{fontSize:"26px",marginBottom:"10px"}}>{f.icon}</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"13px",fontWeight:700,color:"#fff",marginBottom:"5px"}}>{f.title}</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"rgba(255,255,255,0.45)",lineHeight:1.5}}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{borderTop:"1px solid rgba(255,255,255,0.06)",padding:"24px",textAlign:"center"}}>
        <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"18px",objectFit:"contain",opacity:0.35,filter:"grayscale(1) brightness(2)",display:"block",margin:"0 auto 10px"}}/>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.2)",letterSpacing:"0.08em"}}>© 2026 SCRBRD · School Cricket Intelligence Platform</div>
      </div>
    </div>
  );
}

export { LandingPage };
