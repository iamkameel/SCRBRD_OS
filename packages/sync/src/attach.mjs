/**
 * SCRBRD — a live match's pad, getting onto the server and staying there.
 * SCRBRD-078, SCRBRD-075, SCRBRD-079.
 *
 * The pad of a live match opens with no token. It may have no signal, no
 * session (the API token lives in memory and a reload loses it, by design:
 * lib/api.js), or a colleague may hold the match. It scores regardless — into
 * its own log and into the outbox, both on disk — and ATTACHES when it can:
 * it takes the token and the outbox starts sending. This file is the rule for
 * that moment. It is pure over three injected calls (probe, log, claim), so
 * node proves it and the browser wires it (apps/web/src/lib/sync.js).
 *
 * THE ONE RULE: THE LOG IS NEVER SPLIT, AND NEVER SILENTLY DIFFERENT
 * ───────────────────────────────────────────────────────────────
 * Before a claim, the pad's log is compared with the server's, event by id
 * (reconcile):
 *
 *   in_step  the server has nothing the pad lacks. Whatever the pad has
 *            beyond it is this device's own and goes out, in order, under
 *            the token it now takes.
 *   behind   the server has events the pad lacks, and the pad has none the
 *            server lacks: somebody else scored, or this device never had
 *            the log (a first visit, the incoming side of a handover). The
 *            pad TAKES the server's log. It never starts one of its own over
 *            a match the server has already started.
 *   fork     each has events the other lacks: two devices kept one match.
 *            Nothing is merged and nothing is claimed. Both logs stay where
 *            they are, and the pad says so in words (SCORING_HANDOVER_SPEC
 *            principle 4: divergent logs are never silently merged).
 *
 * WHOSE TOKEN IT IS
 * ─────────────────
 * The claim is the database's decision (scoring_claim): it refuses a live
 * lease held on another device (`lease_active`), a handover under way
 * (`handover_pending`, `verifying`) and a finished match (`match_complete`).
 * Two things are refused here before it is asked:
 *
 *   - a handover under way is never claimed past. The plain claim from the
 *     device that ARMED a handover is the protocol's cancel (db/28), so an
 *     automatic attach from that device must not reach it;
 *   - a pad that reopened by itself (a reload restoring the last screen, a
 *     retry after the signal came back) never takes a match that has moved
 *     on since this device last held it — another device claimed it, and
 *     only lapsed leases stand between the two. Only a person opening the
 *     pad, or pressing "score on this device", claims that.
 *
 * Every refusal is an answer, not a failure: the pad says it in words and
 * does not ask again on a timer (RETRY below is the short list that does).
 */
import { deriveInnings, battingFirst, KIND } from "@scrbrd/scoring";

/** @import { PadLog } from "./held.mjs" */
/** @import { OutboxEvent, PendingToss, SyncEngine } from "./sync-engine.mjs" */

/**
 * The pad's log and the server's, compared by event id. `extra`: ids the
 * server has and the pad does not. `mine`: ids the pad (or its outbox) has
 * and the server does not, held events apart — the server answered for those
 * and wrote nothing, and they are a person's already. `orphans`: events queued
 * on this device that its saved log lost (the tab died between the queue's
 * write and the log's), which the pad puts back before anything is sent — or
 * the server would hold a ball the pad does not show.
 * @typedef {object} Reconcile
 * @property {"in_step"|"behind"|"fork"} state
 * @property {string[]} extra
 * @property {string[]} mine
 * @property {OutboxEvent[]} orphans
 */

/**
 * @param {PadLog} log                      the pad's log, one array per innings
 * @param {any[]} server                    the server's events, in seq order (fromRow)
 * @param {{held?: {idempotencyKey: string}[], pending?: OutboxEvent[]}} [outbox]
 * @returns {Reconcile}
 */
export function reconcile(log, server, { held = [], pending = [] } = {}) {
  const padIds = log.flatMap((evs) => (evs ?? []).map((e) => e?.id)).filter((id) => id != null);
  const onPad = new Set(padIds);
  const onServer = new Set(server.map((e) => e?.id).filter((id) => id != null));
  const heldKeys = new Set(held.map((h) => h.idempotencyKey));
  const orphans = pending.filter((e) => !onPad.has(e.idempotencyKey) && !onServer.has(e.idempotencyKey));
  const extra = [...onServer].filter((id) => !onPad.has(id));
  const mine = [...padIds, ...orphans.map((e) => e.idempotencyKey)]
    .filter((id) => !onServer.has(id) && !heldKeys.has(id));
  const state = extra.length === 0 ? "in_step" : mine.length === 0 ? "behind" : "fork";
  return { state, extra, mine, orphans };
}

