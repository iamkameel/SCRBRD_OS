import { useEffect, useMemo, useRef } from "react";
import { COMMENTARY_FILTER, commentaryCounts } from "@scrbrd/scoring";
import { T } from "../../design/tokens.js";
import { teamOf } from "../../lib/matchCentre.js";
import { superOverTitle } from "../../lib/superOver.js";

/**
 * CRI-2.1: the Commentary's chips and its over jump, above the lines. Their
 * own chunk, fetched the first time a Commentary is drawn: the public page's
 * static graph has a ceiling (tools/check-bundle.mjs), and the lines come
 * first. No import of the API client or the role model, so the public page
 * shares it.
 */

/**
 * The chips. Each keeps one kind of line, and only kinds the scorecard counts
 * (COMMENTARY_FILTER, @scrbrd/scoring/commentary): the count on a chip is the
 * card's — the innings' wickets, the batters' 4s and 6s.
 */
const CHIPS = [
  [COMMENTARY_FILTER.ALL, "All", null],
  [COMMENTARY_FILTER.WICKETS, "Wickets", "wickets"],
  [COMMENTARY_FILTER.FOURS, "Fours", "fours"],
  [COMMENTARY_FILTER.SIXES, "Sixes", "sixes"],
];

/** An over's heading, as its group and the jump both say it. */
const overTitle = (inn, over) => (inn?.superOver != null ? "The over" : `Over ${over + 1}`);

