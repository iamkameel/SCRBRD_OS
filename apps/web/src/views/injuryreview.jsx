import { useEffect, useId, useRef, useState } from "react";
import { T, inkOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { humanDate } from "../lib/format.js";
import { useLive } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import {
  NEXT_REVIEW_SHORTCUTS, PHASE_WORDS, SEVERITY_WORDS, addDaysIso, day10, injurySay, phaseWord, reasonLine, saToday, seenWord,
} from "../lib/injury.js";

/**
 * The physio's pieces of the Injuries screen (GA-I19 slice B; the API is
 * slice A, db/111 and services/api/write/injury-api.mjs).
 *
 *   ReviewsDue        her worklist: every open injury she holds medical.write
 *                     over, each with the one reason it is on her list.
 *   RecordInjuryForm  record an injury (POST /api/injuries).
 *   ReviewForm        a later look at an open injury (POST /api/injuries/:id/reviews).
 *   InjuryHistory     the dated history of one injury, each row at the
 *                     reader's own tier: for the physio, the coach, the
 *                     director, the principal, a parent and the boy himself.
 *
 * WHAT THESE DECIDE: nothing. Each form calls one route, and the database's
 * functions say who may and what is valid; a refusal arrives as a word and is
 * shown as a sentence (lib/injury.js REFUSAL). Where this file hides a control
 * from somebody it is a courtesy to the reader, not a gate: the server refuses
 * the same write whoever presses it.
 *
 * WHO SEES WHAT (design GA-I19 D3, D5):
 *   - ReviewsDue and both forms are drawn by InjuryView for a medical.write
 *     holder alone. ReviewsDue is also the only place that holds the worklist
 *     read, so nobody else's screen asks for it, and there is no count of
 *     "reviews due" in a nav badge, a tile or a row for anybody else.
 *   - InjuryHistory draws the note only where the read returned one (the
 *     clinical tier), the phase only where it returned one (the nature tier),
 *     and the physio's clock (the next review date) for her alone.
 *   - The word "review" is the physio's. Everybody else reads "Seen by the
 *     physio" (lib/injury.js seenWord).
 *
 * Type is 12px at the smallest and every control is 44px tall. Tokens are read
 * at render, so both themes are right. A form opens inline, takes focus into
 * its first field, and hands focus back to the button that opened it.
 */

const dayWord = (/** @type {string} */ iso) => humanDate(iso);

function useStyles() {
  return {
    card: { background: T.surface.raised, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg,
            padding: T.space.lg, display: "flex", flexDirection: "column", gap: T.space.md,
            fontFamily: T.type.body, color: T.content.primary },
    h2: { fontFamily: T.type.body, fontSize: "18px", fontWeight: 600, color: T.content.primary, margin: 0 },
    h3: { fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, color: T.content.primary, margin: 0 },
    body: { fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.5, color: T.content.primary, margin: 0 },
    small: { fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.5, color: T.content.secondary, margin: 0 },
    meta: { fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.4, color: T.content.secondary, margin: 0 },
    label: { display: "grid", gap: T.space.xs, fontFamily: T.type.body, fontSize: "14px", color: T.content.secondary },
    field: { minHeight: "44px", fontFamily: T.type.body, fontSize: "16px", color: T.content.primary, background: T.surface.base,
             border: `1px solid ${T.line.strong}`, borderRadius: T.radius.md, padding: `0 ${T.space.md}`, width: "100%", boxSizing: "border-box" },
    area: { minHeight: "96px", fontFamily: T.type.body, fontSize: "16px", lineHeight: 1.4, color: T.content.primary, background: T.surface.base,
            border: `1px solid ${T.line.strong}`, borderRadius: T.radius.md, padding: T.space.md, width: "100%", boxSizing: "border-box", resize: "vertical" },
    check: { display: "flex", alignItems: "center", gap: T.space.md, minHeight: "44px", fontFamily: T.type.body, fontSize: "15px", color: T.content.primary, cursor: "pointer" },
    box: { width: "24px", height: "24px", flexShrink: 0, accentColor: T.brand.blue },
    primary: { minHeight: "44px", padding: "0 18px", borderRadius: T.radius.pill, border: "none", cursor: "pointer",
               background: T.content.primary, color: inkOn(T.content.primary), fontFamily: T.type.body, fontSize: "15px", fontWeight: 600 },
    secondary: { minHeight: "44px", padding: "0 18px", borderRadius: T.radius.pill, cursor: "pointer", background: "transparent",
                 color: T.content.primary, border: `1px solid ${T.line.strong}`, fontFamily: T.type.body, fontSize: "15px", fontWeight: 600 },
    chip: { minHeight: "44px", minWidth: "44px", padding: "0 14px", borderRadius: T.radius.pill, cursor: "pointer", background: "transparent",
            color: T.content.primary, border: `1px solid ${T.line.strong}`, fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 },
    alert: { fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.4, color: T.semantic.criticalText, margin: 0 },
    confirm: { display: "flex", flexDirection: "column", gap: T.space.sm, padding: T.space.md, borderRadius: T.radius.md,
               background: T.surface.base, border: `1px solid ${T.line.strong}` },
    row: { width: "100%", minHeight: "48px", display: "flex", alignItems: "center", gap: T.space.md, textAlign: "left", cursor: "pointer",
           padding: `${T.space.sm} ${T.space.md}`, background: "transparent", border: `1px solid ${T.line.subtle}`,
           borderRadius: T.radius.md, color: T.content.primary, fontFamily: T.type.body },
  };
}

// ══════════════════════════════════════════════════════
//  Reviews due: the physio's worklist
// ══════════════════════════════════════════════════════

/**
 * Drawn only for a medical.write holder (InjuryView decides), so this is the
 * one place the worklist is read and the one place a count of it appears (D5).
 * `names` maps a player id to what the Injuries read calls him; `onOpen` is
 * given the injury id.
 */
export function ReviewsDue({ role, nonce = 0, names, onOpen }) {
  const s = useStyles();
  const read = useLive("injury_worklist", role, nonce);
  const said = readState(read, { what: "the reviews due" });
  const answered = said.state === "ok" || said.state === "empty";
  const rows = read.rows;
  return (
    <section style={s.card} data-testid="reviews-due" aria-labelledby="reviews-due-title">
      <h2 id="reviews-due-title" style={s.h2}>
        Reviews due{answered && rows.length > 0 && <span data-testid="reviews-due-count" style={{ ...s.meta, marginLeft: T.space.sm }}>{rows.length}</span>}
      </h2>
      {said.state === "loading" && <p role="status" style={s.small}>Reading your list…</p>}
      {(said.state === "failed" || said.state === "forbidden" || said.state === "disabled" || said.state === "partial") && (
        <p role="alert" style={s.alert} data-testid="reviews-due-unread">{said.sentence}</p>
      )}
      {answered && rows.length === 0 && <p style={s.small} data-testid="reviews-due-none">Nothing is due. Every open injury has a review ahead of it.</p>}
      {answered && rows.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.sm }}>
          {rows.map((w) => (
            <li key={w.injury}>
              <button type="button" style={s.row} onClick={() => onOpen(w.injury)} data-testid={`review-due-${w.injury}`} data-reason={w.reason}
                      className="pressBtn os-state">
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "2px" }}>
                  <span style={{ fontSize: "15px", fontWeight: 600 }}>{names(w.player)}</span>
                  <span style={{ fontSize: "14px", color: T.content.secondary }}>{reasonLine(w, dayWord)}</span>
                </span>
                <span aria-hidden="true" style={{ color: T.content.tertiary, fontSize: "18px" }}>›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ══════════════════════════════════════════════════════
//  Form pieces
// ══════════════════════════════════════════════════════

/**
 * The next-review date (Q10): required, no default, and two shortcuts. The
 * shortcuts set the date from today in South Africa; the field stays editable.
 */
function NextReviewField({ value, onChange, today, invalid, describedBy, inputRef }) {
  const s = useStyles();
  const id = useId();
  return (
    <div style={{ display: "grid", gap: T.space.xs }}>
      <label htmlFor={id} style={s.label}>Next review (required)</label>
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", alignItems: "center" }}>
        <input id={id} ref={inputRef} type="date" required min={today} value={value} onChange={(e) => onChange(e.target.value)}
               aria-invalid={invalid || undefined} aria-describedby={describedBy} data-testid="next-review" style={{ ...s.field, width: "auto", minWidth: "170px", flex: "1 1 170px" }}/>
        {NEXT_REVIEW_SHORTCUTS.map((n) => (
          <button key={n} type="button" style={s.chip} data-testid={`next-review-plus-${n}`} aria-label={`${n} days from today`}
                  aria-pressed={value === addDaysIso(today, n)} onClick={() => onChange(addDaysIso(today, n))}>+{n}</button>
        ))}
      </div>
    </div>
  );
}

/** Focus the first field when a form opens, and give focus back when it closes (the opener's job to name). */
function useFocusIn() {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

// ══════════════════════════════════════════════════════
//  Record an injury
// ══════════════════════════════════════════════════════

/**
 * `players` are the boys the Injuries screen's own read returned (name, team,
 * id). A boy with no side has left and cannot be recorded for; the server
 * would refuse him and the list does not offer him. `onSaved` is called after
 * the server has recorded it; `onCancel` closes the form.
 */
export function RecordInjuryForm({ players, onSaved, onCancel }) {
  const s = useStyles();
  const today = saToday();
  const first = useFocusIn();
  const [f, setF] = useState({ playerId: "", injuryType: "", severity: "", dateInjured: today, restricted: true,
                               rtwDate: "", nextReviewOn: "", emergencyServices: false, notes: "" });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [bad, setBad] = useState(/** @type {Record<string, boolean>} */ ({}));
  const refs = { playerId: useRef(null), injuryType: useRef(null), severity: useRef(null), nextReviewOn: useRef(null) };
  const set = (/** @type {string} */ k) => (/** @type {any} */ v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v }));
  const ids = { err: useId(), player: useId(), type: useId(), sev: useId(), dated: useId(), rtw: useId(), notes: useId() };
  const choices = players.filter((p) => p.team).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const submit = async (/** @type {{ preventDefault: () => void }} */ e) => {
    e.preventDefault();
    if (busy) return;
    // The server decides what is valid. This only stops a request that is
    // certain to be refused for want of a field, and puts focus on it.
    const miss = !f.playerId ? "playerId" : !f.injuryType.trim() ? "injuryType" : !f.severity ? "severity" : !f.nextReviewOn ? "nextReviewOn" : null;
    if (miss) {
      setBad({ [miss]: true });
      setSaid({ playerId: "Choose the boy.", injuryType: "Say what the injury is.", severity: "Choose how serious it is.",
                nextReviewOn: "Choose the date you will look at him next." }[miss]);
      /** @type {any} */ (refs[/** @type {keyof typeof refs} */ (miss)]).current?.focus();
      return;
    }
    setBusy(true); setSaid(""); setBad({});
    try {
      await api("/api/injuries", { method: "POST", body: {
        playerId: f.playerId, injuryType: f.injuryType.trim(), severity: f.severity, dateInjured: f.dateInjured || null,
        restricted: f.restricted, rtwDate: f.rtwDate || null, nextReviewOn: f.nextReviewOn,
        emergencyServices: f.emergencyServices, notes: f.notes.trim() || null } });
      onSaved("Injury recorded.");
    } catch (err) { setSaid(injurySay(/** @type {any} */ (err))); setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate style={s.card} data-testid="record-injury-form" aria-labelledby="record-injury-title">
      <h2 id="record-injury-title" style={s.h2}>Record an injury</h2>
      <p style={s.meta}>This is the school&apos;s record, not a medical file.</p>
      <label htmlFor={ids.player} style={s.label}>Who
        <select id={ids.player} ref={(el) => { refs.playerId.current = /** @type {any} */ (el); first.current = el; }} value={f.playerId} onChange={set("playerId")}
                aria-invalid={bad.playerId || undefined} aria-describedby={said ? ids.err : undefined} data-testid="record-player" style={s.field}>
          <option value="">Choose…</option>
          {choices.map((p) => <option key={p.id} value={p.id}>{p.name}{p.team ? ` · ${p.team}` : ""}</option>)}
        </select>
      </label>
      <label htmlFor={ids.type} style={s.label}>What is the injury
        <input id={ids.type} ref={refs.injuryType} value={f.injuryType} onChange={set("injuryType")} maxLength={200} autoComplete="off"
               aria-invalid={bad.injuryType || undefined} aria-describedby={said ? ids.err : undefined} data-testid="record-type" style={s.field}/>
      </label>
      <label htmlFor={ids.sev} style={s.label}>How serious
        <select id={ids.sev} ref={refs.severity} value={f.severity} onChange={set("severity")} aria-invalid={bad.severity || undefined}
                aria-describedby={said ? ids.err : undefined} data-testid="record-severity" style={s.field}>
          <option value="">Choose…</option>
          {Object.entries(SEVERITY_WORDS).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
        </select>
      </label>
      <label htmlFor={ids.dated} style={s.label}>Day injured
        <input id={ids.dated} type="date" max={today} value={f.dateInjured} onChange={set("dateInjured")} data-testid="record-date" style={s.field}/>
      </label>
      <label style={s.check}>
        <input type="checkbox" checked={f.restricted} onChange={set("restricted")} data-testid="record-restricted" style={s.box}/>
        Restricted: not available for selection
      </label>
      <label htmlFor={ids.rtw} style={s.label}>Expected back (optional)
        <input id={ids.rtw} type="date" min={f.dateInjured || undefined} value={f.rtwDate} onChange={set("rtwDate")} data-testid="record-rtw" style={s.field}/>
      </label>
      <NextReviewField value={f.nextReviewOn} onChange={set("nextReviewOn")} today={today} invalid={bad.nextReviewOn}
                       describedBy={said ? ids.err : undefined} inputRef={refs.nextReviewOn}/>
      <label style={s.check}>
        <input type="checkbox" checked={f.emergencyServices} onChange={set("emergencyServices")} data-testid="record-emergency" style={s.box}/>
        Emergency services were called
      </label>
      <p style={s.meta} data-testid="record-serious-note">
        A severe injury, or one where emergency services were called, tells the school&apos;s safeguarding officer that a serious injury has been recorded. The notice names nobody.
      </p>
      <label htmlFor={ids.notes} style={s.label}>Clinical notes (optional)
        <textarea id={ids.notes} value={f.notes} onChange={set("notes")} data-testid="record-notes" style={s.area}/>
      </label>
      {said && <p id={ids.err} role="alert" style={s.alert} data-testid="record-refused">{said}</p>}
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <button type="submit" style={s.primary} disabled={busy} data-testid="record-save">{busy ? "Saving…" : "Record injury"}</button>
        <button type="button" style={s.secondary} disabled={busy} onClick={onCancel} data-testid="record-cancel">Cancel</button>
      </div>
    </form>
  );
}

// ══════════════════════════════════════════════════════
//  Review an injury
// ══════════════════════════════════════════════════════

/**
 * A later look at one open injury. Every review states the whole state after
 * it (db/111): the phase, whether he is restricted, when he is expected back
 * and when she will look next. Clearing him ends the injury (a cleared injury
 * is never reopened; a new one is recorded), so it asks first, in words.
 */
export function ReviewForm({ injury, onSaved, onCancel }) {
  const s = useStyles();
  const today = saToday();
  const first = useFocusIn();
  const [f, setF] = useState({ phase: injury.phase && injury.phase !== "cleared" ? injury.phase : "active",
                               restricted: injury.restricted !== false, rtwDate: injury.rtw ?? "", nextReviewOn: "", note: "" });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [bad, setBad] = useState(false);
  const nextRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const ids = { err: useId(), phase: useId(), rtw: useId(), note: useId() };
  const clearing = f.phase === "cleared";
  const set = (/** @type {string} */ k) => (/** @type {any} */ v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v }));
  const pickPhase = (/** @type {{ target: { value: string } }} */ e) => {
    const phase = e.target.value;
    setAsking(false);
    // A cleared boy is not restricted and has no next review (db/111): the form
    // says so and does not offer what the function would refuse.
    setF((x) => ({ ...x, phase, restricted: phase === "cleared" ? false : x.restricted, nextReviewOn: phase === "cleared" ? "" : x.nextReviewOn }));
  };

  const send = async () => {
    setBusy(true); setSaid(""); setBad(false);
    try {
      await api(`/api/injuries/${injury.id}/reviews`, { method: "POST", body: {
        phaseAfter: f.phase, restrictedAfter: clearing ? false : f.restricted, rtwDateAfter: f.rtwDate || null,
        nextReviewOn: clearing ? null : f.nextReviewOn, note: f.note.trim() || null } });
      onSaved(clearing ? "Cleared to play." : "Review saved.");
    } catch (err) { setSaid(injurySay(/** @type {any} */ (err))); setBusy(false); setAsking(false); }
  };
  const submit = async (/** @type {{ preventDefault: () => void }} */ e) => {
    e.preventDefault();
    if (busy) return;
    if (!clearing && !f.nextReviewOn) {
      setBad(true); setSaid("Choose the date you will look at him next.");
      nextRef.current?.focus();
      return;
    }
    if (clearing && !asking) { setAsking(true); return; }
    await send();
  };

  return (
    <form onSubmit={submit} noValidate style={{ ...s.card, background: T.surface.base }} data-testid="review-form" aria-labelledby={`review-title-${injury.id}`}>
      <h3 id={`review-title-${injury.id}`} style={s.h3}>Review this injury</h3>
      <label htmlFor={ids.phase} style={s.label}>Where he is now
        <select id={ids.phase} ref={(el) => { first.current = el; }} value={f.phase} onChange={pickPhase} data-testid="review-phase" style={s.field}>
          {Object.entries(PHASE_WORDS).map(([v, w]) => <option key={v} value={v}>{w}</option>)}
        </select>
      </label>
      <label style={s.check}>
        <input type="checkbox" checked={clearing ? false : f.restricted} disabled={clearing} onChange={set("restricted")} data-testid="review-restricted" style={s.box}/>
        Restricted: not available for selection
      </label>
      <label htmlFor={ids.rtw} style={s.label}>Expected back
        <input id={ids.rtw} type="date" min={injury.dateInj} value={f.rtwDate} onChange={set("rtwDate")} data-testid="review-rtw" style={s.field}/>
      </label>
      {clearing
        ? <p style={s.small} data-testid="review-next-none">A cleared boy has no next review.</p>
        : <NextReviewField value={f.nextReviewOn} onChange={(v) => { setBad(false); setF((x) => ({ ...x, nextReviewOn: v })); }} today={today}
                           invalid={bad} describedBy={said ? ids.err : undefined} inputRef={nextRef}/>}
      <label htmlFor={ids.note} style={s.label}>Clinical note (optional)
        <textarea id={ids.note} value={f.note} onChange={set("note")} data-testid="review-note" style={s.area}/>
      </label>
      {asking && (
        <div style={s.confirm} role="group" aria-label="Clear him to play" data-testid="review-clear-confirm">
          <p style={s.small}>Clearing ends this injury. It cannot be reopened: if he is hurt again, a new injury is recorded. His coach is told he is cleared to play.</p>
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
            <button type="submit" style={s.primary} disabled={busy} data-testid="review-clear-yes">Clear him to play</button>
            <button type="button" style={s.secondary} disabled={busy} onClick={() => setAsking(false)}>Not yet</button>
          </div>
        </div>
      )}
      {said && <p id={ids.err} role="alert" style={s.alert} data-testid="review-refused">{said}</p>}
      {!asking && (
        <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
          <button type="submit" style={s.primary} disabled={busy} data-testid="review-save">{busy ? "Saving…" : clearing ? "Clear him to play…" : "Save review"}</button>
          <button type="button" style={s.secondary} disabled={busy} onClick={onCancel} data-testid="review-cancel">Cancel</button>
        </div>
      )}
    </form>
  );
}

// ══════════════════════════════════════════════════════
//  History
// ══════════════════════════════════════════════════════

/**
 * One injury's dated history, newest first, each row at the reader's tier.
 * `physio` is true for a medical.write holder: she alone sees her clock (the
 * next review date) and calls a look a review. `recordingNote` is the injury's
 * own note, shown on the recording (db/111 writes the first row without one),
 * where the reader's tier returned it.
 */
export function InjuryHistory({ injuryId, role, nonce = 0, physio = false, recordingNote = null, testid = "injury-history" }) {
  const s = useStyles();
  const read = useLive("injury_reviews", role, nonce, { injuryId });
  const said = readState(read, { what: "the history" });
  const answered = said.state === "ok" || said.state === "empty";
  // The server orders oldest first; people read newest first.
  const rows = [...read.rows].reverse();
  return (
    <div data-testid={testid} style={{ display: "grid", gap: T.space.sm }}>
      <h3 style={s.h3}>History</h3>
      {said.state === "loading" && <p role="status" style={s.small}>Reading the history…</p>}
      {(said.state === "failed" || said.state === "forbidden" || said.state === "disabled" || said.state === "partial") && (
        <p role="alert" style={s.alert}>{said.sentence}</p>
      )}
      {answered && rows.length === 0 && <p style={s.small}>Nothing is on record yet.</p>}
      {answered && rows.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.sm }}>
          {rows.map((r, i) => {
            const isFirst = i === rows.length - 1;
            const note = r.note ?? (isFirst ? recordingNote : null);
            const bits = [
              phaseWord(r.phase),
              r.restricted == null ? null : r.restricted ? "Restricted" : "Not restricted",
              r.rtw ? `back ${dayWord(r.rtw)}` : null,
              physio && r.nextReviewOn ? `next review ${dayWord(r.nextReviewOn)}` : null,
            ].filter(Boolean);
            return (
              <li key={r.id} data-testid="history-row" style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: T.space.md, display: "grid", gap: "2px" }}>
                <span style={{ ...s.body, fontWeight: 600 }}>
                  {dayWord(day10(r.at) ?? "")} · {physio && !isFirst ? "Review" : seenWord(isFirst)}
                </span>
                {bits.length > 0 && <span style={{ ...s.small }}>{bits.join(" · ")}</span>}
                {note && <span data-testid="history-note" style={{ ...s.body, fontSize: "14px" }}>{note}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
