/**
 * A second account: two phones' books of one match, side by side.
 * docs/design/TWO_PHONES.md, slice 2 (R4–R6).
 *
 * The pen-holder's book is the match's book (`ball_event`); a phone that
 * scored under a pen it did not hold kept a second scorer's book, set aside
 * whole in `ball_event_quarantine` and never merged. This module lines the
 * two up so a person who kept neither book can decide each difference, and
 * offers the three decisions of R5:
 *
 *   1. Pen stands            the set-aside ball is rejected, with the pen's
 *                            ball it was compared with and a note. Every row
 *                            that agrees closes in one tap.
 *   2. Pen missed this ball  the existing release (POST /api/quarantine/:id/
 *                            resolve, accept): the Laws judged, written at
 *                            the END of the log (db/14's standing behaviour).
 *   3. The other phone was right
 *                            an amendment of the pen's ball is asked for
 *                            (scoring.amend.request; another hand approves it
 *                            under db/38's lock) and the set-aside ball is
 *                            rejected with the amendment's id in its note.
 *                            Never a swap: ball_event is never edited.
 *
 * Every decision goes through quarantine_resolve() (db/136), which checks its
 * own authority — scoring.amend.approve over the match, not the sender
 * (cannot_release_your_own), not the scorer of any live ball in the match
 * (you_scored_this_match) — and writes the scoring_audit row. Nothing here
 * widens a read: the reads run under the caller's own policies.
 *
 * THE ALIGNMENT (R5) folds each book separately with the same fold the
 * server judges and replays by (foldSteps(), deriveInnings()'s fold, event by
 * event), and lines them up by innings and legal-ball ordinal, each extra
 * attached to the legal ball before it. The second phone's book is the pen's
 * log as that phone last shared it — every event written at an epoch no later
 * than the one it scored under (R2: where the pen passed) — followed by its
 * set-aside events in the order it recorded them. It is a reading aid; the
 * decision is the person's. Folds run here, in the API, as the Laws do; SQL
 * never folds.
 *
 *   GET  /api/matches/:id/second-account
 *   POST /api/matches/:id/second-account/pen-stands        {ids, note?}
 *   POST /api/matches/:id/second-account/other-phone-right {ids, note}
 */
import { foldSteps, fromRow, DISMISSAL_LABEL } from "@scrbrd/scoring";
import { runAsPrincipal } from "../auth/auth-db.mjs";
import { EVENT_COLUMNS, matchFoldContext, heldColumns } from "./events-api.mjs";
/** @import { Pool, IdHandler, IdRequest, RouteDeps } from "../api-types.mjs" */

/** Six balls an over, as the fold counts them (fmtOvers()). */
const BPO = 6;

/**
 * A legal ball's place as over.ball ("8.3"); ordinal 0 is before the first.
 * @param {number} k  legal balls bowled, this one included
 */
export const ballLabel = (k) => (k <= 0 ? "start" : `${Math.floor((k - 1) / BPO)}.${((k - 1) % BPO) + 1}`);

/** The ball that comes after `k` legal balls: where an extra after ball k is bowled. @param {number} k */
const nextLabel = (k) => `${Math.floor(k / BPO)}.${(k % BPO) + 1}`;

/**
 * What a delivery says, for comparing two books: the scoring facts only.
 * Where a shot went, its zone and how it was captured are not part of the
 * book; two scorers who agree on the runs, the wicket and who faced whom agree.
 * @param {any} ev
 */
const facts = (ev) => JSON.stringify([ev.kind, ev.type ?? null, ev.value ?? null, ev.striker ?? null, ev.bowler ?? null,
  ev.dismissed ?? null, ev.dismissal ?? null, ev.nbRuns ?? null, ev.notInOver ?? null]);

/** Is this event a delivery? @param {any} ev */
const isDelivery = (ev) => (ev?.kind ?? "ball") === "ball";

/**
 * A delivery in words, with no person named: the reviewer compares runs,
 * wickets and extras; who faced and who bowled are said only as "differs".
 * @param {any} ev
 */
