/**
 * SCRBRD OS — application root.
 *
 * Owns app-level state (auth phase, role, page) and routes the 19 navigation
 * destinations to their view components. Views read data through getData() in
 * rbac/, never from the mock constants directly.
 */
import { Suspense, lazy, useState, useEffect, useRef } from "react";
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
import { clearSession, loadSession, saveSession } from "./lib/persist.js";
import { signOut } from "./lib/session.js";

// ── Route-level code splitting (SCRBRD-020) ─────────────────────────────
//
// Every visitor used to download one 936 KB chunk before the landing page
// drew, most of it screens they would never open: a parent on mobile data
// looks at the match centre and the newsfeed, not the sponsor register or
// the pitch deck. The views and the scorer are now fetched on first use, and
// tools/check-bundle.mjs holds the entry chunk under its ceiling and asserts
// that a view and the scorer are in some OTHER chunk — because a single
// static import of any of them, anywhere in the entry graph, folds it back
// into the first download and the build stays green. Not hypothetical: two
// `import { SCRBRD }` lines nothing used, left in the auth pages by the split
// from the single-file artifact, were still carrying 31 KB of the scorer's
// engine into every visitor's download — its module-level code, which Rollup
// cannot drop for an import it cannot prove pure — and would have kept doing
// so after this split. (The whole scorer was there too, but through this
// file's own static import of it.)
//
// THE SCORER IS PREFETCHED, NOT JUST LAZY. It is the one thing that has to
// work with no signal — a scorer who loaded the app at the gate, lost the
// network at the far field and then opened the pad must not be met by a
// failed chunk fetch. So the moment the shell mounts for a role that can
// score, the chunk is requested; the service worker (cache-first for hashed
// assets) keeps it for the reload mid-over. A view that has never been
// opened is unavailable offline, and that is fine: nothing on those screens
// is scored.
//
// The views are named exports and lazy() wants a default, hence the adapter.
const view = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const AnalyticsView     = view(() => import("./views/AnalyticsView.jsx"),     "AnalyticsView");
const CalendarView      = view(() => import("./views/CalendarView.jsx"),      "CalendarView");
const CompetitionsView  = view(() => import("./views/CompetitionsView.jsx"),  "CompetitionsView");
const DashboardView     = view(() => import("./views/DashboardView.jsx"),     "DashboardView");
const FieldsView        = view(() => import("./views/FieldsView.jsx"),        "FieldsView");
const InjuryView        = view(() => import("./views/InjuryView.jsx"),        "InjuryView");
const LeagueView        = view(() => import("./views/LeagueView.jsx"),        "LeagueView");
const LogisticsView     = view(() => import("./views/LogisticsView.jsx"),     "LogisticsView");
const ManagementView    = view(() => import("./views/ManagementView.jsx"),    "ManagementView");
const MatchCentreView   = view(() => import("./views/MatchCentreView.jsx"),   "MatchCentreView");
const NewsView          = view(() => import("./views/NewsView.jsx"),          "NewsView");
const NotificationsView = view(() => import("./views/NotificationsView.jsx"), "NotificationsView");
const OfficialsView     = view(() => import("./views/OfficialsView.jsx"),     "OfficialsView");
const SponsorsView      = view(() => import("./views/SponsorsView.jsx"),      "SponsorsView");
const ModulesView       = view(() => import("./views/ModulesView.jsx"),       "ModulesView");
const PitchDeckView     = view(() => import("./views/PitchDeckView.jsx"),     "PitchDeckView");
const ProfilesView      = view(() => import("./views/ProfilesView.jsx"),      "ProfilesView");
const ReadinessOverview = view(() => import("./views/ReadinessOverview.jsx"), "ReadinessOverview");
const RulebookView      = view(() => import("./views/RulebookView.jsx"),      "RulebookView");
const SettingsView      = view(() => import("./views/SettingsView.jsx"),      "SettingsView");
const SkillsView        = view(() => import("./views/SkillsView.jsx"),        "SkillsView");
const SquadView         = view(() => import("./views/SquadView.jsx"),         "SquadView");
const StaffView         = view(() => import("./views/StaffView.jsx"),         "StaffView");
const TrainingView      = view(() => import("./views/TrainingView.jsx"),      "TrainingView");
const loadScorer = () => import("./scorer/index.jsx");
const ScorerApp  = lazy(loadScorer);

