import { useState } from "react";
import { T } from "../../design/tokens.js";
import { api } from "../../lib/api.js";
import { humanDateTime } from "../../lib/format.js";
import { clockWords } from "../../lib/corrections.js";
import { holdsCapability } from "../../rbac/index.js";
import { deliveryOptions, nextFixtureOf } from "../../lib/matchCentre.js";
import { Icon } from "../../ui/icons.jsx";
import { CardHead, Panel, Quiet, SideName } from "./bits.jsx";

/**
 * The empty states and full-time screens SCRBRD-100 asks for, that are not
 * one of the six tabs: before the toss, an interrupted innings, the onward
 * links once a match is decided, and the confirm-or-correct prompt. Kept out
 * of tabs.jsx because every one of these sits ABOVE the tabs — they are true
 * of the fixture, not of one tab of it — and out of MatchView.jsx because
 * that file draws the shell, not the words.
 */

import { PreTossCard, RevisionBanner } from "./banners.jsx";
export { PreTossCard, RevisionBanner };

// ── 4. The full-time screen links onward (item 4) ──

// Functions, not constants: a token read at import time would never follow a
// theme switch (design.test).
const linkStyle = () => ({
  minHeight: "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
  cursor: "pointer", background: "transparent", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill,
  color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 500,
});

/**
 * Next fixture and results, for both sides — the onward links a full-time
 * screen owes a reader (SCRBRD-100 item 4). Each player's own season is
 * already one tap away, from the Scorecard tab's opening row and the "Best
 * performances" cards on the post-match report — both already call
 * `onNavProfile`, so it is not repeated here.
 *
 * "The team's results" opens the Match Centre list already filtered to that
 * side (`onTeamResults`) rather than a screen this product does not have.
 * A side that is not a SCRBRD tenant (an opponent typed in free text) has
 * neither a next fixture nor a results screen to open, and shows neither link
 * — never a link that leads to "not you" (per the task's own rule).
 */
export function OnwardLinks({ match, sides, matches, onOpenFixture, onTeamResults }) {
  const today = new Date().toISOString().slice(0, 10);
  const homeNext = nextFixtureOf(matches ?? [], { label: sides.home.full, excludeId: match.id, today });
  const awayNext = nextFixtureOf(matches ?? [], { label: sides.away.full, excludeId: match.id, today });
  const homeIsTenant = sides.home.full === match?.homeLabel;
  const awayIsTenant = sides.away.full === match?.awayLabel;
  const anyLink = homeNext || awayNext || (homeIsTenant && onTeamResults) || (awayIsTenant && onTeamResults);
  if (!anyLink) return null;
  return (
    <Panel testid="mc-onward">
      <CardHead icon="arrow-up-right">Onward</CardHead>
      <div style={{ padding: T.space.md, display: "grid", gap: T.space.sm }}>
        {[["home", sides.home, homeNext, homeIsTenant], ["away", sides.away, awayNext, awayIsTenant]].map(([key, side, next, tenant]) => (
          (next || (tenant && onTeamResults)) && (
            <div key={key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: T.space.sm }}>
              <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, minWidth: 0 }}><SideName side={side}/></span>
              {next && onOpenFixture && (
                <button type="button" data-testid={`mc-onward-next-${key}`} onClick={() => onOpenFixture(next)} className="pressBtn os-state" style={linkStyle()}>
                  <Icon name="calendar"/> Next: {next.date ? humanDateTime(next.date, next.time ?? null) : "TBC"}
                </button>
              )}
              {tenant && onTeamResults && (
                <button type="button" data-testid={`mc-onward-results-${key}`} onClick={() => onTeamResults(side.full)} className="pressBtn os-state" style={linkStyle()}>
                  <Icon name="scorebook"/> Results
                </button>
              )}
            </div>
          )
        ))}
      </div>
    </Panel>
  );
}

// ── 5. Coaches and scorers confirm or correct the scorecard (item 5) ──

const confirmKey = (matchId) => `scrbrd:mc-confirm-seen:${matchId}`;
const isDismissed = (matchId) => { try { return localStorage.getItem(confirmKey(matchId)) === "1"; } catch { return false; } };
const dismiss = (matchId) => { try { localStorage.setItem(confirmKey(matchId), "1"); } catch { /* private window or storage blocked:
  the prompt simply shows again next time, which is the safe side to fail on — never worse than a repeated question. */ } };

const fieldStyle = () => ({
  width: "100%", minHeight: "44px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md,
  border: `1px solid ${T.line.normal}`, background: T.surface.raised, color: T.content.primary,
  fontFamily: T.type.body, fontSize: "14px", boxSizing: "border-box",
});
const REQUEST_REFUSAL = {
  target_required: "Choose a delivery first.",
  reason_required: "Say what is wrong with it.",
  not_permitted: "You do not hold the capability to request a correction on this match.",
};