export function deliveryWords(ev) {
  if (!ev) return "—";
  if (!isDelivery(ev)) return ev.kind === "bowler" ? "Bowler named" : ev.kind === "batters" ? "Batters named" : String(ev.kind ?? "event").replace(/_/g, " ");
  const n = ev.value ?? 0, runs = `${n} run${n === 1 ? "" : "s"}`;
  switch (ev.type) {
    case "W":  return `Wicket — ${DISMISSAL_LABEL[/** @type {keyof typeof DISMISSAL_LABEL} */ (ev.dismissal)] ?? ev.dismissal ?? "unspecified"}`;
    case "Wd": return n ? `Wide + ${runs}` : "Wide";
    case "Nb": return n ? `No ball + ${runs}` : "No ball";
    case "B":  return `Bye, ${runs}`;
    case "LB": return `Leg bye, ${runs}`;
    default:   return n === 0 ? "Dot ball" : runs;
  }
}

/**
 * One book, folded innings by innings, cut into slots: slot k of an innings
 * is legal ball k and everything after it until the next legal ball (extras,
 * a bowler named, batters in); slot 0 is everything before the first.
 * Events the fold skips (a void, and what it undoes) keep their place in the
 * slot of the event before them, so a set-aside void is still decided.
 * @param {any[]} events  the book, in order
 * @param {any} ctx  the match's FoldContext
 */
function slotted(events, ctx) {
  /** @type {Map<number, any[]>} */
  const byInnings = new Map();
  for (const ev of events) {
    const i = ev.innings ?? 0;
    if (!byInnings.has(i)) byInnings.set(i, []);
    /** @type {any[]} */ (byInnings.get(i)).push(ev);
  }
  /** @type {Map<number, {slots: Map<number, {all: any[], live: any[]}>, totals: {runs: number, wickets: number, balls: number}}>} */
  const out = new Map();
  for (const [inningsNo, evs] of [...byInnings.entries()].sort((a, b) => a[0] - b[0])) {
    /** @type {Map<number, {all: any[], live: any[]}>} */
    const slots = new Map();
    const slot = (/** @type {number} */ k) => {
      if (!slots.has(k)) slots.set(k, { all: [], live: [] });
      return /** @type {{all: any[], live: any[]}} */ (slots.get(k));
    };
    /** @type {Map<any, number>} where each event the fold applied landed */
    const at = new Map();
    let balls = 0;
    const steps = foldSteps(evs, { ctx });
    let r = steps.next();
    while (!r.done) {
      const { ev, inn } = r.value;
      if (isDelivery(ev) && inn.balls > balls) balls = inn.balls;
      at.set(ev, balls);
      r = steps.next();
    }
    const settled = r.value;
    // Every event, in the book's order: the fold's place for those it
    // applied, the place before them for those it skipped.
    let last = 0;
    for (const ev of evs) {
      const applied = at.has(ev);
      const k = applied ? /** @type {number} */ (at.get(ev)) : last;
      last = k;
      const s = slot(k);
      s.all.push(ev);
      if (applied && isDelivery(ev)) s.live.push(ev);
    }
    out.set(inningsNo, { slots, totals: { runs: settled?.runs ?? 0, wickets: settled?.wickets ?? 0, balls: settled?.balls ?? 0 } });
  }
  return out;
}

/**
 * @typedef {object} HeldEvent
 * @property {number | string} id          ball_event_quarantine.id
 * @property {any} event                   the set-aside event as a LogEvent (id = its key)
 * @property {string | null} resolution    null while it waits
 */

/**
 * @typedef {object} AlignedRow
 * @property {string} key                 innings:ordinal
 * @property {number} innings
 * @property {number} ordinal             legal balls bowled at this slot's ball (0: before the first)
 * @property {string} ball                over.ball, or "start"
 * @property {"agrees" | "differs" | "missing"} status   missing: the pen has no ball here
 * @property {{key: string, words: string}[]} pen        the pen's deliveries at this slot
 * @property {{key: string, words: string, heldId: number | string | null}[]} other   the second phone's
 * @property {(number | string)[]} heldIds   the set-aside rows still open in this slot, in the phone's order
 * @property {Record<string, string | null>} counterparts  per open held id: the pen's ball it is compared with
 * @property {string | null} amendTarget   the pen's ball an amendment would correct ("the other phone was right")
 * @property {string[]} differsIn          what differs, in words that name nobody
 * @property {boolean} afterDrift          at or after the ball where the accounts stop lining up
 */

