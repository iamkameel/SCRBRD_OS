import { useEffect, useId, useRef, useState } from "react";
import { T, clr } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { ASK_INTRO, ASK_PUPIL, ASK_STATE_WORDS, JOBS, NAME_MAX, TOWN_MAX, askSentWords, askWords, buildAsk } from "../lib/schoolAsk.js";

// ══════════════════════════════════════════════════════
//  "ASK SCRBRD TO ADD MY SCHOOL"  (EXPERIENCE_PASS §2.7, Q22; db/158)
//
//  The no-school home's door for a school that is not in the join list: a
//  short note (the school's name, its town, what the person does there) that
//  a person at SCRBRD reads and answers. It adds no school and links nobody
//  (lib/schoolAsk.js). The asker's notes show under "Your requests", each
//  with what happens next.
// ══════════════════════════════════════════════════════

const FONT = { head: "'Syne',sans-serif", body: "'DM Sans',sans-serif" };
const text = (size = 14, color = T.content.secondary) => ({ fontFamily: FONT.body, fontSize: `${size}px`, lineHeight: 1.5, color });
const input = () => ({ width: "100%", minHeight: "44px", boxSizing: "border-box", padding: "10px 12px", borderRadius: "10px",
  background: T.fill.field, border: `1px solid ${T.line.normal}`, color: T.content.primary, fontFamily: FONT.body, fontSize: "16px" });
const label = { display: "block", fontFamily: FONT.head, fontSize: "12px", fontWeight: 700, color: T.content.secondary, marginBottom: "6px" };

function Btn({ children, kind = "quiet", style, ...rest }) {
  const main = kind === "primary";
  return (
    <button type="button" className="pressBtn" {...rest}
      style={{ minHeight: "44px", padding: "10px 18px", borderRadius: "999px", boxSizing: "border-box",
        cursor: rest.disabled ? "not-allowed" : "pointer", opacity: rest.disabled ? 0.5 : 1,
        border: main ? "none" : `1px solid ${T.line.strong}`,
        background: main ? T.light.action : "transparent", color: main ? T.light.ink : T.content.secondary,
        fontFamily: FONT.head, fontSize: "13px", fontWeight: 700, ...style }}>{children}</button>
  );
}

/** The door's link, where the join list has no school for this person. */
export function AskSchoolLink({ onAsk, testId = "join-school-ask", children = "Ask SCRBRD to add my school" }) {
  return (
    <button type="button" className="pressBtn" onClick={onAsk} data-testid={testId}
      style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0", border: "none", background: "transparent",
        cursor: "pointer", color: T.brand.blueText, fontFamily: FONT.body, fontSize: "14px", fontWeight: 600, textAlign: "left" }}>
      {children}
    </button>
  );
}

/**
 * The note. `startName` is what the person typed into the school search.
 * `post` is api() unless a test hands in another.
 * @param {{ startName?: string, onSent?: () => void, onClose?: () => void, post?: typeof api }} p
 */
export function AskSchool({ startName = "", onSent, onClose, post = api }) {
  const [form, setForm] = useState({ name: startName.slice(0, NAME_MAX), town: "", job: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(null);
  const head = useRef(null);
  const nameId = useId(), townId = useId(), jobId = useId();
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setProblem(""); };
  const built = buildAsk(form);

  // Opened from the list: the note is scrolled to and its heading focused.
  useEffect(() => {
    const h = head.current;
    if (!h) return;
    const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    h.scrollIntoView?.({ behavior: still ? "auto" : "smooth", block: "start" });
    h.focus({ preventScroll: true });
  }, [sent]);

  const send = async () => {
    const r = buildAsk(form);
    if (!r.ok) { setProblem(r.problem); return; }
    setBusy(true); setProblem("");
    try {
      await post("/api/school-requests", { method: "POST", body: r.body });
      setSent(r.body.schoolName);
      onSent?.();
    } catch (e) { setProblem(askWords(e)); }
    setBusy(false);
  };

  const box = { borderRadius: "16px", border: `1px solid ${T.line.normal}`, background: T.fill.panel, padding: "20px", marginBottom: "16px" };
  if (sent) {
    return (
      <div role="status" data-testid="school-ask-sent" style={box}>
        <h2 ref={head} tabIndex={-1} style={{ margin: "0 0 6px", fontFamily: FONT.head, fontSize: "16px", fontWeight: 800, color: T.content.primary, outline: "none" }}>Request sent</h2>
        <div style={text(14)}>{askSentWords(sent)}</div>
        <Btn style={{ marginTop: "14px" }} data-testid="school-ask-done" onClick={onClose}>Done</Btn>
      </div>
    );
  }
  return (
    <section data-testid="school-ask" aria-labelledby="school-ask-title" style={box}>
      <h2 id="school-ask-title" ref={head} tabIndex={-1} style={{ margin: "0 0 4px", fontFamily: FONT.head, fontSize: "18px", fontWeight: 800, color: T.content.primary, outline: "none" }}>Ask SCRBRD to add my school</h2>
      <div style={{ ...text(14), marginBottom: "16px" }}>{ASK_INTRO}</div>
      <div style={{ marginBottom: "14px" }}>
        <label htmlFor={nameId} style={label}>The school's name</label>
        <input id={nameId} value={form.name} maxLength={NAME_MAX} onChange={(e) => set("name", e.target.value)} style={input()} autoComplete="off" data-testid="school-ask-name"/>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label htmlFor={townId} style={label}>Its town</label>
        <input id={townId} value={form.town} maxLength={TOWN_MAX} onChange={(e) => set("town", e.target.value)} style={input()} autoComplete="off" data-testid="school-ask-town"/>
      </div>
      <div style={{ marginBottom: "14px" }}>
        <label htmlFor={jobId} style={label}>What do you do there?</label>
        <select id={jobId} value={form.job} onChange={(e) => set("job", e.target.value)} style={input()} data-testid="school-ask-job">
          <option value="">Choose…</option>
          {JOBS.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
        </select>
      </div>
      <div role="note" style={{ ...text(13), marginBottom: "14px" }}>{ASK_PUPIL}</div>
      {problem && <div role="alert" data-testid="school-ask-problem" style={{ ...text(13, T.semantic.criticalText), padding: "10px 12px", borderRadius: "8px", background: clr(T.semantic.critical, 0.1), border: `1px solid ${clr(T.semantic.critical, 0.2)}`, marginBottom: "12px" }}>{problem}</div>}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <Btn kind="primary" data-testid="school-ask-send" disabled={busy || !built.ok} onClick={send}>{busy ? "Sending…" : "Send to SCRBRD"}</Btn>
        <Btn data-testid="school-ask-cancel" onClick={onClose}>Cancel</Btn>
      </div>
    </section>
  );
}

/**
 * The asker's notes, under "Your requests": the school, its town, and what
 * the state means for what happens next.
 * @param {{ rows: { id: string, schoolName: string, town: string, state: string }[] }} p
 */
export function SchoolAskRows({ rows }) {
  return rows.map((r) => (
    <div key={r.id} data-testid={`school-request-${r.state}`} style={{ padding: "12px 14px", border: `1px solid ${T.line.normal}`, borderRadius: "12px", background: T.fill.panel, marginBottom: "8px" }}>
      <div style={{ ...text(14, T.content.primary), fontWeight: 600 }}>Add {r.schoolName}, {r.town}</div>
      <div style={text(13, T.content.secondary)}>SCRBRD · {ASK_STATE_WORDS[r.state] ?? r.state}</div>
    </div>
  ));
}
