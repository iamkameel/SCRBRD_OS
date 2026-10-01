import { useEffect, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { Badge, Btn, Card, EmptyState, Input, Select } from "../ui/primitives.jsx";
import { api, signedIn } from "../lib/api.js";
import { holdsCapability } from "../rbac/index.js";

/**
 * The DLS resource table, the platform's side (SCRBRD-130 R2; design §4).
 *
 * An operator holding platform.reference.manage loads the Standard Edition
 * table from a CSV held outside the repository, reads the structural report,
 * and publishes it; a correction is a new version, and a withdrawal says why
 * and keeps every row. POST/GET /api/admin/dls-tables (db/75).
 *
 * WHAT THIS SCREEN DECIDES: nothing. dls_table_load() checks the operator,
 * the provenance, the permission note and every structural rule, and answers
 * with a verdict; publishing re-checks them and refuses the synthetic table.
 * The file's cells go to the server and are never drawn here, nor does any
 * answer carry one back (D5, D6). What is shown is the file's own sha256, so
 * the operator can hold it against the one recorded for the transcription,
 * and the table's content hash once loaded.
 */

/** The structural checks (dls.mjs DLS_PROBLEM), in the words an operator acts on. */
const PROBLEM = {
  grain: "The grain must be by the ball or by the over, with a maximum that is a whole number of overs.",
  missing_cell: "A cell is missing, repeated, or outside the grid: every balls-remaining row needs all ten wickets.",
  out_of_range: "A value is not a whole number of tenths between 0 and 1000 (0.0 to 100.0 per cent).",
  not_zero_at_end: "With no balls remaining, every wicket's resources must be 0.",
  not_full_at_start: "The full innings with no wicket down must be 100.0 per cent.",
  not_rising_in_balls: "For a wicket, resources must not fall as balls remaining rise.",
  not_falling_in_wickets: "For a ball, resources must not rise as wickets fall.",
};

/** What each verdict means. Anything unmapped is still shown, by its code. */
const REFUSAL = {
  not_permitted: "Only a holder of platform.reference.manage loads, publishes or withdraws a DLS table.",
  csv_empty: "The file has no rows of figures.",
  csv_shape: "Each row must be either \"balls, wickets, resources\" or \"balls, then ten resources\".",
  csv_precision: "A percentage has more than one decimal: the table is read to a tenth.",
  grain_invalid: "Choose whether the table is by the ball or by the over.",
  provenance_required: "Give the title, the publisher, the document and its edition date.",
  permission_note_required: "Say who gave permission, for what use and when, in twenty characters or more.",
  version_taken: "That version is already loaded: a correction is the next version.",
  structure: "The table failed the structural checks below. Nothing was kept.",
  synthetic_title: "The synthetic table is for tests only and is never published.",
  not_draft: "Only a draft is published.",
  hash_moved: "The cells are not the ones that were hashed at loading. Load it again.",
  note_required: "Say why it is withdrawn, in ten characters or more.",
  not_published: "Only a published table is withdrawn.",
  not_found: "That table is not on the platform.",
  unreachable: "The server did not answer. Look at the list below before trying again.",
};
const say = (e) => REFUSAL[e?.code] ?? (e?.status ? `Refused (${e.code || e.status}).` : REFUSAL.unreachable);

const H = () => ({ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary });
const SUB = () => ({ fontFamily: D.body, fontSize: "12px", color: D.textMuted, lineHeight: 1.5 });
const MONO = () => ({ fontFamily: D.mono, fontSize: "12px", color: D.textMuted, wordBreak: "break-all" });
const day = (t) => (t ? String(t).slice(0, 10) : "—");
// A function, not a constant: tokens are read while drawing, never at import (the theme may change).
const statusTone = (s) => ({ draft: D.amber, published: D.emerald, withdrawn: D.textMuted })[s] ?? D.textMuted;

/** sha256 of the file's own bytes, hex, in the browser: to compare with the one on record (sha256sum). */
async function fileHash(bytes) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

function DlsTablesPanel({ role }) {
  // Courtesy only: the database is the guard (dls_operator()).
  if (!holdsCapability(role, "platform.reference.manage")) return null;
  if (!signedIn()) {
    return (
      <Card sx={{ padding: "16px" }} data-testid="dls-tables">
        <EmptyState icon="cloud-rain" message="Sign in to the live platform to load a DLS table."/>
      </Card>
    );
  }
  return <DlsTablesLive/>;
}

function DlsTablesLive() {
  const [nonce, setNonce] = useState(0);
  const again = () => setNonce((n) => n + 1);
  const [list, setList] = useState({ rows: [], loading: true, error: null });
  useEffect(() => {
    let off = false;
    api("/api/admin/dls-tables")
      .then((r) => { if (!off) setList({ rows: r?.tables ?? [], loading: false, error: null }); })
      .catch((e) => { if (!off) setList({ rows: [], loading: false, error: say(e) }); });
    return () => { off = true; };
  }, [nonce]);

  const [form, setForm] = useState({ title: "", grain: "ball", maxBalls: "300", units: "", sourcePublisher: "", sourceDocument: "",
                                     sourceEditionDate: "", permissionNote: "" });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const [file, setFile] = useState(/** @type {{name: string, text: string, sha256: string | null} | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(/** @type {{ok: boolean, words: string, problems?: string[], hash?: string, rows?: number} | null} */ (null));
  const [acted, setActed] = useState({});
  const [notes, setNotes] = useState({});

  const pick = async (ev) => {
    const f = ev.target.files?.[0];
    setOutcome(null);
    if (!f) { setFile(null); return; }
    const bytes = await f.arrayBuffer();
    setFile({ name: f.name, text: new TextDecoder("utf-8").decode(bytes), sha256: await fileHash(bytes) });
  };

  const load = async () => {
    if (!file) { setOutcome({ ok: false, words: "Choose the CSV first." }); return; }
    setBusy(true); setOutcome(null);
    try {
      const r = await api("/api/admin/dls-tables", { method: "POST", timeoutMs: 30000, body: {
        csv: file.text, title: form.title, grain: form.grain, maxBalls: Number(form.maxBalls), units: form.units || undefined,
        sourcePublisher: form.sourcePublisher, sourceDocument: form.sourceDocument, sourceEditionDate: form.sourceEditionDate,
        permissionNote: form.permissionNote } });
      setOutcome({ ok: true, words: `Loaded as a draft: ${r.rowCount} cells, read as ${r.units === "percent" ? "per cent" : "tenths"}. Every structural check passed.`,
                   hash: r.contentHash, rows: r.rowCount });
      again();
    } catch (e) {
      const problems = Array.isArray(e?.detail?.problems) ? e.detail.problems : [];
      setOutcome({ ok: false, words: say(e), problems });
    } finally { setBusy(false); }
  };

  const act = async (t, what) => {
    setActed((m) => ({ ...m, [t.id]: "" }));
    try {
      await api(`/api/admin/dls-tables/${t.id}/${what}`, { method: "POST", body: what === "withdraw" ? { note: notes[t.id] ?? "" } : undefined });
      again();
    } catch (e) { setActed((m) => ({ ...m, [t.id]: say(e) })); }
  };

  return (
    <div style={{ display: "grid", gap: "16px" }} data-testid="dls-tables">
      <Card sx={{ padding: "16px" }}>
        <div style={H()}>Load a DLS Standard Edition table</div>
        <div style={{ ...SUB(), marginTop: "3px", marginBottom: "12px", maxWidth: "70ch" }}>
          From the official source, as a CSV: rows of balls remaining, wickets lost and resources, or balls remaining then the
          ten wickets' resources. Per cent to one decimal or tenths. It loads as a draft; publish it once the report below is clean.
          A match fixed after publishing reads that version for ever. The figures never leave the server.
        </div>
        <div style={{ maxWidth: "620px" }}>
          <label style={{ display: "block", marginBottom: "14px" }}>
            <span style={{ display: "block", fontFamily: D.head, fontSize: "10px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em",
                           textTransform: "uppercase", marginBottom: "5px" }}>CSV file</span>
            <input type="file" accept=".csv,text/csv,text/plain" onChange={pick} data-testid="dls-file"
                   style={{ fontFamily: D.body, fontSize: "13px", color: D.textPrimary, minHeight: "44px" }}/>
          </label>
          {file && (
            <div data-testid="dls-file-hash" style={{ ...MONO(), marginTop: "-6px", marginBottom: "12px" }}>
              {file.name} · sha256 {file.sha256 ?? "(this browser cannot hash)"} — hold it against the one on record for the transcription
            </div>
          )}
          <Input label="Title" value={form.title} onChange={set("title")} data-testid="dls-title" placeholder="e.g. DLS Standard Edition, ICC section 06"/>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px" }}>
            <Select label="Grain" value={form.grain} onChange={set("grain")} data-testid="dls-grain"
              options={[{ value: "ball", label: "By the ball" }, { value: "over", label: "By the over" }]}/>
            <Input label="Balls in the full innings" value={form.maxBalls} onChange={set("maxBalls")} data-testid="dls-max" inputMode="numeric"/>
            <Select label="Figures in" value={form.units} onChange={set("units")} data-testid="dls-units"
              options={[{ value: "", label: "Read from the file" }, { value: "percent", label: "Per cent" }, { value: "tenths", label: "Tenths" }]}/>
          </div>
          <Input label="Publisher" value={form.sourcePublisher} onChange={set("sourcePublisher")} data-testid="dls-publisher"/>
          <Input label="Document" value={form.sourceDocument} onChange={set("sourceDocument")} data-testid="dls-document"/>
          <Input label="Edition date" type="date" value={form.sourceEditionDate} onChange={set("sourceEditionDate")} data-testid="dls-edition"/>
          <Input label="Permission: who gave it, for what use, when" value={form.permissionNote} onChange={set("permissionNote")}
                 data-testid="dls-permission" placeholder="e.g. granted by the school for the pilot, on the date given"/>
          {outcome && (
            <div role={outcome.ok ? "status" : "alert"} data-testid={outcome.ok ? "dls-loaded" : "dls-refused"}
                 style={{ fontFamily: D.body, fontSize: "12px", color: textOn(outcome.ok ? D.emerald : D.rose), marginBottom: "10px" }}>
              {outcome.words}
              {outcome.hash && <div style={{ ...MONO(), marginTop: "4px" }}>content hash {outcome.hash}</div>}
              {outcome.problems?.length > 0 && (
                <ul data-testid="dls-report" style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
                  {outcome.problems.map((p) => <li key={p} data-problem={p}>{PROBLEM[p] ?? p}</li>)}
                </ul>
              )}
            </div>
          )}
          <Btn size="sm" onClick={load} disabled={busy} data-testid="dls-load">{busy ? "Loading…" : "Load as a draft"}</Btn>
        </div>
      </Card>

      <Card sx={{ padding: "16px" }}>
        <div style={H()}>Tables on the platform</div>
        <div style={{ ...SUB(), marginTop: "3px", marginBottom: "8px" }}>
          Provenance only. A published table never changes; a withdrawn one keeps its rows for the matches fixed under it.
        </div>
        {list.loading ? <EmptyState loading/>
          : list.error ? <div role="alert" style={{ ...SUB(), color: textOn(D.rose) }}>{list.error}</div>
          : list.rows.length === 0 ? <EmptyState icon="cloud-rain" message="No DLS table is loaded. The pad asks the umpires for every figure."/>
          : list.rows.map((t) => (
            <div key={t.id} data-testid={`dls-table-${t.version}`} style={{ padding: "10px 0", borderTop: `1px solid ${D.border}`, display: "grid", gap: "4px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600, color: D.textPrimary }}>v{t.version} · {t.title}</span>
                <Badge color={statusTone(t.status)}>{t.status}</Badge>
              </div>
              <div style={SUB()}>
                {t.grain === "over" ? "By the over" : "By the ball"}, {t.maxBalls} balls, {t.rowCount} cells · {t.sourcePublisher}, {t.sourceDocument}, {day(t.sourceEditionDate)}
              </div>
              <div style={SUB()}>Permission: {t.permissionNote}</div>
              <div style={MONO()}>hash {t.contentHash}</div>
              {t.status === "withdrawn" && <div style={SUB()}>Withdrawn {day(t.withdrawnAt)}: {t.withdrawnNote}</div>}
              {acted[t.id] && <div role="alert" style={{ ...SUB(), color: textOn(D.rose) }}>{acted[t.id]}</div>}
              {t.status === "draft" && (
                <div><Btn size="sm" onClick={() => act(t, "publish")} data-testid={`dls-publish-${t.version}`}>Publish</Btn></div>
              )}
              {t.status === "published" && (
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px" }}>
                    <Input label="Why withdraw it" value={notes[t.id] ?? ""} onChange={(v) => setNotes((m) => ({ ...m, [t.id]: v }))} small
                           data-testid={`dls-withdraw-note-${t.version}`}/>
                  </div>
                  <Btn size="sm" variant="danger" onClick={() => act(t, "withdraw")} data-testid={`dls-withdraw-${t.version}`}>Withdraw</Btn>
                </div>
              )}
            </div>
          ))}
      </Card>
    </div>
  );
}

export { DlsTablesPanel, PROBLEM as DLS_PROBLEM_WORDS };
