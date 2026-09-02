import { useState, useEffect } from "react";
import { NOTIFICATIONS } from "../data/mock.js";
import { ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { GlobalSearch } from "./GlobalSearch.jsx";

function TopBar({ role, onRoleChange, onNav, userName }) {
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
      {searchOpen&&<GlobalSearch onNav={onNav} onClose={()=>setSearchOpen(false)}/>}
      <div style={{height:"52px",background:D.surf0,borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",padding:"0 16px",gap:"10px",flexShrink:0,position:"sticky",top:0,zIndex:100}}>

        {/* Live match chip */}
        <button onClick={()=>onNav("matches")} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"6px",padding:"4px 10px",borderRadius:D.pill,background:D.emerald+"14",border:`1px solid ${D.emerald}30`,cursor:"pointer",flexShrink:0}}>
          <div className="live-dot"/><span style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.emerald,letterSpacing:"0.06em",whiteSpace:"nowrap"}}>LIVE</span>
        </button>

        {/* Search bar */}
        <button onClick={()=>setSearchOpen(true)} className="pressBtn" style={{flex:1,maxWidth:"420px",display:"flex",alignItems:"center",gap:"8px",padding:"7px 12px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,cursor:"pointer",textAlign:"left"}}>
          <span style={{fontSize:"13px",color:D.textMuted}}>🔍</span>
          <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,flex:1}}>Search or ask StatGuru…</span>
          <span className="os-kbd" style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,background:D.surf3,padding:"2px 6px",borderRadius:"4px",flexShrink:0}}>⌘K</span>
        </button>

        <div style={{flex:1}}/>

        {/* Notifications */}
        <button onClick={()=>onNav("notifications")} className="pressBtn" style={{position:"relative",background:"none",border:"none",cursor:"pointer",fontSize:"16px",flexShrink:0}}>
          🔔
          {unread>0&&<span style={{position:"absolute",top:"-2px",right:"-2px",background:D.rose,color:"#fff",borderRadius:D.pill,padding:"0 4px",fontFamily:D.mono,fontSize:"8px",fontWeight:700,minWidth:"14px",textAlign:"center"}}>{unread}</span>}
        </button>

        {/* Role switcher */}
        <div style={{position:"relative",flexShrink:0}}>
          <button onClick={()=>setRoleOpen(!roleOpen)} className="pressBtn" style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 10px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,cursor:"pointer"}}>
            <span style={{fontSize:"13px"}}>{ROLES[role]?.icon}</span>
            <span className="os-username" style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,maxWidth:"90px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName||ROLES[role]?.label}</span>
            <span style={{fontSize:"9px",color:D.textMuted}}>▼</span>
          </button>
          {roleOpen&&(
            <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:D.surf2,border:`1px solid ${D.borderMed}`,borderRadius:D.lg,overflow:"hidden",minWidth:"180px",zIndex:200,boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
              <div style={{padding:"8px 12px 4px",fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:D.textMuted}}>Switch Role (Demo)</div>
              {Object.entries(ROLES).map(([r,rc])=>(
                <button key={r} onClick={()=>{onRoleChange(r);setRoleOpen(false);}} className="pressBtn" style={{
                  width:"100%",padding:"8px 12px",display:"flex",alignItems:"center",gap:"8px",
                  background:role===r?rc.color+"18":"transparent",border:"none",cursor:"pointer",textAlign:"left",
                }}>
                  <span>{rc.icon}</span>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:role===r?rc.color:D.textSecondary}}>{rc.label}</span>
                  {role===r&&<span style={{marginLeft:"auto",width:"6px",height:"6px",borderRadius:"50%",background:rc.color}}/>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export { TopBar };