// What the main area shows for the moment between choosing a screen and its
// chunk arriving. Kept inside <main> so the shell around it does not move.
function Loading({ what }) {
  return (
    <div role="status" data-testid="view-loading" style={{padding:"24px",fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>
      Loading {what}…
    </div>
  );
}

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
  // Bumped when a screen writes to the directory server-side, so the lifted
  // copy re-reads instead of showing the roster as it was before the write.
  const [userNonce, setUserNonce] = useState(0);
  const directory = useRows("users", role, userNonce);
  const [users,     setUsers]     = useState([]);
  const [userEdits, setUserEdits] = useState(false);
  // Local edits win once they exist, so a re-fetch does not discard what
  // someone is in the middle of changing.
  useEffect(() => { if (!userEdits) setUsers(directory); }, [directory, userEdits]);
  const setUsersTracked = (next) => { setUserEdits(true); setUsers(next); };
  // A SERVER WRITE BEATS A LOCAL EDIT. userEdits exists so a re-fetch does not
  // discard what somebody is mid-way through typing, but it latches: once any
  // screen has touched the local copy, the directory never refreshes again.
  // An enrolment is a fact in the database, so it clears the latch and asks
  // for the rows afresh.
  const refreshDirectory = () => { setUserEdits(false); setUserNonce((n) => n + 1); };
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

  /**
   * Signing out, properly.
   *
   * There was no way out of the shell at all: signOut() existed and was wired
   * to ONE screen — the holding page for somebody with no assignments yet — so
   * anyone who actually got in stayed in until they cleared their browser.
   *
   * IT HAS TO CLEAR THREE THINGS, and clearing only the first is the trap.
   * signOut() drops the in-memory profile, the API token and the school's
   * module switches. That leaves the PERSISTED shell state — role, name, page —
   * which loadSession() restores on the next boot, so the next person to pick
   * up a school's tablet would find themselves in the last person's role on
   * the last person's screen. clearSession() has existed since the scorer
   * needed it and had never been called from anywhere.
   *
   * And the live state is reset here rather than left to the reload, because
   * the save effect below fires on the very next render: without these, it
   * would write the previous person's role straight back into the session that
   * was just cleared.
   */
  const handleSignOut = () => {
    signOut();
    clearSession();
    setScorerOpen(false); setScorerResume(null); setScorerMatchId(null);
    setUsers([]); setUserEdits(false);
    setRole("superadmin"); setUserName("Super Admin"); setPage("dashboard");
    setAppState("landing");
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
      // This branch seeds a scorer from a STORED scorecard, which only mock
      // fixtures carry — a live match has no score column by design, because
      // the score is derived from ball_event. So there is no roster to pass
      // and the synthetic fallback is the correct answer here rather than a
      // degradation.
      //
      // Both modules arrive on demand: the seed helper hangs off the scorer,
      // and the three parsers live in views/shared.jsx, which brings the
      // charts and the seed with it. A static import of either here would put
      // them in every visitor's first download for the sake of the demo.
      Promise.all([loadScorer(), import("./views/shared.jsx")]).then(([{ default: Scorer }, { parseBalls, parseScore, teamSquad }]) => {
        const { runs, wkts } = parseScore(m.scorecard.home.score);
        setScorerResume(Scorer.seedLiveResume({
          matchId: m.id, team1: m.homeTeam, team2: m.awayTeam, overs: 20,
          runs, wickets: wkts, balls: parseBalls(m.scorecard.home.overs),
          squad1: teamSquad(m.homeTeam), squad2: teamSquad(m.awayTeam),
        }));
        setScorerMatchId(m.id ?? null);
        setScorerOpen(true);
      });
      return;
    }
    setScorerResume(null);
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

  // The scorer's chunk, requested before anyone asks for it — see the note
  // at the top of this file. Fire-and-forget: a failure here is a slow
  // network, and the fetch on opening the pad will try again.
  useEffect(() => {
    if (appState === "app" && canScore(role)) loadScorer().catch(() => {});
  }, [appState, role]);

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
      {/* The same sign-out the shell uses. This one cleared the profile and
          left the persisted session behind, so a reload put the next person
          back where the last one stood. */}
      <PendingRequests name={userName} onSignOut={handleSignOut}/>
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
        <Suspense fallback={<Loading what="the scorer"/>}>
          <ScorerApp
            key={scorerResume ? (scorerResume.cfg?.matchId ?? scorerResume.cfg?.team1 ?? "resume") : "new"}
            resume={scorerResume}/>
        </Suspense>
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
    readiness:    <ReadinessOverview role={role}/>,
    staff:        <StaffView         role={role}/>,
    officials:    <OfficialsView     role={role}/>,
    sponsors:     <SponsorsView      role={role}/>,
    modules:      <ModulesView       role={role}/>,
    news:         <NewsView          role={role}/>,
    notifications:<NotificationsView role={role}/>,
    settings:     <SettingsView      role={role} users={users} setUsers={setUsersTracked} onDirectoryChanged={refreshDirectory}/>,
    management:   <ManagementView    role={role} users={users} setUsers={setUsersTracked}/>,
    rulebook:     <RulebookView      role={role}/>,
    pitchdeck:    <PitchDeckView     role={role} onNav={setPage}/>,
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
        {!isMobile&&<Sidebar role={role} active={page} onNav={setPage} collapsed={collapsed} onToggle={()=>setCollapsed(!collapsed)} notifCount={unreadCount} userName={userName} onSignOut={handleSignOut}/>}
        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
          {/* Said on every screen, not once on the login page. The shell can
              be reached without a session — the demo entry, a restored
              appState after a reload that dropped the token — and from inside
              it a mock roster and a real one look the same. One line, above
              everything, for as long as there is no token. */}
          {!signedIn() && (
            <div role="status" data-testid="demo-banner" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"12px",padding:"6px 16px",background:"rgba(245,158,11,0.14)",borderBottom:`1px solid ${D.amber}`,fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>
              <span><strong>Demonstration.</strong> Nothing on these screens is a school's, and nothing is saved.</span>
              <button onClick={()=>setAppState("login")} className="pressBtn" data-testid="demo-banner-signin" style={{padding:"3px 10px",borderRadius:D.pill,border:`1px solid ${D.amber}`,background:"transparent",color:D.textPrimary,fontFamily:D.head,fontSize:"11px",fontWeight:700,cursor:"pointer"}}>Sign in</button>
            </div>
          )}
          <TopBar role={role} onRoleChange={handleRoleChange} onNav={setPage} userName={userName}/>
          <main id="os-content" tabIndex={-1} className="os-main" data-testid="os-main" data-page={VIEW_MAP[page] ? page : "dashboard"} style={{flex:1,overflowY:"auto"}}>
            <Suspense fallback={<Loading what={VIEW_MAP[page] ? page : "dashboard"}/>}>
              {VIEW_MAP[page] || VIEW_MAP.dashboard}
            </Suspense>
          </main>
        </div>
        {isMobile&&<MobileNav role={role} active={page} onNav={setPage} notifCount={unreadCount} userName={userName} onSignOut={handleSignOut}/>}
      </div>
    </>
  );
}
