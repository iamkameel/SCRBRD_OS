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

  const [post, setPost] = useState({ scope: "", schoolId: "", teamCode: "", title: "", body: "" });
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
      }});
      setComposing(false);
      setPost({ scope: "", schoolId: "", teamCode: "", title: "", body: "" });
      setNonce(n => n + 1);
    } catch (e) {
      setError(MESSAGE[e?.code] || e?.code || "Could not post that.");
    } finally { setSending(false); }
  };

  return (
    <div>
      <SectionHeader title="Newsfeed"
        subtitle="Notices for your side, your school and the leagues you play in"
        actions={canPublish && <Btn size="sm" data-testid="news-compose" onClick={()=>{setError(null);setComposing(true);}}>＋ Post a notice</Btn>}/>

      {loading && rows.length===0 && (
        <Card sx={{padding:"16px"}}><div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>Loading…</div></Card>
      )}

      {!loading && rows.length===0 && (
        <EmptyState icon="📰" title="Nothing posted yet"
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
          </Card>
        ))}
      </div>

      {composing && (
        <Modal title="Post a notice" onClose={()=>{setComposing(false);setError(null);}}>
          <div style={{fontFamily:D.body,fontSize:"11px",color:D.textMuted,lineHeight:1.5,marginBottom:"10px"}}>
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
            <label style={{display:"block",fontFamily:D.head,fontSize:"10px",fontWeight:700,color:D.textMuted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"5px"}}>Notice</label>
            <textarea value={post.body} onChange={e=>setPost(p=>({...p,body:e.target.value}))} rows={5}
              placeholder="What people need to know."
              style={{width:"100%",padding:"9px 12px",background:D.surf2,border:`1px solid ${D.border}`,borderRadius:D.md,
                color:D.textPrimary,fontFamily:D.body,fontSize:"13px",resize:"vertical"}}/>
          </div>
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

// The office's words for what the server refuses, so the screen never shows a
// reason code to somebody who has to act on it.
const MESSAGE = {
  not_permitted: "You do not hold the tier this audience needs.",
  scope_invalid: "Choose who this notice is for.",
  title_required: "A headline is needed.",
  body_required: "A notice needs something in it.",
  school_required: "Choose the school this is for.",
  team_code_required: "Name the side this is for, like 1XI.",
  competition_required: "Choose the league this is for.",
};

export { NewsView };
