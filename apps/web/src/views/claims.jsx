import { useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { CLAIM_DONE, describeClaim, signInWords } from "../lib/signins.js";

// ══════════════════════════════════════════════════════
//  SIGN-IN CLAIMS  (Settings → People; SCRBRD-140 §3.3)
//
//  A person signed in with Google and the address Google verified matches an
//  account the office enrolled, one that holds, or held, something. The server
//  never links that on an email alone: it answers "claim_required" and puts the
//  claim here. The office looks, as it would before issuing a code, and either
//  CONFIRMS (one tap; their next Google sign-in is that account), DECLINES, or
//  issues a code as it always could.
//
//  The row shows the account as the office enrolled it beside the address
//  Google verified, and never the Google account number. WHAT THE OFFICE IS
//  ASKED TO LOOK AT: is this the person? A different address, or an account
//  that was deactivated, is marked, because those are the cases the rule exists
//  for (a reassigned mailbox, §6).
//
//  Who sees the list is the database's: pending_claims() returns only claims on
//  accounts the caller may issue a code to, and confirm / decline refuse anyone
//  else in words (SIGN_IN_REFUSALS). The panel only asks.
// ══════════════════════════════════════════════════════

const sub = () => ({ fontFamily: D.body, fontSize: "13px", lineHeight: 1.5, color: D.textSecondary });

function Act({ children, danger, disabled, ...rest }) {
  return (
    <button type="button" className="pressBtn" disabled={disabled} {...rest}
      style={{ minHeight: "44px", padding: "10px 16px", borderRadius: D.pill, boxSizing: "border-box",
        border: `1px solid ${danger ? D.border : "transparent"}`, background: danger ? "transparent" : D.indigo,
        color: danger ? D.textSecondary : inkOn(D.indigo), fontFamily: D.head, fontSize: "13px", fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>{children}</button>
  );
}

/** One claim, as drawn. Stateless, so a test can draw it. */
export function ClaimRow({ claim, busy, onConfirm, onDecline, onIssueCode }) {
  const c = describeClaim(claim);
  return (
    <li data-testid="claim" data-claim={c.id} style={{ listStyle: "none", padding: "12px 14px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf2 + "66" }}>
      <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>{c.name}</div>
      <div style={sub()}>The school has this account as <span data-testid="claim-enrolled" style={{ color: D.textPrimary, overflowWrap: "anywhere" }}>{c.enrolledAs}</span></div>
      <div style={sub()}>{c.provider} says the person signing in is <span data-testid="claim-google" style={{ color: D.textPrimary, overflowWrap: "anywhere" }}>{c.google}</span>
        {c.sameAddress ? " (the same address)" : " (a different address: check before you confirm)"}</div>
      <div style={sub()}>Asked {c.asked}{c.askedAgain ? `, and again ${c.askedAgain}` : ""}</div>
      {c.inactive && <div data-testid="claim-inactive" style={{ ...sub(), color: textOn(D.amber) }}>This account was deactivated. Look harder before you confirm.</div>}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
        <Act disabled={busy} onClick={onConfirm} data-testid="claim-confirm" aria-label={`Confirm ${c.name}'s Google sign-in`}>{busy ? "Working…" : "Confirm it is them"}</Act>
        <Act danger disabled={busy} onClick={onIssueCode} data-testid="claim-code" aria-label={`Issue ${c.name} a code instead`}>Issue a code instead</Act>
        <Act danger disabled={busy} onClick={onDecline} data-testid="claim-decline" aria-label={`Decline ${c.name}'s Google sign-in`}>Decline</Act>
      </div>
    </li>
  );
}

/**
 * The panel. `rows` is the sign_in_claims read; `onChanged` is the cue to read
 * it again; `onIssueCode({ id, email, name })` is the People tab's own code
 * issue (POST /api/auth/invite), whose card shows the code once.
 */
export function ClaimsPanel({ rows, loading, onChanged, onIssueCode, post = api }) {
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const act = async (c, what) => {
    setBusy(c.id); setNote(null);
    try {
      await post(`/api/auth/claims/${encodeURIComponent(c.id)}/${what}`, { method: "POST" });
      setNote({ tone: "ok", text: CLAIM_DONE[what === "confirm" ? "confirmed" : "declined"] });
      onChanged?.();
    } catch (e) { setNote({ tone: "error", text: signInWords(e) }); }
    setBusy(null);
  };
  const list = rows ?? [];
  return (
    <div data-testid="claims" style={{ marginBottom: "16px", padding: "16px", borderRadius: D.lg, border: `1px solid ${list.length ? D.amber + "55" : D.border}`, background: D.surf1 }}>
      <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>
        Google sign-ins waiting for you{list.length > 0 && <span data-testid="claims-count"> ({list.length})</span>}
      </div>
      <div style={{ ...sub(), margin: "3px 0 10px", maxWidth: "62ch" }}>
        Somebody signed in with a Google account whose address is one you enrolled. It is never linked without a person looking. If it is them, confirm; if you are not sure, issue a code and hand it over as you always have.
      </div>
      {loading && list.length === 0 && <div style={sub()}>Reading the list…</div>}
      {!loading && list.length === 0 && <div data-testid="claims-none" style={sub()}>Nothing is waiting.</div>}
      {list.length > 0 && (
        <ul style={{ margin: 0, padding: 0, display: "grid", gap: "8px" }}>
          {list.map((c) => (
            <ClaimRow key={c.id} claim={c} busy={busy === c.id}
              onConfirm={() => act(c, "confirm")} onDecline={() => act(c, "decline")}
              onIssueCode={() => onIssueCode?.({ id: c.user_id, email: c.account_email, name: c.account_name })}/>
          ))}
        </ul>
      )}
      {note && (
        <div role={note.tone === "error" ? "alert" : "status"} data-testid={note.tone === "error" ? "claims-error" : "claims-done"}
          style={{ ...sub(), marginTop: "10px", color: note.tone === "error" ? textOn(D.rose) : D.textPrimary }}>{note.text}</div>
      )}
    </div>
  );
}
