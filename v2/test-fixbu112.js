'use strict';
/* test-fixbu112.js — BU-112: the dp-tight tier never engaged.
 *
 * Measured on the public build (390x620, run16 + probe-bu112):
 * after picking GG as opponent the settings region overflowed
 * (scrollH 448 against clientH 421) and the sound row arrived
 * 25px cut behind a scroll cue — yet #deckpage never carried
 * dp-tight, the tier built exactly for this (BU-82 residue).
 * Root cause: every selection path calls dpTightUpdate() while
 * the deck page is display:none (openDeckCat hides it before the
 * modal pick, finishDeckPick shows it again afterwards) — 0
 * heights read as "fits", so the tier stayed off, and nothing
 * re-ran the update after the page became visible again.
 * The cue itself does NOT lie: scrolling the 10px (GG) / 28px
 * (Monarch) reveals the sound row whole — the fix is only to
 * re-run the tight measurement on every path that shows the
 * deck page again (finishDeckPick / closeDeckCat / #todeck /
 * the boot and rematch landings).
 *
 * Pins (jsdom, real client boot as test-deckpage):
 *   B1 #todeck calls dpTightUpdate while the deck page is visible
 *   B2 picking an opponent deck through the modal calls it while
 *      the deck page is visible again (finishDeckPick path)
 *   B3 the category back button calls it while visible
 *      (closeDeckCat path)
 *   B4 with stubbed overflow dpTightUpdate engages dp-tight, and
 *      with stubbed fit it releases it (measurement logic)
 *   B5 source pins: the boot and rematch landings also re-run it
 *      after showing the page (not reachable by DOM clicks here)
 * Geometry (the GG state fits exactly with the tier on, 444=444,
 * and the cue drops) is asserted in the Chrome rig
 * (probe-bu112b.js), not here — jsdom reports 0 heights.
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
const clientSrc = fs.readFileSync(path.join(V2, 'client.js'), 'utf8');
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'B0: client boots, load message ready');
  ok(typeof window.dpTightUpdate === 'function', 'B0b: dpTightUpdate is reachable on the window');

  // Spy: record the deck page's inline display at every call, so
  // the pins distinguish "measured while hidden (0 heights)" from
  // "measured while visible (real geometry)".
  const calls = [];
  const orig = window.dpTightUpdate;
  window.dpTightUpdate = function (...a) {
    calls.push(doc.getElementById('deckpage').style.display || '(unset)');
    return orig.apply(this, a);
  };
  const seenVisible = (from) => calls.slice(from).some((d) => d === 'flex');
  const catBtn = (c) => doc.querySelector('#deckcatlist .catbtn[data-cat="' + c + '"]');

  // ---- B1: title -> deck page ----
  let mark = calls.length;
  doc.getElementById('todeck').click();
  await sleep(100);
  ok(doc.getElementById('deckpage').style.display === 'flex', 'B1a: #todeck shows the deck page');
  ok(seenVisible(mark), 'B1: #todeck calls dpTightUpdate while the deck page is visible (calls since: ' + JSON.stringify(calls.slice(mark)) + ')');

  // ---- B2: pick GG as opponent through the modal ----
  mark = calls.length;
  doc.getElementById('opdeckcur').click();
  await sleep(100);
  ok(doc.getElementById('deckpage').style.display === 'none', 'B2a: opening the category page hides the deck page');
  catBtn('classic').click();
  await sleep(100);
  const ggRow = doc.querySelector('#seg-opdeck .deckrow[data-key="gg"] button.deck');
  ok(!!ggRow, 'B2b: GG row exists in the classic opponent list');
  if (ggRow) ggRow.click();
  await sleep(100);
  ok(doc.getElementById('deckpage').style.display === 'flex', 'B2c: picking lands back on the deck page');
  ok(doc.querySelector('#opdeckcur .dn').textContent === 'ゲート・ガーディアン', 'B2d: the opponent choice applied');
  ok(seenVisible(mark), 'B2: picking an opponent calls dpTightUpdate while the deck page is visible again (calls since: ' + JSON.stringify(calls.slice(mark)) + ')');

  // ---- B3: category page -> back without picking ----
  mark = calls.length;
  doc.getElementById('opdeckcur').click();
  await sleep(100);
  doc.getElementById('deckcatback').click();
  await sleep(100);
  ok(doc.getElementById('deckpage').style.display === 'flex', 'B3a: category back returns to the deck page');
  ok(seenVisible(mark), 'B3: the category back button calls dpTightUpdate while the deck page is visible (calls since: ' + JSON.stringify(calls.slice(mark)) + ')');

  // ---- B4: measurement logic with stubbed heights ----
  window.dpTightUpdate = orig; // unwrap the spy for the geometry pins
  const dp = doc.getElementById('deckpage');
  const m = dp.querySelector('.dp-main');
  const stub = (sh, ch) => {
    Object.defineProperty(m, 'scrollHeight', { value: sh, configurable: true });
    Object.defineProperty(m, 'clientHeight', { value: ch, configurable: true });
  };
  stub(448, 421); // the measured GG state at 390x620
  window.dpTightUpdate();
  ok(dp.classList.contains('dp-tight'), 'B4a: stubbed overflow (448 > 421) engages dp-tight');
  stub(438, 438); // the arrival state: fits
  window.dpTightUpdate();
  ok(!dp.classList.contains('dp-tight'), 'B4b: stubbed fit (438 = 438) releases dp-tight');

  // ---- B5: source pins for the landings no DOM click reaches ----
  ok(/if \(todeckLanded\) \{\s*\n\s*\$\('start'\)\.style\.display = 'none';\s*\n\s*\$\('deckpage'\)\.style\.display = 'flex';\s*\n\s*dpTightUpdate\(\);/.test(clientSrc),
    'B5a: the boot landing re-runs dpTightUpdate after showing the deck page');
  ok(clientSrc.includes("updateDeckSum();\n    $('start').style.display = 'none';\n    $('deckpage').style.display = 'flex';\n    dpTightUpdate();"),
    'B5b: the rematch landing re-runs dpTightUpdate after showing the deck page');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
