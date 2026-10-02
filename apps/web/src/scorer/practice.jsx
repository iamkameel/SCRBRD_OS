import { useEffect, useRef, useState } from "react";
import { T, inkOn } from "../design/tokens.js";
import { Icon } from "../ui/icons.jsx";
import { CaptureProfilePicker, Sheet } from "./ui.jsx";
import { OpeningSetupStep, TossStep } from "./setup.jsx";
import { PracticeLabel } from "./practiceLabel.jsx";
import {
  CLASSES, DIVISIONS, MAX_OVERS, MAX_SQUAD, MIN_SQUAD, OVERS_PRESETS, WEATHER_CONDITIONS,
  addNames, blankDraft, clearDraft, deleteAllPractice, deletePractice, isRepeated, lineUp, listPractice, loadDraft, loadPractice,
  locate, moveAt, newPracticeId, oversOf, parseSquadText, practiceCfg, practiceRecord, removeAt, saveDraft, savedWords,
  sharedNames, sameTeam, practiceTeamName, teamProblems, toggleTwelfth, validateSquad, weatherChange, weatherChangeWords, weatherRecord,
  withoutDuplicates,
} from "../lib/practice.js";
import { getWeatherHint } from "../lib/weatherHint.js";
import { scorecardFileName, scorecardText, saveTextFile } from "../lib/practiceExport.js";
import { loadMatch } from "../lib/persist.js";

/**
 * PRACTICE MATCH, PHASE 1 — the screens.
 *
 *   PracticeSetup         six steps: the match, the teams, each squad, the
 *                         toss, the openers and the opening bowler. The toss
 *                         and the openers are the scorer's own steps
 *                         (setup.jsx TossStep, OpeningSetupStep); the rest are
 *                         typed, because there is no roster to pick from.
 *   PracticeList          every practice match on this phone: Resume, save the
 *                         scorecard, delete one, delete all.
 *   PracticeWeatherSheet  the scorer's own observation, mid-match.
 *
 * Every one of them carries the PracticeLabel, and none of them sends
 * anything anywhere (lib/practice.js says what is kept, and where).
 *
 * Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read under 12px, nothing
 * tapped under 44px, tokens read from T while it draws (so both themes), the
 * page works at 390px, no emoji in a control. Motion is the pad's own
 * (.pressBtn); there is none of this file's.
 */

