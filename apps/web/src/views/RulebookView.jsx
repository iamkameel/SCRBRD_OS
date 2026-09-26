import { useState } from "react";
import { D, themed } from "../design/tokens.js";
import { Badge } from "../ui/primitives.jsx";
import { useLive } from "../lib/live.js";
import { Icon } from "../ui/icons.jsx";

// ══════════════════════════════════════════════════════
//  RULEBOOK VIEW
//
//  Two kinds of content, and the screen says which is which.
//
//  THE PLATFORM'S CLAUSES come from the server (rulebook_clause, db/32):
//  code, title, text, severity and the age bands each applies to, with the
//  figures a clause enforces joined from bowling_directive rather than typed
//  into its text. These are the rules SCRBRD applies, and the workload monitor
//  on the Training screen cites them by code beside each boy's limit.
//
//  THE LAWS SUMMARY below them is a reference crib kept in this file, as it
//  always was. Nothing stores it and nothing cites it.
// ══════════════════════════════════════════════════════

const SEVERITY_TONE = themed(() => ({ "Mandatory": D.amber, "Penalty Enforced": D.rose, "Guideline": D.sky }));
const CATEGORY_ICON = { "Medical & Safety": "hard-hat", "Curator & Turf": "sprout", "Playing Conditions": "ruler", "Conduct": "handshake" };
const bandLabel = (b) => b === "open" ? "Open" : b === "unknown" ? "No date of birth" : b;
const limitText = (l) => l.maxSpell == null && l.maxDay == null
  ? `${bandLabel(l.ageBand)}: no platform limit`
  : `${bandLabel(l.ageBand)}: ${l.maxSpell ?? "—"} overs a spell, ${l.maxDay ?? "—"} a day`;

function Clause({ c }) {
  const tone = SEVERITY_TONE[c.severity] ?? D.textMuted;
  return (
    <div id={`clause-${c.code}`} data-testid={`clause-${c.code}`}
      style={{borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf1,padding:"14px 18px",display:"flex",flexDirection:"column",gap:"8px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
        <span style={{fontFamily:D.mono,fontSize:"10px",fontWeight:700,color:D.textMuted}}>{c.code}</span>
        <span style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary}}>{c.title}</span>
        <Badge color={tone} data-testid={`clause-severity-${c.code}`}>{c.severity}</Badge>
      </div>
      <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}} data-testid={`clause-ages-${c.code}`}>
        {c.ages.length
          ? c.ages.map(a=><span key={a} style={{fontFamily:D.mono,fontSize:"10px",padding:"1px 7px",borderRadius:D.pill,border:`1px solid ${D.border}`,color:D.textSecondary}}>{bandLabel(a)}</span>)
          : <span style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>Not tied to an age band</span>}
      </div>
      <div style={{fontFamily:D.body,fontSize:"13px",color:D.textSecondary,lineHeight:1.6}}>{c.body}</div>
      {c.limits.length>0&&(
        <div data-testid={`clause-limits-${c.code}`} style={{fontFamily:D.mono,fontSize:"11px",color:D.textPrimary}}>
          {c.limits.map(limitText).join(" · ")}
        </div>
      )}
      <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted}}>{c.source}</div>
    </div>
  );
}

