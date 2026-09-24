import { useState } from "react";
import {
  heldInOrder, heldFrom, describeHeld, describeEvent, recordAgain, recordAgainRefusal, reasonWords,
} from "@scrbrd/sync";
import { D } from "../design/tokens.js";
import { Btn, Lbl, Sheet } from "./ui.jsx";

/**
 * The events the server would not write, and what to do about each. SCRBRD-070.
 *
 * Opened from the "Refused N" pill and from the handover sheet's warning.
 * Everything it says and every choice it offers comes from
 * packages/sync/src/held.mjs (the words, the scope of a cascade, whether
 * recording again would be accepted); this file only lays it out and asks
 * before anything leaves the device. Why the choices are these two, and why
 * nothing is ever resent on its own, is written up at the top of held.mjs.
 *
 * Both actions are the scorer's own device's business: a held event is on
 * this device only (the server wrote nothing), so discarding it needs no
 * permission beyond holding the phone, and recording again goes through the
 * outbox, where the server's lease and capability checks apply as they do to
 * any tap. `live` is false when there is no outbox (handed over, or never
 * claimed) — then there is nowhere to record again to.
 */
/** Refusals the scorer can put right on the pad before recording again. */
const FIXABLE = { next_bowler: "the bowler", opening_bowler: "the bowler", next_batter: "the next batter", openers: "the openers" };

