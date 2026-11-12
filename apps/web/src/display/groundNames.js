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
 * `position_only` true for the host side whenever its season roster holds a
 * marked boy (Kameel, 12 Nov, 17:45: "Season roster: hide the side all
 * season"), and always for the away side — never by the day's selection or
 * the ball a boy first appears, so it never says which boy. The SERVER'S
 * FLAG PER SIDE IS WHAT COUNTS: nothing here decides who is marked, or which
 * side is the host's; it only puts the position word where the fold and
 * the commentary look for a name.
 *
 * AND ONLY WHERE THE PUBLIC PAGE NAMES HIM (Kameel, 12 Nov 2026, 21:00: "we
 * should be masking the names of any boy that doesn't have a public
 * profile"). On top of the side rule, a boy is named only where the public
 * live page of the same match names him, and by the label it names him by:
 * the public page's own read, so the screen shows the crowd nothing the
 * public page would not (publicLabels()). A name the scorer typed (L6) is
 * a position, as it is there.
 *
 * FAIL CLOSED. A boy is named only when the FIRST innings_start naming a
 * side carries him for it (the members the server keyed that side's row
 * by), every side that carries him there was answered as not
 * position-only, and the public page names him. Before either answer,
 * after a read that failed, on a fixture that is not published, and for a
 * boy no side's first squad carries, he is his position. A catch is the
 * pad's shape: `fielder` the name the scorecard prints, `fielders` the
 * references; it is the named catcher's label, or "Fielder".
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

/** A name as the log may write it again: case and spacing do not hide a boy. @param {unknown} n */
const norm = (n) => (typeof n === "string" ? n.trim().replace(/\s+/g, " ").toLowerCase() : "");

/**
 * Each side's members, keyed as the log keys it (db/153 reads the same
 * keys): the boys the FIRST innings_start naming the side carries for it —
 * its squad by teamKey or battingTeam, its bowlingSquad by bowlingTeamKey or
 * bowlingTeam. A later innings_start adds nobody (the server's rule too).
 * @param {any[]} events  in the log's order  @returns {Map<string, Set<string>>}  boy → sides
 */
function squadSides(events) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  const side = (/** @type {any[]} */ squad, /** @type {unknown} */ team) => {
    if (typeof team !== "string" || seen.has(team)) return;
    seen.add(team);
    for (const m of squad ?? []) {
      const id = m?.id ?? m;
      if (typeof id !== "string") continue;
      if (!out.has(id)) out.set(id, new Set());
      /** @type {Set<string>} */ (out.get(id)).add(team);
    }
  };
  for (const ev of events) {
    if (ev?.kind !== "innings_start") continue;
    side(ev.squad, ev.teamKey ?? ev.battingTeam);
    side(ev.bowlingSquad, ev.bowlingTeamKey ?? ev.bowlingTeam);
  }
  return out;
}

/**
 * The boys the PUBLIC LIVE PAGE of this match names, by their signed-in id,
 * with the label it names them by (Kameel, 12 Nov 2026, 21:00: "we should be
 * masking the names of any boy that doesn't have a public profile"). The
 * answer is the public page's own read (GET /api/public/matches/:id/log,
 * public-api.mjs), the rule applied on the server by publicName() over
 * public_match_people(): `people` maps a pseudonym to the label of exactly
 * the boys the public page names, and each innings_start's squads carry
 * those pseudonyms in the order the signed-in log carries the ids. So the
 * k-th innings_start of each log is lined up, squad by squad and place by
 * place; a squad whose length differs, an innings that differs, a count of
 * innings_start that differs, or a boy given two labels names nobody there.
 * Nothing here decides who is named; null (no public answer: the read
 * failed, or the fixture is not published) names nobody.
 * @param {{events?: any[], people?: Record<string, string>} | null | undefined} pub
 * @param {any[]} events  the signed-in log
 * @returns {Map<string, string> | null}  id → the public label
 */
export function publicLabels(pub, events = []) {
  if (!pub || !Array.isArray(pub.events) || !pub.people || typeof pub.people !== "object") return null;
  const mine = events.filter((e) => e?.kind === "innings_start");
  const theirs = pub.events.filter((e) => e?.kind === "innings_start");
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {Set<string>} */
  const torn = new Set();
  if (mine.length !== theirs.length) return out;
  mine.forEach((ev, k) => {
    const pe = theirs[k];
    if ((pe?.innings ?? 0) !== (ev?.innings ?? 0)) return;
    for (const key of ["squad", "bowlingSquad"]) {
      const a = Array.isArray(ev[key]) ? ev[key] : [], b = Array.isArray(pe[key]) ? pe[key] : [];
      if (a.length !== b.length) continue;
      a.forEach((/** @type {any} */ m, /** @type {number} */ i) => {
        const id = m?.id ?? m, ref = b[i]?.id ?? b[i];
        const label = typeof ref === "string" && Object.hasOwn(pub.people, ref) ? pub.people[ref] : null;
        if (typeof id !== "string" || !UUID.test(id) || typeof label !== "string" || !label.trim()) return;
        if (out.has(id) && out.get(id) !== label) torn.add(id);
        out.set(id, label);
      });
    }
  });
  for (const id of torn) out.delete(id);
  return out;
}

/**
 * The boys the big screen names, with the label it names them by: those
 * the public live page names (`labels`, publicLabels()), and of those only
 * the boys whom a side's first squad carries with every side carrying him
 * answered as not position-only (Kameel, 12 Nov 2026, (b), and the season
 * roster). Both answers are needed: without either, nobody is named.
 * @param {{rows: {team?: string | null, position_only?: boolean, log_seq?: number | string}[]} | null | undefined} answer
 * @param {any[]} events  the log the screen folds
 * @param {Map<string, string> | null | undefined} labels
 * @returns {ReadonlyMap<string, string>}
 */
export function namedOnGround(answer, events = [], labels = null) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!answer || !Array.isArray(answer.rows) || !labels) return out;
  /** @type {Map<string, boolean>} side → shown by position */
  const flags = new Map();
  for (const r of answer.rows) {
    if (!r || typeof r.team !== "string") continue;
    flags.set(r.team, flags.get(r.team) === true || r.position_only !== false);
  }
  for (const [id, of] of squadSides(events)) {
    if ([...of].every((t) => flags.get(t) === false) && labels.has(id)) out.set(id, /** @type {string} */ (labels.get(id)));
  }
  return out;
}

