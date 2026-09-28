/**
 * SCRBRD — the public projection of a match's event log (SCRBRD-083 phase 1).
 *
 * docs/design/SCRBRD-083_public_pages.md §2.4. public_match_log() (db/59)
 * hands the API the fixture's events with every field named; this turns them
 * into what a signed-out browser may fold, and nothing else leaves:
 *
 *   PSEUDONYMS. Every player reference — the four id columns, a typed name in
 *   the payload, each squad member, the fielder, the retiring batter — becomes
 *   hmac(PUBLIC_PSEUDONYM_SECRET, match ‖ reference), 12 hex characters:
 *   stable within the match (the fold needs one id per boy on every event),
 *   different in every other match, and useless without the secret, which is
 *   an environment variable on the API and nowhere else — not in the code and
 *   not in the database. A typed name gets one the same way from the typed
 *   string, so the fold still tells two typed fielders apart. Every event's id
 *   (its idempotency key, which carries the scoring device's id) and every
 *   void's target get one too, from a separate domain, so a void still finds
 *   what it undoes.
 *
 *   LABELS. A squad member is {id, label, batHand}: the label is publicName()
 *   (packages/policy/src/public.mjs) over the facts public_match_people()
 *   returned, judged on the day served — "D Erasmus", or the position word
 *   for whichever squad he is in. The name columns never go further than the
 *   call. `people` maps a pseudonym to its name for exactly the boys who are
 *   named; nobody else is in it, so a boy without consent, a boy with a
 *   never-public mark, a boy whose school has names off and a typed name are
 *   the same absence (principle 3: "Batter" is one string).
 *
 *   THE ALLOWLIST. PUBLIC_EVENT_FIELDS names, per event kind, every field that
 *   may be emitted; a kind not listed is dropped whole (a new kind reaches the
 *   public only when somebody lists it), and every kept field passes its own
 *   check — a dismissal must be a canonical one, a penalty reason a code from
 *   the closed list, a number a number. Reasons that are about a boy's body or
 *   conduct never pass: a bowler change's reason (injured, suspended) is not
 *   on the list, and a retirement that is not a dismissal says "not out",
 *   whatever the scorer recorded ("hurt" is N2).
 *
 * PURE apart from the HMAC. The facts come from the database; the day comes
 * from the database; no clock is read here.
 */
import { createHmac } from "node:crypto";
import { publicName, POSITION_LABELS } from "@scrbrd/policy/public";
import {
  BALL_TYPE, DISMISSALS, INNINGS_END_REASON, NB_RUNS_VALUES, NB_TYPES, RUN_OUT_ENDS,
  FACES_NEXT_VALUES, NOT_IN_OVER, PENALTY_REASONS, RETIRE_REASON,
} from "@scrbrd/scoring";

/**
 * Per event kind, every field a public event may carry beyond the common
 * five (kind, innings, seq, id, clientTs). Pinned by
 * services/api/public/public.test.mjs; the design's table (§2.4) is the
 * source, finalised against events.mjs and what the fold reads.
 *
 * Dropped by not being here: every ball's shot, contact, trajectory, seg,
 * zone, bowlerApproach, theta, radius and placement fields (L7 — the team's
 * sectors are public_shot_sectors()); a bowler change's reason; the twelfth
 * man (a team sheet, A7); an innings' declared capture profile; a void's
 * reason; `bowler_suspended` whole (Law 41 against one boy is N3).
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const PUBLIC_EVENT_FIELDS = Object.freeze({
  innings_start: Object.freeze(["battingTeam", "bowlingTeam", "teamKey", "bowlingTeamKey", "squad", "bowlingSquad", "overs", "target"]),
  batters:       Object.freeze(["striker", "nonStriker", "captainConsent"]),
  bowler:        Object.freeze(["bowler"]),
  ball:          Object.freeze(["type", "value", "striker", "nonStriker", "bowler", "dismissal", "fielder", "dismissed",
                                "freeHit", "nbRuns", "nbType", "outAt", "facesNext", "notInOver"]),
  penalty:       Object.freeze(["runs", "toBattingTeam", "reason"]),
  retire:        Object.freeze(["batter", "reason", "type", "dismissal"]),
  innings_end:   Object.freeze(["reason", "confirmed"]),
  revision:      Object.freeze(["overs", "target", "reason"]),
  void:          Object.freeze(["target"]),
});

/** The fields every public event carries. */
export const PUBLIC_EVENT_COMMON = Object.freeze(["kind", "innings", "seq", "id", "clientTs"]);

