
import { useState } from "react";
import { D } from "../design/tokens.js";
import { fitnessColor } from "../lib/format.js";
import { Avatar, Badge, Btn, Card, EmptyState, Modal, RadarChart, SectionHeader } from "../ui/primitives.jsx";
import { useLive, useNotes, useRatings, useSkills } from "../lib/live.js";
import { recordAssessment, writeNote, NOTE_ADJUSTMENT_LIMIT } from "../lib/development.js";
import { TREE, DISCIPLINES, ANCHOR_POINTS, anchorFor, SCALE_MIN, SCALE_MAX } from "@scrbrd/scoring";

/**
 * The anchor sentence for a value, and whether anybody has approved it.
 *
 * Rounds DOWN to the nearest anchor point: a 14 is "at least a 12", not
 * "nearly a 16". Rounding up would describe the player as better than the
 * coach just said he was.
 */
function anchorText(skill, value) {
  const a = anchorFor(skill);
  if (!a || !Number.isFinite(value)) return null;
  const pt = [...ANCHOR_POINTS].reverse().find((p) => value >= p) ?? ANCHOR_POINTS[0];
  return { text: a.points[pt], point: pt, status: a.status };
}

/**
 * One attribute: a value, and what that value is supposed to mean.
 *
 * The anchor is shown WHILE RATING rather than in a handbook nobody opens. Two
 * coaches who never read the same sentence produce drift, and drift is
 * indistinguishable from a player changing — which is the whole reason the
 * rubric exists.
 *
 * A DRAFT anchor says so, in the loudest way a small label can. It has been
 * written to be argued with and no coach has approved it; somebody calibrating
 * against it silently is the exact failure the drafts were kept separate to
 * avoid.
 */
