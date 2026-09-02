import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { NAV_META, ROLES } from "../design/roles.js";
import { D } from "../design/tokens.js";
import { SportSwitcher } from "./MobileNav.jsx";

// ══════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════
function Sidebar({ role, active, onNav, collapsed, onToggle, notifCount }) {
  const nav = ROLES[role]?.nav || [];
  const rc  = ROLES[role];
  return (
    <div style={{
      width: collapsed ? "58px" : "210px",
      minHeight:"100vh", background:D.surf0,
      borderRight:`1px solid ${D.border}`,
      display:"flex", flexDirection:"column",
      transition:"width .25s cubic-bezier(.34,1.56,.64,1)",
      flexShrink:0, position:"sticky", top:0, height:"100vh", overflow:"hidden",
    }}>
      {/* Logo */}
      <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"10px",minHeight:"60px"}}>
        {collapsed
          ? <div style={{width:"30px",height:"30px",borderRadius:D.md,background:D.gradMain,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",flexShrink:0}}>🏏</div>
          : <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"28px",objectFit:"contain",filter:"brightness(1.1)",flexShrink:0,maxWidth:"120px"}}/>
        }
        <button onClick={onToggle} className="pressBtn" style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"14px",flexShrink:0}}>
          {collapsed?"›":"‹"}
        </button>
      </div>

      {/* Role badge */}
      {!collapsed&&(
        <div style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 10px",borderRadius:D.md,background:rc.color+"12",border:`1px solid ${rc.color}22`}}>
            <span style={{fontSize:"14px"}}>{rc.icon}</span>
            <div>
              <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:rc.color}}>{rc.label}</div>
              <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>Active role</div>
            </div>
          </div>
        </div>
      )}

      {/* Sport switcher — ScrbrdOS multi-sport shell */}
      {!collapsed&&<SportSwitcher/>}

      {/* Nav */}
      <nav style={{flex:1,padding:"8px 0",overflowY:"auto"}}>
        {nav.map(key=>{
          const m = NAV_META[key];
          const isActive = active===key;
          const isBell = key==="notifications";
          return (
            <button key={key} onClick={()=>onNav(key)} className="pressBtn" style={{
              width:"100%",padding:collapsed?"12px 0":"10px 14px",
              display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",
              background:isActive?D.indigo+"18":"transparent",
              border:`1px solid ${isActive?D.indigo+"33":"transparent"}`,
              borderRadius:collapsed?"0":D.md,
              margin:collapsed?"0":"1px 6px",
              width:collapsed?"100%":"calc(100% - 12px)",
              transition:"all .15s",
              position:"relative",
            }}>
              <span style={{fontSize:"15px",textAlign:"center",width:collapsed?"100%":"auto",color:isActive?ROLES[role].color:D.textSecondary}}>{m.icon}</span>
              {!collapsed&&<span style={{fontFamily:D.body,fontSize:"12px",fontWeight:isActive?600:400,color:isActive?D.textPrimary:D.textSecondary}}>{m.label}</span>}
              {isBell&&notifCount>0&&<span style={{marginLeft:"auto",background:D.rose,color:"#fff",borderRadius:D.pill,padding:"1px 6px",fontFamily:D.mono,fontSize:"9px",fontWeight:700}}>{notifCount}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom version */}
      {!collapsed&&<div style={{padding:"12px 14px",borderTop:`1px solid ${D.border}`}}>
        <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,letterSpacing:"0.06em"}}>ScrbrdOS v3.0 · CricketOS</div>
      </div>}
    </div>
  );
}

export { Sidebar };
