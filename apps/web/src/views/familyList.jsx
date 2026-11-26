import { useEffect, useId, useState } from "react";
import { D, T, inkOn, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";
import { rosterMatches } from "../lib/pupilClaim.js";
import {
  FAMILY_INTRO, KIND_WORDS, RELATIONSHIP_CHOICES, clearWords, familyListError, rowStateWords, switchWords, uploadWords,
} from "../lib/familyList.js";
import { EndRoleButton } from "./endrole.jsx";

// ══════════════════════════════════════════════════════
//  THE FAMILY LIST  (Settings → People; SCRBRD-140 honesty model, Migration C; db/174)
//
//  The office lists, in advance, who may be linked to which child: a child
//  picked from the roster (by id, never typed), an email address, and
//  whether it is a parent's or guardian's address or the pupil's own. A
//  person who signs in with Google at that address and types the child's
//  date of birth is confirmed by it: at once where the school has switched
//  that on (Q1), otherwise in Requests, marked. Each row is used once.
//
//  Who sees the list is the database's: family_register_rows() answers the
//  office and the principal (guardian.link.manage) at that school and
//  nobody else, never a support hour, the owner's key or a pad. The upload
//  is checked first (Check) and listed only when every row passes (List).
//  A row that linked keeps End role beside it while the link is live.
// ══════════════════════════════════════════════════════

const sub = () => ({ fontFamily: D.body, fontSize: "13px", lineHeight: 1.5, color: D.textSecondary });
const field = () => ({ minHeight: "44px", padding: "10px 12px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf1,
  color: D.textPrimary, fontFamily: D.body, fontSize: T.role.control.fontSize, boxSizing: "border-box", width: "100%" });
const label = () => ({ ...sub(), fontWeight: 700, color: D.textPrimary });

function Act({ children, quiet, disabled, ...rest }) {
  return (
    <button type="button" className="pressBtn" disabled={disabled} {...rest}
      style={{ minHeight: "44px", padding: "10px 16px", borderRadius: D.pill, boxSizing: "border-box",
        border: `1px solid ${quiet ? D.border : "transparent"}`, background: quiet ? "transparent" : D.indigo,
        color: quiet ? D.textSecondary : inkOn(D.indigo), fontFamily: D.head, fontSize: "13px", fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1 }}>{children}</button>
  );
}

const blank = () => ({ playerId: "", email: "", kind: "guardian", relationship: "parent", validUntil: "" });

/** The rows being put together, with the check's answer beside each. */
function Draft({ school, players, onListed }) {
  const [rows, setRows] = useState([blank()]);
  const [q, setQ] = useState([""]);
  const [report, setReport] = useState(/** @type {any} */ (null));
  const [acks, setAcks] = useState(/** @type {string[]} */ ([]));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(/** @type {{ tone: "ok" | "error", text: string } | null} */ (null));
  const base = useId();
  const setRow = (i, k, v) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setReport(null); setNote(null); };
  const send = async (commit) => {
    setBusy(true); setNote(null);
    try {
      const body = { rows: rows.map((r, i) => ({ line: i + 1, playerId: r.playerId, email: r.email, kind: r.kind,
                                                 ...(r.kind === "guardian" ? { relationship: r.relationship } : {}),
                                                 ...(r.validUntil ? { validUntil: r.validUntil } : {}) })),
                     commit, acknowledged: acks };
      const out = await api(`/api/family-list/${encodeURIComponent(school.id)}`, { method: "POST", body });
      setReport(out);
      setNote({ tone: out.ok ? "ok" : "error", text: uploadWords(out) });
      if (out.committed) { setRows([blank()]); setQ([""]); setAcks([]); setReport(null); onListed(); }
    } catch (e) { setNote({ tone: "error", text: familyListError(e) }); }
    setBusy(false);
  };
  const answer = (i) => report?.rows?.find((x) => x.line === i + 1) ?? null;
  const ready = rows.every((r) => r.playerId && r.email.trim());
  return (
    <div data-testid="family-list-draft" style={{ display: "grid", gap: "10px", marginTop: "10px" }}>
      {rows.map((r, i) => {
        const a = answer(i);
        const matches = rosterMatches(players, school.id, q[i] ?? "");
        return (
          <fieldset key={i} data-testid="family-list-draft-row" style={{ margin: 0, padding: "12px", borderRadius: D.md, border: `1px solid ${D.border}`, display: "grid", gap: "8px", minWidth: 0 }}>
            <legend style={label()}>Row {i + 1}</legend>
            <label htmlFor={`${base}-q${i}`} style={label()}>Find the child on your list</label>
            <input id={`${base}-q${i}`} value={q[i] ?? ""} autoComplete="off" data-testid="family-list-search" style={field()}
              onChange={(e) => { const v = e.target.value; setQ((xs) => xs.map((x, j) => (j === i ? v : x))); }}/>
            <label htmlFor={`${base}-p${i}`} style={label()}>The child</label>
            <select id={`${base}-p${i}`} value={r.playerId} onChange={(e) => setRow(i, "playerId", e.target.value)} data-testid="family-list-child" style={field()}>
              <option value="">Choose…</option>
              {matches.map((p) => <option key={p.id} value={p.id}>{p.name}{p.team ? ` (${p.team})` : ""}</option>)}
            </select>
            <label htmlFor={`${base}-k${i}`} style={label()}>Whose address</label>
            <select id={`${base}-k${i}`} value={r.kind} onChange={(e) => setRow(i, "kind", e.target.value)} data-testid="family-list-kind" style={field()}>
              <option value="guardian">{KIND_WORDS.guardian}</option>
              <option value="pupil">{KIND_WORDS.pupil}</option>
            </select>
            {r.kind === "guardian" && <>
              <label htmlFor={`${base}-r${i}`} style={label()}>Relationship</label>
              <select id={`${base}-r${i}`} value={r.relationship} onChange={(e) => setRow(i, "relationship", e.target.value)} data-testid="family-list-relationship" style={field()}>
                {RELATIONSHIP_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </>}
            <label htmlFor={`${base}-e${i}`} style={label()}>Email address (the one they sign in to Google with)</label>
            <input id={`${base}-e${i}`} type="email" value={r.email} onChange={(e) => setRow(i, "email", e.target.value)} autoComplete="off" data-testid="family-list-email" style={field()}/>
            <label htmlFor={`${base}-u${i}`} style={label()}>Claim by (optional: the end of the season)</label>
            <input id={`${base}-u${i}`} type="date" value={r.validUntil} onChange={(e) => setRow(i, "validUntil", e.target.value)} data-testid="family-list-until" style={field()}/>
            {a?.words && <div role="alert" data-testid="family-list-problem" style={{ ...sub(), color: textOn(D.rose) }}>{a.words}</div>}
            {a?.warningWords && (
              <label style={{ display: "flex", gap: "8px", alignItems: "center", minHeight: "44px", ...sub(), color: D.textPrimary }}>
                <input type="checkbox" checked={acks.includes(a.ack)} data-testid="family-list-ack" style={{ width: "20px", height: "20px", flexShrink: 0 }}
                  onChange={(e) => setAcks((xs) => (e.target.checked ? [...xs, a.ack] : xs.filter((x) => x !== a.ack)))}/>
                {a.warningWords}
              </label>
            )}
            {rows.length > 1 && <div><Act quiet onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setQ((xs) => xs.filter((_, j) => j !== i)); setReport(null); }}>Remove this row</Act></div>}
          </fieldset>
        );
      })}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Act quiet disabled={busy || rows.length >= 50} onClick={() => { setRows((rs) => [...rs, blank()]); setQ((xs) => [...xs, ""]); setReport(null); }}>Add a row</Act>
        <Act quiet disabled={busy || !ready} onClick={() => send(false)} data-testid="family-list-check">{busy ? "Checking…" : "Check"}</Act>
        <Act disabled={busy || !ready || !report?.ok} onClick={() => send(true)} data-testid="family-list-commit">{busy ? "Listing…" : "List these rows"}</Act>
      </div>
      {note && (
        <div role={note.tone === "error" ? "alert" : "status"} data-testid={note.tone === "error" ? "family-list-error" : "family-list-done"}
          style={{ ...sub(), color: note.tone === "error" ? textOn(D.rose) : D.textPrimary }}>{note.text}</div>
      )}
    </div>
  );
}

