import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, signedIn } from "../../lib/api.js";
import { conditionsState, isMatchDay } from "../../lib/cockpit.js";
import { readOnce, readQuery } from "../../lib/live.js";
import { chooseSchoolFixtures, fixtureRows, groupByDay, headerOf, isQueueReader, liftExceptionRows, officeReader, officeRows } from "../../lib/queue.js";
import { isForbidden, isModuleOff } from "../../lib/readState.js";

/**
 * THE QUEUE'S READS (match-day queue, phase A1; docs/design/GA-I09-I11_match_day_queue.md
 * §5 N2): the reads the cockpit already makes, once for each fixture the
 * school-wide screen draws, and the office's three, with nothing new asked of
 * the server. Each is a read that already exists and is asked only if the
 * reader's single assignment grants the panel that needs it; the database
 * decides again what comes back. Nothing here writes, and nothing here is
 * authority.
 *
 * Leaner than a cockpit per fixture on purpose: the school-wide rows are
 * counts, so the bowlers' week, the opposition, the notices and the lift
 * exceptions (a read the database logs) are not read at all. The lifts are read
 * only on the match day, for a reader who may count them, as the card does.
 *
 * A read that did not answer is `null` with its error beside it, not `[]`: a
 * rule over a failed read does not fire, and the screen says the read failed
 * (I08). A read the database refuses this reader, or a module the school has
 * switched off, is not a failure and says nothing.
 */

/** @param {string} resource @param {Record<string, string> | null} [params] @returns {Promise<{rows: any[] | null, error: string | null}>} */
async function ask(resource, params = null) {
  const r = await readOnce(resource, readQuery(params));
  if (isModuleOff(r) || (r.error && isForbidden(r))) return { rows: [], error: null };
  if (r.error) return { rows: null, error: String(r.error) };
  return { rows: r.rows, error: null };
}

const NOT_ASKED = Promise.resolve({ rows: /** @type {any[] | null} */ (null), error: /** @type {string | null} */ (null) });

/**
 * One fixture's reads.
 * @param {any} match  @param {NonNullable<ReturnType<typeof import("../../lib/queue.js").queueGate>>} gate
 * @param {boolean} lifts  @param {Promise<{rows: any[] | null, error: string | null}>} weather
 */
async function readFixture(match, gate, lifts, weather) {
  const p = gate.panels;
  const q = { matchId: match.id };
  const off = match.calledOff === true;                  // called off: only what is still on record against it
  const [squad, readiness, trips, duties, weatherRead, conditions, liftRows] = await Promise.all([
    !off && (p.team || p.select) ? ask("match_squad", q) : NOT_ASKED,
    !off && p.side ? ask("readiness", q) : NOT_ASKED,
    p.bus ? ask("trips", q) : NOT_ASKED,
    p.day ? ask("match_duties", q) : NOT_ASKED,
    !off && p.day ? weather : NOT_ASKED,
    !off && p.day
      ? api(`/api/matches/${match.id}/playing-conditions`).then((r) => ({ state: conditionsState(r), error: /** @type {string | null} */ (null) }))
          .catch((e) => ({ state: conditionsState(null), error: String(e?.code || "unreachable") }))
      : null,
    !off && lifts && p.lifts
      ? api(`/api/matches/${match.id}/lifts/expected`).then((r) => ({ rows: r.rows ?? [], error: null })).catch((e) => ({ rows: null, error: String(e?.code || "unreachable") }))
      : NOT_ASKED,
  ]);
  return {
    reads: { squad: squad.rows, readiness: readiness.rows, trips: trips.rows, duties: duties.rows, weatherRows: weatherRead.rows,
      conditions: conditions?.state ?? null, lifts: liftRows.rows },
    errors: { squad: squad.error, readiness: readiness.error, trips: trips.error, duties: duties.error, weatherRows: weatherRead.error,
      conditions: conditions?.error ?? null, lifts: liftRows.error },
  };
}

/** How many of the "Later" fixtures one tap reveals (design §2.5: the next eight). */
export const LATER_STEP = 8;
const POOL = 4;

/**
 * The school-wide queue.
 *
 * @param {{matches: any[], assignments: any[] | null | undefined, now: number}} o
 */
