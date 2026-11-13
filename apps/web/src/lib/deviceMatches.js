/**
 * What this device holds of the matches it has scored (GA-I13, the scorer's
 * home): the pad's saved logs and how many events in its outbox are still to
 * send. Read only; nothing here writes, sends, claims or clears.
 *
 *   persist.js       `match:<id>`: the whole log, with the fixture's sides (cfg)
 *   packages/sync    `scrbrd-outbox` → `queue`, keyed `<match>:<device>:evt:<n>`:
 *                    one key per event not yet acknowledged by the server
 *
 * Only THIS device's outbox is counted (its own device id in the key), which
 * is what the pad's own "3 to send" counts. A practice match lives under
 * `practice:` (lib/practice.js) and has no outbox. A Pilot Match's outbox is
 * keyed by its `pilot-` id like a fixture's (lib/sync.js PadSync, pilot
 * mode): outboxCounts() counts it; its log is lib/pilot.js's to read.
 */
import { savedMatchLogs } from "./persist.js";
import { deviceId } from "./device.js";

const OUTBOX_DB = "scrbrd-outbox";
const OUTBOX_STORE = "queue";

/**
 * Every key in the outbox store, or null when it could not be read. Opened the
 * way packages/sync's indexedDbStorage opens it (same name, version and store),
 * so the two can never disagree about its shape.
 * @returns {Promise<string[] | null>}
 */
function outboxKeys() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(OUTBOX_DB, 1); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(OUTBOX_STORE)) req.result.createObjectStore(OUTBOX_STORE); };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const all = db.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE).getAllKeys();
        all.onsuccess = () => { db.close(); resolve(/** @type {string[]} */ (all.result.filter((k) => typeof k === "string"))); };
        all.onerror = () => { db.close(); resolve(null); };
      } catch { db.close(); resolve(null); }
    };
  });
}

/**
 * Unsent events per match, on this device, from the outbox's keys.
 * @param {string[]} keys @param {string} device
 * @returns {Map<string, number>}
 */
export function pendingByMatch(keys, device) {
  return countByMatch(keys, device, "evt");
}

/**
 * Held events per match, on this device: refused by the server's Laws or in
 * conflict with one it already has, waiting on a person (packages/sync
 * sync-engine.mjs `held:`; the pad's Held sheet lists them).
 * @param {string[]} keys @param {string} device
 * @returns {Map<string, number>}
 */
export function heldByMatch(keys, device) {
  return countByMatch(keys, device, "held");
}

/** @param {string[]} keys @param {string} device @param {"evt" | "held"} kind */
function countByMatch(keys, device, kind) {
  const out = new Map();
  for (const k of keys ?? []) {
    const at = k.indexOf(`:${device}:${kind}:`);
    if (at <= 0) continue;
    const id = k.slice(0, at);
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/**
 * This device's outbox, counted per match for every match it holds (a
 * fixture's id or a Pilot Match's `pilot-` id; a practice match has none):
 * what is still to send, and what is held for a person. Null when the outbox
 * could not be read: not "nothing to send".
 * @returns {Promise<{pending: Map<string, number>, held: Map<string, number>} | null>}
 */
export async function outboxCounts() {
  const ob = await outboxKeys();
  if (!ob) return null;
  const dev = deviceId();
  return { pending: pendingByMatch(ob, dev), held: heldByMatch(ob, dev) };
}

/**
 * The saved logs of live fixtures on this device, and what each still has to
 * send. `ok` false when the saved logs could not be read at all; a count that
 * could not be read is null for every match (not zero: "nothing to send" over
 * an outbox nobody read is good news nobody sent).
 * `outbox` is every match's count on this device (outboxCounts), or null.
 * @returns {Promise<{ok: boolean, saved: any[], pending: Map<string, number|null>, outbox: {pending: Map<string, number>, held: Map<string, number>} | null}>}
 */
export async function deviceMatches() {
  const saved = await savedMatchLogs();
  if (saved == null) return { ok: false, saved: [], pending: new Map(), outbox: null };
  const outbox = await outboxCounts();
  const pending = new Map(saved.map((s) => [s.matchId, outbox ? outbox.pending.get(s.matchId) ?? 0 : null]));
  return { ok: true, saved, pending, outbox };
}