/**
 * After full time, a scorer or a coach (by the SAME capability the rest of
 * the Match Centre already checks, `scoring.finalise`) is asked to confirm
 * the scorecard or open the amendment flow. Nobody else sees this at all.
 *
 * THERE IS NO "CONFIRMED" STATE ON THE PLATFORM. "Looks right" dismisses this
 * banner on this device only (`localStorage`, per SCRBRD-100's own
 * instruction not to build a new confirmation store) — it writes nothing to
 * the server and nobody else's screen changes. The honest action here is the
 * other one: filing a correction through the amendment flow that already
 * exists (`POST /matches/:id/amendments`, `scoring.amend.request` — which
 * only the scorer role holds; a director of sport or the principal then
 * decides it with `scoring.amend.approve`, on a screen this product does not
 * yet have — see the report for that gap).
 */
export function ConfirmScorecardPrompt({ match, role, commentary, innings, onFiled = null }) {
  const canFinalise = holdsCapability(role, "scoring.finalise");
  const canRequest = holdsCapability(role, "scoring.amend.request");
  const [hidden, setHidden] = useState(() => isDismissed(match.id));
  const [open, setOpen] = useState(false);
  const [innIdx, setInnIdx] = useState(Math.max(0, innings.length - 1));
  const [targetKey, setTargetKey] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  if (!canFinalise || hidden) return null;
  const options = deliveryOptions(commentary ?? [], innIdx);

  const submit = async () => {
    if (!targetKey || !reason.trim()) return;
    setBusy(true); setSaid(null);
    try {
      const res = await api(`/api/matches/${match.id}/amendments`, { method: "POST", body: { targetKey, reason: reason.trim() } });
      // GA-I36 §5, the scorer's words: pending is not approved.
      setSaid({ ok: true, text: res?.state === "pending" || !res?.state
        ? `Your request is with the director of sport · asked ${clockWords(Date.now())} · this does not change the score until it is approved.`
        : `Filed: ${res.state}.` });
      setTargetKey(""); setReason("");
      onFiled?.();
    } catch (e) {
      setSaid({ ok: false, text: REQUEST_REFUSAL[e.code] ?? e.message ?? "Could not file the correction." });
    } finally { setBusy(false); }
  };

  return (
    <Panel testid="mc-confirm-prompt">
      <CardHead icon="circle-check">Full time</CardHead>
      <div style={{ padding: T.space.md, display: "grid", gap: T.space.sm }}>
        <p style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>Check the final scorecard.</p>
        <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
          <button type="button" data-testid="mc-confirm-ok" onClick={() => { dismiss(match.id); setHidden(true); }}
            className="pressBtn os-state" style={{ ...linkStyle(), borderColor: T.semantic.positive, color: T.semantic.positive }}>
            <Icon name="circle-check"/> Looks right
          </button>
          {canRequest && (
            <button type="button" data-testid="mc-confirm-open" aria-expanded={open} onClick={() => setOpen((o) => !o)}
              className="pressBtn os-state" style={linkStyle()}>
              <Icon name="pencil"/> Something to correct
            </button>
          )}
        </div>
        {!canRequest && (
          <p style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0 }}>
            Only the scorer can file a correction; a director of sport or the principal then decides it.
          </p>
        )}
        {open && canRequest && (
          <div data-testid="mc-confirm-form" style={{ display: "grid", gap: T.space.sm, borderTop: `1px solid ${T.line.subtle}`, paddingTop: T.space.sm }}>
            {innings.length > 1 && (
              <select data-testid="mc-confirm-innings" value={innIdx} onChange={(e) => { setInnIdx(Number(e.target.value)); setTargetKey(""); }} style={fieldStyle()}>
                {innings.map((_, i) => <option key={i} value={i}>Innings {i + 1}</option>)}
              </select>
            )}
            {options.length ? (
              <select data-testid="mc-confirm-delivery" value={targetKey} onChange={(e) => setTargetKey(e.target.value)} style={fieldStyle()}>
                <option value="">Which delivery?</option>
                {options.map((o) => <option key={o.key} value={o.targetKey}>{o.over}.{o.ball} — {o.text}</option>)}
              </select>
            ) : <Quiet testid="mc-confirm-none">Nothing on the log for this innings to name.</Quiet>}
            <textarea data-testid="mc-confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="What is wrong with it?" style={{ ...fieldStyle(), minHeight: "72px", resize: "vertical" }}/>
            <button type="button" data-testid="mc-confirm-submit" disabled={busy || !targetKey || !reason.trim()} onClick={submit}
              className="pressBtn os-state" style={{ ...linkStyle(), opacity: busy || !targetKey || !reason.trim() ? 0.5 : 1,
                cursor: busy || !targetKey || !reason.trim() ? "not-allowed" : "pointer" }}>
              Ask for a correction
            </button>
            {said && (
              <p role="alert" data-testid="mc-confirm-said" style={{ ...T.role.body, fontSize: "13px", margin: 0,
                color: said.ok ? T.semantic.positive : T.semantic.criticalText ?? T.semantic.critical }}>{said.text}</p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
