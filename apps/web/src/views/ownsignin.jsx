/**
 * His own sign-in, for the school office (SCRBRD-140 Migration B, db/169;
 * the red-team's S4, on Kameel's answers of 20 Nov: D and E). On Squad →
 * Edit Profile, beside Family links, for a holder of guardian.link.manage.
 *
 *   The state         GET  /api/players/:id/own-signin
 *   The form on file  POST /api/players/:id/own-signin/office { formOnFile: true, formSignedBy, formSignedOn }
 *   A withdrawal      POST …/office { withdrawn: true }
 *   Open him now      POST …/office { retry: true }   (a yes in force, his recognised account held: S5)
 *
 * WHAT THIS SCREEN DECIDES: nothing. pupil_signin_state() answers only the
 * office and his family; the doors decide who may and answer a code. Before
 * the withdrawal is sent the office is told, in OFFICE_WITHDRAW's words,
 * that it does not hold against a parent's later yes (E).
 *
 * Floors: nothing read under 12px, every control 44px tall, no motion.
 */
import { useEffect, useId, useState } from "react";
import { D } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { FORM_ON_FILE, OFFICE_WITHDRAW, OWN_SIGNIN_REFUSALS, formReady, heldWords, officeSigninWords } from "../lib/ownSignin.js";
import { DBtn, dField, dHead, dNote } from "./publicname.jsx";

const todayIso = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);   // Johannesburg's day

/** @param {any} e */
const refusal = (e) => FORM_ON_FILE[`form_${e?.code}`] ?? OWN_SIGNIN_REFUSALS[e?.code] ?? OWN_SIGNIN_REFUSALS.fallback;

/** @param {{ player: { id: string, name: string } }} props */
export function OfficeOwnSignIn({ player }) {
  const [state, setState] = useState(/** @type {any} */ (undefined));
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {{ text: string, bad: boolean } | null} */ (null));
  const [form, setForm] = useState({ open: false, signedBy: "", signedOn: "" });
  const [asking, setAsking] = useState(false);
  const idBy = useId(), idOn = useId();
  useEffect(() => {
    let off = false;
    api(`/api/players/${player.id}/own-signin`)
      .then((r) => { if (!off) setState(r?.ownSignIn ?? null); })
      .catch(() => { if (!off) setState(null); });
    return () => { off = true; };
  }, [player.id, nonce]);
  if (state === null || (state && !state.office)) return null;   // not the office's to read
  const send = async (/** @type {any} */ body, /** @type {string} */ done) => {
    setBusy(true); setSaid(null);
    try {
      const r = await api(`/api/players/${player.id}/own-signin/office`, { method: "POST", body });
      const held = heldWords(r?.held, player.name);
      setSaid({ text: held ?? done, bad: !!held });
      setForm({ open: false, signedBy: "", signedOn: "" }); setAsking(false); setNonce((n) => n + 1);
    } catch (e) { setSaid({ text: refusal(e), bad: true }); }
    setBusy(false);
  };
  return (
    <div data-testid="office-own-signin">
      <p style={dHead()}>His own sign-in</p>
      {state === undefined ? <p role="status" style={dNote()}>Reading…</p> : (
        <>
          <p style={{ ...dNote(), color: D.textPrimary }} data-testid="office-own-signin-words">{officeSigninWords(state, player.name)}</p>
          {state.held && <p style={dNote(true)} data-testid="office-own-signin-held">{heldWords(true, player.name)}</p>}
          {!state.adult && state.bornKnown && !form.open && !asking && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {state.yesHow !== "office" && <DBtn disabled={busy} onClick={() => setForm((f) => ({ ...f, open: true }))} testid="office-own-signin-form">{FORM_ON_FILE.label}</DBtn>}
              {state.inForce && <DBtn quiet disabled={busy} onClick={() => setAsking(true)} testid="office-own-signin-withdraw">{OFFICE_WITHDRAW.button}</DBtn>}
              {state.held && <DBtn quiet disabled={busy} onClick={() => send({ retry: true }, `${player.name}'s account is open.`)} testid="office-own-signin-retry">{OFFICE_WITHDRAW.retry}</DBtn>}
            </div>
          )}
          {form.open && (
            <div role="group" aria-label={FORM_ON_FILE.label} data-testid="office-own-signin-form-ask">
              <label htmlFor={idBy} style={{ ...dNote(), display: "block" }}>{FORM_ON_FILE.signedBy}</label>
              <input id={idBy} value={form.signedBy} maxLength={200} autoComplete="off" style={dField()} data-testid="office-own-signin-signed-by"
                onChange={(e) => setForm((f) => ({ ...f, signedBy: e.target.value }))}/>
              <label htmlFor={idOn} style={{ ...dNote(), display: "block" }}>{FORM_ON_FILE.signedOn}</label>
              <input id={idOn} type="date" max={todayIso()} value={form.signedOn} style={dField()} data-testid="office-own-signin-signed-on"
                onChange={(e) => setForm((f) => ({ ...f, signedOn: e.target.value }))}/>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <DBtn disabled={busy || !formReady(form)} testid="office-own-signin-form-save"
                  onClick={() => send({ formOnFile: true, formSignedBy: form.signedBy.trim(), formSignedOn: form.signedOn }, "The form is recorded as on file.")}>Record it</DBtn>
                <DBtn quiet disabled={busy} onClick={() => setForm({ open: false, signedBy: "", signedOn: "" })}>Cancel</DBtn>
              </div>
            </div>
          )}
          {asking && (
            <div role="group" aria-label={OFFICE_WITHDRAW.button} data-testid="office-own-signin-withdraw-ask">
              <p style={{ ...dNote(), color: D.textPrimary }} data-testid="office-own-signin-withdraw-says">{OFFICE_WITHDRAW.says}</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <DBtn disabled={busy} onClick={() => send({ withdrawn: true }, OFFICE_WITHDRAW.done)} testid="office-own-signin-withdraw-confirm">{OFFICE_WITHDRAW.button}</DBtn>
                <DBtn quiet disabled={busy} onClick={() => setAsking(false)}>Keep it</DBtn>
              </div>
            </div>
          )}
        </>
      )}
      {said && <p role={said.bad ? "alert" : "status"} style={dNote(said.bad)} data-testid="office-own-signin-said">{said.text}</p>}
    </div>
  );
}
