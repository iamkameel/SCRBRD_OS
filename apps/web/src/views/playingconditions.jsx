import { useEffect, useId, useState } from "react";
import { T, inkOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { Badge, EmptyState } from "../ui/primitives.jsx";
import {
  KEY_WORDS, PARTS, STANDING_WORDS, sourceWords, confirmedCount, dayOf, draftOf, formatDay, formatWhen, labelOf,
  bandDefault, oversCell, platformDefaultWords, refusalWords, standing, valueOfDraft, valueWords,
} from "../lib/playingConditions.js";

/**
 * A competition's playing conditions (SCRBRD-114 §7, §8; db/61).
 *
 * Reached from the competition's page (LeagueView's "Playing conditions" tab).
 * Anyone who can read the competition sees the version in force today, every
 * version and its figures, each with where it came from, or "platform default,
 * unconfirmed". Only the competition's conditions manager (the API's
 * `canManage`) is offered anything to change.
 *
 * WHAT THIS SCREEN DECIDES: nothing. Every change is one API call that the
 * database answers (services/api/write/playing-conditions-api.mjs), and a
 * refusal is worded beside the thing that was refused (lib/playingConditions.js).
 * There is no check here that could drift from the one that runs: a confirmed
 * figure with no citation is sent, and refused, and the refusal is explained.
 *
 * Publishing and withdrawing ask once, in the page (never window.confirm).
 * Type is 12px at the smallest and every control is 44px tall; every colour is
 * read from `T` when a component renders, so both themes are right.
 */

const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

function styles() {
  const btn = { minHeight: "44px", padding: "10px 18px", borderRadius: T.radius.pill, cursor: "pointer", boxSizing: "border-box",
                fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 };
  return {
    card: { background: T.surface.raised, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg, padding: T.space.lg,
            display: "flex", flexDirection: "column", gap: T.space.md, minWidth: 0, fontFamily: T.type.body, color: T.content.primary },
    h3: { fontFamily: T.type.body, fontSize: "18px", fontWeight: 600, color: T.content.primary, margin: 0 },
    h4: { fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, color: T.content.primary, margin: 0 },
    body: { fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.5, color: T.content.secondary, margin: 0 },
    meta: { fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.4, color: T.content.tertiary, margin: 0 },
    label: { display: "block", fontFamily: T.type.body, fontSize: "12px", fontWeight: 600, color: T.content.secondary, marginBottom: T.space.xs },
    input: { width: "100%", minHeight: "44px", padding: "10px 12px", boxSizing: "border-box", background: T.surface.base,
             border: `1px solid ${T.line.strong}`, borderRadius: T.radius.md, color: T.content.primary, fontFamily: T.type.body, fontSize: "16px" },
    primary: { ...btn, border: "none", background: T.content.primary, color: inkOn(T.content.primary) },
    secondary: { ...btn, background: "transparent", color: T.content.primary, border: `1px solid ${T.line.strong}` },
    danger: { ...btn, border: "none", background: T.semantic.critical, color: inkOn(T.semantic.critical) },
    toggle: (on) => ({ ...btn, minWidth: "44px", border: `1px solid ${on ? T.content.primary : T.line.strong}`,
                       background: on ? T.content.primary : "transparent", color: on ? inkOn(T.content.primary) : T.content.primary }),
    confirm: { display: "flex", flexDirection: "column", gap: T.space.sm, padding: T.space.md, borderRadius: T.radius.md,
               background: T.surface.base, border: `1px solid ${T.line.strong}` },
    alert: { fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.4, color: T.semantic.criticalText, margin: 0 },
    row: { display: "flex", flexWrap: "wrap", gap: T.space.md, alignItems: "center", justifyContent: "space-between",
           borderTop: `1px solid ${T.line.normal}`, paddingTop: T.space.md, minWidth: 0 },
    wrap: { display: "flex", flexWrap: "wrap", gap: T.space.sm, alignItems: "center" },
    editor: { display: "flex", flexDirection: "column", gap: T.space.md, padding: T.space.md, borderRadius: T.radius.md,
              background: T.surface.base, border: `1px solid ${T.line.strong}`, width: "100%", boxSizing: "border-box" },
  };
}

/** A label tied to its control, so the words are what a screen reader and a tap both find. */
function Field({ label, children, grow }) {
  const S = styles();
  const id = useId();
  return (
    <div style={{ flex: grow ? "1 1 200px" : "0 1 auto", minWidth: 0 }}>
      <label htmlFor={id} style={S.label}>{label}</label>
      {children(id)}
    </div>
  );
}

function Alert({ words, testid = "pc-error" }) {
  const S = styles();
  return words ? <p role="alert" data-testid={testid} style={S.alert}>{words}</p> : null;
}

/** The chips: what a figure stands on, and who entered it. */
function Source({ entered, fallback = null }) {
  const S = styles();
  if (!entered) {
    return <Badge data-testid="pc-chip-default" color={T.semantic.warning}>platform default, unconfirmed{fallback ? `: ${fallback}` : ""}</Badge>;
  }
  const who = entered.enteredBy && entered.enteredBy === profile()?.user?.id ? "you" : entered.enteredByName;
  const by = who ? <span data-testid="pc-entered-by" style={S.meta}>Entered by {who}</span> : null;
  if (entered.status === "confirmed") {
    return <span style={S.wrap}><span data-testid="pc-source" style={{ ...S.body, fontSize: "13px" }}>{sourceWords(entered)}</span>{by}</span>;
  }
  return (
    <span style={S.wrap}>
      <Badge data-testid="pc-chip-unconfirmed" color={T.semantic.warning}>unconfirmed</Badge>
      {entered.sourceNote && <span style={S.meta}>{entered.sourceNote}</span>}
      {by}
    </span>
  );
}

// ── The editor for one figure ──────────────────────────────────────

function FigureEditor({ entry, band, existing, setId, catalogue, onCancel, onSaved }) {
  const S = styles();
  const [d, setD] = useState(() => draftOf(entry, existing));
  const [err, setErr] = useState(/** @type {{ field: string, words: string } | null} */ (null));
  const [busy, setBusy] = useState(false);
  const set = (/** @type {object} */ p) => setD((x) => ({ ...x, ...p }));
  const words = KEY_WORDS[entry.key];
  const suffix = `${entry.key}${band ? `-${band}` : ""}`;

  async function save() {
    const v = valueOfDraft(entry, d);
    if ("problem" in v) { setErr({ field: "value", words: v.problem }); return; }
    setBusy(true); setErr(null);
    try {
      const confirmed = d.status === "confirmed";
      await api(`/api/condition-sets/${setId}/values`, { method: "POST", body: {
        key: entry.key, ageBand: band ?? undefined, value: v.value, status: d.status,
        sourceDocument: confirmed ? d.document || undefined : undefined,
        sourceClause: confirmed ? d.clause || undefined : undefined,
        sourceDate: confirmed ? d.date || undefined : undefined,
        sourceNote: d.note || undefined } });
      onSaved();
    } catch (/** @type {any} */ e) {
      const field = e?.code === "citation_required" || e?.code === "source_date_invalid" ? "citation"
        : e?.code === "value_invalid" || e?.code === "value_required" ? "value" : "form";
      setErr({ field, words: refusalWords(e, catalogue) });
    } finally { setBusy(false); }
  }

  const valueField = () => {
    if (entry.type === "bool") {
      return (
        <div style={S.wrap} role="group" aria-label={`${labelOf(entry.key)}${band ? `, ${band}` : ""}`}>
          {[[true, "Yes"], [false, "No"]].map(([v, l]) => (
            <button key={l} type="button" data-testid={`pc-bool-${l.toLowerCase()}`} aria-pressed={d.bool === v && !d.none}
              onClick={() => set({ bool: v, none: false })} style={S.toggle(d.bool === v && !d.none)}>{l}</button>
          ))}
        </div>
      );
    }
    if (entry.type === "enum") {
      return (
        <Field label={labelOf(entry.key)}>{(id) => (
          <select id={id} data-testid="pc-f-value" value={d.text} onChange={(e) => set({ text: e.target.value, none: false })} style={S.input}>
            <option value="">Choose…</option>
            {(entry.values ?? []).map((o) => <option key={o} value={o}>{valueWords({ ...entry, type: "enum" }, o)}</option>)}
          </select>)}</Field>
      );
    }
    if (entry.type === "int") {
      return (
        <Field label={`${labelOf(entry.key)}${entry.unit ? ` (${entry.unit})` : ""}`}>{(id) => (
          <div style={S.wrap}>
            <input id={id} data-testid="pc-f-value" type="number" inputMode="numeric" step="1" value={d.text} disabled={d.none}
              onChange={(e) => set({ text: e.target.value })} style={{ ...S.input, width: "140px" }}/>
            {entry.unit && <span style={S.body}>{entry.unit}</span>}
          </div>)}</Field>
      );
    }
    if (entry.type === "date") {
      return <Field label={labelOf(entry.key)}>{(id) => <input id={id} data-testid="pc-f-value" type="date" value={d.text} onChange={(e) => set({ text: e.target.value })} style={S.input}/>}</Field>;
    }
    if (entry.type === "list") {
      return (
        <div>
          <span style={S.label}>{labelOf(entry.key)}: tap in the order they count</span>
          <div style={S.wrap}>
            {(entry.values ?? []).map((o) => {
              const at = d.picked.indexOf(o);
              return (
                <button key={o} type="button" data-testid={`pc-pick-${o}`} aria-pressed={at >= 0}
                  onClick={() => set({ picked: at >= 0 ? d.picked.filter((x) => x !== o) : [...d.picked, o] })}
                  style={S.toggle(at >= 0)}>{at >= 0 ? `${at + 1}. ` : ""}{valueWords({ ...entry, type: "enum" }, o)}</button>
              );
            })}
          </div>
        </div>
      );
    }
    if (entry.type === "object" && entry.key === "bowling.limit") {
      return (
        <div style={S.wrap}>
          <Field label={`Overs a spell, ${band}`}>{(id) => <input id={id} data-testid="pc-f-spell" type="number" inputMode="numeric" step="1" placeholder="No limit" value={d.spell} onChange={(e) => set({ spell: e.target.value })} style={{ ...S.input, width: "140px" }}/>}</Field>
          <Field label={`Overs a day, ${band}`}>{(id) => <input id={id} data-testid="pc-f-day" type="number" inputMode="numeric" step="1" placeholder="No limit" value={d.day} onChange={(e) => set({ day: e.target.value })} style={{ ...S.input, width: "140px" }}/>}</Field>
        </div>
      );
    }
    return (
      <Field label={`${labelOf(entry.key)}, as { "name": value }`}>{(id) => (
        <textarea id={id} data-testid="pc-f-value" rows={3} value={d.json} onChange={(e) => set({ json: e.target.value })} style={{ ...S.input, fontFamily: T.type.mono, fontSize: "14px" }}/>)}</Field>
    );
  };

  const confirmed = d.status === "confirmed";
  return (
    <div data-testid={`pc-editor-${suffix}`} style={S.editor}>
      <h5 style={{ ...S.h4, fontSize: "14px" }}>{labelOf(entry.key)}{band ? `, ${band}` : ""}</h5>
      {valueField()}
      {words?.none && entry.type !== "object" && (
        <label style={{ ...S.wrap, minHeight: "44px", fontSize: "14px", color: T.content.primary, cursor: "pointer" }}>
          <input type="checkbox" data-testid="pc-f-none" checked={d.none} onChange={(e) => set({ none: e.target.checked })}
            style={{ width: "20px", height: "20px" }}/>
          {words.none} (no figure)
        </label>
      )}
      {words?.hint && <p style={S.meta}>{words.hint}</p>}
      {err?.field === "value" && <Alert words={err.words} testid="pc-error-value"/>}
      <div role="radiogroup" aria-label="Has this figure been confirmed?" style={S.wrap}>
        {[["unconfirmed", "Unconfirmed"], ["confirmed", "Confirmed"]].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={d.status === v} data-testid={`pc-status-${v}`}
            onClick={() => set({ status: v })} style={S.toggle(d.status === v)}>{l}</button>
        ))}
      </div>
      <p data-testid="pc-citation-hint" style={S.meta}>
        {confirmed
          ? "Confirmed means you can point at the document. Give its name, the clause and the date of it."
          : "Unconfirmed figures still apply to matches, and are shown as unconfirmed until someone confirms them against a document."}
      </p>
      {confirmed && (
        <div style={S.wrap}>
          <Field label="Document" grow>{(id) => <input id={id} data-testid="pc-f-doc" type="text" placeholder="KZNCU Schools Bye-laws" value={d.document} onChange={(e) => set({ document: e.target.value })} style={S.input}/>}</Field>
          <Field label="Clause">{(id) => <input id={id} data-testid="pc-f-clause" type="text" placeholder="7.3" value={d.clause} onChange={(e) => set({ clause: e.target.value })} style={{ ...S.input, width: "120px" }}/>}</Field>
          <Field label="Date of the document">{(id) => <input id={id} data-testid="pc-f-docdate" type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} style={S.input}/>}</Field>
        </div>
      )}
      {err?.field === "citation" && <Alert words={err.words} testid="pc-error-citation"/>}
      <Field label="Note (optional)">{(id) => <input id={id} data-testid="pc-f-note" type="text" value={d.note} onChange={(e) => set({ note: e.target.value })} style={S.input}/>}</Field>
      {err?.field === "form" && <Alert words={err.words}/>}
      <div style={S.wrap}>
        <button type="button" data-testid="pc-save" disabled={busy} onClick={save} style={{ ...S.primary, opacity: busy ? 0.5 : 1 }}>Save figure</button>
        <button type="button" data-testid="pc-cancel" onClick={onCancel} style={S.secondary}>Cancel</button>
      </div>
    </div>
  );
}

