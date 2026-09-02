/**
 * SCRBRD — local durability.
 *
 * A scorer's phone locks, runs out of battery, gets a call, or the browser
 * reloads the tab to reclaim memory. On a school ground with no signal there is
 * nowhere else the match exists. So every change to the ball log is written to
 * disk before anything else happens, and the log is rehydrated on return.
 *
 * Why IndexedDB and not localStorage
 * ──────────────────────────────────
 * localStorage is synchronous — it blocks the main thread on every write, which
 * on the scoring path means a stutter on every tap — and browsers cap it around
 * 5 MB. A full innings of richly-captured deliveries is comfortably under that,
 * but a season of matches on a shared school device is not. IndexedDB is
 * asynchronous, far larger, and survives the same events. localStorage remains
 * the fallback for private-mode contexts where IndexedDB is blocked, and an
 * in-memory map is the last resort so the app still runs (without durability)
 * rather than throwing.
 *
 * Scope note: this is LOCAL durability only — it is what makes a refresh
 * lossless. Getting the log off the device is the sync path (SyncEngine, in
 * services/api/write), and that path is live: tools/smoke-sync.mjs proves an
 * over scored with no signal reaches the server and replays to the same
 * scorecard.
 *
 * The undo/sync boundary IS enforced: until an event has synced, undo drops
 * it; once the server has it, undo appends a `void` naming it, because the
 * server's log is append-only and a second device may already have replayed
 * it. The rule lives in packages/scoring/src/undo.mjs so that it is the same
 * rule on both devices during a handover.
 */

const DB_NAME = "scrbrd";
const STORE = "kv";
const VERSION = 1;

let _backend = null;

// ── IndexedDB ────────────────────────────────────────────
function idbAvailable() {
  try { return typeof indexedDB !== "undefined" && indexedDB !== null; } catch { return false; }
}

function idbBackend() {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("indexeddb_blocked"));
  });

  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      let out;
      Promise.resolve(fn(t.objectStore(STORE))).then((v) => { out = v; });
      // Resolve on `oncomplete`, not on the request callback: the write is not
      // durable until the transaction commits, and that is the whole promise
      // this module makes.
      t.oncomplete = () => { db.close(); resolve(out); };
      t.onerror = () => { db.close(); reject(t.error); };
      t.onabort = () => { db.close(); reject(t.error); };
    });
  };

  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  return {
    name: "indexeddb",
    put: (k, v) => tx("readwrite", (os) => os.put(v, k)),
    get: (k) => tx("readonly", (os) => req(os.get(k)).then((v) => v ?? null)),
    del: (k) => tx("readwrite", (os) => os.delete(k)),
    keys: () => tx("readonly", (os) => req(os.getAllKeys())),
  };
}

// ── Fallbacks ────────────────────────────────────────────
function localBackend() {
  const P = "scrbrd:";
  return {
    name: "localstorage",
    async put(k, v) { localStorage.setItem(P + k, JSON.stringify(v)); },
    async get(k) { const s = localStorage.getItem(P + k); return s == null ? null : JSON.parse(s); },
    async del(k) { localStorage.removeItem(P + k); },
    async keys() { return Object.keys(localStorage).filter((k) => k.startsWith(P)).map((k) => k.slice(P.length)); },
  };
}

function memoryBackend() {
  const m = new Map();
  return {
    name: "memory",
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async del(k) { m.delete(k); },
    async keys() { return [...m.keys()]; },
  };
}

/** Pick a backend once, verifying it actually works rather than trusting feature detection. */
async function backend() {
  if (_backend) return _backend;
  if (idbAvailable()) {
    try {
      const b = idbBackend();
      await b.put("__probe", 1);
      await b.del("__probe");
      _backend = b;
      return _backend;
    } catch { /* blocked in private mode, or quota-denied */ }
  }
  try {
    const b = localBackend();
    b.put("__probe", 1); b.del("__probe");
    _backend = b;
  } catch {
    _backend = memoryBackend();
  }
  return _backend;
}

/** Which store is in use — surfaced in the UI so "saved" is never a lie. */
export async function storageKind() { return (await backend()).name; }

// ── The two things worth persisting ──────────────────────
const matchKey = (id) => `match:${id}`;

/**
 * Save an in-progress innings log.
 *
 * The whole log is written, not a delta: it is the source of truth, it is small
 * (a T20 innings is a few hundred small objects), and a partial write is how a
 * scorecard ends up unreconcilable. Correctness beats cleverness here.
 */
export async function saveMatch(matchId, snapshot) {
  if (!matchId) return false;
  try {
    const b = await backend();
    await b.put(matchKey(matchId), { ...snapshot, matchId, savedAt: Date.now() });
    return true;
  } catch {
    return false; // never let a failed save break scoring
  }
}

export async function loadMatch(matchId) {
  if (!matchId) return null;
  try { return await (await backend()).get(matchKey(matchId)); } catch { return null; }
}

export async function clearMatch(matchId) {
  try { await (await backend()).del(matchKey(matchId)); return true; } catch { return false; }
}

/** Every match this device has a saved log for, newest first. */
export async function listMatches() {
  try {
    const b = await backend();
    const keys = (await b.keys()).filter((k) => typeof k === "string" && k.startsWith("match:"));
    const out = [];
    for (const k of keys) { const v = await b.get(k); if (v) out.push(v); }
    return out.sort((a, b2) => (b2.savedAt ?? 0) - (a.savedAt ?? 0));
  } catch {
    return [];
  }
}

/**
 * The shell's own state — which role, which page, whether the scorer was open.
 *
 * Without this a reload drops the scorer back to the landing page mid-over.
 * The match itself would survive, but the person holding the phone has to find
 * their way back into it while play continues, which in practice means balls
 * get missed. Session state is a convenience; the match log above is the data.
 */
export async function saveSession(session) {
  try { await (await backend()).put("session", { ...session, savedAt: Date.now() }); return true; }
  catch { return false; }
}

export async function loadSession() {
  try { return await (await backend()).get("session"); } catch { return null; }
}

export async function clearSession() {
  try { await (await backend()).del("session"); return true; } catch { return false; }
}
