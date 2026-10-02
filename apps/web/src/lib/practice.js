/**
 * SCRBRD — Practice Match, phase 1.
 *
 * A match a scorer starts from the field with nothing set up: two typed teams
 * and two lists of names, scored on the real pad. Everything about it stays on
 * this phone. Phase 1 sends NOTHING to any server — not the sync engine, not
 * analytics, not error reporting — and a practice match is in no fixture list,
 * Match Centre, stat or table. Players are children, and a name is personal
 * information, so the only copy is the one on the scorer's device, labelled
 * as such on every screen and deletable in one action.
 *
 * WHAT IS IN THIS FILE
 * ────────────────────
 *   - the pure rules: reading a pasted list of names, squad limits, the
 *     team's display name, the overs presets, the line-up an XI is read from;
 *   - the config the pad's existing startMatch(cfg) takes (practiceCfg);
 *   - the record kept beside the ball log, in shapes close to the real
 *     tables so phase 2 can map them: `match`, `player` (full_name),
 *     `match_squad` (side, batting_no, twelfth) and `match_weather`
 *     (db/00_schema_core.sql, db/08_schema_programme.sql);
 *   - the store: list, load, save, delete one, delete all.
 *
 * WHERE IT IS KEPT
 * ────────────────
 * In lib/persist.js's own backend — IndexedDB, then localStorage, then memory
 * — under keys that all begin `practice:`:
 *
 *     practice:meta:<id>   the record above
 *     practice:log:<id>    the ball log, written by persist.js saveMatch() on
 *                          every ball, exactly as for any match (a practice
 *                          id is routed here by persist.js matchKey)
 *     practice:draft       the setup, autosaved after every step
 *
 * One prefix is the whole footprint, so "delete everything of the practice
 * matches" is one sweep (deleteAllPractice) and cannot miss a trace.
 *
 * THE BALLS are the scoring package's events, untouched. The one thing the
 * scorer's own startMatch(cfg) needed was names: it takes team names, squads
 * as plain lists of names, a twelfth man, openers and an opening bowler, and
 * looks the squads up in INT_TEAMS only to fall back to the lists it was
 * given (scorer/engine.jsx startMatch, lines 829-862), so a typed team needs
 * no engine change.
 */
import { AGE_GROUPS } from "./league.js";
import {
  PRACTICE_ID_PREFIX, isPracticeId, putRecord, getRecord, deleteRecord, recordKeys, loadMatch, clearMatch,
} from "./persist.js";
import { foldPad } from "../scorer/penalty.js";

export { isPracticeId, PRACTICE_ID_PREFIX };

// ── The limits ───────────────────────────────────────────────────────
export const MIN_SQUAD = 2;
export const MAX_SQUAD = 15;
/** The eleven who play; the rest of a longer list are reserves (match_squad.batting_no is 1..11). */
export const XI_SIZE = 11;
export const OVERS_PRESETS = Object.freeze([20, 30, 40, 50]);
export const MAX_OVERS = 50;
const MAX_NAME = 60;

/** U11 to Open, from the leagues' own list of age groups (lib/league.js). */
export const DIVISIONS = Object.freeze(
  AGE_GROUPS.filter((g) => /^U\d+$/.test(g) && g !== "U10").sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).concat("Open"),
);
/** The class a side plays in. A single letter reads as part of the name ("U15A"). */
export const CLASSES = Object.freeze(["A", "B", "C", "D", "1st XI", "2nd XI", "3rd XI"]);

// ── Reading a pasted list of names ───────────────────────────────────
//
// WhatsApp team sheets arrive as "1. A Name", "2) B Name,", "• C Name", with
// blank lines between, trailing spaces, and sometimes a whole side on one line
// separated by commas. Whatever came in, what comes out is a name per entry.

// Invisible characters WhatsApp and Word leave behind: zero-width spaces and
// joiners, directional marks, the BOM.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const normKey = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * One entry of a pasted list, cleaned: a bullet, "1." / "2)" / "#3" / "4 -" /
 * "5 " numbering, stray commas and spaces gone, inner runs of spaces made one.
 * @param {unknown} raw
 */
