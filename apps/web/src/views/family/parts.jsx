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
import { useEffect, useState } from "react";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { useLive, useWeather } from "../../lib/live.js";
import { observedStamp } from "../../lib/weatherStamp.js";
import { profile } from "../../lib/session.js";
import { humanDate, humanDateTime } from "../../lib/format.js";
import { injuredAnswer, saToday } from "../../lib/injury.js";
import { endOf, holds } from "../../lib/family.js";
import { Icon } from "../../ui/icons.jsx";
import { ReadState } from "../../ui/primitives.jsx";
import { readState } from "../../lib/readState.js";

// ── Layout ─────────────────────────────────────────────

export function Page({ children, testid, label }) {
  return (
    <div className="os-page" data-testid={testid} aria-label={label}
      style={{ maxWidth: "720px", margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: T.space.md, alignContent: "start" }}>
      {children}
    </div>
  );
}

/**
 * The three card weights (redesign slice 8; the role reviews' direction §2.6),
 * from the existing tokens and nothing new:
 *   lead      the one block a first screen leads with: the raised surface, the
 *             strong hairline, the theme's own lift, more room inside
 *   standard  what is asked of the reader beside the lead: as every card was
 *   quiet     what is there to read: on the page itself, the faintest line, no lift
 * Weight is a border, a surface and a shadow, never a colour (§3.7). Functions,
 * not constants: a token read at import keeps the theme it was read under.
 */
const WEIGHT = {
  lead: () => ({ background: T.surface.raised, border: `1px solid ${T.line.strong}`, boxShadow: `${T.elevation.md}, ${T.elevation.sheen}`,
    padding: `${T.space.lg} ${T.space.lg}`, gap: T.space.md }),
  standard: () => ({ background: T.surface.raised, border: `1px solid ${T.line.normal}`, padding: `${T.space.md} ${T.space.lg}`, gap: T.space.sm }),
  quiet: () => ({ background: "transparent", border: `1px solid ${T.line.subtle}`, padding: `${T.space.md} ${T.space.lg}`, gap: T.space.sm }),
};

/** A card: an eyebrow, then what it says. A border, not a tint (§3.7). `weight`: lead, standard (the default) or quiet. */
export function Card({ label, children, testid, aside, tone, weight = "standard" }) {
  const w = (WEIGHT[weight] ?? WEIGHT.standard)();
  return (
    <section data-testid={testid} data-weight={weight} aria-label={typeof label === "string" ? label : undefined}
      style={{ ...w, ...(tone ? { border: `1px solid ${tone}` } : null), borderRadius: T.radius.lg,
        display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}>
      {(label || aside) && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap" }}>
          {label && <h2 style={{ ...T.role.label, color: weight === "lead" ? T.content.primary : T.content.secondary, margin: 0 }}>{label}</h2>}
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
      <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "2px", overflowWrap: "anywhere" }}>{children}</span>
      {aside && <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary, flex: "0 1 auto", textAlign: "right" }}>{aside}</span>}
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

/** "Couldn't load …" is a different statement from "nothing", and says so. */
export function Unread({ what, onRetry = null }) {
  return (
    <>
      <Line quiet>Couldn't load {what} just now. This is not the same as there being none.</Line>
      {onRetry && <RetryBtn onRetry={onRetry}/>}
    </>
  );
}

