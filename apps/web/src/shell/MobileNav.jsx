import { useState, useEffect, useRef } from "react";
import { NAV_META, groupNav } from "../design/roles.js";
import { useSports, sportBadge, sportsOn } from "../lib/features.js";
import { useMenuItems } from "../lib/homeNav.js";
import { D, T, inkOn, themed } from "../design/tokens.js";
import { Icon } from "../ui/icons.jsx";
import { invitationsWords } from "../lib/invitationCount.js";

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

// Icons only. This was the whole list — four sports with `live: true | false`
// beside them — which made a product decision about what the platform
// supports into a constant in a navigation component, and forced every
// partly-built sport into "SOON" even where its fixture half is finished and
// granted. The sports themselves now come from the database through
// useSports(); what stays here is presentation, which is what a component is
// for.
// Lucide has no ball for most of these, and a borrowed picture of the wrong
// sport is worse than a plain one: where there is no honest icon the sport
// wears the kit (`shirt`), and its name says which.
const SPORT_ICON = {
  cricket:"bat", netball:"volleyball", athletics:"footprints", swimming:"waves",
};
const BADGE_TONE = themed(() => ({ emerald:D.emerald, sky:D.sky, amber:D.amber }));

// `sports` is for a test to hand it the list; the shell leaves it out and the switcher reads the school's own.
function SportSwitcher({ sports: given = null } = {}) {
  const [open, setOpen] = useState(false);
  // Only the sports switched on: one that is off is hidden, not badged SOON.
  const read = sportsOn(useSports().sports);
  const sports = given ? sportsOn(given) : read;
  // A school that plays one sport has nothing to switch between: a drop-down there is a control that does nothing
  // (glossary review item 4), so it is not drawn. Nor is it while the list is unread or could not be read.
  if (sports.length < 2) return null;
  // The one on the button is the sport that is scorable (the one whose scorer's screen exists), else the first.
  const current = sports.find(s => s.engine === "scoring") ?? sports[0];
  return (
    <div data-testid="sport-switcher" style={{padding:"10px 14px",borderBottom:`1px solid ${D.border}`,position:"relative"}}>
      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,marginBottom:"6px"}}>ScrbrdOS · Sport</div>
      <button type="button" onClick={()=>setOpen(!open)} className="pressBtn" data-testid="sport-switcher-button" aria-expanded={open} style={{width:"100%",display:"flex",alignItems:"center",gap:"8px",padding:"7px 10px",minHeight:"44px",borderRadius:D.md,background:D.emerald+"10",border:`1px solid ${D.emerald}28`,cursor:"pointer"}}>
        <span style={{fontSize:"14px",color:D.emerald}}><Icon name={SPORT_ICON[current.code] ?? "shirt"}/></span>
        <span style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.emerald}}>{current.label}</span>
        <span aria-hidden="true" style={{marginLeft:"auto",fontSize:"12px",color:D.textMuted}}>{open?"▴":"▾"}</span>
      </button>
      {open&&(
        <div style={{position:"absolute",left:"14px",right:"14px",top:"calc(100% - 4px)",zIndex:300,background:D.surf2,border:`1px solid ${D.borderMed}`,borderRadius:D.lg,overflow:"hidden",boxShadow:T.elevation.lg}}>
          {sports.map(s=>{
            const b = sportBadge(s);
            const tone = BADGE_TONE[b.tone] ?? D.textMuted;
            return (
            <button type="button" key={s.code} disabled={!s.enabled} onClick={()=>setOpen(false)} className="pressBtn" data-testid={`sport-option-${s.code}`} style={{width:"100%",display:"flex",alignItems:"center",gap:"8px",padding:"9px 12px",minHeight:"44px",background:s.enabled?tone+"10":"transparent",border:"none",cursor:s.enabled?"pointer":"default",opacity:s.enabled?1:.55}}>
              <span style={{fontSize:"13px",color:s.enabled?D.textPrimary:D.textSecondary}}><Icon name={SPORT_ICON[s.code] ?? "shirt"}/></span>
              <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:s.enabled?600:400,color:s.enabled?D.textPrimary:D.textSecondary}}>{s.label}</span>
              <span style={{marginLeft:"auto",fontFamily:D.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.1em",color:tone,background:tone+"16",border:`1px solid ${tone}30`,borderRadius:D.pill,padding:"2px 6px"}}>{b.text}</span>
            </button>);
          })}
        </div>
      )}
    </div>
  );
}

