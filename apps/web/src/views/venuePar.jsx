import { useEffect, useState } from "react";
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { api } from "../lib/api.js";

/**
 * PAR AT THIS GROUND (SCRBRD-130 R3; docs/design/SCRBRD-130_rain_and_par.md
 * §1, §6). The mean of what sides have made batting first here, in the same
 * kind of match, with the innings it came from: the server's figure
 * (GET /api/grounds/:id/venue-par, db/74 venue_par()), derived on every read.
 *
 *   "Par at this ground: 128 — the mean first-innings total in 20-over U15
 *    matches here: 9 innings, 2024 to 2026, median 126, range 88–176"
 *   or "Not enough matches here yet (2 of 5)".
 *
 * Evidence, not a prediction: the innings behind it are listed (date, sides,
 * total — results already shown), and a pitch's innings are shown by the
 * ground each was played on. Floors (DESIGN_DIRECTION §3.2, §3.5): nothing
 * read under 12px, nothing tapped under 44px; tokens read from T while it draws.
 */

const BANDS = ["U13", "U14", "U15", "U16", "open"];
const OVERS = [20, 50];

const chip = (/** @type {boolean} */ on) => ({
  minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.pill, cursor: "pointer",
  fontFamily: T.type.body, fontSize: "14px", fontWeight: on ? 600 : 500, color: T.content.primary,
  background: on ? T.surface.raised : T.surface.interactive, border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`,
});
const small = () => ({ fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.45, color: T.content.secondary, margin: 0 });

/** "U15" → "U15", "open" → "open-age". @param {string} b */
const bandWords = (b) => (b === "open" ? "open-age" : b);

/**
 * @param {{groundId: string, defaultBand?: string, defaultOvers?: number}} p
 */
export function VenueParCard({ groundId, defaultBand = "open", defaultOvers = 20 }) {
  useTheme();
  const [band, setBand] = useState(defaultBand);
  const [overs, setOvers] = useState(defaultOvers);
  const [state, setState] = useState(/** @type {{venue: any, error: string | null, loading: boolean}} */ ({ venue: null, error: null, loading: true }));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let gone = false;
    setState((s) => ({ ...s, loading: true }));
    api(`/api/grounds/${groundId}/venue-par?overs=${overs}&band=${encodeURIComponent(band)}`)
      .then((r) => { if (!gone) setState({ venue: r?.venuePar ?? null, error: null, loading: false }); })
      .catch((e) => { if (!gone) setState({ venue: null, error: e?.message ?? "error", loading: false }); });
    return () => { gone = true; };
  }, [groundId, band, overs]);
  const v = state.venue;
  return (
    <section data-testid="venue-par" aria-labelledby="venue-par-title"
      style={{ display: "grid", gap: T.space.sm, padding: T.space.md, marginBottom: T.space.md, borderRadius: T.radius.md,
        border: `1px solid ${T.line.normal}`, background: T.surface.raised }}>
      <h3 id="venue-par-title" style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>Venue par</h3>
      <div role="group" aria-label="Kind of match" style={{ display: "flex", flexWrap: "wrap", gap: T.space.xs }}>
        {OVERS.map((o) => (
          <button key={o} type="button" aria-pressed={overs === o} data-testid={`venue-par-overs-${o}`} className="pressBtn os-state"
            onClick={() => setOvers(o)} style={chip(overs === o)}>{o} overs</button>
        ))}
        {BANDS.map((b) => (
          <button key={b} type="button" aria-pressed={band === b} data-testid={`venue-par-band-${b}`} className="pressBtn os-state"
            onClick={() => setBand(b)} style={chip(band === b)}>{b === "open" ? "Open" : b}</button>
        ))}
      </div>
      {state.loading && <p style={small()}>Reading this ground's record…</p>}
      {!state.loading && state.error && <p data-testid="venue-par-error" style={small()}>This ground's par could not be read.</p>}
      {!state.loading && v && (
        <div aria-live="polite" style={{ display: "grid", gap: T.space.xs }}>
          <p data-testid="venue-par-words" style={{ margin: 0, fontFamily: T.type.body, fontSize: "18px", fontWeight: 600, color: T.content.primary }}>
            {v.words}
          </p>
          {v.sufficient ? (
            <p data-testid="venue-par-evidence" style={small()}>
              The mean first-innings total in {v.overs}-over {bandWords(v.ageBand)} matches here: {v.n} innings,
              {" "}{v.firstSeason === v.lastSeason ? v.firstSeason : `${v.firstSeason} to ${v.lastSeason}`}, median {v.median}, range {v.low}–{v.high}
              {v.fromBooks > 0 ? `; ${v.fromBooks} from scorebooks` : ""}.
            </p>
          ) : (
            <p style={small()}>A par is shown once {v.floor} first innings here, played to their overs, are on record.</p>
          )}
          {v.innings.length > 0 && (
            <div>
              <button type="button" aria-expanded={open} data-testid="venue-par-innings-open" className="pressBtn os-state"
                onClick={() => setOpen(!open)}
                style={{ ...chip(false), borderRadius: T.radius.md }}>{open ? "Hide the innings" : `The innings behind it (${v.innings.length})`}</button>
              {open && (
                <ul data-testid="venue-par-innings" style={{ listStyle: "none", padding: 0, margin: `${T.space.xs} 0 0`, display: "grid", gap: "4px" }}>
                  {v.innings.map((/** @type {any} */ i) => (
                    <li key={i.matchId} style={{ ...small(), color: T.content.primary }}>
                      {i.date} · {i.home} v {i.away} · {i.runs}{i.fromBook ? " (scorebook)" : ""}
                    </li>
                  ))}
                </ul>
              )}
              {open && v.breakdown.length > 1 && (
                <p data-testid="venue-par-breakdown" style={{ ...small(), marginTop: T.space.xs }}>
                  By ground: {v.breakdown.map((/** @type {any} */ b) => `${b.name} ${b.mean} (${b.n})`).join(" · ")}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
