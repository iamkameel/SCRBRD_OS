/**
 * Another phone holds the match (redesign slice 13; DESIGN_DIRECTION §3.4
 * Flow E, and §2.2's line for a scorer: "A Wessels is scoring on another
 * phone").
 *
 * WHAT IT DECIDES: whether the pad opens on one screen that says who is
 * scoring, with "Enter the handover code" and "Watch the score", in place of
 * the toss sheet and the pad; and the words for that screen and for Today's
 * card. It decides nothing about the scoring itself: the claim, the lease,
 * the handover code and the sync are packages/sync, lib/sync.js and the
 * server's, unchanged. This only reads what they already say.
 *
 * WHAT IT READS, AND NOTHING ELSE:
 *   - the `scoring` row of the match_duties read (services/api/read/read-api.mjs,
 *     session_read under fixture.read): the session's `state`, `held` (whose
 *     the token is, worked out by the server against the caller's own token:
 *     this_device, you, another, lapsed) and `who`, the holder's name as the
 *     server returns it. The office's roster and Today already make this read.
 *     The server decides the name (read-api.mjs SCORER_NAME): none for a
 *     reader outside the holder's school, a pupil in initials, an adult in
 *     full. No name is "Someone else" here; this file never shortens one.
 *   - the pad's own sync status (lib/sync.js PadSync status()): whether it is
 *     attached, why not, and what is waiting on this phone.
 *
 * WHEN THE SCREEN SHOWS. Only on a pad opened fresh on this phone (nothing of
 * this match saved here) that has not held the token since it opened, not
 * attached, with nothing waiting to send or held:
 * a phone with balls of its own keeps the pad and the banner that lists them
 * (syncBanner.jsx). And only while what it knows says another phone holds the
 * scoring: the claim was refused as `lease_active`, `handover_pending` or
 * `verifying`, or, before the claim has answered, the read says so.
 *
 * A LAPSED HOLD (Kameel, 25 Nov 2026, question 2 of slice 13): the claim was
 * refused as `held_elsewhere` (the other phone's lease ran out, db/126), or,
 * before the claim has answered, the read says `lapsed`. The same screen,
 * saying the other phone has gone quiet, with "Take over scoring" as its
 * primary: the existing confirmed take-over (PadSync attach("takeover")),
 * unchanged. The screen only replaces the toss sheet and the keys.
 *
 * PURE. No React, no DOM, no fetch. apps/web/test/other-phone.test.mjs holds it.
 */

/** The claim's refusals that mean another phone holds, or is handing over, the scoring. */
export const HELD_REASONS = Object.freeze(new Set(["lease_active", "handover_pending", "verifying"]));

/** The claim's refusal for a hold whose lease ran out: the confirmed take-over (db/126). */
export const LAPSED_REASON = "held_elsewhere";

/** Where the pad stands while it has no answer yet: still asking, or with no way to ask. */
const NO_ANSWER = new Set([null, undefined, "attaching", "offline", "unreachable", "server_error", "busy"]);

/**
 * The scoring row of a match_duties read, or null.
 * @param {any[] | null | undefined} rows
 * @returns {{state: string | null, held: string | null, who: string | null} | null}
 */
export function holderOf(rows) {
  const r = (rows ?? []).find((x) => x?.duty === "scoring");
  if (!r) return null;
  const who = typeof r.who === "string" && r.who.trim() ? r.who.trim() : null;
  return { state: r.state ?? null, held: r.held ?? null, who };
}

/**
 * Does the read say another phone holds this match's scoring, or is handing
 * it over? Not this device's own token, not a lapsed lease, not an idle one.
 * @param {{state?: string | null, held?: string | null} | null | undefined} h
 */
export function heldByAnother(h) {
  if (!h || h.held === "this_device") return false;
  if (h.state === "handover_pending" || h.state === "verifying") return true;
  return h.state === "active" && (h.held === "another" || h.held === "you");
}

/**
 * Does the pad open on the other-phone screen?
 * @param {{fresh: boolean, holder?: any, status?: any}} a
 *   fresh   nothing of this match was saved on this phone when the pad opened, and it has not held the token since
 *   holder  holderOf() the match_duties read, or null (not read, or no answer)
 *   status  the pad's sync status, or null before the outbox has said anything
 */
