import { D, inkOn } from "../design/tokens.js";
import { refusalWords } from "../lib/handover.js";
import { waitingPhrase, tossLine } from "@scrbrd/sync";

/**
 * What the pad of a live match says about the server, in words. SCRBRD-078.
 *
 * The pill in the top bar is a word and a count ("Held 3"). That is enough
 * while the pad is sending; it is not enough when it CANNOT send and a person
 * has to do something about it — sign in again, move to signal, take over
 * with a code, or know that two logs have come apart. Every one of those used
 * to be "On device" with the reason in a tooltip, or nothing at all. Each now
 * gets a sentence, and the one action that answers it.
 *
 * The rule under all of them: everything the scorer records is on this
 * device, on disk, until the server has it, and the banner says how much is
 * waiting. Nothing here ever offers a way round the server — no demo, no
 * "continue anyway" that would send something the server has not agreed to.
 */
export function SyncBanner({ status, match, asideCount = 0, extra, onSignIn, onRetry, onScoreHere, onTakeOver,
                            onConfirmTakeOver, onSettleFork, onReview, onDismissNote }) {
  const say = bannerFor(status, match, asideCount, extra);
  if (!say) return null;
  const action = say.action === "signin" && onSignIn ? { label: "Sign in", testid: "sync-signin", on: onSignIn }
    : say.action === "retry" && onRetry ? { label: "Try again", testid: "sync-retry", on: onRetry }
    : say.action === "scorehere" && onScoreHere ? { label: "Score on this device", testid: "sync-score-here", on: onScoreHere }
    : say.action === "takeover" && onTakeOver ? { label: "Take over", testid: "sync-takeover", on: onTakeOver }
    // B1 (db/126): the confirmed take-over over another phone's lapsed lease.
    : say.action === "confirmtakeover" && onConfirmTakeOver ? { label: "Take over scoring", testid: "sync-confirm-takeover", on: onConfirmTakeOver }
    // P5: a fork's balls to the lead's review; P7: a finished match's.
    : say.action === "settlefork" && onSettleFork ? { label: "Send them to the lead", testid: "sync-settle-fork", on: onSettleFork }
    : say.action === "review" && onReview ? { label: "Send for review", testid: "sync-review", on: onReview }
    // P4: the incoming scorer has checked the server's last ball.
    : say.action === "checked" && onDismissNote ? { label: "Checked", testid: "sync-note-checked", on: onDismissNote }
    : null;
  const tone = say.tone === "stop" ? D.rose : say.tone === "note" ? D.sky : D.amber;
  return (
    <div role="status" aria-live="polite" data-testid="sync-banner" data-reason={say.reason}
      style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"10px 14px",
        marginBottom:"12px",padding:"12px 14px",borderRadius:"12px",
        background:`${tone}12`,border:`1px solid ${tone}55`}}>
      <div style={{flex:"1 1 240px",minWidth:0,fontFamily:D.body,fontSize:"13.5px",lineHeight:1.45,color:D.textPrimary}}>
        {say.lead&&<strong>{say.lead} </strong>}{say.text}
      </div>
      {/* The balls this phone keeps, each in words (P5): what the scorer
          shows the lead, without scrolling the history to compare by hand. */}
      {say.list?.length>0&&(
        <ol data-testid="sync-banner-list" aria-label="Kept on this phone"
          style={{flex:"1 1 100%",order:3,margin:0,padding:"8px 12px 8px 30px",maxHeight:"168px",overflowY:"auto",
            borderRadius:"8px",background:`${tone}0d`,fontFamily:D.body,fontSize:"13px",lineHeight:1.45,color:D.textPrimary}}>
          {say.list.map((line,i)=><li key={i}>{line}</li>)}
        </ol>
      )}
      {action&&(
        <button onClick={action.on} className="pressBtn" data-testid={action.testid}
          style={{flexShrink:0,minHeight:"44px",padding:"8px 16px",borderRadius:D.pill,cursor:"pointer",
            border:"none",background:tone,color:inkOn(tone),
            fontFamily:D.head,fontSize:"13px",fontWeight:700,letterSpacing:"0.02em"}}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * The sentence for a pad's sync status, or null when there is nothing to
 * say (attached and sending). Pure, so the words are tested without a DOM.
 * @param {any} st   PadSync's status()
 * @param {any} [match]  the fixture, for the sides' names
 * @param {number} [asideCount]
 * @param {{describe?: (ev: any) => string, find?: (id: string) => any, score?: string|null}} [extra]
 *        the pad's words for an event (describeEvent with the innings' names), a lookup of
 *        one of its events by id, and the board when a take-over note appeared
 * @returns {{reason: string, tone: "wait"|"stop"|"note", lead?: string, text: string, action?: string, list?: string[]} | null}
 */
/** Why the pad's resume credential ended, as the server said (db/50 revoked_reason). */
const PAD_END_WORDS = {
  expired: "This phone kept scoring by itself until midnight on the match day.",
  token_moved: "Another device holds this match now.",
  released: "A supervisor released this match from this phone.",
  match_complete: "The match is over.",
  match_abandoned: "The match was abandoned.",
  signed_out: "This phone was signed out.",
  office: "The school office ended it.",
  reissued: "A newer one replaced it.",
  pad_unknown: "The server does not know this phone's sign-in.",
  pad_bad_signature: "The server does not recognise this phone's key.",
};

/** A server time as the scorer's clock reads it: "14:21". @param {string|null|undefined} at */
export function clockOf(at) {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  try { return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }); }
  catch { return d.toISOString().slice(11, 16); }
}

