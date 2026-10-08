import { useEffect, useMemo, useState } from "react";
import { T } from "../../design/tokens.js";
import { api } from "../../lib/api.js";
import { clockWords } from "../../lib/corrections.js";
import { effectOf } from "../../lib/correctionEffect.js";
import { Modal } from "../../ui/primitives.jsx";
import { describeEvent } from "../quarantine.jsx";

/**
 * THE CORRECTIONS SHEET (GA-I36 A1, design D5, §5 "the approver", §7): inside
 * the fixture's Match Centre, staff only, the amendments and held balls on
 * this match in one place — each with the ball as recorded, the reason where
 * the policy shows it, what deciding it would do, and the buttons for the
 * person who may decide it.
 *
 * WHAT IT DRAWS IS A COURTESY. `GET /api/matches/:id/corrections` (N1) lists
 * the rows each table's own policy lets this reader see, and `canDecide`
 * there only decides whether a button is drawn: scoring_amendment_decide()
 * and quarantine_resolve() check the approval capability over the match, and
 * refuse the requester or the submitting scorer, whatever this screen says.
 * No Approve button is drawn on the reader's own request (§5: "approve your
 * own" is not a button).
 *
 * THE EFFECT IS FOLDED HERE, before anything is written: the log the Match
 * Centre already holds, with the void appended (or the held ball, at the end
 * of the log, where a release writes it), against the log as it stands
 * (lib/correctionEffect.js). After a decision the server's own result words
 * are read again and shown beside the ones read when the sheet opened.
 */

const REFUSED = {
  not_permitted: "You do not hold the approval for this match.",
  cannot_approve_your_own: "You asked for this correction yourself. Somebody else has to decide it.",
  cannot_release_your_own: "You sent this ball yourself. Somebody else has to decide it.",
  already_approved: "Somebody already approved this correction.",
  already_declined: "Somebody already declined this correction.",
  already_withdrawn: "The scorer withdrew this request.",
  no_such_live_delivery: "That delivery is no longer in the scorecard (it may already have been corrected). Decline the request.",
  no_such_amendment: "That request is gone.",
  already_accepted: "Somebody already released this ball.",
  already_rejected: "Somebody already discarded this ball.",
  already_superseded: "The scorer's device sent this ball again and it is already in the log.",
  already_recorded: "That ball is already in the log by another road; nothing was written.",
  idempotency_conflict: "A different ball is already in the log under this ball's id. Nothing was written: discard this one.",
};

/** A refusal in words: the Laws' own, or the table above. @param {any} res */
export function refusalWords(res) {
  if (res?.reason === "laws_refused") return `The Laws refuse this: ${res.text ?? res.law}. Nothing was written, and it is still waiting.`;
  if (res?.reason === "value_refused") return `The record cannot hold this ball: ${res.text ?? res.value}. Nothing was written. Discard it.`;
  return REFUSED[res?.reason] ?? `Refused (${res?.reason ?? "unknown"}). Nothing was written.`;
}

/** "18:12", "18:12, 11 Oct" @param {string | null | undefined} ts */
const at = (ts) => (ts ? clockWords(Date.parse(ts)) : "");

const btn = (tone = "plain") => ({
  minHeight: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer",
  fontFamily: T.type.body, fontSize: "14px", fontWeight: 600,
  border: `1px solid ${tone === "go" ? T.brand.green : T.line.normal}`,
  background: tone === "go" ? T.brand.green : "transparent",
  color: tone === "go" ? T.surface.canvas : T.content.primary,
});
// A function, not a constant: a token read at import time would not follow a theme switch.
const small = () => ({ ...T.role.body, fontSize: "13px", margin: 0 });

/**
 * The count a staff reader sees on the fixture, or null for nothing to say:
 * "1 correction awaiting approval", "1 held ball awaiting a decision", and,
 * for the scorer, his own declined requests.
 * @param {{amendments?: any[], held?: any[]} | null} list
 */
