/**
 * The Skills screen's history (GA-I26a §4, A3): the strip under each
 * attribute bar, the sheet a dot opens, "Set target", and "Since the last
 * look". Markup only: every figure, date and word is decided in
 * lib/assessmentHistory.js, which apps/web/test/skillsHistory.test.mjs holds.
 *
 * What these never draw (§4.4): a direction as a word, a rank, a composite, a
 * comparison, any load or health inference, an absence as a figure, a share
 * or export. A score is its figure, its date and its author, in one grey; only
 * the newest carries the bar's colour.
 *
 * Who sees what is the server's: this draws the rows it was sent. The one
 * choice it makes is words ("R Pillay, coach" to staff, "your coach" to the
 * boy), and the "Why" field exists only for a reader who may write one.
 */
import { useState } from "react";
import { D, T } from "../../design/tokens.js";
import { Card, Modal } from "../../ui/primitives.jsx";
import { useLive } from "../../lib/live.js";
import { drillCategoriesFor } from "@scrbrd/scoring";
import {
  CELL, STRIP_HEIGHT, yOf, stripLayout, stripSummary, dotWords, byWords, shortDate, metricWords,
  targetWords, targetProblem, orderDrills, sinceWords, lastLookBy,
} from "../../lib/assessmentHistory.js";
import {
  setTarget, withdrawTarget, withdrawScore, withdrawNote, writeCoachingPoint, writeWords, REASON_MAX, WHY_MAX,
} from "../../lib/development.js";

/** A tap target that meets the floor: 44px each way, 12px type. */
const tap = (extra = {}) => ({
  minHeight: "44px", minWidth: "44px", padding: "0 14px", borderRadius: D.pill, cursor: "pointer",
  border: `1px solid ${D.border}`, background: "transparent", color: D.textSecondary,
  fontFamily: D.body, fontSize: "12px", ...extra,
});
/* Functions, not constants: a token is read when it is drawn, so a theme change reaches it. */
const fieldStyle = () => ({
  width: "100%", minHeight: "44px", padding: "8px 10px", borderRadius: D.md, background: D.surf2,
  border: `1px solid ${D.border}`, color: D.textPrimary, fontFamily: D.body, fontSize: "14px",
});
const labelStyle = () => ({ display: "block", fontFamily: D.body, fontSize: "12px", color: D.textMuted, margin: "12px 0 4px", lineHeight: 1.4 });

/**
 * One attribute's score history. Dots sit one cell apart (44px, so a hit area
 * never covers its neighbour's), oldest to newest, the 1-20 axis running up
 * the left; a long history scrolls sideways rather than crowding. The newest
 * standing dot carries the bar's colour, the rest are grey, and a withdrawn
 * score is a hollow dot with a strike through it.
 */
