import { useEffect, useId, useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";
import { NOT_HIM, OFFICE_INTRO, OFFICE_STATE_WORDS, clearWords, dayWords, officeWords, rosterMatches } from "../lib/pupilClaim.js";

// ══════════════════════════════════════════════════════
//  PUPIL CLAIMS  (Settings → People; SCRBRD-140 honesty model, Migration A; db/168)
//
//  A boy under 18 signed in with Google and said "I am a pupil here". The
//  office looks, as it would at a parent's request: is this one of ours, and
//  which one? RECOGNISE matches his account to his roster row and opens
//  NOTHING (his team, his matches and his record stay closed until a
//  parent's or guardian's yes, today the signed consent form, on which the
//  office enrols his account as before). DECLINE when nobody knows him: the
//  school's DSOs are told a claim was declined, never whose (Q11).
//
//  Who sees the list is the database's: pupil_claims() answers only the
//  office and the principal (guardian.link.manage, R4: the people who read
//  a pupil's address), never a support hour or the owner's key; the panel
//  only asks. The roster picker draws from the office's own roster read.
//
//  Q9: an account is kept 30 days from its last claim. Past that, "Remove N
//  accounts past their 30 days" removes them, by a person, here.
// ══════════════════════════════════════════════════════

const sub = () => ({ fontFamily: D.body, fontSize: "13px", lineHeight: 1.5, color: D.textSecondary });

function Act({ children, quiet, disabled, ...rest }) {
  return (
    <button type="button" className="pressBtn" disabled={disabled} {...rest}
      style={{ minHeight: "44px", padding: "10px 16px", borderRadius: D.pill, boxSizing: "border-box",
        border: `1px solid ${quiet ? D.border : "transparent"}`, background: quiet ? "transparent" : D.indigo,
        color: quiet ? D.textSecondary : inkOn(D.indigo), fontFamily: D.head, fontSize: "13px", fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>{children}</button>
  );
}

const todayIso = () => {
  const d = new Date(Date.now() + 2 * 3600 * 1000);   // Johannesburg's day, as the database keeps it
  return d.toISOString().slice(0, 10);
};

/** One claim, with the office's two answers. */
export function PupilClaimRow({ c, players, school, busy, onRecognise, onDecline, onNotHim }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState("");
  const [declining, setDeclining] = useState(false);
  const [notHim, setNotHim] = useState(false);
  // db/169 (S10): a claim matched to a boy (recognised, opened, or closed again) can be taken back.
  const matched = ["recognised", "open", "closed"].includes(c.state) && !!c.playerId;
  const searchId = useId(), pickId = useId();
  const matches = rosterMatches(players, school, q);
  const waiting = c.state === "with_office";
  return (
    <li data-testid="pupil-claim" data-claim={c.id} data-state={c.state}
      style={{ listStyle: "none", padding: "12px 14px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf2 + "66" }}>
      <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary, overflowWrap: "anywhere" }}>
        {c.name}{c.year ? <span style={{ fontWeight: 400, color: D.textSecondary }}> · {c.year}</span> : null}
      </div>
      <div style={sub()}>Signed in with Google as <span data-testid="pupil-claim-address" style={{ color: D.textPrimary, overflowWrap: "anywhere" }}>{c.address ?? "(not shown)"}</span></div>
      <div style={sub()}><span data-testid="pupil-claim-state">{OFFICE_STATE_WORDS[c.state] ?? c.state}</span>
        {c.playerName ? <> · on your list as <span data-testid="pupil-claim-player" style={{ color: D.textPrimary }}>{c.playerName}</span></> : null}
        {c.knownBy ? <> · by {c.knownBy}</> : null}</div>
      {c.keepUntil && <div style={sub()} data-testid="pupil-claim-keep">Kept until {dayWords(c.keepUntil)}</div>}
      {waiting && (
        <div style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
          <label htmlFor={searchId} style={{ ...sub(), fontWeight: 700, color: D.textPrimary }}>Find him on your list</label>
          <input id={searchId} value={q} onChange={(e) => { setQ(e.target.value); setPick(""); }} autoComplete="off" data-testid="pupil-claim-search"
            style={{ minHeight: "44px", padding: "10px 12px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf1, color: D.textPrimary, fontFamily: D.body, fontSize: "16px", boxSizing: "border-box" }}/>
          <label htmlFor={pickId} style={{ ...sub(), fontWeight: 700, color: D.textPrimary }}>His place on the list</label>
          <select id={pickId} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="pupil-claim-pick"
            style={{ minHeight: "44px", padding: "10px 12px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf1, color: D.textPrimary, fontFamily: D.body, fontSize: "16px", boxSizing: "border-box" }}>
            <option value="">Choose…</option>
            {matches.map((p) => <option key={p.id} value={p.id}>{p.name}{p.team ? ` (${p.team})` : ""}</option>)}
          </select>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Act disabled={busy || !pick} onClick={() => onRecognise(pick)} data-testid="pupil-claim-recognise" aria-label={`Recognise ${c.name}`}>{busy ? "Working…" : "Recognise him"}</Act>
            {!declining && <Act quiet disabled={busy} onClick={() => setDeclining(true)} data-testid="pupil-claim-decline" aria-label={`Decline ${c.name}'s claim`}>Decline</Act>}
          </div>
        </div>
      )}
      {(waiting || c.state === "recognised") && declining && (
        <div role="group" aria-label="Decline this claim" data-testid="pupil-claim-decline-ask" style={{ marginTop: "10px" }}>
          <div style={{ ...sub(), color: D.textPrimary, marginBottom: "8px" }}>Decline this claim? The school's safeguarding officers are told that a pupil claim was declined, without his name or address.</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Act disabled={busy} onClick={onDecline} data-testid="pupil-claim-decline-confirm">{busy ? "Working…" : "Decline it"}</Act>
            <Act quiet disabled={busy} onClick={() => setDeclining(false)}>Keep it</Act>
          </div>
        </div>
      )}
      {c.state === "recognised" && !declining && !notHim && (
        <div style={{ marginTop: "10px" }}><Act quiet disabled={busy} onClick={() => setDeclining(true)} data-testid="pupil-claim-decline">Decline after all</Act></div>
      )}
      {matched && !declining && !notHim && onNotHim && (
        <div style={{ marginTop: "10px" }}><Act quiet disabled={busy} onClick={() => setNotHim(true)} data-testid="pupil-claim-not-him">{NOT_HIM.button}</Act></div>
      )}
      {matched && notHim && (
        <div role="group" aria-label={NOT_HIM.button} data-testid="pupil-claim-not-him-ask" style={{ marginTop: "10px" }}>
          <div style={{ ...sub(), color: D.textPrimary, marginBottom: "8px" }}>{NOT_HIM.ask}</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Act disabled={busy} onClick={onNotHim} data-testid="pupil-claim-not-him-confirm">{busy ? "Working…" : NOT_HIM.confirm}</Act>
            <Act quiet disabled={busy} onClick={() => setNotHim(false)}>Keep it</Act>
          </div>
        </div>
      )}
    </li>
  );
}

/** One school's list. */
function SchoolClaims({ school, players }) {
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState(/** @type {{ tone: "ok" | "error", text: string } | null} */ (null));
  useEffect(() => {
    let off = false;
    api(`/api/pupil-claims?schoolId=${encodeURIComponent(school.id)}`)
      .then((r) => { if (!off) setRows(r?.rows ?? []); })
      .catch((e) => { if (!off) { setRows([]); setNote({ tone: "error", text: officeWords(e) }); } });
    return () => { off = true; };
  }, [school.id, nonce]);
  const act = async (/** @type {any} */ c, /** @type {string} */ what, /** @type {any} */ body) => {
    setBusy(c.id); setNote(null);
    try {
      await api(`/api/pupil-claims/${encodeURIComponent(c.id)}/${what}`, { method: "POST", body });
      setNote({ tone: "ok", text: what === "recognise" ? `Recognised ${c.name}. Nothing about him is opened by it.`
                              : what === "not-him" ? NOT_HIM.done : `Declined. The safeguarding officers have been told, without his name.` });
    } catch (e) { setNote({ tone: "error", text: officeWords(e) }); }
    setBusy(null); setNonce((n) => n + 1);
  };
  const due = (rows ?? []).filter((r) => r.keepUntil && r.keepUntil < todayIso() && r.state !== "open").length;
  const clear = async () => {
    setBusy("clear"); setNote(null);
    try {
      const r = await api("/api/pupil-claims/clear", { method: "POST", body: { schoolId: school.id } });
      const n = Number(r?.removed ?? 0);
      setNote({ tone: "ok", text: n === 1 ? "Removed 1 account." : `Removed ${n} accounts.` });
    } catch (e) { setNote({ tone: "error", text: officeWords(e) }); }
    setBusy(null); setNonce((n) => n + 1);
  };
  const list = rows ?? [];
  const waiting = list.filter((r) => r.state === "with_office").length;
  return (
    <div data-testid="pupil-claims-school" data-school={school.id} style={{ marginTop: "10px" }}>
      {rows === null && <div style={sub()}>Reading the list…</div>}
      {rows !== null && list.length === 0 && <div data-testid="pupil-claims-none" style={sub()}>No pupil has sent a claim.</div>}
      {list.length > 0 && (
        <>
          <div style={sub()} data-testid="pupil-claims-count">{waiting === 1 ? "1 pupil is waiting to be recognised." : `${waiting} pupils are waiting to be recognised.`}</div>
          <ul style={{ margin: "8px 0 0", padding: 0, display: "grid", gap: "8px" }}>
            {list.map((c) => (
              <PupilClaimRow key={c.id} c={c} players={players} school={school.id} busy={busy === c.id}
                onRecognise={(playerId) => act(c, "recognise", { playerId })} onDecline={() => act(c, "decline")}
                onNotHim={() => act(c, "not-him")}/>
            ))}
          </ul>
        </>
      )}
      {due > 0 && (
        <div style={{ marginTop: "10px" }}>
          <div style={sub()}>An account is kept 30 days from its last claim while a parent's or guardian's yes is sought. Removing it removes its sign-in and the schools it follows; it cannot be undone.</div>
          <Act disabled={busy === "clear"} onClick={clear} data-testid="pupil-claims-clear">{busy === "clear" ? "Removing…" : clearWords(due)}</Act>
        </div>
      )}
      {note && (
        <div role={note.tone === "error" ? "alert" : "status"} data-testid={note.tone === "error" ? "pupil-claims-error" : "pupil-claims-done"}
          style={{ ...sub(), marginTop: "10px", color: note.tone === "error" ? textOn(D.rose) : D.textPrimary }}>{note.text}</div>
      )}
    </div>
  );
}

/**
 * The panel: one list per school where this person answers pupil claims.
 * `players` is the office's roster read (Settings' own), for the picker.
 * @param {{ players: any[] }} p
 */
export function PupilClaimsPanel({ players }) {
  const schools = schoolsWhere("guardian.link.manage");
  if (schools.length === 0) return null;
  return (
    <section data-testid="pupil-claims" aria-labelledby="pupil-claims-h"
      style={{ marginBottom: "16px", padding: "16px", borderRadius: D.lg, border: `1px solid ${D.border}`, background: D.surf1 }}>
      <h2 id="pupil-claims-h" style={{ margin: 0, fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>Pupil claims</h2>
      <div style={{ ...sub(), margin: "3px 0 6px", maxWidth: "62ch" }}>{OFFICE_INTRO}</div>
      {schools.map((s) => (
        <div key={s.id}>
          {schools.length > 1 && <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary, marginTop: "10px" }}>{s.name}</div>}
          <SchoolClaims school={s} players={players}/>
        </div>
      ))}
    </section>
  );
}
