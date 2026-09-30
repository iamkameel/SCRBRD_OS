/**
 * The scorebook importer, in words (SCRBRD-120, phase 1; docs/design/
 * SCRBRD-120_scorebook_importer.md §6, §9.2).
 *
 * The rules are the API's and the database's: who may import, who may confirm,
 * what a card must add up to, and that two different people sign it. This
 * module holds none of them. It turns what the API answers into sentences a
 * scorer or a director of sport can act on, what a person types into the card
 * the API takes (null where the book gives nothing, never nought), and it
 * carries the two calls that are not JSON: a page's photo up, and down.
 *
 * WHAT A PAGE IS. A photograph of children's names in handwriting. It is
 * fetched with the bearer token into memory, shown, and forgotten: nothing
 * here writes one to localStorage, IndexedDB or a cache, or puts one in a URL
 * or a log (see fetchPage, uploadPage).
 *
 * No colour and no token in here, so the suite can run it under plain node.
 */
import { DISMISSAL_LABEL, summaryRefusal, uncheckedCells } from "@scrbrd/scoring";
import { ApiError, api, apiBase, getToken } from "./api.js";

// ── Who is offered what ─────────────────────────────────────────────────
//
// Nothing here guesses it from a role. The API answers `may: { write,
// confirm, read }` with the fixture's imports (and with each import), by the
// same checks its functions ask, and the screens draw from that alone.

/**
 * Has the fixture begun? A book is imported for a match already played; the API
 * says `not_yet_played` for the rest, and this only spares the offer.
 * @param {{startsAt?: unknown}} m @param {number} [now]
 */
export function startedYet(m, now = Date.now()) {
  const t = Date.parse(String(m?.startsAt ?? ""));
  return Number.isFinite(t) && t <= now;
}

// ── The states ──────────────────────────────────────────────────────────

/** Where an import stands, in words. */
export const STATE_WORDS = Object.freeze({
  draft: "Started: add the pages and type the card",
  reading: "The pages are being read: the card fills in when the reader answers",
  review: "The card is being typed",
  submitted: "Submitted: waiting to be confirmed",
  returned: "Returned with a note: it needs changes",
  confirmed: "Confirmed: it is the match's record",
  abandoned: "Abandoned",
});

/** A short label for a badge. */
export const STATE_SHORT = Object.freeze({
  draft: "Draft", reading: "Reading", review: "In review", submitted: "Submitted", returned: "Returned", confirmed: "Confirmed", abandoned: "Abandoned",
});

/** States in which the writer may still change the import. */
export const EDITABLE = Object.freeze(["draft", "review", "returned"]);
/** States an import can no longer leave. */
export const FINISHED = Object.freeze(["confirmed", "abandoned"]);

/** The revisions that make a person an author of the card (db/63 scorebook_authored()): a return or a confirm does not. */
const AUTHOR_ACTIONS = ["create", "pages", "read", "save", "submit"];

/**
 * Did this person open, type, photograph or submit the import? Then the API
 * will not let them confirm or return it (cannot_confirm_your_own). Asked so
 * the screen can say why in place of a button that would only be refused.
 * @param {string | null} me
 * @param {{createdBy?: string | null, submittedBy?: string | null}} imp
 * @param {Array<{actorId?: string | null, action: string}>} revisions
 */
export function workedOn(me, imp, revisions) {
  if (!me) return false;
  return imp?.createdBy === me || imp?.submittedBy === me
    || (revisions ?? []).some((r) => r.actorId === me && AUTHOR_ACTIONS.includes(r.action));
}

// ── A refusal, in plain words ───────────────────────────────────────────

