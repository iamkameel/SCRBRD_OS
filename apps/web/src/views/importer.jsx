import { useState } from "react";
import { D, T, textOn } from "../design/tokens.js";
import { Card, EmptyState } from "../ui/primitives.jsx";
import { api, apiBase, getToken, signedIn } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";
import { holdsCapability } from "../rbac/index.js";
import { IMPORT_KINDS, MAX_FILE_BYTES, checkSummary, errorWords, importSummary, kindsHeld, mayImport, refusalWords } from "../lib/importScreen.js";

/**
 * Settings → Import: a spreadsheet of boys, checked, then imported.
 *
 *   POST /api/import/:kind { csv, schoolId, commit }   (services/api/io/import-api.mjs)
 *   GET  /api/import/:kind/template
 *
 * WHAT THIS SCREEN DECIDES: one thing, and it is the server's rule said
 * again. Check is the dry run: nothing is written, every error comes back with
 * its line in the person's own file, in the route's own words. Import is
 * offered only after a clean Check of the same kind, school and file
 * (lib/importScreen.js mayImport), and the server refuses a file with any
 * error even if it were asked. Every row is a write under the person's own
 * policy, so a school they may not import into is refused row by row there.
 * Nothing is kept here: the file is read in the browser, sent to the route and
 * dropped with the page. This screen never draws a cell of it back.
 *
 * Floors: text 12px or more, anything tapped 44px or more.
 */

