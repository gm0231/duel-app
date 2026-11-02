'use strict';
/* test-layout.js — layout phase verification (jsdom; NODE_PATH=<dir with jsdom>).
   Boots the real page at 390x{660,720,800} and 500x900 (the 430px column
   cap), starts a duel (defaults: イシズ vs ゲート・ガーディアン, 先攻) and
   checks:
     (a) the computed stack fits the viewport WITH the safety margin:
         contentH <= vh - 4 and the dead band vh - contentH is in [4, 24)
         at every size (layout-fix accounting: the fixed part 217 was
         re-derived element by element against the CSS and is exact; the
         old exact-fill formula left a dead band of exactly 0 whenever the
         preview showed, so any real-world shortfall of the visible height
         vs window.innerHeight clipped the stack's bottom);
     (b) tile/hand sizes are frozen mid-duel: the sizing inputs (CSS vars on
         :root + window.__layout) are byte-identical before/after opening a
         selection sheet, after a mid-duel viewport resize event, and while
         the chain dock is open;
     (c) hand card height at 800 is larger than at 660;
     (d) at 800 the preview strip is shown (pvShown > 0, #preview.on) and
         tapping a hand card updates its content to that card;
     (e) visualViewport is honoured: with innerHeight 800 but a visual
         viewport of 760, the layout budgets against 760, not 800;
     (f) measure-and-step-down: with the hand bar's rendered height
         stubbed to report the formula stack + 28px (a phantom overshoot
         of the kind the real browser showed), applyLayout() steps the
         budget down until the measured stack fits, shrinking the preview
         before the tiles.
   jsdom has no layout engine, so sizes are measured through the exact
   inputs that determine them in a real browser: applyLayout() computes
   every box height in px (all bars carry explicit heights in index.html)
   and publishes them as CSS vars + window.__layout. */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP: jsdom not resolvable (set NODE_PATH)'); process.exit(0); }

const V2 = __dirname;
const html = fs.readFileSync(path.join(V2, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(V2, 'data.json'), 'utf8'));
const wasmBinary = fs.readFileSync(path.join(V2, 'build', 'ocgcore.wasm'));

