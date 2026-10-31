/**
 * SELECTION — a union selector finds the boys whose families named his union
 * (docs/design/UNION_SELECTOR_FIND.md, slice S3; db/125; Kameel 30 Oct 2026,
 * all six questions as recommended).
 *
 * The screen asks, in order: the institution (a chip, only when he reads at
 * two), a school or an age group (at least one, D2), and optionally a name
 * within that (Q6). Each row is a name, a school and a side, and nothing else
 * (D3, §4.3–4.4): no figure, honour, ranking or date of birth, and the order
 * is the server's (school, then surname). Tapping a row opens that boy's
 * passport by id through passport() and passport_name() (D6).
 *
 * Every row shown is a read his family sees (D5): so a list is asked for only
 * when he presses the button, never on a keystroke. Nothing is kept (D7,
 * §4.6): the rows live in this component's memory while they are drawn, the
 * reads are answered no-store, and nothing goes to localStorage, IndexedDB or
 * the service worker (which never caches /api/). The list is read again when
 * the screen opens and when he comes back from a passport, so a consent taken
 * back takes the row with it. A failed open says "No longer open to
 * {institution}" and nothing more (§4.2).
 *
 * The server decides everything: who reads as a union, which boys, and the
 * record. This screen only draws its answer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { D, T, textOn, themed } from "../design/tokens.js";
import { Card, EmptyState, SectionHeader } from "../ui/primitives.jsx";
import { api, signedIn } from "../lib/api.js";
import { AGE_GROUPS, asRow, canList, closedWords, emptyWords, listQuery, showsChip } from "../lib/selection.js";

const CONFIDENCE_TONE = themed(() => ({ derived: D.emerald, verified: D.emerald, asserted: D.amber, seeded: D.textMuted }));

// 44px to tap and 16px in a field (a phone does not zoom the page to type).
const field = () => ({
  minHeight: "44px", padding: "8px 12px", background: D.surf2, border: `1px solid ${D.border}`,
  borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: "16px", width: "100%",
});
const labelStyle = () => ({
  display: "block", fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted,
  letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "5px",
});
const button = (primary) => ({
  minHeight: "44px", padding: "8px 18px", borderRadius: D.pill, cursor: "pointer",
  border: `1px solid ${primary ? "transparent" : D.border}`,
  background: primary ? D.gradMain : "transparent", color: primary ? T.light.ink : D.textSecondary,
  fontFamily: D.head, fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em",
});

/** One read, no store: the answer's rows, or the refusal. */
const read = (path) => api(path).then((r) => ({ ok: true, rows: r?.rows ?? [] }), (e) => ({ ok: false, error: e }));