const WORDS = {
  not_permitted: "You may not do that for this match.",
  module_disabled: "The scorebook importer is not switched on for this school.",
  version_conflict: "This import was changed by someone else since you opened it.",
  import_open: "This match already has an import open.",
  not_cricket: "Only a cricket fixture can take a scorebook.",
  not_yet_played: "This fixture has not been played yet, so there is no book to import.",
  match_abandoned: "This match was abandoned, so there is nothing to import.",
  match_complete: "This match is already complete. If its record is wrong, it is corrected by an amendment, then imported again.",
  page_too_large: "That photo is too large. Each page may be up to 8 MB; take it again at a lower quality or crop it.",
  not_an_image: "That file is not a JPEG or PNG photo, so it was not added.",
  image_unreadable: "That photo could not be read. Take it again and add it.",
  image_size: "That photo is too large in pixels. Take it again at a lower resolution.",
  not_editable: "This import can no longer be changed.",
  too_many_pages: "An import holds at most 12 pages.",
  duplicate_page: "That photo is already on this import.",
  key_invalid: "That photo could not be stored. Try adding it again.",
  store_unconfigured: "Photos cannot be stored on this server yet, so no page was added.",
  no_such_page: "There is no such page.",
  page_deleted: "This photo has been deleted.",
  page_removed: "This page was taken off the import.",
  page_missing: "This photo is no longer stored.",
  card_shape: "A figure on the card is not one the scorecard can hold. Check the cells marked below.",
  typed_invalid: "A name is empty or longer than 80 characters.",
  version_required: "The import's version was not sent. Reload the page and try again.",
  cells_unchecked: "Every cell needs a tick before the card is submitted.",
  card_refused: "The card does not add up yet. Fix the cells marked below.",
  not_submittable: "This import cannot be submitted as it stands.",
  no_card: "Add at least one innings to the card first.",
  innings_twice: "The same innings is on the card twice.",
  not_our_player: "A row names a player who is not one of this school's own. Choose our players from the roster.",
  cannot_confirm_your_own: "You worked on this card, so you cannot confirm or return it. Someone else has to.",
  not_submitted: "This import has not been submitted, or has already been decided.",
  note_required: "Say why in at least ten characters.",
  unreconciled_not_acknowledged: "The book's figures do not add up to its total. Tick that you have seen the difference to confirm it.",
  not_abandonable: "This import can no longer be abandoned.",
  not_in_this_phase: "That is not available yet.",
  summarised_innings: "An innings on this card is already recorded from a scorebook.",
  already_summarised: "An innings on this card is already recorded from a scorebook.",
  live_innings: "An innings on this card was scored on the pad. A book cannot replace it.",
  photo_not_sent: "The photo could not be sent. If it is over 8 MB, that is why; otherwise check the connection and add it again.",
  internal_error: "The server could not do that. Nothing was changed; try again.",
  store_get_failed: "The photo could not be fetched. Try again.",
  store_put_failed: "The photo could not be stored. Nothing was added; try again.",
  store_del_failed: "The photo could not be removed. Try again.",
  // The reader (phase 4).
  reading: "The pages are already being read. Wait for the reader to answer, then look again.",
  innings_on_card: "That innings is already on the card. Remove it from the card first to have it read again.",
  card_full: "The card already has four innings.",
  no_pages: "Add the page photos before the reader can read them.",
  innings_invalid: "Choose which innings to read.",
  side_required: "Say which side batted in this innings.",
};

/**
 * Why the reader did not fill the card (SCRBRD-120 §6.4), in words that send
 * the person to the manual path, which is always there.
 */
export const READER_WORDS = Object.freeze({
  off: "The scorebook reader is not switched on for this school. Type the card beside the pages.",
  unconfigured: "The scorebook reader is not available on this server. Type the card beside the pages.",
  unavailable: "The reader could not read the pages. Type the card beside them.",
  refused: "The reader would not read these pages. Type the card beside them.",
  timeout: "The reader took too long to answer. Type the card beside the pages, or try again.",
});

/** A read cell below this confidence is marked "check" (§6.3, an assumption). */
export const READ_CHECK_BELOW = 0.8;