export function cleanName(raw) {
  let s = String(raw ?? "").replace(INVISIBLE, "").replace(/[\u00A0\t]/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s
      .replace(/^[-*>\u2013\u2014\u2022\u00B7\u25AA\u25BA]+\s*/u, "")
      .replace(/^#?\d{1,2}\s*[.):\-\u2013]\s*/u, "")
      .replace(/^#\d{1,2}\s+/u, "")
      .replace(/^\d{1,2}\s+(?=\p{L})/u, "")
      .trim();
    if (s === before) break;
  }
  s = s.replace(/^[\s,;:]+|[\s,;:]+$/g, "").replace(/\s+/g, " ");
  return s.length > MAX_NAME ? s.slice(0, MAX_NAME).trim() : s;
}

/**
 * Names out of a pasted or typed block: one per line, and commas or semicolons
 * also separate (a list pasted on one line). Blank lines and numbering go.
 * Every name that was there is kept, repeats included, so the screen can flag
 * them — see `duplicates`.
 *
 * @param {string} text
 * @returns {{names: string[], count: number, duplicates: string[], over: number}}
 *   `over` is how many are beyond MAX_SQUAD.
 */
export function parseSquadText(text) {
  const names = String(text ?? "").split(/[\r\n\u2028\u2029]+|[,;]+/).map(cleanName).filter(Boolean);
  return { names, count: names.length, duplicates: duplicatesOf(names), over: Math.max(0, names.length - MAX_SQUAD) };
}

/** The names that appear more than once (case and spacing ignored), as first written. @param {string[]} names */
export function duplicatesOf(names) {
  const seen = new Map();
  for (const n of names) {
    const k = normKey(n);
    const e = seen.get(k);
    if (e) e.n += 1; else seen.set(k, { name: n, n: 1 });
  }
  return [...seen.values()].filter((e) => e.n > 1).map((e) => e.name);
}

// ── A squad on the screen ────────────────────────────────────────────
//
// `[{name, twelfth}]`, in batting order. At most one is the twelfth man; he
// stays where he is in the list but is not in the XI. The XI is the first
// eleven who are not the twelfth; anyone after them is a reserve.

/** @typedef {{name: string, twelfth: boolean}} SquadPlayer */

/** Append names (all of them: the screen flags what is wrong). @param {SquadPlayer[]} players @param {string[]} names @returns {SquadPlayer[]} */
export function addNames(players, names) {
  return [...players, ...names.map((name) => ({ name, twelfth: false }))];
}

/** Move one entry up (-1) or down (+1). @param {SquadPlayer[]} players @param {number} i @param {-1 | 1} dir */
export function moveAt(players, i, dir) {
  const j = i + dir;
  if (i < 0 || i >= players.length || j < 0 || j >= players.length) return players;
  const next = [...players];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** @param {SquadPlayer[]} players @param {number} i */
export function removeAt(players, i) {
  return players.filter((_, k) => k !== i);
}

/** Mark one entry the twelfth man (or unmark him). Only one can be. @param {SquadPlayer[]} players @param {number} i */
export function toggleTwelfth(players, i) {
  return players.map((p, k) => ({ ...p, twelfth: k === i ? !p.twelfth : false }));
}

/** Keep the first of each repeated name. @param {SquadPlayer[]} players */
export function withoutDuplicates(players) {
  const seen = new Set();
  return players.filter((p) => { const k = normKey(p.name); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * What is wrong with a squad, in words, if anything. 2 to 15 names, no name
 * twice, no blank. `ok` is true when it can play.
 * @param {SquadPlayer[]} players
 * @returns {{ok: boolean, problems: {code: string, text: string}[], repeated: Set<string>, count: number}}
 */
export function validateSquad(players) {
  const names = players.map((p) => p.name);
  const problems = [];
  if (names.length < MIN_SQUAD) {
    problems.push({ code: "too_few", text: `A side needs at least ${MIN_SQUAD} names; there ${names.length === 1 ? "is 1" : `are ${names.length}`}.` });
  }
  if (names.length > MAX_SQUAD) {
    const over = names.length - MAX_SQUAD;
    problems.push({ code: "too_many", text: `A squad is at most ${MAX_SQUAD} names; take ${over === 1 ? "1 name" : `${over} names`} off.` });
  }
  const dups = duplicatesOf(names);
  if (dups.length) {
    problems.push({ code: "duplicate", text: `${dups.length === 1 ? "This name is" : "These names are"} in the list twice: ${dups.join(", ")}. Players are told apart by name, so give each a different one (add an initial) or remove one.` });
  }
  if (names.some((n) => !n.trim())) problems.push({ code: "blank", text: "A name is empty." });
  return { ok: problems.length === 0, problems, repeated: new Set(dups.map(normKey)), count: names.length };
}

/** Is this name one that is in the list twice? @param {{repeated: Set<string>}} v @param {string} name */
export const isRepeated = (v, name) => v.repeated.has(normKey(name));

/** A name on both sides would be one player to the scorer, which tells players apart by name. @param {SquadPlayer[]} a @param {SquadPlayer[]} b */
export function sharedNames(a, b) {
  const ka = new Set(a.map((p) => normKey(p.name)));
  return b.filter((p) => ka.has(normKey(p.name))).map((p) => p.name);
}

/**
 * Who is in the XI, who is the twelfth man, who waits.
 * @param {SquadPlayer[]} players
 * @returns {{xi: string[], twelfth: string | null, reserves: string[]}}
 */
export function lineUp(players) {
  const twelfth = players.find((p) => p.twelfth)?.name ?? null;
  const rest = players.filter((p) => !p.twelfth).map((p) => p.name);
  return { xi: rest.slice(0, XI_SIZE), reserves: rest.slice(XI_SIZE), twelfth };
}

// ── The team ─────────────────────────────────────────────────────────

/** @typedef {{school: string, division: string, cls: string}} TeamDraft */

/**
 * "Hilton U15A": the school, the age division, and the class. A single-letter
 * or single-digit class joins the division ("U15A"); a longer one ("1st XI")
 * and the Open division take a space ("Hilton U15 1st XI", "Hilton Open A").
 * @param {Partial<TeamDraft>} t
 */
export function practiceTeamName(t) {
  const school = String(t?.school ?? "").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const division = String(t?.division ?? "").trim();
  const cls = String(t?.cls ?? "").trim();
  const tail = !cls ? division : /^U\d+$/.test(division) && /^[A-Za-z0-9]$/.test(cls) ? `${division}${cls}` : `${division} ${cls}`;
  return [school, tail].filter(Boolean).join(" ").trim();
}

/** What is missing from a team, in words (empty when it is complete). @param {Partial<TeamDraft>} t */
export function teamProblems(t) {
  const out = [];
  if (!String(t?.school ?? "").trim()) out.push("Type the school.");
  if (!DIVISIONS.includes(t?.division)) out.push("Choose the age division.");
  if (!CLASSES.includes(t?.cls)) out.push("Choose the class.");
  return out;
}

/** Two sides, told apart by their display names. @param {TeamDraft} a @param {TeamDraft} b */
export const sameTeam = (a, b) => normKey(practiceTeamName(a)) === normKey(practiceTeamName(b));

/** Overs per innings: a whole number 1 to MAX_OVERS, or null. @param {unknown} v */
export function oversOf(v) {
  const n = typeof v === "number" ? v : /^\s*\d{1,3}\s*$/.test(String(v ?? "")) ? parseInt(String(v), 10) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_OVERS ? n : null;
}

// ── Weather: the scorer's own observation ────────────────────────────
//
// Six quick buttons; a clean place for a hint to come from later. Nothing
// here calls a weather service.

export const WEATHER_CONDITIONS = Object.freeze([
  { id: "sunny", label: "Sunny" },
  { id: "overcast", label: "Overcast" },
  { id: "drizzle", label: "Drizzle" },
  { id: "rain", label: "Rain" },
  { id: "windy", label: "Windy" },
]);
const conditionLabel = (id) => WEATHER_CONDITIONS.find((c) => c.id === id)?.label ?? null;

/**
 * The scorer's observation, in the shape of db/08's match_weather. Only what
 * the buttons say is filled; the rest is null, and `forecast` is never set
 * here — a forecast, when there is one, comes from a hint and is not stored.
 * @param {{condition: string | null, playable?: boolean | null, at?: number}} o
 */
export function weatherRecord({ condition, playable = null, at = Date.now() }) {
  return {
    condition: condition ?? "not_recorded",
    temp_c: null, humidity_pct: null, wind_kph: null, wind_dir: null, rain_chance_pct: null,
    forecast: null,
    playable: playable !== false,
    observed_at: new Date(at).toISOString(),
  };
}

/**
 * A "weather change" entry: what it became, at which over and ball. `over` is
 * the overs completed and `ball` the balls into the next one (7 and 3 is "7.3").
 * @param {{condition?: string | null, playable?: boolean | null, innings: number, balls: number, note?: string, at?: number}} o
 */
export function weatherChange({ condition = null, playable = null, innings, balls, note = "", at = Date.now() }) {
  return {
    id: `wc-${at.toString(36)}`,
    at: new Date(at).toISOString(),
    condition, playable,
    innings: innings + 1,
    over: Math.floor(balls / 6), ball: balls % 6,
    note: String(note ?? "").trim().slice(0, 140),
  };
}

/** "Rain, play not possible, 2nd innings, 7.3 overs" @param {ReturnType<typeof weatherChange>} c */
export function weatherChangeWords(c) {
  const bits = [];
  if (c.condition) bits.push(conditionLabel(c.condition) ?? c.condition);
  if (c.playable === false) bits.push("not playable"); else if (c.playable === true && !c.condition) bits.push("playable");
  if (c.note) bits.push(c.note);
  const ord = c.innings === 1 ? "1st" : c.innings === 2 ? "2nd" : `${c.innings}th`;
  return `${bits.join(", ") || "Weather changed"} — ${ord} innings, ${c.over}.${c.ball} overs`;
}

// ── The setup, as a draft ────────────────────────────────────────────

const DRAFT_KEY = "practice:draft";

/** The setup before it is started: blank. */
export function blankDraft() {
  return {
    v: 1, step: 0, overs: 20, oversCustom: false, oversText: "20", venue: { name: "", lat: null, lon: null, accuracy_m: null },
    weather: { condition: null, playable: true },
    captureProfile: "full",
    teams: [{ school: "", division: "", cls: "" }, { school: "", division: "", cls: "" }],
    squads: [[], []],
    toss: 0, bat: 0,
  };
}

/** @param {any} d */
export async function saveDraft(d) { return putRecord(DRAFT_KEY, { ...d, savedAt: Date.now() }); }
export async function loadDraft() {
  const d = await getRecord(DRAFT_KEY);
  return d && d.v === 1 && Array.isArray(d.teams) && Array.isArray(d.squads) ? d : null;
}
export async function clearDraft() { return deleteRecord(DRAFT_KEY); }

// ── Where the phone is ───────────────────────────────────────────────

/**
 * The phone's position, asked ONCE: one call to the browser's
 * getCurrentPosition, so one permission prompt however slow it is. It gives
 * up after `timeoutMs`. Never throws; the answer says what happened, and the
 * scorer types the venue when it is anything but "ok".
 *
 * The position stays on the phone. It is not sent anywhere — the weather
 * hint (lib/weatherHint.js) is the only thing that may one day take it, and
 * only as rounded coordinates.
 *
 * @param {{timeoutMs?: number, geo?: Geolocation | null}} [o]
 * @returns {Promise<{status: "ok", lat: number, lon: number, accuracy_m: number | null} | {status: "denied" | "slow" | "unavailable" | "unsupported"}>}
 */
export function locate({ timeoutMs = 8000, geo = typeof navigator !== "undefined" ? navigator.geolocation ?? null : null } = {}) {
  if (!geo) return Promise.resolve({ status: "unsupported" });
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    // The browser's own timeout does not start until the person has answered
    // the prompt; this one is ours, so a phone that never answers is not waited on.
    const t = setTimeout(() => finish({ status: "slow" }), timeoutMs + 2000);
    try {
      geo.getCurrentPosition(
        (p) => finish({
          status: "ok",
          lat: Math.round(p.coords.latitude * 1e5) / 1e5,
          lon: Math.round(p.coords.longitude * 1e5) / 1e5,
          accuracy_m: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null,
        }),
        (e) => finish({ status: e?.code === 1 ? "denied" : e?.code === 3 ? "slow" : "unavailable" }),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 },
      );
    } catch { finish({ status: "unavailable" }); }
  });
}

// ── Starting the match ───────────────────────────────────────────────

/** A fresh id: `practice-` then something nobody else has. */
export function newPracticeId() {
  const rnd = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${PRACTICE_ID_PREFIX}${Date.now().toString(36)}-${rnd}`;
}

/**
 * The config the scorer's startMatch(cfg) takes (scorer/engine.jsx:829), from
 * a finished draft and the three names setup's last step chose.
 *
 * It is exactly what the standalone setup builds (scorer/setup.jsx:618-626):
 * `toss` is the index of the side that won it, `bat` is 0 to bat and 1 to
 * bowl, and the squads, twelfth men and team keys are ordered by who bats
 * first — so the engine reads the batting side's names from teamKey1. The
 * sides' names are the keys; they are not in INT_TEAMS, so startMatch falls
 * back to the squads it is given for the bowling lists.
 *
 * @param {ReturnType<typeof blankDraft>} draft
 * @param {{id: string, opener1: string, opener2: string, openBowler: string}} pick
 */
export function practiceCfg(draft, { id, opener1, opener2, openBowler }) {
  const names = draft.teams.map(practiceTeamName);
  const lu = draft.squads.map(lineUp);
  const first = draft.bat === 0 ? draft.toss : 1 - draft.toss;
  const b = first, f = 1 - first;
  return {
    practice: true, matchId: id,
    team1: names[0], team2: names[1],
    overs: oversOf(draft.overs) ?? 20, toss: draft.toss, bat: draft.bat, captureProfile: draft.captureProfile,
    squad1: lu[b].xi, squad2: lu[f].xi,
    twelfth1: lu[b].twelfth, twelfth2: lu[f].twelfth,
    teamKey1: names[b], teamKey2: names[f],
    opener1, opener2, openBowler,
  };
}

/**
 * The record kept beside the ball log, in the shapes phase 2 maps from.
 * Sides are `home` (the first team typed) and `away`.
 * @param {ReturnType<typeof blankDraft>} draft @param {string} id
 */
export function practiceRecord(draft, id, now = Date.now()) {
  const sides = ["home", "away"];
  const players = [];
  const match_squad = [];
  draft.squads.forEach((sq, s) => {
    const lu = lineUp(sq);
    sq.forEach((p, i) => {
      const pid = `${id}:${sides[s]}:${i + 1}`;
      players.push({ id: pid, side: sides[s], full_name: p.name });
      const batting_no = p.twelfth ? null : lu.xi.indexOf(p.name) >= 0 ? lu.xi.indexOf(p.name) + 1 : null;
      match_squad.push({ side: sides[s], player_id: pid, batting_no, twelfth: !!p.twelfth });
    });
  });
  const v = draft.venue ?? {};
  const hasPos = typeof v.lat === "number" && typeof v.lon === "number";
  const w = draft.weather?.condition ? weatherRecord({ condition: draft.weather.condition, playable: draft.weather.playable, at: now }) : null;
  return {
    v: 1, id, createdAt: now, updatedAt: now, status: "in_progress",
    match: {
      id, practice: true, overs: oversOf(draft.overs) ?? 20,
      starts_at: new Date(now).toISOString(),
      venue: { name: String(v.name ?? "").trim(), lat: hasPos ? v.lat : null, lon: hasPos ? v.lon : null, accuracy_m: hasPos ? v.accuracy_m ?? null : null },
      toss: { won_by: sides[draft.toss], decision: draft.bat === 0 ? "bat" : "bowl" },
    },
    teams: draft.teams.map((t, s) => ({
      side: sides[s], school: t.school.trim(), age_division: t.division, team_class: t.cls, display_name: practiceTeamName(t),
    })),
    players, match_squad,
    match_weather: w,
    weather_changes: [],
  };
}

/**
 * What the pad's `match` is, rebuilt from the record, for a log saved without
 * its cfg. Only the names the header reads; the log carries everything else.
 * @param {any} rec @param {string} id
 */
export function cfgFromRecord(rec, id) {
  return {
    practice: true, matchId: id,
    team1: rec?.teams?.[0]?.display_name ?? "Team 1", team2: rec?.teams?.[1]?.display_name ?? "Team 2",
    overs: rec?.match?.overs ?? 20,
  };
}

// ── The store ────────────────────────────────────────────────────────

const META = "practice:meta:";
const LOG = "practice:log:";

export async function savePractice(rec) { return putRecord(META + rec.id, { ...rec, updatedAt: Date.now() }); }
export async function loadPractice(id) { return getRecord(META + id); }

/** Merge a patch into a stored record and keep it. @param {string} id @param {object} patch */
export async function updatePractice(id, patch) {
  const cur = await loadPractice(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  return (await putRecord(META + id, next)) ? next : null;
}

/**
 * One match as the list shows it, from its record and its log: who, the score
 * of each innings, whether it is over, and when it was last saved.
 * @param {any} meta @param {any} log
 */
export function summarise(meta, log) {
  const events = Array.isArray(log?.events) ? log.events : [[], []];
  const innings = (() => { try { return foldPad(events, {}).filter((i) => i && i.battingTeam); } catch { return []; } })();
  const lines = innings.map((i) => ({ team: i.battingTeam, runs: i.runs, wickets: i.wickets, balls: i.balls, overs: i.overs }));
  const complete = innings.length >= 2 && innings[1]?.sealed === true;
  return {
    id: meta?.id ?? null,
    title: meta?.teams?.length === 2 ? `${meta.teams[0].display_name} v ${meta.teams[1].display_name}` : "Practice match",
    startedAt: meta?.match?.starts_at ?? null,
    venue: meta?.match?.venue?.name || null,
    lines, complete,
    savedAt: log?.savedAt ?? meta?.updatedAt ?? null,
  };
}

/**
 * Every practice match on this phone, newest save first. A log with no record
 * (the record's write was the one that failed) is still listed, so it can be
 * deleted.
 */
export async function listPractice() {
  const metaKeys = (await recordKeys(META)) ?? [];
  const logKeys = (await recordKeys(LOG)) ?? [];
  const ids = [...new Set([...metaKeys.map((k) => k.slice(META.length)), ...logKeys.map((k) => k.slice(LOG.length))])];
  const rows = [];
  for (const id of ids) {
    const [meta, log] = await Promise.all([loadPractice(id), loadMatch(id)]);
    rows.push({ id, meta, ...summarise(meta ?? { id }, log) });
  }
  return rows.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

/** The match to offer "Resume" for: the most recently saved one that is not over, or null. */
export async function inProgressPractice() {
  return (await listPractice()).find((r) => !r.complete) ?? null;
}

/**
 * Remove one practice match: its record (names, teams, weather) and its balls,
 * and anything set aside for it. Resolves true when nothing of it is left.
 * @param {string} id
 */
export async function deletePractice(id) {
  if (!isPracticeId(id)) return false;
  await clearMatch(id);
  await deleteRecord(META + id);
  for (const k of (await recordKeys(`aside:${id}:`)) ?? []) await deleteRecord(k);
  const left = await recordKeys("");
  return !!left && !left.some((k) => k.includes(id));
}

/**
 * Remove every practice match, the draft, and anything set aside — every key
 * under the practice prefixes — and check. Resolves `{removed, left}`.
 */
export async function deleteAllPractice() {
  const keys = [...((await recordKeys("practice:")) ?? []), ...((await recordKeys(`aside:${PRACTICE_ID_PREFIX}`)) ?? [])];
  for (const k of keys) await deleteRecord(k);
  const left = [...((await recordKeys("practice:")) ?? []), ...((await recordKeys(`aside:${PRACTICE_ID_PREFIX}`)) ?? [])];
  return { removed: keys.length, left: left.length };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today 10:42", "Yesterday 17:05", "3 Oct 14:30", in this phone's clock. @param {number | null} ts */
export function savedWords(ts, now = Date.now()) {
  if (typeof ts !== "number") return "not saved yet";
  const d = new Date(ts), n = new Date(now);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  if (diff === 0) return `today ${hm}`;
  if (diff === 1) return `yesterday ${hm}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hm}`;
}

/** The time alone when it was today ("10:42"), else as savedWords says it. @param {number | null} ts */
export function savedClock(ts, now = Date.now()) {
  const w = savedWords(ts, now);
  return w.startsWith("today ") ? w.slice(6) : w;
}
