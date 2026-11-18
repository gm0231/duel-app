'use strict';
/* test-fixbu114115.js — fix-bu114-115-1118 (BU-114 + BU-115, run 17).
 *
 * BU-114: the peekbar (folded action-sheet band) cut answer-button
 * labels mid-word ("モンスターをセット" -> "モンスターを…",
 * "魔法・罠をセット" -> "魔法・罠をセ…", run 17: 620-018, 700-017).
 * Cause: equal-share flex (flex:1 1 0) squeezed every label to the
 * row's narrowest share, with ellipsis hiding the rest. DOM innerText
 * holds the full text, so only a visual check (or a Range width
 * measurement) can see it. Fix: buttons keep their natural width
 * (flex:1 1 auto, no ellipsis) and the band scrolls horizontally
 * when the row overflows, instead of truncating labels. The × and
 * 選択に戻る chrome buttons stick to their edges so the escape
 * hatches stay visible while scrolling. Two-row wrap stays off the
 * table (BU-55: it ate the hand's bottom edge at short heights);
 * shortening the labels was rejected ("モンスターをセット" and
 * "魔法・罠をセット" would both collapse to "セット").
 *
 * BU-115: in watch mode (?watch=1) event notices covered the
 * watchbar ("観戦中（開発者用・両席CPU）／観戦をやめる"), because
 * the notice band seats below row 2 and the watchbar IS the header's
 * bottom row in watch mode (run 17: watch-02-mid.png). Fix: the seat
 * for the below-row-2 band (fxBelowRow2Seat) moves below the
 * watchbar in watch mode, for both the notice and the name tag.
 * Normal duels are unchanged (watchbar is display:none there).
 *
 * notice-center-1118 (USER DECISION 2026-11-18): the notice is a
 * centre band again, so the BU-115 covering is moot for the notice
 * itself — the band never reaches the watchbar, and its input-lock
 * veil starts BELOW the header (the watchbar stays clickable).
 * fxBelowRow2Seat survives as the name tag's seat, watch-aware as
 * before; the pins below keep the helper's watch behaviour and pin
 * the notice's new centre form.
 *
 * Pinned by source + the seat helper's logic in jsdom; the visual
 * proof is the Chromium probe (probe-bu114115.js): BU-114 pre-fix
 * truncated labels in both observed sheets (post-fix 0, no scroll
 * needed for 2-answer sheets, 6-button strip fully rendered with
 * sticky chrome); BU-115 pre-fix notice/watchbar overlap (post-fix
 * 0, watchstop hit-test passes).
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

// CSS rule extraction helpers
const rule = (sel) => {
  const m = html.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'));
  return m ? m[1] : null;
};
const peekBtnRule = rule('#peekbar .bigbtn');
const peekBarRule = rule('#peekbar');
const pbxRule = rule('#peekbar .bigbtn.pb-x');
const pbBackRule = rule('#peekbar .bigbtn.pb-back');

// ---------- BU-114 source pins ----------
ok(peekBtnRule && /flex:\s*1\s+1\s+auto/.test(peekBtnRule), 'B114a: peekbar buttons size to content (flex:1 1 auto)');
ok(peekBtnRule && !/flex:\s*1\s+1\s+0/.test(peekBtnRule), 'B114b: no more equal-share flex (flex:1 1 0 is gone)');
ok(peekBtnRule && !/text-overflow:\s*ellipsis/.test(peekBtnRule), 'B114c: no ellipsis truncation on peekbar buttons');
ok(peekBtnRule && !/overflow:\s*hidden/.test(peekBtnRule), 'B114d: no overflow:hidden clipping peekbar labels');
ok(peekBarRule && /overflow-x:\s*auto/.test(peekBarRule), 'B114e: the band scrolls horizontally on overflow');
ok(peekBarRule && /flex-wrap:\s*nowrap/.test(peekBarRule), 'B114f: still one row (BU-55: no wrap)');
ok(peekBtnRule && /font-size:\s*12\.5px/.test(peekBtnRule), 'B114g: labels stay at 12.5px (readability floor)');
ok(pbxRule && /position:\s*sticky/.test(pbxRule) && /left:\s*0/.test(pbxRule), 'B114h: × sticks to the left edge while scrolling');
ok(pbBackRule && /position:\s*sticky/.test(pbBackRule) && /right:\s*0/.test(pbBackRule), 'B114i: 選択に戻る sticks to the right edge while scrolling');

// ---------- BU-115 source pins ----------
ok(clientSrc.includes('function fxBelowRow2Seat()'), 'B115a: the below-row-2 seat helper exists');
ok(!clientSrc.includes('const seatTop = fxBelowRow2Seat();'), 'B115b: notice-center-1118: the notice no longer seats via fxBelowRow2Seat() (centre band; the helper is the tag seat now)');
ok(clientSrc.includes('let tagTopVp = fxBelowRow2Seat();'), 'B115c: the name tag seats via fxBelowRow2Seat()');
ok(/function fxBelowRow2Seat\(\)[\s\S]{0,600}watchModeOn/.test(clientSrc), 'B115d: the seat accounts for watch mode');
ok(/function fxBelowRow2Seat\(\)[\s\S]{0,600}watchbar/.test(clientSrc), 'B115e: the seat measures the watchbar');
ok(!/const seatTop = fxRow2Bottom\(\) \+ 2;/.test(clientSrc), 'B115f: no remaining row-2-only notice seat');

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
const stubRect = (el, r) => {
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => ({ x: r.x || 0, y: r.y || 0, left: r.x || 0, top: r.y || 0, right: (r.x || 0) + (r.w || 0), bottom: (r.y || 0) + (r.h || 0), width: r.w || 0, height: r.h || 0 }), configurable: true });
};

(async () => {
  // Watch mode, mocked geometry: header 0..100, row 2 bottom 71,
  // watchbar 71..100 (29px). The seat must clear the watchbar (102),
  // not stop below row 2 (73).
  const w = await boot('http://localhost/v2/?watch=1');
  const doc = w.document;
  const seat = (label) => w.eval('fxBelowRow2Seat()');
  stubRect(doc.getElementById('header'), { x: 0, y: 0, w: 390, h: 100 });
  stubRect(doc.getElementById('logline'), { x: 0, y: 47, w: 200, h: 24 });
  stubRect(doc.getElementById('turninfo'), { x: 0, y: 47, w: 60, h: 24 });
  stubRect(doc.getElementById('oppHandChip'), { x: 0, y: 47, w: 60, h: 24 });
  stubRect(doc.getElementById('autopass'), { x: 0, y: 47, w: 0, h: 0 });
  const wb = doc.getElementById('watchbar');
  wb.classList.add('on');
  stubRect(wb, { x: 0, y: 71, w: 390, h: 29 });
  ok(seat() === 102, 'B115g: watch-mode seat clears the watchbar (got ' + seat() + ', want 102)');
  ok(w.eval('fxRow2Bottom()') === 71, 'B115h: row-2 bottom itself is unchanged (71)');

  // notice-center-1118: the notice is a centre band (no inline
  // top at all), and its lock veil starts at the header's bottom
  // edge — below the watchbar, which stays clickable.
  stubRect(doc.getElementById('fxlayer') || doc.body, { x: 0, y: 0, w: 390, h: 620 });
  w.eval("fxNoticeShow('相手の《雷魔神－サンガ》が《花と野原の春化精》に攻撃', '攻撃宣言', true)");
  await sleep(100);
  const n = doc.querySelector('#fxlayer .fx-notice');
  ok(!!n, 'B115i: the notice renders in watch mode');
  if (n) ok(n.style.top === '', 'B115j: the notice carries no inline top (centre seat is CSS; got "' + n.style.top + '")');
  const vl = doc.querySelector('#fxlayer .fx-notice-veil');
  ok(!!vl && vl.style.top === '100px', 'B115j2: the lock veil starts at the header bottom edge (100px, below the watchbar 71..100; got ' + (vl && vl.style.top) + ')');

  // Non-watch mode: the seat is unchanged even with a watchbar rect present.
  const w2 = await boot('http://localhost/v2/');
  const doc2 = w2.document;
  stubRect(doc2.getElementById('header'), { x: 0, y: 0, w: 390, h: 100 });
  stubRect(doc2.getElementById('logline'), { x: 0, y: 47, w: 200, h: 24 });
  const wb2 = doc2.getElementById('watchbar');
  stubRect(wb2, { x: 0, y: 71, w: 390, h: 29 });
  ok(w2.eval('fxBelowRow2Seat()') === 73, 'B115k: normal-duel seat is row 2 + 2 (got ' + w2.eval('fxBelowRow2Seat()') + ', want 73)');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('ERROR', e); process.exit(1); });