function AttributeRow({ group, attr, value, current, onChange }) {
  const skill = `${group}.${attr}`;
  const shown = value === "" || value == null ? current : Number(value);
  const a = anchorText(skill, shown);
  const label = attr.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return (
    <div style={{padding:"10px 0",borderBottom:`1px solid ${D.border}`}}>
      <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
        <div style={{flex:1,fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>{label}</div>
        {current!=null&&(
          <span style={{fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>was {current}</span>
        )}
        <input type="range" min={SCALE_MIN} max={SCALE_MAX} step={1}
          value={shown ?? SCALE_MIN}
          onChange={(e)=>onChange(Number(e.target.value))}
          aria-label={`${label}, 1 to 20`}
          style={{width:"140px",accentColor:D.violet}}/>
        <div style={{width:"26px",textAlign:"right",fontFamily:D.mono,fontSize:"14px",fontWeight:700,
                     color:value===""||value==null?D.textMuted:D.textPrimary}}>
          {value===""||value==null?"—":value}
        </div>
      </div>
      {a&&(
        <div style={{display:"flex",gap:"7px",alignItems:"flex-start",marginTop:"5px"}}>
          <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,flexShrink:0,paddingTop:"1px"}}>{a.point}+</span>
          {a.status==="draft"&&<Badge color={D.amber}>draft</Badge>}
          <span style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,lineHeight:1.4}}>{a.text}</span>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  SKILLS MATRIX VIEW
// ══════════════════════════════════════════════════════
function SkillsView({ role }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  // Bumped after a write so the numbers on screen catch up. A save that leaves
  // the old figure showing reads exactly like a save that failed, and is how
  // somebody comes to save the same thing twice.
  const [nonce, setNonce]         = useState(0);
  const { rows: PLAYERS, loading, error } = useLive("players", role, nonce);
  const SKILLS_MATRIX = useSkills(role, nonce);
  // The rating: the coach's anchor, the ball log's answer, and the gap. Read
  // separately because it is a different question from "what did the coach
  // say" — it is that answer argued with.
  const { ratings } = useRatings(role, nonce);
  // The selected PLAYER ID, not the player row — see FieldsView for the same
  // change and the same reason: a row captured at first render belongs to a
  // list that no longer exists once the server answers.
  const [selId, setSelId]         = useState(null);
  const [category, setCategory]   = useState("technical");
  // Default to the first player who HAS an assessment, not the first player.
  // The list on the left is filtered to assessed players; defaulting to
  // PLAYERS[0] meant the screen opened on somebody who is not in that list and
  // greeted every coach with "no assessment available" while assessed players
  // sat beside it. Falls back to the first player when nobody is assessed,
  // which is the state the empty message is actually for.
  const assessed = PLAYERS.filter(p => SKILLS_MATRIX[p.id]);
  const selPlayer = PLAYERS.find(p => p.id === selId) ?? assessed[0] ?? PLAYERS[0];
  const skills = selPlayer ? SKILLS_MATRIX[selPlayer.id] : null;
  const canEdit = role==="superadmin"||role==="coach";
  const cats = skills ? Object.keys(skills) : [];
  // Technical / mental / physical — the craft, the head, the body.
  const SKILL_COLORS = { technical:D.sky, mental:D.violet, physical:D.emerald };

  // The 1-20 scale, banded as the rubric bands it: 1-5 poor, 6-10 average,
  // 11-15 good, 16-20 excellent. Kept in step with BANDS_OF_SCALE in
  // packages/scoring/src/rubric.mjs.
  const progressColorForScore = v => v>=16?D.emerald:v>=11?D.sky:v>=6?D.amber:D.rose;
  const SCALE_MAX = 20;
  const BATTING_OR_BOWLING = ["batting", "bowling"];
  const rating = selPlayer ? ratings[selPlayer.id] : null;
  // Notes are read on their own capability, narrower than the ratings above.
  // A reader without it gets an empty list and the section does not appear —
  // which is the correct thing for it to do rather than an empty panel that
  // implies nothing has been written.
  const { notes } = useNotes(role, selPlayer?.id, nonce);
  const [assessing, setAssessing] = useState(false);
  const [draft, setDraft]         = useState({});   // { "group.attr": 1..20 }
  const [noteText, setNoteText]   = useState("");
  const [noteDisc, setNoteDisc]   = useState("");
  const [noteAdj, setNoteAdj]     = useState("");
  const [noting, setNoting]       = useState(false);
  const [busy, setBusy]           = useState(false);
  const [writeError, setWriteError] = useState(null);

  if (!selPlayer) return (
    <div className="os-page">
      <SectionHeader title="Skills Matrix" sub="Player development tracking & assessment" color={D.violet}/>
      <EmptyState loading={loading} error={error} icon="◎" message="No players are in scope for you." />
    </div>
  );

  return (
    <div className="os-page">
      <SectionHeader title="Skills Matrix" sub="Player development tracking & assessment" color={D.violet}
        actions={canEdit&&<Btn size="sm" onClick={()=>{setWriteError(null);setAssessing(true);}}>+ Run Assessment</Btn>}/>
      <div style={{display:"grid",gridTemplateColumns:"var(--g-side-l,220px 1fr)",gap:"16px",alignItems:"start"}}>
        {/* Player list */}
        <Card sx={{padding:"0"}}>
          <div style={{padding:"12px 14px",borderBottom:`1px solid ${D.border}`}}>
            <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em"}}>SELECT PLAYER</div>
          </div>
          <div style={{maxHeight:"calc(100vh - 200px)",overflowY:"auto"}}>
            {assessed.map(p=>{
              const s=SKILLS_MATRIX[p.id];
              const overall=Math.round(Object.values(s).flatMap(c=>Object.values(c)).reduce((a,b)=>a+b,0)/Object.values(s).flatMap(c=>Object.values(c)).length);
              return (
                <button key={p.id} onClick={()=>setSelId(p.id)} className="pressBtn" style={{
                  width:"100%",padding:"10px 14px",display:"flex",alignItems:"center",gap:"9px",
                  background:selPlayer.id===p.id?D.violet+"12":"transparent",
                  border:`1px solid ${selPlayer.id===p.id?D.violet+"33":"transparent"}`,
                  borderRadius:D.md,margin:"1px 5px",width:"calc(100% - 10px)",cursor:"pointer",
                }}>
                  <Avatar name={p.name} size={32} color={selPlayer.id===p.id?D.violet:D.textMuted}/>
                  <div style={{flex:1,textAlign:"left"}}>
                    <div style={{fontFamily:D.body,fontSize:"11px",fontWeight:selPlayer.id===p.id?600:400,color:selPlayer.id===p.id?D.textPrimary:D.textSecondary}}>{p.name.split(" ").pop()}</div>
                    <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>{p.team}</div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:700,color:progressColorForScore(overall)}}>{overall}</div>
                    <div style={{fontFamily:D.body,fontSize:"8px",color:D.textMuted}}>OVR</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Skills detail */}
        <div>
          {/* Header */}
          <Card sx={{padding:"16px",marginBottom:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
              <Avatar name={selPlayer.name} size={52} color={D.violet}/>
              <div style={{flex:1}}>
                <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:700,color:D.textPrimary}}>{selPlayer.name}</div>
                <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,marginBottom:"8px"}}>{selPlayer.team} · {selPlayer.role} · {selPlayer.batHand}HB</div>
                <div style={{display:"flex",gap:"6px"}}>
                  <Badge color={D.sky}>{selPlayer.role}</Badge>
                  <Badge color={fitnessColor(selPlayer.fitness)}>{selPlayer.fitness}</Badge>
                </div>
              </div>
              {skills&&(
                <div style={{display:"flex",gap:"10px"}}>
                  {Object.entries(skills).map(([cat,data])=>{
                    const avg=Math.round(Object.values(data).reduce((a,b)=>a+b,0)/Object.values(data).length);
                    return (
                      <div key={cat} style={{textAlign:"center"}}>
                        <div style={{fontFamily:D.mono,fontSize:"18px",fontWeight:700,color:SKILL_COLORS[cat]||D.indigo}}>{avg}</div>
                        <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted,textTransform:"capitalize"}}>{cat}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* ── The rating: what was said, what the log says, the gap ──
              Both halves are always shown. A single adjusted number cannot
              answer the question a coach asks first, in front of a parent,
              which is what moved it. */}
          {rating&&(BATTING_OR_BOWLING.some(d=>rating[d]?.value!=null))&&(
            <Card sx={{padding:"16px",marginBottom:"14px"}}>
              <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",marginBottom:"12px"}}>RATING</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:"14px"}}>
                {BATTING_OR_BOWLING.filter(d=>rating[d]?.value!=null).map(d=>{
                  const r=rating[d];
                  const drift=r.drift;
                  // roseText, not rose: this is TEXT. The design suite greps
                  // source for the fill accents used directly as a text colour
                  // and cannot see one laundered through a variable, so the
                  // contrast rule is kept here by hand. emerald passes as text
                  // at these sizes; rose does not.
                  const driftColor=drift==null||drift===0?D.textMuted:drift>0?D.emerald:D.roseText;
                  return (
                    <div key={d} style={{border:`1px solid ${D.border}`,borderRadius:D.md,padding:"12px"}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:"8px",marginBottom:"8px"}}>
                        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,textTransform:"capitalize"}}>{d}</div>
                        <div style={{fontFamily:D.mono,fontSize:"22px",fontWeight:700,color:progressColorForScore(r.value)}}>{r.value}</div>
                        <div style={{fontFamily:D.mono,fontSize:"11px",color:D.textMuted}}>/ {SCALE_MAX}</div>
                        {drift!=null&&drift!==0&&(
                          <div style={{fontFamily:D.mono,fontSize:"12px",fontWeight:600,color:driftColor}}>
                            {drift>0?"▲":"▼"}{Math.abs(drift)}
                          </div>
                        )}
                      </div>
                      <div style={{display:"flex",gap:"14px",marginBottom:"8px"}}>
                        <div>
                          <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:600,color:D.textSecondary}}>{r.coach??"—"}</div>
                          <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>COACH</div>
                        </div>
                        <div>
                          <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:600,color:D.textSecondary}}>{r.performance??"—"}</div>
                          <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>MATCH DATA</div>
                        </div>
                        <div>
                          <div style={{fontFamily:D.mono,fontSize:"13px",fontWeight:600,color:D.textSecondary}}>{r.sample||0}</div>
                          <div style={{fontFamily:D.body,fontSize:"9px",color:D.textMuted}}>DELIVERIES</div>
                        </div>
                      </div>
                      {/* Said in words as well as numbers. The explanation is
                          composed on the server so every reader is told the
                          same thing. */}
                      <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,lineHeight:1.45}}>{r.explanation}</div>
                      {r.anchoredOn&&(
                        <div style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted,marginTop:"6px"}}>
                          ANCHORED {r.anchoredOn} · {r.attributes} ATTRIBUTE{r.attributes===1?"":"S"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── A coach's own writing ────────────────────────────
              Narrower than everything above it: the pupil reads his own
              attribute scores and never this. Shown only to a reader whose
              capability returned rows at all. */}
          {(notes.length>0||canEdit)&&(
            <Card sx={{padding:"16px",marginBottom:"14px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
                <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em"}}>
                  DEVELOPMENT NOTES · COACHING STAFF ONLY
                </div>
                {canEdit&&<Btn size="sm" onClick={()=>{setWriteError(null);setNoting(true);}}>+ Note</Btn>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                {notes.map(n=>(
                  <div key={n.id} style={{borderLeft:`2px solid ${n.adjustment?(n.adjustment>0?D.emerald:D.rose):D.border}`,paddingLeft:"12px"}}>
                    <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.5}}>{n.body}</div>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",marginTop:"5px"}}>
                      <span style={{fontFamily:D.mono,fontSize:"9px",color:D.textMuted}}>
                        {n.author||"—"} · {n.observedOn}{n.revised?" · REVISED":""}
                      </span>
                      {/* The signal, stated. The prose is never parsed: if a
                          note moved a rating, it says so here because the
                          coach said so, not because anything read the words. */}
                      {n.adjustment!=null&&(
                        <Badge color={n.adjustment>0?D.emerald:D.rose}>
                          {n.discipline} {n.adjustment>0?"+":""}{n.adjustment}
                        </Badge>
                      )}
                      {n.adjustment==null&&n.discipline&&(
                        <Badge color={D.textMuted}>{n.discipline}</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Writing one ────────────────────────────────────
              Every endpoint behind these has existed and been tested for
              several commits; nothing called them. A coach could read a
              rating, its drift and the notes behind it, and record none of it.
              */}
          {assessing&&(
            <Modal title={`Assessment — ${selPlayer.name}`} width="640px"
                   onClose={()=>{setAssessing(false);setDraft({});}}>
              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"12px",lineHeight:1.5}}>
                Rate only what you watched. Anything left untouched keeps the score it already
                has — a partial assessment is the normal case, not an incomplete one.
              </div>
              {Object.entries(TREE).map(([group,attrs])=>(
                <div key={group} style={{marginBottom:"16px"}}>
                  <div style={{fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.08em",
                               color:SKILL_COLORS[group]||D.indigo,textTransform:"uppercase",marginBottom:"4px"}}>{group}</div>
                  {attrs.map(attr=>(
                    <AttributeRow key={attr} group={group} attr={attr}
                      value={draft[`${group}.${attr}`] ?? ""}
                      current={skills?.[group]?.[attr] ?? null}
                      onChange={(v)=>setDraft(d=>({...d,[`${group}.${attr}`]:v}))}/>
                  ))}
                </div>
              ))}
              {writeError&&(
                <div style={{fontFamily:D.mono,fontSize:"11px",color:D.roseText,marginBottom:"10px"}}>{writeError}</div>
              )}
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <Btn size="sm" disabled={busy||!Object.keys(draft).length} onClick={async()=>{
                  setBusy(true); setWriteError(null);
                  try {
                    const scores={};
                    for (const [k,v] of Object.entries(draft)) {
                      const [g,a]=k.split("."); (scores[g] ??= {})[a]=v;
                    }
                    await recordAssessment(selPlayer.id, scores);
                    setAssessing(false); setDraft({}); setNonce(n=>n+1);
                  } catch(e){ setWriteError(e.message||"could not save"); }
                  finally { setBusy(false); }
                }}>{busy?"Saving…":`Save ${Object.keys(draft).length} rating${Object.keys(draft).length===1?"":"s"}`}</Btn>
                <button onClick={()=>{setAssessing(false);setDraft({});}} className="pressBtn"
                  style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Cancel</button>
              </div>
            </Modal>
          )}

          {noting&&(
            <Modal title={`Development note — ${selPlayer.name}`}
                   onClose={()=>{setNoting(false);setNoteText("");setNoteDisc("");setNoteAdj("");}}>
              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,marginBottom:"12px",lineHeight:1.5}}>
                Coaching staff and leadership only. Not visible to the player or their parent.
              </div>
              <textarea value={noteText} onChange={(e)=>setNoteText(e.target.value)} rows={5}
                aria-label="Note"
                placeholder="What you saw, and what you plan to do about it."
                style={{width:"100%",padding:"10px",borderRadius:D.md,background:D.surf2,
                        border:`1px solid ${D.border}`,color:D.textPrimary,fontFamily:D.body,fontSize:"12px",resize:"vertical"}}/>
              {/* The signal, stated. Nothing reads the prose, so a note that is
                  meant to move a rating has to say which discipline and by how
                  much — and the form says that out loud rather than letting a
                  coach assume the words did it. */}
              <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,margin:"12px 0 6px",lineHeight:1.5}}>
                Optional. Nothing reads the text — if this note should move a rating, say which and by how much.
              </div>
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <select value={noteDisc} onChange={(e)=>setNoteDisc(e.target.value)} aria-label="Discipline"
                  style={{padding:"7px 10px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,
                          color:D.textPrimary,fontFamily:D.body,fontSize:"12px"}}>
                  <option value="">No effect on a rating</option>
                  {Object.keys(DISCIPLINES).map(d=><option key={d} value={d}>{d}</option>)}
                </select>
                <select value={noteAdj} onChange={(e)=>setNoteAdj(e.target.value)} aria-label="Adjustment"
                  disabled={!noteDisc}
                  style={{padding:"7px 10px",borderRadius:D.md,background:D.surf2,border:`1px solid ${D.border}`,
                          color:D.textPrimary,fontFamily:D.body,fontSize:"12px"}}>
                  <option value="">—</option>
                  {Array.from({length:NOTE_ADJUSTMENT_LIMIT*2+1},(_,i)=>i-NOTE_ADJUSTMENT_LIMIT)
                    .filter(v=>v!==0).map(v=><option key={v} value={v}>{v>0?`+${v}`:v}</option>)}
                </select>
              </div>
              {writeError&&(
                <div style={{fontFamily:D.mono,fontSize:"11px",color:D.roseText,margin:"10px 0"}}>{writeError}</div>
              )}
              <div style={{display:"flex",gap:"8px",alignItems:"center",marginTop:"14px"}}>
                <Btn size="sm" disabled={busy||!noteText.trim()} onClick={async()=>{
                  setBusy(true); setWriteError(null);
                  try {
                    await writeNote(selPlayer.id,{body:noteText,aboutDiscipline:noteDisc||null,adjustment:noteAdj});
                    setNoting(false); setNoteText(""); setNoteDisc(""); setNoteAdj(""); setNonce(n=>n+1);
                  } catch(e){ setWriteError(e.message||"could not save"); }
                  finally { setBusy(false); }
                }}>{busy?"Saving…":"Save note"}</Btn>
                <button onClick={()=>{setNoting(false);setNoteText("");}} className="pressBtn"
                  style={{background:"none",border:"none",cursor:"pointer",fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Cancel</button>
              </div>
            </Modal>
          )}

          {skills?(
            <>
              {/* Category tabs */}
              <div style={{display:"flex",gap:"6px",marginBottom:"16px"}}>
                {cats.map(c=>(
                  <button key={c} onClick={()=>setCategory(c)} className="pressBtn" style={{
                    padding:"7px 16px",borderRadius:D.pill,cursor:"pointer",
                    border:`1px solid ${category===c?(SKILL_COLORS[c]||D.indigo)+"55":D.border}`,
                    background:category===c?(SKILL_COLORS[c]||D.indigo)+"14":"transparent",
                    fontFamily:D.body,fontSize:"12px",fontWeight:category===c?600:400,
                    color:category===c?D.textPrimary:D.textMuted,textTransform:"capitalize",
                  }}>{c}</button>
                ))}
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 180px",gap:"16px"}}>
                <Card sx={{padding:"16px"}}>
                  <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"14px",textTransform:"capitalize"}}>{category} Skills</div>
                  {Object.entries(skills[category]).map(([skill, val])=>(
                    <div key={skill} style={{marginBottom:"14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"5px"}}>
                        <span style={{fontFamily:D.body,fontSize:"12px",fontWeight:500,color:D.textSecondary,textTransform:"capitalize"}}>{skill}</span>
                        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                          <span style={{fontFamily:D.mono,fontSize:"12px",color:progressColorForScore(val),fontWeight:600}}>{val}</span>
                          <Badge color={progressColorForScore(val)}>{val>=16?"Excellent":val>=11?"Good":val>=6?"Average":"Poor"}</Badge>
                        </div>
                      </div>
                      <div style={{width:"100%",height:"8px",background:D.surf3,borderRadius:"4px",overflow:"hidden"}}>
                        <div className="skill-bar" style={{height:"100%",width:`${(val/SCALE_MAX)*100}%`,background:`linear-gradient(90deg,${SKILL_COLORS[category]||D.indigo},${progressColorForScore(val)})`,borderRadius:"4px"}}/>
                      </div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:"3px"}}>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>0</span>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>Target: 90</span>
                        <span style={{fontFamily:D.mono,fontSize:"8px",color:D.textMuted}}>100</span>
                      </div>
                    </div>
                  ))}
                  {canEdit&&<Btn size="sm" variant="ghost" onClick={()=>{}}>Update Scores</Btn>}
                </Card>
                <div>
                  <Card sx={{padding:"14px",marginBottom:"12px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em",marginBottom:"10px"}}>RADAR</div>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <RadarChart data={skills[category]} color={SKILL_COLORS[category]||D.indigo} size={150}/>
                    </div>
                  </Card>
                  <Card sx={{padding:"14px"}}>
                    <div style={{fontFamily:D.head,fontSize:"11px",fontWeight:700,color:D.textMuted,letterSpacing:"0.06em",marginBottom:"10px"}}>DEV PLAN</div>
                    {Object.entries(skills[category]).sort(([,a],[,b])=>a-b).slice(0,3).map(([s,v])=>(
                      <div key={s} style={{padding:"7px 0",borderBottom:`1px solid ${D.border}`}}>
                        <div style={{fontFamily:D.body,fontSize:"11px",color:D.textSecondary,textTransform:"capitalize",marginBottom:"2px"}}>{s}</div>
                        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                          <div style={{flex:1,height:"3px",background:D.surf3,borderRadius:"2px",overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${v}%`,background:D.orange,borderRadius:"2px"}}/>
                          </div>
                          <span style={{fontFamily:D.mono,fontSize:"9px",color:D.orange}}>{v}→{Math.min(v+10,100)}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"8px"}}>Focus areas for next quarter</div>
                  </Card>
                </div>
              </div>
            </>
          ):(
            <Card sx={{padding:"32px",textAlign:"center"}}>
              <div style={{fontSize:"32px",marginBottom:"12px"}}>🎯</div>
              <div style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted}}>No skills assessment available for this player yet.</div>
              {canEdit&&<div style={{marginTop:"14px"}}><Btn size="sm" onClick={()=>{setWriteError(null);setAssessing(true);}}>Run Assessment</Btn></div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export { SkillsView };