/**
 * What the reader put in one cell, while the cell still holds it: its
 * confidence, page and box. Once the person changes the cell it is theirs,
 * and the reader's record is no longer shown for it.
 * @param {any} readCells  the import's readCells: innings → path → {c, p, b, v}
 * @param {any} card  @param {string} path  the path within the card
 * @returns {{c: number, p: number | null, b: number[] | null, v: unknown} | null}
 */
export function readCellOf(readCells, card, path) {
  const rc = readCells?.[String(card?.innings)]?.[path];
  if (!rc || typeof rc !== "object") return null;
  return (getPath(card, path) ?? null) === (rc.v ?? null) ? rc : null;
}

/** The code, read as words when it has none of its own: "some_code" → "some code". @param {string} c */
const plain = (c) => String(c).replace(/_/g, " ");

/**
 * What an ApiError (or anything thrown) says, in words a person can act on.
 * Never a code on its own.
 * @param {any} e  @param {{confirming?: boolean}} [ctx]
 */
export function refusalWords(e, ctx = {}) {
  const code = e?.code;
  if (e && !(e instanceof ApiError) && !code) return "The server did not answer. Nothing was changed; check the connection and try again.";
  if (code === "not_permitted" && ctx.confirming) {
    return "You may not confirm this import. A school's director of sport confirms a friendly; for a league fixture, the league's administrator does.";
  }
  if (code === "laws_refused") {
    const d = e.detail;
    return `The Laws refuse this record: ${d?.text ?? plain(d?.law ?? "refused")}. Nothing was written; the import stays submitted. Return it with a note.`;
  }
  if (code === "seal_refused") {
    const d = e.detail;
    const which = Number.isInteger(d?.innings) ? `Innings ${d.innings + 1}` : "An innings";
    return `${which} cannot be sealed: ${d?.text ?? plain(d?.seal ?? "refused")}. Nothing was written; return it with a note.`;
  }
  if (code === "cells_unchecked") {
    const n = Array.isArray(e.detail) ? e.detail.length : null;
    return n ? `${n} cell${n === 1 ? " still needs" : "s still need"} a tick before the card can be submitted.` : WORDS.cells_unchecked;
  }
  if (code === "import_open") return WORDS.import_open;
  if (!code) return "The server did not answer. Nothing was changed; try again.";
  if (WORDS[code]) return WORDS[code];
  if (e instanceof ApiError && e.status === 413) return WORDS.page_too_large;
  if (e instanceof ApiError && e.status === 415) return WORDS.not_an_image;
  return `That was refused (${plain(code)}). Nothing was changed.`;
}

// ── The card ────────────────────────────────────────────────────────────

/** The endings a card may have, in words. */
export const END_REASONS = Object.freeze([
  ["all_out", "All out"], ["overs", "The overs were bowled"], ["target", "The target was reached"],
  ["declared", "Declared"], ["time", "Time ran out"], ["other", "Some other way"],
]);

/** Every way a batter's innings can end on a card, in words. */
export const HOW_OUT = Object.freeze([
  ["not_out", "Not out"],
  ...["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket"].map((k) => [k, DISMISSAL_LABEL[k]]),
  ["retired_hurt", "Retired hurt"],
  ...["retired_out", "timed_out", "obstructing_field", "handled_ball", "hit_twice"].map((k) => [k, DISMISSAL_LABEL[k]]),
]);

/**
 * A new, empty card: every figure null, because the book has not been read
 * yet and nothing is ever filled with a nought on the screen's own initiative.
 * @param {number} innings  0 to 3  @param {"home" | "away"} battingSide
 */
export function blankCard(innings, battingSide) {
  return {
    v: 1, innings, battingSide, batting: [], "didNotBat": [], bowling: [],
    extras: { byes: null, legByes: null, wides: null, noBalls: null, penalty: null },
    total: null, wickets: null, overs: null, fallOfWickets: [], endReason: null, unreconciled: null,
  };
}

