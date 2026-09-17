
import { useState } from "react";
import { D, px } from "../design/tokens.js";
import { fitnessColor } from "../lib/format.js";
import { Avatar, Badge, Card, EmptyState, ProgressBar, SectionHeader } from "../ui/primitives.jsx";
import { usePlayersWithCareer, useLive } from "../lib/live.js";
import { Metric, MetricGroup, dash } from "../ui/data.jsx";

// ══════════════════════════════════════════════════════
//  ANALYTICS VIEW  — upgraded
// ══════════════════════════════════════════════════════
function AnalyticsView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const PLAYERS = usePlayersWithCareer(role);
  const [teamFilter, setTeamFilter] = useState("1XI");
  const [subView,    setSubView]    = useState("performance");
  const players = PLAYERS.filter(p=>p.team===teamFilter);

  const BarChart = ({ data, colorFn, maxVal, height=80, label }) => {
    const mx = maxVal || Math.max(...data.map(d=>d.v), 1);
    return (
      <div>
        {label&&<div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px",textTransform:"uppercase"}}>{label}</div>}
        <div style={{display:"flex",gap:"4px",alignItems:"flex-end",height:px(height)}}>
          {data.map((d,i)=>(
            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",height:"100%",justifyContent:"flex-end"}}>
              <div style={{fontFamily:D.mono,fontSize:"9px",color:colorFn?colorFn(d.v):D.textMuted}}>{d.v}</div>
              <div style={{width:"100%",borderRadius:"3px 3px 0 0",background:colorFn?colorFn(d.v):D.indigo,height:`${(d.v/mx)*100}%`,minHeight:2,opacity:0.85,transition:"height .5s"}}/>
              <div style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted,textAlign:"center",maxWidth:"40px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.l}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };


  // Phase analysis
  const PHASES = [
    { phase:"Powerplay (1–6)",    runsFor:52, runsAgainst:48, wktsFor:2,  wktsAgainst:3  },
    { phase:"Middle (7–14)",      runsFor:78, runsAgainst:62, wktsFor:3,  wktsAgainst:4  },
    { phase:"Death (15–20)",      runsFor:56, runsAgainst:44, wktsFor:5,  wktsAgainst:3  },
  ];

  // Season trend data (last 8 matches)
  const SEASON_TREND = [142,186,134,168,194,152,177,142];
  const SEASON_OPP   = [108,152,135,141,156,148,162,null];

  return (
    <div className="os-page">
      <SectionHeader title="Analytics" sub="Performance insights · KZN head-to-head · Phase analysis" color={D.sky}/>
      <div style={{display:"flex",gap:"6px",marginBottom:"16px",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:"6px"}}>
          {["1XI","U15A","U13A"].map(t=>(
            <button key={t} onClick={()=>setTeamFilter(t)} className="pressBtn" style={{
              padding:"6px 16px",borderRadius:D.pill,border:`1px solid ${teamFilter===t?D.sky+"55":D.border}`,
              background:teamFilter===t?D.sky+"14":"transparent",cursor:"pointer",
              fontFamily:D.head,fontSize:"11px",fontWeight:700,color:teamFilter===t?D.sky:D.textMuted,
            }}>{t}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:"6px",marginLeft:"auto"}}>
          {["performance","phases","h2h","matchups","table"].map(v=>(
            <button key={v} onClick={()=>setSubView(v)} className="pressBtn" style={{
              padding:"6px 14px",borderRadius:D.pill,cursor:"pointer",
              border:`1px solid ${subView===v?D.indigo+"55":D.border}`,
              background:subView===v?D.indigo+"14":"transparent",
              fontFamily:D.body,fontSize:"11px",fontWeight:subView===v?600:400,
              color:subView===v?D.textPrimary:D.textMuted,textTransform:"capitalize",
            }}>{v==="h2h"?"Head-to-Head":v==="matchups"?"Match-ups":v.charAt(0).toUpperCase()+v.slice(1)}</button>
          ))}
        </div>
      </div>

      {(subView==="performance"||subView==="phases")&&(
        /* SAID OUT LOUD, because the tab beside these two is now derived.
           Head-to-Head and Match-ups read the database; the season worm, the
           per-player bars and the phase split are still hard-coded arrays in
           this file. A screen that mixes measured and invented figures without
           marking which is which is worse than one that is honestly empty —
           and the invented head-to-head table this replaced is exactly how
           that goes wrong. Converting these is the next piece of work:
           `phases` is already a permission-scoped read this module claims. */
        <Card sx={{padding:"10px 14px",marginBottom:"12px",border:`1px solid ${D.amber}33`,background:`${D.amber}0c`}}>
          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5}}>
            <Badge color={D.amber}>demonstration</Badge>{" "}
            {"These figures are illustrative, not your school's. Head-to-Head and Match-ups are derived from the database; this tab is not yet."}
          </div>
        </Card>
      )}

      {subView==="performance"&&(
        <>
          {/* Season worm */}
          <Card sx={{padding:"16px",marginBottom:"14px"}}>
            <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"14px"}}>Season Scores — Last 8 Matches</div>
            <div style={{position:"relative",height:"100px"}}>
              <svg viewBox={`0 0 ${SEASON_TREND.length*60} 100`} style={{width:"100%",height:"100px",overflow:"visible"}}>
                {/* Hilton line */}
                <polyline
                  points={SEASON_TREND.map((v,i)=>`${i*60+30},${100-(v/220)*90}`).join(" ")}
                  fill="none" stroke={D.emerald} strokeWidth="2" strokeLinejoin="round"/>
                {/* Opponent line */}
                <polyline
                  points={SEASON_OPP.filter(v=>v!==null).map((v,i)=>`${i*60+30},${100-(v/220)*90}`).join(" ")}
                  fill="none" stroke={D.rose} strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 3"/>
                {/* Dots */}
                {SEASON_TREND.map((v,i)=>(
                  <g key={i}>
                    <circle cx={i*60+30} cy={100-(v/220)*90} r="4" fill={D.emerald} stroke={D.surf1} strokeWidth="2"/>
                    <text x={i*60+30} y={100-(v/220)*90-8} textAnchor="middle" fontSize="8" fill={D.emerald} fontFamily={D.mono}>{v}</text>
                  </g>
                ))}
                {SEASON_OPP.filter(v=>v!==null).map((v,i)=>(
                  <circle key={i} cx={i*60+30} cy={100-(v/220)*90} r="3" fill={D.rose} stroke={D.surf1} strokeWidth="1.5"/>
                ))}
              </svg>
            </div>
            <div style={{display:"flex",gap:"16px",marginTop:"8px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}><div style={{width:20,height:2,background:D.emerald}}/><span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Hilton</span></div>
              <div style={{display:"flex",alignItems:"center",gap:"6px"}}><div style={{width:20,height:2,background:D.rose,borderTop:"2px dashed"+(D.rose)}}/><span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Opposition</span></div>
            </div>
          </Card>
          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"14px",marginBottom:"14px"}}>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Batting Averages"
                data={players.filter(p=>p.avg>0).sort((a,b)=>b.avg-a.avg).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.avg}))}
                colorFn={v=>v>=40?D.emerald:v>=25?D.sky:D.amber}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Strike Rates"
                data={players.filter(p=>p.sr>0).sort((a,b)=>b.sr-a.sr).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.sr}))}
                maxVal={200} colorFn={v=>v>=130?D.emerald:v>=100?D.sky:D.orange}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Wickets Taken"
                data={players.filter(p=>p.wkts>0).sort((a,b)=>b.wkts-a.wkts).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.wkts}))}
                colorFn={v=>v>=20?D.rose:v>=12?D.violet:D.indigo}/>
            </Card>
            <Card sx={{padding:"16px"}}>
              <BarChart label="Bowling Economy"
                data={players.filter(p=>p.econ>0).sort((a,b)=>a.econ-b.econ).slice(0,7).map(p=>({l:p.name.split(" ").pop().slice(0,7),v:p.econ}))}
                maxVal={12} colorFn={v=>v<=6.5?D.emerald:v<=8?D.amber:D.rose}/>
            </Card>
          </div>
        </>
      )}

      {subView==="phases"&&(
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
          {PHASES.map(ph=>{
            const netRPO = ((ph.runsFor - ph.runsAgainst)/8).toFixed(1);
            return (
              <Card key={ph.phase} sx={{padding:"16px"}}>
                <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"12px"}}>{ph.phase}</div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-5,1fr 1fr 1fr 1fr 1fr)",gap:"10px"}}>
                  {[
                    ["Runs Scored",    ph.runsFor,          D.emerald],
                    ["Runs Conceded",  ph.runsAgainst,      D.rose],
                    ["Wkts Batting",   `${ph.wktsFor} lost`,D.amber],
                    ["Wkts Bowling",   `${ph.wktsAgainst} taken`,D.violet],
                    ["Net RPO",        netRPO>=0?`+${netRPO}`:netRPO, Number(netRPO)>=0?D.emerald:D.rose],
                  ].map(([l,v,c])=>(
                    <div key={l} style={{textAlign:"center",padding:"10px 6px",background:D.surf2,borderRadius:D.md}}>
                      <div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:700,color:c}}>{v}</div>
                      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"4px"}}>{l}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:"12px",display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"8px"}}>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>Batting run rate</div>
                    <ProgressBar pct={Math.min(100,(ph.runsFor/8/12)*100)} color={D.emerald}/>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.emerald,marginTop:"2px"}}>{(ph.runsFor/8).toFixed(1)} RPO</div>
                  </div>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>Conceded run rate</div>
                    <ProgressBar pct={Math.min(100,(ph.runsAgainst/8/12)*100)} color={D.rose}/>
                    <div style={{fontFamily:D.mono,fontSize:"10px",color:D.roseText,marginTop:"2px"}}>{(ph.runsAgainst/8).toFixed(1)} RPO</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {subView==="h2h"&&<HeadToHead role={role} teamFilter={teamFilter}/>}

      {subView==="matchups"&&<Matchups role={role}/>}

      {subView==="table"&&(
        <Card>
          <div style={{padding:"14px 16px",borderBottom:`1px solid ${D.border}`}}>
            <span style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Full Squad Stats — {teamFilter}</span>
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:D.surf2}}>
                  {["Player","Role","Hand","Avg","SR","Wkts","Econ","Form","Status"].map(h=>(
                    <th key={h} style={{padding:"9px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:h==="Player"?"left":"center",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((p,i)=>{
                  const rCol = p.role==="BAT"?D.sky:p.role==="BOWL"?D.violet:p.role==="ALL"?D.emerald:D.amber;
                  return (
                    <tr key={p.id} style={{borderTop:`1px solid ${D.border}`,background:i%2===0?"transparent":D.surf2+"44"}}>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <Avatar name={p.name} size={26} color={rCol}/>
                          <div>
                            <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textPrimary}}>{p.name}</div>
                            {p.cap&&<span style={{fontFamily:D.mono,fontSize:"9px",color:D.amber}}>({p.cap})</span>}
                          </div>
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={rCol}>{p.role}</Badge></td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"11px",color:p.batHand==="L"?D.amber:D.sky}}>{p.batHand}HB</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",fontWeight:500,color:p.avg>=40?D.emerald:p.avg>=25?D.sky:D.amber}}>{p.avg}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.sr>=130?D.emerald:p.sr>=100?D.sky:D.amber}}>{p.sr}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.wkts>=15?D.rose:p.wkts>=8?D.violet:D.textMuted}}>{p.wkts||"—"}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",fontFamily:D.mono,fontSize:"12px",color:p.econ&&p.econ<=6.5?D.emerald:p.econ&&p.econ<=8?D.amber:p.econ?D.rose:D.textMuted}}>{p.econ||"—"}</td>
                      <td style={{padding:"10px 12px"}}>
                        <div style={{display:"flex",gap:"2px"}}>
                          {p.form.slice(-5).map((v,j)=>(
                            <div key={j} style={{width:"13px",height:"13px",borderRadius:"2px",background:v===0?D.rose+"55":v>=5?D.amber+"66":D.emerald+"44",display:"flex",alignItems:"center",justifyContent:"center"}}>
                              <span style={{fontFamily:D.mono,fontSize:"9px",color:v===0?D.rose:v>=5?D.amber:D.emerald,fontWeight:700}}>{v===0?"W":v}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td style={{padding:"10px 12px",textAlign:"center"}}><Badge color={fitnessColor(p.fitness)}>{p.fitness}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  HEAD-TO-HEAD — derived from the fixtures, never a stored tally
//
//  beta-2 kept winsA/winsB/draws on the rivalry row, and this screen showed a
//  hand-written table of six KZN schools with invented results. Both are gone
//  for the same reason: a scorecard corrected in March leaves a stored tally
//  wrong for ever with nothing able to say which number was right, and an
//  invented one was never right to begin with.
//
//  TWO THINGS THIS DRAWS THAT A RECORD USUALLY HIDES.
//
//  `undecided` — a fixture whose toss was never recorded has known scores and
//  no attributable winner. The server counts those rather than dropping them
//  or handing them to whoever looks likelier, and so the win rate here is over
//  the DECIDED games, with the undecided ones named beside it. A rivalry
//  reading "won 6" when two more were played that nobody can judge is a lie of
//  omission.
//
//  The scope — this is counted over the fixtures THIS READER may see, so two
//  people at one school can legitimately get different totals for the same
//  rivalry. A record "corrected" over matches the reader cannot see would
//  disclose that those matches exist.
// ══════════════════════════════════════════════════════
const RESULT_TONE = { won: D.emerald, lost: D.rose, tied: D.amber, undecided: D.textMuted };
const day = (t) => (t ? new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—");

function HeadToHead({ role, teamFilter }) {
  const { rows, live, loading, error, disabled } = useLive("derby_record", role, 0, { teamCode: teamFilter });
  if (loading) return <EmptyState loading/>;
  if (disabled) return <EmptyState icon="⊘" message="Analytics is switched off for this school."/>;
  if (error) return <EmptyState error/>;
  if (!rows.length) return <EmptyState icon="🏏" message={`No completed fixtures for ${teamFilter} that you may see — a record is derived from them, so there is nothing to derive one from yet.`}/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}} data-testid="h2h">
      <Card sx={{padding:"14px 16px",background:`linear-gradient(135deg,${D.indigo}08,${D.surf1})`,border:`1px solid ${D.indigo}22`}}>
        <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.indigoText,marginBottom:"4px"}}>Head-to-head record ({teamFilter})</div>
        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
          {live ? "Derived from completed fixtures you may see, and from the toss that decided each one. Nothing here is stored."
                : "Demonstration figures — no server connected."}
        </div>
      </Card>
      {rows.map(r=>(
        <Card key={`${r.school}:${r.rivalKey}`} sx={{padding:"14px 16px"}} data-testid={`h2h-${r.rivalKey}`}>
          <div style={{display:"flex",alignItems:"center",gap:"14px",flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:"150px"}}>
              <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"3px"}}>
                {r.title || r.opponent}
                {r.title&&<span style={{fontFamily:D.body,fontSize:"11px",fontWeight:400,color:D.textMuted}}> · {r.opponent}</span>}
              </div>
              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
                Last played {day(r.lastPlayed)}{r.sinceYear?` · contested since ${r.sinceYear}`:""}
              </div>
            </div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
              {[["P",r.played,D.textMuted],["W",r.won,D.emerald],["L",r.lost,D.rose],["T",r.tied,D.amber],["?",r.undecided,D.textMuted]].map(([l,v,c])=>(
                <div key={l} style={{textAlign:"center",padding:"7px 10px",background:D.surf2,borderRadius:D.md,minWidth:"36px"}}>
                  <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:700,color:c}}>{v}</div>
                  <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{minWidth:"120px"}}>
              {/* Over the DECIDED games, and the denominator is stated. A
                  percentage over `played` would silently count a fixture
                  nobody can judge as one we did not win. */}
              <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginBottom:"4px"}}>
                Win rate {r.decided?`of ${r.decided} decided`:""}
              </div>
              {r.winPct==null ? (
                <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Not decidable — no toss on record</div>
              ) : (
                <>
                  <ProgressBar pct={r.winPct} color={r.winPct>=60?D.emerald:r.winPct>=40?D.amber:D.rose}/>
                  <div style={{fontFamily:D.mono,fontSize:"10px",marginTop:"2px",color:r.winPct>=60?D.emerald:r.winPct>=40?D.amber:D.roseText}}>{r.winPct}%</div>
                </>
              )}
            </div>
          </div>
          {r.undecided>0&&(
            <div style={{fontFamily:D.body,fontSize:"10px",color:D.amber,marginTop:"8px"}}>
              {r.undecided===r.played
                ? `No toss is recorded for ${r.played===1?"this fixture":"any of these"}, so the scores are known and the winner is not.`
                : `${r.undecided} of these ${r.played} had no toss recorded, so the scores are known and the winner is not.`}
            </div>
          )}
          {r.recent.length>0&&(
            <div style={{display:"flex",gap:"5px",marginTop:"10px",flexWrap:"wrap"}}>
              {r.recent.map((g,i)=>(
                <span key={i} title={`${day(g.startsAt)} · ${g.team} · ${dash(g.firstRuns)} v ${dash(g.secondRuns)}`}
                  style={{padding:"2px 8px",borderRadius:D.pill,fontFamily:D.mono,fontSize:"9px",
                          background:(RESULT_TONE[g.result]??D.textMuted)+"18",
                          border:`1px solid ${(RESULT_TONE[g.result]??D.textMuted)}30`,
                          color:RESULT_TONE[g.result]===D.rose?D.roseText:(RESULT_TONE[g.result]??D.textMuted)}}>
                  {g.firstRuns==null&&g.secondRuns==null
                    ? `${g.result==="undecided"?"?":g.result[0].toUpperCase()} no score`
                    : `${g.result==="undecided"?"?":g.result[0].toUpperCase()} ${dash(g.firstRuns)}–${dash(g.secondRuns)}`}
                </span>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  MATCH-UPS — the one question a coach asks out loud before a fixture
//
//  How has this boy gone against this bowler. Derived from ball_event's
//  striker_id and bowler_id, which were added so attribution would be
//  available to readers that are not the scoring device.
//
//  THE COVERAGE IS NOT OPTIONAL. Most bowlers a school's batter faces are not
//  SCRBRD players: a fixture against a school that is not a tenant has no away
//  roster, so the scorer types a name and the delivery carries no bowler_id.
//  Those balls are real and they are invisible to this table. Showing "12
//  balls faced" without saying 300 others were ignored is stating something
//  false with a number on it, so the coverage is read beside the pairs and
//  drawn above them.
// ══════════════════════════════════════════════════════
function Matchups({ role }) {
  const [batter, setBatter] = useState("");
  const pairs = useLive("matchups", role, 0, batter ? { batterId: batter } : null);
  const cover = useLive("matchup_coverage", role, 0, batter ? { batterId: batter } : null);
  const cov = cover.rows[0] ?? null;
  const batters = [...new Map(pairs.rows.map(p=>[p.batterId,p.batterName])).entries()];

  if (pairs.loading) return <EmptyState loading/>;
  if (pairs.disabled) return <EmptyState icon="⊘" message="Analytics is switched off for this school."/>;
  if (pairs.error) return <EmptyState error/>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}} data-testid="matchups">
      {cov&&(
        <Card sx={{padding:"14px 16px"}}>
          <MetricGroup min={150}>
            <Metric size="sm" label="Deliveries attributed" value={dash(cov.attributable)}
                    sub={cov.pct==null?"nothing logged yet":`${cov.pct}% of ${cov.deliveries} in the log`}/>
            <Metric size="sm" label="Not attributable" value={dash(cov.unattributable)}
                    sub="no bowler id — an opponent who is not on SCRBRD"
                    tone={cov.unattributable?D.amber:undefined}/>
            <Metric size="sm" label="Pairs" value={pairs.rows.length} sub="batter against bowler"/>
          </MetricGroup>
          {cov.unattributable>0&&(
            /* One template literal rather than prose around three
               interpolations: check-imports reads the words between two
               expressions as identifiers, and a sentence is not a reference. */
            <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,marginTop:"10px",lineHeight:1.6}}>
              {`The table below speaks for ${cov.attributable} of ${cov.deliveries} deliveries. The other ${cov.unattributable} were bowled by somebody with no record here, a school that does not keep its roster on this platform, and no match-up is derivable from them. They are not missing data; they are deliveries nobody named.`}
            </div>
          )}
        </Card>
      )}

      {batters.length>1&&(
        <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}} role="group" aria-label="Whose match-ups">
          <button type="button" onClick={()=>setBatter("")} aria-pressed={batter===""} className="pressBtn"
            style={{padding:"4px 12px",borderRadius:D.pill,cursor:"pointer",border:`1px solid ${batter===""?D.sky:D.border}`,
                    background:"transparent",fontFamily:D.mono,fontSize:"10px",color:batter===""?D.textPrimary:D.textMuted}}>Everyone</button>
          {batters.map(([id,name])=>(
            <button key={id} type="button" onClick={()=>setBatter(id)} aria-pressed={batter===id} className="pressBtn"
              data-testid={`matchup-batter-${id}`}
              style={{padding:"4px 12px",borderRadius:D.pill,cursor:"pointer",border:`1px solid ${batter===id?D.sky:D.border}`,
                      background:"transparent",fontFamily:D.mono,fontSize:"10px",color:batter===id?D.textPrimary:D.textMuted}}>{name}</button>
          ))}
        </div>
      )}

      {pairs.rows.length===0 ? (
        <EmptyState icon="🎯" message="No attributed pairs yet — a match-up needs both a striker and a bowler on record for the same delivery."/>
      ) : (
        <Card>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead>
                <tr style={{background:D.surf2}}>
                  {["Batter","Bowler","Style","Balls","Runs","SR","Dots","4s","6s","Out"].map(h=>(
                    <th key={h} style={{padding:"9px 12px",fontFamily:D.head,fontSize:"9px",fontWeight:700,color:D.textMuted,
                                        letterSpacing:"0.08em",textTransform:"uppercase",
                                        textAlign:h==="Batter"||h==="Bowler"||h==="Style"?"left":"right",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pairs.rows.map(p=>(
                  <tr key={`${p.batterId}:${p.bowlerId}`} style={{borderTop:`1px solid ${D.border}`}}
                      data-testid={`matchup-${p.batterId}-${p.bowlerId}`}>
                    <td style={{padding:"9px 12px",fontFamily:D.body,fontSize:"12px",color:D.textPrimary}}>{p.batterName}</td>
                    <td style={{padding:"9px 12px",fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>{p.bowlerName}</td>
                    <td style={{padding:"9px 12px",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>{p.bowlingStyle??"—"}</td>
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:D.mono,fontSize:"12px",color:D.textSecondary}}>{p.balls}</td>
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:D.mono,fontSize:"12px",color:D.textPrimary}}>{p.runs}</td>
                    {/* A strike rate off a handful of balls is noise, so it is
                        shown with the ball count beside it and never alone.
                        The thirty-ball floor the dossier applies belongs to the
                        server for a figure about ANOTHER school's child; here
                        the reader is looking at their own side and the sample
                        is on the row. */}
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:D.mono,fontSize:"12px",
                                color:p.balls<12?D.textMuted:p.strikeRate>=130?D.emerald:p.strikeRate>=100?D.sky:D.amber}}>
                      {p.strikeRate==null?"—":p.strikeRate.toFixed(1)}
                      {p.balls<12&&<span style={{fontSize:"9px",color:D.textMuted}}> thin</span>}
                    </td>
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>{p.dots}</td>
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:D.mono,fontSize:"12px",color:D.indigoText}}>{p.fours}</td>
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:D.mono,fontSize:"12px",color:D.amber}}>{p.sixes}</td>
                    <td style={{padding:"9px 12px",textAlign:"right",fontFamily:D.mono,fontSize:"12px",color:p.dismissals?D.roseText:D.textMuted}}>{p.dismissals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export { AnalyticsView };
