'use strict';
/* test-fxround2.js — fx-ui round 2 (F2/F4) deterministic checks in
   jsdom, harness and fabrication pattern as test-oppinfo:
     F4 — a card-detail VIEW sheet (or the floating detail pop) left
     open when the next prompt dispatches must be closed BY the
     prompt dispatch (uiAnswer), so the prompt never renders over /
     under stale detail text. Reproduces the parent observation:
     a chain dock arriving while a detail view was still open.
     F2 — the SELECT_CARD grid's delivered CSS contract on the real
     rendered sheet: 3-column minmax(106px) grid, tiles >= 150px,
     effect text at 11px (ROUND 5 / I2: the sheet grid is auto-fit
     and the effect text is 12px — see FXR8/FXR10 notes), and the
     location label as an absolutely positioned corner chip (out of
     the name/text flow).
   Live geometry + screenshots: fxround2/ capture rig. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));
let failures = 0;
const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
const tick = (ms) => new Promise(r => setTimeout(r, ms));

const KELDO = 63542003, MUDORA = 99937011, TAIYOU = 38699854;

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
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'FXR0: client boots');

  window.eval(`(() => {
    const P = () => ({ mzone: [null,null,null,null,null,null,null], szone: [null,null,null,null,null,null], grave: [], removed: [], extra: [], hand: [], deckCount: 38, lp: 8000 });
    const b = { players: [P(), P()], phaseName: 'MAIN1', turnCount: 2, chain: [], solvingLink: 0, winner: null, turnPlayer: 0, log: [], dlog: [], lastAttack: null };
    const mon = (code, pos) => ({ code, pos, materials: 0, counters: null, curAtk: null, curDef: null });
    b.players[1].mzone[0] = mon(${KELDO}, 0x1);
    b.players[0].mzone[0] = mon(${MUDORA}, 0x1);
    duelState = b; render(b);
    fxSettings.resp = 'auto';
    return true;
  })()`);

  // ---------- F4: view sheet open -> chain prompt dispatch ----------
  click(doc.querySelector('.slot[data-zone="1:4:0"]'));
  click(doc.getElementById('preview'));
  const sw = doc.getElementById('sheetwrap');
  ok(sw.className === 'on' && sw.dataset.kind === 'view' && doc.getElementById('sheet').textContent.includes('宿神像ケルドウ'),
    'FXR1: setup — the card-detail view sheet is open (the defect precondition)');
  const chainState = window.eval(`(() => { const s = duelState; s.chain = [{ code: ${KELDO} }]; return s; })()`);
  const p1 = window.eval(`(() => {
    window.__fxr1 = false;
    const e = { code: ${MUDORA}, con: 0, loc: 8, seq: 0, desc: ${MUDORA} * 1048576 };
    uiAnswer({ name: 'SELECT_CHAIN', forced: false, entries: [e] }, duelState).then(() => { window.__fxr1 = true; });
    return true;
  })()`);
  for (let i = 0; i < 60 && !doc.getElementById('chainui').classList.contains('on'); i++) await tick(50);
  ok(doc.getElementById('chainui').classList.contains('on'), 'FXR2: the chain question dispatched and is shown (BU-74: the badge tray is the first stage)');
  // sheetClose keeps class 'on' during its 185ms exit motion by
  // design; the defect was the view STAYING. Poll for the landed
  // end state: wrap closed, kind attribute gone, content cleared.
  for (let i = 0; i < 30 && sw.className === 'on'; i++) await tick(50);
  ok(!(sw.className === 'on' && sw.dataset.kind === 'view') && doc.getElementById('sheet').innerHTML === '',
    'FXR3: F4 — the detail view is closed by the prompt dispatch (no stale panel behind/above the tray)');
  click(doc.querySelector('#chaintray .ct-no'));
  for (let i = 0; i < 40 && !window.eval('window.__fxr1'); i++) await tick(50);
  ok(window.eval('window.__fxr1') === true, 'FXR4: the chain prompt still answers normally after the view cleanup');

  // ---------- F4b: floating detail pop open -> prompt dispatch ----------
  window.eval(`openInfoPop(${KELDO}, { con: 1, loc: 4, seq: 0 })`);
  ok(doc.getElementById('infopop').className === 'on', 'FXR5: setup — the floating detail pop is open');
  const p2 = window.eval(`(() => {
    window.__fxr2 = false;
    const prompt = { name: 'SELECT_CARD', player: 0, min: 1, max: 1, cancelable: true, retryCount: 0, context: null,
      cards: [ { code: ${KELDO}, con: 1, loc: 4, seq: 0, releaseParam: 0 }, { code: ${MUDORA}, con: 0, loc: 4, seq: 0, releaseParam: 0 } ] };
    uiAnswer(prompt, duelState).then(() => { window.__fxr2 = true; });
    return true;
  })()`);
  for (let i = 0; i < 60 && !doc.querySelector('[data-grid]'); i++) await tick(50);
  ok(!!doc.querySelector('[data-grid]'), 'FXR6: the SELECT_CARD grid dispatched');
  ok(doc.getElementById('infopop').className !== 'on', 'FXR7: F4 — the floating detail pop is closed by the prompt dispatch');

  // ---------- F2: the grid's delivered CSS contract ----------
  const g = doc.querySelector('.grid'), card = doc.querySelector('.gcard'),
        itext = doc.querySelector('.gcard .itext'), loc = doc.querySelector('.gcard .loc');
  const cs = (el) => window.getComputedStyle(el);
  ok(g && cs(g).gridTemplateColumns.includes('106px'), 'FXR8: F2 — grid columns are minmax(106px,1fr) (3 across at 390px), got: ' + (g ? cs(g).gridTemplateColumns : 'none'));
  ok(card && parseFloat(cs(card).minHeight) >= 150, 'FXR9: F2 — candidate tiles are at least 150px tall, got: ' + (card ? cs(card).minHeight : 'none'));
  ok(!itext, 'FXR10: F2 successor (layout-fix3 K4, user decision 2026-11-12) — candidate tiles carry NO inline effect text at all; tiles are compact and uniform, the full text lives in the detail modal (got: ' + (itext ? 'an .itext element' : 'none') + ')');
  ok(loc && cs(loc).position === 'absolute', 'FXR11: F2 — the location label is a positioned corner chip, out of the text flow, got: ' + (loc ? cs(loc).position : 'none'));
  click(doc.querySelector('[data-grid="0"]'));
  click(doc.getElementById('grid-confirm'));
  for (let i = 0; i < 40 && !window.eval('window.__fxr2'); i++) await tick(50);
  ok(window.eval('window.__fxr2') === true, 'FXR12: the grid selection still confirms after the F4 cleanup');

  console.log(failures ? ('FAILURES: ' + failures) : 'ALL FXROUND2 CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