export function Strip({ points, staff, color, label, target, onOpen }) {
  const g = stripLayout(points);
  return (
    <div data-testid="history-strip" role="group"
      aria-label={`${label} history. ${stripSummary(points)} Each dot opens its details.`}
      style={{ display: "flex", marginTop: "6px" }}>
      <div aria-hidden="true" style={{ width: "24px", position: "relative", height: `${STRIP_HEIGHT}px`, flexShrink: 0 }}>
        <span style={{ position: "absolute", top: `${yOf(20) - 8}px`, fontFamily: D.mono, fontSize: "12px", color: D.textMuted }}>20</span>
        <span style={{ position: "absolute", top: `${yOf(1) - 8}px`, fontFamily: D.mono, fontSize: "12px", color: D.textMuted }}>1</span>
      </div>
      <div style={{ overflowX: "auto", flex: 1, minWidth: 0 }} tabIndex={-1}>
        <div style={{ position: "relative", width: `${g.width}px`, height: `${g.height}px` }}>
          <svg width={g.width} height={g.height} aria-hidden="true" focusable="false"
            style={{ position: "absolute", left: 0, top: 0 }}>
            {target?.target != null && !target.withdrawn && (
              <line data-testid="target-tick" x1="0" x2={g.width} y1={yOf(target.target)} y2={yOf(target.target)}
                stroke={D.violet} strokeWidth="1.5" strokeDasharray="5 4"/>
            )}
            {g.line.includes(" ") && (
              <polyline className="os-hair" data-testid="hairline" points={g.line} fill="none" pathLength="1"
                stroke={D.textMuted} strokeWidth="1"/>
            )}
          </svg>
          {g.dots.map((d) => {
            const newest = d.id === g.newestId;
            const dotColor = newest ? color : D.textMuted;
            return (
              <button key={d.id} type="button" data-testid={`history-dot-${d.id}`} data-withdrawn={d.withdrawn ? "1" : "0"}
                aria-label={dotWords(d, staff)} onClick={() => onOpen(d)} className="pressBtn"
                style={{ position: "absolute", left: `${d.x - CELL / 2}px`, top: `${d.y - CELL / 2}px`, width: `${CELL}px`, height: `${CELL}px`,
                         background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span aria-hidden="true" style={{
                  display: "block", width: "16px", height: "16px", borderRadius: "50%", boxSizing: "border-box",
                  background: d.withdrawn
                    ? `linear-gradient(to top right, transparent 44%, ${D.textMuted} 44% 56%, transparent 56%)`
                    : dotColor,
                  border: d.withdrawn ? `2px solid ${D.textMuted}` : "none",
                }}/>
              </button>
            );
          })}
        </div>
        <div aria-hidden="true" style={{ display: "flex", width: `${g.width}px` }}>
          {g.dots.map((d) => (
            <span key={d.id} style={{ width: `${CELL}px`, textAlign: "center", fontFamily: D.mono, fontSize: "12px", color: D.textMuted,
                                      textDecoration: d.withdrawn ? "line-through" : "none" }}>{shortDate(d.assessedOn)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The target, said under the strip: "target 12 · by 30 Nov · set 14 Sep", and "reached 11 Oct" once the server says so. */
export function TargetLine({ target }) {
  const w = targetWords(target);
  return (
    <div data-testid="target-line" style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, margin: "4px 0 0", lineHeight: 1.5 }}>
      <span style={{ textDecoration: w.reached ? "line-through" : "none" }}>{w.text}</span>
      {w.note && <span data-testid="target-note" style={{ color: D.textMuted }}>{" · "}{w.note}</span>}
    </div>
  );
}

/**
 * What a dot opens: the score, the date, who gave it, and, for a reader who
 * may read them, the coaching points that stood on this row. A coach may take
 * a score back here, with a reason; the row stays, struck.
 */
export function DotSheet({ point, staff, canWrite, points, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const stood = (points ?? []).filter((p) => p.skillId === point.id);
  return (
    <Modal title={`${metricWords(point.metric)} · ${point.score} on ${shortDate(point.assessedOn)}`} width="460px" onClose={onClose}>
      <div data-testid="dot-sheet">
        <div style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary, lineHeight: 1.5 }}>
          Rated {point.score} on {shortDate(point.assessedOn)} by {byWords(point.by, staff)}.
        </div>
        {point.withdrawn && (
          <div data-testid="dot-withdrawn" style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "8px", lineHeight: 1.5 }}>
            Withdrawn{point.withdrawnBy ? ` by ${staff ? point.withdrawnBy : "your coach"}` : ""}{point.reason ? `: ${point.reason}` : ""}. It no longer counts toward where {staff ? "he stands" : "you stand"}.
          </div>
        )}
        {staff && stood.length > 0 && (
          <div style={{ marginTop: "14px" }}>
            <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.06em", marginBottom: "6px" }}>
              COACHING POINTS ON THIS SCORE · STAFF ONLY
            </div>
            {stood.map((p) => (
              <div key={p.id} style={{ borderLeft: `2px solid ${D.border}`, paddingLeft: "10px", marginBottom: "8px", opacity: p.withdrawn ? 0.6 : 1 }}>
                <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.5, textDecoration: p.withdrawn ? "line-through" : "none" }}>{p.body}</div>
                <div style={{ fontFamily: D.mono, fontSize: "12px", color: D.textMuted }}>{p.author || "—"} · {shortDate(p.observedOn)}{p.withdrawn ? " · withdrawn" : ""}</div>
              </div>
            ))}
          </div>
        )}
        {canWrite && !point.withdrawn && (
          <div style={{ marginTop: "16px", borderTop: `1px solid ${D.border}`, paddingTop: "4px" }}>
            <label htmlFor="withdraw-reason" style={labelStyle()}>Rated the wrong boy, or in error? Take this score back. Say why.</label>
            <input id="withdraw-reason" data-testid="withdraw-reason" value={reason} maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)} style={fieldStyle()}/>
            {said && <div role="alert" style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText, marginTop: "8px" }}>{said}</div>}
            <button type="button" data-testid="withdraw-score" disabled={busy || !reason.trim()} style={tap({ marginTop: "10px", opacity: busy || !reason.trim() ? 0.5 : 1 })}
              onClick={async () => {
                setBusy(true); setSaid("");
                try { await withdrawScore(point.id, reason); onDone(); }
                catch (e) { setSaid(writeWords(e)); }
                finally { setBusy(false); }
              }}>{busy ? "Saving…" : "Withdraw this score"}</button>
          </div>
        )}
        <div style={{ marginTop: "14px" }}>
          <button type="button" onClick={onClose} style={tap()}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * "Set target" for one attribute (§4.3): a number above where he stands, an
 * optional date, a drill (those that suit the attribute first, every library
 * drill below), and one line of why, labelled for what it is: staff-only
 * prose that becomes a coaching point and does not reach the boy. The same
 * form writes to two tiers, and the label says which words land where.
 *
 * The "why" is written first, as a coaching point standing on his newest
 * standing score; the target then points at it. If the target is refused the
 * point is taken back, so a refusal leaves nothing behind.
 */
