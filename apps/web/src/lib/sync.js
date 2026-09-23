/**
 * SCRBRD — the scorer's connection to the server.
 *
 * Claims the match, then runs a durable outbox: every ball is written to
 * IndexedDB before it counts as recorded, sent when there is a connection,
 * and retried with backoff when there is not.
 *
 * WHAT THIS MODULE PROMISES, AND WHAT IT DOES NOT
 * ──────────────────────────────────────────────
 * It promises that a ball the scorer taps is never lost. It does NOT promise
 * that the ball has reached the server, and the scoring surface must never
 * wait for it to. A school ground has no signal; the board updates on tap and
 * the outbox catches up later. Everything here is best-effort by design.
 *
 * There are two separate durable stores under the scorer and they are not
 * redundant:
 *
 *   persist.js  keeps the WHOLE LOG so a reload rebuilds the match. It is what
 *               the scorer is looking at.
 *   this outbox keeps the events NOT YET ACKNOWLEDGED so a reload does not
 *               forget to send them. It is what the rest of the school is
 *               waiting for.
 *
 * A match that is fully synced has an empty outbox and a full log; a phone that
 * has been offline all afternoon has both. Losing either one loses something
 * different.
 */
import { SyncEngine, indexedDbStorage } from "@scrbrd/sync";
import { api, signedIn } from "./api.js";
import { deviceId } from "./device.js";
import { sessionState } from "./handover.js";

const RETRY_MS = 4000;

/**
 * Start syncing a match, or explain why not.
 *
 * Returns `{ ok: false, reason }` rather than throwing, because none of these
 * outcomes should stop someone scoring. A scorer who cannot reach the server,
 * or whose colleague already holds the token, still needs the pad to work —
 * they will hand the log over afterwards. Refusing to open the scorer because
 * sync is unavailable would be exactly the wrong failure.
 */
export async function startSync({ matchId, userId, onChange }) {
  if (!matchId) return { ok: false, reason: "no_match" };
  if (!signedIn()) return { ok: false, reason: "not_signed_in" };

  // scoring_claim() only refuses when the session is ACTIVE with someone
  // else's live lease — it does not know about a handover in progress, so a
  // plain claim while one is armed would take the token outright, skipping
  // the code and the verification handshake (see handover.js's header for
  // why this check lives here rather than in the database function). Best
  // effort: a read that fails leaves this exactly as safe, or unsafe, as it
  // was before the check existed.
  const priorState = await sessionState(matchId);
  if (priorState === "handover_pending" || priorState === "verifying") {
    return { ok: false, reason: priorState };
  }

  let claim;
  try {
    claim = await api(`/api/matches/${matchId}/session/claim`, {
      method: "POST", body: { device: deviceId() },
    });
  } catch (e) {
    return { ok: false, reason: e.code || "unreachable" };
  }
  // A refusal here is an authorization answer from the database, not advice.
  // `lease_active` means a colleague is scoring on another device right now —
  // taking the token from them is a handover, not a claim.
  if (!claim?.ok) return { ok: false, reason: claim?.reason || "claim_refused" };

  return attachEngine({ matchId, userId, epoch: claim.epoch, onChange });
}

/**
 * The takeover half of a completed handover reaches here with an epoch it
 * already has — `verifyTakeover`'s own response, the moment the token
 * transferred — and must NOT go back through `startSync`'s plain claim to
 * get it. `scoring_claim()`'s guard only refuses a device that is NOT the
 * current holder; called by the device that just legitimately became the
 * holder, it falls through to its unconditional UPDATE and bumps the epoch
 * again for no reason — a device re-affirming what it already correctly
 * holds should not cost a generation. Found by the handover browser walk:
 * the epoch after a takeover was two ahead of the arm, not one.
 */
export function resumeSync({ matchId, userId, epoch, onChange }) {
  return attachEngine({ matchId, userId, epoch, onChange });
}

function attachEngine({ matchId, userId, epoch, onChange }) {
  const engine = new SyncEngine({
    matchId, deviceId: deviceId(), scorerId: userId, epoch, innings: 0,
    storage: indexedDbStorage({ matchId, deviceId: deviceId() }),
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    transport: (id, batch) => api(`/api/matches/${id}/events`, { method: "POST", body: { events: batch } }),
    onChange,
  });

  // Rehydrate anything a previous session recorded and did not manage to send.
  // This is the reason the outbox is on disk at all: the tab that recorded
  // those balls may have been killed by the OS an hour ago.
  return engine.init().then(({ recovered }) => {
    // Two triggers, because neither is reliable alone. `online` fires the
    // moment the OS thinks there is a network, which is often before there
    // actually is one; the timer covers the case where it lies, and the case
    // where the connection came back without an event.
    const onOnline = () => { engine.sync().catch(() => {}); };
    if (typeof window !== "undefined") window.addEventListener("online", onOnline);
    const timer = setInterval(() => {
      if (engine.pendingCount) engine.sync().catch(() => {});
    }, RETRY_MS);

    return {
      ok: true,
      epoch,
      recovered,
      engine,
      /** Queue one scoring event. Resolves as soon as it is DURABLE, not sent. */
      record: (event) => engine.record(event),
      /** Which event ids the server has confirmed — the undo boundary reads this. */
      syncedIds: () => new Set(engine.acked.map((e) => e.idempotencyKey)),
      pending: () => engine.pendingCount,
      /** Handover is only safe with an empty outbox (§ the handover spec). */
      safeToHandOver: () => engine.safeToHandOver,
      flush: () => engine.sync(),
      stop() {
        clearInterval(timer);
        if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
      },
    };
  });
}
