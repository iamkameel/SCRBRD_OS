/**
 * SCRBRD — Pilot Match, phase 2: the one function between the outbox and the
 * wire (docs/design/PILOT_MATCH_PHASE2.md §3.2, §3.4).
 *
 * NO NAME LEAVES THE PHONE INSIDE A BALL. The pad scores a Pilot Match on
 * slot ids ("home, list position 3"), and keeps a roster beside it: slot id
 * to typed name, and each side's display name. pilotWire(event, roster) is
 * the event as it is sent:
 *
 *   - only the keys its kind may carry (KIND_KEYS, §3.4: "a key outside the
 *     allow-list for its kind"); any other key is left off;
 *   - every player field (striker, nonStriker, bowler, batter, dismissed,
 *     keeper, fielder, twelfthMan) and every entry of the two squads leaves
 *     as a bare slot id: an {id, name} leaves as its id, and a name on the
 *     roster as its slot. A fielder or a twelfth man who is no slot (a
 *     substitute typed in) is left off; any other player who is no slot
 *     keeps the event on the phone;
 *   - the four team fields leave as `home` or `away`; the team's name never
 *     travels in an event;
 *   - every other value has its key's shape: a code of its closed vocabulary
 *     (CLOSED), a lower-case code (a reason, a shot), an event id, a number
 *     (a stoppage's time is one: ms since the epoch) or a yes/no. Anything else — a stoppage's note, a reason in
 *     words — is left off;
 *   - A LAST CHECK: if any key, or any value that is not a code of its key's
 *     closed vocabulary, equals by the normKey rule any name on the roster,
 *     the event is not sent at all: `{ok: false, reason: "name_on_wire"}`,
 *     and the outbox holds it for a person (lib/sync.js). A boy typed as
 *     "LB" therefore does not hold back every leg-bye (the review's N2):
 *     `type: "LB"` is a code of `type`.
 *
 * The server checks all of it again, inside the functions that write
 * (db/151 pilot_screen()): this is the first lock, that is the second.
 * KIND_KEYS and CLOSED are db/151's pilot_kind_keys() and pilot_closed(),
 * key for key; apps/web/test/pilotWire.test.mjs reads the migration and
 * holds the two equal. pilotUnwire() is the way back, for a log read from
 * the server.
 *
 * Pure: no storage, no network. Deterministic, so a retry of an event is the
 * same wire event, and the server's fingerprint dedupes it (db/36).
 */