/** The chips: a group of toggles, one pressed, each 44px tall. */
function Chips({ chip, setChip, commentary }) {
  const counts = useMemo(() => commentaryCounts(commentary ?? []), [commentary]);
  return (
    <div role="group" aria-label="Show" data-testid="mc-chips" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
      {CHIPS.map(([id, label, count]) => {
        const on = id === chip;
        const n = count ? counts[count] : null;
        return (
          <button key={id} type="button" aria-pressed={on} onClick={() => setChip(id)} data-testid={`mc-chip-${id}`}
            {...(n != null ? { "data-count": n, "aria-label": `${label}, ${n}` } : {})} className="pressBtn os-state"
            // 48px each way: a 44px minimum laid out in a wrapping row measured a hair under it (browser-narrow).
            style={{ minHeight: "48px", minWidth: "48px", padding: `0 ${T.space.md}`, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: T.space.xs, cursor: "pointer",
              borderRadius: T.radius.pill, border: `1px solid ${on ? T.content.primary : T.line.normal}`,
              background: on ? T.content.primary : "transparent", color: on ? T.surface.canvas : T.content.primary,
              fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
            {label}
            {n != null && <span aria-hidden="true" style={{ fontFamily: T.type.mono, fontWeight: 500, color: on ? T.surface.canvas : T.content.secondary }}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The over jump: every over the chips leave, in the match's order, under its
 * innings. A native select, so a phone draws its own picker and a keyboard
 * and a screen reader have it; it reads "An over…" again after each jump.
 */
function OverJump({ match, innings, groups, onJump }) {
  if (groups.length < 2) return null;
  const byInnings = [];
  for (const g of [...groups].reverse()) {
    let b = byInnings[byInnings.length - 1];
    if (!b || b.innings !== g.innings) { b = { innings: g.innings, overs: [] }; byInnings.push(b); }
    b.overs.push(g);
  }
  const sideOf = (n) => {
    const inn = innings[n];
    if (!inn) return `Innings ${n + 1}`;
    return `${inn.superOver != null ? `${superOverTitle(inn.superOver)} · ` : ""}${teamOf(match, inn.battingTeam).full} innings`;
  };
  return (
    <label style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
      <span style={{ ...T.role.label, color: T.content.secondary }}>Jump to</span>
      <select data-testid="mc-over-jump" value="" onChange={(e) => { if (e.target.value) onJump(e.target.value); }}
        style={{ minHeight: "48px", minWidth: 0, maxWidth: "100%", flex: "1 1 160px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md,
          // A field's edge: the tertiary ink every input's border uses, 3:1 in both themes (WCAG 1.4.11).
          border: `1px solid ${T.content.tertiary}`, background: T.surface.raised, color: T.content.primary,
          // 16px: a phone does not zoom the page into a field of that size.
          fontFamily: T.type.body, fontSize: "16px", boxSizing: "border-box", cursor: "pointer" }}>
        <option value="">An over…</option>
        {byInnings.map((b) => (
          <optgroup key={b.innings} label={sideOf(b.innings)}>
            {b.overs.map((g) => <option key={g.key} value={g.key}>{overTitle(innings[g.innings], g.over)}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

const BALL_KINDS = new Set(["ball", "four", "six", "wicket"]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * CRI-2.3: what a chart's bar or area opened the Commentary on — its balls,
 * and the awards in its runs — and the way to every ball. The focus comes
 * here when it opens, so a screen reader hears what is listed.
 */
function Drill({ drill, lines, onAll }) {
  const head = useRef(/** @type {HTMLParagraphElement | null} */ (null));
  useEffect(() => {
    head.current?.scrollIntoView({ block: "start", behavior: "instant" });
    head.current?.focus({ preventScroll: true });
  }, []);
  const balls = lines.filter((c) => BALL_KINDS.has(c.kind)).length;
  const other = lines.length - balls;
  const what = drill.what ? `${drill.what[0].toUpperCase()}${drill.what.slice(1)}` : "From the chart";
  return (
    <div data-testid="mc-drill" data-lines={lines.length} style={{ display: "flex", gap: T.space.sm, alignItems: "center", flexWrap: "wrap",
      padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md, border: `1px solid ${T.line.normal}`, background: T.surface.interactive }}>
      <p ref={head} tabIndex={-1} data-testid="mc-drill-what" style={{ ...T.role.body, color: T.content.primary, margin: 0, flex: "1 1 200px", scrollMarginTop: T.space.lg }}>
        <strong>{what}</strong>{` · ${plural(drill.runs, "run")} · ${plural(balls, "ball")}${other ? ` and ${plural(other, "award")}` : ""}, listed below`}
      </p>
      <button type="button" data-testid="mc-drill-all" onClick={onAll} className="pressBtn os-state"
        style={{ minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.pill, cursor: "pointer", background: "transparent",
          border: `1px solid ${T.line.normal}`, color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
        Every ball
      </button>
    </div>
  );
}

const NONE_FOR = { wickets: "No wicket has fallen yet.", fours: "No four has been hit yet.", sixes: "No six has been hit yet." };

/**
 * The chips, then the jump; a chart's balls first, where it opened the tab
 * (`drill`, CRI-2.3), with no chip pressed while they are. `jump`: the over
 * the jump asked for, which this puts at the top of the screen, the focus on
 * its heading, once the tab (`at`, the Commentary's section) has drawn it.
 */
export default function CommentaryTools({ chip, setChip, commentary, match, innings, groups, onJump, jump = null, at = null, drill = null, onAll }) {
  useEffect(() => {
    if (!jump) return;
    const el = [...(at?.current?.querySelectorAll("[data-over-key]") ?? [])].find((x) => x.getAttribute("data-over-key") === jump.key);
    const head = el?.querySelector("[data-testid='mc-over-title']");
    if (!(head instanceof HTMLElement)) return;
    head.scrollIntoView({ block: "start", behavior: "instant" });
    head.focus({ preventScroll: true });
  }, [jump, at]);
  return (
    <div data-testid="mc-commentary-tools" style={{ display: "grid", gap: T.space.sm, marginBottom: T.space.md }}>
      {drill && <Drill drill={drill} lines={groups.flatMap((g) => g.lines)} onAll={onAll}/>}
      <Chips chip={drill ? null : chip} setChip={setChip} commentary={commentary}/>
      <OverJump match={match} innings={innings} groups={groups} onJump={onJump}/>
      {!groups.length && (
        <p data-testid="mc-commentary-filtered-none" style={{ ...T.role.body, color: T.content.secondary, padding: `${T.space.xl} 0`, margin: 0 }}>
          {NONE_FOR[chip] ?? "Nothing to show."}
        </p>
      )}
    </div>
  );
}