export function HeldSheet({ held = [], events, innings, live, onDiscard, onRecordAgain, onClose }) {
  // A destructive choice is asked twice: which events, then "yes".
  const [confirm, setConfirm] = useState(null); // { keys, label }
  const [busy, setBusy] = useState(false);
  const ordered = heldInOrder(held);

  const act = async (fn, keys) => {
    setBusy(true);
    try { await fn(keys); } finally { setBusy(false); setConfirm(null); }
  };

  return (
    <Sheet title={`Refused by the server${ordered.length ? ` · ${ordered.length}` : ""}`} accent={D.rose} onClose={onClose}>
      <div data-testid="held-sheet" style={{paddingTop:"12px",display:"flex",flexDirection:"column",gap:"12px"}}>
        {ordered.length===0 ? (
          <div data-testid="held-empty" style={{color:D.textSecondary,fontFamily:D.body,fontSize:"13px",lineHeight:1.6,padding:"12px 2px"}}>
            Nothing is held. This device's board and the server's log agree.
          </div>
        ) : (
          <div style={{color:D.textSecondary,fontFamily:D.body,fontSize:"12.5px",lineHeight:1.6}}>
            The server did not write these, so it does not have them — but this board still counts them, and the two
            disagree until each one is resolved. <strong style={{color:D.textPrimary}}>Discard</strong> takes an event
            off this board. <strong style={{color:D.textPrimary}}>Record again</strong> sends it as a new event after
            everything recorded since, where the server judges it afresh; it is offered only when it would be accepted.
            Nothing here is sent or removed until you choose.
          </div>
        )}

        {ordered.map((h, i) => {
          const d = describeHeld(h, events, innings);
          const after = heldFrom(held, h.idempotencyKey).slice(1);
          const scope = [h, ...after];
          const keys = scope.map((x) => x.idempotencyKey);
          const refused = h.state === "refused";
          // Would the server take it, recorded again now? Asked of the same
          // Laws the server asks, against the log as the server holds it.
          const oneWhy = live && refused && d.onBoard ? recordAgainRefusal(events, held, [h]) : null;
          const canOne = live && refused && d.onBoard && !oneWhy;
          const canAll = canOne && after.length > 0 && !recordAgainRefusal(events, held, scope);
          const preview = canOne ? recordAgain(events, held, [h], () => "preview").copies[0] : null;
          const when = h.payload?.clientTs ?? h.clientTs;
          const armed = confirm && confirm.keys[0] === h.idempotencyKey ? confirm : null;

          return (
            <div key={h.idempotencyKey} data-testid="held-item" data-held-key={h.idempotencyKey}
              style={{background:D.surf2,border:`1px solid ${refused?D.rose+"44":D.amber+"55"}`,borderRadius:D.md,padding:"12px 14px",
                display:"flex",flexDirection:"column",gap:"6px"}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:"10px",alignItems:"baseline"}}>
                <div data-testid="held-what" style={{fontFamily:D.body,fontSize:"13.5px",fontWeight:600,color:D.textPrimary}}>{d.what}</div>
                <Lbl sx={{flexShrink:0}}>{refused?"Refused":"Conflict"}{when?` · ${new Date(when).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`:""}</Lbl>
              </div>
              <div data-testid="held-why" style={{fontFamily:D.body,fontSize:"12.5px",color:D.roseText,lineHeight:1.5}}>{d.why}</div>
              {!d.onBoard&&(
                <div style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted}}>
                  It is no longer on this board (it was undone), so discarding it changes nothing you can see.
                </div>
              )}
              {refused&&d.onBoard&&live&&oneWhy&&(
                <div data-testid="held-cannot-resend" style={{fontFamily:D.body,fontSize:"12px",color:D.textMuted,lineHeight:1.5}}>
                  Recording it again would be refused too: {reasonWords(oneWhy.reason)}.
                  {FIXABLE[oneWhy.reason]?` Name ${FIXABLE[oneWhy.reason]} on the pad first, then record it again — or discard it.`:""}
                </div>
              )}
              {preview&&(
                <div style={{fontFamily:D.body,fontSize:"12px",color:D.textSecondary}}>
                  Recorded again it would be: <span style={{color:D.textPrimary}}>{describeEvent(preview, innings?.[preview.innings ?? 0])}</span>
                </div>
              )}

              {armed ? (
                <div data-testid="held-confirm" style={{display:"flex",flexDirection:"column",gap:"8px",marginTop:"4px"}}>
                  <div style={{fontFamily:D.body,fontSize:"12.5px",color:D.textPrimary}}>{armed.label}</div>
                  <div style={{display:"flex",gap:"8px"}}>
                    <Btn variant="ghost" size="sm" disabled={busy} onClick={()=>setConfirm(null)}>Keep</Btn>
                    <Btn variant={armed.kind==="discard"?"danger":"primary"} size="sm" disabled={busy} data-testid="held-confirm-yes"
                      onClick={()=>act(armed.kind==="discard"?onDiscard:onRecordAgain, armed.keys)}>
                      {armed.kind==="discard"
                        ? `Yes, discard ${armed.keys.length===1?"it":armed.keys.length}`
                        : `Yes, record ${armed.keys.length===1?"it":armed.keys.length} again`}
                    </Btn>
                  </div>
                </div>
              ) : (
                <div style={{display:"flex",flexWrap:"wrap",gap:"8px",marginTop:"4px"}}>
                  <Btn variant="ghost" size="sm" disabled={busy} data-testid={`held-discard-${i}`}
                    onClick={()=>setConfirm({kind:"discard",keys:[h.idempotencyKey],
                      label:`Take "${d.what}" off this board for good? The server never had it.`})}>
                    Discard
                  </Btn>
                  {after.length>0&&(
                    <Btn variant="ghost" size="sm" disabled={busy} data-testid={`held-discard-from-${i}`}
                      onClick={()=>setConfirm({kind:"discard",keys,
                        label:`Take this and the ${after.length} held after it off this board for good? `+
                              `The server has none of them. They are: ${scope.map((x)=>describeHeld(x, events, innings).what).join("; ")}.`})}>
                      Discard this and the {after.length} after it
                    </Btn>
                  )}
                  {canOne&&(
                    <Btn variant="s4" size="sm" disabled={busy} data-testid={`held-resend-${i}`}
                      onClick={()=>setConfirm({kind:"resend",keys:[h.idempotencyKey],
                        label:`Record "${describeEvent(preview, innings?.[preview.innings ?? 0])}" again, as the next event on this board?`})}>
                      Record again
                    </Btn>
                  )}
                  {canAll&&(
                    <Btn variant="s4" size="sm" disabled={busy} data-testid={`held-resend-from-${i}`}
                      onClick={()=>setConfirm({kind:"resend",keys,
                        label:`Record this and the ${after.length} held after it again, in order, as the next events on this board?`})}>
                      Record this and the {after.length} after it again
                    </Btn>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