// ── One figure, and the by-band table ──────────────────────────────

/** What a manager can do to a figure of a draft: enter or change it, or clear it. */
function FigureActions({ entry, band, entered, canEdit, setId, catalogue, editing, setEditing, onChanged }) {
  const S = styles();
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const suffix = `${entry.key}${band ? `-${band}` : ""}`;
  const name = `${labelOf(entry.key)}${band ? `, ${band}` : ""}`;
  if (!canEdit) return null;
  async function clear() {
    setErr(null);
    try { await api(`/api/condition-sets/${setId}/values/clear`, { method: "POST", body: { key: entry.key, ageBand: band ?? undefined } }); onChanged(); }
    catch (/** @type {any} */ e) { setErr(refusalWords(e, catalogue)); }
  }
  return (
    <span style={S.wrap}>
      <button type="button" data-testid={`pc-enter-${suffix}`} aria-expanded={editing} aria-label={`${entered ? "Change" : "Enter"} ${name}`} onClick={() => setEditing(!editing)} style={S.secondary}>
        {entered ? "Change" : "Enter"}
      </button>
      {entered && <button type="button" data-testid={`pc-clear-${suffix}`} aria-label={`Clear ${name}`} onClick={clear} style={S.secondary}>Clear</button>}
      <Alert words={err} testid="pc-error-clear"/>
    </span>
  );
}