/**
 * The pad's log, built from the server's events: one array per innings, in
 * the server's order, each event as the pad keeps it (the server's `seq` is
 * its numbering, not part of the event).
 * @param {any[]} server
 * @returns {PadLog}
 */
export function padLogFrom(server) {
  /** @type {PadLog} */
  const log = [[], []];
  for (const ev of server) {
    const i = ev?.innings ?? 0;
    while (log.length <= i) log.push([]);
    const { seq: _seq, ...rest } = ev;
    log[i].push(rest);
  }
  return log;
}

/**
 * The innings a log is in: the last one with anything in it — or, when that
 * is the first and a scorer has closed it, the second, whose start is the
 * next thing the pad asks for.
 * @param {PadLog} log
 * @returns {number}
 */
export function inningsInPlay(log) {
  let i = 0;
  for (let k = 0; k < log.length; k++) if ((log[k] ?? []).length) i = k;
  const evs = log[i] ?? [];
  if (i === 0 && evs.length && deriveInnings(evs).sealed) return 1;
  return i;
}

/**
 * The same pad log with these events put back at the end of their innings,
 * in the order the queue recorded them (reconcile's orphans).
 * @param {PadLog} log
 * @param {OutboxEvent[]} orphans
 * @returns {PadLog}
 */
export function withOrphans(log, orphans) {
  if (!orphans.length) return log;
  const next = log.map((evs) => [...(evs ?? [])]);
  for (const o of [...orphans].sort((a, b) => a.clientSeq - b.clientSeq)) {
    const ev = { ...o.payload, id: o.idempotencyKey };
    const i = ev.innings ?? 0;
    while (next.length <= i) next.push([]);
    next[i].push(ev);
  }
  return next;
}

// ── Attaching ────────────────────────────────────────────────────

/**
 * What the server says about the scoring session without changing it: the
 * heartbeat route (scoring_lease_check), which refreshes only a lease this
 * device already holds. `ok` is "this device holds a live lease".
 * @typedef {{ok: boolean, epoch: number|null, state: string|null, reason: string|null}} SessionProbe
 *
 * The three calls an attach makes. The browser's are lib/sync.js's; a test's
 * are a fake. Each throws when the server cannot be reached.
 * @typedef {object} AttachServer
 * @property {(epoch: number|null) => Promise<SessionProbe>} probe
 * @property {() => Promise<any[]>} log       the server's events, in seq order (fromRow)
 * @property {() => Promise<{ok: boolean, reason?: string|null, epoch?: number|null}>} claim
 *
 * @typedef {{ok: true, epoch: number, adopted: boolean, restored: number, reason?: undefined, reconcile?: Reconcile}
 *         | {ok: false, reason: string, reconcile?: Reconcile, epoch?: undefined, adopted?: undefined, restored?: undefined}} AttachResult
 */

/**
 * Why an attach did not happen, where trying again on its own may change the
 * answer: the network, a server error, or a sign-in (which the person does;
 * the pad waits for it). Everything else is a person's to act on.
 * @type {ReadonlySet<string>}
 */
export const RETRY = new Set(["unreachable", "server_error", "busy"]);

/**
 * Take the token for this match and start sending — or say why not.
 *
 * The order matters. The session is read first, because a handover under
 * way is never claimed past (the arming device's claim is its cancel). The
 * log is compared next, because what the pad sends after a claim is judged
 * against the server's log, so the two must be one log first. Only then the
 * claim, and only then does the outbox attach — under the generation the
 * claim returned, every queued event with it (engine.attach, rebase: the
 * comparison just showed nobody else has written).
 *
 * `adopt` replaces the pad's log with the server's (behind), and answers
 * false when it would not — the scorer recorded something after the two
 * were compared, which makes it a question for the next attempt ("busy"),
 * where the comparison sees it. `restore` puts back events the queue has
 * and the pad's log lost (orphans). Both are the pad's, and each has landed
 * when it returns.
 *
 * @param {object} args
 * @param {SyncEngine} args.engine
 * @param {AttachServer} args.server
 * @param {() => PadLog} args.padLog         the pad's log as it is now
 * @param {(log: PadLog) => boolean | void | Promise<boolean | void>} args.adopt
 * @param {(orphans: OutboxEvent[]) => void | Promise<void>} [args.restore]
 * @param {"open"|"restore"} [args.intent]   "open": a person opened the pad or asked to score here
 * @returns {Promise<AttachResult>}
 */
