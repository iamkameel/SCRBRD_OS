import { useState } from "react";
import { D } from "../design/tokens.js";
import { SCRBRD } from "../scorer/engine.jsx";

// ══════════════════════════════════════════════════════
//  RULEBOOK VIEW
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  RULEBOOK VIEW
// ══════════════════════════════════════════════════════
function RulebookView({ role }) {
  const [openSection, setOpenSection] = useState("scoring");

  const RULES = [
    {
      id:"scoring", icon:"🏏", title:"Scoring & Run Counting",
      rules:[
        { rule:"A run is scored each time both batsmen complete a run between the wickets after the ball has been struck by the bat or body of the striker." },
        { rule:"Boundaries: The ball reaching or crossing the boundary rope scores 4 runs (ground) or 6 runs (without touching the ground) in addition to any runs completed." },
        { rule:"Extras (Wide, No-Ball, Bye, Leg Bye, Penalty) are credited to the batting team but not to the individual batsman's score, except for No-Ball runs off the bat." },
        { rule:"No-Ball: Bowler overstepping the crease (front foot), ball above waist height (full toss), ball bouncing more than twice, or dangerous bowling — adds 1 run and a free hit in limited-overs cricket." },
        { rule:"Wide: A ball passing the striker outside the reach of the batsman's normal stance adds 1 run and is re-bowled. No wide in Tests — only in limited-overs formats." },
        { rule:"Penalty runs: 5 penalty runs can be awarded for deliberate time-wasting, ball-tampering, or deliberate distraction." },
      ]
    },
    {
      id:"dismissals", icon:"🎳", title:"Methods of Dismissal",
      rules:[
        { rule:"Bowled: Ball delivered by the bowler hits the stumps directly, without any intervening wicket, and dislodges at least one bail." },
        { rule:"Caught: Ball touches the bat or glove and is caught by a fielder before touching the ground. A bowler may also take catches off their own bowling." },
        { rule:"LBW (Leg Before Wicket): Ball hits the batsman's body (not the bat) and would have gone on to hit the stumps. Complex — umpire must consider pitch of delivery, impact, and line." },
        { rule:"Run Out: A fielder puts down the wicket with the ball while a batsman is out of their ground completing a run or attempting a run." },
        { rule:"Stumped: The wicket-keeper puts down the wicket while the batsman is out of their ground and not attempting a run, usually off a missed delivery." },
        { rule:"Hit Wicket: The batsman dislodges the bails with bat or body while playing a shot or beginning the first run." },
        { rule:"Handled the Ball / Obstructing the Field: Batsman intentionally handles ball or obstructs a fielder." },
        { rule:"Hit the Ball Twice: Batsman intentionally hits the ball a second time other than to guard the wicket." },
        { rule:"Timed Out: New batsman takes more than 3 minutes to be ready to face the next ball (rare, but valid)." },
        { rule:"On a Free Hit: Batsman can only be dismissed by Run Out, Stumped, Hit Wicket, Obstructing the Field, or Handled the Ball." },
      ]
    },
    {
      id:"fielding", icon:"🧤", title:"Fielding Restrictions",
      rules:[
        { rule:"T20 / 50-over Powerplay: Only 2 fielders outside the 30-yard circle during the first 6 overs (T20) or 10 overs (50-over)." },
        { rule:"T20 overs 7–20: Maximum 5 fielders outside the 30-yard circle at the time of delivery." },
        { rule:"50-over Middle/Death: Maximum 4 fielders outside the 30-yard circle in overs 11–40, maximum 5 in death overs 41–50." },
        { rule:"Leg-side fielding: Maximum of 2 fielders behind square leg on the on-side at the time of delivery. Violation = Wide or No-Ball in limited overs." },
        { rule:"Fielder substitutions: Substitutes may field, but may not bat or bowl. A fielder absent from the field must bat lower (below #5) if absent more than 15 minutes in Tests or 2 overs in T20." },
      ]
    },
    {
      id:"format", icon:"📋", title:"Format-Specific Rules",
      rules:[
        { rule:"T20: Each team faces 20 overs. Maximum 4 overs per bowler. Wide and No-Ball adds 1 run and an extra delivery." },
        { rule:"T10: Each team faces 10 overs. Maximum 2 overs per bowler. No-ball results in a Free Hit." },
        { rule:"50-over: Each team faces 50 overs. Maximum 10 overs per bowler. DLS method used for rain-affected matches." },
        { rule:"Duckworth-Lewis-Stern (DLS): Used to recalculate target scores in interrupted limited-overs matches, based on resources (overs + wickets) remaining." },
        { rule:"Super Over: Used to break ties in knockout T20 matches. Each team faces 1 over. If still tied, boundary countback is used." },
      ]
    },
    {
      id:"pitch", icon:"🌿", title:"Pitch & Ground Conditions",
      rules:[
        { rule:"The pitch: 22 yards long, 10 feet wide. Prepared in the centre of the square. The condition of the pitch affects pace, bounce, and turn." },
        { rule:"Pitch covering: In Tests, pitches may be left uncovered overnight in some competitions. In limited-overs, pitches are covered to protect from rain." },
        { rule:"Ball maintenance: Fielding side may polish one side of the ball but not apply artificial substances. Ball may be replaced after 80 overs if requested." },
        { rule:"Light stops play: In Tests, players may appeal against the light. In limited-overs, play continues as long as it is safe." },
        { rule:"Dangerous/Unsuitable pitches: Umpires can suspend play if pitch conditions are considered dangerous or unsuitable for play." },
      ]
    },
    {
      id:"scrbrd", icon:"📱", title:"SCRBRD Platform Rules",
      rules:[
        { rule:"Ball-by-ball entry: Each delivery must be entered with type (run/wide/no-ball/bye/lb/wicket), value, and field placement (wagon wheel segment)." },
        { rule:"Shot selection: Shot type should be recorded for each legal delivery faced by the batsman for accurate shot analysis." },
        { rule:"Wicket recording: Dismissal type must be selected from the approved list. 'Caught' requires naming the fielder. 'Run Out' requires end (striker/non-striker)." },
        { rule:"Over completion: After 6 legal deliveries, the over is complete. No-balls and wides are additional deliveries and extend the over." },
        { rule:"Innings completion: Innings ends when 10 wickets have fallen, the over limit is reached, or the captain declares (in non-limited formats)." },
        { rule:"Free Hit: After a Front-Foot No-Ball, the next delivery is a Free Hit. Only run-out, handled ball, hit wicket, obstruction, or stumped dismissals apply." },
      ]
    },
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"20px"}}>
      {/* Header */}
      <div style={{borderRadius:D.lg,border:`1px solid ${D.amber}33`,background:`linear-gradient(135deg,${D.amber}0a,${D.surf1})`,padding:"24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
          <div style={{fontSize:"40px"}}>📖</div>
          <div>
            <div style={{fontFamily:D.head,fontSize:"24px",fontWeight:800,color:D.textPrimary,lineHeight:1.1}}>SCRBRD Rulebook</div>
            <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginTop:"4px"}}>Official cricket rules and platform guidelines for Hilton College CC</div>
          </div>
        </div>
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"16px"}}>
          {RULES.map(s=>(
            <button key={s.id} onClick={()=>setOpenSection(s.id)} className="pressBtn" style={{
              display:"flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:D.pill,
              cursor:"pointer",border:`1px solid ${openSection===s.id?D.amber+"66":D.border}`,
              background:openSection===s.id?`${D.amber}18`:"transparent",
              fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",
              color:openSection===s.id?D.amber:D.textMuted,transition:"all .18s",
            }}>{s.icon} {s.title}</button>
          ))}
        </div>
      </div>

      {/* Rules content */}
      {RULES.filter(s=>s.id===openSection).map(section=>(
        <div key={section.id} style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:800,color:D.textPrimary}}>
            {section.icon} {section.title}
          </div>
          {section.rules.map((r,i)=>(
            <div key={i} style={{borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf1,padding:"14px 18px",display:"flex",alignItems:"flex-start",gap:"12px"}}>
              <div style={{width:"22px",height:"22px",borderRadius:"50%",background:`${D.amber}18`,border:`1px solid ${D.amber}33`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:D.mono,fontSize:"10px",fontWeight:700,color:D.amber,flexShrink:0,marginTop:"1px"}}>{i+1}</div>
              <div style={{fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>{r.rule}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export { RulebookView };
