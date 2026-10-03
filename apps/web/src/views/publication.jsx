import { useEffect, useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api, apiStatus, signedIn } from "../lib/api.js";
import { holdsCapability } from "../rbac/index.js";
import { Btn, Card } from "../ui/primitives.jsx";
import { displayUrl } from "../display/data.js";
import { qrMatrix, qrPath } from "../lib/qr.js";
import { listingLine } from "../lib/listing.js";

/**
 * Putting a side of a fixture on the public pages (SCRBRD-083 phase 1).
 *
 * fixture_publish() (db/47) decides who may: broadcast.publish at THAT side's
 * school and team — the home school publishes its own side, the away school
 * its own (L5, each school speaks for its own children). The `may_publish`
 * the read returns is the same app_can() question, so a side the reader
 * cannot publish shows its state and no button. The check on the role below
 * only decides whether to draw the panel at all; the database is the gate.
 *
 * Off by default, and nothing is public until a deployment switches the pages
 * on (PUBLIC_PAGES=on, after the information officer's confirmation). The
 * panel says which, so a school is never told a page is live when it is not.
 */

const SIDE = { home: "Home side", away: "Away side" };
const REFUSAL = {
  not_permitted: "You may not publish that side — only its own school's publisher can.",
  side_not_on_platform: "That side's school is not on SCRBRD, so it is never named and cannot be published.",
  no_such_fixture: "That fixture could not be found.",
};

export function PublishPanel({ matchId, role, schools = null }) {
  const [sides, setSides] = useState(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [pagesOn, setPagesOn] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [listed, setListed] = useState(/** @type {Record<string, boolean>} */ ({}));
  const show = signedIn() && holdsCapability(role, "broadcast.publish");
  const homeSchool = schools?.home, awaySchool = schools?.away;

  useEffect(() => {
    if (!show) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/api/matches/${matchId}/publication`);
        if (!cancelled) setSides(r.sides ?? []);
        // Whether each school this reader publishes for lists (SCRBRD-142). A
        // 404 is a reader who may not see the setting: no entry, no line.
        const schoolOf = { home: homeSchool, away: awaySchool };
        const mine = (r.sides ?? []).filter((x) => x.on_platform && x.may_publish && schoolOf[x.side]);
        const got = {};
        for (const id of new Set(mine.map((x) => schoolOf[x.side]))) {
          try { got[id] = (await api(`/api/schools/${id}/listing`)).listed === true; } catch { /* not readable: nothing said */ }
        }
        if (!cancelled) setListed(got);
      } catch { if (!cancelled) setSides([]); }
      const s = await apiStatus();
      if (!cancelled) setPagesOn(s?.health?.public ? s.health.public !== "off" : null);
    })();
    return () => { cancelled = true; };
  }, [matchId, nonce, show, homeSchool, awaySchool]);

  if (!show || !sides) return null;
  const set = async (side, published) => {
    setSaid(""); setBusy(true);
    try {
      await api(`/api/matches/${matchId}/publication`, { method: "POST", body: { side, published } });
      setNonce((n) => n + 1);
    } catch (e) { setSaid(REFUSAL[e.code] ?? `Refused (${e.code ?? "unreachable"}).`); }
    finally { setBusy(false); }
  };
  const anyPublished = sides.some((s) => s.published);
  return (
    <Card sx={{ padding: "14px", marginBottom: "12px" }} data-testid="publish-panel">
      <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary, marginBottom: "6px" }}>Public page</div>
      <p style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, margin: "0 0 10px" }}>
        Each school publishes its own side. A published side's players are named only where their family has consented;
        everyone else is shown by position.
      </p>
      {sides.map((s) => (
        <div key={s.side} data-testid={`publish-${s.side}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "6px 0", borderTop: `1px solid ${D.border}` }}>
          <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary }}>
            {SIDE[s.side]} · <strong data-testid={`publish-${s.side}-state`}>{!s.on_platform ? "not on SCRBRD" : s.published ? "published" : "not published"}</strong>
          </span>
          {s.on_platform && s.may_publish && (
            <Btn size="sm" variant={s.published ? "ghost" : "primary"} disabled={busy} onClick={() => set(s.side, !s.published)}
              data-testid={`publish-${s.side}-toggle`}>{s.published ? "Withdraw" : "Publish"}</Btn>
          )}
        </div>
      ))}
      {[...new Set(sides.filter((s) => s.on_platform && s.may_publish).map((s) => schools?.[s.side]))].filter((id) => id && listed[id] != null).map((id) => (
        <p key={id} data-testid="publish-listing" style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, margin: "8px 0 0" }}>
          {listingLine({ listed: listed[id], pagesOn, published: sides.some((s) => s.published && schools?.[s.side] === id) })}
        </p>
      ))}
      {anyPublished && (
        <p style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, margin: "8px 0 0" }} data-testid="publish-link">
          {pagesOn === false
            ? "Public pages are switched off on this deployment, so nothing is public yet."
            : <>Link: <a href={`/live/${matchId}`} style={{ color: D.textPrimary }}>/live/{matchId}</a> (not listed by search engines)</>}
        </p>
      )}
      {sides.find((s) => s.side === "home")?.published && pagesOn !== false && (
        <GroundDisplaySetup matchId={matchId} sides={sides}/>
      )}
      {said && <div role="alert" data-testid="publish-refused" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginTop: "8px" }}>{said}</div>}
    </Card>
  );
}

