/**
 * The Training screen's plan editor and register (GA-I26a §1.3, §1.4, §4.3).
 *
 * THE PLAN names no boy: it is the side's noticeboard, read by everyone at
 * the side, parents included. A drill picker over the library, the session
 * type's default filter ("suits this session") and every drill below it,
 * minutes per line, reorder by buttons (44px; the keyboard's way and the
 * phone's), and the legacy free-text drills shown as "Other" and not edited.
 *
 * THE REGISTER has four words, one tap each: present, late, excused, absent.
 * There is no fifth and no free text: `injured` is a health word on a list the
 * whole side reads (AH-D9), and the reason for an absence is not ours to take
 * here. A boy left unmarked is "no register taken" for him, which is not an
 * absence and is not sent.
 *
 * Who may do either is the policy's (team.training.run); the screen offers the
 * buttons to a reader who holds it and the server decides again.
 */
import { useState } from "react";
import { D, T } from "../../design/tokens.js";
import { Modal } from "../../ui/primitives.jsx";
import { drillCategoriesForSession } from "@scrbrd/scoring";
import { REGISTER_STATES } from "../../lib/assessmentHistory.js";
import { moved, minutesProblem, savePlan, saveRegister, PLAN_MAX_DRILLS } from "../../lib/trainingPlan.js";
import { writeWords } from "../../lib/development.js";

const tap = (extra = {}) => ({
  minHeight: "44px", minWidth: "44px", padding: "0 14px", borderRadius: D.pill, cursor: "pointer",
  border: `1px solid ${D.border}`, background: "transparent", color: D.textSecondary,
  fontFamily: D.body, fontSize: "12px", ...extra,
});
const primary = (off) => tap({ background: D.gradMain, color: T.light.ink, border: "1px solid transparent", fontWeight: 700, opacity: off ? 0.5 : 1 });

/** A session's plan, as one readable line each: "Throw-downs · 20 min". @param {any[]} lines */
export function PlanList({ lines, other }) {
  if (!lines.length && !other.length) return null;
  return (
    <div data-testid="session-plan" style={{ margin: "0 0 8px" }}>
      {lines.length > 0 && (
        <ol style={{ margin: 0, padding: "0 0 0 18px", fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.6 }}>
          {lines.map((l) => <li key={`${l.sessionId}-${l.position}`}>{l.name} · {l.minutes} min</li>)}
        </ol>
      )}
      {other.length > 0 && (
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "4px" }}>Other: {other.join(", ")}</div>
      )}
    </div>
  );
}

