import { useEffect, useMemo, useRef, useState } from "react";
import { D, textOn, themed } from "../design/tokens.js";
import { Badge, Btn, Card, EmptyState, Input, Modal, SectionHeader, Select } from "../ui/primitives.jsx";
import { Icon } from "../ui/icons.jsx";
import { NewsCover } from "../ui/NewsCover.jsx";
import { useLive } from "../lib/live.js";
import { api } from "../lib/api.js";
import { profile, schoolsWhere } from "../lib/session.js";
import { BAND_LABEL, bandOf, deskOf, kickerOf, longWhenSa, paragraphs, readStore, sideLabel, standfirst, whenSa } from "../lib/newsFeed.js";
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
 * HOW IT READS (6 Nov, Kameel: "a proper news feed"): the newest post is the
 * lead story with a large cover, the rest a grid under Today, This week and
 * Earlier. Each card is a generated cover (ui/NewsCover.jsx: drawn in code, no
 * photograph), the kicker ("1st XI · Westville"), the headline, a standfirst
 * from the body, the SA date and the desk that wrote it, and "Read more",
 * which opens the full read in place (#read-<id>, so the phone's back button
 * closes it). The chips narrow what is on screen to a side, the school or the
 * league; they never widen what the policy sent. A post stays marked New until
 * this viewer opens it, remembered in this browser only (lib/newsFeed.js).
 *
 * THE PUBLIC HOME PAGE (SCRBRD-142 §3.5, db/83): a sent team or school post
 * carries a line saying whether it is on the SCRBRD home page, with the one
 * button its state allows; the school's publishers get a short approvals card
 * at the top. The composer has nothing new for that: a post is asked about
 * after it is posted, so nobody writes "for the public" in haste. A post that
 * is on the home page offers its link there, from the full read.
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

/** The post a #read-<id> address names, or null. */
const readingFromHash = () => {
  try {
    const m = /^#read-([A-Za-z0-9-]{1,64})$/.exec(window.location.hash || "");
    return m ? m[1] : null;
  } catch { return null; }
};

const scrollBox = () => (typeof document === "undefined" ? null : document.getElementById("os-content"));

