import { useEffect, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { holdsCapability } from "../rbac/index.js";
import { Btn, Card } from "../ui/primitives.jsx";
import { DISMISSAL_LABEL } from "@scrbrd/scoring";

/**
 * The way out of quarantine, drawn. SCRBRD-003.
 *
 * `GET /api/matches/:id/quarantine` and `POST /api/quarantine/:id/resolve`
 * (db/14_quarantine_release.sql) have existed since before this panel did —
 * the door was built with no handle on it. A stale-epoch ball landed in
 * `ball_event_quarantine` and stayed there for ever unless somebody called the
 * API by hand.
 *
 * Offered only to whoever holds `scoring.amend.approve` — the same courtesy
 * every other screen in this file extends: it decides what to DRAW, never
 * what to allow. `quarantine_resolve()` checks its own authority per match,
 * against the row's own school and team, not against this role name.
 *
 * THE SERVER ANSWERS 200 EVEN ON A REFUSAL. `quarantine_resolve()` is a SQL
 * function that returns `{ ok, reason, seq }`, not an HTTP status — a scorer
 * without the capability, or the person who submitted the ball trying to
 * release their own, both get back a 200 with `ok: false`. A resolve() that
 * only checked `res.ok` on the promise, or assumed a 2xx meant the ball moved,
 * would show a released ball that was never released. See db/14's own
 * comment: "the person who decides must be able to see what they are
 * deciding" — and they must be told honestly when the decision was refused.
 */
const REFUSAL = {
  not_permitted: "You do not hold the approval capability for this match.",
  cannot_release_your_own: "You sent this ball yourself — somebody else has to decide it.",
  already_accepted: "Somebody already released this ball.",
  already_rejected: "Somebody already discarded this ball.",
  already_recorded: "That ball is already in the log by another road; nothing was written.",
  no_such_quarantine: "That row is gone.",
  row_required: "Could not rebuild the delivery — nothing was written.",
  dismissal_unknown: "The dismissal on this ball is not one of the recognised kinds.",
};

/** What was actually sitting in quarantine, for a decision made with eyes open. */
function describeBall(body) {
  const p = body?.payload ?? {};
  if ((p.kind ?? "ball") !== "ball") return p.kind ?? "event";
  switch (p.type) {
    case "W":  return `Wicket — ${DISMISSAL_LABEL[p.dismissal] ?? p.dismissal ?? "unspecified"}${p.fielder ? ` (${p.fielder})` : ""}`;
    case "Wd": return "Wide ball";
    case "Nb": return `No ball, ${p.value ?? 0} run${p.value === 1 ? "" : "s"}`;
    case "B":  return `Bye, ${p.value ?? 0} run${p.value === 1 ? "" : "s"}`;
    case "LB": return `Leg bye, ${p.value ?? 0} run${p.value === 1 ? "" : "s"}`;
    default:   return `${p.value ?? 0} run${p.value === 1 ? "" : "s"}`;
  }
}

const when = (ts) => (ts ? String(ts).slice(0, 16).replace("T", " ") : "—");

function QuarantinePanel({ matchId, role }) {
  const canApprove = holdsCapability(role, "scoring.amend.approve");
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ rows: [], loading: true, error: null });
  const [busy, setBusy] = useState(null);
  const [said, setSaid] = useState({});

  useEffect(() => {
    if (!canApprove || !matchId) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const { rows } = await api(`/api/matches/${matchId}/quarantine`);
        // The route already orders unresolved-first, but a row resolved by
        // somebody else between polls should not linger on this screen either.
        if (!cancelled) setState({ rows: (rows || []).filter((r) => !r.resolved_at), loading: false, error: null });
      } catch (e) {
        if (!cancelled) setState({ rows: [], loading: false, error: e.code || e.message || "unreachable" });
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, canApprove, nonce]);

  // A courtesy, not the gate. Rendering nothing here decides what to draw;
  // quarantine_resolve() and the table's own read policy decide what to allow.
  if (!canApprove) return null;
  if (state.loading || state.error) {
    return (
      <Card sx={{ padding: "14px", marginTop: "12px" }} data-testid="quarantine-panel">
        <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary, marginBottom: "6px" }}>
          Quarantined balls
        </div>
        <div style={{ fontFamily: D.body, fontSize: "11px", color: state.error ? textOn(D.rose) : D.textMuted }}>
          {state.loading ? "Loading…" : `Could not load quarantine (${state.error}).`}
        </div>
      </Card>
    );
  }

  const resolve = async (row, accept) => {
    setBusy(row.id);
    setSaid((s) => ({ ...s, [row.id]: null }));
    try {
      const res = await api(`/api/quarantine/${row.id}/resolve`, { method: "POST", body: { accept } });
      if (!res?.ok) {
        setSaid((s) => ({ ...s, [row.id]: REFUSAL[res?.reason] ?? res?.reason ?? "Refused." }));
      } else {
        setNonce((n) => n + 1);
      }
    } catch (e) {
      setSaid((s) => ({ ...s, [row.id]: REFUSAL[e.code] ?? e.message ?? "Refused." }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card sx={{ padding: "14px", marginTop: "12px" }} data-testid="quarantine-panel">
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px" }}>
        <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary }}>Quarantined balls</div>
        <div style={{ fontFamily: D.mono, fontSize: "9px", color: D.textMuted }} data-testid="quarantine-count">
          {state.rows.length} waiting
        </div>
      </div>
      {state.rows.length === 0 ? (
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>Nothing waiting for review.</div>
      ) : (
        state.rows.map((row) => (
          <div key={row.id} data-testid={`quarantine-${row.id}`}
               style={{ padding: "9px 0", borderTop: `1px solid ${D.border}` }}>
            <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, fontWeight: 600 }}>
              {describeBall(row.body)}
            </div>
            <div style={{ fontFamily: D.mono, fontSize: "10px", color: D.textMuted, marginTop: "2px" }}>
              Sent by {row.scorer_name || "unknown"} · epoch {row.submitted_epoch} (now {row.current_epoch ?? "—"}) · {when(row.quarantined_at)}
            </div>
            {said[row.id] && (
              <div role="alert" data-testid={`quarantine-${row.id}-refused`}
                   style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginTop: "5px" }}>
                {said[row.id]}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", marginTop: "7px" }}>
              <Btn size="sm" variant="success" disabled={busy === row.id}
                   onClick={() => resolve(row, true)} data-testid={`quarantine-${row.id}-release`}>
                Release
              </Btn>
              <Btn size="sm" variant="ghost" disabled={busy === row.id}
                   onClick={() => resolve(row, false)} data-testid={`quarantine-${row.id}-discard`}>
                Discard
              </Btn>
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

export { QuarantinePanel };