/** The one Retry: 44px, the same on every failed read (redesign slice 7). */
export function RetryBtn({ onRetry, testid = "retry" }) {
  return (
    <button type="button" onClick={onRetry} data-testid={testid} className="pressBtn" style={{
      minHeight: "44px", minWidth: "44px", padding: "0 20px", borderRadius: T.radius.pill, justifySelf: "start",
      border: `1px solid ${T.line.normal}`, background: "transparent", color: T.content.primary,
      fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>Retry</button>
  );
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

/** The three answers in the family's words (the role reviews' direction §3.1 Flow A: "Available, Doubtful, Not available"). */
const ANSWERS = [["available", "Available"], ["doubtful", "Doubtful"], ["unavailable", "Not available"]];
/** The table's own vocabulary (db/08 match_availability.reason_kind), in words. */
const REASONS = [["illness", "Ill"], ["family", "Family"], ["academic", "School work"], ["travel", "Travelling"],
  ["religious", "Religious"], ["other_sport", "Another sport"], ["other", "Something else"]];

/** A state as a word and a mark — never a colour alone. Doubtful's mark is neutral (§3.1 Flow A 3): a maybe is not a fault. */
export function stateWords(status) {
  return {
    available:          { word: "Available", icon: "circle-check" },
    doubtful:           { word: "Doubtful", icon: "circle-help" },
    unavailable:        { word: "Not available", icon: "ban" },
    needs_reconfirming: { word: "Needs reconfirming", icon: "triangle-alert" },
  }[status] ?? { word: "No answer yet", icon: null };
}

export function StateChip({ status, testid }) {
  const s = stateWords(status);
  return (
    <span data-testid={testid} data-status={status ?? "none"} style={{ display: "inline-flex", alignItems: "center", gap: T.space.xs, ...T.role.body, fontSize: "14px",
      fontWeight: 600, color: T.content.primary }}>
      {s.icon && <Icon name={s.icon}/>}{s.word}
    </span>
  );
}

/** The day an answer was given, in words, on South Africa's calendar (not the UTC day of the timestamp). */
const whenSaid = (at) => {
  if (!at) return null;
  const ms = Date.parse(at);
  return humanDate(Number.isNaN(ms) ? String(at).slice(0, 10) : saToday(new Date(ms)));
};

/**
 * The line under the keys (§3.1 Flow A 2, §3.2 Flow A 2), each fact once:
 * "Sent to the coach · Wed 18 Nov" when the reader gave the answer; who gave
 * it otherwise: "Said by D Pillay · Tue 17 Nov", or the boy's own name on his
 * parent's screen. `self` is the pupil's own screen; `row.mine` an answer
 * this screen has just sent.
 */
/**
 * Is this answer the reader's own: sent from this screen, his own on his screen, or hers (her name on it) on hers.
 * @param {any} row  @param {boolean} self  @param {string | null} me  the reader's name
 */
export function answerIsMine(row, self, me) {
  if (!row) return false;
  return !!row.mine || (self ? !!row.selfDeclared : (!row.selfDeclared && me != null && row.declaredByName === me));
}

/**
 * The reason and note this screen may offer again, or send again: the reader's own words only (Kameel, 25 Nov).
 * A note "for the coach" is its writer's and the staff's: the server returns another person's as null, and this
 * screen never fills a form, or answers again, with words somebody else wrote, so nothing is sent under his name
 * that he did not write. Pure.
 * @param {any} row  @param {boolean} self  @param {string | null} me
 * @returns {{reasonKind: string | null, note: string | null}}
 */
export function ownWords(row, self, me) {
  return answerIsMine(row, self, me) ? { reasonKind: row.reasonKind ?? null, note: row.note ?? null } : { reasonKind: null, note: null };
}

function saidLine(row, child, self) {
  if (!row?.status || row.needsReconfirming) return null;
  const me = profile()?.user?.name ?? null;
  const mine = answerIsMine(row, self, me);
  const by = row.selfDeclared ? (child.knownAs || child.name) : (row.declaredByName ?? "the school");
  return [mine ? "Sent to the coach" : `Said by ${by}`, whenSaid(row.declaredAt)].filter(Boolean).join(" · ");
}

/**
 * One key of the three (§3.1 Flow A, principle 5: the answer stays under the
 * thumb). The answer given is pressed: filled, a solid double edge, a tick. A
 * suggested one (an injured boy's fixture before his return) is pre-filled
 * but not pressed: the same fill, a dashed edge, no tick and aria-pressed
 * false, because nothing has been sent; the line under the keys says why.
 * Never disabled while an answer is on its way: a disabled key fades, and the
 * one just tapped must stay pressed.
 */
function AnswerKey({ value, label, on, suggested, onTap, pid, describedBy }) {
  return (
    <button type="button" className="pressBtn os-state" aria-pressed={on} data-testid={`availability-set-${pid}-${value}`}
      data-suggested={suggested ? "true" : undefined} aria-describedby={suggested ? describedBy : undefined} onClick={onTap}
      style={{ minHeight: "56px", padding: T.space.xs, borderRadius: T.radius.md, cursor: "pointer", minWidth: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: T.space.xs, textAlign: "center",
        background: on || suggested ? T.surface.interactive : "transparent", color: T.content.primary,
        border: `1px ${suggested && !on ? "dashed" : "solid"} ${on || suggested ? T.content.primary : T.line.normal}`,
        boxShadow: on ? `inset 0 0 0 1px ${T.content.primary}` : "none",
        ...T.role.control, fontSize: "15px", lineHeight: 1.2, fontWeight: on ? 700 : suggested ? 600 : 500 }}>
      {/* The tick beside the word, never above it: the label breaks between its words ("Not / available"), the tick stays put. */}
      {on && <Icon name="check" style={{ flexShrink: 0 }}/>}<span style={{ minWidth: 0 }}>{label}</span>
    </button>
  );
}

/**
 * One child's answer for one fixture, and the way to give it (P3, S3; the
 * role reviews' direction §3.1 and §3.2 Flow A, redesign slice 9):
 *
 *   - three keys under one label ("Your answer", or "R Pillay's answer");
 *   - ONE TAP sends. The key stays pressed, with a tick, and the line under
 *     the keys says "Sent to the coach · Wed 18 Nov". Nothing on the block
 *     moves: the keys stay where they were, and the line is always there;
 *   - for Doubtful and Not available, a reason from the table's own list and
 *     a note for the coach, added after the answer if she wants;
 *   - an answer the fixture has since moved under asks again, with its old
 *     answer as one tap;
 *   - his open injury, before his return date and with nothing yet answered:
 *     Not available is SUGGESTED (lib/injury.js injuredAnswer). Nothing is
 *     written until a key is tapped, and what is written is the answer alone.
 *
 * The row written is the one the coach's Squad already reads, with
 * `declared_by` the person who sent it. Nothing here decides who may answer:
 * the server's insert policy does, and a refusal is said.
 * `onSent(status)`: told once the server has taken an answer given here.
 */
export function AvailabilityBlock({ match, child, role, self = false, onSent = null }) {
  const [nonce, setNonce] = useState(0);
  const { rows, loading, error } = useLive("availability", role, nonce, { matchId: match.id });
  // The same `injury_status` read his Home's line makes: whose, open and the return date, nothing clinical (injuredAnswer).
  const injuries = useLive("injury_status", role);
  const live = rows.find((r) => r.playerId === child.id) ?? null;
  const [sending, setSending] = useState(/** @type {string | null} */ (null));
  const [sent, setSent] = useState(/** @type {any} */ (null));
  const [why, setWhy] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [said, setSaid] = useState("");
  const mayDeclare = holds(role, "availability.declare");
  const pid = child.id;
  const name = child.knownAs || child.name;
  // What the server took from this screen stands until the re-read carries it
  // (the same moment or later), so the key stays pressed through the re-read.
  const row = sent && !(live?.declaredAt && Date.parse(live.declaredAt) >= Date.parse(sent.declaredAt)) ? sent : live;

  const send = async (status, reasonKind = null, text = null) => {
    if (sending) return;
    setSending(status); setSaid("");
    try {
      const out = await api(`/api/matches/${match.id}/availability`, { method: "POST",
        body: { playerId: pid, status, reasonKind: reasonKind || null, note: text || null } });
      setSent({ playerId: pid, status, saidStatus: status, needsReconfirming: false, reasonKind: reasonKind || null, note: text || null,
        declaredAt: out?.declared_at ?? new Date().toISOString(), mine: true });
      setWhy(false);
      setNonce((n) => n + 1);
      onSent?.(status);
    } catch (e) {
      setSaid(e.code === "not_permitted" ? "The school's records did not take that. Ask the coach." : (e.message || "Not sent."));
    } finally { setSending(null); }
  };

  if (loading && !rows.length && !sent) return <Line quiet>Reading the answer…</Line>;
  if (error && !sent) return <Unread what="the answer" onRetry={() => setNonce((n) => n + 1)}/>;
  const asking = !sending && row?.needsReconfirming === true;
  const status = sending ?? (asking ? null : row?.status ?? null);
  const hint = mayDeclare && !status && !asking ? injuredAnswer(injuries.rows, child, match.date) : null;
  const hintId = `availability-suggest-${pid}-${match.id}`;
  const labelId = `availability-label-${pid}-${match.id}`;
  const line = sending ? "Sending to the coach…" : saidLine(row, child, self);
  const reasoned = !sending && (status === "doubtful" || status === "unavailable");
  // Only the reader's own reason and note are offered again (ownWords): never another person's words under his name.
  const own = ownWords(row, self, profile()?.user?.name ?? null);
  return (
    <div data-testid={`availability-${pid}`} style={{ display: "grid", gap: T.space.sm }}>
      <span id={labelId} style={{ ...T.role.label, color: T.content.secondary }}>{self ? "Your answer" : `${name}'s answer`}</span>
      {/* The keys: three in a row on a phone, wrapping when the screen is narrower than that (200% zoom), so none is under 44px. */}
      {mayDeclare ? (
        <div role="group" aria-labelledby={labelId} data-testid={`availability-state-${pid}`} data-status={status ?? (asking ? "needs_reconfirming" : "none")}
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))", gap: T.space.sm }}>
          {ANSWERS.map(([v, l]) => (
            <AnswerKey key={v} value={v} label={l} pid={pid} on={status === v} suggested={hint?.status === v} describedBy={hintId}
              onTap={() => { if (status !== v) void send(v); }}/>
          ))}
        </div>
      ) : (
        <div><StateChip status={row?.status ?? null} testid={`availability-state-${pid}`}/></div>
      )}
      {/* The one line under the keys, always drawn, so nothing below it moves when it changes. */}
      <p role="status" aria-live="polite" data-testid={`availability-by-${pid}`} style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 }}>
        {asking && row.wasLine ? <span data-testid={`availability-was-${pid}`} style={{ color: T.content.primary }}>The fixture has changed: {row.wasLine}.</span>
          : line ? <>{status && !sending && <Icon name="check"/>} {line}</>
          : hint ? <span id={hintId} data-testid={`availability-suggest-${pid}`}>Injured · back {humanDate(hint.back)}. Not available is suggested; nothing is sent until you tap an answer.</span>
          : "No answer yet"}
      </p>
      {said && <p role="alert" style={{ ...T.role.body, color: T.semantic.criticalText, margin: 0 }}>{said}</p>}
      {mayDeclare && asking && row.saidStatus && (
        <div>
          <Action primary testid={`availability-again-${pid}`} onClick={() => send(row.saidStatus, own.reasonKind, own.note)}>
            Still {stateWords(row.saidStatus).word.toLowerCase()}
          </Action>
        </div>
      )}
      {mayDeclare && reasoned && !why && (
        <div>
          <Action testid={`availability-why-${pid}`} onClick={() => { setReason(own.reasonKind ?? ""); setNote(own.note ?? ""); setWhy(true); }}>
            {own.reasonKind || own.note ? "Change the reason" : "Add a reason for the coach"}
          </Action>
        </div>
      )}
      {mayDeclare && reasoned && why && (
        <>
          <label style={{ display: "grid", gap: T.space.xs, ...T.role.body, color: T.content.secondary }}>
            Why? (the coach sees this)
            <select value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`availability-reason-${pid}`}
              style={{ minHeight: "44px", ...T.role.control, color: T.content.primary, background: T.surface.base,
                border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: `0 ${T.space.md}` }}>
              <option value="">Choose one, or leave it</option>
              {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: T.space.xs, ...T.role.body, color: T.content.secondary }}>
            A note for the coach (optional)
            <textarea value={note} maxLength={280} rows={2} onChange={(e) => setNote(e.target.value)}
              data-testid={`availability-note-${pid}`}
              style={{ ...T.role.control, color: T.content.primary, background: T.surface.base, border: `1px solid ${T.line.normal}`,
                borderRadius: T.radius.md, padding: T.space.md, resize: "vertical" }}/>
          </label>
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
            <Action primary testid={`availability-send-${pid}`} onClick={() => send(status, reason, note)}>Tell the coach</Action>
            <Action testid={`availability-why-cancel-${pid}`} onClick={() => setWhy(false)}>Not now</Action>
          </div>
        </>
      )}
    </div>
  );
}

