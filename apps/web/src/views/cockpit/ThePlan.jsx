/**
 * THE PLAN, on the Coach tab (SCRBRD-138 phase B; docs/design/SCRBRD-138_phaseB.md
 * §5.1, §1.5): where the coach of a side writes the plan to it, sees the one
 * that is out, and takes it back.
 *
 * Four states, and only one is drawn:
 *   a plan is out for this side   THE PLAN block as the side reads it. Its
 *                                 author has Withdraw (asked once; the side is
 *                                 told it was withdrawn); anybody else on the
 *                                 staff has Report, as a reader does. There is
 *                                 NO Edit: a sent plan is changed by withdrawing
 *                                 it, which makes it his draft again.
 *   he has an unsent plan         his draft (saved, or withdrawn), as it is,
 *                                 with Send. There is no edit route and none is
 *                                 drawn; the words are checked again on Send.
 *   he may write one              "Write the plan", which opens the composer
 *                                 (a lazy chunk, PlanComposer.jsx).
 *   none of these                 nothing, and no place held.
 *
 * Whether he may is layout only: the role's `news.publish.team` (the coach and
 * the team manager hold it, PB-D4); the insert's policy decides again. A plan
 * is written for a fixture still to be played or in play (the innings break is
 * the moment 138 §2.2 names), never for one that is over.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { roleGrants } from "@scrbrd/policy/roles";
import { T } from "../../design/tokens.js";
import { api } from "../../lib/api.js";
import { useLive } from "../../lib/live.js";
import { draftPlanOf, planOf, planRefusal, planTitle } from "../../lib/captain.js";
import { startMs } from "../../lib/cockpit.js";
import { sidesOf } from "../../lib/matchCentre.js";
import { Action, Card, Line } from "../family/parts.jsx";
import { PlanBlock } from "../family/plan.jsx";

const PlanComposer = lazy(() => import("./PlanComposer.jsx"));

/**
 * @param {{ match: any, role: string, gate: { end: "home" | "away", role: string, school: string, teamCode: string | null }, sheet: any[] }} p
 */
export function ThePlan({ match, role, gate, sheet }) {
  const [nonce, setNonce] = useState(0);
  const { rows, loading } = useLive("news", role, nonce);
  const [composing, setComposing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {string | null} */ (null));
  const [problem, setProblem] = useState(/** @type {null | { message: string, words: { word: string }[] }} */ (null));
  const writeBtn = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const wasComposing = useRef(false);
  useEffect(() => {
    if (wasComposing.current && !composing) writeBtn.current?.focus();
    wasComposing.current = composing;
  }, [composing]);

  const side = { school: gate.school, team: gate.teamCode };
  const plan = planOf(rows, match.id, side);
  const draft = draftPlanOf(rows, match.id, side);
  const mayWrite = !!gate.teamCode && roleGrants(gate.role, "news.publish.team") && (match.status === "upcoming" || match.status === "live");
  const sides = sidesOf(match);
  const opponent = sides[gate.end === "home" ? "away" : "home"].full;
  const title = planTitle(opponent, startMs(match));

  /** Run one write; on a refusal say it in words and keep everything on screen. */
  const run = async (/** @type {() => Promise<unknown>} */ fn, /** @type {string} */ ok) => {
    setBusy(true); setProblem(null); setSaid(null);
    try { await fn(); setSaid(ok); setNonce((n) => n + 1); setAsking(false); }
    catch (e) { const r = planRefusal(e); setProblem({ message: r.message, words: r.words }); }
    finally { setBusy(false); }
  };
  const problemLines = problem && (
    <div role="alert" data-testid="plan-problem" style={{ display: "grid", gap: T.space.xs }}>
      <p style={{ ...T.role.body, fontSize: "14px", fontWeight: 600, color: T.semantic.criticalText, margin: 0 }}>{problem.message}</p>
      {problem.words.length > 0 && (
        <p style={{ ...T.role.body, fontSize: "14px", margin: 0, color: T.content.primary }}>
          Words to change: {problem.words.map((w, i) => <span key={w.word}>{i > 0 ? ", " : ""}<strong style={{ textDecoration: "underline" }}>{w.word}</strong></span>)}
        </p>
      )}
    </div>
  );
  const status = said && <p role="status" data-testid="plan-said" style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 }}>{said}</p>;

  if (composing) {
    return (
      <Suspense fallback={<Line quiet>Opening the composer…</Line>}>
        <PlanComposer match={match} side={{ school: gate.school, team: /** @type {string} */ (gate.teamCode) }} title={title} opponent={opponent}
          sheet={sheet} onClose={() => setComposing(false)}
          onDone={(what) => { setComposing(false); setSaid(what === "sent" ? "Sent to the side." : "Saved as a draft. It is yours alone until you send it."); setNonce((n) => n + 1); }}/>
      </Suspense>
    );
  }

  if (plan) {
    return (
      <>
        <PlanBlock plan={plan}>
          {plan.mine && (
            <div style={{ display: "grid", gap: T.space.sm }}>
              {!asking ? (
                <div><Action testid="plan-withdraw" onClick={() => { setProblem(null); setSaid(null); setAsking(true); }}>Withdraw</Action></div>
              ) : (
                <>
                  <p data-testid="plan-withdraw-ask" style={{ ...T.role.body, margin: 0, color: T.content.primary }}>
                    Withdraw this plan? The side will be told it was withdrawn. It becomes your draft again.
                  </p>
                  <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
                    <Action testid="plan-withdraw-yes" primary disabled={busy}
                      onClick={() => { void run(() => api(`/api/news/${plan.id}/withdraw`, { method: "POST", body: {} }), "Withdrawn. The side has been told."); }}>
                      {busy ? "Withdrawing…" : "Withdraw it"}
                    </Action>
                    <Action testid="plan-withdraw-no" onClick={() => setAsking(false)} disabled={busy}>Keep it</Action>
                  </div>
                </>
              )}
              {problemLines}
            </div>
          )}
        </PlanBlock>
        {status}
      </>
    );
  }

  if (draft) {
    return (
      <Card label="Your draft plan" testid="plan-draft">
        <p data-testid="plan-draft-body" style={{ ...T.role.body, color: T.content.primary, margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{draft.body}</p>
        <Line quiet>Not sent. Only you can read it. It is sent as it stands: to change it, write the plan again.</Line>
        {problemLines}
        {status}
        <div>
          <Action testid="plan-draft-send" primary disabled={busy}
            onClick={() => { void run(() => api(`/api/news/${draft.id}/publish`, { method: "POST", body: {} }), "Sent to the side."); }}>
            {busy ? "Sending…" : "Send to the side"}
          </Action>
        </div>
      </Card>
    );
  }

  if (!mayWrite || loading) return status;
  return (
    <Card label="The plan" testid="plan-write-card">
      <Line quiet>No plan has been sent to the side for this fixture.</Line>
      {status}
      <div>
        <button type="button" ref={writeBtn} data-testid="plan-write" className="pressBtn os-state" onClick={() => { setSaid(null); setComposing(true); }}
          style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer", background: T.content.primary,
            color: T.surface.canvas, border: `1px solid ${T.content.primary}`, ...T.role.control, fontSize: "15px" }}>
          Write the plan
        </button>
      </div>
    </Card>
  );
}
