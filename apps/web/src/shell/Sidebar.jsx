import pkg from "../../package.json";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { NAV_META, ROLES, groupNav } from "../design/roles.js";
import { useNav } from "../lib/features.js";
import { D, T, inkOn } from "../design/tokens.js";
import { invitationsWords } from "../lib/league.js";
import { SportSwitcher } from "./MobileNav.jsx";
import { Icon } from "../ui/icons.jsx";

// ══════════════════════════════════════════════════════
//  SIDEBAR
// ══════════════════════════════════════════════════════
function Sidebar({ role, active, onNav, collapsed, onToggle, notifCount, invites = 0, userName, onSignOut, persona = null }) {
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
          ? <div style={{width:"30px",height:"30px",borderRadius:D.md,background:D.gradMain,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",flexShrink:0}}><Icon name="bat"/></div>
          : <img src={SCRBRD_LOGO} alt="SCRBRD" style={{height:"28px",objectFit:"contain",filter:"brightness(1.1)",flexShrink:0,maxWidth:"120px"}}/>
        }
        <button onClick={onToggle} className="pressBtn" data-testid="sidebar-toggle" aria-label={collapsed?"Expand navigation":"Collapse navigation"} aria-expanded={!collapsed} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"14px",flexShrink:0}}>
          {collapsed?"›":"‹"}
        </button>
      </div>

      {/* The role badge used to sit HERE, a bordered block between the logo and
          the sport switcher, pushing the first destination a third of the way
          down the rail. It says who you are, which belongs with the way to
          stop being them — so it moved to the foot, next to Sign out, where
          every other application puts it and where it costs the navigation
          nothing. */}

      {/* Sport switcher — ScrbrdOS multi-sport shell. Not on a family's or a
          pupil's rail (step 4 §2.0): their app is four destinations about
          one child, and a choice of sport is the school's, not theirs. */}
      {!collapsed&&!persona&&<SportSwitcher/>}

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
              // League invitations waiting for an answer: the count is the
              // badge's text, and the button is named with the words, so it is
              // read as "Competitions, 2 league invitations waiting".
              const waiting = key==="competitions" ? invites : 0;
              const name = waiting>0 ? `${m.label}, ${invitationsWords(waiting)}` : collapsed ? m.label : undefined;
              return (
                <button key={key} onClick={()=>onNav(key)}
                  data-testid={`nav-${key}`}
                  // aria-current tells a screen reader which page it is ALREADY
                  // on. Without it the active state is a background tint and
                  // nothing else — every entry announces identically, so the only
                  // way to find out where you are is to navigate somewhere.
                  aria-current={isActive?"page":undefined}
                  aria-label={name}
                  // os-state is the Material 3 state layer (§20): hover and
                  // press are one mechanism defined against the CONTENT colour,
                  // so every destination behaves identically without each one
                  // carrying its own hover rule.
                  className="pressBtn os-state"
                  data-selected={isActive}
                  style={{
                  padding:collapsed?"12px 0":"10px 14px",
                  display:"flex",alignItems:"center",gap:"10px",cursor:"pointer",
                  // The selected destination is marked by a rail against its
                  // leading edge — the M3 navigation-rail indicator — rather
                  // than by a tinted box. A tint has to be strong enough to see
                  // and therefore strong enough to compete with the content;
                  // a 2px bar is unambiguous at any strength.
                  background:isActive?T.surface.interactive:"transparent",
                  border:"1px solid transparent",
                  borderLeft:`2px solid ${isActive?rc.color:"transparent"}`,
                  borderRadius:collapsed?"0":T.radius.md,
                  margin:collapsed?"0":"1px 6px",
                  width:collapsed?"100%":"calc(100% - 12px)",
                  transition:`all ${T.motion.micro} ${T.motion.swift}`,
                  position:"relative",
                }}>
                  <span style={{fontSize:"15px",textAlign:"center",width:collapsed?"100%":"auto",color:isActive?rc.color:T.content.secondary}}><Icon name={m.icon}/></span>
                  {!collapsed&&<span style={{fontFamily:T.type.body,fontSize:"12px",fontWeight:isActive?600:400,color:isActive?T.content.primary:T.content.secondary}}>{m.label}</span>}
                  {isBell&&notifCount>0&&<span data-testid="nav-alerts-badge" style={{marginLeft:"auto",background:T.semantic.critical,color:T.surface.canvas,borderRadius:T.radius.pill,padding:"1px 6px",fontFamily:T.type.mono,fontSize:"9px",fontWeight:700}}>{notifCount}</span>}
                  {waiting>0&&<span data-testid="nav-invites-badge" aria-hidden="true" style={{marginLeft:collapsed?0:"auto",position:collapsed?"absolute":"static",top:"2px",right:"2px",background:T.semantic.warning,color:inkOn(T.semantic.warning),borderRadius:T.radius.pill,padding:"1px 6px",fontFamily:T.type.mono,fontSize:"12px",fontWeight:700}}>{waiting}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Who you are, and the way out ──────────────────────────
          There was no way out of the shell at all. signOut() existed and was
          reachable from exactly one screen — the holding page shown to somebody
          whose requests are still with the school — so anybody who actually got
          in stayed in until they cleared their browser. On a school's shared
          tablet that is not a missing convenience, it is the previous person's
          session still standing. */}
      <div style={{borderTop:`1px solid ${D.border}`,padding:collapsed?"8px 0":"10px 10px"}}>
        {!collapsed&&(
          <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 8px",marginBottom:"6px"}}>
            <span aria-hidden="true" style={{fontSize:"14px",flexShrink:0}}><Icon name={rc.icon}/></span>
            <div style={{minWidth:0,flex:1}}>
              {/* The NAME first and the role under it. The top bar carries the
                  same pair the other way up, because there it is a control for
                  changing role and the role is the subject; here it is a
                  statement of who is signed in. */}
              <div style={{fontFamily:T.type.body,fontSize:"11px",fontWeight:600,color:T.content.primary,
                           overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName || rc.label}</div>
              <div style={{fontFamily:T.type.body,fontSize:"10px",color:rc.color,
                           overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{rc.label}</div>
            </div>
          </div>
        )}
        {/* sidebar-signout, NOT nav-signout. `nav-<key>` means a navigation
            DESTINATION: the screen sweep in tools/smoke-browser-read.mjs
            enumerates them by that prefix and visits each one. Named nav-*,
            this button was swept up as a twenty-second destination, clicked,
            and signed the sweep out mid-run — three roles reported "signout:
            landed on null". It is a control, like sidebar-toggle beside it. */}
        <button onClick={onSignOut} className="pressBtn os-state" data-testid="sidebar-signout"
          aria-label="Sign out"
          style={{
            width:collapsed?"100%":"calc(100% - 4px)",
            margin:collapsed?"0":"0 2px",
            padding:collapsed?"12px 0":"8px 10px",
            display:"flex",alignItems:"center",justifyContent:collapsed?"center":"flex-start",gap:"10px",
            background:"transparent",border:`1px solid ${D.border}`,borderRadius:T.radius.md,
            cursor:"pointer",transition:`all ${T.motion.micro} ${T.motion.swift}`,
          }}>
          <span aria-hidden="true" style={{fontSize:"14px",color:T.content.secondary}}><Icon name="log-out"/></span>
          {!collapsed&&<span style={{fontFamily:T.type.body,fontSize:"12px",color:T.content.secondary}}>Sign out</span>}
        </button>
        {/* Kept, because "what version are you on?" is the first question of
            every support conversation — but demoted from its own bordered
            block to one line nobody has to read. */}
        {!collapsed&&<div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,letterSpacing:"0.06em",padding:"8px 8px 0"}}>SCRBRD v{pkg.version} · CricketOS</div>}
      </div>
    </div>
  );
}

export { Sidebar };
