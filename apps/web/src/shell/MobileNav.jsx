import { useState, useEffect } from "react";
import { NAV_META } from "../design/roles.js";
import { useNav } from "../lib/features.js";
import { D } from "../design/tokens.js";

// ══════════════════════════════════════════════════════
//  MAIN APP
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  SCRBRD OS SHELL — responsive helpers & mobile nav
// ══════════════════════════════════════════════════════
function useIsMobile(bp = 880) {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(`(max-width:${bp}px)`).matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width:${bp}px)`);
    const fn = e => setMobile(e.matches);
    mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn); };
  }, [bp]);
  return mobile;
}

const SPORTS = [
  { id:"cricket",  label:"CricketOS",  icon:"🏏", live:true  },
  { id:"football", label:"FootballOS", icon:"⚽",        live:false },
  { id:"rugby",    label:"RugbyOS",    icon:"🏉", live:false },
  { id:"hockey",   label:"HockeyOS",   icon:"🏑", live:false },
];

function SportSwitcher() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`,position:"relative"}}>
      <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,marginBottom:"6px"}}>ScrbrdOS · Sport</div>
      <button onClick={()=>setOpen(!open)} className="pressBtn" style={{width:"100%",display:"flex",alignItems:"center",gap:"8px",padding:"7px 10px",borderRadius:D.md,background:D.emerald+"10",border:`1px solid ${D.emerald}28`,cursor:"pointer"}}>
        <span style={{fontSize:"14px"}}>🏏</span>
        <span style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.emerald}}>CricketOS</span>
        <span style={{marginLeft:"auto",fontSize:"9px",color:D.textMuted}}>{open?"▴":"▾"}</span>
      </button>
      {open&&(
        <div style={{position:"absolute",left:"14px",right:"14px",top:"calc(100% - 4px)",zIndex:300,background:D.surf2,border:`1px solid ${D.borderMed}`,borderRadius:D.lg,overflow:"hidden",boxShadow:"0 12px 40px rgba(0,0,0,.5)"}}>
          {SPORTS.map(s=>(
            <button key={s.id} disabled={!s.live} onClick={()=>setOpen(false)} className="pressBtn" style={{width:"100%",display:"flex",alignItems:"center",gap:"8px",padding:"9px 12px",background:s.live?D.emerald+"10":"transparent",border:"none",cursor:s.live?"pointer":"default",opacity:s.live?1:.55}}>
              <span style={{fontSize:"13px"}}>{s.icon}</span>
              <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:s.live?600:400,color:s.live?D.textPrimary:D.textSecondary}}>{s.label}</span>
              {s.live
                ? <span style={{marginLeft:"auto",width:"6px",height:"6px",borderRadius:"50%",background:D.emerald}}/>
                : <span style={{marginLeft:"auto",fontFamily:D.head,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",color:D.amber,background:D.amber+"16",border:`1px solid ${D.amber}30`,borderRadius:D.pill,padding:"2px 6px"}}>SOON</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileNav({ role, active, onNav, notifCount }) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Same list the sidebar draws, from the same place. Two components computing
  // a menu two ways is how a destination comes to exist on a phone and not on
  // a laptop.
  const nav = useNav(role);
  const primary = nav.slice(0, 4);
  const rest = nav.slice(4);
  const moreActive = rest.includes(active);
  const Item = ({ k, isMore }) => {
    const m = isMore ? { icon:"☰", label:"More" } : NAV_META[k];
    const isActive = isMore ? moreActive : active===k;
    const isBell = k==="notifications";
    return (
      <button onClick={()=>{ isMore ? setMoreOpen(true) : (setMoreOpen(false), onNav(k)); }} className="pressBtn"
        aria-current={isActive&&!isMore?"page":undefined}
        aria-expanded={isMore?moreOpen:undefined}
        // The 8px uppercase label under each icon is decorative reinforcement.
        // Naming the button outright means it is announced once, properly,
        // rather than as an emoji followed by a shouted abbreviation.
        aria-label={isBell&&notifCount>0?`${m.label}, ${notifCount} unread`:m.label}
        style={{
        flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",padding:"7px 2px",
        background:isActive?D.indigo+"16":"transparent",border:"none",borderRadius:D.md,cursor:"pointer",position:"relative",minHeight:"52px",justifyContent:"center"}}>
        <span aria-hidden="true" style={{fontSize:"17px",lineHeight:1,filter:isActive?"none":"grayscale(.5) opacity(.75)"}}>{m.icon}</span>
        <span aria-hidden="true" style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:isActive?D.textPrimary:D.textSecondary}}>{m.label}</span>
        {isBell&&notifCount>0&&<span style={{position:"absolute",top:"4px",right:"calc(50% - 16px)",background:D.rose,color:"#fff",borderRadius:D.pill,padding:"0 4px",fontFamily:D.mono,fontSize:"8px",fontWeight:700,minWidth:"13px"}}>{notifCount}</span>}
      </button>
    );
  };
  return (
    <>
      {moreOpen&&(
        <>
          <div className="os-drawer-scrim" onClick={()=>setMoreOpen(false)}/>
          <div className="os-drawer">
            <div style={{width:"36px",height:"4px",borderRadius:D.pill,background:D.borderMed,margin:"0 auto 12px"}}/>
            <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,margin:"2px 4px 8px"}}>ScrbrdOS · Sport</div>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"14px"}}>
              {SPORTS.map(s=>(
                <span key={s.id} style={{display:"flex",alignItems:"center",gap:"5px",padding:"5px 10px",borderRadius:D.pill,fontFamily:D.head,fontSize:"9px",fontWeight:700,
                  background:s.live?D.emerald+"14":"transparent",border:`1px solid ${s.live?D.emerald+"33":D.border}`,color:s.live?D.emerald:D.textMuted}}>
                  {s.icon} {s.label}{!s.live&&<span style={{fontSize:"9px",color:D.amber}}>SOON</span>}
                </span>
              ))}
            </div>
            <div style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,margin:"2px 4px 8px"}}>All modules</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))",gap:"8px"}}>
              {nav.map(k=>{
                const m = NAV_META[k]; const isActive = active===k;
                return (
                  <button key={k} onClick={()=>{setMoreOpen(false);onNav(k);}} className="pressBtn" style={{
                    display:"flex",flexDirection:"column",alignItems:"center",gap:"6px",padding:"13px 6px",
                    background:isActive?D.indigo+"16":D.surf2,border:`1px solid ${isActive?D.indigo+"33":D.border}`,
                    borderRadius:D.lg,cursor:"pointer"}}>
                    <span style={{fontSize:"18px"}}>{m.icon}</span>
                    <span style={{fontFamily:D.body,fontSize:"10px",fontWeight:isActive?600:400,color:isActive?D.textPrimary:D.textSecondary}}>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <nav aria-label="Main" className="os-bottomnav">
        {primary.map(k=><Item key={k} k={k}/>)}
        {rest.length>0&&<Item k="__more" isMore/>}
      </nav>
    </>
  );
}

export { MobileNav, SPORTS, SportSwitcher, useIsMobile };
