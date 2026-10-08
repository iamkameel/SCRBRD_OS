import { useEffect, useId, useMemo, useState } from "react";
import { roleGrants } from "@scrbrd/policy/roles";
import { T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { useLive, useRows } from "../lib/live.js";
import { EmptyState } from "../ui/primitives.jsx";
import { StateLabel } from "../ui/stateLabel.jsx";
import {
  KEY_WORDS, PARTS, bandDefault, confirmedCount, figureSlots, formatDay, labelOf, platformDefaultWords, refusalWords, valueWords,
} from "../lib/playingConditions.js";
import {
  AGE_GROUPS, COMP_TYPES, GENDERS, LEAGUE_FORMATS, LEVELS, TEAM_CODES, WIZARD_STEPS,
  addDays, checklistCounts, entrantSummary, entrantWords, figureKind, leagueRefusal, loadTicks, resumeStep, saToday, saveTicks, slotId,
} from "../lib/league.js";
import { Alert, Field, FigureActions, FigureEditor, Source, styles } from "./playingconditions.jsx";
import { Said, Standing, selectStyle } from "./leagueui.jsx";

/**
 * The League Administrator's wizard: make a league, invite its sides, state
 * its playing conditions, publish them, and open the fixture planner
 * (SCRBRD-127; docs/design/SCRBRD-123_planner.md §5.7).
 *
 * Reached from the Competitions screen's "+ New Competition", shown to holders
 * of `competition.manage`, and again from a league that is part-made
 * ("Finish setting up").
 *
 * WHAT THIS SCREEN DECIDES: nothing. Who may create a league, who may answer an
 * invitation (never the organiser), what a confirmed figure needs and which day
 * conditions may start are the API's and the database's; a refusal is worded
 * beside the thing refused (lib/league.js, lib/playingConditions.js).
 *
 * SAVE AND COME BACK. Everything is saved on the server as each step is done:
 * the league at step 1, each invitation at step 2, each figure at step 3. So
 * "Save and come back" only leaves, and the league's card offers "Finish setting
 * up", which opens at the first step not yet done. The one thing kept in this
 * browser alone is which defaults have been ticked as checked: the API has no
 * place for that, and a tick changes no figure.
 */

const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);
const post = (/** @type {string} */ path, /** @type {any} */ body = {}) => api(path, { method: "POST", body });

// ── The step indicator ─────────────────────────────────────────────

