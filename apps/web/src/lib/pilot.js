/**
 * SCRBRD — Pilot Match, phase 2: the phone's half (slice 3).
 *
 * docs/design/PILOT_MATCH_PHASE2.md. A Pilot Match is today's Practice Match
 * with phase 2 switched on: the same setup, the same pad, and the match sent
 * to SCRBRD so the scorer can carry on on another phone (and, from slice 4,
 * share a live link). Everything here is BEHIND THE SWITCH: the server's
 * `pilot_sync` (db/151, off as shipped) decides whether the start screen
 * offers "Send live to SCRBRD" at all, and its `pilot_names_upload` whether
 * the typed names go (counsel's §14 is unanswered: off, they stay here).
 *
 * WHAT IS DIFFERENT FROM PHASE 1
 * ─────────────────────────────
 *   - Its id starts `pilot-` (then the server's uuid), and every key of its
 *     own starts `pilot:` (persist.js routes the log):
 *
 *         pilot:meta:<id>   the record (practice.js practiceRecord's shape,
 *                           players keyed by SLOT id) and `pilot`, below
 *         pilot:log:<id>    the ball log, written by persist.js saveMatch()
 *         pilot:draft       the setup, once "Send live" is chosen
 *
 *   - It is scored on SLOT ids (§3.2): each typed player gets a uuid when the
 *     match starts, the squads are {id, name} objects, and the pad shows
 *     names from them as it shows a fixture's players. lib/pilotWire.js maps
 *     every event to its wire form; nothing leaves here with a name in it.
 *   - lib/sync.js PadSync opens its outbox in pilot mode: the real engine,
 *     with /api/pilot routes and pilotWire() before the transport.
 *
 * WHAT IS THE SAME: phase 1's promise. A `practice-` match stays on its phone
 * forever, and the three locks (persist.js matchKey, PadSync.open(),
 * PadSync.call()) are untouched. Nothing turns a practice id into a pilot id.
 * The one conversion is the other way: a Pilot Match the server refuses at
 * first contact (no grant, or phase 2 switched off) is re-keyed under
 * `practice:` and stays on this phone (demoteToPractice, §3.3 step 2).
 *
 * THE NAMES' DATE (§7.2). The names on this phone go 30 days after the
 * match's end, as the server's do: purgeExpiredNames() runs on each open of
 * the start screen, and the pad then shows positions ("Home No. 3").
 */
import {
  PILOT_ID_PREFIX, PRACTICE_ID_PREFIX, isPilotId, putRecord, getRecord, deleteRecord, recordKeys, loadMatch, saveMatch, clearMatch,
} from "./persist.js";
import { api, signedIn } from "./api.js";
import { profile } from "./session.js";
import { lineUp, practiceTeamName, oversOf, practiceRecord, summarise } from "./practice.js";
import { positionWords, pilotUnwire, holdsAName } from "./pilotWire.js";
import { indexedDbStorage, padLogFrom, inningsInPlay } from "@scrbrd/sync";
import { fromRow } from "@scrbrd/scoring";
import { deviceId } from "./device.js";

export { isPilotId, PILOT_ID_PREFIX };

const META = "pilot:meta:";
export const PILOT_DRAFT_KEY = "pilot:draft";
/** The typed names' period after the end (Q1, Kameel 11 Nov 2026). */
export const NAMES_DAYS = 30;
const DAY = 86400000;

/** The words, as §3.3 and §3.6 give them. */
export const PILOT_WORDS = Object.freeze({
  sendLive: "Send live to SCRBRD",
  keepHere: "Keep on this phone only",
  // §3.6, for Kameel to approve: where names are typed, before any exists.
  notice: "These names are sent to SCRBRD so you can carry on scoring on another phone. They are never shown publicly: the live page shows the score and team names only. They are deleted 30 days after the match ends. Delete the match and they go at once.",
  // While the counsel fallback is on (§14 item 1) the names are not sent,
  // and the notice must not say they are. NOT IN THE DESIGN: drafted here,
  // for Kameel to approve with the one above.
  noticeNamesHere: "These names stay on this phone. SCRBRD is sent the score and each player's position, never a name. Delete the match and the names go at once.",
  // §3.3 step 2.
  refused: "This match stays on this phone. Your account can't send Pilot Matches.",
  notGranted: "Your account can't send Pilot Matches. This match will stay on this phone.",
});