export function showOtherPhone({ fresh, holder = null, status = null }) {
  if (!fresh) return false;
  if (status?.attached) return false;
  if ((status?.pending ?? 0) > 0 || (status?.held ?? 0) > 0) return false;
  const reason = status?.reason ?? null;
  if (HELD_REASONS.has(reason) || reason === LAPSED_REASON) return true;
  return NO_ANSWER.has(reason) && (heldByAnother(holder) || lapsedHold(holder));
}

/**
 * Does the read say a phone held this match and its lease has run out?
 * @param {{state?: string | null, held?: string | null} | null | undefined} h
 */
export function lapsedHold(h) {
  return !!h && h.state === "active" && h.held === "lapsed";
}

/**
 * Which of the four it is: another person's phone, your own other phone, a
 * handover waiting for its code, or one being confirmed.
 * @param {any} holder  @param {string | null | undefined} reason
 * @returns {"another" | "you" | "handover" | "verifying" | "lapsed"}
 */
export function kindOf(holder, reason) {
  const st = holder?.state ?? null;
  if (reason === LAPSED_REASON || (lapsedHold(holder) && !HELD_REASONS.has(reason))) return "lapsed";
  if (reason === "verifying" || (st === "verifying" && !HELD_REASONS.has(reason))) return "verifying";
  if (reason === "handover_pending" || (st === "handover_pending" && !HELD_REASONS.has(reason))) return "handover";
  return holder?.held === "you" ? "you" : "another";
}

/**
 * The screen's words. A name only where the read gave one for the phone that
 * holds it now; otherwise the sentence says "Someone else", never a guess.
 * @param {any} holder  @param {string | null | undefined} reason
 * @param {string | null} [lastAt]  the server's last ball, "14:21" (a lapsed hold only: what the take-over is confirmed against)
 * @returns {{kind: string, lead: string, body: string, line: string}}
 *   lead  the screen's heading;  body  what to do;  line  Today's one line (§2.2)
 */
export function otherPhoneWords(holder, reason, lastAt = null) {
  const kind = kindOf(holder, reason);
  // The banner's own words for the confirmed take-over (syncBanner.jsx held_elsewhere), under Kameel's heading.
  if (kind === "lapsed") return { kind,
    lead: "Nobody has scored on the other phone for a while.",
    body: `${lastAt ? `The server's last ball from it came in at ${lastAt}.` : "The server has no ball from it yet."} If that phone has stopped (a flat battery, a crash), take over here; if it is still scoring, leave it: one phone scores a match. Check the scoreboard and the book first.`,
    line: "Nobody has scored on the other phone for a while" };
  const who = heldByAnother(holder) && holder?.held !== "you" ? holder?.who ?? null : null;
  if (kind === "verifying") return { kind,
    lead: "A handover of this match is being confirmed on another phone.",
    body: "If the code was given to you, enter it again here. Otherwise watch the score until it is done.",
    line: "A handover is being confirmed on another phone" };
  if (kind === "handover") return { kind,
    lead: who ? `${who} is handing this match over.` : "A handover of this match is waiting.",
    body: "Enter the six-digit code from their screen to score here.",
    line: who ? `${who} is handing over · enter the code on the pad` : "A handover is waiting · enter the code on the pad" };
  if (kind === "you") return { kind,
    lead: "You're scoring this match on your other phone.",
    body: "One phone scores a match. To score on this one, tap Hand over on the other phone, then enter its six-digit code here.",
    line: "You're scoring on your other phone" };
  return { kind,
    lead: who ? `${who} is scoring this match on another phone.` : "Someone else is scoring this match on another phone.",
    body: "One phone scores a match. To score here, ask them to hand over: they tap Hand over and give you a six-digit code.",
    line: who ? `${who} is scoring on another phone` : "Someone else is scoring on another phone" };
}

/**
 * Today's line for a fixture another phone holds (§2.2: it replaces line 4),
 * from fixtureState()'s state and the read's row; null for any other state.
 * @param {string} state  lib/scorerHome.js fixtureState()
 * @param {any} holder  holderOf() the fixture's match_duties rows
 */
export function todayLine(state, holder) {
  if (state === "held_other") return otherPhoneWords({ ...(holder ?? {}), state: "active", held: "another" }, null).line;
  if (state === "held_you") return otherPhoneWords({ state: "active", held: "you" }, null).line;
  if (state === "handover") return otherPhoneWords(holder ?? { state: "handover_pending" }, null).line;
  return null;
}

/** Said under the buttons: what to do if the other phone has died, which only a lapsed lease shows (db/126). */
export const CHECK_AGAIN_WORDS = "If that phone has stopped (a flat battery, a crash), wait a minute and a half, then check again.";