function MobileNav({ role, active, onNav, notifCount, invites = 0, userName, onSignOut }) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Only the sports switched on, as the switcher above.
  const sports = sportsOn(useSports().sports);
  // Same list the sidebar draws, from the same place. Two components computing
  // a menu two ways is how a destination comes to exist on a phone and not on
  // a laptop.
  // `active` is the open page; the entry lit is its home's (design/homes.js entryFor).
  const { keys: nav, label, active: lit, ready } = useMenuItems(role, active);
  // The homes are the whole menu, at most five for anyone at a school (EXPERIENCE_PASS §1.2, Q1): five or fewer
  // all go on the bar and there is no More. A menu still longer than that (a director until the School home,
  // Slice 6) keeps four on the bar and the rest in the drawer.
  const primary = nav.length <= 5 ? nav : nav.slice(0, 4);
  const rest = nav.length <= 5 ? [] : nav.slice(4);
  const moreActive = rest.includes(lit);
  const meta = (/** @type {string} */ k) => ({ ...NAV_META[k], label: label(k) ?? NAV_META[k].label });
  // League invitations wait on Competitions, or on the entry it sits under (Matches) when it has none of its own.
  const invitesOn = nav.includes("competitions") ? "competitions" : nav.find((k) => k === "matches") ?? null;
  // League invitations waiting: on Competitions itself where it is one of the
  // four on the bar, otherwise on "More" and on its place in the drawer. The
  // count is the badge's text; the button is named with the words.
  const inviteBadge = (/** @type {number} */ n) => (
    <span data-testid="mnav-invites-badge" aria-hidden="true" style={{position:"absolute",top:"2px",right:"calc(50% - 20px)",background:T.semantic.warning,color:inkOn(T.semantic.warning),borderRadius:D.pill,padding:"0 5px",fontFamily:D.mono,fontSize:"12px",fontWeight:700,minWidth:"16px"}}>{n}</span>
  );
  // A persona's bar (step 4 §2.0) is four short words and no More, so its items
  // share the bar equally. A staff bar of five sizes each item to its word
  // instead, so "Dashboard" and "Newsfeed" keep their 12px (§3.2) on a 320px
  // phone, where five equal fifths are too narrow for them (I32).
  const roomy = rest.length === 0;
  const drawer = useRef(/** @type {HTMLDivElement | null} */ (null));
  // The drawer is a modal: focus moves in, Tab stays inside, Escape closes, and focus goes back to More. The buttons
  // below are drawn by a component made inside this render, so the one that opened it is a new node by now; More is
  // found again by its test id, not remembered.
  const closeMore = () => {
    setMoreOpen(false);
    requestAnimationFrame(() => /** @type {HTMLElement | null} */ (document.querySelector('[data-testid="mnav-more"]'))?.focus());
  };
  useEffect(() => {
    if (!moreOpen) return;
    drawer.current?.focus();
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") { e.stopPropagation(); closeMore(); return; }
      if (e.key !== "Tab" || !drawer.current) return;
      const f = [...drawer.current.querySelectorAll("button:not([disabled])")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer.current)) { e.preventDefault(); /** @type {HTMLElement} */ (last).focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); /** @type {HTMLElement} */ (first).focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [moreOpen]);
  const Item = ({ k, isMore }) => {
    const m = isMore ? { icon:"menu", label:"More" } : meta(k);
    const isActive = isMore ? moreActive : lit===k;
    const isBell = k==="notifications";
    const waiting = isMore ? (invitesOn && rest.includes(invitesOn) ? invites : 0) : (k===invitesOn ? invites : 0);
    const name = waiting>0 ? `${m.label}, ${invitationsWords(waiting)}` : isBell&&notifCount>0 ? `${m.label}, ${notifCount} unread` : m.label;
    return (
      <button onClick={()=>{ isMore ? setMoreOpen(true) : (setMoreOpen(false), onNav(k)); }} className="pressBtn"
        data-testid={isMore?"mnav-more":`mnav-${k}`}
        aria-current={isActive&&!isMore?"page":undefined}
        aria-expanded={isMore?moreOpen:undefined}
        // The label under each icon is decorative reinforcement. Naming the
        // button outright means it is announced once, properly, rather than
        // as an icon followed by its word.
        aria-label={name}
        style={{
        flex:roomy?1:"1 1 auto",minWidth:"44px",display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",padding:"7px 2px",
        background:isActive?D.indigo+"16":"transparent",border:"none",borderRadius:D.md,cursor:"pointer",position:"relative",minHeight:"52px",justifyContent:"center"}}>
        <span aria-hidden="true" style={{fontSize:"17px",lineHeight:1,color:isActive?D.textPrimary:D.textSecondary}}><Icon name={m.icon}/></span>
        <span aria-hidden="true" style={{fontFamily:D.body,fontSize:"12px",fontWeight:700,letterSpacing:"0",lineHeight:1.15,textAlign:"center",color:isActive?D.textPrimary:D.textSecondary}}>{m.label}</span>
        {isBell&&notifCount>0&&<span data-testid="mnav-alerts-badge" style={{position:"absolute",top:"4px",right:"calc(50% - 16px)",background:D.rose,color:inkOn(D.rose),borderRadius:D.pill,padding:"0 5px",fontFamily:D.mono,fontSize:"12px",fontWeight:700,minWidth:"16px"}}>{notifCount}</span>}
        {waiting>0&&inviteBadge(waiting)}
      </button>
    );
  };
  return (
    <>
      {moreOpen&&(
        <>
          <div className="os-drawer-scrim" data-testid="drawer-scrim" aria-hidden="true" onClick={closeMore}/>
          <div className="os-drawer" data-testid="drawer" ref={drawer} tabIndex={-1} role="dialog" aria-modal="true" aria-label="All modules">
            <div style={{width:"36px",height:"4px",borderRadius:D.pill,background:D.borderMed,margin:"0 auto 12px"}}/>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,margin:"2px 4px 8px"}}>ScrbrdOS · Sport</div>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"14px"}}>
              {sports.map(s=>{
                const b = sportBadge(s);
                const tone = BADGE_TONE[b.tone] ?? D.textMuted;
                return (
                <span key={s.code} style={{display:"flex",alignItems:"center",gap:"5px",padding:"5px 10px",borderRadius:D.pill,fontFamily:D.head,fontSize:"12px",fontWeight:700,
                  background:s.enabled?tone+"14":"transparent",border:`1px solid ${s.enabled?tone+"33":D.border}`,color:s.enabled?tone:D.textMuted}}>
                  <Icon name={SPORT_ICON[s.code] ?? "shirt"}/> {s.label}
                  <span style={{fontSize:"12px",color:tone}}>{b.text}</span>
                </span>);
              })}
            </div>
            {/* The same groups the sidebar draws, from the same place. */}
            {groupNav(nav).map(g=>(
              <div key={g.key} role="group" aria-labelledby={`drawer-group-${g.key}`} data-testid={`drawer-group-${g.key}`} style={{marginBottom:"12px"}}>
                <div id={`drawer-group-${g.key}`} style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",color:D.textMuted,margin:"2px 4px 8px"}}>{g.label}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))",gap:"8px"}}>
                  {g.items.map(k=>{
                    const m = meta(k); const isActive = lit===k;
                    const waiting = k===invitesOn ? invites : 0;
                    return (
                      <button key={k} onClick={()=>{setMoreOpen(false);onNav(k);}} className="pressBtn"
                        data-testid={`drawer-${k}`} aria-current={isActive?"page":undefined}
                        aria-label={waiting>0?`${m.label}, ${invitationsWords(waiting)}`:undefined} style={{
                        position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:"6px",padding:"13px 6px",
                        background:isActive?D.indigo+"16":D.surf2,border:`1px solid ${isActive?D.indigo+"33":D.border}`,
                        borderRadius:D.lg,cursor:"pointer"}}>
                        <span style={{fontSize:"18px",color:isActive?D.textPrimary:D.textSecondary}}><Icon name={m.icon}/></span>
                        <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:isActive?600:400,color:isActive?D.textPrimary:D.textSecondary}}>{m.label}</span>
                        {waiting>0&&inviteBadge(waiting)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* The way out lives here on a phone, for the same reason it lives
                at the foot of the rail on a laptop: the drawer is where the
                whole menu is, and a sign-out that exists on one of the two
                surfaces is a sign-out half the people cannot reach. */}
            <div style={{borderTop:`1px solid ${D.border}`,marginTop:"4px",paddingTop:"12px"}}>
              <button onClick={()=>{setMoreOpen(false);onSignOut?.();}} className="pressBtn"
                data-testid="drawer-signout" aria-label="Sign out"
                style={{width:"100%",display:"flex",alignItems:"center",gap:"10px",padding:"13px 12px",
                  background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.lg,cursor:"pointer"}}>
                <span aria-hidden="true" style={{fontSize:"16px",color:D.textSecondary}}><Icon name="log-out"/></span>
                <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>Sign out</span>
                {userName&&<span style={{marginLeft:"auto",fontFamily:D.body,fontSize:"12px",color:D.textMuted,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"45%"}}>{userName}</span>}
              </button>
            </div>
          </div>
        </>
      )}
      <nav aria-label="Main" className="os-bottomnav" data-testid="mnav" data-menu-ready={ready ? "true" : "false"}>
        {primary.map(k=><Item key={k} k={k}/>)}
        {rest.length>0&&<Item k="__more" isMore/>}
      </nav>
    </>
  );
}

export { MobileNav, SPORT_ICON, SportSwitcher, useIsMobile };
