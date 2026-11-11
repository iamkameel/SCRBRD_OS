import { useEffect, useRef, useState } from "react";
import { T } from "../design/tokens.js";
import { PracticePage, practiceStyles } from "./practice.jsx";
import { savedWords } from "../lib/practice.js";
import { api, signedIn } from "../lib/api.js";
import {
  deleteAllPilotHere, deletePilotHere, deletePilotOnServer, listPilot, pilotUuid, restoreFromServer,
} from "../lib/pilot.js";

/**
 * MY PILOT MATCHES (PILOT_MATCH_PHASE2 §3.3 step 5, §7.2; slice 3).
 *
 * Every Pilot Match on this phone — Resume, Delete everywhere — and, when
 * signed in with a signal, every one this account has on SCRBRD that this
 * phone does not: "Open on this phone" brings its log (and its names, until
 * their date, if they were sent) here, and the pad then offers Take over,
 * a person's press over the other phone's lapsed lease (db/126). Deleting
 * all asks whether SCRBRD's copies go too.
 *
 * Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read under 12px, nothing
 * tapped under 44px, tokens only, the page works at 390px; the practice
 * screens' own styles (practice.jsx S), so the two lists read alike.
 */

const S = practiceStyles;
const scoreLine = (/** @type {any} */ l) => `${l.team} ${l.runs}/${l.wickets} (${Math.floor(l.balls / 6)}.${l.balls % 6} ov)`;
/** @param {{children: any}} p */
const Row = ({ children }) => <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm, alignItems: "center" }}>{children}</div>;

/** Where one stands with the server, in words. @param {any} meta */
const sentWords = (meta) => meta?.pilot?.server === "created" ? "On SCRBRD" : "Not yet sent: it goes when there is signal and a sign-in";

/**
 * @param {{onBack: () => void, onResume: (id: string) => void}} props
 */
