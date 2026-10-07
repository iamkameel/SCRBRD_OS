import { useEffect, useState } from "react";
import { D, T, textOn } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { humanDate } from "../lib/format.js";
import { useLive } from "../lib/live.js";
import { canScore, holdsCapability } from "../rbac/index.js";
import { schoolsWhere } from "../lib/session.js";
import { Btn, Card, ReadState, SectionHeader, StatusDot } from "../ui/primitives.jsx";
import { WeatherChip } from "./shared.jsx";
import { MatchView } from "./matchcentre/MatchView.jsx";
import { SideName } from "./matchcentre/bits.jsx";
import { sidesOf, upcomingAndRecent } from "../lib/matchCentre.js";
import { PostMatchReport } from "./postmatch.jsx";
import { OppositionDossier } from "./dossier.jsx";
import { DutyRoster } from "./duties.jsx";
import { QuarantinePanel } from "./quarantine.jsx";
import { DrsPanel } from "./drs.jsx";
import { PublishPanel } from "./publication.jsx";
import { ReportIncident } from "./discipline.jsx";
import { AddFixtureModal, RescheduleFixture, SCHOOL_TEAMS } from "./fixtures.jsx";
import { useRows, useWeather } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { Icon } from "../ui/icons.jsx";
import { ErrorBoundary } from "../ui/ErrorBoundary.jsx";
import { ScorebookImportView, ScorebookPanel } from "./scorebook.jsx";
import { clearCoach, peekCoach } from "../lib/cockpitNav.js";
import { PickSideEntry } from "./cockpit/PickSide.jsx";

