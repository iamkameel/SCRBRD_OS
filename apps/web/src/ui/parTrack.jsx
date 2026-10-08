/**
 * THE RATE TRACK (SCRBRD-133 §3.5): what Kameel called a pressure meter,
 * drawn as one labelled line with two ticks — never a 0–100 figure (D4).
 *
 *   first innings   par 61 ──────┼────●── Hilton 73      +12
 *   chase           CRR 8.40 ──●────────┼── RRR 7.94     climbing
 *
 * Both ticks carry their figure, the gap is in words, and the shapes differ
 * (a bar for par or the required rate, a dot for the side) so colour is never
 * alone. The ticks slide when the figures move (`transform` only, 190 ms
 * `swift`, the `.os-tick` class the reduced-motion block makes a cut). Not
 * drawn when there is nothing to compare: lib/par.js rateTrack() says null.
 *
 * Shared by the ground display, the Match Centre's Summary Board and the
 * public page; the caller gives the colours and the text class (its sizes).
 * Nothing on it is pressed.
 */
import { T } from "../design/tokens.js";

/**
 * @param {object} p
 * @param {ReturnType<typeof import("../lib/par.js").rateTrack>} p.track
 * @param {{line: string, bar: string, dot: string, text: string, gap: string}} p.palette
 * @param {string} [p.textClass]
 * @param {Record<string, string | number>} [p.textStyle]
 * @param {string} [p.testid]
 */
export function RateTrack({ track, palette, textClass, textStyle = {}, testid = "rate-track" }) {
  if (!track) return null;
  const at = (/** @type {number} */ v) => Math.max(0, Math.min(100, (v / track.scale) * 100));
  const tick = (/** @type {number} */ v) => ({ position: /** @type {const} */ ("absolute"), left: 0, top: 0, bottom: 0, width: "100%",
    transform: `translateX(${at(v).toFixed(2)}%)`, transition: `transform ${T.motion.control} ${T.motion.swift}` });
  return (
    <div data-testid={testid} data-kind={track.kind} className={textClass}
      style={{ display: "flex", alignItems: "center", gap: "0.6em", minWidth: 0, ...textStyle, color: palette.text }}>
      <span className="sr-only">{track.said}</span>
      <span aria-hidden="true" data-testid={`${testid}-from`} style={{ whiteSpace: "nowrap" }}>{track.from.label} {track.from.text}</span>
      <span aria-hidden="true" style={{ position: "relative", flex: "1 1 auto", minWidth: "48px", height: "1.1em" }}>
        <span style={{ position: "absolute", left: 0, right: 0, top: "50%", height: "2px", marginTop: "-1px", background: palette.line }}/>
        {/* Each tick rides a full-width layer moved by transform alone, so a new figure slides without a layout. */}
        {[track.from, track.to].map((end, i) => (
          <span key={i} className="os-tick" data-mark={end.mark} style={tick(end.value)}>
            {end.mark === "bar"
              ? <span style={{ position: "absolute", left: "-2px", top: 0, bottom: 0, width: "4px", background: palette.bar, borderRadius: "2px" }}/>
              : <span style={{ position: "absolute", left: "-0.4em", top: "50%", width: "0.8em", height: "0.8em", marginTop: "-0.4em",
                  background: palette.dot, borderRadius: "50%" }}/>}
          </span>
        ))}
      </span>
      <span aria-hidden="true" data-testid={`${testid}-to`} style={{ whiteSpace: "nowrap" }}>{track.to.label} {track.to.text}</span>
      {track.gap && <span aria-hidden="true" data-testid={`${testid}-gap`} style={{ whiteSpace: "nowrap", color: palette.gap, fontWeight: 600 }}>{track.gap}</span>}
    </div>
  );
}
