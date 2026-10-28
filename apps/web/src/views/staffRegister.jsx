import { useCallback, useEffect, useState } from "react";
import { compareTeams, teamsForLevel } from "@scrbrd/policy/teams";
import { ROLES } from "../design/roles.js";
import { D, T, textOn } from "../design/tokens.js";
import { Card, EmptyState } from "../ui/primitives.jsx";
import { api, signedIn } from "../lib/api.js";
import { holdsCapability } from "../rbac/index.js";
import { grantableFor, useAssignableSchools } from "./enrol.jsx";
import {
  ADULTS_ONLY, MAX_FILE_BYTES, STAFF_TEMPLATE_CSV, STATES, checkWords, clearAsk, clearLabel, clearedWords, dayWords,
  importedWords, isCleared, listableRoles, listedWords, mayCommit, needsSide, previewRows, problemRows, registerErrorWords,
  roleLine, rowFromForm, rowsKey, sourceKey, stateWords, warnedRows, withdrawAsk,
} from "../lib/staffRegister.js";

/**
 * Settings → Import → Staff register (SCRBRD-140 phase 2;
 * docs/design/SCRBRD-140_phase2_register.md §5).
 *
 *   POST /api/register/:school            { csv | rows, commit?, acknowledged? }
 *   GET  /api/register/:school?state=
 *   POST /api/register/rows/:id/withdraw
 *   GET|POST /api/register/:school/redact
 *
 * The office lists the adults who work at its school in advance. A staff
 * member who signs in with Google and chooses the school is granted what was
 * listed for the address Google verified. This screen is the office's side:
 * Check a file (or one person), read every line's problem in words, tick the
 * warnings, Import; then the list, with Withdraw on an open row and "Clear N
 * expired rows" when any are due.
 *
 * WHAT THIS SCREEN DECIDES: nothing about authority. The tab is drawn for
 * whoever holds user.role.assign (READERS_child_data Q2, 21 Oct 2026, db/116:
 * audit.read opens the access log and nothing else, so an auditor no longer
 * reads the list); register_upload() and its neighbours decide again on
 * every call. Nothing of the file is kept here: it
 * is read in the browser, sent, and dropped with the page, and the report is
 * drawn from what the server answered. The register holds adults only.
 *
 * Floors: nothing under 12px, nothing tapped under 44px.
 */

/** Can this person see the register at all? A courtesy: the server decides. */
// The office's key alone: school_register_rows() asks user.role.assign at the
// school and nothing else (db/116), so an auditor and a DSO are not drawn it.
export const canSeeRegister = (role) => holdsCapability(role, "user.role.assign");

