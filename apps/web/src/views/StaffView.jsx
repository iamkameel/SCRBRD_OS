
import { useState } from "react";
import { ROLES } from "../design/roles.js";
import { D, T, themed } from "../design/tokens.js";
import { humanDate } from "../lib/format.js";
import { rolesPresent, staffFrom } from "../lib/staff.js";
import { Avatar, Badge, Card, EmptyState, SectionHeader } from "../ui/primitives.jsx";
import { useLive, useRows } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  STAFF VIEW — the school's staff, from its role assignments
// ══════════════════════════════════════════════════════
function StaffView({ role }) {
  // The school's own staff are the people who hold a staff role there: the
  // `users` and `assignments` reads Settings → People uses, through the same
  // choke point (row-scoped and column-masked for this principal). The old
  // `staff` and `coach` tables are not read: nothing writes them (lib/staff.js).
  const accounts = useLive("users", role);
  const appointments = useLive("assignments", role);
  // The clearance register, for the reader's own school. Empty for anybody
  // the server did not hand it to, and the panel is not drawn: whether the
  // office may see who is unchecked is decided in clearance_register(), and
  // this screen only draws the answer.
  const REGISTER = useRows("clearance_register", role);
  const [filter, setFilter] = useState("all");
  const [selId, setSelId]   = useState(null);

  const today = new Date().toLocaleDateString("en-CA");
  const STAFF = staffFrom(accounts.rows, appointments.rows, today);
  const present = rolesPresent(STAFF).sort((a, b) => (ROLES[a]?.label ?? a).localeCompare(ROLES[b]?.label ?? b));
  const filtered = filter === "all" ? STAFF : STAFF.filter((s) => s.roles.some((r) => r.role === filter));
  const sel = STAFF.find((s) => s.id === selId) ?? null;
  const loading = accounts.loading || appointments.loading;
  const failed = !!accounts.error;
  const label = (r) => ROLES[r]?.label ?? r;
  const colour = (r) => ROLES[r]?.color ?? T.content.secondary;

  const chip = (on, c) => ({
    minHeight: `${T.floor.target}px`, padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer",
    border: `1px solid ${on ? c : T.line.normal}`, background: on ? c + "22" : "transparent",
    color: on ? T.content.primary : T.content.secondary, ...T.role.body, fontWeight: on ? 700 : 500,
  });
  const roleBadge = (r) => (
    <Badge key={r.key} color={colour(r.role)} data-testid="staff-role" data-role={r.role}>
      {label(r.role)}{r.team ? ` · ${r.team}` : ""}{r.state === "paused" ? " · paused" : ""}
    </Badge>
  );

  return (
    <div className="os-page" data-testid="staff-view">
      <SectionHeader title="Staff" sub="Everyone at the school who holds a staff role" color={D.cyan}/>
      <p data-testid="staff-source" style={{ ...T.role.body, color: T.content.secondary, margin: `0 0 ${T.space.lg}`, maxWidth: "72ch" }}>
        This is the school's role assignments. To add someone, or to give them another role, use Settings → People.
      </p>

      {present.length > 1 && (
        <div role="group" aria-label="Filter by role" style={{ display: "flex", gap: T.space.sm, marginBottom: T.space.xl, flexWrap: "wrap" }}>
          {["all", ...present].map((f) => (
            <button key={f} type="button" onClick={() => { setFilter(f); setSelId(null); }} className="pressBtn" aria-pressed={filter === f}
                    data-testid={`staff-filter-${f}`} style={chip(filter === f, f === "all" ? T.content.secondary : colour(f))}>
              {f === "all" ? "Everyone" : label(f)}
            </button>
          ))}
        </div>
      )}

      {REGISTER.length > 0 && <ClearanceRegister rows={REGISTER}/>}

      {failed ? (
        <Card sx={{ padding: T.space.lg }}><EmptyState error/></Card>
      ) : loading && STAFF.length === 0 ? (
        <Card sx={{ padding: T.space.lg }}><EmptyState loading/></Card>
      ) : filtered.length === 0 ? (
        <Card sx={{ padding: T.space.lg }}>
          <div data-testid="staff-none" style={{ ...T.role.body, color: T.content.secondary }}>
            {STAFF.length === 0 ? "No one holds a staff role at this school yet. Add people in Settings → People." : "No one holds that role."}
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: sel ? "minmax(0,1fr) minmax(0,360px)" : "1fr", gap: T.space.lg, alignItems: "start" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: T.space.md }}>
            {filtered.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setSelId(sel?.id === s.id ? null : s.id)} className="pressBtn" aria-pressed={sel?.id === s.id}
                        data-testid="staff-card" data-email={s.email ?? ""}
                        style={{ width: "100%", minHeight: `${T.floor.target}px`, textAlign: "left", cursor: "pointer", padding: T.space.lg,
                                 borderRadius: T.radius.md, background: sel?.id === s.id ? colour(s.roles[0].role) + "10" : T.surface.raised,
                                 border: `1px solid ${sel?.id === s.id ? colour(s.roles[0].role) : T.line.normal}`, color: T.content.primary }}>
                  <span style={{ display: "flex", gap: T.space.md, alignItems: "center", marginBottom: T.space.sm }}>
                    <Avatar name={s.name} size={44} color={colour(s.roles[0].role)}/>
                    <span style={{ ...T.role.body, fontWeight: 700 }} data-testid="staff-name">{s.name}</span>
                  </span>
                  <span style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>{s.roles.map(roleBadge)}</span>
                </button>
              </li>
            ))}
          </ul>

          {sel && (
            <Card sx={{ padding: T.space.lg }} data-testid="staff-detail">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: T.space.md, marginBottom: T.space.md }}>
                <div style={{ display: "flex", gap: T.space.md, alignItems: "center" }}>
                  <Avatar name={sel.name} size={48} color={colour(sel.roles[0].role)}/>
                  <div style={{ ...T.role.title.md, color: T.content.primary }}>{sel.name}</div>
                </div>
                <button type="button" onClick={() => setSelId(null)} className="pressBtn" data-testid="staff-close"
                        style={{ minHeight: `${T.floor.target}px`, minWidth: `${T.floor.target}px`, background: "none", border: "none", cursor: "pointer", color: T.content.secondary, ...T.role.body }}>
                  Close
                </button>
              </div>
              <div style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap", marginBottom: T.space.md }}>{sel.roles.map(roleBadge)}</div>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: `${T.space.xs} ${T.space.lg}`, ...T.role.body }}>
                <dt style={{ color: T.content.secondary }}>Email</dt>
                <dd style={{ margin: 0, color: T.content.primary, wordBreak: "break-all" }}>{sel.email ?? "Not shown to you"}</dd>
                {sel.teams.length > 0 && <><dt style={{ color: T.content.secondary }}>Sides</dt><dd style={{ margin: 0, color: T.content.primary }}>{sel.teams.join(", ")}</dd></>}
                <dt style={{ color: T.content.secondary }}>Signed in</dt>
                <dd style={{ margin: 0, color: T.content.primary }}>{sel.lastSeen ? humanDate(String(sel.lastSeen).slice(0, 10)) : "Never"}</dd>
              </dl>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// One word per check, the server's word, in the server's order: the gaps
