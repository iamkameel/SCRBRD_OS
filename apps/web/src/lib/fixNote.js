/**
 * "Needs you" lands on the fix, not on a list (EXPERIENCE_PASS §1.10, Slice 5).
 *
 * A row on Today or on To resolve names a screen and, on it, the one thing to
 * deal with: this fixture's trip, this competition's playing conditions, the
 * requests to decide, the claims to confirm, the clearance register. The
 * shell has no deep links into those screens, so the row leaves a note here,
 * as lib/cockpitNav.js does for the Match Centre, and the shell (App.jsx,
 * useFix) brings the named element into view once the screen has drawn it:
 * scrolled to, focused, and, where the note says so, chosen (a competition's
 * button opens its conditions).
 *
 * It opens nothing a reader could not open by hand: the element is only
 * found if the screen drew it, from its own reads, under its own gates. In
 * memory only; a reload forgets it, which is right.
 */
import { useEffect } from "react";

/** @typedef {{ page: string, find: string[], fallback?: string[], click?: boolean }} FixNote */
/** @type {FixNote | null} */
let pending = null;

/**
 * Leave a note for `page`: the first of `find` that the screen draws is the
 * fix; after a moment with none of them, the first of `fallback` will do.
 * @param {FixNote} note
 */
export function requestFix(note) { pending = note; }

/** Look without taking (a test, or a screen that wants to know). */
export const peekFix = () => pending;

/** How long the shell waits for the screen to draw the fix, and when it settles for the fallback. */
export const FIX_WAIT_MS = 6000;
export const FIX_FALLBACK_MS = 2500;

/**
 * The shell's half: while `page` is open, take a note left for it and bring
 * its element into view when it appears. Nothing happens without a note.
 * @param {string} page
 */
export function useFix(page) {
  useEffect(() => {
    if (!pending || pending.page !== page || typeof document === "undefined") return undefined;
    const note = pending;
    pending = null;
    const t0 = Date.now();
    let raf = 0;
    const first = (/** @type {string[] | undefined} */ sels) => {
      for (const s of sels ?? []) {
        const el = document.querySelector(s);
        if (el) return /** @type {HTMLElement} */ (el);
      }
      return null;
    };
    const tick = () => {
      const waited = Date.now() - t0;
      const el = first(note.find) ?? (waited >= FIX_FALLBACK_MS ? first(note.fallback) : null);
      if (el) {
        if (note.click && el.tagName === "BUTTON") el.click();
        if (!el.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute("tabindex", "-1");
        el.setAttribute("data-fix", "here");
        const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
        el.focus({ preventScroll: true });
        return;
      }
      if (waited < FIX_WAIT_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [page]);
}

/**
 * Where each kind of row lands (lib/queue.js row.action.kind), as a note for
 * the screen it opens, or null where the row's screen is the fixture (those
 * go through lib/cockpitNav.js) or has no one element to land on.
 * @param {string} kind  @param {{ matchId?: string | null, competitionId?: string | null }} [o]
 * @returns {FixNote | null}
 */
export function fixFor(kind, { matchId = null, competitionId = null, requestId = null } = {}) {
  switch (kind) {
    case "bus":
      return matchId ? { page: "logistics", find: [`[data-testid="trip-fixture-${matchId}"]`, `[data-testid="trip-card-${matchId}"]`], fallback: ['[data-testid="transport-book"]'] } : null;
    case "conditions":
      return competitionId ? { page: "competitions", find: [`[data-testid="competition-${competitionId}"]`], click: true } : null;
    case "requests":
      // "A parent is waiting" lands on her request, where the child it names is (Slice 6); else the panel.
      return requestId
        ? { page: "management", find: [`[data-testid="request-row-${requestId}"]`], fallback: ['[data-testid="requests-panel"]'] }
        : { page: "management", find: ['[data-testid="requests-panel"]'] };
    case "claims":
      // School, People since Slice 6 (Settings' People part, EXPERIENCE_PASS §1.6).
      return { page: "staff", find: ['[data-testid="claims"]'] };
    case "register":
      return { page: "staff", find: ['[data-testid="clearance-register"]'] };
    default:
      return null;
  }
}