// ── Styles, read from the tokens at draw time so a theme switch applies ──
const S = {
  page: () => ({ minHeight: "100vh", background: T.surface.canvas, color: T.content.primary }),
  bar: () => ({
    position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", gap: T.space.sm,
    minHeight: "56px", padding: `${T.space.xs} ${T.space.md}`, background: T.surface.base, borderBottom: `1px solid ${T.line.normal}`,
  }),
  main: () => ({ maxWidth: "520px", margin: "0 auto", padding: `${T.space.lg} ${T.space.lg} ${T.space.huge}`, display: "grid", gap: T.space.lg }),
  card: () => ({ background: T.surface.raised, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg, padding: T.space.lg, display: "grid", gap: T.space.md, minWidth: 0 }),
  h2: () => ({ ...T.role.title.md, margin: 0, color: T.content.primary }),
  label: () => ({ ...T.role.label, color: T.content.secondary, margin: 0 }),
  body: () => ({ fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.45, color: T.content.secondary, margin: 0 }),
  field: () => ({
    width: "100%", minHeight: "48px", boxSizing: "border-box", padding: `0 ${T.space.md}`, borderRadius: T.radius.md,
    border: `1px solid ${T.line.strong}`, background: T.surface.interactive, color: T.content.primary,
    fontFamily: T.type.body, fontSize: "16px",
  }),
  area: () => ({
    width: "100%", minHeight: "104px", boxSizing: "border-box", padding: T.space.md, borderRadius: T.radius.md, resize: "vertical",
    border: `1px solid ${T.line.strong}`, background: T.surface.interactive, color: T.content.primary,
    fontFamily: T.type.body, fontSize: "16px", lineHeight: 1.4,
  }),
  chip: (on) => ({
    minHeight: "44px", minWidth: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.pill, cursor: "pointer",
    fontFamily: T.type.body, fontSize: "14px", fontWeight: on ? 700 : 500, color: T.content.primary,
    background: on ? T.surface.overlay : T.surface.interactive, border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.strong}`,
  }),
  primary: (ok = true) => ({
    width: "100%", minHeight: "48px", borderRadius: T.radius.md, cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.5,
    border: "none", background: T.content.primary, color: T.surface.base, fontFamily: T.type.body, fontSize: "16px", fontWeight: 700,
  }),
  secondary: () => ({
    minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md, cursor: "pointer", flexShrink: 0,
    border: `1px solid ${T.line.strong}`, background: T.surface.interactive, color: T.content.primary,
    fontFamily: T.type.body, fontSize: "14px", fontWeight: 600,
  }),
  danger: () => ({
    minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md, cursor: "pointer", flexShrink: 0,
    border: `1px solid ${T.semantic.critical}`, background: "transparent", color: T.semantic.criticalText,
    fontFamily: T.type.body, fontSize: "14px", fontWeight: 600,
  }),
  dangerSolid: () => ({
    minHeight: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.md, cursor: "pointer", flexShrink: 0,
    border: "none", background: T.semantic.critical, color: inkOn(T.semantic.critical),
    fontFamily: T.type.body, fontSize: "14px", fontWeight: 700,
  }),
  icon: () => ({
    width: "44px", height: "44px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0,
    background: "transparent", border: "none", cursor: "pointer", color: T.content.secondary, borderRadius: T.radius.md,
  }),
  note: (tone) => ({
    ...S.body(), padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md, border: `1px solid ${T.line.normal}`,
    background: T.surface.interactive, color: tone === "bad" ? T.semantic.criticalText : T.content.primary,
  }),
};

const Row = ({ children, gap = T.space.sm, wrap = true }) => (
  <div style={{ display: "flex", flexWrap: wrap ? "wrap" : "nowrap", gap, alignItems: "center" }}>{children}</div>
);

/**
 * A choice that is a button: a radio when `pressed` is off (one of several,
 * `aria-checked`), a toggle when it is on (`aria-pressed`). At module level on
 * purpose: made inside a screen it is a new component on every draw, and a
 * button that is rebuilt as it is pressed loses the focus it was given.
 */
const Pick = ({ on, onClick, children, testid, pressed = false }) => (
  <button type="button" className="pressBtn" data-testid={testid} onClick={onClick}
    {...(pressed ? { "aria-pressed": on } : { role: "radio", "aria-checked": on })} style={S.chip(on)}>{children}</button>
);

/** A labelled text field. @param {{label: string, children: any}} p */
const Field = ({ label, children }) => (
  <label style={{ display: "grid", gap: T.space.xs }}>
    <span style={S.label()}>{label}</span>
    {children}
  </label>
);

/** The page every practice screen sits in: a bar with the way back, the label, the body. */
function PracticePage({ title, sub, onBack, backLabel = "Back", saved = null, children }) {
  const h = useRef(null);
  useEffect(() => { h.current?.focus({ preventScroll: true }); }, [title]);
  return (
    <div style={S.page()} data-testid="practice-page">
      <header style={S.bar()}>
        <button type="button" onClick={onBack} className="pressBtn" data-testid="practice-back"
          style={{ ...S.secondary(), display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
          <Icon name="chevron-left"/>{backLabel}
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 ref={h} tabIndex={-1} style={{ margin: 0, fontFamily: T.type.body, fontSize: "18px", fontWeight: 700, lineHeight: 1.25, outline: "none" }}>{title}</h1>
          {sub && <div style={{ fontFamily: T.type.body, fontSize: "13px", color: T.content.secondary }}>{sub}</div>}
        </div>
      </header>
      <main style={S.main()}>
        <PracticeLabel saved={saved}/>
        {children}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  The setup
// ═══════════════════════════════════════════════════════════════════

const STEP_TITLES = ["The match", "The teams", "First squad", "Second squad", "The toss", "Openers and bowler"];

const hasContent = (d) =>
  d.step > 0 || !!d.venue?.name || d.venue?.lat != null || !!d.weather?.condition
  || d.teams.some((t) => t.school.trim() || t.division || t.cls) || d.squads.some((s) => s.length > 0);

/** The XI in a new order, back into the squad: the XI's slots filled in the order given, everyone else where they were. */
function withXiOrder(players, order) {
  const xi = new Set(lineUp(players).xi);
  const byName = new Map(players.map((p) => [p.name, p]));
  let k = 0;
  return players.map((p) => (xi.has(p.name) && !p.twelfth ? byName.get(order[k++]) ?? p : p));
}

/**
 * @param {{onStart: (cfg: any, record: any) => void, onCancel: () => void}} props
 *   `onStart` is the scorer's: it opens the pad on `cfg` and keeps `record`.
 */
export function PracticeSetup({ onStart, onCancel }) {
  const [draft, setDraft] = useState(blankDraft);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState(false);
  const [geo, setGeo] = useState({ status: "idle" });
  const [hint, setHint] = useState(null);
  const [paste, setPaste] = useState(["", ""]);
  const started = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // The draft is the setup so far, kept after every change so a closed tab or
  // a dead battery loses nothing. A blank one is not kept.
  useEffect(() => {
    let off = false;
    loadDraft().then((d) => { if (off) return; if (d) { setDraft({ ...blankDraft(), ...d }); setPicked(hasContent(d)); } setReady(true); });
    return () => { off = true; };
  }, []);
  useEffect(() => {
    if (!ready || started.current) return;
    if (hasContent(draft)) saveDraft(draft); else clearDraft();
  }, [draft, ready]);

  const up = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setTeam = (i, patch) => setDraft((d) => ({ ...d, teams: d.teams.map((t, k) => (k === i ? { ...t, ...patch } : t)) }));
  const setSquad = (i, players) => setDraft((d) => ({ ...d, squads: d.squads.map((s, k) => (k === i ? players : s)) }));
  const step = Math.min(Math.max(draft.step | 0, 0), STEP_TITLES.length - 1);
  const go = (n) => up({ step: n });

  const names = draft.teams.map(practiceTeamName);
  const lat = draft.venue?.lat, lon = draft.venue?.lon;
  useEffect(() => {
    let off = false;
    if (typeof lat !== "number" || typeof lon !== "number") { setHint(null); return undefined; }
    Promise.resolve().then(() => getWeatherHint(lat, lon)).then((h) => { if (!off) setHint(h ?? null); }).catch(() => { if (!off) setHint(null); });
    return () => { off = true; };
  }, [lat, lon]);

  const findMe = async () => {
    if (geo.status === "finding") return;
    setGeo({ status: "finding" });
    const r = await locate();
    if (!mounted.current) return;
    if (r.status === "ok") setDraft((d) => ({ ...d, venue: { ...d.venue, lat: r.lat, lon: r.lon, accuracy_m: r.accuracy_m } }));
    setGeo(r);
  };
  const GEO_WORDS = {
    finding: "Finding this phone's position…",
    ok: `Position kept on this phone${geo.accuracy_m ? ` (about ${geo.accuracy_m} m)` : ""}. Type the ground's name if you want one on the card.`,
    denied: "This page may not use the phone's location. Type the venue instead.",
    slow: "The position is taking too long. Type the venue instead, or try again.",
    unavailable: "The phone could not find its position. Type the venue instead, or try again.",
    unsupported: "This phone cannot give its position here. Type the venue instead.",
  };

  const overs = oversOf(draft.overs);
  const teamsOk = teamProblems(draft.teams[0]).length === 0 && teamProblems(draft.teams[1]).length === 0 && !sameTeam(draft.teams[0], draft.teams[1]);
  const teamsWhy = teamProblems(draft.teams[0]).length ? `First team: ${teamProblems(draft.teams[0])[0]}`
    : teamProblems(draft.teams[1]).length ? `Second team: ${teamProblems(draft.teams[1])[0]}`
    : sameTeam(draft.teams[0], draft.teams[1]) ? "The two teams have the same name. Change the school, the age division or the class of one." : null;
  const v0 = validateSquad(draft.squads[0]);
  const v1 = validateSquad(draft.squads[1]);
  const shared = sharedNames(draft.squads[0], draft.squads[1]);

  const first = draft.bat === 0 ? draft.toss : 1 - draft.toss;
  const confirmOpeners = (opener1, opener2, openBowler) => {
    if (started.current) return;
    started.current = true;
    const id = newPracticeId();
    onStart(practiceCfg(draft, { id, opener1, opener2, openBowler }), practiceRecord(draft, id));
  };

  const addFrom = (i) => {
    const r = parseSquadText(paste[i]);
    if (!r.names.length) return;
    setSquad(i, addNames(draft.squads[i], r.names));
    setPaste((p) => p.map((t, k) => (k === i ? "" : t)));
  };
  const typed = (i) => parseSquadText(paste[i]);

  if (!ready) return <PracticePage title="Practice Match" onBack={onCancel}><p style={S.body()}>Opening…</p></PracticePage>;

  return (
    <PracticePage title="Practice Match" sub={`Step ${step + 1} of ${STEP_TITLES.length} · ${STEP_TITLES[step]}`}
      onBack={step === 0 ? onCancel : () => go(step - 1)}>
      {step === 0 && picked && (
        <div style={S.card()} data-testid="practice-draft-note">
          <p style={S.body()}>Picked up where you left off. Nothing was sent anywhere.</p>
          <button type="button" className="pressBtn" style={S.secondary()} data-testid="practice-draft-discard"
            onClick={() => { setDraft(blankDraft()); setPaste(["", ""]); setPicked(false); clearDraft(); }}>Start again, clear it</button>
        </div>
      )}

      {step === 0 && (
        <>
          <section style={S.card()} aria-labelledby="pm-overs">
            <h2 id="pm-overs" style={S.h2()}>Overs per innings</h2>
            <div role="radiogroup" aria-labelledby="pm-overs" style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm }}>
              {OVERS_PRESETS.map((n) => (
                <Pick key={n} testid={`practice-overs-${n}`} on={!draft.oversCustom && draft.overs === n}
                  onClick={() => up({ oversCustom: false, overs: n, oversText: String(n) })}>{n}</Pick>
              ))}
              <Pick testid="practice-overs-custom" on={!!draft.oversCustom} onClick={() => up({ oversCustom: true, overs: oversOf(draft.oversText) })}>Custom</Pick>
            </div>
            {draft.oversCustom && (
              <Field label="Overs per innings">
                <input value={draft.oversText} inputMode="numeric" autoComplete="off" data-testid="practice-overs-input"
                  aria-label="Overs per innings" aria-invalid={overs == null}
                  onChange={(e) => up({ oversText: e.target.value, overs: oversOf(e.target.value) })} style={S.field()}/>
                {overs == null && <span role="alert" style={{ ...S.body(), color: T.semantic.criticalText }}>{`A whole number from 1 to ${MAX_OVERS}.`}</span>}
              </Field>
            )}
          </section>

          <section style={S.card()} aria-labelledby="pm-venue">
            <h2 id="pm-venue" style={S.h2()}>Where</h2>
            <button type="button" className="pressBtn" data-testid="practice-locate" onClick={findMe} disabled={geo.status === "finding"}
              style={{ ...S.secondary(), display: "inline-flex", alignItems: "center", justifyContent: "center", gap: T.space.sm, width: "100%" }}>
              <Icon name="map-pin"/>{lat != null ? "Use my location again" : "Use my location"}
            </button>
            {GEO_WORDS[geo.status] && <p role="status" data-testid="practice-geo" style={S.note(geo.status === "ok" || geo.status === "finding" ? "ok" : "bad")}>{GEO_WORDS[geo.status]}</p>}
            <Field label="Venue name">
              <input value={draft.venue.name} onChange={(e) => up({ venue: { ...draft.venue, name: e.target.value.slice(0, 80) } })}
                data-testid="practice-venue" autoComplete="off" aria-label="Venue name" placeholder="The ground, if you want it on the card" style={S.field()}/>
            </Field>
          </section>

          <section style={S.card()} aria-labelledby="pm-weather">
            <h2 id="pm-weather" style={S.h2()}>Weather now</h2>
            <p style={S.body()}>What you can see, if you want it recorded. Tap again to clear.</p>
            <div role="group" aria-labelledby="pm-weather" style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm }}>
              {WEATHER_CONDITIONS.map((c) => (
                <Pick key={c.id} pressed testid={`practice-weather-${c.id}`} on={draft.weather.condition === c.id}
                  onClick={() => up({ weather: { ...draft.weather, condition: draft.weather.condition === c.id ? null : c.id } })}>{c.label}</Pick>
              ))}
            </div>
            <div role="group" aria-label="Playable or not" style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm }}>
              <Pick pressed testid="practice-playable" on={draft.weather.playable !== false} onClick={() => up({ weather: { ...draft.weather, playable: true } })}>Playable</Pick>
              <Pick pressed testid="practice-not-playable" on={draft.weather.playable === false} onClick={() => up({ weather: { ...draft.weather, playable: false } })}>Not playable</Pick>
            </div>
            {hint && <p data-testid="practice-weather-hint" style={S.note("ok")}>{`${hint.condition ?? "Hint"}${hint.temp_c != null ? `, ${hint.temp_c}°C` : ""} · ${hint.attribution}`}</p>}
          </section>

          <section style={S.card()}>
            <CaptureProfilePicker value={draft.captureProfile} onChange={(captureProfile) => up({ captureProfile })}/>
          </section>

          <button type="button" className="pressBtn" style={S.primary(overs != null)} disabled={overs == null} data-testid="practice-next" onClick={() => go(1)}>Next: the teams</button>
        </>
      )}

      {step === 1 && (
        <>
          {[0, 1].map((i) => (
            <section key={i} style={S.card()} aria-labelledby={`pm-team-${i}`}>
              <h2 id={`pm-team-${i}`} style={S.h2()}>{i === 0 ? "First team" : "Second team"}</h2>
              <Field label="School">
                <input value={draft.teams[i].school} onChange={(e) => setTeam(i, { school: e.target.value.slice(0, 60) })}
                  data-testid={`practice-school-${i}`} autoComplete="off" aria-label={`${i === 0 ? "First" : "Second"} team school`} placeholder="School" style={S.field()}/>
              </Field>
              <Field label="Age division">
                <select value={draft.teams[i].division} onChange={(e) => setTeam(i, { division: e.target.value })}
                  data-testid={`practice-division-${i}`} aria-label={`${i === 0 ? "First" : "Second"} team age division`} style={S.field()}>
                  <option value="">Choose&hellip;</option>
                  {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <div role="radiogroup" aria-label={`${i === 0 ? "First" : "Second"} team class`} style={{ display: "grid", gap: T.space.xs }}>
                <span style={S.label()}>Class</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm }}>
                  {CLASSES.map((c) => (
                    <Pick key={c} testid={`practice-class-${i}-${c.replace(/\s+/g, "")}`} on={draft.teams[i].cls === c} onClick={() => setTeam(i, { cls: c })}>{c}</Pick>
                  ))}
                </div>
              </div>
              <p data-testid={`practice-teamname-${i}`} style={{ ...S.body(), color: T.content.primary }}>
                Shown as <strong>{practiceTeamName(draft.teams[i]) || "—"}</strong>
              </p>
            </section>
          ))}
          {teamsWhy && <p role="status" style={S.note("bad")}>{teamsWhy}</p>}
          <button type="button" className="pressBtn" style={S.primary(teamsOk)} disabled={!teamsOk} data-testid="practice-next" onClick={() => go(2)}>Next: the first squad</button>
        </>
      )}

      {(step === 2 || step === 3) && (() => {
        const i = step - 2;
        const players = draft.squads[i];
        const v = i === 0 ? v0 : v1;
        const typedNow = typed(i);
        let xi = 0, shownDivider = false;
        const crossBad = i === 1 && shared.length > 0;
        const canGo = v.ok && !crossBad;
        return (
          <>
            <section style={S.card()} aria-labelledby={`pm-squad-${i}`}>
              <h2 id={`pm-squad-${i}`} style={S.h2()}>{names[i]}</h2>
              <p style={S.body()}>
                {`Type a name, or paste a list, one name to a line. Numbers, bullets, commas and blank lines are cleaned up. ${MIN_SQUAD} to ${MAX_SQUAD} names.`}
              </p>
              <textarea value={paste[i]} onChange={(e) => setPaste((p) => p.map((t, k) => (k === i ? e.target.value : t)))}
                data-testid={`practice-paste-${i}`} aria-label={`Paste or type names for ${names[i]}`} rows={4} spellCheck={false} autoComplete="off"
                placeholder={"1. First name\n2. Second name"} style={S.area()}/>
              <Row>
                <button type="button" className="pressBtn" style={S.secondary()} disabled={!typedNow.names.length} data-testid={`practice-add-${i}`} onClick={() => addFrom(i)}>
                  {typedNow.names.length > 1 ? `Add ${typedNow.names.length} names` : "Add name"}
                </button>
                {typedNow.names.length > 0 && <span role="status" style={S.body()}>{typedNow.names.length === 1 ? "1 name found" : `${typedNow.names.length} names found`}</span>}
              </Row>
            </section>

            <section style={S.card()} aria-labelledby={`pm-list-${i}`}>
              <h2 id={`pm-list-${i}`} style={S.h2()} data-testid={`practice-count-${i}`}>{`${players.length} of ${MAX_SQUAD} names`}</h2>
              {players.length === 0 && <p style={S.body()}>No names yet.</p>}
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.xs }} data-testid={`practice-squad-${i}`}>
                {players.map((p, k) => {
                  const inXi = !p.twelfth && xi < 11;
                  if (inXi) xi += 1;
                  const reserve = !p.twelfth && !inXi;
                  const divider = reserve && !shownDivider;
                  if (divider) shownDivider = true;
                  const dup = isRepeated(v, p.name);
                  const tag = p.twelfth ? "12th" : inXi ? String(xi) : "R";
                  return [
                    divider && <li key={`d${k}`} style={{ ...S.body(), padding: `${T.space.sm} 0 0`, fontSize: "13px" }}>Reserves, not in the XI. Move a name up to bring it in.</li>,
                    <li key={`${k}:${p.name}`} data-testid="practice-squad-row" style={{
                      display: "flex", flexWrap: "wrap", alignItems: "center", gap: T.space.xs, padding: `${T.space.xs} ${T.space.xs} ${T.space.xs} ${T.space.md}`,
                      borderRadius: T.radius.md, background: T.surface.interactive, border: `1px solid ${dup ? T.semantic.critical : T.line.normal}`,
                    }}>
                      <span aria-hidden="true" style={{ ...T.role.figure.sm, width: "36px", color: T.content.secondary, flexShrink: 0 }}>{tag}</span>
                      <span style={{ flex: "1 1 120px", minWidth: 0, overflowWrap: "anywhere", fontFamily: T.type.body, fontSize: "15px", fontWeight: 600 }}>
                        {p.name}
                        {p.twelfth && <span style={{ ...S.body(), fontWeight: 400 }}>{" (12th man)"}</span>}
                        {dup && <span style={{ ...S.body(), color: T.semantic.criticalText, fontWeight: 400 }}>{" (name repeated)"}</span>}
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", marginLeft: "auto" }}>
                        <button type="button" className="pressBtn" style={S.icon()} disabled={k === 0} aria-label={`Move ${p.name} up`} onClick={() => setSquad(i, moveAt(players, k, -1))}>
                          <Icon name="chevron-down" size={20} style={{ transform: "rotate(180deg)" }}/>
                        </button>
                        <button type="button" className="pressBtn" style={S.icon()} disabled={k === players.length - 1} aria-label={`Move ${p.name} down`} onClick={() => setSquad(i, moveAt(players, k, 1))}>
                          <Icon name="chevron-down" size={20}/>
                        </button>
                        <button type="button" className="pressBtn" aria-pressed={p.twelfth} aria-label={`${p.name} is the 12th man`} onClick={() => setSquad(i, toggleTwelfth(players, k))}
                          style={{ ...S.chip(p.twelfth), minWidth: "56px", borderRadius: T.radius.md }}>12th</button>
                        <button type="button" className="pressBtn" style={S.icon()} aria-label={`Remove ${p.name}`} onClick={() => setSquad(i, removeAt(players, k))}>
                          <Icon name="trash-2" size={20}/>
                        </button>
                      </span>
                    </li>,
                  ];
                })}
              </ul>
              {(v.problems.length > 0 || crossBad) && (
                <div role="status" data-testid={`practice-problems-${i}`} style={{ display: "grid", gap: T.space.xs }}>
                  {v.problems.map((x) => <p key={x.code} style={S.note("bad")}>{x.text}</p>)}
                  {crossBad && <p style={S.note("bad")}>{`${shared.join(", ")} ${shared.length === 1 ? "is" : "are"} on both sides. Players are told apart by name, so change one (add an initial).`}</p>}
                </div>
              )}
              {v.problems.some((x) => x.code === "duplicate") && (
                <button type="button" className="pressBtn" style={S.secondary()} data-testid={`practice-dedupe-${i}`} onClick={() => setSquad(i, withoutDuplicates(players))}>Remove the repeated names</button>
              )}
            </section>

            <button type="button" className="pressBtn" style={S.primary(canGo)} disabled={!canGo} data-testid="practice-next" onClick={() => go(step + 1)}>
              {step === 2 ? "Next: the second squad" : "Next: the toss"}
            </button>
          </>
        );
      })()}

      {step === 4 && (
        <section style={S.card()} aria-label="The toss">
          <TossStep team1Key={names[0]} team2Key={names[1]} overs={overs ?? draft.overs}
            toss={draft.toss} setToss={(toss) => up({ toss })} bat={draft.bat} setBat={(bat) => up({ bat })} onConfirm={() => go(5)}/>
        </section>
      )}

      {step === 5 && (
        <section style={S.card()} aria-label="Openers and opening bowler">
          <OpeningSetupStep key={first}
            batKey={names[first]} bowlKey={names[1 - first]}
            batOrder={lineUp(draft.squads[first]).xi} setBatOrder={(order) => setSquad(first, withXiOrder(draft.squads[first], order))}
            bowlingSquad={lineUp(draft.squads[1 - first]).xi} bowlingTeamKey={names[1 - first]}
            startAt={1} onConfirm={confirmOpeners}/>
        </section>
      )}
    </PracticePage>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  The list