/** One school's list, and its rows. */
function SchoolFamilyList({ school, players }) {
  const [data, setData] = useState(/** @type {{ linksAtOnce: boolean, rows: any[] } | null} */ (null));
  const [due, setDue] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState(/** @type {{ tone: "ok" | "error", text: string } | null} */ (null));
  useEffect(() => {
    let off = false;
    api(`/api/family-list/${encodeURIComponent(school.id)}`)
      .then((r) => { if (!off) setData({ linksAtOnce: r?.linksAtOnce === true, rows: r?.rows ?? [] }); })
      .catch((e) => { if (!off) { setData({ linksAtOnce: false, rows: [] }); setNote({ tone: "error", text: familyListError(e) }); } });
    api(`/api/family-list/${encodeURIComponent(school.id)}/redact`)
      .then((r) => { if (!off) setDue(Number(r?.count ?? 0)); })
      .catch(() => { if (!off) setDue(0); });
    return () => { off = true; };
  }, [school.id, nonce]);
  const withdraw = async (r) => {
    setBusy(r.id); setNote(null);
    try {
      await api(`/api/family-list/rows/${encodeURIComponent(r.id)}/withdraw`, { method: "POST", body: {} });
      setNote({ tone: "ok", text: "Withdrawn. That row can no longer be claimed." });
    } catch (e) { setNote({ tone: "error", text: familyListError(e) }); }
    setBusy(null); setNonce((n) => n + 1);
  };
  const clear = async () => {
    setBusy("clear"); setNote(null);
    try {
      const r = await api(`/api/family-list/${encodeURIComponent(school.id)}/redact`, { method: "POST", body: {} });
      const n = Number(r?.cleared ?? 0);
      setNote({ tone: "ok", text: n === 1 ? "Cleared 1 row's address." : `Cleared ${n} rows' addresses.` });
    } catch (e) { setNote({ tone: "error", text: familyListError(e) }); }
    setBusy(null); setNonce((n) => n + 1);
  };
  const rows = data?.rows ?? [];
  return (
    <div data-testid="family-list-school" data-school={school.id} style={{ marginTop: "10px" }}>
      {data && <div data-testid="family-list-switch" data-on={data.linksAtOnce ? "yes" : "no"} style={sub()}>{switchWords(data.linksAtOnce)}</div>}
      <Draft school={school} players={players} onListed={() => setNonce((n) => n + 1)}/>
      {data === null && <div style={sub()}>Reading the list…</div>}
      {data !== null && rows.length === 0 && <div data-testid="family-list-none" style={{ ...sub(), marginTop: "10px" }}>Nothing is listed yet.</div>}
      {rows.length > 0 && (
        <ul style={{ margin: "12px 0 0", padding: 0, display: "grid", gap: "8px" }}>
          {rows.map((r) => (
            <li key={r.id} data-testid="family-list-row" data-row={r.id} data-state={r.state}
              style={{ listStyle: "none", padding: "12px 14px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf2 + "66" }}>
              <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary, overflowWrap: "anywhere" }}>
                {r.player_name ?? "A child no longer on your list"}{r.team_code ? <span style={{ fontWeight: 400, color: D.textSecondary }}> · {r.team_code}</span> : null}
              </div>
              <div style={{ ...sub(), overflowWrap: "anywhere" }}>{KIND_WORDS[r.kind] ?? r.kind}{r.relationship ? ` (${r.relationship})` : ""}: <span style={{ color: D.textPrimary }}>{r.redacted_at ? "address cleared" : r.email}</span></div>
              <div style={sub()}><span data-testid="family-list-state">{rowStateWords(r)}</span>{r.state === "open" ? ` · claim by ${r.valid_until}` : ""}{r.uploaded_by_name ? ` · listed by ${r.uploaded_by_name}` : ""}</div>
              {r.state === "open" && (
                <div style={{ marginTop: "8px" }}><Act quiet disabled={busy === r.id} onClick={() => withdraw(r)} data-testid="family-list-withdraw">{busy === r.id ? "Working…" : "Withdraw"}</Act></div>
              )}
              {r.live_assignment && (
                <div style={{ marginTop: "8px" }}>
                  <EndRoleButton assignment={{ id: r.live_assignment, role: r.kind === "pupil" ? "player" : "guardian", person_name: r.claimed_by_name, active: true }}
                    onEnded={() => setNonce((n) => n + 1)}/>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {due > 0 && (
        <div style={{ marginTop: "10px" }}>
          <div style={sub()}>A row's address is cleared 90 days after its claim-by date or its withdrawal; once used, 90 days after the request was answered; once it made a link, 90 days after the link ends. The child, the kind and who listed it stay on the record.</div>
          <Act disabled={busy === "clear"} onClick={clear} data-testid="family-list-clear">{busy === "clear" ? "Clearing…" : clearWords(due)}</Act>
        </div>
      )}
      {note && (
        <div role={note.tone === "error" ? "alert" : "status"} data-testid={note.tone === "error" ? "family-list-row-error" : "family-list-row-done"}
          style={{ ...sub(), marginTop: "10px", color: note.tone === "error" ? textOn(D.rose) : D.textPrimary }}>{note.text}</div>
      )}
    </div>
  );
}

/**
 * The panel: one list per school where this person links parents
 * (guardian.link.manage). `players` is the office's roster read (Settings'
 * own), for the picker.
 * @param {{ players: any[] }} p
 */
export function FamilyListPanel({ players }) {
  const schools = schoolsWhere("guardian.link.manage");
  if (schools.length === 0) return null;
  return (
    <section data-testid="family-list" aria-labelledby="family-list-h"
      style={{ marginBottom: "16px", padding: "16px", borderRadius: D.lg, border: `1px solid ${D.border}`, background: D.surf1 }}>
      <h2 id="family-list-h" style={{ margin: 0, fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>Family list</h2>
      <div style={{ ...sub(), margin: "3px 0 6px", maxWidth: "62ch" }}>{FAMILY_INTRO}</div>
      {schools.map((s) => (
        <div key={s.id}>
          {schools.length > 1 && <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary, marginTop: "10px" }}>{s.name}</div>}
          <SchoolFamilyList school={s} players={players}/>
        </div>
      ))}
    </section>
  );
}
