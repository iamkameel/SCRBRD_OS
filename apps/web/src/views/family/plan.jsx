/**
 * THE COACH'S PLAN, as the side reads it (SCRBRD-138 phase B;
 * docs/design/SCRBRD-138_phaseB.md §5.2, §2.2).
 *
 * ONE COMPONENT, `PlanBlock`, drawn on the fixture screen for everybody the
 * plan reaches: every boy of the side (sheet or not), his parents and the
 * side's staff. It sits under the team sheet and ABOVE the Captain section, so
 * the captain gets no second copy inside his section. Drawn only while a live
 * plan exists; otherwise nothing is drawn and no place is held.
 *
 * WHO MAY READ IT is not decided here. The `news` read is: a plan is a team
 * post (db/12, db/96), so a boy of another side, the other school's coach and
 * the public have no row, and this file only picks the row for this fixture
 * and this side (lib/captain.js planOf), from the read narrowed to the fixture
 * (planRead), so an older fixture's plan is not lost behind newer posts. The
 * label names the coach who wrote it to every reader of it (db/103, SG-9).
 * There is no reply, no reaction and no "seen": the plan is read, and the one
 * thing a reader can do is Report it, which sends the notice to the school's
 * safeguarding officer (lib/notifications report(), the same call Notices
 * makes). Withdrawn: gone on the next load.
 */
import { useState } from "react";
import { T } from "../../design/tokens.js";
import { useLive } from "../../lib/live.js";
import { report } from "../../lib/notifications.js";
import { planLabel, planOf, planRead } from "../../lib/captain.js";
import { Action, Card } from "./parts.jsx";

/**
 * The plan's one-tap report. Not offered to its author, who has Withdraw, and
 * not drawn without the live notice's id (a reader the notice does not reach
 * has nothing to report). Says what happened, in the notice screen's own words,
 * and never who reported.
 * @param {{ noticeId: string | null, testid?: string }} p
 */
export function ReportPlan({ noticeId, testid = "plan-report" }) {
  const [said, setSaid] = useState(/** @type {{ done: boolean, words: string } | null} */ (null));
  const [busy, setBusy] = useState(false);
  if (!noticeId) return null;
  return (
    <div style={{ display: "grid", gap: T.space.xs, justifyItems: "end" }}>
      {!said?.done && (
        <Action testid={testid} disabled={busy} label="Report this plan"
          onClick={async () => { setBusy(true); setSaid(await report(noticeId)); setBusy(false); }}>
          {busy ? "Reporting…" : "Report"}
        </Action>
      )}
      {said && <p role="status" data-testid={`${testid}-said`} style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0, textAlign: "right" }}>{said.words}</p>}
    </div>
  );
}

/**
 * THE PLAN block (§5.2): the author, when, and the whole body, never cut. The
 * body is the writer's own words in a paragraph with its line breaks kept.
 * `children` is a footer for the screen that owns an action beside it (the
 * coach's Withdraw); the family's screens pass none and get Report.
 * @param {{ plan: import("../../lib/captain.js").Plan, children?: any }} p
 */
export function PlanBlock({ plan, children }) {
  return (
    <Card label={planLabel(plan)} testid="plan-block">
      <p data-testid="plan-body" style={{ ...T.role.body, color: T.content.primary, margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{plan.body}</p>
      {children ?? (!plan.mine && <ReportPlan noticeId={plan.noticeId}/>)}
    </Card>
  );
}

/**
 * The block on a fixture screen, for the child the screen is about: his
 * school's and side's plan for this fixture, from the news read. Nothing while
 * the read is coming, and nothing when it says there is none.
 * @param {{ match: any, child: { school: string | null, team: string | null }, role: string }} p
 */
export function FixturePlan({ match, child, role }) {
  const { rows } = useLive("news", role, 0, planRead(match.id));
  const plan = planOf(rows, match.id, { school: child.school ?? null, team: child.team ?? null });
  return plan ? <PlanBlock plan={plan}/> : null;
}