// ── Ids ──────────────────────────────────────────────────────────────

/** A v4 uuid, where the page has no crypto.randomUUID (an http:// origin). */
function uuid() {
  try { if (globalThis.crypto?.randomUUID) return crypto.randomUUID(); } catch { /* fall through */ }
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** `pilot-` and the uuid the server will know it by. */
export const newPilotId = () => `${PILOT_ID_PREFIX}${uuid()}`;
/** The server's id for a pilot id, or null. @param {unknown} id */
export const pilotUuid = (id) => (isPilotId(id) ? /** @type {string} */ (id).slice(PILOT_ID_PREFIX.length) : null);

// ── May this account send one? ───────────────────────────────────────
//
// Asked of the server (GET /api/pilot/status) when there is a sign-in and a
// signal, and remembered per account on this phone, so the start screen can
// still offer "Send live" on a ground with no signal. Remembered only as a
// convenience: the server decides again at first contact (§3.3 step 2).

const STATUS_KEY = "scrbrd:pilot-status";
const readCache = () => {
  try { const all = JSON.parse(globalThis.localStorage?.getItem(STATUS_KEY) ?? "{}"); return all && typeof all === "object" ? all : {}; }
  catch { return {}; }
};
const userKey = () => profile()?.user?.id ?? null;

/**
 * `{sync, granted, names}` for this account, or null when nothing is known.
 * @param {{get?: typeof api}} [o]
 */
export async function pilotStatus({ get = api } = {}) {
  const who = userKey();
  if (signedIn()) {
    try {
      const r = await get("/api/pilot/status", { timeoutMs: 4000 });
      const s = { sync: r?.sync === true, granted: r?.granted === true, names: r?.names === true, at: Date.now() };
      if (who) {
        try { const all = readCache(); all[who] = s; globalThis.localStorage?.setItem(STATUS_KEY, JSON.stringify(all)); } catch { /* a convenience */ }
      }
      return s;
    } catch { /* no answer: what this phone last heard, below */ }
  }
  return who ? readCache()[who] ?? null : null;
}

/** May the start screen offer "Send live" (phase 2 on, this account granted)? @param {any} s */
export const mayOfferLive = (s) => !!(s && s.sync && s.granted);

// ── The slots, the roster, the config, the record ────────────────────

/**
 * Each typed player as a slot (§1): his side, his place in the list (1–15),
 * his batting number in the XI (1–11) or none, the twelfth man. A fresh uuid
 * each; no name. `roster` is the phone's own map from slot to name.
 * @param {any} draft  practice.js blankDraft()'s shape
 */
export function pilotSlots(draft) {
  const sides = /** @type {const} */ (["home", "away"]);
  /** @type {{id: string, side: "home" | "away", list_no: number, batting_no: number | null, twelfth: boolean}[]} */
  const slots = [];
  /** @type {import("./pilotWire.js").PilotRoster} */
  const roster = { slots: {}, teams: { home: practiceTeamName(draft.teams[0]), away: practiceTeamName(draft.teams[1]) } };
  draft.squads.forEach((/** @type {any[]} */ sq, /** @type {number} */ s) => {
    const xi = lineUp(sq).xi;
    sq.forEach((p, i) => {
      const id = uuid();
      const batting_no = p.twelfth ? null : xi.indexOf(p.name) >= 0 ? xi.indexOf(p.name) + 1 : null;
      slots.push({ id, side: sides[s], list_no: i + 1, batting_no, twelfth: !!p.twelfth });
      roster.slots[id] = { side: sides[s], list_no: i + 1, name: p.name };
    });
  });
  return { slots, roster };
}

/**
 * The pad's config (startMatch(cfg)), as practice.js practiceCfg makes it,
 * but scored on slot ids: the squads are {id, name}, and the openers and the
 * opening bowler their slots. The sides' names stay the pad's keys (it shows
 * them); pilotWire() sends them as home and away.
 * @param {any} draft @param {{id: string, opener1: string, opener2: string, openBowler: string}} pick
 * @param {ReturnType<typeof pilotSlots>} p
 */
export function pilotCfg(draft, { id, opener1, opener2, openBowler }, p) {
  const names = draft.teams.map(practiceTeamName);
  const sides = ["home", "away"];
  const first = draft.bat === 0 ? draft.toss : 1 - draft.toss;
  const b = first, f = 1 - first;
  /** @param {number} s */
  const squadOf = (s) => {
    const xi = lineUp(draft.squads[s]).xi;
    return xi.map((name) => {
      const sl = Object.entries(p.roster.slots).find(([, x]) => x.side === sides[s] && x.name === name);
      return { id: sl?.[0] ?? name, name };
    });
  };
  /** @param {number} s @param {string} name */
  const slotFor = (s, name) => squadOf(s).find((x) => x.name === name)?.id ?? name;
  return {
    practice: true, pilot: true, matchId: id,
    team1: names[0], team2: names[1],
    overs: oversOf(draft.overs) ?? 20, toss: draft.toss, bat: draft.bat, captureProfile: draft.captureProfile,
    squad1: squadOf(b), squad2: squadOf(f),
    twelfth1: lineUp(draft.squads[b]).twelfth, twelfth2: lineUp(draft.squads[f]).twelfth,
    teamKey1: names[b], teamKey2: names[f],
    opener1: slotFor(b, opener1), opener2: slotFor(b, opener2), openBowler: slotFor(f, openBowler),
  };
}

/**
 * The record: practice.js practiceRecord()'s shapes (so the list, the
 * scorecard file and the weather read it alike), with each player keyed by
 * his slot, and `pilot`: the slots, the roster, and where it stands with
 * the server. `namesMayGo` is what the notice the scorer read said (§3.6):
 * the names go to the server only if it said they would.
 * @param {any} draft @param {string} id @param {ReturnType<typeof pilotSlots>} p
 * @param {number} [now] @param {{namesMayGo?: boolean}} [o]
 */
export function pilotRecord(draft, id, p, now = Date.now(), { namesMayGo = false } = {}) {
  const rec = practiceRecord(draft, id, now);
  const sides = ["home", "away"];
  const bySide = (/** @type {string} */ side, /** @type {number} */ n) => p.slots.find((s) => s.side === side && s.list_no === n)?.id;
  /** @type {Record<string, string>} */
  const rekey = {};
  for (const pl of rec.players) {
    const [, side, n] = String(pl.id).split(":").slice(-3);
    const sid = bySide(side, Number(n));
    if (sid) rekey[pl.id] = sid;
  }
  rec.players = rec.players.map((/** @type {any} */ pl) => ({ ...pl, id: rekey[pl.id] ?? pl.id }));
  rec.match_squad = rec.match_squad.map((/** @type {any} */ m) => ({ ...m, player_id: rekey[m.player_id] ?? m.player_id }));
  rec.match = { ...rec.match, practice: false, pilot: true };
  return {
    ...rec,
    pilot: {
      v: 1, slots: p.slots, roster: p.roster,
      // Where it stands with the server: "pending" until pilot_create has
      // answered, "created", or "refused" (then it is a Practice Match).
      server: "pending", namesSent: false, namesMayGo, sides,
      // The names' date on this phone runs from the end (endOf, below).
    },
  };
}

/**
 * What pilot_create is sent (§3.3 step 2): the sides, the slots, the overs,
 * the start, the toss and the weather's conditions. No name of a player, no
 * position of the phone, and never the venue's name, which stays here (the
 * review's S4: a ground typed as a child's farm is a child's whereabouts).
 *
 * A side's school and display name are free text a scorer typed, so they go
 * only where the names may go (`sidesMayGo`: the notice said so, and the
 * server says names may) and hold no typed name as whole words. Otherwise
 * the side goes as its place and its age group — "Home", "Home U13B" — and
 * its real name stays on this phone.
 * @param {any} rec @param {{sidesMayGo?: boolean}} [o]
 */
export function createBody(rec, { sidesMayGo = false } = {}) {
  const w = rec.match_weather;
  const roster = rec.pilot.roster;
  return {
    id: pilotUuid(rec.id),
    sides: rec.teams.map((/** @type {any} */ t) => {
      const real = sidesMayGo && !holdsAName(t.school, roster) && !holdsAName(t.display_name, roster);
      const place = t.side === "away" ? "Away" : "Home";
      return { side: t.side, school: real ? t.school : place, age_division: t.age_division || null, team_class: t.team_class || null,
               display_name: real ? t.display_name : practiceTeamName({ school: place, division: t.age_division, cls: t.team_class }) };
    }),
    slots: rec.pilot.slots,
    overs: rec.match.overs, format: null, startsAt: rec.match.starts_at,
    toss: { wonBy: rec.match.toss.won_by, decision: rec.match.toss.decision },
    venueName: null,
    weather: w ? { condition: w.condition, temp_c: w.temp_c, humidity_pct: w.humidity_pct, wind_kph: w.wind_kph,
                   wind_dir: w.wind_dir, rain_chance_pct: w.rain_chance_pct, playable: w.playable } : null,
  };
}

/** What pilot_names_put is sent: each slot's typed name. Only ever after the server said names may go. @param {any} rec */
export const namesBody = (rec) => ({
  rows: Object.entries(rec.pilot.roster.slots).filter(([, s]) => s.name).map(([slot, s]) => ({ slot, name: s.name })),
});

// ── The store ────────────────────────────────────────────────────────

/** @param {any} rec */
export async function savePilot(rec) { return putRecord(META + rec.id, { ...rec, updatedAt: Date.now() }); }
/** @param {string} id */
export async function loadPilot(id) { return isPilotId(id) ? getRecord(META + id) : null; }
/** Merge a patch into the record's `pilot`. @param {string} id @param {object} patch */
export async function updatePilotState(id, patch) {
  const cur = await loadPilot(id);
  if (!cur) return null;
  const next = { ...cur, pilot: { ...cur.pilot, ...patch }, updatedAt: Date.now() };
  return (await putRecord(META + id, next)) ? next : null;
}

/** Every Pilot Match on this phone, newest save first (practice.js summarise's rows). */
export async function listPilot() {
  const metaKeys = (await recordKeys(META)) ?? [];
  const logKeys = (await recordKeys("pilot:log:")) ?? [];
  const ids = [...new Set([...metaKeys.map((k) => k.slice(META.length)), ...logKeys.map((k) => k.slice("pilot:log:".length))])];
  const rows = [];
  for (const id of ids) {
    const [meta, log] = await Promise.all([loadPilot(id), loadMatch(id)]);
    rows.push({ id, meta, ...summarise(meta ?? { id }, log), title: meta?.teams?.length === 2 ? `${meta.teams[0].display_name} v ${meta.teams[1].display_name}` : "Pilot match" });
  }
  return rows.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

/** This match's outbox on this phone (packages/sync), removed. @param {string} id */
async function clearOutbox(id) {
  try { if (typeof indexedDB !== "undefined") await indexedDbStorage({ matchId: id, deviceId: deviceId() }).clearMatch(); } catch { /* none */ }
}

/**
 * Remove one Pilot Match from this phone: the record (names, teams,
 * weather), the balls, its outbox and anything set aside. Resolves true when
 * nothing of it is left here. The server's copy is pilot_delete's (the list's
 * "Delete everywhere" calls both).
 * @param {string} id
 */
export async function deletePilotHere(id) {
  if (!isPilotId(id)) return false;
  await clearMatch(id);
  await deleteRecord(META + id);
  await clearOutbox(id);
  for (const k of (await recordKeys(`aside:${id}:`)) ?? []) await deleteRecord(k);
  const left = await recordKeys("");
  return !!left && !left.some((k) => k.includes(id));
}

/** Every `pilot:` key, the pilot draft and anything set aside for one, gone. Resolves `{removed, left}`. */
export async function deleteAllPilotHere() {
  const ids = ((await recordKeys(META)) ?? []).map((k) => k.slice(META.length));
  for (const id of ids) await clearOutbox(id);
  const keys = [...((await recordKeys("pilot:")) ?? []), ...((await recordKeys(`aside:${PILOT_ID_PREFIX}`)) ?? [])];
  for (const k of keys) await deleteRecord(k);
  const left = [...((await recordKeys("pilot:")) ?? []), ...((await recordKeys(`aside:${PILOT_ID_PREFIX}`)) ?? [])];
  return { removed: keys.length, left: left.length };
}

/** The server's delete, for "Delete everywhere". Throws when there was no answer. @param {string} id */
export async function deletePilotOnServer(id, { call = api } = {}) {
  const u = pilotUuid(id);
  if (!u) return { ok: false };
  try { return await call(`/api/pilot/${u}/delete`, { method: "POST" }); }
  catch (e) { if (/** @type {any} */ (e)?.status === 404) return { ok: true, gone: true }; throw e; }
}

/**
 * §3.3 step 2: the server refused this match (no grant, or phase 2 off), so
 * it stays on this phone as a Practice Match. Its record and its log move
 * under `practice:` with a practice id, its outbox goes, and the pilot keys
 * are deleted. Never the other way. Resolves the new practice id, or null.
 * @param {string} id
 */
export async function demoteToPractice(id) {
  if (!isPilotId(id)) return null;
  const [rec, log] = await Promise.all([loadPilot(id), loadMatch(id)]);
  const pid = `${PRACTICE_ID_PREFIX}${Date.now().toString(36)}-${pilotUuid(id)?.slice(0, 8) ?? "x"}`;
  if (rec) {
    const { pilot: _p, ...rest } = rec;
    const ok = await putRecord(`practice:meta:${pid}`, { ...rest, id: pid, match: { ...rest.match, id: pid, practice: true, pilot: false }, demotedFromPilot: true, updatedAt: Date.now() });
    if (!ok) return null;
  }
  if (log) {
    const cfg = log.cfg ? { ...log.cfg, matchId: pid, pilot: false, practice: true } : log.cfg;
    if (!(await saveMatch(pid, { ...log, cfg }))) return null;
  }
  await deletePilotHere(id);
  return pid;
}

// ── The names' date, on this phone (§7.2) ────────────────────────────

/**
 * The end of a match as this phone knows it (§1): the latest of its finish
 * on the pad and its last event, or its start while it has neither. Never
 * its last save: opening a finished match saves it again, and that must not
 * move the names' date.
 * @param {any} rec @param {any} log
 */
export function endOf(rec, log) {
  let last = 0;
  for (const evs of Array.isArray(log?.events) ? log.events : []) for (const e of evs ?? []) if (Number.isFinite(e?.clientTs)) last = Math.max(last, e.clientTs);
  return Math.max(rec?.pilot?.finishedAt ?? 0, last, rec?.createdAt ?? 0);
}

/**
 * A record and its log with every typed name replaced by the player's
 * position. The squads in the log's innings_start events too: they carry
 * the names the pad shows.
 * @param {any} rec @param {any} log
 */
export function withoutNames(rec, log) {
  const roster = rec.pilot.roster;
  const slots = Object.fromEntries(Object.entries(roster.slots).map(([id, s]) => [id, { ...s, name: null }]));
  const pos = (/** @type {string} */ sid) => (slots[sid] ? positionWords(slots[sid].side, slots[sid].list_no) : null);
  const byName = new Map(Object.entries(roster.slots).filter(([, s]) => s.name).map(([id, s]) => [s.name, id]));
  const scrubP = (/** @type {any} */ p) => (p && typeof p === "object" && p.id && slots[p.id] ? { ...p, name: pos(p.id) } : p);
  const scrubName = (/** @type {any} */ n) => (typeof n === "string" && byName.has(n) ? pos(/** @type {string} */ (byName.get(n))) : n);
  const events = Array.isArray(log?.events)
    ? log.events.map((/** @type {any[]} */ evs) => (evs ?? []).map((e) => ({
        ...e,
        ...(Array.isArray(e.squad) ? { squad: e.squad.map(scrubP) } : {}),
        ...(Array.isArray(e.bowlingSquad) ? { bowlingSquad: e.bowlingSquad.map(scrubP) } : {}),
        ...(e.twelfthMan != null ? { twelfthMan: scrubName(e.twelfthMan) } : {}),
        ...(e.fielder != null ? { fielder: scrubName(e.fielder) } : {}),
      })))
    : log?.events;
  const cfg = log?.cfg ? {
    ...log.cfg,
    squad1: (log.cfg.squad1 ?? []).map(scrubP), squad2: (log.cfg.squad2 ?? []).map(scrubP),
    twelfth1: scrubName(log.cfg.twelfth1), twelfth2: scrubName(log.cfg.twelfth2),
  } : log?.cfg;
  return {
    rec: { ...rec, players: rec.players.map((/** @type {any} */ p) => ({ ...p, full_name: pos(p.id) ?? p.full_name })),
           pilot: { ...rec.pilot, roster: { ...roster, slots }, namesPurged: true } },
    log: log ? { ...log, events, cfg } : log,
  };
}

/**
 * On each open: every Pilot Match on this phone whose names' date has
 * passed loses its names here, as on the server. The match stays, on
 * positions. Resolves how many were purged.
 */
export async function purgeExpiredNames(now = Date.now()) {
  let n = 0;
  for (const k of (await recordKeys(META)) ?? []) {
    const id = k.slice(META.length);
    const [rec, log] = await Promise.all([loadPilot(id), loadMatch(id)]);
    if (!rec?.pilot || rec.pilot.namesPurged) continue;
    // The phone's copy must not outlive the server's (§7.2): the earlier of
    // the server's date, where this phone has heard it, and its own.
    const mine = endOf(rec, log) + NAMES_DAYS * DAY;
    const theirs = Date.parse(rec.pilot.serverNamesPurgeAfter ?? "");
    const due = Number.isFinite(theirs) ? Math.min(theirs, mine) : mine;
    if (now < due) continue;
    const out = withoutNames(rec, log);
    await putRecord(META + id, out.rec);
    if (log) await saveMatch(id, out.log);
    n += 1;
  }
  return n;
}

// ── Another phone, the same account (§3.3 step 5) ────────────────────

/**
 * A Pilot Match this account has on the server and this phone does not:
 * its header, its names (until their date, and only if they were sent), and
 * its nameless log, put on this phone as the record and the log the pad
 * opens. The pad then finds the server's log the same as its own and asks
 * for the token; another phone's lapsed lease is a Take over, a person's
 * press (db/126), never automatic. Resolves the pilot id.
 * @param {string} uuidOfMatch @param {{call?: typeof api}} [o]
 */
export async function restoreFromServer(uuidOfMatch, { call = api } = {}) {
  const h = await call(`/api/pilot/${uuidOfMatch}`);
  /** @type {{slot: string, name: string}[]} */
  let names;
  try { names = (await call(`/api/pilot/${uuidOfMatch}/names`))?.names ?? []; } catch { names = []; }
  const served = await call(`/api/pilot/${uuidOfMatch}/events`);
  const id = `${PILOT_ID_PREFIX}${uuidOfMatch}`;
  const nameOf = new Map(names.map((n) => [n.slot, n.name]));
  const side = (/** @type {string} */ s) => (h.sides ?? []).find((/** @type {any} */ x) => x.side === s) ?? {};
  /** @type {import("./pilotWire.js").PilotRoster} */
  const roster = {
    slots: Object.fromEntries((h.slots ?? []).map((/** @type {any} */ s) => [s.id, { side: s.side, list_no: s.list_no, name: nameOf.get(s.id) ?? null }])),
    teams: { home: side("home").display_name ?? "Home", away: side("away").display_name ?? "Away" },
  };
  const now = Date.now();
  const rec = {
    v: 1, id, createdAt: Date.parse(h.startsAt) || now, updatedAt: now, status: h.status === "live" ? "in_progress" : "complete",
    match: { id, practice: false, pilot: true, overs: h.overs, starts_at: h.startsAt,
             venue: { name: h.venueName ?? "", lat: null, lon: null, accuracy_m: null },
             toss: { won_by: h.toss?.wonBy ?? null, decision: h.toss?.decision ?? null } },
    teams: ["home", "away"].map((s) => ({ side: s, school: side(s).school ?? "", age_division: side(s).age_division ?? "",
                                          team_class: side(s).team_class ?? "", display_name: side(s).display_name ?? s })),
    players: (h.slots ?? []).map((/** @type {any} */ s) => ({ id: s.id, side: s.side, full_name: nameOf.get(s.id) ?? positionWords(s.side, s.list_no) })),
    match_squad: (h.slots ?? []).map((/** @type {any} */ s) => ({ side: s.side, player_id: s.id, batting_no: s.batting_no, twelfth: s.twelfth })),
    match_weather: null, weather_observation: null, weather_changes: [],
    pilot: { v: 1, slots: h.slots ?? [], roster, server: "created", namesSent: true, namesMayGo: names.length > 0,
             sides: ["home", "away"], serverNamesPurgeAfter: h.namesPurgeAfter ?? null, restored: true },
  };
  const log = padLogFrom((served?.events ?? []).map((/** @type {any} */ r) => pilotUnwire(fromRow(r), roster)));
  const cfg = { practice: true, pilot: true, matchId: id, team1: roster.teams.home, team2: roster.teams.away, overs: h.overs ?? 20 };
  if (!(await savePilot(rec))) throw new Error("not_saved");
  if (!(await saveMatch(id, { events: log, curIn: inningsInPlay(log), cfg, serverHas: log.map((evs) => evs.length) }))) throw new Error("not_saved");
  return id;
}