const normKey = (/** @type {unknown} */ s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** The player fields of an event: each a slot id on the wire, or nobody. */
export const PLAYER_FIELDS = Object.freeze(["striker", "nonStriker", "bowler", "batter", "dismissed", "keeper", "fielder", "twelfthMan"]);
/** Players who may be left off when they are no slot: a substitute fielder, a twelfth man typed in. */
const MAY_DROP = new Set(["fielder", "twelfthMan"]);
/** The team fields: `home` or `away` on the wire. */
export const TEAM_FIELDS = Object.freeze(["battingTeam", "bowlingTeam", "teamKey", "bowlingTeamKey"]);
/** What a string on the wire may look like at all (db/151's own rule). */
export const WIRE_STRING = /^[A-Za-z0-9_.:+-]{1,160}$/;

export const BASE_KEYS = ["kind", "innings", "clientTs", "id", "seq"];
/** The keys each kind of event may carry on the wire (db/151 pilot_kind_keys). */
export const KIND_KEYS = Object.freeze({
  innings_start: ["battingTeam", "bowlingTeam", "teamKey", "bowlingTeamKey", "squad", "bowlingSquad", "twelfthMan", "overs", "target",
    "captureProfile", "superOver"],
  batters: ["striker", "nonStriker", "captainConsent"],
  bowler: ["bowler", "reason"],
  keeper: ["keeper"],
  bowler_suspended: ["bowler", "reason", "scope"],
  ball: ["type", "value", "nbRuns", "nbType", "boundary", "striker", "nonStriker", "bowler", "shot", "contact", "trajectory", "seg",
    "zone", "bowlerApproach", "dismissal", "fielder", "dismissed", "outAt", "facesNext", "notInOver", "freeHit", "theta", "radius",
    "placementSource", "placementNull", "closePosition", "captureProfile"],
  penalty: ["runs", "toBattingTeam", "reason"],
  retire: ["batter", "reason", "type", "dismissal"],
  innings_end: ["reason", "confirmed"],
  revision: ["overs", "target", "reason", "par"],
  void: ["target", "reason"],
  play_stopped: ["reason", "at"],
  play_resumed: ["at"],
});

/** The closed vocabularies (db/151 pilot_closed): a value here is a code, never a name. */
export const CLOSED = Object.freeze({
  kind: Object.keys(KIND_KEYS),
  type: ["run", "W", "Wd", "Nb", "B", "LB"],
  battingTeam: ["home", "away"], bowlingTeam: ["home", "away"], teamKey: ["home", "away"], bowlingTeamKey: ["home", "away"],
  dismissal: ["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket", "handled_ball", "obstructing_field", "timed_out", "retired_out", "hit_twice"],
  captureProfile: ["full", "standard", "quick"],
  contact: ["middle", "outside_edge", "inside_edge", "top_edge", "beat", "body"],
  trajectory: ["ground", "aerial", "controlled_aerial", "miscued"],
  zone: ["inner", "outer", "boundary"],
  placementSource: ["point", "sector"],
  placementNull: ["no_contact", "not_applicable", "not_required", "skipped"],
  closePosition: ["keeper", "slip", "gully", "leg_slip", "leg_gully", "silly_point", "short_leg", "short_mid_wicket", "at_feet"],
  nbType: ["front_foot", "height", "beamer"],
  outAt: ["striker", "non_striker"],
  facesNext: ["striker", "non_striker", "incoming"],
  scope: ["innings", "match"],
  bowlerApproach: ["over", "around"],
  notInOver: ["fielder_returning", "illegal_fielding", "distracting_striker", "obstructing_batter"],
});

/** The pad writes the approach in words; it travels as a code, and comes back as the words. */
const APPROACH_OUT = Object.freeze({ "Over the wicket": "over", "Around the wicket": "around" });
const APPROACH_IN = Object.freeze({ over: "Over the wicket", around: "Around the wicket" });

export const CODE = /^[a-z][a-z0-9_]{0,40}$/;
export const EVENT_ID = /^[A-Za-z0-9_.+-]{1,80}(:[A-Za-z0-9_.+-]{1,80}){1,6}$/;
export const BOOLEAN_KEYS = new Set(["boundary", "freeHit", "captainConsent", "toBattingTeam"]);
export const CODE_KEYS = new Set(["reason", "shot"]);

/**
 * Is this value of this key the shape the server takes? Players, squads and
 * teams are mapped before this is asked.
 * @param {string} k @param {unknown} v
 */
export function valueFits(k, v) {
  if (v === null) return true;
  const closed = /** @type {Record<string, string[]>} */ (CLOSED)[k];
  if (closed) return typeof v === "string" && closed.includes(v);
  if (CODE_KEYS.has(k)) return typeof v === "string" && CODE.test(v);
  if (k === "id") return typeof v === "string" && EVENT_ID.test(v);
  if (k === "target") return (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && EVENT_ID.test(v));
  if (BOOLEAN_KEYS.has(k)) return typeof v === "boolean";
  if (k === "confirmed") {
    return !!v && typeof v === "object" && !Array.isArray(v)
      && Object.entries(v).every(([ck, cv]) => ["runs", "wickets", "balls"].includes(ck) && (cv === null || (typeof cv === "number" && Number.isFinite(cv))));
  }
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * The roster a Pilot Match is scored against.
 * @typedef {object} PilotRoster
 * @property {Record<string, {side: "home" | "away", list_no: number, name?: string | null, position?: boolean}>} slots
 * @property {{home: string, away: string}} teams   each side's display name
 */

/** @param {PilotRoster} roster */
function index(roster) {
  const names = new Map();
  const slots = new Set(Object.keys(roster?.slots ?? {}));
  // A slot of a side scored by position (Q5: `position`, set by pilotSlots)
  // is shown as "Home No. 3", and the pad keeps a fielder or a twelfth man in
  // those words: they name that slot and no one else. Only such a slot: a
  // slot whose name has gone (its date passed, or a second phone the names
  // never reached) is sent as it was before Q5, so nothing on the wire
  // changes for a match started with names. Kept apart from `names`, which
  // the last check reads: a position is not a name.
  /** @type {Map<string, string>} */
  const positions = new Map();
  for (const [id, s] of Object.entries(roster?.slots ?? {})) {
    if (s?.name && normKey(s.name)) names.set(normKey(s.name), id);
    else if (s?.position === true && (s.side === "home" || s.side === "away") && Number.isInteger(s.list_no)) positions.set(normKey(positionWords(s.side, s.list_no)), id);
  }
  /** @type {Map<string, "home" | "away">} */
  const sideOf = new Map();
  for (const side of /** @type {const} */ (["home", "away"])) {
    sideOf.set(side, side);
    const n = roster?.teams?.[side];
    if (n && normKey(n)) sideOf.set(normKey(n), side);
  }
  return { names, positions, slots, sideOf };
}

/**
 * One player reference as a slot id, or null when it names nobody this
 * roster knows.
 * @param {unknown} v @param {ReturnType<typeof index>} ix
 * @returns {string | null | undefined}  undefined: there was nothing to map
 */
function slotOf(v, ix) {
  if (v == null) return undefined;
  const raw = typeof v === "object" ? /** @type {any} */ (v).id ?? /** @type {any} */ (v).name : v;
  if (typeof raw !== "string") return null;
  if (ix.slots.has(raw)) return raw;
  return ix.names.get(normKey(raw)) ?? ix.positions.get(normKey(raw)) ?? null;
}

/**
 * Every key in a value, and every string in it with the key it sits under
 * (an array's entries under the array's key): db/151 pilot_leaves().
 * @param {unknown} v @param {string | null} key @param {[string | null, string][]} out
 */
function leaves(v, key = null, out = []) {
  if (typeof v === "string") out.push([key, v]);
  else if (Array.isArray(v)) for (const x of v) leaves(x, key, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push([null, k]); leaves(x, k, out); }
  return out;
}

/** Is this string a code of its key's closed vocabulary (never a name)? @param {string | null} k @param {string} s */
const isClosedCode = (k, s) => k != null && /** @type {Record<string, string[]>} */ (CLOSED)[k]?.includes(s) === true;

/**
 * The event as it is sent, or why it is not.
 * @param {Record<string, any>} event  a scoring event as the pad keeps it
 * @param {PilotRoster} roster
 * @returns {{ok: true, event: Record<string, any>} | {ok: false, reason: "name_on_wire" | "not_sendable", field?: string}}
 */
export function pilotWire(event, roster) {
  const ix = index(roster);
  const allowed = /** @type {Record<string, string[]>} */ (KIND_KEYS)[event?.kind];
  if (!allowed) return { ok: false, reason: "not_sendable", field: "kind" };
  const keys = new Set([...BASE_KEYS, ...allowed]);
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v0] of Object.entries(event)) {
    if (!keys.has(k)) continue;
    let v = v0;
    if (v === undefined) continue;
    if (PLAYER_FIELDS.includes(k)) {
      const s = slotOf(v, ix);
      if (s === undefined) { out[k] = null; continue; }
      if (s === null) {
        if (MAY_DROP.has(k)) { out[k] = null; continue; }
        return { ok: false, reason: "name_on_wire", field: k };
      }
      out[k] = s;
      continue;
    }
    if (k === "squad" || k === "bowlingSquad") {
      if (!Array.isArray(v)) continue;
      const mapped = v.map((p) => slotOf(p, ix));
      if (mapped.some((s) => s == null)) return { ok: false, reason: "name_on_wire", field: k };
      out[k] = mapped;
      continue;
    }
    if (TEAM_FIELDS.includes(k)) {
      if (v == null) { out[k] = null; continue; }
      const side = ix.sideOf.get(normKey(v));
      if (!side) return { ok: false, reason: "name_on_wire", field: k };
      out[k] = side;
      continue;
    }
    if (k === "bowlerApproach" && typeof v === "string") v = Object.hasOwn(APPROACH_OUT, v) ? APPROACH_OUT[/** @type {keyof typeof APPROACH_OUT} */ (v)] : v;
    // A value not of its key's shape — words, a note, a reason typed in — is
    // left off, never sent.
    if (valueFits(k, v)) out[k] = v;
  }
  // The last check: no key, and no value that is not a code of its key, is a
  // name on the roster.
  for (const [k, s] of leaves(out)) {
    if (isClosedCode(k, s)) continue;
    if (ix.names.has(normKey(s))) return { ok: false, reason: "name_on_wire" };
  }
  return { ok: true, event: out };
}

