import { Suspense, lazy, useEffect, useState } from "react";
import { holdsCapability } from "../rbac/index.js";
import { D, T, inkOn } from "../design/tokens.js";
import { Avatar, Badge, Card, SectionHeader, StatusDot } from "../ui/primitives.jsx";
import { usePlayersWithCareer, useRows } from "../lib/live.js";
import { Icon } from "../ui/icons.jsx";
import { api, signedIn } from "../lib/api.js";
import { leagueSetupState } from "../lib/league.js";
import { LeagueInvitations } from "./leagueinvites.jsx";

// The league wizard (SCRBRD-127) and the fixture planner (SCRBRD-123) are opened
// from here and are the largest screens in this view, so they load when first
// asked for, not with the list of competitions.
const LeagueWizard = lazy(() => import("./leaguewizard.jsx").then((m) => ({ default: m.LeagueWizard })));
const FixturePlanner = lazy(() => import("./planner.jsx").then((m) => ({ default: m.FixturePlanner })));

/** A 44px button in the wizard's style, for the competitions screen's league actions. */
function leagueButton(primary) {
  return { minHeight: "44px", padding: "10px 18px", borderRadius: T.radius.pill, cursor: "pointer", boxSizing: "border-box",
           fontFamily: T.type.body, fontSize: "14px", fontWeight: 600,
           ...(primary ? { border: "none", background: T.content.primary, color: inkOn(T.content.primary) }
                       : { background: "transparent", color: T.content.primary, border: `1px solid ${T.line.strong}` }) };
}

/**
 * Where a league's setup stands, for a manager: the two reads the wizard makes
 * on reopening a league, taken once the league is on show and not before. Null
 * until they are in, and null if either fails or the API says this person does
 * not manage this league, so the card is then as it always was (it offers
 * "Finish setting up"; the wizard words any refusal itself).
 * @param {string | undefined} id @param {boolean} wanted @param {number} nonce
 * @returns {ReturnType<typeof leagueSetupState> | null}
 */
function useSetupState(id, wanted, nonce) {
  const [got, setGot] = useState(/** @type {{ id: string, nonce: number, state: ReturnType<typeof leagueSetupState> } | null} */ (null));
  useEffect(() => {
    if (!id || !wanted) return;
    let off = false;
    Promise.all([api(`/api/competitions/${id}/entrants`), api(`/api/competitions/${id}/playing-conditions`)])
      .then(([e, p]) => {
        if (off || e.canManage !== true) return;
        setGot({ id, nonce, state: leagueSetupState({ entrants: e.entrants.length, sets: p.sets }) });
      })
      .catch(() => {});
    return () => { off = true; };
  }, [id, wanted, nonce]);
  // What was read for another league, or before the wizard last changed this one, is not shown.
  return wanted && got && got.id === id && got.nonce === nonce ? got.state : null;
}