/** @param {number} order */
export const blankBatter = (order) => ({ order, ref: null, howOut: null, fielderRef: null, bowlerRef: null, runs: null, balls: null, fours: null, sixes: null });
export const blankBowler = () => ({ ref: null, overs: null, maidens: null, runs: null, wickets: null, wides: null, noBalls: null });
/** @param {number} wicket */
export const blankWicket = (wicket) => ({ wicket, score: null, ref: null, over: null });

/** A count typed into a box: digits only, four at most; nothing typed is null, not nought. @param {string} s */
export function countOf(s) {
  const d = String(s ?? "").replace(/[^0-9]/g, "").slice(0, 4);
  return d === "" ? null : Number(d);
}

/** Overs as a scorebook writes them ("17.3"): digits and one point. Nothing typed is null. @param {string} s */
export function oversOf(s) {
  const t = String(s ?? "").replace(/[^\d.]/g, "");
  const i = t.indexOf(".");
  const one = i < 0 ? t : t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, "");
  return one === "" ? null : one.slice(0, 6);
}

/** Read a dotted path out of a card. @param {any} o @param {string} path */
export function getPath(o, path) {
  return path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
}

/**
 * A copy of the card with one cell set (the card is never changed in place).
 * @template T
 * @param {T} card @param {string} path @param {unknown} value @returns {T}
 */
export function setPath(card, path, value) {
  const keys = path.split(".");
  const go = (/** @type {any} */ node, /** @type {number} */ i) => {
    const k = Array.isArray(node) ? Number(keys[i]) : keys[i];
    const copy = Array.isArray(node) ? node.slice() : { ...node };
    copy[/** @type {any} */ (k)] = i === keys.length - 1 ? value : go(node[/** @type {any} */ (k)], i + 1);
    return copy;
  };
  return go(card, 0);
}

/** The fielding side of a card. @param {"home" | "away"} side */
export const otherSide = (side) => (side === "home" ? "away" : "home");

/** "Innings 2", from the card's 0-based innings. @param {number} n */
export const inningsWord = (n) => `Innings ${n + 1}`;

// ── Cells: their names and their ticks ──────────────────────────────────

const FIELD_WORDS = {
  battingSide: "batting side", total: "total", wickets: "wickets", overs: "overs", endReason: "how it ended",
  "extras.byes": "byes", "extras.legByes": "leg byes", "extras.wides": "wides", "extras.noBalls": "no-balls", "extras.penalty": "penalty runs",
  ref: "name", howOut: "how out", fielderRef: "fielder", bowlerRef: "bowler", runs: "runs", balls: "balls", fours: "fours", sixes: "sixes",
  maidens: "maidens", wides: "wides", noBalls: "no-balls", wicket: "wicket number", score: "score", over: "over",
};

/**
 * A cell's path in a card (`batting.2.runs`), or in the import (`1.batting.2.runs`
 * with `withCard`), in words: "Batter 3, runs".
 * @param {string} path  @param {{withCard?: boolean}} [opts]
 */
