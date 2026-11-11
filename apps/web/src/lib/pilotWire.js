/**
 * SCRBRD — Pilot Match, phase 2: the one function between the outbox and the
 * wire (docs/design/PILOT_MATCH_PHASE2.md §3.2).
 *
 * NO NAME LEAVES THE PHONE INSIDE A BALL. The pad scores a Pilot Match on
 * slot ids ("home, list position 3"), and keeps a roster beside it: slot id
 * to typed name, and each side's display name. pilotWire(event, roster) is
 * the event as it is sent:
 *
 *   - every player field (striker, nonStriker, bowler, batter, dismissed,
 *     keeper, fielder, twelfthMan) and every entry of the two squads leaves
 *     as a bare slot id: an {id, name} leaves as its id, and a name on the
 *     roster as its slot. A fielder or a twelfth man who is no slot (a
 *     substitute typed in) is left off; any other player who is no slot
 *     keeps the event on the phone;
 *   - the four team fields leave as `home` or `away`; the team's name
 *     travels once, on pilot.side;
 *   - free text typed during play (a stoppage's note, a reason in words)
 *     leaves as its code, or not at all: every string that is not a code or
 *     an id is left off;
 *   - A LAST CHECK: if any string anywhere in the result equals, by the
 *     normKey rule, any name on the roster, the event is not sent at all:
 *     `{ok: false, reason: "name_on_wire"}`, and the outbox holds it for a
 *     person (lib/sync.js). The build's tests treat that as a failure to fix.
 *
 * The server checks all of it again (db/151 pilot_event_refusal()): this is
 * the first lock, that is the second. pilotUnwire() is the way back, for a
 * log read from the server: slot ids become {id, name} again from the
 * roster (positions where it has no name), and home/away the sides' names.
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
/** Free text the pad keeps for itself and never sends, whatever it says. */
const NEVER_SENT = new Set(["note", "notes", "text", "comment", "words", "reasonText", "names"]);
/** What a string on the wire may be: a code or an id (the server's own rule, db/151). */
export const WIRE_STRING = /^[A-Za-z0-9_.:+-]{1,160}$/;

/**
 * The roster a Pilot Match is scored against.
 * @typedef {object} PilotRoster
 * @property {Record<string, {side: "home" | "away", list_no: number, name?: string | null}>} slots
 * @property {{home: string, away: string}} teams   each side's display name
 */

/**
 * @param {PilotRoster} roster
 * @returns {{names: Map<string, string>, slots: Set<string>, sideOf: Map<string, "home" | "away">}}
 */
function index(roster) {
  const names = new Map();
  const slots = new Set(Object.keys(roster?.slots ?? {}));
  for (const [id, s] of Object.entries(roster?.slots ?? {})) {
    if (s?.name && normKey(s.name)) names.set(normKey(s.name), id);
  }
  /** @type {Map<string, "home" | "away">} */
  const sideOf = new Map();
  for (const side of /** @type {const} */ (["home", "away"])) {
    sideOf.set(side, side);
    const n = roster?.teams?.[side];
    if (n && normKey(n)) sideOf.set(normKey(n), side);
  }
  return { names, slots, sideOf };
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
  return ix.names.get(normKey(raw)) ?? null;
}

/**
 * Every string in a value, however deep, and every key.
 * @param {unknown} v @param {string[]} out
 */
function strings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
  return out;
}

/**
 * A value with every string that is not a code or an id left off (free
 * text), recursively. Numbers, booleans and null stay.
 * @param {unknown} v
 * @returns {unknown}  undefined: leave it off
 */
function codesOnly(v) {
  if (typeof v === "string") return WIRE_STRING.test(v) ? v : undefined;
  if (Array.isArray(v)) return v.map(codesOnly).filter((x) => x !== undefined);
  if (v && typeof v === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (NEVER_SENT.has(k) || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)) continue;
      const y = codesOnly(x);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  return v;
}

/**
 * The event as it is sent, or why it is not.
 * @param {Record<string, any>} event  a scoring event as the pad keeps it
 * @param {PilotRoster} roster
 * @returns {{ok: true, event: Record<string, any>} | {ok: false, reason: "name_on_wire", field?: string}}
 */
export function pilotWire(event, roster) {
  const ix = index(roster);
  /** @type {Record<string, any>} */
  const out = { ...event };
  for (const f of PLAYER_FIELDS) {
    if (!(f in out)) continue;
    const s = slotOf(out[f], ix);
    if (s === undefined) { out[f] = out[f] ?? null; continue; }
    if (s === null) {
      if (MAY_DROP.has(f)) { out[f] = null; continue; }
      return { ok: false, reason: "name_on_wire", field: f };
    }
    out[f] = s;
  }
  for (const f of ["squad", "bowlingSquad"]) {
    if (!Array.isArray(out[f])) continue;
    const mapped = out[f].map((p) => slotOf(p, ix));
    if (mapped.some((s) => s == null)) return { ok: false, reason: "name_on_wire", field: f };
    out[f] = mapped;
  }
  for (const f of TEAM_FIELDS) {
    if (out[f] == null) continue;
    const side = ix.sideOf.get(normKey(out[f]));
    if (!side) return { ok: false, reason: "name_on_wire", field: f };
    out[f] = side;
  }
  const wire = /** @type {Record<string, any>} */ (codesOnly(out));
  // The last check: nothing on the wire is a name on the roster.
  for (const s of strings(wire)) {
    if (ix.names.has(normKey(s))) return { ok: false, reason: "name_on_wire" };
  }
  return { ok: true, event: wire };
}

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
  return out;
}
