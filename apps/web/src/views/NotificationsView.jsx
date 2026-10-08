import { useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { Badge, Card, ReadState, SectionHeader } from "../ui/primitives.jsx";
import { useNotifications } from "../lib/notifications.js";
import { readState } from "../lib/readState.js";
import { Icon } from "../ui/icons.jsx";

/**
 * Notices (docs/design/NOTIFICATIONS.md D17).
 *
 * The list and the count come from the one store every badge reads
 * (lib/notifications.js): the rows the server agreed to send this person, and
 * the server's count of the unread among them. Read state is the server's,
 * per person, on every device — this screen holds only which notice is open.
 *
 * Opening a notice marks it read. A notice behind more than news.read (an
 * injury, a welfare flag, a lift, a referral) lists its title only, and its
 * body is read when it is opened; the server logs that open. A notice taken
 * back opens as one sentence, "This notice was withdrawn on …", and one that
 * is no longer this person's as "This notice is no longer available."
 */
function NotificationsView({ role }) {
  // Retry bumps the read's own nonce: the same reads, the same role, nothing wider.
  const [nonce, setNonce] = useState(0);
  const { list, rows, unread, opened, open, markAll } = useNotifications(role, nonce, { fresh: true });
  // "0 unread alerts" over a read that failed, or one that is still coming, is
  // a figure nobody counted. The count is said only of an answer (GA-I08).
  const said = readState(list, { what: "the notices" });
  const counted = (said.state === "ok" || said.state === "empty") && unread != null;
  const [openId, setOpenId] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));
  const [result, setResult] = useState(/** @type {Record<string, any>} */ ({}));

  const toggle = async (/** @type {any} */ n) => {
    if (openId === n.id) { setOpenId(null); return; }
    setOpenId(n.id);
    // Opening is what marks it read, and how a tiered body is fetched. Opened
    // already in this session: nothing to ask again. A news.read notice that
    // is already read has nothing more to give.
    if ((opened[n.id] && !opened[n.id].failed) || (n.read && !n.tiered)) return;
    setBusy(n.id);
    const r = await open(n.id);
    setBusy(null);
    setResult((m) => ({ ...m, [n.id]: r }));
  };

  const ic = (/** @type {string} */ t) => t==="fixture"?"stumps":t==="injury"?"bandage":t==="lift"?"bus":t==="recognition"?"medal":t==="availability"?"calendar":"megaphone";
  const uc = (/** @type {string} */ u) => u==="high"?D.rose:u==="medium"?D.amber:D.textMuted;
  return (
    <div className="os-page">
      <SectionHeader title="Notifications" sub={counted ? `${unread} unread alerts` : "Unread alerts not counted"} color={D.rose}
        actions={counted && unread>0 && (
          <button type="button" className="pressBtn" onClick={() => { void markAll(); }} data-testid="notifications-mark-all"
            style={{minHeight:"44px",padding:"0 16px",borderRadius:D.pill,border:`1px solid ${D.border}`,background:"transparent",color:D.textSecondary,cursor:"pointer",fontFamily:D.head,fontSize:"12px",fontWeight:700,letterSpacing:"0.04em"}}>
            Mark all read
          </button>
        )}/>
      {said.state!=="ok"&&<Card><ReadState read={said} onRetry={()=>setNonce(n=>n+1)} icon="bell" testId="notifications-read-state"/></Card>}
      <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
        {rows.map((n) => {
          const isOpen = openId === n.id;
          const got = result[n.id] ?? opened[n.id];
          // The body: in the list for a news.read notice; on open for a tiered one.
          const body = n.body ?? (got && !got.gone && !got.withdrawn && !got.failed ? got.body : null);
          const sentence = got && (got.gone || got.withdrawn || got.failed) ? got.sentence : null;
          return (
            <Card key={n.id} data-testid="notice-row" data-unread={n.read ? undefined : "true"} data-tiered={n.tiered ? "true" : undefined}
              sx={{padding:0,background:n.read?"transparent":D.indigo+"08",border:`1px solid ${n.read?D.border:D.indigo+"22"}`}}>
              <div style={{display:"flex",gap:"12px",alignItems:"flex-start",padding:"6px 16px 14px"}}>
                <div aria-hidden="true" style={{width:"36px",height:"36px",marginTop:"8px",borderRadius:D.md,background:uc(n.urgency)+"18",border:`1px solid ${uc(n.urgency)}22`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",flexShrink:0,color:textOn(uc(n.urgency))}}>
                  <Icon name={ic(n.type)}/>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:"8px"}}>
                    {/* The title is the control: opening the notice reads it and marks it read. */}
                    <button type="button" onClick={() => { void toggle(n); }} aria-expanded={isOpen} data-testid="notice-open"
                      style={{flex:1,minWidth:0,minHeight:"44px",padding:0,margin:0,background:"none",border:"none",textAlign:"left",cursor:"pointer",
                        fontFamily:D.body,fontSize:"13px",fontWeight:n.read?400:700,color:D.textPrimary}}>
                      {n.title}{!n.read && <span className="sr-only"> (unread)</span>}
                    </button>
                    <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                      <span style={{fontFamily:D.mono,fontSize:"12px",color:D.textMuted}}>{n.time ? String(n.time).slice(0, 10) : ""}</span>
                      {!n.read&&<div aria-hidden="true" style={{width:"7px",height:"7px",borderRadius:"50%",background:uc(n.urgency)}}/>}
                    </div>
                  </div>
                  {body && (isOpen || !n.tiered) && <p data-testid="notice-body" style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,lineHeight:1.5,margin:0}}>{body}</p>}
                  {!body && n.tiered && !isOpen && <p style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,lineHeight:1.5,margin:0}}>Open to read.</p>}
                  {isOpen && busy === n.id && <p role="status" style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,margin:0}}>Opening…</p>}
                  {isOpen && sentence && <p data-testid="notice-sentence" style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary,margin:0}}>{sentence}</p>}
                  <div style={{display:"flex",gap:"5px",marginTop:"6px"}}>
                    <Badge color={uc(n.urgency)}>{n.urgency}</Badge>
                    <Badge color={D.textMuted}>{n.type}</Badge>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export { NotificationsView };