function RulebookView({ role }) {
  const clauses = useLive("rulebook_clauses", role);
  // Categories in the server's order, each only if it has a clause.
  const categories = [...new Set(clauses.rows.map(c=>c.category))];
  const [chosen, setChosen] = useState(null);

  const RULES = [
    {
      id:"scoring", icon:"scorebook", title:"Scoring & Run Counting",
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
      id:"dismissals", icon:"bails-off", title:"Methods of Dismissal",
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
      id:"fielding", icon:"gloves", title:"Fielding Restrictions",
      rules:[
        { rule:"T20 / 50-over Powerplay: Only 2 fielders outside the 30-yard circle during the first 6 overs (T20) or 10 overs (50-over)." },
        { rule:"T20 overs 7–20: Maximum 5 fielders outside the 30-yard circle at the time of delivery." },
        { rule:"50-over Middle/Death: Maximum 4 fielders outside the 30-yard circle in overs 11–40, maximum 5 in death overs 41–50." },
        { rule:"Leg-side fielding: Maximum of 2 fielders behind square leg on the on-side at the time of delivery. Violation = Wide or No-Ball in limited overs." },
        { rule:"Fielder substitutions: Substitutes may field, but may not bat or bowl. A fielder absent from the field must bat lower (below #5) if absent more than 15 minutes in Tests or 2 overs in T20." },
      ]
    },
    {
      id:"format", icon:"clipboard-list", title:"Format-Specific Rules",
      rules:[
        { rule:"T20: Each team faces 20 overs. Maximum 4 overs per bowler. Wide and No-Ball adds 1 run and an extra delivery." },
        { rule:"T10: Each team faces 10 overs. Maximum 2 overs per bowler. No-ball results in a Free Hit." },
        { rule:"50-over: Each team faces 50 overs. Maximum 10 overs per bowler. DLS method used for rain-affected matches." },
        { rule:"Duckworth-Lewis-Stern (DLS): Used to recalculate target scores in interrupted limited-overs matches, based on resources (overs + wickets) remaining." },
        { rule:"Super Over: Used to break ties in knockout T20 matches. Each team faces 1 over. If still tied, boundary countback is used." },
      ]
    },
    {
      id:"pitch", icon:"ground", title:"Pitch & Ground Conditions",
      rules:[
        { rule:"The pitch: 22 yards long, 10 feet wide. Prepared in the centre of the square. The condition of the pitch affects pace, bounce, and turn." },
        { rule:"Pitch covering: In Tests, pitches may be left uncovered overnight in some competitions. In limited-overs, pitches are covered to protect from rain." },
        { rule:"Ball maintenance: Fielding side may polish one side of the ball but not apply artificial substances. Ball may be replaced after 80 overs if requested." },
        { rule:"Light stops play: In Tests, players may appeal against the light. In limited-overs, play continues as long as it is safe." },
        { rule:"Dangerous/Unsuitable pitches: Umpires can suspend play if pitch conditions are considered dangerous or unsuitable for play." },
      ]
    },
    {
      id:"scrbrd", icon:"smartphone", title:"SCRBRD Platform Rules",
      rules:[
        { rule:"Ball-by-ball entry: Each delivery must be entered with type (run/wide/no-ball/bye/lb/wicket), value, and field placement (wagon wheel segment)." },
        { rule:"Shot selection: Shot type should be recorded for each legal delivery faced by the batsman for accurate shot analysis." },
        { rule:"Wicket recording: Dismissal type must be selected from the approved list. 'Caught' requires naming the fielder. 'Run Out' requires end (striker/non-striker)." },
        { rule:"Over completion: After 6 legal deliveries, the over is complete. No-balls and wides are additional deliveries and extend the over." },
        { rule:"Innings completion: Innings ends when 10 wickets have fallen, the over limit is reached, or the captain declares (in non-limited formats)." },
        { rule:"Free Hit: After a Front-Foot No-Ball, the next delivery is a Free Hit. The batter can be out only run out, handling the ball, obstructing the field, or hitting the ball twice — never bowled, caught, LBW, stumped or hit wicket." },
      ]
    },
  ];

  // The first clause category opens by default once the clauses arrive; the
  // Laws crib when there are none (signed out, or nothing on the server).
  const open = chosen ?? (categories.length ? `cat:${categories[0]}` : "scoring");
  const tab = (id, label) => (
    <button key={id} onClick={()=>setChosen(id)} className="pressBtn" data-testid={`rulebook-tab-${id}`} style={{
      display:"flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:D.pill,
      cursor:"pointer",border:`1px solid ${open===id?D.amber+"66":D.border}`,
      background:open===id?`${D.amber}18`:"transparent",
      fontFamily:D.head,fontSize:"10px",fontWeight:700,letterSpacing:"0.05em",
      color:open===id?D.amber:D.textMuted,transition:"all .18s",
    }}>{label}</button>
  );
  const groupLabel = (t) => <div style={{fontFamily:D.mono,fontSize:"9px",letterSpacing:"0.08em",textTransform:"uppercase",color:D.textMuted,marginTop:"14px"}}>{t}</div>;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"20px"}} data-testid="rulebook">
      {/* Header */}
      <div style={{borderRadius:D.lg,border:`1px solid ${D.amber}33`,background:`linear-gradient(135deg,${D.amber}0a,${D.surf1})`,padding:"24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"16px",flexWrap:"wrap"}}>
          <div style={{fontSize:"40px",color:D.amber}}><Icon name="book-open"/></div>
          <div>
            <div style={{fontFamily:D.head,fontSize:"24px",fontWeight:800,color:D.textPrimary,lineHeight:1.1}}>SCRBRD Rulebook</div>
            <div style={{fontFamily:D.body,fontSize:"13px",color:D.textMuted,marginTop:"4px"}}>The clauses the platform applies, and a summary of the Laws for reference</div>
          </div>
        </div>
        {groupLabel("Platform clauses")}
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"6px"}}>
          {categories.map(c=>tab(`cat:${c}`, <><Icon name={CATEGORY_ICON[c] ?? "pin"}/>{c}</>))}
          {!categories.length&&(
            <span data-testid="rulebook-clauses-empty" style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>
              {clauses.loading ? "Loading…"
                : clauses.error ? "The platform's clauses could not be loaded."
                : !clauses.live ? "Sign in to read the platform's clauses."
                : "No clauses on record."}
            </span>
          )}
        </div>
        {groupLabel("Laws summary — reference only")}
        <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginTop:"6px"}}>
          {RULES.map(s=>tab(s.id, <><Icon name={s.icon}/>{s.title}</>))}
        </div>
      </div>

      {/* The platform's clauses, one category at a time */}
      {categories.filter(c=>open===`cat:${c}`).map(c=>(
        <div key={c} data-testid="rulebook-category" data-category={c} style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:800,color:D.textPrimary}}>
            <Icon name={CATEGORY_ICON[c] ?? "pin"}/> {c}
          </div>
          {clauses.rows.filter(x=>x.category===c).map(x=><Clause key={x.code} c={x}/>)}
        </div>
      ))}

      {/* The Laws crib */}
      {RULES.filter(s=>s.id===open).map(section=>(
        <div key={section.id} style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{fontFamily:D.head,fontSize:"16px",fontWeight:800,color:D.textPrimary}}>
            <Icon name={section.icon}/> {section.title}
          </div>
          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted}}>A general summary kept in the app for reference. Unlike the platform's clauses, these are not stored or cited anywhere.</div>
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
