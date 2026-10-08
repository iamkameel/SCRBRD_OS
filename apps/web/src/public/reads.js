import { useEffect, useRef, useState } from "react";
import { deriveMatch } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { resultText, teamOf } from "../lib/matchCentre.js";
import { liveSuperOverLine, superOverCommentary } from "../lib/superOver.js";
import { asPublicMatch, foldable, unnamedToPositions } from "./publicLog.js";
import { correctedAt, correctedInnings, correctionsOf, withCorrectionLines } from "../lib/corrections.js";

/**
 * The public reads, shared by the live page (PublicMatch.jsx) and the ground
 * display (display/PublicDisplay.jsx) — SCRBRD-133 §7.2, lifted so the two
 * read one way. Signed out, always: same origin, `credentials: "omit"`, no
 * token, no API client. Four paths only:
 *
 *   /api/public/matches/:id           the header (team facts)
 *   /api/public/matches/:id/log       the redacted log; ?since=<seq> for what is new
 *   /api/public/matches/:id/shots     the side's sectors (L7)
 *   /api/public/matches/:id/par       par and pressure (SCRBRD-133 G2): the
 *                                     server's figures, never computed here
 *
 * The rule is applied on the server before any of it is sent; nothing here
 * decides who is named, and nothing here can ask for more.
 */

/** Same origin, no credentials, JSON or a thrown status. @param {string} path */
export async function read(path) {
  const res = await fetch(path, { credentials: "omit", headers: { accept: "application/json" } });
  if (!res.ok) throw Object.assign(new Error(`http_${res.status}`), { status: res.status });
  return res.json();
}

/**
 * The match, folded and told, from what the public reads returned: the
 * header as the Match Centre's components read a fixture, the log made
 * foldable, the fold (with any boy the log could only name by id put back to
 * his position), the shared generator's commentary under the page's labels —
 * `sensitive` never passed, so no health or discipline is said — and the
 * result as the page says it. Pure.
 * @param {{header: any, fold?: any, events?: any[], people?: Record<string, string>}} o
 */
export function publicStory({ header, fold = {}, events = [], people = {} }) {
  if (!header) return null;
  const match = asPublicMatch(header);
  const evs = foldable(events, people);
  const spoken = foldable(events, people, { forCommentary: true });
  const folded = deriveMatch(evs, fold ?? {});
  unnamedToPositions(folded.innings, people);
  const played = folded.innings.filter(Boolean);
  const teamName = (/** @type {unknown} */ _key, /** @type {string} */ name) => teamOf(match, name).full;
  const commentary = superOverCommentary(deriveCommentary(spoken, {
    ctx: fold ?? {}, nameOf: (/** @type {string} */ ref) => people[ref] ?? null, teamName,
  }), folded.innings, { teamName });
  const liveSO = liveSuperOverLine(played, match.status);
  const server = match.result && match.result.outcome !== "in_progress" ? match.result : null;
  const result = liveSO ?? server?.text ?? resultText(match, folded.result, { reasons: false }) ?? null;
  // The result stands once play (or the server) has decided it: not mid super
  // over, and not a cup tie whose super over is still to come.
  const r = folded.result;
  const pending = r && r.outcome === "tie" && r.decidedBy === null && fold?.conditions?.["result.tie_break"] === "super_over";
  const settled = !liveSO && (!!server || (!!r && !pending));
  // GA-I36: a correction is a void in the log the page already has — its
  // time and a pseudonymous target, never a reason or a name. One quiet
  // commentary line each, and the latest time for the chip.
  const fixes = correctionsOf(events);
  return { match, events: evs, folded, played, liveSO, result, settled,
    commentary: withCorrectionLines(commentary, events, fixes, settled || match.status === "complete"),
    correctedAt: correctedAt(fixes), corrected: correctedInnings(events, fixes, folded.innings) };
}

/**
 * The par report (SCRBRD-133 G2), read right after the log it is made from so
 * the two speak for one position; null when there is none or it could not be
 * read — the Board then says what it said before, never an old gap.
 * @param {string} base  /api/public/matches/:id
 */
export async function readPar(base) {
  try { return await read(`${base}/par`); } catch { return null; }
}

/** The same names for the same pseudonyms? @param {Record<string, string>} a @param {Record<string, string>} b */
const samePeople = (a = {}, b = {}) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

/** How often the display reads the log while the match is live (§1.3: the API's live TTL). */
export const DISPLAY_POLL_MS = 5_000;
/** How often the header is read: while not live, and alongside a live log. */
export const HEADER_MS = 60_000;

/** The poll, or what a walk asks for through window.__SCRBRD_LIVE_MS__ (never under a second). */
const pollMs = () => {
  const asked = typeof window !== "undefined" ? Number(/** @type {any} */ (window).__SCRBRD_LIVE_MS__) : NaN;
  return Number.isFinite(asked) && asked >= 1000 ? asked : DISPLAY_POLL_MS;
};