// ═══════════════════════════════════════════════════════════════════

const scoreLine = (l) => `${l.team} ${l.runs}/${l.wickets} (${Math.floor(l.balls / 6)}.${l.balls % 6} ov)`;

/**
 * Every practice match on this phone. Deleting is two taps on the page itself
 * (a question and a button, not the browser's confirm()); it removes the names,
 * the teams, the weather and every ball, and says so when it has.
 * @param {{onBack: () => void, onResume: (id: string) => void}} props
 */
export function PracticeList({ onBack, onResume }) {
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  const [ask, setAsk] = useState(/** @type {string | null} */ (null));   // an id, or "all"
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef(null);

  const refresh = async () => { setRows(await listPractice()); };
  useEffect(() => { let off = false; listPractice().then((r) => { if (!off) setRows(r); }); return () => { off = true; }; }, []);
  useEffect(() => { if (ask) confirmRef.current?.focus(); }, [ask]);

  const removeOne = async (id) => {
    setBusy(true);
    const clean = await deletePractice(id);
    setAsk(null); setBusy(false);
    setSaid(clean ? "Deleted. Nothing of that match is left on this phone." : "Deleted, but something could not be removed. Try again.");
    await refresh();
  };
  const removeAll = async () => {
    setBusy(true);
    const r = await deleteAllPractice();
    setAsk(null); setBusy(false);
    setSaid(r.left === 0 ? "Deleted. No practice match, name or weather record is left on this phone." : "Some of it could not be removed. Try again.");
    await refresh();
  };
  const save = async (id) => {
    const [meta, log] = await Promise.all([loadPractice(id), loadMatch(id)]);
    if (!meta && !log) return;
    saveTextFile(scorecardText(meta, log?.events), scorecardFileName(meta));
    setSaid("The scorecard was handed to your browser to save. It has the names in it.");
  };

  return (
    <PracticePage title="Practice Matches" onBack={onBack} backLabel="Back">
      <p style={S.body()}>Matches you scored to try things out. They are kept on this phone only, and are in no fixture list, table or statistic.</p>
      {said && <p role="status" data-testid="practice-said" style={S.note("ok")}>{said}</p>}
      {rows == null && <p style={S.body()}>Looking…</p>}
      {rows && rows.length === 0 && <p data-testid="practice-empty" style={S.card()}>No practice matches on this phone.</p>}
      {rows && rows.map((r) => (
        <section key={r.id} data-testid="practice-row" style={S.card()} aria-label={r.title}>
          <h2 style={S.h2()}>{r.title}</h2>
          <p style={S.body()}>
            {r.lines.length ? r.lines.map(scoreLine).join(" · ") : "Nothing scored yet"}
          </p>
          <p style={S.body()}>
            {r.complete ? "Finished" : "In progress"}{r.venue ? ` · ${r.venue}` : ""}
            {" · "}<span data-testid="practice-row-saved">last saved {savedWords(r.savedAt)}</span>
          </p>
          {ask === r.id ? (
            <div role="group" aria-label="Confirm delete" data-testid="practice-confirm" style={{ ...S.note("bad"), display: "grid", gap: T.space.sm }}>
              <p style={{ ...S.body(), color: T.content.primary }}>Delete this match? Its names, teams, weather and every ball are removed from this phone. This cannot be undone.</p>
              <Row>
                <button ref={confirmRef} type="button" className="pressBtn" style={S.dangerSolid()} disabled={busy} data-testid="practice-confirm-delete" onClick={() => removeOne(r.id)}>Delete this match</button>
                <button type="button" className="pressBtn" style={S.secondary()} onClick={() => setAsk(null)}>Keep it</button>
              </Row>
            </div>
          ) : (
            <Row>
              <button type="button" className="pressBtn" style={{ ...S.secondary(), background: T.content.primary, color: T.surface.base, border: "none" }}
                data-testid="practice-resume-row" onClick={() => onResume(r.id)}>{r.complete ? "Open" : "Resume"}</button>
              <button type="button" className="pressBtn" style={S.secondary()} data-testid="practice-export" onClick={() => save(r.id)}>Save scorecard</button>
              <button type="button" className="pressBtn" style={S.danger()} data-testid="practice-delete" onClick={() => { setSaid(""); setAsk(r.id); }}>Delete</button>
            </Row>
          )}
        </section>
      ))}
      {rows && rows.length > 0 && (
        <section style={S.card()} aria-label="Delete all practice matches">
          {ask === "all" ? (
            <div role="group" aria-label="Confirm delete all" data-testid="practice-confirm-all" style={{ display: "grid", gap: T.space.sm }}>
              <p style={{ ...S.body(), color: T.content.primary }}>
                {`Delete all ${rows.length} practice ${rows.length === 1 ? "match" : "matches"}? Every name, team, weather record and ball is removed from this phone. This cannot be undone.`}
              </p>
              <Row>
                <button ref={confirmRef} type="button" className="pressBtn" style={S.dangerSolid()} disabled={busy} data-testid="practice-confirm-delete-all" onClick={removeAll}>Delete all practice matches</button>
                <button type="button" className="pressBtn" style={S.secondary()} onClick={() => setAsk(null)}>Keep them</button>
              </Row>
            </div>
          ) : (
            <button type="button" className="pressBtn" style={S.danger()} data-testid="practice-delete-all" onClick={() => { setSaid(""); setAsk("all"); }}>Delete all practice matches</button>
          )}
        </section>
      )}
    </PracticePage>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  The weather, mid-match
// ═══════════════════════════════════════════════════════════════════

/**
 * The scorer's own look at the sky, with the over and ball it was seen at. A
 * "weather change" is a line in the practice record (lib/practice.js
 * weatherChange); it never touches the ball log.
 * @param {{record: any, innings: number, balls: number, position: {lat: number, lon: number} | null,
 *          onSave: (change: any) => void, onClose: () => void}} props
 */
export function PracticeWeatherSheet({ record, innings, balls, position, onSave, onClose }) {
  const [condition, setCondition] = useState(/** @type {string | null} */ (null));
  const [playable, setPlayable] = useState(/** @type {boolean | null} */ (null));
  const [note, setNote] = useState("");
  const [hint, setHint] = useState(null);
  const lat = position?.lat, lon = position?.lon;
  useEffect(() => {
    let off = false;
    if (typeof lat !== "number" || typeof lon !== "number") return undefined;
    Promise.resolve().then(() => getWeatherHint(lat, lon)).then((h) => { if (!off) setHint(h ?? null); }).catch(() => {});
    return () => { off = true; };
  }, [lat, lon]);
  const changes = record?.weather_changes ?? [];
  const start = record?.match_weather;
  const can = condition != null || playable != null || note.trim() !== "";
  const at = `${Math.floor(balls / 6)}.${balls % 6}`;
  return (
    <Sheet title="Weather" onClose={onClose}>
      <div style={{ display: "grid", gap: T.space.md, paddingTop: T.space.sm }} data-testid="practice-weather-sheet">
        <PracticeLabel compact/>
        <p style={S.body()}>{`What has it become? It is recorded at ${at} overs of innings ${innings + 1}. Your own look at the sky is the record.`}</p>
        <div role="group" aria-label="Weather" style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm }}>
          {WEATHER_CONDITIONS.map((c) => (
            <Pick pressed key={c.id} testid={`pw-${c.id}`} on={condition === c.id} onClick={() => setCondition(condition === c.id ? null : c.id)}>{c.label}</Pick>
          ))}
        </div>
        <div role="group" aria-label="Playable or not" style={{ display: "flex", flexWrap: "wrap", gap: T.space.sm }}>
          <Pick pressed testid="pw-playable" on={playable === true} onClick={() => setPlayable(playable === true ? null : true)}>Playable</Pick>
          <Pick pressed testid="pw-not-playable" on={playable === false} onClick={() => setPlayable(playable === false ? null : false)}>Not playable</Pick>
        </div>
        <Field label="A note, if you want one">
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} data-testid="pw-note" aria-label="Weather note" autoComplete="off"
            placeholder="Rain stopped play" style={S.field()}/>
        </Field>
        {hint && <p data-testid="practice-weather-hint" style={S.note("ok")}>{`${hint.condition ?? "Hint"} · ${hint.attribution}`}</p>}
        <button type="button" className="pressBtn" style={S.primary(can)} disabled={!can} data-testid="pw-save"
          onClick={() => onSave(weatherChange({ condition, playable, innings, balls, note }))}>Record this weather change</button>
        {(start || changes.length > 0) && (
          <div data-testid="pw-history" style={{ display: "grid", gap: T.space.xs }}>
            <h3 style={S.label()}>So far</h3>
            {start && <p style={S.body()}>{`At the start: ${WEATHER_CONDITIONS.find((c) => c.id === start.condition)?.label ?? start.condition}${start.playable === false ? ", not playable" : ""}`}</p>}
            {changes.map((c) => <p key={c.id} style={S.body()}>{weatherChangeWords(c)}</p>)}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** What the engine adds to the record when a weather change is saved. */
export function withWeatherChange(record, change) {
  const start = record.match_weather ?? (change.condition ? weatherRecord({ condition: change.condition, playable: change.playable }) : null);
  return { ...record, match_weather: start, weather_changes: [...(record.weather_changes ?? []), change] };
}
