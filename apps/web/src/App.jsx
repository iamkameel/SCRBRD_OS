/**
 * SCRBRD OS — application root.
 *
 * Owns app-level state (auth phase, role, page) and routes the 19 navigation
 * destinations to their view components. Views read data through getData() in
 * rbac/, never from the mock constants directly.
 */
import { useState, useEffect, useRef } from "react";
import ScorerApp from "./scorer/index.jsx";
import { LandingPage } from "./auth/LandingPage.jsx";
import { LoginPage } from "./auth/LoginPage.jsx";
import { OnboardingFlow } from "./auth/OnboardingFlow.jsx";
import { ROLES } from "./design/roles.js";
import { D, GLOBAL_CSS } from "./design/tokens.js";
import { canScore, scoped } from "./rbac/index.js";
import { api, signedIn } from "./lib/api.js";
import { useLive, useRows } from "./lib/live.js";
import { MobileNav, useIsMobile } from "./shell/MobileNav.jsx";
import { Sidebar } from "./shell/Sidebar.jsx";
import { TopBar } from "./shell/TopBar.jsx";
import { AnalyticsView } from "./views/AnalyticsView.jsx";
import { CalendarView } from "./views/CalendarView.jsx";
import { CompetitionsView } from "./views/CompetitionsView.jsx";
import { DashboardView } from "./views/DashboardView.jsx";
import { FieldsView } from "./views/FieldsView.jsx";
import { InjuryView } from "./views/InjuryView.jsx";
import { LeagueView } from "./views/LeagueView.jsx";
import { LogisticsView } from "./views/LogisticsView.jsx";
import { ManagementView } from "./views/ManagementView.jsx";
import { MatchCentreView } from "./views/MatchCentreView.jsx";
import { NotificationsView } from "./views/NotificationsView.jsx";
import { OfficialsView } from "./views/OfficialsView.jsx";
import { SponsorsView } from "./views/SponsorsView.jsx";
import { ModulesView } from "./views/ModulesView.jsx";
import { PitchDeckView } from "./views/PitchDeckView.jsx";
import { ProfilesView } from "./views/ProfilesView.jsx";
import { RulebookView } from "./views/RulebookView.jsx";
import { SettingsView } from "./views/SettingsView.jsx";
import { SkillsView } from "./views/SkillsView.jsx";
import { SquadView } from "./views/SquadView.jsx";
import { StaffView } from "./views/StaffView.jsx";
import { TrainingView } from "./views/TrainingView.jsx";
import { parseBalls, parseScore, teamSquad } from "./views/shared.jsx";
import { loadSession, saveSession } from "./lib/persist.js";
import { signOut } from "./lib/session.js";

// What a person with no assignments sees: their requests, each with its
// state, and nothing of the school's. Rows come from the server under the
// request's own policy (mine, or ones I could answer — and they can answer
// none).
function PendingRequests({ name, onSignOut }) {
  const [nudge, setNudge] = useState(0);
  const rows = useLive("role_requests", "spectator", nudge).rows;
  const withdraw = async (id) => { await api(`/api/requests/${id}/withdraw`, { method: "POST" }).catch(() => {}); setNudge((n) => n + 1); };
  return (
    <div data-testid="pending-requests" style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px",background:D.bg}}>
      <div style={{maxWidth:"480px",width:"100%"}}>
        <div style={{fontFamily:D.head,fontSize:"20px",fontWeight:800,color:D.textPrimary,marginBottom:"4px"}}>Hello {name}</div>
        <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginBottom:"16px"}}>Your account has no role yet. Requests are answered by the school.</div>
        {rows.length===0&&<div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>No requests on record.</div>}
        {rows.map((r)=>(
          <div key={r.id} data-testid={`request-${r.state}`} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",border:`1px solid ${D.border}`,borderRadius:D.md,background:D.surf1,marginBottom:"8px"}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:D.body,fontSize:"13px",color:D.textPrimary,fontWeight:600}}>{ROLES[r.role]?.label ?? r.role}{r.team?` · ${r.team}`:""}</div>
              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{r.schoolName ?? "School"} · {r.state}{r.decidedNote?` — ${r.decidedNote}`:""}</div>
            </div>
            {r.state==="pending"&&<button onClick={()=>withdraw(r.id)} className="pressBtn" style={{background:"none",border:`1px solid ${D.border}`,borderRadius:D.pill,padding:"4px 10px",cursor:"pointer",color:D.textMuted,fontFamily:D.body,fontSize:"11px"}}>Withdraw</button>}
          </div>
        ))}
        <button onClick={onSignOut} className="pressBtn" style={{marginTop:"10px",background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontFamily:D.body,fontSize:"12px"}}>Sign out</button>
      </div>
    </div>
  );
}

