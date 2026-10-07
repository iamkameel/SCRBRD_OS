/**
 * The pieces the family and pupil screens share (step 4 phase A).
 *
 * Calm, one child, phone first (DESIGN_DIRECTION §6): a card has a border,
 * not a tint; an eyebrow, a title, a line or two of body; nothing read under
 * 12px and nothing tapped under 44px (§3.2, §3.5); a state is a word, with a
 * mark beside it, never a colour alone (§3.7). Tokens are read at render.
 *
 * Every card here is handed the ONE child it is about and narrows the rows it
 * reads to that child, whatever else the reader's policy returned — a parent
 * who is also staff reads the whole side, and her child's screen still names
 * only her child (§3.1).
 */
import { useState } from "react";
import { T } from "../../design/tokens.js";
import { api } from "../../lib/api.js";
import { useLive, useWeather } from "../../lib/live.js";
import { observedStamp } from "../../lib/weatherStamp.js";
import { profile } from "../../lib/session.js";
import { humanDate, humanDateTime } from "../../lib/format.js";
import { holds } from "../../lib/family.js";
import { Icon } from "../../ui/icons.jsx";
import { ReadState } from "../../ui/primitives.jsx";
import { readState } from "../../lib/readState.js";

// ── Layout ─────────────────────────────────────────────

export function Page({ children, testid, label }) {
  return (
    <div className="os-page" data-testid={testid} aria-label={label}
      style={{ maxWidth: "720px", margin: "0 auto", display: "grid", gap: T.space.md, alignContent: "start" }}>
      {children}
    </div>
  );
}

/** A card: an eyebrow, then what it says. A border, not a tint (§3.7). */
export function Card({ label, children, testid, aside, tone }) {
  return (
    <section data-testid={testid} aria-label={typeof label === "string" ? label : undefined}
      style={{ background: T.surface.raised, border: `1px solid ${tone ?? T.line.normal}`, borderRadius: T.radius.lg,
        padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.sm }}>
      {(label || aside) && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap" }}>
          {label && <h2 style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>{label}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Title({ children, testid, as: As = "h1" }) {
  return <As data-testid={testid} style={{ ...T.role.title.md, color: T.content.primary, margin: 0 }}>{children}</As>;
}

export function Line({ children, testid, strong = false, quiet = false }) {
  return (
    <p data-testid={testid} style={{ ...T.role.body, margin: 0, fontWeight: strong ? 600 : 400,
      color: quiet ? T.content.secondary : T.content.primary }}>{children}</p>
  );
}

/** A control: 44 tall, a word on it. `primary` is the one thing the screen asks. */
export function Action({ children, onClick, testid, primary = false, disabled = false, label, pressed, type = "button", style }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} data-testid={testid} aria-label={label} aria-pressed={pressed}
      className="pressBtn os-state"
      style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: disabled ? "default" : "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: T.space.xs,
        background: primary ? T.content.primary : pressed ? T.surface.interactive : "transparent",
        color: primary ? T.surface.canvas : T.content.primary,
        border: `1px solid ${primary ? T.content.primary : pressed ? T.line.strong : T.line.normal}`,
        opacity: disabled ? 0.55 : 1, ...T.role.control, fontSize: "15px", ...style }}>
      {children}
    </button>
  );
}

/** A row that opens something: the whole row is the target. */
export function OpenRow({ onClick, testid, children, aside, label }) {
  return (
    <button type="button" onClick={onClick} data-testid={testid} aria-label={label} className="pressBtn os-state"
      style={{ width: "100%", minHeight: "48px", display: "flex", alignItems: "center", gap: T.space.md, textAlign: "left",
        padding: `${T.space.sm} ${T.space.md}`, background: "transparent", border: `1px solid ${T.line.subtle}`,
        borderRadius: T.radius.md, cursor: "pointer", color: T.content.primary }}>
      <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "2px" }}>{children}</span>
      {aside && <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary, whiteSpace: "nowrap" }}>{aside}</span>}
      <Icon name="chevron-down" style={{ transform: "rotate(-90deg)", color: T.content.tertiary, flexShrink: 0 }}/>
    </button>
  );
}