// ── The ground display (SCRBRD-133 G1, §1.3) ──

const CHOICE = {
  theme: [["floodlit", "Floodlit"], ["daylight", "Daylight"]],
  dwell: [["normal", "Normal (12 s)"], ["long", "Long (24 s)"]],
};

/**
 * Under the switch that publishes the live page: the ground display's link and
 * QR code, its three settings, and how many of the side the public surfaces
 * name (D3). On exactly when the home side is published (D2) — the display IS
 * the public page, drawn for a pavilion TV, and signs in as nothing (D1).
 *
 * The settings travel in the link (`?theme=daylight&dwell=long&motion=reduce`):
 * nothing is stored and nothing is counted (§1.3, 083 Q8). The names line is
 * the publication read's count (publication-api.mjs), the public projection's
 * own answer for each boy of a side this reader may publish — a count, never
 * a name. The lever it points at is consent, not a looser screen (D3).
 */
function GroundDisplaySetup({ matchId, sides }) {
  const [theme, setTheme] = useState("floodlit");
  const [dwell, setDwell] = useState("normal");
  const [reduceMotion, setReduceMotion] = useState(false);
  const url = displayUrl(window.location.origin, matchId, { theme, dwell, reduceMotion });
  const qr = qrPath(qrMatrix(url));
  const counted = sides.filter((s) => s.names);
  const seg = (name, value, set) => (
    <div role="radiogroup" aria-label={name === "theme" ? "Light" : "How long each panel stays"} style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
      {CHOICE[name].map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => set(v)} data-testid={`display-setup-${name}-${v}`}
          className="pressBtn"
          style={{ minHeight: "44px", padding: "0 14px", borderRadius: "999px", cursor: "pointer", fontFamily: D.body, fontSize: "13px",
            border: `1px solid ${value === v ? D.textPrimary : D.borderMed}`, background: value === v ? D.textPrimary : "transparent",
            color: value === v ? inkOn(D.textPrimary) : D.textPrimary, fontWeight: value === v ? 600 : 500 }}>
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <section data-testid="display-setup" aria-label="Ground display" style={{ borderTop: `1px solid ${D.border}`, marginTop: "10px", paddingTop: "10px" }}>
      <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary, marginBottom: "6px" }}>Ground display</div>
      <p style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, margin: "0 0 8px" }}>
        Open this link on the pavilion TV&apos;s browser and leave it. Nobody signs in there: it shows exactly what the live page
        shows, and nothing on it can be pressed. After full time it holds the result, then dims.
      </p>
      <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "flex-start" }}>
        <svg data-testid="display-setup-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} width="132" height="132" role="img"
          aria-label="QR code for the ground display's link" shapeRendering="crispEdges" style={{ background: "#ffffff", borderRadius: "6px", flexShrink: 0 }}>
          <path d={qr.d} fill="#000000"/>
        </svg>
        <div style={{ display: "grid", gap: "8px", minWidth: 0, flex: "1 1 220px" }}>
          <a href={url} data-testid="display-setup-link" target="_blank" rel="noreferrer noopener"
            style={{ fontFamily: D.mono, fontSize: "12px", color: D.textPrimary, overflowWrap: "anywhere" }}>{url}</a>
          {seg("theme", theme, setTheme)}
          {seg("dwell", dwell, setDwell)}
          <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "44px", fontFamily: D.body, fontSize: "13px", color: D.textPrimary, cursor: "pointer" }}>
            <input type="checkbox" checked={reduceMotion} onChange={(e) => setReduceMotion(e.target.checked)} data-testid="display-setup-motion"
              style={{ width: "20px", height: "20px" }}/>
            Reduce motion
          </label>
        </div>
      </div>
      {counted.map((s) => (
        <p key={s.side} data-testid={`display-setup-names-${s.side}`} style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, margin: "8px 0 0" }}>
          {SIDE[s.side]}: {s.names.total
            ? <><strong>{s.names.named} of {s.names.total}</strong> named on public surfaces · <strong>{s.names.positions}</strong> shown by position</>
            : "nobody of this side is on the team sheet or in the scorebook yet"}
        </p>
      ))}
      {counted.length > 0 && (
        <details data-testid="display-setup-consent" style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginTop: "6px" }}>
          <summary style={{ cursor: "pointer", minHeight: "44px", display: "flex", alignItems: "center", color: D.textPrimary }}>Why a boy is shown by position</summary>
          <p style={{ margin: "4px 0 0" }}>
            A boy is named — initial and surname — only where his family&apos;s consent to public naming is recorded with the school
            office, from the admission form, and nothing else stops it (a never-public mark, or names switched off for his age
            group). Everyone else is shown as Batter or Bowler. The display follows the same rule as the live page: recording
            consent is the only way to name a boy on it.
          </p>
        </details>
      )}
    </section>
  );
}