export function pendingWords(list) {
  if (!list) return null;
  const n = (list.amendments ?? []).filter((a) => a.state === "pending").length;
  const h = (list.held ?? []).length;
  const d = (list.amendments ?? []).filter((a) => a.mine && a.state === "declined").length;
  const parts = [
    n ? `${n} ${n === 1 ? "correction" : "corrections"} awaiting approval` : null,
    h ? `${h} held ${h === 1 ? "ball" : "balls"} awaiting a decision` : null,
    d ? `${d} of your ${d === 1 ? "requests was" : "requests were"} declined` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * @param {{match: any, events: any[], fold: any, commentary: any[], list: {amendments: any[], held: any[]} | null,
 *           onClose: () => void, onDecided: () => void}} p
 */
export function CorrectionsSheet({ match, events, fold, commentary, list, onClose, onDecided }) {
  const [serverBefore, setServerBefore] = useState(/** @type {string | null} */ (null));
  const [said, setSaid] = useState(/** @type {Record<string, {ok: boolean, text: string}>} */ ({}));
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));
  const [notes, setNotes] = useState(/** @type {Record<string, string>} */ ({}));

  useEffect(() => {
    let cancelled = false;
    api(`/api/matches/${match.id}/result`).then((d) => { if (!cancelled) setServerBefore(d?.result?.text ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [match.id]);

  const lineOf = useMemo(() => new Map(commentary.filter((c) => /^e:[^#]+$/.test(c.key)).map((c) => [c.key.slice(2), c])), [commentary]);
  const amendments = list?.amendments ?? [];
  const pending = amendments.filter((a) => a.state === "pending");
  const decided = amendments.filter((a) => a.state !== "pending");
  const held = list?.held ?? [];

  const after = async (key, res, okText) => {
    if (res?.ok) {
      let now = null;
      try { now = (await api(`/api/matches/${match.id}/result`))?.result?.text ?? null; } catch { /* said below as unknown */ }
      setSaid((s) => ({ ...s, [key]: { ok: true, text: `${okText} Result as the server reads it: ${serverBefore ?? "none yet"} → ${now ?? "none yet"}.` } }));
      // The next decision's "before" is this one's "after".
      setServerBefore(now);
      onDecided();
    } else {
      setSaid((s) => ({ ...s, [key]: { ok: false, text: refusalWords(res) } }));
    }
  };
  const decide = async (a, approve) => {
    setBusy(a.id); setSaid((s) => ({ ...s, [a.id]: null }));
    try {
      const res = await api(`/api/amendments/${a.id}/decide`, { method: "POST", body: { approve, note: notes[a.id]?.trim() || null } });
      if (approve) await after(a.id, res, "Approved: the ball is removed.");
      else if (res?.ok) { setSaid((s) => ({ ...s, [a.id]: { ok: true, text: "Declined. Nothing in the scorecard changed." } })); onDecided(); }
      else setSaid((s) => ({ ...s, [a.id]: { ok: false, text: refusalWords(res) } }));
    } catch (e) {
      setSaid((s) => ({ ...s, [a.id]: { ok: false, text: REFUSED[e.code] ?? e.message ?? "Could not reach the server. Nothing was decided." } }));
    } finally { setBusy(null); }
  };
  const resolve = async (h, accept) => {
    const key = `h${h.id}`;
    setBusy(key); setSaid((s) => ({ ...s, [key]: null }));
    try {
      const res = await api(`/api/quarantine/${h.id}/resolve`, { method: "POST", body: { accept, note: notes[key]?.trim() || null } });
      if (accept) await after(key, res, "Released: the ball is written at the end of the log.");
      else if (res?.ok) { setSaid((s) => ({ ...s, [key]: { ok: true, text: "Discarded. Nothing in the scorecard changed." } })); onDecided(); }
      else setSaid((s) => ({ ...s, [key]: { ok: false, text: refusalWords(res) } }));
    } catch (e) {
      setSaid((s) => ({ ...s, [key]: { ok: false, text: REFUSED[e.code] ?? e.message ?? "Could not reach the server. Nothing was decided." } }));
    } finally { setBusy(null); }
  };

  // Plain render functions, not components: a component defined in here
  // would be a new type each render, and the note field would lose its focus
  // on every keystroke.
  const saidLine = (/** @type {string} */ k) => said[k] ? (
    <p role="alert" data-testid={`corr-said-${k}`} style={{ ...small(), color: said[k].ok ? T.semantic.positive : (T.semantic.criticalText ?? T.semantic.critical) }}>{said[k].text}</p>
  ) : null;
  const noteField = (/** @type {string} */ k) => (
    <label style={{ display: "grid", gap: "2px", ...small(), color: T.content.secondary }}>
      A note for the record (optional)
      <textarea data-testid={`corr-note-${k}`} value={notes[k] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))}
        style={{ minHeight: "44px", padding: T.space.sm, borderRadius: T.radius.md, border: `1px solid ${T.line.normal}`,
          background: T.surface.raised, color: T.content.primary, fontFamily: T.type.body, fontSize: "16px", resize: "vertical" }}/>
    </label>
  );
  // Each row's effect, folded once per log and list, not once per keystroke.
  const effects = useMemo(() => {
    /** @type {Map<string, string[]>} */
    const m = new Map();
    for (const a of pending) {
      const line = lineOf.get(a.targetKey);
      if (line) m.set(a.id, effectOf({ match, events, fold, change: { kind: "void", target: a.targetKey, innings: line.innings } }).words);
    }
    for (const h of held) if (h.event) m.set(`h${h.id}`, effectOf({ match, events, fold, change: { kind: "release", event: h.event } }).words);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, fold, list, lineOf]);
  const effectList = (/** @type {string} */ k) => effects.has(k) ? (
    <ul data-testid={`corr-effect-${k}`} style={{ ...small(), color: T.content.primary, paddingLeft: T.space.lg, display: "grid", gap: "2px" }}>
      {/** @type {string[]} */ (effects.get(k)).map((w) => <li key={w}>{w}</li>)}
    </ul>
  ) : null;
  const row = { display: "grid", gap: T.space.sm, padding: `${T.space.md} 0`, borderTop: `1px solid ${T.line.subtle}` };
  const h2 = { ...T.role.label, color: T.content.secondary, margin: `${T.space.md} 0 0` };

  return (
    <Modal title="Corrections" onClose={onClose} width="600px">
      <div data-testid="corrections-sheet" style={{ display: "grid", gap: T.space.xs }}>
        {!list ? <p style={{ ...small(), color: T.content.secondary }}>Loading…</p>
          : !pending.length && !held.length && !decided.length
            ? <p data-testid="corr-none" style={{ ...small(), color: T.content.secondary }}>Nothing waiting on this match.</p> : null}

        {pending.length > 0 && <h3 style={h2}>Awaiting approval</h3>}
        {pending.map((a) => {
          const line = lineOf.get(a.targetKey);
          return (
            <section key={a.id} data-testid={`corr-amend-${a.id}`} style={row}>
              <p style={{ ...small(), fontWeight: 600, color: T.content.primary }}>
                {line ? `${line.over}.${line.ball} · ${line.text}` : "A delivery not in the scorecard as it stands"}
              </p>
              <p style={{ ...small(), color: T.content.secondary }}>
                Asked by the scorer{a.requesterName ? ` (${a.requesterName})` : ""} · {at(a.requestedAt)}
              </p>
              {a.reason && <p data-testid={`corr-reason-${a.id}`} style={{ ...small(), color: T.content.primary, borderLeft: `3px solid ${T.line.normal}`, paddingLeft: T.space.sm }}>{a.reason}</p>}
              <p style={{ ...small(), color: T.content.secondary }}>Approving removes this ball; nothing replaces it.</p>
              {effectList(a.id)}
              {a.mine && (
                <p data-testid={`corr-mine-${a.id}`} style={{ ...small(), color: T.content.secondary }}>
                  Your request is with the director of sport · asked {at(a.requestedAt)} · this does not change the score until it is approved.
                </p>
              )}
              {!a.mine && !a.canDecide && <p style={{ ...small(), color: T.content.secondary }}>Waiting for the director of sport.</p>}
              {a.canDecide && !said[a.id]?.ok && (
                <>
                  {noteField(a.id)}
                  <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
                    <button type="button" data-testid={`corr-approve-${a.id}`} disabled={busy === a.id} onClick={() => decide(a, true)} className="pressBtn os-state" style={btn("go")}>Approve</button>
                    <button type="button" data-testid={`corr-decline-${a.id}`} disabled={busy === a.id} onClick={() => decide(a, false)} className="pressBtn os-state" style={btn()}>Decline</button>
                  </div>
                </>
              )}
              {saidLine(a.id)}
            </section>
          );
        })}

        {held.length > 0 && <h3 style={h2}>Held balls</h3>}
        {held.map((h) => {
          const key = `h${h.id}`;
          return (
            <section key={key} data-testid={`corr-held-${h.id}`} style={row}>
              <p style={{ ...small(), fontWeight: 600, color: T.content.primary }}>{describeEvent(h.event)}</p>
              <p style={{ ...small(), color: T.content.secondary }}>
                Held {at(h.heldAt)} · sent from a device one handover behind (epoch {h.submittedEpoch}, now {h.currentEpoch ?? "—"})
              </p>
              <p style={{ ...small(), color: T.content.secondary }}>A released ball is written at the end of the log, not where it was bowled.</p>
              {effectList(key)}
              {h.mine && <p style={{ ...small(), color: T.content.secondary }}>You sent this ball; somebody else decides it.</p>}
              {h.canDecide && !said[key]?.ok && (
                <>
                  {noteField(key)}
                  <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
                    <button type="button" data-testid={`corr-release-${h.id}`} disabled={busy === key} onClick={() => resolve(h, true)} className="pressBtn os-state" style={btn("go")}>Release</button>
                    <button type="button" data-testid={`corr-discard-${h.id}`} disabled={busy === key} onClick={() => resolve(h, false)} className="pressBtn os-state" style={btn()}>Discard</button>
                  </div>
                </>
              )}
              {saidLine(key)}
            </section>
          );
        })}

        {/* A held ball once decided leaves the list; what was said about it stays. */}
        {Object.keys(said).filter((k) => k.startsWith("h") && !held.some((h) => `h${h.id}` === k)).map((k) => <div key={k}>{saidLine(k)}</div>)}

        {decided.length > 0 && <h3 style={h2}>Decided</h3>}
        {decided.map((a) => (
          <section key={a.id} data-testid={`corr-decided-${a.id}`} style={row}>
            <p style={{ ...small(), color: T.content.primary }}>
              {a.state === "approved" ? `Approved ${at(a.decidedAt)} · the ball was removed`
                : a.state === "declined" ? `Declined ${at(a.decidedAt)}${a.decidedNote ? `: ${a.decidedNote}` : ""}`
                : `Withdrawn by the scorer`}
            </p>
            <p style={{ ...small(), color: T.content.secondary }}>Asked by the scorer · {at(a.requestedAt)}</p>
            {a.reason && <p style={{ ...small(), color: T.content.secondary }}>{a.reason}</p>}
            {saidLine(a.id)}
          </section>
        ))}
      </div>
    </Modal>
  );
}
