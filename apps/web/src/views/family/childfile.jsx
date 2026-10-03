/**
 * One child's card on the parent's Family screen (step 4 P6), and the
 * panels it opens: Who to ring (P7a), Their record (P7b), Health, and
 * Consents (P7d — the existing passport and scouting consents, as they are).
 *
 * Each is its own component so that a later card on this screen (a lift
 * club's, the account, the consents read of phase B) is added beside these
 * rather than into them. Every panel reads only when it is opened: opening
 * a child's contacts or record is a disclosure the server logs, and a parent
 * glancing at the Family screen has not asked for one.
 */
import { useState } from "react";
import { roleGrants } from "@scrbrd/policy/roles";
import { T } from "../../design/tokens.js";
import { PERSONA_NAV, ROLE_IDENTITY } from "../../design/roles.js";
import { api } from "../../lib/api.js";
import { useLive } from "../../lib/live.js";
import { humanDate } from "../../lib/format.js";
import { holds, linkEndWords, longDate } from "../../lib/family.js";
import { PassportTab } from "../SettingsView.jsx";
import { PublicNameSwitch } from "../publicname.jsx";
import { Action, Card, Line, OpenRow, Unread } from "./parts.jsx";

/** Roles that never belong in "who else can see this": the break-glass keys and the platform. */
const NOT_A_PERSON_AT_SCHOOL = new Set(["superadmin", "platformadmin"]);

/**
 * Who else may read a capability, by the policy itself — boundaries()-style,
 * never prose (§2.1 P7a): the roles that hold it, as the school names them,
 * leaving out the family persona's own roles and the platform's.
 */
export function whoElseHolds(capability) {
  const mine = new Set(PERSONA_NAV.family.roles);
  // ROLE_IDENTITY names every policy role (design.test holds that), so its
  // keys are the policy's roles, in the order a legend draws them.
  return Object.keys(ROLE_IDENTITY)
    .filter((r) => !NOT_A_PERSON_AT_SCHOOL.has(r) && !mine.has(r) && roleGrants(r, capability))
    .map((r) => ROLE_IDENTITY[r]?.label ?? r);
}

export function ChildFileCard({ child, role, w }) {
  const [panel, setPanel] = useState(null);
  const name = child.knownAs || child.name;
  const toggle = (p) => setPanel((x) => (x === p ? null : p));
  return (
    <Card label={child.name} testid={`family-child-${child.id}`}>
      <Line quiet>{[child.schoolName, child.team, child.verification === "verified" ? "link verified" : null].filter(Boolean).join(" · ")}</Line>
      {child.consent !== "granted" && (
        <Line testid="family-consent-pending">The {w.place}'s terms for {name} are not agreed yet. The office will ask you.</Line>
      )}
      <Line testid={`family-link-end-${child.id}`}>{linkEndWords(child, w)}</Line>
      <div style={{ display: "grid", gap: T.space.xs }}>
        <OpenRow onClick={() => toggle("ring")} testid={`family-open-ring-${child.id}`}>
          <span style={{ ...T.role.body, fontWeight: 600 }}>Who to ring</span>
          <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>The numbers the {w.place} calls if {name} is hurt</span>
        </OpenRow>
        {panel === "ring" && <WhoToRing child={child} role={role}/>}
        <OpenRow onClick={() => toggle("record")} testid={`family-open-record-${child.id}`}>
          <span style={{ ...T.role.body, fontWeight: 600 }}>{name}&apos;s record</span>
          <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>What the {w.place} holds: name, date of birth, address, ID</span>
        </OpenRow>
        {panel === "record" && <TheirRecord child={child} role={role}/>}
        <OpenRow onClick={() => toggle("health")} testid={`family-open-health-${child.id}`}>
          <span style={{ ...T.role.body, fontWeight: 600 }}>Health</span>
          <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>Injuries on record, and when {name} is back</span>
        </OpenRow>
        {panel === "health" && <Health child={child} role={role}/>}
        <OpenRow onClick={() => toggle("consents")} testid={`family-open-consents-${child.id}`}>
          <span style={{ ...T.role.body, fontWeight: 600 }}>Consents</span>
          <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>Public match pages, where {name}&apos;s {w.record} may travel, and scouts</span>
        </OpenRow>
        {panel === "consents" && <Consents child={child} role={role}/>}
      </div>
    </Card>
  );
}

// ── P7a · Who to ring ──────────────────────────────────

const RELATIONSHIPS = [["mother", "Mother"], ["father", "Father"], ["guardian", "Guardian"], ["grandparent", "Grandparent"],
  ["sibling", "Brother or sister"], ["family", "Other family"], ["other", "Someone else"]];
const field = () => ({ minHeight: "44px", ...T.role.control, color: T.content.primary, background: T.surface.base,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: `0 ${T.space.md}`, width: "100%", boxSizing: "border-box" });
const fieldLabel = () => ({ display: "grid", gap: T.space.xs, ...T.role.body, fontSize: "14px", color: T.content.secondary });

