import { createContext, useContext, useId, useState } from "react";
import { T, inkOn } from "../design/tokens.js";
import {
  END_REASONS, HOW_OUT, blankBatter, blankBowler, blankWicket, cellWords, cleanName, countOf, differenceOf, footnoteWords,
  getPath, isTypedRef, otherSide, oversOf, rowPaths,
} from "../lib/scorebook.js";

/**
 * The scorebook card, typed and read (SCRBRD-120 §1.2, §6.3).
 *
 * WHAT THIS DECIDES: nothing. The arithmetic is @scrbrd/scoring's
 * summaryRefusal(), the same function the server runs, and its refusals are
 * drawn under the cell they name. Who may confirm, what is refused at the
 * commit and that two people sign are the API's.
 *
 * NOTHING IS ZERO-FILLED (D12). A new row is all blanks; a blank number box
 * is null, and the tick beside it is the person saying "the book has none".
 * Editing a cell ticks it. Our boys are chosen from the roster; the
 * opposition's names are typed and become `t:<n>` keys on the import, never
 * a player.
 *
 * Type is 12px at the smallest and every control is 44px tall; every colour
 * is read from `T` when a component renders, so both themes are right.
 */

export function styles() {
  const btn = { minHeight: "44px", padding: "10px 16px", borderRadius: T.radius.pill, cursor: "pointer", boxSizing: "border-box",
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
    small: { ...btn, fontSize: "13px", padding: "8px 12px" },
    alert: { fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.4, color: T.semantic.criticalText, margin: `${T.space.xs} 0 0` },
    wrap: { display: "flex", flexWrap: "wrap", gap: T.space.sm, alignItems: "center" },
    grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: T.space.md, alignItems: "start" },
    row: { border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: T.space.md, margin: 0, minWidth: 0,
           display: "flex", flexDirection: "column", gap: T.space.md, background: T.surface.base },
    legend: { fontFamily: T.type.body, fontSize: "14px", fontWeight: 600, color: T.content.primary, padding: `0 ${T.space.xs}` },
    tick: { display: "inline-flex", alignItems: "center", gap: "4px", minHeight: "44px", minWidth: "44px", padding: "0 4px", cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
            fontFamily: T.type.body, fontSize: "12px", color: T.content.secondary, boxSizing: "border-box" },
    panel: { display: "flex", flexDirection: "column", gap: T.space.sm, padding: T.space.md, borderRadius: T.radius.md,
             background: T.surface.base, border: `1px solid ${T.line.strong}` },
  };
}

// ── The editor's context: one card, its ticks and its refusals ───────────

const Editor = createContext(/** @type {any} */ (null));
const useEditor = () => useContext(Editor);