export function cellWords(path, opts = {}) {
  const parts = path.split(".");
  let card = null;
  if (opts.withCard && /^\d+$/.test(parts[0])) card = Number(parts.shift());
  const [a, b, c] = parts;
  let words;
  if (a === "batting" && b !== undefined) words = c ? `Batter ${Number(b) + 1}, ${FIELD_WORDS[c] ?? c}` : `Batter ${Number(b) + 1}`;
  else if (a === "didNotBat" && b !== undefined) words = `Did not bat, name ${Number(b) + 1}`;
  else if (a === "bowling" && b !== undefined) words = c ? `Bowler ${Number(b) + 1}, ${c === "wickets" ? "wickets" : (FIELD_WORDS[c] ?? c)}` : `Bowler ${Number(b) + 1}`;
  else if (a === "fallOfWickets" && b !== undefined) words = c ? `Fall of wicket ${Number(b) + 1}, ${FIELD_WORDS[c] ?? c}` : `Fall of wicket ${Number(b) + 1}`;
  else if (a === "extras") words = `Extras, ${FIELD_WORDS[`extras.${b}`] ?? b}`;
  else if (a === "fallOfWickets") words = "Fall of wickets";
  else if (a === "bowling") words = "Bowling";
  else if (a === "unreconciled" || a === "unreconciled.runs") words = "The recorded difference";
  else words = (FIELD_WORDS[a] ?? a).replace(/^./, (s) => s.toUpperCase());
  return card === null ? words : `${inningsWord(card)}, ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

/**
 * The refusals of one card by the cell they name: `{"batting.3.runs": ["…"], …}`.
 * @param {Array<{path: string, text: string}>} refusals
 */
export function refusalsByCell(refusals) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const r of refusals ?? []) (out[r.path] ??= []).push(r.text);
  return out;
}

/**
 * The card's arithmetic, run where the person types: the same function the
 * server runs (@scrbrd/scoring summaryRefusal), so there is no second list of
 * rules to drift. `ours` is "home" for a fixture against another school and
 * "both" for one between two of the school's own sides.
 * @param {unknown[]} cards @param {Record<string, string>} typed @param {"home" | "both"} ours
 */
export function refusalsOf(cards, typed, ours) {
  return (cards ?? []).map((c) => summaryRefusal(c, { typed, ours }));
}

/**
 * A cell that has a value, or that its tick says the book has none: the
 * ticks a person still owes, as a count out of all the cells.
 * @param {unknown[]} cards @param {Record<string, true>} checked
 */
export function tickProgress(cards, checked) {
  return { left: uncheckedCells(cards, checked).length, total: allCellPaths(cards).length };
}

/** @param {unknown[]} cards */
function allCellPaths(cards) {
  return uncheckedCells(cards, {}); // every cell is unchecked when nothing is ticked
}

/**
 * The paths of one row's cells, in the import's own form (`0.batting.2.runs`).
 * @param {unknown[]} cards @param {number} n @param {"batting" | "didNotBat" | "bowling" | "fallOfWickets"} list @param {number} i
 */
export function rowPaths(cards, n, list, i) {
  const prefix = `${n}.${list}.${i}`;
  return allCellPaths(cards).filter((p) => p === prefix || p.startsWith(`${prefix}.`));
}

/**
 * The ticks after a row is removed from a list: the row's own go, and every
 * later row's move up by one with it (a tick belongs to a cell, and cells are
 * named by their place).
 * @param {Record<string, true>} checked @param {number} n @param {string} list @param {number} i
 */
export function shiftChecked(checked, n, list, i) {
  const lead = `${n}.${list}.`;
  /** @type {Record<string, true>} */
  const out = {};
  for (const k of Object.keys(checked)) {
    if (!k.startsWith(lead)) { out[k] = true; continue; }
    const rest = k.slice(lead.length);
    const dot = rest.indexOf(".");
    const idx = Number(dot < 0 ? rest : rest.slice(0, dot));
    if (idx === i) continue;
    out[dot < 0 ? `${lead}${idx > i ? idx - 1 : idx}` : `${lead}${idx > i ? idx - 1 : idx}${rest.slice(dot)}`] = true;
  }
  return out;
}

/** Every card's ticks are dropped when its innings is removed, and the later cards' move up. @param {Record<string, true>} checked @param {number} n */
export function dropCardChecked(checked, n) {
  /** @type {Record<string, true>} */
  const out = {};
  for (const k of Object.keys(checked)) {
    const dot = k.indexOf(".");
    const idx = Number(k.slice(0, dot));
    if (idx === n) continue;
    out[`${idx > n ? idx - 1 : idx}${k.slice(dot)}`] = true;
  }
  return out;
}

// ── Names: ours from the roster, theirs typed ───────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPlayerRef = (/** @type {unknown} */ r) => typeof r === "string" && UUID.test(r);
export const isTypedRef = (/** @type {unknown} */ r) => typeof r === "string" && /^t:\d{1,3}$/.test(r);

/** A typed name, as the API keeps it: trimmed, one space between words. @param {string} s */
export const cleanName = (s) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, 80);

/**
 * Every ref a card uses, cell by cell: [path, ref].
 * @param {any} card @returns {[string, string][]}
 */
export function refCells(card) {
  /** @type {[string, string][]} */
  const out = [];
  const add = (/** @type {string} */ p, /** @type {unknown} */ r) => { if (typeof r === "string" && r) out.push([p, r]); };
  (card?.batting ?? []).forEach((b, i) => { add(`batting.${i}.ref`, b.ref); add(`batting.${i}.fielderRef`, b.fielderRef); add(`batting.${i}.bowlerRef`, b.bowlerRef); });
  (card?.didNotBat ?? []).forEach((r, i) => add(`didNotBat.${i}`, r));
  (card?.bowling ?? []).forEach((b, i) => add(`bowling.${i}.ref`, b.ref));
  (card?.fallOfWickets ?? []).forEach((w, i) => add(`fallOfWickets.${i}.ref`, w.ref));
  return out;
}

/**
 * Turn a name typed into an opposition cell into the ref the card keeps
 * (`t:<n>`) and the typed map that holds its spelling. A name already typed
 * on the import (the same words, whatever the case) is the same person and
 * keeps his key; a cell that alone uses its key renames it; otherwise the
 * name gets the next key. The empty name is no one.
 *
 * Typed names live in the import's `typed` map and nowhere else: they never
 * become a player.
 * @param {Record<string, string>} typed @param {unknown[]} cards
 * @param {{name: string, current: string | null, path: string, card: number}} q
 * @returns {{ref: string | null, typed: Record<string, string>}}
 */
export function settleTyped(typed, cards, q) {
  const name = cleanName(q.name);
  if (!name) return { ref: null, typed: { ...typed } };
  const same = Object.entries(typed).find(([, v]) => v.toLowerCase() === name.toLowerCase());
  if (same) return { ref: same[0], typed: { ...typed } };
  if (isTypedRef(q.current)) {
    const uses = cards.flatMap((c, n) => refCells(c).filter(([p, r]) => r === q.current && !(n === q.card && p === q.path)));
    if (uses.length === 0) return { ref: q.current, typed: { ...typed, [/** @type {string} */ (q.current)]: name } };
  }
  const n = Object.keys(typed).reduce((m, k) => Math.max(m, Number(k.slice(2))), 0) + 1;
  return { ref: `t:${n}`, typed: { ...typed, [`t:${n}`]: name } };
}

/**
 * The typed names some card still uses; the rest are dropped before a save so
 * a half-typed name never outlives the cell it was typed in.
 * @param {Record<string, string>} typed @param {unknown[]} cards
 */
export function pruneTyped(typed, cards) {
  const used = new Set(cards.flatMap((c) => refCells(c).map(([, r]) => r)));
  return Object.fromEntries(Object.entries(typed).filter(([k]) => used.has(k)));
}

/**
 * A ref, as a name: a player from the roster, a typed spelling, or "".
 * @param {string | null | undefined} ref @param {Record<string, string>} typed @param {Map<string, string>} roster
 */
export function nameOfRef(ref, typed, roster) {
  if (!ref) return "";
  if (isTypedRef(ref)) return typed?.[ref] ?? "";
  return roster?.get(ref) ?? "";
}

// ── What the book's total and its rows say ──────────────────────────────

/**
 * The book's difference: its total, less the batters' runs and the extras it
 * gives (a figure the book does not give counts as nothing here, as the
 * arithmetic counts it; null when the card has no total yet).
 * @param {any} card
 * @returns {{battingRuns: number, extras: number, difference: number} | null}
 */
export function differenceOf(card) {
  if (!Number.isInteger(card?.total)) return null;
  const battingRuns = (card.batting ?? []).reduce((s, b) => s + (Number.isInteger(b.runs) ? b.runs : 0), 0);
  const extras = Object.values(card.extras ?? {}).reduce((s, v) => s + (Number.isInteger(v) ? /** @type {number} */ (v) : 0), 0);
  return { battingRuns, extras, difference: card.total - battingRuns - extras };
}

/** "The book's batting figures differ from its total by 3." @param {{runs: number} | null | undefined} u */
export function footnoteWords(u) {
  if (!u || !Number.isInteger(u.runs)) return "";
  const n = Math.abs(u.runs);
  return `The book's batting figures differ from its total by ${n} run${n === 1 ? "" : "s"}.`;
}

