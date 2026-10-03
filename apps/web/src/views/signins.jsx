import { useCallback, useEffect, useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { addSignIn, googleAvailable, googleIdToken, GOOGLE_FAILURE_WORDS } from "../lib/google.js";
import { profile } from "../lib/session.js";
import { describeSignIn, isLastLive, ordered, signInWords } from "../lib/signins.js";
import { SIGNIN_NOTICE, SIGNIN_NOTICE_TITLE } from "../lib/signinNotice.js";

// ══════════════════════════════════════════════════════
//  WAYS TO SIGN IN  (Settings → Me; SCRBRD-140 §3.4, §3.7)
//
//  The Google accounts on this account, and a way to add another. Adding one
//  is a fresh Google sign-in made HERE, from a signed-in session: being signed
//  in is the proof that you hold this account, and an email match never is
//  (D11). The server checks the Google sign-in is minutes old, that the
//  Google account is not already someone else's, and, for a pupil under
//  eighteen, that his family's consent is on record; each refusal arrives with
//  its own sentence and is shown as it comes.
//
//  Removing one is the person's own act too. It does not sign them out (the
//  thirty-minute session runs on) and the school office can always issue a
//  code, which is said before they press it.
//
//  This lists what the account holds. It never shows a Google account number:
//  the read does not carry one.
// ══════════════════════════════════════════════════════

const sub = () => ({ fontFamily: D.body, fontSize: "13px", lineHeight: 1.5, color: D.textSecondary });

/** A button on the floors: 13px type, 44px tall. */
function Act({ children, danger, disabled, ...rest }) {
  return (
    <button type="button" className="pressBtn" disabled={disabled} {...rest}
      style={{ minHeight: "44px", padding: "10px 16px", borderRadius: D.pill, boxSizing: "border-box",
        border: `1px solid ${danger ? "transparent" : D.border}`, background: danger ? D.rose : "transparent",
        color: danger ? inkOn(D.rose) : D.textSecondary, fontFamily: D.head, fontSize: "13px", fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>{children}</button>
  );
}

/** One way to sign in, as drawn. Stateless, so a test can draw each state. */
export function SignInRow({ row, accountEmail, confirming, last, busy, onAskRemove, onConfirmRemove, onKeep }) {
  const d = describeSignIn(row, accountEmail);
  return (
    <li data-testid={`sign-in-${d.live ? "live" : "removed"}`} style={{ listStyle: "none", padding: "12px 14px", borderRadius: D.md, border: `1px solid ${D.border}`,
        background: D.surf2 + "66", opacity: d.live ? 1 : 0.75 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>
            {d.provider}{!d.live && <span style={{ ...sub(), fontWeight: 400 }}> · removed {d.removed}</span>}
          </div>
          <div data-testid="sign-in-email" style={{ ...sub(), color: D.textPrimary, overflowWrap: "anywhere" }}>{d.email}</div>
          <div style={sub()}>
            {[d.how, d.added && `since ${d.added}`, d.lastUsed ? `last used ${d.lastUsed}` : "not used yet"].filter(Boolean).join(" · ")}
          </div>
          {d.live && d.differs && (
            <div data-testid="sign-in-differs" style={sub()}>The school has this account under {accountEmail}. To change that address, ask the school office.</div>
          )}
        </div>
        {d.live && !confirming && <Act onClick={onAskRemove} data-testid="sign-in-remove" aria-label={`Remove ${d.provider} ${d.email}`}>Remove</Act>}
      </div>
      {d.live && confirming && (
        <div role="group" aria-label={`Remove ${d.provider} ${d.email}?`} data-testid="sign-in-remove-confirm" style={{ marginTop: "10px", display: "grid", gap: "8px" }}>
          <div style={{ ...sub(), color: D.textPrimary }}>
            Remove {d.provider} ({d.email}) from this account? You stay signed in until your session ends.
            {last ? " It is your only Google sign-in: after this you sign in with a code from your school office, and you can add Google again here." : ""}
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Act danger disabled={busy} onClick={onConfirmRemove} data-testid="sign-in-remove-yes">{busy ? "Removing…" : "Remove it"}</Act>
            <Act disabled={busy} onClick={onKeep} data-testid="sign-in-remove-no">Keep it</Act>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * The panel's content. `post`, `getToken` and `available` are injectable for a test.
 */
export function WaysToSignIn({ post = api, getToken = googleIdToken, available = googleAvailable() }) {
  const [rows, setRows] = useState(null);       // null = asking
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(null);       // "add" | an id being removed
  const [confirm, setConfirm] = useState(null);
  const [note, setNote] = useState(null);       // { tone: "ok" | "error", text }
  const accountEmail = profile()?.user?.email ?? null;

  const load = useCallback(async () => {
    try { const r = await post("/api/read/my_sign_ins"); setRows(r?.rows ?? []); setLoadError(""); }
    catch { setRows([]); setLoadError("Your sign-in methods could not be read. Try again in a moment."); }
  }, [post]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setBusy("add"); setNote(null);
    const g = await getToken();
    if (!g.ok) { setNote({ tone: "error", text: GOOGLE_FAILURE_WORDS[g.failure] ?? GOOGLE_FAILURE_WORDS.google_failed }); setBusy(null); return; }
    try {
      const r = await addSignIn(g.idToken, post);
      setNote({ tone: "ok", text: r?.already ? "That Google account was already on your account." : `Added ${g.email ?? "your Google account"}. You can now sign in with it.` });
      await load();
    } catch (e) { setNote({ tone: "error", text: signInWords(e) }); }
    setBusy(null);
  };

  const remove = async (id) => {
    setBusy(id); setNote(null);
    try {
      await post(`/api/auth/sign-ins/${encodeURIComponent(id)}/revoke`, { method: "POST" });
      setConfirm(null);
      setNote({ tone: "ok", text: "Removed. That Google account no longer signs in to this account." });
      await load();
    } catch (e) { setNote({ tone: "error", text: signInWords(e) }); }
    setBusy(null);
  };

  const list = ordered(rows ?? []);
  return (
    <div data-testid="sign-ins">
      <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>Ways to sign in</div>
      <div style={{ ...sub(), margin: "3px 0 12px", maxWidth: "62ch" }}>
        The code from your school office always works. Add Google here and you can sign in with it as well.
      </div>

      {rows === null && <div style={sub()}>Reading your sign-in methods…</div>}
      {loadError && <div role="alert" style={{ ...sub(), color: textOn(D.rose) }}>{loadError}</div>}
      {rows !== null && !loadError && list.length === 0 && (
        <div data-testid="sign-ins-none" style={sub()}>You sign in with a code from your school office. No Google account is added yet.</div>
      )}
      {list.length > 0 && (
        <ul style={{ margin: 0, padding: 0, display: "grid", gap: "8px" }}>
          {list.map((r) => (
            <SignInRow key={r.id} row={r} accountEmail={accountEmail} confirming={confirm === r.id} last={isLastLive(list, r.id)} busy={busy === r.id}
              onAskRemove={() => { setConfirm(r.id); setNote(null); }} onKeep={() => setConfirm(null)} onConfirmRemove={() => remove(r.id)}/>
          ))}
        </ul>
      )}

      {note && (
        <div role={note.tone === "error" ? "alert" : "status"} data-testid={note.tone === "error" ? "sign-ins-error" : "sign-ins-done"}
          style={{ ...sub(), marginTop: "12px", padding: "10px 12px", borderRadius: D.sm, color: note.tone === "error" ? textOn(D.rose) : D.textPrimary,
            background: (note.tone === "error" ? D.rose : D.emerald) + "14", border: `1px solid ${(note.tone === "error" ? D.rose : D.emerald)}33` }}>{note.text}</div>
      )}

      <div style={{ marginTop: "12px" }}>
        {available
          ? <Act onClick={add} disabled={busy === "add"} data-testid="sign-in-add">{busy === "add" ? "Waiting for Google…" : "Add a way to sign in"}</Act>
          : <div data-testid="sign-in-add-off" style={sub()}>Google sign-in is not switched on for this site, so there is nothing to add yet.</div>}
      </div>

      {/* The paragraph Kameel signed, where the choice is made (§7.5). */}
      <div data-testid="sign-ins-notice" style={{ ...sub(), marginTop: "16px", paddingTop: "12px", borderTop: `1px solid ${D.border}` }}>
        <strong style={{ color: D.textPrimary }}>{SIGNIN_NOTICE_TITLE}</strong> {SIGNIN_NOTICE}
      </div>
    </div>
  );
}
