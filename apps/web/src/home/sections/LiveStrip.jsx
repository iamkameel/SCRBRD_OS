import { T } from "../../design/tokens.js";
import { Section, homeBody, homeHead, oversText, timeOfDay } from "./shared.jsx";

/**
 * "Live now" and "Today": the fixtures of the schools that list (SCRBRD-142
 * §2, §6.1). Pure: it is given the read's answer and fetches nothing.
 *
 * Props
 *   data  the answer of GET /api/public/live (§2.2), or nothing:
 *           { asOf: "2026-10-03",
 *             fixtures: [{ id,
 *               home: { label, code }, away: { label, code, onPlatform },
 *               status,            // scheduled | live | complete | abandoned
 *               format, overs,
 *               startsAt,          // ISO; the card shows the time of day only
 *               scores: [{ innings, runs, wickets, balls, side? }],
 *               result }]          // publicResult()'s text, or null
 *           }
 *         null or undefined (not yet answered, or the read answered 404 as it
 *         does when the public pages are off): the strip renders NOTHING, and
 *         so does anything without a fixtures array. An empty `fixtures` is a
 *         real answer: one quiet line, "No matches listed today".
 *         `side` ("home" | "away") on a score is OPTIONAL. §2.2's score has
 *         only the innings number, so the card cannot say which team made it;
 *         with `side` the score sits beside that team's name, without it each
 *         innings is a line of its own ("1st innings 142/3 (18.2)").
 *   show  "live" (only the live cards, above the hero), "today" (the rest, or
 *         the quiet line, below it) or "all" (default, in one section).
 *   nofollow  rel on every card's link. Default "nofollow" (§1.5 item 2).
 *
 * What a card never shows (§2.3): a child's name, a photograph, the ground,
 * officials, weather, the toss, a reason, a date of birth. It has no such
 * field to show; the whole card is a link to /live/:id (a finished one to
 * /scorecard/:id).
 */

const known = (s) => s === "live" || s === "complete" || s === "abandoned" || s === "scheduled";

/** Live first, then by start; a status the page does not know is left out. */
export function arrange(fixtures) {
  const rank = { live: 0, scheduled: 1, complete: 2, abandoned: 2 };
  return fixtures.filter((f) => f && typeof f.id === "string" && known(f.status))
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank[a.f.status] - rank[b.f.status] || String(a.f.startsAt ?? "").localeCompare(String(b.f.startsAt ?? "")) || a.i - b.i)
    .map((x) => x.f);
}

const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
const figure = (s) => `${s.runs ?? 0}/${s.wickets ?? 0}`;
const nameOf = (side) => [side?.label, side?.code].filter(Boolean).join(" ").trim() || "Opponent";

function Card({ f, rel }) {
  const live = f.status === "live", done = f.status === "complete", abandoned = f.status === "abandoned";
  const scores = Array.isArray(f.scores) ? f.scores : [];
  const bySide = scores.length > 0 && scores.every((s) => s.side === "home" || s.side === "away");
  const current = scores.length ? scores[scores.length - 1] : null;
  const start = timeOfDay(f.startsAt);
  const href = `/${done || abandoned ? "scorecard" : "live"}/${encodeURIComponent(f.id)}`;
  const tag = live ? "LIVE" : done ? "RESULT" : abandoned ? "ABANDONED" : start;
  const sideLine = (side, key) => {
    const own = bySide ? scores.filter((s) => s.side === key) : [];
    return (
      <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.md, alignItems: "baseline" }}>
        <span style={{ ...homeHead(), fontSize: "15px", fontWeight: 700, color: T.content.primary, lineHeight: 1.3 }}>{nameOf(side)}</span>
        <span style={{ fontFamily: T.type.mono, fontSize: "15px", color: T.content.primary, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {bySide ? (own.length ? own.map((s) => `${figure(s)}${live || done ? ` (${oversText(s.balls)})` : ""}`).join(" & ") : "—") : ""}
        </span>
      </div>
    );
  };
  const meta = [f.overs ? `${f.overs} overs` : f.format, (live || done || abandoned) && start ? `started ${start}` : ""].filter(Boolean).join(" · ");
  return (
    <a href={href} rel={rel} data-testid="home-card" data-status={f.status}
      style={{ display: "block", textDecoration: "none", borderRadius: T.radius.lg, border: `1px solid ${live ? T.brand.green : T.line.subtle}`, background: T.fill.panel, padding: T.space.lg, minHeight: "44px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: T.space.sm }}>
        <span style={{ fontFamily: T.type.mono, fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", color: live ? T.brand.green : T.content.tertiary }}>
          {live && <span aria-hidden="true">● </span>}{tag}
        </span>
        {live && current && <span style={{ fontFamily: T.type.mono, fontSize: "12px", color: T.content.tertiary }}>{oversText(current.balls)} ov</span>}
      </div>
      <div style={{ display: "grid", gap: T.space.xs }}>
        {sideLine(f.home, "home")}
        {sideLine(f.away, "away")}
      </div>
      {!bySide && scores.length > 0 && (
        <ul style={{ listStyle: "none", margin: `${T.space.sm} 0 0`, padding: 0, ...homeBody(), fontFamily: T.type.mono, fontSize: "13px", color: T.content.secondary }}>
          {scores.map((s) => <li key={s.innings}>{ordinal(s.innings)} innings {figure(s)} ({oversText(s.balls)})</li>)}
        </ul>
      )}
      {done && f.result && <div style={{ ...homeBody(), fontSize: "14px", color: T.content.secondary, marginTop: T.space.sm }}>{f.result}</div>}
      {meta && <div style={{ ...homeBody(), fontSize: "13px", color: T.content.tertiary, marginTop: T.space.sm }}>{meta}</div>}
    </a>
  );
}

function Cards({ list, rel }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,300px),1fr))", gap: T.space.md }}>{list.map((f) => <Card key={f.id} f={f} rel={rel} />)}</div>;
}

export function LiveStrip({ data, show = "all", nofollow = "nofollow" }) {
  if (!data || !Array.isArray(data.fixtures)) return null;
  const all = arrange(data.fixtures);
  const live = all.filter((f) => f.status === "live");
  const rest = all.filter((f) => f.status !== "live");
  const quiet = all.length === 0;
  // The hero's "Follow a match" (#matches) lands on the first section this strip draws.
  const parts = [];
  if ((show === "all" || show === "live") && live.length) {
    parts.push(<Section key="live" id="matches" label="Live now"><Cards list={live} rel={nofollow} /></Section>);
  }
  if (show === "all" || show === "today") {
    const id = parts.length || (show === "today" && live.length) ? "today" : "matches";
    if (quiet) {
      parts.push(<Section key="none" id={id} label="Today" narrow>
        <p data-testid="home-no-matches" style={{ ...homeBody(), fontSize: "16px", color: T.content.secondary }}>No matches listed today</p>
      </Section>);
    } else if (rest.length) {
      parts.push(<Section key="today" id={id} label="Today"><Cards list={rest} rel={nofollow} /></Section>);
    }
  }
  return parts.length ? <>{parts}</> : null;
}
