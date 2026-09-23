import { useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { featureOn, useFeatures } from "../lib/features.js";
import { holdsCapability } from "../rbac/index.js";
import { Btn, Card } from "../ui/primitives.jsx";

/**
 * The DRS review panel — built, proven, switched off.
 *
 * DRS is a FEATURE, not a role boundary: `drs_review` in
 * packages/policy/src/modules.mjs is off platform-wide, on purpose, until
 * there is ball-tracking to feed it. "Pitching in line" and "would have hit
 * leg stump" are ball-tracking outputs; entered by a person today they are a
 * judgement wearing the visual language of a measurement, which is exactly
 * what db/08's own comment on drs_review names as the thing this switch
 * exists to prevent. See tools/smoke-drs.mjs.
 *
 * THE CHECK BELOW IS A COURTESY, NOT THE GATE. The real guard is
 * `drs_review_gate`, a BEFORE INSERT OR UPDATE trigger on `drs_review`
 * (db/08_schema_programme.sql) that refuses the write in Postgres no matter
 * what any client sends, and the same feature gates the READ in
 * `readResource()` (services/api/read/read-api.mjs) through
 * `OWNER_OF_READ["drs_reviews"]`. So a school with DRS off gets nothing back
 * even from a hand-written request with a valid token — this `if` only
 * decides whether this session draws a screen for a door that is,
 * independently, already locked.
 *
 * Offered to read for whoever holds `fixture.read` (the same reach as the
 * rest of Match Centre — RLS decides the real answer), and to RECORD for
 * whoever holds `scoring.correct` — see drsRoutes in
 * services/api/write/scouting-api.mjs and the drs_review_insert policy in
 * db/09_rls_policies.sql.
 */

const CALLED_BY = ["batting", "fielding", "umpire"];
const ON_FIELD = ["out", "not_out"];
const OUTCOME = ["upheld", "overturned", "umpires_call"];
const PITCHING = ["in_line", "outside_off", "outside_leg"];
const IMPACT = ["in_line", "outside_off"];
const WICKETS = ["hitting", "missing", "umpires_call"];
const EVIDENCE = ["umpire_eye", "video_replay", "ball_tracking"];

const LABEL = {
  batting: "Batting side", fielding: "Fielding side", umpire: "On-field umpire",
  out: "Out", not_out: "Not out",
  upheld: "Upheld", overturned: "Overturned", umpires_call: "Umpire's call",
  in_line: "In line", outside_off: "Outside off", outside_leg: "Outside leg",
  hitting: "Hitting", missing: "Missing",
  umpire_eye: "Umpire's eye", video_replay: "Video replay", ball_tracking: "Ball tracking",
};
const label = (v) => (v == null || v === "" ? "—" : (LABEL[v] ?? v));

// Every refusal drsRoutes.record can send back, named honestly rather than
// shown as "invalid" — see quarantine.jsx for why a refusal must be read, not
// swallowed.
const REFUSAL = {
  feature_disabled: "DRS is switched off for this school.",
  invalid_value: "One of the values was not recognised.",
  not_permitted: "You do not hold the capability to record a review.",
  no_such_delivery: "There is no delivery at that ball number.",
  no_such_match: "That match could not be found.",
  ball_seq_required: "Enter the ball number being reviewed.",
  called_by_required: "Say who called for the review.",
  called_by_invalid: "Called by must be the batting side, the fielding side or the umpire.",
  on_field_required: "Say what the on-field umpire originally gave.",
  on_field_invalid: "On-field decision must be out or not out.",
  outcome_required: "Say what the review decided.",
  outcome_invalid: "Outcome must be upheld, overturned or umpire's call.",
  pitching_invalid: "Pitching must be in line, outside off or outside leg.",
  impact_invalid: "Impact must be in line or outside off.",
  wickets_invalid: "Wickets must be hitting, missing or umpire's call.",
  evidence_source_required: "Say how the decision was known — an umpire's eye, a replay, or ball-tracking.",
  evidence_source_invalid: "Evidence source must be umpire's eye, video replay or ball-tracking.",
};
const readable = (code) => REFUSAL[code] ?? (code ? code.replace(/_/g, " ") : "Refused.");

const EMPTY_FORM = {
  ballSeq: "", calledBy: "", onField: "", outcome: "",
  pitching: "", impact: "", wickets: "", shotOffered: "",
  evidenceSource: "", notes: "",
};

const fieldStyle = {
  padding: "7px 10px", borderRadius: D.md, background: D.surf2, border: `1px solid ${D.border}`,
  color: D.textPrimary, fontFamily: D.body, fontSize: "12px", width: "100%",
};

function Field({ text, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontFamily: D.body, fontSize: "10px", color: D.textMuted }}>
      {text}
      {children}
    </label>
  );
}

