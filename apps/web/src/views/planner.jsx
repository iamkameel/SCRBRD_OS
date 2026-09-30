import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { EmptyState } from "../ui/primitives.jsx";
import { formatWhen } from "../lib/playingConditions.js";
import {
  OUTCOME_WORDS, PLAN_FORMATS, PLAN_STATE_WORDS, RULE_FIELDS, addDays, bracketRounds, dayWords, formOfRules, leagueRefusal, outcomeWords,
  planFormatWords, planGroups, rulesOfForm, saToday, sideWords, slotWords, toggledLocks,
} from "../lib/league.js";
import { Alert, Field, styles } from "./playingconditions.jsx";
import { Said, Standing } from "./leagueui.jsx";

/**
 * The fixture planner (SCRBRD-123; docs/design/SCRBRD-123_planner.md §5.5).
 *
 * For a competition's manager: choose a format and the rules, see what the
 * planner will be given (the slots the grounds have offered, closures,
 * blackouts, what is already booked), generate a draw placed in those slots,
 * lock the fixtures that must not move, regenerate around the locks, and
 * publish: each fixture becomes a match, and the screen says, fixture by
 * fixture, which were made, which already were, and which were refused and why.
 *
 * Reached from a league (the Leagues screen's "Fixture planner" tab and the
 * Competitions screen) and from the last step of the league wizard.
 *
 * WHAT THIS SCREEN DECIDES: nothing. The server computes every plan from the
 * inputs as they stand, and rechecks them at publishing; this sends a format,
 * a range, the rules, the seeds and the locks, and words what comes back. The
 * reasons a fixture has no slot are the engine's own (PLAN_REASON_TEXT), as the
 * API sends them.
 *
 * Anybody else who may reach the league sees its published versions and
 * nothing of a draft (the API answers that way), and is offered nothing to
 * change. Type is 12px at the least, every control 44px, and each message is
 * in a role="status" region.
 */

const post = (/** @type {string} */ path, /** @type {any} */ body = {}) => api(path, { method: "POST", body });

// ── What the planner will be given ─────────────────────────────────

