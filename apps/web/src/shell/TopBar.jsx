import { useState, useEffect } from "react";
import { ROLES, ROLE_FAMILIES, canonicalRole } from "../design/roles.js";
import { D, T } from "../design/tokens.js";
import { GlobalSearch } from "./GlobalSearch.jsx";
import { useRows } from "../lib/live.js";
import { Icon } from "../ui/icons.jsx";

function TopBar({ role, onRoleChange, onNav, userName }) {
  // The unread badge is built from the notices the SERVER agreed to send.
  // Counting client-side over rows the browser filtered would put a number in
  // the chrome that no policy ever produced — and a count discloses as surely
  // as a list does.
  const NOTIFICATIONS = useRows("notifications", role);
  const [roleOpen, setRoleOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const unread = NOTIFICATIONS.filter(n=>!n.read).length;

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(()=>{
    const handler = e=>{ if((e.metaKey||e.ctrlKey)&&e.key==="k"){ e.preventDefault(); setSearchOpen(true); }};
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[]);

  return (
    <>
      {searchOpen&&<GlobalSearch role={role} onNav={onNav} onClose={()=>setSearchOpen(false)}/>}
      <div data-testid="topbar" className="os-glass" style={{height:"52px",borderRadius:0,borderLeft:"none",borderRight:"none",borderTop:"none",display:"flex",alignItems:"center",padding:"0 16px",gap:"10px",flexShrink:0,position:"sticky",top:0,zIndex:100}}>

        {/* Live match chip */}
        <button onClick={()=>onNav("matches")} className="pressBtn" data-testid="topbar-live" aria-label="Live matches" style={{display:"flex",alignItems:"center",gap:"6px",padding:"4px 10px",borderRadius:D.pill,background:D.emerald+"14",border:`1px solid ${D.emerald}30`,cursor:"pointer",flexShrink:0}}>
          <div className="live-dot"/><span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.emerald,letterSpacing:"0.06em",whiteSpace:"nowrap"}}>LIVE</span>
        </button>

        {/* Search bar */}
        <button onClick={()=>setSearchOpen(true)} className="pressBtn" data-testid="topbar-search" style={{flex:1,maxWidth:"420px",display:"flex",alignItems:"center",gap:"8px",padding:"7px 12px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,cursor:"pointer",textAlign:"left"}}>
          <span style={{fontSize:"13px",color:D.textMuted}}><Icon name="search"/></span>
          <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,flex:1}}>Search or ask Stats-Magic…</span>
          <span className="os-kbd" style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,background:D.surf3,padding:"2px 6px",borderRadius:"4px",flexShrink:0}}>⌘K</span>
        </button>

        <div style={{flex:1}}/>

        {/* Notifications */}
        <button onClick={()=>onNav("notifications")} className="pressBtn" data-testid="topbar-alerts" aria-label={unread>0?`Alerts, ${unread} unread`:"Alerts"} style={{position:"relative",background:"none",border:"none",cursor:"pointer",fontSize:"16px",flexShrink:0,color:D.textSecondary}}>
          <Icon name="bell"/>
          {unread>0&&<span style={{position:"absolute",top:"-2px",right:"-2px",background:T.semantic.critical,color:T.surface.canvas,borderRadius:D.pill,padding:"0 4px",fontFamily:D.mono,fontSize:"8px",fontWeight:700,minWidth:"14px",textAlign:"center"}}>{unread}</span>}
        </button>

        {/* Role switcher */}
        <div style={{position:"relative",flexShrink:0}}>
          <button onClick={()=>setRoleOpen(!roleOpen)} className="pressBtn" data-testid="topbar-role" aria-haspopup="menu" aria-expanded={roleOpen} style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 10px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,cursor:"pointer"}}>
            <span style={{fontSize:"13px",color:D.textSecondary}}><Icon name={ROLES[role]?.icon}/></span>
            <span className="os-username" style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,maxWidth:"90px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName||ROLES[role]?.label}</span>
            <span style={{fontSize:"9px",color:D.textMuted}}>▼</span>
          </button>
          {roleOpen&&(
            <div role="menu" aria-label="Switch role" style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:T.surface.overlay,border:`1px solid ${T.line.normal}`,borderRadius:T.radius.lg,overflowY:"auto",minWidth:"210px",maxHeight:"min(70vh,520px)",zIndex:200,boxShadow:T.elevation.lg}}>
              <div style={{position:"sticky",top:0,background:T.surface.overlay,padding:"10px 12px 6px",borderBottom:`1px solid ${T.line.subtle}`,fontFamily:T.type.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.content.tertiary}}>Switch Role (Demo)</div>
              {/* Grouped by family, and ONE ENTRY PER ROLE.
                  This menu used to iterate ROLES, which is the LOOKUP table:
                  twenty-four real roles plus nine demonstration aliases that
                  resolve to them. Every alias carries its target's own label,
                  so the list rendered "Platform Admin" three times, "Principal"
                  twice, and six more duplicated pairs — thirty-three rows for
                  twenty-four roles, with no way to tell the copies apart.
                  ROLE_IDENTITY is the canonical set; the aliases stay in ROLES
                  so an account signed in as one still resolves to a name and a
                  navigation. */}
              {Object.entries(ROLE_FAMILIES).map(([family,members])=>(
                <div key={family} role="group" aria-label={family}>
                  <div style={{padding:"9px 12px 3px",fontFamily:T.type.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:T.content.tertiary}}>{family}</div>
                  {members.map(r=>{
                    const rc = ROLES[r];
                    const current = role===r||canonicalRole(role)===r;
                    return (
                      <button key={r} role="menuitemradio" aria-checked={current}
                        onClick={()=>{onRoleChange(r);setRoleOpen(false);}}
                        className="pressBtn os-state" data-testid={`role-option-${r}`} data-selected={current} style={{
                        width:"100%",padding:"8px 12px",display:"flex",alignItems:"center",gap:"8px",
                        background:current?T.surface.interactive:"transparent",border:"none",cursor:"pointer",textAlign:"left",
                      }}>
                        <span aria-hidden="true" style={{color:T.content.secondary}}><Icon name={rc.icon}/></span>
                        <span style={{fontFamily:T.type.body,fontSize:"12px",color:current?rc.color:T.content.secondary}}>{rc.label}</span>
                        {current&&<span aria-hidden="true" style={{marginLeft:"auto",width:"6px",height:"6px",borderRadius:"50%",background:rc.color}}/>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export { TopBar };
