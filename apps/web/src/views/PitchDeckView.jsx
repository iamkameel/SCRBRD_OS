import { useState } from "react";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { D } from "../design/tokens.js";

// ══════════════════════════════════════════════════════
//  PITCH DECK VIEW
// ══════════════════════════════════════════════════════
function PitchDeckView({ role }) {
  const [slide, setSlide] = useState(0);

  const SLIDES = [
    {
      id:"cover", type:"cover",
      title:"SCRBRD",
      sub:"The Modern Cricket Operating System for Schools",
      body:"Intelligent scoring, analytics, squad management and communication — purpose-built for school cricket.",
      accent:D.violet,
    },
    {
      id:"problem", type:"content",
      title:"The Problem",
      icon:"❌",
      points:[
        "Manual scorebooks lose data and take hours to update",
        "Coaches lack real-time player performance insights",
        "Parents and players have no access to match data",
        "Squad management, logistics and medical are siloed",
        "No single platform connects all school cricket stakeholders",
      ],
      accent:D.rose,
    },
    {
      id:"solution", type:"content",
      title:"SCRBRD Solution",
      icon:"✅",
      points:[
        "Live ball-by-ball scoring with AI commentary generation",
        "Wagon wheel shot analysis with player-by-player breakdown",
        "Full squad management with skills matrix and development tracking",
        "Role-based access for players, coaches, parents, admin and medical",
        "Integrated logistics, calendar, injury tracking and notifications",
      ],
      accent:D.emerald,
    },
    {
      id:"product", type:"split",
      title:"Two Core Products",
      icon:"🏏",
      items:[
        {
          name:"SCRBRD Scorer",
          desc:"Professional broadcast-grade live scoring interface with wagon wheel, AI commentary, player profiles, phase analysis and over-by-over history.",
          color:D.sky,
          icon:"📱",
        },
        {
          name:"SCRBRD OS",
          desc:"Comprehensive school cricket management hub: squad, analytics, injuries, training, logistics, fields, staff, leagues, calendar and notifications.",
          color:D.violetText,
          icon:"⚙️",
        },
      ],
      accent:D.sky,
    },
    {
      id:"roles", type:"grid",
      title:"Who Uses SCRBRD?",
      icon:"👥",
      items:[
        { icon:"⚡",  label:"Super Admin",      desc:"Full system control, user management, audit" },
        { icon:"🏫",  label:"School Admin",     desc:"Fixtures, squads, logistics, broadcasts" },
        { icon:"🏅",  label:"Sportsmaster",     desc:"Team management, fixtures, competitions" },
        { icon:"🎯",  label:"Head Coach",       desc:"Analytics, skills, training, injury tracking" },
        { icon:"🤝",  label:"Coaching Asst",    desc:"Training sessions, squad support, profiles" },
        { icon:"🏏",  label:"Player",           desc:"Personal stats, form, training, calendar" },
        { icon:"👪",  label:"Parent",          desc:"Match updates, logistics, child's profile" },
        { icon:"📋",  label:"Scorer",           desc:"Match scoring, ball entry, scorecards" },
        { icon:"🌿",  label:"Groundskeeper",    desc:"Pitch profiles, ground tasks, field status" },
        { icon:"⚕️",  label:"Medical Staff",    desc:"Injury management, clearance, fitness" },
      ],
      accent:D.amber,
    },
    {
      id:"analytics", type:"content",
      title:"Analytics & Intelligence",
      icon:"📊",
      points:[
        "Real-time run rate, required run rate and win probability",
        "Player wagon wheel: per-shot, per-zone, per-bowler breakdown",
        "Phase analysis: Powerplay / Middle / Death performance split",
        "Partnership tracker with ball-by-ball boundary rate",
        "AI-generated broadcast commentary via Claude",
        "Opposition scouting dashboard — H2H records, strengths/weaknesses",
      ],
      accent:D.indigo,
    },
    {
      id:"traction", type:"stats",
      title:"Hilton Pilot — Season Stats",
      icon:"🏆",
      stats:[
        { value:"3",    label:"Teams",          sub:"U13A · U15A · 1XI" },
        { value:"18",   label:"Players",        sub:"Hilton + Westville" },
        { value:"8",    label:"Matches",        sub:"This season" },
        { value:"15",   label:"Users",          sub:"Across all roles" },
        { value:"4",    label:"Leagues",        sub:"KZN competitions" },
        { value:"16",   label:"Platform Modules",sub:"Live in OS" },
      ],
      accent:D.emerald,
    },
    {
      id:"roadmap", type:"content",
      title:"Roadmap",
      icon:"🚀",
      points:[
        "🔴 AI post-match report generator (PDF export with insights)",
        "🔴 Live score sync between SCRBRD Scorer and OS hub",
        "🔴 Parent broadcast push notifications (WhatsApp / Email)",
        "🟡 CricHQ and PlayHQ data sync integration",
        "🟡 Video clip tagging tied to ball-by-ball data",
        "🟡 Opposition scouting AI with automated pre-match reports",
        "🔵 Multi-school license model for provincial rollout",
      ],
      accent:D.violet,
    },
    {
      id:"cta", type:"cover",
      title:"Ready to Transform Your Cricket?",
      sub:"SCRBRD — Built for Schools. Powered by Intelligence.",
      body:"Contact us to arrange a demonstration for your school cricket programme. Pilot pricing available for KZN schools in 2026.",
      accent:D.violet,
      cta:"📧 scrbrd@hilton.co.za",
    },
  ];

  const s = SLIDES[slide];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      {/* Slide nav */}
      <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
        <button onClick={()=>setSlide(Math.max(0,slide-1))} className="pressBtn" disabled={slide===0} style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"10px",color:D.textMuted}}>← Prev</button>
        <div style={{display:"flex",gap:"5px",flex:1,flexWrap:"wrap",justifyContent:"center"}}>
          {SLIDES.map((sl,i)=>(
            <button key={sl.id} onClick={()=>setSlide(i)} className="pressBtn" style={{width:"10px",height:"10px",borderRadius:"50%",padding:0,cursor:"pointer",border:"none",background:i===slide?D.violet:"rgba(255,255,255,0.2)",transition:"all .18s"}}/>
          ))}
        </div>
        <button onClick={()=>setSlide(Math.min(SLIDES.length-1,slide+1))} className="pressBtn" disabled={slide===SLIDES.length-1} style={{padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",background:"transparent",border:`1px solid ${D.border}`,fontFamily:D.head,fontSize:"10px",color:D.textMuted}}>Next →</button>
        <div style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{slide+1}/{SLIDES.length}</div>
      </div>

      {/* Slide */}
      <div style={{borderRadius:D.xl,border:`1px solid ${s.accent}33`,background:`linear-gradient(135deg,${s.accent}08,${D.surf1} 60%)`,minHeight:"420px",padding:"40px",display:"flex",flexDirection:"column",justifyContent:"center",position:"relative",overflow:"hidden"}}>
        {/* Decorative circle */}
        <div style={{position:"absolute",top:"-40px",right:"-40px",width:"200px",height:"200px",borderRadius:"50%",background:`${s.accent}08`,pointerEvents:"none"}}/>

        {s.type==="cover"&&(
          <div style={{textAlign:"center",maxWidth:"600px",margin:"0 auto"}}>
            <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"48px",objectFit:"contain",marginBottom:"24px",filter:"brightness(1.2)"}}/>
            <div style={{fontFamily:D.head,fontSize:"clamp(26px,4vw,40px)",fontWeight:800,color:D.textPrimary,lineHeight:1.1,marginBottom:"12px"}}>{s.title}</div>
            <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:600,color:s.accent,marginBottom:"12px"}}>{s.sub}</div>
            <div style={{fontFamily:D.body,fontSize:"14px",color:D.textSecondary,lineHeight:1.7,marginBottom:"16px"}}>{s.body}</div>
            {s.cta&&<div style={{fontFamily:D.mono,fontSize:"13px",color:s.accent,padding:"10px 20px",borderRadius:D.pill,border:`1px solid ${s.accent}55`,display:"inline-block"}}>{s.cta}</div>}
          </div>
        )}

        {s.type==="content"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"28px"}}>
              <div style={{fontSize:"36px"}}>{s.icon}</div>
              <div style={{fontFamily:D.head,fontSize:"clamp(22px,3vw,32px)",fontWeight:800,color:D.textPrimary}}>{s.title}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
              {s.points.map((p,i)=>(
                <div key={i} style={{display:"flex",alignItems:"flex-start",gap:"12px"}}>
                  <div style={{width:"8px",height:"8px",borderRadius:"50%",background:s.accent,marginTop:"6px",flexShrink:0}}/>
                  <div style={{fontFamily:D.body,fontSize:"15px",color:D.textSecondary,lineHeight:1.6}}>{p}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {s.type==="split"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"28px"}}>
              <div style={{fontSize:"36px"}}>{s.icon}</div>
              <div style={{fontFamily:D.head,fontSize:"clamp(22px,3vw,32px)",fontWeight:800,color:D.textPrimary}}>{s.title}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"20px"}}>
              {s.items.map((item,i)=>(
                <div key={i} style={{borderRadius:D.lg,border:`1px solid ${item.color}44`,background:`${item.color}08`,padding:"24px"}}>
                  <div style={{fontSize:"32px",marginBottom:"10px"}}>{item.icon}</div>
                  <div style={{fontFamily:D.head,fontSize:"18px",fontWeight:800,color:item.color,marginBottom:"8px"}}>{item.name}</div>
                  <div style={{fontFamily:D.body,fontSize:"14px",color:D.textSecondary,lineHeight:1.6}}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {s.type==="grid"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"24px"}}>
              <div style={{fontSize:"32px"}}>{s.icon}</div>
              <div style={{fontFamily:D.head,fontSize:"clamp(20px,3vw,30px)",fontWeight:800,color:D.textPrimary}}>{s.title}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:"12px"}}>
              {s.items.map((item,i)=>(
                <div key={i} style={{borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf2,padding:"14px"}}>
                  <div style={{fontSize:"22px",marginBottom:"6px"}}>{item.icon}</div>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>{item.label}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,lineHeight:1.5}}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {s.type==="stats"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:"14px",marginBottom:"28px"}}>
              <div style={{fontSize:"36px"}}>{s.icon}</div>
              <div style={{fontFamily:D.head,fontSize:"clamp(22px,3vw,32px)",fontWeight:800,color:D.textPrimary}}>{s.title}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"16px"}}>
              {s.stats.map((st,i)=>(
                <div key={i} style={{borderRadius:D.lg,border:`1px solid ${s.accent}33`,background:`${s.accent}08`,padding:"20px",textAlign:"center"}}>
                  <div style={{fontFamily:D.mono,fontSize:"36px",fontWeight:700,color:s.accent,lineHeight:1}}>{st.value}</div>
                  <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textPrimary,marginTop:"6px"}}>{st.label}</div>
                  <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"2px"}}>{st.sub}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { PitchDeckView };