function Inputs({ competitionId, from, to, nonce, canManage, onChanged, say }) {
  const S = styles();
  const [state, setState] = useState(/** @type {{ loading: boolean, error: string | null, data: any }} */ ({ loading: true, error: null, data: null }));
  const [bday, setBday] = useState("");
  const [breason, setBreason] = useState("");
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState(0);

  useEffect(() => {
    if (!canManage || !from || !to) return;
    let off = false;
    api(`/api/competitions/${competitionId}/planner/inputs?from=${from}&to=${to}`)
      .then((data) => { if (!off) setState({ loading: false, error: null, data }); onChanged?.(data); })
      .catch((e) => { if (!off) setState((s) => ({ ...s, loading: false, error: leagueRefusal(e) })); });
    return () => { off = true; };
    // `onChanged` is the parent's setter; the inputs are read again when the range or a change says so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, from, to, nonce, local, canManage]);

  if (!canManage) return null;
  const d = state.data;
  const groundName = (/** @type {string} */ id) => d?.grounds?.find((/** @type {any} */ g) => g.id === id)?.name ?? "A ground";
  const entrantName = (/** @type {string} */ id) => d?.entrants?.find((/** @type {any} */ e) => e.id === id)?.name ?? "A side";

  async function addBlackout(/** @type {import("react").FormEvent} */ e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await post(`/api/competitions/${competitionId}/blackouts`, { day: bday, reason: breason || undefined });
      say(`${dayWords(bday)} is now a day nobody in the league plays. Generate again to use it.`);
      setBday(""); setBreason(""); setLocal((n) => n + 1);
    } catch (/** @type {any} */ x) { setErr(leagueRefusal(x)); }
    finally { setBusy(false); }
  }
  async function removeBlackout(/** @type {any} */ b) {
    setBusy(true); setErr(null);
    try { await post(`/api/competition-blackouts/${b.id}/remove`); say(`${dayWords(b.day)} is no longer blacked out.`); setLocal((n) => n + 1); }
    catch (/** @type {any} */ x) { setErr(leagueRefusal(x)); }
    finally { setBusy(false); }
  }

  const windows = d?.windows ?? [];
  const closures = (d?.grounds ?? []).flatMap((/** @type {any} */ g) => (g.closed ?? []).map((/** @type {any} */ c) => ({ ...c, ground: g.name })));
  const blackouts = d?.blackouts ?? [];
  const known = d?.known ?? [];

  return (
    <section data-testid="pl-inputs" aria-label="What the planner will use" style={S.card}>
      <div>
        <h3 style={S.h3}>What the planner will use</h3>
        <p style={S.meta}>
          Only slots wholly inside {from ? dayWords(from) : "the first day"} to {to ? dayWords(to) : "the last day"} are used. Grounds offer slots from their own screens;
          schools add their own blackouts. You add days that are blacked out for the whole league.
        </p>
      </div>
      {state.loading && <EmptyState loading/>}
      <Alert words={state.error} testid="pl-inputs-error"/>
      {d && (
        <>
          <div data-testid="pl-windows">
            <h4 style={S.h4}>Slots offered by grounds ({windows.length})</h4>
            {windows.length === 0 && <p data-testid="pl-no-windows" style={S.body}>No ground has offered a slot in these days. Every fixture will be unscheduled until one does.</p>}
            <ul style={{ margin: 0, paddingLeft: T.space.lg, ...S.body }}>
              {windows.map((/** @type {any} */ w) => (
                <li key={w.id} data-testid="pl-window">{groundName(w.groundId)}: {slotWords(w.startsAt, w.endsAt)}{w.competitionId ? "" : ", offered to any league"}</li>
              ))}
            </ul>
          </div>
          <div data-testid="pl-closures">
            <h4 style={S.h4}>Closed grounds ({closures.length})</h4>
            {closures.length === 0 && <p style={S.body}>No ground is closed in these days.</p>}
            <ul style={{ margin: 0, paddingLeft: T.space.lg, ...S.body }}>
              {closures.map((/** @type {any} */ c) => <li key={c.id}>{c.ground} is closed {slotWords(c.from, c.to)}: {c.reason}</li>)}
            </ul>
          </div>
          <div data-testid="pl-blackouts">
            <h4 style={S.h4}>Blackout days ({blackouts.length})</h4>
            {blackouts.length === 0 && <p style={S.body}>No blackout days.</p>}
            {blackouts.map((/** @type {any} */ b) => (
              <div key={b.id} data-testid="pl-blackout" style={{ ...S.wrap, justifyContent: "space-between", minHeight: "44px" }}>
                <span style={S.body}>
                  {dayWords(b.day)}: {b.entrantId ? `${entrantName(b.entrantId)} cannot play` : "nobody in the league plays"}{b.reason ? `, ${b.reason}` : ""}
                  {b.entrantId ? <span style={S.meta}> (set by the school, read only)</span> : null}
                </span>
                {!b.entrantId && (
                  <button type="button" data-testid="pl-blackout-remove" disabled={busy} aria-label={`Remove the league blackout on ${dayWords(b.day)}`} onClick={() => removeBlackout(b)} style={S.secondary}>Remove</button>
                )}
              </div>
            ))}
            <form onSubmit={addBlackout} style={{ ...S.wrap, alignItems: "flex-end", marginTop: T.space.sm }}>
              <Field label="Black out a day for the whole league">{(id) => <input id={id} data-testid="pl-blackout-day" type="date" value={bday} onChange={(e) => setBday(e.target.value)} style={S.input}/>}</Field>
              <Field label="Reason (optional)" grow>{(id) => <input id={id} data-testid="pl-blackout-reason" type="text" maxLength={120} value={breason} onChange={(e) => setBreason(e.target.value)} style={S.input}/>}</Field>
              <button type="submit" data-testid="pl-blackout-add" disabled={busy || !bday} style={{ ...S.secondary, opacity: busy || !bday ? 0.5 : 1 }}>Add blackout</button>
            </form>
            <Alert words={err} testid="pl-blackout-error"/>
          </div>
          <div data-testid="pl-known">
            <h4 style={S.h4}>Already booked ({known.length})</h4>
            <p style={S.meta}>Matches already in the diary that hold one of the league's sides or one of these grounds. They are times and places only, and belong to the schools.</p>
            <ul style={{ margin: 0, paddingLeft: T.space.lg, ...S.body }}>
              {known.map((/** @type {any} */ k) => (
                <li key={k.matchId}>
                  {k.entrants?.length ? k.entrants.map(entrantName).join(" and ") : "A booking"} busy {slotWords(k.startsAt, k.endsAt)}{k.groundId ? ` at ${groundName(k.groundId)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

// ── Format and rules ───────────────────────────────────────────────

function RulesForm({ form, set, defaults, seeds, onSeeds, entrantName }) {
  const S = styles();
  const fid = useId();
  const f = PLAN_FORMATS.find((x) => x.value === form.format);
  return (
    <section data-testid="pl-setup" aria-label="Format and rules" style={S.card}>
      <div>
        <h3 style={S.h3}>Format and rules</h3>
        <p style={S.meta}>The planner places the draw in the slots grounds have offered, inside these days, under these rules.</p>
      </div>
      <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
        <legend style={S.label}>Format</legend>
        <div role="radiogroup" aria-label="Format" style={S.wrap}>
          {PLAN_FORMATS.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={form.format === p.value} data-testid={`pl-format-${p.value}`}
              onClick={() => set({ format: p.value })} style={S.toggle(form.format === p.value)}>{p.label}</button>
          ))}
        </div>
        <p id={`${fid}-hint`} style={S.meta}>{f?.hint}</p>
      </fieldset>
      <div style={S.wrap}>
        <Field label="First day">{(id) => <input id={id} data-testid="pl-from" type="date" value={form.from} onChange={(e) => set({ from: e.target.value })} style={S.input}/>}</Field>
        <Field label="Last day">{(id) => <input id={id} data-testid="pl-to" type="date" value={form.to} onChange={(e) => set({ to: e.target.value })} style={S.input}/>}</Field>
      </div>
      <div style={S.wrap}>
        {RULE_FIELDS.map((r) => (
          <Field key={r.key} label={`${r.label} (${r.unit})`}>{(id) => (
            <input id={id} data-testid={`pl-rule-${r.key}`} type="number" inputMode="numeric" min={r.min} max={r.max} step="1"
              placeholder={r.key === "durationMinutes" && defaults?.durationMinutes ? String(defaults.durationMinutes) : r.key === "maxPerDay" ? "1" : r.min === 0 ? "0" : ""}
              value={form.rules[r.key] ?? ""} onChange={(e) => set({ rules: { ...form.rules, [r.key]: e.target.value } })} style={{ ...S.input, width: "150px" }}/>
          )}</Field>
        ))}
      </div>
      <p style={S.meta}>{RULE_FIELDS.filter((r) => r.help).map((r) => `${r.label}: ${r.help}`).join(" ")}</p>
      {form.format === "knockout" && seeds.length > 1 && (
        <div data-testid="pl-seeds">
          <h4 style={S.h4}>Seed order</h4>
          <p style={S.meta}>Seed 1 meets the lowest seed. Move a side up or down to change the draw.</p>
          <ol style={{ margin: 0, paddingLeft: T.space.xl, ...S.body }}>
            {seeds.map((id, i) => (
              <li key={id} style={{ minHeight: "44px" }}>
                <span style={S.wrap}>
                  <span data-testid="pl-seed" style={{ minWidth: "160px" }}>{entrantName(id)}</span>
                  <button type="button" disabled={i === 0} aria-label={`Move ${entrantName(id)} up`} onClick={() => onSeeds(move(seeds, i, -1))} style={S.secondary}>Up</button>
                  <button type="button" disabled={i === seeds.length - 1} aria-label={`Move ${entrantName(id)} down`} onClick={() => onSeeds(move(seeds, i, 1))} style={S.secondary}>Down</button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

const move = (/** @type {string[]} */ list, /** @type {number} */ i, /** @type {number} */ by) => {
  const next = [...list];
  [next[i], next[i + by]] = [next[i + by], next[i]];
  return next;
};

// ── The draw ───────────────────────────────────────────────────────

function FixtureRow({ f, plan, editable, busy, onLock }) {
  const S = styles();
  const placed = !!f.startsAt;
  const name = (/** @type {any} */ s) => sideWords(s, plan);
  return (
    <li data-testid="pl-fixture" data-state={placed ? "placed" : "unscheduled"} data-locked={f.locked ? "yes" : "no"} data-fixture={f.id}
      style={{ ...S.row, listStyle: "none", alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 280px", minWidth: 0 }}>
        <div style={S.wrap}>
          <span data-testid="pl-sides" style={S.h4}>{name(f.home)} v {name(f.away)}</span>
          {f.locked && <Standing tone="info" testid="pl-locked">locked</Standing>}
          {f.made && <Standing tone="good" testid="pl-made">match made</Standing>}
          {f.held && !f.made && <Standing tone="quiet">{f.held.code === "awaiting_winner" ? "awaits a winner" : "held"}</Standing>}
        </div>
        <p style={S.meta}>Round {f.round} · Match {f.match}{f.leg > 1 ? ` · leg ${f.leg}` : ""}</p>
        {placed
          ? <p data-testid="pl-slot" style={S.body}>{slotWords(f.startsAt, f.endsAt)}{f.groundName ? `, ${f.groundName}` : ""}</p>
          : (
            <div data-testid="pl-unscheduled">
              <p style={{ ...S.body, color: T.content.primary }}>No slot for this fixture.</p>
              {f.reasons?.length > 0
                ? <ul style={{ margin: 0, paddingLeft: T.space.lg, ...S.body }}>{f.reasons.map((/** @type {any} */ r) => <li key={r.code} data-reason={r.code}>{r.text}</li>)}</ul>
                : f.held ? <p style={S.body}>{f.held.text}</p> : null}
            </div>
          )}
        {placed && f.held && <p style={S.meta}>{f.held.text}</p>}
      </div>
      {editable && placed && !f.made && (
        <button type="button" data-testid={f.locked ? "pl-unlock" : "pl-lock"} disabled={busy} aria-pressed={f.locked}
          aria-label={`${f.locked ? "Unlock" : "Lock"} ${name(f.home)} v ${name(f.away)}`} onClick={() => onLock(f)} style={S.toggle(f.locked)}>
          {f.locked ? "Unlock" : "Lock in place"}
        </button>
      )}
    </li>
  );
}

function Bracket({ plan, editable, busy, onLock }) {
  const S = styles();
  const rounds = bracketRounds(plan);
  return (
    <div data-testid="pl-bracket" style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(240px, 1fr)", gap: T.space.lg, minWidth: "min-content" }}>
        {rounds.map((r) => (
          <div key={r.round} data-testid={`pl-bracket-round-${r.round}`} style={{ display: "flex", flexDirection: "column", gap: T.space.md, justifyContent: "space-around" }}>
            <h4 style={S.h4}>{r.title} <span style={S.meta}>R{r.round}</span></h4>
            {r.fixtures.map((f) => (
              <div key={f.id} data-testid="pl-bracket-match" data-fixture={f.id} style={{ ...S.confirm, gap: T.space.xs }}>
                <span style={S.meta}>Match {f.match}</span>
                <span style={{ ...S.body, color: T.content.primary }} data-testid="pl-bracket-home">{sideWords(f.home, plan)}</span>
                <span style={S.meta}>v</span>
                <span style={{ ...S.body, color: T.content.primary }} data-testid="pl-bracket-away">{sideWords(f.away, plan)}</span>
                <span style={S.body}>{f.startsAt ? `${slotWords(f.startsAt, f.endsAt)}${f.groundName ? `, ${f.groundName}` : ""}` : "No slot yet"}</span>
                {f.locked && <Standing tone="info">locked</Standing>}
                {f.made && <Standing tone="good">match made</Standing>}
                {!f.startsAt && f.reasons?.length > 0 && <span style={S.meta}>{f.reasons.map((/** @type {any} */ x) => x.text).join(" ")}</span>}
                {editable && f.startsAt && !f.made && (
                  <button type="button" data-testid={f.locked ? "pl-unlock" : "pl-lock"} disabled={busy} aria-pressed={f.locked} onClick={() => onLock(f)} style={S.toggle(f.locked)}>
                    {f.locked ? "Unlock" : "Lock in place"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {plan.byes?.length > 0 && (
        <p data-testid="pl-byes" style={S.meta}>{plan.byes.map((/** @type {any} */ b) => `${b.name} has a bye in round ${b.round}`).join(". ")}.</p>
      )}
    </div>
  );
}

function Draw({ plan, view, setView, editable, busy, onLock }) {
  const S = styles();
  const knockout = plan.format === "knockout";
  const by = view === "day" ? "day" : "round";
  const groups = planGroups(plan, by);
  const sum = plan.summary ?? {};
  return (
    <section data-testid="pl-draw" aria-label="The draw" style={S.card}>
      <div style={{ ...S.wrap, justifyContent: "space-between" }}>
        <div>
          <h3 style={S.h3}>Version {plan.version}: {PLAN_STATE_WORDS[plan.state] ?? plan.state}</h3>
          <p data-testid="pl-summary" style={S.body}>
            {planFormatWords(plan.format)}, {dayWords(plan.from)} to {dayWords(plan.to)}: {sum.fixtures ?? plan.fixtures.length} fixtures, {sum.placed ?? 0} placed, {sum.unscheduled ?? 0} without a slot{sum.made ? `, ${sum.made} already made` : ""}.
          </p>
        </div>
        <div role="radiogroup" aria-label="Show the draw" style={S.wrap}>
          {[["round", "By round"], ["day", "By day"], ...(knockout ? [["bracket", "Bracket"]] : [])].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} data-testid={`pl-view-${v}`} onClick={() => setView(v)} style={S.toggle(view === v)}>{l}</button>
          ))}
        </div>
      </div>
      {plan.staleLocks?.length > 0 && (
        <div data-testid="pl-stale" style={S.confirm}>
          <h4 style={S.h4}>Locks that could not be applied</h4>
          <ul style={{ margin: 0, paddingLeft: T.space.lg, ...S.body }}>{plan.staleLocks.map((/** @type {any} */ s) => <li key={`${s.fixtureId}:${s.windowId}`}>{s.text}</li>)}</ul>
        </div>
      )}
      {view === "bracket" && knockout
        ? <Bracket plan={plan} editable={editable} busy={busy} onLock={onLock}/>
        : groups.map((g) => (
          <div key={g.key} data-testid={`pl-group-${g.key}`}>
            <h4 style={S.h4}>{g.title}</h4>
            <ul style={{ margin: 0, padding: 0 }}>
              {g.fixtures.map((f) => <FixtureRow key={f.id} f={f} plan={plan} editable={editable} busy={busy} onLock={onLock}/>)}
            </ul>
          </div>
        ))}
      {plan.byes?.length > 0 && view !== "bracket" && (
        <p style={S.meta}>{plan.byes.map((/** @type {any} */ b) => `${b.name} has a bye in round ${b.round}`).join(". ")}.</p>
      )}
    </section>
  );
}

// ── Publishing ─────────────────────────────────────────────────────

function PublishReport({ report, plan }) {
  const S = styles();
  const c = report.counts;
  const sideName = (/** @type {string} */ s) => s;
  return (
    <section data-testid="pl-report" aria-label="What publishing did" style={S.card}>
      <div>
        <h3 style={S.h3}>Published version {report.plan.version}</h3>
        <p data-testid="pl-report-counts" style={{ ...S.body, color: T.content.primary, fontWeight: 600 }}>
          {c.created} created, {c.already} already made, {c.refused} refused, {c.held} held back{report.first ? "" : " (this was a retry)"}.
        </p>
      </div>
      <ul style={{ margin: 0, padding: 0 }}>
        {report.results.map((/** @type {any} */ r) => (
          <li key={r.fixtureId} data-testid="pl-result" data-outcome={r.outcome} style={{ ...S.row, listStyle: "none", alignItems: "flex-start" }}>
            <div style={{ flex: "1 1 280px", minWidth: 0 }}>
              <div style={S.wrap}>
                <span style={S.h4}>{sideName(r.home)} v {sideName(r.away)}</span>
                <Standing tone={r.outcome === "created" ? "good" : r.outcome === "refused" ? "bad" : r.outcome === "held" ? "warn" : "quiet"} testid="pl-result-outcome">{OUTCOME_WORDS[r.outcome] ?? r.outcome}</Standing>
              </div>
              <p style={S.meta}>Round {r.round}</p>
              <p data-testid="pl-result-words" style={S.body}>{outcomeWords(r)}</p>
            </div>
          </li>
        ))}
      </ul>
      {plan && <p style={S.meta}>The matches now appear in the schools' fixtures and on the league's ladder.</p>}
    </section>
  );
}

function Versions({ plans, shownId, onOpen }) {
  const S = styles();
  if (!plans.length) return null;
  return (
    <section data-testid="pl-versions" aria-label="Versions" style={S.card}>
      <h3 style={S.h3}>Versions</h3>
      {plans.map((p) => (
        <div key={p.id} data-testid={`pl-version-${p.version}`} data-state={p.state} style={S.row}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={S.wrap}>
              <span style={S.h4}>Version {p.version}</span>
              <Standing tone={p.state === "published" ? "good" : p.state === "draft" ? "info" : "quiet"} testid="pl-version-state">{PLAN_STATE_WORDS[p.state] ?? p.state}</Standing>
            </div>
            <p style={S.meta}>
              {planFormatWords(p.format)}, {dayWords(p.from)} to {dayWords(p.to)}: {p.fixtures} fixtures, {p.placed} placed, {p.unscheduled} without a slot.
              {p.publishedAt ? ` Published ${formatWhen(p.publishedAt)}.` : ` Made ${formatWhen(p.createdAt)}.`}
            </p>
          </div>
          <button type="button" data-testid={`pl-open-${p.version}`} aria-pressed={p.id === shownId} aria-label={`${p.id === shownId ? "Showing" : "Show"} version ${p.version}`} onClick={() => onOpen(p.id)} style={S.toggle(p.id === shownId)}>
            {p.id === shownId ? "Showing" : "Show"}
          </button>
        </div>
      ))}
    </section>
  );
}

// ── The screen ─────────────────────────────────────────────────────

/** @param {{ competition: { id: string, name?: string, format?: string | null }, onBack?: () => void }} props */
export function FixturePlanner({ competition, onBack }) {
  const S = styles();
  const live = signedIn();
  const [listing, setListing] = useState(/** @type {{ loading: boolean, error: string | null, canManage: boolean, plans: any[] }} */ ({ loading: true, error: null, canManage: false, plans: [] }));
  const [plan, setPlan] = useState(/** @type {any} */ (null));
  const [report, setReport] = useState(/** @type {any} */ (null));
  const [form, setForm] = useState(() => {
    const from = addDays(saToday(), 7);
    return { format: "round_robin", from, to: addDays(from, 56), rules: /** @type {Record<string, string>} */ ({}) };
  });
  const [inputs, setInputs] = useState(/** @type {any} */ (null));
  const [seeds, setSeeds] = useState(/** @type {string[]} */ ([]));
  const [nonce, setNonce] = useState(0);
  const [view, setView] = useState("round");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [said, setSaid] = useState("");
  const [confirming, setConfirming] = useState(false);

  const setF = useCallback((/** @type {object} */ p) => setForm((x) => ({ ...x, ...p })), []);

  // The versions, and the newest one open. The form takes that version's own
  // format, range and rules, so regenerating starts from what it was.
  const load = useCallback(async (/** @type {string | null} */ open = null) => {
    try {
      const l = await api(`/api/competitions/${competition.id}/plans`);
      setListing({ loading: false, error: null, canManage: !!l.canManage, plans: l.plans ?? [] });
      const id = open ?? l.plans?.[0]?.id ?? null;
      if (id) {
        const p = await api(`/api/competitions/${competition.id}/plans/${id}`);
        setPlan(p);
        setForm({ format: p.format, from: p.from, to: p.to, rules: formOfRules(p.rules) });
        setView(p.format === "knockout" ? "bracket" : "round");
      } else setPlan(null);
    } catch (/** @type {any} */ e) { setListing((s) => ({ ...s, loading: false, error: leagueRefusal(e) })); }
  }, [competition.id]);

  useEffect(() => {
    if (live) load();
  }, [live, load]);

  const onInputs = useCallback((/** @type {any} */ d) => {
    setInputs(d);
    // Seed order: what the manager has arranged, then anyone new.
    setSeeds((old) => {
      const ids = (d.entrants ?? []).map((/** @type {any} */ e) => e.id);
      return [...old.filter((id) => ids.includes(id)), ...ids.filter((/** @type {string} */ id) => !old.includes(id))];
    });
  }, []);
  const entrantName = useMemo(() => (/** @type {string} */ id) => inputs?.entrants?.find((/** @type {any} */ e) => e.id === id)?.name ?? "A side", [inputs]);

  const canManage = listing.canManage;
  const editable = canManage && plan?.state === "draft";

  async function run(/** @type {() => Promise<void>} */ fn) {
    setBusy(true); setErr(null);
    try { await fn(); }
    catch (/** @type {any} */ e) { setErr(leagueRefusal(e)); }
    finally { setBusy(false); }
  }

  const generate = () => run(async () => {
    const { rules, problem } = rulesOfForm(form.rules);
    if (problem) { setErr(problem); return; }
    const p = await post(`/api/competitions/${competition.id}/plans`, {
      format: form.format, from: form.from, to: form.to, rules,
      ...(form.format === "knockout" && seeds.length ? { entrants: seeds } : {}),
    });
    setPlan(p); setReport(null); setConfirming(false);
    setView(p.format === "knockout" ? "bracket" : "round");
    setSaid(`Version ${p.version} is a draft: ${p.summary?.placed ?? 0} of ${p.summary?.fixtures ?? 0} fixtures placed.`);
    await refreshList();
  });
  const regenerate = () => run(async () => {
    if (!plan) return;
    const p = await post(`/api/competitions/${competition.id}/plans`, { basedOn: plan.id });
    setPlan(p); setReport(null); setConfirming(false);
    setSaid(`Version ${p.version} is a draft, made again with the locks kept: ${p.summary?.placed ?? 0} of ${p.summary?.fixtures ?? 0} fixtures placed.`);
    await refreshList();
  });
  const lock = (/** @type {any} */ f) => run(async () => {
    const p = await post(`/api/competitions/${competition.id}/plans/${plan.id}/locks`, { locks: toggledLocks(plan.locks ?? [], f) });
    setPlan(p);
    setSaid(f.locked ? "Unlocked. It may move when you generate again." : "Locked in place. Generating again keeps it where it is.");
  });
  const publish = () => run(async () => {
    const r = await post(`/api/competitions/${competition.id}/plans/${plan.id}/publish`);
    setReport(r); setConfirming(false);
    setSaid(`Published version ${r.plan.version}: ${r.counts.created} created, ${r.counts.already} already made, ${r.counts.refused} refused, ${r.counts.held} held back.`);
    const p = await api(`/api/competitions/${competition.id}/plans/${plan.id}`);
    setPlan(p);
    await refreshList();
  });
  async function refreshList() {
    try { const l = await api(`/api/competitions/${competition.id}/plans`); setListing({ loading: false, error: null, canManage: !!l.canManage, plans: l.plans ?? [] }); } catch { /* the list shows what it had */ }
  }
  const open = (/** @type {string} */ id) => run(async () => {
    const p = await api(`/api/competitions/${competition.id}/plans/${id}`);
    setPlan(p); setReport(null); setConfirming(false);
    setForm({ format: p.format, from: p.from, to: p.to, rules: formOfRules(p.rules) });
    setView(p.format === "knockout" ? "bracket" : "round");
  });

  if (!live) {
    return (
      <div data-testid="pl-root" style={S.card}>
        <h2 style={S.h3}>Fixture planner</h2>
        <p data-testid="pl-demo" style={S.body}>This is a demonstration. Sign in as the league's organiser to plan fixtures.</p>
        {onBack && <div><button type="button" onClick={onBack} style={S.secondary}>Back</button></div>}
      </div>
    );
  }
  if (listing.loading) return <div data-testid="pl-root" style={S.card}><EmptyState loading error={false}/></div>;

  const accepted = inputs?.entrants?.length;
  return (
    <div data-testid="pl-root" style={{ display: "flex", flexDirection: "column", gap: T.space.lg, fontFamily: T.type.body }}>
      <div style={{ ...S.wrap, justifyContent: "space-between" }}>
        <div>
          <h2 data-testid="pl-heading" style={{ ...S.h3, fontSize: "20px" }}>Fixture planner: {competition.name ?? "this league"}</h2>
          <p style={S.meta}>{canManage ? "Draw the fixtures, place them in the slots grounds have offered, and publish them as matches." : "The published fixtures of this league."}</p>
        </div>
        {onBack && <button type="button" data-testid="pl-back" onClick={onBack} style={S.secondary}>Back to the league</button>}
      </div>
      <Said testid="pl-status">{said}</Said>
      <Alert words={listing.error} testid="pl-error"/>

      {!canManage && (
        <p data-testid="pl-readonly" style={S.body}>
          Only this league's organiser plans its fixtures. {listing.plans.length ? "The published versions are below." : "Nothing has been published yet."}
        </p>
      )}

      {canManage && (
        <>
          <RulesForm form={form} set={setF} defaults={inputs?.defaults} seeds={seeds} onSeeds={setSeeds} entrantName={entrantName}/>
          <Inputs competitionId={competition.id} from={form.from} to={form.to} nonce={nonce} canManage={canManage} onChanged={onInputs} say={setSaid}/>
          <section style={S.card} aria-label="Generate">
            <p data-testid="pl-entrants-note" style={S.body}>
              {accepted == null ? "" : `${accepted} ${accepted === 1 ? "side has" : "sides have"} accepted and will be drawn.`}
              {accepted != null && accepted < 2 ? " A draw needs at least two: invite more sides in the league wizard." : ""}
            </p>
            <Alert words={err} testid="pl-gen-error"/>
            <div style={S.wrap}>
              <button type="button" data-testid="pl-generate" disabled={busy || !form.from || !form.to} onClick={generate} style={{ ...S.primary, opacity: busy ? 0.5 : 1 }}>
                {plan ? "Generate a new draw" : "Generate fixtures"}
              </button>
              <button type="button" data-testid="pl-refresh-inputs" onClick={() => setNonce((n) => n + 1)} style={S.secondary}>Read the inputs again</button>
            </div>
          </section>
        </>
      )}

      {plan && (
        <>
          <Draw plan={plan} view={view} setView={setView} editable={editable} busy={busy} onLock={lock}/>
          {canManage && (
            <section style={S.card} aria-label="Regenerate and publish">
              <div style={S.wrap}>
                {plan.state !== "superseded" && (
                  <button type="button" data-testid="pl-regenerate" disabled={busy} onClick={regenerate} style={S.secondary}>Regenerate, keeping locks</button>
                )}
                {plan.state === "draft" && !confirming && (
                  <button type="button" data-testid="pl-publish" aria-expanded={false} disabled={busy} onClick={() => { setConfirming(true); setErr(null); }} style={S.primary}>Publish…</button>
                )}
              </div>
              {plan.state === "draft" && <p style={S.meta}>Regenerating makes a new version from the inputs as they are now. Locked fixtures stay where they are; the rest may move.</p>}
              {confirming && (
                <div data-testid="pl-publish-confirm" role="group" aria-label="Publish this version" style={S.confirm}>
                  <p style={{ ...S.body, color: T.content.primary }}>
                    Publish version {plan.version}? Each placed fixture is made into a match in its school's name, and the ground is checked once more first.
                    {plan.summary?.unscheduled ? ` ${plan.summary.unscheduled} fixtures have no slot and will not be made.` : ""} It cannot be taken back; later versions keep the matches that were made.
                  </p>
                  <div style={S.wrap}>
                    <button type="button" data-testid="pl-publish-yes" disabled={busy} onClick={publish} style={S.primary}>Publish version {plan.version}</button>
                    <button type="button" data-testid="pl-publish-no" onClick={() => setConfirming(false)} style={S.secondary}>Not yet</button>
                  </div>
                </div>
              )}
              {!confirming && <Alert words={err} testid="pl-action-error"/>}
            </section>
          )}
        </>
      )}
      {report && <PublishReport report={report} plan={plan}/>}
      <Versions plans={listing.plans} shownId={plan?.id} onOpen={open}/>
    </div>
  );
}