function MatchCentreView({ role, onOpenScorer, onNavProfile }) {
  useTheme();
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const COMPETITIONS = useRows("competitions", role);
  const GROUNDS = useRows("grounds", role);
  // Bumped after a fixture is arranged or amended, so the list re-reads from
  // the server instead of sitting on whatever it showed before the write —
  // the same nonce pattern TrainingView and LeagueView already use.
  const [matchesNonce, setMatchesNonce] = useState(0);
  // Fixtures come from the server when there is one — the same call site,
  // scoped in Postgres rather than in the browser. Falls back to the demo
  // fixtures otherwise, and says which it is showing.
  const matchesRead = useLive("matches", role, matchesNonce);
  const { rows: MATCHES, live: matchesAreLive } = matchesRead;
  // What the fixtures read said (GA-I08). "No fixtures yet" is a claim about the
  // season; it is made only of a read that answered. Retry bumps the nonce this
  // read already carries, so it asks the same question again.
  const matchesSaid = readState(matchesRead, { what: "fixtures" });
  const STAFF = useRows("staff", role);
  const WEATHER = useWeather(role);
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    const want = peekCoach();
    const m = want ? MATCHES.find((x) => x.id === want.matchId) : null;
    if (!want || !m) return;
    clearCoach();
    setCoachOn({ tab: "coach", drawer: want.drawer });
    setOpenM(m);
  }, [MATCHES]);
  const [selMatch, setSelMatch] = useState(null);
  // The fixture open in the Match Centre's own view (views/matchcentre/):
  // the board, the scorecard, the commentary and the rest, in six tabs. It
  // replaced the Scorecard modal (step 3c).
  const [openM,    setOpenM]    = useState(null);
  // A paper scorebook being imported for a fixture (SCRBRD-120): its own
  // screens, opened from the fixture's side panel.
  const [sbOpen,   setSbOpen]   = useState(null);
  // The Dashboard's match-day card sends the coach to a fixture's Coach tab
  // (SCRBRD-136): taken once the fixtures have loaded, then forgotten.
  const [coachOn, setCoachOn] = useState(/** @type {{tab: string, drawer: boolean} | null} */ (null));
  // The Post-Match Report (SCRBRD-082) — a fixture's own screen, opened from
  // its card the same way the Scorecard is. Offered only once a match is
  // complete: a live fixture's report would be reporting on a game still
  // being played, which is what the Live Scorecard is already for.
  const [reportM,  setReportM]  = useState(null);
  // Which schools this person could arrange a fixture FOR — layout only, the
  // same courtesy schoolsWhere() is everywhere else: match_insert() in db/09
  // decides for real. The button itself stays gated on holdsCapability(), so
  // this is read even when it will not be used, for the reason canScore()'s
  // own comment gives: getting it wrong shows a button that then says no.
  const fixtureSchools = schoolsWhere("fixture.create");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Same courtesy, for the amend side: which schools this person could move a
  // fixture for at all. The host/away distinction inside that is not visible
  // to the client (match.school_id means "the host", never "us" — see the
  // matches read) so this only narrows to "a school you hold fixture.update
  // at"; an away school's own attempt is still refused by match_update() in
  // db/09, same as it always was.
  const amendSchools = schoolsWhere("fixture.update");
  // Which fixture's dossier is open. Offered on a fixture that has not been
  // played, to a person whose role holds opposition.read — and that is ALL
  // the client decides. Whether there is anything to read is answered by two
  // SECURITY DEFINER functions against this exact fixture, so the button can
  // open a panel that says "not you", "not yet" or "not this opponent", the
  // same way canScore() offers a scorer button the database may still refuse.
  const [dossierM, setDossierM] = useState(null);
  // A side's own results, opened from a fixture's "Onward" links
  // (SCRBRD-100 item 4) — the Match Centre list, already filtered to
  // "complete" and to that side. Cleared by picking any other status pill.
  const [teamFilter, setTeamFilter] = useState(null);
  const filtered = MATCHES.filter(m=>filter==="all"||m.status===filter)
    .filter(m=>!teamFilter || sidesOf(m).home.full===teamFilter || sidesOf(m).away.full===teamFilter);
  // Opens a fixture's own Match Centre — the "next fixture" links (item 4)
  // and, from the list itself, the ordinary "Open match" button.
  const openFixture = (m) => { setSelMatch(null); setOpenM(m); };
  const teamResults = (label) => { setOpenM(null); setTeamFilter(label); setFilter("complete"); };
  if (sbOpen) {
    return (
      <ScorebookImportView importId={sbOpen.id} match={sbOpen.match}
        onClose={()=>{ setSbOpen(null); setMatchesNonce(n=>n+1); }}/>
    );
  }
  if (openM) {
    // The row as the list has it now, so a live fixture that has moved on
    // (a result, a new status) is the one the view shows.
    const fresh = MATCHES.find((m) => m.id === openM.id) ?? openM;
    return (
      <MatchView match={fresh} role={role} onClose={() => { setOpenM(null); setCoachOn(null); }} canScoreIt={canScore(role)}
        initialTab={coachOn?.tab ?? null} initialDrawer={coachOn?.drawer ?? false}
        onOpenScorer={onOpenScorer} onNavProfile={onNavProfile}
        matches={MATCHES} onOpenFixture={openFixture} onTeamResults={teamResults}/>
    );
  }
  return (
    <div className="os-page">
      <SectionHeader title="Match Centre"
        sub={matchesAreLive ? "Live scores, results, fixtures & weather" : "Demonstration fixtures — no server connected"}
        color={D.emerald}
        actions={
          <>
            {holdsCapability(role,"fixture.create")&&<Btn onClick={()=>setScheduleOpen(true)}>+ Schedule Match</Btn>}
            {canScore(role)&&<button onClick={()=>onOpenScorer(null)} className="pressBtn" style={{padding:"5px 12px",borderRadius:D.pill,background:D.emerald+"18",border:`1px solid ${D.emerald}30`,color:D.emerald,fontFamily:D.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.05em",cursor:"pointer",display:"flex",alignItems:"center",gap:"5px"}}>
              <div className="live-dot"/>Open SCRBRD Scorer <Icon name="arrow-up-right"/>
            </button>}
          </>
        }/>
      <div style={{display:"flex",gap:"6px",marginBottom:"20px",flexWrap:"wrap",alignItems:"center"}}>
        {["all","live","upcoming","complete"].map(f=>(
          <button key={f} onClick={()=>{setFilter(f);setTeamFilter(null);}} data-testid={`mc-filter-${f}`} className="pressBtn" style={{
            padding:"5px 14px",borderRadius:D.pill,border:`1px solid ${filter===f&&!teamFilter?D.indigo+"55":D.border}`,
            background:filter===f&&!teamFilter?D.indigo+"18":"transparent",cursor:"pointer",
            fontFamily:D.body,fontSize:"12px",fontWeight:filter===f?600:400,
            color:filter===f?D.textPrimary:D.textMuted,textTransform:"capitalize",
          }}>{f}</button>
        ))}
        {/* SCRBRD-100 item 4: "the team's results", opened from a fixture's
            onward links. There is no dedicated team-results screen — this is
            the Match Centre list itself, narrowed — so the chip says exactly
            that and clears back to the ordinary filters on a click. */}
        {teamFilter&&(
          <button onClick={()=>setTeamFilter(null)} data-testid="mc-team-filter-clear" className="pressBtn" style={{
            padding:"5px 12px",borderRadius:D.pill,border:`1px solid ${D.emerald}55`,background:D.emerald+"18",
            cursor:"pointer",fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.emerald,
            display:"flex",alignItems:"center",gap:"5px",
          }}>{teamFilter}&apos;s results <span aria-hidden="true">✕</span></button>
        )}
      </div>
      {reportM&&<PostMatchReport match={reportM} role={role} onClose={()=>setReportM(null)}
        onNavProfile={(id)=>{setReportM(null);onNavProfile&&onNavProfile(id);}}
        matches={MATCHES} onOpenFixture={(m)=>{setReportM(null);openFixture(m);}} onTeamResults={(l)=>{setReportM(null);teamResults(l);}}/>}
      {dossierM&&<OppositionDossier match={dossierM} role={role} onClose={()=>setDossierM(null)}/>}
      {scheduleOpen&&(
        <AddFixtureModal fixtureSchools={fixtureSchools} teamOptions={SCHOOL_TEAMS} grounds={GROUNDS} matches={MATCHES}
          onClose={()=>setScheduleOpen(false)}
          onCreated={()=>{setScheduleOpen(false);setMatchesNonce(n=>n+1);}}/>
      )}
      <div style={{display:"grid",gridTemplateColumns:selMatch?"var(--g-side-r,1fr 340px)":"1fr",gap:"16px",alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {filtered.map(m=>{
            const comp = COMPETITIONS.find(c=>c.id===m.competition);
            const w = WEATHER[m.id];
            const isLive = m.status==="live";
            const isSel = selMatch?.id===m.id;
            const sides = sidesOf(m);
            return (
              <Card key={m.id} data-testid={`match-card-${m.id}`} onClick={()=>setSelMatch(isSel?null:m)} sx={{
                background:isLive?`linear-gradient(135deg,${D.emerald}08,${D.surf1})`:D.surf1,
                border:`1px solid ${isSel?D.sky+"55":isLive?D.emerald+"22":D.border}`,cursor:"pointer",
              }}>
                <div style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px",flexWrap:"wrap"}}>
                    <StatusDot status={m.status}/>
                    <span style={{...T.role.label,color:isLive?T.brand.accentText:T.content.secondary}}>{m.status}</span>
                    {comp&&<span style={{...T.role.body,fontSize:"12px",color:T.content.secondary}}>{comp.name}</span>}
                    {w&&<WeatherChip w={w} status={m.status} compact/>}
                    <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>{humanDate(m.date)}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:"12px",alignItems:"center"}}>
                    <div>
                      <div style={{fontFamily:D.body,fontSize:"15px",fontWeight:700,color:D.textPrimary}}><SideName side={sides.home}/></div>
                      {m.scorecard?.home&&<div style={{...T.role.figure.md,color:isLive?D.emerald:D.textPrimary,marginTop:"4px"}}>{m.scorecard.home.score} <span style={{fontSize:"12px",color:D.textMuted}}>({m.scorecard.home.overs})</span></div>}
                    </div>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:800,color:D.textMuted,letterSpacing:"0.06em"}}>VS</div>
                      {m.result&&<div style={{fontFamily:D.body,fontSize:"12px",color:isLive?D.emerald:D.amber,marginTop:"4px",maxWidth:"120px"}}>{m.result}</div>}
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:D.body,fontSize:"15px",fontWeight:700,color:D.textPrimary}}><SideName side={sides.away}/></div>
                      {m.scorecard?.away&&<div style={{...T.role.figure.md,color:D.textPrimary,marginTop:"4px"}}>{m.scorecard.away.score} <span style={{fontSize:"12px",color:D.textMuted}}>({m.scorecard.away.overs})</span></div>}
                    </div>
                  </div>
                  <div style={{marginTop:"10px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"6px"}}>
                    <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}><Icon name="map-pin"/> {m.venue}</span>
                    <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                      {m.transport?.bus&&<span style={{display:"inline-flex",alignItems:"center",gap:T.space.xs,...T.role.body,fontSize:"12px",color:T.content.secondary}}><Icon name="bus"/> Bus {m.transport.depart}</span>}
                      {/* A scheduled fixture is offered too, because that is
                          when scoring actually begins — you open the pad at
                          the toss, not once someone has already marked the
                          match live. Whether this person MAY score it is
                          decided by the database when the scorer claims it;
                          canScore() only decides whether to offer the button,
                          and being wrong here shows a button that then says
                          no, never the wrong data. */}
                      {(isLive||m.status==="upcoming")&&canScore(role)&&<Btn variant="success" onClick={e=>{e.stopPropagation();onOpenScorer&&onOpenScorer(m);}}>{isLive?"Open Live Scorer →":"Start Scoring →"}</Btn>}
                      {/* The fixture's own Match Centre (step 3c), for every
                          fixture — NOT gated on `m.scorecard`, which is a mock-only
                          field: asMatch() sets it null for every live row because
                          a score is derived from the ball log rather than stored.
                          The view reads the log itself and says so honestly when
                          a match has not been scored yet, and a fixture still to
                          be played has its match details to show. */}
                      <Btn variant="ghost" data-testid={`mc-open-${m.id}`} onClick={e=>{e.stopPropagation();setOpenM(m);}}>Open match</Btn>
                      {/* SCRBRD-082. Only once the match is complete — the
                          same reasoning canScore()'s own comment gives for
                          every other offered-but-checked-server-side button:
                          a report on a match still being played would be
                          reporting on the wrong thing, not merely early. */}
                      {m.status==="complete"&&<Btn variant="ghost" onClick={e=>{e.stopPropagation();setReportM(m);}} data-testid={`report-open-${m.id}`}>Post-match report</Btn>}
                      {m.status==="upcoming"&&holdsCapability(role,"opposition.read")&&<Btn variant="ghost" onClick={e=>{e.stopPropagation();setDossierM(m);}} data-testid={`dossier-open-${m.id}`}>Dossier</Btn>}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          {/* SCRBRD-100 item 1: never a blank panel. Whatever emptied this
              list — no live match, no fixture of this status, or a team
              filter with nothing to show — it points at what the list's own
              read already has: the next fixtures and the last results. */}
          {filtered.length===0&&(["ok","empty"].includes(matchesSaid.state)
            ? <NoMatchesPanel matches={MATCHES} filter={filter} teamFilter={teamFilter} onOpen={openFixture}/>
            : <Card data-testid="mc-read-state-card"><ReadState read={matchesSaid} icon="trophy" testId="mc-read-state" onRetry={()=>setMatchesNonce(n=>n+1)}/></Card>)}
        </div>

        {/* Match detail with full weather */}
        {selMatch&&(()=>{
          const w = WEATHER[selMatch.id];
          const scorer = selMatch.scorerId ? STAFF.find(s=>s.id===selMatch.scorerId) : null;
          const driver = selMatch.transport?.driverId ? STAFF.find(s=>s.id===selMatch.transport.driverId) : null;
          const ground = selMatch.groundId ? GROUNDS.find(g=>g.id===selMatch.groundId) : null;
          const pitch  = ground?.pitches?.[0];
          return (
            <Card sx={{padding:"16px",position:"sticky",top:"16px",maxHeight:"calc(100vh - 100px)",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Match Details</div>
                <button onClick={()=>setSelMatch(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
              </div>
              {w&&<div style={{marginBottom:"12px"}}><WeatherChip w={w} status={selMatch.status}/></div>}
              {/* Rescheduling and calling off — fixture.update, at the HOST's
                  own school. amendSchools is a courtesy filter, not the gate:
                  match_update() in db/09 refuses an away school's attempt
                  regardless, and would refuse this one too if the courtesy
                  check above were ever wrong. */}
              {holdsCapability(role,"fixture.update")&&amendSchools.some(s=>s.id===selMatch.schoolId)&&(
                <RescheduleFixture match={selMatch} grounds={GROUNDS} onChanged={()=>setMatchesNonce(n=>n+1)}/>
              )}
              {/* Naming the side, for the one assignment that holds team.select
                  for a side of this fixture, while it is still to be played.
                  Whether he may is decided again by the squad route and the
                  two triggers on match_squad; see cockpit/PickSide.jsx. */}
              <ErrorBoundary name="pick the side"><PickSideEntry match={selMatch}/></ErrorBoundary>
              {/* SCRBRD-037. The live answer to the question the blocks below
                  gesture at. Those read demo constants — STAFF, GROUNDS,
                  selMatch.transport — which are null for every real fixture,
                  the same shape of problem the scorecard button had. This
                  reads match_duties through the choke point and says "nothing
                  on record" where nothing is, rather than falling silent. */}
              {/* Each of these side panels has its own error boundary, so one
                  that fails to draw is a card in its place and the rest of
                  the details stay. */}
              <ErrorBoundary name="duties"><DutyRoster matchId={selMatch.id} role={role}/></ErrorBoundary>
              {/* SCRBRD-083: a side on the public pages, for broadcast.publish
                  holders. fixture_publish() (db/47) is the gate. */}
              <ErrorBoundary name="publication"><PublishPanel matchId={selMatch.id} role={role} schools={{ home: selMatch.schoolId, away: selMatch.awaySchoolId }}/></ErrorBoundary>
              {/* SCRBRD-003. Offered only to whoever holds scoring.amend.approve
                  — see quarantine.jsx for why that check is a courtesy and not
                  the gate. Placed in Match Centre rather than the live pad: a
                  stale-epoch ball is reviewed after the fact, by the person who
                  approves corrections, not by the scorer mid-over. */}
              <ErrorBoundary name="quarantine"><QuarantinePanel matchId={selMatch.id} role={role}/></ErrorBoundary>
              <ErrorBoundary name="review"><DrsPanel matchId={selMatch.id} role={role}/></ErrorBoundary>
              <ErrorBoundary name="incident report"><ReportIncident match={selMatch} role={role}/></ErrorBoundary>
              {/* SCRBRD-120. A played fixture's paper scorebook, typed beside
                  photos of its pages and confirmed by a second person. Drawn
                  only when the API lists the fixture's imports (module on,
                  this person's to see); see views/scorebook.jsx. */}
              <ErrorBoundary name="scorebook"><ScorebookPanel match={selMatch} onOpen={(id)=>setSbOpen({ id, match: selMatch })}/></ErrorBoundary>
              {ground&&pitch&&(
                <div style={{marginBottom:"12px",background:D.surf2,borderRadius:D.md,padding:"10px 12px",border:`1px solid ${D.teal}22`}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.teal,letterSpacing:"0.08em",marginBottom:"7px"}}>PITCH REPORT</div>
                  {[["Ground",ground.shortName],["Strip",`No. ${pitch.num}`],["Surface",pitch.surface],["Condition",pitch.condition],["Bounce",pitch.bounce],["Seam Move",pitch.seamMovement||"—"],["Orientation",ground.orientation]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${D.border}`}}>
                      <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>{l}</span>
                      <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textPrimary,fontWeight:500}}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
              {scorer&&(
                <div style={{marginBottom:"10px",padding:"9px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.orange}22`,display:"flex",alignItems:"center",gap:"9px"}}>
                  <span style={{fontSize:"16px",color:D.orange}}><Icon name="scorebook"/></span>
                  <div>
                    <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.orange,letterSpacing:"0.06em"}}>SCORER</div>
                    <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>{scorer.name}</div>
                    <div style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>{scorer.scoringSystem}</div>
                  </div>
                </div>
              )}
              {driver&&selMatch.transport?.bus&&(
                <div style={{marginBottom:"10px",padding:"9px 12px",background:D.surf2,borderRadius:D.md,border:`1px solid ${D.lime}22`}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:textOn(D.lime),letterSpacing:"0.06em",marginBottom:"5px"}}>TRANSPORT</div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                    <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>Driver</span>
                    <span style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>{driver.name}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"4px"}}>
                    <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>Vehicle</span>
                    <span style={{fontFamily:D.mono,fontSize:"12px",color:textOn(D.lime)}}>{selMatch.transport.vehicle}</span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>Departs / Returns</span>
                    <span style={{fontFamily:D.mono,fontSize:"12px",color:D.amber}}>{selMatch.transport.depart} / {selMatch.transport.return}</span>
                  </div>
                </div>
              )}
            </Card>
          );
        })()}
      </div>
    </div>
  );
}

