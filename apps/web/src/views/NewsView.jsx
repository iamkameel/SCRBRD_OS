import { useState } from "react";
import { D, T, textOn, themed } from "../design/tokens.js";
import { Badge, Btn, Card, EmptyState, Input, Modal, SectionHeader, Select } from "../ui/primitives.jsx";
import { useLive } from "../lib/live.js";
import { api } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";
import { holdsCapability } from "../rbac/index.js";

/**
 * THE NEWSFEED.
 *
 * news.read and three publish tiers have been in the policy since the first
 * migration, held by twenty-three of twenty-five roles, with no table, no read
 * and no screen behind them. This is the screen.
 *
 * WHAT IT DECIDES: nothing. The rows that arrive are the rows the policy on
 * news_post allowed — a team post to that side, a school post to that school,
 * a competition post to every school entered in it — and the composer is
 * offered on the same capabilities the INSERT policy demands, so the button is
 * never there for somebody the database would then refuse.
 *
 * THE PUBLIC HOME PAGE (SCRBRD-142 §3.5, db/83): a sent team or school post
 * carries a line saying whether it is on the SCRBRD home page, with the one
 * button its state allows; the school's publishers get a short approvals card
 * at the top. The composer has nothing new for that: a post is asked about
 * after it is posted, so nobody writes "for the public" in haste.
 *
 * ONE STREAM (docs/design/NOTIFICATIONS.md D9-D11, S2): a sent post is also a
 * notice in everybody's Notices, written by the post's trigger (db/91). The
 * composer says, above the words, who reads them and what never goes in them
 * (a machine cannot check that, so the writer is told); and "Send to phones
 * too" makes the notice medium, which a phone shows as a pointer and nothing
 * more. Never high: that is the system's.
 */
const TIER = themed(() => ({
  team:        { cap: "news.publish.team",        label: "My side",     tone: D.emerald },
  school:      { cap: "news.publish.school",      label: "Whole school", tone: D.sky },
  competition: { cap: "news.publish.competition", label: "The league",  tone: D.amber },
}));

