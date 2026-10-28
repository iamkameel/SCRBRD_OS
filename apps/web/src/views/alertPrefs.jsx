/**
 * Settings → Me → "What reaches your phone" (NOTIFICATIONS D20, D21; slice S4).
 *
 * One switch per kind of alert this person actually receives and may switch
 * off, a parent's grouped by child; the kinds that are always on, said in
 * words; and, for a pupil, the quiet hours SCRBRD sets. Over
 * GET /api/read/my_notification_prefs (my_alert_choices(), db/120) and
 * POST /api/notifications/prefs.
 *
 * IT DECIDES NOTHING. Which switches appear is the server's answer from the
 * person's own assignments; whether a switch may be thrown is the table's own
 * policy (his rows, a child only his family's). And a switch governs the
 * phone only: Notices, the badge and the list of things to do show the same
 * whatever is switched off here, and the card says so.
 *
 * Floors: nothing read under 12px, every switch 44px tall.
 */
import { useState } from "react";
import { D, T, inkOn } from "../design/tokens.js";
import { useLive } from "../lib/live.js";
import { api } from "../lib/api.js";

/** What each switch is called: for all your notices, and for one child. */
export const ALERT_WORDS = Object.freeze({
  notice:       "Notices from the school and the side",
  recognition:  "Milestones and honours",
  fixture:      "Fixtures moved or cancelled",
  availability: "Questions about availability",
  lift:         "Lift seats",
});
export const ALWAYS_ON_WORDS = "Always on: safety and welfare notices.";
export const ALWAYS_ON_MORE = "Anything urgent, and notices about your own account, always reach your phone.";
export const PUSH_ONLY_WORDS = "Switching one off quiets your phone only. Every notice still appears in Notices, on the badge and in your list of things to do.";
export const QUIET_WORDS = "Between 21:00 and 06:00 your alerts wait until the morning; urgent ones still come through. SCRBRD sets these hours for every pupil.";

const text = (size = 13, color = D.textSecondary) => ({ fontFamily: D.body, fontSize: `${size}px`, lineHeight: 1.5, color, margin: 0 });

/** Why a switch did not move, in words. */
function refusal(/** @type {any} */ e) {
  if (e?.status === 403) return "That child isn't linked to your account, so alerts about that child can't be changed here.";
  if (e?.code === "kind_locked") return e.detail || ALWAYS_ON_WORDS;
  if (e?.status) return "That change was refused. Nothing has changed.";
  return "SCRBRD couldn't be reached. Nothing has changed; try again.";
}

/**
 * @param {{ row: { kind: string, subjectPlayerId: string | null, push: boolean }, busy: boolean, onFlip: () => void }} p
 */
function AlertSwitch({ row, busy, onFlip }) {
  const on = row.push;
  const id = `alert-${row.kind}-${row.subjectPlayerId ?? "all"}`;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
                  padding: "4px 0", borderTop: `1px solid ${T.line.normal}`, flexWrap: "wrap" }}>
      <span id={`${id}-label`} style={{ ...text(14, T.content.primary), flex: "1 1 12rem", minWidth: 0 }}>{ALERT_WORDS[row.kind] ?? row.kind}</span>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={`${id}-label`} disabled={busy}
        onClick={onFlip} className="pressBtn" data-testid={id}
        style={{ minHeight: "44px", minWidth: "72px", padding: "0 16px", borderRadius: D.pill, boxSizing: "border-box",
                 cursor: busy ? "progress" : "pointer", fontFamily: D.body, fontSize: "13px", fontWeight: 700,
                 border: `1px solid ${on ? T.content.primary : T.line.strong}`,
                 background: on ? T.content.primary : "transparent",
                 color: on ? inkOn(T.content.primary) : T.content.primary }}>
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

export function AlertPrefsSection({ role }) {
  const [nudge, setNudge] = useState(0);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const { rows, loading, error } = useLive("my_notification_prefs", role, nudge);

  const flip = async (/** @type {any} */ row) => {
    setBusy(true); setSaid("");
    try {
      await api("/api/notifications/prefs", { method: "POST",
        body: { kind: row.kind, subjectPlayerId: row.subjectPlayerId, push: !row.push } });
      setNudge((n) => n + 1);
    } catch (e) { setSaid(refusal(e)); }
    finally { setBusy(false); }
  };

  const all = rows.filter((r) => !r.subjectPlayerId);
  /** @type {Map<string, { name: string, rows: any[] }>} */
  const byChild = new Map();
  for (const r of rows.filter((x) => x.subjectPlayerId)) {
    if (!byChild.has(r.subjectPlayerId)) byChild.set(r.subjectPlayerId, { name: r.playerName || "Your child", rows: [] });
    byChild.get(r.subjectPlayerId)?.rows.push(r);
  }
  const quiet = rows.some((r) => r.quietHours);
  const groupHead = { fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: T.content.primary, margin: "14px 0 4px" };

  return (
    <section data-testid="alert-prefs" aria-labelledby="alert-prefs-title"
      style={{ background: D.surf1, border: `1px solid ${D.border}`, borderRadius: D.lg, padding: "16px" }}>
      <h3 id="alert-prefs-title" style={{ fontFamily: D.head, fontSize: "15px", fontWeight: 700, color: T.content.primary, margin: 0 }}>
        What reaches your phone
      </h3>
      <p style={{ ...text(), marginTop: "4px", maxWidth: "62ch" }} data-testid="alert-prefs-push-only">{PUSH_ONLY_WORDS}</p>

      {error ? <p role="alert" style={{ ...text(13, T.semantic.criticalText), marginTop: "12px" }}>Your alert settings couldn't be read just now. Nothing has changed.</p>
        : loading && rows.length === 0 ? null
        : rows.length === 0 ? <p style={{ ...text(), marginTop: "12px" }}>Nothing you receive can be switched off here.</p>
        : (
          <div style={{ marginTop: "8px" }}>
            {all.length > 0 && byChild.size > 0 && <h4 style={groupHead}>All your notices</h4>}
            {all.map((r) => <AlertSwitch key={`${r.kind}-all`} row={r} busy={busy} onFlip={() => flip(r)}/>)}
            {[...byChild.entries()].map(([id, g]) => (
              <div key={id} data-testid={`alert-prefs-child-${id}`}>
                <h4 style={groupHead}>{g.name}</h4>
                {g.rows.map((r) => <AlertSwitch key={`${r.kind}-${id}`} row={r} busy={busy} onFlip={() => flip(r)}/>)}
              </div>
            ))}
          </div>
        )}

      <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: `1px solid ${T.line.normal}` }}>
        <p style={text(13, T.content.primary)} data-testid="alert-prefs-always">{ALWAYS_ON_WORDS}</p>
        <p style={text()}>{ALWAYS_ON_MORE}</p>
        {quiet && <p style={{ ...text(), marginTop: "6px" }} data-testid="alert-prefs-quiet">{QUIET_WORDS}</p>}
      </div>
      {said && <p role="alert" data-testid="alert-prefs-refused" style={{ ...text(13, T.semantic.criticalText), marginTop: "10px" }}>{said}</p>}
    </section>
  );
}