export function TargetModal({ role, playerId, category, metric, stood, current, onClose, onDone }) {
  const label = metricWords(metric);
  const stands = stood?.score ?? null;
  const [score, setScore] = useState(current ? String(current.target) : stands != null ? String(Math.min(20, stands + 1)) : "");
  const [due, setDue] = useState(current?.dueOn ?? "");
  const [drillId, setDrillId] = useState(current?.drillId ?? "");
  const [why, setWhy] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const { rows: library, live } = useLive("drills", role);
  const { suit, rest } = orderDrills(live ? library : [], drillCategoriesFor(category, metric));
  const problem = targetProblem(score, stands);
  const canWhy = !!stood?.id;
  const option = (d) => <option key={d.id} value={d.id}>{d.name} · {d.duration} min</option>;
  const save = async () => {
    setBusy(true); setSaid("");
    let noteId;
    try {
      if (why.trim()) noteId = (await writeCoachingPoint(playerId, { body: why, skillId: stood.id })).id;
      await setTarget(playerId, { category, metric, targetScore: score, dueOn: due, drillId, noteId });
      onDone();
    } catch (e) {
      // A refused target leaves no orphan reason on his record.
      if (noteId) await withdrawNote(noteId).catch(() => {});
      setSaid(writeWords(e));
    } finally { setBusy(false); }
  };
  const take = async () => {
    setBusy(true); setSaid("");
    try { await withdrawTarget(current.id, reason); onDone(); }
    catch (e) { setSaid(writeWords(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`${current ? "Change target" : "Set target"} · ${label}`} width="480px" onClose={onClose}>
      <div data-testid="target-form">
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, lineHeight: 1.5 }}>
          {stands != null ? `He stands at ${stands}${stood.assessedOn ? `, rated ${shortDate(stood.assessedOn)}` : ""}.` : "He has not been rated on this yet."}
          {current && " Saving replaces the target he has now; the old one stays on record."}
        </div>
        <label htmlFor="target-score" style={labelStyle()}>Target, 2 to 20</label>
        <input id="target-score" data-testid="target-score" type="number" inputMode="numeric" min={2} max={20} step={1} value={score}
          onChange={(e) => setScore(e.target.value)} aria-describedby="target-problem" style={fieldStyle()}/>
        <div id="target-problem" data-testid="target-problem" role="status" style={{ fontFamily: D.body, fontSize: "12px", color: problem ? D.roseText : D.textMuted, marginTop: "4px", minHeight: "16px" }}>
          {problem ?? ""}
        </div>
        <label htmlFor="target-due" style={labelStyle()}>By when (optional)</label>
        <input id="target-due" data-testid="target-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={fieldStyle()}/>
        <label htmlFor="target-drill" style={labelStyle()}>The drill for it (optional)</label>
        <select id="target-drill" data-testid="target-drill" value={drillId} onChange={(e) => setDrillId(e.target.value)} style={fieldStyle()}>
          <option value="">No drill, just watch it</option>
          {suit.length > 0 && <optgroup label={`Suits ${label}`}>{suit.map(option)}</optgroup>}
          {rest.length > 0 && <optgroup label={suit.length ? "Every other drill" : "The library"}>{rest.map(option)}</optgroup>}
        </select>
        <label htmlFor="target-why" style={labelStyle()}>Why — staff only; the boy sees the target, not this</label>
        <input id="target-why" data-testid="target-why" value={why} maxLength={WHY_MAX} disabled={!canWhy}
          onChange={(e) => setWhy(e.target.value)} style={{ ...fieldStyle(), opacity: canWhy ? 1 : 0.5 }}/>
        {!canWhy && <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "4px" }}>A reason stands on a score, and his history is not in yet.</div>}
        {said && <div role="alert" data-testid="target-said" style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText, marginTop: "10px", lineHeight: 1.5 }}>{said}</div>}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "16px" }}>
          <button type="button" data-testid="target-save" disabled={busy || !!problem} onClick={save}
            style={tap({ background: D.gradMain, color: T.light.ink, border: "1px solid transparent", fontWeight: 700, opacity: busy || problem ? 0.5 : 1 })}>
            {busy ? "Saving…" : "Save target"}
          </button>
          <button type="button" onClick={onClose} style={tap()}>Cancel</button>
        </div>
        {current && (
          <div style={{ marginTop: "16px", borderTop: `1px solid ${D.border}`, paddingTop: "4px" }}>
            <label htmlFor="target-withdraw-reason" style={labelStyle()}>Or take the target back. Say why.</label>
            <input id="target-withdraw-reason" data-testid="target-withdraw-reason" value={reason} maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)} style={fieldStyle()}/>
            <button type="button" data-testid="target-withdraw" disabled={busy || !reason.trim()} onClick={take}
              style={tap({ marginTop: "10px", opacity: busy || !reason.trim() ? 0.5 : 1 })}>Withdraw target</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * "Since the last look" (§4.2): a block per discipline, in the design's words.
 * It says what he attended, what the side ran, and the target as it stands;
 * it never says what he did not attend. Every block names its source and its
 * window in the footer. A read that did not answer is said by the caller, not
 * drawn as a quiet panel here.
 */
export function SincePanel({ rows, history, player, staff, self }) {
  if (!rows.length) return null;
  return (
    <Card sx={{ padding: "16px", marginBottom: "14px" }} data-testid="since-panel">
      <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", marginBottom: "12px" }}>SINCE THE LAST LOOK</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "14px" }}>
        {rows.map((r) => {
          const w = sinceWords(r, {
            name: player.name, team: player.team, self,
            author: r.anchor ? byWords(lastLookBy(history, r.discipline), staff) : null,
          });
          return (
            <div key={r.discipline} data-testid={`since-${r.discipline}`} style={{ border: `1px solid ${D.border}`, borderRadius: D.md, padding: "12px" }}>
              <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary, marginBottom: "6px" }}>{w.title}</div>
              {w.lines.map((l, i) => (
                <div key={i} style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.5, marginBottom: "4px" }}>{l}</div>
              ))}
              {w.footer && <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "6px", lineHeight: 1.4 }}>{w.footer}</div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