function StepBar({ step, furthest, onGo }) {
  const S = styles();
  return (
    <nav aria-label="Steps" data-testid="lw-steps">
      <ol style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm, listStyle: "none", margin: 0, padding: 0 }}>
        {WIZARD_STEPS.map((s) => {
          const here = s.n === step, open = s.n <= furthest;
          return (
            <li key={s.n}>
              <button type="button" data-testid={`lw-step-${s.n}`} aria-current={here ? "step" : undefined} disabled={!open}
                aria-label={`Step ${s.n} of 4: ${s.title}${here ? ", you are here" : ""}`}
                onClick={() => onGo(s.n)}
                style={{ ...S.toggle(here), minWidth: "44px", opacity: open ? 1 : 0.55, cursor: open ? "pointer" : "not-allowed" }}>
                <span aria-hidden="true">{s.n}. </span>{s.short}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Step 1: the league ─────────────────────────────────────────────

/** The schools this person may organise a league for, as the request names them. */
function organiserChoices() {
  const out = /** @type {{ id: string, name: string }[]} */ ([]);
  for (const a of profile()?.assignments ?? []) {
    if (!roleGrants(a.role, "competition.manage")) continue;
    const id = a.school ?? "";
    if (!out.some((o) => o.id === id)) out.push({ id, name: a.school ? (a.schoolName || "This school") : "No school: a league shared by the schools" });
  }
  return out.length ? out : [{ id: "", name: "No school: a league shared by the schools" }];
}

function LeagueStep({ role, comp, onSaved, onNext }) {
  const S = styles();
  const seasons = useLive("seasons", role).rows;
  const choices = useMemo(organiserChoices, []);
  const [f, setF] = useState(() => ({
    name: comp?.name ?? "", compType: comp?.compType ?? "league", format: comp?.format ?? "T20", level: comp?.level ?? "school",
    ageGroup: comp?.ageGroup ?? "", gender: comp?.gender ?? "", season: comp?.season ?? "", organiser: choices[0].id,
  }));
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const set = (/** @type {object} */ p) => setF((x) => ({ ...x, ...p }));
  const ofLevel = seasons.filter((s) => s.level === f.level);
  const hint = LEAGUE_FORMATS.find((x) => x.value === f.format)?.hint;
  const made = !!comp;

  async function submit(/** @type {import("react").FormEvent} */ e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (!made) {
        const c = await post("/api/competitions", {
          name: f.name, compType: f.compType, format: f.format, level: f.level,
          ageGroup: f.ageGroup || undefined, gender: f.gender || undefined, season: f.season || undefined,
          organiserSchoolId: f.organiser || undefined,
        });
        onSaved(c);
        onNext(`${c.name} was made. Step 2 of 4: invite its sides.`);
        return;
      } else {
        const changed = f.name !== comp.name || (f.season || "") !== (comp.season || "");
        let c = comp;
        if (changed) { c = await post(`/api/competitions/${comp.id}`, { name: f.name, season: f.season || undefined }); onSaved(c); }
        onNext(changed ? `Saved ${c.name}. Step 2 of 4: Entrants.` : undefined);
        return;
      }
    } catch (/** @type {any} */ x) { setErr(leagueRefusal(x)); }
    finally { setBusy(false); }
  }

  return (
    <form data-testid="lw-league" onSubmit={submit} style={S.card} aria-label="The league">
      <div>
        <h3 style={S.h3}>The league</h3>
        <p style={S.meta}>{made ? "The format, level and age group are fixed once the league is made. You may still change its name and season, until it has a match or a published plan." : "Who is playing, at what level, and in what format."}</p>
      </div>
      <div style={S.wrap}>
        <Field label="Name of the league" grow>{(id) => <input id={id} data-testid="lw-name" type="text" required value={f.name} onChange={(e) => set({ name: e.target.value })} style={S.input}/>}</Field>
        <Field label="Season">{(id) => (
          <select id={id} data-testid="lw-season" value={f.season} onChange={(e) => set({ season: e.target.value })} style={selectStyle()}>
            <option value="">No season yet</option>
            {ofLevel.map((s) => <option key={s.id} value={s.label}>{s.label}{s.current ? " (current)" : ""}</option>)}
            {f.season && !ofLevel.some((s) => s.label === f.season) && <option value={f.season}>{f.season}</option>}
          </select>)}</Field>
      </div>
      {!made && (
        <>
          <div style={S.wrap}>
            <Field label="Level">{(id) => (
              <select id={id} data-testid="lw-level" value={f.level} onChange={(e) => set({ level: e.target.value, season: "" })} style={selectStyle()}>
                {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>)}</Field>
            <Field label="Kind">{(id) => (
              <select id={id} data-testid="lw-type" value={f.compType} onChange={(e) => set({ compType: e.target.value })} style={selectStyle()}>
                {COMP_TYPES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>)}</Field>
            <Field label="Age group or team level">{(id) => (
              <>
                <input id={id} data-testid="lw-age" type="text" list={`${id}-ages`} maxLength={20} value={f.ageGroup} onChange={(e) => set({ ageGroup: e.target.value })} style={{ ...S.input, width: "180px" }}/>
                <datalist id={`${id}-ages`}>{AGE_GROUPS.map((a) => <option key={a} value={a}/>)}</datalist>
              </>)}</Field>
            <Field label="Gender">{(id) => (
              <select id={id} data-testid="lw-gender" value={f.gender} onChange={(e) => set({ gender: e.target.value })} style={selectStyle()}>
                {GENDERS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>)}</Field>
          </div>
          <Field label="Format" grow>{(id) => (
            <select id={id} data-testid="lw-format" value={f.format} onChange={(e) => set({ format: e.target.value })} style={selectStyle()}>
              {LEAGUE_FORMATS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>)}</Field>
          {choices.length > 1 && (
            <Field label="Organised by">{(id) => (
              <select id={id} data-testid="lw-organiser" value={f.organiser} onChange={(e) => set({ organiser: e.target.value })} style={selectStyle()}>
                {choices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>)}</Field>
          )}
        </>
      )}
      {made && (
        <dl data-testid="lw-league-facts" style={{ ...S.body, margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: T.space.lg, rowGap: T.space.xs }}>
          <dt style={S.meta}>Format</dt><dd style={{ margin: 0 }}>{comp.format || "Not stated"}</dd>
          <dt style={S.meta}>Level</dt><dd style={{ margin: 0 }}>{cap(comp.level || "school")}</dd>
          <dt style={S.meta}>Age group</dt><dd style={{ margin: 0 }}>{comp.ageGroup || "Not stated"}</dd>
        </dl>
      )}
      <p style={S.meta} data-testid="lw-overs-note">
        Overs are not typed here. They come from the format{hint ? ` (${hint.toLowerCase()})` : ""} when the playing conditions are started at step 3, and you may change them there.
      </p>
      <Alert words={err} testid="lw-error"/>
      <div style={S.wrap}>
        <button type="submit" data-testid="lw-league-next" disabled={busy || !f.name.trim()} style={{ ...S.primary, opacity: busy || !f.name.trim() ? 0.5 : 1 }}>
          {made ? "Save and go to entrants" : "Make the league and go to entrants"}
        </button>
      </div>
    </form>
  );
}

// ── Step 2: entrants ───────────────────────────────────────────────

function EntrantsStep({ comp, say }) {
  const S = styles();
  const [schools, setSchools] = useState(/** @type {any[] | null} */ (null));
  const [entrants, setEntrants] = useState(/** @type {any[] | null} */ (null));
  const [loadErr, setLoadErr] = useState(/** @type {string | null} */ (null));
  const [nonce, setNonce] = useState(0);
  const [find, setFind] = useState("");
  const [pick, setPick] = useState({ schoolId: "", teamCode: "1XI", displayName: "" });
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    api(`/api/competitions/${comp.id}/schools`).then((d) => { if (!off) setSchools(d.schools ?? []); }).catch((e) => { if (!off) setLoadErr(leagueRefusal(e)); });
    return () => { off = true; };
  }, [comp.id]);

  // The standing of every invitation, live: asked again every few seconds and
  // whenever the organiser asks (the schools answer from their own screens).
  useEffect(() => {
    let off = false;
    const load = () => api(`/api/competitions/${comp.id}/entrants`)
      .then((d) => { if (!off) { setEntrants(d.entrants ?? []); setLoadErr(null); } })
      .catch((e) => { if (!off) setLoadErr(leagueRefusal(e)); });
    load();
    const t = setInterval(load, 4000);
    return () => { off = true; clearInterval(t); };
  }, [comp.id, nonce]);

  const shown = (schools ?? []).filter((s) => !find.trim() || `${s.name} ${s.code ?? ""}`.toLowerCase().includes(find.trim().toLowerCase()));
  const schoolOf = (/** @type {string} */ id) => (schools ?? []).find((s) => s.id === id);

  async function invite(/** @type {{ schoolId: string, teamCode: string, displayName?: string }} */ who) {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/api/competitions/${comp.id}/entrants`, { schoolId: who.schoolId, teamCode: who.teamCode, displayName: who.displayName || undefined });
      const name = schoolOf(who.schoolId)?.name ?? "The school";
      say(r.detail === "already" ? `${name} ${who.teamCode} was already invited.`
        : r.detail === "invited again" ? `${name} ${who.teamCode} was invited again.`
        : `${name} ${who.teamCode} was invited. They see it under Invitations to leagues on their Competitions screen.`);
      setNonce((n) => n + 1);
      setPick((p) => ({ ...p, displayName: "" }));
    } catch (/** @type {any} */ e) { setErr(leagueRefusal(e)); }
    finally { setBusy(false); }
  }

  const list = entrants ?? [];
  return (
    <div data-testid="lw-entrants" style={{ display: "flex", flexDirection: "column", gap: T.space.lg }}>
      <section style={S.card} aria-label="Invite a side">
        <div>
          <h3 style={S.h3}>Invite a school's team</h3>
          <p style={S.meta}>A school's side plays in the league only when the school accepts. You run the league, so you cannot accept on a school's behalf.</p>
        </div>
        {schools === null && !loadErr && <EmptyState loading/>}
        {schools !== null && schools.length === 0 && <p data-testid="lw-no-schools" style={S.body}>You may not invite schools to this league.</p>}
        {schools !== null && schools.length > 0 && (
          <form onSubmit={(e) => { e.preventDefault(); invite(pick); }} style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
            <div style={S.wrap}>
              <Field label="Find a school" grow>{(id) => <input id={id} data-testid="lw-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} style={S.input}/>}</Field>
              <Field label={`School (${shown.length} shown)`} grow>{(id) => (
                <select id={id} data-testid="lw-school" value={pick.schoolId} onChange={(e) => setPick({ ...pick, schoolId: e.target.value })} style={selectStyle()}>
                  <option value="">Choose a school…</option>
                  {shown.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>)}
                </select>)}</Field>
            </div>
            <div style={S.wrap}>
              <Field label="Team">{(id) => (
                <>
                  <input id={id} data-testid="lw-team" type="text" list={`${id}-teams`} value={pick.teamCode} onChange={(e) => setPick({ ...pick, teamCode: e.target.value })} style={{ ...S.input, width: "140px" }}/>
                  <datalist id={`${id}-teams`}>{TEAM_CODES.map((t) => <option key={t} value={t}/>)}</datalist>
                </>)}</Field>
              <Field label="Name shown (optional)" grow>{(id) => <input id={id} data-testid="lw-display" type="text" value={pick.displayName} onChange={(e) => setPick({ ...pick, displayName: e.target.value })} style={S.input}/>}</Field>
            </div>
            <Alert words={err} testid="lw-invite-error"/>
            <div><button type="submit" data-testid="lw-invite" disabled={busy || !pick.schoolId || !pick.teamCode.trim()} style={{ ...S.primary, opacity: busy || !pick.schoolId ? 0.5 : 1 }}>Invite this team</button></div>
          </form>
        )}
      </section>

      <section style={S.card} aria-label="Entrants" data-testid="lw-entrant-list">
        <div style={{ ...S.wrap, justifyContent: "space-between" }}>
          <h3 style={S.h3}>Entrants</h3>
          <button type="button" data-testid="lw-refresh" onClick={() => setNonce((n) => n + 1)} style={S.secondary}>Check for answers</button>
        </div>
        <p role="status" aria-live="polite" data-testid="lw-entrant-summary" style={{ ...S.body, color: T.content.primary, fontWeight: 600 }}>
          {entrants === null ? "Loading…" : list.length ? entrantSummary(list) : "No side has been invited yet."}
        </p>
        <Alert words={loadErr} testid="lw-entrants-error"/>
        {list.length > 0 && (
          <p data-testid="lw-cannot-accept" style={S.meta}>
            A side enters the league when its school accepts. The organiser of a league cannot accept for a school, even when the league
            administrator may arrange fixtures anywhere: someone who arranges that school's fixtures must answer from their own Competitions screen.
          </p>
        )}
        {list.map((e) => (
          <div key={e.id} data-testid={`lw-entrant-${e.status}`} data-entrant={e.name} style={S.row}>
            <div style={{ flex: "1 1 240px", minWidth: 0 }}>
              <div style={S.wrap}>
                <span style={S.h4}>{e.name}</span>
                <span style={S.meta}>{e.teamCode}</span>
                <Standing tone={e.status === "accepted" ? "good" : e.status === "declined" ? "bad" : "warn"} testid="lw-entrant-status">{e.status}</Standing>
              </div>
              <p data-testid="lw-entrant-words" style={S.body}>{entrantWords(e)}</p>
            </div>
            {e.status === "declined" && (
              <button type="button" data-testid="lw-invite-again" disabled={busy} aria-label={`Invite ${e.name} ${e.teamCode} again`}
                onClick={() => invite({ schoolId: e.schoolId, teamCode: e.teamCode })} style={S.secondary}>Invite again</button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

// ── Step 3: playing conditions, a checklist ────────────────────────

/** One figure of the draft: its value, where it comes from, "Use this default" or an own value. */
function ChecklistRow({ entry, band, entered, ticked, onTick, setId, catalogue, onChanged }) {
  const S = styles();
  const [editing, setEditing] = useState(false);
  const kind = figureKind(entered);
  const id = slotId(entry.key, band);
  const tickId = useId();
  const shown = entered ? valueWords(entry, entered.value)
    : entry.key === "bowling.limit" ? valueWords(entry, bandDefault(entry, band ?? ""))
    : platformDefaultWords(entry, band);
  const canTick = kind === "none" || kind === "default";
  // Entering the league's own figure over a pre-filled default starts with a blank note: the platform's words are not the league's source.
  const existing = kind === "default" ? { ...entered, sourceNote: "" } : entered;
  const name = `${labelOf(entry.key)}${band ? `, ${band}` : ""}`;
  return (
    <div data-testid={`lw-row-${id}`} data-kind={kind} data-ticked={ticked ? "yes" : "no"} style={S.row}>
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={S.h4}>{name}</div>
        <div data-testid="lw-value" style={{ ...S.body, color: T.content.primary }}>{cap(shown)}</div>
        <div style={{ marginTop: T.space.xs }}><Source entered={entered}/></div>
        {kind === "own" && entered?.status !== "confirmed" && <p style={S.meta}>The league's own figure, not yet confirmed against a document.</p>}
        {kind === "copied" && <p style={S.meta}>Copied from another league.</p>}
      </div>
      <div style={{ ...S.wrap, flex: "0 1 auto" }}>
        {canTick && (
          <label htmlFor={tickId} style={{ ...S.wrap, minHeight: "44px", fontSize: "14px", color: T.content.primary, cursor: "pointer" }}>
            <input id={tickId} type="checkbox" data-testid={`lw-tick-${id}`} checked={ticked} onChange={(e) => onTick(id, e.target.checked)}
              style={{ width: "22px", height: "22px" }}/>
            Use this default
          </label>
        )}
        {ticked && canTick && <Standing tone="quiet" testid="lw-ticked">default in use</Standing>}
        <FigureActions entry={entry} band={band} entered={entered} canEdit setId={setId} catalogue={catalogue}
          editing={editing} setEditing={setEditing} onChanged={onChanged}/>
      </div>
      {editing && (
        <FigureEditor entry={entry} band={band} existing={existing} setId={setId} catalogue={catalogue}
          onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }}/>
      )}
    </div>
  );
}

function ConditionsStep({ comp, others, onState, say }) {
  const S = styles();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(/** @type {{ loading: boolean, error: string | null, data: any, catalogue: any }} */ ({ loading: true, error: null, data: null, catalogue: null }));
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState("");
  const [ticks, setTicks] = useState(/** @type {Set<string>} */ (new Set()));

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [data, catalogue] = await Promise.all([api(`/api/competitions/${comp.id}/playing-conditions`), api("/api/playing-conditions/catalogue")]);
        if (!off) { setState({ loading: false, error: null, data, catalogue }); onState?.(data); }
      } catch (/** @type {any} */ e) { if (!off) setState((s) => ({ ...s, loading: false, error: leagueRefusal(e) })); }
    })();
    return () => { off = true; };
  }, [comp.id, nonce, onState]);

  const { data, catalogue } = state;
  const draft = data?.sets?.find((/** @type {any} */ s) => s.status === "draft") ?? null;
  const setId = draft?.id ?? null;
  useEffect(() => { if (setId) setTicks(loadTicks(setId)); }, [setId]);

  if (!data || !catalogue) {
    return <div data-testid="lw-conditions" style={S.card}>{state.error ? <Alert words={state.error}/> : <EmptyState loading={state.loading}/>}</div>;
  }
  const refresh = () => setNonce((n) => n + 1);
  const words = (/** @type {any} */ e) => leagueRefusal(e, (x) => refusalWords(x, catalogue));

  async function start(/** @type {"defaults" | "competition"} */ from) {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/api/competitions/${comp.id}/playing-conditions/start`, from === "defaults" ? { from } : { from, sourceCompetitionId: source });
      say(from === "defaults" ? `Started from the Laws and the platform's defaults: ${r.entered} figures filled in, every one unconfirmed.`
        : `Copied from ${others.find((o) => o.id === source)?.name ?? "the other league"}: ${r.entered} figures.`);
      refresh();
    } catch (/** @type {any} */ e) { setErr(words(e)); }
    finally { setBusy(false); }
  }

  // ── Nothing started: the two shortcuts ──
  if (!data.sets.length) {
    return (
      <div data-testid="lw-conditions" style={{ display: "flex", flexDirection: "column", gap: T.space.lg }}>
        <section style={S.card} aria-label="Start the playing conditions">
          <div>
            <h3 style={S.h3}>Start the playing conditions</h3>
            <p style={S.meta}>Begin from one of these. You can change every figure afterwards, and nothing applies to a match until you publish at step 4.</p>
          </div>
          <div style={S.confirm}>
            <h4 style={S.h4}>Start from the MCC Laws and platform defaults</h4>
            <p style={S.body}>
              Fills in the figures the platform already applies: the format's overs and free hit, the bowling limit for each age band,
              and the tie break (a tie stands, as in the Laws of Cricket). Every figure begins as unconfirmed, with where it came from.
              No points are filled in: the league sets its own.
            </p>
            <div><button type="button" data-testid="lw-start-defaults" disabled={busy} onClick={() => start("defaults")} style={{ ...S.primary, opacity: busy ? 0.5 : 1 }}>Start from the MCC Laws and platform defaults</button></div>
          </div>
          <div style={S.confirm}>
            <h4 style={S.h4}>Copy from another league</h4>
            <p style={S.body}>Takes the figures now in force for a league you can read, with their documents and dates. Each note says where it was copied from.</p>
            <div style={S.wrap}>
              <Field label="Copy from" grow>{(id) => (
                <select id={id} data-testid="lw-copy-source" value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle()}>
                  <option value="">Choose a league…</option>
                  {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>)}</Field>
              <div style={{ alignSelf: "flex-end" }}>
                <button type="button" data-testid="lw-start-copy" disabled={busy || !source} onClick={() => start("competition")} style={{ ...S.secondary, opacity: busy || !source ? 0.5 : 1 }}>Copy from another league</button>
              </div>
            </div>
          </div>
          <Alert words={err} testid="lw-conditions-error"/>
        </section>
      </div>
    );
  }

  // ── A version is in place but no draft is open ──
  if (!draft) {
    const latest = data.sets.find((/** @type {any} */ s) => s.id === data.inForceToday) ?? data.sets.find((/** @type {any} */ s) => s.status === "published") ?? data.sets[0];
    return (
      <section data-testid="lw-conditions" style={S.card} aria-label="Playing conditions">
        <h3 style={S.h3}>Playing conditions are published</h3>
        <p data-testid="lw-published-note" style={S.body}>
          Version {latest.version}, “{latest.title}”, {latest.status === "published" ? `starts ${formatDay(latest.effectiveFrom)}` : `is ${latest.status}`}.
          To change a figure, open the league's Playing conditions tab and make a new version.
        </p>
      </section>
    );
  }

  // ── The checklist ──
  const applied = catalogue.keys.filter((/** @type {any} */ k) => !k.reserved);
  const values = draft.values ?? [];
  const slots = figureSlots(catalogue);
  const counts = checklistCounts(slots, values, ticks);
  const entered = (/** @type {string} */ key, /** @type {string | null} */ band) => values.find((/** @type {any} */ v) => v.key === key && (v.ageBand ?? null) === band);
  const onTick = (/** @type {string} */ id, /** @type {boolean} */ on) => {
    const next = new Set(ticks);
    if (on) next.add(id); else next.delete(id);
    setTicks(next); saveTicks(draft.id, next);
  };
  const tickAll = () => {
    const next = new Set(ticks);
    for (const s of slots) if (["none", "default"].includes(figureKind(entered(s.key, s.band)))) next.add(slotId(s.key, s.band));
    setTicks(next); saveTicks(draft.id, next);
    say("Every default is ticked as in use. They stay unconfirmed until you enter them with a document, clause and date.");
  };
  const conf = confirmedCount(catalogue, values);
  const common = { setId: draft.id, catalogue, onChanged: refresh };

  return (
    <div data-testid="lw-conditions" style={{ display: "flex", flexDirection: "column", gap: T.space.lg }}>
      <section style={S.card} aria-label="Playing conditions checklist">
        <div>
          <h3 style={S.h3}>Playing conditions: {draft.title}</h3>
          <p style={S.meta}>Version {draft.version}, a draft. For each figure, tick “Use this default” or enter your own with where it comes from. A figure is only confirmed when it names a document, a clause and its date.</p>
        </div>
        <p data-testid="lw-checklist-count" role="status" aria-live="polite" style={{ ...S.body, color: T.content.primary, fontWeight: 600 }}>
          {`${counts.total} figures: ${counts.confirmed} confirmed, ${counts.own} entered unconfirmed, ${counts.ticked} using the default, ${counts.unchecked} unconfirmed and not yet checked.`}
        </p>
        <div style={S.wrap}>
          <button type="button" data-testid="lw-tick-all" onClick={tickAll} style={S.secondary}>Use every default below</button>
        </div>
        <Alert words={err} testid="lw-conditions-error"/>
      </section>
      {PARTS.map(({ part, title, sub }) => {
        const keys = applied.filter((/** @type {any} */ k) => k.part === part);
        if (!keys.length) return null;
        return (
          <section key={part} data-testid={`lw-part-${part}`} aria-labelledby={`lw-part-h-${part}`} style={S.card}>
            <div>
              <h4 id={`lw-part-h-${part}`} style={S.h3}>{title}</h4>
              <p style={S.meta}>{sub}</p>
            </div>
            {keys.map((/** @type {any} */ k) => k.byAgeBand ? (
              <div key={k.key} data-testid={`lw-bands-${k.key}`} style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
                <div>
                  <h5 style={S.h4}>{KEY_WORDS[k.key]?.label ?? k.key}, by age band</h5>
                  <p style={S.meta}>
                    Overs a bowler may bowl in one spell and in one day. The platform's bowling defaults are the ECB fast-bowling directives mapped onto school age
                    bands. They are not CSA figures, and each row says exactly where its figure comes from.
                  </p>
                </div>
                {(catalogue.ageBands ?? []).map((/** @type {string} */ b) => {
                  const id = slotId(k.key, b);
                  return <ChecklistRow key={id} entry={k} band={b} entered={entered(k.key, b)} ticked={ticks.has(id)} onTick={onTick} {...common}/>;
                })}
              </div>
            ) : (
              <ChecklistRow key={k.key} entry={k} band={null} entered={entered(k.key, null)} ticked={ticks.has(slotId(k.key, null))} onTick={onTick} {...common}/>
            ))}
          </section>
        );
      })}
      <p style={S.meta} data-testid="lw-confirmed-note">{conf.confirmed} of {conf.total} figures are confirmed against a document.</p>
    </div>
  );
}

// ── Step 4: review and publish ─────────────────────────────────────

function PublishStep({ comp, conditions, onPlanner, onDone, say }) {
  const S = styles();
  const [entrants, setEntrants] = useState(/** @type {any[] | null} */ (null));
  const [nonce, setNonce] = useState(0);
  const [catalogue, setCatalogue] = useState(/** @type {any} */ (null));
  const [data, setData] = useState(/** @type {any} */ (conditions));
  const [date, setDate] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(/** @type {any} */ (null));
  const tomorrow = addDays(saToday(), 1);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [e, c, d] = await Promise.all([api(`/api/competitions/${comp.id}/entrants`), api("/api/playing-conditions/catalogue"), api(`/api/competitions/${comp.id}/playing-conditions`)]);
        if (off) return;
        setEntrants(e.entrants ?? []); setCatalogue(c); setData(d);
        const dr = d.sets.find((/** @type {any} */ s) => s.status === "draft");
        setDate((x) => x || (dr?.effectiveFrom && dr.effectiveFrom >= tomorrow ? dr.effectiveFrom : tomorrow));
      } catch (/** @type {any} */ x) { if (!off) setErr(leagueRefusal(x)); }
    })();
    return () => { off = true; };
  }, [comp.id, nonce, tomorrow]);

  const draft = data?.sets?.find((/** @type {any} */ s) => s.status === "draft") ?? null;
  const live = data?.sets?.find((/** @type {any} */ s) => s.status === "published") ?? null;
  const accepted = (entrants ?? []).filter((e) => e.status === "accepted");
  const sums = catalogue && draft ? {
    counts: checklistCounts(figureSlots(catalogue), draft.values ?? [], loadTicks(draft.id)), conf: confirmedCount(catalogue, draft.values ?? []),
  } : null;
  const late = !!date && date <= saToday();

  async function publish() {
    if (!draft) return;
    setBusy(true); setErr(null);
    try {
      await post(`/api/condition-sets/${draft.id}`, { effectiveFrom: date });
      await post(`/api/condition-sets/${draft.id}/publish`);
      setConfirming(false); setDone({ version: draft.version, from: date });
      say(`Published version ${draft.version} of the playing conditions, from ${formatDay(date)}.`);
      setNonce((n) => n + 1);
    } catch (/** @type {any} */ e) { setErr(leagueRefusal(e, (x) => refusalWords(x, catalogue ?? undefined))); }
    finally { setBusy(false); }
  }

  const published = done || (!draft && live);
  return (
    <div data-testid="lw-publish-step" style={{ display: "flex", flexDirection: "column", gap: T.space.lg }}>
      <section style={S.card} aria-label="Summary" data-testid="lw-summary">
        <h3 style={S.h3}>Review</h3>
        <dl style={{ ...S.body, margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: T.space.lg, rowGap: T.space.sm }}>
          <dt style={S.meta}>League</dt><dd style={{ margin: 0 }} data-testid="lw-sum-league">{comp.name}{comp.season ? `, ${comp.season}` : ""}</dd>
          <dt style={S.meta}>Format</dt><dd style={{ margin: 0 }}>{comp.format || "Not stated"}{comp.ageGroup ? ` · ${comp.ageGroup}` : ""}{comp.gender ? ` · ${cap(comp.gender)}` : ""}</dd>
          <dt style={S.meta}>Entrants</dt><dd style={{ margin: 0 }} data-testid="lw-sum-entrants">{entrants === null ? "Loading…" : entrants.length ? entrantSummary(entrants) : "None invited"}</dd>
          <dt style={S.meta}>Conditions</dt>
          <dd style={{ margin: 0 }} data-testid="lw-sum-conditions">
            {!data ? "Loading…" : draft && sums
              ? `Version ${draft.version}, a draft: ${sums.counts.total} figures, ${sums.counts.confirmed} confirmed, ${sums.counts.own} entered unconfirmed, ${sums.counts.ticked} using the default, ${sums.counts.unchecked} unconfirmed and not yet checked.`
              : live ? `Version ${live.version}, published, from ${formatDay(live.effectiveFrom)}.` : "Not started. Go back to step 3."}
          </dd>
        </dl>
        {entrants !== null && accepted.length < 2 && (
          <p data-testid="lw-few" style={{ ...S.alert, color: T.semantic.warningText }}>
            {accepted.length} {accepted.length === 1 ? "side has" : "sides have"} accepted. The planner needs at least two, so invite more or wait for answers at step 2.
          </p>
        )}
      </section>

      {draft && !done && (
        <section style={S.card} aria-label="Publish the playing conditions">
          <div>
            <h3 style={S.h3}>Publish the playing conditions</h3>
            <p style={S.meta}>From the day you choose, matches in this league are played under these figures. A published version cannot be changed, only replaced by a new one.</p>
          </div>
          <Field label="Effective from">{(id) => (
            <input id={id} data-testid="lw-effective" type="date" min={tomorrow} value={date} onChange={(e) => setDate(e.target.value)} style={{ ...S.input, width: "220px" }} aria-describedby="lw-effective-note"/>
          )}</Field>
          <p id="lw-effective-note" data-testid="lw-effective-note" style={late ? { ...S.alert, color: T.semantic.warningText } : S.meta}>
            Conditions can start tomorrow, {formatDay(tomorrow)}, at the earliest. A start today or earlier is refused, so that no match already begun changes its rules.
          </p>
          {!confirming && (
            <div><button type="button" data-testid="lw-publish" aria-expanded={false} onClick={() => { setConfirming(true); setErr(null); }} style={S.primary}>Publish…</button></div>
          )}
          {confirming && (
            <div data-testid="lw-publish-confirm" role="group" aria-label="Publish the playing conditions" style={S.confirm}>
              <p style={{ ...S.body, color: T.content.primary }}>
                Publish version {draft.version}, “{draft.title}”, from {date ? formatDay(date) : "no day chosen"}?
                {sums ? ` ${sums.conf.confirmed} of ${sums.conf.total} figures are confirmed; the rest are applied as unconfirmed.` : ""} Once published it cannot be changed.
              </p>
              <Alert words={err} testid="lw-publish-error"/>
              <div style={S.wrap}>
                <button type="button" data-testid="lw-publish-yes" disabled={busy || !date} onClick={publish} style={{ ...S.primary, opacity: busy ? 0.5 : 1 }}>Publish version {draft.version}</button>
                <button type="button" data-testid="lw-publish-no" onClick={() => setConfirming(false)} style={S.secondary}>Not yet</button>
              </div>
            </div>
          )}
          {!confirming && <Alert words={err} testid="lw-publish-error"/>}
        </section>
      )}

      {published && (
        <section style={S.card} aria-label="Next: the fixtures" data-testid="lw-next">
          <h3 style={S.h3}>{done ? "Published" : "Playing conditions are published"}</h3>
          <p data-testid="lw-published" style={S.body}>
            {done ? `Version ${done.version} is published, from ${formatDay(done.from)}.` : `Version ${live?.version} is published, from ${formatDay(live?.effectiveFrom)}.`}
            {" "}Next, plan the fixtures for the {accepted.length} {accepted.length === 1 ? "side" : "sides"} that accepted.
          </p>
          <div style={S.wrap}>
            <button type="button" data-testid="lw-open-planner" onClick={onPlanner} style={S.primary}>Open the fixture planner</button>
            <button type="button" data-testid="lw-finish" onClick={onDone} style={S.secondary}>Finish</button>
          </div>
        </section>
      )}
      {!draft && !published && <p style={S.body}>Nothing is ready to publish. Start the playing conditions at step 3.</p>}
    </div>
  );
}

