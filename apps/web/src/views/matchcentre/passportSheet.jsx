import { useEffect, useId, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { useLive } from "../../lib/live.js";
import { readState } from "../../lib/readState.js";
import { humanDate } from "../../lib/format.js";
import { scrollerOf } from "../../lib/toBall.js";

/**
 * A BOY'S PASSPORT, OVER THE SCORECARD (CRI-3.2, G13).
 *
 * Opened from his row in the signed-in Match Centre, and only where the row
 * was given a link (lib/passportLink.js: his family, himself, his own side's
 * staff, the office at his school). What it draws is the passport read and
 * nothing else: `passport($1)` (db/124), his cricket record with where each
 * line came from and how sure the record is. It is the read his own Passport
 * screen and his profile's card already make; this adds no read and widens
 * none. The server decides every line.
 *
 * REFUSED IS NOT EMPTY. passport() answers a reader it refuses and a boy with
 * no record alike, with no line. So the sheet also asks passport_name(), the
 * passport's own door (db/124): his name where passport() would open to this
 * reader, null where it would not. Neither logs anything for the readers a
 * link is drawn for (only a union's named reader is logged, and he is given no
 * link). Refused, the sheet says "You can't open his passport now." (the link
 * can be wider than the read: lib/passportLink.js names how); admitted with no
 * line, "Nothing on his record yet." (sheetState below).
 *
 * Nothing medical, no rating, no coach's note and nothing from his file is on
 * the passport (db/116 A1), so none is here. His name is the one on the
 * scorecard row he was opened from: already on the screen, read again from
 * nowhere.
 *
 * Its own lazy chunk (MatchView imports it with lazy()), so a reader who
 * never taps a row never downloads it, and the public page, which has no
 * link to it, never reaches it (tools/check-bundle.mjs).
 *
 * A dialog: focus moves to its heading on open and stays inside it; Escape,
 * the close button and the scrim close it; focus goes back to the row's
 * button it was opened from. Under reduced motion it appears without moving.
 * While it is open the page behind it does not scroll.
 */

const FAMILY_WORDS = /** @type {Record<string, string>} */ ({ career: "Career", cap: "Caps", honour: "Honours", milestone: "Milestones" });
const FAMILY_ORDER = ["career", "cap", "honour", "milestone"];
/** How sure the record is, said in words, never a colour alone (§3.7). */
const CONFIDENCE_WORDS = /** @type {Record<string, string>} */ ({
  derived: "from the record", verified: "signed", asserted: "as stated", seeded: "unsigned",
});

/** Lines grouped by family, in the passport's order, unknown families last under their own name. @param {any[]} lines */
export function groupLines(lines) {
  const by = new Map();
  for (const l of lines) {
    const k = l.family ?? "other";
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(l);
  }
  const keys = [...by.keys()].sort((a, b) => {
    const ia = FAMILY_ORDER.indexOf(a), ib = FAMILY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || String(a).localeCompare(String(b));
  });
  return keys.map((k) => ({ family: k, title: FAMILY_WORDS[k] ?? k, lines: by.get(k) }));
}

const sheetCss = () => `@keyframes mcPassIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes mcPassScrim{from{opacity:0}to{opacity:1}}
.mc-pass-scrim{animation:mcPassScrim ${T.motion.control} ${T.motion.swift} both}
.mc-pass-card{animation:mcPassIn ${T.motion.panel} ${T.motion.ease} both}
@media (prefers-reduced-motion: reduce){.mc-pass-scrim,.mc-pass-card{animation:none!important}}
:root[data-reduce-motion] .mc-pass-scrim,:root[data-reduce-motion] .mc-pass-card{animation:none!important}`;

/**
 * What the sheet says, from its two reads: `door` (passport_name) decides
 * whether the passport is open to this reader at all, `read` (passport) what
 * is on it. Pure, so apps/web/test/passport-link.test.mjs proves the words.
 * @param {any} read  @param {any} door
 * @returns {{state: string, sentence: string | null, retry: boolean}}
 */
export function sheetState(read, door) {
  const opened = readState(door, { what: "his passport" });
  if (opened.state !== "ok" && opened.state !== "empty") return opened;
  if (opened.state === "empty" || !door.rows[0]?.name) return { state: "refused", sentence: "You can't open his passport now.", retry: false };
  const lines = readState(read, { what: "his passport" });
  return lines.state === "empty" ? { ...lines, sentence: "Nothing on his record yet." } : lines;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {{ player: {id: string, name?: string | null, from?: HTMLElement | null}, role: string, onClose: () => void }} p
 */
export default function PassportSheet({ player, role, onClose }) {
  const headingId = useId();
  const card = useRef(/** @type {HTMLDivElement | null} */ (null));
  const head = useRef(/** @type {HTMLHeadingElement | null} */ (null));
  // The row's button, held now: by the time the sheet closes the page may have redrawn.
  const opener = useRef(/** @type {Element | null} */ (player.from ?? (typeof document !== "undefined" ? document.activeElement : null)));
  const [nonce, setNonce] = useState(0);
  const read = useLive("passport", role, nonce, { playerId: player.id });
  const door = useLive("passport_name", role, nonce, { playerId: player.id });
  const said = sheetState(read, door);
  const name = player.name || "This player";

  useEffect(() => {
    head.current?.focus();
    const back = opener.current;
    // The page behind stays where it is (a phone scrolls it under the scrim
    // otherwise): the body, and the scroller the row sits in.
    const held = [...new Set([document.body, back ? scrollerOf(back) : null].filter(Boolean))]
      .map((el) => ({ el: /** @type {HTMLElement} */ (el), was: /** @type {HTMLElement} */ (el).style.overflow }));
    for (const h of held) h.el.style.overflow = "hidden";
    return () => {
      for (const h of held) h.el.style.overflow = h.was;
      if (back && typeof (/** @type {any} */ (back)).focus === "function" && document.contains(back)) /** @type {HTMLElement} */ (back).focus();
    };
  }, []);

  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !card.current) return;
      // Tab stays inside the sheet: from the last control to the first, and back.
      const items = /** @type {HTMLElement[]} */ ([...card.current.querySelectorAll(FOCUSABLE)]);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === head.current || !card.current.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !card.current.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const groups = said.state === "ok" ? groupLines(read.rows) : [];

  return (
    <div data-testid="passport-sheet-scrim" className="mc-pass-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: T.glass.scrim, display: "flex",
        alignItems: "flex-end", justifyContent: "center", padding: `${T.space.lg} 0 0` }}>
      <style>{sheetCss()}</style>
      <div ref={card} role="dialog" aria-modal="true" aria-labelledby={headingId} data-testid="passport-sheet" data-player={player.id}
        data-state={said.state} className="mc-pass-card"
        style={{ width: "100%", maxWidth: "560px", maxHeight: "85vh", overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", boxSizing: "border-box",
          background: T.surface.overlay, color: T.content.primary, border: `1px solid ${T.line.normal}`, borderBottom: "none",
          borderRadius: `${T.radius.lg} ${T.radius.lg} 0 0`, boxShadow: T.elevation.lg,
          padding: `${T.space.md} ${T.space.md} calc(${T.space.lg} + env(safe-area-inset-bottom))`, display: "grid", gap: T.space.md }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: T.space.sm }}>
          <div style={{ minWidth: 0, display: "grid", gap: "2px" }}>
            <span style={{ ...T.role.label, color: T.content.secondary }}>Passport</span>
            <h2 id={headingId} ref={head} tabIndex={-1} data-testid="passport-sheet-name"
              style={{ ...T.role.title.md, color: T.content.primary, margin: 0, outline: "none", overflowWrap: "anywhere" }}>{name}</h2>
          </div>
          <button type="button" onClick={onClose} data-testid="passport-sheet-close" aria-label="Close the passport" className="pressBtn os-state"
            style={{ flexShrink: 0, minWidth: "44px", minHeight: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer",
              color: T.content.primary, fontFamily: T.type.body, fontSize: "18px", lineHeight: 1 }}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p style={{ fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.4, color: T.content.secondary, margin: 0 }}>
          His cricket record, each line with where it came from.
        </p>

        {said.state !== "ok" && (
          <div role="status" data-testid="passport-sheet-state" style={{ display: "grid", gap: T.space.sm, justifyItems: "start" }}>
            <p style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>
              {said.sentence}
            </p>
            {said.retry && (
              <button type="button" onClick={() => setNonce((n) => n + 1)} data-testid="passport-sheet-retry" className="pressBtn os-state"
                style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, background: "transparent", border: `1px solid ${T.line.normal}`,
                  borderRadius: T.radius.pill, cursor: "pointer", color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
                Try again
              </button>
            )}
          </div>
        )}

        {groups.length > 0 && (
          <div data-testid="passport-sheet-lines" style={{ display: "grid", gap: T.space.md }}>
            {groups.map((g) => (
              <section key={g.family} aria-label={g.title} style={{ display: "grid", gap: T.space.xs }}>
                <h3 style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>{g.title}</h3>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md }}>
                  {g.lines.map((l, i) => (
                    <li key={`${l.label}-${i}`} data-testid="passport-sheet-line" data-family={l.family}
                      style={{ display: "grid", gap: "2px", padding: `${T.space.sm} ${T.space.md}`, borderTop: i ? `1px solid ${T.line.subtle}` : "none", minWidth: 0 }}>
                      <span style={{ ...T.role.body, color: T.content.primary, overflowWrap: "anywhere" }}>
                        <span style={{ fontWeight: 600 }}>{l.label}</span>{l.value ? ` · ${l.value}` : ""}
                      </span>
                      <span data-testid="passport-sheet-source" style={{ fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.4, color: T.content.secondary, overflowWrap: "anywhere" }}>
                        {[l.on ? humanDate(l.on) : null, l.source, l.recordedBy, CONFIDENCE_WORDS[l.confidence] ?? l.confidence].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