/**
 * "The Match Centre list with nothing live points to upcoming fixtures and
 * recent results" (SCRBRD-100 item 1) — using `matches`, the same rows the
 * list already read; never a second fetch, and never a blank panel.
 */
function NoMatchesPanel({ matches, filter, teamFilter, onOpen }) {
  const { upcoming, recent } = upcomingAndRecent(matches, { limit: 3 });
  const heading = teamFilter ? `No results yet for ${teamFilter}.`
    : filter==="live" ? "Nothing live right now."
    : filter==="upcoming" ? "No upcoming fixtures scheduled."
    : filter==="complete" ? "No results yet."
    : "No fixtures yet.";
  const Row = ({ m }) => {
    const sides = sidesOf(m);
    return (
      <button onClick={()=>onOpen(m)} data-testid="mc-nomatches-row" className="pressBtn" style={{
        display:"flex",width:"100%",justifyContent:"space-between",alignItems:"center",gap:"10px",
        padding:"8px 10px",borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf2,
        cursor:"pointer",textAlign:"left",fontFamily:D.body,fontSize:"12px",color:D.textPrimary,
      }}>
        <span><SideName side={sides.home}/> v <SideName side={sides.away}/></span>
        <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,whiteSpace:"nowrap"}}>{humanDate(m.date)}</span>
      </button>
    );
  };
  return (
    <Card data-testid="mc-nomatches" sx={{padding:"18px 16px"}}>
      <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginBottom:"14px"}}>{heading}</div>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"16px"}}>
        <div>
          <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",color:D.textMuted,marginBottom:"8px"}}>UPCOMING FIXTURES</div>
          {upcoming.length
            ? <div style={{display:"grid",gap:"6px"}}>{upcoming.map(m=><Row key={m.id} m={m}/>)}</div>
            : <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Nothing scheduled.</div>}
        </div>
        <div>
          <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,letterSpacing:"0.08em",color:D.textMuted,marginBottom:"8px"}}>RECENT RESULTS</div>
          {recent.length
            ? <div style={{display:"grid",gap:"6px"}}>{recent.map(m=><Row key={m.id} m={m}/>)}</div>
            : <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>No results yet.</div>}
        </div>
      </div>
    </Card>
  );
}

export { MatchCentreView };