export function useQueue({ matches, assignments, now }) {
  const picks = useMemo(() => chooseSchoolFixtures(matches, assignments, now), [matches, assignments, now]);
  const offices = useMemo(() => officeReader(assignments), [assignments]);
  const [laterShown, setLaterShown] = useState(0);
  const wanted = useMemo(() => [...picks.inWindow, ...picks.later.slice(0, laterShown)], [picks, laterShown]);

  const [byId, setById] = useState(/** @type {Record<string, {reads: Record<string, any>, errors: Record<string, string | null>}>} */ ({}));
  const [again, setAgain] = useState(/** @type {Record<string, number>} */ ({}));
  const started = useRef(/** @type {Map<string, string>} */ (new Map()));
  const alive = useRef(true);
  const weatherRead = useRef(/** @type {Promise<{rows: any[] | null, error: string | null}> | null} */ (null));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!signedIn()) return;
    const todo = wanted.filter((p) => started.current.get(p.match.id) !== String(again[p.match.id] ?? 0));
    if (!todo.length) return;
    for (const p of todo) started.current.set(p.match.id, String(again[p.match.id] ?? 0));
    // One weather read for all of them: it is the school's, not the fixture's.
    if (!weatherRead.current && todo.some((p) => p.gate.panels.day)) weatherRead.current = ask("weather");
    const weather = weatherRead.current ?? NOT_ASKED;
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const p = todo[i++];
        const out = await readFixture(p.match, p.gate, isMatchDay(p.match, now), weather);
        if (alive.current) setById((s) => ({ ...s, [p.match.id]: out }));
      }
    };
    for (let w = 0; w < Math.min(POOL, todo.length); w++) worker();
  }, [wanted, again, now]);

  /** Read one fixture's reads again: the same questions, and the weather too. @param {string} matchId */
  const retry = useCallback((matchId) => { weatherRead.current = null; setAgain((a) => ({ ...a, [matchId]: (a[matchId] ?? 0) + 1 })); }, []);

  // ── The office's three reads ──
  const [office, setOffice] = useState(/** @type {{loaded: boolean, requests?: any[] | null, claims?: any[] | null, register: Record<string, any[] | null>, errors: Record<string, string | null>}} */ ({ loaded: false, register: {}, errors: {} }));
  const [officeAgain, setOfficeAgain] = useState(0);
  const needRequests = offices.some((o) => o.may.requests);
  const needClaims = offices.some((o) => o.may.claims);
  const registerKey = offices.filter((o) => o.may.register).map((o) => o.school).join(",");
  useEffect(() => {
    if (!signedIn() || !offices.length) return undefined;
    let cancelled = false;
    (async () => {
      const [requests, claims, ...registers] = await Promise.all([
        needRequests ? ask("role_requests") : NOT_ASKED,
        needClaims ? ask("sign_in_claims") : NOT_ASKED,
        ...offices.filter((o) => o.may.register).map((o) => ask("clearance_register", { schoolId: o.school })),
      ]);
      if (cancelled) return;
      const schools = offices.filter((o) => o.may.register).map((o) => o.school);
      setOffice({ loaded: true, requests: requests.rows, claims: claims.rows,
        register: Object.fromEntries(schools.map((s, i) => [s, registers[i].rows])),
        errors: { requests: requests.error, claims: claims.error, ...Object.fromEntries(schools.map((s, i) => [`register:${s}`, registers[i].error])) } });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRequests, needClaims, registerKey, officeAgain]);

  // ── O6, on a tap: logged by the database, so never on opening ──
  const [lifts, setLifts] = useState(/** @type {Record<string, {loading: boolean, rows: ReturnType<typeof liftExceptionRows> | null, error: string | null}>} */ ({}));
  /** @param {string} school */
  const checkLifts = useCallback(async (school) => {
    setLifts((s) => ({ ...s, [school]: { loading: true, rows: null, error: null } }));
    try {
      const r = await api(`/api/lifts/exceptions?schoolId=${encodeURIComponent(school)}`);
      if (alive.current) setLifts((s) => ({ ...s, [school]: { loading: false, rows: liftExceptionRows(r.rows ?? []), error: null } }));
    } catch (/** @type {any} */ e) {
      if (alive.current) setLifts((s) => ({ ...s, [school]: { loading: false, rows: null, error: String(e?.code || "unreachable") } }));
    }
  }, []);

  const groupsOf = (/** @type {typeof picks.inWindow} */ list) => list.map((p) => fixtureRows({
    match: p.match, gate: p.gate, reads: byId[p.match.id]?.reads, errors: byId[p.match.id]?.errors, now }));
  const groups = useMemo(() => groupsOf(picks.inWindow), [picks, byId, now]);        // eslint-disable-line react-hooks/exhaustive-deps
  const laterGroups = useMemo(() => groupsOf(picks.later.slice(0, laterShown)), [picks, laterShown, byId, now]);   // eslint-disable-line react-hooks/exhaustive-deps
  const officeLists = useMemo(() => offices.map((o) => ({
    ...o,
    ...(office.loaded
      ? { loading: false, ...officeRows({ school: o.school, may: o.may, requests: o.may.requests ? office.requests ?? null : [], claims: o.may.claims ? office.claims ?? null : [],
          register: o.may.register ? office.register[o.school] ?? null : [], now,
          errors: { requests: office.errors.requests ?? null, claims: office.errors.claims ?? null, register: office.errors[`register:${o.school}`] ?? null } }) }
      : { loading: true, rows: [], unread: [], open: 0, failed: 0 }),
  })), [offices, office, now]);

  const header = useMemo(() => {
    const h = headerOf(groups, officeLists);
    return { ...h, loading: h.loading + officeLists.filter((o) => o.loading).length };
  }, [groups, officeLists]);

  return {
    /** Fixtures in the window, grouped by day then team. */
    days: useMemo(() => groupByDay(groups), [groups]),
    groups,
    /** The "Later" fold: how many are in it, which are drawn, and the taps. */
    later: { total: picks.later.length, first: picks.later[0]?.match ?? null, shown: laterShown, groups: laterGroups, days: groupByDay(laterGroups) },
    showLater: () => setLaterShown((n) => Math.min(picks.later.length, n + LATER_STEP)),
    hideLater: () => setLaterShown(0),
    offices: officeLists,
    header,
    retry,
    retryOffice: () => setOfficeAgain((n) => n + 1),
    lifts,
    checkLifts,
    /** Is there anything this reader can be shown at all. */
    reader: isQueueReader(assignments),
  };
}
