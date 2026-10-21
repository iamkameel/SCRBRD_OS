import { Suspense, lazy, useState, useEffect, useRef } from "react";
import { ROLES, ROLE_FAMILIES, canonicalRole } from "../design/roles.js";
import { D, T } from "../design/tokens.js";
import { useNotifications } from "../lib/notifications.js";
import { Icon } from "../ui/icons.jsx";

// Opened by a tap, so it is not in the first download (the entry chunk is held to a ceiling, tools/check-bundle.mjs).
const GlobalSearch = lazy(() => import("./GlobalSearch.jsx").then((m) => ({ default: m.GlobalSearch })));

function TopBar({ role, onRoleChange, onNav, userName }) {
  // The unread badge is the SERVER's count of the notices it agreed to send
  // this person (my_notifications, db/89), from the one store every badge
  // reads (lib/notifications.js). Counting client-side over rows the browser
  // filtered would put a number in the chrome that no policy ever produced —
  // and a count discloses as surely as a list does. Null while uncounted: no
  // badge rather than a number nobody counted.
  const { unread: counted } = useNotifications(role);
  const [roleOpen, setRoleOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const unread = counted ?? 0;
  const searchBtn = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const roleBtn = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const roleMenu = useRef(/** @type {HTMLDivElement | null} */ (null));

  // The role menu is a menu: focus moves to the chosen role when it opens, Escape closes it, and focus goes back to the
  // button that opened it. A tap outside closes it too, so it cannot be left open over the page (I32).
  useEffect(() => {
    if (!roleOpen) return;
    /** @type {HTMLElement | null | undefined} */ (roleMenu.current?.querySelector('[aria-checked="true"]') ?? roleMenu.current?.querySelector("button"))?.focus();
    const onKey = (/** @type {KeyboardEvent} */ e) => { if (e.key === "Escape") { e.stopPropagation(); setRoleOpen(false); roleBtn.current?.focus(); } };
    const away = (/** @type {Event} */ e) => { const t = /** @type {Node} */ (e.target); if (!roleMenu.current?.contains(t) && !roleBtn.current?.contains(t)) setRoleOpen(false); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", away); };
  }, [roleOpen]);
  // Closing the search gives focus back to the button that opened it.
  const closeSearch = () => { setSearchOpen(false); requestAnimationFrame(() => searchBtn.current?.focus()); };

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(()=>{
    const handler = e=>{ if((e.metaKey||e.ctrlKey)&&e.key==="k"){ e.preventDefault(); setSearchOpen(true); }};
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[]);

  return (
    <>
      {searchOpen&&<Suspense fallback={null}><GlobalSearch role={role} onNav={onNav} onClose={closeSearch}/></Suspense>}
      <div data-testid="topbar" className="os-glass os-topbar" style={{height:"52px",borderRadius:0,borderLeft:"none",borderRight:"none",borderTop:"none",display:"flex",alignItems:"center",padding:"0 16px",gap:"10px",flexShrink:0,position:"sticky",top:0,zIndex:100}}>

        {/* Live match chip */}
        <button onClick={()=>onNav("matches")} className="pressBtn" data-testid="topbar-live" aria-label="Live matches" style={{display:"flex",alignItems:"center",gap:"6px",padding:"4px 10px",minHeight:"44px",borderRadius:D.pill,background:D.emerald+"14",border:`1px solid ${D.emerald}30`,cursor:"pointer",flexShrink:0}}>
          <div className="live-dot"/><span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.emerald,letterSpacing:"0.06em",whiteSpace:"nowrap"}}>LIVE</span>
        </button>

        {/* Search bar */}
        <button ref={searchBtn} onClick={()=>setSearchOpen(true)} className="pressBtn os-search" data-testid="topbar-search" aria-label="Search, or ask Stats-Magic" style={{flex:1,maxWidth:"420px",display:"flex",alignItems:"center",gap:"8px",padding:"7px 12px",minHeight:"44px",minWidth:"44px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,cursor:"pointer",textAlign:"left"}}>
          <span style={{fontSize:"13px",color:D.textMuted}}><Icon name="search"/></span>
          <span className="os-search-text" style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,flex:1}}>Search or ask Stats-Magic…</span>
          <span className="os-kbd" style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted,background:D.surf3,padding:"2px 6px",borderRadius:"4px",flexShrink:0}}>⌘K</span>
        </button>

        <div style={{flex:1}}/>

        {/* Notifications */}
        <button onClick={()=>onNav("notifications")} className="pressBtn" data-testid="topbar-alerts" aria-label={unread>0?`Alerts, ${unread} unread`:"Alerts"} style={{position:"relative",display:"flex",alignItems:"center",justifyContent:"center",minWidth:"44px",minHeight:"44px",background:"none",border:"none",cursor:"pointer",fontSize:"16px",flexShrink:0,color:D.textSecondary}}>
          <Icon name="bell"/>
          {unread>0&&<span data-testid="topbar-alerts-badge" aria-hidden="true" style={{position:"absolute",top:"2px",right:"0",background:T.semantic.critical,color:T.surface.canvas,borderRadius:D.pill,padding:"0 4px",fontFamily:D.mono,fontSize:"12px",lineHeight:1.25,fontWeight:700,minWidth:"16px",textAlign:"center"}}>{unread}</span>}
        </button>

        {/* Role switcher */}
        <div style={{position:"relative",flexShrink:0}}>
          <button ref={roleBtn} onClick={()=>setRoleOpen(!roleOpen)} className="pressBtn" data-testid="topbar-role" aria-haspopup="menu" aria-expanded={roleOpen} aria-label={`${userName||ROLES[role]?.label}, switch role`} style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 10px",minHeight:"44px",minWidth:"44px",borderRadius:D.pill,background:D.surf2,border:`1px solid ${D.border}`,cursor:"pointer"}}>
            <span style={{fontSize:"13px",color:D.textSecondary}}><Icon name={ROLES[role]?.icon}/></span>
            <span className="os-username" style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,maxWidth:"90px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userName||ROLES[role]?.label}</span>
            <span aria-hidden="true" style={{fontSize:"12px",color:D.textMuted}}>▼</span>
          </button>
          {roleOpen&&(
            <div ref={roleMenu} role="menu" aria-label="Switch role" style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:T.surface.overlay,border:`1px solid ${T.line.normal}`,borderRadius:T.radius.lg,overflowY:"auto",minWidth:"210px",maxHeight:"min(70vh,520px)",zIndex:200,boxShadow:T.elevation.lg}}>
              <div style={{position:"sticky",top:0,background:T.surface.overlay,padding:"10px 12px 6px",borderBottom:`1px solid ${T.line.subtle}`,fontFamily:T.type.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:T.content.tertiary}}>Switch Role (Demo)</div>
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
                  <div style={{padding:"9px 12px 3px",fontFamily:T.type.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:T.content.tertiary}}>{family}</div>
                  {members.map(r=>{
                    const rc = ROLES[r];
                    const current = role===r||canonicalRole(role)===r;
                    return (
                      <button key={r} role="menuitemradio" aria-checked={current}
                        onClick={()=>{onRoleChange(r);setRoleOpen(false);roleBtn.current?.focus();}}
                        className="pressBtn os-state" data-testid={`role-option-${r}`} data-selected={current} style={{
                        width:"100%",padding:"8px 12px",minHeight:"44px",display:"flex",alignItems:"center",gap:"8px",
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
