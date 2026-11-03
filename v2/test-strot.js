'use strict';
/* test-strot.js — regression for the Spell/Trap rotation defect
   (user report 2026-11-03: 「魔法罠の画像が90度曲がる」).
   Root cause found by triage: in the core's position encoding a
   spell/trap is 0x5 face-up / 0xa face-down, which ALWAYS intersects
   POS_DEFENSE (0xC). tileHTML derived its `def` class (CSS:
   .tile.def .inner{transform:rotate(90deg) scale(.82)} — the MD-style
   defense rotation) from that bit test alone, with no zone/type
   discrimination, so EVERY spell/trap tile — set or face-up — was
   rendered rotated 90 degrees. Measured on the real page pre-fix:
   szone tiles carried class "tile def" with computed transform
   matrix(0, 0.82, -0.82, 0, 0, 0).
   Fix: the def class is now gated on loc === MZONE (the same guard
   the position-change animation already used).
   Method: boot the real client in jsdom (same harness as test-ui),
   play a real duel by clicking, and on every poll assert that no
   spell/trap-zone tile carries the def class, while monster-zone
   defense tiles DO (the confirmed MD-style spec must survive).
   Non-vacuity gates: the run must actually observe S/T tiles AND a
   defense monster tile, else it FAILS instead of passing silently. */
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

async function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  window.Audio = class { constructor(src) { this.src = src; this.volume = 1; } play() { return Promise.resolve(); } pause() {} };
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
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  return window;
}

(async () => {
  const window = await boot();
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const q = (sel, root) => (root || doc).querySelector(sel);
  const qa = (sel, root) => [...(root || doc).querySelectorAll(sel)];
  ok($('loadmsg').textContent.includes('準備完了'), 'ST1: client boots');

  $('startbtn').click();
  const obs = { stPolls: 0, stFaceUp: 0, defMonPolls: 0, violations: [] };
  const t0 = Date.now();
  let lastDom = '', stalls = 0;
  while (Date.now() - t0 < 420000) {
    // ---- observation (before acting, on the settled DOM) ----
    let stHere = false, fuHere = false;
    for (const row of ['mySzone', 'oppSzone']) {
      for (const tile of qa('.tile', $(row))) {
        stHere = true;
        if (!tile.className.includes('back')) fuHere = true;
        if (tile.classList.contains('def') && obs.violations.length < 4) {
          const nm = tile.querySelector('.nm');
          obs.violations.push(row + ': ' + tile.className + ' / ' + (nm ? nm.textContent : '(裏側)'));
        }
      }
    }
    if (stHere) obs.stPolls++;
    if (fuHere) obs.stFaceUp++;
    for (const row of ['myMzone', 'oppMzone'])
      if (qa('.tile.def', $(row)).length) obs.defMonPolls++;
    if (obs.stPolls >= 5 && obs.stFaceUp >= 2 && obs.defMonPolls >= 2) break;
    if ($('result').style.display === 'flex') break;

    // ---- clicker (same policy as test-ui's playDuel) ----
    let acted = false;
    const click = (el) => { if (el) { el.click(); acted = true; } };
    if ($('sheetwrap').className === 'on') {
      const sheet = $('sheet');
      const inc = q('[data-inc]', sheet);
      const counterOk = q('#counter-confirm', sheet);
      if (inc && counterOk && counterOk.disabled) click(inc);
      else if (counterOk && !counterOk.disabled) click(counterOk);
      else if (q('#grid-confirm', sheet) && !q('#grid-confirm', sheet).disabled) click(q('#grid-confirm', sheet));
      else if (q('[data-action-idx]', sheet)) click(q('[data-action-idx]', sheet));
      else if (q('[data-code]', sheet)) click(q('[data-code]', sheet));
      else if (q('[data-pos]', sheet)) click(q('[data-pos]', sheet));
      else if (q('.posbtn', sheet)) click(q('.posbtn', sheet));
      else if (q('#yn-yes', sheet)) click(q('#yn-yes', sheet));
      else if (q('[data-num]', sheet)) click(q('[data-num]', sheet));
      else if (q('[data-bit]', sheet)) click(q('[data-bit]', sheet));
      else if (q('[data-unselect]', sheet)) click(q('[data-unselect]', sheet));
      else if (q('#unselect-finish', sheet)) click(q('#unselect-finish', sheet));
      else if (q('#sort-ok', sheet)) click(q('#sort-ok', sheet));
      else if (q('#fb-auto', sheet)) click(q('#fb-auto', sheet));
      else if (q('[data-pile-act]', sheet)) click(q('[data-pile-act]', sheet));
      else if (q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet)) click(q('[data-grid]:not(.sel)', sheet) || q('[data-grid]', sheet));
      else if (q('.optbtn:not(.disabled)', sheet)) click(q('.optbtn:not(.disabled)', sheet)); // a disabled optbtn (e.g. an effect that cannot fire now) must not shadow #sheet-cancel — clicking it loops forever
      else if (q('#grid-cancel', sheet)) click(q('#grid-cancel', sheet));
      else if (q('#sheet-cancel', sheet)) click(q('#sheet-cancel', sheet));
    } else if ($('dock').className === 'on') {
      click(q('#chain-pass', $('dock')) || q('[data-chain]', $('dock')));
    } else if ($('placehint').className === 'on') {
      click(q('.slot.hl'));
    } else if (!$('phasebtn').disabled) {
      click($('phasebtn'));
    } else {
      click(q('[data-act]'));
    }
    const domNow = doc.body.innerHTML.length + '|' + $('logline').textContent;
    if (domNow === lastDom && !acted) stalls++; else stalls = 0;
    lastDom = domNow;
    if (stalls > 600) break;
    await new Promise(r => setTimeout(r, 30));
  }

  ok(obs.stPolls >= 5, 'ST2: non-vacuity — S/T tiles observed in real play (' + obs.stPolls + ' polls)');
  ok(obs.stFaceUp >= 2, 'ST3: non-vacuity — face-shown S/T tiles observed (' + obs.stFaceUp + ' polls)');
  ok(obs.defMonPolls >= 2, 'ST4: non-vacuity — defense monster tiles observed (' + obs.defMonPolls + ' polls)');
  ok(obs.violations.length === 0, 'ST5: no spell/trap tile ever carries the def (90-degree) class' +
    (obs.violations.length ? ' — violations: ' + obs.violations.join(' ; ') : ''));
  window.close();
  console.log(failures === 0 ? 'ALL STROT CHECKS PASSED' : failures + ' STROT CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
