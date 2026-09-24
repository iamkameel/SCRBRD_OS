/**
 * SCRBRD — resolving an event the server would not write. SCRBRD-070.
 *
 * Since db/36 the server judges every live event before it writes it, and
 * answers per event: `refused` (the Laws said no) or `conflicts` (the key
 * already names a different event). Either way it wrote NOTHING, and the sync
 * engine moves the device's copy to a durable `held` list (sync-engine.mjs)
 * rather than resend it forever. This file is what a person does about one.
 *
 * WHERE THE DEVICE AND THE SERVER DISAGREE
 * ────────────────────────────────────────
 * The pad's log (engine.jsx, persisted by persist.js) still holds a held
 * event, so its board counts it. The server does not. Every event after it
 * that the server DID accept was judged against the server's log — the one
 * without the held event — so the server's log is exactly the pad's log with
 * the held events taken out. Removing the held events from the pad's log is
 * therefore what makes the two agree, and nothing else does.
 *
 * THE TWO RESOLUTIONS, AND WHY THERE IS NO THIRD
 * ──────────────────────────────────────────────
 * Discard. The event leaves the pad's log — the same move undo makes for an
 * event the server never accepted (undo.mjs: HELD), through the same
 * setEvents → saveMatch path — and then the held copy is let go
 * (SyncEngine.discardHeld). Always available, for a refusal and a conflict.
 *
 * Record again. The same delivery (or bowler, or batters…), taken out of its
 * old place and appended as a NEW event, with a new id, at the end of the
 * log, where the server judges it afresh. Only for a refusal, never a
 * conflict, and only when the Laws the server will ask (lawsRefusal) say yes
 * against the log as the server holds it — so it is offered exactly when it
 * would help, and shown with what it will be recorded as. A ball recorded
 * again is attributed the way the pad attributes a fresh tap: to the batters
 * and bowler at the crease when it is recorded, not the ones it named when it
 * was refused (who may be the very reason it was refused).
 *
 * THE CASCADE
 * ───────────
 * A refused lifecycle event (a bowler bowling two overs running) makes every
 * ball after it refused too — the server never had that bowler, so it had
 * nobody bowling. Discarding the bowler does NOT make those balls legal: the
 * server never had it, so letting it go changes nothing the server knows.
 * They can only become legal by being judged again in a new place, after
 * something the scorer does (names the right bowler). So nothing is ever
 * resent on its own. Each resolution is offered for one event or for it and
 * every event held after it, and the scorer sees the list and the count
 * before either happens.
 *
 * NEVER LOST, NEVER TWICE
 * ───────────────────────
 * Nothing here removes a held event except a person's tap. Recording again
 * removes the original and appends the copy in ONE change to the log (one
 * saveMatch), and the original key is never sent again: the server never
 * wrote it, the engine will not re-queue a key it holds, and once discarded
 * it is in no log to be re-queued from. A copy the server refuses in turn is
 * held under its new key — the count stays, nothing doubles.
 */
import { deriveInnings, lawsRefusal, undoLast, LOCAL_ONLY, REFUSAL_TEXT, DISMISSAL_LABEL } from "@scrbrd/scoring";

/**
 * An event the server refused or conflicted on, as the engine holds it.
 * @typedef {import("./sync-engine.mjs").OutboxEvent & {state: "refused"|"conflict", reason: string}} HeldEvent
 */

/**
 * The pad's log: one array of events per innings, index = innings number.
 * Events are the scoring package's shape, so `any` at this boundary.
 * @typedef {any[][]} PadLog
 */

/**
 * The held events in the order they were recorded (clientSeq is monotonic
 * per device and persisted, and the pad records in log order).
 * @param {HeldEvent[]} held
 * @returns {HeldEvent[]}
 */
export const heldInOrder = (held) => [...held].sort((a, b) => a.clientSeq - b.clientSeq);

/**
 * This held event and every one held after it — the scope of "…and the N
 * after it". Empty when the key is not held.
 * @param {HeldEvent[]} held
 * @param {string} key
 * @returns {HeldEvent[]}
 */
export function heldFrom(held, key) {
  const ordered = heldInOrder(held);
  const i = ordered.findIndex((h) => h.idempotencyKey === key);
  return i < 0 ? [] : ordered.slice(i);
}

/**
 * Is this event still in the pad's log? A held ball the scorer has since
 * undone (undo drops a held event, undo.mjs HELD) is not.
 * @param {PadLog} log
 * @param {string} id
 */