/**
 * Line the pen's book up against one second account.
 * @param {{pen: any[], prefix: any[], held: HeldEvent[], ctx?: any}} a
 *   pen     the match's log, as LogEvents in seq order
 *   prefix  the part of it the second phone shared (written at an epoch no
 *           later than the one it scored under)
 *   held    the second phone's set-aside events, in the order it recorded them
 * @returns {{rows: AlignedRow[], drift: {innings: number, ordinal: number, ball: string} | null,
 *            totals: {pen: {innings: number, runs: number, wickets: number, balls: number}[],
 *                     other: {innings: number, runs: number, wickets: number, balls: number}[]}}}
 */
export function alignAccounts({ pen, prefix, held, ctx = {} }) {
  // The second book: the shared prefix, then the phone's own events (one of
  // which the pen may hold too, by key — released, or re-sent live).
  const seen = new Set(prefix.map((e) => e.id));
  /** @type {Map<any, HeldEvent>} */
  const heldOf = new Map();
  const other = [...prefix];
  for (const h of held) {
    if (h.event?.id != null && seen.has(h.event.id)) continue;
    other.push(h.event);
    heldOf.set(h.event, h);
  }
  const P = slotted(pen, ctx), O = slotted(other, ctx);

  /** @type {AlignedRow[]} */
  const rows = [];
  /** @type {{innings: number, ordinal: number, ball: string} | null} */
  let drift = null;
  for (const [inningsNo, o] of O) {
    for (const [k, os] of [...o.slots.entries()].sort((a, b) => a[0] - b[0])) {
      const open = os.all.filter((ev) => heldOf.get(ev)?.resolution == null && heldOf.has(ev));
      if (!open.length) continue;
      const ps = P.get(inningsNo)?.slots.get(k) ?? null;
      const penLive = ps?.live ?? [], otherLive = os.live;
      const status = !ps || (penLive.length === 0 && otherLive.length > 0) ? "missing"
        : (penLive.length === otherLive.length && penLive.every((e, i) => facts(e) === facts(otherLive[i]))) ? "agrees" : "differs";
      // The accounts stop lining up where one book has a delivery in a slot
      // the other does not AND the next ball differs too: a wide one phone
      // scored as a dot puts every legal ball after it one out. (A wide one
      // phone simply missed leaves the next ball in line: that slot differs,
      // nothing drifts.) Said once, at the first such slot.
      if (!drift && ps && penLive.length > 0 && penLive.length !== otherLive.length) {
        const pn = P.get(inningsNo)?.slots.get(k + 1)?.live ?? [], on = o.slots.get(k + 1)?.live ?? [];
        if (pn.length && on.length && (pn.length !== on.length || pn.some((e, i) => facts(e) !== facts(on[i])))) {
          drift = { innings: inningsNo, ordinal: k, ball: nextLabel(k) };
        }
      }
      /** @type {string[]} */
      const differsIn = [];
      if (status === "differs") {
        if (penLive.length !== otherLive.length) differsIn.push("the number of deliveries");
        const n = Math.min(penLive.length, otherLive.length);
        for (let i = 0; i < n; i++) {
          const a = penLive[i], b = otherLive[i];
          if (a.type !== b.type || (a.value ?? null) !== (b.value ?? null) || (a.nbRuns ?? null) !== (b.nbRuns ?? null)) differsIn.push("runs or extras");
          if ((a.dismissal ?? null) !== (b.dismissal ?? null) || (a.dismissed ?? null) !== (b.dismissed ?? null)) differsIn.push("the wicket");
          if ((a.striker ?? null) !== (b.striker ?? null)) differsIn.push("who faced");
          if ((a.bowler ?? null) !== (b.bowler ?? null)) differsIn.push("who bowled");
          if ((a.notInOver ?? null) !== (b.notInOver ?? null)) differsIn.push("whether it counted in the over");
        }
      }
      /** @type {Record<string, string | null>} */
      const counterparts = {};
      for (const ev of open) {
        const i = otherLive.indexOf(ev);
        const c = (i >= 0 ? penLive[i] : null) ?? penLive[0] ?? null;
        counterparts[String(/** @type {HeldEvent} */ (heldOf.get(ev)).id)] = c?.id ?? null;
      }
      // The pen's ball an amendment would correct: the first that differs.
      let amendTarget = null;
      if (status === "differs") {
        const i = penLive.findIndex((e, j) => !otherLive[j] || facts(e) !== facts(otherLive[j]));
        amendTarget = (i >= 0 ? penLive[i] : penLive[0])?.id ?? null;
      }
      rows.push({
        key: `${inningsNo}:${k}`, innings: inningsNo, ordinal: k, ball: ballLabel(k), status,
        pen: penLive.map((e) => ({ key: e.id, words: deliveryWords(e) })),
        other: otherLive.map((e) => ({ key: e.id, words: deliveryWords(e), heldId: heldOf.get(e)?.id ?? null })),
        heldIds: open.map((ev) => /** @type {HeldEvent} */ (heldOf.get(ev)).id),
        counterparts, amendTarget, differsIn: [...new Set(differsIn)], afterDrift: false,
      });
    }
  }
  // A set-aside event whose key the pen's book already holds but which says
  // something else (db/37 left it open: same key, other content). It is not
  // a second account of a ball the pen lacks; it is decided against the
  // pen's event of that key, where that event stands.
  for (const h of held) {
    if (h.resolution != null || h.event?.id == null || !seen.has(h.event.id)) continue;
    for (const [inningsNo, p] of P) for (const [k, ps] of p.slots) {
      const twin = ps.all.find((e) => e.id === h.event.id);
      if (!twin) continue;
      const same = facts(twin) === facts(h.event);
      rows.push({
        key: `${inningsNo}:${k}:${h.id}`, innings: inningsNo, ordinal: k, ball: ballLabel(k), status: same ? "agrees" : "differs",
        pen: [{ key: twin.id, words: deliveryWords(twin) }], other: [{ key: h.event.id, words: deliveryWords(h.event), heldId: h.id }],
        heldIds: [h.id], counterparts: { [String(h.id)]: twin.id }, amendTarget: same ? null : twin.id,
        differsIn: same ? [] : ["the same ball, recorded twice"], afterDrift: false,
      });
    }
  }
  rows.sort((a, b) => a.innings - b.innings || a.ordinal - b.ordinal);
  if (drift) {
    const d = drift;
    for (const r of rows) if (r.innings === d.innings && r.ordinal >= d.ordinal) r.afterDrift = true;
  }
  const totals = (/** @type {typeof P} */ m) => [...m.entries()].map(([innings, x]) => ({ innings, ...x.totals }));
  return { rows, drift, totals: { pen: totals(P), other: totals(O) } };
}