/** Our players by team: the fixture's own team first, then the rest of the school. @param {any[]} players @param {string[]} first */
export function rosterGroups(players, first) {
  const teams = [...new Set(players.map((p) => p.team ?? ""))].sort((a, b) => {
    const ia = first.indexOf(a), ib = first.indexOf(b);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.localeCompare(b);
  });
  return teams.map((t) => ({ team: t, players: players.filter((p) => (p.team ?? "") === t).sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** A cell: its label, the control, the tick beside it and the refusals under it. */
function Field({ path, label, wide, children }) {
  const S = styles();
  const ed = useEditor();
  const id = useId();
  const key = `${ed.n}.${path}`;
  const errors = ed.refusals[path] ?? [];
  const on = ed.checked[key] === true;
  const missing = ed.attempted && !on;
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : undefined, minWidth: 0 }} data-testid={`sb-cell-${key}`}>
      <label htmlFor={id} style={S.label}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          {children({ id, "aria-invalid": errors.length ? true : undefined, "aria-describedby": errors.length ? `${id}-err` : undefined,
                      "data-testid": `sb-in-${key}` })}
        </div>
        <label style={S.tick}>
          <input type="checkbox" data-testid={`sb-tick-${key}`} checked={on} onChange={(e) => ed.setTick(path, e.target.checked)}
            aria-label={`Checked: ${cellWords(key, { withCard: true })}`} style={{ width: "20px", height: "20px", margin: 0, flexShrink: 0 }}/>
          <span aria-hidden="true">Checked</span>
        </label>
      </div>
      {errors.length > 0 && <p id={`${id}-err`} data-testid={`sb-err-${key}`} style={S.alert}>{errors.join(" ")}</p>}
      {missing && <p data-testid={`sb-missing-${key}`} style={{ ...S.alert, color: T.semantic.warning }}>Still to check</p>}
    </div>
  );
}

function NumField({ path, label, wide }) {
  const S = styles();
  const ed = useEditor();
  const v = getPath(ed.card, path);
  return (
    <Field path={path} label={label} wide={wide}>{(p) => (
      <input {...p} type="text" inputMode="numeric" autoComplete="off" value={v ?? ""} onChange={(e) => ed.setCell(path, countOf(e.target.value))} style={S.input}/>)}</Field>
  );
}

function OversField({ path, label }) {
  const S = styles();
  const ed = useEditor();
  const v = getPath(ed.card, path);
  return (
    <Field path={path} label={label}>{(p) => (
      <input {...p} type="text" inputMode="decimal" autoComplete="off" placeholder="17.3" value={v ?? ""} onChange={(e) => ed.setCell(path, oversOf(e.target.value))} style={S.input}/>)}</Field>
  );
}

function SelectField({ path, label, options, blank = "Choose…", wide }) {
  const S = styles();
  const ed = useEditor();
  const v = getPath(ed.card, path);
  return (
    <Field path={path} label={label} wide={wide}>{(p) => (
      <select {...p} value={v ?? ""} onChange={(e) => ed.setCell(path, e.target.value || null)} style={S.input}>
        <option value="">{blank}</option>
        {options.map(([val, words]) => <option key={val} value={val}>{words}</option>)}
      </select>)}</Field>
  );
}

/** Our player, from the roster. */
function RosterSelect({ p, value, onPick }) {
  const S = styles();
  const ed = useEditor();
  const known = value && ed.rosterMap.has(value);
  return (
    <select {...p} value={value ?? ""} onChange={(e) => onPick(e.target.value || null)} style={S.input}>
      <option value="">Choose from the roster…</option>
      {value && !known && <option value={value}>A player not on your roster</option>}
      {ed.groups.map((g) => (
        <optgroup key={g.team} label={g.team || "Other players"}>
          {g.players.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * The opposition's name, typed. It is kept when the box is left (the name is
 * one person: typing it again elsewhere finds him) and lives only in the
 * import's typed map: never a player.
 */
function TypedName({ p, path, value }) {
  const S = styles();
  const ed = useEditor();
  const [text, setText] = useState(ed.typed[value] ?? "");
  const listId = useId();
  const commit = () => { if (cleanName(text) !== (ed.typed[value] ?? "")) ed.setName(path, text, value); };
  return (
    <>
      <input {...p} type="text" autoComplete="off" list={listId} value={text} placeholder="Type the name"
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }} style={S.input}/>
      <datalist id={listId}>{Object.values(ed.typed).map((n) => <option key={n} value={n}/>)}</datalist>
    </>
  );
}

/** A name cell: a roster select for our side, a typed name for theirs. */
function NameField({ path, label, side, wide }) {
  const ed = useEditor();
  const v = getPath(ed.card, path);
  const ours = ed.ours(side);
  return (
    <Field path={path} label={label} wide={wide}>{(p) => ours
      ? <RosterSelect p={p} value={v} onPick={(id) => ed.setCell(path, id)}/>
      : <TypedName key={`${v}|${ed.typed[v] ?? ""}`} p={p} path={path} value={isTypedRef(v) ? v : null}/>}</Field>
  );
}

/** A cell that points at a name already on this card (a bowler, a batter). */
function PickField({ path, label, options, blank, wide }) {
  const S = styles();
  const ed = useEditor();
  const v = getPath(ed.card, path);
  return (
    <Field path={path} label={label} wide={wide}>{(p) => (
      <select {...p} value={v ?? ""} onChange={(e) => ed.setCell(path, e.target.value || null)} style={S.input}>
        <option value="">{blank}</option>
        {v && !options.some(([r]) => r === v) && <option value={v}>{ed.nameOf(v) || "Someone not on this card"}</option>}
        {options.map(([r, name]) => <option key={r} value={r}>{name}</option>)}
      </select>)}</Field>
  );
}

// ── The card ────────────────────────────────────────────────────────────

/** Row buttons: tick every cell of a row, and take the row away. */
function RowTools({ list, i, what, count }) {
  const S = styles();
  const ed = useEditor();
  const paths = rowPaths(ed.cards, ed.n, list, i);
  const all = paths.length > 0 && paths.every((p) => ed.checked[p] === true);
  return (
    <div style={S.wrap}>
      <button type="button" data-testid={`sb-tickrow-${ed.n}.${list}.${i}`} aria-pressed={all} onClick={() => ed.tickRow(list, i, !all)} style={S.small}>
        {all ? `Untick every cell of ${what}` : `Tick every cell of ${what}`}
      </button>
      <button type="button" data-testid={`sb-remove-${ed.n}.${list}.${i}`} onClick={() => ed.removeRow(list, i)} style={S.small}>
        Remove {what}
      </button>
      {count ? <span style={S.meta}>{count}</span> : null}
    </div>
  );
}

/** The card's arithmetic in one panel: the difference, and the footnote it may carry. */
function Reconcile() {
  const S = styles();
  const ed = useEditor();
  const c = ed.card;
  const d = differenceOf(c);
  const u = c.unreconciled;
  const show = d && (c.batting.length > 0 || u);
  if (!show) return null;
  const errs = [...(ed.refusals.unreconciled ?? []), ...(ed.refusals["unreconciled.runs"] ?? [])];
  return (
    <div style={S.panel} data-testid={`sb-reconcile-${ed.n}`}>
      <h4 style={S.h4}>Does the book add up?</h4>
      <p style={S.body} data-testid={`sb-sums-${ed.n}`}>
        Batters' runs {d.battingRuns} + extras {d.extras} = {d.battingRuns + d.extras}. The book's total is {c.total}.
        {d.difference === 0 ? " They agree." : ` They differ by ${Math.abs(d.difference)}.`}
      </p>
      {u == null && d.difference !== 0 && (
        <div style={S.wrap}>
          <p style={{ ...S.body, flex: "1 1 240px" }}>If the book itself is out, record the difference rather than change a figure to hide it. It stays on the record as a footnote, and the person who confirms must acknowledge it.</p>
          <button type="button" data-testid={`sb-record-diff-${ed.n}`} onClick={() => ed.setUnreconciled({ runs: d.difference, note: "" })} style={S.secondary}>
            Record the book's difference of {d.difference}
          </button>
        </div>
      )}
      {u != null && (
        <>
          <p style={{ ...S.body, color: T.content.primary, fontWeight: 600 }} data-testid={`sb-footnote-${ed.n}`}>{footnoteWords(u)}</p>
          <div>
            <label htmlFor={`sb-diffnote-${ed.n}`} style={S.label}>What the book shows (at least 3 characters)</label>
            <input id={`sb-diffnote-${ed.n}`} data-testid={`sb-diffnote-${ed.n}`} type="text" value={u.note ?? ""} maxLength={200}
              onChange={(e) => ed.setUnreconciled({ ...u, note: e.target.value })} style={S.input}/>
          </div>
          {d.difference !== u.runs && d.difference !== 0 && (
            <button type="button" onClick={() => ed.setUnreconciled({ ...u, runs: d.difference })} style={S.secondary}>Change the recorded difference to {d.difference}</button>
          )}
          <button type="button" data-testid={`sb-clear-diff-${ed.n}`} onClick={() => ed.setUnreconciled(null)} style={{ ...S.secondary, alignSelf: "flex-start" }}>
            Remove the recorded difference
          </button>
        </>
      )}
      {errs.length > 0 && <p data-testid={`sb-err-${ed.n}.unreconciled`} style={S.alert}>{errs.join(" ")}</p>}
    </div>
  );
}

/**
 * One innings' card, typed. `ctx` carries the card, its place in the import,
 * the ticks, the typed names, the roster, and the functions that change them
 * (the parent holds the state; see scorebook.jsx).
 */
export function CardEditor({ ctx }) {
  const S = styles();
  const c = ctx.card;
  const bat = c.battingSide;
  const field = otherSide(bat);
  const sideName = (/** @type {"home" | "away"} */ s) => ctx.sideNames[s];
  const bowlerOptions = c.bowling.filter((b) => b.ref).map((b) => [b.ref, ctx.nameOf(b.ref) || "A bowler"]);
  const batterOptions = c.batting.filter((b) => b.ref).map((b) => [b.ref, ctx.nameOf(b.ref) || "A batter"]);
  const sectionErrors = (/** @type {string} */ p) => ctx.refusals[p] ?? [];
  return (
    <Editor.Provider value={ctx}>
      <div style={{ display: "flex", flexDirection: "column", gap: T.space.lg }} data-testid={`sb-card-${ctx.n}`}>
        <div style={S.grid}>
          <SelectField path="battingSide" label="Batting side" options={[["home", sideName("home")], ["away", sideName("away")]]}/>
          <NumField path="total" label="Total runs"/>
          <NumField path="wickets" label="Wickets lost"/>
          <OversField path="overs" label="Overs bowled"/>
          <SelectField path="endReason" label="How the innings ended" options={END_REASONS}/>
        </div>

        <section aria-label="Extras" style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          <h4 style={S.h4}>Extras</h4>
          <div style={S.grid}>
            <NumField path="extras.byes" label="Byes"/>
            <NumField path="extras.legByes" label="Leg byes"/>
            <NumField path="extras.wides" label="Wides"/>
            <NumField path="extras.noBalls" label="No-balls"/>
            <NumField path="extras.penalty" label="Penalty runs"/>
          </div>
        </section>

        <section aria-label="Batting" style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          <h4 style={S.h4}>Batting: {sideName(bat)}</h4>
          {c.batting.map((b, i) => (
            <fieldset key={i} style={S.row} data-testid={`sb-batter-${ctx.n}.${i}`}>
              <legend style={S.legend}>Batter {i + 1}</legend>
              <div style={S.grid}>
                <NameField path={`batting.${i}.ref`} label={`Batter ${i + 1}, name`} side={bat} wide/>
                <SelectField path={`batting.${i}.howOut`} label={`Batter ${i + 1}, how out`} options={HOW_OUT} wide/>
                <NameField path={`batting.${i}.fielderRef`} label={`Batter ${i + 1}, fielder`} side={field}/>
                <PickField path={`batting.${i}.bowlerRef`} label={`Batter ${i + 1}, bowler`} options={bowlerOptions} blank="No bowler"/>
                <NumField path={`batting.${i}.runs`} label={`Batter ${i + 1}, runs`}/>
                <NumField path={`batting.${i}.balls`} label={`Batter ${i + 1}, balls`}/>
                <NumField path={`batting.${i}.fours`} label={`Batter ${i + 1}, fours`}/>
                <NumField path={`batting.${i}.sixes`} label={`Batter ${i + 1}, sixes`}/>
              </div>
              <RowTools list="batting" i={i} what={`batter ${i + 1}`}/>
            </fieldset>
          ))}
          <button type="button" data-testid={`sb-add-batter-${ctx.n}`} onClick={() => ctx.addRow("batting", blankBatter(c.batting.length + 1))}
            disabled={c.batting.length >= 15} style={{ ...S.secondary, alignSelf: "flex-start" }}>Add a batter</button>
        </section>

        <section aria-label="Did not bat" style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          <h4 style={S.h4}>Did not bat</h4>
          {c.didNotBat.map((_, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: T.space.sm }} data-testid={`sb-dnb-${ctx.n}.${i}`}>
              <div style={S.grid}><NameField path={`didNotBat.${i}`} label={`Did not bat, name ${i + 1}`} side={bat} wide/></div>
              <RowTools list="didNotBat" i={i} what={`name ${i + 1}`}/>
            </div>
          ))}
          <button type="button" data-testid={`sb-add-dnb-${ctx.n}`} onClick={() => ctx.addRow("didNotBat", null)} disabled={c.didNotBat.length >= 15}
            style={{ ...S.secondary, alignSelf: "flex-start" }}>Add a player who did not bat</button>
        </section>

        <section aria-label="Bowling" style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          <h4 style={S.h4}>Bowling: {sideName(field)}</h4>
          {sectionErrors("bowling").length > 0 && <p data-testid={`sb-err-${ctx.n}.bowling`} style={S.alert}>{sectionErrors("bowling").join(" ")}</p>}
          {c.bowling.map((_, i) => (
            <fieldset key={i} style={S.row} data-testid={`sb-bowler-${ctx.n}.${i}`}>
              <legend style={S.legend}>Bowler {i + 1}</legend>
              <div style={S.grid}>
                <NameField path={`bowling.${i}.ref`} label={`Bowler ${i + 1}, name`} side={field} wide/>
                <OversField path={`bowling.${i}.overs`} label={`Bowler ${i + 1}, overs`}/>
                <NumField path={`bowling.${i}.maidens`} label={`Bowler ${i + 1}, maidens`}/>
                <NumField path={`bowling.${i}.runs`} label={`Bowler ${i + 1}, runs`}/>
                <NumField path={`bowling.${i}.wickets`} label={`Bowler ${i + 1}, wickets`}/>
                <NumField path={`bowling.${i}.wides`} label={`Bowler ${i + 1}, wides`}/>
                <NumField path={`bowling.${i}.noBalls`} label={`Bowler ${i + 1}, no-balls`}/>
              </div>
              <RowTools list="bowling" i={i} what={`bowler ${i + 1}`}/>
            </fieldset>
          ))}
          <button type="button" data-testid={`sb-add-bowler-${ctx.n}`} onClick={() => ctx.addRow("bowling", blankBowler())} disabled={c.bowling.length >= 15}
            style={{ ...S.secondary, alignSelf: "flex-start" }}>Add a bowler</button>
        </section>

        <section aria-label="Fall of wickets" style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          <h4 style={S.h4}>Fall of wickets</h4>
          <p style={S.meta}>Leave this empty if the book has no fall of wickets.</p>
          {sectionErrors("fallOfWickets").length > 0 && <p data-testid={`sb-err-${ctx.n}.fallOfWickets`} style={S.alert}>{sectionErrors("fallOfWickets").join(" ")}</p>}
          {c.fallOfWickets.map((_, i) => (
            <fieldset key={i} style={S.row} data-testid={`sb-fow-${ctx.n}.${i}`}>
              <legend style={S.legend}>Wicket {i + 1}</legend>
              <div style={S.grid}>
                <NumField path={`fallOfWickets.${i}.wicket`} label={`Fall of wicket ${i + 1}, wicket number`}/>
                <NumField path={`fallOfWickets.${i}.score`} label={`Fall of wicket ${i + 1}, score`}/>
                <PickField path={`fallOfWickets.${i}.ref`} label={`Fall of wicket ${i + 1}, batter out`} options={batterOptions} blank="Not recorded"/>
                <OversField path={`fallOfWickets.${i}.over`} label={`Fall of wicket ${i + 1}, over`}/>
              </div>
              <RowTools list="fallOfWickets" i={i} what={`wicket ${i + 1}`}/>
            </fieldset>
          ))}
          <button type="button" data-testid={`sb-add-fow-${ctx.n}`} onClick={() => ctx.addRow("fallOfWickets", blankWicket(c.fallOfWickets.length + 1))}
            disabled={c.fallOfWickets.length >= 15} style={{ ...S.secondary, alignSelf: "flex-start" }}>Add a fall of wicket</button>
        </section>

        <Reconcile/>
      </div>
    </Editor.Provider>
  );
}

// ── The card, read ──────────────────────────────────────────────────────

const dash = <span aria-label="not recorded">–</span>;
const fig = (/** @type {unknown} */ v) => (v === null || v === undefined ? dash : String(v));

/**
 * One innings' card, read-only: what the confirmer checks against the pages,
 * and what anyone else who may see the import sees. Nothing is filled: a
 * figure the book does not give is a dash.
 */
export function CardReader({ card, n, nameOf, sideNames, refusals = [] }) {
  const S = styles();
  const th = { textAlign: "left", fontFamily: T.type.body, fontSize: "12px", fontWeight: 600, color: T.content.secondary, padding: "6px 8px", borderBottom: `1px solid ${T.line.normal}`, whiteSpace: "nowrap" };
  const thn = { ...th, textAlign: "right" };
  const td = { fontFamily: T.type.body, fontSize: "14px", color: T.content.primary, padding: "8px", borderBottom: `1px solid ${T.line.subtle}`, verticalAlign: "top" };
  const tdn = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  const how = (/** @type {any} */ b) => {
    const label = HOW_OUT.find(([k]) => k === b.howOut)?.[1] ?? b.howOut;
    const f = b.fielderRef ? nameOf(b.fielderRef) : "";
    const w = b.bowlerRef ? nameOf(b.bowlerRef) : "";
    return [label, f && `fielder ${f}`, w && `bowler ${w}`].filter(Boolean).join(", ");
  };
  const ending = END_REASONS.find(([k]) => k === card.endReason)?.[1] ?? null;
  const u = card.unreconciled;
  const wrap = { overflowX: "auto", maxWidth: "100%" };
  return (
    <section aria-label={`Innings ${n + 1}`} data-testid={`sb-read-${n}`} style={{ ...S.card, background: T.surface.base }}>
      <div>
        <h4 style={S.h3}>Innings {n + 1}: {sideNames[card.battingSide]}</h4>
        <p style={S.body} data-testid={`sb-read-total-${n}`}>
          {fig(card.total)} for {fig(card.wickets)} in {fig(card.overs)} overs{ending ? `. ${ending}.` : ""}
        </p>
      </div>
      {refusals.length > 0 && <ul data-testid={`sb-read-refusals-${n}`} style={{ ...S.alert, margin: 0, paddingLeft: "20px" }}>
        {refusals.map((r, i) => <li key={i}>{cellWords(r.path)}: {r.text}</li>)}</ul>}
      <div style={wrap}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "460px" }}>
          <caption style={{ ...S.label, display: "table-caption", captionSide: "top", textAlign: "left" }}>Batting</caption>
          <thead><tr><th scope="col" style={th}>Batter</th><th scope="col" style={th}>How out</th>
            <th scope="col" style={thn}>Runs</th><th scope="col" style={thn}>Balls</th><th scope="col" style={thn}>4s</th><th scope="col" style={thn}>6s</th></tr></thead>
          <tbody>{card.batting.map((b, i) => (
            <tr key={i}><th scope="row" style={{ ...td, textAlign: "left", fontWeight: 600 }}>{nameOf(b.ref) || "A player"}</th><td style={td}>{how(b)}</td>
              <td style={tdn}>{fig(b.runs)}</td><td style={tdn}>{fig(b.balls)}</td><td style={tdn}>{fig(b.fours)}</td><td style={tdn}>{fig(b.sixes)}</td></tr>))}</tbody>
        </table>
      </div>
      {card.didNotBat.length > 0 && <p style={S.body}>Did not bat: {card.didNotBat.map((r) => nameOf(r) || "A player").join(", ")}.</p>}
      <p style={S.body} data-testid={`sb-read-extras-${n}`}>
        Extras: byes {fig(card.extras.byes)}, leg byes {fig(card.extras.legByes)}, wides {fig(card.extras.wides)}, no-balls {fig(card.extras.noBalls)}, penalty {fig(card.extras.penalty)}.
      </p>
      <div style={wrap}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "460px" }}>
          <caption style={{ ...S.label, display: "table-caption", captionSide: "top", textAlign: "left" }}>Bowling</caption>
          <thead><tr><th scope="col" style={th}>Bowler</th><th scope="col" style={thn}>Overs</th><th scope="col" style={thn}>Maidens</th>
            <th scope="col" style={thn}>Runs</th><th scope="col" style={thn}>Wickets</th><th scope="col" style={thn}>Wides</th><th scope="col" style={thn}>No-balls</th></tr></thead>
          <tbody>{card.bowling.map((b, i) => (
            <tr key={i}><th scope="row" style={{ ...td, textAlign: "left", fontWeight: 600 }}>{nameOf(b.ref) || "A player"}</th>
              <td style={tdn}>{fig(b.overs)}</td><td style={tdn}>{fig(b.maidens)}</td><td style={tdn}>{fig(b.runs)}</td>
              <td style={tdn}>{fig(b.wickets)}</td><td style={tdn}>{fig(b.wides)}</td><td style={tdn}>{fig(b.noBalls)}</td></tr>))}</tbody>
        </table>
      </div>
      {card.fallOfWickets.length > 0 && (
        <p style={S.body} data-testid={`sb-read-fow-${n}`}>
          Fall of wickets: {card.fallOfWickets.map((w) => `${fig(w.score) === dash ? "?" : w.score}/${w.wicket}${w.ref ? ` (${nameOf(w.ref) || "a batter"})` : ""}${w.over ? ` at ${w.over}` : ""}`).join("; ")}.
        </p>
      )}
      {u != null && <p style={{ ...S.body, color: T.content.primary, fontWeight: 600 }} data-testid={`sb-read-footnote-${n}`}>
        {footnoteWords(u)}{u.note ? ` The book shows: ${u.note}` : ""}</p>}
    </section>
  );
}