export function Back({ onClick, children = "Back", testid = "family-back" }) {
  return (
    <div>
      <Action onClick={onClick} testid={testid}><Icon name="chevron-left"/> {children}</Action>
    </div>
  );
}

/**
 * A "none" line, said only of a read that answered (GA-I08). A read that is
 * still coming, failed, or may not be read says that instead, with a Retry
 * where a second read could change the answer. `read` is what useLive()
 * returned; `onRetry` bumps the screen's own nonce, so the same read runs
 * again with the same params.
 */
export function NoneOr({ read, what, none, onRetry, testid }) {
  const said = readState(read, { what });
  if (said.state === "ok" || said.state === "empty") return <Line quiet testid={testid}>{none}</Line>;
  return <ReadState compact read={said} onRetry={onRetry} testId={testid ? `${testid}-read-state` : "read-state"}/>;
}

/** "Could not load …" is a different statement from "nothing", and says so. */
export function Unread({ what }) {
  return <Line quiet>Could not load {what} just now. This is not the same as there being none.</Line>;
}

// ── The child switcher (§3.1) ──────────────────────────

/**
 * One chip per child, the current one lit, hidden with one child. Visible,
 * not a drop-down: a parent glancing at a bus time must see whose it is.
 */
export function ChildSwitcher({ kids, chosen, onChoose }) {
  if (!kids || kids.length < 2) return null;
  return (
    <div role="group" aria-label="Which child" data-testid="child-switcher" style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
      {kids.map((c) => {
        const on = c.id === chosen?.id;
        return (
          <Action key={c.id} testid={`child-chip-${c.id}`} pressed={on} onClick={() => onChoose(c)}
            style={{ fontWeight: on ? 600 : 500 }}>
            {c.knownAs || c.name}
          </Action>
        );
      })}
    </div>
  );
}

// ── Availability (P3, S1, S3) ──────────────────────────

const ANSWERS = [["available", "Available"], ["doubtful", "Doubtful"], ["unavailable", "Unavailable"]];
/** The table's own vocabulary (db/08 match_availability.reason_kind), in words. */
const REASONS = [["illness", "Ill"], ["family", "Family"], ["academic", "School work"], ["travel", "Travelling"],
  ["religious", "Religious"], ["other_sport", "Another sport"], ["other", "Something else"]];

/** A state as a word and a mark — never a colour alone. */
export function stateWords(status) {
  return {
    available:          { word: "Available", icon: "circle-check" },
    doubtful:           { word: "Doubtful", icon: "triangle-alert" },
    unavailable:        { word: "Unavailable", icon: "ban" },
    needs_reconfirming: { word: "Needs reconfirming", icon: "triangle-alert" },
  }[status] ?? { word: "No answer yet", icon: null };
}

export function StateChip({ status, testid }) {
  const s = stateWords(status);
  return (
    <span data-testid={testid} style={{ display: "inline-flex", alignItems: "center", gap: T.space.xs, ...T.role.body, fontSize: "14px",
      fontWeight: 600, color: T.content.primary }}>
      {s.icon && <Icon name={s.icon}/>}{s.word}
    </span>
  );
}

const whenSaid = (at) => (at ? humanDate(String(at).slice(0, 10)) : null);

/**
 * Who said it, in the reader's words: "you" for the reader, the child's own
 * name for the child, the declarant's name otherwise. `self` is the pupil's
 * own screen.
 */
function saidBy(row, child, self) {
  if (!row?.status || row.needsReconfirming) return null;
  const me = profile()?.user?.name ?? null;
  const by = row.selfDeclared ? (self ? "you" : (child.knownAs || child.name))
    : (me && row.declaredByName === me) ? "you" : (row.declaredByName ?? "the school");
  const at = whenSaid(row.declaredAt);
  return `said by ${by}${at ? `, ${at}` : ""}`;
}

/**
 * One child's answer for one fixture, and the way to give it (P3, S3): three
 * keys, a reason from the table's own list for doubtful and unavailable, a
 * note for the coach, and one tap to say it again when the fixture moved.
 * The row written is the one the coach's Squad already reads, with
 * `declared_by` the person who sent it.
 */