export const inLog = (log, id) => log.some((evs) => (evs ?? []).some((e) => e?.id === id));

/**
 * The pad's log without these events: the held sheet's discard. A held event
 * never reached the server, so it simply leaves — no void, which the server
 * would refuse anyway (it has nothing to void). The same rule undo follows
 * for one (undo.mjs, HELD; `undoOnPad` below). Innings arrays that lose
 * nothing are returned as they were.
 * @param {PadLog} log
 * @param {Iterable<string>} ids
 * @returns {PadLog}
 */
export function withoutEvents(log, ids) {
  const drop = new Set(ids);
  return log.map((evs) => {
    if (!(evs ?? []).some((e) => drop.has(e?.id))) return evs;
    return evs.filter((e) => !drop.has(e?.id));
  });
}

/**
 * The pad's undo, for the innings in play, asked of the device's outbox.
 *
 * Which undo applies is undo.mjs's rule (undoLast), asked with the outbox's
 * two answers (`boundaryOf`): a held event is DROPPED from wherever it sits —
 * the server never had it, so there is nothing to void, and a void would be
 * refused and held in its turn (SCRBRD-071); an event that has never left the
 * device is TRUNCATED when it is last; anything else is voided.
 *
 * What the caller does with the outbox afterwards is named, not implied:
 *   `withdraw` — the key to take back out of the queue (SyncEngine.withdraw)
 *     BEFORE the shorter log is saved, or the event is sent anyway and the
 *     server records a ball the pad no longer shows (SCRBRD-074). Null when
 *     there is no queue to take it from (LOCAL_ONLY).
 *   `discard` — the held copy to let go (SyncEngine.discardHeld) once the log
 *     is saved: the scorer has taken the event off the board with their own
 *     hand, so it does not linger in the Refused list.
 *
 * @param {PadLog} log
 * @param {number} innings        the innings in play
 * @param {import("@scrbrd/scoring").OutboxView | null} outbox
 *   the device's SyncEngine; LOCAL_ONLY for a match with no server behind
 *   it; null for a live match whose outbox is not attached (every undo a void)
 * @param {() => string} [mint]  the id for a void (the pad's newEventId). The
 *   pad offers its outbox only events with ids, so a void without one is
 *   never sent and the server keeps the ball the pad took back.
 * @returns {{log: PadLog, action: "truncate"|"drop"|"void"|"none", target: any, discard: string|null, withdraw: string|null}}
 */
export function undoOnPad(log, innings, outbox, mint) {
  const r = undoLast(log[innings] ?? [], { outbox, voidId: mint?.() });
  if (r.action === "none") return { log, action: r.action, target: r.target, discard: null, withdraw: null };
  const next = [...log];
  next[innings] = r.events;
  const id = r.target?.id ?? null;
  return {
    log: next, action: r.action, target: r.target,
    discard: r.action === "drop" ? id : null,
    withdraw: r.action === "truncate" && outbox !== LOCAL_ONLY ? id : null,
  };
}

/**
 * The log as the server holds it, as far as this device can tell: the pad's
 * log without anything held. (Pending events stay: they are on their way and
 * will be judged, in order, before anything appended after them.)
 * @param {PadLog} log
 * @param {HeldEvent[]} held
 * @returns {PadLog}
 */
export const serverView = (log, held) => withoutEvents(log, held.map((h) => h.idempotencyKey));

/**
 * A copy of a held event as it would be recorded now, at the end of `view`.
 * A delivery takes the crease as the fold has it at that point — the same
 * `before` the pad reads when a ball is tapped (engine.jsx commitBall).
 * @param {PadLog} view
 * @param {any} payload
 * @returns {any}
 */
function asRecordedNow(view, payload) {
  const i = payload?.innings ?? 0;
  const copy = { ...payload };
  delete copy.id;
  if (copy.kind === "ball") {
    const evs = view[i] ?? [];
    const before = evs.length ? deriveInnings(evs) : null;
    copy.striker = before?.striker ?? null;
    copy.nonStriker = before?.nonStriker ?? null;
    copy.bowler = before?.bowler ?? null;
    copy.freeHit = !!before?.freeHit;
  }
  return copy;
}

