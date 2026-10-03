/**
 * PICK THE SIDE — the plain parts (the screen is views/cockpit/PickSide.jsx).
 *
 * A coach names the side for a fixture: up to eleven boys with a batting order
 * from 1 to 11, and an optional twelfth man who has no number. It is one call,
 * POST /api/matches/:id/squad (services/api/write/events-api.mjs squadRoutes),
 * and the route is all-or-nothing.
 *
 * NOTHING HERE DECIDES WHO MAY BE PICKED. The age and registration rules are
 * the database's, two triggers on `match_squad`, and a refusal comes back
 * naming the boy and the reason. This module keeps the working draft, checks
 * the three things the route checks before it writes (so a coach is told
 * before the round trip, in the route's own sentences), and finds which boy a
 * trigger's message is about so the screen can put it beside him.
 *
 * Pure, so it is proved under plain node (apps/web/test/pick-side.test.mjs):
 * no DOM, no network, no clock.
 */
import { STATE_WORDS, stateOf } from "./cockpit.js";

/** The side's size. The route allows batting numbers 1 to 11, and one twelfth man. */
export const SIDE_SIZE = 11;

/**
 * @typedef {{xi: {id: string, no: number | null}[], twelfth: string | null}} Draft
 *   `xi` is the boys picked, in the order picked; `no` is the batting number he holds (1 to 11), or null when it has been cleared.
 */

/** The state of an empty draft. @returns {Draft} */
export const emptyDraft = () => ({ xi: [], twelfth: null });

/**
 * The draft that stands now: the sheet for our end, as the `match_squad` read
 * gave it. A boy with no number (a reserve) keeps none.
 * @param {{playerId: string, side: string | null, battingNo: number | null, twelfth: boolean}[] | null | undefined} squad
 * @param {"home" | "away"} end
 * @returns {Draft}
 */
export function draftFrom(squad, end) {
  const mine = (squad ?? []).filter((r) => r.side === end);
  return {
    xi: mine.filter((r) => !r.twelfth).sort((a, b) => (a.battingNo ?? 99) - (b.battingNo ?? 99))
      .map((r) => ({ id: r.playerId, no: r.battingNo ?? null })),
    twelfth: mine.find((r) => r.twelfth)?.playerId ?? null,
  };
}

/**
 * Who can be picked: the team's boys as the roster read gave them, with this
 * fixture's answer beside each where the readiness read has one. A boy already
 * on the sheet who is not on the roster (picked from another side) is kept, so
 * saving never quietly drops him.
 *
 * Health is the status tier only (D4): the word, and the date he is back where
 * he is restricted and this reader may see the tier. Never a reason.
 * @param {{id: string, name: string, school?: string | null, team?: string | null}[] | null} players  the `players` read, adapted
 * @param {any[] | null} readiness  the `readiness` read, adapted
 * @param {{playerId: string, name: string, side: string | null}[] | null} squad  the `match_squad` read, adapted
 * @param {{school: string | null, teamCode: string | null, end: "home" | "away", may: {status: boolean}}} o
 * @returns {{id: string, name: string, state: string | null, words: string | null, back: string | null}[]}
 */
export function candidates(players, readiness, squad, { school, teamCode, end, may }) {
  const answer = new Map((readiness ?? []).map((r) => [r.playerId, r]));
  const roster = (players ?? []).filter((p) => (!school || p.school === school) && (!teamCode || p.team === teamCode));
  const rows = roster.map((p) => ({ id: p.id, name: p.name }));
  const have = new Set(rows.map((r) => r.id));
  for (const r of squad ?? []) if (r.side === end && !have.has(r.playerId)) { rows.push({ id: r.playerId, name: r.name }); have.add(r.playerId); }
  return rows.sort((a, b) => a.name.localeCompare(b.name)).map((r) => {
    const a = answer.get(r.id);
    const state = a ? stateOf(a, may) : null;
    return { ...r, state, words: state ? STATE_WORDS[state] ?? state : null, back: state === "restricted" ? (a.returnDate ?? null) : null };
  });
}

/** The lowest batting number nobody holds, or null when all eleven are held. @param {Draft} d */
export function freeNo(d) {
  const held = new Set(d.xi.map((x) => x.no));
  for (let n = 1; n <= SIDE_SIZE; n++) if (!held.has(n)) return n;
  return null;
}

/**
 * Picks a boy for the XI at the lowest free number. He leaves the twelfth's
 * place if he held it. A twelfth XI is not taken: the side stays at eleven.
 * @param {Draft} d @param {string} id @returns {Draft}
 */
export function pick(d, id) {
  if (d.xi.some((x) => x.id === id) || d.xi.length >= SIDE_SIZE) return d;
  return { xi: [...d.xi, { id, no: freeNo(d) }], twelfth: d.twelfth === id ? null : d.twelfth };
}

/** Takes a boy out of the XI. @param {Draft} d @param {string} id @returns {Draft} */
export const drop = (d, id) => ({ ...d, xi: d.xi.filter((x) => x.id !== id) });

/** Gives a boy a batting number, or clears it with null. Two boys may be set the same; checkDraft says so. @param {Draft} d @param {string} id @param {number | null} no @returns {Draft} */
export const setNo = (d, id, no) => ({ ...d, xi: d.xi.map((x) => (x.id === id ? { ...x, no } : x)) });

/**
 * Makes a boy the twelfth man (he leaves the XI, and the old twelfth is
 * unnamed), or clears the place if he already holds it.
 * @param {Draft} d @param {string} id @returns {Draft}
 */
export function setTwelfth(d, id) {
  if (d.twelfth === id) return { ...d, twelfth: null };
  return { xi: d.xi.filter((x) => x.id !== id), twelfth: id };
}

