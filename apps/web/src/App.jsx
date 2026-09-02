/**
 * SCRBRD OS — application root.
 *
 * Owns app-level state (auth phase, role, page) and routes the 19 navigation
 * destinations to their view components. Views read data through getData() in
 * rbac/, never from the mock constants directly.
 */
import { useState } from "react";
import ScorerApp from "./scorer/index.jsx";
import { LandingPage } from "./auth/LandingPage.jsx";
import { LoginPage } from "./auth/LoginPage.jsx";
import { OnboardingFlow } from "./auth/OnboardingFlow.jsx";
import { NOTIFICATIONS, USERS_INITIAL } from "./data/mock.js";
import { ROLES } from "./design/roles.js";
import { D, GLOBAL_CSS } from "./design/tokens.js";
import { canScore } from "./rbac/index.js";
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
import { PitchDeckView } from "./views/PitchDeckView.jsx";
import { ProfilesView } from "./views/ProfilesView.jsx";
import { RulebookView } from "./views/RulebookView.jsx";
import { SettingsView } from "./views/SettingsView.jsx";
import { SkillsView } from "./views/SkillsView.jsx";
import { SquadView } from "./views/SquadView.jsx";
import { StaffView } from "./views/StaffView.jsx";
import { TrainingView } from "./views/TrainingView.jsx";
import { parseBalls, parseScore, teamSquad } from "./views/shared.jsx";

export default function SCRBRD_OS() {
  // ── App-level state ──
  const [appState,  setAppState]  = useState("landing"); // landing|login|onboarding|app
  const [role,      setRole]      = useState("superadmin");
  const [userName,  setUserName]  = useState("Super Admin");
  const [page,      setPage]      = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  // Lifted users state so ManagementView + SettingsView share the same source of truth
  const [users,     setUsers]     = useState(USERS_INITIAL);
  const [scorerOpen, setScorerOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState(null);
  const [scorerResume, setScorerResume] = useState(null);
  const isMobile = useIsMobile();

  const handleRoleChange = (r) => {
    setRole(r);
    const nav = ROLES[r]?.nav || [];
    if (!nav.includes(page)) setPage(nav[0]);
  };

  // Auth handlers
  const handleLandingEnter = () => setAppState("onboarding");
  const handleLandingLogin  = () => setAppState("login");

  const handleLogin = (r, n) => {
    setRole(r); setUserName(n || ROLES[r]?.label || "User");
    const nav = ROLES[r]?.nav || [];
    setPage(nav[0] || "dashboard");
    setAppState("app");
  };

  const handleLoginSignUp = () => setAppState("onboarding");

  const handleOnboardComplete = (r, n, schoolId) => {
    setRole(r || "player");
    setUserName(n || ROLES[r]?.label || "User");
    const nav = ROLES[r]?.nav || [];
    setPage(nav[0] || "dashboard");
    setAppState("app");
  };

  // Launch scorer — with full mid-match state when opened from a live match
  const openScorer = (m) => {
    if (!canScore(role)) return;   // RBAC: scoring is a write capability
    if (m && m.status === "live" && m.scorecard?.home) {
      const { runs, wkts } = parseScore(m.scorecard.home.score);
      setScorerResume(ScorerApp.seedLiveResume({
        matchId: m.id, team1: m.homeTeam, team2: m.awayTeam, overs: 20,
        runs, wickets: wkts, balls: parseBalls(m.scorecard.home.overs),
        squad1: teamSquad(m.homeTeam, role), squad2: teamSquad(m.awayTeam, role),
      }));
    } else setScorerResume(null);
    setScorerOpen(true);
  };

  const unreadCount = NOTIFICATIONS.filter(n=>!n.read).length;

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
  if (appState === "onboarding") return (
    <><style>{GLOBAL_CSS}</style>
      <OnboardingFlow onComplete={handleOnboardComplete}/>
    </>
  );

  // ── Live Scorer — full-screen takeover ──
  if (scorerOpen && canScore(role)) return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="scorer-shell"><ScorerApp key={scorerResume?scorerResume.cfg.team1+scorerResume.innings[0].balls:"new"} resume={scorerResume}/></div>
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
    notifications:<NotificationsView role={role}/>,
    settings:     <SettingsView      role={role} users={users} setUsers={setUsers}/>,
    management:   <ManagementView    role={role} users={users} setUsers={setUsers}/>,
    rulebook:     <RulebookView      role={role}/>,
    pitchdeck:    <PitchDeckView     role={role}/>,
  };

  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <div className="os-shell" style={{display:"flex",minHeight:"100vh",background:D.bg}}>
        {!isMobile&&<Sidebar role={role} active={page} onNav={setPage} collapsed={collapsed} onToggle={()=>setCollapsed(!collapsed)} notifCount={unreadCount}/>}
        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
          <TopBar role={role} onRoleChange={handleRoleChange} onNav={setPage} userName={userName}/>
          <main className="os-main" style={{flex:1,overflowY:"auto"}}>
            {VIEW_MAP[page] || VIEW_MAP.dashboard}
          </main>
        </div>
        {isMobile&&<MobileNav role={role} active={page} onNav={setPage} notifCount={unreadCount}/>}
      </div>
    </>
  );
}
