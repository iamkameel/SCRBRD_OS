/**
 * SCRBRD — the client side of the scoring-session handover.
 *
 * The protocol itself (arm → code → claim → verify → transfer) is specified
 * in docs/SCORING_HANDOVER_SPEC.md and implemented in
 * services/api/handover/scoring-session.mjs / db/02_schema_scoring.sql. Until
 * SCRBRD-056 this had a full backend, a passing API walk, and no screen —
 * this file and scorer/sheets.jsx's HandoverSheet are that screen. Nothing
 * here computes anything; it is four thin POSTs plus one read of the current
 * session state, all through the same `api()` every other call in this app
 * uses, so RLS and auth apply exactly as they do everywhere else.
 *
 * WHAT THIS DOES NOT DO
 * ──────────────────────
 * It does not pre-fill the verification figures. Step 3 of the protocol is
 * an INDEPENDENT check — the incoming scorer reads the physical scoreboard
 * and types what they see, and the server compares that against its own
 * replay. A UI that suggested the expected numbers would turn the one check
 * that catches a real divergence into a confirm-the-computer's-guess button.
 *
 * A KNOWN GAP, LEFT OPEN AND RECORDED RATHER THAN PAPERED OVER
 * ──────────────────────────────────────────────────────────────
 * scoring_claim() (the plain, non-handover claim db/02 uses when the pad
 * first opens) only refuses when the session is ACTIVE with someone else's
 * live lease — it does not check for HANDOVER_PENDING or VERIFYING. So a
 * second device that simply opens the scoring screen while a handover is
 * armed can claim the token outright, bypassing the code and the
 * verification handshake entirely; the reference implementation
 * (scoring-session.mjs) has the identical shape. That is a property of the
 * session state machine itself, not of this screen, and fixing it is a
 * database-function change with its own db/NN — filed as SCRBRD-059 rather
 * than folded in here. What THIS file does about it: `precheck()` below,
 * called before sync.js's initial claim, reads the session's current state
 * first and — client-side only — declines to auto-claim into a pending or
 * verifying handover, so a scorer who opens the app in the ordinary way is
 * steered to the code/verify screen instead of silently taking the token.
 * It narrows the window; it does not close it, and says so here.
 */
import { api } from "./api.js";

/**
 * Is a handover already in progress on this match? Read through
 * `match_duties`, which already exposes `scoring_session.state` under
 * `fixture.read` (db/02's `session_read` policy) — broadly enough that any
 * scorer opening the match may see it, and without a second read resource
 * for one field. Never throws: a read that fails here should not block the
 * ordinary claim path that runs right after it.
 */
export async function sessionState(matchId) {
  try {
    const { rows } = await api(`/api/read/match_duties?matchId=${encodeURIComponent(matchId)}`);
    const row = (rows || []).find((r) => r.duty === "scoring");
    return row?.state || "idle";
  } catch {
    return null; // unknown — let the caller proceed as it would have anyway
  }
}

/** Step 1 — outgoing device offers the token. Returns the six-digit code. */
export const armHandover = (matchId, { device, pending = 0, ballInFlight = false, to = null }) =>
  api(`/api/matches/${matchId}/session/handover/arm`, {
    method: "POST", body: { device, pending, ballInFlight, to },
  });

/**
 * The outgoing device changing its mind, or recovering from an accidental
 * arm. There is no dedicated cancel route — `scoring_claim` on the SAME
 * device it was armed from bumps the epoch, clears the pending handover
 * fields, and hands the (fresh) token straight back to the caller, which is
 * exactly a cancel. Named for what it does, not for the route it happens to
 * share.
 */
export const cancelHandover = (matchId, { device }) =>
  api(`/api/matches/${matchId}/session/claim`, { method: "POST", body: { device } });

/** Step 2 — incoming device claims the pending handover with its code. */
export const claimHandover = (matchId, { device, code }) =>
  api(`/api/matches/${matchId}/session/handover/claim`, {
    method: "POST", body: { device, code },
  });

/**
 * Step 3 — incoming device states what it reads off the physical
 * scoreboard. `balls` is the total legal deliveries bowled this innings
 * (overs × 6 + balls in the current over), not an "14.2" string — the server
 * counts the same way (`ball_event_live`, legal deliveries only).
 */
export const verifyTakeover = (matchId, { device, runs, wickets, balls }) =>
  api(`/api/matches/${matchId}/session/handover/verify`, {
    method: "POST", body: { device, runs, wickets, balls },
  });
