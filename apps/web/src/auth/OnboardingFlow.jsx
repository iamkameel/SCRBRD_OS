import { useState, useEffect } from "react";
import { canonicalRole } from "../design/roles.js";
import { api, signedIn } from "../lib/api.js";
import { mode } from "../lib/session.js";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { SCHOOLS_REGISTRY } from "../data/institution.js";
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { SCRBRD } from "../scorer/engine.jsx";

// ══════════════════════════════════════════════════════
//  ONBOARDING FLOW  (smart, dynamic, role-aware)
// ══════════════════════════════════════════════════════
function OnboardingFlow({ onComplete }) {
  const [step,   setStep]   = useState(0);
  const [data,   setData]   = useState({
    role: null, name: "", email: "", schoolId: null, schoolCustom: "",
    team: "", playerLink: "", inviteCode: "", jersey: "",
  });
  const [schoolSearch, setSchoolSearch] = useState("");
  // Live: the schools come from the server, by id, and the flow ends in a
  // pending request rather than a role. Demo: the registry, and a role.
  const [live, setLive] = useState(false);
  const [liveSchools, setLiveSchools] = useState([]);
  const [sent, setSent] = useState(null);   // null | "sending" | "ok" | error text
  useEffect(() => { let off = false; (async () => {
    if (await mode() !== "live") return;
    const r = await api("/api/schools").catch(() => null);
    if (off || !r?.rows) return;
    setLive(true); setLiveSchools(r.rows.map((x) => ({ id: x.id, name: x.name, city: "", province: "" })));
  })(); return () => { off = true; }; }, []);
  const [codeError,    setCodeError]    = useState("");
  const set = (k,v) => setData(d=>({...d,[k]:v}));

  // Roles available for self-registration (NO superadmin — only SA can assign SA)
  const PUBLIC_ROLES = [
    { id:"schooladmin",  icon:"🏫", label:"School Admin",       desc:"Manage your school's cricket programme",  requiresCode:true  },
    { id:"sportsmaster", icon:"🏅", label:"Sportsmaster",       desc:"Oversee teams, fixtures & competitions",  requiresCode:true  },
    { id:"coach",        icon:"🎯", label:"Head Coach",         desc:"Player development, analytics & tactics",  requiresCode:false },
    { id:"assistant",    icon:"🤝", label:"Coaching Assistant", desc:"Training support & squad management",      requiresCode:false },
    { id:"player",       icon:"🏏", label:"Player",             desc:"Track your own stats, form & development", requiresCode:false },
    { id:"parent",       icon:"👪", label:"Parent / Guardian",  desc:"Follow your child's matches & logistics",  requiresCode:false },
    { id:"scorer",       icon:"📋", label:"Official Scorer",    desc:"Score matches, submit scorecards",         requiresCode:false },
    { id:"medical",      icon:"⚕️", label:"Medical Staff",      desc:"Manage injuries and player fitness",        requiresCode:false },
    { id:"groundskeeper",icon:"🌿", label:"Groundskeeper",      desc:"Pitch prep, field management & tasks",     requiresCode:false },
    { id:"spectator",    icon:"👁", label:"Spectator / Fan",    desc:"View scores, stats and fixtures",          requiresCode:false },
  ];

  // Invite codes for elevated roles
  const INVITE_CODES = { schooladmin:"HILTADMIN26", sportsmaster:"SPORTS2026" };

  const selectedRole = PUBLIC_ROLES.find(r=>r.id===data.role);
  const needsCode = selectedRole?.requiresCode && !data.inviteCode;
  const ri = ROLES[data.role] || {};

  const filteredSchools = (live ? liveSchools : SCHOOLS_REGISTRY).filter(s=>
    s.name.toLowerCase().includes(schoolSearch.toLowerCase()) ||
    s.city.toLowerCase().includes(schoolSearch.toLowerCase()) ||
    s.province.toLowerCase().includes(schoolSearch.toLowerCase())
  );

  // Dynamic steps based on role
  const getSteps = () => {
    const base = ["welcome","role","school","profile"];
    if (data.role==="player")   return [...base,"player_detail","tour"];
    if (data.role==="parent")   return [...base,"parent_link","tour"];
    if (selectedRole?.requiresCode) return ["welcome","role","invite","school","profile","tour"];
    return [...base,"tour"];
  };
  const steps = getSteps();
  const stepId = steps[step];
  const progress = step / (steps.length - 1);

  const canAdvance = () => {
    if (stepId==="role")        return !!data.role;
    if (stepId==="invite")      return !!data.inviteCode;
    if (stepId==="school")      return !!data.schoolId;
    if (stepId==="profile")     return data.name.length >= 2 && (!live || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email));
    return true;
  };

  const handleNext = () => {
    if (stepId==="invite") {
      const expected = INVITE_CODES[data.role];
      if (data.inviteCode !== expected) { setCodeError(`Invalid code. Contact your School Admin.`); return; }
      setCodeError("");
    }
    if (step < steps.length - 1) { setStep(s=>s+1); return; }
    if (!live) { onComplete(data.role, data.name, data.schoolId||data.schoolCustom); return; }
    // Nobody assigns themselves anything: the server records an account with
    // nothing in it and a request for the people who may answer it.
    setSent("sending");
    api("/api/onboard", { method: "POST", body: { email: data.email, name: data.name, role: canonicalRole(data.role),
                                                  schoolId: data.schoolId, teamCode: data.team || null } })
      .then(() => setSent("ok"))
      .catch((e) => setSent(e?.code || e?.message || "failed"));
  };

  if (sent === "ok") return (
    <div className="onboard-shell" data-testid="request-sent" style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",background:"#05070d"}}>
      <div style={{maxWidth:"440px",textAlign:"center"}}>
        <div style={{fontSize:"40px",marginBottom:"12px"}}>📨</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"22px",fontWeight:800,color:"#fff",marginBottom:"8px"}}>Request sent</div>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.6)",lineHeight:1.6}}>
          {data.schoolCustom} has your request to join as {ri.label||data.role}. Somebody there will answer it. Sign in once they have, with {data.email}.
        </div>
        <button onClick={()=>onComplete(null, data.name, null, { requested:true })} className="pressBtn" style={{marginTop:"18px",padding:"10px 18px",borderRadius:"999px",border:"none",cursor:"pointer",background:"#6366f1",color:"#fff",fontFamily:"'Syne',sans-serif",fontWeight:700}}>Back to sign in</button>
      </div>
    </div>
  );

  const TOUR_MAP = {
    player:       [{icon:"📊",t:"Analytics",d:"Your wagon wheel, phase breakdown and shot analysis"},{icon:"💪",t:"Training",d:"Session plans and skill development goals"},{icon:"🏥",t:"Injuries",d:"Your fitness status and return-to-play timeline"}],
    parent:       [{icon:"🏏",t:"Match Centre",d:"Live scores and full scorecards"},{icon:"🚌",t:"Logistics",d:"Transport times and venues"},{icon:"🔔",t:"Notifications",d:"Real-time alerts for your child"}],
    coach:        [{icon:"👥",t:"Squad View",d:"Full team with skills, form and availability"},{icon:"📊",t:"Analytics",d:"Team and player performance breakdowns"},{icon:"💪",t:"Training",d:"Session planner and attendance tracker"}],
    scorer:       [{icon:"🏏",t:"Match Centre",d:"Open the live scoring interface"},{icon:"📅",t:"Calendar",d:"Your assigned match schedule"}],
    groundskeeper:[{icon:"🌿",t:"Fields",d:"Pitch profiles and preparation status"},{icon:"🛠️",t:"Management",d:"Ground task assignments and scheduling"}],
    default:      [{icon:"⬡",t:"Dashboard",d:"Live scores and team news at a glance"},{icon:"📅",t:"Calendar",d:"All fixtures, training and events"},{icon:"🔔",t:"Notifications",d:"Match alerts and announcements"}],
  };
  const tourItems = TOUR_MAP[data.role] || TOUR_MAP.default;

  const INP = { width:"100%",padding:"11px 14px",borderRadius:"10px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'DM Sans',sans-serif",fontSize:"14px",color:"#fff",boxSizing:"border-box" };

  return (
    <div style={{minHeight:"100vh",background:"#03050c",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:"600px"}}>
        {/* Progress */}
        <div style={{display:"flex",gap:"3px",marginBottom:"28px"}}>
          {steps.map((_,i)=>(
            <div key={i} style={{flex:1,height:"3px",borderRadius:"2px",background:i<=step?"linear-gradient(90deg,#6366f1,#8b5cf6)":"rgba(255,255,255,0.08)",transition:"background .3s"}}/>
          ))}
        </div>

        <div style={{borderRadius:"20px",border:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.02)",padding:"32px",backdropFilter:"blur(20px)"}}>
          <div style={{textAlign:"center",marginBottom:"24px"}}>
            <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"28px",objectFit:"contain",filter:"brightness(1.15)"}}/>
          </div>

          {/* ── WELCOME ── */}
          {stepId==="welcome"&&(
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:"52px",marginBottom:"16px"}}>🏏</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"24px",fontWeight:800,color:"#fff",marginBottom:"8px"}}>Welcome to SCRBRD</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"14px",color:"rgba(255,255,255,0.5)",lineHeight:1.7,maxWidth:"420px",margin:"0 auto"}}>
                Set up your account in under 2 minutes. We'll tailor the platform to your role and school.
              </div>
            </div>
          )}

          {/* ── ROLE SELECTION ── */}
          {stepId==="role"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"6px"}}>What's your role?</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.4)",textAlign:"center",marginBottom:"20px"}}>This shapes your experience. Super Admin access is assigned by your school's administrator.</div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"8px",maxHeight:"380px",overflowY:"auto",paddingRight:"4px"}}>
                {PUBLIC_ROLES.map(r=>(
                  <button key={r.id} onClick={()=>set("role",r.id)} className="pressBtn" style={{
                    display:"flex",alignItems:"flex-start",gap:"10px",padding:"12px 14px",borderRadius:"12px",
                    cursor:"pointer",border:`1px solid ${data.role===r.id?"rgba(99,102,241,0.55)":"rgba(255,255,255,0.07)"}`,
                    background:data.role===r.id?"rgba(99,102,241,0.14)":"rgba(255,255,255,0.02)",textAlign:"left",transition:"all .18s",
                  }}>
                    <span style={{fontSize:"20px",flexShrink:0,marginTop:"1px"}}>{r.icon}</span>
                    <div>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:data.role===r.id?"#a5b4fc":"rgba(255,255,255,0.85)"}}>{r.label}</div>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"10px",color:"rgba(255,255,255,0.35)",marginTop:"2px",lineHeight:1.4}}>{r.desc}</div>
                      {r.requiresCode&&<div style={{marginTop:"5px",padding:"2px 6px",borderRadius:"4px",background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",display:"inline-block",fontFamily:"'Syne',sans-serif",fontSize:"8px",fontWeight:700,color:"#fbbf24"}}>🔑 Invite code required</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── INVITE CODE ── */}
          {stepId==="invite"&&(
            <div>
              <div style={{textAlign:"center",marginBottom:"20px"}}>
                <div style={{fontSize:"36px",marginBottom:"10px"}}>🔑</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",marginBottom:"8px"}}>Invite Code Required</div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.45)",lineHeight:1.6}}>
                  The <strong style={{color:ri.color||"#a5b4fc"}}>{ri.label}</strong> role requires an invite code.<br/>Your school's Super Admin will have provided this.
                </div>
              </div>
              <div style={{marginBottom:"6px"}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}}>Invite Code</div>
                <input value={data.inviteCode} onChange={e=>{set("inviteCode",e.target.value.toUpperCase());setCodeError("");}}
                  placeholder="e.g. HILTADMIN26" style={{...INP,fontFamily:"'DM Mono',monospace",letterSpacing:"0.1em"}}/>
                {codeError&&<div style={{marginTop:"6px",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"#f87171"}}>{codeError}</div>}
              </div>
              <div style={{marginTop:"12px",padding:"10px 14px",borderRadius:"10px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"11px",color:"rgba(255,255,255,0.35)",lineHeight:1.5}}>
                  Don't have a code? Contact your school's cricket administrator or email <span style={{color:"#a5b4fc"}}>support@scrbrd.co.za</span>
                </div>
              </div>
            </div>
          )}

          {/* ── SCHOOL SELECTION ── */}
          {stepId==="school"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"6px"}}>Your School</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.4)",textAlign:"center",marginBottom:"16px"}}>Search from {SCHOOLS_REGISTRY.length} schools across South Africa</div>
              <input value={schoolSearch} onChange={e=>setSchoolSearch(e.target.value)}
                placeholder="Search by name, city or province…"
                style={{...INP,marginBottom:"10px"}}/>
              <div style={{maxHeight:"260px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"4px",paddingRight:"4px"}}>
                {filteredSchools.map(s=>(
                  <button key={s.id} onClick={()=>{set("schoolId",s.id);set("schoolCustom",s.name);}} className="pressBtn" style={{
                    display:"flex",alignItems:"center",gap:"12px",padding:"10px 14px",borderRadius:"10px",
                    cursor:"pointer",border:`1px solid ${data.schoolId===s.id?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.06)"}`,
                    background:data.schoolId===s.id?"rgba(99,102,241,0.12)":"rgba(255,255,255,0.02)",textAlign:"left",transition:"all .15s",
                  }}>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:data.schoolId===s.id?"#a5b4fc":"rgba(255,255,255,0.85)"}}>{s.name}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.3)",marginTop:"2px"}}>{s.city} · {s.province} · {s.type}</div>
                    </div>
                    {data.schoolId===s.id&&<span style={{color:"#6366f1",fontSize:"16px"}}>✓</span>}
                  </button>
                ))}
                {filteredSchools.length===0&&(
                  <div style={{padding:"16px",textAlign:"center",fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.3)"}}>
                    No schools found. <button onClick={()=>{set("schoolId","OTH");set("schoolCustom",schoolSearch);}} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:"#a5b4fc",fontFamily:"'DM Sans',sans-serif",fontSize:"13px"}}>Add "{schoolSearch}" manually →</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── PROFILE ── */}
          {stepId==="profile"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"6px"}}>Your Profile</div>
              {data.role&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",marginBottom:"18px"}}>
                <span style={{padding:"4px 12px",borderRadius:D.pill,background:`${ri.color||"#6366f1"}18`,border:`1px solid ${ri.color||"#6366f1"}33`,fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:ri.color||"#a5b4fc"}}>{ri.icon} {ri.label}</span>
                {data.schoolCustom&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.35)"}}>{data.schoolCustom}</span>}
              </div>}
              {[
                {label:"Full Name",       key:"name",   type:"text",  placeholder:"e.g. James Whitfield",      required:true},
                {label:"Email Address",   key:"email",  type:"email", placeholder:"james@school.co.za",         required:false},
              ].map(f=>(
                <div key={f.key} style={{marginBottom:"14px"}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}}>{f.label}{f.required&&" *"}</div>
                  <input value={data[f.key]} type={f.type} onChange={e=>set(f.key,e.target.value)} placeholder={f.placeholder} style={INP}/>
                </div>
              ))}
            </div>
          )}

          {/* ── PLAYER DETAIL ── */}
          {stepId==="player_detail"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"20px"}}>Player Details</div>
              {[
                {label:"Team / Age Group",  key:"team",   placeholder:"e.g. 1XI, U15B, 1st XI"},
                {label:"Jersey Number",     key:"jersey", placeholder:"e.g. 7"},
              ].map(f=>(
                <div key={f.key} style={{marginBottom:"14px"}}>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"6px"}}>{f.label}</div>
                  <input value={data[f.key]} onChange={e=>set(f.key,e.target.value)} placeholder={f.placeholder} style={INP}/>
                </div>
              ))}
              <div style={{marginBottom:"14px"}}>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"8px"}}>Batting / Bowling Role</div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-3,repeat(3,1fr))",gap:"6px"}}>
                  {["Batsman","Bowler","All-rounder","Wicketkeeper","Opening Bat","Pace Bowler"].map(r=>(
                    <button key={r} onClick={()=>set("playerRole",r)} className="pressBtn" style={{padding:"8px 6px",borderRadius:"8px",cursor:"pointer",border:`1px solid ${data.playerRole===r?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.07)"}`,background:data.playerRole===r?"rgba(99,102,241,0.14)":"transparent",fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:600,color:data.playerRole===r?"#a5b4fc":"rgba(255,255,255,0.5)"}}>{r}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── PARENT LINK ── */}
          {stepId==="parent_link"&&(
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",textAlign:"center",marginBottom:"8px"}}>Link to Player</div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.4)",textAlign:"center",marginBottom:"20px"}}>Optionally link your account to your child's player profile for personalised updates.</div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:"8px"}}>Search Player Name</div>
              <input value={data.playerLink} onChange={e=>set("playerLink",e.target.value)} placeholder="e.g. James Whitfield" style={{...INP,marginBottom:"10px"}}/>
              {data.playerLink.length>1&&(
                <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                  {PLAYERS.filter(p=>p.name.toLowerCase().includes(data.playerLink.toLowerCase())).slice(0,5).map(p=>(
                    <button key={p.id} onClick={()=>set("playerLink",p.name)} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",borderRadius:"9px",cursor:"pointer",border:"1px solid rgba(255,255,255,0.07)",background:"rgba(255,255,255,0.03)",textAlign:"left"}}>
                      <span style={{fontSize:"16px"}}>🏏</span>
                      <div>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:"11px",fontWeight:700,color:"rgba(255,255,255,0.8)"}}>{p.name}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"rgba(255,255,255,0.3)"}}>{p.role} · {p.team}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={()=>set("playerLink","skip")} className="pressBtn" style={{width:"100%",marginTop:"12px",padding:"9px",borderRadius:"9px",cursor:"pointer",background:"transparent",border:"1px solid rgba(255,255,255,0.06)",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",color:"rgba(255,255,255,0.35)"}}>Skip for now</button>
            </div>
          )}

          {/* ── TOUR ── */}
          {stepId==="tour"&&(
            <div>
              <div style={{textAlign:"center",marginBottom:"20px"}}>
                <div style={{fontSize:"36px",marginBottom:"10px"}}>{ri.icon||"🏏"}</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:"20px",fontWeight:800,color:"#fff",marginBottom:"6px"}}>You're all set, {data.name.split(" ")[0]||"there"}!</div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"13px",color:"rgba(255,255,255,0.4)"}}>Here's what's waiting for you as a <span style={{color:ri.color||"#a5b4fc",fontWeight:600}}>{ri.label}</span></div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {tourItems.map((t,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:"14px",padding:"12px 16px",borderRadius:"12px",background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                    <div style={{fontSize:"22px",width:"34px",textAlign:"center",flexShrink:0}}>{t.icon}</div>
                    <div>
                      <div style={{fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.85)"}}>{t.t}</div>
                      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:"11px",color:"rgba(255,255,255,0.38)",marginTop:"2px"}}>{t.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div style={{display:"flex",gap:"10px",marginTop:"14px",justifyContent:"flex-end",alignItems:"center"}}>
          {step>0&&<button onClick={()=>{setStep(s=>s-1);setCodeError("");}} className="pressBtn" style={{padding:"11px 22px",borderRadius:"14px",cursor:"pointer",background:"transparent",border:"1px solid rgba(255,255,255,0.1)",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,color:"rgba(255,255,255,0.45)"}}>← Back</button>}
          <div style={{flex:1}}/>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"rgba(255,255,255,0.25)"}}>{step+1} / {steps.length}</div>
          <button onClick={handleNext} disabled={!canAdvance()&&stepId!=="tour"} className="pressBtn" style={{
            padding:"11px 26px",borderRadius:"14px",cursor:canAdvance()||stepId==="tour"?"pointer":"not-allowed",
            background:canAdvance()||stepId==="tour"?"linear-gradient(135deg,#6366f1,#8b5cf6)":"rgba(255,255,255,0.08)",
            border:"none",fontFamily:"'Syne',sans-serif",fontSize:"12px",fontWeight:700,
            color:canAdvance()||stepId==="tour"?"#fff":"rgba(255,255,255,0.3)",
            boxShadow:canAdvance()||stepId==="tour"?"0 4px 20px rgba(99,102,241,0.35)":"none",
            letterSpacing:"0.04em",transition:"all .2s",
          }}>
            {stepId==="tour"?"🏏 Enter SCRBRD →":!canAdvance()&&stepId==="role"?"Select a role →":"Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { OnboardingFlow };
