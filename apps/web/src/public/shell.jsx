import { useEffect, useState } from "react";
import { T } from "../design/tokens.js";

/**
 * THE PUBLIC SHELL (redesign slice 14, DESIGN_DIRECTION §2.1 "Public pages",
 * §2.4, §3.5): the slim header every public match page has, and the one state
 * a public page shows while it waits, when there is nothing, and when a read
 * fails. Nothing here names a child or reads anything: it is words, links and
 * a skeleton, so it adds no field to the public pages (PUBLIC_DATA).
 *
 * Wording, said once (§2.4): the missing page still does not say whether a
 * match exists ("The link may be wrong, or the match may not be public").
 */

/** How long a page waits for its first read before it says it could not load. */
export const LOADING_GIVES_UP_MS = 10_000;

/** The public home page, where today's matches are. */
export const TODAY_HREF = "/";

const linkBox = {
  minHeight: "44px", minWidth: "44px", display: "inline-flex", alignItems: "center", boxSizing: "border-box",
  textDecoration: "none", fontFamily: T.type.body,
};

/** The slim header: the mark (to the home page) and "Log in" (to the app). Nothing else. */
export function PublicHeader() {
  return (
    <header data-testid="public-header" style={{ borderBottom: `1px solid ${T.line.subtle}`, background: T.surface.canvas }}>
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: `0 ${T.space.md}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md }}>
        <a href="/" data-testid="public-header-mark" aria-label="SCRBRD, home" className="pressBtn"
          style={{ ...linkBox, fontFamily: T.type.head, fontSize: "18px", fontWeight: 800, color: T.content.primary, letterSpacing: "0.01em" }}>SCRBRD</a>
        <a href="/app" data-testid="public-header-login" rel="nofollow" className="pressBtn"
          style={{ ...linkBox, padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, border: `1px solid ${T.line.strong}`, color: T.content.primary, fontSize: "14px", fontWeight: 600 }}>Log in</a>
      </div>
    </header>
  );
}

/** "See today's matches": the way out of a page that is not there or did not load. */
export function SeeToday() {
  return (
    <a href={TODAY_HREF} data-testid="public-see-today" className="pressBtn"
      style={{ ...linkBox, padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, border: `1px solid ${T.line.strong}`, color: T.content.primary, fontSize: "14px", fontWeight: 600 }}>
      See today's matches
    </a>
  );
}

/** True once `waiting` has lasted `ms`: a read that takes too long becomes the error state (§2.4). */
export function useGaveUp(waiting, ms = LOADING_GIVES_UP_MS) {
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!waiting) { setGaveUp(false); return undefined; }
    const t = setTimeout(() => setGaveUp(true), ms);
    return () => clearTimeout(t);
  }, [waiting, ms]);
  return gaveUp;
}

/** A skeleton in the shape of what is coming: the match card, then three rows. Still under reduced motion (.os-skel). */
export function BoardSkeleton({ testid = "public-loading", label = "Loading the match…" }) {
  const bar = (/** @type {string} */ w, /** @type {string} */ h = "14px") => <div className="os-skel" style={{ height: h, width: w, borderRadius: T.radius.sm, background: T.surface.raised }}/>;
  return (
    <div role="status" data-testid={testid} style={{ display: "grid", gap: T.space.md, padding: `${T.space.md} 0` }}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" data-testid="public-skeleton" style={{ display: "grid", gap: T.space.sm }}>
        <div className="os-skel" style={{ height: "148px", borderRadius: T.radius.lg, background: T.surface.raised, border: `1px solid ${T.line.subtle}` }}/>
        {bar("100%")}{bar("100%")}{bar("60%")}
      </div>
    </div>
  );
}

/** The state's words: quiet, in the body face; a failure has the danger token on its icon only. */
export function PublicNotice({ testid, sentence, bad = false, children }) {
  return (
    <div data-testid={testid} role={bad ? "alert" : undefined} style={{ display: "grid", gap: T.space.md, justifyItems: "start", padding: `${T.space.xl} 0` }}>
      <p style={{ ...T.role.body, color: T.content.secondary, margin: 0, display: "flex", gap: T.space.sm, alignItems: "flex-start" }}>
        {bad && (
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" style={{ flex: "none", marginTop: "3px", color: T.semantic.criticalText }}>
            <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M9 4.8v5M9 12.2v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        )}
        <span data-testid={`${testid}-sentence`}>{sentence}</span>
      </p>
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>{children}<SeeToday/></div>
    </div>
  );
}