export default function SCRBRD_OS() {
  // ── App-level state ──
  const [appState,  setAppState]  = useState("landing"); // landing|login|onboarding|app
  const [role,      setRole]      = useState("superadmin");
  const [userName,  setUserName]  = useState("Super Admin");
  const [page,      setPage]      = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  // Lifted users state so ManagementView + SettingsView share the same source
  // of truth. Seeded from the read path rather than from the mock module: this
  // used to be `useState(USERS_INITIAL)`, which handed every screen the whole
  // platform directory — every name and email at every school — regardless of
  // who was signed in. The assertion that was supposed to prevent that had a
  // regex that did not match "./data/mock.js".
  const directory = useRows("users", role);
  const [users,     setUsers]     = useState([]);
  const [userEdits, setUserEdits] = useState(false);
  // Local edits win once they exist, so a re-fetch does not discard what
  // someone is in the middle of changing.
  useEffect(() => { if (!userEdits) setUsers(directory); }, [directory, userEdits]);
  const setUsersTracked = (next) => { setUserEdits(true); setUsers(next); };
  const [scorerOpen, setScorerOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const [scorerResume, setScorerResume] = useState(null);
  // The fixture the scorer is on, kept separately from `scorerResume` so it can
  // be persisted: the resume payload carries a whole seeded innings and has no
  // business in storage, but its match id is all that's needed to rebuild it.
  const [scorerMatchId, setScorerMatchId] = useState(null);
  const restoredRef = useRef(false);
  const isMobile = useIsMobile();

  const handleRoleChange = (r) => {
    setRole(r);
    // Fall back to the dashboard rather than to undefined: a role whose nav
    // does not contain the current page used to set `page` to nav[0], and an
    // unknown role made that undefined — a blank main area with no way back.
    const nav = ROLES[r]?.nav || [];
    if (!nav.includes(page)) setPage(nav[0] ?? "dashboard");
  };

  // Auth handlers
  const handleLandingEnter = () => setAppState("onboarding");
  const handleLandingLogin  = () => setAppState("login");

  const handleLogin = (r, n, p) => {
    // Signed in with nothing: an account whose requests are still with the
    // school. No role, no shell; the requests, and a way out.
    if (p && Array.isArray(p.assignments) && p.assignments.length === 0) {
      setUserName(n || "User"); setAppState("pending"); return;
    }
    setRole(r); setUserName(n || ROLES[r]?.label || "User");
    const nav = ROLES[r]?.nav || [];
    setPage(nav[0] || "dashboard");
    setAppState("app");
  };

  const handleLoginSignUp = () => setAppState("onboarding");

  const handleOnboardComplete = (r, n, schoolId, meta) => {
    if (meta?.requested) { setAppState("login"); return; }
    setRole(r || "player");
    setUserName(n || ROLES[r]?.label || "User");
    const nav = ROLES[r]?.nav || [];
    setPage(nav[0] || "dashboard");
    setAppState("app");
  };

  // Launch scorer — with full mid-match state when opened from a live match
  // `asRole` exists for the session restore: setState is async, so a restore
  // that sets the role and opens the scorer in the same pass would evaluate
  // the capability against the PREVIOUS role. The default role is superadmin,
  // which maps to platformadmin and cannot score, so the scorer silently
  // failed to reopen after a reload.
  const openScorer = (m, asRole = role) => {
    if (!canScore(asRole)) return;   // RBAC: scoring is a write capability
    // A fixture that came from the server carries no seeded scorecard — there
    // is no stored score to seed from, by design. It opens with its match id
    // and the scorer builds the innings from the team sheet, which is what
    // starting a real match looks like.
    if (m && m.live && m.id) {
      setScorerResume({ cfg: {
        matchId: m.id, team1: m.homeTeam, team2: m.awayTeam,
        teamCode: m.homeTeam, overs: m.overs ?? 20,
      } });
      setScorerMatchId(m.id);
      setScorerOpen(true);
      return;
    }
    if (m && m.status === "live" && m.scorecard?.home) {
      const { runs, wkts } = parseScore(m.scorecard.home.score);
      setScorerResume(ScorerApp.seedLiveResume({
        matchId: m.id, team1: m.homeTeam, team2: m.awayTeam, overs: 20,
        runs, wickets: wkts, balls: parseBalls(m.scorecard.home.overs),
        // This branch seeds a scorer from a STORED scorecard, which only mock
        // fixtures carry — a live match has no score column by design, because
        // the score is derived from ball_event. So there is no roster to pass
        // and the synthetic fallback is the correct answer here rather than a
        // degradation.
        squad1: teamSquad(m.homeTeam), squad2: teamSquad(m.awayTeam),
      }));
    } else setScorerResume(null);
    setScorerMatchId(m?.id ?? null);
    setScorerOpen(true);
  };

  // ── Session durability ──────────────────────────────────
  // A reload mid-over must not drop the scorer back to the landing page. The
  // match log itself is saved by the scorer; this is the far smaller matter of
  // where the person was, so they land back on the pad instead of navigating
  // in from scratch while play continues.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadSession();
      if (cancelled || !s) { restoredRef.current = true; return; }
      if (s.appState) setAppState(s.appState);
      if (s.role) setRole(s.role);
      if (s.userName) setUserName(s.userName);
      if (s.page) setPage(s.page);
      if (s.scorerMatchId) {
        // A saved session must not become a way to reopen a fixture the person
        // is no longer allowed to see — so the fixture is re-fetched and the
        // SERVER decides, rather than the browser re-deriving it from a role
        // stored in the same session that named the match.
        //
        // Falling back to the client-side scoping only when there is no
        // session at all, which is the demo.
        let m = null;
        if (signedIn()) {
          try {
            const { rows } = await api("/api/read/matches");
            const r = rows.find((x) => x.id === s.scorerMatchId);
            // The scorer wants the product's vocabulary, and asMatch lives in
            // lib/live.js behind a hook. Only three fields are needed here.
            if (r) m = { id: r.id, homeTeam: r.team_code, awayTeam: r.opponent,
                         overs: r.overs, live: true, status: r.status };
          } catch { /* offline: fall through and let the scorer resume by id */ }
        } else {
          m = scoped("matches", s.role ?? role).find(x => x.id === s.scorerMatchId);
        }
        if (m) openScorer(m, s.role ?? role); else setScorerMatchId(s.scorerMatchId);
      }
      restoredRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;
    saveSession({ appState, role, userName, page, scorerMatchId: scorerOpen ? scorerMatchId : null });
  }, [appState, role, userName, page, scorerOpen, scorerMatchId]);

  // Counted over the notices the SERVER agreed to send this person. A badge is
  // a disclosure: "3 unread" built from rows nobody authorised states a fact
  // about data the reader may not have.
  const notifications = useRows("notifications", role);
  const unreadCount = notifications.filter(n=>!n.read).length;

  // ── Auth screens ──
  if (appState === "landing") return (
    <><style>{GLOBAL_CSS}</style>
      <LandingPage onEnter={handleLandingEnter} onLogin={handleLandingLogin}/>
    </>
  );
  if (appState === "login") return (
    <><style>{GLOBAL_CSS}</style>
      <LoginPage onLogin={handleLogin} onSignUp={handleLoginSignUp}/>
    </>
  );
  if (appState === "pending") return (
    <><style>{GLOBAL_CSS}</style>
      <PendingRequests name={userName} onSignOut={()=>{ signOut(); setAppState("landing"); }}/>
    </>
  );
  if (appState === "onboarding") return (
    <><style>{GLOBAL_CSS}</style>
      <OnboardingFlow onComplete={handleOnboardComplete}/>
    </>
  );

  // ── Live Scorer — full-screen takeover ──
  if (scorerOpen && canScore(role)) return (
    <>
      <style>{GLOBAL_CSS}</style>
      {/* The key forces a remount when the scorer is pointed at a different
          match, so no state from the previous one survives. It used to be
          built from scorerResume.innings[0].balls, which assumed every resume
          carried a seeded innings — true for the demo fixtures and false for a
          real one, where there is no stored score to seed from and the log
          starts empty. Keying on the match id says what it means and works for
          both. */}
      <div className="scorer-shell">
        <ScorerApp
          key={scorerResume ? (scorerResume.cfg?.matchId ?? scorerResume.cfg?.team1 ?? "resume") : "new"}
          resume={scorerResume}/>
      </div>
      <button className="os-exit-scorer pressBtn" onClick={()=>{setScorerOpen(false);setScorerResume(null);}}>
        ‹ SCRBRD OS
      </button>
    </>
  );

  // ── Main app ──
  const VIEW_MAP = {
    dashboard:    <DashboardView     role={role} onNav={setPage}/>,
    matches:      <MatchCentreView   role={role} onOpenScorer={openScorer} onNavProfile={(id)=>{setProfileTarget(id);setPage("profiles");}}/>,
    competitions: <CompetitionsView  role={role}/>,
    leagues:      <LeagueView        role={role}/>,
    squad:        <SquadView         role={role}/>,
    profiles:     <ProfilesView      role={role} profileTarget={profileTarget} onClearTarget={()=>setProfileTarget(null)}/>,
    analytics:    <AnalyticsView     role={role}/>,
    skills:       <SkillsView        role={role}/>,
    training:     <TrainingView      role={role}/>,
    injuries:     <InjuryView        role={role}/>,
    logistics:    <LogisticsView     role={role}/>,
    calendar:     <CalendarView      role={role} onNav={setPage}/>,
    fields:       <FieldsView        role={role}/>,
    staff:        <StaffView         role={role}/>,
    officials:    <OfficialsView     role={role}/>,
    sponsors:     <SponsorsView      role={role}/>,
    modules:      <ModulesView       role={role}/>,
    notifications:<NotificationsView role={role}/>,
    settings:     <SettingsView      role={role} users={users} setUsers={setUsersTracked}/>,
    management:   <ManagementView    role={role} users={users} setUsers={setUsersTracked}/>,
    rulebook:     <RulebookView      role={role}/>,
    pitchdeck:    <PitchDeckView     role={role}/>,
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="os-shell" style={{display:"flex",minHeight:"100vh",background:D.bg}}>
        {/* First in the document, so it is the first thing a keyboard reaches.
            Without it, getting to the content means tabbing past every
            navigation entry on every single page change — and the nav is up to
            nineteen entries long. Invisible until focused. */}
        <a href="#os-content" className="skip-link" data-testid="skip-link">Skip to content</a>
        {!isMobile&&<Sidebar role={role} active={page} onNav={setPage} collapsed={collapsed} onToggle={()=>setCollapsed(!collapsed)} notifCount={unreadCount}/>}
        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
          <TopBar role={role} onRoleChange={handleRoleChange} onNav={setPage} userName={userName}/>
          <main id="os-content" tabIndex={-1} className="os-main" data-testid="os-main" data-page={VIEW_MAP[page] ? page : "dashboard"} style={{flex:1,overflowY:"auto"}}>
            {VIEW_MAP[page] || VIEW_MAP.dashboard}
          </main>
        </div>
        {isMobile&&<MobileNav role={role} active={page} onNav={setPage} notifCount={unreadCount}/>}
      </div>
    </>
  );
}
