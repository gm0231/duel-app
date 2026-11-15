'use strict';
/* test-loadspeed.js — loadspeed-1116 pins.
 * Source pins for the four load-path changes (deferred scripts,
 * parse-time data prefetch, engine prewarm, service worker) plus
 * two functional groups:
 *   - the prewarm hand-off in duel-worker.js, driven with a fake
 *     Worker constructor (one warm worker, consumed exactly once,
 *     explicit env overrides never consume it);
 *   - a real engine-worker.js thread that receives {type:'warmup'}
 *     BEFORE its start message and still runs a duel to completion
 *     (the module-reuse path the browser takes after a boot-time
 *     prewarm).
 * The sw.js VERSION pin is the load-bearing one: VERSION must
 * equal the content hash gen-sw-version.js computes over the
 * shell + code + engine + data files, so any change to a covered
 * file without regenerating sw.js fails here instead of stranding
 * players on a stale cache.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Worker } = require('worker_threads');

const DIR = __dirname;
const read = (rel) => fs.readFileSync(path.join(DIR, rel), 'utf8');
let failures = 0;
const tag = (ok, what) => { console.log((ok ? 'PASS' : 'FAIL'), what); if (!ok) failures++; };

// ---------------------------------------------------------------- source pins
const html = read('index.html');
const client = read('client.js');
const duelWorkerSrc = read('duel-worker.js');
const engineWorkerSrc = read('engine-worker.js');
const sw = read('sw.js');
const { computeVersion } = require(path.join(DIR, 'gen-sw-version.js'));

// L1: sw.js VERSION is the content hash of the covered files.
{
  const m = sw.match(/const VERSION = '([0-9a-f]+)';/);
  tag(!!m, 'L1a sw.js carries a VERSION');
  tag(m && m[1] === computeVersion(), 'L1b sw.js VERSION == content hash of covered files (' + (m && m[1]) + ') — regenerate with gen-sw-version.js if this fails');
  tag(sw.includes("const CACHE = 'md-' + VERSION;"), 'L1c cache name derives from VERSION');
}

// L2: sw.js strategy shape.
tag(sw.includes('skipWaiting()'), 'L2a install skipWaiting (new worker activates promptly)');
tag(sw.includes('clients.claim()'), 'L2b activate clients.claim');
tag(sw.includes("k.startsWith('md-') && k !== CACHE") && sw.includes('caches.delete'), 'L2c activate deletes previous md-* caches');
tag(sw.includes("cache: 'no-cache'"), 'L2d network-first forces revalidation (ETag 304 path)');
tag(sw.includes("'build/ocgcore.wasm'") && sw.includes("'data.json'") && sw.includes("'genesys-data.json'") && sw.includes("'fxmap.json'"), 'L2e heavy data set covers wasm + data.json + genesys + fxmap');
tag(sw.includes("cache.addAll(PRECACHE)") && sw.includes("'build/ocgcore.wasm', 'data.json', 'fxmap.json'"), 'L2f install precaches wasm + data.json + fxmap');
for (const f of ['client.js', 'engine.js', 'duel-worker.js', 'engine-worker.js', 'neuron.js', 'build/ocgcore.js'])
  tag(sw.includes("'" + f + "'"), 'L2g code set includes ' + f);
tag(sw.includes("req.method !== 'GET'") && sw.includes('url.origin !== self.location.origin'), 'L2h non-GET and cross-origin requests are not intercepted');
tag(sw.includes("req.mode === 'navigate'"), 'L2i navigations are network-first');

// L3: index.html — deferred chain, order kept, parse-time prefetch.
{
  const tags = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[0]);
  const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  tag(JSON.stringify(srcs) === JSON.stringify(['build/ocgcore.js', 'engine.js', 'duel-worker.js', 'neuron.js', 'client.js']),
    'L3a external script order unchanged: ' + srcs.join(', '));
  tag(tags.every((t) => /\bdefer\b/.test(t)), 'L3b every external script is deferred (title paints before the chain executes)');
  const bootAt = html.indexOf('window.__mdBoot');
  tag(bootAt > 0 && bootAt < html.indexOf('src="client.js"'), 'L3c parse-time prefetch is installed before the client.js tag');
  tag(html.includes("fetch('data.json')") && html.includes("fetch('fxmap.json')"), 'L3d prefetch covers data.json and fxmap.json');
  tag(html.includes('__mdData.catch(function () {})'), 'L3e early promises carry a no-op catch (no unhandled rejection before boot)');
}

// L4: client.js — consumes the prefetch, registers the worker, prewarms.
tag(client.includes('window.__mdBoot') && client.includes('await earlyBoot.data'), 'L4a boot consumes the parse-time data promise');
tag(client.includes('await earlyBoot.fx'), 'L4b boot consumes the parse-time fxmap promise');
tag(client.includes("'serviceWorker' in navigator") && client.includes("navigator.serviceWorker.register('sw.js')"), 'L4c service worker registered behind a capability guard');
tag(client.includes('DuelWorker.prewarmClientDuel()'), 'L4d boot prewarms the engine worker after the data load');

// L5: duel-worker.js / engine-worker.js prewarm wiring.
tag(duelWorkerSrc.includes('function prewarmClientDuel(') && duelWorkerSrc.includes('prewarmClientDuel }') || duelWorkerSrc.includes('prewarmClientDuel };'),
  'L5a duel-worker.js defines and exports prewarmClientDuel');
tag(duelWorkerSrc.includes("postMessage({ type: 'warmup' })") || duelWorkerSrc.includes("post({ type: 'warmup' })") || duelWorkerSrc.includes("{ type: 'warmup' }"),
  'L5b prewarm posts the warmup message');
tag(engineWorkerSrc.includes("msg.type === 'warmup'"), 'L5c engine-worker handles warmup');
tag(engineWorkerSrc.includes('function getCoreModule()') && engineWorkerSrc.includes('const M = await getCoreModule();'),
  'L5d startSession awaits the cached module promise');
tag((engineWorkerSrc.match(/OcgCoreFactory\(\{/g) || []).length === 1, 'L5e the factory is invoked in exactly one place (getCoreModule)');
tag(engineWorkerSrc.includes('modulePromise.catch(() => { modulePromise = null; })'), 'L5f a failed instantiation is dropped from the cache (start retries)');

// ---------------------------------------------------------------- functional: prewarm hand-off
function freshDuelWorker() {
  const p = require.resolve(path.join(DIR, 'duel-worker.js'));
  delete require.cache[p];
  return require(p);
}
class FakeWorker {
  constructor(url) { FakeWorker.count++; this.url = url; this.sent = []; }
  postMessage(obj) { this.sent.push(obj); }
}
async function functionalPrewarm() {
  FakeWorker.count = 0;
  globalThis.Worker = FakeWorker;
  try {
    const DW = freshDuelWorker();
    const DATA = { names: {}, cards: {} };
    const w1 = DW.prewarmClientDuel();
    tag(!!w1 && FakeWorker.count === 1, 'L6a prewarm builds exactly one worker');
    tag(w1.sent.length === 1 && w1.sent[0].type === 'warmup', 'L6b prewarm posts {type:warmup}');
    tag(DW.prewarmClientDuel() === w1 && FakeWorker.count === 1, 'L6c a second prewarm call reuses the same worker');
    const d1 = await DW.createClientDuel(DATA, {}, {});
    tag(d1 instanceof DW.WorkerDuel && FakeWorker.count === 1, 'L6d createClientDuel consumes the prewarmed worker (no new construction)');
    const d2 = await DW.createClientDuel(DATA, {}, {});
    tag(d2 instanceof DW.WorkerDuel && FakeWorker.count === 2, 'L6e the next createClientDuel builds a fresh worker as before');
    // explicit env override must not consume a prewarmed worker
    const DW2 = freshDuelWorker();
    FakeWorker.count = 0;
    DW2.prewarmClientDuel();
    await DW2.createClientDuel(DATA, {}, { WorkerCtor: FakeWorker });
    tag(FakeWorker.count === 2, 'L6f an env.WorkerCtor override builds its own worker and leaves the prewarmed one');
    tag(!!DW2.prewarmClientDuel() && FakeWorker.count === 2, 'L6g the prewarmed worker is still there afterwards');
    // no Worker global -> no-op
    const DW3 = freshDuelWorker();
    delete globalThis.Worker;
    tag(DW3.prewarmClientDuel() === null, 'L6h prewarm is a no-op without a Worker global');
  } finally {
    delete globalThis.Worker;
  }
}

// ---------------------------------------------------------------- functional: warmup then start on a real worker thread
async function functionalWarmupStart() {
  const DATA = JSON.parse(read('data.json'));
  const worker = new Worker(path.join(DIR, 'engine-worker.js'), { workerData: { rngSeed: 333 } });
  try {
    const transport = {
      post: (obj) => worker.postMessage(obj),
      onMessage: (fn) => worker.on('message', fn),
    };
    transport.post({ type: 'warmup' }); // before WorkerDuel exists: must not disturb the session
    await new Promise((r) => setTimeout(r, 800));
    const { WorkerDuel } = freshDuelWorker();
    const duel = new WorkerDuel(transport, DATA, {
      seed: 4242, deckP0: DATA.decks.ishizu, deckP1: DATA.decks.gg,
      humanTeam: 999, fast: true, digest: true,
    });
    const stats = await duel.run();
    tag(!!stats && typeof stats.turns === 'number' && stats.turns > 0, 'L7a warmup-then-start completes a duel (turns=' + (stats && stats.turns) + ')');
    tag(!!duel.digest && duel.digest.count > 0, 'L7b core messages flowed on the warmed module (digest count=' + (duel.digest && duel.digest.count) + ')');
  } finally {
    await worker.terminate();
  }
}

(async () => {
  await functionalPrewarm();
  await functionalWarmupStart();
  console.log(failures === 0 ? 'ALL LOADSPEED CHECKS PASSED' : 'TEST FAIL (' + failures + ')');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
