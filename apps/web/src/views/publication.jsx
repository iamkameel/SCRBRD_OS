import { useEffect, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { api, apiStatus, signedIn } from "../lib/api.js";
import { holdsCapability } from "../rbac/index.js";
import { Btn, Card } from "../ui/primitives.jsx";

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

export function PublishPanel({ matchId, role }) {
  const [sides, setSides] = useState(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [pagesOn, setPagesOn] = useState(null);
  const [nonce, setNonce] = useState(0);
  const show = signedIn() && holdsCapability(role, "broadcast.publish");

  useEffect(() => {
    if (!show) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/api/matches/${matchId}/publication`);
        if (!cancelled) setSides(r.sides ?? []);
      } catch { if (!cancelled) setSides([]); }
      const s = await apiStatus();
      if (!cancelled) setPagesOn(s?.health?.public ? s.health.public !== "off" : null);
    })();
    return () => { cancelled = true; };
  }, [matchId, nonce, show]);

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
      {anyPublished && (
        <p style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, margin: "8px 0 0" }} data-testid="publish-link">
          {pagesOn === false
            ? "Public pages are switched off on this deployment, so nothing is public yet."
            : <>Link: <a href={`/live/${matchId}`} style={{ color: D.textPrimary }}>/live/{matchId}</a> (not listed by search engines)</>}
        </p>
      )}
      {said && <div role="alert" data-testid="publish-refused" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginTop: "8px" }}>{said}</div>}
    </Card>
  );
}