/** The fields that name a player, and the position a stray one is shown as. */
const PLAYER_FIELDS = Object.freeze({
  striker: POSITION_LABELS.batter, nonStriker: POSITION_LABELS.batter, batter: POSITION_LABELS.batter,
  dismissed: POSITION_LABELS.batter, bowler: POSITION_LABELS.bowler, fielder: POSITION_LABELS.fielder,
});

/** The revision sheet's reasons (sheets.jsx), the only ones a public event keeps. */
const REVISION_REASONS = new Set(["rain", "bad light", "bad_light", "late start", "late_start", "ground unfit", "ground_unfit"]);
const END_REASONS = new Set(Object.values(INNINGS_END_REASON));
const BALL_TYPES = new Set(Object.values(BALL_TYPE));
/** A retirement that is a dismissal keeps its reason; any other says this. */
export const RETIRED_NOT_OUT = "not out";
const DISMISSAL_RETIREMENTS = new Set([RETIRE_REASON.OUT, RETIRE_REASON.TIMED_OUT]);

// ── Pseudonyms ──────────────────────────────────────────────────

/**
 * A player's pseudonym within one match. Twelve hex characters (48 bits):
 * collisions inside one match's thirty-odd references are not a concern.
 * @param {string} secret  PUBLIC_PSEUDONYM_SECRET
 * @param {string} matchId
 * @param {string} ref  a player id, or a name the scorer typed
 */
export function playerPseudonym(secret, matchId, ref) {
  if (!secret) throw new Error("a pseudonym needs the secret");
  return createHmac("sha256", secret).update(`player\u0000${matchId}\u0000${ref}`).digest("hex").slice(0, 12);
}

/**
 * An event's public id, from its idempotency key (which names the device
 * that scored it). A separate domain from a player's, so neither can be
 * mistaken for the other.
 * @param {string} secret @param {string} matchId @param {string} key
 */
export function eventPseudonym(secret, matchId, key) {
  if (!secret) throw new Error("a pseudonym needs the secret");
  return `e${createHmac("sha256", secret).update(`event\u0000${matchId}\u0000${key}`).digest("hex").slice(0, 15)}`;
}

// ── Labels ──────────────────────────────────────────────────────

/**
 * One row of public_match_people() (db/59).
 * @typedef {object} PersonRow
 * @property {string} player_id
 * @property {boolean} school_published
 * @property {{consents?: any[], neverPublic?: boolean, namesOff?: boolean}} facts
 * @property {string | null} full_name
 * @property {string | null} surname
 * @property {string | null} known_as
 * @property {string} [served_on]
 */

const NOBODY = "\u0000";

/**
 * What a public page shows for one reference: the name publicName() gives,
 * or null — a position, whichever position the caller shows. A reference
 * with no player row is a typed name (L6), and a player row whose facts are
 * missing names nobody (publicName() fails closed on a missing fact).
 * @param {PersonRow | undefined} person
 * @param {string} on  YYYY-MM-DD, the day served
 * @returns {string | null}
 */
export function nameFor(person, on) {
  if (!person) return null;
  const f = person.facts ?? {};
  const shown = publicName({
    on,
    fullName: person.full_name,
    surname: person.surname,
    knownAs: person.known_as,
    typed: false,
    schoolOnPlatform: true,
    schoolPublished: person.school_published === true,
    neverPublic: f.neverPublic,
    namesOff: f.namesOff,
    consents: f.consents,
    label: NOBODY,
  });
  return shown === NOBODY ? null : shown;
}