// ── The wizard ─────────────────────────────────────────────────────

/**
 * @param {{ role: string, competitionId?: string | null,
 *           onClose: (r?: { planner?: any, competition?: any }) => void }} props
 */
export function LeagueWizard({ role, competitionId = null, onClose }) {
  const S = styles();
  const COMPS = useRows("competitions", role);
  const [comp, setComp] = useState(/** @type {any} */ (null));
  const [step, setStep] = useState(/** @type {number} */ (competitionId ? 0 : 1));
  const [furthest, setFurthest] = useState(competitionId ? 0 : 1);
  const [said, setSaid] = useState("");
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [conditions, setConditions] = useState(/** @type {any} */ (null));
  const others = COMPS.filter((c) => c.live && c.id !== comp?.id);

  // Reopening a part-made league: read it and open at the first step not done.
  useEffect(() => {
    if (!competitionId) return;
    let off = false;
    (async () => {
      try {
        const [c, e, p] = await Promise.all([
          api(`/api/competitions/${competitionId}/entrants`).then(async (d) => ({ canManage: d.canManage, n: d.entrants.length })),
          api(`/api/competitions/${competitionId}/playing-conditions`),
          api("/api/read/competitions"),
        ]);
        const row = p.rows.find((/** @type {any} */ r) => r.id === competitionId);
        if (off) return;
        if (!row || !c.canManage) { setError("You may not set up this league."); return; }
        setComp({ id: row.id, name: row.name, compType: row.comp_type, format: row.format, ageGroup: row.age_group, gender: row.gender, level: row.level, season: row.season, organiserSchoolId: row.school_id });
        const at = resumeStep({ entrants: c.n, sets: e.sets });
        setConditions(e); setStep(at); setFurthest(at);
        setSaid(`Picking up at step ${at} of 4.`);
      } catch (/** @type {any} */ x) { if (!off) setError(leagueRefusal(x)); }
    })();
    return () => { off = true; };
  }, [competitionId]);

  const go = (/** @type {number} */ n, /** @type {string} */ msg) => {
    setStep(n); setFurthest((f) => Math.max(f, n));
    setSaid(msg ?? `Step ${n} of 4: ${WIZARD_STEPS[n - 1].title}.`);
    document.getElementById("lw-step-heading")?.focus();
  };

  const header = (
    <div>
      <h2 id="lw-step-heading" tabIndex={-1} data-testid="lw-heading" style={{ ...S.h3, fontSize: "20px", outline: "none" }}>
        {comp ? comp.name : "New competition"}
      </h2>
      <p style={S.meta}>{step > 0 ? `Step ${step} of 4: ${WIZARD_STEPS[step - 1].title}` : "Opening…"}</p>
    </div>
  );

  if (!signedIn()) {
    return (
      <div data-testid="lw-root" style={S.card}>
        {header}
        <StateLabel kind="demo"/>
        <p data-testid="lw-demo" style={S.body}>This is a demonstration, and nothing here is saved. Sign in as a league administrator to make a league.</p>
        <div><button type="button" data-testid="lw-cancel" onClick={() => onClose()} style={S.secondary}>Back to competitions</button></div>
      </div>
    );
  }
  if (error) {
    return (
      <div data-testid="lw-root" style={S.card}>
        {header}
        <Alert words={error} testid="lw-error"/>
        <div><button type="button" data-testid="lw-cancel" onClick={() => onClose()} style={S.secondary}>Back to competitions</button></div>
      </div>
    );
  }
  if (step === 0) return <div data-testid="lw-root" style={S.card}>{header}<EmptyState loading/></div>;

  return (
    <div data-testid="lw-root" style={{ display: "flex", flexDirection: "column", gap: T.space.lg, fontFamily: T.type.body }}>
      <div style={{ ...S.wrap, justifyContent: "space-between" }}>
        {header}
        <button type="button" data-testid="lw-save-return" onClick={() => onClose({ competition: comp })} style={S.secondary}>
          {comp ? "Save and come back later" : "Cancel"}
        </button>
      </div>
      <StepBar step={step} furthest={comp ? Math.max(furthest, 2) : 1} onGo={go}/>
      <Said testid="lw-status">{said}</Said>

      {step === 1 && <LeagueStep role={role} comp={comp} onSaved={setComp} onNext={(msg) => go(2, msg)}/>}
      {step === 2 && comp && <EntrantsStep comp={comp} say={setSaid}/>}
      {step === 3 && comp && <ConditionsStep comp={comp} others={others} onState={setConditions} say={setSaid}/>}
      {step === 4 && comp && <PublishStep comp={comp} conditions={conditions} say={setSaid}
        onPlanner={() => onClose({ planner: comp, competition: comp })} onDone={() => onClose({ competition: comp })}/>}

      {comp && step > 1 && (
        <div style={{ ...S.wrap, justifyContent: "space-between" }}>
          <button type="button" data-testid="lw-back" onClick={() => go(step - 1)} style={S.secondary}>Back</button>
          {step < 4 && <button type="button" data-testid="lw-next" onClick={() => go(step + 1)} style={S.primary}>Next: {WIZARD_STEPS[step].title}</button>}
        </div>
      )}
    </div>
  );
}
