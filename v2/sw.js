'use strict';
/* sw.js — loadspeed-1116 service worker (scope: this directory).
 *
 * Why this shape — the failure it must never repeat: GitHub Pages
 * serves every file with Cache-Control: max-age=600 and there is
 * no way to set custom headers, so a plain cache-first worker (or
 * a long max-age) can strand players on a previous deploy's code
 * — this project has already been bitten by the 600 s window
 * itself (stale client.js after a publish). The design therefore
 * splits traffic by how dangerous staleness is:
 *
 *  - Navigations (index.html) and the app code (client.js,
 *    engine.js, duel-worker.js, engine-worker.js, neuron.js,
 *    build/ocgcore.js): NETWORK-FIRST with forced revalidation
 *    (fetch cache:'no-cache'). Pages sends an ETag for every
 *    file, so an unchanged file costs one conditional request
 *    and a 304 — the stored body is reused, nothing big is
 *    re-downloaded — while a changed file is picked up on the
 *    very next load, exactly as without a worker. The versioned
 *    cache is only the offline fallback. Code can therefore
 *    NEVER be staler than it was before this worker existed.
 *
 *  - Heavy data (build/ocgcore.wasm ~390KB gz, data.json ~270KB
 *    gz, genesys-data.json, fxmap.json): CACHE-FIRST from the
 *    versioned cache below; the wasm and data.json are also
 *    precached at install. These are the bytes that made repeat
 *    visits slow once the 600 s HTTP freshness expired.
 *
 *  - Media (card art under ../assets/, audio): CACHE-FIRST,
 *    filled at runtime into the same versioned cache.
 *
 * VERSION is a content hash over the shell + code + engine +
 * data files (see gen-sw-version.js; test-loadspeed.js recomputes
 * it and fails the suite if it drifts). Any change to a covered
 * file therefore ships a new sw.js with a new cache name; on
 * activate the old caches are deleted, so new code never meets
 * an old data.json/wasm from the cache. The one remaining skew
 * window is the browser's own service-worker update check
 * against Pages' max-age=600 on sw.js itself (worst case the new
 * worker activates ~10 minutes after a deploy) — during it the
 * network-first code path already serves the new code, and only
 * the data cache lags, which is additive card data behind a
 * stable engine API. That is strictly fresher than the pre-
 * worker status quo, never staler.
 *
 * Cross-origin requests (the neuron import relay) and non-GET
 * requests are not intercepted at all.
 */
const VERSION = 'ecdefc20c87f';
const CACHE = 'md-' + VERSION;
const PRECACHE = ['build/ocgcore.wasm', 'data.json', 'fxmap.json'];
const DATA_SET = new Set(['build/ocgcore.wasm', 'data.json', 'genesys-data.json', 'fxmap.json']);
const CODE_SET = new Set(['client.js', 'engine.js', 'duel-worker.js', 'engine-worker.js', 'neuron.js', 'build/ocgcore.js']);

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('md-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(url, cacheKey) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res && res.ok) { try { await cache.put(cacheKey, res.clone()); } catch (e) {} }
    return res;
  } catch (e) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) { try { await cache.put(req, res.clone()); } catch (e) {} }
  return res;
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (req.mode === 'navigate') {
    ev.respondWith(networkFirst(req.url, 'index.html'));
    return;
  }
  if (url.pathname.startsWith(scopePath)) {
    const rel = url.pathname.slice(scopePath.length);
    if (rel === '' || rel === 'index.html') { ev.respondWith(networkFirst(req.url, 'index.html')); return; }
    if (DATA_SET.has(rel)) { ev.respondWith(cacheFirst(req)); return; }
    if (CODE_SET.has(rel)) { ev.respondWith(networkFirst(req.url, rel)); return; }
    return; // anything else in scope (tests, shots, NOTES): untouched
  }
  if (url.pathname.includes('/assets/')) { ev.respondWith(cacheFirst(req)); return; }
});