/** Why a send for review did not go, in words. @param {string} why */
const reviewWords = (why) => why === "unreachable" || why === "server_error" ? "no signal to the server; try again"
  : why === "pad_ended" || why === "session_expired" ? "sign in first"
  : why === "not_all_sent" ? "the server took some and not others; try again"
  : why === "busy" ? "a ball was recorded meanwhile; try again"
  : "try again";

export function bannerFor(st, match, asideCount = 0, extra = {}) {
  // The outbox could not open (P6): nothing is queued or sent from this
  // phone, and it used to say nothing at all.
  if (!st?.open) return st?.outboxUnavailable ? { reason: "outbox_unavailable", tone: "stop",
    lead: "This phone cannot queue balls to send (a storage fault).",
    text: "What you score stays on this phone's scoreboard, but none of it can reach the server from here. Score on the other phone, and tell the lead." } : null;
  const waiting = st.pendingList?.length ? waitingPhrase(st.pendingList) : null;
  const one = st.pendingList?.length === 1;
  const saved = waiting ? `${waiting} ${one ? "is" : "are"} saved on this device` : null;
  const home = match?.team1 ?? "the home side", away = match?.team2 ?? "the away side";
  const conflict = st.conflict;
  const reason = st.reason;
  const describe = extra?.describe ?? ((/** @type {any} */ ev) => ev?.kind ?? "event");
  // What is queued here, one line each (P5).
  const pendingLines = (st.pendingList ?? []).map((/** @type {any} */ e) => describe(e.payload ?? e));
  const lastAt = clockOf(st.heldElsewhere?.at ?? st.serverLast?.at);

  // The pad's resume credential has ended (SCRBRD-078 option B): midnight,
  // the token moved, the match over, a sign-out or the office. Only a
  // sign-in goes on from here, and the pad says which of those it was.
  if (reason === "pad_ended") {
    const why = PAD_END_WORDS[st.padEnd] ?? PAD_END_WORDS.expired;
    return { reason, tone: "stop", lead: "Scoring ended for today on this phone — sign in to continue.",
      ...(st.online ? { action: "signin" } : {}),
      text: `${why}${saved ? ` ${saved[0].toUpperCase()}${saved.slice(1)}.` : ""}` };
  }
  if (reason === "not_signed_in" || reason === "session_expired") {
    const lead = reason === "session_expired" ? "Your session has ended." : "Signed out.";
    // Without a secure context (a laptop serving the pad over plain http)
    // there is no resume credential, so every reload asks for a sign-in.
    const insecure = st.padResume === "unavailable"
      ? " This connection is not secure (plain http), so the pad cannot keep scoring by itself after a reload: sign in each time." : "";
    if (!st.online) return { reason, tone: "wait", lead: `No signal, and ${reason === "session_expired" ? "your session has ended" : "signed out"}.`,
      text: (saved ? `${saved}; sign in when there is signal to send ${one ? "it" : "them"}.` : "Scoring here is saved on this device; sign in when there is signal to send it.") + insecure };
    return { reason, tone: "wait", lead, action: "signin",
      text: (waiting ? `Sign in to send ${waiting} — ${one ? "it is" : "they are"} saved on this device.` : "Sign in to send what is scored here — it is saved on this device until then.") + insecure };
  }
  if (reason === "toss_needs_sign_in") {
    return { reason, tone: "wait", lead: "Sign in to send the toss.", ...(st.online ? { action: "signin" } : {}),
      text: `The server has no toss for this match yet, and nothing is sent before it${saved ? `; ${saved}` : ""}.` };
  }
  if (reason === "toss_conflict" || reason === "toss_locked") {
    const mine = tossLine(conflict?.mine, home, away);
    const theirs = conflict?.server ? tossLine(conflict.server, home, away) : null;
    return { reason, tone: "stop", lead: "The toss does not agree with the server's.",
      text: reason === "toss_locked"
        ? `This pad recorded: ${mine}. The server has play for this match and no toss, so it will not take one now. Nothing more is sent from this device until a person settles the toss${saved ? `; ${saved}` : ""}.`
        : `The server has: ${theirs}. This pad recorded: ${mine}, and ${conflict?.serverHasEvents ? "the server's is fixed now play has started there" : "has play recorded under it"}. Nothing more is sent from this device until a person settles which is right${saved ? `; ${saved}` : ""}.` };
  }
  if (st.attached) {
    if (st.rejected) return { reason: "quarantined", tone: "stop", lead: `${st.rejected} event${st.rejected === 1 ? " was" : "s were"} held by the server for review.`,
      text: "They were sent under a token this device no longer held, so they are not in the scorebook. A supervisor decides on each." };
    // P4: the incoming scorer, after a take-over or a released phone, is
    // told how far the server got before the next ball.
    if (st.takeoverNote) {
      const at = clockOf(st.takeoverNote.at);
      return { reason: "takeover_note", tone: "note", lead: "You are scoring this match now.", action: "checked",
        text: `The server's last ball came in at ${at ?? "an unknown time"}${extra?.score ? `, with the board at ${extra.score}` : ""}. Check that against the scoreboard and the book before the next ball: any ball the server is missing is typed in first, in order.` };
    }
    if (conflict?.reason === "toss_followed") return { reason: "toss_followed", tone: "note",
      lead: "The server already had a toss.", text: `${tossLine(conflict.server, home, away)}. This pad now follows it; its own answer (${tossLine(conflict.mine, home, away)}) was not sent.` };
    if (asideCount) return { reason: "aside", tone: "note", lead: "You are scoring on the server's log.",
      text: `${asideCount} event${asideCount === 1 ? "" : "s"} this device had that the server did not ${asideCount === 1 ? "is" : "are"} kept aside on this device, not in this log.` };
    return null;
  }
  switch (reason) {
    case "offline":
      return { reason, tone: "wait", lead: "No signal.", text: saved ? `${saved} and will send when there is a connection.` : "Scoring is saved on this device and will send when there is a connection." };
    case "attaching":
      return { reason, tone: "wait", text: "Connecting to the server…" };
    case "unreachable": case "server_error": case "busy":
      return { reason, tone: "wait", lead: "Could not reach the server — trying again.", text: saved ? `${saved}.` : "Scoring is saved on this device meanwhile." };
    case "lease_active":
      return { reason, tone: "stop", lead: refusalWords("lease_active"), action: "retry", text: saved ? `Nothing is sent from this device; ${saved}.` : "Nothing is sent from this device while they are." };
    case "handover_pending":
      return { reason, tone: "stop", lead: refusalWords("handover_pending"), action: "takeover", text: "Scoring here waits until you have taken over." };
    case "verifying":
      return { reason, tone: "stop", lead: refusalWords("verifying"), text: "Scoring here waits until it is settled." };
    case "match_complete": {
      // P7: a result declared while this phone had balls to send. They go to
      // the lead's review (quarantine), never into the finished scorebook.
      const n = st.pendingList?.length ?? 0;
      if (!n) return { reason, tone: "stop", lead: refusalWords(reason), text: "" };
      return { reason, tone: "stop", lead: refusalWords(reason), list: pendingLines,
        ...(st.reviewing ? {} : { action: "review" }),
        text: st.reviewing ? `Sending ${waiting} to the lead for review…`
          : `${waiting} ${one ? "was" : "were"} never sent before the result was recorded (listed below). ${one ? "It goes" : "They go"} to the lead for review, not into the scorebook${st.reviewError ? `; not sent yet (${reviewWords(st.reviewError)})` : ""}.` };
    }
    case "no_capability":
      return { reason, tone: "stop", lead: refusalWords(reason), text: saved ? `${saved}.` : "" };
    case "fork": {
      const r = st.reconcile;
      // P5: the balls this phone has and the server lacks, in words, and
      // written aside on this phone for the lead (Kameel, 30 Oct 2026).
      const find = extra?.find ?? (() => null);
      const list = (r?.mine ?? []).map((/** @type {string} */ id) => { const ev = find(id); return ev ? describe(ev) : "An event this phone recorded"; });
      return { reason, tone: "stop", lead: "This match was scored on another device while this one was not sending.", list, action: "settlefork",
        text: `The server has ${r?.extra?.length ?? "some"} event${r?.extra?.length === 1 ? "" : "s"} this device does not, and this device has ${r?.mine?.length ?? "some"} the server does not (listed below, and written aside on this phone). Nothing is merged. Send them to the lead: they go to review, not into the scorebook, and this phone then shows the server's log${st.reviewError ? `. Not sent yet (${reviewWords(st.reviewError)})` : ""}.` };
    }
    case "fork_settling":
      return { reason, tone: "wait", text: "Sending this phone's balls to the lead for review…" };
    // B1 (db/126): another phone held this match and its lease lapsed. Taking
    // it is a person's confirmed act, shown the server's last ball first.
    case "held_elsewhere":
      return { reason, tone: "stop", lead: "Another phone was scoring this match.", action: "confirmtakeover",
        text: `${lastAt ? `The server's last ball from it came in at ${lastAt}.` : "The server has no ball from it yet."} If that phone has stopped (a flat battery, a crash), take over here; if it is still scoring, leave it: one phone scores a match. Check the scoreboard and the book first${saved ? `; ${saved}` : ""}.` };
    case "epoch_moved":
      return { reason, tone: "stop", lead: "Somebody else took this match while you were deciding.", action: "retry",
        text: "Nothing was taken. Try again to see who holds it now." };
    case "moved_on":
      return { reason, tone: "stop", lead: "Another device has scored this match since this one last held it.", action: "scorehere",
        text: `This pad shows the server's log${saved ? `; ${saved}` : ""}.` };
    case "handed_over":
      return { reason, tone: "note", lead: "You handed this match over.", text: saved ? `Nothing recorded here is sent; ${saved}.` : "Nothing recorded here is sent." };
    case "token_moved":
      // B1/P5: the way back, and the balls kept here, listed.
      return { reason, tone: "stop", lead: "Another device has taken over scoring this match.", action: "scorehere", list: pendingLines,
        text: `${saved ? `Nothing more is sent from here; ${saved}${one ? " (below)" : " (listed below)"}.` : "Nothing more is sent from here."} The other phone must stop first; then press Score on this device.` };
    case null: case undefined:
      return null;
    default:
      return { reason, tone: "stop", lead: refusalWords(reason), text: saved ? `${saved}.` : "" };
  }
}
