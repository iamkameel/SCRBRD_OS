import { useState } from "react";
import { D, T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { couldFinalise, reachesEverySchool, schoolsWhere } from "../lib/session.js";
import { Btn } from "./ui.jsx";

/**
 * "Finish the match", on the pad's result screen (db/130; Kameel, 4 Nov 2026,
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

/** Each answer of POST /api/matches/:id/finalise, as the scorer reads it. */
export const FINISH_WORDS = Object.freeze({
  finished: "Finished. The result now waits for confirmation.",
  already_complete: "This match is already finished.",
  not_permitted: "You may not finish this match. A scorer, coach or director of sport of the home side can.",
  not_decided: "The match is not decided yet: score it to its end before you finish it.",
  super_over_pending: "The match is tied and its conditions provide a super over: play it, or record the organiser's decision, first.",
  match_abandoned: "This match was called off, so there is no result to finish.",
  held_elsewhere: "Another phone is scoring this match. Finish it from that phone, or once it has sent its last ball and put the pen down.",
});

/** What the result screen says when it cannot offer Finish (18 Nov 2026: never hidden in silence). */
export const FINISH_GATE_WORDS = Object.freeze({
  sign_in: "Sign in to finish this match.",
  sign_in_why: "This pad is scoring under its own key, which sends balls but cannot finish a match. Sign in, and you come back to this screen.",
  no_signal: "There is no signal: sign in once there is, and finish the match from here.",
});

/**
 * Which of the three the result screen offers (18 Nov 2026, the match-day
 * bug): Finish itself; a sign-in, when this pad is not signed in (a reload
 * keeps the pad scoring under its resume key, which match_finalise() never
 * admits, db/130); or the refusal in words, naming who may. A courtesy, as
 * before: match_finalise() decides. With no home school on the pad (a pad
 * opened before the school was carried), any assignment that holds
 * scoring.finalise is offered Finish, and the server answers.
 * @param {string|null|undefined} schoolId @param {string|null|undefined} teamCode
 * @returns {"finish"|"sign_in"|"not_permitted"}
 */
export function finishOffer(schoolId, teamCode) {
  if (!signedIn()) return "sign_in";
  const may = schoolId ? couldFinalise(schoolId, teamCode)
    : schoolsWhere("scoring.finalise").length > 0 || reachesEverySchool("scoring.finalise");
  return may ? "finish" : "not_permitted";
}

/**
 * The result screen's panel when Finish is not this person's to press: the
 * sign-in that returns to the pad, or who may finish it.
 * @param {{ offer: "sign_in"|"not_permitted", onSignIn?: (() => void)|null, online?: boolean }} props
 */
export function FinishGate({ offer, onSignIn = null, online = true }) {
  const text = { fontFamily: D.body, fontSize: "14px", color: D.textSecondary, margin: 0, textAlign: /** @type {const} */ ("center"), maxWidth: "520px" };
  if (offer === "not_permitted") {
    return (
      <div data-testid="pad-finish-panel" data-offer="not_permitted" style={{ display: "grid", gap: "10px", justifyItems: "center", marginBottom: "20px" }}>
        <p role="status" data-testid="pad-finish-said" style={text}>{FINISH_WORDS.not_permitted}</p>
      </div>
    );
  }
  return (
    <div data-testid="pad-finish-panel" data-offer="sign_in" style={{ display: "grid", gap: "10px", justifyItems: "center", marginBottom: "20px" }}>
      <p data-testid="pad-finish-signin-lead" style={{ ...text, fontWeight: 600, color: D.textPrimary }}>{FINISH_GATE_WORDS.sign_in}</p>
      {online && onSignIn
        ? <Btn variant="primary" size="lg" onClick={onSignIn} data-testid="pad-finish-signin">Sign in to finish</Btn>
        : null}
      <p role="status" data-testid="pad-finish-said" style={text}>
        {online && onSignIn ? FINISH_GATE_WORDS.sign_in_why : FINISH_GATE_WORDS.no_signal}
      </p>
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
    ? `${ballsWords(left)}. Finish opens once ${left === 1 ? "it reaches" : "they reach"} the server.`
    : "Sending to the server. Finish opens once it has arrived.";

  const finish = async () => {
    setBusy(true); setSaid(null);
    try {
      const outbox = engine();
      if (!outbox) {
        setSaid({ ok: false, text: "This pad is not connected to the server, so the match cannot be finished from here." });
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
        setSaid({ ok: false, text: `Not finished: ${ballsWords(Math.max(left, 0))}, and they must reach the server first. Check the signal and try again.` });
        return;
      }
      const r = await api(`/api/matches/${matchId}/finalise`, { method: "POST" });
      setSaid({ ok: true, text: FINISH_WORDS[/** @type {keyof typeof FINISH_WORDS} */ (r?.state)] ?? FINISH_WORDS.finished });
    } catch (/** @type {any} */ e) {
      setSaid({ ok: false, text: FINISH_WORDS[/** @type {keyof typeof FINISH_WORDS} */ (e?.code)] ?? e?.detail
        ?? "Could not reach the server; the match is not finished. Try again." });
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="pad-finish-panel" data-offer="finish" data-attached={attached ? "true" : "false"} data-reason={reason ?? ""}
      style={{ display: "grid", gap: "10px", justifyItems: "center", marginBottom: "20px" }}>
      {!done && (
        <Btn variant="primary" size="lg" disabled={busy || waiting} onClick={finish} data-testid="pad-finish"
          aria-describedby="pad-finish-said">
          {busy ? "Finishing…" : "Finish the match"}
        </Btn>
      )}
      <p id="pad-finish-said" role="status" aria-live="polite" data-testid="pad-finish-said"
        style={{ fontFamily: D.body, fontSize: "14px", color: said && !said.ok ? T.semantic.criticalText : D.textSecondary, margin: 0, textAlign: "center", maxWidth: "520px" }}>
        {said?.text ?? (waiting && !busy ? waitingWords : "")}
      </p>
    </div>
  );
}