const LABEL = () => ({ display: "block", fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted,
                       letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px" });
const SUB = () => ({ fontFamily: D.body, fontSize: "12px", color: D.textMuted, lineHeight: 1.5 });
const FIELD = () => ({ width: "100%", minHeight: "44px", boxSizing: "border-box", padding: "10px 12px", background: D.surf2,
                       border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: "14px" });
const BTN = (primary, disabled) => ({ minHeight: "44px", minWidth: "44px", padding: "0 20px", borderRadius: D.pill, cursor: disabled ? "not-allowed" : "pointer",
  fontFamily: D.head, fontSize: "13px", fontWeight: 700, letterSpacing: "0.04em", opacity: disabled ? 0.45 : 1,
  background: primary ? D.gradMain : "transparent", color: primary ? T.light.ink : D.textPrimary,
  border: `1px solid ${primary ? "transparent" : D.border}` });

/** Does this person hold any kind's capability? The tab is drawn only for one who does. */
export const canImport = (role) => kindsHeld((cap) => holdsCapability(role, cap)).length > 0;

export function ImportPanel({ role }) {
  // Courtesy only: the policy decides again on every row.
  if (!canImport(role)) return null;
  if (!signedIn()) {
    return (
      <Card sx={{ padding: "16px" }} data-testid="import-panel">
        <EmptyState icon="users" message="Sign in to the live platform to import a spreadsheet."/>
      </Card>
    );
  }
  return <ImportLive role={role}/>;
}

function ImportLive({ role }) {
  const kinds = kindsHeld((cap) => holdsCapability(role, cap));
  const [kindId, setKindId] = useState(kinds[0]?.id ?? IMPORT_KINDS[0].id);
  const kind = kinds.find((k) => k.id === kindId) ?? kinds[0];
  const schools = schoolsWhere(kind.cap);
  const [schoolId, setSchoolId] = useState("");
  const school = schools.find((s) => s.id === schoolId)?.id ?? schools[0]?.id ?? "";

  const [file, setFile] = useState(/** @type {{ name: string, text: string } | null} */ (null));
  const [checked, setChecked] = useState(/** @type {import("../lib/importScreen.js").Checked | null} */ (null));
  const [busy, setBusy] = useState(/** @type {"check" | "import" | null} */ (null));
  const [result, setResult] = useState(/** @type {string | null} */ (null));
  const [refusal, setRefusal] = useState(/** @type {string | null} */ (null));
  const [saidTemplate, setSaidTemplate] = useState(/** @type {string | null} */ (null));

  const now = { kind: kind.id, schoolId: school, text: file?.text ?? null };
  // What a Check said counts only for the file, kind and school it was run on.
  const shown = checked && checked.kind === now.kind && checked.schoolId === now.schoolId && checked.text === now.text ? checked.report : null;
  const offered = mayImport(checked, now);
  const wipe = () => { setResult(null); setRefusal(null); };

  const pick = async (ev) => {
    wipe();
    // A Check belongs to the file it read. Choosing a file, even the same one again, starts over.
    setChecked(null);
    const f = ev.target.files?.[0];
    if (!f) { setFile(null); return; }
    if (f.size > MAX_FILE_BYTES) { setFile(null); setRefusal(refusalWords({ code: "payload_too_large" })); return; }
    setFile({ name: f.name, text: await f.text() });
  };

  const run = async (commit) => {
    if (!file || !school) return;
    setBusy(commit ? "import" : "check"); wipe();
    try {
      const report = await api(`/api/import/${encodeURIComponent(kind.id)}`, { method: "POST", timeoutMs: 60000,
        body: { csv: file.text, schoolId: school, ...(commit ? { commit: true } : {}) } });
      if (commit && report?.committed === true) { setResult(importSummary(report)); setChecked(null); }
      else setChecked({ kind: kind.id, schoolId: school, text: file.text, report });
    } catch (e) {
      setRefusal(refusalWords(/** @type {any} */ (e)));
      // A refused Import leaves the Check standing; a refused Check leaves none.
      if (!commit) setChecked(null);
    } finally { setBusy(null); }
  };

  const template = async () => {
    setSaidTemplate(null);
    try {
      const token = getToken();
      const res = await fetch(`${apiBase()}/api/import/${encodeURIComponent(kind.id)}/template`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = `scrbrd-${kind.id}-template.csv`; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { setSaidTemplate("The template could not be downloaded. Try again."); }
  };

  return (
    <Card sx={{ padding: "16px" }} data-testid="import-panel">
      <div style={{ fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>Import from a spreadsheet</div>
      <div style={{ ...SUB(), marginTop: "4px", marginBottom: "16px", maxWidth: "70ch" }}>
        Download the template, fill one row per line, and save it as a CSV. Check reads the file and writes nothing: it
        tells you every line to fix. Import is offered once the same file checks clean. Rows already at the school are updated, not duplicated.
      </div>

      <div style={{ display: "grid", gap: "16px", maxWidth: "620px" }}>
        {kinds.length > 1 && (
          <div>
            <label htmlFor="import-kind" style={LABEL()}>What are you importing</label>
            <select id="import-kind" data-testid="import-kind" value={kind.id} style={FIELD()}
                    onChange={(e) => { setKindId(e.target.value); setSchoolId(""); wipe(); }}>
              {kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
        )}
        {kinds.length === 1 && <div style={{ ...SUB(), fontWeight: 700 }} data-testid="import-kind-one">Importing: {kind.label}</div>}

        {schools.length === 0 && <div role="alert" style={{ ...SUB(), color: textOn(D.rose) }}>You hold no role that may import at a school.</div>}
        {schools.length > 1 && (
          <div>
            <label htmlFor="import-school" style={LABEL()}>School</label>
            <select id="import-school" data-testid="import-school" value={school} style={FIELD()}
                    onChange={(e) => { setSchoolId(e.target.value); wipe(); }}>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        {schools.length === 1 && <div style={SUB()} data-testid="import-school-one">At: {schools[0].name}</div>}

        <div>
          <button type="button" className="pressBtn" onClick={template} data-testid="import-template" style={BTN(false, false)}>Download the template</button>
          {saidTemplate && <div role="alert" style={{ ...SUB(), color: textOn(D.rose), marginTop: "6px" }}>{saidTemplate}</div>}
        </div>

        <div>
          <label htmlFor="import-file" style={LABEL()}>CSV file</label>
          <input id="import-file" type="file" accept=".csv,text/csv,text/plain" onChange={pick} data-testid="import-file"
                 style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary, minHeight: "44px", maxWidth: "100%" }}/>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" className="pressBtn" onClick={() => run(false)} disabled={!file || !school || busy != null}
                  data-testid="import-check" style={BTN(false, !file || !school || busy != null)}>{busy === "check" ? "Checking…" : "Check"}</button>
          <button type="button" className="pressBtn" onClick={() => run(true)} disabled={!offered || busy != null}
                  data-testid="import-run" style={BTN(true, !offered || busy != null)}>{busy === "import" ? "Importing…" : "Import"}</button>
        </div>

        {refusal && <div role="alert" data-testid="import-refusal" style={{ ...SUB(), color: textOn(D.rose) }}>{refusal}</div>}

        {shown && (
          <div data-testid="import-report" data-clean={shown.clean ? "yes" : "no"} style={{ display: "grid", gap: "8px" }}>
            <div role={shown.clean && shown.rows > 0 ? "status" : "alert"} data-testid={shown.clean && shown.rows > 0 ? "import-clean" : "import-problems"}
                 style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600,
                          color: textOn(shown.clean && shown.rows > 0 ? D.emerald : D.rose) }}>{checkSummary(shown)}</div>
            {shown.errors?.length > 0 && (
              <ul data-testid="import-errors" style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "4px", ...SUB(), color: D.textPrimary }}>
                {shown.errors.map((e, i) => <li key={i} data-testid="import-error" data-line={e.line ?? ""}>{errorWords(e)}</li>)}
              </ul>
            )}
            {shown.unknownColumns?.length > 0 && (
              <div data-testid="import-unknown" style={SUB()}>Not read, because the template has no such column: {shown.unknownColumns.join(", ")}.</div>
            )}
            {shown.warnings?.length > 0 && (
              <ul data-testid="import-warnings" style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "4px", ...SUB() }}>
                {shown.warnings.map((e, i) => <li key={i}>{errorWords(e)}</li>)}
              </ul>
            )}
          </div>
        )}

        {result && <div role="status" data-testid="import-result" style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600, color: textOn(D.emerald) }}>{result}</div>}
      </div>
    </Card>
  );
}
