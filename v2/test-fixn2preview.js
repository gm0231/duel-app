'use strict';
/* test-fixn2preview.js — fix-n2-preview-blank-1118 (N2, triage-1118-ledger3).
 *
 * N2: the preview band opened empty for ~0.6 s when the previewed card
 * changed. Parent-verified from raw probe data (ledger3 r3, 620/gg,
 * 40 ms sampler): the band was closed (h:0), then opened at h:38
 * with EMPTY innerText for 12 consecutive samples (idx 4352-4363,
 * 605 ms), then the next card （花と野原の春化精） appeared. Startup
 * transients of the same shape exist at window start (r3 idx 0-4,
 * r4b/r5 idx 0-2, ~200-300 ms) — the band opens before its first
 * content loads.
 *
 * Cause: the band's visibility rode on layout alone. applyLayoutVars
 * set #preview's class from pvShown > 0, while previewState was
 * still null at duel (re)start (startbtn nulls it, then applyLayout
 * runs, then the ~950 ms VS transition, then preduel lifts and the
 * band is visibly open — but the engine's first state, which is
 * what sets the first preview, only arrives after createClientDuel).
 * Fix: gate the class on having content (syncPreviewVisibility:
 * class 'on' only when previewState exists AND pvShown > 0), and
 * have setPreview re-open the band BEFORE renderPreview writes the
 * content, so the compact form is decided first and the band opens
 * with content already in it (same synchronous task — no empty
 * frame can be painted). The content-dependent heights
 * (26/35/38/52 px) are untouched: they are normal variation, not
 * a defect.
 *
 * Pinned by source + live behaviour in jsdom; the visual proof is
 * the Chromium probe (probe-fixn2preview.js): pre-fix the band is
 * open+empty for ~0.6 s at duel start, post-fix it never shows
 * open+empty outside the first page paint.
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

// ---------- source pins ----------
ok(clientSrc.includes('function syncPreviewVisibility('), 'N2a: the visibility helper exists');
ok(/function syncPreviewVisibility\([\s\S]{0,400}previewState && shown > 0/.test(clientSrc), 'N2b: the class is gated on having preview content');
ok(/applyLayoutVars\(info\)[\s\S]{0,1200}syncPreviewVisibility\(info\.pvShown\)/.test(clientSrc), 'N2c: layout applies visibility through the helper');
ok(!/\$\('preview'\)\.className = info\.pvShown/.test(clientSrc), 'N2d: no remaining layout-only class assignment for #preview');
ok(/function setPreview\([\s\S]{0,800}syncPreviewVisibility\(\);[\s\S]{0,200}renderPreview\(\);/.test(clientSrc), 'N2e: setPreview re-opens the band before rendering content');

// ---------- live behaviour in jsdom ----------
async function boot(url) {
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
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
  const w = await boot('http://localhost/v2/');
  const doc = w.document;
  const pv = () => doc.getElementById('preview');
  // A real card from the pool for the preview.
  const code = (data.cards && data.cards[0] && data.cards[0].code) || 16135253;
  const name = w.eval('cardName(' + code + ')');

  // The defect viewport: 390x620 (compact, pvShown 38 < 44).
  Object.defineProperty(w, 'innerWidth', { value: 390, configurable: true, writable: true });
  Object.defineProperty(w, 'innerHeight', { value: 620, configurable: true, writable: true });

  // (1) Layout with NO preview content: the band must stay closed even
  // though the budget gives it height (this is the duel-start state:
  // startbtn nulls previewState, then applyLayout runs).
  w.eval('applyLayout()');
  const pvShown = w.eval('window.__layout ? window.__layout.pvShown : -1');
  ok(pvShown > 0, 'N2f: the 390x620 budget gives the preview height (pvShown=' + pvShown + ')');
  ok(pv().className === '', 'N2g: with no preview content the band stays closed (class="' + pv().className + '")');
  ok((pv().textContent || '').trim() === '', 'N2h: the closed band holds no stale text');

  // (2) Setting a preview opens the band WITH the content, in compact form.
  w.eval('setPreview(' + code + ', null)');
  ok(pv().className === 'on compact', 'N2i: setPreview opens the band in compact form at 620 (class="' + pv().className + '")');
  const nm = doc.querySelector('#preview .pv-name');
  ok(!!nm && nm.textContent === name, 'N2j: the band shows the card name on open (got "' + (nm ? nm.textContent : 'none') + '", want "' + name + '")');

  // (3) The duel-restart sequence: null the state (startbtn) and
  // re-apply layout — the band must close, not stand open and empty.
  w.eval('previewState = null; applyLayout();');
  ok(pv().className === '', 'N2k: after the restart null + layout, the band is closed again');
  // ...and the next preview re-opens it with content, never empty.
  w.eval('setPreview(' + code + ', null)');
  ok(pv().className.includes('on') && (pv().textContent || '').includes(name), 'N2l: the re-opened band carries the card (no empty frame)');

  // (4) Tall viewport: full form, same gate.
  Object.defineProperty(w, 'innerHeight', { value: 800, configurable: true, writable: true });
  w.eval('previewState = null; applyLayout();');
  ok(pv().className === '', 'N2m: tall viewport, no content -> band closed');
  w.eval('setPreview(' + code + ', null)');
  ok(pv().className === 'on', 'N2n: tall viewport, content -> band opens in full form (class="' + pv().className + '")');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('ERROR', e); process.exit(1); });
