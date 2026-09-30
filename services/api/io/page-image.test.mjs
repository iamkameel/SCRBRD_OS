/**
 * A scorebook page's photo, and where it is kept (SCRBRD-120 §5.2):
 * page-image.mjs's type check and metadata strip, and object-store.mjs's two
 * backends (a local directory; Supabase Storage over a fake fetch).
 *
 *   node services/api/io/page-image.test.mjs
 */
import { sanitisePage, PAGE_MAX_BYTES } from "./page-image.mjs";
import { localStore, supabaseStore, objectStoreFromEnv, unconfiguredStore, OBJECT_KEY } from "./object-store.mjs";
import { jpegWithMetadata, pngWithMetadata, SECRET_WORDS } from "./test-images.mjs";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
/** @param {Buffer} b */
const leaks = (b) => SECRET_WORDS.filter((w) => b.includes(Buffer.from(w, "latin1")));

group("A. A JPEG: kept as a JPEG, its metadata gone");
{
  const src = jpegWithMetadata({ width: 1600, height: 1200 });
  ok("the source does carry the metadata", leaks(src).length === SECRET_WORDS.length);
  const r = sanitisePage(src);
  ok("accepted, as a JPEG, with its size", r.ok && r.mime === "image/jpeg" && r.ext === "jpg" && r.width === 1600 && r.height === 1200, r);
  if (r.ok) {
    ok("no GPS, device, caption or comment is left", leaks(r.bytes).length === 0, leaks(r.bytes));
    ok("APP1, APP13, COM and the trailer were removed", ["APP1", "APP13", "COM", "trailer"].every((x) => r.removed.includes(x)), r.removed);
    ok("JFIF (APP0) and the image data are kept", r.bytes.includes(Buffer.from("JFIF")) && r.bytes.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56])));
    ok("it starts and ends as a JPEG", r.bytes[0] === 0xff && r.bytes[1] === 0xd8 && r.bytes.at(-2) === 0xff && r.bytes.at(-1) === 0xd9);
    const again = sanitisePage(r.bytes);
    ok("stripping it again changes nothing", again.ok && again.bytes.equals(r.bytes) && again.removed.length === 0);
  }
}

group("B. A PNG: kept as a PNG, its text and EXIF gone, still a picture");
{
  const src = pngWithMetadata({ width: 8, height: 4, salt: 7 });
  const r = sanitisePage(src);
  ok("accepted, as a PNG, with its size", r.ok && r.mime === "image/png" && r.width === 8 && r.height === 4, r);
  if (r.ok) {
    ok("no text chunk and no EXIF is left", leaks(r.bytes).length === 0 && ["tEXt", "eXIf", "iTXt"].every((t) => r.removed.includes(t)), r.removed);
    const idat = r.bytes.indexOf(Buffer.from("IDAT"));
    const len = r.bytes.readUInt32BE(idat - 4);
    ok("the pixels are intact", inflateSync(r.bytes.subarray(idat + 4, idat + 4 + len)).length === 9 * 4);
    ok("pHYs, which only says how to show it, is kept", r.bytes.includes(Buffer.from("pHYs")));
  }
  const bad = Buffer.from(src); bad[bad.indexOf(Buffer.from("IDAT")) + 6] ^= 0xff;
  ok("a chunk whose CRC is wrong is refused whole", sanitisePage(bad).ok === false);
}

