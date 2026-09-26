
import { useMemo, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { fitnessColor, roleColor, stat } from "../lib/format.js";
import { SR } from "../scorer/format.js";
import { Avatar, Badge, Btn, Card, Input, Modal, RadarChart, SectionHeader, Select } from "../ui/primitives.jsx";
import { SegmentedControl } from "../ui/data.jsx";
import { usePlayersWithCareer, useSkills } from "../lib/live.js";
import { api } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";
import { holdsCapability } from "../rbac/index.js";
import { resolveBirthDate, BIRTH_DATE_MESSAGE } from "@scrbrd/policy/date-of-birth";
import { ageAtCutoff, compareTeams, isEligible, parseTeam, teamLabel, teamsForLevel } from "@scrbrd/policy/teams";

// U13 through U16 is an upper bound only — "a gifted twelve-year-old plays
// U14, and that is normal" (packages/policy/src/teams.mjs). So a school-age
// band is read off the SAME cut-off isEligible() judges by, purely to tell a
// parent or coach what it will say, never to gate the form: nothing here
// blocks naming a boy to a side he is a year young for.
function schoolBand(age) {
  if (age == null) return null;
  if (age <= 13) return "U13";
  if (age <= 14) return "U14";
  if (age <= 15) return "U15";
  if (age <= 16) return "U16";
  return "open";
}

// ══════════════════════════════════════════════════════
//  SQUAD VIEW
// ══════════════════════════════════════════════════════
function SquadView({ role }) {
  const [rosterNonce, setRosterNonce] = useState(0);
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  const PLAYERS = usePlayersWithCareer(role, rosterNonce);
  const SKILLS_MATRIX = useSkills(role);
  const [team, setTeam]           = useState("1XI");
  const [selected, setSelected]   = useState(null);
  const [addModal, setAddModal]   = useState(false);
  const [np, setNp] = useState({ fullName:"", teamCode:"1XI", playingRole:"batter",
    battingStyle:"R", bowlingArm:"", bowlingStyle:"", squadNo:"", born:"", idNumber:"" });
  const [npSaid, setNpSaid] = useState("");
  const addSchools = schoolsWhere("player.profile.manage");
  const players = PLAYERS.filter(p=>p.team===team);
  const teams = [...new Set(PLAYERS.map(p=>p.team))];
  // The same capability the insert policy on `player` actually checks —
  // player.profile.manage, held by directorofsport, schooladmin and
  // sportsadmin. The role-name list this replaced was wrong in both
  // directions at once: it granted the button to "coach", who holds no such
  // capability and would have every click refused by the database, and
  // withheld it from directorofsport and sportsadmin, who hold it and could
  // not reach it.
  const canEdit = holdsCapability(role, "player.profile.manage");

  // playing_role's real vocabulary — 'batter'/'bowler'/'allrounder'/'keeper',
  // the same CHECK constraint enforces on the table. This compared against
  // 'BAT'/'BOWL'/'ALL' instead, which no live row has ever held, so every
  // badge and avatar on this screen has always rendered amber — the
  // fall-through case — regardless of what a player actually plays as.
  const roleColor = r => r==="batter"?D.sky:r==="bowler"?D.violet:r==="allrounder"?D.emerald:D.amber;

  // ── Add Player: age, once a date of birth is on the form ──────────
  // ageAtCutoff is the SAME function a match's own eligibility check calls
  // (packages/policy/src/teams.mjs), so what this form tells a school
  // administrator can never disagree with what team selection later enforces.
  // Resolved as the office types, so "that ID number carries a different
  // birthday" lands beside the field rather than as a refusal after saving.
  const npDob = (np.born || np.idNumber) ? resolveBirthDate({ born: np.born, idNumber: np.idNumber }) : null;
  // The band is read from whichever of the two actually supplied the date —
  // an ID number typed with no birthday still names the age band.
  const npBornEffective = npDob?.ok ? npDob.born : np.born;
  const npAge = npBornEffective ? ageAtCutoff(npBornEffective, new Date(), "school") : null;
  const npBand = schoolBand(npAge);

  // Every team a school-level side can be, plus whatever is already on the
  // roster (a division the platform's own generator would not otherwise
  // offer, but a real school already fields). Age is an upper bound only —
  // ineligible options are named, never removed or disabled, because a
  // gifted boy playing up a band is normal cricket, not an error.
  const teamOptions = useMemo(() => {
    const codes = [...new Set([...teamsForLevel("school"), ...teams])].sort(compareTeams);
    return codes.map((code) => {
      const t = parseTeam(code);
      const eligible = npAge == null || !t ? true : isEligible(npAge, code);
      return { value: code, label: eligible ? teamLabel(code) : `${teamLabel(code)} — too old (turns ${npAge})` };
    });
  }, [teams, npAge]);

  const npEligible = npAge == null ? null : isEligible(npAge, np.teamCode);

  // A squad number is a real, visible clash on a team sheet, not a database
  // constraint — two boys can share one for a day while it gets sorted out —
  // so this warns rather than blocks, the same posture as the age note above.
  const squadClash = np.squadNo !== "" && PLAYERS.find(
    (p) => p.team === np.teamCode && String(p.squadNo ?? "") === String(np.squadNo) && p.squadNo != null);

  const showBowling = np.playingRole === "bowler" || np.playingRole === "allrounder";
  return (
    <div className="os-page">
      <SectionHeader title="Squad Management" sub="Player rosters, profiles and availability" color={D.sky}
        actions={canEdit&&<Btn size="sm" onClick={()=>setAddModal(true)}>+ Add Player</Btn>}/>
      <div style={{display:"flex",gap:"8px",marginBottom:"20px"}}>
        {teams.map(t=>(
          <button key={t} onClick={()=>{setTeam(t);setSelected(null);}} className="pressBtn" style={{
            padding:"7px 18px",borderRadius:D.pill,border:`1px solid ${team===t?D.sky+"55":D.border}`,
            background:team===t?D.sky+"14":"transparent",cursor:"pointer",
            fontFamily:D.head,fontSize:"12px",fontWeight:700,color:team===t?D.sky:D.textMuted,
          }}>{t}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:selected?"1fr 320px":"1fr",gap:"16px"}}>
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"12px"}}>
            {players.map(p=>(
              <Card key={p.id} onClick={()=>setSelected(p)} sx={{
                padding:"14px",cursor:"pointer",
                border:`1px solid ${selected?.id===p.id?D.sky+"55":p.fitness==="injured"?D.rose+"22":D.border}`,
                background:selected?.id===p.id?D.sky+"08":p.fitness==="injured"?D.rose+"05":D.surf1,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"10px"}}>
                  <div style={{position:"relative"}}>
                    <Avatar name={p.name} size={40} color={roleColor(p.role)}/>
                    <div style={{position:"absolute",bottom:-2,right:-2,width:"11px",height:"11px",borderRadius:"50%",background:fitnessColor(p.fitness),border:`1.5px solid ${D.surf1}`}}/>
                  </div>
                  <div>
                    <div style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.textPrimary,lineHeight:1.2}}>
                      {p.name} {p.cap==="c"?"(c)":p.cap==="vc"?"(vc)":""}
                    </div>
                    <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>{p.age}y · {p.batHand}HB · {p.bowlArm==="L"?"LA":"RA"}{p.bowlStyle}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"8px"}}>
                  <Badge color={roleColor(p.role)}>{p.role}</Badge>
                  <Badge color={fitnessColor(p.fitness)}>{p.fitness}</Badge>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"4px"}}>
                  <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                    <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.sky}}>{stat(p.avg)}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>avg</div>
                  </div>
                  {p.wkts>0?(
                    <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.violetText}}>{stat(p.wkts)}</div>
                      <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>wkts</div>
                    </div>
                  ):(
                    <div style={{textAlign:"center",padding:"5px",background:D.surf2,borderRadius:D.sm}}>
                      <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:500,color:D.amber}}>{stat(p.sr)}</div>
                      <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>SR</div>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
        {/* Player detail */}
        {selected&&(
          <Card sx={{padding:"16px",position:"sticky",top:"16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:"14px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <Avatar name={selected.name} size={48} color={roleColor(selected.role)}/>
                <div>
                  <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{selected.name}</div>
                  <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>{selected.team} · Age {selected.age}</div>
                </div>
              </div>
              <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",cursor:"pointer",color:D.textMuted,fontSize:"16px"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"14px"}}>
              <Badge color={roleColor(selected.role)}>{selected.role}</Badge>
              <Badge color={fitnessColor(selected.fitness)}>{selected.fitness}</Badge>
              <Badge color={selected.batHand==="L"?D.amber:D.sky}>{selected.batHand}HB</Badge>
              <Badge color={selected.bowlArm==="L"?D.violet:D.emerald}>{selected.bowlArm==="L"?"LA":"RA"}{selected.bowlStyle}</Badge>
            </div>
            <div style={{marginBottom:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px"}}>SEASON STATS</div>
              <div style={{display:"grid",gridTemplateColumns:"var(--g-3,1fr 1fr 1fr)",gap:"6px"}}>
                {[["AVG",stat(selected.avg),D.sky],["SR",stat(selected.sr),D.amber],["WKTS",stat(selected.wkts),D.violet],["ECON",stat(selected.econ),D.emerald],["AGE",selected.age,D.textMuted],[selected.cap?"ROLE":"",(selected.cap||"").toUpperCase()||"-",D.amber]].filter(([l])=>l).map(([l,v,c])=>(
                  <div key={l} style={{textAlign:"center",padding:"7px 4px",background:D.surf2,borderRadius:D.sm}}>
                    <div style={{fontFamily:D.mono,fontSize:"14px",fontWeight:500,color:c}}>{v}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted,marginTop:"2px"}}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{marginBottom:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"8px"}}>RECENT FORM</div>
              <div style={{display:"flex",gap:"4px"}}>
                {(selected.form ?? []).map((v,i)=>{
                  const bg = v===0?D.rose+"4d":v>=5?D.amber+"44":v>=3?D.emerald+"33":D.sky+"22";
                  const tc = v===0?D.rose:v>=5?D.amber:v>=3?D.emerald:D.sky;
                  return <div key={i} style={{flex:1,textAlign:"center",padding:"5px 2px",borderRadius:D.sm,background:bg}}>
                    <span style={{fontFamily:D.mono,fontSize:"11px",fontWeight:700,color:tc}}>{v===0?"W":v}</span>
                  </div>;
                })}
              </div>
            </div>
            {SKILLS_MATRIX[selected.id]&&(
              <div>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"10px"}}>SKILLS SNAPSHOT</div>
                <div style={{display:"flex",justifyContent:"center"}}>
                  <RadarChart data={SKILLS_MATRIX[selected.id].batting} color={D.sky} size={140}/>
                </div>
              </div>
            )}
            {canEdit&&(
              <div style={{display:"flex",gap:"6px",marginTop:"14px"}}>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Edit Profile</Btn>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Log Injury</Btn>
                <Btn size="sm" variant="ghost" onClick={()=>{}}>Set Availability</Btn>
              </div>
            )}
          </Card>
        )}
      </div>
      {addModal&&(
        <Modal title="Add Player" width="600px" onClose={()=>{setAddModal(false);setNpSaid("");}}>
          {/* A live preview, in the exact card the roster grid draws — not a
              mock-up of one. The same Avatar/Badge/mono-line markup as the
              grid above, fed straight from the form state, so what a coach
              sees while typing is what he will see the moment he saves. */}
          <div data-testid="add-player-preview" style={{display:"flex",alignItems:"center",gap:"12px",padding:"12px",marginBottom:"18px",
            background:D.surf2,borderRadius:D.md,border:`1px solid ${D.border}`}}>
            <Avatar name={np.fullName||"?"} size={44} color={roleColor(np.playingRole)}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:D.body,fontSize:"13px",fontWeight:600,color:D.textPrimary,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {np.fullName.trim()||"His name, as it will appear"}
              </div>
              <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"2px"}}>
                {teamLabel(np.teamCode)}
                {npAge!=null&&` · ${npAge}y (${npBand})`}
                {np.battingStyle&&` · ${np.battingStyle}HB`}
                {showBowling&&np.bowlingArm&&np.bowlingStyle&&` · ${np.bowlingArm==="L"?"LA":"RA"}${np.bowlingStyle}`}
              </div>
            </div>
            <Badge color={D.textMuted}>{np.playingRole}</Badge>
          </div>

          {addSchools.length>1&&<Select label="School" value={np.schoolId||""} onChange={(v)=>setNp(n=>({...n,schoolId:v}))}
            options={addSchools.map(s=>({value:s.id,label:s.name}))}/>}
          <Input label="Full Name" value={np.fullName} onChange={(v)=>setNp(n=>({...n,fullName:v}))} placeholder="First Last"/>

          <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px"}}>
            <div>
              <Input label="Date of birth" value={np.born} onChange={(v)=>setNp(n=>({...n,born:v}))} type="date"/>
              {/* The whole reason a date of birth is worth asking for on this
                  form rather than later: it names the age band right where
                  the team is picked, instead of leaving a school to discover
                  a boy was ineligible only when he is selected for a match. */}
              {npAge!=null&&(
                <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"-8px",marginBottom:"12px"}}>
                  {npAge} on the season's cut-off · school band <b style={{color:D.textSecondary}}>{npBand}</b>
                </div>
              )}
              {/* EITHER of these two, not both. A South African ID number's
                  first six digits ARE the date of birth, so a school working
                  from a class list of ID numbers should not have to type the
                  birthday again — and when both are given they must agree,
                  because two birthdays for one child means one of them
                  belongs to somebody else. resolveBirthDate() is the same
                  rule the server and the CSV import apply; this runs it as
                  the office types so the refusal arrives before the save. */}
              <Input label="ID number (or use the date above)" value={np.idNumber}
                     onChange={(v)=>setNp(n=>({...n,idNumber:v}))} placeholder="13 digits"/>
              {npDob&&npDob.ok===false&&(
                <div data-testid="add-player-dob-note" role="alert" style={{fontFamily:D.body,fontSize:"10px",
                  color:textOn(D.rose),marginTop:"-8px",marginBottom:"12px"}}>
                  {BIRTH_DATE_MESSAGE[npDob.reason] || npDob.reason}
                </div>
              )}
              {npDob&&npDob.ok&&npDob.source==="id_number"&&(
                <div data-testid="add-player-dob-note" style={{fontFamily:D.body,fontSize:"10px",
                  color:D.textMuted,marginTop:"-8px",marginBottom:"12px"}}>
                  Born <b style={{color:D.textSecondary}}>{npDob.born}</b>, read from the ID number.
                </div>
              )}
              {npDob&&npDob.ok&&npDob.warning&&(
                <div data-testid="add-player-dob-warning" style={{fontFamily:D.body,fontSize:"10px",
                  color:D.amber,marginTop:"-8px",marginBottom:"12px"}}>
                  {BIRTH_DATE_MESSAGE[npDob.warning]}
                </div>
              )}
            </div>
            <Select label="Squad No (optional)" value={np.squadNo} onChange={(v)=>setNp(n=>({...n,squadNo:v}))}
              options={[{value:"",label:"—"},...Array.from({length:99},(_,i)=>({value:String(i+1),label:String(i+1)}))]}/>
          </div>

          <Select label="Team" value={np.teamCode} onChange={(v)=>setNp(n=>({...n,teamCode:v}))} options={teamOptions}/>
          {npEligible===false&&(
            <div role="alert" data-testid="age-eligibility-note" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.amber),
              background:D.amber+"14",border:`1px solid ${D.amber}33`,borderRadius:D.sm,padding:"8px 10px",marginTop:"-8px",marginBottom:"14px"}}>
              He turns {npAge} before the season's cut-off, which is too old for {teamLabel(np.teamCode)} — the office may still
              enter him here, but he will not be eligible when this team is picked for a fixture.
            </div>
          )}
          {squadClash&&(
            <div role="alert" data-testid="squad-no-clash-note" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.amber),
              background:D.amber+"14",border:`1px solid ${D.amber}33`,borderRadius:D.sm,padding:"8px 10px",marginTop:"-8px",marginBottom:"14px"}}>
              No {np.squadNo} is already {squadClash.name}'s on {teamLabel(np.teamCode)}.
            </div>
          )}

          <Select label="Playing Role" value={np.playingRole} onChange={(v)=>setNp(n=>({...n,playingRole:v}))}
            options={[{value:"batter",label:"Batter"},{value:"bowler",label:"Bowler"},{value:"allrounder",label:"Allrounder"},{value:"keeper",label:"Keeper"}]}/>

          <div style={{marginBottom:"14px"}}>
            <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"6px"}}>Batting Hand</div>
            <SegmentedControl label="Batting hand" value={np.battingStyle} onChange={(v)=>setNp(n=>({...n,battingStyle:v}))}
              options={[{value:"R",label:"Right"},{value:"L",label:"Left"}]}/>
          </div>

          {/* Progressive disclosure: a batter or keeper has no bowling arm to
              give, and asking for one is a field to skip past rather than a
              fact captured. It reappears the moment the role says otherwise. */}
          {showBowling&&(
            <div style={{display:"grid",gridTemplateColumns:"var(--g-2,1fr 1fr)",gap:"12px",marginBottom:"14px"}}>
              <div>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"6px"}}>Bowling Arm</div>
                <SegmentedControl label="Bowling arm" value={np.bowlingArm} onChange={(v)=>setNp(n=>({...n,bowlingArm:v}))}
                  options={[{value:"R",label:"Right"},{value:"L",label:"Left"}]}/>
              </div>
              <div>
                <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"6px"}}>Pace / Spin</div>
                <SegmentedControl label="Bowling pace or spin" value={np.bowlingStyle} onChange={(v)=>setNp(n=>({...n,bowlingStyle:v}))}
                  options={[{value:"F",label:"Fast"},{value:"M",label:"Medium"},{value:"S",label:"Spin"}]}/>
              </div>
            </div>
          )}

          {npSaid&&<div role="alert" style={{fontFamily:D.body,fontSize:"11px",color:textOn(D.rose),marginBottom:"8px"}}>{npSaid}</div>}
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end",marginTop:"8px"}}>
            <Btn variant="ghost" onClick={()=>{setAddModal(false);setNpSaid("");}}>Cancel</Btn>
            <Btn onClick={async ()=>{
              setNpSaid("");
              try {
                await api("/api/players", { method:"POST", body:{
                  schoolId: np.schoolId || addSchools[0]?.id,
                  fullName: np.fullName, teamCode: np.teamCode, squadNo: np.squadNo || null,
                  playingRole: np.playingRole, battingStyle: np.battingStyle,
                  bowlingArm: showBowling ? (np.bowlingArm || null) : null,
                  bowlingStyle: showBowling ? (np.bowlingStyle || null) : null,
                  born: np.born || null,
                  idNumber: np.idNumber || null,
                }});
                setAddModal(false);
                setNp({ fullName:"", teamCode:"1XI", playingRole:"batter", battingStyle:"R",
                  bowlingArm:"", bowlingStyle:"", squadNo:"", born:"", idNumber:"" });
                setRosterNonce(x=>x+1);
              } catch (e) { setNpSaid(e.message || "Refused."); }
            }} disabled={np.fullName.trim().length<2 || !npDob?.ok}>Add Player</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

export { SquadView };