const LABEL = () => ({ display: "block", fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted,
                       letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px" });
const SUB = () => ({ fontFamily: D.body, fontSize: "13px", color: D.textMuted, lineHeight: 1.5 });
const FIELD = () => ({ width: "100%", minHeight: "44px", boxSizing: "border-box", padding: "10px 12px", background: D.surf2,
                       border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: "14px" });
const BTN = (primary, disabled) => ({ minHeight: "44px", minWidth: "44px", padding: "0 20px", borderRadius: D.pill, cursor: disabled ? "not-allowed" : "pointer",
  fontFamily: D.head, fontSize: "13px", fontWeight: 700, letterSpacing: "0.04em", opacity: disabled ? 0.45 : 1,
  background: primary ? D.gradMain : "transparent", color: primary ? T.light.ink : D.textPrimary,
  border: `1px solid ${primary ? "transparent" : D.border}` });
const HEAD = () => ({ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary });

export function StaffRegisterPanel({ role }) {
  // Signed out is the demonstration: the Import panel beside it says so, and there is no register to read.
  if (!canSeeRegister(role) || !signedIn()) return null;
  return <RegisterLive role={role}/>;
}

function RegisterLive({ role }) {
  const assign = useAssignableSchools();
  // Every school this person may open the register at: where they hold the office's key.
  const schools = assign.schools;
  const [schoolId, setSchoolId] = useState("");
  const school = schools.find((s) => s.id === schoolId)?.id ?? schools[0]?.id ?? "";
  const mayWrite = assign.schools.some((s) => s.id === school);
  const [nonce, setNonce] = useState(0);
  const changed = () => setNonce((n) => n + 1);

  return (
    <Card sx={{ padding: "16px", marginTop: "16px" }} data-testid="register-panel">
      <div style={HEAD()}>Staff register</div>
      <div style={{ ...SUB(), marginTop: "4px", marginBottom: "4px", maxWidth: "70ch" }}>
        List the people who will join your school, and they join the moment they sign in with Google and choose the school.
        Nothing is given to anybody who is not listed.
      </div>
      <div style={{ ...SUB(), color: D.textPrimary, fontWeight: 600, marginBottom: "16px" }} data-testid="register-rule">{ADULTS_ONLY}</div>

      {schools.length === 0 && <div role="alert" style={{ ...SUB(), color: textOn(D.rose) }}>{assign.ready ? "You hold no role that may open a school's register." : "Loading…"}</div>}
      {schools.length > 1 && (
        <div style={{ maxWidth: "620px", marginBottom: "16px" }}>
          <label htmlFor="register-school" style={LABEL()}>School</label>
          <select id="register-school" data-testid="register-school" value={school} style={FIELD()} onChange={(e) => setSchoolId(e.target.value)}>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      {schools.length === 1 && <div style={{ ...SUB(), marginBottom: "16px" }} data-testid="register-school-one">At: {schools[0].name}</div>}

      {school && mayWrite && <Upload role={role} school={school} onListed={changed}/>}
      {school && !mayWrite && (
        <div data-testid="register-readonly" style={{ ...SUB(), marginBottom: "16px" }}>You can read the register. Listing and withdrawing people needs permission to appoint staff here.</div>
      )}
      {school && <RegisterList school={school} mayWrite={mayWrite} nonce={nonce} onChanged={changed}/>}
      {school && mayWrite && <Clear school={school} nonce={nonce} onCleared={changed}/>}
    </Card>
  );
}

// ── Upload: Check, then Import ───────────────────────────────────────────────
function Upload({ role, school, onListed }) {
  const [mode, setMode] = useState(/** @type {"file" | "person"} */ ("file"));
  const [file, setFile] = useState(/** @type {{ name: string, text: string } | null} */ (null));
  const [f, setF] = useState({ name: "", email: "", role: "", team: "", until: "" });
  const set = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value, ...(k === "role" ? { team: "" } : {}) })); setProblem(""); };
  const [checked, setChecked] = useState(/** @type {import("../lib/staffRegister.js").RegisterChecked | null} */ (null));
  const [labels, setLabels] = useState(/** @type {Record<number, { name: string, email: string }>} */ ({}));
  const [ticked, setTicked] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [busy, setBusy] = useState(/** @type {"check" | "import" | null} */ (null));
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState("");
  const [saidTemplate, setSaidTemplate] = useState("");

  const roles = listableRoles(grantableFor(role));
  const teams = [...teamsForLevel("school")].sort(compareTeams);

  // What a Check counts for is the very file (or row) and school it read.
  const built = mode === "person" ? rowFromForm(f) : null;
  const rows = built?.ok ? [built.row] : null;
  const key = mode === "file" ? (file ? sourceKey(file.text) : null) : (rows ? rowsKey(rows) : null);
  const now = { school, key };
  const acknowledged = Object.keys(ticked).filter((a) => ticked[a]);
  const offered = mayCommit(checked, now, acknowledged);
  const shown = checked && checked.school === school && checked.key === key ? checked.report : null;
  const warned = shown ? warnedRows(shown) : [];

  const wipe = () => { setProblem(""); setResult(""); };
  const pick = async (ev) => {
    wipe(); setChecked(null); setTicked({});
    const picked = ev.target.files?.[0];
    if (!picked) { setFile(null); return; }
    if (picked.size > MAX_FILE_BYTES) { setFile(null); setProblem("That file is too large. A register file holds at most 200 people."); return; }
    setFile({ name: picked.name, text: await picked.text() });
  };

  const body = () => (mode === "file" ? { csv: file?.text } : { rows });
  const run = async (commit) => {
    if (key == null) { if (mode === "person" && built && !built.ok) setProblem(built.problem); return; }
    setBusy(commit ? "import" : "check"); wipe();
    try {
      const report = await api(`/api/register/${encodeURIComponent(school)}`, { method: "POST", timeoutMs: 60000,
        body: { ...body(), ...(commit ? { commit: true, acknowledged } : {}) } });
      if (commit && report?.committed === true) {
        setResult(importedWords(report)); setChecked(null); setTicked({}); setFile(null);
        setF({ name: "", email: "", role: "", team: "", until: "" });
        onListed();
      } else {
        setChecked({ school, key, report });
        if (!commit) setTicked({});
        // Name each line from the file the person chose (display only; the server counted).
        if (mode === "file" && file) setLabels(Object.fromEntries(previewRows(file.text).map((r) => [r.line, r])));
        else if (rows) setLabels({ 1: { name: String(rows[0].name), email: String(rows[0].email) } });
      }
    } catch (e) {
      setProblem(registerErrorWords(e));
      if (!commit) setChecked(null);
    } finally { setBusy(null); }
  };

  const template = () => {
    setSaidTemplate("");
    try {
      const url = URL.createObjectURL(new Blob([STAFF_TEMPLATE_CSV], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url; a.download = "scrbrd-staff-register-template.csv"; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { setSaidTemplate("The template could not be downloaded. Try again."); }
  };

  const modeBtn = (id, label) => (
    <button type="button" className="pressBtn" aria-pressed={mode === id} data-testid={`register-mode-${id}`}
            onClick={() => { setMode(id); wipe(); setChecked(null); setTicked({}); }}
            style={{ ...BTN(false, false), background: mode === id ? D.surf2 : "transparent", borderColor: mode === id ? D.textSecondary : D.border }}>{label}</button>
  );

  return (
    <div style={{ display: "grid", gap: "16px", maxWidth: "620px", marginBottom: "24px" }} data-testid="register-upload">
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }} role="group" aria-label="How to list people">
        {modeBtn("file", "From a file")}
        {modeBtn("person", "One person")}
      </div>

      {mode === "file" && (
        <>
          <div>
            <button type="button" className="pressBtn" onClick={template} data-testid="register-template" style={BTN(false, false)}>Download the template</button>
            {saidTemplate && <div role="alert" style={{ ...SUB(), color: textOn(D.rose), marginTop: "6px" }}>{saidTemplate}</div>}
            <div style={{ ...SUB(), marginTop: "6px" }}>One person per line: name, email, role, side (for a coach or team manager) and, if you want one, the date they must join by.</div>
          </div>
          <div>
            <label htmlFor="register-file" style={LABEL()}>CSV file</label>
            <input id="register-file" type="file" accept=".csv,text/csv,text/plain" onChange={pick} data-testid="register-file"
                   style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary, minHeight: "44px", maxWidth: "100%" }}/>
          </div>
        </>
      )}

      {mode === "person" && (
        <div style={{ display: "grid", gap: "14px" }} data-testid="register-form">
          <div>
            <label htmlFor="register-name" style={LABEL()}>Full name</label>
            <input id="register-name" data-testid="register-name" value={f.name} onChange={set("name")} style={FIELD()} autoComplete="off"/>
          </div>
          <div>
            <label htmlFor="register-email" style={LABEL()}>Google address</label>
            <input id="register-email" data-testid="register-email" type="email" value={f.email} onChange={set("email")} style={FIELD()} autoComplete="off"/>
            <div style={{ ...SUB(), marginTop: "4px" }}>The address they will sign in to Google with. A different address will not match.</div>
          </div>
          <div>
            <label htmlFor="register-role" style={LABEL()}>What they do at the school</label>
            <select id="register-role" data-testid="register-role" value={f.role} onChange={set("role")} style={FIELD()}>
              <option value="">Choose…</option>
              {roles.map((r) => <option key={r} value={r}>{ROLES[r]?.label ?? r}</option>)}
            </select>
            <div style={{ ...SUB(), marginTop: "4px" }}>Medical staff, the safeguarding officer and anybody who reads a child's private records are added from People, in person.</div>
          </div>
          {needsSide(f.role) && (
            <div>
              <label htmlFor="register-team" style={LABEL()}>Which side</label>
              <select id="register-team" data-testid="register-team" value={f.team} onChange={set("team")} style={FIELD()}>
                <option value="">Choose a side…</option>
                {teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="register-until" style={LABEL()}>Join by (optional)</label>
            <input id="register-until" data-testid="register-until" type="date" value={f.until} onChange={set("until")} style={FIELD()}/>
            <div style={{ ...SUB(), marginTop: "4px" }}>After this date the listing no longer works. Empty means the end of the season.</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button type="button" className="pressBtn" onClick={() => run(false)} disabled={busy != null || (mode === "file" && !file)}
                data-testid="register-check" style={BTN(false, busy != null || (mode === "file" && !file))}>{busy === "check" ? "Checking…" : "Check"}</button>
        <button type="button" className="pressBtn" onClick={() => run(true)} disabled={!offered || busy != null}
                data-testid="register-import" style={BTN(true, !offered || busy != null)}>{busy === "import" ? "Importing…" : "Import"}</button>
      </div>

      {problem && <div role="alert" data-testid="register-problem" style={{ ...SUB(), color: textOn(D.rose) }}>{problem}</div>}

      {shown && (
        <div data-testid="register-report" data-clean={problemRows(shown).length === 0 ? "yes" : "no"} style={{ display: "grid", gap: "8px" }}>
          <div role={problemRows(shown).length === 0 && shown.rows.length > 0 ? "status" : "alert"} data-testid="register-summary"
               style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600,
                        color: textOn(problemRows(shown).length === 0 && shown.rows.length > 0 ? D.emerald : D.rose) }}>
            {checkWords(shown, warned.filter((r) => ticked[r.ack]).length)}
          </div>
          {shown.rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table data-testid="register-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <caption className="sr-only">What the Check read, one line per person</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ ...LABEL(), textAlign: "left", padding: "6px 8px 6px 0" }}>Row</th>
                    <th scope="col" style={{ ...LABEL(), textAlign: "left", padding: "6px 8px" }}>Person</th>
                    <th scope="col" style={{ ...LABEL(), textAlign: "left", padding: "6px 0 6px 8px" }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.rows.map((r) => (
                    <tr key={r.line} data-testid={`register-line-${r.line}`} data-ok={r.ok ? "yes" : "no"} style={{ borderTop: `1px solid ${D.border}` }}>
                      <td style={{ padding: "10px 8px 10px 0", verticalAlign: "top", fontFamily: D.mono, fontSize: "12px", color: D.textMuted }}>{r.line}</td>
                      <td style={{ padding: "10px 8px", verticalAlign: "top", fontFamily: D.body, fontSize: "13px", color: D.textPrimary, overflowWrap: "anywhere" }}>
                        {labels[r.line]?.name || "—"}
                        {labels[r.line]?.email && <div style={{ ...SUB(), fontFamily: D.mono, fontSize: "12px" }}>{labels[r.line].email}</div>}
                      </td>
                      <td style={{ padding: "10px 0 10px 8px", verticalAlign: "top", fontFamily: D.body, fontSize: "13px", color: D.textPrimary }}>
                        {!r.ok && <span data-testid="register-line-problem" style={{ color: textOn(D.rose) }}>{r.words}</span>}
                        {r.ok && !r.warning && <span style={{ color: textOn(D.emerald) }}>Ready to list</span>}
                        {r.ok && r.warning && (
                          <label style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", cursor: "pointer" }}>
                            <input type="checkbox" data-testid={`register-warning-${r.line}`} checked={!!ticked[r.ack]}
                                   onChange={(e) => setTicked((t) => ({ ...t, [r.ack]: e.target.checked }))}
                                   style={{ width: "22px", height: "22px", flexShrink: 0 }}/>
                            <span>{r.warningWords}</span>
                          </label>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {result && <div role="status" data-testid="register-result" style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600, color: textOn(D.emerald) }}>{result}</div>}
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────
function RegisterList({ school, mayWrite, nonce, onChanged }) {
  const [state, setState] = useState("open");
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  const [problem, setProblem] = useState("");
  const [confirming, setConfirming] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  useEffect(() => {
    let off = false;
    setRows(null); setProblem("");
    api(`/api/register/${encodeURIComponent(school)}?state=${encodeURIComponent(state)}`)
      .then((r) => { if (!off) setRows(r?.rows ?? []); })
      .catch((e) => { if (!off) { setRows([]); setProblem(registerErrorWords(e)); } });
    return () => { off = true; };
  }, [school, state, nonce]);

  const withdraw = useCallback(async (/** @type {any} */ r) => {
    setBusy(true); setProblem(""); setDone("");
    try {
      await api(`/api/register/rows/${encodeURIComponent(r.id)}/withdraw`, { method: "POST" });
      setConfirming(null); setDone(`Withdrawn: ${r.name} is off the register.`); onChanged();
    } catch (e) { setProblem(registerErrorWords(e)); }
    setBusy(false);
  }, [onChanged]);

  const label = STATES.find((s) => s.id === state)?.label.toLowerCase();
  return (
    <div data-testid="register-list-section" style={{ marginBottom: "24px" }}>
      <div style={{ ...HEAD(), marginBottom: "8px" }}>Who is listed</div>
      <div role="group" aria-label="Show" style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
        {STATES.map((s) => (
          <button key={s.id} type="button" className="pressBtn" aria-pressed={state === s.id} data-testid={`register-filter-${s.id}`}
                  onClick={() => { setState(s.id); setConfirming(null); setDone(""); }}
                  style={{ ...BTN(false, false), background: state === s.id ? D.surf2 : "transparent", borderColor: state === s.id ? D.textSecondary : D.border }}>{s.label}</button>
        ))}
      </div>
      {problem && <div role="alert" data-testid="register-list-problem" style={{ ...SUB(), color: textOn(D.rose), marginBottom: "8px" }}>{problem}</div>}
      {done && <div role="status" data-testid="register-withdrawn" style={{ ...SUB(), color: textOn(D.emerald), fontWeight: 600, marginBottom: "8px" }}>{done}</div>}
      {rows === null && <div style={SUB()}>Loading…</div>}
      {rows && rows.length === 0 && !problem && (
        <EmptyState icon="users" message={`Nobody is ${label} on this register.`}/>
      )}
      {rows && rows.length > 0 && (
        <ul data-testid="register-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
          {rows.map((r) => (
            <li key={r.id} data-testid={`register-row-${r.id}`} data-state={r.state}
                style={{ padding: "12px 14px", border: `1px solid ${D.border}`, borderRadius: D.md, display: "grid", gap: "4px" }}>
              <div style={{ fontFamily: D.body, fontSize: "14px", fontWeight: 600, color: D.textPrimary, overflowWrap: "anywhere" }}>
                {isCleared(r) ? "Name cleared" : r.name}
              </div>
              {!isCleared(r) && <div style={{ ...SUB(), fontFamily: D.mono, fontSize: "12px", overflowWrap: "anywhere" }}>{r.email}</div>}
              <div style={{ ...SUB(), color: D.textPrimary }}>{roleLine(r.role, r.team_code)}</div>
              <div data-testid="register-row-state" style={{ ...SUB(), color: D.textPrimary, fontWeight: 600 }}>{stateWords(r)}</div>
              <div style={SUB()}>{listedWords(r)}</div>
              {isCleared(r) && <div style={SUB()}>Name and email cleared {dayWords(r.redacted_at)}.</div>}
              {mayWrite && r.state === "open" && confirming !== r.id && (
                <div>
                  <button type="button" className="pressBtn" data-testid="register-withdraw" onClick={() => { setConfirming(r.id); setDone(""); }}
                          aria-label={`Withdraw ${r.name}`} style={BTN(false, false)}>Withdraw</button>
                </div>
              )}
              {mayWrite && r.state === "open" && confirming === r.id && (
                <div role="group" aria-label={`Withdraw ${r.name}`} style={{ display: "grid", gap: "8px", marginTop: "4px" }}>
                  <div style={{ ...SUB(), color: D.textPrimary }}>{withdrawAsk(r)}</div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button type="button" className="pressBtn" data-testid="register-withdraw-confirm" disabled={busy} onClick={() => withdraw(r)}
                            style={BTN(true, busy)}>{busy ? "Withdrawing…" : "Withdraw"}</button>
                    <button type="button" className="pressBtn" data-testid="register-withdraw-cancel" disabled={busy} onClick={() => setConfirming(null)}
                            style={BTN(false, busy)}>Keep</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Clearing what has expired ────────────────────────────────────────────────
function Clear({ school, nonce, onCleared }) {
  const [due, setDue] = useState(/** @type {number | null} */ (null));
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    let off = false;
    api(`/api/register/${encodeURIComponent(school)}/redact`)
      .then((r) => { if (!off) setDue(Number(r?.count ?? 0)); })
      .catch(() => { if (!off) setDue(0); });
    return () => { off = true; };
  }, [school, nonce]);

  const clear = async () => {
    setBusy(true); setProblem("");
    try {
      const r = await api(`/api/register/${encodeURIComponent(school)}/redact`, { method: "POST" });
      setAsking(false); setDone(clearedWords(Number(r?.cleared ?? 0))); onCleared();
    } catch (e) { setProblem(registerErrorWords(e)); }
    setBusy(false);
  };

  if (!due && !done) return null;
  return (
    <div data-testid="register-clear-section" style={{ maxWidth: "620px", display: "grid", gap: "8px" }}>
      {done && <div role="status" data-testid="register-cleared" style={{ ...SUB(), color: textOn(D.emerald), fontWeight: 600 }}>{done}</div>}
      {due > 0 && !asking && (
        <div>
          <button type="button" className="pressBtn" data-testid="register-clear" onClick={() => { setAsking(true); setDone(""); }} style={BTN(false, false)}>{clearLabel(due)}</button>
        </div>
      )}
      {due > 0 && asking && (
        <div role="group" aria-label={clearLabel(due)} style={{ display: "grid", gap: "8px" }}>
          <div style={{ ...SUB(), color: D.textPrimary }}>{clearAsk(due)}</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="pressBtn" data-testid="register-clear-confirm" disabled={busy} onClick={clear} style={BTN(true, busy)}>{busy ? "Clearing…" : clearLabel(due)}</button>
            <button type="button" className="pressBtn" data-testid="register-clear-cancel" disabled={busy} onClick={() => setAsking(false)} style={BTN(false, busy)}>Keep them</button>
          </div>
        </div>
      )}
      {problem && <div role="alert" data-testid="register-clear-problem" style={{ ...SUB(), color: textOn(D.rose) }}>{problem}</div>}
    </div>
  );
}