/**
 * The ground display's feed (§1.3 "how it stays live"): the header and the
 * whole log once; then, while the header says live, the log's NEW events
 * every 5 s (`?since=` the last seq held), and the header every 60 s and after
 * any read that brought an innings' start or end or a revision. While the
 * match is not live, the header every 60 s, so a TV switched on before the toss
 * starts when play does.
 *
 * NAMES ARE NEVER HELD PAST A CHANGE. A squad's labels arrive once, on its
 * innings_start, and an incremental read does not send them again — so the
 * names map that EVERY read carries (the server's, for the whole log, under
 * the rule as it stands) is compared each time, and any difference — a
 * withdrawn consent, a never-public mark, a names-off switch — is a full read
 * at once. A label the server no longer gives is never drawn from memory.
 *
 * `stop` ends the reading (the sleep after full time, D12). A 404 after the
 * page had data is `gone`: the publication was withdrawn, and reading stops.
 * A tab coming back into view reads in full.
 * @param {string} matchId  @param {{stop?: boolean}} [o]
 */
export function usePublicFeed(matchId, { stop = false } = {}) {
  const [state, setState] = useState(() => ({
    loading: true, missing: false, gone: false, error: /** @type {string | null} */ (null),
    header: /** @type {any} */ (null), fold: {}, events: /** @type {any[]} */ ([]), people: /** @type {Record<string, string>} */ ({}),
    last: 0, okAt: /** @type {number | null} */ (null), par: /** @type {any} */ (null),
  }));
  const held = useRef(state);
  held.current = state;
  useEffect(() => {
    if (stop) return undefined;
    let alive = true;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    let headerAt = 0;
    const base = `/api/public/matches/${matchId}`;
    const full = async () => {
      const [{ match, fold }, log] = await Promise.all([read(base), read(`${base}/log`)]);
      headerAt = Date.now();
      return { header: match, fold: fold ?? {}, events: log.events ?? [], people: log.people ?? {}, last: log.last ?? 0, par: await readPar(base) };
    };
    const step = async (/** @type {boolean} */ whole) => {
      const cur = held.current;
      if (whole || !cur.header) return full();
      if (cur.header.status !== "live") {
        const { match } = await read(base);
        headerAt = Date.now();
        // It went live (or changed state): read the log in full under the new header.
        return match.status !== cur.header.status ? full() : { ...cur, header: match };
      }
      const log = await read(`${base}/log?since=${cur.last}`);
      if (!samePeople(log.people ?? {}, cur.people)) return full();
      const fresh = (log.events ?? []).filter((/** @type {any} */ e) => e.seq > cur.last);
      let header = cur.header;
      if (Date.now() - headerAt >= HEADER_MS
          || fresh.some((/** @type {any} */ e) => e.kind === "innings_end" || e.kind === "innings_start" || e.kind === "revision")) {
        header = (await read(base)).match;
        headerAt = Date.now();
      }
      // The par is read again only when the log moved: with it, in the same
      // state change, so the Board's second line never shows a gap for the
      // ball before (SCRBRD-133 G2).
      return { ...cur, header, events: fresh.length ? [...cur.events, ...fresh] : cur.events,
               last: Math.max(cur.last, log.last ?? 0, ...fresh.map((/** @type {any} */ e) => e.seq)),
               par: fresh.length ? await readPar(base) : cur.par };
    };
    // One read at a time: a tab coming back mid-read asks for a whole read
    // once this one is in, rather than starting a second chain of reads.
    let busy = false, wantWhole = false;
    const tick = async (whole = false) => {
      if (!alive) return;
      if (busy) { wantWhole = wantWhole || whole; return; }
      busy = true;
      try {
        const next = await step(whole);
        if (!alive) return;
        setState({ ...next, loading: false, missing: false, gone: false, error: null, okAt: Date.now() });
        held.current = { ...held.current, ...next };
      } catch (/** @type {any} */ e) {
        if (!alive) return;
        // Not found is one answer: unpublished and no such fixture read alike.
        // After a first answer it means the publication was withdrawn: stop.
        if (e?.status === 404) {
          held.current = { ...held.current, gone: true };
          setState((s) => (s.header ? { ...s, gone: true, loading: false } : { ...s, loading: false, missing: true }));
          return;
        }
        setState((s) => ({ ...s, loading: false, error: e?.status === 429 ? "busy" : "unreachable" }));
      } finally {
        busy = false;
      }
      if (!alive || held.current.gone) return;
      const again = wantWhole;
      wantWhole = false;
      timer = setTimeout(() => tick(again), again ? 0 : held.current.header?.status === "live" ? pollMs() : HEADER_MS);
    };
    tick(true);
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      tick(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [matchId, stop]);
  return state;
}