// ── The projection ──────────────────────────────────────────────

/**
 * One row of public_match_log() (db/59).
 * @typedef {object} LogRow
 * @property {number} seq
 * @property {number} innings
 * @property {string} kind
 * @property {string | null} ball_type
 * @property {number | null} value
 * @property {string | null} striker_id
 * @property {string | null} non_striker_id
 * @property {string | null} bowler_id
 * @property {string | null} dismissed_id
 * @property {string | null} dismissal
 * @property {string} event_key
 * @property {Date | string} client_ts
 * @property {Record<string, any> | null} detail
 */

/**
 * The public log.
 * @typedef {object} PublicLog
 * @property {Record<string, any>[]} events   in seq order
 * @property {Record<string, string>} people  pseudonym → name, for the named only
 * @property {number} last                    the last seq, for ?since=
 * @property {Set<string>} playerIds          the real ids behind it — for the cache's
 *                                            invalidation, NEVER sent
 */

/** @param {unknown} v */
const int = (v) => (typeof v === "number" && Number.isInteger(v) ? v : null);
/** @param {unknown} v */
const str = (v) => (typeof v === "string" && v.trim() ? v : null);
/** A team as the pad wrote it on innings_start: a code, a school's name. @param {unknown} v */
const team = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
/** @param {unknown} v @param {ReadonlySet<unknown>} set */
const oneOf = (v, set) => (typeof v === "string" && set.has(v) ? v : null);

/**
 * Project the log. `rows` from public_match_log(), `people` from
 * public_match_people(), `on` the day the database says it is.
 * @param {{rows: LogRow[], people: PersonRow[], secret: string, matchId: string, on: string}} o
 * @returns {PublicLog}
 */
export function projectLog({ rows, people, secret, matchId, on }) {
  /** @type {Map<string, PersonRow>} */
  const byId = new Map(people.map((p) => [String(p.player_id).toLowerCase(), p]));
  /** @type {Record<string, string>} */
  const named = {};
  /** @type {Set<string>} */
  const playerIds = new Set();

  /**
   * A reference → its pseudonym; recorded in `people` when he is named.
   * @param {unknown} ref @returns {string | null}
   */
  const who = (ref) => {
    if (typeof ref !== "string" || !ref.trim()) return null;
    const key = ref.trim();
    const person = byId.get(key.toLowerCase());
    const p = playerPseudonym(secret, matchId, person ? person.player_id : key);
    if (person) {
      playerIds.add(person.player_id);
      const name = nameFor(person, on);
      if (name) named[p] = name;
    }
    return p;
  };

  /**
   * A squad as innings_start carries it (objects, or bare ids and typed
   * names) → [{id, label, batHand}].
   * @param {unknown} squad @param {string} position
   */
  const squadOf = (squad, position) => (Array.isArray(squad) ? squad : []).flatMap((m) => {
    const ref = m != null && typeof m === "object" ? m.id : m;
    const id = who(ref);
    if (!id) return [];
    const hand = m != null && typeof m === "object" ? (m.batHand ?? m.batting_style ?? m.battingStyle) : null;
    /** @type {Record<string, string>} */
    const out = { id, label: named[id] ?? position };
    // Q7: the batting hand stays (the wheel's orientation; on every broadcast).
    if (typeof hand === "string" && /^[lr]/i.test(hand)) out.batHand = /^l/i.test(hand) ? "L" : "R";
    return [out];
  });

  /** @type {Record<string, any>[]} */
  const events = [];
  let last = 0;
  for (const row of rows) {
    last = Math.max(last, Number(row.seq) || 0);
    const fields = PUBLIC_EVENT_FIELDS[row.kind];
    if (!fields) continue;                            // a kind nobody listed
    const d = row.detail ?? {};
    /** @type {Record<string, any>} the candidate values, before each field's own check */
    const src = {
      ...d,
      type: row.ball_type, value: row.value, dismissal: row.dismissal,
      striker: row.striker_id ?? d.striker, nonStriker: row.non_striker_id ?? d.nonStriker,
      bowler: row.bowler_id ?? d.bowler, dismissed: row.dismissed_id ?? d.dismissed,
    };
    /** @type {Record<string, any>} */
    const ev = {
      kind: row.kind,
      innings: int(row.innings) ?? 0,
      seq: Number(row.seq),
      id: eventPseudonym(secret, matchId, String(row.event_key)),
      clientTs: new Date(row.client_ts).getTime(),
    };
    for (const f of fields) {
      const v = keep(row.kind, f, src, { who, squadOf, secret, matchId });
      if (v !== undefined) ev[f] = v;
    }
    events.push(ev);
  }
  return { events, people: named, last, playerIds };
}

