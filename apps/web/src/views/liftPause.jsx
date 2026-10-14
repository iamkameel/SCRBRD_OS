import { useState } from "react";
import { D, T, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { LIFTED_WORDS, LIFT_NOTE_MAX, liftErrorWords } from "../lib/staffRegister.js";

/**
 * "Lift the pause" on a safeguarding officer's notice that an account has been
 * paused from asking (db/93, SCRBRD-140 phase 2 §4.2).
 *
 *   POST /api/cooldowns/:id/lift { note? }
 *
 * The notice names the pause by its id and names nobody: this screen does not
 * know whose account it is, and does not ask. Only a DSO at the school may lift
 * it; request_cooldown_lift() decides, and a refusal is shown in the route's
 * own words. The optional note goes on the record, not to the person.
 *
 * Floors: nothing under 12px, nothing tapped under 44px.
 * @param {{ id: string, post?: typeof api }} p
 */
export function LiftPause({ id, post = api }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState(false);

  const lift = async () => {
    setBusy(true); setProblem("");
    try {
      await post(`/api/cooldowns/${encodeURIComponent(id)}/lift`, { method: "POST", body: note.trim() ? { note: note.trim().slice(0, LIFT_NOTE_MAX) } : {} });
      setDone(true); setOpen(false);
    } catch (e) { setProblem(liftErrorWords(e)); }
    setBusy(false);
  };

  const btn = (primary) => ({ minHeight: "44px", minWidth: "44px", padding: "0 16px", borderRadius: D.pill, cursor: busy ? "not-allowed" : "pointer",
    fontFamily: D.head, fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em", opacity: busy ? 0.5 : 1,
    background: primary ? D.gradMain : "transparent", color: primary ? T.light.ink : D.textSecondary, border: `1px solid ${primary ? "transparent" : D.border}` });

  if (done) return <p role="status" data-testid="pause-lifted" style={{ fontFamily: D.body, fontSize: "12px", color: textOn(D.emerald), lineHeight: 1.5, margin: "6px 0 0" }}>{LIFTED_WORDS}</p>;
  return (
    <div data-testid="pause-lift" style={{ marginTop: "6px", display: "grid", gap: "8px" }}>
      {!open && (
        <div>
          <button type="button" className="pressBtn" data-testid="pause-lift-open" onClick={() => setOpen(true)} style={btn(false)}>Lift the pause</button>
        </div>
      )}
      {open && (
        <div role="group" aria-label="Lift the pause" style={{ display: "grid", gap: "8px" }}>
          <p style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.5, margin: 0 }}>
            The account can send a request again at once. Your note goes on the record, not to the person.
          </p>
          <label htmlFor={`pause-note-${id}`} style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textSecondary }}>Why (optional)</label>
          <input id={`pause-note-${id}`} data-testid="pause-lift-note" value={note} maxLength={LIFT_NOTE_MAX} onChange={(e) => setNote(e.target.value)} autoComplete="off"
                 style={{ minHeight: "44px", boxSizing: "border-box", padding: "10px 12px", background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: "14px", width: "100%" }}/>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="pressBtn" data-testid="pause-lift-confirm" disabled={busy} onClick={lift} style={btn(true)}>{busy ? "Lifting…" : "Lift the pause"}</button>
            <button type="button" className="pressBtn" data-testid="pause-lift-cancel" disabled={busy} onClick={() => { setOpen(false); setProblem(""); }} style={btn(false)}>Keep it paused</button>
          </div>
        </div>
      )}
      {problem && <p role="alert" data-testid="pause-lift-problem" style={{ fontFamily: D.body, fontSize: "12px", color: textOn(D.rose), lineHeight: 1.5, margin: 0 }}>{problem}</p>}
    </div>
  );
}