function FigureRow({ entry, entered, applied = true, canEdit, setId, catalogue, onChanged }) {
  const S = styles();
  const [editing, setEditing] = useState(false);
  const words = KEY_WORDS[entry.key];
  const shown = entered ? valueWords(entry, entered.value)
    : applied ? platformDefaultWords(entry) : "Nothing recorded";
  return (
    <div data-testid={`pc-figure-${entry.key}`} style={S.row}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={S.h4}>{words?.label ?? entry.key}</div>
        <div data-testid="pc-value" style={{ ...S.body, color: T.content.primary }}>{cap(shown)}</div>
      </div>
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        {(applied || entered) ? <Source entered={entered} fallback={applied ? shown : null}/> : null}
      </div>
      <FigureActions entry={entry} band={null} entered={entered} canEdit={canEdit} setId={setId} catalogue={catalogue}
        editing={editing} setEditing={setEditing} onChanged={onChanged}/>
      {editing && (
        <FigureEditor entry={entry} band={null} existing={entered} setId={setId} catalogue={catalogue}
          onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }}/>
      )}
    </div>
  );
}

/** A key given by age band: one small table, a row a band, each with its own source. */
function BandTable({ entry, values, bands, canEdit, setId, catalogue, onChanged }) {
  const S = styles();
  const [editing, setEditing] = useState(/** @type {string | null} */ (null));
  const th = { ...S.meta, textAlign: "left", fontWeight: 600, padding: "8px 10px 8px 0", whiteSpace: "nowrap" };
  const td = { ...S.body, color: T.content.primary, padding: "8px 10px 8px 0", verticalAlign: "top", borderTop: `1px solid ${T.line.normal}` };
  return (
    <div data-testid={`pc-figure-${entry.key}`} style={S.row}>
      <div style={{ width: "100%" }}>
        <div style={S.h4}>{labelOf(entry.key)}</div>
        <div style={{ ...S.meta, marginBottom: T.space.sm }}>Overs a boy may bowl in one spell and in one day, for each age band.</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th scope="col" style={th}>Age band</th><th scope="col" style={th}>A spell</th><th scope="col" style={th}>A day</th>
              <th scope="col" style={th}>Source</th>{canEdit && <th scope="col" style={th}>Change</th>}
            </tr></thead>
            <tbody>
              {bands.map((b) => {
                const entered = values.find((v) => v.key === entry.key && v.ageBand === b);
                const shown = entered ? entered.value : bandDefault(entry, b);
                return [
                  <tr key={b} data-testid={`pc-figure-${entry.key}-${b}`}>
                    <th scope="row" style={{ ...td, fontWeight: 600 }}>{b}</th>
                    <td style={td}>{cap(oversCell(shown?.spell))}</td>
                    <td style={td}>{cap(oversCell(shown?.day))}</td>
                    <td style={td}><Source entered={entered}/></td>
                    {canEdit && <td style={td}>
                      <FigureActions entry={entry} band={b} entered={entered} canEdit={canEdit} setId={setId} catalogue={catalogue}
                        editing={editing === b} setEditing={(on) => setEditing(on ? b : null)} onChanged={onChanged}/>
                    </td>}
                  </tr>,
                  editing === b && (
                    <tr key={`${b}-edit`}><td colSpan={canEdit ? 5 : 4} style={{ padding: `${T.space.sm} 0` }}>
                      <FigureEditor entry={entry} band={b} existing={entered} setId={setId} catalogue={catalogue}
                        onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }}/>
                    </td></tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── The figures of one version ─────────────────────────────────────

function Figures({ set, catalogue, canEdit, onChanged }) {
  const S = styles();
  const values = set?.values ?? [];
  const entered = (/** @type {string} */ key) => values.find((v) => v.key === key && v.ageBand === null);
  const applied = catalogue.keys.filter((k) => !k.reserved);
  const reserved = catalogue.keys.filter((k) => k.reserved);
  const recorded = reserved.filter((k) => values.some((v) => v.key === k.key));
  const common = { canEdit, setId: set?.id, catalogue, onChanged };
  return (
    <div data-testid="pc-figures" style={{ display: "flex", flexDirection: "column", gap: T.space.lg }}>
      {PARTS.map(({ part, title, sub }) => {
        const keys = applied.filter((k) => k.part === part);
        if (!keys.length) return null;
        return (
          <section key={part} data-testid={`pc-part-${part}`} aria-labelledby={`pc-part-h-${part}`} style={S.card}>
            <div>
              <h4 id={`pc-part-h-${part}`} style={S.h3}>{title}</h4>
              <p style={S.meta}>{sub}</p>
            </div>
            {keys.map((k) => k.byAgeBand
              ? <BandTable key={k.key} entry={k} values={values} bands={catalogue.ageBands ?? []} {...common}/>
              : <FigureRow key={k.key} entry={k} entered={entered(k.key)} {...common}/>)}
          </section>
        );
      })}
      {(canEdit || recorded.length > 0) && (
        <details data-testid="pc-reserved" style={S.card}>
          <summary style={{ ...S.h3, cursor: "pointer", minHeight: "44px", display: "flex", alignItems: "center" }}>Recorded, not applied</summary>
          <p style={S.body}>The platform does not read these yet. A figure recorded here, with its source, is kept for when it does; it changes nothing today.</p>
          {reserved.filter((k) => canEdit || recorded.includes(k)).map((k) =>
            <FigureRow key={k.key} entry={k} entered={entered(k.key)} applied={false} {...common}/>)}
        </details>
      )}
    </div>
  );
}

// ── Actions on a version: title and date, publish, withdraw, a new version ──

function VersionActions({ set, state, catalogue, canManage, onChanged, onNewVersion }) {
  const S = styles();
  const [mode, setMode] = useState(/** @type {null | "publish" | "withdraw" | "amend"} */ (null));
  const [note, setNote] = useState("");
  const [title, setTitle] = useState(set.title);
  const [date, setDate] = useState(dayOf(set.effectiveFrom));
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const count = confirmedCount(catalogue, set.values);
  if (!canManage) return null;
  const canWithdraw = state === "draft" || state === "scheduled";
  const open = (/** @type {typeof mode} */ m) => { setMode(mode === m ? null : m); setErr(null); };

  async function run(/** @type {() => Promise<unknown>} */ fn, /** @type {(r: any) => void} */ after = () => onChanged()) {
    setBusy(true); setErr(null);
    try { after(await fn()); setMode(null); }
    catch (/** @type {any} */ e) { setErr(refusalWords(e, catalogue)); }
    finally { setBusy(false); }
  }
  const post = (/** @type {string} */ path, /** @type {any} */ body) => api(path, { method: "POST", body });

  return (
    <div data-testid="pc-actions" style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
      <div style={S.wrap}>
        {state === "draft" && <button type="button" data-testid="pc-amend" aria-expanded={mode === "amend"} onClick={() => open("amend")} style={S.secondary}>Edit title and date</button>}
        {state === "draft" && <button type="button" data-testid="pc-publish" aria-expanded={mode === "publish"} onClick={() => open("publish")} style={S.primary}>Publish…</button>}
        {canWithdraw && <button type="button" data-testid="pc-withdraw" aria-expanded={mode === "withdraw"} onClick={() => open("withdraw")} style={S.secondary}>Withdraw…</button>}
        {(state === "in_force" || state === "scheduled" || state === "superseded") &&
          <button type="button" data-testid="pc-newversion" disabled={busy} onClick={() => run(() => post(`/api/condition-sets/${set.id}/new-version`, {}), (r) => onNewVersion(r.setId))} style={S.secondary}>New version from this</button>}
      </div>
      {mode === null && err && <Alert words={err}/>}
      {mode === "amend" && (
        <div data-testid="pc-amend-form" style={S.confirm}>
          <Field label="Title">{(id) => <input id={id} data-testid="pc-amend-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={S.input}/>}</Field>
          <Field label="Effective from (a day after today, to be published)">{(id) => <input id={id} data-testid="pc-amend-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={S.input}/>}</Field>
          <Alert words={err}/>
          <div style={S.wrap}>
            <button type="button" data-testid="pc-amend-save" disabled={busy} onClick={() => run(() => post(`/api/condition-sets/${set.id}`, { title, effectiveFrom: date || undefined }))} style={S.primary}>Save title and date</button>
            <button type="button" onClick={() => open("amend")} style={S.secondary}>Cancel</button>
          </div>
        </div>
      )}
      {mode === "publish" && (
        <div data-testid="pc-publish-confirm" role="group" aria-label="Publish this version" style={S.confirm}>
          <p style={{ ...S.body, color: T.content.primary }}>
            Publish version {set.version}, “{set.title}”, from {formatDay(set.effectiveFrom)}? From that day matches are played under
            these figures. {count.confirmed} of {count.total} figures are confirmed. Once published it cannot be changed, only replaced by a new version.
          </p>
          <Alert words={err} testid="pc-error-publish"/>
          <div style={S.wrap}>
            <button type="button" data-testid="pc-publish-yes" disabled={busy} onClick={() => run(() => post(`/api/condition-sets/${set.id}/publish`, {}))} style={S.primary}>Publish version {set.version}</button>
            <button type="button" data-testid="pc-publish-no" onClick={() => open("publish")} style={S.secondary}>Not yet</button>
          </div>
        </div>
      )}
      {mode === "withdraw" && (
        <div data-testid="pc-withdraw-confirm" role="group" aria-label="Withdraw this version" style={S.confirm}>
          <p style={{ ...S.body, color: T.content.primary }}>
            Withdraw version {set.version}, “{set.title}”? {state === "draft" ? "The draft is set aside." : "It is not in force yet, and it never will be."} The reason is kept with it.
          </p>
          <Field label="Why? (at least 10 characters)">{(id) => <textarea id={id} data-testid="pc-withdraw-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} style={S.input}/>}</Field>
          <Alert words={err} testid="pc-error-withdraw"/>
          <div style={S.wrap}>
            <button type="button" data-testid="pc-withdraw-yes" disabled={busy} onClick={() => run(() => post(`/api/condition-sets/${set.id}/withdraw`, { note }))} style={S.danger}>Withdraw version {set.version}</button>
            <button type="button" data-testid="pc-withdraw-no" onClick={() => open("withdraw")} style={S.secondary}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── A new draft ────────────────────────────────────────────────────

function NewDraft({ competitionId, catalogue, onCreated }) {
  const S = styles();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setErr(null);
    try {
      const r = await api(`/api/competitions/${competitionId}/playing-conditions`, { method: "POST", body: { title, effectiveFrom: date || undefined } });
      setTitle(""); setDate(""); onCreated(r.setId);
    } catch (/** @type {any} */ e) { setErr(refusalWords(e, catalogue)); }
    finally { setBusy(false); }
  }
  return (
    <form data-testid="pc-new-draft" style={S.card} onSubmit={(e) => { e.preventDefault(); create(); }}>
      <div>
        <h4 style={S.h3}>Start a new version</h4>
        <p style={S.meta}>A draft is private to the organisers until it is published. Publishing needs a start day after today.</p>
      </div>
      <div style={S.wrap}>
        <Field label="Title" grow>{(id) => <input id={id} data-testid="pc-draft-title" type="text" placeholder="KZN Schools T20 2026/27" value={title} onChange={(e) => setTitle(e.target.value)} style={S.input}/>}</Field>
        <Field label="Effective from">{(id) => <input id={id} data-testid="pc-draft-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={S.input}/>}</Field>
      </div>
      <Alert words={err} testid="pc-draft-error"/>
      <div><button type="submit" data-testid="pc-draft-create" disabled={busy} style={{ ...S.primary, opacity: busy ? 0.5 : 1 }}>Create draft</button></div>
    </form>
  );
}

// The pieces the league wizard's checklist (views/leaguewizard.jsx, step 3)
// shares with this screen, so a figure is entered, cited and cleared by the
// same editor and worded by the same words in both places.
export { styles, Field, Alert, Source, FigureEditor, FigureActions };

// ── The screen ─────────────────────────────────────────────────────

/** @param {{ competition: { id: string, name?: string } }} props */
export function PlayingConditions({ competition }) {
  const S = styles();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(/** @type {{ loading: boolean, error: string | null, data: any, catalogue: any }} */ ({ loading: true, error: null, data: null, catalogue: null }));
  const [chosen, setChosen] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [data, catalogue] = await Promise.all([
          api(`/api/competitions/${competition.id}/playing-conditions`),
          api("/api/playing-conditions/catalogue"),
        ]);
        if (!off) setState({ loading: false, error: null, data, catalogue });
      } catch (/** @type {any} */ e) {
        if (!off) setState((s) => ({ ...s, loading: false, error: e?.code || "unreachable" }));
      }
    })();
    return () => { off = true; };
  }, [competition.id, nonce]);

  const { data, catalogue } = state;
  if (!data || !catalogue) {
    return <div data-testid="pc-root" style={S.card}><EmptyState loading={state.loading} error={!!state.error}/></div>;
  }

  const me = profile()?.user?.id ?? null;
  const by = (/** @type {string | null} */ id, /** @type {string | null | undefined} */ name) => (id && id === me ? "you" : name || "another administrator");
  const sets = /** @type {any[]} */ (data.sets);
  const inForce = sets.find((s) => s.id === data.inForceToday) ?? null;
  const shownId = (chosen && sets.some((s) => s.id === chosen) ? chosen : null)
    ?? inForce?.id ?? sets.find((s) => s.status === "draft")?.id ?? sets.find((s) => s.status !== "withdrawn")?.id ?? sets[0]?.id ?? null;
  const shown = sets.find((s) => s.id === shownId) ?? null;
  const shownState = shown ? standing(shown, sets, data.inForceToday) : null;
  const inForceCount = confirmedCount(catalogue, inForce?.values ?? []);
  const shownCount = confirmedCount(catalogue, shown?.values ?? []);
  const onChanged = () => setNonce((n) => n + 1);
  const pick = (/** @type {string} */ id) => { setChosen(id); setNonce((n) => n + 1); };
  const badge = { draft: T.brand.blue, in_force: T.semantic.positive, scheduled: T.semantic.info, superseded: T.content.tertiary, withdrawn: T.semantic.critical };

  return (
    <div data-testid="pc-root" style={{ display: "flex", flexDirection: "column", gap: T.space.lg, fontFamily: T.type.body }}>
      <div>
        <h3 style={S.h3}>Playing conditions</h3>
        <p style={S.body}>The figures {competition.name ? `${competition.name} is` : "this competition is"} played under: how a match runs, how the table is worked out, who may be picked.</p>
        {!data.canManage && <p data-testid="pc-readonly" style={S.meta}>Only this competition's organiser can change these.</p>}
      </div>

      <section data-testid="pc-in-force" aria-label="In force today" style={S.card}>
        {inForce ? (
          <>
            <div style={S.wrap}>
              <h4 style={S.h3}>In force today: {inForce.title}</h4>
              <Badge color={badge.in_force}>Version {inForce.version}</Badge>
            </div>
            <p data-testid="pc-in-force-date" style={S.body}>From {formatDay(inForce.effectiveFrom)}.</p>
          </>
        ) : (
          <>
            <h4 style={S.h3}>No version is in force today</h4>
            <p data-testid="pc-none-in-force" style={S.body}>Matches are played as the platform does by default. Every figure below is the platform default, unconfirmed.</p>
          </>
        )}
        <p data-testid="pc-count" style={{ ...S.body, color: T.content.primary, fontWeight: 600 }}>{inForceCount.confirmed} of {inForceCount.total} figures confirmed</p>
        <p style={S.meta}>Figures recorded but not applied are not counted.</p>
      </section>

      <section data-testid="pc-versions" aria-label="Versions" style={S.card}>
        <h4 style={S.h3}>Versions</h4>
        {sets.length === 0 && <p style={S.body}>No version has been published for this competition.</p>}
        {sets.map((s) => {
          const st = standing(s, sets, data.inForceToday);
          const selected = s.id === shownId;
          return (
            <div key={s.id} data-testid={`pc-version-${s.version}`} data-standing={st} style={S.row}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={S.wrap}>
                  <span style={S.h4}>Version {s.version}: {s.title}</span>
                  <Badge color={badge[st]} data-testid="pc-version-standing">{STANDING_WORDS[st]}</Badge>
                </div>
                <p style={S.meta}>
                  {s.status === "draft" ? `Starts ${formatDay(s.effectiveFrom)} once published. Started by ${by(s.createdBy, s.createdByName)}, ${formatWhen(s.createdAt)}.`
                    : `From ${formatDay(s.effectiveFrom)}. Published by ${by(s.publishedBy, s.publishedByName)}, ${formatWhen(s.publishedAt)}.`}
                  {s.status === "withdrawn" && ` Withdrawn by ${by(s.withdrawnBy, s.withdrawnByName)}, ${formatWhen(s.withdrawnAt)}: “${s.withdrawnNote}”.`}
                </p>
              </div>
              <button type="button" data-testid={`pc-show-${s.version}`} aria-pressed={selected} aria-label={`${selected ? "Showing" : "Show"} figures of version ${s.version}`} onClick={() => pick(s.id)} style={S.toggle(selected)}>
                {selected ? "Showing" : "Show figures"}
              </button>
            </div>
          );
        })}
      </section>

      {data.canManage && <NewDraft competitionId={competition.id} catalogue={catalogue} onCreated={pick}/>}

      <section data-testid="pc-shown" aria-label="Figures" style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
        <div style={S.card}>
          <div style={S.wrap}>
            <h4 style={S.h3}>{shown ? `Figures of version ${shown.version}: ${shown.title}` : "Figures: the platform's defaults"}</h4>
            {shown && <Badge color={badge[/** @type {keyof typeof badge} */ (shownState)]}>{STANDING_WORDS[/** @type {string} */ (shownState)]}</Badge>}
          </div>
          {shown ? (
            <>
              <p data-testid="pc-set-count" style={{ ...S.body, color: T.content.primary, fontWeight: 600 }}>{shownCount.confirmed} of {shownCount.total} figures confirmed</p>
              <VersionActions key={`${shown.id}:${shown.status}`} set={shown} state={shownState} catalogue={catalogue} canManage={data.canManage} onChanged={onChanged} onNewVersion={pick}/>
            </>
          ) : (
            <p style={S.body}>Nothing has been entered for this competition, so each figure is what the platform does today, shown as unconfirmed.</p>
          )}
          {shown && shownState === "draft" && data.canManage && <p style={S.meta}>Enter each figure with where it comes from. Anything you leave alone stays the platform default.</p>}
        </div>
        <Figures set={shown} catalogue={catalogue} canEdit={data.canManage && shownState === "draft"} onChanged={onChanged}/>
      </section>
    </div>
  );
}