/**
 * The pages an import shows: not taken off it, their photo not deleted. A
 * removed or purged page keeps its row (and its number: numbers are never
 * given to another page, so the list may have gaps).
 * @param {Array<{pageNo: number, deletedAt?: unknown, removedAt?: unknown}>} pages
 */
export const livePages = (pages) => (pages ?? []).filter((p) => !p.deletedAt && !p.removedAt);

/**
 * Were there ever pages on the import that were not taken off it? Then an
 * import with none showing has had its photos deleted; otherwise it simply
 * has none yet.
 * @param {Array<{removedAt?: unknown}>} pages
 */
export const hadPages = (pages) => (pages ?? []).some((p) => !p.removedAt);

/** "Hilton College 1XI v Northwood 1XI", from a match's two sides. @param {{home: {full: string}, away: {full: string}}} sides */
export const titleOf = (sides) => `${sides.home.full} v ${sides.away.full}`;

// ── The two calls that are not JSON ─────────────────────────────────────

/** @param {Response} res @param {string} path */
async function failed(res, path) {
  const data = await res.json().catch(() => null);
  return new ApiError(res.status, data?.error, path, data?.detail);
}

/**
 * Send one photo's bytes, as they are, to the import (JPEG or PNG). The API
 * strips its metadata and refuses anything else; its refusal is thrown as an
 * ApiError for refusalWords(). The photo is sent from memory and kept nowhere.
 * @param {string} importId @param {Blob} file
 * @returns {Promise<{pageNo: number}>}
 */