/**
 * Would the server take these, recorded again now, in order, at the end?
 * Asks the function the server asks (lawsRefusal) against the log the server
 * holds (serverView), each event against the ones before it. A prediction —
 * the server decides — but the same rules over the same fold.
 *
 * Null when every one would be accepted; otherwise the first that would not,
 * and why. A conflict, or an event no longer on the board, is never recorded
 * again and answers with its own reason.
 *
 * @param {PadLog} log
 * @param {HeldEvent[]} held       everything held (to take out of the view)
 * @param {HeldEvent[]} evs        the ones to record again, in order
 * @returns {{key: string, reason: string}|null}
 */
export function recordAgainRefusal(log, held, evs) {
  const view = serverView(log, held).map((a) => [...(a ?? [])]);
  for (const h of evs) {
    if (h.state !== "refused") return { key: h.idempotencyKey, reason: "idempotency_conflict" };
    if (!inLog(log, h.idempotencyKey)) return { key: h.idempotencyKey, reason: "not_on_board" };
    const ev = asRecordedNow(view, h.payload);
    const i = ev.innings ?? 0;
    const innings = view.map((a) => (a.length ? deriveInnings(a) : null));
    const why = lawsRefusal({ innings, events: view }, ev);
    if (why) return { key: h.idempotencyKey, reason: why };
    while (view.length <= i) view.push([]);
    view[i].push({ ...ev, id: `predicted:${h.idempotencyKey}` });
  }
  return null;
}

/**
 * Take these held events out of the log and append each again as a new
 * event, in order, at the end of its innings — one new log, so one save.
 * The caller mints the ids (the pad's newEventId), and checks
 * recordAgainRefusal first; this does not judge.
 *
 * Each copy carries `resentFrom`, the key it replaces, which rides in the
 * row's payload (toRow keeps unknown fields there): whoever reads the log
 * later can see that this ball was refused once and recorded again.
 *
 * @param {PadLog} log
 * @param {HeldEvent[]} held      everything held
 * @param {HeldEvent[]} evs       the ones to record again, in order
 * @param {() => string} mint
 * @returns {{log: PadLog, copies: any[]}}
 */
export function recordAgain(log, held, evs, mint) {
  const moving = new Set(evs.map((h) => h.idempotencyKey));
  const next = withoutEvents(log, moving).map((a) => [...(a ?? [])]);
  // Attribution is read from the server's view (nothing held), extended by
  // each copy as it lands, exactly as recordAgainRefusal judged it.
  const view = serverView(next, held.filter((h) => !moving.has(h.idempotencyKey))).map((a) => [...(a ?? [])]);
  const copies = [];
  for (const h of evs) {
    const copy = { ...asRecordedNow(view, h.payload), id: mint(), resentFrom: h.idempotencyKey };
    const i = copy.innings ?? 0;
    while (next.length <= i) next.push([]);
    while (view.length <= i) view.push([]);
    next[i].push(copy);
    view[i].push(copy);
    copies.push(copy);
  }
  return { log: next, copies };
}

// ── In words ───────────────────────────────────────────────────

/** What a conflict means and what to do, finishing "The server …". */
export const CONFLICT_TEXT =
  "already holds a different event under this one's id, and keeps its own. " +
  "This device's copy is the odd one out: discarding it is how the two agree again.";

/** Reasons recordAgainRefusal can give that are not Laws. */
const NOT_A_LAW = /** @type {Record<string, string>} */ ({
  not_on_board: "it is no longer on this device's board",
  idempotency_conflict: "the server holds a different event under its id",
});

/**
 * A reason code in words. The Laws' own text, then the two this file adds,
 * then the code itself rather than nothing.
 * @param {string|null|undefined} reason
 * @returns {string}
 */
export function reasonWords(reason) {
  if (reason == null) return "no reason was given";
  const laws = /** @type {Record<string, string>} */ (REFUSAL_TEXT);
  return laws[reason] ?? NOT_A_LAW[reason] ?? reason;
}

/**
 * A player's name as the fold knows it: squad rows are {id, name}; an
 * opposition player SCRBRD holds no row for is his typed name already.
 * @param {any} inn   deriveInnings() state, or null
 * @param {any} id
 * @returns {string}
 */
export function nameIn(inn, id) {
  if (id == null) return "nobody";
  const all = [...(inn?.squad ?? []), ...(inn?.bowlingSquad ?? [])];
  const hit = all.find((p) => p?.id === id);
  return hit?.name ?? String(id);
}

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * What an event was, in a line a scorer reads: "Ball — 4 runs, J Smith
 * facing A Nel". `inn` supplies the names; `find` looks up another event by
 * id (for an undo, to say what it undid).
 * @param {any} ev
 * @param {any} inn
 * @param {(id: string) => any} [find]
 * @returns {string}
 */
