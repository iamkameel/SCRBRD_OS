import { useCallback, useEffect, useMemo, useState } from "react";
import { api, signedIn } from "../../lib/api.js";
import { readLive } from "../../lib/live.js";
import { profile } from "../../lib/session.js";
import { conditionsState, liftCounts, termsFromConditions } from "../../lib/cockpit.js";
import { evaluate, isSeen, see, unseen } from "../../lib/signals.js";

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
 * @param {{match: any, gate: ReturnType<typeof import("../../lib/cockpit.js").cockpitGate>, lifts?: boolean, matchups?: boolean, seen?: unknown}} o
 *   `seen`: what the match's log has grown to; the live reads are made again when it moves.
 */
export function useCockpit({ match, gate, lifts = false, matchups = false, seen = 0 }) {
  const [reads, setReads] = useState(/** @type {Record<string, any>} */ ({}));
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    const q = { matchId: /** @type {string} */ (id) };
    (async () => {
      const squad = await readLive("match_squad", q);
      const sheet = (squad ?? []).filter((r) => r.side === end && !r.twelfth);
      const [readiness, workload, spells, phases, trips, duties, officials, pitch, weather, conditions, notices, opposition, directives,
        liftRows, liftExc] = await Promise.all([
        panels.side ? readLive("readiness", q) : null,
        panels.load ? readLive("workload", teamCode ? { teamCode } : null) : null,
        panels.load ? readLive("bowling_spells", q) : null,
        match.status !== "upcoming" ? readLive("phases", q) : null,
        panels.bus ? readLive("trips", q) : null,
        panels.day ? readLive("match_duties", q) : null,
        panels.day ? readLive("officials", q) : null,
        panels.day ? readLive("pitch_report", q) : null,
        panels.day ? readLive("weather") : null,
        panels.day ? api(`/api/matches/${id}/playing-conditions`).catch(() => null) : null,
        readLive("notifications"),
        panels.opposition ? readLive("opposition_context", q) : null,
        panels.day ? readLive("bowling_directives") : null,
        lifts && panels.lifts ? api(`/api/matches/${id}/lifts/expected`).then((r) => r.rows ?? []).catch(() => null) : null,
        lifts && panels.liftOffice && school ? api(`/api/lifts/exceptions?schoolId=${school}&matchId=${id}`).then((r) => r.rows ?? []).catch(() => null) : null,
      ]);
      // Our boys against pace and spin: one read per boy on the sheet, with its coverage beside it.
      let by = null;
      if (matchups && panels.matchups && squad) {
        const pairs = await Promise.all(sheet.map(async (r) => {
          const [rows, cov] = await Promise.all([readLive("matchups", { batterId: r.playerId }), readLive("matchup_coverage", { batterId: r.playerId })]);
          return [r.playerId, rows ? { rows, coverage: cov?.[0] ? { attributable: cov[0].attributable, deliveries: cov[0].deliveries } : null } : null];
        }));
        by = Object.fromEntries(pairs.filter(([, v]) => v));
      }
      if (cancelled) return;
      setReads({
        squad, readiness, workload, spells, phases, trips, duties, officials,
        pitch: pitch?.[0] ?? null,
        weather: weather ? weather.find((w) => w.matchId === id) ?? null : null,
        conditionsRaw: conditions, conditions: panels.day ? conditionsState(conditions) : null,
        terms: termsFromConditions(conditions),
        notices, opposition: opposition?.[0] ?? null, directives,
        lifts: liftRows == null ? null : liftRows, liftExceptions: liftExc, matchups: by,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, id, match?.status, end, school, teamCode, can, lifts, matchups]);

  // The live reads: the spells and the week's load move as the match is played.
  useEffect(() => {
    if (!on || !live || !panels?.load) return undefined;
    let cancelled = false;
    const q = { matchId: /** @type {string} */ (id) };
    const t = setTimeout(async () => {
      const [spells, workload] = await Promise.all([readLive("bowling_spells", q), readLive("workload", teamCode ? { teamCode } : null)]);
      if (!cancelled) setReads((r) => ({ ...r, spells: spells ?? r.spells, workload: workload ?? r.workload }));
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, live, id, teamCode, seen, can]);

  return { reads, loading, on };
}

/**
 * The feed over those reads, and what this person has seen of it (D13).
 * `fielding` and `capFor` come from the fold, where the tab has one; the
 * dashboard's card has none and the two bowler rules draw nothing there.
 *
 * @param {{match: any, gate: any, cockpit: ReturnType<typeof useCockpit>, fielding?: {inn: any, i: number, inPlay: boolean}[], capFor?: ((balls: number) => string | null) | null}} o
 */
export function useFeed({ match, gate, cockpit, fielding = [], capFor = null }) {
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
      matchups: reads.matchups ?? null, fielding, capFor,
    });
  }, [now, match, gate, loading, reads, fielding, capFor]);

  const person = profile()?.user?.id ?? null;
  const [seen, setSeen] = useState(() => loadSeen(person));
  const dismiss = useCallback((card) => {
    setSeen((prev) => { const next = see(prev, card); saveSeen(person, next); return next; });
  }, [person]);
  const open = useMemo(() => unseen(cards, seen), [cards, seen]);
  return { cards, open, seenCount: cards.length - open.length, dismiss, isSeen: (/** @type {any} */ c) => isSeen(c, seen), now };
}

// ── "Seen", per person, on this device (D13; signal_ack is phase B) ──
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
