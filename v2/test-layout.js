'use strict';
/* test-layout.js — layout phase verification (jsdom; NODE_PATH=<dir with jsdom>).
   Boots the real page at 390x{600,620,660,720,800} and 500x900 (the 430px
   column cap), starts a duel (defaults: イシズ vs ゲート・ガーディアン, 先攻) and
   checks:
     (s) round 4 strip accounting: the ATK/DEF strip is budgeted at
         22px in BOTH the slot and the hand (slotH - imgH == 22,
         handH - round(handW*1.22) == 22), the CSS carries the
         two-line strip contract (22px height, column direction,
         nowrap lines, hidden hand scrollbar, text-size-adjust:100%),
         and __layout records stripClip (null in jsdom — no strip
         layout to measure). The 600/620 heights are the short-viewport
         cases the user hit on-device (in-app webview, ~650-700px
         class and below); they were added in round 4 together with
         the strip fix. At those heights the taller strips cost tile
         size, so the 47x60 baseline (LAY-a2) is asserted only for
         vh >= 660; the short cases assert the W floor instead. The
         chain-dock freeze play (b3) likewise runs at 660/800 only —
         the freeze code path is height-independent and proven there;
         this bounds suite time.
     (a) the computed stack fits the viewport WITH the safety margin:
         contentH <= vh - 8 and the dead band vh - contentH is in [8, 24)
         at every size (round 3: margin 6 -> 8; layout-fix accounting: the
         fixed part 217 was re-derived element by element against the CSS
         and is exact; the old exact-fill formula left a dead band of
         exactly 0 whenever the preview showed, so any real-world
         shortfall of the visible height vs window.innerHeight clipped
         the stack's bottom);
     (b) tile/hand sizes are frozen mid-duel: the sizing inputs (CSS vars on
         :root + window.__layout) are byte-identical before/after opening a
         selection sheet, after a mid-duel viewport resize event, and while
         the chain dock is open;
     (c) hand card height at 800 is larger than at 660;
     (d) at 800 the preview strip is shown (pvShown > 0, #preview.on) and
         tapping a hand card updates its content to that card;
     (e) visualViewport is honoured: with innerHeight 800 but a visual
         viewport of 760, the layout budgets against 760, not 800;
     (g) rect-based visible fit (round 2, target rule round 3): with a
         visual viewport that is shorter AND offset (innerHeight 800,
         vv.height 740, vv.offsetTop 30) and the painted stack bottom
         stubbed to overshoot (rect bottom starts at 810), the fit loop
         steps the budget down until the RECT bottom clears the round-3
         target: the MOST CONSERVATIVE visible bottom in rect coords is
         min(770 [offsetTop+height], 740 [height], 800 [innerHeight])
         = 740, so the ceiling is 740 - 8 = 732 — round 2 aimed at
         770 - 6 = 764, trusting the largest candidate. Every step is
         recorded in __layout.fitLog (start pass + settle entries).
         Round 1 steered this loop with document coordinates
         (offsetTop+offsetHeight), which cannot see a painted
         overshoot at all;
     (h) target rule (round 3): innerHeight 1080 with an offset visual
         viewport (height 1067, offsetTop 13) — visibleBottom must be
         1067, NOT 1080 (round 2's target), and the budget starts at
         1067 - 8;
     (i) diagnostic readout (round 3): with ?layoutdebug=1 in the URL
         a #layoutdebug text block exists after the fit and carries
         the fit state as text; without the parameter it never exists.
   jsdom has no layout engine, so sizes are measured through the exact
   inputs that determine them in a real browser: applyLayout() computes
   every box height in px (all bars carry explicit heights in index.html)
   and publishes them as CSS vars + window.__layout. getBoundingClientRect
   is all-zero in jsdom, so unstubbed cases report fit 'unmeasurable'
   (the formula stands) — exactly what the client must say there. The
   round-3 settle (one post-render fit pass inside the start sequence)
   still runs in jsdom — it fires from the duel's first onUpdate — but
   finds no rect information, so it records settled=true with a null
   settleRectBefore and changes nothing. */
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
  const dom = new JSDOM(html, { url: opts.url || 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  // viewport override BEFORE the duel starts (applyLayout reads these once,
  // at the start-button click)
  Object.defineProperty(window, 'innerWidth', { value: vw, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: vh, configurable: true, writable: true });
  if (opts.vv) Object.defineProperty(window, 'visualViewport', { value: { height: opts.vv.height, width: vw, offsetTop: opts.vv.offsetTop || 0 }, configurable: true });
  else if (opts.visualH) Object.defineProperty(window, 'visualViewport', { value: { height: opts.visualH, width: vw, offsetTop: 0 }, configurable: true });
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
  inject('duel-worker.js');
  inject('client.js');
  for (let i = 0; i < 100 && !window.document.getElementById('loadmsg').textContent.includes('準備完了'); i++)
    await new Promise(r => setTimeout(r, 50));
  if (opts.rectPhantom != null) {
    // Simulate a browser whose PAINTED stack overshoots the formula by
    // opts.rectPhantom px in rect coordinates: the hand bar (last
    // in-flow section) reports a getBoundingClientRect whose bottom is
    // (visual-viewport offsetTop) + (current formula stack) + phantom.
    // It tracks __layout, so as applyLayout steps the budget down the
    // reported bottom follows — the same relation round 1's real
    // browser exhibited between its modeled and painted heights.
    const hb = window.document.getElementById('handbar');
    const anchor = (opts.vv && opts.vv.offsetTop) || 0;
    hb.getBoundingClientRect = () => {
      const L = window.__layout;
      const bottom = anchor + (L ? L.contentH : 0) + opts.rectPhantom;
      return { top: anchor, bottom, height: bottom - anchor, left: 0, right: vw, width: vw, x: 0, y: anchor, toJSON() { return {}; } };
    };
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
      else if (q('.optbtn:not(.disabled)', sheet)) click(q('.optbtn:not(.disabled)', sheet)); // a disabled optbtn (e.g. an effect that cannot fire now) must not shadow #sheet-cancel — clicking it loops forever
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

  // round 4 strip contract (CSS level — jsdom cannot lay out text, so the
  // wrap-freedom of the strips is asserted as the CSS contract here and
  // verified geometrically in real Chromium; see NOTES round 4)
  ok(/\.slotstats\{[^}]*height:24px[^}]*flex-direction:column/.test(html), 'LAY-s0: .slotstats is a 24px two-line (column) strip (B-15: 22px was the round-4 floor; the audit raised it to 24 for legibility)');
  ok(/\.hstats\{[^}]*height:24px[^}]*flex-direction:column/.test(html), 'LAY-s1: .hstats is a 24px two-line (column) strip (B-15)');
  ok(/\.slotstats span\{[^}]*white-space:nowrap/.test(html) && /\.hstats span\{[^}]*white-space:nowrap/.test(html), 'LAY-s2: strip lines are nowrap (a line can never wrap into the strip height again)');
  ok(/text-size-adjust:100%/.test(html), 'LAY-s3: text-size-adjust:100% set (no webview text inflation)');
  ok(/#hand\{[^}]*scrollbar-width:none/.test(html), 'LAY-s4: #hand scrollbar hidden (classic-scrollbar environments must not eat the strip)');

  const pvShownAt = {};
  const tileWAt = {};
  for (const [vw, vh] of [[390, 600], [390, 620], [390, 660], [390, 720], [390, 800], [500, 900]]) {
    const window = await boot(vw, vh);
    const doc = window.document;
    const $ = (id) => doc.getElementById(id);
    doc.getElementById('startbtn').click();
    await waitFor(() => doc.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand at vh=' + vh);
    const L = window.__layout;
    console.log('  ' + vw + 'x' + vh + ':', JSON.stringify(L));
    ok(!!L && L.vh === vh && L.vw === Math.min(vw, 430), 'LAY-a0 ' + vw + 'x' + vh + ': layout computed for the requested viewport (column cap ' + Math.min(vw, 430) + ')');
    // ROUND 5 (I1): the phase bar now takes its natural 39px
    // (LAYOUT_FIXED 215 -> 220), which moves two of these sizes'
    // arithmetic without touching the fit guarantee itself:
    //  - vh 600 is the minimum-layout case: every element sits at
    //    its floor (tile 40, no preview) and the honest stack is
    //    595 — it fits the visible 600 with 5px to spare but eats
    //    3px of the 8px safety. The layout code's own contract
    //    covers this regime ("minimum layout is kept, fit reports
    //    false"); what must NOT happen is a clip (contentH > vh).
    //  - vh 620: the leftover (17px) can no longer fund even the
    //    compact preview (its floor is 20px), so it stays as dead
    //    band on top of the safety: dead < 28 = 8 + 20 replaces
    //    the old < 24 upper bound at the tile-floor sizes.
    if (vh === 600) {
      ok(L.contentH <= vh && L.tileW === 40 && L.pvShown === 0, 'LAY-a ' + vw + 'x' + vh + ': minimum layout — the all-floors stack (' + L.contentH + ') fits the visible height with no clip (round 5: 3px of the safety is spent on the phase bar natural height)');
    } else {
      ok(L.contentH <= vh - 8 && L.dead >= 8 && L.dead < 28, 'LAY-a ' + vw + 'x' + vh + ': stack fits with the 8px safety margin, dead band ' + L.dead + 'px (in [8, 28), no scroll, no clip)');
    }
    ok(L.settled === true && L.settleRectBefore === null && L.handRectBottom === null, 'LAY-a5 ' + vw + 'x' + vh + ': the round-3 settle ran inside the start sequence (settled=true) and, rects being absent in jsdom, honestly recorded null measurements');
    if (vh >= 720) ok(L.tileW >= 47 && L.slotH >= 60, 'LAY-a2 ' + vw + 'x' + vh + ': board never below the old fixed baseline 47x60 (tile ' + L.tileW + 'x' + L.slotH + ')');
    else if (vh === 660) ok(L.tileW >= 40, 'LAY-a2m ' + vw + 'x' + vh + ': B-14 funded-preview region — tiles shrink toward the 40px floor so the decided detail preview exists (tile ' + L.tileW + 'x' + L.slotH + '); the 47px baseline yields to the preview here by approved design');
    else ok(L.tileW >= 40 && L.slotH >= 70, 'LAY-a2s ' + vw + 'x' + vh + ': short-height case — tile at/above the W floor 40 with the 24px strips (tile ' + L.tileW + 'x' + L.slotH + '); the 47px baseline is not reachable at this height once the strips carry two full lines');
    // the hand may additionally GROW with leftover (pre-existing distribution),
    // so its strip share is 22 + growth, bounded by the 1.3x hand cap
    ok(L.slotH - L.imgH === 24 && L.handH - Math.round(L.handW * 1.22) >= 24 && L.handH <= Math.round((Math.round(L.handW * 1.22) + 24) * 1.3),
      'LAY-s5 ' + vw + 'x' + vh + ': strip budgeted at 24px in slot and hand (slotH-imgH ' + (L.slotH - L.imgH) + ', handH-handImgH ' + (L.handH - Math.round(L.handW * 1.22)) + ' = 24 + hand growth, within the 1.3x cap)');
    ok(L.stripClip === null, 'LAY-s6 ' + vw + 'x' + vh + ': stripClip recorded as null in jsdom (no strip layout to measure — the field exists and stays honest)');
    ok(L.fit === 'unmeasurable' && L.fitVisible === null && L.fitSteps === 0, 'LAY-a3 ' + vw + 'x' + vh + ': rect measurement unavailable in jsdom — fit honestly reported as unmeasurable, formula stands');
    ok(L.innerHeight === vh && L.vvHeight === null && L.vvOffsetTop === 0 && L.visibleBottom === vh && Array.isArray(L.fitLog) && L.fitLog.length === 1 && L.fitLog[0].rectBottom === null, 'LAY-a4 ' + vw + 'x' + vh + ': __layout records the height signals + step log (innerHeight ' + L.innerHeight + ', clientHeight ' + L.clientHeight + ', visibleBottom ' + L.visibleBottom + ')');
    handH[vh] = L.handH;
    pvShownAt[vh] = L.pvShown;
    tileWAt[vh] = L.tileW;
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

    // (b3) chain dock opens -> sizes unchanged (full click play until then;
    // 660/800 only — the freeze path is height-independent, see header (s))
    if (vw === 390 && (vh === 660 || vh === 800)) {
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
    const window = await boot(390, 800, { vv: { height: 760, offsetTop: 0 } });
    const doc = window.document;
    doc.getElementById('startbtn').click();
    await waitFor(() => doc.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand (visualViewport case)');
    const L = window.__layout;
    console.log('  visualViewport case:', JSON.stringify(L));
    ok(L.vh === 760 && L.vvHeight === 760, 'LAY-e0: layout used the visual viewport height 760, not innerHeight 800');
    ok(L.contentH <= 760 - 8 && L.dead >= 8, 'LAY-e1: stack fits the visible 760 with the 8px margin (contentH ' + L.contentH + ')');
    // ROUND 5 (I1): at the 760 budget the preview is already at
    // its 56px cap in BOTH layouts, so the 40px shortfall now
    // lands on the tile unit (57 -> 56 under LAYOUT_FIXED 220)
    // instead of shrinking the preview — the assertion's point
    // stands: the shortfall is visibly paid, not silently absorbed.
    ok(L.tileW < tileWAt[800], 'LAY-e2: the 760 layout pays for the shorter visible height — tile unit stepped down vs the full-800 layout (' + L.tileW + ' < ' + tileWAt[800] + '; the preview is at its cap in both)');
    ok(L.tileW === 56, 'LAY-e3: under B-14 the preview floor is funded by the tiles, so a 40px visible shortfall steps the tile unit down to the funded size (tileW ' + L.tileW + '; was 59 under the pre-B-14 slack-first order, 57 under LAYOUT_FIXED 215)');
    window.close();
  }

  // (g) rect-based visible fit against a shorter, OFFSET visual
  // viewport plus a painted overshoot: innerHeight 800, vv.height 740,
  // vv.offsetTop 30. Round 3's target is the most conservative
  // rect-coordinate bottom: min(30 + 740, 740, 800) = 740 (round 2
  // used 770 and a 6px margin → ceiling 764), so the stack must clear
  // 740 − 8 = 732 by RECT measurement. The budget starts at 732
  // (formula contentH 732) and the stubbed painted bottom starts at
  // 810 (30 + 732 + phantom 48) — a document-coordinate loop
  // (round 1) would have seen contentH ≤ 740 − 4 and certified a fit
  // while 48px of stack painted below its modeled edge. The budget
  // base must be min(740, 800) = 740 (jsdom's clientHeight 0 is
  // "no signal" and must not zero the budget). The settle pass runs
  // too (it fires from the first onUpdate) and appends its own entry:
  // its pre-pass measurement reads the standing stack (732).
  {
    const window = await boot(390, 800, { vv: { height: 740, offsetTop: 30 }, rectPhantom: 48 });
    const doc = window.document;
    doc.getElementById('startbtn').click();
    await waitFor(() => doc.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand (rect phantom case)');
    const L = window.__layout;
    console.log('  rect phantom case:', JSON.stringify(L));
    ok(L.vh === 740 && L.vvHeight === 740 && L.vvOffsetTop === 30 && L.visibleBottom === 740 && L.innerHeight === 800, 'LAY-g0: budget height is the visual 740 (clientHeight 0 ignored); the target distrusts the largest candidate — visible bottom 740, not 30 + 740 = 770');
    ok(L.fitLog.length >= 2 && L.fitLog[0].rectBottom === 810, 'LAY-g1: first painted measurement was 810 (30 + 732 + 48) — the overshoot is on record');
    ok(L.fit === true && L.fitVisible === true && L.fitSteps >= 1, 'LAY-g2: step-down engaged and converged on rect evidence (steps=' + L.fitSteps + ', fit=' + L.fit + ')');
    ok(L.rectBottom !== null && L.rectBottom <= 732, 'LAY-g3: final painted bottom ' + L.rectBottom + ' clears the visible ceiling 732 (740 − 8)');
    ok(L.budget === 654 && L.contentH <= 654, 'LAY-g4: budget stepped down by exactly the 78px rect excess over the round-3 ceiling (budget ' + L.budget + ', contentH ' + L.contentH + ')');
    ok(L.measured === 0, 'LAY-g5: document-coordinate record stays 0 here (jsdom offsets) — the loop no longer steers by it');
    ok(L.settled === true && L.settleRectBefore === 732 && L.fitLog.some(e => e.pass === 'settle'), 'LAY-g6: the settle pass ran post-render, recorded the standing painted bottom (732; V3 stage-4 accounting — with the 24px strips and the funded preview the start pass converges in one step, so the standing stack the settle reads is 30 + 654 + 48) and appended its fitLog entry');
    window.close();
  }

  // (h) target rule (round 3) without any phantom: a tall window
  // (innerHeight 1080) whose visual viewport is offset (height 1067,
  // offsetTop 13) — the shape suspected in the verification browser.
  // Round 2's target was offsetTop + height = 1080; round 3 must
  // distrust it and budget against 1067 - 8 = 1059.
  {
    const window = await boot(430, 1080, { vv: { height: 1067, offsetTop: 13 } });
    const doc = window.document;
    doc.getElementById('startbtn').click();
    await waitFor(() => doc.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand (offset vv case)');
    const L = window.__layout;
    console.log('  offset vv case:', JSON.stringify(L));
    ok(L.vvHeight === 1067 && L.vvOffsetTop === 13 && L.innerHeight === 1080 && L.visibleBottom === 1067, 'LAY-h0: target is the conservative 1067 (vv.height), not offsetTop + height = 1080');
    ok(L.budget === 1059 && L.contentH <= 1059 && L.dead >= 8, 'LAY-h1: budget starts at target − 8 = 1059 (budget ' + L.budget + ', contentH ' + L.contentH + ')');
    window.close();
  }

  // (i) diagnostic readout (round 3): ?layoutdebug=1 puts the fit
  // state on the page as text; without the parameter there is no
  // readout element at all (checked inside the plain boots too).
  {
    const window = await boot(390, 720, { url: 'http://localhost/v2/?layoutdebug=1' });
    const doc = window.document;
    doc.getElementById('startbtn').click();
    await waitFor(() => doc.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand (layoutdebug case)');
    const dbg = doc.getElementById('layoutdebug');
    ok(!!dbg, 'LAY-i0: #layoutdebug exists when the URL carries ?layoutdebug=1');
    ok(!!dbg && /target=720/.test(dbg.textContent) && /fit=/.test(dbg.textContent) && /handBottom=/.test(dbg.textContent) && /settled=true/.test(dbg.textContent), 'LAY-i1: readout carries the fit state as text (target / fit / handBottom / settled): ' + (dbg ? JSON.stringify(dbg.textContent) : 'none'));
    window.close();
    const plain = await boot(390, 720);
    plain.document.getElementById('startbtn').click();
    await waitFor(() => plain.document.querySelectorAll('#hand .hcard').length >= 5, 60000, 'opening hand (plain case)');
    ok(plain.document.getElementById('layoutdebug') === null, 'LAY-i2: no #layoutdebug without the parameter, even after a duel start (default off, no DOM change)');
    plain.close();
  }

  console.log(failures === 0 ? 'ALL LAYOUT CHECKS PASSED' : failures + ' LAYOUT CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
