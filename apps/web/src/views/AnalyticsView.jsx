
import { useState } from "react";
import { D, px, textOn, themed } from "../design/tokens.js";
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

      {subView==="performance"&&(
        /* SAID OUT LOUD, because the tab beside these two is now derived.
           Phases, Head-to-Head and Match-ups read the database; the season
           worm and the per-player bars are still hard-coded arrays in this
           file. A screen that mixes measured and invented figures without
           marking which is which is worse than one that is honestly empty —
           and the invented head-to-head table this replaced is exactly how
           that goes wrong. These two need a career read per player over a
           season, which is not one of this module's reads yet. */
        <Card sx={{padding:"10px 14px",marginBottom:"12px",border:`1px solid ${D.amber}33`,background:`${D.amber}0c`}}>
          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,lineHeight:1.5}}>
            <Badge color={D.amber}>demonstration</Badge>{" "}
            {"These figures are illustrative, not your school's. Phases, Head-to-Head and Match-ups are derived from the database; this tab is not yet."}
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

      {subView==="phases"&&<Phases role={role}/>}

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
const RESULT_TONE = themed(() => ({ won: D.emerald, lost: D.rose, tied: D.amber, undecided: D.textMuted }));
const day = (t) => (t ? new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—");

function HeadToHead({ role, teamFilter }) {
  const { rows, live, loading, error, disabled } = useLive("derby_record", role, 0, { teamCode: teamFilter });
  if (loading) return <EmptyState loading/>;
  if (disabled) return <EmptyState icon="ban" message="Analytics is switched off for this school."/>;
  if (error) return <EmptyState error/>;
  if (!rows.length) return <EmptyState icon="bat" message={`No completed fixtures for ${teamFilter} that you may see — a record is derived from them, so there is nothing to derive one from yet.`}/>;

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
  if (pairs.disabled) return <EmptyState icon="ban" message="Analytics is switched off for this school."/>;
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
        <EmptyState icon="target" message="No attributed pairs yet — a match-up needs both a striker and a bowler on record for the same delivery."/>
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

// ══════════════════════════════════════════════════════
//  PHASES — an innings in three parts, folded not stored
//
//  A coach who only sees "142 for 6" cannot tell whether the side lost the
//  powerplay or threw away the death, and those are different problems with
//  different answers in the nets.
//
//  This tab used to be three hard-coded rows with a runsFor/runsAgainst pair
//  invented across a whole season. The real read is PER FIXTURE, and the
//  comparison it offers is better than the one that was invented: a second
//  innings carries `par` — what the other side made in the same phase — and
//  `vsPar`, the gap. That is the "for and against" the fabricated table was
//  reaching for, derived per match from the actual log rather than asserted
//  over a season nobody counted.
//
//  FOUR NULLS THIS MUST DRAW RATHER THAN ZERO:
//
//    runRate null      no balls bowled in the phase. Not a run rate of zero.
//    controlPct null   no contact was recorded on any delivery. A QUICK
//                      capture profile records none, and a control figure over
//                      every ball would report a batter as out of touch when
//                      nobody was watching that closely.
//    par / vsPar null  a FIRST innings, which by definition has nothing yet to
//                      be level with. The order is not symmetric: the chase is
//                      measured against the total, never the other way round.
//    played false      the innings was too short for the phase to exist. A
//                      twelve-over innings has no death overs, and drawing an
//                      empty card labelled "0 runs" would invent one.
//
//  And a match with no deliveries comes back with NO innings rather than an
//  innings of zeros, which is the difference between "not scored yet" and
//  "nobody scored".
// ══════════════════════════════════════════════════════
const PHASE_TONE = themed(() => ({ powerplay: D.sky, middle: D.violet, death: D.orange }));

/**
 * A percentage, or an em dash where the fold withheld one.
 *
 * A STRING, not a component, and that is not a style preference: Metric
 * renders its `value` through dash(), which stringifies — so a node handed to
 * it arrives on screen as "[object Object]". It was, until the walk's own
 * falsification exposed it. The reason a figure is missing belongs in the
 * metric's `sub`, which does take a node, and never in a zero.
 */
const pctText = (v) => (v == null ? "—" : `${v}%`);

function Phases({ role }) {
  const { rows: MATCHES } = useLive("matches", role);
  // Only a fixture that has been played has a log to fold. A scheduled one
  // would come back with no innings, which is honest but is not a useful
  // default to land on.
  const played = MATCHES.filter((m) => m.status === "complete" || m.status === "live");
  const [matchId, setMatchId] = useState("");
  const chosen = matchId || played[0]?.id || "";
  const { rows, loading, error, disabled } = useLive("phases", role, 0, chosen ? { matchId: chosen } : null);
  const match = played.find((m) => m.id === chosen);

  if (!played.length) {
    return <EmptyState icon="bat" message="No played fixture you may see — a phase breakdown is folded from a ball log, so there is nothing to fold yet."/>;
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}} data-testid="phases">
      <div style={{display:"flex",gap:"5px",flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:".08em",
                      textTransform:"uppercase",color:D.textMuted,marginRight:"4px"}}>Fixture</span>
        {played.slice(0, 8).map((m) => (
          <button key={m.id} type="button" onClick={()=>setMatchId(m.id)} aria-pressed={chosen===m.id}
            className="pressBtn" data-testid={`phases-match-${m.id}`}
            style={{padding:"4px 12px",borderRadius:D.pill,cursor:"pointer",
                    border:`1px solid ${chosen===m.id?D.sky:D.border}`,background:"transparent",
                    fontFamily:D.mono,fontSize:"10px",color:chosen===m.id?D.textPrimary:D.textMuted}}>
            {m.awayTeam} · {m.date}
          </button>
        ))}
      </div>

      {loading&&<EmptyState loading/>}
      {disabled&&<EmptyState icon="ban" message="Analytics is switched off for this school."/>}
      {error&&<EmptyState error/>}

      {!loading&&!error&&!disabled&&rows.length===0&&(
        <EmptyState icon="scorebook" message={`${match?.awayTeam ?? "This fixture"} has no deliveries on record — it has not been scored, which is not the same as nobody scoring.`}/>
      )}

      {rows.map((inn) => (
        <div key={inn.innings} data-testid={`phases-innings-${inn.innings}`}>
          <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,margin:"4px 0 8px"}}>
            {inn.innings===1?"First innings":"Second innings"}
            {inn.innings===2&&<span style={{fontFamily:D.body,fontSize:"11px",fontWeight:400,color:D.textMuted}}>
              {" "}· measured against the first
            </span>}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            {["powerplay","middle","death"].map((k) => {
              const ph = inn.phases?.[k];
              if (!ph) return null;
              const tone = PHASE_TONE[k];
              // A phase the innings was too short to contain. Named, not drawn
              // as an empty card of zeros.
              if (!ph.played) {
                return (
                  <Card key={k} sx={{padding:"10px 16px"}} data-testid={`phase-${inn.innings}-${k}`}>
                    <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
                      {`${ph.label} — this innings was too short to have one.`}
                    </div>
                  </Card>
                );
              }
              return (
                <Card key={k} sx={{padding:"14px 16px"}} data-testid={`phase-${inn.innings}-${k}`}>
                  <div style={{display:"flex",alignItems:"baseline",gap:"10px",marginBottom:"12px",flexWrap:"wrap"}}>
                    <span style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:textOn(tone)}}>{ph.label}</span>
                    <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>overs {ph.overs}</span>
                    <span style={{flex:1}}/>
                    <span style={{fontFamily:D.mono,fontSize:"18px",fontWeight:700,color:D.textPrimary}}>
                      {ph.runs}<span style={{fontSize:"12px",color:D.textMuted}}>/{ph.wickets}</span>
                    </span>
                    <span style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>
                      {ph.runRate==null?"— no balls":`${ph.runRate} RPO`}
                    </span>
                  </div>
                  <MetricGroup min={104}>
                    <Metric size="sm" label="Balls" value={ph.balls}/>
                    <Metric size="sm" label="Dots" value={ph.dots}
                            sub={ph.dotPct==null?"no balls bowled":`${ph.dotPct}% of the phase`}/>
                    <Metric size="sm" label="Boundaries" value={ph.fours+ph.sixes}
                            sub={`${ph.fours} four${ph.fours===1?"":"s"}, ${ph.sixes} six${ph.sixes===1?"":"es"}`}/>
                    <Metric size="sm" label="Strike turned" value={pctText(ph.strikeRotationPct)}
                            sub={ph.strikeRotationPct==null?"no balls bowled":"singles and threes"}/>
                    {/* Control, over the deliveries where contact was actually
                        recorded — never over every ball. A null is an em dash
                        and the sub says nobody was watching that closely,
                        which is a different claim from "he middled nothing". */}
                    <Metric size="sm" label="Middled" value={pctText(ph.controlPct)}
                            data-testid={`control-${inn.innings}-${k}`}
                            sub={ph.assessed?`${ph.middled} of ${ph.assessed} assessed`:"no contact recorded"}/>
                    <Metric size="sm" label="Beaten" value={pctText(ph.beatenPct)}
                            data-testid={`beaten-${inn.innings}-${k}`}
                            sub={ph.assessed?`${ph.beaten} of ${ph.assessed} assessed`:"no contact recorded"}
                            tone={ph.beatenPct!=null&&ph.beatenPct>=30?D.amber:undefined}/>
                  </MetricGroup>
                  {/* The comparison the fabricated table was reaching for,
                      done per fixture. Absent in a first innings by design. */}
                  {ph.par!=null&&(
                    <div style={{marginTop:"10px",paddingTop:"10px",borderTop:`1px solid ${D.border}`,
                                 display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
                      <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
                        {`They made ${ph.par} in this phase.`}
                      </span>
                      <span style={{fontFamily:D.mono,fontSize:"12px",fontWeight:700,
                                    color:ph.vsPar>0?D.emerald:ph.vsPar<0?D.roseText:D.textMuted}}>
                        {ph.vsPar>0?`+${ph.vsPar}`:String(ph.vsPar)}
                      </span>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,lineHeight:1.6,maxWidth:"680px"}}>
        Folded from the ball log through the same reducer the scorer&rsquo;s device runs, over the deliveries you may
        see — so two people can legitimately get different figures for the same match, and that is the model working
        rather than a fault. Nothing here is stored.
      </div>
    </div>
  );
}

export { AnalyticsView };
