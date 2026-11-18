'use strict';
/* test-noticecenter.js — notice-center-1118 (USER DECISION
 * 2026-11-18): the event/move notice returns to the centre of
 * the screen (the pre-BU-83 band), and while a notice is up the
 * board surface is inert.
 *
 * History: the notice began as a big band at top:33%. BU-83
 * (2026-11-14) confined it to the header band because the
 * centre band covers the opponent's field centre for its
 * dwell; BU-94 gave it a band below row 2 with header growth.
 * The user reversed the placement on 2026-11-18 — centre
 * again — and answered the covering with an input lock: "while
 * it is showing, make the board inoperable". The lock is the
 * .fx-notice-veil element: born with the notice, removed with
 * it (the .fx-turn discipline), covering everything below the
 * header so the header's own controls (history, phase, the
 * watch bar) stay live, while every decision UI sits above
 * #fxlayer and stays answerable.
 *
 * Pinned here by source + a live jsdom notice; the geometry
 * and click-through proof in a real duel is the Chromium rig
 * (probe-noticecenter.js in the round's hidden_files).
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------- source pins: the centre seat ----------
ok(html.includes('.fx-notice{position:absolute;left:50%;top:33%;transform:translate(-50%,-50%);z-index:8;max-width:86%;'),
  'NC1a: the notice band is seated at screen centre (the pre-BU-83 form: left 50%, top 33%, centred transform)');
ok(html.includes('.fx-notice .nt{font-size:18px;'), 'NC1b: the centre band restores the large 18px body');
ok(!/\.fx-notice\{[^}]*left:6px;right:6px/.test(html), 'NC1c: the header-strip seat (left/right 6px) is gone');
{
  const showFn = clientSrc.slice(clientSrc.indexOf('function fxNoticeShow('), clientSrc.indexOf('function fxOppTagsFromEvents('));
  ok(!showFn.includes('fxBelowRow2Seat') && !showFn.includes('anchorNotice') && !showFn.includes('fxNoticeGrowHeader') && !showFn.includes('fxNoticeRestoreHeader'),
    'NC1d: fxNoticeShow no longer seats in the header (no row-2 seat, no per-frame anchor, no header growth/restore)');
  ok(showFn.includes("veil.className = 'fx-notice-veil';"), 'NC1e: fxNoticeShow creates the lock veil with the notice');
  ok(showFn.includes('const anchorVeil = () => {'), 'NC1f: the veil top is anchored to the header bottom edge');
  ok(showFn.includes('onDone() { finish(); }'), 'NC1g: the notice scene finishes through the shared cleanup (band + veil + busy + pump)');
}
ok(!clientSrc.includes('function fxNoticeGrowHeader(') && !clientSrc.includes('function fxNoticeRestoreHeader('),
  'NC1h: the BU-94 header growth/restore pair is removed with the seat');
// the name tag keeps its below-row-2 seat and the shared helpers
ok(clientSrc.includes('function fxRow2Bottom()') && clientSrc.includes('function fxBelowRow2Seat()'),
  'NC1i: the row-2 seat helpers survive for the name tag');
{
  const tagFn = clientSrc.slice(clientSrc.indexOf('function fxOppTagPosition()'), clientSrc.indexOf('function fxTagRestoreHeader()'));
  ok(tagFn.includes('fxBelowRow2Seat()') && !tagFn.includes("querySelector('.fx-notice')"),
    'NC1j: the name tag seats below row 2 and no longer stacks under a notice');
}
{
  const tagRestore = clientSrc.slice(clientSrc.indexOf('function fxTagRestoreHeader()'), clientSrc.indexOf('// ---- floating notice'));
  ok(!tagRestore.includes("querySelector('#fxlayer .fx-notice')"),
    'NC1k: the tag restore no longer holds its growth for a live notice (BU-46 hold retired with the seat)');
}
// ---------- source pins: the lock ----------
ok(html.includes('.fx-notice-veil{position:absolute;left:0;right:0;bottom:0;top:80px;z-index:7;pointer-events:auto;}'),
  'NC2a: the veil is a hit-taking layer child under the notice band (z 7 < 8) and the in-layer confirm card (9)');
ok(html.includes('#fxlayer{position:absolute;inset:0;z-index:25;pointer-events:none;overflow:hidden;}'),
  'NC2b: #fxlayer itself stays pointer-events:none at z-25 (decision UIs at z-40+ stay above the lock)');
{
  const showFn = clientSrc.slice(clientSrc.indexOf('function fxNoticeShow('), clientSrc.indexOf('function fxOppTagsFromEvents('));
  ok(showFn.includes('fxNoticeSafety = setTimeout(') && showFn.includes('if (d.isConnected)'),
    'NC2c: a wall-clock safety force-finishes a notice whose scene died without onDone (the lock cannot stick)');
  ok(showFn.includes("const oldVeil = layer.querySelector('.fx-notice-veil'); if (oldVeil) oldVeil.remove();"),
    'NC2d: a replaced notice takes its veil with it');
}
{
  const resetFn = clientSrc.slice(clientSrc.indexOf('function fxResetFoundation()'), clientSrc.indexOf('function fxSnap('));
  ok(resetFn.includes("querySelector('.fx-notice-veil')"),
    'NC2e: a duel reset removes the veil alongside the notice queue reset');
}
// content is untouched: unitized full text still renders
ok(clientSrc.includes("fxNoticeUnitize(text)"), 'NC3a: the notice body still renders through fxNoticeUnitize (BU-107 full-text breaks)');

// ---------- live behaviour in jsdom ----------
async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
  window.Image = class { constructor() { this._src = ''; } set src(v) { this._src = v; } get src() { return this._src; } };
  const wasmBuf = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  window.fetch = async (url) => {
    if (String(url).includes('ocgcore.wasm')) return { ok: true, status: 200, url: String(url), arrayBuffer: async () => wasmBuf };
    return { ok: true, status: 200, json: async () => data, arrayBuffer: async () => wasmBuf };
  };
  const inject = (file) => {
    const s = window.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(V2, file), 'utf8');
    window.document.body.appendChild(s);
  };
  inject('build/ocgcore.js');
  const origFactory = window.OcgCoreModule;
  window.OcgCoreModule = (opts) => origFactory(Object.assign({}, opts, { wasmBinary }));
  inject('engine.js');
  inject('duel-worker.js');
  inject('neuron.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await sleep(50);
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  const layer = doc.getElementById('fxlayer');
  ok(!!layer, 'NC4a: fx layer present after boot');
  // show a notice through the real entry point
  window.eval("fxNotice('相手の《テスト・カード》が効果で墓地へ送られた', 'カードの移動｜フィールド→墓地', true)");
  await sleep(120);
  const band = doc.querySelector('#fxlayer .fx-notice');
  const veil = doc.querySelector('#fxlayer .fx-notice-veil');
  ok(!!band, 'NC4b: the notice band appears');
  ok(!!veil, 'NC4c: the lock veil is up while the notice is up');
  ok(band && band.textContent.includes('テスト・カード'), 'NC4d: the band carries the full notice text');
  ok(veil && veil.style.top !== '', 'NC4e: the veil top is anchored (header bottom edge; 0-geometry jsdom still assigns it)');
  // a second notice queues behind the first (busy discipline unchanged)
  window.eval("fxNotice('自分の《二人目》をコストで除外した', 'カードの移動｜手札→除外', true)");
  await sleep(60);
  ok(doc.querySelectorAll('#fxlayer .fx-notice').length === 1, 'NC4f: the second notice queues (still one band)');
  // dwell: fxReadMs for these texts is ~2.5s max; scene = hold + 480.
  // Wait out both notices (queue pump included).
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    await sleep(400);
    gone = !doc.querySelector('#fxlayer .fx-notice') && !doc.querySelector('#fxlayer .fx-notice-veil');
  }
  ok(gone, 'NC4g: band and veil are both gone after the dwells (the lock released itself)');
  // the queue is not stuck: a fresh notice shows immediately after
  window.eval("fxNotice('三人目の通知', '', true)");
  await sleep(120);
  ok(!!doc.querySelector('#fxlayer .fx-notice'), 'NC4h: a fresh notice shows after the queue drained (no stuck busy flag)');
  console.log(failures === 0 ? 'ALL PASS' : failures + ' NOTICE-CENTER CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
