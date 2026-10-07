import { useEffect, useMemo, useState } from "react";
import { T } from "../../design/tokens.js";
import { getPref, setPref } from "../../lib/persist.js";
import { homeBody, textLink } from "./shared.jsx";

/**
 * The footer, with the analytics consent toggle (SCRBRD-142 §5.3).
 *
 * This page runs no analytics at all. The toggle only writes the device
 * preference the signed-in app honours at boot (lib/firebase.js reads the
 * same key through getPref), and starts nothing: it imports persist.js, not
 * firebase.js, so the Firebase SDK is not in this page's bundle and cannot be
 * loaded from here (tools/check-bundle.mjs holds that line).
 *
 * Props
 *   privacyHref  where the privacy words live. Default "/privacy".
 *   prefs        { getPref, setPref } to read and write the device
 *                preference; the device's own store by default. A test passes
 *                a fake to see exactly what is written.
 */

/** The preference's key: lib/firebase.js's CONSENT_KEY, which its analyticsConsented() reads. home-page.test.mjs holds the two together. */
export const ANALYTICS_PREF = "analytics";

/** Writes the preference and nothing else. Resolves to the value written. */
export async function setAnalyticsPref(on, prefs = { getPref, setPref }) {
  const value = on === true;
  await prefs.setPref(ANALYTICS_PREF, value);
  return value;
}

/** The switch as drawn, from its state. The words are today's, with the one change §5.3 asks for. */
export function ToggleView({ on, onToggle }) {
  return (
    <div style={{ marginTop: T.space.md, fontFamily: T.type.mono, fontSize: "12px", color: T.content.tertiary, letterSpacing: "0.02em", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: T.space.sm }}>
      <span>Anonymous usage analytics in the app: <strong>{on ? "on" : "off"}</strong>. This page collects nothing.</span>
      <button type="button" onClick={onToggle} role="switch" aria-checked={on} data-testid="analytics-consent" className="pressBtn"
        style={{ minHeight: "44px", minWidth: "44px", padding: "0 16px", borderRadius: T.radius.pill, cursor: "pointer", background: "transparent", border: `1px solid ${T.line.strong}`, fontFamily: T.type.mono, fontSize: "12px", color: T.content.secondary }}>
        {on ? "Turn off" : "Turn on"}
      </button>
      {on && <span>The app uses it from your next visit. Turn it off here and it stops the visit after.</span>}
    </div>
  );
}

export function AnalyticsToggle({ prefs }) {
  const store = useMemo(() => prefs ?? { getPref, setPref }, [prefs]);
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve(store.getPref(ANALYTICS_PREF)).then((v) => { if (live) setOn(v === true); }).catch(() => {});
    return () => { live = false; };
  }, [store]);
  const onToggle = async () => {
    const next = !on;
    setOn(next);
    try { await setAnalyticsPref(next, store); } catch { setOn(!next); }
  };
  return <ToggleView on={on} onToggle={onToggle} />;
}

export function Footer({ privacyHref = "/privacy", prefs }) {
  return (
    <footer style={{ borderTop: `1px solid ${T.line.subtle}`, padding: `${T.space.xxl} ${T.space.lg} ${T.space.xl}`, textAlign: "center" }}>
      <div aria-hidden="true" style={{ display: "flex", gap: "6px", justifyContent: "center", marginBottom: T.space.lg }}>
        {"SCRBRD".split("").map((c, i) => (
          <span key={i} style={{ width: "34px", height: "44px", borderRadius: "6px", background: T.board.face, color: T.board.figure, fontFamily: T.type.head,
            fontWeight: 800, fontSize: "22px", display: "inline-flex", alignItems: "center", justifyContent: "center",
            backgroundImage: "linear-gradient(transparent 49%, rgba(0,0,0,0.7) 49%, rgba(0,0,0,0.7) 52%, transparent 52%)" }}>{c}</span>
        ))}
      </div>
      <p style={{ margin: 0 }}>
        <a href={privacyHref} style={textLink()}>Privacy</a>
      </p>
      <div style={{ ...homeBody(), fontFamily: T.type.mono, fontSize: "12px", color: T.content.tertiary, letterSpacing: "0.04em" }}>© 2026 SCRBRD · School Cricket Intelligence Platform</div>
      <AnalyticsToggle prefs={prefs} />
    </footer>
  );
}
