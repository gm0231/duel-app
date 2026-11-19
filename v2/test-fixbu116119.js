'use strict';
/* test-fixbu116119.js — fix-bu116-119-1119 (run 18, 2026-11-19).
 *
 * BU-116: the centre notice overlaps the turn banner (both are
 * "main" displays at screen centre; a notice born at a turn change
 * lands on 「自分のターン」/「相手のターン」). Fix: fxNoticeShow
 * holds the notice while a turn banner is live (the BU-89 apflash
 * deferral pattern: busy stays up, queue order kept), bounded at
 * ~4.5 s of retries, then shows regardless. A generation guard
 * retires a held show across a duel reset, so a stale notice can
 * never resurrect after fxResetFoundation. The mirror case — a
 * banner born while a notice is up (the probe caught it twice:
 * the duel-start initial-draw notice vs the turn-1 banner, a
 * 1-2px graze against the fading banner) — is held the same way:
 * fxTurnBanner pends while a notice element is live, same 2.6s
 * cap, then shows regardless.
 * BU-117: the centre seat measured only 195px wide (left:50% +
 * shrink-to-fit caps the usable width at 390-195), so long notices
 * wrapped card names mid-word. Fix: an explicit 86% width
 * (left/right 7%) + explicit <wbr> at separators/punctuation
 * inside card names (the fix9396d counting already accepts breaks
 * there; the wholly-intact-name rule of B107 is retired — see
 * test-fixbu107.js) + an explicit <wbr> between two adjacent
 * names (《A》《B》, the move-notice shape: the UAX#14 》《
 * boundary already breaks there in Chrome, the explicit
 * opportunity makes it engine-independent).
 * BU-118: at 390x700 the preview band is 52px tall but the stack
 * above .pv-text leaves ~11px for it — less than one 17.8px
 * effect line — so the first effect line renders cut mid-glyph.
 * Fix: fitPreviewText clamps .pv-text to whole lines only (0 =
 * hide it outright), re-measured on every renderPreview.
 * BU-119: in the peekbar a long activation label reads only as
 * its head, because the sticky 選択に戻る floats over its
 * continuation while it scrolls. Fix: the mirrors ride in an
 * inner scroller (.pb-scroll); × / 選択に戻る are fixed flex
 * siblings with reserved slots; mirror labels shorten to their
 * first sentence; the scroller fades its right edge while there
 * is more to scroll.
 *
 * Pinned by source + jsdom behaviour where layout exists; the
 * visual proof is the Chromium probe (probe-fixbu116119.js):
 * BU-116 0 notice/banner overlaps across turn changes, BU-117 0
 * mid-word name breaks in the run-18 long notices, BU-118 0
 * half-cut preview lines at 700, BU-119 the long label
 * identifiable at first paint with no chrome overlay.
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
// BU-116: the banner hold + the generation guard
{
  const showFn = clientSrc.slice(clientSrc.indexOf('function fxNoticeShow('), clientSrc.indexOf('function fxOppTagsFromEvents('));
  ok(showFn.includes('fxTurnBannerActive()'), 'F116a: fxNoticeShow defers while a turn banner is live (BU-116)');
  ok(showFn.includes('(deferrals || 0) < 10'), 'F116b: the banner hold is bounded (~4.5 s of retries, then the notice shows regardless)');
  ok(showFn.includes('if (gen !== fxNoticeGen) return;'), 'F116c: a held show is retired by a duel reset (generation guard)');
  ok(showFn.includes('fxNoticeBusy = true;'), 'F116d: the hold keeps the busy flag up (queue order is preserved)');
}
ok(clientSrc.includes('let fxNoticeGen = 0;'), 'F116e: the notice generation counter exists');
ok(/function fxResetFoundation\(\)[\s\S]{0,1200}fxNoticeGen\+\+/.test(clientSrc), 'F116f: a duel reset bumps the generation');
// BU-116 reverse race: the banner pends while a notice is live
{
  const banFn = clientSrc.slice(clientSrc.indexOf('function fxTurnBanner('), clientSrc.indexOf('// ------------------------------------------------------------ V3 stage 1: FX foundation'));
  ok(banFn.includes('fxDecisionUiOpen() || fxNoticeLive()'), 'F116n: fxTurnBanner pends while a notice is live (BU-116 reverse race)');
  ok(banFn.includes('!fxDecisionUiOpen() && !fxNoticeLive()'), 'F116o: the pending banner re-fires only once the notice is gone');
  ok(clientSrc.includes('function fxNoticeLive()'), 'F116p: the live-notice signal exists (a .fx-notice element in the layer)');
}
// BU-117: the explicit-width seat
ok(html.includes('.fx-notice{position:absolute;left:7%;right:7%;top:33%;transform:translate(0,-50%);z-index:8;'),
  'F117a: the notice seat is an explicit 86% width (left/right 7%), not the 195px shrink-to-fit seat');
ok(!/\.fx-notice\{[^}]*left:50%/.test(html), 'F117b: no left:50% seat remains on the notice');
ok(!/\.fx-notice\{[^}]*max-width:86%/.test(html), 'F117c: the max-width-only seat is gone (width is explicit now)');
// BU-118: the whole-line fit
ok(clientSrc.includes('function fitPreviewText()'), 'F118a: fitPreviewText exists');
ok(clientSrc.includes('Math.floor(avail / lh)'), 'F118b: the fit counts whole lines only');
{
  const rp = clientSrc.slice(clientSrc.indexOf('function renderPreview()'), clientSrc.indexOf('function updatePreviewFromState('));
  ok((rp.match(/fitPreviewText\(\);/g) || []).length >= 2, 'F118c: renderPreview fits on both paths (rebuild + sig-unchanged, so a resize re-fits)');
  ok(clientSrc.includes("if (n <= 0) { textEl.style.display = 'none';"), 'F118d: zero whole lines hides the text outright (never a half-cut row)');
}
// BU-119: the scroller + fixed chrome + label shortener
ok(html.includes('#peekbar .pb-scroll{flex:1 1 auto;min-width:0;display:flex;flex-wrap:nowrap;gap:6px;overflow-x:auto;overflow-y:hidden;}'),
  'F119a: the mirrors ride in an inner scroller (.pb-scroll)');
ok(html.includes('.pb-scroll.canscroll{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 26px),transparent 100%);'),
  'F119b: the scroller fades its right edge while there is more to scroll');
ok(clientSrc.includes('function peekBarLabel(text)'), 'F119c: the mirror-label shortener exists');
{
  const sync = clientSrc.slice(clientSrc.indexOf('function syncPeekBar()'), clientSrc.indexOf('// R-SEL-1:'));
  ok(sync.includes("sc.className = 'pb-scroll';"), 'F119d: syncPeekBar builds the inner scroller');
  ok(sync.includes('bar.appendChild(sc);'), 'F119e: the scroller sits between the chrome buttons in the band');
  ok(sync.includes('peekBarLabel('), 'F119f: mirror labels go through the shortener');
  ok(sync.includes("sc.addEventListener('scroll', updFade"), 'F119g: the fade tracks scrolling');
}

// ---------- live behaviour in jsdom ----------
async function boot(url) {
  const dom = new JSDOM(html, { url: url || 'http://localhost/v2/', runScripts: 'dangerously', pretendToBeVisual: true });
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
const stubNum = (el, prop, v) => Object.defineProperty(el, prop, { value: v, configurable: true });

(async () => {
  const window = await boot();
  const doc = window.document;
  const layer = doc.getElementById('fxlayer');

  // ----- BU-116 live: the notice waits out the turn banner -----
  window.eval('fxTurnBanner(true, 1)');
  await sleep(120);
  ok(!!doc.querySelector('.fx-turn'), 'F116g: the turn banner is live');
  window.eval("fxNotice('相手のカード5枚が手札に加わった', 'カードの移動｜デッキ→手札', true)");
  await sleep(400);
  ok(!doc.querySelector('#fxlayer .fx-notice'), 'F116h: no notice shows while the banner is live');
  let shown = false;
  for (let i = 0; i < 25 && !shown; i++) { await sleep(400); shown = !!doc.querySelector('#fxlayer .fx-notice'); }
  ok(shown, 'F116i: the held notice shows after the banner retires (not swallowed)');
  let drained = false;
  for (let i = 0; i < 50 && !drained; i++) {
    await sleep(400);
    drained = !doc.querySelector('#fxlayer .fx-notice') && !doc.querySelector('#fxlayer .fx-notice-veil');
  }
  ok(drained, 'F116j: the held notice drains and releases the lock');
  window.eval("fxNotice('次の通知', '', true)");
  await sleep(150);
  ok(!!doc.querySelector('#fxlayer .fx-notice'), 'F116k: a fresh notice shows after the drain (no stuck busy flag)');

  // ----- BU-116 live: the banner waits out a live notice (reverse race) -----
  const w2 = await boot();
  const doc2 = w2.document;
  w2.eval("fxNotice('先に出る通知', '', true)");
  await sleep(150);
  ok(!!doc2.querySelector('#fxlayer .fx-notice'), 'F116q: the notice is live (setup)');
  w2.eval('fxTurnBanner(false, 2)');
  await sleep(200);
  ok(!doc2.querySelector('.fx-turn'), 'F116r: no banner shows while the notice is live (it pends)');
  let bannerShown = false;
  for (let i = 0; i < 25 && !bannerShown; i++) { await sleep(400); bannerShown = !!doc2.querySelector('.fx-turn'); }
  ok(bannerShown, 'F116s: the pending banner shows after the notice retires (not dropped)');

  // ----- BU-116 live: a reset retires a held show -----
  w2.eval('fxTurnBanner(false, 2)');
  await sleep(120);
  w2.eval("fxNotice('リセットで消えるはずの通知', '', true)");
  await sleep(200);
  ok(!doc2.querySelector('#fxlayer .fx-notice'), 'F116l: the notice is held while the banner is live (setup)');
  try { w2.eval('fxResetFoundation()'); } catch (e) { /* the reset must not throw the test */ }
  let resurrected = false;
  for (let i = 0; i < 8; i++) { await sleep(400); if (doc2.querySelector('#fxlayer .fx-notice')) { resurrected = true; break; } }
  ok(!resurrected, 'F116m: a reset retires the held show (no stale notice resurrects)');

  // ----- BU-117 live: the adjacent-name break is explicit -----
  const u = (t) => w2.eval('fxNoticeUnitize(' + JSON.stringify(t) + ')');
  ok(u('相手の《丘と芽吹の春化精》《賢瑞官カルダーン》が効果で墓地へ送られた').includes('》<wbr>《'),
    'F117d: two adjacent names get an explicit break between them (the run-18 N1 shape)');
  ok(!u('相手の《第１９層『襲来干渉！漆黒の超量士！！』》が墓地へ送られた').includes('』<wbr>'),
    'F117e: no break after a close bracket (》 is never stranded alone)');
  ok(u('相手の《合体魔神－ゲート・ガーディアン》が《花と野原の春化精》に攻撃').includes('－<wbr>'),
    'F117f: a separator inside a name still carries its break');

  // ----- BU-118 live: the fit math, with stubbed geometry -----
  // a card with a long effect text (the run-18 700-022 case shape)
  const longCode = Object.keys(data.texts || {}).map(Number).filter(c => ((data.texts[c] || {}).text || '').length > 120)[0];
  ok(!!longCode, 'F118e: a long-text card exists in the pool (setup)');
  // applyLayout only runs on the start-button tap (the duel-start
  // fit), so drive it directly: the band's class rides on it.
  window.eval('applyLayout()');
  window.eval('setPreview(' + longCode + ', null)');
  await sleep(80);
  const pv = doc.getElementById('preview');
  ok(!!pv && pv.classList.contains('on'), 'F118f: the preview band is open (setup)');
  const textEl = pv.querySelector('.pv-text');
  ok(!!textEl, 'F118g: the effect-text row exists (setup)');
  // case 1: 52px band, 19px top row -> 19px left -> exactly 1 whole line
  stubNum(pv, 'clientHeight', 52);
  stubNum(pv.querySelector('.pv-top'), 'offsetHeight', 19);
  stubNum(pv.querySelector('.pv-meta'), 'offsetHeight', 0);
  window.eval('fitPreviewText()');
  ok(textEl.style.display !== 'none' && textEl.style.maxHeight !== '' && Math.abs(parseFloat(textEl.style.maxHeight) - 11.5 * 1.55) < 0.6,
    'F118h: one whole line fits (maxHeight = 1 line, got ' + textEl.style.maxHeight + ')');
  ok(textEl.style.overflow === 'hidden', 'F118i: the clamped text cannot scroll to a half line');
  // case 2: the run-18 geometry — 25px top + 13px meta leaves 0 lines
  stubNum(pv.querySelector('.pv-top'), 'offsetHeight', 25);
  stubNum(pv.querySelector('.pv-meta'), 'offsetHeight', 13);
  window.eval('fitPreviewText()');
  ok(textEl.style.display === 'none', 'F118j: zero whole lines hides the text outright (the run-18 half-cut row is gone)');
  // case 3: a taller band restores it (a resize can never strand the hide)
  stubNum(pv, 'clientHeight', 90);
  window.eval('fitPreviewText()');
  ok(textEl.style.display !== 'none' && parseFloat(textEl.style.maxHeight) >= 2 * 11.5 * 1.55 - 0.6,
    'F118k: a taller band restores whole lines (maxHeight ' + textEl.style.maxHeight + ')');

  // ----- BU-119 live: the shortener + the band structure -----
  const lbl = (t) => window.eval('peekBarLabel(' + JSON.stringify(t) + ')');
  ok(lbl('魔法・罠をセット') === '魔法・罠をセット', 'F119h: standard labels pass through untouched');
  ok(lbl('効果を発動：① 手札を１枚捨てて発動できる。攻撃力が２４００以上か８００…') === '効果を発動：① 手札を１枚捨てて発動できる。',
    'F119i: a long activation label shortens to its first sentence');
  ok(lbl('決定（あと1枚）') === '決定（あと1枚）', 'F119j: short decision labels pass through untouched');
  // structure: open a yes/no sheet, peek, and read the band
  window.eval(`(() => { window.__f119 = null;
    uiAnswer({ name: 'SELECT_EFFECTYN', player: 0, code: 0, desc: 0, loc: 4, retryCount: 0, context: null },
      { players: [{}, {}], phaseName: 'MAIN1', turnCount: 1, chain: [], turnPlayer: 0, log: [] }).then(b => { window.__f119 = b; });
    return true; })()`);
  for (let i = 0; i < 40 && !doc.getElementById('yn-yes'); i++) await sleep(50);
  ok(!!doc.getElementById('yn-yes'), 'F119k: a yes/no sheet opens (setup)');
  doc.getElementById('peekbtn').click();
  await sleep(80);
  const bar = doc.getElementById('peekbar');
  ok(bar.classList.contains('onbar'), 'F119l: peeking raises the answer band');
  const sc = bar.querySelector(':scope > .pb-scroll');
  ok(!!sc, 'F119m: the mirrors ride in the inner scroller');
  const mirrors = [...sc.querySelectorAll('button')];
  ok(mirrors.some(b => b.textContent.trim() === '発動する') && mirrors.some(b => b.textContent.trim() === '発動しない'),
    'F119n: both answers are mirrored inside the scroller');
  const back = bar.querySelector(':scope > .pb-back');
  ok(!!back && back.textContent === '選択に戻る', 'F119o: 選択に戻る is a direct child of the band (fixed sibling, outside the scroller)');
  ok(!sc.contains(back), 'F119p: the chrome never sits inside the scroll flow');

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FIX-BU116-119 CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('FAIL: exception', e && e.stack || e); process.exit(1); });