// first. Nothing here derives a status from a date. The tones are text-safe
// halves (criticalText, not critical, which is fill only).
const STATUS_TONE = themed(() => ({ missing:T.semantic.criticalText, expired:T.semantic.criticalText,
                                    revoked:T.semantic.warning, expiring:T.semantic.warning, current:T.semantic.positive }));
// What the register now asks, in the office's words (K4, db/56). The rule
// itself is the database's: a record that breaks it is refused with a
// sentence naming the date it should have carried.
const CSA_RULE = "CSA's Safeguarding Policy: a police clearance, the Children's Act register and the "
  + "Sexual Offences Register for every adult who works with children, each renewed within 24 months "
  + "(a first police clearance no older than six months); the Safeguarding Awareness Certificate every "
  + "year; and the signed acknowledgement. A check recorded before these rules stays current until its own date.";
function ClearanceRegister({ rows }) {
  const [open, setOpen] = useState(true);
  const gaps = rows.filter(r=>r.status!=="current").length;
  const byPerson = rows.reduce((acc,r)=>{ (acc[r.personId] ??= { name:r.name, role:r.role, checks:[] }).checks.push(r); return acc; }, {});
  const cell = { padding:`${T.space.sm} ${T.space.sm}`, ...T.role.body };
  return (
    <Card sx={{padding:T.space.lg,marginBottom:T.space.xl}} data-testid="clearance-register">
      <div style={{display:"flex",alignItems:"center",gap:T.space.md,marginBottom:open?T.space.md:0,flexWrap:"wrap"}}>
        <div style={{...T.role.title.md,color:T.content.primary}}>Clearance register</div>
        <Badge color={gaps?T.semantic.criticalText:T.semantic.positive}>{gaps?`${gaps} to chase`:"all current"}</Badge>
        <button onClick={()=>setOpen(!open)} className="pressBtn" aria-expanded={open}
          style={{marginLeft:"auto",minHeight:`${T.floor.target}px`,minWidth:`${T.floor.target}px`,padding:`0 ${T.space.md}`,
                  background:"none",border:"none",cursor:"pointer",color:T.content.secondary,...T.role.label}}>{open?"Hide":"Show"}</button>
      </div>
      {open&&(
        <>
          <p data-testid="clearance-rule" style={{...T.role.body,color:T.content.secondary,margin:`0 0 ${T.space.md}`,maxWidth:"72ch"}}>{CSA_RULE}</p>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{color:T.content.secondary,textAlign:"left"}}>
                <th style={{...cell,...T.role.label}}>Adult</th><th style={{...cell,...T.role.label}}>Role</th><th style={{...cell,...T.role.label}}>Checks</th>
              </tr></thead>
              <tbody>
                {Object.entries(byPerson).map(([id,p])=>(
                  <tr key={id} data-testid={`clearance-row-${id}`} style={{borderTop:`1px solid ${T.line.normal}`,verticalAlign:"top"}}>
                    <td style={{...cell,color:T.content.primary,fontWeight:600,whiteSpace:"nowrap"}}>{p.name}</td>
                    <td style={{...cell,color:T.content.secondary}}>{ROLES[p.role]?.label ?? p.role}</td>
                    <td style={cell}>
                      <div style={{display:"flex",gap:T.space.xs,flexWrap:"wrap"}}>
                        {p.checks.map(c=>(
                          <span key={c.kind} data-testid={`clearance-check-${id}-${c.kind}`} title={c.expiresOn?`${c.status} · lapses ${c.expiresOn}`:c.status}
                            style={{display:"inline-flex",gap:T.space.xs,alignItems:"baseline",padding:`${T.space.xs} ${T.space.sm}`,borderRadius:T.radius.pill,
                                    border:`1px solid ${STATUS_TONE[c.status]}`,color:T.content.primary,fontSize:`${T.floor.read}px`,lineHeight:1.4}}>
                            {c.kindLabel}
                            <span style={{color:STATUS_TONE[c.status],fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>{c.status}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

export { StaffView };