function SelectionView() {
  const [orgs, setOrgs] = useState({ state: "loading", rows: [] });
  const [org, setOrg] = useState("");
  const [schools, setSchools] = useState([]);
  const [school, setSchool] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [q, setQ] = useState("");
  // The last list asked for, by its query string: what "return" reads again.
  const [asked, setAsked] = useState(null);
  const [list, setList] = useState({ state: "idle", rows: [] });
  const [open, setOpen] = useState(null);   // { id, school, side } of the boy being read
  const seq = useRef(0);
  const listHead = useRef(null);

  // On open: the institutions at which he reads, read afresh.
  useEffect(() => {
    if (!signedIn()) return undefined;
    let off = false;
    read("/api/read/passport_union_orgs").then((r) => {
      if (off) return;
      if (!r.ok) { setOrgs({ state: "error", rows: [] }); return; }
      setOrgs({ state: "ok", rows: r.rows });
      if (r.rows.length === 1) setOrg(r.rows[0].org_id);
    });
    return () => { off = true; };
  }, []);

  // The schools he may filter by, for the institution chosen.
  useEffect(() => {
    setSchools([]); setSchool("");
    if (!org) return undefined;
    let off = false;
    read(`/api/read/passport_union_schools?org=${encodeURIComponent(org)}`)
      .then((r) => { if (!off && r.ok) setSchools(r.rows); });
    return () => { off = true; };
  }, [org]);

  const runList = useCallback(async (qs) => {
    const mine = ++seq.current;
    setList({ state: "loading", rows: [] });
    const r = await read(`/api/read/passport_union_list?${qs}`);
    if (mine !== seq.current) return;
    if (r.ok) setList({ state: "ok", rows: r.rows.map(asRow) });
    else setList({ state: r.error?.code === "choose_a_school_or_age_group" ? "refused" : "error", rows: [] });
  }, []);

  const ask = (e) => {
    e?.preventDefault();
    const qs = listQuery({ org, school, ageGroup, q });
    if (!qs) return;
    setAsked(qs);
    runList(qs);
  };

  // Changing the institution forgets the last list: its rows were his union's.
  const chooseOrg = (id) => { setOrg(id); setAsked(null); setList({ state: "idle", rows: [] }); };

  // On return from a passport: the same list, read again (a consent taken
  // back meanwhile takes its row), and focus back where he was.
  const back = () => {
    setOpen(null);
    if (asked) runList(asked);
    requestAnimationFrame(() => listHead.current?.focus());
  };

  const institution = orgs.rows.find((o) => o.org_id === org)?.name ?? null;

  if (!signedIn()) {
    return (
      <div style={{ padding: "24px" }} data-testid="selection">
        <SectionHeader title="Selection"/>
        <EmptyState icon="clipboard-list" message="Sign in to find the boys whose families named your union."/>
      </div>
    );
  }

  if (open) {
    return <SelectionPassport boy={open} institution={institution} onBack={back}/>;
  }

  const may = canList({ org, school, ageGroup });
  return (
    <div style={{ padding: "24px 16px", maxWidth: "760px" }} data-testid="selection">
      <SectionHeader title="Selection"
        sub="The boys whose families named your union, by school or age group. Each boy you are shown is listed to his family, with your name."/>
      {orgs.state === "loading" && <EmptyState loading/>}
      {orgs.state === "error" && <EmptyState error onRetry={() => window.location.reload()}/>}
      {orgs.state === "ok" && orgs.rows.length === 0 && (
        <div data-testid="selection-no-union">
          <EmptyState icon="clipboard-list" message="You are not a named selector at a union, so there is nobody to list."/>
        </div>
      )}
      {orgs.state === "ok" && orgs.rows.length > 0 && (
        <Card className="" sx={{ padding: "16px" }}>
          <form onSubmit={ask} data-testid="selection-filters" aria-label="Who to list">
            {showsChip(orgs.rows) && (
              <fieldset style={{ border: "none", padding: 0, margin: "0 0 14px" }}>
                <legend style={labelStyle()}>As</legend>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {orgs.rows.map((o) => (
                    <button key={o.org_id} type="button" aria-pressed={org === o.org_id} onClick={() => chooseOrg(o.org_id)}
                      data-testid={`selection-org-${o.org_id}`}
                      style={{ ...button(false), borderColor: org === o.org_id ? D.indigo : D.border,
                               background: org === o.org_id ? D.indigo + "1f" : "transparent",
                               color: org === o.org_id ? D.textPrimary : D.textSecondary }}>
                      {o.name}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
              <div>
                <label htmlFor="selection-school" style={labelStyle()}>School</label>
                <select id="selection-school" data-testid="selection-school" value={school} disabled={!org}
                  onChange={(e) => setSchool(e.target.value)} style={field()}>
                  <option value="">{org ? "Any school" : "Choose the union first"}</option>
                  {schools.map((s) => <option key={s.school_id} value={s.school_id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="selection-age" style={labelStyle()}>Age group</label>
                <select id="selection-age" data-testid="selection-age" value={ageGroup} disabled={!org}
                  onChange={(e) => setAgeGroup(e.target.value)} style={field()}>
                  <option value="">Any age group</option>
                  {AGE_GROUPS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="selection-name" style={labelStyle()}>Name (optional)</label>
                <input id="selection-name" data-testid="selection-name" type="search" value={q} disabled={!org}
                  autoComplete="off" spellCheck={false} enterKeyHint="search"
                  onChange={(e) => setQ(e.target.value)} placeholder="Part of his name" style={field()}/>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginTop: "14px" }}>
              <button type="submit" disabled={!may} data-testid="selection-list"
                style={{ ...button(true), opacity: may ? 1 : 0.4, cursor: may ? "pointer" : "not-allowed" }}>
                Show the boys
              </button>
              {!may && org && (
                <span data-testid="selection-choose" style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>
                  Choose a school or an age group first.
                </span>
              )}
            </div>
          </form>
        </Card>
      )}
      {list.state !== "idle" && (
        <section aria-labelledby="selection-rows-head" style={{ marginTop: "16px" }}>
          <h3 id="selection-rows-head" ref={listHead} tabIndex={-1}
            style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em",
                     textTransform: "uppercase", margin: "0 0 8px", outline: "none" }}>
            {institution ?? "Your union"}
          </h3>
          <div aria-live="polite">
            {list.state === "loading" && <EmptyState loading/>}
            {list.state === "error" && <EmptyState error onRetry={() => asked && runList(asked)}/>}
            {list.state === "refused" && (
              <div data-testid="selection-refused" style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>
                Choose a school or an age group first.
              </div>
            )}
            {list.state === "ok" && list.rows.length === 0 && (
              <div data-testid="selection-empty" style={{ padding: "24px 8px", textAlign: "center", fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>
                {emptyWords(institution)}
              </div>
            )}
            {list.state === "ok" && list.rows.length > 0 && (
              <ul data-testid="selection-rows" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {list.rows.map((r) => (
                  <li key={r.id} style={{ borderTop: `1px solid ${D.border}` }}>
                    <button type="button" data-testid={`selection-row-${r.id}`}
                      onClick={() => { seq.current++; setOpen({ id: r.id, school: r.school, side: r.side }); }}
                      style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", minHeight: "48px",
                               padding: "8px 4px", background: "transparent", border: "none", cursor: "pointer",
                               textAlign: "left", color: D.textPrimary }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontFamily: D.body, fontSize: "14px", fontWeight: 600, overflowWrap: "anywhere" }}>{r.name}</span>
                        <span style={{ display: "block", fontFamily: D.body, fontSize: "12px", color: D.textMuted, overflowWrap: "anywhere" }}>
                          {[r.school, r.side].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span aria-hidden="true" style={{ fontFamily: D.body, fontSize: "16px", color: D.textMuted }}>›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One boy's passport, opened from a row by his id: his name through
 * passport_name() and his lines through passport(), both read afresh on every
 * open, each a read his family sees. A shut door (his name answered null)
 * says "No longer open to {institution}" and nothing more: not withdrawn, not
 * lapsed, not moved (§4.2).
 */
/** A passport line as the server answers it, in the profile card's words (lib/live.js asPassportLine). */
const asLine = (r) => ({ family: r.family, label: r.label, value: r.value, on: r.on_date ? String(r.on_date).slice(0, 10) : null,
                         source: r.source_school, recordedBy: r.recorded_by, confidence: r.confidence });

function SelectionPassport({ boy, institution, onBack }) {
  const [state, setState] = useState({ state: "loading", name: null, lines: [] });
  const [nonce, setNonce] = useState(0);
  const head = useRef(null);

  useEffect(() => {
    let off = false;
    setState({ state: "loading", name: null, lines: [] });
    const id = encodeURIComponent(boy.id);
    Promise.all([read(`/api/read/passport_name?playerId=${id}`), read(`/api/read/passport?playerId=${id}`)])
      .then(([n, p]) => {
        if (off) return;
        if (!n.ok || !p.ok) { setState({ state: "error", name: null, lines: [] }); return; }
        const name = n.rows[0]?.name ?? null;
        setState(name ? { state: "ok", name, lines: p.rows.map(asLine) } : { state: "closed", name: null, lines: [] });
      });
    return () => { off = true; };
  }, [boy.id, nonce]);

  useEffect(() => { if (state.state !== "loading") head.current?.focus(); }, [state.state]);

  return (
    <div style={{ padding: "24px 16px", maxWidth: "760px" }} data-testid="selection-passport" data-state={state.state}>
      <button type="button" onClick={onBack} data-testid="selection-back" style={{ ...button(false), marginBottom: "16px" }}>
        ‹ Back to the list
      </button>
      {state.state === "loading" && <EmptyState loading/>}
      {state.state === "error" && <EmptyState error onRetry={() => setNonce((n) => n + 1)}/>}
      {state.state === "closed" && (
        <div ref={head} tabIndex={-1} role="status" data-testid="selection-closed"
          style={{ padding: "24px 8px", fontFamily: D.body, fontSize: "14px", color: D.textPrimary, outline: "none" }}>
          {closedWords(institution)}
        </div>
      )}
      {state.state === "ok" && (
        <Card className="" sx={{ padding: "16px" }}>
          <h2 ref={head} tabIndex={-1} data-testid="selection-passport-name"
            style={{ fontFamily: D.head, fontSize: "16px", fontWeight: 700, color: D.textPrimary, margin: 0, outline: "none" }}>
            {state.name}
          </h2>
          <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, margin: "4px 0 12px" }}>
            {[boy.school, boy.side].filter(Boolean).join(" · ")}
          </div>
          {state.lines.length === 0
            ? <div data-testid="selection-passport-none" style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>Nothing on his record yet.</div>
            : state.lines.map((r, i) => {
              const tone = CONFIDENCE_TONE[r.confidence] ?? D.textMuted;
              return (
                <div key={`${r.family}-${r.label}-${i}`} data-testid={`selection-passport-${r.family}`}
                  style={{ display: "flex", alignItems: "baseline", gap: "10px", padding: "8px 0", borderTop: `1px solid ${D.border}`, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "160px" }}>
                    <span style={{ fontFamily: D.body, fontSize: "12px", fontWeight: 600, color: D.textPrimary }}>{r.label}</span>
                    <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, marginLeft: "8px" }}>{r.value}</span>
                  </div>
                  <span style={{ fontFamily: D.mono, fontSize: "12px", color: D.textMuted }}>{[r.on, r.source, r.recordedBy].filter(Boolean).join(" · ")}</span>
                  <span style={{ fontFamily: D.mono, fontSize: "12px", textTransform: "uppercase", padding: "2px 8px", borderRadius: D.pill,
                                 background: tone + "14", border: `1px solid ${tone}33`, color: textOn(tone) }}>{r.confidence}</span>
                </div>
              );
            })}
        </Card>
      )}
    </div>
  );
}

export { SelectionView };
