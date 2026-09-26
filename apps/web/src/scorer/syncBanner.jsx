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
export function SyncBanner({ status, match, asideCount = 0, onSignIn, onRetry, onScoreHere, onTakeOver }) {
  const say = bannerFor(status, match, asideCount);
  if (!say) return null;
  const action = say.action === "signin" && onSignIn ? { label: "Sign in", testid: "sync-signin", on: onSignIn }
    : say.action === "retry" && onRetry ? { label: "Try again", testid: "sync-retry", on: onRetry }
    : say.action === "scorehere" && onScoreHere ? { label: "Score on this device", testid: "sync-score-here", on: onScoreHere }
    : say.action === "takeover" && onTakeOver ? { label: "Take over", testid: "sync-takeover", on: onTakeOver }
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
      {action&&(
        <button onClick={action.on} className="pressBtn" data-testid={action.testid}
          style={{flexShrink:0,minHeight:"40px",padding:"8px 16px",borderRadius:D.pill,cursor:"pointer",
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
 * @returns {{reason: string, tone: "wait"|"stop"|"note", lead?: string, text: string, action?: string} | null}
 */
export function bannerFor(st, match, asideCount = 0) {
  if (!st?.open) return null;
  const waiting = st.pendingList?.length ? waitingPhrase(st.pendingList) : null;
  const one = st.pendingList?.length === 1;
  const saved = waiting ? `${waiting} ${one ? "is" : "are"} saved on this device` : null;
  const home = match?.team1 ?? "the home side", away = match?.team2 ?? "the away side";
  const conflict = st.conflict;
  const reason = st.reason;

  if (reason === "not_signed_in" || reason === "session_expired") {
    const lead = reason === "session_expired" ? "Your session has ended." : "Signed out.";
    if (!st.online) return { reason, tone: "wait", lead: `No signal, and ${reason === "session_expired" ? "your session has ended" : "signed out"}.`,
      text: saved ? `${saved}; sign in when there is signal to send ${one ? "it" : "them"}.` : "Scoring here is saved on this device; sign in when there is signal to send it." };
    return { reason, tone: "wait", lead, action: "signin",
      text: waiting ? `Sign in to send ${waiting} — ${one ? "it is" : "they are"} saved on this device.` : "Sign in to send what is scored here — it is saved on this device until then." };
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
    case "match_complete": case "no_capability":
      return { reason, tone: "stop", lead: refusalWords(reason), text: saved ? `${saved}.` : "" };
    case "fork": {
      const r = st.reconcile;
      return { reason, tone: "stop", lead: "This match was scored on another device while this one was not sending.",
        text: `The server has ${r?.extra?.length ?? "some"} event${r?.extra?.length === 1 ? "" : "s"} this device does not, and this device has ${r?.mine?.length ?? "some"} the server does not. Nothing is merged and nothing more is sent from here: both logs are kept for a person to reconcile.` };
    }
    case "moved_on":
      return { reason, tone: "stop", lead: "Another device has scored this match since this one last held it.", action: "scorehere",
        text: `This pad shows the server's log${saved ? `; ${saved}` : ""}.` };
    case "handed_over":
      return { reason, tone: "note", lead: "You handed this match over.", text: saved ? `Nothing recorded here is sent; ${saved}.` : "Nothing recorded here is sent." };
    case "token_moved":
      return { reason, tone: "stop", lead: "Another device has taken over scoring this match.", text: saved ? `Nothing more is sent from here; ${saved}.` : "Nothing more is sent from here." };
    case null: case undefined:
      return null;
    default:
      return { reason, tone: "stop", lead: refusalWords(reason), text: saved ? `${saved}.` : "" };
  }
}
