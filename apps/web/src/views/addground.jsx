/**
 * Fields → Add ground (PILOT_LOAD gap 4), over POST /api/grounds
 * (planner-api.mjs groundCreate): a name, an optional surface, and optionally
 * the field it is a pitch on.
 *
 * WHAT THIS DECIDES: nothing. The control is offered where schoolsWhere() finds
 * a school the signed-in person holds facility.manage at (a courtesy: the
 * ground table's own insert policy decides again), and every refusal the route
 * names is shown in words (lib/listing.js groundRefusal). The name's limits are
 * the route's, checked here only so a name that is too short is not sent.
 *
 * Type is 12px at the smallest and every control 44px tall.
 */
import { useId, useRef, useState } from "react";
import { D, textOn, inkOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { GROUND_NAME_MAX, GROUND_SURFACE_MAX, fieldsOf, groundBody, groundFormReady, groundRefusal } from "../lib/listing.js";

const label = () => ({ display: "block", fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.04em", margin: "10px 0 4px" });
const field = () => ({ width: "100%", minHeight: "44px", padding: "9px 12px", background: D.surf2, boxSizing: "border-box",
  border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: "14px" });
const note = (bad) => ({ fontFamily: D.body, fontSize: "12px", lineHeight: 1.5, margin: "8px 0 0", color: bad ? textOn(D.rose) : D.textSecondary });
const pill = (quiet, disabled) => ({ minHeight: "44px", padding: "8px 16px", borderRadius: D.pill, cursor: disabled ? "not-allowed" : "pointer",
  background: quiet ? "transparent" : D.sky, border: `1px solid ${quiet ? D.border : "transparent"}`, color: quiet ? D.textPrimary : inkOn(D.sky),
  fontFamily: D.head, fontSize: "12px", fontWeight: 700, opacity: disabled ? 0.45 : 1 });

/** The button Fields puts in its header. */
export function AddGroundButton({ open, onClick }) {
  return (
    <button type="button" className="pressBtn" data-testid="add-ground-open" aria-expanded={open} onClick={onClick}
      style={{ ...pill(false, false), fontSize: "13px" }}>
      Add ground
    </button>
  );
}

/**
 * @param {{ schools: Array<{ id: string, name: string }>, grounds: any[], onAdded: (g: any) => void, onClose: () => void }} props
 *   `schools`: where this person holds facility.manage; `grounds`: the list as read, for the fields a pitch may lie on
 */
export function AddGroundForm({ schools, grounds, onAdded, onClose }) {
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [name, setName] = useState("");
  const [surface, setSurface] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [added, setAdded] = useState("");
  const nameRef = useRef(null);
  const ids = { school: useId(), name: useId(), surface: useId(), parent: useId() };
  const fields = fieldsOf(grounds, schoolId);
  const ready = groundFormReady({ schoolId, name, surface });
  const submit = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setSaid(""); setAdded("");
    try {
      const g = await api("/api/grounds", { method: "POST", body: groundBody({ schoolId, name, surface, parentId }) });
      setAdded(`Added ${g.name}${g.parentId ? ` as a pitch on ${grounds.find((x) => x.id === g.parentId)?.name ?? "that field"}` : ""}.`);
      setName(""); setSurface(""); setParentId("");
      onAdded(g);
      nameRef.current?.focus();
    } catch (err) { setSaid(groundRefusal(err)); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} data-testid="add-ground-form" aria-label="Add ground"
      style={{ background: D.surf1, border: `1px solid ${D.border}`, borderRadius: D.lg, padding: "14px 16px", marginBottom: "16px", maxWidth: "520px" }}>
      <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>Add ground</div>
      {schools.length > 1 && (
        <>
          <label htmlFor={ids.school} style={label()}>School</label>
          <select id={ids.school} value={schoolId} onChange={(e) => { setSchoolId(e.target.value); setParentId(""); }} style={field()} data-testid="add-ground-school">
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}
      <label htmlFor={ids.name} style={label()}>Name</label>
      <input id={ids.name} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={GROUND_NAME_MAX} autoComplete="off"
        style={field()} data-testid="add-ground-name" aria-describedby={`${ids.name}-hint`}/>
      <div id={`${ids.name}-hint`} style={note(false)}>2 to {GROUND_NAME_MAX} characters.</div>
      <label htmlFor={ids.surface} style={label()}>Surface (optional)</label>
      <input id={ids.surface} value={surface} onChange={(e) => setSurface(e.target.value)} maxLength={GROUND_SURFACE_MAX} autoComplete="off"
        style={field()} data-testid="add-ground-surface"/>
      <label htmlFor={ids.parent} style={label()}>Is a pitch on (optional)</label>
      <select id={ids.parent} value={parentId} onChange={(e) => setParentId(e.target.value)} style={field()} data-testid="add-ground-parent">
        <option value="">Not a pitch on another ground</option>
        {fields.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "14px" }}>
        <button type="submit" className="pressBtn" disabled={!ready || busy} data-testid="add-ground-save" style={pill(false, !ready || busy)}>Add ground</button>
        <button type="button" className="pressBtn" onClick={onClose} data-testid="add-ground-close" style={pill(true, false)}>Close</button>
      </div>
      {said && <p role="alert" data-testid="add-ground-refused" style={note(true)}>{said}</p>}
      {added && <p role="status" data-testid="add-ground-added" style={note(false)}>{added}</p>}
    </form>
  );
}