function DrsPanel({ matchId, role }) {
  // Fills the module-level feature map this session reads — see
  // DashboardView for the same call for the same reason: without something
  // mounting the hook, featureOn() answers "on" for everything forever.
  useFeatures();
  const [nonce, setNonce] = useState(0);
  const { rows, loading, error } = useLive("drs_reviews", role, nonce, matchId ? { matchId } : null);
  const canRecord = holdsCapability(role, "scoring.correct");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  // COURTESY ONLY — see the file comment. Rendering nothing here decides
  // what to DRAW; drs_review_gate and the read's own module check decide
  // what to allow, independently of this component ever existing.
  if (!featureOn("drs_review")) return null;

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaid(null);
    if (!form.ballSeq || !form.calledBy || !form.onField || !form.outcome || !form.evidenceSource) {
      setSaid("Ball number, called by, on-field decision, outcome and evidence source are all required.");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/matches/${matchId}/drs`, {
        method: "POST",
        body: {
          ballSeq: Number(form.ballSeq),
          calledBy: form.calledBy, onField: form.onField, outcome: form.outcome,
          pitching: form.pitching || null, impact: form.impact || null, wickets: form.wickets || null,
          shotOffered: form.shotOffered === "" ? null : form.shotOffered === "true",
          evidenceSource: form.evidenceSource,
          notes: form.notes || null,
        },
      });
      setForm(EMPTY_FORM);
      setNonce((n) => n + 1);
    } catch (err) {
      setSaid(readable(err.code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card sx={{ padding: "14px", marginTop: "12px" }} data-testid="drs-panel">
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px" }}>
        <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary }}>DRS reviews</div>
        <div style={{ fontFamily: D.mono, fontSize: "9px", color: D.textMuted }} data-testid="drs-count">
          {rows.length} recorded
        </div>
      </div>
      {loading ? (
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>Loading…</div>
      ) : error ? (
        <div style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose) }}>Could not load reviews ({error}).</div>
      ) : rows.length === 0 ? (
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>No reviews recorded for this match.</div>
      ) : (
        rows.map((r) => (
          <div key={r.ballSeq} data-testid={`drs-review-${r.ballSeq}`}
               style={{ padding: "9px 0", borderTop: `1px solid ${D.border}` }}>
            <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, fontWeight: 600 }}>
              Ball {r.ballSeq} — {label(r.calledBy)} review: {label(r.onField)} → {label(r.outcome)}
            </div>
            <div style={{ fontFamily: D.mono, fontSize: "10px", color: D.textMuted, marginTop: "2px" }}>
              Known by {label(r.evidenceSource)}
              {(r.pitching || r.impact || r.wickets) &&
                ` · Pitching ${label(r.pitching)} · Impact ${label(r.impact)} · Wickets ${label(r.wickets)}`}
            </div>
            {r.notes && (
              <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary, marginTop: "4px" }}>{r.notes}</div>
            )}
          </div>
        ))
      )}
      {canRecord && (
        <form onSubmit={submit} style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${D.border}` }}>
          <div style={{ fontFamily: D.head, fontSize: "10px", fontWeight: 700, color: D.textPrimary, letterSpacing: "0.06em", marginBottom: "8px" }}>
            RECORD A REVIEW
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "8px" }}>
            <Field text="Ball">
              <input type="number" min="1" value={form.ballSeq} onChange={setField("ballSeq")}
                     data-testid="drs-form-ball-seq" style={fieldStyle} />
            </Field>
            <Field text="Called by">
              <select value={form.calledBy} onChange={setField("calledBy")} data-testid="drs-form-called-by" style={fieldStyle}>
                <option value="">—</option>
                {CALLED_BY.map((v) => <option key={v} value={v}>{label(v)}</option>)}
              </select>
            </Field>
            <Field text="On-field decision">
              <select value={form.onField} onChange={setField("onField")} data-testid="drs-form-on-field" style={fieldStyle}>
                <option value="">—</option>
                {ON_FIELD.map((v) => <option key={v} value={v}>{label(v)}</option>)}
              </select>
            </Field>
            <Field text="Outcome">
              <select value={form.outcome} onChange={setField("outcome")} data-testid="drs-form-outcome" style={fieldStyle}>
                <option value="">—</option>
                {OUTCOME.map((v) => <option key={v} value={v}>{label(v)}</option>)}
              </select>
            </Field>
            <Field text="Evidence source">
              <select value={form.evidenceSource} onChange={setField("evidenceSource")} data-testid="drs-form-evidence-source" style={fieldStyle}>
                <option value="">—</option>
                {EVIDENCE.map((v) => <option key={v} value={v}>{label(v)}</option>)}
              </select>
            </Field>
            <Field text="Shot offered">
              <select value={form.shotOffered} onChange={setField("shotOffered")} data-testid="drs-form-shot-offered" style={fieldStyle}>
                <option value="">Unknown</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </Field>
            <Field text="Pitching (ball-tracking)">
              <select value={form.pitching} onChange={setField("pitching")} data-testid="drs-form-pitching" style={fieldStyle}>
                <option value="">—</option>
                {PITCHING.map((v) => <option key={v} value={v}>{label(v)}</option>)}
              </select>
            </Field>
            <Field text="Impact (ball-tracking)">
              <select value={form.impact} onChange={setField("impact")} data-testid="drs-form-impact" style={fieldStyle}>
                <option value="">—</option>
                {IMPACT.map((v) => <option key={v} value={v}>{label(v)}</option>)}
              </select>
            </Field>
            <Field text="Wickets (ball-tracking)">
              <select value={form.wickets} onChange={setField("wickets")} data-testid="drs-form-wickets" style={fieldStyle}>
                <option value="">—</option>
                {WICKETS.map((v) => <option key={v} value={v}>{label(v)}</option>)}
              </select>
            </Field>
          </div>
          <textarea value={form.notes} onChange={setField("notes")} placeholder="Notes (optional)"
                    data-testid="drs-form-notes"
                    style={{ ...fieldStyle, marginTop: "8px", minHeight: "48px", resize: "vertical" }} />
          {said && (
            <div role="alert" data-testid="drs-form-refused"
                 style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginTop: "6px" }}>
              {said}
            </div>
          )}
          <div style={{ marginTop: "8px" }}>
            <Btn size="sm" disabled={busy} data-testid="drs-form-submit">
              {busy ? "Recording…" : "Record review"}
            </Btn>
          </div>
        </form>
      )}
    </Card>
  );
}

export { DrsPanel };