export async function uploadPage(importId, file) {
  const path = `/api/scorebook/${importId}/pages`;
  let res;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", authorization: `Bearer ${getToken()}` },
      body: file,
      cache: "no-store",
    });
  } catch {
    // The server may close the connection on a photo far over the limit
    // before it has read it all, and a phone may have lost its signal: the
    // words say both, rather than guessing one.
    throw new ApiError(0, "photo_not_sent", path);
  }
  if (!res.ok) throw await failed(res, path);
  return res.json();
}

/**
 * Take a wrong page off an import still being typed. The API records it
 * removed and deletes its photo; the answer carries the import's new version
 * (one revision on from the one before, when nobody else saved in between).
 * @param {string} importId @param {number} pageNo
 * @returns {Promise<{ok: true, version: number}>}
 */
export function removePage(importId, pageNo) {
  return api(`/api/scorebook/${importId}/pages/${pageNo}`, { method: "DELETE" });
}

/**
 * Fetch one page's photo into memory (never the HTTP cache: the route says
 * no-store and so does this). The caller makes a blob URL for it and revokes
 * that URL when done; the bytes go nowhere else.
 * @param {string} importId @param {number} pageNo @param {AbortSignal} [signal]
 * @returns {Promise<Blob>}
 */
export async function fetchPage(importId, pageNo, signal) {
  const path = `/api/scorebook/${importId}/pages/${pageNo}`;
  const res = await fetch(`${apiBase()}${path}`, { headers: { authorization: `Bearer ${getToken()}` }, cache: "no-store", signal });
  if (!res.ok) throw await failed(res, path);
  return res.blob();
}
