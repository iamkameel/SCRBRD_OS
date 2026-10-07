import { useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";

/**
 * Disable and Enable an account, from People (account lifecycle, slice 1).
 *
 * `POST /api/auth/users/:id/disable` and `/enable` (db/85) run
 * account_set_active(), which decides everything through db/81's
 * auth_office_refusal(): user.invite at the account's school, every role the
 * account holds one the caller could grant there, a platform-wide account only
 * by a superadmin, never your own. Each refusal comes back with the sentence
 * SIGN_IN_REFUSALS gives it in `detail`, and this shows it as it comes.
 * WHAT THIS DECIDES: nothing. lib/people.js accountAction() decides only
 * whether to draw the button.
 *
 * Disabling is a sign-in matter, not a dismissal (D1): every device is signed
 * out now, nobody can sign in, and every role and link stays. Enabling signs
 * nobody back in; the person signs in again on each device.
 *
 * No reason, no preview, no notice on enable: those are slice 2, which needs a
 * migration. No motion either, so there is nothing for reduced motion to stop.
 */

/** The client's own words, for what never reached the server. */
export const ACCOUNT_WORDS = {
  unreachable: "The server did not answer. Read the list again before trying: the account may or may not have changed.",
};

/** A refusal in words: the server's own sentence, or what we know without it. */
export function accountRefusalWords(e) {
  if (e?.detail) return e.detail;
  if (e?.status === 401) return "Your session has ended. Sign in again. Nothing was changed.";
  if (e?.status) return "The account was not changed. Read the list again and try once more.";
  return ACCOUNT_WORDS.unreachable;
}

/**
 * Disable (`active` false) or enable (`active` true) one account. `post` is
 * api() unless a test hands in another.
 * @returns {Promise<{ ok: true, active: boolean } | { ok: false, code: string, words: string }>}
 */
export async function setAccountActive(userId, active, post = api) {
  try {
    const out = await post(`/api/auth/users/${encodeURIComponent(userId)}/${active ? "enable" : "disable"}`, { method: "POST" });
    return { ok: true, active: out?.active ?? active };
  } catch (e) {
    return { ok: false, code: e?.code || "unreachable", words: accountRefusalWords(e) };
  }
}

/** What the confirmation says before a disable. */
export const disableWarning = (name) =>
  `This signs ${name || "this person"} out of every device now and stops them signing in. Their roles stay. To remove them from the school, end their roles first.`;

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

const SUB = () => ({ fontFamily: D.body, fontSize: "13px", lineHeight: 1.45, color: D.textSecondary });

/**
 * The confirmation before a disable, as drawn. Stateless, so a test can draw
 * each state. "Keep it active" takes the focus, so a stray Enter keeps the
 * account as it is: the destructive button is never the default.
 */
export function DisableConfirm({ name, busy, refusal, onConfirm, onCancel }) {
  return (
    <div data-testid="account-disable-form" role="group" aria-label={`Disable ${name}'s account`}
         style={{ display: "grid", gap: "8px", padding: "12px", borderRadius: D.md,
                  border: `1px solid ${D.border}`, background: D.surf2, maxWidth: "560px" }}>
      <div style={{ ...SUB(), color: D.textPrimary, fontWeight: 600 }}>Disable {name}'s account?</div>
      <div data-testid="account-disable-warning" style={SUB()}>{disableWarning(name)}</div>
      {refusal && <div role="alert" data-testid="account-refused"
                       style={{ ...SUB(), color: textOn(D.rose) }}>{refusal}</div>}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Act onClick={onCancel} disabled={busy} data-testid="account-disable-cancel" autoFocus>Keep it active</Act>
        <Act variant="danger" onClick={onConfirm} disabled={busy} data-testid="account-disable-confirm">
          {busy ? "Disabling…" : "Disable account"}
        </Act>
      </div>
    </div>
  );
}

/**
 * The button for one account: "Disable account", which opens the
 * confirmation, or "Enable account", which acts at once. `action` is
 * accountAction()'s answer; null draws nothing.
 * @param {{ person: { id: string, name: string }, action: "disable" | "enable" | null,
 *           onChanged?: (active: boolean) => void, post?: typeof api }} p
 */
export function AccountButton({ person, action, onChanged, post = api }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");
  if (!person || !action) return null;

  const act = async (active) => {
    setRefusal(""); setBusy(true);
    const r = await setAccountActive(person.id, active, post);
    setBusy(false);
    if (!r.ok) { setRefusal(r.words); return; }
    setOpen(false);
    onChanged?.(r.active);
  };

  if (action === "enable") {
    return (
      <div style={{ display: "grid", gap: "6px" }}>
        <Act onClick={() => act(true)} disabled={busy} data-testid={`account-enable-${person.id}`}
             aria-label={`Enable ${person.name}'s account`}>{busy ? "Enabling…" : "Enable account"}</Act>
        {refusal && <div role="alert" data-testid="account-refused"
                         style={{ ...SUB(), color: textOn(D.rose), maxWidth: "560px" }}>{refusal}</div>}
      </div>
    );
  }
  if (!open) {
    return (
      <Act onClick={() => setOpen(true)} data-testid={`account-disable-${person.id}`}
           aria-label={`Disable ${person.name}'s account`}>Disable account</Act>
    );
  }
  return (
    <DisableConfirm name={person.name} busy={busy} refusal={refusal}
                    onConfirm={() => act(false)} onCancel={() => { setOpen(false); setRefusal(""); }}/>
  );
}
