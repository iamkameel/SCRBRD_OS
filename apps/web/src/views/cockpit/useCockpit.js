import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, signedIn } from "../../lib/api.js";
import { readLive } from "../../lib/live.js";
import { profile } from "../../lib/session.js";
import { conditionsState, liftCounts, saDay, termsFromConditions } from "../../lib/cockpit.js";
import { evaluate, isSeen, markSeen, unseen } from "../../lib/signals.js";

/**
 * THE COCKPIT'S READS (SCRBRD-136 phase A): every read the Coach tab, the
 * Dashboard's match-day card and the feed's rules are drawn from, made once
 * for the fixture and shared by the three. Each is a read that already exists;
 * each is asked only if the gate granted the panel that needs it, and the
 * server decides again what comes back.
 *
 * A read that did not answer is `null`, not `[]`: a rule over a failed read
 * does not fire, and a panel says the read failed rather than that nothing is
 * there. Two reads are LOGGED by the database (lift_expected, lift_exceptions,
 * db/76) and so are made only when the caller asks for them (`lifts`): when
 * the coach opens his tab or the feed, or on the dashboard on the match day.
 *
 * Nothing here writes. Nothing here is authority.
 *
 * WHEN EACH READ ANSWERED (GA-I27 §4.1): `reads.at[name]` is the moment each
 * read's rows arrived, by the read's own name, kept beside the rows so a
 * card's evidence trail can say "as at 14:02". A read that failed has no time.
 *
 * @param {{match: any, gate: ReturnType<typeof import("../../lib/cockpit.js").cockpitGate>, lifts?: boolean, matchups?: boolean, seen?: unknown}} o
 *   `seen`: what the match's log has grown to; the live reads are made again when it moves.
 */
