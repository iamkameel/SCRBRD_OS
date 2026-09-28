/**
 * The public page's side of the redacted log (SCRBRD-083 phase 1) — pure, so
 * apps/web/test/public-page.test.mjs proves it without a browser.
 *
 * GET /api/public/matches/:id/log returns the fixture's events after the
 * server has applied the rule (services/api/public/redact.mjs): every player
 * a 12-character pseudonym, every squad member {id, label, batHand}, and
 * `people` naming exactly the boys publicName() names. Nothing here decides
 * who is named — the labels arrive decided — it only puts them where the
 * shared fold (@scrbrd/scoring's deriveMatch) and the shared commentary
 * generator look for names:
 *
 *   - a squad member's `label` becomes the `name` the fold reads;
 *   - a reference no squad carries (a substitute fielder, a name the scorer
 *     typed, a log with no innings_start) is added to that innings' fielding
 *     squad under its label or its position, so the fold never falls back to
 *     showing the pseudonym itself. The batting squad is left as it is: its
 *     length is what the fold reads for "all out";
 *   - a wicket's fielder is the one reference the fold does not look up: it
 *     writes it into the scorecard line as it stands ("c C Botha b …", from a
 *     log where the scorer typed him). So for the fold it is replaced by his
 *     name or "Fielder"; the commentary keeps the reference, and looks it up;
 *   - the commentary is given `people` as its nameOf, so an unnamed boy is
 *     said by his role ("the striker"), exactly as the generator says anyone
 *     it is not given a name for.
 */

/** Where a reference sits on an event, and the word for it there. */
const REFS = Object.freeze({
  striker: "Batter", nonStriker: "Batter", batter: "Batter", dismissed: "Batter",
  bowler: "Bowler", fielder: "Fielder",
});

/**
 * The events, ready for deriveMatch() — or, with `forCommentary`, for
 * deriveCommentary(), which looks the fielder up itself.
 * @param {any[]} events  the public log's
 * @param {Record<string, string>} [people]  pseudonym → name, the named only
 * @param {{forCommentary?: boolean}} [o]
 * @returns {any[]}
 */
export function foldable(events = [], people = {}, { forCommentary = false } = {}) {
  /** @type {Map<number, Set<string>>} innings → every id its squads carry */
  const carried = new Map();
  /** @type {Map<number, Map<string, string>>} innings → stray id → the word for it */
  const strays = new Map();
  const at = (/** @type {Map<number, any>} */ m, /** @type {number} */ k, /** @type {() => any} */ mk) => {
    if (!m.has(k)) m.set(k, mk());
    return m.get(k);
  };
  for (const ev of events) {
    const inn = ev.innings ?? 0;
    if (ev.kind === "innings_start") {
      const ids = at(carried, inn, () => new Set());
      for (const m of [...(ev.squad ?? []), ...(ev.bowlingSquad ?? [])]) if (m?.id) ids.add(m.id);
    }
  }
  for (const ev of events) {
    const inn = ev.innings ?? 0;
    for (const [field, word] of Object.entries(REFS)) {
      const id = ev[field];
      if (typeof id !== "string" || carried.get(inn)?.has(id)) continue;
      const s = at(strays, inn, () => new Map());
      if (!s.has(id)) s.set(id, word);
    }
  }
  return events.map((ev) => {
    if (ev.kind === "ball" && typeof ev.fielder === "string" && !forCommentary) return { ...ev, fielder: people[ev.fielder] ?? "Fielder" };
    if (ev.kind !== "innings_start") return ev;
    const inn = ev.innings ?? 0;
    const member = (/** @type {any} */ m) => ({ id: m.id, name: m.label, ...(m.batHand ? { batHand: m.batHand } : {}) });
    const extra = [...(strays.get(inn) ?? new Map())].map(([id, word]) => ({ id, name: people[id] ?? word }));
    return { ...ev, squad: (ev.squad ?? []).map(member), bowlingSquad: [...(ev.bowlingSquad ?? []).map(member), ...extra] };
  });
}

/**
 * After the fold: a batter or bowler the fold could only name by his id (an
 * innings with no innings_start to add him to) is given his name from
 * `people`, or his position. The pseudonym is never shown.
 * @param {any[]} innings  deriveMatch()'s
 * @param {Record<string, string>} [people]
 */
export function unnamedToPositions(innings = [], people = {}) {
  for (const inn of innings) {
    if (!inn) continue;
    for (const b of inn.batsmen ?? []) if (b.name === b.id) b.name = people[b.id] ?? "Batter";
    for (const b of inn.bowlers ?? []) if (b.name === b.id) b.name = people[b.id] ?? "Bowler";
    for (const f of inn.fow ?? []) if (/^[0-9a-f]{12}$/.test(f.batsman ?? "")) f.batsman = people[f.batsman] ?? "Batter";
  }
  return innings;
}

/**
 * The header as the Match Centre's components read a fixture (lib/live.js
 * asMatch's shape): both sides named, the ground, the start, the toss.
 * @param {any} m  GET /api/public/matches/:id's `match`
 */
export function asPublicMatch(m) {
  const status = { live: "live", complete: "complete", abandoned: "abandoned" }[m?.status] ?? "upcoming";
  // Sliced as lib/live.js slices the signed-in read's, so both pages say the
  // same start for the same fixture.
  const sa = m?.startsAt ? String(m.startsAt) : null;
  return {
    id: m.id,
    homeTeam: m.homeTeam ?? "Home",
    awayTeam: m.awayOnPlatform ? (m.awayTeam ?? m.awayLabel) : m.awayLabel,
    homeLabel: m.homeLabel ?? null,
    awayLabel: m.awayOnPlatform ? m.awayLabel : null,
    homeCode: m.homeCode ?? null,
    awayCode: m.awayCode ?? null,
    awayTeamCode: m.awayTeam ?? null,
    venue: m.ground ?? null,
    date: sa ? sa.slice(0, 10) : null,
    time: sa ? sa.slice(11, 16) : null,
    startsAt: m.startsAt ?? null,
    status,
    overs: m.overs ?? null,
    format: m.format ?? null,
    tossWonBy: m.tossWonBy ?? null,
    tossDecision: m.tossDecision ?? null,
    result: null,
  };
}