/**
 * What the route would be sent: the XI in batting order, then the twelfth, who
 * carries no number. A boy whose number was cleared is sent without one (a
 * reserve), which the route allows.
 * @param {Draft} d @returns {{playerId: string, battingNo?: number, twelfth?: true}[]}
 */
export function payload(d) {
  const xi = [...d.xi].sort((a, b) => (a.no ?? 99) - (b.no ?? 99))
    .map((x) => (x.no == null ? { playerId: x.id } : { playerId: x.id, battingNo: x.no }));
  return d.twelfth ? [...xi, { playerId: d.twelfth, twelfth: true }] : xi;
}

/**
 * The route's refusals that need no server, in its codes. `general` is the one
 * to say at the foot; `byBoy` the ids of the boys it is about, so it can stand
 * beside them. The route checks the same three things in the same order
 * (players_required, batting_no_must_be_1_to_11, duplicate_batting_no); this
 * says so before the round trip and sends nothing.
 * @param {Draft} d
 * @returns {{code: string | null, byBoy: Record<string, string>}}
 */
export function checkDraft(d) {
  if (!d.xi.length && !d.twelfth) return { code: "players_required", byBoy: {} };
  /** @type {Record<string, string>} */
  const byBoy = {};
  for (const x of d.xi) if (x.no != null && (!Number.isInteger(x.no) || x.no < 1 || x.no > SIDE_SIZE)) byBoy[x.id] = "batting_no_must_be_1_to_11";
  if (Object.keys(byBoy).length) return { code: "batting_no_must_be_1_to_11", byBoy };
  /** @type {Map<number, string[]>} */
  const held = new Map();
  for (const x of d.xi) if (x.no != null) held.set(x.no, [...(held.get(x.no) ?? []), x.id]);
  for (const ids of held.values()) if (ids.length > 1) for (const id of ids) byBoy[id] = "duplicate_batting_no";
  return Object.keys(byBoy).length ? { code: "duplicate_batting_no", byBoy } : { code: null, byBoy };
}

/** The route's codes, as sentences a coach can act on. Each says nothing was saved where that is true. */
export const REFUSAL_WORDS = Object.freeze({
  side_must_be_home_or_away: "This screen could not tell which side of the fixture is yours. Close it, open it again from the fixture, and nothing has been saved.",
  players_required: "Pick at least one boy before you save.",
  player_id_required: "A line on the sheet has no boy in it. Close this, open it again, and nothing has been saved.",
  duplicate_player: "A boy is on the sheet twice. Take one of them off. Nothing was saved.",
  batting_no_must_be_1_to_11: "Batting numbers run from 1 to 11. Nothing was saved.",
  duplicate_batting_no: "Two boys have the same batting number. Each number goes to one boy. Nothing was saved.",
  twelfth_man_has_no_batting_no: "The twelfth man does not bat, so he has no batting number. Nothing was saved.",
  not_permitted: "You are not allowed to name this side. Nothing was saved.",
});

/** Capitalised, and ended with a full stop if the database's sentence has none. @param {string} s */
const sentence = (s) => { const t = s.trim(); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}` : t; };

/**
 * Which boy a trigger's message names. The age rule and the registration rule
 * both put his name in the sentence ("B Khumalo is 14 on 1 January and cannot
 * play U13A: the limit is 13"; "cannot select B Khumalo: not registered to
 * play"). The longest name found wins, so "T Bekker" is not taken for "T
 * Bekkers". Null when it names nobody (a band the database cannot check).
 * @param {string | null | undefined} detail @param {{id: string, name: string}[]} boys
 * @returns {string | null}
 */
export function boyNamed(detail, boys) {
  const text = String(detail ?? "");
  let best = null;
  for (const b of boys) if (b.name && text.includes(b.name) && (!best || b.name.length > best.name.length)) best = b;
  return best?.id ?? null;
}

/**
 * A refusal or a failure, as what the screen says and where.
 *
 * A trigger refusal (400 not_eligible) is the database's own sentence, put
 * beside the boy it names; the side as it stood is unchanged, because the
 * route is one transaction. A code the route names is the sentence above.
 * No answer at all is NOT "nothing was saved": the request may have got there.
 * @param {{status?: number, code?: string, detail?: string | null} | null | undefined} e  an ApiError
 * @param {{id: string, name: string}[]} boys
 * @returns {{words: string, boyId: string | null}}
 */
export function refusalWords(e, boys) {
  const code = e?.code;
  if (code === "not_eligible") {
    const words = sentence(String(e?.detail ?? "")) || "The database would not accept this side.";
    return { words: `${words} Nothing was saved.`, boyId: boyNamed(e?.detail, boys) };
  }
  if (code && /** @type {Record<string, string>} */ (REFUSAL_WORDS)[code]) return { words: /** @type {Record<string, string>} */ (REFUSAL_WORDS)[code], boyId: null };
  if (e?.status) return { words: `The side was not saved. The server said ${code || `HTTP ${e.status}`}.`, boyId: null };
  return { words: "Could not reach the server, so the side may not have been saved. Close this and look at the Coach tab to see what stands.", boyId: null };
}

/** "11 in the XI · twelfth man: A Name" for the foot. @param {Draft} d @param {Map<string, string> | Record<string, string>} names */
export function draftFoot(d, names) {
  const nameOf = (/** @type {string} */ id) => (names instanceof Map ? names.get(id) : names[id]) ?? "a boy";
  return [`${d.xi.length} in the XI`, d.twelfth ? `twelfth man: ${nameOf(d.twelfth)}` : null].filter(Boolean).join(" · ");
}