export async function tryAttach({ engine, server, padLog, adopt, restore, intent = "open" }) {
  const probe = await server.probe(engine.heldEpoch);
  if (!probe.ok && (probe.state === "handover_pending" || probe.state === "verifying")) {
    return { ok: false, reason: /** @type {string} */ (probe.state) };
  }
  if (probe.reason === "no_capability") return { ok: false, reason: "no_capability" };

  const serverLog = await server.log();
  const r = reconcile(padLog(), serverLog, { held: engine.held, pending: engine.pending });
  // A finished match takes nothing more, but the comparison still says
  // whether this device's log is all on the server (SCRBRD-079).
  if (probe.reason === "match_complete") return { ok: false, reason: "match_complete", reconcile: r };
  if (r.state === "fork") return { ok: false, reason: "fork", reconcile: r };

  // What the server has is sent, as far as this device is concerned: marked
  // before the pad can show it, so it is never queued (SCRBRD-075) — and for
  // a device that queued events before the markers existed, its own old
  // events are marked here, the first time it compares (SCRBRD-079).
  await engine.markSent(serverLog.map((e) => e?.id).filter((id) => id != null));
  if (r.state === "behind" && (await adopt(padLogFrom(serverLog))) === false) {
    return { ok: false, reason: "busy", reconcile: r };
  }
  if (r.orphans.length && restore) await restore(r.orphans);

  // Somebody claimed this match after this device last held it. A person
  // may take it from them (the database still refuses a live lease); a pad
  // that reopened by itself does not.
  const movedOn = !probe.ok && probe.state === "active" && probe.epoch != null && probe.epoch !== engine.heldEpoch;
  if (movedOn && intent !== "open") return { ok: false, reason: "moved_on", reconcile: r };

  const c = await server.claim();
  if (!c.ok || c.epoch == null) return { ok: false, reason: c.reason ?? "claim_refused", reconcile: r };
  await engine.attach(c.epoch, { rebase: true });
  return { ok: true, epoch: c.epoch, adopted: r.state === "behind", restored: r.orphans.length, reconcile: r };
}

// ── The toss (SCRBRD-075) ────────────────────────────────────────

/**
 * Has the pad recorded play in the first innings — anything after the
 * innings_start that names a player or a ball? Once it has, which side bats
 * is not the pad's to change: the scorer watched them bat.
 * @param {PadLog} log
 */
export function playRecorded(log) {
  return (log[0] ?? []).some((e) => e && e.kind !== KIND.INNINGS_START && e.kind !== KIND.VOID)
    || (log[1] ?? []).length > 0;
}

/**
 * How a toss answered on this pad settles against the server (SCRBRD-075).
 *
 *   send     the server has no toss and no event: record this one.
 *   settled  the server has this toss already.
 *   follow   the server has a different toss, and nothing has reached it yet
 *            and nothing on the pad depends on the answer: the pad takes the
 *            server's (and re-opens its innings from it when the side batting
 *            first differs). Never written over in silence.
 *   stop     anything else, in words: the server's toss is frozen (it has
 *            events) and differs, or the pad has recorded play under its own
 *            answer. Nothing more is sent from the pad; a person settles it.
 *            No rule is invented here for which of two tosses is true.
 *
 * @param {object} args
 * @param {PendingToss} args.mine
 * @param {PendingToss|null} args.server
 * @param {boolean} args.serverHasEvents   the match has an event on the server (the toss is frozen)
 * @param {PadLog} args.log
 * @returns {{action: "send"|"settled"|"follow", reason?: undefined} | {action: "stop", reason: "toss_conflict"|"toss_locked"}}
 */
export function tossDecision({ mine, server, serverHasEvents, log }) {
  if (!server) return serverHasEvents ? { action: "stop", reason: "toss_locked" } : { action: "send" };
  if (server.wonBy === mine.wonBy && server.decision === mine.decision) return { action: "settled" };
  if (serverHasEvents || playRecorded(log)) return { action: "stop", reason: "toss_conflict" };
  return { action: "follow" };
}

/** @param {PendingToss|null|undefined} t */
const tossLine = (t, home = "the home side", away = "the away side") => {
  if (!t) return "no toss";
  const won = t.wonBy === "home" ? home : away;
  const first = battingFirst(t) === "home" ? home : away;
  return `${won} won the toss and chose to ${t.decision} (${first} bat first)`;
};
export { tossLine };

// ── In words ─────────────────────────────────────────────────────

/** @param {number} n */
const balls = (n) => `${n} ball${n === 1 ? "" : "s"}`;

/**
 * What is waiting on this device, in a phrase a scorer reads: "5 balls",
 * "2 balls and 1 other change", "3 changes to the scorebook".
 * @param {{payload?: any}[]} pending
 * @returns {string}
 */
export function waitingPhrase(pending) {
  const b = pending.filter((e) => (e.payload?.kind ?? "ball") === KIND.BALL).length;
  const other = pending.length - b;
  if (b && other) return `${balls(b)} and ${other} other change${other === 1 ? "" : "s"}`;
  if (b) return balls(b);
  return `${other} change${other === 1 ? "" : "s"} to the scorebook`;
}
