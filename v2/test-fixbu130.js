'use strict';
/* test-fixbu130.js — fix-bu130-1126 (run 25, 2026-11-26).
 *
 * BU-130: the floating detail pop (#infopop) hid the tail of long
 * effect texts at first paint. At 390x620 the 207-char
 * 《巨神封じの矢》 measured scrollH 490 vs clientH 395 (95px
 * overflow), its last line 81px under the sticky .btnrow top
 * (4px visible); the longest text in the pool,
 * 《シューティング・スター・ドラゴン》 (261 chars, 10 lines),
 * measured scrollH 531 vs clientH 395, overlap 122px, last line
 * 0px visible. At 700 the same card overlapped 30px. Scrolling
 * showed the full text, so the tail existed but was invisible at
 * first paint — the detail pop exists to be READ (R-SEL-1).
 *
 * Mechanism (same as BU-129): #infopop IS the scroller
 * (overflow-y:auto) and its .btnrow is `position:sticky;
 * bottom:0` with an opaque background, so it paints over the
 * scrolling content beneath it. The pop's max-height:64% against
 * a 180px art band + name + meta + full text + sticky button row
 * simply did not add up for long texts.
 *
 * Candidates MEASURED live (probe-whatif-bu130.js, baseline mirror):
 *   (a) ledger option — art 140px + max-height 72%: fits the
 *       207-char card at 620 (overlap 81px -> 0, last line fully
 *       visible) but NOT the 261-char card (overlap 33px, last
 *       line 0px visible). Rejected: the pool's longest text is
 *       the bar, not the median.
 *   (b) art 90px + 72%: fits everything, but shrinks the art for
 *       EVERY card, including 13-char texts — the card-view rule
 *       (detail surfaces lead with BIG art) would pay for a
 *       problem short cards do not have. Rejected.
 *   (c) adopted — max-height 64% -> 72% plus fitInfoPop(): after
 *       opening, shrink the art band in 20px steps until the whole
 *       content fits (floor 70px). The band keeps its full 180px
 *       whenever it fits (short card: 180px at both heights;
 *       207-char at 700: 180px) and only shrinks as far as the
 *       text needs (620: 207-char -> 120px, 261-char -> 80px;
 *       700: 261-char -> 140px). The loop runs synchronously in
 *       openInfoPop, before first paint, so there is no jump.
 *   (d) fx variant: opening the full-text <details> adds the
 *       segment + label + summary (~60px), so the longest cards
 *       still overflowed at 620 even at the 70px floor (overlap
 *       33px). The toggle listener re-runs fitInfoPop, and while
 *       the details are open the pop may grow to 82% of the
 *       viewport (:has rule), which fits the worst case with the
 *       band at 80px. Closing the details re-fits from the full
 *       band (fitInfoPop resets the inline height first).
 * The BU-129 lesson holds: NO bottom padding (measured to worsen
 * the cut). Effect text itself is never shortened.
 *
 * Pinned by source + jsdom behaviour; the visual proof is the
 * Chromium probe (probe-fixbu130.js): 6 cards x 2 heights x plain
 * and fx-expanded = 24 states, all overlap 0 with the last line
 * fully visible, screenshots eyeballed (worst case 620/24696097
 * plain and fx-expanded, 700/24696097, short card 620/55144522).
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

// ---------- BU-130 source pins ----------
{
  const m = html.match(/#infopop\{[^}]*\}/);
  ok(!!m, 'F130a: the #infopop rule exists (setup)');
  if (m) {
    ok(m[0].includes('max-height:72%'), 'F130b: #infopop max-height is 72% (was 64%)');
    ok(!m[0].includes('max-height:64%'), 'F130c: the old 64% cap is gone');
    ok(m[0].includes('padding:12px'), 'F130d: #infopop keeps padding:12px — no bottom-padding workaround (BU-129 lesson: padding WORSENS the cut)');
  }
}
ok(html.includes('#infopop:has(details.fxfull[open]){max-height:82%;}'),
  'F130e: while the fx full-text details are open the pop may grow to 82% (the expanded state needs ~60px more)');
ok(html.includes('#infopop .popart{position:relative;width:100%;height:min(180px,30dvh);'),
  'F130f: the art band keeps its full min(180px,30dvh) default — shrinking happens only in JS, only when needed');
ok(clientSrc.includes('function fitInfoPop()'),
  'F130g: fitInfoPop exists');
ok(clientSrc.includes('while (pop.scrollHeight > pop.clientHeight && h > 70)'),
  'F130h: the fit loop shrinks until the content fits, floor 70px');
ok(clientSrc.includes("h = Math.max(70, h - 20); art.style.height = h + 'px';"),
  'F130i: the loop steps the band down 20px at a time');
ok(clientSrc.includes("art.style.height = ''; // reset: re-fit from the full band every time,"),
  'F130j: fitInfoPop resets the band first, so closing the details grows it back');
ok(clientSrc.includes('fitInfoPop();\n  const det = '),
  'F130k: openInfoPop runs the fit after opening');
ok(clientSrc.includes("if (det) det.addEventListener('toggle', fitInfoPop);"),
  'F130l: expanding/collapsing the fx full-text details re-runs the fit');

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
  const pop = doc.getElementById('infopop');

  // fitInfoPop is a safe no-op while the pop is closed
  window.eval('fitInfoPop()');
  ok(pop.className === '', 'F130m: fitInfoPop with the pop closed does nothing (guard)');

  // ----- BU-130 live: the longest text in the pool opens whole -----
  window.eval('openInfoPop(24696097, null, null)');
  await sleep(100);
  ok(pop.className.includes('on'), 'F130n: the detail pop opens for the 261-char card (setup)');
  const ttl = pop.querySelector('.ttl');
  ok(ttl && ttl.textContent.includes('シューティング・スター・ドラゴン'),
    'F130o: the pop shows the longest-text card (got ' + JSON.stringify(ttl && ttl.textContent) + ')');
  const ct = pop.querySelector('.cardtext');
  ok(!!ct && ct.textContent.length === 261,
    'F130p: the full 261-char effect text is in the pop (got ' + (ct ? ct.textContent.length : 0) + ' chars)');
  ok(!!pop.querySelector('.popart'), 'F130q: the art band is present');
  ok(!!pop.querySelector('#infopop-close'), 'F130r: the close button is present');
  ok(pop.querySelector('#infopop-close').textContent.trim() === '閉じる',
    'F130s: over a pure view the button reads 閉じる (got ' + JSON.stringify(pop.querySelector('#infopop-close').textContent.trim()) + ')');

  // ----- fx variant: segment + collapsed full text, toggle refits -----
  window.eval("openInfoPop(24696097, null, { n: 1, act: true, body: '①：テスト用の短い効果文です。' })");
  await sleep(100);
  const det = pop.querySelector('details.fxfull');
  ok(!!det, 'F130t: the fx variant carries the full-text <details> (setup)');
  const seg = pop.querySelector('.cardtext.fxmain');
  ok(!!seg && seg.textContent.includes('テスト用の短い効果文'),
    'F130u: the fx segment is shown above the details');
  // expand the details: the toggle listener must not throw, and the
  // band must still be the CSS default in jsdom (no layout to fit)
  det.querySelector('summary').click();
  await sleep(100);
  ok(det.open === true, 'F130v: the details expand on summary click (setup)');
  const art = pop.querySelector('.popart');
  ok(art && art.style.height === '', 'F130w: after expanding, the band has no forced inline height in jsdom (the fit loop found nothing to shrink without layout)');
  // close again: the band must come back to the default (reset path)
  det.querySelector('summary').click();
  await sleep(100);
  ok(det.open === false && art.style.height === '', 'F130x: closing the details leaves the band at its default');

  // a short card keeps the full band and the whole text
  window.eval('openInfoPop(55144522, null, null)');
  await sleep(100);
  const ct2 = pop.querySelector('.cardtext');
  ok(!!ct2 && ct2.textContent.includes('自分は２枚ドローする'),
    'F130y: a 13-char card still opens with its whole text');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FIX-BU130 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