function NewsView({ role }) {
  const [nonce, setNonce] = useState(0);
  const { rows, loading, error: readError, status } = useLive("news", role, nonce);
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
      setPublicError({ id, text: e?.code === "names_pupils" ? namesPupils(e?.data?.word) : (MESSAGE[e?.code] || e?.code || "Could not do that.") });
    } finally { setBusy(null); }
  };
  const waiting = rows.filter(n => n.publicState === "requested" && n.mayApprove && !n.mine);

  // ── New until opened: this viewer, this browser (lib/newsFeed.js readStore) ──
  const viewer = profile()?.user?.id || role || "anon";
  const store = useMemo(() => readStore(viewer), [viewer]);
  const [opened, setOpened] = useState(() => store.load());
  useEffect(() => { setOpened(store.load()); }, [store]);
  const isNew = (n) => !n.draft && !n.mine && !opened.has(n.id);

  // ── The full read, at #read-<id>: back (the button, or the phone's) closes it ──
  const [readingId, setReadingId] = useState(readingFromHash);
  const pushed = useRef(false);
  const scrollWas = useRef(0);
  const returnTo = useRef(null);
  useEffect(() => {
    const sync = () => { const id = readingFromHash(); pushed.current = pushed.current && !!id; setReadingId(id); };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
      // Leaving the Newsfeed with a post open: the address forgets it.
      try { if (readingFromHash()) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); } catch { /* no history: nothing to tidy */ }
    };
  }, []);
  useEffect(() => { if (readingId) setOpened(store.mark([readingId])); }, [readingId, store]);
  useEffect(() => {
    const box = scrollBox();
    if (readingId) { box?.scrollTo?.({ top: 0 }); return; }
    // Back on the feed: where the reader was, and focus on the card's own button.
    if (box && scrollWas.current) box.scrollTo?.({ top: scrollWas.current });
    const id = returnTo.current; returnTo.current = null;
    if (id) requestAnimationFrame(() => document.querySelector(`[data-testid="news-open-${id}"]`)?.focus?.());
  }, [readingId]);
  const openPost = (id) => {
    scrollWas.current = scrollBox()?.scrollTop ?? 0;
    returnTo.current = id;
    try { window.history.pushState(window.history.state, "", `#read-${id}`); pushed.current = true; } catch { pushed.current = false; }
    setReadingId(id);
  };
  const closePost = () => {
    if (pushed.current) { pushed.current = false; try { window.history.back(); return; } catch { /* fall through */ } }
    try { window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); } catch { /* nothing to tidy */ }
    setReadingId(null);
  };

  // ── The chips: narrow what is on screen; never widen what the policy sent ──
  const [filter, setFilter] = useState("all");
  const chips = useMemo(() => chipsOf(rows, isNew), [rows, opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = chips.some(c => c.key === filter) ? filter : "all";
  const shown = useMemo(() => rows.filter(n => matches(n, chips.find(c => c.key === active), isNew)), [rows, chips, active, opened]); // eslint-disable-line react-hooks/exhaustive-deps
  const unreadCount = rows.filter(isNew).length;
  const lead = shown[0] || null;
  const bands = useMemo(() => {
    const now = Date.now();
    const out = { today: [], week: [], earlier: [] };
    for (const n of shown.slice(1)) out[bandOf(n.at, now)].push(n);
    return out;
  }, [shown]);

  const publicRow = (n) => <PublicRow n={n} busy={!!busy} onDoor={door} error={publicError?.id===n.id ? publicError.text : null}/>;
  const reading = readingId ? rows.find(n => n.id === readingId) : null;

  if (readingId) {
    return (
      <div>
        {reading
          ? <NewsArticle n={reading} onBack={closePost} publicRow={publicRow(reading)} more={rows.filter(m => m.id !== reading.id && m.scope === reading.scope && m.teamCode === reading.teamCode && !m.draft).slice(0, 3)}
                         onOpen={(id) => { returnTo.current = null; try { window.history.replaceState(window.history.state, "", `#read-${id}`); } catch { /* the post still opens */ } setReadingId(id); }}/>
          : <NotInFeed loading={loading} onBack={closePost}/>}
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Newsfeed"
        sub="Notices for your side, your school and the leagues you play in"
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
                  <div role="alert" data-testid={`news-names-${n.id}`} style={{marginBottom:"8px",fontFamily:D.body,fontSize:"12px",color:textOn(D.rose)}}>{namesPupils(n.publicWord)}</div>
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

      {/* The chips: what is on screen, by audience. Only audiences that have a post here. */}
      {rows.length>0 && chips.length>1 && (
        <div role="group" aria-label="Show posts for" className="os-news-chips" data-testid="news-chips" style={{marginBottom:"14px"}}>
          {chips.map(c=>(
            <button key={c.key} type="button" className="pressBtn" data-testid={`news-chip-${c.key}`} aria-pressed={active===c.key}
              onClick={()=>setFilter(c.key)}
              style={{flexShrink:0,minHeight:"44px",padding:"0 16px",borderRadius:D.pill,cursor:"pointer",whiteSpace:"nowrap",
                border:`1px solid ${active===c.key?D.textPrimary:D.border}`,
                background:active===c.key?D.textPrimary:"transparent",
                color:active===c.key?D.bg:D.textSecondary,fontFamily:D.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.04em"}}>
              {c.label}<span style={{marginLeft:"8px",fontFamily:D.mono,fontWeight:500,opacity:0.85}}>{c.count}</span>
            </button>
          ))}
          {unreadCount>0 && (
            <button type="button" className="pressBtn" data-testid="news-mark-all"
              onClick={()=>setOpened(store.mark(rows.filter(isNew).map(n=>n.id)))}
              style={{flexShrink:0,marginLeft:"auto",minHeight:"44px",padding:"0 14px",borderRadius:D.pill,cursor:"pointer",whiteSpace:"nowrap",
                border:"1px solid transparent",background:"transparent",color:D.textSecondary,fontFamily:D.body,fontSize:"12px",textDecoration:"underline",textUnderlineOffset:"3px"}}>
              Mark all as read
            </button>
          )}
        </div>
      )}

      {loading && rows.length===0 && <FeedSkeleton/>}

      {!loading && rows.length===0 && (readError
        ? <Card sx={{padding:"8px"}}><EmptyState error={readError} status={status} what="the newsfeed" onRetry={()=>setNonce(n=>n+1)}/></Card>
        : (
          <Card data-testid="news-empty" className="" sx={{display:"grid",gridTemplateColumns:"1fr",maxWidth:"640px"}}>
            <NewsCover seed="newsfeed-empty" school={schools[0]?.name || "SCRBRD"} scope="school" ratio="21 / 9"/>
            <div style={{padding:"18px 20px 20px"}}>
              <h3 style={{fontFamily:D.head,fontSize:"18px",fontWeight:700,color:D.textPrimary,marginBottom:"6px"}}>Nothing posted yet</h3>
              <p style={{fontFamily:D.body,fontSize:"14px",color:D.textSecondary,lineHeight:1.6,marginBottom:canPublish?"14px":0}}>
                {canPublish
                  ? "Notices you post appear here as stories, and reach exactly the people the audience names."
                  : "When your side, your school or your league posts a notice, it appears here."}
              </p>
              {canPublish && <Btn size="sm" data-testid="news-empty-compose" onClick={()=>{setError(null);setComposing(true);}}>Post the first notice</Btn>}
            </div>
          </Card>
        ))}

      {rows.length>0 && shown.length===0 && (
        <Card data-testid="news-filter-empty" className="" sx={{padding:"20px"}}>
          <p style={{fontFamily:D.body,fontSize:"14px",color:D.textSecondary,marginBottom:"10px"}}>Nothing here under this filter.</p>
          <Btn size="sm" variant="ghost" onClick={()=>setFilter("all")}>Show everything</Btn>
        </Card>
      )}

      <div data-testid="news-list" style={{display:"flex",flexDirection:"column",gap:"24px"}}>
        {lead && (
          <NewsCard n={lead} lead index={0} fresh={isNew(lead)} onOpen={openPost} publicRow={publicRow(lead)}/>
        )}
        {["today","week","earlier"].map(band => bands[band].length>0 && (
          <section key={band} aria-labelledby={`news-band-${band}`} data-testid={`news-band-${band}`}>
            <h3 id={`news-band-${band}`} style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"10px",display:"flex",alignItems:"center",gap:"10px"}}>
              {BAND_LABEL[band]}<span aria-hidden="true" style={{flex:1,height:"1px",background:D.border}}/>
            </h3>
            <div className="os-news-grid">
              {bands[band].map((n,i)=>(
                <NewsCard key={n.id} n={n} index={i+1} fresh={isNew(n)} onOpen={openPost} publicRow={publicRow(n)}/>
              ))}
            </div>
          </section>
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
              background:D.rose+"14",border:`1px solid ${D.rose}33`,fontFamily:D.body,fontSize:"12px",color:textOn(D.rose)}}>{error}</div>
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

/** The chips this feed's own posts call for: All, each side, the school, the league, New. */
function chipsOf(rows, isNew) {
  const out = [{ key: "all", label: "All", count: rows.length }];
  const sides = new Map();
  const schoolsSeen = new Set(rows.map(n => n.schoolId).filter(Boolean));
  for (const n of rows) {
    if (n.scope !== "team" || !n.teamCode) continue;
    const key = `side-${n.schoolId || "x"}-${n.teamCode}`.replace(/[^A-Za-z0-9-]/g, "");
    const label = schoolsSeen.size > 1 && n.schoolName ? `${sideLabel(n.teamCode)} · ${n.schoolName}` : sideLabel(n.teamCode);
    const s = sides.get(key) || { key, label, count: 0, match: { schoolId: n.schoolId, teamCode: n.teamCode } };
    s.count++; sides.set(key, s);
  }
  out.push(...[...sides.values()].sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true })));
  const school = rows.filter(n => n.scope === "school").length;
  if (school) out.push({ key: "school", label: "Whole school", count: school });
  const league = rows.filter(n => n.scope === "competition").length;
  if (league) out.push({ key: "league", label: "League", count: league });
  const fresh = rows.filter(isNew).length;
  if (fresh) out.push({ key: "new", label: "New", count: fresh });
  return out;
}

/** Is this post under this chip? A narrowing of rows already sent, never a widening. */
function matches(n, chip, isNew) {
  if (!chip || chip.key === "all") return true;
  if (chip.key === "school") return n.scope === "school";
  if (chip.key === "league") return n.scope === "competition";
  if (chip.key === "new") return isNew(n);
  return !!chip.match && n.scope === "team" && n.teamCode === chip.match.teamCode && n.schoolId === chip.match.schoolId;
}

/** The kicker's colour, and its words. */
function Kicker({ n, size = "12px" }) {
  const tone = TIER[n.scope]?.tone || D.textMuted;
  return (
    <span data-testid="news-kicker" style={{fontFamily:D.mono,fontSize:size,fontWeight:500,letterSpacing:"0.08em",textTransform:"uppercase",color:textOn(tone),overflowWrap:"anywhere"}}>
      {kickerOf(n)}
    </span>
  );
}

/** The desk and the day, for a card: "1st XI staff · Today, 14:30". */
function Byline({ n, long = false }) {
  const { name, desk } = deskOf(n);
  const when = long ? longWhenSa(n.at) : whenSa(n.at);
  return (
    <div data-testid="news-byline" style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"4px 8px",fontFamily:D.body,fontSize:long?"13px":"12px",color:D.textMuted,lineHeight:1.5}}>
      <span style={{color:D.textSecondary,fontWeight:600}}>{name ? `${name}, ${desk}` : desk}</span>
      {when && <><span aria-hidden="true">·</span><time dateTime={n.at || undefined}>{when}</time></>}
    </div>
  );
}