export function WhoToRing({ child, role }) {
  const [nonce, setNonce] = useState(0);
  const { rows, loading, error } = useLive("emergency_contacts", role, nonce, { playerId: child.id });
  const mine = rows.filter((c) => c.playerId === child.id).sort((a, b) => a.priority - b.priority);
  const mayManage = holds(role, "player.emergency.manage");
  const [form, setForm] = useState(null);
  const [said, setSaid] = useState("");
  const others = whoElseHolds("player.emergency.read");
  const save = async () => {
    setSaid("");
    try {
      await api(`/api/players/${child.id}/emergency-contacts`, { method: "POST", body: { ...form, priority: Number(form.priority) } });
      setForm(null); setNonce((n) => n + 1);
    } catch (e) { setSaid(SAY[e.code] ?? "Not saved. Check the number and try again."); }
  };
  const retire = async (id) => {
    setSaid("");
    try { await api(`/api/emergency-contacts/${id}/retire`, { method: "POST" }); setNonce((n) => n + 1); }
    catch { setSaid("Not removed. Try again."); }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const free = [1, 2, 3].find((p) => !mine.some((c) => c.priority === p)) ?? 3;
  return (
    <div data-testid="who-to-ring" style={{ display: "grid", gap: T.space.sm, padding: `0 ${T.space.xs}` }}>
      {loading && !rows.length ? <Line quiet>Reading the contacts…</Line> : error ? <Unread what="the contacts"/> : null}
      {!loading && !error && !mine.length && <Line>No one is on record to ring. Add the first number below.</Line>}
      {mine.map((c) => (
        <div key={c.id} data-testid={`contact-${c.id}`} style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md,
          padding: T.space.md, display: "grid", gap: "2px" }}>
          <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>{c.priority}. {c.name} <span style={{ fontWeight: 400, color: T.content.secondary }}>({c.relationship})</span></span>
          <span style={{ ...T.role.figure.sm, color: T.content.primary }}>{c.phone}{c.phoneAlt ? ` · ${c.phoneAlt}` : ""}</span>
          {c.email && <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{c.email}</span>}
          {c.note && <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{c.note}</span>}
          {mayManage && (
            <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", marginTop: T.space.xs }}>
              <Action testid={`contact-edit-${c.id}`} onClick={() => setForm({ priority: String(c.priority), name: c.name, relationship: c.relationship,
                phone: c.phone, phoneAlt: c.phoneAlt ?? "", email: c.email ?? "", note: c.note ?? "" })}>Change</Action>
              <Action testid={`contact-retire-${c.id}`} onClick={() => retire(c.id)}>Remove</Action>
            </div>
          )}
        </div>
      ))}
      {said && <p role="alert" style={{ ...T.role.body, color: T.semantic.criticalText, margin: 0 }}>{said}</p>}
      {mayManage && !form && (
        <div><Action testid="contact-add" onClick={() => setForm({ priority: String(free), name: "", relationship: "mother", phone: "", phoneAlt: "", email: "", note: "" })}>Add a number</Action></div>
      )}
      {form && (
        <form data-testid="contact-form" onSubmit={(e) => { e.preventDefault(); save(); }}
          style={{ display: "grid", gap: T.space.sm, border: `1px solid ${T.line.strong}`, borderRadius: T.radius.md, padding: T.space.md }}>
          <label style={fieldLabel()}>Order to ring in
            <select value={form.priority} onChange={set("priority")} data-testid="contact-priority" style={field()}>
              {[1, 2, 3].map((p) => <option key={p} value={p}>{p === 1 ? "First" : p === 2 ? "Second" : "Third"}</option>)}
            </select>
          </label>
          <label style={fieldLabel()}>Name<input value={form.name} onChange={set("name")} data-testid="contact-name" style={field()} autoComplete="off"/></label>
          <label style={fieldLabel()}>Who they are
            <select value={form.relationship} onChange={set("relationship")} data-testid="contact-relationship" style={field()}>
              {RELATIONSHIPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={fieldLabel()}>Phone<input value={form.phone} onChange={set("phone")} data-testid="contact-phone" inputMode="tel" style={field()}/></label>
          <label style={fieldLabel()}>Another phone (optional)<input value={form.phoneAlt} onChange={set("phoneAlt")} inputMode="tel" style={field()}/></label>
          <label style={fieldLabel()}>Email (optional)<input value={form.email} onChange={set("email")} inputMode="email" style={field()}/></label>
          <label style={fieldLabel()}>A note (optional)<input value={form.note} onChange={set("note")} maxLength={200} style={field()}/></label>
          <Line quiet>A number saved in a place already taken replaces the one there; the old one is kept on record, not deleted.</Line>
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
            <Action primary type="submit" testid="contact-save">Save</Action>
            <Action onClick={() => setForm(null)}>Cancel</Action>
          </div>
        </form>
      )}
      {others.length > 0 && (
        <Line quiet testid="contact-who-else">Who else can see these: {others.join(", ")} — the people around {child.knownAs || child.name} on a match day.</Line>
      )}
    </div>
  );
}

