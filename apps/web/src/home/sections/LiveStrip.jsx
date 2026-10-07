import { T } from "../../design/tokens.js";
import { homeBody, homeHead, oversOfBalls, timeOfDay } from "./shared.jsx";

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
 * THE LOOK. Drawn as the ground's scoreboard (T.board: black in both themes,
 * painted-white figures, lime for a figure that just changed), because on a
 * match day this is the heart of the page. A figure that changes between two
 * reads turns over (GLOBAL_CSS's boardFlip, keyed on the figure); a live card
 * shows the over in progress as six balls, from `balls`, decoratively. With
 * reduced motion the figure is simply replaced.
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

// The board's own colours: fixed, as the board is (tokens.js `board`).
const LIVE = "#34e58a";
const mono = () => ({ fontFamily: T.type.mono, fontVariantNumeric: "tabular-nums" });

/** A figure on the board: it turns over when it changes. */
const Fig = ({ v, size = "20px", color = T.board.figure }) => (
  <span key={v} className="os-board-flip" style={{ ...mono(), fontSize: size, fontWeight: 500, color, whiteSpace: "nowrap" }}>{v}</span>
);

/** The over in progress, as six balls: decorative, the overs figure says it in words. */
function Over({ balls }) {
  const b = Number.isFinite(balls) ? Math.max(0, Math.trunc(balls)) % 6 : 0;
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", gap: "5px", alignItems: "center" }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <i key={i} style={{ width: "9px", height: "9px", borderRadius: "50%", boxSizing: "border-box", display: "block",
          background: i < b ? T.board.lime : "transparent", border: `1.5px solid ${i < b ? T.board.lime : "rgba(255,255,255,0.28)"}` }} />
      ))}
    </span>
  );
}

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
        <span style={{ ...homeHead(), fontSize: "15px", fontWeight: 700, color: T.board.figure, lineHeight: 1.3 }}>{nameOf(side)}</span>
        <span style={{ textAlign: "right" }}>
          {bySide ? (own.length ? own.map((s, i) => <span key={s.innings}>{i ? <span style={{ color: T.board.dim }}> & </span> : null}<Fig v={figure(s)} />{live || done ? <span style={{ ...mono(), fontSize: "13px", color: T.board.dim }}>{` (${oversOfBalls(s.balls)})`}</span> : null}</span>) : <Fig v="—" color={T.board.dim} />) : ""}
        </span>
      </div>
    );
  };
  const meta = [f.overs ? `${f.overs} overs` : f.format, (live || done || abandoned) && start ? `started ${start}` : ""].filter(Boolean).join(" · ");
  return (
    <a href={href} rel={rel} data-testid="home-card" data-status={f.status} className="hb-card"
      style={{ display: "block", textDecoration: "none", borderRadius: T.radius.lg, border: `1px solid ${live ? "rgba(52,229,138,0.55)" : T.board.rule}`,
        background: "#121713", padding: T.space.lg, minHeight: "44px", boxSizing: "border-box",
        boxShadow: live ? "0 0 0 1px rgba(52,229,138,0.15), 0 10px 30px rgba(52,229,138,0.08)" : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: T.space.sm, marginBottom: T.space.md }}>
        <span style={{ ...mono(), fontSize: "12px", fontWeight: 500, letterSpacing: "0.12em", color: live ? LIVE : T.board.dim, display: "inline-flex", alignItems: "center", gap: "8px" }}>
          {live && <span aria-hidden="true" className="live-dot" style={{ background: LIVE }} />}{tag}
        </span>
        {live && current && <span style={{ display: "inline-flex", alignItems: "center", gap: T.space.sm }}><Over balls={current.balls} /><span style={{ ...mono(), fontSize: "12px", color: T.board.dim }}>{oversOfBalls(current.balls)} ov</span></span>}
      </div>
      <div style={{ display: "grid", gap: T.space.sm }}>
        {sideLine(f.home, "home")}
        <div aria-hidden="true" style={{ height: "1px", background: T.board.rule }} />
        {sideLine(f.away, "away")}
      </div>
      {!bySide && scores.length > 0 && (
        <ul style={{ listStyle: "none", margin: `${T.space.md} 0 0`, padding: 0, ...homeBody(), ...mono(), fontSize: "14px", color: T.board.figure, display: "grid", gap: "4px" }}>
          {scores.map((s) => <li key={s.innings}><span style={{ color: T.board.dim }}>{ordinal(s.innings)} innings</span> <Fig v={figure(s)} size="14px" /> <span style={{ color: T.board.dim }}>({oversOfBalls(s.balls)})</span></li>)}
        </ul>
      )}
      {done && f.result && <div style={{ ...homeBody(), fontSize: "14px", color: T.board.lime, marginTop: T.space.md }}>{f.result}</div>}
      {meta && <div style={{ ...homeBody(), fontSize: "13px", color: T.board.dim, marginTop: T.space.sm }}>{meta}</div>}
    </a>
  );
}