// ── The team sheet line (P1, P3, S1) ───────────────────

/**
 * Whether the child is on the sheet, from match_squad. A parent's read
 * returns her own child's row and nobody else's, so the line says "named,
 * batting 4"; a pupil reads his side's sheet, and his line says where he is
 * on it. Either way the line names nobody but the child. On the fixture (P3,
 * S3) the side's names and order follow it, from their own narrow read
 * (STEP4 Q10, db/131: matches.jsx SideSheet).
 */
export function TeamSheetLine({ match, child, role, self = false, sheet = true }) {
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
  return (
    <>
      <Line testid="teamsheet-line" strong={!!mine}>{text}</Line>
      {sheet && mine && <SideSheet match={match} child={child} mine={mine} self={self}/>}
    </>
  );
}

/** Is this sheet row his: his place (his own match_squad row), or, with none, his name. */
export function isHisRow(r, child, mine) {
  if (mine?.twelfth) return !!r.twelfth && r.name === child.name;
  if (mine?.battingNo != null) return !r.twelfth && r.battingNo === mine.battingNo;
  return r.name === child.name;
}

/**
 * The side's sheet (P3, S3): every name on it, in batting order, under the
 * child's own line (REACH R-H, db/131; STEP4 Q10, Kameel 27 Sep 2026: "the
 * named players and their order — names only, no profiles, ages or photos").
 *
 * GET /api/matches/:id/sheet answers, as the reader, the end of the fixture
 * whose sheet holds a boy he may read: her child's, or his own. The rows are
 * a name, a place and a twelfth-man mark, and nothing else — no id, no age,
 * no fitness, no answer (K3, db/55: a child's medical needs are not in
 * general view). Signed in only: the demonstration draws the line alone, and
 * no public page draws this. A sheet not out yet, a read that failed and a
 * reader it does not admit all draw nothing, under the line that says which.
 *
 * Q10 (Kameel, 15 Nov 2026: "eleven"): a parent sees the eleven, names and
 * order, for her child's side and that fixture only, on his Home's next
 * fixture as on the fixture itself, her child's row marked. The read carries
 * no player id, so his row is found by his own place on the sheet (his
 * match_squad row, which his parent reads) and, failing that, his name.
 */