function NewsView({ role }) {
  const [nonce, setNonce] = useState(0);
  const { rows, loading } = useLive("news", role, nonce);
  const [composing, setComposing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // A tier is offered only where the capability is held. Three roles hold
  // exactly one of these, which is the point of them being three.
  const tiers = Object.entries(TIER).filter(([, t]) => holdsCapability(role, t.cap));
  const canPublish = tiers.length > 0;
  const schools = schoolsWhere("news.read");

  const [post, setPost] = useState({ scope: "", schoolId: "", teamCode: "", title: "", body: "", phones: false });
  const scope = post.scope || tiers[0]?.[0] || "";

  const send = async () => {
    setError(null); setSending(true);
    try {
      await api("/api/news", { method: "POST", body: {
        scope,
        schoolId: scope === "competition" ? undefined : (post.schoolId || schools[0]?.id),
        teamCode: scope === "team" ? post.teamCode.toUpperCase() : undefined,
        competitionId: scope === "competition" ? post.competitionId : undefined,
        title: post.title, body: post.body, publish: true,
        // "Send to phones too" (D9): medium; otherwise low, in the app only.
        urgency: post.phones ? "medium" : "low",
      }});
      setComposing(false);
      setPost({ scope: "", schoolId: "", teamCode: "", title: "", body: "", phones: false });
      setNonce(n => n + 1);
    } catch (e) {
      setError(MESSAGE[e?.code] || e?.code || "Could not post that.");
    } finally { setSending(false); }
  };

  // The public home page (SCRBRD-142 §3.5): one door per action, the
  // database deciding who may (db/83). A refusal is shown on the post.
  const [busy, setBusy] = useState(null);
  const [publicError, setPublicError] = useState(null);
  const door = async (id, action) => {
    setPublicError(null); setBusy(id + action);
    try {
      await api(`/api/news/${id}/public/${action}`, { method: "POST" });
      setNonce(n => n + 1);
    } catch (e) {
      setPublicError({ id, text: MESSAGE[e?.code] || e?.code || "Could not do that." });
    } finally { setBusy(null); }
  };
  const waiting = rows.filter(n => n.publicState === "requested" && n.mayApprove && !n.mine);

  return (
    <div>
      <SectionHeader title="Newsfeed"
        subtitle="Notices for your side, your school and the leagues you play in"
        actions={canPublish && <Btn size="sm" data-testid="news-compose" onClick={()=>{setError(null);setComposing(true);}}>＋ Post a notice</Btn>}/>

      {waiting.length>0 && (
        <Card data-testid="news-approvals" sx={{padding:"14px",marginBottom:"12px"}}>
          <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>Asked for the SCRBRD home page</div>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,lineHeight:1.5,marginBottom:"10px"}}>
            Anyone can read the home page. Approve only a post that talks about sides: no pupil's name, no photo, no health, no discipline, no address or contact.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
            {waiting.map(n=>(
              <div key={n.id} data-testid={`news-approve-${n.id}`} style={{borderTop:`1px solid ${D.border}`,paddingTop:"10px"}}>
                <div style={{display:"flex",gap:"8px",alignItems:"center",marginBottom:"4px",flexWrap:"wrap"}}>
                  <Badge color={TIER[n.scope]?.tone || D.textMuted}>{n.audience}</Badge>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>{n.author}</span>
                </div>
                <div style={{fontFamily:D.head,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>{n.title}</div>
                <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.6,whiteSpace:"pre-wrap",margin:"4px 0 8px"}}>{n.body}</div>
                {n.publicNames>0 && (
                  <div role="alert" style={{marginBottom:"8px",fontFamily:D.body,fontSize:"12px",color:textOn(D.rose)}}>{MESSAGE.names_pupils}</div>
                )}
                {publicError?.id===n.id && (
                  <div role="alert" style={{marginBottom:"8px",fontFamily:D.body,fontSize:"12px",color:textOn(D.rose)}}>{publicError.text}</div>
                )}
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                  <Btn size="sm" data-testid={`news-approve-yes-${n.id}`} disabled={!!busy||n.publicNames>0} onClick={()=>door(n.id,"approve")}>
                    Approve: no names, photos, health, discipline or contact details
                  </Btn>
                  <Btn size="sm" variant="ghost" data-testid={`news-approve-no-${n.id}`} disabled={!!busy} onClick={()=>door(n.id,"withdraw")}>Decline</Btn>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {loading && rows.length===0 && (
        <Card sx={{padding:"16px"}}><div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Loading…</div></Card>
      )}

      {!loading && rows.length===0 && (
        <EmptyState icon="newspaper" title="Nothing posted yet"
          hint={canPublish
            ? "Notices you post appear here, and reach exactly the people the tier names."
            : "When your school or your side posts a notice, it appears here."}/>
      )}

      <div data-testid="news-list" style={{display:"flex",flexDirection:"column",gap:"10px"}}>
        {rows.map(n=>(
          <Card key={n.id} data-testid={`news-${n.id}`} sx={{padding:"14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px",flexWrap:"wrap"}}>
              <Badge color={TIER[n.scope]?.tone || D.textMuted}>{n.audience}</Badge>
              {n.draft && <Badge color={D.amber}>Draft</Badge>}
              <span style={{marginLeft:"auto",fontFamily:D.mono,fontSize:"10px",color:D.textMuted}}>
                {n.at ? new Date(n.at).toLocaleDateString() : ""}
              </span>
            </div>
            <div style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>{n.title}</div>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{n.body}</div>
            <div style={{fontFamily:D.body,fontSize:"10px",color:D.textMuted,marginTop:"8px"}}>{n.author}</div>
            <PublicRow n={n} busy={!!busy} onDoor={door} error={publicError?.id===n.id ? publicError.text : null}/>
          </Card>
        ))}
      </div>

      {composing && (
        <Modal title="Post a notice" onClose={()=>{setComposing(false);setError(null);}}>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,lineHeight:1.5,marginBottom:"10px"}}>
            Who sees this is decided by the tier, not by who you send it to.
          </div>
          {tiers.length>1 && (
            <Select label="Audience" value={scope} onChange={v=>setPost(p=>({...p,scope:v}))}
                    options={tiers.map(([k,t])=>({value:k,label:t.label}))}/>
          )}
          {scope!=="competition" && schools.length>1 && (
            <Select label="School" value={post.schoolId||schools[0]?.id||""}
                    onChange={v=>setPost(p=>({...p,schoolId:v}))}
                    options={schools.map(s=>({value:s.id,label:s.name}))}/>
          )}
          {scope==="team" && (
            <Input label="Side" value={post.teamCode} onChange={v=>setPost(p=>({...p,teamCode:v}))} placeholder="1XI"/>
          )}
          <Input label="Headline" value={post.title} onChange={v=>setPost(p=>({...p,title:v}))} placeholder="Saturday's fixture moved"/>
          <div style={{marginBottom:"14px"}}>
            <label htmlFor="news-compose-body" style={{display:"block",fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>Notice</label>
            {/* D11: what a machine cannot check, said to the writer before the words. */}
            <p id="news-compose-readers" data-testid="news-compose-readers" style={{margin:"0 0 8px",fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.5}}>
              {READERS[scope] || READERS.team} Nothing about a child's health, home or discipline; those have their own screens.
            </p>
            <textarea id="news-compose-body" aria-describedby="news-compose-readers" value={post.body} onChange={e=>setPost(p=>({...p,body:e.target.value}))} rows={5}
              placeholder="What people need to know."
              style={{width:"100%",padding:"9px 12px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
                color:D.textPrimary,fontFamily:D.body,fontSize:"13px",resize:"vertical"}}/>
          </div>
          {/* D9: medium, a pointer on the phone; low stays in the app. Never high. */}
          <label data-testid="news-compose-phones-row" style={{display:"flex",gap:"10px",alignItems:"flex-start",minHeight:"44px",cursor:"pointer",marginBottom:"14px"}}>
            <input type="checkbox" checked={post.phones} onChange={e=>setPost(p=>({...p,phones:e.target.checked}))} data-testid="news-compose-phones"
              aria-describedby="news-compose-phones-hint" style={{width:"20px",height:"20px",marginTop:"2px",flexShrink:0}}/>
            <span>
              <span style={{display:"block",fontFamily:D.body,fontSize:"13px",fontWeight:700,color:D.textPrimary}}>Send to phones too</span>
              <span id="news-compose-phones-hint" style={{display:"block",fontFamily:D.body,fontSize:"12px",color:D.textMuted,lineHeight:1.5}}>
                {post.phones
                  ? "Phones that allow alerts show “You have a new notice.” The words stay in the app."
                  : "In the app only: it waits in Notices and News until people open SCRBRD."}
              </span>
            </span>
          </label>
          {error && (
            <div data-testid="news-error" role="alert" style={{marginBottom:"10px",padding:"8px 10px",borderRadius:D.sm,
              background:D.rose+"14",border:`1px solid ${D.rose}33`,fontFamily:D.body,fontSize:"11px",color:textOn(D.rose)}}>{error}</div>
          )}
          <div style={{display:"flex",gap:"8px",justifyContent:"flex-end"}}>
            <Btn variant="ghost" onClick={()=>{setComposing(false);setError(null);}}>Cancel</Btn>
            <Btn onClick={send} disabled={sending||post.title.trim().length<3||!post.body.trim()}>
              {sending?"Posting…":"Post"}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

const PUBLIC_WORDS = {
  none:      "Public: not asked",
  requested: "Public: asked (waiting for the office)",
  approved:  "Public: on the home page",
  edited:    "Public: edited since it was approved, so off the home page",
  withdrawn: "Public: withdrawn",
};

/**
 * A post's line about the public home page (SCRBRD-142 §3.5): its state, and
 * the one button that state allows. The author sees it on a sent team or
 * school post; the school's publishers see it once somebody has asked, so
 * the office can take a coach's post down.
 */
function PublicRow({ n, busy, onDoor, error }) {
  if (n.draft || n.scope === "competition") return null;
  if (!n.mine && !(n.mayTakeDown && n.publicState)) return null;
  const state = n.publicState || "none";
  const action =
    n.mine && (state === "none" || state === "withdrawn" || state === "edited") ? { door: "request", label: state === "none" ? "Ask to put this on the home page" : "Ask again" }
    : n.mine && state === "requested" ? { door: "withdraw", label: "Withdraw the request" }
    : state === "approved" ? { door: "withdraw", label: "Take it off the home page" }
    : null;
  return (
    <div data-testid={`news-public-${n.id}`} style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap",marginTop:"10px",paddingTop:"8px",borderTop:`1px solid ${D.border}`}}>
      <span style={{fontFamily:D.body,fontSize:"12px",color:state==="approved"?textOn(D.emerald):D.textMuted}}>{PUBLIC_WORDS[state]}</span>
      {action && (
        <span style={{marginLeft:"auto"}}>
          <Btn size="sm" variant="ghost" data-testid={`news-public-${action.door}-${n.id}`} disabled={busy}
               onClick={()=>onDoor(n.id, action.door)}>{action.label}</Btn>
        </span>
      )}
      {error && <div role="alert" style={{width:"100%",fontFamily:D.body,fontSize:"12px",color:textOn(D.rose)}}>{error}</div>}
    </div>
  );
}

// Who reads a post, by its tier: said above the words (D11), because what goes
// in them is the writer's to judge and no machine's.
const READERS = {
  team: "Everyone on the side reads this, pupils and parents too.",
  school: "Everyone at the school reads this, pupils and parents too.",
  competition: "Everyone at every school in the league reads this, pupils and parents too.",
};

// The office's words for what the server refuses, so the screen never shows a
// reason code to somebody who has to act on it.
const MESSAGE = {
  names_pupils: "This post names a pupil. Public posts talk about sides, not boys — reword it, or keep it on the school's feed.",
  own_post: "Somebody else at the school approves this: nobody approves their own post.",
  already_requested: "This post is already waiting for the office.",
  already_public: "This post is already on the home page.",
  not_published: "Send the notice first; only a sent notice can go on the home page.",
  scope_not_public: "League notices cannot go on the home page yet.",
  not_requested: "Nobody has asked for this post to go on the home page.",
  no_such_post: "That post is no longer there.",
  not_permitted: "You do not hold the tier this audience needs.",
  scope_invalid: "Choose who this notice is for.",
  title_required: "A headline is needed.",
  body_required: "A notice needs something in it.",
  school_required: "Choose the school this is for.",
  team_code_required: "Name the side this is for, like 1XI.",
  competition_required: "Choose the league this is for.",
  urgency_invalid: "A notice goes to the app, or to phones too; nothing louder.",
};

export { NewsView };