export function useCockpit({ match, gate, lifts = false, matchups = false, seen = 0 }) {
  const [reads, setReads] = useState(/** @type {Record<string, any>} */ ({}));
  const [loading, setLoading] = useState(true);
  // `reload()` asks for the static reads again (the sheet has just been named):
  // the panels keep what they show until the new answer lands, rather than blank.
  const [again, setAgain] = useState(0);
  const quiet = useRef(false);
  const reload = useCallback(() => { quiet.current = true; setAgain((n) => n + 1); }, []);
  const id = match?.id;
  const live = match?.status === "live";
  const on = !!gate && !!id && signedIn();
  const panels = gate?.panels;
  const end = gate?.end;
  const school = gate?.school;
  const teamCode = gate?.teamCode;
  const can = JSON.stringify(panels ?? {});

  // The static reads: made when the fixture, its status or the reader's grant changes.
  useEffect(() => {
    if (!on || !panels) { setReads({}); setLoading(false); return undefined; }
    let cancelled = false;
    if (quiet.current) quiet.current = false; else setLoading(true);
    const q = { matchId: /** @type {string} */ (id) };
    /** @type {Record<string, number>} */
    const at = {};
    /** The read's rows, its answer time noted under its name; a read that failed (null) has none. @template T @param {string} name @param {Promise<T> | null} p @returns {Promise<T | null>} */
    const timed = (name, p) => (p == null ? Promise.resolve(null) : p.then((r) => { if (r != null) at[name] = Date.now(); return r; }));
    (async () => {
      const squad = await timed("match_squad", readLive("match_squad", q));
      const sheet = (squad ?? []).filter((r) => r.side === end && !r.twelfth);
      const [readiness, workload, spells, phases, trips, duties, officials, pitch, weather, conditions, notices, opposition, directives,
        liftRows, liftExc] = await Promise.all([
        panels.side ? timed("readiness", readLive("readiness", q)) : null,
        panels.load ? timed("workload", readLive("workload", teamCode ? { teamCode } : null)) : null,
        panels.load ? timed("bowling_spells", readLive("bowling_spells", q)) : null,
        match.status !== "upcoming" ? readLive("phases", q) : null,
        panels.bus ? timed("trips", readLive("trips", q)) : null,
        panels.day ? timed("match_duties", readLive("match_duties", q)) : null,
        panels.day ? readLive("officials", q) : null,
        panels.day ? readLive("pitch_report", q) : null,
        panels.day ? timed("weather", readLive("weather")) : null,
        panels.day ? timed("playing-conditions", api(`/api/matches/${id}/playing-conditions`).catch(() => null)) : null,
        timed("notifications", readLive("notifications")),
        panels.opposition ? readLive("opposition_context", q) : null,
        panels.day ? readLive("bowling_directives") : null,
        lifts && panels.lifts ? timed("lift_expected", api(`/api/matches/${id}/lifts/expected`).then((r) => r.rows ?? []).catch(() => null)) : null,
        lifts && panels.liftOffice && school ? timed("lift_exceptions", api(`/api/lifts/exceptions?schoolId=${school}&matchId=${id}`).then((r) => r.rows ?? []).catch(() => null)) : null,
      ]);
      // Our boys against pace and spin: one read per boy on the sheet, with its coverage beside it.
      let by = null;
      if (matchups && panels.matchups && squad) {
        const pairs = await Promise.all(sheet.map(async (r) => {
          const [rows, cov] = await Promise.all([readLive("matchups", { batterId: r.playerId }), readLive("matchup_coverage", { batterId: r.playerId })]);
          return [r.playerId, rows ? { rows, coverage: cov?.[0] ? { attributable: cov[0].attributable, deliveries: cov[0].deliveries } : null } : null];
        }));
        by = Object.fromEntries(pairs.filter(([, v]) => v));
        // One time for the batch: the moment the last boy's two reads answered.
        if (pairs.some(([, v]) => v)) { at.matchups = Date.now(); at.matchup_coverage = at.matchups; }
      }
      if (cancelled) return;
      setReads({
        squad, readiness, workload, spells, phases, trips, duties, officials,
        pitch: pitch?.[0] ?? null,
        weather: weather ? weather.find((w) => w.matchId === id) ?? null : null,
        // The read as it answered (null: it failed), for the card's "could not read the weather"; `weather` above is this fixture's row or none.
        weatherRows: weather,
        conditionsRaw: conditions, conditions: panels.day ? conditionsState(conditions) : null,
        terms: termsFromConditions(conditions),
        notices, opposition: opposition?.[0] ?? null, directives,
        lifts: liftRows == null ? null : liftRows, liftExceptions: liftExc, matchups: by,
        at,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, id, match?.status, end, school, teamCode, can, lifts, matchups, again]);

  // The live reads: the spells and the week's load move as the match is played.
  useEffect(() => {
    if (!on || !live || !panels?.load) return undefined;
    let cancelled = false;
    const q = { matchId: /** @type {string} */ (id) };
    const t = setTimeout(async () => {
      const [spells, workload] = await Promise.all([readLive("bowling_spells", q), readLive("workload", teamCode ? { teamCode } : null)]);
      const now = Date.now();
      if (!cancelled) setReads((r) => ({ ...r, spells: spells ?? r.spells, workload: workload ?? r.workload,
        at: { ...r.at, ...(spells ? { bowling_spells: now } : {}), ...(workload ? { workload: now } : {}) } }));
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, live, id, teamCode, seen, can]);

  return { reads, loading, on, reload };
}

/**
 * A BOY'S OVERS TODAY, ACROSS EVERY MATCH (SCRBRD-136/137 phase B §1.6): the
 * `bowler_day` read (db/94) for S2c, on the Coach tab only and only while our
 * side fields in an innings still in play. Before the match nobody has bowled
 * for us today, and after it the card is not drawn, so it is not read then;
 * the Dashboard's card never reads it (PB-D10). Asked again as the log grows,
 * as the spells and the week are. Only for a reader the gate gave the load
 * panel; the server asks player.workload.read again, per boy.
 *
 * Its own hook, called once `fielding` is known: useCockpit() is called before
 * the tab has a fold, so it takes no `fielding`.
 *
 * `rows` is `null` until it answers, and when it fails: S2c then draws
 * nothing. `at` is when the rows on hand answered (GA-I27 §4.1).
 *
 * @param {{match: any, gate: any, fielding?: {inPlay: boolean}[], seen?: unknown}} o
 * @returns {{rows: any[] | null, at: number | null}}
 */
export function useBowlerDay({ match, gate, fielding = [], seen = 0 }) {
  const [got, setRows] = useState(/** @type {{rows: any[] | null, at: number | null}} */ ({ rows: null, at: null }));
  const inPlay = fielding.some((f) => f.inPlay);
  const on = !!gate?.panels?.load && inPlay && !!match?.id && signedIn();
  const startsAt = Date.parse(String(match?.startsAt ?? ""));
  // The fixture's date on the SA calendar, as bowler_over dates an over (db/54).
  const date = Number.isFinite(startsAt) ? saDay(startsAt) : match?.date ?? null;
  const teamCode = gate?.teamCode ?? null;
  useEffect(() => {
    if (!on || !date) { setRows({ rows: null, at: null }); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await readLive("bowler_day", teamCode ? { date, teamCode } : { date });
      const at = Date.now();
      if (!cancelled) setRows((prev) => (r ? { rows: r, at } : prev));
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [on, date, teamCode, seen]);
  return on ? got : { rows: null, at: null };
}

/**
 * The feed over those reads, and what this person has seen of it (D13).
 * `fielding` and `capFor` come from the fold, and `bowlerDay` from
 * useBowlerDay(), where the tab has them; the dashboard's card has none and
 * the three bowler rules draw nothing there.
 *
 * The evidence trail's time (GA-I27 §4.1): each read's answer time from
 * `reads.at`, the day read's as `dayAt`, and the match's log as `foldAt` with
 * its `head` (the highest `seq` on screen), where the tab has them.
 *
 * @param {{match: any, gate: any, cockpit: ReturnType<typeof useCockpit>, fielding?: {inn: any, i: number, inPlay: boolean}[], capFor?: ((balls: number) => string | null) | null, bowlerDay?: any[] | null, dayAt?: number | null, docDayFor?: ((band: string) => number | null) | null, head?: number | null, foldAt?: number | null}} o
 */
export function useFeed({ match, gate, cockpit, fielding = [], capFor = null, bowlerDay = null, dayAt = null, docDayFor = null, head = null, foldAt = null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  const { reads, loading } = cockpit;
  const cards = useMemo(() => {
    if (!gate || loading) return [];
    return evaluate({
      now, match, gate, squad: reads.squad ?? null, readiness: reads.readiness ?? null, workload: reads.workload ?? null,
      spells: reads.spells ?? null, trips: reads.trips ?? null,
      lifts: reads.lifts != null ? liftCounts(reads.lifts, now) : null,
      liftExceptions: reads.liftExceptions ?? null, weather: reads.weather ?? null, duties: reads.duties ?? null,
      conditions: reads.conditions ?? { state: "failed", cap: null, freeHit: null }, notices: reads.notices ?? null,
      matchups: reads.matchups ?? null, fielding, capFor, bowlerDay, docDayFor,
      at: { ...(reads.at ?? {}), ...(dayAt != null ? { bowler_day: dayAt } : {}), ...(foldAt != null ? { fold: foldAt } : {}) },
      head: head ?? null,
    });
  }, [now, match, gate, loading, reads, fielding, capFor, bowlerDay, dayAt, docDayFor, head, foldAt]);

  const person = profile()?.user?.id ?? null;
  const [seen, setSeen] = useState(() => loadSeen(person));
  const dismiss = useCallback((card) => {
    setSeen((prev) => { const next = markSeen(prev, card); saveSeen(person, next); return next; });
  }, [person]);
  const open = useMemo(() => unseen(cards, seen), [cards, seen]);
  return { cards, open, seenCount: cards.length - open.length, dismiss, isSeen: (/** @type {any} */ c) => isSeen(c, seen), now };
}

// ── "Seen", per person, on this device (D13; signal_ack deferred, phase B PB-D5) ──
const STORE = "scrbrd.signals.seen.";
const memory = /** @type {Record<string, any>} */ ({});
function loadSeen(/** @type {string | null} */ person) {
  const k = STORE + (person ?? "anon");
  try { const raw = globalThis.localStorage?.getItem(k); if (raw) return JSON.parse(raw); } catch { /* storage blocked: memory only */ }
  return memory[k] ?? {};
}
function saveSeen(/** @type {string | null} */ person, /** @type {any} */ seen) {
  const k = STORE + (person ?? "anon");
  memory[k] = seen;
  try { globalThis.localStorage?.setItem(k, JSON.stringify(seen)); } catch { /* memory only */ }
}