group("C. Only a page's photo");
{
  ok("text is not an image", sanitisePage(Buffer.from("<svg onload=alert(1)>")).ok === false);
  ok("a GIF is not accepted", sanitisePage(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1")).ok === false);
  ok("nothing is nothing", sanitisePage(Buffer.alloc(0)).ok === false);
  const huge = Buffer.concat([jpegWithMetadata(), Buffer.alloc(PAGE_MAX_BYTES)]);
  const t = sanitisePage(huge);
  ok("more than 8 MB is refused", !t.ok && t.reason === "page_too_large");
  const cut = jpegWithMetadata().subarray(0, 60);
  ok("a cut-off JPEG is refused", sanitisePage(cut).ok === false);
  const wide = sanitisePage(jpegWithMetadata({ width: 40000 % 65536, height: 10 }));
  ok("a picture no page can be is refused", !wide.ok && wide.reason === "image_size", wide);
}

const KEY = "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.jpg";

group("D. The local store (development and tests)");
{
  const root = mkdtempSync(join(tmpdir(), "scrbrd-store-test-"));
  const s = localStore(root);
  await s.put(KEY, Buffer.from("page"), "image/jpeg");
  ok("put, then get, gives the bytes back", (await s.get(KEY))?.toString() === "page");
  ok("readable by this process only", (statSync(join(root, KEY)).mode & 0o077) === 0);
  let refused = false;
  try { await s.put(KEY, Buffer.from("other"), "image/jpeg"); } catch { refused = true; }
  ok("a key is written once", refused && (await s.get(KEY))?.toString() === "page");
  await s.del(KEY);
  ok("deleted, it is gone", (await s.get(KEY)) === null);
  await s.del(KEY);
  ok("deleting it again is not an error", true);
  let bad = false;
  try { await s.get("../../etc/passwd"); } catch { bad = true; }
  ok("a key that is not one is refused before it touches a path", bad && !OBJECT_KEY.test("../x.jpg"));
}

group("E. Supabase Storage, over fetch");
{
  /** @type {{method: string, url: string, headers: Record<string, string>, body: any}[]} */
  const calls = [];
  /** @type {Map<string, Buffer>} */
  const objects = new Map();
  /** @type {any} */
  const fakeFetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    calls.push({ method: init.method, url, headers: init.headers, body: init.body });
    const path = url.replace("https://proj.supabase.co/storage/v1/object/", "");
    if (init.method === "POST") { objects.set(path, Buffer.from(init.body)); return new Response("{}", { status: 200 }); }
    if (init.method === "GET") {
      const hit = objects.get(path);
      return hit ? new Response(new Uint8Array(hit), { status: 200 }) : new Response('{"statusCode":"404","error":"not_found"}', { status: 400 });
    }
    if (init.method === "DELETE") {
      for (const p of JSON.parse(init.body).prefixes) objects.delete(`scorebook-pages/${p}`);
      return new Response("[]", { status: 200 });
    }
    return new Response("", { status: 405 });
  };
  const s = supabaseStore({ url: "https://proj.supabase.co/", key: "service-key", bucket: "scorebook-pages", fetch: fakeFetch });
  await s.put(KEY, Buffer.from("page"), "image/jpeg");
  const put = calls[0];
  ok("upload: POST to the bucket's object path, never overwriting",
     put.method === "POST" && put.url === `https://proj.supabase.co/storage/v1/object/scorebook-pages/${KEY}` && put.headers["x-upsert"] === "false");
  ok("...with the service key, and the photo's type", put.headers.authorization === "Bearer service-key" && put.headers.apikey === "service-key"
     && put.headers["content-type"] === "image/jpeg");
  ok("download gives the bytes back", (await s.get(KEY))?.toString() === "page");
  await s.del(KEY);
  ok("delete names the one key", calls.at(-1)?.method === "DELETE" && JSON.parse(calls.at(-1)?.body).prefixes.join() === KEY);
  ok("a missing object is null, not an error", (await s.get(KEY)) === null);
  let threw = false;
  try { supabaseStore({ url: "http://example.com", key: "k", bucket: "b1", fetch: fakeFetch }); } catch { threw = true; }
  ok("a store over plain http (not this machine) is refused", threw);
  const failing = supabaseStore({ url: "https://proj.supabase.co", key: "k", bucket: "scorebook-pages",
    fetch: /** @type {any} */ (async () => new Response("denied", { status: 403 })) });
  let e503 = null;
  try { await failing.put(KEY, Buffer.from("x"), "image/jpeg"); } catch (/** @type {any} */ e) { e503 = e; }
  ok("a store that refuses is a 503 whose message names no key", e503?.status === 503 && !String(e503?.message).includes("1111"));
}

group("F. Which store a process runs with");
{
  ok("Supabase when its two variables are set", objectStoreFromEnv({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" }).kind === "supabase");
  ok("in production without them: none, never the local disk", objectStoreFromEnv({ NODE_ENV: "production" }).kind === "unconfigured");
  ok("in development: a local directory", objectStoreFromEnv({ SCOREBOOK_STORE_DIR: join(tmpdir(), "x") }).kind === "local");
  let msg = "";
  try { await unconfiguredStore().put(KEY, Buffer.from(""), "image/jpeg"); } catch (/** @type {any} */ e) { msg = `${e.status} ${e.message}`; }
  ok("an unconfigured store says so, as a 503", msg === "503 store_unconfigured");
}

console.log(`\n${"─".repeat(52)}\nPAGE IMAGE SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