export function describeEvent(ev, inn, find) {
  const n = (/** @type {any} */ id) => nameIn(inn, id);
  switch (ev?.kind) {
    case "ball": {
      const v = Number(ev.value ?? 0);
      const face = ev.striker != null ? `, ${n(ev.striker)} facing${ev.bowler != null ? ` ${n(ev.bowler)}` : ""}` : "";
      switch (ev.type ?? "run") {
        case "W": {
          const how = /** @type {Record<string, string>} */ (DISMISSAL_LABEL)[ev.dismissal] ?? ev.dismissal ?? "out";
          const who = ev.dismissed ?? ev.striker;
          return `Wicket — ${who != null ? `${n(who)} ` : ""}${how}${v ? `, ${plural(v, "run")}` : ""}${ev.bowler != null ? ` (bowling: ${n(ev.bowler)})` : ""}`;
        }
        case "Wd": return `Wide${v ? ` + ${plural(v, "run")}` : ""}${face}`;
        case "Nb": return `No ball${v ? ` + ${ev.nbRuns === "byes" ? plural(v, "bye") : ev.nbRuns === "leg_byes" ? plural(v, "leg bye") : plural(v, "run")}` : ""}${face}`;
        case "B":  return `${plural(v, "bye")}${face}`;
        case "LB": return `${plural(v, "leg bye")}${face}`;
        default:   return `Ball — ${v ? plural(v, "run") : "dot ball"}${face}`;
      }
    }
    case "bowler":  return `Bowler — ${n(ev.bowler)} to bowl${ev.reason ? ` (takes over mid-over: ${ev.reason === "suspended" ? "bowler suspended" : "injury"})` : ""}`;
    case "batters": {
      const who = [ev.striker != null ? `${n(ev.striker)} (on strike)` : null,
                   ev.nonStriker != null ? n(ev.nonStriker) : null].filter(Boolean);
      return `Batters — ${who.length ? who.join(" and ") : "nobody named"}`;
    }
    case "retire": {
      // SCRBRD-081: marked W, it is a dismissal with no ball.
      if (ev.type === "W") {
        const how = ev.dismissal === "timed_out" || ev.reason === "timed_out" ? "timed out" : "retired out";
        return `Wicket, no ball — ${n(ev.batter)} ${how}`;
      }
      return `Retirement — ${n(ev.batter)} (${ev.reason === "out" ? "retired out" : "retired hurt"})`;
    }
    case "penalty": return `Penalty — ${plural(Number(ev.runs ?? 5), "run")} to the ${ev.toBattingTeam === false ? "fielding" : "batting"} side`;
    case "revision": {
      const parts = [ev.overs != null ? `${ev.overs} overs` : null, ev.target != null ? `target ${ev.target}` : null].filter(Boolean);
      return `Revision — ${parts.length ? parts.join(", ") : "no change"}`;
    }
    case "innings_end": return `End of the innings${ev.reason ? ` (${String(ev.reason).replace(/_/g, " ")})` : ""}`;
    case "innings_start": return `Start of the innings — ${ev.battingTeam ?? "?"} batting`;
    case "void": {
      const t = ev.target != null ? find?.(ev.target) : null;
      return `Undo — of ${t ? `"${describeEvent(t, inn)}"` : "an event this device does not have"}`;
    }
    default: return `Event — ${ev?.kind ?? "unknown"}`;
  }
}

/**
 * A held event in words, for the sheet: what it was, why the server would
 * not write it, and whether it is still on the board.
 * @param {HeldEvent} h
 * @param {PadLog} log
 * @param {any[]} innings   the pad's folded innings, one per log entry
 * @returns {{what: string, why: string, onBoard: boolean}}
 */
export function describeHeld(h, log, innings) {
  const ev = h.payload ?? {};
  const inn = innings?.[ev.innings ?? 0] ?? null;
  const find = (/** @type {string} */ id) => {
    for (const evs of log) for (const e of evs ?? []) if (e?.id === id) return e;
    return null;
  };
  return {
    what: describeEvent(ev, inn, find),
    why: h.state === "conflict"
      ? `The server ${CONFLICT_TEXT}`
      : `The server refused this: ${reasonWords(h.reason)}.`,
    onBoard: inLog(log, h.idempotencyKey),
  };
}