function SideSheet({ match, child, mine = null, self = false }) {
  const id = match.id;
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  useEffect(() => {
    if (!id || !signedIn()) { setRows(null); return undefined; }
    let cancelled = false;
    api(`/api/matches/${id}/sheet`)
      .then((d) => { if (!cancelled) setRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => { if (!cancelled) setRows(null); });
    return () => { cancelled = true; };
  }, [id]);
  if (!rows?.length) return null;
  // One end, the child's. A reader admitted at both ends (staff at both
  // schools) is shown the end this child plays.
  const ends = [...new Set(rows.map((r) => r.side))];
  const end = ends.length === 1 ? ends[0] : endOf(match, child);
  const side = rows.filter((r) => r.side === end);
  return (
    <ol data-testid="side-sheet" aria-label="Team sheet, in batting order"
      style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "2px" }}>
      {side.map((r, i) => {
        const his = isHisRow(r, child, mine);
        return (
          <li key={`${end}-${i}`} data-testid="side-sheet-row" data-his={his ? "true" : undefined} aria-current={his ? "true" : undefined}
            style={{ ...T.role.body, color: T.content.primary, display: "flex", gap: T.space.sm, fontWeight: his ? 700 : 400 }}>
            <span style={{ minWidth: "2ch", textAlign: "right", color: T.content.secondary, fontVariantNumeric: "tabular-nums" }}>
              {r.battingNo ?? ""}
            </span>
            <span>{r.name}{r.twelfth ? " (12th)" : ""}{his ? <span style={{ fontWeight: 400, color: T.content.secondary }}>{self ? " · you" : " · your child"}</span> : null}</span>
          </li>
        );
      })}
    </ol>
  );
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
