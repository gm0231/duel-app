'use strict';
/* test-bu36.js — BU-36 残り（折りたたみ・peek 時の上部ボタン群が
   盤面・ヘッダーを覆う）のピンテスト。
   修正前の座席：通常時はシート上端の8px上（盤面の真上）、peek 時は
   ヘッダー下端＋4px（ヘッダーは通知で 77→171px まで伸びるため
   パイル行・Sゾーンの上に落ちる）。修正後：通常時はシート自身の
   予約帯（上端60pxのスティッキー帯）の中、peek 時は折りたたみ帯
   （#peekbar）の中。jsdom で見える範囲（DOM・スタイル契約・
   ソースの座席計算）をここで固定し、実測の重なり px 数は
   Puppeteer ミラーのプローブで測る（記録は
   hidden_files/bu36-1116/RECORD.md）。 */
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MUDORA = 99937011, KELDO = 63542003;

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
  const click = (el) => { if (el) el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; };
  ok(doc.getElementById('loadmsg').textContent.includes('準備完了'), 'B36-0: client boots');

  // ---- CSS 契約：シート自身の予約帯と peek 時の浮かせ隠し ----
  ok(/#sheet::before\{[^}]*height:60px/.test(html) && /#sheet::before\{[^}]*position:sticky/.test(html),
    'B36-1 (BU-36): #sheet reserves a 60px sticky strip at its own top for the buttons');
  ok(/#sheet\{[^}]*max-height:min\(calc\(100dvh - 84px\),calc\(var\(--appvh,100dvh\) - 84px\)\)/.test(html) &&
     /vh\.visibleBottom - 84/.test(clientSrc),
    'B36-1b (BU-36): the sheet height budget pays for the strip (84px reserve, was 108): at 620h a capped sheet reaches 536px so the M1e 4-tile first render keeps its margin, and ensureSheetFits clamps to the same 84');
  ok(/#gridmore\{[^}]*position:absolute/.test(html) && /#gridmore\{[^}]*bottom:100%/.test(html) &&
     /#gridmore\{[^}]*pointer-events:none/.test(html) && /#sheet\.flexsheet \.btnrow\{[^}]*position:relative/.test(html),
    'B36-1c (BU-36): the F7 more-below cue floats above the button row (absolute, pointer-events none) instead of taking a 26px in-flow row that pushed the button row over the last visible tile centre');
  ok(/#sheetwrap\.on\.peek\[data-kind="view"\] #sheetx\{display:none/.test(html),
    'B36-2a (BU-36): the floating × is hidden while peeked (beats the view-kind display rule)');
  ok(/#sheetwrap\.on\.peek #peekbtn\{display:none/.test(html),
    'B36-2b (BU-36): the floating 盤面を見る is hidden while peeked');
  ok(/#peekbar \.bigbtn\.pb-back\{[^}]*min-height:52px/.test(html) && /#peekbar \.bigbtn\.pb-x\{[^}]*min-height:52px/.test(html),
    'B36-3 (BU-36): the band chrome buttons keep the 52px tap height');
  ok(/#peekbar \.bigbtn\.pb-back\{[^}]*linear-gradient\(#e6c877,var\(--gold\)\)/.test(html),
    'B36-4 (BU-36): the band 選択に戻る stays gold (big and gold everywhere)');

  // ---- 座席計算：シート内側＋ヘッダー下端が床 ----
  ok(/const top = Math\.max\(sheetTop \+ 8, hdrB \? Math\.round\(hdrB\) \+ 4 : 0\)/.test(clientSrc),
    'B36-5 (BU-36): placeSheetBtns seats the buttons inside the sheet (top edge + 8), floored by the header bottom + 4');
  ok(!/pk\.style\.bottom = Math\.min\(b, wrapH/.test(clientSrc),
    'B36-6 (BU-36): the old above-the-sheet seat (bottom-anchored, header clamp only) is gone');

  // ---- 折りたたみ：グリッド（prompt 種別）の帯 ----
  window.eval(`window.__select.open({ name: 'SELECT_CARD', player: 0, min: 1, max: 1, cancelable: false, retryCount: 0, context: null,
    cards: [ { code: ${KELDO}, con: 0, loc: 16, seq: 0, releaseParam: 0 }, { code: ${MUDORA}, con: 0, loc: 16, seq: 1, releaseParam: 0 } ] })`);
  ok(doc.getElementById('sheetwrap').classList.contains('on'), 'B36-7a: grid sheet opens');
  const pk = doc.getElementById('peekbtn'), sx = doc.getElementById('sheetx');
  ok(pk.style.top === '8px' && pk.style.bottom === 'auto',
    'B36-7b (BU-36): open seat is top-anchored inside the sheet strip (jsdom: sheet height 0 -> top 8px), bottom killed with auto');
  click(pk);
  const bar = doc.getElementById('peekbar');
  ok(doc.getElementById('sheetwrap').classList.contains('peek') && bar.classList.contains('onbar'),
    'B36-8a: peeking raises the band');
  const barBtns = [...bar.querySelectorAll('button')];
  ok(barBtns.some(b => b.classList.contains('pb-back') && b.textContent === '選択に戻る'),
    'B36-8b (BU-36): the band carries 選択に戻る while peeked');
  ok(!barBtns.some(b => b.classList.contains('pb-x')),
    'B36-8c (BU-36): a prompt sheet shows no × in the band (same rule as the floating seat)');
  ok(barBtns.some(b => b.textContent.includes('決定')),
    'B36-8d: the answer mirror still rides in the band while peeked');
  ok(window.getComputedStyle(pk).display === 'none',
    'B36-8e (BU-36): the floating 盤面を見る is hidden while peeked');
  // 帯の 選択に戻る で復帰し、選択が続けられる
  click(bar.querySelector('.pb-back'));
  ok(!doc.getElementById('sheetwrap').classList.contains('peek') && pk.textContent === '盤面を見る' && bar.children.length === 0,
    'B36-9a (BU-36): the band 選択に戻る un-peeks, restores 盤面を見る, and empties the band');
  ok(doc.getElementById('sheetwrap').classList.contains('on') && !!doc.querySelector('#sheet [data-grid]'),
    'B36-9b (BU-36): the sheet is still open after un-peeking — the selection continues');
  click(doc.querySelector('#sheet [data-grid]'));
  const gc = doc.getElementById('grid-confirm');
  ok(!!gc && !gc.disabled, 'B36-9c: the grid selection still answers after the peek round-trip');
  click(gc);
  await sleep(100);
  window.eval('sheetClose()');
  await sleep(300);

  // ---- 折りたたみ：view 種別（回答ミラーなし）の帯 ----
  window.eval(`sheetOpenView('<div class="ttl">カードの確認</div><div class="sub">相手の手札</div><div class="sortrow">テストカード</div><div class="btnrow"><button class="bigbtn" id="sheet-cancel">閉じる</button></div>')`);
  ok(doc.getElementById('sheetwrap').dataset.kind === 'view', 'B36-10a: confirm-style view sheet opens');
  click(doc.getElementById('peekbtn'));
  const bar2 = doc.getElementById('peekbar');
  ok(bar2.classList.contains('onbar'), 'B36-10b (BU-36): the band shows even with no answer to mirror');
  const bar2Btns = [...bar2.querySelectorAll('button')];
  ok(bar2Btns.some(b => b.classList.contains('pb-x') && b.textContent === '×'),
    'B36-10c (BU-36): a view sheet shows × in the band');
  ok(bar2Btns.some(b => b.classList.contains('pb-back') && b.textContent === '選択に戻る'),
    'B36-10d (BU-36): a view sheet shows 選択に戻る in the band');
  ok(bar2Btns.length === 2, 'B36-10e (BU-36): a mirror-less view sheet has exactly the two chrome buttons in the band');
  ok(window.getComputedStyle(doc.getElementById('sheetx')).display === 'none',
    'B36-10f (BU-36): the floating × is hidden while peeked');
  // 帯の × でシートが閉じる
  click(bar2.querySelector('.pb-x'));
  await sleep(400);
  ok(!doc.getElementById('sheetwrap').classList.contains('on') && bar2.children.length === 0,
    'B36-11 (BU-36): the band × closes the view sheet and empties the band');

  // ---- 再 peek：トグルが従来どおり動く ----
  window.eval(`window.__select.open({ name: 'SELECT_CARD', player: 0, min: 1, max: 1, cancelable: true, retryCount: 0, context: null,
    cards: [ { code: ${KELDO}, con: 0, loc: 16, seq: 0, releaseParam: 0 } ] })`);
  click(doc.getElementById('peekbtn'));
  ok(doc.getElementById('peekbar').classList.contains('onbar') && [...doc.getElementById('peekbar').querySelectorAll('button')].some(b => b.classList.contains('pb-back')),
    'B36-12a (BU-36): re-peeking raises the band with 選択に戻る again');
  click(doc.getElementById('peekbtn'));
  ok(!doc.getElementById('sheetwrap').classList.contains('peek') && !doc.getElementById('peekbar').classList.contains('onbar'),
    'B36-12b: the floating toggle still un-peeks as before');
  window.eval('sheetClose()');
  await sleep(300);

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
