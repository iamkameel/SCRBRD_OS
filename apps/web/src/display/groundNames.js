/**
 * The big screen at the ground: a marked boy by his position
 * (docs/design/PUBLIC_BY_TERMS.md §2.5, slice 1) — pure, so
 * apps/web/test/ground-names.test.mjs proves it without a browser.
 *
 * The Match Centre's big screen is the ground display's own view, fed by the
 * signed-in log and so by the names that log carries (SCRBRD-133 D11). It is
 * the school's own scoreboard, not a public page, and the public-name
 * switches do not govern it. One thing does: a boy under any never-public
 * mark (PUBLIC_DATA C5) is shown by his position on it, because a screen
 * facing a crowd is a place he can be found.
 *
 * Kameel, 12 Nov 2026, (b): when any boy on the field is under a mark, his
 * WHOLE SIDE is shown by position, so the one "Batter" among named boys is
 * no tell (§3.4). The server says which sides (GET /api/read/
 * ground_screen_sides, db/153): one row per side the log names,
 * `position_only` true for a side with a marked boy on the field — never
 * which boy. Nothing here decides who is marked; it only puts the position
 * word where the fold and the commentary look for a name.
 *
 * FAIL CLOSED. A player SCRBRD holds a row for (his reference is a uuid) is
 * named only when he was on the field when the read was asked and every
 * side carrying him was answered as not position-only. Before the first
 * answer, after a read that failed with none, and for a boy who came onto
 * the field since the last one, he is his position. A name the scorer typed
 * (L6: no row, so no mark) is left as it was.
 *
 * The words are the public projection's (services/api/public/redact.mjs,
 * public/publicLog.js): "Batter" in the batting squad, "Bowler" in the
 * fielding squad, "Fielder" for a catch. The commentary says the role
 * itself ("the striker", "a fielder"), as it does for anybody it is given no
 * name for.
 */

/** The position words, as the public pages say them. */
export const GROUND_POSITION = Object.freeze({ batter: "Batter", bowler: "Bowler", fielder: "Fielder" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where an event puts a boy on the field: the fields db/153 reads, in the order it reads them. */
const FIELD_REFS = ["striker", "nonStriker", "bowler", "dismissed", "fielder", "batter", "keeper"];

/**
 * Every boy with a row the log puts on the field in a role — the set the
 * server's answer is about, taken when the read is asked.
 * @param {any[]} events  @returns {Set<string>}
 */
export function playersOnField(events = []) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const ev of events) for (const k of FIELD_REFS) if (typeof ev?.[k] === "string" && UUID.test(ev[k])) out.add(ev[k]);
  return out;
}

/**
 * The sides each squad member is carried by, keyed as the log keys them
 * (db/153 reads the same keys): the batting squad by teamKey or
 * battingTeam, the fielding squad by bowlingTeamKey or bowlingTeam.
 * @param {any[]} events  @returns {Map<string, Set<string>>}
 */
function squadSides(events) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  const add = (/** @type {any} */ m, /** @type {unknown} */ team) => {
    const id = m?.id ?? m;
    if (typeof id !== "string" || typeof team !== "string") return;
    if (!out.has(id)) out.set(id, new Set());
    /** @type {Set<string>} */ (out.get(id)).add(team);
  };
  for (const ev of events) {
    if (ev?.kind !== "innings_start") continue;
    for (const m of ev.squad ?? []) add(m, ev.teamKey ?? ev.battingTeam);
    for (const m of ev.bowlingSquad ?? []) add(m, ev.bowlingTeamKey ?? ev.bowlingTeam);
  }
  return out;
}

/**
 * The ids the big screen may name (Kameel, 12 Nov 2026, (b)): a boy who was
 * on the field when the read was asked (`asked`, playersOnField() then), every
 * side whose squads carry him answered as not position-only. A side with a
 * marked boy on the field is position-only, so every boy it carries is his
 * position; a row with no side (a marked boy no squad carries) names nobody;
 * no answer (`null`) names nobody with a row.
 * @param {{rows: {team?: string | null, position_only?: boolean}[], asked: ReadonlySet<string>} | null | undefined} answer
 * @param {any[]} events  the log the screen folds
 * @returns {ReadonlySet<string>}
 */
