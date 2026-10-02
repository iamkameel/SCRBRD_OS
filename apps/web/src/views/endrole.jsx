import { useState } from "react";
import { ROLES } from "../design/roles.js";
import { D, inkOn, textOn } from "../design/tokens.js";
import { Input } from "../ui/primitives.jsx";
import { api } from "../lib/api.js";

/**
 * "End this role" — one assignment, ended with a reason (SCRBRD-132 C1, db/77).
 *
 * `POST /api/assignments/:id/end { reason }` runs role_assignment_end(), which
 * decides everything: who may end a role (whoever may appoint it at that
 * school), and who may not, whatever they hold — the owner's key, a
 * superadmin's roles from below, your own last role that can appoint people,
 * your own safeguarding appointment, a child's last verified guardian. Each
 * refusal comes back with the office's words in `detail`, and this shows them
 * as they come. WHAT THIS DECIDES: nothing but whether to ask. The reason's
 * ten characters are checked here only to say so before the round trip; the
 * database checks them again.
 *
 * The row is withdrawn, never deleted: it stays on the appointments list,
 * marked ended, with who ended it. The reason goes on the school's record and
 * not to the person, who is told only that the role ended.
 *
 * Management's user list (each person, all their roles) wires this in beside
 * each live role; `onEnded(assignment)` is its cue to read the list again.
 */

export const REASON_MIN = 10;

/** The client's own words, for what never reached the server. */
export const END_ROLE_WORDS = {
  reason_required: "Say why this role is ending, in at least ten characters. It goes on the school's record, not to the person.",
  unreachable: "The server did not answer. Read the list again before trying: the role may or may not have ended.",
};

/** null when the reason will do; otherwise why not, in words. */
export function reasonProblem(reason) {
  return String(reason ?? "").trim().length < REASON_MIN ? END_ROLE_WORDS.reason_required : null;
}

/** A refusal in words: the server's own sentence, or what we know without it. */
export function refusalWords(e) {
  if (e?.detail) return e.detail;
  if (e?.code === "reason_required") return END_ROLE_WORDS.reason_required;
  if (e?.status) return `This role was not ended (${e.code || e.status}).`;
  return END_ROLE_WORDS.unreachable;
}

/**
 * End one assignment. `post` is api() unless a test hands in another.
 * @returns {Promise<{ ok: true } | { ok: false, code: string, words: string }>}
 */
export async function endRole(assignmentId, reason, post = api) {
  const problem = reasonProblem(reason);
  if (problem) return { ok: false, code: "reason_required", words: problem };
  try {
    await post(`/api/assignments/${encodeURIComponent(assignmentId)}/end`, {
      method: "POST", body: { reason: String(reason).trim() } });
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e?.code || "unreachable", words: refusalWords(e) };
  }
}

const roleLabel = (r) => ROLES[r]?.label ?? r;

/** "Coach, U15A" — what is ending, in the screen's words. */
export function roleLine(a) {
  return [roleLabel(a?.role), a?.team_code].filter(Boolean).join(", ");
}

/** A button on the 12px and 44px floors (the list it sits in is held to them). */
function Act({ children, variant = "ghost", disabled, ...rest }) {
  const danger = variant === "danger";
  return (
    <button type="button" className="pressBtn" disabled={disabled} {...rest}
      style={{ minHeight: "44px", padding: "10px 16px", borderRadius: D.pill, boxSizing: "border-box",
        border: `1px solid ${danger ? "transparent" : D.border}`, background: danger ? D.rose : "transparent",
        color: danger ? inkOn(D.rose) : D.textSecondary, fontFamily: D.head, fontSize: "13px", fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }}>{children}</button>
  );
}

const SUB = () => ({ fontFamily: D.body, fontSize: "12px", lineHeight: 1.45, color: D.textSecondary });

/** The form, as drawn. Stateless, so a test can draw each state. */
export function EndRoleForm({ assignment, reason, onReason, busy, refusal, onConfirm, onCancel }) {
  const who = assignment?.person_name ? `${assignment.person_name}'s` : "This";
  return (
    <div data-testid="end-role-form" role="group" aria-label={`End ${roleLine(assignment)}`}
         style={{ display: "grid", gap: "8px", padding: "12px", borderRadius: D.md,
                  border: `1px solid ${D.border}`, background: D.surf2, maxWidth: "560px" }}>
      <div style={{ ...SUB(), color: D.textPrimary, fontWeight: 600 }}>
        End {who} role: {roleLine(assignment)}
      </div>
      <div style={SUB()}>
        It stops at once. The record keeps it, marked ended, with your name. They are told the role ended, not why.
      </div>
      <Input label="Why is it ending? (the school's record)" value={reason} onChange={onReason}
             data-testid="end-role-reason" placeholder="e.g. Left the school at the end of term 3"/>
      {refusal && <div role="alert" data-testid="end-role-refused"
                       style={{ ...SUB(), color: textOn(D.rose) }}>{refusal}</div>}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Act variant="danger" onClick={onConfirm} disabled={busy || !!reasonProblem(reason)} data-testid="end-role-confirm">
          {busy ? "Ending…" : "End this role"}
        </Act>
        <Act onClick={onCancel} disabled={busy} data-testid="end-role-cancel">Keep it</Act>
      </div>
    </div>
  );
}

/**
 * The button, and the form it opens. Renders nothing for a role already
 * ended: there is nothing to press.
 * @param {{ assignment: { id: string, role: string, team_code?: string|null, person_name?: string|null, active?: boolean },
 *           onEnded?: (a: object) => void, post?: typeof api }} p
 */
export function EndRoleButton({ assignment, onEnded, post = api }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  if (!assignment || assignment.active === false) return null;

  const confirm = async () => {
    setRefusal(""); setBusy(true);
    const r = await endRole(assignment.id, reason, post);
    setBusy(false);
    if (!r.ok) { setRefusal(r.words); return; }
    setOpen(false); setReason("");
    onEnded?.(assignment);
  };

  if (!open) {
    return (
      <Act onClick={() => setOpen(true)} data-testid="end-role"
           aria-label={`End ${roleLine(assignment)}`}>End role</Act>
    );
  }
  return (
    <EndRoleForm assignment={assignment} reason={reason} onReason={setReason} busy={busy} refusal={refusal}
                 onConfirm={confirm} onCancel={() => { setOpen(false); setRefusal(""); setReason(""); }}/>
  );
}
