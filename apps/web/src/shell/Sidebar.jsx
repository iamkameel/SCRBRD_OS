import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { NAV_META, ROLES, groupNav } from "../design/roles.js";
import { useNav } from "../lib/features.js";
import { D } from "../design/tokens.js";
import { SportSwitcher } from "./MobileNav.jsx";

// ══════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════
function Sidebar({ role, active, onNav, collapsed, onToggle, notifCount }) {
  // The role's destinations, narrowed by the modules this school has on.
  // Narrowed only — useNav() cannot add a destination the role did not hold.
  const nav = useNav(role);
  const rc  = ROLES[role];
  // Drawn group by group. The grouping is presentation over a list that has
  // already been narrowed twice (capability, then module); it adds nothing.
  const groups = groupNav(nav);
  return (
    <div data-testid="sidebar" data-collapsed={collapsed ? "true" : "false"} style={{
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
        <button onClick={onToggle} className="pressBtn" data-testid="sidebar-toggle" aria-label={collapsed?"Expand navigation":"Collapse navigation"} aria-expanded={!collapsed} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"14px",flexShrink:0}}>
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

      {/* Nav — one landmark, one group per section. A heading names each
          section for sighted readers; role="group" + aria-labelledby names it
          for everybody else, so a screen reader hears "People, group" before
          the entries rather than twenty-two entries in a row. Collapsed, the
          heading has no room and becomes a rule between sections. */}
      <nav aria-label="Main" data-testid="nav" style={{flex:1,padding:"8px 0",overflowY:"auto"}}>
        {groups.map((g, gi)=>(
          <div key={g.key} role="group" aria-labelledby={`nav-group-${g.key}`} data-testid={`nav-group-${g.key}`}>
            {collapsed
              ? (gi>0&&<div aria-hidden="true" style={{height:"1px",background:D.border,margin:"6px 12px"}}/>)
              : <div id={`nav-group-${g.key}`} style={{fontFamily:D.head,fontSize:"8px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,padding:gi>0?"12px 20px 4px":"4px 20px 4px"}}>{g.label}</div>}
            {collapsed&&<span id={`nav-group-${g.key}`} hidden>{g.label}</span>}
            {g.items.map(key=>{
              const m = NAV_META[key];
              const isActive = active===key;
              const isBell = key==="notifications";
              return (
                <button key={key} onClick={()=>onNav(key)} className="pressBtn"
                  data-testid={`nav-${key}`}
                  // aria-current tells a screen reader which page it is ALREADY
                  // on. Without it the active state is a background tint and
                  // nothing else — every entry announces identically, so the only
                  // way to find out where you are is to navigate somewhere.
                  aria-current={isActive?"page":undefined}
                  aria-label={collapsed?m.label:undefined}
                  style={{
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
                  {isBell&&notifCount>0&&<span data-testid="nav-alerts-badge" style={{marginLeft:"auto",background:D.rose,color:"#fff",borderRadius:D.pill,padding:"1px 6px",fontFamily:D.mono,fontSize:"9px",fontWeight:700}}>{notifCount}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom version */}
      {!collapsed&&<div style={{padding:"12px 14px",borderTop:`1px solid ${D.border}`}}>
        <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,letterSpacing:"0.06em"}}>ScrbrdOS v3.0 · CricketOS</div>
      </div>}
    </div>
  );
}

export { Sidebar };
