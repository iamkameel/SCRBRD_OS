import { useEffect, useState } from "react";
import { canonicalRole } from "../design/roles.js";
import { api } from "../lib/api.js";
import { mode } from "../lib/session.js";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { SCHOOLS_REGISTRY } from "../data/institution.js";
import { ROLES } from "../design/roles.js";
import { D, T, inkOn } from "../design/tokens.js";
import { Icon } from "../ui/icons.jsx";

// ══════════════════════════════════════════════════════
//  ONBOARDING FLOW  (smart, dynamic, role-aware)
//
// "Seamless" is not a slogan here — it names three specific things this flow
// used to fail at:
//
//   1. A step nobody needed. Every deployment so far is one school, so
//      asking "which school?" made a person search a list of one. The
//      school step is now skipped outright when exactly one is on offer,
//      and it is filled in for them rather than left blank.
//   2. A click nobody needed. Choosing a role or a school used to still
//      require a separate "Continue" press — the choice IS the intent, so
//      both now advance the flow themselves, on a short delay long enough
//      to see the selection land.
//   3. Silence while the network is thinking. A live submission used to
//      show nothing while the request was in flight and nothing if it
//      failed — the button just sat there, and a person could press it
//      again into a second row. It now disables itself, shows a spinner,
//      and — if the server refuses — says why, in this screen, not as a
//      console error nobody but a developer will ever see.
// ══════════════════════════════════════════════════════
// The server refuses with a short machine code — "role_invalid",
// "school_required" — which is exactly right for the API and exactly wrong
// to put in front of a person mid-form. A few of these are worth naming in
// plain words; everything else still shows the code, because a wrong but
// visible message beats a right one nobody wrote yet, and it gives a person
// something concrete to read out over the phone to support.
const ONBOARD_ERROR_COPY = {
  name_required: "That name looks incomplete — check it and try again.",
  email_invalid: "That doesn’t look like an email address.",
  school_required: "Choose a school before sending the request.",
  already_pending: "You already have a request in for this — sit tight, someone will answer it.",
  no_such_school: "That school could not be found. Try picking it again.",
};
function explainOnboardError(e) {
  const code = e?.code || e?.message;
  if (code && ONBOARD_ERROR_COPY[code]) return ONBOARD_ERROR_COPY[code];
  if (code) return `The server refused: ${code}. Nothing was lost — check the form and try again.`;
  return "Could not reach the server. Check your connection and try again.";
}