export function AvailabilityBlock({ match, child, role, self = false, compact = false }) {
  const [nonce, setNonce] = useState(0);
  const { rows, loading, error } = useLive("availability", role, nonce, { matchId: match.id });
  const row = rows.find((r) => r.playerId === child.id) ?? null;
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const mayDeclare = holds(role, "availability.declare");
  const pid = child.id;

  const send = async (status, reasonKind = null, text = null) => {
    setBusy(true); setSaid("");
    try {
      await api(`/api/matches/${match.id}/availability`, { method: "POST",
        body: { playerId: pid, status, reasonKind: reasonKind || null, note: text || null } });
      setPick(null); setReason(""); setNote("");
      setNonce((n) => n + 1);
    } catch (e) {
      setSaid(e.code === "not_permitted" ? "The school's records did not take that. Ask the coach." : (e.message || "Not sent."));
    } finally { setBusy(false); }
  };

  if (loading && !rows.length) return <Line quiet>Reading the answer…</Line>;
  if (error) return <Unread what="the answer"/>;
  const by = saidBy(row, child, self);
  return (
    <div data-testid={`availability-${pid}`} style={{ display: "grid", gap: T.space.sm }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: T.space.sm, flexWrap: "wrap" }}>
        {self ? <span style={{ ...T.role.body, color: T.content.secondary }}>You:</span> : null}
        <StateChip status={row?.status ?? null} testid={`availability-state-${pid}`}/>
        {by && <span data-testid={`availability-by-${pid}`} style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{by}</span>}
      </div>
      {row?.needsReconfirming && row.wasLine && (
        <Line testid={`availability-was-${pid}`}>The fixture has changed: {row.wasLine}.</Line>
      )}
      {said && <p role="alert" style={{ ...T.role.body, color: T.semantic.criticalText, margin: 0 }}>{said}</p>}
      {mayDeclare && !compact && (
        <>
          {row?.needsReconfirming && row.saidStatus && (
            <div>
              <Action primary disabled={busy} testid={`availability-again-${pid}`}
                onClick={() => send(row.saidStatus, row.reasonKind, row.note)}>
                Still {stateWords(row.saidStatus).word.toLowerCase()}
              </Action>
            </div>
          )}
          <div role="group" aria-label={self ? "Your answer" : `${child.knownAs || child.name}'s answer`}
            style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: T.space.sm }}>
            {ANSWERS.map(([v, l]) => (
              <Action key={v} testid={`availability-set-${pid}-${v}`} pressed={pick === v}
                onClick={() => setPick(v)} style={{ minHeight: "56px", padding: `0 ${T.space.sm}`, borderRadius: T.radius.md }}>
                {l}
              </Action>
            ))}
          </div>
          {pick && pick !== "available" && (
            <label style={{ display: "grid", gap: T.space.xs, ...T.role.body, color: T.content.secondary }}>
              Why? (the coach sees this)
              <select value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`availability-reason-${pid}`}
                style={{ minHeight: "44px", ...T.role.control, color: T.content.primary, background: T.surface.base,
                  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: `0 ${T.space.md}` }}>
                <option value="">Choose one, or leave it</option>
                {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
          {pick && (
            <label style={{ display: "grid", gap: T.space.xs, ...T.role.body, color: T.content.secondary }}>
              A note for the coach (optional)
              <textarea value={note} maxLength={280} rows={2} onChange={(e) => setNote(e.target.value)}
                data-testid={`availability-note-${pid}`}
                style={{ ...T.role.control, color: T.content.primary, background: T.surface.base, border: `1px solid ${T.line.normal}`,
                  borderRadius: T.radius.md, padding: T.space.md, resize: "vertical" }}/>
            </label>
          )}
          {pick && (
            <div>
              <Action primary disabled={busy} testid={`availability-send-${pid}`} onClick={() => send(pick, reason, note)}>
                Tell the coach
              </Action>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── The team sheet line (P1, P3, S1) ───────────────────

/**
 * Whether the child is on the sheet, from match_squad. A parent's read
 * returns her own child's row and nobody else's, so she learns "named,
 * batting 4" and nothing more (§9 Q10's widening is not phase A); a pupil
 * reads his side's sheet, and his line says where he is on it. Either way the
 * line names nobody but the child.
 */
export function TeamSheetLine({ match, child, role, self = false }) {
  const { rows, loading, error, disabled } = useLive("match_squad", role, 0, { matchId: match.id });
  if (loading || disabled) return null;
  if (error) return <Line quiet testid="teamsheet-line">Team sheet: could not be read just now.</Line>;
  const mine = rows.find((r) => r.playerId === child.id && r.side) ?? null;
  const place = mine?.twelfth ? "twelfth man" : mine?.battingNo ? `batting ${mine.battingNo}` : null;
  const text = mine
    ? (self ? `You're in the side${place ? ` · ${place}` : ""}` : `Team sheet: named${place ? `, ${place}` : ""}`)
    : self
      ? (rows.length ? "Not in the side this time" : "Side not out yet")
      : "Team sheet: not named yet";
  return <Line testid="teamsheet-line" strong={!!mine}>{text}</Line>;
}

// ── The bus (P1, P3, S1) ───────────────────────────────

const hhmm = (at) => (at ? new Date(at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }) : null);
const BUS_STATE = { scheduled: null, under_way: "on its way", arrived: "arrived", cancelled: "cancelled" };

/** The trip to this fixture, if one is arranged — and nothing at all if not (§2.1: a card a read cannot fill is not drawn). */
export function useTrip(match, role) {
  const { rows, disabled } = useLive("trips", role, 0, { matchId: match.id });
  if (disabled) return null;
  return rows.find((t) => t.matchId === match.id && t.state !== "cancelled") ?? rows.find((t) => t.matchId === match.id) ?? null;
}

export function BusLine({ match, role }) {
  const trip = useTrip(match, role);
  if (!trip) return null;
  const st = BUS_STATE[trip.state];
  return (
    <Line testid="bus-line">
      <Icon name="bus"/> {trip.state === "cancelled" ? "The bus is cancelled"
        : `Bus leaves ${hhmm(trip.departAt) ?? "—"}${trip.pickup ? ` · ${trip.pickup}` : ""}${st ? ` · ${st}` : ""}`}
    </Line>
  );
}

export function BusCard({ match, role }) {
  const trip = useTrip(match, role);
  if (!trip) return null;
  const st = BUS_STATE[trip.state];
  return (
    <Card label="Bus" testid="bus-card">
      {trip.state === "cancelled" ? <Line strong>The bus is cancelled.</Line> : (
        <>
          <Line strong>Leaves {hhmm(trip.departAt) ?? "—"}{trip.pickup ? ` · ${trip.pickup}` : ""}</Line>
          {(trip.returnAt || trip.driverName) && (
            <Line quiet>{[trip.returnAt ? `Back about ${hhmm(trip.returnAt)}` : null, trip.driverName ? `Driver: ${trip.driverName}` : null].filter(Boolean).join(" · ")}</Line>
          )}
          {st && <Line>The bus has {st === "on its way" ? "left" : st}.</Line>}
        </>
      )}
    </Card>
  );
}

// ── Weather (P1, P3) ───────────────────────────────────

export function WeatherLine({ match, role }) {
  const w = useWeather(role)[match.id];
  if (!w) return null;
  const bits = [w.tempC != null ? `${Math.round(w.tempC)}°` : null, w.condition ?? null,
    w.rainChancePct != null ? `rain chance ${w.rainChancePct}%` : null].filter(Boolean);
  if (!bits.length) return null;
  // When it was observed, so a parent is not shown yesterday's sky as today's.
  const stamp = observedStamp(w, { status: match.status });
  return <Line quiet testid="weather-line">{bits.join(", ")}{stamp ? ` · ${stamp.text}` : ""}</Line>;
}

/** "Sat 3 Oct · 09:00". */
export const whenOf = (m) => humanDateTime(m.date, m.time);