function CompetitionsView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  // `nonce` reads the competitions again after the wizard has made or changed one.
  const [nonce, setNonce] = useState(0);
  const COMPETITIONS = useRows("competitions", role, nonce);
  const MATCHES = useRows("matches", role);
  const PLAYERS = usePlayersWithCareer(role);
  const [active, setActive] = useState("comp1");
  // What the screen is showing in place of the list: the league wizard (new, or
  // reopened for a league part-made), or a league's fixture planner.
  const [mode, setMode] = useState(/** @type {any} */ (null));
  const comp = COMPETITIONS.find(c=>c.id===active) ?? COMPETITIONS[0];
  const closeWizard = (/** @type {{ planner?: any, competition?: any } | undefined} */ r) => {
    setNonce((n) => n + 1);
    if (r?.competition?.id) setActive(r.competition.id);
    setMode(r?.planner ? { planner: r.planner } : null);
  };
  const canMake = holdsCapability(role,"competition.manage");
  const canPlan = holdsCapability(role,"competition.conditions.manage");
  // Read only for a manager looking at a live league, and only when signed in.
  const setup = useSetupState(comp?.id, !!comp?.live && canMake && signedIn(), nonce);
  // A complete league has nothing left to finish. Until the reads are in, or if
  // either fails, the card is as it always was.
  const showFinish = canMake && setup?.partMade !== false;
  if (mode?.wizard) {
    return (
      <div className="os-page">
        <Suspense fallback={<div role="status" style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Loading the league wizard…</div>}>
          <LeagueWizard role={role} competitionId={mode.competitionId} onClose={closeWizard}/>
        </Suspense>
      </div>
    );
  }
  if (mode?.planner) {
    return (
      <div className="os-page">
        <Suspense fallback={<div role="status" style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Loading the planner…</div>}>
          <FixturePlanner competition={mode.planner} onBack={() => setMode(null)}/>
        </Suspense>
      </div>
    );
  }
  return (
    <div className="os-page">
      <SectionHeader title="Competitions" sub="Leagues, cups and tournaments" color={D.amber}
        actions={canMake&&<button type="button" data-testid="new-competition" onClick={()=>setMode({wizard:true,competitionId:null})} style={leagueButton(true)}>+ New Competition</button>}/>
      <LeagueInvitations role={role} onAnswered={()=>setNonce((n)=>n+1)}/>
      <div style={{display:"flex",gap:"8px",marginBottom:"20px",flexWrap:"wrap"}}>
        {COMPETITIONS.map(c=>(
          <button key={c.id} onClick={()=>setActive(c.id)} aria-pressed={comp?.id===c.id} data-testid={`competition-${c.id}`} className="pressBtn" style={{
            padding:"8px 16px",minHeight:"44px",borderRadius:D.md,border:`1px solid ${comp?.id===c.id?D.amber+"55":D.border}`,
            background:comp?.id===c.id?D.amber+"14":"transparent",cursor:"pointer",textAlign:"left",
          }}>
            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:comp?.id===c.id?600:400,color:comp?.id===c.id?D.textPrimary:D.textSecondary}}>{c.name}</div>
            <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px",textTransform:"uppercase"}}>{c.type} · {c.format} · {c.ageGroup}</div>
          </button>
        ))}
      </div>
      {comp&&(
        <div style={{display:"grid",gridTemplateColumns:"var(--g-side-r,1fr 300px)",gap:"16px",alignItems:"start"}}>
          <div>
            <Card sx={{marginBottom:"16px"}}>
              <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",alignItems:"center",gap:"10px"}}>
                <div style={{flex:1}}>
                  <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{comp.name}</div>
                  <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginTop:"3px"}}>
                    {comp.format} · {comp.ageGroup} · {comp.teams} teams
                  </div>
                </div>
                <Badge color={comp.active?D.emerald:D.textMuted}>{comp.active?"Active":"Inactive"}</Badge>
                <Badge color={D.sky}>{comp.type}</Badge>
              </div>
              {comp.live&&(showFinish||canPlan)&&(
                <div style={{padding:"12px 16px",borderBottom:`1px solid ${D.border}`,display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center"}}>
                  {showFinish&&setup?.partMade&&<span data-testid="league-setup-state" style={{fontFamily:T.type.body,fontSize:"13px",fontWeight:600,color:T.content.primary,padding:"6px 12px",borderRadius:T.radius.pill,border:`1px solid ${T.semantic.warning}`}}>{setup.words}</span>}
                  {showFinish&&<button type="button" data-testid="finish-setup" onClick={()=>setMode({wizard:true,competitionId:comp.id})} style={leagueButton(false)}>Finish setting up</button>}
                  {canPlan&&<button type="button" data-testid="open-planner" onClick={()=>setMode({planner:{id:comp.id,name:comp.name,format:comp.format}})} style={leagueButton(false)}>Fixture planner</button>}
                </div>
              )}
              {comp.table&&(
                <div>
                  <div style={{padding:"10px 16px",background:D.surf2,display:"grid",gridTemplateColumns:"var(--g-league,2fr 1fr 1fr 1fr 1fr 1fr 1fr)",gap:"8px"}}>
                    {["Team","P","W","L","NR","Pts","NRR"].map(h=>(
                      <div key={h} style={{fontFamily:D.mono,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em",textAlign:h==="Team"?"left":"center"}}>{h}</div>
                    ))}
                  </div>
                  {comp.table.map((t,i)=>(
                    <div key={t.team} style={{padding:"11px 16px",borderTop:`1px solid ${D.border}`,display:"grid",gridTemplateColumns:"var(--g-league,2fr 1fr 1fr 1fr 1fr 1fr 1fr)",gap:"8px",alignItems:"center",background:t.team.includes("Hilton")?D.indigo+"0a":"transparent"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,color:i===0?D.amber:D.textMuted,width:"16px"}}>{i+1}</span>
                        <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:t.team.includes("Hilton")?700:400,color:t.team.includes("Hilton")?D.textPrimary:D.textSecondary}}>{t.team}</span>
                        {i===0&&<span style={{fontSize:"11px",color:D.amber}}><Icon name="crown" label="Top of the table"/></span>}
                      </div>
                      {[t.P,t.W,t.L,t.NR,<span style={{color:t.team.includes("Hilton")?D.emerald:D.textPrimary,fontWeight:700}}>{t.pts}</span>,<span style={{color:t.nrr>=0?D.emerald:D.rose}}>{t.nrr>=0?"+":""}{t.nrr.toFixed(2)}</span>].map((v,j)=>(
                        <div key={j} style={{fontFamily:D.mono,fontSize:"12px",color:D.textSecondary,textAlign:"center"}}>{v}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {comp.rounds&&(
                <div style={{padding:"16px"}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,marginBottom:"12px",letterSpacing:"0.06em",textTransform:"uppercase"}}>Tournament Bracket</div>
                  <div style={{display:"flex",gap:"8px"}}>
                    {comp.rounds.map(r=>(
                      <div key={r} style={{padding:"8px 16px",borderRadius:D.md,background:comp.currentRound===r?D.amber+"18":D.surf2,border:`1px solid ${comp.currentRound===r?D.amber+"44":D.border}`,textAlign:"center"}}>
                        <div style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:comp.currentRound===r?D.amber:D.textMuted}}>{r}</div>
                        {comp.currentRound===r&&<div style={{fontFamily:D.body,fontSize:"9px",color:D.amber,marginTop:"3px"}}>Current</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            {/* Fixtures for this comp */}
            <SectionHeader title="Fixtures" color={D.amber}/>
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              {MATCHES.filter(m=>m.competition===comp.id).map(m=>(
                <Card key={m.id} sx={{padding:"12px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                    <StatusDot status={m.status}/>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted,flexShrink:0}}>{m.date}</span>
                    <span style={{flex:1,fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{m.homeTeam} vs {m.awayTeam}</span>
                    {m.result&&<span style={{fontFamily:D.body,fontSize:"11px",color:m.result.includes("Hilton")?D.emerald:D.rose}}>{m.result}</span>}
                    {m.status==="upcoming"&&<Badge color={D.sky}>upcoming</Badge>}
                  </div>
                </Card>
              ))}
            </div>
          </div>
          {/* Stats sidebar */}
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <Card sx={{padding:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"12px"}}>Hilton Performance</div>
              {[["Matches Played","5"],["Wins","4"],["Losses","1"],["Run Rate","+1.24"],["Highest Score","186/6"],["Lowest Score","142/3"]].map(([l,v])=>(
                <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:`1px solid ${D.border}`}}>
                  <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{l}</span>
                  <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary,fontWeight:500}}>{v}</span>
                </div>
              ))}
            </Card>
            <Card sx={{padding:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"12px"}}>Top Performers</div>
              <div style={{marginBottom:"10px"}}>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>BATTING</div>
                {PLAYERS.filter(p=>p.team==="1XI").sort((a,b)=>b.avg-a.avg).slice(0,3).map((p,i)=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
                    <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,width:"14px"}}>{i+1}</span>
                    <Avatar name={p.name} size={24} color={D.sky}/>
                    <span style={{flex:1,fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{p.name.split(" ").pop()}</span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.amber,fontWeight:500}}>{p.avg}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"6px"}}>BOWLING</div>
                {PLAYERS.filter(p=>p.team==="1XI"&&p.wkts>0).sort((a,b)=>b.wkts-a.wkts).slice(0,3).map((p,i)=>(
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
                    <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted,width:"14px"}}>{i+1}</span>
                    <Avatar name={p.name} size={24} color={D.violet}/>
                    <span style={{flex:1,fontFamily:D.body,fontSize:"11px",color:D.textSecondary}}>{p.name.split(" ").pop()}</span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.violetText,fontWeight:500}}>{p.wkts}wkts</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export { CompetitionsView };
