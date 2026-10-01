import { useState } from "react";
import { T } from "../../design/tokens.js";
import { didNotBat, dismissalKey, extrasOf, fowLines, keepersOfSide, oversOf, runCounts, teamOf } from "../../lib/matchCentre.js";
import { Icon } from "../../ui/icons.jsx";
import { SideName, Quiet } from "./bits.jsx";
import { isSuperOver, superOverTitle, superOversOf } from "../../lib/superOver.js";

/**
 * THE SCORECARD (DESIGN_DIRECTION §10 item 7, the prototype's p7–p9): an
 * innings toggle; each batter's dismissal on a second line under the name;
 * the not-out batters shaded; "Did not bat"; the extras broken out as NB ·
 * WD · B · LB · PEN; a total bar; the bowling; the fall of wickets as
 * "43/3 · R Rickelton · 5.5". Every figure is the fold's.
 *
 * A batter's row opens (p8, item 8), for a signed-in reader: his 1s, 2s, 3s,
 * 4s and 6s, his wagon wheel, and the commentary line of his dismissal.
 *
 * NOTHING SIGNED-IN IS IMPORTED HERE (SCRBRD-083). The signed-in Match
 * Centre passes what only it has — `opens` (the row opens), `profileOf`
 * (the reader's own profile of a player, by his roster read and role) and
 * `Wheel` (a batter's wagon wheel, which needs the placement the public log
 * never carries) — and the public page (src/public/) passes none of them.
 * So the public bundle can use this tab without pulling the role model, the
 * profile screens or the scorer's charts into its entry.
 */

/**
 * Which innings the tab shows: one button per side, as the prototype has it.
 * The match's own innings only — a super over (SCRBRD-114 phase 3b) sits in
 * its own block below them and is never mixed in.
 */