const SAY = {
  phone_invalid: "That phone number does not look right.", phone_alt_invalid: "The other phone number does not look right.",
  email_invalid: "That email address does not look right.", name_required: "Add a name.",
  not_permitted: "The school's records did not take that. Ask the office.",
};

// ── P7b · Their record ─────────────────────────────────

/**
 * What the school holds about the child that she may read (§2.1 P7b), from
 * the `players` read, masked per row by the policy. The ID number is behind
 * a tap and never in a list: it is level 4 and a phone is left on tables.
 * The one place a date of birth is drawn — her own child, on her own screen.
 */
export function TheirRecord({ child, role }) {
  const { rows, loading, error } = useLive("players", role);
  const p = rows.find((r) => r.id === child.id) ?? null;
  const [showId, setShowId] = useState(false);
  if (loading && !rows.length) return <Line quiet>Reading the record…</Line>;
  if (error) return <Unread what="the record"/>;
  if (!p) return <Line quiet>The record could not be read.</Line>;
  const rowsOf = [
    ["Full name", p.name],
    ["Known as", child.knownAs],
    ["Date of birth", p.born ? longDate(p.born) : null],
    ["Address", p.address ?? null],
    ["Home town", p.hometown ?? null],
    ["Height", p.height ? `${p.height} cm` : null],
    ["Weight", p.weight ? `${p.weight} kg` : null],
  ].filter(([, v]) => v);
  return (
    <div data-testid="their-record" style={{ display: "grid", gap: T.space.sm, padding: `0 ${T.space.xs}` }}>
      <dl style={{ margin: 0, display: "grid", gap: T.space.xs }}>
        {rowsOf.map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 150px) 1fr", gap: T.space.md }}>
            <dt style={{ ...T.role.label, color: T.content.secondary }}>{k}</dt>
            <dd style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>{v}</dd>
          </div>
        ))}
        {p.idNumber !== undefined && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 150px) 1fr", gap: T.space.md, alignItems: "center" }}>
            <dt style={{ ...T.role.label, color: T.content.secondary }}>ID number</dt>
            <dd style={{ margin: 0 }}>
              {showId
                ? <span data-testid="record-id" style={{ ...T.role.figure.sm, color: T.content.primary }}>{p.idNumber ?? "Not on record"}</span>
                : <Action testid="record-id-show" onClick={() => setShowId(true)}>Show</Action>}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ── Health ─────────────────────────────────────────────

/** Injuries on record for the child, every tier a guardian holds (§2.1 P6). Notes on a tap. */
export function Health({ child, role, self = false }) {
  const { rows, loading, error, disabled } = useLive("injuries", role);
  const mine = rows.filter((i) => i.player === child.id);
  const [open, setOpen] = useState(null);
  if (disabled) return <Line quiet>The {self ? "" : "school's "}injury records are not in use here.</Line>;
  if (loading && !rows.length) return <Line quiet>Reading the health record…</Line>;
  if (error) return <Unread what="the health record"/>;
  if (!mine.length) return <Line testid="health-none">No injury is on record.</Line>;
  return (
    <div data-testid="health" style={{ display: "grid", gap: T.space.sm, padding: `0 ${T.space.xs}` }}>
      {mine.map((i) => (
        <div key={i.id} data-testid={`injury-${i.id}`} style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: T.space.md, display: "grid", gap: "2px" }}>
          <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>{i.type ?? "An injury"}</span>
          <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>
            {[i.phase, i.severity, i.rtw ? `back ${humanDate(String(i.rtw).slice(0, 10))}` : null].filter(Boolean).join(" · ")}
          </span>
          {(i.notes || i.physio) && (open === i.id
            ? <p data-testid="injury-notes" style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>{[i.notes, i.physio ? `Physio: ${i.physio}` : null].filter(Boolean).join(" · ")}</p>
            : <div><Action testid={`injury-open-${i.id}`} onClick={() => setOpen(i.id)}>The physio&apos;s notes</Action></div>)}
        </div>
      ))}
    </div>
  );
}

// ── P7d · Consents ─────────────────────────────────────

/**
 * The consents that exist today, as they are (§8 phase A): where his record
 * may travel (the passport) and whether accredited scouts may see him — the
 * Settings screen's own PassportTab and ScoutingConsentSection, narrowed to
 * this one child — and, first, whether he is named on public match pages
 * (PUBLIC_DATA C1, publicname.jsx). The consents read and the terms are
 * phase B.
 */
export function Consents({ child, role }) {
  return (
    <div data-testid="family-consents" style={{ display: "grid", gap: T.space.sm }}>
      <PublicNameSwitch child={child}/>
      <PassportTab role={role} only={[child]}/>
    </div>
  );
}