/** The plan editor for one session. @param {{ session: any, plan: any[], drills: any[], onClose: () => void, onDone: () => void }} p */
export function PlanEditor({ session, plan, drills, onClose, onDone }) {
  const [lines, setLines] = useState(() => plan.map((l) => ({
    drillId: l.drillId, name: l.name, category: l.category, minutes: l.ownMinutes ? String(l.minutes) : "", own: l.minutes })));
  const [filter, setFilter] = useState("suits");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const suits = drillCategoriesForSession(session.type);
  const onPlan = new Set(lines.map((l) => l.drillId));
  const offered = drills.filter((d) => !onPlan.has(d.id) && (filter === "all" || suits.has(String(d.category).toLowerCase())));
  const problem = lines.map((l) => minutesProblem(l.minutes)).find(Boolean) ?? null;
  const save = async () => {
    setBusy(true); setSaid("");
    try { await savePlan(session.id, lines); onDone(); }
    catch (e) { setSaid(writeWords(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`Plan · ${session.title}`} width="560px" onClose={onClose}>
      <div data-testid="plan-editor">
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, lineHeight: 1.5 }}>
          The plan is for the whole side, parents included. It names nobody.
        </div>
        <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.06em", margin: "14px 0 6px" }}>ON THE PLAN</div>
        {lines.length === 0 && <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>Nothing yet. Add a drill from the library below.</div>}
        {lines.map((l, i) => (
          <div key={l.drillId} data-testid={`plan-line-${i}`} style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", borderBottom: `1px solid ${D.border}`, padding: "4px 0" }}>
            <div style={{ flex: "1 1 140px", fontFamily: D.body, fontSize: "14px", color: D.textPrimary }}>{i + 1}. {l.name}</div>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>
              Minutes
              <input aria-label={`Minutes for ${l.name}`} type="number" inputMode="numeric" min={5} max={180} value={l.minutes} placeholder={String(l.own ?? "")}
                onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)))}
                style={{ width: "72px", minHeight: "44px", padding: "0 8px", borderRadius: D.md, background: D.surf2, border: `1px solid ${D.border}`, color: D.textPrimary, fontFamily: D.mono, fontSize: "14px" }}/>
            </label>
            <button type="button" aria-label={`Move ${l.name} up`} disabled={i === 0} onClick={() => setLines((ls) => moved(ls, i, -1))} style={tap({ opacity: i === 0 ? 0.4 : 1 })}>Up</button>
            <button type="button" aria-label={`Move ${l.name} down`} disabled={i === lines.length - 1} onClick={() => setLines((ls) => moved(ls, i, 1))} style={tap({ opacity: i === lines.length - 1 ? 0.4 : 1 })}>Down</button>
            <button type="button" aria-label={`Take ${l.name} off the plan`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={tap()}>Remove</button>
          </div>
        ))}
        {session.drills?.length > 0 && (
          <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "8px" }}>Other, as typed when the session was made (not edited here): {session.drills.join(", ")}</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", margin: "16px 0 6px" }}>
          <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.06em" }}>THE LIBRARY</div>
          <label style={{ marginLeft: "auto", fontFamily: D.body, fontSize: "12px", color: D.textMuted, display: "flex", alignItems: "center", gap: "6px" }}>
            Show
            <select data-testid="plan-filter" value={filter} onChange={(e) => setFilter(e.target.value)}
              style={{ minHeight: "44px", padding: "0 10px", borderRadius: D.md, background: D.surf2, border: `1px solid ${D.border}`, color: D.textPrimary, fontFamily: D.body, fontSize: "14px" }}>
              <option value="suits">Drills that suit a {session.type} session</option>
              <option value="all">Every drill</option>
            </select>
          </label>
        </div>
        {offered.length === 0 && <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>No more drills to show.</div>}
        {offered.map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: `1px solid ${D.border}` }}>
            <div style={{ flex: 1, fontFamily: D.body, fontSize: "14px", color: D.textPrimary, padding: "4px 0" }}>
              {d.name} <span style={{ fontFamily: D.mono, fontSize: "12px", color: D.textMuted }}>{d.category} · {d.duration} min</span>
            </div>
            <button type="button" data-testid={`plan-add-${d.id}`} aria-label={`Add ${d.name} to the plan`} disabled={lines.length >= PLAN_MAX_DRILLS}
              onClick={() => setLines((ls) => [...ls, { drillId: d.id, name: d.name, category: d.category, minutes: "", own: d.duration }])} style={tap()}>Add</button>
          </div>
        ))}
        {(problem || said) && <div role="alert" style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText, marginTop: "10px", lineHeight: 1.5 }}>{said || problem}</div>}
        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          <button type="button" data-testid="plan-save" disabled={busy || !!problem} onClick={save} style={primary(busy || !!problem)}>{busy ? "Saving…" : "Save the plan"}</button>
          <button type="button" onClick={onClose} style={tap()}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The register for one session: the side's roster, four states, one tap each,
 * saved as a whole. Tapping the state a boy already has clears it, unless
 * that mark is already saved: the route upserts and never deletes, so a saved
 * mark is changed to another of the four, not cleared to an entry it would
 * keep on the server while the sheet showed none.
 * @param {{ session: any, roster: any[], register: any[], onClose: () => void, onDone: () => void }} p
 */
export function RegisterSheet({ session, roster, register, onClose, onDone }) {
  const [saved] = useState(() => new Set(register.filter((r) => r.sessionId === session.id).map((r) => r.playerId)));
  const [marks, setMarks] = useState(() => Object.fromEntries(
    register.filter((r) => r.sessionId === session.id).map((r) => [r.playerId, r.status])));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const marked = Object.values(marks).filter(Boolean).length;
  const save = async () => {
    setBusy(true); setSaid("");
    try { await saveRegister(session.id, marks); onDone(); }
    catch (e) { setSaid(writeWords(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`Register · ${session.title}`} width="560px" onClose={onClose}>
      <div data-testid="register-sheet">
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, lineHeight: 1.5 }}>
          Mark who was there. A boy you leave unmarked has no entry; that is not a mark against him.
        </div>
        {roster.length === 0 && <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "10px" }}>No players are on this side for you to mark.</div>}
        {roster.map((p) => (
          <div key={p.id} data-testid={`register-row-${p.id}`} style={{ borderBottom: `1px solid ${D.border}`, padding: "8px 0" }}>
            <div style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary, marginBottom: "6px" }}>{p.name}</div>
            <div role="radiogroup" aria-label={`${p.name}: attendance`} style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(44px,1fr))", gap: "6px" }}>
              {REGISTER_STATES.map((st) => {
                const on = marks[p.id] === st;
                return (
                  <button key={st} type="button" role="radio" aria-checked={on} data-state={st} data-testid={`register-${p.id}-${st}`}
                    onClick={() => setMarks((m) => ({ ...m, [p.id]: on && !saved.has(p.id) ? "" : st }))}
                    style={tap({ padding: "0 6px", background: on ? D.emerald + "22" : "transparent", border: `1px solid ${on ? D.emerald : D.border}`,
                                 color: on ? D.textPrimary : D.textSecondary, fontWeight: on ? 700 : 400, textTransform: "capitalize" })}>{st}</button>
                );
              })}
            </div>
          </div>
        ))}
        {said && <div role="alert" style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText, marginTop: "10px", lineHeight: 1.5 }}>{said}</div>}
        <div style={{ display: "flex", gap: "8px", marginTop: "16px", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" data-testid="register-save" disabled={busy || marked === 0} onClick={save} style={primary(busy || marked === 0)}>
            {busy ? "Saving…" : `Save the register (${marked} marked)`}
          </button>
          <button type="button" onClick={onClose} style={tap()}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
