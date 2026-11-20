import { useState } from "react";
import { D, T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { couldConfirmResult, profile } from "../lib/session.js";
import { roleGrants } from "@scrbrd/policy/roles";
import { Btn } from "./ui.jsx";

/**
 * "Confirm the result" (once "Finish the match"), on the pad's result screen (db/130; Kameel, 4 Nov 2026,
 * option A: whoever holds scoring.finalise at the home side finishes the
 * match). The match decided on the pad is not, to the server, a finished
 * match until somebody says so: the status moves to complete, and with it the
 * official result, a family's Played row and db/33's end of scoring.
 *
 * Before it asks, the pad sends whatever it still holds (the outbox's own
 * sync()). If anything is still on the phone — no signal, the token not
 * held — it says so and finishes nothing: a match closed with a ball still
 * on a phone would send that ball to quarantine (db/33).
 *
 * The button itself waits on the outbox (Kameel, 4 Nov 2026): while this
 * phone still holds an event, or one is on its way, Finish cannot be pressed
 * and the line under it says why. The server holds the other half
 * (db/132): it refuses held_elsewhere while another phone's lease is live.
 *
 * The offer is a courtesy (session.js couldFinalise()); match_finalise()
 * decides, and every answer it gives is said here in words.
 */

/**
 * Who confirms (redesign slice 4; DESIGN_DIRECTION Q2, Kameel, 20 Nov 2026,
 * option (a)): "the coach confirms the result. The scorer sees 'Your part is
 * done. The coach confirms the result', and the coach gets a notice. The
 * score reads 'provisional' to everyone until the coach confirms." The act is
 * db/130's finish, under the same capability (scoring.finalise at the home
 * side); a person who holds it only as the `scorer` is not offered it
 * (session.js couldConfirmResult()), so the separation of duties is as it
 * was: the hand that scored is not the hand that confirms.
 */

/** Each answer of POST /api/matches/:id/finalise, as the person confirming reads it. */
export const FINISH_WORDS = Object.freeze({
  finished: "Confirmed. The match is finished.",
  already_complete: "This result is already confirmed.",
  not_permitted: "You may not confirm this result. The home side's coach or director of sport can.",
  not_decided: "The match is not decided yet: score it to its end first.",
  super_over_pending: "The match is tied and its conditions provide a super over: play it, or record the organiser's decision, first.",
  match_abandoned: "This match was called off, so there is no result to confirm.",
  held_elsewhere: "The scorer's phone still holds the match. It lets go about a minute and a half after the scorer leaves the pad; then confirm again.",
});

/** The scorer's end (Flow D, step 3), and the sign-in for a coach on this phone. */
export const FINISH_GATE_WORDS = Object.freeze({
  done: "Your part is done.",
  coach: "The coach confirms the result.",
  sign_in: "Coaching this side? Sign in to confirm the result here.",
});

/**
 * "All 126 balls are sent", "No signal · 2 to send. They're safe on this
 * phone.", "2 to send. They're safe on this phone, and go when it has signal."
 * The sync words, said as Today says them (scorerHome.js syncWords()).
 * @param {{balls: number, pending: number, online: boolean}} s
 */
export function doneWords({ balls, pending, online }) {
  if (pending > 0) {
    return online
      ? `${pending} to send. They're safe on this phone, and go when it has signal.`
      : `No signal · ${pending} to send. They're safe on this phone.`;
  }
  if (balls === 1) return "The ball is sent.";
  return balls > 0 ? `All ${balls} balls are sent.` : "Everything is sent.";
}

/**
 * Which the result screen offers: "finish" (the coach's Confirm the result),
 * "done" (the scorer's end), or "sign_in" (a pad scoring under its own key,
 * which never confirms, db/130: the scorer's end, and a sign-in for a coach
 * holding this phone). A courtesy, as before: match_finalise() decides. With
 * no home school on the pad, any assignment that may confirm is offered it.
 * @param {string|null|undefined} schoolId @param {string|null|undefined} teamCode
 * @returns {"finish"|"done"|"sign_in"}
 */
export function finishOffer(schoolId, teamCode) {
  if (!signedIn()) return "sign_in";
  const may = schoolId ? couldConfirmResult(schoolId, teamCode)
    : (profile()?.assignments ?? []).some((/** @type {any} */ a) => a.role !== "scorer" && roleGrants(a.role, "scoring.finalise"));
  return may ? "finish" : "done";
}

/**
 * The result screen's panel when confirming is not this person's: "Your part
 * is done", what is sent or still on the phone, who confirms, and "Back to
 * Today". A pad not signed in also offers a coach the sign-in that returns here.
 * @param {{ offer: "done"|"sign_in", onSignIn?: (() => void)|null, online?: boolean, balls?: number, pending?: number, onBack?: (() => void)|null }} props
 */
export function FinishGate({ offer, onSignIn = null, online = true, balls = 0, pending = 0, onBack = null }) {
  const text = { fontFamily: D.body, fontSize: "15px", lineHeight: 1.45, color: D.textSecondary, margin: 0, textAlign: /** @type {const} */ ("center"), maxWidth: "520px" };
  return (
    <div data-testid="pad-finish-panel" data-offer={offer} data-pending={pending}
      style={{ display: "grid", gap: "12px", justifyItems: "center", marginBottom: "28px" }}>
      <p data-testid="pad-done-lead" style={{ ...text, fontSize: "20px", fontWeight: 700, color: D.textPrimary }}>{FINISH_GATE_WORDS.done}</p>
      <p role="status" aria-live="polite" data-testid="pad-done-said" style={text}>
        {doneWords({ balls, pending, online })} {FINISH_GATE_WORDS.coach}
      </p>
      {onBack && <Btn variant="primary" size="lg" onClick={onBack} data-testid="pad-done-back">Back to Today</Btn>}
      {offer === "sign_in" && online && onSignIn && (
        <>
          <p data-testid="pad-finish-signin-lead" style={{ ...text, fontSize: "14px" }}>{FINISH_GATE_WORDS.sign_in}</p>
          <Btn variant="tonal" size="lg" onClick={onSignIn} data-testid="pad-finish-signin">Sign in to confirm</Btn>
        </>
      )}
    </div>
  );
}

/** @param {number} n */
const ballsWords = (n) => `${n} ${n === 1 ? "event is" : "events are"} still on this phone`;

/**
 * @param {{ matchId: string, engine: () => any, left?: number, sending?: boolean, attached?: boolean, reason?: string|null }} props
 *   engine: the pad's outbox (PadSync's engine), or null; left: how many events
 *   the outbox still holds (PadSync's status); sending: a send is under way;
 *   attached, reason: where the pad stands with the server (PadSync's status)
 */
export function FinishMatch({ matchId, engine, left = 0, sending = false, attached = true, reason = null }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {{ok: boolean, text: string} | null} */ (null));
  const done = said?.ok === true;
  // The outbox is not empty: nothing to press until it is.
  const waiting = !done && (left > 0 || sending);
  const waitingWords = left > 0
    ? `${ballsWords(left)}. Confirm opens once ${left === 1 ? "it reaches" : "they reach"} the server.`
    : "Sending to the server. Confirm opens once it has arrived.";

  const finish = async () => {
    setBusy(true); setSaid(null);
    try {
      const outbox = engine();
      if (!outbox) {
        setSaid({ ok: false, text: "This pad is not connected to the server, so the result cannot be confirmed from here." });
        return;
      }
      const sent = await outbox.sync().catch(() => null);
      const left = outbox.pendingCount ?? sent?.remaining ?? 0;
      // A decided match reopened (a reload, or the sign-in from this screen)
      // whose outbox was emptied and cleared does not attach: it has nothing
      // to send and no token to take (engine.jsx, SCRBRD-079). With nothing
      // queued, held or unsent here, the server has the log, so finishing
      // needs no token; match_finalise() still refuses while another phone
      // holds the pen (held_elsewhere) or the log is not decided.
      const nothingHere = left === 0 && !(outbox.held?.length) && !outbox.toss;
      if (!sent || (sent.unattached && !nothingHere) || left > 0) {
        setSaid({ ok: false, text: `Not confirmed: ${ballsWords(Math.max(left, 0))}, and they must reach the server first. Check the signal and try again.` });
        return;
      }
      const r = await api(`/api/matches/${matchId}/finalise`, { method: "POST" });
      setSaid({ ok: true, text: FINISH_WORDS[/** @type {keyof typeof FINISH_WORDS} */ (r?.state)] ?? FINISH_WORDS.finished });
    } catch (/** @type {any} */ e) {
      setSaid({ ok: false, text: FINISH_WORDS[/** @type {keyof typeof FINISH_WORDS} */ (e?.code)] ?? e?.detail
        ?? "Could not reach the server; the result is not confirmed. Try again." });
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="pad-finish-panel" data-offer="finish" data-attached={attached ? "true" : "false"} data-reason={reason ?? ""}
      style={{ display: "grid", gap: "10px", justifyItems: "center", marginBottom: "20px" }}>
      {!done && (
        <Btn variant="primary" size="lg" disabled={busy || waiting} onClick={finish} data-testid="pad-finish"
          aria-describedby="pad-finish-said">
          {busy ? "Confirming…" : "Confirm the result"}
        </Btn>
      )}
      <p id="pad-finish-said" role="status" aria-live="polite" data-testid="pad-finish-said"
        style={{ fontFamily: D.body, fontSize: "14px", color: said && !said.ok ? T.semantic.criticalText : D.textSecondary, margin: 0, textAlign: "center", maxWidth: "520px" }}>
        {said?.text ?? (waiting && !busy ? waitingWords : "")}
      </p>
    </div>
  );
}