export function namedOnGround(answer, events = []) {
  if (!answer || !Array.isArray(answer.rows)) return new Set();
  /** @type {Map<string, boolean>} side → shown by position */
  const flags = new Map();
  for (const r of answer.rows) {
    if (!r) continue;
    if (r.team == null) { if (r.position_only !== false) return new Set(); continue; }
    flags.set(r.team, flags.get(r.team) === true || r.position_only !== false);
  }
  const sides = squadSides(events);
  return new Set([...(answer.asked ?? [])].filter((id) => {
    const of = sides.get(id);
    return !!of?.size && [...of].every((t) => flags.get(t) === false);
  }));
}

/**
 * Whether a reference is shown by position: a player with a row whom the
 * answer does not name.
 * @param {ReadonlySet<string>} named  @param {unknown} ref
 */
export const byPosition = (named, ref) => typeof ref === "string" && UUID.test(ref) && !named.has(ref);

/**
 * The log, ready for the big screen's fold: every squad member shown by
 * position carries his position word as his name, and a fielder written by
 * his reference, or by the name his squad gave him, is "Fielder". Also
 * returns `hidden`, the names those boys carried in the log, so the fold's
 * own lines (the fall of wickets, a partnership) and the commentary can be
 * held to the same rule.
 * @param {any[]} events  the signed-in log, as folded
 * @param {ReadonlySet<string>} named
 * @returns {{events: any[], hidden: ReadonlySet<string>}}
 */
export function forGround(events = [], named = new Set()) {
  /** @type {Set<string>} */
  const hidden = new Set();
  for (const ev of events) {
    if (ev?.kind !== "innings_start") continue;
    for (const m of [...(ev.squad ?? []), ...(ev.bowlingSquad ?? [])]) {
      const id = m?.id ?? m;
      if (byPosition(named, id) && typeof m?.name === "string" && m.name.trim()) hidden.add(m.name);
    }
  }
  const member = (/** @type {any} */ m, /** @type {string} */ word) => {
    const id = m?.id ?? m;
    if (!byPosition(named, id)) return m;
    return typeof m === "object" && m !== null ? { ...m, name: word } : { id, name: word };
  };
  const out = events.map((ev) => {
    if (ev?.kind === "innings_start") {
      return { ...ev, squad: (ev.squad ?? []).map((m) => member(m, GROUND_POSITION.batter)),
               bowlingSquad: (ev.bowlingSquad ?? []).map((m) => member(m, GROUND_POSITION.bowler)) };
    }
    if (typeof ev?.fielder === "string" && (byPosition(named, ev.fielder) || hidden.has(ev.fielder))) {
      return { ...ev, fielder: GROUND_POSITION.fielder };
    }
    return ev;
  });
  return { events: out, hidden };
}

/**
 * After the fold: a batter or bowler the fold could name only by his
 * reference (no squad carried him), and any line that still carries a
 * hidden name, is his position. Changes the innings in place, as the public
 * page's unnamedToPositions() does, and returns them.
 * @param {any[]} innings  deriveMatch()'s, over forGround()'s events
 * @param {ReadonlySet<string>} named  @param {ReadonlySet<string>} hidden
 */
export function groundInnings(innings = [], named = new Set(), hidden = new Set()) {
  const word = (/** @type {unknown} */ name, /** @type {string} */ w) => (typeof name === "string" && hidden.has(name) ? w : name);
  for (const inn of innings) {
    if (!inn) continue;
    for (const b of inn.batsmen ?? []) if (byPosition(named, b.id) || hidden.has(b.name)) b.name = GROUND_POSITION.batter;
    for (const b of inn.bowlers ?? []) if (byPosition(named, b.id) || hidden.has(b.name)) b.name = GROUND_POSITION.bowler;
    for (const k of inn.keepers ?? []) if (byPosition(named, k.id) || hidden.has(k.name)) k.name = GROUND_POSITION.fielder;
    for (const f of inn.fow ?? []) f.batsman = word(f.batsman, GROUND_POSITION.batter);
    for (const p of inn.partnerships ?? []) { p.bat1 = word(p.bat1, GROUND_POSITION.batter); p.bat2 = word(p.bat2, GROUND_POSITION.batter); }
  }
  return innings;
}

/**
 * The commentary's nameOf, held to the same rule: a boy shown by position
 * is given no name, so the generator says his role.
 * @param {(ref: string) => string | null} nameOf  the Match Centre's own (lib/matchCentre.js nameBook)
 * @param {ReadonlySet<string>} named  @param {ReadonlySet<string>} hidden
 * @returns {(ref: string) => string | null}
 */
export function groundNameOf(nameOf, named, hidden) {
  return (ref) => {
    if (byPosition(named, ref) || hidden.has(ref)) return null;
    const n = nameOf(ref);
    return n != null && hidden.has(n) ? null : n;
  };
}
