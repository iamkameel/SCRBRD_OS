import { Suspense, lazy } from "react";
import { D } from "../design/tokens.js";
import { HomeBar, useHomeSection } from "../shell/HomeBar.jsx";

// GA-I30. The Competitions home: the competitions screen and the leagues
// screen, which were two menu entries, as the two sections of one. Each is
// the view that was already there, with its reads and its gates untouched;
// the bar under its header switches between them. Loaded when first shown.
const CompetitionsView = lazy(() => import("./CompetitionsView.jsx").then((m) => ({ default: m.CompetitionsView })));
const LeagueView = lazy(() => import("./LeagueView.jsx").then((m) => ({ default: m.LeagueView })));

/** @param {{ role: string, section?: string | null }} props */
function CompetitionsHome({ role, section = null }) {
  const [active, setActive] = useHomeSection(role, "competitions", section);
  const bar = <HomeBar home="competitions" role={role} section={active} onSection={setActive}/>;
  return (
    <Suspense fallback={<div role="status" style={{padding:"24px",fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Loading…</div>}>
      {active === "leagues" ? <LeagueView role={role} homeBar={bar}/> : <CompetitionsView role={role} homeBar={bar}/>}
    </Suspense>
  );
}

export { CompetitionsHome };