async function boot(vw, vh, opts) {
  opts = opts || {};
  const dom = new JSDOM(html, { url: 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  // viewport override BEFORE the duel starts (applyLayout reads these once,
  // at the start-button click)
  Object.defineProperty(window, 'innerWidth', { value: vw, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: vh, configurable: true, writable: true });
  if (opts.visualH) Object.defineProperty(window, 'visualViewport', { value: { height: opts.visualH, width: vw }, configurable: true });
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
  if (opts.phantom) {
    // Simulate a browser whose rendered stack overshoots the formula by
    // opts.phantom px: the hand bar (last in-flow section) reports a
    // height of (current formula stack + phantom). It tracks __layout,
    // so as applyLayout steps the budget down the reported height follows.
    const hb = window.document.getElementById('handbar');
    Object.defineProperty(hb, 'offsetHeight', {
      configurable: true,
      get() { const L = window.__layout; return (L ? L.contentH : 0) + opts.phantom; },
    });
  }
  return window;
}

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('timeout waiting for ' + what);
}

function sizeSnapshot(window) {
  const rs = window.document.documentElement.style;
  const L = window.__layout;
  return JSON.stringify({
    sw: rs.getPropertyValue('--sw'), sh: rs.getPropertyValue('--sh'),
    hw: rs.getPropertyValue('--hw'), hh: rs.getPropertyValue('--hh'), pv: rs.getPropertyValue('--pv'),
    tileW: L && L.tileW, slotH: L && L.slotH, handH: L && L.handH,
  });
}

// Plays the duel by DOM clicks (same priority chain as test-ui.js) until the
// chain dock opens, the duel ends, or the timeout hits.
async function clickUntilDock(window, timeoutMs) {
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const q = (sel, root) => (root || doc).querySelector(sel);
  let lastDom = '', stalls = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ($('result').style.display === 'flex') return 'result';
    if ($('dock').className === 'on') return 'dock';
    const sheetOn = $('sheetwrap').className === 'on';
    let acted = false;
    const click = (el) => { if (el) { el.click(); acted = true; } };
    if (sheetOn) {
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
      else if (q('.optbtn', sheet)) click(q('.optbtn', sheet));
      else if (q('#grid-cancel', sheet)) click(q('#grid-cancel', sheet));
      else if (q('#sheet-cancel', sheet)) click(q('#sheet-cancel', sheet));
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
    if (stalls > 400) return 'stalled';
    await new Promise(r => setTimeout(r, 30));
  }
  return 'timeout';
}

(async () => {
  let failures = 0;
  const ok = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL'), label); if (!cond) failures++; };
  const handH = {};

  // construction check: ONE slot size for every zone (no .small variant left)
  ok(/\.slot\{width:var\(--sw\);height:var\(--sh\)/.test(html), 'LAY0: all zones sized by the single --sw/--sh pair');
  ok(!html.includes('.slot.small'), 'LAY0b: no smaller S/T-zone slot variant remains');

  const pvShownAt = {};
  for (const [vw, vh] of [[390, 660], [390, 720], [390, 800], [500, 900]]) {
    const window = await boot(vw, vh);
    const doc = window.document;
    const $ = (id) => doc.getElementById(id);
    doc.getElementById('startbtn').click();
    await waitFor(() => doc.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand at vh=' + vh);
    const L = window.__layout;
    console.log('  ' + vw + 'x' + vh + ':', JSON.stringify(L));
    ok(!!L && L.vh === vh && L.vw === Math.min(vw, 430), 'LAY-a0 ' + vw + 'x' + vh + ': layout computed for the requested viewport (column cap ' + Math.min(vw, 430) + ')');
    ok(L.contentH <= vh - 4 && L.dead >= 4 && L.dead < 24, 'LAY-a ' + vw + 'x' + vh + ': stack fits with the 4px safety margin, dead band ' + L.dead + 'px (in [4, 24), no scroll, no clip)');
    ok(L.tileW >= 47 && L.slotH >= 60, 'LAY-a2 ' + vw + 'x' + vh + ': board never below the old fixed baseline 47x60 (tile ' + L.tileW + 'x' + L.slotH + ')');
    ok(L.fit === true && L.fitSteps === 0, 'LAY-a3 ' + vw + 'x' + vh + ': no step-down needed where measurement is unavailable (jsdom), formula stands');
    handH[vh] = L.handH;
    pvShownAt[vh] = L.pvShown;
    const snap0 = sizeSnapshot(window);

    if (vw === 500) {
      ok(L.pvShown > 0, 'LAY-d4 500x900: preview strip is shown in the wide/tall case (pvShown=' + L.pvShown + ')');
    }

    if (vh === 800 && vw === 390) {
      // (d) preview strip present and follows hand taps
      ok(L.pvShown > 0, 'LAY-d0: preview height > 0 at 800 (pvShown=' + L.pvShown + ')');
      ok($('preview').className.includes('on'), 'LAY-d1: preview strip is displayed at 800');
      const cards = [...doc.querySelectorAll('#hand .hcard')];
      const curName = doc.querySelector('#preview .pv-name') ? doc.querySelector('#preview .pv-name').textContent : '';
      const target = cards.find(c => { const nm = c.querySelector('.nm'); return nm && nm.textContent !== curName; }) || cards[0];
      const targetName = target.querySelector('.nm').textContent;
      target.click();
      await new Promise(r => setTimeout(r, 60));
      const pvName = doc.querySelector('#preview .pv-name');
      ok(!!pvName && pvName.textContent === targetName, 'LAY-d2: tapping hand card "' + targetName + '" updates the preview (now "' + (pvName ? pvName.textContent : 'none') + '")');
      const pvText = doc.querySelector('#preview .pv-text');
      ok(!!pvText && pvText.textContent.length > 0, 'LAY-d3: preview carries the card\'s effect text');
    }

    // (b1) selection sheet opens -> sizes unchanged
    const pile = doc.querySelector('[data-pile="grave:' + 0 + '"]') || doc.querySelector('[data-pile]');
    pile.click();
    await new Promise(r => setTimeout(r, 60));
    ok($('sheetwrap').className === 'on', 'LAY-b0 vh=' + vh + ': pile sheet opened for the freeze check');
    ok(sizeSnapshot(window) === snap0, 'LAY-b1 vh=' + vh + ': tile/hand sizes identical with the sheet open');
    const cancel = $('sheet-cancel'); if (cancel) cancel.click();
    await new Promise(r => setTimeout(r, 60));
    ok(sizeSnapshot(window) === snap0, 'LAY-b2 vh=' + vh + ': sizes identical after the sheet closed');

    // (b2) mid-duel viewport resize must NOT recompute (frozen at duel start)
    Object.defineProperty(window, 'innerHeight', { value: vh + 160, configurable: true, writable: true });
    window.dispatchEvent(new window.Event('resize'));
    await new Promise(r => setTimeout(r, 60));
    ok(sizeSnapshot(window) === snap0, 'LAY-b3 vh=' + vh + ': sizes frozen against a mid-duel resize event');
    Object.defineProperty(window, 'innerHeight', { value: vh, configurable: true, writable: true });

    // (b3) chain dock opens -> sizes unchanged (full click play until then)
    if (vw === 390 && vh !== 720) {
      const how = await clickUntilDock(window, 300000);
      ok(how === 'dock' || how === 'result', 'LAY-b4 vh=' + vh + ': play reached a chain dock (ended via: ' + how + ')');
      if (how === 'dock') ok(sizeSnapshot(window) === snap0, 'LAY-b5 vh=' + vh + ': tile/hand sizes identical with the chain dock open');
    }
    window.close();
  }

  ok(handH[800] > handH[660], 'LAY-c: hand card height scales with the layout unit (660: ' + handH[660] + 'px -> 800: ' + handH[800] + 'px)');

  // (e) visualViewport honoured: innerHeight says 800 but only 760 is
  // actually visible — the layout must budget against the visible 760.
  {
    const window = await boot(390, 800, { visualH: 760 });
    const doc = window.document;
    doc.getElementById('startbtn').click();
    await waitFor(() => doc.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand (visualViewport case)');
    const L = window.__layout;
    console.log('  visualViewport case:', JSON.stringify(L));
    ok(L.vh === 760, 'LAY-e0: layout used the visual viewport height 760, not innerHeight 800');
    ok(L.contentH <= 760 - 4, 'LAY-e1: stack fits the visible 760 with margin (contentH ' + L.contentH + ')');
    ok(L.pvShown < pvShownAt[800], 'LAY-e2: preview shrank vs the full-800 layout (' + L.pvShown + ' < ' + pvShownAt[800] + ') — the shortfall came out of the slack, not the tiles');
    ok(L.tileW === 59, 'LAY-e3: tile unit unchanged by a 40px visible shortfall (tileW ' + L.tileW + ')');
    window.close();
  }

  // (f) measure-and-step-down against a phantom +28px rendered overshoot:
  // the budget must step down by the measured excess (preview absorbs it),
  // ending with the measured stack inside the allowed height.
  {
    const window = await boot(390, 800, { phantom: 28 });
    const doc = window.document;
    doc.getElementById('startbtn').click();
    await waitFor(() => doc.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand (phantom overshoot case)');
    const L = window.__layout;
    console.log('  phantom case:', JSON.stringify(L));
    ok(L.fit === true && L.fitSteps >= 1, 'LAY-f0: step-down engaged and converged (steps=' + L.fitSteps + ', fit=' + L.fit + ')');
    ok(L.measured <= 800 - 4, 'LAY-f1: measured stack bottom ' + L.measured + ' fits the allowed ' + (800 - 4));
    ok(L.contentH === 800 - 4 - 28, 'LAY-f2: budget stepped down by exactly the 28px excess (contentH ' + L.contentH + ')');
    ok(L.tileW === 59, 'LAY-f3: tile unit unchanged — the overshoot came out of the preview slack (tileW ' + L.tileW + ')');
    window.close();
  }

  console.log(failures === 0 ? 'ALL LAYOUT CHECKS PASSED' : failures + ' LAYOUT CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