/**
 * One story on the feed. The cover and the card are a mouse's shortcut to the
 * full read; the keyboard's is "Read more", a real button.
 */
function NewsCard({ n, lead = false, index, fresh, onOpen, publicRow }) {
  const H = lead ? "h3" : "h4";
  const headId = `news-h-${n.id}`;
  return (
    <article data-testid={`news-${n.id}`} data-new={fresh ? "true" : undefined} aria-labelledby={headId}
      className={`os-news-card os-news-in${lead ? " os-news-lead" : ""}`}
      onClick={(e)=>{ if (e.target.closest?.("button, a, [data-no-open]")) return; onOpen(n.id); }}
      style={{animationDelay:`${Math.min(index, 8) * 45}ms`,background:D.surf1,border:`1px solid ${fresh ? D.borderMed : D.border}`,borderRadius:D.lg,overflow:"hidden",
        display:lead?undefined:"flex",flexDirection:lead?undefined:"column",minWidth:0}}>
      <div style={{position:"relative",minHeight:lead?"220px":undefined}}>
        <NewsCover seed={n.id} school={n.schoolName || n.competitionName} team={n.teamCode} scope={n.scope} ratio={lead ? "auto" : "16 / 9"}
          style={lead ? { minHeight: "220px", aspectRatio: "16 / 9" } : undefined}/>
      </div>
      <div style={{padding:lead?"20px 22px 18px":"14px 16px 12px",display:"flex",flexDirection:"column",gap:lead?"10px":"8px",flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
          <Kicker n={n}/>
          {fresh && <Badge color={D.emerald} data-testid={`news-new-${n.id}`}>New</Badge>}
          {n.draft && <Badge color={D.amber}>Draft</Badge>}
          {n.kind === "plan" && <Badge color={D.sky}>Match plan</Badge>}
        </div>
        <H id={headId} style={{fontFamily:D.head,fontSize:lead?"clamp(20px, 2.4vw, 28px)":"16px",fontWeight:700,color:D.textPrimary,lineHeight:1.25,letterSpacing:lead?"-0.01em":0,overflowWrap:"anywhere"}}>
          {n.title}
        </H>
        <p data-testid="news-standfirst" style={{fontFamily:D.body,fontSize:lead?"15px":"13px",color:D.textSecondary,lineHeight:1.6,
          display:"-webkit-box",WebkitLineClamp:lead?4:3,WebkitBoxOrient:"vertical",overflow:"hidden",overflowWrap:"anywhere"}}>
          {standfirst(n.body, lead ? 320 : 200)}
        </p>
        <div style={{marginTop:"auto",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",flexWrap:"wrap"}}>
          <Byline n={n}/>
          <button type="button" className="pressBtn" data-testid={`news-open-${n.id}`} aria-label={`Read more: ${n.title}`} onClick={()=>onOpen(n.id)}
            style={{minHeight:"44px",minWidth:"44px",padding:"0 4px 0 12px",marginRight:"-4px",display:"inline-flex",alignItems:"center",gap:"4px",
              background:"transparent",border:"none",cursor:"pointer",fontFamily:D.head,fontSize:"13px",fontWeight:700,color:textOn(D.sky)}}>
            Read more <Icon name="arrow-up-right" size="14px"/>
          </button>
        </div>
        <div data-no-open="" onClick={(e)=>e.stopPropagation()}>{publicRow}</div>
      </div>
    </article>
  );
}

/** The full read: the cover, the kicker, the headline, the byline, the whole body. */
function NewsArticle({ n, onBack, publicRow, more, onOpen }) {
  const head = useRef(null);
  useEffect(() => { head.current?.focus?.({ preventScroll: true }); }, [n.id]);
  const [copied, setCopied] = useState(null);
  const isPublic = n.publicState === "approved" && !n.draft;
  const share = async () => {
    // The home page's own copy of the post (db/83): the public link names
    // nothing the home page does not already show.
    const url = `${window.location.origin}/#news-${n.id}`;
    try {
      if (navigator.share) { await navigator.share({ title: n.title, url }); setCopied("shared"); return; }
    } catch (e) { if (e?.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); setCopied("copied"); }
    catch { setCopied("failed"); }
  };
  return (
    <article data-testid="news-read" aria-labelledby="news-read-h" className="os-news-in" style={{maxWidth:"760px",margin:"0 auto"}}>
      <button type="button" className="pressBtn" data-testid="news-read-back" onClick={onBack}
        style={{minHeight:"44px",padding:"0 14px 0 8px",marginBottom:"12px",display:"inline-flex",alignItems:"center",gap:"6px",
          borderRadius:D.pill,border:`1px solid ${D.border}`,background:"transparent",color:D.textSecondary,cursor:"pointer",fontFamily:D.head,fontSize:"13px",fontWeight:700}}>
        <Icon name="chevron-left" size="16px"/> Newsfeed
      </button>
      <div style={{borderRadius:D.lg,overflow:"hidden",border:`1px solid ${D.border}`}}>
        <NewsCover seed={n.id} school={n.schoolName || n.competitionName} team={n.teamCode} scope={n.scope} ratio="16 / 9"/>
      </div>
      <header style={{padding:"18px 2px 4px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap",marginBottom:"10px"}}>
          <Kicker n={n} size="13px"/>
          {n.draft && <Badge color={D.amber}>Draft</Badge>}
          {n.kind === "plan" && <Badge color={D.sky}>Match plan</Badge>}
        </div>
        <h2 id="news-read-h" ref={head} tabIndex={-1} style={{fontFamily:D.head,fontSize:"clamp(24px, 5vw, 36px)",fontWeight:800,color:D.textPrimary,lineHeight:1.15,letterSpacing:"-0.015em",outline:"none",overflowWrap:"anywhere",marginBottom:"12px"}}>
          {n.title}
        </h2>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",flexWrap:"wrap",paddingBottom:"14px",borderBottom:`1px solid ${D.border}`}}>
          <Byline n={n} long/>
          {isPublic && (
            <button type="button" className="pressBtn" data-testid="news-read-share" onClick={share}
              style={{minHeight:"44px",padding:"0 16px",display:"inline-flex",alignItems:"center",gap:"6px",borderRadius:D.pill,border:`1px solid ${D.border}`,
                background:D.surf2,color:D.textPrimary,cursor:"pointer",fontFamily:D.head,fontSize:"13px",fontWeight:700}}>
              <Icon name="send" size="14px"/> {copied === "copied" ? "Link copied" : "Share the home-page link"}
            </button>
          )}
        </div>
        {copied === "failed" && <p role="alert" style={{marginTop:"8px",fontFamily:D.body,fontSize:"12px",color:textOn(D.rose)}}>Could not copy the link on this device.</p>}
        {copied === "copied" && <p role="status" className="sr-only">Link copied</p>}
      </header>
      <div data-testid="news-read-body" style={{padding:"16px 2px 8px"}}>
        {paragraphs(n.body).map((para, i) => (
          <p key={i} style={{fontFamily:D.body,fontSize:"16px",color:D.textPrimary,lineHeight:1.75,whiteSpace:"pre-wrap",overflowWrap:"anywhere",marginBottom:"16px",maxWidth:"68ch"}}>{para}</p>
        ))}
      </div>
      {publicRow}
      {more.length>0 && (
        <section aria-labelledby="news-read-more" style={{marginTop:"28px"}}>
          <h3 id="news-read-more" style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textMuted,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"10px"}}>
            More for {kickerOf(n).split(" · ")[0]}
          </h3>
          <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
            {more.map(m=>(
              <button key={m.id} type="button" className="pressBtn" data-testid={`news-more-${m.id}`} onClick={()=>onOpen(m.id)}
                style={{minHeight:"44px",padding:"10px 12px",textAlign:"left",borderRadius:D.md,border:`1px solid ${D.border}`,background:D.surf1,cursor:"pointer",display:"flex",gap:"12px",alignItems:"center"}}>
                <span style={{width:"72px",flexShrink:0,borderRadius:D.sm,overflow:"hidden"}}>
                  <NewsCover seed={m.id} school={m.schoolName || m.competitionName} team={m.teamCode} scope={m.scope} ratio="4 / 3"/>
                </span>
                <span style={{display:"flex",flexDirection:"column",gap:"2px",minWidth:0}}>
                  <span style={{fontFamily:D.head,fontSize:"14px",fontWeight:700,color:D.textPrimary,lineHeight:1.3,overflowWrap:"anywhere"}}>{m.title}</span>
                  <span style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>{whenSa(m.at)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div style={{marginTop:"24px"}}>
        <Btn variant="ghost" size="sm" data-testid="news-read-back-foot" onClick={onBack}>Back to the newsfeed</Btn>
      </div>
    </article>
  );
}

/** A #read-<id> this reader has no post for: withdrawn, or never theirs to read. Nothing of it is shown. */
function NotInFeed({ loading, onBack }) {
  return (
    <Card data-testid="news-read-missing" className="" sx={{padding:"20px",maxWidth:"640px",margin:"0 auto"}}>
      {loading
        ? <p role="status" style={{fontFamily:D.body,fontSize:"14px",color:D.textMuted}}>Opening the post…</p>
        : <>
            <h2 style={{fontFamily:D.head,fontSize:"18px",fontWeight:700,color:D.textPrimary,marginBottom:"6px"}}>This post is not in your newsfeed</h2>
            <p style={{fontFamily:D.body,fontSize:"14px",color:D.textSecondary,lineHeight:1.6,marginBottom:"14px"}}>
              It may have been withdrawn, or it was written for a side or a school you do not follow.
            </p>
          </>}
      <Btn size="sm" variant="ghost" data-testid="news-read-back" onClick={onBack}>Back to the newsfeed</Btn>
    </Card>
  );
}

/** The shape of the feed while the read is on the wire: a lead and three cards, drawn quietly. */
function FeedSkeleton() {
  const bar = (w, h = "12px") => <div style={{width:w,height:h,borderRadius:D.sm,background:D.surf3,animation:"pulse 1.6s ease-in-out infinite"}}/>;
  return (
    <div data-testid="news-loading" role="status" aria-busy="true" style={{display:"flex",flexDirection:"column",gap:"24px"}}>
      <span className="sr-only">Loading the newsfeed…</span>
      <div aria-hidden="true" className="os-news-lead" style={{background:D.surf1,border:`1px solid ${D.border}`,borderRadius:D.lg,overflow:"hidden"}}>
        <div style={{aspectRatio:"16 / 9",background:D.surf2,animation:"pulse 1.6s ease-in-out infinite"}}/>
        <div style={{padding:"20px",display:"flex",flexDirection:"column",gap:"12px"}}>{bar("40%")}{bar("85%","24px")}{bar("95%")}{bar("70%")}</div>
      </div>
      <div aria-hidden="true" className="os-news-grid">
        {[0,1,2].map(i=>(
          <div key={i} style={{background:D.surf1,border:`1px solid ${D.border}`,borderRadius:D.lg,overflow:"hidden"}}>
            <div style={{aspectRatio:"16 / 9",background:D.surf2,animation:"pulse 1.6s ease-in-out infinite"}}/>
            <div style={{padding:"14px",display:"flex",flexDirection:"column",gap:"10px"}}>{bar("35%")}{bar("80%","16px")}{bar("90%")}</div>
          </div>
        ))}
      </div>
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
      {/* The author is told which word of his own post the office cannot approve (db/118). */}
      {!error && n.mine && state === "requested" && n.publicNames > 0 && (
        <div role="alert" data-testid={`news-public-names-${n.id}`} style={{width:"100%",fontFamily:D.body,fontSize:"12px",color:textOn(D.rose)}}>{namesPupils(n.publicWord)}</div>
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

/**
 * The refusal in words, with the word of the post that matched when the
 * server gives it (db/118): the post's own word, never whose name it is.
 * @param {string | null | undefined} word
 */
const namesPupils = (word) => (typeof word === "string" && word
  ? `This post names a pupil: "${word}". Public posts talk about sides, not boys — reword it, or keep it on the school's feed.`
  : MESSAGE.names_pupils);

export { NewsView, namesPupils };
