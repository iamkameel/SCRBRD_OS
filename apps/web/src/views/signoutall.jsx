/**
 * Sign out everywhere (Settings → Me, beside "Ways to sign in").
 *
 * POST /api/auth/sign-out-everywhere ends every sign-in the person holds, on
 * every device, this one included (db/85). The person is asked first, in the
 * words below, then the route answers, and only after it answers OK is this
 * device signed out as well: `onSignedOut` is the shell's own sign-out, which
 * forgets the token, the pad credentials kept here and the page state.
 *
 * Until the server says OK nothing is claimed. A refusal (the server said no,
 * with a reason) and a failure (it did not answer) are told apart; in both the
 * person is still signed in everywhere, and says so, and can try again.
 *
 * Floors: nothing read under 12px, every control 44px tall.
 */
import { useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import {
  SIGN_OUT_EVERYWHERE_ABOUT, SIGN_OUT_EVERYWHERE_CONFIRM, signOutEverywhere,
} from "../lib/signOutEverywhere.js";

const sub = () => ({ fontFamily: D.body, fontSize: "13px", lineHeight: 1.5, color: D.textSecondary });

function Act({ children, danger, disabled, ...rest }) {
  return (
    <button type="button" className="pressBtn" disabled={disabled} {...rest}
      style={{ minHeight: "44px", padding: "10px 16px", borderRadius: D.pill, boxSizing: "border-box",
        border: `1px solid ${danger ? "transparent" : D.border}`, background: danger ? D.rose : "transparent",
        color: danger ? inkOn(D.rose) : D.textSecondary, fontFamily: D.head, fontSize: "13px", fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>{children}</button>
  );
}

/**
 * @param {{ onSignedOut: () => void, post?: typeof api }} props
 *   `post` is injectable for a test; `onSignedOut` signs this device out.
 */
export function SignOutEverywhere({ onSignedOut, post = api }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {null | { kind: "refused" | "failed", text: string, ended?: boolean }} */ (null));

  const go = async () => {
    if (busy) return;
    setBusy(true); setSaid(null);
    // On OK this signs the device out too (the shell leaves this screen);
    // otherwise it answers with the words, and the person is still signed in.
    const not = await signOutEverywhere({ post, onSignedOut });
    if (not) { setSaid(not); setBusy(false); }
  };

  return (
    <div data-testid="sign-out-everywhere">
      <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>Sign out everywhere</div>
      <div style={{ ...sub(), margin: "3px 0 12px", maxWidth: "62ch" }}>{SIGN_OUT_EVERYWHERE_ABOUT}</div>

      {!confirming && (
        <Act danger onClick={() => { setConfirming(true); setSaid(null); }} data-testid="sign-out-everywhere-ask">Sign out everywhere</Act>
      )}

      {confirming && (
        <div role="group" aria-label="Sign out everywhere?" data-testid="sign-out-everywhere-confirm" style={{ display: "grid", gap: "8px" }}>
          <div style={{ ...sub(), color: D.textPrimary }}>{SIGN_OUT_EVERYWHERE_CONFIRM}</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Act danger disabled={busy} onClick={go} data-testid="sign-out-everywhere-yes">{busy ? "Signing out…" : "Yes, sign out everywhere"}</Act>
            <Act disabled={busy} onClick={() => { setConfirming(false); setSaid(null); }} data-testid="sign-out-everywhere-no">Stay signed in</Act>
          </div>
        </div>
      )}

      {said && (
        <div role="alert" data-testid={`sign-out-everywhere-${said.kind}`}
          style={{ ...sub(), marginTop: "12px", padding: "10px 12px", borderRadius: D.sm, color: textOn(D.rose),
            background: D.rose + "14", border: `1px solid ${D.rose}33` }}>
          {said.text}
          {said.ended && (
            <div style={{ marginTop: "8px" }}>
              <Act onClick={onSignedOut} data-testid="sign-out-everywhere-again">Sign in again</Act>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