/**
 * The highest seq an answer covered (db/153's log_seq), or null.
 * @param {{rows?: {log_seq?: number | string}[]} | null | undefined} answer
 */
export function answeredThrough(answer) {
  const n = Number(answer?.rows?.[0]?.log_seq);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a reference is shown by position: anybody the screen does not
 * name — a player with a row, and a name the scorer typed alike (L6: the
 * public page names no typed name).
 * @param {ReadonlyMap<string, string>} named  @param {unknown} ref
 */
export const byPosition = (named, ref) => typeof ref === "string" && !named.has(ref);

/**
 * The log, ready for the big screen's fold: every squad member the screen
 * names carries the public page's label as his name, and every other his
 * position word. A catch (the pad's shape: `fielder` the scorecard's name
 * text, `fielders` the references) is the named catcher's label, or
 * "Fielder". Also returns `hidden`, the names everyone else carried in the
 * log (normalised: trimmed, spaced once, lower case), so the fold's own
 * lines (the fall of wickets, a partnership) and the commentary are held to
 * the same rule; and `spoken`, the log for the commentary, a catch given
 * the named catcher's reference or no fielder at all ("a fielder").
 * @param {any[]} events  the signed-in log, as folded
 * @param {ReadonlyMap<string, string>} named
 * @returns {{events: any[], spoken: any[], hidden: ReadonlySet<string>}}
 */
export function forGround(events = [], named = new Map()) {
  /** @type {Set<string>} */
  const hidden = new Set();
  /** @type {Map<string, string>} a named boy's squad name → his id */
  const byName = new Map();
  for (const ev of events) {
    if (ev?.kind !== "innings_start") continue;
    for (const m of [...(ev.squad ?? []), ...(ev.bowlingSquad ?? [])]) {
      const id = m?.id ?? m;
      const name = typeof m === "object" && m !== null ? m.name : m;
      if (!norm(name)) continue;
      if (byPosition(named, id)) hidden.add(norm(name));
      else byName.set(norm(name), id);
    }
  }
  for (const n of hidden) byName.delete(n);
  const member = (/** @type {any} */ m, /** @type {string} */ word) => {
    const id = m?.id ?? m;
    const name = byPosition(named, id) ? word : /** @type {string} */ (named.get(id));
    return typeof m === "object" && m !== null ? { ...m, name } : { id, name };
  };
  /** @param {any} ev  the named catcher, if the catch is one; undefined if the event names no fielder */
  const catcher = (ev) => {
    const refs = Array.isArray(ev?.fielders) ? ev.fielders : [];
    if (!refs.length && typeof ev?.fielder !== "string") return undefined;
    if (refs.length) return refs.find((/** @type {unknown} */ r) => typeof r === "string" && named.has(r)) ?? null;
    return named.has(ev.fielder) ? ev.fielder : (byName.get(norm(ev.fielder)) ?? null);
  };
  const out = events.map((ev) => {
    if (ev?.kind === "innings_start") {
      return { ...ev, squad: (ev.squad ?? []).map((m) => member(m, GROUND_POSITION.batter)),
               bowlingSquad: (ev.bowlingSquad ?? []).map((m) => member(m, GROUND_POSITION.bowler)) };
    }
    const c = catcher(ev);
    return c === undefined ? ev : { ...ev, fielder: c ? /** @type {string} */ (named.get(c)) : GROUND_POSITION.fielder };
  });
  const spoken = events.map((ev) => {
    if (ev?.kind === "innings_start") return ev;
    const c = catcher(ev);
    return c === undefined ? ev : { ...ev, fielder: c ?? "" };
  });
  return { events: out, spoken, hidden };
}

/**
 * After the fold: a batter or bowler the screen does not name, and any line
 * that still carries a hidden name, is his position. Changes the innings in
 * place, as the public page's unnamedToPositions() does, and returns them.
 * @param {any[]} innings  deriveMatch()'s, over forGround()'s events
 * @param {ReadonlyMap<string, string>} named  @param {ReadonlySet<string>} hidden
 */
export function groundInnings(innings = [], named = new Map(), hidden = new Set()) {
  const word = (/** @type {unknown} */ name, /** @type {string} */ w) => (typeof name === "string" && hidden.has(norm(name)) ? w : name);
  for (const inn of innings) {
    if (!inn) continue;
    for (const b of inn.batsmen ?? []) if (byPosition(named, b.id) || hidden.has(norm(b.name))) b.name = GROUND_POSITION.batter;
    for (const b of inn.bowlers ?? []) if (byPosition(named, b.id) || hidden.has(norm(b.name))) b.name = GROUND_POSITION.bowler;
    for (const k of inn.keepers ?? []) if (byPosition(named, k.id) || hidden.has(norm(k.name))) k.name = GROUND_POSITION.fielder;
    for (const f of inn.fow ?? []) f.batsman = word(f.batsman, GROUND_POSITION.batter);
    for (const p of inn.partnerships ?? []) { p.bat1 = word(p.bat1, GROUND_POSITION.batter); p.bat2 = word(p.bat2, GROUND_POSITION.batter); }
  }
  return innings;
}

/**
 * The commentary's nameOf, held to the same rule: a boy the screen does not
 * name is given no name, so the generator says his role; a named boy is his
 * public label.
 * @param {ReadonlyMap<string, string>} named  @param {ReadonlySet<string>} hidden
 * @returns {(ref: string) => string | null}
 */
export function groundNameOf(named, hidden) {
  return (ref) => (byPosition(named, ref) || hidden.has(norm(ref)) ? null : named.get(ref) ?? null);
}