function OnboardingFlow({ onComplete }) {
  const [step,   setStep]   = useState(0);
  const [data,   setData]   = useState({
    role: null, name: "", email: "", schoolId: null, schoolCustom: "",
    team: "", playerLink: "", jersey: "", playerRole: "",
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
  const set = (k,v) => setData(d=>({...d,[k]:v}));

  // A single school is not a choice — the whole reason the step exists is
  // to find out which of several a person means. Fill it in and skip past
  // it rather than making them confirm the only option there is.
  const onlySchool = live && liveSchools.length === 1 ? liveSchools[0] : null;
  useEffect(() => {
    if (onlySchool && !data.schoolId) setData((d) => ({ ...d, schoolId: onlySchool.id, schoolCustom: onlySchool.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlySchool?.id]);

  // Roles available for self-registration — no platformadmin, which nobody
  // requests their way into; it is assigned, never asked for. An elevated
  // role here (schooladmin, directorofsport) is not gated by anything on
  // this screen: role_request_grantable in the database is the only real
  // gate, and every request — this one included — lands pending until
  // someone who already holds user.role.assign at that school decides it.
  // A client-side "invite code" used to sit in front of two of these roles,
  // hardcoded in the shipped bundle where anyone could read it straight out
  // of the JS — a secret that was never actually checked by anything, and
  // an extra step in front of nothing.
  const PUBLIC_ROLES = [
    { id:"schooladmin",  icon:"school", label:"School Admin",       desc:"Manage your school’s cricket programme" },
    { id:"directorofsport", icon:"medal", label:"Director of Sport", desc:"Oversee teams, fixtures & competitions" },
    { id:"coach",        icon:"target", label:"Head Coach",         desc:"Player development, analytics & tactics" },
    { id:"assistantcoach", icon:"handshake", label:"Coaching Assistant", desc:"Training support & squad management" },
    { id:"player",       icon:"bat", label:"Player",             desc:"Track your own stats, form & development" },
    { id:"guardian",     icon:"users-round", label:"Parent / Guardian",  desc:"Follow your child’s matches & logistics" },
    { id:"scorer",       icon:"scorebook", label:"Official Scorer",    desc:"Score matches, submit scorecards" },
    { id:"medical",      icon:"stethoscope", label:"Medical Staff",      desc:"Manage injuries and player fitness" },
    { id:"facilities",   icon:"sprout", label:"Groundskeeper",      desc:"Pitch prep, field management & tasks" },
    { id:"spectator",    icon:"eye", label:"Spectator / Fan",    desc:"View scores, stats and fixtures" },
  ];

  const ri = ROLES[data.role] || {};

  const schoolPool = live ? liveSchools : SCHOOLS_REGISTRY;
  const filteredSchools = schoolPool.filter(s=>
    s.name.toLowerCase().includes(schoolSearch.toLowerCase()) ||
    s.city.toLowerCase().includes(schoolSearch.toLowerCase()) ||
    s.province.toLowerCase().includes(schoolSearch.toLowerCase())
  );

  // Dynamic steps based on role AND on how many schools there are to choose
  // from — "school" only appears when choosing one means something.
  const getSteps = () => {
    const base = ["welcome","role", ...(onlySchool ? [] : ["school"]), "profile"];
    if (data.role==="player") return [...base,"player_detail","tour"];
    if (data.role==="guardian") return [...base,"parent_link","tour"];
    return [...base,"tour"];
  };
  const steps = getSteps();
  const stepId = steps[step];

  const canAdvance = () => {
    if (stepId==="role")        return !!data.role;
    if (stepId==="school")      return !!data.schoolId;
    if (stepId==="profile")     return data.name.length >= 2 && (!live || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email));
    return true;
  };

  // Choosing IS advancing — the click that used to also need a "Continue"
  // press right after it. The delay is long enough to see the tile light up
  // before the screen under it changes; shorter and it would feel like the
  // choice was never registered at all.
  const chooseAndAdvance = (patch) => {
    setData((d) => ({ ...d, ...patch }));
    setTimeout(() => setStep((s) => s + 1), 220);
  };

  // Everything this form learns that has nowhere to live until a real
  // account exists — which team, which jersey, which existing player a
  // parent means — travels as one note to whoever answers the request,
  // rather than being asked for and then quietly dropped on submission.
  const buildNote = () => {
    const parts = [];
    if (data.role === "guardian" && data.playerLink.trim()) parts.push(`Child: ${data.playerLink.trim()}`);
    if (data.role === "player") {
      if (data.jersey.trim())     parts.push(`Jersey: ${data.jersey.trim()}`);
      if (data.playerRole)        parts.push(`Plays as: ${data.playerRole}`);
    }
    return parts.join(" · ") || null;
  };

  const handleNext = () => {
    if (sent === "sending") return;   // one submission, not one per impatient click
    if (step < steps.length - 1) { setStep(s=>s+1); return; }
    if (!live) { onComplete(data.role, data.name, data.schoolId||data.schoolCustom); return; }
    // Nobody assigns themselves anything: the server records an account with
    // nothing in it and a request for the people who may answer it.
    setSent("sending");
    api("/api/onboard", { method: "POST", body: { email: data.email, name: data.name, role: canonicalRole(data.role),
                                                  schoolId: data.schoolId, teamCode: data.team || null, note: buildNote() } })
      .then(() => setSent("ok"))
      .catch((e) => setSent(explainOnboardError(e)));
  };

  if (sent === "ok") return (
    <div className="onboard-shell" data-testid="request-sent" style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",background:D.surf0}}>
      <div style={{maxWidth:"440px",textAlign:"center"}}>
        <div style={{fontSize:"40px",marginBottom:"12px",color:D.indigoText}}><Icon name="send"/></div>
        <div style={{fontFamily:D.head,fontSize:"22px",fontWeight:800,color:T.content.primary,marginBottom:"8px"}}>Request sent</div>
        <div style={{fontFamily:D.body,fontSize:"13px",color:T.content.secondary,lineHeight:1.6}}>
          {data.schoolCustom} has your request to join as {ri.label||data.role}. Somebody there will answer it. Sign in once they have, with {data.email}.
        </div>
        <button onClick={()=>onComplete(null, data.name, null, { requested:true })} className="pressBtn" style={{marginTop:"18px",padding:"10px 18px",borderRadius:"999px",border:"none",cursor:"pointer",background:D.indigo,color:inkOn(D.indigo),fontFamily:D.head,fontWeight:700}}>Back to sign in</button>
      </div>
    </div>
  );

  const TOUR_MAP = {
    player:       [{icon:"chart-column",t:"Analytics",d:"Your wagon wheel, phase breakdown and shot analysis"},{icon:"dumbbell",t:"Training",d:"Session plans and skill development goals"},{icon:"bandage",t:"Injuries",d:"Your fitness status and return-to-play timeline"}],
    guardian:     [{icon:"stumps",t:"Match Centre",d:"Live scores and full scorecards"},{icon:"bus",t:"Logistics",d:"Transport times and venues"},{icon:"bell",t:"Notifications",d:"Real-time alerts for your child"}],
    coach:        [{icon:"users",t:"Squad View",d:"Full team with skills, form and availability"},{icon:"chart-column",t:"Analytics",d:"Team and player performance breakdowns"},{icon:"dumbbell",t:"Training",d:"Session planner and attendance tracker"}],
    scorer:       [{icon:"stumps",t:"Match Centre",d:"Open the live scoring interface"},{icon:"calendar",t:"Calendar",d:"Your assigned match schedule"}],
    facilities:   [{icon:"ground",t:"Fields",d:"Pitch profiles and preparation status"},{icon:"user-cog",t:"Management",d:"Ground task assignments and scheduling"}],
    default:      [{icon:"layout-dashboard",t:"Dashboard",d:"Live scores and team news at a glance"},{icon:"calendar",t:"Calendar",d:"All fixtures, training and events"},{icon:"bell",t:"Notifications",d:"Match alerts and announcements"}],
  };
  const tourItems = TOUR_MAP[data.role] || TOUR_MAP.default;

  const INP = { width:"100%",padding:"11px 14px",borderRadius:"10px",background:T.fill.field,border:`1px solid ${T.line.normal}`,fontFamily:D.body,fontSize:"14px",color:T.content.primary,boxSizing:"border-box" };
  const sending = sent === "sending";
  const submitError = sent && sent !== "ok" && sent !== "sending" ? sent : null;

  return (
    <div style={{minHeight:"100vh",background:D.surf0,display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:"600px"}}>
        {/* Progress */}
        <div style={{display:"flex",gap:"3px",marginBottom:"28px"}}>
          {steps.map((_,i)=>(
            <div key={i} style={{flex:1,height:"3px",borderRadius:"2px",background:i<=step?`linear-gradient(90deg,${D.indigo},${D.violet})`:T.fill.track,transition:"background .3s"}}/>
          ))}
        </div>

        <div style={{borderRadius:"20px",border:`1px solid ${T.line.normal}`,background:T.fill.panel,padding:"32px",backdropFilter:"blur(20px)"}}>
          <div style={{textAlign:"center",marginBottom:"24px"}}>
            <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"28px",objectFit:"contain",filter:"brightness(1.15)"}}/>
          </div>

          {/* ── WELCOME ── */}
          {stepId==="welcome"&&(
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:"52px",marginBottom:"16px",color:D.indigoText}}><Icon name="bat"/></div>
              <div style={{fontFamily:D.head,fontSize:"24px",fontWeight:800,color:T.content.primary,marginBottom:"8px"}}>Welcome to SCRBRD</div>
              <div style={{fontFamily:D.body,fontSize:"14px",color:T.content.secondary,lineHeight:1.7,maxWidth:"420px",margin:"0 auto"}}>
                Set up your account in under 2 minutes. We’ll tailor the platform to your role{onlySchool?"":" and school"}.
              </div>
            </div>
          )}

          {/* ── ROLE SELECTION ── */}
          {stepId==="role"&&(
            <div>
              <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:T.content.primary,textAlign:"center",marginBottom:"6px"}}>What’s your role?</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:T.content.tertiary,textAlign:"center",marginBottom:"20px"}}>This shapes your experience. Every role here is a request — someone at your school approves it before it takes effect.</div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"8px",maxHeight:"380px",overflowY:"auto",paddingRight:"4px"}}>
                {PUBLIC_ROLES.map(r=>(
                  <button key={r.id} onClick={()=>chooseAndAdvance({ role: r.id })} className="pressBtn" style={{
                    display:"flex",alignItems:"flex-start",gap:"10px",padding:"12px 14px",borderRadius:"12px",
                    cursor:"pointer",border:`1px solid ${data.role===r.id?`${D.indigo}8c`:T.line.subtle}`,
                    background:data.role===r.id?`${D.indigo}24`:T.fill.panel,textAlign:"left",transition:"all .18s",
                  }}>
                    <span style={{fontSize:"20px",flexShrink:0,marginTop:"1px",color:data.role===r.id?D.indigoText:T.content.secondary}}><Icon name={r.icon}/></span>
                    <div>
                      <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:data.role===r.id?D.indigoText:T.content.primary}}>{r.label}</div>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:T.content.tertiary,marginTop:"2px",lineHeight:1.4}}>{r.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── SCHOOL SELECTION ── */}
          {stepId==="school"&&(
            <div>
              <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:T.content.primary,textAlign:"center",marginBottom:"6px"}}>Your School</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:T.content.tertiary,textAlign:"center",marginBottom:"16px"}}>Search from {schoolPool.length} school{schoolPool.length===1?"":"s"}{live?"":" across South Africa"}</div>
              <input value={schoolSearch} onChange={e=>setSchoolSearch(e.target.value)}
                placeholder="Search by name, city or province…"
                style={{...INP,marginBottom:"10px"}}/>
              <div style={{maxHeight:"260px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"4px",paddingRight:"4px"}}>
                {filteredSchools.map(s=>(
                  <button key={s.id} onClick={()=>chooseAndAdvance({ schoolId: s.id, schoolCustom: s.name })} className="pressBtn" style={{
                    display:"flex",alignItems:"center",gap:"12px",padding:"10px 14px",borderRadius:"10px",
                    cursor:"pointer",border:`1px solid ${data.schoolId===s.id?`${D.indigo}80`:T.line.subtle}`,
                    background:data.schoolId===s.id?`${D.indigo}1e`:T.fill.panel,textAlign:"left",transition:"all .15s",
                  }}>
                    <div style={{flex:1}}>
                      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:data.schoolId===s.id?D.indigoText:T.content.primary}}>{s.name}</div>
                      <div style={{fontFamily:D.mono,fontSize:"10px",color:T.content.tertiary,marginTop:"2px"}}>{s.city} · {s.province} · {s.type}</div>
                    </div>
                    {data.schoolId===s.id&&<span style={{color:D.indigoText,fontSize:"16px"}}>✓</span>}
                  </button>
                ))}
                {filteredSchools.length===0&&!live&&(
                  <div style={{padding:"16px",textAlign:"center",fontFamily:D.body,fontSize:"13px",color:T.content.tertiary}}>
                    No schools found. <button onClick={()=>chooseAndAdvance({ schoolId:"OTH", schoolCustom: schoolSearch })} className="pressBtn" style={{background:"none",border:"none",cursor:"pointer",color:D.indigoText,fontFamily:D.body,fontSize:"13px"}}>Add "{schoolSearch}" manually →</button>
                  </div>
                )}
                {filteredSchools.length===0&&live&&(
                  <div style={{padding:"16px",textAlign:"center",fontFamily:D.body,fontSize:"13px",color:T.content.tertiary}}>
                    No school matches that search.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── PROFILE ── */}
          {stepId==="profile"&&(
            <div>
              <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:T.content.primary,textAlign:"center",marginBottom:"6px"}}>Your Profile</div>
              {data.role&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",marginBottom:"18px"}}>
                <span style={{padding:"4px 12px",borderRadius:D.pill,background:`${ri.color||D.indigo}18`,border:`1px solid ${ri.color||D.indigo}33`,fontFamily:D.head,fontSize:"11px",fontWeight:700,color:ri.color||D.indigoText,display:"inline-flex",alignItems:"center",gap:"5px"}}>{ri.icon&&<Icon name={ri.icon}/>} {ri.label}</span>
                {data.schoolCustom&&<span style={{fontFamily:D.mono,fontSize:"10px",color:T.content.tertiary}}>{data.schoolCustom}</span>}
              </div>}
              {[
                {label:"Full Name",       key:"name",   type:"text",  placeholder:"e.g. James Whitfield",      required:true},
                {label:"Email Address",   key:"email",  type:"email", placeholder:"james@school.co.za",         required:live},
              ].map(f=>(
                <div key={f.key} style={{marginBottom:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.content.tertiary,marginBottom:"6px"}}>{f.label}{f.required&&" *"}</div>
                  <input value={data[f.key]} type={f.type} onChange={e=>set(f.key,e.target.value)} placeholder={f.placeholder} style={INP}/>
                </div>
              ))}
            </div>
          )}

          {/* ── PLAYER DETAIL ── */}
          {stepId==="player_detail"&&(
            <div>
              <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:T.content.primary,textAlign:"center",marginBottom:"20px"}}>Player Details</div>
              {[
                {label:"Team / Age Group",  key:"team",   placeholder:"e.g. 1XI, U15B, 1st XI"},
                {label:"Jersey Number",     key:"jersey", placeholder:"e.g. 7"},
              ].map(f=>(
                <div key={f.key} style={{marginBottom:"14px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.content.tertiary,marginBottom:"6px"}}>{f.label}</div>
                  <input value={data[f.key]} onChange={e=>set(f.key,e.target.value)} placeholder={f.placeholder} style={INP}/>
                </div>
              ))}
              <div style={{marginBottom:"14px"}}>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.content.tertiary,marginBottom:"8px"}}>Batting / Bowling Role</div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-3,repeat(3,1fr))",gap:"6px"}}>
                  {["Batsman","Bowler","All-rounder","Wicketkeeper","Opening Bat","Pace Bowler"].map(r=>(
                    <button key={r} onClick={()=>set("playerRole",r)} className="pressBtn" style={{padding:"8px 6px",borderRadius:"8px",cursor:"pointer",border:`1px solid ${data.playerRole===r?`${D.indigo}80`:T.line.subtle}`,background:data.playerRole===r?`${D.indigo}24`:"transparent",fontFamily:D.head,fontSize:"10px",fontWeight:600,color:data.playerRole===r?D.indigoText:T.content.secondary}}>{r}</button>
                  ))}
                </div>
              </div>
              {live&&<div style={{marginTop:"12px",fontFamily:D.body,fontSize:"11px",color:T.content.tertiary,lineHeight:1.5}}>
                These travel with your request — whoever approves it sees them, so your team and role are on record from the start.
              </div>}
            </div>
          )}

          {/* ── PARENT LINK ── */}
          {stepId==="parent_link"&&(
            <div>
              <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:T.content.primary,textAlign:"center",marginBottom:"8px"}}>Link to Player</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:T.content.tertiary,textAlign:"center",marginBottom:"20px"}}>
                Optionally name your child. Nobody at your school can be searched from here before your account exists — whoever approves your
                request will match this to the right player.
              </div>
              <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.content.tertiary,marginBottom:"8px"}}>Child’s Name</div>
              <input value={data.playerLink} onChange={e=>set("playerLink",e.target.value)} placeholder="e.g. James Whitfield" style={INP}/>
            </div>
          )}

          {/* ── TOUR ── */}
          {stepId==="tour"&&(
            <div>
              <div style={{textAlign:"center",marginBottom:"20px"}}>
                <div style={{fontSize:"36px",marginBottom:"10px",color:ri.color||D.indigoText}}><Icon name={ri.icon||"bat"}/></div>
                <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:T.content.primary,marginBottom:"6px"}}>You’re all set, {data.name.split(" ")[0]||"there"}!</div>
                <div style={{fontFamily:D.body,fontSize:"13px",color:T.content.tertiary}}>Here’s what’s waiting for you as a <span style={{color:ri.color||D.indigoText,fontWeight:600}}>{ri.label}</span></div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {tourItems.map((t,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:"14px",padding:"12px 16px",borderRadius:"12px",background:T.fill.panel,border:`1px solid ${T.line.subtle}`}}>
                    <div style={{fontSize:"22px",width:"34px",textAlign:"center",flexShrink:0,color:T.content.secondary}}><Icon name={t.icon}/></div>
                    <div>
                      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:T.content.primary}}>{t.t}</div>
                      <div style={{fontFamily:D.body,fontSize:"11px",color:T.content.tertiary,marginTop:"2px"}}>{t.d}</div>
                    </div>
                  </div>
                ))}
              </div>
              {live&&submitError&&(
                <div role="alert" data-testid="onboard-submit-error" style={{marginTop:"16px",padding:"10px 14px",borderRadius:"10px",background:`${D.rose}14`,border:`1px solid ${D.rose}33`,fontFamily:D.body,fontSize:"12px",color:D.roseText,lineHeight:1.5}}>
                  {submitError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div style={{display:"flex",gap:"10px",marginTop:"14px",justifyContent:"flex-end",alignItems:"center"}}>
          {/* At step 0 there is nowhere to go "back" to within this flow — the
              only way out used to be closing the tab. A person who reached
              onboarding by mistake, or who already has an account, needs a
              real exit, not a dead end that only resolves by clearing their
              browser. onComplete(..., {requested:true}) is the same signal
              the "request sent" screen uses to return to sign-in, reused here
              so App.jsx has one path back to the login screen, not two. */}
          {step===0
            ? <button onClick={()=>onComplete(null, "", null, { requested:true })} className="pressBtn" style={{padding:"11px 22px",borderRadius:"14px",cursor:"pointer",background:"transparent",border:`1px solid ${T.line.normal}`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:T.content.tertiary}}>← Sign in instead</button>
            : <button onClick={()=>{setStep(s=>s-1);}} disabled={sending} className="pressBtn" style={{padding:"11px 22px",borderRadius:"14px",cursor:sending?"not-allowed":"pointer",background:"transparent",border:`1px solid ${T.line.normal}`,fontFamily:D.head,fontSize:"12px",fontWeight:700,color:T.content.tertiary,opacity:sending?0.5:1}}>← Back</button>}
          <div style={{flex:1}}/>
          <div style={{fontFamily:D.mono,fontSize:"10px",color:T.content.tertiary}}>{step+1} / {steps.length}</div>
          <button onClick={handleNext} disabled={(!canAdvance()&&stepId!=="tour")||sending} className="pressBtn" style={{
            padding:"11px 26px",borderRadius:"14px",cursor:(canAdvance()||stepId==="tour")&&!sending?"pointer":"not-allowed",
            background:(canAdvance()||stepId==="tour")&&!sending?T.light.action:T.fill.track,
            border:"none",fontFamily:D.head,fontSize:"12px",fontWeight:700,
            color:(canAdvance()||stepId==="tour")&&!sending?T.light.ink:T.content.tertiary,
            boxShadow:(canAdvance()||stepId==="tour")&&!sending?`0 4px 20px ${D.indigo}59`:"none",
            letterSpacing:"0.04em",transition:"all .2s",display:"inline-flex",alignItems:"center",gap:"8px",
          }}>
            {sending
              ? <><span className="live-dot" aria-hidden="true"/> Sending…</>
              : stepId==="tour" ? "Enter SCRBRD →"
              : !canAdvance()&&stepId==="role" ? "Select a role →"
              : "Continue →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export { OnboardingFlow };