export function InningsToggle({ match, innings, inningsSel, setInningsSel }) {
  const shown = innings.map((inn, i) => [inn, i]).filter(([inn]) => inn && !isSuperOver(inn));
  if (shown.length < 2) return null;
  return (
    <div role="group" aria-label="Innings" data-testid="mc-innings-toggle"
      style={{ display: "flex", gap: T.space.xs, marginBottom: T.space.md, flexWrap: "wrap" }}>
      {shown.map(([inn, i]) => {
        const on = i === inningsSel;
        return (
          <button key={i} type="button" aria-pressed={on} onClick={() => setInningsSel(i)} data-testid={`mc-innings-${i}`}
            className="pressBtn os-state"
            style={{ flex: "1 1 0", minWidth: 0, minHeight: "44px", padding: `0 ${T.space.md}`, cursor: "pointer",
              borderRadius: T.radius.md, border: `1px solid ${on ? T.content.primary : T.line.normal}`,
              background: on ? T.content.primary : "transparent", color: on ? T.surface.canvas : T.content.secondary,
              fontFamily: T.type.body, fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <SideName side={teamOf(match, inn.battingTeam)}/> innings
          </button>
        );
      })}
    </div>
  );
}

const COLS = "minmax(0,1fr) 36px 32px 30px 28px 62px";
const BOWL_COLS = "minmax(0,1fr) 36px 28px 36px 28px 62px";

/** A header row: the label, and the figures' heads right-aligned. */
function HeadRow({ cols, heads, label, icon }) {
  return (
    <div role="row" style={{ display: "grid", gridTemplateColumns: cols, gap: T.space.xs, alignItems: "center",
      padding: `${T.space.sm} ${T.space.md}`, borderBottom: `1px solid ${T.line.normal}` }}>
      <span role="columnheader" style={{ ...T.role.label, color: T.content.secondary, display: "inline-flex", gap: T.space.xs, alignItems: "center" }}>
        {icon && <Icon name={icon}/>}{label}
      </span>
      {heads.map((h) => <span key={h} role="columnheader" style={{ ...T.role.label, color: T.content.secondary, textAlign: "right" }}>{h}</span>)}
    </div>
  );
}

/** Figures, right-aligned and tabular. */
function Figs({ values, strong = 0 }) {
  return values.map((v, i) => (
    <span key={i} role="cell" style={{ ...T.role.figure.sm, textAlign: "right", color: i === strong ? T.content.primary : T.content.secondary,
      fontWeight: i === strong ? 500 : 400 }}>{v ?? "–"}</span>
  ));
}

const sr = (r, b) => (b ? ((r / b) * 100).toFixed(2) : "—");
const econ = (r, b) => (b ? (r / (b / 6)).toFixed(2) : "—");

/** The line under a batter's name. */
function howOut(b) {
  if (b.status === "out") return b.dismissal ?? "out";
  if (b.status === "retired") return "retired, not out";
  return "not out";
}

/** The wicket-keeper's mark beside his name (SCRBRD-126), as a printed card has it. */
function KeeperMark() {
  return <span data-testid="mc-keeper-mark" aria-label="wicket-keeper" title="Wicket-keeper" style={{ color: T.content.secondary }}>†</span>;
}

/**
 * Family mode (step 4 G13): the reader's own child's row — or the pupil's own
 * — is lit, with a rule down its edge and a word beside the name, never a
 * colour alone (§3.7). Nothing about any other row changes.
 */
function FocusTag({ label }) {
  return (
    <span data-testid="mc-focus-tag" style={{ ...T.role.label, fontSize: "12px", color: T.content.primary, border: `1px solid ${T.line.strong}`,
      borderRadius: T.radius.pill, padding: "1px 8px", whiteSpace: "nowrap" }}>{label}</span>
  );
}
const focusEdge = (lit) => (lit ? { borderLeft: `4px solid ${T.brand.accentText}` } : {});

/** A batter's row, which opens for a signed-in reader. */
function BatterRow({ b, inn, open, onToggle, commentaryLine, profile, Wheel, kept = false, lit = false, litLabel = null }) {
  const notOut = b.status !== "out";
  const counts = open ? runCounts(inn, b.id) : null;
  const opens = !!onToggle;
  const nameCell = (
    <span style={{ minWidth: 0, width: "100%", display: "grid", gap: "2px", textAlign: "left" }}>
      <span style={{ ...T.role.body, fontSize: "15px", fontWeight: 600, color: T.content.primary, display: "flex", alignItems: "center", gap: T.space.xs, flexWrap: "wrap" }}>
        {b.name}{kept && <KeeperMark/>}{b.status === "batting" && <span aria-label="not out" style={{ color: T.content.secondary }}>*</span>}
        {lit && litLabel && <FocusTag label={litLabel}/>}
        {opens && <Icon name="chevron-down" style={{ marginLeft: "auto", color: T.content.tertiary, transform: open ? "rotate(180deg)" : "none" }}/>}
      </span>
      <span data-testid="mc-dismissal" style={{ fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.35, color: T.content.secondary }}>{howOut(b)}</span>
    </span>
  );
  return (
    <div role="rowgroup" data-testid="mc-bat-row" data-not-out={notOut ? "true" : undefined} data-focus={lit ? "true" : undefined}
      style={{ borderBottom: `1px solid ${T.line.subtle}`, background: notOut || lit ? T.surface.interactive : "transparent", ...focusEdge(lit) }}>
      <div role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: T.space.xs, alignItems: "center",
        padding: `${T.space.sm} ${T.space.md}`, minHeight: "44px" }}>
        {opens ? (
          <button type="button" onClick={onToggle} aria-expanded={open} data-testid="mc-bat-open" className="os-state"
            style={{ cursor: "pointer", minWidth: 0, minHeight: "44px", width: "100%", display: "flex", alignItems: "center", padding: 0,
              background: "transparent", border: "none", borderRadius: T.radius.sm, color: "inherit", font: "inherit", textAlign: "left" }}>
            {nameCell}
          </button>
        ) : <span role="rowheader">{nameCell}</span>}
        <Figs values={[b.runs, b.balls, b.fours, b.sixes, sr(b.runs, b.balls)]}/>
      </div>
      {open && (
        <div data-testid="mc-player-row" style={{ padding: `0 ${T.space.md} ${T.space.md}`, display: "grid", gap: T.space.md }}>
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }} data-testid="mc-run-counts">
            {["1", "2", "3", "4", "6"].map((k) => (
              <span key={k} style={{ display: "grid", justifyItems: "center", minWidth: "48px", padding: `${T.space.xs} ${T.space.sm}`,
                border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, background: T.surface.raised }}>
                <span style={{ ...T.role.figure.md, color: T.content.primary }}>{counts[k]}</span>
                <span style={{ ...T.role.label, color: T.content.secondary, textTransform: "none" }}>{k}s</span>
              </span>
            ))}
          </div>
          {Wheel && <Wheel inn={inn} playerId={b.id} title={`${b.name}: wagon wheel`}/>}
          {commentaryLine && (
            <p data-testid="mc-dismissal-line" style={{ ...T.role.body, color: T.content.primary, margin: 0,
              borderLeft: `3px solid ${T.line.strong}`, paddingLeft: T.space.md }}>
              {commentaryLine}
            </p>
          )}
          {profile && (
            <button type="button" onClick={profile} className="pressBtn os-state"
              style={{ justifySelf: "start", minHeight: "44px", padding: `0 ${T.space.lg}`, cursor: "pointer",
                background: "transparent", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill,
                color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 500 }}>
              Open profile
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One innings' card: its head, batting, extras, total, bowling and fall of
 * wickets. `idx` is its place in the match's list of innings (the log's
 * innings number): the scorecard of a match innings, or of a super over's.
 */
function InningsBody({ match, innings, idx, commentary, events, opens, profileOf, Wheel, focus, focusLabel }) {
  const [openId, setOpenId] = useState(null);
  const inningsSel = idx;
  const inn = innings[idx];
  const side = teamOf(match, inn.battingTeam);
  const ex = extrasOf(inn);
  const fow = fowLines(inn);
  const dnb = didNotBat(inn);
  // Who kept wicket for this side when it fielded, and in this innings (SCRBRD-126).
  const kept = keepersOfSide(innings, inningsSel);
  const keepers = inn.keepers ?? [];
  const innEvents = (events ?? []).filter((e) => (e.innings ?? 0) === inningsSel);
  const byKey = new Map((commentary ?? []).map((c) => [c.key, c]));
  return (
    <div>
      <div data-testid="mc-innings-head" data-from-scorebook={inn.summarised ? "true" : undefined} style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: T.space.md,
        padding: `${T.space.md} ${T.space.lg}`, background: T.board.face, color: T.board.figure, borderRadius: `${T.radius.lg} ${T.radius.lg} 0 0` }}>
        <span style={{ ...T.role.title.md, color: T.board.figure, minWidth: 0 }}>
          <SideName side={side}/>
          {/* SCRBRD-120: an innings known by its figures, typed from a paper scorebook
              and confirmed by a second person, has no deliveries to show. A label, no more. */}
          {inn.summarised && (
            <span data-testid="mc-from-scorebook" style={{ display: "block", fontFamily: T.type.body, fontSize: "13px", fontWeight: 400, color: T.board.dim }}>
              From the scorebook
            </span>
          )}
          {/* D4: a book whose batting figures differ from its total says so, in a footnote. */}
          {inn.summarised?.unreconciled && Number.isInteger(inn.summarised.unreconciled.runs) && (
            <span data-testid="mc-scorebook-footnote" style={{ display: "block", fontFamily: T.type.body, fontSize: "13px", fontWeight: 400, color: T.board.dim }}>
              The book's batting figures differ from its total by {Math.abs(inn.summarised.unreconciled.runs)}.
            </span>
          )}
        </span>
        <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <span style={{ ...T.role.figure.lg, color: T.board.figure }}>{inn.runs}/{inn.wickets}</span>
          <span style={{ display: "block", fontFamily: T.type.body, fontSize: "13px", color: T.board.dim }}>
            ({oversOf(inn.balls)} overs){inn.balls ? ` · CRR ${econ(inn.runs, inn.balls)}` : ""}
          </span>
        </span>
      </div>

      <div role="table" aria-label="Batting" style={{ border: `1px solid ${T.line.normal}`, borderTop: "none" }}>
        <HeadRow cols={COLS} label="Batting" icon="bat" heads={["R", "B", "4s", "6s", "SR"]}/>
        {inn.batsmen.map((b) => (
          <BatterRow key={b.id} b={b} inn={inn} open={openId === b.id}
            onToggle={opens ? () => setOpenId(openId === b.id ? null : b.id) : null}
            commentaryLine={b.status === "out" ? byKey.get(dismissalKey(inn, b.id, innEvents) ?? "")?.text ?? null : null}
            profile={profileOf(b.id)} Wheel={Wheel} kept={kept.has(b.id)} lit={!!focus?.has(b.id)} litLabel={focusLabel}/>
        ))}
        {dnb.map((p) => (
          <div key={p.id} role="row" data-testid="mc-dnb" style={{ display: "grid", gridTemplateColumns: COLS, gap: T.space.xs, alignItems: "center",
            padding: `${T.space.sm} ${T.space.md}`, minHeight: "44px", borderBottom: `1px solid ${T.line.subtle}` }}>
            <span role="rowheader" style={{ display: "grid", gap: "2px" }}>
              <span style={{ ...T.role.body, fontSize: "15px", fontWeight: 600, color: T.content.primary }}>{p.name}{kept.has(p.id) && <KeeperMark/>}</span>
              <span style={{ fontFamily: T.type.body, fontSize: "13px", color: T.content.secondary }}>Did not bat</span>
            </span>
            <Figs values={["–", "–", "–", "–", "–"]} strong={-1}/>
          </div>
        ))}
        <div data-testid="mc-extras" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: T.space.sm,
          padding: `${T.space.sm} ${T.space.md}`, background: T.surface.base, borderBottom: `1px solid ${T.line.normal}` }}>
          <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>Extras <span style={{ ...T.role.figure.sm }}>{ex.total ?? "–"}</span></span>
          <span style={{ ...T.role.figure.sm, color: T.content.secondary }}>
            {Object.entries(ex.parts).map(([k, v]) => `${k} ${v ?? "–"}`).join(" · ")}
          </span>
        </div>
        <div data-testid="mc-total" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.md,
          padding: `${T.space.md} ${T.space.md}`, background: T.surface.interactive }}>
          <span style={{ ...T.role.label, fontSize: "14px", color: T.content.primary }}>Total</span>
          <span style={{ whiteSpace: "nowrap" }}>
            <span style={{ fontFamily: T.type.body, fontSize: "14px", color: T.content.secondary, marginRight: T.space.sm }}>({oversOf(inn.balls)} overs)</span>
            <span style={{ ...T.role.figure.md, color: T.content.primary }}>{inn.runs}/{inn.wickets}</span>
          </span>
        </div>
      </div>

      {inn.bowlers.length > 0 && (
        <div role="table" aria-label="Bowling" data-testid="mc-bowling" style={{ border: `1px solid ${T.line.normal}`, marginTop: T.space.lg, borderRadius: T.radius.lg, overflow: "hidden" }}>
          <HeadRow cols={BOWL_COLS} label="Bowling" icon="ball" heads={["O", "M", "R", "W", "Econ"]}/>
          {inn.bowlers.map((bw) => (
            <div key={bw.id} role="row" data-focus={focus?.has(bw.id) ? "true" : undefined}
              style={{ display: "grid", gridTemplateColumns: BOWL_COLS, gap: T.space.xs, alignItems: "center",
              padding: `${T.space.sm} ${T.space.md}`, minHeight: "44px", borderBottom: `1px solid ${T.line.subtle}`,
              ...(focus?.has(bw.id) ? { background: T.surface.interactive, ...focusEdge(true) } : {}) }}>
              <span role="rowheader" style={{ ...T.role.body, fontSize: "15px", fontWeight: 600, color: T.content.primary, minWidth: 0,
                display: "flex", alignItems: "center", gap: T.space.xs, flexWrap: "wrap" }}>
                {bw.name}{focus?.has(bw.id) && focusLabel && <FocusTag label={focusLabel}/>}
              </span>
              <Figs values={[oversOf(bw.balls), bw.maidens, bw.runs, bw.wickets, econ(bw.runs, bw.balls)]} strong={3}/>
            </div>
          ))}
          {(inn.bowlerChanges ?? []).map((c, i) => {
            const nm = (id) => inn.bowlers.find((b) => b.id === id)?.name ?? "another bowler";
            return (
              <p key={i} style={{ fontFamily: T.type.body, fontSize: "13px", color: T.content.secondary, margin: 0, padding: `${T.space.xs} ${T.space.md}` }}>
                Over {c.over + 1}.{c.ballInOver}: {nm(c.to)} finished the over for {nm(c.from)}.
              </p>
            );
          })}
          {/* Who kept wicket in this innings (SCRBRD-126), in the order each took the gloves. */}
          {keepers.length > 0 && (
            <p data-testid="mc-keepers" style={{ fontFamily: T.type.body, fontSize: "13px", color: T.content.secondary, margin: 0, padding: `${T.space.xs} ${T.space.md}` }}>
              {keepers.length === 1 ? "Wicket-keeper" : "Wicket-keepers"}: {keepers.map((k, i) => (
                <span key={k.id}>{i > 0 && ", "}{k.name} <KeeperMark/></span>
              ))}
            </p>
          )}
        </div>
      )}

      {fow.length > 0 && (
        <div data-testid="mc-fow" style={{ marginTop: T.space.lg, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg, overflow: "hidden" }}>
          <div style={{ ...T.role.label, color: T.content.secondary, padding: `${T.space.sm} ${T.space.md}`, borderBottom: `1px solid ${T.line.normal}`,
            display: "flex", gap: T.space.xs, alignItems: "center" }}>
            <Icon name="bails-off"/>Fall of wickets
          </div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {fow.map((f, i) => (
              <li key={i} data-testid="mc-fow-line" style={{ ...T.role.figure.sm, color: T.content.primary, padding: `${T.space.sm} ${T.space.md}`,
                borderBottom: i < fow.length - 1 ? `1px solid ${T.line.subtle}` : "none" }}>{f}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** How a super over stands, in words: who won it, that it was level, or that it is not finished. */
function pairWords(match, p) {
  if (p.state === "won") return `${teamOf(match, p.winner.battingTeam).full} won`;
  if (p.state === "tied") return "Level";
  return p.innings.some((x) => x.endReason === "abandoned") ? "Not completed" : "In progress";
}

/**
 * A super over (SCRBRD-114 phase 3b, §4), below the match's innings and
 * never mixed into their figures: its two lines at a glance, who won it, and
 * the card of either innings of the pair.
 */
function SuperOverBlock({ pair, ...rest }) {
  const { match, innings } = rest;
  const [which, setWhich] = useState(0);
  const at = pair.at[Math.min(which, pair.at.length - 1)];
  return (
    <section data-testid={`mc-superover-${pair.n}`} aria-label={superOverTitle(pair.n)} style={{ marginTop: T.space.xl }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.md, flexWrap: "wrap",
        padding: `${T.space.md} ${T.space.lg}`, background: T.board.face, color: T.board.figure, borderRadius: `${T.radius.lg} ${T.radius.lg} 0 0` }}>
        <h3 data-testid="mc-superover-title" style={{ ...T.role.title.md, color: T.board.figure, margin: 0 }}>{superOverTitle(pair.n)}</h3>
        <span data-testid="mc-superover-state" style={{ fontFamily: T.type.body, fontSize: "14px", fontWeight: 600, color: T.board.figure }}>{pairWords(match, pair)}</span>
      </div>
      <div role="group" aria-label={`${superOverTitle(pair.n)}: innings`} style={{ display: "grid", gap: T.space.xs, padding: T.space.sm,
        border: `1px solid ${T.line.normal}`, borderTop: "none" }}>
        {pair.at.map((i, k) => {
          const x = innings[i];
          const on = k === which;
          return (
            <button key={i} type="button" aria-pressed={on} onClick={() => setWhich(k)} data-testid={`mc-superover-${pair.n}-innings-${k}`}
              className="pressBtn os-state"
              style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.md, minHeight: "44px",
                padding: `${T.space.xs} ${T.space.md}`, cursor: "pointer", borderRadius: T.radius.md, textAlign: "left",
                border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`, background: on ? T.surface.raised : "transparent",
                color: T.content.primary, fontFamily: T.type.body, fontSize: "15px", fontWeight: on ? 600 : 500 }}>
              <span style={{ minWidth: 0 }}><SideName side={teamOf(match, x.battingTeam)}/> · {k === 0 ? "bat first" : "chase"}</span>
              <span style={{ ...T.role.figure.sm, whiteSpace: "nowrap" }}>{x.runs}/{x.wickets} <span style={{ color: T.content.secondary }}>({oversOf(x.balls)})</span></span>
            </button>
          );
        })}
      </div>
      <InningsBody {...rest} idx={at} key={at}/>
    </section>
  );
}

export function ScorecardTab({ match, innings, commentary, events, inningsSel, setInningsSel, opens = false, profileOf = () => null, Wheel = null, focus = null, focusLabel = null }) {
  // The innings the toggle is on is one of the match's own, always: a super
  // over has its block below.
  const sel = innings[inningsSel] && !isSuperOver(innings[inningsSel]) ? inningsSel : Math.max(0, innings.findIndex((x) => x && !isSuperOver(x)));
  const inn = innings[sel];
  if (!inn) return <Quiet testid="mc-scorecard-empty">Nothing has been scored yet.</Quiet>;
  const body = { match, innings, commentary, events, opens, profileOf, Wheel, focus, focusLabel };
  return (
    <section data-testid="mc-scorecard" aria-label="Scorecard">
      <InningsToggle match={match} innings={innings} inningsSel={sel} setInningsSel={setInningsSel}/>
      <InningsBody {...body} idx={sel} key={sel}/>
      {superOversOf(innings).map((p) => <SuperOverBlock key={p.n} pair={p} {...body}/>)}
    </section>
  );
}
