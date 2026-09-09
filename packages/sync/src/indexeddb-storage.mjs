/**
 * SCRBRD — IndexedDB storage adapter (Step 4, production client)
 *
 * Implements the storage interface SyncEngine expects (put/get/delete/list).
 * IndexedDB survives tab close, refresh, crash and OS-killed tabs — the
 * durability guarantee the offline queue depends on. Keyed per match+device so
 * multiple matches don't collide on one device.
 *
 * Not exercised in node tests (no IndexedDB); the in-memory adapter proves the
 * SyncEngine logic. This adapter is a thin, boring wrapper — verify in-browser.
 */
// A SEPARATE database from the one persist.js uses for the match log, not the
// same one with a second store. Two openers of "scrbrd" at version 1 race:
// whichever runs first creates its own object store, and the other finds the
// database already at that version with its store missing — "One of the
// specified object stores was not found", thrown from inside the scorer the
// moment it starts syncing. Separate names cost nothing and cannot collide.
export function indexedDbStorage({ dbName = "scrbrd-outbox", matchId, deviceId }) {
  const store = "queue";
  const ns = `${matchId}:${deviceId}:`;                 // namespace keys per match+device

  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      let out;
      Promise.resolve(fn(os)).then(v => { out = v; });
      t.oncomplete = () => { db.close(); resolve(out); };
      t.onerror = () => { db.close(); reject(t.error); };
      t.onabort = () => { db.close(); reject(t.error); };
    });
  };

  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  return {
    async put(key, value) { return tx("readwrite", os => os.put(value, ns + key)); },
    async get(key) { return tx("readonly", os => reqP(os.get(ns + key)).then(v => v ?? null)); },
    async delete(key) { return tx("readwrite", os => os.delete(ns + key)); },
    async list(prefix) {
      return tx("readonly", async os => {
        const keys = await reqP(os.getAllKeys());
        const wanted = keys.filter(k => typeof k === "string" && k.startsWith(ns + prefix));
        const out = [];
        for (const k of wanted) out.push({ key: k.slice(ns.length), value: await reqP(os.get(k)) });
        return out;
      });
    },
    /** Clear this match+device's queue (e.g. after the match is archived). */
    async clearMatch() {
      return tx("readwrite", async os => {
        const keys = await reqP(os.getAllKeys());
        for (const k of keys) if (typeof k === "string" && k.startsWith(ns)) os.delete(k);
      });
    },
  };
}