/**
 * Does `text` hold `name` as whole words (§5.2's rule, db/151
 * pilot_contains_word)? Anything not a letter or a digit is a space.
 * @param {unknown} text @param {unknown} name
 */
export function containsWord(text, name) {
  const words = (/** @type {unknown} */ x) => normKey(x).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const n = words(name);
  return n !== "" && ` ${words(text)} `.includes(` ${n} `);
}

/** Does `text` hold any typed name on the roster as whole words? @param {unknown} text @param {PilotRoster} roster */
export const holdsAName = (text, roster) => Object.values(roster?.slots ?? {}).some((s) => s?.name && containsWord(text, s.name));

/**
 * A slot as the pad shows it: its name when the roster has one, else its
 * position ("Home No. 3"), which is not a name.
 * @param {string} id @param {PilotRoster} roster
 */
export function slotEntry(id, roster) {
  const s = roster?.slots?.[id];
  if (!s) return { id, name: id };
  return { id, name: s.name || positionWords(s.side, s.list_no) };
}

/** "Home No. 3". @param {"home" | "away"} side @param {number} n */
export const positionWords = (side, n) => `${side === "away" ? "Away" : "Home"} No. ${n}`;

/**
 * The way back: an event read from the server, as the pad keeps it.
 * @param {Record<string, any>} event @param {PilotRoster} roster
 */
export function pilotUnwire(event, roster) {
  /** @type {Record<string, any>} */
  const out = { ...event };
  for (const f of ["squad", "bowlingSquad"]) {
    if (Array.isArray(out[f])) out[f] = out[f].map((id) => (typeof id === "string" ? slotEntry(id, roster) : id));
  }
  // The pad keeps these two as names (the batting sheet and the wicket
  // sheet show them as written).
  for (const f of ["twelfthMan", "fielder"]) {
    if (typeof out[f] === "string" && roster?.slots?.[out[f]]) out[f] = slotEntry(out[f], roster).name;
  }
  for (const f of TEAM_FIELDS) {
    if (out[f] === "home" || out[f] === "away") out[f] = roster?.teams?.[out[f]] ?? out[f];
  }
  if (typeof out.bowlerApproach === "string" && Object.hasOwn(APPROACH_IN, out.bowlerApproach)) {
    out.bowlerApproach = APPROACH_IN[/** @type {keyof typeof APPROACH_IN} */ (out.bowlerApproach)];
  }
  return out;
}