/**
 * Read a match's two books and line up every second account in it, one per
 * device that sent set-aside balls, as the caller's own policies show them.
 * @param {import("../api-types.mjs").Db} client  @param {string} matchId
 */
async function readAccounts(client, matchId) {
  const { rows: log } = await client.query(
    `select ${EVENT_COLUMNS} from ball_event where match_id = $1 order by seq`, [matchId]);
  const { rows: held } = await client.query(
    `select q.id, q.device_id, q.scorer_user_id, u.name as sender_name, q.submitted_epoch, q.current_epoch,
            q.idempotency_key, q.body, q.quarantined_at, q.resolution, (q.scorer_user_id = app_user_id()) as mine
       from ball_event_quarantine q
       left join app_user u on u.id = q.scorer_user_id
      where q.match_id = $1
      order by q.device_id, coalesce((q.body->>'clientSeq')::bigint, 0), q.quarantined_at, q.id`, [matchId]);
  const ctx = await matchFoldContext(client, matchId);
  const pen = log.map(fromRow);
  /** @type {Map<string, any[]>} */
  const byDevice = new Map();
  for (const h of held) {
    if (!byDevice.has(h.device_id)) byDevice.set(h.device_id, []);
    /** @type {any[]} */ (byDevice.get(h.device_id)).push(h);
  }
  const accounts = [];
  for (const [deviceId, hs] of byDevice) {
    // Where the pen passed (R2): the log as this phone last shared it.
    const epoch = Math.min(...hs.map((h) => h.submitted_epoch ?? 0));
    const prefix = log.filter((r) => r.epoch <= epoch).map(fromRow);
    const heldEvents = hs.map((h) => ({
      id: h.id, resolution: h.resolution,
      event: fromRow({ ...heldColumns(matchId, h.body, { lenient: true }), idempotency_key: h.idempotency_key ?? h.body?.idempotencyKey }),
    }));
    const a = alignAccounts({ pen, prefix, held: heldEvents, ctx });
    const open = hs.filter((h) => h.resolution == null);
    accounts.push({
      deviceId, sender: hs[0]?.sender_name ?? null, mine: hs.some((h) => h.mine === true),
      submittedEpoch: epoch, currentEpoch: hs[hs.length - 1]?.current_epoch ?? null,
      open: open.length, decided: hs.length - open.length, ...a,
    });
  }
  return accounts;
}

