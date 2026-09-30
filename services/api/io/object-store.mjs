/**
 * SCRBRD — the private object store, one adapter (SCRBRD-120 §5.2, D9).
 *
 * The platform's first stored files: photos of scorebook pages, which carry
 * two schools' children's names and handwriting. They are kept privately,
 * read only through the API (which asks the database who may, and logs the
 * read in access_log before it fetches — scorebook_page_open(), db/63), and
 * deleted on the clock (scorebook_import_purge_due()). Nothing here decides
 * who may read anything: this module only puts, gets and deletes bytes by a
 * key the database recorded.
 *
 * TWO BACKENDS, ONE SHAPE ({ kind, put, get, del }):
 *
 *   supabase  PRODUCTION (Kameel, 2026-09-30): Supabase Storage, a PRIVATE
 *             bucket (default `scorebook-pages`) in the database's own
 *             project and region, reached with plain fetch() and the
 *             service-role key — no SDK. Nothing is ever signed for a
 *             browser: the API proxies every read, so no URL to a photo
 *             exists outside this process. Configured by SUPABASE_URL,
 *             SUPABASE_SERVICE_ROLE_KEY and (optionally) SCOREBOOK_BUCKET;
 *             DEPLOYING.md says where they come from.
 *   local     DEVELOPMENT AND TESTS ONLY: a directory
 *             (SCOREBOOK_STORE_DIR, default a folder under the OS temp
 *             directory). Refused when NODE_ENV=production: a server that
 *             wrote children's photos to its own disk would lose them on the
 *             next deploy and keep them nowhere anybody audits.
 *
 * With neither configured in production the store is `unconfigured`: every
 * call throws `store_unconfigured`, and the upload route answers 503 rather
 * than pretend.
 *
 * A key is `<school>/<import>/<uuid>.<ext>` (db/63 CHECKs the same), and is
 * checked again here before it touches a path or a URL.
 */
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

/** The shape db/63's CHECK on scorebook_import_page.object_key allows. */
export const OBJECT_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png)$/;

/** The default private bucket's name. */
export const DEFAULT_BUCKET = "scorebook-pages";

/**
 * @typedef {object} ObjectStore
 * @property {"supabase" | "local" | "unconfigured"} kind
 * @property {(key: string, bytes: Buffer, contentType: string) => Promise<void>} put
 *   refuses to overwrite: a key is written once
 * @property {(key: string) => Promise<Buffer | null>} get      null: no such object
 * @property {(key: string) => Promise<void>} del               a missing object is already deleted
 */

/** @param {string} key */
function checkedKey(key) {
  if (typeof key !== "string" || !OBJECT_KEY.test(key)) throw Object.assign(new Error("object_key_invalid"), { status: 400 });
  return key;
}

/**
 * The store this process runs with, from its environment.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ fetch?: typeof fetch }} [deps]  a fetch to use (tests)
 * @returns {ObjectStore}
 */
export function objectStoreFromEnv(env = process.env, deps = {}) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return supabaseStore({
      url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SCOREBOOK_BUCKET || DEFAULT_BUCKET, fetch: deps.fetch,
    });
  }
  if (env.NODE_ENV === "production") return unconfiguredStore();
  return localStore(env.SCOREBOOK_STORE_DIR || join(tmpdir(), "scrbrd-scorebook-pages"));
}

/** @returns {ObjectStore} */
export function unconfiguredStore() {
  const no = async () => { throw Object.assign(new Error("store_unconfigured"), { status: 503 }); };
  return { kind: "unconfigured", put: no, get: no, del: no };
}

/**
 * A directory. Development and tests only (see the header).
 * @param {string} root
 * @returns {ObjectStore}
 */
export function localStore(root) {
  const at = (/** @type {string} */ key) => join(root, checkedKey(key));
  return {
    kind: "local",
    async put(key, bytes) {
      const path = at(key);
      await mkdir(dirname(path), { recursive: true });
      // "wx": refuse to overwrite, as the Supabase adapter does (x-upsert false).
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    },
    async get(key) {
      try { return await readFile(at(key)); }
      catch (/** @type {any} */ e) { if (e.code === "ENOENT") return null; throw e; }
    },
    async del(key) { await rm(at(key), { force: true }); },
  };
}

/**
 * Supabase Storage's REST API over fetch (storage/v1): upload with
 * x-upsert false, authenticated download, delete. The bucket must be private;
 * DEPLOYING.md says how to make it. Every request carries the service-role
 * key, which never leaves this process.
 * @param {{ url: string, key: string, bucket: string, fetch?: typeof fetch }} o
 * @returns {ObjectStore}
 */
export function supabaseStore({ url, key, bucket, fetch: f = globalThis.fetch }) {
  const base = String(url).replace(/\/+$/, "");
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    throw new Error("SUPABASE_URL must be https");
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(bucket)) throw new Error("SCOREBOOK_BUCKET is not a bucket name");
  const auth = { authorization: `Bearer ${key}`, apikey: key };
  const objectUrl = (/** @type {string} */ k) => `${base}/storage/v1/object/${bucket}/${checkedKey(k)}`;
  /** @param {Response} r @param {string} what */
  const fail = async (r, what) => {
    const body = await r.text().catch(() => "");
    // The key is never in the message: it names a school and an import.
    throw Object.assign(new Error(`store_${what}_failed`), { status: 503, detail: `${r.status} ${body.slice(0, 200)}` });
  };
  return {
    kind: "supabase",
    async put(k, bytes, contentType) {
      const r = await f(objectUrl(k), {
        method: "POST",
        headers: { ...auth, "content-type": contentType, "x-upsert": "false", "cache-control": "no-store" },
        body: new Uint8Array(bytes),
      });
      if (!r.ok) await fail(r, "put");
    },
    async get(k) {
      const r = await f(objectUrl(k), { method: "GET", headers: auth });
      if (r.status === 404 || r.status === 400) {
        // Supabase answers a missing object 400 {"statusCode":"404"} or 404.
        const body = await r.text().catch(() => "");
        if (r.status === 404 || /not.?found|"404"/i.test(body)) return null;
        throw Object.assign(new Error("store_get_failed"), { status: 503, detail: `${r.status} ${body.slice(0, 200)}` });
      }
      if (!r.ok) await fail(r, "get");
      return Buffer.from(await r.arrayBuffer());
    },
    async del(k) {
      const r = await f(`${base}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: [checkedKey(k)] }),
      });
      if (!r.ok && r.status !== 404) await fail(r, "delete");
    },
  };
}