export function PilotList({ onBack, onResume }) {
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  const [theirs, setTheirs] = useState(/** @type {any[] | null} */ (null));
  const [ask, setAsk] = useState(/** @type {string | null} */ (null));
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef(null);

  const refresh = async () => {
    const here = await listPilot();
    setRows(here);
    if (!signedIn()) { setTheirs(null); return; }
    try {
      const r = await api("/api/pilot/mine", { timeoutMs: 5000 });
      const ids = new Set(here.map((x) => pilotUuid(x.id)));
      setTheirs((r?.matches ?? []).filter((/** @type {any} */ m) => !ids.has(m.id)));
    } catch { setTheirs(null); }
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (ask) /** @type {any} */ (confirmRef.current)?.focus(); }, [ask]);

  const removeOne = async (/** @type {any} */ r) => {
    setBusy(true);
    let server = true;
    if (r.meta?.pilot?.server === "created") {
      try { server = !!(await deletePilotOnServer(r.id))?.ok; } catch { server = false; }
    }
    // Off the server first: a phone that could not reach it keeps the
    // match, so the scorer can try again rather than lose the way to it.
    const clean = server ? await deletePilotHere(r.id) : false;
    setAsk(null); setBusy(false);
    setSaid(!server ? "SCRBRD could not be reached, so nothing was deleted. Try again when there is signal."
      : clean ? "Deleted, from this phone and from SCRBRD." : "Deleted from SCRBRD, but something on this phone could not be removed. Try again.");
    await refresh();
  };
  const removeAll = async (/** @type {boolean} */ everywhere) => {
    setBusy(true);
    let server = true;
    if (everywhere) {
      try { await api("/api/pilot/delete-all", { method: "POST" }); } catch { server = false; }
    }
    const r = server ? await deleteAllPilotHere() : { left: -1 };
    setAsk(null); setBusy(false);
    setSaid(!server ? "SCRBRD could not be reached, so nothing was deleted. Try again when there is signal."
      : r.left === 0 ? (everywhere ? "Deleted, from this phone and from SCRBRD." : "Deleted from this phone. SCRBRD still has them.")
      : "Some of it could not be removed. Try again.");
    await refresh();
  };
  const openHere = async (/** @type {any} */ m) => {
    setBusy(true); setSaid("");
    try { const id = await restoreFromServer(m.id); setBusy(false); onResume(id); }
    catch { setBusy(false); setSaid("It could not be brought to this phone. Try again when there is signal."); }
  };

  const title = (/** @type {any} */ m) => (m.sides?.length === 2 ? `${m.sides[0].display_name} v ${m.sides[1].display_name}` : "Pilot match");
  return (
    <PracticePage title="My Pilot Matches" onBack={onBack} backLabel="Back" pilot>
      <p style={S.body()}>Pilot Matches are sent to SCRBRD so you can carry on on another phone. Their names are never shown publicly.</p>
      {said && <p role="status" data-testid="pilot-said" style={S.note("ok")}>{said}</p>}
      {rows == null && <p style={S.body()}>Looking…</p>}
      {rows && rows.length === 0 && !theirs?.length && <p data-testid="pilot-empty" style={S.card()}>No Pilot Matches on this phone.</p>}
      {rows && rows.map((r) => (
        <section key={r.id} data-testid="pilot-row" data-id={r.id} style={S.card()} aria-label={r.title}>
          <h2 style={S.h2()}>{r.title}</h2>
          <p style={S.body()}>{r.lines.length ? r.lines.map(scoreLine).join(" · ") : "Nothing scored yet"}</p>
          <p style={S.body()}>
            {r.complete ? "Finished" : "In progress"}{" · "}<span data-testid="pilot-row-sent">{sentWords(r.meta)}</span>
            {" · "}last saved {savedWords(r.savedAt)}
          </p>
          {ask === r.id ? (
            <div role="group" aria-label="Confirm delete" data-testid="pilot-confirm" style={{ ...S.note("bad"), display: "grid", gap: T.space.sm }}>
              <p style={{ ...S.body(), color: T.content.primary }}>Delete this match? Its names, teams and every ball are removed from this phone and from SCRBRD. This cannot be undone.</p>
              <Row>
                <button ref={confirmRef} type="button" className="pressBtn" style={S.dangerSolid()} disabled={busy} data-testid="pilot-confirm-delete" onClick={() => removeOne(r)}>Delete everywhere</button>
                <button type="button" className="pressBtn" style={S.secondary()} onClick={() => setAsk(null)}>Keep it</button>
              </Row>
            </div>
          ) : (
            <Row>
              <button type="button" className="pressBtn" style={{ ...S.secondary(), background: T.content.primary, color: T.surface.base, border: "none" }}
                data-testid="pilot-resume-row" onClick={() => onResume(r.id)}>{r.complete ? "Open" : "Resume"}</button>
              <button type="button" className="pressBtn" style={S.danger()} data-testid="pilot-delete" onClick={() => { setSaid(""); setAsk(r.id); }}>Delete</button>
            </Row>
          )}
        </section>
      ))}
      {theirs && theirs.length > 0 && (
        <section style={S.card()} aria-labelledby="pilot-theirs">
          <h2 id="pilot-theirs" style={S.h2()}>On SCRBRD, not on this phone</h2>
          {theirs.map((m) => { const state = m.status === "live" ? "In progress" : "Finished"; return (
            <div key={m.id} data-testid="pilot-server-row" data-id={m.id} style={{ display: "grid", gap: T.space.xs }}>
              <p style={{ ...S.body(), color: T.content.primary, fontWeight: 600 }}>{title(m)}</p>
              <p style={S.body()}>{`${state} · started ${savedWords(Date.parse(m.startsAt))} · ${m.events} events`}</p>
              <Row>
                <button type="button" className="pressBtn" style={S.secondary()} disabled={busy} data-testid="pilot-open-here" onClick={() => openHere(m)}>Open on this phone</button>
              </Row>
            </div>
          ); })}
        </section>
      )}
      {rows && rows.length > 0 && (
        <section style={S.card()} aria-label="Delete all Pilot Matches">
          {ask === "all" ? (
            <div role="group" aria-label="Confirm delete all" data-testid="pilot-confirm-all" style={{ display: "grid", gap: T.space.sm }}>
              <p style={{ ...S.body(), color: T.content.primary }}>
                {`Delete all ${rows.length} Pilot ${rows.length === 1 ? "Match" : "Matches"} on this phone? Also delete them from SCRBRD?`}
              </p>
              <Row>
                <button ref={confirmRef} type="button" className="pressBtn" style={S.dangerSolid()} disabled={busy} data-testid="pilot-confirm-delete-all-everywhere" onClick={() => removeAll(true)}>Yes, from SCRBRD too</button>
                <button type="button" className="pressBtn" style={S.danger()} disabled={busy} data-testid="pilot-confirm-delete-all-here" onClick={() => removeAll(false)}>This phone only</button>
                <button type="button" className="pressBtn" style={S.secondary()} onClick={() => setAsk(null)}>Keep them</button>
              </Row>
            </div>
          ) : (
            <button type="button" className="pressBtn" style={S.danger()} data-testid="pilot-delete-all" onClick={() => { setSaid(""); setAsk("all"); }}>Delete all Pilot Matches</button>
          )}
        </section>
      )}
    </PracticePage>
  );
}
