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

  // Every line below describes something built on this branch. Add a line only
  // when the screen or route behind it exists; the code is the source.
  const LEAD = [
    { icon:"scorebook", title:"Live scoring that works offline",
      desc:"Score every ball on a phone. The pad keeps working with no signal and sends the balls when the network returns. Hand the match to another scorer mid-innings." },
    { icon:"tv", title:"Match Centre and pavilion display",
      desc:"Follow a match ball by ball, with commentary written from the scorer's events. Put the score on a ground screen. The display shows what the public page shows, and no more." },
    { icon:"scale", title:"Playing conditions per competition",
      desc:"Each competition sets its own conditions. Every figure shows where it came from, and every version stays on record." },
    { icon:"users", title:"Squad and availability",
      desc:"Pick the side, see who is available, and follow each player's skills and development." },
    { icon:"heart-pulse", title:"Bowling workload within the directives",
      desc:"Spells are counted against the age-group limits. Breaches show up, each tied to the rule it breaks. Health data needs a parent's consent." },
    { icon:"van", title:"Parent lift clubs",
      desc:"Parents offer and ask for seats to fixtures. The school signs a lift policy. Every driver signs a declaration before driving." },
    { icon:"shield-check", title:"Safeguarding built in",
      desc:"Anyone signed in can raise a concern with the school's Designated Safeguarding Officers. Only they can read it, and every read is logged." },
    { icon:"lock", title:"Privacy for minors",
      desc:"A child's name is public only with consent. Without it, the public page says \"Batter\"." },
  ];
  const ALSO = [
    "Wagon wheel and dismissal analysis",
    "Medical clearance and injury records",
    "Transport, venues and the kit register",
    "Fixtures, training and events in one calendar",
    "Standings, brackets and top performers",
    "Notices for players, parents and staff",
  ];

  const head = {fontFamily:T.type.head,margin:0};
  const body = {fontFamily:T.type.body,margin:0};
  const btn = {minHeight:"44px",padding:"0 20px",borderRadius:T.radius.pill,cursor:"pointer",fontFamily:T.type.head,fontSize:"14px",fontWeight:700,display:"inline-flex",alignItems:"center",justifyContent:"center"};
  const solid = {...btn,background:T.light.action,border:"none",color:T.light.ink,boxShadow:`0 4px 20px ${clr(T.brand.blue,0.4)}`};
  const ghost = {...btn,background:"transparent",border:`1px solid ${T.line.strong}`,color:T.content.secondary};

  return (
    <div style={{minHeight:"100vh",background:T.surface.canvas,display:"flex",flexDirection:"column",overflowX:"hidden"}}>
      <header style={{display:"flex",alignItems:"center",flexWrap:"wrap",gap:T.space.sm,padding:`${T.space.md} ${T.space.lg}`,borderBottom:`1px solid ${T.line.subtle}`,position:"sticky",top:0,background:T.glass.film,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",zIndex:10}}>
        <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"26px",objectFit:"contain",filter:"brightness(1.15)"}}/>
        <div style={{marginLeft:"auto",display:"flex",gap:T.space.sm}}>
          <button onClick={onLogin} className="pressBtn" style={ghost}>Log In</button>
          <button onClick={onEnter} className="pressBtn" style={solid}>Get Started</button>
        </div>
      </header>

      <main style={{flex:1}}>
        <section style={{textAlign:"center",padding:`${T.space.huge} ${T.space.lg} ${T.space.xxl}`,maxWidth:"860px",margin:"0 auto"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:T.space.sm,padding:"8px 16px",borderRadius:T.radius.pill,background:clr(T.brand.blue,0.12),border:`1px solid ${clr(T.brand.blue,0.3)}`,marginBottom:T.space.xl}}>
            <span aria-hidden="true" style={{width:"6px",height:"6px",borderRadius:"50%",background:T.brand.blue}}/>
            <span style={{fontFamily:T.type.head,fontSize:"12px",fontWeight:700,color:T.brand.blueText,letterSpacing:"0.08em",textTransform:"uppercase"}}>KZN school cricket pilot</span>
          </div>
          <h1 style={{...head,fontSize:"clamp(32px,7vw,64px)",fontWeight:800,color:T.content.primary,lineHeight:1.08,letterSpacing:"-0.02em",marginBottom:T.space.lg}}>
            School cricket, scored live
            <span style={{display:"block",color:T.brand.accentText}}>and kept safe.</span>
          </h1>
          <p style={{...body,fontSize:"17px",color:T.content.secondary,lineHeight:1.65,maxWidth:"580px",margin:`0 auto ${T.space.xl}`}}>
            SCRBRD runs a school's cricket from the pavilion to the parent's phone. Scorers score offline. Coaches pick the side. Parents see their child's fixtures. Children's names stay private unless a parent agrees.
          </p>
          <div style={{display:"flex",gap:T.space.md,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={onEnter} className="pressBtn" style={{...solid,padding:"0 32px"}}>Get Started</button>
            <button onClick={onLogin} className="pressBtn" style={{...ghost,padding:"0 32px"}}>Log In to My School</button>
          </div>
        </section>

        <section aria-labelledby="lp-lead" style={{padding:`${T.space.xl} ${T.space.lg} ${T.space.xxl}`,maxWidth:"1040px",margin:"0 auto",width:"100%",boxSizing:"border-box"}}>
          <h2 id="lp-lead" style={{...head,fontSize:"12px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:T.content.tertiary,textAlign:"center",marginBottom:T.space.xl}}>What makes SCRBRD different</h2>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,250px),1fr))",gap:T.space.md}}>
            {LEAD.map((f)=>(
              <article key={f.title} style={{borderRadius:T.radius.lg,border:`1px solid ${T.line.subtle}`,background:T.fill.panel,padding:T.space.xl}}>
                <div aria-hidden="true" style={{fontSize:"26px",marginBottom:T.space.md,color:T.brand.blueText,display:"flex"}}><Icon name={f.icon}/></div>
                <h3 style={{...head,fontSize:"16px",fontWeight:700,color:T.content.primary,marginBottom:T.space.sm,lineHeight:1.3}}>{f.title}</h3>
                <p style={{...body,fontSize:"14px",color:T.content.secondary,lineHeight:1.55}}>{f.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="lp-also" style={{padding:`0 ${T.space.lg} ${T.space.huge}`,maxWidth:"760px",margin:"0 auto",width:"100%",boxSizing:"border-box"}}>
          <h2 id="lp-also" style={{...head,fontSize:"12px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:T.content.tertiary,textAlign:"center",marginBottom:T.space.lg}}>Also in the pilot</h2>
          <ul style={{listStyle:"none",margin:0,padding:0,display:"flex",flexWrap:"wrap",gap:T.space.sm,justifyContent:"center"}}>
            {ALSO.map((a)=>(
              <li key={a} style={{...body,fontSize:"14px",color:T.content.secondary,padding:"8px 14px",borderRadius:T.radius.pill,border:`1px solid ${T.line.normal}`,background:T.fill.panel}}>{a}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer style={{borderTop:`1px solid ${T.line.subtle}`,padding:`${T.space.xl} ${T.space.lg}`,textAlign:"center"}}>
        <img src={SCRBRD_LOGO} alt="" style={{height:"18px",objectFit:"contain",opacity:0.35,filter:"grayscale(1) brightness(2)",display:"block",margin:`0 auto ${T.space.md}`}}/>
        <div style={{fontFamily:T.type.mono,fontSize:"12px",color:T.content.tertiary,letterSpacing:"0.04em"}}>© 2026 SCRBRD · School Cricket Intelligence Platform</div>
        <div style={{marginTop:T.space.md,fontFamily:T.type.mono,fontSize:"12px",color:T.content.tertiary,letterSpacing:"0.02em",display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"center",gap:T.space.sm}}>
          <span>Anonymous usage analytics: <strong>{analytics ? "on" : "off"}</strong></span>
          <button onClick={toggleAnalytics} role="switch" aria-checked={analytics} data-testid="analytics-consent" className="pressBtn"
            style={{minHeight:"44px",minWidth:"44px",padding:"0 16px",borderRadius:T.radius.pill,cursor:"pointer",background:"transparent",border:`1px solid ${T.line.strong}`,fontFamily:T.type.mono,fontSize:"12px",color:T.content.secondary}}>
            {analytics ? "Turn off" : "Turn on"}
          </button>
          {analytics && <span>— stops on your next visit if turned off</span>}
        </div>
      </footer>
    </div>
  );
}

export { LandingPage };
