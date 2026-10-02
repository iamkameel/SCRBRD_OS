/**
 * SCRBRD — offline app shell.
 *
 * Without this, a reload on a ground with no signal fails at the first
 * request: the ball log survives in IndexedDB, but the scorer stares at a
 * browser error page and cannot get back to it. Durable data is only half of
 * "works offline"; the app has to load too.
 *
 * Strategy is deliberately plain — runtime caching, network-first for
 * navigations, cache-first for hashed build assets:
 *
 *   - Build assets carry a content hash in their filename, so a cached one is
 *     never stale. Serving them from cache first is both correct and fast.
 *   - Navigations go to the network first so a deployed update is picked up on
 *     the next load, falling back to the cached shell when offline.
 *   - Nothing is precached from a manifest. The asset names change on every
 *     build, and a precache list that drifts out of step with them is worse
 *     than no precache at all: it fails closed at exactly the wrong moment.
 *
 * API calls are never cached. A stale score is worse than no score, and the
 * scoring path does not read from the network anyway.
 */

// v2 (SCRBRD-142): the app moved to /app and / became the public home page.
// A v1 worker still in charge when / first answered with the home page
// stored THAT as its shell, so v1's cache is dropped on activate below and
// the shell is fetched afresh from where the app now lives. "/app" is the
// app's page on every server: Hosting rewrites it to /app.html, serveClient
// and the dev server answer it with index.html.
const CACHE = "scrbrd-shell-v2";
const SHELL = "/app";
/**
 * The public home page (home.html, at / and /privacy). Not the app: never
 * stored as the shell, and never answered from the cache while the network
 * answers. Offline, a returning user — someone who has used the app on this
 * device, since only the app registers this worker — gets the app's shell
 * rather than the browser's error page: a scorer whose bookmark is / still
 * reaches the pad with no signal. A stranger has no worker and never sees it.
 */
const HOME = new Set(["/", "/home.html", "/privacy", "/privacy/"]);

self.addEventListener("install", (event) => {
  // Take over as soon as possible: a scorer who reloads should get the new
  // worker immediately rather than on some later visit.
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts, and anything third-party
  if (url.pathname.startsWith("/api/")) return;    // never serve a stale score
  // The public match pages (SCRBRD-083) are not the app: their shells are
  // served by the API per fixture, and their bundle has a fixed name. Left to
  // the network, so a public page is never cached as the app's offline shell
  // below, and a stale public bundle is never served from cache.
  // The ground display (/display/, SCRBRD-133) is one of them.
  if (/^\/(live|scorecard|display|table|fixtures)\//.test(url.pathname) || url.pathname === "/public-app.js") return;

  // The home page: the network's answer, never stored; offline, the app.
  if (HOME.has(url.pathname)) {
    if (request.mode !== "navigate") return;
    event.respondWith(fetch(request).catch(async () => (await caches.match(SHELL)) ?? Response.error()));
    return;
  }

  // Navigations: network first, cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put(SHELL, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(SHELL)) ?? Response.error();
      }
    })());
    return;
  }

  // Everything else: cache first, then network, caching what comes back.
  event.respondWith((async () => {
    const hit = await caches.match(request);
    if (hit) return hit;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) (await caches.open(CACHE)).put(request, fresh.clone());
      return fresh;
    } catch {
      return hit ?? Response.error();
    }
  })());
});
