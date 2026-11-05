import { secondAccountWords, penStandsLine, penStandsWords } from "@scrbrd/sync";
import { D, T } from "../design/tokens.js";
import { Btn, Sheet } from "./ui.jsx";
import { reviewWords } from "./syncBanner.jsx";

/**
 * Two phones scoring one match: each scorer is told, in a sheet
 * (docs/design/TWO_PHONES.md R3, slice 1; Kameel, 5 Nov 2026).
 *
 * The pen's book is the match's; the other phone's is a second scorer's,
 * kept whole and set aside on the server for review, never merged (R1). The
 * second scorer must know his afternoon's work is safe and not in the score,
 * or he will enter it again; the pen-holder must know his scoring stands.
 * The words are packages/sync/src/second-account.mjs's, in the pad's own
 * voice, with no person and no child named.
 *
 * A sheet, not a toast (R3): it stays until the scorer says Done. Its text is
 * 13px and up, every button is 44px or taller (Btn, Sheet's close), its
 * motion is the Sheet's, which the global prefers-reduced-motion rule stills
 * (design/tokens.js), and nothing is said by colour alone: every state is in
 * words ("Sending…", "Not sent yet").
 */

/**
 * The second phone's sheet: at reconnect, after a fork or balls set aside.
 * @param {object} p
 * @param {any[]} p.items  this phone's events not in the match record (the pad's events, or outbox entries)
 * @param {boolean} p.sent      already with the server (set aside), so nothing to send
 * @param {boolean} p.sending   on their way now
 * @param {string|null} [p.error]  why the last send did not go (PadSync's reviewError)
 * @param {() => void} p.onSend
 * @param {() => void} p.onDone
 */
export function SecondAccountSheet({ items, sent, sending, error, onSend, onDone }) {
  const w = secondAccountWords(items);
  return (
    <Sheet title={w.lead} accent={D.sky} onClose={onDone}>
      <div data-testid="second-account-sheet" data-count={w.balls} data-sent={sent ? "yes" : "no"}
        style={{paddingTop:"12px",display:"flex",flexDirection:"column",gap:"16px"}}>
        <p data-testid="second-account-text" style={{margin:0,fontFamily:D.body,fontSize:"15px",lineHeight:1.55,color:D.textPrimary}}>
          {w.text}
        </p>
        {!sent&&error&&(
          <p role="alert" style={{margin:0,fontFamily:D.body,fontSize:"13px",lineHeight:1.5,color:D.textPrimary}}>
            <strong>Not sent yet</strong> ({reviewWords(error)}).
          </p>
        )}
        <div style={{display:"flex",flexWrap:"wrap",gap:"10px",justifyContent:"flex-end"}}>
          {!sent&&(
            <Btn onClick={onSend} disabled={sending} data-testid="second-account-send" aria-busy={sending?"true":undefined}>
              {sending?"Sending…":"Send for review"}
            </Btn>
          )}
          <Btn variant="tonal" onClick={onDone} data-testid="second-account-done">Done</Btn>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * The pen-holder's line in the session badge, a tap to the same words.
 * @param {{count: number, onOpen: () => void}} p
 */
export function PenStandsLine({ count, onOpen }) {
  const line = penStandsLine(count);
  return (
    <button type="button" onClick={onOpen} className="pressBtn" data-testid="pen-stands"
      aria-label={`${line}. Open for more.`}
      style={{display:"inline-flex",alignItems:"center",gap:T.space.sm,minHeight:"44px",padding:`${T.space.xs} ${T.space.md}`,
        borderRadius:T.radius.pill,border:`1px solid ${T.line.normal}`,background:T.surface.raised,cursor:"pointer",
        textAlign:"left",maxWidth:"100%"}}>
      <span aria-hidden="true" style={{width:"8px",height:"8px",borderRadius:"50%",background:D.sky,flexShrink:0}}/>
      <span style={{...T.role.body,fontWeight:600,color:T.content.primary}}>{line}</span>
    </button>
  );
}

/**
 * The pen-holder's sheet: the same words, said of the other phone. Nothing
 * to do but read it.
 * @param {{count: number, onDone: () => void}} p
 */
export function PenStandsSheet({ count, onDone }) {
  const w = penStandsWords(count);
  return (
    <Sheet title={w.lead} accent={D.sky} onClose={onDone}>
      <div data-testid="pen-stands-sheet" data-count={count} style={{paddingTop:"12px",display:"flex",flexDirection:"column",gap:"16px"}}>
        <p style={{margin:0,fontFamily:D.body,fontSize:"15px",lineHeight:1.55,color:D.textPrimary}}>{w.text}</p>
        <div style={{display:"flex",justifyContent:"flex-end"}}>
          <Btn variant="tonal" onClick={onDone} data-testid="pen-stands-done">Done</Btn>
        </div>
      </div>
    </Sheet>
  );
}