/** @param {string} code @param {number} [status] */
const err = (code, status = 400) => Object.assign(new Error(code), { status });

/**
 * The note a decision carries, trimmed; db/136 keeps at most 1000 characters.
 * @param {unknown} v
 */
const noteOf = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1000) : null);

/**
 * The open set-aside rows named, each found in a row of this match's
 * alignment, or a refusal. `rows` is every account's rows.
 * @param {any[]} accounts @param {unknown} ids
 */
function find(accounts, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw err("ids_required");
  const want = ids.map(String);
  /** @type {Map<string, {row: AlignedRow}>} */
  const where = new Map();
  for (const a of accounts) for (const r of a.rows) for (const id of r.heldIds) where.set(String(id), { row: r });
  const missing = want.filter((id) => !where.has(id));
  if (missing.length) return { refused: { ok: false, reason: "not_open_here", ids: missing } };
  return { found: want.map((id) => ({ id, row: /** @type {{row: AlignedRow}} */ (where.get(id)).row })) };
}

/**
 * @param {RouteDeps} deps
 * @returns {{read: IdHandler, penStands: IdHandler, otherPhoneRight: IdHandler}}
 */
export function secondAccountRoutes({ pool, secret }) {
  /** @param {(req: IdRequest) => Promise<unknown>} fn @returns {IdHandler} */
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (/** @type {any} */ e) {
      if (e.refusal) return res.json(e.refusal);
      const status = e.code === "42501" ? 403 : e.code === "22P02" ? 404 : (e.status || 500);
      res.status(status).json({ error: e.code === "42501" ? "not_permitted" : e.code === "22P02" ? "not_found" : (e.message || "error") });
    }
  };
  /**
   * Who is reading: gated as the quarantine's own door is gated — the
   * approval capability over this match (scoring.amend.approve) — and what
   * the screen should say to him.
   * @param {import("../api-types.mjs").Db} client @param {string} matchId
   */
  const viewer = async (client, matchId) => {
    const { rows } = await client.query(
      `select app_can('scoring.amend.approve', match_school($1), match_team($1), NULL, $1) as may,
              app_can('scoring.amend.request', match_school($1), match_team($1), NULL, $1) as may_request,
              exists (select 1 from ball_event_live b where b.match_id = $1 and b.scorer_user_id = app_user_id()) as scored`,
      [matchId]);
    const v = rows[0] ?? {};
    if (v.may !== true) throw err("not_permitted", 403);
    return { mayDecide: true, mayRequest: v.may_request === true, scoredThisMatch: v.scored === true };
  };
  /**
   * Resolve each named row through quarantine_resolve() as "pen stands",
   * inside the caller's one transaction; the first refusal rolls them all back.
   * @param {import("../api-types.mjs").Db} client
   * @param {{id: string, row: AlignedRow}[]} found @param {(r: AlignedRow, id: string) => string | null} note
   */
  const reject = async (client, found, note) => {
    for (const { id, row } of found) {
      const { rows } = await client.query(`select * from quarantine_resolve($1, false, null, $2, $3)`,
        [id, note(row, id), row.counterparts[id] ?? null]);
      const out = rows[0];
      if (!out?.ok) throw Object.assign(new Error("refused"), { refusal: { ok: false, reason: out?.reason ?? "no_result", id } });
    }
  };
  return {
    // GET /matches/:id/second-account
    read: handle(async (req) => runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
      const v = await viewer(client, req.params.id);
      const accounts = await readAccounts(client, req.params.id);
      return { matchId: req.params.id, viewer: v, accounts, open: accounts.reduce((n, a) => n + a.open, 0) };
    })),

    // POST /matches/:id/second-account/pen-stands {ids, note?}
    //   → {ok: true, closed} | {ok: false, reason, id?|ids?}   (nothing decided)
    // A row that agrees needs no note ("Both accounts agree"); one that
    // differs, or the pen has no ball for, needs the reviewer's reason.
    penStands: handle(async (req) => runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
      await viewer(client, req.params.id);
      const f = find(await readAccounts(client, req.params.id), req.body?.ids);
      if (f.refused) return f.refused;
      const found = /** @type {{id: string, row: AlignedRow}[]} */ (f.found);
      const note = noteOf(req.body?.note);
      if (!note && found.some(({ row }) => row.status !== "agrees")) return { ok: false, reason: "note_required" };
      await reject(client, found, (row) => note ?? (row.status === "agrees" ? "Both accounts agree" : null));
      return { ok: true, closed: found.length };
    })),

    // POST /matches/:id/second-account/other-phone-right {ids, note}
    //   → {ok: true, amendmentId, closed} | {ok: false, reason, id?}   (nothing asked, nothing decided)
    // The rows named are one ball's (one slot). An amendment of the pen's
    // ball is asked for as the amendment route asks (the table's INSERT
    // policy: scoring.amend.request), or the one already pending on that ball
    // is named; then each row is rejected with the amendment in its note.
    otherPhoneRight: handle(async (req) => runAsPrincipal(pool, secret, req.headers?.authorization, async (client) => {
      await viewer(client, req.params.id);
      const f = find(await readAccounts(client, req.params.id), req.body?.ids);
      if (f.refused) return f.refused;
      const found = /** @type {{id: string, row: AlignedRow}[]} */ (f.found);
      const note = noteOf(req.body?.note);
      if (!note) return { ok: false, reason: "note_required" };
      if (new Set(found.map(({ row }) => row.key)).size !== 1) return { ok: false, reason: "one_ball_at_a_time" };
      const target = found[0].row.amendTarget;
      if (!target) return { ok: false, reason: "no_counterpart" };
      await client.query("savepoint other_phone_right");
      /** @type {string | null} */
      let amendmentId = null;
      try {
        const { rows } = await client.query(
          `insert into scoring_amendment (match_id, school_id, target_key, reason, requested_by)
           select $1, m.school_id, $2, $3, app_user_id() from match m where m.id = $1
           returning id`,
          [req.params.id, target, `Second account: ${note}`.slice(0, 1000)]);
        amendmentId = rows[0]?.id ?? null;
        await client.query("release savepoint other_phone_right");
      } catch (/** @type {any} */ e) {
        await client.query("rollback to savepoint other_phone_right");
        if (e.code === "42501") return { ok: false, reason: "cannot_request" };
        if (e.code !== "23505") throw e;
        // One pending amendment of a ball at a time (db/02): name that one.
        const { rows } = await client.query(
          `select id from scoring_amendment where match_id = $1 and target_key = $2 and state = 'pending'`,
          [req.params.id, target]);
        amendmentId = rows[0]?.id ?? null;
      }
      if (!amendmentId) return { ok: false, reason: "cannot_request" };
      await reject(client, found, () => `${note} · amendment ${amendmentId}`);
      return { ok: true, amendmentId, closed: found.length };
    })),
  };
}