function Cards({ list, rel }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,300px),1fr))", gap: T.space.md }}>{list.map((f) => <Card key={f.id} f={f} rel={rel} />)}</div>;
}

/** The board a part of the strip is drawn on: a section, its heading on the board's face. */
function Board({ id, label, live, asOf, children }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="rv"
      style={{ padding: `${T.space.xl} ${T.space.lg}`, maxWidth: "1120px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ background: T.board.face, borderRadius: T.radius.xxl, padding: `${T.space.xl} ${T.space.lg}`, border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md, marginBottom: T.space.lg, flexWrap: "wrap" }}>
          <h2 id={`${id}-h`} style={{ ...homeHead(), fontSize: "14px", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: T.board.figure,
            display: "inline-flex", alignItems: "center", gap: "10px" }}>
            {live && <span aria-hidden="true" className="live-dot" style={{ background: LIVE, width: "8px", height: "8px" }} />}{label}
          </h2>
          {asOf && <span style={{ ...mono(), fontSize: "12px", color: T.board.dim, letterSpacing: "0.08em" }}>{asOf}</span>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Blank flaps, for a board with nothing on it yet. Decorative. */
const Blank = () => (
  <span aria-hidden="true" style={{ display: "inline-flex", gap: "6px", marginBottom: T.space.md }}>
    {[0, 1, 2, 3, 4].map((i) => (
      <i key={i} style={{ width: "26px", height: "36px", borderRadius: "5px", background: "#1b211c", display: "block",
        backgroundImage: "linear-gradient(transparent 48%, #050605 48%, #050605 52%, transparent 52%)" }} />
    ))}
  </span>
);

const dayOf = (asOf) => {
  try {
    if (!asOf) return "";
    return new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Johannesburg" }).format(new Date(`${asOf}T12:00:00+02:00`));
  } catch { return ""; }
};

export function LiveStrip({ data, show = "all", nofollow = "nofollow" }) {
  if (!data || !Array.isArray(data.fixtures)) return null;
  const all = arrange(data.fixtures);
  const live = all.filter((f) => f.status === "live");
  const rest = all.filter((f) => f.status !== "live");
  const quiet = all.length === 0;
  const day = dayOf(data.asOf);
  // The hero's "Follow a match" (#matches) lands on the first section this strip draws.
  const parts = [];
  if ((show === "all" || show === "live") && live.length) {
    parts.push(<Board key="live" id="matches" label="Live now" live asOf={day}><Cards list={live} rel={nofollow} /></Board>);
  }
  if (show === "all" || show === "today") {
    const id = parts.length || (show === "today" && live.length) ? "today" : "matches";
    if (quiet) {
      parts.push(<Board key="none" id={id} label="Today" asOf={day}>
        <Blank />
        <p data-testid="home-no-matches" style={{ ...homeBody(), fontSize: "17px", color: T.board.figure }}>No matches listed today</p>
        <p style={{ ...homeBody(), fontSize: "14px", color: T.board.dim, marginTop: T.space.xs, lineHeight: 1.5 }}>A school's listed fixtures show here on match day, with the score as it is scored.</p>
      </Board>);
    } else if (rest.length) {
      parts.push(<Board key="today" id={id} label="Today" asOf={live.length ? "" : day}><Cards list={rest} rel={nofollow} /></Board>);
    }
  }
  return parts.length ? <>{parts}</> : null;
}