/**
 * One field of one event, checked — or undefined, and it is not emitted.
 * @param {string} kind @param {string} f @param {Record<string, any>} src
 * @param {{who: (ref: unknown) => string | null, squadOf: (s: unknown, position: string) => Record<string, string>[], secret: string, matchId: string}} ctx
 * @returns {any}
 */
function keep(kind, f, src, { who, squadOf, secret, matchId }) {
  const v = src[f];
  if (Object.hasOwn(PLAYER_FIELDS, f)) return who(v) ?? undefined;
  switch (f) {
    case "squad":          return squadOf(v, POSITION_LABELS.batter);
    case "bowlingSquad":   return squadOf(v, POSITION_LABELS.bowler);
    case "battingTeam": case "bowlingTeam": case "teamKey": case "bowlingTeamKey":
      return team(v) ?? undefined;
    case "overs": case "runs": case "value":
      return int(v) ?? undefined;
    case "toBattingTeam": case "freeHit":
      return typeof v === "boolean" ? v : undefined;
    case "captainConsent":
      return v === true ? true : undefined;
    case "type":
      if (kind === "retire") return v === BALL_TYPE.WICKET ? v : undefined;
      return oneOf(v, BALL_TYPES) ?? undefined;
    case "dismissal":      return oneOf(v, DISMISSALS) ?? undefined;
    case "nbRuns":         return oneOf(v, NB_RUNS_VALUES) ?? undefined;
    case "nbType":         return oneOf(v, NB_TYPES) ?? undefined;
    case "outAt":          return oneOf(v, RUN_OUT_ENDS) ?? undefined;
    case "facesNext":      return oneOf(v, FACES_NEXT_VALUES) ?? undefined;
    case "notInOver":      return oneOf(v, NOT_IN_OVER) ?? undefined;
    case "confirmed": {
      if (v == null || typeof v !== "object") return undefined;
      return { runs: int(v.runs), wickets: int(v.wickets), balls: int(v.balls) };
    }
    case "reason": {
      if (kind === "penalty") return oneOf(v, PENALTY_REASONS) ?? null;
      if (kind === "innings_end") return oneOf(v, END_REASONS) ?? null;
      if (kind === "revision") return typeof v === "string" && REVISION_REASONS.has(v.toLowerCase()) ? v : undefined;
      if (kind === "retire") {
        // A dismissal (retired out, timed out) keeps its reason; anything
        // else is "not out", whatever was recorded — "hurt" is N2.
        return src.type === BALL_TYPE.WICKET && DISMISSAL_RETIREMENTS.has(v) ? v : RETIRED_NOT_OUT;
      }
      return undefined;
    }
    case "target":
      if (kind === "void") return str(v) ? eventPseudonym(secret, matchId, v) : undefined;
      return int(v) ?? undefined;
    default:
      return undefined;                               // listed but unknown: never emitted
  }
}
