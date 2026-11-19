import { useState } from "react";
import { SectionHeader } from "../ui/primitives.jsx";
import { holdsCapability } from "../rbac/index.js";
import { D, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { humanDate } from "../lib/format.js";
import { saDate } from "../lib/saTime.js";
import { OWN_WORDS, PLATFORM_INTRO, askAge, jobLabel, schoolDecideWords, schoolDecidedWords } from "../lib/schoolAsk.js";

// ══════════════════════════════════════════════════════
//  REQUESTS TO ADD A SCHOOL  (EXPERIENCE_PASS Q22; db/158)
//
//  The platform's list (platform.tenant.manage): every note asking SCRBRD to
//  add a school, who asked and how to reach them, and Added or Decline on
//  each open one, the same two controls the office's Requests panel draws
//  (ManagementView RequestsPanel). `decidable` is the server's word. An
//  answer adds no school: PLATFORM_INTRO says so above the list.
// ══════════════════════════════════════════════════════
export function SchoolRequestsPanel({ emptyWords = null }) {
  const [nudge, setNudge] = useState(0);
  const [said, setSaid] = useState({});
  const [busy, setBusy] = useState(null);
  const read = useLive("school_add_requests", "platformadmin", nudge);
  const all = read.rows;
  const open = all.filter((r) => r.decidable);
  // Her own, asked before she was made a platform administrator (db/158
  // own_request): shown, and answered by somebody else, so no controls.
  const own = all.filter((r) => r.mine && r.state === "open");
  const gone = Object.entries(said).filter(([id]) => !open.some((r) => r.id === id));
  if (!open.length && !own.length && !gone.length) {
    // As a section of its own (the Platform home), an empty list is said, not left blank.
    if (!emptyWords || read.loading) return null;
    return <div data-testid="school-requests-none" style={{border:`1px solid ${D.border}`,borderRadius:D.lg,background:D.surf1,padding:"14px",fontFamily:D.body,fontSize:"13px",color:D.textSecondary}}>{emptyWords}</div>;
  }
  const decide = async (r, state) => {
    if (busy) return;
    setBusy(r.id);
    setSaid((m) => { const { [r.id]: _dropped, ...rest } = m; return rest; });
    try {
      await api(`/api/school-requests/${r.id}/decide`, { method: "POST", body: { state } });
      setSaid((m) => ({ ...m, [r.id]: { ok: true, text: schoolDecidedWords(state, r.schoolName) } }));
    } catch (e) {
      setSaid((m) => ({ ...m, [r.id]: { ok: false, text: schoolDecideWords(e) } }));
    }
    setBusy(null);
    setNudge((n) => n + 1);
  };
  const line = (id, x) => (
    <div key={id} role={x.ok ? "status" : "alert"} data-testid={x.ok ? `school-request-done-${id}` : `school-request-refused-${id}`}
      style={{width:"100%",fontFamily:D.body,fontSize:"13px",lineHeight:1.4,color:textOn(x.ok ? D.emerald : D.rose)}}>
      {x.text}
    </div>
  );
  return (
    <div data-testid="school-requests-panel" style={{border:`1px solid ${D.border}`,borderRadius:D.lg,background:D.surf1,padding:"14px"}}>
      <div style={{fontFamily:D.head,fontSize:"12px",fontWeight:700,color:D.textPrimary,marginBottom:"4px"}}>{open.length ? `Schools to add · ${open.length}` : own.length ? "Schools to add" : "Schools to add: answered"}</div>
      <div style={{fontFamily:D.body,fontSize:"12px",lineHeight:1.5,color:D.textSecondary,marginBottom:"8px"}}>{PLATFORM_INTRO}</div>
      {gone.map(([id, x]) => line(id, x))}
      {open.map((r)=>(
        <div key={r.id} data-testid={`school-request-row-${r.id}`} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 0",borderTop:`1px solid ${D.border}`,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:"200px"}}>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:600,overflowWrap:"anywhere"}}>{r.schoolName}, {r.town}</div>
            <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,overflowWrap:"anywhere"}}>{r.name ?? "Someone"} <span>{r.email ?? ""}</span> · {jobLabel(r.job)} · {humanDate(saDate(r.requestedAt))}, {askAge(r.requestedAt).words}</div>
            {/* The asker was told a week (Kameel, 15 Nov): past it, said so. */}
            {askAge(r.requestedAt).late&&<div data-testid={`school-request-late-${r.id}`} style={{fontFamily:D.body,fontSize:"12px",fontWeight:600,color:D.roseText}}>Over a week: the person was told they would hear within a week.</div>}
          </div>
          <button onClick={()=>decide(r,"added")} disabled={!!busy} data-testid={`school-request-added-${r.id}`} className="pressBtn" style={{padding:"5px 16px",minHeight:"44px",borderRadius:D.pill,border:"none",cursor:"pointer",background:D.emerald+"22",color:D.emerald,fontFamily:D.head,fontSize:"12px",fontWeight:700}}>Added</button>
          <button onClick={()=>decide(r,"declined")} disabled={!!busy} data-testid={`school-request-decline-${r.id}`} className="pressBtn" style={{padding:"5px 16px",minHeight:"44px",borderRadius:D.pill,border:`1px solid ${D.border}`,cursor:"pointer",background:"transparent",color:D.textMuted,fontFamily:D.head,fontSize:"12px",fontWeight:700}}>Decline</button>
          {said[r.id]&&line(r.id, said[r.id])}
        </div>
      ))}
      {own.map((r)=>(
        <div key={r.id} data-testid={`school-request-own-${r.id}`} style={{padding:"8px 0",borderTop:`1px solid ${D.border}`}}>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textPrimary,fontWeight:600,overflowWrap:"anywhere"}}>{r.schoolName}, {r.town}</div>
          <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>{OWN_WORDS}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The Platform home's School requests (EXPERIENCE_PASS §1.3, Slice 6): the
 * same panel ManagementView drew for platform.tenant.manage, as a section of
 * its own. The menu offers it under that capability (design/roles.js); the
 * read is the server's, as it was.
 */
export function SchoolRequestsView({ role }) {
  // Courtesy only, as Support and the DLS table carry: the menu offers the section under this capability, and the
  // read's row security (school_add_request_read) decides again.
  if (!holdsCapability(role, "platform.tenant.manage")) return null;
  return (
    <div className="os-page" data-testid="part-requests">
      <SectionHeader title="School requests" sub="Schools people asked SCRBRD to add. Each is answered within a week." color={D.indigo}/>
      <SchoolRequestsPanel emptyWords="Nobody is waiting for a school to be added."/>
    </div>
  );
}
